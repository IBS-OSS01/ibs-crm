import React, { useMemo, useState } from 'react'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { VOUCHER_TYPES, fmtAmt } from '../utils/financeConstants.js'
import { downloadXlsx, downloadCsv, printReport } from '../utils/exportUtils.js'
import { useVoucherModal } from '../components/useVoucherModal.jsx'
import { ReportShell, CompanyToggle, DateRange, ExportBar, Badge, Empty, inputCls, periodPresets, cardCls } from '../components/FinanceUI.jsx'

export default function DayBook() {
  const { raw, allLines, loading, reload } = useFinanceData()
  const { open, modal } = useVoucherModal({ raw, allLines, reload })
  const [company, setCompany] = useState('UIPL')
  const [period, setPeriod] = useState(() => { const p = periodPresets()[0]; return { from: p.from, to: p.to } })
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [showCancelled, setShowCancelled] = useState(true)
  const [showMemos, setShowMemos] = useState(false)

  const entries = useMemo(() => raw ? buildVoucherIndex(raw) : [], [raw])
  const rows = useMemo(() => entries
    .filter(e => e.company === company)
    .filter(e => e.date >= period.from && e.date <= period.to)
    .filter(e => !kind || e.kind === kind)
    .filter(e => showCancelled || !e.cancelled)
    .filter(e => showMemos || !e.memo)
    .filter(e => !q || `${e.number} ${e.partyName} ${e.narration}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.number).localeCompare(String(b.number))),
  [entries, company, period, kind, q, showCancelled, showMemos])

  const byKind = useMemo(() => {
    const m = {}
    rows.filter(r => !r.cancelled && !r.memo).forEach(r => { m[r.kind] = m[r.kind] || { count: 0, total: 0 }; m[r.kind].count++; m[r.kind].total += r.amount })
    return m
  }, [rows])

  const sheet = () => [['Date', 'Type', 'Voucher No', 'Particulars', 'Narration', 'Amount', 'Status'],
    ...rows.map(r => [r.date, VOUCHER_TYPES[r.kind]?.label || r.memoLabel || r.kind, r.number, r.partyName, r.narration, r.amount, r.cancelled ? 'Cancelled' : r.memo ? 'Not booked' : ''])]
  const title = `Day Book — ${company} (${period.from} to ${period.to})`

  return (
    <ReportShell title="Day Book" subtitle="Every voucher in date order, across sales, purchases, receipts, payments, notes and journals."
      loading={loading}
      exportBar={<ExportBar onXlsx={() => downloadXlsx(title, [{ name: 'Day Book', rows: sheet() }])} onCsv={() => downloadCsv(title, sheet())} onPrint={() => printReport({ title: 'Day Book', subtitle: `${company} · ${period.from} to ${period.to}`, rows: sheet() })} />}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <DateRange from={period.from} to={period.to} onChange={setPeriod} />
        <select value={kind} onChange={e => setKind(e.target.value)} className={inputCls}>
          <option value="">All voucher types</option>
          {Object.entries(VOUCHER_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number, party, narration…" className={`${inputCls} w-64`} />
        <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} />Cancelled</label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600" title="Pro-forma invoices and sales orders — they don't hit the books"><input type="checkbox" checked={showMemos} onChange={e => setShowMemos(e.target.checked)} />Memos</label>
      </>}>
      <div className="flex gap-2 flex-wrap">
        {Object.entries(byKind).map(([k, v]) => (
          <button key={k} onClick={() => setKind(kind === k ? '' : k)} className={`${cardCls} px-3 py-2 text-left hover:border-blue-300 ${kind === k ? 'border-blue-400' : ''}`}>
            <p className="text-xs text-slate-500">{VOUCHER_TYPES[k]?.label || k} · {v.count}</p>
            <p className="text-sm font-bold text-slate-800">₹{fmtAmt(v.total)}</p>
          </button>
        ))}
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr><th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Type</th><th className="text-left px-4 py-3">Voucher #</th>
              <th className="text-left px-4 py-3">Particulars</th><th className="text-left px-4 py-3">Narration</th><th className="text-right px-4 py-3">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.key} onClick={() => open(r)} className={`cursor-pointer hover:bg-blue-50/40 ${r.cancelled ? 'opacity-50 line-through' : ''} ${r.memo ? 'bg-slate-50/60' : ''}`}>
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.date}</td>
                <td className="px-4 py-2.5"><Badge color={VOUCHER_TYPES[r.kind]?.color || 'bg-slate-100 text-slate-500'}>{VOUCHER_TYPES[r.kind]?.label || r.memoLabel || r.kind}</Badge></td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.number}{r.companyInferred && <span title="No company on this record — assumed UIPL" className="ml-1 text-amber-600">⚠</span>}</td>
                <td className="px-4 py-2.5 text-slate-800 font-medium">{r.partyName || '—'}</td>
                <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">{r.narration}</td>
                <td className="px-4 py-2.5 text-right font-medium text-slate-800">{fmtAmt(r.amount)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6}><Empty>No vouchers for {company} in this period.</Empty></td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="bg-slate-50 font-bold"><td colSpan={5} className="px-4 py-2.5 text-slate-600">Total ({rows.filter(r => !r.cancelled && !r.memo).length} vouchers)</td>
              <td className="px-4 py-2.5 text-right">{fmtAmt(rows.filter(r => !r.cancelled && !r.memo).reduce((s, r) => s + r.amount, 0))}</td></tr></tfoot>
          )}
        </table>
      </div>
      {modal}
    </ReportShell>
  )
}
