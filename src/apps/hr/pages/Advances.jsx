import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const STATUS_COLORS = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-blue-100 text-blue-700', repaid: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' }

export default function Advances() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const today = new Date()
  const [employees, setEmployees] = useState([])
  const [advances, setAdvances] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ employeeId: '', amount: '', reason: '', deductFromMonth: `${today.getFullYear()}-${String(today.getMonth() + 2).padStart(2, '0')}` })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const [empSnap, advSnap] = await Promise.all([
          getDocs(collection(db, 'hr_employees')),
          getDocs(collection(db, 'hr_advances')),
        ])
        const emps = []; empSnap.forEach(d => emps.push({ id: d.id, ...d.data() }))
        setEmployees(emps.filter(e => e.active !== false).sort((a, b) => a.name.localeCompare(b.name)))
        const advs = []; advSnap.forEach(d => advs.push({ id: d.id, ...d.data() }))
        setAdvances(advs.sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || '')))
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleApply = async (ev) => {
    ev.preventDefault(); setError(''); setSuccess('')
    if (!form.employeeId) { setError('Select an employee.'); return }
    if (!form.amount || Number(form.amount) <= 0) { setError('Enter a valid amount.'); return }
    setSaving(true)
    try {
      const emp = employees.find(e => e.id === form.employeeId)
      const payload = {
        employeeId: form.employeeId,
        employeeName: emp?.name || '',
        amount: Number(form.amount),
        reason: form.reason,
        deductFromMonth: form.deductFromMonth,
        status: 'pending',
        appliedBy: user.uid,
        appliedAt: new Date().toISOString(),
      }
      const ref = await addDoc(collection(db, 'hr_advances'), payload)
      setAdvances(prev => [{ id: ref.id, ...payload }, ...prev])
      setShowForm(false); setForm({ employeeId: '', amount: '', reason: '', deductFromMonth: form.deductFromMonth })
      setSuccess('Advance request submitted.')
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleAction = async (id, action) => {
    try {
      await updateDoc(doc(db, 'hr_advances', id), { status: action, actionBy: user.uid, actionAt: new Date().toISOString() })
      setAdvances(prev => prev.map(a => a.id === id ? { ...a, status: action } : a))
    } catch (err) { setError('Error: ' + err.message) }
  }

  // Generate deduction month options (next 6 months)
  const deductMonthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() + 1 + i, 1)
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
  })

  const totalPending = advances.filter(a => a.status === 'pending' || a.status === 'approved').reduce((s, a) => s + (Number(a.amount) || 0), 0)

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Salary Advances</h2>
          <p className="text-slate-500 text-sm">
            {advances.filter(a => a.status === 'pending').length} pending · ₹{totalPending.toLocaleString('en-IN')} total outstanding
          </p>
        </div>
        <button onClick={() => setShowForm(p => !p)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm ? '✕ Cancel' : '+ Request Advance'}
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">Request Salary Advance</h3>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Advance Amount (₹) *</label>
              <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} min="1" autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Deduct from Salary Month</label>
              <select value={form.deductFromMonth} onChange={e => set('deductFromMonth', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {deductMonthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
              <input type="text" value={form.reason} onChange={e => set('reason', e.target.value)} autoComplete="off"
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

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Reason</th>
              <th className="text-left px-4 py-3">Deduct Month</th>
              <th className="text-left px-4 py-3">Applied</th>
              <th className="text-center px-4 py-3">Status</th>
              {isAdmin && <th className="text-right px-4 py-3">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {advances.map(a => (
              <tr key={a.id}>
                <td className="px-4 py-3 font-medium text-slate-800">{a.employeeName}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">₹{(Number(a.amount) || 0).toLocaleString('en-IN')}</td>
                <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{a.reason || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{a.deductFromMonth || '—'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{a.appliedAt ? a.appliedAt.slice(0, 10) : '—'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold capitalize ${STATUS_COLORS[a.status] || 'bg-slate-100 text-slate-500'}`}>{a.status}</span>
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {a.status === 'pending' && (
                      <>
                        <button onClick={() => handleAction(a.id, 'approved')} className="text-green-600 hover:text-green-700 font-medium mr-3">✔ Approve</button>
                        <button onClick={() => handleAction(a.id, 'rejected')} className="text-red-600 hover:text-red-700 font-medium">✕ Reject</button>
                      </>
                    )}
                    {a.status === 'approved' && (
                      <button onClick={() => handleAction(a.id, 'repaid')} className="text-blue-600 hover:text-blue-700 font-medium">✓ Mark Repaid</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {advances.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">No advance requests yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
