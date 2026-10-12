// Entries made from bank statements that were parked in a clearing ledger: today's rules found a proper home for these.
// Nothing changes until Apply is pressed; each one is an ordinary voucher edit (kept in the audit log).
import React, { useMemo, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { updateVoucher, getBooksLockDate } from '../utils/voucherService.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { reclassifiedFields } from '../utils/reclassify.js'
import { fmtAmt } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls } from './FinanceUI.jsx'

export default function ReclassifyModal({ proposals, accounts, company, onClose, onDone }) {
  const { user, userProfile } = useAuth()
  const [on, setOn] = useState(() => new Set(proposals.map(p => p.voucher.id)))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const nameOf = useMemo(() => Object.fromEntries((accounts || []).map(a => [a.code, a.name])), [accounts])
  const toggle = (id) => setOn(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const chosen = proposals.filter(p => on.has(p.voucher.id))

  const run = async () => {
    setBusy(true)
    let done = 0; const failed = []
    try {
      const lockedUpTo = await getBooksLockDate(company)
      for (const { voucher: v, suggestion: s } of chosen) {
        try { await updateVoucher(v.id, v, { ...reclassifiedFields(v, s), date: v.date }, { user, profile: userProfile, lockedUpTo }); done++ }
        catch (e) { failed.push(`${v.voucherNumber}: ${e.message}`) }
      }
    } finally { invalidateFinanceCache(); setBusy(false); setResult({ done, failed }); onDone?.() }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`${cardCls} w-full max-w-5xl p-5 space-y-3 max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h3 className="text-lg font-bold text-slate-800">Parked entries that can now be classified</h3>
            <p className="text-xs text-slate-500">These were booked from the bank statement into a clearing ledger (Miscellaneous Expenses / Other Current Liabilities) or guessed as salary. The bank narrative now identifies them. Untick any you disagree with.</p></div>
          {!busy && <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>}
        </div>
        {result && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">Done — {result.done} entr{result.done === 1 ? 'y' : 'ies'} re-classified.{result.failed.length > 0 && <span className="text-red-600"> {result.failed.length} failed: {result.failed.join(' · ')}</span>}</div>}
        <div className="overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 w-8" /><th className="text-left px-2">Date</th><th className="text-left px-2">Entry</th><th className="text-left px-2">Bank narrative</th><th className="text-right px-2">Amount</th><th className="text-left px-2">Now in</th><th className="text-left px-2">Move to</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{proposals.map(({ voucher: v, suggestion: s }) => (
              <tr key={v.id}><td className="px-2"><input type="checkbox" checked={on.has(v.id)} disabled={busy || !!result} onChange={() => toggle(v.id)} /></td>
                <td className="px-2 whitespace-nowrap">{v.date}</td><td className="px-2 font-mono">{v.voucherNumber}</td><td className="px-2 max-w-[260px] truncate" title={v.narration}>{v.narration}</td>
                <td className="px-2 text-right">{fmtAmt(v.amount)}</td>
                <td className="px-2 text-slate-500">{v.accountLines?.[0] ? `${v.accountLines[0].accountCode} ${nameOf[v.accountLines[0].accountCode] || ''}` : `Payment to ${v.partyName}${(v.allocations || []).length ? ' (linked to bills)' : ''}`}</td>
                <td className="px-2 font-medium text-slate-800">{s.partyName || `${s.accountCode} ${nameOf[s.accountCode] || ''}`}<span className="block text-[10px] font-normal text-slate-400">{s.reason}</span></td></tr>))}
            </tbody></table>
        </div>
        <div className="flex gap-2"><button className={btnPrimary} disabled={busy || !!result || !chosen.length} onClick={run}>{busy ? 'Working…' : `Apply to ${chosen.length} entr${chosen.length === 1 ? 'y' : 'ies'}`}</button><button className={btnGhost} disabled={busy} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button></div>
      </div>
    </div>
  )
}
