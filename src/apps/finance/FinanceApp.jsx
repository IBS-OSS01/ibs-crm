import React, { useState } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import FinanceDashboard from './pages/FinanceDashboard.jsx'
import Receivables from './pages/Receivables.jsx'
import Payments from './pages/Payments.jsx'
import Expenses from './pages/Expenses.jsx'
import Payables from './pages/Payables.jsx'
import PLReport from './pages/PLReport.jsx'
import ProjectCosts from './pages/ProjectCosts.jsx'
import CompanySettings from './pages/CompanySettings.jsx'
import Vendors from './pages/Vendors.jsx'
import HsnCodes from './pages/HsnCodes.jsx'
import Invoices from './pages/Invoices.jsx'
import ChartOfAccounts from './pages/ChartOfAccounts.jsx'
import JournalEntries from './pages/JournalEntries.jsx'
import TrialBalance from './pages/TrialBalance.jsx'
import GeneralLedger from './pages/GeneralLedger.jsx'
import BalanceSheet from './pages/BalanceSheet.jsx'
import BankAccounts from './pages/BankAccounts.jsx'
import GstFiling from './pages/GstFiling.jsx'
import Vouchers from './pages/Vouchers.jsx'
import Parties from './pages/Parties.jsx'
import GstReturns from './pages/GstReturns.jsx'
import StockItems from './pages/StockItems.jsx'
import TdsCompliance from './pages/TdsCompliance.jsx'
import Statements from './pages/Statements.jsx'
import CostCentres from './pages/CostCentres.jsx'
import Budgets from './pages/Budgets.jsx'
import BankRecon from './pages/BankRecon.jsx'
import AuditTrail from './pages/AuditTrail.jsx'
import DataExport from './pages/DataExport.jsx'
import Analysis from './pages/Analysis.jsx'
import ReportsHub from './pages/ReportsHub.jsx'
import StockReports from './pages/StockReports.jsx'
import DayBook from './pages/DayBook.jsx'
import LedgerStatement from './pages/LedgerStatement.jsx'
import Outstanding from './pages/Outstanding.jsx'
import CashBankBook from './pages/CashBankBook.jsx'
import Registers from './pages/Registers.jsx'
import ModuleMyTasks from '../../components/tasks/ModuleMyTasks.jsx'
import ModuleTaskTracker from '../../components/tasks/ModuleTaskTracker.jsx'

const MANAGER_ROLES = ['admin','sales_manager','sales_director','project_manager','service_manager','solution_manager']

// Zoho Books-style grouped navigation. Every existing page keeps its exact
// same route path (nothing elsewhere in the app links to a moved path),
// just regrouped under sections instead of one long horizontal tab strip.
const NAV_GROUPS = [
  { label: 'Dashboard', items: [
    { label: 'Dashboard', icon: '📊', path: '/finance' },
    { label: 'All Reports & Functions', icon: '🗂️', path: '/finance/reports' },
  ]},
  { label: 'Vouchers', items: [
    { label: 'Sales Invoices', icon: '🧾', path: '/finance/invoices' },
    { label: 'Purchase',       icon: '🛒', path: '/finance/vouchers/purchase' },
    { label: 'Receipt',        icon: '💰', path: '/finance/vouchers/receipt' },
    { label: 'Payment',        icon: '💸', path: '/finance/vouchers/payment' },
    { label: 'Contra',         icon: '🔁', path: '/finance/vouchers/contra' },
    { label: 'Credit Note',    icon: '↩️', path: '/finance/vouchers/credit_note' },
    { label: 'Debit Note',     icon: '↪️', path: '/finance/vouchers/debit_note' },
    { label: 'Purchase Order', icon: '📑', path: '/finance/vouchers/purchase_order' },
    { label: 'Stock Journal',  icon: '🔀', path: '/finance/vouchers/stock_journal' },
    { label: 'Journal Entries', icon: '📝', path: '/finance/journal' },
  ]},
  { label: 'Masters', items: [
    { label: 'Party Ledgers',     icon: '👥', path: '/finance/parties' },
    { label: 'Vendors',           icon: '🏪', path: '/finance/vendors' },
    { label: 'Chart of Accounts', icon: '📚', path: '/finance/accounts' },
    { label: 'Bank & Cash',       icon: '🏦', path: '/finance/banking' },
    { label: 'HSN / SAC Codes',   icon: '📋', path: '/finance/hsn' },
  ]},
  { label: 'Books', items: [
    { label: 'Day Book',         icon: '📒', path: '/finance/daybook' },
    { label: 'Ledger Statement', icon: '📖', path: '/finance/ledger' },
    { label: 'Cash / Bank Book', icon: '🏧', path: '/finance/cashbank' },
    { label: 'General Ledger',   icon: '📘', path: '/finance/gl' },
    { label: 'Sales Register',   icon: '📈', path: '/finance/registers/sales' },
    { label: 'Purchase Register', icon: '📉', path: '/finance/registers/purchase' },
    { label: 'Credit Note Reg.', icon: '🗂️', path: '/finance/registers/credit_note' },
    { label: 'Debit Note Reg.',  icon: '🗃️', path: '/finance/registers/debit_note' },
    { label: 'Other Registers',  icon: '🗄️', path: '/finance/registers/receipt' },
  ]},
  { label: 'Inventory', items: [
    { label: 'Stock Items',       icon: '📦', path: '/finance/stock-items' },
    { label: 'Stock Summary',     icon: '🧮', path: '/finance/stock/summary' },
    { label: 'Item Ledger (In/Out)', icon: '↕️', path: '/finance/stock/ledger' },
    { label: 'Movement Analysis', icon: '📊', path: '/finance/stock/movement' },
    { label: 'Godown-wise',       icon: '🏭', path: '/finance/stock/godown' },
    { label: 'Reorder Status',    icon: '⚠️', path: '/finance/stock/reorder' },
    { label: 'Pending POs',       icon: '⏳', path: '/finance/stock/orders' },
  ]},
  { label: 'Outstanding', items: [
    { label: 'Receivables (Bill-wise)', icon: '📥', path: '/finance/outstanding/receivables' },
    { label: 'Payables (Bill-wise)',    icon: '📤', path: '/finance/outstanding/payables' },
  ]},
  { label: 'GST', items: [
    { label: 'GSTR-1',            icon: '📤', path: '/finance/gst/gstr1' },
    { label: 'GSTR-3B',           icon: '🧮', path: '/finance/gst/gstr3b' },
    { label: 'HSN Summary',       icon: '🔢', path: '/finance/gst/hsn' },
    { label: 'ITC Register',      icon: '🧾', path: '/finance/gst/itc' },
    { label: 'GSTR-2B Recon',     icon: '🔍', path: '/finance/gst/recon' },
    { label: 'GST Ledger Summary', icon: '📑', path: '/finance/gst-filing' },
  ]},
  { label: 'TDS', items: [
    { label: 'TDS Dashboard',     icon: '🏛️', path: '/finance/tds/dashboard' },
    { label: 'TDS Register',      icon: '📒', path: '/finance/tds/register' },
    { label: 'TDS Challans',      icon: '🧾', path: '/finance/tds/challans' },
    { label: 'TDS Statements',    icon: '📤', path: '/finance/tds/returns' },
    { label: 'Deductee Statements', icon: '📄', path: '/finance/tds/certificates' },
    { label: 'TDS Receivable',    icon: '📥', path: '/finance/tds/receivable' },
    { label: 'TDS Sections & Rates', icon: '⚙️', path: '/finance/tds/sections' },
  ]},
  { label: 'Statements', items: [
    { label: 'Trial Balance', icon: '⚖️', path: '/finance/trial-balance' },
    { label: 'Trading & P&L', icon: '📈', path: '/finance/statements/trading' },
    { label: 'Balance Sheet', icon: '🏛️', path: '/finance/balance-sheet' },
    { label: 'Cash Flow',     icon: '💧', path: '/finance/statements/cashflow' },
    { label: 'Ratio Analysis', icon: '🧪', path: '/finance/statements/ratios' },
    { label: 'Sales by Party / Item', icon: '🧮', path: '/finance/analysis/sales-party' },
    { label: 'Purchases by Party / Item', icon: '🛍️', path: '/finance/analysis/purchase-party' },
    { label: 'Cost Centres',  icon: '🎯', path: '/finance/cost-centres' },
    { label: 'Budgets',       icon: '📐', path: '/finance/budgets' },
    { label: 'Project Costs', icon: '📋', path: '/finance/projectcosts' },
    { label: 'P&L (older)',   icon: '📉', path: '/finance/pl' },
  ]},
  { label: 'Controls', items: [
    { label: 'Bank Reconciliation', icon: '🏦', path: '/finance/bank-recon' },
    { label: 'Audit Trail & Lock',  icon: '🔒', path: '/finance/audit' },
    { label: 'Export & Backup',     icon: '📤', path: '/finance/export' },
  ]},
  { label: 'Older pages', items: [
    { label: 'Payments In (old)', icon: '💳', path: '/finance/payments' },
    { label: 'Expenses (old)',    icon: '📤', path: '/finance/expenses' },
    { label: 'Payables (old)',    icon: '🧾', path: '/finance/payables' },
    { label: 'Receivables (old)', icon: '📥', path: '/finance/receivables' },
  ]},
]

export default function FinanceApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const isManager = MANAGER_ROLES.includes(userProfile?.role || '')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const isActive = (path) =>
    path === '/finance' ? (location.pathname === '/finance' || location.pathname === '/finance/') : location.pathname.startsWith(path)

  const currentLabel = NAV_GROUPS.flatMap(g => g.items).find(it => isActive(it.path))?.label || 'Finance'

  const go = (path) => { navigate(path); setMobileNavOpen(false) }

  const navItemCls = (path) =>
    `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition ${
      isActive(path) ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
    }`

  const navBody = (
    <>
      {NAV_GROUPS.map(g => (
        <div key={g.label} className="mb-4">
          <p className="px-3 mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">{g.label}</p>
          <div className="space-y-0.5">
            {g.items.map(it => (
              <button key={it.path} onClick={() => go(it.path)} className={navItemCls(it.path)}>
                <span>{it.icon}</span>{it.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="pt-3 mt-2 border-t border-slate-200 space-y-0.5">
        <button onClick={() => go('/finance/settings')} className={navItemCls('/finance/settings')}>
          <span>⚙️</span>Company Settings
        </button>
        <button onClick={() => go('/finance/my-tasks')} className={navItemCls('/finance/my-tasks')}>
          <span>✅</span>My Tasks
        </button>
        {isManager && (
          <button onClick={() => go('/finance/task-tracker')} className={navItemCls('/finance/task-tracker')}>
            <span>📊</span>Task Tracker
          </button>
        )}
      </div>
    </>
  )

  return (
    <div className="h-full flex overflow-hidden">
      {/* Mobile top bar — toggles the sidebar as a full-screen overlay */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center gap-2 bg-white border-b border-slate-200 px-3 py-2">
        <button onClick={() => setMobileNavOpen(o => !o)}
          className="p-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm">☰</button>
        <span className="text-sm font-semibold text-slate-700">{currentLabel}</span>
      </div>

      {/* Sidebar */}
      <aside className={`
        ${mobileNavOpen ? 'flex' : 'hidden'} md:flex
        fixed md:relative inset-0 md:inset-auto z-20 md:z-auto
        w-full md:w-60 flex-shrink-0 flex-col
        bg-white border-r border-slate-200
        pt-14 md:pt-3 px-2 pb-3 overflow-y-auto
      `}>
        {navBody}
      </aside>

      {/* Backdrop for mobile overlay */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-10 bg-black/20" onClick={() => setMobileNavOpen(false)} />
      )}

      <main className="flex-1 overflow-auto pt-12 md:pt-0">
        <Routes>
          <Route path="/"             element={<FinanceDashboard />} />
          <Route path="/invoices"     element={<Invoices />} />
          <Route path="/receivables"  element={<Receivables />} />
          <Route path="/payments"     element={<Payments />} />
          <Route path="/expenses"     element={<Expenses />} />
          <Route path="/payables"     element={<Payables />} />
          <Route path="/pl"           element={<PLReport />} />
          <Route path="/projectcosts" element={<ProjectCosts />} />
          <Route path="/vendors"      element={<Vendors />} />
          <Route path="/hsn"          element={<HsnCodes />} />
          <Route path="/settings"     element={<CompanySettings />} />
          <Route path="/accounts"       element={<ChartOfAccounts />} />
          <Route path="/journal"        element={<JournalEntries />} />
          <Route path="/trial-balance"  element={<TrialBalance />} />
          <Route path="/gl"             element={<GeneralLedger />} />
          <Route path="/balance-sheet"  element={<BalanceSheet />} />
          <Route path="/banking"        element={<BankAccounts />} />
          <Route path="/gst-filing"     element={<GstFiling />} />
          <Route path="/reports"         element={<ReportsHub />} />
          <Route path="/statements/:tab" element={<Statements />} />
          <Route path="/analysis/:tab"   element={<Analysis />} />
          <Route path="/cost-centres"    element={<CostCentres />} />
          <Route path="/budgets"         element={<Budgets />} />
          <Route path="/bank-recon"      element={<BankRecon />} />
          <Route path="/audit"           element={<AuditTrail />} />
          <Route path="/export"          element={<DataExport />} />
          <Route path="/tds/:tab"        element={<TdsCompliance />} />
          <Route path="/stock-items"     element={<StockItems />} />
          <Route path="/stock/:tab"      element={<StockReports />} />
          <Route path="/gst/:tab"        element={<GstReturns />} />
          <Route path="/vouchers/:type"  element={<Vouchers />} />
          <Route path="/parties"         element={<Parties />} />
          <Route path="/daybook"         element={<DayBook />} />
          <Route path="/ledger"          element={<LedgerStatement />} />
          <Route path="/cashbank"        element={<CashBankBook />} />
          <Route path="/outstanding/:kind" element={<Outstanding />} />
          <Route path="/registers/:type" element={<Registers />} />
          <Route path="/my-tasks"     element={<ModuleMyTasks />} />
          <Route path="/task-tracker" element={<ModuleTaskTracker />} />
        </Routes>
      </main>
    </div>
  )
}
