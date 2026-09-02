import React from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import HRDashboard from './pages/HRDashboard.jsx'
import Employees from './pages/Employees.jsx'
import EmployeeProfile from './pages/EmployeeProfile.jsx'
import OrgChart from './pages/OrgChart.jsx'
import Attendance from './pages/Attendance.jsx'
import Leaves from './pages/Leaves.jsx'
import Salary from './pages/Salary.jsx'
import SalaryRevision from './pages/SalaryRevision.jsx'
import Advances from './pages/Advances.jsx'
import HRExpenses from './pages/Expenses.jsx'
import ModuleMyTasks from '../../components/tasks/ModuleMyTasks.jsx'
import ModuleTaskTracker from '../../components/tasks/ModuleTaskTracker.jsx'

const MANAGER_ROLES = ['admin','sales_manager','sales_director','project_manager','service_manager','solution_manager']

export default function HRApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const role = userProfile?.role || ''
  const isManager = MANAGER_ROLES.includes(role)

  const TABS = [
    { label: '📊 Dashboard',     path: '/hr',               match: (p) => p === '/hr' || p === '/hr/' },
    { label: '👤 Employees',     path: '/hr/employees',     match: (p) => p.startsWith('/hr/employees') },
    { label: '🧭 Org Chart',     path: '/hr/org-chart',     match: (p) => p.startsWith('/hr/org-chart') },
    { label: '📅 Attendance',    path: '/hr/attendance',    match: (p) => p.startsWith('/hr/attendance') },
    { label: '🏖️ Leaves',       path: '/hr/leaves',        match: (p) => p.startsWith('/hr/leaves') },
    { label: '💵 Salary',          path: '/hr/salary',           match: (p) => p.startsWith('/hr/salary') && !p.startsWith('/hr/salary-revision') },
    { label: '📈 Salary Revision', path: '/hr/salary-revision',  match: (p) => p.startsWith('/hr/salary-revision') },
    { label: '💳 Advances',        path: '/hr/advances',         match: (p) => p.startsWith('/hr/advances') },
    { label: '🧾 Expenses',        path: '/hr/expenses',         match: (p) => p.startsWith('/hr/expenses') },
    { label: '✅ My Tasks',      path: '/hr/my-tasks',      match: (p) => p.startsWith('/hr/my-tasks') },
    ...(isManager ? [{ label: '📊 Task Tracker', path: '/hr/task-tracker', match: (p) => p.startsWith('/hr/task-tracker') }] : []),
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
          <Route path="/"             element={<HRDashboard />} />
          <Route path="/employees"        element={<Employees />} />
          <Route path="/org-chart"        element={<OrgChart />} />
          <Route path="/employee/:id"     element={<EmployeeProfile />} />
          <Route path="/attendance"       element={<Attendance />} />
          <Route path="/leaves"           element={<Leaves />} />
          <Route path="/salary"           element={<Salary />} />
          <Route path="/salary-revision"  element={<SalaryRevision />} />
          <Route path="/advances"         element={<Advances />} />
          <Route path="/expenses"         element={<HRExpenses />} />
          <Route path="/my-tasks"         element={<ModuleMyTasks />} />
          <Route path="/task-tracker"     element={<ModuleTaskTracker />} />
        </Routes>
      </div>
    </div>
  )
}
