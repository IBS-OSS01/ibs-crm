// Statement builders on top of the derived ledger lines:
//   Trading & Profit-and-Loss account (Tally layout), Cash-flow (receipts & payments by
//   counter-account class), ratio analysis, cost-centre summary, budget vs actual.
import { num, r2 } from './financeConstants.js'

const inRange = (l, company, from, to) => (!company || l.company === company) && (!from || (l.date || '') >= from) && (!to || (l.date || '') <= to)

// Net balance (debit − credit) of an account up to a date.
export const balanceUpTo = (lines, code, { company, asOf }) =>
  r2(lines.filter(l => l.accountCode === code && (!company || l.company === company) && (!asOf || (l.date || '') <= asOf)).reduce((s, l) => s + num(l.debit) - num(l.credit), 0))

const DIRECT_EXPENSE = new Set(['5000', '5195'])
const dayBefore = (d) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

// ── Trading & P&L ───────────────────────────────────────────────────────────
export function tradingPL(lines, accounts, { company, from, to }) {
  const byCode = {}
  lines.filter(l => inRange(l, company, from, to)).forEach(l => {
    const b = (byCode[l.accountCode] = byCode[l.accountCode] || { debit: 0, credit: 0 })
    b.debit += num(l.debit); b.credit += num(l.credit)
  })
  const net = (code, side) => r2(side === 'cr' ? (byCode[code]?.credit || 0) - (byCode[code]?.debit || 0) : (byCode[code]?.debit || 0) - (byCode[code]?.credit || 0))

  const openingBase = balanceUpTo(lines, '1400', { company, asOf: dayBefore(from) })
  const introduced = r2(lines.filter(l => l.accountCode === '1400' && l.sourceDocNumber === 'Opening Stock' && inRange(l, company, from, to)).reduce((s, l) => s + num(l.debit) - num(l.credit), 0))
  const openingStock = r2(openingBase + introduced)
  const closingStock = balanceUpTo(lines, '1400', { company, asOf: to })
  const stockAdjNet = net('5010', 'dr')                               // what the stock valuation posted
  const residualStock = r2(stockAdjNet + (closingStock - openingStock))   // manual journals to 1400 / 5010 that the stock ledger didn't make

  const incomeAccts = accounts.filter(a => a.type === 'income' && byCode[a.code])
  const expAccts = accounts.filter(a => a.type === 'expense' && byCode[a.code] && a.code !== '5010')
  const sales = net('4000', 'cr')
  const otherIncome = incomeAccts.filter(a => a.code !== '4000').map(a => ({ code: a.code, name: a.name, amount: net(a.code, 'cr') })).filter(r => Math.abs(r.amount) > 0.004)
  const direct = expAccts.filter(a => DIRECT_EXPENSE.has(a.code)).map(a => ({ code: a.code, name: a.name, amount: net(a.code, 'dr') })).filter(r => Math.abs(r.amount) > 0.004)
  const indirect = expAccts.filter(a => !DIRECT_EXPENSE.has(a.code)).map(a => ({ code: a.code, name: a.name, amount: net(a.code, 'dr') })).filter(r => Math.abs(r.amount) > 0.004)

  const purchases = direct.find(d => d.code === '5000')?.amount || 0
  const otherDirect = r2(direct.filter(d => d.code !== '5000').reduce((s, d) => s + d.amount, 0))
  const cogs = r2(openingStock + purchases + otherDirect + residualStock - closingStock)
  const grossProfit = r2(sales - cogs)
  const totalOtherIncome = r2(otherIncome.reduce((s, r) => s + r.amount, 0))
  const totalIndirect = r2(indirect.reduce((s, r) => s + r.amount, 0))
  const netProfit = r2(grossProfit + totalOtherIncome - totalIndirect)
  return { sales, openingStock, closingStock, purchases, otherDirect, direct, residualStock, cogs, grossProfit, otherIncome, totalOtherIncome, indirect, totalIndirect, netProfit, from, to }
}

// ── Cash flow (receipts & payments) ─────────────────────────────────────────
export const CASH_CODES = new Set(['1100', '1110'])
const classOf = (acct) => {
  if (!acct) return ['operating', 'Other']
  if (acct.code === '1500') return ['investing', 'Fixed assets']
  if (/deposit|\bfd\b|trust|invest|bond|mutual/i.test(acct.name || '') && acct.type === 'asset') return ['investing', 'Fixed deposits & investments']
  if (acct.type === 'equity') return ['financing', 'Capital / equity']
  if (acct.code === '3200') return ['financing', 'Opening balances']
  if (acct.code === '2900') return ['financing', 'Loans & other liabilities']
  if (acct.code === '1200') return ['operating', 'Customers (receivables)']
  if (acct.code === '2100') return ['operating', 'Vendors (payables)']
  if (['1301', '1302', '1303', '2401', '2402', '2403', '2404'].includes(acct.code)) return ['operating', 'GST']
  if (['2500', '1310'].includes(acct.code)) return ['operating', 'TDS']
  if (acct.type === 'income') return ['operating', 'Income']
  if (acct.type === 'expense') return ['operating', 'Expenses']
  return ['operating', acct.name]
}

export function cashFlow(lines, accounts, { company, from, to }) {
  const opening = r2(lines.filter(l => CASH_CODES.has(l.accountCode) && (!company || l.company === company) && (l.date || '') < from).reduce((s, l) => s + num(l.debit) - num(l.credit), 0))
  const docs = {}
  lines.filter(l => inRange(l, company, from, to)).forEach(l => { (docs[`${l.sourceType}:${l.sourceId}`] = docs[`${l.sourceType}:${l.sourceId}`] || []).push(l) })
  const rows = {}
  let net = 0, transfers = 0
  Object.values(docs).forEach(ls => {
    const cash = ls.filter(l => CASH_CODES.has(l.accountCode)), other = ls.filter(l => !CASH_CODES.has(l.accountCode))
    const cashNet = r2(cash.reduce((s, l) => s + num(l.debit) - num(l.credit), 0))
    if (!cash.length || Math.abs(cashNet) < 0.005) return
    if (!other.length) { transfers += cashNet; return }              // contra between own accounts nets to zero
    // TDS lines never move cash themselves — the cash effect belongs to the party / expense they were deducted from.
    const nonTds = other.some(l => !['1310', '2500'].includes(l.accountCode))
    const w = other.map(l => (nonTds && ['1310', '2500'].includes(l.accountCode)) ? 0 : Math.abs(num(l.debit) - num(l.credit)))
    const tw = w.reduce((a, b) => a + b, 0) || 1
    other.forEach((l, i) => {
      const [section, label] = classOf(accounts.find(a => a.code === l.accountCode))
      const k = `${section}|${label}`
      rows[k] = rows[k] || { section, label, inflow: 0, outflow: 0 }
      const part = r2(cashNet * w[i] / tw)
      if (part >= 0) rows[k].inflow = r2(rows[k].inflow + part); else rows[k].outflow = r2(rows[k].outflow - part)
    })
    net += cashNet
  })
  const sections = ['operating', 'investing', 'financing'].map(s => {
    const items = Object.values(rows).filter(r => r.section === s).sort((a, b) => a.label.localeCompare(b.label))
    return { section: s, items, inflow: r2(items.reduce((t, r) => t + r.inflow, 0)), outflow: r2(items.reduce((t, r) => t + r.outflow, 0)) }
  })
  const netChange = r2(sections.reduce((t, s) => t + s.inflow - s.outflow, 0))
  return { opening, sections, netChange, closing: r2(opening + netChange), transfers: r2(transfers) }
}

// ── Ratios ──────────────────────────────────────────────────────────────────
export function ratios(lines, accounts, { company, from, to }) {
  const bal = (code) => balanceUpTo(lines, code, { company, asOf: to })
  const cash = r2(bal('1100') + bal('1110')), receivables = bal('1200'), stock = bal('1400')
  const currentAssets = r2(cash + receivables + stock + bal('1301') + bal('1302') + bal('1303') + bal('1310') + bal('1900'))
  const payables = r2(-bal('2100'))
  const currentLiab = r2(payables + -(bal('2401') + bal('2402') + bal('2403') + bal('2404')) + -bal('2500') + -bal('2900'))
  const pl = tradingPL(lines, accounts, { company, from, to })
  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1)
  const div = (a, b) => (Math.abs(b) < 0.005 ? null : r2(a / b))
  return {
    cash, receivables, stock, payables, currentAssets, currentLiab, netProfit: pl.netProfit, sales: pl.sales, grossProfit: pl.grossProfit, days,
    items: [
      { key: 'current', label: 'Current ratio', value: div(currentAssets, currentLiab), hint: 'Current assets ÷ current liabilities. Above 1.5 is generally comfortable.' },
      { key: 'quick', label: 'Quick ratio', value: div(currentAssets - stock, currentLiab), hint: '(Current assets − stock) ÷ current liabilities.' },
      { key: 'gm', label: 'Gross margin %', value: div(pl.grossProfit * 100, pl.sales), hint: 'Gross profit ÷ sales.' },
      { key: 'nm', label: 'Net margin %', value: div(pl.netProfit * 100, pl.sales), hint: 'Net profit ÷ sales.' },
      { key: 'dso', label: 'Debtor days', value: div(receivables * days, pl.sales), hint: 'Receivables ÷ sales × days in period.' },
      { key: 'dpo', label: 'Creditor days', value: div(payables * days, pl.purchases), hint: 'Payables ÷ purchases × days in period.' },
      { key: 'dio', label: 'Stock days', value: div(stock * days, pl.cogs), hint: 'Closing stock ÷ cost of goods × days in period.' },
      { key: 'turn', label: 'Stock turnover (×)', value: div(pl.cogs, stock), hint: 'Cost of goods ÷ closing stock.' },
    ],
  }
}

// ── Cost centres & budgets ──────────────────────────────────────────────────
export function costCentreSummary(lines, accounts, { company, from, to }) {
  const m = {}
  lines.filter(l => inRange(l, company, from, to) && l.costCentreId).forEach(l => {
    const a = accounts.find(x => x.code === l.accountCode); if (!a || !['income', 'expense'].includes(a.type)) return
    const r = (m[l.costCentreId] = m[l.costCentreId] || { id: l.costCentreId, income: 0, expense: 0, byAccount: {} })
    const amt = a.type === 'income' ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)
    r[a.type] = r2(r[a.type] + amt)
    r.byAccount[a.code] = r2((r.byAccount[a.code] || 0) + amt)
  })
  return Object.values(m).map(r => ({ ...r, net: r2(r.income - r.expense) }))
}

// budgets: [{ company, fy, accountCode, costCentreId?, amount }] annual → pro-rated by months elapsed in the chosen period
export function budgetVsActual(lines, accounts, budgets, { company, from, to }) {
  const fyMonthsTotal = 12
  const monthsInPeriod = Math.max(1, (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1)
  return budgets.filter(b => b.company === company).map(b => {
    const a = accounts.find(x => x.code === b.accountCode); if (!a) return null
    const actual = r2(lines.filter(l => l.accountCode === b.accountCode && inRange(l, company, from, to) && (!b.costCentreId || l.costCentreId === b.costCentreId)).reduce((s, l) => s + (a.type === 'income' ? num(l.credit) - num(l.debit) : num(l.debit) - num(l.credit)), 0))
    const budget = r2(num(b.amount) * monthsInPeriod / fyMonthsTotal)
    return { ...b, account: a, actual, budget, variance: r2(actual - budget), pct: budget ? r2((actual - budget) * 100 / budget) : null }
  }).filter(Boolean)
}

