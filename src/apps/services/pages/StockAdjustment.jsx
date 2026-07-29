import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

export default function StockAdjustment() {
  const { user, userProfile } = useAuth()
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ itemName: '', sku: '', qty: 0, type: 'add', locationId: '', reason: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const isManager = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      const [whSnap, itemSnap, adjSnap] = await Promise.all([
        getDocs(collection(db, 'inventory_warehouses')),
        getDocs(collection(db, 'inventory_items')),
        getDocs(collection(db, 'inventory_stock_adjustments')),
      ])
      const whs = [], itms = [], adjs = []
      whSnap.forEach(d => whs.push({ id: d.id, ...d.data() }))
      itemSnap.forEach(d => itms.push({ id: d.id, ...d.data() }))
      adjSnap.forEach(d => adjs.push({ id: d.id, ...d.data() }))
      adjs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      setWarehouses(whs)
      setItems(itms)
      setAdjustments(adjs)
      if (whs.length > 0) setForm(prev => ({ ...prev, locationId: whs[0].id }))
    } catch (err) { console.error(err) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.itemName || !form.locationId) { setError('Fill required fields.'); return }
    setLoading(true)
    try {
      const adj = {
        ...form, qty: parseInt(form.qty),
        adjustedBy: user.uid, adjustedByName: userProfile?.name || user.email,
        createdAt: new Date().toISOString(), type: 'adjustment',
        adjustmentType: form.type,
      }
      const ref = await addDoc(collection(db, 'inventory_stock_adjustments'), adj)
      setAdjustments(prev => [{ id: ref.id, ...adj }, ...prev])
      setSuccess(true)
      setForm(prev => ({ ...prev, itemName: '', sku: '', qty: 0, reason: '' }))
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setLoading(false) }
  }

  const formatDate = (d) => { try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return d } }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Stock Adjustment</h2>

      {!isManager ? (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          <p className="text-4xl mb-3">🔒</p>
          <p>Only Service Managers and Admins can make stock adjustments.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Form */}
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6">
            <h3 className="font-bold text-slate-800 mb-4">New Adjustment</h3>
            {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
            {success && <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-600 text-sm">✅ Adjustment recorded!</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
              {items.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Select Item</label>
                  <select onChange={e => { const i = items.find(x => x.id === e.target.value); if (i) setForm(p => ({ ...p, itemName: i.name || i.itemName, sku: i.sku || '' })) }}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select —</option>
                    {items.map(i => <option key={i.id} value={i.id}>{i.name || i.itemName}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Item Name *</label>
                <input type="text" value={form.itemName} onChange={e => setForm(p => ({ ...p, itemName: e.target.value }))} autoComplete="off"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Adjustment Type</label>
                <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="add">➕ Add Stock</option>
                  <option value="remove">➖ Remove Stock</option>
                  <option value="set">🔁 Set Exact Quantity</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
                <input type="number" value={form.qty} onChange={e => setForm(p => ({ ...p, qty: e.target.value }))} min="0"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Location *</label>
                <select value={form.locationId} onChange={e => setForm(p => ({ ...p, locationId: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name || wh.id}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason *</label>
                <textarea value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} rows={2} required
                  placeholder="e.g. Damaged goods, Physical count correction..."
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition disabled:opacity-50">
                {loading ? 'Saving...' : '⚖️ Record Adjustment'}
              </button>
            </form>
          </div>

          {/* History */}
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6">
            <h3 className="font-bold text-slate-800 mb-4">Adjustment History</h3>
            {adjustments.length === 0 ? (
              <div className="text-center py-8 text-slate-400">No adjustments recorded</div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {adjustments.map(a => (
                  <div key={a.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm">
                    <div className="flex justify-between">
                      <p className="font-medium text-slate-800">{a.itemName}</p>
                      <span className={`text-xs font-bold ${a.adjustmentType === 'add' ? 'text-green-600' : a.adjustmentType === 'remove' ? 'text-red-600' : 'text-blue-600'}`}>
                        {a.adjustmentType === 'add' ? '+' : a.adjustmentType === 'remove' ? '-' : '='}{a.qty}
                      </span>
                    </div>
                    <p className="text-slate-500 text-xs">{a.reason}</p>
                    <p className="text-slate-400 text-xs">{formatDate(a.createdAt)} · {a.adjustedByName}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
