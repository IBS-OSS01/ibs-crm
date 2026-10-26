// Corrections found by comparing the books with Zoho Books. Nothing changes until Apply is pressed;
// each one is an ordinary voucher edit or a new voucher, and is kept in the audit log.
import React, { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { collection, doc, addDoc, updateDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { createVoucher, updateVoucher, cancelVoucher, getBooksLockDate } from '../utils/voucherService.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { fmtAmt } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls } from './FinanceUI.jsx'

export default function ZohoFixModal({ proposals, company, onClose, onDone }) {
  const { user, userProfile } = useAuth()
  const [on, setOn] = useState(() => new Set(proposals.map(p => p.key)))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const toggle = (k) => setOn(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const chosen = proposals.filter(p => on.has(p.key))
  const groups = [...new Set(proposals.map(p => p.group))]

  const run = async () => {
    setBusy(true); setProgress(0)
    let done = 0; const failed = []
    const made = {}                                     // proposal key -> the document just created (new vendors and bills that later entries refer to)
    const allocs = (p) => (p.allocFromBills || []).filter(a => made[a.bill]?.voucherNumber).map(a => ({ billKey: 'purchase:' + made[a.bill].id, docNumber: made[a.bill].voucherNumber, amount: a.amount }))
    try {
      const lockedUpTo = await getBooksLockDate(company)
      for (const p of chosen) {
        try {
          if (p.kind === 'vendorCreate') { const r = await addDoc(collection(db, 'finance_vendors'), { ...p.data, createdAt: new Date().toISOString(), createdBy: user?.uid || '' }); made[p.key] = { id: r.id } }
          else if (p.kind === 'create') {
            const data = { ...p.data, ...(p.vendorKey && made[p.vendorKey] ? { partyId: made[p.vendorKey].id } : {}), ...(p.allocFromBills ? { allocations: allocs(p) } : {}) }
            made[p.key] = await createVoucher(data, { user, profile: userProfile, lockedUpTo })
          }
          else if (p.kind === 'cancel') await cancelVoucher(p.id, p.before, p.detail, { user, profile: userProfile, lockedUpTo })
          else if (p.kind === 'journal') await addDoc(collection(db, 'finance_journal_entries'), { ...p.data, createdBy: user?.uid || '', createdByName: userProfile?.name || user?.email || '', createdAt: new Date().toISOString() })
          else if (p.kind === 'invoice') await updateDoc(doc(db, 'finance_invoices', p.id), p.fields)
          else if (p.kind === 'invoiceCreate') await addDoc(collection(db, 'finance_invoices'), { ...p.data, createdAt: new Date().toISOString(), createdBy: user?.uid || '' })
          else await updateVoucher(p.id, p.before, { ...p.fields, ...(p.allocFromBills ? { allocations: allocs(p) } : {}), date: p.fields.date || p.before.date }, { user, profile: userProfile, lockedUpTo })
          done++
        } catch (e) { failed.push(`${p.title}: ${e.message}`) }
        setProgress(n => n + 1)
      }
    } finally { invalidateFinanceCache(); setBusy(false); setResult({ done, failed }); onDone?.() }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`${cardCls} w-full max-w-5xl p-5 space-y-3 max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h3 className="text-lg font-bold text-slate-800">Corrections from Zoho Books</h3>
            <p className="text-xs text-slate-500">Zoho Books shows these vendor and customer entries differently from our books. Each line is a normal voucher edit (or a new voucher) that is kept in the audit trail and can be undone from there. Untick any you disagree with.</p></div>
          {!busy && <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>}
        </div>
        {result && <div className={`p-3 rounded-lg text-sm border ${result.failed.length ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-green-50 border-green-200 text-green-800'}`}>Done — {result.done} change{result.done === 1 ? '' : 's'} made.{result.failed.length > 0 && <span className="text-red-600"> {result.failed.length} failed: {result.failed.join(' · ')}</span>}</div>}
        {!proposals.length && <p className="text-sm text-slate-500">Nothing left to correct. ✓</p>}
        {groups.map(g => (
          <div key={g} className="overflow-auto rounded-lg border border-slate-200">
            <div className="px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-600 uppercase">{g} ({proposals.filter(p => p.group === g).length})</div>
            <table className="w-full text-xs"><tbody className="divide-y divide-slate-100">{proposals.filter(p => p.group === g).map(p => (
              <tr key={p.key}><td className="px-2 w-8"><input type="checkbox" checked={on.has(p.key)} disabled={busy || !!result} onChange={() => toggle(p.key)} /></td>
                <td className="px-2 py-1.5 font-mono whitespace-nowrap">{p.title}</td><td className="px-2 text-right whitespace-nowrap">{fmtAmt(p.amount)}</td><td className="px-2 text-slate-600">{p.detail}</td></tr>))}
            </tbody></table>
          </div>))}
        <div className="flex gap-2 items-center">
          {!result && <button className={btnPrimary} disabled={busy || !chosen.length} onClick={run}>{busy ? `Working… ${progress}/${chosen.length}` : `Apply ${chosen.length} change${chosen.length === 1 ? '' : 's'}`}</button>}
          {!busy && <button className={btnGhost} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>}
        </div>
      </div>
    </div>
  )
}
