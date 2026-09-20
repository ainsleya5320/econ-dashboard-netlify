// ============================================================================
// BAKE — turn the dev server's 60-odd /api routes into static JSON.
//
// The handlers live inside vite.config.js's configureServer hook, which only
// exists while the dev server is running. Rather than refactor 4,000 lines of
// middleware out into something importable — and inherit the risk of the two
// copies drifting — this starts the real dev server, asks it for every route,
// writes the answers into public/api/, and shuts it down. Whatever the dev
// server serves is exactly what the deployed site gets.
//
// Feeds that take a minute or more to build cold are the reason this is a build
// step and not a serverless function; here they simply have as long as they
// need. Anything that fails keeps its previous baked copy rather than shipping
// a hole, and the run summary says which ones went stale.
// ============================================================================
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAIN, ENUMERATED, EXCLUDED } from './routes.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'api')
const PORT = Number(process.env.BAKE_PORT || 5199)
const BASE = `http://127.0.0.1:${PORT}`

// Feeds that crawl EDGAR or the SEC can legitimately run for minutes.
const ROUTE_TIMEOUT_MS = Number(process.env.BAKE_ROUTE_TIMEOUT || 300_000)
const BOOT_TIMEOUT_MS = 120_000
// Keep concurrency low: several feeds share the throttled FRED relay, and
// hammering them in parallel only makes them queue behind each other anyway.
const CONCURRENCY = Number(process.env.BAKE_CONCURRENCY || 3)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const mkdirp = p => fs.mkdirSync(p, { recursive: true })
const kb = n => `${(n / 1024).toFixed(0)}kb`

function log(...a) { console.log('[bake]', ...a) }

// ── start the dev server and wait for it to answer ──
async function startServer() {
  log(`starting vite on ${PORT}…`)
  const proc = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  })
  let boot = ''
  proc.stdout.on('data', d => { boot += d.toString() })
  proc.stderr.on('data', d => { boot += d.toString() })

  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (proc.exitCode != null) throw new Error(`vite exited (${proc.exitCode}) during boot:\n${boot.slice(-2000)}`)
    try {
      const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(4000) })
      if (r.ok) { log('dev server is up'); return proc }
    } catch { /* not listening yet */ }
    await sleep(700)
  }
  proc.kill('SIGKILL')
  throw new Error(`vite did not come up within ${BOOT_TIMEOUT_MS / 1000}s:\n${boot.slice(-2000)}`)
}

// ── fetch one route, write one file ──
async function bakeOne(urlPath, outFile) {
  const started = Date.now()
  const r = await fetch(BASE + urlPath, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) })
  const body = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${body.slice(0, 160)}`)
  let parsed
  try { parsed = JSON.parse(body) } catch { throw new Error(`not JSON — ${body.slice(0, 120)}`) }
  // A handler that answered with {error} is a failure, not a payload.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error && Object.keys(parsed).length <= 2) {
    throw new Error(`handler returned an error: ${String(parsed.error).slice(0, 160)}`)
  }
  mkdirp(path.dirname(outFile))
  fs.writeFileSync(outFile, body)
  return { bytes: body.length, ms: Date.now() - started }
}

// ── refresh every series the app is known to use ──
// fred-cache.json is committed to this fork as a seed: it is the set of series
// the running app has actually requested, which is a far more accurate list
// than anything a regex over src/ produces (that returns 880 candidates, most
// of them colour constants and ticker symbols). Asking the relay for each one
// lets its own TTL logic decide — fresh entries come back from cache in
// milliseconds, stale ones are refetched upstream and the file is rewritten.
async function warmFred() {
  const cacheFile = path.join(ROOT, 'fred-cache.json')
  if (!fs.existsSync(cacheFile)) return { warmed: 0, failed: 0, note: 'no seed cache' }
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  // Shortest TTL first: a daily series going stale matters, an annual one does
  // not. On Netlify each build starts from the committed cache and discards its
  // refreshed copy, so without this ordering the same tail would never refresh.
  const ids = Object.keys(cache).sort((a, b) => (cache[a]?.ttl ?? 1e12) - (cache[b]?.ttl ?? 1e12))
  const budget = Date.now() + Number(process.env.BAKE_FRED_BUDGET_MS || 480_000)
  let warmed = 0, failed = 0, ranOut = false
  await pool(ids, 4, async id => {
    if (Date.now() > budget) { ranOut = true; return }
    try {
      const r = await fetch(`${BASE}/api/fred?series_id=${encodeURIComponent(id)}&limit=6000`, { signal: AbortSignal.timeout(45_000) })
      if (r.ok) { await r.text(); warmed++ } else failed++
    } catch { failed++ }
  })
  if (ranOut) log(`  note: refresh budget reached; older values kept for the rest`)
  return { warmed, failed, total: ids.length, ranOut }
}

// ── the FRED relay is parameterised over ~1,200 series, so it gets split ──
// The dev server keeps every series it has ever fetched in fred-cache.json.
// One file per series lets the CDN serve them on demand instead of shipping a
// 6MB blob to every visitor on first paint.
//
// Written without a file extension, at exactly the path the client asks for.
// Static hosts serve a file at its literal path and response.json() parses it
// whatever the Content-Type says, so this needs no redirect rule — which
// matters because _redirects is inert under `vite preview` and therefore
// untestable before deploying.
function bakeFred() {
  const cacheFile = path.join(ROOT, 'fred-cache.json')
  if (!fs.existsSync(cacheFile)) {
    return { ok: false, reason: 'fred-cache.json not found — run the dev server once to populate it' }
  }
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  const dir = path.join(OUT, 'fred')
  mkdirp(dir)
  let n = 0, bytes = 0, skipped = 0
  for (const [id, hit] of Object.entries(cache)) {
    if (!hit?.obs?.length) { skipped++; continue }
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) { skipped++; continue }
    // same shape the relay serves: FRED's native envelope, newest first
    const payload = JSON.stringify({
      observations: hit.obs.slice().reverse().map(o => ({ date: o.d, value: String(o.v) })),
    })
    fs.writeFileSync(path.join(dir, id), payload)
    n++; bytes += payload.length
  }
  return { ok: true, series: n, skipped, bytes }
}

// ── a tiny worker pool ──
async function pool(items, size, fn) {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n], n) }
  }))
  return out
}

async function main() {
  const t0 = Date.now()
  mkdirp(OUT)

  const jobs = [
    ...PLAIN.map(r => ({ label: r, url: `/api/${r}`, file: path.join(OUT, r) })),
    ...ENUMERATED.flatMap(e => e.values.map(v => ({
      label: `${e.route}?${e.param}=${v}`,
      url: `/api/${e.route}?${e.param}=${encodeURIComponent(v)}`,
      file: path.join(OUT, e.route, v),
    }))),
  ]

  const server = await startServer()
  // Startup prefetches inside vite.config.js begin warming feeds on a timer;
  // give them a moment so the first requests do not all miss cold.
  log('letting startup prefetch settle…')
  await sleep(5000)

  const results = await pool(jobs, CONCURRENCY, async job => {
    try {
      const { bytes, ms } = await bakeOne(job.url, job.file)
      log(`  ok   ${job.label.padEnd(30)} ${kb(bytes).padStart(7)}  ${(ms / 1000).toFixed(1)}s`)
      return { ...job, ok: true, bytes, ms }
    } catch (e) {
      const stale = fs.existsSync(job.file)
      log(`  ${stale ? 'STALE' : 'FAIL '} ${job.label.padEnd(30)} ${e.message.slice(0, 90)}`)
      return { ...job, ok: false, stale, error: e.message }
    }
  })

  // Upstream sources that rate-limit (BLS especially) fail under concurrency
  // and succeed when asked one at a time. One unhurried retry pass is the
  // difference between nine missing metros and none.
  const failed = results.filter(r => !r.ok)
  if (failed.length) {
    log(`retrying ${failed.length} failed route${failed.length > 1 ? 's' : ''}, one at a time…`)
    for (const job of failed) {
      await sleep(1500)
      try {
        const { bytes, ms } = await bakeOne(job.url, job.file)
        log(`  ok   ${job.label.padEnd(30)} ${kb(bytes).padStart(7)}  ${(ms / 1000).toFixed(1)}s (retry)`)
        const i = results.indexOf(job)
        results[i] = { ...job, ok: true, bytes, ms, retried: true }
      } catch (e) {
        log(`  FAIL ${job.label.padEnd(30)} ${e.message.slice(0, 80)} (retry)`)
      }
    }
  }

  log('refreshing FRED series through the relay…')
  const warm = await warmFred()
  log(`  ${warm.warmed}/${warm.total ?? 0} refreshed${warm.failed ? `, ${warm.failed} failed` : ''}`)

  log('baking the FRED cache…')
  const fred = bakeFred()
  if (fred.ok) log(`  ok   ${String(fred.series).padStart(4)} series  ${kb(fred.bytes)}  (${fred.skipped} skipped)`)
  else log(`  FAIL fred — ${fred.reason}`)

  server.kill('SIGTERM')
  await sleep(600)
  if (server.exitCode == null) server.kill('SIGKILL')

  const ok = results.filter(r => r.ok)
  const stale = results.filter(r => !r.ok && r.stale)
  const missing = results.filter(r => !r.ok && !r.stale)
  const total = results.reduce((s, r) => s + (r.bytes || 0), 0) + (fred.bytes || 0)

  console.log('\n' + '─'.repeat(64))
  log(`${ok.length} baked · ${stale.length} kept stale · ${missing.length} missing · ${kb(total)} total · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  if (stale.length) log('stale (previous copy shipped): ' + stale.map(r => r.label).join(', '))
  if (missing.length) log('MISSING (panel will show its error state): ' + missing.map(r => r.label).join(', '))
  log('not baked by design: ' + Object.keys(EXCLUDED).join(', '))

  fs.writeFileSync(path.join(OUT, '_bake.json'), JSON.stringify({
    built: new Date().toISOString(),
    seconds: Math.round((Date.now() - t0) / 1000),
    ok: ok.map(r => r.label), stale: stale.map(r => r.label),
    missing: missing.map(r => ({ label: r.label, error: r.error })),
    fred: fred.ok ? { series: fred.series, refreshed: warm.warmed, refreshFailed: warm.failed } : { error: fred.reason },
  }, null, 2))

  // A handful of soft failures is normal — upstream sources go down. Losing
  // most of them means something structural broke, and shipping that silently
  // would be worse than failing the build.
  if (missing.length > jobs.length * 0.25) {
    console.error(`\n[bake] too many routes missing (${missing.length} of ${jobs.length}) — failing the build`)
    process.exit(1)
  }
}

main().catch(e => { console.error('[bake] fatal:', e); process.exit(1) })
