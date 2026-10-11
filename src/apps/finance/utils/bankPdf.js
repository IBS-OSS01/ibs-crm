// Bank statements in PDF form → statement lines (same shape the Excel/CSV importer produces).
// Works on the text layer of the PDF (no OCR): rows are rebuilt from the position of every word, the header row
// ("Value Date · Credit amount · Debit amount · Balance …") fixes the columns, and any line below a transaction that
// has no date (wrapped reference, "Narrative …") is folded into that transaction.
// Written against HSBC India's "Statement details" export; other banks that print one table with a header row
// (Date / Narration / Withdrawal / Deposit / Balance) go through the same code path.
import { r2 } from './financeConstants.js'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function parsePdfDate(v) {
  const s = String(v ?? '').trim()
  let m = /^(\d{1,2})[\s/.-]+([A-Za-z]{3,9})[\s/.-]+(\d{2,4})$/.exec(s)
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1
    if (!mo) return ''
    return `${m[3].length === 2 ? 2000 + Number(m[3]) : m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s)
  if (m) return `${m[3].length === 2 ? 2000 + Number(m[3]) : m[3]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
  return ''
}

const money = (v) => {
  const t = String(v ?? '').trim(); if (!t) return null
  const neg = /^\(.*\)$/.test(t) || /-/.test(t) || /\bDr\b/i.test(t)
  const n = Number(t.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && /\d/.test(t) ? (neg ? -n : n) : null
}

// header text → column key (order matters: the specific names first)
const HEADS = [
  ['custRef', /customer\s*ref/i], ['ref', /(bank\s*ref|ref(erence)?\s*no|chq|cheque|instrument|utr)/i], ['type', /(trn|txn|transaction)\s*type|^type$|^mode$/i],
  ['valueDate', /value\s*date/i], ['postDate', /post(ing)?\s*date/i], ['date', /^(txn\s*|transaction\s*)?date$/i],
  ['credit', /credit|deposit|paid\s*in/i], ['debit', /debit|withdraw|paid\s*out/i], ['balance', /balance/i], ['time', /^time$/i],
  ['desc', /(narrat|descript|particular|remark|detail)/i],
]
const headKey = (s) => { const t = String(s).trim(); const h = HEADS.find(([, re]) => re.test(t)); return h ? h[0] : '' }

// pages: [[{ x, y, s }]]  (pdf coordinates: y grows upwards)
export function parseStatementPages(pages) {
  if (!pages.some(items => items.some(i => String(i.s).trim().length > 1))) {
    return { lines: [], error: 'This PDF has no readable text — it is a picture of the statement (a scan). Download the transaction report from HSBC Net Banking (Accounts → Statements → “Statement details”) as PDF, Excel or CSV instead.' }
  }
  const raw = []
  let cols = null
  let cur = null
  const flush = () => { if (cur) raw.push(cur); cur = null }

  for (const items of pages) {
    const sorted = items.filter(i => String(i.s).trim()).sort((a, b) => b.y - a.y || a.x - b.x)
    const rows = []
    for (const it of sorted) {
      const last = rows[rows.length - 1]
      if (last && Math.abs(last.y - it.y) <= 3) last.items.push(it); else rows.push({ y: it.y, items: [it] })
    }
    rows.forEach(r => r.items.sort((a, b) => a.x - b.x))

    for (const row of rows) {
      const texts = row.items.map(i => String(i.s).trim())
      // header row?
      const keys = row.items.map(i => headKey(i.s))
      if (keys.includes('credit') && keys.includes('debit') && keys.some(k => /date/i.test(k))) {
        cols = row.items.map((i, n) => ({ key: keys[n], x: i.x })).filter(c => c.key)
        continue
      }
      if (!cols) continue
      if (texts.some(t => /^page$/i.test(t)) && texts.some(t => /account number/i.test(t))) continue   // running footer
      const colOf = (x) => { let hit = null; for (const c of cols) if (c.x <= x + 3) hit = c; return hit ? hit.key : cols[0].key }

      const byCol = {}
      row.items.forEach(i => { const k = colOf(i.x); (byCol[k] = byCol[k] || []).push(String(i.s).trim()) })
      const val = (k) => (byCol[k] || []).join(' ').trim()
      const dateStr = val('valueDate') || val('date') || val('postDate')
      const date = parsePdfDate(dateStr)
      const hasAmt = money(val('credit')) !== null || money(val('debit')) !== null

      if (date && hasAmt) {
        flush()
        cur = { date, postDate: parsePdfDate(val('postDate')), ref: val('ref'), custRef: val('custRef'), type: val('type'), time: val('time'),
          credit: money(val('credit')), debit: money(val('debit')), balance: money(val('balance')), narr: val('desc') ? [val('desc')] : [] }
        continue
      }
      if (!cur) continue
      // continuation line of the current transaction
      const labelled = texts[0] && /^narrative$/i.test(texts[0])
      if (labelled) { const rest = row.items.slice(1).map(i => String(i.s).trim()).join(' ').trim(); if (rest) cur.narr.push(rest); continue }
      const first = cols[0].key
      row.items.forEach(i => {
        const k = colOf(i.x), s = String(i.s).trim()
        if (k === first && first === 'ref') cur.ref += s          // wrapped reference number
        else cur.narr.push(s)
      })
    }
  }
  flush()

  if (!raw.length) return { lines: [], error: 'No transactions found in this PDF. It needs a text layer (not a scanned image) and a header row with Date, Debit / Withdrawal and Credit / Deposit columns.' }

  // statements are often printed newest first — store oldest first so balances chain and same-day order is right
  const newestFirst = raw.length > 1 && raw[0].date > raw[raw.length - 1].date
  const ordered = newestFirst ? raw.slice().reverse() : raw
  const lines = ordered.map(t => {
    const bankRef = /^nonref$/i.test(t.ref) ? '' : t.ref
    const custRef = /^nonref$/i.test(t.custRef || '') ? '' : (t.custRef || '')
    const narrative = t.narr.join(' ').replace(/\s+/g, ' ').trim()
    return {
      date: t.date, description: [custRef && !narrative.includes(custRef) ? custRef : '', narrative].filter(Boolean).join(' · ').slice(0, 300) || t.type || '',
      ref: bankRef || custRef, debit: r2(Math.abs(t.debit || 0)), credit: r2(Math.abs(t.credit || 0)), balance: t.balance === null ? null : t.balance,
      ...(t.type ? { trnType: t.type } : {}), ...(t.postDate ? { postDate: t.postDate } : {}), ...(t.time ? { time: t.time } : {}),
    }
  }).filter(l => l.debit || l.credit)

  // sanity check: each balance should equal the previous balance ± the movement
  let breaks = 0
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i]
    if (a.balance !== null && b.balance !== null && Math.abs(r2(a.balance + b.credit - b.debit) - b.balance) > 0.02) breaks++
  }
  return { lines, meta: { newestFirst, balanceBreaks: breaks, from: lines[0]?.date, to: lines[lines.length - 1]?.date } }
}

// Browser: read the text layer of every page with pdf.js (lazy-loaded; shares the chunk used for attachments).
export async function readPdfPages(file) {
  const pdfjs = await import('pdfjs-dist/build/pdf.js')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  let pdf
  try { pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise }
  catch (e) { throw new Error(/password/i.test(e?.name + e?.message) ? 'This PDF is password-protected — remove the password (open it, then print / save as a new PDF) and try again.' : e.message) }
  const pages = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent()
    pages.push(tc.items.map(i => ({ x: Math.round(i.transform[4]), y: Math.round(i.transform[5] * 10) / 10, s: i.str })))
  }
  return pages
}
