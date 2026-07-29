/**
 * IBS CRM — Business Workflow Integration v1
 * src/apps/crm/components/CreateProjectModal.jsx
 *
 * Modal for manually creating a Project from a Won CRM Deal.
 *
 * Behaviour
 * ─────────
 * • Duplicate guard: if deal.projectId already set, shows a read-only info panel
 *   instead of the creation form — prevents double-creation.
 * • Prefills project name from deal.title (editable).
 * • Calls generateProjectNumber to assign the next sequential number.
 * • Writes one document to `projects` with all relationship IDs (no data copied).
 * • Patches `crm_deals/{deal.id}` with projectId, projectNumber, projectCreated.
 * • Calls onProjectCreated({ projectId, projectNumber, projectName }) on success
 *   so Pipeline.jsx can update local state without a re-fetch.
 *
 * Props
 * ─────
 * deal              {object}   The crm_deals document (must include .id)
 * user              {object}   Firebase Auth user (needs .uid)
 * onClose           {fn}       Close the modal (no changes)
 * onProjectCreated  {fn}       Called with { projectId, projectNumber, projectName }
 */

import React, { useState } from 'react'
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../../../lib/firebase-config'
import { generateProjectNumber } from '../../../lib/projectUtils'

const COMPANY_COLORS = {
  UIPL:   'bg-blue-100 text-blue-700',
  Wayzim: 'bg-purple-100 text-purple-700',
}

export default function CreateProjectModal({ deal, user, onClose, onProjectCreated }) {
  const navigate = useNavigate()
  const [projectName, setProjectName] = useState(deal.title || '')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  // ── Duplicate guard ────────────────────────────────────────────────────────
  // If the deal already has a linked project, show read-only info + navigate option.
  if (deal.projectId) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">📁</span>
            <h3 className="text-lg font-bold text-slate-800">Project Already Created</h3>
          </div>
          <p className="text-sm text-slate-500 mb-2">This deal is already linked to:</p>
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-sm font-mono font-bold text-green-700">📋 {deal.projectNumber}</p>
            {deal.projectName && (
              <p className="text-sm text-green-800 mt-0.5">{deal.projectName}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { onClose(); navigate(`/projects/plan/${deal.projectId}`) }}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
            >
              Open Project ↗
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Create project ─────────────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault()
    const name = projectName.trim()
    if (!name) { setError('Project name is required.'); return }

    setSaving(true)
    setError('')

    try {
      // Final duplicate check — in case two tabs raced
      if (deal.projectId) {
        setError('A project was already created for this deal. Close and refresh.')
        return
      }

      const projectNumber = await generateProjectNumber(deal.company || 'UIPL')
      const now           = new Date().toISOString()

      // ── Write project document ─────────────────────────────────────────────
      // Relationship IDs only — no copied customer/site/company records.
      const projectDoc = {
        projectNumber,
        projectName: name,

        // Relationship IDs (always prefer IDs over denormalised data)
        companyId:    deal.company      || 'UIPL',
        customerId:   deal.customerId   || '',
        customerName: deal.customerName || '',  // denorm for list display only
        siteId:       deal.siteId       || '',
        siteName:     deal.siteName     || '',  // denorm for list display only
        dealId:       deal.id,
        dealTitle:    deal.title        || '',
        dapId:        deal.dapId        || deal.id,  // DAP doc ID = dealId in sales_engineering_dap

        // Metadata
        createdBy:     user.uid,
        status:        'active',
        contractValue: deal.valueINR || Number(deal.value) || 0,
        notes:         deal.notes || '',
        createdAt:     now,
      }

      const projRef = await addDoc(collection(db, 'projects'), projectDoc)

      // ── Patch crm_deals to link the project ───────────────────────────────
      await updateDoc(doc(db, 'crm_deals', deal.id), {
        projectId:      projRef.id,
        projectNumber,
        projectName:    name,
        projectCreated: true,
        updatedAt:      now,
      })

      // Notify parent to update local state — no re-fetch needed
      onProjectCreated({
        projectId:   projRef.id,
        projectNumber,
        projectName: name,
      })

    } catch (err) {
      const msg = err.message || ''
      if (msg.toLowerCase().includes('permission')) {
        setError('Permission denied. Contact your administrator.')
      } else {
        setError(`Project creation failed: ${msg}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const company    = deal.company || 'UIPL'
  const colorClass = COMPANY_COLORS[company] || 'bg-slate-100 text-slate-600'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">📁</span>
            <h3 className="text-lg font-bold text-slate-800">Create Project</h3>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Deal summary — read-only context */}
        <div className="bg-slate-50 rounded-xl p-3 mb-4 text-sm space-y-1 border border-slate-200">
          <p className="font-semibold text-slate-800 leading-snug">{deal.title}</p>
          {deal.customerName && (
            <p className="text-slate-500">
              <span className="text-slate-400">Customer:</span> {deal.customerName}
              {deal.endCustomerName && deal.endCustomerName !== deal.customerName && (
                <span className="text-slate-400"> → {deal.endCustomerName}</span>
              )}
            </p>
          )}
          {deal.siteName && (
            <p className="text-slate-500">
              <span className="text-slate-400">Site:</span> 📍 {deal.siteName}
            </p>
          )}
          <div className="flex items-center gap-2 pt-0.5">
            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${colorClass}`}>
              {company}
            </span>
            <span className="text-xs text-green-700 font-semibold bg-green-50 px-2 py-0.5 rounded-lg border border-green-200">
              ✅ Won
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              disabled={saving}
              autoFocus
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-slate-50"
              placeholder="Project name…"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              ⚠ {error}
            </div>
          )}

          <p className="text-xs text-slate-400 leading-relaxed">
            A project number (e.g. {company}-{new Date().getFullYear()}-001) will be assigned automatically.
            The project will appear in the <strong>Projects → Project Register</strong> module
            with all deal references intact.
          </p>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
            >
              {saving ? '⏳ Creating…' : '📁 Create Project'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
