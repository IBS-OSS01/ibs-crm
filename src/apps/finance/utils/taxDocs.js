// A single, uniform "tax document" shape built from every source that carries
// GST — sales invoices (finance_invoices), purchase / credit / debit vouchers
// (finance_vouchers) and legacy payables. The Sales/Purchase/CN/DN registers
// and (Phase 2) GSTR-1, GSTR-3B, HSN summary and ITC register all read this one
// model, so a number can never differ between two reports.
import { num, r2, normName } from './financeConstants.js'
import { INDIA_STATES, gstinToStateCode } from './indiaConstants.js'
import { computeLineTaxes, supplyTypeOf, gstHead } from './taxCalc.js'
import { isAccountingInvoice } from './ledger.js'

const stateCodeOfName = (name) => INDIA_STATES.find(s => s.name === name)?.code || ''

// gstLines → one row per *effective* GST rate with the taxable value counted
// once (intra-state docs list CGST and SGST separately against the same base).
export function rateWiseFromGstLines(gstLines = []) {
  const m = {}
  gstLines.forEach(g => {
    const head = gstHead(g.label); if (!head) return
    const eff = head === 'igst' ? num(g.rate) : num(g.rate) * 2
    m[eff] = m[eff] || { rate: eff, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }
    if (head !== 'sgst') m[eff].taxable = r2(m[eff].taxable + num(g.base))   // CGST/IGST carry the base once
    m[eff][head] = r2(m[eff][head] + num(g.amount))
  })
  return Object.values(m).sort((a, b) => a.rate - b.rate)
}

const sumHead = (gstLines, head) => r2((gstLines || []).filter(g => gstHead(g.label) === head).reduce((s, g) => s + num(g.amount), 0))

function fromInvoice(inv) {
  const gstLines = inv.gstLines || []
  const stateCode = inv.posStateCode || gstinToStateCode(inv.billToGstin) || stateCodeOfName(inv.billToState)
  const supplyType = supplyTypeOf(inv.sellerStateCode, stateCode)
  const taxable = r2(num(inv.subTotal))
  // Per-line detail for the HSN summary: recompute (stored invoices keep only rate-wise totals).
  const fxRate = inv.fx?.currency && inv.fx.currency !== 'INR' ? Number(inv.fx.rate) || 1 : 1   // foreign invoice: items are typed in that currency
  const items = computeLineTaxes((inv.items || []).map(i => ({ ...i, rate: Number(i.rate) * fxRate, discountPct: 0 })), { supplyType, applyGst: inv.applyGst !== false })
  return {
    key: `invoice:${inv.id}`, docType: 'invoice', kind: 'sales', id: inv.id, collection: 'finance_invoices',
    number: inv.invoiceNumber || inv.id, date: inv.invoiceDate, company: inv.company || 'UIPL',
    partyId: inv.customerId || '', partyName: inv.billToName || '', gstin: (inv.billToGstin || '').toUpperCase(),
    stateCode, stateName: inv.posState || inv.billToState || '',
    sellerGstin: inv.sellerGstin || '', sellerStateCode: inv.sellerStateCode || '', supplyType,
    items, taxable, cgst: sumHead(gstLines, 'cgst'), sgst: sumHead(gstLines, 'sgst'), igst: sumHead(gstLines, 'igst'), cess: 0,
    taxTotal: r2(gstLines.reduce((s, g) => s + num(g.amount), 0)),
    roundOff: r2(num(inv.roundOff)), total: r2(num(inv.total)),
    rateWise: rateWiseFromGstLines(gstLines), rcm: false, narration: inv.notes || '',
    status: inv.status || '', isExport: !!inv.isExport, exportType: inv.exportType || '', shippingBillNo: inv.shippingBillNo || '', shippingBillDate: inv.shippingBillDate || '', portCode: inv.portCode || '',
    currency: inv.fx?.currency || '', fcTotal: inv.fx?.total || 0, fxRate: inv.fx?.rate || 0,
  }
}

function fromVoucher(v, vendorsById) {
  const gstLines = v.gstLines || []
  const vend = v.partyType === 'vendor' ? vendorsById[v.partyId] : null
  const gstin = (v.partyGstin || vend?.gstin || '').toUpperCase()
  const stateCode = v.placeOfSupplyCode || gstinToStateCode(gstin) || v.partyStateCode || stateCodeOfName(vend?.state)
  const kind = v.voucherType === 'purchase' ? 'purchase' : v.voucherType
  return {
    key: `voucher:${v.id}`, docType: v.voucherType, kind, id: v.id, collection: 'finance_vouchers',
    number: v.voucherNumber, externalNumber: v.refNumber || '', externalDate: v.refDate || '',
    date: v.date, company: v.company || 'UIPL',
    partyId: v.partyId || '', partyName: v.partyName || '', gstin, stateCode, stateName: v.partyState || vend?.state || '',
    supplyType: v.supplyType || supplyTypeOf(v.companyStateCode, stateCode),
    items: v.items || [], taxable: r2(num(v.subTotal)),
    cgst: sumHead(gstLines, 'cgst'), sgst: sumHead(gstLines, 'sgst'), igst: sumHead(gstLines, 'igst'), cess: 0,
    taxTotal: r2(gstLines.reduce((s, g) => s + num(g.amount), 0)),
    roundOff: r2(num(v.roundOff)), total: r2(num(v.total)),
    rateWise: rateWiseFromGstLines(gstLines),
    rcm: !!v.rcm, itcEligible: v.itcEligible !== false,
    refInvoiceId: v.refInvoiceId || '', refInvoiceNumber: v.refInvoiceNumber || '', refInvoiceDate: v.refInvoiceDate || '',
    refPurchaseId: v.refPurchaseId || '', reason: v.reason || '', narration: v.narration || '',
    tds: v.tds?.applicable ? v.tds : null, status: v.status || 'active',
    currency: v.currency && v.currency !== 'INR' ? v.currency : '', fcTotal: v.fc?.total || 0, fxRate: v.currency && v.currency !== 'INR' ? v.fxRate : 0,
  }
}

function fromPayable(p) {
  return {
    key: `payable:${p.id}`, docType: 'payable', kind: 'purchase', id: p.id, collection: 'finance_payables', legacy: true,
    number: p.invoiceRef || p.id, externalNumber: p.invoiceRef || '', date: p.invoiceDate, company: 'UIPL', companyInferred: true,
    partyId: '', partyName: p.vendor || '', gstin: '', stateCode: '', stateName: '', supplyType: 'inter',
    items: [], taxable: r2(num(p.amount)), cgst: 0, sgst: 0, igst: 0, cess: 0, taxTotal: 0, roundOff: 0, total: r2(num(p.amount)),
    rateWise: [], rcm: false, itcEligible: false, narration: p.description || '', status: p.status || '',
  }
}

export function normalizeTaxDocs({ invoices = [], vouchers = [], payables = [], vendors = [] }) {
  const vendorsById = Object.fromEntries(vendors.map(v => [v.id, v]))
  return [
    ...invoices.filter(i => i.invoiceDate && isAccountingInvoice(i)).map(fromInvoice),
    ...vouchers.filter(v => v.date && v.status !== 'cancelled' && ['purchase', 'credit_note', 'debit_note'].includes(v.voucherType))
               .map(v => fromVoucher(v, vendorsById)),
    ...payables.filter(p => p.invoiceDate).map(fromPayable),
  ]
}

export const docsOfKind = (docs, kind, { company, from, to } = {}) =>
  docs.filter(d => d.kind === kind &&
    (!company || d.company === company) &&
    (!from || (d.date || '') >= from) &&
    (!to || (d.date || '') <= to))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.number).localeCompare(String(b.number)))

// Month-wise summary (Tally registers open on this view).
export function monthWise(docs) {
  const m = {}
  docs.forEach(d => {
    const k = (d.date || '').slice(0, 7); if (!k) return
    m[k] = m[k] || { month: k, count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }
    m[k].count++
    m[k].taxable = r2(m[k].taxable + d.taxable); m[k].cgst = r2(m[k].cgst + d.cgst)
    m[k].sgst = r2(m[k].sgst + d.sgst); m[k].igst = r2(m[k].igst + d.igst); m[k].total = r2(m[k].total + d.total)
  })
  return Object.values(m).sort((a, b) => a.month.localeCompare(b.month))
}

export const partyNameKey = normName
