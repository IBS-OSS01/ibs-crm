import React, { useState } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import HRDashboard from './pages/HRDashboard.jsx'
import Employees from './pages/Employees.jsx'
import EmployeeProfile from './pages/EmployeeProfile.jsx'
import OrgChart from './pages/OrgChart.jsx'
import HolidayCalendar from './pages/HolidayCalendar.jsx'
import AssetManagement from './pages/AssetManagement.jsx'
import Announcements from './pages/Announcements.jsx'
import Attendance from './pages/Attendance.jsx'
import Leaves from './pages/Leaves.jsx'
import Salary from './pages/Salary.jsx'
import SalaryRevision from './pages/SalaryRevision.jsx'
import Advances from './pages/Advances.jsx'
import HRExpenses from './pages/Expenses.jsx'
import ModuleMyTasks from '../../components/tasks/ModuleMyTasks.jsx'
import ModuleTaskTracker from '../../components/tasks/ModuleTaskTracker.jsx'

const MANAGER_ROLES = ['admin', 'sales_manager', 'sales_director', 'project_manager', 'service_manager', 'solution_manager']

// Finance/Services-style grouped vertical navigation. Every existing page
// keeps its exact same route path — just regrouped under sections instead
// of one long horizontal tab strip (which had grown to 14 tabs).
const NAV_GROUPS = [
  { label: 'Dashboard', items: [
    { label: 'Dashboard', icon: '📊', path: '/hr', exact: true },
  ]},
  { label: 'Employees', items: [
    { label: 'Employees', icon: '👤', path: '/hr/employees' },
    { label: 'Org Chart', icon: '🧭', path: '/hr/org-chart' },
  ]},
  { label: 'Workforce', items: [
    { label: 'Holidays',      icon: '🎉', path: '/hr/holidays' },
    { label: 'Attendance',    icon: '📅', path: '/hr/attendance' },
    { label: 'Leaves',        icon: '🏖️', path: '/hr/leaves' },
    { label: 'Assets',        icon: '💻', path: '/hr/assets' },
    { label: 'Announcements', icon: '📢', path: '/hr/announcements' },
  ]},
  { label: 'Payroll', items: [
    { label: 'Salary',          icon: '💵', path: '/hr/salary' },
    { label: 'Salary Revision', icon: '📈', path: '/hr/salary-revision' },
    { label: 'Advances',        icon: '💳', path: '/hr/advances' },
    { label: 'Expenses',        icon: '🧾', path: '/hr/expenses' },
  ]},
  { label: 'Tasks', items: [
    { label: 'My Tasks',     icon: '✅', path: '/hr/my-tasks' },
    { label: 'Task Tracker', icon: '📊', path: '/hr/task-tracker', roles: MANAGER_ROLES },
  ]},
]

export default function HRApp() {
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

  const currentLabel = filteredGroups.flatMap(g => g.items).find(isActive)?.label || 'HR'

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
          <Route path="/"              element={<HRDashboard />} />
          <Route path="/employees"     element={<Employees />} />
          <Route path="/org-chart"     element={<OrgChart />} />
          <Route path="/holidays"      element={<HolidayCalendar />} />
          <Route path="/assets"        element={<AssetManagement />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/employee/:id"  element={<EmployeeProfile />} />
          <Route path="/attendance"    element={<Attendance />} />
          <Route path="/leaves"        element={<Leaves />} />
          <Route path="/salary"           element={<Salary />} />
          <Route path="/salary-revision"  element={<SalaryRevision />} />
          <Route path="/advances"         element={<Advances />} />
          <Route path="/expenses"         element={<HRExpenses />} />
          <Route path="/my-tasks"         element={<ModuleMyTasks />} />
          <Route path="/task-tracker"     element={<ModuleTaskTracker />} />
        </Routes>
      </main>
    </div>
  )
}
