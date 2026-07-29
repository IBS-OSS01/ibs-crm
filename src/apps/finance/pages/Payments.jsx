import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const METHODS = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Other']
const emptyForm = { customerId: '', orderId: '', amount: '', date: new Date().toISOString().slice(0, 10), method: 'Cash', notes: '' }

export default function Payments() {
  const { user } = useAuth()
  const [orders, setOrders] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const [oSnap, pSnap] = await Promise.all([
          getDocs(collection(db, 'crm_orders')),
          getDocs(collection(db, 'finance_payments')),
        ])
        const o = []; oSnap.forEach(d => o.push({ id: d.id, ...d.data() }))
        const p = []; pSnap.forEach(d => p.push({ id: d.id, ...d.data() }))
        setOrders(o); setPayments(p.sort((a, b) => (b.date || '').localeCompare(a.date || '')))
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Outstanding orders (with due > 0)
  const outstandingOrders = orders.filter(o => Math.max((Number(o.totalAmount) || 0) - (Number(o.amountPaid) || 0), 0) > 0)

  // Unique customers from outstanding
  const customerNames = [...new Set(outstandingOrders.map(o => o.customerName || 'Unknown'))].sort()

  const ordersForCustomer = form.customerId
    ? outstandingOrders.filter(o => (o.customerName || 'Unknown') === form.customerId)
    : []

  const selectedOrder = form.orderId ? orders.find(o => o.id === form.orderId) : null
  const maxDue = selectedOrder ? Math.max((Number(selectedOrder.totalAmount) || 0) - (Number(selectedOrder.amountPaid) || 0), 0) : 0

  const handleSave = async (ev) => {
    ev.preventDefault(); setError(''); setSuccess('')
    if (!form.customerId) { setError('Select a customer.'); return }
    if (!form.amount || Number(form.amount) <= 0) { setError('Enter a valid amount.'); return }
    if (form.orderId && Number(form.amount) > maxDue) { setError(`Amount exceeds due (₹${maxDue.toLocaleString('en-IN')}).`); return }
    setSaving(true)
    try {
      const payload = {
        customerId: form.customerId,
        customerName: form.customerId,
        orderId: form.orderId || '',
        orderRef: selectedOrder?.orderRef || selectedOrder?.id?.slice(0, 8) || '',
        amount: Number(form.amount),
        date: form.date,
        method: form.method,
        notes: form.notes,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      }
      const ref = await addDoc(collection(db, 'finance_payments'), payload)
      setPayments(prev => [{ id: ref.id, ...payload }, ...prev])

      // If linked to an order, update its amountPaid
      if (form.orderId && selectedOrder) {
        const newPaid = (Number(selectedOrder.amountPaid) || 0) + Number(form.amount)
        await updateDoc(doc(db, 'crm_orders', form.orderId), { amountPaid: newPaid, updatedAt: new Date().toISOString() })
        setOrders(prev => prev.map(o => o.id === form.orderId ? { ...o, amountPaid: newPaid } : o))
      }

      setShowForm(false); setForm(emptyForm)
      setSuccess(`Payment of ₹${Number(form.amount).toLocaleString('en-IN')} recorded.`)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const totalCollected = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const collectedThisMonth = payments.filter(p => (p.date || '').startsWith(thisMonth)).reduce((s, p) => s + (Number(p.amount) || 0), 0)

  const filtered = payments.filter(p => !search || (p.customerName || '').toLowerCase().includes(search.toLowerCase()) || (p.orderRef || '').includes(search))

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Payments Received</h2>
          <p className="text-slate-500 text-sm">{payments.length} records · ₹{totalCollected.toLocaleString('en-IN')} total collected</p>
        </div>
        <button onClick={() => { setShowForm(p => !p); setForm(emptyForm) }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm ? '✕ Cancel' : '+ Record Payment'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-green-700">₹{collectedThisMonth.toLocaleString('en-IN')}</p>
          <p className="text-xs text-green-600 mt-1">Collected This Month</p>
        </div>
        <div className="bg-white border border-slate-200/70 rounded-2xl shadow-card p-4">
          <p className="text-2xl font-bold text-slate-700">₹{totalCollected.toLocaleString('en-IN')}</p>
          <p className="text-xs text-slate-500 mt-1">Total Collected (All Time)</p>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">Record Payment</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Customer *</label>
              <select value={form.customerId} onChange={e => { set('customerId', e.target.value); set('orderId', '') }}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select customer</option>
                {customerNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Against Order (optional)</label>
              <select value={form.orderId} onChange={e => { set('orderId', e.target.value); if (e.target.value) { const o = orders.find(x => x.id === e.target.value); set('amount', Math.max((Number(o?.totalAmount)||0)-(Number(o?.amountPaid)||0),0).toString()) } }}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">General payment</option>
                {ordersForCustomer.map(o => <option key={o.id} value={o.id}>{o.orderRef || o.id.slice(0,8)} — Due ₹{Math.max((Number(o.totalAmount)||0)-(Number(o.amountPaid)||0),0).toLocaleString('en-IN')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹) *</label>
              <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} min="1" autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {form.orderId && maxDue > 0 && <p className="text-xs text-slate-400 mt-1">Max due: ₹{maxDue.toLocaleString('en-IN')}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
              <select value={form.method} onChange={e => set('method', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : 'Record Payment'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by customer or order..."
        className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Order Ref</th>
              <th className="text-left px-4 py-3">Method</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(p => (
              <tr key={p.id}>
                <td className="px-4 py-3 text-slate-600">{p.date}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{p.customerName}</td>
                <td className="px-4 py-3 text-slate-500">{p.orderRef || '—'}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-lg text-xs bg-slate-100 text-slate-600">{p.method}</span></td>
                <td className="px-4 py-3 text-right font-semibold text-green-700">₹{(Number(p.amount)||0).toLocaleString('en-IN')}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{p.notes || '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-slate-400">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
