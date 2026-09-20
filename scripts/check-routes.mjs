// Fail the build if src/ asks for an /api path the manifest does not bake.
// A missed route is invisible until a panel renders its error state on the
// live site, so this turns it into a build failure instead.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAIN, ENUMERATED, EXCLUDED } from './routes.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const found = new Set()
const FILES = []
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (!/\.(jsx?|tsx?)$/.test(e.name) || e.name.endsWith('.bak')) continue
    FILES.push(p)
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/["'`]\/api\/([a-zA-Z0-9-]+)/g)) found.add(m[1])
  }
}
walk(path.join(ROOT, 'src'))

// A query string has nothing to answer it on a static build: every response is
// a file at a literal path, and only the FMP function parses a query. Anything
// else with a "?" resolves to the SPA fallback, which returns index.html with a
// 200 and then fails as a JSON parse error — the least debuggable outcome there
// is. This caught two hand-built /api/fred?series_id=... calls that bypassed
// fetchFred and would otherwise have shipped broken.
const queryForm = []
for (const f of FILES) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/["'`](\/api\/([a-zA-Z0-9-]+)[^"'`\s]*\?[^"'`\s]*)/g)) {
    if (m[2] === 'fmp') continue
    queryForm.push(`${path.relative(ROOT, f)}: ${m[1].slice(0, 70)}`)
  }
}
if (queryForm.length) {
  console.error('[routes] these use a query string, which a static build cannot answer:')
  for (const q of queryForm) console.error('  ' + q)
  console.error('  → request the baked path instead, e.g. /api/fred/DGS10.')
  process.exit(1)
}

const baked = new Set([...PLAIN, ...ENUMERATED.map(e => e.route), 'fmp', ...Object.keys(EXCLUDED)])
const missing = [...found].filter(r => !baked.has(r)).sort()
const unused = [...PLAIN].filter(r => !found.has(r)).sort()

if (unused.length) console.warn(`[routes] baked but never requested by src/: ${unused.join(', ')}`)
if (missing.length) {
  console.error(`[routes] src/ requests these, and nothing bakes them:\n  ${missing.join('\n  ')}`)
  console.error('  → add to PLAIN/ENUMERATED in scripts/routes.mjs, or to EXCLUDED with a reason.')
  process.exit(1)
}
console.log(`[routes] ok — ${found.size} paths requested, all covered`)
