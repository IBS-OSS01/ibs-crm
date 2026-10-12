// Line-level GST / TDS computation shared by every voucher form and by the
// GST reports. Pure functions (no Firestore, no React).
import { num, r2 } from './financeConstants.js'

// Intra-state supply → CGST + SGST; inter-state → IGST. If either state code is
// unknown we fall back to IGST (same convention as indiaConstants.gstType).
export const supplyTypeOf = (sellerStateCode, posStateCode) =>
  (sellerStateCode && posStateCode && sellerStateCode === posStateCode) ? 'intra' : 'inter'

// Item shape in:  { qty, rate, discountPct?, gstRate, ...anything else }
// Item shape out: same + { taxable, cgst, sgst, igst, lineTax, lineTotal }
//
// `applyGst:false` (unregistered / exempt / Wayzim) zeroes all tax.
// Tax is rounded per line to 2 decimals because that's what the GST portal and
// the offline return tools accept; totals are the sum of the rounded lines so
// the invoice, the register and the return always agree to the paisa.
export function computeLineTaxes(items = [], { supplyType = 'inter', applyGst = true } = {}) {
  return items.map(it => {
    const gross = num(it.qty) * num(it.rate)
    const taxable = r2(gross - gross * num(it.discountPct) / 100)
    const rate = applyGst ? num(it.gstRate) : 0
    let cgst = 0, sgst = 0, igst = 0
    if (rate > 0) {
      if (supplyType === 'intra') {
        cgst = r2(taxable * rate / 200)
        sgst = r2(taxable * rate / 200)
      } else {
        igst = r2(taxable * rate / 100)
      }
    }
    const lineTax = r2(cgst + sgst + igst)
    return { ...it, taxable, cgst, sgst, igst, lineTax, lineTotal: r2(taxable + lineTax) }
  })
}

// Totals for a whole voucher.
//   rcm:true → the tax is the buyer's liability, not part of what the vendor is
//   owed, so the payable total (and its rounding) excludes tax.
export function computeVoucherTotals(items = [], opts = {}) {
  const { supplyType = 'inter', applyGst = true, rcm = false, rounding = true, roundOff: typedRoundOff } = opts
  const lines = computeLineTaxes(items, { supplyType, applyGst })
  const subTotal = r2(lines.reduce((s, l) => s + l.taxable, 0))

  // Group by rate for the tax summary (same label format the ledger relies on).
  const byRate = {}
  lines.forEach(l => {
    const r = applyGst ? num(l.gstRate) : 0
    if (r <= 0) return
    byRate[r] = byRate[r] || { base: 0, cgst: 0, sgst: 0, igst: 0 }
    byRate[r].base += l.taxable
    byRate[r].cgst += l.cgst; byRate[r].sgst += l.sgst; byRate[r].igst += l.igst
  })
  const gstLines = []
  Object.keys(byRate).map(Number).sort((a, b) => a - b).forEach(r => {
    const g = byRate[r]
    if (supplyType === 'intra') {
      gstLines.push({ label: `CGST ${r / 2}%`, rate: r / 2, base: r2(g.base), amount: r2(g.cgst) })
      gstLines.push({ label: `SGST ${r / 2}%`, rate: r / 2, base: r2(g.base), amount: r2(g.sgst) })
    } else {
      gstLines.push({ label: `IGST ${r}%`, rate: r, base: r2(g.base), amount: r2(g.igst) })
    }
  })

  const cgst = r2(lines.reduce((s, l) => s + l.cgst, 0))
  const sgst = r2(lines.reduce((s, l) => s + l.sgst, 0))
  const igst = r2(lines.reduce((s, l) => s + l.igst, 0))
  const taxTotal = r2(cgst + sgst + igst)
  const rawTotal = r2(subTotal + (rcm ? 0 : taxTotal))
  // a round off typed by the user wins over the automatic nearest-rupee one
  const typed = typedRoundOff !== undefined && typedRoundOff !== null && String(typedRoundOff).trim() !== '' && Number.isFinite(Number(typedRoundOff))
  const total = typed ? r2(rawTotal + Number(typedRoundOff)) : (rounding ? Math.round(rawTotal) : rawTotal)
  const roundOff = r2(total - rawTotal)
  return { items: lines, subTotal, gstLines, cgst, sgst, igst, taxTotal, rawTotal, total, roundOff }
}

// TDS: deducted on the amount *excluding* GST when GST is shown separately on
// the invoice (CBDT Circular 23/2017), and rounded to the nearest rupee.
export function computeTds({ base, rate, applicable = true } = {}) {
  if (!applicable || !num(rate) || !num(base)) return { applicable: false, base: 0, rate: 0, amount: 0 }
  return { applicable: true, base: r2(base), rate: num(rate), amount: Math.round(num(base) * num(rate) / 100) }
}

// Maps a GST line label ('CGST 9%', 'IGST 18%') to its tax head.
export const gstHead = (label = '') =>
  label.startsWith('CGST') ? 'cgst' : label.startsWith('SGST') ? 'sgst' : label.startsWith('IGST') ? 'igst' : null
export const OUTPUT_GST_CODE = { cgst: '2401', sgst: '2402', igst: '2403' }
export const INPUT_GST_CODE  = { cgst: '1301', sgst: '1302', igst: '1303' }
