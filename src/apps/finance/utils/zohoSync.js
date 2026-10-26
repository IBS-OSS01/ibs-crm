// Zoho Books entries of September - October 2026 that are not (or not exactly) in our books, read from Zoho on 26 Oct 2026.
// Everything is a proposal; nothing is written until Apply is pressed. Entries that already exist in our books are skipped,
// so this list shrinks to nothing once applied. Entries that touch the bank are created without a bank-statement line —
// they are matched when the statements after 30 Sep are uploaded.
import { r2, num } from './financeConstants.js'
import { computeVoucherTotals } from './taxCalc.js'

const G = 'Zoho entries of Sep - Oct 2026'
const STATE = { 24: 'Gujarat', 27: 'Maharashtra', 29: 'Karnataka', 6: 'Haryana' }
const NEW_VENDORS = [
  { name: 'BHAGVANJI JIVANBHAI MANAVADRIYA', gstin: '24AFMPM6892F1Z1', pan: 'AFMPM6892F' },
  { name: 'SMARTSHIFT LOGISTICS SOLUTIONS PRIVATE LIMITED', gstin: '27AAGCR8772D1Z2', pan: 'AAGCR8772D' },
  { name: 'Qatar Airways Group (Q.C.S.C.)', gstin: '27AAAFQ0156F1ZL', pan: 'AAAFQ0156F' },
  { name: 'AIR INDIA LIMITED', gstin: '27AACCN6194P1ZP', pan: 'AACCN6194P' },
  { name: 'SUYOG ENTERPRISES', gstin: '27AHKPB5944M1ZY', pan: 'AHKPB5944M', address: 'Shop No.7, Sr.No.56/3, Samarth Complex, Near State Bank Of India, Samarth Nagar, Pune - 411041', email: 'sales.suyogenterprises@gmail.com', phone: '+91-8983051299', city: 'Pune', pincode: '411041' },
]
// [vendor, bill no, date, gstin, [account, description, rate, gst%, hsn], Zoho total]
const BILLS = [
  ['SNV AVIATION PRIVATE LIMITED', '271M7K1SM0826001', '2026-08-06', '27ABECS9580P1ZC', [['5125', 'Travel', 40538, 5, '']], 42564.9],
  ['AIR INDIA LIMITED', '272712BP08AFR123', '2026-08-24', '27AACCN6194P1ZP', [['5125', 'Air ticket', 6688, 5, ''], ['5125', 'Fare components without GST', 759.6, 0, '']], 7782],
  ['AIR INDIA LIMITED', '272712BP08AFU594', '2026-08-24', '27AACCN6194P1ZP', [['5125', 'Air ticket', 333, 5, ''], ['5125', 'Fare components without GST', 0.34, 0, '']], 350],
  ['AIR INDIA LIMITED', '272712BP08AFS911', '2026-08-24', '27AACCN6194P1ZP', [['5125', 'Air ticket', 6688, 5, ''], ['5125', 'Fare components without GST', 759.6, 0, '']], 7782],
  ['BHAGVANJI JIVANBHAI MANAVADRIYA', 'PSM/26-27/1792', '2026-09-29', '24AFMPM6892F1Z1', [['5120', 'Transportation', 590, 18, '']], 696.2],
  ['SNV AVIATION PRIVATE LIMITED', '272M7K1SM0926002', '2026-09-17', '27ABECS9580P1ZC', [['5125', 'Travel', 1144, 5, '']], 1201.2],
  ['Onsurity Technologies Private Limited', 'INV202609940169', '2026-09-05', '29AADCO1206A1Z3', [['2160', 'EOR employee services', 3660.17, 18, '']], 4319],
  ['SMARTSHIFT LOGISTICS SOLUTIONS PRIVATE LIMITED', 'CRN816444834134', '2026-09-09', '27AAGCR8772D1Z2', [['5120', 'Transportation', 1924, 5, '']], 2020.2],
  ['Qatar Airways Group (Q.C.S.C.)', '2609MHINTK008275', '2026-09-13', '27AAAFQ0156F1ZL', [['5125', 'Air ticket', 24747, 5, ''], ['5125', 'Fare components without GST', 5631.64, 0, '']], 31616],
  ['Qatar Airways Group (Q.C.S.C.)', '2609MHINTK008265', '2026-09-13', '27AAAFQ0156F1ZL', [['5125', 'Air ticket', 24747, 5, ''], ['5125', 'Fare components without GST', 5631.64, 0, '']], 31616],
  ['Qatar Airways Group (Q.C.S.C.)', '2609MHINTK008248', '2026-09-13', '27AAAFQ0156F1ZL', [['5125', 'Air ticket', 21472, 5, ''], ['5125', 'Fare components without GST', 5631.4, 0, '']], 28177],
  ['S.R. ENGINEERING', '2026-27/193', '2026-09-30', '06BLQPD6560E1Z3', [['5000', 'Job costing (3 × ₹25,000)', 75000, 18, '998714']], 88500],
  ['TRUE VALUE IT SOLUTIONS', 'tvis/26-27/32', '2026-09-22', '06AAPFT7261B2Z2', [['5135', 'Laptop', 25700, 18, '84713010'], ['5135', 'BITGUARD TOTAL SECURITY MAX 1 YEAR', 750, 18, '85238020'], ['5120', 'Transportation', 2000, 0, '']], 33211],
  ['TRUE VALUE IT SOLUTIONS', 'TVIS/26-27/33', '2026-09-22', '06AAPFT7261B2Z2', [['5135', 'Laptop', 25700, 18, '84713010'], ['5135', 'BITGUARD TOTAL SECURITY MAX 1 YEAR', 750, 18, '85238020'], ['5120', 'Transportation', 2000, 0, '']], 33211],
  ['THE HONGKONG & SHANGHAI BANKING CORPORATION LTD', '5834764', '2026-09-13', '27AAACT2786P1ZN', [['5170', 'Bank fee', 11, 18, '']], 12.98],
]
const SEARCH = (s) => String(s || '').trim().toLowerCase()

const POS = [
  { vendor: 'J P SWITCHGEAR DISTRIBUTORS PRIVATE LIMITED', ref: 'PO/26-27/00007', date: '2026-10-08', delivery: '', days: 0, items: [['ATV320 BOOK 3 KW- 3PH 380/500V', 1, 24049.6, '85044010'], ['ATV320BOOK- 1.5KW -3PH 380V/500V', 1, 19909.12, '85044010'], ['ATV320BOOK- 2.2KW -3PH 380V/500V', 1, 21390.08, '85044010'], ['ATV320BOOK- 4KW -3PH 380V/500V', 1, 27057.28, '85044010']], total: 109039.18 },
  { vendor: 'SUYOG ENTERPRISES', ref: 'PO/26-27/00008', date: '2026-10-23', delivery: '2026-10-30', days: 30, items: [['SK 90LP/4 BRE20 HL TF — geared brake motor 1.5 kW, IP55, 230/400 V', 13, 52800, '84128020'], ['Transportation charges — freight up to Bhiwandi, Mumbai; P & F 2%', 1, 23228, '996749']], total: 837361.04 },
]

export function buildZohoSync(raw) {
  const out = []
  const vouchers = (raw?.vouchers || []).filter(v => v.status !== 'cancelled')
  const vendors = raw?.vendors || []
  const banks = raw?.bankAccounts || []
  const invs = (raw?.invoices || []).filter(i => i.status !== 'cancelled')
  const vend = (name) => vendors.find(v => SEARCH(v.vendorName || v.name) === SEARCH(name))
  const bank = (re) => banks.find(b => re.test(b.name || ''))
  const yes = bank(/^yes bank$/i), hsbc = bank(/hsbc/i), fdYes = bank(/^fd yes/i)
  const byNo = Object.fromEntries(vouchers.map(v => [v.voucherNumber, v]))
  const near = (d1, d2, days = 5) => Math.abs((new Date(d1) - new Date(d2)) / 864e5) <= days
  const bills = vouchers.filter(v => v.voucherType === 'purchase')
  const haveBill = (vendorName, ref) => bills.find(b => SEARCH(b.partyName) === SEARCH(vendorName) && SEARCH(b.refNumber) === SEARCH(ref))

  // ── new vendors
  const newVendorKey = {}
  for (const nv of NEW_VENDORS) {
    if (vend(nv.name)) continue
    newVendorKey[nv.name] = 'vendor:' + nv.name
    out.push({ key: 'vendor:' + nv.name, group: G + ' — new vendors', kind: 'vendorCreate', amount: 0, title: nv.name, detail: `GSTIN ${nv.gstin} · created in Zoho, not yet in our vendor list.`,
      data: { vendorName: nv.name, gstin: nv.gstin, pan: nv.pan, state: STATE[Number(nv.gstin.slice(0, 2))] || '', country: 'India', gstTreatment: 'business_gst', paymentTerms: 'Due on Receipt', active: true,
        address: nv.address || '', city: nv.city || '', pincode: nv.pincode || '', email: nv.email || '', phone: nv.phone || '', contactPerson: '', bankName: '', bankAccount: '', ifsc: '', notes: 'Imported from Zoho Books', source: 'zoho-import' } })
  }

  // ── bills
  const mkItems = (rows) => rows.map(([acct, desc, rate, gst, hsn]) => ({ accountCode: acct, description: desc, qty: 1, rate, discountPct: 0, gstRate: gst, hsnCode: hsn, unit: 'nos', sku: '', stockItemId: '' }))
  const totalsFor = (items, supplyType, total) => {
    const t0 = computeVoucherTotals(items, { supplyType, applyGst: true })
    return computeVoucherTotals(items, { supplyType, applyGst: true, roundOff: r2(total - t0.rawTotal) })
  }
  const billKeys = {}
  for (const [vendorName, ref, date, gstin, rows, total] of BILLS) {
    if (haveBill(vendorName, ref)) continue
    const v = vend(vendorName)
    const supplyType = gstin.slice(0, 2) === '27' ? 'intra' : 'inter'
    const items = mkItems(rows), t = totalsFor(items, supplyType, total)
    const key = 'bill:' + ref; billKeys[ref] = key
    out.push({ key, group: G + ' — bills', kind: 'create', amount: total, title: `${date} · ${vendorName} · ${ref}`,
      detail: `${rows.map(r => `${r[1]} ₹${r[2].toLocaleString('en-IN')}${r[3] ? ` + GST ${r[3]}%` : ''}`).join(' · ')} → total ₹${total.toLocaleString('en-IN')}. Bill number ${ref}, due on receipt.`,
      vendorKey: v ? '' : newVendorKey[vendorName],
      data: { voucherType: 'purchase', company: 'UIPL', date, partyType: 'vendor', partyId: v?.id || '', partyName: v ? (v.vendorName || v.name) : vendorName, partyGstin: gstin, partyState: STATE[Number(gstin.slice(0, 2))] || '', partyStateCode: gstin.slice(0, 2),
        companyStateCode: '27', placeOfSupplyCode: '27', supplyType, applyGst: true, itcEligible: true, rcm: false, creditDays: 0, dueDate: date, currency: 'INR', fxRate: 1, fc: null,
        items: t.items, gstLines: t.gstLines, subTotal: t.subTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total, refNumber: ref, refDate: date, narration: `Zoho bill ${ref}`,
        purchaseAccountCode: rows[0][0], tds: { applicable: false, amount: 0, base: 0, rate: 0, section: '' }, costCentreId: '', warehouseId: '', source: 'zoho-import' } })
  }

  // ── vendor payments
  const payTo = (vendorName, billRef, amount, date, b, no) => ({ vendorName, billRef, amount, date, b, no })
  const pays = [payTo('TRUE VALUE IT SOLUTIONS', 'tvis/26-27/32', 33211, '2026-10-13', yes, 267), payTo('TRUE VALUE IT SOLUTIONS', 'TVIS/26-27/33', 33211, '2026-10-13', yes, 266)]
  for (const p of pays) {
    if (!billKeys[p.billRef]) continue                                                      // the bill exists already: then so does its payment history
    const v = vend(p.vendorName)
    out.push({ key: 'zpay' + p.no, group: G + ' — vendor payments', kind: 'create', amount: p.amount, title: `${p.date} · ${p.vendorName} · Zoho payment ${p.no}`,
      detail: `Paid through ${p.b?.name || 'Yes Bank'} against bill ${p.billRef} — match with the statement line when it is uploaded.`,
      allocFromBills: [{ bill: billKeys[p.billRef], amount: p.amount }],
      data: { voucherType: 'payment', company: 'UIPL', date: p.date, refNumber: '', narration: `Zoho Books payment ${p.no} for bill ${p.billRef}`, partyType: 'vendor', partyId: v?.id || '', partyName: p.vendorName, partyAmount: p.amount, allocations: [],
        accountLines: [], bankAccountCode: '1100', bankAccountId: p.b?.id || '', amount: p.amount, currency: 'INR', fxRate: 1, bankAmountInr: null, onAccountFc: 0, tds: { applicable: false }, paymentMode: 'Bank Transfer' } })
  }
  // Onsurity: the ₹4,319 paid on 5 Sep settles the September bill; the August bill (shown as "86") is Zoho's INV202608919888, paid ₹1,454 on 4 Aug through Yes Bank
  const p52 = byNo['UIPL/PAY/26-27/052'], onsurityNew = billKeys['INV202609940169']
  if (p52 && onsurityNew && (p52.allocations || []).some(a => a.docNumber === '86')) {
    out.push({ key: p52.id, group: G + ' — corrections', kind: 'update', id: p52.id, before: p52, amount: num(p52.amount), title: `${p52.voucherNumber} · ${p52.date} · ${p52.partyName}`,
      detail: 'The ₹4,319 paid on 5 Sep is for bill INV202609940169 (Sep); it had been attached to the ₹1,454 August bill.', allocFromBills: [{ bill: onsurityNew, amount: 4319 }], fields: { partyAmount: 4319, allocations: [] } })
  }
  const b86 = bills.find(b => ['86', 'INV202608919888'].includes(String(b.refNumber)) && SEARCH(b.partyName).includes('onsurity'))
  if (b86) {
    if (b86.refNumber === '86') out.push({ key: b86.id, group: G + ' — corrections', kind: 'update', id: b86.id, before: b86, amount: num(b86.total), title: `${b86.voucherNumber} · ${b86.date} · ${b86.partyName}`,
      detail: 'Bill number is INV202608919888 in Zoho (booked as "86" here); date 4 Aug.', fields: { refNumber: 'INV202608919888', refDate: '2026-08-04', narration: 'Zoho bill INV202608919888' } })
    const stmt = vouchers.find(v => v.voucherType === 'payment' && v.date === '2026-08-04' && !v.partyId && v.bankStatementLine && Math.abs(num(v.amount) - 1454) < 0.5)
    const dup = vouchers.find(v => v.voucherType === 'payment' && v.date === '2026-08-04' && SEARCH(v.partyName).includes('onsurity') && Math.abs(num(v.amount) - 1454) < 0.5 && /Zoho Books payment 246/.test(v.narration || ''))
    if (stmt) {
      out.push({ key: stmt.id, group: G + ' — corrections', kind: 'update', id: stmt.id, before: stmt, amount: 1454, title: `${stmt.voucherNumber} · ${stmt.date}`,
        detail: 'Yes Bank statement line "ONSURITY BANGALORE" of 4 Aug, parked in Miscellaneous Expenses → it is Zoho payment 246, the payment of bill INV202608919888.',
        fields: { partyType: 'vendor', partyId: b86.partyId, partyName: b86.partyName, partyAmount: 1454, allocations: [{ billKey: 'purchase:' + b86.id, docNumber: b86.voucherNumber, amount: 1454 }], accountLines: [] } })
      if (dup) out.push({ key: 'cancel-' + dup.id, group: G + ' — corrections', kind: 'cancel', id: dup.id, before: dup, amount: 1454, title: `${dup.voucherNumber} · ${dup.date} · cancel`,
        detail: 'Duplicate of the statement line above (created from Zoho before the Yes Bank line was matched) — cancelled so the bank is not charged twice.' })
    } else if (!dup && !vouchers.some(v => v.voucherType === 'payment' && SEARCH(v.partyName).includes('onsurity') && Math.abs(num(v.amount) - 1454) < 0.5)) {
      out.push({ key: 'zpay246', group: G + ' — vendor payments', kind: 'create', amount: 1454, title: '2026-08-04 · Onsurity Technologies · Zoho payment 246',
        detail: 'Paid through Yes Bank against bill INV202608919888 — match when the Yes Bank statement is uploaded.',
        data: { voucherType: 'payment', company: 'UIPL', date: '2026-08-04', refNumber: '20260804141917745847', narration: 'Zoho Books payment 246 for bill INV202608919888', partyType: 'vendor', partyId: b86.partyId, partyName: b86.partyName, partyAmount: 1454,
          allocations: [{ billKey: 'purchase:' + b86.id, docNumber: b86.voucherNumber, amount: 1454 }], accountLines: [], bankAccountCode: '1100', bankAccountId: yes?.id || '', amount: 1454, currency: 'INR', fxRate: 1, bankAmountInr: null, onAccountFc: 0, tds: { applicable: false }, paymentMode: 'Bank Transfer' } })
    }
  }
  // HSBC's own ₹12.98 bank-fee bill: the HSBC debit of 15 Sep (booked without a party) pays it
  const p56 = byNo['UIPL/PAY/26-27/056']
  if (p56 && !p56.partyId && billKeys['5834764']) {
    const h = vend('THE HONGKONG & SHANGHAI BANKING CORPORATION LTD')
    out.push({ key: p56.id, group: G + ' — corrections', kind: 'update', id: p56.id, before: p56, amount: num(p56.amount), title: `${p56.voucherNumber} · ${p56.date}`,
      detail: 'Zoho: HSBC bill 5834764 (₹11 fee + 18% GST = ₹12.98) paid on 15 Sep.', allocFromBills: [{ bill: billKeys['5834764'], amount: 12.98 }],
      fields: { partyType: 'vendor', partyId: h?.id || '', partyName: h ? (h.vendorName || h.name) : 'THE HONGKONG & SHANGHAI BANKING CORPORATION LTD', partyAmount: 12.98, accountLines: [], allocations: [] } })
  }

  for (const no of ['UIPL/PAY/26-27/129', 'UIPL/PAY/26-27/130']) {
    const v = byNo[no]
    if (v && yes && v.bankAccountId && v.bankAccountId !== yes.id && !v.bankStatementLine)
      out.push({ key: 'bank-' + v.id, group: G + ' — corrections', kind: 'update', id: v.id, before: v, amount: num(v.amount), title: `${v.voucherNumber} · ${v.date} · ${v.partyName}`,
        detail: 'Zoho paid this through Yes Bank, not HSBC — moved to Yes Bank so both bank balances equal Zoho\'s. Match it with the Yes Bank statement when it is uploaded.', fields: { bankAccountId: yes.id, bankAccountCode: '1100' } })
  }

  // ── Wayzim bill: Zoho dated 10 Oct, 10.4% TDS under section 195 on ₹1,88,559 = ₹19,610 (net ₹1,68,949)
  const wz = bills.find(b => b.refNumber === 'WAYZ-05012026IN-01')
  if (wz && (wz.date !== '2026-10-10' || num(wz.tds?.amount) !== 19610)) {
    out.push({ key: wz.id, group: G + ' — corrections', kind: 'update', id: wz.id, before: wz, amount: num(wz.total), title: `${wz.voucherNumber} · ${wz.date} · ${wz.partyName}`,
      detail: 'As in Zoho: bill dated 10 Oct 2026 (due 10 Nov), TDS 10.4% under section 195 = ₹19,610, net payable ₹1,68,949 (here: dated 30 Nov, TDS ₹39,220).',
      fields: { date: '2026-10-10', refDate: '2026-10-10', dueDate: '2026-11-10', creditDays: 31, tds: { ...(wz.tds || {}), applicable: true, section: wz.tds?.section || '195', rate: 10.4, base: num(wz.subTotal) || 188559, amount: 19610 } } })
  }

  // ── customer receipts
  const invOf = (n) => invs.find(i => i.invoiceNumber === n)
  const bankAmt = (partyAmt, tds) => r2(partyAmt - tds)
  const RC = [
    [68, '2026-10-06', 'UI/SL/26-27/14', 661795.4, 14000, '194O', yes], [70, '2026-10-14', 'UI/SL/26-27/14', 150204.6, 0, '', yes],
    [69, '2026-10-06', 'UI/SL/26-27/10', 133767.27, 0, '', hsbc], [71, '2026-10-21', 'UI/SL/26-27/11', 58000, 1000, '194C', yes],
  ]
  for (const [no, date, invNo, cash, tds, section, b] of RC) {
    const inv = invOf(invNo); if (!inv) continue
    if (vouchers.some(v => v.voucherType === 'receipt' && near(v.date, date) && Math.abs(num(v.amount) - cash) < 0.5)) continue
    const partyAmt = r2(cash + tds)
    out.push({ key: 'zrc' + no, group: G + ' — customer receipts', kind: 'create', amount: partyAmt, title: `${date} · ${inv.billToName} · Zoho receipt ${no}`,
      detail: `${b?.name || 'bank'} received ₹${cash.toLocaleString('en-IN')}${tds ? ` + TDS ₹${tds.toLocaleString('en-IN')} withheld by the customer` : ''} against ${invNo} — match with the statement line when it is uploaded.`,
      data: { voucherType: 'receipt', company: 'UIPL', date, partyType: 'customer', partyId: inv.customerId || '', partyName: inv.billToName, partyAmount: partyAmt,
        allocations: [{ billKey: 'invoice:' + inv.id, docNumber: invNo, amount: partyAmt }], accountLines: [], ...(tds ? { tdsReceivable: { applicable: true, amount: tds, section } } : {}),
        bankAccountCode: '1100', bankAccountId: b?.id || '', refNumber: '', narration: `Zoho Books payment ${no} for ${invNo}${tds ? ' · incl. TDS ' + tds : ''}`, amount: cash, currency: 'INR', fxRate: 1, bankAmountInr: null, onAccountFc: 0, paymentMode: 'Bank Transfer' } })
  }

  // ── Zoho "Software Expense" refunds (negative expenses) of 1 Oct through Yes Bank, and the Wayzim food / tools expense
  for (let k = 1; k <= 2; k++) {
    const have = vouchers.filter(v => v.voucherType === 'receipt' && v.date === '2026-10-01' && Math.abs(num(v.amount) - 1231.92) < 0.01).length
    if (have >= k) continue
    out.push({ key: 'zref' + k, group: G + ' — expenses', kind: 'create', amount: 1231.92, title: `2026-10-01 · Software Expense refund ${k} of 2`,
      detail: 'Zoho shows ₹1,231.92 as a negative Software Expense paid through Yes Bank (a refund) → credit to IT, Software & Internet.',
      data: { voucherType: 'receipt', company: 'UIPL', date: '2026-10-01', partyAmount: 0, allocations: [], accountLines: [{ accountCode: '5135', amount: 1231.92, description: 'Software expense refund (Zoho expense, negative)' }], bankAccountCode: '1100', bankAccountId: yes?.id || '',
        refNumber: '', narration: 'Zoho expense: Software Expense refund', amount: 1231.92, currency: 'INR', fxRate: 1, bankAmountInr: null, onAccountFc: 0, paymentMode: 'Bank Transfer' } })
  }
  const p78 = byNo['UIPL/PAY/26-27/078']
  if (p78 && (p78.accountLines || []).length === 1 && p78.accountLines[0].accountCode === '2910' && num(p78.accountLines[0].amount) === 8560) {
    out.push({ key: p78.id, group: G + ' — expenses', kind: 'update', id: p78.id, before: p78, amount: 8560, title: `${p78.voucherNumber} · ${p78.date}`,
      detail: 'Zoho expense of 8 Sep (Other Expenses, vendor WAYZIM, ₹7,180: food for Sandesh, tools for fast sorter and ID card) is part of this ₹8,560 transfer; the other ₹1,380 stays with the director.',
      fields: { expenseVendor: 'WAYZIM', accountLines: [{ accountCode: '5900', amount: 7180, description: 'Food for Sandesh, tools for fast sorter & ID card (Wayzim)' }, { accountCode: '2910', amount: 1380, description: p78.accountLines[0].description }] } })
  }

  // ── bank journals of 7 Oct (Zoho journals 508 - 511)
  const nm = (b) => (b ? (/^fd/i.test(b.name) ? `${b.name} (FD)` : b.name) : '')
  const contra = (no, date, from, to, amt, memo) => {
    if (vouchers.some(v => v.voucherType === 'contra' && v.date === date && Math.abs(num(v.amount) - amt) < 0.01)) return
    out.push({ key: 'zj' + no, group: G + ' — bank transfers (Zoho journals)', kind: 'create', amount: amt, title: `${date} · Zoho journal ${no} · ${memo}`, detail: `${from?.name} → ${to?.name}`,
      data: { voucherType: 'contra', company: 'UIPL', date, fromAccountCode: '1100', fromAccountName: nm(from), fromBankAccountId: from?.id || '', toAccountCode: '1100', toAccountName: nm(to), toBankAccountId: to?.id || '', amount: amt, refNumber: '', narration: `Zoho journal ${no} — ${memo}` } })
  }
  contra(508, '2026-10-07', yes, fdYes, 639260.24, 'SWEEP IN / SWEEP OUT')
  contra(509, '2026-10-07', hsbc, yes, 341050.03, 'FUND TRANSFER')
  contra(511, '2026-10-07', yes, hsbc, 6722, 'FUND TRANSFER')
  if (!vouchers.some(v => v.voucherType === 'payment' && v.date === '2026-10-07' && Math.abs(num(v.amount) - 117956) < 0.01)) {
    out.push({ key: 'zj510', group: G + ' — bank transfers (Zoho journals)', kind: 'create', amount: 117956, title: '2026-10-07 · Zoho journal 510 · provident fund', detail: 'Provident fund paid from Yes Bank → PF Payable (2610).',
      data: { voucherType: 'payment', company: 'UIPL', date: '2026-10-07', partyAmount: 0, allocations: [], accountLines: [{ accountCode: '2610', amount: 117956, description: 'Provident fund (Zoho journal 510)' }], tds: { applicable: false },
        bankAccountCode: '1100', bankAccountId: yes?.id || '', refNumber: '', narration: 'Zoho journal 510 — provident fund', amount: 117956, currency: 'INR', fxRate: 1, bankAmountInr: null, onAccountFc: 0, paymentMode: 'Bank Transfer' } })
  }

  // ── invoice /17: Zoho has the exact salary / fee amounts (total ₹13,46,480.98)
  const i17 = invOf('UI/SL/26-27/17')
  if (i17 && Math.abs(num(i17.total) - 1346480.98) > 0.005 && (i17.items || []).length === 4) {
    const rates = [1105380, 77376, 138369.2, 9685]
    out.push({ key: 'inv17fix', group: G + ' — corrections', kind: 'invoice', id: i17.id, amount: 1346480.98, title: `${i17.invoiceDate} · UI/SL/26-27/17 · Wayzim`,
      detail: `Amounts as in Zoho: salaries ₹11,05,380 + expenses ₹1,38,369.20 (EOR), administration fees ₹87,061, GST ₹15,670.98, round off -0.20 → ₹13,46,480.98 (here ₹${num(i17.total).toLocaleString('en-IN')}).`,
      fields: { items: i17.items.map((it, k) => ({ ...it, rate: rates[k] })), subTotal: 1330810.2, roundOff: -0.2, total: 1346480.98, totalInWords: '',
        gstLines: [{ label: 'CGST 9%', rate: 9, base: 87061, amount: 7835.49 }, { label: 'SGST 9%', rate: 9, base: 87061, amount: 7835.49 }], revenueSplit: [{ accountCode: '2160', amount: 1243749.2 }, { accountCode: '4000', amount: 87061 }] } })
  }

  // ── orders (no accounting): sales order SO-00008 and two purchase orders
  const so7 = invs.find(i => i.invoiceNumber === 'SO-00007')
  if (so7 && !invs.some(i => i.invoiceNumber === 'SO-00008')) {
    const c = JSON.parse(JSON.stringify(so7)); ['id', 'zohoOrderId', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy'].forEach(k => delete c[k])
    out.push({ key: 'so8', group: G + ' — orders (no accounting)', kind: 'invoiceCreate', amount: 895976.36, title: '2026-10-23 · SO-00008 · Wayzim Technology',
      detail: 'Sales order: SK 90LP/4 BRE20 HL TF 13 × ₹56,496 + transportation ₹24,854 + GST 18% = ₹8,95,976.36.',
      data: { ...c, invoiceNumber: 'SO-00008', invoiceDate: '2026-10-23', dueDate: '2026-10-31', status: 'draft', source: 'zoho-import',
        items: [{ sku: '', description: 'SK 90LP/4 BRE20 HL TF', unit: 'nos', stockItemId: '', rate: 56496, gstRate: 18, discountPct: '', hsnCode: '84128020', qty: 13, invoicedQty: 0, cancelledQty: 0 },
          { sku: '', description: 'Transportation charges', unit: 'nos', stockItemId: '', rate: 24854, gstRate: 18, discountPct: '', hsnCode: '996749', qty: 1, invoicedQty: 0, cancelledQty: 0 }],
        subTotal: 759302, roundOff: 0, total: 895976.36, totalInWords: '', gstLines: [{ label: 'CGST 9%', rate: 9, base: 759302, amount: 68337.18 }, { label: 'SGST 9%', rate: 9, base: 759302, amount: 68337.18 }] } })
  }
  for (const po of POS) {
    if (vouchers.some(v => v.voucherType === 'purchase_order' && v.refNumber === po.ref)) continue
    const v = vend(po.vendor)
    const items = po.items.map(([description, qty, rate, hsnCode]) => ({ description, qty, rate, discountPct: 0, gstRate: 18, hsnCode, unit: 'nos', sku: '', stockItemId: '' }))
    const t0 = computeVoucherTotals(items, { supplyType: 'intra', applyGst: true }), t = computeVoucherTotals(items, { supplyType: 'intra', applyGst: true, roundOff: r2(po.total - t0.rawTotal) })
    out.push({ key: 'po' + po.ref, group: G + ' — orders (no accounting)', kind: 'create', amount: po.total, title: `${po.date} · ${po.vendor} · ${po.ref}`,
      detail: `Purchase order, ${po.items.length} line${po.items.length > 1 ? 's' : ''}, GST 18%, total ₹${po.total.toLocaleString('en-IN')}. No accounting entry until the vendor's bill is entered.`,
      vendorKey: v ? '' : newVendorKey[po.vendor],
      data: { voucherType: 'purchase_order', company: 'UIPL', date: po.date, partyType: 'vendor', partyId: v?.id || '', partyName: v ? (v.vendorName || v.name) : po.vendor, partyGstin: v?.gstin || NEW_VENDORS.find(n => n.name === po.vendor)?.gstin || '', refNumber: po.ref, subject: '', shipmentPreference: '', expectedDate: po.delivery,
        warehouseId: '', terms: '', termsAndConditions: '', applyGst: true, supplyType: 'intra', items: t.items, gstLines: t.gstLines, subTotal: t.subTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, roundOffManual: true, total: t.total, narration: `Zoho purchase order ${po.ref}`, closed: false,
        creditDays: po.days, dueDate: po.delivery || po.date, source: 'zoho-import' } })
  }
  return out
}
