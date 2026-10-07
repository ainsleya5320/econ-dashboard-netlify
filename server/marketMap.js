// ============================================================================
// MARKET MAP — Real Estate → Market Map: every state, metro (CBSA) and county
// on one choropleth, a scorecard per area, and a correction-risk score.
// Reventure App's map is the model; this one is built only from published
// data and shows its arithmetic.
//
// Monthly, fetched here and cached 24h:
//   Zillow ZHVI       typical home value, counties / metros / states, 2000→
//   Zillow ZORI       typical asking rent, counties / metros, 2015→
//   Zillow ZHVF       Zillow's own 12-month forecast, metros only (Zillow
//                     publishes no county forecast)
//   Realtor.com       latest month's listings: price, active and new
//                     listings, days on market, price-cut share, with Realtor's
//                     own year-on-year changes (the small "current" files —
//                     the 100 MB histories are only needed for the 2017–19
//                     baseline, which is in the seed)
//   FRED MORTGAGE30US the 30-year rate for the payment arithmetic
// Annual: data/seeds/market-map-annual.json (server/marketMapSeed.js) —
// SAIPE income, population, ACS housing, permits, CBSA membership, the
// 2017–19 inventory baseline.
//
// Routes: /api/market-map/{state|metro|county}  one row per area, columnar
//         /api/market-map/history/{ST}          monthly home values since 2000
//                                               and the value-to-income ratio
//                                               for every area in one state
//
// Metros: Zillow names metros by principal city ("Seattle, WA"), not CBSA
// code, so they are matched on first city + first state against the CBSA
// titles (and Realtor.com's titles, which carry the codes).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { STATES, SEED_NAME, splitCsv } from './marketMapSeed.js'

const Z = 'https://files.zillowstatic.com/research/public_csvs/'
const RDC = 'https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/'
const SRC = {
  zCounty: Z + 'zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv',
  zMetro: Z + 'zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv',
  zState: Z + 'zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv',
  rentCounty: Z + 'zori/County_zori_uc_sfrcondomfr_sm_month.csv',
  rentMetro: Z + 'zori/Metro_zori_uc_sfrcondomfr_sm_month.csv',
  forecast: Z + 'zhvf_growth/Metro_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv',
  rdcCounty: RDC + 'RDC_Inventory_Core_Metrics_County.csv',
  rdcMetro: RDC + 'RDC_Inventory_Core_Metrics_Metro.csv',
  rdcState: RDC + 'RDC_Inventory_Core_Metrics_State.csv',
  rdcUS: RDC + 'RDC_Inventory_Core_Metrics_Country.csv',
}
const TTL = 24 * 3600e3
const ABBR = Object.fromEntries(STATES.map(([ab, f]) => [f, ab]))
const FIPS = Object.fromEntries(STATES.map(([ab, f]) => [ab, f]))
const NAME = Object.fromEntries(STATES.map(([, f, n]) => [f, n]))
const BY_NAME = Object.fromEntries(STATES.map(([, f, n]) => [n.toLowerCase(), f]))

// The assumptions behind the derived numbers; the page prints them.
export const ASSUME = {
  down: 0.20,            // payment: 20% down, 30-year fixed at Freddie Mac's latest rate
  insurance: 0.005,      // cap rate: homeowner's insurance at 0.5% of value a year
  opex: 0.25,            // cap rate: vacancy, management, maintenance and capex at 25% of rent
  afford: 0.30,          // salary to afford: payment at 30% of gross income
  incomeGrowthCap: 0.07, // income carried forward from SAIPE's latest year at the area's own 5-year pace, 0–7% a year
  base: [2000, 2019],    // the overvaluation baseline: the area's average value-to-income ratio over these years
}
// Correction risk: a percentile score within each level (0 = lowest risk of
// the areas scored, 100 = highest). Overvaluation is required — without it
// the score would be listing momentum alone and mean something different —
// plus at least two of the four listing inputs; weights renormalise over what
// an area has. Areas with fewer than SCORE_MIN_LISTINGS active listings are
// too thin to read and are not scored.
export const SCORE = [
  { key: 'overvalued', w: 35 },   // value-to-income vs its own 2000–19 average
  { key: 'invVs1719', w: 20 },    // active listings vs the same month in 2017–19
  { key: 'activeYoy', w: 15 },    // active listings, year on year
  { key: 'cut', w: 15 },          // share of listings with a price cut
  { key: 'domYoy', w: 15 },       // days on market, year on year
]
const SCORE_MIN_LISTINGS = 50
// Connecticut swapped its 8 counties for 9 planning regions in 2022 and the
// 2023 CBSA delineation uses the regions, but the map's county outlines (and
// Zillow and Realtor.com) still use the old counties. For drawing a metro, each
// old county joins the CBSA of the planning region that covers most of it.
const CT_REGION = { '09001': '09190', '09003': '09110', '09005': '09160', '09007': '09130', '09009': '09170', '09011': '09180', '09013': '09110', '09015': '09150' }

const fin = v => v != null && Number.isFinite(v)
const pct = v => (fin(v) ? v * 100 : null)
const num = s => { if (s == null) return null; const t = String(s).trim(); if (t === '') return null; const v = Number(t); return Number.isFinite(v) ? v : null }
const pAndI = (P, ratePct) => { const i = ratePct / 1200; return i > 0 ? (P * i) / (1 - (1 + i) ** -360) : P / 360 }
// decimals kept per metric in the payload
const DP = {
  value: 0, payment: 0, salary: 0, rent: 0, listPrice: 0, ppsf: 0, income: 0, active: 0, newListings: 0, pop: 0, dom: 0, risk: 0,
  vti: 2, vtiBase: 2, p2r: 1, natInc: 1, intlMig: 1, domMig: 1, netMig: 1, permits: 1, poverty: 1,
}
const round = (k, v) => { if (!fin(v)) return null; const dp = DP[k] ?? 2, f = 10 ** dp; return Math.round(v * f) / f }

async function getText(url, UA) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180_000) })
  if (!r.ok) throw new Error(`${url.split('/').pop()} HTTP ${r.status}`)
  return r.text()
}

// ── Zillow wide files: id → { name, st, vals: Float64Array aligned to dates } ──
function parseZillow(text, kind) {
  const lines = text.split(/\r?\n/)
  const head = splitCsv(lines[0].replace(/^﻿/, ''))
  const first = head.findIndex(h => /^\d{4}-\d{2}-\d{2}$/.test(h))
  if (first < 0) throw new Error('Zillow file without date columns')
  const dates = head.slice(first).map(d => d.slice(0, 7))
  const col = n => head.indexOf(n)
  const iName = col('RegionName'), iType = col('RegionType'), iSt = col('StateCodeFIPS'), iCo = col('MunicipalCodeFIPS'), iState = col('State'), iStateName = col('StateName'), iMetro = col('Metro')
  const rows = new Map()
  for (let k = 1; k < lines.length; k++) {
    if (!lines[k]) continue
    const c = splitCsv(lines[k])
    let id = null
    if (c[iType] === 'country') id = 'US'
    else if (kind === 'county') id = c[iSt] && c[iCo] ? c[iSt].padStart(2, '0') + c[iCo].padStart(3, '0') : null
    else if (kind === 'state') id = BY_NAME[String(c[iName]).toLowerCase()] ?? null
    else id = c[iName]
    if (!id || rows.has(id)) continue
    const vals = new Float64Array(dates.length)
    for (let j = 0; j < dates.length; j++) { const v = num(c[first + j]); vals[j] = v == null ? NaN : v }
    rows.set(id, { name: c[iName], st: (iState >= 0 ? c[iState] : c[iStateName]) || '', metro: iMetro >= 0 ? c[iMetro] : null, vals })
  }
  return { dates, rows }
}
// Zillow's forecast file: metro name → the longest-horizon forecast (12 months), %
function parseForecast(text) {
  const lines = text.split(/\r?\n/), head = splitCsv(lines[0].replace(/^﻿/, ''))
  const iName = head.indexOf('RegionName'), iType = head.indexOf('RegionType'), last = head.length - 1
  const out = new Map()
  for (const l of lines.slice(1)) {
    if (!l) continue
    const c = splitCsv(l), v = num(c[last])
    if (v != null) out.set(c[iType] === 'country' ? 'US' : c[iName], v)
  }
  return { horizon: head[last], rows: out }
}
// Realtor.com "current" files: id → { ym, f: { field: value }, title }
const RF = ['median_listing_price', 'median_listing_price_yy', 'active_listing_count', 'active_listing_count_yy', 'median_days_on_market', 'median_days_on_market_yy',
  'new_listing_count', 'new_listing_count_yy', 'price_reduced_share', 'price_reduced_share_yy', 'median_listing_price_per_square_foot', 'median_listing_price_per_square_foot_yy']
function parseRealtor(text, keyCol, keyOf) {
  const lines = text.split(/\r?\n/), head = splitCsv(lines[0].replace(/^﻿/, ''))
  const iM = head.indexOf('month_date_yyyymm'), iK = keyCol ? head.indexOf(keyCol) : -1, iT = head.indexOf('cbsa_title')
  const idx = RF.map(f => head.indexOf(f))
  if (iM < 0 || (keyCol && iK < 0)) throw new Error('Realtor.com file: columns moved')
  const rows = new Map()
  let ym = null
  for (const l of lines.slice(1)) {
    const c = splitCsv(l)
    if (!/^\d{6}$/.test(c[iM] || '')) continue
    const id = keyOf(keyCol ? String(c[iK]).trim() : '')
    if (!id) continue
    ym = c[iM]
    rows.set(id, { ym: c[iM], f: Object.fromEntries(RF.map((f, j) => [f, idx[j] >= 0 ? num(c[idx[j]]) : null])), title: iT >= 0 ? c[iT] : null })
  }
  return { ym, rows }
}

// index helpers over Zillow's monthly date list
function dateIndex(dates) {
  const at = d => dates.indexOf(d)
  const years = {}
  dates.forEach((d, j) => { const y = d.slice(0, 4); if (!years[y]) years[y] = [j, j]; else years[y][1] = j })
  const clamp = j => (j < 0 ? -1 : j)
  return { dates, years, i2022: [at('2022-01'), at('2022-12')], iBoom: [at('2004-01'), at('2008-12')], iBustEnd: clamp(at('2013-12')) }
}
function zStats(vals, D) {
  let k = vals.length - 1
  while (k >= 0 && !Number.isFinite(vals[k])) k--
  if (k < 0) return null
  const v = vals[k], at = o => (k - o >= 0 && Number.isFinite(vals[k - o]) ? vals[k - o] : null)
  let hi22 = null
  if (D.i2022[0] >= 0) for (let j = D.i2022[0]; j <= D.i2022[1]; j++) if (Number.isFinite(vals[j]) && (hi22 == null || vals[j] > hi22)) hi22 = vals[j]
  // the 2000s boom and bust: highest month 2004–08, then the lowest after it through 2013
  let pk = -1, tr = null
  if (D.iBoom[0] >= 0) {
    for (let j = D.iBoom[0]; j <= D.iBoom[1]; j++) if (Number.isFinite(vals[j]) && (pk < 0 || vals[j] > vals[pk])) pk = j
    if (pk >= 0 && Number.isFinite(vals[D.iBoom[0]])) for (let j = pk; j <= D.iBustEnd; j++) if (Number.isFinite(vals[j]) && (tr == null || vals[j] < tr)) tr = vals[j]
  }
  const annual = {}
  for (const [y, [a, b]] of Object.entries(D.years)) {
    let s = 0, n = 0
    for (let j = a; j <= b; j++) if (Number.isFinite(vals[j])) { s += vals[j]; n++ }
    if (n >= 10) annual[y] = s / n
  }
  const y1 = at(12), y5 = at(60), m1 = at(1)
  return { v, d: D.dates[k], yoy: y1 ? v / y1 - 1 : null, g5: y5 ? v / y5 - 1 : null, mom: m1 ? v / m1 - 1 : null,
    fromHi22: hi22 ? v / hi22 - 1 : null, crash: pk >= 0 && tr != null ? tr / vals[pk] - 1 : null, annual }
}
function rentStats(vals, D) {
  let k = vals.length - 1
  while (k >= 0 && !Number.isFinite(vals[k])) k--
  if (k < 0) return null
  const y1 = k >= 12 && Number.isFinite(vals[k - 12]) ? vals[k - 12] : null
  return { v: vals[k], prev: y1, d: D.dates[k], yoy: y1 ? vals[k] / y1 - 1 : null }
}

// Value-to-income now against the area's own 2000–19 average. SAIPE's latest
// income is carried to the latest home-value month at the area's own 5-year
// pace, so today's ratio is not inflated by two years of missing wage growth.
function valuation(z, s, years, gFallback) {
  const inc = s?.i
  if (!z || !inc) return null
  let k = inc.length - 1
  while (k >= 0 && !(inc[k] > 0)) k--
  if (k < 0) return null
  const incLast = inc[k], yLast = years[k], k5 = years.indexOf(yLast - 5)
  const g5 = k5 >= 0 && inc[k5] > 0 ? incLast / inc[k5] - 1 : null
  const g = g5 != null ? Math.min(ASSUME.incomeGrowthCap, Math.max(0, (1 + g5) ** 0.2 - 1)) : gFallback ?? 0
  const yrs = Math.max(0, (Date.parse(`${z.d}-15T00:00:00Z`) - Date.UTC(yLast, 6, 1)) / (365.25 * 864e5))
  const incNow = incLast * (1 + g) ** yrs
  const ratios = []
  for (let j = 0; j <= k; j++) { const a = z.annual[years[j]]; if (a && inc[j] > 0) ratios.push([years[j], a / inc[j]]) }
  const inBase = ratios.filter(([y]) => y >= ASSUME.base[0] && y <= ASSUME.base[1])
  const base = inBase.length >= 12 ? inBase.reduce((t, [, r]) => t + r, 0) / inBase.length : null
  const ratioNow = z.v / incNow
  return { incLast, yLast, g5, g, incNow, ratioNow, base, overvalued: base ? ratioNow / base - 1 : null, ratios }
}

function metricsFor({ z, zr, rd, s, rate, years, gFallback, fc, month }) {
  const m = {}
  const val = z ? valuation(z, s, years, gFallback) : null
  const a = s?.a // [units, occupied, vacant, owner, renter, forRent, rentedNotOcc, forSale, soldNotOcc, otherVacant, medianValue, medianTax]
  const taxRate = a && a[10] > 0 && a[11] > 0 ? a[11] / a[10] : null
  if (z) Object.assign(m, { value: z.v, valueYoy: pct(z.yoy), value5y: pct(z.g5), valueMom: pct(z.mom), fromHi22: pct(z.fromHi22), crash0712: pct(z.crash) })
  if (val) Object.assign(m, { vti: val.ratioNow, vtiBase: val.base, overvalued: pct(val.overvalued) })
  if (s?.i) {
    let k = s.i.length - 1
    while (k >= 0 && !(s.i[k] > 0)) k--
    if (k >= 0) { m.income = s.i[k]; const k5 = years.indexOf(years[k] - 5); if (k5 >= 0 && s.i[k5] > 0) m.incomeG5 = pct(s.i[k] / s.i[k5] - 1) }
  }
  m.taxRate = pct(taxRate)
  if (z && taxRate != null) {
    m.payment = pAndI(z.v * (1 - ASSUME.down), rate) + (taxRate * z.v) / 12
    m.salary = (12 * m.payment) / ASSUME.afford
    if (val) m.payPct = pct((12 * m.payment) / val.incNow)
  }
  if (zr) {
    Object.assign(m, { rent: zr.v, rentYoy: pct(zr.yoy) })
    if (z) {
      m.p2r = z.v / (12 * zr.v)
      m.grossYield = pct((12 * zr.v) / z.v)
      if (taxRate != null) m.capRate = pct((12 * zr.v * (1 - ASSUME.opex) - taxRate * z.v - ASSUME.insurance * z.v) / z.v)
      if (m.payment) m.buyVsRent = pct(m.payment / zr.v - 1)
    }
    if (val) m.rentPct = pct((12 * zr.v) / val.incNow)
  }
  if (rd) {
    const f = rd.f
    Object.assign(m, {
      listPrice: f.median_listing_price, listYoy: pct(f.median_listing_price_yy), ppsf: f.median_listing_price_per_square_foot, ppsfYoy: pct(f.median_listing_price_per_square_foot_yy),
      active: f.active_listing_count, activeYoy: pct(f.active_listing_count_yy), dom: f.median_days_on_market, domYoy: pct(f.median_days_on_market_yy),
      // Realtor.com reports share changes as percentage-point differences
      cut: pct(f.price_reduced_share), cutYoy: pct(f.price_reduced_share_yy),
      newListings: f.new_listing_count, newYoy: pct(f.new_listing_count_yy),
    })
    const b = s?.base?.[month]
    if (b > 0 && fin(m.active)) m.invVs1719 = pct(m.active / b - 1)
    if (a?.[0] > 0 && fin(m.active)) m.invPerUnits = pct(m.active / a[0])
  }
  if (s?.pop?.[2] > 0) {
    m.pop = s.pop[2]
    if (s.pop[1] > 0) m.popG1 = pct(s.pop[2] / s.pop[1] - 1)
    if (s.pop[0] > 0) m.popG5 = pct(s.pop[2] / s.pop[0] - 1)
  }
  if (s?.r) Object.assign(m, { natInc: s.r[2], intlMig: s.r[3], domMig: s.r[4], netMig: s.r[5] })
  if (fin(s?.p)) m.poverty = s.p
  if (a && a[0] > 0) {
    m.ownRate = pct(a[3] / a[1])
    m.vacancy = pct(a[2] / a[0])
    m.rentalVac = pct(a[5] / (a[4] + a[5] + a[6]))
    m.ownerVac = pct(a[7] / (a[3] + a[7] + a[8]))
    m.otherVac = pct(a[9] / a[0])
    if (fin(s.b)) m.permits = (s.b / a[0]) * 1000
  }
  if (fin(fc)) m.forecast = fc
  return m
}

// percentile score within a level — see SCORE
function scoreLevel(rows) {
  const eligible = rows.filter(r => fin(r.m.active) && r.m.active >= SCORE_MIN_LISTINGS)
  const ranks = SCORE.map(({ key }) => {
    const vals = eligible.map(r => r.m[key]).filter(fin).sort((x, y) => x - y)
    const n = vals.length
    const lo = v => { let a = 0, b = n; while (a < b) { const h = (a + b) >> 1; if (vals[h] < v) a = h + 1; else b = h } return a }
    const hi = v => { let a = 0, b = n; while (a < b) { const h = (a + b) >> 1; if (vals[h] <= v) a = h + 1; else b = h } return a }
    return v => (fin(v) && n > 1 ? (((lo(v) + hi(v) - 1) / 2) / (n - 1)) * 100 : null)
  })
  for (const r of eligible) {
    const parts = SCORE.map(({ key }, i) => ranks[i](r.m[key]))
    let s = 0, w = 0, have = 0
    parts.forEach((p, i) => { if (p != null) { s += p * SCORE[i].w; w += SCORE[i].w; have++ } })
    if (parts[0] != null && have >= 3) { r.m.risk = s / w; r.parts = parts.map(p => (p == null ? null : Math.round(p))) }
  }
}

const KEYS = ['value', 'valueYoy', 'value5y', 'valueMom', 'fromHi22', 'crash0712', 'vti', 'vtiBase', 'overvalued', 'payment', 'payPct', 'salary', 'taxRate', 'buyVsRent',
  'listPrice', 'listYoy', 'ppsf', 'ppsfYoy', 'active', 'activeYoy', 'invVs1719', 'invPerUnits', 'cut', 'cutYoy', 'dom', 'domYoy', 'newListings', 'newYoy',
  'pop', 'popG1', 'popG5', 'natInc', 'intlMig', 'domMig', 'netMig', 'income', 'incomeG5', 'poverty', 'ownRate', 'vacancy', 'rentalVac', 'ownerVac', 'otherVac', 'permits',
  'rent', 'rentYoy', 'p2r', 'grossYield', 'capRate', 'rentPct', 'forecast', 'risk']

// first city + first state: "Seattle-Tacoma-Bellevue, WA" and "Seattle, WA" → "seattle|WA"
const cityKey = name => {
  const m = /^(.*?),\s*([A-Z]{2})\b/.exec(name || '')
  if (!m) return null
  const city = m[1].replace(/^urban\s+/i, '').split(/[-/]/)[0].trim().toLowerCase()
  return city ? `${city}|${m[2]}` : null
}
const firstState = title => /,\s*([A-Z]{2})\b/.exec(title || '')?.[1] ?? null

export function createMarketMap({ dir, fetchFredSeries, UA }) {
  const FILE = path.join(dir, 'market-map.json')
  let mem = null, inflight = null
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return null } }
  const save = o => { try { fs.writeFileSync(FILE, JSON.stringify(o)) } catch (e) { console.error('market-map save:', e.message) } }

  async function build() {
    const t0 = Date.now()
    let seed
    try { seed = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'seeds', SEED_NAME), 'utf8')) }
    catch { throw new Error(`data/seeds/${SEED_NAME} is missing — run: node scripts/refresh-seeds.mjs market-map`) }
    const years = seed.saipeYears, S = seed.areas
    const warnings = []
    const keys = Object.keys(SRC)
    const got = await Promise.allSettled(keys.map(k => getText(SRC[k], UA)))
    const T = {}
    keys.forEach((k, i) => { if (got[i].status === 'fulfilled') T[k] = got[i].value; else warnings.push(`${k}: ${got[i].reason?.message}`) })
    if (!T.zCounty || !T.zMetro) throw new Error(`Zillow home values unavailable (${warnings.join('; ')})`)

    const zC = parseZillow(T.zCounty, 'county'), zM = parseZillow(T.zMetro, 'metro'), zS = T.zState ? parseZillow(T.zState, 'state') : null
    const rC = T.rentCounty ? parseZillow(T.rentCounty, 'county') : null, rM = T.rentMetro ? parseZillow(T.rentMetro, 'metro') : null
    const fc = T.forecast ? parseForecast(T.forecast) : null
    const dC = T.rdcCounty ? parseRealtor(T.rdcCounty, 'county_fips', k => k.padStart(5, '0')) : null
    const dM = T.rdcMetro ? parseRealtor(T.rdcMetro, 'cbsa_code', k => 'm' + k) : null
    const dS = T.rdcState ? parseRealtor(T.rdcState, 'state_id', k => FIPS[k.toUpperCase()]) : null
    const dU = T.rdcUS ? parseRealtor(T.rdcUS, null, () => 'US') : null
    const DzC = dateIndex(zC.dates), DzM = dateIndex(zM.dates), DzS = zS ? dateIndex(zS.dates) : null
    const DrC = rC ? dateIndex(rC.dates) : null, DrM = rM ? dateIndex(rM.dates) : null
    const ym = dU?.ym || dS?.ym || dC?.ym || dM?.ym
    const month = ym ? Number(ym.slice(4)) - 1 : null

    const obs = await fetchFredSeries('MORTGAGE30US', 10).catch(() => [])
    const rateObs = obs.filter(o => fin(o.v)).at(-1)
    if (!rateObs) throw new Error('the 30-year mortgage rate (FRED MORTGAGE30US) is unavailable')
    const rate = rateObs.v

    // national first: its income pace is the fallback for areas without five years of SAIPE
    const usZ = zStats((zM.rows.get('US') || zS?.rows.get('US'))?.vals || new Float64Array(), DzM)
    const usInc = S.US?.i || [], kUS = usInc.length - 1, k5US = years.indexOf(years[kUS] - 5)
    const gUS = usInc[kUS] > 0 && usInc[k5US] > 0 ? Math.min(ASSUME.incomeGrowthCap, Math.max(0, (usInc[kUS] / usInc[k5US]) ** 0.2 - 1)) : 0.03
    const usRent = rM?.rows.get('US') ? rentStats(rM.rows.get('US').vals, DrM) : null
    const national = metricsFor({ z: usZ, zr: usRent, rd: dU?.rows.get('US'), s: S.US, rate, years, gFallback: gUS, fc: fc?.rows.get('US'), month })

    const statsCache = new Map()
    const zOf = (P, D, id) => { const key = `${D === DzC ? 'c' : D === DzM ? 'm' : 's'}${id}`; if (!statsCache.has(key)) { const row = P?.rows.get(id); statsCache.set(key, row ? zStats(row.vals, D) : null) } return statsCache.get(key) }

    // ── counties ──
    const countyIds = new Set([...Object.keys(S).filter(id => /^\d{5}$/.test(id)), ...[...zC.rows.keys()].filter(id => /^\d{5}$/.test(id)), ...(dC ? [...dC.rows.keys()] : [])])
    const counties = [...countyIds].filter(id => ABBR[id.slice(0, 2)]).sort().map(id => {
      const z = zOf(zC, DzC, id), rr = rC?.rows.get(id)
      return {
        id, name: S[id]?.n || zC.rows.get(id)?.name || id, st: ABBR[id.slice(0, 2)],
        z, m: metricsFor({ z, zr: rr ? rentStats(rr.vals, DrC) : null, rd: dC?.rows.get(id), s: S[id], rate, years, gFallback: gUS, fc: null, month }),
      }
    })

    // ── metros: Zillow by name, Realtor.com by code ──
    const index = new Map()
    const prefer = (key, code) => {
      const cur = index.get(key)
      if (!cur) return index.set(key, code)
      const [, kNew] = seed.cbsa[code] || [], [, kCur] = seed.cbsa[cur] || []
      const size = c => S['m' + c]?.a?.[1] || 0
      if ((kNew === 'metro' && kCur !== 'metro') || (kNew === kCur && size(code) > size(cur))) index.set(key, code)
    }
    for (const [code, [title]] of Object.entries(seed.cbsa)) { const k = cityKey(title); if (k) prefer(k, code) }
    if (dM) for (const [id, r] of dM.rows) { const k = cityKey(r.title); if (k && seed.cbsa[id.slice(1)] && !index.has(k)) index.set(k, id.slice(1)) }
    // Names the 2023 delineation retired (Madera, CA joined Fresno; The Villages
    // became Wildwood-The Villages) fall back to the counties Zillow files under
    // that metro name, and from them to their 2023 CBSA.
    const cbsaOfCounty = new Map(Object.entries(seed.cbsa).flatMap(([code, [, , cs]]) => cs.map(c => [c, code])))
    const countiesOfName = new Map()
    for (const [id, row] of zC.rows) { const k = cityKey(row.metro); if (k) (countiesOfName.get(k) || countiesOfName.set(k, []).get(k)).push(id) }
    const viaCounties = name => {
      const tally = new Map()
      for (const c of countiesOfName.get(cityKey(name)) || []) { const code = cbsaOfCounty.get(c); if (code) tally.set(code, (tally.get(code) || 0) + 1) }
      return [...tally].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null
    }
    const byCode = (P) => {
      const out = new Map(), miss = []
      if (!P) return { out, miss }
      const later = []
      for (const [name, row] of P.rows) { if (name === 'US') continue; const code = index.get(cityKey(name)); if (code && !out.has(code)) out.set(code, row); else if (!code) later.push([name, row]) }
      for (const [name, row] of later) { const code = viaCounties(name); if (code && !out.has(code)) out.set(code, row); else miss.push(name) }
      return { out, miss }
    }
    const zMetro = byCode(zM), rMetro = byCode(rM)
    const fcMetro = new Map()
    if (fc) for (const [name, v] of fc.rows) { if (name === 'US') continue; const code = index.get(cityKey(name)) ?? viaCounties(name); if (code && !fcMetro.has(code)) fcMetro.set(code, v) }
    if (zMetro.miss.length) warnings.push(`${zMetro.miss.length} Zillow metros have no 2023 CBSA of their own (merged or dropped in the 2023 delineation): ${zMetro.miss.slice(0, 6).join('; ')}`)
    const ctOld = Object.entries(CT_REGION)
    const metros = Object.entries(seed.cbsa).filter(([, [, , cs]]) => cs.some(c => ABBR[c.slice(0, 2)])).map(([code, [title, kind, cs]]) => {
      const id = 'm' + code, zr = zMetro.out.get(code), rr = rMetro.out.get(code)
      const z = zr ? zStats(zr.vals, DzM) : null
      const members = [...cs, ...ctOld.filter(([, region]) => cs.includes(region)).map(([old]) => old)]
      return {
        id, name: title, st: firstState(title), kind, members, z,
        m: metricsFor({ z, zr: rr ? rentStats(rr.vals, DrM) : null, rd: dM?.rows.get(id), s: S[id], rate, years, gFallback: gUS, fc: fcMetro.get(code), month }),
      }
    })

    // ── states: Zillow's state file; rent is the renter-weighted county ZORI, where
    //    the counties with a rent index hold at least half the state's renters ──
    const states = STATES.map(([ab, f, name]) => {
      const z = zS ? zOf(zS, DzS, f) : null
      let zr = null
      if (rC) {
        let s = 0, sp = 0, w = 0, wAll = 0
        for (const c of counties) {
          if (c.st !== ab) continue
          const renters = S[c.id]?.a?.[4] || 0
          wAll += renters
          const r = rC.rows.get(c.id), st = r ? rentStats(r.vals, DrC) : null
          if (st && fin(st.prev) && renters > 0) { s += st.v * renters; sp += st.prev * renters; w += renters }
        }
        if (w > 0 && w >= 0.5 * wAll) zr = { v: s / w, yoy: s / sp - 1 }
      }
      return { id: f, name, st: ab, z, m: metricsFor({ z, zr, rd: dS?.rows.get(f), s: S[f], rate, years, gFallback: gUS, fc: null, month }) }
    })

    for (const rows of [states, metros, counties]) scoreLevel(rows)

    const asOf = {
      zhvi: zC.dates.at(-1), zori: rC?.dates.at(-1) ?? null, realtor: ym ? `${ym.slice(0, 4)}-${ym.slice(4)}` : null,
      forecast: fc?.horizon ?? null, rate: { v: rate, d: rateObs.d }, census: seed.vintages, seedBuilt: seed.fetchedAt,
    }
    const pack = (level, rows) => {
      const cols = Object.fromEntries(KEYS.map(k => [k, rows.map(r => round(k, r.m[k]))]))
      const out = {
        level, built: new Date().toISOString(), asOf, assume: ASSUME, score: { parts: SCORE, minListings: SCORE_MIN_LISTINGS },
        ids: rows.map(r => r.id), names: rows.map(r => r.name), st: rows.map(r => r.st),
        cols, parts: rows.map(r => r.parts || null),
        national: Object.fromEntries(KEYS.filter(k => k !== 'risk').map(k => [k, round(k, national[k])])),
        warnings,
      }
      if (level === 'metro') { out.kind = rows.map(r => r.kind); out.members = rows.map(r => r.members) }
      return out
    }

    // ── scorecard history, one file per state ──
    const history = {}
    const hist = (z, vals, s) => {
      if (!vals) return null
      const v = valuation(z, s, years, gUS)
      return {
        z: Array.from(vals, x => (Number.isFinite(x) ? Math.round(x / 100) / 10 : null)), // $ thousands
        ratio: v ? v.ratios.map(([y, r]) => [y, Math.round(r * 100) / 100]) : [],
        base: v?.base != null ? Math.round(v.base * 100) / 100 : null,
        now: v ? Math.round(v.ratioNow * 100) / 100 : null,
      }
    }
    for (const [ab, f] of STATES) {
      const areas = {}
      const sz = zS?.rows.get(f)
      if (sz) areas[f] = hist(zOf(zS, DzS, f), sz.vals, S[f])
      for (const c of counties) if (c.st === ab) { const r = zC.rows.get(c.id); if (r) areas[c.id] = hist(c.z, r.vals, S[c.id]) }
      for (const mt of metros) if (mt.st === ab) { const r = zMetro.out.get(mt.id.slice(1)); if (r) areas[mt.id] = hist(mt.z, r.vals, S[mt.id]) }
      history[ab] = { st: ab, start: { county: zC.dates[0], metro: zM.dates[0], state: zS?.dates[0] ?? null }, areas }
    }

    return {
      built: new Date().toISOString(), tookMs: Date.now() - t0,
      levels: { state: pack('state', states), metro: pack('metro', metros), county: pack('county', counties) },
      history,
    }
  }

  async function get() {
    if (mem && Date.now() - Date.parse(mem.built) < TTL) return mem
    if (!mem) { const disk = load(); if (disk?.built && Date.now() - Date.parse(disk.built) < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try { const data = await build(); mem = data; save(data); return data }
      catch (e) { const disk = mem || load(); if (disk) { console.error('market-map refresh failed, serving the last build:', e.message); return disk } throw e }
      finally { inflight = null }
    })()
    return inflight
  }

  function register(server) {
    server.middlewares.use('/api/market-map', async (req, res, next) => {
      // req.url arrives with the mount path stripped: "/county", "/history/WA".
      // The Netlify fork's bake asks with a query instead ("/?level=county",
      // "/history?st=WA") and writes the answer under the path form the page uses.
      const url = new URL(req.url || '/', 'http://localhost'), p = url.pathname.replace(/\.json$/, '')
      const level = /^\/(state|metro|county)$/.exec(p)?.[1] ?? (p === '/' ? url.searchParams.get('level') : null)
      const st = /^\/history\/([A-Z]{2})$/.exec(p)?.[1] ?? (p === '/history' ? url.searchParams.get('st') : null)
      let pick
      if (/^(state|metro|county)$/.test(level || '')) pick = d => d.levels[level]
      else if (/^[A-Z]{2}$/.test(st || '')) pick = d => d.history[st]
      else return next()
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      try {
        const body = pick(await get())
        if (!body) { res.statusCode = 404; res.end(JSON.stringify({ error: 'no such area' })); return }
        res.end(JSON.stringify(body))
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
    })
  }
  return { get, register }
}
