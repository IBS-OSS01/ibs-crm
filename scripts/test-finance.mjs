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
import { collectMovements, valueMovements, deriveStockLines, computeStock } from '../src/apps/finance/utils/stockEngine.js'
import { deductionRows, monthlyPosition, depositDueDate, monthsLate, lateFee, returnDueDate, quarterData, receivableRows, deducteeSummary } from '../src/apps/finance/utils/tdsReports.js'
import { tradingPL, cashFlow, ratios, costCentreSummary, budgetVsActual, balanceUpTo } from '../src/apps/finance/utils/financialStatements.js'
import { parseBankStatement, bookEntries, autoMatch, reconciliation } from '../src/apps/finance/utils/bankRecon.js'
import { parseStatementPages } from '../src/apps/finance/utils/bankPdf.js'
import { suggestEntry, buildVoucher, bankLineKey } from '../src/apps/finance/utils/bankEntries.js'
import { tallyVouchers, tallyMasters } from '../src/apps/finance/utils/tallyExport.js'
import { buildEInvoice, buildEwayBill, invoiceProblems, ewayProblems, gstr3bJson } from '../src/apps/finance/utils/einvoice.js'
import { convertTotals, rateOn, revaluation, fmtFc } from '../src/apps/finance/utils/fx.js'
import { computeStatutory, mergeStatutory, payrollTotals, pfAdminCharge, buildEcr, esicRows, contributionDue } from '../src/apps/hr/utils/statutory.js'
import { deriveInterCompanyLines } from '../src/apps/finance/utils/interCompany.js'
import { buildGstr1, gstr1Json, buildGstr3b, setOff, hsnSummary, itcRegister, reconcile2b, parseGstr2bJson, normInvNo } from '../src/apps/finance/utils/gstReturns.js'

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

section('GST returns')
const cnR = { ...cn, partyGstin: '29AADCU8036C1ZD', refInvoiceNumber: 'UIPL/TI/26-27/001', date: '2026-06-15' }
const purA = { ...mkVoucher('purchase', [{ qty: 10, rate: 1000, gstRate: 18, hsnCode: '8517', unit: 'nos' }], { extra: { id: 'pa', voucherNumber: 'PUR/1', refNumber: 'INV-001', partyGstin: '27AAACV1234A1Z5', date: '2026-06-05' } }) }
const purRcm = { ...mkVoucher('purchase', [{ qty: 1, rate: 10000, gstRate: 18 }], { supplyType: 'inter', rcm: true, extra: { id: 'pr', voucherNumber: 'PUR/2', rcm: true, supplyType: 'inter', date: '2026-06-06' } }) }
const purBlocked = { ...mkVoucher('purchase', [{ qty: 1, rate: 1000, gstRate: 18 }], { extra: { id: 'pb', voucherNumber: 'PUR/3', itcEligible: false, date: '2026-06-07' } }) }
const gdocs = normalizeTaxDocs({ invoices, vouchers: [cnR, purA, purRcm, purBlocked], payables: [], vendors: [] })
const g1 = buildGstr1(gdocs, { company: 'UIPL', from: '2026-04-01', to: '2026-06-30', companyStateCode: '27', gstin: '27AADCU8036C1ZF' })
ok(g1.b2b.length === 1 && g1.b2b[0].invoices.length === 1, 'GSTR-1: one registered buyer invoice in B2B')
eq(g1.b2cs.reduce((s, x) => s + x.taxable, 0), 25000, 'GSTR-1: unregistered intra-state sales go to B2CS')
ok(g1.cdnr.length === 1 && g1.cdnr[0].notes[0].refNumber === 'UIPL/TI/26-27/001', 'GSTR-1: credit note to registered buyer goes to CDNR')
eq(g1.hsn.rows.reduce((s, r) => s + r.taxable, 0), 35000 - 2000, 'HSN summary nets credit notes')
const gj = gstr1Json(g1, { gstin: '27AADCU8036C1ZF', to: '2026-06-30' })
ok(gj.fp === '062026' && gj.b2b[0].inv[0].idt === '10-04-2026' && gj.b2b[0].inv[0].itms[0].itm_det.camt === 900, 'GSTR-1 JSON: period, dd-mm-yyyy dates, item tax')
const g3 = buildGstr3b(gdocs, { company: 'UIPL', from: '2026-04-01', to: '2026-06-30', companyStateCode: '27' })
eq(g3.t31a.taxable, 33000, '3B 3.1(a) net of credit notes'); eq(g3.t31a.cgst, 2970, '3B output CGST'); eq(g3.t31d.igst, 1800, '3B 3.1(d) RCM IGST')
eq(g3.itcOther.cgst, 900, '3B ITC other CGST'); eq(g3.itcBlocked.cgst, 90, 'blocked credit tracked separately'); eq(g3.itcRcm.igst, 1800, 'RCM ITC')
eq(g3.setOff.cash.cgst, 2970 - 900, 'cash CGST after set-off'); eq(g3.rcmCash.igst, 1800, 'RCM paid in cash')
const so = setOff({ igst: 100, cgst: 50, sgst: 50 }, { igst: 120, cgst: 10, sgst: 0 })
eq(so.cash.igst, 0, 'IGST credit clears IGST first'); eq(so.cash.cgst, 20, 'then CGST (and CGST credit)'); eq(so.cash.sgst, 50, 'SGST liability untouched by CGST credit')
const itc = itcRegister(gdocs, { company: 'UIPL', from: '2026-04-01', to: '2026-06-30' })
eq(itc.totals.blocked, 180, 'ITC register: blocked credit'); ok(itc.rows.some(r => r.status === 'Eligible (RCM)'), 'ITC register flags RCM')
ok(normInvNo('inv/0001') === 'INV0001' && normInvNo('INV-001') === normInvNo('inv001'), 'invoice number normalisation')
const books = gdocs.filter(d => d.kind === 'purchase')
const rec = reconcile2b(books, [
  { gstin: '27AAACV1234A1Z5', number: 'inv001', date: '2026-06-04', taxable: 10000, igst: 0, cgst: 900, sgst: 900 },
  { gstin: '27ZZZZZ9999Z1Z1', number: 'X-9', taxable: 500, igst: 0, cgst: 45, sgst: 45 }])
ok(rec.matched.length === 1 && rec.onlyTwoB.length === 1, '2B recon: match + only-in-2B')
const pj = parseGstr2bJson({ data: { rtnprd: '062026', docdata: { b2b: [{ ctin: '27AAACV1234A1Z5', trdnm: 'V', inv: [{ inum: 'INV-001', dt: '04-06-2026', val: 11800, itcavl: 'Y', items: [{ txval: 10000, cgst: 900, sgst: 900, igst: 0 }] }] }] } } })
ok(pj.rows.length === 1 && pj.rows[0].date === '2026-06-04' && pj.rows[0].cgst === 900, 'parse GSTR-2B portal JSON')

section('stock ledger')
const sItems = [
  { id: 'it1', name: 'Router', sku: 'RT-1', unit: 'nos', openingStock: { w1: { qty: 10, rate: 100 } }, openingDate: '2026-04-01', purchaseRate: 100 },
  { id: 'it2', name: 'Cable', sku: 'CB-1', unit: 'mtr', valuationMethod: 'fifo' },
]
const sWh = [{ id: 'w1', name: 'Main' }, { id: 'w2', name: 'Site' }]
const pur1 = { id: 'sp1', voucherType: 'purchase', voucherNumber: 'PUR/10', company: 'UIPL', date: '2026-05-01', partyName: 'V', status: 'active', itcEligible: true, items: [{ stockItemId: 'it1', qty: 10, rate: 120, taxable: 1200, cgst: 108, sgst: 108, igst: 0 }, { stockItemId: 'it2', qty: 100, rate: 10, taxable: 1000 }] }
const pur2 = { id: 'sp2', voucherType: 'purchase', voucherNumber: 'PUR/11', company: 'UIPL', date: '2026-05-02', partyName: 'V', status: 'active', items: [{ stockItemId: 'it2', qty: 100, rate: 20, taxable: 2000 }] }
const sale = { id: 'si1', invoiceType: 'TI', invoiceNumber: 'INV/9', invoiceDate: '2026-05-10', company: 'UIPL', billToName: 'Beta', items: [{ sku: 'RT-1', qty: 5, rate: 300 }, { sku: 'CB-1', qty: 150, rate: 30 }, { description: 'Router', qty: 99, rate: 1 }] }
const dnote = { id: 'sd1', voucherType: 'debit_note', voucherNumber: 'DBN/1', company: 'UIPL', date: '2026-05-12', partyName: 'V', status: 'active', items: [{ stockItemId: 'it1', qty: 2, rate: 120, taxable: 240 }] }
const xfer = { id: 'tr1', itemName: 'Router', sku: 'RT-1', qty: 3, fromLocationId: 'w1', toLocationId: 'w2', status: 'completed', createdAt: '2026-05-15T10:00:00' }
const mv = collectMovements({ stockItems: sItems, warehouses: sWh, vouchers: [pur1, pur2, dnote], invoices: [sale], transfers: [xfer] })
const vm = valueMovements(mv, sItems)
const sumOf = (id) => vm.summary.find(x => x.itemId === id)
// Router: 10 @100 open, +10 @120 → avg 110 (20 qty, 2200); sale 5 → out 550; return 2 at 120 → value 240 out; qty 13
eq(sumOf('it1').qty, 10 + 10 - 5 - 2, 'router qty'); eq(sumOf('it1').value, 2200 - 550 - 240, 'router value (moving average, return at stated cost)')
// Cable FIFO: 100@10 + 100@20, sell 150 → 100*10 + 50*20 = 2000 out; left 50 @20 = 1000
eq(sumOf('it2').qty, 50, 'cable qty'); eq(sumOf('it2').value, 1000, 'FIFO value of remaining layer')
ok(!mv.some(m => m.qty === 99), 'free-text description never moves stock')
eq(sumOf('it1').warehouses.w2, 3, 'transfer lands in destination godown'); eq(sumOf('it1').warehouses.w1, 20 - 5 - 2 - 3 + 0, 'source godown reduced')
const sLines = deriveStockLines(vm.movements, accounts)
ok(balanced(sLines), 'stock valuation lines balance')
eq(sumBy(sLines, '3200', 'credit'), 1000, 'opening stock funded by opening equity')
const net1400 = sumBy(sLines, '1400', 'debit') - sumBy(sLines, '1400', 'credit')
eq(net1400, sumOf('it1').value + sumOf('it2').value, 'books stock in hand equals the stock ledger value')
// cost folded in when ITC blocked
const mvB = valueMovements(collectMovements({ stockItems: sItems, warehouses: sWh, vouchers: [{ ...pur1, itcEligible: false }] }), sItems)
eq(mvB.summary.find(x => x.itemId === 'it1').value, 1000 + 1200 + 216, 'blocked ITC becomes part of stock cost')
// physical count
const cnt = collectMovements({ stockItems: sItems, warehouses: sWh, adjustments: [{ id: 'a1', itemName: 'Router', sku: 'RT-1', type: 'adjustment', adjustmentType: 'set', qty: 4, locationId: 'w1', createdAt: '2026-06-01T09:00:00' }] })
eq(valueMovements(cnt, sItems).summary.find(x => x.itemId === 'it1').qty, 4, "'set exact quantity' adjusts to the counted figure")
const mfg = valueMovements(collectMovements({ stockItems: sItems, warehouses: sWh, stockJournals: [{ id: 'j1', type: 'manufacture', date: '2026-06-02', company: 'UIPL', consume: [{ itemId: 'it1', qty: 4, warehouseId: 'w1' }], produce: [{ itemId: 'it2', qty: 10, warehouseId: 'w1' }] }] }), sItems)
eq(mfg.summary.find(x => x.itemId === 'it2').value, 400, 'manufactured goods carry the cost of the materials consumed')

section('TDS compliance')
ok(depositDueDate('2026-06') === '2026-07-07' && depositDueDate('2027-03') === '2027-04-30' && depositDueDate('2026-12') === '2027-01-07', 'TDS deposit due dates (7th; 30 April for March)')
ok(returnDueDate('26-27', 'Q1') === '2026-07-31' && returnDueDate('26-27', 'Q4') === '2027-05-31', 'quarterly statement due dates')
ok(monthsLate('2026-06-10', '2026-07-07') === 1 && monthsLate('2026-06-10', '2026-07-11') === 2 && monthsLate('2026-06-10', '2026-06-10') === 0, 'part month counts as a full month')
eq(lateFee(5000, '2026-07-31', '2026-08-10'), 2000, 'late fee ₹200/day'); eq(lateFee(1000, '2026-07-31', '2026-08-30'), 1000, 'late fee capped at TDS')
const tv = [
  { id: 't1', voucherType: 'purchase', voucherNumber: 'PUR/1', company: 'UIPL', date: '2026-06-10', partyId: 'v1', partyName: 'Acme', status: 'active', tds: { applicable: true, section: '194C', base: 100000, rate: 1, amount: 1000 } },
  { id: 't2', voucherType: 'payment', voucherNumber: 'PAY/1', company: 'UIPL', date: '2026-06-20', partyId: 'v1', partyName: 'Acme', status: 'active', tds: { applicable: true, section: '194C', base: 50000, rate: 1, amount: 500 } },
  { id: 't3', voucherType: 'purchase', voucherNumber: 'PUR/2', company: 'UIPL', date: '2026-06-25', partyName: 'Gone', status: 'cancelled', tds: { applicable: true, section: '194C', base: 1, rate: 1, amount: 99 } },
  { id: 't4', voucherType: 'purchase', voucherNumber: 'PUR/3', company: 'Wayzim', date: '2026-06-25', partyName: 'Other co', status: 'active', tds: { applicable: true, section: '194C', base: 1000, rate: 1, amount: 10 } },
]
const drows = deductionRows(tv, [{ id: 'v1', pan: 'ABCDE1234F' }], { company: 'UIPL' })
ok(drows.length === 2 && drows[0].pan === 'ABCDE1234F', 'deduction register skips cancelled / other-company vouchers and picks up PAN')
const junPos = (ch, asOf) => monthlyPosition(drows, ch, { company: 'UIPL', fy: '26-27', asOf }).find(m => m.month === '2026-06')
eq(junPos([], '2026-07-05').deducted, 1500, 'June TDS deducted'); ok(junPos([], '2026-07-05').status === 'pending' && junPos([], '2026-07-05').interest === 0, 'not yet due → no interest')
ok(junPos([], '2026-08-02').status === 'overdue', 'overdue after the 7th')
// unpaid: 1000 deducted 10 Jun and 500 on 20 Jun; asOf 2 Aug is inside the 2nd month for both → 2 months each
eq(junPos([], '2026-08-02').interest, 1000 * 0.015 * 2 + 500 * 0.015 * 2, 'interest on unpaid tax runs to today')
const paidLate = junPos([{ company: 'UIPL', forMonth: '2026-06', depositDate: '2026-07-20', tax: 1500, interest: 0 }], '2026-08-02')
ok(paidLate.status === 'paid-late', 'deposit after due date flagged'); eq(paidLate.interest, 1000 * 0.015 * 2 + 500 * 0.015 * 1, 'late-deposit interest from deduction date to deposit')
ok(junPos([{ company: 'UIPL', forMonth: '2026-06', depositDate: '2026-07-07', tax: 1500 }], '2026-08-02').status === 'paid', 'deposit on the due date is on time')
eq(quarterData(drows, [], { company: 'UIPL', fy: '26-27', q: 'Q1' }).totalDeducted, 1500, 'Q1 statement total')
eq(deducteeSummary(drows)[0].amount, 1500, 'deductee-wise totals combine bill and payment deductions')
eq(receivableRows([{ id: 'r', voucherType: 'receipt', company: 'UIPL', date: '2026-06-02', partyName: 'C', status: 'active', partyAmount: 10000, tdsReceivable: { applicable: true, amount: 200, section: '194C' } }], { company: 'UIPL' })[0].amount, 200, 'TDS receivable register')

section('financial statements')
const mkL = (accountCode, debit, credit, date, extra = {}) => ({ accountCode, debit, credit, date, company: 'UIPL', sourceType: 'x', sourceId: extra.sourceId || accountCode + date, ...extra })
const stLines = [
  ...sLines,                                                            // stock valuation from the engine
  mkL('5000', 4200, 0, '2026-05-02', { sourceId: 'p' }), mkL('2100', 0, 4200, '2026-05-02', { sourceId: 'p' }),       // purchases
  mkL('2100', 240, 0, '2026-05-12', { sourceId: 'dn' }), mkL('5000', 0, 240, '2026-05-12', { sourceId: 'dn' }),       // purchase return
  mkL('1200', 6000, 0, '2026-05-10', { sourceId: 's' }), mkL('4000', 0, 6000, '2026-05-10', { sourceId: 's' }),        // sales
  mkL('5100', 500, 0, '2026-05-20', { sourceId: 'rent' }), mkL('1100', 0, 500, '2026-05-20', { sourceId: 'rent' }),
  mkL('1100', 6000, 0, '2026-05-25', { sourceId: 'rc' }), mkL('1200', 0, 6000, '2026-05-25', { sourceId: 'rc' }),
]
const tp = tradingPL(stLines, accounts, { company: 'UIPL', from: '2026-04-01', to: '2026-06-30' })
eq(tp.openingStock, 1000, 'opening stock'); eq(tp.closingStock, 2410, 'closing stock = ledger value'); eq(tp.purchases, 3960, 'net purchases')
eq(tp.cogs, 1000 + 3960 - 2410, 'cost of goods = opening + purchases − closing'); eq(tp.grossProfit, 6000 - 2550, 'gross profit'); eq(tp.residualStock, 0, 'no unexplained stock adjustment')
eq(tp.netProfit, 6000 - 2550 - 500, 'net profit after rent')
const tbNet = accounts.filter(a => a.type === 'income').reduce((s, a) => s + balanceUpTo(stLines, a.code, { company: 'UIPL', asOf: '2026-06-30' }) * -1, 0) - accounts.filter(a => a.type === 'expense').reduce((s, a) => s + balanceUpTo(stLines, a.code, { company: 'UIPL', asOf: '2026-06-30' }), 0)
eq(tp.netProfit, tbNet, 'trading/P&L net profit equals income − expense straight from the ledger')
const cf = cashFlow(stLines, accounts, { company: 'UIPL', from: '2026-04-01', to: '2026-06-30' })
eq(cf.netChange, 6000 - 500, 'cash flow net change'); eq(cf.closing, 5500, 'closing cash')
eq(cf.sections[0].inflow, 6000, 'operating inflow (customers)')
const rt = ratios(stLines, accounts, { company: 'UIPL', from: '2026-04-01', to: '2026-06-30' })
ok(rt.items.find(i => i.key === 'gm').value > 50, 'gross margin computed')
const ccL = [mkL('5100', 300, 0, '2026-05-01', { costCentreId: 'cc1' }), mkL('4000', 0, 1000, '2026-05-01', { costCentreId: 'cc1' }), mkL('5100', 50, 0, '2026-05-01')]
eq(costCentreSummary(ccL, accounts, { company: 'UIPL', from: '2026-04-01', to: '2026-06-30' })[0].net, 700, 'cost-centre net = income − expense for tagged lines only')
eq(budgetVsActual(ccL, accounts, [{ company: 'UIPL', accountCode: '5100', amount: 12000, costCentreId: 'cc1' }], { company: 'UIPL', from: '2026-04-01', to: '2026-06-30' })[0].budget, 3000, 'budget pro-rated by months in period')

section('bank reconciliation')
const parsed = parseBankStatement([
  ['HDFC Bank Statement'], ['Date', 'Narration', 'Chq./Ref.No.', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
  ['10/05/26', 'NEFT-BETA LTD', 'N123', '', '10,000.00', '60,000.00'], ['12/05/26', 'CHQ 000045 ACME', '000045', '5,000.00', '', '55,000.00'], ['15-Jun-2026', 'INT CREDIT', '', '', '100.00', '55,100.00'],
])
ok(parsed.lines.length === 3 && parsed.lines[0].credit === 10000 && parsed.lines[1].debit === 5000 && parsed.lines[2].date === '2026-06-15', 'bank statement parsed (date formats, columns, amounts)')
const bankLines = [
  { accountCode: '1100', debit: 50000, credit: 0, date: '2026-04-01', company: 'UIPL', sourceType: 'opening', sourceId: 'bank-b1', bankAccountId: 'b1' },
  { accountCode: '1100', debit: 10000, credit: 0, date: '2026-05-11', company: 'UIPL', sourceType: 'receipt', sourceId: 'r1', sourceDocNumber: 'RCT/1', bankAccountId: 'b1' },
  { accountCode: '1100', debit: 0, credit: 5000, date: '2026-05-08', company: 'UIPL', sourceType: 'payment', sourceId: 'p1', sourceDocNumber: 'PAY/1', bankAccountId: 'b1' },
  { accountCode: '1100', debit: 0, credit: 700, date: '2026-05-30', company: 'UIPL', sourceType: 'payment', sourceId: 'p2', sourceDocNumber: 'PAY/2', bankAccountId: 'b1' },
]
const ents = bookEntries(bankLines, { company: 'UIPL', bankAccountId: 'b1' })
const stm = parsed.lines.map((l, i) => ({ ...l, id: 's' + i, matchedKey: '' }))
const props = autoMatch(stm, ents)
ok(props.length === 2, 'auto-match pairs same-amount entries within the date window')
props.forEach(p => { stm.find(s => s.id === p.statementId).matchedKey = p.key })
const rec2 = reconciliation(stm, ents, '2026-06-30')
eq(rec2.bookBalance, 50000 + 10000 - 5000 - 700, 'book balance'); eq(rec2.chequesOutstanding, 700, 'cheque issued but not cleared'); eq(rec2.bankOnlyNet, 100, 'bank credit not in books')
eq(rec2.expected, 54300 + 700 + 100, 'expected bank balance'); eq(rec2.difference, 55100 - 55100, 'reconciles to the statement balance')

section('Tally export')
const tv2 = tallyVouchers({ lines: all, company: 'UIPL', from: '2026-04-01', to: '2026-12-31', companyName: 'Test & Co' })
ok(tv2.count > 5 && tv2.xml.includes('<VOUCHER VCHTYPE="Sales"') && tv2.xml.includes('<VCHTYPE') === false, 'Tally vouchers XML generated')
const vblocks = tv2.xml.split('<VOUCHER ').slice(1)
ok(vblocks.every(b => Math.abs([...b.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((t, m) => t + Number(m[1]), 0)) < 0.01), 'every exported voucher nets to zero')
ok(tv2.xml.includes('Test &amp; Co'), 'XML special characters escaped')
ok(tallyMasters({ accounts, lines: all, customers: [{ shopName: 'Beta Ltd' }], vendors: [], bankAccounts: [], company: 'Test' }).includes('<PARENT>Sundry Debtors</PARENT>'), 'party ledgers go under Sundry Debtors')

section('e-invoice / e-way bill files')
const sellerCo = { gstin: '27AADCU8036C1ZF', legalName: 'UIPL', address: 'D 102 Pittie', city: 'Pune', pincode: '411014', stateCode: '27' }
const einv = { ...invoices[0], billToAddress: '1 MG Road', billToCity: 'Pune', billToPincode: '411001', billToGstin: '27AAACC5678B1Z3', total: 11800, roundOff: 0 }
ok(invoiceProblems(einv, sellerCo).length === 0, 'complete invoice passes the readiness check')
ok(invoiceProblems({ ...einv, billToPincode: '' }, sellerCo).some(p => /pincode/.test(p)), 'missing pincode is flagged')
const irn = buildEInvoice(einv, sellerCo)
ok(irn.DocDtls.Dt === '10/04/2026' && irn.Version === '1.1' && irn.BuyerDtls.Pin === 411001, 'e-invoice header (dd/mm/yyyy date, numeric pin)')
eq(irn.ValDtls.AssVal, 10000, 'e-invoice assessable value'); eq(irn.ValDtls.CgstVal, 900, 'e-invoice CGST'); eq(irn.ValDtls.TotInvVal, 11800, 'e-invoice total'); eq(irn.ItemList[0].TotItemVal, 11800, 'item total')
const ewb = buildEwayBill(einv, sellerCo, { mode: 1, distance: '120', vehicleNo: 'mh 12-ab 1234' })
ok(ewb.vehicleNo === 'MH12AB1234' && ewb.transDistance === '120' && ewb.fromStateCode === 27 && ewb.itemList[0].cgstRate === 9, 'e-way bill transport and tax rates')
ok(ewayProblems({ mode: 1, distance: '' }, einv).length >= 2, 'e-way bill needs distance and vehicle / transporter')
const j3 = gstr3bJson(g3, { gstin: sellerCo.gstin, to: '2026-06-30' })
ok(j3.ret_period === '062026' && j3.sup_details.osup_det.camt === 2970 && j3.itc_elg.itc_avl.find(x => x.ty === 'OTH').camt === 900, 'GSTR-3B JSON mapping')

section('fixed deposit / trust accounting')
const fdAccts = [...accounts, { code: '1600', name: 'Fixed Deposit - HDFC', type: 'asset', normalBalance: 'debit' }]
let fdv = { id: 'fd1', voucherType: 'contra', voucherNumber: 'CON/9', company: 'UIPL', date: '2026-06-01', amount: 100000, fromAccountCode: '1100', toAccountCode: '1600', fromBankAccountId: 'bank1' }
let fdL = deriveVoucherLines(fdv, fdAccts)
ok(balanced(fdL), 'bank to FD contra balances'); eq(sumBy(fdL, '1600', 'debit'), 100000, 'Dr Fixed Deposit'); eq(sumBy(fdL, '1100', 'credit'), 100000, 'Cr bank')
fdv = { id: 'fd2', voucherType: 'receipt', voucherNumber: 'RCT/9', company: 'UIPL', date: '2027-06-01', partyAmount: 0, bankAccountCode: '1100', bankAccountId: 'bank1',
  accountLines: [{ accountCode: '1600', amount: 100000 }, { accountCode: '4910', amount: 7000 }], tdsReceivable: { applicable: true, amount: 700, section: '194A' } }
fdL = deriveVoucherLines(fdv, fdAccts)
ok(balanced(fdL), 'FD maturity receipt (principal + interest, bank TDS) balances')
eq(sumBy(fdL, '1100', 'debit'), 106300, 'bank receives principal + interest - TDS'); eq(sumBy(fdL, '1310', 'debit'), 700, 'TDS receivable booked'); eq(sumBy(fdL, '1600', 'credit'), 100000, 'FD closed'); eq(sumBy(fdL, '4910', 'credit'), 7000, 'interest income')

section('multi-currency')
const fcT = computeVoucherTotals([{ qty: 10, rate: 100, gstRate: 0 }], { supplyType: 'inter', applyGst: false, rounding: false })
const inrT = convertTotals(fcT, 83, 'USD')
eq(inrT.total, 83000, 'USD 1,000 at 83 = ₹83,000'); eq(inrT.fc.total, 1000, 'foreign total remembered')
const usdBill = { id: 'ub1', voucherType: 'purchase', voucherNumber: 'PUR/U1', company: 'UIPL', date: '2026-07-01', partyName: 'Acme Inc', partyId: 'v7', applyGst: false, creditDays: 30, currency: 'USD', fxRate: 83, fc: inrT.fc, items: inrT.items, gstLines: inrT.gstLines, subTotal: inrT.subTotal, total: inrT.total, roundOff: 0 }
let uL = deriveVoucherLines(usdBill, accounts)
ok(balanced(uL), 'foreign purchase balances in INR'); eq(sumBy(uL, '2100', 'credit'), 83000, 'payable in INR')
ok(uL.find(l => l.accountCode === '2100').fcAmount === 1000 && uL.find(l => l.accountCode === '2100').currency === 'USD', 'payable line remembers USD 1,000')
// pay in full at a worse rate: loss
const usdPay = { id: 'up1', voucherType: 'payment', voucherNumber: 'PAY/U1', company: 'UIPL', date: '2026-08-01', partyName: 'Acme Inc', partyId: 'v7', bankAccountCode: '1100', currency: 'USD', fxRate: 85,
  partyAmount: 83000, bankAmountInr: 85000, allocations: [{ billKey: 'purchase:ub1', docNumber: 'PUR/U1', amount: 83000, fcAmount: 1000, billRate: 83 }] }
let pL = deriveVoucherLines(usdPay, accounts)
ok(balanced(pL), 'foreign payment balances'); eq(sumBy(pL, '1100', 'credit'), 85000, 'bank pays at today\'s rate'); eq(sumBy(pL, '2100', 'debit'), 83000, 'bill cleared at its booking rate'); eq(sumBy(pL, '5925', 'debit'), 2000, 'exchange loss booked')
let os3 = computeOutstanding([...uL, ...pL], { kind: 'payable', company: 'UIPL', asOf: '2026-12-31' })
ok(os3.parties.length === 0, 'fully settled foreign bill leaves nothing outstanding')
// part payment: USD 400 at 81 -> gain
const part = { ...usdPay, id: 'up2', fxRate: 81, partyAmount: 33200, bankAmountInr: 32400, allocations: [{ billKey: 'purchase:ub1', docNumber: 'PUR/U1', amount: 33200, fcAmount: 400, billRate: 83 }] }
pL = deriveVoucherLines(part, accounts)
ok(balanced(pL) && sumBy(pL, '4925', 'credit') === 800, 'part payment at a better rate books an exchange gain')
os3 = computeOutstanding([...uL, ...pL], { kind: 'payable', company: 'UIPL', asOf: '2026-12-31' })
const ob = os3.parties[0].bills[0]
eq(ob.pending, 49800, 'rupee balance'); eq(ob.fcPending, 600, 'USD 600 still owed')
const rv = revaluation(os3.parties[0].bills, 'payable', () => 86)
eq(rv[0].closingInr, 51600, 'USD 600 at closing rate 86'); eq(rv[0].gain, -1800, 'unrealised loss on a payable when the currency strengthens')
// foreign sales invoice + receipt at better rate: gain
const usdInv = { id: 'ui1', invoiceType: 'TI', invoiceNumber: 'INV/U1', invoiceDate: '2026-07-05', company: 'UIPL', billToName: 'Zeta LLC', applyGst: false, subTotal: 41000, gstLines: [], total: 41000, roundOff: 0, fx: { currency: 'USD', rate: 82, total: 500 } }
const invL = deriveAllLines({ invoices: [usdInv], payments: [], orders: [], expenses: [], payables: [], accounts, vouchers: [] })
const usdRct = { id: 'ur1', voucherType: 'receipt', voucherNumber: 'RCT/U1', company: 'UIPL', date: '2026-08-05', partyName: 'Zeta LLC', bankAccountCode: '1100', currency: 'USD', fxRate: 84, partyAmount: 41000, bankAmountInr: 42000, allocations: [{ billKey: 'invoice:ui1', docNumber: 'INV/U1', amount: 41000, fcAmount: 500, billRate: 82 }] }
const rL = deriveVoucherLines(usdRct, accounts)
ok(balanced(rL) && sumBy(rL, '4925', 'credit') === 1000 && sumBy(rL, '1100', 'debit') === 42000, 'foreign receipt at a better rate books an exchange gain')
ok(computeOutstanding([...invL, ...rL], { kind: 'receivable', company: 'UIPL', asOf: '2026-12-31' }).parties.length === 0, 'foreign invoice cleared by the receipt')
const rates = [{ currency: 'USD', date: '2026-07-01', rate: 83 }, { currency: 'USD', date: '2026-08-01', rate: 85 }]
eq(rateOn(rates, 'USD', '2026-07-20'), 83, 'rate on a date uses the latest rate on or before it'); eq(rateOn(rates, 'USD', '2026-09-01'), 85, 'later date uses latest known'); eq(rateOn(rates, 'INR', '2026-09-01'), 1, 'INR is always 1')
ok(fmtFc(1234.5, 'USD') === '$ 1,234.50', 'foreign amount formatting')

section('exports (GST)')
const expInv = { id: 'ex1', invoiceType: 'TI', invoiceNumber: 'EXP/1', invoiceDate: '2026-07-05', company: 'UIPL', billToName: 'Zeta LLC', applyGst: false, isExport: true, exportType: 'WOPAY', shippingBillNo: '123456', portCode: 'INBOM1', posStateCode: '96', sellerStateCode: '27',
  items: [{ description: 'Service', hsnCode: '9983', qty: 1, rate: 500, gstRate: 18, unit: 'nos' }], subTotal: 41000, gstLines: [], total: 41000, roundOff: 0, fx: { currency: 'USD', rate: 82, total: 500, subTotal: 500, taxTotal: 0, gstLines: [] } }
const exDocs = normalizeTaxDocs({ invoices: [expInv, ...invoices.slice(0, 1)], vouchers: [], payables: [], vendors: [] })
const gx = buildGstr1(exDocs, { company: 'UIPL', from: '2026-04-01', to: '2026-12-31', companyStateCode: '27', gstin: '27AADCU8036C1ZF' })
ok(gx.exports.length === 1 && gx.exports[0].exportType === 'WOPAY' && gx.exports[0].taxable === 41000, 'export invoice goes to table 6A')
ok(gx.b2b.every(p => p.invoices.every(i => i.number !== 'EXP/1')), 'export invoice is not in B2B / B2C')
eq(gx.nil.interUnreg + gx.nil.interReg + gx.nil.intraReg + gx.nil.intraUnreg, 0, 'export is not reported as nil-rated')
const gxj = gstr1Json(gx, { gstin: '27AADCU8036C1ZF', to: '2026-12-31' })
ok(gxj.exp?.[0].exp_typ === 'WOPAY' && gxj.exp[0].inv[0].sbnum === '123456' && gxj.exp[0].inv[0].itms[0].txval === 41000, 'portal JSON carries exports')
const g3x = buildGstr3b(exDocs, { company: 'UIPL', from: '2026-04-01', to: '2026-12-31', companyStateCode: '27' })
eq(g3x.t31b.taxable, 41000, '3B 3.1(b) zero-rated supplies include the export'); eq(g3x.t31c.taxable, 0, 'export not in nil-rated')
const hs = hsnSummary(normalizeTaxDocs({ invoices: [expInv], vouchers: [], payables: [], vendors: [] }), { company: 'UIPL', from: '2026-04-01', to: '2026-12-31', split: false })
eq(hs.rows.find(r => r.hsn === '9983' && r.rate === 18 && r.taxable === 41000) ? 1 : 0, 1, 'HSN summary uses rupee value of foreign items')

section('PF / ESIC and payroll')
const SS = mergeStatutory()
let st1 = computeStatutory({ emp: { pfApplicable: true, basicSalary: 20000 }, gross: 40000, s: SS })
eq(st1.pfEmployee, 1800, 'PF employee 12% of the ₹15,000 ceiling'); eq(st1.pfEmployerEps, 1250, 'EPS 8.33% of ceiling'); eq(st1.pfEmployerEpf, 550, 'employer EPF = 12% − EPS'); eq(st1.pfEdli, 75, 'EDLI 0.5% of ceiling')
st1 = computeStatutory({ emp: { pfApplicable: true, pfOnActual: true, basicSalary: 20000 }, gross: 40000, s: SS })
eq(st1.pfEmployee, 2400, 'PF on actual basic when opted'); eq(st1.pfEmployerEps, 1250, 'EPS still capped'); eq(st1.pfEmployerEpf, 1150, 'rest of employer 12% goes to EPF')
st1 = computeStatutory({ emp: { pfApplicable: true }, gross: 12000, s: SS })
eq(st1.pfWage, 6000, 'no basic recorded → 50% of gross'); eq(st1.pfEmployee, 720, 'PF on that wage')
eq(computeStatutory({ emp: { pfApplicable: false, esicApplicable: false }, gross: 20000, s: SS }).pfEmployee, 0, 'nothing deducted unless switched on')
let es = computeStatutory({ emp: { esicApplicable: true }, gross: 18000, s: SS })
eq(es.esicEmployee, 135, 'ESIC employee 0.75%'); eq(es.esicEmployer, 585, 'ESIC employer 3.25%')
eq(computeStatutory({ emp: { esicApplicable: true }, gross: 25000, s: SS }).esicEmployer, 0, 'ESIC stops above ₹21,000')
es = computeStatutory({ emp: { esicApplicable: true }, gross: 5000, s: SS })
eq(es.esicEmployee, 0, 'no employee ESIC at ₹176 a day or less'); eq(es.esicEmployer, 163, 'employer share rounded up')
const slipsP = [
  { employeeId: 'e1', employeeName: 'Asha Rao', baseSalary: 40000, advancesDeducted: 1000, deductions: 200, ...computeStatutory({ emp: { pfApplicable: true, basicSalary: 20000, uan: '123456789012' }, gross: 40000, s: SS }) },
  { employeeId: 'e2', employeeName: 'Ravi K', baseSalary: 18000, advancesDeducted: 0, deductions: 0, ...computeStatutory({ emp: { esicApplicable: true, pfApplicable: true }, gross: 18000, s: SS }) },
].map(x => ({ ...x, netSalary: x.baseSalary - x.advancesDeducted - x.deductions - x.pfEmployee - x.esicEmployee }))
eq(pfAdminCharge(slipsP, SS), 500, 'PF admin charge has a monthly minimum')
const pt = payrollTotals(slipsP, SS)
eq(pt.gross, 58000, 'payroll gross')
const payV = { id: 'pr1', voucherType: 'payroll', voucherNumber: 'UIPL/PRL/26-27/001', company: 'UIPL', date: '2026-09-30', month: '2026-09', payroll: { gross: pt.gross, employerPf: pt.employerPf, employerEsic: pt.esicEmployer, pfCharges: pt.pfCharges, net: pt.gross - pt.pfEmployee - pt.esicEmployee - pt.advances - pt.otherDeductions, pfPayable: pt.pfPayable, esicPayable: pt.esicPayable, advances: pt.advances, otherDeductions: pt.otherDeductions } }
const payL = deriveVoucherLines(payV, accounts)
ok(balanced(payL), 'payroll journal balances')
eq(sumBy(payL, '5110', 'debit'), 58000, 'gross salaries expense'); eq(sumBy(payL, '2610', 'credit'), pt.pfPayable, 'PF payable = employee + employer + charges'); eq(sumBy(payL, '2620', 'credit'), pt.esicPayable, 'ESIC payable')
eq(sumBy(payL, '5115', 'debit') + sumBy(payL, '5116', 'debit') + sumBy(payL, '5117', 'debit'), pt.employerPf + pt.esicEmployer + pt.pfCharges, 'employer cost booked')
const ecr = buildEcr(slipsP, { e1: { uan: '123456789012' }, e2: { uan: '' } }, SS)
ok(ecr.text.split('\n')[0].startsWith('123456789012#~#ASHA RAO#~#40000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0'), 'ECR line layout'); ok(ecr.problems.some(x => /Ravi/.test(x)), 'ECR flags a missing UAN')
eq(esicRows(slipsP, {}).length, 1, 'ESIC template lists only ESIC members'); ok(contributionDue('2026-12') === '2027-01-15' && contributionDue('2026-09') === '2026-10-15', 'PF / ESIC due on the 15th of next month')

section('UIPL ⇄ Wayzim service fee')
const icInv = { id: 'ic1', invoiceType: 'TI', invoiceNumber: 'UIPL/TI/26-27/050', invoiceDate: '2026-07-31', dueDate: '2026-08-30', company: 'UIPL', billToName: 'Wayzim Technology Co Ltd', interCompany: 'Wayzim', applyGst: false, isExport: true,
  subTotal: 83000, gstLines: [], total: 83000, roundOff: 0, fx: { currency: 'USD', rate: 83, total: 1000 } }
const icRct = { id: 'icr1', voucherType: 'receipt', voucherNumber: 'UIPL/RCT/26-27/009', company: 'UIPL', date: '2026-08-20', partyName: 'Wayzim Technology Co Ltd', interCompany: 'Wayzim', bankAccountCode: '1100', currency: 'USD', fxRate: 85,
  partyAmount: 83000, bankAmountInr: 85000, allocations: [{ billKey: 'invoice:ic1', docNumber: 'UIPL/TI/26-27/050', amount: 83000, fcAmount: 1000, billRate: 83 }] }
const icL = deriveAllLines({ invoices: [icInv], payments: [], orders: [], expenses: [], payables: [], accounts, vouchers: [icRct] })
const wz = icL.filter(l => l.company === 'Wayzim'), up = icL.filter(l => l.company === 'UIPL')
ok(balanced(wz) && balanced(up), 'both companies stay balanced')
eq(wz.filter(l => l.accountCode === '5200').reduce((s, l) => s + l.debit, 0), 83000, 'Wayzim books the service fee as a cost')
eq(up.filter(l => l.accountCode === '4000').reduce((s, l) => s + l.credit, 0), 83000, 'UIPL books it as income')
eq(wz.filter(l => l.accountCode === '1100').reduce((s, l) => s + l.credit, 0), 85000, 'Wayzim pays the rupee amount UIPL received')
eq(wz.filter(l => l.accountCode === '5925').reduce((s, l) => s + l.debit, 0), 2000, 'Wayzim books the exchange loss UIPL books as a gain')
eq(up.filter(l => l.accountCode === '4925').reduce((s, l) => s + l.credit, 0), 2000, 'UIPL books the exchange gain')
ok(computeOutstanding(icL.filter(l => l.company === 'Wayzim'), { kind: 'payable', company: 'Wayzim', asOf: '2026-12-31' }).parties.length === 0, 'service fee fully paid leaves nothing owed to UIPL')
const wzOpen = computeOutstanding(deriveAllLines({ invoices: [icInv], payments: [], orders: [], expenses: [], payables: [], accounts, vouchers: [] }).filter(l => l.company === 'Wayzim'), { kind: 'payable', company: 'Wayzim', asOf: '2026-12-31' })
ok(wzOpen.parties[0]?.name === 'UIPL' && wzOpen.parties[0].bills[0].fcPending === 1000, 'unpaid service fee is a USD 1,000 payable to UIPL in Wayzim\'s books')
ok(deriveInterCompanyLines({ invoices: [{ ...icInv, interCompany: null }], vouchers: [], accounts }).length === 0, 'ordinary invoices are not mirrored')

section('bank statement PDF → entries')
{
  const H = [{ x: 36, y: 700, s: 'Bank reference' }, { x: 122, y: 700, s: 'Customer reference' }, { x: 209, y: 700, s: 'TRN type' }, { x: 296, y: 700, s: 'Value Date' }, { x: 383, y: 700, s: 'Credit amount' }, { x: 469, y: 700, s: 'Debit amount' }, { x: 556, y: 700, s: 'Balance' }, { x: 643, y: 700, s: 'Time' }, { x: 730, y: 700, s: 'Post Date' }]
  const tx = (y, ref, cust, typ, date, cr, dr, bal) => [{ x: 36, y, s: ref }, { x: 122, y, s: cust }, { x: 209, y, s: typ }, { x: 296, y, s: date }, ...(cr ? [{ x: 383, y, s: cr }] : []), ...(dr ? [{ x: 469, y, s: dr }] : []), { x: 556, y, s: bal }, { x: 643, y, s: '10:00' }, { x: 730, y, s: date }]
  const narr = (y, t) => [{ x: 36, y, s: 'Narrative' }, { x: 137, y, s: t }]
  const page1 = [...H, ...tx(650, 'HSBCN5202609', 'NONREF', 'TFR-', '30 Sep 2026', '', '-1,000.00', '4,000.00'), { x: 36, y: 640, s: '51763' }, ...narr(630, 'PLUXEE, 01897JW004P5, /0007351003'),
    ...tx(600, 'NONREF', 'NONREF', 'TFR+', '29 Sep 2026', '2,500.00', '', '5,000.00'), ...narr(590, 'NEFT FROM DEUTSCHE BANK, DEUTN520')]
  const page2 = [...H, ...narr(650, 'KHARBANDA S'), ...tx(620, 'NONREF', 'NONREF', 'TFR-', '28 Sep 2026', '', '-500.00', '2,500.00'), ...narr(610, 'Bank Charges, 01AUG2026 TO 31AUG2026')]
  const r = parseStatementPages([page1, page2])
  ok(!r.error && r.lines.length === 3, 'PDF: three transactions found')
  ok(r.meta.newestFirst && r.lines[0].date === '2026-09-28' && r.lines[2].date === '2026-09-30', 'PDF: newest-first statement is stored oldest first')
  ok(r.meta.balanceBreaks === 0, 'PDF: running balances chain')
  ok(r.lines[2].ref === 'HSBCN520260951763' && r.lines[2].debit === 1000, 'PDF: wrapped bank reference rejoined, debit sign dropped')
  ok(/DEUTSCHE BANK.*KHARBANDA S/.test(r.lines[1].description) && /Bank Charges/.test(r.lines[0].description), 'PDF: narrative that continues on the next page stays with its transaction')
  ok(parseStatementPages([[{ x: 1, y: 1, s: '' }]]).error?.includes('no readable text'), 'PDF: a scanned statement is refused with advice')

  const ctx = { customers: [{ id: 'c1', name: 'Wayzim Technology Co.,Ltd.' }, { id: 'c2', name: 'INSTAKART SERVICES PRIVATE LIMITED' }], vendors: [{ id: 'v1', name: 'PLUXEE INDIA PRIVATE LIMITED' }, { id: 'v2', name: 'Agile Engineering Solutions' }, { id: 'v3', name: 'S.R. ENGINEERING' }, { id: 'v4', name: 'JAFERANI STEEL YARD' }],
    banks: [{ id: 'b1', name: 'HSBC', accountNumber: '105-012819-001' }, { id: 'b2', name: 'HDFC', accountNumber: '99900024242427' }], thisBankId: 'b1' }
  const sg = (description, credit, debit, trnType = '') => suggestEntry({ date: '2026-09-01', description, credit, debit, trnType }, ctx)
  ok(sg('NEFT FROM DEUTSCHE BANK, DEUTN52026012701020065', 100, 0).partyId === 'c1', 'rules: Deutsche Bank remittance = Wayzim receipt')
  ok(sg('TFR+ INSTAKART SERVICES PVT L, BL//', 100, 0).partyId === 'c2', 'rules: customer matched from a shortened name')
  ok(sg('PLUXEE, 01897JW004P5, /0007351003', 0, 100).partyId === 'v1', 'rules: vendor matched')
  ok(sg('AGILE ENGINEERING SOLUTIONS, 5178', 0, 100).partyId === 'v2' && sg('S.R. ENGINEERING, 51227', 0, 100).partyId === 'v3', 'rules: similar names resolve to the right vendor')
  ok(sg('JAFRANI STEEL YARD, 14177', 0, 100).partyId === 'v4', 'rules: one-letter spelling difference tolerated')
  ok(sg('UDISHTHA INNOVATIONS PVT LTD, 37967BE00IJT, /99900024242427', 0, 600000).otherBankId === 'b2' && sg('UDISHTHA INNOVATIONS PVT LTD, 37967BE00IJT, /99900024242427', 0, 1).kind === 'contra', 'rules: transfer to own account number = contra to that bank')
  ok(sg('MH CGST : 9.0000, GS25357', 0, 262.4, 'TFR- TAX').accountCode === '1301' && sg('Bank Charges, 01AUG2026', 0, 12.98, 'TFR- SVC').accountCode === '5170', 'rules: GST on charges → input CGST, charges → bank charges')
  ok(sg('SALARY NOV -2025 · ALOK JAYRAM PATOLE', 0, 5).accountCode === '5110' && sg('AUTOPAY OUT AAI, BatchSalSept2026', 0, 5).accountCode === '5110', 'rules: salaries')
  const unk = sg('SOMEBODY UNKNOWN', 5, 0)
  ok(unk.review && unk.accountCode === '2900' && sg('SOMEBODY UNKNOWN', 0, 5).accountCode === '5900', 'rules: unidentified lines are parked and flagged')

  const accs = SEED_ACCOUNTS.map(a => ({ ...a, id: a.code }))
  for (const [line, sug] of [[{ id: 'L1', date: '2026-09-22', description: 'x', ref: 'R1', credit: 1388738.74, debit: 0 }, { kind: 'receipt', partyType: 'customer', partyId: 'c1', partyName: 'Wayzim Technology Co.,Ltd.' }],
    [{ id: 'L2', date: '2026-09-22', description: 'y', ref: '', credit: 0, debit: 125373 }, { kind: 'payment', partyType: 'vendor', partyId: 'v1', partyName: 'PLUXEE' }],
    [{ id: 'L3', date: '2026-09-22', description: 'z', ref: '', credit: 0, debit: 12.98 }, { kind: 'payment', accountCode: '5170', reason: 'Bank charges' }]]) {
    const v = { id: 'V' + line.id, voucherNumber: 'T/1', ...buildVoucher({ ...sug }, line, { company: 'UIPL', bank: { id: 'b1', name: 'HSBC' } }) }
    const dl = deriveVoucherLines(v, accs)
    ok(balanced(dl), `entry from statement line ${line.id} balances`)
    const be = bookEntries(dl, { company: 'UIPL', bankAccountId: 'b1' })
    ok(be.length === 1 && be[0].key === bankLineKey(v.voucherType, v.id, line), `statement line ${line.id} is matched straight to its entry (key ${be[0]?.key})`)
  }
  const ct = { id: 'VC', voucherNumber: 'T/2', ...buildVoucher({ kind: 'contra', otherBank: { id: 'b2', name: 'HDFC' } }, { id: 'L4', date: '2026-09-22', credit: 0, debit: 600000, description: 'FD' }, { company: 'UIPL', bank: { id: 'b1', name: 'HSBC' } }) }
  const cl = deriveVoucherLines(ct, accs)
  ok(balanced(cl) && bookEntries(cl, { company: 'UIPL', bankAccountId: 'b1' })[0].key === bankLineKey('contra', 'VC', { credit: 0, debit: 600000 }) && bookEntries(cl, { company: 'UIPL', bankAccountId: 'b2' })[0].debit === 600000, 'contra: leaves HSBC, lands in HDFC, and matches the statement line')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
