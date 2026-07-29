import React, { useState, useEffect } from 'react'
import { collection, getDocs, writeBatch, doc, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

const STATUS_CYCLE = ['present', 'absent', 'half-day', 'paid-leave']
const STATUS_META = {
  present:     { label: 'P',  bg: 'bg-green-100 text-green-800',  full: 'Present' },
  absent:      { label: 'A',  bg: 'bg-red-100 text-red-700',      full: 'Absent' },
  'half-day':  { label: 'H',  bg: 'bg-amber-100 text-amber-700',  full: 'Half Day' },
  'paid-leave':{ label: 'PL', bg: 'bg-blue-100 text-blue-700',    full: 'Paid Leave' },
  '':          { label: '—',  bg: 'bg-slate-100 text-slate-400',  full: 'Not marked' },
}

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function isSunday(year, month, day) { return new Date(year, month, day).getDay() === 0 }

export default function Attendance() {
  const { userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'

  const today = new Date()
  const [employees, setEmployees] = useState([])
  const [selectedEmp, setSelectedEmp] = useState('')
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [records, setRecords] = useState({}) // { 'YYYY-MM-DD': status }
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getDocs(collection(db, 'hr_employees')).then(snap => {
      const data = []
      snap.forEach(d => data.push({ id: d.id, name: d.data().name || d.id, active: d.data().active !== false }))
      data.sort((a, b) => a.name.localeCompare(b.name))
      const activeEmps = data.filter(e => e.active)
      setEmployees(activeEmps)
      if (activeEmps.length > 0) setSelectedEmp(activeEmps[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selectedEmp) return
    setLoading(true); setDirty(false); setMsg('')
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
    const q = query(collection(db, 'hr_attendance'), where('employeeId', '==', selectedEmp))
    getDocs(q).then(snap => {
      const map = {}
      snap.forEach(d => {
        const { date, status } = d.data()
        if (date && date.startsWith(monthStr)) map[date] = { status, docId: d.id }
      })
      setRecords(map)
    }).catch(console.error)
    .finally(() => setLoading(false))
  }, [selectedEmp, year, month])

  const days = daysInMonth(year, month)
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`

  const toggle = (day) => {
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
    const curr = records[dateStr]?.status || ''
    const idx = STATUS_CYCLE.indexOf(curr)
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    setRecords(prev => ({ ...prev, [dateStr]: { ...(prev[dateStr] || {}), status: next } }))
    setDirty(true)
  }

  const handleSave = async () => {
    if (!selectedEmp) return
    setSaving(true); setMsg('')
    try {
      const batch = writeBatch(db)
      Object.entries(records).forEach(([date, rec]) => {
        if (!date.startsWith(monthStr)) return
        const ref = rec.docId ? doc(db, 'hr_attendance', rec.docId) : doc(collection(db, 'hr_attendance'))
        const empName = employees.find(e => e.id === selectedEmp)?.name || ''
        batch.set(ref, { employeeId: selectedEmp, employeeName: empName, date, status: rec.status, month: monthStr }, { merge: true })
      })
      await batch.commit()
      setDirty(false)
      setMsg('Attendance saved.')
    } catch (err) { setMsg('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  // Summary counts
  const summary = { present: 0, absent: 0, 'half-day': 0, 'paid-leave': 0 }
  Object.values(records).forEach(r => { if (r.status && summary[r.status] !== undefined) summary[r.status]++ })

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const years = [today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2]

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Attendance</h2>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={month} onChange={e => setMonth(Number(e.target.value))}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={handleSave} disabled={!dirty || saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
          {saving ? 'Saving...' : '💾 Save Attendance'}
        </button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        {msg && <span className={`text-xs ${msg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{msg}</span>}
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap text-xs">
        {Object.entries(STATUS_META).filter(([k]) => k !== '').map(([k, v]) => (
          <span key={k} className={`px-2 py-1 rounded-lg font-medium ${v.bg}`}>{v.label} = {v.full}</span>
        ))}
        <span className="text-slate-400">Click a day to cycle status. Sundays shown in grey.</span>
      </div>

      {loading ? <div className="text-slate-400 text-sm">Loading attendance...</div> : (
        <>
          {/* Calendar grid */}
          <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
            <div className="grid grid-cols-7 gap-1">
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                <div key={d} className="text-center text-xs font-bold text-slate-400 py-1">{d}</div>
              ))}
              {/* Empty cells for first week offset */}
              {Array.from({ length: new Date(year, month, 1).getDay() }).map((_, i) => (
                <div key={`e${i}`} />
              ))}
              {Array.from({ length: days }, (_, i) => i + 1).map(day => {
                const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
                const status = records[dateStr]?.status || ''
                const meta = STATUS_META[status] || STATUS_META['']
                const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
                const sun = isSunday(year, month, day)
                return (
                  <button key={day} onClick={() => !sun && toggle(day)}
                    title={`${day} ${MONTHS[month]} — ${meta.full}`}
                    className={`relative rounded-lg p-1 text-center transition ${sun ? 'bg-slate-50 cursor-default' : `${meta.bg} hover:opacity-80 cursor-pointer`} ${isToday ? 'ring-2 ring-blue-500' : ''}`}>
                    <div className="text-xs text-slate-500">{day}</div>
                    <div className="text-xs font-bold">{sun ? '—' : meta.label}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { k: 'present', label: 'Present', color: 'text-green-700 bg-green-50 border-green-200' },
              { k: 'absent', label: 'Absent', color: 'text-red-700 bg-red-50 border-red-200' },
              { k: 'half-day', label: 'Half Day', color: 'text-amber-700 bg-amber-50 border-amber-200' },
              { k: 'paid-leave', label: 'Paid Leave', color: 'text-blue-700 bg-blue-50 border-blue-200' },
            ].map(({ k, label, color }) => (
              <div key={k} className={`rounded-xl border p-3 text-center ${color}`}>
                <p className="text-2xl font-bold">{summary[k]}</p>
                <p className="text-xs">{label}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
