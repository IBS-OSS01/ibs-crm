import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function NewSpareRequest() {
  const { user, userProfile } = useAuth()
  const navigate = useNavigate()
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ itemName: '', sku: '', qty: 1, locationId: '', reason: '', urgency: 'normal' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      const [whSnap, itemSnap] = await Promise.all([
        getDocs(collection(db, 'inventory_warehouses')),
        getDocs(collection(db, 'inventory_items')),
      ])
      const whs = [], itms = []
      whSnap.forEach(d => whs.push({ id: d.id, ...d.data() }))
      itemSnap.forEach(d => itms.push({ id: d.id, ...d.data() }))
      setWarehouses(whs)
      setItems(itms)
      if (whs.length > 0) setForm(prev => ({ ...prev, locationId: whs[0].id }))
    } catch (err) { console.error(err) }
  }

  const handleItemSelect = (e) => {
    const selected = items.find(i => i.id === e.target.value)
    if (selected) setForm(prev => ({ ...prev, itemName: selected.name || selected.itemName, sku: selected.sku || '' }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.itemName || !form.locationId) { setError('Fill in all required fields.'); return }
    setLoading(true)
    try {
      await addDoc(collection(db, 'inventory_spare_requests'), {
        ...form, qty: parseInt(form.qty), status: 'pending',
        requestedBy: user.uid, requestedByName: userProfile?.name || user.email,
        createdAt: new Date().toISOString(),
        reviewedBy: null, reviewedByName: null, reviewedAt: null,
      })
      setSuccess(true)
      setTimeout(() => navigate('/services/spare'), 1500)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setLoading(false) }
  }

  if (success) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-5xl mb-4">✅</div>
        <p className="text-xl font-bold text-slate-900 tracking-tight">Request Submitted!</p>
      </div>
    </div>
  )

  return (
    <div className="p-6 max-w-2xl">
      <button onClick={() => navigate('/services/spare')} className="text-blue-600 text-sm mb-4">← Back</button>
      <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-6">New Spare / Reorder Request</h2>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6">
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {items.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Select from Catalog</label>
              <select onChange={handleItemSelect} className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Select item —</option>
                {items.map(i => <option key={i.id} value={i.id}>{i.name || i.itemName} ({i.sku})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Item Name *</label>
            <input type="text" value={form.itemName} onChange={e => setForm(p => ({ ...p, itemName: e.target.value }))}
              placeholder="e.g. Bearing 6205" autoComplete="off"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">SKU</label>
            <input type="text" value={form.sku} onChange={e => setForm(p => ({ ...p, sku: e.target.value }))}
              autoComplete="off" placeholder="e.g. BRG-6205"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
            <input type="number" value={form.qty} onChange={e => setForm(p => ({ ...p, qty: e.target.value }))} min="1"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Urgency</label>
            <select value={form.urgency} onChange={e => setForm(p => ({ ...p, urgency: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Location *</label>
            <select value={form.locationId} onChange={e => setForm(p => ({ ...p, locationId: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required>
              {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name || wh.id}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
            <textarea value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="Why is this spare needed?" rows={3}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm">
            <span className="text-slate-500">Requested by: </span>
            <span className="font-medium text-slate-800">{userProfile?.name || user?.email}</span>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50">
              {loading ? 'Submitting...' : 'Submit Request'}
            </button>
            <button type="button" onClick={() => navigate('/services/spare')}
              className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
