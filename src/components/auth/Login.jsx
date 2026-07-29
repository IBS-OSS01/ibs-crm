import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../../lib/firebase-config'
import { useAuth } from '../../context/AuthContext'
import { APP_VERSION_LABEL } from '../../version'
import IBSLogo from '../common/IBSLogo'

const inp = `
  w-full px-4 py-3 rounded-xl text-white placeholder-slate-500
  bg-slate-800 border border-slate-700
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
  transition text-sm
`

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [resetMode, setResetMode]       = useState(false)
  const [resetEmail, setResetEmail]     = useState('')
  const [resetSending, setResetSending] = useState(false)
  const [resetMessage, setResetMessage] = useState('')
  const navigate = useNavigate()
  const { disabledMessage, clearDisabledMessage } = useAuth()

  const handleEmailLogin = async (e) => {
    e.preventDefault()
    setError('')
    clearDisabledMessage()
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      navigate('/')
    } catch {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    setResetMessage('')
    setResetSending(true)
    try {
      await sendPasswordResetEmail(auth, resetEmail)
    } catch {}
    finally {
      setResetMessage('If that email has an account, a reset link has been sent. Check your inbox and spam folder.')
      setResetSending(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #0a0f1e 0%, #0f172a 50%, #0d1a3a 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Subtle background glow blobs */}
      <div style={{
        position: 'absolute', top: '-80px', left: '50%', transform: 'translateX(-50%)',
        width: '480px', height: '480px',
        background: 'radial-gradient(circle, rgba(29,78,216,0.18) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-60px', right: '-60px',
        width: '320px', height: '320px',
        background: 'radial-gradient(circle, rgba(79,70,229,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* ── Logo ── */}
      <div style={{ marginBottom: '36px' }}>
        <IBSLogo size={80} showText={true} light={true} />
      </div>

      {/* ── Card ── */}
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'rgba(30,41,59,0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '20px',
        padding: '32px 28px',
        boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
      }}>
        {(error || disabledMessage) && !resetMode && (
          <div style={{
            marginBottom: '16px', padding: '12px 14px',
            background: 'rgba(185,28,28,0.2)', border: '1px solid rgba(185,28,28,0.5)',
            borderRadius: '10px', color: '#fca5a5', fontSize: '13px', lineHeight: '1.5',
          }}>
            {error || disabledMessage}
          </div>
        )}

        {!resetMode ? (
          <>
            <h2 style={{
              margin: '0 0 20px', fontSize: '18px', fontWeight: 700,
              color: '#f1f5f9', fontFamily: "'Inter', 'Segoe UI', sans-serif", textAlign: 'center',
            }}>
              Sign In
            </h2>

            <form onSubmit={handleEmailLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} autoComplete="on">
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  Email
                </label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com" autoComplete="email"
                  className={inp} disabled={loading} required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  Password
                </label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" autoComplete="current-password"
                  className={inp} disabled={loading} required
                />
              </div>

              <button
                type="submit" disabled={loading}
                style={{
                  marginTop: '4px', padding: '13px',
                  background: loading ? '#1e3a8a' : 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                  color: '#fff', fontWeight: 700, fontSize: '15px',
                  border: 'none', borderRadius: '12px', cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s', boxShadow: '0 4px 16px rgba(29,78,216,0.4)',
                  fontFamily: "'Inter', 'Segoe UI', sans-serif",
                }}
              >
                {loading ? 'Signing in…' : 'Sign In →'}
              </button>
            </form>

            <button
              type="button"
              onClick={() => { setResetMode(true); setResetEmail(email); setResetMessage(''); setError(''); clearDisabledMessage() }}
              style={{
                display: 'block', width: '100%', marginTop: '16px', padding: '8px',
                background: 'none', border: 'none', color: '#a5b4fc',
                fontSize: '13px', cursor: 'pointer', fontFamily: "'Inter', 'Segoe UI', sans-serif",
              }}
            >
              Forgot password?
            </button>
          </>
        ) : (
          <>
            <h2 style={{
              margin: '0 0 8px', fontSize: '18px', fontWeight: 700,
              color: '#f1f5f9', fontFamily: "'Inter', 'Segoe UI', sans-serif", textAlign: 'center',
            }}>
              Reset Password
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', marginBottom: '20px' }}>
              Enter your account email — we'll send a reset link.
            </p>

            <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <input
                type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                placeholder="you@company.com" autoComplete="email"
                className={inp} disabled={resetSending} required
              />

              {resetMessage && (
                <div style={{
                  padding: '12px 14px',
                  background: 'rgba(21,128,61,0.2)', border: '1px solid rgba(21,128,61,0.5)',
                  borderRadius: '10px', color: '#86efac', fontSize: '13px', lineHeight: '1.5',
                }}>
                  {resetMessage}
                </div>
              )}

              <button
                type="submit" disabled={resetSending}
                style={{
                  padding: '13px',
                  background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                  color: '#fff', fontWeight: 700, fontSize: '15px',
                  border: 'none', borderRadius: '12px', cursor: resetSending ? 'not-allowed' : 'pointer',
                  fontFamily: "'Inter', 'Segoe UI', sans-serif",
                }}
              >
                {resetSending ? 'Sending…' : 'Send Reset Link'}
              </button>

              <button
                type="button"
                onClick={() => { setResetMode(false); setResetMessage('') }}
                style={{
                  padding: '12px', background: 'rgba(255,255,255,0.05)',
                  color: '#cbd5e1', fontWeight: 600, fontSize: '14px',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
                  cursor: 'pointer', fontFamily: "'Inter', 'Segoe UI', sans-serif",
                }}
              >
                ← Back to Sign In
              </button>
            </form>
          </>
        )}
      </div>

      {/* Version */}
      <p style={{
        marginTop: '24px', color: '#334155', fontSize: '11px',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}>
        {APP_VERSION_LABEL}
      </p>
    </div>
  )
}