import React from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import UserManagement from './pages/UserManagement.jsx'
import RoleManagement from './pages/RoleManagement.jsx'
import PlanStatus from './pages/PlanStatus.jsx'
import Permissions from './pages/Permissions.jsx'

export default function AdminApp() {
  const location = useLocation()
  const navigate = useNavigate()

  const tabs = [
    { label: 'Users', path: '/admin/users', match: (p) => p === '/admin' || p === '/admin/' || p.startsWith('/admin/users') },
    { label: 'Permissions', path: '/admin/permissions', match: (p) => p.startsWith('/admin/permissions') },
    { label: 'Roles', path: '/admin/roles', match: (p) => p.startsWith('/admin/roles') },
    { label: 'Plan & Usage', path: '/admin/plan', match: (p) => p.startsWith('/admin/plan') },
  ]

  return (
    <div className="h-full overflow-auto bg-slate-50">
      <div className="flex gap-2 px-6 pt-3 bg-white border-b border-slate-200">
        {tabs.map(t => (
          <button
            key={t.path}
            onClick={() => navigate(t.path)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              t.match(location.pathname) ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Routes>
        <Route path="/" element={<UserManagement />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/permissions" element={<Permissions />} />
        <Route path="/roles" element={<RoleManagement />} />
        <Route path="/plan" element={<PlanStatus />} />
      </Routes>
    </div>
  )
}
