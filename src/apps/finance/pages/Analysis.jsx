// Sales / purchase analysis: by party, by item, by month — from the same tax documents
// the registers and GST returns use.
import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { normalizeTaxDocs, docsOfKind } from '../utils/taxDocs.js'
import { fmtAmt, fyRange, currentFY, r2, num } from '../utils/financeConstants.js'
import { downloadXlsx, printReport } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, DateRange, ExportBar, Empty, cardCls, thCls, inputCls } from '../components/FinanceUI.jsx'

const TABS = [['sales-party', 'Sales by Party', 'sales', 'party'], ['sales-item', 'Sales by Item', 'sales', 'item'], ['purchase-party', 'Purchases by Party', 'purchase', 'party'], ['purchase-item', 'Purchases by Item', 'purchase', 'item']]

export default function Analysis() {
  const { tab = 'sales-party' } = useParams()
  const navigate = useNavigate()
  const { raw, loading } = useFinanceData()
  const [company, setCompany] = useState('UIPL')
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const [q, setQ] = useState('')
  const [, kind, by] = TABS.find(t => t[0] === tab) || TABS[0]
  const label = TABS.find(t => t[0] === tab)?.[1]
  const docs = useMemo(() => raw ? normalizeTaxDocs(raw) : [], [raw])

  const rows = useMemo(() => {
    const cnKind = kind === 'sales' ? 'credit_note' : 'debit_note'
    const m = {}
    const add = (key, name, sign, d, taxable, tax, qty = 0) => {
      const r = (m[key] = m[key] || { name, count: new Set(), qty: 0, taxable: 0, tax: 0, total: 0 })
      r.count.add(d.key); r.qty = r2(r.qty + sign * qty); r.taxable = r2(r.taxable + sign * taxable); r.tax = r2(r.tax + sign * tax); r.total = r2(r.total + sign * (taxable + tax))
    }
    ;[[kind, 1], [cnKind, -1]].forEach(([k, sign]) => docsOfKind(docs, k, { company, from: period.from, to: period.to }).forEach(d => {
      if (by === 'party') add((d.partyName || '(no party)').toLowerCase(), d.partyName || '(no party)', sign, d, d.taxable, d.taxTotal)
      else if ((d.items || []).length) d.items.forEach(it => add((it.description || '(no description)').toLowerCase(), it.description || '(no description)', sign, d, num(it.taxable), num(it.lineTax ?? (num(it.cgst) + num(it.sgst) + num(it.igst))), num(it.qty)))
      else add('(no item detail)', '(no item detail)', sign, d, d.taxable, d.taxTotal)
    }))
    return Object.values(m).map(r => ({ ...r, count: r.count.size })).filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.total - a.total)
  }, [docs, kind, by, company, period, q])
  const grand = rows.reduce((t, r) => ({ taxable: t.taxable + r.taxable, tax: t.tax + r.tax, total: t.total + r.total }), { taxable: 0, tax: 0, total: 0 })
  const sheet = () => [[by === 'party' ? 'Party' : 'Item', 'Documents', ...(by === 'item' ? ['Qty'] : []), 'Taxable', 'Tax', 'Total', '% of total'], ...rows.map(r => [r.name, r.count, ...(by === 'item' ? [r.qty] : []), r.taxable, r.tax, r.total, grand.total ? r2(r.total * 100 / grand.total) : 0])]

  return (
    <ReportShell title={label} loading={loading} subtitle="Net of credit / debit notes."
      exportBar={<ExportBar onXlsx={() => downloadXlsx(`${label} ${company} ${period.from} to ${period.to}`, [{ name: label.slice(0, 30), rows: sheet() }])} onPrint={() => printReport({ title: label, subtitle: `${company} · ${period.from} to ${period.to}`, rows: sheet() })} />}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm flex-wrap">{TABS.map(([k, l]) => <button key={k} onClick={() => navigate(`/finance/analysis/${k}`)} className={`px-3 py-1.5 font-medium ${k === tab ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>
        <DateRange from={period.from} to={period.to} onChange={setPeriod} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className={`${inputCls} w-44`} />
      </>}>
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80"><tr><th className={`${thCls} text-left`}>{by === 'party' ? 'Party' : 'Item'}</th><th className={`${thCls} text-right`}>Docs</th>{by === 'item' && <th className={`${thCls} text-right`}>Qty</th>}<th className={`${thCls} text-right`}>Taxable</th><th className={`${thCls} text-right`}>Tax</th><th className={`${thCls} text-right`}>Total</th><th className={`${thCls} text-right`}>Share</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.name}><td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 py-2 text-right">{r.count}</td>{by === 'item' && <td className="px-3 py-2 text-right">{r.qty}</td>}<td className="px-3 py-2 text-right">{fmtAmt(r.taxable)}</td><td className="px-3 py-2 text-right">{fmtAmt(r.tax)}</td><td className="px-3 py-2 text-right font-medium">{fmtAmt(r.total)}</td>
                <td className="px-3 py-2 text-right w-40"><div className="flex items-center justify-end gap-2"><div className="w-16 h-1.5 bg-slate-100 rounded"><div className="h-1.5 bg-blue-500 rounded" style={{ width: `${Math.max(0, Math.min(100, grand.total ? r.total * 100 / grand.total : 0))}%` }} /></div><span className="text-xs text-slate-500 w-10 text-right">{grand.total ? Math.round(r.total * 100 / grand.total) : 0}%</span></div></td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7}><Empty>Nothing in this period.</Empty></td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="bg-slate-50 font-bold"><td className="px-3 py-2">Total</td><td /><>{by === 'item' && <td />}</><td className="px-3 py-2 text-right">{fmtAmt(grand.taxable)}</td><td className="px-3 py-2 text-right">{fmtAmt(grand.tax)}</td><td className="px-3 py-2 text-right">{fmtAmt(grand.total)}</td><td /></tr></tfoot>}
        </table>
      </div>
    </ReportShell>
  )
}
