import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Unpaid Leave']
const STATUS_COLORS = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

// Standard annual leave allocation per employee
const LEAVE_ALLOC = { 'Casual Leave': 12, 'Sick Leave': 12, 'Earned Leave': 15, 'Unpaid Leave': 999 }

function daysBetween(from, to) {
  if (!from || !to) return 1
  const d = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24) + 1
  return d > 0 ? d : 1
}

export default function Leaves() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const [employees, setEmployees] = useState([])
  const [leaves, setLeaves] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ employeeId: '', type: 'Casual Leave', fromDate: '', toDate: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [empSnap, leaveSnap] = await Promise.all([
        getDocs(collection(db, 'hr_employees')),
        getDocs(collection(db, 'hr_leaves')),
      ])
      const emps = []; empSnap.forEach(d => emps.push({ id: d.id, ...d.data() }))
      emps.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setEmployees(emps.filter(e => e.active !== false))

      const lv = []; leaveSnap.forEach(d => lv.push({ id: d.id, ...d.data() }))
      lv.sort((a, b) => (b.fromDate || '').localeCompare(a.fromDate || ''))
      setLeaves(lv)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleApply = async (ev) => {
    ev.preventDefault(); setError(''); setSuccess('')
    if (!form.employeeId) { setError('Select an employee.'); return }
    if (!form.fromDate || !form.toDate) { setError('Select leave dates.'); return }
    if (new Date(form.toDate) < new Date(form.fromDate)) { setError('End date must be ≥ start date.'); return }
    setSaving(true)
    try {
      const emp = employees.find(e => e.id === form.employeeId)
      const days = daysBetween(form.fromDate, form.toDate)
      const payload = {
        employeeId: form.employeeId,
        employeeName: emp?.name || '',
        type: form.type,
        fromDate: form.fromDate,
        toDate: form.toDate,
        days,
        reason: form.reason,
        status: 'pending',
        appliedBy: user.uid,
        appliedAt: new Date().toISOString(),
      }
      const ref = await addDoc(collection(db, 'hr_leaves'), payload)
      setLeaves(prev => [{ id: ref.id, ...payload }, ...prev])
      setShowForm(false)
      setForm({ employeeId: '', type: 'Casual Leave', fromDate: '', toDate: '', reason: '' })
      setSuccess('Leave request submitted.')
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleAction = async (leaveId, action) => {
    try {
      await updateDoc(doc(db, 'hr_leaves', leaveId), {
        status: action,
        actionBy: user.uid,
        actionAt: new Date().toISOString(),
      })
      setLeaves(prev => prev.map(l => l.id === leaveId ? { ...l, status: action } : l))
    } catch (err) { setError('Error: ' + err.message) }
  }

  // Compute used leaves per employee for current year
  const currentYear = new Date().getFullYear().toString()
  const usedLeaves = {}
  leaves.forEach(l => {
    if (l.status !== 'approved') return
    if (!(l.fromDate || '').startsWith(currentYear)) return
    if (!usedLeaves[l.employeeId]) usedLeaves[l.employeeId] = {}
    usedLeaves[l.employeeId][l.type] = (usedLeaves[l.employeeId][l.type] || 0) + (l.days || 1)
  })

  const filtered = filter === 'all' ? leaves : leaves.filter(l => l.status === filter)

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Leaves</h2>
          <p className="text-slate-500 text-sm">{leaves.filter(l => l.status === 'pending').length} pending · {leaves.length} total requests</p>
        </div>
        <button onClick={() => setShowForm(p => !p)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm ? '✕ Cancel' : '+ Apply for Leave'}
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">Apply for Leave</h3>
          <form onSubmit={handleApply} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Employee *</label>
              <select value={form.employeeId} onChange={e => set('employeeId', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select employee</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Leave Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">From Date *</label>
              <input type="date" value={form.fromDate} onChange={e => set('fromDate', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">To Date *</label>
              <input type="date" value={form.toDate} onChange={e => set('toDate', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {form.fromDate && form.toDate && (
              <div className="col-span-2 text-xs text-blue-600">
                Duration: {daysBetween(form.fromDate, form.toDate)} day(s)
                {form.employeeId && (
                  <span className="ml-3 text-slate-500">
                    Used {LEAVE_TYPES.includes(form.type) ? (usedLeaves[form.employeeId]?.[form.type] || 0) : 0} / {LEAVE_ALLOC[form.type]} {form.type} this year
                  </span>
                )}
              </div>
            )}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
              <textarea value={form.reason} onChange={e => set('reason', e.target.value)} rows={2}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Submitting...' : 'Submit Request'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Leave balance summary per employee */}
      {employees.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-700">Leave Balance — {currentYear}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2">Employee</th>
                  {LEAVE_TYPES.filter(t => t !== 'Unpaid Leave').map(t => (
                    <th key={t} className="text-center px-3 py-2">{t.split(' ')[0]}<br />Used / Alloc</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map(e => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">{e.name}</td>
                    {LEAVE_TYPES.filter(t => t !== 'Unpaid Leave').map(t => {
                      const used = usedLeaves[e.id]?.[t] || 0
                      const alloc = LEAVE_ALLOC[t]
                      const over = used > alloc
                      return (
                        <td key={t} className={`text-center px-3 py-2 font-medium ${over ? 'text-red-600' : 'text-slate-700'}`}>
                          {used} / {alloc}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        {['all','pending','approved','rejected'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium border-b-2 capitalize transition ${filter === f ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>
            {f} {f === 'all' ? `(${leaves.length})` : `(${leaves.filter(l => l.status === f).length})`}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">From</th>
              <th className="text-left px-4 py-3">To</th>
              <th className="text-center px-4 py-3">Days</th>
              <th className="text-left px-4 py-3">Reason</th>
              <th className="text-center px-4 py-3">Status</th>
              {isAdmin && <th className="text-right px-4 py-3">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(l => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-medium text-slate-800">{l.employeeName}</td>
                <td className="px-4 py-3 text-slate-600">{l.type}</td>
                <td className="px-4 py-3 text-slate-600">{l.fromDate}</td>
                <td className="px-4 py-3 text-slate-600">{l.toDate}</td>
                <td className="px-4 py-3 text-center text-slate-700 font-medium">{l.days}</td>
                <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{l.reason || '—'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold capitalize ${STATUS_COLORS[l.status] || 'bg-slate-100 text-slate-600'}`}>{l.status}</span>
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {l.status === 'pending' && (
                      <>
                        <button onClick={() => handleAction(l.id, 'approved')} className="text-green-600 hover:text-green-700 font-medium mr-3">✔ Approve</button>
                        <button onClick={() => handleAction(l.id, 'rejected')} className="text-red-600 hover:text-red-700 font-medium">✕ Reject</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">No leave requests found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
