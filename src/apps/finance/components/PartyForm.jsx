// Add / edit a customer or vendor with the full set of details — name, contact, payment terms, GSTIN (with “Fetch” from the
// GST portal), PAN, state, full address, bank details, notes. Writes to the same master collections the CRM and the Vendors
// page use (crm_customers / finance_vendors), so every screen sees the same record.
import React, { useState } from 'react'
import { addDoc, collection, doc, updateDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { INDIA_STATES } from '../utils/indiaConstants.js'
import { fetchGstinDetails } from '../utils/gstLookup.js'
import { isValidGstin, isValidPan } from '../utils/financeConstants.js'
import { invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { btnPrimary, btnGhost, cardCls } from './FinanceUI.jsx'

const TERMS = { 'Due on Receipt': 0, 'Net 15': 15, 'Net 30': 30, 'Net 45': 45, 'Net 60': 60, 'Net 90': 90 }
const K = {
  customer: { coll: 'crm_customers', name: 'shopName', contact: 'ownerName', title: 'Customer', nameLabel: 'Customer name *' },
  vendor: { coll: 'finance_vendors', name: 'vendorName', contact: 'contactPerson', title: 'Vendor', nameLabel: 'Vendor / supplier name *' },
}
const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
const lbl = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1'
const head = 'text-xs font-bold uppercase tracking-wide text-blue-600 border-b pb-1'

export default function PartyForm({ kind, party, existing = [], onClose, onSaved }) {
  const k = K[kind], isCust = kind === 'customer'
  const { user } = useAuth()
  const p = party || {}
  const termOf = (x) => x.paymentTerms || (isCust && Number.isFinite(Number(x.creditDays)) ? Object.keys(TERMS).find(t => TERMS[t] === Number(x.creditDays)) : '') || ''
  const [form, setForm] = useState({
    name: p[k.name] || '', contact: p[k.contact] || '', phone: p.phone || '', email: p.email || '', terms: termOf(p), gstin: p.gstin || '', pan: p.pan || '',
    state: p.state || '', address: p.address || '', area: p.area || '', city: p.city || '', pincode: p.pincode || '', country: p.country || 'India',
    bankName: p.bankName || '', bankAccount: p.bankAccount || '', ifsc: p.ifsc || '', notes: p.notes || '', active: p.active !== false,
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [gst, setGst] = useState({ busy: false, msg: '' })
  const f = (key) => (e) => setForm(x => ({ ...x, [key]: e.target.value }))

  const fetchGst = async () => {
    setGst({ busy: true, msg: '' })
    try {
      const d = await fetchGstinDetails(form.gstin.trim())
      setForm(x => ({ ...x, name: d.legalName || x.name, pan: d.pan || x.pan, state: d.state || x.state, address: d.address || x.address, city: d.city || x.city, pincode: d.pincode || x.pincode }))
      setGst({ busy: false, msg: `${d.status === 'Active' ? '✅' : '⚠️'} ${d.status} · ${d.legalName}${d.businessType ? ' · ' + d.businessType : ''}` })
    } catch (e) { setGst({ busy: false, msg: '❌ ' + e.message }) }
  }

  const save = async (e) => {
    e.preventDefault(); setError('')
    const name = form.name.trim(), gstin = form.gstin.trim().toUpperCase(), pan = form.pan.trim().toUpperCase()
    if (!name) return setError(`${k.title} name is required.`)
    if (gstin && !isValidGstin(gstin)) return setError('GSTIN is not valid (format or check digit).')
    if (pan && !isValidPan(pan)) return setError('PAN is not valid (expected like ABCDE1234F).')
    if (form.pincode && !/^\d{6}$/.test(form.pincode.trim())) return setError('Pincode should be 6 digits.')
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('Email does not look right.')
    const dupName = existing.find(x => x.id !== p.id && String(x[k.name] || '').trim().toLowerCase() === name.toLowerCase())
    if (dupName) return setError(`“${dupName[k.name]}” already exists.`)
    if (gstin && isCust) { const dup = existing.find(x => x.id !== p.id && String(x.gstin || '').toUpperCase() === gstin); if (dup) return setError(`GSTIN already used by “${dup[k.name]}”.`) }
    const st = INDIA_STATES.find(s => s.name === form.state)
    const patch = {
      [k.name]: name, [k.contact]: form.contact.trim(), phone: form.phone.trim(), email: form.email.trim(), paymentTerms: form.terms, gstin, pan, state: form.state, ...(st ? { stateCode: st.code } : {}),
      address: form.address.trim(), area: form.area.trim(), city: form.city.trim(), pincode: form.pincode.trim(), country: form.country.trim() || 'India',
      bankName: form.bankName.trim(), bankAccount: form.bankAccount.trim(), ifsc: form.ifsc.trim().toUpperCase(), notes: form.notes.trim(), active: form.active,
      ...(isCust && form.terms ? { creditDays: TERMS[form.terms] } : {}),
    }
    setSaving(true)
    try {
      if (p.id) { await updateDoc(doc(db, k.coll, p.id), { ...patch, updatedAt: new Date().toISOString() }); Object.assign(p, patch); onSaved?.(p) }
      else {
        const body = { ...patch, ...(isCust ? { companies: ['UIPL'], company: 'UIPL', creditLimit: 0 } : {}), createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, k.coll), body); onSaved?.({ id: ref.id, ...body })
      }
      invalidateFinanceCache(); onClose()
    } catch (ex) { setError(ex.code === 'permission-denied' ? 'You do not have permission to save this record.' : 'Could not save: ' + ex.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={saving ? undefined : onClose}>
      <form onSubmit={save} className={`${cardCls} w-full max-w-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between"><h3 className="text-lg font-bold text-slate-800">{p.id ? `Edit ${k.title.toLowerCase()}` : `Add ${k.title.toLowerCase()}`}</h3><button type="button" onClick={onClose} className="text-slate-400 text-xl leading-none">✕</button></div>
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

        <p className={head}>Basic info</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className={lbl}>{k.nameLabel}</label><input className={inp} value={form.name} onChange={f('name')} required placeholder="Company name" /></div>
          <div><label className={lbl}>Contact person</label><input className={inp} value={form.contact} onChange={f('contact')} /></div>
          <div><label className={lbl}>Phone</label><input className={inp} value={form.phone} onChange={f('phone')} /></div>
          <div><label className={lbl}>Email</label><input className={inp} type="email" value={form.email} onChange={f('email')} /></div>
          <div><label className={lbl}>{isCust ? 'Credit terms' : 'Payment terms'}</label><select className={inp} value={form.terms} onChange={f('terms')}><option value="">— select —</option>{Object.keys(TERMS).map(t => <option key={t}>{t}</option>)}</select></div>
        </div>

        <p className={head}>GST / tax details</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={lbl}>GSTIN <span className="font-normal normal-case text-slate-400 ml-1">— type 15 characters, then Fetch to fill the rest</span></label>
            <div className="flex gap-2">
              <input className={inp} value={form.gstin} onChange={f('gstin')} maxLength={15} placeholder="27AAAAA0000A1Z5" />
              <button type="button" onClick={fetchGst} disabled={form.gstin.trim().length !== 15 || gst.busy} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg disabled:opacity-40 whitespace-nowrap">{gst.busy ? '⏳ Fetching…' : '🔍 Fetch'}</button>
            </div>
            {gst.msg && <p className={`text-xs mt-1.5 font-medium ${gst.msg.startsWith('✅') ? 'text-green-700' : gst.msg.startsWith('⚠️') ? 'text-amber-600' : 'text-red-600'}`}>{gst.msg}</p>}
          </div>
          <div><label className={lbl}>PAN</label><input className={inp} value={form.pan} onChange={f('pan')} maxLength={10} placeholder="AAAAA0000A" /></div>
          <div><label className={lbl}>State</label><select className={inp} value={form.state} onChange={f('state')}><option value="">— select —</option>{INDIA_STATES.map(s => <option key={s.code} value={s.name}>{s.name} ({s.code})</option>)}</select></div>
        </div>

        <p className={head}>Address</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className={lbl}>Street address</label><input className={inp} value={form.address} onChange={f('address')} /></div>
          <div><label className={lbl}>Area / locality</label><input className={inp} value={form.area} onChange={f('area')} /></div>
          <div><label className={lbl}>City</label><input className={inp} value={form.city} onChange={f('city')} /></div>
          <div><label className={lbl}>Pincode</label><input className={inp} value={form.pincode} onChange={f('pincode')} maxLength={6} /></div>
          <div><label className={lbl}>Country</label><input className={inp} value={form.country} onChange={f('country')} /></div>
        </div>

        <p className={head}>Bank details</p>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={lbl}>Bank name</label><input className={inp} value={form.bankName} onChange={f('bankName')} /></div>
          <div><label className={lbl}>Account number</label><input className={inp} value={form.bankAccount} onChange={f('bankAccount')} /></div>
          <div><label className={lbl}>IFSC code</label><input className={inp} value={form.ifsc} onChange={f('ifsc')} /></div>
        </div>

        <div><label className={lbl}>Notes</label><textarea className={`${inp} h-16 resize-none`} value={form.notes} onChange={f('notes')} /></div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.active} onChange={e => setForm(x => ({ ...x, active: e.target.checked }))} />Active {k.title.toLowerCase()}</label>
        <div className="flex gap-3"><button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : p.id ? `Update ${k.title.toLowerCase()}` : `Add ${k.title.toLowerCase()}`}</button><button type="button" onClick={onClose} disabled={saving} className={btnGhost}>Cancel</button></div>
      </form>
    </div>
  )
}
