/**
 * Candidate CV repository + a lightweight interview pipeline. Upload a
 * résumé (PDF/Word), the browser extracts the text and guesses the fields
 * below, a human reviews/corrects them, then only the structured fields +
 * extracted text are saved (free-plan safe — no file storage, so the
 * original file isn't kept; re-upload it if you ever need the exact
 * original document again). Each saved candidate can then be tracked
 * through a fixed set of interview stages to a final Accepted/Rejected
 * outcome — kept intentionally simple (no job postings, no multi-role
 * pipelines) rather than a full ATS.
 */
import React, { useState, useEffect, useRef } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, query } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'
import { extractTextFromFile, extractFields } from '../utils/cvParser'

const emptyReview = { name: '', designation: '', mobile: '', email: '', experience: '', company: '', location: '', education: '' }

// ── Interview pipeline ──────────────────────────────────────────────────
const INTERVIEW_STAGES = [
  { id: 'hr',         label: 'HR' },
  { id: 'technical',  label: 'Technical' },
  { id: 'hq1',        label: 'HQ Round 1' },
  { id: 'hq2',        label: 'HQ Round 2' },
  { id: 'finalOffer', label: 'Final Offer' },
]
const STAGE_STATUSES = ['not_scheduled', 'scheduled', 'passed', 'failed']
const STAGE_STATUS_META = {
  not_scheduled: { label: 'Not Scheduled', cls: 'bg-slate-100 text-slate-500' },
  scheduled:     { label: 'Scheduled',     cls: 'bg-amber-100 text-amber-700' },
  passed:        { label: 'Passed',        cls: 'bg-green-100 text-green-700' },
  failed:        { label: 'Failed',        cls: 'bg-red-100 text-red-700' },
}
const OUTCOME_META = {
  pending:  { label: 'Pending',  cls: 'bg-slate-100 text-slate-500' },
  accepted: { label: 'Accepted', cls: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
}
const emptyInterview = {
  stages: Object.fromEntries(INTERVIEW_STAGES.map(s => [s.id, { status: 'not_scheduled', date: '' }])),
  outcome: 'pending',
  outcomeDate: '',
}
// The furthest stage with a status other than "not scheduled" — used for
// the compact status badge in the table without opening the full panel.
function currentStageLabel(interview) {
  if (!interview) return null
  for (let i = INTERVIEW_STAGES.length - 1; i >= 0; i--) {
    const s = INTERVIEW_STAGES[i]
    const st = interview.stages?.[s.id]?.status
    if (st && st !== 'not_scheduled') return { label: s.label, status: st }
  }
  return null
}

export default function CandidateCVs() {
  const { user, userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const hasHRAccess = userProfile?.role === 'admin' || canEdit('HR')

  const fileInputRef = useRef(null)
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [parsing, setParsing] = useState(false)
  const [parseStatus, setParseStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [fileName, setFileName] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [review, setReview] = useState(null) // null = no pending review (new upload)
  const [editingId, setEditingId] = useState(null) // set = editing an already-saved candidate
  const [editForm, setEditForm] = useState(emptyReview)
  const [search, setSearch] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [designationFilter, setDesignationFilter] = useState('')
  const [minExperience, setMinExperience] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [interviewId, setInterviewId] = useState(null) // set = interview panel open for this candidate
  const [interviewDraft, setInterviewDraft] = useState(emptyInterview)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const q = query(collection(db, 'hr_candidates'), orderBy('uploadedAt', 'desc'))
      const snap = await getDocs(q)
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setCandidates(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(''); setSuccess(''); setReview(null); setResumeText('')
    setParsing(true); setParseStatus('Reading resume…')
    try {
      const text = await extractTextFromFile(file, (status) => setParseStatus(status))
      if (!text.trim()) throw new Error("No readable text found in this file — even OCR couldn't make it out. Try a clearer scan or a text-based PDF/Word file.")
      const fields = extractFields(text, file.name)
      setFileName(file.name)
      setResumeText(text)
      setReview({ ...emptyReview, ...fields })
    } catch (err) {
      setError(err.message || 'Failed to read that file.')
    } finally {
      setParsing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const setField = (k, v) => setReview(p => ({ ...p, [k]: v }))

  const handleSaveCandidate = async () => {
    if (!review) return
    if (!review.name.trim()) { setError('Name is required — the auto-detect may have missed it, please fill it in.'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        name: review.name.trim(),
        designation: review.designation.trim(),
        mobile: review.mobile.trim(),
        email: review.email.trim(),
        experience: review.experience.trim(),
        company: review.company.trim(),
        location: review.location.trim(),
        education: review.education.trim(),
        resumeText,
        fileName,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user.uid,
        uploadedByName: userProfile?.name || userProfile?.email || '',
      }
      const ref = await addDoc(collection(db, 'hr_candidates'), payload)
      setCandidates(prev => [{ id: ref.id, ...payload }, ...prev])
      setReview(null); setResumeText(''); setFileName('')
      setSuccess(`Saved ${payload.name}'s CV.`)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDiscard = () => { setReview(null); setResumeText(''); setFileName('') }

  // ── Edit an already-saved candidate's structured fields ──────────────
  const handleStartEdit = (c) => {
    setReview(null) // mutually exclusive with the upload/review flow
    setEditingId(c.id)
    setEditForm({
      name: c.name || '', designation: c.designation || '', mobile: c.mobile || '',
      email: c.email || '', experience: c.experience || '', company: c.company || '', location: c.location || '',
      education: c.education || '',
    })
    setError(''); setSuccess('')
  }

  const setEditField = (k, v) => setEditForm(p => ({ ...p, [k]: v }))
  const handleCancelEdit = () => { setEditingId(null); setEditForm(emptyReview) }

  const handleSaveEdit = async () => {
    if (!editingId) return
    if (!editForm.name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      const update = {
        name: editForm.name.trim(), designation: editForm.designation.trim(), mobile: editForm.mobile.trim(),
        email: editForm.email.trim(), experience: editForm.experience.trim(), company: editForm.company.trim(), location: editForm.location.trim(),
        education: editForm.education.trim(),
        updatedAt: new Date().toISOString(),
      }
      await updateDoc(doc(db, 'hr_candidates', editingId), update)
      setCandidates(prev => prev.map(c => c.id === editingId ? { ...c, ...update } : c))
      setSuccess(`Updated ${update.name}'s details.`)
      handleCancelEdit()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete ${c.name}'s CV record permanently?`)) return
    try {
      await deleteDoc(doc(db, 'hr_candidates', c.id))
      setCandidates(prev => prev.filter(x => x.id !== c.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  // ── Interview pipeline ────────────────────────────────────────────────
  const handleOpenInterview = (c) => {
    setExpandedId(null)
    setInterviewId(interviewId === c.id ? null : c.id)
    setInterviewDraft(c.interview ? {
      stages: { ...emptyInterview.stages, ...(c.interview.stages || {}) },
      outcome: c.interview.outcome || 'pending',
      outcomeDate: c.interview.outcomeDate || '',
    } : emptyInterview)
  }

  const setStageField = (stageId, field, value) => setInterviewDraft(p => ({
    ...p,
    stages: { ...p.stages, [stageId]: { ...p.stages[stageId], [field]: value } },
  }))

  const setOutcome = (value) => setInterviewDraft(p => ({
    ...p, outcome: value, outcomeDate: value === 'pending' ? '' : (p.outcomeDate || new Date().toISOString().slice(0, 10)),
  }))

  const handleSaveInterview = async (c) => {
    setSaving(true); setError('')
    try {
      await updateDoc(doc(db, 'hr_candidates', c.id), { interview: interviewDraft, updatedAt: new Date().toISOString() })
      setCandidates(prev => prev.map(x => x.id === c.id ? { ...x, interview: interviewDraft } : x))
      setSuccess(`Updated ${c.name}'s interview status.`)
      setInterviewId(null)
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  // Distinct values from saved candidates, for the filter dropdowns below.
  const distinctLocations = [...new Set(candidates.map(c => c.location).filter(Boolean))].sort()
  const distinctDesignations = [...new Set(candidates.map(c => c.designation).filter(Boolean))].sort()

  const filtered = candidates.filter(c => {
    if (locationFilter && c.location !== locationFilter) return false
    if (designationFilter && c.designation !== designationFilter) return false
    if (minExperience && (parseFloat(c.experience) || 0) < parseFloat(minExperience)) return false
    const q = search.toLowerCase()
    if (!q) return true
    return [c.name, c.designation, c.company, c.location, c.email, c.mobile, c.education].some(v => (v || '').toLowerCase().includes(q))
  })

  const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  if (!hasHRAccess) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          🔒 Only HR/admin can access the candidate CV repository.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">📄 Candidate CVs</h2>
        <p className="text-slate-500 text-sm">{candidates.length} CV(s) on file · upload → auto-detect → review → save</p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✅ {success}</div>}

      {/* Upload */}
      {!review && !editingId && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6 text-center">
          <input ref={fileInputRef} type="file" accept=".pdf,.docx" onChange={handleFileChange} className="hidden" id="cv-upload" disabled={parsing} />
          <label htmlFor="cv-upload" className={`inline-block px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition ${parsing ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
            {parsing ? (parseStatus || 'Reading resume…') : '📤 Upload CV (PDF or Word)'}
          </label>
          <p className="text-xs text-slate-400 mt-2">
            Scanned/image-only PDFs are read via on-device OCR automatically (slower — a few seconds per page).
            Runs entirely in your browser — nothing is uploaded to a third party to parse it.
            Only the extracted text + fields are saved, not the original file (see note below).
          </p>
        </div>
      )}

      {/* Review form */}
      {review && (
        <div className="bg-white rounded-2xl shadow-card border-2 border-blue-300 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800">Review detected fields — {fileName}</h3>
            <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-lg font-medium">Auto-detected — please verify</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Name *</label>
              <input className={inp} value={review.name} onChange={e => setField('name', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Current Designation / Position</label>
              <input className={inp} value={review.designation} onChange={e => setField('designation', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Mobile Number</label>
              <input className={inp} value={review.mobile} onChange={e => setField('mobile', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Email</label>
              <input className={inp} value={review.email} onChange={e => setField('email', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Experience (years)</label>
              <input className={inp} value={review.experience} onChange={e => setField('experience', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Current / Last Company</label>
              <input className={inp} value={review.company} onChange={e => setField('company', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Location</label>
              <input className={inp} value={review.location} onChange={e => setField('location', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Highest Education</label>
              <input className={inp} value={review.education} onChange={e => setField('education', e.target.value)} />
            </div>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 font-medium">View extracted résumé text ({resumeText.length.toLocaleString('en-IN')} chars)</summary>
            <pre className="mt-2 p-3 bg-slate-50 rounded-lg whitespace-pre-wrap max-h-64 overflow-y-auto text-slate-600">{resumeText}</pre>
          </details>
          <div className="flex gap-3">
            <button onClick={handleSaveCandidate} disabled={saving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
              {saving ? 'Saving…' : '💾 Save Candidate'}
            </button>
            <button onClick={handleDiscard} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Discard</button>
          </div>
        </div>
      )}

      {/* Edit saved candidate */}
      {editingId && (
        <div className="bg-white rounded-2xl shadow-card border-2 border-blue-300 p-5 space-y-4">
          <h3 className="font-bold text-slate-800">Edit Candidate Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Name *</label>
              <input className={inp} value={editForm.name} onChange={e => setEditField('name', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Current Designation / Position</label>
              <input className={inp} value={editForm.designation} onChange={e => setEditField('designation', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Mobile Number</label>
              <input className={inp} value={editForm.mobile} onChange={e => setEditField('mobile', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Email</label>
              <input className={inp} value={editForm.email} onChange={e => setEditField('email', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Experience (years)</label>
              <input className={inp} value={editForm.experience} onChange={e => setEditField('experience', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Current / Last Company</label>
              <input className={inp} value={editForm.company} onChange={e => setEditField('company', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Location</label>
              <input className={inp} value={editForm.location} onChange={e => setEditField('location', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Highest Education</label>
              <input className={inp} value={editForm.education} onChange={e => setEditField('education', e.target.value)} />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleSaveEdit} disabled={saving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
              {saving ? 'Saving…' : '💾 Save Changes'}
            </button>
            <button onClick={handleCancelEdit} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">Cancel</button>
          </div>
        </div>
      )}

      {/* Search + filters */}
      {!review && !editingId && candidates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, company, location, email, mobile…" className={inp + ' max-w-md'} />
          <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Locations</option>
            {distinctLocations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={designationFilter} onChange={e => setDesignationFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Designations</option>
            {distinctDesignations.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="number" min="0" step="0.5" value={minExperience} onChange={e => setMinExperience(e.target.value)}
            placeholder="Min experience (yrs)" className="w-40 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {(locationFilter || designationFilter || minExperience || search) && (
            <button onClick={() => { setLocationFilter(''); setDesignationFilter(''); setMinExperience(''); setSearch('') }}
              className="text-xs text-slate-500 hover:text-slate-700 self-center">✕ Clear filters</button>
          )}
        </div>
      )}

      {/* List */}
      {loading ? <div className="text-slate-400 text-sm">Loading…</div> : !review && !editingId && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Designation</th>
                <th className="text-left px-4 py-3">Contact</th>
                <th className="text-left px-4 py-3">Experience</th>
                <th className="text-left px-4 py-3">Company</th>
                <th className="text-left px-4 py-3">Location</th>
                <th className="text-left px-4 py-3">Highest Education</th>
                <th className="text-left px-4 py-3">Interview Status</th>
                <th className="text-left px-4 py-3">Uploaded</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(c => {
                const stage = currentStageLabel(c.interview)
                const outcome = c.interview?.outcome || 'pending'
                return (
                <React.Fragment key={c.id}>
                  <tr>
                    <td className="px-4 py-3 font-medium text-slate-800">{c.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.designation || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <p>{c.mobile || '—'}</p>
                      <p className="text-xs text-slate-400">{c.email || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.experience ? `${c.experience} yr(s)` : '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.company || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.location || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.education || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`text-xs px-2 py-0.5 rounded-lg font-bold ${OUTCOME_META[outcome].cls}`}>{OUTCOME_META[outcome].label}</span>
                        {stage && outcome === 'pending' && (
                          <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${STAGE_STATUS_META[stage.status].cls}`}>{stage.label}: {STAGE_STATUS_META[stage.status].label}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{c.uploadedAt ? new Date(c.uploadedAt).toLocaleDateString('en-IN') : '—'}</td>
                    <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                      <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="text-blue-600 hover:text-blue-700 font-medium">
                        {expandedId === c.id ? 'Hide' : '👁 View'}
                      </button>
                      <button onClick={() => handleOpenInterview(c)} className="text-purple-600 hover:text-purple-700 font-medium">
                        {interviewId === c.id ? 'Hide' : '🎤 Interview'}
                      </button>
                      <button onClick={() => handleStartEdit(c)} className="text-amber-600 hover:text-amber-700 font-medium">✏️ Edit</button>
                      <button onClick={() => handleDelete(c)} className="text-red-600 hover:text-red-700 font-medium">🗑️</button>
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={10} className="px-4 py-3 bg-slate-50">
                        <p className="text-xs text-slate-400 mb-1">{c.fileName} · uploaded by {c.uploadedByName || '—'}</p>
                        <pre className="text-xs text-slate-600 whitespace-pre-wrap max-h-64 overflow-y-auto">{c.resumeText}</pre>
                      </td>
                    </tr>
                  )}
                  {interviewId === c.id && (
                    <tr>
                      <td colSpan={10} className="px-4 py-3 bg-purple-50/50">
                        <div className="space-y-3">
                          <h4 className="font-bold text-slate-700 text-sm">Interview Pipeline — {c.name}</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                            {INTERVIEW_STAGES.map(s => {
                              const st = interviewDraft.stages[s.id] || { status: 'not_scheduled', date: '' }
                              return (
                                <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-2.5 space-y-1.5">
                                  <p className="text-xs font-bold text-slate-600">{s.label}</p>
                                  <select value={st.status} onChange={e => setStageField(s.id, 'status', e.target.value)}
                                    className="w-full text-xs px-2 py-1.5 border border-slate-300 rounded-lg">
                                    {STAGE_STATUSES.map(opt => <option key={opt} value={opt}>{STAGE_STATUS_META[opt].label}</option>)}
                                  </select>
                                  <input type="date" value={st.date} onChange={e => setStageField(s.id, 'date', e.target.value)}
                                    className="w-full text-xs px-2 py-1.5 border border-slate-300 rounded-lg" />
                                </div>
                              )
                            })}
                          </div>
                          <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-purple-100">
                            <span className="text-sm font-semibold text-slate-700">Final Outcome:</span>
                            {['pending', 'accepted', 'rejected'].map(o => (
                              <button key={o} type="button" onClick={() => setOutcome(o)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                                  interviewDraft.outcome === o ? OUTCOME_META[o].cls + ' border-transparent' : 'bg-white text-slate-500 border-slate-300'
                                }`}>
                                {OUTCOME_META[o].label}
                              </button>
                            ))}
                            {interviewDraft.outcome !== 'pending' && (
                              <input type="date" value={interviewDraft.outcomeDate}
                                onChange={e => setInterviewDraft(p => ({ ...p, outcomeDate: e.target.value }))}
                                className="text-xs px-2 py-1.5 border border-slate-300 rounded-lg" />
                            )}
                          </div>
                          <div className="flex gap-3">
                            <button onClick={() => handleSaveInterview(c)} disabled={saving}
                              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg transition disabled:opacity-50">
                              {saving ? 'Saving…' : '💾 Save Interview Status'}
                            </button>
                            <button onClick={() => setInterviewId(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition">Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )})}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-slate-400">No candidate CVs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
