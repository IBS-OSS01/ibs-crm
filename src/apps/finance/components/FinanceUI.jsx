// Small shared UI pieces for the finance pages, so every report has the same
// look, the same company switch, the same date presets and the same export bar.
import React from 'react'
import { useAuth, usePermissions } from '../../../context/AuthContext'
import { COMPANIES, currentFY, fyRange, fmtAmt, drCr } from '../utils/financeConstants.js'

export const inputCls = 'px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
export const formInputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
export const labelCls = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1'
export const cardCls = 'bg-white rounded-2xl shadow-card border border-slate-200/70'
export const btnPrimary = 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50'
export const btnGhost = 'px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition disabled:opacity-50'
export const thCls = 'px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500'

// Finance write access — mirrors firestore.rules' hasFinanceWriteAccess():
// admin, or an explicit FINANCE:edit right, or the legacy departments[] fallback.
export function useFinancePerms() {
  const { userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const isAdmin = userProfile?.role === 'admin'
  return { isAdmin, canWrite: isAdmin || canEdit('FINANCE') }
}

export function CompanyToggle({ value, onChange }) {
  return (
    <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
      {COMPANIES.map(co => (
        <button key={co} onClick={() => onChange(co)}
          className={`px-4 py-1.5 font-medium transition ${value === co ? (co === 'UIPL' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white') : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          {co}
        </button>
      ))}
    </div>
  )
}

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function periodPresets() {
  const now = new Date()
  const fy = fyRange(currentFY())
  const lastFyStart = `${Number(fy.from.slice(0, 4)) - 1}-04-01`
  const lastFyEnd = `${Number(fy.from.slice(0, 4))}-03-31`
  const mFrom = new Date(now.getFullYear(), now.getMonth(), 1)
  const lmFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lmTo = new Date(now.getFullYear(), now.getMonth(), 0)
  const qStartMonth = now.getMonth() - ((now.getMonth() - 3 + 12) % 3)   // FY quarters start Apr/Jul/Oct/Jan
  const qFrom = new Date(now.getFullYear(), qStartMonth, 1)
  return [
    { label: 'This month', from: ymd(mFrom), to: ymd(now) },
    { label: 'Last month', from: ymd(lmFrom), to: ymd(lmTo) },
    { label: 'This quarter', from: ymd(qFrom), to: ymd(now) },
    { label: 'This FY', from: fy.from, to: fy.to },
    { label: 'Last FY', from: lastFyStart, to: lastFyEnd },
  ]
}

export function DateRange({ from, to, onChange, presets = true }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input type="date" value={from} onChange={e => onChange({ from: e.target.value, to })} className={inputCls} />
      <span className="text-slate-400 text-sm">to</span>
      <input type="date" value={to} onChange={e => onChange({ from, to: e.target.value })} className={inputCls} />
      {presets && (
        <select value="" onChange={e => { const p = periodPresets()[e.target.value]; if (p) onChange({ from: p.from, to: p.to }) }} className={inputCls}>
          <option value="">Quick period…</option>
          {periodPresets().map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
        </select>
      )}
    </div>
  )
}

export function ExportBar({ onXlsx, onCsv, onPrint }) {
  return (
    <div className="flex gap-2">
      {onXlsx && <button onClick={onXlsx} className={btnGhost}>⬇ Excel</button>}
      {onCsv && <button onClick={onCsv} className={btnGhost}>⬇ CSV</button>}
      {onPrint && <button onClick={onPrint} className={btnGhost}>🖨 Print / PDF</button>}
    </div>
  )
}

export function ReportShell({ title, subtitle, filters, exportBar, children, loading, banner }) {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h2>
          {subtitle && <p className="text-slate-500 text-sm">{subtitle}</p>}
        </div>
        {exportBar}
      </div>
      {filters && <div className="flex items-center gap-3 flex-wrap">{filters}</div>}
      {banner}
      {loading ? <div className="flex items-center justify-center h-48 text-slate-400">Loading…</div> : children}
    </div>
  )
}

export function Empty({ children }) {
  return <div className={`${cardCls} p-8 text-center text-slate-400 text-sm`}>{children}</div>
}

export function StatCard({ label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-800', green: 'text-green-700', red: 'text-red-600', blue: 'text-blue-700', amber: 'text-amber-600', purple: 'text-purple-700',
  }
  return (
    <div className={`${cardCls} p-4`}>
      <p className={`text-xl font-bold ${tones[tone]}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

// Signed (debit − credit) balance shown Tally-style as "1,234.00 Dr".
export function DrCr({ value, className = '' }) {
  const { amount, side } = drCr(value)
  if (amount === 0) return <span className={`text-slate-400 ${className}`}>—</span>
  return <span className={className}>{fmtAmt(amount)} <span className="text-xs text-slate-400">{side}</span></span>
}

export const Money = ({ v, className = '' }) =>
  (Number(v) || 0) === 0 ? <span className={`text-slate-300 ${className}`}>—</span> : <span className={className}>{fmtAmt(v)}</span>

export function Badge({ children, color = 'bg-slate-100 text-slate-600' }) {
  return <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${color}`}>{children}</span>
}
