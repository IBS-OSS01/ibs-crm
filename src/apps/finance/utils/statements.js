// Ledger statements: a Tally "Ledger Vouchers" view over derived GL lines.
// Balances are signed debit-positive internally; the UI renders them as Dr/Cr.
import { num, r2 } from './financeConstants.js'

export const docKey = (l) => `${l.sourceType}:${l.sourceId}`

export function groupBySource(lines) {
  const m = new Map()
  lines.forEach(l => {
    const k = docKey(l)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(l)
  })
  return m
}

// The "particulars" column in Tally shows the *other* side of each entry.
export function counterParticulars(line, groups) {
  const peers = groups.get(docKey(line)) || []
  const names = []
  peers.forEach(p => {
    if (p === line) return
    if (p.accountCode === line.accountCode && p.partyName === line.partyName) return
    // Ignore tax / rounding noise when there is a more meaningful counter-account.
    const label = p.partyName || p.accountName
    if (label && !names.includes(label)) names.push(label)
  })
  const significant = names.filter(n => !/GST|Rounding|TDS/i.test(n))
  return (significant.length ? significant : names).slice(0, 3).join(', ') || line.description || ''
}

// match(line) → boolean picks the lines that belong to this ledger.
export function ledgerStatement(lines, { match, company, from, to, openingExtra = 0 }) {
  const groups = groupBySource(lines)
  const mine = lines
    .filter(l => (!company || l.company === company) && match(l))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  let opening = r2(openingExtra)
  const inRange = []
  mine.forEach(l => {
    const signed = num(l.debit) - num(l.credit)
    if (from && (l.date || '') < from) opening = r2(opening + signed)
    else if (!to || (l.date || '') <= to) inRange.push(l)
  })

  let running = opening
  let totalDebit = 0, totalCredit = 0
  const rows = inRange.map(l => {
    running = r2(running + num(l.debit) - num(l.credit))
    totalDebit = r2(totalDebit + num(l.debit))
    totalCredit = r2(totalCredit + num(l.credit))
    return {
      date: l.date, sourceType: l.sourceType, sourceId: l.sourceId, docNo: l.billRef && l.sourceType === 'opening' ? l.billRef : l.sourceDocNumber,
      particulars: counterParticulars(l, groups), narration: l.description,
      debit: num(l.debit), credit: num(l.credit), balance: running,
    }
  })
  return { opening, rows, totalDebit, totalCredit, closing: running }
}

// Tally's month-by-month summary (Debit, Credit, Closing balance per month),
// from the Indian FY start month onward.
export function monthlySummary(rows, opening = 0) {
  const byMonth = {}
  rows.forEach(r => {
    const m = (r.date || '').slice(0, 7)
    if (!m) return
    byMonth[m] = byMonth[m] || { month: m, debit: 0, credit: 0 }
    byMonth[m].debit = r2(byMonth[m].debit + r.debit)
    byMonth[m].credit = r2(byMonth[m].credit + r.credit)
  })
  let bal = opening
  return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).map(m => {
    bal = r2(bal + m.debit - m.credit)
    return { ...m, closing: bal }
  })
}
