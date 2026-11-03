// Import expenses from a Zoho Books "Expense" export. Expenses that already appear as a payment in the bank entries are
// re-classified (no duplicate); the rest are created as payment vouchers from the bank / ledger Zoho says they were paid through.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { collection, getDocs } from '../../../lib/cachedFirestore'
import * as XLSX from 'xlsx'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { readSheetFile } from '../utils/readSheetFile.js'
import { parseZohoExpenses, matchExpenses, reclassify, toExpenseVoucher } from '../utils/zohoExpenses.js'
import { createVoucher, updateVoucher, getBooksLockDate } from '../utils/voucherService.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { fmtAmt, r2 } from '../utils/financeConstants.js'
import { btnPrimary, btnGhost, cardCls, Badge } from './FinanceUI.jsx'

const loadAll = async (name) => { const s = await getDocs(collection(db, name)); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); return a }

export default function ExpensesImport({ onClose, onDone }) {
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
    Promise.all([loadAll('finance_vouchers'), loadAll('finance_bank_accounts')]).then(([vouchers, banks]) => setCtx({ vouchers, banks })).catch(e => setErr('Could not load existing data: ' + e.message))
  }, [])

  const bankIds = useMemo(() => {
    const find = (re) => (ctx?.banks || []).find(b => b.company === 'UIPL' && re.test(`${b.name} ${b.bankName || ''}`))?.id
    return { hsbc: find(/hsbc/i), hdfc: find(/hdfc/i), yes: find(/yes/i) }
  }, [ctx])
  const payments = useMemo(() => (ctx?.vouchers || []).filter(v => v.voucherType === 'payment' && v.company === 'UIPL' && v.status !== 'cancelled' && !v.expenseRef && (Number(v.amount) || 0) > 0)
    .map(v => ({ id: v.id, date: v.date, cash: r2(Number(v.amount) || 0), bankAccountId: v.bankAccountId || '', voucher: v })), [ctx])
  const doneRefs = useMemo(() => new Set((ctx?.vouchers || []).filter(v => v.expenseRef && v.status !== 'cancelled').map(v => v.expenseRef)), [ctx])

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f || !ctx) return
    setErr(''); setResult(''); setFileName(f.name)
    try {
      const wb = await readSheetFile(f)
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      if (!data.length || !('Expense Account' in data[0]) || !('Paid Through' in data[0])) return setErr('This does not look like a Zoho Books expense export (expected “Expense Account” and “Paid Through” columns).')
      setRows(parseZohoExpenses(data).filter(x => !doneRefs.has(x.refId)))
    } catch (ex) { setErr('Could not read that file: ' + ex.message) }
  }
  const plan = useMemo(() => rows ? matchExpenses(rows, payments, bankIds) : null, [rows, payments, bankIds])
  const matchOf = useMemo(() => new Map((plan?.matches || []).map(m => [m.expense.idx, m])), [plan])

  const run = async () => {
    setBusy(true); setErr('')
    try {
      const lockedUpTo = await getBooksLockDate('UIPL')
      let k = 0, changed = 0, created = 0
      for (const m of plan.matches) {
        const v = payments.find(p => p.id === m.paymentId).voucher
        const { changed: ch, data } = reclassify(v, m.expense); setProgress(`Updating entries… ${++k}/${plan.matches.length}`)
        await updateVoucher(v.id, v, data, { user, profile: userProfile, lockedUpTo }); if (ch) changed++
      }
      for (const e of plan.fresh) {
        setProgress(`Creating entries… ${created + 1}/${plan.fresh.length}`)
        await createVoucher(toExpenseVoucher(e, { bankIds }), { user, profile: userProfile, lockedUpTo }); created++
      }
      invalidateFinanceCache(); setResult(`Done — ${plan.matches.length} existing bank entries tied to their expense (${changed} re-classified), ${created} new entr${created === 1 ? 'y' : 'ies'} created.`); onDone?.()
    } catch (ex) { setErr('Import stopped: ' + ex.message) } finally { setBusy(false); setProgress('') }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className={`${cardCls} w-full max-w-5xl p-5 space-y-3 max-h-[94vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold text-slate-800">Import expenses from Zoho Books</h3><p className="text-xs text-slate-400">Zoho Books → Expenses → Export (CSV). An expense that is already in the books as a bank payment is tied to it, not entered twice.</p></div>{!busy && <button onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button>}</div>
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{err}</div>}
        {result && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{result}</div>}
        {!ctx && !err && <p className="text-sm text-slate-400">Loading entries…</p>}
        {ctx && <div><button className={btnGhost} onClick={() => fileRef.current?.click()}>{fileName || 'Choose the expense export (.csv / .xlsx)'}</button><input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} /></div>}
        {rows && plan && (
          <>
            <p className="text-sm text-slate-600"><b>{rows.length}</b> expenses ({fmtAmt(rows.reduce((s, r) => s + r.total, 0))}) · <b>{plan.matches.length}</b> already in the books as bank payments · <b>{plan.fresh.length}</b> new entries ({fmtAmt(plan.fresh.reduce((s, r) => s + r.total, 0))}){plan.orphans.length > 0 && <span className="text-amber-700"> · {plan.orphans.length} marked “paid through HSBC” have no line in the HSBC statement ({fmtAmt(plan.orphans.reduce((s, r) => s + r.total, 0))}) and are left out</span>}</p>
            <div className="overflow-auto rounded-lg border border-slate-200 max-h-[44vh]">
              <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase sticky top-0"><tr><th className="text-left px-2 py-2">Date</th><th className="text-left px-2">Expense</th><th className="text-left px-2">Vendor / note</th><th className="text-left px-2">Paid through</th><th className="text-right px-2">Amount</th><th className="text-left px-2">Ledger</th><th className="px-2">In the books</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{rows.map(r => {
                  const m = matchOf.get(r.idx), vo = m ? payments.find(p => p.id === m.paymentId)?.voucher : null
                  return (<tr key={r.idx}><td className="px-2 py-1.5 whitespace-nowrap">{r.date}</td><td className="px-2">{r.account}</td><td className="px-2 max-w-[220px] truncate" title={`${r.vendor} ${r.description}`}>{r.vendor || r.description}</td><td className="px-2">{r.paidThrough}{r.warnings.length ? ' ⚠' : ''}</td><td className="px-2 text-right">{fmtAmt(r.total)}</td><td className="px-2 font-mono">{r.ledger}</td>
                    <td className="px-2 text-center">{vo ? <Badge color="bg-green-100 text-green-700">tied to {vo.voucherNumber}</Badge> : plan.orphans.includes(r) ? <Badge color="bg-amber-100 text-amber-700">not in HSBC statement</Badge> : <Badge color="bg-blue-100 text-blue-700">new entry</Badge>}</td></tr>)
                })}</tbody></table>
            </div>
            <div className="flex gap-2"><button className={btnPrimary} disabled={busy || !!result || !rows.length} onClick={run}>{busy ? (progress || 'Working…') : `Import ${rows.length} expense(s)`}</button><button className={btnGhost} disabled={busy} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button></div>
          </>
        )}
      </div>
    </div>
  )
}
