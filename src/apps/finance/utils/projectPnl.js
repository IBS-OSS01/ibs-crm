// Project-wise budget and profit & loss.
// Every project in the Projects register has one cost centre in Finance (id `proj_<projectId>`, named "<project number> – <project name>").
// Anything tagged with that cost centre — purchase bills, payments / expenses, debit & credit notes, sales invoices and journal lines — lands in the
// project. The budget sits on the cost centre document:  budget = { contractValue?, lines: [{ accountCode, amount }] }  (cost budget per expense account).
import { num, fmtAmt } from './financeConstants.js'
import { poProgress } from './purchaseOrders.js'

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export const projectCentreId = (projectId) => `proj_${projectId}`
export const projectCentreName = (p) => [p.projectNumber, p.projectName].filter(Boolean).join(' – ') || p.id

// → [{ id, data, isNew }]  the cost centres that must be created (or have their name / link refreshed) so every project has one
export function projectCentreWork(projects = [], centres = []) {
  const byId = new Map(centres.map(c => [c.id, c]))
  const work = []
  for (const p of projects) {
    if (!p || p.isGeneral || !p.id) continue
    const id = projectCentreId(p.id)
    const name = projectCentreName(p)
    const cur = byId.get(id)
    if (!cur) work.push({ id, isNew: true, data: { name, code: p.projectNumber || '', projectId: p.id, active: p.status !== 'cancelled', createdAt: new Date().toISOString(), createdBy: 'auto' } })
    else if (cur.name !== name || cur.code !== (p.projectNumber || '') || cur.projectId !== p.id) work.push({ id, isNew: false, data: { name, code: p.projectNumber || '', projectId: p.id } })
  }
  return work
}

const inScope = (l, company, from, to) => (!company || l.company === company) && (!from || (l.date || '') >= from) && (!to || (l.date || '') <= to)
// Value still to be billed on open purchase orders tagged to the project (net of discount, before GST) — money promised but not yet a bill.
// Goods and services on a purchase order are costed to Purchases (5000), as the bills raised against it will be.
export function committedFor(centreId, vouchers = [], { company, from, to, excludePoId } = {}) {
  const byAccount = {}
  vouchers.forEach(v => {
    if (v.voucherType !== 'purchase_order' || v.status === 'cancelled' || v.costCentreId !== centreId || v.id === excludePoId) return
    if ((company && v.company !== company) || (from && (v.date || '') < from) || (to && (v.date || '') > to)) return
    const p = poProgress(v, vouchers)
    if (p.status === 'closed' || p.status === 'cancelled') return
    byAccount['5000'] = r2((byAccount['5000'] || 0) + p.pendingValue)
  })
  return { byAccount, total: r2(Object.values(byAccount).reduce((x, y) => x + y, 0)) }
}

const amountOf = (a, l) => a.type === 'income' ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)

// One project: income, cost by account against the budget, and the lines behind them.
export function projectPnl(lines, accounts, centre, project, { company, from, to, vouchers = [] } = {}) {
  const budget = centre?.budget || {}
  const budgetLines = (budget.lines || []).filter(b => b.accountCode && num(b.amount) > 0)
  const income = {}, cost = {}, docs = []
  lines.forEach(l => {
    if (l.costCentreId !== centre.id || !inScope(l, company, from, to)) return
    const a = accounts.find(x => x.code === l.accountCode)
    if (!a || !['income', 'expense'].includes(a.type)) return
    const amt = amountOf(a, l)
    ;(a.type === 'income' ? income : cost)[a.code] = r2(((a.type === 'income' ? income : cost)[a.code] || 0) + amt)
    docs.push({ date: l.date, doc: l.sourceDocNumber || '', type: l.sourceType, description: l.description || '', account: a, kind: a.type, amount: r2(amt) })
  })
  const budgetBy = Object.fromEntries(budgetLines.map(b => [b.accountCode, r2(num(b.amount))]))
  const committedBy = committedFor(centre.id, vouchers, { company, from, to }).byAccount
  const codes = [...new Set([...Object.keys(budgetBy), ...Object.keys(cost), ...Object.keys(committedBy)])].sort()
  const rows = codes.map(code => {
    const a = accounts.find(x => x.code === code)
    const b = budgetBy[code] || 0, act = cost[code] || 0, com = committedBy[code] || 0
    return { code, name: a?.name || code, budget: b, actual: act, committed: com, remaining: r2(b - act - com), pct: b ? r2((act + com) * 100 / b) : null, over: b > 0 ? act + com > b + 0.5 : act + com > 0.5 && budgetLines.length > 0 }
  })
  const incomeRows = Object.entries(income).map(([code, amount]) => ({ code, name: accounts.find(x => x.code === code)?.name || code, amount }))
  const billed = r2(Object.values(income).reduce((s, x) => s + x, 0))
  const actualCost = r2(Object.values(cost).reduce((s, x) => s + x, 0))
  const budgetCost = r2(budgetLines.reduce((s, b) => s + num(b.amount), 0))
  const contractValue = num(budget.contractValue) || num(project?.contractValue)
  const committedCost = r2(Object.values(committedBy).reduce((x, y) => x + y, 0))
  const expectedCost = Math.max(budgetCost, r2(actualCost + committedCost))     // once spending (and orders placed) pass the budget, that is the better forecast
  return {
    centre, project, contractValue, billed, billedPct: contractValue ? r2(billed * 100 / contractValue) : null,
    budgetCost, actualCost, committedCost, costPct: budgetCost ? r2(actualCost * 100 / budgetCost) : null,
    profitToDate: r2(billed - actualCost),
    expectedProfit: contractValue ? r2(contractValue - expectedCost) : null,
    expectedMargin: contractValue ? r2((contractValue - expectedCost) * 100 / contractValue) : null,
    rows, incomeRows, docs: docs.sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    hasBudget: budgetLines.length > 0,
  }
}

// What is not tagged to any project in the same scope (overheads, untagged sales) — so the project figures reconcile to the company P&L
export function untaggedTotals(lines, accounts, { company, from, to } = {}) {
  let income = 0, expense = 0
  lines.forEach(l => {
    if (l.costCentreId || !inScope(l, company, from, to)) return
    const a = accounts.find(x => x.code === l.accountCode)
    if (!a || !['income', 'expense'].includes(a.type)) return
    if (a.type === 'income') income += amountOf(a, l); else expense += amountOf(a, l)
  })
  return { income: r2(income), expense: r2(expense) }
}

// Warnings shown while an entry is being made: would adding `adds` ([{ accountCode, amount }]) take a cost head of the project over its budget?
// excludeSourceId = the document being edited (already inside the actuals); excludePoId = the purchase order being billed / edited (already inside "committed").
export function budgetCheck({ lines = [], accounts = [], vouchers = [], centre, adds = [], excludeSourceId, excludePoId } = {}) {
  const budgetLines = (centre?.budget?.lines || []).filter(b => b.accountCode && num(b.amount) > 0)
  if (!centre || !budgetLines.length) return []
  const byAcc = {}
  adds.forEach(a => { if (a.accountCode && num(a.amount) > 0) byAcc[a.accountCode] = r2((byAcc[a.accountCode] || 0) + num(a.amount)) })
  const committed = committedFor(centre.id, vouchers, { excludePoId }).byAccount
  const out = []
  for (const [code, add] of Object.entries(byAcc)) {
    const acct = accounts.find(x => x.code === code)
    if (!acct || acct.type !== 'expense') continue
    const b = budgetLines.find(x => x.accountCode === code)
    const actual = r2(lines.filter(l => l.costCentreId === centre.id && l.accountCode === code && l.sourceId !== excludeSourceId).reduce((t, l) => t + num(l.debit) - num(l.credit), 0))
    const com = committed[code] || 0
    const projected = r2(actual + com + add)
    const head = `${centre.name} — ${acct.name}`
    const parts = `spent ${fmtAmt(actual)}${com ? ` + on order ${fmtAmt(com)}` : ''} + this entry ${fmtAmt(add)} = ${fmtAmt(projected)}`
    if (!b) out.push({ level: 'over', text: `${head} is not in the project's budget (${fmtAmt(add)} would be booked there).` })
    else if (projected > num(b.amount) + 0.5) out.push({ level: 'over', text: `${head}: ${parts}, over the budget of ${fmtAmt(b.amount)} by ${fmtAmt(projected - num(b.amount))}.` })
    else if (projected >= num(b.amount) * 0.9) out.push({ level: 'warn', text: `${head}: ${parts} — ${(projected * 100 / num(b.amount)).toFixed(0)}% of the budget of ${fmtAmt(b.amount)}.` })
  }
  return out
}

// Payroll cost split by project. Each employee belongs to at most one project (hr_employees.projectCostCentreId); slips = the month's salary slips,
// `pfAdmin` = the establishment-level PF admin charge, shared out by PF wage. → [{ costCentreId, gross, employerPf, employerEsic, pfCharges, count }]
export function payrollByProject(slips = [], employeesById = {}, pfAdmin = 0) {
  const totalBase = slips.reduce((t, x) => t + num(x.pfAdminBase ?? x.pfBase), 0)
  const groups = {}
  slips.forEach(x => {
    const cc = employeesById[x.employeeId]?.projectCostCentreId
    if (!cc) return
    const g = (groups[cc] = groups[cc] || { costCentreId: cc, gross: 0, employerPf: 0, employerEsic: 0, pfCharges: 0, base: 0, count: 0 })
    g.gross += num(x.baseSalary); g.employerPf += num(x.pfEmployerEps) + num(x.pfEmployerEpf); g.employerEsic += num(x.esicEmployer)
    g.pfCharges += num(x.pfEdli); g.base += num(x.pfAdminBase ?? x.pfBase); g.count++
  })
  return Object.values(groups).map(g => ({ costCentreId: g.costCentreId, count: g.count, gross: r2(g.gross), employerPf: r2(g.employerPf), employerEsic: r2(g.employerEsic),
    pfCharges: r2(g.pfCharges + (totalBase > 0 ? num(pfAdmin) * g.base / totalBase : 0)) }))
}
