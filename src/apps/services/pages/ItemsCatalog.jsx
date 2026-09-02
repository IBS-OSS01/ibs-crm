import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import ItemsImportModal, { downloadItemsTemplate } from './ItemsImportModal'

const EMPTY_FORM = { name: '', sku: '', unit: 'pcs', minStock: 0, description: '' }

export default function ItemsCatalog() {
  const { user, userProfile } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isManager = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)

  useEffect(() => { fetchItems() }, [])

  const fetchItems = async () => {
    try {
      const snap = await getDocs(collection(db, 'inventory_items'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setItems(data.sort((a, b) => (a.name || '').localeCompare(b.name || '')))
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name || !form.sku) { setError('Name and SKU are required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, minStock: parseInt(form.minStock) || 0 }
      if (editingId) {
        await updateDoc(doc(db, 'inventory_items', editingId), {
          ...payload, updatedBy: user.uid, updatedAt: new Date().toISOString(),
        })
        setItems(prev => prev.map(i => i.id === editingId ? { ...i, ...payload } : i)
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      } else {
        const newItem = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const docRef = await addDoc(collection(db, 'inventory_items'), newItem)
        setItems(prev => [...prev, { id: docRef.id, ...newItem }].sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      }
      setForm(EMPTY_FORM)
      setEditingId(null)
      setShowForm(false)
      setError('')
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleEdit = (item) => {
    setForm({
      name: item.name || item.itemName || '',
      sku: item.sku || '',
      unit: item.unit || 'pcs',
      minStock: item.minStock ?? 0,
      description: item.description || '',
    })
    setEditingId(item.id)
    setShowForm(true)
  }

  const handleAddNew = () => {
    if (showForm && !editingId) { setShowForm(false); return }
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(true)
    setError('')
  }

  const handleCancelForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(false)
    setError('')
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this item?')) return
    try {
      await deleteDoc(doc(db, 'inventory_items', id))
      setItems(prev => prev.filter(i => i.id !== id))
    } catch (err) { alert('Error: ' + err.message) }
  }

  const filtered = items.filter(i =>
    !search || i.name?.toLowerCase().includes(search.toLowerCase()) || i.sku?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading catalog...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Items (Model Catalog)</h2>
          <p className="text-slate-500 text-sm">{items.length} items in catalog</p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <button onClick={downloadItemsTemplate}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition">
              ⬇ Template
            </button>
            <button onClick={() => setShowImport(true)}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition">
              ⬆ Import
            </button>
            <button onClick={handleAddNew}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
              {showForm && !editingId ? '✕ Cancel' : '+ Add Item'}
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <ItemsImportModal
          existingItems={items}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); fetchItems() }}
        />
      )}

      {/* Add / Edit Item Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editingId ? 'Edit Item' : 'Add New Item'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Item Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SKU *</label>
              <input type="text" value={form.sku} onChange={e => setForm(p => ({ ...p, sku: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
              <select value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="pcs">Pieces</option>
                <option value="kg">Kilograms</option>
                <option value="ltr">Litres</option>
                <option value="mtr">Meters</option>
                <option value="box">Box</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Min Stock Level</label>
              <input type="number" value={form.minStock} onChange={e => setForm(p => ({ ...p, minStock: e.target.value }))} min="0"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <input type="text" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update Item' : 'Save Item'}
              </button>
              <button type="button" onClick={handleCancelForm}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <input type="text" placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)}
        className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-72" />

      {/* Items Table */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <p className="text-4xl mb-3">🗂️</p>
            <p>{items.length === 0 ? 'No items in catalog yet' : 'No items match your search'}</p>
            {isManager && items.length === 0 && (
              <button onClick={() => setShowForm(true)} className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
                Add First Item
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Item Name</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">SKU</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Unit</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Min Stock</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Description</th>
                {isManager && <th className="px-4 py-3 text-left text-slate-600 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{item.name || item.itemName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.sku}</td>
                  <td className="px-4 py-3 text-slate-600">{item.unit || 'pcs'}</td>
                  <td className="px-4 py-3 text-slate-600">{item.minStock ?? 0}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{item.description || '—'}</td>
                  {isManager && (
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button onClick={() => handleEdit(item)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                        <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:text-red-700 text-xs">Delete</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
