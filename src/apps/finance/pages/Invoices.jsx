import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, doc, getDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { INDIA_STATES, amountInWords, gstType } from '../utils/indiaConstants.js'

const INVOICE_TYPES = [
  { code: 'PI', label: 'Pro-forma Invoice' },
  { code: 'TI', label: 'Tax Invoice' },
  { code: 'SO', label: 'Sales Order' },
]
const TERMS_OPTS = ['Due on Receipt', 'Net 15', 'Net 30', 'Net 45', 'Net 60']
const UNITS = ['pcs', 'nos', 'set', 'kg', 'ltr', 'mtr', 'sqft', 'hours', 'days', 'lot']
const today = () => new Date().toISOString().slice(0, 10)
const getFY = () => { const d = new Date(); const y = d.getFullYear(); const m = d.getMonth() + 1; const s = m >= 4 ? y : y - 1; return `${String(s).slice(2)}-${String(s+1).slice(2)}` }
const newItem = () => ({ description: '', hsnCode: '', qty: 1, unit: 'pcs', rate: '', gstRate: 18 })

const emptyForm = {
  company: 'UIPL', invoiceType: 'TI', invoiceDate: today(), dueDate: today(),
  terms: 'Due on Receipt', poNumber: '', customerId: '',
  billToName: '', billToAddress: '', billToCity: '', billToState: '', billToPincode: '', billToGstin: '',
  sameShipTo: true,
  shipToName: '', shipToAddress: '', shipToCity: '', shipToState: '', shipToPincode: '', shipToGstin: '',
  posState: '', posStateCode: '', applyGst: true,
  notes: '', termsAndConditions: '',
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

// ── Print HTML generator ─────────────────────────────────────────────────────
function buildPrintHtml({ inv, items, seller, gstLines, subTotal, roundOff, total }) {
  const sellerAddr = [seller.address, seller.city, seller.state, seller.pincode].filter(Boolean).join(', ')
  const billAddr = [inv.billToAddress, inv.billToCity, inv.billToState, inv.billToPincode].filter(Boolean).join(', ')
  const shipAddr = inv.sameShipTo ? billAddr : [inv.shipToAddress, inv.shipToCity, inv.shipToState, inv.shipToPincode].filter(Boolean).join(', ')
  const typeLbl = INVOICE_TYPES.find(t => t.code === inv.invoiceType)?.label || 'Invoice'
  const rows = items.map((it, i) => {
    const amt = (Number(it.qty) || 0) * (Number(it.rate) || 0)
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${i+1}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${it.description || ''}<br/><span style="color:#888;font-size:11px">${it.hsnCode ? `HSN/SAC: ${it.hsnCode}` : ''}</span></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${it.qty} ${it.unit}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${Number(it.rate).toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${amt.toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
    </tr>`
  }).join('')
  const gstRows = inv.applyGst ? gstLines.map(g => `
    <tr><td colspan="4" style="padding:4px 8px;text-align:right;color:#555">${g.label} (${g.rate}%)</td>
    <td style="padding:4px 8px;text-align:right">${g.amount.toLocaleString('en-IN', {minimumFractionDigits:2})}</td></tr>`).join('') : ''
  const roundRow = roundOff !== 0 ? `<tr><td colspan="4" style="padding:4px 8px;text-align:right;color:#555">Rounding</td>
    <td style="padding:4px 8px;text-align:right">${roundOff.toFixed(2)}</td></tr>` : ''
  return `<!DOCTYPE html><html><head><title>${typeLbl} - ${inv.invoiceNumber || ''}</title>
  <style>body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:0;padding:20px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a56db;padding-bottom:10px;margin-bottom:14px}
  .addr-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:14px 0}
  .addr-box{font-size:12px;line-height:1.5}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:#f0f4ff;padding:6px 8px;text-align:left;font-size:12px;border-bottom:2px solid #1a56db}
  .total-row{font-weight:bold;font-size:14px;border-top:2px solid #1a56db}
  .words{margin-top:10px;font-size:12px;font-style:italic;border:1px solid #ddd;padding:8px;border-radius:4px;background:#f9fafb}
  @media print{body{padding:8px}}</style></head><body>
  <div class="hdr">
    <div>
      <div style="font-size:18px;font-weight:bold;color:#1a56db">${seller.legalName || inv.company}</div>
      ${seller.companyId ? `<div style="font-size:11px;color:#555">CIN: ${seller.companyId}</div>` : ''}
      <div style="font-size:12px;color:#555;margin-top:2px">${sellerAddr}</div>
      ${seller.gstin ? `<div style="font-size:12px;margin-top:2px"><b>GSTIN:</b> ${seller.gstin}</div>` : ''}
      ${seller.phone ? `<div style="font-size:12px">${seller.phone} · ${seller.email || ''}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div style="font-size:20px;font-weight:bold;color:#1a56db;text-transform:uppercase">${typeLbl}</div>
      <div style="margin-top:6px;font-size:12px"><b>Invoice#:</b> ${inv.invoiceNumber || '—'}</div>
      <div style="font-size:12px"><b>Date:</b> ${inv.invoiceDate}</div>
      ${inv.poNumber ? `<div style="font-size:12px"><b>P.O.#:</b> ${inv.poNumber}</div>` : ''}
      <div style="font-size:12px"><b>Terms:</b> ${inv.terms}</div>
      <div style="font-size:12px"><b>Due Date:</b> ${inv.dueDate}</div>
    </div>
  </div>
  <div class="addr-grid">
    <div class="addr-box"><b style="font-size:11px;color:#1a56db">BILL TO</b><br/>
      <b>${inv.billToName}</b><br/>${billAddr}<br/>
      ${inv.billToGstin ? `<b>GSTIN:</b> ${inv.billToGstin}` : ''}
    </div>
    <div class="addr-box"><b style="font-size:11px;color:#1a56db">SHIP TO</b><br/>
      <b>${inv.sameShipTo ? inv.billToName : (inv.shipToName || inv.billToName)}</b><br/>${shipAddr}<br/>
      ${(inv.sameShipTo ? inv.billToGstin : inv.shipToGstin) ? `<b>GSTIN:</b> ${inv.sameShipTo ? inv.billToGstin : inv.shipToGstin}` : ''}
    </div>
  </div>
  ${inv.posState ? `<div style="font-size:12px;margin-bottom:8px"><b>Place of Supply:</b> ${inv.posState}${inv.posStateCode ? ` (${inv.posStateCode})` : ''}</div>` : ''}
  <table>
    <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider"><tr>
      <th style="width:30px">#</th><th>Item &amp; Description</th>
      <th style="width:80px;text-align:center">Qty</th>
      <th style="width:100px;text-align:right">Rate</th>
      <th style="width:110px;text-align:right">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="4" style="padding:6px 8px;text-align:right;color:#555">Sub Total</td>
          <td style="padding:6px 8px;text-align:right">${subTotal.toLocaleString('en-IN', {minimumFractionDigits:2})}</td></tr>
      ${gstRows}${roundRow}
      <tr class="total-row">
        <td colspan="4" style="padding:8px;text-align:right">Total</td>
        <td style="padding:8px;text-align:right">₹${total.toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
      </tr>
    </tfoot>
  </table>
  <div class="words"><b>Total In Words:</b> ${amountInWords(total)}</div>
  ${inv.termsAndConditions ? `<div style="margin-top:14px;font-size:12px"><b>Terms &amp; Conditions</b><br/><pre style="font-family:inherit;white-space:pre-wrap;margin:4px 0">${inv.termsAndConditions}</pre></div>` : ''}
  ${seller.bankAccount ? `<div style="margin-top:14px;font-size:12px;border-top:1px solid #ddd;padding-top:8px"><b>Bank Details:</b> ${seller.bankName} · A/C ${seller.bankAccount} · IFSC ${seller.ifsc}</div>` : ''}
  <div style="margin-top:40px;text-align:right;font-size:12px"><b>Authorized Signature</b><br/><br/><div style="margin-top:30px;border-top:1px solid #222;display:inline-block;min-width:150px;text-align:center">${seller.legalName || inv.company}</div></div>
  </body></html>`
}

// ── Compute totals ────────────────────────────────────────────────────────────
function computeTotals(items, posStateCode, sellerStateCode, applyGst) {
  const subTotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0)
  const gstLines = []
  if (applyGst) {
    const rateMap = {}
    items.forEach(it => {
      const base = (Number(it.qty) || 0) * (Number(it.rate) || 0)
      const r = Number(it.gstRate) || 0
      if (r > 0) rateMap[r] = (rateMap[r] || 0) + base
    })
    const isIntra = sellerStateCode && posStateCode && sellerStateCode === posStateCode
    Object.entries(rateMap).forEach(([rate, base]) => {
      const r = Number(rate)
      if (isIntra) {
        gstLines.push({ label: `CGST ${r/2}%`, rate: r/2, base, amount: base * r / 200 })
        gstLines.push({ label: `SGST ${r/2}%`, rate: r/2, base, amount: base * r / 200 })
      } else {
        gstLines.push({ label: `IGST ${r}%`, rate: r, base, amount: base * r / 100 })
      }
    })
  }
  const taxTotal = gstLines.reduce((s, g) => s + g.amount, 0)
  const rawTotal = subTotal + taxTotal
  const total = Math.round(rawTotal)
  const roundOff = total - rawTotal
  return { subTotal, gstLines, total, roundOff }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Invoices() {
  const { user, userProfile } = useAuth()
  const [view, setView] = useState('list')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [sellers, setSellers] = useState({})
  const [customers, setCustomers] = useState([])
  const [hsnCodes, setHsnCodes] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState([newItem()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    try {
      const [invSnap, custSnap, hsnSnap, uiplSnap, wayzimSnap] = await Promise.all([
        getDocs(collection(db, 'finance_invoices')),
        getDocs(collection(db, 'crm_customers')),
        getDocs(collection(db, 'finance_hsn_codes')),
        getDoc(doc(db, 'company_settings', 'UIPL')),
        getDoc(doc(db, 'company_settings', 'Wayzim')),
      ])
      const invData = []; invSnap.forEach(d => invData.push({ id: d.id, ...d.data() }))
      invData.sort((a, b) => (b.invoiceDate || '').localeCompare(a.invoiceDate || ''))
      setInvoices(invData)
      const custData = []; custSnap.forEach(d => custData.push({ id: d.id, ...d.data() }))
      setCustomers(custData)
      const hsnData = []; hsnSnap.forEach(d => hsnData.push({ id: d.id, ...d.data() }))
      setHsnCodes(hsnData)
      const sellersMap = {}
      if (uiplSnap.exists()) sellersMap.UIPL = uiplSnap.data()
      if (wayzimSnap.exists()) sellersMap.Wayzim = wayzimSnap.data()
      setSellers(sellersMap)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const getNextInvoiceNumber = async (company, typeCode) => {
    const fy = getFY()
    const prefix = `${company}/${typeCode}/${fy}/`
    const snap = await getDocs(collection(db, 'finance_invoices'))
    const nums = []
    snap.forEach(d => {
      const n = d.data().invoiceNumber || ''
      if (n.startsWith(prefix)) nums.push(parseInt(n.replace(prefix, '')) || 0)
    })
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
    return `${prefix}${String(next).padStart(3, '0')}`
  }

  const handleCompanyChange = (co) => {
    const s = sellers[co] || {}
    setForm(p => ({ ...p, company: co, termsAndConditions: s.termsAndConditions || p.termsAndConditions }))
  }

  const handleCustomerChange = (customerId) => {
    const cust = customers.find(c => c.id === customerId)
    if (!cust) { setForm(p => ({ ...p, customerId, billToName: '', billToAddress: '', billToCity: '', billToState: '', billToPincode: '', billToGstin: '' })); return }
    const posState = cust.state || ''
    const posStateCode = INDIA_STATES.find(s => s.name === posState)?.code || ''
    setForm(p => ({
      ...p, customerId,
      billToName: cust.shopName || '',
      billToAddress: cust.address || '',
      billToCity: cust.city || '',
      billToState: posState,
      billToPincode: cust.pincode || '',
      billToGstin: cust.gstin || '',
      posState, posStateCode,
    }))
  }

  const handlePosChange = (stateName) => {
    const code = INDIA_STATES.find(s => s.name === stateName)?.code || ''
    setForm(p => ({ ...p, posState: stateName, posStateCode: code }))
  }

  const handleHsnLookup = (idx, code) => {
    const found = hsnCodes.find(h => h.code === code)
    if (found) updateItem(idx, 'gstRate', found.gstRate)
  }

  const updateItem = (idx, field, val) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it))

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.billToName.trim()) { setError('Customer / Bill To name is required'); return }
    if (items.every(it => !it.description.trim())) { setError('Add at least one line item'); return }
    setSaving(true)
    try {
      const seller = sellers[form.company] || {}
      const invoiceNumber = await getNextInvoiceNumber(form.company, form.invoiceType)
      const { subTotal, gstLines, total, roundOff } = computeTotals(
        items, form.posStateCode, seller.stateCode, form.applyGst
      )
      const payload = {
        ...form,
        invoiceNumber,
        sellerName: seller.legalName || form.company,
        sellerGstin: seller.gstin || '',
        sellerState: seller.state || '',
        sellerStateCode: seller.stateCode || '',
        items: items.filter(it => it.description.trim()),
        subTotal, gstLines, roundOff, total,
        totalInWords: amountInWords(total),
        status: 'draft',
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      }
      const ref = await addDoc(collection(db, 'finance_invoices'), payload)
      setInvoices(prev => [{ id: ref.id, ...payload }, ...prev])
      setView('list')
      setForm(emptyForm); setItems([newItem()])
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handlePrint = (inv) => {
    const seller = { legalName: inv.sellerName, gstin: inv.sellerGstin, ...sellers[inv.company] }
    const { subTotal, gstLines, total, roundOff } = computeTotals(
      inv.items || [], inv.posStateCode, inv.sellerStateCode, inv.applyGst !== false
    )
    const html = buildPrintHtml({ inv, items: inv.items || [], seller, gstLines, subTotal, roundOff, total })
    const w = window.open('', '_blank', 'width=860,height=960')
    w.document.write(html); w.document.close()
    setTimeout(() => { w.print() }, 400)
  }

  const seller = sellers[form.company] || {}
  const { subTotal, gstLines, total, roundOff } = computeTotals(items, form.posStateCode, seller.stateCode, form.applyGst)

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  // ── FORM VIEW ──────────────────────────────────────────────────────────────
  if (view === 'form') return (
    <div className="p-4 max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setView('list')} className="text-slate-500 hover:text-slate-700">← Back</button>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">New Invoice</h2>
      </div>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      <form onSubmit={handleSave} className="space-y-4">

        {/* Header row */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 grid grid-cols-4 gap-4">
          <div>
            <label className={lbl}>Entity</label>
            <select className={inp} value={form.company} onChange={e => handleCompanyChange(e.target.value)}>
              <option>UIPL</option><option>Wayzim</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Invoice Type</label>
            <select className={inp} value={form.invoiceType} onChange={e => setForm(p => ({ ...p, invoiceType: e.target.value }))}>
              {INVOICE_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Invoice Date</label>
            <input type="date" className={inp} value={form.invoiceDate} onChange={e => setForm(p => ({ ...p, invoiceDate: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Due Date</label>
            <input type="date" className={inp} value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Terms</label>
            <select className={inp} value={form.terms} onChange={e => setForm(p => ({ ...p, terms: e.target.value }))}>
              {TERMS_OPTS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>P.O. / Ref #</label>
            <input className={inp} value={form.poNumber} onChange={e => setForm(p => ({ ...p, poNumber: e.target.value }))} />
          </div>
          <div className="col-span-2 flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.applyGst} onChange={e => setForm(p => ({ ...p, applyGst: e.target.checked }))} />
              Apply GST
            </label>
          </div>
        </div>

        {/* Seller info */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm">
          <p className="font-bold text-blue-800">{seller.legalName || form.company}</p>
          <p className="text-blue-700">{[seller.address, seller.city, seller.state, seller.pincode].filter(Boolean).join(', ')}</p>
          <p className="text-blue-700">GSTIN: {seller.gstin || '—'} · State: {seller.state || '—'} ({seller.stateCode || '—'})</p>
          {!seller.legalName && <p className="text-amber-600 text-xs mt-1">⚠ Configure seller details in Finance → Company Settings</p>}
        </div>

        {/* Bill To + POS */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase text-blue-600 border-b pb-1">Bill To</p>
            <div>
              <label className={lbl}>Select Customer</label>
              <select className={inp} value={form.customerId} onChange={e => handleCustomerChange(e.target.value)}>
                <option value="">— select customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.shopName}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Name *</label><input className={inp} value={form.billToName} onChange={e => setForm(p => ({ ...p, billToName: e.target.value }))} required /></div>
            <div><label className={lbl}>Address</label><input className={inp} value={form.billToAddress} onChange={e => setForm(p => ({ ...p, billToAddress: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={lbl}>City</label><input className={inp} value={form.billToCity} onChange={e => setForm(p => ({ ...p, billToCity: e.target.value }))} /></div>
              <div><label className={lbl}>Pincode</label><input className={inp} value={form.billToPincode} onChange={e => setForm(p => ({ ...p, billToPincode: e.target.value }))} /></div>
            </div>
            <div><label className={lbl}>GSTIN</label><input className={inp} value={form.billToGstin} maxLength={15} onChange={e => setForm(p => ({ ...p, billToGstin: e.target.value }))} /></div>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase text-blue-600 border-b pb-1">Ship To &amp; Place of Supply</p>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.sameShipTo} onChange={e => setForm(p => ({ ...p, sameShipTo: e.target.checked }))} />
              Same as Bill To
            </label>
            {!form.sameShipTo && <>
              <div><label className={lbl}>Ship To Name</label><input className={inp} value={form.shipToName} onChange={e => setForm(p => ({ ...p, shipToName: e.target.value }))} /></div>
              <div><label className={lbl}>Ship To Address</label><input className={inp} value={form.shipToAddress} onChange={e => setForm(p => ({ ...p, shipToAddress: e.target.value }))} /></div>
              <div><label className={lbl}>Ship To GSTIN</label><input className={inp} value={form.shipToGstin} maxLength={15} onChange={e => setForm(p => ({ ...p, shipToGstin: e.target.value }))} /></div>
            </>}
            <div>
              <label className={lbl}>Place of Supply (State) *</label>
              <select className={inp} value={form.posState} onChange={e => handlePosChange(e.target.value)}>
                <option value="">— select state —</option>
                {INDIA_STATES.map(s => <option key={s.code} value={s.name}>{s.name} ({s.code})</option>)}
              </select>
            </div>
            {form.applyGst && form.posStateCode && seller.stateCode && (
              <div className={`text-xs px-3 py-2 rounded-lg font-medium ${form.posStateCode === seller.stateCode ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                {form.posStateCode === seller.stateCode
                  ? '✓ Intra-state supply → CGST + SGST'
                  : '↗ Inter-state supply → IGST'}
              </div>
            )}
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b flex items-center justify-between">
            <p className="text-xs font-bold uppercase text-slate-600">Line Items</p>
            <button type="button" onClick={() => setItems(p => [...p, newItem()])}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium">+ Add Row</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left" style={{width:'34%'}}>Description</th>
                <th className="px-3 py-2" style={{width:'12%'}}>HSN/SAC</th>
                <th className="px-3 py-2" style={{width:'8%'}}>Qty</th>
                <th className="px-3 py-2" style={{width:'8%'}}>Unit</th>
                <th className="px-3 py-2" style={{width:'12%'}}>Rate (₹)</th>
                <th className="px-3 py-2" style={{width:'8%'}}>GST %</th>
                <th className="px-3 py-2 text-right" style={{width:'12%'}}>Amount</th>
                <th className="px-3 py-2" style={{width:'6%'}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const amt = (Number(it.qty) || 0) * (Number(it.rate) || 0)
                return (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-2 py-1"><input className={inp} value={it.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Item description" /></td>
                    <td className="px-2 py-1"><input className={inp} value={it.hsnCode} onChange={e => { updateItem(idx, 'hsnCode', e.target.value); handleHsnLookup(idx, e.target.value) }} placeholder="85444929" /></td>
                    <td className="px-2 py-1"><input type="number" className={inp} value={it.qty} min={0} onChange={e => updateItem(idx, 'qty', e.target.value)} /></td>
                    <td className="px-2 py-1">
                      <select className={inp} value={it.unit} onChange={e => updateItem(idx, 'unit', e.target.value)}>
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1"><input type="number" className={inp} value={it.rate} min={0} onChange={e => updateItem(idx, 'rate', e.target.value)} /></td>
                    <td className="px-2 py-1"><input type="number" className={inp} value={it.gstRate} min={0} max={28} onChange={e => updateItem(idx, 'gstRate', e.target.value)} /></td>
                    <td className="px-2 py-1 text-right font-medium">₹{amt.toLocaleString('en-IN')}</td>
                    <td className="px-2 py-1 text-center">
                      {items.length > 1 && <button type="button" onClick={() => setItems(p => p.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 text-lg">×</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {/* Totals */}
          <div className="px-4 py-3 bg-slate-50 border-t text-sm">
            <div className="flex justify-end">
              <div className="w-64 space-y-1">
                <div className="flex justify-between"><span className="text-slate-500">Sub Total</span><span>₹{subTotal.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>
                {gstLines.map((g, i) => (
                  <div key={i} className="flex justify-between text-slate-600"><span>{g.label}</span><span>₹{g.amount.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>
                ))}
                {roundOff !== 0 && <div className="flex justify-between text-slate-500"><span>Rounding</span><span>{roundOff.toFixed(2)}</span></div>}
                <div className="flex justify-between font-bold text-base border-t pt-1"><span>Total</span><span>₹{total.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* Notes + T&C */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 grid grid-cols-2 gap-4">
          <div><label className={lbl}>Notes</label><textarea className={`${inp} h-20 resize-none`} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
          <div><label className={lbl}>Terms &amp; Conditions</label><textarea className={`${inp} h-20 resize-none`} value={form.termsAndConditions} onChange={e => setForm(p => ({ ...p, termsAndConditions: e.target.value }))} /></div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Invoice'}
          </button>
          <button type="button" onClick={() => { setView('list'); setForm(emptyForm); setItems([newItem()]) }}
            className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )

  // ── LIST VIEW ──────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Invoices</h2>
          <p className="text-slate-500 text-sm">{invoices.length} invoices · Tax &amp; Pro-forma</p>
        </div>
        <button onClick={() => {
          const s = sellers['UIPL'] || {}
          setForm({ ...emptyForm, termsAndConditions: s.termsAndConditions || '' })
          setItems([newItem()]); setView('form')
        }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          + Create Invoice
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Invoice #</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">PO #</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map(inv => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono font-bold text-blue-700">{inv.invoiceNumber}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-indigo-100 text-indigo-700">
                    {INVOICE_TYPES.find(t => t.code === inv.invoiceType)?.label || inv.invoiceType}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{inv.invoiceDate}</td>
                <td className="px-4 py-3 text-slate-800">{inv.billToName || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{inv.poNumber || '—'}</td>
                <td className="px-4 py-3 text-right font-medium">₹{(inv.total || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handlePrint(inv)}
                    className="text-blue-600 hover:text-blue-700 font-medium">🖨️ Print</button>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr><td colSpan={7} className="text-center py-10 text-slate-400">No invoices yet. Create your first invoice.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
