/**
 * EmployeeProfile — full KYC & document record for one employee.
 * Route: /hr/employee/:id
 * Saves KYC fields directly onto the hr_employees document.
 */
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

const SECTIONS = [
  { id: 'identity',   label: '🪪 Identity',       icon: '🪪' },
  { id: 'insurance',  label: '🏥 Insurance',       icon: '🏥' },
  { id: 'education',  label: '🎓 Education',       icon: '🎓' },
  { id: 'employment', label: '📄 Employment Docs', icon: '📄' },
  { id: 'bank',       label: '🏦 Bank Details',    icon: '🏦' },
]

export default function EmployeeProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const isAdmin = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)

  const [emp, setEmp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState('identity')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getDoc(doc(db, 'hr_employees', id)).then(d => {
      if (d.exists()) {
        const data = { id: d.id, ...d.data() }
        setEmp(data)
        setForm(buildForm(data))
      }
      setLoading(false)
    })
  }, [id])

  const buildForm = (e) => ({
    // Identity
    dob:        e.dob        || '',
    bloodGroup: e.bloodGroup || '',
    panNumber:  e.panNumber  || '',
    aadharNumber: e.aadharNumber || '',
    panVerified:    e.panVerified    || false,
    aadharVerified: e.aadharVerified || false,
    // Insurance
    insuranceProvider:  e.insuranceProvider  || '',
    insurancePolicyNo:  e.insurancePolicyNo  || '',
    insuranceSumInsured: e.insuranceSumInsured || '',
    insuranceExpiry:    e.insuranceExpiry    || '',
    insuranceNominee:   e.insuranceNominee   || '',
    // Education
    highestQualification: e.highestQualification || '',
    institution:          e.institution          || '',
    passingYear:          e.passingYear          || '',
    educationDocNote:     e.educationDocNote     || '',
    // Employment
    employmentLetterDate:   e.employmentLetterDate   || '',
    employmentLetterIssuedBy: e.employmentLetterIssuedBy || '',
    offerLetterDate:        e.offerLetterDate        || '',
    relievingLetterDate:    e.relievingLetterDate    || '',
    pfAccountNo:            e.pfAccountNo            || '',
    esiNo:                  e.esiNo                  || '',
    // Bank
    bankName:       e.bankName       || '',
    bankAccountNo:  e.bankAccountNo  || '',
    bankIfsc:       e.bankIfsc       || '',
    bankBranch:     e.bankBranch     || '',
    upiId:          e.upiId          || '',
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      await updateDoc(doc(db, 'hr_employees', id), { ...form, updatedAt: new Date().toISOString() })
      setEmp(prev => ({ ...prev, ...form }))
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) { setError('Save failed: ' + err.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading…</div>
  if (!emp)    return <div className="flex items-center justify-center h-64 text-slate-400">Employee not found.</div>

  const F = ({ label, value, editKey, type = 'text', options }) => (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      {editing ? (
        options ? (
          <select value={form[editKey] || ''} onChange={e => set(editKey, e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">— Select —</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : type === 'checkbox' ? (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!form[editKey]} onChange={e => set(editKey, e.target.checked)}
              className="w-4 h-4 rounded-lg border-slate-300 text-blue-600" />
            <span className="text-sm text-slate-700">Verified</span>
          </label>
        ) : (
          <input type={type} value={form[editKey] || ''} onChange={e => set(editKey, e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        )
      ) : (
        <p className="text-sm text-slate-800 py-1">
          {type === 'checkbox'
            ? (value ? <span className="text-green-600 font-semibold">✓ Verified</span> : <span className="text-slate-400">Not verified</span>)
            : value || <span className="text-slate-400">—</span>
          }
        </p>
      )}
    </div>
  )

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/hr/employees')}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-xl transition">
            ← Back
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">{emp.name}</h2>
            <p className="text-sm text-slate-500">{emp.designation || '—'} · {emp.department || '—'} · Joined {emp.joinDate || '—'}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {saved && <span className="text-xs text-green-600 font-semibold self-center">✓ Saved</span>}
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => { setEditing(false); setForm(buildForm(emp)) }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition">
              ✏️ Edit Profile
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>}

      {/* Section tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              activeSection === s.id ? 'bg-white text-blue-700 shadow' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {s.icon} {s.label.replace(/^. /, '')}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5">
        {/* ── Identity ── */}
        {activeSection === 'identity' && (
          <div className="space-y-5">
            <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2">Identity Documents</h3>
            <div className="grid grid-cols-2 gap-4">
              <F label="Date of Birth" value={emp.dob} editKey="dob" type="date" />
              <F label="Blood Group" value={emp.bloodGroup} editKey="bloodGroup" options={BLOOD_GROUPS} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <F label="PAN Number" value={emp.panNumber} editKey="panNumber" />
                <F label="PAN Verified" value={emp.panVerified} editKey="panVerified" type="checkbox" />
              </div>
              <div className="space-y-2">
                <F label="Aadhar Number" value={emp.aadharNumber} editKey="aadharNumber" />
                <F label="Aadhar Verified" value={emp.aadharVerified} editKey="aadharVerified" type="checkbox" />
              </div>
            </div>
            {!editing && (emp.panVerified || emp.aadharVerified) && (
              <div className="flex gap-2 flex-wrap">
                {emp.panVerified    && <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">✓ PAN Verified</span>}
                {emp.aadharVerified && <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">✓ Aadhar Verified</span>}
              </div>
            )}
          </div>
        )}

        {/* ── Insurance ── */}
        {activeSection === 'insurance' && (
          <div className="space-y-5">
            <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2">Health / Life Insurance</h3>
            <div className="grid grid-cols-2 gap-4">
              <F label="Insurance Provider" value={emp.insuranceProvider} editKey="insuranceProvider" />
              <F label="Policy Number" value={emp.insurancePolicyNo} editKey="insurancePolicyNo" />
              <F label="Sum Insured (₹)" value={emp.insuranceSumInsured ? `₹${Number(emp.insuranceSumInsured).toLocaleString('en-IN')}` : null} editKey="insuranceSumInsured" type="number" />
              <F label="Policy Expiry" value={emp.insuranceExpiry} editKey="insuranceExpiry" type="date" />
              <F label="Nominee Name" value={emp.insuranceNominee} editKey="insuranceNominee" />
            </div>
          </div>
        )}

        {/* ── Education ── */}
        {activeSection === 'education' && (
          <div className="space-y-5">
            <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2">Education & Qualifications</h3>
            <div className="grid grid-cols-2 gap-4">
              <F label="Highest Qualification" value={emp.highestQualification} editKey="highestQualification" />
              <F label="Institution / University" value={emp.institution} editKey="institution" />
              <F label="Passing Year" value={emp.passingYear} editKey="passingYear" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Document Status / Notes</label>
              {editing ? (
                <textarea rows={3} value={form.educationDocNote || ''} onChange={e => set('educationDocNote', e.target.value)}
                  placeholder="e.g. 10th — submitted, 12th — submitted, Degree — pending original…"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              ) : (
                <p className="text-sm text-slate-800 whitespace-pre-line">{emp.educationDocNote || <span className="text-slate-400">—</span>}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Employment Docs ── */}
        {activeSection === 'employment' && (
          <div className="space-y-5">
            <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2">Employment Documents</h3>
            <div className="grid grid-cols-2 gap-4">
              <F label="Offer Letter Date" value={emp.offerLetterDate} editKey="offerLetterDate" type="date" />
              <F label="Employment Letter Date" value={emp.employmentLetterDate} editKey="employmentLetterDate" type="date" />
              <F label="Employment Letter Issued By" value={emp.employmentLetterIssuedBy} editKey="employmentLetterIssuedBy" />
              <F label="Relieving Letter Date" value={emp.relievingLetterDate} editKey="relievingLetterDate" type="date" />
              <F label="PF Account No." value={emp.pfAccountNo} editKey="pfAccountNo" />
              <F label="ESI No." value={emp.esiNo} editKey="esiNo" />
            </div>
          </div>
        )}

        {/* ── Bank Details ── */}
        {activeSection === 'bank' && (
          <div className="space-y-5">
            <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2">Bank & Payment Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <F label="Bank Name" value={emp.bankName} editKey="bankName" />
              <F label="Account Number" value={emp.bankAccountNo} editKey="bankAccountNo" />
              <F label="IFSC Code" value={emp.bankIfsc} editKey="bankIfsc" />
              <F label="Branch" value={emp.bankBranch} editKey="bankBranch" />
              <F label="UPI ID" value={emp.upiId} editKey="upiId" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
