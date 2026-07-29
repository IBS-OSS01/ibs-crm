import React, { useState, useEffect } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { INDIA_STATES } from '../utils/indiaConstants.js'

const COMPANIES = ['UIPL', 'Wayzim']
const COMPANY_LABELS = { UIPL: 'UIPL', Wayzim: 'Wayzim Technology Co Ltd' }

const UIPL_DEFAULTS = {
  legalName: 'UDISHTHA INNOVATIONS PRIVATE LIMITED',
  companyId: 'U33200PN2025PTC240334',
  gstin: '27AADCU8036C1ZF',
  pan: 'AADCU8036C',
  state: 'Maharashtra',
  stateCode: '27',
  address: 'D 102, Pittie Kourtyard, Near Sundra Bai Shalla',
  city: 'Pune',
  pincode: '411014',
  phone: '9022314285',
  email: 'operations@udishtha.com',
  website: 'www.udishtha.com',
  bankName: '',
  bankAccount: '',
  ifsc: '',
  bankBranch: '',
  termsAndConditions:
    '1. Subject to Pune Jurisdiction only.\n2. Payments should be made within due period from the date of issue of this invoice as per the MSMED Act, 2006 as we are registered as a "Small Entity".',
}

const EMPTY = {
  legalName: '', companyId: '', gstin: '', pan: '', state: '', stateCode: '',
  address: '', city: '', pincode: '', phone: '', email: '', website: '',
  bankName: '', bankAccount: '', ifsc: '', bankBranch: '', termsAndConditions: '',
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-500 mb-0.5'

// ── Read-only company card ────────────────────────────────────────────────────
function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium text-slate-800 mt-0.5">{value}</p>
    </div>
  )
}

export default function CompanySettings() {
  const { userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const [activeCompany, setActiveCompany] = useState('UIPL')
  const [data, setData] = useState(null)      // saved/display data
  const [form, setForm] = useState(EMPTY)     // edit form
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadOrSeed(activeCompany) }, [activeCompany])

  // Load from Firestore. If UIPL doc missing, auto-seed the defaults immediately.
  const loadOrSeed = async (co) => {
    setLoading(true)
    setEditing(false)
    try {
      const ref = doc(db, 'company_settings', co)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        setData(snap.data())
        setForm({ ...EMPTY, ...snap.data() })
      } else if (co === 'UIPL') {
        // Auto-seed UIPL defaults so they're always ready for invoices
        const payload = { ...UIPL_DEFAULTS, seededAt: new Date().toISOString() }
        try { await setDoc(ref, payload) } catch (_) { /* non-admin can't write — that's OK */ }
        setData(payload)
        setForm({ ...EMPTY, ...payload })
      } else {
        setData(null)
        setForm(EMPTY)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const f = (field) => (e) => {
    const val = e.target.value
    setForm(p => {
      const next = { ...p, [field]: val }
      if (field === 'state') {
        const s = INDIA_STATES.find(x => x.name === val)
        if (s) next.stateCode = s.code
      }
      if (field === 'gstin' && val.length >= 2) {
        const code = val.slice(0, 2)
        const s = INDIA_STATES.find(x => x.code === code)
        if (s) { next.state = s.name; next.stateCode = s.code }
      }
      return next
    })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await setDoc(doc(db, 'company_settings', activeCompany), {
        ...form, updatedAt: new Date().toISOString(),
      }, { merge: true })
      setData({ ...form })
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) { alert('Error saving: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleEdit = () => { setForm({ ...EMPTY, ...(data || {}) }); setEditing(true) }
  const handleCancel = () => { setEditing(false); setForm({ ...EMPTY, ...(data || {}) }) }

  // ── READ VIEW ───────────────────────────────────────────────────────────────
  const ReadView = ({ d }) => {
    if (!d || !d.legalName) return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-4xl mb-3">🏢</p>
        <p className="font-medium">No details configured yet for {activeCompany}</p>
        {isAdmin && <p className="text-sm mt-1">Click ✏️ Edit to add company information</p>}
      </div>
    )
    return (
      <div className="space-y-6">
        {/* Hero header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-6 text-white">
          <p className="text-2xl font-bold">{d.legalName}</p>
          {d.companyId && <p className="text-blue-200 text-sm mt-1">CIN: {d.companyId}</p>}
          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            {d.gstin && (
              <div className="bg-white/20 rounded-xl px-3 py-2">
                <p className="text-blue-100 text-xs">GSTIN</p>
                <p className="font-mono font-bold">{d.gstin}</p>
              </div>
            )}
            {d.pan && (
              <div className="bg-white/20 rounded-xl px-3 py-2">
                <p className="text-blue-100 text-xs">PAN</p>
                <p className="font-mono font-bold">{d.pan}</p>
              </div>
            )}
            {d.state && (
              <div className="bg-white/20 rounded-xl px-3 py-2">
                <p className="text-blue-100 text-xs">State</p>
                <p className="font-bold">{d.state} {d.stateCode ? `(${d.stateCode})` : ''}</p>
              </div>
            )}
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5 space-y-4">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Address &amp; Contact</p>
            <InfoRow label="Street Address" value={d.address} />
            <InfoRow label="City / Pincode" value={[d.city, d.pincode].filter(Boolean).join(' – ')} />
            <InfoRow label="Phone" value={d.phone} />
            <InfoRow label="Email" value={d.email} />
            <InfoRow label="Website" value={d.website} />
          </div>

          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5 space-y-4">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Bank Details</p>
            {d.bankName || d.bankAccount ? (
              <>
                <InfoRow label="Bank Name" value={d.bankName} />
                <InfoRow label="Branch" value={d.bankBranch} />
                <InfoRow label="Account Number" value={d.bankAccount} />
                <InfoRow label="IFSC Code" value={d.ifsc} />
              </>
            ) : (
              <p className="text-sm text-slate-400 italic">No bank details added yet</p>
            )}
          </div>

          {d.termsAndConditions && (
            <div className="col-span-2 bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3">Default Terms &amp; Conditions</p>
              <pre className="text-sm text-slate-700 font-sans whitespace-pre-wrap leading-relaxed">{d.termsAndConditions}</pre>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── EDIT FORM ───────────────────────────────────────────────────────────────
  const EditForm = () => (
    <form onSubmit={handleSave} className="space-y-5">
      <p className="text-xs font-bold uppercase tracking-wide text-blue-600 border-b pb-2">Legal Identity</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className={lbl}>Legal / Registered Name</label>
          <input className={inp} value={form.legalName} onChange={f('legalName')} placeholder="Full legal name as per GST" />
        </div>
        <div><label className={lbl}>CIN / Company ID</label><input className={inp} value={form.companyId} onChange={f('companyId')} /></div>
        <div><label className={lbl}>GSTIN</label><input className={inp} value={form.gstin} onChange={f('gstin')} maxLength={15} placeholder="27AADCU8036C1ZF" /></div>
        <div><label className={lbl}>PAN</label><input className={inp} value={form.pan} onChange={f('pan')} maxLength={10} /></div>
        <div>
          <label className={lbl}>State (auto-fills from GSTIN)</label>
          <select className={inp} value={form.state} onChange={f('state')}>
            <option value="">— select —</option>
            {INDIA_STATES.map(s => <option key={s.code} value={s.name}>{s.name} ({s.code})</option>)}
          </select>
        </div>
      </div>

      <p className="text-xs font-bold uppercase tracking-wide text-blue-600 border-b pb-2">Address &amp; Contact</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><label className={lbl}>Street Address</label><input className={inp} value={form.address} onChange={f('address')} /></div>
        <div><label className={lbl}>City</label><input className={inp} value={form.city} onChange={f('city')} /></div>
        <div><label className={lbl}>Pincode</label><input className={inp} value={form.pincode} onChange={f('pincode')} /></div>
        <div><label className={lbl}>Phone</label><input className={inp} value={form.phone} onChange={f('phone')} /></div>
        <div><label className={lbl}>Email</label><input className={inp} value={form.email} onChange={f('email')} /></div>
        <div className="col-span-2"><label className={lbl}>Website</label><input className={inp} value={form.website} onChange={f('website')} /></div>
      </div>

      <p className="text-xs font-bold uppercase tracking-wide text-blue-600 border-b pb-2">Bank Details</p>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={lbl}>Bank Name</label><input className={inp} value={form.bankName} onChange={f('bankName')} /></div>
        <div><label className={lbl}>Branch</label><input className={inp} value={form.bankBranch} onChange={f('bankBranch')} /></div>
        <div><label className={lbl}>Account Number</label><input className={inp} value={form.bankAccount} onChange={f('bankAccount')} /></div>
        <div><label className={lbl}>IFSC Code</label><input className={inp} value={form.ifsc} onChange={f('ifsc')} /></div>
      </div>

      <p className="text-xs font-bold uppercase tracking-wide text-blue-600 border-b pb-2">Default Terms &amp; Conditions</p>
      <textarea className={`${inp} h-24 resize-y`} value={form.termsAndConditions} onChange={f('termsAndConditions')}
        placeholder="These T&C will appear on all invoices…" />

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        <button type="button" onClick={handleCancel}
          className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
          Cancel
        </button>
        {saved && <span className="text-green-600 text-sm font-medium">✓ Saved</span>}
      </div>
    </form>
  )

  // ── MAIN RENDER ─────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Company Settings</h2>
          <p className="text-slate-500 text-sm">Seller details auto-filled on invoices</p>
        </div>
        {isAdmin && !editing && (
          <button onClick={handleEdit}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
            ✏️ Edit
          </button>
        )}
        {saved && !editing && <span className="text-green-600 text-sm font-medium">✓ Saved</span>}
      </div>

      {/* Company tabs */}
      <div className="flex gap-2">
        {COMPANIES.map(co => (
          <button key={co} onClick={() => setActiveCompany(co)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold border transition ${
              activeCompany === co
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
            }`}>
            {COMPANY_LABELS[co] || co}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center h-40 text-slate-400">Loading…</div>
      ) : editing ? (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6">
          <EditForm />
        </div>
      ) : (
        <ReadView d={data} />
      )}
    </div>
  )
}
