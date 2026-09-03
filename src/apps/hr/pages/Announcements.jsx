import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'

const emptyForm = { title: '', body: '', type: 'announcement', pinned: false }
const inp = 'w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function Announcements() {
  const { user, userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const hasHRAccess = userProfile?.role === 'admin' || canEdit('HR')

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'hr_announcements'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        return (b.publishedAt || '').localeCompare(a.publishedAt || '')
      })
      setItems(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleEdit = (a) => {
    setEditing(a.id)
    setForm({ title: a.title || '', body: a.body || '', type: a.type || 'announcement', pinned: !!a.pinned })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim() || !form.body.trim()) { setError('Title and body are required.'); return }
    setSaving(true)
    try {
      if (editing) {
        await updateDoc(doc(db, 'hr_announcements', editing), { ...form })
        setItems(prev => prev.map(a => a.id === editing ? { ...a, ...form } : a))
      } else {
        const newItem = { ...form, publishedAt: new Date().toISOString(), publishedBy: user.uid, publishedByName: userProfile?.name || user.email }
        const ref = await addDoc(collection(db, 'hr_announcements'), newItem)
        setItems(prev => [{ id: ref.id, ...newItem }, ...prev])
      }
      setShowForm(false); resetForm()
      load() // re-sort (pinned/date order can change)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (a) => {
    if (!window.confirm(`Delete "${a.title}"?`)) return
    try {
      await deleteDoc(doc(db, 'hr_announcements', a.id))
      setItems(prev => prev.filter(x => x.id !== a.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const togglePin = async (a) => {
    try {
      await updateDoc(doc(db, 'hr_announcements', a.id), { pinned: !a.pinned })
      load()
    } catch (err) { setError('Error: ' + err.message) }
  }

  const formatDate = (d) => { try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d } }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Policies &amp; Announcements</h2>
          <p className="text-slate-500 text-sm">{items.length} published</p>
        </div>
        {hasHRAccess && (
          <button onClick={() => { setShowForm(!showForm); resetForm() }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ New Post'}
          </button>
        )}
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {showForm && hasHRAccess && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Post' : 'New Post'}</h3>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
              <input type="text" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} required />
            </div>
            <div className="flex gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} className={inp}>
                  <option value="announcement">Announcement</option>
                  <option value="policy">Policy</option>
                </select>
              </div>
              <label className="flex items-center gap-2 mt-6 cursor-pointer">
                <input type="checkbox" checked={form.pinned} onChange={e => setForm(p => ({ ...p, pinned: e.target.checked }))} />
                <span className="text-sm text-slate-700">📌 Pin to top</span>
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Body *</label>
              <textarea rows={6} value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
                className={`${inp} resize-none`} required />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Post' : 'Publish'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {items.map(a => (
          <div key={a.id} className={`bg-white rounded-2xl shadow-card border p-5 ${a.pinned ? 'border-amber-300' : 'border-slate-200/70'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {a.pinned && <span className="text-amber-500">📌</span>}
                  <span className={`text-xs px-2 py-0.5 rounded-lg font-bold ${a.type === 'policy' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {a.type === 'policy' ? 'Policy' : 'Announcement'}
                  </span>
                  <h3 className="font-bold text-slate-800">{a.title}</h3>
                </div>
                <p className="text-xs text-slate-400">{a.publishedByName} · {formatDate(a.publishedAt)}</p>
              </div>
              {hasHRAccess && (
                <div className="flex gap-2 flex-shrink-0 text-xs">
                  <button onClick={() => togglePin(a)} className="text-amber-600 hover:text-amber-700 font-medium">{a.pinned ? 'Unpin' : 'Pin'}</button>
                  <button onClick={() => handleEdit(a)} className="text-blue-600 hover:text-blue-700 font-medium">Edit</button>
                  <button onClick={() => handleDelete(a)} className="text-red-600 hover:text-red-700 font-medium">Delete</button>
                </div>
              )}
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-line mt-3">{a.body}</p>
          </div>
        ))}
        {items.length === 0 && (
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">No posts yet.</div>
        )}
      </div>
    </div>
  )
}
