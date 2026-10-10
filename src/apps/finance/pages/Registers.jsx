import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { normalizeTaxDocs, docsOfKind, monthWise } from '../utils/taxDocs.js'
import { VOUCHER_TYPES, fmtAmt, fyRange, currentFY } from '../utils/financeConstants.js'
import { downloadXlsx, downloadCsv, printReport } from '../utils/exportUtils.js'
import { useVoucherModal } from '../components/useVoucherModal.jsx'
import { ReportShell, CompanyToggle, DateRange, ExportBar, Badge, Empty, inputCls, cardCls } from '../components/FinanceUI.jsx'

const TAX_KINDS = ['sales', 'purchase', 'credit_note', 'debit_note']
const REGISTER_KINDS = ['sales', 'purchase', 'credit_note', 'debit_note', 'receipt', 'payment', 'contra', 'journal']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`

export default function Registers() {
  const { type } = useParams()
  const navigate = useNavigate()
  const kind = REGISTER_KINDS.includes(type) ? type : 'sales'
  const isTax = TAX_KINDS.includes(kind)
  const { raw, allLines, loading, reload } = useFinanceData()
  const { open, modal } = useVoucherModal({ raw, allLines, reload })
  const [company, setCompany] = useState('UIPL')
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const [view, setView] = useState('month')
  const [q, setQ] = useState('')

  const entries = useMemo(() => raw ? buildVoucherIndex(raw) : [], [raw])
  const entryByKey = useMemo(() => Object.fromEntries(entries.map(e => [e.key, e])), [entries])
  const taxDocs = useMemo(() => raw ? normalizeTaxDocs(raw) : [], [raw])

  const docs = useMemo(() => {
    const match = (d) => !q || `${d.number} ${d.externalNumber || ''} ${d.partyName} ${d.gstin || ''}`.toLowerCase().includes(q.toLowerCase())
    if (isTax) return docsOfKind(taxDocs, kind, { company, from: period.from, to: period.to }).filter(match)
    return entries.filter(e => e.kind === kind && !e.cancelled && e.company === company && e.date >= period.from && e.date <= period.to)
      .filter(e => !q || `${e.number} ${e.partyName} ${e.narration}`.toLowerCase().includes(q.toLowerCase()))
      .map(e => ({ key: e.key, number: e.number, date: e.date, partyName: e.partyName, taxable: e.amount, cgst: 0, sgst: 0, igst: 0, total: e.amount, narration: e.narration }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [isTax, taxDocs, entries, kind, company, period, q])

  const months = useMemo(() => monthWise(docs), [docs])
  const sum = (k) => docs.reduce((s, d) => s + (Number(d[k]) || 0), 0)
  const label = VOUCHER_TYPES[kind]?.label || kind

  const detailSheet = () => isTax
    ? [['Date', 'Voucher No', 'Party Invoice No', 'Party', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Notes'],
       ...docs.map(d => [d.date, d.number, d.externalNumber || '', d.partyName, d.gstin || '', d.taxable, d.cgst, d.sgst, d.igst, d.total, [d.rcm ? 'RCM' : '', d.itcEligible === false ? 'ITC blocked' : '', d.legacy ? 'no GST detail' : ''].filter(Boolean).join(', ')])]
    : [['Date', 'Voucher No', 'Particulars', 'Amount', 'Narration'], ...docs.map(d => [d.date, d.number, d.partyName, d.total, d.narration])]
  const monthSheet = () => [['Month', 'Vouchers', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'], ...months.map(m => [monthLabel(m.month), m.count, m.taxable, m.cgst, m.sgst, m.igst, m.total])]
  const title = `${label} Register — ${company} ${period.from} to ${period.to}`
  const rows = () => view === 'month' ? monthSheet() : detailSheet()

  return (
    <ReportShell title={`${label} Register`} loading={loading}
      subtitle={isTax ? 'Month-wise summary and voucher-wise listing with GST split.' : 'Month-wise summary and voucher-wise listing.'}
      exportBar={<ExportBar onXlsx={() => downloadXlsx(title, [{ name: 'Month-wise', rows: monthSheet() }, { name: 'Voucher-wise', rows: detailSheet() }])} onCsv={() => downloadCsv(title, rows())} onPrint={() => printReport({ title: `${label} Register`, subtitle: `${company} · ${period.from} to ${period.to}`, rows: rows() })} />}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <select value={kind} onChange={e => navigate(`/finance/registers/${e.target.value}`)} className={inputCls}>
          {REGISTER_KINDS.map(k => <option key={k} value={k}>{VOUCHER_TYPES[k].label} Register</option>)}
        </select>
        <DateRange from={period.from} to={period.to} onChange={setPeriod} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {[['month', 'Month-wise'], ['voucher', 'Voucher-wise']].map(([k, l]) => <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 font-medium ${view === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search party, number, GSTIN…" className={`${inputCls} w-56`} />
      </>}>
      {company === 'Wayzim' && isTax && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">Wayzim documents don't carry GST, so tax columns are expected to be zero.</div>}
      {kind === 'purchase' && docs.some(d => d.legacy) && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
          Entries marked <b>no GST detail</b> are old Payables records that never captured GST — record new purchases as <b>Purchase vouchers</b> so input tax credit flows into GSTR-3B.
        </div>
      )}
      <div className={`${cardCls} overflow-x-auto`}>
        {view === 'month' ? (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
              <th className="text-left px-4 py-3">Month</th><th className="text-right px-4 py-3">Vouchers</th>
              <th className="text-right px-4 py-3">{isTax ? 'Taxable' : 'Amount'}</th>{isTax && <><th className="text-right px-4 py-3">CGST</th><th className="text-right px-4 py-3">SGST</th><th className="text-right px-4 py-3">IGST</th><th className="text-right px-4 py-3">Total</th></>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {months.map(m => <tr key={m.month} className="hover:bg-slate-50/60"><td className="px-4 py-2.5 font-medium">{monthLabel(m.month)}</td><td className="px-4 py-2.5 text-right">{m.count}</td>
                <td className="px-4 py-2.5 text-right">{fmtAmt(m.taxable)}</td>{isTax && <><td className="px-4 py-2.5 text-right">{fmtAmt(m.cgst)}</td><td className="px-4 py-2.5 text-right">{fmtAmt(m.sgst)}</td><td className="px-4 py-2.5 text-right">{fmtAmt(m.igst)}</td><td className="px-4 py-2.5 text-right font-medium">{fmtAmt(m.total)}</td></>}</tr>)}
              {months.length === 0 && <tr><td colSpan={7}><Empty>No {label.toLowerCase()} vouchers for {company} in this period.</Empty></td></tr>}
            </tbody>
            {months.length > 0 && <tfoot><tr className="bg-slate-50 font-bold"><td className="px-4 py-2.5">Grand total</td><td className="px-4 py-2.5 text-right">{docs.length}</td><td className="px-4 py-2.5 text-right">{fmtAmt(sum('taxable'))}</td>
              {isTax && <><td className="px-4 py-2.5 text-right">{fmtAmt(sum('cgst'))}</td><td className="px-4 py-2.5 text-right">{fmtAmt(sum('sgst'))}</td><td className="px-4 py-2.5 text-right">{fmtAmt(sum('igst'))}</td><td className="px-4 py-2.5 text-right">{fmtAmt(sum('total'))}</td></>}</tr></tfoot>}
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
              <th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Voucher #</th>{isTax && <th className="text-left px-4 py-3">Party inv #</th>}<th className="text-left px-4 py-3">{isTax ? 'Party' : 'Particulars'}</th>
              {isTax && <th className="text-left px-4 py-3">GSTIN</th>}<th className="text-right px-4 py-3">{isTax ? 'Taxable' : 'Amount'}</th>{isTax && <><th className="text-right px-4 py-3">CGST</th><th className="text-right px-4 py-3">SGST</th><th className="text-right px-4 py-3">IGST</th><th className="text-right px-4 py-3">Total</th></>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map(d => (
                <tr key={d.key} className="cursor-pointer hover:bg-blue-50/40" onClick={() => { const e = entryByKey[d.key]; if (e) open(e) }}>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{d.date}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{d.number}{d.rcm && <span className="ml-1"><Badge color="bg-purple-100 text-purple-700">RCM</Badge></span>}{d.itcEligible === false && <span className="ml-1"><Badge color="bg-red-100 text-red-700">ITC blocked</Badge></span>}</td>
                  {isTax && <td className="px-4 py-2.5 text-slate-500 text-xs">{d.externalNumber || ''}</td>}
                  <td className="px-4 py-2.5 text-slate-800 font-medium">{d.partyName || '—'}{d.legacy && <span className="ml-1 text-xs text-amber-600">no GST detail</span>}</td>
                  {isTax && <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{d.gstin || <span className="text-slate-300">unregistered</span>}</td>}
                  <td className="px-4 py-2.5 text-right">{fmtAmt(d.taxable)}</td>
                  {isTax && <><td className="px-4 py-2.5 text-right">{d.cgst ? fmtAmt(d.cgst) : '—'}</td><td className="px-4 py-2.5 text-right">{d.sgst ? fmtAmt(d.sgst) : '—'}</td><td className="px-4 py-2.5 text-right">{d.igst ? fmtAmt(d.igst) : '—'}</td><td className="px-4 py-2.5 text-right font-medium">{fmtAmt(d.total)}</td></>}
                </tr>
              ))}
              {docs.length === 0 && <tr><td colSpan={10}><Empty>No {label.toLowerCase()} vouchers for {company} in this period.</Empty></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {modal}
    </ReportShell>
  )
}
