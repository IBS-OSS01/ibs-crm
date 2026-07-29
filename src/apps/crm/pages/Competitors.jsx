import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import CompetitorModal from '../components/CompetitorModal.jsx'
import { COMPETITOR_STATUSES } from '../components/CompetitorModal.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────
const statusObj = (id) => COMPETITOR_STATUSES.find(s => s.id === id) || COMPETITOR_STATUSES[0]

const STAGE_LABELS = {
  lead: 'Lead', prebid: 'Pre-bid', bid: 'Bid', closing: 'Closing',
  won: 'Won', lost: 'Lost', rejected: 'Rejected', nobid: 'No Bid',
}

// Fetch recent Google News via rss2json.com (free, CORS-safe, 10k req/month, no API key)
const fetchCompetitorNews = async ({ name, industry, hqCity }) => {
  const suffix = [industry, hqCity, 'India'].filter(Boolean).join(' ')
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`${name} ${suffix}`)}&hl=en-IN&gl=IN&ceid=IN:en`
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=8`

  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  let res
  try   { res = await fetch(apiUrl, { signal: ctrl.signal }) }
  finally { clearTimeout(timer) }

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Feed error')

  return (data.items || []).slice(0, 6).map(item => ({
    title:       (item.title || '').trim(),
    link:        item.link || '',
    pubDate:     (item.pubDate || '').slice(0, 16),
    description: (item.description || '').replace(/<[^>]+>/g, '').slice(0, 200),
    source:      item.author || '',
  })).filter(i => i.title)
}

// Social media / search quick-links for a competitor
const socialLinks = (name) => {
  const q = encodeURIComponent(name)
  return [
    { label: '🔍 Google',         href: `https://www.google.com/search?q=${q}+India` },
    { label: '💼 LinkedIn',       href: `https://www.linkedin.com/search/results/companies/?keywords=${q}` },
    { label: '🐦 X / Twitter',   href: `https://twitter.com/search?q=${encodeURIComponent(name)}&f=live` },
    { label: '📈 Economic Times', href: `https://economictimes.indiatimes.com/searchresult.cms?query=${q}` },
  ]
}

const inp = 'px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

// ── Sub-component: single competitor intelligence card ────────────────────────
function CompetitorIntelCard({ name, stats }) {
  const [news, setNews]         = useState([])
  const [loading, setLoading]   = useState(false)
  const [fetched, setFetched]   = useState(false)
  const [error, setError]       = useState('')
  const [expanded, setExpanded] = useState(false)

  const fetchNews = async () => {
    setLoading(true); setError('')
    try {
      const items = await fetchCompetitorNews({ name, industry: stats.industry, hqCity: stats.hqCity })
      setNews(items); setFetched(true)
    } catch (e) { setError('Could not fetch news: ' + e.message) }
    finally { setLoading(false) }
  }

  const winRate = stats.decided > 0 ? Math.round((stats.won / stats.decided) * 100) : null

  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
      {/* Header row */}
      <div className="px-4 py-3 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-slate-800">{name}</p>
            {stats.website && (
              <a href={stats.website} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline" onClick={e => e.stopPropagation()}>
                🌐 Website
              </a>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
            <span className="text-slate-500">{stats.total} opportunit{stats.total !== 1 ? 'ies' : 'y'}</span>
            {stats.industry && <span className="text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-lg">{stats.industry}</span>}
            {stats.hqCity && <span className="text-slate-400">📍 {stats.hqCity}</span>}
            {stats.won > 0 && <span className="text-green-600 font-medium">✓ Won {stats.won}</span>}
            {stats.lost > 0 && <span className="text-red-600 font-medium">✗ Lost {stats.lost}</span>}
            {stats.competing > 0 && <span className="text-amber-600 font-medium">⏳ Active {stats.competing}</span>}
            {winRate !== null && (
              <span className={`font-bold ${winRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                {winRate}% win rate
              </span>
            )}
          </div>
        </div>

        {/* Win-rate bar */}
        {stats.decided > 0 && (
          <div className="w-28 flex-shrink-0">
            <div className="h-2 bg-red-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${winRate}%` }} />
            </div>
            <p className="text-xs text-slate-400 text-right mt-0.5">{winRate}%</p>
          </div>
        )}

        {/* News button */}
        <button onClick={() => { setExpanded(!expanded); if (!fetched && !expanded) fetchNews() }}
          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition ${
            expanded ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700'
          }`}>
          {loading ? '⏳' : '📰'} {expanded ? 'Hide' : 'Latest news'}
        </button>
      </div>

      {/* Social media quick links */}
      <div className="px-4 pb-2.5 flex flex-wrap gap-1.5">
        {socialLinks(name).map(l => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
            className="text-xs px-2 py-0.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition">
            {l.label}
          </a>
        ))}
      </div>

      {/* News panel */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
          {loading && <p className="text-xs text-slate-400 text-center py-3">Fetching news…</p>}
          {error   && (
            <div className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-lg flex items-center gap-2">
              {error}
              <button onClick={fetchNews} className="underline">Retry</button>
            </div>
          )}
          {!loading && !error && news.length === 0 && fetched && (
            <p className="text-xs text-slate-400 text-center py-3">No recent news found.</p>
          )}
          {news.length > 0 && (
            <ul className="space-y-2.5">
              {news.map((item, i) => (
                <li key={i} className="bg-white rounded-lg border border-slate-200 p-2.5">
                  <a href={item.link} target="_blank" rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-700 hover:underline leading-snug block">
                    {item.title}
                  </a>
                  {item.description && (
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{item.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                    {item.pubDate && <span>📅 {item.pubDate}</span>}
                    {item.source && <span>· {item.source}</span>}
                  </div>
                </li>
              ))}
              <li>
                <a href={`https://news.google.com/search?q=${encodeURIComponent([name, stats.industry, stats.hqCity, 'India'].filter(Boolean).join(' '))}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline">
                  View all news for {name} →
                </a>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Competitors() {
  const { user, userProfile } = useAuth()
  const isAdmin      = userProfile?.role === 'admin'
  const role         = userProfile?.role || ''
  const isWideViewer = role === 'solution_manager' || role === 'sales_director'
  const uid          = user?.uid || ''
  const canSeeUIPL   = true  // all CRM users see both companies

  const [deals, setDeals]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState('analysis')   // 'analysis' | 'bulletin'
  const [filterCo, setFilterCo]     = useState('all')
  const [selectedDeal, setSelectedDeal] = useState(null)  // for CompetitorModal from deal table
  const [searchQ, setSearchQ]       = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'crm_deals'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setDeals(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const handleDealUpdate = (updated) => {
    setDeals(prev => prev.map(d => d.id === updated.id ? updated : d))
    setSelectedDeal(updated)
  }

  // Visible deals — mirrors Pipeline visibility logic exactly:
  // assignment check first (always wins), then UIPL block, then wide-viewer pass
  const visibleDeals = useMemo(() => deals.filter(d => {
    if (!isAdmin) {
      const ids = d.assignedUserIds || (d.assignedToId ? [d.assignedToId] : [])
      if (ids.includes(uid)) return true
      if (isWideViewer) return true
      return false
    }
    return filterCo === 'all' || d.company === filterCo
  }), [deals, isAdmin, uid, isWideViewer, filterCo])

  // ── Aggregate competitor stats ────────────────────────────────────────────
  const competitorStats = useMemo(() => {
    const map = {}   // name → { total, won, lost, competing, dropped, deals[], website, industry, hqCity }
    visibleDeals.forEach(deal => {
      ;(deal.competitors || []).forEach(c => {
        if (!map[c.name]) map[c.name] = {
          total: 0, won: 0, lost: 0, competing: 0, dropped: 0, decided: 0, deals: [],
          website: '', industry: '', hqCity: '',
        }
        const s = map[c.name]
        s.total++
        if (c.status === 'won_against')  { s.won++;       s.decided++ }
        if (c.status === 'lost_to')      { s.lost++;      s.decided++ }
        if (c.status === 'competing')    { s.competing++ }
        if (c.status === 'dropped_out')  { s.dropped++ }
        // Keep most recently filled-in metadata
        if (c.website)  s.website  = c.website
        if (c.industry) s.industry = c.industry
        if (c.hqCity)   s.hqCity   = c.hqCity
        s.deals.push({
          dealId: deal.id, dealTitle: deal.title, stage: deal.stage,
          customerName: deal.customerName, status: c.status,
          product: c.product, estimatedPrice: c.estimatedPrice, currency: c.currency,
          ourAdvantage: c.ourAdvantage, theirAdvantage: c.theirAdvantage,
        })
      })
    })
    return Object.entries(map)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.total - a.total)
  }, [visibleDeals])

  const allCompetitors = competitorStats.map(s => ({
    name: s.name, website: s.website || '', industry: s.industry || '', hqCity: s.hqCity || '',
  }))

  // Deals with at least one competitor tracked
  const dealsWithCompetitors = visibleDeals.filter(d => (d.competitors || []).length > 0)

  // Summary totals
  const totalWon  = competitorStats.reduce((s, c) => s + c.won,  0)
  const totalLost = competitorStats.reduce((s, c) => s + c.lost, 0)
  const overallDecided = totalWon + totalLost
  const overallWinRate = overallDecided > 0 ? Math.round((totalWon / overallDecided) * 100) : null

  const filteredStats = searchQ
    ? competitorStats.filter(c => c.name.toLowerCase().includes(searchQ.toLowerCase()))
    : competitorStats

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">⚔️ Competitor Tracking</h2>
          <p className="text-slate-500 text-sm">
            {competitorStats.length} unique competitor{competitorStats.length !== 1 ? 's' : ''} across {dealsWithCompetitors.length} opportunit{dealsWithCompetitors.length !== 1 ? 'ies' : 'y'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
            {['all', 'UIPL', 'Wayzim'].map(co => (
              <button key={co} onClick={() => setFilterCo(co)}
                className={`px-4 py-1.5 font-medium transition ${filterCo === co
                  ? co === 'UIPL' ? 'bg-blue-600 text-white' : co === 'Wayzim' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {co === 'all' ? 'All' : co}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Unique Competitors', value: competitorStats.length, icon: '🏢', color: 'border-slate-300' },
          { label: 'Opportunities Tracked',      value: dealsWithCompetitors.length, icon: '📊', color: 'border-blue-300' },
          { label: 'Won Against',        value: totalWon,  icon: '✅', color: 'border-green-300' },
          { label: 'Lost To',            value: totalLost, icon: '❌', color: 'border-red-300' },
        ].map(card => (
          <div key={card.label} className={`bg-white rounded-xl border-l-4 ${card.color} border border-slate-200 p-4`}>
            <p className="text-2xl mb-1">{card.icon}</p>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">{card.value}</p>
            <p className="text-xs text-slate-500">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Overall win rate bar */}
      {overallDecided > 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-700">Overall competitive win rate</p>
            <span className={`text-lg font-bold ${overallWinRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
              {overallWinRate}%
            </span>
          </div>
          <div className="h-3 bg-red-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${overallWinRate}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-xs text-slate-400">
            <span>{totalWon} won</span><span>{totalLost} lost</span>
          </div>
        </div>
      )}

      {/* Tabs: Analysis | Intelligence Bulletin */}
      <div className="flex gap-1 border-b border-slate-200">
        {[
          { id: 'analysis', label: '📊 Win/Loss Analysis' },
          { id: 'bulletin', label: '📰 Intelligence Bulletin' },
          { id: 'opportunities',    label: '📋 Opportunities Breakdown' },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Analysis tab ── */}
      {activeTab === 'analysis' && (
        <div className="space-y-3">
          <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search competitor…" className={inp + ' w-64'} />

          {filteredStats.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-3xl mb-2">⚔️</p>
              <p>No competitors tagged yet.</p>
              <p className="text-sm mt-1">Add competitors using the ⚔️ button on Pipeline cards.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[2fr_80px_60px_60px_60px_60px_120px] gap-3 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <span>Competitor</span>
                <span className="text-center">Total opportunities</span>
                <span className="text-center text-green-600">Won</span>
                <span className="text-center text-red-600">Lost</span>
                <span className="text-center text-amber-600">Active</span>
                <span className="text-center">Win %</span>
                <span>Win rate</span>
              </div>
              {filteredStats.map(c => {
                const wr = c.decided > 0 ? Math.round((c.won / c.decided) * 100) : null
                return (
                  <div key={c.name}
                    className="grid grid-cols-[2fr_80px_60px_60px_60px_60px_120px] gap-3 px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 items-center">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                      <div className="flex gap-1 flex-wrap mt-0.5">
                        {[...new Set(c.deals.map(d => d.stage))].slice(0, 4).map(s => (
                          <span key={s} className="text-xs text-slate-400 bg-slate-100 px-1 py-0.5 rounded-lg">
                            {STAGE_LABELS[s] || s}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="text-sm text-center font-medium text-slate-700">{c.total}</span>
                    <span className="text-sm text-center font-bold text-green-600">{c.won || '—'}</span>
                    <span className="text-sm text-center font-bold text-red-600">{c.lost || '—'}</span>
                    <span className="text-sm text-center font-medium text-amber-600">{c.competing || '—'}</span>
                    <span className={`text-sm text-center font-bold ${wr === null ? 'text-slate-300' : wr >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                      {wr !== null ? `${wr}%` : '—'}
                    </span>
                    <div className="h-2 bg-red-100 rounded-full overflow-hidden">
                      {wr !== null && <div className="h-full bg-green-500 rounded-full" style={{ width: `${wr}%` }} />}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Intelligence Bulletin tab ── */}
      {activeTab === 'bulletin' && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-700 flex items-start gap-2">
            <span className="text-base flex-shrink-0">📰</span>
            <span>
              Live news fetched from Google News for each competitor. Click <strong>Latest news</strong> on any card to load articles.
              Results are in English and sourced from public news — for informational use only.
            </span>
          </div>

          {competitorStats.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>No competitors tracked yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {competitorStats.map(c => (
                <CompetitorIntelCard key={c.name} name={c.name} stats={c} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Deals breakdown tab ── */}
      {activeTab === 'opportunities' && (
        <div className="space-y-3">
          {dealsWithCompetitors.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>No opportunities with competitors tagged yet.</p>
            </div>
          ) : (
            dealsWithCompetitors.map(deal => (
              <div key={deal.id} className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
                {/* Deal header */}
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{deal.title}</p>
                    {deal.customerName && <p className="text-xs text-slate-500">{deal.customerName}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg">
                      {STAGE_LABELS[deal.stage] || deal.stage}
                    </span>
                    <span className="text-xs text-slate-400">{(deal.competitors || []).length} competitor{(deal.competitors || []).length !== 1 ? 's' : ''}</span>
                    <button onClick={() => setSelectedDeal(deal)}
                      className="text-xs text-blue-600 hover:text-blue-700 hover:underline">
                      Manage →
                    </button>
                  </div>
                </div>
                {/* Competitor chips */}
                <div className="px-4 py-2 flex flex-wrap gap-2">
                  {(deal.competitors || []).map(c => {
                    const st = statusObj(c.status)
                    return (
                      <span key={c.id} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${st.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                        {c.name}
                        {c.product && <span className="font-normal opacity-70">· {c.product}</span>}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* CompetitorModal from Deals tab */}
      {selectedDeal && (
        <CompetitorModal
          deal={selectedDeal}
          onClose={() => setSelectedDeal(null)}
          onDealUpdate={handleDealUpdate}
          allCompetitors={allCompetitors}
        />
      )}
    </div>
  )
}
