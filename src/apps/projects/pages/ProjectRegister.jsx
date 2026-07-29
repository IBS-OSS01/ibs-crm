import React, { useState, useEffect } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

const COMPANY_COLORS = { UIPL: 'bg-blue-100 text-blue-700', Wayzim: 'bg-purple-100 text-purple-700' }
const STATUS_COLORS = {
  active: 'bg-green-100 text-green-700',
  completed: 'bg-slate-100 text-slate-600',
  on_hold: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
}

export default function ProjectRegister() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = userProfile?.role === 'admin'
  const userCompanies = userProfile?.companies || ['UIPL']

  const [projects, setProjects] = useState([])
  const [costs, setCosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [view, setView] = useState('table')   // 'table' | 'overview'

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [projSnap, costSnap] = await Promise.all([
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'project_costs')),
      ])
      const projData = []
      projSnap.forEach(d => {
        const data = d.data()
        if (!data.isGeneral) projData.push({ id: d.id, ...data })
      })
      const visible = projData.filter(p =>
        isAdmin || !p.company || userCompanies.includes(p.company)
      )
      visible.sort((a, b) => (b.projectNumber || '').localeCompare(a.projectNumber || ''))
      const costData = []
      costSnap.forEach(d => costData.push({ id: d.id, ...d.data() }))
      setProjects(visible)
      setCosts(costData)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const getCostForProject = (projectId) =>
    costs.filter(c => c.projectId === projectId).reduce((s, c) => s + (Number(c.amount) || 0), 0)

  const filtered = projects.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      (p.projectNumber || '').toLowerCase().includes(q) ||
      (p.dealTitle || '').toLowerCase().includes(q) ||
      (p.customerName || '').toLowerCase().includes(q)
    const matchStatus = statusFilter === 'all' || p.status === statusFilter
    return matchSearch && matchStatus
  })

  const totalContractValue = filtered.reduce((s, p) => s + (Number(p.contractValue) || 0), 0)
  const activeCount = projects.filter(p => p.status === 'active').length
  const completedCount = projects.filter(p => p.status === 'completed').length

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Project Register</h2>
        <p className="text-slate-500 text-sm">All projects from won CRM opportunities · contract value &amp; cost margin</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Total Projects</p>
          <p className="text-2xl font-bold text-slate-900 tracking-tight mt-1">{projects.length}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Active</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{activeCount}</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Completed</p>
          <p className="text-2xl font-bold text-slate-600 mt-1">{completedCount}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide">Total Contract Value</p>
          <p className="text-lg font-bold text-blue-700 mt-1">Rs.{totalContractValue.toLocaleString('en-IN')}</p>
        </div>
      </div>

      {/* Filters + view toggle */}
      <div className="flex gap-3 flex-wrap">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search project #, name, customer..."
          className="flex-1 min-w-48 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="on_hold">On Hold</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {[['table','☰ Table'],['overview','⊞ Overview']].map(([v,l]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-2 font-medium transition ${view === v ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Overview cards */}
      {view === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(p => {
            const cv = Number(p.contractValue) || 0
            const dapColor = { draft: 'bg-slate-100 text-slate-600', under_review: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700' }
            const row = (label, value) => value ? (
              <div key={label} className="flex justify-between items-start gap-2 py-1 border-b border-slate-50 last:border-0">
                <span className="text-xs text-slate-400 flex-shrink-0">{label}</span>
                <span className="text-xs font-medium text-slate-700 text-right truncate max-w-[60%]">{value}</span>
              </div>
            ) : null
            return (
              <div key={p.id} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4 flex flex-col gap-2 hover:border-blue-300 transition">
                {/* Card header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-bold text-blue-700">{p.projectNumber}</span>
                    <p className="font-semibold text-slate-800 text-sm leading-tight mt-0.5 truncate">{p.dealTitle || '—'}</p>
                  </div>
                  <span className={`flex-shrink-0 px-2 py-0.5 rounded-lg text-xs font-bold capitalize ${STATUS_COLORS[p.status] || 'bg-slate-100 text-slate-600'}`}>
                    {(p.status || 'active').replace('_', ' ')}
                  </span>
                </div>
                {/* Fields */}
                <div className="flex-1">
                  {row('Customer',    p.customerName)}
                  {row('Site',        p.siteName)}
                  {row('Deal Value',  cv > 0 ? `Rs.${cv.toLocaleString('en-IN')}` : null)}
                  {row('Sales Owner', p.salesManagerName)}
                  {row('Project Mgr', p.projectManagerName || p.projectManager)}
                  {p.dapStatus && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-50">
                      <span className="text-xs text-slate-400">DAP Status</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${dapColor[p.dapStatus] || 'bg-slate-100 text-slate-500'}`}>
                        {p.dapStatus.replace('_', ' ')}
                      </span>
                    </div>
                  )}
                  {row('Start Date',  p.startDate || p.poDate)}
                  {row('Expected End',p.expectedCompletion || p.targetDate)}
                </div>
                {/* Footer */}
                <button onClick={() => navigate(`/projects/plan/${p.id}`)}
                  className="mt-1 w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-xl transition">
                  📋 Open Plan
                </button>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="col-span-3 text-center text-slate-400 py-8">No projects match filters.</p>
          )}
        </div>
      )}

      {/* Register table */}
      {view === 'table' &&
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Project #</th>
              <th className="text-left px-4 py-3">PO / Contract #</th>
              <th className="text-left px-4 py-3">Project Name</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Site</th>
              <th className="text-left px-4 py-3">Warehouse</th>
              <th className="text-left px-4 py-3">Entity</th>
              <th className="text-right px-4 py-3">Contract Value</th>
              <th className="text-right px-4 py-3">Costs Logged</th>
              <th className="text-right px-4 py-3">Margin %</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-center px-4 py-3">Plan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(p => {
              const cv = Number(p.contractValue) || 0
              const tc = getCostForProject(p.id)
              const margin = cv > 0 ? ((cv - tc) / cv) * 100 : null
              return (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold text-blue-700">{p.projectNumber}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.poNumber || '—'}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{p.dealTitle || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{p.customerName || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{p.siteName || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{p.warehouseName || '—'}</td>
                  <td className="px-4 py-3">
                    {p.company && (
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${COMPANY_COLORS[p.company] || 'bg-slate-100 text-slate-600'}`}>
                        {p.company}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {cv > 0 ? `Rs.${cv.toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-orange-700">
                    {tc > 0 ? `Rs.${tc.toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    {margin !== null ? (
                      <span className={margin >= 0 ? 'text-green-700' : 'text-red-600'}>
                        {margin.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold capitalize ${STATUS_COLORS[p.status] || 'bg-slate-100 text-slate-600'}`}>
                      {(p.status || 'active').replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => navigate(`/projects/plan/${p.id}`)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition whitespace-nowrap"
                    >
                      📋 Plan
                    </button>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="text-center py-8 text-slate-400">
                  {projects.length === 0
                    ? 'No projects yet. Mark a CRM opportunity as Won to create one.'
                    : 'No projects match filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>}
    </div>
  )
}
