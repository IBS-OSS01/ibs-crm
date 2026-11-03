// Import sales invoices from a Zoho Books "Invoice" export, and link the bank receipts that are already in the books
// "on account" to them (with the TDS the customer deducted). Everything is previewed first.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDocs, getDoc, writeBatch } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { readSheetFile } from '../utils/readSheetFile.js'
import * as XLSX from 'xlsx'
import { parseZohoInvoices, toInvoiceDoc, matchReceipts } from '../utils/zohoSales.js'
import { updateVoucher, getBooksLockDate } from '../utils/voucherService.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { fmtAmt, r2 } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls, Badge } from './FinanceUI.jsx'

const loadAll = async (name) => { const s = await getDocs(collection(db, name)); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); return a }

export default function InvoicesImport({ onClose, onDone }) {
  const { user, userProfile } = useAuth()
  const fileRef = useRef(null)
  const [ctx, setCtx] = useState(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState('')

  useEffect(() => {
    Promise.all([loadAll('crm_customers'), loadAll('finance_invoices'), loadAll('finance_vouchers'), getDoc(doc(db, 'company_settings', 'UIPL'))])
      .then(([customers, invoices, vouchers, seller]) => setCtx({ customers, invoices, vouchers, seller: seller.exists() ? seller.data() : {} }))
      .catch(e => setErr('Could not load existing data: ' + e.message))
  }, [])

  const existingNumbers = useMemo(() => new Map((ctx?.invoices || []).filter(i => i.company === 'UIPL').map(i => [i.invoiceNumber, i])), [ctx])

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f || !ctx) return
    setErr(''); setResult(''); setFileName(f.name)
    try {
      const wb = await readSheetFile(f)
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      if (!data.length || !('Invoice Number' in data[0]) || !('Item Total' in data[0])) return setErr('This does not look like a Zoho Books invoice export (expected “Invoice Number” and “Item Total” columns).')
      setRows(parseZohoInvoices(data, { customers: ctx.customers }).map(i => ({ ...i, existing: existingNumbers.get(i.number) || null, include: !existingNumbers.get(i.number) })))
    } catch (ex) { setErr('Could not read that file: ' + ex.message) }
  }

  // receipts that are on account (nothing allocated yet), as the bank entries created them
  const receipts = useMemo(() => (ctx?.vouchers || []).filter(v => v.voucherType === 'receipt' && v.company === 'UIPL' && v.status !== 'cancelled' && v.partyName && !(v.allocations || []).length && !(v.tdsReceivable?.applicable))
    .map(v => ({ id: v.id, date: v.date, partyName: v.partyName, cash: r2(Number(v.partyAmount) || 0), voucher: v })), [ctx])
  const match = useMemo(() => {
    if (!rows) return null
    const inv = rows.filter(r => r.include || r.existing).map(r => ({ number: r.number, date: r.date, total: r.total, subTotal: r.subTotal, customerName: r.customerName, zohoBalance: r.zohoBalance }))
    return matchReceipts(inv, receipts)
  }, [rows, receipts])
  const chosen = useMemo(() => (rows || []).filter(r => r.include && !r.existing), [rows])
  const toggle = (i) => setRows(rs => rs.map((r, n) => n === i ? { ...r, include: !r.include } : r))
  const [linkReceipts, setLinkReceipts] = useState(true)

  const run = async () => {
    setBusy(true); setErr(''); setProgress('Saving invoices…')
    try {
      // 1. the invoices, with ids known up front so receipts can point at them
      const idByNumber = new Map(rows.filter(r => r.existing).map(r => [r.number, r.existing.id]))
      let batch = writeBatch(db), ops = 0
      for (const r of chosen) {
        const ref = doc(collection(db, 'finance_invoices')); idByNumber.set(r.number, ref.id)
        batch.set(ref, toInvoiceDoc(r, { seller: ctx.seller, user })); if (++ops >= 400) { await batch.commit(); batch = writeBatch(db); ops = 0 }
      }
      if (ops) await batch.commit()
      // 2. link the receipts
      let linked = 0
      if (linkReceipts && match) {
        const lockedUpTo = await getBooksLockDate('UIPL')
        const byNumber = new Map(rows.map(r => [r.number, r]))
        for (const m of match.matches) {
          const rc = receipts.find(x => x.id === m.receiptId); if (!rc) continue
          const first = byNumber.get(m.allocations[0].number)
          const allocations = m.allocations.map(a => ({ billKey: `invoice:${idByNumber.get(a.number)}`, docNumber: a.number, amount: a.amount }))
          if (allocations.some(a => a.billKey.endsWith('undefined'))) continue         // invoice not imported (un-ticked)
          const v = rc.voucher
          const data = { ...v, ...(first?.customer ? { partyId: first.customer.id, partyName: first.customer.shopName } : {}),
            partyAmount: r2(m.cash + m.tds), allocations, tdsReceivable: m.tds > 0 ? { applicable: true, section: m.tdsSection, amount: m.tds } : { applicable: false },
            narration: `${v.narration || ''}${m.tds > 0 ? ` · incl. TDS ${fmtAmt(m.tds)}` : ''}`.trim() }
          setProgress(`Linking receipts… ${++linked}/${match.matches.length}`)
          await updateVoucher(v.id, v, data, { user, profile: userProfile, lockedUpTo })
        }
      }
      invalidateFinanceCache()
      setResult(`Done — ${chosen.length} invoice(s) imported${linkReceipts ? `, ${linked} receipt(s) linked to them` : ''}.`)
      onDone?.()
    } catch (ex) { setErr('Import stopped: ' + ex.message) } finally { setBusy(false); setProgress('') }
  }

  const tdsTotal = match ? match.matches.reduce((s, m) => s + m.tds, 0) : 0
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`${cardCls} w-full max-w-6xl p-5 space-y-3 max-h-[94vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold text-slate-800">Import sales invoices from Zoho Books</h3><p className="text-xs text-slate-400">Zoho Books → Invoices → Export (CSV). Invoice numbers, dates, GST and totals are kept exactly as issued. Invoices already here (same number) are skipped.</p></div>{!busy && <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>}</div>
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}
        {result && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{result}</div>}
        {!ctx && !err && <p className="text-sm text-slate-400">Loading customers, invoices and receipts…</p>}
        {ctx && <div><button className={btnGhost} onClick={() => fileRef.current?.click()}>{fileName || 'Choose the invoice export (.csv / .xlsx)'}</button><input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} /></div>}
        {rows && (
          <>
            <p className="text-sm text-slate-600"><b>{rows.length}</b> invoices in the file · <b>{chosen.length}</b> to import ({fmtAmt(chosen.reduce((s, r) => s + r.total, 0))}) · {rows.filter(r => r.existing).length} already here{rows.some(r => r.warnings.length) && <span className="text-amber-700"> · {rows.filter(r => r.warnings.length).length} with a note</span>}</p>
            <div className="overflow-auto rounded-lg border border-slate-200 max-h-[38vh]">
              <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase sticky top-0"><tr><th className="px-2 py-2 w-8" /><th className="text-left px-2">Invoice</th><th className="text-left px-2">Date</th><th className="text-left px-2">Customer</th><th className="text-right px-2">Taxable</th><th className="text-right px-2">GST</th><th className="text-right px-2">Total</th><th className="px-2">Zoho</th><th className="text-left px-2">Receipts linked</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{rows.map((r, i) => {
                  const mine = (match?.matches || []).filter(m => m.allocations.some(a => a.number === r.number))
                  const got = mine.reduce((s, m) => s + m.allocations.filter(a => a.number === r.number).reduce((t, a) => t + a.amount, 0), 0)
                  return (
                    <tr key={r.number} className={r.include ? '' : 'opacity-50'}>
                      <td className="px-2"><input type="checkbox" checked={r.include} disabled={!!r.existing} onChange={() => toggle(i)} /></td>
                      <td className="px-2 py-1.5 font-mono">{r.number}{r.existing && <Badge color="bg-slate-100 text-slate-500">exists</Badge>}</td><td className="px-2 whitespace-nowrap">{r.date}</td>
                      <td className="px-2 max-w-[220px] truncate" title={r.customerName}>{r.customer ? '' : '⚠ '}{r.customerName}{r.posState && r.posState !== 'Maharashtra' ? <span className="text-slate-400"> · {r.posState}</span> : null}</td>
                      <td className="px-2 text-right">{fmtAmt(r.subTotal)}</td><td className="px-2 text-right">{fmtAmt(r.gstLines.reduce((s, g) => s + g.amount, 0))}</td><td className="px-2 text-right font-medium" title={r.warnings.join('\n')}>{fmtAmt(r.total)}{r.warnings.length ? ' ⚠' : ''}</td>
                      <td className="px-2 text-center"><Badge color={r.status === 'Closed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>{r.status}{r.zohoBalance ? ` · ${fmtAmt(r.zohoBalance)} due` : ''}</Badge></td>
                      <td className="px-2">{mine.length ? <span className="text-green-700">{fmtAmt(got)} from {mine.length} receipt(s)</span> : <span className="text-slate-300">—</span>}</td>
                    </tr>)
                })}</tbody></table>
            </div>
            {match && (
              <div className="text-sm text-slate-600 space-y-1">
                <label className="flex items-center gap-2"><input type="checkbox" checked={linkReceipts} onChange={e => setLinkReceipts(e.target.checked)} /><b>Link bank receipts to these invoices</b> — {match.matches.length} of {receipts.length} on-account receipts match ({fmtAmt(match.matches.reduce((s, m) => s + m.cash, 0))} cash{tdsTotal ? `, plus ${fmtAmt(tdsTotal)} TDS the customers deducted, booked as TDS receivable` : ''}).</label>
                {match.unmatched.length > 0 && <p className="text-xs text-amber-700 ml-6">{match.unmatched.length} receipt(s) stay on account: {match.unmatched.slice(0, 4).map(u => `${u.date} ${u.partyName.slice(0, 18)} ${fmtAmt(u.cash)}`).join('; ')}{match.unmatched.length > 4 ? '…' : ''}</p>}
                {match.remaining.length > 0 && <p className="text-xs text-slate-500 ml-6">Still unpaid after linking: {match.remaining.map(r => `${r.number} ${fmtAmt(r.left)}${Math.abs(r.left - r.zohoBalance) > 1 ? ` (Zoho: ${fmtAmt(r.zohoBalance)} — the rest was received in a bank not imported yet)` : ''}`).join(' · ')}</p>}
              </div>
            )}
            <div className="flex gap-2 items-center"><button className={btnPrimary} disabled={busy || !!result || (!chosen.length && !(linkReceipts && match?.matches.length))} onClick={run}>{busy ? (progress || 'Working…') : `Import ${chosen.length} invoice(s)${linkReceipts && match?.matches.length ? ` & link ${match.matches.length} receipt(s)` : ''}`}</button><button className={btnGhost} disabled={busy} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button></div>
          </>
        )}
      </div>
    </div>
  )
}
