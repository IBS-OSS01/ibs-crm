// Project-wise budget and profit & loss.
// Every project in the Projects register has one cost centre in Finance (id `proj_<projectId>`, named "<project number> – <project name>").
// Anything tagged with that cost centre — purchase bills, payments / expenses, debit & credit notes, sales invoices and journal lines — lands in the
// project. The budget sits on the cost centre document:  budget = { contractValue?, lines: [{ accountCode, amount }] }  (cost budget per expense account).
import { num } from './financeConstants.js'

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
const amountOf = (a, l) => a.type === 'income' ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)

// One project: income, cost by account against the budget, and the lines behind them.
export function projectPnl(lines, accounts, centre, project, { company, from, to } = {}) {
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
  const codes = [...new Set([...Object.keys(budgetBy), ...Object.keys(cost)])].sort()
  const rows = codes.map(code => {
    const a = accounts.find(x => x.code === code)
    const b = budgetBy[code] || 0, act = cost[code] || 0
    return { code, name: a?.name || code, budget: b, actual: act, remaining: r2(b - act), pct: b ? r2(act * 100 / b) : null, over: b > 0 ? act > b + 0.5 : act > 0.5 && budgetLines.length > 0 }
  })
  const incomeRows = Object.entries(income).map(([code, amount]) => ({ code, name: accounts.find(x => x.code === code)?.name || code, amount }))
  const billed = r2(Object.values(income).reduce((s, x) => s + x, 0))
  const actualCost = r2(Object.values(cost).reduce((s, x) => s + x, 0))
  const budgetCost = r2(budgetLines.reduce((s, b) => s + num(b.amount), 0))
  const contractValue = num(budget.contractValue) || num(project?.contractValue)
  const expectedCost = Math.max(budgetCost, actualCost)                  // once spending passes the budget, the actual is the better forecast
  return {
    centre, project, contractValue, billed, billedPct: contractValue ? r2(billed * 100 / contractValue) : null,
    budgetCost, actualCost, costPct: budgetCost ? r2(actualCost * 100 / budgetCost) : null,
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
