// Sales orders that are invoiced in parts. An order line has the quantity ordered, how much has been invoiced so far
// (invoicedQty) and how much was cancelled / closed (cancelledQty). Any number of invoices can be raised against one order —
// by quantity, or by an agreed percentage ("30% advance, 70% on completion") — until nothing is left to invoice.
import { computeVoucherTotals } from './taxCalc.js'
import { r2, num } from './financeConstants.js'

const q4 = (x) => Math.round((Number(x) || 0) * 10000) / 10000
export const remainingQty = (it) => Math.max(0, q4(num(it.qty) - num(it.invoicedQty) - num(it.cancelledQty)))

// → { state: 'draft' | 'open' | 'partial' | 'invoiced' | 'closed', ordered, invoiced, remaining, valueOrdered, valueInvoiced }
export function orderProgress(order) {
  const items = order.items || []
  const ordered = q4(items.reduce((s, i) => s + num(i.qty), 0))
  const invoiced = q4(items.reduce((s, i) => s + num(i.invoicedQty), 0))
  const remaining = q4(items.reduce((s, i) => s + remainingQty(i), 0))
  const cancelled = q4(items.reduce((s, i) => s + num(i.cancelledQty), 0))
  const valueOf = (f) => r2(items.reduce((s, i) => s + f(i) * num(i.rate), 0))
  let state
  if (order.status === 'draft') state = 'draft'
  else if (remaining <= 0.00005) state = cancelled > 0 ? 'closed' : 'invoiced'      // nothing left: billed in full, or the rest was cancelled
  else state = invoiced > 0 ? 'partial' : 'open'
  return { state, ordered, invoiced, remaining, cancelled, valueOrdered: valueOf(i => num(i.qty)), valueInvoiced: valueOf(i => num(i.invoicedQty)) }
}

// quantity to bill per line for a percentage of the ORDER (30 → 30% of each ordered quantity, but never more than what is left)
export const qtysForPercent = (order, pct) => (order.items || []).map(it => Math.min(remainingQty(it), q4(num(it.qty) * pct / 100)))
export const qtysForBalance = (order) => (order.items || []).map(remainingQty)

// the tax invoice for the chosen quantities: same lines, rates, place of supply; GST and rounding as the invoice form does
export function invoiceFromOrder(order, qtys, { sellerStateCode = '' } = {}) {
  const lines = (order.items || []).map((it, i) => ({ ...it, qty: q4(qtys[i]) })).filter(it => it.qty > 0)
    .map(({ invoicedQty, cancelledQty, ...it }) => ({ ...it, discountPct: 0 }))
  const posCode = order.isExport && order.exportType !== 'WOPAY' ? '96' : order.posStateCode
  const applyGst = order.applyGst !== false && !(order.isExport && order.exportType === 'WOPAY')
  const supplyType = (!order.isExport && sellerStateCode && posCode && sellerStateCode === posCode) ? 'intra' : 'inter'
  const t = computeVoucherTotals(lines, { supplyType, applyGst, rounding: true })
  return { items: t.items.map(({ taxable, cgst, sgst, igst, lineTax, lineTotal, discountPct, ...it }) => it), subTotal: t.subTotal, gstLines: t.gstLines, roundOff: t.roundOff, total: t.total, applyGst, supplyType }
}

// → { problem } or { items } — the order's lines after invoicing these quantities
export function applyInvoicing(order, qtys) {
  const items = (order.items || []).map((it, i) => {
    const q = q4(qtys[i])
    if (q < 0) throw new Error('A quantity cannot be negative.')
    if (q > remainingQty(it) + 0.00005) throw new Error(`“${String(it.description).slice(0, 40)}”: only ${remainingQty(it)} is left to invoice.`)
    return { ...it, invoicedQty: q4(num(it.invoicedQty) + q) }
  })
  return items
}

// close the order: whatever is left is cancelled
export const closeOrderItems = (order) => (order.items || []).map(it => ({ ...it, cancelledQty: q4(num(it.cancelledQty) + remainingQty(it)) }))

export const ORDER_STATE_LABEL = { draft: 'Draft', open: 'Open', partial: 'Partly invoiced', invoiced: 'Invoiced', closed: 'Closed' }
