// Pieces shared by every voucher form.
import React, { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { createVoucher, updateVoucher, getBooksLockDate, VoucherError } from '../utils/voucherService.js'
import { uploadAttachments } from '../utils/attachments.js'
import { CURRENCIES, rateOn, fetchMarketRate, symbolOf, fmtFc } from '../utils/fx.js'
import { useAllowedCompanies } from './FinanceUI.jsx'
import { COMPANIES, todayStr, fmtAmt, num, normName } from '../utils/financeConstants.js'
import { INDIA_STATES, gstinToStateCode } from '../utils/indiaConstants.js'
import { DEFAULT_TDS_SECTIONS, tdsRateFor, thresholdCrossed, ldcFor } from '../utils/tdsMaster.js'
import { isValidPan } from '../utils/financeConstants.js'
import { formInputCls, labelCls, cardCls, btnPrimary, btnGhost } from './FinanceUI.jsx'

export const stateCodeFromName = (name) => INDIA_STATES.find(s => s.name === name)?.code || ''
export const companyStateCode = (raw, company) => raw?.companySettings?.[company]?.stateCode || ''

export function cashBankOptions(raw, company) {
  const accs = (raw?.bankAccounts || []).filter(b => b.company === company && b.active !== false)
  const banks = accs.filter(b => b.type !== 'cash')
  const opts = []
  if (banks.length === 0) opts.push({ key: 'bank-default', label: 'Bank account (default)', code: '1100', id: '' })
  banks.forEach(b => opts.push({ key: `bank:${b.id}`, label: `${b.name}${b.accountNumber ? ` ••${String(b.accountNumber).slice(-4)}` : ''}`, code: '1100', id: b.id }))
  const cashAccs = accs.filter(b => b.type === 'cash')
  if (cashAccs.length === 0) opts.push({ key: 'cash', label: 'Cash in hand', code: '1110', id: '' })
  cashAccs.forEach(b => opts.push({ key: `cash:${b.id}`, label: b.name, code: '1110', id: b.id }))
  return opts
}

// Customers (crm_customers) + vendors (finance_vendors) for pickers; the matching
// name is what legacy records (free-text) join on.
export const customerOptions = (raw, company) =>
  (raw?.customers || []).filter(c => c.active !== false && (!company || (c.companies || [c.company]).includes(company) || !(c.companies || c.company)))
    .map(c => ({ id: c.id, name: c.shopName, gstin: c.gstin || '', pan: c.pan || '', state: c.state || '', creditDays: c.creditDays || 0, raw: c }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
export const vendorOptions = (raw) =>
  (raw?.vendors || []).filter(v => v.active !== false)
    .map(v => ({ id: v.id, name: v.vendorName, gstin: v.gstin || '', pan: v.pan || '', state: v.state || '', paymentTerms: v.paymentTerms, raw: v }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
export const creditDaysFromTerms = (terms) => {
  const m = /Net\s+(\d+)/i.exec(terms || '')
  return m ? Number(m[1]) : 0
}

export const tdsSectionList = (raw) => (raw?.tdsSections?.length ? raw.tdsSections : DEFAULT_TDS_SECTIONS)

// ── save wrapper ────────────────────────────────────────────────────────────
export function useVoucherSave({ initial, onSaved, getPayload, draft }) {
  const { user, userProfile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async (e) => {
    e?.preventDefault()
    setError('')
    let payload
    try { payload = getPayload() } catch (err) { setError(err.message); return }
    setSaving(true)
    try {
      const lockedUpTo = await getBooksLockDate(payload.company)
      let id = initial?.id
      if (id) await updateVoucher(id, initial, payload, { user, profile: userProfile, lockedUpTo })
      else id = (await createVoucher(payload, { user, profile: userProfile, lockedUpTo })).id
      if (draft?.pending?.length) {
        try { await uploadAttachments(draft.pending, { entityType: payload.voucherType, entityId: id, company: payload.company, user, profile: userProfile }) }
        catch (e) { setError('Voucher saved, but the attachments could not be saved: ' + e.message); return }
      }
      onSaved?.()
    } catch (err) { setError(err instanceof VoucherError ? err.message : 'Could not save: ' + err.message) }
    finally { setSaving(false) }
  }
  return { save, saving, error, setError }
}

export class FormError extends Error {}
export const need = (cond, msg) => { if (!cond) throw new FormError(msg) }

// ── layout bits ─────────────────────────────────────────────────────────────
export const Field = ({ label, children, className = '' }) => (
  <div className={className}><label className={labelCls}>{label}</label>{children}</div>
)

export function FormShell({ title, subtitle, children, onSubmit, onCancel, saving, error, saveLabel = 'Save', right }) {
  return (
    <form onSubmit={onSubmit} className={`${cardCls} p-5 space-y-5`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h3 className="text-lg font-bold text-slate-800">{title}</h3>{subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}</div>
        {right}
      </div>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {children}
      <div className="flex gap-2 pt-1 border-t border-slate-100">
        <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : saveLabel}</button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel (Esc)</button>
      </div>
    </form>
  )
}

// ── currency of a document ──────────────────────────────────────────────────
// useFx keeps { currency, rate }. The rate follows the date and currency (latest rate on file on or before the
// booking date) until you type your own; `fetchRate` pulls the market rate for that date.
export function useFx(raw, date, initial) {
  const [currency, setCurrencyState] = useState(initial?.currency || 'INR')
  const [rate, setRateState] = useState(initial?.fxRate ? String(initial.fxRate) : '')
  const [touched, setTouched] = useState(!!initial?.fxRate)
  const rates = raw?.fxRates || []
  const filed = currency === 'INR' ? 1 : rateOn(rates, currency, date)
  const effective = currency === 'INR' ? 1 : (touched ? num(rate) : filed)
  const setCurrency = (c) => { setCurrencyState(c); setTouched(false); setRateState('') }
  const setRate = (v) => { setRateState(v); setTouched(true) }
  const fetchRate = async () => { const r = await fetchMarketRate(currency, date); setRateState(String(r.rate)); setTouched(true); return r }
  return { currency, rate: effective, rateText: touched ? rate : (filed ? String(filed) : ''), isFc: currency !== 'INR', filed, setCurrency, setRate, fetchRate, symbol: symbolOf(currency) }
}

export function CurrencyBar({ fx, date, totalFc, label = 'Currency' }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const get = async () => { setBusy(true); setMsg(''); try { const r = await fx.fetchRate(); setMsg(`ECB reference rate for ${r.date}: ${r.rate}`) } catch (e) { setMsg(e.message) } finally { setBusy(false) } }
  return (
    <div className={`rounded-xl border p-3 ${fx.isFc ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200 bg-slate-50/50'}`}>
      <div className="flex items-end gap-3 flex-wrap">
        <Field label={label}>
          <select value={fx.currency} onChange={e => fx.setCurrency(e.target.value)} className={`${formInputCls} w-44`}>
            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </select>
        </Field>
        {fx.isFc && (
          <>
            <Field label={`Rate on ${date || 'booking date'} (₹ per 1 ${fx.currency})`}>
              <input type="number" min="0" step="any" value={fx.rateText} onChange={e => fx.setRate(e.target.value)} className={`${formInputCls} w-40`} />
            </Field>
            <button type="button" onClick={get} disabled={busy} className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">{busy ? 'Fetching…' : 'Get market rate'}</button>
            {num(totalFc) > 0 && fx.rate > 0 && <p className="text-sm text-slate-600 pb-2">{fmtFc(totalFc, fx.currency)} × {fx.rate} = <b>₹{fmtAmt(totalFc * fx.rate)}</b></p>}
          </>
        )}
      </div>
      {fx.isFc && !fx.rate && <p className="text-xs text-red-600 mt-2">No rate on file for {fx.currency} — enter one, or click “Get market rate”. (Add standing rates under Settings → Exchange rates.)</p>}
      {fx.isFc && <p className="text-xs text-amber-800 mt-2">Amounts below are in {fx.currency}. The books record the rupee value at the rate above; later settlement at a different rate books an exchange gain or loss.</p>}
      {msg && <p className="text-xs text-slate-500 mt-1">{msg}</p>}
    </div>
  )
}

export function CostCentreSelect({ raw, value, onChange }) {
  const list = (raw?.costCentres || []).filter(c => c.active !== false)
  if (!list.length) return null
  return <Field label="Cost centre"><select value={value || ''} onChange={e => onChange(e.target.value)} className={formInputCls}><option value="">None</option>{list.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
}

export function HeaderFields({ company, setCompany, date, setDate, locked, extra }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Field label="Company">
        <select value={company} onChange={e => setCompany(e.target.value)} disabled={locked} className={formInputCls}>{useAllowedCompanies().map(c => <option key={c}>{c}</option>)}</select>
      </Field>
      <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={formInputCls} required /></Field>
      {extra}
    </div>
  )
}

// TDS block used on Purchase and Payment vouchers.
export function TdsBlock({ raw, vendor, base, tds, setTds, fy, date, partyId, currentDocId }) {
  const sections = tdsSectionList(raw)
  const section = sections.find(s => s.code === tds.section)
  const pan = vendor?.pan || ''
  const hasValidPan = isValidPan(pan)
  const ytd = section ? (raw.vouchers || [])
    .filter(v => v.status !== 'cancelled' && v.id !== currentDocId && v.fy === fy && v.partyId === partyId && v.tds?.applicable && v.tds.section === section.code)
    .reduce((s, v) => s + num(v.tds.base), 0) : 0
  const crossed = section ? thresholdCrossed(section, { current: base, paidYTD: ytd }) : false
  const ldc = section ? ldcFor(vendor?.raw, section.code, date) : null
  const apply = (code) => {
    const sec = sections.find(s => s.code === code)
    const { rate } = tdsRateFor(sec, { pan, hasValidPan })
    const l = ldcFor(vendor?.raw, code, date)
    setTds({ ...tds, section: code, rate: l ? l.rate : rate })
  }
  const amount = tds.applicable ? Math.round(num(base) * num(tds.rate) / 100) : 0
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/50">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={!!tds.applicable} onChange={e => setTds({ ...tds, applicable: e.target.checked })} /> Deduct TDS
      </label>
      {tds.applicable && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Section">
              <select value={tds.section || ''} onChange={e => apply(e.target.value)} className={formInputCls}>
                <option value="">— select —</option>
                {sections.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            </Field>
            <Field label="Rate %"><input type="number" step="any" value={tds.rate ?? ''} onChange={e => setTds({ ...tds, rate: e.target.value })} className={formInputCls} /></Field>
            <Field label="TDS base (₹)"><input type="number" step="any" value={tds.baseOverride ?? base} onChange={e => setTds({ ...tds, baseOverride: e.target.value })} className={formInputCls} /></Field>
            <Field label="TDS amount"><div className={`${formInputCls} bg-slate-100 font-semibold`}>{fmtAmt(Math.round(num(tds.baseOverride ?? base) * num(tds.rate) / 100))}</div></Field>
          </div>
          {section && (
            <p className={`text-xs ${crossed ? 'text-green-700' : 'text-amber-700'}`}>
              {crossed ? '✓' : 'ℹ'} Paid so far this FY under {section.code}: ₹{fmtAmt(ytd)} · threshold {section.singleLimit ? `₹${fmtAmt(section.singleLimit)} per payment` : ''}{section.singleLimit && section.annualLimit ? ' or ' : ''}{section.annualLimit ? `₹${fmtAmt(section.annualLimit)} per year` : ''} — {crossed ? 'threshold crossed, deduction applies' : 'below threshold, TDS may not be required yet'}.
            </p>
          )}
          {ldc && <p className="text-xs text-green-700">✓ Lower-deduction certificate {ldc.number} on file for this vendor{ldc.limit ? ` (covers up to ₹${fmtAmt(ldc.limit)})` : ''} — rate set to {ldc.rate}%. Re-pick the section to re-apply it after editing the rate.</p>}
          {!hasValidPan && <p className="text-xs text-red-600">This vendor has no valid PAN on file — section 206AA requires deduction at the higher rate (minimum 20%, 5% for 194Q/194O).</p>}
        </>
      )}
    </div>
  )
}
export const finalTds = (tds, base) => {
  if (!tds.applicable || !tds.section) return { applicable: false, section: '', rate: 0, base: 0, amount: 0 }
  const b = num(tds.baseOverride ?? base)
  return { applicable: true, section: tds.section, rate: num(tds.rate), base: b, amount: Math.round(b * num(tds.rate) / 100) }
}

export { todayStr, normName, num, fmtAmt, gstinToStateCode }
