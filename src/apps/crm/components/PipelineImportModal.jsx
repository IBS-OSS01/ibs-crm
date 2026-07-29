import React, { useState, useRef } from 'react'
import { collection, addDoc, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

// ── Stage normaliser ─────────────────────────────────────────────────────────
const normaliseStage = (raw = '') => {
  const s = raw.toLowerCase().trim()
  if (s.includes('won') || s.includes('closed won') || s.includes('success')) return 'won'
  if (s.includes('reject')) return 'rejected'
  if (s.includes('lost') || s.includes('closed lost') || s.includes('dead')) return 'lost'
  if (s.includes('no bid') || s.includes('nobid')) return 'nobid'
  if (s.includes('hold') || s.includes('pause') || s.includes('on hold')) return 'hold'
  if (s.includes('closing') || s.includes('negot') || s.includes('quoted') || s.includes('order')) return 'closing'
  if (s.includes('bid') || s.includes('proposal') || s.includes('propos') || s.includes('quote')) return 'bid'
  if (s.includes('pre') || s.includes('contact') || s.includes('discuss') || s.includes('meeting')) return 'prebid'
  return 'lead'
}

// ── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').trim())
  const rows = lines.slice(1).map(line => {
    // Handle quoted fields with commas
    const vals = []; let cur = ''; let inQ = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ }
      else if (line[i] === ',' && !inQ) { vals.push(cur.trim()); cur = '' }
      else cur += line[i]
    }
    vals.push(cur.trim())
    const row = {}
    headers.forEach((h, i) => { row[h] = (vals[i] || '').replace(/^"|"$/g, '').trim() })
    return row
  }).filter(r => Object.values(r).some(v => v))
  return { headers, rows }
}

// ── Auto-detect column mapping ───────────────────────────────────────────────
function autoMap(headers, fieldDefs) {
  const map = {}
  fieldDefs.forEach(({ key, aliases }) => {
    const match = headers.find(h => {
      const lh = h.toLowerCase()
      return aliases.some(a => lh.includes(a.toLowerCase()))
    })
    map[key] = match || ''
  })
  return map
}

// ── Field definitions per import type ────────────────────────────────────────
const DEAL_FIELDS = [
  { key: 'title',          label: 'Opportunity Title *', aliases: ['title', 'name', 'opportunity', 'opportunity', 'subject', 'description'] },
  { key: 'customerName',   label: 'Customer Name',       aliases: ['customer', 'client', 'company', 'account'] },
  { key: 'stage',          label: 'Stage',               aliases: ['stage', 'status', 'phase', 'pipeline'] },
  { key: 'value',          label: 'Value (₹)',           aliases: ['value', 'amount', 'revenue', 'price', '₹', 'inr', 'budget'] },
  { key: 'company',        label: 'Company (UIPL/Wayzim)', aliases: ['company', 'entity', 'brand'] },
  { key: 'salesManager',   label: 'Sales Manager',       aliases: ['sales', 'assigned', 'owner', 'manager', 'person', 'rep'] },
  { key: 'identifiedDate', label: 'Identified Date',     aliases: ['identified', 'created', 'start', 'date', 'from'] },
  { key: 'closingDate',    label: 'Expected Close Date', aliases: ['close', 'closing', 'expected', 'target', 'end', 'due'] },
  { key: 'notes',          label: 'Notes',               aliases: ['notes', 'comment', 'remark', 'description', 'detail'] },
  { key: 'siteName',       label: 'Site / Location',     aliases: ['site', 'location', 'plant', 'project', 'place'] },
]

const CUSTOMER_FIELDS = [
  { key: 'shopName',    label: 'Company Name *',  aliases: ['company', 'client', 'customer', 'account', 'name', 'shop'] },
  { key: 'ownerName',   label: 'Contact Person',  aliases: ['contact', 'owner', 'person', 'poc', 'name'] },
  { key: 'phone',       label: 'Phone',           aliases: ['phone', 'mobile', 'contact no', 'number', 'cell'] },
  { key: 'email',       label: 'Email',           aliases: ['email', 'mail'] },
  { key: 'area',        label: 'Region / Area',   aliases: ['region', 'area', 'zone', 'territory', 'city', 'location'] },
  { key: 'address',     label: 'Address',         aliases: ['address', 'street', 'addr'] },
  { key: 'city',        label: 'City',            aliases: ['city', 'town', 'district'] },
  { key: 'state',       label: 'State',           aliases: ['state', 'province'] },
  { key: 'gstin',       label: 'GSTIN',           aliases: ['gst', 'gstin', 'gst no', 'gstin number'] },
  { key: 'company',     label: 'Entity (UIPL/Wayzim)', aliases: ['entity', 'brand', 'company'] },
]

const SITE_FIELDS = [
  { key: 'siteName',     label: 'Site Name *',      aliases: ['site', 'name', 'location', 'plant', 'place', 'title'] },
  { key: 'customerName', label: 'Customer Name',    aliases: ['customer', 'client', 'company', 'account'] },
  { key: 'address',      label: 'Address',          aliases: ['address', 'addr', 'location', 'street'] },
  { key: 'city',         label: 'City',             aliases: ['city', 'town'] },
  { key: 'state',        label: 'State',            aliases: ['state', 'province'] },
  { key: 'status',       label: 'Status',           aliases: ['status', 'phase', 'stage'] },
  { key: 'contactName',  label: 'Site Contact',     aliases: ['contact', 'person', 'poc', 'engineer'] },
  { key: 'contactPhone', label: 'Contact Phone',    aliases: ['phone', 'mobile', 'number'] },
  { key: 'notes',        label: 'Notes',            aliases: ['notes', 'remark', 'comment'] },
  { key: 'company',      label: 'Entity (UIPL/Wayzim)', aliases: ['entity', 'brand', 'company'] },
]

const TYPES = {
  deals:     { label: 'Pipeline / Opportunities', fields: DEAL_FIELDS,     collection: 'crm_deals',     color: 'blue' },
  customers: { label: 'Customers',               fields: CUSTOMER_FIELDS,  collection: 'crm_customers', color: 'green' },
  sites:     { label: 'Customer Sites',          fields: SITE_FIELDS,      collection: 'crm_sites',     color: 'orange' },
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function PipelineImportModal({ onClose, onImported }) {
  const { user } = useAuth()
  const [tab, setTab] = useState('opportunities')
  const [csvText, setCsvText] = useState('')
  const [parsed, setParsed] = useState(null)  // { headers, rows }
  const [mapping, setMapping] = useState({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)  // { imported, skipped, errors }
  const fileRef = useRef()

  const type = TYPES[tab]

  const handleParse = (text) => {
    const p = parseCSV(text)
    setParsed(p)
    setMapping(autoMap(p.headers, type.fields))
    setResult(null)
  }

  const handleFile = (e) => {
    const f = e.target.files[0]; if (!f) return
    const reader = new FileReader()
    reader.onload = ev => { setCsvText(ev.target.result); handleParse(ev.target.result) }
    reader.readAsText(f)
  }

  const handleTextChange = (text) => {
    setCsvText(text)
    if (text.includes(',') && text.includes('\n')) handleParse(text)
  }

  const handleTabChange = (t) => {
    setTab(t); setCsvText(''); setParsed(null); setMapping({}); setResult(null)
  }

  const mapRow = (row) => {
    const get = key => (mapping[key] && row[mapping[key]]) || ''
    if (tab === 'opportunities') {
      return {
        title:          get('title'),
        customerName:   get('customerName'),
        stage:          normaliseStage(get('stage')),
        value:          Number(get('value').replace(/[^0-9.]/g, '')) || 0,
        company:        (['UIPL','Wayzim'].includes(get('company')) ? get('company') : 'UIPL'),
        salesManagerName: get('salesManager'),
        salesManagerId: '',
        teamMembers:    [],
        assignedUserIds:[],
        identifiedDate: get('identifiedDate'),
        closingDate:    get('closingDate'),
        notes:          get('notes'),
        siteName:       get('siteName'),
        siteId:         '',
        warehouseId:    '',
        warehouseName:  '',
        customerId:     '',
        meetingNotes:   [],
      }
    }
    if (tab === 'customers') {
      return {
        shopName:   get('shopName'),
        ownerName:  get('ownerName'),
        phone:      get('phone'),
        email:      get('email') || '',
        area:       get('area'),
        address:    get('address'),
        city:       get('city'),
        state:      get('state'),
        gstin:      get('gstin'),
        pan:        '',
        creditLimit: 0,
        active:     true,
        company:    (['UIPL','Wayzim'].includes(get('company')) ? get('company') : 'UIPL'),
        companies:  [(['UIPL','Wayzim'].includes(get('company')) ? get('company') : 'UIPL')],
      }
    }
    if (tab === 'sites') {
      const rawStatus = get('status').toLowerCase()
      const status = rawStatus.includes('service') ? 'service'
                   : rawStatus.includes('project') ? 'project'
                   : 'lead'
      return {
        siteName:     get('siteName'),
        customerName: get('customerName'),
        customerId:   '',
        address:      get('address'),
        city:         get('city'),
        state:        get('state'),
        status,
        contactName:  get('contactName'),
        contactPhone: get('contactPhone'),
        notes:        get('notes'),
        company:      (['UIPL','Wayzim'].includes(get('company')) ? get('company') : 'UIPL'),
      }
    }
  }

  const preview = parsed?.rows.slice(0, 5).map(mapRow) || []
  const requiredKey = tab === 'opportunities' ? 'title' : tab === 'customers' ? 'shopName' : 'siteName'

  const handleImport = async () => {
    if (!parsed?.rows?.length) return
    setImporting(true); setResult(null)
    let imported = 0, skipped = 0, errors = 0

    // Load existing records to deduplicate by name
    const existingSnap = await getDocs(collection(db, type.collection))
    const existingNames = new Set()
    existingSnap.forEach(d => {
      const name = d.data().title || d.data().shopName || d.data().siteName || ''
      existingNames.add(name.toLowerCase().trim())
    })

    for (const row of parsed.rows) {
      try {
        const mapped = mapRow(row)
        const nameVal = (mapped.title || mapped.shopName || mapped.siteName || '').trim()
        if (!nameVal) { skipped++; continue }
        if (existingNames.has(nameVal.toLowerCase())) { skipped++; continue }
        await addDoc(collection(db, type.collection), {
          ...mapped,
          importedAt: new Date().toISOString(),
          createdBy: user.uid,
          createdAt: new Date().toISOString(),
        })
        existingNames.add(nameVal.toLowerCase())
        imported++
      } catch (e) { errors++; console.error(e) }
    }
    setResult({ imported, skipped, errors })
    setImporting(false)
    if (imported > 0) onImported?.()
  }

  const accentCls = {
    blue:   'bg-blue-600 text-white',
    green:  'bg-green-600 text-white',
    orange: 'bg-orange-500 text-white',
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">📂 Import from CSV / Lark Export</h3>
            <p className="text-xs text-slate-400 mt-0.5">Export from Lark Base → Download as CSV → paste or upload here</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6 flex-shrink-0">
          {Object.entries(TYPES).map(([key, t]) => (
            <button key={key} onClick={() => handleTabChange(key)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition ${
                tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Paste / upload + mapping */}
          <div className="w-72 flex-shrink-0 border-r border-slate-100 p-4 overflow-y-auto bg-slate-50 space-y-4">

            {/* How to export */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
              <p className="font-bold mb-1">How to export from Lark:</p>
              <ol className="space-y-0.5 list-decimal pl-4">
                <li>Open the Lark Base table</li>
                <li>Click ··· (More) → Export</li>
                <li>Choose <strong>CSV</strong></li>
                <li>Paste below or upload</li>
              </ol>
            </div>

            {/* Upload */}
            <div>
              <button onClick={() => fileRef.current?.click()}
                className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition">
                📁 Upload CSV file
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
            </div>

            {/* Paste area */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Or paste CSV here</label>
              <textarea className={`${inp} h-28 resize-none font-mono text-xs`}
                value={csvText}
                onChange={e => handleTextChange(e.target.value)}
                placeholder={`Title,Customer,Stage,Value\n"Conveyor Project","Amazon","Proposal",500000`} />
            </div>

            {/* Column mapping */}
            {parsed && parsed.headers.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Map Columns</p>
                <div className="space-y-2">
                  {type.fields.map(fd => (
                    <div key={fd.key}>
                      <label className="text-xs text-slate-600 block mb-0.5">{fd.label}</label>
                      <select className={inp} value={mapping[fd.key] || ''} onChange={e => setMapping(p => ({ ...p, [fd.key]: e.target.value }))}>
                        <option value="">— skip —</option>
                        {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Preview + import */}
          <div className="flex-1 overflow-y-auto p-5">
            {!parsed && (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <span className="text-5xl mb-3">📋</span>
                <p className="text-sm font-medium">Paste or upload a CSV to start</p>
                <p className="text-xs mt-1 text-slate-400 max-w-xs text-center">
                  Export your Lark table as CSV, then paste it in the left panel. Columns are auto-detected.
                </p>
              </div>
            )}

            {parsed && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-bold text-slate-700">
                    {parsed.rows.length} rows detected · Preview (first 5):
                  </p>
                  {result ? (
                    <div className={`flex gap-3 text-xs font-medium px-3 py-1.5 rounded-lg ${result.imported > 0 ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                      <span>✅ {result.imported} imported</span>
                      <span>⏭ {result.skipped} skipped</span>
                      {result.errors > 0 && <span className="text-red-600">❌ {result.errors} errors</span>}
                    </div>
                  ) : (
                    <button onClick={handleImport} disabled={importing}
                      className={`px-5 py-2 text-sm font-semibold rounded-lg transition disabled:opacity-50 ${accentCls[type.color]}`}>
                      {importing ? `Importing…` : `⬆ Import ${parsed.rows.length} Records`}
                    </button>
                  )}
                </div>

                {/* Preview table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                      <tr>
                        {type.fields.filter(f => mapping[f.key]).map(f => (
                          <th key={f.key} className="text-left px-3 py-2 whitespace-nowrap">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.map((row, i) => (
                        <tr key={i} className={!row[requiredKey] ? 'opacity-40 line-through' : ''}>
                          {type.fields.filter(f => mapping[f.key]).map(f => (
                            <td key={f.key} className="px-3 py-2 text-slate-700 max-w-[180px] truncate">
                              {String(row[f.key] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-slate-400 mt-2">
                  Rows with empty {requiredKey === 'title' ? 'Title' : requiredKey === 'shopName' ? 'Company Name' : 'Site Name'} are skipped.
                  Duplicate names are also skipped (safe to re-run).
                </p>

                {result?.imported > 0 && (
                  <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
                    🎉 <strong>{result.imported} records imported successfully!</strong>{' '}
                    Refresh the {type.label} page to see them.
                    {result.skipped > 0 && <span className="text-slate-500"> ({result.skipped} duplicates skipped)</span>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
