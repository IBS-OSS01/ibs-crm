import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import ActivityFeedModal from '../components/ActivityFeedModal.jsx'

// ── Constants ─────────────────────────────────────────────────────────────────
const STAGE_COLORS = {
  lead:     'bg-slate-100 text-slate-600',
  prebid:   'bg-blue-100 text-blue-700',
  bid:      'bg-amber-100 text-amber-700',
  closing:  'bg-purple-100 text-purple-700',
  won:      'bg-green-100 text-green-700',
  lost:     'bg-red-100 text-red-700',
  rejected: 'bg-orange-100 text-orange-700',
  nobid:    'bg-slate-200 text-slate-500',
}
const STAGE_LABELS = {
  lead: 'Lead', prebid: 'Pre-bid', bid: 'Bid', closing: 'Closing',
  won: 'Won', lost: 'Lost', rejected: 'Rejected', nobid: 'No Bid',
}
const COMPANY_COLORS = {
  UIPL:   'bg-blue-100 text-blue-700',
  Wayzim: 'bg-purple-100 text-purple-700',
}
const ACTIVITY_TYPE_ICONS = {
  call: '📞', email: '✉️', site_visit: '🏗️', meeting: '🤝', document_sent: '📄', note: '📝',
}
const ACTIVITY_TYPE_LABELS = {
  call: 'Call', email: 'Email', site_visit: 'Site Visit', meeting: 'Meeting',
  document_sent: 'Document', note: 'Note',
}
const OUTCOME_COLORS = {
  'Positive':         'bg-green-100 text-green-700',
  'Neutral':          'bg-slate-100 text-slate-600',
  'Negative':         'bg-red-100 text-red-700',
  'No response':      'bg-slate-100 text-slate-500',
  'Follow-up needed': 'bg-amber-100 text-amber-700',
}

const inp = 'px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function Meetings() {
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const userCompanies = userProfile?.companies || ['UIPL']

  const [deals, setDeals]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [activityDeal, setActivityDeal] = useState(null)   // deal open in ActivityFeedModal

  // Filters
  const [searchQ, setSearchQ]         = useState('')
  const [filterSales, setFilterSales] = useState('')
  const [filterFrom, setFilterFrom]   = useState('')
  const [filterTo, setFilterTo]       = useState('')
  const [filterStage, setFilterStage] = useState('')

  // Collapsed deals
  const [collapsed, setCollapsed] = useState({})

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'crm_deals'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setDeals(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  // Called by ActivityFeedModal on save/delete — update local state and keep panel open
  const handleActivityUpdate = (updatedDeal) => {
    setDeals(prev => prev.map(d => d.id === updatedDeal.id ? updatedDeal : d))
    setActivityDeal(updatedDeal)
  }

  // ── Unique salespeople for filter ─────────────────────────────────────────
  const salesNames = useMemo(() => {
    const names = new Set()
    deals.forEach(d => { if (d.salesManagerName || d.assignedToName) names.add(d.salesManagerName || d.assignedToName) })
    return [...names].sort()
  }, [deals])

  // ── Build groups per deal (meetingNotes[] + activities[] of type meeting) ─
  const groups = useMemo(() => {
    const q = searchQ.toLowerCase()
    const result = []

    deals.forEach(deal => {
      // Company/team scope for non-admins
      if (!isAdmin) {
        const inCo   = !deal.company || userCompanies.includes(deal.company)
        const ids    = deal.assignedUserIds || (deal.assignedToId ? [deal.assignedToId] : [])
        const inTeam = ids.length === 0 || ids.includes(user.uid)
        if (!inCo || !inTeam) return
      }

      const mgName = deal.salesManagerName || deal.assignedToName || ''

      if (filterStage && deal.stage !== filterStage) return
      if (filterSales && mgName !== filterSales) return

      // Legacy meeting notes → normalise shape
      const legacyNotes = (deal.meetingNotes || []).map(m => ({
        _key:       `mn-${m.id || m.date}`,
        _source:    'legacy',
        type:       'meeting',
        date:       m.date || '',
        summary:    m.discussion || '',
        notes:      '',
        outcome:    '',
        nextAction: m.nextAction || '',
        nextActionDate: m.nextMeetingDate || '',
        addedByName: m.addedByName || '',
        createdAt:  m.createdAt || '',
        _attendees: [m.customerAttendees, m.uiplAttendees].filter(Boolean).join(' / '),
        _stageChange: m.stageUpdated ? `${STAGE_LABELS[m.oldStage] || m.oldStage} → ${STAGE_LABELS[m.newStage] || m.newStage}` : null,
      }))

      // New activities (all types — not just meetings) from activities[]
      const newActivities = (deal.activities || []).map(a => ({
        _key:       `act-${a.id}`,
        _source:    'activity',
        type:       a.type || 'note',
        date:       a.date || '',
        summary:    a.summary || '',
        notes:      a.notes || '',
        outcome:    a.outcome || '',
        nextAction: a.nextAction || '',
        nextActionDate: a.nextActionDate || '',
        addedByName: a.addedByName || '',
        createdAt:  a.createdAt || '',
        _attendees: '',
        _stageChange: null,
      }))

      // Merge, filter by date range + search, sort newest first
      const allEntries = [...legacyNotes, ...newActivities]
        .filter(e => {
          if (filterFrom && (e.date || '') < filterFrom) return false
          if (filterTo   && (e.date || '') > filterTo)   return false
          if (q && !(
            (deal.title || '').toLowerCase().includes(q) ||
            (deal.customerName || '').toLowerCase().includes(q) ||
            (e.summary || '').toLowerCase().includes(q) ||
            (e.nextAction || '').toLowerCase().includes(q) ||
            (e._attendees || '').toLowerCase().includes(q)
          )) return false
          return true
        })
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') ||
                        (b.createdAt || '').localeCompare(a.createdAt || ''))

      if (allEntries.length === 0) return

      result.push({
        deal,
        dealId:       deal.id,
        dealTitle:    deal.title || '(Untitled)',
        customerName: deal.customerName || '',
        stage:        deal.stage || 'lead',
        company:      deal.company || 'UIPL',
        mgName,
        projectNumber: deal.projectNumber || '',
        entries: allEntries,
      })
    })

    // Sort groups by most recent entry
    result.sort((a, b) => {
      const la = a.entries[0]?.date || ''
      const lb = b.entries[0]?.date || ''
      return lb.localeCompare(la)
    })
    return result
  }, [deals, isAdmin, userCompanies, user.uid, searchQ, filterSales, filterFrom, filterTo, filterStage])

  const totalEntries = groups.reduce((s, g) => s + g.entries.length, 0)

  const toggleCollapse = (dealId) => setCollapsed(p => ({ ...p, [dealId]: !p[dealId] }))
  const collapseAll    = () => { const n = {}; groups.forEach(g => { n[g.dealId] = true }); setCollapsed(n) }
  const expandAll      = () => setCollapsed({})

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Meetings & Activities</h2>
          <p className="text-slate-500 text-sm">
            {totalEntries} entr{totalEntries !== 1 ? 'ies' : 'y'} across {groups.length} opportunit{groups.length !== 1 ? 'ies' : 'y'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={expandAll}   className="text-xs text-slate-500 hover:text-blue-600 px-2 py-1 rounded-lg border border-slate-300 hover:border-blue-400 transition">Expand all</button>
          <button onClick={collapseAll} className="text-xs text-slate-500 hover:text-blue-600 px-2 py-1 rounded-lg border border-slate-300 hover:border-blue-400 transition">Collapse all</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-3 flex items-center gap-3 flex-wrap">
        <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
          placeholder="Search opportunity, customer, discussion..."
          className={inp + ' w-56'} />
        <select value={filterStage} onChange={e => setFilterStage(e.target.value)} className={inp}>
          <option value="">All stages</option>
          {Object.entries(STAGE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        {(isAdmin || salesNames.length > 1) && (
          <select value={filterSales} onChange={e => setFilterSales(e.target.value)} className={inp}>
            <option value="">All salespeople</option>
            {salesNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>From</span>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className={inp} />
          <span>To</span>
          <input type="date" value={filterTo}   onChange={e => setFilterTo(e.target.value)}   className={inp} />
        </div>
        {(searchQ || filterSales || filterFrom || filterTo || filterStage) && (
          <button onClick={() => { setSearchQ(''); setFilterSales(''); setFilterFrom(''); setFilterTo(''); setFilterStage('') }}
            className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition">
            ✕ Clear
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">{groups.length} deal{groups.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Groups */}
      {groups.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium">No entries found</p>
          <p className="text-sm mt-1">Log activities from the Pipeline via the 📋 button on each card</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(group => {
            const isCollapsed = collapsed[group.dealId]
            const stageColor  = STAGE_COLORS[group.stage] || 'bg-slate-100 text-slate-600'
            const coColor     = COMPANY_COLORS[group.company] || 'bg-slate-100 text-slate-600'
            const lastDate    = group.entries[0]?.date

            return (
              <div key={group.dealId} className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden shadow-sm">

                {/* Deal header */}
                <div className="flex items-center">
                  {/* Clickable title area */}
                  <button onClick={() => toggleCollapse(group.dealId)}
                    className="flex-1 text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition min-w-0">
                    <span className="text-slate-400 text-xs w-3 flex-shrink-0">{isCollapsed ? '▶' : '▼'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-800">{group.dealTitle}</span>
                        {group.customerName && <span className="text-xs text-slate-500">· {group.customerName}</span>}
                        {group.projectNumber && (
                          <span className="text-xs font-mono font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-lg">
                            📋 {group.projectNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-lg ${stageColor}`}>{STAGE_LABELS[group.stage] || group.stage}</span>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-lg ${coColor}`}>{group.company}</span>
                        {group.mgName && <span className="text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-lg">⭐ {group.mgName}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                        {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                      </span>
                      {lastDate && <p className="text-xs text-slate-400 mt-0.5">Last: {lastDate}</p>}
                    </div>
                  </button>

                  {/* + Log button — always visible */}
                  <div className="flex-shrink-0 px-3 border-l border-slate-200">
                    <button
                      onClick={() => setActivityDeal(group.deal)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition"
                      title="Log activity for this opportunity">
                      + Log
                    </button>
                  </div>
                </div>

                {/* Entries list */}
                {!isCollapsed && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100">
                    {group.entries.map(entry => {
                      const icon  = ACTIVITY_TYPE_ICONS[entry.type]  || '📝'
                      const typeLabel = ACTIVITY_TYPE_LABELS[entry.type] || entry.type
                      const isLegacy = entry._source === 'legacy'

                      return (
                        <div key={entry._key} className="px-4 py-3 hover:bg-slate-50 transition">
                          <div className="flex items-start gap-4">
                            {/* Icon + date */}
                            <div className="flex-shrink-0 text-center w-20">
                              <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-100 text-purple-700 text-sm">
                                {icon}
                              </div>
                              <p className="text-xs text-slate-500 mt-1 leading-tight">{entry.date || '—'}</p>
                              <p className="text-xs text-slate-400 font-medium leading-tight">{typeLabel}</p>
                              {entry.addedByName && (
                                <p className="text-xs text-slate-300 leading-tight truncate max-w-[80px]" title={entry.addedByName}>
                                  {entry.addedByName}
                                </p>
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0 space-y-1">
                              {/* Summary / discussion */}
                              {entry.summary && (
                                <p className="text-sm text-slate-700 leading-relaxed">{entry.summary}</p>
                              )}
                              {/* Extra notes (new activities only) */}
                              {!isLegacy && entry.notes && entry.notes !== entry.summary && (
                                <p className="text-xs text-slate-500 leading-relaxed">{entry.notes}</p>
                              )}
                              {/* Attendees (legacy meeting notes) */}
                              {entry._attendees && (
                                <p className="text-xs text-slate-500">👥 {entry._attendees}</p>
                              )}
                              {/* Stage change */}
                              {entry._stageChange && (
                                <span className="inline-block text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded-lg">
                                  Stage: {entry._stageChange}
                                </span>
                              )}
                              {/* Outcome */}
                              {entry.outcome && (
                                <span className={`inline-block text-xs px-1.5 py-0.5 rounded-lg font-medium ${OUTCOME_COLORS[entry.outcome] || 'bg-slate-100 text-slate-600'}`}>
                                  {entry.outcome}
                                </span>
                              )}
                              {/* Next action */}
                              {entry.nextAction && (
                                <div className="flex items-start gap-1.5">
                                  <span className="text-xs text-amber-600 font-semibold flex-shrink-0">→ Next:</span>
                                  <span className="text-xs text-amber-700">
                                    {entry.nextAction}
                                    {entry.nextActionDate && <span className="text-slate-400 ml-1">· {entry.nextActionDate}</span>}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {/* Inline add prompt at bottom of each group */}
                    <div className="px-4 py-2 bg-slate-50">
                      <button onClick={() => setActivityDeal(group.deal)}
                        className="text-xs text-slate-400 hover:text-blue-600 hover:bg-white px-3 py-1.5 rounded-lg border border-dashed border-slate-300 hover:border-blue-400 transition w-full">
                        + Log call, meeting, email or note for this opportunity
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Activity Feed Panel */}
      {activityDeal && (
        <ActivityFeedModal
          deal={activityDeal}
          onClose={() => setActivityDeal(null)}
          onDealUpdate={handleActivityUpdate}
        />
      )}
    </div>
  )
}
