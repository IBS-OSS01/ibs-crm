/**
 * Client-side résumé (CV) text extraction + best-effort field parsing.
 *
 * PDF text comes from pdfjs-dist, Word (.docx) text from mammoth — both run
 * entirely in the browser, nothing is uploaded anywhere to parse it.
 *
 * Reliability is NOT uniform across fields:
 *   - Email / Mobile: fixed formats, regex is reliable (~90%+).
 *   - Name / Experience / Location: heuristic, usually right but not always.
 *   - Company: hardest to get right from free text — treat as a starting guess.
 * The calling page must show all of these in an editable form and let a
 * human confirm/correct before saving — never save auto-extracted fields silently.
 */
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export async function extractTextFromFile(file) {
  const name = (file.name || '').toLowerCase()
  const buf = await file.arrayBuffer()
  if (name.endsWith('.pdf')) return extractFromPdf(buf)
  if (name.endsWith('.docx')) return extractFromDocx(buf)
  if (name.endsWith('.doc')) {
    throw new Error("Legacy .doc files aren't supported — please re-save as .docx or PDF and upload again.")
  }
  throw new Error('Unsupported file type — upload a PDF or Word (.docx) file.')
}

async function extractFromPdf(buf) {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
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
  return text
}

async function extractFromDocx(buf) {
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  return result.value || ''
}

// ── Field extraction ────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
const MOBILE_RE = /(?:\+?91[\s-]?)?[6-9]\d{9}\b/g

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
  return {
    name: extractName(text),
    mobile: extractMobile(text),
    email: extractEmail(text),
    experience: extractExperience(text),
    company: extractCompany(text),
    location: extractLocation(text),
  }
}
