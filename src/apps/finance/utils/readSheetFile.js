// Read an uploaded .csv / .xlsx / .xls into a SheetJS workbook.
// CSV is decoded as UTF-8 text (so ₹ and accented names survive) and kept as plain text — SheetJS must not guess
// numbers, or long ids such as 3807682000000507011 are rounded to 3807682000000507000.
import * as XLSX from 'xlsx'

export async function readSheetFile(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    const text = (await file.text()).replace(/^﻿/, '')
    return XLSX.read(text, { type: 'string', raw: true })
  }
  return XLSX.read(await file.arrayBuffer(), { type: 'array' })
}
