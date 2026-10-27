import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setPasswordFromLink } from '../../lib/session'
import { useAuth } from '../../context/AuthContext'
import { APP_VERSION_LABEL } from '../../version'
import IBSLogo from '../common/IBSLogo'

const inp = 'w-full px-4 py-3 rounded-xl text-white placeholder-slate-500 bg-slate-800 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-sm'

// Where the one-time link from the administrator lands: choose a password, and you are signed in.
export default function SetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => { if (user) navigate('/', { replace: true }) }, [user, navigate])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (pw.length < 8) { setError('Use at least 8 characters.'); return }
    if (pw !== pw2) { setError('The two passwords are not the same.'); return }
    setBusy(true)
    try { await setPasswordFromLink(token, pw) }
    catch (err) { setError(err.message || 'Could not set the password.') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #0a0f1e 0%, #0f172a 50%, #0d1a3a 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ marginBottom: '36px' }}><IBSLogo size={80} showText={true} light={true} /></div>
      <div style={{ width: '100%', maxWidth: '400px', background: 'rgba(30,41,59,0.85)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '32px 28px', boxShadow: '0 25px 60px rgba(0,0,0,0.4)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#f1f5f9', textAlign: 'center' }}>Choose your password</h2>
        <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', marginBottom: '20px' }}>This link works once. After this you sign in with your email and this password.</p>
        {!token ? (
          <p style={{ color: '#fca5a5', fontSize: '13px', textAlign: 'center' }}>This link is incomplete. Ask your administrator for a new one.</p>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {error && <div style={{ padding: '12px 14px', background: 'rgba(185,28,28,0.2)', border: '1px solid rgba(185,28,28,0.5)', borderRadius: '10px', color: '#fca5a5', fontSize: '13px' }}>{error}</div>}
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="New password (8+ characters)" autoComplete="new-password" className={inp} disabled={busy} required />
            <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Type it again" autoComplete="new-password" className={inp} disabled={busy} required />
            <button type="submit" disabled={busy} style={{ padding: '13px', background: 'linear-gradient(135deg, #4F46E5, #7C3AED)', color: '#fff', fontWeight: 700, fontSize: '15px', border: 'none', borderRadius: '12px', cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Saving…' : 'Save password and sign in'}
            </button>
          </form>
        )}
      </div>
      <p style={{ marginTop: '24px', color: '#334155', fontSize: '11px' }}>{APP_VERSION_LABEL}</p>
    </div>
  )
}
