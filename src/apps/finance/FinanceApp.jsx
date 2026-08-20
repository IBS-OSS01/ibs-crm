import React from 'react'
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
import ModuleMyTasks from '../../components/tasks/ModuleMyTasks.jsx'
import ModuleTaskTracker from '../../components/tasks/ModuleTaskTracker.jsx'

const MANAGER_ROLES = ['admin','sales_manager','sales_director','project_manager','service_manager','solution_manager']

export default function FinanceApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const isManager = MANAGER_ROLES.includes(userProfile?.role || '')

  const TABS = [
    { label: '📊 Dashboard',       path: '/finance',               match: (p) => p === '/finance' || p === '/finance/' },
    { label: '🧾 Invoices',        path: '/finance/invoices',      match: (p) => p.startsWith('/finance/invoices') },
    { label: '📥 Receivables',     path: '/finance/receivables',   match: (p) => p.startsWith('/finance/receivables') },
    { label: '💳 Payments In',     path: '/finance/payments',      match: (p) => p.startsWith('/finance/payments') },
    { label: '📤 Expenses',        path: '/finance/expenses',      match: (p) => p.startsWith('/finance/expenses') },
    { label: '🧾 Payables',        path: '/finance/payables',      match: (p) => p.startsWith('/finance/payables') },
    { label: '📈 P&L Report',      path: '/finance/pl',            match: (p) => p.startsWith('/finance/pl') },
    { label: '📋 Project Costs',   path: '/finance/projectcosts',  match: (p) => p.startsWith('/finance/projectcosts') },
    { label: '🏪 Vendors',         path: '/finance/vendors',       match: (p) => p.startsWith('/finance/vendors') },
    { label: '📋 HSN / SAC',       path: '/finance/hsn',           match: (p) => p.startsWith('/finance/hsn') },
    { label: '📚 Chart of Accounts', path: '/finance/accounts',    match: (p) => p.startsWith('/finance/accounts') },
    { label: '📝 Journal Entries', path: '/finance/journal',       match: (p) => p.startsWith('/finance/journal') },
    { label: '⚖️ Trial Balance',   path: '/finance/trial-balance', match: (p) => p.startsWith('/finance/trial-balance') },
    { label: '📖 General Ledger',  path: '/finance/gl',            match: (p) => p.startsWith('/finance/gl') },
    { label: '🏦 Balance Sheet',   path: '/finance/balance-sheet', match: (p) => p.startsWith('/finance/balance-sheet') },
    { label: '⚙️ Company Settings', path: '/finance/settings',     match: (p) => p.startsWith('/finance/settings') },
    { label: '✅ My Tasks',         path: '/finance/my-tasks',      match: (p) => p.startsWith('/finance/my-tasks') },
    ...(isManager ? [{ label: '📊 Task Tracker', path: '/finance/task-tracker', match: (p) => p.startsWith('/finance/task-tracker') }] : []),
  ]

  return (
    <div className="h-full overflow-auto bg-slate-50 flex flex-col">
      <div className="flex gap-1 px-4 pt-3 bg-white border-b border-slate-200 flex-shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.path} onClick={() => navigate(t.path)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${
              t.match(location.pathname) ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
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
          <Route path="/accounts"       element={<ChartOfAccounts />} />
          <Route path="/journal"        element={<JournalEntries />} />
          <Route path="/trial-balance"  element={<TrialBalance />} />
          <Route path="/gl"             element={<GeneralLedger />} />
          <Route path="/balance-sheet"  element={<BalanceSheet />} />
          <Route path="/settings"     element={<CompanySettings />} />
          <Route path="/my-tasks"     element={<ModuleMyTasks />} />
          <Route path="/task-tracker" element={<ModuleTaskTracker />} />
        </Routes>
      </div>
    </div>
  )
}
