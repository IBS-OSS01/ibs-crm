import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, addDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'

// B2B solutions: line items are free-text descriptions (not a product catalog).
// The company field scopes the order to UIPL or Wayzim.
const COMPANIES = ['UIPL', 'Wayzim']
const emptyLine = { description: '', qty: 1, rate: 0 }

export default function NewOrder() {
  const navigate = useNavigate()
  const { user, userProfile } = useAuth()
  const isAdmin = userProfile?.role === 'admin'
  const userCompanies = userProfile?.companies || ['UIPL']
  const canSelectCompany = isAdmin || userCompanies.length > 1
  const defaultCompany = userCompanies[0] || 'UIPL'

  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [customerId, setCustomerId] = useState('')
  const [company, setCompany] = useState(defaultCompany)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState([{ ...emptyLine }])
  const [amountPaid, setAmountPaid] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const custSnap = await getDocs(collection(db, 'crm_customers'))
      const custData = []
      custSnap.forEach(d => custData.push({ id: d.id, ...d.data() }))
      custData.sort((a, b) => (a.shopName || '').localeCompare(b.shopName || ''))
      // Only show customers from the user's assigned companies
      const visible = isAdmin
        ? custData
        : custData.filter(c => !c.company || userCompanies.includes(c.company))
      setCustomers(visible.filter(c => c.active !== false))
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleCustomerChange = (cId) => {
    setCustomerId(cId)
    const cust = customers.find(c => c.id === cId)
    if (cust?.company) setCompany(cust.company)
  }

  const updateLine = (idx, patch) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }

  const addLine = () => setLines(prev => [...prev, { ...emptyLine }])
  const removeLine = (idx) => setLines(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))

  const lineAmount = (l) => (Number(l.qty) || 0) * (Number(l.rate) || 0)
  const totalAmount = lines.reduce((sum, l) => sum + lineAmount(l), 0)

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!customerId) { setError('Please select a customer.'); return }
    const validLines = lines.filter(l => l.description.trim() && Number(l.qty) > 0)
    if (validLines.length === 0) { setError('Add at least one line item with a description.'); return }

    setSaving(true)
    try {
      const customer = customers.find(c => c.id === customerId)
      const order = {
        customerId,
        customerName: customer?.shopName || '',
        company: company || defaultCompany,
        date,
        items: validLines.map(l => ({
          description: l.description,
          qty: Number(l.qty) || 0,
          rate: Number(l.rate) || 0,
          amount: lineAmount(l),
        })),
        totalAmount,
        amountPaid: Number(amountPaid) || 0,
        notes,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      }
      await addDoc(collection(db, 'crm_orders'), order)
      navigate('/crm/orders')
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">New Order</h2>
        <p className="text-slate-500 text-sm">Record a B2B sale or service agreement with a customer</p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {customers.length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
          No customers yet — add one under Customers before creating an order.
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5 space-y-5">
        <div className={`grid gap-4 ${canSelectCompany ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer *</label>
            <select value={customerId} onChange={e => handleCustomerChange(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required>
              <option value="">Select a customer...</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.shopName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {canSelectCompany && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
              <select value={company} onChange={e => setCompany(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {(isAdmin ? COMPANIES : userCompanies).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Line Items</label>
          <div className="space-y-2">
            {lines.map((l, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input type="text" value={l.description} onChange={e => updateLine(idx, { description: e.target.value })}
                  placeholder="Description (service / solution)"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" value={l.qty} onChange={e => updateLine(idx, { qty: e.target.value })}
                  min="1" placeholder="Qty"
                  className="w-20 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" value={l.rate} onChange={e => updateLine(idx, { rate: e.target.value })}
                  min="0" step="0.01" placeholder="Rate (Rs)"
                  className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="w-28 text-right text-sm text-slate-700 flex-shrink-0">
                  Rs{lineAmount(l).toLocaleString('en-IN')}
                </span>
                <button type="button" onClick={() => removeLine(idx)} disabled={lines.length === 1}
                  className="text-red-500 hover:text-red-700 disabled:text-slate-300 px-1 flex-shrink-0">x</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addLine}
            className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium">
            + Add line
          </button>
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-3">
          <div className="text-right">
            <p className="text-sm text-slate-500">Order Total</p>
            <p className="text-xl font-bold text-slate-900 tracking-tight">Rs{totalAmount.toLocaleString('en-IN')}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Amount Paid Now (Rs)</label>
            <input type="number" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
              min="0" step="0.01" placeholder="0 if fully on credit"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Order'}
          </button>
          <button type="button" onClick={() => navigate('/crm/orders')}
            className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
