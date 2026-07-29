import React, { useState, useEffect } from 'react'
import { useNavigate, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ServicesApp from '../../apps/services/ServicesApp.jsx'
import AdminApp from '../../apps/admin/AdminApp.jsx'
import CRMApp from '../../apps/crm/CRMApp.jsx'
import HRApp from '../../apps/hr/HRApp.jsx'
import ProjectsApp from '../../apps/projects/ProjectsApp.jsx'
import FinanceApp from '../../apps/finance/FinanceApp.jsx'
import SalesEngApp from '../../apps/saleseng/SalesEngApp.jsx'
import TaskQuickAdd from '../tasks/TaskQuickAdd.jsx'
import { APP_VERSION_LABEL } from '../../version'

export default function Layout() {
  const { user, userProfile, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [installPrompt, setInstallPrompt] = useState(window._pwaInstallPrompt || null)
  const [installed, setInstalled] = useState(false)
  const [showQuickTask, setShowQuickTask] = useState(false)

  useEffect(() => {
    const onReady = () => setInstallPrompt(window._pwaInstallPrompt)
    window.addEventListener('pwaInstallReady', onReady)
    window.addEventListener('appinstalled', () => { setInstalled(true); setInstallPrompt(null) })
    return () => {
      window.removeEventListener('pwaInstallReady', onReady)
    }
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') { setInstalled(true); setInstallPrompt(null) }
  }

  if (!user) return <Navigate to="/login" replace />

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleRefresh = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
    } catch (err) { console.error(err) }
    window.location.reload()
  }

  const modules = [
    { id: 'crm',      name: 'CRM',      icon: '📊', path: '/crm' },
    { id: 'services', name: 'Services', icon: '🔧', path: '/services' },
    { id: 'hr',       name: 'HR',       icon: '👥', path: '/hr' },
    { id: 'projects', name: 'Projects', icon: '📁', path: '/projects' },
    { id: 'finance',  name: 'Finance',  icon: '💰', path: '/finance' },
    { id: 'saleseng', name: 'Sales Eng', icon: '⚙️', path: '/saleseng' },
    { id: 'admin',    name: 'Admin',    icon: '⚙️', path: '/admin' },
  ]

  const userRole = userProfile?.role || 'user'
  const userDepts = userProfile?.departments || []
  const moduleRights = userProfile?.moduleRights || {}

  const accessible = modules.filter(m => {
    if (m.id === 'admin') return userRole === 'admin'
    if (userRole === 'admin') return true
    const mKey = m.name.toUpperCase()
    // New moduleRights system (view or edit both unlock the module tile)
    if (moduleRights[mKey] === 'edit' || moduleRights[mKey] === 'view') return true
    // Legacy fallback: departments array
    if (userDepts.includes(mKey)) return true
    // Role-based bypass for service roles
    if (m.id === 'services' && ['service_manager', 'project_manager'].includes(userRole)) return true
    // Sales Engineering — visible to SE-related roles OR if granted via moduleRights
    if (m.id === 'saleseng' && (
      ['solution_manager', 'sales_manager', 'sales_director', 'sales_engineer', 'bid_coordinator'].includes(userRole) ||
      moduleRights['SALESENG'] === 'edit' || moduleRights['SALESENG'] === 'view'
    )) return true
    return false
  })

  const isRoot = location.pathname === '/'

  const moduleTitle =
    location.pathname.startsWith('/services') ? '🔧 Services' :
    location.pathname.startsWith('/crm') ? '📊 CRM' :
    location.pathname.startsWith('/hr') ? '👥 HR' :
    location.pathname.startsWith('/projects') ? '📁 Projects' :
    location.pathname.startsWith('/finance') ? '💰 Finance' :
    location.pathname.startsWith('/saleseng') ? '⚙️ Sales Engineering' :
    location.pathname.startsWith('/admin') ? '⚙️ Admin' :
    'Dashboard'

  // ── Home / Module Picker ──────────────────────────────────────────────────
  if (isRoot) {
    return (
      <div className="min-h-screen bg-slate-50">
        {/* Top bar */}
        <div className="bg-shell text-white px-4 py-3 flex items-center justify-between">
          <div>
            <p className="font-bold text-base leading-tight tracking-tight">India Business Suite</p>
            <p className="text-xs text-slate-400">{userProfile?.name || user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {installPrompt && !installed && (
              <button onClick={handleInstall} title="Install app"
                className="flex items-center gap-1 px-2.5 py-1.5 bg-brand-gradient hover:opacity-90 rounded-xl text-xs text-white font-medium transition">
                <span>📲</span><span className="hidden sm:inline">Install</span>
              </button>
            )}
            <button onClick={handleRefresh} title="Refresh"
              className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm text-white transition">
              🔄
            </button>
            <button onClick={handleLogout} title="Logout"
              className="p-2 bg-red-500/80 hover:bg-red-500 rounded-xl text-sm text-white transition">
              🚪
            </button>
          </div>
        </div>

        {/* Role chip */}
        <div className="bg-shell border-t border-white/10 px-4 py-1.5 flex items-center gap-2">
          <span className="text-xs text-slate-400">Role:</span>
          <span className="text-xs text-indigo-300 font-bold uppercase tracking-wide">{userRole}</span>
          {userDepts.length > 0 && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-400">{userDepts.join(', ')}</span>
            </>
          )}
        </div>

        {/* Module grid */}
        <div className="p-4 pt-8">
          <p className="text-center text-sm text-slate-400 font-medium mb-6">Choose a workspace</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-lg mx-auto sm:max-w-2xl">
            {accessible.map((m) => (
              <button
                key={m.id}
                onClick={() => navigate(m.path)}
                className="group flex flex-col items-center justify-center p-5 bg-white border border-slate-200/70 rounded-2xl shadow-card hover:shadow-lift hover:border-blue-300 hover:-translate-y-0.5 active:scale-95 transition-all min-h-[110px]"
              >
                <span className="flex items-center justify-center w-14 h-14 mb-2.5 rounded-2xl bg-blue-50 group-hover:bg-brand-gradient transition-colors text-3xl">
                  {m.icon}
                </span>
                <span className="font-semibold text-slate-900 text-sm tracking-tight">{m.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="fixed bottom-3 right-3 text-xs text-slate-400 bg-white px-2.5 py-1 rounded-xl shadow-card border border-slate-200/70">
          {APP_VERSION_LABEL}
        </div>
      </div>
    )
  }

  // ── Inside a module ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 bg-shell px-3 py-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-xl transition"
          >
            ← <span className="hidden sm:inline">Back</span>
          </button>
          <span className="text-slate-200 text-sm font-semibold tracking-tight truncate">{moduleTitle}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="hidden sm:block text-xs text-slate-500">{APP_VERSION_LABEL}</span>
          <button onClick={() => setShowQuickTask(true)} title="Add Task"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold rounded-xl transition">
            ✅ <span className="hidden sm:inline">+ Task</span>
          </button>
          {installPrompt && !installed && (
            <button onClick={handleInstall} title="Install app"
              className="flex items-center gap-1 px-2.5 py-1.5 bg-brand-gradient hover:opacity-90 text-white text-xs font-medium rounded-xl transition">
              📲
            </button>
          )}
          <button onClick={handleRefresh} title="Refresh"
            className="p-1.5 bg-white/10 hover:bg-white/20 text-white text-sm rounded-xl transition">
            🔄
          </button>
          <button onClick={handleLogout} title="Logout"
            className="p-1.5 bg-red-500/80 hover:bg-red-500 text-white text-sm rounded-xl transition">
            🚪
          </button>
        </div>
      </div>

      {showQuickTask && <TaskQuickAdd onClose={() => setShowQuickTask(false)} />}

      <div className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/services/*" element={<ServicesApp />} />
          <Route path="/admin/*"    element={<AdminApp />} />
          <Route path="/crm/*"      element={<CRMApp />} />
          <Route path="/hr/*"       element={<HRApp />} />
          <Route path="/projects/*" element={<ProjectsApp />} />
          <Route path="/finance/*"  element={<FinanceApp />} />
          <Route path="/saleseng/*"  element={<SalesEngApp />} />
        </Routes>
      </div>
    </div>
  )
}