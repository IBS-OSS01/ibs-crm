import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const emptyForm = { vendor: '', invoiceRef: '', amount: '', invoiceDate: new Date().toISOString().slice(0, 10), dueDate: '', description: '', status: 'pending' }
const STATUS_COLORS = { pending: 'bg-amber-100 text-amber-700', paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700' }

export default function Payables() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const [payables, setPayables] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('unpaid')
  const [search, setSearch] = useState('')

  useEffect(() => {
    getDocs(collection(db, 'finance_payables')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setPayables(data.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')))
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleEdit = (p) => {
    setEditing(p.id)
    setForm({ vendor: p.vendor || '', invoiceRef: p.invoiceRef || '', amount: p.amount ?? '', invoiceDate: p.invoiceDate || '', dueDate: p.dueDate || '', description: p.description || '', status: p.status || 'pending' })
    setShowForm(true)
  }

  const handleSave = async (ev) => {
    ev.preventDefault(); setError('')
    if (!form.vendor.trim()) { setError('Vendor name is required.'); return }
    if (!form.amount || Number(form.amount) <= 0) { setError('Enter a valid amount.'); return }
    setSaving(true)
    try {
      const payload = { ...form, amount: Number(form.amount) }
      if (editing) {
        await updateDoc(doc(db, 'finance_payables', editing), { ...payload, updatedAt: new Date().toISOString() })
        setPayables(prev => prev.map(p => p.id === editing ? { ...p, ...payload } : p))
      } else {
        const np = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'finance_payables'), np)
        setPayables(prev => [...prev, { id: ref.id, ...np }].sort((a, b) => (a.dueDate||'').localeCompare(b.dueDate||'')))
      }
      setShowForm(false); resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const markPaid = async (p) => {
    if (!window.confirm(`Mark bill from ${p.vendor} as paid?`)) return
    try {
      await updateDoc(doc(db, 'finance_payables', p.id), { status: 'paid', paidOn: new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString() })
      setPayables(prev => prev.map(x => x.id === p.id ? { ...x, status: 'paid', paidOn: new Date().toISOString().slice(0, 10) } : x))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete this payable?`)) return
    await deleteDoc(doc(db, 'finance_payables', p.id))
    setPayables(prev => prev.filter(x => x.id !== p.id))
  }

  const today = new Date().toISOString().slice(0, 10)
  const getDisplayStatus = (p) => {
    if (p.status === 'paid') return 'paid'
    if (p.dueDate && p.dueDate < today) return 'overdue'
    return 'pending'
  }

  const totalPending = payables.filter(p => p.status !== 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const overdueAmt = payables.filter(p => p.status !== 'paid' && p.dueDate && p.dueDate < today).reduce((s, p) => s + (Number(p.amount) || 0), 0)

  const filtered = payables.filter(p => {
    const ds = getDisplayStatus(p)
    const matchFilter = filter === 'all' || (filter === 'unpaid' && ds !== 'paid') || (filter === 'overdue' && ds === 'overdue') || (filter === 'paid' && ds === 'paid')
    const q = search.toLowerCase()
    const matchQ = !q || (p.vendor || '').toLowerCase().includes(q) || (p.invoiceRef || '').includes(q)
    return matchFilter && matchQ
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Payables</h2>
          <p className="text-slate-500 text-sm">Bills from vendors / suppliers to pay</p>
        </div>
        <button onClick={() => { setShowForm(p => !p); resetForm() }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm && !editing ? '✕ Cancel' : '+ Add Bill'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={`rounded-xl border p-4 ${overdueAmt > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
          <p className={`text-2xl font-bold ${overdueAmt > 0 ? 'text-red-700' : 'text-slate-700'}`}>₹{totalPending.toLocaleString('en-IN')}</p>
          <p className="text-xs mt-1 text-slate-500">Total Outstanding {overdueAmt > 0 ? `(₹${overdueAmt.toLocaleString('en-IN')} overdue)` : ''}</p>
        </div>
        <div className="bg-white border border-slate-200/70 rounded-2xl shadow-card p-4">
          <p className="text-2xl font-bold text-green-700">₹{payables.filter(p => p.status === 'paid').reduce((s, p) => s + (Number(p.amount)||0), 0).toLocaleString('en-IN')}</p>
          <p className="text-xs text-slate-500 mt-1">Total Paid</p>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Bill' : 'Add Vendor Bill'}</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Vendor / Supplier *</label>
              <input type="text" value={form.vendor} onChange={e => set('vendor', e.target.value)} autoComplete="off"
                placeholder="e.g. Patanjali, Nilons"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Invoice / Bill Ref</label>
              <input type="text" value={form.invoiceRef} onChange={e => set('invoiceRef', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹) *</label>
              <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} min="0" autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Date</label>
              <input type="date" value={form.invoiceDate} onChange={e => set('invoiceDate', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
              <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <input type="text" value={form.description} onChange={e => set('description', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update' : 'Add Bill'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {['unpaid','overdue','paid','all'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm rounded-full border capitalize transition ${filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}>
            {f} ({f === 'all' ? payables.length : f === 'unpaid' ? payables.filter(p => getDisplayStatus(p) !== 'paid').length : payables.filter(p => getDisplayStatus(p) === f).length})
          </button>
        ))}
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor or invoice..."
          className="flex-1 min-w-40 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Vendor</th>
              <th className="text-left px-4 py-3">Invoice Ref</th>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-left px-4 py-3">Invoice Date</th>
              <th className="text-left px-4 py-3">Due Date</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(p => {
              const ds = getDisplayStatus(p)
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{p.vendor}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{p.invoiceRef || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{p.description || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{p.invoiceDate || '—'}</td>
                  <td className={`px-4 py-3 ${ds === 'overdue' ? 'text-red-600 font-bold' : 'text-slate-500'}`}>{p.dueDate || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">₹{(Number(p.amount)||0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold capitalize ${STATUS_COLORS[ds] || 'bg-slate-100 text-slate-600'}`}>{ds}</span>
                    {p.paidOn && <p className="text-xs text-slate-400 mt-0.5">{p.paidOn}</p>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    <button onClick={() => handleEdit(p)} className="text-blue-600 hover:text-blue-700 text-xs">✏️</button>
                    {p.status !== 'paid' && <button onClick={() => markPaid(p)} className="text-green-600 hover:text-green-700 text-xs font-medium">✔ Pay</button>}
                    {isAdmin && <button onClick={() => handleDelete(p)} className="text-red-500 hover:text-red-700 text-xs">🗑️</button>}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-slate-400">No bills found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
