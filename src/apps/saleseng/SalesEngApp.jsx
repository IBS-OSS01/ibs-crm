import React from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import SalesEngineering from '../crm/pages/SalesEngineering'
import ModuleMyTasks from '../../components/tasks/ModuleMyTasks.jsx'
import ModuleTaskTracker from '../../components/tasks/ModuleTaskTracker.jsx'

const MANAGER_ROLES = ['admin','sales_manager','sales_director','project_manager','service_manager','solution_manager']

export default function SalesEngApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const isManager = MANAGER_ROLES.includes(userProfile?.role || '')

  const TABS = [
    { label: '⚙️ Sales Engineering', path: '/saleseng',             match: (p) => p === '/saleseng' || p === '/saleseng/' },
    { label: '✅ My Tasks',           path: '/saleseng/my-tasks',    match: (p) => p.startsWith('/saleseng/my-tasks') },
    ...(isManager ? [{ label: '📊 Task Tracker', path: '/saleseng/task-tracker', match: (p) => p.startsWith('/saleseng/task-tracker') }] : []),
  ]

  return (
    <div className="h-full overflow-auto bg-slate-50 flex flex-col">
      <div className="flex gap-1 px-4 pt-3 bg-white border-b border-slate-200 flex-shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.path} onClick={() => navigate(t.path)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${
              t.match(location.pathname) ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        <Routes>
          <Route path="/"             element={<SalesEngineering />} />
          <Route path="/my-tasks"     element={<ModuleMyTasks />} />
          <Route path="/task-tracker" element={<ModuleTaskTracker />} />
          <Route path="*"             element={<Navigate to="/saleseng" replace />} />
        </Routes>
      </div>
    </div>
  )
}
