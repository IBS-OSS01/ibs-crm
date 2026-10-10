// Party ledgers — the finance view of customers and vendors: credit terms, PAN/GSTIN,
// default TDS, and opening balances (which flow into the books against 3200).
// Contact details stay in CRM → Customers and Finance → Vendors.
import React, { useMemo, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { computeOutstanding } from '../utils/outstanding.js'
import { COMPANIES, fmtAmt, isValidGstin, isValidPan, todayStr, num } from '../utils/financeConstants.js'
import { tdsSectionList, Field } from '../components/formShared.jsx'
import { ReportShell, Badge, Empty, cardCls, btnPrimary, btnGhost, formInputCls, inputCls, useFinancePerms } from '../components/FinanceUI.jsx'

export default function Parties() {
  const { canWrite } = useFinancePerms()
  const { raw, allLines, loading, reload } = useFinanceData(['tdsSections'])
  const [tab, setTab] = useState('customer')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isCust = tab === 'customer'

  const bal = useMemo(() => {
    const m = {}
    ;['receivable', 'payable'].forEach(kind => {
      COMPANIES.forEach(company => {
        computeOutstanding(allLines, { kind, company, asOf: '9999-12-31' }).parties?.forEach(p => { m[`${kind}|${(p.name || '').toLowerCase()}`] = (m[`${kind}|${(p.name || '').toLowerCase()}`] || 0) + p.net })
      })
    })
    return m
  }, [allLines])

  const rows = useMemo(() => {
    if (!raw) return []
    const list = isCust ? raw.customers : raw.vendors
    return list.filter(p => { const n = isCust ? p.shopName : p.vendorName; return !q || `${n} ${p.gstin || ''} ${p.pan || ''}`.toLowerCase().includes(q.toLowerCase()) })
      .sort((a, b) => ((isCust ? a.shopName : a.vendorName) || '').localeCompare((isCust ? b.shopName : b.vendorName) || ''))
  }, [raw, isCust, q])

  const open = (p) => {
    setEdit(p); setError('')
    setForm({
      gstin: p.gstin || '', pan: p.pan || '', creditDays: p.creditDays ?? '', paymentTerms: p.paymentTerms || '',
      openingBalance: p.openingBalance ?? '', openingType: p.openingType || (isCust ? 'Dr' : 'Cr'), openingDate: p.openingDate || '',
      openingCompany: p.openingCompany || (isCust ? (p.companies || [p.company])[0] : '') || 'UIPL',
      tdsSection: p.tdsSection || '', tdsRate: p.tdsRate ?? '',
      ldcNumber: p.ldcNumber || '', ldcSection: p.ldcSection || '', ldcRate: p.ldcRate ?? '', ldcFrom: p.ldcFrom || '', ldcTo: p.ldcTo || '', ldcLimit: p.ldcLimit ?? '',
    })
  }

  const save = async () => {
    setError('')
    const gstin = form.gstin.trim().toUpperCase(), pan = form.pan.trim().toUpperCase()
    if (gstin && !isValidGstin(gstin)) return setError('GSTIN is not valid (format or check digit).')
    if (pan && !isValidPan(pan)) return setError('PAN is not valid (expected like ABCDE1234F).')
    if (num(form.openingBalance) < 0) return setError('Opening balance cannot be negative — use the Dr/Cr switch instead.')
    if (num(form.openingBalance) > 0 && !form.openingDate) return setError('Give the opening balance an as-on date (usually 1 April of the year you start using the books).')
    const patch = {
      gstin, pan, openingBalance: num(form.openingBalance), openingType: form.openingType, openingDate: form.openingDate || '',
      openingCompany: form.openingCompany,
      ...(isCust ? { creditDays: num(form.creditDays) } : { paymentTerms: form.paymentTerms, tdsSection: form.tdsSection || '', tdsRate: form.tdsSection ? num(form.tdsRate) : '',
        ldcNumber: form.ldcNumber.trim(), ldcSection: form.ldcSection, ldcRate: form.ldcNumber.trim() ? num(form.ldcRate) : '', ldcFrom: form.ldcFrom, ldcTo: form.ldcTo, ldcLimit: form.ldcNumber.trim() ? num(form.ldcLimit) : '' }),
    }
    setSaving(true)
    try {
      await updateDoc(doc(db, isCust ? 'crm_customers' : 'finance_vendors', edit.id), patch)
      invalidateFinanceCache(); reload(); setEdit(null)
    } catch (e) { setError(e.code === 'permission-denied' ? 'You do not have permission to edit this record.' : 'Could not save: ' + e.message) }
    finally { setSaving(false) }
  }

  const sections = tdsSectionList(raw)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <ReportShell title="Party Ledgers" loading={loading} subtitle="Customer & vendor finance masters — credit terms, tax IDs, default TDS and opening balances."
      filters={<>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {[['customer', 'Customers'], ['vendor', 'Vendors']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 font-medium ${tab === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, GSTIN, PAN…" className={`${inputCls} w-60`} />
      </>}>
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-xs">
        Opening balances entered here are posted to the books against <b>Opening Balance Equity (3200)</b>. If you already booked opening balances through a manual Journal Entry, don't enter them again here or they will count twice.
        {' '}Add new {isCust ? 'customers under CRM → Customers' : 'vendors under Finance → Vendors'}.
      </div>
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
            <th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">GSTIN</th><th className="text-left px-4 py-3">PAN</th>
            <th className="text-right px-4 py-3">{isCust ? 'Credit days' : 'Terms'}</th>{!isCust && <th className="text-left px-4 py-3">Default TDS</th>}
            <th className="text-right px-4 py-3">Opening</th><th className="text-right px-4 py-3">{isCust ? 'Receivable' : 'Payable'}</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(p => {
              const name = isCust ? p.shopName : p.vendorName
              const b = bal[`${isCust ? 'receivable' : 'payable'}|${(name || '').toLowerCase()}`] || 0
              return (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{name}{p.active === false && <span className="ml-2"><Badge color="bg-red-100 text-red-700">inactive</Badge></span>}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.gstin || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.pan || (!isCust ? <span className="text-amber-600">missing</span> : '—')}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{isCust ? (p.creditDays ?? 0) : (p.paymentTerms || '—')}</td>
                  {!isCust && <td className="px-4 py-2.5 text-slate-600">{p.tdsSection ? `${p.tdsSection} @ ${p.tdsRate}%` : '—'}</td>}
                  <td className="px-4 py-2.5 text-right text-slate-600">{num(p.openingBalance) ? `${fmtAmt(p.openingBalance)} ${p.openingType || (isCust ? 'Dr' : 'Cr')}` : '—'}</td>
                  <td className={`px-4 py-2.5 text-right font-medium ${b > 0.005 ? 'text-slate-800' : 'text-slate-400'}`}>{fmtAmt(b)}</td>
                  <td className="px-4 py-2.5 text-right">{canWrite && <button onClick={() => open(p)} className="text-blue-600 hover:underline text-xs">Edit</button>}</td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td colSpan={8}><Empty>No {isCust ? 'customers' : 'vendors'} found.</Empty></td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEdit(null)}>
          <div className={`${cardCls} w-full max-w-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800">{isCust ? edit.shopName : edit.vendorName}</h3>
            {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="GSTIN"><input value={form.gstin} onChange={set('gstin')} className={formInputCls} maxLength={15} /></Field>
              <Field label="PAN"><input value={form.pan} onChange={set('pan')} className={formInputCls} maxLength={10} /></Field>
              {isCust
                ? <Field label="Credit days"><input type="number" min="0" value={form.creditDays} onChange={set('creditDays')} className={formInputCls} /></Field>
                : <Field label="Payment terms"><select value={form.paymentTerms} onChange={set('paymentTerms')} className={formInputCls}>{['', 'Due on Receipt', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90'].map(t => <option key={t}>{t}</option>)}</select></Field>}
              {!isCust && <>
                <Field label="Default TDS section"><select value={form.tdsSection} onChange={e => setForm(f => ({ ...f, tdsSection: e.target.value }))} className={formInputCls}><option value="">None</option>{sections.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}</select></Field>
                <Field label="Default TDS rate %"><input type="number" step="any" value={form.tdsRate} onChange={set('tdsRate')} className={formInputCls} disabled={!form.tdsSection} /></Field>
              </>}
            </div>
            {!isCust && (
              <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase">Lower / nil deduction certificate (Form 13 / s.197)</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="Certificate no."><input value={form.ldcNumber} onChange={set('ldcNumber')} className={formInputCls} /></Field>
                  <Field label="Section (blank = any)"><select value={form.ldcSection} onChange={set('ldcSection')} className={formInputCls}><option value="">Any</option>{sections.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}</select></Field>
                  <Field label="Rate % (0 = nil)"><input type="number" step="any" min="0" value={form.ldcRate} onChange={set('ldcRate')} className={formInputCls} /></Field>
                  <Field label="Valid from"><input type="date" value={form.ldcFrom} onChange={set('ldcFrom')} className={formInputCls} /></Field>
                  <Field label="Valid to"><input type="date" value={form.ldcTo} onChange={set('ldcTo')} className={formInputCls} /></Field>
                  <Field label="Amount limit (₹)"><input type="number" min="0" step="any" value={form.ldcLimit} onChange={set('ldcLimit')} className={formInputCls} /></Field>
                </div>
                <p className="text-xs text-slate-400">When set, Purchase / Payment vouchers use this rate for dates inside the validity window. Keep track of the amount limit yourself.</p>
              </div>
            )}
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase">Opening balance</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Amount (₹)"><input type="number" min="0" step="any" value={form.openingBalance} onChange={set('openingBalance')} className={formInputCls} /></Field>
                <Field label="Dr / Cr"><select value={form.openingType} onChange={set('openingType')} className={formInputCls}><option>Dr</option><option>Cr</option></select></Field>
                <Field label="As on"><input type="date" value={form.openingDate} onChange={set('openingDate')} className={formInputCls} max={todayStr()} /></Field>
                <Field label="Company"><select value={form.openingCompany} onChange={set('openingCompany')} className={formInputCls}>{COMPANIES.map(c => <option key={c}>{c}</option>)}</select></Field>
              </div>
              <p className="text-xs text-slate-400">{isCust ? 'Dr = the customer owed you this much on that date.' : 'Cr = you owed the vendor this much on that date.'}</p>
            </div>
            <div className="flex gap-2"><button onClick={save} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button><button onClick={() => setEdit(null)} className={btnGhost}>Cancel</button></div>
          </div>
        </div>
      )}
    </ReportShell>
  )
}
