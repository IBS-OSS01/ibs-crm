import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useNavigate } from 'react-router-dom'

// Connector-line classes shared by every non-root card's wrapping <li>.
// Each <li> draws its own half of the horizontal bar above it (left half via
// ::before, right half via ::after) plus a vertical stem at its own center
// (the ::after's left border). The first child hides its left-bar segment,
// the last child hides its right-bar segment, and an only-child hides both
// (the parent's own stem is enough for a single report).
const LI_CONNECTOR =
  'relative flex flex-col items-center pt-6 px-3 ' +
  "before:content-[''] before:absolute before:top-0 before:right-1/2 before:w-1/2 before:h-6 before:border-t-2 before:border-t-slate-300 " +
  "after:content-[''] after:absolute after:top-0 after:left-1/2 after:w-1/2 after:h-6 after:border-t-2 after:border-l-2 after:border-t-slate-300 after:border-l-slate-300 " +
  'first:before:border-t-transparent last:after:border-t-transparent ' +
  'only:before:hidden only:after:hidden only:pt-0'

const UL_CONNECTOR =
  'relative flex justify-center pt-6 ' +
  "before:content-[''] before:absolute before:top-0 before:left-1/2 before:-translate-x-1/2 before:w-0 before:h-6 before:border-l-2 before:border-slate-300"

function PersonCard({ emp, onOpen }) {
  return (
    <button onClick={() => onOpen(emp)}
      className="w-48 bg-white border border-slate-200 rounded-xl shadow-card px-3 py-3 text-center hover:border-blue-300 hover:shadow-md transition">
      <div className="w-9 h-9 mx-auto mb-1.5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">
        {(emp.name || '?').trim().charAt(0).toUpperCase()}
      </div>
      <p className="font-semibold text-slate-800 text-sm leading-tight truncate" title={emp.name}>{emp.name || 'Unnamed'}</p>
      <p className="text-xs text-slate-500 truncate mt-0.5" title={emp.designation}>{emp.designation || '—'}</p>
      <p className="text-xs text-slate-400 mt-1">
        {emp.phone ? <a href={`tel:${emp.phone}`} onClick={e => e.stopPropagation()} className="hover:text-blue-600">📞 {emp.phone}</a> : '—'}
      </p>
    </button>
  )
}

function OrgNode({ emp, childrenByManager, onOpen, visited }) {
  // Guard against a manager-link cycle (A reports to B, B reports to A) —
  // without this a bad edit could freeze the page in infinite recursion.
  if (visited.has(emp.id)) return <PersonCard emp={emp} onOpen={onOpen} />
  const kids = childrenByManager[emp.id] || []
  const nextVisited = new Set(visited); nextVisited.add(emp.id)

  return (
    <div className="flex flex-col items-center">
      <PersonCard emp={emp} onOpen={onOpen} />
      {kids.length > 0 && (
        <ul className={UL_CONNECTOR}>
          {kids.map(k => (
            <li key={k.id} className={LI_CONNECTOR}>
              <OrgNode emp={k} childrenByManager={childrenByManager} onOpen={onOpen} visited={nextVisited} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function OrgChart() {
  const navigate = useNavigate()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [includeInactive, setIncludeInactive] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'hr_employees'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setEmployees(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const visible = useMemo(
    () => employees.filter(e => includeInactive || e.active !== false),
    [employees, includeInactive]
  )

  const { roots, childrenByManager } = useMemo(() => {
    const byId = new Set(visible.map(e => e.id))
    const map = {}
    const rootList = []
    visible.forEach(e => {
      const mgr = e.reportingManagerId
      // No manager set, manager not in the visible set, or a self-reference
      // all count as "top of the chart" so nobody silently disappears.
      if (!mgr || !byId.has(mgr) || mgr === e.id) {
        rootList.push(e)
      } else {
        if (!map[mgr]) map[mgr] = []
        map[mgr].push(e)
      }
    })
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
    rootList.sort(byName)
    Object.values(map).forEach(list => list.sort(byName))
    return { roots: rootList, childrenByManager: map }
  }, [visible])

  const openProfile = (emp) => navigate(`/hr/employee/${emp.id}`)

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading org chart...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Organisation Chart</h2>
          <p className="text-slate-500 text-sm">{visible.length} people shown · click a card to open their profile</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
          Include inactive employees
        </label>
      </div>

      {employees.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          No employees yet. Add employees under HR → Employees first.
        </div>
      ) : roots.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 text-center text-slate-400">
          No employees match the current filter.
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-8 overflow-x-auto">
          <div className="flex justify-center gap-12 min-w-max">
            {roots.map(r => (
              <OrgNode key={r.id} emp={r} childrenByManager={childrenByManager} onOpen={openProfile} visited={new Set()} />
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Set who each person reports to from HR → Employees → Edit → Reporting Manager. Anyone without a manager (or
        pointing at someone hidden by the filter above) appears as a top-level box here.
      </p>
    </div>
  )
}
