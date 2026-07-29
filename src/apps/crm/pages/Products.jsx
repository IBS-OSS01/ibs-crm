import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

// Brands Rutvi Enterprises distributes — kept as a quick-pick list, "Other" covers anything new.
const BRANDS = ['Patanjali', 'Nilons', 'Pulse', 'Other']
const UNITS = ['pcs', 'box', 'carton', 'kg', 'litre', 'pack']

const emptyForm = { name: '', brand: 'Patanjali', unit: 'pcs', rate: '', active: true }

export default function Products() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'crm_products'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setProducts(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleEdit = (p) => {
    setEditing(p.id)
    setForm({ name: p.name || '', brand: p.brand || 'Patanjali', unit: p.unit || 'pcs', rate: p.rate ?? '', active: p.active !== false })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Product name is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, rate: Number(form.rate) || 0 }
      if (editing) {
        await updateDoc(doc(db, 'crm_products', editing), { ...payload, updatedAt: new Date().toISOString() })
        setProducts(prev => prev.map(p => p.id === editing ? { ...p, ...payload } : p))
      } else {
        const newProd = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'crm_products'), newProd)
        setProducts(prev => [...prev, { id: ref.id, ...newProd }])
      }
      setShowForm(false)
      resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (p) => {
    if (!window.confirm(`Remove "${p.name}" from the catalog? Past orders keep their recorded amounts.`)) return
    try {
      await deleteDoc(doc(db, 'crm_products', p.id))
      setProducts(prev => prev.filter(x => x.id !== p.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const filtered = products.filter(p => {
    const q = search.toLowerCase()
    return !q || (p.name || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Products</h2>
          <p className="text-slate-500 text-sm">{products.length} items in catalog</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); resetForm() }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm && !editing ? '✕ Cancel' : '+ Add Product'}
        </button>
      </div>

      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by product name or brand..."
        className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Product' : 'Add New Product'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Product Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoComplete="off"
                placeholder="e.g. Patanjali Atta 5kg"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Brand</label>
              <select value={form.brand} onChange={e => setForm(p => ({ ...p, brand: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
              <select value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Rate (₹ per unit)</label>
              <input type="number" value={form.rate} onChange={e => setForm(p => ({ ...p, rate: e.target.value }))} autoComplete="off"
                min="0" step="0.01" className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} id="prod-active" />
              <label htmlFor="prod-active" className="text-sm text-slate-700">Active product</label>
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Product' : 'Add Product'}
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
              <th className="text-left px-4 py-3">Product</th>
              <th className="text-left px-4 py-3">Brand</th>
              <th className="text-left px-4 py-3">Unit</th>
              <th className="text-right px-4 py-3">Rate</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(p => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                <td className="px-4 py-3 text-slate-600">{p.brand || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{p.unit || '—'}</td>
                <td className="px-4 py-3 text-right text-slate-700">₹{(Number(p.rate) || 0).toLocaleString('en-IN')}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${p.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {p.active !== false ? '● Active' : '● Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  <button onClick={() => handleEdit(p)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                  {isAdmin && (
                    <button onClick={() => handleDelete(p)} className="text-red-600 hover:text-red-700 font-medium">🗑️ Delete</button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">No products found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
