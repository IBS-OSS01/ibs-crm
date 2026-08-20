import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { deriveAllLines, manualEntryLines, computeAccountBalances } from '../utils/ledger.js'

// Individual bank/cash accounts are tracked here as master data (name, account
// number, IFSC, opening balance). They are NOT individually mapped in the
// General Ledger yet — every Bank Transfer/UPI/Cheque/Other payment and every
// expense/payable still posts to the single shared "1100 Bank Accounts" GL
// account (see finance/utils/ledger.js), and "Cash" payments post to "1110
// Cash in Hand". So the per-account "Opening Balance" below is manually
// maintained, while the header card shows the combined GL balance across
// 1100+1110 for a sanity cross-check — the two won't reconcile to the paisa
// until individual accounts get their own GL sub-accounts, which is a
// natural next step, not done here.
const today = () => new Date().toISOString().slice(0, 10)
const TYPES = ['bank', 'cash']
const COMPANIES = ['UIPL', 'Wayzim']

const empty = {
  name: '', type: 'bank', company: 'UIPL',
  bankName: '', accountNumber: '', ifsc: '', branch: '',
  openingBalance: '', openingDate: today(),
  notes: '', active: true,
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

export default function BankAccounts() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const [accounts, setAccounts] = useState([])
  const [glAccounts, setGlAccounts] = useState([])
  const [glLines, setGlLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [baSnap, invSnap, paySnap, ordSnap, expSnap, payblSnap, acctSnap, jeSnap] = await Promise.all([
        getDocs(collection(db, 'finance_bank_accounts')),
        getDocs(collection(db, 'finance_invoices')),
        getDocs(collection(db, 'finance_payments')),
        getDocs(collection(db, 'crm_orders')),
        getDocs(collection(db, 'finance_expenses')),
        getDocs(collection(db, 'finance_payables')),
        getDocs(collection(db, 'finance_accounts')),
        getDocs(collection(db, 'finance_journal_entries')),
      ])
      const toArr = s => { const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); return a }
      const data = toArr(baSnap)
      data.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setAccounts(data)
      setGlAccounts(toArr(acctSnap))
      const derived = deriveAllLines({
        invoices: toArr(invSnap), payments: toArr(paySnap), orders: toArr(ordSnap),
        expenses: toArr(expSnap), payables: toArr(payblSnap), accounts: toArr(acctSnap),
      })
      setGlLines([...derived, ...manualEntryLines(toArr(jeSnap))])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Combined GL balance across 1100 Bank + 1110 Cash, per company, as of today —
  // shown as a cross-check, not a per-account figure (see note above).
  const glCashByCompany = useMemo(() => {
    const out = {}
    COMPANIES.forEach(co => {
      const rows = computeAccountBalances(glLines, glAccounts, { company: co, asOfDate: today() })
      out[co] = rows.filter(r => r.code === '1100' || r.code === '1110').reduce((s, r) => s + r.balance, 0)
    })
    return out
  }, [glLines, glAccounts])

  const reset = () => { setForm(empty); setEditing(null); setError('') }

  const handleEdit = (a) => {
    setEditing(a.id)
    setForm({ ...empty, ...a })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Account name is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, openingBalance: Number(form.openingBalance) || 0 }
      if (editing) {
        await updateDoc(doc(db, 'finance_bank_accounts', editing), { ...payload, updatedAt: new Date().toISOString() })
        setAccounts(prev => prev.map(a => a.id === editing ? { ...a, ...payload } : a))
      } else {
        const ref = await addDoc(collection(db, 'finance_bank_accounts'), {
          ...payload, createdBy: user.uid, createdAt: new Date().toISOString(),
        })
        setAccounts(prev => [...prev, { id: ref.id, ...payload }])
      }
      setShowForm(false); reset()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (a) => {
    if (!window.confirm(`Delete "${a.name}"? This only removes the account record, not any transactions.`)) return
    await deleteDoc(doc(db, 'finance_bank_accounts', a.id))
    setAccounts(prev => prev.filter(x => x.id !== a.id))
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Banking</h2>
          <p className="text-slate-500 text-sm">{accounts.length} account{accounts.length === 1 ? '' : 's'}</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); reset() }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm && !editing ? '✕ Cancel' : '+ Add Account'}
        </button>
      </div>

      {/* Combined GL cross-check */}
      <div className="grid grid-cols-2 gap-4">
        {COMPANIES.map(co => (
          <div key={co} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Total Bank &amp; Cash per books — {co}</p>
            <p className={`text-xl font-bold mt-1 ${glCashByCompany[co] >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
              {co === 'UIPL' ? '₹' : '$'}{Math.abs(glCashByCompany[co] || 0).toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-slate-400 mt-1">From General Ledger accounts 1100+1110, as of today</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Account' : 'Add Account'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Account Name / Nickname *</label>
                <input className={inp} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required placeholder="e.g. HDFC Current A/c" />
              </div>
              <div>
                <label className={lbl}>Type</label>
                <select className={inp} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{t === 'bank' ? 'Bank' : 'Cash'}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Company</label>
                <select className={inp} value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))}>
                  {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {form.type === 'bank' && (
                <>
                  <div><label className={lbl}>Bank Name</label><input className={inp} value={form.bankName} onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} /></div>
                  <div><label className={lbl}>Account Number</label><input className={inp} value={form.accountNumber} onChange={e => setForm(p => ({ ...p, accountNumber: e.target.value }))} /></div>
                  <div><label className={lbl}>IFSC Code</label><input className={inp} value={form.ifsc} onChange={e => setForm(p => ({ ...p, ifsc: e.target.value }))} /></div>
                  <div><label className={lbl}>Branch</label><input className={inp} value={form.branch} onChange={e => setForm(p => ({ ...p, branch: e.target.value }))} /></div>
                </>
              )}
              <div>
                <label className={lbl}>Opening Balance</label>
                <input type="number" className={inp} value={form.openingBalance} onChange={e => setForm(p => ({ ...p, openingBalance: e.target.value }))} />
              </div>
              <div>
                <label className={lbl}>Opening Date</label>
                <input type="date" className={inp} value={form.openingDate} onChange={e => setForm(p => ({ ...p, openingDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className={lbl}>Notes</label>
              <textarea className={`${inp} h-16 resize-none`} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="ba-active" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} />
              <label htmlFor="ba-active" className="text-sm text-slate-700">Active</label>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {saving ? 'Saving…' : editing ? 'Update Account' : 'Add Account'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); reset() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Account</th>
              <th className="text-left px-4 py-3">Company</th>
              <th className="text-left px-4 py-3">Bank / Details</th>
              <th className="text-right px-4 py-3">Opening Balance</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.map(a => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{a.type === 'cash' ? '💵' : '🏦'} {a.name}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{a.company || 'UIPL'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {a.type === 'bank' ? [a.bankName, a.accountNumber, a.ifsc].filter(Boolean).join(' · ') || '—' : '—'}
                </td>
                <td className="px-4 py-3 text-right text-slate-700">₹{(Number(a.openingBalance) || 0).toLocaleString('en-IN')}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${a.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {a.active !== false ? '● Active' : '● Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  <button onClick={() => handleEdit(a)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                  {isAdmin && <button onClick={() => handleDelete(a)} className="text-red-600 hover:text-red-700 font-medium">🗑️</button>}
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">No bank/cash accounts yet. Add your first account.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
