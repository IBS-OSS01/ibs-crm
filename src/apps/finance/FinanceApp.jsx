import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { clearDataCache, dataCacheInfo } from '../../lib/cachedFirestore'
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
import Expenses from './pages/Expenses.jsx'
import { invalidateFinanceCache } from './hooks/useFinanceData.js'
import { NAV_GROUPS, allNavItems } from './navConfig.js'
import { recordVisit } from './utils/reportsCatalog.js'
import { CommandPalette, QuickAddSheet } from './components/NavOverlays.jsx'
import Parties from './pages/Parties.jsx'
import GstReturns from './pages/GstReturns.jsx'
import StockItems from './pages/StockItems.jsx'
import TdsCompliance from './pages/TdsCompliance.jsx'
import Statements from './pages/Statements.jsx'
import CostCentres from './pages/CostCentres.jsx'
import Budgets from './pages/Budgets.jsx'
import BankRecon from './pages/BankRecon.jsx'
import BankingOverview from './pages/BankingOverview.jsx'
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

const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  items: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  inventory: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  sales: 'M3 4h2l2.4 11h10.2l2-8H6M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z',
  purchases: 'M6 7h12l1 13H5L6 7zM9 7a3 3 0 016 0',
  banking: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18',
  compliance: 'M6 3h9l4 4v14H6V3zM14 3v5h5M9 14l2 2 4-4',
  accountant: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  documents: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
}
const NavIcon = ({ id }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[id] || ICONS.documents} /></svg>
)

const MANAGER_ROLES = ['admin','sales_manager','sales_director','project_manager','service_manager','solution_manager']

const OPEN_KEY = 'finance.nav.open2'
const loadOpen = () => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || 'null') } catch { return null } }

// The app keeps what it has read from Firebase (so pages open instantly and the free daily read quota lasts). Changes made by
// someone else, or from another device, appear after a few hours — or right away when this is pressed.
function RefreshData({ compact }) {
  const [busy, setBusy] = useState(false)
  const t = dataCacheInfo().oldest
  const when = t ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''
  const go = async () => {
    if (!window.confirm('Re-read all the finance data from the server now?\n\nThis uses a few thousand of the free daily Firebase reads. Your own saves already show up without this — use it only to pick up changes made by someone else or from another device.')) return
    setBusy(true); await clearDataCache(); window.location.reload()
  }
  return (
    <button onClick={go} disabled={busy} title={`Data last read from the server at ${when || 'this session'} — click to re-read everything`}
      className={compact ? 'p-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm' : 'h-8 px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs flex items-center gap-1'} aria-label="Refresh data">
      <span className={busy ? 'animate-spin inline-block' : ''}>↻</span>{!compact && <span className="hidden xl:inline">{when ? `Data ${when}` : 'Refresh'}</span>}
    </button>
  )
}

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
    recordVisit(location.pathname)                 // feeds “last visited” in the Reports Center
  }, [location.pathname])

  const here = location.pathname + location.search
  const claimed = allNavItems().find(it => it.path.includes('?') && here.startsWith(it.path))   // e.g. /finance/invoices?tab=orders
  const isActive = (path) => {
    const base = path.split('?')[0]
    if (path.includes('?')) return here.startsWith(path)
    if (claimed && claimed.path.split('?')[0] === base) return false
    return base === '/finance' ? (location.pathname === '/finance' || location.pathname === '/finance/') : location.pathname.startsWith(base)
  }
  const activeGroup = NAV_GROUPS.find(g => g.items.some(it => isActive(it.path)))?.id || 'home'
  const currentLabel = NAV_GROUPS.flatMap(g => g.items).find(it => isActive(it.path))?.label || 'Finance'

  // Sidebar groups: collapsed by default except the one you are in (remembered per browser).
  const [openGroups, setOpenGroups] = useState(() => loadOpen() || ['home', 'sales', 'purchases'])
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
    `w-full flex items-center gap-2.5 pl-10 pr-3 py-1.5 rounded-lg text-[13px] text-left transition ${
      isActive(path) ? 'bg-blue-600 text-white font-semibold' : 'text-slate-300 hover:bg-white/10 hover:text-white'
    }`

  const navBody = (
    <>
      <div className="px-3 pt-1 pb-4 flex items-center gap-2 text-white">
        <span className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold">₹</span>
        <div className="leading-tight"><p className="font-bold text-[15px]">Books</p><p className="text-[10px] text-slate-400 tracking-wide">UDISHTHA · FINANCE</p></div>
      </div>
      {NAV_GROUPS.map(g => {
        const open = isOpen(g.id), single = g.items.length === 1
        const here = g.id === activeGroup
        return (
          <div key={g.id} className="mb-0.5">
            <button onClick={() => single ? go(g.items[0].path) : toggleGroup(g.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] transition ${single && isActive(g.items[0].path) ? 'bg-blue-600 text-white font-semibold' : here ? 'text-white font-semibold' : 'text-slate-200 hover:bg-white/10'}`}>
              <span className={here ? 'text-blue-400' : 'text-slate-400'}><NavIcon id={g.id} /></span><span className="flex-1 text-left">{g.label}</span>
              {!single && <span className={`text-slate-500 text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>}
            </button>
            {open && !single && (
              <div className="space-y-0.5 mt-0.5 mb-1.5">
                {g.items.map(it => (
                  <button key={it.path} onClick={() => go(it.path)} className={navItemCls(it.path)}>{it.label}</button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <div className="pt-3 mt-2 border-t border-white/10 space-y-0.5">
        <button onClick={() => go('/finance/my-tasks')} className={navItemCls('/finance/my-tasks')}>My tasks</button>
        {isManager && <button onClick={() => go('/finance/task-tracker')} className={navItemCls('/finance/task-tracker')}>Task tracker</button>}
      </div>
    </>
  )

  return (
    <div className="h-full flex overflow-hidden">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center gap-2 bg-white/95 backdrop-blur border-b border-slate-200 px-3 py-2">
        <button onClick={() => setMobileNavOpen(o => !o)} className="p-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm" aria-label="Menu">☰</button>
        <span className="text-sm font-semibold text-slate-700 flex-1 truncate">{currentLabel}</span>
        <RefreshData compact />
        <button onClick={() => setPaletteOpen(true)} className="p-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm" aria-label="Search">🔍</button>
      </div>

      {/* Sidebar */}
      <aside className={`
        ${mobileNavOpen ? 'flex' : 'hidden'} md:flex
        fixed md:relative inset-0 md:inset-auto z-20 md:z-auto
        w-full md:w-60 flex-shrink-0 flex-col
        bg-[#1f2a3d] text-white border-r border-slate-800
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
        <div className="hidden md:flex sticky top-0 z-10 items-center gap-3 bg-white/95 backdrop-blur border-b border-slate-200 px-5 py-2">
          <button onClick={() => setPaletteOpen(true)} className="flex items-center gap-2 w-full max-w-md px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200/70 text-slate-500 text-sm transition">
            <span>🔍</span><span className="flex-1 text-left">Search in Finance</span><kbd className="text-[10px] border border-slate-300 rounded px-1">/</kbd>
          </button>
          <span className="ml-auto text-xs text-slate-500 hidden lg:inline">{currentLabel}</span>
          <RefreshData />
          <button onClick={() => setAddOpen(true)} className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xl leading-none flex items-center justify-center shadow-sm" aria-label="New" title="Create new">＋</button>
        </div>
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
          <Route path="/bank-overview"   element={<BankingOverview />} />
          <Route path="/audit"           element={<AuditTrail />} />
          <Route path="/export"          element={<DataExport />} />
          <Route path="/tds/:tab"        element={<TdsCompliance />} />
          <Route path="/stock-items"     element={<StockItems />} />
          <Route path="/stock/:tab"      element={<StockReports />} />
          <Route path="/gst/:tab"        element={<GstReturns />} />
          <Route path="/expenses"        element={<Expenses />} />
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
