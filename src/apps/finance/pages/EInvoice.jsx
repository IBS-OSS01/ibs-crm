// E-invoice (IRN) and e-way bill — file-based workflow that works on the free Firebase plan:
// build the portal's bulk JSON here, upload it on the government portal, then record the
// IRN / e-way bill numbers it gives back against the invoice.
import React, { useMemo, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { buildEInvoice, buildEwayBill, ewbBulkFile, invoiceProblems, ewayProblems } from '../utils/einvoice.js'
import { isAccountingInvoice } from '../utils/ledger.js'
import { fmtAmt, fyRange, currentFY } from '../utils/financeConstants.js'
import { downloadJson } from '../utils/exportUtils.js'
import { Field } from '../components/formShared.jsx'
import { ReportShell, DateRange, Badge, Empty, cardCls, formInputCls, thCls, btnPrimary, btnGhost, useFinancePerms } from '../components/FinanceUI.jsx'

const blankT = { mode: 1, distance: '', vehicleNo: '', transporterId: '', transporterName: '', docNo: '', docDate: '' }

export default function EInvoice() {
  const { canWrite } = useFinancePerms()
  const { raw, loading, reload } = useFinanceData()
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const [sel, setSel] = useState({})
  const [trans, setTrans] = useState({})            // invoiceId → transport details
  const [dlg, setDlg] = useState(null)              // { kind: 'eway' | 'record', inv }
  const [rec, setRec] = useState({})
  const [msg, setMsg] = useState('')
  const seller = raw?.companySettings?.UIPL || {}

  const rows = useMemo(() => (raw?.invoices || []).filter(i => i.company === 'UIPL' && i.invoiceType === 'TI' && isAccountingInvoice(i) && i.invoiceDate >= period.from && i.invoiceDate <= period.to && i.status !== 'cancelled')
    .map(i => ({ inv: i, problems: invoiceProblems(i, seller) })).sort((a, b) => b.inv.invoiceDate.localeCompare(a.inv.invoiceDate) || String(b.inv.invoiceNumber).localeCompare(String(a.inv.invoiceNumber))), [raw, period, seller])
  const chosen = rows.filter(r => sel[r.inv.id])

  const downloadIrn = () => {
    const ok = chosen.filter(r => r.problems.length === 0)
    if (!ok.length) return setMsg('Select at least one invoice without problems.')
    downloadJson(`einvoice-bulk-${period.from}-to-${period.to}`, ok.map(r => buildEInvoice(r.inv, seller)))
    setMsg(`${ok.length} invoice(s) exported.${chosen.length > ok.length ? ` ${chosen.length - ok.length} skipped because of problems.` : ''} Upload on the IRP (einvoice1.gst.gov.in → Bulk Generation).`)
  }
  const downloadEwb = () => {
    const ok = chosen.filter(r => r.problems.length === 0 && ewayProblems(trans[r.inv.id] || blankT, r.inv).filter(x => !/under ₹50,000/.test(x)).length === 0)
    if (!ok.length) return setMsg('Fill the transport details (button “E-way details”) for the selected invoices first.')
    downloadJson(`ewaybill-bulk-${period.from}-to-${period.to}`, ewbBulkFile(ok.map(r => buildEwayBill(r.inv, seller, trans[r.inv.id])), seller.gstin))
    setMsg(`${ok.length} e-way bill(s) exported. Upload at ewaybillgst.gov.in → Generate Bulk.`)
  }
  const saveRec = async () => {
    const inv = dlg.inv
    await updateDoc(doc(db, 'finance_invoices', inv.id), {
      irn: (rec.irn || '').trim(), ackNo: (rec.ackNo || '').trim(), ackDate: rec.ackDate || '', ewbNo: (rec.ewbNo || '').trim(), ewbDate: rec.ewbDate || '', ewbValidUpto: rec.ewbValidUpto || '',
    })
    invalidateFinanceCache(); reload(); setDlg(null); setMsg('Saved.')
  }
  const openDlg = (kind, inv) => { setDlg({ kind, inv }); if (kind === 'record') setRec({ irn: inv.irn || '', ackNo: inv.ackNo || '', ackDate: inv.ackDate || '', ewbNo: inv.ewbNo || '', ewbDate: inv.ewbDate || '', ewbValidUpto: inv.ewbValidUpto || '' }) }
  const t = dlg?.kind === 'eway' ? (trans[dlg.inv.id] || blankT) : null
  const setT = (k, v) => setTrans(x => ({ ...x, [dlg.inv.id]: { ...(x[dlg.inv.id] || blankT), [k]: v } }))

  return (
    <ReportShell title="E-Invoice & E-Way Bill" loading={loading}
      subtitle="Free-plan workflow: this app prepares the portal files; you upload them and record the numbers the portal returns."
      filters={<DateRange from={period.from} to={period.to} onChange={setPeriod} />}>
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-sm space-y-1">
        <p><b>How it works:</b> ① tick tax invoices → ② download the e-invoice JSON and upload it on the IRP → ③ the portal returns an IRN and signed QR → ④ click “Record numbers” here. For goods movement, add transport details and download the e-way bill JSON for the e-way bill portal.</p>
        <p className="text-xs">Live, one-click generation from inside this app needs a server and a GST API provider (not possible on the free Firebase plan). Whether you must e-invoice depends on your turnover — confirm with your CA. Always test with one invoice first; portal formats change.</p>
      </div>
      {msg && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm flex justify-between"><span>{msg}</span><button onClick={() => setMsg('')}>✕</button></div>}
      <div className="flex gap-2 flex-wrap items-center">
        <button className={btnPrimary} disabled={!chosen.length} onClick={downloadIrn}>⬇ e-Invoice JSON ({chosen.length})</button>
        <button className={btnGhost} disabled={!chosen.length} onClick={downloadEwb}>⬇ E-way bill JSON</button>
        <span className="text-xs text-slate-400">Seller: {seller.legalName || '—'} · {seller.gstin || 'no GSTIN'}</span>
      </div>
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80"><tr><th className="px-3 py-2.5 w-8" /><th className={`${thCls} text-left`}>Invoice</th><th className={`${thCls} text-left`}>Date</th><th className={`${thCls} text-left`}>Buyer</th><th className={`${thCls} text-right`}>Value</th><th className={`${thCls} text-left`}>Readiness</th><th className={`${thCls} text-left`}>IRN</th><th className={`${thCls} text-left`}>E-way bill</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ inv, problems }) => (
              <tr key={inv.id}>
                <td className="px-3 py-2"><input type="checkbox" checked={!!sel[inv.id]} onChange={e => setSel(s => ({ ...s, [inv.id]: e.target.checked }))} /></td>
                <td className="px-3 py-2 font-mono text-xs">{inv.invoiceNumber}</td><td className="px-3 py-2">{inv.invoiceDate}</td>
                <td className="px-3 py-2">{inv.billToName}<div className="font-mono text-xs text-slate-400">{inv.billToGstin || 'no GSTIN'}</div></td>
                <td className="px-3 py-2 text-right">{fmtAmt(inv.total)}</td>
                <td className="px-3 py-2">{problems.length === 0 ? <Badge color="bg-green-100 text-green-700">Ready</Badge> : <span title={problems.join('\n')}><Badge color="bg-amber-100 text-amber-700">{problems.length} issue{problems.length > 1 ? 's' : ''}</Badge><span className="block text-xs text-amber-700 max-w-xs">{problems[0]}</span></span>}</td>
                <td className="px-3 py-2 font-mono text-xs">{inv.irn ? <span className="text-green-700" title={inv.irn}>{inv.irn.slice(0, 12)}… <span className="text-slate-400">ack {inv.ackNo}</span></span> : <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2 font-mono text-xs">{inv.ewbNo || <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap"><button className="text-xs text-blue-600 hover:underline mr-3" onClick={() => openDlg('eway', inv)}>E-way details</button>{canWrite && <button className="text-xs text-blue-600 hover:underline" onClick={() => openDlg('record', inv)}>Record numbers</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9}><Empty>No tax invoices in this period.</Empty></td></tr>}
          </tbody>
        </table>
      </div>

      {dlg && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setDlg(null)}>
          <div className={`${cardCls} w-full max-w-lg p-5 space-y-3`} onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">{dlg.kind === 'eway' ? 'Transport details' : 'Numbers from the portal'} — {dlg.inv.invoiceNumber}</h3>
            {dlg.kind === 'eway' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Mode"><select value={t.mode} onChange={e => setT('mode', e.target.value)} className={formInputCls}><option value={1}>Road</option><option value={2}>Rail</option><option value={3}>Air</option><option value={4}>Ship</option></select></Field>
                  <Field label="Distance (km) *"><input type="number" min="0" value={t.distance} onChange={e => setT('distance', e.target.value)} className={formInputCls} /></Field>
                  <Field label="Vehicle no."><input value={t.vehicleNo} onChange={e => setT('vehicleNo', e.target.value)} placeholder="MH12AB1234" className={formInputCls} /></Field>
                  <Field label="Transporter GSTIN / ID"><input value={t.transporterId} onChange={e => setT('transporterId', e.target.value)} className={formInputCls} /></Field>
                  <Field label="Transporter name"><input value={t.transporterName} onChange={e => setT('transporterName', e.target.value)} className={formInputCls} /></Field>
                  <Field label="Transport doc no. (LR / RR / AWB)"><input value={t.docNo} onChange={e => setT('docNo', e.target.value)} className={formInputCls} /></Field>
                  <Field label="Transport doc date"><input type="date" value={t.docDate} onChange={e => setT('docDate', e.target.value)} className={formInputCls} /></Field>
                </div>
                {ewayProblems(t, dlg.inv).length > 0 && <ul className="text-xs text-amber-700 list-disc pl-5">{ewayProblems(t, dlg.inv).map(p => <li key={p}>{p}</li>)}</ul>}
                <p className="text-xs text-slate-400">Kept only while this page is open. Tick the invoice and use “E-way bill JSON”.</p>
                <button className={btnPrimary} onClick={() => setDlg(null)}>Done</button>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="IRN (64 characters)" ><input value={rec.irn} onChange={e => setRec({ ...rec, irn: e.target.value })} className={`${formInputCls} font-mono text-xs`} /></Field>
                  <Field label="Ack no."><input value={rec.ackNo} onChange={e => setRec({ ...rec, ackNo: e.target.value })} className={formInputCls} /></Field>
                  <Field label="Ack date"><input type="date" value={rec.ackDate} onChange={e => setRec({ ...rec, ackDate: e.target.value })} className={formInputCls} /></Field>
                  <Field label="E-way bill no."><input value={rec.ewbNo} onChange={e => setRec({ ...rec, ewbNo: e.target.value })} className={formInputCls} /></Field>
                  <Field label="E-way bill date"><input type="date" value={rec.ewbDate} onChange={e => setRec({ ...rec, ewbDate: e.target.value })} className={formInputCls} /></Field>
                  <Field label="Valid up to"><input type="date" value={rec.ewbValidUpto} onChange={e => setRec({ ...rec, ewbValidUpto: e.target.value })} className={formInputCls} /></Field>
                </div>
                <div className="flex gap-2"><button className={btnPrimary} onClick={saveRec}>Save</button><button className={btnGhost} onClick={() => setDlg(null)}>Cancel</button></div>
              </>
            )}
          </div>
        </div>
      )}
    </ReportShell>
  )
}
