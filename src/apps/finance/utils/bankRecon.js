// Bank reconciliation helpers — parse a bank statement, propose matches against the
// bank-book entries, and compute the reconciliation statement. Pure functions.
import { num, r2 } from './financeConstants.js'

const iso = (v) => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const s = String(v ?? '').trim()
  let m = /^(\d{1,2})[-/. ]([A-Za-z]{3}|\d{1,2})[-/. ](\d{2,4})$/.exec(s)
  if (m) {
    const month = /^\d+$/.test(m[2]) ? Number(m[2]) : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()) + 1
    if (!month) return ''
    const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return `${yr}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}
const money = (v) => { const n = Number(String(v ?? '').replace(/[, ₹]/g, '').replace(/\((.*)\)/, '-$1')); return Number.isFinite(n) ? n : 0 }

// rows: array of arrays (first matching header row is used) → statement lines
export function parseBankStatement(matrix) {
  const hdrIdx = matrix.findIndex(r => r.some(c => /date/i.test(String(c))) && r.some(c => /(narration|description|particulars|remarks|details)/i.test(String(c))))
  if (hdrIdx < 0) return { lines: [], error: 'Could not find a header row with a Date column and a Narration / Description column.' }
  const head = matrix[hdrIdx].map(c => String(c).trim().toLowerCase())
  const find = (re, skip = []) => head.findIndex((h, i) => re.test(h) && !skip.includes(i))
  const dateI = find(/date/), descI = find(/(narration|description|particulars|remarks|details)/)
  const refI = find(/(chq|cheque|ref|utr|instrument)/, [dateI, descI])
  const balI = find(/balance/)
  let debitI = find(/(withdraw|debit|\bdr\b|paid out)/, [dateI, descI, balI]), creditI = find(/(deposit|credit|\bcr\b|paid in)/, [dateI, descI, balI])
  const amtI = (debitI < 0 && creditI < 0) ? find(/amount/, [dateI, descI, balI]) : -1
  const typeI = amtI >= 0 ? find(/(dr\/cr|type|cr\/dr)/, [amtI]) : -1
  const lines = []
  for (const r of matrix.slice(hdrIdx + 1)) {
    const date = iso(r[dateI]); if (!date) continue
    let debit = 0, credit = 0
    if (amtI >= 0) { const a = money(r[amtI]); const t = String(r[typeI] ?? '').toLowerCase(); if (a < 0 || /^d/.test(t)) debit = Math.abs(a); else credit = Math.abs(a) }
    else { debit = Math.abs(money(r[debitI])); credit = Math.abs(money(r[creditI])) }
    if (!debit && !credit) continue
    lines.push({ date, description: String(r[descI] ?? '').trim(), ref: refI >= 0 ? String(r[refI] ?? '').trim() : '', debit: r2(debit), credit: r2(credit), balance: balI >= 0 && r[balI] !== '' ? money(r[balI]) : null })
  }
  return { lines }
}

export const stmtSig = (l) => `${l.date}|${l.debit}|${l.credit}|${(l.ref || '').toLowerCase()}|${(l.description || '').toLowerCase().slice(0, 60)}`

// Bank-book entries (the 1100 lines of the chosen bank) with a stable key.
export function bookEntries(allLines, { company, bankAccountId }) {
  const seen = {}
  return allLines.filter(l => l.accountCode === '1100' && l.company === company && (bankAccountId ? l.bankAccountId === bankAccountId : !l.bankAccountId))
    .map(l => {
      const base = `${l.sourceType}:${l.sourceId}|${l.debit}|${l.credit}`
      seen[base] = (seen[base] || 0) + 1
      return { key: `${base}|${seen[base]}`, date: l.date, number: l.sourceDocNumber, party: l.partyName || l.description || '', debit: num(l.debit), credit: num(l.credit), opening: l.sourceType === 'opening', ref: '' }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

const dayDiff = (a, b) => Math.abs(Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000))

// Propose matches: same amount and direction, within `window` days; closest date wins.
export function autoMatch(statement, entries, { window = 7 } = {}) {
  const taken = new Set(statement.filter(s => s.matchedKey).map(s => s.matchedKey))
  const free = entries.filter(e => !e.opening && !taken.has(e.key))
  const proposals = []
  statement.filter(s => !s.matchedKey).sort((a, b) => a.date.localeCompare(b.date)).forEach(s => {
    const cands = free.filter(e => !taken.has(e.key) && (s.credit ? Math.abs(e.debit - s.credit) < 0.005 : Math.abs(e.credit - s.debit) < 0.005) && (s.credit ? e.debit > 0 : e.credit > 0) && dayDiff(e.date, s.date) <= window)
    if (!cands.length) return
    cands.sort((a, b) => dayDiff(a.date, s.date) - dayDiff(b.date, s.date))
    taken.add(cands[0].key); proposals.push({ statementId: s.id, key: cands[0].key })
  })
  return proposals
}

export function reconciliation(statement, entries, asOf) {
  const matchedKeys = new Map(statement.filter(s => s.matchedKey).map(s => [s.matchedKey, s]))
  const bookBalance = r2(entries.filter(e => e.date <= asOf).reduce((s, e) => s + e.debit - e.credit, 0))
  const uncleared = entries.filter(e => !e.opening && e.date <= asOf && (!matchedKeys.has(e.key) || matchedKeys.get(e.key).date > asOf))
  const depositsInTransit = r2(uncleared.reduce((s, e) => s + e.debit, 0)), chequesOutstanding = r2(uncleared.reduce((s, e) => s + e.credit, 0))
  const bankOnly = statement.filter(s => !s.matchedKey && s.date <= asOf)
  const bankOnlyNet = r2(bankOnly.reduce((s, l) => s + l.credit - l.debit, 0))
  const expected = r2(bookBalance - depositsInTransit + chequesOutstanding + bankOnlyNet)
  const withBal = statement.filter(s => s.date <= asOf && s.balance !== null && s.balance !== undefined).sort((a, b) => a.date.localeCompare(b.date) || (a.importedAt || '').localeCompare(b.importedAt || '') || (a.seq || 0) - (b.seq || 0))
  const stmtBalance = withBal.length ? withBal[withBal.length - 1].balance : null
  return { bookBalance, depositsInTransit, chequesOutstanding, bankOnly, bankOnlyNet, expected, stmtBalance, difference: stmtBalance === null ? null : r2(stmtBalance - expected), uncleared }
}
