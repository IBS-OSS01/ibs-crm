/**
 * PublicTaskView — no Firebase Auth required.
 * Accessed via /task-view/:token
 * Allows an external resource (no CRM login) to view their task and update status.
 */
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase-config'
import IBSLogo from '../components/common/IBSLogo'

const STATUS_OPTIONS = [
  { id: 'pending',     label: 'Not Started',  color: 'bg-amber-100 text-amber-700 border-amber-300' },
  { id: 'in_progress', label: 'In Progress',  color: 'bg-blue-100 text-blue-700 border-blue-300'   },
  { id: 'completed',   label: 'Completed',    color: 'bg-green-100 text-green-700 border-green-300' },
  { id: 'blocked',     label: 'Blocked',      color: 'bg-red-100 text-red-700 border-red-300'       },
]

const fmt = (iso) => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  : '—'

export default function PublicTaskView() {
  const { token } = useParams()
  const [task, setTask]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [status, setStatus]   = useState('pending')
  const [note, setNote]       = useState('')
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  useEffect(() => { load() }, [token])

  const load = async () => {
    try {
      const snap = await getDoc(doc(db, 'public_task_links', token))
      if (!snap.exists()) { setNotFound(true); return }
      const data = { id: snap.id, ...snap.data() }
      setTask(data)
      setStatus(data.status || 'pending')
      setNote(data.statusNote || '')
    } catch (e) {
      console.error(e)
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!task) return
    setSaving(true); setSaved(false)
    try {
      await updateDoc(doc(db, 'public_task_links', token), {
        status,
        statusNote: note.trim(),
        updatedAt: new Date().toISOString(),
      })
      setTask(prev => ({ ...prev, status, statusNote: note.trim() }))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Screens ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#0f172a', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:'24px' }}>
      <IBSLogo size={64} showText={false} light={true} />
      <p style={{ color:'#64748b', fontFamily:'system-ui,sans-serif', fontSize:'14px' }}>Loading task…</p>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight:'100vh', background:'#0f172a', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}>
      <div style={{ textAlign:'center', color:'#fff', fontFamily:'system-ui,sans-serif' }}>
        <p style={{ fontSize:'48px', marginBottom:'16px' }}>🔗</p>
        <h1 style={{ fontSize:'22px', fontWeight:700, marginBottom:'8px' }}>Link not found</h1>
        <p style={{ color:'#64748b', fontSize:'14px' }}>This task link is invalid or has expired. Contact your project manager.</p>
      </div>
    </div>
  )

  const currentStatus = STATUS_OPTIONS.find(s => s.id === status) || STATUS_OPTIONS[0]
  const isOverdue = task.endDate && task.endDate < new Date().toISOString().slice(0, 10) && status !== 'completed'

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#0a0f1e 0%,#0f172a 50%,#0d1a3a 100%)', padding:'32px 16px', fontFamily:'system-ui,sans-serif' }}>
      <div style={{ maxWidth:'520px', margin:'0 auto' }}>

        {/* Logo */}
        <div style={{ display:'flex', justifyContent:'center', marginBottom:'32px' }}>
          <IBSLogo size={56} showText={true} light={true} />
        </div>

        {/* Task card */}
        <div style={{ background:'rgba(30,41,59,0.9)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'20px', padding:'28px', boxShadow:'0 25px 60px rgba(0,0,0,0.4)' }}>

          {/* Header */}
          <div style={{ borderBottom:'1px solid rgba(255,255,255,0.08)', paddingBottom:'20px', marginBottom:'20px' }}>
            <p style={{ color:'#60a5fa', fontSize:'12px', fontWeight:600, letterSpacing:'0.5px', textTransform:'uppercase', margin:'0 0 6px' }}>
              Project Task
            </p>
            <h1 style={{ color:'#f1f5f9', fontSize:'20px', fontWeight:700, margin:'0 0 4px', lineHeight:1.3 }}>
              {task.taskTitle}
            </h1>
            <p style={{ color:'#94a3b8', fontSize:'13px', margin:0 }}>
              {task.wbsCode && <span style={{ fontFamily:'monospace', marginRight:'8px', color:'#60a5fa' }}>{task.wbsCode}</span>}
              {task.projectName}
            </p>
          </div>

          {/* Details */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'24px' }}>
            <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:'10px', padding:'12px' }}>
              <p style={{ color:'#64748b', fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.5px', margin:'0 0 4px' }}>Deadline</p>
              <p style={{ color: isOverdue ? '#f87171' : '#f1f5f9', fontSize:'15px', fontWeight:600, margin:0 }}>
                {fmt(task.endDate)}
                {isOverdue && <span style={{ display:'block', fontSize:'11px', color:'#f87171', fontWeight:400 }}>⚠ Overdue</span>}
              </p>
            </div>
            <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:'10px', padding:'12px' }}>
              <p style={{ color:'#64748b', fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.5px', margin:'0 0 4px' }}>Assigned to</p>
              <p style={{ color:'#f1f5f9', fontSize:'13px', fontWeight:600, margin:0, wordBreak:'break-all' }}>{task.assigneeEmail}</p>
            </div>
          </div>

          {/* Current status */}
          <p style={{ color:'#94a3b8', fontSize:'12px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', margin:'0 0 10px' }}>
            Update your status
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'16px' }}>
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => setStatus(opt.id)}
                style={{
                  padding:'10px 8px',
                  borderRadius:'10px',
                  border: status === opt.id ? '2px solid #60a5fa' : '1px solid rgba(255,255,255,0.1)',
                  background: status === opt.id ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.04)',
                  color: status === opt.id ? '#60a5fa' : '#94a3b8',
                  fontWeight: status === opt.id ? 700 : 400,
                  fontSize:'13px',
                  cursor:'pointer',
                  transition:'all 0.15s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Note */}
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note (optional) — e.g. what's blocking you, when you expect to complete…"
            rows={3}
            style={{
              width:'100%', boxSizing:'border-box',
              padding:'12px', borderRadius:'10px',
              background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)',
              color:'#f1f5f9', fontSize:'13px', lineHeight:1.6,
              resize:'vertical', fontFamily:'system-ui,sans-serif',
              outline:'none', marginBottom:'16px',
            }}
          />

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width:'100%', padding:'13px',
              background: saved ? 'linear-gradient(135deg,#15803d,#16a34a)' : 'linear-gradient(135deg,#1D4ED8,#4F46E5)',
              color:'#fff', fontWeight:700, fontSize:'15px',
              border:'none', borderRadius:'12px',
              cursor: saving ? 'not-allowed' : 'pointer',
              transition:'all 0.2s',
              boxShadow: saved ? '0 4px 16px rgba(21,128,61,0.4)' : '0 4px 16px rgba(29,78,216,0.4)',
            }}
          >
            {saving ? 'Saving…' : saved ? '✅ Status Updated!' : 'Save Status'}
          </button>

          {task.updatedAt && (
            <p style={{ color:'#475569', fontSize:'11px', textAlign:'center', marginTop:'12px' }}>
              Last updated: {new Date(task.updatedAt).toLocaleString('en-IN')}
            </p>
          )}
        </div>

        <p style={{ color:'#334155', fontSize:'11px', textAlign:'center', marginTop:'20px' }}>
          India Business Suite · IBS CRM
        </p>
      </div>
    </div>
  )
}
