import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useUsers } from '../../../lib/useUsers'

// ── Constants ─────────────────────────────────────────────────────────────────
const ALL_STAGES = [
  { id: 'lead',     label: 'Lead',     bar: 'bg-slate-400' },
  { id: 'prebid',   label: 'Pre-bid',  bar: 'bg-blue-400' },
  { id: 'bid',      label: 'Bid',      bar: 'bg-amber-400' },
  { id: 'closing',  label: 'Closing',  bar: 'bg-purple-500' },
  { id: 'hold',     label: 'On Hold',  bar: 'bg-cyan-500' },
  { id: 'won',      label: 'Won',      bar: 'bg-green-500' },
  { id: 'lost',     label: 'Lost',     bar: 'bg-red-400' },
  { id: 'rejected', label: 'Rejected', bar: 'bg-orange-400' },
  { id: 'nobid',    label: 'No Bid',   bar: 'bg-slate-300' },
]
const OPEN_STAGES   = ['lead', 'prebid', 'bid', 'closing']  // funnel stages (excludes hold)
const CLOSED_STAGES = ['won', 'lost', 'rejected', 'nobid']
// Hold is active (not closed) but paused — counted in open metrics, shown separately in funnel
const HOLD_STAGE    = 'hold'

const COMPANY_CONFIG = {
  UIPL: {
    label: 'UIPL', subtitle: 'Udishtha Innovations Pvt. Ltd.',
    tabCls: 'bg-blue-600 text-white', hdrCls: 'from-blue-600 to-blue-700',
    accent: 'text-blue-600', accentBg: 'bg-blue-600', border: 'border-blue-500',
    note: 'Won opportunities auto-create Finance projects.',
  },
  Wayzim: {
    label: 'Wayzim Technology Co Ltd', subtitle: 'Wayzim Technology Co Ltd',
    tabCls: 'bg-purple-600 text-white', hdrCls: 'from-purple-600 to-purple-700',
    accent: 'text-purple-600', accentBg: 'bg-purple-600', border: 'border-purple-500',
    note: 'Won opportunities tracked for project management only — no Finance project created.',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const valINR  = (d) => d.valueINR ?? Number(d.value) ?? 0
const fmtINR  = (n) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr`
  : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L`
  : `₹${Math.round(n).toLocaleString('en-IN')}`

const todayStr = () => new Date().toISOString().slice(0, 10)
const addDays  = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }

// India FY: Apr 1 – Mar 31
const fyStart = () => {
  const now = new Date(); const y = now.getFullYear()
  return now.getMonth() < 3 ? `${y - 1}-04-01` : `${y}-04-01`
}
const fyEnd = () => {
  const now = new Date(); const y = now.getFullYear()
  return now.getMonth() < 3 ? `${y}-03-31` : `${y + 1}-03-31`
}

const PRESETS = [
  { id: 'all',       label: 'All Time' },
  { id: 'this_month',label: 'This Month' },
  { id: 'last_month',label: 'Last Month' },
  { id: 'this_qtr',  label: 'This Quarter' },
  { id: 'this_fy',   label: 'This AY' },
  { id: 'custom',    label: 'Custom' },
]

const presetRange = (id) => {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  if (id === 'all')        return { from: '', to: '' }
  if (id === 'this_month') return { from: `${y}-${String(m+1).padStart(2,'0')}-01`, to: todayStr() }
  if (id === 'last_month') {
    const lm = new Date(y, m - 1, 1)
    const lme = new Date(y, m, 0)
    return { from: lm.toISOString().slice(0,10), to: lme.toISOString().slice(0,10) }
  }
  if (id === 'this_qtr') {
    const qStart = new Date(y, Math.floor(m / 3) * 3, 1)
    return { from: qStart.toISOString().slice(0,10), to: todayStr() }
  }
  if (id === 'this_fy')  return { from: fyStart(), to: fyEnd() }
  return { from: '', to: '' }
}

// Last N months as { key:'YYYY-MM', label:'Jan', isCurrentMonth }
const buildMonths = (n = 12) => {
  const now = new Date()
  const arr = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    arr.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-IN', { month: 'short' }),
      isCurrent: i === 0,
      value: 0, count: 0,
    })
  }
  return arr
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, onClick }) {
  return (
    <button onClick={onClick}
      className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 shadow-sm text-left w-full hover:border-blue-400 hover:shadow-md active:scale-95 transition-all group">
      <div className="text-2xl mb-1">{icon}</div>
      <p className="text-xl font-bold text-slate-900 tracking-tight group-hover:text-blue-700">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5 font-medium">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      <p className="text-xs text-blue-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">View details →</p>
    </button>
  )
}

// ── Drill-down Modal ──────────────────────────────────────────────────────────
function DrillDownModal({ title, subtitle, items, columns, onClose }) {
  const totalVal = columns.some(c => c.isValue)
    ? items.reduce((s, row) => s + (Number(row.__value) || 0), 0)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle} · {items.length} record{items.length !== 1 ? 's' : ''}
              {totalVal != null && <> · <span className="font-semibold text-green-700">{fmtINR(totalVal)}</span> total</>}
            </p>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition text-lg leading-none">✕</button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          {items.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p className="text-2xl mb-2">📭</p>
              <p className="text-sm">No records found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider sticky top-0">
                <tr>
                  {columns.map(c => (
                    <th key={c.key} className={`px-4 py-3 font-semibold ${c.right ? 'text-right' : 'text-left'}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((row, i) => (
                  <tr key={row.id || i} className="hover:bg-slate-50">
                    {columns.map(c => (
                      <td key={c.key} className={`px-4 py-3 ${c.right ? 'text-right' : ''}`}>
                        {c.render ? c.render(row) : (row[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Site Edit Modal ───────────────────────────────────────────────────────────
const SITE_STATUS_OPTIONS = ['lead', 'project', 'service']

function SiteEditModal({ site, onClose, onSaved }) {
  const [form, setForm] = useState({
    siteName:         site.siteName || site.name || '',
    address:          site.address  || '',
    status:           site.status   || 'lead',
    customerName:     site.customerName || '',
    projectNumber:    site.projectNumber || '',
    notes:            site.notes    || '',
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await updateDoc(doc(db, 'crm_sites', site.id), {
        ...form,
        updatedAt: new Date().toISOString(),
      })
      onSaved({ ...site, ...form })
    } catch (e) { alert('Error saving: ' + e.message) }
    finally { setSaving(false) }
  }

  const F = ({ label, field, type = 'text', opts }) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {opts
        ? <select value={form[field]} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {opts.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
          </select>
        : type === 'textarea'
          ? <textarea value={form[field]} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          : <input type={type} value={form[field]} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      }
    </div>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">Edit Site</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>
        <div className="space-y-3">
          <F label="Site Name"     field="siteName" />
          <F label="Customer"      field="customerName" />
          <F label="Address / Location" field="address" />
          {form.address && (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(form.address)}`} target="_blank" rel="noopener noreferrer"
              className="text-blue-600 text-xs hover:underline flex items-center gap-1">📍 Open in Google Maps</a>
          )}
          <F label="Project #"     field="projectNumber" />
          <F label="Status"        field="status" opts={SITE_STATUS_OPTIONS} />
          <F label="Notes"         field="notes" type="textarea" />
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={save} disabled={saving}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Pipeline Funnel ───────────────────────────────────────────────────────────
function PipelineFunnel({ deals, navigate, cfg }) {
  const stages = OPEN_STAGES.map(id => {
    const s     = ALL_STAGES.find(x => x.id === id)
    const items = deals.filter(d => (d.stage || 'lead') === id)
    return { id, label: s.label, bar: s.bar, count: items.length, val: items.reduce((a, d) => a + valINR(d), 0) }
  })
  const leadCount = stages[0].count || 1

  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 shadow-sm flex flex-col">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-800">Pipeline Funnel</h3>
          <p className="text-xs text-slate-400">Open opportunities — conversion by stage</p>
        </div>
        <button onClick={() => navigate('/crm/pipeline')} className={`text-sm font-medium ${cfg.accent}`}>Open →</button>
      </div>
      <div className="p-5 space-y-3 flex-1">
        {stages.map((s, i) => {
          const fillPct   = Math.round((s.count / leadCount) * 100)
          const convPct   = i > 0 && stages[i - 1].count > 0
            ? Math.round((s.count / stages[i - 1].count) * 100)
            : null
          return (
            <div key={s.id}>
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700 w-16">{s.label}</span>
                  {convPct !== null && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-lg font-medium ${convPct >= 50 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {convPct}% conv.
                    </span>
                  )}
                </div>
                <span className="text-slate-500">
                  <span className="font-bold text-slate-700">{s.count}</span> opportunities · {fmtINR(s.val)}
                </span>
              </div>
              {/* Funnel bar: max-width narrows each stage */}
              <div style={{ maxWidth: `${100 - i * 12}%` }}>
                <div className="bg-slate-100 rounded-xl h-8 overflow-hidden">
                  <div
                    className={`h-8 rounded-xl ${s.bar} transition-all duration-500`}
                    style={{ width: `${s.count > 0 ? Math.max(4, fillPct) : 0}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}

        {/* Closed summary row */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-4 text-xs text-slate-500">
          {/* On Hold shown first as it's still active */}
          {deals.filter(d => d.stage === 'hold').length > 0 && (
            <span className="text-cyan-700">⏸ On Hold: <span className="font-semibold">{deals.filter(d => d.stage === 'hold').length}</span></span>
          )}
          {['won', 'lost', 'rejected', 'nobid'].map(id => {
            const count = deals.filter(d => d.stage === id).length
            const lbl   = ALL_STAGES.find(s => s.id === id)?.label
            return count > 0
              ? <span key={id}>{lbl}: <span className="font-semibold text-slate-700">{count}</span></span>
              : null
          })}
        </div>
      </div>
    </div>
  )
}

// ── Monthly Booking Trend ─────────────────────────────────────────────────────
const TREND_PERIODS = [
  { id: '6',  label: '6M' },
  { id: '12', label: '1Y' },
  { id: '24', label: '2Y' },
  { id: 'all',label: 'All' },
]

function MonthlyTrend({ deals }) {
  const [period, setPeriod] = useState('12')

  const { months, wonDealsAll } = useMemo(() => {
    const wonDealsAll = deals.filter(d => d.stage === 'won' && d.closingDate)
    let arr
    if (period === 'all') {
      // Build from earliest closingDate to today
      if (wonDealsAll.length === 0) return { months: [], wonDealsAll: [] }
      const earliest = wonDealsAll.map(d => d.closingDate).sort()[0].slice(0, 7)
      const [ey, em] = earliest.split('-').map(Number)
      const now = new Date()
      const totalMonths = (now.getFullYear() - ey) * 12 + (now.getMonth() + 1 - em) + 1
      arr = buildMonths(Math.max(totalMonths, 1))
    } else {
      arr = buildMonths(Number(period))
    }
    wonDealsAll.forEach(d => {
      const m = arr.find(m => m.key === d.closingDate.slice(0, 7))
      if (m) { m.value += valINR(d); m.count++ }
    })
    return { months: arr, wonDealsAll }
  }, [deals, period])

  const maxVal     = Math.max(...months.map(m => m.value), 1)
  const totalWon   = months.reduce((s, m) => s + m.value, 0)
  const totalCount = months.reduce((s, m) => s + m.count, 0)
  const avgVal     = totalCount > 0 ? totalWon / totalCount : 0
  const BAR_MAX_H  = 100

  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 shadow-sm flex flex-col">
      <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800">Monthly Booking Trend</h3>
          <p className="text-xs text-slate-400">Won opportunities by closing month</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="text-right">
            <p className="text-sm font-bold text-green-600">{fmtINR(totalWon)}</p>
            <p className="text-xs text-slate-400">{totalCount} opportunities · avg {fmtINR(avgVal)}</p>
          </div>
          {/* Period toggle */}
          <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-xl">
            {TREND_PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)}
                className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition ${
                  period === p.id ? 'bg-white text-blue-700 shadow' : 'text-slate-500'
                }`}>{p.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-5 flex-1 flex flex-col justify-end overflow-x-auto">
        {months.length === 0 || totalCount === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8">No won opportunities in this period.</p>
        ) : (
          <div className="flex items-end gap-1 min-w-0" style={{ height: `${BAR_MAX_H + 32}px` }}>
            {months.map(m => {
              const h = m.value > 0 ? Math.max(6, Math.round((m.value / maxVal) * BAR_MAX_H)) : 3
              return (
                <div key={m.key} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full min-w-[20px]"
                  title={`${m.key}: ${m.count} deal${m.count !== 1 ? 's' : ''} · ${fmtINR(m.value)}`}>
                  <span style={{ fontSize: '9px', lineHeight: 1 }}
                    className={m.count > 0 ? 'text-green-700 font-bold' : 'text-transparent'}>
                    {m.count || '·'}
                  </span>
                  <div className={`w-full rounded-t transition-all duration-500 ${
                    m.isCurrent ? 'bg-green-400' : m.value > 0 ? 'bg-green-500' : 'bg-slate-200'
                  }`} style={{ height: `${h}px` }} />
                  <span style={{ fontSize: '9px', lineHeight: 1 }}
                    className={m.isCurrent ? 'font-bold text-slate-700' : 'text-slate-400'}>
                    {m.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sales Manager Leaderboard ─────────────────────────────────────────────────
function SalesLeaderboard({ deals, cfg, company }) {
  const mgrs = useMemo(() => {
    const map = {}
    deals.forEach(d => {
      const name = d.salesManagerName || d.assignedToName || null
      if (!name) return
      if (!map[name]) map[name] = { name, total: 0, won: 0, lost: 0, open: 0, wonVal: 0, openVal: 0 }
      const m = map[name]
      m.total++
      if (d.stage === 'won')                                    { m.won++;  m.wonVal  += valINR(d) }
      else if (CLOSED_STAGES.includes(d.stage))                 { m.lost++ }
      else                                                      { m.open++; m.openVal += valINR(d) }
    })
    return Object.values(map)
      .map(m => ({ ...m, winRate: m.total > 0 ? Math.round((m.won / m.total) * 100) : 0 }))
      .sort((a, b) => b.wonVal - a.wonVal)
  }, [deals])

  if (mgrs.length === 0) return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 shadow-sm p-8 text-center text-slate-400 text-sm">
      No sales managers assigned to {company} opportunities yet.
    </div>
  )

  const maxWonVal = Math.max(...mgrs.map(m => m.wonVal), 1)
  const medals    = ['🥇', '🥈', '🥉']

  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 shadow-sm">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="font-bold text-slate-800">Sales Leaderboard — {company}</h3>
        <p className="text-xs text-slate-400 mt-0.5">Ranked by won value · all time</p>
      </div>
      <div className="divide-y divide-slate-50">
        {mgrs.map((m, i) => {
          const barW      = Math.round((m.wonVal / maxWonVal) * 100)
          const rateColor = m.winRate >= 60 ? 'text-green-600' : m.winRate >= 30 ? 'text-amber-600' : 'text-red-500'
          const initials  = m.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
          return (
            <div key={m.name} className="px-5 py-4">
              <div className="flex items-center gap-3">
                {/* Rank / Medal */}
                <div className="w-7 text-center flex-shrink-0">
                  {i < 3
                    ? <span className="text-lg">{medals[i]}</span>
                    : <span className="text-sm font-bold text-slate-400">#{i + 1}</span>}
                </div>
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {initials}
                </div>
                {/* Name + stats */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800">{m.name}</p>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-slate-800">{fmtINR(m.wonVal)}</p>
                      <p className={`text-xs font-bold ${rateColor}`}>{m.winRate}% win rate</p>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div className="h-2 rounded-full bg-green-500 transition-all duration-500" style={{ width: `${barW}%` }} />
                    </div>
                  </div>
                  {/* Deal breakdown */}
                  <div className="flex gap-3 mt-1 text-xs text-slate-400">
                    <span>{m.total} total</span>
                    <span className="text-green-600 font-medium">{m.won} won</span>
                    {m.lost > 0 && <span className="text-red-500">{m.lost} lost</span>}
                    {m.open > 0 && <span className="text-amber-600">{m.open} open · {fmtINR(m.openVal)}</span>}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Recent Won ────────────────────────────────────────────────────────────────
function RecentWon({ deals, cfg }) {
  const recentWon = deals
    .filter(d => d.stage === 'won')
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''))
    .slice(0, 6)

  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 shadow-sm flex flex-col">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="font-bold text-slate-800">Recent Wins 🏆</h3>
        <p className="text-xs text-slate-400">Latest closed opportunities</p>
      </div>
      <div className="flex-1 divide-y divide-slate-100">
        {recentWon.map(d => (
          <div key={d.id} className="px-5 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{d.title}</p>
              <p className="text-xs text-slate-500">{d.customerName || '—'}{d.siteName ? ` · ${d.siteName}` : ''}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {d.projectNumber && (
                  <span className="text-xs font-mono font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-lg">
                    📋 {d.projectNumber}
                  </span>
                )}
                {d.salesManagerName && (
                  <span className="text-xs text-slate-400">👤 {d.salesManagerName.split(' ')[0]}</span>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold text-green-700">{fmtINR(valINR(d))}</p>
              {d.closingDate && <p className="text-xs text-slate-400">{d.closingDate}</p>}
            </div>
          </div>
        ))}
        {recentWon.length === 0 && (
          <p className="text-sm text-slate-400 py-8 text-center">No won opportunities yet.</p>
        )}
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
const CRM_ROLES = ['admin','sales_manager','sales_director','sales_engineer','bid_coordinator','solution_manager']

export default function CRMDashboard() {
  const navigate            = useNavigate()
  const { user, userProfile } = useAuth()
  const isAdmin             = userProfile?.role === 'admin'
  const isWideAdmin         = ['admin','sales_manager','sales_director','solution_manager'].includes(userProfile?.role)
  const role                = userProfile?.role || ''
  const isSalesAssistant    = role === 'sales_assistant'
  const isWideViewer        = role === 'solution_manager' || role === 'sales_director'
  const uid                 = user?.uid || ''
  const availableCompanies = isSalesAssistant ? ['Wayzim'] : ['UIPL', 'Wayzim']

  const { users: allCachedUsers } = useUsers()   // session cache — zero Firestore reads
  const [activeTab,   setActiveTab]   = useState(availableCompanies[0])
  const [loading,     setLoading]     = useState(true)
  const [customers,   setCustomers]   = useState([])
  const [deals,       setDeals]       = useState([])
  const [sites,       setSites]       = useState([])
  const [drillDown,   setDrillDown]   = useState(null)  // { title, subtitle, items, columns }
  const [editSite,    setEditSite]    = useState(null)  // site being edited inline

  // Filters
  const [preset,      setPreset]      = useState('all')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [filterUser,  setFilterUser]  = useState('all')

  useEffect(() => { load() }, [])

  // Derived from cache: only CRM-accessible users in the filter dropdown
  const users = useMemo(() => allCachedUsers.filter(x =>
    CRM_ROLES.includes(x.role) ||
    (x.moduleRights?.CRM === 'edit' || x.moduleRights?.CRM === 'view') ||
    (x.departments || []).includes('CRM')
  ), [allCachedUsers])

  const load = async () => {
    try {
      // users come from session cache — no read here
      const [cSnap, dSnap, sSnap] = await Promise.all([
        getDocs(collection(db, 'crm_customers')),
        getDocs(collection(db, 'crm_deals')),
        getDocs(collection(db, 'crm_sites')),
      ])
      const c = []; cSnap.forEach(d => c.push({ id: d.id, ...d.data() }))
      const d = []; dSnap.forEach(x => d.push({ id: x.id, ...x.data() }))
      const s = []; sSnap.forEach(x => s.push({ id: x.id, ...x.data() }))
      setCustomers(c); setDeals(d); setSites(s)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const handlePreset = (id) => {
    setPreset(id)
    if (id !== 'custom') {
      const r = presetRange(id)
      setDateFrom(r.from); setDateTo(r.to)
    }
  }

  // ── ALL useMemo hooks MUST be called before any conditional return ──────────
  const co = activeTab
  const coDeals = useMemo(() => {
    let base = deals.filter(d => !d.company || d.company === co)
    if (!isAdmin) {
      base = base.filter(d => {
        const ids = d.assignedUserIds || (d.assignedToId ? [d.assignedToId] : [])
        if (ids.includes(uid)) return true
        if (isWideViewer) return true
        return false
      })
    }
    // Date filter — applied to closingDate (estimated close / won date)
    if (dateFrom) base = base.filter(d => (d.closingDate || '') >= dateFrom)
    if (dateTo)   base = base.filter(d => (d.closingDate || '') <= dateTo)
    // User filter (admin / wide viewers only) — match on salesManagerId (deal owner)
    if (filterUser !== 'all' && isWideAdmin) {
      if (filterUser === 'unassigned') {
        base = base.filter(d => !d.salesManagerId && !d.assignedToId)
      } else {
        base = base.filter(d =>
          (d.salesManagerId || d.assignedToId || '') === filterUser
        )
      }
    }
    return base
  }, [deals, co, isAdmin, uid, isWideViewer, isWideAdmin, dateFrom, dateTo, filterUser])

  // ── Data Health: surface deals with no owner, and likely duplicate deals ──
  // (created by e.g. Clone, or legacy records from before salesManagerId
  // existed). Admin-only, computed across ALL deals regardless of the
  // active company tab or filters, so nothing gets hidden from view here.
  const [healthOpen, setHealthOpen] = useState(false)
  const [fixingId,   setFixingId]   = useState(null)

  const unassignedDeals = useMemo(() =>
    deals.filter(d => !d.salesManagerId && !d.assignedToId),
    [deals]
  )

  const duplicateGroups = useMemo(() => {
    const groups = {}
    deals.forEach(d => {
      const key = `${(d.title || '').trim().toLowerCase()}|${d.customerId || d.customerName || ''}`
      if (!key.trim() || key === '|') return
      ;(groups[key] = groups[key] || []).push(d)
    })
    return Object.values(groups)
      .filter(g => g.length > 1)
      .map(g => g.slice().sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')))
  }, [deals])

  const assignToMe = async (dealId) => {
    setFixingId(dealId)
    try {
      await updateDoc(doc(db, 'crm_deals', dealId), {
        salesManagerId: uid,
        salesManagerName: userProfile?.name || userProfile?.email || '',
      })
      setDeals(prev => prev.map(d => d.id === dealId
        ? { ...d, salesManagerId: uid, salesManagerName: userProfile?.name || userProfile?.email || '' }
        : d
      ))
    } catch (e) { console.error(e) }
    finally { setFixingId(null) }
  }

  const deleteDuplicate = async (dealId) => {
    if (!window.confirm('Delete this duplicate deal? This cannot be undone.')) return
    setFixingId(dealId)
    try {
      await deleteDoc(doc(db, 'crm_deals', dealId))
      setDeals(prev => prev.filter(d => d.id !== dealId))
    } catch (e) { console.error(e) }
    finally { setFixingId(null) }
  }

  const deleteUnassignedDeal = async (dealId) => {
    if (!window.confirm('Delete this deal? This cannot be undone.')) return
    setFixingId(dealId)
    try {
      await deleteDoc(doc(db, 'crm_deals', dealId))
      setDeals(prev => prev.filter(d => d.id !== dealId))
      setSelectedUnassigned(prev => prev.filter(id => id !== dealId))
    } catch (e) { console.error(e) }
    finally { setFixingId(null) }
  }

  const [selectedUnassigned, setSelectedUnassigned] = useState([])
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const toggleUnassignedSelected = (dealId) => {
    setSelectedUnassigned(prev => prev.includes(dealId) ? prev.filter(id => id !== dealId) : [...prev, dealId])
  }

  const selectAllUnassigned = () => {
    setSelectedUnassigned(prev =>
      prev.length === unassignedDeals.length ? [] : unassignedDeals.map(d => d.id)
    )
  }

  const deleteSelectedUnassigned = async () => {
    if (selectedUnassigned.length === 0) return
    if (!window.confirm(`Delete ${selectedUnassigned.length} selected deal${selectedUnassigned.length > 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      await Promise.all(selectedUnassigned.map(id => deleteDoc(doc(db, 'crm_deals', id))))
      setDeals(prev => prev.filter(d => !selectedUnassigned.includes(d.id)))
      setSelectedUnassigned([])
    } catch (e) { console.error(e) }
    finally { setBulkDeleting(false) }
  }

  const coCustomers = useMemo(() => customers.filter(c => {
    const cos = c.companies || (c.company ? [c.company] : [])
    return cos.length === 0 || cos.includes(co)
  }), [customers, co])
  const coSites     = useMemo(() => sites.filter(s => !s.company || s.company === co), [sites, co])
  // ──────────────────────────────────────────────────────────────────────────

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading…</div>

  const cfg = COMPANY_CONFIG[activeTab]

  // Summary metrics
  const openDeals  = coDeals.filter(d => !CLOSED_STAGES.includes(d.stage))
  const openValue  = openDeals.reduce((s, d) => s + valINR(d), 0)
  const wonDeals   = coDeals.filter(d => d.stage === 'won')
  const wonValue   = wonDeals.reduce((s, d) => s + valINR(d), 0)
  const winRate    = coDeals.length > 0 ? Math.round((wonDeals.length / coDeals.length) * 100) : 0

  // Site lists
  const leadSiteList    = coSites.filter(s => (s.status || 'lead') === 'lead')
  const projectSiteList = coSites.filter(s => s.status === 'project')
  const serviceSiteList = coSites.filter(s => s.status === 'service')

  // Active customers list
  const activeCustList = coCustomers.filter(c => c.active !== false)

  // ── Drill-down helpers ────────────────────────────────────────────────────
  const DEAL_COLS = [
    { key: 'title',           label: 'Opportunity' },
    { key: 'customerName',    label: 'Customer' },
    { key: 'salesManagerName',label: 'Sales Manager', render: r => r.salesManagerName || r.assignedToName || '—' },
    { key: 'stage',           label: 'Stage',   render: r => <span className="capitalize text-xs font-medium">{r.stage || '—'}</span> },
    { key: '__value',         label: 'Value',   right: true, isValue: true, render: r => <span className="font-semibold text-slate-700">{fmtINR(valINR(r))}</span> },
    { key: 'closingDate',     label: 'Closing Date', render: r => r.closingDate || '—' },
  ]
  const CUST_COLS = [
    { key: 'name',        label: 'Customer Name' },
    { key: 'city',        label: 'City' },
    { key: 'contactName', label: 'Contact', render: r => r.contactName || r.contact || '—' },
    { key: 'phone',       label: 'Phone' },
    { key: 'email',       label: 'Email' },
  ]
  const SITE_COLS = [
    { key: 'siteName',     label: 'Site Name',          render: r => r.siteName || r.name || '—' },
    { key: 'customerName', label: 'Customer',            render: r => r.customerName || '—' },
    { key: 'address',      label: 'Address / Location',  render: r => {
      const addr = r.address || ''
      return addr
        ? <a href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noopener noreferrer"
            className="text-blue-600 hover:underline flex items-center gap-1" onClick={e => e.stopPropagation()}>
            📍 {addr}
          </a>
        : <span className="text-slate-300">—</span>
    }},
    { key: 'status',       label: 'Status',              render: r => <span className="capitalize text-xs font-medium">{r.status || 'lead'}</span> },
    { key: '__edit',       label: '',                    render: r => (
      <button onClick={e => { e.stopPropagation(); setEditSite({ ...r }) }}
        className="text-blue-600 hover:text-blue-800 text-xs font-medium">✏️ Edit</button>
    )},
  ]

  const openDrill  = () => setDrillDown({ title: '📈 Open Opportunities',       subtitle: co, items: openDeals.map(d => ({...d, __value: valINR(d)})),  columns: DEAL_COLS })
  const wonDrill   = () => setDrillDown({ title: '🏆 Won Opportunities',        subtitle: co, items: wonDeals.map(d => ({...d, __value: valINR(d)})),   columns: DEAL_COLS })
  const custDrill  = () => setDrillDown({ title: '🏬 Active Customers', subtitle: co, items: activeCustList, columns: CUST_COLS })
  const leadDrill  = () => setDrillDown({ title: '🔍 Lead Sites',       subtitle: co, items: leadSiteList,   columns: SITE_COLS })
  const projDrill  = () => setDrillDown({ title: '🚧 Project Sites',    subtitle: co, items: projectSiteList, columns: SITE_COLS })
  const servDrill  = () => setDrillDown({ title: '✅ Service Sites',    subtitle: co, items: serviceSiteList, columns: SITE_COLS })

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">CRM Dashboard</h2>
          <p className="text-slate-500 text-sm">Pipeline overview · bookings · team performance</p>
        </div>
        <div className="flex gap-2">
          {!isSalesAssistant && (
            <button onClick={() => navigate('/crm/customers')}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
              Customers
            </button>
          )}
          <button onClick={() => navigate('/crm/pipeline')}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
            Pipeline
          </button>
        </div>
      </div>

      {/* ── Data Health Check (admin only) ── */}
      {isAdmin && (unassignedDeals.length > 0 || duplicateGroups.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <button
            onClick={() => setHealthOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-bold text-amber-800">
              🩺 Data Health — {unassignedDeals.length} unassigned, {duplicateGroups.length} possible duplicate{duplicateGroups.length === 1 ? '' : 's'}
            </span>
            <span className="text-amber-600 text-xs">{healthOpen ? '▲ Hide' : '▼ Show'}</span>
          </button>

          {healthOpen && (
            <div className="px-4 pb-4 space-y-4">
              {unassignedDeals.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                      Deals with no Sales Manager set
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={selectAllUnassigned}
                        className="text-xs text-amber-700 hover:text-amber-900 font-medium underline"
                      >
                        {selectedUnassigned.length === unassignedDeals.length ? 'Deselect all' : 'Select all'}
                      </button>
                      {selectedUnassigned.length > 0 && (
                        <button
                          onClick={deleteSelectedUnassigned}
                          disabled={bulkDeleting}
                          className="text-xs px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-medium disabled:opacity-50"
                        >
                          {bulkDeleting ? 'Deleting…' : `Delete ${selectedUnassigned.length} selected`}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-amber-200/70 divide-y divide-amber-100">
                    {unassignedDeals.map(d => (
                      <div key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedUnassigned.includes(d.id)}
                            onChange={() => toggleUnassignedSelected(d.id)}
                            className="flex-shrink-0"
                          />
                          <div className="min-w-0">
                            <span className="font-medium text-slate-800 truncate">{d.title || '(untitled)'}</span>
                            <span className="ml-2 text-xs text-slate-400">{d.company || '—'} · {d.stage || 'lead'}</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 flex gap-2">
                          <button
                            onClick={() => assignToMe(d.id)}
                            disabled={fixingId === d.id}
                            className="text-xs px-2.5 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg font-medium disabled:opacity-50"
                          >
                            {fixingId === d.id ? 'Saving…' : 'Assign to me'}
                          </button>
                          <button
                            onClick={() => navigate('/crm/pipeline')}
                            className="text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg font-medium"
                          >
                            Open Pipeline
                          </button>
                          <button
                            onClick={() => deleteUnassignedDeal(d.id)}
                            disabled={fixingId === d.id}
                            className="text-xs px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-medium disabled:opacity-50"
                          >
                            {fixingId === d.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {duplicateGroups.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1.5">
                    Possible duplicate deals (same title &amp; customer) — newest kept on top, review before deleting
                  </p>
                  <div className="space-y-2">
                    {duplicateGroups.map((group, gi) => (
                      <div key={gi} className="bg-white rounded-xl border border-amber-200/70 divide-y divide-amber-100">
                        {group.map((d, i) => (
                          <div key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <span className="font-medium text-slate-800 truncate">{d.title || '(untitled)'}</span>
                              <span className="ml-2 text-xs text-slate-400">
                                {d.company || '—'} · {d.stage || 'lead'} · {i === 0 ? 'newest' : `updated ${d.updatedAt || d.createdAt || 'unknown'}`}
                              </span>
                            </div>
                            {i > 0 && (
                              <button
                                onClick={() => deleteDuplicate(d.id)}
                                disabled={fixingId === d.id}
                                className="flex-shrink-0 text-xs px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-medium disabled:opacity-50"
                              >
                                {fixingId === d.id ? 'Deleting…' : 'Delete duplicate'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Company tabs */}
      {availableCompanies.length > 1 && (
        <div className="flex gap-2">
          {availableCompanies.map(c => (
            <button key={c} onClick={() => setActiveTab(c)}
              className={`px-6 py-2 rounded-xl text-sm font-bold transition border-2 ${
                activeTab === c
                  ? COMPANY_CONFIG[c].tabCls + ' border-transparent'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
              }`}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* ── Filter Bar ── */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 px-4 py-3 flex flex-wrap gap-3 items-end">
        {/* Date presets */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Period</p>
          <div className="flex gap-1 flex-wrap">
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => handlePreset(p.id)}
                className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition border ${
                  preset === p.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date inputs */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-500">From</p>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-500">To</p>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
        )}

        {/* Team member filter (admin / wide viewers) */}
        {isWideAdmin && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Team Member</p>
            <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-40">
              <option value="all">All Members</option>
              <option value="unassigned">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          </div>
        )}

        {/* Clear filters */}
        {(preset !== 'all' || filterUser !== 'all') && (
          <button onClick={() => { setPreset('all'); setDateFrom(''); setDateTo(''); setFilterUser('all') }}
            className="self-end px-3 py-1.5 text-xs text-slate-500 hover:text-red-600 border border-slate-300 rounded-xl transition">
            ✕ Clear Filters
          </button>
        )}

        {/* Showing count */}
        <div className="self-end ml-auto text-right">
          <p className="text-xs text-slate-400">Showing</p>
          <p className="text-sm font-bold text-slate-700">{coDeals.length} deals</p>
        </div>
      </div>

      {/* Company hero banner */}
      <div className={`bg-gradient-to-r ${cfg.hdrCls} rounded-xl p-5 text-white`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xl font-bold">{cfg.label}</p>
            <p className="text-white/70 text-sm">{cfg.subtitle}</p>
          </div>
          <div className="flex gap-8 text-center">
            <div>
              <p className="text-2xl font-bold">{openDeals.length}</p>
              <p className="text-white/70 text-xs">Open Opportunities</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{fmtINR(openValue)}</p>
              <p className="text-white/70 text-xs">Pipeline Value</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{wonDeals.length}</p>
              <p className="text-white/70 text-xs">Opportunities Won</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{winRate}%</p>
              <p className="text-white/70 text-xs">Win Rate</p>
            </div>
          </div>
        </div>
        <p className="text-white/60 text-xs mt-3 italic">ℹ️ {cfg.note}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon="🏬" label="Active Customers"   value={activeCustList.length} onClick={custDrill} />
        <StatCard icon="📈" label="Open Opportunities" value={openDeals.length} sub={fmtINR(openValue)} onClick={openDrill} />
        <StatCard icon="🏆" label="Won Opportunities"  value={wonDeals.length}  sub={fmtINR(wonValue)}  onClick={wonDrill} />
        <StatCard icon="🔍" label="Lead Sites"    value={leadSiteList.length}    onClick={leadDrill} />
        <StatCard icon="🚧" label="Project Sites" value={projectSiteList.length} onClick={projDrill} />
        <StatCard icon="✅" label="Service Sites" value={serviceSiteList.length} onClick={servDrill} />
      </div>

      {/* Funnel + Monthly trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PipelineFunnel deals={coDeals} navigate={navigate} cfg={cfg} />
        <MonthlyTrend deals={coDeals} />
      </div>

      {/* Leaderboard + Recent won */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SalesLeaderboard deals={coDeals} cfg={cfg} company={activeTab} />
        <RecentWon deals={coDeals} cfg={cfg} />
      </div>

      {/* Drill-down modal */}
      {drillDown && (
        <DrillDownModal title={drillDown.title} subtitle={drillDown.subtitle}
          items={drillDown.items} columns={drillDown.columns} onClose={() => setDrillDown(null)} />
      )}

      {/* Site edit modal */}
      {editSite && (
        <SiteEditModal site={editSite} onClose={() => setEditSite(null)}
          onSaved={saved => {
            setDrillDown(dd => dd && { ...dd, items: dd.items.map(it => it.id === saved.id ? saved : it) })
            setEditSite(null)
          }} />
      )}
    </div>
  )
}