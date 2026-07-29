import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useNavigate } from 'react-router-dom'

const emptyEdit = { assignedTo: '', startDate: '', targetHandoverDate: '', budget: '', projectNotes: '' }

export default function ActiveProjects() {
  const navigate = useNavigate()
  const [sites, setSites] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    const load = async () => {
      try {
        const [siteSnap, taskSnap] = await Promise.all([
          getDocs(collection(db, 'crm_sites')),
          getDocs(collection(db, 'project_tasks')),
        ])
        const s = []; siteSnap.forEach(d => s.push({ id: d.id, ...d.data() }))
        const t = []; taskSnap.forEach(d => t.push({ id: d.id, ...d.data() }))
        setSites(s.filter(x => x.status === 'project'))
        setTasks(t)
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const openEdit = (s) => {
    setEditing(s.id)
    setForm({ assignedTo: s.assignedTo || '', startDate: s.startDate || '', targetHandoverDate: s.targetHandoverDate || '', budget: s.budget ?? '', projectNotes: s.projectNotes || '' })
  }

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      const payload = { ...form, budget: Number(form.budget) || 0, updatedAt: new Date().toISOString() }
      await updateDoc(doc(db, 'crm_sites', editing), payload)
      setSites(prev => prev.map(s => s.id === editing ? { ...s, ...payload } : s))
      setEditing(null)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const markHandedOver = async (s) => {
    if (!window.confirm(`Mark "${s.siteName}" as handed over? It moves to Service Sites.`)) return
    try {
      const update = { status: 'service', handoverDate: today, updatedAt: new Date().toISOString() }
      await updateDoc(doc(db, 'crm_sites', s.id), update)
      setSites(prev => prev.filter(x => x.id !== s.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const taskCount = (siteId) => tasks.filter(t => t.projectId === siteId)
  const doneCount = (siteId) => tasks.filter(t => t.projectId === siteId && t.done).length

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Active Projects</h2>
          <p className="text-slate-500 text-sm">{sites.length} projects in progress</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/projects/tasks')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">✅ Manage Tasks</button>
          <button onClick={() => navigate('/crm/sites')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">CRM → Sites</button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {sites.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          No active projects. Win an opportunity linked to a CRM Site to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {sites.map(s => {
            const allTasks = taskCount(s.id)
            const done = doneCount(s.id)
            const pct = allTasks.length > 0 ? Math.round((done / allTasks.length) * 100) : 0
            const overdue = s.targetHandoverDate && s.targetHandoverDate < today
            return (
              <div key={s.id} className={`bg-white rounded-xl shadow-sm border ${overdue ? 'border-red-300' : 'border-slate-200'} p-5`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-800">{s.siteName}</h3>
                      {overdue && <span className="px-2 py-0.5 rounded-lg text-xs bg-red-100 text-red-700 font-bold">⚠ Overdue</span>}
                    </div>
                    <p className="text-sm text-slate-500">{s.customerName} {s.address ? `· ${s.address}` : ''}</p>
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-500">
                      <div><span className="font-medium">Assigned:</span> {s.assignedTo || '—'}</div>
                      <div><span className="font-medium">Start:</span> {s.startDate || '—'}</div>
                      <div><span className={`font-medium ${overdue ? 'text-red-600' : ''}`}>Target:</span> {s.targetHandoverDate || '—'}</div>
                      <div><span className="font-medium">Budget:</span> {s.budget ? `₹${Number(s.budget).toLocaleString('en-IN')}` : '—'}</div>
                    </div>
                    {allTasks.length > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                          <span>Tasks: {done}/{allTasks.length}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full">
                          <div className="h-1.5 bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                    {s.projectNotes && <p className="mt-2 text-xs text-slate-400 italic">{s.projectNotes}</p>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => openEdit(s)} className="px-3 py-1.5 text-xs border border-slate-300 hover:bg-slate-50 rounded-lg text-slate-600 transition">✏️ Edit</button>
                    <button onClick={() => markHandedOver(s)} className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition">📦 Handed Over</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-5 w-full max-w-lg">
            <h3 className="font-bold text-slate-800 mb-4">Edit Project</h3>
            <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assigned To</label>
                <input type="text" value={form.assignedTo} onChange={e => set('assignedTo', e.target.value)} autoComplete="off"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Budget (₹)</label>
                <input type="number" value={form.budget} onChange={e => set('budget', e.target.value)} min="0" autoComplete="off"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Target Handover</label>
                <input type="date" value={form.targetHandoverDate} onChange={e => set('targetHandoverDate', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={form.projectNotes} onChange={e => set('projectNotes', e.target.value)} rows={2}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2 flex gap-3">
                <button type="submit" disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(null)}
                  className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
