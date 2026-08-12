import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, getDoc, addDoc, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import { useUsers } from '../../../lib/useUsers'
import { CRM_TO_SE } from '../../../lib/stageMapping'
import { generateProjectNumber } from '../../../lib/projectUtils'
import MeetingNotesModal from '../components/MeetingNotesModal.jsx'
import PipelineImportModal from '../components/PipelineImportModal.jsx'
import ActivityFeedModal from '../components/ActivityFeedModal.jsx'
import CompetitorModal from '../components/CompetitorModal.jsx'
import DealTasksModal  from '../components/DealTasksModal.jsx'
import CreateProjectModal from '../components/CreateProjectModal.jsx'
import UserSelector from '../../../components/common/UserSelector.jsx'
import RequestUserModal from '../../../components/common/RequestUserModal.jsx'

// B2B sales pipeline stages — lead → prebid → bid → closing → hold | closed (won/lost/rejected/nobid)
const STAGES = [
  { id: 'lead',     label: 'Lead',     cls: 'border-slate-300',  color: 'bg-slate-100 text-slate-600' },
  { id: 'prebid',   label: 'Pre-bid',  cls: 'border-blue-300',   color: 'bg-blue-100 text-blue-700' },
  { id: 'bid',      label: 'Bid',      cls: 'border-amber-300',  color: 'bg-amber-100 text-amber-700' },
  { id: 'closing',  label: 'Closing',  cls: 'border-purple-300', color: 'bg-purple-100 text-purple-700' },
  { id: 'hold',     label: 'On Hold',  cls: 'border-cyan-300',   color: 'bg-cyan-100 text-cyan-700' },
  { id: 'won',      label: 'Won',      cls: 'border-green-300',  color: 'bg-green-100 text-green-700' },
  { id: 'lost',     label: 'Lost',     cls: 'border-red-300',    color: 'bg-red-100 text-red-700' },
  { id: 'rejected', label: 'Rejected', cls: 'border-orange-300', color: 'bg-orange-100 text-orange-700' },
  { id: 'nobid',    label: 'No Bid',   cls: 'border-slate-400',  color: 'bg-slate-200 text-slate-500' },
]
const CLOSED_STAGES = ['won', 'lost', 'rejected', 'nobid']
// Kanban shows 6 columns; last column groups all 4 closed sub-states
const KANBAN_COLS = [
  { key: 'lead',    label: 'Lead',     stageIds: ['lead'],                          cls: 'border-slate-300' },
  { key: 'prebid',  label: 'Pre-bid',  stageIds: ['prebid'],                        cls: 'border-blue-300' },
  { key: 'bid',     label: 'Bid',      stageIds: ['bid'],                           cls: 'border-amber-300' },
  { key: 'closing', label: 'Closing',  stageIds: ['closing'],                       cls: 'border-purple-300' },
  { key: 'hold',    label: 'On Hold',  stageIds: ['hold'],                          cls: 'border-cyan-300' },
  { key: 'closed',  label: 'Closed',   stageIds: ['won','lost','rejected','nobid'],  cls: 'border-green-300', isGroup: true },
]

const COMPANIES = ['UIPL', 'Wayzim']
const COMPANY_LABELS = { UIPL: 'UIPL', Wayzim: 'Wayzim Technology Co Ltd' }
const COMPANY_COLORS = { UIPL: 'bg-blue-100 text-blue-700', Wayzim: 'bg-purple-100 text-purple-700' }
const CURRENCIES = ['INR', 'USD', 'CNY']
const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', CNY: '¥' }
// Default FX rates (INR per 1 unit). Refreshed from frankfurter.app on load.
const DEFAULT_FX = { INR: 1, USD: 84, CNY: 11.5 }
const today = () => new Date().toISOString().slice(0, 10)

// Opportunity names used to be free-typed and drifted inconsistent across the
// team. Build it instead from the structured fields that actually identify
// the opportunity: Customer / Site / Product-solution / Throughput / Notes.
const buildOpportunityTitle = (f, customer, site) => {
  const parts = []
  if (customer?.shopName)            parts.push(customer.shopName)
  if (site?.siteName)                parts.push(site.siteName)
  if ((f.products || []).length)     parts.push(f.products.join('/'))
  if (f.throughputPPH)               parts.push(`${Number(f.throughputPPH).toLocaleString()} PPH`)
  if (f.notes?.trim())               parts.push(f.notes.trim())
  return parts.join(' — ')
}

// AY = Calendar Year: AY 2026 = Jan 1, 2026 – Dec 31, 2026
const currentAYYear  = () => new Date().getFullYear()
const ayLabel        = (y) => `AY ${y}`
const ayStart        = (y) => `${y}-01-01`
const ayEnd          = (y) => `${y}-12-31`
const buildAYOptions = () => {
  const cur = currentAYYear()
  return [cur - 3, cur - 2, cur - 1, cur, cur + 1].map(y => ({
    year: y, label: ayLabel(y), start: ayStart(y), end: ayEnd(y),
  }))
}
const AY_OPTIONS = buildAYOptions()
const CURRENT_AY = currentAYYear()
// Products / solutions offered in this opportunity — admin-editable via the
// "⚙ Manage list" button on the deal form (stored in company_settings/product_catalog).
// This is the seed used the first time that doc doesn't exist yet.
const DEFAULT_PRODUCTS = [
  'Linear Sorter', 'Cross Belt Sorter', 'Pivot Wheel Sorter', 'Roller Conveyor',
  'Belt Conveyor', 'DWS', 'FAST Sorter', 'Mini Load', 'Racking', 'Cranes', '4 Way Shuttle',
]

// Deal types — what kind of opportunity is this?
const DEAL_TYPES = [
  { id: 'new_business', label: 'New Business',  color: 'bg-blue-100 text-blue-700' },
  { id: 'spares',       label: 'Spares Supply', color: 'bg-orange-100 text-orange-700' },
  { id: 'service_amc',  label: 'Service / AMC', color: 'bg-teal-100 text-teal-700' },
  { id: 'upgradation',  label: 'Upgradation',   color: 'bg-indigo-100 text-indigo-700' },
]
// Reasons for no competition
const NO_COMPETITION_REASONS = [
  'Sole supplier / proprietary product',
  'Existing relationship / preferred vendor',
  'Emergency / urgent order',
  'Follow-on order from past project',
  'Rate contract / framework agreement',
  'Other',
]
const DEAL_TYPE_OBJ = (id) => DEAL_TYPES.find(t => t.id === id) || DEAL_TYPES[0]

const emptyForm = {
  title: '', customerId: '', endCustomerId: '', siteId: '', warehouseId: '', value: '', currency: 'INR', stage: 'lead',
  notes: '', company: 'UIPL', identifiedDate: '', closingDate: '',
  salesManagerId: '', salesManagerName: '',
  teamMembers: [],
  assignedUserIds: [],
  dealType: 'new_business',          // new_business | spares | service_amc | upgradation
  competitionType: 'competitive',    // competitive | no_competition
  noCompetitionReason: '',
  linkedDealId: '',                  // for spares/service — parent won deal
  linkedDealTitle: '',
  linkedProjectNumber: '',
  products: [],                      // string[] — from the admin-managed catalog or custom
  throughputPPH: '',                 // throughput requirement in parcels-per-hour
}

// generateProjectNumber is now in src/lib/projectUtils.js (imported above)

export default function Pipeline() {
  const { user, userProfile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = userProfile?.role === 'admin'
  const role    = userProfile?.role || ''

  // sales_assistant: Wayzim-only, view-only (cannot move stage or edit)
  const isSalesAssistant = role === 'sales_assistant'

  // All CRM users (except sales_assistant) can see both UIPL and Wayzim
  const canSeeUIPL = !isSalesAssistant

  // solution_manager and sales_director see ALL Wayzim deals by default (no assignment needed)
  const isWideViewer = role === 'solution_manager' || role === 'sales_director'

  // Who can create/edit deals
  const canEdit = isAdmin || role === 'sales_manager' || role === 'project_manager'
  // Safe UID — user is null until Firebase Auth resolves
  const uid = user?.uid || ''

  const userCompanies = userProfile?.companies || ['UIPL']
  const canSelectCompany = isAdmin
  // Default company: non-UIPL users default to Wayzim
  const defaultCompany = canSeeUIPL ? (userCompanies[0] || 'UIPL') : 'Wayzim'
  const { users, refreshUsers } = useUsers()   // session cache — zero Firestore reads (until manually refreshed)
  const [deals, setDeals] = useState([])

  // Deals whose `stage` doesn't match any known Kanban column (e.g. legacy
  // values like "negotiation"/"proposal" from an old import). These fully
  // exist in Firestore but never render on the board since no column claims
  // them — they were never deleted, just structurally invisible.
  const VALID_STAGE_IDS = STAGES.map(s => s.id)
  const [fixingStageId, setFixingStageId] = useState(null)
  const mismatchedStageDeals = useMemo(
    () => deals.filter(d => d.stage && !VALID_STAGE_IDS.includes(d.stage)),
    [deals]
  )
  const fixDealStage = async (dealId, newStage) => {
    setFixingStageId(dealId)
    try {
      await updateDoc(doc(db, 'crm_deals', dealId), { stage: newStage })
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage } : d))
    } catch (e) { console.error(e) }
    finally { setFixingStageId(null) }
  }
  // Best-guess suggestion per legacy value — admin can override before applying
  const suggestStage = (oldStage) => {
    const s = (oldStage || '').toLowerCase()
    if (s.includes('negotiat')) return 'closing'
    if (s.includes('propos'))   return 'bid'
    if (s.includes('quali'))    return 'prebid'
    return 'lead'
  }

  const [customers, setCustomers] = useState([])
  const [sites, setSites] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [productCatalog, setProductCatalog] = useState(DEFAULT_PRODUCTS)
  const [showProductAdmin, setShowProductAdmin] = useState(false)
  const [newProductInput, setNewProductInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState(null)
  const [companyFilter, setCompanyFilter] = useState(isSalesAssistant ? 'Wayzim' : 'all')
  const [salesFilter, setSalesFilter] = useState('all')
  const [searchQ, setSearchQ] = useState('')
  const [meetingDeal, setMeetingDeal] = useState(null)        // deal whose notes modal is open
  const [activityDeal, setActivityDeal] = useState(null)     // deal whose activity feed is open
  const [competitorDeal, setCompetitorDeal] = useState(null) // deal whose competitor panel is open
  const [tasksDeal, setTasksDeal]           = useState(null) // deal whose team/tasks modal is open
  const [showImport, setShowImport]         = useState(false)
  const [createProjectDeal, setCreateProjectDeal] = useState(null) // deal for CreateProjectModal
  const [displayCurrency, setDisplayCurrency] = useState('INR')
  const [fxRates, setFxRates] = useState(DEFAULT_FX)          // INR per 1 unit of each currency
  const [ratesDate, setRatesDate] = useState('')
  const [ratesLoading, setRatesLoading] = useState(false)
  const [ayFilter, setAyFilter] = useState(CURRENT_AY)   // default: current AY
  const [pendingTeamUserId, setPendingTeamUserId] = useState(null) // UserSelector value for "add team member"
  const [showRequestUser, setShowRequestUser]     = useState(false)
  const [requestPrefillName, setRequestPrefillName] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { load(); loadFxRates() }, [])

  // Fetch live FX rates — fawazahmed0 currency API via jsDelivr CDN (CORS-safe, no API key)
  // Returns { date, inr: { usd: 0.01191, cny: 0.08612 } } — value of 1 INR in that currency
  const loadFxRates = async () => {
    setRatesLoading(true)
    try {
      const res = await fetch(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/inr.json',
        { cache: 'no-cache' }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const inr = data.inr || {}
      setFxRates({
        INR: 1,
        USD: inr.usd ? parseFloat((1 / inr.usd).toFixed(4)) : DEFAULT_FX.USD,
        CNY: inr.cny ? parseFloat((1 / inr.cny).toFixed(4)) : DEFAULT_FX.CNY,
      })
      setRatesDate(data.date || new Date().toISOString().slice(0, 10))
    } catch (e) {
      console.warn('FX fetch failed, using defaults:', e.message)
    } finally {
      setRatesLoading(false)
    }
  }

  // Convert value from its stored currency to the displayCurrency
  // fxRates[x] = INR per 1 unit of x
  const convertValue = (value, fromCurrency = 'INR') => {
    if (!value) return 0
    const inINR = Number(value) * (fxRates[fromCurrency] || 1)
    return inINR / (fxRates[displayCurrency] || 1)
  }

  // Format a value in the displayCurrency
  const fmtDisplay = (value) =>
    `${CURRENCY_SYMBOLS[displayCurrency] || ''}${Math.round(value).toLocaleString('en-IN')}`

  const load = async () => {
    try {
      // users loaded from session cache (useUsers) — no read here
      const [dealSnap, custSnap, siteSnap, whSnap, catalogSnap] = await Promise.all([
        getDocs(collection(db, 'crm_deals')),
        getDocs(collection(db, 'crm_customers')),
        getDocs(collection(db, 'crm_sites')),
        getDocs(collection(db, 'inventory_warehouses')),
        getDoc(doc(db, 'company_settings', 'product_catalog')),
      ])
      const dealData = []
      dealSnap.forEach(d => dealData.push({ id: d.id, ...d.data() }))
      const custData = []
      custSnap.forEach(d => custData.push({ id: d.id, ...d.data() }))
      custData.sort((a, b) => (a.shopName || '').localeCompare(b.shopName || ''))
      const siteData = []
      siteSnap.forEach(d => siteData.push({ id: d.id, ...d.data() }))
      const whData = []
      whSnap.forEach(d => whData.push({ id: d.id, ...d.data() }))
      setWarehouses(whData.filter(w => w.active !== false))
      setDeals(dealData)
      // All active customers are available to everyone — filtering by company broke
      // the edit form for Wayzim salespeople whose companies[] isn't set in their profile.
      setCustomers(custData.filter(c => c.active !== false))
      setSites(siteData)
      if (catalogSnap.exists() && Array.isArray(catalogSnap.data().products)) {
        setProductCatalog(catalogSnap.data().products)
      } else if (isAdmin) {
        // First run — seed it so the list is admin-editable from here on.
        setDoc(doc(db, 'company_settings', 'product_catalog'), { products: DEFAULT_PRODUCTS }).catch(() => {})
      }
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  // Admin-only: persist an edited Products/Solutions catalog to Firestore
  // (company_settings/product_catalog — same collection CompanySettings.jsx
  // uses, just a non-company doc id, so no rules change is needed).
  const saveProductCatalog = async (next) => {
    setProductCatalog(next)
    try {
      await setDoc(doc(db, 'company_settings', 'product_catalog'), { products: next, updatedAt: new Date().toISOString() })
    } catch (e) { console.error(e) }
  }
  const addCatalogProduct = () => {
    const val = newProductInput.trim()
    if (!val || productCatalog.includes(val)) { setNewProductInput(''); return }
    saveProductCatalog([...productCatalog, val])
    setNewProductInput('')
  }
  const removeCatalogProduct = (p) => saveProductCatalog(productCatalog.filter(x => x !== p))

  // On-demand pull of the latest data — deals/customers/sites created or edited
  // by other users, plus any team-member approvals, since we don't use live
  // Firestore listeners (keeps read costs predictable).
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([load(), refreshUsers()])
    } finally {
      setRefreshing(false)
    }
  }

  const resetForm = () => {
    setForm({ ...emptyForm, company: defaultCompany, identifiedDate: today(), closingDate: today() })
    setEditing(null); setError('')
  }

  // When sales manager changes, rebuild assignedUserIds and remove them from teamMembers
  const handleManagerChange = (uid) => {
    const u = users.find(x => x.id === uid)
    setForm(p => {
      const tm = (p.teamMembers || []).filter(t => t.userId !== uid)
      return {
        ...p,
        salesManagerId: uid,
        salesManagerName: u?.name || u?.email || '',
        teamMembers: tm,
        assignedUserIds: uid ? [uid, ...tm.map(t => t.userId)] : tm.map(t => t.userId),
      }
    })
  }

  const handleTeamMemberToggle = (u, checked) => {
    setForm(p => {
      const tm = checked
        ? [...(p.teamMembers || []), {
            userId:      u.id,
            name:        u.name || u.email,   // legacy compat
            userName:    u.name || u.email,
            userEmail:   u.email || '',
            roleSlug:    u.role || '',
            roleLabel:   u.role ? (u.role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : '',
            addedAt:     new Date().toISOString(),
            addedByName: '',  // filled once saved; creator context not available here
          }]
        : (p.teamMembers || []).filter(t => t.userId !== u.id)
      const ids = [...new Set([p.salesManagerId, ...tm.map(t => t.userId)].filter(Boolean))]
      return { ...p, teamMembers: tm, assignedUserIds: ids }
    })
  }

  const openNewDeal = (stageId) => {
    // Non-admins are auto-assigned as sales manager so the deal stays visible to them
    const selfId   = !isAdmin && uid ? uid : ''
    const selfName = !isAdmin && uid ? (userProfile?.name || userProfile?.email || '') : ''
    setForm({
      ...emptyForm,
      stage: stageId || 'lead',
      company: defaultCompany,
      identifiedDate: today(),
      closingDate: today(),
      salesManagerId:   selfId,
      salesManagerName: selfName,
      assignedUserIds:  selfId ? [selfId] : [],
    })
    setEditing(null)
    setShowForm(true)
  }

  const handleEdit = (d) => {
    setEditing(d.id)
    // Backward-compat: old records may have assignedToId (single person) — treat as sales manager
    const mgId = d.salesManagerId || d.assignedToId || ''
    const mgName = d.salesManagerName || d.assignedToName || ''
    const tm = d.teamMembers || []
    const ids = [...new Set([mgId, ...tm.map(t => t.userId)].filter(Boolean))]
    setForm({
      title: d.title || '', customerId: d.customerId || '', endCustomerId: d.endCustomerId || '',
      siteId: d.siteId || '', warehouseId: d.warehouseId || '', value: d.value ?? '', currency: d.currency || 'INR',
      stage: d.stage || 'lead', notes: d.notes || '', company: d.company || defaultCompany,
      identifiedDate: d.identifiedDate || today(), closingDate: d.closingDate || today(),
      salesManagerId: mgId, salesManagerName: mgName,
      teamMembers: tm, assignedUserIds: ids,
      dealType: d.dealType || 'new_business',
      competitionType: d.competitionType || 'competitive',
      noCompetitionReason: d.noCompetitionReason || '',
      linkedDealId: d.linkedDealId || '',
      linkedDealTitle: d.linkedDealTitle || '',
      linkedProjectNumber: d.linkedProjectNumber || '',
      products: d.products || [],
      throughputPPH: d.throughputPPH || '',
    })
    setShowForm(true)
  }

  // Auto-set company from selected customer's primary entity
  const handleCustomerChange = (customerId) => {
    const cust = customers.find(c => c.id === customerId)
    const custCompany = cust?.companies?.[0] || cust?.company || defaultCompany
    setForm(p => ({ ...p, customerId, siteId: '', company: custCompany }))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.customerId)   { setError('Customer is required.'); return }
    if (!form.siteId)       { setError('Site is required.'); return }
    if (!(form.products || []).length) { setError('At least one Product / Solution is required.'); return }
    if (!form.throughputPPH) { setError('Throughput is required.'); return }
    if (!form.notes.trim())  { setError('Additional details (Notes) are required.'); return }
    const customer = customers.find(c => c.id === form.customerId)
    const site     = sites.find(s => s.id === form.siteId)
    const title    = buildOpportunityTitle(form, customer, site)
    if (!title.trim()) { setError('Could not generate an opportunity name — check the fields above.'); return }
    setSaving(true)
    try {
      const endCustomer = form.endCustomerId ? customers.find(c => c.id === form.endCustomerId) : null
      const currency = form.currency || 'INR'
      const valueNum = Number(form.value) || 0
      const valueINR = Math.round(valueNum * (fxRates[currency] || 1))
      const payload = {
        title,
        customerId: form.customerId,
        customerName: customer?.shopName || '',
        endCustomerId: form.endCustomerId || '',
        endCustomerName: endCustomer?.shopName || '',
        siteId: form.siteId || '',
        siteName: site?.siteName || '',
        warehouseId: form.warehouseId || '',
        warehouseName: warehouses.find(w => w.id === form.warehouseId)?.name || form.warehouseId || '',
        value: valueNum,
        currency,
        valueINR,      // always INR equivalent — used by Finance & Dashboard
        stage: form.stage,
        seStage: CRM_TO_SE[form.stage] || 'concept_scoping',
        notes: form.notes,
        company: form.company || defaultCompany,
        identifiedDate: form.identifiedDate || today(),
        closingDate: form.closingDate || today(),
        salesManagerId: form.salesManagerId || '',
        salesManagerName: form.salesManagerName || '',
        teamMembers: form.teamMembers || [],
        assignedUserIds: form.assignedUserIds || [],
        dealType: form.dealType || 'new_business',
        competitionType: form.competitionType || 'competitive',
        noCompetitionReason: form.competitionType === 'no_competition' ? (form.noCompetitionReason || '') : '',
        linkedDealId: form.linkedDealId || '',
        linkedDealTitle: form.linkedDealTitle || '',
        linkedProjectNumber: form.linkedProjectNumber || '',
        products: form.products || [],
        throughputPPH: form.throughputPPH || '',
      }
      if (editing) {
        await updateDoc(doc(db, 'crm_deals', editing), { ...payload, updatedAt: new Date().toISOString() })
        setDeals(prev => prev.map(d => d.id === editing ? { ...d, ...payload } : d))
      } else {
        const newDeal = { ...payload, createdBy: user.uid, createdAt: new Date().toISOString() }
        const ref = await addDoc(collection(db, 'crm_deals'), newDeal)
        setDeals(prev => [...prev, { id: ref.id, ...newDeal }])
      }
      setShowForm(false)
      resetForm()
    } catch (err) { setError('Error: ' + err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (d) => {
    if (!window.confirm(`Delete the opportunity "${d.title}"?`)) return
    try {
      await deleteDoc(doc(db, 'crm_deals', d.id))
      setDeals(prev => prev.filter(x => x.id !== d.id))
    } catch (err) { setError('Error: ' + err.message) }
  }

  const handleClone = async (d) => {
    try {
      const clone = {
        title: d.title + ' (Copy)',
        customerId: d.customerId || '',
        customerName: d.customerName || '',
        endCustomerId: d.endCustomerId || '',
        endCustomerName: d.endCustomerName || '',
        dealType: d.dealType || 'new_business',
        competitionType: d.competitionType || 'competitive',
        noCompetitionReason: d.noCompetitionReason || '',
        linkedDealId: d.linkedDealId || '',
        linkedDealTitle: d.linkedDealTitle || '',
        linkedProjectNumber: d.linkedProjectNumber || '',
        siteId: d.siteId || '',
        siteName: d.siteName || '',
        warehouseId: d.warehouseId || '',
        warehouseName: d.warehouseName || '',
        value: d.value || 0,
        currency: d.currency || 'INR',
        valueINR: d.valueINR || d.value || 0,
        stage: 'lead',           // always restart clone from Lead
        notes: d.notes || '',
        company: d.company || defaultCompany,
        identifiedDate: today(),
        closingDate: d.closingDate || today(),
        salesManagerId: d.salesManagerId || d.assignedToId || '',
        salesManagerName: d.salesManagerName || d.assignedToName || '',
        teamMembers: d.teamMembers || [],
        assignedUserIds: d.assignedUserIds || (d.assignedToId ? [d.assignedToId] : []),
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
        // intentionally omit projectId / projectNumber — fresh opportunity
      }
      const ref = await addDoc(collection(db, 'crm_deals'), clone)
      setDeals(prev => [...prev, { id: ref.id, ...clone }])
    } catch (err) { setError('Clone failed: ' + err.message) }
  }

  // Called by MeetingNotesModal when a note is saved (possibly with stage update)
  const handleDealUpdate = (updatedDeal) => {
    setDeals(prev => prev.map(d => d.id === updatedDeal.id ? updatedDeal : d))
    setMeetingDeal(updatedDeal)   // keep modal open with fresh data
  }

  // Called by ActivityFeedModal when an activity is logged or deleted
  const handleActivityUpdate = (updatedDeal) => {
    setDeals(prev => prev.map(d => d.id === updatedDeal.id ? updatedDeal : d))
    setActivityDeal(updatedDeal)  // keep panel open with fresh data
  }

  // Called by CompetitorModal when competitors change
  const handleCompetitorUpdate = (updatedDeal) => {
    setDeals(prev => prev.map(d => d.id === updatedDeal.id ? updatedDeal : d))
    setCompetitorDeal(updatedDeal)
  }

  // Deduplicated competitor objects across all deals — latest updatedAt per name wins.
  // Passed to CompetitorModal so users can pick an existing competitor instead of re-entering.
  const allCompetitors = useMemo(() => {
    const map = {}
    deals.forEach(d => {
      ;(d.competitors || []).forEach(c => {
        if (c.name && (!map[c.name] || (c.updatedAt || '') > (map[c.name].updatedAt || ''))) {
          map[c.name] = c
        }
      })
    })
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
  }, [deals])

  // Download visible pipeline as CSV
  const handleDownload = () => {
    const allVisible = deals.filter(d => {
      if (ayFilter !== 'all' && d.closingDate) {
        const ayOpt = AY_OPTIONS.find(f => f.year === ayFilter)
        if (ayOpt && (d.closingDate < ayOpt.start || d.closingDate > ayOpt.end)) return false
      }
      if (searchQ.trim()) {
        const q = searchQ.toLowerCase()
        if (!d.title?.toLowerCase().includes(q) && !d.customerName?.toLowerCase().includes(q) && !d.projectNumber?.toLowerCase().includes(q)) return false
      }
      if (!isAdmin) {
        const ids = d.assignedUserIds || (d.assignedToId ? [d.assignedToId] : [])
        // Explicit assignment always wins — user sees any deal they're personally assigned to
        if (ids.includes(uid)) return true
        // Wide viewers (solution_manager, sales_director) see all deals of all companies
        if (isWideViewer) return true
        // All other non-admin roles: only explicitly assigned deals (both UIPL and Wayzim)
        return false
      }
      // Admin: all companies visible
      const matchCo = companyFilter === 'all' || d.company === companyFilter
      const ids = d.assignedUserIds || (d.assignedToId ? [d.assignedToId] : [])
      const matchSales = salesFilter === 'all' ? true
        : salesFilter === 'unassigned' ? ids.length === 0
        : ids.includes(salesFilter)
      return matchCo && matchSales
    })

    const headers = [
      'Title', 'Customer', 'Site', 'Stage', 'Value (₹)', 'Company',
      'Sales Manager', 'Team Members', 'Identified Date', 'Expected Close Date',
      'Days to Close', 'Project #', 'Notes', 'Last Meeting Date', 'Next Action',
    ]
    const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = allVisible.map(d => {
      const lastNote = [...(d.meetingNotes || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
      const daysToClose = d.closingDate
        ? Math.ceil((new Date(d.closingDate) - new Date()) / 86400000)
        : ''
      return [
        d.title,
        d.customerName || '',
        d.siteName || '',
        d.stage || 'lead',
        d.value || 0,
        d.company || 'UIPL',
        d.salesManagerName || d.assignedToName || '',
        (d.teamMembers || []).map(t => t.name).join('; '),
        d.identifiedDate || '',
        d.closingDate || '',
        daysToClose,
        d.projectNumber || '',
        d.notes || '',
        lastNote?.date || '',
        lastNote?.nextAction || '',
      ].map(escCsv).join(',')
    })

    const csv = [headers.map(escCsv).join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `Pipeline-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const moveStage = async (dealId, stage) => {
    const deal = deals.find(d => d.id === dealId)
    if (!deal || deal.stage === stage) return
    try {
      const seStage = CRM_TO_SE[stage] || 'concept_scoping'
      await updateDoc(doc(db, 'crm_deals', dealId), { stage, seStage, updatedAt: new Date().toISOString() })
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage, seStage } : d))

      // UIPL won → auto-create Finance project with project number (only once).
      // Wayzim won → site is promoted to project phase, but NO Finance project is created
      //              (Wayzim deals are tracked for project management only, not Finance).
      const isUIPL = !deal.company || deal.company === 'UIPL'

      if (stage === 'won' && !deal.projectNumber && isUIPL) {
        const projectNumber = await generateProjectNumber('UIPL')
        const warehouse = warehouses.find(w => w.id === deal.warehouseId)
        const projectDoc = {
          projectNumber, dealId, dealTitle: deal.title,
          customerId: deal.customerId || '', customerName: deal.customerName || '',
          company: 'UIPL',
          siteId: deal.siteId || '', siteName: deal.siteName || '',
          warehouseId: deal.warehouseId || '', warehouseName: warehouse?.name || deal.warehouseId || '',
          contractValue: deal.valueINR || Number(deal.value) || 0,   // always INR
          status: 'active', notes: deal.notes || '',
          createdAt: new Date().toISOString(), createdBy: user.uid,
        }
        const projRef = await addDoc(collection(db, 'projects'), projectDoc)
        // Link project number back onto the deal
        await updateDoc(doc(db, 'crm_deals', dealId), { projectId: projRef.id, projectNumber })
        setDeals(prev => prev.map(d => d.id === dealId ? { ...d, projectId: projRef.id, projectNumber, stage } : d))
        // Promote the linked site to 'project' status
        if (deal.siteId) {
          const siteUpdate = { status: 'project', projectId: projRef.id, projectNumber, updatedAt: new Date().toISOString() }
          await updateDoc(doc(db, 'crm_sites', deal.siteId), siteUpdate)
          setSites(prev => prev.map(s => s.id === deal.siteId ? { ...s, ...siteUpdate } : s))
        }
      } else if (stage === 'won' && deal.siteId) {
        // Wayzim won (or UIPL already has project number) — promote site to project phase only
        const site = sites.find(s => s.id === deal.siteId)
        if (site && (site.status || 'lead') === 'lead') {
          const siteUpdate = {
            status: 'project',
            projectId: deal.projectId || '',
            projectNumber: deal.projectNumber || '',
            updatedAt: new Date().toISOString(),
          }
          await updateDoc(doc(db, 'crm_sites', deal.siteId), siteUpdate)
          setSites(prev => prev.map(s => s.id === deal.siteId ? { ...s, ...siteUpdate } : s))
        }
      }
    } catch (err) { setError('Error: ' + err.message) }
  }

  const onDrop = (e, stageId) => {
    e.preventDefault()
    if (dragId) moveStage(dragId, stageId)
    setDragId(null)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  const previewTitle = buildOpportunityTitle(
    form,
    customers.find(c => c.id === form.customerId),
    sites.find(s => s.id === form.siteId)
  )

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Pipeline</h2>
          <p className="text-slate-500 text-sm">Drag cards between stages · click 📋 to view activity feed</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRefresh} disabled={refreshing}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition disabled:opacity-50"
            title="Pull the latest deals, customers, and team changes from other users">
            {refreshing ? '⏳ Refreshing…' : '🔄 Refresh'}
          </button>
          {isAdmin && (
            <button onClick={handleDownload}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition"
              title="Download pipeline as CSV">
              📥 Download
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowImport(true)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition"
              title="Import from CSV / Lark export">
              📂 Import
            </button>
          )}
          {canEdit && (
            <button onClick={() => openNewDeal('lead')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
              + Add Opportunity
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex-shrink-0">{error}</div>}

      {isAdmin && mismatchedStageDeals.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm flex-shrink-0 space-y-2">
          <p className="font-bold text-amber-800">
            ⚠️ {mismatchedStageDeals.length} deal{mismatchedStageDeals.length > 1 ? 's' : ''} have a stage that doesn't match any board column, so they're invisible on the board below (they still exist and aren't lost — just pick the right column for each):
          </p>
          <div className="bg-white rounded-lg border border-amber-200/70 divide-y divide-amber-100">
            {mismatchedStageDeals.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-800 truncate">{d.title || '(untitled)'}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {d.company || '—'} · currently stored as "<code className="text-amber-700">{d.stage}</code>"
                  </span>
                </div>
                <select
                  defaultValue={suggestStage(d.stage)}
                  onChange={e => fixDealStage(d.id, e.target.value)}
                  disabled={fixingStageId === d.id}
                  className="text-xs border border-slate-300 rounded-lg px-2 py-1 disabled:opacity-50"
                >
                  {STAGES.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + FY filter bar */}
      <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
          <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search opportunity, customer…"
            className="pl-8 pr-8 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64" />
          {searchQ && (
            <button onClick={() => setSearchQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">✕</button>
          )}
        </div>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">AY:</span>
        {/* AY dropdown */}
        <select value={ayFilter} onChange={e => setAyFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {AY_OPTIONS.map(ay => (
            <option key={ay.year} value={ay.year}>{ay.label}{ay.year === CURRENT_AY ? ' (Current)' : ''}</option>
          ))}
          <option value="all">All AY</option>
        </select>
        {ayFilter !== 'all' && ayFilter !== CURRENT_AY && (
          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
            ⚠ Past AY
          </span>
        )}
      </div>

      {/* Company + Salesperson filter bar */}
      <div className="flex items-center gap-4 flex-shrink-0 flex-wrap">
        {isSalesAssistant ? (
          <span className="px-3 py-1.5 text-sm font-medium bg-purple-600 text-white rounded-lg border border-purple-700">
            Wayzim (view only)
          </span>
        ) : (
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {['all', 'UIPL', 'Wayzim'].map(co => (
            <button key={co} onClick={() => setCompanyFilter(co)}
              className={`px-4 py-1.5 font-medium transition ${companyFilter === co
                ? co === 'UIPL' ? 'bg-blue-600 text-white' : co === 'Wayzim' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {co === 'all' ? 'All' : COMPANY_LABELS[co] || co}
            </button>
          ))}
        </div>
        )}
        {isAdmin && (
          <select value={salesFilter} onChange={e => setSalesFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All Team Members</option>
            <option value="unassigned">Unassigned</option>
            {users
              .filter(u => {
                const r = u.role || ''
                const mr = u.moduleRights || {}
                return ['admin','sales_manager','sales_director','sales_engineer','bid_coordinator','solution_manager'].includes(r)
                  || mr['CRM'] === 'edit' || mr['CRM'] === 'view'
                  || (u.departments || []).includes('CRM')
              })
              .map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        )}
        {!isAdmin && isWideViewer && (
          <span className="text-xs text-purple-600 bg-purple-50 px-3 py-1.5 rounded-lg font-medium">
            👁 Viewing all opportunities
          </span>
        )}
        {!isAdmin && !isWideViewer && (
          <span className="text-xs text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg">
            👤 Showing your assigned opportunities
          </span>
        )}
        {/* Currency display toggle */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">Show totals in:</span>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
            {CURRENCIES.map(c => (
              <button key={c} onClick={() => setDisplayCurrency(c)}
                className={`px-3 py-1.5 font-medium transition ${displayCurrency === c ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {CURRENCY_SYMBOLS[c]} {c}
              </button>
            ))}
          </div>
          <button onClick={loadFxRates} disabled={ratesLoading} title="Refresh live exchange rates"
            className="text-xs text-slate-500 hover:text-blue-600 bg-slate-100 hover:bg-slate-200 px-2 py-1.5 rounded-lg transition disabled:opacity-40">
            {ratesLoading ? '⏳' : '🔄'} {ratesDate ? `Rates ${ratesDate}` : 'Live rates'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-5 flex-shrink-0">
          <h3 className="font-bold text-slate-800 mb-4">{editing ? 'Edit Opportunity' : 'Add Opportunity'}</h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Opportunity Name <span className="text-slate-400 font-normal text-xs">(auto-generated from the fields below)</span>
              </label>
              <div className="w-full px-4 py-2 border border-dashed border-slate-300 rounded-lg text-sm bg-slate-50 text-slate-700 min-h-[2.5rem] flex items-center">
                {previewTitle || <span className="text-slate-400">Fill in Customer, Site, Products/Solutions, Throughput and Notes below…</span>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Customer * <span className="text-slate-400 font-normal text-xs">(who places the order / bills to)</span>
              </label>
              <select value={form.customerId} onChange={e => handleCustomerChange(e.target.value)} required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">No customer linked</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.shopName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                End Customer <span className="text-slate-400 font-normal text-xs">(site owner / final client, if different)</span>
              </label>
              <select value={form.endCustomerId} onChange={e => setForm(p => ({ ...p, endCustomerId: e.target.value, siteId: '' }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Same as customer</option>
                {customers.filter(c => c.id !== form.customerId).map(c => <option key={c.id} value={c.id}>{c.shopName}</option>)}
              </select>
              {form.endCustomerId && (
                <p className="text-xs text-amber-600 mt-1">
                  🔗 Subcontract: billing via {customers.find(c => c.id === form.customerId)?.shopName || '—'}, site owned by {customers.find(c => c.id === form.endCustomerId)?.shopName || '—'}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Site *</label>
              <select value={form.siteId} onChange={e => setForm(p => ({ ...p, siteId: e.target.value }))}
                disabled={!form.customerId && !form.endCustomerId} required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100">
                <option value="">No site linked</option>
                {/* Show sites for billing customer OR end customer */}
                {sites
                  .filter(s => s.customerId === form.customerId || (form.endCustomerId && s.customerId === form.endCustomerId))
                  .map(s => {
                    const owner = customers.find(c => c.id === s.customerId)
                    const tag = form.endCustomerId && s.customerId !== form.customerId ? ` (${owner?.shopName || 'end client'})` : ''
                    return <option key={s.id} value={s.id}>{s.siteName}{tag}</option>
                  })}
              </select>
              <p className="text-xs text-slate-400 mt-1">UIPL won opportunities auto-create a Finance project. Wayzim won opportunities promote the site only.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Supply Warehouse</label>
              <select value={form.warehouseId} onChange={e => setForm(p => ({ ...p, warehouseId: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">No warehouse linked</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
              </select>
              <p className="text-xs text-slate-400 mt-1">Warehouse that will supply materials for this project.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Opportunity Value</label>
              <div className="flex gap-2">
                <select value={form.currency || 'INR'} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-24">
                  {CURRENCIES.map(c => <option key={c} value={c}>{CURRENCY_SYMBOLS[c]} {c}</option>)}
                </select>
                <input type="number" value={form.value} onChange={e => setForm(p => ({ ...p, value: e.target.value }))} autoComplete="off"
                  min="0" placeholder="0" className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {form.currency && form.currency !== 'INR' && Number(form.value) > 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  ≈ ₹{Math.round(Number(form.value) * (fxRates[form.currency] || 1)).toLocaleString('en-IN')} INR
                  {ratesDate && <span className="ml-1">(rate: {ratesDate})</span>}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Stage</label>
              <select value={form.stage} onChange={e => setForm(p => ({ ...p, stage: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            {canSelectCompany && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
                <select value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {(isAdmin ? COMPANIES : userCompanies).map(c => <option key={c} value={c}>{COMPANY_LABELS[c] || c}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Opportunity Identified Date</label>
              <input type="date" value={form.identifiedDate} onChange={e => setForm(p => ({ ...p, identifiedDate: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Expected Closing Date</label>
              <input type="date" value={form.closingDate} onChange={e => setForm(p => ({ ...p, closingDate: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Additional Details * <span className="text-slate-400 font-normal text-xs">(used in the opportunity name)</span>
              </label>
              <input type="text" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} autoComplete="off" required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {isAdmin && (
              <div>
                <UserSelector
                  label="Sales Manager"
                  value={form.salesManagerId || null}
                  onChange={uid => handleManagerChange(uid || '')}
                  placeholder="Search name, role or department…"
                />
              </div>
            )}
            {canEdit && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Sales Assistants / Team Members</label>

                {/* Already-added members */}
                {(form.teamMembers || []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {form.teamMembers.map(t => (
                      <span key={t.userId}
                        className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">
                        {t.userName}
                        {t.roleLabel && <span className="text-indigo-400">· {t.roleLabel}</span>}
                        <button type="button"
                          onClick={() => setForm(p => ({
                            ...p,
                            teamMembers: (p.teamMembers || []).filter(m => m.userId !== t.userId),
                            assignedUserIds: (p.assignedUserIds || []).filter(id => id !== t.userId),
                          }))}
                          className="text-indigo-400 hover:text-red-600 leading-none">✕</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Search + add */}
                <div className="flex gap-2 items-start">
                  <div className="flex-1">
                    <UserSelector
                      value={pendingTeamUserId}
                      onChange={setPendingTeamUserId}
                      placeholder="Search name, role or department…"
                      filters={{ company: form.company }}
                      onRequestNew={(q) => { setRequestPrefillName(q); setShowRequestUser(true) }}
                    />
                  </div>
                  <button type="button"
                    disabled={!pendingTeamUserId}
                    onClick={() => {
                      if (pendingTeamUserId === form.salesManagerId) {
                        setPendingTeamUserId(null)
                        return  // already the sales manager — nothing to add
                      }
                      if ((form.teamMembers || []).some(t => t.userId === pendingTeamUserId)) {
                        setPendingTeamUserId(null)
                        return  // already on the team
                      }
                      const u = users.find(x => x.id === pendingTeamUserId)
                      if (u) handleTeamMemberToggle(u, true)
                      setPendingTeamUserId(null)
                    }}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
                    + Add
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Can't find someone? Search, then use "Request to add them" in the dropdown.
                </p>
              </div>
            )}
            {/* Deal Type */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">Opportunity Type</label>
              <div className="flex gap-2 flex-wrap">
                {DEAL_TYPES.map(t => (
                  <button key={t.id} type="button" onClick={() => setForm(p => ({ ...p, dealType: t.id }))}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                      form.dealType === t.id ? t.color + ' border-transparent shadow-sm' : 'bg-white border-slate-300 text-slate-500 hover:border-slate-400'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Linked Project — shown for Spares / Service / Upgradation */}
            {['spares', 'service_amc', 'upgradation'].includes(form.dealType) && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Linked Past Project <span className="text-slate-400 font-normal text-xs">(the original won opportunity this follows from)</span>
                </label>
                <select value={form.linkedDealId}
                  onChange={e => {
                    const linked = deals.find(d => d.id === e.target.value)
                    setForm(p => ({
                      ...p,
                      linkedDealId: e.target.value,
                      linkedDealTitle: linked?.title || '',
                      linkedProjectNumber: linked?.projectNumber || '',
                    }))
                  }}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Select past project —</option>
                  {deals
                    .filter(d => d.stage === 'won' && d.id !== editing)
                    .sort((a, b) => (b.closingDate || '').localeCompare(a.closingDate || ''))
                    .map(d => (
                      <option key={d.id} value={d.id}>
                        {d.projectNumber ? `[${d.projectNumber}] ` : ''}{d.title}{d.customerName ? ` — ${d.customerName}` : ''}
                      </option>
                    ))}
                </select>
                {form.linkedProjectNumber && (
                  <p className="text-xs text-teal-600 mt-1">🔗 Linked to project {form.linkedProjectNumber}: {form.linkedDealTitle}</p>
                )}
              </div>
            )}

            {/* Competition Type */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">Competition</label>
              <div className="flex gap-2 items-start flex-wrap">
                <button type="button" onClick={() => setForm(p => ({ ...p, competitionType: 'competitive', noCompetitionReason: '' }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                    form.competitionType === 'competitive'
                      ? 'bg-red-100 text-red-700 border-transparent shadow-sm'
                      : 'bg-white border-slate-300 text-slate-500 hover:border-slate-400'}`}>
                  ⚔️ Competitive
                </button>
                <button type="button" onClick={() => setForm(p => ({ ...p, competitionType: 'no_competition' }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                    form.competitionType === 'no_competition'
                      ? 'bg-green-100 text-green-700 border-transparent shadow-sm'
                      : 'bg-white border-slate-300 text-slate-500 hover:border-slate-400'}`}>
                  ✅ No Competition
                </button>
                {form.competitionType === 'no_competition' && (
                  <select value={form.noCompetitionReason}
                    onChange={e => setForm(p => ({ ...p, noCompetitionReason: e.target.value }))}
                    className="flex-1 min-w-48 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Reason (optional) —</option>
                    {NO_COMPETITION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* Products / Solutions */}
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700">Products / Solutions *</label>
                {isAdmin && (
                  <button type="button" onClick={() => setShowProductAdmin(o => !o)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                    {showProductAdmin ? '✕ Close' : '⚙ Manage list'}
                  </button>
                )}
              </div>
              {isAdmin && showProductAdmin && (
                <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 mb-2 space-y-2">
                  <p className="text-xs text-blue-700">Add or remove items in the shared Products / Solutions list — changes apply for every user immediately.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {productCatalog.map(p => (
                      <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-white border border-blue-200 text-blue-700">
                        {p}
                        <button type="button" onClick={() => removeCatalogProduct(p)} className="hover:text-red-500 ml-0.5" title="Remove from catalog">✕</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={newProductInput} onChange={e => setNewProductInput(e.target.value)}
                      placeholder="New product / solution name…"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCatalogProduct() } }}
                      className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <button type="button" onClick={addCatalogProduct}
                      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">+ Add</button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 border border-slate-200 rounded-lg p-3 bg-slate-50 mb-2">
                {productCatalog.map(p => {
                  const checked = (form.products || []).includes(p)
                  return (
                    <label key={p} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition ${checked ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-white'}`}>
                      <input type="checkbox" checked={checked} className="accent-blue-600" onChange={e => setForm(prev => ({
                        ...prev,
                        products: e.target.checked
                          ? [...(prev.products || []), p]
                          : (prev.products || []).filter(x => x !== p)
                      }))} />
                      {p}
                    </label>
                  )
                })}
              </div>
              {/* Custom product — sales_manager / admin only */}
              {canEdit && (
                <div className="flex gap-2 items-center">
                  <input type="text" id="customProductInput" placeholder="Add custom product…"
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const val = e.target.value.trim()
                        if (val) { setForm(prev => ({ ...prev, products: [...new Set([...(prev.products || []), val])] })); e.target.value = '' }
                      }
                    }} />
                  <button type="button" className="px-3 py-1.5 text-xs bg-slate-200 hover:bg-slate-300 rounded-lg text-slate-700 transition"
                    onClick={() => {
                      const inp = document.getElementById('customProductInput')
                      const val = inp?.value.trim()
                      if (val) { setForm(prev => ({ ...prev, products: [...new Set([...(prev.products || []), val])] })); inp.value = '' }
                    }}>+ Add</button>
                </div>
              )}
              {/* Custom (non-standard) product tags */}
              {(form.products || []).filter(p => !productCatalog.includes(p)).map(p => (
                <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700 mr-1 mt-1.5">
                  {p}
                  <button type="button" onClick={() => setForm(prev => ({ ...prev, products: (prev.products || []).filter(x => x !== p) }))} className="hover:text-red-500 ml-0.5">✕</button>
                </span>
              ))}
            </div>

            {/* Throughput Requirement */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Throughput Requirement * <span className="font-normal text-xs text-slate-400">(PPH — Parcels Per Hour)</span>
              </label>
              <div className="flex items-center gap-2">
                <input type="number" value={form.throughputPPH} onChange={e => setForm(p => ({ ...p, throughputPPH: e.target.value }))}
                  placeholder="e.g. 5000" min="0" required
                  className="w-48 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-sm text-slate-500 font-medium">PPH</span>
                {form.throughputPPH && <span className="text-xs text-slate-400">= {Number(form.throughputPPH).toLocaleString()} parcels/hour</span>}
              </div>
            </div>

            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editing ? 'Update Opportunity' : 'Add Opportunity'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); resetForm() }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 h-full min-w-max pb-2">
          {KANBAN_COLS.map(col => {
            // Role-based visibility filter
            const visibleDeals = deals.filter(d => {
              // AY filter
              if (ayFilter !== 'all' && d.closingDate) {
                const ayOpt = AY_OPTIONS.find(f => f.year === ayFilter)
                if (ayOpt && (d.closingDate < ayOpt.start || d.closingDate > ayOpt.end)) return false
              }
              // Search filter
              if (searchQ.trim()) {
                const q = searchQ.toLowerCase()
                if (!d.title?.toLowerCase().includes(q) && !d.customerName?.toLowerCase().includes(q) && !d.projectNumber?.toLowerCase().includes(q)) return false
              }
              // Company filter applies to all users
              if (companyFilter !== 'all' && d.company !== companyFilter) return false
              if (!isAdmin) {
                const ids = d.assignedUserIds || (d.assignedToId ? [d.assignedToId] : [])
                if (ids.includes(uid)) return true
                if (isWideViewer) return true
                return false
              }
              // Admin: salesperson filter
              const ids = d.assignedUserIds || (d.assignedToId ? [d.assignedToId] : [])
              return salesFilter === 'all' ? true
                : salesFilter === 'unassigned' ? ids.length === 0
                : ids.includes(salesFilter)
            })
            const colDeals = visibleDeals.filter(d => col.stageIds.includes(d.stage || 'lead'))
            // Sum values converted to displayCurrency (use stored valueINR as source of truth)
            const colValue = colDeals.reduce((sum, d) => {
              const inINR = d.valueINR ?? (Number(d.value) * (fxRates[d.currency || 'INR'] || 1))
              return sum + (inINR / (fxRates[displayCurrency] || 1))
            }, 0)

            const renderCard = (d) => {
              const stageObj = STAGES.find(s => s.id === (d.stage || 'lead'))
              const isClosed = CLOSED_STAGES.includes(d.stage)
              return (
                <div key={d.id} draggable={canEdit} onDragStart={canEdit ? () => setDragId(d.id) : undefined} onDragEnd={canEdit ? () => setDragId(null) : undefined}
                  className={`bg-white rounded-lg shadow-sm border border-slate-200 p-3 ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}>
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-sm font-medium text-slate-800 leading-snug">{d.title}</p>
                    {canEdit && <button onClick={() => handleDelete(d)} className="text-slate-300 hover:text-red-500 text-xs flex-shrink-0">✕</button>}
                  </div>
                  {d.customerName && (
                    <p className="text-xs text-slate-500 mt-1">
                      {d.endCustomerName
                        ? <><span className="text-slate-400">via </span>{d.customerName} <span className="text-slate-400">→</span> {d.endCustomerName}</>
                        : d.customerName}
                      {d.siteName ? ` · 📍 ${d.siteName}` : ''}
                    </p>
                  )}
                  {d.warehouseName && <p className="text-xs text-slate-400">🏭 {d.warehouseName}</p>}
                  {d.closingDate && !isClosed && (() => {
                    const daysLeft = Math.ceil((new Date(d.closingDate) - new Date()) / 86400000)
                    const cls = daysLeft < 0 ? 'text-red-600 font-bold' : daysLeft <= 7 ? 'text-amber-600 font-semibold' : 'text-slate-400'
                    const label = daysLeft < 0 ? `⚠ Overdue ${Math.abs(daysLeft)}d` : daysLeft === 0 ? '⚠ Closes today' : `Close: ${d.closingDate}`
                    return <p className={`text-xs mt-0.5 ${cls}`}>{label}</p>
                  })()}
                  {/* ── Project link (won deals) ── */}
                  {d.projectNumber && (
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-mono font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-lg inline-block">
                        📋 {d.projectNumber}
                      </span>
                      {d.projectId && (
                        <button
                          onClick={e => { e.stopPropagation(); navigate('/projects/register') }}
                          className="text-xs text-green-700 hover:text-green-800 font-semibold hover:underline"
                          title="Open in Projects module"
                        >
                          Open ↗
                        </button>
                      )}
                    </div>
                  )}
                  {/* Create Project — only on won deals without a linked project */}
                  {d.stage === 'won' && !d.projectId && canEdit && (
                    <button
                      onClick={e => { e.stopPropagation(); setCreateProjectDeal(d) }}
                      className="mt-1 w-full text-xs text-green-700 hover:text-white bg-green-50 hover:bg-green-600 border border-green-300 hover:border-green-600 px-2 py-1 rounded-lg transition font-medium text-left"
                      title="Create a project from this won deal"
                    >
                      📁 Create Project
                    </button>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {Number(d.value) > 0 && (
                      <span className="text-xs font-semibold text-slate-700">
                        {CURRENCY_SYMBOLS[d.currency || 'INR']}{Number(d.value).toLocaleString('en-IN')}
                        {d.currency && d.currency !== 'INR' && <span className="font-normal text-slate-400 ml-0.5">{d.currency}</span>}
                      </span>
                    )}
                    {d.currency && d.currency !== 'INR' && Number(d.value) > 0 && (
                      <span className="text-xs text-slate-400">≈ ₹{(d.valueINR || Math.round(Number(d.value) * (fxRates[d.currency] || 1))).toLocaleString('en-IN')}</span>
                    )}
                    {d.company && <span className={`px-1.5 py-0.5 rounded-lg text-xs font-bold ${COMPANY_COLORS[d.company] || 'bg-slate-100 text-slate-600'}`}>{d.company}</span>}
                  {d.dealType && d.dealType !== 'new_business' && (() => {
                    const dt = DEAL_TYPES.find(t => t.id === d.dealType)
                    return dt ? <span className={`px-1.5 py-0.5 rounded-lg text-xs font-medium ${dt.color}`}>{dt.label}</span> : null
                  })()}
                  </div>
                  {/* Linked project reference */}
                  {d.linkedProjectNumber && (
                    <p className="text-xs text-teal-600 mt-0.5">🔗 Follows: [{d.linkedProjectNumber}] {d.linkedDealTitle && d.linkedDealTitle.slice(0, 30)}{(d.linkedDealTitle || '').length > 30 ? '…' : ''}</p>
                  )}
                  {/* Team section */}
                  {(d.salesManagerName || d.assignedToName || (d.teamMembers || []).length > 0) && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {(d.salesManagerName || d.assignedToName) && (
                        <span className="flex items-center gap-1 text-xs bg-indigo-600 text-white px-1.5 py-0.5 rounded-lg font-medium" title={`Sales Manager: ${d.salesManagerName || d.assignedToName}`}>
                          ⭐ {(d.salesManagerName || d.assignedToName).split(' ')[0]}
                        </span>
                      )}
                      {(d.teamMembers || []).slice(0, 3).map(t => (
                        <span key={t.userId} title={t.userName || t.name || t.userId}
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-xs font-bold">
                          {(t.userName || t.name || t.userId || '?').charAt(0).toUpperCase()}
                        </span>
                      ))}
                      {(d.teamMembers || []).length > 3 && (
                        <span className="text-xs text-slate-400">+{d.teamMembers.length - 3}</span>
                      )}
                    </div>
                  )}
                  {/* Last activity indicator */}
                  {(() => {
                    const allEntries = [
                      ...(d.activities || []),
                      ...(d.meetingNotes || []).map(m => ({ date: m.date, nextAction: m.nextAction })),
                    ].sort((a,b) => (b.date||'').localeCompare(a.date||''))
                    const last = allEntries[0]
                    if (!last) return null
                    return (
                      <div className="mt-1 text-xs text-slate-400">
                        🕐 Last: {last.date}{last.nextAction && <span className="text-amber-600 ml-1">→ {last.nextAction.slice(0,30)}{last.nextAction.length > 30 ? '…' : ''}</span>}
                      </div>
                    )
                  })()}

                  {/* Products */}
                  {(d.products || []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(d.products || []).slice(0, 4).map(p => (
                        <span key={p} className="text-xs px-1.5 py-0.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 font-medium">{p}</span>
                      ))}
                      {(d.products || []).length > 4 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-lg bg-slate-100 text-slate-500">+{d.products.length - 4}</span>
                      )}
                    </div>
                  )}
                  {d.throughputPPH && (
                    <div className="text-xs text-teal-600 mt-0.5">⚡ {Number(d.throughputPPH).toLocaleString()} PPH</div>
                  )}

                  {/* ── Competitors / Competition section ── */}
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    {d.competitionType === 'no_competition' ? (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-lg border border-green-200">
                          ✅ No Competition{d.noCompetitionReason ? ` · ${d.noCompetitionReason}` : ''}
                        </span>
                        <button onClick={() => setCompetitorDeal(d)}
                          className="text-xs text-slate-400 hover:text-slate-600">Edit</button>
                      </div>
                    ) : (d.competitors || []).length === 0 ? (
                      <button onClick={() => setCompetitorDeal(d)}
                        className="w-full text-xs text-slate-400 hover:text-red-600 hover:bg-red-50 py-1 rounded-lg border border-dashed border-slate-300 hover:border-red-300 transition">
                        ⚔️ Add competitor
                      </button>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-slate-500">⚔️ Competitors</span>
                          <button onClick={() => setCompetitorDeal(d)}
                            className="text-xs text-red-600 hover:text-red-700 font-medium hover:underline">
                            Manage
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(d.competitors || []).map(c => {
                            const statusColors = {
                              competing:   'bg-amber-100 text-amber-700',
                              won_against: 'bg-green-100 text-green-700',
                              lost_to:     'bg-red-100 text-red-700',
                              dropped_out: 'bg-slate-100 text-slate-500',
                            }
                            return (
                              <span key={c.id} onClick={() => setCompetitorDeal(d)}
                                className={`cursor-pointer text-xs font-medium px-1.5 py-0.5 rounded-lg ${statusColors[c.status] || 'bg-slate-100 text-slate-600'}`}
                                title={c.product || c.name}>
                                {c.name}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <div className="flex gap-2">
                      {canEdit && <button onClick={() => handleEdit(d)} className="text-xs text-blue-600 hover:text-blue-700">Edit</button>}
                      {canEdit && <button onClick={() => handleClone(d)} className="text-xs text-slate-400 hover:text-purple-600" title="Clone">⧉</button>}
                      <button onClick={() => setActivityDeal(d)} className="text-xs text-slate-500 hover:text-green-700 font-medium" title="Activity feed">
                        📋{(() => { const n = (d.activities||[]).length + (d.meetingNotes||[]).length; return n > 0 ? ` ${n}` : '' })()}
                      </button>
                      <button onClick={() => setTasksDeal(d)} className="text-xs text-slate-500 hover:text-indigo-700 font-medium" title="Team & Tasks">
                        👥{(() => { const tm = (d.teamMembers||[]).length; return tm > 0 ? ` ${tm + 1}` : '' })()}
                      </button>
                    </div>
                    {isSalesAssistant ? (
                      <span className="text-xs border border-slate-200 rounded-lg px-2 py-0.5 text-slate-500 bg-slate-50">
                        {STAGES.find(s => s.id === (d.stage || 'lead'))?.label || d.stage}
                      </span>
                    ) : (
                    <select value={d.stage || 'lead'} onChange={e => moveStage(d.id, e.target.value)}
                      className="text-xs border border-slate-200 rounded-lg px-1 py-0.5 text-slate-600 focus:outline-none">
                      {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                    )}
                  </div>
                </div>
              )
            }

            return (
              <div key={col.key}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onDrop(e, col.isGroup ? 'won' : col.stageIds[0])}
                className={`w-72 flex-shrink-0 bg-slate-100 rounded-xl border-t-4 ${col.cls} flex flex-col h-full`}>
                <div className="p-3 border-b border-slate-200 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-sm text-slate-700">{col.label}</p>
                    <span className="text-xs bg-white px-2 py-0.5 rounded-full text-slate-500 font-medium">{colDeals.length}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{fmtDisplay(colValue)}</p>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {col.isGroup ? (
                    // Closed column: sub-grouped by outcome
                    CLOSED_STAGES.map(sid => {
                      const subStage = STAGES.find(s => s.id === sid)
                      const subDeals = colDeals.filter(d => (d.stage || 'lead') === sid)
                      if (subDeals.length === 0) return null
                      return (
                        <div key={sid}>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-lg mb-1.5 inline-block ${subStage.color}`}>{subStage.label}</span>
                          <div className="space-y-2">{subDeals.map(d => renderCard(d))}</div>
                        </div>
                      )
                    })
                  ) : (
                    colDeals.map(d => renderCard(d))
                  )}
                  {colDeals.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">No opportunities</p>
                  )}
                </div>

                {!col.isGroup && (
                  <button onClick={() => openNewDeal(col.stageIds[0])}
                    className="m-2 text-xs text-slate-500 hover:text-blue-600 hover:bg-white py-1.5 rounded-lg border border-dashed border-slate-300 transition flex-shrink-0">
                    + Add opportunity
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Meeting Notes Modal (legacy — still accessible via handleDealUpdate) */}
      {meetingDeal && (
        <MeetingNotesModal
          deal={meetingDeal}
          onClose={() => setMeetingDeal(null)}
          onDealUpdate={handleDealUpdate}
        />
      )}

      {/* Activity Feed Panel */}
      {activityDeal && (
        <ActivityFeedModal
          deal={activityDeal}
          onClose={() => setActivityDeal(null)}
          onDealUpdate={handleActivityUpdate}
        />
      )}

      {/* Competitor Panel */}
      {competitorDeal && (
        <CompetitorModal
          deal={competitorDeal}
          onClose={() => setCompetitorDeal(null)}
          onDealUpdate={handleCompetitorUpdate}
          allCompetitors={allCompetitors}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <PipelineImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load() }}
        />
      )}

      {/* Request-to-add-new-team-member Modal */}
      {showRequestUser && (
        <RequestUserModal
          initialName={requestPrefillName}
          dealId={editing || ''}
          dealTitle={previewTitle || form.title || ''}
          onClose={() => setShowRequestUser(false)}
          onSubmitted={() => setShowRequestUser(false)}
        />
      )}

      {/* Deal Team / Tasks Modal */}
      {tasksDeal && (
        <DealTasksModal
          deal={tasksDeal}
          onClose={() => setTasksDeal(null)}
          onDealUpdate={updated => {
            setDeals(prev => prev.map(d => d.id === updated.id ? updated : d))
            setTasksDeal(updated)
          }}
        />
      )}

      {/* Create Project Modal — CRM Workflow Integration v1 */}
      {createProjectDeal && (
        <CreateProjectModal
          deal={createProjectDeal}
          user={user}
          onClose={() => setCreateProjectDeal(null)}
          onProjectCreated={({ projectId, projectNumber, projectName }) => {
            // Update local state — no re-fetch needed
            setDeals(prev => prev.map(d =>
              d.id === createProjectDeal.id
                ? { ...d, projectId, projectNumber, projectName, projectCreated: true }
                : d
            ))
            setCreateProjectDeal(null)
          }}
        />
      )}
    </div>
  )
}