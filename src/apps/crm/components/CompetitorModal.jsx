import React, { useState, useEffect, useRef } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

// ── Constants ─────────────────────────────────────────────────────────────────
export const COMPETITOR_STATUSES = [
  { id: 'competing',    label: 'Competing',      color: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500' },
  { id: 'won_against',  label: 'Won against',    color: 'bg-green-100 text-green-700',  dot: 'bg-green-500' },
  { id: 'lost_to',      label: 'Lost to',        color: 'bg-red-100 text-red-700',      dot: 'bg-red-500' },
  { id: 'dropped_out',  label: 'Dropped out',    color: 'bg-slate-100 text-slate-500',  dot: 'bg-slate-400' },
]

const statusObj = (id) => COMPETITOR_STATUSES.find(s => s.id === id) || COMPETITOR_STATUSES[0]

const CURRENCIES = ['INR', 'USD', 'CNY']
const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', CNY: '¥' }

const inp  = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl  = 'block text-xs font-medium text-slate-600 mb-1'

const emptyForm = {
  name: '', product: '', estimatedPrice: '', currency: 'INR',
  website: '', industry: '', hqCity: '',
  ourAdvantage: '', theirAdvantage: '', status: 'competing',
}

const INDUSTRIES = [
  'FMCG Distribution', 'Industrial Automation', 'IT Hardware', 'Electrical / EPC',
  'Logistics & Supply Chain', 'Manufacturing', 'Retail', 'Other',
]

export default function CompetitorModal({ deal, onClose, onDealUpdate, allCompetitors = [] }) {
  const { user, userProfile } = useAuth()
  const [competitors, setCompetitors] = useState(deal.competitors || [])
  const [form, setForm]       = useState({ ...emptyForm })
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const nameRef = useRef(null)

  // Sync if parent passes updated deal
  useEffect(() => { setCompetitors(deal.competitors || []) }, [deal])

  // Names already added to THIS deal
  const addedNames = new Set(competitors.map(c => c.name.toLowerCase()))

  // Autocomplete suggestions from typed name (for manual entry)
  const allCompetitorNames = allCompetitors.map(c => c.name)
  const suggestions = allCompetitorNames.filter(n =>
    n.toLowerCase().includes(form.name.toLowerCase()) && n.toLowerCase() !== form.name.toLowerCase() && form.name.length > 0
  )

  // Pre-fill form from a known competitor (keep status as 'competing', let user update deal-specific fields)
  const pickExisting = (c) => {
    setForm({
      name:           c.name,
      product:        c.product || '',
      estimatedPrice: '',              // leave blank — price may differ per deal
      currency:       c.currency || 'INR',
      website:        c.website || '',
      industry:       c.industry || '',
      hqCity:         c.hqCity || '',
      ourAdvantage:   c.ourAdvantage || '',
      theirAdvantage: c.theirAdvantage || '',
      status:         'competing',     // always start fresh per deal
    })
    setEditingId(null)
    setShowSuggestions(false)
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  const persist = async (updated) => {
    await updateDoc(doc(db, 'crm_deals', deal.id), {
      competitors: updated, updatedAt: new Date().toISOString(),
    })
    setCompetitors(updated)
    onDealUpdate({ ...deal, competitors: updated })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Competitor name is required.'); return }
    setSaving(true); setError('')
    try {
      const entry = {
        id:             editingId || Date.now().toString(),
        name:           form.name.trim(),
        product:        form.product.trim(),
        website:        form.website.trim(),
        industry:       form.industry,
        hqCity:         form.hqCity.trim(),
        estimatedPrice: Number(form.estimatedPrice) || 0,
        currency:       form.currency,
        ourAdvantage:   form.ourAdvantage.trim(),
        theirAdvantage: form.theirAdvantage.trim(),
        status:         form.status,
        addedBy:        user.uid,
        addedByName:    userProfile?.name || user.email || '',
        updatedAt:      new Date().toISOString(),
      }
      const updated = editingId
        ? competitors.map(c => c.id === editingId ? entry : c)
        : [...competitors, entry]
      await persist(updated)
      setForm({ ...emptyForm })
      setEditingId(null)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleEdit = (c) => {
    setEditingId(c.id)
    setForm({
      name: c.name, product: c.product || '', estimatedPrice: c.estimatedPrice || '',
      currency: c.currency || 'INR', website: c.website || '', industry: c.industry || '',
      hqCity: c.hqCity || '', ourAdvantage: c.ourAdvantage || '',
      theirAdvantage: c.theirAdvantage || '', status: c.status || 'competing',
    })
    nameRef.current?.focus()
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this competitor?')) return
    try { await persist(competitors.filter(c => c.id !== id)) }
    catch (err) { setError('Error: ' + err.message) }
  }

  const handleStatusChange = async (id, newStatus) => {
    try {
      await persist(competitors.map(c => c.id === id ? { ...c, status: newStatus, updatedAt: new Date().toISOString() } : c))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const cancelEdit = () => { setEditingId(null); setForm({ ...emptyForm }); setError('') }

  return (
    <div className="fixed inset-0 z-50 flex" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="flex-1 bg-black/30" onClick={onClose} />

      <div className="bg-white w-full max-w-lg h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-800">⚔️ Competitor Tracking</h2>
              <p className="text-xs text-slate-500 truncate mt-0.5">{deal.title}{deal.customerName ? ` · ${deal.customerName}` : ''}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 ml-3">
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                {competitors.length} {competitors.length === 1 ? 'competitor' : 'competitors'}
              </span>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Add / Edit form ── */}
          <div className="p-4 bg-slate-50 border-b border-slate-200">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              {editingId ? 'Edit competitor' : 'Add competitor'}
            </p>
            {/* ── Known competitors picker ── */}
            {allCompetitors.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-slate-500 mb-2">Known competitors — click to pre-fill:</p>
                <div className="flex flex-wrap gap-1.5">
                  {allCompetitors.map(c => {
                    const already = addedNames.has(c.name.toLowerCase())
                    return (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => !already && pickExisting(c)}
                        title={already ? 'Already added to this opportunity' : `Pre-fill from ${c.name}`}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                          already
                            ? 'bg-green-100 text-green-700 border-green-200 cursor-default'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 cursor-pointer'
                        }`}
                      >
                        {already ? '✓ ' : ''}{c.name}
                        {c.industry ? <span className="opacity-60 ml-0.5">· {c.industry.split(' ')[0]}</span> : null}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-slate-400 mt-1.5">Green = already on this opportunity. Others click to load their details (you can still edit before saving).</p>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3">
              {/* Name with autocomplete */}
              <div className="relative">
                <label className={lbl}>Competitor name *</label>
                <input ref={nameRef} type="text" value={form.name} autoComplete="off"
                  onChange={e => { setForm(p => ({ ...p, name: e.target.value })); setShowSuggestions(true) }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="e.g. Hindustan Unilever, Nestlé…"
                  className={inp} required />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute z-10 left-0 right-0 top-full bg-white border border-slate-300 rounded-lg shadow-lg mt-0.5 max-h-36 overflow-y-auto">
                    {suggestions.map(s => (
                      <li key={s}>
                        <button type="button" onMouseDown={() => { setForm(p => ({ ...p, name: s })); setShowSuggestions(false) }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 text-slate-700">
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label className={lbl}>Their product / solution</label>
                <input type="text" value={form.product} autoComplete="off"
                  onChange={e => setForm(p => ({ ...p, product: e.target.value }))}
                  placeholder="What are they offering against us?"
                  className={inp} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Website <span className="font-normal text-slate-400">(for news lookup)</span></label>
                  <input type="url" value={form.website} autoComplete="off"
                    onChange={e => setForm(p => ({ ...p, website: e.target.value }))}
                    placeholder="https://competitor.com"
                    className={inp} />
                </div>
                <div>
                  <label className={lbl}>HQ City</label>
                  <input type="text" value={form.hqCity} autoComplete="off"
                    onChange={e => setForm(p => ({ ...p, hqCity: e.target.value }))}
                    placeholder="Mumbai, Delhi…"
                    className={inp} />
                </div>
              </div>

              <div>
                <label className={lbl}>Industry segment</label>
                <select value={form.industry} onChange={e => setForm(p => ({ ...p, industry: e.target.value }))} className={inp}>
                  <option value="">— Select industry —</option>
                  {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={lbl}>Est. price</label>
                  <input type="number" value={form.estimatedPrice} min="0"
                    onChange={e => setForm(p => ({ ...p, estimatedPrice: e.target.value }))}
                    placeholder="0" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Currency</label>
                  <select value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} className={inp}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{CURRENCY_SYMBOLS[c]} {c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp}>
                    {COMPETITOR_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={lbl}>Our advantage over them</label>
                <textarea value={form.ourAdvantage} rows={2}
                  onChange={e => setForm(p => ({ ...p, ourAdvantage: e.target.value }))}
                  placeholder="Price, delivery, relationship, specs…"
                  className={inp + ' resize-none'} />
              </div>

              <div>
                <label className={lbl}>Their advantage over us</label>
                <textarea value={form.theirAdvantage} rows={2}
                  onChange={e => setForm(p => ({ ...p, theirAdvantage: e.target.value }))}
                  placeholder="Brand, existing client, pricing…"
                  className={inp + ' resize-none'} />
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-lg border border-red-200">{error}</p>}

              <div className="flex gap-2">
                <button type="submit" disabled={saving}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                  {saving ? 'Saving…' : editingId ? 'Update Competitor' : '+ Add Competitor'}
                </button>
                {editingId && (
                  <button type="button" onClick={cancelEdit}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded-lg transition">
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* ── Competitor list ── */}
          <div className="p-4">
            {competitors.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-slate-400 text-sm">No competitors tagged yet.</p>
                <p className="text-slate-300 text-xs mt-1">Add the companies competing for this opportunity above.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {competitors.map(c => {
                  const st = statusObj(c.status)
                  return (
                    <div key={c.id} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* Name + status */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-800">{c.name}</span>
                            {/* Inline status changer */}
                            <select value={c.status}
                              onChange={e => handleStatusChange(c.id, e.target.value)}
                              className={`text-xs font-semibold px-1.5 py-0.5 rounded-lg border-0 cursor-pointer ${st.color}`}>
                              {COMPETITOR_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                          </div>
                          {/* Product */}
                          {c.product && <p className="text-xs text-slate-500 mt-0.5">🎯 {c.product}</p>}
                          {/* Website / Industry */}
                          <div className="flex gap-2 flex-wrap">
                            {c.website && <a href={c.website} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline" onClick={e => e.stopPropagation()}>🌐 Website</a>}
                            {c.industry && <span className="text-xs text-slate-400">{c.industry}</span>}
                            {c.hqCity && <span className="text-xs text-slate-400">📍 {c.hqCity}</span>}
                          </div>
                          {/* Est. price */}
                          {c.estimatedPrice > 0 && (
                            <p className="text-xs text-slate-500">
                              💰 Est. {CURRENCY_SYMBOLS[c.currency] || ''}{Number(c.estimatedPrice).toLocaleString('en-IN')} {c.currency}
                            </p>
                          )}
                          {/* Advantages */}
                          {c.ourAdvantage && (
                            <div className="mt-1.5 flex gap-1.5">
                              <span className="text-xs text-green-700 font-semibold flex-shrink-0">✓ Us:</span>
                              <span className="text-xs text-green-700 leading-snug">{c.ourAdvantage}</span>
                            </div>
                          )}
                          {c.theirAdvantage && (
                            <div className="flex gap-1.5">
                              <span className="text-xs text-red-600 font-semibold flex-shrink-0">✗ Them:</span>
                              <span className="text-xs text-red-600 leading-snug">{c.theirAdvantage}</span>
                            </div>
                          )}
                          {c.addedByName && (
                            <p className="text-xs text-slate-300 mt-1">Added by {c.addedByName}</p>
                          )}
                        </div>
                        {/* Actions */}
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <button onClick={() => handleEdit(c)}
                            className="text-xs text-slate-400 hover:text-blue-600 px-2 py-0.5 rounded-lg hover:bg-blue-50 transition">
                            Edit
                          </button>
                          <button onClick={() => handleDelete(c.id)}
                            className="text-xs text-slate-300 hover:text-red-500 px-2 py-0.5 rounded-lg hover:bg-red-50 transition">
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
