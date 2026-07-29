import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useNavigate } from 'react-router-dom'

export default function ProjectsDashboard() {
  const navigate = useNavigate()
  const [sites, setSites] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [siteSnap, taskSnap] = await Promise.all([
          getDocs(collection(db, 'crm_sites')),
          getDocs(collection(db, 'project_tasks')),
        ])
        const s = []; siteSnap.forEach(d => s.push({ id: d.id, ...d.data() }))
        const t = []; taskSnap.forEach(d => t.push({ id: d.id, ...d.data() }))
        setSites(s); setTasks(t)
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  const today = new Date().toISOString().slice(0, 10)
  const projects = sites.filter(s => s.status === 'project')
  const overdue = projects.filter(s => s.targetHandoverDate && s.targetHandoverDate < today)
  const serviceSites = sites.filter(s => s.status === 'service')
  const openTasks = tasks.filter(t => !t.done)
  const overdueTasks = openTasks.filter(t => t.dueDate && t.dueDate < today)

  const thisMonth = today.slice(0, 7)
  const completedThisMonth = sites.filter(s => s.status === 'service' && (s.handoverDate || '').startsWith(thisMonth))

  const cards = [
    { label: 'Active Projects', value: projects.length, icon: '📁', color: 'text-blue-600', path: '/projects/active' },
    { label: 'Overdue Projects', value: overdue.length, icon: '⚠️', color: overdue.length > 0 ? 'text-red-600' : 'text-slate-400', path: '/projects/active' },
    { label: 'Open Tasks', value: openTasks.length, icon: '✅', color: 'text-amber-600', path: '/projects/tasks' },
    { label: 'Overdue Tasks', value: overdueTasks.length, icon: '🔴', color: overdueTasks.length > 0 ? 'text-red-600' : 'text-slate-400', path: '/projects/tasks' },
    { label: 'Service Sites', value: serviceSites.length, icon: '🔧', color: 'text-green-600', path: '/projects/service' },
    { label: 'Completed This Month', value: completedThisMonth.length, icon: '🎉', color: 'text-purple-600', path: '/projects/service' },
  ]

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">📁 Projects Dashboard</h2>
        <p className="text-slate-500 text-sm">{projects.length} active projects · {serviceSites.length} service sites</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map(c => (
          <button key={c.label} onClick={() => navigate(c.path)}
            className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 text-left hover:border-blue-300 transition">
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{c.label}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Overdue projects */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-800 text-sm">⚠️ Overdue Projects</h3>
            <button onClick={() => navigate('/projects/active')} className="text-xs text-blue-600 hover:underline">View all</button>
          </div>
          {overdue.length === 0 ? (
            <p className="text-slate-400 text-sm">No overdue projects. 👍</p>
          ) : (
            <div className="space-y-2">
              {overdue.slice(0, 5).map(s => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium text-slate-800">{s.siteName}</span>
                    <span className="text-slate-400 ml-2">{s.customerName}</span>
                  </div>
                  <span className="text-red-600 text-xs">Due: {s.targetHandoverDate}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming task deadlines */}
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-800 text-sm">📋 Upcoming Tasks</h3>
            <button onClick={() => navigate('/projects/tasks')} className="text-xs text-blue-600 hover:underline">View all</button>
          </div>
          {openTasks.length === 0 ? (
            <p className="text-slate-400 text-sm">No open tasks.</p>
          ) : (
            <div className="space-y-2">
              {openTasks.filter(t => t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5).map(t => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className={`font-medium ${t.dueDate < today ? 'text-red-700' : 'text-slate-800'}`}>{t.task}</span>
                    <span className="text-slate-400 ml-2 text-xs">{t.projectName}</span>
                  </div>
                  <span className={`text-xs ${t.dueDate < today ? 'text-red-600 font-bold' : 'text-slate-500'}`}>{t.dueDate}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
