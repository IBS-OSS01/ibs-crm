/**
 * ModuleMyTasks — shared "My Tasks" tab used in every module.
 * Reads from the global `tasks` collection. Shows tasks assigned to current user.
 * Also pulls crm_tasks for full interlink with CRM deal tasks.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase-config'
import { useAuth } from '../../context/AuthContext'
import { notifyTaskCompleted } from '../../lib/emailNotifications'

const STATUS_META = {
  pending:          { label: 'Awaiting Response',  cls: 'bg-amber-100 text-amber-700',   icon: '⏳' },
  accepted:         { label: 'Accepted',            cls: 'bg-blue-100 text-blue-700',     icon: '🔵' },
  in_progress:      { label: 'In Progress',         cls: 'bg-indigo-100 text-indigo-700', icon: '▶' },
  counter_proposed: { label: 'Date Proposed',       cls: 'bg-purple-100 text-purple-700', icon: '↩' },
  completed:        { label: 'Completed',           cls: 'bg-green-100 text-green-700',   icon: '✅' },
  cancelled:        { label: 'Cancelled',           cls: 'bg-slate-100 text-slate-500',   icon: '✕' },
}
const PRIORITY_META = {
  extremely_high: { label: 'Extremely High', cls: 'bg-red-100 text-red-700',      dot: '🔴' },
  high:           { label: 'High',           cls: 'bg-orange-100 text-orange-700', dot: '🟠' },
  medium:         { label: 'Medium',         cls: 'bg-yellow-100 text-yellow-700', dot: '🟡' },
  low:            { label: 'Low',            cls: 'bg-slate-100 text-slate-500',   dot: '⚪' },
}

const today = () => new Date().toISOString().slice(0, 10)
const isActive = t => !['completed', 'cancelled'].includes(t.status)

export default function ModuleMyTasks() {
  const { user, userProfile } = useAuth()
  const uid = user?.uid || ''

  const [tasks,    setTasks]    = useState([])
  const [crmTasks, setCrmTasks] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('active')   // active | all
  const [expanded, setExpanded] = useState(null)

  // Counter-propose state
  const [counterTask, setCounterTask] = useState(null)
  const [counterDate, setCounterDate] = useState('')
  const [counterNote, setCounterNote] = useState('')

  // Live: global tasks assigned to me
  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'tasks'), where('assignedToId', '==', uid))
    return onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, _col: 'tasks', ...d.data() })))
      setLoading(false)
    })
  }, [uid])

  // Live: crm_tasks assigned to me (interlink)
  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'crm_tasks'), where('assignedToId', '==', uid))
    return onSnapshot(q, snap => {
      setCrmTasks(snap.docs.map(d => ({ id: d.id, _col: 'crm_tasks', ...d.data() })))
    })
  }, [uid])

  // Live: tasks I created that have a counter-proposal pending my review
  const [myCreatedTasks,    setMyCreatedTasks]    = useState([])
  const [myCreatedCrmTasks, setMyCreatedCrmTasks] = useState([])
  useEffect(() => {
    if (!uid) return
    const unsub1 = onSnapshot(
      query(collection(db, 'tasks'),     where('createdById',   '==', uid)),
      snap => setMyCreatedTasks(snap.docs.map(d => ({ id: d.id, _col: 'tasks', ...d.data() })))
    )
    const unsub2 = onSnapshot(
      query(collection(db, 'crm_tasks'), where('requestedById', '==', uid)),
      snap => setMyCreatedCrmTasks(snap.docs.map(d => ({ id: d.id, _col: 'crm_tasks', ...d.data() })))
    )
    return () => { unsub1(); unsub2() }
  }, [uid])

  // Counter-proposals waiting for my decision (created by me, status=counter_proposed)
  const pendingReview = useMemo(() => {
    const all = [...myCreatedTasks, ...myCreatedCrmTasks]
    return all.filter(t => t.status === 'counter_proposed')
      .sort((a, b) => (a.dueDate || a.requestedDate || '').localeCompare(b.dueDate || b.requestedDate || ''))
  }, [myCreatedTasks, myCreatedCrmTasks])

  const handleAcceptCounter = async (t) => {
    const newDate = t.counterDate
    await updateDoc(doc(db, t._col, t.id), {
      status: 'accepted',
      dueDate: newDate,
      requestedDate: newDate,
      resolvedDate: newDate,
      counterDate: '',
      counterNote: '',
      updatedAt: serverTimestamp(),
    })
  }

  const handleRejectCounter = async (t) => {
    await updateDoc(doc(db, t._col, t.id), {
      status: 'pending',
      counterDate: '',
      counterNote: '',
      updatedAt: serverTimestamp(),
    })
  }

  const allTasks = useMemo(() => {
    const merged = [...tasks, ...crmTasks]
    merged.sort((a, b) => {
      const ord = { pending: 0, counter_proposed: 0, accepted: 1, in_progress: 2, completed: 3, cancelled: 4 }
      return (ord[a.status] ?? 5) - (ord[b.status] ?? 5) ||
        (a.dueDate || a.requestedDate || '').localeCompare(b.dueDate || b.requestedDate || '')
    })
    return merged
  }, [tasks, crmTasks])

  const visible = useMemo(() =>
    filter === 'active' ? allTasks.filter(isActive) : allTasks
  , [allTasks, filter])

  const activeCount = allTasks.filter(isActive).length

  const colRef = (t) => doc(db, t._col, t.id)

  const handleAccept = async (t) => {
    await updateDoc(colRef(t), { status: 'accepted', updatedAt: serverTimestamp() })
  }

  const handleInProgress = async (t) => {
    await updateDoc(colRef(t), { status: 'in_progress', updatedAt: serverTimestamp() })
  }

  const handleComplete = async (t) => {
    await updateDoc(colRef(t), { status: 'completed', completedAt: serverTimestamp(), updatedAt: serverTimestamp() })
    // Email creator
    notifyTaskCompleted(
      { ...t, requestedByName: t.createdByName || t.requestedByName,
        dealTitle: t.dealTitle || t.projectTitle || 'N/A' },
      t.createdByEmail || ''
    ).catch(() => {})
  }

  const handleCounter = async () => {
    if (!counterDate || !counterTask) return
    await updateDoc(colRef(counterTask), {
      status: 'counter_proposed',
      counterDate, counterNote,
      updatedAt: serverTimestamp(),
    })
    setCounterTask(null); setCounterDate(''); setCounterNote('')
  }

  if (loading) return <div className="flex items-center justify-center h-40 text-slate-400">Loading tasks…</div>

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">✅ My Tasks</h2>
          <p className="text-xs text-slate-500">{activeCount} active task{activeCount !== 1 ? 's' : ''} assigned to you</p>
        </div>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {[['active','Active'],['all','All']].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition ${filter===v ? 'bg-white text-blue-700 shadow' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Counter-proposals waiting for your decision ── */}
      {pendingReview.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-purple-700 uppercase tracking-wide">↩ Date Proposals — Needs Your Decision</p>
          {pendingReview.map(t => {
            const pm = PRIORITY_META[t.priority] || PRIORITY_META.medium
            return (
              <div key={t.id} className="bg-purple-50 border border-purple-300 rounded-xl p-4 space-y-2 shadow-sm">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{t.title}</p>
                    <div className="flex gap-2 flex-wrap text-xs text-slate-500 mt-0.5">
                      <span>Assigned to: {t.assignedToName || '—'}</span>
                      {(t.dealTitle || t.projectTitle) && <span>📊 {t.dealTitle || t.projectTitle}</span>}
                      <span>{pm.dot} {pm.label}</span>
                    </div>
                  </div>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-semibold whitespace-nowrap flex-shrink-0">↩ Date Proposed</span>
                </div>
                <div className="bg-white border border-purple-200 rounded-xl px-3 py-2 text-sm space-y-0.5">
                  <p className="text-xs text-slate-500">Original deadline: <span className="font-medium text-slate-700">{t.dueDate || t.requestedDate || '—'}</span></p>
                  <p className="text-xs text-purple-800 font-semibold">Proposed: {t.counterDate}</p>
                  {t.counterNote && <p className="text-xs text-slate-500 italic">"{t.counterNote}"</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleAcceptCounter(t)}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-xl transition">
                    ✓ Accept {t.counterDate}
                  </button>
                  <button onClick={() => handleRejectCounter(t)}
                    className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold rounded-xl transition">
                    ✕ Reject — Keep original date
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-sm">{filter === 'active' ? 'No active tasks — you\'re all caught up!' : 'No tasks found.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(t => {
            const sm  = STATUS_META[t.status]   || STATUS_META.pending
            const pm  = PRIORITY_META[t.priority] || PRIORITY_META.medium
            const due = t.dueDate || t.requestedDate || null
            const overdue = isActive(t) && due && due < today()
            const isExp = expanded === t.id

            return (
              <div key={t.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${overdue ? 'border-red-300' : 'border-slate-200'}`}>
                {/* Row */}
                <div className="flex items-start gap-3 p-3 cursor-pointer" onClick={() => setExpanded(isExp ? null : t.id)}>
                  <span className="mt-1 text-sm flex-shrink-0">{sm.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{t.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sm.cls}`}>{sm.label}</span>
                      <span className="text-xs">{pm.dot}</span>
                      {t._col === 'crm_tasks' && <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-lg font-medium">CRM Deal</span>}
                      {t.dealTitle   && <span className="text-xs text-slate-400">📊 {t.dealTitle}</span>}
                      {t.projectTitle && <span className="text-xs text-slate-400">📁 {t.projectTitle}</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex gap-3 flex-wrap">
                      <span>From: {t.createdByName || t.requestedByName || '—'}</span>
                      {due && <span className={overdue ? 'text-red-600 font-semibold' : ''}>
                        {overdue ? '⚠️ Overdue:' : '📅 Due:'} {due}
                      </span>}
                    </div>
                  </div>
                  <span className="text-slate-400 text-xs mt-0.5">{isExp ? '▲' : '▼'}</span>
                </div>

                {/* Expanded */}
                {isExp && (
                  <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 space-y-3">
                    {t.description && <p className="text-sm text-slate-700">{t.description}</p>}
                    {t.urgencyNote && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <p className="text-xs font-semibold text-amber-700 mb-0.5">⚡ Urgency / Context from requester</p>
                        <p className="text-xs text-amber-800">{t.urgencyNote}</p>
                      </div>
                    )}
                    {isActive(t) && (
                      <div className="flex gap-2 flex-wrap">
                        {t.status === 'pending' && (
                          <button onClick={() => handleAccept(t)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition">
                            ✔ Accept
                          </button>
                        )}
                        {['pending', 'accepted'].includes(t.status) && (
                          <button onClick={() => handleInProgress(t)}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition">
                            ▶ In Progress
                          </button>
                        )}
                        {['pending', 'accepted', 'in_progress'].includes(t.status) && (
                          <button onClick={() => handleComplete(t)}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-xl transition">
                            ✅ Complete
                          </button>
                        )}
                        {t.status === 'pending' && (
                          <button onClick={() => { setCounterTask(t); setCounterDate(''); setCounterNote('') }}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl transition">
                            📅 Propose Date
                          </button>
                        )}
                      </div>
                    )}
                    {counterTask?.id === t.id && (
                      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-semibold text-purple-700">Propose an alternative deadline</p>
                        <input type="date" value={counterDate} onChange={e => setCounterDate(e.target.value)}
                          className="w-full border border-purple-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                        <textarea rows={2} placeholder="Reason / comment for requester…"
                          value={counterNote} onChange={e => setCounterNote(e.target.value)}
                          className="w-full border border-purple-300 rounded-lg px-2 py-1 text-sm focus:outline-none resize-none" />
                        <div className="flex gap-2">
                          <button onClick={handleCounter}
                            className="px-3 py-1.5 bg-purple-600 text-white text-xs font-semibold rounded-xl hover:bg-purple-700 transition">
                            Send Proposal
                          </button>
                          <button onClick={() => setCounterTask(null)}
                            className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded-xl hover:bg-slate-50 transition">
                            Cancel
                          </button>
                        </div>
                      </div>
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