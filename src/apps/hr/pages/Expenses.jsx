import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, setDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const CATEGORIES = ['Travel', 'Food & Meals', 'Accommodation', 'Client Entertainment', 'Fuel', 'Stationery', 'Courier', 'Other']
const STATUS_COLORS = {
  pending:    'bg-amber-100 text-amber-700',
  approved:   'bg-blue-100 text-blue-700',
  rejected:   'bg-red-100 text-red-700',
  reimbursed: 'bg-green-100 text-green-700',
}

const GENERAL_EXPENSE_PROJECT = {
  id: 'general-expense',
  projectNumber: 'GENERAL',
  dealTitle: 'General Expense',
  isGeneral: true,
}

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  projectId: 'general-expense',
  projectNumber: 'GENERAL',
  projectName: 'General Expense',
  category: 'Travel',
  amount: '',
  description: '',
  billRef: '',
  notes: '',
}

export default function Expenses() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const userCompanies = userProfile?.companies || ['UIPL']

  const [projects, setProjects] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [myOnly, setMyOnly] = useState(!isAdmin)

  useEffect(() => { seedGeneralExpense().then(load) }, [])

  const seedGeneralExpense = async () => {
    try {
      await setDoc(doc(db, 'projects', 'general-expense'), {
        projectNumber: 'GENERAL',
        dealTitle: 'General Expense',
        isGeneral: true,
        status: 'active',
        createdAt: new Date().toISOString(),
      }, { merge: true })
    } catch (err) { console.error('Seed error', err) }
  }

  const load = async () => {
    try {
      const [projSnap, expSnap] = await Promise.all([
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'hr_expenses')),
      ])
      const projData = [GENERAL_EXPENSE_PROJECT]
      projSnap.forEach(d => {
        const data = d.data()
        if (!data.isGeneral) projData.push({ id: d.id, ...data })
      })
      // Company-filtered non-general projects
      const visible = projData.filter(p =>
        p.isGeneral ||
        isAdmin ||
        !p.company ||
        userCompanies.includes(p.company)
      )
      visible.sort((a, b) => {
        if (a.isGeneral) return 1
        if (b.isGeneral) return -1
        return (b.projectNumber || '').localeCompare(a.projectNumber || '')
      })
      const expData = []
      expSnap.forEach(d => expData.push({ id: d.id, ...d.data() }))
      expData.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      setProjects(visible)
      setExpenses(expData)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleProjectChange = (projectId) => {
    const proj = projects.find(p => p.id === projectId) || GENERAL_EXPENSE_PROJECT
    setForm(p => ({
      ...p,
      projectId: proj.id,
      projectNumber: proj.projectNumber || '',
      projectName: proj.dealTitle || '',
    }))
  }

  const resetForm = () => { setForm(emptyForm); setError('') }

  const handleSave = async (e) => {
    e.preventDefault(); setError('')
    if (!form.description.trim()) { setError('Description is required.'); return }
    if (!form.amount || Number(form.amount) <= 0) { setError('Enter a valid amount.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        amount: Number(form.amount),
        status: 'pending',
        submittedBy: user.uid,
        submittedByName: userProfile?.name || user.email || '',
        createdAt: new Date().toISOString(),
      }
      const ref = await addDoc(collection(db, 'hr_expenses'), payload)
      setExpenses(prev => [{ id: ref.id, ...payload }, ...prev])
      setShowForm(false); resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleStatus = async (exp, newStatus) => {
    try {
      const update = { status: newStatus, [`${newStatus}At`]: new Date().toISOString(), [`${newStatus}By`]: user.uid }
      await updateDoc(doc(db, 'hr_expenses', exp.id), update)
      setExpenses(prev => prev.map(e => e.id === exp.id ? { ...e, ...update } : e))
    } catch (err) { console.error(err) }
  }

  const filtered = expenses.filter(e => {
    if (myOnly && e.submittedBy !== user.uid) return false
    if (statusFilter !== 'all' && e.status !== statusFilter) return false
    return true
  })

  const totalFiltered = filtered.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const pendingCount = expenses.filter(e => e.status === 'pending').length

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Expense Claims</h2>
          <p className="text-slate-500 text-sm">Book expenses and link to a project · {pendingCount > 0 && <span className="text-amber-600 font-bold">{pendingCount} pending approval</span>}</p>
        </div>
        <button onClick={() => { setShowForm(p => !p); resetForm() }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm ? '✕ Cancel' : '+ New Expense'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">Submit Expense Claim</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
              <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Project</label>
              <select value={form.projectId} onChange={e => handleProjectChange(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.isGeneral ? '— General Expense (no project) —' : `[${p.projectNumber}] ${p.dealTitle}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount (Rs.) *</label>
              <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} min="0"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
              <input type="text" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} autoComplete="off"
                placeholder="e.g. Cab to client site, lunch with prospect"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Bill / Receipt Ref</label>
              <input type="text" value={form.billRef} onChange={e => setForm(p => ({ ...p, billRef: e.target.value }))} autoComplete="off"
                placeholder="Receipt no., bill number"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <input type="text" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Submitting...' : 'Submit Claim'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="reimbursed">Reimbursed</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={myOnly} onChange={e => setMyOnly(e.target.checked)} className="rounded-lg" />
          My expenses only
        </label>
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} records · Rs.{totalFiltered.toLocaleString('en-IN')} total</span>
      </div>

      {/* Expenses table */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3">Project</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-left px-4 py-3">Bill Ref</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-center px-4 py-3">Status</th>
              {isAdmin && <th className="text-right px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(e => (
              <tr key={e.id}>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{e.date || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{e.submittedByName || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold ${e.projectNumber === 'GENERAL' ? 'bg-slate-100 text-slate-500' : 'bg-green-50 text-green-700'}`}>
                    {e.projectNumber || 'GENERAL'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{e.category}</td>
                <td className="px-4 py-3 text-slate-800 font-medium">{e.description}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{e.billRef || '—'}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">
                  Rs.{(Number(e.amount) || 0).toLocaleString('en-IN')}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold capitalize ${STATUS_COLORS[e.status] || 'bg-slate-100 text-slate-600'}`}>
                    {e.status}
                  </span>
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {e.status === 'pending' && (
                      <>
                        <button onClick={() => handleStatus(e, 'approved')}
                          className="text-blue-600 hover:text-blue-700 text-xs font-medium">Approve</button>
                        <button onClick={() => handleStatus(e, 'rejected')}
                          className="text-red-500 hover:text-red-700 text-xs font-medium">Reject</button>
                      </>
                    )}
                    {e.status === 'approved' && (
                      <button onClick={() => handleStatus(e, 'reimbursed')}
                        className="text-green-600 hover:text-green-700 text-xs font-medium">Mark Reimbursed</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 9 : 8} className="text-center py-8 text-slate-400">
                  No expense claims found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
