// GST returns workspace: GSTR-1, GSTR-3B, HSN summary, ITC register, GSTR-2B reconciliation.
import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { useFinanceData } from '../hooks/useFinanceData.js'
import { normalizeTaxDocs } from '../utils/taxDocs.js'
import { gstr3bJson } from '../utils/einvoice.js'
import { buildGstr1, gstr1Json, buildGstr3b, hsnSummary, itcRegister, reconcile2b, parseGstr2bJson, parseGstr2bRows } from '../utils/gstReturns.js'
import { fmtAmt, fyRange, currentFY } from '../utils/financeConstants.js'
import { downloadXlsx, downloadJson, printReport } from '../utils/exportUtils.js'
import { ReportShell, CompanyToggle, DateRange, ExportBar, Badge, Empty, cardCls, inputCls, btnGhost, thCls } from '../components/FinanceUI.jsx'

const TABS = [['gstr1', 'GSTR-1'], ['gstr3b', 'GSTR-3B'], ['hsn', 'HSN Summary'], ['itc', 'ITC Register'], ['recon', 'GSTR-2B Reconciliation']]
const monthRange = () => { const d = new Date(); const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1); const le = new Date(d.getFullYear(), d.getMonth(), 0); const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; return { from: f(lm), to: f(le) } }
const A = ({ v }) => <>{v ? fmtAmt(v) : <span className="text-slate-300">—</span>}</>
const Th = ({ children, right }) => <th className={`${thCls} ${right ? 'text-right' : 'text-left'}`}>{children}</th>
const Td = ({ children, right, mono, cls = '' }) => <td className={`px-3 py-2 ${right ? 'text-right' : ''} ${mono ? 'font-mono text-xs' : ''} ${cls}`}>{children}</td>
const Table = ({ head, children, empty }) => (
  <div className={`${cardCls} overflow-x-auto`}><table className="w-full text-sm"><thead className="bg-slate-50/80"><tr>{head}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table>{empty}</div>
)
const Section = ({ title, note, children }) => (
  <div className="space-y-2"><div><h3 className="font-semibold text-slate-800">{title}</h3>{note && <p className="text-xs text-slate-400">{note}</p>}</div>{children}</div>
)

export default function GstReturns() {
  const { tab = 'gstr1' } = useParams()
  const navigate = useNavigate()
  const { raw, loading } = useFinanceData()
  const [company, setCompany] = useState('UIPL')
  const [period, setPeriod] = useState(monthRange())
  const [opening, setOpening] = useState({ igst: '', cgst: '', sgst: '' })
  const [twoB, setTwoB] = useState(null)
  const [recErr, setRecErr] = useState('')
  const [split, setSplit] = useState(true)

  const cs = raw?.companySettings?.[company] || {}
  const stateCode = cs.stateCode || ''
  const docs = useMemo(() => raw ? normalizeTaxDocs(raw) : [], [raw])
  const base = { company, from: period.from, to: period.to, companyStateCode: stateCode }
  const g1 = useMemo(() => buildGstr1(docs, { ...base, gstin: cs.gstin }), [docs, company, period, stateCode, cs.gstin]) // eslint-disable-line react-hooks/exhaustive-deps
  const g3 = useMemo(() => buildGstr3b(docs, { ...base, openingCredit: { igst: Number(opening.igst) || 0, cgst: Number(opening.cgst) || 0, sgst: Number(opening.sgst) || 0 } }), [docs, company, period, stateCode, opening]) // eslint-disable-line react-hooks/exhaustive-deps
  const hsn = useMemo(() => hsnSummary(docs, { company, from: period.from, to: period.to, split }), [docs, company, period, split])
  const itc = useMemo(() => itcRegister(docs, { company, from: period.from, to: period.to }), [docs, company, period])
  const books = useMemo(() => docs.filter(d => d.kind === 'purchase' && d.company === company && !d.legacy && d.date >= period.from && d.date <= period.to), [docs, company, period])
  const recon = useMemo(() => twoB ? reconcile2b(books, twoB.rows) : null, [books, twoB])

  const label = TABS.find(t => t[0] === tab)?.[1] || 'GSTR-1'
  const noGst = company === 'Wayzim' || !cs.gstin

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    setRecErr('')
    try {
      if (/\.json$/i.test(f.name)) setTwoB({ name: f.name, ...parseGstr2bJson(JSON.parse(await f.text())) })
      else {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true })
        const sheet = wb.SheetNames.find(n => /b2b/i.test(n)) || wb.SheetNames[0]
        setTwoB({ name: f.name, rows: parseGstr2bRows(XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' })) })
      }
    } catch (err) { setRecErr('Could not read that file: ' + err.message) }
    e.target.value = ''
  }

  // ── exports ──
  const exportBar = (() => {
    if (tab === 'gstr1') return <div className="flex gap-2 flex-wrap">
      <ExportBar onXlsx={() => downloadXlsx(`GSTR-1 ${company} ${period.from} to ${period.to}`, gstr1Sheets(g1))} />
      <button className={btnGhost} disabled={noGst} onClick={() => downloadJson(`GSTR1_${cs.gstin}_${period.to.slice(5, 7)}${period.to.slice(0, 4)}`, gstr1Json(g1, { gstin: cs.gstin, to: period.to }))}>⬇ Portal JSON</button></div>
    if (tab === 'gstr3b') return <div className="flex gap-2 flex-wrap"><button className={btnGhost} disabled={noGst} onClick={() => downloadJson(`GSTR3B_${cs.gstin}_${period.to.slice(5, 7)}${period.to.slice(0, 4)}`, gstr3bJson(g3, { gstin: cs.gstin, to: period.to }))}>⬇ Portal JSON</button><ExportBar onXlsx={() => downloadXlsx(`GSTR-3B ${company} ${period.from} to ${period.to}`, [{ name: 'GSTR-3B', rows: gstr3bRows(g3) }])} onPrint={() => printReport({ title: 'GSTR-3B working', subtitle: `${company} · ${period.from} to ${period.to}`, rows: gstr3bRows(g3) })} /></div>
    if (tab === 'hsn') return <ExportBar onXlsx={() => downloadXlsx(`HSN Summary ${company} ${period.from} to ${period.to}`, [{ name: 'HSN', rows: hsnRows(hsn.rows, split) }])} onPrint={() => printReport({ title: 'HSN Summary', subtitle: `${company} · ${period.from} to ${period.to}`, rows: hsnRows(hsn.rows, split) })} />
    if (tab === 'itc') return <ExportBar onXlsx={() => downloadXlsx(`ITC Register ${company} ${period.from} to ${period.to}`, [{ name: 'ITC', rows: itcRows(itc.rows) }])} onPrint={() => printReport({ title: 'ITC Register', subtitle: `${company} · ${period.from} to ${period.to}`, rows: itcRows(itc.rows) })} />
    if (tab === 'recon' && recon) return <ExportBar onXlsx={() => downloadXlsx(`GSTR-2B Reconciliation ${company}`, reconSheets(recon))} />
    return null
  })()

  return (
    <ReportShell title={label} loading={loading} exportBar={exportBar}
      subtitle="Return working papers built from your vouchers — review, then file on the GST portal (or upload the JSON)."
      filters={<>
        <CompanyToggle value={company} onChange={setCompany} />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm flex-wrap">
          {TABS.map(([k, l]) => <button key={k} onClick={() => navigate(`/finance/gst/${k}`)} className={`px-3 py-1.5 font-medium ${k === tab ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>)}
        </div>
        <DateRange from={period.from} to={period.to} onChange={setPeriod} />
      </>}>
      {noGst && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">{company === 'Wayzim' ? 'Wayzim is not GST-registered — nothing to file.' : 'No GSTIN is set for this company in Company Settings — the portal JSON needs it.'}</div>}
      {!stateCode && !noGst && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">Company state is not set — intra/inter-state classification will be wrong. Set it in Company Settings.</div>}

      {tab === 'gstr1' && (
        <>
          {g1.warnings.length > 0 && <Warnings list={g1.warnings} />}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            {[['B2B invoices', g1.totals.b2b], ['B2C large', g1.totals.b2cl], ['B2C small', g1.totals.b2cs], ['Credit notes', g1.totals.cdn], ['Total sales', g1.totals.sales]].map(([l, t]) => (
              <div key={l} className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">{l}</p><p className="font-bold text-slate-800">₹{fmtAmt(t.taxable)}</p><p className="text-xs text-slate-500">tax ₹{fmtAmt(t.tax)}{t.count !== undefined ? ` · ${t.count} docs` : ''}</p></div>
            ))}
          </div>
          <Section title="4A — B2B supplies to registered buyers">
            <Table head={<><Th>Buyer GSTIN</Th><Th>Buyer</Th><Th>Invoice</Th><Th>Date</Th><Th>POS</Th><Th right>Taxable</Th><Th right>Tax</Th><Th right>Value</Th></>} empty={g1.b2b.length === 0 && <Empty>No B2B invoices.</Empty>}>
              {g1.b2b.flatMap(p => p.invoices.map(i => <tr key={i.key}><Td mono>{p.ctin}</Td><Td>{p.partyName}</Td><Td mono>{i.number}</Td><Td>{i.date}</Td><Td>{i.pos}</Td><Td right><A v={i.taxable} /></Td><Td right><A v={i.tax} /></Td><Td right>{fmtAmt(i.value)}</Td></tr>))}
            </Table>
          </Section>
          <Section title="5 — B2C large (inter-state, invoice value above ₹1,00,000)">
            <Table head={<><Th>POS</Th><Th>Invoice</Th><Th>Date</Th><Th>Buyer</Th><Th right>Taxable</Th><Th right>Tax</Th><Th right>Value</Th></>} empty={g1.b2cl.length === 0 && <Empty>None.</Empty>}>
              {g1.b2cl.flatMap(p => p.invoices.map(i => <tr key={i.key}><Td>{p.posName}</Td><Td mono>{i.number}</Td><Td>{i.date}</Td><Td>{i.partyName}</Td><Td right><A v={i.taxable} /></Td><Td right><A v={i.tax} /></Td><Td right>{fmtAmt(i.value)}</Td></tr>))}
            </Table>
          </Section>
          <Section title="7 — B2C small (consolidated by state and rate)" note="Credit notes to unregistered buyers are netted here.">
            <Table head={<><Th>Place of supply</Th><Th>Type</Th><Th right>Rate</Th><Th right>Taxable</Th><Th right>IGST</Th><Th right>CGST</Th><Th right>SGST</Th></>} empty={g1.b2cs.length === 0 && <Empty>None.</Empty>}>
              {g1.b2cs.map(x => <tr key={`${x.pos}${x.rate}`}><Td>{x.posName}</Td><Td>{x.supplyType === 'INTER' ? 'Inter-state' : 'Intra-state'}</Td><Td right>{x.rate}%</Td><Td right>{fmtAmt(x.taxable)}</Td><Td right><A v={x.igst} /></Td><Td right><A v={x.cgst} /></Td><Td right><A v={x.sgst} /></Td></tr>)}
            </Table>
          </Section>
          <Section title="8 — Nil-rated / exempt supplies">
            <Table head={<><Th>Category</Th><Th right>Value</Th></>}>
              {[['Inter-state to registered', g1.nil.interReg], ['Inter-state to unregistered', g1.nil.interUnreg], ['Intra-state to registered', g1.nil.intraReg], ['Intra-state to unregistered', g1.nil.intraUnreg]].map(([l, v]) => <tr key={l}><Td>{l}</Td><Td right><A v={v} /></Td></tr>)}
            </Table>
            <p className="text-xs text-slate-400">All zero-rate sales are shown as "nil-rated". If some are actually exempt or non-GST, split them in the portal.</p>
          </Section>
          <Section title="6A — Exports" note="Supplies to customers outside India: under LUT (no IGST) or with payment of IGST.">
            <Table head={<><Th>Invoice</Th><Th>Date</Th><Th>Buyer</Th><Th>Type</Th><Th>Shipping bill</Th><Th right>Taxable (₹)</Th><Th right>IGST</Th><Th right>Value (₹)</Th></>} empty={(g1.exports || []).length === 0 && <Empty>No export invoices.</Empty>}>
              {(g1.exports || []).map(e => <tr key={e.key}><Td mono>{e.number}</Td><Td>{e.date}</Td><Td>{e.partyName}{e.currency ? <span className="text-slate-400"> · {e.currency} {fmtAmt(e.fcTotal)}</span> : null}</Td><Td>{e.exportType === 'WPAY' ? 'With IGST' : 'Under LUT'}</Td><Td mono>{e.sbNo || '—'}</Td><Td right>{fmtAmt(e.taxable)}</Td><Td right><A v={e.igst} /></Td><Td right>{fmtAmt(e.value)}</Td></tr>)}
            </Table>
          </Section>
          <Section title="9B — Credit notes issued (registered / unregistered)">
            <Table head={<><Th>Buyer GSTIN</Th><Th>Note</Th><Th>Date</Th><Th>Against invoice</Th><Th>Reason</Th><Th right>Taxable</Th><Th right>Tax</Th></>} empty={g1.cdnr.length + g1.cdnur.length === 0 && <Empty>None.</Empty>}>
              {[...g1.cdnr.flatMap(p => p.notes.map(n => ({ ...n, gstin: p.ctin }))), ...g1.cdnur].map(n => <tr key={n.key}><Td mono>{n.gstin || 'Unregistered'}</Td><Td mono>{n.number}</Td><Td>{n.date}</Td><Td mono>{n.refNumber || <span className="text-red-500">missing</span>}</Td><Td>{n.reason}</Td><Td right><A v={n.taxable} /></Td><Td right><A v={n.tax} /></Td></tr>)}
            </Table>
          </Section>
          <Section title="12 — HSN summary" note="Net of credit notes; also available as its own tab."><HsnTable rows={g1.hsn.rows} split /></Section>
          <Section title="13 — Documents issued">
            <Table head={<><Th>Document</Th><Th>From</Th><Th>To</Th><Th right>Total</Th><Th right>Cancelled / gaps</Th><Th right>Net issued</Th></>} empty={g1.docIssued.length === 0 && <Empty>None.</Empty>}>
              {g1.docIssued.map(s => <tr key={s.kindLabel + s.prefix}><Td>{s.kindLabel}</Td><Td mono>{s.from}</Td><Td mono>{s.to}</Td><Td right>{s.totalNumber}</Td><Td right>{s.cancelled}</Td><Td right>{s.netIssued}</Td></tr>)}
            </Table>
          </Section>
        </>
      )}

      {tab === 'gstr3b' && (
        <>
          {g3.warnings.length > 0 && <Warnings list={g3.warnings} />}
          <Section title="3.1 — Outward supplies and inward supplies liable to reverse charge" note="Outward figures are net of credit notes in the period.">
            <Table head={<><Th>Nature of supply</Th><Th right>Taxable value</Th><Th right>IGST</Th><Th right>CGST</Th><Th right>SGST</Th></>}>
              {[['(a) Outward taxable supplies (other than zero-rated, nil-rated, exempt)', g3.t31a], ['(b) Outward taxable supplies (zero-rated — exports)', g3.t31b], ['(c) Other outward supplies (nil-rated, exempt)', g3.t31c], ['(d) Inward supplies (liable to reverse charge)', g3.t31d], ['(e) Non-GST outward supplies', null]].map(([l, t]) => (
                <tr key={l}><Td>{l}</Td><Td right>{t ? <A v={t.taxable} /> : <span className="text-slate-300">—</span>}</Td><Td right>{t ? <A v={t.igst} /> : '—'}</Td><Td right>{t ? <A v={t.cgst} /> : '—'}</Td><Td right>{t ? <A v={t.sgst} /> : '—'}</Td></tr>
              ))}
            </Table>
          </Section>
          <Section title="3.2 — Inter-state supplies to unregistered persons">
            <Table head={<><Th>Place of supply</Th><Th right>Taxable value</Th><Th right>IGST</Th></>} empty={g3.interUnreg.length === 0 && <Empty>None.</Empty>}>
              {g3.interUnreg.map(x => <tr key={x.pos}><Td>{x.posName}</Td><Td right>{fmtAmt(x.taxable)}</Td><Td right>{fmtAmt(x.igst)}</Td></tr>)}
            </Table>
          </Section>
          <Section title="4 — Eligible input tax credit">
            <Table head={<><Th>Details</Th><Th right>IGST</Th><Th right>CGST</Th><Th right>SGST</Th></>}>
              {[['(A)(3) Inward supplies liable to reverse charge', g3.itcRcm], ['(A)(5) All other ITC', g3.itcOther], ['(B)(2) ITC reversed — others (debit notes)', g3.itcRevOther, true], ['(C) Net ITC available (A − B)', g3.netItc, false, true], ['(D) Ineligible ITC — blocked under s.17(5) (memo; already added to cost)', g3.itcBlocked]].map(([l, t, neg, bold]) => (
                <tr key={l} className={bold ? 'font-bold bg-slate-50' : ''}><Td>{l}</Td><Td right>{neg ? '−' : ''}<A v={t.igst} /></Td><Td right>{neg ? '−' : ''}<A v={t.cgst} /></Td><Td right>{neg ? '−' : ''}<A v={t.sgst} /></Td></tr>
              ))}
            </Table>
          </Section>
          <Section title="6.1 — Payment of tax" note="ITC is applied in the order the law prescribes (IGST → IGST, CGST, SGST; CGST → CGST, IGST; SGST → SGST, IGST). RCM tax must be paid in cash; its ITC is claimable after payment, so it is not used to offset this month.">
            <div className={`${cardCls} p-3 flex gap-3 items-end flex-wrap text-sm`}>
              <span className="text-xs font-semibold text-slate-500 uppercase">Opening credit ledger balance</span>
              {['igst', 'cgst', 'sgst'].map(h => <label key={h} className="text-xs uppercase text-slate-500">{h}<input type="number" min="0" step="any" value={opening[h]} onChange={e => setOpening(o => ({ ...o, [h]: e.target.value }))} className={`${inputCls} w-28 ml-1`} /></label>)}
              <span className="text-xs text-slate-400">(from the portal's electronic credit ledger)</span>
            </div>
            <Table head={<><Th>Head</Th><Th right>Tax payable</Th><Th right>ITC used</Th><Th right>Cash (tax)</Th><Th right>ITC left to carry</Th></>}>
              {['igst', 'cgst', 'sgst'].map(h => {
                const u = g3.setOff.itcUsed
                const used = h === 'igst' ? u.igst.igst + u.cgst.igst + u.sgst.igst : h === 'cgst' ? u.igst.cgst + u.cgst.cgst : u.igst.sgst + u.sgst.sgst
                const payable = g3.t31a[h] + g3.t31d[h]
                return <tr key={h}><Td cls="uppercase font-medium">{h}</Td><Td right><A v={payable} /></Td><Td right><A v={used} /></Td><Td right><A v={g3.setOff.cash[h] + g3.rcmCash[h]} /></Td><Td right><A v={g3.setOff.itcLeft[h]} /></Td></tr>
              })}
              <tr className="font-bold bg-slate-50"><Td>Total cash to pay</Td><Td /><Td /><Td right>{fmtAmt(g3.cashTotal)}</Td><Td /></tr>
            </Table>
            <p className="text-xs text-slate-400">Interest (18% p.a.) and late fee are not calculated — pay/offset those on the portal. Record the challan payment as a Payment voucher against the GST liability account.</p>
          </Section>
        </>
      )}

      {tab === 'hsn' && (
        <>
          {hsn.missingHsn > 0 && <Warnings list={[`${hsn.missingHsn} line(s) have no HSN/SAC code.`]} />}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} />Split B2B / B2C (as GSTR-1 Table 12 now requires)</label>
          <HsnTable rows={hsn.rows} split={split} />
        </>
      )}

      {tab === 'itc' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            {[['IGST', itc.totals.igst], ['CGST', itc.totals.cgst], ['SGST', itc.totals.sgst], ['Eligible ITC', itc.totals.eligible], ['Blocked (not claimable)', itc.totals.blocked]].map(([l, v]) => <div key={l} className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">{l}</p><p className="font-bold text-slate-800">₹{fmtAmt(v)}</p></div>)}
          </div>
          <Table head={<><Th>Date</Th><Th>Voucher</Th><Th>Supplier</Th><Th>GSTIN</Th><Th right>Taxable</Th><Th right>IGST</Th><Th right>CGST</Th><Th right>SGST</Th><Th right>ITC</Th><Th>Status</Th></>} empty={itc.rows.length === 0 && <Empty>No purchases in this period.</Empty>}>
            {itc.rows.map(r => <tr key={r.key} className={r.status.startsWith('Blocked') ? 'bg-red-50/40' : ''}><Td>{r.date}</Td><Td mono>{r.number}</Td><Td>{r.partyName}</Td><Td mono>{r.gstin || '—'}</Td><Td right>{fmtAmt(r.taxable)}</Td><Td right><A v={r.igst} /></Td><Td right><A v={r.cgst} /></Td><Td right><A v={r.sgst} /></Td><Td right>{fmtAmt(r.itc)}</Td><Td><Badge color={r.status.startsWith('Eligible') ? 'bg-green-100 text-green-700' : r.status.startsWith('Blocked') ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}>{r.status}</Badge></Td></tr>)}
          </Table>
        </>
      )}

      {tab === 'recon' && (
        <>
          <div className={`${cardCls} p-4 space-y-2`}>
            <p className="text-sm text-slate-600">Download <b>GSTR-2B</b> (JSON or Excel) from the GST portal for the month, upload it here, and it is matched to your Purchase vouchers by supplier GSTIN + invoice number.</p>
            <input type="file" accept=".json,.xlsx,.xls,.csv" onChange={onFile} className="text-sm" />
            {recErr && <p className="text-sm text-red-600">{recErr}</p>}
            {twoB && <p className="text-xs text-slate-500">Loaded {twoB.rows.length} supplier documents from <b>{twoB.name}</b> · comparing against {books.length} purchase vouchers dated {period.from} to {period.to}. Match tolerance ₹1.</p>}
          </div>
          {recon && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {[['Matched', recon.matched.length, recon.totals.matchedTax, 'text-green-700'], ['Mismatch', recon.mismatch.length, recon.totals.mismatchTax, 'text-amber-600'], ['In books, not in 2B', recon.onlyBooks.length, recon.totals.onlyBooksTax, 'text-red-600'], ['In 2B, not in books', recon.onlyTwoB.length, recon.totals.onlyTwoBTax, 'text-purple-700']].map(([l, n, t, c]) => (
                  <div key={l} className={`${cardCls} p-3`}><p className="text-xs text-slate-400 uppercase">{l}</p><p className={`text-xl font-bold ${c}`}>{n}</p><p className="text-xs text-slate-500">tax ₹{fmtAmt(t)}</p></div>
                ))}
              </div>
              <Section title="In books but missing from GSTR-2B" note="Claim ITC only once the supplier files — chase these suppliers.">
                <Table head={<><Th>Date</Th><Th>Voucher</Th><Th>Supplier inv.</Th><Th>Supplier</Th><Th>GSTIN</Th><Th right>Tax</Th></>} empty={recon.onlyBooks.length === 0 && <Empty>None.</Empty>}>
                  {recon.onlyBooks.map(b => <tr key={b.key}><Td>{b.date}</Td><Td mono>{b.number}</Td><Td mono>{b.externalNumber}</Td><Td>{b.partyName}</Td><Td mono>{b.gstin || '—'}</Td><Td right>{fmtAmt(b.cgst + b.sgst + b.igst)}</Td></tr>)}
                </Table>
              </Section>
              <Section title="Mismatches">
                <Table head={<><Th>Supplier</Th><Th>Invoice</Th><Th>Difference</Th></>} empty={recon.mismatch.length === 0 && <Empty>None.</Empty>}>
                  {recon.mismatch.map(r => <tr key={r.book.key}><Td>{r.book.partyName}</Td><Td mono>{r.book.externalNumber || r.book.number}</Td><Td cls="text-amber-700">{r.diffs.join(' · ')}</Td></tr>)}
                </Table>
              </Section>
              <Section title="In GSTR-2B but not in your books" note="Either not yet entered — add a Purchase voucher — or not your purchase (ignore).">
                <Table head={<><Th>Invoice date</Th><Th>Invoice</Th><Th>Supplier</Th><Th>GSTIN</Th><Th right>Taxable</Th><Th right>Tax</Th><Th>ITC</Th></>} empty={recon.onlyTwoB.length === 0 && <Empty>None.</Empty>}>
                  {recon.onlyTwoB.map((t, i) => <tr key={i}><Td>{t.date}</Td><Td mono>{t.number}</Td><Td>{t.supplier}</Td><Td mono>{t.gstin}</Td><Td right>{fmtAmt(t.taxable)}</Td><Td right>{fmtAmt(t.cgst + t.sgst + t.igst)}</Td><Td>{t.itcAvailable ? 'Available' : 'Not available'}</Td></tr>)}
                </Table>
              </Section>
              <Section title="Matched"><p className="text-sm text-slate-500">{recon.matched.length} documents agree with GSTR-2B.</p></Section>
            </>
          )}
        </>
      )}
    </ReportShell>
  )
}

function Warnings({ list }) {
  return <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm space-y-1"><b>Check before filing</b>{list.map(w => <p key={w}>• {w}</p>)}</div>
}

function HsnTable({ rows, split }) {
  return (
    <Table head={<>{split && <Th>Type</Th>}<Th>HSN / SAC</Th><Th>Description</Th><Th>UQC</Th><Th right>Qty</Th><Th right>Rate</Th><Th right>Taxable</Th><Th right>IGST</Th><Th right>CGST</Th><Th right>SGST</Th><Th right>Total value</Th></>} empty={rows.length === 0 && <Empty>No outward supplies in this period.</Empty>}>
      {rows.map(r => <tr key={`${r.segment}${r.hsn}${r.unit}${r.rate}`}>{split && <Td>{r.segment}</Td>}<Td mono cls={r.hsn === 'NA' ? 'text-red-500' : ''}>{r.hsn}</Td><Td>{r.description}</Td><Td>{r.unit}</Td><Td right>{r.qty}</Td><Td right>{r.rate}%</Td><Td right>{fmtAmt(r.taxable)}</Td><Td right><A v={r.igst} /></Td><Td right><A v={r.cgst} /></Td><Td right><A v={r.sgst} /></Td><Td right>{fmtAmt(r.value)}</Td></tr>)}
    </Table>
  )
}

// ── sheet builders ──
const hsnRows = (rows, split) => [[...(split ? ['Type'] : []), 'HSN/SAC', 'Description', 'UQC', 'Qty', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST', 'Total value'], ...rows.map(r => [...(split ? [r.segment] : []), r.hsn, r.description, r.unit, r.qty, r.rate, r.taxable, r.igst, r.cgst, r.sgst, r.value])]
const itcRows = (rows) => [['Date', 'Voucher', 'Supplier inv.', 'Supplier', 'GSTIN', 'Taxable', 'IGST', 'CGST', 'SGST', 'ITC', 'Status'], ...rows.map(r => [r.date, r.number, r.externalNumber || '', r.partyName, r.gstin || '', r.taxable, r.igst, r.cgst, r.sgst, r.itc, r.status])]
function gstr3bRows(g) {
  const t = (l, x) => [l, x.taxable, x.igst, x.cgst, x.sgst]
  return [
    ['GSTR-3B working'], [],
    ['3.1 Outward / RCM', 'Taxable', 'IGST', 'CGST', 'SGST'], t('(a) Outward taxable', g.t31a), t('(b) Zero-rated (exports)', g.t31b), t('(c) Nil / exempt', g.t31c), t('(d) Inward RCM', g.t31d), [],
    ['3.2 Inter-state to unregistered', 'Taxable', 'IGST'], ...g.interUnreg.map(x => [x.posName, x.taxable, x.igst]), [],
    ['4 ITC', '', 'IGST', 'CGST', 'SGST'], ['(A)(3) RCM', '', g.itcRcm.igst, g.itcRcm.cgst, g.itcRcm.sgst], ['(A)(5) Other', '', g.itcOther.igst, g.itcOther.cgst, g.itcOther.sgst],
    ['(B)(2) Reversed', '', g.itcRevOther.igst, g.itcRevOther.cgst, g.itcRevOther.sgst], ['Net ITC', '', g.netItc.igst, g.netItc.cgst, g.netItc.sgst], [],
    ['6.1 Cash payable', '', g.setOff.cash.igst + g.rcmCash.igst, g.setOff.cash.cgst + g.rcmCash.cgst, g.setOff.cash.sgst + g.rcmCash.sgst], ['Total cash', g.cashTotal],
  ]
}
function gstr1Sheets(g) {
  return [
    { name: 'B2B', rows: [['GSTIN', 'Buyer', 'Invoice', 'Date', 'POS', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST', 'Invoice value'], ...g.b2b.flatMap(p => p.invoices.flatMap(i => i.rows.map(r => [p.ctin, p.partyName, i.number, i.date, i.pos, r.rate, r.taxable, r.igst, r.cgst, r.sgst, i.value])))] },
    { name: 'B2CL', rows: [['POS', 'Invoice', 'Date', 'Rate %', 'Taxable', 'IGST', 'Value'], ...g.b2cl.flatMap(p => p.invoices.flatMap(i => i.rows.map(r => [p.posName, i.number, i.date, r.rate, r.taxable, r.igst, i.value])))] },
    { name: 'B2CS', rows: [['POS', 'Type', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST'], ...g.b2cs.map(x => [x.posName, x.supplyType, x.rate, x.taxable, x.igst, x.cgst, x.sgst])] },
    { name: 'Exports', rows: [['Invoice', 'Date', 'Buyer', 'Type', 'Currency', 'Foreign amount', 'Shipping bill', 'SB date', 'Port', 'Taxable (INR)', 'IGST', 'Value (INR)'], ...(g.exports || []).map(e => [e.number, e.date, e.partyName, e.exportType, e.currency || 'INR', e.fcTotal || '', e.sbNo || '', e.sbDate || '', e.portCode || '', e.taxable, e.igst, e.value])] },
    { name: 'Nil', rows: [['Category', 'Value'], ['Inter-state registered', g.nil.interReg], ['Inter-state unregistered', g.nil.interUnreg], ['Intra-state registered', g.nil.intraReg], ['Intra-state unregistered', g.nil.intraUnreg]] },
    { name: 'CDN', rows: [['GSTIN', 'Note', 'Date', 'Against', 'Reason', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST'], ...[...g.cdnr.flatMap(p => p.notes.map(n => ({ ...n, gstin: p.ctin }))), ...g.cdnur].flatMap(n => n.rows.map(r => [n.gstin || 'Unregistered', n.number, n.date, n.refNumber, n.reason, r.rate, r.taxable, r.igst, r.cgst, r.sgst]))] },
    { name: 'HSN', rows: hsnRows(g.hsn.rows, true) },
    { name: 'Docs', rows: [['Document', 'From', 'To', 'Total', 'Cancelled/gaps', 'Net issued'], ...g.docIssued.map(s => [s.kindLabel, s.from, s.to, s.totalNumber, s.cancelled, s.netIssued])] },
  ]
}
function reconSheets(r) {
  const b = (x) => [x.date, x.number, x.externalNumber || '', x.partyName, x.gstin || '', x.taxable, x.igst, x.cgst, x.sgst]
  const hdr = ['Date', 'Voucher', 'Supplier inv.', 'Supplier', 'GSTIN', 'Taxable', 'IGST', 'CGST', 'SGST']
  return [
    { name: 'In books not in 2B', rows: [hdr, ...r.onlyBooks.map(b)] },
    { name: 'Mismatch', rows: [[...hdr, 'Difference'], ...r.mismatch.map(m => [...b(m.book), m.diffs.join(' | ')])] },
    { name: 'In 2B not in books', rows: [['Date', 'Invoice', 'Supplier', 'GSTIN', 'Taxable', 'IGST', 'CGST', 'SGST'], ...r.onlyTwoB.map(t => [t.date, t.number, t.supplier, t.gstin, t.taxable, t.igst, t.cgst, t.sgst])] },
    { name: 'Matched', rows: [hdr, ...r.matched.map(m => b(m.book))] },
  ]
}
