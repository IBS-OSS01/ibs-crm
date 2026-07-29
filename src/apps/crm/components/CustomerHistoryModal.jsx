import React, { useMemo, useState } from 'react'

// Activity type display config
const ACTIVITY_META = {
  call:           { icon: '📞', label: 'Call',           color: 'bg-blue-100 text-blue-700' },
  email:          { icon: '📧', label: 'Email',          color: 'bg-sky-100 text-sky-700' },
  site_visit:     { icon: '🏭', label: 'Site Visit',     color: 'bg-amber-100 text-amber-700' },
  meeting:        { icon: '🤝', label: 'Meeting',        color: 'bg-purple-100 text-purple-700' },
  document_sent:  { icon: '📄', label: 'Document Sent',  color: 'bg-teal-100 text-teal-700' },
  note:           { icon: '📝', label: 'Note',           color: 'bg-slate-100 text-slate-600' },
  _legacy:        { icon: '🤝', label: 'Meeting Note',   color: 'bg-indigo-100 text-indigo-600' },
}

const STAGE_COLORS = {
  lead: 'bg-slate-100 text-slate-600', prebid: 'bg-blue-100 text-blue-700',
  bid: 'bg-amber-100 text-amber-700', closing: 'bg-purple-100 text-purple-700',
  won: 'bg-green-100 text-green-700', lost: 'bg-red-100 text-red-600',
  rejected: 'bg-orange-100 text-orange-700', nobid: 'bg-slate-200 text-slate-500',
}
const STAGE_LABELS = {
  lead: 'Lead', prebid: 'Pre-bid', bid: 'Bid', closing: 'Closing',
  won: 'Won', lost: 'Lost', rejected: 'Rejected', nobid: 'No Bid',
}

const valINR = (d) => d.valueINR ?? Number(d.value) ?? 0
const fmtINR = (n) => n >= 1e5 ? `₹${(n/1e5).toFixed(1)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`

export default function CustomerHistoryModal({ customer, deals, onClose }) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [dealFilter, setDealFilter] = useState('all')

  // All deals belonging to this customer (as biller OR end customer)
  const customerDeals = useMemo(() =>
    deals.filter(d => d.customerId === customer.id || d.endCustomerId === customer.id)
  , [deals, customer.id])

  // Flatten all activities + meetingNotes across all customer deals
  const allEntries = useMemo(() => {
    const entries = []
    customerDeals.forEach(deal => {
      // Legacy meeting notes
      ;(deal.meetingNotes || []).forEach(n => entries.push({
        ...n,
        _legacy: true,
        activityType: '_legacy',
        dealId: deal.id,
        dealTitle: deal.title,
        dealStage: deal.stage || 'lead',
        dealValue: valINR(deal),
        dealCurrency: deal.currency || 'INR',
      }))
      // New activities
      ;(deal.activities || []).forEach(a => entries.push({
        ...a,
        dealId: deal.id,
        dealTitle: deal.title,
        dealStage: deal.stage || 'lead',
        dealValue: valINR(deal),
        dealCurrency: deal.currency || 'INR',
      }))
    })
    return entries.sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''))
  }, [customerDeals])

  // Unique activity types present
  const presentTypes = useMemo(() => {
    const s = new Set(allEntries.map(e => e.activityType || '_legacy'))
    return [...s]
  }, [allEntries])

  // Filtered entries
  const filtered = useMemo(() => allEntries.filter(e => {
    if (typeFilter !== 'all' && (e.activityType || '_legacy') !== typeFilter) return false
    if (dealFilter !== 'all' && e.dealId !== dealFilter) return false
    return true
  }), [allEntries, typeFilter, dealFilter])

  // Deal summary stats
  const wonDeals  = customerDeals.filter(d => d.stage === 'won')
  const openDeals = customerDeals.filter(d => !['won','lost','rejected','nobid'].includes(d.stage))
  const totalWon  = wonDeals.reduce((s, d) => s + valINR(d), 0)

  return (
    <div className="fixed inset-0 z-50 flex" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="flex-1 bg-black/30" onClick={onClose} />

      <div className="bg-white w-full max-w-xl h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex-shrink-0 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-800 truncate">📋 {customer.shopName}</h2>
              <p className="text-xs text-slate-500 mt-0.5">Full contact &amp; activity history</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none flex-shrink-0">×</button>
          </div>

          {/* Customer deal summary */}
          <div className="flex gap-4 mt-3 text-xs">
            <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
              <p className="font-bold text-slate-800 text-base">{customerDeals.length}</p>
              <p className="text-slate-500">Total opportunities</p>
            </div>
            <div className="bg-green-50 rounded-lg px-3 py-2 text-center">
              <p className="font-bold text-green-700 text-base">{wonDeals.length}</p>
              <p className="text-green-600">Won · {fmtINR(totalWon)}</p>
            </div>
            <div className="bg-blue-50 rounded-lg px-3 py-2 text-center">
              <p className="font-bold text-blue-700 text-base">{openDeals.length}</p>
              <p className="text-blue-600">Open</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
              <p className="font-bold text-slate-800 text-base">{allEntries.length}</p>
              <p className="text-slate-500">Activities</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mt-3 flex-wrap">
            {/* Type filter */}
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="all">All types</option>
              {presentTypes.map(t => {
                const m = ACTIVITY_META[t] || { icon: '📌', label: t }
                return <option key={t} value={t}>{m.icon} {m.label}</option>
              })}
            </select>
            {/* Deal filter */}
            <select value={dealFilter} onChange={e => setDealFilter(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-48">
              <option value="all">All opportunities</option>
              {customerDeals.map(d => (
                <option key={d.id} value={d.id}>{d.title?.slice(0, 35)}</option>
              ))}
            </select>
            {(typeFilter !== 'all' || dealFilter !== 'all') && (
              <button onClick={() => { setTypeFilter('all'); setDealFilter('all') }}
                className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg border border-slate-200">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto">
          {customerDeals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <p className="text-2xl mb-2">📭</p>
              <p className="text-sm">No opportunities linked to this customer yet.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <p className="text-sm">No activities match the current filter.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((entry, i) => {
                const meta     = ACTIVITY_META[entry.activityType || '_legacy'] || ACTIVITY_META.note
                const stageCls = STAGE_COLORS[entry.dealStage] || 'bg-slate-100 text-slate-500'
                return (
                  <div key={entry.id || i} className="px-5 py-4 hover:bg-slate-50 transition">
                    {/* Deal context line */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-700 truncate max-w-48" title={entry.dealTitle}>
                        {entry.dealTitle}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-lg font-medium ${stageCls}`}>
                        {STAGE_LABELS[entry.dealStage] || entry.dealStage}
                      </span>
                      {entry.dealValue > 0 && (
                        <span className="text-xs text-slate-400">{fmtINR(entry.dealValue)}</span>
                      )}
                    </div>

                    {/* Activity row */}
                    <div className="flex items-start gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${meta.color}`}>
                        {meta.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-lg ${meta.color}`}>
                            {meta.label}
                          </span>
                          <span className="text-xs text-slate-400 flex-shrink-0">{entry.date || '—'}</span>
                        </div>

                        {/* Summary */}
                        {entry.summary && (
                          <p className="text-sm text-slate-700 mt-1 leading-snug">{entry.summary}</p>
                        )}
                        {/* Legacy: notes field */}
                        {!entry.summary && entry.notes && (
                          <p className="text-sm text-slate-700 mt-1 leading-snug">{entry.notes}</p>
                        )}

                        {/* Extra fields */}
                        <div className="mt-1 space-y-0.5">
                          {entry.outcome && (
                            <p className="text-xs text-slate-500">
                              <span className="font-medium">Outcome:</span> {entry.outcome}
                            </p>
                          )}
                          {entry.nextAction && (
                            <p className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg inline-block">
                              → {entry.nextAction}{entry.nextActionDate ? ` by ${entry.nextActionDate}` : ''}
                            </p>
                          )}
                          {entry.addedByName && (
                            <p className="text-xs text-slate-400">by {entry.addedByName}</p>
                          )}
                        </div>
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
  )
}
