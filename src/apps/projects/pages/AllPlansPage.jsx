/**
 * AllPlansPage.jsx
 * Aggregated view of all project execution plans for project managers.
 * Loads all projects + their WBS tasks and shows summary cards.
 * Click "Open Plan" to navigate into ProjectPlanPage for inline editing.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

const STATUS_COLORS = {
  active:    'bg-green-100 text-green-700 border-green-200',
  completed: 'bg-slate-100 text-slate-600 border-slate-200',
  on_hold:   'bg-amber-100 text-amber-700 border-amber-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
}
const COMPANY_BADGE = {
  UIPL:   'bg-blue-100 text-blue-700',
  Wayzim: 'bg-purple-100 text-purple-700',
}
const fmt = (iso) => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
  : '—'
const today = new Date().toISOString().slice(0, 10)

function planStats(tasks) {
  const leaf = tasks.filter(t => t.level > 1)
  const phases = tasks.filter(t => t.level === 1)
  const done = leaf.filter(t => (t.progress || 0) >= 100).length
  const overdue = leaf.filter(t => t.endDate && t.endDate < today && (t.progress || 0) < 100).length
  const progress = leaf.length > 0
    ? Math.round(leaf.reduce((s, t) => s + (t.progress || 0), 0) / leaf.length)
    : 0
  const resourceSet = new Set()
  tasks.forEach(t => (t.resources || []).forEach(r => {
    const lbl = typeof r === 'string' ? r : (r.email || r.name || '')
    if (lbl) resourceSet.add(lbl)
  }))
  return { phases: phases.length, total: leaf.length, done, overdue, progress, resources: resourceSet.size }
}

export default function AllPlansPage() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = userProfile?.role === 'admin'
  const isPM = userProfile?.role === 'project_manager' || userProfile?.role === 'sales_manager'
  const userCompanies = userProfile?.companies || ['UIPL']

  const [projects, setProjects]   = useState([])
  const [allTasks, setAllTasks]   = useState([])   // flat array of all project_plan_tasks
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [sortBy, setSortBy]       = useState('number')  // number | progress | overdue | updated

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [projSnap, tasksSnap] = await Promise.all([
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'project_plan_tasks')),
      ])
      const projData = []
      projSnap.forEach(d => {
        const data = d.data()
        if (!data.isGeneral) projData.push({ id: d.id, ...data })
      })
      const visible = projData.filter(p =>
        isAdmin || isPM || !p.company || userCompanies.includes(p.company)
      )
      visible.sort((a, b) => (b.projectNumber || '').localeCompare(a.projectNumber || ''))
      setProjects(visible)
      const td = []
      tasksSnap.forEach(d => td.push({ id: d.id, ...d.data() }))
      setAllTasks(td)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Build map: projectId → tasks[]
  const tasksByProject = useMemo(() => {
    const map = {}
    allTasks.forEach(t => {
      if (!map[t.projectId]) map[t.projectId] = []
      map[t.projectId].push(t)
    })
    return map
  }, [allTasks])

  // Filtered + sorted list
  const filtered = useMemo(() => {
    let list = projects
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        (p.dealTitle || '').toLowerCase().includes(q) ||
        (p.projectNumber || '').toLowerCase().includes(q) ||
        (p.customerName || '').toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') list = list.filter(p => (p.status || 'active') === statusFilter)
    if (companyFilter !== 'all') list = list.filter(p => p.company === companyFilter)

    return [...list].sort((a, b) => {
      if (sortBy === 'number') return (b.projectNumber || '').localeCompare(a.projectNumber || '')
      if (sortBy === 'progress') {
        const pa = planStats(tasksByProject[a.id] || []).progress
        const pb = planStats(tasksByProject[b.id] || []).progress
        return pb - pa
      }
      if (sortBy === 'overdue') {
        const oa = planStats(tasksByProject[a.id] || []).overdue
        const ob = planStats(tasksByProject[b.id] || []).overdue
        return ob - oa
      }
      return 0
    })
  }, [projects, tasksByProject, search, statusFilter, companyFilter, sortBy])

  // Summary totals
  const totals = useMemo(() => {
    const all = filtered.map(p => planStats(tasksByProject[p.id] || []))
    return {
      projects: filtered.length,
      withPlan: filtered.filter(p => (tasksByProject[p.id] || []).length > 0).length,
      totalTasks: all.reduce((s, x) => s + x.total, 0),
      overdue: all.reduce((s, x) => s + x.overdue, 0),
      avgProgress: all.length > 0 ? Math.round(all.reduce((s, x) => s + x.progress, 0) / all.length) : 0,
    }
  }, [filtered, tasksByProject])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400">Loading plans…</div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-5 min-h-full bg-slate-50">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">All Project Plans</h1>
          <p className="text-sm text-slate-500 mt-0.5">Review and edit execution plans across all projects</p>
        </div>
      </div>

      {/* Summary stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Projects',       value: totals.projects,    color: 'text-slate-700' },
          { label: 'With Plan',      value: totals.withPlan,    color: 'text-blue-700'  },
          { label: 'Total Tasks',    value: totals.totalTasks,  color: 'text-slate-700' },
          { label: 'Overdue Tasks',  value: totals.overdue,     color: totals.overdue > 0 ? 'text-red-600' : 'text-green-600' },
          { label: 'Avg Progress',   value: totals.avgProgress + '%', color: 'text-blue-700' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200/70 rounded-2xl shadow-card px-4 py-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={search} onChange={e => setSearch(e.target.value)} placeholder="Search project / customer…"
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-56 bg-white"
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="all">All companies</option>
          <option value="UIPL">UIPL</option>
          <option value="Wayzim">Wayzim</option>
        </select>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-slate-500">Sort:</span>
          {[['number','Project #'],['progress','Progress'],['overdue','Overdue']].map(([v,l]) => (
            <button key={v} onClick={() => setSortBy(v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${sortBy === v ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:border-blue-400'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Plans table */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200/70 rounded-2xl shadow-card p-10 text-center text-slate-400">
          No projects match your filters.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 w-32">Project #</th>
                <th className="text-left px-4 py-3">Project / Customer</th>
                <th className="text-center px-3 py-3 w-20">Status</th>
                <th className="text-center px-3 py-3 w-16">Phases</th>
                <th className="text-center px-3 py-3 w-20">Tasks</th>
                <th className="text-center px-3 py-3 w-20">Done</th>
                <th className="text-center px-3 py-3 w-20">Overdue</th>
                <th className="text-center px-3 py-3 w-24">Resources</th>
                <th className="text-left px-3 py-3 w-44">Progress</th>
                <th className="px-3 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(p => {
                const tasks = tasksByProject[p.id] || []
                const hasPlan = tasks.length > 0
                const s = planStats(tasks)
                return (
                  <tr key={p.id} className="hover:bg-blue-50/40 transition-colors group">
                    {/* Project number */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-blue-700 font-bold text-xs">{p.projectNumber}</span>
                      {p.company && (
                        <span className={`ml-1.5 px-1.5 py-0.5 rounded-lg text-xs font-semibold ${COMPANY_BADGE[p.company] || 'bg-slate-100 text-slate-600'}`}>
                          {p.company}
                        </span>
                      )}
                    </td>
                    {/* Name */}
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800 truncate max-w-xs">{p.dealTitle}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">
                        {p.customerName && <span>{p.customerName}</span>}
                        {p.poNumber && <span className="ml-2 text-slate-300">PO: {p.poNumber}</span>}
                      </p>
                    </td>
                    {/* Status */}
                    <td className="px-3 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-lg border text-xs font-semibold capitalize ${STATUS_COLORS[p.status || 'active'] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {(p.status || 'active').replace('_', ' ')}
                      </span>
                    </td>
                    {/* Phases */}
                    <td className="px-3 py-3 text-center">
                      {hasPlan ? <span className="font-semibold text-slate-700">{s.phases}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Tasks */}
                    <td className="px-3 py-3 text-center">
                      {hasPlan ? <span className="font-semibold text-slate-700">{s.total}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Done */}
                    <td className="px-3 py-3 text-center">
                      {hasPlan
                        ? <span className={`font-semibold ${s.done === s.total && s.total > 0 ? 'text-green-600' : 'text-slate-700'}`}>{s.done}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Overdue */}
                    <td className="px-3 py-3 text-center">
                      {hasPlan
                        ? s.overdue > 0
                          ? <span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{s.overdue}</span>
                          : <span className="text-green-500 text-xs">✓ None</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Resources */}
                    <td className="px-3 py-3 text-center">
                      {hasPlan
                        ? <span className="font-semibold text-slate-700">{s.resources}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    {/* Progress bar */}
                    <td className="px-3 py-3">
                      {hasPlan ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${s.progress >= 100 ? 'bg-green-500' : s.overdue > 0 ? 'bg-amber-500' : 'bg-blue-500'}`}
                              style={{ width: `${s.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500 w-9 text-right font-medium">{s.progress}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No plan yet</span>
                      )}
                    </td>
                    {/* Action */}
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => navigate(`/projects/plan/${p.id}`)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                          hasPlan
                            ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                            : 'bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        {hasPlan ? '✏ Edit Plan' : '+ Create Plan'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
