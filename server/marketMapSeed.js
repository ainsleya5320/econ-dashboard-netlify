// ============================================================================
// MARKET MAP — the annual half, data/seeds/market-map-annual.json.
//
// Everything here moves about once a year, and two of the sources are poor
// fits for a Netlify build (www2.census.gov's firewall answers bursts with a
// 200 "Request Rejected" page; Realtor.com's county history is ~100 MB), so
// it is built on this machine by scripts/refresh-seeds.mjs and committed.
// server/marketMap.js joins it to the monthly Zillow and Realtor.com files.
//
//   SAIPE     median household income 2000→latest and poverty %, counties,
//             states, U.S. (fixed-width; income at columns 134–139 in every
//             year's layout — 2000–2002 are .dat, later years .txt)
//   PEP       population 2020, prior year, latest; components of change as
//             rates per 1,000 (births, deaths, natural, international and
//             domestic migration, net migration)
//   ACS 5-yr  housing units, occupancy, tenure, vacancy status, median value,
//             median real-estate taxes — the key-free table-based summary
//             files, not the API (which needs a key)
//   BPS       housing units authorized by permits, latest full year
//   CBSA      the 2023 delineation: the counties in each metro / micro area
//   Realtor   2017–2019 average active listings for each calendar month, the
//             pre-pandemic inventory baseline (seasonal, so month-matched)
//
// Ids: 'US', state FIPS ('53'), county FIPS ('53033'), metro 'm' + CBSA code.
// Metros take ACS directly (CBSA rows) but SAIPE, PEP and permits by
// aggregating member counties — SAIPE has no metro estimates, so metro
// income is the household-weighted mean of the member counties' medians.
// ============================================================================
import XLSX from 'xlsx'

const C = 'https://www2.census.gov'
const RDC = 'https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const sleep = ms => new Promise(r => setTimeout(r, ms))

export const SEED_NAME = 'market-map-annual.json'
// [postal, FIPS, name] — the 50 states and DC (Puerto Rico is outside Zillow's
// and SAIPE's coverage, so it is left out everywhere)
export const STATES = [
  ['AL', '01', 'Alabama'], ['AK', '02', 'Alaska'], ['AZ', '04', 'Arizona'], ['AR', '05', 'Arkansas'], ['CA', '06', 'California'],
  ['CO', '08', 'Colorado'], ['CT', '09', 'Connecticut'], ['DE', '10', 'Delaware'], ['DC', '11', 'District of Columbia'], ['FL', '12', 'Florida'],
  ['GA', '13', 'Georgia'], ['HI', '15', 'Hawaii'], ['ID', '16', 'Idaho'], ['IL', '17', 'Illinois'], ['IN', '18', 'Indiana'],
  ['IA', '19', 'Iowa'], ['KS', '20', 'Kansas'], ['KY', '21', 'Kentucky'], ['LA', '22', 'Louisiana'], ['ME', '23', 'Maine'],
  ['MD', '24', 'Maryland'], ['MA', '25', 'Massachusetts'], ['MI', '26', 'Michigan'], ['MN', '27', 'Minnesota'], ['MS', '28', 'Mississippi'],
  ['MO', '29', 'Missouri'], ['MT', '30', 'Montana'], ['NE', '31', 'Nebraska'], ['NV', '32', 'Nevada'], ['NH', '33', 'New Hampshire'],
  ['NJ', '34', 'New Jersey'], ['NM', '35', 'New Mexico'], ['NY', '36', 'New York'], ['NC', '37', 'North Carolina'], ['ND', '38', 'North Dakota'],
  ['OH', '39', 'Ohio'], ['OK', '40', 'Oklahoma'], ['OR', '41', 'Oregon'], ['PA', '42', 'Pennsylvania'], ['RI', '44', 'Rhode Island'],
  ['SC', '45', 'South Carolina'], ['SD', '46', 'South Dakota'], ['TN', '47', 'Tennessee'], ['TX', '48', 'Texas'], ['UT', '49', 'Utah'],
  ['VT', '50', 'Vermont'], ['VA', '51', 'Virginia'], ['WA', '53', 'Washington'], ['WV', '54', 'West Virginia'], ['WI', '55', 'Wisconsin'],
  ['WY', '56', 'Wyoming'],
]
const FIPS_OF = Object.fromEntries(STATES.map(([ab, f]) => [ab, f]))
const IN_SCOPE = new Set(STATES.map(s => s[1]))
const inScope = id => id === 'US' || IN_SCOPE.has(id.slice(0, 2))

// a CSV line; the fast path covers files with no quoted fields
export function splitCsv(line) {
  if (!line.includes('"')) return line.split(',')
  const cells = []
  let value = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++ } else quoted = !quoted }
    else if (c === ',' && !quoted) { cells.push(value); value = '' }
    else value += c
  }
  cells.push(value)
  return cells
}

async function get(url, { as = 'text', tries = 4, log } = {}) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(600_000) })
      if (r.status === 404) { const e = new Error('HTTP 404'); e.notFound = true; throw e }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      if (as === 'buffer') return Buffer.from(await r.arrayBuffer())
      if (as === 'latin1') return new TextDecoder('latin1').decode(await r.arrayBuffer())
      const t = await r.text()
      // The firewall answers both bursts and some missing files with a 200
      // "Request Rejected" page, so never guess a file name: read the listing.
      if (as !== 'html' && /^\s*<(!doctype|html)/i.test(t.slice(0, 200))) throw new Error('an HTML page instead of data (rate limited, or no such file)')
      return t
    } catch (e) {
      if (e.notFound || i >= tries) { e.message = `${url}: ${e.message}`; throw e }
      log?.(`  retry ${i} (${url.split('/').pop()}): ${e.message}`)
      await sleep(6000 * i)
    }
  }
}
// the newest of several candidate vintages that exists
async function newest(candidates, opts) {
  for (const [label, url] of candidates) {
    try { return { label, text: await get(url, opts) } } catch (e) { if (!e.notFound) throw e }
  }
  throw new Error(`none of ${candidates.map(c => c[1].split('/').pop()).join(', ')} is published`)
}

const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null)
const num = s => { const v = Number(String(s ?? '').trim()); return s != null && String(s).trim() !== '' && Number.isFinite(v) ? v : null }

// ── CBSA delineation (2023): code → [title, 'metro' | 'micro', [county FIPS]] ──
async function delineation(log) {
  const buf = await get(`${C}/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx`, { as: 'buffer', log })
  const wb = XLSX.read(buf)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
  const h = rows.findIndex(r => r.includes('CBSA Code'))
  if (h < 0) throw new Error('delineation file: no "CBSA Code" header')
  const head = rows[h], col = name => head.findIndex(x => String(x).trim() === name)
  const iCode = col('CBSA Code'), iTitle = col('CBSA Title'), iType = col('Metropolitan/Micropolitan Statistical Area'), iSt = col('FIPS State Code'), iCo = col('FIPS County Code')
  if ([iCode, iTitle, iType, iSt, iCo].some(i => i < 0)) throw new Error('delineation file: columns moved')
  const out = {}
  for (const r of rows.slice(h + 1)) {
    const code = String(r[iCode]).trim()
    if (!/^\d{5}$/.test(code)) continue
    const county = String(r[iSt]).trim().padStart(2, '0') + String(r[iCo]).trim().padStart(3, '0')
    if (!inScope(county)) continue
    const a = (out[code] ||= [String(r[iTitle]).trim(), /Metropolitan/i.test(r[iType]) ? 'metro' : 'micro', []])
    a[2].push(county)
  }
  return out
}

// ── ACS 5-year: id → [units, occupied, vacant, owner, renter, forRent,
//    rentedNotOccupied, forSale, soldNotOccupied, otherVacant, medianValue, medianTax]
const ACS = [['B25002', [1, 2, 3]], ['B25003', [2, 3]], ['B25004', [2, 3, 4, 5, 8]], ['B25077', [1]], ['B25103', [1]]]
async function acsTables(log) {
  const y0 = new Date().getUTCFullYear() - 1
  let year = null
  const rows = {}
  for (const [table, cells] of ACS) {
    const url = y => `${C}/programs-surveys/acs/summary_file/${y}/table-based-SF/data/5YRData/acsdt5y${y}-${table.toLowerCase()}.dat`
    const { label, text } = await newest((year ? [year] : [y0, y0 - 1, y0 - 2]).map(y => [y, url(y)]), { log })
    year = label
    const lines = text.split(/\r?\n/)
    const head = lines[0].replace(/^﻿/, '').split('|')
    const idx = cells.map(n => head.indexOf(`${table}_E${String(n).padStart(3, '0')}`))
    if (idx.some(i => i < 0)) throw new Error(`ACS ${table}: expected columns missing`)
    for (const l of lines.slice(1)) {
      const bar = l.indexOf('|'); if (bar < 0) continue
      const g = l.slice(0, bar)
      let id = null, m
      if (g === '0100000US') id = 'US'
      else if ((m = /^0400000US(\d{2})$/.exec(g))) id = m[1]
      else if ((m = /^0500000US(\d{5})$/.exec(g))) id = m[1]
      else if ((m = /^310M\d00US(\d{5})$/.exec(g))) id = 'm' + m[1]
      if (!id || (id[0] !== 'm' && !inScope(id))) continue
      const c = l.split('|')
      ;(rows[id] ||= []).push(...idx.map(i => num(c[i])))
    }
    log?.(`  ACS ${table} (${year} 5-year)`)
    await sleep(2500)
  }
  // a row is only usable with every table present
  const width = ACS.reduce((s, [, c]) => s + c.length, 0)
  for (const id of Object.keys(rows)) if (rows[id].length !== width) delete rows[id]
  return { year, rows }
}

// ── SAIPE: { years: [2000..], rows: id → { i: [income by year], p: latest poverty % } } ──
// The all-areas file is estYYall.dat in some years and .txt in others (2003
// is .dat, 2002 and 2004 are not what you would guess), so each year's
// directory listing names it.
async function saipe(log) {
  const last = new Date().getUTCFullYear() - 1
  const years = [], byYear = {}
  for (let y = 2000; y <= last; y++) {
    const dir = `${C}/programs-surveys/saipe/datasets/${y}/${y}-state-and-county/`
    let listing = null
    try { listing = await get(dir, { as: 'html', log }) } catch (e) { if (!e.notFound) throw e }
    for (let n = 1; n <= 3 && /Request Rejected/i.test(listing || ''); n++) { log?.(`  SAIPE ${y}: listing rejected, waiting`); await sleep(8000 * n); listing = await get(dir, { as: 'html', log }) }
    const file = listing && /href="(est\d\dall\.(?:txt|dat))"/i.exec(listing)?.[1]
    if (!file) { if (y >= last - 1) break; throw new Error(`SAIPE ${y}: no all-areas estimate file in ${dir}`) }
    await sleep(1000)
    const text = await get(dir + file, { log })
    const rows = {}
    for (const l of text.split(/\r?\n/)) {
      if (l.length < 139) continue
      const st = l.slice(0, 2), co = l.slice(3, 6).trim()
      if (!/^\d\d$/.test(st) || !/^\d+$/.test(co)) continue
      const id = co === '0' ? (st === '00' ? 'US' : st) : st + co.padStart(3, '0')
      if (!inScope(id)) continue
      const inc = num(l.slice(133, 139)), pov = num(l.slice(34, 38))
      rows[id] = [inc > 0 ? inc : null, pov]
    }
    years.push(y); byYear[y] = rows
    log?.(`  SAIPE ${y}: ${Object.keys(rows).length} areas`)
    await sleep(1500)
  }
  const ids = new Set(years.flatMap(y => Object.keys(byYear[y])))
  const out = {}
  for (const id of ids) {
    const i = years.map(y => byYear[y][id]?.[0] ?? null)
    const latest = years.length - 1 - [...years].reverse().findIndex(y => byYear[y][id]?.[1] != null)
    out[id] = { i, p: latest < years.length ? byYear[years[latest]][id][1] : null }
  }
  return { years, rows: out }
}

// ── PEP: id → { n: name, pop: [2020, prior, latest], r: [birth, death, natural, intl, domestic, net] per 1,000 } ──
async function popEstimates(log) {
  const v = new Date().getUTCFullYear() - 1
  const url = y => `${C}/programs-surveys/popest/datasets/2020-${y}/counties/totals/co-est${y}-alldata.csv`
  const { label: year, text } = await newest([[v, url(v)], [v - 1, url(v - 1)]], { as: 'latin1', log })
  const lines = text.split(/\r?\n/)
  const head = splitCsv(lines[0].replace(/^﻿/, ''))
  const ix = n => { const i = head.indexOf(n); if (i < 0) throw new Error(`PEP: no ${n} column`); return i }
  const cols = {
    lev: ix('SUMLEV'), st: ix('STATE'), co: ix('COUNTY'), sn: ix('STNAME'), cn: ix('CTYNAME'),
    pop: [ix('POPESTIMATE2020'), ix(`POPESTIMATE${year - 1}`), ix(`POPESTIMATE${year}`)],
    r: ['RBIRTH', 'RDEATH', 'RNATURALCHG', 'RINTERNATIONALMIG', 'RDOMESTICMIG', 'RNETMIG'].map(k => ix(`${k}${year}`)),
  }
  const rows = {}
  for (const l of lines.slice(1)) {
    if (!l.trim()) continue
    const c = splitCsv(l), lev = Number(c[cols.lev])
    const id = lev === 40 ? c[cols.st].padStart(2, '0') : lev === 50 ? c[cols.st].padStart(2, '0') + c[cols.co].padStart(3, '0') : null
    if (!id || !inScope(id)) continue
    rows[id] = { n: lev === 40 ? c[cols.sn] : c[cols.cn], pop: cols.pop.map(i => num(c[i])), r: cols.r.map(i => r1(num(c[i]))) }
  }
  log?.(`  population estimates vintage ${year}: ${Object.keys(rows).length} areas`)
  return { year, rows }
}

// ── BPS: county FIPS → units authorized (1-unit + 2 + 3–4 + 5+), latest year ──
async function permits(log) {
  const y = new Date().getUTCFullYear() - 1
  const url = yr => `${C}/econ/bps/County/co${yr}a.txt`
  const { label: year, text } = await newest([[y, url(y)], [y - 1, url(y - 1)]], { log })
  const rows = {}
  for (const l of text.split(/\r?\n/)) {
    const c = l.split(',')
    if (!/^\d{4}$/.test(c[0]?.trim())) continue
    const id = c[1].trim().padStart(2, '0') + c[2].trim().padStart(3, '0')
    if (!inScope(id)) continue
    const units = [7, 10, 13, 16].reduce((s, i) => s + (num(c[i]) ?? 0), 0)
    rows[id] = units
  }
  log?.(`  building permits ${year}: ${Object.keys(rows).length} counties`)
  return { year, rows }
}

// ── Realtor.com 2017–19 baseline: id → 12 monthly average active listings ──
async function baselines(log) {
  const files = [
    ['RDC_Inventory_Core_Metrics_County_History.csv', 'county_fips', k => k.padStart(5, '0')],
    ['RDC_Inventory_Core_Metrics_Metro_History.csv', 'cbsa_code', k => 'm' + k],
    ['RDC_Inventory_Core_Metrics_State_History.csv', 'state_id', k => FIPS_OF[k.toUpperCase()]],
    ['RDC_Inventory_Core_Metrics_Country_History.csv', null, () => 'US'],
  ]
  const out = {}
  for (const [file, keyCol, keyOf] of files) {
    const text = await get(RDC + file, { log })
    const lines = text.split(/\r?\n/)
    const head = splitCsv(lines[0])
    const iM = head.indexOf('month_date_yyyymm'), iA = head.indexOf('active_listing_count'), iK = keyCol ? head.indexOf(keyCol) : -1
    if (iM < 0 || iA < 0 || (keyCol && iK < 0)) throw new Error(`${file}: columns moved`)
    const acc = {}
    for (const l of lines.slice(1)) {
      const c = splitCsv(l), ym = c[iM]
      if (!/^20(17|18|19)(0[1-9]|1[0-2])$/.test(ym)) continue
      const v = num(c[iA]); if (v == null || v < 0) continue
      const id = keyOf(keyCol ? c[iK].trim() : '')
      if (!id || (id[0] !== 'm' && !inScope(id))) continue
      const m = Number(ym.slice(4)) - 1, a = (acc[id] ||= Array.from({ length: 12 }, () => [0, 0]))
      a[m][0] += v; a[m][1]++
    }
    for (const [id, a] of Object.entries(acc)) out[id] = a.map(([s, n]) => (n >= 2 ? r1(s / n) : null))
    log?.(`  Realtor.com baseline ${file.replace('RDC_Inventory_Core_Metrics_', '').replace('.csv', '')}: ${Object.keys(acc).length} areas`)
  }
  return out
}

// weighted mean over the members that have both a value and a weight; null if
// those carry less than `cover` of the total weight
function wmean(pairs, cover = 0.6) {
  let s = 0, w = 0, wAll = 0
  for (const [v, wt] of pairs) { if (!(wt > 0)) continue; wAll += wt; if (Number.isFinite(v)) { s += v * wt; w += wt } }
  return w > 0 && w >= cover * wAll ? s / w : null
}

export async function buildMarketMapSeed({ log = console.log } = {}) {
  const t0 = Date.now()
  log('market map: CBSA delineation (2023)')
  const cbsa = await delineation(log)
  log('market map: ACS 5-year housing tables')
  const acs = await acsTables(log)
  log('market map: SAIPE median household income')
  const sp = await saipe(log)
  log('market map: population estimates')
  const pep = await popEstimates(log)
  log('market map: building permits')
  const bps = await permits(log)
  log('market map: Realtor.com 2017–19 inventory baselines')
  const base = await baselines(log)

  const areas = {}
  const A = id => (areas[id] ||= {})
  // counties, states and the U.S. straight from each source
  for (const [id, a] of Object.entries(acs.rows)) if (id[0] !== 'm') A(id).a = a
  for (const [id, s] of Object.entries(sp.rows)) { A(id).i = s.i; areas[id].p = s.p }
  for (const [id, p] of Object.entries(pep.rows)) { A(id).n = p.n; areas[id].pop = p.pop; areas[id].r = p.r }
  for (const [id, u] of Object.entries(bps.rows)) A(id).b = u
  for (const [id, b] of Object.entries(base)) if (id[0] !== 'm') A(id).base = b
  // states and the U.S.: permits summed from counties; U.S. population from the states
  const sum = ids => ids.reduce((s, id) => s + (bps.rows[id] ?? 0), 0)
  for (const [, f] of STATES) A(f).b = sum(Object.keys(bps.rows).filter(id => id.startsWith(f)))
  A('US').b = sum(Object.keys(bps.rows))
  const states = STATES.map(s => pep.rows[s[1]]).filter(Boolean)
  A('US').n = 'United States'
  areas.US.pop = [0, 1, 2].map(k => states.reduce((s, p) => s + (p.pop[k] ?? 0), 0))
  areas.US.r = [0, 1, 2, 3, 4, 5].map(k => r1(wmean(states.map(p => [p.r[k], p.pop[2]]), 0.95)))

  // metros: ACS direct; income, poverty, population and permits from member counties
  const out = {}
  for (const [code, [title, kind, counties]] of Object.entries(cbsa)) {
    const id = 'm' + code, m = A(id)
    m.n = title
    if (acs.rows[id]) m.a = acs.rows[id]
    const hh = c => acs.rows[c]?.[1]                 // occupied units = households
    m.i = sp.years.map((_, k) => { const v = wmean(counties.map(c => [sp.rows[c]?.i[k], hh(c)])); return v == null ? null : Math.round(v) })
    m.p = r1(wmean(counties.map(c => [sp.rows[c]?.p, pep.rows[c]?.pop[2]])))
    const pops = counties.map(c => pep.rows[c]).filter(Boolean)
    if (pops.length === counties.length) {
      m.pop = [0, 1, 2].map(k => pops.reduce((s, p) => s + (p.pop[k] ?? 0), 0))
      m.r = [0, 1, 2, 3, 4, 5].map(k => r1(wmean(pops.map(p => [p.r[k], p.pop[2]]), 0.95)))
    }
    m.b = counties.reduce((s, c) => s + (bps.rows[c] ?? 0), 0)
    if (base[id]) m.base = base[id]
    out[code] = [title, kind, counties]
  }

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    vintages: { acs: `${acs.year - 4}–${acs.year} ACS 5-year`, saipe: sp.years.at(-1), pep: pep.year, bps: bps.year, cbsa: 2023, base: '2017–2019' },
    saipeYears: sp.years,
    cbsa: out,
    areas,
    tookSeconds: Math.round((Date.now() - t0) / 1000),
  }
}
