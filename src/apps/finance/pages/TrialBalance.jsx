import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { deriveAllLines, manualEntryLines, computeAccountBalances, assertBalanced } from '../utils/ledger.js'

const today = () => new Date().toISOString().slice(0, 10)

export default function TrialBalance() {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState('UIPL')
  const [asOfDate, setAsOfDate] = useState(today())

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
        setRaw({
          invoices: toArr(invSnap), payments: toArr(paySnap), orders: toArr(ordSnap),
          expenses: toArr(expSnap), payables: toArr(payblSnap), accounts: toArr(acctSnap),
          journalEntries: toArr(jeSnap),
        })
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const allLines = useMemo(() => {
    if (!raw) return []
    const derived = deriveAllLines(raw)
    const manual = manualEntryLines(raw.journalEntries)
    const combined = [...derived, ...manual]
    if (import.meta.env.DEV) assertBalanced(combined)
    return combined
  }, [raw])

  const rows = useMemo(() => {
    if (!raw) return []
    return computeAccountBalances(allLines, raw.accounts, { company, asOfDate })
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [allLines, raw, company, asOfDate])

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Trial Balance</h2>
        <p className="text-slate-500 text-sm">Every account's activity as of a date — auto-derived from Invoices/Payments/Expenses/Payables plus posted Journal Entries.</p>
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
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">As of:</label>
          <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Account</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Debit</th>
              <th className="text-right px-4 py-3">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.code}>
                <td className="px-4 py-3 font-mono text-slate-600">{r.code}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                <td className="px-4 py-3 text-slate-400 capitalize text-xs">{r.type}</td>
                <td className="px-4 py-3 text-right text-slate-700">{r.debit > 0 ? `₹${r.debit.toLocaleString('en-IN')}` : '—'}</td>
                <td className="px-4 py-3 text-right text-slate-700">{r.credit > 0 ? `₹${r.credit.toLocaleString('en-IN')}` : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400">No activity for {company} as of {asOfDate}. {raw?.accounts?.length === 0 ? 'Seed the Chart of Accounts first (Finance → Chart of Accounts).' : ''}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className={isBalanced ? 'bg-green-50' : 'bg-red-50'}>
              <td className="px-4 py-3 font-bold text-slate-700" colSpan={3}>Total</td>
              <td className={`px-4 py-3 text-right font-bold ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>₹{totalDebit.toLocaleString('en-IN')}</td>
              <td className={`px-4 py-3 text-right font-bold ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>₹{totalCredit.toLocaleString('en-IN')}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!isBalanced && (
        <p className="text-xs text-red-600">⚠ Total debit and credit don't match — this shouldn't happen with auto-derived data alone; check for a malformed manual Journal Entry.</p>
      )}
    </div>
  )
}
