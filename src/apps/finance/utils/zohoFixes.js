// One-time corrections found by comparing the books with Zoho Books (the old system), 13 Oct 2026.
// Every proposal is an ordinary voucher edit / new voucher (kept in the audit log); nothing is written until the user presses Apply.
//   1. vendor payments that were booked with no vendor (paid to a director's ledger, transport, travel … ) → pay the vendor's bill
//   2. two bank lines "SALARY …" that were attached to the vendor S.R. Engineering → salary
//   3. Wayzim: bank charges that sat inside the vendor payment, and the ₹37.5 L debit note Zoho has against bill WAYZ-27042025IN-02
//   4. vendor credits (debit notes) that exist in Zoho only
//   5. vendor payments that exist in Zoho only (to be matched with the bank statement once it is uploaded)
//   5b. the ₹90,000 paid to the clearing agent on 3 Jul 2025: Zoho kept it in a "Vendor Clearing Account" and paid four vendor bills out of it
//   5d. ₹15,988 of a transfer to the director (17 Nov 2025) that he paid on to Bhakti Electricals
//   5c. airline bills that MakeMyTrip paid (Zoho journals 192 / 193 moved the payable from the airline to MakeMyTrip)
//   5e. invoices raised in Zoho in October 2026 that are not in our books yet (UI/SL/26-27/16 Instakart, /17 Wayzim), the ₹73,700 credit note that Zoho charges to Transport
//   6. receipts: a refund booked as a customer receipt, and an on-account Instakart receipt settled against its invoice
import { r2, num } from './financeConstants.js'

const P = 'UIPL/PAY/'
// [voucher, vendor (as named in the books), Zoho bill numbers it paid]
const REPOINT = [
  ['26-27/071', 'THE INDIAN HOTELS COMPANY LTD', ['CS1002000619', 'CS1002000620', 'CS1002000621', 'CS1002000622', 'CS1002000623', 'CS1002000624', 'CS1002000625', 'DR1002000071']],
  ['26-27/113', 'VENUS DATA PRODUCTS PRIVATE LIMITED', ['MH54/2627/623']],
  ['25-26/216', 'MAKEMYTRIP (INDIA) PRIVATE LIMITED', ['M06A126123924691']],
  ['25-26/288', 'DHL EXPRESS (INDIA) PRIVATE LIMITED- DELHI', ['DEL717619']],
  ['25-26/242', 'DHL EXPRESS (INDIA) PRIVATE LIMITED- DELHI', ['DEL987586']],
  ['25-26/204', 'SCHAEFFLER DIGITAL SOLUTIONS INDIA PRIVATE LIMITED', ['DACPL540']],
  ['25-26/248', 'DHL EXPRESS (INDIA) PRIVATE LIMITED- MUMBAI', ['MHSIR00882448']],
  ['25-26/217', 'DARSHAN TYRES', ['SR/05075/25-26']],
  ['25-26/243', 'DHL EXPRESS (INDIA) PRIVATE LIMITED- DELHI', ['DEL987394']],
  ['26-27/102', 'DHL EXPRESS (INDIA) PRIVATE LIMITED- DELHI', ['DEL903243']],
  ['26-27/104', 'DHL EXPRESS (INDIA) PRIVATE LIMITED- MUMBAI', ['MHSIR01009021']],
  ['26-27/105', 'CIMPRESS INDIA PRIVATE LIMITED', ['260803161511593']],
  ['26-27/073', 'Shelke Travels', ['186']],
  ['26-27/080', 'ABHIJEET RAMSWAROOP VISHWAKARMA', ['INV-2627040']],
  ['26-27/120', 'ZOHO Corporation Private Limited', ['1026270062206']],
  ['25-26/200', 'VIJAY SALES (INDIA) PRIVATE LIMITED', ['PNR-F-SIRT1905']],
  ['25-26/213', 'Aroma Laterite Chalets Agri Tourism Centre', ['F-12/015/25-26', 'R-12/015/25-26']],
  ['26-27/076', 'SwaRee Cabs', ['INV11014']],
  ['25-26/290', 'DHL EXPRESS (INDIA) PRIVATE LIMITED- MUMBAI', ['MHSIR00945875']],
  ['25-26/192', 'EMUDHRA LIMITED', ['29RT25054452']],
  ['26-27/109', 'LIFESTYLE INTERNATIONAL PRIVATE LIMITED', ['016581040165936']],
  ['25-26/212', 'RAY STEEL & HARDWARE', ['726']],
  ['26-27/074', 'Shelke Travels', ['186']],
  ['26-27/072', 'Shelke Travels', ['186']],
]
const SALARY_FIX = ['25-26/017', '25-26/032']          // "SALARY JUNE 25 / JULY 2025 … KHARBANDA S" — attached to S.R. Engineering by mistake
// Zoho vendor payments that are not in the books yet: [date, vendor, bill, amount, 'bank' | 'cash']
const MISSING = [
  ['2026-10-07', 'S.R. ENGINEERING', '2026-27/164', 90276.8, 'bank'],
  ['2026-10-07', 'S.R. ENGINEERING', '2026-27/131', 87750, 'bank'],
  ['2025-12-13', 'Aroma Laterite Chalets Agri Tourism Centre', 'R-12/015/25-26', 10000, 'director'],
]
// Zoho vendor credits: [date, number, vendor, bill it was applied to, amount]
const DEBIT_NOTES = [
  ['2026-06-23', 'DN-00001', 'Wayzim Technology co ltd', 'WAYZ-27042025IN-02', 3752011.42],
  ['2026-04-30', 'DG1002000345', 'THE INDIAN HOTELS COMPANY LTD', 'DR1002000079', 13034],
  ['2026-07-20', 'DN-00002', 'S.R. ENGINEERING', '2026-27/066', 765],
  ['2026-07-20', 'DN-00003', 'S.R. ENGINEERING', '2026-27/066', 823],
]

const rd = (x) => Math.round((x + Number.EPSILON) * 100) / 100

// raw: the finance data (vouchers, invoices, bankAccounts); returns the proposals, each { key, group, title, detail, amount, kind, id?, before?, fields?, data? }
export function buildZohoFixes(raw) {
  const vouchers = (raw?.vouchers || []).filter(v => v.status !== 'cancelled')
  const byNo = Object.fromEntries(vouchers.map(v => [v.voucherNumber, v]))
  const bills = vouchers.filter(v => v.voucherType === 'purchase')
  const billOf = (vendor, ref) => bills.find(b => b.partyName === vendor && String(b.refNumber).trim() === String(ref).trim())
  const out = []

  // vouchers that will be edited: their present allocations are replaced, so they do not count
  const editedNos = new Set([...REPOINT.map(r => P + r[0]), ...SALARY_FIX.map(n => P + n), P + '25-26/009', P + '26-27/009', P + '25-26/203', P + '25-26/211', P + '25-26/175'])
  const alloc = {}
  vouchers.forEach(v => { if (editedNos.has(v.voucherNumber)) return; (v.allocations || []).forEach(a => { alloc[a.billKey] = (alloc[a.billKey] || 0) + num(a.amount) }) })
  vouchers.filter(v => v.voucherType === 'debit_note' && v.refPurchaseId).forEach(v => { alloc['purchase:' + v.refPurchaseId] = (alloc['purchase:' + v.refPurchaseId] || 0) + num(v.total) })
  const openOf = (b) => rd(num(b.total) - (b.tds?.applicable ? num(b.tds.amount) : 0) - (alloc['purchase:' + b.id] || 0))
  const take = (b, want) => { const t = rd(Math.min(want, Math.max(openOf(b), 0))); if (t > 0) alloc['purchase:' + b.id] = (alloc['purchase:' + b.id] || 0) + t; return t }
  const allocLine = (b, amt) => ({ billKey: 'purchase:' + b.id, docNumber: b.voucherNumber, amount: amt })

  // 2. salary attached to a vendor
  for (const n of SALARY_FIX) {
    const v = byNo[P + n]; if (!v || !v.partyId) continue
    const amt = rd(num(v.amount))
    out.push({ key: v.id, group: 'Salary wrongly booked to a vendor', kind: 'update', id: v.id, before: v, amount: amt, title: `${v.voucherNumber} · ${v.date}`,
      detail: `Now: payment to ${v.partyName} (linked to its bills). The bank narrative is "${(v.narration || '').slice(0, 40)}" — director's salary → 5110 Salaries.`,
      fields: { partyType: '', partyId: '', partyName: '', partyAmount: 0, allocations: [], accountLines: [{ accountCode: '5110', amount: amt, description: 'Salary (bank narrative)' }] } })
  }

  // 2b. "GST PAYMENT … KHARBANDA S" ₹2,298 (GSTR-3B May 2025) had been attached to S.L. Insurance and its bill
  const gst = byNo[P + '25-26/175']
  if (gst && gst.partyId && /GST PAYMENT/i.test(gst.narration || '')) {
    out.push({ key: gst.id, group: 'GST payment wrongly booked to a vendor', kind: 'update', id: gst.id, before: gst, amount: num(gst.amount), title: `${gst.voucherNumber} · ${gst.date}`,
      detail: `Now: payment to ${gst.partyName}. The bank narrative says GST PAYMENT (Zoho journal 183, GSTR-3B May 2025) → 2400 GST Payable.`,
      fields: { partyType: '', partyId: '', partyName: '', partyAmount: 0, allocations: [], accountLines: [{ accountCode: '2400', amount: rd(num(gst.amount)), description: 'GST payment (GSTR-3B May 2025)' }] } })
  }

  // 3. Wayzim: bank charges inside the vendor payment, split out → exchange / bank loss line; bills settled as Zoho has them
  const wIn1 = bills.find(b => b.refNumber === 'WAYZ-27042025IN-01'), wIn2 = bills.find(b => b.refNumber === 'WAYZ-27042025IN-02')
  const w1 = byNo[P + '25-26/009'], w2 = byNo[P + '26-27/009']
  if (wIn1 && wIn2 && w1 && w2 && w1.partyAmount === w1.amount && w2.partyAmount === w2.amount) {
    const a1 = take(wIn1, 3087705.99)
    const a2 = take(wIn1, 3460208.59), a3 = take(wIn2, rd(3460208.59 - a2))
    out.push({ key: w1.id, group: 'Wayzim payments', kind: 'update', id: w1.id, before: w1, amount: w1.amount, title: `${w1.voucherNumber} · ${w1.date}`,
      detail: `Bank sent ₹${w1.amount.toLocaleString('en-IN')}; Zoho shows ₹3,087,705.99 to the vendor — ₹${rd(w1.amount - 3087705.99)} is the bank's charge. Booked as a bank loss on settlement.`,
      fields: { partyAmount: 3087705.99, bankAmountInr: w1.amount, allocations: [allocLine(wIn1, a1)] } })
    out.push({ key: w2.id, group: 'Wayzim payments', kind: 'update', id: w2.id, before: w2, amount: w2.amount, title: `${w2.voucherNumber} · ${w2.date}`,
      detail: `Bank sent ₹${w2.amount.toLocaleString('en-IN')}; Zoho shows ₹3,460,208.59 to the vendor — ₹${rd(w2.amount - 3460208.59)} is the bank's charge. Settles the rest of ${wIn1.refNumber} and part of ${wIn2.refNumber}.`,
      fields: { partyAmount: 3460208.59, bankAmountInr: w2.amount, allocations: [allocLine(wIn1, a2), allocLine(wIn2, a3)].filter(x => x.amount > 0) } })
  }

  // 4. vendor credits → debit notes against the bill
  for (const [date, number, vendor, billRef, total] of DEBIT_NOTES) {
    const b = billOf(vendor, billRef)
    if (!b || vouchers.some(v => v.voucherType === 'debit_note' && v.refNumber === number)) continue
    const f = total / num(b.total)
    const items = (b.items || []).map(i => ({ ...i, taxable: rd(num(i.taxable) * f), ...(i.amount !== undefined ? { amount: rd(num(i.amount) * f) } : {}), ...(i.rate !== undefined && i.qty ? { rate: rd(num(i.rate) * f) } : {}) }))
    const gstLines = (b.gstLines || []).map(g => ({ ...g, base: rd(num(g.base) * f), amount: rd(num(g.amount) * f) }))
    const taxTotal = rd(gstLines.reduce((s, g) => s + num(g.amount), 0)), subTotal = rd(items.reduce((s, i) => s + num(i.taxable), 0))
    if (items.length) items[0].taxable = rd(items[0].taxable + (total - subTotal - taxTotal))          // rounding sits on the first line
    alloc['purchase:' + b.id] = (alloc['purchase:' + b.id] || 0) + total
    out.push({ key: 'dn' + number, group: 'Vendor credits (debit notes) that are only in Zoho', kind: 'create', amount: total, title: `${number} · ${date} · ${vendor}`,
      detail: `Zoho vendor credit applied to bill ${billRef}.`,
      data: { voucherType: 'debit_note', company: 'UIPL', date, partyType: 'vendor', partyId: b.partyId, partyName: b.partyName, partyGstin: b.partyGstin || '', refPurchaseId: b.id, refPurchaseNumber: b.voucherNumber, refNumber: number,
        narration: `Zoho vendor credit ${number}`, reason: 'Purchase return / credit', items, subTotal: rd(items.reduce((s, i) => s + num(i.taxable), 0)), gstLines, taxTotal, total, roundOff: 0, applyGst: gstLines.length > 0,
        supplyType: b.supplyType, placeOfSupplyCode: b.placeOfSupplyCode, partyStateCode: b.partyStateCode, companyStateCode: b.companyStateCode, itcEligible: b.itcEligible !== false, currency: 'INR', fxRate: 1, source: 'zoho-fix' } })
  }

  // 1. payments booked without a vendor → the vendor, allocated to the bills
  for (const [no, vendor, refs] of REPOINT) {
    const v = byNo[P + no]; if (!v || v.partyId) continue
    const vb = bills.find(b => b.partyName === vendor); if (!vb) continue
    let rem = rd(num(v.amount)); const al = []
    for (const r of refs) { const b = billOf(vendor, r); if (!b || rem <= 0) continue; const t = take(b, rem); if (t > 0) { al.push(allocLine(b, t)); rem = rd(rem - t) } }
    out.push({ key: v.id, group: 'Vendor payments booked without a vendor', kind: 'update', id: v.id, before: v, amount: num(v.amount), title: `${v.voucherNumber} · ${v.date}`,
      detail: `Now in ${(v.accountLines || []).map(a => a.accountCode).join(', ') || 'a ledger'} → ${vendor}, bill${al.length > 1 ? 's' : ''} ${al.map(a => a.docNumber.split('/').slice(-1)[0]).join(', ') || refs.join(', ')} (${refs.join(', ')}).`,
      fields: { partyType: 'vendor', partyId: vb.partyId, partyName: vb.partyName, partyAmount: rd(num(v.amount)), accountLines: [], allocations: al } })
  }

  // 5b. the clearing agent's ₹90,000: four vendor bills were paid out of it (Zoho: Journal 120 → Vendor Clearing Account → payments 28, 30, 31 and, in May 2026, Computer World); the rest was clearing expense
  const cha = byNo[P + '25-26/203']
  if (cha && !cha.partyId && num(cha.amount) === 90000) {
    const list = [['APOLLO LOGISOLUTIONS LIMITED', 'ALSI003043/25-26', 42314.8], ['EMPEZAR GLOBAL MARINE SERVICES PRIVATE LIMITED', 'MHCL252608414', 4600], ['S.L.INSURANCE SOLUTIONS', 'SLIS/04/0400245', 255], ['M/S COMPUTER WORLD', '00079', 2000]]
    const al = [], names = []
    for (const [vn, ref, amt] of list) { const b = billOf(vn, ref); if (!b) continue; const t = take(b, amt); if (t > 0) { al.push(allocLine(b, t)); names.push(ref) } }
    const first = bills.find(b => b.id === al[0]?.billKey?.slice(9))
    if (first) {
      const paid = rd(al.reduce((x, a) => x + a.amount, 0))
      out.push({ key: cha.id, group: 'Payment to the clearing agent that paid vendor bills', kind: 'update', id: cha.id, before: cha, amount: 90000, title: `${cha.voucherNumber} · ${cha.date}`,
        detail: `Now parked in 5195. Zoho kept this ₹90,000 (CHA fees, Nimesh Sheth) in a "Vendor Clearing Account" and paid these bills from it: ${names.join(', ')} (₹${paid.toLocaleString('en-IN')}); the other ₹${rd(90000 - paid).toLocaleString('en-IN')} settles the shipment-commission expense already booked as PAY/25-26/218 (so it is not counted twice).`,
        fields: { partyType: 'vendor', partyId: first.partyId, partyName: first.partyName, partyAmount: paid, allocations: al, accountLines: [{ accountCode: '2900', amount: rd(90000 - paid), description: 'CHA clearing — pays the shipment commission expense PAY/25-26/218' }] } })
    }
  }

  // 5d. the director's ₹72,948 transfer of 17 Nov 2025 included ₹15,988 that he paid to Bhakti Electricals on the company's behalf
  const kd = byNo[P + '25-26/211'], bhakti = billOf('BHAKTI ELECTRICALS AND TRADING', '6727/2025-26')
  if (kd && bhakti && !kd.partyId && num(kd.amount) === 72948) {
    const t = take(bhakti, 15988)
    if (t > 0) out.push({ key: kd.id, group: 'Director transfer that paid a vendor', kind: 'update', id: kd.id, before: kd, amount: 72948, title: `${kd.voucherNumber} · ${kd.date}`,
      detail: `Of this transfer to the director (2910), ₹15,988 was paid on by him to Bhakti Electricals (bill 6727/2025-26); the other ₹${rd(72948 - t).toLocaleString('en-IN')} stays in the director's account.`,
      fields: { partyType: 'vendor', partyId: bhakti.partyId, partyName: bhakti.partyName, partyAmount: t, allocations: [allocLine(bhakti, t)], accountLines: [{ accountCode: '2910', amount: rd(72948 - t), description: (kd.accountLines?.[0]?.description) || "Paid to a director" }] } })
  }

  // 5c. SpiceJet and SNV Aviation tickets were bought through MakeMyTrip: Zoho journals 192 and 193 moved the payable to MakeMyTrip
  const mmtBill = bills.find(b => b.partyName === 'MAKEMYTRIP (INDIA) PRIVATE LIMITED')
  if (mmtBill) {
    for (const [vendor, ref, jn] of [['SNV AVIATION PRIVATE LIMITED', '271RE2TXX0326001', '193'], ['SPICEJET LIMITED', '12726/0000525857', '192'], ['SPICEJET LIMITED', '22726/0000180091', '192']]) {
      const b = billOf(vendor, ref); if (!b) continue
      out.push({ key: 'mmt-' + b.id, group: 'Airline bills that MakeMyTrip paid', kind: 'update', id: b.id, before: b, amount: num(b.total), title: `${b.voucherNumber} · ${b.date} · ${vendor}`,
        detail: `Zoho journal ${jn} moved this payable from ${vendor} to MakeMyTrip. The bill's GST details stay as they are; only the party who is owed changes.`,
        fields: { partyId: mmtBill.partyId, partyName: mmtBill.partyName } })
    }
  }

  // 5. vendor payments that exist only in Zoho
  const hsbc = (raw?.bankAccounts || []).find(b => /hsbc/i.test(b.name || ''))
  for (const [date, vendor, ref, amt, mode] of MISSING) {
    const b = billOf(vendor, ref); if (!b) continue
    if (vouchers.some(v => v.voucherType === 'payment' && v.partyId === b.partyId && v.date === date && Math.abs(num(v.amount) - amt) < 0.5)) continue
    const t = take(b, amt)
    out.push({ key: `new-${ref}-${date}`, group: 'Vendor payments that are only in Zoho', kind: 'create', amount: amt, title: `${date} · ${vendor}`,
      detail: `${mode === 'bank' ? `Bank transfer from ${hsbc?.name || 'HSBC'} — match it with the statement line once the statement is uploaded` : 'Paid by the director out of the ₹40,000 advance of 25 Sep 2025 (PAY/25-26/207) — Zoho paid it through its "Debt" account'} · bill ${ref}.`,
      data: { voucherType: 'payment', company: 'UIPL', date, refNumber: '', narration: `Zoho Books payment for bill ${ref}`, partyType: 'vendor', partyId: b.partyId, partyName: b.partyName,
        partyAmount: amt, allocations: t > 0 ? [allocLine(b, t)] : [], accountLines: [], bankAccountCode: mode === 'bank' ? '1100' : '2910', bankAccountId: mode === 'bank' ? (hsbc?.id || '') : '',
        amount: amt, currency: 'INR', fxRate: 1, bankAmountInr: null, onAccountFc: 0, tds: { applicable: false } } })
  }

  // 6. receipts
  const mmt = byNo['UIPL/RCT/26-27/039']
  if (mmt && mmt.partyId && !(mmt.allocations || []).length) {
    out.push({ key: mmt.id, group: 'Receipts', kind: 'update', id: mmt.id, before: mmt, amount: num(mmt.amount), title: `${mmt.voucherNumber} · ${mmt.date} · ${mmt.partyName}`,
      detail: 'Money received from MakeMyTrip was a refund of a travel bill (Zoho vendor credit RBILL/26-27/04/0001), not a customer advance → credited to 5125 Travel & Conveyance.',
      fields: { partyType: '', partyId: '', partyName: '', partyAmount: 0, allocations: [], accountLines: [{ accountCode: '5125', amount: rd(num(mmt.amount)), description: 'Refund received from MakeMyTrip (vendor credit)' }] } })
  }
  const ik = byNo['UIPL/RCT/26-27/017'], inv = (raw?.invoices || []).find(i => i.invoiceNumber === 'UI/SL/26-27/12')
  if (ik && inv && !(ik.allocations || []).length) {
    out.push({ key: ik.id, group: 'Receipts', kind: 'update', id: ik.id, before: ik, amount: num(ik.partyAmount || ik.amount), title: `${ik.voucherNumber} · ${ik.date} · ${ik.partyName}`,
      detail: 'Unapplied advance of the customer settled against its open invoice UI/SL/26-27/12 (₹10,71,440), as Zoho has it.',
      fields: { allocations: [{ billKey: 'invoice:' + inv.id, docNumber: inv.invoiceNumber, amount: rd(num(ik.partyAmount || ik.amount)) }] } })
  }
  // 5e. Zoho invoices of October 2026 that we do not have, and the credit note Zoho books to Transportation Expense
  const invs = raw?.invoices || []
  const haveInv = (n) => invs.some(i => i.invoiceNumber === n && i.status !== 'cancelled')
  const tplW = invs.find(i => i.invoiceNumber === 'UI/SL/26-27/15'), tplI = invs.find(i => i.invoiceNumber === 'UI/SL/26-27/12')
  const clone = (t) => { const c = JSON.parse(JSON.stringify(t)); ['id', 'sourceOrderId', 'sourceOrderNumber', 'zohoInvoiceId', 'revenueSplit', 'revenueAccountCode', 'updatedAt', 'updatedBy'].forEach(k => delete c[k]); return c }
  if (tplW && !haveInv('UI/SL/26-27/17')) {
    const rates = [1105705, 77399, 138369, 9685], items = tplW.items.map((it, k) => ({ ...it, rate: rates[k], qty: 1 }))
    out.push({ key: 'newinv17', group: 'Invoices raised in Zoho that are not in our books', kind: 'invoiceCreate', amount: 1346833.12, title: '2026-10-16 · UI/SL/26-27/17 · Wayzim Technology',
      detail: 'EOR payments for the month: salaries ₹11,05,705 + expenses ₹1,38,369 (→ EOR ledger) and administration fees ₹87,084 (→ Sales); GST ₹15,675.12; total ₹13,46,833.12, due 26 Oct.',
      data: { ...clone(tplW), invoiceNumber: 'UI/SL/26-27/17', invoiceDate: '2026-10-16', dueDate: '2026-10-26', zohoInvoiceId: '3807682000000643045', items, subTotal: 1331158, roundOff: 0, total: 1346833.12, totalInWords: '',
        gstLines: [{ label: 'CGST 9%', rate: 9, base: 87084, amount: 7837.56 }, { label: 'SGST 9%', rate: 9, base: 87084, amount: 7837.56 }], revenueSplit: [{ accountCode: '2160', amount: 1244074 }, { accountCode: '4000', amount: 87084 }], status: 'sent', source: 'zoho-import' } })
  }
  if (tplI && !haveInv('UI/SL/26-27/16')) {
    out.push({ key: 'newinv16', group: 'Invoices raised in Zoho that are not in our books', kind: 'invoiceCreate', amount: 857393.41, title: '2026-10-01 · UI/SL/26-27/16 · Instakart (Mumbai)',
      detail: 'CMC - comprehensive maintenance contract 24x7, Saidham project Q1 (1 Oct - 31 Dec 2026): 3 × ₹2,42,201.53 = ₹7,26,604.59 + GST ₹1,30,788.82; total ₹8,57,393.41, PO26203139198, due 31 Oct.',
      data: { ...clone(tplI), invoiceNumber: 'UI/SL/26-27/16', invoiceDate: '2026-10-01', dueDate: '2026-10-31', poNumber: 'PO26203139198', zohoInvoiceId: '3807682000000643003', status: 'sent', source: 'zoho-import',
        items: [{ sku: '', description: 'CMC - comprehensive maintenance contract - 24*7 — Maintenance services for Saidham Project - Q1, 01 OCT 2026 - 31 DEC 2026', unit: 'nos', stockItemId: '', rate: 242201.53, gstRate: 18, discountPct: '', hsnCode: '998717', qty: 3 }],
        subTotal: 726604.59, roundOff: 0, total: 857393.41, totalInWords: '', gstLines: [{ label: 'CGST 9%', rate: 9, base: 726604.59, amount: 65394.41 }, { label: 'SGST 9%', rate: 9, base: 726604.59, amount: 65394.41 }] } })
  }
  const cn2 = byNo['UIPL/CRN/25-26/002']
  if (cn2 && (cn2.items || []).length && !(cn2.items || []).every(i => i.accountCode === '5120')) {
    out.push({ key: cn2.id, group: 'Credit note that Zoho books to Transport, not Sales', kind: 'update', id: cn2.id, before: cn2, amount: num(cn2.total), title: `${cn2.voucherNumber} · ${cn2.date} · ${cn2.partyName}`,
      detail: 'Zoho books this ₹73,700 "deficiency in services" credit note as Transportation Expense, not as a reduction of Sales.',
      fields: { items: cn2.items.map(i => ({ ...i, accountCode: '5120' })) } })
  }
  // the Instakart advance: Zoho applied ₹2,72,400 to /12 and kept ₹6,15,000 as credit, which now settles the new invoice /16
  const inv16 = invs.find(i => i.invoiceNumber === 'UI/SL/26-27/16' && i.status !== 'cancelled'), inv12 = invs.find(i => i.invoiceNumber === 'UI/SL/26-27/12')
  const rc = byNo['UIPL/RCT/26-27/017']
  if (inv16 && inv12 && rc && (rc.allocations || []).length === 1 && Math.abs(num(rc.allocations[0].amount) - num(rc.partyAmount || rc.amount)) < 0.5 && rc.allocations[0].billKey === 'invoice:' + inv12.id) {
    out.push({ key: 'rc17b', group: 'Receipts', kind: 'update', id: rc.id, before: rc, amount: num(rc.partyAmount || rc.amount), title: `${rc.voucherNumber} · ${rc.date} · ${rc.partyName}`,
      detail: 'Split the advance as Zoho has it: ₹2,72,400 against UI/SL/26-27/12 and the remaining ₹6,15,000 against the new invoice UI/SL/26-27/16.',
      fields: { allocations: [{ billKey: 'invoice:' + inv12.id, docNumber: inv12.invoiceNumber, amount: 272400 }, { billKey: 'invoice:' + inv16.id, docNumber: inv16.invoiceNumber, amount: rd(num(rc.partyAmount || rc.amount) - 272400) }] } })
  }
  return out
}
