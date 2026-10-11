// Credit notes from a Zoho Books "Credit Note" export → credit-note vouchers against the invoices they refer to (previewed first).
// (Not shown in the menus — opened with ?zoho=1 by the person entering the data.)
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDocs, getDoc } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { readSheetFile } from '../utils/readSheetFile.js'
import { parseZohoCreditNotes, toCreditVoucher } from '../utils/zohoCreditNotes.js'
import { createVoucher, getBooksLockDate } from '../utils/voucherService.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { fmtAmt } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls, Badge } from './FinanceUI.jsx'

const loadAll = async (name) => { const s = await getDocs(collection(db, name)); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); return a }

export default function CreditNotesImport({ onClose, onDone }) {
  const { user, userProfile } = useAuth()
  const fileRef = useRef(null)
  const [ctx, setCtx] = useState(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  useEffect(() => {
    Promise.all([loadAll('crm_customers'), loadAll('finance_invoices'), loadAll('finance_vouchers'), getDoc(doc(db, 'company_settings', 'UIPL'))])
      .then(([customers, invoices, vouchers, seller]) => setCtx({ customers, invoices, vouchers, seller: seller.exists() ? seller.data() : {} }))
      .catch(e => setErr('Could not load existing data: ' + e.message))
  }, [])

  const have = useMemo(() => {
    const m = new Map(); (ctx?.vouchers || []).filter(v => v.voucherType === 'credit_note' && v.status !== 'cancelled' && v.zohoCreditNoteId).forEach(v => m.set(v.zohoCreditNoteId, v)); return m
  }, [ctx])

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f || !ctx) return
    setErr(''); setResult(''); setFileName(f.name)
    try {
      const wb = await readSheetFile(f)
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      if (!data.length || !('Credit Note Number' in data[0]) || !('Item Total' in data[0])) return setErr('This does not look like a Zoho Books credit-note export (expected “Credit Note Number” and “Item Total” columns).')
      setRows(parseZohoCreditNotes(data, { customers: ctx.customers, invoices: ctx.invoices }).map(c => ({ ...c, existing: have.get(c.zohoId) || null, include: !have.get(c.zohoId) })))
    } catch (ex) { setErr('Could not read that file: ' + ex.message) }
  }
  const chosen = useMemo(() => (rows || []).filter(r => r.include && !r.existing), [rows])

  const run = async () => {
    setBusy(true); setErr('')
    try {
      const lockedUpTo = await getBooksLockDate('UIPL')
      let done = 0
      for (const cn of chosen) { await createVoucher(toCreditVoucher(cn, { stateCode: ctx.seller.stateCode || '27' }), { user, profile: userProfile, lockedUpTo }); done++ }
      invalidateFinanceCache(); onDone?.()
      setResult(`Done — ${done} credit note(s) created and applied to their invoices.`)
    } catch (ex) { setErr('Stopped: ' + ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`${cardCls} w-full max-w-5xl p-5 space-y-3 max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between"><h3 className="text-lg font-bold text-slate-800">Credit notes</h3>{!busy && <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>}</div>
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}
        {result && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{result}</div>}
        {ctx && <div><button className={btnGhost} onClick={() => fileRef.current?.click()}>{fileName || 'Choose the credit-note export'}</button><input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} /></div>}
        {rows && (<>
          <div className="overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="text-left px-2 py-2">Note</th><th className="text-left px-2">Date</th><th className="text-left px-2">Customer</th><th className="text-left px-2">Against invoice</th><th className="text-left px-2">Reason</th><th className="text-right px-2">Total</th><th className="text-left px-2">Check</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{rows.map(c => (
                <tr key={c.number} className={c.include ? '' : 'opacity-50'}><td className="px-2 py-1.5 font-mono">{c.number}{c.existing && <Badge color="bg-slate-100 text-slate-500">exists</Badge>}</td><td className="px-2">{c.date}</td><td className="px-2">{c.customerName}</td>
                  <td className="px-2">{c.invoice ? c.invoice.invoiceNumber : <span className="text-amber-600">{c.invoiceNumber || 'none'} (on account)</span>}</td><td className="px-2">{c.reason}</td><td className="px-2 text-right">{fmtAmt(c.total)}</td>
                  <td className="px-2 text-amber-700">{c.warnings.join(' · ') || <span className="text-green-700">✓</span>}</td></tr>))}</tbody></table>
          </div>
          <div className="flex gap-2"><button className={btnPrimary} disabled={busy || !!result || !chosen.length} onClick={run}>{busy ? 'Creating…' : `Create ${chosen.length} credit note(s)`}</button><button className={btnGhost} disabled={busy} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button></div>
        </>)}
      </div>
    </div>
  )
}
