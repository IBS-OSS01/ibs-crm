import React, { useState, useRef } from 'react'
import { collection, addDoc, doc, updateDoc } from '../../../lib/cachedFirestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { downloadXlsxTemplate, parseXlsxFile } from '../../../lib/xlsxTemplate'

// Columns must match the downloadable template exactly (order + labels).
const TEMPLATE_HEADERS = ['Name', 'Mobile Number', 'Email', 'Address', 'Pincode']
const TEMPLATE_EXAMPLE = ['Sharma Trading Co.', '9876543210', 'shop@example.com', '12 MG Road, Pune', '411001']

export function downloadCustomersTemplate() {
  downloadXlsxTemplate('customers-template.xlsx', TEMPLATE_HEADERS, [TEMPLATE_EXAMPLE])
}

// Map a raw sheet header to one of our known fields, tolerant of case/spacing.
const FIELD_ALIASES = {
  name: ['name', 'customer name', 'shop name'],
  mobile: ['mobile number', 'mobile', 'phone', 'phone number', 'contact number'],
  email: ['email', 'email address', 'e-mail'],
  address: ['address', 'street address'],
  pincode: ['pincode', 'pin code', 'pin', 'postal code', 'zip'],
}

function mapRow(row, headers) {
  const findVal = (key) => {
    const alias = FIELD_ALIASES[key].find(a => headers.some(h => h.toLowerCase().trim() === a))
    const header = headers.find(h => h.toLowerCase().trim() === alias)
    return header ? row[header] : ''
  }
  return {
    name: findVal('name'),
    mobile: findVal('mobile'),
    email: findVal('email'),
    address: findVal('address'),
    pincode: findVal('pincode'),
  }
}

// India mobile numbers: 10 digits, optionally with a leading +91/91/0.
function normalizeMobile(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits // leave as-is (validated separately) so the preview can still flag it
}

export default function CustomerImportModal({ existingCustomers, defaultCompany, onClose, onImported }) {
  const { user } = useAuth()
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null) // { headers, rows }
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null) // { created, updated, skipped, errors }
  const fileRef = useRef()

  const handleFile = async (e) => {
    const f = e.target.files[0]; if (!f) return
    setFileName(f.name)
    setResult(null)
    setParseError('')
    try {
      const p = await parseXlsxFile(f)
      setParsed(p)
    } catch (err) {
      setParsed(null)
      setParseError('Could not read that file. Make sure it\'s a valid .xlsx/.xls exported from the template.')
    }
  }

  const preview = parsed ? parsed.rows.slice(0, 8).map(r => mapRow(r, parsed.headers)) : []

  const existingByMobile = new Map(
    existingCustomers.filter(c => c.phone).map(c => [normalizeMobile(c.phone), c])
  )

  const isValidRow = (m) => {
    const mobile = normalizeMobile(m.mobile)
    return !!m.name?.trim() && mobile.length === 10
  }

  const handleImport = async () => {
    if (!parsed?.rows?.length) return
    setImporting(true); setResult(null)
    let created = 0, updated = 0, skipped = 0, errors = 0

    for (const raw of parsed.rows) {
      const mapped = mapRow(raw, parsed.headers)
      const name = mapped.name?.trim()
      const mobile = normalizeMobile(mapped.mobile)
      if (!name || mobile.length !== 10) { skipped++; continue }
      const payload = {
        shopName: name,
        phone: mobile,
        email: mapped.email?.trim() || '',
        address: mapped.address?.trim() || '',
        pincode: mapped.pincode?.trim() || '',
      }
      try {
        const match = existingByMobile.get(mobile)
        if (match) {
          await updateDoc(doc(db, 'crm_customers', match.id), {
            ...payload, updatedAt: new Date().toISOString(),
          })
          updated++
        } else {
          const newCust = {
            ...payload, ownerName: '', area: '', city: '', state: '', gstin: '', pan: '',
            creditLimit: 0, active: true, companies: [defaultCompany], company: defaultCompany,
            createdBy: user.uid, createdAt: new Date().toISOString(),
          }
          await addDoc(collection(db, 'crm_customers'), newCust)
          existingByMobile.set(mobile, { id: 'pending', phone: mobile }) // avoid double-creating duplicate rows in same file
          created++
        }
      } catch (e) { errors++; console.error(e) }
    }
    setResult({ created, updated, skipped, errors })
    setImporting(false)
    if (created > 0 || updated > 0) onImported?.()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">📊 Import Customers from Excel</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              A customer with a matching mobile number is updated — a new mobile number creates a new customer.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Step 1: get the template */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex items-center justify-between gap-3">
            <div>
              <p className="font-bold mb-0.5">1. Download the Excel template</p>
              <p>Columns: Name, Mobile Number, Email (optional), Address, Pincode — one row per customer.</p>
            </div>
            <button onClick={downloadCustomersTemplate}
              className="px-3 py-1.5 bg-white border border-blue-300 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-100 transition whitespace-nowrap">
              ⬇ Download Template (.xlsx)
            </button>
          </div>

          {/* Step 2: upload */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">2. Upload the filled-in file</p>
            <button onClick={() => fileRef.current?.click()}
              className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition">
              📁 {fileName || 'Upload Excel file (.xlsx, .xls)'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            {parseError && <p className="text-xs text-red-600 mt-2">{parseError}</p>}
          </div>

          {/* Preview + import */}
          {parsed && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-slate-700">{parsed.rows.length} rows detected · Preview (first 8):</p>
                {result ? (
                  <div className="flex gap-3 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-50 text-green-700">
                    <span>➕ {result.created} added</span>
                    <span>🔁 {result.updated} updated</span>
                    {result.skipped > 0 && <span className="text-slate-500">⏭ {result.skipped} skipped</span>}
                    {result.errors > 0 && <span className="text-red-600">❌ {result.errors} errors</span>}
                  </div>
                ) : (
                  <button onClick={handleImport} disabled={importing}
                    className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50">
                    {importing ? 'Importing…' : `⬆ Import ${parsed.rows.length} Rows`}
                  </button>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">Name</th>
                      <th className="text-left px-3 py-2">Mobile</th>
                      <th className="text-left px-3 py-2">Email</th>
                      <th className="text-left px-3 py-2">Address</th>
                      <th className="text-left px-3 py-2">Pincode</th>
                      <th className="text-left px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((row, i) => {
                      const mobile = normalizeMobile(row.mobile)
                      const valid = isValidRow(row)
                      const willUpdate = valid && existingByMobile.has(mobile)
                      return (
                        <tr key={i} className={!valid ? 'opacity-40 line-through' : ''}>
                          <td className="px-3 py-2 text-slate-700">{row.name || '—'}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{mobile || row.mobile || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{row.email || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{row.address || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{row.pincode || '—'}</td>
                          <td className="px-3 py-2">
                            {!valid ? <span className="text-slate-400">skip</span>
                              : willUpdate ? <span className="text-blue-600 font-medium">update</span>
                              : <span className="text-green-600 font-medium">new</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Rows are matched to existing customers by mobile number (10 digits, any +91/91/0 prefix is stripped automatically).
                A matching number updates that customer; a new number creates one. Rows missing a Name or a valid 10-digit mobile number are skipped.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
