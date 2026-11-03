// Exchange rates (INR per 1 unit of a foreign currency) and the year-end revaluation of open foreign bills.
import React, { useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc } from '../../../lib/cachedFirestore'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { computeOutstanding } from '../utils/outstanding.js'
import { CURRENCIES, rateOn, fetchMarketRate, revaluation, fmtFc } from '../utils/fx.js'
import { fmtAmt, todayStr, num, r2 } from '../utils/financeConstants.js'
import { downloadXlsx } from '../utils/exportUtils.js'
import { Field } from '../components/formShared.jsx'
import { ReportShell, CompanyToggle, ExportBar, Empty, cardCls, inputCls, formInputCls, thCls, btnPrimary, btnGhost, useFinancePerms } from '../components/FinanceUI.jsx'

const TABS = [['rates', 'Exchange rates'], ['revaluation', 'Year-end revaluation']]
const Th = ({ children, right }) => <th className={`${thCls} ${right ? 'text-right' : 'text-left'}`}>{children}</th>

export default function FxRates() {
  const { tab = 'rates' } = useParams()
  const navigate = useNavigate()
  const { canWrite } = useFinancePerms()
  const { user } = useAuth()
  const { raw, allLines, loading, reload } = useFinanceData()
  const [company, setCompany] = useState('UIPL')
  const [asOf, setAsOf] = useState(todayStr())
  const [f, setF] = useState({ currency: 'USD', date: todayStr(), rate: '', note: '' })
  const [msg, setMsg] = useState('')
  const [closing, setClosing] = useState({})
  const rates = raw?.fxRates || []

  const sorted = useMemo(() => [...rates].sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.currency.localeCompare(b.currency)), [rates])
  const latest = useMemo(() => CURRENCIES.filter(c => c.code !== 'INR').map(c => { const r = rateOn(rates, c.code, '9999-12-31'); return r ? { ...c, rate: r, date: [...rates].filter(x => x.currency === c.code).sort((a, b) => b.date.localeCompare(a.date))[0]?.date } : null }).filter(Boolean), [rates])

  const get = async () => { setMsg(''); try { const r = await fetchMarketRate(f.currency, f.date); setF(x => ({ ...x, rate: String(r.rate), note: x.note || `ECB reference rate ${r.date}` })) } catch (e) { setMsg(e.message) } }
  const add = async () => {
    setMsg('')
    if (num(f.rate) <= 0) return setMsg('Enter the rate (rupees per 1 unit).')
    if (rates.some(r => r.currency === f.currency && r.date === f.date)) return setMsg(`There is already a ${f.currency} rate for ${f.date} — delete it first to change it.`)
    await addDoc(collection(db, 'finance_fx_rates'), { currency: f.currency, date: f.date, rate: num(f.rate), note: f.note.trim(), createdAt: new Date().toISOString(), createdBy: user?.uid || '' })
    setF({ ...f, rate: '', note: '' }); invalidateFinanceCache(); reload()
  }
  const del = async (id) => { await deleteDoc(doc(db, 'finance_fx_rates', id)); invalidateFinanceCache(); reload() }

  // ── revaluation ──
  const open = useMemo(() => ['receivable', 'payable'].map(kind => ({ kind, bills: computeOutstanding(allLines, { kind, company, asOf }).parties.flatMap(p => p.bills.map(b => ({ ...b, party: p.name }))) })), [allLines, company, asOf])
  const currencies = [...new Set(open.flatMap(o => o.bills.filter(b => b.currency).map(b => b.currency)))]
  const closeRate = (c) => num(closing[c]) > 0 ? num(closing[c]) : rateOn(rates, c, asOf)
  const reval = open.map(o => ({ kind: o.kind, rows: revaluation(o.bills, o.kind, closeRate) }))
  const net = r2(reval.reduce((s, g) => s + g.rows.reduce((t, r) => t + r.gain, 0), 0))
  const label = TABS.find(t => t[0] === tab)?.[1]

  return (
    <ReportShell title={label} loading={loading}
      subtitle={tab === 'rates' ? 'Rupees per 1 unit of foreign currency. A voucher picks the latest rate on or before its date, and you can always overtype it.' : 'Open foreign-currency bills restated at the closing rate — the unrealised exchange gain or loss to book at year end.'}
      exportBar={tab === 'revaluation' ? <ExportBar onXlsx={() => downloadXlsx(`Forex revaluation ${company} ${asOf}`, [{ name: 'Revaluation', rows: [['Type', 'Party', 'Bill', 'Currency', 'Foreign pending', 'Booked rate', 'Book value INR', 'Closing rate', 'Closing value INR', 'Unrealised gain / (loss)'], ...reval.flatMap(g => g.rows.map(r => [g.kind, r.party, r.docNo, r.currency, r.fcPending, r.fxRate, r.bookInr, r.closingRate, r.closingInr, r.gain]))] }])} /> : null}
      filters={<>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">{TABS.map(([k, l]) => <button key={k} onClick={() => navigate(`/finance/fx/${k}`)} className={`px-3 py-1.5 font-medium ${k === tab ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}</div>
        {tab === 'revaluation' && <><CompanyToggle value={company} onChange={setCompany} /><label className="text-sm text-slate-500 flex items-center gap-2">As of <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={inputCls} /></label></>}
      </>}>
      {tab === 'rates' && (
        <>
          {canWrite && (
            <div className={`${cardCls} p-3 grid grid-cols-2 md:grid-cols-6 gap-3 items-end`}>
              <Field label="Currency"><select value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })} className={formInputCls}>{CURRENCIES.filter(c => c.code !== 'INR').map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select></Field>
              <Field label="Effective from"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} className={formInputCls} /></Field>
              <Field label="₹ per 1 unit"><input type="number" min="0" step="any" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value })} className={formInputCls} /></Field>
              <Field label="Note" className="md:col-span-2"><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} className={formInputCls} placeholder="e.g. RBI reference rate, bank TT buying rate" /></Field>
              <div className="flex gap-2"><button className={btnGhost} onClick={get}>Get market rate</button><button className={btnPrimary} onClick={add}>Add</button></div>
              {msg && <p className="col-span-full text-sm text-red-600">{msg}</p>}
            </div>
          )}
          <p className="text-xs text-slate-400">“Get market rate” fills in the ECB reference rate for that date (free). For GST invoices the law expects the RBI / customs-notified rate and for your books your bank's actual rate — type whichever your CA prefers; it is only a starting point.</p>
          {latest.length > 0 && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{latest.map(c => <div key={c.code} className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">{c.code} · {c.name}</p><p className="text-lg font-bold">₹{c.rate}</p><p className="text-xs text-slate-400">since {c.date}</p></div>)}</div>}
          <div className={`${cardCls} overflow-x-auto`}>
            <table className="w-full text-sm"><thead className="bg-slate-50/80"><tr><Th>Currency</Th><Th>From</Th><Th right>₹ per unit</Th><Th>Note</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map(r => <tr key={r.id}><td className="px-3 py-2 font-medium">{r.currency}</td><td className="px-3 py-2">{r.date}</td><td className="px-3 py-2 text-right">{r.rate}</td><td className="px-3 py-2 text-slate-500">{r.note}</td><td className="px-3 py-2 text-right">{canWrite && <button className="text-xs text-red-500 hover:underline" onClick={() => del(r.id)}>Delete</button>}</td></tr>)}
                {sorted.length === 0 && <tr><td colSpan={5}><Empty>No rates saved yet. Vouchers can still take a rate typed on the voucher itself.</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'revaluation' && (
        <>
          {currencies.length === 0 && <Empty>No open foreign-currency bills for {company} as of {asOf}.</Empty>}
          {currencies.length > 0 && (
            <>
              <div className={`${cardCls} p-3 flex gap-4 flex-wrap items-end`}>
                {currencies.map(c => <Field key={c} label={`Closing rate ${c}`}><input type="number" step="any" min="0" value={closing[c] ?? ''} placeholder={String(rateOn(rates, c, asOf) || '')} onChange={e => setClosing({ ...closing, [c]: e.target.value })} className={`${formInputCls} w-36`} /></Field>)}
                <p className="text-xs text-slate-400">Blank = latest rate on file on or before {asOf}.</p>
              </div>
              {reval.map(g => g.rows.length > 0 && (
                <div key={g.kind} className="space-y-2">
                  <h3 className="font-semibold text-slate-800">{g.kind === 'receivable' ? 'Customers (receivables)' : 'Vendors (payables)'}</h3>
                  <div className={`${cardCls} overflow-x-auto`}>
                    <table className="w-full text-sm"><thead className="bg-slate-50/80"><tr><Th>Party</Th><Th>Bill</Th><Th right>Owed</Th><Th right>Booked at</Th><Th right>Book ₹</Th><Th right>Closing</Th><Th right>Closing ₹</Th><Th right>Gain / (loss)</Th></tr></thead>
                      <tbody className="divide-y divide-slate-100">{g.rows.map(r => (
                        <tr key={r.billKey}><td className="px-3 py-2">{r.party}</td><td className="px-3 py-2 font-mono text-xs">{r.docNo}</td><td className="px-3 py-2 text-right">{fmtFc(r.fcPending, r.currency)}</td><td className="px-3 py-2 text-right">{r.fxRate}</td><td className="px-3 py-2 text-right">{fmtAmt(r.bookInr)}</td>
                          <td className="px-3 py-2 text-right">{r.closingRate || <span className="text-red-500">no rate</span>}</td><td className="px-3 py-2 text-right">{fmtAmt(r.closingInr)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${r.gain >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtAmt(r.gain)}</td></tr>))}</tbody>
                    </table>
                  </div>
                </div>
              ))}
              <div className={`rounded-xl p-4 border ${net >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-sm text-slate-600">Net unrealised {net >= 0 ? 'gain' : 'loss'} at {asOf}</p>
                <p className={`text-2xl font-bold ${net >= 0 ? 'text-green-700' : 'text-red-600'}`}>₹{fmtAmt(Math.abs(net))}</p>
                <p className="text-xs text-slate-500 mt-1">To book it: a Journal Entry dated {asOf} — {net >= 0 ? 'Dr Accounts Receivable / Accounts Payable (as shown above), Cr Foreign Exchange Gain (4925)' : 'Dr Foreign Exchange Loss (5925), Cr Accounts Receivable / Accounts Payable (as shown above)'} — reversed on the first day of the next period. Settlement later books only the difference from the original booking rate.</p>
              </div>
            </>
          )}
        </>
      )}
    </ReportShell>
  )
}
