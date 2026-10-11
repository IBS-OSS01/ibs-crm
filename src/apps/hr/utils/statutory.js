// PF (EPF / EPS / EDLI) and ESIC calculations for payroll. Pure functions, shared by the HR module (salary slips)
// and the Finance module (payroll posting, statutory dues, ECR / ESIC files).
//
// ⚠ Rates and ceilings are the long-standing statutory defaults and can change — they live in
// company_settings/<company>.statutory so an admin can update them without a code change. Nothing is
// deducted for an employee unless PF / ESIC is switched on in their HR profile.
//
//   PF   employee 12% of PF wage; employer 12% = EPS 8.33% (on wage up to the ceiling) + EPF balance;
//        EDLI 0.5% and admin charge 0.5% (minimum per month) are employer costs on top.
//        PF wage = basic (+DA). If basic isn't recorded we take 50% of gross — the minimum under the Labour Codes.
//        Wage ceiling ₹15,000 unless the employee contributes on actual wages.
//   ESIC applies while monthly gross is ₹21,000 or less: employee 0.75%, employer 3.25%, each rounded UP to the next rupee.
//        Employees earning ₹176 a day or less pay no employee share.
export const DEFAULT_STATUTORY = {
  pfEmployeePct: 12, pfEmployerPct: 12, pfEpsPct: 8.33, pfCeiling: 15000, edliPct: 0.5, pfAdminPct: 0.5, pfAdminMin: 500,
  wageBasicPct: 50,
  esicCeiling: 21000, esicEmployeePct: 0.75, esicEmployerPct: 3.25, esicDailyExempt: 176,
  pfEstablishmentCode: '', esicCode: '',
}

const num = (v) => Number(v) || 0
const rnd = (n) => Math.round(n + 1e-9)
const ceil = (n) => Math.ceil(n - 1e-9)

export const mergeStatutory = (stored) => ({ ...DEFAULT_STATUTORY, ...(stored || {}) })

export function pfWageOf(emp, gross, s) {
  const basic = num(emp?.basicSalary)
  return basic > 0 ? basic : rnd(num(gross) * num(s.wageBasicPct) / 100)
}

// → everything a salary slip needs about PF / ESIC for one employee-month
export function computeStatutory({ emp, gross, s }) {
  const out = { pfApplicable: false, pfWage: 0, pfBase: 0, pfEmployee: 0, pfEmployerEps: 0, pfEmployerEpf: 0, pfEdli: 0, pfAdminBase: 0, esicApplicable: false, esicWage: 0, esicEmployee: 0, esicEmployer: 0 }
  gross = num(gross)
  if (emp?.pfApplicable === true && gross > 0) {
    const wage = pfWageOf(emp, gross, s)
    const capped = Math.min(wage, num(s.pfCeiling))
    const base = emp.pfOnActual ? wage : capped
    const employerTotal = rnd(base * num(s.pfEmployerPct) / 100)
    const eps = rnd(capped * num(s.pfEpsPct) / 100)
    Object.assign(out, {
      pfApplicable: true, pfWage: wage, pfBase: base,
      pfEmployee: rnd(base * num(s.pfEmployeePct) / 100), pfEmployerEps: eps, pfEmployerEpf: Math.max(0, employerTotal - eps),
      pfEdli: rnd(capped * num(s.edliPct) / 100), pfAdminBase: base,
    })
  }
  if (emp?.esicApplicable === true && gross > 0 && gross <= num(s.esicCeiling)) {
    const exempt = gross / 30 <= num(s.esicDailyExempt)
    Object.assign(out, {
      esicApplicable: true, esicWage: gross,
      esicEmployee: exempt ? 0 : ceil(gross * num(s.esicEmployeePct) / 100), esicEmployer: ceil(gross * num(s.esicEmployerPct) / 100),
    })
  }
  return out
}

// Establishment-level PF admin charge for a month: 0.5% of PF wages, at least the monthly minimum (if any PF member).
export const pfAdminCharge = (slips, s) => {
  const base = slips.reduce((t, x) => t + num(x.pfAdminBase ?? x.pfBase), 0)
  return base > 0 ? Math.max(rnd(base * num(s.pfAdminPct) / 100), num(s.pfAdminMin)) : 0
}

// Month totals from salary slips — what a payroll journal needs.
export function payrollTotals(slips, s) {
  const sum = (f) => slips.reduce((t, x) => t + num(x[f]), 0)
  const gross = sum('baseSalary')
  const pfEmployee = sum('pfEmployee'), eps = sum('pfEmployerEps'), epf = sum('pfEmployerEpf'), edli = sum('pfEdli')
  const esicEmployee = sum('esicEmployee'), esicEmployer = sum('esicEmployer')
  const pfAdmin = pfAdminCharge(slips, s)
  const advances = sum('advancesDeducted'), otherDeductions = sum('deductions'), net = sum('netSalary')
  return {
    count: slips.length, gross, pfEmployee, pfEmployerEps: eps, pfEmployerEpf: epf, pfEdli: edli, pfAdmin, esicEmployee, esicEmployer, advances, otherDeductions, net,
    employerPf: eps + epf, pfCharges: edli + pfAdmin,
    pfPayable: pfEmployee + eps + epf + edli + pfAdmin, esicPayable: esicEmployee + esicEmployer,
  }
}

// ── EPFO ECR (version 2) text file: one line per member, fields separated by #~# ──
// UAN#~#name#~#gross wages#~#EPF wages#~#EPS wages#~#EDLI wages#~#EPF contribution#~#EPS contribution#~#EPF-EPS difference#~#NCP days#~#refund of advances
export function buildEcr(slips, employeesById, s) {
  const lines = []
  const problems = []
  slips.filter(x => num(x.pfEmployee) > 0 || num(x.pfEmployerEps) > 0).forEach(x => {
    const e = employeesById[x.employeeId] || {}
    const uan = String(e.uan || '').replace(/\D/g, '')
    if (uan.length !== 12) problems.push(`${x.employeeName}: UAN is missing or not 12 digits`)
    const capped = Math.min(num(x.pfWage), num(s.pfCeiling))
    const epfWage = e.pfOnActual ? num(x.pfWage) : capped
    const clean = String(x.employeeName || '').replace(/#~#/g, ' ').replace(/[^A-Za-z .]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
    lines.push([uan, clean, rnd(num(x.baseSalary)), epfWage, capped, capped, num(x.pfEmployee), num(x.pfEmployerEps), num(x.pfEmployerEpf), num(x.ncpDays), 0].join('#~#'))
  })
  return { text: lines.join('\n'), count: lines.length, problems }
}

// ── ESIC monthly contribution template rows ──
export function esicRows(slips, employeesById) {
  return slips.filter(x => num(x.esicWage) > 0).map(x => {
    const e = employeesById[x.employeeId] || {}
    return { ipNumber: e.esicIpNumber || '', name: x.employeeName, days: 30 - num(x.ncpDays), wages: num(x.esicWage), reason: '', lastWorkingDay: '', employee: num(x.esicEmployee), employer: num(x.esicEmployer) }
  })
}

// Due date for both PF and ESIC contributions: the 15th of the following month.
export const contributionDue = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}-15`
}
