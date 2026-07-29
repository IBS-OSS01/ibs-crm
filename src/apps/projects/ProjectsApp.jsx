import React from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import ProjectsDashboard from './pages/ProjectsDashboard.jsx'
import ActiveProjects from './pages/ActiveProjects.jsx'
import ProjectTasks from './pages/ProjectTasks.jsx'
import ServiceSites from './pages/ServiceSites.jsx'
import ProjectRegister from './pages/ProjectRegister.jsx'
import AllPlansPage from './pages/AllPlansPage.jsx'
import ProjectPlanPage from './pages/ProjectPlanPage.jsx'
import ModuleMyTasks from '../../components/tasks/ModuleMyTasks.jsx'
import ModuleTaskTracker from '../../components/tasks/ModuleTaskTracker.jsx'

const MANAGER_ROLES = ['admin','sales_manager','sales_director','project_manager','service_manager','solution_manager']

export default function ProjectsApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const isManager = MANAGER_ROLES.includes(userProfile?.role || '')

  const TABS = [
    { label: '📊 Dashboard',       path: '/projects',              match: (p) => p === '/projects' || p === '/projects/' },
    { label: '📁 Active Projects',  path: '/projects/active',       match: (p) => p.startsWith('/projects/active') },
    { label: '✅ Project Tasks',    path: '/projects/tasks',        match: (p) => p.startsWith('/projects/tasks') },
    { label: '🔧 Service Sites',    path: '/projects/service',      match: (p) => p.startsWith('/projects/service') },
    { label: '📋 Project Register', path: '/projects/register',     match: (p) => p.startsWith('/projects/register') },
    { label: '🗂 All Plans',        path: '/projects/all-plans',    match: (p) => p.startsWith('/projects/all-plans') || p.startsWith('/projects/plan/') },
    { label: '✅ My Tasks',         path: '/projects/my-tasks',     match: (p) => p.startsWith('/projects/my-tasks') },
    ...(isManager ? [{ label: '📊 Task Tracker', path: '/projects/task-tracker', match: (p) => p.startsWith('/projects/task-tracker') }] : []),
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
          <Route path="/"                element={<ProjectsDashboard />} />
          <Route path="/active"          element={<ActiveProjects />} />
          <Route path="/tasks"           element={<ProjectTasks />} />
          <Route path="/service"         element={<ServiceSites />} />
          <Route path="/register"        element={<ProjectRegister />} />
          <Route path="/all-plans"       element={<AllPlansPage />} />
          <Route path="/plan/:projectId" element={<ProjectPlanPage />} />
          <Route path="/my-tasks"        element={<ModuleMyTasks />} />
          <Route path="/task-tracker"    element={<ModuleTaskTracker />} />
        </Routes>
      </div>
    </div>
  )
}
