/**
 * IBS — Shared Project Utilities
 * src/lib/projectUtils.js
 *
 * Pure async helpers for project-number generation.
 * No React imports — safe to use from any module.
 */

import { collection, getDocs } from 'firebase/firestore'
import { db } from './firebase-config'

/**
 * Generate the next sequential project number for a given company and year.
 * Format: <COMPANY>-<YEAR>-<SEQ padded to 3 digits>
 * Example: UIPL-2026-003, Wayzim-2026-001
 *
 * Reads the projects collection once to find the current maximum sequence
 * for the company+year prefix, then returns next = max + 1.
 *
 * @param {string} company — 'UIPL' | 'Wayzim' (defaults to 'UIPL')
 * @returns {Promise<string>} e.g. 'UIPL-2026-004'
 */
export const generateProjectNumber = async (company) => {
  const year   = new Date().getFullYear()
  const prefix = `${company || 'UIPL'}-${year}`
  const snap   = await getDocs(collection(db, 'projects'))
  const seqs   = []
  snap.forEach(d => {
    const pn = d.data().projectNumber || ''
    if (pn.startsWith(prefix + '-')) {
      const seq = parseInt(pn.slice(prefix.length + 1), 10)
      if (!isNaN(seq)) seqs.push(seq)
    }
  })
  const next = seqs.length ? Math.max(...seqs) + 1 : 1
  return `${prefix}-${String(next).padStart(3, '0')}`
}
