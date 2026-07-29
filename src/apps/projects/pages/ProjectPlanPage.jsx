/**
 * ProjectPlanPage.jsx
 * Full project execution planning: WBS · Gantt · Critical Path · Resources
 * Opened from ProjectRegister when user clicks "📋 Plan" on a row.
 * Data stored in Firestore `project_plan_tasks` collection (linked by projectId).
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, getDoc, collection, query, where, getDocs,
  addDoc, updateDoc, deleteDoc, writeBatch, setDoc,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { notifyProjectTaskAssigned, sendProjectTaskReminder } from '../../../lib/projectNotifications'
import { usePeople } from '../../../lib/usePeople'
import PeoplePicker from '../../../components/common/PeoplePicker'
import { useUsers } from '../../../lib/useUsers'
import UserSelector from '../../../components/common/UserSelector'

// ── Token generator ───────────────────────────────────────────────────────────
const genToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)))
  .map(b => b.toString(16).padStart(2, '0')).join('')

// ── Resource helpers (handles both legacy string[] and new {email,token}[]) ───
const rLabel  = (r) => typeof r === 'string' ? r : (r.name && r.name !== r.email ? r.name : r.email || '?')
const rEmail  = (r) => typeof r === 'string' ? (r.includes('@') ? r : null) : r.email
const rToken  = (r) => typeof r === 'string' ? null : r.token

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000))
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const dateColour = (start, end) => {
  const now = new Date().toISOString().slice(0, 10)
  if (end < now) return 'bg-red-500'     // overdue
  if (start <= now) return 'bg-blue-500' // in progress
  return 'bg-slate-400'                   // upcoming
}

// ── CPM (Critical Path Method) ───────────────────────────────────────────────
function computeCPM(tasks) {
  if (!tasks.length) return tasks
  const map = Object.fromEntries(tasks.map(t => [t.id, { ...t, es: 0, ef: 0, ls: 0, lf: 0, float: 0, critical: false }]))

  // Topological sort
  const visited = new Set(); const order = []
  const visit = (id) => {
    if (visited.has(id)) return; visited.add(id)
    ;(map[id]?.predecessors || []).forEach(p => visit(p.id))
    order.push(id)
  }
  Object.keys(map).forEach(id => visit(id))

  // Forward pass
  order.forEach(id => {
    const t = map[id]
    const predFinishes = (t.predecessors || []).map(p => (map[p.id]?.ef || 0) + (p.lag || 0))
    t.es = predFinishes.length ? Math.max(...predFinishes) : 0
    t.ef = t.es + (t.duration || 0)
  })

  const projectEnd = Math.max(...Object.values(map).map(t => t.ef), 0)

  // Backward pass (reverse order)
  ;[...order].reverse().forEach(id => {
    const t = map[id]
    const sucLs = Object.values(map)
      .filter(s => (s.predecessors || []).some(p => p.id === id))
      .map(s => s.ls - ((s.predecessors.find(p => p.id === id)?.lag) || 0))
    t.lf = sucLs.length ? Math.min(...sucLs) : projectEnd
    t.ls = t.lf - (t.duration || 0)
    t.float = t.ls - t.es
    t.critical = t.float === 0 && (t.duration || 0) > 0
  })

  return Object.values(map)
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ROLES = ['Project Manager','Site Engineer','Electrical Engineer','Software Engineer','Commissioning Engineer','Procurement','Design','QA/QC','Civil','Installation','Client']
const LEVEL_CLS = { 1: 'font-bold text-slate-900 bg-slate-50', 2: 'font-semibold text-slate-700', 3: 'text-slate-600' }
const LEVEL_PL  = { 1: 'pl-2', 2: 'pl-8', 3: 'pl-14' }
const inp = 'px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500'

// ── Sub-component: WBS Editor ─────────────────────────────────────────────────
function WBSEditor({ tasks, projectId, projectName, projectStartDate, onTasksChange, canEdit, resourceFilter, onResourceFilterChange, publicLinks }) {
  const [editing, setEditing]     = useState(null)
  const [editForm, setEditForm]   = useState({})
  const [adding, setAdding]       = useState(null)
  const [addForm, setAddForm]     = useState({ title: '', startDate: '', endDate: '', durationDays: 0, resources: [], progress: 0 })
  const [addingRes, setAddingRes] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const { people } = usePeople()

  // All unique resource labels across all tasks (for filter dropdown)
  const allResourceLabels = useMemo(() => {
    const set = new Set()
    tasks.forEach(t => (t.resources || []).forEach(r => { const lbl = rLabel(r); if (lbl) set.add(lbl) }))
    return [...set].sort()
  }, [tasks])

  const nextWbs = (level, parentId) => {
    const siblings = tasks.filter(t => t.level === level && t.parentId === parentId)
    if (level === 1) return `${tasks.filter(t => t.level === 1).length + 1}`
    const parent = tasks.find(t => t.id === parentId)
    if (!parent) return '?'
    if (level === 2) return `${parent.wbsCode}.${siblings.length + 1}`
    const grandparent = tasks.find(t => t.id === parent.parentId)
    return `${parent.wbsCode}.${siblings.length + 1}`
  }

  // ── Add resource by person object {name, email} (creates public link + sends email) ──
  const handleAddResource = async (person, taskId, taskTitle, wbsCode, endDate, isNewTask = false) => {
    const email = (person?.email || '').trim().toLowerCase()
    if (!email || !email.includes('@')) return
    setAddingRes(true)
    try {
      const token = genToken()
      // Create public link document (token is the doc ID)
      await setDoc(doc(db, 'public_task_links', token), {
        taskId:        taskId || '__pending__',
        projectId,
        projectName:   projectName || '',
        taskTitle,
        wbsCode:       wbsCode || '',
        endDate:       endDate || '',
        assigneeEmail: email,
        assigneeName:  person?.name || email,
        status:        'pending',
        statusNote:    '',
        updatedAt:     new Date().toISOString(),
        createdAt:     new Date().toISOString(),
      })
      // Send assignment email
      notifyProjectTaskAssigned({ taskTitle, wbsCode, projectName, deadline: endDate, token, toEmail: email })

      const newRes = { name: person?.name || email, email, token, addedAt: new Date().toISOString() }
      if (isNewTask) {
        setAddForm(p => ({ ...p, resources: [...p.resources, newRes] }))
      } else {
        // Update existing task in Firestore immediately
        const updatedResources = [...(tasks.find(t => t.id === taskId)?.resources || []), newRes]
        await updateDoc(doc(db, 'project_plan_tasks', taskId), { resources: updatedResources, updatedAt: new Date().toISOString() })
        // If we have a token in public_task_links, update the taskId now
        await updateDoc(doc(db, 'public_task_links', token), { taskId })
        onTasksChange(tasks.map(t => t.id === taskId ? { ...t, resources: updatedResources } : t))
        setEditForm(p => ({ ...p, resources: updatedResources }))
      }
      setNewResEmail('')
    } catch (e) { setError('Failed to add resource: ' + e.message) }
    finally { setAddingRes(false) }
  }

  // ── Remove resource (keeps public link but removes from task) ─────────────────
  const handleRemoveResource = (idx, isEditForm = true) => {
    if (isEditForm) {
      setEditForm(p => ({ ...p, resources: p.resources.filter((_, i) => i !== idx) }))
    } else {
      setAddForm(p => ({ ...p, resources: p.resources.filter((_, i) => i !== idx) }))
    }
  }

  const handleAdd = async () => {
    if (!addForm.title.trim() || !addForm.startDate || !addForm.endDate) {
      setError('Title, start date and end date are required.'); return
    }
    setSaving(true); setError('')
    try {
      const wbs = nextWbs(adding.level, adding.parentId)
      const duration = daysBetween(addForm.startDate, addForm.endDate)
      const newTask = {
        projectId,
        wbsCode:     wbs,
        title:       addForm.title.trim(),
        level:       adding.level,
        parentId:    adding.parentId || null,
        startDate:   addForm.startDate,
        endDate:     addForm.endDate,
        duration,
        predecessors:[],
        resources:   addForm.resources || [],
        progress:    Number(addForm.progress) || 0,
        isMilestone: false,
        order:       tasks.filter(t => t.parentId === (adding.parentId || null)).length,
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
      }
      const ref = await addDoc(collection(db, 'project_plan_tasks'), newTask)
      // Update public_task_links with the real taskId now that we have it
      for (const r of newTask.resources) {
        if (r.token) {
          updateDoc(doc(db, 'public_task_links', r.token), { taskId: ref.id }).catch(() => {})
        }
      }
      onTasksChange([...tasks, { id: ref.id, ...newTask }])
      setAdding(null)
      setAddForm({ title: '', startDate: '', endDate: '', durationDays: 0, resources: [], progress: 0 })
      setNewResEmail('')
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleEdit = async () => {
    setSaving(true); setError('')
    try {
      const duration = daysBetween(editForm.startDate, editForm.endDate)
      const updates = {
        title:     editForm.title,
        startDate: editForm.startDate,
        endDate:   editForm.endDate,
        duration,
        resources: editForm.resources || [],
        progress:  Number(editForm.progress) || 0,
        updatedAt: new Date().toISOString(),
      }
      await updateDoc(doc(db, 'project_plan_tasks', editing), updates)
      onTasksChange(tasks.map(t => t.id === editing ? { ...t, ...updates } : t))
      setEditing(null)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    const t = tasks.find(x => x.id === id)
    const children = tasks.filter(x => x.parentId === id)
    if (children.length && !window.confirm(`Delete "${t.title}" and all its ${children.length} sub-task(s)?`)) return
    if (!children.length && !window.confirm(`Delete "${t.title}"?`)) return
    const toDelete = [id, ...children.map(c => c.id), ...tasks.filter(x => children.find(c => c.id === x.parentId)).map(x => x.id)]
    const batch = writeBatch(db)
    toDelete.forEach(did => batch.delete(doc(db, 'project_plan_tasks', did)))
    await batch.commit()
    onTasksChange(tasks.filter(t => !toDelete.includes(t.id)))
  }

  const handlePredecessorToggle = async (taskId, predId) => {
    const t = tasks.find(x => x.id === taskId)
    if (!t) return
    const existing = t.predecessors || []
    const newPreds = existing.some(p => p.id === predId)
      ? existing.filter(p => p.id !== predId)
      : [...existing, { id: predId, lag: 0 }]
    await updateDoc(doc(db, 'project_plan_tasks', taskId), { predecessors: newPreds, updatedAt: new Date().toISOString() })
    onTasksChange(tasks.map(t => t.id === taskId ? { ...t, predecessors: newPreds } : t))
  }

  // Ordered task list (phases first, then children under each phase)
  const ordered = useMemo(() => {
    const phases = tasks.filter(t => t.level === 1).sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''))
    const result = []
    phases.forEach(ph => {
      result.push(ph)
      const children = tasks.filter(t => t.parentId === ph.id).sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''))
      children.forEach(ch => {
        result.push(ch)
        const grandchildren = tasks.filter(t => t.parentId === ch.id).sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''))
        grandchildren.forEach(gc => result.push(gc))
      })
    })
    return result
  }, [tasks])

  // filtered ordered list
  const filteredOrdered = useMemo(() => {
    const phases = tasks.filter(t => t.level === 1).sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''))
    const result = []
    phases.forEach(ph => {
      const phChildren = tasks.filter(t => t.parentId === ph.id).sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''))
      const phMatchOrHasMatch = !resourceFilter || (ph.resources || []).some(r => rLabel(r) === resourceFilter) ||
        phChildren.some(ch => (ch.resources || []).some(r => rLabel(r) === resourceFilter) ||
          tasks.filter(t => t.parentId === ch.id).some(gc => (gc.resources || []).some(r => rLabel(r) === resourceFilter)))
      if (!phMatchOrHasMatch) return
      result.push(ph)
      phChildren.forEach(ch => {
        const chChildren = tasks.filter(t => t.parentId === ch.id).sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''))
        const chMatch = !resourceFilter || (ch.resources || []).some(r => rLabel(r) === resourceFilter) ||
          chChildren.some(gc => (gc.resources || []).some(r => rLabel(r) === resourceFilter))
        if (!chMatch) return
        result.push(ch)
        chChildren.forEach(gc => {
          if (!resourceFilter || (gc.resources || []).some(r => rLabel(r) === resourceFilter)) result.push(gc)
        })
      })
    })
    return result
  }, [tasks, resourceFilter])

  return (
    <div className="space-y-3">
      {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {/* Toolbar: Add Phase + Resource filter */}
      <div className="flex items-center gap-3 flex-wrap">
        {canEdit && (
          <button
            onClick={() => { setAdding({ level: 1, parentId: null }); setAddForm({ title: '', startDate: projectStartDate || '', endDate: '', durationDays: 0, resources: [], progress: 0 }) }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
          >+ Add Phase</button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-slate-500 font-medium">Filter by resource:</span>
          <select value={resourceFilter} onChange={e => onResourceFilterChange(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white">
            <option value="">All resources</option>
            {allResourceLabels.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {resourceFilter && (
            <button onClick={() => onResourceFilterChange('')} className="text-xs text-red-500 hover:text-red-700">✕ Clear</button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 w-8">#</th>
              <th className="text-left px-4 py-2.5">Task / Phase</th>
              <th className="text-left px-3 py-2.5 w-28">Start</th>
              <th className="text-left px-3 py-2.5 w-28">End</th>
              <th className="text-center px-3 py-2.5 w-20">Days</th>
              <th className="text-left px-3 py-2.5 w-40">Resources</th>
              <th className="text-center px-3 py-2.5 w-24">Progress</th>
              <th className="text-left px-3 py-2.5 w-32">Predecessors</th>
              <th className="text-left px-3 py-2.5 w-32">Successors</th>
              {canEdit && <th className="px-3 py-2.5 w-24"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrdered.length === 0 && !adding && (
              <tr><td colSpan={10} className="text-center py-10 text-slate-400">
                {resourceFilter ? `No tasks assigned to "${resourceFilter}".` : 'No tasks yet. Add a phase to get started.'}
              </td></tr>
            )}
            {filteredOrdered.map(t => (
              <React.Fragment key={t.id}>
                {editing === t.id ? (
                  <tr className="bg-blue-50">
                    <td className="px-4 py-2 text-xs font-mono text-slate-400">{t.wbsCode}</td>
                    <td className={`px-4 py-2 ${LEVEL_PL[t.level]}`}>
                      <input className={inp + ' w-full'} value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2"><input type="date" className={inp} value={editForm.startDate} onChange={e => setEditForm(p => ({ ...p, startDate: e.target.value, endDate: p.durationDays ? addDays(e.target.value, p.durationDays) : p.endDate }))} /></td>
                    <td className="px-3 py-2"><input type="date" className={inp} value={editForm.endDate} onChange={e => setEditForm(p => ({ ...p, endDate: e.target.value, durationDays: daysBetween(p.startDate, e.target.value) }))} /></td>
                    <td className="px-3 py-2">
                      <input type="number" className={inp + ' w-16'} min="0" value={editForm.durationDays ?? daysBetween(editForm.startDate, editForm.endDate)}
                        onChange={e => {
                          const d = Number(e.target.value)
                          setEditForm(p => ({ ...p, durationDays: d, endDate: p.startDate ? addDays(p.startDate, d) : p.endDate }))
                        }} />
                    </td>
                    <td className="px-3 py-2 min-w-[200px]">
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {(editForm.resources || []).map((r, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium">
                            {rLabel(r)}
                            <button type="button" onClick={() => handleRemoveResource(i, true)} className="text-blue-400 hover:text-red-600 leading-none ml-0.5">×</button>
                          </span>
                        ))}
                      </div>
                      <PeoplePicker
                        people={people}
                        excludeEmails={(editForm.resources || []).map(r => rEmail(r)).filter(Boolean)}
                        placeholder="Search user / employee…"
                        onSelect={p => handleAddResource(p, editing, editForm.title, t.wbsCode, editForm.endDate, false)}
                        className="w-full"
                      />
                      {addingRes && <p className="text-xs text-blue-500 mt-0.5">Adding…</p>}
                    </td>
                    <td className="px-3 py-2"><input type="number" className={inp + ' w-16'} min="0" max="100" value={editForm.progress} onChange={e => setEditForm(p => ({ ...p, progress: e.target.value }))} />%</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">—</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">—</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={handleEdit} disabled={saving} className="px-2 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">✓</button>
                        <button onClick={() => setEditing(null)} className="px-2 py-1 bg-slate-200 text-slate-600 text-xs rounded-lg hover:bg-slate-300">✕</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr className={`hover:bg-slate-50 ${LEVEL_CLS[t.level] || ''}`}>
                    <td className="px-4 py-2 text-xs font-mono text-slate-400">{t.wbsCode}</td>
                    <td className={`px-4 py-2 ${LEVEL_PL[t.level]}`}>
                      <div className="flex items-center gap-2">
                        {t.level === 1 && <span className="text-slate-400 text-xs">▼</span>}
                        <span>{t.title}</span>
                        {t.isMilestone && <span className="text-xs text-purple-600">◆ Milestone</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{fmt(t.startDate)}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{fmt(t.endDate)}</td>
                    <td className="px-3 py-2 text-center text-slate-600">{t.duration}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {(t.resources || []).length === 0 ? <span className="text-slate-400">—</span> :
                          (t.resources || []).map((r, i) => {
                            const token = rToken(r)
                            const link = publicLinks && token ? publicLinks[token] : null
                            const statusColor = { pending: 'bg-amber-100 text-amber-700', in_progress: 'bg-blue-100 text-blue-700', completed: 'bg-green-100 text-green-700', blocked: 'bg-red-100 text-red-700' }[link?.status || 'pending'] || 'bg-slate-100 text-slate-500'
                            return (
                              <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs ${statusColor}`} title={link ? `Status: ${link.status || 'pending'}${link.statusNote ? ' — ' + link.statusNote : ''}` : ''}>
                                {rLabel(r)}
                                {link?.status && link.status !== 'pending' && <span className="text-[9px] opacity-70">{link.status === 'in_progress' ? '▶' : link.status === 'completed' ? '✓' : '!'}</span>}
                              </span>
                            )
                          })}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${t.progress >= 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${t.progress || 0}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 w-8 text-right">{t.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {(t.predecessors || []).map(p => {
                        const pt = tasks.find(x => x.id === p.id)
                        return pt ? <span key={p.id} className="inline-block bg-slate-100 rounded-lg px-1 mr-0.5">{pt.wbsCode}</span> : null
                      })}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {tasks.filter(s => (s.predecessors || []).some(p => p.id === t.id)).map(s =>
                        <span key={s.id} className="inline-block bg-indigo-50 text-indigo-600 rounded-lg px-1 mr-0.5">{s.wbsCode}</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          <button onClick={() => { setEditing(t.id); setNewResEmail(''); setEditForm({ title: t.title, startDate: t.startDate || '', endDate: t.endDate || '', durationDays: daysBetween(t.startDate || '', t.endDate || ''), resources: t.resources || [], progress: t.progress || 0 }) }}
                            className="text-xs text-blue-600 hover:text-blue-700 px-1.5 py-0.5 rounded-lg hover:bg-blue-50">Edit</button>
                          {t.level < 3 && (
                            <button onClick={() => { setAdding({ level: t.level + 1, parentId: t.id }); setNewResEmail(''); setAddForm({ title: '', startDate: t.startDate || '', endDate: '', durationDays: 0, resources: [], progress: 0 }) }}
                              className="text-xs text-green-600 hover:text-green-700 px-1.5 py-0.5 rounded-lg hover:bg-green-50">+ Sub</button>
                          )}
                          <button onClick={() => handleDelete(t.id)} className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded-lg hover:bg-red-50">✕</button>
                        </div>
                      </td>
                    )}
                  </tr>
                )}

                {/* Predecessor selector for this task */}
                {editing === t.id && (
                  <tr className="bg-blue-50/60">
                    <td colSpan={canEdit ? 10 : 9} className="px-8 py-2">
                      <p className="text-xs font-semibold text-slate-500 mb-1.5">Predecessor tasks (Finish → Start):</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ordered.filter(x => x.id !== t.id && x.level !== 1).map(x => {
                          const active = (t.predecessors || []).some(p => p.id === x.id)
                          return (
                            <button key={x.id} type="button" onClick={() => handlePredecessorToggle(t.id, x.id)}
                              className={`px-2 py-0.5 rounded-lg text-xs border transition ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}>
                              {x.wbsCode} {x.title}
                            </button>
                          )
                        })}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Add sub-task form */}
                {adding && adding.parentId === t.id && (
                  <tr className="bg-green-50">
                    <td className="px-4 py-2 text-xs text-slate-400">{nextWbs(adding.level, adding.parentId)}</td>
                    <td className={`px-4 py-2 ${LEVEL_PL[adding.level]}`}>
                      <input autoFocus className={inp + ' w-full'} placeholder={`${adding.level === 2 ? 'Task' : 'Sub-task'} title…`} value={addForm.title} onChange={e => setAddForm(p => ({ ...p, title: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2"><input type="date" className={inp} value={addForm.startDate}
                      onChange={e => setAddForm(p => ({ ...p, startDate: e.target.value, endDate: p.durationDays ? addDays(e.target.value, p.durationDays) : p.endDate }))} /></td>
                    <td className="px-3 py-2"><input type="date" className={inp} value={addForm.endDate}
                      onChange={e => setAddForm(p => ({ ...p, endDate: e.target.value, durationDays: daysBetween(p.startDate, e.target.value) }))} /></td>
                    <td className="px-3 py-2">
                      <input type="number" className={inp + ' w-16'} min="0" value={addForm.durationDays || 0}
                        onChange={e => {
                          const d = Number(e.target.value)
                          setAddForm(p => ({ ...p, durationDays: d, endDate: p.startDate ? addDays(p.startDate, d) : p.endDate }))
                        }} />
                    </td>
                    <td className="px-3 py-2 min-w-[200px]">
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {(addForm.resources || []).map((r, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded-lg text-xs font-medium">
                            {rLabel(r)}
                            <button type="button" onClick={() => handleRemoveResource(i, false)} className="hover:text-red-600 leading-none ml-0.5">×</button>
                          </span>
                        ))}
                      </div>
                      <PeoplePicker
                        people={people}
                        excludeEmails={(addForm.resources || []).map(r => rEmail(r)).filter(Boolean)}
                        placeholder="Search user / employee…"
                        onSelect={p => handleAddResource(p, null, addForm.title, nextWbs(adding.level, adding.parentId), addForm.endDate, true)}
                        className="w-full"
                      />
                    </td>
                    <td className="px-3 py-2"><input type="number" className={inp + ' w-16'} min="0" max="100" value={addForm.progress} onChange={e => setAddForm(p => ({ ...p, progress: e.target.value }))} />%</td>
                    <td /><td />
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={handleAdd} disabled={saving} className="px-2 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">✓ Add</button>
                        <button onClick={() => setAdding(null)} className="px-2 py-1 bg-slate-200 text-slate-600 text-xs rounded-lg">✕</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}

            {/* Add Phase form (level 1, no parent) */}
            {adding && adding.level === 1 && (
              <tr className="bg-green-50">
                <td className="px-4 py-2 text-xs text-slate-400">{nextWbs(1, null)}</td>
                <td className="px-4 py-2 pl-2">
                  <input autoFocus className={inp + ' w-full'} placeholder="Phase title (e.g. Design, Procurement, Installation)…" value={addForm.title} onChange={e => setAddForm(p => ({ ...p, title: e.target.value }))} />
                </td>
                <td className="px-3 py-2"><input type="date" className={inp} value={addForm.startDate}
                  onChange={e => setAddForm(p => ({ ...p, startDate: e.target.value, endDate: p.durationDays ? addDays(e.target.value, p.durationDays) : p.endDate }))} /></td>
                <td className="px-3 py-2"><input type="date" className={inp} value={addForm.endDate}
                  onChange={e => setAddForm(p => ({ ...p, endDate: e.target.value, durationDays: daysBetween(p.startDate, e.target.value) }))} /></td>
                <td className="px-3 py-2">
                  <input type="number" className={inp + ' w-16'} min="0" value={addForm.durationDays || 0}
                    onChange={e => {
                      const d = Number(e.target.value)
                      setAddForm(p => ({ ...p, durationDays: d, endDate: p.startDate ? addDays(p.startDate, d) : p.endDate }))
                    }} />
                </td>
                <td className="px-3 py-2 min-w-[200px]">
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {(addForm.resources || []).map((r, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded-lg text-xs font-medium">
                        {rLabel(r)}
                        <button type="button" onClick={() => handleRemoveResource(i, false)} className="hover:text-red-600 leading-none ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                  <PeoplePicker
                    people={people}
                    excludeEmails={(addForm.resources || []).map(r => rEmail(r)).filter(Boolean)}
                    placeholder="Search user / employee…"
                    onSelect={p => handleAddResource(p, null, addForm.title, nextWbs(1, null), addForm.endDate, true)}
                    className="w-full"
                  />
                </td>
                <td className="px-3 py-2">0%</td>
                <td /><td />
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button onClick={handleAdd} disabled={saving} className="px-2 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">✓ Add</button>
                    <button onClick={() => setAdding(null)} className="px-2 py-1 bg-slate-200 text-slate-600 text-xs rounded-lg">✕</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Sub-component: Gantt Chart (SVG) ──────────────────────────────────────────
function GanttChart({ tasks, cpmTasks }) {
  const ROW_H = 34
  const HDR_H = 48
  const LEFT_W = 220
  const COL_W = 28         // px per day
  const cpmMap = Object.fromEntries((cpmTasks || []).map(t => [t.id, t]))

  // Only show tasks with dates
  const dated = useMemo(() => {
    const phases = tasks.filter(t => t.level === 1 && t.startDate).sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''))
    const result = []
    phases.forEach(ph => {
      result.push(ph)
      const children = tasks.filter(t => t.parentId === ph.id && t.startDate).sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''))
      children.forEach(ch => {
        result.push(ch)
        tasks.filter(t => t.parentId === ch.id && t.startDate).sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || '')).forEach(gc => result.push(gc))
      })
    })
    return result
  }, [tasks])

  const allDates = dated.flatMap(t => [t.startDate, t.endDate].filter(Boolean))
  if (!allDates.length) return (
    <div className="flex items-center justify-center h-48 text-slate-400 bg-white rounded-2xl shadow-card border border-slate-200/70">
      Add tasks with start and end dates to see the Gantt chart.
    </div>
  )

  const minDate = allDates.reduce((a, b) => a < b ? a : b)
  const maxDate = allDates.reduce((a, b) => a > b ? a : b)
  const totalDays = daysBetween(minDate, maxDate) + 7 // padding
  const svgW = totalDays * COL_W
  const svgH = HDR_H + dated.length * ROW_H + 10

  // Build month+week header
  const months = []
  let cur = new Date(minDate + 'T00:00:00')
  const end = new Date(addDays(maxDate, 7) + 'T00:00:00')
  while (cur < end) {
    const label = cur.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
    const x = daysBetween(minDate, cur.toISOString().slice(0, 10)) * COL_W
    months.push({ label, x })
    cur.setMonth(cur.getMonth() + 1)
  }

  // Week lines
  const weekLines = []
  let wd = new Date(minDate + 'T00:00:00')
  while (wd < end) {
    const x = daysBetween(minDate, wd.toISOString().slice(0, 10)) * COL_W
    weekLines.push(x)
    wd.setDate(wd.getDate() + 7)
  }

  // Today line
  const todayIso = new Date().toISOString().slice(0, 10)
  const todayX = todayIso >= minDate ? daysBetween(minDate, todayIso) * COL_W : null

  // Dependency arrows
  const arrows = []
  dated.forEach((t, i) => {
    ;(t.predecessors || []).forEach(pred => {
      const pi = dated.findIndex(x => x.id === pred.id)
      if (pi < 0) return
      const predTask = dated[pi]
      if (!predTask.endDate || !t.startDate) return
      const x1 = daysBetween(minDate, predTask.endDate) * COL_W
      const y1 = HDR_H + pi * ROW_H + ROW_H / 2
      const x2 = daysBetween(minDate, t.startDate) * COL_W
      const y2 = HDR_H + i * ROW_H + ROW_H / 2
      arrows.push({ x1, y1, x2, y2, critical: cpmMap[t.id]?.critical && cpmMap[predTask.id]?.critical })
    })
  })

  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
      {/* Legend */}
      <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-4 h-2 bg-red-500 rounded-lg inline-block" /> Critical path</span>
        <span className="flex items-center gap-1"><span className="w-4 h-2 bg-blue-500 rounded-lg inline-block" /> In progress</span>
        <span className="flex items-center gap-1"><span className="w-4 h-2 bg-slate-400 rounded-lg inline-block" /> Upcoming</span>
        <span className="flex items-center gap-1"><span className="w-0.5 h-4 bg-green-500 inline-block" /> Today</span>
      </div>
      <div className="overflow-x-auto">
        <div style={{ display: 'flex', width: LEFT_W + svgW }}>
          {/* Left panel: task names */}
          <div style={{ width: LEFT_W, flexShrink: 0, borderRight: '1px solid #e2e8f0' }}>
            <div style={{ height: HDR_H }} className="bg-slate-50 border-b border-slate-200 flex items-end px-3 pb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase">Task</span>
            </div>
            {dated.map((t, i) => {
              const isCrit = cpmMap[t.id]?.critical
              return (
                <div key={t.id} style={{ height: ROW_H }} className={`flex items-center px-3 border-b border-slate-100 text-xs ${t.level === 1 ? 'bg-slate-50 font-bold text-slate-800' : t.level === 2 ? 'font-semibold text-slate-700 pl-6' : 'text-slate-600 pl-10'} ${isCrit ? 'text-red-700' : ''}`}>
                  <span className="font-mono text-slate-400 mr-1.5 text-xs">{t.wbsCode}</span>
                  <span className="truncate">{t.title}</span>
                  {isCrit && <span className="ml-1 text-red-500 flex-shrink-0">◆</span>}
                </div>
              )
            })}
          </div>

          {/* Right panel: SVG Gantt */}
          <div style={{ flex: 1, overflow: 'visible' }}>
            <svg width={svgW} height={svgH} style={{ display: 'block' }}>
              {/* Month labels */}
              {months.map((m, i) => (
                <text key={i} x={m.x + 4} y={20} fontSize={10} fill="#64748b" fontWeight="600">{m.label}</text>
              ))}
              {/* Week grid lines */}
              {weekLines.map((x, i) => (
                <line key={i} x1={x} y1={24} x2={x} y2={svgH} stroke="#f1f5f9" strokeWidth={1} />
              ))}
              {/* Row backgrounds */}
              {dated.map((t, i) => (
                <rect key={t.id} x={0} y={HDR_H + i * ROW_H} width={svgW} height={ROW_H}
                  fill={i % 2 === 0 ? '#fafafa' : '#ffffff'} />
              ))}
              {/* Dependency arrows */}
              {arrows.map((a, i) => (
                <g key={i}>
                  <path d={`M${a.x1},${a.y1} C${a.x1 + 10},${a.y1} ${a.x2 - 10},${a.y2} ${a.x2},${a.y2}`}
                    fill="none" stroke={a.critical ? '#ef4444' : '#94a3b8'} strokeWidth={a.critical ? 2 : 1.5}
                    strokeDasharray={a.critical ? '' : '4,2'} markerEnd={`url(#arr${a.critical ? 'Red' : 'Gray'})`} />
                </g>
              ))}
              {/* Arrow markers */}
              <defs>
                <marker id="arrGray" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" fill="#94a3b8" />
                </marker>
                <marker id="arrRed" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" fill="#ef4444" />
                </marker>
              </defs>
              {/* Task bars */}
              {dated.map((t, i) => {
                if (!t.startDate || !t.endDate) return null
                const isCrit = cpmMap[t.id]?.critical
                const x = daysBetween(minDate, t.startDate) * COL_W
                const w = Math.max(daysBetween(t.startDate, t.endDate) * COL_W, 6)
                const y = HDR_H + i * ROW_H + 8
                const h = ROW_H - 16
                const barColor = isCrit ? '#ef4444' : t.level === 1 ? '#334155' : '#3b82f6'
                const progressW = w * ((t.progress || 0) / 100)
                return (
                  <g key={t.id}>
                    {/* Bar background */}
                    <rect x={x} y={y} width={w} height={h} rx={3} fill={barColor} opacity={0.2} />
                    {/* Progress fill */}
                    {progressW > 0 && (
                      <rect x={x} y={y} width={progressW} height={h} rx={3} fill={barColor} opacity={0.85} />
                    )}
                    {/* Bar border */}
                    <rect x={x} y={y} width={w} height={h} rx={3} fill="none"
                      stroke={barColor} strokeWidth={isCrit ? 2 : 1} />
                    {/* Progress label */}
                    {w > 30 && (
                      <text x={x + w + 4} y={y + h - 1} fontSize={9} fill={isCrit ? '#ef4444' : '#64748b'}>
                        {t.progress || 0}%
                      </text>
                    )}
                  </g>
                )
              })}
              {/* Today vertical line */}
              {todayX !== null && todayX >= 0 && todayX <= svgW && (
                <g>
                  <line x1={todayX} y1={30} x2={todayX} y2={svgH} stroke="#22c55e" strokeWidth={2} strokeDasharray="4,3" />
                  <text x={todayX + 3} y={42} fontSize={9} fill="#22c55e" fontWeight="bold">Today</text>
                </g>
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-component: Critical Path Summary ─────────────────────────────────────
function CriticalPathView({ tasks, cpmTasks }) {
  const cpmMap = Object.fromEntries((cpmTasks || []).map(t => [t.id, t]))
  const criticalTasks = (cpmTasks || []).filter(t => t.critical && t.duration > 0)
    .sort((a, b) => a.es - b.es)

  const projectDuration = Math.max(...(cpmTasks || []).map(t => t.ef || 0), 0)
  const projectStart    = tasks.reduce((a, t) => (!a || t.startDate < a) ? t.startDate : a, null)
  const projectEnd      = projectStart ? addDays(projectStart, projectDuration) : null

  if (!criticalTasks.length) {
    return (
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
        <p className="text-3xl mb-2">🔗</p>
        <p>Add tasks with predecessors to calculate the critical path.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-xs text-red-500 uppercase font-semibold mb-1">Project Duration</p>
          <p className="text-2xl font-bold text-red-700">{projectDuration} days</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Critical Tasks</p>
          <p className="text-2xl font-bold text-slate-900 tracking-tight">{criticalTasks.length}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <p className="text-xs text-green-600 uppercase font-semibold mb-1">Projected End</p>
          <p className="text-lg font-bold text-green-700">{fmt(projectEnd)}</p>
        </div>
      </div>

      {/* Critical path chain */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
        <h3 className="text-sm font-bold text-slate-700 mb-3">🔴 Critical Path Chain</h3>
        <div className="overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {criticalTasks.map((t, i) => {
              const orig = tasks.find(x => x.id === t.id)
              return (
                <React.Fragment key={t.id}>
                  <div className="flex flex-col items-center">
                    <div className="bg-red-50 border-2 border-red-400 rounded-xl p-2 text-center w-36">
                      <p className="text-xs font-mono text-red-400">{orig?.wbsCode}</p>
                      <p className="text-xs font-bold text-red-700 truncate">{orig?.title}</p>
                      <p className="text-xs text-red-500 mt-0.5">{t.duration}d</p>
                      <div className="flex justify-between text-xs text-red-400 mt-1">
                        <span>ES:{t.es}</span><span>EF:{t.ef}</span>
                      </div>
                      <div className="flex justify-between text-xs text-red-300">
                        <span>LS:{t.ls}</span><span>LF:{t.lf}</span>
                      </div>
                    </div>
                    {orig?.progress > 0 && (
                      <div className="mt-1 w-full h-1.5 bg-red-100 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full" style={{ width: `${orig.progress}%` }} />
                      </div>
                    )}
                  </div>
                  {i < criticalTasks.length - 1 && (
                    <div className="text-red-400 text-lg flex-shrink-0">→</div>
                  )}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      </div>

      {/* Full CPM table */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2">WBS</th>
              <th className="text-left px-4 py-2">Task</th>
              <th className="text-center px-3 py-2">Dur.</th>
              <th className="text-center px-3 py-2">ES</th>
              <th className="text-center px-3 py-2">EF</th>
              <th className="text-center px-3 py-2">LS</th>
              <th className="text-center px-3 py-2">LF</th>
              <th className="text-center px-3 py-2">Float</th>
              <th className="text-center px-3 py-2">Critical?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(cpmTasks || []).filter(t => t.duration > 0).sort((a, b) => a.es - b.es).map(t => {
              const orig = tasks.find(x => x.id === t.id)
              return (
                <tr key={t.id} className={t.critical ? 'bg-red-50' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-2 font-mono text-slate-400">{orig?.wbsCode}</td>
                  <td className={`px-4 py-2 font-medium ${t.critical ? 'text-red-700' : 'text-slate-700'}`}>{orig?.title}</td>
                  <td className="px-3 py-2 text-center">{t.duration}</td>
                  <td className="px-3 py-2 text-center text-blue-600">{t.es}</td>
                  <td className="px-3 py-2 text-center text-blue-700">{t.ef}</td>
                  <td className="px-3 py-2 text-center text-slate-600">{t.ls}</td>
                  <td className="px-3 py-2 text-center text-slate-700">{t.lf}</td>
                  <td className={`px-3 py-2 text-center font-bold ${t.float === 0 ? 'text-red-600' : 'text-green-600'}`}>{t.float}</td>
                  <td className="px-3 py-2 text-center">{t.critical ? '🔴 Yes' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Sub-component: Resource Matrix ────────────────────────────────────────────
function ResourceMatrix({ tasks }) {
  // Collect unique resource labels (handle both string[] and {email,token}[])
  const allResources = useMemo(() => {
    const set = new Set()
    tasks.forEach(t => (t.resources || []).forEach(r => { const lbl = rLabel(r); if (lbl) set.add(lbl) }))
    return [...set].sort()
  }, [tasks])

  const taskRows = tasks.filter(t => (t.resources || []).length > 0 && t.startDate)
    .sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || ''))

  if (!allResources.length) return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
      <p className="text-3xl mb-2">👷</p>
      <p>Add resources (by email) to tasks in the WBS to see the allocation matrix.</p>
    </div>
  )

  // Per-resource workload
  const resWorkload = {}
  allResources.forEach(lbl => {
    const myTasks = tasks.filter(t => (t.resources || []).some(r => rLabel(r) === lbl) && t.startDate)
    resWorkload[lbl] = { count: myTasks.length, days: myTasks.reduce((s, t) => s + (t.duration || 0), 0) }
  })

  return (
    <div className="space-y-4">
      {/* Resource summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {allResources.slice(0, 8).map(lbl => (
          <div key={lbl} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-3">
            <p className="text-xs font-semibold text-slate-700 truncate">{lbl}</p>
            <p className="text-lg font-bold text-blue-700 mt-1">{resWorkload[lbl].days}<span className="text-xs font-normal text-slate-400 ml-1">days</span></p>
            <p className="text-xs text-slate-500">{resWorkload[lbl].count} task{resWorkload[lbl].count !== 1 ? 's' : ''}</p>
          </div>
        ))}
      </div>

      {/* Allocation matrix */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-x-auto">
        <table className="text-xs w-full min-w-max">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 text-slate-500 uppercase w-48">Task</th>
              <th className="text-center px-3 py-2.5 text-slate-500 uppercase w-20">Duration</th>
              {allResources.map(lbl => (
                <th key={lbl} className="text-center px-3 py-2.5 font-semibold text-slate-700 whitespace-nowrap max-w-24">{lbl}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {taskRows.map(t => (
              <tr key={t.id} className={`hover:bg-slate-50 ${t.level === 1 ? 'bg-slate-50 font-bold' : ''}`}>
                <td className={`px-4 py-2 text-slate-700 ${t.level === 2 ? 'pl-8' : t.level === 3 ? 'pl-12' : ''}`}>
                  <span className="font-mono text-slate-400 mr-1">{t.wbsCode}</span>{t.title}
                </td>
                <td className="px-3 py-2 text-center text-slate-500">{t.duration}d</td>
                {allResources.map(lbl => (
                  <td key={lbl} className="px-3 py-2 text-center">
                    {(t.resources || []).some(r => rLabel(r) === lbl)
                      ? <span className="inline-flex w-5 h-5 rounded-full bg-blue-500 text-white items-center justify-center text-xs">✓</span>
                      : <span className="text-slate-200">—</span>
                    }
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {/* Totals */}
          <tfoot className="bg-slate-50 border-t border-slate-200">
            <tr>
              <td className="px-4 py-2 font-bold text-slate-600">Total</td>
              <td className="px-3 py-2 text-center text-slate-500">{taskRows.reduce((s, t) => s + (t.duration || 0), 0)}d</td>
              {allResources.map(lbl => (
                <td key={lbl} className="px-3 py-2 text-center font-bold text-blue-700">
                  {resWorkload[lbl].days}d
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Main: ProjectPlanPage ─────────────────────────────────────────────────────
export default function ProjectPlanPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const role = userProfile?.role || ''
  const canEdit = role === 'admin' || role === 'project_manager' || role === 'sales_manager'
  const { users } = useUsers()

  const [project, setProject] = useState(null)
  const [pmSaving, setPmSaving] = useState(false)
  const [addMemberUid, setAddMemberUid] = useState(null)
  const [teamSaving, setTeamSaving] = useState(false)
  const [tasks, setTasks] = useState([])
  const [publicLinks, setPublicLinks] = useState({})   // token → {status, statusNote, ...}
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('wbs')
  const [resourceFilter, setResourceFilter] = useState('')
  // DAP tab — lazy-loaded only when the tab is first opened
  const [dap, setDap] = useState(null)
  const [dapLoading, setDapLoading] = useState(false)
  const [dapLoaded, setDapLoaded] = useState(false)

  useEffect(() => { loadData() }, [projectId])

  const loadData = async () => {
    try {
      const [projSnap, tasksSnap] = await Promise.all([
        getDoc(doc(db, 'projects', projectId)),
        getDocs(query(collection(db, 'project_plan_tasks'), where('projectId', '==', projectId))),
      ])
      if (projSnap.exists()) setProject({ id: projSnap.id, ...projSnap.data() })
      const td = []
      tasksSnap.forEach(d => td.push({ id: d.id, ...d.data() }))
      setTasks(td)

      // Load public_task_links for this project to show resource status badges
      const linksSnap = await getDocs(query(collection(db, 'public_task_links'), where('projectId', '==', projectId)))
      const linksMap = {}
      linksSnap.forEach(d => { linksMap[d.id] = d.data() })
      setPublicLinks(linksMap)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // ── Day-before reminder check (runs once on mount, max once per day per task) ─
  useEffect(() => {
    if (!tasks.length) return
    const today = new Date().toISOString().slice(0, 10)
    const storageKey = `ibs_reminders_sent_${today}`
    const alreadySent = JSON.parse(localStorage.getItem(storageKey) || '[]')
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowIso = tomorrow.toISOString().slice(0, 10)

    tasks.forEach(t => {
      if (t.endDate !== tomorrowIso) return
      ;(t.resources || []).forEach(async (r) => {
        const email = rEmail(r)
        const token = rToken(r)
        if (!email || !token) return
        const link = publicLinks[token]
        if (link?.status === 'completed') return
        const sentKey = `${t.id}_${email}`
        if (alreadySent.includes(sentKey)) return
        // Send reminder
        const { sendProjectTaskReminder } = await import('../../../lib/projectNotifications')
        sendProjectTaskReminder({ taskTitle: t.title, projectName: project?.dealTitle || '', deadline: t.endDate, token, toEmail: email })
        alreadySent.push(sentKey)
      })
    })
    if (alreadySent.length) localStorage.setItem(storageKey, JSON.stringify(alreadySent))
  }, [tasks, publicLinks, project])

  // CPM using duration in days
  const cpmTasks = useMemo(() => {
    const leafTasks = tasks.filter(t => t.level > 1 && (t.duration || 0) > 0)
    return computeCPM(leafTasks)
  }, [tasks])

  // ── DAP lazy-load: fires once when user first opens the DAP tab ──────────────
  useEffect(() => {
    if (activeTab !== 'dap' || dapLoaded || !project) return
    const dealId = project.dapId || project.dealId
    if (!dealId) { setDapLoaded(true); return }
    setDapLoading(true)
    getDoc(doc(db, 'sales_engineering_dap', dealId))
      .then(snap => { if (snap.exists()) setDap(snap.data()) })
      .catch(e => console.error('DAP load:', e))
      .finally(() => { setDapLoading(false); setDapLoaded(true) })
  }, [activeTab, dapLoaded, project])

  const tabs = [
    { id: 'wbs',      label: '📋 WBS',           hint: 'Work Breakdown Structure' },
    { id: 'gantt',    label: '📊 Gantt Chart',    hint: 'Timeline view' },
    { id: 'critical', label: '🔴 Critical Path',  hint: 'CPM analysis' },
    { id: 'resources',label: '👷 Resources',      hint: 'Allocation matrix' },
    { id: 'dap',      label: '📐 DAP',            hint: 'Design Approval Plan' },
  ]

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading project plan…</div>
  if (!project) return <div className="p-6 text-red-600">Project not found.</div>

  const totalTasks = tasks.filter(t => t.level > 1).length
  const done = tasks.filter(t => (t.progress || 0) >= 100 && t.level > 1).length
  const overallProgress = totalTasks > 0 ? Math.round(tasks.filter(t => t.level > 1).reduce((s, t) => s + (t.progress || 0), 0) / totalTasks) : 0

  return (
    <div className="p-4 sm:p-6 space-y-4 min-h-full bg-slate-50">
      {/* Back + header */}
      <div>
        <button onClick={() => navigate('/projects/register')} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mb-3">
          ← Back to Project Register
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-blue-700 font-bold text-lg">{project.projectNumber}</span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">{project.dealTitle}</h1>
              {project.status && (
                <span className={`px-2 py-0.5 rounded-lg text-xs font-bold capitalize ${
                  project.status === 'active' ? 'bg-green-100 text-green-700' :
                  project.status === 'completed' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'
                }`}>{project.status}</span>
              )}
            </div>
            <p className="text-slate-500 text-sm mt-1">
              {project.customerName && <span>{project.customerName} · </span>}
              {project.poNumber && <span>PO: <strong>{project.poNumber}</strong> · </span>}
              {project.contractValue && <span>Contract: Rs.{Number(project.contractValue).toLocaleString('en-IN')}</span>}
            </p>
            {/* Project Manager */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs text-slate-400 font-medium">👷 Project Manager:</span>
              {(() => {
                const pm = project.projectManagerUid ? users.find(u => u.uid === project.projectManagerUid) : null
                if (!canEdit) return (
                  <span className="text-xs font-semibold text-slate-700">
                    {pm ? `${pm.name}` : '—'}
                    {pm?.role && <span className="ml-1 text-xs text-slate-400">({pm.role.replace(/_/g,' ')})</span>}
                  </span>
                )
                return (
                  <div className="flex items-center gap-2 min-w-64">
                    <UserSelector
                      value={project.projectManagerUid || null}
                      onChange={async (uid) => {
                        if (pmSaving) return
                        setPmSaving(true)
                        try {
                          await updateDoc(doc(db, 'projects', projectId), {
                            projectManagerUid: uid || null,
                            updatedAt: new Date().toISOString(),
                          })
                          setProject(p => ({ ...p, projectManagerUid: uid || null }))
                        } catch (e) { console.error(e) }
                        finally { setPmSaving(false) }
                      }}
                      placeholder="Assign project manager…"
                      filters={{ role: 'project_manager' }}
                      allowClear
                      disabled={pmSaving}
                      className="flex-1"
                    />
                    {pmSaving && <span className="text-xs text-slate-400">Saving…</span>}
                  </div>
                )
              })()}
            </div>
            {/* Project Team */}
            {(() => {
              const members = Array.isArray(project.teamMembers) ? project.teamMembers : []
              const saveTeam = async (next) => {
                setTeamSaving(true)
                try {
                  await updateDoc(doc(db, 'projects', projectId), {
                    teamMembers: next,
                    updatedAt: new Date().toISOString(),
                  })
                  setProject(p => ({ ...p, teamMembers: next }))
                } catch (e) { console.error(e) }
                finally { setTeamSaving(false) }
              }
              return (
                <div className="mt-3">
                  <span className="text-xs text-slate-400 font-medium block mb-1">👥 Project Team:</span>
                  <div className="flex flex-wrap gap-2 items-center">
                    {members.map(uid => {
                      const u = users.find(x => x.uid === uid)
                      if (!u) return null
                      return (
                        <span key={uid} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-full text-xs text-blue-800">
                          <span className="font-semibold">{u.name}</span>
                          {u.role && <span className="text-blue-500">· {u.role.replace(/_/g,' ')}</span>}
                          {u.department && <span className="text-blue-400">· {u.department}</span>}
                          {canEdit && (
                            <button
                              disabled={teamSaving}
                              onClick={() => saveTeam(members.filter(x => x !== uid))}
                              className="ml-0.5 text-blue-400 hover:text-red-500 disabled:opacity-40 leading-none"
                              title="Remove"
                            >✕</button>
                          )}
                        </span>
                      )
                    })}
                    {members.length === 0 && !canEdit && (
                      <span className="text-xs text-slate-400">No team members assigned.</span>
                    )}
                    {canEdit && (
                      <div className="flex items-center gap-2 min-w-52">
                        <UserSelector
                          value={addMemberUid}
                          onChange={uid => setAddMemberUid(uid || null)}
                          placeholder="Add team member…"
                          allowClear
                          disabled={teamSaving}
                          className="flex-1 text-xs"
                        />
                        <button
                          disabled={!addMemberUid || members.includes(addMemberUid) || teamSaving}
                          onClick={() => {
                            if (!addMemberUid || members.includes(addMemberUid)) return
                            saveTeam([...members, addMemberUid])
                            setAddMemberUid(null)
                          }}
                          className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition disabled:opacity-40 whitespace-nowrap"
                        >+ Add</button>
                      </div>
                    )}
                    {teamSaving && <span className="text-xs text-slate-400">Saving…</span>}
                  </div>
                </div>
              )
            })()}
          </div>
          {/* Overall progress */}
          <div className="bg-white border border-slate-200/70 rounded-2xl shadow-card px-4 py-2 min-w-48">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Overall Progress</span>
              <span className="font-bold text-slate-700">{overallProgress}% · {done}/{totalTasks} tasks</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${overallProgress >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${overallProgress}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white border border-slate-200/70 rounded-2xl shadow-card p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === t.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'wbs' && (
        <WBSEditor
          tasks={tasks}
          projectId={projectId}
          projectName={project.dealTitle || project.projectNumber || ''}
          projectStartDate={project.poDate || project.startDate || ''}
          onTasksChange={setTasks}
          canEdit={canEdit}
          resourceFilter={resourceFilter}
          onResourceFilterChange={setResourceFilter}
          publicLinks={publicLinks}
        />
      )}
      {activeTab === 'gantt' && (
        <GanttChart tasks={tasks} cpmTasks={cpmTasks} />
      )}
      {activeTab === 'critical' && (
        <CriticalPathView tasks={tasks} cpmTasks={cpmTasks} />
      )}
      {activeTab === 'resources' && (
        <ResourceMatrix tasks={tasks} />
      )}

      {/* ── DAP Summary (view-only) ── */}
      {activeTab === 'dap' && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6 space-y-5">
          {dapLoading && (
            <div className="py-12 text-center text-slate-400 text-sm">Loading DAP…</div>
          )}
          {!dapLoading && !dap && (
            <div className="py-12 text-center space-y-2">
              <p className="text-slate-400 text-sm">No approved DAP found for this project.</p>
              <p className="text-xs text-slate-400">
                {project.dealId
                  ? 'Open the CRM deal in Sales Engineering to create one.'
                  : 'This project has no linked CRM deal.'}
              </p>
            </div>
          )}
          {!dapLoading && dap && (() => {
            const DAP_OVERALL_STATUSES = [
              { id: 'draft',        label: 'Draft',        color: 'bg-slate-100 text-slate-600' },
              { id: 'under_review', label: 'Under Review', color: 'bg-amber-100 text-amber-700' },
              { id: 'approved',     label: 'Approved',     color: 'bg-green-100 text-green-700' },
            ]
            const ENG_STATUSES = [
              { id: 'pending',   label: 'Pending',   color: 'bg-slate-100 text-slate-500' },
              { id: 'in_design', label: 'In Design', color: 'bg-blue-100 text-blue-700' },
              { id: 'approved',  label: 'Approved',  color: 'bg-green-100 text-green-700' },
              { id: 'on_hold',   label: 'On Hold',   color: 'bg-amber-100 text-amber-700' },
            ]
            const overallSt = DAP_OVERALL_STATUSES.find(s => s.id === dap.status) || DAP_OVERALL_STATUSES[0]
            const engSt = (id) => ENG_STATUSES.find(s => s.id === id) || ENG_STATUSES[0]
            const items = dap.scopeItems || []
            const approved = items.filter(i => i.engStatus === 'approved').length
            return (
              <div className="space-y-5">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-slate-800">📐 Design Approval Plan</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${overallSt.color}`}>{overallSt.label}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span>{items.length} scope items</span>
                    <span className="text-green-700 font-semibold">{approved} approved</span>
                    {dap.updatedAt && <span>Updated: {new Date(dap.updatedAt).toLocaleDateString('en-IN')}</span>}
                  </div>
                </div>

                {/* Scope Items table */}
                {items.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-4 py-2.5">#</th>
                          <th className="text-left px-4 py-2.5">Category</th>
                          <th className="text-left px-4 py-2.5">Description</th>
                          <th className="text-left px-4 py-2.5 hidden sm:table-cell">Specification</th>
                          <th className="text-center px-4 py-2.5 w-16">Qty</th>
                          <th className="text-center px-4 py-2.5 w-16">Unit</th>
                          <th className="text-center px-4 py-2.5 w-24">Eng Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((item, idx) => (
                          <tr key={item.id || idx} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 text-slate-400">{idx + 1}</td>
                            <td className="px-4 py-2.5 font-medium text-slate-700">{item.category || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-600">{item.description || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell">{item.specification || '—'}</td>
                            <td className="px-4 py-2.5 text-center font-bold text-slate-700">{item.quantity}</td>
                            <td className="px-4 py-2.5 text-center text-slate-500">{item.unit}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${engSt(item.engStatus).color}`}>
                                {engSt(item.engStatus).label}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm text-center py-6">No scope items in this DAP.</p>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
