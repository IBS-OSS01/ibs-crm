import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { ensureDefaultDepartments } from '../defaultDepartments'

const emptyForm = { name: '' }

// Turns a display name into a stable, code-friendly id — matches the
// convention used by roles (RoleManagement.jsx).
const slugify = (name) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const uniqueSlug = (base, existingIds) => {
  if (!existingIds.includes(base)) return base
  let n = 2
  while (existingIds.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}

export default function DepartmentManagement() {
  const { userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  const load = async () => {
    setLoading(true)
    try {
      await ensureDefaultDepartments(db)
      const snap = await getDocs(collection(db, 'departments'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setDepartments(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleEdit = (d) => {
    setEditing(d.id)
    setForm({ name: d.name || '' })
    setShowForm(true)
    setSuccess('')
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    const name = form.name.trim()
    if (!name) { setError('Department name is required.'); return }
    const dup = departments.find(d => d.id !== editing && (d.name || '').toLowerCase() === name.toLowerCase())
    if (dup) { setError(`"${dup.name}" already exists.`); return }

    setSaving(true)
    try {
      if (editing) {
        const oldName = departments.find(d => d.id === editing)?.name
        await updateDoc(doc(db, 'departments', editing), { name })
        setDepartments(prev => prev.map(d => d.id === editing ? { ...d, name } : d))
        // Renaming a department only changes the picklist entry going
        // forward — existing hr_employees.department values keep the old
        // text rather than being silently rewritten everywhere.
        if (oldName && oldName !== name) {
          setSuccess(`Renamed to "${name}". Employees already set to "${oldName}" keep that value until you re-save their profile.`)
        } else {
          setSuccess('Department updated.')
        }
      } else {
        const slug = uniqueSlug(slugify(name), departments.map(d => d.id))
        const deptData = { name, isSystem: false, createdAt: new Date().toISOString() }
        await setDoc(doc(db, 'departments', slug), deptData)
        setDepartments(prev => [...prev, { id: slug, ...deptData }])
        setSuccess('Department created — it now shows up in the Department dropdown on the Employees tab.')
      }
      setShowForm(false)
      resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (d) => {
    if (d.isSystem) return
    if (!window.confirm(`Delete the "${d.name}" department? Anyone currently set to it keeps that value on their profile, but it will no longer appear in the dropdown for new picks.`)) return
    try {
      await deleteDoc(doc(db, 'departments', d.id))
      setDepartments(prev => prev.filter(x => x.id !== d.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          <p className="text-4xl mb-3">🔒</p>
          <p>Only Admins can manage departments.</p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Departments</h2>
          <p className="text-slate-500 text-sm">Define the departments available on the Employees "Department" dropdown.</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); resetForm() }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
        >
          {showForm && !editing ? '✕ Cancel' : '+ Add Department'}
        </button>
      </div>

      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Department' : 'Add New Department'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Department Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Marketing, Logistics, Quality Control"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Department' : 'Create Department'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Department Name</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {departments.map(d => (
              <tr key={d.id}>
                <td className="px-4 py-3 font-medium text-slate-800">{d.name}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${d.isSystem ? 'bg-slate-100 text-slate-500' : 'bg-blue-100 text-blue-700'}`}>
                    {d.isSystem ? 'Built-in' : 'Custom'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button onClick={() => handleEdit(d)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                  <button
                    onClick={() => handleDelete(d)}
                    disabled={d.isSystem}
                    title={d.isSystem ? "Built-in departments can't be deleted." : ''}
                    className={`font-medium ${d.isSystem ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:text-red-700'}`}
                  >
                    🗑️ Delete
                  </button>
                </td>
              </tr>
            ))}
            {departments.length === 0 && (
              <tr><td colSpan={3} className="text-center py-8 text-slate-400">No departments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
