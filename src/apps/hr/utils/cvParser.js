/**
 * Client-side résumé (CV) text extraction + best-effort field parsing.
 *
 * PDF text comes from pdfjs-dist, Word (.docx) text from mammoth. If a PDF
 * has no embedded text layer (a scanned/photographed resume), it falls back
 * to OCR via tesseract.js — rendering each page to a canvas and reading it.
 * Everything runs entirely in the browser; nothing is uploaded anywhere to parse it.
 *
 * Reliability is NOT uniform across fields:
 *   - Email / Mobile: fixed formats, regex is reliable (~90%+).
 *   - Name / Designation / Experience / Location: heuristic, usually right but not always.
 *   - Company: hardest to get right from free text — treat as a starting guess.
 * The calling page must show all of these in an editable form and let a
 * human confirm/correct before saving — never save auto-extracted fields silently.
 */
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import { createWorker } from 'tesseract.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

// Below this many characters, a "text layer" extraction is treated as empty
// (a couple of stray characters from page furniture, not real content) and
// the scanned-image OCR fallback below kicks in instead.
const MIN_TEXT_LAYER_CHARS = 20

/**
 * `onProgress(status)` is optional — called with a short human-readable
 * string ("Reading page 1 of 2…", "Running OCR on page 2 of 2 (43%)…") so
 * the caller can show something better than a frozen spinner during OCR,
 * which is much slower than normal text extraction (several seconds/page).
 */
export async function extractTextFromFile(file, onProgress) {
  const name = (file.name || '').toLowerCase()
  const buf = await file.arrayBuffer()
  if (name.endsWith('.pdf')) return extractFromPdf(buf, onProgress)
  if (name.endsWith('.docx')) return extractFromDocx(buf)
  if (name.endsWith('.doc')) {
    throw new Error("Legacy .doc files aren't supported — please re-save as .docx or PDF and upload again.")
  }
  throw new Error('Unsupported file type — upload a PDF or Word (.docx) file.')
}

async function extractFromPdf(buf, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(`Reading page ${i} of ${pdf.numPages}…`)
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // pdf.js returns positioned text runs, not lines — it never inserts '\n'
    // itself. Reconstruct lines by watching the vertical position (transform[5])
    // jump between consecutive runs; without this every résumé collapses onto
    // one giant line and the name/line-based heuristics below can't find anything.
    let lastY = null
    for (const item of content.items) {
      const y = item.transform ? item.transform[5] : null
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) text += '\n'
      text += item.str
      if (item.hasEOL) text += '\n'
      lastY = y
    }
    text += '\n'
  }
  // Scanned PDFs (a photo/scan with no embedded text layer) come back
  // empty or near-empty from the loop above — fall back to OCR, rendering
  // each page to a canvas and reading it with Tesseract. Much slower
  // (seconds per page) but the only way to get text out of a pure image.
  if (text.trim().length < MIN_TEXT_LAYER_CHARS) {
    return ocrPdf(pdf, onProgress)
  }
  return text
}

async function ocrPdf(pdf, onProgress) {
  const worker = await createWorker('eng', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(`Running OCR (scanned document) — page in progress, ${Math.round(m.progress * 100)}%…`)
      }
    },
  })
  try {
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(`Running OCR (scanned document) on page ${i} of ${pdf.numPages}…`)
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 2 }) // higher render scale = better OCR accuracy
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      const { data } = await worker.recognize(canvas)
      text += (data.text || '') + '\n'
    }
    return text
  } finally {
    await worker.terminate()
  }
}

async function extractFromDocx(buf) {
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  return result.value || ''
}

// ── Field extraction ────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
const MOBILE_RE = /(?:\+?91[\s-]?)?[6-9]\d{9}\b/g
// Non-global twin of MOBILE_RE for one-off .test() calls — a global regex's
// .test() mutates lastIndex across calls and silently skips matches on
// later lines if reused, so the loops below never call MOBILE_RE.test() directly.
const MOBILE_TEST_RE = /(?:\+?91[\s-]?)?[6-9]\d{9}\b/

// Major Indian cities/states — first hit in the text wins. Not exhaustive;
// extend the list if your candidate pool skews to a city that's missing.
const LOCATIONS = [
  'Navi Mumbai', 'New Delhi', 'Mumbai', 'Pune', 'Thane', 'Nagpur', 'Nashik', 'Aurangabad', 'Kolhapur',
  'Delhi', 'Gurgaon', 'Gurugram', 'Noida', 'Faridabad', 'Ghaziabad',
  'Bengaluru', 'Bangalore', 'Mysore', 'Chennai', 'Coimbatore', 'Madurai',
  'Hyderabad', 'Secunderabad', 'Vijayawada', 'Visakhapatnam',
  'Kolkata', 'Ahmedabad', 'Surat', 'Vadodara', 'Rajkot',
  'Jaipur', 'Jodhpur', 'Udaipur', 'Lucknow', 'Kanpur', 'Indore', 'Bhopal', 'Chandigarh',
  'Kochi', 'Cochin', 'Thiruvananthapuram', 'Bhubaneswar', 'Patna', 'Ranchi', 'Guwahati',
]

// Company-name heuristic: a chain of Title-Case words ending in a common
// legal/biz suffix. Requiring every preceding word to itself start with a
// capital letter keeps lowercase lead-in phrases ("currently at", "working
// with") out of the match — the regex simply can't extend through them.
const COMPANY_RE = /\b((?:[A-Z][A-Za-z&.'-]*\s){0,4}[A-Z][A-Za-z&.'-]*\s(?:Pvt\.?\s?Ltd\.?|Private Limited|Ltd\.?|LLP|LLC|Inc\.?|Technologies|Technology|Solutions|Systems|Enterprises|Corp\.?|Corporation|Industries|Consultancy|Consulting|Software|Softwares|Infotech|Services))\b/

// Designation/job-title heuristic — same Title-Case-chain approach as
// COMPANY_RE, ending in a common role-noun instead of a legal suffix.
const DESIGNATION_KEYWORDS = 'Engineer|Developer|Manager|Executive|Analyst|Consultant|Designer|Director|Officer|Associate|Specialist|Lead|Architect|Administrator|Coordinator|Intern|Supervisor|Technician|Representative|Accountant|Programmer|Head|President|Assistant|Trainee'
const DESIGNATION_RE = new RegExp(`\\b((?:[A-Z][A-Za-z.'-]*\\s){0,3}[A-Z][A-Za-z.'-]*\\s(?:${DESIGNATION_KEYWORDS}))\\b`)

function extractEmail(text) {
  return (text.match(EMAIL_RE) || [])[0] || ''
}

function extractMobile(text) {
  const matches = text.match(MOBILE_RE) || []
  if (!matches.length) return ''
  return matches[0].replace(/[\s-]/g, '').replace(/^\+?91/, '')
}

function extractName(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const skipWord = /resume|curriculum vitae|\bcv\b|profile|contact|address|objective/i
  for (const line of lines.slice(0, 10)) {
    if (skipWord.test(line)) continue
    if (EMAIL_RE.test(line)) continue
    if (/\d/.test(line)) continue
    const words = line.split(/\s+/).filter(Boolean)
    if (words.length >= 2 && words.length <= 4 && /^[A-Za-z.'\s]+$/.test(line) && line.length <= 40) {
      return line.replace(/\s{2,}/g, ' ')
    }
  }
  return ''
}

// Prefers the line right after the detected name — very common resume
// layout is "Name" then "Designation" as the next line. Falls back to a
// per-line regex scan for a role-noun-ending phrase, but only accepts a
// match whose *containing line* is short (a title sits alone on its own
// line or job-history header, e.g. "SIEMENS | Project Engineer") — this
// keeps the regex from matching a software/tool name like "SIMATIC
// Manager" buried mid-sentence in a long skills paragraph, since "Manager"
// alone is too generic a keyword to otherwise tell those apart.
const MAX_DESIGNATION_LINE_LENGTH = 70

function extractDesignation(text, name) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const skipWord = /resume|curriculum vitae|\bcv\b|profile|contact|address|objective/i
  if (name) {
    const norm = name.replace(/\s{2,}/g, ' ')
    const idx = lines.findIndex(l => l.replace(/\s{2,}/g, ' ') === norm)
    if (idx !== -1) {
      for (let i = idx + 1; i < Math.min(idx + 3, lines.length); i++) {
        const line = lines[i]
        if (!line || skipWord.test(line) || EMAIL_RE.test(line) || MOBILE_TEST_RE.test(line)) continue
        if (/\d/.test(line)) continue
        if (line.length <= 45 && /^[A-Za-z.,&/'\s-]+$/.test(line)) return line.replace(/\s{2,}/g, ' ')
      }
    }
  }
  for (const line of lines) {
    if (line.length > MAX_DESIGNATION_LINE_LENGTH) continue // long prose sentence, not a title line
    const m = line.match(DESIGNATION_RE)
    if (m) return m[1].replace(/\s{2,}/g, ' ').trim()
  }
  return ''
}

function extractExperience(text) {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\b/gi)]
  const nums = matches.map(m => parseFloat(m[1])).filter(n => n > 0 && n < 50)
  if (!nums.length) return ''
  return String(Math.max(...nums))
}

function extractCompany(text) {
  const m = text.match(COMPANY_RE)
  return m ? m[1].replace(/\s{2,}/g, ' ').trim() : ''
}

function extractLocation(text) {
  for (const loc of LOCATIONS) {
    if (new RegExp(`\\b${loc}\\b`, 'i').test(text)) return loc
  }
  return ''
}

/** Runs every extractor over the résumé text. Always review before saving. */
export function extractFields(text) {
  const name = extractName(text)
  return {
    name,
    designation: extractDesignation(text, name),
    mobile: extractMobile(text),
    email: extractEmail(text),
    experience: extractExperience(text),
    company: extractCompany(text),
    location: extractLocation(text),
  }
}
