import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { deriveAllLines, manualEntryLines, assertBalanced } from '../utils/ledger.js'

// Read-only GST summary for a filing period, built entirely from the General
// Ledger (finance/utils/ledger.js) — no new data model. Output GST comes from
// the Sales invoices posted to 2401/2402/2403 (CGST/SGST/IGST). Input GST
// (1301/1302/1303) will show ₹0 for now: nothing in the app captures GST
// paid on purchases yet (Payables has no per-line GST breakdown), so this is
// an honest reflection of what's actually tracked today, not a bug.
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const today = () => new Date().toISOString().slice(0, 10)
const COMPANIES = ['UIPL', 'Wayzim']

const OUTPUT_CODES = { '2401': 'CGST Payable', '2402': 'SGST Payable', '2403': 'IGST Payable' }
const INPUT_CODES  = { '1301': 'Input CGST',    '1302': 'Input SGST',    '1303': 'Input IGST' }

export default function GstFiling() {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState('UIPL')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())

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
    const combined = [...deriveAllLines(raw), ...manualEntryLines(raw.journalEntries)]
    if (import.meta.env.DEV) assertBalanced(combined)
    return combined
  }, [raw])

  // Sum credit-side (output tax collected) and debit-side (input tax paid)
  // per account code, for lines dated within [from, to] for this company —
  // a period slice, not a cumulative as-of balance, since a GST return covers
  // exactly one filing period.
  const periodTotals = useMemo(() => {
    const totals = {}
    allLines.forEach(l => {
      if (l.company !== company) return
      if ((l.date || '') < from || (l.date || '') > to) return
      if (!totals[l.accountCode]) totals[l.accountCode] = { debit: 0, credit: 0 }
      totals[l.accountCode].debit += Number(l.debit) || 0
      totals[l.accountCode].credit += Number(l.credit) || 0
    })
    return totals
  }, [allLines, company, from, to])

  const outputRows = Object.entries(OUTPUT_CODES).map(([code, label]) => ({ code, label, amount: periodTotals[code]?.credit || 0 }))
  const inputRows  = Object.entries(INPUT_CODES).map(([code, label]) => ({ code, label, amount: periodTotals[code]?.debit || 0 }))
  const totalOutput = outputRows.reduce((s, r) => s + r.amount, 0)
  const totalInput  = inputRows.reduce((s, r) => s + r.amount, 0)
  const netPayable  = totalOutput - totalInput

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">GST Filing</h2>
        <p className="text-slate-500 text-sm">Output GST collected on sales, for a filing period — derived from the General Ledger.</p>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {COMPANIES.map(co => (
            <button key={co} onClick={() => setCompany(co)}
              className={`px-4 py-1.5 font-medium transition ${company === co ? (co === 'UIPL' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white') : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {co}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">From:</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">To:</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {company === 'Wayzim' && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
          Wayzim invoices don't apply GST — this report will show ₹0 for Wayzim by design.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Output GST (collected on sales)</p>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {outputRows.map(r => (
                <tr key={r.code}>
                  <td className="px-4 py-2.5 text-slate-600">{r.label}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-800">₹{r.amount.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50">
                <td className="px-4 py-2.5 font-bold text-blue-800">Total Output</td>
                <td className="px-4 py-2.5 text-right font-bold text-blue-800">₹{totalOutput.toLocaleString('en-IN')}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Input GST (paid on purchases)</p>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {inputRows.map(r => (
                <tr key={r.code}>
                  <td className="px-4 py-2.5 text-slate-600">{r.label}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-800">₹{r.amount.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50">
                <td className="px-4 py-2.5 font-bold text-slate-700">Total Input</td>
                <td className="px-4 py-2.5 text-right font-bold text-slate-700">₹{totalInput.toLocaleString('en-IN')}</td>
              </tr>
            </tfoot>
          </table>
          <p className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">Purchases/Payables don't capture a GST breakdown yet, so this stays ₹0 for now.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-700">Net GST Payable</p>
          <p className="text-xs text-slate-400">Output − Input, for {company}, {from} to {to}</p>
        </div>
        <p className={`text-2xl font-bold ${netPayable >= 0 ? 'text-red-600' : 'text-green-600'}`}>₹{Math.abs(netPayable).toLocaleString('en-IN')}</p>
      </div>
    </div>
  )
}
