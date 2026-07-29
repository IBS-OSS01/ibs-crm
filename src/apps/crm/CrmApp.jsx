import React, { useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import CRMDashboard from './pages/CRMDashboard.jsx'
import Customers from './pages/Customers.jsx'
import Contacts from './pages/Contacts.jsx'
import Pipeline from './pages/Pipeline.jsx'
import Sites from './pages/Sites.jsx'
import Meetings from './pages/Meetings.jsx'
import Competitors from './pages/Competitors.jsx'
import Targets from './pages/Targets.jsx'
import BiWeeklyReport from './pages/BiWeeklyReport.jsx'
import MyTasks from './pages/MyTasks.jsx'
import TaskTracker from './pages/TaskTracker.jsx'

const NAV = [
  { section: 'OVERVIEW', items: [
    { name: 'Dashboard', path: '/crm', icon: '📊', exact: true },
  ]},
  { section: 'PIPELINE', items: [
    { name: 'Pipeline',    path: '/crm/pipeline',           icon: '📈' },
    { name: 'Meetings',   path: '/crm/meetings',           icon: '🤝' },
    { name: 'Competitors',path: '/crm/competitors',        icon: '⚔️' },
  ]},
  { section: 'SALES', items: [
    { name: 'Customers', path: '/crm/customers', icon: '🏬' },
    { name: 'Contacts',  path: '/crm/contacts',  icon: '👤' },
    { name: 'Sites',     path: '/crm/sites',     icon: '📍' },
    { name: 'Targets',   path: '/crm/targets',   icon: '🎯' },
  ]},
  { section: 'REPORTS', items: [
    { name: 'My Tasks',     path: '/crm/my-tasks',         icon: '✅' },
    { name: 'Task Tracker', path: '/crm/task-tracker',     icon: '📊', roles: ['admin', 'sales_director', 'sales_manager'] },
    { name: 'Bi-Weekly',   path: '/crm/bi-weekly-report', icon: '📋', roles: ['admin', 'sales_director'] },
  ]},
]

// sales_assistant only sees: Dashboard, Pipeline, Meetings, My Tasks
const SA_ALLOWED_PATHS = ['/crm', '/crm/pipeline', '/crm/meetings', '/crm/my-tasks']

const filterNavForRole = (nav, role) => {
  return nav.map(g => ({
    ...g,
    items: g.items.filter(i => {
      // SA restriction
      if (role === 'sales_assistant' && !SA_ALLOWED_PATHS.includes(i.path)) return false
      // Role-restricted items (e.g. Task Tracker)
      if (i.roles && !i.roles.includes(role)) return false
      return true
    }),
  })).filter(g => g.items.length > 0)
}

export default function CRMApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userProfile } = useAuth()
  const role = userProfile?.role || ''
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const visibleNav = filterNavForRole(NAV, role)
  const ALL_NAV_VISIBLE = visibleNav.flatMap(g => g.items)

  const isActive = (path, exact) => exact
    ? location.pathname === path
    : location.pathname.startsWith(path) && path !== '/crm'

  return (
    <div className="flex flex-col sm:flex-row h-full">

      {/* ── Mobile: horizontal scroll tab bar ── */}
      <div className="flex sm:hidden bg-shell overflow-x-auto flex-shrink-0 border-b border-white/10 scrollbar-hide">
        {ALL_NAV_VISIBLE.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`flex flex-col items-center flex-shrink-0 px-3 py-2 text-center transition min-w-[60px]
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
              <p className="text-xs font-bold text-indigo-300">CRM</p>
              <p className="text-xs text-slate-400">Customers & Sales</p>
            </div>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-slate-400 hover:text-white text-xs p-1">
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {visibleNav.map((group) => (
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
            <p className="text-xs text-indigo-300 font-bold uppercase mt-1">{userProfile?.role}</p>
          </div>
        )}
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-auto bg-slate-50">
        <Routes>
          <Route path="/"                  element={<CRMDashboard />} />
          <Route path="/pipeline"          element={<Pipeline />} />
          <Route path="/customers"         element={<Customers />} />
          <Route path="/contacts"          element={<Contacts />} />
          <Route path="/sites"             element={<Sites />} />
          <Route path="/meetings"          element={<Meetings />} />
          <Route path="/competitors"       element={<Competitors />} />
          <Route path="/targets"           element={<Targets />} />
          <Route path="/task-tracker"      element={<TaskTracker />} />
          <Route path="/bi-weekly-report"  element={
            ['admin','sales_director'].includes(role)
              ? <BiWeeklyReport />
              : <div className="p-8 text-center text-slate-500">Access restricted.</div>
          } />
          <Route path="/my-tasks"          element={<MyTasks />} />
        </Routes>
      </div>
    </div>
  )
}
