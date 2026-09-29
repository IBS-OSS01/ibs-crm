import React, { useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import ServicesDashboard from './pages/ServicesDashboard.jsx'
import StockLevels from './pages/StockLevels.jsx'
import ConsumptionRequests from './pages/ConsumptionRequests.jsx'
import NewConsumptionRequest from './pages/NewConsumptionRequest.jsx'
import SpareRequests from './pages/SpareRequests.jsx'
import NewSpareRequest from './pages/NewSpareRequest.jsx'
import ReorderConsolidation from './pages/ReorderConsolidation.jsx'
import StockTransfer from './pages/StockTransfer.jsx'
import ReceiveStock from './pages/ReceiveStock.jsx'
import ItemsCatalog from './pages/ItemsCatalog.jsx'
import Locations from './pages/Locations.jsx'
import StockAdjustment from './pages/StockAdjustment.jsx'
import ServiceSites from './pages/ServiceSites.jsx'
import ModuleMyTasks from '../../components/tasks/ModuleMyTasks.jsx'
import ModuleTaskTracker from '../../components/tasks/ModuleTaskTracker.jsx'

const MANAGER_ROLES = ['admin', 'sales_manager', 'sales_director', 'project_manager', 'service_manager', 'solution_manager']

// Finance-style grouped vertical navigation. Every existing page keeps its
// exact same route path (nothing elsewhere in the app links to a moved
// path), just regrouped under fewer, O&M-oriented sections instead of one
// flat sidebar list.
const NAV_GROUPS = [
  { label: 'Dashboard', items: [
    { label: 'Dashboard', icon: '📊', path: '/services', exact: true },
  ]},
  { label: 'Inventory', items: [
    { label: 'Stock Levels',     icon: '📦', path: '/services/stock-levels' },
    { label: 'Items Catalog',    icon: '🗂️', path: '/services/items' },
    { label: 'Warehouses',       icon: '🏭', path: '/services/locations' },
    { label: 'Stock Adjustment', icon: '⚖️', path: '/services/adjustment' },
    { label: 'Stock Transfer',   icon: '🔀', path: '/services/transfer' },
    { label: 'Receive Stock',    icon: '📥', path: '/services/receive' },
    { label: 'Reorder',          icon: '📋', path: '/services/reorder' },
    { label: 'Consumption',      icon: '🔄', path: '/services/consumption' },
  ]},
  { label: 'Service Requests', items: [
    { label: 'Requests (Tickets)', icon: '🎫', path: '/services/spare' },
  ]},
  { label: 'Service Sites', items: [
    { label: 'Sites', icon: '📍', path: '/services/sites' },
  ]},
  { label: 'Tasks', items: [
    { label: 'My Tasks',     icon: '✅', path: '/services/my-tasks' },
    { label: 'Task Tracker', icon: '📊', path: '/services/task-tracker', roles: MANAGER_ROLES },
  ]},
]

export default function ServicesApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userProfile } = useAuth()
  const userRole = userProfile?.role || ''
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const filteredGroups = NAV_GROUPS.map(g => ({
    ...g,
    items: g.items.filter(it => !it.roles || it.roles.includes(userRole)),
  })).filter(g => g.items.length > 0)

  const isActive = (item) =>
    item.exact ? (location.pathname === item.path || location.pathname === item.path + '/') : location.pathname.startsWith(item.path)

  const currentLabel = filteredGroups.flatMap(g => g.items).find(isActive)?.label || 'Services'

  const go = (path) => { navigate(path); setMobileNavOpen(false) }

  const navItemCls = (item) =>
    `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition ${
      isActive(item) ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
    }`

  const navBody = (
    <>
      {filteredGroups.map(g => (
        <div key={g.label} className="mb-4">
          <p className="px-3 mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">{g.label}</p>
          <div className="space-y-0.5">
            {g.items.map(it => (
              <button key={it.path} onClick={() => go(it.path)} className={navItemCls(it)}>
                <span>{it.icon}</span>{it.label}
              </button>
            ))}
          </div>
        </div>
      ))}
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
          <Route path="/"            element={<ServicesDashboard />} />
          <Route path="/stock-levels" element={<StockLevels />} />
          <Route path="/consumption" element={<ConsumptionRequests />} />
          <Route path="/consumption/new" element={<NewConsumptionRequest />} />
          <Route path="/spare"       element={<SpareRequests />} />
          <Route path="/spare/new"   element={<NewSpareRequest />} />
          <Route path="/reorder"     element={<ReorderConsolidation />} />
          <Route path="/transfer"    element={<StockTransfer />} />
          <Route path="/receive"     element={<ReceiveStock />} />
          <Route path="/sites"       element={<ServiceSites />} />
          <Route path="/items"        element={<ItemsCatalog />} />
          <Route path="/locations"    element={<Locations />} />
          <Route path="/adjustment"   element={<StockAdjustment />} />
          <Route path="/my-tasks"     element={<ModuleMyTasks />} />
          <Route path="/task-tracker" element={<ModuleTaskTracker />} />
        </Routes>
      </main>
    </div>
  )
}
