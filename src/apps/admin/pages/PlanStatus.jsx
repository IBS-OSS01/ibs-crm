import React, { useEffect, useState } from 'react'
import { collection, getCountFromServer } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'

// Firebase Spark (free) plan daily/total limits relevant to this app.
// Source: Firebase pricing page. Keep this in sync if Google changes quotas.
const LIMITS = [
  { key: 'reads', label: 'Firestore reads', limit: '50,000 / day' },
  { key: 'writes', label: 'Firestore writes', limit: '20,000 / day' },
  { key: 'deletes', label: 'Firestore deletes', limit: '20,000 / day' },
  { key: 'storage', label: 'Firestore storage', limit: '1 GiB total' },
  { key: 'hostingStorage', label: 'Hosting storage', limit: '10 GB total' },
  { key: 'hostingTransfer', label: 'Hosting transfer', limit: '360 MB / day' },
  { key: 'auth', label: 'Authentication (email/password)', limit: 'Unlimited, free' },
  { key: 'functions', label: 'Cloud Functions', limit: 'Not available on free plan' },
]

// Collections we count to give a rough sense of how much data has piled up.
// getCountFromServer is an aggregation query — it costs 1 read no matter how
// many documents match, so checking this costs ~7 reads total, not 7×N.
const COLLECTIONS = [
  { key: 'users', label: 'Users' },
  { key: 'crm_customers', label: 'Customers' },
  { key: 'crm_sites', label: 'Sites' },
  { key: 'crm_orders', label: 'Orders' },
  { key: 'crm_deals', label: 'Pipeline deals' },
  { key: 'hr_employees', label: 'HR employees' },
  { key: 'finance_expenses', label: 'Finance expenses' },
]

export default function PlanStatus() {
  const [counts, setCounts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      try {
        const results = {}
        for (const c of COLLECTIONS) {
          const snap = await getCountFromServer(collection(db, c.key))
          results[c.key] = snap.data().count
        }
        setCounts(results)
      } catch (err) {
        setError('Could not load record counts: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  const totalRecords = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Plan &amp; Usage</h2>
        <p className="text-slate-500 text-sm">This app runs on Firebase's free Spark plan — no billing, no card on file.</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <p className="font-bold mb-1">⚠️ Why this matters</p>
        <p>
          Firebase's free plan has daily limits. The app itself can't auto-detect when you're close to
          a limit — that data only lives in Firebase's own usage dashboard, which is free to view and
          doesn't require upgrading. Check it occasionally, especially after a big bulk import or a
          busy sales day.
        </p>
        <a
          href="https://console.firebase.google.com/project/uipl-erp/usage"
          target="_blank" rel="noreferrer"
          className="inline-block mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition"
        >
          🔗 Open live usage dashboard in Firebase Console
        </a>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-sm">Free plan (Spark) limits</h3>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {LIMITS.map(l => (
              <tr key={l.key}>
                <td className="px-4 py-2 text-slate-600">{l.label}</td>
                <td className="px-4 py-2 text-right font-medium text-slate-800">{l.limit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 text-sm">Records stored right now</h3>
          {totalRecords !== null && <span className="text-xs text-slate-400">{totalRecords.toLocaleString()} total</span>}
        </div>
        {error && <div className="p-3 text-xs text-red-600">{error}</div>}
        {loading ? (
          <div className="p-4 text-sm text-slate-400">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {COLLECTIONS.map(c => (
                <tr key={c.key}>
                  <td className="px-4 py-2 text-slate-600">{c.label}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-800">{(counts?.[c.key] ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">
          Record counts are a rough size signal, not a quota measurement — the real read/write/storage numbers are only in the Firebase Console link above.
        </p>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600">
        <p className="font-bold text-slate-800 mb-2">Staying on the free plan</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Any new feature that needs a Cloud Function, scheduled job, or server backend requires upgrading to the paid Blaze plan — Claude will flag this and suggest a free-plan alternative before building it.</li>
          <li>If a single page is loading thousands of rows at once, that page should be changed to paginate or filter — large unfiltered reads are the fastest way to burn through the daily read quota.</li>
          <li>Old/closed records (lost opportunities, very old orders) can be archived or deleted periodically to stay well under the 1 GiB storage cap.</li>
          <li>If the Console dashboard shows any metric near 90%, the fix is usually: reduce how often a page re-fetches data, add pagination, or wait until the daily quota resets (limits reset every 24 hours).</li>
        </ul>
      </div>
    </div>
  )
}
