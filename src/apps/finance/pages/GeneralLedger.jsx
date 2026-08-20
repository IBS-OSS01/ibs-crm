import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { deriveAllLines, manualEntryLines, assertBalanced } from '../utils/ledger.js'

const SOURCE_LABELS = { invoice: '🧾 Invoice', payment: '💳 Payment', expense: '📤 Expense', payable: '🧾 Payable', manual: '📝 Manual JE' }

export default function GeneralLedger() {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState('UIPL')
  const [accountCode, setAccountCode] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const [invSnap, paySnap, ordSnap, expSnap, payblSnap, acctSnap, jeSnap] = await Promise.all([
          getDocs(collection(db, 'finance_invoices')),
          getDocs(collection(db, 'finance_payments')),
          getDocs(collection(db, 'crm_orders')),
          getDocs(collection(db, 'finance_expenses')),
          getDocs(collection(db, 'finance_payables')),
          getDocs(collection(db, 'finance_accounts')),
          getDocs(collection(db, 'finance_journal_entries')),
        ])
        const toArr = s => { const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); return a }
        const accounts = toArr(acctSnap).sort((a, b) => (a.code || '').localeCompare(b.code || ''))
        setRaw({
          invoices: toArr(invSnap), payments: toArr(paySnap), orders: toArr(ordSnap),
          expenses: toArr(expSnap), payables: toArr(payblSnap), accounts,
          journalEntries: toArr(jeSnap),
        })
        if (accounts.length && !accountCode) setAccountCode(accounts[0].code)
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allLines = useMemo(() => {
    if (!raw) return []
    const derived = deriveAllLines(raw)
    const manual = manualEntryLines(raw.journalEntries)
    const combined = [...derived, ...manual]
    if (import.meta.env.DEV) assertBalanced(combined)
    return combined
  }, [raw])

  const account = raw?.accounts.find(a => a.code === accountCode)

  const rows = useMemo(() => {
    if (!raw || !account) return []
    const filtered = allLines
      .filter(l => l.accountCode === accountCode && l.company === company)
      .filter(l => !dateFrom || (l.date || '') >= dateFrom)
      .filter(l => !dateTo || (l.date || '') <= dateTo)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    let running = 0
    return filtered.map(l => {
      const delta = account.normalBalance === 'debit' ? (l.debit - l.credit) : (l.credit - l.debit)
      running += delta
      return { ...l, running }
    })
  }, [allLines, raw, account, accountCode, company, dateFrom, dateTo])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">General Ledger</h2>
        <p className="text-slate-500 text-sm">Every line that hit one account, in order, with a running balance.</p>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {['UIPL', 'Wayzim'].map(co => (
            <button key={co} onClick={() => setCompany(co)}
              className={`px-4 py-1.5 font-medium transition ${company === co ? (co === 'UIPL' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white') : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {co}
            </button>
          ))}
        </div>
        <select value={accountCode} onChange={e => setAccountCode(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-64">
          {(raw?.accounts || []).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="From"
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-slate-400 text-sm">to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {(raw?.accounts || []).length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          Seed the Chart of Accounts first (Finance → Chart of Accounts).
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Doc #</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-right px-4 py-3">Debit</th>
                <th className="text-right px-4 py-3">Credit</th>
                <th className="text-right px-4 py-3">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 text-slate-500">{r.date}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {SOURCE_LABELS[r.sourceType] || r.sourceType}
                    {r.companyInferred && <span className="ml-1.5 text-xs text-amber-600" title="This source document has no company field — defaulted to UIPL">⚠ company assumed</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{r.sourceDocNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{r.description || '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{r.debit > 0 ? `₹${r.debit.toLocaleString('en-IN')}` : ''}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{r.credit > 0 ? `₹${r.credit.toLocaleString('en-IN')}` : ''}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-800">₹{r.running.toLocaleString('en-IN')}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">No activity for this account in {company}{dateFrom || dateTo ? ' in this date range' : ''}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
