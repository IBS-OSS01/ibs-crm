import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

export default function Locations() {
  const { user, userProfile } = useAuth()
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', city: '', address: '', manager: '', phone: '', active: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isAdmin = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)

  useEffect(() => { fetchLocations() }, [])

  const fetchLocations = async () => {
    try {
      const snap = await getDocs(collection(db, 'inventory_warehouses'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setLocations(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleEdit = (loc) => {
    setEditing(loc.id)
    setForm({ name: loc.name || '', city: loc.city || '', address: loc.address || '', manager: loc.manager || '', phone: loc.phone || '', active: loc.active !== false })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name) { setError('Name is required.'); return }
    setSaving(true)
    try {
      if (editing) {
        await updateDoc(doc(db, 'inventory_warehouses', editing), { ...form, updatedAt: new Date().toISOString() })
        setLocations(prev => prev.map(l => l.id === editing ? { ...l, ...form } : l))
      } else {
        const newLoc = { ...form, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'inventory_warehouses'), newLoc)
        setLocations(prev => [...prev, { id: ref.id, ...newLoc }])
      }
      setShowForm(false)
      setEditing(null)
      setForm({ name: '', city: '', address: '', manager: '', phone: '', active: true })
      setError('')
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const cityIcon = (city) => {
    if (!city) return '🏭'
    if (city.toLowerCase().includes('pune')) return '🏭'
    if (city.toLowerCase().includes('hyderabad')) return '🏗️'
    if (city.toLowerCase().includes('mumbai')) return '🏢'
    if (city.toLowerCase().includes('delhi')) return '🏛️'
    return '📍'
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Warehouses</h2>
          <p className="text-slate-500 text-sm">{locations.length} warehouses / sites</p>
        </div>
        {isAdmin && (
          <button onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ name: '', city: '', address: '', manager: '', phone: '', active: true }) }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ Add Warehouse'}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Warehouse' : 'Add New Warehouse'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Location Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoComplete="off"
                placeholder="e.g. Central Warehouse"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
              <input type="text" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} autoComplete="off"
                placeholder="e.g. Pune"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
              <input type="text" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Site Manager</label>
              <input type="text" value={form.manager} onChange={e => setForm(p => ({ ...p, manager: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} id="active" />
              <label htmlFor="active" className="text-sm text-slate-700">Active location</label>
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Warehouse' : 'Add Warehouse'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditing(null) }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Locations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {locations.map(loc => (
          <div key={loc.id} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{cityIcon(loc.city)}</span>
                <div>
                  <h3 className="font-bold text-slate-800">{loc.name || loc.id}</h3>
                  <p className="text-sm text-slate-500">{loc.city || '—'}</p>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${loc.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {loc.active !== false ? '● Active' : '● Inactive'}
              </span>
            </div>

            <div className="mt-4 space-y-1 text-sm text-slate-600">
              {loc.address && <p>📌 {loc.address}</p>}
              {loc.manager && <p>👤 {loc.manager}</p>}
              {loc.phone && <p>📞 {loc.phone}</p>}
              <p className="text-xs text-slate-400 font-mono">ID: {loc.id}</p>
            </div>

            {isAdmin && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <button onClick={() => handleEdit(loc)}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                  ✏️ Edit
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
