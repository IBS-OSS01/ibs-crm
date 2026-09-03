/**
 * Pure statutory-payroll calculation helpers for the HR module.
 *
 * These are reasonable, commonly-used defaults for a Maharashtra-registered
 * company — NOT a substitute for your accountant/CA's sign-off before
 * running real payroll. PF/ESI ceilings, professional-tax slabs, and TDS
 * rates change with each Union/State Budget; review these constants at the
 * start of each financial year.
 */

export const DEFAULT_SALARY_STRUCTURE = {
  basic: 0,
  hra: 0,
  conveyance: 0,
  medical: 0,
  specialAllowance: 0,
  pfApplicable: true,
  esiApplicable: true,
  professionalTaxState: 'Maharashtra',
}

const num = (v) => Number(v) || 0

/** Sum of all earning components — the full (un-prorated) monthly gross. */
export function computeGross(structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  return num(s.basic) + num(s.hra) + num(s.conveyance) + num(s.medical) + num(s.specialAllowance)
}

/**
 * Attendance-linked pro-ration fraction for one month.
 * payableDays = present + (half-day × 0.5) + paid leave + holidays + Sundays
 * (Sundays/holidays are paid days by default — they're not something an
 * employee can be marked absent on, so they always count as payable.)
 */
export function computeAttendanceFraction({ presentDays = 0, halfDays = 0, paidLeaveDays = 0, holidayDays = 0, sundays = 0, totalDaysInMonth }) {
  if (!totalDaysInMonth) return 1
  const payableDays = presentDays + halfDays * 0.5 + paidLeaveDays + holidayDays + sundays
  return { payableDays, fraction: Math.min(payableDays / totalDaysInMonth, 1) }
}

/** Earnings breakup scaled by the attendance fraction, each component rounded to the nearest ₹. */
export function proratedEarnings(structure = {}, fraction = 1) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  const scale = (v) => Math.round(num(v) * fraction)
  return {
    basic: scale(s.basic),
    hra: scale(s.hra),
    conveyance: scale(s.conveyance),
    medical: scale(s.medical),
    specialAllowance: scale(s.specialAllowance),
  }
}

/** Employee's PF contribution — 12% of Basic, capped at ₹15,000 basic (max ₹1,800/month). */
export function computePF(basic, structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  if (!s.pfApplicable) return 0
  return Math.round(Math.min(num(basic), 15000) * 0.12)
}

/** Employee's ESI contribution — 0.75% of gross, only while gross ≤ ₹21,000/month. */
export function computeESI(gross, structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  if (!s.esiApplicable) return 0
  if (gross > 21000) return 0
  return Math.round(gross * 0.0075)
}

/**
 * Maharashtra professional-tax slab (simplified — no gender split):
 *   ≤ ₹7,500  → Nil
 *   ≤ ₹10,000 → ₹175/month
 *   > ₹10,000 → ₹200/month (₹300 in February, to round the statutory
 *               annual total to ₹2,500)
 * Other states fall back to the same table until a state-specific slab is added.
 */
export function computeProfessionalTax(gross, monthIndex /* 0=Jan..11=Dec */) {
  if (gross <= 7500) return 0
  if (gross <= 10000) return 175
  return monthIndex === 1 ? 300 : 200
}

/**
 * Rough TDS estimate under the new tax regime (FY2025-26 slabs, incl. the
 * Section 87A rebate that zeroes tax for taxable income up to ₹12,00,000).
 * Annualises the prorated monthly gross × 12 — a genuine approximation for
 * someone whose pay varies month to month; treat as indicative only.
 */
export function estimateMonthlyTDS(monthlyGross) {
  const annualGross = num(monthlyGross) * 12
  const standardDeduction = 75000
  const taxable = Math.max(annualGross - standardDeduction, 0)
  const slabs = [
    [400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15],
    [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30],
  ]
  let tax = 0, prev = 0
  for (const [upto, rate] of slabs) {
    if (taxable > prev) { tax += (Math.min(taxable, upto) - prev) * rate; prev = upto }
  }
  if (taxable <= 1200000) tax = 0 // Section 87A rebate
  const withCess = tax * 1.04 // 4% Health & Education cess
  return Math.round(withCess / 12)
}

/**
 * Full breakup for one employee's payslip for one month.
 * `attendance` = { presentDays, halfDays, paidLeaveDays, holidayDays, sundays, totalDaysInMonth }
 * `otherDeductions` = advances/loans/misc, entered manually (not statutory).
 */
export function computePayrollBreakup({ structure, attendance, monthIndex, otherDeductions = 0 }) {
  const { fraction, payableDays } = computeAttendanceFraction(attendance)
  const earnings = proratedEarnings(structure, fraction)
  const grossProrated = earnings.basic + earnings.hra + earnings.conveyance + earnings.medical + earnings.specialAllowance
  const pf = computePF(earnings.basic, structure)
  const esi = computeESI(grossProrated, structure)
  const professionalTax = computeProfessionalTax(grossProrated, monthIndex)
  const tds = estimateMonthlyTDS(grossProrated)
  const totalDeductions = pf + esi + professionalTax + tds + (Number(otherDeductions) || 0)
  const netSalary = Math.max(grossProrated - totalDeductions, 0)
  return {
    fraction, payableDays, earnings, grossProrated,
    deductions: { pf, esi, professionalTax, tds, other: Number(otherDeductions) || 0 },
    totalDeductions, netSalary,
  }
}
