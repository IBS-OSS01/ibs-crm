// Shared constants + small pure helpers for the Tally-style accounting layer.
// Everything here is dependency-free so it can be unit-tested under plain Node
// (see scripts/test-finance.mjs).

export const COMPANIES = ['UIPL', 'Wayzim']

// ── Financial year helpers (Indian FY: 1 Apr – 31 Mar, shown as 'yy-yy') ──────
export const fyOf = (dateStr) => {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date()
  const y = d.getFullYear()
  const start = d.getMonth() >= 3 ? y : y - 1
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`
}
export const currentFY = () => fyOf(todayStr())
export const fyRange = (fy) => {
  const s = 2000 + Number(fy.slice(0, 2))
  return { from: `${s}-04-01`, to: `${s + 1}-03-31` }
}
export const fyList = (count = 6) => {
  const cur = 2000 + Number(currentFY().slice(0, 2))
  return Array.from({ length: count }, (_, i) => {
    const s = cur - i
    return `${String(s).slice(2)}-${String(s + 1).slice(2)}`
  })
}
// Local date (not toISOString, which is UTC and is a day behind in India before 05:30).
export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── GST rates ───────────────────────────────────────────────────────────────
// GST 2.0 (effective 22 Sep 2025) collapsed the structure to 0 / 5 / 18 with a
// 40% demerit rate; 3% (gold/silver) and 0.25% (rough diamonds) remain. The old
// 12% and 28% slabs are still valid for documents dated before the cut-over
// (e.g. a Credit Note raised now against an old invoice), so they're offered
// only for earlier dates.
export const GST_CUTOVER_DATE = '2025-09-22'
export const GST_RATES_CURRENT = [0, 0.25, 3, 5, 18, 40]
export const GST_RATES_LEGACY = [0, 0.25, 3, 5, 12, 18, 28, 40]
export const gstRatesFor = (dateStr) =>
  (dateStr && dateStr < GST_CUTOVER_DATE) ? GST_RATES_LEGACY : GST_RATES_CURRENT

// ── Identifier validation ──────────────────────────────────────────────────
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
export function isValidGstin(gstin) {
  const g = (gstin || '').trim().toUpperCase()
  if (!GSTIN_RE.test(g)) return false
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const val = GSTIN_CHARS.indexOf(g[i])
    const prod = val * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(prod / 36) + (prod % 36)
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36]
  return check === g[14]
}
export const isValidPan = (pan) => /^[A-Z]{5}\d{4}[A-Z]$/.test((pan || '').trim().toUpperCase())
// 4th char of a PAN tells the holder type — drives the TDS rate for some sections.
export const PAN_HOLDER_TYPES = {
  C: 'Company', P: 'Individual', H: 'HUF', F: 'Firm / LLP', A: 'AOP', B: 'BOI',
  G: 'Government', J: 'Artificial Juridical Person', L: 'Local Authority', T: 'Trust',
}
export const panHolderType = (pan) => PAN_HOLDER_TYPES[(pan || '').trim().toUpperCase()[3]] || ''

// ── Money helpers ───────────────────────────────────────────────────────────
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
export const num = (v) => Number(v) || 0
export const fmtINR = (n, { decimals = 2 } = {}) =>
  '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
export const fmtAmt = (n) =>
  (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Tally-style Dr/Cr rendering of a signed (debit-positive) balance.
export const drCr = (signedDebitMinusCredit) => {
  const v = r2(signedDebitMinusCredit)
  if (Math.abs(v) < 0.005) return { amount: 0, side: '' }
  return { amount: Math.abs(v), side: v > 0 ? 'Dr' : 'Cr' }
}
export const fmtDrCr = (signed) => {
  const { amount, side } = drCr(signed)
  return amount === 0 ? '—' : `${fmtAmt(amount)} ${side}`
}

export const normName = (s) => (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim()

// ── Voucher types ───────────────────────────────────────────────────────────
// `kind` is how the Day Book / registers classify a voucher regardless of which
// collection it physically lives in (sales invoices, legacy payables etc. are
// separate collections; the new types all live in finance_vouchers).
export const VOUCHER_TYPES = {
  sales:       { label: 'Sales',        prefix: 'SAL', fkey: 'F8',      color: 'bg-blue-100 text-blue-700' },
  purchase:    { label: 'Purchase',     prefix: 'PUR', fkey: 'F9',      color: 'bg-orange-100 text-orange-700' },
  receipt:     { label: 'Receipt',      prefix: 'RCT', fkey: 'F6',      color: 'bg-green-100 text-green-700' },
  payment:     { label: 'Payment',      prefix: 'PAY', fkey: 'F5',      color: 'bg-red-100 text-red-700' },
  contra:      { label: 'Contra',       prefix: 'CON', fkey: 'F4',      color: 'bg-slate-200 text-slate-700' },
  journal:     { label: 'Journal',      prefix: 'JNL', fkey: 'F7',      color: 'bg-purple-100 text-purple-700' },
  credit_note: { label: 'Credit Note',  prefix: 'CRN', fkey: 'Ctrl+F8', color: 'bg-teal-100 text-teal-700' },
  debit_note:  { label: 'Debit Note',   prefix: 'DBN', fkey: 'Ctrl+F9', color: 'bg-amber-100 text-amber-700' },
  expense:     { label: 'Expense',      prefix: 'EXP', fkey: '',        color: 'bg-rose-100 text-rose-700' },
}
export const NEW_VOUCHER_TYPES = ['purchase', 'credit_note', 'debit_note', 'payment', 'receipt', 'contra']

// GL lines carry a `sourceType` (which collection/derivation made them); reports
// show the human voucher kind instead.
export const SOURCE_TO_KIND = {
  invoice: 'sales', receipt: 'receipt', payment: 'payment', payable: 'purchase', manual: 'journal',
  expense: 'expense', purchase: 'purchase', credit_note: 'credit_note', debit_note: 'debit_note', contra: 'contra',
  opening: 'opening',
}
export const kindOfSource = (sourceType) => SOURCE_TO_KIND[sourceType] || sourceType
