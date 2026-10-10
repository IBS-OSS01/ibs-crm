// Gateway-style index of every report and function in Finance.
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { cardCls } from '../components/FinanceUI.jsx'

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
    ['Company Settings', '/finance/settings', 'GSTIN, TAN, state, lock date'],
  ]],
]

export default function ReportsHub() {
  const navigate = useNavigate()
  return (
    <div className="p-6 space-y-6">
      <div><h2 className="text-2xl font-bold text-slate-900 tracking-tight">All Reports &amp; Functions</h2><p className="text-slate-500 text-sm">Everything in Finance, grouped the way Tally's Gateway groups it. Shortcuts work on any voucher screen: F4 Contra · F5 Payment · F6 Receipt · F9 Purchase · Ctrl+F5 Purchase Order · Ctrl+F7 Stock Journal · Ctrl+F8 Credit Note · Ctrl+F9 Debit Note · Esc closes a form.</p></div>
      {GROUPS.map(([title, sub, items]) => (
        <div key={title}>
          <h3 className="font-semibold text-slate-800">{title} <span className="text-sm font-normal text-slate-400">— {sub}</span></h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
            {items.map(([label, path, desc]) => (
              <button key={path + label} onClick={() => navigate(path)} className={`${cardCls} p-3 text-left hover:border-blue-300 hover:shadow transition`}>
                <p className="font-medium text-slate-800 text-sm">{label}</p>{desc && <p className="text-xs text-slate-400 mt-0.5">{desc}</p>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
