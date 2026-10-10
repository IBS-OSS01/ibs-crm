// Purchase-order tracking: which lines of an order have been billed.
// A Purchase voucher created from an order ("Create bill") records
// purchaseOrderId and, per line, poLine = the order line's index.
import { num, r2 } from './financeConstants.js'

export function poProgress(po, vouchers = []) {
  const bills = vouchers.filter(v => v.voucherType === 'purchase' && v.status !== 'cancelled' && v.purchaseOrderId === po.id)
  const lines = (po.items || []).map((item, index) => {
    const billed = r2(bills.reduce((s, b) => s + (b.items || []).filter(i => i.poLine === index).reduce((q, i) => q + num(i.qty), 0), 0))
    const ordered = num(item.qty)
    return { index, item, ordered, billed, pending: Math.max(0, r2(ordered - billed)) }
  })
  const orderedTotal = lines.reduce((s, l) => s + l.ordered, 0)
  const billedTotal = lines.reduce((s, l) => s + Math.min(l.billed, l.ordered), 0)
  let status = 'open'
  if (po.status === 'cancelled') status = 'cancelled'
  else if (po.closed || (orderedTotal > 0 && billedTotal >= orderedTotal - 0.0001)) status = 'closed'
  else if (billedTotal > 0) status = 'partial'
  return { lines, status, bills, orderedTotal, billedTotal, pendingValue: r2(lines.reduce((s, l) => s + l.pending * num(l.item.rate) * (1 - num(l.item.discountPct) / 100), 0)) }
}

export const pendingPoLines = (po, vouchers) => poProgress(po, vouchers).lines.filter(l => l.pending > 0)
