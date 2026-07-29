import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useNavigate } from 'react-router-dom'

export default function HRDashboard() {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState([])
  const [leaves, setLeaves] = useState([])
  const [advances, setAdvances] = useState([])
  const [slips, setSlips] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [empSnap, leaveSnap, advSnap, slipSnap] = await Promise.all([
          getDocs(collection(db, 'hr_employees')),
          getDocs(collection(db, 'hr_leaves')),
          getDocs(collection(db, 'hr_advances')),
          getDocs(collection(db, 'hr_salary_slips')),
        ])
        const toArr = snap => { const a = []; snap.forEach(d => a.push({ id: d.id, ...d.data() })); return a }
        setEmployees(toArr(empSnap))
        setLeaves(toArr(leaveSnap))
        setAdvances(toArr(advSnap))
        setSlips(toArr(slipSnap))
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  const activeEmp = employees.filter(e => e.active !== false)
  const monthlyBill = activeEmp.reduce((s, e) => s + (Number(e.salary) || 0), 0)
  const pendingLeaves = leaves.filter(l => l.status === 'pending')
  const pendingAdvances = advances.filter(a => a.status === 'pending')
  const currentMonth = new Date().toISOString().slice(0, 7)
  const unpaidSlips = slips.filter(s => s.month === currentMonth && s.status !== 'paid')

  const cards = [
    { label: 'Active Employees', value: activeEmp.length, total: employees.length, icon: '👤', color: 'text-blue-600', path: '/hr/employees' },
    { label: 'Monthly Salary Bill', value: `₹${monthlyBill.toLocaleString('en-IN')}`, icon: '💵', color: 'text-green-600', path: '/hr/salary' },
    { label: 'Leave Requests', value: pendingLeaves.length, sub: 'pending approval', icon: '🏖️', color: 'text-amber-600', path: '/hr/leaves' },
    { label: 'Advance Requests', value: pendingAdvances.length, sub: 'pending approval', icon: '💳', color: 'text-purple-600', path: '/hr/advances' },
    { label: 'Salary This Month', value: unpaidSlips.length ? `${unpaidSlips.length} unpaid` : 'All paid', icon: '✅', color: unpaidSlips.length ? 'text-red-600' : 'text-green-600', path: '/hr/salary' },
  ]

  // Department breakdown
  const deptMap = {}
  activeEmp.forEach(e => {
    const d = e.department || 'Unassigned'
    deptMap[d] = (deptMap[d] || 0) + 1
  })
  const depts = Object.entries(deptMap).sort((a, b) => b[1] - a[1])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">👥 HR Dashboard</h2>
        <p className="text-slate-500 text-sm">{activeEmp.length} active of {employees.length} total employees</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map(c => (
          <button key={c.label} onClick={() => navigate(c.path)}
            className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 text-left hover:border-blue-300 transition">
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{c.label}</p>
            {c.sub && <p className="text-xs text-slate-400">{c.sub}</p>}
            {c.total && <p className="text-xs text-slate-400">{c.total} total</p>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Department breakdown */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
          <h3 className="font-bold text-slate-800 text-sm mb-3">Staff by Department</h3>
          {depts.length === 0 ? (
            <p className="text-slate-400 text-sm">No employees yet.</p>
          ) : (
            <div className="space-y-2">
              {depts.map(([dept, count]) => (
                <div key={dept} className="flex items-center gap-3">
                  <span className="text-sm text-slate-600 w-32 truncate">{dept}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(count / activeEmp.length) * 100}%` }} />
                  </div>
                  <span className="text-sm font-medium text-slate-700 w-6 text-right">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent leave requests */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-800 text-sm">Pending Leave Requests</h3>
            <button onClick={() => navigate('/hr/leaves')} className="text-xs text-blue-600 hover:underline">View all</button>
          </div>
          {pendingLeaves.length === 0 ? (
            <p className="text-slate-400 text-sm">No pending requests.</p>
          ) : (
            <div className="space-y-2">
              {pendingLeaves.slice(0, 5).map(l => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium text-slate-800">{l.employeeName}</span>
                    <span className="text-slate-400 ml-2">{l.type} · {l.days}d</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-lg text-xs bg-amber-100 text-amber-700 font-bold">Pending</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
