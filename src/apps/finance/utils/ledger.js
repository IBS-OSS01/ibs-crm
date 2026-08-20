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
  { code: '1500', name: 'Fixed Assets',                  type: 'asset',     normalBalance: 'debit' },
  { code: '1900', name: 'Prepaid Expenses',               type: 'asset',     normalBalance: 'debit' },
  { code: '2100', name: 'Accounts Payable',               type: 'liability', normalBalance: 'credit', isSystem: true },
  { code: '2400', name: 'GST Payable (Output)',           type: 'liability', normalBalance: 'credit' },
  { code: '2401', name: 'Output CGST Payable',            type: 'liability', normalBalance: 'credit', parentCode: '2400', isSystem: true },
  { code: '2402', name: 'Output SGST Payable',            type: 'liability', normalBalance: 'credit', parentCode: '2400', isSystem: true },
  { code: '2403', name: 'Output IGST Payable',            type: 'liability', normalBalance: 'credit', parentCode: '2400', isSystem: true },
  { code: '2500', name: 'TDS Payable',                    type: 'liability', normalBalance: 'credit' },
  { code: '2900', name: 'Other Current Liabilities',      type: 'liability', normalBalance: 'credit' },
  { code: '3000', name: "Owner's Equity / Share Capital", type: 'equity',    normalBalance: 'credit' },
  { code: '3100', name: 'Retained Earnings',              type: 'equity',    normalBalance: 'credit' },
  { code: '3200', name: 'Opening Balance Equity',          type: 'equity',    normalBalance: 'credit', isSystem: true },
  { code: '4000', name: 'Sales Revenue',                   type: 'income',    normalBalance: 'credit', isSystem: true },
  { code: '4900', name: 'Other Income',                    type: 'income',    normalBalance: 'credit' },
  { code: '4950', name: 'Rounding Off Income',             type: 'income',    normalBalance: 'credit', isSystem: true },
  { code: '5000', name: 'Purchases & Subcontractor Costs', type: 'expense',   normalBalance: 'debit',  isSystem: true, isDefaultPurchase: true },
  { code: '5100', name: 'Rent',                            type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Rent'] },
  { code: '5110', name: 'Salaries & Wages',                 type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Salaries'] },
  { code: '5120', name: 'Transport / Delivery',             type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Transport / Delivery'] },
  { code: '5130', name: 'Utilities',                        type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Utilities'] },
  { code: '5140', name: 'Supplies / Packaging',             type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Supplies / Packaging'] },
  { code: '5150', name: 'Marketing',                        type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Marketing'] },
  { code: '5160', name: 'Repairs & Maintenance',            type: 'expense',   normalBalance: 'debit',  mapsFromCategories: ['Repairs'] },
  { code: '5900', name: 'Miscellaneous Expenses',           type: 'expense',   normalBalance: 'debit',  isSystem: true, isDefaultExpense: true, mapsFromCategories: ['Miscellaneous'] },
  { code: '5950', name: 'Rounding Off Expense',             type: 'expense',   normalBalance: 'debit',  isSystem: true },
]

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

export function deriveInvoiceLines(invoice, accounts) {
  if (!invoice.invoiceDate) return []
  const lines = []
  const ar = acct(accounts, '1200')
  const total = Number(invoice.total) || 0
  lines.push({ ...ar, debit: total, credit: 0 })

  const rev = acct(accounts, '4000')
  const subTotal = Number(invoice.subTotal) || 0
  lines.push({ ...rev, debit: 0, credit: subTotal })

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
    { ...acct(accounts, '1200'), debit: 0, credit: amount },
  ].map(l => ({
    ...l,
    date: payment.date,
    company, companyInferred,
    sourceType: 'payment',
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

  if (payable.invoiceDate) {
    lines.push(
      { accountCode: purchaseAcct.code, accountName: purchaseAcct.name, debit: amount, credit: 0, date: payable.invoiceDate },
      { accountCode: apAcct.code, accountName: apAcct.name, debit: 0, credit: amount, date: payable.invoiceDate },
    )
  }
  if (payable.status === 'paid' && payable.paidOn) {
    lines.push(
      { accountCode: apAcct.code, accountName: apAcct.name, debit: amount, credit: 0, date: payable.paidOn },
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
export function deriveAllLines({ invoices = [], payments = [], orders = [], expenses = [], payables = [], accounts = [] }) {
  return [
    ...invoices.flatMap(d => deriveInvoiceLines(d, accounts)),
    ...payments.flatMap(d => derivePaymentLines(d, orders, accounts)),
    ...expenses.flatMap(d => deriveExpenseLines(d, accounts)),
    ...payables.flatMap(d => derivePayableLines(d, accounts)),
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
