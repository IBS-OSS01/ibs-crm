// Expenses exported from Zoho Books ("Expense" CSV) → entries in the books.
// Most were paid from a bank account whose statement is already in the books, so each expense is first looked for among the
// existing payment entries (same amount, a few days apart); if found, that entry is re-classified (ledger, narration) instead of
// duplicated. Only expenses with no matching entry become new payment vouchers.
import { r2 } from './financeConstants.js'
import { accountFor } from './zohoPurchases.js'

const s = (v) => String(v ?? '').trim()
const n = (v) => { const x = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : 0 }
const dayDiff = (a, b) => Math.abs(Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000))

// Zoho "Paid Through" → how the money left: a bank account of ours, or a ledger when someone else paid
export const PAID_THROUGH = { 'HSBC BANK': { bank: 'hsbc' }, 'HDFC BANK': { bank: 'hdfc' }, 'Yes Bank': { bank: 'yes' }, Debt: { ledger: '2910' }, 'Vendor Clearing Account': { ledger: '2900' } }

export function parseZohoExpenses(rows) {
  return rows.map((r, i) => {
    const total = r2(n(r.Total) || n(r['Expense Amount'])), tax = r2(n(r['Tax Amount']))
    const base = r2(total - tax)
    const taxLines = [['1301', n(r.CGST)], ['1302', n(r.SGST)], ['1303', n(r.IGST)]].filter(([, a]) => a > 0).map(([accountCode, amount]) => ({ accountCode, amount: r2(amount), description: 'Input tax' }))
    const ledger = s(r['Expense Account']) === 'Deposits' ? '1900' : accountFor(r['Expense Account'])
    const paid = s(r['Paid Through'])
    return {
      idx: i, refId: s(r['Expense Reference ID']), date: s(r['Expense Date']), account: s(r['Expense Account']), ledger, vendor: s(r.Vendor), description: s(r['Expense Description']), paidThrough: paid, via: PAID_THROUGH[paid] || {},
      total, base, taxLines, ref: s(r['Reference#']), warnings: PAID_THROUGH[paid] ? [] : [`Paid through “${paid}” is not mapped`],
    }
  }).filter(e => e.total > 0 && e.date).sort((a, b) => a.date.localeCompare(b.date))
}

// payments: [{ id, date, cash, bankAccountId, voucher }] — existing payment entries not yet tied to an expense.
// bankIds: { hsbc, hdfc, yes } → bank account ids in the app.
export function matchExpenses(expenses, payments, bankIds = {}, { days = 10 } = {}) {
  const used = new Set(), matches = [], fresh = [], orphans = []
  for (const e of expenses) {
    const bank = e.via.bank ? bankIds[e.via.bank] : undefined
    const cand = payments.filter(p => !used.has(p.id) && Math.abs(p.cash - e.total) < 0.5 && dayDiff(p.date, e.date) <= days && (bank === undefined || (p.bankAccountId || '') === bank))
      .sort((a, b) => dayDiff(a.date, e.date) - dayDiff(b.date, e.date))
    if (e.via.bank && cand.length) { used.add(cand[0].id); matches.push({ expense: e, paymentId: cand[0].id }) }
    else if (e.via.bank === 'hsbc') orphans.push(e)        // the HSBC statement is complete: no line for it means it was not paid from this account
    else fresh.push(e)
  }
  return { matches, fresh, orphans }
}

// How an existing payment is re-classified to the expense Zoho recorded
export function reclassify(v, e) {
  const same = (v.accountLines || []).length === 1 && v.accountLines[0].accountCode === e.ledger
  const note = [`Zoho expense: ${e.account}`, e.vendor && `· ${e.vendor}`, e.description && `· ${e.description}`].filter(Boolean).join(' ')
  const asVendor = v.partyType === 'vendor' && (v.allocations || []).length === 0 && !(v.accountLines || []).length
  const accountLines = asVendor || (v.allocations || []).length ? v.accountLines || [] : [{ accountCode: e.ledger, amount: r2(e.total - e.taxLines.reduce((t, l) => t + l.amount, 0)), description: e.description || e.account }, ...e.taxLines]
  return { changed: !same || !String(v.narration || '').includes('Zoho expense'), data: { ...v, accountLines: asVendor ? [] : accountLines, narration: `${String(v.narration || '').replace(/\s*·?\s*Zoho expense:.*$/, '')} · ${note}`.slice(0, 400).trim(), expenseRef: e.refId } }
}

// A new payment voucher body for an expense with no matching entry
export function toExpenseVoucher(e, { company = 'UIPL', bankIds = {} } = {}) {
  const bankId = e.via.bank ? bankIds[e.via.bank] : ''
  return {
    voucherType: 'payment', company, date: e.date, partyAmount: 0, allocations: [], tds: { applicable: false },
    accountLines: [{ accountCode: e.ledger, amount: r2(e.total - e.taxLines.reduce((t, l) => t + l.amount, 0)), description: e.description || e.account }, ...e.taxLines],
    bankAccountCode: e.via.ledger || '1100', bankAccountId: bankId || '', refNumber: e.ref, amount: e.total, currency: 'INR', fxRate: 1, bankAmountInr: null, onAccountFc: 0,
    narration: `Zoho expense: ${e.account}${e.vendor ? ' · ' + e.vendor : ''}${e.description ? ' · ' + e.description : ''}`.slice(0, 400), expenseRef: e.refId, source: 'zoho-import',
  }
}
