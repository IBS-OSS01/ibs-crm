import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

export default function StockTransfer() {
  const { user, userProfile } = useAuth()
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [transfers, setTransfers] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ itemName: '', sku: '', qty: 1, fromLocationId: '', toLocationId: '', notes: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      const [whSnap, itemSnap, transferSnap] = await Promise.all([
        getDocs(collection(db, 'inventory_warehouses')),
        getDocs(collection(db, 'inventory_items')),
        getDocs(collection(db, 'inventory_stock_transfers')),
      ])
      const whs = [], itms = [], trns = []
      whSnap.forEach(d => whs.push({ id: d.id, ...d.data() }))
      itemSnap.forEach(d => itms.push({ id: d.id, ...d.data() }))
      transferSnap.forEach(d => trns.push({ id: d.id, ...d.data() }))
      setWarehouses(whs)
      setItems(itms)
      setTransfers(trns)
      if (whs.length >= 2) setForm(prev => ({ ...prev, fromLocationId: whs[0].id, toLocationId: whs[1].id }))
    } catch (err) { console.error(err) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.fromLocationId === form.toLocationId) { setError('From and To locations must be different.'); return }
    if (!form.itemName) { setError('Item name is required.'); return }
    setLoading(true)
    try {
      const transfer = {
        ...form, qty: parseInt(form.qty), status: 'completed',
        transferredBy: user.uid, transferredByName: userProfile?.name || user.email,
        createdAt: new Date().toISOString(),
      }
      await addDoc(collection(db, 'inventory_stock_transfers'), transfer)
      setTransfers(prev => [{ id: Date.now().toString(), ...transfer }, ...prev])
      setSuccess(true)
      setForm(prev => ({ ...prev, itemName: '', sku: '', qty: 1, notes: '' }))
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setLoading(false) }
  }

  const formatDate = (d) => { try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return d } }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Stock Transfer</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Transfer Form */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6">
          <h3 className="font-bold text-slate-800 mb-4">New Transfer</h3>
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-600 text-sm">✅ Transfer recorded!</div>}

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
              <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
              <input type="number" value={form.qty} onChange={e => setForm(p => ({ ...p, qty: e.target.value }))} min="1"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">From Location *</label>
              <select value={form.fromLocationId} onChange={e => setForm(p => ({ ...p, fromLocationId: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name || wh.id}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">To Location *</label>
              <select value={form.toLocationId} onChange={e => setForm(p => ({ ...p, toLocationId: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name || wh.id}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50">
              {loading ? 'Processing...' : '🔀 Transfer Stock'}
            </button>
          </form>
        </div>

        {/* Transfer History */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6">
          <h3 className="font-bold text-slate-800 mb-4">Transfer History</h3>
          {transfers.length === 0 ? (
            <div className="text-center py-8 text-slate-400">No transfers recorded yet</div>
          ) : (
            <div className="space-y-3">
              {transfers.slice(0, 10).map(t => (
                <div key={t.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm">
                  <p className="font-medium text-slate-800">{t.itemName} × {t.qty}</p>
                  <p className="text-slate-500 text-xs">{t.fromLocationId} → {t.toLocationId}</p>
                  <p className="text-slate-400 text-xs">{formatDate(t.createdAt)} · {t.transferredByName}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
