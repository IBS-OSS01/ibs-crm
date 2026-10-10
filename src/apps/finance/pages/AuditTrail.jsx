// Audit trail (who created / edited / cancelled / deleted which voucher) and the
// books-lock date — the accounting equivalent of closing a financial year.
import React, { useMemo, useState } from 'react'
import { addDoc, collection, doc, setDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { VOUCHER_TYPES, fmtAmt, fyRange, currentFY } from '../utils/financeConstants.js'
import { downloadXlsx } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, DateRange, ExportBar, Badge, Empty, cardCls, inputCls, thCls, btnPrimary, useFinancePerms } from '../components/FinanceUI.jsx'

const ACTION = { create: ['bg-green-100 text-green-700', 'Created'], edit: ['bg-blue-100 text-blue-700', 'Edited'], cancel: ['bg-amber-100 text-amber-700', 'Cancelled'], delete: ['bg-red-100 text-red-700', 'Deleted'], lock: ['bg-purple-100 text-purple-700', 'Lock date'] }

export default function AuditTrail() {
  const { isAdmin } = useFinancePerms()
  const { user, userProfile } = useAuth()
  const { raw, loading, reload } = useFinanceData(['auditLog'])
  const [company, setCompany] = useState('UIPL')
  const [period, setPeriod] = useState({ from: fyRange(currentFY()).from, to: '9999-12-31' })
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState('')
  const [lock, setLock] = useState('')
  const [msg, setMsg] = useState('')

  const current = raw?.companySettings?.[company]?.booksLockedUpTo || ''
  const rows = useMemo(() => (raw?.auditLog || []).filter(e => (!e.company || e.company === company) && (e.at || '').slice(0, 10) >= period.from && (e.at || '').slice(0, 10) <= period.to &&
    (!action || e.action === action) && (!q || `${e.voucherNumber} ${e.byName} ${e.reason || ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 500), [raw, company, period, action, q])

  const saveLock = async (date) => {
    setMsg('')
    try {
      await setDoc(doc(db, 'company_settings', company), { booksLockedUpTo: date || '' }, { merge: true })
      await addDoc(collection(db, 'finance_audit_log'), { at: new Date().toISOString(), action: 'lock', company, by: user?.uid || '', byName: userProfile?.name || user?.email || '', reason: date ? `Books locked up to ${date}` : 'Lock removed', date: date || '' })
      invalidateFinanceCache(); reload(); setMsg(date ? `Books for ${company} are now locked up to ${date}.` : 'Lock removed.')
    } catch (e) { setMsg('Could not change the lock: ' + e.message) }
  }

  return (
    <ReportShell title="Audit Trail & Period Lock" loading={loading} subtitle="Every voucher change is recorded with who, when and (for edits) what it looked like before."
      exportBar={<ExportBar onXlsx={() => downloadXlsx(`Audit trail ${company}`, [{ name: 'Audit', rows: [['When', 'User', 'Action', 'Type', 'Voucher', 'Voucher date', 'Amount', 'Reason'], ...rows.map(e => [e.at, e.byName, e.action, e.voucherType || '', e.voucherNumber || '', e.date || '', e.amount ?? '', e.reason || ''])] }])} />}
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <DateRange from={period.from} to={period.to === '9999-12-31' ? '' : period.to} onChange={p => setPeriod({ from: p.from, to: p.to || '9999-12-31' })} />
        <select value={action} onChange={e => setAction(e.target.value)} className={inputCls}><option value="">All actions</option>{Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Voucher, user, reason…" className={`${inputCls} w-52`} />
      </>}>
      <div className={`${cardCls} p-4 flex items-end gap-3 flex-wrap`}>
        <div><p className="text-xs font-semibold text-slate-500 uppercase">Books locked up to</p><p className="text-lg font-bold text-slate-800">{current || 'Not locked'}</p>
          <p className="text-xs text-slate-400">No voucher dated on or before this day can be created, edited or cancelled.</p></div>
        {isAdmin && <>
          <input type="date" value={lock} onChange={e => setLock(e.target.value)} className={inputCls} />
          <button className={btnPrimary} disabled={!lock} onClick={() => saveLock(lock)}>Set lock date</button>
          {current && <button className="text-sm text-red-600 hover:underline" onClick={() => saveLock('')}>Remove lock</button>}
        </>}
        {!isAdmin && <p className="text-xs text-slate-400">Only an admin can change the lock date.</p>}
        {msg && <p className="text-sm text-blue-700 w-full">{msg}</p>}
      </div>
      <p className="text-xs text-slate-400">Note: only vouchers entered through the new voucher screens are locked and logged. Sales invoices and journal entries keep their own behaviour.</p>
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80"><tr><th className={`${thCls} text-left`}>When</th><th className={`${thCls} text-left`}>User</th><th className={`${thCls} text-left`}>Action</th><th className={`${thCls} text-left`}>Voucher</th><th className={`${thCls} text-left`}>Voucher date</th><th className={`${thCls} text-right`}>Amount</th><th className={`${thCls} text-left`}>Reason</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(e => (
              <React.Fragment key={e.id}>
                <tr className={`${e.before ? 'cursor-pointer hover:bg-slate-50' : ''}`} onClick={() => e.before && setOpen(open === e.id ? '' : e.id)}>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{(e.at || '').replace('T', ' ').slice(0, 16)}</td><td className="px-3 py-2">{e.byName || '—'}</td>
                  <td className="px-3 py-2"><Badge color={ACTION[e.action]?.[0]}>{ACTION[e.action]?.[1] || e.action}</Badge></td>
                  <td className="px-3 py-2 font-mono text-xs">{e.voucherNumber || '—'} <span className="text-slate-400 font-sans">{VOUCHER_TYPES[e.voucherType]?.label}</span></td>
                  <td className="px-3 py-2">{e.date || ''}</td><td className="px-3 py-2 text-right">{e.amount ? fmtAmt(e.amount) : ''}</td><td className="px-3 py-2 text-slate-500">{e.reason || (e.before ? 'click to see the earlier version' : '')}</td>
                </tr>
                {open === e.id && <tr><td colSpan={7} className="px-3 py-2 bg-slate-50"><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{prettyJson(e.before)}</pre></td></tr>}
              </React.Fragment>
            ))}
            {rows.length === 0 && <tr><td colSpan={7}><Empty>No audit entries match.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </ReportShell>
  )
}

function prettyJson(s) { try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }
