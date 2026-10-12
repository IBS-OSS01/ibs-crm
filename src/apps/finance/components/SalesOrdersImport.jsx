// Sales orders from a Zoho Books "Sales Order" export, with the quantities already invoiced. Existing invoices that carry the same
// customer PO number are linked to their order. (Not shown in the menus — used by the person entering the data.)
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDocs, getDoc, writeBatch } from '../../../lib/cachedFirestore'
import * as XLSX from 'xlsx'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { readSheetFile } from '../utils/readSheetFile.js'
import { parseZohoOrders, toOrderDoc, normName } from '../utils/zohoSales.js'
import { orderProgress, ORDER_STATE_LABEL } from '../utils/salesOrders.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { fmtAmt } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls, Badge } from './FinanceUI.jsx'

const loadAll = async (name) => { const s = await getDocs(collection(db, name)); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); return a }
const key = (x) => normName(x).replace(/\b(private|pvt|limited|ltd)\b/g, '').trim().split(' ')[0]

export default function SalesOrdersImport({ onClose }) {
  const { user } = useAuth()
  const fileRef = useRef(null)
  const [ctx, setCtx] = useState(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  useEffect(() => {
    Promise.all([loadAll('crm_customers'), loadAll('finance_invoices'), getDoc(doc(db, 'company_settings', 'UIPL'))])
      .then(([customers, invoices, seller]) => setCtx({ customers, invoices, seller: seller.exists() ? seller.data() : {} })).catch(e => setErr(e.message))
  }, [])

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f || !ctx) return
    setErr(''); setResult(''); setFileName(f.name)
    try {
      const wb = await readSheetFile(f)
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      if (!data.length || !('SalesOrder Number' in data[0])) return setErr('This does not look like a Zoho Books sales-order export (expected a “SalesOrder Number” column).')
      const have = new Map(ctx.invoices.filter(i => i.invoiceType === 'SO').map(i => [i.invoiceNumber, i]))
      setRows(parseZohoOrders(data, { customers: ctx.customers }).map(o => {
        const links = o.items.some(i => i.invoicedQty > 0) && o.poNumber
          ? ctx.invoices.filter(i => i.invoiceType === 'TI' && i.poNumber === o.poNumber && key(i.billToName) === key(o.customerName)).map(i => ({ id: i.id, number: i.invoiceNumber, date: i.invoiceDate, total: i.total })) : []
        return { ...o, links, existing: have.get(o.number) || null, include: !have.get(o.number) }
      }))
    } catch (ex) { setErr('Could not read that file: ' + ex.message) }
  }
  const chosen = useMemo(() => (rows || []).filter(r => r.include && !r.existing), [rows])

  const run = async () => {
    setBusy(true); setErr('')
    try {
      const batch = writeBatch(db)
      for (const o of chosen) {
        const ref = doc(collection(db, 'finance_invoices'))
        batch.set(ref, { ...toOrderDoc(o, { seller: ctx.seller, user }), ...(o.links.length ? { invoiceLinks: o.links } : {}) })
        o.links.forEach(l => batch.update(doc(db, 'finance_invoices', l.id), { sourceOrderId: ref.id, sourceOrderNumber: o.number }))
      }
      await batch.commit(); invalidateFinanceCache()
      setResult(`Done — ${chosen.length} sales order(s) imported, ${chosen.reduce((s, o) => s + o.links.length, 0)} existing invoice(s) linked to them.`)
    } catch (ex) { setErr('Import failed: ' + ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`${cardCls} w-full max-w-5xl p-5 space-y-3 max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between"><h3 className="text-lg font-bold text-slate-800">Sales orders</h3>{!busy && <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>}</div>
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}
        {result && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{result}</div>}
        {ctx && <div><button className={btnGhost} onClick={() => fileRef.current?.click()}>{fileName || 'Choose the sales-order export'}</button><input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} /></div>}
        {rows && (<>
          <div className="overflow-auto rounded-lg border border-slate-200 max-h-[50vh]">
            <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase sticky top-0"><tr><th className="text-left px-2 py-2">Order</th><th className="text-left px-2">Date</th><th className="text-left px-2">Customer</th><th className="text-left px-2">PO</th><th className="text-right px-2">Total</th><th className="px-2">Status</th><th className="text-right px-2">Billed / ordered</th><th className="text-left px-2">Invoices linked</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{rows.map(o => { const p = orderProgress(o); return (
                <tr key={o.number} className={o.include ? '' : 'opacity-50'}><td className="px-2 py-1.5 font-mono">{o.number}{o.existing && <Badge color="bg-slate-100 text-slate-500">exists</Badge>}</td><td className="px-2">{o.date}</td><td className="px-2 max-w-[220px] truncate">{o.customer ? '' : '⚠ '}{o.customerName}{o.posState && o.posState !== 'Maharashtra' ? ` · ${o.posState}` : ''}</td><td className="px-2">{o.poNumber}</td><td className="px-2 text-right">{fmtAmt(o.total)}</td><td className="px-2 text-center">{ORDER_STATE_LABEL[p.state]}</td><td className="px-2 text-right">{p.invoiced} / {p.ordered}</td><td className="px-2">{o.links.map(l => l.number).join(', ') || '—'}</td></tr>) })}</tbody></table>
          </div>
          <div className="flex gap-2"><button className={btnPrimary} disabled={busy || !!result || !chosen.length} onClick={run}>{busy ? 'Importing…' : `Import ${chosen.length} order(s)`}</button><button className={btnGhost} disabled={busy} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button></div>
        </>)}
      </div>
    </div>
  )
}
