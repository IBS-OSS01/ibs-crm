import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { computeOutstanding, AGE_BUCKETS } from '../utils/outstanding.js'
import { fmtAmt, normName, todayStr } from '../utils/financeConstants.js'
import { downloadXlsx, downloadCsv, printReport } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, ExportBar, StatCard, Empty, inputCls, cardCls } from '../components/FinanceUI.jsx'

export default function Outstanding() {
  const { kind: kindParam } = useParams()
  const navigate = useNavigate()
  const kind = kindParam === 'payables' ? 'payable' : 'receivable'
  const { raw, allLines, loading } = useFinanceData()
  const [company, setCompany] = useState('UIPL')
  const [asOf, setAsOf] = useState(todayStr())
  const [ageBy, setAgeBy] = useState('due')
  const [expanded, setExpanded] = useState({})
  const [q, setQ] = useState('')

  const { parties, totals } = useMemo(
    () => computeOutstanding(allLines, { kind, company, asOf, ageBy }),
    [allLines, kind, company, asOf, ageBy])

  const masterByName = useMemo(() => {
    const m = {}
    ;(kind === 'receivable' ? raw?.customers || [] : raw?.vendors || []).forEach(c => {
      m[normName(kind === 'receivable' ? c.shopName : c.vendorName)] = c
    })
    return m
  }, [raw, kind])

  const shown = parties.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()))
  const overdue = totals.total - totals.notDue
  const label = kind === 'receivable' ? 'Receivables' : 'Payables'

  const sheets = () => ([
    { name: 'Party summary', rows: [['Party', 'Outstanding', ...AGE_BUCKETS.map(b => b.label), 'Advance / On account'],
      ...shown.map(p => [p.name, p.totalPending, ...AGE_BUCKETS.map(b => p.buckets[b.key]), p.advance]),
      ['TOTAL', totals.total, ...AGE_BUCKETS.map(b => totals[b.key]), totals.advance]] },
    { name: 'Bill-wise', rows: [['Party', 'Bill / Voucher', 'Their ref', 'Bill date', 'Due date', 'Original', 'Pending', 'Days overdue'],
      ...shown.flatMap(p => p.bills.map(b => [p.name, b.docNo, b.externalRef, b.date, b.dueDate, b.original, b.pending, Math.max(b.daysOverdue, 0)]))] },
  ])
  const title = `Outstanding ${label} — ${company} as on ${asOf}`

  const copyReminder = (p) => {
    const lines = p.bills.map(b => `• ${b.docNo}${b.externalRef ? ` (${b.externalRef})` : ''} dated ${b.date}, due ${b.dueDate}: ₹${fmtAmt(b.pending)}${b.daysOverdue > 0 ? ` — ${b.daysOverdue} days overdue` : ''}`).join('\n')
    const text = `Dear ${p.name},\n\nThis is a gentle reminder of the following outstanding amount as on ${asOf}:\n\n${lines}\n\nTotal outstanding: ₹${fmtAmt(p.totalPending)}\n\nKindly arrange the payment at the earliest. Please ignore this if already paid.\n\nRegards`
    navigator.clipboard?.writeText(text)
    alert('Reminder text copied — paste it into WhatsApp or email.')
  }

  return (
    <ReportShell title={`Outstanding ${label}`} loading={loading}
      subtitle="Bill-wise pending amounts with ageing. Receipts, credit notes and payments are matched to bills by reference first, then oldest-first."
      exportBar={<ExportBar onXlsx={() => downloadXlsx(title, sheets())} onCsv={() => downloadCsv(title, sheets()[0].rows)} onPrint={() => printReport({ title: `Outstanding ${label}`, subtitle: `${company} · as on ${asOf}`, rows: sheets()[0].rows })} />}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {[['receivables', 'Receivables'], ['payables', 'Payables']].map(([k, l]) => (
            <button key={k} onClick={() => navigate(`/finance/outstanding/${k}`)} className={`px-3 py-1.5 font-medium ${(kind === 'payable') === (k === 'payables') ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">As on <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={inputCls} /></label>
        <select value={ageBy} onChange={e => setAgeBy(e.target.value)} className={inputCls}>
          <option value="due">Age by due date</option><option value="bill">Age by bill date</option>
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search party…" className={`${inputCls} w-48`} />
      </>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={`Total ${label.toLowerCase()}`} value={`₹${fmtAmt(totals.total)}`} tone="blue" sub={`${parties.length} parties`} />
        <StatCard label="Overdue" value={`₹${fmtAmt(overdue)}`} tone={overdue > 0 ? 'red' : 'green'} sub={totals.total ? `${Math.round(overdue / totals.total * 100)}% of total` : ''} />
        <StatCard label="Not yet due" value={`₹${fmtAmt(totals.notDue)}`} tone="green" />
        <StatCard label={kind === 'receivable' ? 'Advances received (on account)' : 'Advances paid (on account)'} value={`₹${fmtAmt(totals.advance)}`} tone="amber" />
      </div>

      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr><th className="text-left px-4 py-3">Party</th><th className="text-right px-3 py-3">Outstanding</th>
              {AGE_BUCKETS.map(b => <th key={b.key} className="text-right px-3 py-3 whitespace-nowrap">{b.label}</th>)}
              <th className="text-right px-3 py-3">Advance</th><th className="px-3 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map(p => {
              const master = masterByName[normName(p.name)]
              const limit = Number(master?.creditLimit) || 0
              const overLimit = kind === 'receivable' && limit > 0 && p.totalPending > limit
              return (
                <React.Fragment key={p.key}>
                  <tr className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800 cursor-pointer" onClick={() => setExpanded(e => ({ ...e, [p.key]: !e[p.key] }))}>
                      <span className="text-slate-400 mr-1">{expanded[p.key] ? '▾' : '▸'}</span>{p.name}
                      {overLimit && <span className="ml-2 text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded-lg font-bold" title={`Credit limit ₹${fmtAmt(limit)}`}>over credit limit</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-slate-800">{fmtAmt(p.totalPending)}</td>
                    {AGE_BUCKETS.map(b => <td key={b.key} className={`px-3 py-2.5 text-right ${b.key !== 'notDue' && p.buckets[b.key] > 0 ? 'text-red-600' : 'text-slate-500'}`}>{p.buckets[b.key] ? fmtAmt(p.buckets[b.key]) : '—'}</td>)}
                    <td className="px-3 py-2.5 text-right text-amber-600">{p.advance ? fmtAmt(p.advance) : '—'}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-2">
                      <button onClick={() => navigate(`/finance/ledger?mode=${kind === 'receivable' ? 'customer' : 'vendor'}&company=${company}&party=${encodeURIComponent(p.key)}`)} className="text-xs text-blue-600 hover:underline">Statement</button>
                      {kind === 'receivable' && p.totalPending > 0 && <button onClick={() => copyReminder(p)} className="text-xs text-slate-500 hover:underline">Reminder</button>}
                    </td>
                  </tr>
                  {expanded[p.key] && (
                    <tr className="bg-slate-50/70"><td colSpan={AGE_BUCKETS.length + 4} className="px-4 py-2">
                      <table className="w-full text-xs">
                        <thead className="text-slate-400 uppercase"><tr><th className="text-left py-1">Bill</th><th className="text-left">Their ref</th><th className="text-left">Bill date</th><th className="text-left">Due date</th><th className="text-right">Original</th><th className="text-right">Pending</th><th className="text-right">Overdue</th></tr></thead>
                        <tbody>{p.bills.map(b => (
                          <tr key={b.billKey} className="border-t border-slate-200/60">
                            <td className="py-1 font-mono">{b.docNo}</td><td>{b.externalRef}</td><td>{b.date}</td><td>{b.dueDate}</td>
                            <td className="text-right">{fmtAmt(b.original)}</td><td className="text-right font-medium">{fmtAmt(b.pending)}{b.currency && <span className="block text-[10px] font-normal text-amber-700">{b.currency} {fmtAmt(b.fcPending)} @ {b.fxRate}</span>}</td>
                            <td className={`text-right ${b.daysOverdue > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}`}>{b.daysOverdue > 0 ? `${b.daysOverdue} days` : 'not due'}</td>
                          </tr>))}</tbody>
                      </table>
                    </td></tr>
                  )}
                </React.Fragment>
              )
            })}
            {shown.length === 0 && <tr><td colSpan={AGE_BUCKETS.length + 4}><Empty>Nothing outstanding for {company} as on {asOf}.</Empty></td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot><tr className="bg-slate-50 font-bold"><td className="px-4 py-2.5">Total</td><td className="px-3 py-2.5 text-right">{fmtAmt(totals.total)}</td>
              {AGE_BUCKETS.map(b => <td key={b.key} className="px-3 py-2.5 text-right">{fmtAmt(totals[b.key])}</td>)}
              <td className="px-3 py-2.5 text-right">{fmtAmt(totals.advance)}</td><td /></tr></tfoot>
          )}
        </table>
      </div>
    </ReportShell>
  )
}
