// End-to-end test of the Cloudflare Worker against a LOCAL D1 database.
//   1) cd cloudflare && npx wrangler d1 execute ibs-data --local --file=schema.sql
//   2) cd cloudflare && npx wrangler dev --local --var DEV_AUTH:1 --port 8787
//   3) node scripts/test-cloudflare.mjs      (adds its own seed users, then exercises every endpoint and rule)
import { execSync } from 'child_process'
import { applyOp, hasMarker } from '../cloudflare/src/docops.js'
import { allowed } from '../cloudflare/src/rules.js'

const BASE = process.env.API || 'http://127.0.0.1:8787'
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m) } }
const post = async (path, body, uid) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { 'X-Dev-Uid': uid } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}
const commit = (ops, uid, expect) => post('/v1/commit', { ops, expect }, uid)

// ── pure logic ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const now = '2026-10-12T10:00:00.000Z'
  ok(applyOp(null, { t: 'set', data: { a: 1, ts: { __op: 'ts' }, d: { __op: 'del' } } }, now).ts === now, 'docops: server time marker')
  ok(applyOp({ n: 5, keep: 1 }, { t: 'update', data: { n: { __op: 'inc', n: 3 } } }, now).n === 8, 'docops: increment')
  ok(applyOp({ a: { b: 1, c: 2 }, z: 9 }, { t: 'update', data: { 'a.b': 7, z: { __op: 'del' } } }, now).a.b === 7 && !('z' in applyOp({ a: {}, z: 9 }, { t: 'update', data: { z: { __op: 'del' } } }, now)), 'docops: dotted path and deleteField')
  const m = applyOp({ a: { b: 1, c: 2 }, k: 1 }, { t: 'set', merge: true, data: { a: { b: 5 } } }, now)
  ok(m.a.b === 5 && m.a.c === 2 && m.k === 1, 'docops: set with merge merges nested maps')
  ok(applyOp({ a: 1, b: 2 }, { t: 'set', data: { c: 3 } }, now).a === undefined, 'docops: set without merge replaces')
  ok(hasMarker({ x: [{ __op: 'ts' }] }) && !hasMarker({ x: 1 }), 'docops: marker detection')
  ok(allowed('finance_vouchers', 'create', { uid: 'u', provisioned: true }) && !allowed('finance_vouchers', 'create', { uid: 'u', provisioned: false }), 'rules: provisioned users only')
  ok(!allowed('finance_accounts', 'update', { uid: 'u', provisioned: true, role: 'sales' }) && allowed('finance_accounts', 'update', { uid: 'u', provisioned: true, role: 'admin' }), 'rules: chart of accounts is admin-only to change')
  ok(!allowed('finance_audit_log', 'update', { uid: 'u', provisioned: true, role: 'admin' }) && allowed('finance_audit_log', 'create', { uid: 'u', provisioned: true }), 'rules: audit log is append-only')
  ok(allowed('public_task_links', 'read', {}) && allowed('public_task_links', 'update', {}, { changedKeys: ['status'] }) && !allowed('public_task_links', 'update', {}, { changedKeys: ['status', 'title'] }), 'rules: public task links — anyone reads, outsiders change only status fields')
  ok(!allowed('not_a_collection', 'read', { uid: 'u', provisioned: true }), 'rules: unknown collections are denied')
}

// ── the Worker ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sql = (q) => execSync(`npx wrangler d1 execute ibs-data --local --command "${q}"`, { cwd: new URL('../cloudflare', import.meta.url), stdio: 'pipe' })
sql("DELETE FROM docs; DELETE FROM colstamp;")
sql(`INSERT INTO docs (col,id,data,v,u) VALUES ('users','admin1','{\\"role\\":\\"admin\\",\\"name\\":\\"Admin\\"}',1,1), ('users','sales1','{\\"role\\":\\"sales\\",\\"name\\":\\"Sales\\"}',1,1)`)

{
  const r = await commit([{ t: 'set', col: 'finance_vouchers', id: 'v1', data: { total: 100 } }], 'stranger')
  ok(r.status === 403, 'worker: a signed-in stranger with no profile cannot write')
  const noAuth = await post('/v1/list', { col: 'finance_vouchers' })
  ok(noAuth.status === 403, 'worker: no token cannot read')

  const c1 = await commit([{ t: 'set', col: 'finance_vouchers', id: 'v1', data: { total: 100, status: 'active', tds: { amt: 5 } } }, { t: 'set', col: 'finance_vouchers', id: 'v2', data: { total: 200, status: 'cancelled' } }], 'sales1')
  ok(c1.status === 200 && c1.body.ok && c1.body.docs.length === 0 && c1.body.stamps.finance_vouchers.u > 0, 'worker: a provisioned user creates two vouchers in one commit')

  const l = await post('/v1/list', { col: 'finance_vouchers' }, 'sales1')
  ok(l.body.docs.length === 2 && l.body.docs[0].data.total === 100 && l.body.stamp === c1.body.stamps.finance_vouchers.u, 'worker: list returns the documents and the collection stamp')
  const e = await post('/v1/list', { col: 'finance_vouchers', eq: { status: 'cancelled' } }, 'sales1')
  ok(e.body.docs.length === 1 && e.body.docs[0].id === 'v2', 'worker: list with an equality filter')

  const g = await post('/v1/get', { col: 'finance_vouchers', id: 'v1' }, 'sales1')
  ok(g.body.doc.data.total === 100 && g.body.doc.v === 1, 'worker: get one document (with its version)')
  ok((await post('/v1/get', { col: 'finance_vouchers', id: 'nope' }, 'sales1')).body.doc === null, 'worker: get a missing document → null')

  const u = await commit([{ t: 'update', col: 'finance_vouchers', id: 'v1', data: { total: 120, 'tds.amt': 9, seq: { __op: 'inc', n: 2 }, at: { __op: 'ts' } } }], 'sales1')
  ok(u.body.docs.length === 1 && u.body.docs[0].data.total === 120 && u.body.docs[0].data.tds.amt === 9 && u.body.docs[0].data.seq === 2 && /^\d{4}-/.test(u.body.docs[0].data.at) && u.body.docs[0].v === 2, 'worker: update with dotted path, increment and server time returns the stored document')
  ok((await commit([{ t: 'update', col: 'finance_vouchers', id: 'ghost', data: { a: 1 } }], 'sales1')).status === 404, 'worker: updating a missing document fails like Firestore')

  const st = await post('/v1/stamps', { cols: ['finance_vouchers', 'crm_orders'] }, 'sales1')
  ok(st.body.stamps.finance_vouchers >= u.body.stamps.finance_vouchers.u && st.body.stamps.crm_orders === 0, 'worker: stamps change with writes and are 0 for an untouched collection')
  ok((await post('/v1/count', { col: 'finance_vouchers' }, 'sales1')).body.n === 2, 'worker: count')

  // transactions: a stale read is refused
  const stale = await commit([{ t: 'set', col: 'finance_vouchers', id: 'v1', data: { total: 1 } }], 'sales1', [{ col: 'finance_vouchers', id: 'v1', v: 1 }])
  ok(stale.status === 409 && stale.body.error.code === 'aborted', 'worker: a transaction that read an older version is aborted')
  const fresh = await commit([{ t: 'set', col: 'finance_vouchers', id: 'v1', data: { total: 5 } }], 'sales1', [{ col: 'finance_vouchers', id: 'v1', v: 2 }])
  ok(fresh.status === 200, 'worker: a transaction that read the current version commits')

  // a counter + voucher written together (voucher numbering)
  const both = await commit([{ t: 'set', col: 'finance_counters', id: 'UIPL_purchase_26-27', data: { next: 2 } }, { t: 'set', col: 'finance_vouchers', id: 'v3', data: { n: 1 } }], 'sales1')
  ok(both.status === 200 && Object.keys(both.body.stamps).length === 2, 'worker: writes to two collections are one atomic commit, each collection stamped')

  // rules
  ok((await commit([{ t: 'set', col: 'finance_accounts', id: 'a1', data: { code: '1000' } }], 'sales1')).status === 403, 'worker: a non-admin cannot change the chart of accounts')
  ok((await commit([{ t: 'set', col: 'finance_accounts', id: 'a1', data: { code: '1000' } }], 'admin1')).status === 200, 'worker: an admin can')
  ok((await commit([{ t: 'set', col: 'users', id: 'x', data: { role: 'admin' } }], 'sales1')).status === 403, 'worker: a non-admin cannot create users (no self-promotion)')
  await commit([{ t: 'set', col: 'finance_audit_log', id: 'log1', data: { action: 'edit' } }], 'sales1')
  ok((await commit([{ t: 'update', col: 'finance_audit_log', id: 'log1', data: { action: 'x' } }], 'admin1')).status === 403 && (await commit([{ t: 'delete', col: 'finance_audit_log', id: 'log1' }], 'admin1')).status === 403, 'worker: the audit log cannot be edited or deleted, even by an admin')

  // public task links: anyone reads; outsiders change only status fields
  await commit([{ t: 'set', col: 'public_task_links', id: 'tok1', data: { title: 'Fix', status: 'open' } }], 'sales1')
  ok((await post('/v1/get', { col: 'public_task_links', id: 'tok1' })).body.doc.data.title === 'Fix', 'worker: a public task link can be read without signing in')
  ok((await commit([{ t: 'update', col: 'public_task_links', id: 'tok1', data: { status: 'done', statusNote: 'ok' } }])).status === 200, 'worker: an outsider can update the status of a public link')
  ok((await commit([{ t: 'update', col: 'public_task_links', id: 'tok1', data: { title: 'Hacked' } }])).status === 403, 'worker: an outsider cannot change anything else')

  // big fields can be left out (file bytes)
  await commit([{ t: 'set', col: 'finance_attachments', id: 'f1', data: { name: 'bill.pdf', data: 'AAAA'.repeat(1000), entityId: 'e1' } }], 'sales1')
  const lite = await post('/v1/list', { col: 'finance_attachments', omit: ['data'] }, 'sales1')
  ok(lite.body.docs.length === 1 && lite.body.docs[0].data.name === 'bill.pdf' && !('data' in lite.body.docs[0].data), 'worker: list can leave the file bytes out')
  const full = await post('/v1/list', { col: 'finance_attachments', eq: { entityId: 'e1' } }, 'sales1')
  ok(full.body.docs[0].data.data.length === 4000, 'worker: a filtered list still returns the bytes')

  // limits and bad input
  const many = Array.from({ length: 31 }, (_, i) => ({ t: 'set', col: 'tasks', id: 't' + i, data: { i } }))
  ok((await commit(many, 'sales1')).status === 400, 'worker: more than 30 writes in one commit is refused (free-plan limits)')
  const thirty = many.slice(0, 30)
  ok((await commit(thirty, 'sales1')).status === 200, 'worker: 30 writes in one commit work')
  const del = await commit([{ t: 'delete', col: 'tasks', id: 't0' }], 'sales1')
  ok(del.status === 200 && (await post('/v1/count', { col: 'tasks' }, 'sales1')).body.n === 29, 'worker: delete')
  ok((await post('/v1/list', { col: 'bad col!' }, 'sales1')).status === 400, 'worker: bad collection names are refused')

  // paging
  const p1 = await post('/v1/list', { col: 'tasks', limit: 10 }, 'sales1')
  const p2 = await post('/v1/list', { col: 'tasks', limit: 10, after: p1.body.next }, 'sales1')
  ok(p1.body.docs.length === 10 && p1.body.next && p2.body.docs[0].id > p1.body.docs[9].id, 'worker: a long list is paged with a cursor')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
