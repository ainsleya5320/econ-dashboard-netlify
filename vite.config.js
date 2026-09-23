import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRealEstateFeeds, unzipEntries } from './server/realEstateFeeds.js'
import { createMetroComparison } from './server/metroComparison.js'
import { createMetroEmployment } from './server/metroEmployment.js'
import { createOptionsContext } from './server/optionsContext.js'
import { createPeopleScreener } from './server/peopleScreener.js'
import { createUsPulse } from './server/usPulse.js'
import { createIntlPulse } from './server/intlPulse.js'
import { createMachine } from './server/machine.js'
import { createDamodaranErp } from './server/damodaranErp.js'
import { createCommodityPulse } from './server/commodityPulse.js'
import { createAiPulse } from './server/aiPulse.js'
import { createSfcModel } from './server/sfcModel.js'
import { createBankruptcy } from './server/bankruptcy.js'
import { createSpecialSituations } from './server/specialSituations.js'
import { createFxFundamentals } from './server/fxFundamentals.js'
import { createGpuEconomics } from './server/gpuEconomics.js'
import { createTokenEstimates } from './server/tokenEstimates.js'
import { createOwnerWealth } from './server/ownerWealth.js'
import { createHouseholdWealth } from './server/householdWealth.js'
import { createTokenSpot } from './server/tokenSpot.js'
import { createTightening } from './server/tightening.js'
import { createTradeFlows } from './server/tradeFlows.js'
import { createCapexReturns } from './server/capexReturns.js'
import { createMunicipalities } from './server/municipalities.js'
import { STATE_FIPS } from './src/lib/constants.js'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TICKERS_FILE = path.join(__dirname, 'tickers.json')
const env = loadEnv('', __dirname, '')

const FMP_KEY = env.FMP_KEY || env.VITE_FMP_KEY || process.env.FMP_KEY || ''
const EIA_KEY = env.EIA_API_KEY || process.env.EIA_API_KEY || '' // free key from eia.gov/opendata; weekly petroleum + gas inventories
const AA_KEY = env.ARTIFICIAL_ANALYSIS_KEY || process.env.ARTIFICIAL_ANALYSIS_KEY || '' // free key from the Artificial Analysis Insights Platform; server-side only, 1,000 req/day
const FRED_KEY = env.FRED_KEY || env.VITE_FRED_KEY || process.env.FRED_KEY || ''
const BLS_KEY = env.BLS_KEY || ''
const BEA_KEY = env.BEA_KEY || ''
// In-app assistant: Claude Opus 5 via the official SDK. Key stays server-side
// (ANTHROPIC_API_KEY in .env — loadEnv, not process.env, like the other keys).
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || ''
const CHAT_MODEL = 'claude-opus-5'

/* ── BEA PCE Price Index (monthly index levels, compute YoY) ── */
let beaPceCache = { data: null, ts: 0 }
const BEA_PCE_TTL = 4 * 60 * 60 * 1000

async function fetchBeaPCE() {
  if (beaPceCache.data && Date.now() - beaPceCache.ts < BEA_PCE_TTL) return beaPceCache.data

  // Fetch monthly price index levels (Table 2.8.4) for last 3 years
  const years = []
  const now = new Date()
  for (let y = now.getFullYear() - 2; y <= now.getFullYear(); y++) years.push(y)
  const yearStr = years.join(',')

  const url = `https://apps.bea.gov/api/data/?&UserID=${BEA_KEY}&method=GetData&DataSetName=NIPA&TableName=T20804&Frequency=M&Year=${yearStr}&ResultFormat=JSON`
  console.log('BEA PCE: fetching monthly price index data...')
  const resp = await fetch(url, { headers: { 'User-Agent': UA } })
  const json = await resp.json()
  const rows = json?.BEAAPI?.Results?.Data
  if (!rows || !Array.isArray(rows)) {
    console.warn('BEA PCE: unexpected response', JSON.stringify(json).slice(0, 200))
    return null
  }

  // Line 1 = headline PCE, Line 13 = PCE ex food & energy (core)
  // Parse TimePeriod format: "2024M01" → "2024-01"
  const parseTP = (tp) => {
    const m = tp.match(/^(\d{4})M(\d{2})$/)
    return m ? `${m[1]}-${m[2]}` : null
  }

  // Extract index levels for headline and core
  const headline = []  // {d, v}
  const core = []

  for (const row of rows) {
    const d = parseTP(row.TimePeriod)
    const v = parseFloat(String(row.DataValue).replace(/,/g, ''))
    if (!d || isNaN(v)) continue

    if (row.LineNumber === '1') headline.push({ d, v })
    else if (row.LineNumber === '13') core.push({ d, v })
  }

  // Sort by date
  headline.sort((a, b) => a.d.localeCompare(b.d))
  core.sort((a, b) => a.d.localeCompare(b.d))

  // Compute YoY % change (need 12-month lag)
  const computeYoY = (arr) => {
    const history = []
    for (let i = 12; i < arr.length; i++) {
      const yoy = ((arr[i].v - arr[i - 12].v) / arr[i - 12].v) * 100
      history.push({ d: arr[i].d, v: parseFloat(yoy.toFixed(2)) })
    }
    const latest = history.length ? history[history.length - 1] : null
    return { yoy: latest?.v ?? null, lastDate: latest?.d ?? null, history }
  }

  const result = {
    PCEPI: computeYoY(headline),
    PCEPILFE: computeYoY(core),
    source: 'BEA',
  }

  console.log(`BEA PCE: headline=${result.PCEPI.yoy}% (${result.PCEPI.lastDate}), core=${result.PCEPILFE.yoy}% (${result.PCEPILFE.lastDate})`)
  beaPceCache = { data: result, ts: Date.now() }
  return result
}

/* ── Fear & Greed Composite (5 sub-components, 15-min cache) ── */
let fearGreedCache = { data: null, ts: 0 }
const FEAR_GREED_TTL = 15 * 60 * 1000

// Map a value in [min, max] to a 0–100 score, optionally inverted
const scoreLinear = (v, min, max, invert = false) => {
  if (v == null || isNaN(v)) return null
  const clamped = Math.max(min, Math.min(max, v))
  const pct = ((clamped - min) / (max - min)) * 100
  return invert ? 100 - pct : pct
}

async function fetchFearGreed() {
  if (fearGreedCache.data && Date.now() - fearGreedCache.ts < FEAR_GREED_TTL) return fearGreedCache.data

  const results = {}

  // 1. VIX — fear gauge (low VIX = greed, high VIX = fear)
  //    Extreme Greed: VIX < 12, Neutral: ~18, Extreme Fear: VIX > 35
  try {
    const resp = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=%5EVIX&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const vix = data?.[0]?.price
    if (vix != null) {
      results.vix = {
        raw: vix,
        score: scoreLinear(vix, 12, 35, true), // invert: high VIX = low score (fear)
        label: 'Volatility (VIX)',
        detail: `VIX at ${vix.toFixed(2)}`,
      }
    }
  } catch (e) { console.warn('Fear&Greed VIX error:', e.message) }

  // 2. Market Momentum — S&P 500 vs 125-day SMA
  //    Far above = greed, far below = fear
  try {
    const resp = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=SPY&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const hist = (data?.historical || data || []).slice(0, 130)
    if (hist.length >= 125) {
      const current = hist[0].close
      const sma125 = hist.slice(0, 125).reduce((s, d) => s + d.close, 0) / 125
      const pctDiff = ((current - sma125) / sma125) * 100
      results.momentum = {
        raw: pctDiff,
        score: scoreLinear(pctDiff, -10, 10), // -10% below SMA = extreme fear, +10% = extreme greed
        label: 'Momentum (SPY vs 125d MA)',
        detail: `${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(2)}% vs 125-day avg`,
      }
    }
  } catch (e) { console.warn('Fear&Greed Momentum error:', e.message) }

  // 3. Safe Haven Demand — SPY 20-day return vs TLT 20-day return
  //    Stocks winning = greed, bonds winning = fear
  try {
    const [spyResp, tltResp] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=SPY&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } }),
      fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=TLT&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } }),
    ])
    const spyData = (await spyResp.json())
    const tltData = (await tltResp.json())
    const spyHist = (spyData?.historical || spyData || []).slice(0, 22)
    const tltHist = (tltData?.historical || tltData || []).slice(0, 22)
    if (spyHist.length >= 20 && tltHist.length >= 20) {
      const spyRet = ((spyHist[0].close - spyHist[19].close) / spyHist[19].close) * 100
      const tltRet = ((tltHist[0].close - tltHist[19].close) / tltHist[19].close) * 100
      const diff = spyRet - tltRet
      results.safeHaven = {
        raw: diff,
        score: scoreLinear(diff, -8, 8), // SPY 8% below TLT = extreme fear
        label: 'Safe Haven Demand',
        detail: `SPY ${spyRet > 0 ? '+' : ''}${spyRet.toFixed(1)}% vs TLT ${tltRet > 0 ? '+' : ''}${tltRet.toFixed(1)}% (20d)`,
      }
    }
  } catch (e) { console.warn('Fear&Greed SafeHaven error:', e.message) }

  // 4. Junk Bond Demand — ICE BofA US High Yield OAS (FRED: BAMLH0A0HYM2)
  //    Low spreads = greed, high spreads = fear
  try {
    const resp = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=BAMLH0A0HYM2&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=1`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const obs = data?.observations?.[0]
    const spread = obs?.value ? parseFloat(obs.value) : null
    if (spread != null && !isNaN(spread)) {
      results.junkBond = {
        raw: spread,
        score: scoreLinear(spread, 3, 9, true), // 3% spread = greed, 9%+ = fear
        label: 'Junk Bond Demand',
        detail: `HY OAS at ${spread.toFixed(2)}%`,
      }
    }
  } catch (e) { console.warn('Fear&Greed JunkBond error:', e.message) }

  // 5. Market Breadth — % of S&P 500 stocks above their 50-day MA
  //    Use our own sp500-data.json (proxy: use % with positive changePct as a quick proxy if DMA not available)
  //    Better: fetch a few days of SPY and NYSE highs-lows, but keep simple
  try {
    const resp = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=SPY&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } })
    const data = await resp.json()
    const hist = (data?.historical || data || []).slice(0, 60)
    if (hist.length >= 50) {
      const current = hist[0].close
      const sma50 = hist.slice(0, 50).reduce((s, d) => s + d.close, 0) / 50
      const pctDiff = ((current - sma50) / sma50) * 100
      // As a breadth proxy: how far SPY is above/below its own 50-day MA
      results.breadth = {
        raw: pctDiff,
        score: scoreLinear(pctDiff, -7, 7),
        label: 'Breadth (SPY vs 50d MA)',
        detail: `${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(2)}% vs 50-day avg`,
      }
    }
  } catch (e) { console.warn('Fear&Greed Breadth error:', e.message) }

  // Composite: equal-weighted average of all available scores
  const validScores = Object.values(results).map(r => r.score).filter(s => s != null)
  const composite = validScores.length
    ? validScores.reduce((a, b) => a + b, 0) / validScores.length
    : null

  let classification = '—'
  if (composite != null) {
    if (composite < 25) classification = 'Extreme Fear'
    else if (composite < 45) classification = 'Fear'
    else if (composite < 55) classification = 'Neutral'
    else if (composite < 75) classification = 'Greed'
    else classification = 'Extreme Greed'
  }

  const result = {
    composite: composite != null ? Math.round(composite) : null,
    classification,
    components: results,
    updated: Date.now(),
  }
  console.log(`Fear&Greed: composite=${result.composite} (${result.classification}) from ${validScores.length}/5 components`)
  fearGreedCache = { data: result, ts: Date.now() }
  return result
}

/* ── AI Economic Impact (stocks, productivity, employment, software capex) ── */
let aiImpactCache = { data: null, ts: 0 }
const AI_IMPACT_TTL = 4 * 60 * 60 * 1000

// FRED series relevant to AI's impact on the REAL ECONOMY
// Grouped into: Productivity, Capital Formation, Physical Buildout, Employment, Power Demand
const AI_FRED_SERIES = {
  // --- Productivity (the ultimate test) ---
  OPHNFB:         { label: 'Nonfarm Labor Productivity',    group: 'productivity', freq: 'Q', limit: 80,  color: '#10B981', unit: 'index' },
  MPU4910063:     { label: 'Info Sector Labor Productivity',group: 'productivity', freq: 'Q', limit: 80,  color: '#14B8A6', unit: 'index' },

  // --- Capital formation: where is the money actually flowing? ---
  Y694RX1Q020SBEA:{ label: 'Real Software Investment',      group: 'capex',        freq: 'Q', limit: 80,  color: '#6366F1', unit: 'billions' },
  A679RC1Q027SBEA:{ label: 'Real IP Products Investment',   group: 'capex',        freq: 'Q', limit: 80,  color: '#8B5CF6', unit: 'billions' },
  Y033RC1Q027SBEA:{ label: 'Real Info-Processing Equipment',group: 'capex',        freq: 'Q', limit: 80,  color: '#A855F7', unit: 'billions' },

  // --- Physical buildout (chips + data centers) ---
  IPG3344S:       { label: 'Semiconductor Production',      group: 'buildout',     freq: 'M', limit: 240, color: '#F59E0B', unit: 'index' },
  TLMFGCONS:      { label: 'Manufacturing Construction ($M)',group: 'buildout',    freq: 'M', limit: 240, color: '#EF4444', unit: 'dollars_m' },

  // --- Employment in AI-adjacent sectors ---
  CES6054150001:  { label: 'Computer Systems Design Jobs',  group: 'employment',   freq: 'M', limit: 240, color: '#3B82F6', unit: 'thousands' },
  USINFO:         { label: 'Information Sector Jobs',       group: 'employment',   freq: 'M', limit: 240, color: '#60A5FA', unit: 'thousands' },

  // --- Power: AI's physical footprint ---
  IPG2211A2N:     { label: 'Electric Power Generation',     group: 'power',        freq: 'M', limit: 240, color: '#EAB308', unit: 'index' },
}

// Global FRED throttle: serialize every FRED request with spacing so cold
// starts can NEVER burst. FRED's Akamai edge IP-blocked us (403 Access
// Denied, even keyless) after a day of dev restarts each firing 40-60
// parallel calls — a hard block is far worse than a slow warm-up. ~1.8 req/s
// stays well under their 120/min limit even with the browser's own calls.
let fredChain = Promise.resolve()
function fredThrottle() {
  const p = fredChain.then(() => new Promise(r => setTimeout(r, 550)))
  fredChain = p.catch(() => {})
  return p
}
// ── One FRED cache, shared by every caller ───────────────────────────────────
// Before this existed the server feeds had no cache at all — each rebuild paid
// 550 ms of throttle per series, and the /api/fred relay kept its own 30-minute
// copy in memory that a dev-server restart threw away. One series is now fetched
// once and serves the feeds, the relay and every browser tab.
//   keyed by series id, storing the longest observation array seen, so a caller
//     asking for 24 points is served from the 5,200-point entry
//   TTL inferred from the series' own cadence — a monthly series cannot change
//     every thirty minutes, and reading the gap between its last two
//     observations costs nothing (no metadata request)
//   stale-while-revalidate — an expired entry is returned immediately and
//     refreshed behind the caller, so nothing waits on FRED for data it has
//   in-flight dedupe — two feeds asking at once make one request
const FRED_CACHE_FILE = path.join(__dirname, 'fred-cache.json')
const FRED_DAY = 86400000, FRED_HARD_STALE = 14 * FRED_DAY, FRED_MAX_OBS = 6000
let fredCache = {}
try { if (fs.existsSync(FRED_CACHE_FILE)) fredCache = JSON.parse(fs.readFileSync(FRED_CACHE_FILE, 'utf8')) || {} } catch { fredCache = {} }
let fredDirty = false, fredSaveTimer = null
function fredCacheSave() {
  fredDirty = true
  if (fredSaveTimer) return
  fredSaveTimer = setTimeout(() => {
    fredSaveTimer = null
    if (!fredDirty) return
    fredDirty = false
    try { fs.writeFileSync(FRED_CACHE_FILE, JSON.stringify(fredCache)) } catch (e) { console.error('FRED cache save:', e.message) }
  }, 4000)
}
// a series cannot change faster than it is published
function fredTtl(obs) {
  if (!obs || obs.length < 2) return 6 * 3600e3
  const gap = (Date.parse(obs[obs.length - 1].d) - Date.parse(obs[obs.length - 2].d)) / FRED_DAY
  if (!Number.isFinite(gap) || gap <= 1.6) return 6 * 3600e3   // daily
  if (gap <= 8) return 18 * 3600e3                              // weekly
  if (gap <= 36) return 24 * 3600e3                             // monthly
  return 72 * 3600e3                                            // quarterly or annual
}
const fredInflight = new Map()
function fredFetch(id, limit) {
  const key = `${id}:${limit}`
  const running = fredInflight.get(key)
  if (running) return running
  const p = fredFetchRaw(id, limit)
    .then(obs => {
      if (obs.length) {
        const keep = obs.length > FRED_MAX_OBS ? obs.slice(-FRED_MAX_OBS) : obs
        fredCache[id] = { ts: Date.now(), limit: Math.min(limit, FRED_MAX_OBS), ttl: fredTtl(keep), obs: keep }
        fredCacheSave()
      }
      return obs
    })
    .finally(() => fredInflight.delete(key))
  fredInflight.set(key, p)
  return p
}
async function fetchFredSeries(id, limit) {
  const hit = fredCache[id]
  const wide = hit && hit.limit >= limit
  const age = hit ? Date.now() - hit.ts : Infinity
  if (wide && age < hit.ttl) return hit.obs.slice(-limit)
  // present and long enough but stale: hand back what we have and refresh behind
  // the caller. A page never blocks on FRED for a series it already had.
  if (wide && age < FRED_HARD_STALE) { fredFetch(id, Math.max(limit, hit.limit)).catch(() => {}); return hit.obs.slice(-limit) }
  const obs = await fredFetch(id, Math.max(limit, hit?.limit || 0))
  return obs.length > limit ? obs.slice(-limit) : obs
}
function fredCacheStats() {
  const now = Date.now(), e = Object.values(fredCache)
  return { series: e.length, fresh: e.filter(x => now - x.ts < x.ttl).length, observations: e.reduce((s, x) => s + x.obs.length, 0),
    oldestHours: e.length ? Math.round(Math.max(...e.map(x => now - x.ts)) / 3600e3) : null, inflight: fredInflight.size,
    bytes: (() => { try { return fs.existsSync(FRED_CACHE_FILE) ? fs.statSync(FRED_CACHE_FILE).size : 0 } catch { return 0 } })() }
}

async function fredFetchRaw(id, limit) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&limit=${limit}&sort_order=desc&file_type=json`
  await fredThrottle()
  // Retry on 429 — a short backoff beats returning empty and (worse) getting
  // cached as empty. The throttle above keeps even retries from bursting.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA } })
      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      if (!resp.ok) {
        console.warn(`FRED ${id}: HTTP ${resp.status}`)
        return []
      }
      const contentType = resp.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        console.warn(`FRED ${id}: expected JSON, received ${contentType || 'unknown content type'}`)
        return []
      }
      const json = await resp.json()
      return (json.observations || [])
        .filter(o => o.value !== '.')
        .map(o => ({ d: o.date, v: parseFloat(o.value) }))
        .reverse()
    } catch (e) {
      console.warn(`FRED ${id}: ${e.message}`)
      return []
    }
  }
  console.warn(`FRED ${id}: still rate-limited after retries`)
  return []
}

async function fetchAIImpact() {
  if (aiImpactCache.data && Date.now() - aiImpactCache.ts < AI_IMPACT_TTL) return aiImpactCache.data

  console.log('AI Impact: fetching fresh real-economy data...')

  // Fetch all FRED series in parallel
  const fredData = {}
  await Promise.all(Object.entries(AI_FRED_SERIES).map(async ([id, meta]) => {
    try {
      const obs = await fetchFredSeries(id, meta.limit)
      if (!obs.length) return
      const latest = obs[obs.length - 1]
      const yoyLag = meta.freq === 'Q' ? 4 : 12
      const prior = obs.length > yoyLag ? obs[obs.length - 1 - yoyLag] : null
      const yoy = prior ? ((latest.v - prior.v) / prior.v) * 100 : null
      // 5-yr change (AI boom era roughly 2022→)
      const fiveYrLag = meta.freq === 'Q' ? 20 : 60
      const fiveYrPrior = obs.length > fiveYrLag ? obs[obs.length - 1 - fiveYrLag] : null
      const fiveYr = fiveYrPrior ? ((latest.v - fiveYrPrior.v) / fiveYrPrior.v) * 100 : null
      fredData[id] = {
        id,
        label: meta.label,
        group: meta.group,
        color: meta.color,
        freq: meta.freq,
        unit: meta.unit,
        current: latest.v,
        lastDate: latest.d,
        yoy,
        fiveYr,
        history: obs,
      }
    } catch (e) { console.warn(`AI Impact FRED ${id}:`, e.message) }
  }))

  const result = {
    fred: fredData,
    updated: Date.now(),
  }

  console.log(`AI Impact: ${Object.keys(fredData).length}/${Object.keys(AI_FRED_SERIES).length} FRED series loaded`)
  aiImpactCache = { data: result, ts: Date.now() }
  return result
}

/* ── Central Bank Rates (FMP calendar + FRED supplements, 4-hour cache) ── */
let cbRatesCache = { data: null, ts: 0 }
const CB_RATES_TTL = 4 * 60 * 60 * 1000

// Maps FMP country codes → event name patterns for rate decisions
const CB_EVENTS = [
  { id: 'US', pattern: /fed interest rate|fomc/i },
  { id: 'EU', pattern: /ecb (interest rate|deposit|refinanc)/i, anyCountry: true },
  { id: 'GB', pattern: /(boe|mpc) interest rate/i },
  { id: 'JP', pattern: /boj interest rate/i },
  { id: 'CA', pattern: /boc interest rate/i },
  { id: 'CH', pattern: /snb interest rate/i },
  { id: 'AU', pattern: /rba interest rate|interest rate decision/i },
  { id: 'KR', pattern: /(bok|bank of korea) interest rate|interest rate decision/i },
  { id: 'MX', pattern: /banxico|mexico.*interest rate|interest rate decision/i },
  { id: 'BR', pattern: /copom|bcb.*interest rate|interest rate decision/i },
  { id: 'NZ', pattern: /rbnz interest rate/i },
  { id: 'SE', pattern: /riksbank|interest rate decision/i },
  { id: 'NO', pattern: /norges|interest rate decision/i },
  { id: 'IN', pattern: /rbi interest rate|interest rate decision/i },
  { id: 'CN', pattern: /loan prime rate 1y/i },
]

// FRED series that are reliably/frequently updated (override FMP for these)
const CB_FRED_SUPPLEMENTS = [
  { id: 'US', series: 'DFF' },            // Federal Funds Rate (daily)
  { id: 'EU', series: 'ECBDFR' },         // ECB Deposit Facility Rate (daily)
  { id: 'GB', series: 'IUDSOIA' },        // UK SONIA → BoE base rate (daily)
  { id: 'NO', series: 'IRSTCI01NOM156N', fill: true },  // Norway (OECD immediate rate, monthly) -- only if the calendar has no decision
]

async function fetchCbRates() {
  if (cbRatesCache.data && Date.now() - cbRatesCache.ts < CB_RATES_TTL) return cbRatesCache.data
  const result = {}

  // Step 1: FMP economic calendar → parse most recent rate decisions
  try {
    const calResp = await fetch(`https://financialmodelingprep.com/stable/economic-calendar?apikey=${FMP_KEY}`, {
      headers: { 'User-Agent': UA }
    })
    if (calResp.ok) {
      const calendar = await calResp.json()
      if (Array.isArray(calendar)) {
        for (const cb of CB_EVENTS) {
          const events = calendar
            .filter(e => e.actual != null && (cb.anyCountry || e.country === cb.id) && cb.pattern.test(e.event))
            .sort((a, b) => b.date.localeCompare(a.date))
          if (events.length > 0) {
            result[cb.id] = { rate: events[0].actual, date: events[0].date.slice(0, 10), source: 'FMP' }
          }
        }
      }
    }
  } catch (e) { console.warn('CB rates FMP error:', e.message) }

  // Step 2: FRED direct fetches override FMP for countries with live series
  for (const f of CB_FRED_SUPPLEMENTS) {
    if (f.fill && result[f.id]) continue // a real decision from the calendar beats a monthly proxy
    try {
      const r = await fetch(
        `https://api.stlouisfed.org/fred/series/observations?series_id=${f.series}&api_key=${FRED_KEY}&limit=1&sort_order=desc&file_type=json`,
        { headers: { 'User-Agent': UA } }
      )
      const json = await r.json()
      const obs = json?.observations?.[0]
      if (obs && obs.value !== '.') {
        result[f.id] = { rate: parseFloat(obs.value), date: obs.date, source: 'FRED' }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 300)) // stagger to avoid FRED rate limits
  }

  if (Object.keys(result).length > 0) cbRatesCache = { data: result, ts: Date.now() }
  return result
}

/* ── Index PE via Yahoo Finance (15-min cache) ──────────────── */
let peCache = { data: null, ts: 0 }
let yfAuth = { crumb: null, cookie: null, ts: 0 }
const PE_TTL = 15 * 60 * 1000
const AUTH_TTL = 30 * 60 * 1000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const INDEX_ETFS = [
  { symbol: "SPY", name: "S&P 500",     flag: "🇺🇸" },
  { symbol: "DIA", name: "Dow Jones",    flag: "🏛" },
  { symbol: "QQQ", name: "Nasdaq 100",   flag: "💻" },
  { symbol: "IWM", name: "Russell 2000", flag: "📊" },
]

async function getYFAuth() {
  if (yfAuth.crumb && Date.now() - yfAuth.ts < AUTH_TTL) return yfAuth
  // Step 1: hit fc.yahoo.com to get cookies
  const initResp = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA }, redirect: 'manual'
  })
  const cookies = initResp.headers.getSetCookie?.() || []
  const cookieStr = cookies.map(c => c.split(';')[0]).join('; ')
  // Step 2: get crumb
  const crumbResp = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr }
  })
  const crumb = await crumbResp.text()
  yfAuth = { crumb, cookie: cookieStr, ts: Date.now() }
  return yfAuth
}

async function fetchIndexPE() {
  if (peCache.data && Date.now() - peCache.ts < PE_TTL) return peCache.data
  const auth = await getYFAuth()
  const results = await Promise.all(INDEX_ETFS.map(async (etf) => {
    try {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${etf.symbol}?modules=summaryDetail,price&crumb=${encodeURIComponent(auth.crumb)}`
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA, 'Cookie': auth.cookie }
      })
      const json = await resp.json()
      const result = json?.quoteSummary?.result?.[0]
      const detail = result?.summaryDetail
      const priceData = result?.price
      const pe = detail?.trailingPE?.raw ?? null
      const earningsYield = pe && pe > 0 ? (1 / pe) * 100 : null
      const changePct = priceData?.regularMarketChangePercent?.raw ?? null
      const price = priceData?.regularMarketPrice?.raw ?? null
      return { ...etf, pe, earningsYield, changePct, price }
    } catch {
      return { ...etf, pe: null, earningsYield: null }
    }
  }))
  peCache = { data: results, ts: Date.now() }
  return results
}

/* ── Equity Risk Premium (S&P earnings yield − 10Y) with 25yr history ──────
   The fundamental "am I paid to own stocks vs bonds" spread. Earnings-yield
   history from multpl.com (monthly, since 1871); 10Y from FRED DGS10. */
let erpCache = { data: null, ts: 0 }
const ERP_TTL = 6 * 60 * 60 * 1000
let eyHistCache = { data: null, ts: 0 }
const EY_HIST_TTL = 24 * 60 * 60 * 1000

const MON = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }

// Parse multpl.com monthly S&P 500 earnings-yield table → { 'YYYY-MM': value }
async function fetchEarningsYieldHistory() {
  if (eyHistCache.data && Date.now() - eyHistCache.ts < EY_HIST_TTL) return eyHistCache.data
  try {
    const resp = await fetch('https://www.multpl.com/s-p-500-earnings-yield/table/by-month', { headers: { 'User-Agent': UA } })
    if (!resp.ok) throw new Error(`multpl HTTP ${resp.status}`)
    const html = await resp.text()
    const i = html.indexOf('id="datatable"')
    const seg = i >= 0 ? html.slice(i) : html
    const re = /<td>\s*([A-Z][a-z]{2}) \d{1,2}, (\d{4})\s*<\/td>\s*<td>(?:[\s\S]*?)([0-9]+\.[0-9]+)%/g
    const out = {}
    let m
    while ((m = re.exec(seg)) !== null) {
      const [, mon, yr, val] = m
      if (MON[mon]) out[`${yr}-${MON[mon]}`] = parseFloat(val)
    }
    eyHistCache = { data: out, ts: Date.now() }
    return out
  } catch (e) {
    console.warn('Earnings-yield history:', e.message)
    return eyHistCache.data || {}
  }
}

async function fetchErp() {
  if (erpCache.data && Date.now() - erpCache.ts < ERP_TTL) return erpCache.data

  // Current earnings yield (SPY) + current & historical 10Y
  const [pe, dgs10obs, eyHist] = await Promise.all([
    fetchIndexPE().catch(() => []),
    fetchFredSeries('DGS10', 8000).catch(() => []),
    fetchEarningsYieldHistory(),
  ])
  const spy = (pe || []).find(x => x.symbol === 'SPY')
  const curEY = spy?.earningsYield ?? null
  const cur10Y = dgs10obs.length ? dgs10obs[dgs10obs.length - 1].v : null
  const currentErp = (curEY != null && cur10Y != null) ? +(curEY - cur10Y).toFixed(2) : null

  // Monthly 10Y map (last obs per month wins)
  const y10ByMonth = {}
  for (const o of dgs10obs) y10ByMonth[o.d.slice(0, 7)] = o.v

  // Build ERP history over months present in both, last 25 years
  const cutoff = `${new Date().getFullYear() - 25}-01`
  const hist = Object.keys(eyHist)
    .filter(mk => mk >= cutoff && y10ByMonth[mk] != null)
    .sort()
    .map(mk => ({ d: `${mk}-01`, ey: eyHist[mk], y10: y10ByMonth[mk], v: +(eyHist[mk] - y10ByMonth[mk]).toFixed(2) }))

  // Percentile of current ERP within history (higher ERP = stocks cheaper)
  let percentile = null
  if (currentErp != null && hist.length) {
    const below = hist.filter(h => h.v < currentErp).length
    percentile = Math.round((below / hist.length) * 100)
  }

  // Verdict from percentile (regime-robust)
  let verdict = null, tone = 'neutral'
  if (percentile != null) {
    if (percentile >= 66)      { verdict = 'Stocks cheap vs bonds'; tone = 'success' }
    else if (percentile >= 40) { verdict = 'Fairly valued';         tone = 'neutral' }
    else if (percentile >= 15) { verdict = 'Bonds competitive';     tone = 'warning' }
    else                        { verdict = 'Bonds win';             tone = 'danger'  }
  }

  const result = {
    currentErp, earningsYield: curEY, tenYear: cur10Y,
    percentile, verdict, tone,
    history: hist,
    min: hist.length ? Math.min(...hist.map(h => h.v)) : null,
    max: hist.length ? Math.max(...hist.map(h => h.v)) : null,
    updated: Date.now(),
  }
  console.log(`ERP: ${currentErp}pp (EY ${curEY?.toFixed(2)} − 10Y ${cur10Y}) · ${percentile}th pctile · ${hist.length} months`)
  erpCache = { data: result, ts: Date.now() }
  return result
}

/* ── Commodity spot prices via Yahoo Finance (15-min cache) ──── */
let commodCache = { data: null, ts: 0 }
const COMMODITY_SYMBOLS = [
  // Precious metals
  { symbol: "GC=F",  name: "Gold",     unit: "$/oz",    icon: "🥇", group: "metals",     color: "#F59E0B" },
  { symbol: "SI=F",  name: "Silver",   unit: "$/oz",    icon: "🥈", group: "metals",     color: "#94a3b8" },
  { symbol: "PL=F",  name: "Platinum", unit: "$/oz",    icon: "⚪", group: "metals",     color: "#a78bfa" },
  { symbol: "PA=F",  name: "Palladium",unit: "$/oz",    icon: "🟣", group: "metals",     color: "#c084fc" },
  // Energy
  { symbol: "CL=F",  name: "WTI Crude",    unit: "$/bbl",  icon: "🛢️", group: "energy",     color: "#E8553A" },
  { symbol: "BZ=F",  name: "Brent Crude",  unit: "$/bbl",  icon: "🛢️", group: "energy",     color: "#F97316" },
  { symbol: "NG=F",  name: "Natural Gas",  unit: "$/MMBtu",icon: "🔥", group: "energy",     color: "#3B82F6" },
  // Industrial
  { symbol: "HG=F",  name: "Copper",       unit: "$/lb",   icon: "🟠", group: "industrial", color: "#F97316" },
  // Agriculture
  { symbol: "ZC=F",  name: "Corn",         unit: "¢/bu",   icon: "🌽", group: "agriculture", color: "#F59E0B" },
  { symbol: "ZW=F",  name: "Wheat",        unit: "¢/bu",   icon: "🌾", group: "agriculture", color: "#D97706" },
  { symbol: "ZS=F",  name: "Soybeans",     unit: "¢/bu",   icon: "🫘", group: "agriculture", color: "#10B981" },
  { symbol: "CT=F",  name: "Cotton",       unit: "¢/lb",   icon: "🧵", group: "agriculture", color: "#EC4899" },
  // Softs
  { symbol: "KC=F",  name: "Coffee",       unit: "¢/lb",   icon: "☕", group: "softs",      color: "#92400E" },
  { symbol: "CC=F",  name: "Cocoa",        unit: "$/mt",   icon: "🍫", group: "softs",      color: "#78350F" },
  { symbol: "SB=F",  name: "Sugar",        unit: "¢/lb",   icon: "🧂", group: "softs",      color: "#FBBF24" },
]

// Fetch a single Yahoo quote using the chart API (most reliable, no crumb needed for 1d)
// Yahoo's `chartPreviousClose` is the close BEFORE THE REQUESTED RANGE, not
// yesterday's close — with range=2d it returned the close from two sessions
// ago and the Cockpit showed SPY +0.65% on a −0.40% day. range=1d makes the
// field mean "previous session close", which is what a day-change needs.
async function fetchYahooQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
    const resp = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!resp.ok) return null
    const json = await resp.json()
    const m = json?.chart?.result?.[0]?.meta
    if (!m || m.regularMarketPrice == null) return null
    const prev = m.chartPreviousClose ?? m.previousClose ?? null
    const price = m.regularMarketPrice
    const change = prev != null ? price - prev : null
    const changePct = prev != null && prev !== 0 ? (price - prev) / prev : null
    return {
      price,
      change,
      changePct,
      prevClose: prev,
      dayHigh: m.regularMarketDayHigh ?? null,
      dayLow: m.regularMarketDayLow ?? null,
      timestamp: m.regularMarketTime ?? null,
    }
  } catch { return null }
}

// Fetch ~30 daily closes for sparklines. Returns array of {ts, v} (ms epoch + close).
async function fetchYahooSparkline(symbol, range = '1mo', interval = '1d') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
    const resp = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!resp.ok) return []
    const json = await resp.json()
    const r = json?.chart?.result?.[0]
    const ts = r?.timestamp || []
    const closes = (r?.indicators?.quote?.[0]?.close) || []
    return ts.map((t, i) => ({ ts: t * 1000, v: closes[i] })).filter(p => p.v != null)
  } catch { return [] }
}

/* ── Dashboard Summary — landing-page hero data ──────────────────────────
   Batches indexes, commodities, crypto, and macro rates into a single
   endpoint so the landing page is one fetch. Cached 1 min. */
const DASHBOARD_SUMMARY_TTL = 60 * 1000
let dashboardSummaryCache = { data: null, ts: 0 }

const SUMMARY_INDEXES = [
  { symbol: 'SPY',  name: 'S&P 500'      },
  { symbol: 'QQQ',  name: 'Nasdaq 100'   },
  { symbol: 'IWM',  name: 'Russell 2000' },
  { symbol: 'DIA',  name: 'Dow Jones'    },
  { symbol: '^VIX', name: 'VIX'          },
]
const SUMMARY_COMMODITIES = [
  { symbol: 'CL=F', name: 'Oil (WTI)'    },
  { symbol: 'GC=F', name: 'Gold'         },
  { symbol: 'SI=F', name: 'Silver'       },
  { symbol: 'NG=F', name: 'Nat Gas'      },
  { symbol: 'HG=F', name: 'Copper'       },
]
const SUMMARY_CRYPTO = [
  { symbol: 'BTC-USD', display: 'BTC',  name: 'Bitcoin'  },
  { symbol: 'ETH-USD', display: 'ETH',  name: 'Ethereum' },
  { symbol: 'SOL-USD', display: 'SOL',  name: 'Solana'   },
]
const SUMMARY_RATES = [
  { id: 'DFF',          name: 'Fed Funds',      unit: '%'  },
  { id: 'DGS2',         name: '2Y Treasury',    unit: '%'  },
  { id: 'DGS10',        name: '10Y Treasury',   unit: '%'  },
  { id: 'DGS30',        name: '30Y Treasury',   unit: '%'  },
  { id: 'MORTGAGE30US', name: '30Y Mortgage',   unit: '%'  },
]

async function fetchDashboardSummary() {
  if (dashboardSummaryCache.data && Date.now() - dashboardSummaryCache.ts < DASHBOARD_SUMMARY_TTL) return dashboardSummaryCache.data

  // Quote + sparkline batched per asset class
  const fetchAsset = async (a) => {
    const [q, spark] = await Promise.all([
      fetchYahooQuote(a.symbol),
      fetchYahooSparkline(a.symbol, '1mo', '1d'),
    ])
    if (!q) return null
    return {
      symbol: a.display || a.symbol,
      yahooSymbol: a.symbol,
      name: a.name,
      price: q.price,
      change: q.change,
      changePct: q.changePct,
      prevClose: q.prevClose,
      spark: spark.slice(-22).map(p => p.v),  // ~22 trading days
    }
  }

  // All asset classes in parallel — Yahoo handles this well
  const [indexes, commodities, crypto] = await Promise.all([
    Promise.all(SUMMARY_INDEXES.map(fetchAsset)),
    Promise.all(SUMMARY_COMMODITIES.map(fetchAsset)),
    Promise.all(SUMMARY_CRYPTO.map(fetchAsset)),
  ])

  // Rates from FRED in parallel (need latest observation)
  const rates = await Promise.all(SUMMARY_RATES.map(async r => {
    const obs = await fetchFredSeries(r.id, 60)  // recent window
    if (!obs.length) return null
    const latest = obs[obs.length - 1]
    const prior = obs.length > 5 ? obs[obs.length - 6] : null   // ~5 obs ago
    return {
      id: r.id,
      name: r.name,
      unit: r.unit,
      value: latest.v,
      lastDate: latest.d,
      change: prior ? latest.v - prior.v : null,
      spark: obs.slice(-30).map(o => o.v),
    }
  }))
  const rateMap = Object.fromEntries(rates.filter(Boolean).map(r => [r.id, r]))

  // Compute 2s10s spread (basis points) as a synthetic row
  if (rateMap.DGS2 && rateMap.DGS10) {
    rateMap.spread2s10s = {
      id: 'spread2s10s',
      name: '2s10s Spread',
      unit: 'bp',
      value: (rateMap.DGS10.value - rateMap.DGS2.value) * 100,
      lastDate: rateMap.DGS10.lastDate,
      change: null,
      synthetic: true,
    }
  }

  const result = {
    asOf: Date.now(),
    indexes: indexes.filter(Boolean),
    commodities: commodities.filter(Boolean),
    crypto: crypto.filter(Boolean),
    rates: Object.values(rateMap),
  }
  dashboardSummaryCache = { data: result, ts: Date.now() }
  console.log(`Dashboard summary: ${result.indexes.length} indexes, ${result.commodities.length} commodities, ${result.crypto.length} crypto, ${result.rates.length} rates`)
  return result
}

async function fetchCommoditySpot() {
  if (commodCache.data && Date.now() - commodCache.ts < PE_TTL) return commodCache.data
  // Run in small batches to be polite to Yahoo
  const results = []
  const BATCH = 5
  for (let i = 0; i < COMMODITY_SYMBOLS.length; i += BATCH) {
    const batch = COMMODITY_SYMBOLS.slice(i, i + BATCH)
    const batchRes = await Promise.all(batch.map(async (c) => {
      const q = await fetchYahooQuote(c.symbol)
      return { ...c, ...(q || { price: null, change: null, changePct: null, prevClose: null, dayHigh: null, dayLow: null }) }
    }))
    results.push(...batchRes)
    if (i + BATCH < COMMODITY_SYMBOLS.length) await new Promise(r => setTimeout(r, 150))
  }
  const successCount = results.filter(r => r.price != null).length
  console.log(`Commodity spot: ${successCount}/${COMMODITY_SYMBOLS.length} symbols fetched`)
  commodCache = { data: results, ts: Date.now() }
  return results
}

/* ── Commodity historical (Yahoo Finance, 1-hour cache, all symbols) ── */
let metalHistCache = { data: null, ts: 0 }

async function fetchMetalHistory() {
  if (metalHistCache.data && Date.now() - metalHistCache.ts < 60 * 60 * 1000) return metalHistCache.data
  const results = []
  const BATCH = 5
  for (let i = 0; i < COMMODITY_SYMBOLS.length; i += BATCH) {
    const batch = COMMODITY_SYMBOLS.slice(i, i + BATCH)
    const batchRes = await Promise.all(batch.map(async (c) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(c.symbol)}?range=10y&interval=1wk`
        const resp = await fetch(url, { headers: { 'User-Agent': UA } })
        if (!resp.ok) return { symbol: c.symbol, name: c.name, group: c.group, color: c.color, history: [] }
        const json = await resp.json()
        const result = json.chart?.result?.[0]
        const ts = result?.timestamp || []
        const closes = result?.indicators?.quote?.[0]?.close || []
        const history = []
        for (let j = 0; j < ts.length; j++) {
          if (closes[j] != null) {
            history.push({ d: new Date(ts[j] * 1000).toISOString().slice(0, 10), v: closes[j] })
          }
        }
        return { symbol: c.symbol, name: c.name, group: c.group, color: c.color, history }
      } catch { return { symbol: c.symbol, name: c.name, group: c.group, color: c.color, history: [] } }
    }))
    results.push(...batchRes)
    if (i + BATCH < COMMODITY_SYMBOLS.length) await new Promise(r => setTimeout(r, 200))
  }
  const withData = results.filter(r => r.history.length).length
  console.log(`Commodity history: ${withData}/${COMMODITY_SYMBOLS.length} symbols have history`)
  metalHistCache = { data: results, ts: Date.now() }
  return results
}

/* ── BLS CPI Category Data (1-hour cache) ────────────────────── */
let blsCache = { data: null, ts: 0 }
const BLS_TTL = 60 * 60 * 1000

// BLS series IDs for CPI categories (seasonally adjusted, CPI-U, US city avg)
const BLS_CPI_SERIES = {
  CUSR0000SA0:      { label: "CPI All Items",      color: "#E8553A", icon: "📈" },
  CUSR0000SA0L1E:   { label: "Core CPI",           color: "#3B82F6", icon: "🎯" },
  CUSR0000SAF1:     { label: "Food",               color: "#F97316", icon: "🍕" },
  CUSR0000SA0E:     { label: "Energy",             color: "#FBBF24", icon: "⚡" },
  CUSR0000SAH1:     { label: "Shelter",            color: "#60A5FA", icon: "🏠" },
  CUSR0000SAM:      { label: "Medical Care",       color: "#EC4899", icon: "🏥" },
  CUSR0000SAT:      { label: "Transportation",     color: "#10B981", icon: "🚗" },
  CUSR0000SAA:      { label: "Apparel",            color: "#8B5CF6", icon: "👔" },
  CUSR0000SAR:      { label: "Recreation",         color: "#14B8A6", icon: "🎮" },
  CUSR0000SAE:      { label: "Education & Comm",   color: "#6366F1", icon: "📚" },
  CUSR0000SETA02:   { label: "Used Cars & Trucks", color: "#34D399", icon: "🚙" },
  CUSR0000SETA01:   { label: "New Vehicles",       color: "#4ADE80", icon: "🚘" },
}

async function fetchBLSCPI() {
  if (blsCache.data && Date.now() - blsCache.ts < BLS_TTL) return blsCache.data

  const seriesIds = Object.keys(BLS_CPI_SERIES)
  const currentYear = new Date().getFullYear()

  try {
    const postBody = {
      seriesid: seriesIds,
      startyear: String(currentYear - 2),
      endyear: String(currentYear),
    }
    if (BLS_KEY) postBody.registrationkey = BLS_KEY

    const resp = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify(postBody)
    })
    const json = await resp.json()
    if (json.status !== 'REQUEST_SUCCEEDED') {
      console.warn('BLS API error:', json.status, json.message)
      if (json.message?.some(m => m.includes('threshold'))) {
        console.warn('BLS daily request limit reached. Register for a free key at https://data.bls.gov/registrationEngine/')
      }
      return null
    }
    console.log(`BLS CPI: fetched ${json.Results?.series?.length || 0} series successfully`)

    const result = {}
    for (const series of (json.Results?.series || [])) {
      const meta = BLS_CPI_SERIES[series.seriesID]
      if (!meta) continue

      // Data comes newest-first, reverse for chronological order
      const points = [...series.data]
        .filter(d => d.value !== '-' && d.period !== 'M13') // skip annual avg & missing
        .reverse()
        .map(d => ({
          date: `${d.year}-${d.period.replace('M', '').padStart(2, '0')}`,
          value: parseFloat(d.value)
        }))

      // Compute YoY % change from index values
      const history = []
      for (let i = 12; i < points.length; i++) {
        const prev = points[i - 12].value
        if (prev > 0) {
          const yoy = parseFloat((((points[i].value - prev) / prev) * 100).toFixed(2))
          history.push({ d: points[i].date, v: yoy })
        }
      }

      const latest = history[history.length - 1]
      result[series.seriesID] = {
        ...meta,
        yoy: latest?.v ?? null,
        lastDate: latest?.d ?? null,
        latestIndex: points[points.length - 1]?.value ?? null,
        history,
      }
    }

    if (Object.keys(result).length > 0) {
      blsCache = { data: result, ts: Date.now() }
    }
    return result
  } catch (e) {
    console.error('BLS CPI fetch error:', e.message)
    return null
  }
}

/* ── S&P 500 Screener (FMP profile + metrics, 6-hour cache) ──── */
const SP500_DATA_FILE = path.join(__dirname, 'sp500-data.json')
const SP500_TTL = 6 * 60 * 60 * 1000
let sp500Cache = { data: null, ts: 0 }
let sp500Refreshing = false  // stale-while-revalidate flag

const SP500_TICKERS = [
  "MMM","AOS","ABT","ABBV","ACN","ADBE","AMD","AES","AFL","A","APD","ABNB","AKAM","ALB","ARE","ALGN","ALLE","LNT","ALL","GOOGL",
  "GOOG","MO","AMZN","AMCR","AEE","AEP","AXP","AIG","AMT","AWK","AMP","AME","AMGN","APH","ADI","AON","APA","APO","AAPL","AMAT",
  "APP","APTV","ACGL","ADM","ARES","ANET","AJG","AIZ","T","ATO","ADSK","ADP","AZO","AVB","AVY","AXON","BKR","BALL","BAC","BAX",
  "BDX","BRK.B","BBY","TECH","BIIB","BLK","BX","XYZ","BK","BA","BKNG","BSX","BMY","AVGO","BR","BRO","BF.B","BLDR","BG","BXP",
  "CHRW","CDNS","CPT","CPB","COF","CAH","CCL","CARR","CVNA","CAT","CBOE","CBRE","CDW","COR","CNC","CNP","CF","CRL","SCHW","CHTR",
  "CVX","CMG","CB","CHD","CIEN","CI","CINF","CTAS","CSCO","C","CFG","CLX","CME","CMS","KO","CTSH","COIN","CL","CMCSA","FIX",
  "CAG","COP","ED","STZ","CEG","COO","CPRT","GLW","CPAY","CTVA","CSGP","COST","CTRA","CRH","CRWD","CCI","CSX","CMI","CVS","DHR",
  "DRI","DDOG","DVA","DECK","DE","DELL","DAL","DVN","DXCM","FANG","DLR","DG","DLTR","D","DPZ","DASH","DOV","DOW","DHI","DTE",
  "DUK","DD","ETN","EBAY","ECL","EIX","EW","EA","ELV","EME","EMR","ETR","EOG","EPAM","EQT","EFX","EQIX","EQR","ERIE","ESS",
  "EL","EG","EVRG","ES","EXC","EXE","EXPE","EXPD","EXR","XOM","FFIV","FDS","FICO","FAST","FRT","FDX","FIS","FITB","FSLR","FE",
  "FISV","F","FTNT","FTV","FOXA","FOX","BEN","FCX","GRMN","IT","GE","GEHC","GEV","GEN","GNRC","GD","GIS","GM","GPC","GILD",
  "GPN","GL","GDDY","GS","HAL","HIG","HAS","HCA","DOC","HSIC","HSY","HPE","HLT","HOLX","HD","HON","HRL","HST","HWM","HPQ",
  "HUBB","HUM","HBAN","HII","IBM","IEX","IDXX","ITW","INCY","IR","PODD","INTC","IBKR","ICE","IFF","IP","INTU","ISRG","IVZ","INVH",
  "IQV","IRM","JBHT","JBL","JKHY","J","JNJ","JCI","JPM","KVUE","KDP","KEY","KEYS","KMB","KIM","KMI","KKR","KLAC","KHC","KR",
  "LHX","LH","LRCX","LW","LVS","LDOS","LEN","LII","LLY","LIN","LYV","LMT","L","LOW","LULU","LYB","MTB","MPC","MAR","MRSH",
  "MLM","MAS","MA","MTCH","MKC","MCD","MCK","MDT","MRK","META","MET","MTD","MGM","MCHP","MU","MSFT","MAA","MRNA","MOH","TAP",
  "MDLZ","MPWR","MNST","MCO","MS","MOS","MSI","MSCI","NDAQ","NTAP","NFLX","NEM","NWSA","NWS","NEE","NKE","NI","NDSN","NSC","NTRS",
  "NOC","NCLH","NRG","NUE","NVDA","NVR","NXPI","ORLY","OXY","ODFL","OMC","ON","OKE","ORCL","OTIS","PCAR","PKG","PLTR","PANW","PSKY",
  "PH","PAYX","PAYC","PYPL","PNR","PEP","PFE","PCG","PM","PSX","PNW","PNC","POOL","PPG","PPL","PFG","PG","PGR","PLD","PRU",
  "PEG","PTC","PSA","PHM","PWR","QCOM","DGX","Q","RL","RJF","RTX","O","REG","REGN","RF","RSG","RMD","RVTY","HOOD","ROK",
  "ROL","ROP","ROST","RCL","SPGI","CRM","SNDK","SBAC","SLB","STX","SRE","NOW","SHW","SPG","SWKS","SJM","SW","SNA","SOLV","SO",
  "LUV","SWK","SBUX","STT","STLD","STE","SYK","SMCI","SYF","SNPS","SYY","TMUS","TROW","TTWO","TPR","TRGP","TGT","TEL","TDY","TER",
  "TSLA","TXN","TPL","TXT","TMO","TJX","TKO","TTD","TSCO","TT","TDG","TRV","TRMB","TFC","TYL","TSN","USB","UBER","UDR","ULTA",
  "UNP","UAL","UPS","URI","UNH","UHS","VLO","VTR","VLTO","VRSN","VRSK","VZ","VRTX","VTRS","VICI","V","VST","VMC","WRB","GWW",
  "WAB","WMT","DIS","WBD","WM","WAT","WEC","WFC","WELL","WST","WDC","WY","WSM","WMB","WTW","WDAY","WYNN","XEL","XYL","YUM",
  "ZBRA","ZBH","ZTS"
]

// Background refresh — fires-and-forgets the heavy 503-ticker fetch so the
// foreground request can return stale-but-usable data immediately.
async function refreshSP500InBackground(existing) {
  try {
    const data = await fetchSP500Tickers(existing, [...SP500_TICKERS], 'background')
    sp500Cache = { data, ts: Date.now() }
    console.log(`S&P 500 background refresh: complete, ${data.length} tickers updated`)
  } catch (e) {
    console.error('S&P 500 background refresh failed:', e.message)
  }
}

// Core fetch loop — pulled out so both synchronous and background paths can use it
async function fetchSP500Tickers(existing, needsFetch, label = 'sync') {
  const existingMap = new Map(existing.map(s => [s.symbol, s]))
  const BATCH = 5
  const DELAY = 3500
  let rateLimited = false

  const fetchJSON = async (url) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
      const data = await resp.json()
      if (data && data['Error Message'] && /limit/i.test(data['Error Message'])) {
        rateLimited = true
        return null
      }
      return Array.isArray(data) ? data[0] : null
    } catch { return null }
    finally { clearTimeout(timer) }
  }

  for (let i = 0; i < needsFetch.length; i += BATCH) {
    if (rateLimited) {
      console.log(`S&P 500 (${label}): rate limited at ${i}/${needsFetch.length}, saving partial progress`)
      break
    }
    const batch = needsFetch.slice(i, i + BATCH)
    await Promise.all(batch.map(async (ticker) => {
      try {
        const fmpTicker = ticker.replace('.', '-')
        const [profile, metrics, ratios] = await Promise.all([
          fetchJSON(`https://financialmodelingprep.com/stable/profile?symbol=${fmpTicker}&apikey=${FMP_KEY}`),
          fetchJSON(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${fmpTicker}&apikey=${FMP_KEY}`),
          fetchJSON(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${fmpTicker}&apikey=${FMP_KEY}`),
        ])
        if (rateLimited) return
        // If profile failed but we had old data, KEEP the old data (don't blank fields)
        if (!profile && existingMap.has(ticker)) return
        const p = profile || {}, m = metrics || {}, r = ratios || {}
        existingMap.set(ticker, {
          symbol: ticker,
          name: p.companyName ?? existingMap.get(ticker)?.name ?? null,
          sector: p.sector ?? existingMap.get(ticker)?.sector ?? null,
          industry: p.industry ?? existingMap.get(ticker)?.industry ?? null,
          mktCap: p.marketCap ?? existingMap.get(ticker)?.mktCap ?? null,
          price: p.price ?? null,
          changePct: p.changePercentage ?? null,
          beta: p.beta ?? existingMap.get(ticker)?.beta ?? null,
          pe: r.priceToEarningsRatioTTM ?? null,
          peg: r.priceToEarningsGrowthRatioTTM ?? null,
          earningsYield: m.earningsYieldTTM ?? null,
          fcfYield: m.freeCashFlowYieldTTM ?? null,
          roe: m.returnOnEquityTTM ?? null,
          roic: m.returnOnInvestedCapitalTTM ?? null,
          evEbitda: m.evToEBITDATTM ?? null,
          netDebtEbitda: m.netDebtToEBITDATTM ?? null,
          currentRatio: m.currentRatioTTM ?? null,
          grossMargin: r.grossProfitMarginTTM ?? null,
          opMargin: r.operatingProfitMarginTTM ?? null,
          netMargin: r.netProfitMarginTTM ?? null,
          divYield: r.dividendYieldTTM ?? null,
        })
      } catch (e) {
        console.warn(`S&P 500 (${label}): error fetching ${ticker}:`, e.message)
      }
    }))
    if ((i + BATCH) % 50 < BATCH) {
      console.log(`S&P 500 (${label}): progress ${Math.min(i + BATCH, needsFetch.length)}/${needsFetch.length}`)
    }
    if (i + BATCH < needsFetch.length) await new Promise(r => setTimeout(r, DELAY))
  }

  const results = SP500_TICKERS.map(t => existingMap.get(t)).filter(Boolean)
  const complete = results.filter(s => s.name && s.mktCap).length
  console.log(`S&P 500 (${label}): done — ${complete}/${results.length} complete${rateLimited ? ' (rate-limited)' : ''}`)
  const now = Date.now()
  try { fs.writeFileSync(SP500_DATA_FILE, JSON.stringify({ ts: now, data: results }, null, 2)) } catch (e) { console.error('Failed to save S&P 500 data:', e.message) }
  return results
}

async function fetchSP500Screener() {
  // Check memory cache
  if (sp500Cache.data && Date.now() - sp500Cache.ts < SP500_TTL) return sp500Cache.data

  // Check disk cache
  let existing = []
  let diskTs = 0
  try {
    if (fs.existsSync(SP500_DATA_FILE)) {
      const disk = JSON.parse(fs.readFileSync(SP500_DATA_FILE, 'utf8'))
      if (disk.ts && Date.now() - disk.ts < SP500_TTL) {
        sp500Cache = { data: disk.data, ts: disk.ts }
        return disk.data
      }
      // Stale-but-present: serve immediately, refresh in background
      if (disk.data) { existing = disk.data; diskTs = disk.ts || 0 }
    }
  } catch {}

  // Stale-while-revalidate: if we have ANY existing data (even old), return it
  // immediately and kick off the slow refresh in the background. This keeps the
  // page responsive — refreshing 503 tickers takes ~6 min and would otherwise
  // block the first request after the TTL expires.
  if (existing.length > 0 && !sp500Refreshing) {
    sp500Refreshing = true
    // Background refresh — won't be awaited
    refreshSP500InBackground(existing).finally(() => { sp500Refreshing = false })
    // Update in-memory cache ts so subsequent requests in the next 6h serve
    // this stale data without re-triggering refresh
    sp500Cache = { data: existing, ts: Date.now() }
    console.log(`S&P 500 screener: serving ${existing.length} stale tickers (last refresh ${diskTs ? new Date(diskTs).toISOString() : 'unknown'}), refreshing in background...`)
    return existing
  }
  // No data at all — caller will block on the synchronous fetch below

  // Cold start (no disk cache, no in-memory cache): block on the synchronous
  // fetch. This is rare — only happens on a brand-new install.
  console.log(`S&P 500 screener: cold start — blocking fetch of all ${SP500_TICKERS.length} tickers...`)
  const results = await fetchSP500Tickers([], [...SP500_TICKERS], 'sync')
  sp500Cache = { data: results, ts: Date.now() }
  return results
}

/* ── OpenRouter Rankings — persisted history (fixes 7-day window) ──── */
const OR_RANKINGS_FILE = path.join(__dirname, 'rankings-history.json')
let orRankingsCache = { data: null, ts: 0 }
const OR_RANKINGS_TTL = 15 * 60 * 1000 // 15-min live cache

function loadRankingsHistory() {
  try {
    if (fs.existsSync(OR_RANKINGS_FILE)) return JSON.parse(fs.readFileSync(OR_RANKINGS_FILE, 'utf8'))
  } catch {}
  return { rows: [] }
}
function saveRankingsHistory(data) {
  try { fs.writeFileSync(OR_RANKINGS_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save rankings history:', e.message) }
}

// Fetch fresh rankings from OpenRouter's RSC endpoint (server-side, no CORS issues)
// OpenRouter restored a clean public GET endpoint for rankings (their old RSC
// POST trick broke). /rankings/models is the per-model token-usage snapshot.
async function fetchOpenRouterRankingsFresh() {
  const resp = await fetch('https://openrouter.ai/api/frontend/v1/rankings/models', { headers: { 'User-Agent': UA } })
  if (!resp.ok) throw new Error(`OpenRouter rankings HTTP ${resp.status}`)
  const json = await resp.json()
  if (!Array.isArray(json.data)) throw new Error('OpenRouter rankings: unexpected shape')
  return json.data
}

// Provider-level weekly token volume — 52 weeks of history. The key signal for
// "overall market growth" and how provider share shifts over time.
// Shape: [{ x: "2025-06-16", ys: { google: tokens, anthropic: tokens, ... } }]
async function fetchOpenRouterMarketShare() {
  try {
    const resp = await fetch('https://openrouter.ai/api/frontend/v1/rankings/market-share', { headers: { 'User-Agent': UA } })
    if (!resp.ok) return []
    const json = await resp.json()
    return Array.isArray(json.data) ? json.data : []
  } catch (e) {
    console.warn('OpenRouter market-share:', e.message)
    return []
  }
}

// Normalize date to YYYY-MM-DD.
// OpenRouter returns "2026-04-22 00:00:00", which slicing to 10 handles, but
// the SemiAnalysis series returns RFC-2822 ("Fri, 01 Aug 2025 00:00:00 GMT")
// and slicing that gives "Fri, 01 Au" — a string that is still ten characters,
// still sorts, and is silently useless. It corrupted 1,106 of the index's 1,147
// points. Parse anything that is not already ISO.
const normDate = d => {
  const s = String(d || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ''
}

// Today in server-local YYYY-MM-DD
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

async function getRankingsWithHistory() {
  if (orRankingsCache.data && Date.now() - orRankingsCache.ts < OR_RANKINGS_TTL) return orRankingsCache.data

  // Fetch fresh model rows + 52-week market-share history in parallel
  let fresh = [], marketShare = []
  try {
    [fresh, marketShare] = await Promise.all([
      fetchOpenRouterRankingsFresh(),
      fetchOpenRouterMarketShare(),
    ])
  } catch (e) {
    console.warn('OpenRouter rankings fetch failed:', e.message)
    // Fall back to archive only
    const archive = loadRankingsHistory()
    const result = { rows: archive.rows, marketShare: archive.marketShare || [], source: 'archive-only', updated: Date.now() }
    orRankingsCache = { data: result, ts: Date.now() }
    return result
  }

  // Load archive and merge
  const archive = loadRankingsHistory()
  // Key: `${date}|${model_permaslug}` → row
  const merged = new Map()
  for (const row of archive.rows || []) {
    const d = normDate(row.date)
    if (!d || !row.model_permaslug) continue
    merged.set(`${d}|${row.model_permaslug}`, { ...row, date: d })
  }
  const today = todayStr()
  let added = 0, updatedToday = 0
  for (const row of fresh) {
    const d = normDate(row.date)
    if (!d || !row.model_permaslug) continue
    const key = `${d}|${row.model_permaslug}`
    const existed = merged.has(key)
    // For past dates: only insert if not already archived (archive is authoritative for "closed" days).
    // For today: always overwrite (latest snapshot for today-so-far).
    if (d === today || !existed) {
      merged.set(key, { ...row, date: d })
      if (existed) updatedToday++
      else added++
    }
  }

  const rows = Array.from(merged.values())
  // Sort by date ascending
  rows.sort((a, b) => a.date.localeCompare(b.date))

  // Persist (non-blocking best-effort) — include market-share so the archive
  // retains it if a later live fetch fails
  saveRankingsHistory({ rows, marketShare, lastUpdated: Date.now() })

  const uniqueDates = new Set(rows.map(r => r.date)).size
  console.log(`OpenRouter rankings: +${added} new, ~${updatedToday} today updated, ${rows.length} total archived across ${uniqueDates} dates · ${marketShare.length} weeks market-share`)

  const result = { rows, marketShare, source: 'live+archive', updated: Date.now(), dates: uniqueDates }
  orRankingsCache = { data: result, ts: Date.now() }
  return result
}

/* ── Macro Dashboard — the U.S. Economy tab's at-a-glance landing ─────────
   One batched FRED pull: headline tiles, recession lights, regime quadrant,
   real-rate verdicts. Everything precomputed server-side. */
let macroDashCache = { data: null, ts: 0 }
const MACRO_DASH_TTL = 4 * 60 * 60 * 1000

const MACRO_SERIES = {
  A191RL1Q225SBEA: { label: 'Real GDP Growth (QoQ SAAR)', freq: 'Q', limit: 120 },
  CPIAUCSL:        { label: 'CPI',                        freq: 'M', limit: 480 },
  CPILFESL:        { label: 'Core CPI',                   freq: 'M', limit: 480 },
  PCEPILFE:        { label: 'Core PCE',                   freq: 'M', limit: 480 },
  UNRATE:          { label: 'Unemployment (U-3)',         freq: 'M', limit: 480 },
  SAHMREALTIME:    { label: 'Sahm Rule',                  freq: 'M', limit: 240 },
  PAYEMS:          { label: 'Nonfarm Payrolls',           freq: 'M', limit: 480 },
  FEDFUNDS:        { label: 'Fed Funds Rate',             freq: 'M', limit: 480 },
  DGS2:            { label: '2Y Treasury',                freq: 'D', limit: 120 },
  DGS10:           { label: '10Y Treasury',               freq: 'D', limit: 120 },
  MORTGAGE30US:    { label: '30Y Mortgage',               freq: 'W', limit: 1100 },
  CSUSHPINSA:      { label: 'Case-Shiller Home Prices',   freq: 'M', limit: 480 },
  UMCSENT:         { label: 'Consumer Sentiment',         freq: 'M', limit: 480 },
  IC4WSA:          { label: 'Jobless Claims (4-wk avg)',  freq: 'W', limit: 1100 },
  HOUST:           { label: 'Housing Starts',             freq: 'M', limit: 480 },
  FYFSGDA188S:     { label: 'Federal Deficit % of GDP',   freq: 'A', limit: 60 },
  CES0500000003:   { label: 'Avg Hourly Earnings',        freq: 'M', limit: 240 },
}
const MACRO_YOY_LAG = { M: 12, W: 52, Q: 4, A: 1, D: 251 }

const pctileOf = (arr, val) => {
  const a = (arr || []).filter(v => v != null && isFinite(v))
  if (a.length < 8 || val == null) return null
  return Math.round((a.filter(v => v < val).length / a.length) * 100)
}

async function fetchMacroDashboard() {
  if (macroDashCache.data && Date.now() - macroDashCache.ts < MACRO_DASH_TTL) return macroDashCache.data
  console.log('Macro dashboard: fetching FRED batch...')

  const series = {}
  await Promise.all(Object.entries(MACRO_SERIES).map(async ([id, meta]) => {
    try {
      const obs = await fetchFredSeries(id, meta.limit)
      if (!obs.length) return
      const vals = obs.map(o => o.v)
      const lag = MACRO_YOY_LAG[meta.freq] || 12
      const yoySeries = []
      for (let i = lag; i < vals.length; i++) {
        if (vals[i - lag]) yoySeries.push(+(((vals[i] - vals[i - lag]) / Math.abs(vals[i - lag])) * 100).toFixed(2))
        else yoySeries.push(null)
      }
      const current = vals[vals.length - 1]
      const yoy = yoySeries.length ? yoySeries[yoySeries.length - 1] : null
      series[id] = {
        id, label: meta.label, freq: meta.freq,
        current, prev: vals.length > 1 ? vals[vals.length - 2] : null,
        lastDate: obs[obs.length - 1].d,
        yoy,
        sparkRaw: vals.slice(-40),
        sparkYoY: yoySeries.slice(-40),
        pctRaw: pctileOf(vals, current),
        pctYoY: pctileOf(yoySeries, yoy),
        obs,   // used below for composites, stripped before respond
      }
    } catch (e) { console.warn(`Macro dash ${id}:`, e.message) }
  }))

  const s = series
  const cpiYoY     = s.CPIAUCSL?.yoy ?? null
  const coreCpiYoY = s.CPILFESL?.yoy ?? null
  const corePceYoY = s.PCEPILFE?.yoy ?? null
  const wageYoY    = s.CES0500000003?.yoy ?? null

  // Payrolls: 3-month average monthly change (PAYEMS is in thousands)
  let payroll3mo = null
  if (s.PAYEMS?.obs?.length > 4) {
    const p = s.PAYEMS.obs.map(o => o.v)
    const diffs = [p.length - 1, p.length - 2, p.length - 3].map(i => p[i] - p[i - 1])
    payroll3mo = Math.round(diffs.reduce((a, b) => a + b, 0) / 3)
  }

  // Regime path: last 8 GDP quarters matched with CPI YoY at quarter mid
  const regimePath = []
  if (s.A191RL1Q225SBEA?.obs?.length && s.CPIAUCSL?.obs?.length) {
    const cpiObs = s.CPIAUCSL.obs
    const lag = 12
    const cpiYoYByMonth = {}
    for (let i = lag; i < cpiObs.length; i++) {
      if (cpiObs[i - lag].v) cpiYoYByMonth[cpiObs[i].d.slice(0, 7)] = +(((cpiObs[i].v - cpiObs[i - lag].v) / cpiObs[i - lag].v) * 100).toFixed(2)
    }
    const gdpObs = s.A191RL1Q225SBEA.obs.slice(-8)
    for (const g of gdpObs) {
      const [yr, mo] = g.d.split('-').map(Number)
      let infl = null
      for (const off of [2, 1, 0]) {
        const m = mo + off, y2 = yr + Math.floor((m - 1) / 12), m2 = ((m - 1) % 12) + 1
        const key = `${y2}-${String(m2).padStart(2, '0')}`
        if (cpiYoYByMonth[key] != null) { infl = cpiYoYByMonth[key]; break }
      }
      if (infl != null) regimePath.push({ d: g.d, growth: g.v, inflation: infl })
    }
  }

  const computed = {
    cpiYoY, coreCpiYoY, corePceYoY, wageYoY,
    homePriceYoY: s.CSUSHPINSA?.yoy ?? null,
    spread2s10s: (s.DGS10?.current != null && s.DGS2?.current != null) ? +((s.DGS10.current - s.DGS2.current) * 100).toFixed(0) : null,
    sahm: s.SAHMREALTIME?.current ?? null,
    claimsYoY: s.IC4WSA?.yoy ?? null,
    houstYoY: s.HOUST?.yoy ?? null,
    payroll3mo,
    realFFR:  (s.FEDFUNDS?.current != null && corePceYoY != null) ? +(s.FEDFUNDS.current - corePceYoY).toFixed(2) : null,
    real10Y:  (s.DGS10?.current != null && cpiYoY != null) ? +(s.DGS10.current - cpiYoY).toFixed(2) : null,
    realWages: (wageYoY != null && cpiYoY != null) ? +(wageYoY - cpiYoY).toFixed(2) : null,
    regimePath,
  }

  // Strip the raw obs arrays before serving (payload diet)
  Object.values(series).forEach(x => { delete x.obs })

  const result = { series, computed, updated: Date.now() }
  console.log(`Macro dashboard: ${Object.keys(series).length}/${Object.keys(MACRO_SERIES).length} series · 2s10s ${computed.spread2s10s}bp · Sahm ${computed.sahm} · realFFR ${computed.realFFR}`)
  macroDashCache = { data: result, ts: Date.now() }
  return result
}

/* ── Consumer Health — is the American household healthy? ─────────────────
   Thesis: consumers are healthy when INCOME funds spending, stressed when
   BORROWING funds spending. Batches FRED, precomputes the income/spend/borrow
   mechanism, a stress dial, and affordability + K-shape context. */
let consumerCache = { data: null, ts: 0 }
const CONSUMER_TTL = 4 * 60 * 60 * 1000

const CONSUMER_SERIES = {
  TDSP:          { label: 'Debt Service Ratio',       freq: 'Q', limit: 200, unit: '%' },
  DSPIC96:       { label: 'Real Disposable Income',   freq: 'M', limit: 480 },
  PCEC96:        { label: 'Real Consumer Spending',   freq: 'M', limit: 480 },
  RRSFS:         { label: 'Real Retail Sales',        freq: 'M', limit: 400 },
  REVOLSL:       { label: 'Revolving Credit (cards)', freq: 'M', limit: 480 },
  TERMCBCCALLNS: { label: 'Credit Card APR',          freq: 'M', limit: 240, unit: '%' },
  GASREGW:       { label: 'Gas Price (regular)',      freq: 'W', limit: 1200, unit: '$' },
  PSAVERT:       { label: 'Personal Savings Rate',    freq: 'M', limit: 480, unit: '%' },
  DRCCLACBS:     { label: 'Credit Card Delinquency',  freq: 'Q', limit: 160, unit: '%' },
  UMCSENT:       { label: 'Consumer Sentiment',       freq: 'M', limit: 480 },
  // Consumer and mortgage delinquencies live on Credit → Banks; the wealth
  // shares on this tab's Household Net Worth panel (Fed DFA). Not fetched here.
}

async function fetchConsumerHealth() {
  if (consumerCache.data && Date.now() - consumerCache.ts < CONSUMER_TTL) return consumerCache.data
  console.log('Consumer health: fetching FRED batch...')

  const series = {}
  await Promise.all(Object.entries(CONSUMER_SERIES).map(async ([id, meta]) => {
    try {
      const obs = await fetchFredSeries(id, meta.limit)
      if (!obs.length) return
      const vals = obs.map(o => o.v)
      const lag = MACRO_YOY_LAG[meta.freq] || 12
      const yoySeries = []
      for (let i = 0; i < vals.length; i++) {
        yoySeries.push(i >= lag && vals[i - lag] ? +(((vals[i] - vals[i - lag]) / Math.abs(vals[i - lag])) * 100).toFixed(2) : null)
      }
      const current = vals[vals.length - 1]
      const prevYr = vals.length > lag ? vals[vals.length - 1 - lag] : null
      series[id] = {
        id, label: meta.label, unit: meta.unit || '', freq: meta.freq,
        current, lastDate: obs[obs.length - 1].d,
        yoy: yoySeries[yoySeries.length - 1],
        deltaYr: prevYr != null ? +(current - prevYr).toFixed(2) : null,   // level change vs a year ago
        sparkRaw: vals.slice(-40),
        pctRaw: pctileOf(vals, current),
        obs,
      }
    } catch (e) { console.warn(`Consumer ${id}:`, e.message) }
  }))

  const s = series
  const yoyAt = (id) => {
    const o = s[id]?.obs
    if (!o || o.length < 13) return null
    const map = {}
    for (let i = 12; i < o.length; i++) if (o[i - 12].v) map[o[i].d.slice(0, 7)] = +(((o[i].v - o[i - 12].v) / o[i - 12].v) * 100).toFixed(2)
    return map
  }
  const incMap = yoyAt('DSPIC96'), spMap = yoyAt('PCEC96'), revMap = yoyAt('REVOLSL')

  // Mechanism chart: income vs spending vs revolving-credit YoY, plus the
  // saving rate (a level), last 60 months
  let mechanism = []
  if (incMap && spMap && revMap) {
    const saveMap = Object.fromEntries((s.PSAVERT?.obs || []).map(o => [o.d.slice(0, 7), o.v]))
    const months = [...new Set([...Object.keys(incMap), ...Object.keys(spMap), ...Object.keys(revMap)])].sort().slice(-60)
    mechanism = months.map(m => ({ d: `${m}-01`, income: incMap[m] ?? null, spend: spMap[m] ?? null, revolving: revMap[m] ?? null, saving: saveMap[m] ?? null }))
  }

  const incomeGrowth = s.DSPIC96?.yoy ?? null
  const spendGrowth  = s.PCEC96?.yoy ?? null
  const borrowGrowth = s.REVOLSL?.yoy ?? null

  const computed = {
    incomeGrowth, spendGrowth, borrowGrowth,
    spendVsIncome: (spendGrowth != null && incomeGrowth != null) ? +(spendGrowth - incomeGrowth).toFixed(2) : null,
    retailYoY: s.RRSFS?.yoy ?? null,
    debtService: s.TDSP?.current ?? null,
    cardApr: s.TERMCBCCALLNS?.current ?? null,
    gas: s.GASREGW?.current ?? null, gasYoY: s.GASREGW?.yoy ?? null,
    savings: s.PSAVERT?.current ?? null, savingsPct: s.PSAVERT?.pctRaw ?? null,
    cardDelinq: s.DRCCLACBS?.current ?? null, cardDelinqDir: s.DRCCLACBS?.deltaYr ?? null,
    sentiment: s.UMCSENT?.current ?? null, sentimentPct: s.UMCSENT?.pctRaw ?? null,
    mechanism,
  }

  Object.values(series).forEach(x => { delete x.obs })
  const result = { series, computed, updated: Date.now() }
  console.log(`Consumer health: ${Object.keys(series).length}/${Object.keys(CONSUMER_SERIES).length} series · income ${incomeGrowth}% vs spend ${spendGrowth}% · savings ${computed.savings}%`)
  consumerCache = { data: result, ts: Date.now() }
  return result
}

/* ── Debt Market (FRED spreads + FMP basket fundamentals) ────────────────
   Credit-cycle cockpit: HY/IG option-adjusted spreads (level + percentile),
   long-history Baa−10Y, refi squeeze (HY yield vs corporate coverage), and
   the early-warning pair (SLOOS tightening + C&I delinquency).
   Micro layer: annual FMP ratios for a fixed ~30 large-cap non-financial
   basket (quarterly ratios are premium-gated; medians are robust to the
   AAPL-style null-interest-expense holes). Cached to disk — filed years
   don't change. */
let debtMarketCache = { data: null, ts: 0 }
const DEBT_MARKET_TTL = 4 * 60 * 60 * 1000
const DEBT_FMP_FILE = path.join(__dirname, 'debt-market-fmp.json')
const DEBT_FMP_TTL = 7 * 24 * 60 * 60 * 1000 // annual filings — weekly refresh is plenty

// limit ≈ observations to pull (daily series: ~250/yr)
const DEBT_FRED = {
  BAMLH0A0HYM2:      { label: 'High-Yield OAS',            freq: 'd', limit: 7600 },  // 1996→
  BAMLC0A0CM:        { label: 'Investment-Grade OAS',      freq: 'd', limit: 7600 },  // 1996→
  BAMLH0A0HYM2EY:    { label: 'HY Effective Yield',        freq: 'd', limit: 7600 },
  BAA10Y:            { label: 'Baa − 10Y Spread',          freq: 'd', limit: 10200 }, // 1986→
  DGS10:             { label: '10Y Treasury',              freq: 'd', limit: 2600 },
  FEDFUNDS:          { label: 'Fed Funds Rate',            freq: 'm', limit: 480 },
  DRTSCILM:          { label: 'SLOOS: Net % Tightening C&I', freq: 'q', limit: 200 }, // 1990→
  DRBLACBS:          { label: 'C&I Delinquency Rate',      freq: 'q', limit: 200 },  // 1987→
  BOGZ1FA106130001Q: { label: 'NF Corp Interest Paid',     freq: 'q', limit: 320 },  // Z.1, $M SAAR
  A464RC1Q027SBEA:   { label: 'NF Corp Profits (pre-tax)', freq: 'q', limit: 320 },  // BEA, $B SAAR
}

// Fixed non-financial large-cap basket (banks' coverage ratios are meaningless).
// Debt-heavy sectors (telecom, utilities) deliberately included.
const DEBT_BASKET = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'AVGO', 'ORCL',
  'UNH', 'JNJ', 'LLY', 'MRK', 'PFE',
  'XOM', 'CVX', 'COP',
  'WMT', 'PG', 'KO', 'PEP', 'COST', 'HD', 'MCD',
  'CAT', 'HON', 'UNP', 'GE', 'DE', 'BA',
  'T', 'VZ', 'CMCSA', 'DIS',
  'LIN', 'NEE', 'DUK', 'SO',
]

function loadDebtFmpCache() {
  try { if (fs.existsSync(DEBT_FMP_FILE)) return JSON.parse(fs.readFileSync(DEBT_FMP_FILE, 'utf8')) } catch {}
  return { fetchedAt: 0, byTicker: {} }
}

async function fetchDebtBasket() {
  const cache = loadDebtFmpCache()
  if (Date.now() - (cache.fetchedAt || 0) < DEBT_FMP_TTL && Object.keys(cache.byTicker || {}).length) return cache.byTicker
  console.log(`Debt market: fetching FMP ratios+key-metrics for ${DEBT_BASKET.length} tickers...`)
  const byTicker = {}
  // small batches to be polite to the rate limiter
  for (let i = 0; i < DEBT_BASKET.length; i += 6) {
    await Promise.all(DEBT_BASKET.slice(i, i + 6).map(async t => {
      try {
        const [ratiosResp, kmResp] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/ratios?symbol=${t}&limit=8&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } }),
          fetch(`https://financialmodelingprep.com/stable/key-metrics?symbol=${t}&limit=8&apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } }),
        ])
        const ratios = ratiosResp.ok ? await ratiosResp.json() : []
        const km = kmResp.ok ? await kmResp.json() : []
        if (!Array.isArray(ratios) || !ratios.length) return
        const kmByYear = {}
        if (Array.isArray(km)) for (const r of km) kmByYear[r.fiscalYear] = r
        byTicker[t] = ratios.map(r => ({
          fy: r.fiscalYear,
          coverage: (r.interestCoverageRatio && isFinite(r.interestCoverageRatio) && r.interestCoverageRatio !== 0) ? +r.interestCoverageRatio.toFixed(1) : null,
          netDebtToEbitda: kmByYear[r.fiscalYear] && isFinite(kmByYear[r.fiscalYear].netDebtToEBITDA) ? +kmByYear[r.fiscalYear].netDebtToEBITDA.toFixed(2) : null,
        }))
      } catch (e) { console.warn(`Debt basket ${t}:`, e.message) }
    }))
  }
  if (Object.keys(byTicker).length) {
    try { fs.writeFileSync(DEBT_FMP_FILE, JSON.stringify({ fetchedAt: Date.now(), byTicker }, null, 2)) } catch (e) { console.error('Debt FMP cache save:', e.message) }
    return byTicker
  }
  return cache.byTicker || {} // fetch failed — serve stale rather than nothing
}

const median = arr => {
  const a = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y)
  if (!a.length) return null
  return a.length % 2 ? a[(a.length - 1) / 2] : +((a[a.length / 2 - 1] + a[a.length / 2]) / 2).toFixed(2)
}

// Downsample a daily obs array to weekly (last observation per ISO week)
function toWeekly(obs) {
  const out = []
  let curKey = null
  for (const o of obs) {
    const dt = new Date(o.d + 'T00:00:00Z')
    const wk = `${dt.getUTCFullYear()}-${Math.floor((Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) - Date.UTC(dt.getUTCFullYear(), 0, 1)) / 604800000)}`
    if (wk === curKey) out[out.length - 1] = o
    else { out.push(o); curKey = wk }
  }
  return out
}

async function fetchDebtMarket() {
  if (debtMarketCache.data && Date.now() - debtMarketCache.ts < DEBT_MARKET_TTL) return debtMarketCache.data
  console.log('Debt market: fetching FRED batch...')

  const s = {}
  await Promise.all(Object.entries(DEBT_FRED).map(async ([id, meta]) => {
    const obs = await fetchFredSeries(id, meta.limit)
    if (obs.length) s[id] = { ...meta, obs }
  }))

  // ── Spreads: weekly HY / IG / quality spread, full-history percentiles ──
  const hyW  = s.BAMLH0A0HYM2 ? toWeekly(s.BAMLH0A0HYM2.obs) : []
  const igW  = s.BAMLC0A0CM   ? toWeekly(s.BAMLC0A0CM.obs)   : []
  const baaW = s.BAA10Y       ? toWeekly(s.BAA10Y.obs)       : []
  const igByDate = Object.fromEntries(igW.map(o => [o.d, o.v]))
  let lastIg = null
  const spreadWeekly = hyW.map(o => {
    if (igByDate[o.d] != null) lastIg = igByDate[o.d]
    return { d: o.d, hy: o.v, ig: lastIg, qs: lastIg != null ? +(o.v - lastIg).toFixed(2) : null }
  })
  const hyVals = hyW.map(o => o.v)
  const hyCur  = hyVals.length ? hyVals[hyVals.length - 1] : null
  const igCur  = igW.length ? igW[igW.length - 1].v : null
  const baaCur = baaW.length ? baaW[baaW.length - 1].v : null
  // 3-month change ≈ 13 weekly obs back
  const hy3mAgo = hyVals.length > 13 ? hyVals[hyVals.length - 14] : null
  const d3m = (hyCur != null && hy3mAgo != null) ? +(hyCur - hy3mAgo).toFixed(2) : null
  const hyPct  = pctileOf(hyVals, hyCur)
  const igPct  = pctileOf(igW.map(o => o.v), igCur)
  const baaPct = pctileOf(baaW.map(o => o.v), baaCur)

  // ── Verdict: level + percentile + momentum ──
  // NOTE: ICE BofA series on FRED are license-capped to a rolling ~3-year
  // window (count ≈ 795), so hyPct is a 3-yr percentile only. For "how tight
  // vs history" evidence we use BAA10Y (Moody's, full history to 1987).
  const pctLong = baaPct != null ? baaPct : hyPct
  let verdict = { label: 'Normal', color: '#4ade80' }
  if (hyCur != null) {
    const rising = d3m != null && d3m > 0.75
    if (hyCur >= 6)                          verdict = { label: 'Credit Stress',         color: '#ef4444' }
    else if (hyCur >= 4.5 || rising)         verdict = { label: 'Stress Building',       color: '#fbbf24' }
    else if (pctLong != null && pctLong <= 25) verdict = { label: 'Priced for Perfection', color: '#22d3ee' }
  }

  // ── Refi squeeze: HY effective yield vs macro coverage proxy ──
  // Coverage proxy = (nonfinancial pre-tax profits + interest paid) / interest paid
  // ≈ aggregate EBIT / interest. Z.1 interest is $M SAAR, BEA profits $B SAAR.
  const hyYldW = s.BAMLH0A0HYM2EY ? toWeekly(s.BAMLH0A0HYM2EY.obs) : []
  const coverage = []
  if (s.BOGZ1FA106130001Q && s.A464RC1Q027SBEA) {
    const intByQ = Object.fromEntries(s.BOGZ1FA106130001Q.obs.map(o => [o.d, o.v / 1000])) // → $B
    for (const p of s.A464RC1Q027SBEA.obs) {
      const int = intByQ[p.d]
      if (int > 0) coverage.push({ d: p.d, v: +(((p.v + int) / int)).toFixed(2) })
    }
  }
  const covCur = coverage.length ? coverage[coverage.length - 1].v : null
  const covPct = pctileOf(coverage.map(o => o.v), covCur)

  // ── Early-warning tiles ──
  const tile = (id) => {
    const t = s[id]
    if (!t || !t.obs.length) return null
    const vals = t.obs.map(o => o.v)
    const cur = vals[vals.length - 1]
    return {
      label: t.label, current: cur,
      prev: vals.length > 1 ? vals[vals.length - 2] : null,
      lastDate: t.obs[t.obs.length - 1].d,
      pct: pctileOf(vals, cur),
      spark: vals.slice(-32),
    }
  }

  // ── FMP basket: median coverage + leverage per fiscal year ──
  const byTicker = await fetchDebtBasket()
  const byYear = {}
  for (const [t, rows] of Object.entries(byTicker)) {
    for (const r of rows || []) {
      if (!r.fy) continue
      ;(byYear[r.fy] = byYear[r.fy] || { cov: [], nde: [] })
      if (r.coverage != null) byYear[r.fy].cov.push(r.coverage)
      if (r.netDebtToEbitda != null) byYear[r.fy].nde.push(r.netDebtToEbitda)
    }
  }
  const basketByYear = Object.keys(byYear).sort()
    .map(fy => ({ fy, coverage: median(byYear[fy].cov), netDebtToEbitda: median(byYear[fy].nde), n: byYear[fy].cov.length }))
    .filter(r => r.n >= 10) // partial years (few filers yet) are misleading
  const latestFy = basketByYear[basketByYear.length - 1] || null
  const basketRows = Object.entries(byTicker).map(([t, rows]) => {
    const latest = (rows || []).find(r => r.coverage != null || r.netDebtToEbitda != null)
    return latest ? { t, fy: latest.fy, coverage: latest.coverage, netDebtToEbitda: latest.netDebtToEbitda } : null
  }).filter(Boolean).sort((a, b) => (a.coverage ?? 1e9) - (b.coverage ?? 1e9))

  const data = {
    verdict: { ...verdict, hy: hyCur, hyPct, baaPct, d3m, asOf: hyW.length ? hyW[hyW.length - 1].d : null },
    spreads: {
      weekly: spreadWeekly,
      hy: { current: hyCur, pct: hyPct }, ig: { current: igCur, pct: igPct },
      qs: spreadWeekly.length ? spreadWeekly[spreadWeekly.length - 1].qs : null,
      baa: { weekly: baaW, current: baaCur, pct: baaPct, since: baaW.length ? baaW[0].d.slice(0, 4) : null },
      since: hyW.length ? hyW[0].d.slice(0, 4) : null,
    },
    squeeze: {
      hyYield: hyYldW,
      hyYieldCur: hyYldW.length ? hyYldW[hyYldW.length - 1].v : null,
      coverage, coverageCur: covCur, coveragePct: covPct,
    },
    warning: { sloos: tile('DRTSCILM'), delinq: tile('DRBLACBS') },
    rates: { fedfunds: tile('FEDFUNDS'), dgs10: tile('DGS10') },
    basket: { byYear: basketByYear, latest: latestFy, rows: basketRows, size: DEBT_BASKET.length },
    updated: new Date().toISOString(),
  }
  // Only cache when the core FRED spread series actually loaded — a rate-limit
  // blip must not pin an empty payload for the full TTL (the credit spreads
  // are the whole point of this endpoint).
  if (hyCur != null && baaCur != null) debtMarketCache = { data, ts: Date.now() }
  return data
}

/* ── Housing Replacement Cost — Tobin's Q for residential real estate ────
   Market price (Case-Shiller) vs the cost to BUILD (residential construction
   input PPI, 1986→ — same vintage as Case-Shiller, so the ratio has ~40yrs
   of history for honest percentiles). Ratio >> its long-run average means
   existing homes trade far above rebuild cost → fat homebuilder margins and
   an eventual supply response; << average means construction doesn't pencil
   → underbuilding, scarcity supports existing-home prices. */
let replCostCache = { data: null, ts: 0 }
const REPL_COST_TTL = 12 * 60 * 60 * 1000 // slow-moving monthly data

const REPL_SERIES = {
  CSUSHPINSA:    { label: 'Case-Shiller National HPI',       limit: 500 },
  WPUIP2311001:  { label: 'Residential Construction Inputs', limit: 500 },
  CES2000000003: { label: 'Construction Wages ($/hr)',       limit: 260 },
  WPU081:        { label: 'Lumber PPI',                      limit: 500 },
  MSPNHSUS:      { label: 'Median New Home Price',           limit: 500 },
}

async function fetchReplacementCost() {
  if (replCostCache.data && Date.now() - replCostCache.ts < REPL_COST_TTL) return replCostCache.data
  console.log('Replacement cost: fetching FRED batch...')
  const s = {}
  await Promise.all(Object.entries(REPL_SERIES).map(async ([id, meta]) => {
    const obs = await fetchFredSeries(id, meta.limit)
    if (obs.length) s[id] = { ...meta, obs }
  }))

  const byMonth = (id) => Object.fromEntries((s[id]?.obs || []).map(o => [o.d.slice(0, 7), o.v]))
  const yoyOf = (id) => {
    const obs = s[id]?.obs || []
    if (obs.length < 13) return null
    const cur = obs[obs.length - 1], past = obs[obs.length - 13]
    return past.v ? +(((cur.v / past.v) - 1) * 100).toFixed(1) : null
  }

  // ── Price-to-replacement-cost ratio (CS ÷ construction-input PPI) ──
  const cs = byMonth('CSUSHPINSA'), ppi = byMonth('WPUIP2311001')
  const months = Object.keys(cs).filter(m => ppi[m] > 0).sort()
  let raw = months.map(m => ({ d: `${m}-01`, v: cs[m] / ppi[m] }))
  const mean = raw.reduce((t, p) => t + p.v, 0) / (raw.length || 1)
  const ratio = raw.map(p => ({ d: p.d, v: +((p.v / mean) * 100).toFixed(1) })) // 100 = sample mean, not dollar replacement-cost parity
  const ratioCur = ratio.length ? ratio[ratio.length - 1].v : null
  const ratio1yAgo = ratio.length > 12 ? ratio[ratio.length - 13].v : null
  const ratioPct = pctileOf(ratio.map(p => p.v), ratioCur)

  let verdict = { label: 'Near Historical Middle', color: '#94a3b8' }
  if (ratioPct != null) {
    if (ratioPct >= 80)      verdict = { label: 'High Price / Input-Cost Ratio', color: '#f87171' }
    else if (ratioPct >= 60) verdict = { label: 'Above Historical Middle',     color: '#fbbf24' }
    else if (ratioPct <= 25) verdict = { label: 'Low Price / Input-Cost Ratio', color: '#22d3ee' }
  }

  // ── Indexed price-vs-cost chart (base = first month wages exist) ──
  const wage = byMonth('CES2000000003')
  const base = months.find(m => wage[m] > 0)
  const chart = []
  if (base) {
    for (const m of months.filter(m => m >= base)) {
      chart.push({
        d: `${m}-01`,
        price: +((cs[m] / cs[base]) * 100).toFixed(1),
        cost: +((ppi[m] / ppi[base]) * 100).toFixed(1),
        wage: wage[m] > 0 ? +((wage[m] / wage[base]) * 100).toFixed(1) : null,
      })
    }
  }

  const data = {
    verdict: { ...verdict, ratio: ratioCur, pct: ratioPct, chg1y: (ratioCur != null && ratio1yAgo != null) ? +(ratioCur - ratio1yAgo).toFixed(1) : null },
    ratio, ratioSince: ratio.length ? ratio[0].d.slice(0, 4) : null,
    chart, chartBase: base,
    tiles: {
      constructionInputs: { yoy: yoyOf('WPUIP2311001'), last: s.WPUIP2311001?.obs.slice(-1)[0]?.d },
      wages:              { yoy: yoyOf('CES2000000003'), cur: s.CES2000000003?.obs.slice(-1)[0]?.v },
      lumber:             { yoy: yoyOf('WPU081') },
      newHomePrice:       { yoy: yoyOf('MSPNHSUS'), cur: s.MSPNHSUS?.obs.slice(-1)[0]?.v },
    },
    updated: new Date().toISOString(),
  }
  // Don't cache a rate-limited empty batch for the full TTL
  if (ratioCur != null) replCostCache = { data, ts: Date.now() }
  return data
}

/* ── Kalecki-Levy profits decomposition — where profits COME FROM ─────────
   The accounting identity (Variant Perception / Levy Forecasting framing):
     Profits = Investment + Dividends − Household Saving − Gov Saving − RoW Saving
   Not a leading indicator — a lens: it says WHICH engine is driving margins
   (fiscal deficits and household dissaving are the big top-down drivers).
   All NIPA/Z.1 via FRED, quarterly. Signs: TGDEF is net gov SAVING (negative
   in deficit, so −gs adds to profits); RWLBACQ027S is RoW net lending(+) to
   the US ≈ RoW saving vis-à-vis the US (Z.1, $M — scaled to $B). */
let kaleckiCache = { data: null, ts: 0 }
const KALECKI_TTL = 12 * 60 * 60 * 1000

async function fetchKalecki() {
  if (kaleckiCache.data && Date.now() - kaleckiCache.ts < KALECKI_TTL) return kaleckiCache.data
  console.log('Kalecki: fetching NIPA batch...')
  const [profits, cp, div, inv, hs, gs, row, gdp] = await Promise.all([
    fetchFredSeries('A551RC1Q027SBEA', 320), // profits after tax w/ IVA & CCAdj
    fetchFredSeries('CP', 320),              // profits after tax w/o IVA & CCAdj (fallback)
    fetchFredSeries('DIVIDEND', 320),        // net dividends
    fetchFredSeries('A557RC1Q027SBEA', 320), // net private domestic investment
    fetchFredSeries('PSAVE', 320),           // personal saving
    fetchFredSeries('TGDEF', 320),           // net government saving (total)
    fetchFredSeries('RWLBACQ027S', 320),     // RoW net lending (+) / borrowing (−), $M
    fetchFredSeries('GDP', 320),
  ])
  const m = arr => Object.fromEntries(arr.map(o => [o.d, o.v]))
  const P = m(profits.length ? profits : cp), D = m(div), I = m(inv), H = m(hs), G = m(gs), R = m(row), Y = m(gdp)
  const dates = Object.keys(Y).filter(d => P[d] != null && D[d] != null && I[d] != null && H[d] != null && G[d] != null && R[d] != null).sort()
  const q = dates.map(d => {
    const gdpV = Y[d]
    const rowB = R[d] / 1000 // $M → $B
    const invC = +(I[d] / gdpV * 100).toFixed(2)
    const divC = +(D[d] / gdpV * 100).toFixed(2)
    const hhC = +(-H[d] / gdpV * 100).toFixed(2)   // household DISsaving adds
    const govC = +(-G[d] / gdpV * 100).toFixed(2)  // deficit adds
    const rowC = +(-rowB / gdpV * 100).toFixed(2)  // RoW saving subtracts
    const implied = +(invC + divC + hhC + govC + rowC).toFixed(2)
    const actual = +(P[d] / gdpV * 100).toFixed(2)
    return { d, inv: invC, div: divC, hh: hhC, gov: govC, row: rowC, implied, actual, resid: +(actual - implied).toFixed(2) }
  })
  if (q.length < 40) { return { error: 'insufficient data' } }

  // identity health: |median residual| should be small relative to profits
  const resids = q.slice(-40).map(r => Math.abs(r.resid)).sort((a, b) => a - b)
  const medResid = resids[Math.floor(resids.length / 2)]

  // annual averages for the long chart
  const byYear = {}
  for (const r of q) {
    const y = r.d.slice(0, 4)
    ;(byYear[y] = byYear[y] || []).push(r)
  }
  const annual = Object.entries(byYear).map(([y, rows]) => {
    const avg = k => +(rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(2)
    return { d: y, inv: avg('inv'), div: avg('div'), hh: avg('hh'), gov: avg('gov'), row: avg('row'), actual: avg('actual') }
  }).filter(r => +r.d >= 1960)

  const last = q[q.length - 1], yrAgo = q[q.length - 5] || q[0]
  // VP's "top-down drivers": gov + household. 4-quarter impulse in pp of GDP.
  const impulse = +((last.gov + last.hh) - (yrAgo.gov + yrAgo.hh)).toFixed(2)
  const totalChg = +(last.actual - yrAgo.actual).toFixed(2)
  const actuals = q.map(r => r.actual)
  const pct = pctileOf(actuals, last.actual)

  let verdict
  if (impulse >= 0.5) verdict = { label: 'Profit Tailwind — Fiscal & Household Engines Pushing', color: '#4ade80' }
  else if (impulse <= -0.5) verdict = { label: 'Profit Headwind — The Top-Down Engines Are Reversing', color: '#ef4444' }
  else verdict = { label: 'Profit Engines Neutral', color: '#fbbf24' }
  // driver-mix note
  const fiscalDriven = last.gov > last.inv
  verdict.note = `Corporate profits are ${last.actual.toFixed(1)}% of GDP (p${pct} since ${q[0].d.slice(0, 4)}). Over the last year the fiscal+household engines ${impulse >= 0 ? 'added' : 'removed'} ${Math.abs(impulse).toFixed(1)}pp of GDP ${impulse >= 0 ? 'to' : 'from'} the profit equation (total profit share ${totalChg >= 0 ? '+' : ''}${totalChg}pp). ${fiscalDriven ? 'The single largest support is the GOVERNMENT DEFICIT — profits are being underwritten in Washington, which is powerful but politically fragile.' : 'Private investment is the largest support — the higher-quality, more durable kind of profit growth.'}`

  const data = {
    verdict, latest: last, yrAgo, impulse, pct,
    quarterly: q.slice(-16), annual,
    identity: { medianResidual: medResid, note: 'implied vs actual gap = NIPA statistical discrepancy + minor omitted terms' },
    updated: new Date().toISOString(),
  }
  if (last && annual.length > 20) kaleckiCache = { data, ts: Date.now() }
  return data
}

/* ── Bank Credit — the lender's view of the credit cycle ─────────────────
   Eisman's lens: banks see credit deterioration first and confess it in
   loan growth, charge-offs, and provisions. Aggregate side is rock-solid
   FRED data: the Fed's weekly H.8 release IS the combined loan book of all
   US commercial banks, plus quarterly charge-off/delinquency rates by loan
   type (with a top-100 vs small-bank split — where the stress hides).
   Per-bank big-4 data is a curated client-side table: FMP's as-reported
   bank statements proved untrustworthy (BAC missing its loans line, Citi
   "total assets" 6x too small — partial XBRL flattening). */
let bankCreditCache = { data: null, ts: 0 }
const BANK_CREDIT_TTL = 6 * 60 * 60 * 1000

const BANK_LOAN_SERIES = {
  TOTLL:          { label: 'Total Loans & Leases', freq: 'w', limit: 1600, color: '#818cf8' },
  BUSLOANS:       { label: 'Commercial & Industrial', freq: 'm', limit: 500, color: '#10B981' },
  CREACBW027SBOG: { label: 'Commercial Real Estate', freq: 'w', limit: 1600, color: '#F59E0B' },
  CCLACBW027SBOG: { label: 'Credit Cards', freq: 'w', limit: 1600, color: '#EC4899' },
  CLSACBW027SBOG: { label: 'Consumer (total)', freq: 'w', limit: 1600, color: '#22d3ee' },
}
const BANK_LOSS_SERIES = {
  CORCCACBS:     { label: 'Credit Cards',        group: 'chargeoff', color: '#EC4899' },
  CORBLACBS:     { label: 'C&I (Business)',      group: 'chargeoff', color: '#10B981' },
  CORCREXFACBS:  { label: 'Commercial RE',       group: 'chargeoff', color: '#F59E0B' },
  CORSFRMACBS:   { label: 'Residential Mortgage', group: 'chargeoff', color: '#818cf8' },
  DRCCLACBS:     { label: 'Credit Cards',        group: 'delinq', color: '#EC4899' },
  DRBLACBS:      { label: 'C&I (Business)',      group: 'delinq', color: '#10B981' },
  DRCRELEXFACBS: { label: 'Commercial RE',       group: 'delinq', color: '#F59E0B' },
  DRSFRMACBS:    { label: 'Residential Mortgage', group: 'delinq', color: '#818cf8' },
  DRCLACBS:      { label: 'Consumer (all)',      group: 'delinq', color: '#22d3ee' },
  // Senior Loan Officer survey: net % of banks tightening standards. Quarterly;
  // leads delinquencies by two to four quarters.
  DRTSCILM:      { label: 'C&I — large & mid firms', group: 'standards', color: '#10B981' },
  DRTSCLCC:      { label: 'Credit cards',        group: 'standards', color: '#EC4899' },
  CORCCT100S:    { label: 'Cards — Top 100 banks', group: 'split', color: '#4ade80' },
  CORCCOBS:      { label: 'Cards — Small banks',   group: 'split', color: '#f87171' },
  CORBLT100S:    { label: 'C&I — Top 100 banks',   group: 'split2', color: '#4ade80' },
  CORBLOBS:      { label: 'C&I — Small banks',     group: 'split2', color: '#f87171' },
}

async function fetchBankCredit() {
  if (bankCreditCache.data && Date.now() - bankCreditCache.ts < BANK_CREDIT_TTL) return bankCreditCache.data
  console.log('Bank credit: fetching FRED batch...')
  const s = {}
  await Promise.all([...Object.entries(BANK_LOAN_SERIES), ...Object.entries(BANK_LOSS_SERIES)].map(async ([id, meta]) => {
    const obs = await fetchFredSeries(id, meta.limit || 200)
    if (obs.length) s[id] = { ...meta, obs }
  }))

  // Loan growth YoY per series (weekly lag 52, monthly lag 12)
  const loans = {}
  for (const [id, meta] of Object.entries(BANK_LOAN_SERIES)) {
    const t = s[id]
    if (!t) continue
    const lag = meta.freq === 'w' ? 52 : 12
    const yoy = []
    for (let i = lag; i < t.obs.length; i++) {
      const past = t.obs[i - lag].v
      if (past) yoy.push({ d: t.obs[i].d, v: +(((t.obs[i].v / past) - 1) * 100).toFixed(2) })
    }
    const cur = yoy.length ? yoy[yoy.length - 1].v : null
    loans[id] = {
      label: meta.label, color: meta.color,
      level: t.obs[t.obs.length - 1].v, lastDate: t.obs[t.obs.length - 1].d,
      yoy: cur, yoyPct: pctileOf(yoy.map(p => p.v), cur),
      // thin weekly YoY series to ~monthly for the chart payload
      series: yoy.filter((_, i) => meta.freq === 'w' ? i % 4 === 0 : true).slice(-320),
    }
  }

  // Loss series: raw quarterly rates + percentile
  const losses = {}
  for (const [id, meta] of Object.entries(BANK_LOSS_SERIES)) {
    const t = s[id]
    if (!t) continue
    const vals = t.obs.map(o => o.v)
    const cur = vals[vals.length - 1]
    const yrAgo = vals.length > 4 ? vals[vals.length - 5] : null
    losses[id] = {
      label: meta.label, group: meta.group, color: meta.color,
      current: cur, chg1y: yrAgo != null ? +(cur - yrAgo).toFixed(2) : null,
      pct: pctileOf(vals, cur), lastDate: t.obs[t.obs.length - 1].d,
      series: t.obs.slice(-160),
    }
  }

  // ── Verdict: loan growth (impulse) × loss direction ──
  const g = loans.TOTLL?.yoy
  const cardChg = losses.CORCCACBS?.chg1y
  const lossesRising = (cardChg ?? 0) > 0.25 || (losses.CORBLACBS?.chg1y ?? 0) > 0.15
  let verdict
  if (g == null) verdict = { label: 'Data unavailable', color: '#64748b', note: '' }
  else if (g < 0) verdict = { label: 'Contraction — Credit Crunch', color: '#ef4444', note: 'The aggregate loan book is shrinking — banks are pulling credit. Historically one of the most reliable recession signals there is.' }
  else if (g < 3 && lossesRising) verdict = { label: 'Late Cycle — Tightening Into Losses', color: '#f97316', note: 'Loan growth is stalling while charge-offs climb — banks are seeing losses and quietly closing the window. Watch C&I growth for the turn negative.' }
  else if (lossesRising) verdict = { label: 'Mid-to-Late Cycle — Losses Normalizing Up', color: '#fbbf24', note: 'Credit is still expanding but loss rates are climbing off their lows — the cycle is aging. The split to watch: small-bank vs big-bank charge-offs.' }
  else verdict = { label: 'Expansion — Credit Flowing', color: '#4ade80', note: 'Loan books growing with stable-to-falling losses — the benign phase of the cycle.' }

  const data = { verdict, loans, losses, updated: new Date().toISOString() }
  // don't cache a rate-limited empty batch
  if (g != null && losses.CORCCACBS) bankCreditCache = { data, ts: Date.now() }
  return data
}

/* ── Housing Health — the synthesis layer for the real-estate page ────────
   Derived gauges, not levels: mortgage-payment share of median income
   (affordability, quarterly back to 1984), months' supply percentile, and
   the price-to-rebuild percentile (reuses fetchReplacementCost). The client
   adds Zillow-only gauges (price-to-rent, metro breadth) it already holds. */
let housingHealthCache = { data: null, ts: 0 }
const HOUSING_HEALTH_TTL = 12 * 60 * 60 * 1000

async function fetchHousingHealth() {
  if (housingHealthCache.data && Date.now() - housingHealthCache.ts < HOUSING_HEALTH_TTL) return housingHealthCache.data
  console.log('Housing health: fetching FRED batch...')
  const [mort, msp, inc, msacsr, repl] = await Promise.all([
    fetchFredSeries('MORTGAGE30US', 2900),   // weekly 30yr rate, 1971→
    fetchFredSeries('MSPUS', 260),           // quarterly median sales price, 1963→
    fetchFredSeries('MEHOINUSA646N', 60),    // annual median household income (nominal)
    fetchFredSeries('MSACSR', 760),          // monthly months' supply of new houses
    fetchReplacementCost().catch(() => null),
  ])

  // ── Affordability: P&I on the median home (80% LTV, 30yr) ÷ median income ──
  const asOf = (arr, d) => { let r = null; for (const p of arr) { if (p.d <= d) r = p; else break } return r }
  const affordSeries = []
  const incomeLast = inc.length ? inc[inc.length - 1] : null
  for (const q of msp) {
    const rate = asOf(mort, q.d)
    // income is annual and lags ~18mo — forward-fill the last print
    const income = asOf(inc, q.d) || (incomeLast && q.d > incomeLast.d ? incomeLast : null)
    if (!rate || !income || !income.v) continue
    const P = q.v * 0.8, r = rate.v / 1200
    const pay = P * r / (1 - Math.pow(1 + r, -360))
    affordSeries.push({ d: q.d, v: +((pay / (income.v / 12)) * 100).toFixed(1), pay: Math.round(pay) })
  }
  const affordVals = affordSeries.map(p => p.v)
  const affordCur = affordVals.length ? affordVals[affordVals.length - 1] : null
  const affordPct = pctileOf(affordVals, affordCur)
  const lastAfford = affordSeries[affordSeries.length - 1] || null
  // income a buyer needs at the classic 28% front-end DTI
  const incomeNeeded = lastAfford ? Math.round(lastAfford.pay * 12 / 0.28) : null
  // ── What would have to change: the price move (at today's rate) or the mortgage rate (at
  // today's price) that brings the payment share back to its long-run median, and to the
  // classic 28% front-end limit. Payment is linear in price, so the price answer is a ratio;
  // the rate answer is solved by bisection on the annuity formula.
  const sortedAfford = [...affordVals].sort((a, b) => a - b)
  const affordMedian = sortedAfford.length ? sortedAfford[Math.floor(sortedAfford.length / 2)] : null
  const lastRate = mort.length ? mort[mort.length - 1].v : null
  const lastIncome = incomeLast?.v ?? null
  const lastPrice = msp.length ? msp[msp.length - 1].v : null
  const payAt = (price, rate) => { const P = price * 0.8, r = rate / 1200; return P * r / (1 - Math.pow(1 + r, -360)) }
  const solveRate = (price, targetPay) => { let lo = 0.25, hi = 20; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (payAt(price, mid) > targetPay) hi = mid; else lo = mid } return +((lo + hi) / 2).toFixed(2) }
  const whatIfTo = target => {
    if (!(target > 0) || !(lastIncome > 0) || !(lastPrice > 0) || !(lastRate > 0) || !(affordCur > 0)) return null
    const targetPay = (target / 100) * lastIncome / 12
    return { target, priceChg: +(((target / affordCur) - 1) * 100).toFixed(1), rate: solveRate(lastPrice, targetPay), payment: Math.round(targetPay) }
  }
  const whatIf = { toMedian: whatIfTo(affordMedian), to28: whatIfTo(28) }

  // ── Supply: months' supply with full-history percentile ──
  const msVals = msacsr.map(o => o.v)
  const msCur = msVals.length ? msVals[msVals.length - 1] : null
  const msPct = pctileOf(msVals, msCur)

  // ── Valuation: price-to-rebuild percentile from the replacement-cost calc ──
  const replPct = repl?.verdict?.pct ?? null
  const replRatio = repl?.verdict?.ratio ?? null

  // ── Lights + one-line regime verdict ──
  const light = (pct, hiBad) => pct == null ? { color: '#64748b', label: 'n/a' }
    : (hiBad ? pct : 100 - pct) >= 75 ? { color: '#ef4444', label: 'red' }
    : (hiBad ? pct : 100 - pct) >= 55 ? { color: '#fbbf24', label: 'amber' }
    : { color: '#4ade80', label: 'green' }
  const affordLight = light(affordPct, true)          // high payment share = bad
  const supplyLight = light(msPct, true)              // high months' supply = loose = price risk
  const valLight = light(replPct, true)               // rich vs rebuild = stretched

  const stretched = affordLight.label === 'red' || affordLight.label === 'amber'
  const tightSupply = msCur != null && msCur < 5
  let verdict
  if (stretched && tightSupply) verdict = { label: 'Frozen: Unaffordable but Undersupplied', color: '#fbbf24', note: 'Payments price out buyers, but scarce inventory holds prices up — low transactions, sideways prices. Watch supply: if months’ supply climbs past ~6 while affordability stays stretched, prices lose their floor.' }
  else if (stretched && !tightSupply) verdict = { label: 'Vulnerable: Expensive and Loosening', color: '#ef4444', note: 'Stretched affordability WITH rising supply is the pre-correction setup — sellers eventually meet the market.' }
  else if (!stretched && tightSupply) verdict = { label: 'Healthy Demand, Tight Supply', color: '#4ade80', note: 'Affordable payments and scarce inventory — the constructive regime for prices.' }
  else if (valLight.label === 'red' || (msPct != null && msPct >= 85)) verdict = { label: 'Buyer’s Market — Sellers Under Pressure', color: '#22d3ee', note: 'Payments are back to historically normal, but supply is heavy and prices still sit rich vs rebuild cost — the adjustment is running through price, not payment. Favorable for patient buyers; a headwind for sellers and builders with inventory.' }
  else verdict = { label: 'Buyer’s Market', color: '#22d3ee', note: 'Affordable and well-supplied — favorable entry conditions, soft price momentum.' }

  const data = {
    verdict,
    afford: {
      series: affordSeries, current: affordCur, pct: affordPct, light: affordLight,
      payment: lastAfford?.pay ?? null, incomeNeeded, median: affordMedian, income: lastIncome, whatIf,
      medianPrice: msp.length ? msp[msp.length - 1].v : null,
      rate: mort.length ? mort[mort.length - 1].v : null,
      incomeAsOf: incomeLast?.d?.slice(0, 4) ?? null,
      since: affordSeries.length ? affordSeries[0].d.slice(0, 4) : null,
    },
    supply: { current: msCur, pct: msPct, light: supplyLight, series: msacsr.slice(-160), lastDate: msacsr.length ? msacsr[msacsr.length - 1].d : null },
    valuation: { ratio: replRatio, pct: replPct, light: valLight },
    updated: new Date().toISOString(),
  }
  // Only cache complete batches — a FRED rate-limit blip (429 → empty series)
  // must not pin a degraded payload for the full TTL.
  if (affordCur != null && msCur != null) housingHealthCache = { data, ts: Date.now() }
  return data
}

/* ── Global Liquidity & Debt (FRED + FX conversion) ──────────────────────
   One endpoint for the "how much cash is in the world, where is it, and who
   owes what to whom" page. Everything normalized to billions of USD.
   Net Liquidity = Fed balance sheet − reverse repo − Treasury General Account
   (the metric traders watch: dollars actually available to markets). */
let liquidityCache = { data: null, ts: 0 }
const LIQUIDITY_TTL = 4 * 60 * 60 * 1000

// scale → multiply raw FRED value by this to get billions USD (fx applied separately)
const LIQ_SERIES = {
  WALCL:           { label: 'Fed Balance Sheet',            scale: 1e-3, limit: 530,  freq: 'W' },
  RRPONTSYD:       { label: 'Reverse Repo (RRP)',           scale: 1,    limit: 1300, freq: 'D' },
  WTREGEN:         { label: 'Treasury General Account',     scale: 1e-3, limit: 530,  freq: 'W' },
  WRESBAL:         { label: 'Bank Reserves',                scale: 1e-3, limit: 530,  freq: 'W' },
  M2SL:            { label: 'M2 Money Supply',              scale: 1,    limit: 400,  freq: 'M' },
  CURRCIR:         { label: 'Currency in Circulation',      scale: 1,    limit: 400,  freq: 'M' },
  ECBASSETSW:      { label: 'ECB Balance Sheet',            scale: 1e-3, limit: 530,  freq: 'W', fx: 'EUR' },
  JPNASSETS:       { label: 'BOJ Balance Sheet',            scale: 0.1,  limit: 400,  freq: 'M', fx: 'JPY' },
  DTWEXBGS:        { label: 'Broad Dollar Index',           scale: 1,    limit: 1300, freq: 'D' },
  GFDEBTN:         { label: 'Federal Debt Total',           scale: 1e-3, limit: 220,  freq: 'Q' },
  GFDEGDQ188S:     { label: 'Federal Debt to GDP',          scale: 1,    limit: 220,  freq: 'Q' },
  A091RC1Q027SBEA: { label: 'Federal Interest Payments',    scale: 1,    limit: 220,  freq: 'Q' },
  FDHBFIN:         { label: 'Debt Held by Foreigners',      scale: 1,    limit: 220,  freq: 'Q' },
  FDHBFRBN:        { label: 'Debt Held by Federal Reserve', scale: 1,    limit: 220,  freq: 'Q' },
  FDHBATN:         { label: 'Debt Held by Agencies/Trusts', scale: 1e-3, limit: 220,  freq: 'Q' },
  CMDEBT:          { label: 'Household Debt',               scale: 1e-3, limit: 220,  freq: 'Q' },
  BCNSDODNS:       { label: 'Corporate Debt (Nonfin)',      scale: 1e-3, limit: 220,  freq: 'Q' },
}

async function fetchGlobalLiquidity() {
  if (liquidityCache.data && Date.now() - liquidityCache.ts < LIQUIDITY_TTL) return liquidityCache.data
  console.log('Global liquidity: fetching FRED series + FX...')

  // FX for converting ECB (EUR) and BOJ (JPY) balance sheets to USD
  const [eurQ, jpyQ] = await Promise.all([
    fetchYahooQuote('EURUSD=X'),
    fetchYahooQuote('JPY=X'),       // USDJPY
  ])
  const eurUsd = eurQ?.price || 1.08
  const usdJpy = jpyQ?.price || 150

  const series = {}
  await Promise.all(Object.entries(LIQ_SERIES).map(async ([id, meta]) => {
    try {
      const obs = await fetchFredSeries(id, meta.limit)
      if (!obs.length) return
      const fxMult = meta.fx === 'EUR' ? eurUsd : meta.fx === 'JPY' ? (1 / usdJpy) : 1
      const hist = obs.map(o => ({ d: o.d, v: +(o.v * meta.scale * fxMult).toFixed(2) }))
      const latest = hist[hist.length - 1]
      const yoyLag = meta.freq === 'Q' ? 4 : meta.freq === 'M' ? 12 : meta.freq === 'W' ? 52 : 260
      const prior = hist.length > yoyLag ? hist[hist.length - 1 - yoyLag] : null
      series[id] = {
        id, label: meta.label, freq: meta.freq,
        current: latest.v, lastDate: latest.d,
        yoy: prior && prior.v ? +(((latest.v - prior.v) / Math.abs(prior.v)) * 100).toFixed(2) : null,
        history: hist,
      }
    } catch (e) { console.warn(`Liquidity FRED ${id}:`, e.message) }
  }))

  // Net Liquidity = WALCL − RRP − TGA, computed on WALCL's weekly dates with
  // nearest-prior matching for the daily RRP series.
  let netLiquidity = []
  if (series.WALCL && series.WTREGEN && series.RRPONTSYD) {
    const tgaMap = new Map(series.WTREGEN.history.map(p => [p.d, p.v]))
    const rrp = series.RRPONTSYD.history
    let ri = 0
    netLiquidity = series.WALCL.history.map(p => {
      while (ri + 1 < rrp.length && rrp[ri + 1].d <= p.d) ri++
      const rrpV = rrp[ri] && rrp[ri].d <= p.d ? rrp[ri].v : 0
      const tgaV = tgaMap.get(p.d)
      if (tgaV == null) return null
      return { d: p.d, v: +(p.v - rrpV - tgaV).toFixed(2) }
    }).filter(Boolean)
  }

  // Debt holders breakdown (latest common data)
  let holders = null
  if (series.GFDEBTN && series.FDHBFIN && series.FDHBFRBN && series.FDHBATN) {
    const total = series.GFDEBTN.current
    const foreign = series.FDHBFIN.current
    const fed = series.FDHBFRBN.current
    const intragov = series.FDHBATN.current
    holders = {
      total,
      asOf: series.GFDEBTN.lastDate,
      breakdown: [
        { name: 'Foreign Investors',        value: foreign,                                  color: '#3B82F6' },
        { name: 'Federal Reserve',          value: fed,                                      color: '#E8553A' },
        { name: 'US Gov Trust Funds',       value: intragov,                                 color: '#8B5CF6' },
        { name: 'US Private (banks, funds, households)', value: +(total - foreign - fed - intragov).toFixed(0), color: '#10B981' },
      ],
    }
  }

  const result = {
    series, netLiquidity, holders,
    fx: { eurUsd, usdJpy },
    updated: Date.now(),
  }
  console.log(`Global liquidity: ${Object.keys(series).length}/${Object.keys(LIQ_SERIES).length} series, netLiq points: ${netLiquidity.length}`)
  liquidityCache = { data: result, ts: Date.now() }
  return result
}

/* ── Hyperscaler AI capex tracker (FMP quarterly cash flow) ──────────────
   Pulls quarterly capex for the major hyperscaler builders. We apply a
   per-company "AI share %" assumption (configurable client-side) to estimate
   AI-specific capex — the closest you can get without earnings-call NLP. The
   raw company numbers are exact; the AI carve-out is an interpretation. */
const HYPERSCALER_CAPEX_FILE = path.join(__dirname, 'hyperscaler-capex.json')
let hyperscalerCapexCache = { data: null, ts: 0 }
const HYPERSCALER_CAPEX_TTL = 12 * 60 * 60 * 1000 // 12-hour cache (quarterly data changes slowly)

const HYPERSCALERS = [
  { symbol: 'MSFT',  name: 'Microsoft', color: '#00A4EF' },
  { symbol: 'GOOGL', name: 'Alphabet',  color: '#4285F4' },
  { symbol: 'META',  name: 'Meta',      color: '#1877F2' },
  { symbol: 'AMZN',  name: 'Amazon',    color: '#FF9900' },
  { symbol: 'ORCL',  name: 'Oracle',    color: '#F80000' },
]

function loadHyperscalerCapex() {
  try {
    if (fs.existsSync(HYPERSCALER_CAPEX_FILE)) return JSON.parse(fs.readFileSync(HYPERSCALER_CAPEX_FILE, 'utf8'))
  } catch {}
  return { companies: {}, updated: 0 }
}
function saveHyperscalerCapex(data) {
  try { fs.writeFileSync(HYPERSCALER_CAPEX_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save hyperscaler capex:', e.message) }
}

async function fetchHyperscalerQuarterly(symbol, limit = 20) {
  try {
    const resp = await fetch(
      `https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${symbol}&period=quarter&limit=${limit}&apikey=${FMP_KEY}`,
      { headers: { 'User-Agent': UA } }
    )
    const data = await resp.json()
    if (!Array.isArray(data)) return []
    return data.map(q => ({
      date: q.date,                                                    // "2026-03-31"
      fiscalYear: q.fiscalYear,
      period: q.period,                                                // "Q3"
      // FMP returns negative numbers for cash outflows; take absolute
      capex: Math.abs(q.capitalExpenditure || q.investmentsInPropertyPlantAndEquipment || 0),
      operatingCashFlow: q.netCashProvidedByOperatingActivities || 0,
    })).sort((a, b) => a.date.localeCompare(b.date))
  } catch (e) {
    console.warn(`Hyperscaler ${symbol}:`, e.message)
    return []
  }
}

async function getHyperscalerCapex() {
  if (hyperscalerCapexCache.data && Date.now() - hyperscalerCapexCache.ts < HYPERSCALER_CAPEX_TTL) return hyperscalerCapexCache.data

  console.log('Hyperscaler capex: fetching quarterly cash flows...')
  const companies = {}
  // Sequential to avoid hammering FMP
  for (const hs of HYPERSCALERS) {
    const quarters = await fetchHyperscalerQuarterly(hs.symbol, 20)
    if (quarters.length) {
      companies[hs.symbol] = {
        symbol: hs.symbol,
        name: hs.name,
        color: hs.color,
        quarters,
      }
    }
  }

  // If FMP completely failed, fall back to last archive
  if (Object.keys(companies).length === 0) {
    console.warn('Hyperscaler capex: FMP returned no data — serving archive')
    const archive = loadHyperscalerCapex()
    if (archive.companies && Object.keys(archive.companies).length) {
      const result = { ...archive, source: 'archive-only', updated: Date.now() }
      hyperscalerCapexCache = { data: result, ts: Date.now() }
      return result
    }
  }

  const result = { companies, source: 'live', updated: Date.now() }
  saveHyperscalerCapex(result)
  const totalQuarters = Object.values(companies).reduce((s, c) => s + c.quarters.length, 0)
  console.log(`Hyperscaler capex: ${Object.keys(companies).length} companies, ${totalQuarters} total quarters`)
  hyperscalerCapexCache = { data: result, ts: Date.now() }
  return result
}

/* ── AI SDK Downloads (PyPI + npm) — best proxy for paid-API token demand ──
   Every commercial AI app installs an SDK before it generates a single token.
   So SDK install counts are a leading indicator of paid-API token volume across
   the major providers. PyPI exposes ~6 months of daily history out of the box;
   npm exposes 30 days per call but we accumulate longer windows via daily
   snapshots to disk. */
const SDK_DOWNLOADS_FILE = path.join(__dirname, 'sdk-downloads.json')
let sdkDownloadsCache = { data: null, ts: 0 }
const SDK_DOWNLOADS_TTL = 6 * 60 * 60 * 1000 // 6 hours

const PYPI_PACKAGES = [
  { id: 'openai',              label: 'OpenAI',           provider: 'OpenAI',    color: '#10B981' },
  { id: 'anthropic',           label: 'Anthropic',        provider: 'Anthropic', color: '#E8553A' },
  { id: 'google-genai',        label: 'Google (new)',     provider: 'Google',    color: '#3B82F6' },
  { id: 'google-generativeai', label: 'Google (legacy)',  provider: 'Google',    color: '#60a5fa' },
  { id: 'cohere',              label: 'Cohere',           provider: 'Cohere',    color: '#EC4899' },
  { id: 'mistralai',           label: 'Mistral',          provider: 'Mistral',   color: '#F59E0B' },
  { id: 'groq',                label: 'Groq',             provider: 'Groq',      color: '#F97316' },
  { id: 'together',            label: 'Together AI',      provider: 'Together',  color: '#8B5CF6' },
  { id: 'langchain',           label: 'LangChain',        provider: 'Framework', color: '#6366F1' },
  { id: 'litellm',             label: 'LiteLLM',          provider: 'Framework', color: '#a78bfa' },
  { id: 'llama-index',         label: 'LlamaIndex',       provider: 'Framework', color: '#818cf8' },
]
const NPM_PACKAGES = [
  { id: 'openai',                label: 'OpenAI',         provider: 'OpenAI',    color: '#10B981' },
  { id: '@anthropic-ai/sdk',     label: 'Anthropic',      provider: 'Anthropic', color: '#E8553A' },
  { id: '@google/genai',         label: 'Google (new)',   provider: 'Google',    color: '#3B82F6' },
  { id: '@google/generative-ai', label: 'Google (legacy)',provider: 'Google',    color: '#60a5fa' },
  { id: 'cohere-ai',             label: 'Cohere',         provider: 'Cohere',    color: '#EC4899' },
  { id: '@mistralai/mistralai',  label: 'Mistral',        provider: 'Mistral',   color: '#F59E0B' },
  { id: 'groq-sdk',              label: 'Groq',           provider: 'Groq',      color: '#F97316' },
  { id: 'langchain',             label: 'LangChain',      provider: 'Framework', color: '#6366F1' },
  { id: 'ai',                    label: 'Vercel AI SDK',  provider: 'Framework', color: '#a78bfa' },
  { id: 'llamaindex',            label: 'LlamaIndex',     provider: 'Framework', color: '#818cf8' },
]

// Agent stack — packages installed specifically to do AGENTIC work. Their
// install curves are the cleanest public read on agent-ecosystem adoption.
const AGENT_PYPI = [
  { id: 'mcp',           label: 'MCP (Python)',   provider: 'MCP',       color: '#E8553A' },
  { id: 'langgraph',     label: 'LangGraph',      provider: 'Framework', color: '#6366F1' },
  { id: 'crewai',        label: 'CrewAI',         provider: 'Agent',     color: '#22d3ee' },
  { id: 'openai-agents', label: 'OpenAI Agents',  provider: 'OpenAI',    color: '#10B981' },
  { id: 'aider-chat',    label: 'Aider',          provider: 'Agent',     color: '#f472b6' },
  { id: 'autogen-agentchat', label: 'AutoGen',    provider: 'Agent',     color: '#a78bfa' },
]
const AGENT_NPM = [
  { id: '@modelcontextprotocol/sdk', label: 'MCP SDK',      provider: 'MCP',       color: '#E8553A' },
  { id: '@openai/agents',            label: 'OpenAI Agents',provider: 'OpenAI',    color: '#10B981' },
  { id: '@langchain/langgraph',      label: 'LangGraph',    provider: 'Framework', color: '#6366F1' },
]

// Inference-server container pulls — nobody pulls vLLM except to SERVE tokens in
// production, so this tracks self-hosted serving capacity being stood up.
// Docker Hub exposes only cumulative pull_count, so we snapshot daily and derive
// a rate from the deltas (like GitHub stars).
const DOCKER_IMAGES = [
  { id: 'vllm/vllm-openai', label: 'vLLM',   color: '#F59E0B' },
  { id: 'ollama/ollama',    label: 'Ollama', color: '#8B5CF6' },
]
async function fetchDockerPull(repo) {
  try {
    const resp = await fetch(`https://hub.docker.com/v2/repositories/${repo}/`, { headers: { 'User-Agent': UA } })
    if (!resp.ok) return null
    const j = await resp.json()
    return typeof j.pull_count === 'number' ? j.pull_count : null
  } catch { return null }
}

function loadSdkDownloads() {
  try {
    if (fs.existsSync(SDK_DOWNLOADS_FILE)) return JSON.parse(fs.readFileSync(SDK_DOWNLOADS_FILE, 'utf8'))
  } catch {}
  return { series: {} }
}
function saveSdkDownloads(data) {
  try { fs.writeFileSync(SDK_DOWNLOADS_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save SDK downloads:', e.message) }
}

// PyPI: returns daily downloads (without_mirrors) for ~last 180 days
async function fetchPyPiDownloads(pkg) {
  try {
    const resp = await fetch(`https://pypistats.org/api/packages/${pkg}/overall`, { headers: { 'User-Agent': UA } })
    if (!resp.ok) return []
    const json = await resp.json()
    return (json.data || [])
      .filter(d => d.category === 'without_mirrors')
      .map(d => ({ date: d.date, downloads: d.downloads || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch (e) {
    console.warn(`PyPI ${pkg}:`, e.message)
    return []
  }
}

// npm: returns daily downloads for any date range. We fetch a wide window.
// Note: npm's API reports today and sometimes yesterday with downloads=0 until
// the tally finishes processing. Drop trailing zeros so the chart doesn't dip.
async function fetchNpmDownloads(pkg, days = 365) {
  try {
    const end = new Date()
    const start = new Date(end.getTime() - days * 86400000)
    const fmt = d => d.toISOString().slice(0, 10)
    // npm caps single request to 540 days; chunk if needed
    const url = `https://api.npmjs.org/downloads/range/${fmt(start)}:${fmt(end)}/${encodeURIComponent(pkg)}`
    const resp = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!resp.ok) return []
    const json = await resp.json()
    const rows = (json.downloads || [])
      .map(d => ({ date: d.day, downloads: d.downloads || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date))
    // Trim trailing zero days (npm hasn't finished tallying yet)
    while (rows.length && rows[rows.length - 1].downloads === 0) rows.pop()
    return rows
  } catch (e) {
    console.warn(`npm ${pkg}:`, e.message)
    return []
  }
}

// Merge a fresh series into the archive, preferring the more-complete (longer)
// run for any given date. Both sources give "complete" daily numbers once the
// day is closed, so this is mostly a union — but if we ever extend history
// later, we don't want a shorter fresh fetch to truncate the archive.
function mergeSeries(archive, fresh) {
  const byDate = new Map()
  for (const p of archive || []) byDate.set(p.date, p.downloads)
  for (const p of fresh || [])   byDate.set(p.date, p.downloads)  // fresh wins on conflict
  const merged = Array.from(byDate.entries()).map(([date, downloads]) => ({ date, downloads }))
  merged.sort((a, b) => a.date.localeCompare(b.date))
  return merged
}

async function getSdkDownloads() {
  if (sdkDownloadsCache.data && Date.now() - sdkDownloadsCache.ts < SDK_DOWNLOADS_TTL) return sdkDownloadsCache.data

  console.log('SDK downloads: fetching PyPI + npm + agent + docker...')
  const archive = loadSdkDownloads()
  const series = { ...archive.series }

  // Fetch in parallel, but in chunks to be polite to upstream. category tags
  // let the client split the "agent stack" out from the core provider SDKs.
  const all = [
    ...PYPI_PACKAGES.map(p => ({ ...p, ecosystem: 'PyPI', category: 'core',  fetch: () => fetchPyPiDownloads(p.id) })),
    ...NPM_PACKAGES.map(p =>  ({ ...p, ecosystem: 'npm',  category: 'core',  fetch: () => fetchNpmDownloads(p.id, 365) })),
    ...AGENT_PYPI.map(p =>    ({ ...p, ecosystem: 'PyPI', category: 'agent', fetch: () => fetchPyPiDownloads(p.id) })),
    ...AGENT_NPM.map(p =>     ({ ...p, ecosystem: 'npm',  category: 'agent', fetch: () => fetchNpmDownloads(p.id, 365) })),
  ]
  const BATCH = 6
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH)
    await Promise.all(batch.map(async meta => {
      const key = `${meta.category === 'agent' ? 'AGENT:' : ''}${meta.ecosystem}::${meta.id}`
      const data = await meta.fetch()
      if (!data.length) return
      series[key] = {
        key, ecosystem: meta.ecosystem, id: meta.id, label: meta.label,
        provider: meta.provider, color: meta.color, category: meta.category,
        data: mergeSeries(series[key]?.data, data),
      }
    }))
    if (i + BATCH < all.length) await new Promise(r => setTimeout(r, 250))
  }

  // Docker Hub cumulative pulls → append today's snapshot to derive a rate
  const dockerHist = archive.docker?.history || []
  const dToday = todayStr()
  const pulls = {}
  await Promise.all(DOCKER_IMAGES.map(async im => { const v = await fetchDockerPull(im.id); if (v != null) pulls[im.id] = v }))
  if (Object.keys(pulls).length) {
    const existing = dockerHist.findIndex(s => s.date === dToday)
    const snap = { date: dToday, pulls }
    if (existing >= 0) dockerHist[existing] = snap; else dockerHist.push(snap)
    while (dockerHist.length > 400) dockerHist.shift()
  }
  const docker = { images: DOCKER_IMAGES, history: dockerHist }

  const result = { series, docker, updated: Date.now() }
  saveSdkDownloads(result)

  const total = Object.values(series).length
  const agents = Object.values(series).filter(x => x.category === 'agent').length
  console.log(`SDK downloads: ${total} packages (${agents} agent), docker snaps ${dockerHist.length}`)
  sdkDownloadsCache = { data: result, ts: Date.now() }
  return result
}

/* ── AI Usage Signals: Stack Overflow + GitHub + Cloudflare Radar ────────
   Three complementary lenses on aggregate AI demand:
     1. Stack Overflow tag activity → PRODUCTION usage (devs only ask when shipping)
     2. GitHub repo stars             → DEVELOPER MINDSHARE (commitment > install)
     3. Cloudflare Radar AI traffic   → ACTUAL END-USER consumption (needs token)
   All three snapshotted daily into a single file so trend lines accumulate. */
const USAGE_SIGNALS_FILE = path.join(__dirname, 'usage-signals-history.json')
let usageSignalsCache = { data: null, ts: 0 }
const USAGE_SIGNALS_TTL = 6 * 60 * 60 * 1000   // 6-hour live cache
const CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '' // optional; loaded from .env via loadEnv

const SO_TAGS = [
  { tag: 'openai-api',              label: 'OpenAI API',           provider: 'OpenAI'    },
  { tag: 'chatgpt-api',             label: 'ChatGPT API',          provider: 'OpenAI'    },
  { tag: 'langchain',               label: 'LangChain',            provider: 'Framework' },
  { tag: 'huggingface-transformers',label: 'HF Transformers',      provider: 'HuggingFace'},
  { tag: 'huggingface',             label: 'Hugging Face',         provider: 'HuggingFace'},
  { tag: 'llama-index',             label: 'LlamaIndex',           provider: 'Framework' },
  { tag: 'ollama',                  label: 'Ollama',               provider: 'Framework' },
  { tag: 'google-gemini',           label: 'Google Gemini',        provider: 'Google'    },
  { tag: 'anthropic',               label: 'Anthropic',            provider: 'Anthropic' },
]

const GITHUB_REPOS = [
  { repo: 'langchain-ai/langchain',           label: 'LangChain',     provider: 'Framework' },
  { repo: 'openai/openai-python',             label: 'OpenAI Py SDK', provider: 'OpenAI'    },
  { repo: 'anthropics/anthropic-sdk-python',  label: 'Anthropic Py',  provider: 'Anthropic' },
  { repo: 'vercel/ai',                        label: 'Vercel AI SDK', provider: 'Framework' },
  { repo: 'ggml-org/llama.cpp',               label: 'llama.cpp',     provider: 'Inference' },
  { repo: 'huggingface/transformers',         label: 'HF Transformers', provider: 'HuggingFace' },
  { repo: 'ollama/ollama',                    label: 'Ollama',        provider: 'Inference' },
  { repo: 'run-llama/llama_index',            label: 'LlamaIndex',    provider: 'Framework' },
  { repo: 'BerriAI/litellm',                  label: 'LiteLLM',       provider: 'Framework' },
  { repo: 'comfyanonymous/ComfyUI',           label: 'ComfyUI',       provider: 'Inference' },
]

function loadUsageSignals() {
  try {
    if (fs.existsSync(USAGE_SIGNALS_FILE)) return JSON.parse(fs.readFileSync(USAGE_SIGNALS_FILE, 'utf8'))
  } catch {}
  return { snapshots: {} }   // keyed by ISO date → snapshot
}
function saveUsageSignals(data) {
  try { fs.writeFileSync(USAGE_SIGNALS_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save usage signals:', e.message) }
}

// Stack Exchange API — total question count + monthly new questions for a tag
async function fetchStackOverflowTag(tag) {
  try {
    // Get the all-time question count for the tag
    const infoUrl = `https://api.stackexchange.com/2.3/tags/${encodeURIComponent(tag)}/info?site=stackoverflow`
    const infoResp = await fetch(infoUrl, { headers: { 'User-Agent': UA } })
    const infoJson = await infoResp.json()
    const info = (infoJson.items || [])[0]
    if (!info) return null

    // Get question count in last 30 days
    const since = Math.floor(Date.now() / 1000) - 30 * 86400
    const recentUrl = `https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=${encodeURIComponent(tag)}&site=stackoverflow&fromdate=${since}&filter=total`
    const recentResp = await fetch(recentUrl, { headers: { 'User-Agent': UA } })
    const recentJson = await recentResp.json()

    return {
      tag,
      totalQuestions: info.count || 0,
      questionsLast30Days: recentJson.total || 0,
    }
  } catch (e) {
    console.warn(`SO ${tag}:`, e.message)
    return null
  }
}

// GitHub repo info (current star count + a few related metrics)
async function fetchGitHubRepo(repo) {
  try {
    const url = `https://api.github.com/repos/${repo}`
    const headers = { 'User-Agent': UA }
    // Use GH token if present (lifts rate limit to 5000/hr)
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
    const resp = await fetch(url, { headers })
    if (!resp.ok) return null
    const d = await resp.json()
    return {
      repo,
      stars: d.stargazers_count || 0,
      forks: d.forks_count || 0,
      openIssues: d.open_issues_count || 0,
      updatedAt: d.pushed_at,
    }
  } catch (e) {
    console.warn(`GH ${repo}:`, e.message)
    return null
  }
}

// Cloudflare Radar AI inference summary by model (last 28 days by default)
// Returns model share data. Requires CLOUDFLARE_API_TOKEN env var. The token
// needs the "Radar Read" permission — free Cloudflare account, no charges.
async function fetchCloudflareRadarAI() {
  if (!CLOUDFLARE_API_TOKEN) return { available: false, reason: 'no_token' }
  try {
    const url = 'https://api.cloudflare.com/client/v4/radar/ai/inference/timeseries_groups/model?dateRange=28d'
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}` },
    })
    if (!resp.ok) return { available: false, reason: `http_${resp.status}` }
    const json = await resp.json()
    if (!json.success) return { available: false, reason: 'api_error', detail: json.errors }
    return { available: true, raw: json.result }
  } catch (e) {
    return { available: false, reason: 'fetch_error', detail: e.message }
  }
}

// ── SO monthly history backfill ──
// Historical month counts don't change after the month closes, so we only
// re-fetch the most-recent month on each call (caching everything else
// forever to disk).
const SO_MONTHLY_CACHE = path.join(__dirname, 'usage-signals-so-monthly.json')

function loadSoMonthlyCache() {
  try { if (fs.existsSync(SO_MONTHLY_CACHE)) return JSON.parse(fs.readFileSync(SO_MONTHLY_CACHE, 'utf8')) } catch {}
  return { byTag: {} }
}
function saveSoMonthlyCache(data) {
  try { fs.writeFileSync(SO_MONTHLY_CACHE, JSON.stringify(data, null, 2)) } catch (e) { console.error('SO monthly cache save:', e.message) }
}

function monthBuckets(n) {
  const buckets = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59))
    const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
    buckets.push({ month: label, fromdate: Math.floor(start.getTime() / 1000), todate: Math.floor(end.getTime() / 1000) })
  }
  return buckets
}

async function fetchSoCountInWindow(tag, fromdate, todate) {
  try {
    const url = `https://api.stackexchange.com/2.3/questions?tagged=${encodeURIComponent(tag)}&site=stackoverflow&fromdate=${fromdate}&todate=${todate}&filter=total`
    const resp = await fetch(url, { headers: { 'User-Agent': UA } })
    const json = await resp.json()
    return json.total || 0
  } catch { return null }
}

async function getSoMonthlyHistory(tag, months = 24) {
  const cache = loadSoMonthlyCache()
  const cached = cache.byTag[tag] || []
  const buckets = monthBuckets(months)
  const currentMonth = buckets[buckets.length - 1].month

  // If cache has full coverage, only refresh the current (in-progress) month
  const cachedByMonth = Object.fromEntries(cached.map(r => [r.month, r.count]))
  const covered = buckets.every(b => b.month !== currentMonth && cachedByMonth[b.month] != null)

  const out = []
  for (const b of buckets) {
    if (b.month === currentMonth || cachedByMonth[b.month] == null) {
      const c = await fetchSoCountInWindow(tag, b.fromdate, b.todate)
      out.push({ month: b.month, count: c ?? 0 })
      await new Promise(r => setTimeout(r, 40))  // be polite to SE
    } else {
      out.push({ month: b.month, count: cachedByMonth[b.month] })
    }
  }

  cache.byTag[tag] = out
  saveSoMonthlyCache(cache)
  return out
}

async function fetchUsageSignals() {
  if (usageSignalsCache.data && Date.now() - usageSignalsCache.ts < USAGE_SIGNALS_TTL) return usageSignalsCache.data

  console.log('Usage signals: fetching SO + GitHub + Cloudflare in parallel...')

  // Stack Overflow: throttled (SE has 30 req/sec but is sensitive to bursts)
  const soResults = []
  for (let i = 0; i < SO_TAGS.length; i += 3) {
    const batch = SO_TAGS.slice(i, i + 3)
    const batchRes = await Promise.all(batch.map(async meta => {
      const data = await fetchStackOverflowTag(meta.tag)
      if (!data) return null
      return { ...meta, ...data }
    }))
    soResults.push(...batchRes.filter(Boolean))
    if (i + 3 < SO_TAGS.length) await new Promise(r => setTimeout(r, 200))
  }

  // GitHub: more aggressive parallelism (rate limit is per-hour, not per-second)
  const ghResults = []
  for (let i = 0; i < GITHUB_REPOS.length; i += 5) {
    const batch = GITHUB_REPOS.slice(i, i + 5)
    const batchRes = await Promise.all(batch.map(async meta => {
      const data = await fetchGitHubRepo(meta.repo)
      if (!data) return null
      return { ...meta, ...data }
    }))
    ghResults.push(...batchRes.filter(Boolean))
    if (i + 5 < GITHUB_REPOS.length) await new Promise(r => setTimeout(r, 100))
  }

  // Backfill monthly SO history for each tag (cached aggressively to disk)
  const soMonthly = {}
  for (const meta of SO_TAGS) {
    soMonthly[meta.tag] = await getSoMonthlyHistory(meta.tag, 24)
  }

  // Cloudflare (optional)
  const cloudflare = await fetchCloudflareRadarAI()

  // Append today's snapshot to the persistent archive
  const today = todayStr()
  const archive = loadUsageSignals()
  const snapshots = { ...archive.snapshots }
  snapshots[today] = {
    date: today,
    stackOverflow: soResults.map(r => ({ tag: r.tag, totalQuestions: r.totalQuestions, questionsLast30Days: r.questionsLast30Days })),
    github: ghResults.map(r => ({ repo: r.repo, stars: r.stars, forks: r.forks })),
  }
  saveUsageSignals({ snapshots })

  const result = {
    asOf: Date.now(),
    stackOverflow: soResults,
    stackOverflowMonthly: soMonthly,   // { tag: [{month, count}] } back 24 months
    github: ghResults,
    cloudflare,
    snapshots,
  }
  console.log(`Usage signals: ${soResults.length} SO tags, ${ghResults.length} GH repos, CF: ${cloudflare.available ? 'live' : `unavailable (${cloudflare.reason})`}`)
  usageSignalsCache = { data: result, ts: Date.now() }
  return result
}

/* ── Hugging Face model rankings (replaces broken OpenRouter rankings) ──── */
// Snapshots top text-generation models by 30-day downloads daily. The data
// answers "what AI models are getting used" — downloads here are devs pulling
// open weights to run themselves, which complements / replaces OpenRouter's
// token-volume metric (paid-API usage). Same daily archive pattern as the
// OR rankings — file accumulates one row per (date, model) combo.
const HF_RANKINGS_FILE = path.join(__dirname, 'hf-rankings-history.json')
let hfRankingsCache = { data: null, ts: 0 }
const HF_RANKINGS_TTL = 60 * 60 * 1000 // 1-hour live cache (HF downloads are 30-day, change slowly)
const HF_TOP_N = 75

function loadHfRankings() {
  try {
    if (fs.existsSync(HF_RANKINGS_FILE)) return JSON.parse(fs.readFileSync(HF_RANKINGS_FILE, 'utf8'))
  } catch {}
  return { rows: [] }
}
function saveHfRankings(data) {
  try { fs.writeFileSync(HF_RANKINGS_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save HF rankings:', e.message) }
}

async function fetchHfRankingsFresh() {
  // Top N text-generation models by past-30-day download count
  const url = `https://huggingface.co/api/models?sort=downloads&direction=-1&limit=${HF_TOP_N}&pipeline_tag=text-generation&full=false`
  const resp = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!resp.ok) throw new Error(`HF rankings HTTP ${resp.status}`)
  const arr = await resp.json()
  if (!Array.isArray(arr)) throw new Error('HF rankings: unexpected response shape')
  const today = todayStr()
  return arr.map((m, i) => ({
    date: today,
    rank: i + 1,
    id: m.id,                                  // "Qwen/Qwen3-0.6B"
    author: (m.id || '').split('/')[0] || '',  // "Qwen"
    downloads: m.downloads ?? 0,               // last 30 days
    likes: m.likes ?? 0,
    pipeline: m.pipeline_tag || null,
    library: m.library_name || null,
    lastModified: m.lastModified || null,
    createdAt: m.createdAt || null,
  }))
}

async function getHfRankingsWithHistory() {
  if (hfRankingsCache.data && Date.now() - hfRankingsCache.ts < HF_RANKINGS_TTL) return hfRankingsCache.data

  let fresh = []
  try {
    fresh = await fetchHfRankingsFresh()
  } catch (e) {
    console.warn('HF rankings fetch failed:', e.message)
    const archive = loadHfRankings()
    const result = { rows: archive.rows || [], source: 'archive-only', updated: Date.now() }
    hfRankingsCache = { data: result, ts: Date.now() }
    return result
  }

  const archive = loadHfRankings()
  const merged = new Map()
  for (const row of archive.rows || []) {
    if (!row.date || !row.id) continue
    merged.set(`${row.date}|${row.id}`, row)
  }
  const today = todayStr()
  let added = 0, updatedToday = 0
  for (const row of fresh) {
    const key = `${row.date}|${row.id}`
    const existed = merged.has(key)
    // Archive is authoritative for closed days; today is always overwritten with latest
    if (row.date === today || !existed) {
      merged.set(key, row)
      if (existed) updatedToday++
      else added++
    }
  }

  const rows = Array.from(merged.values())
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank)

  saveHfRankings({ rows, lastUpdated: Date.now() })

  const dates = new Set(rows.map(r => r.date)).size
  console.log(`HF rankings: +${added} new, ~${updatedToday} today updated, ${rows.length} total archived across ${dates} dates`)

  const result = { rows, source: 'live+archive', updated: Date.now(), dates }
  hfRankingsCache = { data: result, ts: Date.now() }
  return result
}

/* ── AI Pricing Snapshots (token + GPU, persisted to disk) ──── */
const AI_PRICES_FILE = path.join(__dirname, 'ai-prices.json')
const AI_SNAP_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours
let aiPricesCache = { data: null, ts: 0 }
const AI_CACHE_TTL = 30 * 60 * 1000 // 30-min live cache

// Key models to track token pricing for. Refreshed 2026-Q2 — covers current
// frontier, mid, and budget tiers across major providers. When new models are
// released, append them here (verify against https://openrouter.ai/api/v1/models).
const TRACKED_MODELS = [
  // OpenAI — frontier
  'openai/gpt-5.5-pro',
  'openai/gpt-5.5',
  'openai/gpt-5.4',
  'openai/gpt-5.2-pro',
  'openai/gpt-5-codex',
  'openai/o3-pro',
  // OpenAI — mid / budget
  'openai/gpt-5.4-mini',
  'openai/gpt-5.4-nano',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-oss-120b',

  // Anthropic — frontier
  'anthropic/claude-opus-4.8',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-opus-4.6',
  // Anthropic — mid / budget
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',

  // Google — frontier
  'google/gemini-3.1-pro-preview',
  'google/gemini-3.5-flash',
  // Google — mid / budget
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',

  // xAI
  'x-ai/grok-4.3',
  'x-ai/grok-4.20',

  // DeepSeek
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v3.2',
  'deepseek/deepseek-r1',

  // Meta
  'meta-llama/llama-4-maverick',
  'meta-llama/llama-4-scout',
  'meta-llama/llama-3.3-70b-instruct',

  // Mistral
  'mistralai/mistral-large-2512',
  'mistralai/mistral-medium-3.1',

  // Qwen
  'qwen/qwen3.7-max',
  'qwen/qwen3.5-397b-a17b',
]

// GPU models to track on Vast.ai (use exact gpu_name values from their API)
const TRACKED_GPUS = ['H100 SXM', 'H100 NVL', 'H200', 'H200 NVL', 'A100 SXM4', 'A100 PCIE', 'L40S', 'RTX A6000', 'RTX 4090', 'RTX 5090', 'RTX 3090']

function loadAiPrices() {
  try {
    if (fs.existsSync(AI_PRICES_FILE)) return JSON.parse(fs.readFileSync(AI_PRICES_FILE, 'utf8'))
  } catch {}
  return { tokenHistory: [], gpuHistory: [] }
}
function saveAiPrices(data) {
  try { fs.writeFileSync(AI_PRICES_FILE, JSON.stringify(data, null, 2)) } catch (e) { console.error('Failed to save AI prices:', e.message) }
}

async function fetchTokenPrices() {
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', { headers: { 'User-Agent': UA } })
    const json = await resp.json()
    const models = json.data || []
    const tracked = TRACKED_MODELS.map(id => {
      const m = models.find(x => x.id === id)
      if (!m) return null
      return {
        id: m.id,
        name: m.name,
        input: parseFloat(m.pricing?.prompt || '0') * 1e6,
        output: parseFloat(m.pricing?.completion || '0') * 1e6,
        context: m.context_length,
      }
    }).filter(Boolean)
    // Compute market stats
    const allPaid = models.filter(m => parseFloat(m.pricing?.prompt || '0') > 0)
    const inputPrices = allPaid.map(m => parseFloat(m.pricing.prompt) * 1e6).sort((a, b) => a - b)
    const medianInput = inputPrices.length ? inputPrices[Math.floor(inputPrices.length / 2)] : 0
    const meanInput = inputPrices.length ? inputPrices.reduce((s, v) => s + v, 0) / inputPrices.length : 0
    return { models: tracked, totalModels: models.length, paidModels: allPaid.length, medianInput: +medianInput.toFixed(4), meanInput: +meanInput.toFixed(4) }
  } catch (e) { console.error('Token price fetch error:', e.message); return null }
}

// Maps our tracked GPU names (Vast naming) → RunPod displayName, so we can
// blend a second independent price source and reduce single-marketplace noise.
const RUNPOD_GPU_MAP = {
  'H100 SXM':  'H100 SXM',
  'H100 NVL':  'H100 NVL',
  'H200':      'H200 SXM',
  'H200 NVL':  'H200 NVL',
  'A100 SXM4': 'A100 SXM',
  'A100 PCIE': 'A100 PCIe',
  'L40S':      'L40S',
  'RTX A6000': 'RTX A6000',
  'RTX 4090':  'RTX 4090',
  'RTX 5090':  'RTX 5090',
  'RTX 3090':  'RTX 3090',
}

// RunPod public GraphQL — no auth. Returns curated per-GPU secure (datacenter)
// + community (peer-to-peer marketplace) on-demand prices.
async function fetchRunPodPrices() {
  try {
    const resp = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query: 'query { gpuTypes { displayName securePrice communityPrice } }' }),
    })
    const json = await resp.json()
    const types = json?.data?.gpuTypes || []
    const byDisplay = {}
    types.forEach(t => { byDisplay[t.displayName] = t })
    const out = {}
    for (const [tracked, rpName] of Object.entries(RUNPOD_GPU_MAP)) {
      const t = byDisplay[rpName]
      if (t) out[tracked] = { secure: t.securePrice || null, community: t.communityPrice || null }
    }
    return out
  } catch (e) { console.warn('RunPod GPU fetch:', e.message); return {} }
}

// Blend Vast median + RunPod community into a consensus price. Guards against
// RunPod's occasional bogus placeholder lows (community << secure tier).
function blendConsensus(vastMedian, rpCommunity, rpSecure) {
  const candidates = []
  if (vastMedian > 0) candidates.push(vastMedian)
  if (rpCommunity > 0 && (!rpSecure || rpCommunity >= rpSecure * 0.3)) candidates.push(rpCommunity)
  if (!candidates.length) return null
  return +(candidates.reduce((a, b) => a + b, 0) / candidates.length).toFixed(4)
}

async function fetchGpuPrices() {
  try {
    // Vast.ai public search — no auth needed for basic queries
    // Fetch offers sorted both ways to catch cheap consumer + expensive enterprise GPUs
    const allOffers = []
    for (const dir of ['asc', 'desc']) {
      try {
        const resp = await fetch('https://console.vast.ai/api/v0/bundles/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
          body: JSON.stringify({
            rentable: { eq: true }, rented: { eq: false },
            num_gpus: { eq: 1 }, type: 'on-demand',
            order: [['dph_total', dir]], limit: 500,
          })
        })
        const json = await resp.json()
        allOffers.push(...(json.offers || []))
      } catch {}
      await new Promise(r => setTimeout(r, 500))
    }
    // Deduplicate by machine_id
    const seen = new Set()
    const uniqueOffers = allOffers.filter(o => { if (seen.has(o.machine_id)) return false; seen.add(o.machine_id); return true })
    const results = {}
    const gpuSet = new Set(TRACKED_GPUS)
    for (const o of uniqueOffers) {
      const gpuName = o.gpu_name
      if (!gpuSet.has(gpuName)) continue
      if (!results[gpuName]) results[gpuName] = { name: gpuName, offers: [], vram: o.gpu_ram ? Math.round(o.gpu_ram / 1024) : null }
      if (o.dph_total > 0) results[gpuName].offers.push(o.dph_total)
    }
    for (const [key, g] of Object.entries(results)) {
      const prices = g.offers.sort((a, b) => a - b)
      if (prices.length === 0) { delete results[key]; continue }
      const mid = Math.floor(prices.length / 2)
      results[key] = {
        name: g.name,
        count: prices.length,
        min: +prices[0].toFixed(4),
        p25: +prices[Math.floor(prices.length * 0.25)].toFixed(4),
        median: +prices[mid].toFixed(4),
        p75: +prices[Math.floor(prices.length * 0.75)].toFixed(4),
        max: +prices[prices.length - 1].toFixed(4),
        vram: g.vram,
      }
    }

    // ── Second source: RunPod ── merge in + compute consensus per GPU
    const runpod = await fetchRunPodPrices()
    for (const [key, g] of Object.entries(results)) {
      const rp = runpod[key] || {}
      g.vastMedian = g.median                       // preserve Vast-only median
      g.runpodSecure = rp.secure ?? null
      g.runpodCommunity = rp.community ?? null
      g.consensus = blendConsensus(g.median, rp.community, rp.secure)
      // cross-source spread as % (how much the two sources disagree)
      g.sourceSpread = (g.median > 0 && rp.community > 0 && (!rp.secure || rp.community >= rp.secure * 0.3))
        ? +(Math.abs(g.median - rp.community) / ((g.median + rp.community) / 2) * 100).toFixed(0)
        : null
      g.sources = ['vast', ...(rp.community || rp.secure ? ['runpod'] : [])]
    }

    return Object.keys(results).length > 0 ? results : null
  } catch (e) { console.error('GPU price fetch error:', e.message); return null }
}

async function takeAiSnapshot() {
  const today = new Date().toISOString().slice(0, 10)
  const store = loadAiPrices()

  // Only one snapshot per day
  const lastToken = store.tokenHistory[store.tokenHistory.length - 1]
  const lastGpu = store.gpuHistory[store.gpuHistory.length - 1]
  const needToken = !lastToken || lastToken.date !== today
  const needGpu = !lastGpu || lastGpu.date !== today

  if (needToken) {
    const tokenData = await fetchTokenPrices()
    if (tokenData) {
      store.tokenHistory.push({ date: today, ...tokenData })
      // Keep max 365 days
      if (store.tokenHistory.length > 365) store.tokenHistory = store.tokenHistory.slice(-365)
    }
  }
  if (needGpu) {
    const gpuData = await fetchGpuPrices()
    if (gpuData) {
      store.gpuHistory.push({ date: today, gpus: gpuData })
      if (store.gpuHistory.length > 365) store.gpuHistory = store.gpuHistory.slice(-365)
    }
  }
  if (needToken || needGpu) saveAiPrices(store)
  return store
}

async function getAiPrices() {
  if (aiPricesCache.data && Date.now() - aiPricesCache.ts < AI_CACHE_TTL) return aiPricesCache.data
  const store = await takeAiSnapshot()
  // Also get live current data (may differ from today's snapshot if prices changed)
  const liveTokens = await fetchTokenPrices()
  const liveGpus = await fetchGpuPrices()
  const result = { history: store, live: { tokens: liveTokens, gpus: liveGpus } }
  aiPricesCache = { data: result, ts: Date.now() }
  return result
}

/* ── SemiAnalysis H100 1-year contract index (public/free slice) ──────────
   The paid product is the full daily all-GPU dataset; the H100 1y index is
   the free public loss-leader (see the "NVIDIA GPU debt backstop" article).
   The public dashboard (gpu-index.semianalysis.com) fetches it anonymously:
     primary:  /api/public-data                       → { status, index:[…] }
     fallback: /api/sa-proxy/…/index?…&test_mode=true → { status, data:[…]  }
   Records look like { date, h100, a100, b200 } in $/GPU-hr (weekly). This is
   CONTRACT pricing (what firms commit to on a 1y term) — a smoother, more
   investment-relevant compute-cost signal than our Vast+RunPod SPOT number.
   The endpoint has been flaky (403/404 anonymously), so this degrades to a
   disk-cached archive seeded from real values embedded in their own bundle. */
const SEMI_H100_FILE = path.join(__dirname, 'semi-h100-index.json')
let semiH100Cache = { data: null, ts: 0 }
const SEMI_H100_TTL = 6 * 60 * 60 * 1000 // 6h

// Real index values embedded in SemiAnalysis's public dashboard bundle
// (their default dataset), 2025-06-10 → 2026-03-17. Bootstraps the archive
// so the series is populated even while the live endpoint is unreachable;
// live fetch extends/overrides by date.
const SEMI_H100_SEED = [
  {d:"2025-06-10",h100:3.01,a100:1.32,b200:5.21}, {d:"2025-06-17",h100:2.85,a100:1.3,b200:5.25}, {d:"2025-06-24",h100:2.8,a100:1.26,b200:5.25}, {d:"2025-07-01",h100:2.77,a100:1.28,b200:5.15},
  {d:"2025-07-08",h100:2.78,a100:1.3,b200:5.15}, {d:"2025-07-15",h100:2.79,a100:1.31,b200:5.06}, {d:"2025-07-22",h100:2.78,a100:1.33,b200:5.06}, {d:"2025-07-29",h100:2.81,a100:1.38,b200:3.84},
  {d:"2025-08-05",h100:2.85,a100:1.39,b200:3.95}, {d:"2025-08-12",h100:2.88,a100:1.39,b200:4.07}, {d:"2025-08-19",h100:2.9,a100:1.39,b200:4.18}, {d:"2025-08-26",h100:2.96,a100:1.46,b200:4.34},
  {d:"2025-09-02",h100:2.94,a100:1.42,b200:4.4}, {d:"2025-09-09",h100:2.92,a100:1.41,b200:4.44}, {d:"2025-09-16",h100:2.92,a100:1.39,b200:4.48}, {d:"2025-09-23",h100:2.88,a100:1.37,b200:4.51},
  {d:"2025-09-30",h100:2.84,a100:1.37,b200:4.49}, {d:"2025-10-07",h100:2.83,a100:1.36,b200:4.25}, {d:"2025-10-14",h100:2.84,a100:1.37,b200:4.24}, {d:"2025-10-21",h100:2.85,a100:1.43,b200:3.99},
  {d:"2025-10-28",h100:2.86,a100:1.41,b200:4.01}, {d:"2025-11-04",h100:2.82,a100:1.39,b200:4.2}, {d:"2025-11-11",h100:2.8,a100:1.34,b200:4.33}, {d:"2025-11-18",h100:2.79,a100:1.32,b200:4.63},
  {d:"2025-11-25",h100:2.79,a100:1.3,b200:4.59}, {d:"2025-12-02",h100:2.8,a100:1.33,b200:4.42}, {d:"2025-12-09",h100:2.78,a100:1.36,b200:4.5}, {d:"2025-12-16",h100:2.84,a100:1.4,b200:4.54},
  {d:"2025-12-23",h100:2.8,a100:1.39,b200:4.61}, {d:"2025-12-30",h100:2.81,a100:1.33,b200:4.59}, {d:"2026-01-06",h100:2.89,a100:1.31,b200:4.55}, {d:"2026-01-13",h100:2.88,a100:1.3,b200:4.36},
  {d:"2026-01-20",h100:2.77,a100:1.31,b200:4.18}, {d:"2026-01-27",h100:2.74,a100:1.31,b200:4.0}, {d:"2026-02-03",h100:2.71,a100:1.32,b200:3.86}, {d:"2026-02-10",h100:2.83,a100:1.34,b200:3.78},
  {d:"2026-02-17",h100:2.91,a100:1.34,b200:3.87}, {d:"2026-02-24",h100:2.86,a100:1.4,b200:3.94}, {d:"2026-03-03",h100:2.77,a100:1.44,b200:4.01}, {d:"2026-03-10",h100:2.8,a100:1.42,b200:3.96},
  {d:"2026-03-17",h100:2.82,a100:1.51,b200:3.68},
].map(r => ({ date: r.d, h100: r.h100, a100: r.a100, b200: r.b200 }))

function loadSemiH100() {
  try { if (fs.existsSync(SEMI_H100_FILE)) return JSON.parse(fs.readFileSync(SEMI_H100_FILE, 'utf8')) } catch {}
  return { byDate: {}, source: 'seed', liveOk: false, updated: 0 }
}
function saveSemiH100(store) {
  try { fs.writeFileSync(SEMI_H100_FILE, JSON.stringify(store, null, 2)) } catch (e) { console.error('SemiH100 cache save:', e.message) }
}

// Group by date, keep the numeric GPU fields (mirrors their el() parser).
function parseSemiIndex(arr) {
  const byDate = {}
  for (const r of arr || []) {
    if (!r || !r.date) continue
    // Their API returns RFC-2822 ("Fri, 01 Aug 2025 00:00:00 GMT"). Slicing that
    // to ten characters yields "Fri, 01 Au" — still ten characters, still sorts,
    // silently useless, and it corrupted 1,106 of the archive's 1,147 points.
    const d = normDate(r.date)
    const num = v => (typeof v === 'number' && isFinite(v)) ? v : (v != null && isFinite(+v) ? +v : null)
    byDate[d] = { date: d, h100: num(r.h100), a100: num(r.a100), b200: num(r.b200) }
  }
  return byDate
}

async function fetchSemiH100Live() {
  const base = 'https://gpu-index.semianalysis.com'
  const headers = { 'User-Agent': UA, 'Referer': `${base}/`, 'Origin': base, 'Accept': 'application/json' }
  for (const [url, key] of [
    [`${base}/api/public-data`, 'index'],
    [`${base}/api/sa-proxy/gpu_spot_pricing/index?page_size=2500&test_mode=true`, 'data'],
  ]) {
    try {
      const resp = await fetch(url, { headers })
      if (!resp.ok) continue
      const j = await resp.json()
      if (j && j.status === 'ok' && Array.isArray(j[key]) && j[key].length) return { rows: j[key], src: url }
    } catch { /* try next */ }
  }
  return null
}

async function getSemiH100() {
  if (semiH100Cache.data && Date.now() - semiH100Cache.ts < SEMI_H100_TTL) return semiH100Cache.data
  const store = loadSemiH100()
  if (!store.byDate || !Object.keys(store.byDate).length) {
    store.byDate = parseSemiIndex(SEMI_H100_SEED); store.source = 'seed'; saveSemiH100(store)
  }
  const live = await fetchSemiH100Live()
  if (live) {
    Object.assign(store.byDate, parseSemiIndex(live.rows))
    store.source = 'live'; store.liveOk = true; store.updated = Date.now()
    saveSemiH100(store)
    console.log(`SemiAnalysis H100: live OK (${live.src.split('/api/')[1]}), ${Object.keys(store.byDate).length} weeks`)
  } else {
    store.liveOk = false
    console.log('SemiAnalysis H100: live unavailable, serving archive/seed')
  }
  const series = Object.values(store.byDate).sort((a, b) => a.date.localeCompare(b.date))
  const asOf = series.length ? series[series.length - 1].date : null
  const daysStale = asOf ? Math.floor((Date.now() - Date.parse(asOf)) / 86400000) : null
  const data = {
    available: series.length > 0,
    liveOk: !!store.liveOk,
    source: store.source,
    asOf, daysStale,
    latest: series.length ? series[series.length - 1] : null,
    series,
    reason: live ? null : 'live_unavailable',
  }
  semiH100Cache = { data, ts: Date.now() }
  return data
}

/* ── TrendForce memory spot prices (DRAM / modules / GDDR / NAND) ─────────
   trendforce.com/price serves its spot-price tables fully server-rendered,
   free, no login: DRAM chips (DDR3/4/5 + eTT), modules (UDIMM/RDIMM/SO-DIMM),
   graphics DRAM (GDDR), NAND — each with session high/low/average and a
   session change %. Price HISTORY is member-gated, so we build our own:
   every successful fetch appends today's snapshot to memory-prices.json
   (append-only archive, same pattern as semi-h100-index.json). Spot ≠
   contract: quarterly contract prices move via TrendForce press releases and
   are curated by hand in the MemoryPricesPanel component, not scraped. */
const MEMORY_FILE = path.join(__dirname, 'memory-prices.json')
let memoryCache = { data: null, ts: 0 }
const MEMORY_TTL = 6 * 60 * 60 * 1000 // 6h — page updates once per Taiwan business day

function loadMemoryArchive() {
  try { if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) } catch {}
  return { days: [], updated: 0 }
}
function saveMemoryArchive(store) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(store)) } catch (e) { console.error('Memory archive save:', e.message) }
}

// Classify a spot-table row by its item name; null = row we don't track.
function memoryGroup(name) {
  if (/^GDDR/i.test(name)) return 'gddr'
  if (/DIMM/i.test(name)) return 'module'
  if (/NAND|TLC|MLC|SLC|Flash/i.test(name)) return 'nand'
  if (/^LPDDR/i.test(name)) return 'mobile'
  if (/^DDR\d/i.test(name)) return 'chip'
  return null
}

// Parse the server-rendered <table> rows into { n, g, avg, chg } items.
// Column layouts differ per table (daily vs session vs weekly hi/lo), but in
// every layout the LAST pure-numeric cell is the session average, and the
// change cell is the first cell containing '%' (▲/▼ entity carries the sign).
function parseTrendForce(html) {
  const items = []
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []
  for (const row of rows) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || [])
      .map(c => c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
    if (cells.length < 3) continue
    const name = cells[0]
    if (!name || /^Item$/i.test(name)) continue
    const g = memoryGroup(name)
    if (!g) continue
    // pure-numeric cells only (change cells contain % / arrows and are excluded)
    const nums = cells.filter(c => /^[\d,]+(\.\d+)?$/.test(c)).map(c => parseFloat(c.replace(/,/g, '')))
    if (nums.length < 2) continue // guards against odd layouts (e.g. LPDDR nav rows)
    const avg = nums[nums.length - 1]
    let chg = null
    const chgCell = cells.find(c => c.includes('%'))
    if (chgCell) {
      if (/&mdash;|—/.test(row)) chg = 0
      const m = chgCell.match(/(-?\d+(\.\d+)?)\s*%/)
      if (m) {
        chg = parseFloat(m[1])
        if (/&#9660;|▼/.test(row) && chg > 0) chg = -chg // down-arrow rows are negative
      }
    }
    if (avg != null && isFinite(avg)) items.push({ n: name, g, avg, chg })
  }
  return items
}

async function fetchTrendForceLive() {
  try {
    const resp = await fetch('https://www.trendforce.com/price/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    })
    if (!resp.ok) return null
    const items = parseTrendForce(await resp.text())
    // complete-batch guard: a blocked/empty page must never poison the archive
    return items.length >= 8 ? items : null
  } catch { return null }
}

async function getMemoryPrices() {
  if (memoryCache.data && Date.now() - memoryCache.ts < MEMORY_TTL) return memoryCache.data
  const store = loadMemoryArchive()
  const today = new Date().toISOString().slice(0, 10)
  const items = await fetchTrendForceLive()
  let liveOk = false
  if (items) {
    liveOk = true
    const i = store.days.findIndex(d => d.date === today)
    if (i >= 0) store.days[i] = { date: today, items } // same-day refresh replaces
    else store.days.push({ date: today, items })
    store.days.sort((a, b) => a.date.localeCompare(b.date))
    if (store.days.length > 400) store.days = store.days.slice(-400)
    store.updated = Date.now()
    saveMemoryArchive(store)
    console.log(`TrendForce memory: live OK, ${items.length} items, archive ${store.days.length} day(s)`)
  } else {
    console.log('TrendForce memory: live unavailable, serving archive')
  }
  const last = store.days.length ? store.days[store.days.length - 1] : null
  const data = {
    available: !!last,
    liveOk,
    source: liveOk ? 'live' : (last ? 'archive' : 'none'),
    asOf: last ? last.date : null,
    daysStale: last ? Math.floor((Date.now() - Date.parse(last.date)) / 86400000) : null,
    latest: last ? last.items : [],
    days: store.days,
  }
  // only cache complete batches — a failed fetch with no archive shouldn't pin for TTL
  if (data.available) memoryCache = { data, ts: Date.now() }
  return data
}

/* ── Morningstar US Market Fair Value (bottom-up valuation gauge) ─────────
   morningstar.com/markets/fair-value renders the median price/fair-value of
   every stock Morningstar's ~1,500 covered names carry, daily. The chart is
   fed by an open JSON endpoint (no auth — a browser UA + referer suffice):
     /api/v2/markets/fair-value/_chart?interval=10y
   Records: { datetime, priceFairValue } where priceFairValue is the median
   P/FV minus 1 (-0.08 = the market trades 8% BELOW analysts' fair value).
   This is the BOTTOM-UP complement to the top-down ERP / Damodaran reads.
   Archived to ms-fair-value.json (merged by date) so the history survives
   any change to the endpoint; served with a percentile since archive start. */
const MS_FV_FILE = path.join(__dirname, 'ms-fair-value.json')
let msFvCache = { data: null, ts: 0 }
const MS_FV_TTL = 6 * 60 * 60 * 1000 // 6h — the series updates once per trading day

function loadMsFv() {
  try { if (fs.existsSync(MS_FV_FILE)) return JSON.parse(fs.readFileSync(MS_FV_FILE, 'utf8')) } catch {}
  return { byDate: {}, updated: 0 }
}
function saveMsFv(store) {
  try { fs.writeFileSync(MS_FV_FILE, JSON.stringify(store)) } catch (e) { console.error('Morningstar FV save:', e.message) }
}

async function fetchMsFvLive() {
  try {
    const resp = await fetch('https://www.morningstar.com/api/v2/markets/fair-value/_chart?interval=10y', {
      headers: { 'User-Agent': UA, 'Referer': 'https://www.morningstar.com/markets/fair-value', 'Accept': 'application/json' },
    })
    if (!resp.ok) return null
    const arr = await resp.json()
    if (!Array.isArray(arr)) return null
    const rows = arr.map(r => ({ d: String(r.datetime || '').slice(0, 10), v: +r.priceFairValue }))
      .filter(r => r.d.length === 10 && isFinite(r.v))
    return rows.length >= 200 ? rows : null // complete-batch guard: a stub page never poisons the archive
  } catch { return null }
}

async function getMsFairValue() {
  if (msFvCache.data && Date.now() - msFvCache.ts < MS_FV_TTL) return msFvCache.data
  const store = loadMsFv()
  const live = await fetchMsFvLive()
  let liveOk = false
  if (live) {
    for (const r of live) store.byDate[r.d] = r.v
    store.updated = Date.now(); saveMsFv(store); liveOk = true
    console.log(`Morningstar fair value: live OK, ${live.length} pts, archive ${Object.keys(store.byDate).length} days`)
  } else {
    console.log('Morningstar fair value: live unavailable, serving archive')
  }
  const series = Object.entries(store.byDate).map(([d, v]) => ({ d, v })).sort((a, b) => a.d.localeCompare(b.d))
  if (!series.length) return { available: false, liveOk, reason: 'no_data' }
  const last = series[series.length - 1]
  const vals = series.map(p => p.v)
  // share of history that was RICHER than today — high = today is cheap by this lens
  const cheaperThan = Math.round((vals.filter(v => v > last.v).length / vals.length) * 100)
  const min = series.reduce((a, b) => (b.v < a.v ? b : a))
  const max = series.reduce((a, b) => (b.v > a.v ? b : a))
  const oneYearAgo = new Date(Date.parse(last.d) - 365 * 86400000).toISOString().slice(0, 10)
  const data = {
    available: true, liveOk, source: liveOk ? 'live' : 'archive',
    asOf: last.d, daysStale: Math.floor((Date.now() - Date.parse(last.d)) / 86400000),
    latest: last.v, cheaperThan, min, max, start: series[0].d, n: series.length,
    series1y: series.filter(p => p.d >= oneYearAgo),
    series10y: series.filter((_, i) => i % 5 === 0 || i === series.length - 1), // ~weekly for the long chart
  }
  msFvCache = { data, ts: Date.now() }
  return data
}

/* ── Real Estate: commercial fundamentals (FRED) + REIT-implied cap rates (FMP)
   Commercial has no free price-level or cap-rate API, so the fundamentals
   are built from what IS public: the BIS commercial property price index
   (COMREPUSQ159N, quarterly YoY — chained here into a level), CRE loan
   delinquency and loan growth (Fed H.8), construction spending by segment,
   Census vacancy, rent CPI, construction-input PPI, and a REIT-implied cap
   rate per property type (EBITDA ÷ enterprise value of bellwether REITs —
   a proxy: public REITs own better-than-average assets, so private-market
   cap rates run higher). Both cached 6h; incomplete batches never cached. */
// percentile of v within arr (share of history below it)
const pctileRe = (arr, v) => { const a = arr.filter(x => x != null && isFinite(x)); if (!a.length || v == null) return null; return Math.round((a.filter(x => x < v).length / a.length) * 100) }
let creCache = { data: null, ts: 0 }
let reitCache = { data: null, ts: 0 }
const RE_TTL = 6 * 60 * 60 * 1000

async function fetchCreFundamentals() {
  if (creCache.data && Date.now() - creCache.ts < RE_TTL) return creCache.data
  const [creYoy, creDq, creLoans, comCons, offCons, resCons, mfgCons, rentVac, ownVac, rentCpi, ppiInputs, mortDq, sqftUs] = await Promise.all([
    fetchFredSeries('COMREPUSQ159N', 200), fetchFredSeries('DRCRELEXFACBS', 200), fetchFredSeries('CREACBW027SBOG', 600),
    fetchFredSeries('TLCOMCONS', 300), fetchFredSeries('TLOFCONS', 300), fetchFredSeries('TLRESCONS', 300), fetchFredSeries('TLMFGCONS', 300),
    fetchFredSeries('RRVRUSQ156N', 240), fetchFredSeries('RHVRUSQ156N', 240), fetchFredSeries('CUUR0000SEHA', 300), fetchFredSeries('WPUIP2311001', 300),
    fetchFredSeries('DRSFRMACBS', 200), fetchFredSeries('MEDLISPRIPERSQUFEEUS', 120),
  ])
  const last = arr => (arr.length ? arr[arr.length - 1] : null)
  const yoy = (arr, k) => (arr.length > k && arr[arr.length - 1 - k].v ? ((last(arr).v / arr[arr.length - 1 - k].v) - 1) * 100 : null)
  // chain the YoY series into a level index: first four quarters = 100
  const level = creYoy.map((p, i) => ({ d: p.d, v: i < 4 ? 100 : null }))
  for (let i = 4; i < creYoy.length; i++) level[i].v = +(level[i - 4].v * (1 + creYoy[i].v / 100)).toFixed(2)
  // commercial price vs construction-input cost (a Tobin's-q style ratio), mean = 100
  const ppiByMonth = {}
  for (const p of ppiInputs) ppiByMonth[p.d.slice(0, 7)] = p.v
  const ratioRaw = level.map(p => { const q = ppiByMonth[p.d.slice(0, 7)]; return q ? { d: p.d, v: p.v / q } : null }).filter(Boolean)
  const mean = ratioRaw.length ? ratioRaw.reduce((a, b) => a + b.v, 0) / ratioRaw.length : 1
  const ratio = ratioRaw.map(p => ({ d: p.d, v: +((p.v / mean) * 100).toFixed(1) }))
  const dqCur = last(creDq)?.v ?? null
  const dqPct = pctileRe(creDq.map(p => p.v), dqCur)
  const dq1y = creDq.length > 4 && dqCur != null ? +(dqCur - creDq[creDq.length - 5].v).toFixed(2) : null
  const priceYoy = last(creYoy)?.v ?? null
  let cycle
  if (priceYoy == null) cycle = { label: 'Data unavailable', color: '#64748b', note: '' }
  else if (priceYoy < -2 && dq1y > 0) cycle = { label: 'Correcting — prices falling, losses rising', color: '#ef4444', note: 'The classic commercial down-leg: values marked down while loan losses climb. Bottoms arrive when delinquencies peak, not when prices stop falling.' }
  else if (priceYoy < 0) cycle = { label: 'Correcting — prices still falling', color: '#f97316', note: 'Values are still adjusting to the rate regime; watch delinquencies for the turn.' }
  else if (priceYoy < 3 && dq1y > 0) cycle = { label: 'Bottoming — prices flat, losses still rising', color: '#fbbf24', note: 'Price declines have stalled but credit is still catching up — the late-trough signature.' }
  else if (priceYoy >= 3 && (dq1y == null || dq1y <= 0)) cycle = { label: 'Recovering — prices up, losses easing', color: '#4ade80', note: 'Values re-rating with credit improving — the early-cycle setup.' }
  else cycle = { label: 'Stable', color: '#94a3b8', note: 'Modest price moves with credit roughly steady.' }
  const rc = last(ratio)
  const data = {
    cycle,
    price: { yoy: priceYoy, asOf: last(creYoy)?.d ?? null, series: creYoy.slice(-80), level: level.slice(-80) },
    replacement: { ratio: ratio.slice(-80), current: rc?.v ?? null, pct: pctileRe(ratio.map(p => p.v), rc?.v), since: ratio[0]?.d?.slice(0, 4) ?? null },
    delinquency: {
      cre: { current: dqCur, pct: dqPct, chg1y: dq1y, series: creDq.slice(-120) },
      mortgage: { current: last(mortDq)?.v ?? null, series: mortDq.slice(-120) },
    },
    loans: { yoy: yoy(creLoans, 52), current: last(creLoans)?.v ?? null, series: creLoans.filter((_, i) => i % 4 === 0).slice(-160) },
    construction: {
      commercial: comCons.slice(-120), office: offCons.slice(-120), residential: resCons.slice(-120), manufacturing: mfgCons.slice(-120),
      yoy: { commercial: yoy(comCons, 12), office: yoy(offCons, 12), residential: yoy(resCons, 12), manufacturing: yoy(mfgCons, 12) },
    },
    vacancy: {
      rental: { current: last(rentVac)?.v ?? null, pct: pctileRe(rentVac.map(p => p.v), last(rentVac)?.v), series: rentVac.slice(-120) },
      owner: { current: last(ownVac)?.v ?? null, pct: pctileRe(ownVac.map(p => p.v), last(ownVac)?.v), series: ownVac.slice(-120) },
    },
    rent: { cpiYoy: yoy(rentCpi, 12), asOf: last(rentCpi)?.d ?? null },
    cost: { ppiYoy: yoy(ppiInputs, 12), sqftUs: last(sqftUs)?.v ?? null, sqftUsYoy: yoy(sqftUs, 12), sqftAsOf: last(sqftUs)?.d ?? null },
    updated: new Date().toISOString(),
  }
  if (creYoy.length > 20 && creDq.length > 20 && comCons.length > 20) creCache = { data, ts: Date.now() } // only cache complete batches
  return data
}

// Bellwether REITs by property type (curated — swap freely). Cap-rate proxy:
// EBITDA ÷ (market cap + debt − cash) — what the public market pays for the
// NOI of these portfolios. Its spread over the 10-year is the property
// market's version of the equity risk premium.
const REIT_BELLWETHERS = [
  { t: 'BXP', sector: 'Office' }, { t: 'VNO', sector: 'Office' }, { t: 'KRC', sector: 'Office' },
  { t: 'EQR', sector: 'Apartments' }, { t: 'AVB', sector: 'Apartments' }, { t: 'MAA', sector: 'Apartments' },
  { t: 'INVH', sector: 'Single-family rental' }, { t: 'AMH', sector: 'Single-family rental' },
  { t: 'PLD', sector: 'Industrial' }, { t: 'REXR', sector: 'Industrial' },
  { t: 'SPG', sector: 'Retail' }, { t: 'KIM', sector: 'Retail' }, { t: 'REG', sector: 'Retail' },
  { t: 'O', sector: 'Net lease' }, { t: 'NNN', sector: 'Net lease' },
  { t: 'EQIX', sector: 'Data centers' }, { t: 'DLR', sector: 'Data centers' },
  { t: 'PSA', sector: 'Self storage' }, { t: 'EXR', sector: 'Self storage' },
  { t: 'HST', sector: 'Hotels' }, { t: 'APLE', sector: 'Hotels' },
  { t: 'WELL', sector: 'Healthcare' }, { t: 'VTR', sector: 'Healthcare' },
]
async function fmpJsonRe(path) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable${path}${path.includes('?') ? '&' : '?'}apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA } })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
async function fetchReitCapRates() {
  if (reitCache.data && Date.now() - reitCache.ts < RE_TTL) return reitCache.data
  if (!FMP_KEY) return { available: false, reason: 'FMP key not configured' }
  const tenY = await fetchFredSeries('DGS10', 5)
  const y10 = tenY.length ? tenY[tenY.length - 1].v : null
  const rows = []
  for (let i = 0; i < REIT_BELLWETHERS.length; i += 4) {
    const batch = REIT_BELLWETHERS.slice(i, i + 4)
    const res = await Promise.all(batch.map(async r => {
      const [q, inc, bs, rat] = await Promise.all([
        fmpJsonRe(`/quote?symbol=${r.t}`), fmpJsonRe(`/income-statement?symbol=${r.t}&limit=1`),
        fmpJsonRe(`/balance-sheet-statement?symbol=${r.t}&limit=1`), fmpJsonRe(`/ratios-ttm?symbol=${r.t}`),
      ])
      const quote = Array.isArray(q) ? q[0] : null, is = Array.isArray(inc) ? inc[0] : null, b = Array.isArray(bs) ? bs[0] : null, rt = Array.isArray(rat) ? rat[0] : null
      if (!quote || !is || !b || !quote.marketCap) return { ...r, error: true }
      const debt = b.totalDebt ?? 0, cash = b.cashAndShortTermInvestments ?? b.cashAndCashEquivalents ?? 0
      const ev = quote.marketCap + debt - cash
      const noi = is.ebitda ?? ((is.operatingIncome ?? 0) + (is.depreciationAndAmortization ?? 0))
      const cap = ev > 0 && noi > 0 ? (noi / ev) * 100 : null
      return {
        ...r, price: quote.price, mktCap: quote.marketCap, ev, noi, cap,
        divYield: rt?.dividendYieldTTM != null ? rt.dividendYieldTTM * 100 : null,
        fy: is.fiscalYear || String(is.date || '').slice(0, 4), debtToEv: ev > 0 ? (debt / ev) * 100 : null,
        offHigh: quote.yearHigh ? ((quote.price / quote.yearHigh) - 1) * 100 : null,
      }
    }))
    rows.push(...res)
  }
  const ok = rows.filter(r => !r.error && r.cap != null)
  const sectors = {}
  for (const r of ok) (sectors[r.sector] = sectors[r.sector] || []).push(r)
  const bySector = Object.entries(sectors).map(([sector, rs]) => {
    const cap = rs.reduce((a, b) => a + b.cap, 0) / rs.length
    return { sector, cap, spread: y10 != null ? cap - y10 : null, n: rs.length, tickers: rs.map(r => r.t) }
  }).sort((a, b) => b.cap - a.cap)
  const avgCap = ok.length ? ok.reduce((a, b) => a + b.cap, 0) / ok.length : null
  const spread = avgCap != null && y10 != null ? avgCap - y10 : null
  let verdict
  if (spread == null) verdict = { label: 'Data unavailable', color: '#64748b', note: '' }
  else if (spread < 1.0) verdict = { label: 'EBITDA spread below 1 pt', color: '#f87171', note: 'Annual EBITDA yield less the current 10-year Treasury yield. This is an enterprise earnings comparison, not a property cap rate or total-return forecast.' }
  else if (spread < 2.5) verdict = { label: 'EBITDA spread 1–2.5 pts', color: '#fbbf24', note: 'Screening band only; not calibrated to a historical premium. Compare operating costs, capital intensity and growth within property types.' }
  else verdict = { label: 'EBITDA spread above 2.5 pts', color: '#94a3b8', note: 'A wider enterprise earnings spread can reflect either income or risk. EBITDA excludes recurring capital expenditure and is not property NOI.' }
  const data = { available: ok.length > 0, rows, bySector, avgCap, tenYear: y10, spread, verdict, asOf: new Date().toISOString().slice(0, 10), coverage: `${ok.length}/${REIT_BELLWETHERS.length}` }
  if (ok.length >= Math.ceil(REIT_BELLWETHERS.length * 0.6)) reitCache = { data, ts: Date.now() }
  return data
}

/* ── FutureSearch Markets — live trading track record + valuations ────────
   markets.futuresearch.ai server-renders its ENTIRE dataset into the page as
   Next.js flight data (no API needed): ~180 prediction-market positions on
   Kalshi/Polymarket (FS probability vs market price, entry, value, W/L) and
   ~477 S&P valuations (FS fair value vs market cap, long/short buckets).
   We fetch the page, unescape the flight-data quoting, and extract objects
   with a balanced-brace scanner. Disk-cached; only complete parses cached. */
let fsMarketsCache = { data: null, ts: 0 }
const FS_MARKETS_TTL = 6 * 60 * 60 * 1000
const FS_MARKETS_FILE = path.join(__dirname, 'fs-markets.json')

// Extract one balanced {...} JSON object starting at index `start` (must point at '{')
function extractJsonObject(text, start) {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

async function fetchFsMarkets() {
  if (fsMarketsCache.data && Date.now() - fsMarketsCache.ts < FS_MARKETS_TTL) return fsMarketsCache.data
  let positions = [], companies = [], liveOk = false
  try {
    const resp = await fetch('https://markets.futuresearch.ai/', { headers: { 'User-Agent': UA } })
    if (resp.ok) {
      const html = await resp.text()
      const u = html.split('\\"').join('"')
      // prediction positions: every {"status":"...","venue":... object
      let idx = 0
      while ((idx = u.indexOf('{"status":"', idx)) !== -1) {
        const raw = extractJsonObject(u, idx)
        if (raw) {
          try {
            const o = JSON.parse(raw)
            if (o.venue && o.p && o.p.title) {
              positions.push({
                status: o.status, venue: o.venue, id: o.p.id, title: o.p.title, url: o.p.url,
                position: o.p.position, shares: o.p.shares, avgPricePaid: o.p.avgPricePaid,
                marketPrice: o.p.marketPrice, value: o.p.value, probabilityYes: o.p.probabilityYes,
                forecastAt: o.p.forecastAt, endDate: o.p.endDate,
              })
            }
          } catch { /* not one of ours */ }
          idx += raw.length
        } else idx += 10
      }
      // dedupe by market id (page may render an item twice)
      const seen = new Set()
      positions = positions.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true })
      // stock valuations: the "companies":[ ... ] array
      const ci = u.indexOf('"companies":[')
      if (ci !== -1) {
        let j = u.indexOf('[', ci), depth2 = 0, inStr2 = false, esc2 = false
        for (let i = j; i < u.length; i++) {
          const ch = u[i]
          if (esc2) { esc2 = false; continue }
          if (ch === '\\') { esc2 = true; continue }
          if (ch === '"') { inStr2 = !inStr2; continue }
          if (inStr2) continue
          if (ch === '[') depth2++
          else if (ch === ']') { depth2--; if (depth2 === 0) { try { companies = JSON.parse(u.slice(j, i + 1)) } catch {} ; break } }
        }
      }
      liveOk = positions.length > 20 && companies.length > 50
      console.log(`FS markets: ${positions.length} positions, ${companies.length} companies (live ${liveOk ? 'OK' : 'INCOMPLETE'})`)
    }
  } catch (e) { console.warn('FS markets fetch:', e.message) }

  if (!liveOk) {
    // serve archive if the live scrape failed or came back partial
    try {
      if (fs.existsSync(FS_MARKETS_FILE)) {
        const arch = JSON.parse(fs.readFileSync(FS_MARKETS_FILE, 'utf8'))
        return { ...arch, liveOk: false, reason: 'live_unavailable_serving_archive' }
      }
    } catch {}
  }

  const settled = positions.filter(p => p.status === 'won' || p.status === 'lost')
  const data = {
    liveOk,
    fetchedAt: new Date().toISOString(),
    positions,
    companies,
    summary: {
      open: positions.filter(p => p.status === 'open').length,
      won: positions.filter(p => p.status === 'won').length,
      lost: positions.filter(p => p.status === 'lost').length,
      winRate: settled.length ? +(positions.filter(p => p.status === 'won').length / settled.length * 100).toFixed(1) : null,
      openValue: +positions.filter(p => p.status === 'open').reduce((s, p) => s + (p.value || 0), 0).toFixed(0),
      stocksLong: companies.filter(c => c.bucket === 'long').length,
      stocksShort: companies.filter(c => c.bucket === 'short').length,
    },
  }
  if (liveOk) {
    fsMarketsCache = { data, ts: Date.now() }
    try { fs.writeFileSync(FS_MARKETS_FILE, JSON.stringify(data)) } catch (e) { console.error('FS markets cache save:', e.message) }
  }
  return data
}

/* ── Ornn AI — GPU rental index + OTPI token prices ───────────────────────
   dashboard.ornnai.com publishes a genuinely public, no-auth REST API
   (api.ornnai.com): daily GPU compute rental indices (H100 SXM back to
   2024-06, A100 to 2024-01, plus H200/B200/RTX 5090) and OTPI — daily
   settled volume-weighted USD per million tokens, per lab (11 labs, ~1yr).
   Third methodology alongside our Vast+RunPod spot and SemiAnalysis 1-yr
   contract. Server pre-merges into chart-ready rows; disk archive fallback. */
let ornnCache = { data: null, ts: 0 }
const ORNN_TTL = 6 * 60 * 60 * 1000
const ORNN_FILE = path.join(__dirname, 'ornn-data.json')
const ORNN_GPUS = [
  { id: 'H100 SXM',  key: 'h100',  color: '#818cf8' },
  { id: 'H200',      key: 'h200',  color: '#22d3ee' },
  { id: 'B200',      key: 'b200',  color: '#f97316' },
  { id: 'A100 SXM4', key: 'a100',  color: '#4ade80' },
  { id: 'RTX 5090',  key: 'rtx5090', color: '#94a3b8' },
]
const ORNN_LABS = ['anthropic', 'openai', 'google', 'deepseek', 'z-ai', 'qwen', 'moonshotai', 'minimax', 'mistralai', 'meta-llama', 'xiaomi']

async function fetchOrnn() {
  if (ornnCache.data && Date.now() - ornnCache.ts < ORNN_TTL) return ornnCache.data
  const today = new Date().toISOString().slice(0, 10)
  let gpuSeries = {}, otpi = []
  try {
    await Promise.all([
      ...ORNN_GPUS.map(async g => {
        const url = `https://api.ornnai.com/api/gpu/${encodeURIComponent(g.id)}/index-history?startDate=2024-01-01&endDate=${today}`
        const resp = await fetch(url, { headers: { 'User-Agent': UA } })
        if (!resp.ok) return
        const j = await resp.json()
        if (j.success && Array.isArray(j.data)) gpuSeries[g.key] = j.data.map(r => ({ d: r.timestamp.slice(0, 10), v: r.index_value }))
      }),
      (async () => {
        const resp = await fetch(`https://api.ornnai.com/api/otpi?startDate=2025-01-01&endDate=${today}`, { headers: { 'User-Agent': UA } })
        if (!resp.ok) return
        const j = await resp.json()
        if (j.success && Array.isArray(j.data)) otpi = j.data
      })(),
    ])
  } catch (e) { console.warn('Ornn fetch:', e.message) }

  const liveOk = Object.keys(gpuSeries).length >= 4 && otpi.length > 100
  if (!liveOk) {
    try {
      if (fs.existsSync(ORNN_FILE)) {
        const arch = JSON.parse(fs.readFileSync(ORNN_FILE, 'utf8'))
        return { ...arch, liveOk: false, reason: 'live_unavailable_serving_archive' }
      }
    } catch {}
  }

  // merge GPU series onto one daily grid
  const gpuDates = [...new Set(Object.values(gpuSeries).flat().map(p => p.d))].sort()
  const byKey = Object.fromEntries(Object.entries(gpuSeries).map(([k, arr]) => [k, Object.fromEntries(arr.map(p => [p.d, p.v]))]))
  const gpuRows = gpuDates.map(d => {
    const row = { d }
    for (const g of ORNN_GPUS) { const v = byKey[g.key]?.[d]; if (v != null) row[g.key] = v }
    return row
  })
  const gpuLatest = {}
  for (const g of ORNN_GPUS) {
    const arr = gpuSeries[g.key] || []
    if (!arr.length) continue
    const cur = arr[arr.length - 1].v
    const d30 = arr.length > 30 ? arr[arr.length - 31].v : null
    gpuLatest[g.key] = { id: g.id, color: g.color, current: cur, chg30: d30 ? +(((cur / d30) - 1) * 100).toFixed(1) : null, since: arr[0].d }
  }

  // merge OTPI per-lab onto one daily grid
  const otpiDates = [...new Set(otpi.map(r => r.date))].sort()
  const otpiByLab = {}
  otpi.forEach(r => { (otpiByLab[r.lab] = otpiByLab[r.lab] || {})[r.date] = r.indexPerMtok })
  const otpiRows = otpiDates.map(d => {
    const row = { d }
    for (const lab of ORNN_LABS) { const v = otpiByLab[lab]?.[d]; if (v != null) row[lab] = +v.toFixed(4) }
    return row
  })
  const otpiLatest = {}
  for (const lab of ORNN_LABS) {
    const dates = Object.keys(otpiByLab[lab] || {}).sort()
    if (!dates.length) continue
    const cur = otpiByLab[lab][dates[dates.length - 1]]
    const past = dates.length > 30 ? otpiByLab[lab][dates[dates.length - 31]] : null
    otpiLatest[lab] = { current: +cur.toFixed(3), chg30: past ? +(((cur / past) - 1) * 100).toFixed(1) : null }
  }

  const data = { liveOk, fetchedAt: new Date().toISOString(), gpuRows, gpuLatest, otpiRows, otpiLatest }
  if (liveOk) {
    ornnCache = { data, ts: Date.now() }
    try { fs.writeFileSync(ORNN_FILE, JSON.stringify(data)) } catch (e) { console.error('Ornn cache save:', e.message) }
    console.log(`Ornn: ${gpuRows.length} GPU days (${Object.keys(gpuLatest).length} GPUs), ${otpiRows.length} OTPI days (${Object.keys(otpiLatest).length} labs)`)
  }
  return data
}

/* ── Vercel AI Gateway leaderboards — the second production sample ────────
   vercel.com/ai-gateway/leaderboards publishes token/request/SPEND shares
   by model and by lab (CC BY 4.0, updated daily), server-rendered into the
   page HTML. Spend share is the differentiator — no other public source
   shows where the DOLLARS go. Population skews product/enterprise (Vercel-
   hosted apps), the natural complement to OpenRouter's indie/agentic skew. */
let vercelAiCache = { data: null, ts: 0 }
const VERCEL_AI_TTL = 6 * 60 * 60 * 1000
const VERCEL_AI_FILE = path.join(__dirname, 'vercel-ai.json')

function parseVercelLeaderboard(html) {
  // rows render in strict DOM order: tokens list, requests list, spend list
  const rows = []
  const re = /leading-none">([^<]{2,48})<\/span><\/div><span class="[^"]*font-mono[^"]*">([\d.]+)%<\/span>/g
  let m
  while ((m = re.exec(html)) !== null) {
    rows.push({ name: m[1].replace(/&amp;/g, '&').trim(), pct: parseFloat(m[2]) })
  }
  if (rows.length < 9 || rows.length % 3 !== 0) return null
  const n = rows.length / 3
  return { tokens: rows.slice(0, n), requests: rows.slice(n, 2 * n), spend: rows.slice(2 * n) }
}

async function fetchVercelAi() {
  if (vercelAiCache.data && Date.now() - vercelAiCache.ts < VERCEL_AI_TTL) return vercelAiCache.data
  const headers = { 'User-Agent': UA, 'Accept': 'text/html' }
  let models = null, labs = null, windowLabel = null
  try {
    const [mResp, lResp] = await Promise.all([
      fetch('https://vercel.com/ai-gateway/leaderboards/models', { headers }),
      fetch('https://vercel.com/ai-gateway/leaderboards/labs', { headers }),
    ])
    if (mResp.ok) {
      const h = await mResp.text()
      models = parseVercelLeaderboard(h)
      const w = h.match(/([A-Z][a-z]{2} \d{1,2}, \d{4})\s*[–-]\s*([A-Z][a-z]{2} \d{1,2}, \d{4})/)
      if (w) windowLabel = `${w[1]} – ${w[2]}`
    }
    if (lResp.ok) labs = parseVercelLeaderboard(await lResp.text())
  } catch (e) { console.warn('Vercel AI fetch:', e.message) }

  const liveOk = !!(models && labs)
  if (!liveOk) {
    try {
      if (fs.existsSync(VERCEL_AI_FILE)) {
        const arch = JSON.parse(fs.readFileSync(VERCEL_AI_FILE, 'utf8'))
        return { ...arch, liveOk: false, reason: 'live_unavailable_serving_archive' }
      }
    } catch {}
  }

  // derived: per-lab spend-per-token index (1.0 = gateway average)
  const labStats = (labs?.tokens || []).map(t => {
    const spend = labs.spend.find(s => s.name === t.name)?.pct ?? null
    const reqs = labs.requests.find(r => r.name === t.name)?.pct ?? null
    return { lab: t.name, tokens: t.pct, requests: reqs, spend, spendPerTokenIdx: spend != null && t.pct > 0 ? +(spend / t.pct).toFixed(2) : null }
  })
  // include labs that appear in spend but not tokens top-10
  for (const s of labs?.spend || []) {
    if (!labStats.find(x => x.lab === s.name)) labStats.push({ lab: s.name, tokens: null, requests: null, spend: s.pct, spendPerTokenIdx: null })
  }

  const data = { liveOk, fetchedAt: new Date().toISOString(), window: windowLabel, models, labs, labStats }
  if (liveOk) {
    vercelAiCache = { data, ts: Date.now() }
    try { fs.writeFileSync(VERCEL_AI_FILE, JSON.stringify(data)) } catch (e) { console.error('Vercel AI cache save:', e.message) }
    console.log(`Vercel AI: ${models.tokens.length}x3 model rows, ${labs.tokens.length}x3 lab rows (${windowLabel || 'window n/a'})`)
  }
  return data
}

// Real Estate feeds (server/realEstateFeeds.js): Redfin, supply pipeline + FHFA lock-in,
// SLOOS + Kastle, metro layer, state build cost, Zillow rents, fair-value composite.
const reFeeds = createRealEstateFeeds({ fetchFredSeries, UA, dir: __dirname, stateFips: STATE_FIPS, fetchHousingHealth, fetchReplacementCost, fetchCreFundamentals, fetchReitCapRates })

// People screener (server/peopleScreener.js): revenue per employee across the S&P 500, monthly, two FMP calls per company
const peopleScreener = createPeopleScreener({ FMP_KEY, UA, dir: __dirname, tickers: SP500_TICKERS, sp500File: SP500_DATA_FILE })

// U.S. Pulse (server/usPulse.js): the U.S. Economy landing — leading indicators, consumer health, debt picture
const usPulse = createUsPulse({ fetchFredSeries, dir: __dirname })
// International Pulse (server/intlPulse.js): 13-economy board, dollar/risk/growth scores, Big Mac index re-marked at live FX
const intlPulse = createIntlPulse({ fetchFredSeries, fetchYahooQuote, fetchYahooSparkline, fetchCbRates, UA, dir: __dirname })
// The Economic Machine (server/machine.js): Dalio's three forces and three rules as a live tracker
const machine = createMachine({ fetchFredSeries, fetchYahooSparkline, dir: __dirname })
// Damodaran's monthly implied ERP (server/damodaranErp.js)
const damodaranErp = createDamodaranErp({ UA, dir: __dirname })
// Commodities Pulse (server/commodityPulse.js): the tape, real-price value, positioning, macro drivers
const commodityPulse = createCommodityPulse({ fetchFredSeries, fetchYahooSparkline, fetchCommoditySpot, UA, dir: __dirname, EIA_KEY })
// AI Pulse (server/aiPulse.js): the token tracker (OpenRouter archive), Artificial Analysis frontier, GPU rental rates
const aiPulse = createAiPulse({ getRankingsWithHistory, fetchOrnn, getSemiH100, AA_KEY, UA, dir: __dirname })
// SFC model (server/sfcModel.js): the stock-flow ledger + four-layer simulation, built offline by `python run_sfc.py`
const sfcModel = createSfcModel({ dir: __dirname })
// Bankruptcy tracker (server/bankruptcy.js): U.S. Courts F-2 quarterly, West Coast court RSS feeds, CourtListener, EDGAR, FRED credit stress
const bankruptcy = createBankruptcy({ fetchFredSeries, UA, dir: __dirname })
// Municipalities (server/municipalities.js): one metro at a time — labor, housing, prices, business, growth, the local majors.
// Reuses the Real Estate metro feed, the bankruptcy tracker and the zip reader.
const municipalities = createMunicipalities({ fetchFredSeries, fetchYahooQuote, fetchYahooSparkline, unzipEntries, UA, dir: __dirname, reMetro: code => reFeeds.metro(code), bankruptcy: () => bankruptcy.get() })
// Special situations (server/specialSituations.js): EDGAR sweeps for spinoffs, merger arb, restructurings,
// rights offerings and recaps; FMP insider purchases and 13Ds. Joins the bankruptcy tracker for petitions.
const specialSituations = createSpecialSituations({ fetchYahooSparkline, FMP_KEY, UA, dir: __dirname, bankruptcy: () => bankruptcy.get() })
// FX fundamentals (server/fxFundamentals.js): Donnelly's valuation lenses and drivers, fourteen currencies vs USD.
// Joins the International pulse feed (Big Mac, equity in dollars) and the central-bank rates route.
const fxFundamentals = createFxFundamentals({ fetchFredSeries, fetchCbRates, intlPulse: () => intlPulse.get(), UA, dir: __dirname })
// GPU unit economics (server/gpuEconomics.js): InferenceX throughput per generation against the AI pulse's rentals and data/ai/gpu-econ.json cost lines
const gpuEconomics = createGpuEconomics({ aiPulse: () => aiPulse.get(), UA, dir: __dirname })
// Token volume estimates (server/tokenEstimates.js): OpenAI/Anthropic bounded four ways from SEC XBRL,
// measured cost per token, realized price by lab and OpenRouter volume -- never from the labs' own disclosures
const tokenEstimates = createTokenEstimates({ aiPulse: () => aiPulse.get(), gpuEconomics: () => gpuEconomics.get(), UA, dir: __dirname })
// Owner wealth (server/ownerWealth.js): IRS SOI returns by state and county and AGI bracket,
// against BEA state proprietors' income -- the public read on where pass-through wealth lives
const ownerWealth = createOwnerWealth({ fetchFredSeries, UA, dir: __dirname, homeState: 'WA' })
// Household wealth (server/householdWealth.js): the Fed's Distributional Financial
// Accounts — the SCF carried forward quarterly — plus the SCF's own medians.
const householdWealth = createHouseholdWealth({ UA, dir: __dirname })
// Capex returns (server/capexReturns.js): FCF with the stock-comp adjustment, ROIC, ROIIC and
// Dickinson life-cycle staging from SEC XBRL -- the reproducible half of the Mauboussin paper
const capexReturns = createCapexReturns({ UA, dir: __dirname })

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'tickers-persist',
      configureServer(server) {
        createMetroComparison({dir: __dirname, getRents: () => reFeeds.rents()}).register(server)
        createMetroEmployment({dir: __dirname, blsKey: BLS_KEY}).register(server)
        createOptionsContext({dir: __dirname, fmpKey: FMP_KEY}).register(server)
        // Central bank rates endpoint (FMP calendar + FRED live series)
        server.middlewares.use('/api/cb-rates', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchCbRates()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // FRED relay — ALL client-side FRED traffic routes through here so it
        // shares the global throttle + retry + UA (the browser's ~40 direct
        // calls per reload are what helped trip FRED's Akamai IP block).
        // Serves the shared disk-backed cache, so reloads cost no FRED requests
        // and survive a dev-server restart.
        server.middlewares.use('/api/fred', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const u = new URL(req.url || '', 'http://localhost')
            // Netlify fork: the deployed site serves /api/fred/<ID>.json as a baked
            // file. Accept that shape here as well, so the client uses one URL in
            // dev and in production. Mounted at /api/fred, req.url arrives as
            // "/DGS10.json".
            const fromPath = (u.pathname.match(/^\/([A-Za-z0-9_.-]{1,64}?)(?:\.json)?$/) || [])[1]
            const id = (fromPath || u.searchParams.get('series_id') || '').trim()
            const limit = Math.max(1, Math.min(100000, parseInt(u.searchParams.get('limit') || '100', 10) || 100))
            if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) { res.statusCode = 400; res.end('{"error":"bad series_id"}'); return }
            const obs = await fetchFredSeries(id, limit) // shared cache, throttled, 429-retried
            // client expects FRED's native shape in DESC order (it reverses)
            res.end(JSON.stringify({ observations: obs.slice().reverse().map(o => ({ date: o.d, value: String(o.v) })) }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Vercel AI Gateway leaderboards — token/request/spend shares
        server.middlewares.use('/api/vercel-ai', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { vercelAiCache = { data: null, ts: 0 } }
            const data = await fetchVercelAi()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Ornn — GPU rental index + OTPI token prices (public API)
        server.middlewares.use('/api/ornn', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { ornnCache = { data: null, ts: 0 } }
            const data = await fetchOrnn()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // FutureSearch Markets — positions + valuations scraped from their page
        server.middlewares.use('/api/fs-markets', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { fsMarketsCache = { data: null, ts: 0 } }
            const data = await fetchFsMarkets()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // SemiAnalysis H100 1-year contract price index (free public slice)
        server.middlewares.use('/api/semi-h100', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { semiH100Cache = { data: null, ts: 0 } }
            const data = await getSemiH100()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message, available: false }))
          }
        })

        // TrendForce memory spot prices (self-built daily archive)
        server.middlewares.use('/api/memory', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { memoryCache = { data: null, ts: 0 } }
            const data = await getMemoryPrices()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message, available: false }))
          }
        })

        // Morningstar US Market Fair Value — bottom-up analyst P/FV, daily, archived
        server.middlewares.use('/api/ms-fair-value', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { msFvCache = { data: null, ts: 0 } }
            const data = await getMsFairValue()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message, available: false }))
          }
        })

        // Real Estate — commercial fundamentals (FRED bundle) and REIT-implied cap rates (FMP)
        server.middlewares.use('/api/cre-fundamentals', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { creCache = { data: null, ts: 0 } }
            res.end(JSON.stringify(await fetchCreFundamentals()))
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
        })
        // Real Estate feeds module — see server/realEstateFeeds.js
        const reRoute = (route, fn) => server.middlewares.use(route, async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try { res.end(JSON.stringify(await fn(req))) } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
        })
        // Netlify fork: the deployed site reaches FMP through
        // netlify/functions/fmp.js so the key stays server-side. Mirror that
        // path here, or `npm run dev` would send Stocks and Options to the SPA
        // fallback and they would fail on parsing HTML as JSON.
        server.middlewares.use('/api/fmp', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const u = new URL(req.url || '/', 'http://x')
            const endpoint = u.pathname.replace(/^\/+/, '').split('/')[0]
            if (!endpoint) { res.statusCode = 400; res.end('{"error":"no endpoint"}'); return }
            const qs = new URLSearchParams(u.search)
            qs.set('apikey', FMP_KEY || '')
            const r = await fetch(`https://financialmodelingprep.com/stable/${endpoint}?${qs}`, { headers: { 'User-Agent': UA } })
            res.statusCode = r.status
            res.end(await r.text())
          } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })) }
        })
        // Netlify fork: the deployed site serves one baked file per value, e.g.
        // /api/municipality/seattle.json. Accept that alongside the query form.
        // Mounted handlers see req.url stripped to "/seattle.json".
        const pathOrQuery = (req, key) => {
          const u = new URL(req.url || '/', 'http://x')
          const m = u.pathname.match(/^\/([A-Za-z0-9_.-]{1,64}?)(?:\.json)?$/)
          return m ? m[1] : (u.searchParams.get(key) || undefined)
        }

        // Token spot (server/tokenSpot.js): derives a token cost floor from the
        // GPU rental price using the prefill/decode physics, and plots it against
        // what the market actually charges. Takes getSemiH100/getAiPrices directly
        // rather than re-fetching its own copies over HTTP.
        const tokenSpot = createTokenSpot({ dir: __dirname, UA, semiH100: getSemiH100, aiPrices: getAiPrices })
        reRoute('/api/token-spot', () => tokenSpot.get())
        // Tightening monitor (server/tightening.js): duration supply, auction
        // absorption, the dollar's stock and flow, and the three derived views
        // (the tell, divergence, sequence). FRED via the shared cache plus two
        // Treasury FiscalData tables.
        const tightening = createTightening({ fetchFredSeries, UA, dir: __dirname })
        reRoute('/api/tightening', () => tightening.get())
        // Trade flows (server/tradeFlows.js): tariff vs exchange-rate
        // pass-through, dollar invoicing, REER vs current account, global
        // imbalances, the disinflation last mile. International → Forex and Pulse.
        const tradeFlows = createTradeFlows({ fetchFredSeries, UA, dir: __dirname })
        reRoute('/api/trade-flows', () => tradeFlows.get())

        reRoute('/api/us-pulse', () => usPulse.get())
        reRoute('/api/intl-pulse', () => intlPulse.get())
        reRoute('/api/machine', () => machine.get())
        reRoute('/api/damodaran-erp', () => damodaranErp.get())
        reRoute('/api/commodity-pulse', () => commodityPulse.get())
        reRoute('/api/ai-pulse', () => aiPulse.get())
        reRoute('/api/sfc', () => sfcModel.get())
        reRoute('/api/bankruptcy', () => bankruptcy.get())
        reRoute('/api/municipality', req => municipalities.get(pathOrQuery(req, 'city')))
        reRoute('/api/municipality-status', () => ({ cities: municipalities.status() }))
        reRoute('/api/special-situations', () => specialSituations.get())
        reRoute('/api/fx-fundamentals', () => fxFundamentals.get())
        reRoute('/api/gpu-economics', () => gpuEconomics.get())
        reRoute('/api/token-estimates', () => tokenEstimates.get())
        reRoute('/api/fred-cache', () => fredCacheStats())
        reRoute('/api/owner-wealth', () => ownerWealth.get())
        reRoute('/api/household-wealth', () => householdWealth.get())
        reRoute('/api/capex-returns', () => capexReturns.get())
        // the Deal Book: the user's pins, notes, dates and checklists, one JSON file
        server.middlewares.use('/api/special-dealbook', (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          if (req.method === 'GET') { res.end(JSON.stringify(specialSituations.dealBook.list())); return }
          if (req.method !== 'POST') { res.statusCode = 405; res.end('{"error":"GET or POST"}'); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => { try { res.end(JSON.stringify(specialSituations.dealBook.save(JSON.parse(body || '{}')))) } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })) } })
        })
        // Artificial Analysis key check — reports whether the key in .env works, never the key itself
        reRoute('/api/aa-check', async () => {
          if (!AA_KEY) return { configured: false, reason: 'ARTIFICIAL_ANALYSIS_KEY is not set in .env (restart the server after adding it)' }
          const r = await fetch('https://artificialanalysis.ai/api/v2/data/llms/models', { headers: { 'x-api-key': AA_KEY, 'User-Agent': UA } })
          if (!r.ok) return { configured: true, ok: false, status: r.status, keyLength: AA_KEY.length }
          const j = await r.json()
          return { configured: true, ok: true, models: (j.data || []).length, sample: (j.data || []).slice(0, 3).map(m => m.name), remaining: r.headers.get('x-ratelimit-remaining') }
        })
        reRoute('/api/redfin', () => reFeeds.redfin())
        reRoute('/api/re-pipeline', () => reFeeds.pipeline())
        reRoute('/api/cre-credit', () => reFeeds.creCredit())
        reRoute('/api/re-buildcost', () => reFeeds.buildCost())
        reRoute('/api/re-rents', () => reFeeds.rents())
        reRoute('/api/re-composite', () => reFeeds.composite())
        reRoute('/api/re-metro', req => { const code = pathOrQuery(req, 'code'); return code ? reFeeds.metro(code) : { metros: reFeeds.METROS } })
        // warm the slow ones (51 throttled FRED calls; a 9 MB download) after the startup burst
        setTimeout(() => { reFeeds.buildCost().catch(() => {}); reFeeds.redfin().catch(() => {}); reFeeds.rents().catch(() => {}) }, 90 * 1000)
        setTimeout(() => { usPulse.get().catch(() => {}) }, 150 * 1000)
        setTimeout(() => { intlPulse.get().catch(() => {}) }, 240 * 1000)
        setTimeout(() => { machine.get().catch(() => {}) }, 300 * 1000)
        setTimeout(() => { commodityPulse.get().catch(() => {}) }, 360 * 1000)
        setTimeout(() => { aiPulse.get().catch(() => {}) }, 420 * 1000)
        setTimeout(() => { bankruptcy.get().catch(() => {}) }, 20 * 1000)
        setTimeout(() => { specialSituations.get().catch(() => {}) }, 150 * 1000)
        setTimeout(() => { fxFundamentals.get().catch(() => {}) }, 330 * 1000) // after the intl pulse it joins
        setTimeout(() => { gpuEconomics.get().catch(() => {}) }, 540 * 1000) // after the AI pulse it joins
        setTimeout(() => { tokenEstimates.get().catch(() => {}) }, 660 * 1000) // after the GPU economics it joins
        setTimeout(() => { ownerWealth.get().catch(() => {}) }, 780 * 1000)
        setTimeout(() => { householdWealth.get().catch(() => {}) }, 810 * 1000)
        setTimeout(() => { capexReturns.get().catch(() => {}) }, 900 * 1000)
        setTimeout(() => { municipalities.get().catch(() => {}) }, 90 * 1000)
        // the remaining metros warm after the other feeds have had the throttle,
        // so switching cities is instant instead of a three-minute cold build
        setTimeout(() => { municipalities.warmAll().catch(() => {}) }, 480 * 1000)
        server.middlewares.use('/api/reit-caprates', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { reitCache = { data: null, ts: 0 } }
            res.end(JSON.stringify(await fetchReitCapRates()))
          } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
        })

        // AI pricing snapshot endpoint + auto-snapshot timer
        server.middlewares.use('/api/ai-prices', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            // ?refresh=1 busts the in-memory cache so the next call re-hits OpenRouter
            if ((req.url || '').includes('refresh=1')) {
              aiPricesCache = { data: null, ts: 0 }
              console.log('AI prices: cache busted by ?refresh=1')
            }
            const data = await getAiPrices()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Take initial snapshot on server start, then every 6 hours
        takeAiSnapshot().catch(e => console.error('Initial AI snapshot error:', e.message))
        setInterval(() => takeAiSnapshot().catch(e => console.error('AI snapshot error:', e.message)), AI_SNAP_INTERVAL)

        // AI Economic Impact endpoint
        server.middlewares.use('/api/ai-impact', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchAIImpact()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Global Liquidity & Debt — Fed/ECB/BOJ balance sheets, net liquidity,
        // money supply, US debt stack and who holds it. All in billions USD.
        server.middlewares.use('/api/global-liquidity', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              liquidityCache = { data: null, ts: 0 }
              console.log('Global liquidity: cache busted by ?refresh=1')
            }
            const data = await fetchGlobalLiquidity()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Hyperscaler quarterly AI capex (raw company capex; AI share %
        // applied client-side). Single most important demand-side signal.
        server.middlewares.use('/api/hyperscaler-capex', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              hyperscalerCapexCache = { data: null, ts: 0 }
              console.log('Hyperscaler capex: cache busted by ?refresh=1')
            }
            const data = await getHyperscalerCapex()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Dashboard summary — unified landing-page hero data (indexes,
        // commodities, crypto, rates). Single fetch for the Overview tab.
        server.middlewares.use('/api/dashboard-summary', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              dashboardSummaryCache = { data: null, ts: 0 }
              console.log('Dashboard summary: cache busted by ?refresh=1')
            }
            const data = await fetchDashboardSummary()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // AI Usage Signals — Stack Overflow tag activity + GitHub stars + (optional)
        // Cloudflare Radar AI traffic. Three complementary lenses on aggregate demand.
        server.middlewares.use('/api/usage-signals', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              usageSignalsCache = { data: null, ts: 0 }
              console.log('Usage signals: cache busted by ?refresh=1')
            }
            const data = await fetchUsageSignals()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // AI SDK Downloads — PyPI + npm install counts as a proxy for paid-API
        // token demand. Every commercial AI app installs an SDK first.
        server.middlewares.use('/api/sdk-downloads', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              sdkDownloadsCache = { data: null, ts: 0 }
              console.log('SDK downloads: cache busted by ?refresh=1')
            }
            const data = await getSdkDownloads()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Hugging Face rankings — replaces broken OpenRouter rankings.
        // Tracks top text-generation models by 30-day download count, persisted
        // daily so the trend chart accumulates real history over time.
        server.middlewares.use('/api/hf-rankings', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) {
              hfRankingsCache = { data: null, ts: 0 }
              console.log('HF rankings: cache busted by ?refresh=1')
            }
            const data = await getHfRankingsWithHistory()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // OpenRouter rankings — persisted history (fixes hockey-stick chart)
        server.middlewares.use('/api/or-rankings-history', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            // ?refresh=1 busts the in-memory cache and forces a live OpenRouter pull
            if ((req.url || '').includes('refresh=1')) {
              orRankingsCache = { data: null, ts: 0 }
              console.log('OpenRouter rankings: cache busted by ?refresh=1')
            }
            const data = await getRankingsWithHistory()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // Fear & Greed Composite endpoint
        server.middlewares.use('/api/fear-greed', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchFearGreed()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // BEA PCE Price Index endpoint
        server.middlewares.use('/api/bea-pce', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchBeaPCE()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // BLS CPI Category Data endpoint
        server.middlewares.use('/api/bls-cpi', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchBLSCPI()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // S&P 500 Screener endpoint
        server.middlewares.use('/api/people-screener', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try { res.end(JSON.stringify(peopleScreener.get())) } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
        })
        server.middlewares.use('/api/sp500-screener', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchSP500Screener()
            res.end(JSON.stringify({ stocks: data, lastUpdated: sp500Cache.ts }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })

        // S&P 500 screener: initial fetch on server start. With stale-while-
        // revalidate this returns instantly from disk cache (if any) and triggers
        // a background refresh — no blocking, no rate-limit storms even on Vite
        // hot-reloads.
        fetchSP500Screener().catch(e => console.error('Initial S&P 500 screener error:', e.message))

        // Precious metals historical chart endpoint
        server.middlewares.use('/api/metal-history', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchMetalHistory()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Commodity spot prices endpoint
        server.middlewares.use('/api/commodity-spot', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchCommoditySpot()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Index PE endpoint
        server.middlewares.use('/api/index-pe', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            const data = await fetchIndexPE()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Consumer Health — U.S. Economy › Consumer (mechanism, stress dial)
        server.middlewares.use('/api/consumer-health', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { consumerCache = { data: null, ts: 0 } }
            const data = await fetchConsumerHealth()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Kalecki-Levy profits decomposition (NIPA identity)
        server.middlewares.use('/api/kalecki', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { kaleckiCache = { data: null, ts: 0 } }
            const data = await fetchKalecki()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Bank credit — the lender's view of the credit cycle (H.8 + losses)
        server.middlewares.use('/api/bank-credit', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { bankCreditCache = { data: null, ts: 0 } }
            const data = await fetchBankCredit()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Housing health — synthesis gauges (affordability, supply, valuation)
        server.middlewares.use('/api/housing-health', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { housingHealthCache = { data: null, ts: 0 } }
            const data = await fetchHousingHealth()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Housing replacement cost — price vs cost-to-build (Tobin's Q)
        server.middlewares.use('/api/replacement-cost', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { replCostCache = { data: null, ts: 0 } }
            const data = await fetchReplacementCost()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Debt Market — credit spreads, refi squeeze, early-warning tiles,
        // FMP basket fundamentals
        server.middlewares.use('/api/debt-market', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { debtMarketCache = { data: null, ts: 0 } }
            const data = await fetchDebtMarket()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Macro Dashboard — U.S. Economy tab landing (tiles, recession lights,
        // regime quadrant, real-rate verdicts)
        server.middlewares.use('/api/macro-dashboard', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { macroDashCache = { data: null, ts: 0 } }
            const data = await fetchMacroDashboard()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Equity Risk Premium endpoint (earnings yield − 10Y, with history)
        server.middlewares.use('/api/erp', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          try {
            if ((req.url || '').includes('refresh=1')) { erpCache = { data: null, ts: 0 } }
            const data = await fetchErp()
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        // Chat endpoint — Claude Opus 5 (API key stays server-side)
        server.middlewares.use('/api/chat', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          if (req.method !== 'POST') { res.statusCode = 405; res.end('{"error":"POST only"}'); return }
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', async () => {
            try {
              const { messages, context } = JSON.parse(body)
              if (!ANTHROPIC_KEY) {
                res.statusCode = 503
                res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured — add it to .env and restart the dev server.' }))
                return
              }
              // Claude wants strictly alternating turns starting with the user
              const turns = (messages || [])
                .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
                .map(m => ({ role: m.role, content: String(m.content) }))
              while (turns.length && turns[0].role !== 'user') turns.shift()
              if (!turns.length) { res.statusCode = 400; res.end(JSON.stringify({ error: 'No user message.' })); return }

              const client = new Anthropic({ apiKey: ANTHROPIC_KEY })
              // Stream server-side (no HTTP timeout on long answers) and hand the
              // drawer the finished message as JSON, so the client stays simple.
              // Thinking is adaptive by default on Claude Opus 5 (nothing to set);
              // fallbacks: "default" re-runs a safety decline on Anthropic's
              // recommended fallback model instead of returning a refusal.
              const stream = client.beta.messages.stream({
                model: CHAT_MODEL,
                max_tokens: 4096,
                system: context || 'You are the analyst assistant inside a personal economic dashboard.',
                messages: turns,
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
              })
              const msg = await stream.finalMessage()
              if (msg.stop_reason === 'refusal') {
                res.end(JSON.stringify({ reply: `I can't help with that one (${msg.stop_details?.category || 'policy'}).`, model: msg.model, refused: true }))
                return
              }
              const reply = msg.content.filter(b => b.type === 'text').map(b => b.text).join('') || 'No response generated.'
              res.end(JSON.stringify({ reply, model: msg.model }))
            } catch (e) {
              res.statusCode = e?.status && e.status >= 400 && e.status < 600 ? e.status : 500
              res.end(JSON.stringify({ error: e?.message || String(e) }))
            }
          })
        })

        // Tickers persistence endpoint
        server.middlewares.use('/api/tickers', (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Access-Control-Allow-Origin', '*')
          if (req.method === 'GET') {
            try {
              const data = fs.existsSync(TICKERS_FILE)
                ? fs.readFileSync(TICKERS_FILE, 'utf8')
                : 'null'
              res.end(data)
            } catch { res.end('null') }
          } else if (req.method === 'POST') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', () => {
              try { fs.writeFileSync(TICKERS_FILE, body) } catch {}
              res.end('"ok"')
            })
          } else {
            res.statusCode = 405
            res.end()
          }
        })
      }
    }
  ],
  server: {
    // Honor a harness-assigned port (autoPort) so multiple sessions can run
    // side-by-side; fall back to the usual 5180.
    port: Number(process.env.PORT) || 5180,
    host: true,
    // OneDrive-synced folder: native fs events are unreliable (edits can be
    // invisible to the dev server until restart). Poll instead.
    watch: { usePolling: true, interval: 1200 },
    proxy: {
      '/cboe-api': {
        target: 'https://cdn.cboe.com/api/global/delayed_quotes/options',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cboe-api/, ''),
        secure: true,
      },
      '/fred-api': {
        target: 'https://api.stlouisfed.org',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/fred-api/, ''),
        secure: true,
      },
      '/or-rankings': {
        target: 'https://openrouter.ai',
        changeOrigin: true,
        rewrite: () => '/rankings',
        secure: true,
      },
      '/zillow-csv': {
        target: 'https://files.zillowstatic.com/research/public_csvs',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/zillow-csv/, ''),
        secure: true,
      },
      '/cftc-api': {
        target: 'https://publicreporting.cftc.gov/resource',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cftc-api/, ''),
        secure: true,
      }
    }
  }
})
