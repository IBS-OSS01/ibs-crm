import React, { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const STAGES = [
  { id: 'lead',     label: 'Lead' },
  { id: 'prebid',   label: 'Pre-bid' },
  { id: 'bid',      label: 'Bid' },
  { id: 'closing',  label: 'Closing' },
  { id: 'won',      label: 'Won' },
  { id: 'lost',     label: 'Lost' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'nobid',    label: 'No Bid' },
]

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

const today = () => new Date().toISOString().slice(0, 10)
const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

export default function MeetingNotesModal({ deal, onClose, onDealUpdate }) {
  const { user, userProfile } = useAuth()

  const [form, setForm] = useState({
    date: today(),
    customerAttendees: '',
    uiplAttendees: userProfile?.name || '',
    discussion: '',
    nextAction: '',
    nextMeetingDate: '',
    updateStage: false,
    newStage: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // Sort notes newest first (by date, then createdAt)
  const notes = [...(deal.meetingNotes || [])].sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') ||
    (b.createdAt || '').localeCompare(a.createdAt || '')
  )

  const f = field => e => setForm(p => ({ ...p, [field]: e.target.value }))

  const handleSave = async () => {
    if (!form.discussion.trim()) { setError('Meeting summary is required.'); return }
    if (form.updateStage && !form.newStage) { setError('Select a new stage or uncheck "Update stage".'); return }
    setSaving(true); setError('')
    try {
      const note = {
        id: Date.now().toString(),
        date:               form.date,
        customerAttendees:  form.customerAttendees.trim(),
        uiplAttendees:      form.uiplAttendees.trim(),
        discussion:         form.discussion.trim(),
        nextAction:         form.nextAction.trim(),
        nextMeetingDate:    form.nextMeetingDate,
        stageUpdated:       form.updateStage && !!form.newStage,
        oldStage:           form.updateStage ? (deal.stage || 'lead') : null,
        newStage:           form.updateStage ? form.newStage : null,
        addedBy:            user.uid,
        addedByName:        userProfile?.name || user.email || '',
        createdAt:          new Date().toISOString(),
      }

      const updatedNotes = [...(deal.meetingNotes || []), note]
      const update = { meetingNotes: updatedNotes, updatedAt: new Date().toISOString() }
      if (form.updateStage && form.newStage) update.stage = form.newStage

      await updateDoc(doc(db, 'crm_deals', deal.id), update)
      onDealUpdate({ ...deal, ...update })

      // Reset form but keep the UIPL attendees for next note
      setForm(p => ({
        date: today(),
        customerAttendees: '',
        uiplAttendees: p.uiplAttendees,
        discussion: '',
        nextAction: '',
        nextMeetingDate: '',
        updateStage: false,
        newStage: '',
      }))
    } catch (e) {
      setError('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const stageName = id => STAGES.find(s => s.id === id)?.label || id

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">📝 Meeting Notes</h3>
            <p className="text-slate-500 text-sm mt-0.5 font-medium">{deal.title}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {deal.customerName && <span className="text-xs text-slate-400">{deal.customerName}</span>}
              {deal.siteName    && <span className="text-xs text-slate-400">· {deal.siteName}</span>}
              <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${STAGE_COLORS[deal.stage] || 'bg-slate-100'}`}>
                {stageName(deal.stage)}
              </span>
              {notes.length > 0 && <span className="text-xs text-slate-400">{notes.length} note{notes.length !== 1 ? 's' : ''}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl ml-4 mt-1">✕</button>
        </div>

        {/* ── Body: form | timeline ─────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left — Add note form */}
          <div className="w-72 flex-shrink-0 border-r border-slate-100 p-4 overflow-y-auto bg-slate-50">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3">Add Note</p>

            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1 mb-3">{error}</p>}

            <div className="space-y-3">
              <div>
                <label className={lbl}>Meeting Date</label>
                <input type="date" className={inp} value={form.date} onChange={f('date')} />
              </div>
              <div>
                <label className={lbl}>Customer Attendees</label>
                <input className={inp} value={form.customerAttendees} onChange={f('customerAttendees')}
                  placeholder="Mr. Sharma, Purchase Head" />
              </div>
              <div>
                <label className={lbl}>UIPL / Our Team</label>
                <input className={inp} value={form.uiplAttendees} onChange={f('uiplAttendees')}
                  placeholder="Sandeep, Rutvi" />
              </div>
              <div>
                <label className={lbl}>Meeting Summary *</label>
                <textarea className={`${inp} h-28 resize-none`} value={form.discussion} onChange={f('discussion')}
                  placeholder="What was discussed? Key points, customer concerns, decisions made, objections raised…" />
              </div>
              <div>
                <label className={lbl}>Next Action <span className="text-slate-400 font-normal">(our task)</span></label>
                <input className={inp} value={form.nextAction} onChange={f('nextAction')}
                  placeholder="e.g. Send revised quote by July 15" />
              </div>
              <div>
                <label className={lbl}>Next Meeting Date</label>
                <input type="date" className={inp} value={form.nextMeetingDate} onChange={f('nextMeetingDate')} />
              </div>

              {/* Stage update */}
              <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" className="accent-blue-600"
                    checked={form.updateStage}
                    onChange={e => setForm(p => ({ ...p, updateStage: e.target.checked, newStage: '' }))} />
                  <span className="text-xs font-medium text-slate-700">Update opportunity stage</span>
                </label>
                {form.updateStage && (
                  <select className={inp} value={form.newStage} onChange={f('newStage')}>
                    <option value="">— select new stage —</option>
                    {STAGES.filter(s => s.id !== deal.stage).map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                )}
              </div>

              <button onClick={handleSave} disabled={saving}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving…' : '✓ Add Meeting Note'}
              </button>
            </div>
          </div>

          {/* Right — Notes timeline */}
          <div className="flex-1 overflow-y-auto p-5">
            {notes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                <span className="text-5xl mb-3">📋</span>
                <p className="text-sm font-medium">No meeting notes yet</p>
                <p className="text-xs mt-1">Add your first note using the form</p>
              </div>
            ) : (
              <div className="space-y-5">
                {notes.map((note, i) => (
                  <div key={note.id || i} className="relative pl-6 border-l-2 border-blue-100">
                    {/* Timeline dot */}
                    <div className="absolute -left-1.5 top-2 w-3 h-3 rounded-full border-2 border-white shadow-sm"
                      style={{ background: note.stageUpdated ? '#6366f1' : '#3b82f6' }} />

                    <div className="bg-white border border-slate-200/70 rounded-2xl shadow-card p-4 shadow-sm">
                      {/* Note header */}
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <span className="text-xs font-bold text-slate-700">{note.date}</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          {note.stageUpdated && note.newStage && (
                            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-lg font-semibold">
                              Stage → {stageName(note.newStage)}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">by {note.addedByName}</span>
                        </div>
                      </div>

                      {/* Attendees */}
                      {(note.customerAttendees || note.uiplAttendees) && (
                        <div className="flex items-start gap-1.5 mb-2">
                          <span className="text-xs">👥</span>
                          <p className="text-xs text-slate-500">
                            {[note.customerAttendees, note.uiplAttendees].filter(Boolean).join(' | ')}
                          </p>
                        </div>
                      )}

                      {/* Discussion */}
                      <p className="text-sm text-slate-700 leading-relaxed">{note.discussion}</p>

                      {/* Next action */}
                      {note.nextAction && (
                        <div className="mt-2 flex items-start gap-1.5 bg-amber-50 rounded-lg px-2 py-1.5">
                          <span className="text-amber-500 font-bold text-xs mt-0.5">→</span>
                          <p className="text-xs text-amber-800 font-medium">{note.nextAction}</p>
                        </div>
                      )}

                      {/* Next meeting */}
                      {note.nextMeetingDate && (
                        <p className="text-xs text-slate-400 mt-2">📅 Next meeting: <span className="font-medium text-slate-600">{note.nextMeetingDate}</span></p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
