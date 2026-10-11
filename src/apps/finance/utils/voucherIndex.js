// One flat, uniform list of every accounting voucher across all collections —
// the data behind the Day Book (and the register pages). Each source collection
// keeps its own shape; this just normalises them for listing.
import { num, r2 } from './financeConstants.js'
import { isAccountingInvoice } from './ledger.js'

export function buildVoucherIndex({ invoices = [], payments = [], orders = [], expenses = [], payables = [], journalEntries = [], vouchers = [] }) {
  const out = []
  const orderById = Object.fromEntries(orders.map(o => [o.id, o]))

  invoices.forEach(i => {
    if (!i.invoiceDate) return
    const memo = !isAccountingInvoice(i)
    out.push({
      key: `invoice:${i.id}`, lineKey: `invoice:${i.id}`, kind: memo ? 'memo' : 'sales', date: i.invoiceDate, number: i.invoiceNumber || i.id,
      partyName: i.billToName || '', amount: r2(num(i.total)), company: i.company || 'UIPL',
      narration: i.notes || '', collection: 'finance_invoices', id: i.id, memo,
      memoLabel: i.invoiceType === 'PI' ? 'Pro-forma Invoice' : i.invoiceType === 'SO' ? 'Sales Order' : '',
      status: i.status || '', taxable: r2(num(i.subTotal)),
      ...(i.fx?.currency && i.fx.currency !== 'INR' ? { fcNote: `${i.fx.currency} ${num(i.fx.total).toFixed(2)} @ ${i.fx.rate}` } : {}),
    })
  })

  payments.forEach(p => {
    if (!p.date || !num(p.amount)) return
    const order = p.orderId ? orderById[p.orderId] : null
    out.push({
      key: `payment:${p.id}`, lineKey: `receipt:${p.id}`, kind: 'receipt', date: p.date, number: p.orderRef || p.id.slice(0, 8),
      partyName: p.customerName || '', amount: r2(num(p.amount)), company: order?.company || 'UIPL', companyInferred: !order,
      narration: [p.method, p.notes].filter(Boolean).join(' · '), collection: 'finance_payments', id: p.id, legacy: true,
    })
  })

  expenses.forEach(e => {
    if (!e.date || !num(e.amount)) return
    out.push({
      key: `expense:${e.id}`, lineKey: `expense:${e.id}`, kind: 'expense', date: e.date, number: e.category || 'Expense',
      partyName: e.vendor || '', amount: r2(num(e.amount)), company: 'UIPL', companyInferred: true,
      narration: e.description || '', collection: 'finance_expenses', id: e.id, legacy: true,
    })
  })

  payables.forEach(p => {
    if (num(p.amount) && p.invoiceDate) {
      out.push({
        key: `payable:${p.id}`, lineKey: `payable:${p.id}`, kind: 'purchase', date: p.invoiceDate, number: p.invoiceRef || p.id.slice(0, 8),
        partyName: p.vendor || '', amount: r2(num(p.amount)), company: 'UIPL', companyInferred: true,
        narration: p.description || '', collection: 'finance_payables', id: p.id, legacy: true, status: p.status || '',
      })
    }
    if (p.status === 'paid' && p.paidOn && num(p.amount)) {
      out.push({
        key: `payable-pay:${p.id}`, lineKey: `payable:${p.id}`, kind: 'payment', date: p.paidOn, number: p.invoiceRef || p.id.slice(0, 8),
        partyName: p.vendor || '', amount: r2(num(p.amount)), company: 'UIPL', companyInferred: true,
        narration: 'Payment against bill', collection: 'finance_payables', id: p.id, legacy: true,
      })
    }
  })

  journalEntries.forEach(j => {
    if (!j.date) return
    const amt = r2((j.lines || []).reduce((s, l) => s + num(l.debit), 0))
    out.push({
      key: `journal:${j.id}`, lineKey: `manual:${j.id}`, kind: 'journal', date: j.date, number: j.reference || j.id,
      partyName: '', amount: amt, company: j.company || 'UIPL', narration: j.memo || '',
      collection: 'finance_journal_entries', id: j.id,
    })
  })

  vouchers.forEach(v => {
    if (!v.date) return
    let amount = r2(num(v.total))
    if (v.voucherType === 'payment') {
      const accSum = (v.accountLines || []).reduce((s, l) => s + num(l.amount), 0)
      amount = r2(num(v.partyAmount) + accSum - (v.tds?.applicable ? num(v.tds.amount) : 0))
    } else if (v.voucherType === 'receipt') {
      const accSum = (v.accountLines || []).reduce((s, l) => s + num(l.amount), 0)
      amount = r2(num(v.partyAmount) - (v.tdsReceivable?.applicable ? num(v.tdsReceivable.amount) : 0) + accSum)
    } else if (v.voucherType === 'contra') amount = r2(num(v.amount))
    // foreign-currency settlement: show the rupees that really moved through the bank
    if (['payment', 'receipt'].includes(v.voucherType) && v.bankAmountInr !== undefined && v.bankAmountInr !== null && v.bankAmountInr !== '') amount = r2(num(v.bankAmountInr))
    const fc = v.currency && v.currency !== 'INR' && num(v.fxRate) > 0
    const fcNote = !fc ? '' : v.fc ? `${v.currency} ${num(v.fc.total).toFixed(2)} @ ${v.fxRate}` : `${v.currency} @ ${v.fxRate}`
    out.push({
      key: `voucher:${v.id}`, lineKey: `${v.voucherType}:${v.id}`, kind: v.voucherType, date: v.date, number: v.voucherNumber,
      partyName: v.partyName || (v.voucherType === 'contra' ? `${v.fromAccountName || ''} → ${v.toAccountName || ''}` : ''),
      amount, company: v.company || 'UIPL', narration: v.narration || '',
      collection: 'finance_vouchers', id: v.id, status: v.status === 'cancelled' ? 'cancelled' : '', cancelled: v.status === 'cancelled',
      taxable: r2(num(v.subTotal)), refNumber: v.refNumber || '', voucherType: v.voucherType, ...(fcNote ? { fcNote } : {}),
      ...(v.voucherType === 'purchase_order' ? { memo: true, memoLabel: 'Purchase Order' } : {}),
    })
  })

  return out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number)))
}
