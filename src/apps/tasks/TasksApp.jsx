import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import TasksHome from './pages/TasksHome'

export default function TasksApp() {
  return (
    <div className="h-full overflow-auto bg-slate-50">
      <Routes>
        <Route path="/"    element={<TasksHome />} />
        <Route path="*"    element={<Navigate to="/tasks" replace />} />
      </Routes>
    </div>
  )
}
