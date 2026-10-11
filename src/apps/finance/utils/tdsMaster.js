// TDS section master (non-salary, resident payees) — FY 2026-27.
//
// The Income-tax Act, 2025 took effect on 1 April 2026 and moved the old 194-series
// into section 393's tables, but rates and thresholds below largely carried over,
// and these old section names are still what Tally, CAs and vendors use day to day.
// `newRef` holds the section-393 table reference once your CA confirms it (only
// 194C is confirmed — 393(1) Table Sl. No. 6(i) per the e-filing portal; the rest
// are intentionally blank rather than guessed).
//
// ⚠ These are seed defaults. The Finance → TDS Sections page lets an admin edit
// every rate and threshold (stored in finance_tds_sections) so a mid-year change
// or a CA's correction doesn't need a code change.
export const DEFAULT_TDS_SECTIONS = [
  { code: '194C',  name: 'Contractors / sub-contractors / advertising',        newRef: '393(1) Sl.6(i)', rateIndividual: 1,   rateOthers: 2,  singleLimit: 30000, annualLimit: 100000, ratesByPayee: true },
  { code: '194J-P', name: 'Professional fees / director\'s fees',               newRef: '', rateIndividual: 10,  rateOthers: 10, singleLimit: 0,     annualLimit: 50000 },
  { code: '194J-T', name: 'Technical services / call centre / royalty (film)',  newRef: '', rateIndividual: 2,   rateOthers: 2,  singleLimit: 0,     annualLimit: 50000 },
  { code: '194H',  name: 'Commission or brokerage',                            newRef: '', rateIndividual: 2,   rateOthers: 2,  singleLimit: 0,     annualLimit: 20000 },
  { code: '194I-A', name: 'Rent — plant, machinery, equipment',                 newRef: '', rateIndividual: 2,   rateOthers: 2,  singleLimit: 0,     annualLimit: 600000 },
  { code: '194I-B', name: 'Rent — land, building, furniture, fittings',         newRef: '', rateIndividual: 10,  rateOthers: 10, singleLimit: 0,     annualLimit: 600000 },
  { code: '194IB', name: 'Rent by individual/HUF not liable to audit',         newRef: '', rateIndividual: 2,   rateOthers: 2,  singleLimit: 50000, annualLimit: 0 },
  { code: '194A',  name: 'Interest other than interest on securities',         newRef: '', rateIndividual: 10,  rateOthers: 10, singleLimit: 0,     annualLimit: 10000 },
  { code: '194Q',  name: 'Purchase of goods (buyer turnover > ₹10 cr)',        newRef: '', rateIndividual: 0.1, rateOthers: 0.1, singleLimit: 0,    annualLimit: 5000000 },
  { code: '194O',  name: 'E-commerce operator payments to participants',       newRef: '', rateIndividual: 0.1, rateOthers: 0.1, singleLimit: 0,    annualLimit: 500000 },
  { code: '194M',  name: 'Payment by individual/HUF (non-audit) to contractor/professional', newRef: '', rateIndividual: 2, rateOthers: 2, singleLimit: 0, annualLimit: 5000000 },
  { code: '195',  name: 'Payments to non-residents (rate per DTAA / certificate)', newRef: '', rateIndividual: 10.4, rateOthers: 10.4, singleLimit: 0, annualLimit: 0 },
  { code: '194T', name: 'Payments to partners (salary, remuneration, interest)', newRef: '', rateIndividual: 10, rateOthers: 10, singleLimit: 0,   annualLimit: 20000 },
  { code: '194R',  name: 'Benefits or perquisites in business/profession',     newRef: '', rateIndividual: 10,  rateOthers: 10, singleLimit: 0,     annualLimit: 20000 },
]

// PAN 4th character → deductee class for sections that differentiate (194C: individual/HUF vs others).
export const isIndividualOrHuf = (pan) => ['P', 'H'].includes((pan || '').trim().toUpperCase()[3])

// Rate to deduct. No valid PAN → section 206AA: higher of the section rate, the rate in
// force, or 20% (5% for 194Q / 194O). Returns { rate, reason }.
export function tdsRateFor(section, { pan = '', hasValidPan = true } = {}) {
  if (!section) return { rate: 0, reason: '' }
  const base = (section.ratesByPayee && !isIndividualOrHuf(pan)) ? section.rateOthers : (section.ratesByPayee ? section.rateIndividual : section.rateOthers ?? section.rateIndividual)
  if (!hasValidPan) {
    const floor = ['194Q', '194O'].includes(section.code) ? 5 : 20
    return { rate: Math.max(base, floor), reason: 'No valid PAN — higher rate under 206AA' }
  }
  return { rate: base, reason: '' }
}

// Threshold check for a single deduction. `paidYTD` = amount already paid/credited to this
// payee under this section this FY (before the current one).
export function thresholdCrossed(section, { current = 0, paidYTD = 0 } = {}) {
  if (!section) return false
  const single = Number(section.singleLimit) || 0
  const annual = Number(section.annualLimit) || 0
  if (!single && !annual) return true
  if (single && Number(current) > single) return true
  if (annual && (Number(paidYTD) + Number(current)) > annual) return true
  return false
}

// Lower / nil deduction certificate (s.197 of the old Act) held for a vendor.
// Stored on the vendor: ldcNumber, ldcSection (blank = any), ldcRate, ldcFrom, ldcTo, ldcLimit.
export function ldcFor(vendor, sectionCode, date) {
  if (!vendor?.ldcNumber || vendor.ldcRate === undefined || vendor.ldcRate === '') return null
  if (vendor.ldcSection && sectionCode && vendor.ldcSection !== sectionCode) return null
  if (vendor.ldcFrom && date && date < vendor.ldcFrom) return null
  if (vendor.ldcTo && date && date > vendor.ldcTo) return null
  return { number: vendor.ldcNumber, rate: Number(vendor.ldcRate) || 0, limit: Number(vendor.ldcLimit) || 0 }
}
