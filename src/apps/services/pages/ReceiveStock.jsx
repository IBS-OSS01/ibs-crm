import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, increment } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

export default function ReceiveStock() {
  const { user, userProfile } = useAuth()
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [receipts, setReceipts] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ itemName: '', sku: '', qty: 1, locationId: '', supplier: '', invoiceNo: '', notes: '' })
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.itemName || !form.locationId) { setError('Fill in required fields.'); return }
    setLoading(true)
    try {
      await addDoc(collection(db, 'inventory_stock_adjustments'), {
        type: 'receive', ...form, qty: parseInt(form.qty),
        receivedBy: user.uid, receivedByName: userProfile?.name || user.email,
        createdAt: new Date().toISOString(),
      })
      setSuccess(true)
      setForm(prev => ({ ...prev, itemName: '', sku: '', qty: 1, supplier: '', invoiceNo: '', notes: '' }))
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setLoading(false) }
  }

  const formatDate = (d) => { try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return d } }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-6">Receive Stock</h2>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6">
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
        {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-600 text-sm">✅ Stock received and recorded!</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {items.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Select from Catalog</label>
              <select onChange={e => { const i = items.find(x => x.id === e.target.value); if (i) setForm(p => ({ ...p, itemName: i.name || i.itemName, sku: i.sku || '' })) }}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Select item —</option>
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
            <label className="block text-sm font-medium text-slate-700 mb-1">SKU</label>
            <input type="text" value={form.sku} onChange={e => setForm(p => ({ ...p, sku: e.target.value }))} autoComplete="off"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Quantity Received *</label>
            <input type="number" value={form.qty} onChange={e => setForm(p => ({ ...p, qty: e.target.value }))} min="1"
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Supplier</label>
            <input type="text" value={form.supplier} onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))} autoComplete="off"
              placeholder="Supplier name" className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Invoice / PO Number</label>
            <input type="text" value={form.invoiceNo} onChange={e => setForm(p => ({ ...p, invoiceNo: e.target.value }))} autoComplete="off"
              placeholder="INV-001" className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition disabled:opacity-50">
            {loading ? 'Recording...' : '📥 Receive Stock'}
          </button>
        </form>
      </div>
    </div>
  )
}
