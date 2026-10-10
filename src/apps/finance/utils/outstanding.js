// Bill-wise outstanding & ageing (Tally "Outstandings → Receivables/Payables").
//
// Works purely off the derived GL lines: every line on the Receivable (1200) or
// Payable (2100) control account is tagged with a party, and either creates a
// bill (billKey set, on the bill side) or settles one (opposite side).
//
// Settlement rules, in order:
//   1. A settling line with `allocatesTo` matching a bill reduces that bill first
//      (explicit "against reference" allocation, as in a Tally receipt voucher).
//   2. Anything left over — on-account receipts, legacy order-linked receipts,
//      credit/debit notes without a reference — is applied FIFO to the oldest
//      unpaid bills of the same party (Tally's "on account" + auto-allocation).
//   3. If settlements exceed all bills, the rest is an unallocated advance.
import { num, r2, normName } from './financeConstants.js'
import { partyKeyOf } from './voucherEngine.js'

export const AGE_BUCKETS = [
  { key: 'notDue', label: 'Not due', from: -Infinity, to: 0 },
  { key: 'd1_30',  label: '1–30',    from: 1,   to: 30 },
  { key: 'd31_60', label: '31–60',   from: 31,  to: 60 },
  { key: 'd61_90', label: '61–90',   from: 61,  to: 90 },
  { key: 'd91_180', label: '91–180', from: 91,  to: 180 },
  { key: 'd180p',  label: '180+',    from: 181, to: Infinity },
]

const daysBetween = (fromStr, toStr) => {
  if (!fromStr || !toStr) return 0
  return Math.round((new Date(toStr + 'T00:00:00') - new Date(fromStr + 'T00:00:00')) / 86400000)
}
export const bucketOf = (daysOverdue) =>
  AGE_BUCKETS.find(b => daysOverdue >= b.from && daysOverdue <= b.to) || AGE_BUCKETS[AGE_BUCKETS.length - 1]

export function computeOutstanding(allLines, { kind, company, asOf, ageBy = 'due' } = {}) {
  const control = kind === 'payable' ? '2100' : '1200'
  const billSide = kind === 'payable' ? 'credit' : 'debit'   // which side creates a bill
  const settleSide = billSide === 'debit' ? 'credit' : 'debit'

  const lines = allLines.filter(l =>
    l.accountCode === control &&
    (!company || l.company === company) &&
    (!asOf || (l.date || '') <= asOf))

  const parties = {}
  const ensure = (l) => {
    const key = partyKeyOf(l.partyId, l.partyName) || '(no party)'
    if (!parties[key]) parties[key] = { key, name: l.partyName || '(no party)', partyId: l.partyId || '', bills: [], settlements: [] }
    if (l.partyName) parties[key].name = l.partyName
    if (l.partyId && !parties[key].partyId) parties[key].partyId = l.partyId
    return parties[key]
  }

  lines.forEach(l => {
    const p = ensure(l)
    const amt = num(l[billSide])        // positive when this line is on the bill side
    const opp = num(l[settleSide])      // positive when on the settling side
    if (amt > 0) {
      p.bills.push({
        billKey: l.billKey || `${l.sourceType}:${l.sourceId}`,
        docNo: l.billRef || l.sourceDocNumber || '', externalRef: l.externalRef || '',
        sourceType: l.sourceType, sourceId: l.sourceId,
        date: l.date, dueDate: l.dueDate || l.date, original: r2(amt), pending: r2(amt),
      })
    }
    if (opp > 0) {
      p.settlements.push({
        date: l.date, amount: r2(opp), allocatesTo: l.allocatesTo || '', docNo: l.sourceDocNumber, sourceType: l.sourceType,
      })
    }
  })

  const result = []
  const totals = { total: 0, advance: 0, ...Object.fromEntries(AGE_BUCKETS.map(b => [b.key, 0])) }

  Object.values(parties).forEach(p => {
    p.bills.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const byKey = {}
    p.bills.forEach(b => { byKey[b.billKey] = b })

    // 1. explicit allocations
    const pool = []
    p.settlements.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    p.settlements.forEach(s => {
      let remaining = s.amount
      const target = s.allocatesTo && byKey[s.allocatesTo]
      if (target && target.pending > 0) {
        const use = Math.min(target.pending, remaining)
        target.pending = r2(target.pending - use)
        remaining = r2(remaining - use)
      }
      if (remaining > 0.004) pool.push({ ...s, amount: remaining })
    })

    // 2. FIFO the leftover over oldest unpaid bills
    let advance = 0
    pool.forEach(s => {
      let remaining = s.amount
      for (const b of p.bills) {
        if (remaining <= 0.004) break
        if (b.pending <= 0) continue
        const use = Math.min(b.pending, remaining)
        b.pending = r2(b.pending - use)
        remaining = r2(remaining - use)
      }
      if (remaining > 0.004) advance = r2(advance + remaining)   // 3. unallocated
    })

    const open = p.bills.filter(b => b.pending > 0.004).map(b => {
      const refDate = ageBy === 'bill' ? b.date : b.dueDate
      const daysOverdue = daysBetween(refDate, asOf)
      return { ...b, daysOverdue, bucket: bucketOf(daysOverdue).key }
    })
    const buckets = Object.fromEntries(AGE_BUCKETS.map(b => [b.key, 0]))
    open.forEach(b => { buckets[b.bucket] = r2(buckets[b.bucket] + b.pending) })
    const totalPending = r2(open.reduce((s, b) => s + b.pending, 0))
    if (totalPending < 0.005 && advance < 0.005) return

    result.push({ key: p.key, name: p.name, partyId: p.partyId, bills: open, buckets, totalPending, advance, net: r2(totalPending - advance) })
    totals.total = r2(totals.total + totalPending)
    totals.advance = r2(totals.advance + advance)
    AGE_BUCKETS.forEach(b => { totals[b.key] = r2(totals[b.key] + buckets[b.key]) })
  })

  result.sort((a, b) => b.totalPending - a.totalPending)
  return { parties: result, totals }
}

// Pending bills for one party — feeds the "allocate against bills" picker on
// Receipt / Payment vouchers.
export function pendingBillsForParty(allLines, { kind, company, partyName, partyId, asOf }) {
  const { parties } = computeOutstanding(allLines, { kind, company, asOf })
  const key = partyKeyOf(partyId, partyName)
  const p = parties.find(x => x.key === key || (partyId && x.partyId === partyId) || normName(x.name) === normName(partyName))
  return p ? p.bills : []
}
