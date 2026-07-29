import React, { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

export const ACTIVITY_TYPES = [
  { id: 'call',          label: 'Call',          icon: '📞', color: 'bg-blue-100 text-blue-700' },
  { id: 'email',         label: 'Email',         icon: '✉️',  color: 'bg-indigo-100 text-indigo-700' },
  { id: 'site_visit',    label: 'Site Visit',    icon: '🏗️', color: 'bg-orange-100 text-orange-700' },
  { id: 'meeting',       label: 'Meeting',       icon: '🤝', color: 'bg-purple-100 text-purple-700' },
  { id: 'document_sent', label: 'Document',      icon: '📄', color: 'bg-amber-100 text-amber-700' },
  { id: 'note',          label: 'Note',          icon: '📝', color: 'bg-slate-100 text-slate-600' },
]

const STAGES = [
  { id: 'lead', label: 'Lead' }, { id: 'prebid', label: 'Pre-bid' },
  { id: 'bid', label: 'Bid' }, { id: 'closing', label: 'Closing' },
  { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
  { id: 'rejected', label: 'Rejected' }, { id: 'nobid', label: 'No Bid' },
]

const OUTCOMES = ['Positive', 'Neutral', 'Negative', 'No response', 'Follow-up needed']

const OUTCOME_COLORS = {
  'Positive':           'bg-green-100 text-green-700',
  'Neutral':            'bg-slate-100 text-slate-600',
  'Negative':           'bg-red-100 text-red-700',
  'No response':        'bg-slate-100 text-slate-500',
  'Follow-up needed':   'bg-amber-100 text-amber-700',
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

const emptyForm = {
  type: 'call', date: todayStr(), summary: '', notes: '',
  outcome: '', nextAction: '', nextActionDate: '',
  updateStage: false, newStage: '',
}

const typeObj = (id) => ACTIVITY_TYPES.find(t => t.id === id) || ACTIVITY_TYPES[5]

export default function ActivityFeedModal({ deal, onClose, onDealUpdate }) {
  const { user, userProfile } = useAuth()
  const [form, setForm]       = useState({ ...emptyForm })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  // ── Merge activities[] + meetingNotes[] into one timeline ─────────────────
  const activities  = deal.activities   || []
  const meetingNotes = (deal.meetingNotes || []).map(m => ({
    id:           `mn-${m.id}`,
    type:         'meeting',
    date:         m.date || '',
    summary:      m.discussion?.slice(0, 100) || '(Meeting)',
    notes:        m.discussion  || '',
    outcome:      '',
    nextAction:   m.nextAction  || '',
    nextActionDate: m.nextMeetingDate || '',
    addedByName:  m.addedByName || '',
    createdAt:    m.createdAt   || '',
    _legacy:      true,   // from old meetingNotes — show but no delete button
    _attendees:   [m.customerAttendees, m.uiplAttendees].filter(Boolean).join(' / '),
    _stageChange: m.stageUpdated ? `${m.oldStage} → ${m.newStage}` : null,
  }))

  const timeline = [...activities, ...meetingNotes].sort(
    (a, b) => (b.date || '').localeCompare(a.date || '') ||
              (b.createdAt || '').localeCompare(a.createdAt || '')
  )

  const totalCount = timeline.length

  // ── Save new activity ─────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.summary.trim()) { setError('Summary is required.'); return }
    if (form.updateStage && !form.newStage) { setError('Select a stage or uncheck "Update stage".'); return }
    setSaving(true); setError('')
    try {
      const entry = {
        id:            Date.now().toString(),
        type:          form.type,
        date:          form.date,
        summary:       form.summary.trim(),
        notes:         form.notes.trim(),
        outcome:       form.outcome || '',
        nextAction:    form.nextAction.trim(),
        nextActionDate: form.nextActionDate,
        addedBy:       user.uid,
        addedByName:   userProfile?.name || user.email || '',
        createdAt:     new Date().toISOString(),
      }
      const updatedActivities = [...activities, entry]
      const update = { activities: updatedActivities, updatedAt: new Date().toISOString() }
      if (form.updateStage && form.newStage) update.stage = form.newStage

      await updateDoc(doc(db, 'crm_deals', deal.id), update)
      onDealUpdate({ ...deal, ...update })
      setForm(p => ({ ...emptyForm, type: p.type }))  // keep type, reset rest
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (activityId) => {
    if (!window.confirm('Remove this activity?')) return
    const updated = activities.filter(a => a.id !== activityId)
    try {
      await updateDoc(doc(db, 'crm_deals', deal.id), { activities: updated, updatedAt: new Date().toISOString() })
      onDealUpdate({ ...deal, activities: updated })
    } catch (err) { setError('Error: ' + err.message) }
  }

  const t = typeObj(form.type)

  return (
    <div className="fixed inset-0 z-50 flex" onClick={e => e.target === e.currentTarget && onClose()}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel — slides in from right */}
      <div className="bg-white w-full max-w-lg h-full flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-800">Activity Feed</h2>
              <p className="text-xs text-slate-500 truncate mt-0.5">{deal.title}{deal.customerName ? ` · ${deal.customerName}` : ''}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 ml-3">
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                {totalCount} {totalCount === 1 ? 'entry' : 'entries'}
              </span>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Add activity form ── */}
          <div className="p-4 bg-slate-50 border-b border-slate-200">
            <form onSubmit={handleSave} className="space-y-3">
              {/* Type pills */}
              <div className="flex gap-1.5 flex-wrap">
                {ACTIVITY_TYPES.map(type => (
                  <button key={type.id} type="button"
                    onClick={() => setForm(p => ({ ...p, type: type.id }))}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition
                      ${form.type === type.id
                        ? type.color + ' border-transparent shadow-sm'
                        : 'bg-white border-slate-300 text-slate-500 hover:border-slate-400'}`}>
                    {type.icon} {type.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={lbl}>Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className={inp} />
                </div>
                <div className="col-span-2">
                  <label className={lbl}>Summary *</label>
                  <input type="text" value={form.summary} onChange={e => setForm(p => ({ ...p, summary: e.target.value }))}
                    autoComplete="off" placeholder={`${t.icon} What happened?`} className={inp} required />
                </div>
              </div>

              <div>
                <label className={lbl}>Notes / Details</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2} placeholder="Optional — key points, decisions, observations..."
                  className={inp + ' resize-none'} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Outcome</label>
                  <select value={form.outcome} onChange={e => setForm(p => ({ ...p, outcome: e.target.value }))} className={inp}>
                    <option value="">— select —</option>
                    {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Next action by</label>
                  <input type="date" value={form.nextActionDate} onChange={e => setForm(p => ({ ...p, nextActionDate: e.target.value }))} className={inp} />
                </div>
              </div>

              <div>
                <label className={lbl}>Next action</label>
                <input type="text" value={form.nextAction} onChange={e => setForm(p => ({ ...p, nextAction: e.target.value }))}
                  autoComplete="off" placeholder="e.g. Send revised quote, schedule demo..." className={inp} />
              </div>

              {/* Stage update */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input type="checkbox" checked={form.updateStage}
                    onChange={e => setForm(p => ({ ...p, updateStage: e.target.checked, newStage: '' }))}
                    className="accent-blue-600 w-3.5 h-3.5" />
                  Move to stage
                </label>
                {form.updateStage && (
                  <select value={form.newStage} onChange={e => setForm(p => ({ ...p, newStage: e.target.value }))}
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— choose stage —</option>
                    {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                )}
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-lg border border-red-200">{error}</p>}

              <button type="submit" disabled={saving}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : `+ Log ${t.label}`}
              </button>
            </form>
          </div>

          {/* ── Timeline ── */}
          <div className="p-4">
            {timeline.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-slate-400 text-sm">No activities yet.</p>
                <p className="text-slate-300 text-xs mt-1">Log your first call, email, or visit above.</p>
              </div>
            ) : (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[18px] top-5 bottom-5 w-px bg-slate-200 z-0" />

                <div className="space-y-3">
                  {timeline.map(entry => {
                    const et = typeObj(entry.type)
                    return (
                      <div key={entry.id} className="relative flex gap-3">
                        {/* Icon dot */}
                        <div className={`relative z-10 flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm ring-2 ring-white ${et.color}`}>
                          {et.icon}
                        </div>

                        {/* Card */}
                        <div className="flex-1 min-w-0 bg-white rounded-2xl shadow-card border border-slate-200/70 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              {/* Meta row */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-lg ${et.color}`}>{et.label}</span>
                                <span className="text-xs text-slate-500">{entry.date}</span>
                                {entry.addedByName && <span className="text-xs text-slate-400">· {entry.addedByName}</span>}
                                {entry._legacy && <span className="text-xs text-slate-300 italic">meeting log</span>}
                              </div>
                              {/* Summary */}
                              <p className="text-sm font-medium text-slate-800 mt-1 leading-snug">{entry.summary}</p>
                              {/* Notes (if different from summary) */}
                              {entry.notes && entry.notes !== entry.summary && (
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-3">{entry.notes}</p>
                              )}
                              {/* Attendees from legacy meeting notes */}
                              {entry._attendees && (
                                <p className="text-xs text-slate-400 mt-0.5">👥 {entry._attendees}</p>
                              )}
                              {/* Stage change badge */}
                              {entry._stageChange && (
                                <span className="inline-block text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded-lg mt-1">
                                  Stage: {entry._stageChange}
                                </span>
                              )}
                              {/* Outcome + next action */}
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                {entry.outcome && (
                                  <span className={`text-xs px-1.5 py-0.5 rounded-lg font-medium ${OUTCOME_COLORS[entry.outcome] || 'bg-slate-100 text-slate-600'}`}>
                                    {entry.outcome}
                                  </span>
                                )}
                                {entry.nextAction && (
                                  <span className="text-xs text-amber-700">
                                    → {entry.nextAction}{entry.nextActionDate ? ` · ${entry.nextActionDate}` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* Delete only for non-legacy activities */}
                            {!entry._legacy && (
                              <button onClick={() => handleDelete(entry.id)}
                                className="text-slate-300 hover:text-red-500 text-xs flex-shrink-0 mt-0.5">✕</button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
