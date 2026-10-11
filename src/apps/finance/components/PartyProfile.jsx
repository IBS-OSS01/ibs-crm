// Customer / vendor profile — a business-details card (full address, tax IDs, contact, terms, bank), the party's
// financial summary, its ledger statement and its open bills, in one window. Everything is read from the master record
// and the derived ledger, so it always agrees with the reports.
import React, { useMemo, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { buildVoucherIndex } from '../utils/voucherIndex.js'
import { ledgerStatement } from '../utils/statements.js'
import { computeOutstanding } from '../utils/outstanding.js'
import { INDIA_STATES } from '../utils/indiaConstants.js'
import { VOUCHER_TYPES, kindOfSource, fmtAmt, fmtDrCr, fyRange, currentFY, todayStr, num, r2, normName } from '../utils/financeConstants.js'
import { downloadXlsx, downloadCsv, printReport } from '../utils/exportUtils.js'
import { useVoucherModal } from './useVoucherModal.jsx'
import { Field } from './formShared.jsx'
import { Badge, DateRange, DrCr, btnGhost, btnPrimary, formInputCls } from './FinanceUI.jsx'

const COMPANY = 'UIPL'
const FIELDS = {
  customer: { name: 'shopName', contact: 'ownerName', contactLabel: 'Owner / contact person', coll: 'crm_customers', control: '1200', kindOut: 'receivable' },
  vendor: { name: 'vendorName', contact: 'contactPerson', contactLabel: 'Contact person', coll: 'finance_vendors', control: '2100', kindOut: 'payable' },
}
const stateOf = (p) => p.state || INDIA_STATES.find(s => s.code === String(p.gstin || '').slice(0, 2))?.name || ''
const addressLines = (p) => [p.address, p.area, [p.city, stateOf(p), p.pincode].filter(Boolean).join(', '), p.country && p.country !== 'India' ? p.country : ''].filter(Boolean)

function Row({ label, children }) {
  return <div className="flex gap-3 py-1.5 text-sm"><span className="w-36 shrink-0 text-slate-400">{label}</span><span className="text-slate-800 min-w-0 break-words">{children || <span className="text-slate-300">—</span>}</span></div>
}

export default function PartyProfile({ kind, party, raw, allLines, canWrite, reload, onClose }) {
  const F = FIELDS[kind]
  const name = party[F.name] || ''
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState(fyRange(currentFY()))
  const { open, modal } = useVoucherModal({ raw, allLines, reload })

  const match = useMemo(() => (l) => l.accountCode === F.control && (l.partyId === party.id || normName(l.partyName) === normName(name)), [F.control, party.id, name])
  const stmt = useMemo(() => ledgerStatement(allLines, { match, company: COMPANY, from: period.from, to: period.to }), [allLines, match, period])
  const lifetime = useMemo(() => ledgerStatement(allLines, { match, company: COMPANY, from: '', to: '' }), [allLines, match])
  const bills = useMemo(() => {
    const o = computeOutstanding(allLines, { kind: F.kindOut, company: COMPANY, asOf: todayStr() })
    const p = o.parties.find(x => (party.id && x.partyId === party.id) || normName(x.name) === normName(name))
    return p || { bills: [], totalPending: 0, advance: 0, net: 0 }
  }, [allLines, F.kindOut, party.id, name])
  const overdue = r2(bills.bills.filter(b => b.daysOverdue > 0).reduce((s, b) => s + b.pending, 0))
  const entryByLineKey = useMemo(() => { const m = {}; if (raw) buildVoucherIndex(raw).forEach(e => { if (!m[e.lineKey]) m[e.lineKey] = e }); return m }, [raw])
  const openRow = (r) => { const e = entryByLineKey[`${r.sourceType}:${r.sourceId}`]; if (e) open(e) }

  const isCust = kind === 'customer'
  const missing = [
    !party.address && 'street address', !party.city && 'city', !stateOf(party) && 'state', !party.pincode && 'pincode',
    !party.gstin && 'GSTIN', !party.pan && 'PAN', !party.phone && !party.email && 'phone / email',
  ].filter(Boolean)
  const lastTxn = lifetime.rows.length ? lifetime.rows[lifetime.rows.length - 1].date : ''

  const startEdit = () => {
    setForm({ [F.contact]: party[F.contact] || '', phone: party.phone || '', email: party.email || '', address: party.address || '', area: party.area || '', city: party.city || '',
      state: stateOf(party), pincode: party.pincode || '', country: party.country || 'India', ...(isCust ? {} : { bankName: party.bankName || '', bankAccount: party.bankAccount || '', ifsc: party.ifsc || '' }) })
    setError(''); setEditing(true)
  }
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const save = async () => {
    setError('')
    if (form.pincode && !/^\d{6}$/.test(form.pincode.trim())) return setError('Pincode should be 6 digits.')
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('Email does not look right.')
    setSaving(true)
    try {
      const patch = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
      const st = INDIA_STATES.find(s => s.name === patch.state); if (st) patch.stateCode = st.code
      await updateDoc(doc(db, F.coll, party.id), patch)
      Object.assign(party, patch)                 // show the change straight away; the master list reloads behind it
      invalidateFinanceCache(); reload?.(); setEditing(false)
    } catch (e) { setError(e.code === 'permission-denied' ? 'You do not have permission to edit this record.' : 'Could not save: ' + e.message) }
    finally { setSaving(false) }
  }

  const sheet = () => [
    ['Date', 'Type', 'Voucher No', 'Particulars', 'Debit', 'Credit', 'Balance (Dr+/Cr−)'],
    ['', '', '', 'Opening balance', '', '', stmt.opening],
    ...stmt.rows.map(r => [r.date, VOUCHER_TYPES[kindOfSource(r.sourceType)]?.label || r.sourceType, r.docNo, r.particulars, r.debit || '', r.credit || '', r.balance]),
    ['', '', '', 'Closing balance', stmt.totalDebit, stmt.totalCredit, stmt.closing],
  ]
  const title = `Ledger — ${name} ${period.from} to ${period.to}`
  const tabs = [['overview', 'Business details'], ['ledger', 'Ledger'], ['bills', isCust ? 'Open invoices' : 'Open bills']]

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/70 w-full max-w-5xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 flex-wrap"><h3 className="text-xl font-bold text-slate-900">{name}</h3><Badge color="bg-slate-100 text-slate-600">{isCust ? 'Customer' : 'Vendor'}</Badge>{party.active === false && <Badge color="bg-red-100 text-red-700">inactive</Badge>}</div>
            <p className="text-sm text-slate-500 mt-0.5">{party.gstin ? `GSTIN ${party.gstin}` : 'No GSTIN'}{party.pan ? ` · PAN ${party.pan}` : ''}{stateOf(party) ? ` · ${stateOf(party)}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>
        <div className="flex gap-1 px-5 pt-3 border-b border-slate-100">
          {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{l}{k === 'bills' && bills.bills.length ? <span className="ml-1.5 text-xs bg-slate-100 text-slate-600 rounded-full px-1.5">{bills.bills.length}</span> : null}</button>)}
        </div>

        <div className="p-5">
          {tab === 'overview' && (
            <div className="grid md:grid-cols-2 gap-5">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-1"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Business details</p>{canWrite && !editing && <button onClick={startEdit} className="text-sm text-blue-600 hover:underline">✏️ Edit address & contact</button>}</div>
                {!editing ? (<>
                  <Row label="Name">{name}</Row>
                  <Row label="Address">{addressLines(party).length ? addressLines(party).map((l, i) => <span key={i} className="block">{l}</span>) : null}</Row>
                  <Row label="GSTIN">{party.gstin && <span className="font-mono">{party.gstin}</span>}</Row>
                  <Row label="PAN">{party.pan && <span className="font-mono">{party.pan}</span>}</Row>
                  <Row label={F.contactLabel}>{party[F.contact]}</Row>
                  <Row label="Phone">{party.phone}</Row>
                  <Row label="Email">{party.email}</Row>
                  <Row label={isCust ? 'Credit days' : 'Payment terms'}>{isCust ? (party.creditDays ?? 0) + ' days' : party.paymentTerms}</Row>
                  {!isCust && <Row label="Default TDS">{party.tdsSection ? `${party.tdsSection} @ ${party.tdsRate}%` : ''}</Row>}
                  {!isCust && <Row label="Bank">{[party.bankName, party.bankAccount && `A/c ${party.bankAccount}`, party.ifsc && `IFSC ${party.ifsc}`].filter(Boolean).join(' · ')}</Row>}
                  <Row label="Opening balance">{num(party.openingBalance) ? `₹${fmtAmt(party.openingBalance)} ${party.openingType || (isCust ? 'Dr' : 'Cr')} as on ${party.openingDate || '—'}` : ''}</Row>
                  {missing.length > 0 && <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Incomplete: {missing.join(', ')}.{canWrite ? ' Use “Edit address & contact” (GSTIN, PAN and terms are on the list page).' : ''}</p>}
                </>) : (
                  <div className="space-y-3 mt-2">
                    {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
                    <Field label="Street address"><input value={form.address} onChange={set('address')} className={formInputCls} /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Area / locality"><input value={form.area} onChange={set('area')} className={formInputCls} /></Field>
                      <Field label="City"><input value={form.city} onChange={set('city')} className={formInputCls} /></Field>
                      <Field label="State"><select value={form.state} onChange={set('state')} className={formInputCls}><option value="">— select —</option>{INDIA_STATES.map(s => <option key={s.code}>{s.name}</option>)}</select></Field>
                      <Field label="Pincode"><input value={form.pincode} onChange={set('pincode')} maxLength={6} className={formInputCls} /></Field>
                      <Field label="Country"><input value={form.country} onChange={set('country')} className={formInputCls} /></Field>
                      <Field label={F.contactLabel}><input value={form[F.contact]} onChange={set(F.contact)} className={formInputCls} /></Field>
                      <Field label="Phone"><input value={form.phone} onChange={set('phone')} className={formInputCls} /></Field>
                      <Field label="Email"><input type="email" value={form.email} onChange={set('email')} className={formInputCls} /></Field>
                      {!isCust && <>
                        <Field label="Bank name"><input value={form.bankName} onChange={set('bankName')} className={formInputCls} /></Field>
                        <Field label="Account number"><input value={form.bankAccount} onChange={set('bankAccount')} className={formInputCls} /></Field>
                        <Field label="IFSC"><input value={form.ifsc} onChange={set('ifsc')} className={formInputCls} /></Field>
                      </>}
                    </div>
                    <div className="flex gap-2"><button onClick={save} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button><button onClick={() => setEditing(false)} className={btnGhost}>Cancel</button></div>
                  </div>)}
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{isCust ? 'Receivable' : 'Payable'} position</p>
                  <p className="text-2xl font-semibold text-slate-900">₹{fmtAmt(bills.net)}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{bills.bills.length} open {isCust ? 'invoice' : 'bill'}(s){overdue > 0 ? <> · <span className="text-red-600">₹{fmtAmt(overdue)} overdue</span></> : ''}{bills.advance > 0.005 ? <> · ₹{fmtAmt(bills.advance)} unapplied {isCust ? 'receipt' : 'payment'}</> : ''}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-400">{isCust ? 'Billed (all time)' : 'Billed by vendor (all time)'}</p><p className="font-semibold text-slate-800">₹{fmtAmt(isCust ? lifetime.totalDebit : lifetime.totalCredit)}</p></div>
                  <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-400">{isCust ? 'Received (all time)' : 'Paid (all time)'}</p><p className="font-semibold text-slate-800">₹{fmtAmt(isCust ? lifetime.totalCredit : lifetime.totalDebit)}</p></div>
                  <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-400">Last transaction</p><p className="font-semibold text-slate-800">{lastTxn || '—'}</p></div>
                  <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-400">Ledger balance</p><p className="font-semibold text-slate-800">{fmtDrCr(lifetime.closing)}</p></div>
                </div>
                <button onClick={() => setTab('ledger')} className={btnGhost}>📖 View ledger</button>
              </div>
            </div>
          )}

          {tab === 'ledger' && (<>
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <DateRange from={period.from} to={period.to} onChange={setPeriod} />
              <span className="ml-auto flex gap-2">
                <button className={btnGhost} onClick={() => downloadXlsx(title, [{ name: 'Ledger', rows: sheet() }])}>⬇ Excel</button>
                <button className={btnGhost} onClick={() => downloadCsv(title, sheet())}>⬇ CSV</button>
                <button className={btnGhost} onClick={() => printReport({ title: `Ledger: ${name}`, subtitle: `${COMPANY} · ${period.from} to ${period.to}`, rows: sheet() })}>🖨 Print</button>
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
                  <th className="text-left px-4 py-2.5">Date</th><th className="text-left px-4 py-2.5">Type</th><th className="text-left px-4 py-2.5">Voucher #</th><th className="text-left px-4 py-2.5">Particulars</th>
                  <th className="text-right px-4 py-2.5">Debit</th><th className="text-right px-4 py-2.5">Credit</th><th className="text-right px-4 py-2.5">Balance</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="bg-slate-50/60"><td className="px-4 py-2 italic text-slate-500" colSpan={6}>Opening balance as on {period.from}</td><td className="px-4 py-2 text-right font-medium"><DrCr value={stmt.opening} /></td></tr>
                  {stmt.rows.map((r, i) => {
                    const k = kindOfSource(r.sourceType)
                    return (
                      <tr key={i} onClick={() => openRow(r)} className="cursor-pointer hover:bg-blue-50/40">
                        <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.date}</td>
                        <td className="px-4 py-2"><Badge color={VOUCHER_TYPES[k]?.color || 'bg-slate-100 text-slate-500'}>{VOUCHER_TYPES[k]?.label || (r.sourceType === 'opening' ? 'Opening' : r.sourceType)}</Badge></td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.docNo}</td>
                        <td className="px-4 py-2 text-slate-700">{r.particulars}</td>
                        <td className="px-4 py-2 text-right">{r.debit ? fmtAmt(r.debit) : ''}</td><td className="px-4 py-2 text-right">{r.credit ? fmtAmt(r.credit) : ''}</td>
                        <td className="px-4 py-2 text-right font-medium"><DrCr value={r.balance} /></td>
                      </tr>)
                  })}
                  {stmt.rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No transactions in this period.</td></tr>}
                </tbody>
                <tfoot><tr className="bg-slate-50 font-bold"><td colSpan={4} className="px-4 py-2.5 text-slate-600">Closing balance</td><td className="px-4 py-2.5 text-right">{fmtAmt(stmt.totalDebit)}</td><td className="px-4 py-2.5 text-right">{fmtAmt(stmt.totalCredit)}</td><td className="px-4 py-2.5 text-right">{fmtDrCr(stmt.closing)}</td></tr></tfoot>
              </table>
            </div>
          </>)}

          {tab === 'bills' && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr><th className="text-left px-4 py-2.5">{isCust ? 'Invoice' : 'Bill'}</th><th className="text-left px-4 py-2.5">Date</th><th className="text-left px-4 py-2.5">Due</th><th className="text-right px-4 py-2.5">Amount</th><th className="text-right px-4 py-2.5">Pending</th><th className="text-right px-4 py-2.5">Overdue</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {bills.bills.map(b => (
                    <tr key={b.billKey} className="cursor-pointer hover:bg-blue-50/40" onClick={() => openRow({ sourceType: b.sourceType, sourceId: b.sourceId })}>
                      <td className="px-4 py-2 font-mono text-xs">{b.docNo}{b.externalRef ? <span className="text-slate-400"> · {b.externalRef}</span> : ''}</td><td className="px-4 py-2 text-slate-500">{b.date}</td><td className="px-4 py-2 text-slate-500">{b.dueDate}</td>
                      <td className="px-4 py-2 text-right">{fmtAmt(b.original)}</td><td className="px-4 py-2 text-right font-medium">{fmtAmt(b.pending)}</td>
                      <td className={`px-4 py-2 text-right ${b.daysOverdue > 0 ? 'text-red-600' : 'text-slate-400'}`}>{b.daysOverdue > 0 ? `${b.daysOverdue} days` : '—'}</td>
                    </tr>))}
                  {bills.bills.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Nothing outstanding.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="flex justify-end p-4 border-t border-slate-100"><button onClick={onClose} className={btnGhost}>Close</button></div>
      </div>
      {modal}
    </div>
  )
}
