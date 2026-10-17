// ── General Ledger engine ────────────────────────────────────────────────────
//
// This is a DERIVED / virtual ledger, not a persisted auto-posting system.
// Invoices, Payments, Expenses and Payables are never written to; instead
// the functions below read those existing collections (already fetched by
// the calling report page) and derive GL lines from them on the fly, tagged
// with where they came from. Only entries with no natural source document
// (opening balances, adjustments, corrections) are persisted, in
// finance_journal_entries, entered manually via JournalEntries.jsx.
//
// Why derived instead of persisted auto-posting: this app has no backend
// (Firebase Spark/free plan — no Cloud Functions), so auto-posting on save
// would mean editing the save/edit/delete flows of 4 existing, working,
// daily-used pages (Invoices/Payments/Expenses/Payables) and handling
// reversal-on-edit/delete entirely client-side, with no server-side
// guarantee the posted JE ever matches its source. Deriving at read time
// makes that whole class of bug impossible — the "ledger" is always exactly
// consistent with the real transactions because it's computed from them.
//
// Company handling: some source collections (finance_expenses,
// finance_payables, and "general" finance_payments with no linked order)
// have no `company` field at all in this app today. Those lines default to
// 'UIPL' and carry `companyInferred: true` so report UIs can flag them
// rather than silently misattributing them to a company.

import { billKey, deriveVoucherLines, deriveOpeningLines } from './voucherEngine.js'
import { deriveInterCompanyLines } from './interCompany.js'

// ── Seed Chart of Accounts ───────────────────────────────────────────────────
// Auto-seeded once (by an admin) if finance_accounts is empty — same pattern
// as CompanySettings.jsx's UIPL auto-seed. One shared tree for both
// companies; individual GL lines carry `company`, matching how
// finance_invoices/crm_orders already discriminate UIPL vs Wayzim.
export const SEED_ACCOUNTS = [
  { code: '1100', name: 'Bank Accounts',                 type: 'asset',     normalBalance: 'debit',  isSystem: true,  isDefaultBank: true, mapsFromMethods: ['Bank Transfer', 'UPI', 'Cheque', 'Other'] },
  { code: '1110', name: 'Cash in Hand',                  type: 'asset',     normalBalance: 'debit',  mapsFromMethods: ['Cash'] },
  { code: '1200', name: 'Accounts Receivable',           type: 'asset',     normalBalance: 'debit',  isSystem: true },
  { code: '1300', name: 'GST Input Credit',              type: 'asset',     normalBalance: 'debit' },
  { code: '1301', name: 'Input CGST',                    type: 'asset',     normalBalance: 'debit',  parentCode: '1300' },
  { code: '1302', name: 'Input SGST',                    type: 'asset',     normalBalance: 'debit',  parentCode: '1300' },
  { code: '1303', name: 'Input IGST',                    type: 'asset',     normalBalance: 'debit',  parentCode: '1300' },
  { code: '1310', name: 'TDS Receivable (deducted by customers)', type: 'asset', normalBalance: 'debit', isSystem: true },
  { code: '1400', name: 'Stock in Hand',                 type: 'asset',     normalBalance: 'debit',  isSystem: true },
  { code: '1950', name: 'Employee Advances',               type: 'asset',     normalBalance: 'debit',  isSystem: true },
  { code: '1500', name: 'Fixed Assets',                  type: 'asset',     normalBalance: 'debit' },
  { code: '1520', name: 'Fixed Deposits (sweep & term)',  type: 'asset',     normalBalance: 'debit' },
  { code: '1900', name: 'Prepaid Expenses',               type: 'asset',     normalBalance: 'debit' },
  { code: '2100', name: 'Accounts Payable',               type: 'liability', normalBalance: 'credit', isSystem: true },
  { code: '2150', name: 'Salary Payable',                 type: 'liability', normalBalance: 'credit', isSystem: true },
  { code: '2610', name: 'PF Payable (employee + employer)', type: 'liability', normalBalance: 'credit', isSystem: true },
  { code: '2620', name: 'ESIC Payable (employee + employer)', type: 'liability', normalBalance: 'credit', isSystem: true },
  { code: '2630', name: 'Other Salary Deductions Payable', type: 'liability', normalBalance: 'credit', isSystem: true },
  { code: '2160', name: 'Business EOR Purchase Services (Wayzim recharge)', type: 'liability', normalBalance: 'credit', isSystem: true },   // Zoho's EOR ledger: recharge invoices credit it, EOR staff salary debits it
  { code: '2400', name: 'GST Payable (Output)',           type: 'liability', normalBalance: 'credit' },
  { code: '2401', name: 'Output CGST Payable',            type: 'liability', normalBalance: 'credit', parentCode: '2400', isSystem: true },
  { code: '2402', name: 'Output SGST Payable',            type: 'liability', normalBalance: 'credit', parentCode: '2400', isSystem: true },
  { code: '2403', name: 'Output IGST Payable',            type: 'liability', normalBalance: 'credit', parentCode: '2400', isSystem: true },
  { code: '2404', name: 'GST Payable under Reverse Charge', type: 'liability', normalBalance: 'credit', parentCode: '2400', isSystem: true },
  { code: '2500', name: 'TDS Payable',                    type: 'liability', normalBalance: 'credit', isSystem: true },
  { code: '2900', name: 'Other Current Liabilities',      type: 'liability', normalBalance: 'credit' },
  { code: '2910', name: "Directors' Current Account",     type: 'liability', normalBalance: 'credit' },
  { code: '3000', name: "Owner's Equity / Share Capital", type: 'equity',    normalBalance: 'credit' },
  { code: '3100', name: 'Retained Earnings',              type: 'equity',    normalBalance: 'credit' },
  { code: '3200', name: 'Opening Balance Equity',          type: 'equity',    normalBalance: 'credit', isSystem: true },
  { code: '4000', name: 'Sales Revenue',                   type: 'income',    normalBalance: 'credit', isSystem: true },
  { code: '4900', name: 'Other Income',                    type: 'income',    normalBalance: 'credit' },
  { code: '4910', name: 'Interest Income',                 type: 'income',    normalBalance: 'credit' },
  { code: '4920', name: 'Discount Received',               type: 'income',    normalBalance: 'credit' },
  { code: '4925', name: 'Foreign Exchange Gain',            type: 'income',    normalBalance: 'credit', isSystem: true },
  { code: '4950', name: 'Rounding Off Income',             type: 'income',    normalBalance: 'credit', isSystem: true },
  { code: '5000', name: 'Purchases & Subcontractor Costs', type: 'expense',   normalBalance: 'debit',  isSystem: true, isDefaultPurchase: true },
  { code: '5010', name: 'Stock Adjustment (Opening / Closing Stock)', type: 'expense', normalBalance: 'debit', isSystem: true },
  { code: '5100', name: 'Rent',                            type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Rent'] },
  { code: '5105', name: 'EOR Services Cost (recharged)',    type: 'expense',   normalBalance: 'debit' },
  { code: '5110', name: 'Salaries & Wages',                type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Salaries'] },
  { code: '5200', name: 'Service Fee to UIPL (inter-company)', type: 'expense',   normalBalance: 'debit',  isSystem: true },
  { code: '5115', name: 'Employer PF Contribution',        type: 'expense',   normalBalance: 'debit',  isSystem: true },
  { code: '5116', name: 'Employer ESIC Contribution',      type: 'expense',   normalBalance: 'debit',  isSystem: true },
  { code: '5117', name: 'PF Admin & EDLI Charges',         type: 'expense',   normalBalance: 'debit',  isSystem: true },
  { code: '5120', name: 'Transport / Delivery',             type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Transport / Delivery'] },
  { code: '5125', name: 'Travel & Conveyance',               type: 'expense',   normalBalance: 'debit' },
  { code: '5130', name: 'Utilities',                       type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Utilities'] },
  { code: '5135', name: 'IT, Software & Internet',          type: 'expense',   normalBalance: 'debit' },
  { code: '5140', name: 'Supplies / Packaging',            type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Supplies / Packaging'] },
  { code: '5150', name: 'Marketing',                        type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Marketing'] },
  { code: '5160', name: 'Repairs & Maintenance',            type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Repairs'] },
  { code: '5170', name: 'Bank Charges',                     type: 'expense',   normalBalance: 'debit' },
  { code: '5180', name: 'Interest Paid',                    type: 'expense',   normalBalance: 'debit' },
  { code: '5190', name: 'Professional & Legal Fees',        type: 'expense',   normalBalance: 'debit' },
  { code: '5195', name: 'Freight & Cartage Inward',         type: 'expense',   normalBalance: 'debit' },
  { code: '5900', name: 'Miscellaneous Expenses',           type: 'expense',   normalBalance: 'debit',  isSystem: true, isDefaultExpense: true, mapsFromCategories: ['Miscellaneous'] },
  { code: '5925', name: 'Foreign Exchange Loss',            type: 'expense',   normalBalance: 'debit',  isSystem: true },
  { code: '5950', name: 'Rounding Off Expense',             type: 'expense',   normalBalance: 'debit',  isSystem: true },
]

// Accounts the derivation logic posts to. Older companies seeded their Chart of
// Accounts before some of these existed, and computeAccountBalances() silently
// drops lines for codes missing from the accounts list (which would unbalance
// every report). So readers merge any missing ones in-memory (flagged
// `virtual:true`) instead of depending on someone having re-seeded the CoA.
export const REQUIRED_ACCOUNT_CODES = [
  '1100', '1110', '1520', '1200', '1301', '1302', '1303', '1310', '1400',
  '2100', '2150', '2160', '2401', '2402', '2403', '2404', '2500', '2610', '2620', '2630', '1950', '5110', '5115', '5116', '5117', '5200',
  '3200', '4000', '4925', '4950', '5000', '5010', '5900', '5925', '5950',
]
export const mergeRequiredAccounts = (dbAccounts = []) => {
  // Not seeded yet: use the standard chart virtually so vouchers and reports work straight away
  // (the Chart of Accounts page can still persist it for editing).
  if (dbAccounts.length === 0) return SEED_ACCOUNTS.map(a => ({ ...a, id: a.code, isActive: true, virtual: true }))
  const have = new Set(dbAccounts.map(a => a.code))
  const missing = SEED_ACCOUNTS
    .filter(a => REQUIRED_ACCOUNT_CODES.includes(a.code) && !have.has(a.code))
    .map(a => ({ ...a, id: a.code, isActive: true, virtual: true }))
  return [...dbAccounts, ...missing]
}

// ── Account lookup helpers ───────────────────────────────────────────────────
export const findAccount = (accounts, code) => accounts.find(a => a.code === code)

export const mapCategoryToAccount = (accounts, category) =>
  accounts.find(a => (a.mapsFromCategories || []).includes(category)) ||
  accounts.find(a => a.isDefaultExpense) ||
  null

export const mapMethodToAccount = (accounts, method) =>
  accounts.find(a => (a.mapsFromMethods || []).includes(method)) ||
  accounts.find(a => a.isDefaultBank) ||
  null

const acct = (accounts, code) => {
  const a = findAccount(accounts, code)
  return { accountCode: code, accountName: a?.name || code }
}

// ── Per-source derivation ────────────────────────────────────────────────────
// Each function returns an array of lines:
// { accountCode, accountName, debit, credit, date, company, companyInferred,
//   sourceType, sourceId, sourceDocNumber, description }
// Debits and credits within one document's lines always net to zero.

// Pro-forma invoices and sales orders are quotations / commitments, not
// accounting events (Tally books neither). Only Tax Invoices ('TI', or legacy
// docs with no type) hit the ledger.
export const isAccountingInvoice = (invoice) => !['PI', 'SO'].includes(invoice.invoiceType)

export function deriveInvoiceLines(invoice, accounts) {
  if (!invoice.invoiceDate) return []
  if (!isAccountingInvoice(invoice)) return []
  const lines = []
  const ar = acct(accounts, '1200')
  const total = Number(invoice.total) || 0
  lines.push({
    ...ar, debit: total, credit: 0,
    partyType: 'customer', partyId: invoice.customerId || '', partyName: invoice.billToName || '',
    billKey: billKey('invoice', invoice.id), billRef: invoice.invoiceNumber || invoice.id,
    dueDate: invoice.dueDate || invoice.invoiceDate,
    // foreign-currency invoice: remember the amount owed in that currency and the booking rate
    ...(invoice.fx?.currency && invoice.fx.currency !== 'INR' ? { currency: invoice.fx.currency, fcAmount: Number(invoice.fx.total) || 0, fxRate: Number(invoice.fx.rate) || 0 } : {}),
  })

  const subTotal = Number(invoice.subTotal) || 0
  // Wayzim's EOR recharge invoices: the salary and expense lines credit the EOR ledger (a pass-through), the administration fee stays income
  const split = Array.isArray(invoice.revenueSplit) && invoice.revenueSplit.length ? invoice.revenueSplit : [{ accountCode: invoice.revenueAccountCode || '4000', amount: subTotal }]
  split.forEach(sp => lines.push({ ...acct(accounts, sp.accountCode || '4000'), debit: 0, credit: Number(sp.amount) || 0 }))

  ;(invoice.gstLines || []).forEach(g => {
    const label = g.label || ''
    const code = label.startsWith('CGST') ? '2401' : label.startsWith('SGST') ? '2402' : label.startsWith('IGST') ? '2403' : null
    if (!code) return
    lines.push({ ...acct(accounts, code), debit: 0, credit: Number(g.amount) || 0 })
  })

  const roundOff = Number(invoice.roundOff) || 0
  if (roundOff > 0) lines.push({ ...acct(accounts, '4950'), debit: 0, credit: roundOff })
  else if (roundOff < 0) lines.push({ ...acct(accounts, '5950'), debit: -roundOff, credit: 0 })

  return lines.map(l => ({
    ...l,
    date: invoice.invoiceDate,
    company: invoice.company || 'UIPL',
    companyInferred: false,
    sourceType: 'invoice',
    sourceId: invoice.id,
    sourceDocNumber: invoice.invoiceNumber || invoice.id,
    description: invoice.billToName || invoice.customerId || '',
  }))
}

export function derivePaymentLines(payment, orders, accounts) {
  if (!payment.date) return []
  const amount = Number(payment.amount) || 0
  if (!amount) return []
  const bankAcct = mapMethodToAccount(accounts, payment.method) || findAccount(accounts, '1100')
  const order = payment.orderId ? orders.find(o => o.id === payment.orderId) : null
  const company = order?.company || 'UIPL'
  const companyInferred = !order

  return [
    { accountCode: bankAcct.code, accountName: bankAcct.name, debit: amount, credit: 0 },
    {
      ...acct(accounts, '1200'), debit: 0, credit: amount,
      // Legacy receipts carry the customer *name* (not an id) and are order-linked,
      // never invoice-linked, so they settle bills FIFO rather than by allocation.
      partyType: 'customer', partyId: '', partyName: payment.customerName || payment.customerId || '',
      billRef: payment.orderRef || '', onAccount: true,
    },
  ].map(l => ({
    ...l,
    date: payment.date,
    company, companyInferred,
    sourceType: 'receipt',
    sourceId: payment.id,
    sourceDocNumber: payment.orderRef || payment.id,
    description: payment.customerName || payment.customerId || '',
  }))
}

export function deriveExpenseLines(expense, accounts) {
  if (!expense.date) return []
  const amount = Number(expense.amount) || 0
  if (!amount) return []
  const expAcct = mapCategoryToAccount(accounts, expense.category) || findAccount(accounts, '5900')
  const bankAcct = findAccount(accounts, '1100')

  return [
    { accountCode: expAcct.code, accountName: expAcct.name, debit: amount, credit: 0 },
    { accountCode: bankAcct.code, accountName: bankAcct.name, debit: 0, credit: amount },
  ].map(l => ({
    ...l,
    date: expense.date,
    company: 'UIPL', companyInferred: true,
    sourceType: 'expense',
    sourceId: expense.id,
    sourceDocNumber: expense.description || expense.category || expense.id,
    description: expense.description || expense.category || '',
  }))
}

export function derivePayableLines(payable, accounts) {
  const amount = Number(payable.amount) || 0
  if (!amount) return []
  const lines = []
  const purchaseAcct = findAccount(accounts, '5000')
  const apAcct = findAccount(accounts, '2100')
  const bankAcct = findAccount(accounts, '1100')

  const partyTag = { partyType: 'vendor', partyId: '', partyName: payable.vendor || '' }
  const key = billKey('payable', payable.id)
  if (payable.invoiceDate) {
    lines.push(
      { accountCode: purchaseAcct.code, accountName: purchaseAcct.name, debit: amount, credit: 0, date: payable.invoiceDate },
      {
        accountCode: apAcct.code, accountName: apAcct.name, debit: 0, credit: amount, date: payable.invoiceDate,
        ...partyTag, billKey: key, billRef: payable.invoiceRef || payable.id, dueDate: payable.dueDate || payable.invoiceDate,
      },
    )
  }
  if (payable.status === 'paid' && payable.paidOn) {
    lines.push(
      { accountCode: apAcct.code, accountName: apAcct.name, debit: amount, credit: 0, date: payable.paidOn, ...partyTag, billRef: payable.invoiceRef || payable.id, allocatesTo: key },
      { accountCode: bankAcct.code, accountName: bankAcct.name, debit: 0, credit: amount, date: payable.paidOn },
    )
  }

  return lines.map(l => ({
    ...l,
    company: 'UIPL', companyInferred: true,
    sourceType: 'payable',
    sourceId: payable.id,
    sourceDocNumber: payable.invoiceRef || payable.vendor || payable.id,
    description: payable.vendor || payable.description || '',
  }))
}

// Combines every derived line across all four source collections.
// Note: project_costs is intentionally NOT included — it's a budget/actual
// job-costing tracker, not a record of real cash movement, and posting it
// would double-count against the same transaction already captured in
// finance_expenses/finance_payables.
export function deriveAllLines({
  invoices = [], payments = [], orders = [], expenses = [], payables = [], accounts = [],
  vouchers = [], customers = [], vendors = [], bankAccounts = [],
}) {
  return [
    ...invoices.flatMap(d => deriveInvoiceLines(d, accounts)),
    ...payments.flatMap(d => derivePaymentLines(d, orders, accounts)),
    ...expenses.flatMap(d => deriveExpenseLines(d, accounts)),
    ...payables.flatMap(d => derivePayableLines(d, accounts)),
    ...vouchers.flatMap(d => deriveVoucherLines(d, accounts)),
    ...deriveOpeningLines({ customers, vendors, bankAccounts, accounts }),
    ...deriveInterCompanyLines({ invoices, vouchers, accounts }),   // Wayzim's side of UIPL's service-fee documents
  ]
}

// Flattens manual finance_journal_entries docs into the same line shape.
export function manualEntryLines(journalEntries = []) {
  return journalEntries.flatMap(je =>
    (je.lines || []).map(l => ({
      accountCode: l.accountCode,
      accountName: l.accountName,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      date: je.date,
      company: je.company || 'UIPL',
      companyInferred: false,
      sourceType: 'manual',
      sourceId: je.id,
      sourceDocNumber: je.reference || je.id,
      description: l.description || je.memo || '',
    }))
  )
}

// Dev-only sanity check: every source document's own lines should net to
// zero. Run this on every report page load (guarded by import.meta.env.DEV
// so it's free in production) — the practical substitute for a unit test in
// a repo with no test framework.
export function assertBalanced(lines) {
  const bySource = {}
  lines.forEach(l => {
    const key = `${l.sourceType}:${l.sourceId}`
    bySource[key] = (bySource[key] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0)
  })
  Object.entries(bySource).forEach(([key, net]) => {
    if (Math.abs(net) > 0.01) {
      console.warn(`[ledger] ${key} does not balance — net ${net.toFixed(2)}`)
    }
  })
}

// ── Balance computation ──────────────────────────────────────────────────────
// Filters by company + as-of date, sums debit/credit per account, and signs
// the balance per the account's normal side (debit accounts: debit-credit;
// credit accounts: credit-debit).
export function computeAccountBalances(allLines, accounts, { company, asOfDate } = {}) {
  const filtered = allLines.filter(l =>
    (!company || l.company === company) &&
    (!asOfDate || (l.date || '') <= asOfDate)
  )
  const byCode = {}
  filtered.forEach(l => {
    if (!byCode[l.accountCode]) byCode[l.accountCode] = { debit: 0, credit: 0 }
    byCode[l.accountCode].debit += Number(l.debit) || 0
    byCode[l.accountCode].credit += Number(l.credit) || 0
  })
  return accounts
    .filter(a => byCode[a.code])
    .map(a => {
      const { debit, credit } = byCode[a.code]
      const balance = a.normalBalance === 'debit' ? debit - credit : credit - debit
      return { ...a, debit, credit, balance }
    })
}
