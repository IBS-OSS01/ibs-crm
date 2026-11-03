import React, { useEffect, useState } from 'react'
import { collection, getDocs } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { loadEquipment, saveEquipment, newEquipmentId, eqKey } from '../utils/equipmentMaster'

const EMPTY = { name: '', make: '', model: '', remarks: '' }
const inputCls = 'w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function EquipmentMaster() {
  const { userProfile } = useAuth()
  const canEdit = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)
  const [list, setList] = useState([])
  const [used, setUsed] = useState({})            // equipment key → number of spare parts using it
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [eq, itemSnap] = await Promise.all([loadEquipment(), getDocs(collection(db, 'inventory_items'))])
        const counts = {}
        itemSnap.forEach(d => { const k = eqKey(d.data().equipmentName); if (k) counts[k] = (counts[k] || 0) + 1 })
        setList(eq); setUsed(counts)
      } catch (e) { setError('Could not load the equipment list: ' + e.message) }
      finally { setLoading(false) }
    })()
  }, [])

  const persist = async (next) => {
    try { await saveEquipment(next); setList(next.slice().sort((a, b) => a.name.localeCompare(b.name))); return true }
    catch (e) { setError(/permission/i.test(e.message) ? 'You are not allowed to change the equipment master.' : 'Could not save: ' + e.message); return false }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) { setError('Equipment name is required.'); return }
    if (list.some(x => x.id !== editingId && eqKey(x.name) === eqKey(name))) { setError('That equipment is already in the master.'); return }
    setSaving(true); setError('')
    const rec = { id: editingId || newEquipmentId(), name, make: form.make.trim(), model: form.model.trim(), remarks: form.remarks.trim() }
    const next = editingId ? list.map(x => x.id === editingId ? rec : x) : [...list, rec]
    if (await persist(next)) { setForm(EMPTY); setEditingId(null); setShowForm(false) }
    setSaving(false)
  }

  const handleEdit = (x) => { setForm({ name: x.name, make: x.make || '', model: x.model || '', remarks: x.remarks || '' }); setEditingId(x.id); setShowForm(true); setError('') }
  const handleDelete = async (x) => {
    const n = used[eqKey(x.name)] || 0
    if (!confirm(n ? `${n} spare part(s) use “${x.name}”. They keep the name, but it will no longer be in the list. Delete it?` : `Delete “${x.name}”?`)) return
    await persist(list.filter(y => y.id !== x.id))
  }

  const filtered = list.filter(x => !search || [x.name, x.make, x.model, x.remarks].some(v => String(v || '').toLowerCase().includes(search.toLowerCase())))

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading equipment…</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Equipment Master</h2>
          <p className="text-slate-500 text-sm">{list.length} equipment · each spare part picks its Equipment Name from this list</p>
        </div>
        {canEdit && (
          <button onClick={() => { if (showForm && !editingId) { setShowForm(false); return } setForm(EMPTY); setEditingId(null); setShowForm(true); setError('') }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editingId ? '✕ Cancel' : '+ Add Equipment'}
          </button>
        )}
      </div>

      {!canEdit && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">Only an administrator, service manager or project manager can add or change equipment. You can still pick from this list on every spare part.</div>}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {showForm && canEdit && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editingId ? 'Edit Equipment' : 'Add Equipment'}</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Equipment Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} autoComplete="off" className={inputCls} autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Make</label>
              <input type="text" value={form.make} onChange={e => setForm(p => ({ ...p, make: e.target.value }))} autoComplete="off" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Model / Type</label>
              <input type="text" value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} autoComplete="off" className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Remarks</label>
              <input type="text" value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} autoComplete="off" className={inputCls} />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving…' : editingId ? 'Update Equipment' : 'Save Equipment'}
              </button>
              <button type="button" onClick={() => { setForm(EMPTY); setEditingId(null); setShowForm(false); setError('') }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <input type="text" placeholder="Search equipment…" value={search} onChange={e => setSearch(e.target.value)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-72" />

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <p className="text-4xl mb-3">⚙️</p>
            <p>{list.length === 0 ? 'No equipment yet' : 'No equipment matches your search'}</p>
            {canEdit && list.length === 0 && <p className="text-sm mt-1">Add the machines your spare parts belong to — e.g. Conveyor Drive Motor, Cooling Tower Fan</p>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Equipment Name</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Make</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Model / Type</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Remarks</th>
                <th className="px-4 py-3 text-left text-slate-600 font-medium">Spare parts</th>
                {canEdit && <th className="px-4 py-3 text-left text-slate-600 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(x => (
                <tr key={x.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{x.name}</td>
                  <td className="px-4 py-3 text-slate-600">{x.make || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{x.model || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{x.remarks || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{used[eqKey(x.name)] || 0}</td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button onClick={() => handleEdit(x)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                        <button onClick={() => handleDelete(x)} className="text-red-500 hover:text-red-700 text-xs">Delete</button>
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
