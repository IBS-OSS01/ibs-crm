import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const CATEGORIES = ['Rent', 'Salaries', 'Transport / Delivery', 'Utilities', 'Supplies / Packaging', 'Marketing', 'Repairs', 'Miscellaneous']
const emptyForm = { date: new Date().toISOString().slice(0, 10), category: 'Transport / Delivery', description: '', amount: '', paidBy: '', vendor: '' }

export default function Expenses() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7))

  useEffect(() => {
    getDocs(collection(db, 'finance_expenses')).then(snap => {
      const data = []; snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setExpenses(data.sort((a, b) => (b.date || '').localeCompare(a.date || '')))
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const handleEdit = (e) => {
    setEditing(e.id)
    setForm({ date: e.date || '', category: e.category || 'Transport / Delivery', description: e.description || '', amount: e.amount ?? '', paidBy: e.paidBy || '', vendor: e.vendor || '' })
    setShowForm(true)
  }

  const handleSave = async (ev) => {
    ev.preventDefault(); setError('')
    if (!form.description.trim()) { setError('Description is required.'); return }
    if (!form.amount || Number(form.amount) <= 0) { setError('Enter a valid amount.'); return }
    setSaving(true)
    try {
      const payload = { ...form, amount: Number(form.amount) }
      if (editing) {
        await updateDoc(doc(db, 'finance_expenses', editing), { ...payload, updatedAt: new Date().toISOString() })
        setExpenses(prev => prev.map(e => e.id === editing ? { ...e, ...payload } : e))
      } else {
        const newExp = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'finance_expenses'), newExp)
        setExpenses(prev => [{ id: ref.id, ...newExp }, ...prev])
      }
      setShowForm(false); resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (e) => {
    if (!window.confirm(`Delete expense "${e.description}"?`)) return
    await deleteDoc(doc(db, 'finance_expenses', e.id))
    setExpenses(prev => prev.filter(x => x.id !== e.id))
  }

  const filtered = expenses.filter(e => {
    const q = search.toLowerCase()
    const matchQ = !q || (e.description || '').toLowerCase().includes(q) || (e.vendor || '').toLowerCase().includes(q)
    const matchCat = !catFilter || e.category === catFilter
    const matchMonth = !monthFilter || (e.date || '').startsWith(monthFilter)
    return matchQ && matchCat && matchMonth
  })

  const total = filtered.reduce((s, e) => s + (Number(e.amount) || 0), 0)

  // Category breakdown for filtered period
  const catBreakdown = {}
  filtered.forEach(e => { catBreakdown[e.category || 'Other'] = (catBreakdown[e.category || 'Other'] || 0) + (Number(e.amount) || 0) })
  const topCats = Object.entries(catBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const MONTHS = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - i)
    return d.toISOString().slice(0, 7)
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Expenses</h2>
          <p className="text-slate-500 text-sm">{filtered.length} entries · ₹{total.toLocaleString('en-IN')} {monthFilter ? `in ${monthFilter}` : 'total'}</p>
        </div>
        <button onClick={() => { setShowForm(p => !p); resetForm() }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm && !editing ? '✕ Cancel' : '+ Add Expense'}
        </button>
      </div>

      {/* Category breakdown mini-chart */}
      {topCats.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
          <p className="text-xs font-bold text-slate-500 uppercase mb-2">By Category</p>
          <div className="space-y-1.5">
            {topCats.map(([cat, amt]) => (
              <div key={cat} className="flex items-center gap-2">
                <span className="text-xs text-slate-600 w-40 truncate">{cat}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-2">
                  <div className="bg-orange-400 h-2 rounded-full" style={{ width: `${(amt / total) * 100}%` }} />
                </div>
                <span className="text-xs font-medium text-slate-700 w-24 text-right">₹{amt.toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search description or vendor..."
          className="flex-1 min-w-48 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Time</option>
          {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Expense' : 'Add Expense'}</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
              <input type="text" value={form.description} onChange={e => set('description', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹) *</label>
              <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} min="0" autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Vendor / Party</label>
              <input type="text" value={form.vendor} onChange={e => set('vendor', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Paid By</label>
              <input type="text" value={form.paidBy} onChange={e => set('paidBy', e.target.value)} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update' : 'Add Expense'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-left px-4 py-3">Vendor</th>
              <th className="text-left px-4 py-3">Paid By</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(e => (
              <tr key={e.id}>
                <td className="px-4 py-3 text-slate-600">{e.date || '—'}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-lg text-xs bg-slate-100 text-slate-600">{e.category || '—'}</span></td>
                <td className="px-4 py-3 text-slate-800">{e.description}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{e.vendor || '—'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{e.paidBy || '—'}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">₹{(Number(e.amount)||0).toLocaleString('en-IN')}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => handleEdit(e)} className="text-blue-600 hover:text-blue-700 mr-3">✏️</button>
                  {isAdmin && <button onClick={() => handleDelete(e)} className="text-red-600 hover:text-red-700">🗑️</button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-slate-400">No expenses found.</td></tr>}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="bg-slate-50">
              <tr>
                <td colSpan={5} className="px-4 py-3 text-sm font-bold text-slate-600">Total</td>
                <td className="px-4 py-3 text-right font-bold text-slate-800">₹{total.toLocaleString('en-IN')}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
