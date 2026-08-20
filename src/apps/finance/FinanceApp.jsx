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
import ModuleMyTasks from '../../components/tasks/ModuleMyTasks.jsx'
import ModuleTaskTracker from '../../components/tasks/ModuleTaskTracker.jsx'

const MANAGER_ROLES = ['admin','sales_manager','sales_director','project_manager','service_manager','solution_manager']

// Zoho Books-style grouped navigation. Every existing page keeps its exact
// same route path (nothing elsewhere in the app links to a moved path),
// just regrouped under sections instead of one long horizontal tab strip.
const NAV_GROUPS = [
  { label: 'Dashboard', items: [
    { label: 'Dashboard', icon: '📊', path: '/finance' },
  ]},
  { label: 'Sales', items: [
    { label: 'Invoices',     icon: '🧾', path: '/finance/invoices' },
    { label: 'Payments In',  icon: '💳', path: '/finance/payments' },
  ]},
  { label: 'Purchases', items: [
    { label: 'Vendors',   icon: '🏪', path: '/finance/vendors' },
    { label: 'Expenses',  icon: '📤', path: '/finance/expenses' },
    { label: 'Payables',  icon: '🧾', path: '/finance/payables' },
  ]},
  { label: 'Accounting', items: [
    { label: 'Chart of Accounts', icon: '📚', path: '/finance/accounts' },
    { label: 'Journal Entries',   icon: '📝', path: '/finance/journal' },
  ]},
  { label: 'Banking', items: [
    { label: 'Bank & Cash Accounts', icon: '🏦', path: '/finance/banking' },
  ]},
  { label: 'Filing & Compliance', items: [
    { label: 'HSN / SAC Codes', icon: '📋', path: '/finance/hsn' },
    { label: 'GST Filing',      icon: '🧮', path: '/finance/gst-filing' },
  ]},
  { label: 'Reports', items: [
    { label: 'P&L Report',      icon: '📈', path: '/finance/pl' },
    { label: 'Receivables',     icon: '📥', path: '/finance/receivables' },
    { label: 'Trial Balance',   icon: '⚖️', path: '/finance/trial-balance' },
    { label: 'General Ledger',  icon: '📖', path: '/finance/gl' },
    { label: 'Balance Sheet',   icon: '🏛️', path: '/finance/balance-sheet' },
    { label: 'Project Costs',   icon: '📋', path: '/finance/projectcosts' },
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
          <Route path="/my-tasks"     element={<ModuleMyTasks />} />
          <Route path="/task-tracker" element={<ModuleTaskTracker />} />
        </Routes>
      </main>
    </div>
  )
}
