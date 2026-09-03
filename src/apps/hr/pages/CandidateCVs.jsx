/**
 * Candidate CV repository — NOT a recruitment pipeline/ATS (that's
 * explicitly out of scope). Upload a résumé (PDF/Word), the browser
 * extracts the text and guesses six fields, a human reviews/corrects them,
 * then only the structured fields + extracted text are saved (free-plan
 * safe — no file storage, so the original file isn't kept; re-upload it
 * if you ever need the exact original document again).
 */
import React, { useState, useEffect, useRef } from 'react'
import { collection, getDocs, addDoc, deleteDoc, doc, orderBy, query } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'
import { extractTextFromFile, extractFields } from '../utils/cvParser'

const emptyReview = { name: '', mobile: '', email: '', experience: '', company: '', location: '' }

export default function CandidateCVs() {
  const { user, userProfile } = useAuth()
  const { canEdit } = usePermissions()
  const hasHRAccess = userProfile?.role === 'admin' || canEdit('HR')

  const fileInputRef = useRef(null)
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fileName, setFileName] = useState('')
  const [resumeText, setResumeText] = useState('')
  const [review, setReview] = useState(null) // null = no pending review
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
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
    setParsing(true)
    try {
      const text = await extractTextFromFile(file)
      if (!text.trim()) throw new Error('No readable text found in this file — it may be a scanned image without a text layer.')
      const fields = extractFields(text)
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
        mobile: review.mobile.trim(),
        email: review.email.trim(),
        experience: review.experience.trim(),
        company: review.company.trim(),
        location: review.location.trim(),
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

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete ${c.name}'s CV record permanently?`)) return
    try {
      await deleteDoc(doc(db, 'hr_candidates', c.id))
      setCandidates(prev => prev.filter(x => x.id !== c.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const filtered = candidates.filter(c => {
    const q = search.toLowerCase()
    if (!q) return true
    return [c.name, c.company, c.location, c.email, c.mobile].some(v => (v || '').toLowerCase().includes(q))
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
      {!review && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-6 text-center">
          <input ref={fileInputRef} type="file" accept=".pdf,.docx" onChange={handleFileChange} className="hidden" id="cv-upload" disabled={parsing} />
          <label htmlFor="cv-upload" className={`inline-block px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition ${parsing ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
            {parsing ? 'Reading resume…' : '📤 Upload CV (PDF or Word)'}
          </label>
          <p className="text-xs text-slate-400 mt-2">
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

      {/* Search */}
      {!review && candidates.length > 0 && (
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, company, location, email, mobile…" className={inp + ' max-w-md'} />
      )}

      {/* List */}
      {loading ? <div className="text-slate-400 text-sm">Loading…</div> : !review && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Contact</th>
                <th className="text-left px-4 py-3">Experience</th>
                <th className="text-left px-4 py-3">Company</th>
                <th className="text-left px-4 py-3">Location</th>
                <th className="text-left px-4 py-3">Uploaded</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(c => (
                <React.Fragment key={c.id}>
                  <tr>
                    <td className="px-4 py-3 font-medium text-slate-800">{c.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <p>{c.mobile || '—'}</p>
                      <p className="text-xs text-slate-400">{c.email || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.experience ? `${c.experience} yr(s)` : '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.company || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.location || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{c.uploadedAt ? new Date(c.uploadedAt).toLocaleDateString('en-IN') : '—'}</td>
                    <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                      <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="text-blue-600 hover:text-blue-700 font-medium">
                        {expandedId === c.id ? 'Hide' : '👁 View'}
                      </button>
                      <button onClick={() => handleDelete(c)} className="text-red-600 hover:text-red-700 font-medium">🗑️</button>
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={7} className="px-4 py-3 bg-slate-50">
                        <p className="text-xs text-slate-400 mb-1">{c.fileName} · uploaded by {c.uploadedByName || '—'}</p>
                        <pre className="text-xs text-slate-600 whitespace-pre-wrap max-h-64 overflow-y-auto">{c.resumeText}</pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">No candidate CVs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
