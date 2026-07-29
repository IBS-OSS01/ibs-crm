/**
 * TasksHome.jsx — General Tasks Module
 *
 * All users can:
 *   • Create tasks (standalone, linked to active deal, or linked to active project)
 *   • Assign to any user
 *   • View "My Tasks" (assigned to me), "Created by Me", and "All Tasks" (admin/managers)
 *   • Accept, complete, or cancel tasks
 *
 * Firestore collection: `tasks`
 * Email notifications: notifyTaskAssigned (assignee) / notifyTaskCompleted (creator)
 */

import React, { useState, useEffect, useMemo } from 'react'
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, getDocs
} from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { notifyTaskAssigned, notifyTaskCompleted } from '../../../lib/emailNotifications'

const OPEN_STAGES      = ['lead', 'prebid', 'bid', 'closing']
const ACTIVE_STATUSES  = ['pending', 'accepted', 'in_progress']

function occupancyMeta(count) {
  if (count === 0) return { label: 'Free',   color: 'bg-green-100 text-green-700', dot: 'bg-green-500' }
  if (count <= 2)  return { label: 'Low',    color: 'bg-green-100 text-green-700', dot: 'bg-green-500' }
  if (count <= 5)  return { label: 'Medium', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' }
  return              { label: 'High',   color: 'bg-red-100 text-red-700',    dot: 'bg-red-500' }
}

const PRIORITY_OPTS = [
  { value: 'extremely_high', label: 'Extremely High', color: 'bg-red-700 text-white' },
  { value: 'high',           label: 'High',           color: 'bg-red-500 text-white' },
  { value: 'medium',         label: 'Medium',         color: 'bg-yellow-500 text-white' },
  { value: 'low',            label: 'Low',            color: 'bg-green-600 text-white' },
]

const STATUS_META = {
  pending:    { label: 'Pending',     color: 'bg-slate-400 text-white' },
  accepted:   { label: 'Accepted',    color: 'bg-blue-500 text-white' },
  in_progress:{ label: 'In Progress', color: 'bg-indigo-500 text-white' },
  completed:  { label: 'Completed',   color: 'bg-green-600 text-white' },
  cancelled:  { label: 'Cancelled',   color: 'bg-red-400 text-white' },
}

const MANAGER_ROLES = ['admin', 'sales_manager', 'project_manager', 'sales_director', 'service_manager']

function priorityMeta(p) {
  return PRIORITY_OPTS.find(o => o.value === p) || PRIORITY_OPTS[2]
}

export default function TasksHome() {
  const { user, userProfile } = useAuth()
  const uid   = user?.uid
  const role  = userProfile?.role || 'user'
  const isManager = MANAGER_ROLES.includes(role)

  // ── Data ──────────────────────────────────────────────────────────────────
  const [tasks,    setTasks]    = useState([])
  const [crmTasks, setCrmTasks] = useState([])   // for occupancy
  const [users,    setUsers]    = useState([])
  const [deals,    setDeals]    = useState([])
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)

  // ── UI state ─────────────────────────────────────────────────────────────
  const [tab,          setTab]          = useState('mine')      // mine | created | all
  const [showCreate,   setShowCreate]   = useState(false)
  const [expandedId,   setExpandedId]   = useState(null)
  const [statusFilter, setStatusFilter] = useState('active')    // active | completed | all

  // ── Create form ──────────────────────────────────────────────────────────
  const blankForm = {
    type: 'general',  // general | deal | project
    title: '',
    description: '',
    urgencyNote: '',
    priority: 'medium',
    dueDate: '',
    assignedToId: '',
    dealId: '',
    projectId: '',
  }
  const [form,    setForm]    = useState(blankForm)
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')

  // ── Load all users ────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [])

  // ── Load active deals ─────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'crm_deals'), where('stage', 'in', OPEN_STAGES))
    getDocs(q).then(snap => {
      setDeals(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }).catch(console.error)
  }, [])

  // ── Load active projects ──────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'projects'), where('status', 'in', ['active', 'in_progress']))
    getDocs(q).then(snap => {
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }).catch(console.error)
  }, [])

  // ── Load CRM tasks for occupancy ──────────────────────────────────────────
  useEffect(() => {
    getDocs(query(collection(db, 'crm_tasks'), where('status', 'in', ['pending', 'accepted', 'counter_proposed'])))
      .then(snap => setCrmTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  // ── Load tasks (live) ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, err => {
      console.error('[Tasks]', err)
      setLoading(false)
    })
    return unsub
  }, [uid])

  // ── Filtered task list ────────────────────────────────────────────────────
  const visibleTasks = useMemo(() => {
    let list = tasks

    // Tab filter
    if (tab === 'mine')    list = list.filter(t => t.assignedToId === uid)
    if (tab === 'created') list = list.filter(t => t.createdById  === uid)
    // 'all' → no restriction (for managers)

    // Status filter
    if (statusFilter === 'active')    list = list.filter(t => !['completed','cancelled'].includes(t.status))
    if (statusFilter === 'completed') list = list.filter(t => t.status === 'completed')

    return list
  }, [tasks, tab, uid, statusFilter])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const findUser = id => users.find(u => u.id === id)

  // Assignee occupancy — combines tasks + crm_tasks
  const assigneeOccupancy = useMemo(() => {
    if (!form.assignedToId) return null
    const today   = new Date().toISOString().slice(0, 10)
    const in7days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    const allActive = [
      ...tasks.filter(t => ACTIVE_STATUSES.includes(t.status) && t.assignedToId === form.assignedToId),
      ...crmTasks.filter(t => t.assignedToId === form.assignedToId),
    ]
    return {
      count:   allActive.length,
      dueSoon: allActive.filter(t => t.dueDate && t.dueDate <= in7days).length,
      overdue: allActive.filter(t => t.dueDate && t.dueDate < today).length,
    }
  }, [form.assignedToId, tasks, crmTasks])

  // ── Create task ───────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!form.title.trim())       return setFormErr('Title is required.')
    if (!form.assignedToId)       return setFormErr('Please select an assignee.')
    if (form.type === 'opportunity' && !form.dealId)       return setFormErr('Please select a opportunity.')
    if (form.type === 'project' && !form.projectId) return setFormErr('Please select a project.')

    setSaving(true)
    setFormErr('')

    try {
      const assignee = findUser(form.assignedToId)
      const deal     = deals.find(d => d.id === form.dealId)
      const proj     = projects.find(p => p.id === form.projectId)

      const taskDoc = {
        type:          form.type,
        title:         form.title.trim(),
        description:   form.description.trim(),
        urgencyNote:   form.urgencyNote.trim(),
        priority:      form.priority,
        status:        'pending',
        dueDate:       form.dueDate || null,

        assignedToId:   form.assignedToId,
        assignedToName: assignee?.name || assignee?.email || '',
        assignedToEmail: assignee?.email || '',

        createdById:   uid,
        createdByName: userProfile?.name || user.email,

        dealId:        form.type === 'opportunity' ? form.dealId : null,
        dealTitle:     form.type === 'opportunity' ? (deal?.title || deal?.name || form.dealId) : null,
        company:       form.type === 'opportunity' ? (deal?.company || null) : null,

        projectId:     form.type === 'project' ? form.projectId : null,
        projectTitle:  form.type === 'project' ? (proj?.name || proj?.title || form.projectId) : null,

        activity:      [],
        createdAt:     serverTimestamp(),
        updatedAt:     serverTimestamp(),
        completedAt:   null,
      }

      await addDoc(collection(db, 'tasks'), taskDoc)

      // Email notification
      const emailTask = {
        ...taskDoc,
        requestedByName: taskDoc.createdByName,
        requestedDate:   form.dueDate || '—',
        dealTitle: taskDoc.dealTitle || taskDoc.projectTitle || 'N/A',
      }
      notifyTaskAssigned(emailTask, assignee?.email || '')

      setForm(blankForm)
      setShowCreate(false)
    } catch (err) {
      console.error(err)
      setFormErr('Failed to create task. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Update task status ────────────────────────────────────────────────────
  const handleStatusChange = async (task, newStatus) => {
    const ref = doc(db, 'tasks', task.id)
    const update = {
      status:    newStatus,
      updatedAt: serverTimestamp(),
      activity:  [...(task.activity || []), {
        type: newStatus, by: userProfile?.name || user.email, at: new Date().toISOString()
      }],
    }
    if (newStatus === 'completed') update.completedAt = serverTimestamp()

    await updateDoc(ref, update)

    // Email creator on completion
    if (newStatus === 'completed') {
      const creator = findUser(task.createdById)
      const emailTask = {
        ...task,
        requestedByName: task.createdByName,
        dealTitle: task.dealTitle || task.projectTitle || 'N/A',
        assignedToName: task.assignedToName,
      }
      notifyTaskCompleted(emailTask, creator?.email || '')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'mine',    label: 'My Tasks' },
    { key: 'created', label: 'Created by Me' },
    ...(isManager ? [{ key: 'all', label: 'All Tasks' }] : []),
  ]

  return (
    <div className="p-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">✅ Tasks</h1>
        <button
          onClick={() => { setShowCreate(true); setForm(blankForm); setFormErr('') }}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition"
        >
          + New Task
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 bg-slate-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-blue-700 shadow' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-4">
        {[['active','Active'],['completed','Completed'],['all','All']].map(([v,l]) => (
          <button key={v} onClick={() => setStatusFilter(v)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
              statusFilter === v
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading tasks…</div>
      ) : visibleTasks.length === 0 ? (
        <div className="text-center py-12 text-slate-400">No tasks found.</div>
      ) : (
        <div className="space-y-2">
          {visibleTasks.map(task => {
            const pm = priorityMeta(task.priority)
            const sm = STATUS_META[task.status] || STATUS_META.pending
            const isExpanded = expandedId === task.id
            const canAct = task.assignedToId === uid || task.createdById === uid || isManager

            return (
              <div key={task.id}
                className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">

                {/* Summary row */}
                <div
                  className="flex items-start gap-3 p-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : task.id)}
                >
                  {/* Priority dot */}
                  <span className={`mt-0.5 flex-shrink-0 w-2.5 h-2.5 rounded-full ${pm.color.split(' ')[0]}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{task.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sm.color}`}>
                        {sm.label}
                      </span>
                      {task.type === 'opportunity' && task.dealTitle && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          📊 {task.dealTitle}
                        </span>
                      )}
                      {task.type === 'project' && task.projectTitle && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                          📁 {task.projectTitle}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex gap-3 flex-wrap">
                      <span>👤 {task.assignedToName}</span>
                      {task.dueDate && <span>📅 Due {task.dueDate}</span>}
                      <span className="capitalize">{pm.label} priority</span>
                    </div>
                  </div>

                  <span className="text-slate-400 text-xs mt-0.5">{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 space-y-3">
                    {task.description && (
                      <p className="text-sm text-slate-700 whitespace-pre-line">{task.description}</p>
                    )}
                    {task.urgencyNote && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <p className="text-xs font-semibold text-amber-700 mb-0.5">⚡ Urgency / Context</p>
                        <p className="text-xs text-amber-800 whitespace-pre-line">{task.urgencyNote}</p>
                      </div>
                    )}
                    <div className="text-xs text-slate-500 grid grid-cols-2 gap-x-4 gap-y-1">
                      <span>Created by: <b>{task.createdByName}</b></span>
                      <span>Assigned to: <b>{task.assignedToName}</b></span>
                      {task.dueDate && <span>Due date: <b>{task.dueDate}</b></span>}
                      {task.completedAt && <span>Completed: <b>✅</b></span>}
                    </div>

                    {/* Actions */}
                    {canAct && (
                      <div className="flex gap-2 flex-wrap pt-1">
                        {task.status === 'pending' && task.assignedToId === uid && (
                          <button onClick={() => handleStatusChange(task, 'accepted')}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition">
                            ✔ Accept
                          </button>
                        )}
                        {['pending','accepted','in_progress'].includes(task.status) && task.assignedToId === uid && (
                          <button onClick={() => handleStatusChange(task, 'in_progress')}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition">
                            ▶ Mark In Progress
                          </button>
                        )}
                        {['pending','accepted','in_progress'].includes(task.status) && task.assignedToId === uid && (
                          <button onClick={() => handleStatusChange(task, 'completed')}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-xl transition">
                            ✅ Complete
                          </button>
                        )}
                        {!['completed','cancelled'].includes(task.status) && (task.createdById === uid || isManager) && (
                          <button onClick={() => handleStatusChange(task, 'cancelled')}
                            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-xl transition">
                            ✕ Cancel
                          </button>
                        )}
                      </div>
                    )}

                    {/* Activity log */}
                    {task.activity?.length > 0 && (
                      <div className="pt-1 border-t border-slate-200">
                        <p className="text-xs font-semibold text-slate-500 mb-1">Activity</p>
                        <div className="space-y-0.5">
                          {task.activity.map((a, i) => (
                            <p key={i} className="text-xs text-slate-500">
                              <span className="capitalize font-medium">{a.type.replace('_',' ')}</span>
                              {' by '}{a.by}
                              {a.at ? ' · ' + new Date(a.at).toLocaleDateString('en-IN') : ''}
                            </p>
                          ))}
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

      {/* ── Create Task Modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-slate-800">New Task</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            <div className="p-5 space-y-4">
              {/* Task type */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Task Type</label>
                <div className="flex gap-2">
                  {[['general','🗒️ General'],['opportunity','📊 Linked to Opportunity'],['project','📁 Linked to Project']].map(([v,l]) => (
                    <button key={v} onClick={() => setForm(f => ({ ...f, type: v, dealId: '', projectId: '' }))}
                      className={`flex-1 py-2 px-2 rounded-xl text-xs font-semibold border transition ${
                        form.type === v
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                      }`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Deal picker */}
              {form.type === 'opportunity' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Active Opportunity *</label>
                  <select value={form.dealId} onChange={e => setForm(f => ({ ...f, dealId: e.target.value }))}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select opportunity —</option>
                    {deals.map(d => (
                      <option key={d.id} value={d.id}>{d.title || d.name || d.id}</option>
                    ))}
                  </select>
                  {deals.length === 0 && <p className="text-xs text-amber-600 mt-1">No active opportunities found.</p>}
                </div>
              )}

              {/* Project picker */}
              {form.type === 'project' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Active Project *</label>
                  <select value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select project —</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name || p.title || p.id}</option>
                    ))}
                  </select>
                  {projects.length === 0 && <p className="text-xs text-amber-600 mt-1">No active projects found.</p>}
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
                <input
                  type="text" placeholder="Task title…"
                  value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                <textarea rows={3} placeholder="Details, context, steps…"
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Priority + Due date row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Priority</label>
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {PRIORITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Due Date</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Assignee + Occupancy */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Assign To *</label>
                <select value={form.assignedToId} onChange={e => setForm(f => ({ ...f, assignedToId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Select user —</option>
                  {users
                    .filter(u => u.id && u.name)
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role || 'user'})</option>
                    ))
                  }
                </select>

                {/* Occupancy panel */}
                {assigneeOccupancy && (() => {
                  const occ  = assigneeOccupancy
                  const meta = occupancyMeta(occ.count)
                  return (
                    <div className={`mt-2 rounded-xl px-3 py-2.5 border ${meta.color}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold">Current Task Load</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${meta.color}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${meta.dot} mr-1`} />
                          {meta.label} Occupancy
                        </span>
                      </div>
                      <div className="flex gap-4 text-xs">
                        <span>📋 <strong>{occ.count}</strong> active task{occ.count !== 1 ? 's' : ''}</span>
                        {occ.dueSoon > 0 && <span>⏰ <strong>{occ.dueSoon}</strong> due this week</span>}
                        {occ.overdue > 0 && <span className="text-red-700 font-semibold">⚠️ {occ.overdue} overdue</span>}
                      </div>
                      {occ.count >= 3 && (
                        <p className="text-xs mt-1.5 opacity-80">
                          {meta.label} workload — consider adjusting the deadline or adding urgency context below.
                        </p>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* Urgency / context note */}
              {form.assignedToId && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Urgency / Context <span className="font-normal text-slate-400">(visible to assignee)</span>
                  </label>
                  <textarea rows={2}
                    placeholder="e.g. Customer presentation on 20th — proposal must be ready 2 days before. Happy to discuss timeline."
                    value={form.urgencyNote} onChange={e => setForm(f => ({ ...f, urgencyNote: e.target.value }))}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                  <p className="text-xs text-slate-400 mt-0.5">
                    Helps the assignee understand context before accepting or proposing an alternative date.
                  </p>
                </div>
              )}

              {formErr && <p className="text-xs text-red-600 font-medium">{formErr}</p>}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowCreate(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
                  Cancel
                </button>
                <button onClick={handleCreate} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition disabled:opacity-50">
                  {saving ? 'Creating…' : 'Create Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
