import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

// Pre-seed codes for conveyor / automation / electrical equipment business
const SEED_CODES = [
  { code: '84283300', type: 'HSN', description: 'Belt type continuous action elevators & conveyors for goods',       gstRate: 18 },
  { code: '84289090', type: 'HSN', description: 'Other lifting, handling, loading or unloading machinery',          gstRate: 18 },
  { code: '84834000', type: 'HSN', description: 'Gear boxes, speed changers, torque converters',                    gstRate: 18 },
  { code: '84821000', type: 'HSN', description: 'Ball bearings',                                                    gstRate: 18 },
  { code: '84829900', type: 'HSN', description: 'Parts of bearings',                                                gstRate: 18 },
  { code: '84819000', type: 'HSN', description: 'Parts of industrial valves',                                       gstRate: 18 },
  { code: '84798990', type: 'HSN', description: 'Other machinery / mechanical appliances NEC',                      gstRate: 18 },
  { code: '85371000', type: 'HSN', description: 'Boards, panels, consoles for electric control (≤ 1000V)',         gstRate: 18 },
  { code: '85444929', type: 'HSN', description: 'Electrical conductors / wiring harness for other use',            gstRate: 18 },
  { code: '85366900', type: 'HSN', description: 'Plugs, sockets and other connectors',                             gstRate: 18 },
  { code: '85411000', type: 'HSN', description: 'Diodes (other than photosensitive)',                               gstRate: 18 },
  { code: '73181900', type: 'HSN', description: 'Bolts, nuts, screws — iron/steel (threaded articles)',             gstRate: 18 },
  { code: '72159090', type: 'HSN', description: 'Steel bars / rods (for structural/conveyor frames)',               gstRate: 18 },
  { code: '39269099', type: 'HSN', description: 'Other articles of plastics (conveyor components)',                 gstRate: 18 },
  { code: '998711',   type: 'SAC', description: 'Maintenance & repair of fabricated metal products',                gstRate: 18 },
  { code: '998729',   type: 'SAC', description: 'Maintenance & repair of other machinery & equipment',              gstRate: 18 },
  { code: '998312',   type: 'SAC', description: 'Technical testing, inspection & certification services',           gstRate: 18 },
  { code: '998314',   type: 'SAC', description: 'Engineering design & consultancy services',                        gstRate: 18 },
  { code: '998511',   type: 'SAC', description: 'Labour / manpower supply services',                                gstRate: 18 },
]

const GST_RATES = [0, 0.25, 1, 1.5, 3, 5, 7.5, 12, 18, 28]
const empty = { code: '', type: 'HSN', description: '', gstRate: 18 }
const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function HsnCodes() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'finance_hsn_codes'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.code || '').localeCompare(b.code || ''))
      setCodes(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const handleSeed = async () => {
    if (!window.confirm(`Load ${SEED_CODES.length} standard HSN/SAC codes for conveyor & automation equipment? Existing codes won't be overwritten.`)) return
    setSeeding(true)
    try {
      const existing = new Set(codes.map(c => c.code))
      const toAdd = SEED_CODES.filter(s => !existing.has(s.code))
      const adds = toAdd.map(s => addDoc(collection(db, 'finance_hsn_codes'), {
        ...s, createdBy: user?.uid || 'seed', createdAt: new Date().toISOString()
      }))
      await Promise.all(adds)
      await load()
    } catch (e) { alert('Error: ' + e.message) }
    finally { setSeeding(false) }
  }

  const handleEdit = (c) => {
    setEditing(c.id)
    setForm({ code: c.code || '', type: c.type || 'HSN', description: c.description || '', gstRate: c.gstRate ?? 18 })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.code.trim()) { setError('HSN/SAC code is required'); return }
    if (!form.description.trim()) { setError('Description is required'); return }
    setSaving(true)
    try {
      const payload = { ...form, gstRate: Number(form.gstRate) }
      if (editing) {
        await updateDoc(doc(db, 'finance_hsn_codes', editing), { ...payload, updatedAt: new Date().toISOString() })
        setCodes(prev => prev.map(c => c.id === editing ? { ...c, ...payload } : c))
      } else {
        const ref = await addDoc(collection(db, 'finance_hsn_codes'), { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() })
        setCodes(prev => [...prev, { id: ref.id, ...payload }])
      }
      setShowForm(false); setEditing(null); setForm(empty)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete ${c.code}?`)) return
    await deleteDoc(doc(db, 'finance_hsn_codes', c.id))
    setCodes(prev => prev.filter(x => x.id !== c.id))
  }

  const filtered = codes.filter(c => {
    const q = search.toLowerCase()
    const matchQ = !q || (c.code || '').includes(q) || (c.description || '').toLowerCase().includes(q)
    const matchT = typeFilter === 'all' || c.type === typeFilter
    return matchQ && matchT
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">HSN / SAC Code Master</h2>
          <p className="text-slate-500 text-sm">Map codes to GST % — auto-fills during invoice creation</p>
        </div>
        <div className="flex gap-2">
          {codes.length === 0 && (
            <button onClick={handleSeed} disabled={seeding}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
              {seeding ? 'Loading…' : '⚡ Load Standard Codes'}
            </button>
          )}
          <button onClick={() => { setShowForm(!showForm); setEditing(null); setForm(empty) }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ Add Code'}
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search code or description…"
          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All types</option>
          <option value="HSN">HSN (Goods)</option>
          <option value="SAC">SAC (Services)</option>
        </select>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Code' : 'Add HSN / SAC Code'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <select className={inp} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                <option>HSN</option>
                <option>SAC</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Code *</label>
              <input className={inp} value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder="e.g. 84283300" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">GST Rate %</label>
              <select className={inp} value={form.gstRate} onChange={e => setForm(p => ({ ...p, gstRate: Number(e.target.value) }))}>
                {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Description *</label>
              <input className={inp} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} required />
            </div>
            <div className="col-span-3 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {saving ? 'Saving…' : editing ? 'Update' : 'Add Code'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); setForm(empty) }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3 w-20">Type</th>
              <th className="text-left px-4 py-3 w-32">Code</th>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-center px-4 py-3 w-24">IGST %</th>
              <th className="text-center px-4 py-3 w-24">CGST %</th>
              <th className="text-center px-4 py-3 w-24">SGST %</th>
              {isAdmin && <th className="text-right px-4 py-3 w-24">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(c => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${c.type === 'SAC' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {c.type}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono font-bold text-slate-800">{c.code}</td>
                <td className="px-4 py-3 text-slate-600">{c.description}</td>
                <td className="px-4 py-3 text-center font-bold text-orange-700">{c.gstRate}%</td>
                <td className="px-4 py-3 text-center text-slate-500">{c.gstRate / 2}%</td>
                <td className="px-4 py-3 text-center text-slate-500">{c.gstRate / 2}%</td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right space-x-3">
                    <button onClick={() => handleEdit(c)} className="text-blue-600 hover:text-blue-700 font-medium">✏️</button>
                    <button onClick={() => handleDelete(c)} className="text-red-600 hover:text-red-700 font-medium">🗑️</button>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="text-center py-10 text-slate-400">
                  {codes.length === 0
                    ? 'No codes yet. Click "⚡ Load Standard Codes" to pre-fill, or add manually.'
                    : 'No codes match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
