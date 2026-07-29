import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getLast12Months() {
  const months = []
  const today = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

export default function PLReport() {
  const [orders, setOrders] = useState([])
  const [expenses, setExpenses] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('monthly') // monthly | cumulative

  useEffect(() => {
    const load = async () => {
      try {
        const [oSnap, eSnap, pSnap] = await Promise.all([
          getDocs(collection(db, 'crm_orders')),
          getDocs(collection(db, 'finance_expenses')),
          getDocs(collection(db, 'finance_payments')),
        ])
        const toArr = s => { const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); return a }
        setOrders(toArr(oSnap)); setExpenses(toArr(eSnap)); setPayments(toArr(pSnap))
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const months = getLast12Months()

  // Monthly aggregates
  const data = months.map(m => {
    const revenue = orders.filter(o => (o.orderDate || o.createdAt || '').startsWith(m)).reduce((s, o) => s + (Number(o.totalAmount) || 0), 0)
    const collected = payments.filter(p => (p.date || '').startsWith(m)).reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const exp = expenses.filter(e => (e.date || '').startsWith(m)).reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const net = revenue - exp
    const label = `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`
    return { month: m, label, revenue, collected, expenses: exp, net }
  })

  const totals = data.reduce((acc, d) => ({
    revenue: acc.revenue + d.revenue,
    collected: acc.collected + d.collected,
    expenses: acc.expenses + d.expenses,
    net: acc.net + d.net,
  }), { revenue: 0, collected: 0, expenses: 0, net: 0 })

  // For bar chart: max value for scaling
  const maxVal = Math.max(...data.flatMap(d => [d.revenue, d.expenses]), 1)

  const barH = 120 // px height of bars

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">P&amp;L Report</h2>
          <p className="text-slate-500 text-sm">Last 12 months — Revenue vs Expenses</p>
        </div>
        <div className="flex border border-slate-300 rounded-lg overflow-hidden text-sm">
          {['monthly','cumulative'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 capitalize ${view === v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>{v}</button>
          ))}
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue (12m)', value: totals.revenue, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
          { label: 'Total Collected (12m)', value: totals.collected, color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
          { label: 'Total Expenses (12m)', value: totals.expenses, color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
          { label: 'Net Profit (12m)', value: totals.net, color: totals.net >= 0 ? 'text-green-700' : 'text-red-700', bg: totals.net >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.bg}`}>
            <p className={`text-xl font-bold ${c.color}`}>₹{c.value.toLocaleString('en-IN')}</p>
            <p className="text-xs text-slate-500 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
        <div className="flex items-end gap-1 justify-between" style={{ height: `${barH + 30}px` }}>
          {data.map((d, i) => {
            const rev = view === 'cumulative'
              ? data.slice(0, i + 1).reduce((s, x) => s + x.revenue, 0)
              : d.revenue
            const exp = view === 'cumulative'
              ? data.slice(0, i + 1).reduce((s, x) => s + x.expenses, 0)
              : d.expenses
            const maxC = view === 'cumulative'
              ? Math.max(...data.map((_, j) => Math.max(data.slice(0, j+1).reduce((s, x) => s + x.revenue, 0), data.slice(0, j+1).reduce((s, x) => s + x.expenses, 0))), 1)
              : maxVal
            const rH = Math.round((rev / maxC) * barH)
            const eH = Math.round((exp / maxC) * barH)
            return (
              <div key={d.month} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.label}\nRevenue: ₹${rev.toLocaleString('en-IN')}\nExpenses: ₹${exp.toLocaleString('en-IN')}`}>
                <div className="w-full flex items-end gap-0.5 justify-center" style={{ height: `${barH}px` }}>
                  <div className="w-2/5 bg-blue-400 rounded-t" style={{ height: `${rH}px`, minHeight: rH > 0 ? '2px' : '0' }} />
                  <div className="w-2/5 bg-orange-400 rounded-t" style={{ height: `${eH}px`, minHeight: eH > 0 ? '2px' : '0' }} />
                </div>
                <span className="text-xs text-slate-400" style={{ fontSize: '9px' }}>{d.label.slice(0, 3)}</span>
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 mt-2 text-xs text-slate-500 justify-center">
          <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-400 rounded-lg" /> Revenue</div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 bg-orange-400 rounded-lg" /> Expenses</div>
        </div>
      </div>

      {/* Monthly table */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Month</th>
              <th className="text-right px-4 py-3">Revenue</th>
              <th className="text-right px-4 py-3">Collected</th>
              <th className="text-right px-4 py-3">Expenses</th>
              <th className="text-right px-4 py-3">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...data].reverse().map(d => (
              <tr key={d.month} className={d.month === new Date().toISOString().slice(0, 7) ? 'bg-blue-50' : ''}>
                <td className="px-4 py-3 font-medium text-slate-800">{d.label}</td>
                <td className="px-4 py-3 text-right text-blue-700">₹{d.revenue.toLocaleString('en-IN')}</td>
                <td className="px-4 py-3 text-right text-green-700">₹{d.collected.toLocaleString('en-IN')}</td>
                <td className="px-4 py-3 text-right text-orange-700">₹{d.expenses.toLocaleString('en-IN')}</td>
                <td className={`px-4 py-3 text-right font-bold ${d.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {d.net >= 0 ? '+' : ''}₹{d.net.toLocaleString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-bold">
            <tr>
              <td className="px-4 py-3 text-slate-700">12-Month Total</td>
              <td className="px-4 py-3 text-right text-blue-700">₹{totals.revenue.toLocaleString('en-IN')}</td>
              <td className="px-4 py-3 text-right text-green-700">₹{totals.collected.toLocaleString('en-IN')}</td>
              <td className="px-4 py-3 text-right text-orange-700">₹{totals.expenses.toLocaleString('en-IN')}</td>
              <td className={`px-4 py-3 text-right ${totals.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {totals.net >= 0 ? '+' : ''}₹{totals.net.toLocaleString('en-IN')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
