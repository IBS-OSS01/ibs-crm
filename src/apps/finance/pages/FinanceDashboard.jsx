import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useNavigate } from 'react-router-dom'

export default function FinanceDashboard() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [expenses, setExpenses] = useState([])
  const [payments, setPayments] = useState([])
  const [payables, setPayables] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [oSnap, eSnap, pSnap, pbSnap] = await Promise.all([
          getDocs(collection(db, 'crm_orders')),
          getDocs(collection(db, 'finance_expenses')),
          getDocs(collection(db, 'finance_payments')),
          getDocs(collection(db, 'finance_payables')),
        ])
        const toArr = s => { const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); return a }
        setOrders(toArr(oSnap)); setExpenses(toArr(eSnap))
        setPayments(toArr(pSnap)); setPayables(toArr(pbSnap))
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  const today = new Date()
  const thisMonth = today.toISOString().slice(0, 7)

  // Receivables
  const totalReceivable = orders.reduce((s, o) => s + Math.max((Number(o.totalAmount) || 0) - (Number(o.amountPaid) || 0), 0), 0)

  // Revenue (total order value)
  const totalRevenue = orders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0)
  const revenueThisMonth = orders.filter(o => (o.orderDate || o.createdAt || '').startsWith(thisMonth)).reduce((s, o) => s + (Number(o.totalAmount) || 0), 0)

  // Expenses
  const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const expensesThisMonth = expenses.filter(e => (e.date || '').startsWith(thisMonth)).reduce((s, e) => s + (Number(e.amount) || 0), 0)

  // Payables outstanding
  const totalPayables = payables.filter(p => p.status !== 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const overduePayables = payables.filter(p => p.status !== 'paid' && p.dueDate && p.dueDate < today.toISOString().slice(0, 10)).length

  // Cash collected this month (payments)
  const collectedThisMonth = payments.filter(p => (p.date || '').startsWith(thisMonth)).reduce((s, p) => s + (Number(p.amount) || 0), 0)

  const cards = [
    { label: 'Outstanding Receivables', value: `₹${totalReceivable.toLocaleString('en-IN')}`, icon: '📥', color: 'text-red-600', path: '/finance/receivables' },
    { label: 'Collected This Month', value: `₹${collectedThisMonth.toLocaleString('en-IN')}`, icon: '💳', color: 'text-green-600', path: '/finance/payments' },
    { label: 'Expenses This Month', value: `₹${expensesThisMonth.toLocaleString('en-IN')}`, icon: '📤', color: 'text-orange-600', path: '/finance/expenses' },
    { label: 'Payables Outstanding', value: `₹${totalPayables.toLocaleString('en-IN')}`, icon: '🧾', color: overduePayables > 0 ? 'text-red-600' : 'text-slate-700', path: '/finance/payables', sub: overduePayables > 0 ? `${overduePayables} overdue` : null },
    { label: 'Revenue This Month', value: `₹${revenueThisMonth.toLocaleString('en-IN')}`, icon: '📈', color: 'text-blue-600', path: '/finance/pl' },
  ]

  const netThisMonth = revenueThisMonth - expensesThisMonth

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">💰 Finance Dashboard</h2>
        <p className="text-slate-500 text-sm">Total revenue ₹{totalRevenue.toLocaleString('en-IN')} · Total expenses ₹{totalExpenses.toLocaleString('en-IN')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map(c => (
          <button key={c.label} onClick={() => navigate(c.path)}
            className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 text-left hover:border-blue-300 transition">
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{c.label}</p>
            {c.sub && <p className="text-xs text-red-500">{c.sub}</p>}
          </button>
        ))}
      </div>

      {/* Net position this month */}
      <div className={`rounded-xl p-5 border ${netThisMonth >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-medium text-slate-600">Net This Month (Revenue − Expenses)</p>
            <p className={`text-3xl font-bold mt-1 ${netThisMonth >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {netThisMonth >= 0 ? '+' : ''}₹{netThisMonth.toLocaleString('en-IN')}
            </p>
          </div>
          <button onClick={() => navigate('/finance/pl')} className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition">
            View Full P&L →
          </button>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Record Payment', path: '/finance/payments', icon: '💳' },
          { label: 'Add Expense', path: '/finance/expenses', icon: '📤' },
          { label: 'Add Vendor Bill', path: '/finance/payables', icon: '🧾' },
          { label: 'P&L Report', path: '/finance/pl', icon: '📈' },
        ].map(q => (
          <button key={q.label} onClick={() => navigate(q.path)}
            className="bg-white border border-slate-200/70 rounded-2xl shadow-card p-3 text-sm text-slate-700 hover:border-blue-300 transition flex items-center gap-2">
            <span>{q.icon}</span> {q.label}
          </button>
        ))}
      </div>
    </div>
  )
}
