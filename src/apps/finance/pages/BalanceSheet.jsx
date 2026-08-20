import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { deriveAllLines, manualEntryLines, computeAccountBalances, assertBalanced } from '../utils/ledger.js'

const today = () => new Date().toISOString().slice(0, 10)
const fmt = n => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`

export default function BalanceSheet() {
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

  const balances = useMemo(() => {
    if (!raw) return []
    return computeAccountBalances(allLines, raw.accounts, { company, asOfDate })
  }, [allLines, raw, company, asOfDate])

  const assets = balances.filter(b => b.type === 'asset' && Math.abs(b.balance) > 0.01).sort((a, b) => a.code.localeCompare(b.code))
  const liabilities = balances.filter(b => b.type === 'liability' && Math.abs(b.balance) > 0.01).sort((a, b) => a.code.localeCompare(b.code))
  const equity = balances.filter(b => b.type === 'equity' && Math.abs(b.balance) > 0.01).sort((a, b) => a.code.localeCompare(b.code))
  const income = balances.filter(b => b.type === 'income')
  const expense = balances.filter(b => b.type === 'expense')

  const totalAssets = assets.reduce((s, a) => s + a.balance, 0)
  const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0)
  const totalEquity = equity.reduce((s, a) => s + a.balance, 0)
  const netIncome = income.reduce((s, a) => s + a.balance, 0) - expense.reduce((s, a) => s + a.balance, 0)
  const totalLiabPlusEquity = totalLiabilities + totalEquity + netIncome
  const isBalanced = Math.abs(totalAssets - totalLiabPlusEquity) < 0.01

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Balance Sheet</h2>
        <p className="text-slate-500 text-sm">Assets, Liabilities &amp; Equity as of a date. Net income is cumulative-to-date (folded into Equity) since no period-close step exists yet.</p>
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

      {(raw?.accounts || []).length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          Seed the Chart of Accounts first (Finance → Chart of Accounts).
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3">Assets</p>
            <BalanceList rows={assets} />
            <div className="border-t border-slate-200 mt-3 pt-3 flex justify-between font-bold text-slate-800">
              <span>Total Assets</span><span>{fmt(totalAssets)}</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">Liabilities</p>
            <BalanceList rows={liabilities} />
            <div className="border-t border-slate-200 mt-3 pt-3 flex justify-between font-bold text-slate-800">
              <span>Total Liabilities</span><span>{fmt(totalLiabilities)}</span>
            </div>

            <p className="text-xs font-bold uppercase tracking-wider text-purple-600 mb-3 mt-6">Equity</p>
            <BalanceList rows={equity} />
            <div className="flex justify-between text-sm text-slate-600 py-1">
              <span>Net Income (cumulative to date)</span><span className={netIncome >= 0 ? 'text-green-700' : 'text-red-600'}>{netIncome >= 0 ? '' : '-'}{fmt(netIncome)}</span>
            </div>
            <div className="border-t border-slate-200 mt-3 pt-3 flex justify-between font-bold text-slate-800">
              <span>Total Equity</span><span>{fmt(totalEquity + netIncome)}</span>
            </div>
          </div>
        </div>
      )}

      {(raw?.accounts || []).length > 0 && (
        <div className={`rounded-2xl border p-4 flex items-center justify-between ${isBalanced ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <span className={`font-bold ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>
            {isBalanced ? '✅ Balanced' : '⚠ Not balanced'} — Assets {fmt(totalAssets)} vs Liabilities + Equity {fmt(totalLiabPlusEquity)}
          </span>
        </div>
      )}
    </div>
  )
}

function BalanceList({ rows }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400 italic">No activity</p>
  return (
    <div className="space-y-1">
      {rows.map(r => (
        <div key={r.code} className={`flex justify-between text-sm py-1 ${r.parentCode ? 'pl-4 text-slate-600' : 'text-slate-700 font-medium'}`}>
          <span>{r.name}</span>
          <span>{fmt(r.balance)}</span>
        </div>
      ))}
    </div>
  )
}
