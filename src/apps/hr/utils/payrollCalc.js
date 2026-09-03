/**
 * Statutory-payroll calculation helpers for the HR module.
 *
 * Reflects the four Labour Codes (Code on Wages 2019, Code on Social
 * Security 2020, Industrial Relations Code 2020, OSH Code 2020), in force
 * nationally since 21 November 2025, with Central Rules notified 8 May
 * 2026. Sourced against current rate notifications as of September 2026 —
 * NOT a substitute for your accountant/CA's sign-off before running real
 * payroll. Every rate/slab/ceiling below is a constant that can change with
 * a Budget or a fresh notification; review at the start of each financial
 * year and whenever a new Code on Wages rule is notified.
 */

export const DEFAULT_SALARY_STRUCTURE = {
  basic: 0,
  dearnessAllowance: 0, // "DA" — most private employers keep this 0 and fold everything into Basic; kept separate because the Code on Wages defines the statutory wage floor as Basic + DA specifically
  hra: 0,
  conveyance: 0,
  medical: 0,
  specialAllowance: 0,
  pfApplicable: true,
  esiApplicable: true,
  professionalTaxState: 'Maharashtra',
  taxRegime: 'new', // 'new' | 'old' — new regime is now the default regime under the Income Tax Act
  declaredRentPaidAnnual: 0, // for HRA exemption under the OLD regime only
  isMetroCity: false, // Mumbai/Delhi/Kolkata/Chennai — affects HRA exemption %, OLD regime only
  declared80C: 0, // OLD regime only, capped at 150000
  declared80D: 0, // OLD regime only, capped at 25000 (50000 if either party is a senior citizen — not modelled, use the higher cap manually if applicable)
}

const num = (v) => Number(v) || 0

/** Sum of all earning components — the full (un-prorated) monthly gross. */
export function computeGross(structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  return num(s.basic) + num(s.dearnessAllowance) + num(s.hra) + num(s.conveyance) + num(s.medical) + num(s.specialAllowance)
}

/**
 * Standard Indian small/medium-company salary-structure template. Given a
 * single "Monthly Gross" figure, splits it into the usual heads so HR only
 * ever has to know/enter one number per employee instead of guessing a
 * breakup by hand:
 *
 *   Basic                50% of Gross
 *   HRA                  50% of Basic (= 25% of Gross) — standard metro rate.
 *   Conveyance/Transport  ₹1,600/month, capped by whatever's left.
 *   Medical Allowance     ₹1,250/month, capped by whatever's left.
 *   Special Allowance     the balance — so the heads always sum back to
 *                         Gross exactly, even for very low salaries where
 *                         the fixed allowances above don't fully fit.
 *
 * Basic alone (DA left at 0) already meets the Code on Wages' Basic+DA
 * ≥ 50%-of-gross wage floor (see statutoryWageBase below), so this
 * template doesn't need adjustment even after the Codes came into force.
 * Every head stays a plain editable number afterward; re-running this only
 * overwrites what's explicitly re-applied.
 */
export function splitGrossIntoStructure(gross, overrides = {}) {
  const g = Math.max(num(gross), 0)
  const basic = Math.round(g * 0.50)
  const hra = Math.round(basic * 0.50)
  let remaining = g - basic - hra
  const conveyance = Math.min(1600, Math.max(remaining, 0))
  remaining -= conveyance
  const medical = Math.min(1250, Math.max(remaining, 0))
  remaining -= medical
  const specialAllowance = Math.max(remaining, 0)
  return { ...DEFAULT_SALARY_STRUCTURE, ...overrides, basic, hra, conveyance, medical, specialAllowance }
}

/**
 * Code on Wages 2019 "wages" definition: allowances excluded from the
 * statutory wage base (HRA, conveyance, special allowance, etc.) cannot
 * exceed 50% of an employee's total remuneration — if Basic+DA works out
 * to less than half of gross, the wage used for PF/gratuity purposes is
 * DEEMED to be 50% of gross instead of the actual (lower) Basic+DA. This
 * is the statutory floor used everywhere below that calculates off
 * "PF wages" / "gratuity wages" rather than plain Basic.
 */
export function statutoryWageBase(structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  const basicPlusDA = num(s.basic) + num(s.dearnessAllowance)
  const gross = computeGross(s)
  return Math.max(basicPlusDA, Math.round(gross * 0.5))
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
    dearnessAllowance: scale(s.dearnessAllowance),
    hra: scale(s.hra),
    conveyance: scale(s.conveyance),
    medical: scale(s.medical),
    specialAllowance: scale(s.specialAllowance),
  }
}

// ── Provident Fund (EPF/EPS/EDLI) ──────────────────────────────────────
// Wage ceiling unchanged at ₹15,000 under the new Codes.
const PF_WAGE_CEILING = 15000

/** Employee's PF contribution — 12% of PF wages (Basic+DA, floored per statutoryWageBase), capped at ₹15,000 wage. */
export function computePF(pfWageBase, structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  if (!s.pfApplicable) return 0
  return Math.round(Math.min(num(pfWageBase), PF_WAGE_CEILING) * 0.12)
}

/**
 * Employer's PF-side outflow — NOT deducted from the employee, shown
 * separately for statutory-cost visibility and PF-return preparation.
 * Employer 12% core splits into EPS 8.33% (pension, capped ₹1,250/month)
 * + EPF 3.67%, plus EDLI 0.5% and current admin charges of ~1.1% (EPF
 * Scheme admin) — both employer-only, not employee deductions. Total
 * employer outflow works out to roughly 13.6% of PF wages at the ceiling.
 */
export function computeEmployerPF(pfWageBase, structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  if (!s.pfApplicable) return { eps: 0, epf: 0, edli: 0, adminCharges: 0, total: 0 }
  const wage = Math.min(num(pfWageBase), PF_WAGE_CEILING)
  const eps = Math.min(Math.round(wage * 0.0833), 1250)
  const epf = Math.round(wage * 0.12) - eps // the remainder of the 12% core after EPS
  const edli = Math.round(wage * 0.005)
  const adminCharges = Math.round(wage * 0.011)
  return { eps, epf, edli, adminCharges, total: eps + epf + edli + adminCharges }
}

// ── ESI ──────────────────────────────────────────────────────────────
const ESI_WAGE_CEILING = 21000

/** Employee's ESI contribution — 0.75% of gross, only while gross ≤ ₹21,000/month. */
export function computeESI(gross, structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  if (!s.esiApplicable) return 0
  if (gross > ESI_WAGE_CEILING) return 0
  return Math.round(gross * 0.0075)
}

/** Employer's ESI contribution — 3.25% of gross, same eligibility as the employee side. */
export function computeEmployerESI(gross, structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  if (!s.esiApplicable) return 0
  if (gross > ESI_WAGE_CEILING) return 0
  return Math.round(gross * 0.0325)
}

// ── Professional Tax ────────────────────────────────────────────────
// State-wise monthly PT. Maharashtra is the one state with a gender-based
// slab (women exempt up to ₹25,000/month — the rest of India taxes
// everyone on the same slab). Tamil Nadu actually collects PT half-yearly
// off average monthly income for that half-year, not monthly — approximated
// here as (half-yearly amount ÷ 6) applied every month, which gives the
// right annual total without needing a separate half-yearly billing cycle.
// States not listed here levy no professional tax (Delhi, Haryana, UP,
// Punjab, Rajasthan, Uttarakhand, HP, J&K and others) and return 0.
function maharashtraPT(gross, monthIndex, gender) {
  const threshold = gender === 'female' ? 25000 : 7500
  if (gross <= threshold) return 0
  if (gender !== 'female' && gross <= 10000) return 175
  return monthIndex === 1 ? 300 : 200 // Feb (index 1) tops up to the ₹2,500/year statutory max
}
function karnatakaPT(gross) {
  return gross >= 25000 ? 200 : 0
}
function tamilNaduPT(gross) {
  // Half-yearly slabs (₹/half-year) converted to a monthly-equivalent.
  const halfYearly =
    gross <= 21000 ? 0 :
    gross <= 30000 ? 135 :
    gross <= 45000 ? 315 :
    gross <= 60000 ? 690 :
    gross <= 75000 ? 1025 : 1250
  return Math.round(halfYearly / 6)
}
function westBengalPT(gross) {
  return gross <= 10000 ? 0 : gross <= 15000 ? 110 : gross <= 25000 ? 130 : gross <= 40000 ? 150 : 200
}
function gujaratPT(gross) {
  return gross <= 12000 ? 0 : 200
}
function telanganaPT(gross) {
  return gross <= 15000 ? 0 : gross <= 20000 ? 150 : 200
}

const PT_CALCULATORS = {
  Maharashtra: maharashtraPT,
  Karnataka: (gross) => karnatakaPT(gross),
  'Tamil Nadu': (gross) => tamilNaduPT(gross),
  'West Bengal': (gross) => westBengalPT(gross),
  Gujarat: (gross) => gujaratPT(gross),
  Telangana: (gross) => telanganaPT(gross),
  'Andhra Pradesh': (gross) => telanganaPT(gross), // same slab as Telangana
}
// States that do not levy professional tax at all.
const NO_PT_STATES = new Set(['Delhi', 'Haryana', 'Uttar Pradesh', 'Punjab', 'Rajasthan', 'Uttarakhand', 'Himachal Pradesh', 'Jammu and Kashmir'])

/**
 * Professional tax for the employee's registered PT state and (for
 * Maharashtra only) gender. `gender` is 'male' | 'female' | '' — anything
 * other than 'female' is treated as the standard slab.
 */
export function computeProfessionalTax(gross, monthIndex, structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  const state = s.professionalTaxState || 'Maharashtra'
  if (NO_PT_STATES.has(state)) return 0
  const calc = PT_CALCULATORS[state]
  if (!calc) return maharashtraPT(gross, monthIndex, s.gender) // fall back to the best-documented slab if the state isn't in the table yet
  return state === 'Maharashtra' ? calc(gross, monthIndex, s.gender) : calc(gross)
}

// ── TDS (rough estimate only — see doc comment) ────────────────────
/**
 * TDS estimate. NEW regime (default): FY2025-26 slabs with the Section 87A
 * rebate zeroing tax for taxable income up to ₹12,00,000, ₹75,000 standard
 * deduction. OLD regime (opt-in per employee): ₹50,000 standard deduction,
 * a simple HRA exemption (least of: HRA received / rent paid − 10% of
 * Basic+DA / 50% metro or 40% non-metro of Basic+DA), declared 80C
 * (capped ₹1,50,000) and 80D (capped ₹25,000 — use a manually-adjusted
 * declared80D if a senior-citizen higher cap applies), then the unchanged
 * old-regime slabs with an ₹12,500 rebate up to ₹5,00,000 taxable income.
 * Both are still genuine approximations — no other-income, no previous-
 * employer income in the same FY, no actual Form 12BB verification. Do
 * not treat either as the deposited/filed TDS figure without your CA's review.
 */
function newRegimeAnnualTax(taxableAnnual) {
  const slabs = [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]]
  let tax = 0, prev = 0
  for (const [upto, rate] of slabs) { if (taxableAnnual > prev) { tax += (Math.min(taxableAnnual, upto) - prev) * rate; prev = upto } }
  if (taxableAnnual <= 1200000) tax = 0 // Sec 87A rebate, new regime
  return tax
}
function oldRegimeAnnualTax(taxableAnnual) {
  const slabs = [[250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]]
  let tax = 0, prev = 0
  for (const [upto, rate] of slabs) { if (taxableAnnual > prev) { tax += (Math.min(taxableAnnual, upto) - prev) * rate; prev = upto } }
  if (taxableAnnual <= 500000) tax = Math.max(tax - 12500, 0) // Sec 87A rebate, old regime
  return tax
}

export function estimateMonthlyTDS(monthlyGross, structure = {}) {
  const s = { ...DEFAULT_SALARY_STRUCTURE, ...structure }
  const annualGross = num(monthlyGross) * 12
  let tax
  if (s.taxRegime === 'old') {
    const standardDeduction = 50000
    const basicPlusDAAnnual = (num(s.basic) + num(s.dearnessAllowance)) * 12
    const hraAnnual = num(s.hra) * 12
    const rentPaid = num(s.declaredRentPaidAnnual)
    const hraExemption = rentPaid > 0
      ? Math.max(Math.min(hraAnnual, Math.max(rentPaid - basicPlusDAAnnual * 0.10, 0), basicPlusDAAnnual * (s.isMetroCity ? 0.50 : 0.40)), 0)
      : 0
    const declared80C = Math.min(num(s.declared80C), 150000)
    const declared80D = Math.min(num(s.declared80D), 25000)
    const taxable = Math.max(annualGross - standardDeduction - hraExemption - declared80C - declared80D, 0)
    tax = oldRegimeAnnualTax(taxable)
  } else {
    const standardDeduction = 75000
    const taxable = Math.max(annualGross - standardDeduction, 0)
    tax = newRegimeAnnualTax(taxable)
  }
  const withCess = tax * 1.04 // 4% Health & Education cess, both regimes
  return Math.round(withCess / 12)
}

// ── Gratuity (Payment of Gratuity Act, as amended by the Code on Social Security) ──
/**
 * Completed years of service, with the standard "6 months or more rounds
 * up to the next full year" rule.
 */
export function completedYearsOfService(joinDate, asOfDate = new Date()) {
  if (!joinDate) return 0
  const start = new Date(joinDate + 'T00:00:00')
  const end = asOfDate instanceof Date ? asOfDate : new Date(asOfDate + 'T00:00:00')
  if (Number.isNaN(start.getTime()) || end < start) return 0
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (end.getDate() < start.getDate()) months -= 1
  const years = Math.floor(months / 12)
  const remMonths = months - years * 12
  return remMonths >= 6 ? years + 1 : years
}

const GRATUITY_TAX_FREE_CEILING = 2000000 // ₹20 lakh, private sector (Gratuity Act covered) — unchanged as of Sep 2026; the ₹25L figure floated in some coverage applies to government employees only

/**
 * `employmentType`: 'permanent' (5-year eligibility, unchanged) or
 * 'fixed-term' (1-year eligibility on a pro-rata basis, per the Code on
 * Social Security's expanded coverage). Formula: 15 days' wages for every
 * completed year, wages = last-drawn Basic+DA, divided by 26 (a
 * conventional working-days-per-month figure).
 */
export function computeGratuity({ basicPlusDA, joinDate, asOfDate, employmentType = 'permanent' }) {
  const years = completedYearsOfService(joinDate, asOfDate)
  const minYears = employmentType === 'fixed-term' ? 1 : 5
  const eligible = years >= minYears
  const amount = Math.round((15 * num(basicPlusDA) * years) / 26)
  const taxFreeAmount = Math.min(amount, GRATUITY_TAX_FREE_CEILING)
  return { years, eligible, minYears, amount: eligible ? amount : 0, taxFreeAmount: eligible ? taxFreeAmount : 0 }
}

// ── Statutory Bonus (Code on Wages, replacing the Payment of Bonus Act) ──
const BONUS_ELIGIBILITY_CEILING = 21000 // Basic+DA per month
const BONUS_WAGE_CALC_CEILING = 7000 // the wage figure the % is applied to, capped here regardless of actual pay

/**
 * Minimum statutory bonus — 8.33% of bonus wages for the year (the legal
 * floor; the maximum is 20% but that depends on the employer's allocable
 * surplus for the year, which this app has no visibility into, so it
 * defaults to the guaranteed minimum). `daysWorkedInYear` must be ≥30 to
 * qualify. Applies to establishments covered by the Act (factories with
 * 10+ employees, other establishments with 20+) — verify this company
 * meets that threshold before relying on the "eligible" flag.
 */
export function computeAnnualBonus({ basicPlusDA, daysWorkedInYear, minWagePerMonth = 0, percent = 0.0833 }) {
  const eligible = num(basicPlusDA) <= BONUS_ELIGIBILITY_CEILING && num(daysWorkedInYear) >= 30
  const bonusWageMonthly = Math.max(Math.min(num(basicPlusDA), BONUS_WAGE_CALC_CEILING), Math.min(num(minWagePerMonth), BONUS_WAGE_CALC_CEILING))
  const amount = eligible ? Math.round(bonusWageMonthly * 12 * percent) : 0
  return { eligible, bonusWageMonthly, amount }
}

/**
 * Full breakup for one employee's payslip for one month.
 * `attendance` = { presentDays, halfDays, paidLeaveDays, holidayDays, sundays, totalDaysInMonth }
 * `otherDeductions` = advances/loans/misc, entered manually (not statutory).
 */
export function computePayrollBreakup({ structure, attendance, monthIndex, otherDeductions = 0 }) {
  const { fraction, payableDays } = computeAttendanceFraction(attendance)
  const earnings = proratedEarnings(structure, fraction)
  const grossProrated = earnings.basic + earnings.dearnessAllowance + earnings.hra + earnings.conveyance + earnings.medical + earnings.specialAllowance
  const pfWageBase = Math.round(statutoryWageBase(structure) * fraction)
  const pf = computePF(pfWageBase, structure)
  const employerPF = computeEmployerPF(pfWageBase, structure)
  const esi = computeESI(grossProrated, structure)
  const employerESI = computeEmployerESI(grossProrated, structure)
  const professionalTax = computeProfessionalTax(grossProrated, monthIndex, structure)
  const tds = estimateMonthlyTDS(grossProrated, structure)
  const totalDeductions = pf + esi + professionalTax + tds + (Number(otherDeductions) || 0)
  const netSalary = Math.max(grossProrated - totalDeductions, 0)
  return {
    fraction, payableDays, earnings, grossProrated, pfWageBase,
    deductions: { pf, esi, professionalTax, tds, other: Number(otherDeductions) || 0 },
    employerContributions: { pf: employerPF, esi: employerESI, totalEmployerCost: grossProrated + employerPF.total + employerESI },
    totalDeductions, netSalary,
  }
}
