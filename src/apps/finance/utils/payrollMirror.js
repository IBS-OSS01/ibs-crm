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
//   3. the Wayzim recharge invoices: salary + expense lines → credit the EOR ledger (2160), administration fee stays Sales
//   5. PF paid in Jun-Sep 2026 that was booked as a transfer to the director (2910); Zoho has them as Provident Fund payments (2610)
//   6. TDS paid in 2025 through the director ("TDS DEBT RETURN" ₹1,20,418 on 15 Sep, "TDS REFUND" ₹3,400 on 7 May) → TDS Payable, as Zoho journals 171 and 181
//   7. Pluxee meal-voucher loads ("face value", booked to Travel): the salary slips already charge the meal allowance and credit a liability (2630); paying Pluxee clears it
//   8. Zoho journal 354 (8 Aug 2025): the annual PTEC / PTRC ₹10,000 is accrued (Dr Duties & Taxes, Cr Professional Tax) before the four ₹2,500 payments
//   9. three ₹4,400 Sodexo meal reimbursements of 3 Jun 2025 (Zoho journals 194-196, accrued through the slips) → settle Salary Payable
//  10. ₹10,909 received back from an employee on 2 Sep 2026 (Zoho journal 496, "extra return" of August salary) → credit Salary Payable
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
    if (i.status === 'cancelled' || i.revenueSplit || !/wayzim/i.test(`${i.billToName || ''} ${i.customerName || ''}`)) continue
    const its = i.items || []
    if (!its.some(x => /^EOR EMPLOYEE SALARIES/i.test(x.description || ''))) continue          // only the monthly recharge invoices, not other sales to Wayzim
    const line = (x) => r2(num(x.taxable) || num(x.amount) || num(x.qty || 1) * num(x.rate))
    const eor = r2(its.filter(x => !/^administration fee/i.test(x.description || '')).reduce((t, x) => t + line(x), 0))
    const sub = r2(num(i.subTotal))
    if (!(eor > 0) || eor > sub + 0.01) continue
    const admin = r2(sub - eor)
    out.push({ key: 'inv' + i.id, group: 'Wayzim invoices → EOR ledger', kind: 'invoice', id: i.id, amount: num(i.total), title: `${i.invoiceNumber} · ${i.invoiceDate}`,
      detail: `Zoho credits the salary and expense lines (₹${eor.toLocaleString('en-IN')}) to the Business EOR Purchase Services ledger; the administration fee (₹${admin.toLocaleString('en-IN')}) stays in Sales.`,
      fields: { revenueSplit: [{ accountCode: '2160', amount: eor }, ...(admin > 0 ? [{ accountCode: '4000', amount: admin }] : [])] } })
  }
  // 4. bills (and vendor credits) of EOR staff costs → the EOR ledger
  for (const v of raw?.vouchers || []) {
    if (!['purchase', 'debit_note'].includes(v.voucherType) || v.status === 'cancelled') continue
    const eff = (i) => i.accountCode || v.purchaseAccountCode
    if (!(v.items || []).some(i => eff(i) === '5105')) continue
    out.push({ key: 'bill' + v.id, group: 'EOR staff-cost bills → EOR ledger', kind: 'update', id: v.id, before: v, amount: num(v.total), title: `${v.voucherNumber} · ${v.date} · ${v.partyName}`,
      detail: 'Zoho debits this bill to the Business EOR Purchase Services ledger (it is recharged to Wayzim), not to an expense.',
      fields: { items: v.items.map(i => (eff(i) === '5105' ? { ...i, accountCode: '2160' } : i)), ...(v.purchaseAccountCode === '5105' ? { purchaseAccountCode: '2160' } : {}) } })
  }
  // 8. annual professional tax accrued in Zoho (journal 354)
  if (!have.has('ZB-JV-354')) {
    out.push({ key: 'ZB-JV-354', group: 'Other payroll items from Zoho', kind: 'journal', amount: 10000, title: '2025-08-08 · Zoho journal 354',
      detail: 'PTEC and PTRC annual professional tax — Duties & Taxes (expense) Dr 10,000 · Professional Tax payable (2630) Cr 10,000. Our books have the four ₹2,500 payments but not this accrual.',
      data: { reference: 'ZB-JV-354', date: '2025-08-08', company: 'UIPL', memo: 'Zoho Books journal 354 — PTEC and PTRC Annual', sourceType: 'zoho-import', status: 'posted',
        lines: [{ accountCode: '5900', accountName: 'Miscellaneous Expenses', debit: 10000, credit: 0, description: 'PTEC / PTRC annual (Zoho: Duties & Taxes)' }, { accountCode: '2630', accountName: NAMES[2630], debit: 0, credit: 10000, description: 'PTEC / PTRC annual' }] } })
  }
  // 9. Sodexo meal reimbursements paid in June 2025 · 10. salary returned in Sept 2026
  const SODEXO = { 'UIPL/PAY/25-26/196': 4400, 'UIPL/PAY/25-26/197': 4400, 'UIPL/PAY/25-26/198': 4400 }
  for (const v of raw?.vouchers || []) {
    if (v.status === 'cancelled' || v.partyId) continue
    const al = v.accountLines || []
    if (v.voucherType === 'payment' && SODEXO[v.voucherNumber] && Math.abs(num(v.amount) - SODEXO[v.voucherNumber]) < 0.5 && al.length === 1 && al[0].accountCode !== '2150') {
      out.push({ key: 'sdx' + v.id, group: 'Other payroll items from Zoho', kind: 'update', id: v.id, before: v, amount: num(v.amount), title: `${v.voucherNumber} · ${v.date}`,
        detail: `${(v.narration || '').slice(0, 60)} — a meal reimbursement to staff; the salary slips already carry it (Zoho journals 194-196), so this pays Salary Payable, not ${al[0].accountCode}.`,
        fields: { accountLines: [{ ...al[0], accountCode: '2150', description: 'Sodexo meal reimbursement paid' }] } })
    }
    if (v.voucherType === 'receipt' && v.voucherNumber === 'UIPL/RCT/26-27/026' && Math.abs(num(v.amount) - 10909) < 0.5 && al.length === 1 && al[0].accountCode !== '2150') {
      out.push({ key: 'ret' + v.id, group: 'Other payroll items from Zoho', kind: 'update', id: v.id, before: v, amount: num(v.amount), title: `${v.voucherNumber} · ${v.date}`,
        detail: `${(v.narration || '').slice(0, 40)} — Zoho journal 496 books this ₹10,909 as an extra August salary paid out and returned (Salary Payable), not as money from the director.`,
        fields: { accountLines: [{ ...al[0], accountCode: '2150', description: 'Salary returned (extra payment)' }] } })
    }
  }

  // 7. Pluxee face-value loads → clear the meal-allowance liability
  for (const v of raw?.vouchers || []) {
    if (v.voucherType !== 'purchase' || v.status === 'cancelled' || !/pluxee|sodexo|sedexo/i.test(v.partyName || '')) continue
    const hit = (i) => /face value/i.test(i.description || '') && ((i.accountCode || v.purchaseAccountCode) !== '2630')
    if (!(v.items || []).some(hit)) continue
    out.push({ key: 'meal' + v.id, group: 'Meal-voucher loads → Meal allowance liability', kind: 'update', id: v.id, before: v, amount: num(v.total), title: `${v.voucherNumber} · ${v.date} · ${v.partyName}`,
      detail: 'The face value loaded on the cards is already charged through the salary slips (credit: meal allowance, 2630); Zoho debits that liability here, not an expense.',
      fields: { items: v.items.map(i => (hit(i) ? { ...i, accountCode: '2630' } : i)) } })
  }

  // 6. TDS paid through the director's account
  const TDS = { 'UIPL/PAY/25-26/206': 120418, 'UIPL/PAY/25-26/191': 3400 }
  for (const v of raw?.vouchers || []) {
    if (v.voucherType !== 'payment' || v.status === 'cancelled' || v.partyId || !TDS[v.voucherNumber] || Math.abs(num(v.amount) - TDS[v.voucherNumber]) > 0.5) continue
    const al = v.accountLines || []
    if (al.length !== 1 || al[0].accountCode !== '2910') continue
    out.push({ key: 'tds' + v.id, group: 'TDS payments booked to the director → TDS Payable', kind: 'update', id: v.id, before: v, amount: num(v.amount), title: `${v.voucherNumber} · ${v.date}`,
      detail: `${(v.narration || '').slice(0, 60)} — Zoho books this ₹${num(v.amount).toLocaleString('en-IN')} as a TDS payment (TDS Payable), not a transfer to the director.`,
      fields: { accountLines: [{ ...al[0], accountCode: '2500', description: 'TDS paid' }] } })
  }

  // 5. PF payments booked to the director's account
  const PF = { 'UIPL/PAY/26-27/095': 151316, 'UIPL/PAY/26-27/103': 152223, 'UIPL/PAY/26-27/107': 152083, 'UIPL/PAY/26-27/111': 137279 }
  for (const v of raw?.vouchers || []) {
    if (v.voucherType !== 'payment' || v.status === 'cancelled' || v.partyId || !PF[v.voucherNumber] || Math.abs(num(v.amount) - PF[v.voucherNumber]) > 0.5) continue
    const al = v.accountLines || []
    if (al.length !== 1 || al[0].accountCode !== '2910') continue
    out.push({ key: 'pf' + v.id, group: 'PF payments booked to the director → PF Payable', kind: 'update', id: v.id, before: v, amount: num(v.amount), title: `${v.voucherNumber} · ${v.date}`,
      detail: `${(v.narration || '').slice(0, 60)} — Zoho books this ₹${num(v.amount).toLocaleString('en-IN')} as a Provident Fund payment, not a transfer to the director.`,
      fields: { accountLines: [{ ...al[0], accountCode: '2610', description: 'Provident fund paid' }] } })
  }
  return out
}
