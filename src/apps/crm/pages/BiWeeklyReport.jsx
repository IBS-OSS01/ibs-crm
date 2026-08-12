import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase-config'
import { useAuth } from '../../../context/AuthContext'
import PptxGenJS from 'pptxgenjs'

const OPEN_STAGES = ['lead', 'prebid', 'bid', 'closing']         // pipeline funnel stages
const ACTIVE_STAGES = ['lead', 'prebid', 'bid', 'closing', 'hold'] // all non-closed stages
const STAGE_LABELS = { lead: 'Lead', prebid: 'Pre-bid', bid: 'Bid', closing: 'Closing', hold: 'On Hold' }
const STAGE_HEX   = { lead: '64748B', prebid: '3B82F6', bid: 'F59E0B', closing: '8B5CF6', hold: '0891B2' }

// ISO week number
const getWeekNumber = (d = new Date()) => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const jan4 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  return Math.ceil((((date - jan4) / 86400000) + 1) / 7)
}

const getBiWeeklyPeriod = () => {
  const now = new Date()
  const wn = getWeekNumber(now)
  const dow = now.getDay() || 7
  const monThis = new Date(now); monThis.setDate(now.getDate() - dow + 1)
  const monPrev = new Date(monThis); monPrev.setDate(monThis.getDate() - 7)
  const sunThis = new Date(monThis); sunThis.setDate(monThis.getDate() + 6)
  const fmt = dt => dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return { weekNum: wn, range: `${fmt(monPrev)} – ${fmt(sunThis)}` }
}

// India FY: Apr–Mar  e.g. FY 2026–27
const getAYLabel = () => {
  const now = new Date()
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `AY ${y}–${String(y + 1).slice(2)}`
}

const trunc = (str, len) => str && str.length > len ? str.slice(0, len - 1) + '…' : (str || '-')

// ── CURRENCY FORMATTERS ───────────────────────────────────────────────────────

const fmtINR_ppt = n => {
  if (!n || isNaN(n)) return '-'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}

const fmtINR_ui = n => {
  if (!n || isNaN(n)) return '—'
  const v = Number(n)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}

const fmtUSD_ppt = n => {
  if (!n || isNaN(n)) return '-'
  const v = Number(n)
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${Math.round(v).toLocaleString('en-US')}`
}

const fmtUSD_ui = n => {
  if (!n || isNaN(n)) return '—'
  const v = Number(n)
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${Math.round(v).toLocaleString('en-US')}`
}

// Convert a deal's value to USD
// Deals store: value (raw), currency, valueINR (always in INR)
const INR_PER_USD = 85
const getValueUSD = d => {
  if (d.currency === 'USD' && d.value) return Number(d.value) || 0
  const inr = Number(d.valueINR) || Number(d.value) || 0
  return inr / INR_PER_USD
}

const getValueINR = d => Number(d.valueINR) || Number(d.value) || 0

// ── PPT BUILDER ───────────────────────────────────────────────────────────────

/**
 * config: {
 *   companyFilter: 'UIPL' | 'Wayzim'
 *   companyLabel:  string  (display name)
 *   getVal:        (deal) => number
 *   fmtVal:        (number) => string
 *   accentHex:     hex color string (no #)
 *   accentPaleHex: hex color string (no #)
 *   filePrefix:    string
 * }
 */
async function buildPPT(allDeals, userProfile, config) {
  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_16x9'

  // Filter to this company
  const deals = allDeals.filter(d =>
    config.companyFilter === 'UIPL' ? d.company === 'UIPL' : d.company !== 'UIPL'
  )

  const { weekNum, range } = getBiWeeklyPeriod()
  const now = new Date()
  const fyLabel = getAYLabel()
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const todayISO = now.toISOString().slice(0, 10)
  const { getVal, fmtVal } = config

  const C = {
    navy: '1B2A4A', navyDk: '0F1D35',
    accent: config.accentHex,
    accentPale: config.accentPaleHex,
    white: 'FFFFFF', slate: '64748B', muted: '94A3B8',
    cardBg: 'F0F9FF',
    row0: 'FFFFFF', row1: 'F8FAFC',
    red: 'DC2626', redBg: 'FEE2E2', redDk: '991B1B',
    green: '15803D', greenBg: 'DCFCE7',
    text: '1E293B',
  }

  const hdr = (s, title, right = '') => {
    s.addShape('rect', { x: 0, y: 0, w: 10, h: 0.72, fill: { color: C.navyDk }, line: { type: 'none' } })
    s.addShape('rect', { x: 0, y: 0, w: 0.22, h: 0.72, fill: { color: C.accent }, line: { type: 'none' } })
    s.addText(title, { x: 0.4, y: 0, w: 7, h: 0.72, fontSize: 18, bold: true, color: C.white, fontFace: 'Calibri', valign: 'middle' })
    if (right) s.addText(right, { x: 7.2, y: 0, w: 2.6, h: 0.72, fontSize: 9, color: C.muted, fontFace: 'Calibri', valign: 'middle', align: 'right' })
  }

  // ── SLIDE 1: COVER ─────────────────────────────────────────────────────────
  const s1 = pres.addSlide()
  s1.background = { color: C.navyDk }
  s1.addShape('ellipse', { x: 7.0, y: -1.0, w: 4.8, h: 4.8, fill: { color: C.accent, transparency: 85 }, line: { type: 'none' } })
  s1.addShape('ellipse', { x: -1.4, y: 3.4, w: 4.0, h: 4.0, fill: { color: C.accent, transparency: 82 }, line: { type: 'none' } })

  s1.addText(config.companyLabel, {
    x: 0.8, y: 0.65, w: 8.4, h: 0.42,
    fontSize: 13, color: C.muted, fontFace: 'Calibri', align: 'center', italic: true,
  })
  s1.addText([
    { text: 'Bi-Weekly Opportunity', options: { fontSize: 34, bold: true, color: C.white, breakLine: true } },
    { text: 'Pipeline Report', options: { fontSize: 34, bold: true, color: C.white } },
  ], { x: 0.8, y: 1.1, w: 8.4, h: 1.55, fontFace: 'Calibri', align: 'center', valign: 'middle' })

  s1.addShape('roundRect', { x: 3.0, y: 2.82, w: 4.0, h: 0.56, fill: { color: C.accent }, line: { type: 'none' }, rectRadius: 0.09 })
  s1.addText(`Week ${weekNum}  ·  ${fyLabel}`, {
    x: 3.0, y: 2.82, w: 4.0, h: 0.56, fontSize: 14, bold: true,
    color: C.white, fontFace: 'Calibri', align: 'center', valign: 'middle',
  })
  s1.addText(`Period: ${range}`, {
    x: 0.8, y: 3.52, w: 8.4, h: 0.30, fontSize: 11, color: C.muted, fontFace: 'Calibri', align: 'center',
  })
  s1.addText(`${deals.length} Active Opportunities  ·  Values in ${config.currencyLabel}`, {
    x: 0.8, y: 3.88, w: 8.4, h: 0.30, fontSize: 11, color: '475569', fontFace: 'Calibri', align: 'center',
  })
  s1.addText(
    `Generated: ${dateStr}` +
    (userProfile?.name ? `  ·  Prepared by: ${userProfile.name}` : '') +
    '  ·  Udhishtha Innovations | IBS',
    { x: 0.8, y: 5.05, w: 8.4, h: 0.28, fontSize: 9, color: '475569', fontFace: 'Calibri', align: 'center' }
  )

  // ── SLIDE 2: EXECUTIVE SUMMARY ───────────────────────────────────────────────
  {
    const s = pres.addSlide()
    s.background = { color: C.white }
    hdr(s, `Executive Summary — ${config.companyLabel}`, `Week ${weekNum}  ·  ${dateStr}`)

    const totalVal   = deals.reduce((acc, d) => acc + getVal(d), 0)
    const overdueCnt = deals.filter(d => d.closingDate && d.closingDate < todayISO).length
    const closingCnt = deals.filter(d => (d.stage || 'lead') === 'closing').length
    const bidCnt     = deals.filter(d => (d.stage || 'lead') === 'bid').length

    const cards = [
      { val: String(deals.length),   label: 'Active Opportunities',   sub: `${overdueCnt} overdue`, vc: C.navy,   bg: C.cardBg,      sc: overdueCnt > 0 ? C.red : C.green },
      { val: fmtVal(totalVal),        label: `Pipeline (${config.currencyLabel})`, sub: 'Total pipeline value', vc: C.accent, bg: C.accentPale, sc: C.slate },
      { val: String(closingCnt),      label: 'Closing Stage', sub: 'Highest priority', vc: '7C3AED',  bg: 'F5F0FF',      sc: C.slate },
      { val: String(bidCnt),          label: 'Bid Stage',     sub: 'Active bids',      vc: 'B45309',  bg: 'FFFBEB',      sc: C.slate },
    ]

    const cW = 2.2, cH = 1.35, cG = 0.16, cX0 = 0.37, cY = 0.9
    cards.forEach((c, i) => {
      const cx = cX0 + i * (cW + cG)
      s.addShape('roundRect', { x: cx, y: cY, w: cW, h: cH, fill: { color: c.bg }, line: { type: 'none' }, rectRadius: 0.08 })
      s.addText(c.val, { x: cx + 0.1, y: cY + 0.08, w: cW - 0.2, h: 0.68, fontSize: 24, bold: true, color: c.vc, fontFace: 'Calibri', align: 'center', valign: 'middle' })
      s.addText(c.label, { x: cx + 0.1, y: cY + 0.76, w: cW - 0.2, h: 0.28, fontSize: 9, bold: true, color: C.text, fontFace: 'Calibri', align: 'center' })
      s.addText(c.sub,   { x: cx + 0.1, y: cY + 1.03, w: cW - 0.2, h: 0.26, fontSize: 8, color: c.sc, fontFace: 'Calibri', align: 'center' })
    })

    const byStage = OPEN_STAGES.map(id => ({
      label: STAGE_LABELS[id],
      count: deals.filter(d => (d.stage || 'lead') === id).length,
      val:   deals.filter(d => (d.stage || 'lead') === id).reduce((acc, d) => acc + getVal(d), 0),
    }))

    s.addText('Pipeline by Stage', { x: 0.37, y: 2.42, w: 4.5, h: 0.30, fontSize: 11, bold: true, color: C.navy, fontFace: 'Calibri' })

    const stRows = [
      ['Stage', '# Opportunities', `Value (${config.currencyLabel})`, '% Share'].map(t => ({
        text: t, options: { bold: true, color: C.white, fill: { color: C.navy }, fontSize: 9, align: 'center', fontFace: 'Calibri' },
      })),
      ...byStage.map(st => {
        const pct = deals.length ? Math.round((st.count / deals.length) * 100) : 0
        return [
          { text: st.label,           options: { fontSize: 9, color: C.text,  fill: { color: C.cardBg }, bold: true, fontFace: 'Calibri' } },
          { text: String(st.count),   options: { fontSize: 9, color: C.navy,  fill: { color: C.cardBg }, bold: true, align: 'center', fontFace: 'Calibri' } },
          { text: fmtVal(st.val),     options: { fontSize: 9, color: C.accent,fill: { color: C.cardBg }, bold: true, align: 'right', fontFace: 'Calibri' } },
          { text: `${pct}%`,          options: { fontSize: 9, color: C.slate, fill: { color: C.cardBg }, align: 'center', fontFace: 'Calibri' } },
        ]
      }),
    ]

    s.addTable(stRows, {
      x: 0.37, y: 2.78, w: 4.5,
      colW: [1.35, 0.9, 1.55, 0.70],
      border: { pt: 0.5, color: 'E2E8F0' },
      rowH: 0.44,
    })

    s.addChart(pres.charts.BAR, [{
      name: 'Opportunities',
      labels: byStage.map(st => st.label),
      values: byStage.map(st => st.count),
    }], {
      x: 5.1, y: 2.42, w: 4.55, h: 2.85,
      barDir: 'col',
      chartColors: [STAGE_HEX.lead, STAGE_HEX.prebid, STAGE_HEX.bid, STAGE_HEX.closing],
      chartArea: { fill: { color: C.white } },
      showValue: true,
      dataLabelFontSize: 11,
      dataLabelColor: C.text,
      catAxisLabelColor: C.slate,
      catAxisLabelFontSize: 10,
      valAxisLabelColor: C.slate,
      valAxisLabelFontSize: 9,
      valGridLine: { color: 'E2E8F0', size: 0.5 },
      catGridLine: { style: 'none' },
      showLegend: false,
      showTitle: true,
      title: 'Opportunities by Stage',
      titleColor: C.navy,
      titleFontSize: 11,
    })
  }

  // ── Sort all deals by stage priority then closing date ────────────────────
  const sorted = [...deals].sort((a, b) => {
    const o = { closing: 0, bid: 1, prebid: 2, lead: 3 }
    const da = o[a.stage || 'lead'] ?? 4
    const db_ = o[b.stage || 'lead'] ?? 4
    if (da !== db_) return da - db_
    return (a.closingDate || '9999').localeCompare(b.closingDate || '9999')
  })

  // ── Helper: latest update PER assigned team member for a deal ─────────────
  // Previously this only surfaced the single most-recent update on the deal
  // overall, which in practice meant whichever teammate happened to log last
  // silently hid everyone else's updates. This instead shows one line per
  // assigned team member (sales manager + team members), each their own
  // latest update — only for members who've actually posted one.
  const getTeamUpdates = (d) => {
    const acts = (d.activities || []).map(a => ({
      uid: a.addedBy, name: a.addedByName,
      date: (a.at || a.createdAt || '').slice(0, 10),
      text: (a.summary || a.note || a.text || '').trim(),
    }))
    const notes = (d.meetingNotes || []).map(n => ({
      uid: n.addedBy, name: n.addedByName,
      date: n.date || (n.createdAt || '').slice(0, 10),
      text: (n.nextAction || n.discussion || n.agenda || '').trim(),
    }))
    const all = [...acts, ...notes]
      .filter(e => e.text)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

    // Assigned team for this deal — sales manager first, then team members.
    const team = []
    if (d.salesManagerId) team.push({ uid: d.salesManagerId, name: d.salesManagerName || d.assignedToName || 'Sales Manager' })
    ;(d.teamMembers || []).forEach(t => {
      if (t.userId && !team.some(m => m.uid === t.userId)) team.push({ uid: t.userId, name: t.userName || t.name || 'Team member' })
    })

    const perMember = team
      .map(m => ({ name: m.name, entry: all.find(e => e.uid === m.uid) }))
      .filter(m => m.entry)

    if (perMember.length === 0) {
      // No author-tagged update matched an assigned member (legacy data, or
      // nobody assigned yet) — fall back to the single most recent update.
      const latest = all[0]
      return latest ? [{ name: '', date: latest.date, text: latest.text.slice(0, 200) }] : [{ name: '', date: '', text: 'No updates yet' }]
    }
    return perMember.map(m => ({ name: m.name, date: m.entry.date, text: m.entry.text.slice(0, 140) }))
  }

  // ── SLIDES 3+: PER-SALESPERSON ─────────────────────────────────────────────
  // Group active deals by sales manager
  const smMap = {}
  sorted.forEach(d => {
    const name = d.salesManagerName || d.assignedToName || 'Unassigned'
    if (!smMap[name]) smMap[name] = []
    smMap[name].push(d)
  })

  const ROWS_PER_SM_SLIDE = 7
  for (const [smName, smDeals] of Object.entries(smMap)) {
    const totalSmPages = Math.max(1, Math.ceil(smDeals.length / ROWS_PER_SM_SLIDE))
    for (let pg = 0; pg < totalSmPages; pg++) {
      const chunk    = smDeals.slice(pg * ROWS_PER_SM_SLIDE, (pg + 1) * ROWS_PER_SM_SLIDE)
      const startIdx = pg * ROWS_PER_SM_SLIDE
      const pageLabel = totalSmPages > 1 ? ` (${pg + 1}/${totalSmPages})` : ''

      const s = pres.addSlide()
      s.background = { color: C.white }
      hdr(s, `${smName} — Active Opportunities (${smDeals.length})${pageLabel}`, `Week ${weekNum}  ·  ${config.companyLabel}`)

      const hRow = ['#', 'Opportunity', 'Customer', 'Stage', 'Value', 'Close', 'Product / Throughput', 'Latest Update'].map(t => ({
        text: t, options: { bold: true, color: C.white, fill: { color: C.navy }, fontSize: 8, align: 'center', fontFace: 'Calibri' },
      }))
      const tRows = [hRow]
      chunk.forEach((d, i) => {
        const bg      = i % 2 === 0 ? C.row0 : C.row1
        const val     = getVal(d)
        const ov      = d.closingDate && d.closingDate < todayISO
        const updates = getTeamUpdates(d)
        const prods   = d.products || []
        const prodTxt = prods.length ? (prods.length > 3 ? `${prods.slice(0, 3).join(', ')} +${prods.length - 3}` : prods.join(', ')) : ''
        const thrTxt  = d.throughputPPH ? `⚡ ${Number(d.throughputPPH).toLocaleString()} PPH` : ''
        const prodLines = [prodTxt, thrTxt].filter(Boolean)
        tRows.push([
          { text: String(startIdx + i + 1),
            options: { align: 'center', fontSize: 7.5, fill: { color: bg }, color: C.slate, fontFace: 'Calibri', valign: 'top' } },
          { text: d.title || '-',
            options: { fontSize: 7.5, fill: { color: bg }, color: C.text, bold: true, fontFace: 'Calibri', wrap: true, valign: 'top' } },
          { text: (d.customerName || d.endCustomerName || '-'),
            options: { fontSize: 7.5, fill: { color: bg }, color: C.text, fontFace: 'Calibri', wrap: true, valign: 'top' } },
          { text: STAGE_LABELS[d.stage || 'lead'] || '-',
            options: { fontSize: 7.5, fill: { color: bg }, color: STAGE_HEX[d.stage] || C.slate, bold: true, align: 'center', fontFace: 'Calibri', valign: 'top' } },
          { text: val ? fmtVal(val) : '-',
            options: { fontSize: 7.5, fill: { color: bg }, color: C.accent, bold: true, align: 'right', fontFace: 'Calibri', valign: 'top' } },
          { text: d.closingDate || '-',
            options: { fontSize: 7.5, fill: { color: ov ? C.redBg : bg }, color: ov ? C.red : C.text, align: 'center', fontFace: 'Calibri', valign: 'top' } },
          { text: prodLines.length
              ? prodLines.map((l, idx) => ({ text: l, options: { breakLine: idx < prodLines.length - 1 } }))
              : '-',
            options: { fontSize: 7, fill: { color: bg }, color: C.text, fontFace: 'Calibri', wrap: true, valign: 'top' } },
          { text: updates.map((u, idx) => ({
              text: u.name ? `${u.name}${u.date ? ` [${u.date}]` : ''}: ${u.text}` : (u.text || '-'),
              options: { breakLine: idx < updates.length - 1, bold: idx === 0 && updates.length > 1 },
            })),
            options: { fontSize: 7, fill: { color: bg }, color: C.slate, fontFace: 'Calibri', wrap: true, valign: 'top' } },
        ])
      })
      // rowH as array: header at 0.36", each data row at 0.58" → fits within slide
      s.addTable(tRows, {
        x: 0.35, y: 0.88, w: 9.3,
        colW: [0.25, 1.85, 1.15, 0.62, 0.78, 0.72, 1.15, 2.78],
        border: { pt: 0.5, color: 'E2E8F0' },
        rowH: [0.36, ...Array(chunk.length).fill(0.58)],
      })
    }
  }

  // ── LAST SLIDE: HIGHLIGHTS ─────────────────────────────────────────────────
  {
    const s = pres.addSlide()
    s.background = { color: C.white }
    hdr(s, `Key Highlights — ${config.companyLabel}`, `Week ${weekNum}`)

    const overdueDs = [...deals]
      .filter(d => d.closingDate && d.closingDate < todayISO)
      .sort((a, b) => (a.closingDate || '').localeCompare(b.closingDate || ''))
      .slice(0, 7)

    const topDs = [...deals]
      .sort((a, b) => getVal(b) - getVal(a))
      .slice(0, 6)

    const hasOverdue = overdueDs.length > 0
    s.addShape('roundRect', { x: 0.35, y: 0.88, w: 4.5, h: 0.38, fill: { color: hasOverdue ? C.redBg : C.greenBg }, line: { type: 'none' }, rectRadius: 0.05 })
    s.addText(hasOverdue ? `⚠ Overdue (${overdueDs.length})` : '✓ No Overdue Opportunities', {
      x: 0.5, y: 0.88, w: 4.2, h: 0.38, fontSize: 11, bold: true,
      color: hasOverdue ? C.redDk : C.green, fontFace: 'Calibri', valign: 'middle',
    })

    if (hasOverdue) {
      const oRows = [
        ['Opportunity', 'Customer', 'Due Date', 'Days Late'].map(t => ({
          text: t, options: { bold: true, color: C.white, fill: { color: C.redDk }, fontSize: 9, fontFace: 'Calibri' },
        })),
        ...overdueDs.map((d, i) => {
          const bg   = i % 2 === 0 ? C.row0 : 'FFF1F2'
          const late = Math.abs(Math.ceil((new Date(d.closingDate) - now) / 86400000))
          return [
            { text: trunc(d.title || '-', 28),           options: { fontSize: 8, fill: { color: bg }, color: C.text, bold: true, fontFace: 'Calibri' } },
            { text: trunc(d.customerName || '-', 18),    options: { fontSize: 8, fill: { color: bg }, color: C.text, fontFace: 'Calibri' } },
            { text: d.closingDate || '-',                 options: { fontSize: 8, fill: { color: bg }, color: C.red, bold: true, align: 'center', fontFace: 'Calibri' } },
            { text: `${late}d`,                           options: { fontSize: 8, fill: { color: C.redBg }, color: C.red, bold: true, align: 'center', fontFace: 'Calibri' } },
          ]
        }),
      ]
      s.addTable(oRows, {
        x: 0.35, y: 1.32, w: 4.5,
        colW: [1.65, 1.3, 0.92, 0.63],
        border: { pt: 0.5, color: 'FECACA' },
        rowH: 0.38,
      })
    } else {
      s.addText('All opportunities are on track. Great work!', {
        x: 0.35, y: 1.38, w: 4.5, h: 0.5, fontSize: 11, color: C.green, fontFace: 'Calibri', italic: true,
      })
    }

    // Right: Top by value
    s.addShape('roundRect', { x: 5.15, y: 0.88, w: 4.5, h: 0.38, fill: { color: C.accentPale }, line: { type: 'none' }, rectRadius: 0.05 })
    s.addText(`Top Opportunities by Value (${config.currencyLabel})`, {
      x: 5.3, y: 0.88, w: 4.2, h: 0.38, fontSize: 10, bold: true, color: C.navy, fontFace: 'Calibri', valign: 'middle',
    })

    if (topDs.length > 0) {
      const tvRows = [
        ['Opportunity', 'Stage', `Value (${config.currencyLabel})`, 'Manager'].map(t => ({
          text: t, options: { bold: true, color: C.white, fill: { color: C.navy }, fontSize: 9, fontFace: 'Calibri' },
        })),
        ...topDs.map((d, i) => {
          const bg  = i % 2 === 0 ? C.row0 : C.row1
          const val = getVal(d)
          return [
            { text: trunc(d.title || '-', 30),                           options: { fontSize: 8, fill: { color: bg }, color: C.text, bold: true, fontFace: 'Calibri' } },
            { text: STAGE_LABELS[d.stage || 'lead'] || '-',              options: { fontSize: 8, fill: { color: bg }, color: STAGE_HEX[d.stage] || C.slate, bold: true, align: 'center', fontFace: 'Calibri' } },
            { text: fmtVal(val),                                          options: { fontSize: 8, fill: { color: bg }, color: C.accent, bold: true, align: 'right', fontFace: 'Calibri' } },
            { text: trunc((d.salesManagerName || '-').split(' ')[0], 12), options: { fontSize: 8, fill: { color: bg }, color: C.text, fontFace: 'Calibri' } },
          ]
        }),
      ]
      s.addTable(tvRows, {
        x: 5.15, y: 1.32, w: 4.5,
        colW: [1.9, 0.88, 1.05, 0.67],
        border: { pt: 0.5, color: 'DBEAFE' },
        rowH: 0.38,
      })
    }
  }

  const fileName = `${config.filePrefix}-W${String(weekNum).padStart(2, '0')}-${now.getFullYear()}.pptx`
  await pres.writeFile({ fileName })
  return { weekNum, fileName }
}

// ── CONFIGS ───────────────────────────────────────────────────────────────────

const UIPL_CFG = {
  companyFilter:  'UIPL',
  companyLabel:   'UIPL',
  getVal:         getValueINR,
  fmtVal:         fmtINR_ppt,
  currencyLabel:  'INR',
  accentHex:      '1D4ED8',
  accentPaleHex:  'EFF6FF',
  filePrefix:     'BiWeekly-UIPL',
}

const WAYZIM_CFG = {
  companyFilter:  'Wayzim',
  companyLabel:   'Wayzim Technology Co Ltd',
  getVal:         getValueUSD,
  fmtVal:         fmtUSD_ppt,
  currencyLabel:  'USD',
  accentHex:      '7C3AED',
  accentPaleHex:  'F5F0FF',
  filePrefix:     'BiWeekly-Wayzim',
}

// ── COMPONENT ─────────────────────────────────────────────────────────────────

const STAGE_UI = {
  lead:    'bg-slate-100 text-slate-700',
  prebid:  'bg-blue-100 text-blue-700',
  bid:     'bg-amber-100 text-amber-700',
  closing: 'bg-purple-100 text-purple-700',
}

export default function BiWeeklyReport() {
  const { user, userProfile } = useAuth()
  const isAdmin    = userProfile?.role === 'admin'
  const role       = userProfile?.role || ''
  const isWideViewer = role === 'solution_manager' || role === 'sales_director'
  const uid        = user?.uid || ''

  const [deals,   setDeals]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Per-report generate state
  const [genUIPL,   setGenUIPL]   = useState(false)
  const [genWayzim, setGenWayzim] = useState(false)
  const [lastUIPL,  setLastUIPL]  = useState(null)
  const [lastWayzim,setLastWayzim]= useState(null)
  const [errUIPL,   setErrUIPL]   = useState(null)
  const [errWayzim, setErrWayzim] = useState(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const snap = await getDocs(collection(db, 'crm_deals'))
      const data = []
      snap.forEach(d => data.push({ id: d.id, ...d.data() }))
      setDeals(data)
    } catch (e) {
      setError('Failed to load opportunities: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const activeDeals = useMemo(() => deals.filter(d => {
    if (!ACTIVE_STAGES.includes(d.stage || 'lead')) return false
    if (!isAdmin) {
      const ids = d.assignedUserIds || (d.assignedToId ? [d.assignedToId] : [])
      if (ids.includes(uid)) return true
      if (isWideViewer) return true
      return false
    }
    return true
  }), [deals, isAdmin, uid, isWideViewer])

  const uiplDeals   = useMemo(() => activeDeals.filter(d => d.company === 'UIPL'),   [activeDeals])
  const wayzimDeals = useMemo(() => activeDeals.filter(d => d.company !== 'UIPL'),   [activeDeals])

  const uiplValTotal   = useMemo(() => uiplDeals.reduce((s, d) => s + getValueINR(d), 0),   [uiplDeals])
  const wayzimValTotal = useMemo(() => wayzimDeals.reduce((s, d) => s + getValueUSD(d), 0), [wayzimDeals])

  const overdueUIPL   = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return uiplDeals.filter(d => d.closingDate && d.closingDate < today).length
  }, [uiplDeals])
  const overdueWayzim = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return wayzimDeals.filter(d => d.closingDate && d.closingDate < today).length
  }, [wayzimDeals])

  const { weekNum, range } = getBiWeeklyPeriod()

  // Slide count: Cover + Exec Summary + per-salesperson slides + deal tables + Highlights
  const ROWS_PER_SLIDE = 7

  // Count total SM slides (per SM, paginated at ROWS_PER_SLIDE)
  const uiplSMSlides = useMemo(() => {
    const m = {}
    uiplDeals.forEach(d => { const n = d.salesManagerName || d.assignedToName || 'Unassigned'; m[n] = (m[n] || 0) + 1 })
    return Object.values(m).reduce((s, cnt) => s + Math.ceil(cnt / ROWS_PER_SLIDE), 0)
  }, [uiplDeals])
  const wayzimSMSlides = useMemo(() => {
    const m = {}
    wayzimDeals.forEach(d => { const n = d.salesManagerName || d.assignedToName || 'Unassigned'; m[n] = (m[n] || 0) + 1 })
    return Object.values(m).reduce((s, cnt) => s + Math.ceil(cnt / ROWS_PER_SLIDE), 0)
  }, [wayzimDeals])

  const uiplSlides   = 2 + Math.max(1, uiplSMSlides)   + 1  // Cover + Exec + SM slides + Highlights
  const wayzimSlides = 2 + Math.max(1, wayzimSMSlides) + 1

  const handleGenerate = async (cfg, deals_, setGen, setLast, setErr) => {
    if (deals_.length === 0) return
    setGen(true); setErr(null)
    try {
      await buildPPT(activeDeals, userProfile, cfg)
      setLast(new Date().toLocaleTimeString('en-IN'))
    } catch (e) {
      console.error(e)
      setErr('PPT generation failed: ' + e.message)
    } finally {
      setGen(false)
    }
  }

  const sortedActive = useMemo(() => {
    const o = { closing: 0, bid: 1, prebid: 2, lead: 3 }
    return [...activeDeals].sort((a, b) =>
      (o[a.stage || 'lead'] ?? 4) - (o[b.stage || 'lead'] ?? 4) ||
      (a.closingDate || '9999').localeCompare(b.closingDate || '9999')
    )
  }, [activeDeals])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading opportunities…</div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Bi-Weekly Report</h2>
        <p className="text-sm text-slate-500 mt-0.5">Week {weekNum} · {range}</p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      {/* Two report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* UIPL Report */}
        <div className="bg-white rounded-xl border-2 border-blue-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🏢</span>
            <h3 className="text-base font-bold text-blue-800">UIPL Report</h3>
            <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">INR ₹</span>
          </div>
          <p className="text-xs text-slate-500 mb-4">Only UIPL opportunities · Values in Indian Rupees · {isAdmin || isWideViewer ? 'All salespeople' : 'Your opportunities only'}</p>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: 'Opportunities', val: uiplDeals.length, cls: 'text-blue-700' },
              { label: 'Pipeline', val: fmtINR_ui(uiplValTotal), cls: 'text-teal-700' },
              { label: 'Overdue', val: overdueUIPL, cls: overdueUIPL > 0 ? 'text-red-600' : 'text-green-600' },
            ].map((c, i) => (
              <div key={i} className="bg-slate-50 rounded-xl p-2 text-center">
                <p className={`text-lg font-bold ${c.cls}`}>{c.val}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{c.label}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => handleGenerate(UIPL_CFG, uiplDeals, setGenUIPL, setLastUIPL, setErrUIPL)}
            disabled={genUIPL || uiplDeals.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition text-sm"
          >
            {genUIPL
              ? <><span className="animate-spin inline-block">⏳</span> Generating…</>
              : <>📊 Generate UIPL Report ({uiplSlides} slides)</>}
          </button>
          {lastUIPL && <p className="text-xs text-green-600 mt-2 text-center">✅ Downloaded at {lastUIPL}</p>}
          {errUIPL  && <p className="text-xs text-red-600 mt-2">{errUIPL}</p>}
          {uiplDeals.length === 0 && <p className="text-xs text-slate-400 mt-2 text-center">No active UIPL opportunities</p>}
        </div>

        {/* Wayzim Report */}
        <div className="bg-white rounded-xl border-2 border-purple-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🌐</span>
            <h3 className="text-base font-bold text-purple-800">Wayzim Report</h3>
            <span className="ml-auto text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">USD $</span>
          </div>
          <p className="text-xs text-slate-500 mb-4">Only Wayzim opportunities · Values in US Dollars · {isAdmin || isWideViewer ? 'All salespeople' : 'Your opportunities only'}</p>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: 'Opportunities', val: wayzimDeals.length, cls: 'text-purple-700' },
              { label: 'Pipeline', val: fmtUSD_ui(wayzimValTotal), cls: 'text-teal-700' },
              { label: 'Overdue', val: overdueWayzim, cls: overdueWayzim > 0 ? 'text-red-600' : 'text-green-600' },
            ].map((c, i) => (
              <div key={i} className="bg-slate-50 rounded-xl p-2 text-center">
                <p className={`text-lg font-bold ${c.cls}`}>{c.val}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{c.label}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => handleGenerate(WAYZIM_CFG, wayzimDeals, setGenWayzim, setLastWayzim, setErrWayzim)}
            disabled={genWayzim || wayzimDeals.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition text-sm"
          >
            {genWayzim
              ? <><span className="animate-spin inline-block">⏳</span> Generating…</>
              : <>📊 Generate Wayzim Report ({wayzimSlides} slides)</>}
          </button>
          {lastWayzim && <p className="text-xs text-green-600 mt-2 text-center">✅ Downloaded at {lastWayzim}</p>}
          {errWayzim  && <p className="text-xs text-red-600 mt-2">{errWayzim}</p>}
          {wayzimDeals.length === 0 && <p className="text-xs text-slate-400 mt-2 text-center">No active Wayzim opportunities</p>}
        </div>
      </div>

      {/* Combined preview table */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-200/70 overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold text-slate-700">All Active Opportunities ({activeDeals.length})</h3>
          <div className="flex gap-3 text-xs text-slate-500">
            <span className="text-blue-700 font-semibold">UIPL: {uiplDeals.length} opportunities</span>
            <span className="text-purple-700 font-semibold">Wayzim: {wayzimDeals.length} opportunities</span>
          </div>
        </div>

        {activeDeals.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No active opportunities found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                <tr className="bg-slate-800 text-slate-200 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2.5">Opportunity</th>
                  <th className="text-left px-3 py-2.5 hidden sm:table-cell">Customer</th>
                  <th className="text-center px-2 py-2.5">Co.</th>
                  <th className="text-center px-2 py-2.5">Stage</th>
                  <th className="text-right px-3 py-2.5">Value</th>
                  <th className="text-center px-3 py-2.5 hidden sm:table-cell">Close Date</th>
                  <th className="text-left px-3 py-2.5 hidden md:table-cell">Manager</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedActive.map(d => {
                  const today    = new Date().toISOString().slice(0, 10)
                  const isOverdue = d.closingDate && d.closingDate < today
                  const isWayzim  = d.company !== 'UIPL'
                  const valDisp   = isWayzim ? fmtUSD_ui(getValueUSD(d)) : fmtINR_ui(getValueINR(d))
                  return (
                    <tr key={d.id} className={`hover:bg-slate-50 ${isWayzim ? 'border-l-2 border-purple-300' : 'border-l-2 border-blue-300'}`}>
                      <td className="px-3 py-2 font-medium text-slate-800 max-w-[180px] truncate">{d.title || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 max-w-[160px] truncate hidden sm:table-cell">{d.customerName || '—'}</td>
                      <td className="px-2 py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded-lg text-xs font-bold ${isWayzim ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {isWayzim ? 'WTL' : 'UIPL'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_UI[d.stage || 'lead'] || ''}`}>
                          {STAGE_LABELS[d.stage || 'lead'] || d.stage}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-semibold text-teal-700">{valDisp}</td>
                      <td className={`px-3 py-2 text-center text-xs hidden sm:table-cell ${isOverdue ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                        {d.closingDate || '—'}{isOverdue ? ' ⚠' : ''}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs hidden md:table-cell">
                        {(d.salesManagerName || d.assignedToName || '—').split(' ').slice(0, 2).join(' ')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PPT slide map */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: 'UIPL Report', slides: uiplSlides, weekNum, smSlides: uiplSMSlides, cls: 'border-blue-200', hcls: 'text-blue-700' },
          { label: 'Wayzim Report', slides: wayzimSlides, weekNum, smSlides: wayzimSMSlides, cls: 'border-purple-200', hcls: 'text-purple-700' },
        ].map((r, ri) => (
          <div key={ri} className={`bg-slate-50 rounded-xl border ${r.cls} p-4`}>
            <h3 className={`text-xs font-bold uppercase tracking-wide mb-2 ${r.hcls}`}>{r.label} — PPT Slides</h3>
            <div className="flex flex-wrap gap-1.5">
              {[
                `1 – Cover (Week ${r.weekNum})`,
                '2 – Executive Summary',
                ...Array.from({ length: Math.max(1, r.smSlides) }, (_, i) =>
                  `${3 + i} – Salesperson ${i + 1}`),
                `${r.slides} – Highlights`,
              ].map((sl, i) => (
                <span key={i} className="bg-white border border-slate-200 rounded-lg px-2 py-0.5 text-xs text-slate-600">{sl}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}
