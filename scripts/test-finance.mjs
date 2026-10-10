// Plain-Node tests for the finance engine (no test framework in this repo).
//   node scripts/test-finance.mjs
import { SEED_ACCOUNTS, deriveAllLines, mergeRequiredAccounts, computeAccountBalances } from '../src/apps/finance/utils/ledger.js'
import { isValidGstin, isValidPan, fyOf, fyRange, gstRatesFor } from '../src/apps/finance/utils/financeConstants.js'
import { computeVoucherTotals, computeTds } from '../src/apps/finance/utils/taxCalc.js'
import { deriveVoucherLines, billKey } from '../src/apps/finance/utils/voucherEngine.js'
import { computeOutstanding } from '../src/apps/finance/utils/outstanding.js'
import { ledgerStatement } from '../src/apps/finance/utils/statements.js'
import { normalizeTaxDocs, rateWiseFromGstLines } from '../src/apps/finance/utils/taxDocs.js'
import { buildVoucherIndex } from '../src/apps/finance/utils/voucherIndex.js'

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ FAIL:', msg) } }
const eq = (a, b, msg) => ok(Math.abs(a - b) < 0.005, `${msg} (got ${a}, expected ${b})`)
const section = (s) => console.log('\n' + s)

const accounts = SEED_ACCOUNTS.map(a => ({ ...a, id: a.code }))
const balanced = (lines) => Math.abs(lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005
const sumBy = (lines, code, side) => lines.filter(l => l.accountCode === code).reduce((s, l) => s + l[side], 0)

section('identifiers & FY')
ok(isValidGstin('27AADCU8036C1ZF'), 'company GSTIN passes checksum')
ok(!isValidGstin('27AADCU8036C1ZA'), 'bad checksum rejected')
ok(!isValidGstin('27AADCU8036C1'), 'short GSTIN rejected')
ok(isValidPan('AADCU8036C'), 'PAN format')
ok(fyOf('2026-04-01') === '26-27' && fyOf('2026-03-31') === '25-26', 'FY boundaries')
ok(fyRange('26-27').to === '2027-03-31', 'FY range')
ok(gstRatesFor('2025-01-01').includes(28) && !gstRatesFor('2026-01-01').includes(28), 'GST 2.0 rates are date-aware')

section('tax totals')
let t = computeVoucherTotals([{ qty: 10, rate: 1000, gstRate: 18 }, { qty: 1, rate: 500, gstRate: 5, discountPct: 10 }], { supplyType: 'intra' })
eq(t.subTotal, 10450, 'subtotal after discount (10000 + 450)')
eq(t.cgst, 900 + 11.25, 'cgst'); eq(t.sgst, 900 + 11.25, 'sgst'); eq(t.igst, 0, 'no igst intra')
eq(t.total, Math.round(10450 + 1822.5), 'rounded total'); eq(t.roundOff, t.total - 12272.5, 'round-off')
ok(t.gstLines.some(g => g.label === 'CGST 9%') && t.gstLines.some(g => g.label === 'SGST 2.5%'), 'gst line labels')
t = computeVoucherTotals([{ qty: 1, rate: 1000, gstRate: 18 }], { supplyType: 'inter', rcm: true })
eq(t.total, 1000, 'RCM total excludes tax'); eq(t.igst, 180, 'RCM still computes the tax')
eq(computeTds({ base: 10450, rate: 2 }).amount, 209, 'TDS rounded to rupee')
eq(computeTds({ base: 1000, rate: 10, applicable: false }).amount, 0, 'TDS off')

const mkVoucher = (type, itemsIn, opts = {}) => {
  const totals = computeVoucherTotals(itemsIn, { supplyType: opts.supplyType || 'intra', rcm: opts.rcm })
  return { id: 'v1', voucherType: type, voucherNumber: `UIPL/${type}/26-27/001`, company: 'UIPL', date: '2026-05-10', status: 'active',
    partyId: 'p1', partyName: 'Acme', items: totals.items, gstLines: totals.gstLines, subTotal: totals.subTotal, total: totals.total, roundOff: totals.roundOff, ...opts.extra }
}

section('purchase voucher')
let v = mkVoucher('purchase', [{ qty: 10, rate: 1000, gstRate: 18 }], { extra: { creditDays: 30 } })
let L = deriveVoucherLines(v, accounts)
ok(balanced(L), 'purchase balances')
eq(sumBy(L, '5000', 'debit'), 10000, 'Dr purchases'); eq(sumBy(L, '1301', 'debit'), 900, 'Dr input CGST'); eq(sumBy(L, '1302', 'debit'), 900, 'Dr input SGST')
eq(sumBy(L, '2100', 'credit'), 11800, 'Cr payable = gross')
eq(L.find(l => l.accountCode === '2100').dueDate === '2026-06-09' ? 1 : 0, 1, 'due date = bill date + credit days')
// with TDS
const tds = computeTds({ base: 10000, rate: 10 })
v = mkVoucher('purchase', [{ qty: 10, rate: 1000, gstRate: 18 }], { extra: { tds: { ...tds, section: '194J' } } })
L = deriveVoucherLines(v, accounts)
ok(balanced(L), 'purchase+TDS balances')
eq(sumBy(L, '2100', 'credit'), 11800 - 1000, 'payable net of TDS'); eq(sumBy(L, '2500', 'credit'), 1000, 'TDS payable')
// rounding
v = mkVoucher('purchase', [{ qty: 3, rate: 333.33, gstRate: 18 }])
L = deriveVoucherLines(v, accounts); ok(balanced(L), 'purchase with round-off balances')
// RCM
v = mkVoucher('purchase', [{ qty: 1, rate: 10000, gstRate: 18 }], { supplyType: 'inter', rcm: true, extra: { rcm: true } })
L = deriveVoucherLines(v, accounts)
ok(balanced(L), 'RCM purchase balances')
eq(sumBy(L, '2100', 'credit'), 10000, 'RCM: vendor owed taxable only'); eq(sumBy(L, '2404', 'credit'), 1800, 'RCM liability'); eq(sumBy(L, '1303', 'debit'), 1800, 'RCM ITC')
// ITC ineligible
v = mkVoucher('purchase', [{ qty: 1, rate: 10000, gstRate: 18 }], { extra: { itcEligible: false } })
L = deriveVoucherLines(v, accounts)
ok(balanced(L), 'ITC-ineligible balances'); eq(sumBy(L, '5000', 'debit'), 11800, 'blocked ITC folded into cost'); eq(sumBy(L, '1301', 'debit'), 0, 'no ITC booked')

section('credit & debit notes')
v = mkVoucher('credit_note', [{ qty: 2, rate: 1000, gstRate: 18 }], { extra: { refInvoiceId: 'inv1' } })
L = deriveVoucherLines(v, accounts)
ok(balanced(L), 'credit note balances'); eq(sumBy(L, '4000', 'debit'), 2000, 'Dr sales (return)'); eq(sumBy(L, '2401', 'debit'), 180, 'Dr output CGST')
eq(sumBy(L, '1200', 'credit'), 2360, 'Cr receivable'); ok(L.find(l => l.accountCode === '1200').allocatesTo === 'invoice:inv1', 'CN allocates to original invoice')
v = mkVoucher('debit_note', [{ qty: 1, rate: 5000, gstRate: 18 }], { supplyType: 'inter', extra: { refPurchaseId: 'pur1' } })
L = deriveVoucherLines(v, accounts)
ok(balanced(L), 'debit note balances'); eq(sumBy(L, '2100', 'debit'), 5900, 'Dr payable'); eq(sumBy(L, '5000', 'credit'), 5000, 'Cr purchases'); eq(sumBy(L, '1303', 'credit'), 900, 'Cr input IGST (ITC reversal)')

section('payment / receipt / contra')
v = { id: 'p1', voucherType: 'payment', voucherNumber: 'PAY/1', company: 'UIPL', date: '2026-06-01', partyName: 'Acme', partyId: 'a',
  bankAccountCode: '1100', bankAccountId: 'bank1', partyAmount: 11800,
  allocations: [{ billKey: 'purchase:v1', docNumber: 'PUR/1', amount: 10000 }], accountLines: [{ accountCode: '5170', amount: 50 }],
  tds: { applicable: true, amount: 1000, section: '194J' } }
L = deriveVoucherLines(v, accounts)
ok(balanced(L), 'payment balances')
eq(sumBy(L, '1100', 'credit'), 11800 + 50 - 1000, 'Cr bank = party + charges − TDS'); eq(sumBy(L, '2100', 'debit'), 11800, 'Dr payable incl. on-account part')
eq(L.filter(l => l.accountCode === '2100' && l.onAccount).reduce((s, l) => s + l.debit, 0), 1800, 'unallocated remainder is on-account')
ok(L.find(l => l.accountCode === '1100').bankAccountId === 'bank1', 'bank line tagged with bank account id')
v = { id: 'r1', voucherType: 'receipt', voucherNumber: 'RCT/1', company: 'UIPL', date: '2026-06-02', partyName: 'Cust', bankAccountCode: '1100',
  partyAmount: 10000, allocations: [{ billKey: 'invoice:i1', docNumber: 'INV/1', amount: 10000 }], tdsReceivable: { applicable: true, amount: 200, section: '194C' } }
L = deriveVoucherLines(v, accounts)
ok(balanced(L), 'receipt balances'); eq(sumBy(L, '1100', 'debit'), 9800, 'Dr bank net of TDS'); eq(sumBy(L, '1310', 'debit'), 200, 'Dr TDS receivable'); eq(sumBy(L, '1200', 'credit'), 10000, 'Cr receivable gross')
v = { id: 'c1', voucherType: 'contra', voucherNumber: 'CON/1', company: 'UIPL', date: '2026-06-03', amount: 5000, fromAccountCode: '1110', toAccountCode: '1100', toBankAccountId: 'bank1' }
L = deriveVoucherLines(v, accounts)
ok(balanced(L), 'contra balances'); eq(sumBy(L, '1100', 'debit'), 5000, 'Dr bank'); eq(sumBy(L, '1110', 'credit'), 5000, 'Cr cash')
ok(deriveVoucherLines({ ...v, status: 'cancelled' }, accounts).length === 0, 'cancelled voucher derives nothing')

section('whole-book derivation + PI/SO exclusion + opening balances')
const gst = (sub, rate) => ({ subTotal: sub, gstLines: [{ label: `CGST ${rate / 2}%`, rate: rate / 2, base: sub, amount: sub * rate / 200 }, { label: `SGST ${rate / 2}%`, rate: rate / 2, base: sub, amount: sub * rate / 200 }], total: sub * (1 + rate / 100), roundOff: 0 })
const invoices = [
  { id: 'i1', invoiceType: 'TI', invoiceNumber: 'UIPL/TI/26-27/001', invoiceDate: '2026-04-10', dueDate: '2026-05-10', company: 'UIPL', customerId: 'c1', billToName: 'Beta Ltd', billToGstin: '29AADCU8036C1ZD', posStateCode: '27', sellerStateCode: '27', applyGst: true, items: [{ description: 'Svc', hsnCode: '9983', qty: 1, rate: 10000, gstRate: 18, unit: 'nos' }], ...gst(10000, 18) },
  { id: 'i2', invoiceType: 'TI', invoiceNumber: 'UIPL/TI/26-27/002', invoiceDate: '2026-05-10', dueDate: '2026-06-10', company: 'UIPL', customerId: 'c1', billToName: 'Beta Ltd', posStateCode: '27', sellerStateCode: '27', applyGst: true, items: [{ description: 'Svc', hsnCode: '9983', qty: 1, rate: 20000, gstRate: 18, unit: 'nos' }], ...gst(20000, 18) },
  { id: 'i3', invoiceType: 'TI', invoiceNumber: 'UIPL/TI/26-27/003', invoiceDate: '2026-06-10', dueDate: '2026-07-10', company: 'UIPL', customerId: 'c1', billToName: 'Beta Ltd', posStateCode: '27', sellerStateCode: '27', applyGst: true, items: [{ description: 'Svc', hsnCode: '9983', qty: 1, rate: 5000, gstRate: 18, unit: 'nos' }], ...gst(5000, 18) },
  { id: 'pi1', invoiceType: 'PI', invoiceNumber: 'UIPL/PI/26-27/001', invoiceDate: '2026-06-11', company: 'UIPL', billToName: 'Beta Ltd', posStateCode: '27', sellerStateCode: '27', items: [], ...gst(99999, 18) },
  { id: 'so1', invoiceType: 'SO', invoiceNumber: 'UIPL/SO/26-27/001', invoiceDate: '2026-06-11', company: 'UIPL', billToName: 'Beta Ltd', items: [], ...gst(88888, 18) },
]
const cn = mkVoucher('credit_note', [{ qty: 1, rate: 2000, gstRate: 18 }], { extra: { id: 'cn1', partyName: 'Beta Ltd', partyId: 'c1', refInvoiceId: 'i1', date: '2026-06-15' } }) // 2360, ties to i1
const rct = { id: 'r1', voucherType: 'receipt', voucherNumber: 'RCT/1', company: 'UIPL', date: '2026-06-20', partyName: 'Beta Ltd', partyId: 'c1', bankAccountCode: '1100', partyAmount: 10000,
  allocations: [{ billKey: 'invoice:i2', docNumber: 'INV/2', amount: 10000 }] } // explicit against i2
const legacyPay = { id: 'lp1', customerName: 'Beta Ltd', amount: 5000, date: '2026-06-25', method: 'UPI' } // legacy → FIFO
const raw = { invoices, payments: [legacyPay], orders: [], expenses: [], payables: [], accounts, vouchers: [cn, rct],
  customers: [{ id: 'c2', shopName: 'Gamma Co', openingBalance: 7000, openingType: 'Dr', openingDate: '2026-04-01', company: 'UIPL' }],
  vendors: [{ id: 'v9', vendorName: 'Delta Supplies', openingBalance: 3000, openingType: 'Cr', openingDate: '2026-04-01' }],
  bankAccounts: [{ id: 'bank1', name: 'HDFC', type: 'bank', company: 'UIPL', openingBalance: 50000, openingDate: '2026-04-01' }] }
const all = deriveAllLines(raw)
ok(balanced(all), 'entire derived book balances')
ok(!all.some(l => l.sourceId === 'pi1' || l.sourceId === 'so1'), 'pro-forma & sales orders are not booked')
const bals = computeAccountBalances(all, accounts, { company: 'UIPL', asOfDate: '2026-12-31' })
const balOf = (code) => bals.find(b => b.code === code)?.balance || 0
eq(balOf('4000'), 10000 + 20000 + 5000 - 2000, 'net sales after credit note')
eq(balOf('3200'), 50000 + 7000 - 3000, 'opening equity = bank + receivable − payable openings')
eq(balOf('1100'), 50000 + 10000 + 5000, 'bank = opening + receipts')

section('outstanding & ageing')
let os = computeOutstanding(all, { kind: 'receivable', company: 'UIPL', asOf: '2026-07-31' })
const beta = os.parties.find(p => p.name === 'Beta Ltd')
// bills: i1 11800, i2 23600, i3 5900. credits: CN 2360→i1 (explicit), receipt 10000→i2 (explicit), legacy 5000 FIFO (oldest unpaid = i1)
const pend = Object.fromEntries(beta.bills.map(b => [b.docNo, b.pending]))
eq(pend['UIPL/TI/26-27/001'], 11800 - 2360 - 5000, 'i1 after CN + FIFO')
eq(pend['UIPL/TI/26-27/002'], 23600 - 10000, 'i2 after explicit receipt')
eq(pend['UIPL/TI/26-27/003'], 5900, 'i3 untouched')
eq(beta.totalPending, 4440 + 13600 + 5900, 'party total')
ok(os.parties.find(p => p.name === 'Gamma Co')?.totalPending === 7000, 'opening balance is an outstanding bill')
// ageing by due date as of 2026-07-31: i1 due 05-10 (82d → 61-90), i2 due 06-10 (51d → 31-60), i3 due 07-10 (21d → 1-30)
const bk = Object.fromEntries(beta.bills.map(b => [b.docNo, b.bucket]))
ok(bk['UIPL/TI/26-27/001'] === 'd61_90' && bk['UIPL/TI/26-27/002'] === 'd31_60' && bk['UIPL/TI/26-27/003'] === 'd1_30', 'ageing buckets')
os = computeOutstanding(all, { kind: 'payable', company: 'UIPL', asOf: '2026-07-31' })
eq(os.parties.find(p => p.name === 'Delta Supplies')?.totalPending || 0, 3000, 'vendor opening balance outstanding')
// advance: receipt larger than bills
const adv = deriveAllLines({ ...raw, invoices: [invoices[0]], vouchers: [{ ...rct, allocations: [] , partyAmount: 50000 }], payments: [] })
os = computeOutstanding(adv, { kind: 'receivable', company: 'UIPL', asOf: '2026-12-31' })
eq(os.parties.find(p => p.name === 'Beta Ltd')?.advance || 0, 50000 - 11800, 'excess receipt becomes an advance')

section('ledger statement')
const st = ledgerStatement(all, { match: l => l.accountCode === '1200' && l.partyName === 'Beta Ltd', company: 'UIPL', from: '2026-05-01', to: '2026-12-31' })
eq(st.opening, 11800, 'opening = invoices before the period'); eq(st.closing, 11800 + 23600 + 5900 - 2360 - 10000 - 5000, 'closing')
ok(st.rows[0].particulars.includes('Sales'), 'particulars show the counter-account')

section('tax docs & rate-wise')
const docs = normalizeTaxDocs({ invoices, vouchers: [cn, rct], payables: [], vendors: [] })
ok(docs.filter(d => d.kind === 'sales').length === 3, 'sales docs exclude PI/SO')
ok(docs.filter(d => d.kind === 'credit_note').length === 1, 'credit note present')
const rw = rateWiseFromGstLines(gst(10000, 18).gstLines)
ok(rw.length === 1 && rw[0].rate === 18 && rw[0].taxable === 10000 && rw[0].cgst === 900 && rw[0].sgst === 900, 'rate-wise counts taxable value once')
const idx = buildVoucherIndex(raw)
ok(idx.filter(e => e.kind === 'sales').length === 3 && idx.filter(e => e.kind === 'memo').length === 2, 'day book separates memos')
ok(idx.some(e => e.kind === 'credit_note') && idx.some(e => e.kind === 'receipt'), 'day book lists new vouchers')

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
