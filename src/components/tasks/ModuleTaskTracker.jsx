/**
 * ModuleTaskTracker — shared manager-level task tracker used in every module.
 * Shows all tasks from the global `tasks` collection + crm_tasks.
 * Visible to: admin, sales_manager, sales_director, project_manager, service_manager, solution_manager.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase-config'
import { useAuth } from '../../context/AuthContext'

const STATUS_META = {
  pending:          { label: 'Pending',     cls: 'bg-amber-100 text-amber-700',   icon: '⏳' },
  accepted:         { label: 'Accepted',    cls: 'bg-blue-100 text-blue-700',     icon: '✓' },
  in_progress:      { label: 'In Progress', cls: 'bg-indigo-100 text-indigo-700', icon: '▶' },
  counter_proposed: { label: 'Date Prop.',  cls: 'bg-purple-100 text-purple-700', icon: '↩' },
  completed:        { label: 'Completed',   cls: 'bg-green-100 text-green-700',   icon: '✅' },
  cancelled:        { label: 'Cancelled',   cls: 'bg-slate-100 text-slate-500',   icon: '✕' },
}
const PRIORITY_META = {
  extremely_high: { label: 'Extreme', cls: 'bg-red-100 text-red-700',      dot: '🔴' },
  high:           { label: 'High',    cls: 'bg-orange-100 text-orange-700', dot: '🟠' },
  medium:         { label: 'Medium',  cls: 'bg-yellow-100 text-yellow-700', dot: '🟡' },
  low:            { label: 'Low',     cls: 'bg-slate-100 text-slate-500',   dot: '⚪' },
}

const MANAGER_ROLES = ['admin','sales_manager','sales_director','project_manager','service_manager','solution_manager']
const today = () => new Date().toISOString().slice(0, 10)
const isActive = t => !['completed','cancelled'].includes(t.status)
const isOverdue = t => isActive(t) && (t.dueDate || t.requestedDate || '') < today()

export default function ModuleTaskTracker() {
  const { user, userProfile } = useAuth()
  const role = userProfile?.role || ''
  const isManager = MANAGER_ROLES.includes(role)

  const [tasks,    setTasks]    = useState([])
  const [crmTasks, setCrmTasks] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('active')
  const [search,   setSearch]   = useState('')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tasks'), snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, _col: 'tasks', ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'crm_tasks'), snap => {
      setCrmTasks(snap.docs.map(d => ({ id: d.id, _col: 'crm_tasks', ...d.data() })))
    })
    return unsub
  }, [])

  const allTasks = useMemo(() => {
    const merged = [...tasks, ...crmTasks]
    merged.sort((a, b) => {
      if (isOverdue(a) && !isOverdue(b)) return -1
      if (!isOverdue(a) && isOverdue(b)) return 1
      const ord = { pending: 0, counter_proposed: 0, accepted: 1, in_progress: 2, completed: 3, cancelled: 4 }
      return (ord[a.status] ?? 5) - (ord[b.status] ?? 5)
    })
    return merged
  }, [tasks, crmTasks])

  const visible = useMemo(() => {
    let list = allTasks
    if (filter === 'active')    list = list.filter(isActive)
    if (filter === 'overdue')   list = list.filter(isOverdue)
    if (filter === 'completed') list = list.filter(t => t.status === 'completed')
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(t =>
        t.title?.toLowerCase().includes(s) ||
        t.assignedToName?.toLowerCase().includes(s) ||
        t.createdByName?.toLowerCase().includes(s) ||
        t.requestedByName?.toLowerCase().includes(s)
      )
    }
    return list
  }, [allTasks, filter, search])

  const counts = useMemo(() => ({
    active:   allTasks.filter(isActive).length,
    overdue:  allTasks.filter(isOverdue).length,
    completed: allTasks.filter(t => t.status === 'completed').length,
  }), [allTasks])

  const colRef = t => doc(db, t._col, t.id)

  const handleCancel = async (t) => {
    await updateDoc(colRef(t), { status: 'cancelled', updatedAt: serverTimestamp() })
  }

  if (!isManager) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p className="text-2xl mb-2">🔒</p>
        <p className="text-sm">Task Tracker is available to managers only.</p>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center h-40 text-slate-400">Loading…</div>

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">📊 Task Tracker</h2>
          <p className="text-xs text-slate-500">All tasks across all modules</p>
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks, people…"
            className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-48" />
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex gap-2 flex-wrap">
        {[
          ['active',    `Active (${counts.active})`,     'bg-blue-100 text-blue-700'],
          ['overdue',   `Overdue (${counts.overdue})`,   'bg-red-100 text-red-700'],
          ['completed', `Done (${counts.completed})`,    'bg-green-100 text-green-700'],
          ['all',       'All',                           'bg-slate-100 text-slate-600'],
        ].map(([v,l,cls]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
              filter === v ? cls + ' border-current' : 'bg-white text-slate-500 border-slate-300'
            }`}>{l}</button>
        ))}
      </div>

      {/* Task list */}
      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-sm">No tasks match this filter.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(t => {
            const sm  = STATUS_META[t.status]    || STATUS_META.pending
            const pm  = PRIORITY_META[t.priority] || PRIORITY_META.medium
            const due = t.dueDate || t.requestedDate || null
            const over = isOverdue(t)
            const isExp = expanded === t.id

            return (
              <div key={t.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${over ? 'border-red-300' : 'border-slate-200'}`}>
                <div className="flex items-start gap-3 p-3 cursor-pointer" onClick={() => setExpanded(isExp ? null : t.id)}>
                  <span className="mt-1 text-sm flex-shrink-0">{sm.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{t.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sm.cls}`}>{sm.label}</span>
                      <span className="text-xs">{pm.dot}</span>
                      {t._col === 'crm_tasks' && <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-lg font-medium">CRM</span>}
                      {t.dealTitle    && <span className="text-xs text-slate-400">📊 {t.dealTitle}</span>}
                      {t.projectTitle && <span className="text-xs text-slate-400">📁 {t.projectTitle}</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex gap-3 flex-wrap">
                      <span>👤 {t.assignedToName || '—'}</span>
                      <span>From: {t.createdByName || t.requestedByName || '—'}</span>
                      {due && <span className={over ? 'text-red-600 font-semibold' : ''}>
                        {over ? '⚠️ Overdue:' : '📅'} {due}
                      </span>}
                    </div>
                  </div>
                  <span className="text-slate-400 text-xs mt-0.5">{isExp ? '▲' : '▼'}</span>
                </div>

                {isExp && (
                  <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 space-y-2">
                    {t.description && <p className="text-sm text-slate-700">{t.description}</p>}
                    {t.urgencyNote && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <p className="text-xs font-semibold text-amber-700 mb-0.5">⚡ Urgency Note</p>
                        <p className="text-xs text-amber-800">{t.urgencyNote}</p>
                      </div>
                    )}
                    {t.counterDate && (
                      <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                        <p className="text-xs font-semibold text-purple-700">↩ Counter-proposed: {t.counterDate}</p>
                        {t.counterNote && <p className="text-xs text-purple-800 mt-0.5">{t.counterNote}</p>}
                      </div>
                    )}
                    {isActive(t) && (
                      <button onClick={() => handleCancel(t)}
                        className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-xl transition">
                        ✕ Cancel Task
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
