// Zoho-Books-style dashboard sections, drawn from the same derived ledger as every report:
//   • Total receivables / payables (current vs overdue)  • Cash flow for the financial year  • Income & expense by month
//   • Top expenses. Charts are plain SVG — no chart library.
import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { balanceUpTo, tradingPL, cashFlow } from '../utils/financialStatements.js'
import { fmtAmt, r2, currentFY, fyRange, todayStr } from '../utils/financeConstants.js'
import { cardCls } from './FinanceUI.jsx'

const MONTH = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const inr = (n) => '₹' + fmtAmt(n)
// 3,52,43,432 → 3.5 Cr style for axis labels
const short = (n) => { const a = Math.abs(n); const s = n < 0 ? '-' : ''; return a >= 1e7 ? `${s}${(a / 1e7).toFixed(1)} Cr` : a >= 1e5 ? `${s}${(a / 1e5).toFixed(1)} L` : a >= 1e3 ? `${s}${(a / 1e3).toFixed(0)} K` : `${s}${Math.round(a)}` }
const monthEnd = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`
const monthStart = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}-01`

function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p }

function CardHead({ title, right, onTitle }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
      <button onClick={onTitle} className={`font-semibold text-slate-800 text-[15px] ${onTitle ? 'hover:text-blue-700' : 'cursor-default'}`}>{title}</button>
      {right}
    </div>
  )
}

// ── Receivables / payables ──────────────────────────────────────────────────────
function DuesCard({ title, subtitle, data, onNew, newLabel, path }) {
  const navigate = useNavigate()
  const bills = data.parties.flatMap(p => p.bills)
  const overdue = r2(bills.filter(b => b.daysOverdue > 0).reduce((s, b) => s + b.pending, 0))
  const total = data.totals.total
  const current = r2(total - overdue)
  const pct = total > 0 ? Math.min(100, Math.max(0, current / total * 100)) : 0
  return (
    <div className={cardCls}>
      <CardHead title={title} onTitle={() => navigate(path)} right={<button onClick={onNew} className="text-sm text-blue-600 hover:text-blue-800 font-medium">⊕ {newLabel}</button>} />
      <div className="p-5">
        <p className="text-xs text-slate-500">{subtitle}</p>
        <p className="text-2xl font-semibold text-slate-900 mt-1">{inr(total)}</p>
        <div className="mt-4 h-2.5 rounded bg-slate-100 overflow-hidden flex">
          {total > 0 && <><div className="bg-blue-600 h-full" style={{ width: `${pct}%` }} /><div className="bg-orange-500 h-full" style={{ width: `${100 - pct}%` }} /></>}
        </div>
        <div className="flex justify-between flex-wrap gap-2 mt-3 text-sm">
          <button onClick={() => navigate(path)} className="text-slate-600 hover:underline"><span className="inline-block w-2 h-2 bg-blue-600 mr-1.5" />Current : <b className="text-slate-800">{inr(current)}</b></button>
          <button onClick={() => navigate(path)} className="text-slate-600 hover:underline"><span className="inline-block w-2 h-2 bg-orange-500 mr-1.5" />Overdue : <b className="text-slate-800">{inr(overdue)}</b></button>
        </div>
      </div>
    </div>
  )
}
export function DuesRow({ recv, pay }) {
  const navigate = useNavigate()
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <DuesCard title="Total Receivables" subtitle="Total unpaid invoices" data={recv} path="/finance/outstanding/receivables" newLabel="New" onNew={() => navigate('/finance/invoices')} />
      <DuesCard title="Total Payables" subtitle="Total unpaid bills" data={pay} path="/finance/outstanding/payables" newLabel="New" onNew={() => navigate('/finance/vouchers/purchase?new=1')} />
    </div>
  )
}

// ── Cash flow ───────────────────────────────────────────────────────────────────
export function CashFlowCard({ allLines, accounts, company }) {
  const navigate = useNavigate()
  const today = todayStr()
  const fy = currentFY(), { from, to } = fyRange(fy)
  const y0 = Number(from.slice(0, 4))
  const d = useMemo(() => {
    const cf = cashFlow(allLines, accounts, { company, from, to: today })
    const incoming = r2(cf.sections.reduce((s, x) => s + x.inflow, 0)), outgoing = r2(cf.sections.reduce((s, x) => s + x.outflow, 0))
    const pts = []
    for (let i = 0; i < 12; i++) {
      const y = i < 9 ? y0 : y0 + 1, m = (i + 3) % 12
      if (monthStart(y, m) > today) break
      const end = monthEnd(y, m) < today ? monthEnd(y, m) : today
      pts.push({ label: MONTH[i], v: r2(balanceUpTo(allLines, '1100', { company, asOf: end }) + balanceUpTo(allLines, '1110', { company, asOf: end })) })
    }
    return { cf, incoming, outgoing, pts }
  }, [allLines, accounts, company, from, today, y0])

  const W = 560, H = 230, L = 46, R = 12, T = 14, B = 26
  const vals = d.pts.map(p => p.v)
  const hi = niceMax(Math.max(...vals, 1)), lo = Math.min(0, ...vals) < 0 ? -niceMax(-Math.min(...vals)) : 0
  const x = (i) => L + (W - L - R) * (i / 11), y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo))
  const line = d.pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = d.pts.length ? `${line} L${x(d.pts.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z` : ''
  const ticks = [0, 1, 2, 3, 4].map(k => lo + (hi - lo) * k / 4)
  const dm = (s) => s.split('-').reverse().join('/')
  return (
    <div className={cardCls}>
      <CardHead title="Cash Flow" onTitle={() => navigate('/finance/statements/cashflow')} right={<span className="text-xs text-slate-500">This Fiscal Year · {fy}</span>} />
      <div className="p-5 grid lg:grid-cols-[1fr_16rem] gap-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Cash balance by month">
          {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray="3 3" /><text x={L - 6} y={y(t) + 3} fontSize="9" textAnchor="end" fill="#64748b">{short(t)}</text></g>)}
          {MONTH.map((m, i) => <text key={m} x={x(i)} y={H - 8} fontSize="9" textAnchor="middle" fill="#64748b">{m}</text>)}
          {area && <path d={area} fill="#3b82f6" opacity="0.12" />}
          {line && <path d={line} fill="none" stroke="#3b82f6" strokeWidth="2" />}
          {d.pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r="3" fill="#3b82f6"><title>{p.label}: {inr(p.v)}</title></circle>)}
        </svg>
        <div className="space-y-4 text-sm lg:text-right">
          <div><p className="text-xs text-slate-500">Cash as on {dm(from)}</p><p className="font-semibold text-slate-900">{inr(d.cf.opening)}</p></div>
          <div><p className="text-xs text-green-600">● Incoming</p><p className="font-semibold text-slate-900">{inr(d.incoming)} <span className="text-slate-400">( + )</span></p></div>
          <div><p className="text-xs text-red-500">● Outgoing</p><p className="font-semibold text-slate-900">{inr(d.outgoing)} <span className="text-slate-400">( − )</span></p></div>
          <div><p className="text-xs text-blue-600">● Cash as on {dm(today)}</p><p className="font-semibold text-slate-900">{inr(d.cf.closing)} <span className="text-slate-400">( = )</span></p></div>
          <p className="text-[11px] text-slate-400">Transfers between your own accounts are left out.</p>
        </div>
      </div>
    </div>
  )
}

// ── Income and expense ──────────────────────────────────────────────────────────
export function IncomeExpenseCard({ allLines, accounts, company }) {
  const navigate = useNavigate()
  const today = todayStr()
  const fy = currentFY(), { from } = fyRange(fy)
  const y0 = Number(from.slice(0, 4))
  const d = useMemo(() => {
    const rows = []
    for (let i = 0; i < 12; i++) {
      const y = i < 9 ? y0 : y0 + 1, m = (i + 3) % 12
      if (monthStart(y, m) > today) { rows.push({ label: MONTH[i], inc: 0, exp: 0, future: true }); continue }
      const p = tradingPL(allLines, accounts, { company, from: monthStart(y, m), to: monthEnd(y, m) })
      rows.push({ label: MONTH[i], inc: r2(p.sales + p.totalOtherIncome), exp: r2(p.cogs + p.totalIndirect) })
    }
    return { rows, inc: r2(rows.reduce((s, r) => s + r.inc, 0)), exp: r2(rows.reduce((s, r) => s + r.exp, 0)) }
  }, [allLines, accounts, company, today, y0])
  const W = 520, H = 200, L = 44, R = 8, T = 10, B = 24
  const hi = niceMax(Math.max(...d.rows.flatMap(r => [r.inc, r.exp]), 1))
  const step = (W - L - R) / 12, bw = Math.min(10, step / 2 - 2)
  const y = (v) => T + (H - T - B) * (1 - v / hi)
  return (
    <div className={cardCls}>
      <CardHead title="Income and Expense" onTitle={() => navigate('/finance/statements/trading')} right={<span className="text-xs text-slate-500">This Fiscal Year</span>} />
      <div className="p-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Income and expense by month">
          {[0, 1, 2, 3, 4].map(k => { const t = hi * k / 4; return <g key={k}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray="3 3" /><text x={L - 5} y={y(t) + 3} fontSize="9" textAnchor="end" fill="#64748b">{short(t)}</text></g> })}
          {d.rows.map((r, i) => { const cx = L + step * i + step / 2; return (
            <g key={r.label}>
              {!r.future && <><rect x={cx - bw - 1} y={y(r.inc)} width={bw} height={Math.max(0, y(0) - y(r.inc))} fill="#22c55e"><title>{r.label} income {inr(r.inc)}</title></rect>
                <rect x={cx + 1} y={y(r.exp)} width={bw} height={Math.max(0, y(0) - y(r.exp))} fill="#ef4444"><title>{r.label} expense {inr(r.exp)}</title></rect></>}
              <text x={cx} y={H - 8} fontSize="9" textAnchor="middle" fill="#64748b">{r.label}</text>
            </g>) })}
        </svg>
        <div className="flex flex-wrap gap-x-8 gap-y-1 mt-2 text-sm">
          <span className="text-slate-600"><span className="inline-block w-2 h-2 bg-green-500 mr-1.5" />Total Income <b className="text-slate-900 ml-1">{inr(d.inc)}</b></span>
          <span className="text-slate-600"><span className="inline-block w-2 h-2 bg-red-500 mr-1.5" />Total Expenses <b className="text-slate-900 ml-1">{inr(d.exp)}</b></span>
        </div>
      </div>
    </div>
  )
}

// ── Top expenses ────────────────────────────────────────────────────────────────
const SLICE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#94a3b8']
export function TopExpensesCard({ allLines, accounts, company }) {
  const navigate = useNavigate()
  const today = todayStr()
  const { from } = fyRange(currentFY())
  const d = useMemo(() => {
    const p = tradingPL(allLines, accounts, { company, from, to: today })
    const rows = [...(p.cogs > 0.5 ? [{ name: 'Cost of goods sold', amount: p.cogs }] : []), ...p.indirect.filter(r => r.amount > 0.5)].sort((a, b) => b.amount - a.amount)
    const top = rows.slice(0, 5), rest = r2(rows.slice(5).reduce((s, r) => s + r.amount, 0))
    if (rest > 0) top.push({ name: 'Others', amount: rest })
    return { rows: top, total: r2(rows.reduce((s, r) => s + r.amount, 0)) }
  }, [allLines, accounts, company, from, today])
  const R = 62, C = 2 * Math.PI * R
  let off = 0
  return (
    <div className={cardCls}>
      <CardHead title="Top Expenses" onTitle={() => navigate('/finance/statements/trading')} right={<span className="text-xs text-slate-500">This Fiscal Year</span>} />
      <div className="p-5 flex items-center gap-6 flex-wrap">
        {d.total > 0 ? (<>
          <svg viewBox="0 0 160 160" className="w-40 h-40 shrink-0" role="img" aria-label="Expenses by account">
            <g transform="rotate(-90 80 80)">
              {d.rows.map((r, i) => { const len = C * r.amount / d.total; const el = <circle key={r.name} cx="80" cy="80" r={R} fill="none" stroke={SLICE[i % SLICE.length]} strokeWidth="22" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off}><title>{r.name}: {inr(r.amount)}</title></circle>; off += len; return el })}
            </g>
            <text x="80" y="76" textAnchor="middle" fontSize="9" fill="#64748b">Total</text>
            <text x="80" y="92" textAnchor="middle" fontSize="12" fontWeight="600" fill="#0f172a">{short(d.total)}</text>
          </svg>
          <ul className="text-sm space-y-1.5 flex-1 min-w-[10rem]">
            {d.rows.map((r, i) => <li key={r.name} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SLICE[i % SLICE.length] }} /><span className="flex-1 truncate text-slate-600">{r.name}</span><b className="text-slate-800">{inr(r.amount)}</b></li>)}
          </ul>
        </>) : <p className="text-sm text-slate-400 py-6">No expenses booked in this financial year yet.</p>}
      </div>
    </div>
  )
}
