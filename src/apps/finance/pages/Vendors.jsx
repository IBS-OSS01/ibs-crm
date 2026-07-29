import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { INDIA_STATES, gstinToState } from '../utils/indiaConstants.js'
import { fetchGstinDetails } from '../utils/gstLookup.js'

const PAYMENT_TERMS = ['Due on Receipt', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90']

const empty = {
  vendorName: '', contactPerson: '', phone: '', email: '',
  address: '', city: '', state: '', pincode: '',
  gstin: '', pan: '',
  paymentTerms: 'Net 30',
  bankName: '', bankAccount: '', ifsc: '',
  notes: '', active: true,
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

export default function Vendors() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [gstFetching, setGstFetching] = useState(false)
  const [gstStatus, setGstStatus] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'finance_vendors'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.vendorName || '').localeCompare(b.vendorName || ''))
      setVendors(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const reset = () => { setForm(empty); setEditing(null); setError(''); setGstStatus('') }

  const handleEdit = (v) => {
    setEditing(v.id)
    setForm({ ...empty, ...v })
    setGstStatus('')
    setShowForm(true)
  }

  const f = (field) => (e) => {
    const val = e.target.value
    setForm(p => {
      const next = { ...p, [field]: val }
      if (field === 'gstin') {
        setGstStatus('')   // clear status when GSTIN changes
        if (val.length >= 2) {
          const st = gstinToState(val)
          if (st) next.state = st
        }
      }
      return next
    })
  }

  const handleGstFetch = async () => {
    const gstin = form.gstin.trim()
    if (gstin.length !== 15) return
    setGstFetching(true)
    setGstStatus('')
    try {
      const d = await fetchGstinDetails(gstin)
      setForm(p => ({
        ...p,
        vendorName: d.legalName || p.vendorName,
        pan:        d.pan        || p.pan,
        state:      d.state      || p.state,
        address:    d.address    || p.address,
        city:       d.city       || p.city,
        pincode:    d.pincode    || p.pincode,
      }))
      const badge = d.status === 'Active' ? '✅' : '⚠️'
      setGstStatus(`${badge} ${d.status} · ${d.legalName}${d.businessType ? ' · ' + d.businessType : ''}`)
    } catch (e) {
      setGstStatus('❌ ' + e.message)
    } finally {
      setGstFetching(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.vendorName.trim()) { setError('Vendor name is required'); return }
    setSaving(true)
    try {
      const payload = { ...form }
      if (editing) {
        await updateDoc(doc(db, 'finance_vendors', editing), { ...payload, updatedAt: new Date().toISOString() })
        setVendors(prev => prev.map(v => v.id === editing ? { ...v, ...payload } : v))
      } else {
        const ref = await addDoc(collection(db, 'finance_vendors'), {
          ...payload, createdBy: user.uid, createdAt: new Date().toISOString()
        })
        setVendors(prev => [...prev, { id: ref.id, ...payload }])
      }
      setShowForm(false); reset()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (v) => {
    if (!window.confirm(`Delete vendor "${v.vendorName}"?`)) return
    await deleteDoc(doc(db, 'finance_vendors', v.id))
    setVendors(prev => prev.filter(x => x.id !== v.id))
  }

  const filtered = vendors.filter(v => {
    const q = search.toLowerCase()
    return !q || (v.vendorName || '').toLowerCase().includes(q) ||
      (v.gstin || '').toLowerCase().includes(q) ||
      (v.city || '').toLowerCase().includes(q)
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Vendors</h2>
          <p className="text-slate-500 text-sm">{vendors.length} vendors</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); reset() }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          {showForm && !editing ? '✕ Cancel' : '+ Add Vendor'}
        </button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search by vendor name, GSTIN, city…"
        className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Vendor' : 'Add Vendor'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="space-y-4">

            <p className="text-xs font-bold uppercase tracking-wide text-blue-600 border-b pb-1">Basic Info</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={lbl}>Vendor / Supplier Name *</label>
                <input className={inp} value={form.vendorName} onChange={f('vendorName')} required placeholder="Company name" />
              </div>
              <div><label className={lbl}>Contact Person</label><input className={inp} value={form.contactPerson} onChange={f('contactPerson')} /></div>
              <div><label className={lbl}>Phone</label><input className={inp} value={form.phone} onChange={f('phone')} /></div>
              <div><label className={lbl}>Email</label><input className={inp} type="email" value={form.email} onChange={f('email')} /></div>
              <div>
                <label className={lbl}>Payment Terms</label>
                <select className={inp} value={form.paymentTerms} onChange={f('paymentTerms')}>
                  {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <p className="text-xs font-bold uppercase tracking-wide text-blue-600 border-b pb-1">GST / Tax Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={lbl}>
                  GSTIN
                  <span className="font-normal text-slate-400 ml-1">— type 15 chars then click Fetch to auto-fill</span>
                </label>
                <div className="flex gap-2">
                  <input className={inp} value={form.gstin} onChange={f('gstin')}
                    maxLength={15} placeholder="e.g. 27AAAAA0000A1Z5" />
                  <button type="button" onClick={handleGstFetch}
                    disabled={form.gstin.trim().length !== 15 || gstFetching}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-40 whitespace-nowrap">
                    {gstFetching ? '⏳ Fetching…' : '🔍 Fetch'}
                  </button>
                </div>
                {gstStatus && (
                  <p className={`text-xs mt-1.5 font-medium ${gstStatus.startsWith('✅') ? 'text-green-700' : gstStatus.startsWith('⚠️') ? 'text-amber-600' : 'text-red-600'}`}>
                    {gstStatus}
                  </p>
                )}
              </div>
              <div><label className={lbl}>PAN</label><input className={inp} value={form.pan} onChange={f('pan')} maxLength={10} placeholder="AAAAA0000A" /></div>
              <div>
                <label className={lbl}>State</label>
                <select className={inp} value={form.state} onChange={f('state')}>
                  <option value="">— select —</option>
                  {INDIA_STATES.map(s => <option key={s.code} value={s.name}>{s.name} ({s.code})</option>)}
                </select>
              </div>
            </div>

            <p className="text-xs font-bold uppercase tracking-wide text-blue-600 border-b pb-1">Address</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className={lbl}>Street Address</label><input className={inp} value={form.address} onChange={f('address')} /></div>
              <div><label className={lbl}>City</label><input className={inp} value={form.city} onChange={f('city')} /></div>
              <div><label className={lbl}>Pincode</label><input className={inp} value={form.pincode} onChange={f('pincode')} /></div>
            </div>

            <p className="text-xs font-bold uppercase tracking-wide text-blue-600 border-b pb-1">Bank Details</p>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={lbl}>Bank Name</label><input className={inp} value={form.bankName} onChange={f('bankName')} /></div>
              <div><label className={lbl}>Account Number</label><input className={inp} value={form.bankAccount} onChange={f('bankAccount')} /></div>
              <div><label className={lbl}>IFSC Code</label><input className={inp} value={form.ifsc} onChange={f('ifsc')} /></div>
            </div>

            <div>
              <label className={lbl}>Notes</label>
              <textarea className={`${inp} h-16 resize-none`} value={form.notes} onChange={f('notes')} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="v-active" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} />
              <label htmlFor="v-active" className="text-sm text-slate-700">Active vendor</label>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {saving ? 'Saving…' : editing ? 'Update Vendor' : 'Add Vendor'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); reset() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Vendor Name</th>
              <th className="text-left px-4 py-3">GSTIN</th>
              <th className="text-left px-4 py-3">State</th>
              <th className="text-left px-4 py-3">Phone</th>
              <th className="text-left px-4 py-3">Payment Terms</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(v => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{v.vendorName}</div>
                  {v.contactPerson && <div className="text-xs text-slate-500">{v.contactPerson}</div>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{v.gstin || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{v.state || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{v.phone || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{v.paymentTerms || '—'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${v.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {v.active !== false ? '● Active' : '● Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  <button onClick={() => handleEdit(v)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                  {isAdmin && <button onClick={() => handleDelete(v)} className="text-red-600 hover:text-red-700 font-medium">🗑️</button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400">No vendors yet. Add your first vendor.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
