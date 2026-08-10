import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

// ── Constants ──────────────────────────────────────────────────────────────────
const TASK_STATUS = {
  pending:          { label: 'Awaiting',     cls: 'bg-amber-100 text-amber-700',   icon: '⏳' },
  accepted:         { label: 'Accepted',     cls: 'bg-blue-100 text-blue-700',     icon: '✓'  },
  counter_proposed: { label: 'Date Proposed',cls: 'bg-purple-100 text-purple-700', icon: '↩'  },
  completed:        { label: 'Completed',    cls: 'bg-green-100 text-green-700',   icon: '✅' },
  cancelled:        { label: 'Cancelled',    cls: 'bg-slate-100 text-slate-500',   icon: '✕'  },
}

const PRIORITY_CFG = {
  extremely_high: { label: 'Extreme', cls: 'bg-red-100 text-red-700',      dot: '🔴' },
  high:           { label: 'High',    cls: 'bg-orange-100 text-orange-700', dot: '🟠' },
  medium:         { label: 'Medium',  cls: 'bg-yellow-100 text-yellow-700', dot: '🟡' },
  low:            { label: 'Low',     cls: 'bg-slate-100 text-slate-500',   dot: '⚪' },
}

const today = () => new Date().toISOString().slice(0, 10)

// Task date fields (completedAt, requestedDate, etc.) are supposed to be
// ISO date strings, but some records were saved as Firestore Timestamp
// objects or raw JS Date objects instead (no .slice method), which crashed
// this whole page. This normalizes any of those shapes to a 'YYYY-MM-DD'
// string, or '' if there's nothing usable.
const toDateStr = (v) => {
  if (!v) return ''
  if (typeof v === 'string') return v.slice(0, 10)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 10) // Firestore Timestamp
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString().slice(0, 10) // {seconds,nanoseconds}
  return ''
}

const isActive = (t) => !['completed', 'cancelled'].includes(t.status)
const isOverdue = (t) => isActive(t) && (t.resolvedDate || t.requestedDate || '') < today()
const daysDiff = (date) => {
  if (!date) return null
  const d = Math.round((new Date(today()) - new Date(date)) / 86400000)
  return d
}

const fmt = (iso) => {
  const s = toDateStr(iso)
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

const fmtAgo = (iso) => {
  if (!iso) return '—'
  const diff = Math.round((Date.now() - new Date(iso)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return `${diff}d ago`
  if (diff < 30) return `${Math.round(diff / 7)}w ago`
  return fmt(iso)
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TaskTracker() {
  const { userProfile } = useAuth()
  const role = userProfile?.role || ''
  const isAdmin = role === 'admin'
  const canView = isAdmin || role === 'sales_director' || role === 'sales_manager'

  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState({})        // userId → boolean
  const [sortBy, setSortBy] = useState('overdue')      // 'overdue' | 'name' | 'total'
  const [filterStatus, setFilterStatus] = useState('all') // 'all' | 'overdue' | 'pending'

  useEffect(() => {
    if (!canView) { setLoading(false); return }
    fetchTasks()
  }, [canView])

  const fetchTasks = async () => {
    try {
      const snap = await getDocs(collection(db, 'crm_tasks'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setTasks(data)
    } catch (e) { setError('Failed to load tasks: ' + e.message) }
    finally { setLoading(false) }
  }

  // ── Per-user stats ──────────────────────────────────────────────────────────
  const userStats = useMemo(() => {
    const map = {}
    tasks.forEach(t => {
      const uid  = t.assignedToId   || 'unknown'
      const name = t.assignedToName || 'Unknown'
      if (!map[uid]) map[uid] = {
        uid, name,
        total: 0, pending: 0, overdue: 0, accepted: 0,
        counterProposed: 0, completed: 0, cancelled: 0,
        onTimeCount: 0, lateCount: 0,
        lastUpdated: '',
        tasks: [],
      }
      const m = map[uid]
      m.total++
      m.tasks.push(t)
      if (t.status === 'pending')           m.pending++
      if (t.status === 'accepted')          m.accepted++
      if (t.status === 'counter_proposed')  m.counterProposed++
      if (t.status === 'completed')         m.completed++
      if (t.status === 'cancelled')         m.cancelled++
      if (isOverdue(t))                     m.overdue++
      if (t.status === 'completed') {
        const deadline = t.resolvedDate || t.requestedDate || ''
        const doneAt   = toDateStr(t.completedAt)
        if (deadline && doneAt) {
          if (doneAt <= deadline) m.onTimeCount++
          else                    m.lateCount++
        }
      }
      if ((t.updatedAt || '') > m.lastUpdated) m.lastUpdated = t.updatedAt || ''
    })
    return Object.values(map)
  }, [tasks])

  const sorted = useMemo(() => {
    let rows = [...userStats]
    if (filterStatus === 'overdue') rows = rows.filter(u => u.overdue > 0)
    if (filterStatus === 'pending') rows = rows.filter(u => u.pending + u.accepted + u.counterProposed > 0)
    if (sortBy === 'overdue') rows.sort((a, b) => b.overdue - a.overdue || b.pending - a.pending)
    if (sortBy === 'name')    rows.sort((a, b) => a.name.localeCompare(b.name))
    if (sortBy === 'total')   rows.sort((a, b) => b.total - a.total)
    return rows
  }, [userStats, sortBy, filterStatus])

  // ── Summary totals ──────────────────────────────────────────────────────────
  const totals = useMemo(() => ({
    total:    tasks.length,
    active:   tasks.filter(isActive).length,
    overdue:  tasks.filter(isOverdue).length,
    completed:tasks.filter(t => t.status === 'completed').length,
    usersWithOverdue: userStats.filter(u => u.overdue > 0).length,
  }), [tasks, userStats])

  const toggleExpand = (uid) => setExpanded(p => ({ ...p, [uid]: !p[uid] }))

  if (!canView) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          <p className="text-4xl mb-3">🔒</p>
          <p>Task Tracker is available to Sales Directors and Admins only.</p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading tasks…</div>
  if (error)   return <div className="p-6 text-red-600">{error}</div>

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">📋 Task Tracker</h2>
        <p className="text-slate-500 text-sm mt-0.5">Team task performance — pending, overdue and response tracking</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Tasks',     value: totals.total,           cls: 'bg-slate-50  border-slate-200  text-slate-700' },
          { label: 'Active',          value: totals.active,          cls: 'bg-blue-50   border-blue-200   text-blue-700' },
          { label: 'Overdue',         value: totals.overdue,         cls: totals.overdue > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-500' },
          { label: 'Completed',       value: totals.completed,       cls: 'bg-green-50  border-green-200  text-green-700' },
          { label: 'Users w/ Overdue',value: totals.usersWithOverdue,cls: totals.usersWithOverdue > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-500' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl border p-3 text-center ${c.cls}`}>
            <p className="text-2xl font-bold">{c.value}</p>
            <p className="text-xs font-medium mt-0.5 opacity-80">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filters + sort */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-slate-500 font-medium">Filter:</span>
          {[['all','All Users'], ['overdue','Has Overdue'], ['pending','Has Pending']].map(([val, lbl]) => (
            <button key={val} onClick={() => setFilterStatus(val)}
              className={`px-3 py-1 rounded-full border text-xs font-medium transition ${filterStatus === val ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-sm ml-auto">
          <span className="text-slate-500 font-medium">Sort:</span>
          {[['overdue','Most Overdue'], ['total','Most Tasks'], ['name','Name A–Z']].map(([val, lbl]) => (
            <button key={val} onClick={() => setSortBy(val)}
              className={`px-3 py-1 rounded-full border text-xs font-medium transition ${sortBy === val ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* User rows */}
      <div className="space-y-3">
        {sorted.length === 0 && (
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
            No tasks found matching the filter.
          </div>
        )}
        {sorted.map(u => {
          const activeTasks  = u.pending + u.accepted + u.counterProposed
          const totalDone    = u.onTimeCount + u.lateCount
          const onTimePct    = totalDone > 0 ? Math.round((u.onTimeCount / totalDone) * 100) : null
          const isExpanded   = expanded[u.uid]
          const healthColor  = u.overdue > 0
            ? (u.overdue >= 3 ? 'border-l-red-500' : 'border-l-amber-400')
            : activeTasks > 0 ? 'border-l-blue-400' : 'border-l-green-400'

          return (
            <div key={u.uid} className={`bg-white rounded-2xl shadow-card border border-slate-200/70 border-l-4 ${healthColor} shadow-sm overflow-hidden`}>
              {/* User header row */}
              <div className="px-4 py-3 flex flex-wrap items-center gap-4">
                {/* Avatar + name */}
                <div className="flex items-center gap-2.5 flex-shrink-0 w-40">
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-600 flex-shrink-0">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{u.name}</p>
                  </div>
                </div>

                {/* Stats chips */}
                <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-slate-100 text-slate-600 font-medium">
                    📋 {u.total} total
                  </span>
                  {activeTasks > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-blue-100 text-blue-700 font-medium">
                      ⏳ {activeTasks} active
                    </span>
                  )}
                  {u.overdue > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-red-100 text-red-700 font-semibold">
                      🔴 {u.overdue} overdue
                    </span>
                  )}
                  {u.counterProposed > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-purple-100 text-purple-700 font-medium">
                      ↩ {u.counterProposed} date proposed
                    </span>
                  )}
                  {u.completed > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-green-100 text-green-700 font-medium">
                      ✅ {u.completed} done
                    </span>
                  )}
                  {onTimePct !== null && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ${onTimePct >= 80 ? 'bg-green-100 text-green-700' : onTimePct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      🎯 {onTimePct}% on-time
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-slate-50 text-slate-500">
                    🕐 {fmtAgo(u.lastUpdated)}
                  </span>
                </div>

                {/* Expand button */}
                <button onClick={() => toggleExpand(u.uid)}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 flex-shrink-0">
                  {isExpanded ? '▲ Hide' : '▼ Tasks'}
                </button>
              </div>

              {/* Expanded task list */}
              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50">
                  {u.tasks.length === 0 ? (
                    <p className="px-4 py-4 text-slate-400 text-sm">No tasks.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                        <tr className="bg-slate-100 text-slate-500 uppercase text-xs">
                          <th className="text-left px-4 py-2">Task</th>
                          <th className="text-left px-3 py-2">Priority</th>
                          <th className="text-left px-3 py-2">Due Date</th>
                          <th className="text-left px-3 py-2">Status</th>
                          <th className="text-left px-3 py-2">Last Updated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {[...u.tasks]
                          .sort((a, b) => {
                            // overdue first, then by resolvedDate
                            const ao = isOverdue(a) ? 0 : 1
                            const bo = isOverdue(b) ? 0 : 1
                            if (ao !== bo) return ao - bo
                            return (a.resolvedDate || a.requestedDate || '').localeCompare(b.resolvedDate || b.requestedDate || '')
                          })
                          .map(t => {
                            const overdue = isOverdue(t)
                            const dueDate = t.resolvedDate || t.requestedDate
                            const overdueDays = overdue ? daysDiff(dueDate) : null
                            const st = TASK_STATUS[t.status] || TASK_STATUS.pending
                            const pr = PRIORITY_CFG[t.priority] || PRIORITY_CFG.medium
                            return (
                              <tr key={t.id} className={overdue ? 'bg-red-50/60' : 'bg-white'}>
                                <td className="px-4 py-2.5">
                                  <p className="font-medium text-slate-800">{t.title}</p>
                                  {t.description && <p className="text-slate-400 truncate max-w-xs">{t.description}</p>}
                                  {t.requestedByName && <p className="text-slate-400 mt-0.5">Requested by {t.requestedByName}</p>}
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-xs font-medium ${pr.cls}`}>
                                    {pr.dot} {pr.label}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className={overdue ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                                    {fmt(dueDate)}
                                    {overdueDays !== null && (
                                      <span className="block text-red-500">
                                        {overdueDays}d overdue
                                      </span>
                                    )}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-xs font-medium ${st.cls}`}>
                                    {st.icon} {st.label}
                                  </span>
                                  {t.status === 'counter_proposed' && t.counterDate && (
                                    <span className="block text-slate-400 mt-0.5">Proposed: {fmt(t.counterDate)}</span>
                                  )}
                                  {t.status === 'completed' && t.completedAt && (
                                    <span className={`block mt-0.5 ${(toDateStr(t.completedAt) <= (t.resolvedDate || t.requestedDate || '')) ? 'text-green-600' : 'text-red-500'}`}>
                                      Done {fmt(t.completedAt)} {toDateStr(t.completedAt) <= (t.resolvedDate || t.requestedDate || '') ? '✓ on time' : '✗ late'}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-slate-400">
                                  {fmtAgo(t.updatedAt)}
                                </td>
                              </tr>
                            )
                          })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {tasks.length === 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-10 text-center text-slate-400">
          <p className="text-3xl mb-2">📋</p>
          <p>No tasks created yet. Tasks are created from the opportunity panel.</p>
        </div>
      )}
    </div>
  )
}
