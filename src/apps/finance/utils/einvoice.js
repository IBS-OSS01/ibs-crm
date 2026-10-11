// Offline JSON for the government portals — the free-plan route to e-invoice (IRN) and
// e-way bill: this app builds the files, you upload them on the portals, then record the
// IRN / e-way bill numbers the portals return.
//
//   • e-invoice: "Generate IRN in bulk" on the IRP (schema INV-01, version 1.1)
//   • e-way bill: "Bulk generation" on ewaybillgst.gov.in (version 1.0.0621)
//   • GSTR-3B: offline-upload JSON
//
// ⚠ Portal schemas and validation rules change. Upload a single test invoice first and
// have your CA confirm eligibility (e-invoicing applies above a turnover threshold;
// e-way bills above ₹50,000 consignment value, with exceptions).
import { num, r2 } from './financeConstants.js'
import { computeLineTaxes, supplyTypeOf } from './taxCalc.js'
import { portalDate, periodCode, isRegisteredGstin } from './gstReturns.js'

const UQC = { pcs: 'PCS', nos: 'NOS', set: 'SET', kg: 'KGS', ltr: 'LTR', mtr: 'MTR', sqft: 'SQF', box: 'BOX', hours: 'OTH', days: 'OTH', lot: 'OTH' }
export const toUqc = (u) => UQC[String(u || '').toLowerCase()] || 'OTH'
const slash = (iso) => portalDate(iso).replace(/-/g, '/')                 // e-invoice dates are dd/mm/yyyy
const cut = (s, n) => String(s ?? '').trim().slice(0, n)
const stateCodeOf = (gstin) => (gstin || '').slice(0, 2)

// Why an invoice can't go to the IRP / e-way bill as it stands.
export function invoiceProblems(inv, seller) {
  const p = []
  if (!isRegisteredGstin(seller?.gstin)) p.push('Your GSTIN is missing in Company Settings.')
  if (!isRegisteredGstin(inv.billToGstin)) p.push('Buyer GSTIN is missing or invalid (e-invoice is for B2B supplies).')
  if (!/^\d{6}$/.test(String(inv.billToPincode || '').trim())) p.push('Buyer pincode must be 6 digits.')
  if (!(inv.billToAddress || '').trim()) p.push('Buyer address is empty.')
  if (!(inv.billToCity || '').trim()) p.push('Buyer city / place is empty.')
  if (!/^\d{6}$/.test(String(seller?.pincode || '').trim())) p.push('Your pincode is missing in Company Settings.')
  if (!(inv.items || []).length) p.push('Invoice has no items.')
  ;(inv.items || []).forEach((i, n) => { if (!/^\d{4,8}$/.test(String(i.hsnCode || '').trim())) p.push(`Line ${n + 1}: HSN/SAC must be 4–8 digits.`) })
  return p
}

export function buildEInvoice(inv, seller) {
  const buyerState = inv.posStateCode || stateCodeOf(inv.billToGstin)
  const supply = supplyTypeOf(seller.stateCode, buyerState)
  const lines = computeLineTaxes((inv.items || []).map(i => ({ ...i, discountPct: 0 })), { supplyType: supply, applyGst: inv.applyGst !== false })
  const items = lines.map((l, i) => {
    const gross = r2(num(l.qty) * num(l.rate))
    return {
      SlNo: String(i + 1), PrdDesc: cut(l.description, 300) || 'Item', IsServc: String(l.hsnCode || '').startsWith('99') ? 'Y' : 'N', HsnCd: String(l.hsnCode || '').trim(),
      Qty: num(l.qty), Unit: toUqc(l.unit), UnitPrice: num(l.rate), TotAmt: gross, Discount: 0, AssAmt: l.taxable, GstRt: num(l.gstRate),
      IgstAmt: l.igst, CgstAmt: l.cgst, SgstAmt: l.sgst, CesRt: 0, CesAmt: 0, OthChrg: 0, TotItemVal: l.lineTotal,
    }
  })
  const sum = (f) => r2(items.reduce((s, i) => s + i[f], 0))
  const total = r2(sum('TotItemVal'))
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: cut(inv.invoiceNumber, 16), Dt: slash(inv.invoiceDate) },
    SellerDtls: { Gstin: seller.gstin, LglNm: cut(seller.legalName, 100), Addr1: cut(seller.address, 100), Loc: cut(seller.city, 50), Pin: Number(seller.pincode), Stcd: seller.stateCode || stateCodeOf(seller.gstin) },
    BuyerDtls: { Gstin: inv.billToGstin, LglNm: cut(inv.billToName, 100), Pos: buyerState, Addr1: cut(inv.billToAddress, 100), Loc: cut(inv.billToCity, 50), Pin: Number(String(inv.billToPincode).trim()), Stcd: stateCodeOf(inv.billToGstin) },
    ItemList: items,
    ValDtls: { AssVal: sum('AssAmt'), CgstVal: sum('CgstAmt'), SgstVal: sum('SgstAmt'), IgstVal: sum('IgstAmt'), CesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: r2(num(inv.total) - total), TotInvVal: r2(num(inv.total) || total) },
  }
}

export function buildEwayBill(inv, seller, t) {
  const buyerState = inv.posStateCode || stateCodeOf(inv.billToGstin)
  const supply = supplyTypeOf(seller.stateCode, buyerState)
  const lines = computeLineTaxes((inv.items || []).map(i => ({ ...i, discountPct: 0 })), { supplyType: supply, applyGst: inv.applyGst !== false })
  const sum = (f) => r2(lines.reduce((s, l) => s + l[f], 0))
  const ship = !inv.sameShipTo && inv.shipToAddress
  return {
    supplyType: 'O', subSupplyType: 1, subSupplyDesc: '', docType: 'INV', docNo: cut(inv.invoiceNumber, 16), docDate: slash(inv.invoiceDate),
    fromGstin: seller.gstin, fromTrdName: cut(seller.legalName, 100), fromAddr1: cut(seller.address, 120), fromAddr2: '', fromPlace: cut(seller.city, 50), fromPincode: Number(seller.pincode), fromStateCode: Number(seller.stateCode), actFromStateCode: Number(seller.stateCode),
    toGstin: inv.billToGstin, toTrdName: cut(inv.billToName, 100), toAddr1: cut(ship ? inv.shipToAddress : inv.billToAddress, 120), toAddr2: '', toPlace: cut(ship ? inv.shipToCity : inv.billToCity, 50),
    toPincode: Number(String((ship ? inv.shipToPincode : inv.billToPincode) || inv.billToPincode).trim()), toStateCode: Number(stateCodeOf(inv.billToGstin)), actToStateCode: Number(buyerState),
    transactionType: ship ? 2 : 1, totalValue: sum('taxable'), cgstValue: sum('cgst'), sgstValue: sum('sgst'), igstValue: sum('igst'), cessValue: 0, cessNonAdvolValue: 0, otherValue: 0, totInvValue: r2(num(inv.total)),
    transMode: Number(t.mode || 1), transDistance: String(Math.round(num(t.distance))), transporterName: cut(t.transporterName, 100), transporterId: (t.transporterId || '').trim(),
    transDocNo: cut(t.docNo, 15), transDocDate: t.docDate ? slash(t.docDate) : '', vehicleNo: (t.vehicleNo || '').replace(/[\s-]/g, '').toUpperCase(), vehicleType: 'R',
    itemList: lines.map(l => ({ productName: cut(l.description, 100) || 'Item', productDesc: cut(l.description, 100), hsnCode: Number(String(l.hsnCode).trim()), quantity: num(l.qty), qtyUnit: toUqc(l.unit), taxableAmount: l.taxable,
      sgstRate: supply === 'intra' ? num(l.gstRate) / 2 : 0, cgstRate: supply === 'intra' ? num(l.gstRate) / 2 : 0, igstRate: supply === 'inter' ? num(l.gstRate) : 0, cessRate: 0 })),
  }
}

export const ewbBulkFile = (bills, gstin) => ({ version: '1.0.0621', billLists: bills.map(b => ({ userGstin: gstin, ...b })) })

// Problems specific to the e-way bill.
export function ewayProblems(t, inv) {
  const p = []
  if (num(t.distance) <= 0) p.push('Enter the approximate distance in km.')
  if (Number(t.mode || 1) === 1 && !(t.vehicleNo || t.transporterId)) p.push('Road transport needs a vehicle number or a transporter ID.')
  if (Number(t.mode || 1) !== 1 && !(t.docNo && t.docDate)) p.push('Rail / air / ship need the transport document number and date.')
  if (num(inv.total) < 50000) p.push('Consignment value is under ₹50,000 — an e-way bill is normally not required.')
  return p
}

// ── GSTR-3B offline JSON ────────────────────────────────────────────────────
export function gstr3bJson(g, { gstin, to }) {
  const o = (x) => ({ txval: x.taxable, iamt: x.igst, camt: x.cgst, samt: x.sgst, csamt: 0 })
  const itc = (x) => ({ iamt: x.igst, camt: x.cgst, samt: x.sgst, csamt: 0 })
  return {
    gstin, ret_period: periodCode(to),
    sup_details: { osup_det: o(g.t31a), osup_zero: { txval: g.t31b?.taxable || 0, iamt: g.t31b?.igst || 0, csamt: 0 }, osup_nil_exmp: { txval: g.t31c.taxable }, isup_rev: o(g.t31d), osup_nongst: { txval: 0 } },
    inter_sup: { unreg_details: g.interUnreg.map(x => ({ pos: x.pos, txval: x.taxable, iamt: x.igst })), comp_details: [], uin_details: [] },
    itc_elg: {
      itc_avl: [{ ty: 'IMPG', iamt: 0, camt: 0, samt: 0, csamt: 0 }, { ty: 'IMPS', iamt: 0, camt: 0, samt: 0, csamt: 0 }, { ty: 'ISRC', ...itc(g.itcRcm) }, { ty: 'ISD', iamt: 0, camt: 0, samt: 0, csamt: 0 }, { ty: 'OTH', ...itc(g.itcOther) }],
      itc_rev: [{ ty: 'RUL', iamt: 0, camt: 0, samt: 0, csamt: 0 }, { ty: 'OTH', ...itc(g.itcRevOther) }],
      itc_net: itc(g.netItc),
      itc_inelg: [{ ty: 'RUL', iamt: 0, camt: 0, samt: 0, csamt: 0 }, { ty: 'OTH', ...itc(g.itcBlocked) }],
    },
    inward_sup: { isup_details: [{ ty: 'GST', inter: 0, intra: 0 }, { ty: 'NONGST', inter: 0, intra: 0 }] },
    intr_ltfee: { intr_details: { iamt: 0, camt: 0, samt: 0, csamt: 0 } },
  }
}
