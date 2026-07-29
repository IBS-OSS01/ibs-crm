/**
 * TaskQuickAdd — lightweight floating modal to create a task from any module.
 * Includes assignee occupancy view and urgency comment field.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { collection, addDoc, serverTimestamp, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../lib/firebase-config'
import { useAuth } from '../../context/AuthContext'
import { notifyTaskAssigned } from '../../lib/emailNotifications'
import { useUsers } from '../../lib/useUsers'
import UserSelector from '../common/UserSelector'

const OPEN_STAGES   = ['lead', 'prebid', 'bid', 'closing']
const ACTIVE_STATUSES = ['pending', 'accepted', 'in_progress']
const PRIORITY_OPTS = [
  { value: 'extremely_high', label: 'Extremely High' },
  { value: 'high',           label: 'High' },
  { value: 'medium',         label: 'Medium' },
  { value: 'low',            label: 'Low' },
]

function occupancyMeta(count) {
  if (count === 0) return { label: 'Free',   color: 'bg-green-100 text-green-700',  dot: 'bg-green-500' }
  if (count <= 2)  return { label: 'Low',    color: 'bg-green-100 text-green-700',  dot: 'bg-green-500' }
  if (count <= 5)  return { label: 'Medium', color: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500' }
  return              { label: 'High',   color: 'bg-red-100 text-red-700',    dot: 'bg-red-500' }
}

export default function TaskQuickAdd({ onClose }) {
  const { user, userProfile } = useAuth()
  const { users } = useUsers()   // zero Firestore reads — served from session cache

  const [deals,    setDeals]    = useState([])
  const [projects, setProjects] = useState([])
  const [allTasks, setAllTasks] = useState([])   // for occupancy calculation

  const [form, setForm] = useState({
    type: 'general', title: '', description: '',
    priority: 'medium', dueDate: '',
    assignedToId: '', dealId: '', projectId: '',
    urgencyNote: '',                               // why urgent / context for assignee
  })
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const [done,   setDone]   = useState(false)

  useEffect(() => {
    // users — served from session cache (no Firestore read here)
    getDocs(query(collection(db, 'crm_deals'), where('stage', 'in', OPEN_STAGES))).then(snap =>
      setDeals(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    getDocs(query(collection(db, 'projects'), where('status', 'in', ['active', 'in_progress']))).then(snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    // Load all active tasks for occupancy
    getDocs(query(collection(db, 'tasks'), where('status', 'in', ACTIVE_STATUSES))).then(snap =>
      setAllTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    // Also load crm_tasks for occupancy
    getDocs(query(collection(db, 'crm_tasks'), where('status', 'in', ['pending', 'accepted', 'counter_proposed']))).then(snap =>
      setAllTasks(prev => [...prev, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))])
    ).catch(() => {})
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Compute occupancy for selected assignee
  const assigneeOccupancy = useMemo(() => {
    if (!form.assignedToId) return null
    const today = new Date().toISOString().slice(0, 10)
    const active = allTasks.filter(t => t.assignedToId === form.assignedToId)
    const dueSoon = active.filter(t => t.dueDate && t.dueDate <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
    const overdue = active.filter(t => t.dueDate && t.dueDate < today)
    return { count: active.length, dueSoon: dueSoon.length, overdue: overdue.length, tasks: active }
  }, [form.assignedToId, allTasks])

  const handleSave = async () => {
    if (!form.title.trim())                         return setErr('Title is required.')
    if (!form.assignedToId)                         return setErr('Select an assignee.')
    if (form.type === 'opportunity'    && !form.dealId)    return setErr('Select a opportunity.')
    if (form.type === 'project' && !form.projectId) return setErr('Select a project.')

    setSaving(true); setErr('')
    try {
      const assignee = users.find(u => u.uid === form.assignedToId)
      const deal     = deals.find(d => d.id === form.dealId)
      const proj     = projects.find(p => p.id === form.projectId)

      const taskDoc = {
        type:            form.type,
        title:           form.title.trim(),
        description:     form.description.trim(),
        urgencyNote:     form.urgencyNote.trim(),
        priority:        form.priority,
        status:          'pending',
        dueDate:         form.dueDate || null,
        assignedToId:    form.assignedToId,
        assignedToName:  assignee?.name || assignee?.email || '',
        assignedToEmail: assignee?.email || '',
        createdById:     user?.uid,
        createdByName:   userProfile?.name || user?.email,
        dealId:          form.type === 'opportunity'    ? form.dealId    : null,
        dealTitle:       form.type === 'opportunity'    ? (deal?.title || deal?.name || form.dealId) : null,
        projectId:       form.type === 'project' ? form.projectId : null,
        projectTitle:    form.type === 'project' ? (proj?.name || proj?.title || form.projectId) : null,
        company:         form.type === 'opportunity'    ? (deal?.company || null) : null,
        activity:        [],
        createdAt:       serverTimestamp(),
        updatedAt:       serverTimestamp(),
        completedAt:     null,
      }

      await addDoc(collection(db, 'tasks'), taskDoc)

      notifyTaskAssigned(
        { ...taskDoc, requestedByName: taskDoc.createdByName,
          requestedDate: form.dueDate || '—',
          dealTitle: taskDoc.dealTitle || taskDoc.projectTitle || 'N/A' },
        assignee?.email || ''
      )

      setDone(true)
      setTimeout(onClose, 1200)
    } catch (e) {
      console.error(e)
      setErr('Failed to create task.')
    } finally { setSaving(false) }
  }

  const occ = assigneeOccupancy
  const occMeta = occ ? occupancyMeta(occ.count) : null

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-800">✅ Quick Add Task</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        {done ? (
          <div className="p-8 text-center text-green-600 font-semibold">
            <p className="text-3xl mb-2">✅</p>Task created!
          </div>
        ) : (
          <div className="p-5 space-y-4">

            {/* Type */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Task Type</label>
              <div className="flex gap-2">
                {[['general','🗒️ General'],['opportunity','📊 Opportunity'],['project','📁 Project']].map(([v, l]) => (
                  <button key={v} onClick={() => set('type', v)}
                    className={`flex-1 py-1.5 px-1 rounded-xl text-xs font-semibold border transition ${
                      form.type === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                    }`}>{l}</button>
                ))}
              </div>
            </div>

            {/* Deal / Project picker */}
            {form.type === 'opportunity' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Active Opportunity *</label>
                <select value={form.dealId} onChange={e => set('dealId', e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Select opportunity —</option>
                  {deals.map(d => <option key={d.id} value={d.id}>{d.title || d.name}</option>)}
                </select>
              </div>
            )}
            {form.type === 'project' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Active Project *</label>
                <select value={form.projectId} onChange={e => set('projectId', e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Select project —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name || p.title}</option>)}
                </select>
              </div>
            )}

            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
              <input type="text" placeholder="What needs to be done?"
                value={form.title} onChange={e => set('title', e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
              <textarea rows={2} placeholder="Optional details…"
                value={form.description} onChange={e => set('description', e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>

            {/* Priority + Due date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Priority</label>
                <select value={form.priority} onChange={e => set('priority', e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {PRIORITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Requested Deadline</label>
                <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {/* Assignee + Occupancy */}
            <div>
              <UserSelector
                label="Assign To"
                value={form.assignedToId || null}
                onChange={uid => set('assignedToId', uid || '')}
                placeholder="Search by name, role or department…"
                required
              />

              {/* Occupancy panel — shown once assignee is selected */}
              {occ && occMeta && (
                <div className={`mt-2 rounded-xl border px-3 py-2.5 ${occMeta.color} border-current/20`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold">Current Task Load</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${occMeta.color}`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${occMeta.dot} mr-1`} />
                      {occMeta.label} Occupancy
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span>📋 <strong>{occ.count}</strong> active task{occ.count !== 1 ? 's' : ''}</span>
                    {occ.dueSoon > 0 && <span>⏰ <strong>{occ.dueSoon}</strong> due this week</span>}
                    {occ.overdue > 0 && <span className="text-red-700 font-semibold">⚠️ {occ.overdue} overdue</span>}
                  </div>
                  {occ.count >= 3 && (
                    <p className="text-xs mt-1.5 opacity-80">
                      This person has a {occMeta.label.toLowerCase()} workload. Consider adjusting the deadline or adding urgency context below.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Urgency Note — always visible once assignee picked */}
            {form.assignedToId && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Urgency / Context <span className="font-normal text-slate-400">(visible to assignee)</span>
                </label>
                <textarea rows={2}
                  placeholder="e.g. Customer presentation on 20th — proposal must be ready 2 days before. Happy to discuss timeline."
                  value={form.urgencyNote} onChange={e => set('urgencyNote', e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                <p className="text-xs text-slate-400 mt-0.5">
                  This helps the assignee understand the business context before accepting or counter-proposing a date.
                </p>
              </div>
            )}

            {err && <p className="text-xs text-red-600 font-medium">{err}</p>}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition disabled:opacity-50">
                {saving ? 'Creating…' : 'Create Task'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
