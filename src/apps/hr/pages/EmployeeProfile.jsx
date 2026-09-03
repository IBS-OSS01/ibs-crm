/**
 * EmployeeProfile — full KYC & document record for one employee.
 * Route: /hr/employee/:id
 * Saves KYC fields directly onto the hr_employees document.
 */
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth, usePermissions } from '../../../context/AuthContext'
import { DEFAULT_SALARY_STRUCTURE, computeGross, splitGrossIntoStructure, computeGratuity } from '../utils/payrollCalc'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const GENDERS = ['Male', 'Female', 'Other']
const EMPLOYMENT_TYPES = ['Permanent', 'Fixed-term']
const PT_STATES = ['Maharashtra', 'Karnataka', 'Tamil Nadu', 'West Bengal', 'Gujarat', 'Telangana', 'Andhra Pradesh', 'Delhi', 'Haryana', 'Uttar Pradesh', 'Other (no PT)']

const SECTIONS = [
  { id: 'identity',    label: '🪪 Identity',       icon: '🪪' },
  { id: 'salary',      label: '💰 Salary Structure', icon: '💰' },
  { id: 'insurance',   label: '🏥 Insurance',       icon: '🏥' },
  { id: 'education',   label: '🎓 Education',       icon: '🎓' },
  { id: 'employment',  label: '📄 Employment Docs', icon: '📄' },
  { id: 'bank',        label: '🏦 Bank Details',    icon: '🏦' },
  { id: 'onboarding',  label: '🚀 Onboarding',      icon: '🚀' },
  { id: 'offboarding', label: '🚪 Offboarding',     icon: '🚪' },
]

const ONBOARDING_STEPS = [
  { id: 'offerLetter',    label: 'Offer letter sent' },
  { id: 'employmentLetter', label: 'Employment / appointment letter issued' },
  { id: 'bankDetails',    label: 'Bank details collected' },
  { id: 'idVerified',     label: 'PAN / Aadhar verified' },
  { id: 'loginCreated',   label: 'App login created' },
  { id: 'assetIssued',    label: 'Asset(s) issued' },
  { id: 'induction',      label: 'Induction completed' },
]

const OFFBOARDING_STEPS = [
  { id: 'exitInterview',  label: 'Exit interview conducted' },
  { id: 'assetsReturned', label: 'Asset(s) returned' },
  { id: 'accessRevoked',  label: 'Login access revoked' },
  { id: 'fullAndFinal',   label: 'Full & final settlement processed' },
  { id: 'relievingLetter', label: 'Relieving letter issued' },
  { id: 'experienceLetter', label: 'Experience letter issued' },
]

export default function EmployeeProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const { canEdit } = usePermissions()
  // Matches firestore.rules' hasHRWriteAccess() — this page writes KYC/bank
  // fields straight onto the hr_employees doc, so the button that opens
  // editing must be gated the same way the write itself is now enforced.
  const hasHRAccess = userProfile?.role === 'admin' || canEdit('HR')

  const [emp, setEmp] = useState(null)
  const [assignedAssets, setAssignedAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState('identity')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [grossInput, setGrossInput] = useState('')
  const [savedSalaryStructure, setSavedSalaryStructure] = useState(null)

  useEffect(() => {
    // Salary lives in its own HR/admin-only collection (see firestore.rules)
    // so it can be kept confidential — a read attempt by anyone else would
    // just fail, so only even try when this viewer has HR access.
    const salaryPromise = hasHRAccess
      ? getDoc(doc(db, 'hr_salary_structures', id)).catch(() => null)
      : Promise.resolve(null)
    Promise.all([getDoc(doc(db, 'hr_employees', id)), salaryPromise]).then(([d, salSnap]) => {
      if (d.exists()) {
        const data = { id: d.id, ...d.data() }
        const salaryStructure = salSnap?.exists() ? salSnap.data().salaryStructure : null
        setEmp(data)
        setSavedSalaryStructure(salaryStructure)
        setForm(buildForm(data, salaryStructure))
      }
      setLoading(false)
    })
    // Read-only — which company assets are currently assigned to this
    // person, so the Offboarding checklist's "return assets" step isn't a
    // guessing game.
    getDocs(query(collection(db, 'hr_assets'), where('assignedToEmployeeId', '==', id)))
      .then(snap => { const a = []; snap.forEach(d => a.push({ id: d.id, ...d.data() })); setAssignedAssets(a) })
      .catch(console.error)
  }, [id, hasHRAccess])

  const buildForm = (e, salaryStructure) => ({
    // Identity
    dob:        e.dob        || '',
    gender:     e.gender     || '',
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
    employmentType:         e.employmentType         || 'Permanent',
    // Bank
    bankName:       e.bankName       || '',
    bankAccountNo:  e.bankAccountNo  || '',
    bankIfsc:       e.bankIfsc       || '',
    bankBranch:     e.bankBranch     || '',
    upiId:          e.upiId          || '',
    // Onboarding / Offboarding — auto-starts onboarding for anyone who
    // doesn't have a record yet (covers employees created before this existed).
    onboarding:  e.onboarding  || { status: 'in_progress', startedAt: e.createdAt || new Date().toISOString(), steps: {} },
    offboarding: e.offboarding || { status: 'not_started', steps: {} },
    // Salary structure — lives in hr_salary_structures, not on this
    // document (see firestore.rules); passed in separately after that
    // collection's own fetch resolves.
    salaryStructure: salaryStructure || { ...DEFAULT_SALARY_STRUCTURE },
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      // Salary goes to its own HR/admin-only collection, everything else
      // stays on hr_employees — see firestore.rules for why they're split.
      const { salaryStructure, ...employeeFields } = form
      await updateDoc(doc(db, 'hr_employees', id), { ...employeeFields, updatedAt: new Date().toISOString() })
      if (hasHRAccess) {
        await setDoc(doc(db, 'hr_salary_structures', id), {
          employeeId: id, salaryStructure, salary: computeGross(salaryStructure),
          updatedAt: new Date().toISOString(),
        }, { merge: true })
        setSavedSalaryStructure(salaryStructure)
      }
      setEmp(prev => ({ ...prev, ...employeeFields }))
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

  // Checklist for the Onboarding/Offboarding sections — toggling a step
  // records who/when, but (like every other field on this page) only
  // actually saves once "Save Changes" is clicked.
  const Checklist = ({ steps, sectionKey }) => {
    const section = form[sectionKey] || { steps: {} }
    const stepsState = section.steps || {}
    return (
      <div className="space-y-1">
        {steps.map(s => {
          const st = stepsState[s.id] || {}
          return (
            <label key={s.id}
              className={`flex items-center gap-3 p-2 rounded-lg ${editing ? 'hover:bg-slate-50 cursor-pointer' : ''}`}>
              <input type="checkbox" checked={!!st.done} disabled={!editing}
                onChange={e => {
                  const done = e.target.checked
                  setForm(p => ({
                    ...p,
                    [sectionKey]: {
                      ...(p[sectionKey] || {}),
                      steps: { ...(p[sectionKey]?.steps || {}), [s.id]: { done, doneAt: done ? new Date().toISOString() : null } },
                    },
                  }))
                }}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 disabled:opacity-70" />
              <span className={`text-sm flex-1 ${st.done ? 'text-slate-800' : 'text-slate-600'}`}>{s.label}</span>
              {st.done && st.doneAt && (
                <span className="text-xs text-slate-400">{new Date(st.doneAt).toLocaleDateString('en-IN')}</span>
              )}
            </label>
          )
        })}
      </div>
    )
  }

  const markSectionStatus = (sectionKey, status) => {
    setForm(p => ({ ...p, [sectionKey]: { ...(p[sectionKey] || {}), status, completedAt: status === 'completed' ? new Date().toISOString() : null } }))
  }

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
              <button onClick={() => { setEditing(false); setForm(buildForm(emp, savedSalaryStructure)) }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition">
                Cancel
              </button>
            </>
          ) : hasHRAccess ? (
            <button onClick={() => setEditing(true)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition">
              ✏️ Edit Profile
            </button>
          ) : null}
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>}

      {/* Section tabs — Salary Structure hidden entirely from anyone without
          HR access (not just gated on click); the real enforcement is the
          hr_salary_structures Firestore rule, this just keeps a view-only
          HR user from seeing an empty/broken tab for data they can't fetch. */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
        {SECTIONS.filter(s => s.id !== 'salary' || hasHRAccess).map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              activeSection === s.id ? 'bg-white text-blue-700 shadow' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {s.icon} {s.label.replace(/^\S+\s/, '')}
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
              <F label="Gender" value={emp.gender} editKey="gender" options={GENDERS} />
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

        {/* ── Salary Structure ── */}
        {activeSection === 'salary' && hasHRAccess && (() => {
          const ss = form.salaryStructure || DEFAULT_SALARY_STRUCTURE
          const setSS = (k, v) => setForm(p => ({ ...p, salaryStructure: { ...(p.salaryStructure || DEFAULT_SALARY_STRUCTURE), [k]: v } }))
          const gross = computeGross(ss)
          const SF = ({ label, k }) => (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label} (₹/month)</label>
              {editing ? (
                <input type="number" min="0" value={ss[k] ?? 0} onChange={e => setSS(k, Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              ) : (
                <p className="text-sm text-slate-800 py-1">₹{(Number(ss[k]) || 0).toLocaleString('en-IN')}</p>
              )}
            </div>
          )
          const applyAutoSplit = () => {
            const g = Number(grossInput)
            if (!g || g <= 0) return
            setForm(p => ({ ...p, salaryStructure: splitGrossIntoStructure(g, p.salaryStructure) }))
          }
          const gratuity = computeGratuity({
            basicPlusDA: (Number(ss.basic) || 0) + (Number(ss.dearnessAllowance) || 0),
            joinDate: emp.joinDate,
            asOfDate: new Date(),
            employmentType: (form.employmentType || 'Permanent').toLowerCase() === 'fixed-term' ? 'fixed-term' : 'permanent',
          })
          return (
            <div className="space-y-5">
              {editing && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <label className="block text-xs font-semibold text-amber-800 uppercase tracking-wide mb-1">
                    ⚡ Auto-calculate from Monthly Gross
                  </label>
                  <div className="flex gap-2 items-center">
                    <input type="number" min="0" value={grossInput} onChange={e => setGrossInput(e.target.value)}
                      placeholder={`current: ₹${gross.toLocaleString('en-IN')}`}
                      className="w-40 px-3 py-2 border border-amber-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    <button type="button" onClick={applyAutoSplit}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-xl transition">
                      Apply Standard Split
                    </button>
                  </div>
                  <p className="text-xs text-amber-700 mt-1.5">
                    Enter one monthly gross figure — fills Basic 50% / HRA 25% / Conveyance ₹1,600 / Medical ₹1,250 / Special Allowance (balance)
                    below automatically. Each field stays editable afterward if you need to hand-adjust anything.
                  </p>
                </div>
              )}
              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2">Monthly Earnings Breakup</h3>
              <div className="grid grid-cols-2 gap-4">
                <SF label="Basic" k="basic" />
                <SF label="Dearness Allowance (DA)" k="dearnessAllowance" />
                <SF label="HRA" k="hra" />
                <SF label="Conveyance" k="conveyance" />
                <SF label="Medical" k="medical" />
                <SF label="Special Allowance" k="specialAllowance" />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-blue-800">Gross Monthly (CTC basis)</span>
                <span className="text-lg font-bold text-blue-800">₹{gross.toLocaleString('en-IN')}</span>
              </div>
              <p className="text-xs text-slate-400">
                Basic + DA is the "statutory wage" the Code on Wages 2019 uses for PF/gratuity — if it works out below 50% of
                gross, the app automatically treats the wage base as 50% of gross for those calculations (you don't need to
                adjust anything here for that; it happens on the Salary page).
              </p>

              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2 pt-2">Statutory Deductions</h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={ss.pfApplicable !== false} disabled={!editing}
                    onChange={e => setSS('pfApplicable', e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                  <span className="text-sm text-slate-700">PF applicable (12% of Basic+DA, capped ₹15,000 wage)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={ss.esiApplicable !== false} disabled={!editing}
                    onChange={e => setSS('esiApplicable', e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                  <span className="text-sm text-slate-700">ESI applicable (0.75% of gross, while gross ≤ ₹21,000)</span>
                </label>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Professional Tax State</label>
                  {editing ? (
                    <select value={ss.professionalTaxState || 'Maharashtra'} onChange={e => setSS('professionalTaxState', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      {PT_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  ) : (
                    <p className="text-sm text-slate-800 py-1">{ss.professionalTaxState || 'Maharashtra'}</p>
                  )}
                </div>
              </div>
              {(ss.professionalTaxState || 'Maharashtra') === 'Maharashtra' && (
                <p className="text-xs text-slate-400">
                  Maharashtra is the one state with a gender-based PT slab (women exempt up to ₹25,000/month) — set Gender on the
                  Identity tab so this is applied correctly.
                </p>
              )}

              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2 pt-2">Income Tax (TDS) Regime</h3>
              <div className="flex gap-2">
                {['new', 'old'].map(r => (
                  <button key={r} type="button" disabled={!editing} onClick={() => setSS('taxRegime', r)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium border transition ${
                      (ss.taxRegime || 'new') === r ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300'
                    } ${!editing ? 'cursor-default' : ''}`}>
                    {r === 'new' ? 'New Regime (default)' : 'Old Regime'}
                  </button>
                ))}
              </div>
              {(ss.taxRegime || 'new') === 'old' && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3">
                  <p className="text-xs text-slate-500">Old-regime declarations — used only for this employee's monthly TDS estimate on the Salary page.</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Annual Rent Paid (₹)</label>
                      {editing ? (
                        <input type="number" min="0" value={ss.declaredRentPaidAnnual ?? 0} onChange={e => setSS('declaredRentPaidAnnual', Number(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm" />
                      ) : <p className="text-sm text-slate-800 py-1">₹{(Number(ss.declaredRentPaidAnnual) || 0).toLocaleString('en-IN')}</p>}
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={!!ss.isMetroCity} disabled={!editing}
                          onChange={e => setSS('isMetroCity', e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                        <span className="text-sm text-slate-700">Metro city (Mumbai/Delhi/Kolkata/Chennai) — 50% HRA exemption vs 40%</span>
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Declared 80C (₹/year, cap 1,50,000)</label>
                      {editing ? (
                        <input type="number" min="0" max="150000" value={ss.declared80C ?? 0} onChange={e => setSS('declared80C', Number(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm" />
                      ) : <p className="text-sm text-slate-800 py-1">₹{(Number(ss.declared80C) || 0).toLocaleString('en-IN')}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Declared 80D (₹/year, cap 25,000)</label>
                      {editing ? (
                        <input type="number" min="0" max="25000" value={ss.declared80D ?? 0} onChange={e => setSS('declared80D', Number(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm" />
                      ) : <p className="text-sm text-slate-800 py-1">₹{(Number(ss.declared80D) || 0).toLocaleString('en-IN')}</p>}
                    </div>
                  </div>
                </div>
              )}

              <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2 pt-2">Gratuity (accrual estimate)</h3>
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-purple-600 uppercase font-semibold">Completed Service</p><p className="font-bold text-purple-900">{gratuity.years} yr(s)</p></div>
                <div><p className="text-xs text-purple-600 uppercase font-semibold">Eligible ({gratuity.minYears}+ yrs)</p><p className="font-bold text-purple-900">{gratuity.eligible ? 'Yes' : 'Not yet'}</p></div>
                <div><p className="text-xs text-purple-600 uppercase font-semibold">Accrued Amount</p><p className="font-bold text-purple-900">₹{gratuity.amount.toLocaleString('en-IN')}</p></div>
              </div>
              <p className="text-xs text-slate-400">
                15 days' wages (Basic+DA) per completed year of service ÷ 26 — payable on separation, not a monthly deduction.
                Fixed-term employees qualify after 1 year (pro-rata); permanent employees after 5 years, per the Code on Social
                Security. This is an estimate for planning purposes, not a substitute for your final settlement calculation.
              </p>
            </div>
          )
        })()}

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
              <F label="Employment Type" value={emp.employmentType} editKey="employmentType" options={EMPLOYMENT_TYPES} />
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

        {/* ── Onboarding ── */}
        {activeSection === 'onboarding' && (() => {
          const onb = emp.onboarding || { status: 'in_progress', steps: {} }
          const doneCount = ONBOARDING_STEPS.filter(s => onb.steps?.[s.id]?.done).length
          return (
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">Onboarding Checklist</h3>
                {onb.status === 'completed' ? (
                  <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
                    ✓ Completed {onb.completedAt ? new Date(onb.completedAt).toLocaleDateString('en-IN') : ''}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full font-medium">{doneCount} / {ONBOARDING_STEPS.length} done</span>
                )}
              </div>
              <Checklist steps={ONBOARDING_STEPS} sectionKey="onboarding" />
              {editing && form.onboarding?.status !== 'completed' && (
                <button type="button" onClick={() => markSectionStatus('onboarding', 'completed')}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition">
                  ✓ Mark Onboarding Complete
                </button>
              )}
            </div>
          )
        })()}

        {/* ── Offboarding ── */}
        {activeSection === 'offboarding' && (() => {
          const offb = emp.offboarding || { status: 'not_started', steps: {} }
          const doneCount = OFFBOARDING_STEPS.filter(s => offb.steps?.[s.id]?.done).length
          if (offb.status === 'not_started') {
            return (
              <div className="space-y-3">
                <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide border-b pb-2">Offboarding</h3>
                <p className="text-sm text-slate-400">
                  Not initiated. Start this from HR → Employees → "🚪 Initiate Offboarding" on this person's row —
                  that's where the last working day and reason are recorded.
                </p>
              </div>
            )
          }
          return (
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">Offboarding Checklist</h3>
                {offb.status === 'completed' ? (
                  <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
                    ✓ Completed {offb.completedAt ? new Date(offb.completedAt).toLocaleDateString('en-IN') : ''}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">{doneCount} / {OFFBOARDING_STEPS.length} done</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Last Working Day</p>
                  <p className="text-slate-800">{offb.lastWorkingDay || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Reason</p>
                  <p className="text-slate-800">{offb.reason || '—'}</p>
                </div>
              </div>
              {assignedAssets.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
                  <p className="font-semibold text-amber-800 mb-1">⚠️ {assignedAssets.length} asset(s) still assigned — return via HR → Assets before checking off "Asset(s) returned":</p>
                  <ul className="list-disc list-inside text-amber-700 text-xs space-y-0.5">
                    {assignedAssets.map(a => <li key={a.id}>{a.name} ({a.assetTag})</li>)}
                  </ul>
                </div>
              )}
              <Checklist steps={OFFBOARDING_STEPS} sectionKey="offboarding" />
              {editing && form.offboarding?.status !== 'completed' && (
                <button type="button" onClick={() => markSectionStatus('offboarding', 'completed')}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition">
                  ✓ Mark Offboarding Complete
                </button>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
