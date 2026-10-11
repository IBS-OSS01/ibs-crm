// Scanned bank statements (a PDF that is only a picture of the page, e.g. HSBC's monthly "Statement of Accounts").
// 1. each page is drawn to a canvas and read with Tesseract OCR (loaded on demand, runs in the browser — nothing is uploaded);
// 2. the words are put back into rows and columns (Date · Details · Withdrawals · Deposits · Balance);
// 3. every running balance is checked against the amounts, and a misread digit is repaired from the balance chain
//    whenever the chain makes the right value certain; anything that cannot be settled is reported.
import { r2 } from './financeConstants.js'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const MONEY = /^\d{1,3}(,\d{3})*\.\d{2}$|^\d+\.\d{2}$/
const OCR_LETTER = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z' }

// "010CT2025" → 2025-10-01 (OCR reads the O of OCT as a zero)
export function parseScanDate(tok) {
  const m = /^(\d{2})([A-Z0-9]{3})(\d{4})$/.exec(String(tok).toUpperCase().replace(/[^A-Z0-9]/g, ''))
  if (!m) return ''
  const mon = [...m[2]].map(c => OCR_LETTER[c] || c).join('')
  const score = (x) => [...x].filter((c, i) => c === mon[i]).length                          // tolerate one wrong letter, but prefer an exact month
  const best = Math.max(...MONTHS.map(score)), idx = MONTHS.findIndex(x => score(x) === best)
  const day = Number(m[1])
  if (best < 2 || MONTHS.filter(x => score(x) === best).length > 1 || day < 1 || day > 31) return ''
  return `${m[3]}-${String(idx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const money = (t) => Number(String(t).replace(/,/g, ''))

// pages: [{ w, words: [{ t, x0, y0, x1, y1 }] }]
export function parseScannedStatement(pages) {
  const txns = []
  let pending = [], pendingDate = '', lastDate = '', opening = null, closing = null, started = false

  for (const pg of pages) {
    const W = pg.w
    const ws = pg.words.filter(w => String(w.t).trim()).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    const rows = []
    for (const w of ws) { const c = (w.y0 + w.y1) / 2, r = rows.find(r => Math.abs(r.y - c) < 14); if (r) r.w.push(w); else rows.push({ y: c, w: [w] }) }
    rows.sort((a, b) => a.y - b.y).forEach(r => r.w.sort((a, b) => a.x0 - b.x0))
    // the table starts below the "(DR=Debit)" heading of each page
    const startIdx = rows.findIndex(r => /\(?DR\s*=\s*Debit\)?/i.test(r.w.map(w => w.t).join(' ')))
    if (startIdx < 0) continue
    for (const row of rows.slice(startIdx + 1)) {
      const text = row.w.map(w => w.t).join(' ')
      const amts = row.w.filter(w => MONEY.test(w.t) && w.x0 > W * 0.5)
      const bal = amts.find(w => w.x1 >= W * 0.84)
      if (/(Brought\s*Forward|OPENING\s*BALANCE)/i.test(text)) { if (bal && opening === null) opening = money(bal.t); started = true; const d = row.w.map(w => parseScanDate(w.t)).find(Boolean); if (d) lastDate = d; continue }
      if (/Carried\s*Forward/i.test(text)) { if (bal) closing = money(bal.t); break }
      if (!started) continue
      const d = row.w.filter(w => w.x1 < W * 0.17).map(w => parseScanDate(w.t)).find(Boolean)
      if (d && !pendingDate) pendingDate = d
      const detail = row.w.filter(w => w.x0 >= W * 0.15 && w.x1 < W * 0.5 + (bal ? 0 : W * 0.3) && !(MONEY.test(w.t) && w.x0 > W * 0.5)).map(w => w.t).join(' ')
      if (bal) {
        const other = amts.find(w => w !== bal)
        pending.push(detail)
        txns.push({ date: pendingDate || lastDate, rows: pending, amount: other ? money(other.t) : null, side: other ? (other.x1 < W * 0.70 ? 'debit' : 'credit') : null, balance: money(bal.t) })
        if (pendingDate) lastDate = pendingDate
        pending = []; pendingDate = ''
      } else pending.push(detail)
    }
  }

  if (!txns.length) return { lines: [], error: 'Could not read any transactions from the scanned pages.' }

  // ── check every balance against the amounts; repair a misread digit when the chain proves the right figure ──
  let prev = opening, repaired = 0, unresolved = 0
  txns.forEach((t, i) => {
    if (prev === null) { prev = t.balance; return }
    const delta = r2(t.balance - prev)                       // + = deposit, − = withdrawal
    const amt = t.amount
    const consistent = amt !== null && Math.abs(Math.abs(delta) - amt) < 0.005
    if (consistent) { t.side = delta > 0 ? 'credit' : 'debit' }
    else {
      const nx = txns[i + 1]
      const expected = amt === null ? null : r2(prev + (t.side === 'credit' ? amt : -amt))
      const nextFits = (b) => !nx || nx.amount === null || Math.abs(Math.abs(r2(nx.balance - b)) - nx.amount) < 0.005
      if (expected !== null && nextFits(expected) && !nextFits(t.balance)) { t.balance = expected; repaired++ }          // balance misread
      else if (nextFits(t.balance) && delta !== 0) { t.amount = Math.abs(delta); t.side = delta > 0 ? 'credit' : 'debit'; repaired++ }   // amount misread
      else { t.suspect = true; unresolved++ }
    }
    prev = t.balance
  })

  const lines = txns.map(t => {
    const text = t.rows.join(' ').replace(/\bHEXAGON\b/g, ' ')
    const refM = /\b(HSBC[A-Z0-9]{10,})\b/.exec(text)
    const description = text.replace(/\b\d{4}\/\d{2}\/\d{2}\s+\d{6}\b/g, ' ').replace(/\bHSBC[A-Z0-9]{10,}\b/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    return { date: t.date, description, ref: refM ? refM[1] : '', debit: t.side === 'debit' ? r2(t.amount || 0) : 0, credit: t.side === 'credit' ? r2(t.amount || 0) : 0, balance: t.balance, ...(t.suspect ? { suspect: true } : {}) }
  }).filter(l => l.debit || l.credit)

  return { lines, meta: { newestFirst: false, balanceBreaks: unresolved, repaired, opening, closing, from: lines[0]?.date, to: lines[lines.length - 1]?.date, scanned: true } }
}

// Browser: draw each page and read it with Tesseract. onProgress(page, pages).
export async function ocrPdfPages(file, onProgress) {
  const pdfjs = await import('pdfjs-dist/build/pdf.js')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' })
  const pages = []
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.(p, pdf.numPages)
      const page = await pdf.getPage(p)
      const vp = page.getViewport({ scale: 3 })
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height)
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      const { data } = await worker.recognize(c, {}, { blocks: true })
      const words = []
      for (const b of data.blocks || []) for (const para of b.paragraphs) for (const line of para.lines) for (const w of line.words) words.push({ t: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })
      pages.push({ w: c.width, words })
      c.width = c.height = 0
    }
  } finally { await worker.terminate() }
  return pages
}
