// Import purchase bills from a Zoho Books "Bill" export as purchase vouchers, and link the bank payments that are already
// in the books (on account, or booked straight to an expense) to the bills they paid. Previewed first.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDocs, getDoc, addDoc } from '../../../lib/cachedFirestore'
import * as XLSX from 'xlsx'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { readSheetFile } from '../utils/readSheetFile.js'
import { parseZohoBills, toPurchaseVoucher, matchPayments } from '../utils/zohoPurchases.js'
import { createVoucher, updateVoucher, getBooksLockDate } from '../utils/voucherService.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { fmtAmt, r2 } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls, Badge } from './FinanceUI.jsx'

const loadAll = async (name) => { const s = await getDocs(collection(db, name)); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); return a }

export default function BillsImport({ onClose, onDone }) {
  const { user, userProfile } = useAuth()
  const fileRef = useRef(null)
  const [ctx, setCtx] = useState(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState('')
  const [link, setLink] = useState(true)

  useEffect(() => {
    Promise.all([loadAll('finance_vendors'), loadAll('finance_vouchers'), getDoc(doc(db, 'company_settings', 'UIPL'))])
      .then(([vendors, vouchers, seller]) => setCtx({ vendors, vouchers, seller: seller.exists() ? seller.data() : {} }))
      .catch(e => setErr('Could not load existing data: ' + e.message))
  }, [])

  const stateCode = ctx?.seller?.stateCode || '27'
  const existing = useMemo(() => {
    const m = new Map(); (ctx?.vouchers || []).filter(v => v.voucherType === 'purchase' && v.company === 'UIPL' && v.status !== 'cancelled').forEach(v => { if (v.zohoBillId) m.set('z:' + v.zohoBillId, v); m.set(`n:${v.refNumber}|${String(v.partyName || '').toLowerCase()}|${v.date}`, v) })
    return m
  }, [ctx])

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f || !ctx) return
    setErr(''); setResult(''); setFileName(f.name)
    try {
      const wb = await readSheetFile(f)
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      if (!data.length || !('Bill Number' in data[0]) || !('Vendor Name' in data[0])) return setErr('This does not look like a Zoho Books bill export (expected “Bill Number” and “Vendor Name” columns).')
      setRows(parseZohoBills(data, { vendors: ctx.vendors, stateCode }).map(b => {
        const ex = existing.get('z:' + b.zohoId) || existing.get(`n:${b.number}|${(b.vendor?.vendorName || b.vendorName).toLowerCase()}|${b.date}`) || null
        return { ...b, existing: ex, include: !ex && !b.skip }
      }))
    } catch (ex) { setErr('Could not read that file: ' + ex.message) }
  }

  // bank payments already in the books with nothing allocated: to a vendor (on account) or straight to an expense / ledger
  const payments = useMemo(() => (ctx?.vouchers || []).filter(v => v.voucherType === 'payment' && v.company === 'UIPL' && v.status !== 'cancelled' && !(v.allocations || []).length && !(v.tds?.applicable) && (Number(v.amount) || 0) > 0
    && v.bankAccountCode !== '2910').map(v => ({ id: v.id, date: v.date, cash: r2(Number(v.amount) || 0), partyName: v.partyType === 'vendor' ? v.partyName : '', text: v.narration || '', voucher: v })), [ctx])
  const chosen = useMemo(() => (rows || []).filter(r => r.include && !r.existing), [rows])
  const match = useMemo(() => {
    if (!rows) return null
    const bills = rows.filter(r => (r.include || r.existing) && !r.skip).map(b => ({ key: b.key, number: b.number, date: b.date, net: b.net, vendorName: b.vendor?.vendorName || b.vendorName, zohoBalance: b.zohoBalance }))
    const fxVendors = rows.filter(r => /overseas/i.test(r.gstTreatment || '') || /wayzim technology/i.test(r.vendorName)).map(r => r.vendorName)
    return matchPayments(bills, payments, { fxVendors })
  }, [rows, payments])
  const toggle = (i) => setRows(rs => rs.map((r, n) => n === i ? { ...r, include: !r.include } : r))

  const run = async () => {
    setBusy(true); setErr(''); setProgress('Preparing…')
    try {
      const lockedUpTo = await getBooksLockDate('UIPL')
      // 1. vendors that are not in Parties yet
      const vendorByName = new Map(ctx.vendors.map(v => [v.vendorName.toLowerCase(), v]))
      for (const b of chosen) {
        if (b.vendor) continue
        const k = b.vendorName.toLowerCase(); let v = vendorByName.get(k)
        if (!v) {
          const body = { vendorName: b.vendorName, gstin: b.gstin || '', state: '', active: true, source: 'zoho-bill-import', createdBy: user?.uid || '', createdAt: new Date().toISOString() }
          const ref = await addDoc(collection(db, 'finance_vendors'), body); v = { id: ref.id, ...body }; vendorByName.set(k, v)
        }
        b.vendor = v
      }
      // 2. the bills, as purchase vouchers
      const idByKey = new Map(rows.filter(r => r.existing).map(r => [r.key, r.existing.id]))
      let made = 0
      for (const b of chosen) {
        setProgress(`Creating bills… ${++made}/${chosen.length}`)
        const { id } = await createVoucher(toPurchaseVoucher(b, { stateCode }), { user, profile: userProfile, lockedUpTo })
        idByKey.set(b.key, id)
      }
      // 3. link the payments
      let linked = 0
      if (link && match) {
        const byKey = new Map(rows.map(r => [r.key, r]))
        for (const m of match.matches) {
          const p = payments.find(x => x.id === m.paymentId); if (!p) continue
          const allocations = m.allocations.map(a => ({ billKey: `purchase:${idByKey.get(a.key)}`, docNumber: byKey.get(a.key)?.number || '', amount: a.amount }))
          if (allocations.some(a => a.billKey.endsWith('undefined'))) continue
          const first = byKey.get(m.allocations[0].key), v = p.voucher
          const sumAlloc = r2(allocations.reduce((t, a) => t + a.amount, 0))
          const fx = m.exact && Math.abs(m.fxDiff || 0) > 1.5
          const data = { ...v, partyType: 'vendor', partyId: first.vendor.id, partyName: first.vendor.vendorName,
            partyAmount: fx ? sumAlloc : p.cash, allocations, accountLines: [], ...(fx ? { bankAmountInr: p.cash } : { bankAmountInr: null }), currency: 'INR', fxRate: 1,
            narration: `${v.narration || ''}`.trim() }
          setProgress(`Linking payments… ${++linked}/${match.matches.length}`)
          await updateVoucher(v.id, v, data, { user, profile: userProfile, lockedUpTo })
        }
      }
      invalidateFinanceCache()
      setResult(`Done — ${chosen.length} bill(s) imported${link ? `, ${linked} payment(s) linked to them` : ''}.`)
      onDone?.()
    } catch (ex) { setErr('Import stopped: ' + ex.message) } finally { setBusy(false); setProgress('') }
  }

  const newVendors = [...new Set(chosen.filter(b => !b.vendor).map(b => b.vendorName))]
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`${cardCls} w-full max-w-6xl p-5 space-y-3 max-h-[94vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold text-slate-800">Import purchase bills from Zoho Books</h3><p className="text-xs text-slate-400">Zoho Books → Bills → Export (CSV). Bills become purchase vouchers (GST, TDS and ledgers kept as in Zoho). Bank payments already in the books are linked to the bills they paid.</p></div>{!busy && <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>}</div>
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}
        {result && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{result}</div>}
        {!ctx && !err && <p className="text-sm text-slate-400">Loading vendors and vouchers…</p>}
        {ctx && <div><button className={btnGhost} onClick={() => fileRef.current?.click()}>{fileName || 'Choose the bill export (.csv / .xlsx)'}</button><input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} /></div>}
        {rows && (
          <>
            <p className="text-sm text-slate-600"><b>{rows.length}</b> bills in the file · <b>{chosen.length}</b> to import ({fmtAmt(chosen.reduce((s, r) => s + r.total, 0))}) · {rows.filter(r => r.existing).length} already here · {rows.filter(r => r.skip).length} skipped{newVendors.length > 0 && <span className="text-amber-700"> · {newVendors.length} vendor(s) will be added: {newVendors.slice(0, 3).join(', ')}</span>}</p>
            <div className="overflow-auto rounded-lg border border-slate-200 max-h-[36vh]">
              <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase sticky top-0"><tr><th className="px-2 py-2 w-8" /><th className="text-left px-2">Bill</th><th className="text-left px-2">Date</th><th className="text-left px-2">Vendor</th><th className="text-left px-2">Ledger</th><th className="text-right px-2">Total</th><th className="text-right px-2">TDS</th><th className="text-right px-2">To pay</th><th className="px-2">Zoho</th><th className="text-left px-2">Payment</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{rows.map((r, i) => {
                  const mine = (match?.matches || []).filter(m => m.allocations.some(a => a.key === r.key))
                  return (
                    <tr key={r.key} className={r.include ? '' : 'opacity-50'}>
                      <td className="px-2"><input type="checkbox" checked={r.include} disabled={!!r.existing} onChange={() => toggle(i)} /></td>
                      <td className="px-2 py-1.5 font-mono max-w-[130px] truncate" title={r.number}>{r.number}{r.existing && <Badge color="bg-slate-100 text-slate-500">exists</Badge>}{r.skip && <span title={r.skip}><Badge color="bg-slate-100 text-slate-500">skipped</Badge></span>}</td>
                      <td className="px-2 whitespace-nowrap">{r.date}</td><td className="px-2 max-w-[200px] truncate" title={r.vendorName}>{r.vendor ? '' : '＋ '}{r.vendorName}</td>
                      <td className="px-2 max-w-[150px] truncate" title={r.accounts.join(', ')}>{r.accounts.join(', ')}</td>
                      <td className="px-2 text-right" title={r.warnings.join('\n')}>{fmtAmt(r.total)}{r.warnings.length ? ' ⚠' : ''}</td><td className="px-2 text-right">{r.tds.applicable ? fmtAmt(r.tds.amount) : ''}</td><td className="px-2 text-right font-medium">{fmtAmt(r.net)}</td>
                      <td className="px-2 text-center"><Badge color={r.status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>{r.status}</Badge></td>
                      <td className="px-2">{mine.length ? <span className="text-green-700">{mine.length} payment(s)</span> : <span className="text-slate-300">—</span>}</td>
                    </tr>)
                })}</tbody></table>
            </div>
            {match && (
              <div className="text-sm text-slate-600 space-y-1">
                <label className="flex items-center gap-2"><input type="checkbox" checked={link} onChange={e => setLink(e.target.checked)} /><b>Link bank payments to these bills</b> — {match.matches.length} of {payments.length} payments match ({fmtAmt(match.matches.reduce((s, m) => s + m.cash, 0))}). Payments that were booked straight to an expense are switched to the vendor so the cost is not counted twice.</label>
                {match.remaining.length > 0 && <p className="text-xs text-slate-500 ml-6">{match.remaining.length} bill(s) stay unpaid in the books ({fmtAmt(match.remaining.reduce((s, r) => s + r.left, 0))}); Zoho shows {fmtAmt(match.remaining.reduce((s, r) => s + r.zohoBalance, 0))} of that as unpaid — the rest was paid some other way (card, a director, another bank).</p>}
              </div>
            )}
            <div className="flex gap-2 items-center"><button className={btnPrimary} disabled={busy || !!result || !chosen.length} onClick={run}>{busy ? (progress || 'Working…') : `Import ${chosen.length} bill(s)${link && match?.matches.length ? ` & link ${match.matches.length} payment(s)` : ''}`}</button><button className={btnGhost} disabled={busy} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button></div>
          </>
        )}
      </div>
    </div>
  )
}
