import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { SEED_ACCOUNTS } from '../utils/ledger.js'

// Must match Expenses.jsx's CATEGORIES and Payments.jsx's METHODS exactly —
// these are what an admin can map an account to receive postings from.
const EXPENSE_CATEGORIES = ['Rent', 'Salaries', 'Transport / Delivery', 'Utilities', 'Supplies / Packaging', 'Marketing', 'Repairs', 'Miscellaneous']
const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Other']

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense']
const NORMAL_BY_TYPE = { asset: 'debit', expense: 'debit', liability: 'credit', equity: 'credit', income: 'credit' }
const TYPE_COLORS = {
  asset: 'bg-blue-100 text-blue-700', liability: 'bg-orange-100 text-orange-700',
  equity: 'bg-purple-100 text-purple-700', income: 'bg-green-100 text-green-700', expense: 'bg-red-100 text-red-700',
}

const emptyForm = { code: '', name: '', type: 'expense', parentCode: '', mapsFromCategories: [], mapsFromMethods: [], isActive: true }

export default function ChartOfAccounts() {
  const { userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'finance_accounts'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      if (data.length === 0 && isAdmin) {
        // First run — seed the standard Chart of Accounts (admin-only write,
        // so a non-admin visitor silently skips this — that's OK, same
        // pattern as CompanySettings.jsx's UIPL auto-seed).
        setSeeding(true)
        try {
          await Promise.all(SEED_ACCOUNTS.map(a =>
            setDoc(doc(db, 'finance_accounts', a.code), { ...a, isActive: true, createdAt: new Date().toISOString() })
          ))
          data.push(...SEED_ACCOUNTS.map(a => ({ id: a.code, ...a, isActive: true })))
        } catch (_) { /* non-admin can't write — that's OK */ }
        setSeeding(false)
      }
      data.sort((a, b) => (a.code || '').localeCompare(b.code || ''))
      setAccounts(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm(emptyForm); setEditing(null); setError('') }

  const toggleIn = (field, val) => {
    setForm(prev => ({
      ...prev,
      [field]: prev[field].includes(val) ? prev[field].filter(x => x !== val) : [...prev[field], val],
    }))
  }

  const handleEdit = (a) => {
    setEditing(a.id)
    setForm({
      code: a.code || a.id, name: a.name || '', type: a.type || 'expense',
      parentCode: a.parentCode || '', mapsFromCategories: a.mapsFromCategories || [],
      mapsFromMethods: a.mapsFromMethods || [], isActive: a.isActive !== false,
    })
    setShowForm(true)
    setSuccess('')
  }

  // isDefaultExpense/isDefaultPurchase/isDefaultBank/isSystem are set once at
  // seed time and intentionally not editable from this form — they're relied
  // on by ledger.js's posting rules by fixed code, not something to reassign
  // casually. Admins can still add new mapped categories/methods to any
  // account, which covers the day-to-day need (new expense category → route
  // it to an existing or new account).
  const handleSave = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!form.code.trim()) { setError('Account code is required.'); return }
    if (!form.name.trim()) { setError('Account name is required.'); return }
    if (!editing && accounts.some(a => a.code === form.code.trim())) { setError('That account code is already in use.'); return }

    setSaving(true)
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        normalBalance: NORMAL_BY_TYPE[form.type],
        parentCode: form.parentCode || null,
        mapsFromCategories: form.type === 'expense' ? form.mapsFromCategories : [],
        mapsFromMethods: form.type === 'asset' ? form.mapsFromMethods : [],
        isActive: form.isActive,
      }
      if (editing) {
        const existing = accounts.find(a => a.id === editing) || {}
        await updateDoc(doc(db, 'finance_accounts', editing), payload)
        setAccounts(prev => prev.map(a => a.id === editing ? { ...a, ...payload } : a))
        setSuccess('Account updated.')
      } else {
        const data = { ...payload, isSystem: false, createdAt: new Date().toISOString() }
        await setDoc(doc(db, 'finance_accounts', payload.code), data)
        setAccounts(prev => [...prev, { id: payload.code, ...data }].sort((a, b) => a.code.localeCompare(b.code)))
        setSuccess('Account created.')
      }
      setShowForm(false)
      resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (a) => {
    if (a.isSystem) return
    if (!window.confirm(`Delete account "${a.code} — ${a.name}"? Historical journal lines that already reference it will still show the code, just without a name lookup.`)) return
    try {
      await deleteDoc(doc(db, 'finance_accounts', a.id))
      setAccounts(prev => prev.filter(x => x.id !== a.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const reseedMissing = async () => {
    const missing = SEED_ACCOUNTS.filter(a => !accounts.some(x => x.code === a.code))
    if (missing.length === 0) { setSuccess('All standard accounts already exist.'); return }
    try {
      const batch = writeBatch(db)
      missing.forEach(a => batch.set(doc(db, 'finance_accounts', a.code), { ...a, isActive: true, createdAt: new Date().toISOString() }))
      await batch.commit()
      setAccounts(prev => [...prev, ...missing.map(a => ({ id: a.code, ...a, isActive: true }))].sort((a, b) => a.code.localeCompare(b.code)))
      setSuccess(`Added ${missing.length} missing standard account${missing.length > 1 ? 's' : ''}.`)
    } catch (err) { setError('Error: ' + err.message) }
  }

  if (!isAdmin) {
    return (
      <div className="p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Chart of Accounts</h2>
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-400">Loading...</div>
        ) : (
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
            <AccountsTable accounts={accounts} isAdmin={false} />
          </div>
        )}
      </div>
    )
  }

  if (loading || seeding) return <div className="flex items-center justify-center h-64 text-slate-400">{seeding ? 'Setting up the standard Chart of Accounts…' : 'Loading...'}</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Chart of Accounts</h2>
          <p className="text-slate-500 text-sm">Shared across UIPL and Wayzim — individual transactions carry the company, not the account. Used by Trial Balance, General Ledger, and Balance Sheet.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reseedMissing}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
            ↻ Add missing standard accounts
          </button>
          <button onClick={() => { setShowForm(!showForm); resetForm() }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ Add Account'}
          </button>
        </div>
      </div>

      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Account' : 'Add New Account'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Account Code *</label>
                <input type="text" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                  disabled={!!editing} placeholder="e.g. 5200"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type *</label>
                <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {TYPES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)} ({NORMAL_BY_TYPE[t]})</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Account Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Office Supplies"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Parent Account (for grouping in reports)</label>
                <select value={form.parentCode} onChange={e => setForm(p => ({ ...p, parentCode: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— none —</option>
                  {accounts.filter(a => a.id !== editing).map(a => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </div>

              {form.type === 'expense' && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Auto-post Expense categories here</label>
                  <div className="flex flex-wrap gap-2">
                    {EXPENSE_CATEGORIES.map(c => (
                      <button type="button" key={c} onClick={() => toggleIn('mapsFromCategories', c)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${form.mapsFromCategories.includes(c) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">When someone records an expense with a category mapped here, it derives to this account on the Trial Balance / General Ledger.</p>
                </div>
              )}

              {form.type === 'asset' && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Auto-post Payment methods here</label>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_METHODS.map(m => (
                      <button type="button" key={m} onClick={() => toggleIn('mapsFromMethods', m)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${form.mapsFromMethods.includes(m) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="coa-active" checked={form.isActive} onChange={e => setForm(p => ({ ...p, isActive: e.target.checked }))} />
                <label htmlFor="coa-active" className="text-sm text-slate-700">Active (shown in account pickers)</label>
              </div>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Account' : 'Create Account'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <AccountsTable accounts={accounts} isAdmin={isAdmin} onEdit={handleEdit} onDelete={handleDelete} />
      </div>
    </div>
  )
}

function AccountsTable({ accounts, isAdmin, onEdit, onDelete }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
        <tr>
          <th className="text-left px-4 py-3">Code</th>
          <th className="text-left px-4 py-3">Name</th>
          <th className="text-left px-4 py-3">Type</th>
          <th className="text-left px-4 py-3">Normal Balance</th>
          <th className="text-left px-4 py-3">Maps From</th>
          {isAdmin && <th className="text-right px-4 py-3">Actions</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {accounts.map(a => (
          <tr key={a.id} className={a.isActive === false ? 'opacity-50' : ''}>
            <td className="px-4 py-3 font-mono text-slate-600">{a.code}</td>
            <td className="px-4 py-3 font-medium text-slate-800">
              {a.name} {a.isSystem && <span title="Relied on by the General Ledger's posting rules — locked against edit/delete">🔒</span>}
            </td>
            <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${TYPE_COLORS[a.type] || 'bg-slate-100 text-slate-600'}`}>{a.type}</span></td>
            <td className="px-4 py-3 text-slate-500 capitalize">{a.normalBalance}</td>
            <td className="px-4 py-3 text-slate-500 text-xs">{[...(a.mapsFromCategories || []), ...(a.mapsFromMethods || [])].join(', ') || '—'}</td>
            {isAdmin && (
              <td className="px-4 py-3 text-right space-x-3">
                <button onClick={() => onEdit(a)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                <button
                  onClick={() => onDelete(a)}
                  disabled={a.isSystem}
                  title={a.isSystem ? "System accounts can't be deleted." : ''}
                  className={`font-medium ${a.isSystem ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:text-red-700'}`}
                >
                  🗑️ Delete
                </button>
              </td>
            )}
          </tr>
        ))}
        {accounts.length === 0 && (
          <tr><td colSpan={isAdmin ? 6 : 5} className="text-center py-8 text-slate-400">No accounts yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}
