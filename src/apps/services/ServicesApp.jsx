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

const NAV = [
  { section: 'OVERVIEW', items: [
    { name: 'Dashboard',   path: '/services',            icon: '📊', exact: true },
    { name: 'Stock',       path: '/services/stock-levels', icon: '📦' },
  ]},
  { section: 'SERVICE SITES', items: [
    { name: 'Sites',       path: '/services/sites',      icon: '📍' },
  ]},
  { section: 'WORKFLOWS', items: [
    { name: 'Consumption', path: '/services/consumption', icon: '🔄' },
    { name: 'Spare Req.',  path: '/services/spare',       icon: '🔩' },
    { name: 'Reorder',     path: '/services/reorder',     icon: '📋' },
    { name: 'Transfer',    path: '/services/transfer',    icon: '🔀' },
    { name: 'Receive',     path: '/services/receive',     icon: '📥' },
  ]},
  { section: 'CATALOG', items: [
    { name: 'Items',       path: '/services/items',       icon: '🗂️' },
  ]},
  { section: 'ADMIN', items: [
    { name: 'Warehouses',  path: '/services/locations',   icon: '🏭' },
    { name: 'Adjustment',  path: '/services/adjustment',  icon: '⚖️' },
  ]},
  { section: 'TASKS', items: [
    { name: 'My Tasks',     path: '/services/my-tasks',      icon: '✅' },
    { name: 'Task Tracker', path: '/services/task-tracker',  icon: '📊', roles: ['admin','sales_manager','sales_director','project_manager','service_manager','solution_manager'] },
  ]},
]

// Flat list for mobile tab bar
const ALL_NAV = NAV.flatMap(g => g.items)

export default function ServicesApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userProfile } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const isAdmin = ['admin', 'service_manager', 'project_manager'].includes(userProfile?.role)
  const userRole = userProfile?.role || ''
  const filteredNav = NAV.map(g => ({
    ...g,
    items: g.items.filter(i => !i.roles || i.roles.includes(userRole))
  })).filter(g => g.items.length > 0)
  const ALL_NAV_FILTERED = filteredNav.flatMap(g => g.items)

  const isActive = (path, exact) => exact
    ? location.pathname === path
    : location.pathname.startsWith(path) && path !== '/services'
      || (path === '/services' && location.pathname === '/services')

  return (
    <div className="flex flex-col sm:flex-row h-full">

      {/* ── Mobile: horizontal scroll tab bar ── */}
      <div className="flex sm:hidden bg-shell overflow-x-auto flex-shrink-0 border-b border-white/10">
        {ALL_NAV_FILTERED.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`flex flex-col items-center flex-shrink-0 px-3 py-2 text-center transition min-w-[58px]
              ${isActive(item.path, item.exact)
                ? 'border-b-2 border-blue-400 text-blue-300 bg-white/5'
                : 'text-slate-400 active:bg-white/10'}`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="text-[10px] mt-0.5 leading-tight whitespace-nowrap">{item.name}</span>
          </button>
        ))}
      </div>

      {/* ── Desktop: left sidebar ── */}
      <div className={`hidden sm:flex flex-col flex-shrink-0 bg-shell text-white transition-all duration-200 ${sidebarOpen ? 'w-56' : 'w-12'}`}>
        <div className="p-3 border-b border-white/10 flex items-center justify-between">
          {sidebarOpen && (
            <div>
              <p className="text-xs font-bold text-indigo-300">StockFlow</p>
              <p className="text-xs text-slate-400">by Udishtha</p>
            </div>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-slate-400 hover:text-white text-xs p-1">
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {filteredNav.map((group) => (
            <div key={group.section} className="mb-2">
              {sidebarOpen && (
                <p className="px-3 py-1 text-xs text-slate-500 font-semibold tracking-wider">
                  {group.section}
                </p>
              )}
              {group.items.map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition
                    ${isActive(item.path, item.exact)
                      ? 'bg-brand-gradient text-white shadow-sm'
                      : 'text-slate-300 hover:bg-white/10'}
                    ${!sidebarOpen ? 'justify-center' : ''}`}
                  title={item.name}
                >
                  <span className="text-base flex-shrink-0">{item.icon}</span>
                  {sidebarOpen && <span className="truncate">{item.name}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {sidebarOpen && (
          <div className="p-3 border-t border-white/10">
            <p className="text-xs text-white font-medium truncate">{userProfile?.name || 'User'}</p>
            <p className="text-xs text-slate-400">All locations</p>
            <p className="text-xs text-indigo-300 font-bold uppercase mt-1">{userProfile?.role}</p>
          </div>
        )}
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-auto bg-slate-50">
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
      </div>
    </div>
  )
}
