// ============================================================================
// Refresh the committed seed files in data/seeds/.
//
// Two sources refuse requests from Netlify's build machines (datacenter IPs)
// while answering normally from a home connection:
//   download.bls.gov   the State & Metro series catalog (sm.series, sm.area),
//                      used only to look up which series ids belong to each
//                      metro — the numbers themselves come from api.bls.gov
//   imf.org DataMapper current account, GDP and inflation (WEO), updated each
//                      April and October
// The server modules try the live source first and fall back to these seeds,
// so the Netlify bake always has something. Run this after each WEO release
// (or when BLS redefines metro series) and commit data/seeds/:
//
//   node scripts/refresh-seeds.mjs
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { METROS } from '../server/realEstateFeeds.js'
import { selectEmploymentSeries } from '../server/metroEmployment.js'
import { IMF_INDICATORS } from '../server/tradeFlows.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'data', 'seeds')
fs.mkdirSync(out, { recursive: true })
const get = async (url, as = 'text') => {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`)
  return as === 'json' ? r.json() : r.text()
}
const write = (name, data) => {
  const file = path.join(out, name)
  fs.writeFileSync(file, JSON.stringify(data))
  console.log(`wrote ${path.relative(root, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`)
}
const tsv = text => { const lines = text.trim().split(/\r?\n/), h = lines.shift().split('\t').map(s => s.trim()); return lines.map(l => Object.fromEntries(l.split('\t').map((v, i) => [h[i], v.trim()]))) }

// ── BLS metro catalog ──
{
  const ROOT = 'https://download.bls.gov/pub/time.series/sm/'
  const [series, areas] = await Promise.all([get(ROOT + 'sm.series'), get(ROOT + 'sm.area')])
  const names = Object.fromEntries(tsv(areas).map(a => [a.area_code, a.area_name]))
  const catalogs = Object.fromEntries(METROS.map(m => [m.code, { ...selectEmploymentSeries(series, m.code), areaName: names[m.code] ?? m.name }]))
  write('bls-employment-catalog.json', { version: 1, catalogs, fetchedAt: new Date().toISOString(), source: 'BLS State and Metro Area Employment (sm.series, sm.area)' })
}

// ── IMF DataMapper ──
{
  const DM = 'https://www.imf.org/external/datamapper/api/v1'
  const values = {}
  for (const ind of IMF_INDICATORS) {
    const v = (await get(`${DM}/${ind}`, 'json')).values?.[ind]
    if (!v || Object.keys(v).length < 150) throw new Error(`DataMapper ${ind}: unexpectedly few economies`)
    values[ind] = v
  }
  const countries = Object.fromEntries(Object.entries((await get(`${DM}/countries`, 'json')).countries || {}).map(([k, c]) => [k, { label: c.label }]))
  write('imf-datamapper.json', { values, countries, fetchedAt: new Date().toISOString(), source: 'IMF World Economic Outlook via DataMapper API' })
}
