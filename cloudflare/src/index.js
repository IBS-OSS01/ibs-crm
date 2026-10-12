// The app's document store on Cloudflare Workers + D1 (free plan) — a small stand-in for the Firestore calls the app makes.
//
//   POST /v1/list    { col, eq?: {field: value}, omit?: [field], after?, limit? }  → { docs: [{id, v, data}], next, stamp }   (omit = leave big fields such as file bytes out)
//   POST /v1/get     { col, id }                                    → { doc: {id, v, data} | null }
//   POST /v1/stamps  { cols: [..] }                                 → { stamps: { col: u } }     (cheap "did anything change?" check)
//   POST /v1/count   { col }                                        → { n }
//   POST /v1/commit  { ops: [{t, col, id, data?, merge?}], expect?: [{col, id, v}] } → { ok, stamps, docs }
//
// Every call carries the user's Firebase ID token; access follows rules.js (a port of firestore.rules).
// Free-plan limits shape this: ≤ 30 writes per commit, paged lists, and one tiny stamp per collection so other devices can
// find out about changes without re-reading anything.
import { verifyIdToken } from './auth.js'
import { allowed } from './rules.js'
import { applyOp, changedKeys, hasMarker, WriteError } from './docops.js'

const MAX_OPS = 30
const PAGE = 300
const COL_RE = /^[A-Za-z0-9_]{1,80}$/
const FIELD_RE = /^[A-Za-z0-9_]{1,60}$/
const okId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/')

class HttpError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code } }

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || ''
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  const allow = list.includes('*') ? '*' : list.includes(origin) ? origin : (list[0] || '')
  return { 'Access-Control-Allow-Origin': allow, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Dev-Uid', 'Access-Control-Max-Age': '86400' }
}
const reply = (req, env, body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(req, env) } })

// who is asking: { uid, provisioned, role } (loaded lazily — one D1 read, only when a rule needs it)
async function whoIs(req, env) {
  let uid = null
  const auth = req.headers.get('Authorization') || ''
  if (env.DEV_AUTH === '1' && req.headers.get('X-Dev-Uid')) uid = req.headers.get('X-Dev-Uid')      // local testing only; DEV_AUTH is never set in production
  else if (auth.startsWith('Bearer ')) uid = (await verifyIdToken(auth.slice(7), env.FIREBASE_PROJECT_ID))?.uid || null
  const ctx = { uid, provisioned: false, role: null }
  if (uid) {
    const row = await env.DB.prepare("SELECT data FROM docs WHERE col = 'users' AND id = ?").bind(uid).first()
    if (row) { ctx.provisioned = true; try { ctx.role = JSON.parse(row.data).role || null } catch { /* no role */ } }
  }
  return ctx
}

const need = (cond, status, code, msg) => { if (!cond) throw new HttpError(status, code, msg) }
const checkCol = (col) => need(typeof col === 'string' && COL_RE.test(col), 400, 'invalid-argument', 'Bad collection name')

// ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function list(body, ctx, env) {
  const { col } = body; checkCol(col)
  need(allowed(col, 'read', ctx), 403, 'permission-denied', `Not allowed to read ${col}`)
  const conds = ['col = ?'], args = [col]
  for (const [f, v] of Object.entries(body.eq || {})) {
    need(FIELD_RE.test(f), 400, 'invalid-argument', 'Bad field name')
    if (v === null) conds.push('json_extract(data, ?) IS NULL')
    else conds.push('json_extract(data, ?) = ?')
    args.push('$.' + f); if (v !== null) args.push(typeof v === 'boolean' ? (v ? 1 : 0) : v)
  }
  if (body.after) { conds.push('id > ?'); args.push(String(body.after)) }
  const limit = Math.min(Math.max(parseInt(body.limit) || PAGE, 1), PAGE)
  const omit = (Array.isArray(body.omit) ? body.omit : []).slice(0, 5)
  omit.forEach(f => need(typeof f === 'string' && FIELD_RE.test(f), 400, 'invalid-argument', 'Bad field name'))
  const cols = omit.length ? `json_remove(data, ${omit.map(() => '?').join(', ')})` : 'data'
  const [stampRes, rows] = await env.DB.batch([
    env.DB.prepare('SELECT u FROM colstamp WHERE col = ?').bind(col),
    env.DB.prepare(`SELECT id, v, ${cols} AS data FROM docs WHERE ${conds.join(' AND ')} ORDER BY id LIMIT ?`).bind(...omit.map(f => '$.' + f), ...args, limit + 1),
  ])
  const all = rows.results || []
  const page = all.slice(0, limit)
  const next = all.length > limit ? page[page.length - 1].id : null
  // the stored JSON text is passed straight through (no parse / re-stringify) to keep CPU low
  const out = page.map(r => `{"id":${JSON.stringify(r.id)},"v":${r.v},"data":${r.data}}`).join(',')
  return `{"docs":[${out}],"next":${JSON.stringify(next)},"stamp":${stampRes.results?.[0]?.u ?? 0}}`
}

async function getOne(body, ctx, env) {
  const { col, id } = body; checkCol(col); need(okId(id), 400, 'invalid-argument', 'Bad id')
  need(allowed(col, 'read', ctx), 403, 'permission-denied', `Not allowed to read ${col}`)
  const r = await env.DB.prepare('SELECT v, data FROM docs WHERE col = ? AND id = ?').bind(col, id).first()
  return r ? `{"doc":{"id":${JSON.stringify(id)},"v":${r.v},"data":${r.data}}}` : '{"doc":null}'
}

async function stamps(body, ctx, env) {
  const cols = Array.isArray(body.cols) ? body.cols.slice(0, 60) : []
  cols.forEach(checkCol)
  need(ctx.provisioned, 403, 'permission-denied', 'Sign in first')
  if (!cols.length) return { stamps: {} }
  const r = await env.DB.prepare(`SELECT col, u FROM colstamp WHERE col IN (${cols.map(() => '?').join(',')})`).bind(...cols).all()
  const out = Object.fromEntries(cols.map(c => [c, 0]))
  for (const x of r.results || []) out[x.col] = x.u
  return { stamps: out }
}

async function count(body, ctx, env) {
  const { col } = body; checkCol(col)
  need(allowed(col, 'read', ctx), 403, 'permission-denied', `Not allowed to read ${col}`)
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM docs WHERE col = ?').bind(col).first()
  return { n: r?.n || 0 }
}

// ── writes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function commit(body, ctx, env) {
  const ops = Array.isArray(body.ops) ? body.ops : []
  need(ops.length > 0 && ops.length <= MAX_OPS, 400, 'invalid-argument', `Send 1–${MAX_OPS} writes per commit`)
  for (const o of ops) { checkCol(o.col); need(okId(o.id), 400, 'invalid-argument', 'Bad id'); need(['set', 'update', 'delete'].includes(o.t), 400, 'invalid-argument', 'Bad write') }
  const expect = new Map((body.expect || []).map(e => [`${e.col}/${e.id}`, Number(e.v) || 0]))

  for (let attempt = 0; attempt < 3; attempt++) {
    // what is stored now for every document this commit touches, and the collections' stamps
    const keys = [...new Set(ops.map(o => `${o.col}/${o.id}`))]
    const cols = [...new Set(ops.map(o => o.col))]
    const where = keys.map(() => '(col = ? AND id = ?)').join(' OR ')
    const kargs = keys.flatMap(k => { const i = k.indexOf('/'); return [k.slice(0, i), k.slice(i + 1)] })
    const [docRes, stampRes] = await env.DB.batch([
      env.DB.prepare(`SELECT col, id, v, data FROM docs WHERE ${where}`).bind(...kargs),
      env.DB.prepare(`SELECT col, u FROM colstamp WHERE col IN (${cols.map(() => '?').join(',')})`).bind(...cols),
    ])
    const state = new Map()                       // key -> { data|null, v }
    for (const r of docRes.results || []) state.set(`${r.col}/${r.id}`, { data: JSON.parse(r.data), v: r.v })
    const startV = new Map(keys.map(k => [k, state.get(k)?.v || 0]))
    const prevStamp = Object.fromEntries(cols.map(c => [c, 0])); for (const r of stampRes.results || []) prevStamp[r.col] = r.u

    // a transaction that read these documents earlier must still see the same versions
    for (const [k, v] of expect) if (startV.has(k) && startV.get(k) !== v) throw new HttpError(409, 'aborted', 'A document changed since it was read')

    const now = new Date().toISOString(), nowMs = Date.now()
    const stmts = [], returned = []
    // one guard statement for the whole commit: aborts (and rolls back) everything if any document changed since we read it
    const guardRows = keys.map(k => [k.slice(0, k.indexOf('/')), k.slice(k.indexOf('/') + 1), startV.get(k)])
    stmts.push(env.DB.prepare("SELECT json(CASE WHEN (SELECT COUNT(*) FROM json_each(?) j WHERE COALESCE((SELECT d.v FROM docs d WHERE d.col = json_extract(j.value, '$[0]') AND d.id = json_extract(j.value, '$[1]')), 0) <> json_extract(j.value, '$[2]')) = 0 THEN '1' ELSE 'x' END)").bind(JSON.stringify(guardRows)))

    for (const o of ops) {
      const key = `${o.col}/${o.id}`
      const cur = state.get(key) || { data: null, v: 0 }
      let action = o.t === 'delete' ? 'delete' : (cur.data ? 'update' : 'create')
      let data = null
      try { data = applyOp(cur.data, o, now) } catch (e) { if (e instanceof WriteError) throw new HttpError(e.code === 'not-found' ? 404 : 400, e.code, e.message); throw e }
      need(allowed(o.col, action, ctx, { changedKeys: changedKeys(cur.data, data) }), 403, 'permission-denied', `Not allowed to ${action} in ${o.col}`)
      if (o.t === 'delete') {
        stmts.push(env.DB.prepare('DELETE FROM docs WHERE col = ? AND id = ?').bind(o.col, o.id))
        state.set(key, { data: null, v: cur.v + 1 })
      } else {
        const json = JSON.stringify(data)
        need(json.length < 1_900_000, 400, 'invalid-argument', 'Document is too large')
        stmts.push(env.DB.prepare('INSERT INTO docs (col, id, data, v, u) VALUES (?, ?, ?, 1, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data, v = docs.v + 1, u = excluded.u').bind(o.col, o.id, json, nowMs))
        state.set(key, { data, v: cur.v + 1 })
        // the caller already has plain data; anything computed here (server time, increments, merges) is sent back
        if (o.t === 'update' || o.merge || hasMarker(o.data)) returned.push(key)
      }
    }
    for (const c of cols) stmts.push(env.DB.prepare('INSERT INTO colstamp (col, u) VALUES (?, ?) ON CONFLICT(col) DO UPDATE SET u = MAX(colstamp.u + 1, excluded.u)').bind(c, nowMs))

    try { await env.DB.batch(stmts) }
    catch (e) {
      if (/malformed JSON/i.test(String(e.message))) continue          // someone else wrote in between — read again and redo
      throw e
    }
    const after = await env.DB.prepare(`SELECT col, u FROM colstamp WHERE col IN (${cols.map(() => '?').join(',')})`).bind(...cols).all()
    const outStamps = Object.fromEntries(cols.map(c => [c, { prev: prevStamp[c], u: prevStamp[c] }]))
    for (const r of after.results || []) outStamps[r.col].u = r.u
    const docs = [...new Set(returned)].map(k => { const s = state.get(k); const i = k.indexOf('/'); return { col: k.slice(0, i), id: k.slice(i + 1), v: s.v, data: s.data } }).filter(d => d.data)
    return { ok: true, stamps: outStamps, docs }
  }
  throw new HttpError(409, 'aborted', 'Too many simultaneous changes — try again')
}

// ── router ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) })
    const url = new URL(req.url)
    try {
      need(req.method === 'POST', 405, 'method-not-allowed', 'POST only')
      const body = await req.json().catch(() => ({}))
      const ctx = await whoIs(req, env)
      switch (url.pathname) {
        case '/v1/list': return reply(req, env, await list(body, ctx, env))
        case '/v1/get': return reply(req, env, await getOne(body, ctx, env))
        case '/v1/stamps': return reply(req, env, await stamps(body, ctx, env))
        case '/v1/count': return reply(req, env, await count(body, ctx, env))
        case '/v1/commit': return reply(req, env, await commit(body, ctx, env))
        default: throw new HttpError(404, 'not-found', 'Unknown endpoint')
      }
    } catch (e) {
      if (e instanceof HttpError) return reply(req, env, { error: { code: e.code, message: e.message } }, e.status)
      return reply(req, env, { error: { code: 'internal', message: String(e && e.message || e) } }, 500)
    }
  },
}
