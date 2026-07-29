import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const statusOf = (o) => {
  const paid = Number(o.amountPaid) || 0
  const total = Number(o.totalAmount) || 0
  if (paid >= total && total > 0) return { label: 'Paid', cls: 'bg-green-100 text-green-700' }
  if (paid > 0) return { label: 'Partial', cls: 'bg-amber-100 text-amber-700' }
  return { label: 'Unpaid', cls: 'bg-red-100 text-red-700' }
}

const COMPANY_COLORS = { UIPL: 'bg-blue-100 text-blue-700', Wayzim: 'bg-purple-100 text-purple-700' }

export default function Orders() {
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const userCompanies = userProfile?.companies || ['UIPL']
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'crm_orders'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      setOrders(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleMarkPaid = async (o) => {
    try {
      await updateDoc(doc(db, 'crm_orders', o.id), { amountPaid: o.totalAmount, updatedAt: new Date().toISOString() })
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, amountPaid: o.totalAmount } : x))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleDelete = async (o) => {
    if (!window.confirm(`Delete this order for "${o.customerName}"? This cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'crm_orders', o.id))
      setOrders(prev => prev.filter(x => x.id !== o.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const filtered = orders.filter(o => {
    // Company isolation
    if (!isAdmin && o.company && !userCompanies.includes(o.company)) return false
    const q = search.toLowerCase()
    const matchesSearch = !q || (o.customerName || '').toLowerCase().includes(q)
    const s = statusOf(o).label.toLowerCase()
    const matchesStatus = statusFilter === 'all' || s === statusFilter
    return matchesSearch && matchesStatus
  })

  const totalAmount = filtered.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0)
  const totalDue = filtered.reduce((sum, o) => sum + Math.max((Number(o.totalAmount) || 0) - (Number(o.amountPaid) || 0), 0), 0)

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Orders</h2>
          <p className="text-slate-500 text-sm">{filtered.length} orders · ₹{totalAmount.toLocaleString('en-IN')} total · ₹{totalDue.toLocaleString('en-IN')} due</p>
        </div>
        <button onClick={() => navigate('/crm/orders/new')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          + New Order
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      <div className="flex gap-3">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by customer name..."
          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Entity</th>
              <th className="text-right px-4 py-3">Total</th>
              <th className="text-right px-4 py-3">Paid</th>
              <th className="text-right px-4 py-3">Due</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(o => {
              const s = statusOf(o)
              const due = Math.max((Number(o.totalAmount) || 0) - (Number(o.amountPaid) || 0), 0)
              return (
                <tr key={o.id}>
                  <td className="px-4 py-3 text-slate-600">{o.date || '—'}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{o.customerName || '—'}</td>
                  <td className="px-4 py-3">
                    {o.company && <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${COMPANY_COLORS[o.company] || 'bg-slate-100 text-slate-600'}`}>{o.company}</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">₹{(Number(o.totalAmount) || 0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right text-slate-700">₹{(Number(o.amountPaid) || 0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right text-red-600">₹{due.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${s.cls}`}>{s.label}</span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                    {due > 0 && (
                      <button onClick={() => handleMarkPaid(o)} className="text-green-600 hover:text-green-700 font-medium">✔ Mark Paid</button>
                    )}
                    {isAdmin && (
                      <button onClick={() => handleDelete(o)} className="text-red-600 hover:text-red-700 font-medium">🗑️ Delete</button>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">No orders found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
