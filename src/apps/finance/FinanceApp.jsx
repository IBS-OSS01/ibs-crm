import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import FinanceDashboard from './pages/FinanceDashboard.jsx'
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
import { invalidateFinanceCache } from './hooks/useFinanceData.js'
import { NAV_GROUPS } from './navConfig.js'
import { CommandPalette, QuickAddSheet } from './components/NavOverlays.jsx'
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
import EInvoice from './pages/EInvoice.jsx'
import FxRates from './pages/FxRates.jsx'
import Payroll from './pages/Payroll.jsx'
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

const OPEN_KEY = 'finance.nav.open'
const loadOpen = () => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || 'null') } catch { return null } }

export default function FinanceApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const isManager = MANAGER_ROLES.includes(userProfile?.role || '')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  // Some pages write straight to Firestore without telling the shared report cache. When you leave
  // one of them, drop the cache so the next report reads the new data.
  const prevPath = useRef(location.pathname)
  // layout effect: must run before the new page's own data-loading effect, or it would read the stale cache first
  useLayoutEffect(() => {
    if (/^\/finance\/(invoices|journal|vendors|banking|settings|hsn|accounts|projectcosts)/.test(prevPath.current)) invalidateFinanceCache()
    prevPath.current = location.pathname
  }, [location.pathname])

  const isActive = (path) => {
    const base = path.split('?')[0]
    return base === '/finance' ? (location.pathname === '/finance' || location.pathname === '/finance/') : location.pathname.startsWith(base)
  }
  const activeGroup = NAV_GROUPS.find(g => g.items.some(it => isActive(it.path)))?.id || 'home'
  const currentLabel = NAV_GROUPS.flatMap(g => g.items).find(it => isActive(it.path))?.label || 'Finance'

  // Sidebar groups: collapsed by default except the one you are in (remembered per browser).
  const [openGroups, setOpenGroups] = useState(() => loadOpen() || ['home', 'sell', 'buy'])
  const toggleGroup = (id) => setOpenGroups(o => {
    const n = o.includes(id) ? o.filter(x => x !== id) : [...o, id]
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)) } catch { /* private mode */ }
    return n
  })
  const isOpen = (id) => openGroups.includes(id) || id === activeGroup

  const go = (path) => { navigate(path); setMobileNavOpen(false) }

  // Ctrl/Cmd+K opens search from anywhere in Finance (typing "/" does too, unless you are in a field).
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      const inField = /INPUT|TEXTAREA|SELECT/.test(el?.tagName || '') || el?.isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o) }
      else if (e.key === '/' && !inField && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setPaletteOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navItemCls = (path) =>
    `w-full flex items-center gap-2.5 pl-4 pr-3 py-1.5 rounded-lg text-[13px] text-left transition ${
      isActive(path) ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'
    }`

  const navBody = (
    <>
      <div className="px-1 pb-3 space-y-2">
        <button onClick={() => { setAddOpen(true); setMobileNavOpen(false) }} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm transition">
          <span className="text-lg leading-none">＋</span> New
        </button>
        <button onClick={() => { setPaletteOpen(true); setMobileNavOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-400 text-sm hover:border-slate-300 transition">
          <span>🔍</span><span className="flex-1 text-left">Search…</span><kbd className="text-[10px] border border-slate-200 rounded px-1">Ctrl K</kbd>
        </button>
      </div>
      {NAV_GROUPS.map(g => {
        const open = isOpen(g.id)
        return (
          <div key={g.id} className="mb-0.5">
            <button onClick={() => toggleGroup(g.id)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition ${g.id === activeGroup ? 'text-blue-700' : 'text-slate-700 hover:bg-slate-100'}`}>
              <span className="w-5 text-center">{g.icon}</span><span className="flex-1 text-left">{g.label}</span>
              <span className={`text-slate-300 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
            </button>
            {open && (
              <div className="space-y-0.5 mt-0.5 mb-2 ml-3 border-l border-slate-100">
                {g.items.map(it => (
                  <button key={it.path} onClick={() => go(it.path)} className={navItemCls(it.path)}><span className="w-4 text-center text-xs">{it.icon}</span>{it.label}</button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <div className="pt-3 mt-2 border-t border-slate-200 space-y-0.5">
        <button onClick={() => go('/finance/my-tasks')} className={navItemCls('/finance/my-tasks')}><span>✅</span>My tasks</button>
        {isManager && <button onClick={() => go('/finance/task-tracker')} className={navItemCls('/finance/task-tracker')}><span>📊</span>Task tracker</button>}
      </div>
    </>
  )

  return (
    <div className="h-full flex overflow-hidden">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center gap-2 bg-white/95 backdrop-blur border-b border-slate-200 px-3 py-2">
        <button onClick={() => setMobileNavOpen(o => !o)} className="p-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm" aria-label="Menu">☰</button>
        <span className="text-sm font-semibold text-slate-700 flex-1 truncate">{currentLabel}</span>
        <button onClick={() => setPaletteOpen(true)} className="p-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm" aria-label="Search">🔍</button>
      </div>

      {/* Sidebar */}
      <aside className={`
        ${mobileNavOpen ? 'flex' : 'hidden'} md:flex
        fixed md:relative inset-0 md:inset-auto z-20 md:z-auto
        w-full md:w-64 flex-shrink-0 flex-col
        bg-white border-r border-slate-200
        pt-14 md:pt-3 px-2 pb-20 md:pb-3 overflow-y-auto
      `}>
        {navBody}
      </aside>

      {mobileNavOpen && <div className="md:hidden fixed inset-0 z-10 bg-black/20" onClick={() => setMobileNavOpen(false)} />}

      {/* Mobile bottom bar: the things people do on a phone, with + in the middle */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 grid grid-cols-5 items-end px-1 pb-[env(safe-area-inset-bottom)]">
        {[['Home', '🏠', '/finance'], ['Sell', '🧾', '/finance/invoices']].map(([l, i, p]) => (
          <button key={l} onClick={() => go(p)} className={`flex flex-col items-center py-2 text-[11px] ${isActive(p) ? 'text-blue-600 font-semibold' : 'text-slate-500'}`}><span className="text-lg leading-none">{i}</span>{l}</button>
        ))}
        <button onClick={() => setAddOpen(true)} className="mb-2 mx-auto w-12 h-12 rounded-full bg-blue-600 text-white text-2xl shadow-lg flex items-center justify-center active:scale-95 transition" aria-label="New">＋</button>
        {[['Buy', '🛒', '/finance/vouchers/purchase'], ['Reports', '📈', '/finance/reports']].map(([l, i, p]) => (
          <button key={l} onClick={() => go(p)} className={`flex flex-col items-center py-2 text-[11px] ${isActive(p) ? 'text-blue-600 font-semibold' : 'text-slate-500'}`}><span className="text-lg leading-none">{i}</span>{l}</button>
        ))}
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onGo={go} />
      <QuickAddSheet open={addOpen} onClose={() => setAddOpen(false)} onGo={go} />

      <main className="flex-1 overflow-auto pt-12 pb-16 md:pt-0 md:pb-0">
        <Routes>
          <Route path="/"             element={<FinanceDashboard />} />
          <Route path="/invoices"     element={<Invoices />} />
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
          <Route path="/payroll/:tab"   element={<Payroll />} />
          <Route path="/fx/:tab"        element={<FxRates />} />
          <Route path="/einvoice"        element={<EInvoice />} />
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
