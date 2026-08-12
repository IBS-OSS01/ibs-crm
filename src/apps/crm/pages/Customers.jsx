import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { fetchGstinDetails } from '../../finance/utils/gstLookup.js'
import CustomerContactsModal from '../components/CustomerContactsModal.jsx'
import CustomerHistoryModal from '../components/CustomerHistoryModal.jsx'

const COMPANIES = ['UIPL', 'Wayzim']
const COMPANY_LABELS = { UIPL: 'UIPL', Wayzim: 'Wayzim Technology Co Ltd' }
const COMPANY_COLORS = { UIPL: 'bg-blue-100 text-blue-700', Wayzim: 'bg-purple-100 text-purple-700' }
const INDIA_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana',
  'Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur',
  'Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman & Nicobar','Chandigarh',
  'Dadra & Nagar Haveli','Delhi','Jammu & Kashmir','Ladakh','Lakshadweep','Puducherry',
]
const emptyForm = {
  shopName: '', ownerName: '', phone: '', area: '', address: '', city: '', state: '', pincode: '',
  gstin: '', pan: '', creditLimit: '', active: true, companies: ['UIPL'],
}

export default function Customers() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const userCompanies = userProfile?.companies || ['UIPL']
  const canSelectCompany = isAdmin || userCompanies.length > 1
  const defaultCompany = userCompanies[0] || 'UIPL'
  const [customers, setCustomers] = useState([])
  const [deals, setDeals]         = useState([])    // used by CustomerHistoryModal
  const [contacts, setContacts]   = useState([])    // crm_contacts, all customers (filtered per-row below)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [gstFetching, setGstFetching] = useState(false)
  const [gstStatus, setGstStatus] = useState('')
  const [contactsCustomer, setContactsCustomer] = useState(null)  // customer whose contacts modal is open
  const [historyCustomer, setHistoryCustomer]   = useState(null)  // customer whose history modal is open
  const formRef = useRef(null)

  useEffect(() => { load() }, [])

  // Scroll the edit form into view whenever it opens (form renders at top, user may be scrolled down)
  useEffect(() => {
    if (showForm) {
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    }
  }, [showForm, editing])

  const load = async () => {
    try {
      const [custSnap, dealSnap, contactSnap] = await Promise.all([
        getDocs(collection(db, 'crm_customers')),
        getDocs(collection(db, 'crm_deals')),
        getDocs(collection(db, 'crm_contacts')),
      ])
      const data = []
      custSnap.forEach(d => data.push({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.shopName || '').localeCompare(b.shopName || ''))
      setCustomers(data)
      const dealData = []
      dealSnap.forEach(d => dealData.push({ id: d.id, ...d.data() }))
      setDeals(dealData)
      const contactData = []
      contactSnap.forEach(d => contactData.push({ id: d.id, ...d.data() }))
      setContacts(contactData)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  // On-demand pull of the latest data — customers/contacts added or edited by
  // other users. No live listeners in use, so this is the way to catch up.
  const handleRefresh = async () => {
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  // Contacts are shared CRM data (any signed-in user can already read/write
  // crm_contacts directly), so the "only for customers you have a deal on"
  // restriction here just hid the button from salespeople without actually
  // protecting anything — including for a customer they were about to create
  // their very first deal for. Show it to everyone, same as admin.
  const canSeeContacts = () => true

  const resetForm = () => { setForm({ ...emptyForm, companies: [defaultCompany] }); setEditing(null); setError(''); setGstStatus('') }

  const handleGstFetch = async () => {
    const gstin = form.gstin.trim()
    if (gstin.length !== 15) return
    setGstFetching(true)
    setGstStatus('')
    try {
      const d = await fetchGstinDetails(gstin)
      setForm(p => ({
        ...p,
        shopName: d.legalName || p.shopName,
        pan:      d.pan        || p.pan,
        state:    d.state      || p.state,
        address:  d.address    || p.address,
        city:     d.city       || p.city,
        pincode:  d.pincode    || p.pincode,
      }))
      const badge = d.status === 'Active' ? '✅' : '⚠️'
      setGstStatus(`${badge} ${d.status} · ${d.legalName}${d.businessType ? ' · ' + d.businessType : ''}`)
    } catch (e) {
      setGstStatus('❌ ' + e.message)
    } finally {
      setGstFetching(false)
    }
  }

  const handleEdit = (c) => {
    setEditing(c.id)
    setForm({
      shopName: c.shopName || '', ownerName: c.ownerName || '', phone: c.phone || '',
      area: c.area || '', address: c.address || '', city: c.city || '', state: c.state || '',
      pincode: c.pincode || '', gstin: c.gstin || '', pan: c.pan || '',
      creditLimit: c.creditLimit ?? '', active: c.active !== false,
      companies: c.companies || (c.company ? [c.company] : [defaultCompany]),
    })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.shopName.trim()) { setError('Shop name is required.'); return }
    // Duplicate check
    const dupName = customers.find(c => c.id !== editing && (c.shopName || '').trim().toLowerCase() === form.shopName.trim().toLowerCase())
    if (dupName) { setError(`Duplicate: "${dupName.shopName}" already exists.`); return }
    if (form.gstin.trim()) {
      const dupGstin = customers.find(c => c.id !== editing && c.gstin && (c.gstin || '').trim().toUpperCase() === form.gstin.trim().toUpperCase())
      if (dupGstin) { setError(`Duplicate GSTIN: already used by "${dupGstin.shopName}".`); return }
    }
    setSaving(true)
    try {
      const companies = form.companies?.length ? form.companies : [defaultCompany]
      const payload = { ...form, creditLimit: Number(form.creditLimit) || 0, companies, company: companies[0] }
      if (editing) {
        await updateDoc(doc(db, 'crm_customers', editing), { ...payload, updatedAt: new Date().toISOString() })
        setCustomers(prev => prev.map(c => c.id === editing ? { ...c, ...payload } : c))
      } else {
        const newCust = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'crm_customers'), newCust)
        setCustomers(prev => [...prev, { id: ref.id, ...newCust }])
      }
      setShowForm(false)
      resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (c) => {
    if (!window.confirm(`Remove "${c.shopName}" from your customer list? Past orders linked to them are kept.`)) return
    try {
      await deleteDoc(doc(db, 'crm_customers', c.id))
      setCustomers(prev => prev.filter(x => x.id !== c.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const filtered = customers.filter(c => {
    // All CRM users see all customers — 'companies' on a customer denotes which entity
    // they belong to, not access control. Sales managers need to add customers for any entity.
    const q = search.toLowerCase()
    return !q || (c.shopName || '').toLowerCase().includes(q) || (c.area || '').toLowerCase().includes(q) || (c.ownerName || '').toLowerCase().includes(q)
  })

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Customers</h2>
          <p className="text-slate-500 text-sm">{customers.length} customers</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRefresh} disabled={refreshing}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition disabled:opacity-50"
            title="Pull the latest customer and contact changes from other users">
            {refreshing ? '⏳ Refreshing…' : '🔄 Refresh'}
          </button>
          <button onClick={() => { setShowForm(!showForm); resetForm() }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            {showForm && !editing ? '✕ Cancel' : '+ Add Customer'}
          </button>
        </div>
      </div>

      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by company name, contact, or region..."
        className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

      {showForm && (
        <div ref={formRef} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Customer' : 'Add New Customer'}</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Company Name *</label>
              <input type="text" value={form.shopName} onChange={e => setForm(p => ({ ...p, shopName: e.target.value }))} autoComplete="off"
                placeholder="e.g. Sharma Trading Co."
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contact Person</label>
              <input type="text" value={form.ownerName} onChange={e => setForm(p => ({ ...p, ownerName: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Region</label>
              <input type="text" value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))} autoComplete="off"
                placeholder="e.g. Pune West"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Street Address</label>
              <input type="text" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
              <input type="text" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Pincode</label>
              <input type="text" value={form.pincode} onChange={e => setForm(p => ({ ...p, pincode: e.target.value }))} autoComplete="off"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {/* GST / Tax section */}
            <div className="col-span-2 pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-3">GST / Tax Details</p>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                GSTIN
                <span className="text-slate-400 font-normal text-xs ml-1">— type 15 chars then click Fetch to auto-fill</span>
              </label>
              <div className="flex gap-2">
                <input type="text" value={form.gstin}
                  onChange={e => { setGstStatus(''); setForm(p => ({ ...p, gstin: e.target.value })) }}
                  autoComplete="off" maxLength={15} placeholder="e.g. 27AAAAA0000A1Z5"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">PAN <span className="text-slate-400 font-normal text-xs">(auto-filled from GSTIN)</span></label>
              <input type="text" value={form.pan} onChange={e => setForm(p => ({ ...p, pan: e.target.value }))} autoComplete="off"
                maxLength={10} placeholder="e.g. AAAAA0000A"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">State <span className="text-slate-400 font-normal text-xs">(for invoicing)</span></label>
              <select value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— select state —</option>
                {INDIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Credit Limit (₹)</label>
              <input type="number" value={form.creditLimit} onChange={e => setForm(p => ({ ...p, creditLimit: e.target.value }))} autoComplete="off"
                min="0" className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} id="cust-active" />
              <label htmlFor="cust-active" className="text-sm text-slate-700">Active customer</label>
            </div>
            {canSelectCompany && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Entity (select one or both)</label>
                <div className="flex gap-3 flex-wrap">
                  {(isAdmin ? COMPANIES : userCompanies).map(co => {
                    const checked = (form.companies || []).includes(co)
                    return (
                      <label key={co} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer text-sm font-medium transition select-none ${checked ? (COMPANY_COLORS[co] || 'bg-slate-100 text-slate-700') + ' border-transparent' : 'border-slate-300 text-slate-500 hover:border-slate-400'}`}>
                        <input type="checkbox" className="hidden" checked={checked}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...(form.companies || []), co]
                              : (form.companies || []).filter(x => x !== co)
                            setForm(p => ({ ...p, companies: next }))
                          }} />
                        {COMPANY_LABELS[co] || co}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Customer' : 'Add Customer'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Company Name</th>
              <th className="text-left px-4 py-3">Contact</th>
              <th className="text-left px-4 py-3">Phone</th>
              <th className="text-left px-4 py-3">Region</th>
              <th className="text-left px-4 py-3">Entity</th>
              <th className="text-right px-4 py-3">Credit Limit</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Contacts</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(c => (
              <tr key={c.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{c.shopName}</div>
                  {c.gstin && <div className="text-xs font-mono text-slate-500">GSTIN: {c.gstin}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{c.ownerName || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.phone || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.area || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {(c.companies || (c.company ? [c.company] : [])).map(co => (
                      <span key={co} className={`px-2 py-0.5 rounded-lg text-xs font-bold ${COMPANY_COLORS[co] || 'bg-slate-100 text-slate-600'}`}>{COMPANY_LABELS[co] || co}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-slate-700">₹{(Number(c.creditLimit) || 0).toLocaleString('en-IN')}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${c.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {c.active !== false ? '● Active' : '● Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {canSeeContacts(c) ? (
                      <button onClick={() => setContactsCustomer(c)}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                        👥 {(() => {
                          const n = contacts.filter(ct => ct.customerId === c.id).length
                          return n > 0 ? `${n} contact${n !== 1 ? 's' : ''}` : 'Add contacts'
                        })()}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                    <button onClick={() => setHistoryCustomer(c)}
                      className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 font-medium">
                      📋 History
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  <button onClick={() => navigate(`/crm/sites?customer=${c.id}`)} className="text-orange-600 hover:text-orange-700 font-medium">📍 Sites</button>
                  <button onClick={() => handleEdit(c)} className="text-blue-600 hover:text-blue-700 font-medium">✏️ Edit</button>
                  {isAdmin && (
                    <button onClick={() => handleDelete(c)} className="text-red-600 hover:text-red-700 font-medium">🗑️ Delete</button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400">No customers found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Contacts modal */}
      {contactsCustomer && (
        <CustomerContactsModal
          customer={contactsCustomer}
          contacts={contacts.filter(ct => ct.customerId === contactsCustomer.id)}
          onClose={() => setContactsCustomer(null)}
          onContactsChange={(updatedForCustomer) => {
            setContacts(prev => [
              ...prev.filter(ct => ct.customerId !== contactsCustomer.id),
              ...updatedForCustomer,
            ])
          }}
        />
      )}

      {/* History modal */}
      {historyCustomer && (
        <CustomerHistoryModal
          customer={historyCustomer}
          deals={deals}
          onClose={() => setHistoryCustomer(null)}
        />
      )}
    </div>
  )
}
