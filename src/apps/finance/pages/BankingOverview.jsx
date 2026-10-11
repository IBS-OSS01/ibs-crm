// Banking overview — the one screen for money: cash and bank balances per the books, what the bank statements say, and how many
// statement lines are still waiting to be matched, per account. Everything comes from the derived ledger and the imported
// statements, so it agrees with Bank Reconciliation and the Trial Balance.
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { bookEntries, reconciliation } from '../utils/bankRecon.js'
import { balanceUpTo, cashFlow } from '../utils/financialStatements.js'
import { fmtAmt, todayStr, r2, currentFY, fyRange } from '../utils/financeConstants.js'
import { cardCls, btnGhost, btnPrimary, useFinancePerms } from '../components/FinanceUI.jsx'

const COMPANY = 'UIPL'
const inr = (n) => (n < 0 ? '−' : '') + '₹' + fmtAmt(Math.abs(n))
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const dmy = (s) => (s ? s.split('-').reverse().join('/') : '')
const PERIODS = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', fy: 'This financial year' }

const Icon = ({ d, cls }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}><path d={d} /></svg>
const I_CASH = 'M3 12h4l3 3h5a2 2 0 000-4H9M3 9v8M21 9l-5 3'
const I_BANK = 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18'
const I_IN = 'M12 4v12M7 11l5 5 5-5M5 20h14'
const I_OUT = 'M12 20V8M7 13l5-5 5 5M5 4h14'

function Tile({ icon, tone, label, value, sub }) {
  return (
    <div className="flex items-center gap-3 min-w-[11rem]">
      <span className={`w-11 h-11 rounded-lg flex items-center justify-center ${tone}`}><Icon d={icon} /></span>
      <div><p className="text-xs text-slate-500">{label}</p><p className="text-lg font-semibold text-slate-900 leading-tight">{value}</p>{sub && <p className="text-[11px] text-slate-400">{sub}</p>}</div>
    </div>
  )
}

export default function BankingOverview() {
  const navigate = useNavigate()
  const { canWrite } = useFinancePerms()
  const { raw, allLines, accounts, loading } = useFinanceData(['bankStatements'])
  const today = todayStr()
  const [period, setPeriod] = useState('30')
  const [chart, setChart] = useState(false)
  const [open, setOpen] = useState('')
  const from = period === 'fy' ? fyRange(currentFY()).from : addDays(today, -Number(period))

  const rows = useMemo(() => {
    if (!raw) return []
    const banks = (raw.bankAccounts || []).filter(b => b.company === COMPANY && b.type !== 'cash' && b.type !== 'fd' && b.active !== false)
    const hasUnassigned = allLines.some(l => l.accountCode === '1100' && l.company === COMPANY && !l.bankAccountId && l.sourceType !== 'opening')
    const list = banks.map(b => ({ id: b.id, title: b.name, sub: [b.bankName, b.accountNumber && `••${String(b.accountNumber).slice(-4)}`, b.ifsc].filter(Boolean).join(' · ') }))
    if (hasUnassigned) list.unshift({ id: '', title: 'Bank (default / unassigned)', sub: 'Entries not tagged to a bank account' })
    return list.map(b => {
      const entries = bookEntries(allLines, { company: COMPANY, bankAccountId: b.id })
      const st = (raw.bankStatements || []).filter(x => x.company === COMPANY && (x.bankAccountId || '') === b.id)
      const r = reconciliation(st, entries, today)
      const last = st.reduce((m, x) => (x.date > m ? x.date : m), '')
      return { ...b, entries, lines: st.length, unmatched: st.filter(x => !x.matchedKey && x.date <= today).length, last, inBank: r.stmtBalance, inBooks: r.bookBalance, diff: r.difference, recent: entries.filter(e => !e.opening).slice(-5).reverse() }
    })
  }, [raw, allLines, today])

  // fixed deposits: each FD is a sub-ledger of 1520, tagged with its own id
  const fds = useMemo(() => (raw?.bankAccounts || []).filter(b => b.company === COMPANY && b.type === 'fd' && b.active !== false).map(b => {
    const ls = allLines.filter(l => l.accountCode === '1520' && l.company === COMPANY && l.bankAccountId === b.id && l.date <= today).sort((x, y) => x.date.localeCompare(y.date))
    const balance = r2(ls.reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0))
    const moves = ls.filter(l => l.sourceType !== 'opening')
    return { ...b, balance, moves: moves.length, last: moves.length ? moves[moves.length - 1].date : '', recent: moves.slice(-5).reverse(), linked: (raw.bankAccounts || []).find(x => x.id === b.linkedBankId)?.name || '' }
  }), [raw, allLines, today])
  const fdTotal = r2(fds.reduce((s, f) => s + f.balance, 0))

  const sum = useMemo(() => {
    if (!raw) return null
    const cash = balanceUpTo(allLines, '1110', { company: COMPANY, asOf: today })
    const bank = balanceUpTo(allLines, '1100', { company: COMPANY, asOf: today })
    const cf = cashFlow(allLines, accounts, { company: COMPANY, from, to: today })
    const inflow = r2(cf.sections.reduce((s, x) => s + x.inflow, 0)), outflow = r2(cf.sections.reduce((s, x) => s + x.outflow, 0))
    // month-end balances (bank + cash) for the last 12 months
    const pts = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0), e = end.toLocaleDateString('en-CA') > today ? today : end.toLocaleDateString('en-CA')
      pts.push({ label: d.toLocaleString('en-IN', { month: 'short' }), v: r2(balanceUpTo(allLines, '1100', { company: COMPANY, asOf: e }) + balanceUpTo(allLines, '1110', { company: COMPANY, asOf: e })) })
    }
    return { cash, bank, inflow, outflow, pts, unmatched: rows.reduce((s, r) => s + r.unmatched, 0) }
  }, [raw, allLines, accounts, from, today, rows])

  if (loading || !sum) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  const W = 640, H = 170, L = 52, R = 10, T = 10, B = 22
  const vs = sum.pts.map(p => p.v), hi = Math.max(...vs, 1), lo = Math.min(...vs, 0)
  const x = (i) => L + (W - L - R) * i / 11, y = (v) => T + (H - T - B) * (1 - (v - lo) / ((hi - lo) || 1))
  const line = sum.pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="text-2xl font-bold text-slate-900 tracking-tight">Banking Overview</h2><p className="text-slate-500 text-sm">Balances per the books, bank statements and what is waiting to be matched · as of {dmy(today)}</p></div>
        <div className="flex gap-2 flex-wrap">
          <button className={btnGhost} onClick={() => navigate('/finance/vouchers/contra?new=1')}>Transfer</button>
          <button className={btnGhost} onClick={() => navigate('/finance/bank-recon')}>Import statement</button>
          {canWrite && <button className={btnPrimary} onClick={() => navigate('/finance/banking')}>+ Add bank account</button>}
        </div>
      </div>

      <div className={cardCls}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <p className="text-lg font-semibold text-slate-800">All accounts</p>
          <select value={period} onChange={e => setPeriod(e.target.value)} className="text-sm text-blue-700 bg-transparent font-medium focus:outline-none cursor-pointer">{Object.entries(PERIODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
        <div className="p-5 flex flex-wrap gap-x-10 gap-y-4 items-center">
          <Tile icon={I_CASH} tone="bg-slate-100 text-slate-500" label="Cash in hand" value={inr(sum.cash)} />
          <Tile icon={I_BANK} tone="bg-green-50 text-green-600" label="Bank balance" value={inr(sum.bank)} sub={`${rows.length} account${rows.length === 1 ? '' : 's'}`} />
          {fds.length > 0 && <Tile icon={I_BANK} tone="bg-indigo-50 text-indigo-600" label="Fixed deposits" value={inr(fdTotal)} sub={`${fds.length} FD${fds.length === 1 ? '' : 's'}`} />}
          <Tile icon={I_IN} tone="bg-blue-50 text-blue-600" label={`Money in · ${PERIODS[period].toLowerCase()}`} value={inr(sum.inflow)} />
          <Tile icon={I_OUT} tone="bg-orange-50 text-orange-600" label={`Money out · ${PERIODS[period].toLowerCase()}`} value={inr(sum.outflow)} />
          <button onClick={() => navigate('/finance/bank-recon')} className="ml-auto flex items-center gap-3 text-left">
            <span className={`w-11 h-11 rounded-lg flex items-center justify-center text-xl font-bold ${sum.unmatched ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{sum.unmatched}</span>
            <span><span className="block text-sm font-semibold text-slate-800">Unmatched statement lines</span><span className="block text-xs text-blue-600">Reconcile now ▸</span></span>
          </button>
        </div>
        <div className="px-5 pb-4">
          <button onClick={() => setChart(c => !c)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">{chart ? '▾ Hide chart' : '▸ Show chart'}</button>
          {chart && (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-2" role="img" aria-label="Bank and cash balance by month">
              {[0, 1, 2, 3].map(k => { const t = lo + (hi - lo) * k / 3; return <g key={k}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray="3 3" /><text x={L - 6} y={y(t) + 3} fontSize="9" textAnchor="end" fill="#64748b">{Math.abs(t) >= 1e7 ? (t / 1e7).toFixed(1) + ' Cr' : Math.abs(t) >= 1e5 ? (t / 1e5).toFixed(1) + ' L' : Math.round(t / 1e3) + ' K'}</text></g> })}
              {sum.pts.map((p, i) => <text key={i} x={x(i)} y={H - 6} fontSize="9" textAnchor="middle" fill="#64748b">{p.label}</text>)}
              <path d={line} fill="none" stroke="#3b82f6" strokeWidth="2" />
              {sum.pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r="3" fill="#3b82f6"><title>{p.label}: {inr(p.v)}</title></circle>)}
            </svg>)}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2 px-1 flex-wrap gap-2"><h3 className="text-lg font-semibold text-slate-800">Fixed deposits &amp; sweep accounts</h3>
          <span className="flex gap-2"><button className={btnGhost} onClick={() => navigate('/finance/vouchers/contra?new=1')}>Sweep / transfer</button>{canWrite && <button className={btnPrimary} onClick={() => navigate('/finance/banking')}>+ Add fixed deposit</button>}</span></div>
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="text-left px-5 py-3">Fixed deposit</th><th className="text-left px-3 py-3">Linked account</th><th className="text-right px-3 py-3">Rate</th><th className="text-left px-3 py-3">Matures</th><th className="text-left px-3 py-3">Last movement</th><th className="text-right px-3 py-3">Amount in books</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {fds.map(f => (
                <React.Fragment key={f.id}>
                  <tr className="hover:bg-slate-50/60 cursor-pointer" onClick={() => setOpen(open === 'fd' + f.id ? '' : 'fd' + f.id)}>
                    <td className="px-5 py-3.5"><p className="font-medium text-slate-800">{f.name}</p><p className="text-xs text-slate-400">{[f.bankName, f.accountNumber && '••' + String(f.accountNumber).slice(-6)].filter(Boolean).join(' · ')}</p></td>
                    <td className="px-3 py-3.5 text-slate-600">{f.linked || '—'}</td><td className="px-3 py-3.5 text-right text-slate-600">{f.interestRate ? f.interestRate + '%' : '—'}</td>
                    <td className="px-3 py-3.5 text-slate-600">{f.maturityDate ? dmy(f.maturityDate) : 'Sweep (no fixed date)'}</td><td className="px-3 py-3.5 text-slate-500">{f.last ? dmy(f.last) : '—'}{f.moves ? <span className="text-xs text-slate-400"> · {f.moves} entries</span> : ''}</td>
                    <td className="px-3 py-3.5 text-right font-medium">{inr(f.balance)}</td></tr>
                  {open === 'fd' + f.id && <tr className="bg-slate-50/50"><td colSpan={6} className="px-5 py-3">{f.recent.length === 0 ? <p className="text-sm text-slate-400">No transfers yet — record a sweep as a Transfer (contra) between the current account and this FD.</p> : (
                    <table className="w-full text-xs"><tbody className="divide-y divide-slate-100">{f.recent.map((e, i) => <tr key={i}><td className="py-1.5 w-28 text-slate-500">{dmy(e.date)}</td><td className="font-mono text-slate-600 w-48">{e.sourceDocNumber}</td><td className="text-slate-700">{e.description}</td><td className={`text-right w-32 ${e.debit ? 'text-green-700' : 'text-slate-700'}`}>{e.debit ? 'in ' + fmtAmt(e.debit) : 'out ' + fmtAmt(e.credit)}</td></tr>)}</tbody></table>)}</td></tr>}
                </React.Fragment>))}
              {fds.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-400">No fixed deposits yet — add each sweep / term FD here, then record the sweeps as transfers.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-slate-800 mb-2 px-1">Active accounts</h3>
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
              <th className="text-left px-5 py-3">Account details</th><th className="text-left px-3 py-3">Statement</th><th className="text-right px-3 py-3">Amount in bank</th><th className="text-right px-3 py-3">Amount in books</th><th className="text-right px-3 py-3">Difference</th><th className="w-10" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <React.Fragment key={r.id || 'unassigned'}>
                  <tr className="hover:bg-slate-50/60 cursor-pointer" onClick={() => setOpen(open === r.id ? '' : r.id)}>
                    <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><Icon d={I_BANK} cls="scale-75" /></span>
                      <div><button onClick={e => { e.stopPropagation(); navigate(`/finance/bank-recon?bank=${r.id}`) }} className="font-medium text-blue-700 hover:underline text-left">{r.title}</button><p className="text-xs text-slate-400">{r.sub}{r.last ? ` · statement up to ${dmy(r.last)}` : ''}</p></div></div></td>
                    <td className="px-3 py-3.5">{r.lines === 0 ? <button onClick={e => { e.stopPropagation(); navigate(`/finance/bank-recon?bank=${r.id}`) }} className="text-xs text-blue-600 hover:underline">No statement yet — import</button>
                      : r.unmatched > 0 ? <button onClick={e => { e.stopPropagation(); navigate(`/finance/bank-recon?bank=${r.id}`) }} className="text-red-600 hover:underline">{r.unmatched} unmatched</button> : <span className="text-green-700">✓ all matched</span>}
                      {r.lines > 0 && <span className="block text-[11px] text-slate-400">{r.lines} lines</span>}</td>
                    <td className="px-3 py-3.5 text-right font-medium">{r.inBank === null ? <span className="text-slate-300">—</span> : inr(r.inBank)}</td>
                    <td className="px-3 py-3.5 text-right font-medium">{inr(r.inBooks)}</td>
                    <td className={`px-3 py-3.5 text-right text-xs ${r.diff === null ? 'text-slate-300' : Math.abs(r.diff) < 0.5 ? 'text-green-700' : 'text-red-600 font-semibold'}`}>{r.diff === null ? '—' : Math.abs(r.diff) < 0.5 ? '✓ reconciled' : inr(r.diff)}</td>
                    <td className="px-2 text-slate-400">{open === r.id ? '⌃' : '⌄'}</td>
                  </tr>
                  {open === r.id && (
                    <tr className="bg-slate-50/50"><td colSpan={6} className="px-5 py-3">
                      <div className="flex items-center justify-between mb-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Latest entries in the books</p>
                        <span className="flex gap-2"><button className={btnGhost} onClick={() => navigate(`/finance/bank-recon?bank=${r.id}`)}>Reconcile</button><button className={btnGhost} onClick={() => navigate('/finance/cashbank')}>Bank book</button></span></div>
                      {r.recent.length === 0 ? <p className="text-sm text-slate-400">No entries yet.</p> : (
                        <table className="w-full text-xs"><tbody className="divide-y divide-slate-100">{r.recent.map(e => (
                          <tr key={e.key}><td className="py-1.5 w-28 text-slate-500">{dmy(e.date)}</td><td className="font-mono text-slate-600 w-48">{e.number}</td><td className="text-slate-700">{e.party}</td>
                            <td className={`text-right w-32 ${e.debit ? 'text-green-700' : 'text-slate-700'}`}>{e.debit ? '+' + fmtAmt(e.debit) : '−' + fmtAmt(e.credit)}</td></tr>))}</tbody></table>)}
                    </td></tr>)}
                </React.Fragment>
              ))}
              <tr className="hover:bg-slate-50/60">
                <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><Icon d={I_CASH} cls="scale-75" /></span><div><button onClick={() => navigate('/finance/cashbank')} className="font-medium text-blue-700 hover:underline">Cash in hand</button><p className="text-xs text-slate-400">Petty cash — no statement</p></div></div></td>
                <td /><td className="px-3 text-right text-slate-300">—</td><td className="px-3 py-3.5 text-right font-medium">{inr(sum.cash)}</td><td /><td /></tr>
              {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-400">No bank accounts yet — use “Add bank account”.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-2 px-1">“Amount in bank” is the closing balance of the latest imported statement; “Amount in books” is the ledger balance. The difference is what is still unmatched.</p>
      </div>
    </div>
  )
}
