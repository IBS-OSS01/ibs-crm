import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useNavigate } from 'react-router-dom'

export default function Receivables() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedCustomer, setExpandedCustomer] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    getDocs(collection(db, 'crm_orders')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setOrders(data)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const today = new Date()

  // Group outstanding orders by customer
  const customerMap = {}
  orders.forEach(o => {
    const due = Math.max((Number(o.totalAmount) || 0) - (Number(o.amountPaid) || 0), 0)
    if (due <= 0) return
    const key = o.customerName || 'Unknown'
    if (!customerMap[key]) customerMap[key] = { name: key, totalDue: 0, orders: [] }
    customerMap[key].totalDue += due
    customerMap[key].orders.push({ ...o, due })
  })
  const customers = Object.values(customerMap).sort((a, b) => b.totalDue - a.totalDue)
  const filtered = customers.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))
  const totalReceivable = customers.reduce((s, c) => s + c.totalDue, 0)

  // Ageing buckets (by order date)
  const ageing = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
  orders.forEach(o => {
    const due = Math.max((Number(o.totalAmount) || 0) - (Number(o.amountPaid) || 0), 0)
    if (due <= 0) return
    const orderDate = new Date(o.orderDate || o.createdAt || today)
    const days = Math.floor((today - orderDate) / (1000 * 60 * 60 * 24))
    if (days <= 30) ageing['0-30'] += due
    else if (days <= 60) ageing['31-60'] += due
    else if (days <= 90) ageing['61-90'] += due
    else ageing['90+'] += due
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Receivables</h2>
          <p className="text-slate-500 text-sm">Outstanding dues from {customers.length} customers</p>
        </div>
        <button onClick={() => navigate('/finance/payments')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          💳 Record Payment
        </button>
      </div>

      {/* Summary + Ageing */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="col-span-2 md:col-span-1 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-2xl font-bold text-red-700">₹{totalReceivable.toLocaleString('en-IN')}</p>
          <p className="text-xs text-red-500 mt-1">Total Outstanding</p>
        </div>
        {Object.entries(ageing).map(([bucket, amt]) => (
          <div key={bucket} className="bg-white border border-slate-200/70 rounded-2xl shadow-card p-4 text-center">
            <p className="text-lg font-bold text-slate-800">₹{amt.toLocaleString('en-IN')}</p>
            <p className="text-xs text-slate-500 mt-1">{bucket} days</p>
          </div>
        ))}
      </div>

      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer..."
        className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-slate-400">{customers.length === 0 ? 'No outstanding receivables. 🎉' : 'No matching customers.'}</div>
        ) : (
          filtered.map(c => {
            const isOpen = expandedCustomer === c.name
            return (
              <div key={c.name} className="border-b border-slate-100 last:border-0">
                <button onClick={() => setExpandedCustomer(isOpen ? null : c.name)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-slate-800">{c.name}</span>
                    <span className="text-xs text-slate-400">{c.orders.length} order(s)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-red-600">₹{c.totalDue.toLocaleString('en-IN')}</span>
                    <span className="text-slate-400">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="bg-slate-50 border-t border-slate-100">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-6 py-2">Order</th>
                          <th className="text-left px-4 py-2">Date</th>
                          <th className="text-right px-4 py-2">Total</th>
                          <th className="text-right px-4 py-2">Paid</th>
                          <th className="text-right px-4 py-2">Due</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {c.orders.map(o => (
                          <tr key={o.id}>
                            <td className="px-6 py-2 text-slate-700">{o.orderRef || o.id.slice(0, 8)}</td>
                            <td className="px-4 py-2 text-slate-500">{o.orderDate || o.createdAt?.slice(0, 10) || '—'}</td>
                            <td className="px-4 py-2 text-right text-slate-700">₹{(Number(o.totalAmount) || 0).toLocaleString('en-IN')}</td>
                            <td className="px-4 py-2 text-right text-green-700">₹{(Number(o.amountPaid) || 0).toLocaleString('en-IN')}</td>
                            <td className="px-4 py-2 text-right font-bold text-red-600">₹{o.due.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
