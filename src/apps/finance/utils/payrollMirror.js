// Salary and EOR books, brought in line with Zoho Books (13 Oct 2026).
//
// Zoho books every month's salary slip as a journal: the gross salary goes to the "Business EOR Purchase Services" ledger for
// people whose pay Wayzim reimburses (the set changes every month) or to Salaries & Wages for the others; PF, professional tax,
// TDS and the net pay are credited as liabilities. The Wayzim recharge invoices credit the EOR ledger, so it shows only the
// net still to be recovered. The bank then pays the net salary, PF and TDS against those liabilities.
//
// Our books had only the bank side (salary paid → expense, PF and TDS paid → liability with nothing accrued). This file proposes:
//   1. the slip journals (data from Zoho: utils/zohoPayrollData.js), as ordinary journal entries
//   2. bank payments that were booked to Salaries & Wages → settle Salary Payable (2150) instead, so salary is not counted twice
//   3. the Wayzim recharge invoices → credit the EOR ledger (2160) instead of Sales
//   4. staff-cost bills already coded to "EOR Services Cost (recharged)" (5105: Greytip, Pluxee, hotels …) → the same EOR ledger, as in Zoho
import { r2, num } from './financeConstants.js'
import { ZOHO_PAYROLL } from './zohoPayrollData.js'

const NAMES = { 2160: 'Business EOR Purchase Services (Wayzim recharge)', 5110: 'Salaries & Wages', 2610: 'PF Payable (employee + employer)', 2630: 'Other Salary Deductions Payable', 2500: 'TDS Payable', 2150: 'Salary Payable' }
const refOf = (n) => `ZB-JV-${n}`

export function buildPayrollMirror(raw) {
  const out = []
  const have = new Set((raw?.journalEntries || []).map(j => j.reference))

  // 1. slip journals
  for (const [n, date, memo, lines] of ZOHO_PAYROLL) {
    const reference = refOf(n)
    if (have.has(reference)) continue
    const dr = r2(lines.reduce((s, l) => s + l[1], 0))
    out.push({ key: reference, group: 'Salary slips from Zoho (journals)', kind: 'journal', amount: dr, title: `${date} · Zoho journal ${n}`,
      detail: `${memo} — ${lines.map(([c, d, k]) => `${NAMES[c] || c} ${d ? 'Dr' : 'Cr'} ${(d || k).toLocaleString('en-IN')}`).join(' · ')}`,
      data: { reference, date, company: 'UIPL', memo: `Zoho Books journal ${n} — ${memo}`, sourceType: 'zoho-import', status: 'posted',
        lines: lines.flatMap(([c, d, k]) => [d ? { accountCode: String(c), accountName: NAMES[c] || String(c), debit: d, credit: 0, description: memo } : null, k ? { accountCode: String(c), accountName: NAMES[c] || String(c), debit: 0, credit: k, description: memo } : null].filter(Boolean)) } })
  }

  // 2. bank payments of salary booked as an expense → settle the salary payable
  for (const v of raw?.vouchers || []) {
    if (v.voucherType !== 'payment' || v.status === 'cancelled' || v.partyId) continue
    const al = v.accountLines || []
    if (al.length !== 1 || al[0].accountCode !== '5110') continue
    out.push({ key: v.id, group: 'Bank salary payments → settle Salary Payable', kind: 'update', id: v.id, before: v, amount: num(v.amount), title: `${v.voucherNumber} · ${v.date}`,
      detail: `${(v.narration || '').slice(0, 70)} — now an expense in 5110; the expense comes from the slip journals, so this pays 2150 Salary Payable.`,
      fields: { accountLines: [{ ...al[0], accountCode: '2150', description: al[0].description || 'Salary paid (settles the salary slips)' }] } })
  }

  // 3. Wayzim recharge invoices
  for (const i of raw?.invoices || []) {
    if (i.status === 'cancelled' || i.revenueAccountCode || !/wayzim/i.test(`${i.billToName || ''} ${i.customerName || ''}`)) continue
    out.push({ key: 'inv' + i.id, group: 'Wayzim invoices → EOR ledger', kind: 'invoice', id: i.id, amount: num(i.total), title: `${i.invoiceNumber} · ${i.invoiceDate}`,
      detail: 'Zoho credits this recharge invoice to the Business EOR Purchase Services ledger, not to Sales.', fields: { revenueAccountCode: '2160' } })
  }
  // 4. bills of EOR staff costs → the EOR ledger
  for (const v of raw?.vouchers || []) {
    if (v.voucherType !== 'purchase' || v.status === 'cancelled') continue
    const eff = (i) => i.accountCode || v.purchaseAccountCode
    if (!(v.items || []).some(i => eff(i) === '5105')) continue
    out.push({ key: 'bill' + v.id, group: 'EOR staff-cost bills → EOR ledger', kind: 'update', id: v.id, before: v, amount: num(v.total), title: `${v.voucherNumber} · ${v.date} · ${v.partyName}`,
      detail: 'Zoho debits this bill to the Business EOR Purchase Services ledger (it is recharged to Wayzim), not to an expense.',
      fields: { items: v.items.map(i => (eff(i) === '5105' ? { ...i, accountCode: '2160' } : i)), ...(v.purchaseAccountCode === '5105' ? { purchaseAccountCode: '2160' } : {}) } })
  }
  return out
}
