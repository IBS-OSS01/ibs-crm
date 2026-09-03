import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'

const CATEGORIES = ['Laptop', 'Mobile', 'SIM', 'Vehicle', 'Other']
const STATUS_DISPLAY = {
  available:   { label: 'Available',   cls: 'bg-green-100 text-green-700' },
  assigned:    { label: 'Assigned',    cls: 'bg-blue-100 text-blue-700' },
  maintenance: { label: 'Maintenance', cls: 'bg-amber-100 text-amber-700' },
  retired:     { label: 'Retired',     cls: 'bg-slate-100 text-slate-500' },
}
const emptyForm = { assetTag: '', category: 'Laptop', name: '', purchaseDate: '', purchaseCost: '' }
const inp = 'w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function AssetManagement() {
  const { user, userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const hasHRAccess = userProfile?.role === 'admin' || canEdit('HR')

  const [assets, setAssets] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [assigningId, setAssigningId] = useState(null)
  const [assignTo, setAssignTo] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [assetSnap, empSnap] = await Promise.all([
        getDocs(collection(db, 'hr_assets')),
        getDocs(collection(db, 'hr_employees')),
      ])
      const a = []; assetSnap.forEach(d => a.push({ id: d.id, ...d.data() }))
      a.sort((x, y) => (x.assetTag || '').localeCompare(y.assetTag || ''))
      setAssets(a)
      const e = []; empSnap.forEach(d => e.push({ id: d.id, ...d.data() }))
      e.sort((x, y) => (x.name || '').localeCompare(y.name || ''))
      setEmployees(e.filter(x => x.active !== false))
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleEdit = (a) => {
    setEditing(a.id)
    setForm({ assetTag: a.assetTag || '', category: a.category || 'Laptop', name: a.name || '', purchaseDate: a.purchaseDate || '', purchaseCost: a.purchaseCost ?? '' })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.assetTag.trim() || !form.name.trim()) { setError('Asset tag and name are required.'); return }
    setSaving(true)
    try {
      if (editing) {
        await updateDoc(doc(db, 'hr_assets', editing), { ...form, purchaseCost: Number(form.purchaseCost) || 0 })
        setAssets(prev => prev.map(a => a.id === editing ? { ...a, ...form, purchaseCost: Number(form.purchaseCost) || 0 } : a))
      } else {
        const newAsset = { ...form, purchaseCost: Number(form.purchaseCost) || 0, status: 'available', assignedToEmployeeId: null, assignedToEmployeeName: null, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'hr_assets'), newAsset)
        setAssets(prev => [...prev, { id: ref.id, ...newAsset }])
      }
      setShowForm(false); resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (a) => {
    if (!window.confirm(`Remove asset "${a.name}" (${a.assetTag}) permanently?`)) return
    try {
      await deleteDoc(doc(db, 'hr_assets', a.id))
      setAssets(prev => prev.filter(x => x.id !== a.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleAssign = async (assetId) => {
    if (!assignTo) return
    const emp = employees.find(x => x.id === assignTo)
    try {
      const patch = { status: 'assigned', assignedToEmployeeId: assignTo, assignedToEmployeeName: emp?.name || '', assignedAt: new Date().toISOString() }
      await updateDoc(doc(db, 'hr_assets', assetId), patch)
      setAssets(prev => prev.map(a => a.id === assetId ? { ...a, ...patch } : a))
      setAssigningId(null); setAssignTo('')
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleReturn = async (a) => {
    const notes = window.prompt(`Condition notes for returning "${a.name}"? (optional)`, '') || ''
    try {
      const patch = { status: 'available', assignedToEmployeeId: null, assignedToEmployeeName: null, conditionNotes: notes, returnedAt: new Date().toISOString() }
      await updateDoc(doc(db, 'hr_assets', a.id), patch)
      setAssets(prev => prev.map(x => x.id === a.id ? { ...x, ...patch } : x))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const filtered = assets.filter(a => {
    const q = search.toLowerCase()
    const matchQ = !q || (a.name || '').toLowerCase().includes(q) || (a.assetTag || '').toLowerCase().includes(q) || (a.assignedToEmployeeName || '').toLowerCase().includes(q)
    const matchStatus = !statusFilter || a.status === statusFilter
    return matchQ && matchStatus
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Asset Management</h2>
          <p className="text-slate-500 text-sm">{assets.filter(a => a.status === 'assigned').length} assigned · {assets.length} total</p>
        </div>
        {hasHRAccess && (
          <button onClick={() => { setShowForm(!showForm); resetForm() }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ Add Asset'}
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tag, name, or assignee..."
          className={`${inp} flex-1 min-w-48`} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inp} w-40`}>
          <option value="">All Statuses</option>
          {Object.entries(STATUS_DISPLAY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {showForm && hasHRAccess && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Asset' : 'Add New Asset'}</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Asset Tag / Serial *</label>
              <input type="text" value={form.assetTag} onChange={e => setForm(p => ({ ...p, assetTag: e.target.value }))}
                placeholder="e.g. LAP-014" className={inp} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Name / Model *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Dell Latitude 5420" className={inp} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Purchase Date</label>
              <input type="date" value={form.purchaseDate} onChange={e => setForm(p => ({ ...p, purchaseDate: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Purchase Cost (₹)</label>
              <input type="number" min="0" value={form.purchaseCost} onChange={e => setForm(p => ({ ...p, purchaseCost: e.target.value }))} className={inp} />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Asset' : 'Add Asset'}
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
              <th className="text-left px-4 py-3">Tag</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Assigned To</th>
              {hasHRAccess && <th className="text-right px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(a => (
              <tr key={a.id}>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{a.assetTag}</td>
                <td className="px-4 py-3 text-slate-600">{a.category}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{a.name}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${STATUS_DISPLAY[a.status]?.cls || 'bg-slate-100 text-slate-500'}`}>
                    {STATUS_DISPLAY[a.status]?.label || a.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{a.assignedToEmployeeName || '—'}</td>
                {hasHRAccess && (
                  <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                    {a.status === 'available' && assigningId !== a.id && (
                      <button onClick={() => { setAssigningId(a.id); setAssignTo('') }} className="text-green-600 hover:text-green-700 font-medium">📤 Assign</button>
                    )}
                    {assigningId === a.id && (
                      <span className="inline-flex items-center gap-1">
                        <select value={assignTo} onChange={e => setAssignTo(e.target.value)} className="px-2 py-1 border border-slate-300 rounded-lg text-xs">
                          <option value="">Select employee</option>
                          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                        <button onClick={() => handleAssign(a.id)} className="text-green-600 hover:text-green-700 font-medium text-xs">✔</button>
                        <button onClick={() => setAssigningId(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                      </span>
                    )}
                    {a.status === 'assigned' && (
                      <button onClick={() => handleReturn(a)} className="text-amber-600 hover:text-amber-700 font-medium">📥 Return</button>
                    )}
                    <button onClick={() => handleEdit(a)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                    <button onClick={() => handleDelete(a)} className="text-red-600 hover:text-red-700 font-medium">🗑️</button>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={hasHRAccess ? 6 : 5} className="text-center py-8 text-slate-400">No assets found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
