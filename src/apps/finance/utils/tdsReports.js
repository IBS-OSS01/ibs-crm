// TDS compliance reports — deduction register, monthly liability vs deposit, late-deposit
// interest estimate, quarterly statement data, deductee certificate data, and the
// TDS-receivable (tax deducted by customers) register. Pure functions.
//
// ⚠ Rates, due dates and the interest formula follow the long-standing TDS rules
// (deposit by the 7th of the next month — 30 April for March; quarterly statements by
// 31 Jul / 31 Oct / 31 Jan / 31 May; interest 1.5% per month or part month on late
// deposit; fee ₹200/day up to the TDS amount for late statements). The Income-tax Act,
// 2025 renumbered the sections but, as far as published, kept these timelines. Treat
// every figure as a working estimate for the CA to confirm.
import { num, r2, fyOf } from './financeConstants.js'

export const fyStartYear = (fy) => 2000 + Number(fy.slice(0, 2))
export const fyMonths = (fy) => {
  const y = fyStartYear(fy)
  return [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map(m => `${m >= 4 ? y : y + 1}-${String(m).padStart(2, '0')}`)
}
export const QUARTERS = [
  { q: 'Q1', label: 'Apr–Jun', months: [4, 5, 6] }, { q: 'Q2', label: 'Jul–Sep', months: [7, 8, 9] },
  { q: 'Q3', label: 'Oct–Dec', months: [10, 11, 12] }, { q: 'Q4', label: 'Jan–Mar', months: [1, 2, 3] },
]
export const quarterOfMonth = (ym) => QUARTERS.find(q => q.months.includes(Number(ym.slice(5, 7))))?.q
export const returnDueDate = (fy, q) => {
  const y = fyStartYear(fy)
  return { Q1: `${y}-07-31`, Q2: `${y}-10-31`, Q3: `${y + 1}-01-31`, Q4: `${y + 1}-05-31` }[q]
}
// Deposit due date for tax deducted in month `ym`: 7th of next month; 30 April for March.
export const depositDueDate = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  if (m === 3) return `${y}-04-30`
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}-07`
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
// whole months or part thereof between two dates (part month counts as a full month)
export const monthsLate = (from, to) => {
  if (!from || !to || to <= from) return 0
  const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number)
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + (d2 > d1 ? 1 : 0))
}

// ── deductions ──────────────────────────────────────────────────────────────
export function deductionRows(vouchers = [], vendors = [], { company, from, to } = {}) {
  const vendorById = Object.fromEntries(vendors.map(v => [v.id, v]))
  const out = []
  vouchers.forEach(v => {
    if (v.status === 'cancelled' || !v.date || !v.tds?.applicable || !num(v.tds.amount)) return
    if (!['purchase', 'payment'].includes(v.voucherType)) return
    if (company && v.company !== company) return
    if (from && v.date < from) return
    if (to && v.date > to) return
    const vend = vendorById[v.partyId]
    out.push({
      key: `voucher:${v.id}`, voucherId: v.id, voucherNo: v.voucherNumber, company: v.company || 'UIPL', kind: v.voucherType, date: v.date, month: v.date.slice(0, 7), fy: fyOf(v.date),
      partyId: v.partyId || '', partyName: v.partyName || '(no party)', pan: (vend?.pan || '').toUpperCase(),
      section: v.tds.section || '', base: r2(num(v.tds.base)), rate: num(v.tds.rate), amount: r2(num(v.tds.amount)),
    })
  })
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.voucherNo).localeCompare(String(b.voucherNo)))
}

// ── monthly liability vs deposits (+ interest estimate) ─────────────────────
export function monthlyPosition(deductions, challans = [], { company, fy, asOf }) {
  return fyMonths(fy).map(ym => {
    const ded = deductions.filter(d => d.company ? d.company === company : true).filter(d => d.month === ym).sort((a, b) => a.date.localeCompare(b.date))
    const ch = challans.filter(c => (!company || c.company === company) && c.forMonth === ym).sort((a, b) => (a.depositDate || '').localeCompare(b.depositDate || ''))
    const deducted = r2(ded.reduce((s, d) => s + d.amount, 0))
    const deposited = r2(ch.reduce((s, c) => s + num(c.tax), 0))
    const due = depositDueDate(ym)
    // FIFO: earliest deposit covers earliest deduction
    const slices = []
    let di = 0, dLeft = ded.length ? ded[0].amount : 0
    ch.forEach(c => {
      let rem = num(c.tax)
      while (rem > 0.004 && di < ded.length) {
        const use = Math.min(rem, dLeft)
        slices.push({ amount: use, dedDate: ded[di].date, depDate: c.depositDate })
        rem = r2(rem - use); dLeft = r2(dLeft - use)
        if (dLeft <= 0.004) { di++; dLeft = ded[di]?.amount || 0 }
      }
    })
    const pendingSlices = []
    while (di < ded.length) { pendingSlices.push({ amount: dLeft, dedDate: ded[di].date, depDate: asOf }); di++; dLeft = ded[di]?.amount || 0 }
    const interestFor = (s) => (s.depDate && s.depDate > due) ? r2(s.amount * 0.015 * monthsLate(s.dedDate, s.depDate)) : 0
    const interest = r2(slices.reduce((t, s) => t + interestFor(s), 0) + pendingSlices.reduce((t, s) => t + interestFor(s), 0))
    const pending = r2(deducted - deposited)
    let status = 'none'
    if (deducted > 0) status = pending <= 0.5 ? (ch.some(c => c.depositDate > due) ? 'paid-late' : 'paid') : (asOf > due ? 'overdue' : 'pending')
    return { month: ym, deducted, deposited, pending, due, status, interest, challans: ch, count: ded.length, interestPaid: r2(ch.reduce((s, c) => s + num(c.interest), 0)) }
  })
}

// ── quarterly statement data ────────────────────────────────────────────────
export function quarterData(deductions, challans, { company, fy, q }) {
  const months = QUARTERS.find(x => x.q === q).months.map(m => `${m >= 4 ? fyStartYear(fy) : fyStartYear(fy) + 1}-${String(m).padStart(2, '0')}`)
  const ded = deductions.filter(d => (!company || d.company === company) && months.includes(d.month) && d.fy === fy)
  const ch = challans.filter(c => (!company || c.company === company) && c.fy === fy && months.includes(c.forMonth))
  return { months, deductions: ded, challans: ch, totalDeducted: r2(ded.reduce((s, d) => s + d.amount, 0)), totalDeposited: r2(ch.reduce((s, c) => s + num(c.tax), 0)), due: returnDueDate(fy, q) }
}

// ₹200 per day of delay, capped at the TDS in the statement.
export function lateFee(totalTds, dueDate, filedOn) {
  if (!filedOn || filedOn <= dueDate) return 0
  return r2(Math.min(totalTds, 200 * daysBetween(dueDate, filedOn)))
}

// ── per-deductee totals (threshold tracking / certificate data) ─────────────
export function deducteeSummary(deductions) {
  const m = {}
  deductions.forEach(d => {
    const k = `${d.partyId || d.partyName}|${d.section}`
    m[k] = m[k] || { key: k, partyName: d.partyName, partyId: d.partyId, pan: d.pan, section: d.section, count: 0, base: 0, amount: 0 }
    m[k].count++; m[k].base = r2(m[k].base + d.base); m[k].amount = r2(m[k].amount + d.amount)
  })
  return Object.values(m).sort((a, b) => a.partyName.localeCompare(b.partyName) || a.section.localeCompare(b.section))
}

// ── TDS receivable (deducted by customers, claimable in the return) ─────────
export function receivableRows(vouchers = [], { company, from, to } = {}) {
  return vouchers.filter(v => v.voucherType === 'receipt' && v.status !== 'cancelled' && v.tdsReceivable?.applicable && num(v.tdsReceivable.amount) &&
    (!company || v.company === company) && (!from || v.date >= from) && (!to || v.date <= to))
    .map(v => ({ key: `voucher:${v.id}`, voucherId: v.id, voucherNo: v.voucherNumber, date: v.date, fy: fyOf(v.date), partyName: v.partyName, section: v.tdsReceivable.section || '', amount: r2(num(v.tdsReceivable.amount)), gross: r2(num(v.partyAmount)) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
