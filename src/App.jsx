import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import Login from './components/auth/Login.jsx'
import Layout from './components/layout/Layout.jsx'
import IBSLogo from './components/common/IBSLogo.jsx'
import PublicTaskView from './pages/PublicTaskView.jsx'

function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading) return (
    <div style={{
      minHeight:'100vh',
      background:'linear-gradient(160deg,#0a0f1e 0%,#0f172a 50%,#0d1a3a 100%)',
      display:'flex', alignItems:'center', justifyContent:'center',
      flexDirection:'column', gap:'28px',
    }}>
      <IBSLogo size={72} showText={true} light={true} />
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'12px' }}>
        <div style={{ width:'32px', height:'32px', border:'3px solid #1e3a8a', borderTop:'3px solid #3b82f6', borderRadius:'50%', animation:'spin 0.9s linear infinite' }} />
        <p style={{ color:'#475569', fontFamily:"'Segoe UI',Arial,sans-serif", fontSize:'12px', letterSpacing:'0.5px' }}>
          Loading…
        </p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return <Layout />
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/task-view/:token" element={<PublicTaskView />} />
          <Route path="/*" element={<ProtectedRoute />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
