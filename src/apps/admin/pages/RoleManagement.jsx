import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { ensureDefaultRoles } from '../defaultRoles'

// Same module list used in UserManagement's per-user "Module Access" toggles.
const MODULES = ['CRM', 'SERVICES', 'HR', 'PROJECTS', 'FINANCE']
const emptyForm = { name: '', departments: [] }

export default function RoleManagement() {
  const { userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const [roles, setRoles] = useState([])
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
      await ensureDefaultRoles(db)
      const snap = await getDocs(collection(db, 'roles'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setRoles(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const toggleDept = (dept) => {
    setForm(prev => ({
      ...prev,
      departments: prev.departments.includes(dept)
        ? prev.departments.filter(d => d !== dept)
        : [...prev.departments, dept],
    }))
  }

  const handleEdit = (r) => {
    setEditing(r.id)
    setForm({ name: r.name || '', departments: r.departments || [] })
    setShowForm(true)
    setSuccess('')
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!form.name.trim()) { setError('Role name is required.'); return }

    setSaving(true)
    try {
      if (editing) {
        await updateDoc(doc(db, 'roles', editing), { name: form.name, departments: form.departments })
        setRoles(prev => prev.map(r => r.id === editing ? { ...r, name: form.name, departments: form.departments } : r))
        setSuccess('Role updated.')
      } else {
        const ref = await addDoc(collection(db, 'roles'), {
          name: form.name,
          departments: form.departments,
          isSystem: false,
          createdAt: new Date().toISOString(),
        })
        setRoles(prev => [...prev, { id: ref.id, name: form.name, departments: form.departments, isSystem: false }])
        setSuccess('Role created — it now shows up in the Role dropdown on the Users tab.')
      }
      setShowForm(false)
      resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (r) => {
    if (r.isSystem) return
    if (!window.confirm(`Delete the "${r.name}" role? Anyone currently assigned it keeps it on their profile, but it will no longer appear in the dropdown for new assignments.`)) return
    try {
      await deleteDoc(doc(db, 'roles', r.id))
      setRoles(prev => prev.filter(x => x.id !== r.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          <p className="text-4xl mb-3">🔒</p>
          <p>Only Admins can manage roles.</p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Roles</h2>
          <p className="text-slate-500 text-sm">Define the roles your organisation uses and which modules each one opens by default.</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); resetForm() }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
        >
          {showForm && !editing ? '✕ Cancel' : '+ Add Role'}
        </button>
      </div>

      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Role' : 'Add New Role'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Sales Manager, Warehouse Staff, Accountant"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>

            {editing === 'admin' ? (
              <p className="text-xs text-slate-400">Admin automatically gets every module — there's nothing to configure here.</p>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Default Module Access</label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {MODULES.map(d => (
                    <button type="button" key={d} onClick={() => toggleDept(d)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${form.departments.includes(d) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                      {d}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1">Applied automatically when this role is picked for a new user — still adjustable per person on the Users tab.</p>
              </div>
            )}

            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Role' : 'Create Role'}
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
              <th className="text-left px-4 py-3">Role Name</th>
              <th className="text-left px-4 py-3">Default Module Access</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roles.map(r => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                <td className="px-4 py-3 text-slate-500">{r.id === 'admin' ? 'All modules' : (r.departments || []).join(', ') || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${r.isSystem ? 'bg-slate-100 text-slate-500' : 'bg-blue-100 text-blue-700'}`}>
                    {r.isSystem ? 'Built-in' : 'Custom'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button onClick={() => handleEdit(r)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                  <button
                    onClick={() => handleDelete(r)}
                    disabled={r.isSystem}
                    title={r.isSystem ? "Built-in roles can't be deleted." : ''}
                    className={`font-medium ${r.isSystem ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:text-red-700'}`}
                  >
                    🗑️ Delete
                  </button>
                </td>
              </tr>
            ))}
            {roles.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-slate-400">No roles yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
