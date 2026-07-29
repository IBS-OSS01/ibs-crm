import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { notifyTaskAssigned, notifyTaskCompleted } from '../../../lib/emailNotifications'
import { useUsers } from '../../../lib/useUsers'
import UserSelector from '../../../components/common/UserSelector'

// Roles that can be assigned to a deal's team
export const TEAM_ROLES = [
  { value: 'solution_manager',  label: 'Solution Manager' },
  { value: 'sales_assistant',   label: 'Sales Assistant' },
  { value: 'project_manager',   label: 'Project Manager' },
  { value: 'service_engineer',  label: 'Service Engineer' },
  { value: 'technical_lead',    label: 'Technical Lead' },
  { value: 'bid_coordinator',   label: 'Bid Coordinator' },
]

const TASK_PRIORITY = {
  extremely_high: { label: 'Extremely High', cls: 'bg-red-100 text-red-700 border border-red-300',    dot: '🔴' },
  high:           { label: 'High',           cls: 'bg-orange-100 text-orange-700 border border-orange-300', dot: '🟠' },
  medium:         { label: 'Medium',         cls: 'bg-yellow-100 text-yellow-700 border border-yellow-300', dot: '🟡' },
  low:            { label: 'Low',            cls: 'bg-slate-100 text-slate-600 border border-slate-300',  dot: '⚪' },
}

const TASK_STATUS = {
  pending:          { label: 'Awaiting Response', cls: 'bg-amber-100 text-amber-700',  icon: '⏳' },
  accepted:         { label: 'Accepted',           cls: 'bg-blue-100  text-blue-700',   icon: '✓'  },
  counter_proposed: { label: 'Date Proposed',      cls: 'bg-purple-100 text-purple-700', icon: '↩'  },
  completed:        { label: 'Completed',          cls: 'bg-green-100 text-green-700',  icon: '✅' },
  cancelled:        { label: 'Cancelled',          cls: 'bg-slate-100 text-slate-500',  icon: '✕'  },
}

const today = () => new Date().toISOString().slice(0, 10)

export default function DealTasksModal({ deal, onClose, onDealUpdate }) {
  const { user, userProfile } = useAuth()
  const { users } = useUsers()   // zero Firestore reads — session cache
  const isAdmin   = userProfile?.role === 'admin'
  const role      = userProfile?.role || ''
  // Sales manager, project manager, sales assistant, and solution manager can create tasks
  const canManage = isAdmin || role === 'sales_manager' || role === 'project_manager'
    || role === 'sales_assistant' || role === 'solution_manager'
  const uid       = user?.uid || ''
  const myName    = userProfile?.name || userProfile?.email || uid

  const [tab, setTab]       = useState('tasks')
  const [tasks, setTasks]   = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // ── Team state ──────────────────────────────────────────────
  const [showAddMember, setShowAddMember] = useState(false)
  const [pickedUserId, setPickedUserId]   = useState(null)   // stores uid only
  const [pickedRole, setPickedRole]       = useState('')

  // ── Task creation state ─────────────────────────────────────
  const [showNewTask, setShowNewTask] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', description: '', assignedToId: '', requestedDate: '', priority: 'medium' })
  const [taskError, setTaskError] = useState('')

  // ── Counter-date state ──────────────────────────────────────
  const [counterTask, setCounterTask] = useState(null)
  const [counterDate, setCounterDate] = useState('')
  const [counterNote, setCounterNote] = useState('')

  // ── Expanded activity ───────────────────────────────────────
  const [expandedTask, setExpandedTask] = useState(null)

  const teamMembers = deal.teamMembers || []

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      // users come from session cache (useUsers) — no read here
      const tasksSnap = await getDocs(query(collection(db, 'crm_tasks'), where('dealId', '==', deal.id)))

      const tData = []
      tasksSnap.forEach(d => tData.push({ id: d.id, ...d.data() }))
      tData.sort((a, b) => {
        const ord = { pending: 0, counter_proposed: 1, accepted: 2, completed: 3, cancelled: 4 }
        return (ord[a.status] ?? 5) - (ord[b.status] ?? 5) ||
          (b.createdAt || '').localeCompare(a.createdAt || '')
      })
      setTasks(tData)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // ── TEAM ACTIONS ─────────────────────────────────────────────

  const handleAddMember = async () => {
    if (!pickedUserId || !pickedRole) return
    if (teamMembers.find(m => m.userId === pickedUserId)) return   // already added
    const pickedUser = users.find(u => u.uid === pickedUserId)
    if (!pickedUser) return
    setSaving(true)
    try {
      const newMember = {
        userId:      pickedUserId,
        userName:    pickedUser.name || pickedUser.email,
        userEmail:   pickedUser.email || '',
        roleSlug:    pickedRole,
        roleLabel:   TEAM_ROLES.find(r => r.value === pickedRole)?.label || pickedRole,
        addedAt:     new Date().toISOString(),
        addedByName: myName,
      }
      const updatedTeam = [...teamMembers, newMember]
      // Also grant deal visibility so the resource can see it in Pipeline
      const curIds = Array.isArray(deal.assignedUserIds) ? deal.assignedUserIds : []
      const assignedUserIds = curIds.includes(pickedUserId) ? curIds : [...curIds, pickedUserId]
      await updateDoc(doc(db, 'crm_deals', deal.id), { teamMembers: updatedTeam, assignedUserIds })
      onDealUpdate({ ...deal, teamMembers: updatedTeam, assignedUserIds })
      setShowAddMember(false); setPickedUserId(null); setPickedRole('')
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  const handleRemoveMember = async (memberId) => {
    const updatedTeam = teamMembers.filter(m => m.userId !== memberId)
    await updateDoc(doc(db, 'crm_deals', deal.id), { teamMembers: updatedTeam })
    onDealUpdate({ ...deal, teamMembers: updatedTeam })
  }

  // ── TASK HELPERS ─────────────────────────────────────────────

  const stamp = (type, note) => ({
    type, by: myName, at: new Date().toISOString(), note,
  })

  const patchTask = async (task, update) => {
    const full = { ...update, updatedAt: new Date().toISOString() }
    await updateDoc(doc(db, 'crm_tasks', task.id), full)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...full } : t))
  }

  // ── TASK CREATION ─────────────────────────────────────────────

  const handleCreateTask = async () => {
    if (!taskForm.title.trim() || !taskForm.assignedToId || !taskForm.requestedDate) {
      setTaskError('Title, assignee and requested date are all required.')
      return
    }
    setSaving(true); setTaskError('')
    try {
      const assignable = getAssignable()
      const member = assignable.find(m => m.userId === taskForm.assignedToId) || {}
      const newTask = {
        dealId:          deal.id,
        dealTitle:       deal.title || '',
        company:         deal.company || 'UIPL',
        title:           taskForm.title.trim(),
        description:     taskForm.description.trim(),
        priority:        taskForm.priority || 'medium',
        assignedToId:    taskForm.assignedToId,
        assignedToName:  member.userName || taskForm.assignedToId,
        requestedById:   uid,
        requestedByName: myName,
        requestedDate:   taskForm.requestedDate,
        status:          'pending',
        counterDate:     '',
        counterNote:     '',
        resolvedDate:    taskForm.requestedDate,
        activity:        [stamp('created', `Task created. Deadline requested: ${taskForm.requestedDate}`)],
        createdAt:       new Date().toISOString(),
        updatedAt:       new Date().toISOString(),
        completedAt:     null,
      }
      const ref = await addDoc(collection(db, 'crm_tasks'), newTask)
      setTasks(prev => [{ id: ref.id, ...newTask }, ...prev])
      setShowNewTask(false)
      setTaskForm({ title: '', description: '', assignedToId: '', requestedDate: '', priority: 'medium' })

      // ── Email: notify assignee ──────────────────────────────────────────
      const assigneeUser = users.find(u => u.uid === taskForm.assignedToId)
      if (assigneeUser?.email) {
        notifyTaskAssigned({ ...newTask, id: ref.id }, assigneeUser.email)
      }
    } catch (e) { setTaskError(e.message) }
    finally { setSaving(false) }
  }

  // ── TASK RESPONSES ────────────────────────────────────────────

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

  const handleAcceptCounter = (task) => patchTask(task, {
    status: 'accepted', resolvedDate: task.counterDate,
    activity: [...(task.activity || []), stamp('counter_accepted', `Counter date accepted: ${task.counterDate}`)],
  })

  const handleComplete = async (task) => {
    await patchTask(task, {
      status: 'completed', completedAt: new Date().toISOString(),
      activity: [...(task.activity || []), stamp('completed', 'Task marked as completed')],
    })
    // ── Email: notify task creator that work is done ──────────────────────
    const creatorUser = allUsers.find(u => u.id === task.requestedById)
    if (creatorUser?.email) {
      notifyTaskCompleted(task, creatorUser.email)
    }
  }

  const handleCancelTask = (task) => patchTask(task, {
    status: 'cancelled',
    activity: [...(task.activity || []), stamp('cancelled', 'Task cancelled by requester')],
  })

  // ── HELPERS ───────────────────────────────────────────────────

  const getAssignable = () => {
    const list = [...teamMembers]
    if (deal.salesManagerId && !list.find(m => m.userId === deal.salesManagerId)) {
      list.unshift({ userId: deal.salesManagerId, userName: deal.salesManagerName || 'Sales Manager', roleLabel: 'Sales Manager' })
    }
    return list.filter((m, i, a) => a.findIndex(x => x.userId === m.userId) === i)
  }

  const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
  const doneTasks   = tasks.filter(t => t.status === 'completed' || t.status === 'cancelled')

  const taskCount = tasks.filter(t => t.status !== 'cancelled').length

  // ── RENDER ────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Team & Tasks</h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-sm truncate">{deal.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none ml-4">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-slate-100 px-5 flex-shrink-0">
          {[
            { id: 'tasks', label: `Tasks (${taskCount})` },
            { id: 'team',  label: `Team (${teamMembers.length + 1})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`py-2.5 px-1 mr-6 text-sm font-medium border-b-2 transition
                ${tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4 min-h-0">
          {loading ? (
            <div className="text-center text-slate-400 py-8 text-sm">Loading…</div>
          ) : tab === 'team' ? (

            /* ──────────────── TEAM TAB ──────────────── */
            <div className="space-y-3">
              {/* Sales manager (always first) */}
              <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {(deal.salesManagerName || 'S').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{deal.salesManagerName || 'Sales Manager'}</p>
                  <p className="text-xs text-indigo-600 font-medium">⭐ Sales Manager (Opportunity Owner)</p>
                </div>
              </div>

              {/* Team members */}
              {teamMembers.length === 0 && !showAddMember && (
                <p className="text-sm text-slate-400 text-center py-4">No additional team members assigned yet.</p>
              )}
              {teamMembers.map(m => (
                <div key={m.userId} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="w-8 h-8 rounded-full bg-slate-400 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {(m.userName || m.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{m.userName || m.name || '—'}</p>
                    <p className="text-xs text-slate-500">
                      {m.roleLabel || ''}
                      {m.addedByName ? ` · added by ${m.addedByName}` : ''}
                    </p>
                  </div>
                  {canManage && (
                    <button onClick={() => handleRemoveMember(m.userId)}
                      className="text-xs text-red-400 hover:text-red-600 transition flex-shrink-0">Remove</button>
                  )}
                </div>
              ))}

              {/* Add member form */}
              {showAddMember ? (
                <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
                  <p className="text-sm font-bold text-blue-800">Add Team Member</p>
                  <UserSelector
                    value={pickedUserId}
                    onChange={setPickedUserId}
                    placeholder="Search name, role or department…"
                    filters={{ company: deal.company }}
                  />
                  <select value={pickedRole} onChange={e => setPickedRole(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                    <option value="">— Select role for this opportunity —</option>
                    {TEAM_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={handleAddMember} disabled={!pickedUserId || !pickedRole || saving}
                      className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                      {saving ? 'Adding…' : 'Add Member'}
                    </button>
                    <button onClick={() => { setShowAddMember(false); setPickedUserId(null); setPickedRole('') }}
                      className="px-4 py-1.5 bg-white text-slate-600 text-sm rounded-lg border border-slate-300 hover:bg-slate-50 transition">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : canManage && (
                <button onClick={() => setShowAddMember(true)}
                  className="w-full py-2 border-2 border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-600 rounded-xl text-sm transition">
                  + Add Team Member
                </button>
              )}
            </div>

          ) : (

            /* ──────────────── TASKS TAB ──────────────── */
            <div className="space-y-3">

              {/* New Task button */}
              {canManage && !showNewTask && (
                <button onClick={() => setShowNewTask(true)}
                  className="w-full py-2 border-2 border-dashed border-blue-300 text-blue-500 hover:border-blue-500 hover:text-blue-700 rounded-xl text-sm font-medium transition">
                  + Create New Task
                </button>
              )}

              {/* New Task form */}
              {showNewTask && (
                <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
                  <p className="text-sm font-bold text-blue-800">New Task</p>
                  {taskError && <p className="text-xs text-red-600">{taskError}</p>}
                  <input type="text" value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="Task title *"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" autoFocus />
                  <textarea value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Description / instructions (optional)" rows={2}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white resize-none" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Assign To *</label>
                      <select value={taskForm.assignedToId} onChange={e => setTaskForm(p => ({ ...p, assignedToId: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                        <option value="">— Select person —</option>
                        {getAssignable().map(m => (
                          <option key={m.userId} value={m.userId}>{m.userName} ({m.roleLabel})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Requested Completion *</label>
                      <input type="date" value={taskForm.requestedDate} min={today()}
                        onChange={e => setTaskForm(p => ({ ...p, requestedDate: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Priority</label>
                    <select value={taskForm.priority} onChange={e => setTaskForm(p => ({ ...p, priority: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                      <option value="extremely_high">🔴 Extremely High</option>
                      <option value="high">🟠 High</option>
                      <option value="medium">🟡 Medium</option>
                      <option value="low">⚪ Low</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleCreateTask} disabled={saving}
                      className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                      {saving ? 'Creating…' : 'Create Task'}
                    </button>
                    <button onClick={() => { setShowNewTask(false); setTaskForm({ title: '', description: '', assignedToId: '', requestedDate: '', priority: 'medium' }); setTaskError('') }}
                      className="px-4 py-1.5 bg-white text-slate-600 text-sm rounded-lg border border-slate-300 hover:bg-slate-50 transition">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Active tasks */}
              {activeTasks.length === 0 && doneTasks.length === 0 && !showNewTask && (
                <div className="text-center py-8 text-slate-400 text-sm">
                  No tasks yet. {canManage ? 'Create the first task above.' : 'Your sales manager will assign tasks here.'}
                </div>
              )}

              {activeTasks.map(task => {
                const st = TASK_STATUS[task.status] || TASK_STATUS.pending
                const isAssignee  = task.assignedToId === uid
                const isRequester = task.requestedById === uid
                const isCountering = counterTask?.id === task.id
                const isExpanded  = expandedTask === task.id

                return (
                  <div key={task.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                              {st.icon} {st.label}
                            </span>
                            {task.priority && TASK_PRIORITY[task.priority] && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${TASK_PRIORITY[task.priority].cls}`}>
                                {TASK_PRIORITY[task.priority].dot} {TASK_PRIORITY[task.priority].label}
                              </span>
                            )}
                            <span className="text-xs text-slate-400">#{task.id.slice(-4)}</span>
                          </div>
                          <p className="text-sm font-semibold text-slate-800 mt-1">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-slate-500 mt-0.5">{task.description}</p>
                          )}
                        </div>
                        <button onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                          className="text-xs text-slate-400 hover:text-slate-600 flex-shrink-0">
                          {isExpanded ? '▲' : '▼'}
                        </button>
                      </div>

                      {/* Dates & people */}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>👤 <strong>{task.assignedToName}</strong></span>
                        <span>📋 By: {task.requestedByName}</span>
                        <span className={`font-medium ${task.requestedDate < today() && task.status !== 'completed' ? 'text-red-600' : 'text-slate-600'}`}>
                          📅 Requested: {task.requestedDate}
                          {task.requestedDate < today() && task.status !== 'completed' ? ' ⚠' : ''}
                        </span>
                        {task.status === 'counter_proposed' && (
                          <span className="text-purple-600 font-medium">↩ Proposed: {task.counterDate}</span>
                        )}
                        {task.status === 'accepted' && task.resolvedDate && task.resolvedDate !== task.requestedDate && (
                          <span className="text-green-600 font-medium">✓ Agreed: {task.resolvedDate}</span>
                        )}
                      </div>

                      {/* Counter note */}
                      {task.status === 'counter_proposed' && task.counterNote && (
                        <p className="mt-1 text-xs text-purple-700 bg-purple-50 px-2 py-1 rounded-lg">
                          "{task.counterNote}"
                        </p>
                      )}

                      {/* Action buttons */}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {/* Resource actions */}
                        {isAssignee && task.status === 'pending' && !isCountering && (
                          <>
                            <button onClick={() => handleAccept(task)}
                              className="px-3 py-1 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
                              ✓ Accept Deadline
                            </button>
                            <button onClick={() => { setCounterTask(task); setCounterDate(''); setCounterNote('') }}
                              className="px-3 py-1 text-xs font-semibold bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition">
                              ↩ Propose New Date
                            </button>
                          </>
                        )}
                        {isAssignee && task.status === 'accepted' && (
                          <button onClick={() => handleComplete(task)}
                            className="px-3 py-1 text-xs font-semibold bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition">
                            ✅ Mark Complete
                          </button>
                        )}
                        {/* Requester actions when resource proposed a date */}
                        {isRequester && task.status === 'counter_proposed' && (
                          <>
                            <button onClick={() => handleAcceptCounter(task)}
                              className="px-3 py-1 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
                              ✓ Accept {task.counterDate}
                            </button>
                            <button onClick={() => handleCancelTask(task)}
                              className="px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-600 rounded-lg hover:bg-red-100 hover:text-red-600 transition">
                              ✕ Cancel Task
                            </button>
                          </>
                        )}
                        {/* Requester can cancel pending tasks */}
                        {isRequester && task.status === 'pending' && (
                          <button onClick={() => handleCancelTask(task)}
                            className="px-3 py-1 text-xs text-slate-400 hover:text-red-500 rounded-lg transition">
                            ✕ Cancel
                          </button>
                        )}
                      </div>

                      {/* Counter date form */}
                      {isCountering && (
                        <div className="mt-3 pt-3 border-t border-purple-200 space-y-2 bg-purple-50 -mx-3 -mb-3 px-3 pb-3">
                          <p className="text-xs font-semibold text-purple-800">Propose a different completion date</p>
                          <div className="grid grid-cols-2 gap-2">
                            <input type="date" value={counterDate} min={today()}
                              onChange={e => setCounterDate(e.target.value)}
                              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
                            <input type="text" value={counterNote}
                              onChange={e => setCounterNote(e.target.value)}
                              placeholder="Reason (optional)"
                              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={handleCounterSubmit} disabled={!counterDate}
                              className="px-3 py-1 text-xs font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50">
                              Submit Proposal
                            </button>
                            <button onClick={() => setCounterTask(null)}
                              className="px-3 py-1 text-xs text-slate-500 rounded-lg hover:bg-white transition">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Activity log (expanded) */}
                    {isExpanded && (task.activity || []).length > 0 && (
                      <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 space-y-1">
                        <p className="text-xs font-semibold text-slate-500 mb-1">Activity</p>
                        {[...(task.activity || [])].reverse().map((a, i) => (
                          <div key={i} className="flex gap-2 text-xs text-slate-600">
                            <span className="text-slate-400 flex-shrink-0">{a.at ? new Date(a.at).toLocaleDateString('en-IN') : '—'}</span>
                            <span><strong>{a.by}</strong> — {a.note}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Completed / Cancelled */}
              {doneTasks.length > 0 && (
                <details className="group">
                  <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none py-1">
                    ▶ Show {doneTasks.length} completed/cancelled task{doneTasks.length !== 1 ? 's' : ''}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {doneTasks.map(task => {
                      const st = TASK_STATUS[task.status] || TASK_STATUS.completed
                      return (
                        <div key={task.id} className="border border-slate-100 rounded-xl p-3 bg-slate-50 opacity-75">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.icon} {st.label}</span>
                            <span className="text-sm text-slate-600 font-medium">{task.title}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-400 flex gap-4">
                            <span>👤 {task.assignedToName}</span>
                            {task.completedAt && <span>✅ {new Date(task.completedAt).toLocaleDateString('en-IN')}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}