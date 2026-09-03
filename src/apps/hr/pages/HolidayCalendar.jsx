import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'

const TYPE_LABELS = { public: 'Public Holiday', optional: 'Optional Holiday' }
const emptyForm = { name: '', date: '', type: 'public' }
const inp = 'w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function HolidayCalendar() {
  const { user, userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const hasHRAccess = userProfile?.role === 'admin' || canEdit('HR')

  const [holidays, setHolidays] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'hr_holidays'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      setHolidays(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleEdit = (h) => {
    setEditing(h.id)
    setForm({ name: h.name || '', date: h.date || '', type: h.type || 'public' })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim() || !form.date) { setError('Name and date are required.'); return }
    const dup = holidays.find(h => h.id !== editing && h.date === form.date)
    if (dup) { setError(`"${dup.name}" is already set for this date.`); return }

    setSaving(true)
    try {
      if (editing) {
        await updateDoc(doc(db, 'hr_holidays', editing), { ...form })
        setHolidays(prev => prev.map(h => h.id === editing ? { ...h, ...form } : h).sort((a, b) => a.date.localeCompare(b.date)))
      } else {
        const newHoliday = { ...form, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'hr_holidays'), newHoliday)
        setHolidays(prev => [...prev, { id: ref.id, ...newHoliday }].sort((a, b) => a.date.localeCompare(b.date)))
      }
      setShowForm(false); resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (h) => {
    if (!window.confirm(`Remove "${h.name}" (${h.date})?`)) return
    try {
      await deleteDoc(doc(db, 'hr_holidays', h.id))
      setHolidays(prev => prev.filter(x => x.id !== h.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const years = Array.from(new Set(holidays.map(h => (h.date || '').slice(0, 4)))).filter(Boolean)
  if (!years.includes(String(new Date().getFullYear()))) years.push(String(new Date().getFullYear()))
  years.sort()

  const filtered = holidays.filter(h => (h.date || '').startsWith(String(yearFilter)))

  const formatDate = (d) => {
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) }
    catch { return d }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Holiday Calendar</h2>
          <p className="text-slate-500 text-sm">Company-wide holidays — feeds into Attendance (auto-marked) and Leave day counting (excluded).</p>
        </div>
        {hasHRAccess && (
          <button onClick={() => { setShowForm(!showForm); resetForm() }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ Add Holiday'}
          </button>
        )}
      </div>

      <select value={yearFilter} onChange={e => setYearFilter(Number(e.target.value))} className={`${inp} w-40`}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>

      {showForm && hasHRAccess && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Holiday' : 'Add Holiday'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Holiday Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Diwali, Republic Day" className={inp} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
              <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className={inp} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
              <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} className={inp}>
                <option value="public">Public Holiday</option>
                <option value="optional">Optional Holiday</option>
              </select>
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Holiday' : 'Add Holiday'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Holiday</th>
              <th className="text-left px-4 py-3">Type</th>
              {hasHRAccess && <th className="text-right px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(h => (
              <tr key={h.id}>
                <td className="px-4 py-3 text-slate-800 font-medium">{formatDate(h.date)}</td>
                <td className="px-4 py-3 text-slate-700">{h.name}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${h.type === 'optional' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                    {TYPE_LABELS[h.type] || h.type}
                  </span>
                </td>
                {hasHRAccess && (
                  <td className="px-4 py-3 text-right space-x-3">
                    <button onClick={() => handleEdit(h)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                    <button onClick={() => handleDelete(h)} className="text-red-600 hover:text-red-700 font-medium">🗑️ Delete</button>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={hasHRAccess ? 4 : 3} className="text-center py-8 text-slate-400">No holidays set for {yearFilter}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
