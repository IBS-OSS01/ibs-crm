// Shared loader for every finance report/voucher page.
//
// Before this, each report re-declared the same 7-collection fetch. Now there is
// one place, with a per-collection cache (60s) so clicking through Trial Balance
// → Balance Sheet → Day Book doesn't re-read the whole database each time —
// matters on the free Firebase plan's daily read quota. Writes call
// invalidateFinanceCache() so the next page load is fresh.
import { useEffect, useMemo, useState, useCallback } from 'react'
import { collection, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { deriveAllLines, manualEntryLines, assertBalanced, mergeRequiredAccounts, isAccountingInvoice } from '../utils/ledger.js'
import { computeStock } from '../utils/stockEngine.js'

export const COLLECTIONS = {
  invoices: 'finance_invoices',
  payments: 'finance_payments',
  orders: 'crm_orders',
  expenses: 'finance_expenses',
  payables: 'finance_payables',
  accounts: 'finance_accounts',
  journalEntries: 'finance_journal_entries',
  vouchers: 'finance_vouchers',
  vendors: 'finance_vendors',
  customers: 'crm_customers',
  bankAccounts: 'finance_bank_accounts',
  hsnCodes: 'finance_hsn_codes',
  // Inventory / purchase orders / TDS (used by later phases' pages)
  purchaseOrders: 'finance_purchase_orders',
  stockJournals: 'finance_stock_journals',
  stockItems: 'inventory_items',
  warehouses: 'inventory_warehouses',
  stockLevels: 'inventory_stocks',
  stockAdjustments: 'inventory_stock_adjustments',
  stockTransfers: 'inventory_stock_transfers',
  consumptionRequests: 'inventory_consumption_requests',
  tdsSections: 'finance_tds_sections',
  tdsChallans: 'finance_tds_challans',
  tdsReturns: 'finance_tds_returns',
  fxRates: 'finance_fx_rates',
  statutoryChallans: 'finance_statutory_challans',
  hrSlips: 'hr_salary_slips',
  hrEmployees: 'hr_employees',
  gstChallans: 'finance_gst_challans',
  gstr2bImports: 'finance_gstr2b_imports',
  bankStatements: 'finance_bank_statement_lines',
  costCentres: 'finance_cost_centres',
  budgets: 'finance_budgets',
  auditLog: 'finance_audit_log',
}

export const CORE_KEYS = [
  'invoices', 'payments', 'orders', 'expenses', 'payables', 'accounts', 'journalEntries',
  'vouchers', 'vendors', 'customers', 'bankAccounts',
  // inventory — needed by every report because stock value feeds Stock in Hand / cost of goods
  'stockItems', 'warehouses', 'stockAdjustments', 'stockTransfers', 'consumptionRequests', 'fxRates',
]

const TTL_MS = 60_000
const cache = {}                 // key -> { at, promise }
const failures = {}              // key -> error message (e.g. permission-denied)

const toArr = (snap) => { const a = []; snap.forEach(d => a.push({ id: d.id, ...d.data() })); return a }

function load(key) {
  const hit = cache[key]
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise
  const promise = getDocs(collection(db, COLLECTIONS[key]))
    .then(s => { delete failures[key]; return toArr(s) })
    .catch(err => { failures[key] = err.code || err.message; return [] })   // a collection the user can't read (or that doesn't exist yet) must not break unrelated pages
  cache[key] = { at: Date.now(), promise }
  return promise
}

let settingsCache = null
function loadCompanySettings() {
  if (settingsCache && Date.now() - settingsCache.at < TTL_MS) return settingsCache.promise
  const promise = Promise.all(['UIPL', 'Wayzim'].map(c => getDoc(doc(db, 'company_settings', c)).catch(() => null)))
    .then(([u, w]) => ({ UIPL: u?.exists() ? u.data() : {}, Wayzim: w?.exists() ? w.data() : {} }))
  settingsCache = { at: Date.now(), promise }
  return promise
}

export function invalidateFinanceCache() {
  Object.keys(cache).forEach(k => delete cache[k])
  settingsCache = null
}

export function useFinanceData(extraKeys = []) {
  const keys = useMemo(() => [...new Set([...CORE_KEYS, ...extraKeys])], [extraKeys.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([Promise.all(keys.map(load)), loadCompanySettings()]).then(([arrays, companySettings]) => {
      if (!alive) return
      const r = Object.fromEntries(keys.map((k, i) => [k, arrays[i]]))
      r.accounts = mergeRequiredAccounts((r.accounts || []).sort((a, b) => (a.code || '').localeCompare(b.code || '')))
      r.companySettings = companySettings
      setRaw(r)
      setLoading(false)
    })
    return () => { alive = false }
  }, [keys, nonce])

  const stock = useMemo(() => raw ? computeStock(raw, raw.accounts, isAccountingInvoice, raw.companySettings?.UIPL?.stockOptions || {}) : { movements: [], summary: [], lines: [] }, [raw])

  const allLines = useMemo(() => {
    if (!raw) return []
    const lines = [...deriveAllLines(raw), ...manualEntryLines(raw.journalEntries || []), ...stock.lines]
    if (import.meta.env.DEV) assertBalanced(lines)
    return lines
  }, [raw, stock])

  const reload = useCallback(() => { invalidateFinanceCache(); setNonce(n => n + 1) }, [])

  return { raw, accounts: raw?.accounts || [], allLines, stock, loading, reload, failures }
}
