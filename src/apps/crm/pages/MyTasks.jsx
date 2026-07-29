import React, { useState, useEffect } from 'react'
import { collection, getDocs, updateDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const TASK_STATUS = {
  pending:          { label: 'Awaiting Your Response', cls: 'bg-amber-100 text-amber-700',   icon: '⏳' },
  accepted:         { label: 'Accepted – In Progress', cls: 'bg-blue-100  text-blue-700',    icon: '🔵' },
  counter_proposed: { label: 'Pending SM Approval',   cls: 'bg-purple-100 text-purple-700',  icon: '↩'  },
  completed:        { label: 'Completed',              cls: 'bg-green-100 text-green-700',   icon: '✅' },
  cancelled:        { label: 'Cancelled',              cls: 'bg-slate-100 text-slate-500',   icon: '✕'  },
}

const TASK_PRIORITY = {
  extremely_high: { label: 'Extremely High', cls: 'bg-red-100 text-red-700',    dot: '🔴' },
  high:           { label: 'High',           cls: 'bg-orange-100 text-orange-700', dot: '🟠' },
  medium:         { label: 'Medium',         cls: 'bg-yellow-100 text-yellow-700', dot: '🟡' },
  low:            { label: 'Low',            cls: 'bg-slate-100 text-slate-500',  dot: '⚪' },
}

const today = () => new Date().toISOString().slice(0, 10)

export default function MyTasks() {
  const { user, userProfile } = useAuth()
  const uid    = user?.uid || ''
  const myName = userProfile?.name || userProfile?.email || uid

  const [tasks, setTasks]     = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('active')  // 'active' | 'all'

  // Counter-date state
  const [counterTask, setCounterTask] = useState(null)
  const [counterDate, setCounterDate] = useState('')
  const [counterNote, setCounterNote] = useState('')

  useEffect(() => { load() }, [uid])

  const load = async () => {
    if (!uid) return
    try {
      const snap = await getDocs(query(collection(db, 'crm_tasks'), where('assignedToId', '==', uid)))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => {
        const ord = { pending: 0, counter_proposed: 0, accepted: 1, completed: 2, cancelled: 3 }
        return (ord[a.status] ?? 4) - (ord[b.status] ?? 4) ||
          (a.resolvedDate || a.requestedDate || '').localeCompare(b.resolvedDate || b.requestedDate || '')
      })
      setTasks(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const stamp = (type, note) => ({
    type, by: myName, at: new Date().toISOString(), note,
  })

  const patchTask = async (task, update) => {
    const full = { ...update, updatedAt: new Date().toISOString() }
    await updateDoc(doc(db, 'crm_tasks', task.id), full)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...full } : t))
  }

  const handleAccept = (task) => patchTask(task, {
    status: 'accepted', resolvedDate: task.requestedDate,
    activity: [...(task.activity || []), stamp('accepted', `Accepted deadline: ${task.requestedDate}`)],
  })

  const handleCounterSubmit = async () => {
    if (!counterDate || !counterTask) return
    await patchTask(counterTask, {
      status: 'counter_proposed', counterDate, counterNote: counterNote.trim(),
      activity: [...(counterTask.activity || []), stamp('counter_proposed',
        `Proposed new deadline: ${counterDate}${counterNote ? ` — "${counterNote}"` : ''}`)],
    })
    setCounterTask(null); setCounterDate(''); setCounterNote('')
  }

  const handleComplete = (task) => patchTask(task, {
    status: 'completed', completedAt: new Date().toISOString(),
    activity: [...(task.activity || []), stamp('completed', 'Task marked as completed')],
  })

  const visible = tasks.filter(t =>
    filter === 'all' ? true : (t.status !== 'completed' && t.status !== 'cancelled')
  )

  const actionNeeded  = tasks.filter(t => t.status === 'pending').length
  const inProgress    = tasks.filter(t => t.status === 'accepted').length
  const awaitingSM    = tasks.filter(t => t.status === 'counter_proposed').length
  const completed     = tasks.filter(t => t.status === 'completed').length

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading tasks…</div>
  )

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">My Tasks</h2>
          <p className="text-sm text-slate-500 mt-0.5">Tasks assigned to you across all opportunities</p>
        </div>
        <div className="flex gap-2 text-sm">
          {['active', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${filter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {f === 'active' ? 'Active' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex gap-3 flex-wrap">
        {[
          { n: actionNeeded,  label: 'Action Needed',  cls: 'bg-amber-100 text-amber-700' },
          { n: awaitingSM,    label: 'Awaiting SM',    cls: 'bg-purple-100 text-purple-700' },
          { n: inProgress,    label: 'In Progress',    cls: 'bg-blue-100 text-blue-700' },
          { n: completed,     label: 'Completed',      cls: 'bg-green-100 text-green-700' },
        ].map((c, i) => (
          <span key={i} className={`px-3 py-1 rounded-full text-sm font-semibold ${c.cls}`}>
            {c.n} {c.label}
          </span>
        ))}
      </div>

      {/* Task list */}
      {visible.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          {filter === 'active' ? 'No active tasks — you\'re all caught up!' : 'No tasks assigned yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(task => {
            const st = TASK_STATUS[task.status] || TASK_STATUS.pending
            const isCountering = counterTask?.id === task.id
            const dueDate = task.resolvedDate || task.requestedDate
            const isOverdue = dueDate && dueDate < today() && task.status !== 'completed'

            return (
              <div key={task.id} className={`border rounded-xl bg-white overflow-hidden ${
                task.status === 'pending' ? 'border-amber-300' :
                task.status === 'counter_proposed' ? 'border-purple-300' :
                'border-slate-200'}`}>
                <div className="p-4">
                  {/* Deal label */}
                  <p className="text-xs text-slate-400 font-medium mb-1">
                    🔗 {task.dealTitle || task.dealId} · {task.company}
                  </p>

                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-800">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-slate-500 mt-0.5">{task.description}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                        {st.icon} {st.label}
                      </span>
                      {task.priority && TASK_PRIORITY[task.priority] && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TASK_PRIORITY[task.priority].cls}`}>
                          {TASK_PRIORITY[task.priority].dot} {TASK_PRIORITY[task.priority].label}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Date row */}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-slate-500">Requested by: <strong>{task.requestedByName}</strong></span>
                    <span className={`font-semibold ${isOverdue ? 'text-red-600' : 'text-slate-600'}`}>
                      📅 {task.status === 'counter_proposed' ? `Proposed: ${task.counterDate}` : `Due: ${dueDate}`}
                      {isOverdue ? ' ⚠ Overdue' : ''}
                    </span>
                    {task.status === 'counter_proposed' && (
                      <span className="text-slate-400">Original: {task.requestedDate}</span>
                    )}
                  </div>

                  {/* Counter note */}
                  {task.status === 'counter_proposed' && task.counterNote && (
                    <p className="mt-1 text-xs text-purple-700 bg-purple-50 px-2 py-1 rounded-lg">
                      Your note: "{task.counterNote}"
                    </p>
                  )}

                  {/* Actions */}
                  {!isCountering && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {task.status === 'pending' && (
                        <>
                          <button onClick={() => handleAccept(task)}
                            className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition">
                            ✓ Accept Deadline ({task.requestedDate})
                          </button>
                          <button onClick={() => { setCounterTask(task); setCounterDate(''); setCounterNote('') }}
                            className="px-3 py-1.5 text-xs font-semibold bg-purple-100 text-purple-700 rounded-xl hover:bg-purple-200 transition">
                            ↩ Propose New Date
                          </button>
                        </>
                      )}
                      {task.status === 'accepted' && (
                        <button onClick={() => handleComplete(task)}
                          className="px-3 py-1.5 text-xs font-semibold bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition">
                          ✅ Mark as Complete
                        </button>
                      )}
                      {task.status === 'counter_proposed' && (
                        <span className="text-xs text-purple-600 italic">
                          Waiting for sales manager to accept your proposed date…
                        </span>
                      )}
                    </div>
                  )}

                  {/* Counter-date form */}
                  {isCountering && (
                    <div className="mt-3 pt-3 border-t border-purple-200 space-y-2">
                      <p className="text-xs font-semibold text-purple-800">Propose a different date</p>
                      <div className="flex gap-2 flex-wrap">
                        <input type="date" value={counterDate} min={today()}
                          onChange={e => setCounterDate(e.target.value)}
                          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
                        <input type="text" value={counterNote}
                          onChange={e => setCounterNote(e.target.value)}
                          placeholder="Reason (optional)"
                          className="flex-1 min-w-[160px] px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleCounterSubmit} disabled={!counterDate}
                          className="px-4 py-1.5 text-xs font-semibold bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition disabled:opacity-50">
                          Submit Proposal
                        </button>
                        <button onClick={() => setCounterTask(null)}
                          className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 transition">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Activity strip */}
                {(task.activity || []).length > 0 && (
                  <details className="border-t border-slate-100">
                    <summary className="px-4 py-1.5 text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">
                      📜 Activity ({task.activity.length})
                    </summary>
                    <div className="px-4 pb-3 space-y-1 bg-slate-50">
                      {[...(task.activity || [])].reverse().map((a, i) => (
                        <div key={i} className="flex gap-3 text-xs text-slate-600 py-0.5">
                          <span className="text-slate-400 flex-shrink-0 w-20">
                            {a.at ? new Date(a.at).toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) : '—'}
                          </span>
                          <span><strong>{a.by}</strong> — {a.note}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
