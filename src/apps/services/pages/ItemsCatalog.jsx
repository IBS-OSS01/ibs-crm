import React, { useState, useEffect, useRef } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import ItemsImportModal, { downloadItemsTemplate } from './ItemsImportModal'
import { makeSkuGenerator, parseImages } from '../utils/spareItems'
import { MAX_IMAGES, prepareSpareImage, listSpareImages, saveSpareImages, deleteSpareImage, kb } from '../utils/spareImages'
import { loadEquipment } from '../utils/equipmentMaster'
import ItemPhotos from '../components/ItemPhotos'

const EMPTY_FORM = { name: '', sku: '', specifications: '', make: '', equipmentName: '', unit: 'pcs', minStock: 0, imagesText: '', remarks: '', description: '' }

export default function ItemsCatalog() {
  const { user, userProfile } = useAuth()
  const [items, setItems] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [stocks, setStocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [equipment, setEquipment] = useState([])
  const [savedPics, setSavedPics] = useState([])   // photos already stored for the item being edited
  const [newPics, setNewPics] = useState([])       // photos picked in this form, shrunk, not saved yet
  const [removedPics, setRemovedPics] = useState([])
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoMsg, setPhotoMsg] = useState('')
  const picRef = useRef()
  const isManager = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)

  useEffect(() => { fetchItems(); loadEquipment().then(setEquipment).catch(() => {}) }, [])

  const fetchItems = async () => {
    try {
      const [snap, whSnap, stSnap] = await Promise.all([
        getDocs(collection(db, 'inventory_items')),
        getDocs(collection(db, 'inventory_warehouses')),
        getDocs(collection(db, 'inventory_stocks')),
      ])
      const data = [], whs = [], sts = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      whSnap.forEach(d => whs.push({ id: d.id, ...d.data() }))
      stSnap.forEach(d => sts.push({ id: d.id, ...d.data() }))
      setWarehouses(whs); setStocks(sts)
      setItems(data.filter(i => !i.isService).sort((a, b) => (a.name || '').localeCompare(b.name || '')))   // service / charge lines live in Finance only
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetPhotos = () => { setSavedPics([]); setNewPics([]); setRemovedPics([]); setPhotoMsg('') }
  const linkCount = () => parseImages(form.imagesText).length
  const photoTotal = () => savedPics.length + newPics.length + linkCount()

  const addPhotos = async (files) => {
    setPhotoMsg(''); setPhotoBusy(true)
    const room = MAX_IMAGES - photoTotal()
    const msgs = []
    if (files.length > room) msgs.push(`Only ${MAX_IMAGES} photos are allowed per item — ${room > 0 ? `the first ${room} were taken` : 'remove one first'}.`)
    for (const f of files.slice(0, Math.max(0, room))) {
      try {
        const p = await prepareSpareImage(f)
        setNewPics(prev => [...prev, p])
        msgs.push(`${f.name}: ${kb(f.size)} → ${kb(p.bytes)}`)
      } catch (err) { msgs.push(err.message) }
    }
    setPhotoMsg(msgs.join(' · '))
    setPhotoBusy(false)
    if (picRef.current) picRef.current.value = ''
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name) { setError('Item name is required.'); return }
    setSaving(true)
    try {
      if (photoTotal() > MAX_IMAGES) { setError(`At most ${MAX_IMAGES} photos per item (uploaded photos and photo links together).`); setSaving(false); return }
      const { imagesText, ...rest } = form
      const eq = equipment.find(x => x.name === form.equipmentName)
      const payload = {
        ...rest, sku: form.sku.trim() || makeSkuGenerator(items)(), minStock: parseInt(form.minStock) || 0, images: parseImages(imagesText),
        equipmentId: eq?.id || '', thumb: savedPics[0]?.thumb || newPics[0]?.thumb || '', imageCount: savedPics.length + newPics.length,
      }
      let savedId = editingId
      if (editingId) {
        await updateDoc(doc(db, 'inventory_items', editingId), {
          ...payload, updatedBy: user.uid, updatedAt: new Date().toISOString(),
        })
        setItems(prev => prev.map(i => i.id === editingId ? { ...i, ...payload } : i)
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      } else {
        const newItem = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const docRef = await addDoc(collection(db, 'inventory_items'), newItem)
        savedId = docRef.id
        setItems(prev => [...prev, { id: docRef.id, ...newItem }].sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      }
      for (const id of removedPics) await deleteSpareImage(id)
      if (newPics.length) await saveSpareImages(savedId, newPics, { user, profile: userProfile })
      resetPhotos()
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
      specifications: item.specifications || '',
      make: item.make || '',
      equipmentName: item.equipmentName || '',
      imagesText: (item.images || []).join('\n'),
      remarks: item.remarks || '',
      unit: item.unit || 'pcs',
      minStock: item.minStock ?? 0,
      description: item.description || '',
    })
    setEditingId(item.id)
    setShowForm(true)
    resetPhotos()
    if (item.imageCount) listSpareImages(item.id).then(setSavedPics).catch(err => setPhotoMsg('Could not load the saved photos: ' + err.message))
  }

  const handleAddNew = () => {
    if (showForm && !editingId) { setShowForm(false); return }
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(true)
    setError('')
    resetPhotos()
  }

  const handleCancelForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(false)
    setError('')
    resetPhotos()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this item?')) return
    try {
      const it = items.find(i => i.id === id)
      await deleteDoc(doc(db, 'inventory_items', id))
      if (it?.imageCount) listSpareImages(id).then(l => Promise.all(l.map(p => deleteSpareImage(p.id)))).catch(() => {})
      setItems(prev => prev.filter(i => i.id !== id))
    } catch (err) { alert('Error: ' + err.message) }
  }

  const filtered = items.filter(i =>
    !search || [i.name, i.sku, i.make, i.equipmentName, i.specifications].some(v => String(v || '').toLowerCase().includes(search.toLowerCase()))
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
            <button onClick={() => downloadItemsTemplate(warehouses)}
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
          warehouses={warehouses}
          existingStocks={stocks}
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Model Item Code</label>
              <input type="text" value={form.sku} onChange={e => setForm(p => ({ ...p, sku: e.target.value }))} autoComplete="off" placeholder="Leave empty — the next SP-number is given automatically"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Make</label>
              <input type="text" value={form.make} onChange={e => setForm(p => ({ ...p, make: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Equipment Name <span className="text-slate-400 font-normal">— from the Equipment Master</span></label>
              <select value={form.equipmentName} onChange={e => setForm(p => ({ ...p, equipmentName: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— select equipment —</option>
                {form.equipmentName && !equipment.some(x => x.name === form.equipmentName) && <option value={form.equipmentName}>{form.equipmentName} (not in master)</option>}
                {equipment.map(x => <option key={x.id} value={x.name}>{x.name}{x.make ? ` · ${x.make}` : ''}</option>)}
              </select>
              {equipment.length === 0 && <p className="text-xs text-amber-600 mt-1">The Equipment Master is empty — add equipment under Inventory → Equipment Master.</p>}
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Specifications and Models</label>
              <input type="text" value={form.specifications} onChange={e => setForm(p => ({ ...p, specifications: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Remarks</label>
              <input type="text" value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Photos <span className="text-slate-400 font-normal">— up to {MAX_IMAGES} per item; each is shrunk to a small size automatically ({photoTotal()} / {MAX_IMAGES} used)</span></label>
              <div className="flex flex-wrap gap-3 items-start">
                {savedPics.map(p => (
                  <div key={p.id} className="relative">
                    <img src={p.data} alt={p.name} className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                    <button type="button" title="Remove" onClick={() => { setSavedPics(l => l.filter(x => x.id !== p.id)); setRemovedPics(l => [...l, p.id]) }}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-xs leading-5">✕</button>
                    <p className="text-[10px] text-slate-400 text-center">{kb(p.bytes)}</p>
                  </div>
                ))}
                {newPics.map((p, n) => (
                  <div key={n} className="relative">
                    <img src={p.data} alt={p.name} className="w-20 h-20 object-cover rounded-lg border border-blue-300" />
                    <button type="button" title="Remove" onClick={() => setNewPics(l => l.filter((_, k) => k !== n))}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-xs leading-5">✕</button>
                    <p className="text-[10px] text-blue-500 text-center">new · {kb(p.bytes)}</p>
                  </div>
                ))}
                {photoTotal() < MAX_IMAGES && (
                  <button type="button" disabled={photoBusy} onClick={() => picRef.current?.click()}
                    className="w-20 h-20 border-2 border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600 transition disabled:opacity-50">
                    {photoBusy ? 'Shrinking…' : '＋ Photo'}
                  </button>
                )}
                <input ref={picRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addPhotos([...e.target.files])} />
              </div>
              {photoMsg && <p className="text-xs text-slate-500 mt-1">{photoMsg}</p>}
              <label className="block text-xs font-medium text-slate-500 mt-3 mb-1">Photo links <span className="text-slate-400 font-normal">— optional, one per line (counts towards the {MAX_IMAGES})</span></label>
              <textarea rows={2} value={form.imagesText} onChange={e => setForm(p => ({ ...p, imagesText: e.target.value }))}
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
      <input type="text" placeholder="Search name, code, make, equipment..." value={search} onChange={e => setSearch(e.target.value)}
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
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Specifications / Models</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Make</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Equipment</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Model Item Code</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Unit</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Min Stock</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Photos</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Remarks</th>
                {isManager && <th className="px-4 py-3 text-left text-slate-600 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{item.name || item.itemName}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{item.specifications || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{item.make || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{item.equipmentName || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.sku}</td>
                  <td className="px-4 py-3 text-slate-600">{item.unit || 'pcs'}</td>
                  <td className="px-4 py-3 text-slate-600">{item.minStock ?? 0}</td>
                  <td className="px-4 py-3"><ItemPhotos item={item} /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{item.remarks || item.description || '—'}</td>
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
