/**
 * Targets.jsx — Annual sales targets per salesperson per company.
 *
 * Data model (crm_targets collection):
 *   { salesManagerName, salesManagerId, company, year, annualTargetINR, ...timestamps }
 *
 * Rules:
 *  • Admin / Sales Manager → can see & edit all targets for both companies
 *  • Salesperson → sees only their own target for their assigned company(ies)
 *  • Non-admin cannot see other people's targets
 */
import React, { useState, useEffect, useMemo } from 'react'
import {
  collection, getDocs, addDoc, updateDoc, doc,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useUsers } from '../../../lib/useUsers'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtINR = (n) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr`
  : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L`
  : `₹${Math.round(n).toLocaleString('en-IN')}`

const valINR = (d) => d.valueINR ?? Number(d.value) ?? 0

// India FY: Apr-YYYY → Mar-(YYYY+1)
const currentFY = () => {
  const now = new Date()
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
}
const fyLabel = (y) => `AY ${y}–${String(y + 1).slice(2)}`

// India FY quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar
const fyQuarters = (startYear) => [
  { key: `${startYear}-Q1`, label: 'Q1 (Apr–Jun)', months: [`${startYear}-04`,`${startYear}-05`,`${startYear}-06`], end: `${startYear}-06` },
  { key: `${startYear}-Q2`, label: 'Q2 (Jul–Sep)', months: [`${startYear}-07`,`${startYear}-08`,`${startYear}-09`], end: `${startYear}-09` },
  { key: `${startYear}-Q3`, label: 'Q3 (Oct–Dec)', months: [`${startYear}-10`,`${startYear}-11`,`${startYear}-12`], end: `${startYear}-12` },
  { key: `${startYear+1}-Q4`, label: 'Q4 (Jan–Mar)', months: [`${startYear+1}-01`,`${startYear+1}-02`,`${startYear+1}-03`], end: `${startYear+1}-03` },
]

// All 12 FY month keys (YYYY-MM) from the quarter definitions
const fyAllMonths = (startYear) => fyQuarters(startYear).flatMap(q => q.months)

const todayYM = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

const COMPANY_CFG = {
  UIPL:   { label: 'UIPL',                   cls: 'bg-blue-600 text-white',    bar: 'bg-blue-500',    ring: 'ring-blue-500',   light: 'bg-blue-50'   },
  Wayzim: { label: 'Wayzim Technology Co Ltd', cls: 'bg-purple-600 text-white', bar: 'bg-purple-500',  ring: 'ring-purple-500', light: 'bg-purple-50' },
}

// ── Inline target editor ──────────────────────────────────────────────────────
function TargetInput({ value, onSave, saving }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value || '')
  const commit = () => { const n = Number(val); if (!isNaN(n) && n >= 0) onSave(n); setEditing(false) }
  if (!editing) return (
    <button onClick={() => { setVal(value || ''); setEditing(true) }}
      className="text-sm font-bold text-slate-700 hover:text-blue-600 hover:underline text-left">
      {value > 0 ? fmtINR(value) : <span className="text-slate-300 text-xs font-normal">Set target</span>}
    </button>
  )
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-slate-400">₹</span>
      <input type="number" value={val} autoFocus min="0" step="100000"
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className="w-32 px-2 py-1 border border-blue-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        placeholder="e.g. 10000000"
      />
      <button onClick={commit} disabled={saving}
        className="text-xs px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700">✓</button>
      <button onClick={() => setEditing(false)} className="text-xs text-slate-400 px-1">✕</button>
    </div>
  )
}

// ── Achievement bar ───────────────────────────────────────────────────────────
function AchBar({ pct }) {
  const capped    = Math.min(pct, 100)
  const barColor  = pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-400' : 'bg-red-400'
  const textColor = pct >= 100 ? 'text-green-600' : pct >= 70 ? 'text-amber-600' : 'text-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
        <div className={`h-2.5 rounded-full transition-all ${barColor}`} style={{ width: `${capped}%` }} />
      </div>
      <span className={`text-xs font-bold w-10 text-right ${textColor}`}>{Math.round(pct)}%</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Targets() {
  const { user, userProfile } = useAuth()
  const isAdmin   = ['admin', 'operations'].includes(userProfile?.role)
  const isManager = ['admin', 'operations', 'sales_manager', 'sales_director'].includes(userProfile?.role)
  const myName    = userProfile?.name || ''
  const userCos   = userProfile?.companies || ['UIPL']

  // Companies this user can see
  const availableCos = isManager
    ? ['UIPL', 'Wayzim']
    : userCos.filter(c => ['UIPL', 'Wayzim'].includes(c))

  const [co, setCo]         = useState(availableCos[0] || 'UIPL')
  const [fy, setFy]         = useState(currentFY())
  const [view, setView]     = useState('annual')   // 'annual' | 'trend'

  const { users: cachedUsers } = useUsers()   // session cache — zero Firestore reads

  const [deals, setDeals]     = useState([])
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const FY_QUARTERS = useMemo(() => fyQuarters(fy), [fy])
  const THIS_MONTH  = todayYM()

  // Available FY years (current ±2)
  const fyOptions = [currentFY() - 1, currentFY(), currentFY() + 1]

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      // users come from session cache — no read here
      const [dSnap, tSnap] = await Promise.all([
        getDocs(collection(db, 'crm_deals')),
        getDocs(collection(db, 'crm_targets')),
      ])
      const d = []; dSnap.forEach(x => d.push({ id: x.id, ...x.data() }))
      const t = []; tSnap.forEach(x => t.push({ id: x.id, ...x.data() }))
      setDeals(d)
      setTargets(t)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Derived filter — sales-role users + anyone who has manager name in deals (legacy compat)
  const allUsers = useMemo(() => {
    const salesNames = new Set(deals.map(x => x.salesManagerName).filter(Boolean))
    return cachedUsers.filter(x =>
      ['admin', 'sales_manager', 'salesperson', 'sales_exec'].includes(x.role) || salesNames.has(x.name)
    )
  }, [cachedUsers, deals])

  // Save annual target
  const saveTarget = async (salesManagerName, salesManagerId, annualTargetINR) => {
    setSaving(true)
    try {
      // Find existing annual target doc (matches name + company + year)
      const existing = targets.find(t =>
        t.salesManagerName === salesManagerName && t.company === co &&
        (t.year === fy || t.year === String(fy))
      )
      const payload = {
        salesManagerName,
        salesManagerId: salesManagerId || '',
        company: co,
        year: fy,
        annualTargetINR,
        updatedAt: new Date().toISOString(),
      }
      if (existing) {
        await updateDoc(doc(db, 'crm_targets', existing.id), payload)
        setTargets(prev => prev.map(t => t.id === existing.id ? { ...t, ...payload } : t))
      } else {
        const ref = await addDoc(collection(db, 'crm_targets'), {
          ...payload, createdAt: new Date().toISOString(), createdBy: user.uid,
        })
        setTargets(prev => [...prev, { id: ref.id, ...payload }])
      }
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  // ── People for this company/FY ──────────────────────────────────────────────
  const peopleRows = useMemo(() => {
    const nameMap = {}

    // From deals in this company
    deals.filter(d => !d.company || d.company === co).forEach(d => {
      const name = d.salesManagerName || d.assignedToName
      if (!name) return
      if (!nameMap[name]) nameMap[name] = { name, userId: d.salesManagerId || d.assignedToId || '' }
    })
    // From targets for this company+year
    targets.filter(t => t.company === co && (t.year === fy || t.year === String(fy))).forEach(t => {
      if (!nameMap[t.salesManagerName]) nameMap[t.salesManagerName] = { name: t.salesManagerName, userId: t.salesManagerId || '' }
    })
    // From users assigned to this company
    allUsers.filter(u => (u.companies || ['UIPL']).includes(co)).forEach(u => {
      if (u.name && !nameMap[u.name]) nameMap[u.name] = { name: u.name, userId: u.id }
    })

    return Object.values(nameMap).map(person => {
      // For non-managers: only show self
      if (!isManager && person.name !== myName) return null

      const fyMonthKeys = fyAllMonths(fy)

      // Won deals in this company this FY
      const wonDeals = deals.filter(d =>
        (d.company === co || !d.company) &&
        d.stage === 'won' &&
        (d.salesManagerName === person.name || d.assignedToName === person.name) &&
        fyMonthKeys.includes((d.closingDate || '').slice(0, 7))
      )
      const ytdWon = wonDeals.reduce((s, d) => s + valINR(d), 0)

      // Open pipeline
      const pipeline = deals.filter(d =>
        (d.company === co || !d.company) &&
        !['won','lost','rejected','nobid'].includes(d.stage) &&
        (d.salesManagerName === person.name || d.assignedToName === person.name)
      ).reduce((s, d) => s + valINR(d), 0)

      // Annual target
      const tgt = targets.find(t =>
        t.salesManagerName === person.name && t.company === co &&
        (t.year === fy || t.year === String(fy))
      )
      const annualTarget = tgt?.annualTargetINR || 0
      const pct = annualTarget > 0 ? (ytdWon / annualTarget) * 100 : 0

      // Quarters elapsed (completed quarters whose end month ≤ today)
      const elapsedQtrs = FY_QUARTERS.filter(q => q.end <= THIS_MONTH).length
      const qtrPace     = annualTarget / 4
      const expectedYTD = qtrPace * elapsedQtrs
      const paceStatus  = annualTarget > 0 && elapsedQtrs > 0
        ? ytdWon >= expectedYTD ? 'ahead' : ytdWon >= expectedYTD * 0.8 ? 'on-track' : 'behind'
        : null

      return { ...person, annualTarget, ytdWon, pipeline, pct, wonCount: wonDeals.length, paceStatus }
    }).filter(Boolean).sort((a, b) => b.ytdWon - a.ytdWon)
  }, [deals, targets, allUsers, co, fy, FY_QUARTERS, THIS_MONTH, isManager, myName])

  // ── Quarterly trend data (for FY Trend view) ──────────────────────────────
  const trendRows = useMemo(() => {
    if (view !== 'trend') return []
    const teamAnnual = targets
      .filter(t => t.company === co && (t.year === fy || t.year === String(fy)))
      .reduce((s, t) => s + (t.annualTargetINR || 0), 0)
    const qtrTarget = teamAnnual / 4

    return FY_QUARTERS.map(({ key, label, months, end }) => {
      const wonDeals = deals.filter(d =>
        (d.company === co || !d.company) && d.stage === 'won' &&
        months.includes((d.closingDate || '').slice(0, 7))
      )
      const achieved   = wonDeals.reduce((s, d) => s + valINR(d), 0)
      const pct        = qtrTarget > 0 ? (achieved / qtrTarget) * 100 : 0
      // Determine if this quarter is current, completed, or future
      const [qStart]   = months
      const isFuture   = qStart > THIS_MONTH          // quarter hasn't started
      const isComplete = end < THIS_MONTH             // quarter fully done
      const isCurrent  = !isFuture && !isComplete     // we're inside this quarter
      return { key, label, achieved, pace: qtrTarget, pct, count: wonDeals.length, isCurrent, isFuture, isComplete }
    })
  }, [deals, targets, co, fy, view, FY_QUARTERS, THIS_MONTH])

  // ── Team totals ─────────────────────────────────────────────────────────────
  const teamTarget  = peopleRows.reduce((s, r) => s + r.annualTarget, 0)
  const teamWon     = peopleRows.reduce((s, r) => s + r.ytdWon, 0)
  const teamPct     = teamTarget > 0 ? (teamWon / teamTarget) * 100 : 0
  const cfg         = COMPANY_CFG[co] || COMPANY_CFG.UIPL

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading…</div>

  return (
    <div className="p-6 space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">🎯 Sales Targets</h2>
          <p className="text-slate-500 text-sm mt-0.5">Annual targets per salesperson · {fyLabel(fy)}</p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* FY selector */}
          <div className="flex rounded-xl border border-slate-300 overflow-hidden shadow-sm">
            {fyOptions.map(y => (
              <button key={y} onClick={() => setFy(y)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${fy === y ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {fyLabel(y)}
              </button>
            ))}
          </div>

          {/* Company tabs */}
          {availableCos.map(c => (
            <button key={c} onClick={() => setCo(c)}
              className={`px-4 py-1.5 rounded-xl text-sm font-bold border-2 transition ${
                co === c ? COMPANY_CFG[c].cls + ' border-transparent shadow-sm' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
              }`}>
              {c}
            </button>
          ))}

          {/* View toggle */}
          <div className="flex rounded-xl border border-slate-300 overflow-hidden shadow-sm">
            <button onClick={() => setView('annual')}
              className={`px-3 py-1.5 text-xs font-medium transition ${view === 'annual' ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              Annual
            </button>
            <button onClick={() => setView('trend')}
              className={`px-3 py-1.5 text-xs font-medium transition ${view === 'trend' ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              Quarterly Trend
            </button>
          </div>
        </div>
      </div>

      {/* ── ANNUAL VIEW ────────────────────────────────────────────────────── */}
      {view === 'annual' && (
        <>
          {/* Team summary banner */}
          {peopleRows.length > 0 && teamTarget > 0 && (
            <div className={`rounded-xl p-5 text-white bg-gradient-to-r ${co === 'UIPL' ? 'from-blue-600 to-blue-800' : 'from-purple-600 to-purple-800'}`}>
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <p className="text-lg font-bold">{cfg.label}</p>
                  <p className="text-white/70 text-sm">{fyLabel(fy)} · Annual team target</p>
                </div>
                <div className="flex gap-8 text-center flex-wrap">
                  <div>
                    <p className="text-2xl font-bold">{fmtINR(teamTarget)}</p>
                    <p className="text-white/60 text-xs mt-0.5">Annual Target</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{fmtINR(teamWon)}</p>
                    <p className="text-white/60 text-xs mt-0.5">YTD Won</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{fmtINR(teamTarget - teamWon > 0 ? teamTarget - teamWon : 0)}</p>
                    <p className="text-white/60 text-xs mt-0.5">Remaining</p>
                  </div>
                  <div>
                    <p className={`text-2xl font-bold ${teamPct >= 100 ? 'text-green-300' : teamPct >= 60 ? 'text-yellow-300' : 'text-red-300'}`}>
                      {Math.round(teamPct)}%
                    </p>
                    <p className="text-white/60 text-xs mt-0.5">Attainment</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 bg-white/20 rounded-full h-3 overflow-hidden">
                <div className="h-3 rounded-full bg-white transition-all duration-700"
                  style={{ width: `${Math.min(teamPct, 100)}%` }} />
              </div>
              <p className="text-white/50 text-xs mt-1.5">Quarterly pace: {fmtINR(teamTarget / 4)}/quarter</p>
            </div>
          )}

          {/* Per-person table */}
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-700 text-sm">
                {isManager ? 'All Salespeople' : 'Your Target'} · {cfg.label} · {fyLabel(fy)}
              </h3>
              {isAdmin && (
                <p className="text-xs text-slate-400">Click a target value to edit</p>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Salesperson</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Annual Target</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Quarterly Pace</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">YTD Won</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Open Pipeline</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-48">YTD Attainment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {peopleRows.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-slate-400">
                    <p className="text-3xl mb-2">🎯</p>
                    {isManager
                      ? `No salespeople found for ${co}. Assign users to this company in Admin → Users.`
                      : 'No target set for your account yet. Contact your manager.'
                    }
                  </td></tr>
                )}
                {peopleRows.map((r, i) => {
                  const isSelf   = r.name === myName
                  const canEdit  = isAdmin
                  const pace     = r.annualTarget > 0 ? r.annualTarget / 4 : 0
                  const PACE_STATUS = {
                    ahead:    'bg-green-100 text-green-700',
                    'on-track': 'bg-amber-100 text-amber-700',
                    behind:   'bg-red-100 text-red-700',
                  }
                  return (
                    <tr key={r.name} className={`hover:bg-slate-50 transition-colors ${isSelf && !isAdmin ? 'bg-blue-50/20' : ''}`}>
                      {/* Name */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${co === 'UIPL' ? 'bg-blue-600' : 'bg-purple-600'}`}>
                            {r.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-slate-800">{r.name}</p>
                              {isSelf && <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-lg font-medium">You</span>}
                              {i === 0 && r.ytdWon > 0 && isManager && <span className="text-base">🥇</span>}
                              {i === 1 && r.ytdWon > 0 && isManager && <span className="text-base">🥈</span>}
                              {i === 2 && r.ytdWon > 0 && isManager && <span className="text-base">🥉</span>}
                            </div>
                            {r.paceStatus && (
                              <span className={`text-xs px-1.5 py-0.5 rounded-lg font-medium ${PACE_STATUS[r.paceStatus]}`}>
                                {r.paceStatus === 'ahead' ? '↑ Ahead of pace' : r.paceStatus === 'on-track' ? '~ On pace' : '↓ Behind pace'}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Annual target */}
                      <td className="px-4 py-4 text-right">
                        {canEdit
                          ? <TargetInput value={r.annualTarget} saving={saving}
                              onSave={(v) => saveTarget(r.name, r.userId, v)} />
                          : <span className="font-bold text-slate-800">{r.annualTarget > 0 ? fmtINR(r.annualTarget) : '—'}</span>
                        }
                      </td>
                      {/* Quarterly pace */}
                      <td className="px-4 py-4 text-right text-slate-500 text-sm">
                        {pace > 0 ? fmtINR(pace) : <span className="text-slate-300">—</span>}
                      </td>
                      {/* YTD Won */}
                      <td className="px-4 py-4 text-right">
                        <p className="font-bold text-green-600">{r.ytdWon > 0 ? fmtINR(r.ytdWon) : '—'}</p>
                        {r.wonCount > 0 && <p className="text-xs text-slate-400">{r.wonCount} opportunit{r.wonCount !== 1 ? 'ies' : 'y'}</p>}
                      </td>
                      {/* Pipeline */}
                      <td className="px-4 py-4 text-right text-amber-600 font-medium text-sm">
                        {r.pipeline > 0 ? fmtINR(r.pipeline) : <span className="text-slate-300">—</span>}
                      </td>
                      {/* Attainment */}
                      <td className="px-5 py-4">
                        {r.annualTarget > 0
                          ? <AchBar pct={r.pct} />
                          : <span className="text-xs text-slate-300">No target set</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {/* Team totals footer */}
              {peopleRows.length > 1 && isManager && (
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-5 py-3 font-bold text-slate-700">Team Total</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800">{fmtINR(teamTarget)}</td>
                    <td className="px-4 py-3 text-right text-slate-600 font-medium">{fmtINR(teamTarget / 4)}</td>
                    <td className="px-4 py-3 text-right font-bold text-green-600">{fmtINR(teamWon)}</td>
                    <td className="px-4 py-3 text-right font-medium text-amber-600">
                      {fmtINR(peopleRows.reduce((s, r) => s + r.pipeline, 0))}
                    </td>
                    <td className="px-5 py-3">
                      {teamTarget > 0 ? <AchBar pct={teamPct} /> : null}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {/* ── QUARTERLY TREND VIEW ───────────────────────────────────────────── */}
      {view === 'trend' && (
        <div className="space-y-4">
          {/* Bar chart — 4 quarters */}
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-slate-800">{cfg.label} · {fyLabel(fy)} — Quarterly Bookings</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Dashed line = quarterly target ({fmtINR(teamTarget / 4)}/quarter based on {fmtINR(teamTarget)} annual)
                </p>
              </div>
            </div>
            {teamTarget === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm">Set annual targets first to see quarterly pace.</p>
            ) : (
              <>
                <div className="flex items-end gap-6 px-4" style={{ height: '160px' }}>
                  {trendRows.map(row => {
                    const maxVal = Math.max(...trendRows.map(r => Math.max(r.achieved, r.pace)), 1)
                    const achH   = row.achieved > 0 ? Math.max(6, Math.round((row.achieved / maxVal) * 130)) : 0
                    const paceH  = row.pace > 0 ? Math.max(2, Math.round((row.pace / maxVal) * 130)) : 0
                    const barCls = row.isFuture ? 'bg-slate-100' :
                      row.isCurrent ? (co === 'UIPL' ? 'bg-blue-400' : 'bg-purple-400') :
                      row.pct >= 100 ? 'bg-green-500' : row.pct >= 70 ? 'bg-amber-400' : 'bg-red-400'
                    return (
                      <div key={row.key} className="flex-1 flex flex-col items-center justify-end h-full"
                        title={`${row.label}: Won ${fmtINR(row.achieved)} | Target ${fmtINR(row.pace)}`}>
                        {row.count > 0 && <p className="text-xs text-green-700 font-bold mb-1">{row.count} deal{row.count !== 1 ? 's' : ''}</p>}
                        {row.achieved > 0 && !row.isFuture && <p className="text-xs font-bold text-slate-600 mb-1">{fmtINR(row.achieved)}</p>}
                        <div className="w-full relative flex justify-center">
                          <div className={`w-4/5 rounded-t transition-all ${barCls}`}
                            style={{ height: `${achH}px`, minHeight: row.isFuture ? 0 : 2 }} />
                          {row.pace > 0 && !row.isFuture && (
                            <div className="absolute left-0 right-0 border-t-2 border-dashed border-slate-400"
                              style={{ bottom: `${paceH}px` }} />
                          )}
                        </div>
                        <p className={`mt-2 text-sm font-semibold ${row.isCurrent ? 'text-slate-800' : row.isFuture ? 'text-slate-300' : 'text-slate-500'}`}>
                          {row.label}
                        </p>
                        {!row.isFuture && row.pace > 0 && (
                          <p className={`text-xs font-bold ${row.pct >= 100 ? 'text-green-600' : row.pct >= 70 ? 'text-amber-500' : 'text-red-500'}`}>
                            {Math.round(row.pct)}%
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-4 mt-5 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded-lg inline-block" />At/above target</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded-lg inline-block" />Near target</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded-lg inline-block" />Below target</span>
                  <span className="flex items-center gap-1"><span className="w-5 border-t-2 border-dashed border-slate-400 inline-block" />Quarterly target</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-slate-100 rounded-lg inline-block" />Future quarters</span>
                </div>
              </>
            )}
          </div>

          {/* Quarterly table */}
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Quarter</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Quarterly Target</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Won</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Opportunities</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase w-40">vs Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trendRows.map(row => (
                  <tr key={row.key} className={`transition-colors ${row.isCurrent ? 'bg-blue-50/30' : row.isFuture ? 'opacity-40' : 'hover:bg-slate-50'}`}>
                    <td className="px-5 py-4">
                      <span className={`font-semibold text-base ${row.isCurrent ? 'text-blue-700' : 'text-slate-700'}`}>{row.label}</span>
                      {row.isCurrent && <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-lg">Current</span>}
                      {row.isComplete && <span className="ml-2 text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-lg">Completed</span>}
                      {row.isFuture  && <span className="ml-2 text-xs text-slate-300">Upcoming</span>}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-500">
                      {row.pace > 0 ? fmtINR(row.pace) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-4 text-right font-bold text-green-600">
                      {row.achieved > 0 ? fmtINR(row.achieved) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-500">{row.count || '—'}</td>
                    <td className="px-5 py-4">
                      {!row.isFuture && row.pace > 0
                        ? <AchBar pct={row.pct} />
                        : <span className="text-xs text-slate-300">—</span>
                      }
                    </td>
                  </tr>
                ))}
                {/* FY total row */}
                <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                  <td className="px-5 py-4 text-slate-700">FY Total</td>
                  <td className="px-4 py-4 text-right text-slate-700">{teamTarget > 0 ? fmtINR(teamTarget) : '—'}</td>
                  <td className="px-4 py-4 text-right text-green-600">{fmtINR(trendRows.reduce((s, r) => s + r.achieved, 0))}</td>
                  <td className="px-4 py-4 text-right text-slate-600">{trendRows.reduce((s, r) => s + r.count, 0)}</td>
                  <td className="px-5 py-4">
                    {teamTarget > 0 ? <AchBar pct={(trendRows.reduce((s, r) => s + r.achieved, 0) / teamTarget) * 100} /> : null}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}