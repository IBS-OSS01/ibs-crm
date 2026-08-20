import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const today = () => new Date().toISOString().slice(0, 10)
const getFY = () => { const d = new Date(); const y = d.getFullYear(); const m = d.getMonth() + 1; const s = m >= 4 ? y : y - 1; return `${String(s).slice(2)}-${String(s + 1).slice(2)}` }
const newLine = () => ({ accountCode: '', debit: '', credit: '', description: '' })
const emptyForm = { date: today(), company: 'UIPL', memo: '' }

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

export default function JournalEntries() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const [entries, setEntries] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [lines, setLines] = useState([newLine(), newLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [jeSnap, acctSnap] = await Promise.all([
        getDocs(collection(db, 'finance_journal_entries')),
        getDocs(collection(db, 'finance_accounts')),
      ])
      const j = []; jeSnap.forEach(d => j.push({ id: d.id, ...d.data() }))
      j.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      const a = []; acctSnap.forEach(d => a.push({ id: d.id, ...d.data() }))
      a.sort((x, y) => (x.code || '').localeCompare(y.code || ''))
      setEntries(j); setAccounts(a.filter(x => x.isActive !== false))
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const resetForm = () => { setForm(emptyForm); setLines([newLine(), newLine()]); setError('') }

  const updateLine = (idx, field, val) =>
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l))

  const getNextJENumber = async (company) => {
    const fy = getFY()
    const prefix = `JE/${company}/${fy}/`
    const snap = await getDocs(collection(db, 'finance_journal_entries'))
    const nums = []
    snap.forEach(d => {
      const n = d.data().reference || ''
      if (n.startsWith(prefix)) nums.push(parseInt(n.replace(prefix, '')) || 0)
    })
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
    return `${prefix}${String(next).padStart(3, '0')}`
  }

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const isBalanced = lines.filter(l => l.accountCode && (Number(l.debit) || Number(l.credit))).length >= 2
    && Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    const usable = lines.filter(l => l.accountCode && (Number(l.debit) || Number(l.credit)))
    if (usable.length < 2) { setError('Add at least 2 lines with an account and an amount.'); return }
    if (usable.some(l => Number(l.debit) > 0 && Number(l.credit) > 0)) { setError('A line can\'t have both a debit and a credit.'); return }
    if (Math.abs(totalDebit - totalCredit) >= 0.01) { setError(`Entry doesn't balance — total debit ₹${totalDebit.toLocaleString('en-IN')} vs credit ₹${totalCredit.toLocaleString('en-IN')}.`); return }

    setSaving(true)
    try {
      const reference = await getNextJENumber(form.company)
      const payload = {
        reference,
        date: form.date,
        company: form.company,
        memo: form.memo,
        lines: usable.map(l => ({
          accountCode: l.accountCode,
          accountName: accounts.find(a => a.code === l.accountCode)?.name || l.accountCode,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || '',
        })),
        sourceType: 'manual',
        status: 'posted',
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      }
      const ref = await addDoc(collection(db, 'finance_journal_entries'), payload)
      setEntries(prev => [{ id: ref.id, ...payload }, ...prev])
      setShowForm(false)
      resetForm()
      setSuccess(`Journal entry ${reference} posted.`)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (je) => {
    if (!window.confirm(`Delete journal entry ${je.reference}? This cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'finance_journal_entries', je.id))
      setEntries(prev => prev.filter(x => x.id !== je.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Journal Entries</h2>
          <p className="text-slate-500 text-sm">Manual entries only — opening balances, adjustments, corrections. Invoices/Payments/Expenses/Payables post to the ledger automatically and don't appear here.</p>
        </div>
        {isAdmin && (
          <button onClick={() => { setShowForm(!showForm); resetForm() }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm ? '✕ Cancel' : '+ New Journal Entry'}
          </button>
        )}
      </div>

      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}
      {!isAdmin && <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-sm">Only Admins can post journal entries. You can still view the list below.</div>}

      {showForm && isAdmin && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={lbl}>Entity</label>
                <select className={inp} value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))}>
                  <option>UIPL</option><option>Wayzim</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Date</label>
                <input type="date" className={inp} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div>
                <label className={lbl}>Memo</label>
                <input className={inp} value={form.memo} onChange={e => setForm(p => ({ ...p, memo: e.target.value }))}
                  placeholder="e.g. Opening balance as of 1 Apr 2025" />
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 border-b flex items-center justify-between">
                <p className="text-xs font-bold uppercase text-slate-600">Lines</p>
                <button type="button" onClick={() => setLines(p => [...p, newLine()])}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium">+ Add Row</button>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 text-left" style={{ width: '32%' }}>Account</th>
                    <th className="px-3 py-2 text-left" style={{ width: '28%' }}>Description</th>
                    <th className="px-3 py-2" style={{ width: '16%' }}>Debit</th>
                    <th className="px-3 py-2" style={{ width: '16%' }}>Credit</th>
                    <th className="px-3 py-2" style={{ width: '8%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">
                        <select className={inp} value={l.accountCode} onChange={e => updateLine(idx, 'accountCode', e.target.value)}>
                          <option value="">— select —</option>
                          {accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2"><input className={inp} value={l.description} onChange={e => updateLine(idx, 'description', e.target.value)} /></td>
                      <td className="px-3 py-2"><input type="number" min="0" className={inp} value={l.debit} onChange={e => updateLine(idx, 'debit', e.target.value)} /></td>
                      <td className="px-3 py-2"><input type="number" min="0" className={inp} value={l.credit} onChange={e => updateLine(idx, 'credit', e.target.value)} /></td>
                      <td className="px-3 py-2 text-center">
                        {lines.length > 2 && (
                          <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-500">✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={isBalanced ? 'bg-green-50' : 'bg-red-50'}>
                    <td className="px-3 py-2 text-right font-bold text-slate-600" colSpan={2}>Total</td>
                    <td className={`px-3 py-2 font-bold ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>₹{totalDebit.toLocaleString('en-IN')}</td>
                    <td className={`px-3 py-2 font-bold ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>₹{totalCredit.toLocaleString('en-IN')}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex gap-3 items-center">
              <button type="submit" disabled={saving || !isBalanced}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Posting...' : 'Post Journal Entry'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
              {!isBalanced && <span className="text-xs text-slate-400">Debits must equal credits before this can be posted.</span>}
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Reference</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Entity</th>
              <th className="text-left px-4 py-3">Memo</th>
              <th className="text-right px-4 py-3">Amount</th>
              {isAdmin && <th className="text-right px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map(je => (
              <tr key={je.id}>
                <td className="px-4 py-3 font-mono text-slate-600">{je.reference}</td>
                <td className="px-4 py-3 text-slate-500">{je.date}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${je.company === 'UIPL' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{je.company}</span>
                </td>
                <td className="px-4 py-3 text-slate-700">{je.memo || '—'}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">₹{(je.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0).toLocaleString('en-IN')}</td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(je)} className="text-red-600 hover:text-red-700 font-medium">🗑️ Delete</button>
                  </td>
                )}
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={isAdmin ? 6 : 5} className="text-center py-8 text-slate-400">No manual journal entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
