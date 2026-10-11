import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, getDoc } from 'firebase/firestore'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { INDIA_STATES, amountInWords, gstType } from '../utils/indiaConstants.js'

const INVOICE_TYPES = [
  { code: 'PI', label: 'Pro-forma Invoice' },
  { code: 'TI', label: 'Tax Invoice' },
  { code: 'SO', label: 'Sales Order' },
]
// Tabs of the Sales screen: tax invoices, sales orders (a commitment — no accounting entry until invoiced), pro-forma invoices
const TABS = [
  { key: 'invoices', label: 'Sales invoices', type: 'TI', match: i => !['SO', 'PI'].includes(i.invoiceType), blurb: 'Tax invoices — these post to the books' },
  { key: 'orders', label: 'Sales orders', type: 'SO', match: i => i.invoiceType === 'SO', blurb: 'Orders received from customers — no accounting entry until you convert one to an invoice' },
  { key: 'proforma', label: 'Pro-forma', type: 'PI', match: i => i.invoiceType === 'PI', blurb: 'Pro-forma invoices — advance / quotation documents, not booked' },
]
const TERMS_OPTS = ['Due on Receipt', 'Net 15', 'Net 30', 'Net 45', 'Net 60']
const UNITS = ['pcs', 'nos', 'set', 'kg', 'ltr', 'mtr', 'sqft', 'hours', 'days', 'lot']
import { todayStr } from '../utils/financeConstants.js'
import { computeVoucherTotals } from '../utils/taxCalc.js'
import { convertTotals, fmtFc, symbolOf } from '../utils/fx.js'
import { useFx, CurrencyBar } from '../components/formShared.jsx'
import InvoicesImport from '../components/InvoicesImport.jsx'
import PayStatus from '../components/PayStatus.jsx'
import SearchSelect from '../components/SearchSelect.jsx'
import CreditNotesImport from '../components/CreditNotesImport.jsx'
import { cloneInvoiceItems } from '../utils/cloneDoc.js'
import ConvertOrderModal from '../components/ConvertOrderModal.jsx'
import SalesOrdersImport from '../components/SalesOrdersImport.jsx'
import { orderProgress, applyInvoicing, invoiceFromOrder, closeOrderItems, ORDER_STATE_LABEL } from '../utils/salesOrders.js'
import { buildInvoicePdf, downloadPdf } from '../utils/invoicePdf.js'
import { useFinanceData, invalidateFinanceCache } from '../hooks/useFinanceData.js'
import { useVoucherModal } from '../components/useVoucherModal.jsx'
import { assertNotLocked, getBooksLockDate } from '../utils/voucherService.js'
import { openBillMap, payStatus } from '../utils/outstanding.js'
const today = todayStr   // local date (toISOString would be a day behind in India early morning)
const getFY = () => { const d = new Date(); const y = d.getFullYear(); const m = d.getMonth() + 1; const s = m >= 4 ? y : y - 1; return `${String(s).slice(2)}-${String(s+1).slice(2)}` }
const newItem = () => ({ description: '', hsnCode: '', qty: 1, unit: 'pcs', rate: '', gstRate: 18, stockItemId: '', sku: '' })

const emptyForm = {
  company: 'UIPL', invoiceType: 'TI', invoiceDate: today(), dueDate: today(),
  terms: 'Due on Receipt', poNumber: '', customerId: '',
  billToName: '', billToAddress: '', billToCity: '', billToState: '', billToPincode: '', billToGstin: '',
  sameShipTo: true,
  shipToName: '', shipToAddress: '', shipToCity: '', shipToState: '', shipToPincode: '', shipToGstin: '',
  posState: '', posStateCode: '', applyGst: true,
  interCompany: null, isExport: false, exportType: 'WOPAY', shippingBillNo: '', shippingBillDate: '', portCode: '',
  notes: '', termsAndConditions: '',
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-slate-600 mb-1'

// ── Print HTML generator ─────────────────────────────────────────────────────
function buildPrintHtml({ inv, items, seller, gstLines, subTotal, roundOff, total, fx }) {
  const isFc = !!(fx?.currency && fx.currency !== 'INR')
  const sym = isFc ? `${symbolOf(fx.currency)} ` : '₹'
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
        <td style="padding:8px;text-align:right">${sym}${total.toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
      </tr>
      ${isFc ? `<tr><td colspan="5" style="padding:4px 8px;text-align:right;font-size:11px;color:#555">Exchange rate ₹${fx.rate} per ${fx.currency} on ${inv.invoiceDate} — equivalent to ₹${(Number(inv.total) || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}</td></tr>` : ''}
    </tfoot>
  </table>
  <div class="words"><b>Total In Words:</b> ${isFc ? `${fx.currency} ${total.toLocaleString('en-IN', {minimumFractionDigits:2})}` : amountInWords(total)}</div>
  ${inv.isExport ? `<div style="margin-top:8px;font-size:12px"><b>Export supply</b> ${inv.exportType === 'WOPAY' ? 'under Letter of Undertaking (LUT) without payment of IGST' : 'with payment of IGST'}${inv.shippingBillNo ? ` · Shipping bill ${inv.shippingBillNo}${inv.shippingBillDate ? ' dt ' + inv.shippingBillDate : ''}${inv.portCode ? ' · Port ' + inv.portCode : ''}` : ''}</div>` : ''}
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

// where a sales order stands: open, partly invoiced (6 of 12 billed), invoiced, closed
const ORDER_CLS = { draft: 'bg-slate-100 text-slate-600', open: 'bg-amber-100 text-amber-700', partial: 'bg-blue-100 text-blue-700', invoiced: 'bg-green-100 text-green-700', closed: 'bg-slate-200 text-slate-600' }
function OrderBadge({ inv }) {
  const p = orderProgress(inv)
  return (
    <span className="whitespace-nowrap">
      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ORDER_CLS[p.state]}`}>{ORDER_STATE_LABEL[p.state]}</span>
      {p.state !== 'invoiced' && p.ordered > 0 && <span className="text-xs text-slate-500 ml-1.5">{p.invoiced} of {p.ordered} billed</span>}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Invoices() {
  const { user, userProfile } = useAuth()
  const [view, setView] = useState('list')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [sellers, setSellers] = useState({})
  const [customers, setCustomers] = useState([])
  const [showImport, setShowImport] = useState(false)
  const fd = useFinanceData()
  const ledgerLines = fd.allLines
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const tab = TABS.find(t => t.key === params.get('tab')) || TABS[0]
  const [editingId, setEditingId] = useState('')
  const [convertFor, setConvertFor] = useState(null)        // the sales order being invoiced
  const [showOrdersImport, setShowOrdersImport] = useState(false)
  const [showCnImport, setShowCnImport] = useState(false)
  const openInv = useMemo(() => openBillMap(ledgerLines || [], { kind: 'receivable', asOf: todayStr() }), [ledgerLines])
  const [hsnCodes, setHsnCodes] = useState([])
  const [fxRates, setFxRates] = useState([])
  const [stockItems, setStockItems] = useState([])   // optional link: picking a stock item makes the sale reduce inventory and book cost of goods
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState([newItem()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    try {
      const [invSnap, custSnap, hsnSnap, uiplSnap, wayzimSnap, stockSnap, fxSnap] = await Promise.all([
        getDocs(collection(db, 'finance_invoices')),
        getDocs(collection(db, 'crm_customers')),
        getDocs(collection(db, 'finance_hsn_codes')),
        getDoc(doc(db, 'company_settings', 'UIPL')),
        getDoc(doc(db, 'company_settings', 'Wayzim')),
        getDocs(collection(db, 'inventory_items')).catch(() => null),
        getDocs(collection(db, 'finance_fx_rates')).catch(() => null),
      ])
      const fxr = []; fxSnap?.forEach(d => fxr.push({ id: d.id, ...d.data() })); setFxRates(fxr)
      const stk = []; stockSnap?.forEach(d => stk.push({ id: d.id, ...d.data() }))
      stk.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      setStockItems(stk)
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

  const pickStockItem = (idx, id) => {
    const st = stockItems.find(x => x.id === id)
    if (!st) { setItems(prev => prev.map((it, i) => i === idx ? { ...it, stockItemId: '', sku: '' } : it)); return }
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it, stockItemId: st.id, sku: st.sku || '', description: st.name || it.description, unit: st.unit || it.unit,
      hsnCode: st.hsnCode || it.hsnCode, gstRate: st.gstRate !== undefined && st.gstRate !== '' ? st.gstRate : it.gstRate, rate: it.rate || st.saleRate || '',
    } : it))
  }

  const updateItem = (idx, field, val) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it))

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.billToName.trim()) { setError('Customer / Bill To name is required'); return }
    if (items.every(it => !it.description.trim())) { setError('Add at least one line item'); return }
    if (form.invoiceType === 'SO') { const bad = items.find(it => (Number(it.qty) || 0) < (Number(it.invoicedQty) || 0) + (Number(it.cancelledQty) || 0) - 0.00005); if (bad) { setError('“' + String(bad.description).slice(0, 40) + '”: the quantity cannot be below what is already invoiced or cancelled.'); return } }
    setSaving(true)
    try {
      const seller = sellers[form.company] || {}
      const prev = editingId ? invoices.find(i => i.id === editingId) : null
      if (prev) { const lk = await getBooksLockDate(prev.company); assertNotLocked(prev.invoiceDate, lk); assertNotLocked(form.invoiceDate, lk) }
      const invoiceNumber = prev ? prev.invoiceNumber : await getNextInvoiceNumber(form.company, form.invoiceType)
      const expNoTax = form.isExport && form.exportType === 'WOPAY'
      const applyGstNow = form.applyGst && !expNoTax
      const posCode = form.isExport && !expNoTax ? '96' : form.posStateCode
      if (fx.isFc && !(fx.rate > 0)) { setError(`Enter the exchange rate for ${fx.currency}`); setSaving(false); return }
      const base = computeTotals(items, posCode, seller.stateCode, applyGstNow)
      const lines = items.filter(it => it.description.trim())
      let subTotal = base.subTotal, gstLines = base.gstLines, total = base.total, roundOff = base.roundOff, fxDoc = null
      if (fx.isFc) {
        const f = computeVoucherTotals(lines.map(i => ({ ...i, discountPct: 0 })), { supplyType: (form.isExport || !(seller.stateCode && posCode && seller.stateCode === posCode)) ? 'inter' : 'intra', applyGst: applyGstNow, rounding: false })
        const b = convertTotals(f, fx.rate, fx.currency)
        subTotal = b.subTotal; gstLines = b.gstLines; total = b.total; roundOff = 0
        fxDoc = { currency: fx.currency, rate: fx.rate, subTotal: f.subTotal, taxTotal: f.taxTotal, total: f.total, gstLines: f.gstLines }
      }
      const payload = {
        ...(prev || {}), ...form, applyGst: applyGstNow, ...(form.isExport ? { posStateCode: posCode, posState: posCode === '96' ? 'Other Country' : form.posState } : {}),
        currency: fx.currency, ...(fxDoc ? { fx: fxDoc } : {}),
        invoiceNumber,
        sellerName: seller.legalName || form.company,
        sellerGstin: seller.gstin || '',
        sellerState: seller.state || '',
        sellerStateCode: seller.stateCode || '',
        items: items.filter(it => it.description.trim()),
        subTotal, gstLines, roundOff, total,
        totalInWords: fxDoc ? `${fx.currency} ${fxDoc.total.toFixed(2)}` : amountInWords(total),
        status: prev ? prev.status : 'draft',
        ...(prev ? { updatedBy: user.uid, updatedAt: new Date().toISOString() } : { createdBy: user.uid, createdAt: new Date().toISOString() }),
      }
      if (prev) {
        const { id: _id, ...body } = payload
        await updateDoc(doc(db, 'finance_invoices', editingId), JSON.parse(JSON.stringify(body)))
        setInvoices(list => list.map(i => i.id === editingId ? { ...i, ...body } : i))
        addDoc(collection(db, 'finance_audit_log'), JSON.parse(JSON.stringify({ at: new Date().toISOString(), by: user.uid, byName: userProfile?.name || user.email || '', action: 'edit', voucherType: 'invoice', voucherNumber: prev.invoiceNumber, company: prev.company, date: form.invoiceDate, amount: total, before: JSON.stringify(prev).slice(0, 20000) }))).catch(() => {})
      } else {
        const ref = await addDoc(collection(db, 'finance_invoices'), payload)
        setInvoices(list => [{ id: ref.id, ...payload }, ...list])
      }
      invalidateFinanceCache(); fd.reload()
      setEditingId(''); setView('list')
      setForm(emptyForm); setItems([newItem()])
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  // open an existing document in the form (INR documents; a foreign-currency one is re-issued instead)
  const startEdit = (inv) => {
    if (inv.fx?.currency && inv.fx.currency !== 'INR') { alert('Foreign-currency documents cannot be edited here — cancel it and issue a new one.'); return }
    setForm({ ...emptyForm, ...Object.fromEntries(Object.keys(emptyForm).map(k => [k, inv[k] ?? emptyForm[k]])), customerId: inv.customerId || '' })
    setItems((inv.items || []).length ? inv.items.map(i => ({ ...newItem(), ...i })) : [newItem()])
    setEditingId(inv.id); setError(''); setView('form')
  }
  // new document from an existing one: same customer and lines, today's date, next number on save
  const startClone = (inv) => {
    if (inv.fx?.currency && inv.fx.currency !== 'INR') { alert('Foreign-currency documents cannot be cloned here — issue a new one.'); return }
    const days = Math.max(0, Math.round((new Date(inv.dueDate || inv.invoiceDate) - new Date(inv.invoiceDate)) / 86400000)) || 0
    const d = new Date(); d.setDate(d.getDate() + days)
    const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setForm({ ...emptyForm, ...Object.fromEntries(Object.keys(emptyForm).map(k => [k, inv[k] ?? emptyForm[k]])), customerId: inv.customerId || '', invoiceDate: today(), dueDate: due })
    setItems((inv.items || []).length ? cloneInvoiceItems(inv.items).map(i => ({ ...newItem(), ...i })) : [newItem()])
    setEditingId(''); setError(''); setView('form')
  }
  // sales order → tax invoice for the chosen quantities (all, part, or a percentage); what is left stays open on the order
  const convertOrder = (so) => setConvertFor(so)
  const createFromOrder = async (so, { qtys, date, dueDate, terms, note }) => {
    const sel = sellers[so.company] || {}
    const calc = invoiceFromOrder(so, qtys, { sellerStateCode: sel.stateCode })
    const items = applyInvoicing(so, qtys)                                  // refuses more than what is left
    const lk = await getBooksLockDate(so.company); assertNotLocked(date, lk)
    const number = await getNextInvoiceNumber(so.company, 'TI')
    const { id: _a, invoiceNumber: _b, status: _c, createdAt: _d, createdBy: _e, updatedAt: _f, updatedBy: _g, invoiceLinks: _h, items: _i, expectedShipment: _j, zohoOrderId: _k, source: _l, ...rest } = so
    const body = JSON.parse(JSON.stringify({ ...rest, invoiceType: 'TI', invoiceNumber: number, invoiceDate: date, dueDate, terms, items: calc.items, subTotal: calc.subTotal, gstLines: calc.gstLines, roundOff: calc.roundOff, total: calc.total,
      applyGst: calc.applyGst, totalInWords: amountInWords(calc.total), notes: [note, 'Against sales order ' + so.invoiceNumber, so.notes].filter(Boolean).join(' · '), status: 'draft', sourceOrderId: so.id, sourceOrderNumber: so.invoiceNumber, createdBy: user.uid, createdAt: new Date().toISOString() }))
    const ref = await addDoc(collection(db, 'finance_invoices'), body)
    const links = [...(so.invoiceLinks || []), { id: ref.id, number, date, total: calc.total, note }]
    const patch = { items, invoiceLinks: links, status: orderProgress({ ...so, items }).state === 'invoiced' ? 'invoiced' : 'partial' }
    await updateDoc(doc(db, 'finance_invoices', so.id), JSON.parse(JSON.stringify(patch)))
    setInvoices(list => [{ id: ref.id, ...body }, ...list.map(i => i.id === so.id ? { ...i, ...patch } : i)])
    invalidateFinanceCache(); fd.reload(); setConvertFor(null)
    alert('Invoice ' + number + ' created (₹' + calc.total.toLocaleString('en-IN', { minimumFractionDigits: 2 }) + ') against ' + so.invoiceNumber + '. See it in the Sales invoices tab.')
  }
  // close an order: whatever is not yet invoiced is cancelled
  const closeOrder = async (so) => {
    const left = orderProgress(so).remaining
    if (!window.confirm('Close sales order ' + so.invoiceNumber + '? The ' + left + ' not yet invoiced will be cancelled and cannot be invoiced later.')) return
    const items = closeOrderItems(so)
    await updateDoc(doc(db, 'finance_invoices', so.id), JSON.parse(JSON.stringify({ items, status: 'closed' })))
    setInvoices(list => list.map(i => i.id === so.id ? { ...i, items, status: 'closed' } : i)); invalidateFinanceCache(); fd.reload()
  }

  // A4 PDF with an empty digital-signature field at "Authorised Signatory" — sign it with the DSC (token / certificate) in Adobe, then share it
  const handlePdf = async (inv) => {
    try {
      const seller = { legalName: inv.sellerName, gstin: inv.sellerGstin, ...sellers[inv.company] }
      const fcInv = inv.fx?.currency && inv.fx.currency !== 'INR'
      const stored = !fcInv && Array.isArray(inv.gstLines) && inv.total !== undefined
      const t = fcInv ? { subTotal: inv.fx.subTotal, gstLines: inv.fx.gstLines || [], total: inv.fx.total, roundOff: 0 }
        : stored ? { subTotal: Number(inv.subTotal) || 0, gstLines: inv.gstLines, total: Number(inv.total) || 0, roundOff: Number(inv.roundOff) || 0 }
        : computeTotals(inv.items || [], inv.posStateCode, inv.sellerStateCode, inv.applyGst !== false)
      const bytes = await buildInvoicePdf({ inv, items: inv.items || [], seller, gstLines: t.gstLines, subTotal: t.subTotal, roundOff: t.roundOff, total: t.total,
        typeLabel: INVOICE_TYPES.find(x => x.code === inv.invoiceType)?.label || 'Invoice', totalInWords: fcInv ? `${inv.fx.currency} ${t.total.toFixed(2)}` : amountInWords(t.total), symbol: fcInv ? inv.fx.currency : 'Rs.' })
      downloadPdf(bytes, `${inv.invoiceNumber || 'invoice'}.pdf`)
    } catch (e) { alert('Could not create the PDF: ' + e.message) }
  }

  const handlePrint = (inv) => {
    const seller = { legalName: inv.sellerName, gstin: inv.sellerGstin, ...sellers[inv.company] }
    const fcInv = inv.fx?.currency && inv.fx.currency !== 'INR'
    const t = fcInv ? { subTotal: inv.fx.subTotal, gstLines: inv.fx.gstLines || [], total: inv.fx.total, roundOff: 0 }
      : computeTotals(inv.items || [], inv.posStateCode, inv.sellerStateCode, inv.applyGst !== false)
    const html = buildPrintHtml({ inv, items: inv.items || [], seller, gstLines: t.gstLines, subTotal: t.subTotal, roundOff: t.roundOff, total: t.total, fx: fcInv ? inv.fx : null })
    const w = window.open('', '_blank', 'width=860,height=960')
    w.document.write(html); w.document.close()
    setTimeout(() => { w.print() }, 400)
  }

  const { openKey, modal: docModal } = useVoucherModal({ raw: fd.raw, allLines: fd.allLines, reload: fd.reload, extraActions: (e) => {
    const inv = e.collection === 'finance_invoices' ? invoices.find(i => i.id === e.id) : null
    if (!inv) return []
    return [
      { label: '✏️ Edit', primary: true, onClick: () => startEdit(inv) },
      { label: '⧉ Clone', onClick: () => startClone(inv) },
      ...(inv.invoiceType === 'SO' && orderProgress(inv).remaining > 0 ? [{ label: '➜ Invoice (all or part)', onClick: () => convertOrder(inv) }, { label: '✕ Close order', onClick: () => closeOrder(inv) }] : []),
      { label: '📄 PDF (for DSC)', onClick: () => handlePdf(inv) },
    ]
  } })

  const seller = sellers[form.company] || {}
  const fx = useFx({ fxRates }, form.invoiceDate)
  // Export under LUT = zero-rated: no GST. Export with payment of IGST is always an inter-state (IGST) supply.
  const exportNoTax = form.isExport && form.exportType === 'WOPAY'
  const effApplyGst = form.applyGst && !exportNoTax
  const effPosCode = form.isExport && !exportNoTax ? '96' : form.posStateCode
  const inrTotals = computeTotals(items, effPosCode, seller.stateCode, effApplyGst)
  // foreign currency: totals in that currency (no rupee rounding) and the rupee value booked in the accounts
  const fcT = fx.isFc ? computeVoucherTotals(items.map(i => ({ ...i, discountPct: 0 })), { supplyType: (form.isExport || !(seller.stateCode && effPosCode && seller.stateCode === effPosCode)) ? 'inter' : 'intra', applyGst: effApplyGst, rounding: false }) : null
  const booked = fcT && fx.rate > 0 ? convertTotals(fcT, fx.rate, fx.currency) : null
  const subTotal = fcT ? fcT.subTotal : inrTotals.subTotal
  const gstLines = fcT ? fcT.gstLines : inrTotals.gstLines
  const total = fcT ? fcT.total : inrTotals.total
  const roundOff = fcT ? 0 : inrTotals.roundOff
  const sym = fx.isFc ? `${fx.symbol} ` : '₹'

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  // ── FORM VIEW ──────────────────────────────────────────────────────────────
  if (view === 'form') return (
    <div className="p-4 max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => { setEditingId(''); setForm(emptyForm); setItems([newItem()]); setView('list') }} className="text-slate-500 hover:text-slate-700">← Back</button>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">{editingId ? `Edit ${INVOICE_TYPES.find(t => t.code === form.invoiceType)?.label || 'Invoice'} — ${invoices.find(i => i.id === editingId)?.invoiceNumber || ''}` : `New ${INVOICE_TYPES.find(t => t.code === form.invoiceType)?.label || 'Invoice'}`}</h2>
      </div>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
      <form onSubmit={handleSave} className="space-y-4">

        {/* Header row */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 grid grid-cols-4 gap-4">
          <div>
            <label className={lbl}>Entity</label>
            <select className={inp} value={form.company} onChange={e => handleCompanyChange(e.target.value)}>
              <option>UIPL</option>
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

        <CurrencyBar fx={fx} date={form.invoiceDate} totalFc={total} label="Invoice currency" />

        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer font-medium">
            <input type="checkbox" checked={form.isExport} onChange={e => setForm(p => ({ ...p, isExport: e.target.checked }))} />
            Export supply (goods or services to a customer outside India)
          </label>
          {form.isExport && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2"><label className={lbl}>Tax treatment</label>
                <select className={inp} value={form.exportType} onChange={e => setForm(p => ({ ...p, exportType: e.target.value }))}>
                  <option value="WOPAY">Zero-rated under LUT — no GST charged</option>
                  <option value="WPAY">With payment of IGST (refund claimed later)</option>
                </select></div>
              <div><label className={lbl}>Shipping bill no.</label><input className={inp} value={form.shippingBillNo} onChange={e => setForm(p => ({ ...p, shippingBillNo: e.target.value }))} /></div>
              <div><label className={lbl}>Shipping bill date</label><input type="date" className={inp} value={form.shippingBillDate} onChange={e => setForm(p => ({ ...p, shippingBillDate: e.target.value }))} /></div>
              <div><label className={lbl}>Port code</label><input className={inp} value={form.portCode} maxLength={6} onChange={e => setForm(p => ({ ...p, portCode: e.target.value.toUpperCase() }))} /></div>
              <p className="col-span-full text-xs text-slate-400">Exports appear in GSTR-1 table 6A. The shipping bill details can be added later by your CA on the portal; leave blank for services.</p>
            </div>
          )}
        </div>

        {false && form.company === 'UIPL' && sellers.Wayzim && (
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer font-medium">
              <input type="checkbox" checked={form.interCompany === 'Wayzim'} onChange={e => {
                const on = e.target.checked, w = sellers.Wayzim || {}
                setForm(p => on
                  ? { ...p, interCompany: 'Wayzim', isExport: true, billToName: w.legalName || 'Wayzim Technology Co Ltd', billToAddress: w.address || '', billToCity: w.city || '', billToState: w.state || '', billToPincode: w.pincode || '', billToGstin: '', customerId: '', posState: 'Other Country', posStateCode: '96' }
                  : { ...p, interCompany: null })
              }} />
              This is UIPL's service fee / commission to Wayzim
            </label>
            <p className="text-xs text-slate-400 mt-1">Fills in Wayzim as the customer and treats it as an export of services. The same invoice then appears in Wayzim's books as a cost and a payable to UIPL — no second entry needed.</p>
          </div>
        )}

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
              <SearchSelect className={inp} value={form.customerId} onChange={handleCustomerChange} placeholder="Type to search customer…" options={customers.map(c => ({ value: c.id, label: c.shopName }))} />
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
                <th className="px-3 py-2" style={{width:'12%'}}>Rate ({fx.isFc ? fx.symbol : '₹'})</th>
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
                    <td className="px-2 py-1">
                      {stockItems.length > 0 && (
                        <select className={`${inp} mb-1 text-xs text-slate-500`} value={it.stockItemId || ''} onChange={e => pickStockItem(idx, e.target.value)}>
                          <option value="">Not a stock item (service / free text)</option>
                          {stockItems.map(x => <option key={x.id} value={x.id}>{x.sku ? `${x.sku} · ` : ''}{x.name}</option>)}
                        </select>
                      )}
                      <input className={inp} value={it.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Item description" />
                    </td>
                    <td className="px-2 py-1"><input className={inp} value={it.hsnCode} onChange={e => { updateItem(idx, 'hsnCode', e.target.value); handleHsnLookup(idx, e.target.value) }} placeholder="85444929" /></td>
                    <td className="px-2 py-1"><input type="number" className={inp} value={it.qty} min={0} onChange={e => updateItem(idx, 'qty', e.target.value)} /></td>
                    <td className="px-2 py-1">
                      <select className={inp} value={it.unit} onChange={e => updateItem(idx, 'unit', e.target.value)}>
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1"><input type="number" className={inp} value={it.rate} min={0} onChange={e => updateItem(idx, 'rate', e.target.value)} /></td>
                    <td className="px-2 py-1"><input type="number" className={inp} value={it.gstRate} min={0} max={40} onChange={e => updateItem(idx, 'gstRate', e.target.value)} /></td>
                    <td className="px-2 py-1 text-right font-medium">{sym}{amt.toLocaleString('en-IN')}</td>
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
                <div className="flex justify-between"><span className="text-slate-500">Sub Total</span><span>{sym}{subTotal.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>
                {gstLines.map((g, i) => (
                  <div key={i} className="flex justify-between text-slate-600"><span>{g.label}</span><span>{sym}{g.amount.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>
                ))}
                {roundOff !== 0 && <div className="flex justify-between text-slate-500"><span>Rounding</span><span>{roundOff.toFixed(2)}</span></div>}
                <div className="flex justify-between font-bold text-base border-t pt-1"><span>Total</span><span>{sym}{total.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>
                {booked && <div className="flex justify-between text-xs text-amber-800 bg-amber-50 rounded px-2 py-1"><span>Booked in accounts as</span><span className="font-semibold">₹{booked.total.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>}
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
            {saving ? 'Saving…' : editingId ? 'Save changes' : `Create ${INVOICE_TYPES.find(t => t.code === form.invoiceType)?.label || 'Invoice'}`}
          </button>
          <button type="button" onClick={() => { setEditingId(''); setView('list'); setForm(emptyForm); setItems([newItem()]) }}
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
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Sales</h2>
          <p className="text-slate-500 text-sm">{tab.blurb}</p>
        </div>
        {params.get('zoho') === '1' && tab.key === 'orders' && <button onClick={() => setShowOrdersImport(true)} className="ml-auto mr-2 px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition">⬆ Import from Zoho</button>}
        {params.get('zoho') === '1' && tab.key === 'invoices' && <button onClick={() => setShowCnImport(true)} className="ml-auto px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition">⬆ Credit notes</button>}
        {params.get('zoho') === '1' && tab.key === 'invoices' && <button onClick={() => setShowImport(true)} className="ml-auto mr-2 px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition">⬆ Import from Zoho</button>}
        <button onClick={() => {
          const s = sellers['UIPL'] || {}
          setForm({ ...emptyForm, invoiceType: tab.type, termsAndConditions: s.termsAndConditions || '' })
          setItems([newItem()]); setView('form')
        }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
          + Create {tab.key === 'orders' ? 'Sales Order' : tab.key === 'proforma' ? 'Pro-forma' : 'Invoice'}
        </button>
      </div>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(t => <button key={t.key} onClick={() => setParams(t.key === 'invoices' ? {} : { tab: t.key })} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${t.key === tab.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{t.label} <span className="text-xs text-slate-400">{invoices.filter(t.match).length}</span></button>)}
        <button onClick={() => navigate('/finance/vouchers/credit_note')} className="px-4 py-2 text-sm font-medium -mb-px border-b-2 border-transparent text-slate-500 hover:text-slate-700">Credit notes <span className="text-xs text-slate-400">{(fd.raw?.vouchers || []).filter(v => v.voucherType === 'credit_note' && v.status !== 'cancelled').length}</span></button>
      </div>
      {docModal}
      {convertFor && <ConvertOrderModal order={convertFor} sellerStateCode={(sellers[convertFor.company] || {}).stateCode} onClose={() => setConvertFor(null)} onConfirm={(r) => createFromOrder(convertFor, r)} />}
      {showOrdersImport && <SalesOrdersImport onClose={() => { setShowOrdersImport(false); loadAll(); fd.reload() }} />}
      {showCnImport && <CreditNotesImport onClose={() => setShowCnImport(false)} onDone={() => { invalidateFinanceCache(); fd.reload() }} />}
      {showImport && <InvoicesImport onClose={() => { setShowImport(false); loadAll() }} />}

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
              <th className="text-left px-4 py-3">{tab.key === 'orders' ? 'Status' : 'Payment'}</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.filter(tab.match).map(inv => (
              <tr key={inv.id} onClick={() => openKey(`invoice:${inv.id}`)} className="hover:bg-blue-50/40 cursor-pointer" title="Open this document">
                <td className="px-4 py-3 font-mono font-bold text-blue-700">{inv.invoiceNumber}{inv.sourceOrderNumber && <span className="block text-[10px] font-normal text-slate-400">from {inv.sourceOrderNumber}</span>}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-indigo-100 text-indigo-700">
                    {INVOICE_TYPES.find(t => t.code === inv.invoiceType)?.label || inv.invoiceType}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{inv.invoiceDate}</td>
                <td className="px-4 py-3 text-slate-800">{inv.billToName || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{inv.poNumber || '—'}</td>
                <td className="px-4 py-3 text-right font-medium">₹{(inv.total || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
                <td className="px-4 py-3">{inv.invoiceType === 'SO' ? <OrderBadge inv={inv} /> : inv.invoiceType === 'PI' ? <span className="text-slate-300">—</span> : <PayStatus st={payStatus(openInv, `invoice:${inv.id}`, inv.total)} today={todayStr()} />}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                  {inv.invoiceType === 'SO' && orderProgress(inv).remaining > 0 && <button onClick={() => convertOrder(inv)} className="text-green-700 hover:text-green-800 font-medium mr-3" title="Create a tax invoice from this order — all of it, or part">➜ Invoice</button>}
                  <button onClick={() => startEdit(inv)} className="text-blue-600 hover:text-blue-700 font-medium mr-3">✏️ Edit</button>
                  <button onClick={() => startClone(inv)} title="Start a new one from this" className="text-blue-600 hover:text-blue-700 font-medium mr-3">⧉ Clone</button>
                  <button onClick={() => handlePrint(inv)}
                    className="text-blue-600 hover:text-blue-700 font-medium">🖨️ Print</button>
                  <button onClick={() => handlePdf(inv)} title="PDF with a digital-signature field — sign it with your DSC, then share"
                    className="text-blue-600 hover:text-blue-700 font-medium ml-3">📄 PDF</button>
                </td>
              </tr>
            ))}
            {invoices.filter(tab.match).length === 0 && (
              <tr><td colSpan={8} className="text-center py-10 text-slate-400">No {tab.label.toLowerCase()} yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
