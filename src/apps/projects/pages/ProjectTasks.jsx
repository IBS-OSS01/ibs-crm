import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const emptyForm = { projectId: '', task: '', assignedTo: '', dueDate: '', done: false }

export default function ProjectTasks() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterDone, setFilterDone] = useState('open')

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    const load = async () => {
      try {
        const [siteSnap, taskSnap] = await Promise.all([
          getDocs(collection(db, 'crm_sites')),
          getDocs(collection(db, 'project_tasks')),
        ])
        const s = []; siteSnap.forEach(d => s.push({ id: d.id, name: d.data().siteName || d.id, customerName: d.data().customerName || '' }))
        setProjects(s.filter((_, idx) => {
          // only show active project sites
          const data = []; siteSnap.forEach(d => data.push({ id: d.id, ...d.data() }))
          return data[idx]?.status === 'project'
        }))
        const t = []; taskSnap.forEach(d => t.push({ id: d.id, ...d.data() }))
        t.sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1
          return (a.dueDate || '').localeCompare(b.dueDate || '')
        })
        setTasks(t)
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  // Fix project filter - get full site data
  useEffect(() => {
    getDocs(collection(db, 'crm_sites')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setProjects(data.filter(s => s.status === 'project').map(s => ({ id: s.id, name: s.siteName || s.id, customerName: s.customerName || '' })))
    })
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async (ev) => {
    ev.preventDefault(); setError('')
    if (!form.projectId) { setError('Select a project.'); return }
    if (!form.task.trim()) { setError('Task description is required.'); return }
    setSaving(true)
    try {
      const proj = projects.find(p => p.id === form.projectId)
      const payload = { ...form, projectName: proj?.name || '', customerName: proj?.customerName || '', createdBy: user.uid, createdAt: new Date().toISOString() }
      const ref = await addDoc(collection(db, 'project_tasks'), payload)
      setTasks(prev => [{ id: ref.id, ...payload }, ...prev])
      setShowForm(false); setForm(emptyForm)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const toggleDone = async (t) => {
    const done = !t.done
    await updateDoc(doc(db, 'project_tasks', t.id), { done, updatedAt: new Date().toISOString() })
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done } : x).sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      return (a.dueDate || '').localeCompare(b.dueDate || '')
    }))
  }

  const handleDelete = async (t) => {
    if (!window.confirm('Delete this task?')) return
    await deleteDoc(doc(db, 'project_tasks', t.id))
    setTasks(prev => prev.filter(x => x.id !== t.id))
  }

  const filtered = tasks.filter(t => {
    const matchProj = !filterProject || t.projectId === filterProject
    const matchDone = filterDone === 'all' || (filterDone === 'open' && !t.done) || (filterDone === 'done' && t.done)
    return matchProj && matchDone
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Project Tasks</h2>
          <p className="text-slate-500 text-sm">{tasks.filter(t => !t.done).length} open · {tasks.filter(t => t.done).length} completed</p>
        </div>
        <button onClick={() => setShowForm(p => !p)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm ? '✕ Cancel' : '+ Add Task'}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex border border-slate-300 rounded-lg overflow-hidden text-sm">
          {['open','done','all'].map(f => (
            <button key={f} onClick={() => setFilterDone(f)}
              className={`px-3 py-2 capitalize ${filterDone === f ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">Add Task</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Project *</label>
              <select value={form.projectId} onChange={e => set('projectId', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name} — {p.customerName}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Task Description *</label>
              <input type="text" value={form.task} onChange={e => set('task', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Assigned To</label>
              <input type="text" value={form.assignedTo} onChange={e => set('assignedTo', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
              <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : 'Add Task'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 divide-y divide-slate-100">
        {filtered.map(t => {
          const overdue = !t.done && t.dueDate && t.dueDate < today
          return (
            <div key={t.id} className={`flex items-start gap-3 px-4 py-3 ${t.done ? 'opacity-60' : ''}`}>
              <input type="checkbox" checked={t.done} onChange={() => toggleDone(t)}
                className="mt-1 w-4 h-4 accent-blue-600 cursor-pointer flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${t.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{t.task}</p>
                <div className="flex gap-3 text-xs text-slate-400 mt-0.5 flex-wrap">
                  <span>📁 {t.projectName}</span>
                  {t.assignedTo && <span>👤 {t.assignedTo}</span>}
                  {t.dueDate && <span className={overdue ? 'text-red-600 font-bold' : ''}>{overdue ? '⚠ ' : ''}Due: {t.dueDate}</span>}
                </div>
              </div>
              {isAdmin && (
                <button onClick={() => handleDelete(t)} className="text-slate-300 hover:text-red-500 text-xs flex-shrink-0">✕</button>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-sm">No tasks found.</div>
        )}
      </div>
    </div>
  )
}
