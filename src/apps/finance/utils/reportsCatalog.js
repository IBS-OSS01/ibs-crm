// The catalogue behind the Reports Center: every report and function in Finance, by category, plus the per-browser
// favourites and last-visited times that the center shows.
const GROUPS = [
  ['Vouchers', 'Enter transactions', [
    ['Purchase (F9)', '/finance/vouchers/purchase', 'Vendor bills with input tax credit, RCM and TDS'],
    ['Receipt (F6)', '/finance/vouchers/receipt', 'Customer receipts against invoices, advances, TDS deducted by customer'],
    ['Payment (F5)', '/finance/vouchers/payment', 'Vendor payments and direct expenses, TDS deduction'],
    ['Contra (F4)', '/finance/vouchers/contra', 'Cash deposits / withdrawals and bank transfers'],
    ['Credit Note (Ctrl+F8)', '/finance/vouchers/credit_note', 'Sales returns and post-sale discounts'],
    ['Debit Note (Ctrl+F9)', '/finance/vouchers/debit_note', 'Purchase returns and rate differences'],
    ['Purchase Order (Ctrl+F5)', '/finance/vouchers/purchase_order', 'Order goods; track what is still pending'],
    ['Stock Journal (Ctrl+F7)', '/finance/vouchers/stock_journal', 'Godown transfers, stock-take adjustments, manufacturing'],
    ['Sales Invoices', '/finance/invoices', 'Tax invoice, pro-forma and sales orders'],
    ['Journal Entries', '/finance/journal', 'Manual adjustments (admin)'],
  ]],
  ['Books', 'Day-to-day records', [
    ['Day Book', '/finance/daybook', 'Every voucher by date'],
    ['Ledger Statement', '/finance/ledger', 'Any account or party, with running balance'],
    ['Cash / Bank Book', '/finance/cashbank', 'Receipts, payments and balances per account'],
    ['General Ledger', '/finance/gl', 'All entries for an account'],
    ['Sales Register', '/finance/registers/sales', 'Month-wise and voucher-wise with GST'],
    ['Purchase Register', '/finance/registers/purchase', 'Month-wise and voucher-wise with ITC'],
    ['Credit / Debit Note Registers', '/finance/registers/credit_note', ''],
    ['Receipt / Payment / Contra / Journal Registers', '/finance/registers/receipt', ''],
  ]],
  ['Outstanding', 'Who owes whom', [
    ['Receivables — bill-wise & ageing', '/finance/outstanding/receivables', 'Pending invoices by customer with ageing buckets'],
    ['Payables — bill-wise & ageing', '/finance/outstanding/payables', 'Pending bills by vendor'],
    ['Party Ledgers', '/finance/parties', 'Credit terms, default TDS, opening balances'],
  ]],
  ['Statements', 'Position and performance', [
    ['Trial Balance', '/finance/trial-balance', ''],
    ['Trading & Profit-and-Loss', '/finance/statements/trading', 'Gross profit, net profit, opening / closing stock'],
    ['Balance Sheet', '/finance/balance-sheet', ''],
    ['Cash Flow', '/finance/statements/cashflow', 'Where cash came from and went'],
    ['Ratio Analysis', '/finance/statements/ratios', 'Liquidity, margins, working-capital days'],
    ['Sales / Purchase Analysis', '/finance/analysis/sales-party', 'By party and by item'],
    ['Cost Centres', '/finance/cost-centres', 'Income and expense per project / site'],
    ['Budgets', '/finance/budgets', 'Budget vs actual'],
    ['Forex revaluation', '/finance/fx/revaluation', 'Open foreign-currency bills at the closing rate'],
  ]],
  ['GST', 'Returns and credit', [
    ['GSTR-1', '/finance/gst/gstr1', 'B2B, B2C, credit notes, HSN, documents + portal JSON'],
    ['GSTR-3B', '/finance/gst/gstr3b', 'Liability, ITC and cash payable'],
    ['HSN Summary', '/finance/gst/hsn', ''],
    ['ITC Register', '/finance/gst/itc', 'Eligible, blocked and RCM credit'],
    ['GSTR-2B Reconciliation', '/finance/gst/recon', 'Match supplier filings to your purchases'],
    ['E-Invoice & E-Way Bill', '/finance/einvoice', 'Portal bulk-upload JSON; record IRN and e-way bill numbers'],
    ['HSN / SAC master', '/finance/hsn', ''],
  ]],
  ['TDS', 'Tax deducted at source', [
    ['Payroll — post to books', '/finance/payroll/post', 'Salary slips from HR → salary, PF and ESIC liabilities'],
    ['PF & ESIC dues', '/finance/payroll/dues', 'Payable vs paid by month, record payments'],
    ['TDS Dashboard', '/finance/tds/dashboard', 'Deducted vs deposited, due dates, interest estimate'],
    ['Deduction Register', '/finance/tds/register', 'By voucher and by deductee'],
    ['Challans', '/finance/tds/challans', 'Record deposits (and the bank payment)'],
    ['Quarterly Statements', '/finance/tds/returns', 'Deductee & challan data for the return'],
    ['Deductee Statements', '/finance/tds/certificates', 'Printable per-vendor summary'],
    ['TDS Receivable', '/finance/tds/receivable', 'Tax customers deducted from you'],
    ['Sections & Rates', '/finance/tds/sections', 'Edit rates and thresholds'],
  ]],
  ['Inventory', 'Stock in and out', [
    ['Stock Items', '/finance/stock-items', 'HSN, rates, valuation, opening stock'],
    ['Stock Summary', '/finance/stock/summary', 'Quantity and value per item / godown'],
    ['Item Ledger (In / Out)', '/finance/stock/ledger', 'Every inward and outward movement with running balance'],
    ['Movement Analysis', '/finance/stock/movement', 'Opening, in, out, closing for a period'],
    ['Godown-wise Stock', '/finance/stock/godown', ''],
    ['Reorder Status', '/finance/stock/reorder', ''],
    ['Pending Purchase Orders', '/finance/stock/orders', 'Create bill from an order'],
  ]],
  ['Controls', 'Banking, audit, export', [
    ['Bank & Cash Accounts', '/finance/banking', 'Master and opening balances'],
    ['Bank Reconciliation', '/finance/bank-recon', 'Import statement, match, reconcile'],
    ['Audit Trail & Period Lock', '/finance/audit', 'Who changed what; lock closed periods'],
    ['Export & Backup', '/finance/export', 'Excel and Tally XML'],
    ['Chart of Accounts', '/finance/accounts', ''],
    ['Exchange rates', '/finance/fx/rates', 'Rates for USD, EUR and other currencies'],
    ['Company Settings', '/finance/settings', 'GSTIN, TAN, state, lock date'],
  ]],
]

// Zoho-style categories over the Tally-style groups above
const RENAME = { Vouchers: 'Transactions', Books: 'Accountant', Outstanding: 'Receivables & Payables', Statements: 'Business Overview', GST: 'Taxes', TDS: 'Taxes', Controls: 'Banking & Controls' }
export const CATALOG = GROUPS.flatMap(([group, sub, items]) => items.map(([label, path, desc]) => ({ label, path, desc, category: RENAME[group] || group })))
export const CATEGORIES = [...new Set(CATALOG.map(r => r.category))]

const FAV = 'finance.reports.fav', VISIT = 'finance.reports.visited'
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }
export const getFavourites = () => read(FAV, [])
export const toggleFavourite = (path) => { const f = getFavourites(); const n = f.includes(path) ? f.filter(x => x !== path) : [...f, path]; write(FAV, n); return n }
export const getVisits = () => read(VISIT, {})
export const recordVisit = (path) => { if (!CATALOG.some(r => r.path === path)) return; const v = getVisits(); v[path] = new Date().toISOString(); write(VISIT, v) }
