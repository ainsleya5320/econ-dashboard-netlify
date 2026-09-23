// ============================================================================
// TRADE FLOWS — currencies and trade, after Gita Gopinath's research (her
// Conversations with Tyler episode, Sept 2026, walked through most of it).
//
// Five pieces, one feed (/api/trade-flows):
//   passThrough  Tariffs against exchange rates. Under dominant-currency
//                pricing most U.S. imports are priced in dollars at sticky
//                prices, so a weaker yuan barely moves what the U.S. pays,
//                while a tariff lands straight on the dollar price. Tested
//                with BLS import prices by origin (which exclude duties)
//                regressed on each origin's currency, plus the effective
//                tariff rate from Treasury's monthly statement.
//   invoicing    Share of each economy's trade priced in dollars / euros /
//                renminbi / its own currency (data/fx/invoicing.json).
//   reerCa       Does a cheaper currency shrink the deficit? Five-year
//                changes in the BIS real exchange rate against five-year
//                changes in the current account. Her finding: weakly, because
//                trade balances follow relative demand more than prices.
//   imbalances   The sum of the world's current-account surpluses and deficits
//                as a share of world GDP, 1980 through the IMF's projections —
//                her warning that growing imbalances preceded the Plaza Accord
//                and 2008.
//   lastMile     Argentina's disinflation against past triple-digit episodes:
//                does the stretch from 30% to single digits take longer than
//                the fall from triple digits to 30%?
//
// Sources: FRED (BIS REER, BLS import prices, H.10 rates, Census imports,
// CPI), Treasury FiscalData MTS table 4 (customs duties, gross and refunds),
// IMF DataMapper (current accounts, GDP, inflation — keyless). Cached 12h in
// memory and on disk (trade-flows.json).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, TTL = 12 * H
const FD = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service'
const DM = 'https://www.imf.org/external/datamapper/api/v1'
const fin = v => v != null && Number.isFinite(v)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const median = xs => { const v = xs.filter(fin).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null }
// last full year of IMF actuals; later years in DataMapper are WEO projections
const LAST_ACTUAL = new Date().getUTCFullYear() - 1

function ols(xs, ys) {
  const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => fin(x) && fin(y))
  if (p.length < 8) return null
  const mx = mean(p.map(q => q[0])), my = mean(p.map(q => q[1]))
  let sxy = 0, sxx = 0, syy = 0
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2 }
  const beta = sxx > 0 ? sxy / sxx : null
  return { beta, corr: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null, n: p.length }
}
// daily or monthly [{d, v}] → Map('YYYY-MM' → monthly mean)
function monthly(obs) {
  const acc = new Map()
  for (const p of obs || []) { const m = p.d.slice(0, 7), a = acc.get(m) || [0, 0]; a[0] += p.v; a[1]++; acc.set(m, a) }
  return new Map([...acc].map(([m, [s, n]]) => [m, s / n]))
}
// IMF labels, shortened for tables: "Korea, Republic of" → "Korea"
const NAME_FIX = { 'Russian Federation': 'Russia', 'Taiwan Province of China': 'Taiwan', "China, People's Republic of": 'China', 'Hong Kong SAR': 'Hong Kong', 'Türkiye, Republic of': 'Türkiye', 'Korea, Republic of': 'Korea' }
const cleanName = n => NAME_FIX[n] || String(n || '').replace(/, (Republic of|Kingdom of|Islamic Republic of|Arab Republic of|The|State of)$/, '')
const yoy = (map, m) => { const [y, mo] = m.split('-'), prev = `${+y - 1}-${mo}`; const a = map.get(m), b = map.get(prev); return fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null }

// Import-price origins and the bilateral rate for each, as foreign currency
// per dollar (a rise = the origin's currency weakening). Manufacturing indices
// where BLS publishes one: an all-industries index for Canada is mostly oil,
// whose dollar price moves WITH the Canadian dollar, which fakes pass-through
// (β ≈ −1 on all industries, a commodity correlation, not pricing behaviour).
// China and Japan have no manufacturing split, but their U.S. imports are
// almost entirely manufactured goods.
const ORIGINS = [
  { key: 'china', name: 'China', ipi: 'CHNTOT', ipiLabel: 'all industries', fx: 'DEXCHUS', ccy: 'CNY', invert: false, inv: null },
  { key: 'japan', name: 'Japan', ipi: 'JPNTOT', ipiLabel: 'all industries', fx: 'DEXJPUS', ccy: 'JPY', invert: false, inv: 'JPN' },
  { key: 'eu', name: 'European Union', ipi: 'EECMANU', ipiLabel: 'manufacturing', fx: 'DEXUSEU', ccy: 'EUR', invert: true, inv: 'DEU' },
  { key: 'mexico', name: 'Mexico', ipi: 'MEXMANU', ipiLabel: 'manufacturing', fx: 'DEXMXUS', ccy: 'MXN', invert: false, inv: null },
  { key: 'canada', name: 'Canada', ipi: 'CANMANU', ipiLabel: 'manufacturing', fx: 'DEXCAUS', ccy: 'CAD', invert: false, inv: null },
]

// Economies for the exchange-rate-vs-current-account test: the Forex set.
const REER_SET = [
  { iso: 'USA', name: 'United States', reer: 'RBUSBIS' }, { iso: 'EURO', name: 'Euro area', reer: 'RBXMBIS' },
  { iso: 'JPN', name: 'Japan', reer: 'RBJPBIS' }, { iso: 'GBR', name: 'United Kingdom', reer: 'RBGBBIS' },
  { iso: 'CHE', name: 'Switzerland', reer: 'RBCHBIS' }, { iso: 'AUS', name: 'Australia', reer: 'RBAUBIS' },
  { iso: 'CAN', name: 'Canada', reer: 'RBCABIS' }, { iso: 'NZL', name: 'New Zealand', reer: 'RBNZBIS' },
  { iso: 'NOR', name: 'Norway', reer: 'RBNOBIS' }, { iso: 'SWE', name: 'Sweden', reer: 'RBSEBIS' },
  { iso: 'CHN', name: 'China', reer: 'RBCNBIS' }, { iso: 'IND', name: 'India', reer: 'RBINBIS' },
  { iso: 'KOR', name: 'Korea', reer: 'RBKRBIS' }, { iso: 'BRA', name: 'Brazil', reer: 'RBBRBIS' },
  { iso: 'MEX', name: 'Mexico', reer: 'RBMXBIS' },
]

// Groups for the imbalances chart. Membership is fixed at today's, which
// slightly misstates the euro area before its later joiners.
const EURO_AREA = ['AUT', 'BEL', 'BGR', 'CYP', 'DEU', 'ESP', 'EST', 'FIN', 'FRA', 'GRC', 'HRV', 'IRL', 'ITA', 'LTU', 'LUX', 'LVA', 'MLT', 'NLD', 'PRT', 'SVK', 'SVN']
const OIL = ['SAU', 'ARE', 'KWT', 'QAT', 'OMN', 'BHR', 'NOR', 'RUS', 'IRQ', 'IRN', 'DZA', 'NGA', 'AGO', 'VEN', 'LBY', 'KAZ', 'AZE']
const GROUPS = [
  { key: 'china', label: 'China', members: ['CHN'] },
  { key: 'euro', label: 'Euro area', members: EURO_AREA },
  { key: 'japan', label: 'Japan', members: ['JPN'] },
  { key: 'oil', label: 'Oil exporters', members: OIL },
  { key: 'us', label: 'United States', members: ['USA'] },
]

// Triple-digit inflation episodes. Each window brackets one episode; the
// clock starts at the LAST year at or above 100%, so a relapse (Brazil's
// early 1990s) does not restart it halfway down.
const EPISODES = [
  { iso: 'ARG', from: 2020, to: 2031, current: true },
  { iso: 'ISR', from: 1980, to: 2000 }, { iso: 'MEX', from: 1982, to: 2005 },
  { iso: 'BOL', from: 1982, to: 1996 }, { iso: 'ARG', from: 1985, to: 2000 },
  { iso: 'BRA', from: 1985, to: 2010 }, { iso: 'PER', from: 1985, to: 2005 },
  { iso: 'POL', from: 1985, to: 2005 }, { iso: 'RUS', from: 1991, to: 2012 },
  { iso: 'UKR', from: 1991, to: 2008 }, { iso: 'TUR', from: 1990, to: 2012 },
  { iso: 'BGR', from: 1990, to: 2005 }, { iso: 'ROU', from: 1990, to: 2008 },
]

export function createTradeFlows({ fetchFredSeries, UA, dir }) {
  const FILE = path.join(dir, 'trade-flows.json')
  let mem = null, inflight = null
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return null } }
  const save = o => { try { fs.writeFileSync(FILE, JSON.stringify(o)) } catch (e) { console.error('trade-flows save:', e.message) } }
  const F = async (id, limit) => { try { return await fetchFredSeries(id, limit) } catch { return [] } }
  const dm = async ind => {
    const r = await fetch(`${DM}/${ind}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) })
    if (!r.ok) throw new Error(`DataMapper ${ind} HTTP ${r.status}`)
    return (await r.json()).values?.[ind] || {}
  }

  async function build() {
    const t0 = Date.now()
    const invoicing = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'fx', 'invoicing.json'), 'utf8'))
    for (const e of Object.values(invoicing.economies)) e.name = cleanName(e.name)

    // ── IMF DataMapper ──
    const [ca, gdp, cpi, countries] = await Promise.all([
      dm('BCA_NGDPD'), dm('NGDPD'), dm('PCPIPCH'),
      fetch(`${DM}/countries`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) }).then(r => r.json()).then(j => j.countries || {}),
    ])
    const isCountry = iso => !!countries[iso]
    const nameOf = iso => cleanName(countries[iso]?.label || iso)

    // ── 1. pass-through ──
    const fred = {}
    for (const o of ORIGINS) { fred[o.ipi] = await F(o.ipi, 400); fred[o.fx] = await F(o.fx, 6500) }
    fred.IMP0015 = await F('IMP0015', 200)
    fred.CUSR0000SACL1E = await F('CUSR0000SACL1E', 200)

    const origins = ORIGINS.map(o => {
      const ipi = monthly(fred[o.ipi])
      const fxRaw = monthly(fred[o.fx])
      const fx = new Map([...fxRaw].map(([m, v]) => [m, o.invert ? 1 / v : v]))
      const months = [...ipi.keys()].filter(m => m >= '2005-01').sort()
      const dP = months.map(m => yoy(ipi, m)), dE = months.map(m => yoy(fx, m))
      const fit = ols(dE, dP)
      // Under producer-currency pricing a 10% weaker origin currency cuts the
      // dollar import price ~10% (β ≈ −1); under dollar pricing, ~0.
      const base = months.find(m => m >= '2015-01')
      const b0 = ipi.get(base), e0 = fx.get(base)
      const inv = o.inv ? invoicing.economies[o.inv]?.latest : null
      return {
        key: o.key, name: o.name, ccy: o.ccy, ipi: o.ipi, ipiLabel: o.ipiLabel, fx: o.fx,
        beta: r2(fit?.beta), corr: r2(fit?.corr), n: fit?.n ?? 0, from: months[0] || null,
        exportsInUSD: inv?.xUSD ?? null, invYear: inv?.year ?? null,
        // both rebased to 100 in Jan 2015, for the chart
        series: months.filter(m => m >= '2015-01').map(m => ({
          d: m, price: fin(ipi.get(m)) && b0 ? r1((ipi.get(m) / b0) * 100) : null,
          fx: fin(fx.get(m)) && e0 ? r1((fx.get(m) / e0) * 100) : null,
        })),
        last: { d: months.at(-1), priceYoY: r1(dP.at(-1)), fxYoY: r1(dE.at(-1)) },
      }
    })

    // Effective tariff rate: gross customs collections over customs-basis goods
    // imports, three-month sums (both not seasonally adjusted). Refunds are
    // shown apart — netting them would make 2026 read as a negative tariff.
    let tariff = [], tariffError = null
    try {
      const u = `${FD}/v1/accounting/mts/mts_table_4?filter=classification_desc:eq:Customs%20Duties&sort=record_date&page%5Bsize%5D=1000`
        + '&fields=record_date,current_month_gross_rcpt_amt,current_month_refund_amt,current_month_net_rcpt_amt'
      const rows = (await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90_000) }).then(r => r.json())).data || []
      const imp = monthly(fred.IMP0015)
      const cg = monthly(fred.CUSR0000SACL1E)
      const byM = rows.map(r => ({ d: r.record_date.slice(0, 7), gross: +r.current_month_gross_rcpt_amt / 1e9, refund: +r.current_month_refund_amt / 1e9, net: +r.current_month_net_rcpt_amt / 1e9 }))
      tariff = byM.map((p, i) => {
        const w = byM.slice(Math.max(0, i - 2), i + 1)
        const im = w.map(x => imp.get(x.d))
        const imSum = im.every(fin) && w.length === 3 ? im.reduce((a, b) => a + b, 0) / 1000 : null // $B
        return {
          d: p.d, gross: r1(p.gross), refund: r1(p.refund), net: r1(p.net),
          rate: fin(imSum) && imSum > 0 ? r2((w.reduce((s, x) => s + x.gross, 0) / imSum) * 100) : null,
          coreGoods: r2(yoy(cg, p.d)),
        }
      })
    } catch (e) { tariffError = e.message; console.error('trade-flows: tariffs —', e.message) }

    // ── 3. does a cheaper currency shrink the deficit? ──
    const reerRaw = {}
    for (const e of REER_SET) reerRaw[e.iso] = await F(e.reer, 500)
    const points = []
    for (const e of REER_SET) {
      const byYear = new Map()
      for (const p of reerRaw[e.iso]) { const y = +p.d.slice(0, 4), a = byYear.get(y) || []; a.push(p.v); byYear.set(y, a) }
      const annual = new Map([...byYear].filter(([, a]) => a.length >= 10).map(([y, a]) => [y, mean(a)]))
      const caRow = ca[e.iso] || {}
      // non-overlapping five-year windows ending in the last year of actuals
      for (let y1 = LAST_ACTUAL; y1 - 5 >= 1995; y1 -= 5) {
        const y0 = y1 - 5
        const r0 = annual.get(y0), rr = annual.get(y1), c0 = caRow[y0], c1 = caRow[y1]
        if (![r0, rr, c0, c1].every(fin)) continue
        points.push({ iso: e.iso, name: e.name, window: `${y0}–${y1}`, latest: y1 === LAST_ACTUAL, dReer: r1((rr / r0 - 1) * 100), dCa: r1(c1 - c0) })
      }
    }
    const fitRC = ols(points.map(p => p.dReer), points.map(p => p.dCa))
    // the textbook: cheaper currency (REER down) → better current account (up)
    const moved = points.filter(p => Math.abs(p.dReer) >= 5)
    const textbook = moved.filter(p => Math.sign(p.dCa) === -Math.sign(p.dReer)).length
    const reerCa = {
      points, beta: r2(fitRC?.beta), corr: r2(fitRC?.corr), n: points.length,
      bigMoves: moved.length, textbook, textbookShare: moved.length ? Math.round((textbook / moved.length) * 100) : null,
      lastActual: LAST_ACTUAL,
    }

    // ── 4. global imbalances ──
    const years = []
    for (let y = 1980; y <= LAST_ACTUAL + 6; y++) years.push(y)
    const imbalances = years.map(y => {
      let world = 0, pos = 0, neg = 0, n = 0
      const caUsd = {}
      for (const iso of Object.keys(ca)) {
        if (!isCountry(iso)) continue
        const c = ca[iso]?.[y], g = gdp[iso]?.[y]
        if (!fin(c) || !fin(g)) continue
        const v = (c / 100) * g
        caUsd[iso] = v; world += g; n++
        if (v > 0) pos += v; else neg += v
      }
      if (!world || n < 100) return null
      const row = { y, proj: y > LAST_ACTUAL, surpluses: r2((pos / world) * 100), deficits: r2((neg / world) * 100), gross: r2(((pos - neg) / world) * 100) }
      let grouped = 0
      for (const g of GROUPS) {
        const s = g.members.reduce((a, iso) => a + (caUsd[iso] || 0), 0)
        row[g.key] = r2((s / world) * 100); grouped += s
      }
      row.rest = r2(((pos + neg - grouped) / world) * 100)
      return row
    }).filter(Boolean)
    // largest balances in the last year of actuals, % of world GDP
    const topYear = imbalances.find(r => r.y === LAST_ACTUAL) ? LAST_ACTUAL : imbalances.filter(r => !r.proj).at(-1)?.y
    const world0 = Object.keys(gdp).filter(isCountry).reduce((a, iso) => a + (fin(gdp[iso]?.[topYear]) ? gdp[iso][topYear] : 0), 0)
    const largest = Object.keys(ca).filter(isCountry).map(iso => {
      const c = ca[iso]?.[topYear], g = gdp[iso]?.[topYear]
      return fin(c) && fin(g) ? { iso, name: nameOf(iso), ca: r1(c), usdB: r1((c / 100) * g), world: r2(((c / 100) * g / world0) * 100) } : null
    }).filter(Boolean).sort((a, b) => Math.abs(b.usdB) - Math.abs(a.usdB)).slice(0, 10)

    // ── 5. the last mile ──
    const lastMile = EPISODES.map(ep => {
      const row = cpi[ep.iso] || {}
      let t0 = null
      for (let y = ep.from; y <= ep.to; y++) if (fin(row[y]) && row[y] >= 100) t0 = y
      if (t0 == null) return null
      const firstBelow = (lvl, after) => { for (let y = after + 1; y <= Math.min(ep.to, t0 + 20); y++) if (fin(row[y]) && row[y] < lvl) return y; return null }
      const y30 = firstBelow(30, t0), y10 = y30 != null ? firstBelow(10, y30 - 1) : null
      const trail = []
      for (let t = -2; t <= 12; t++) { const y = t0 + t; if (y > ep.to) break; if (fin(row[y])) trail.push({ t, y, v: r1(row[y]), proj: y > LAST_ACTUAL }) }
      return {
        key: `${ep.iso}-${t0}`, iso: ep.iso, name: nameOf(ep.iso), current: !!ep.current, t0, peak: r1(Math.max(...trail.filter(p => p.t <= 0).map(p => p.v))),
        y30, y10, firstMile: y30 != null ? y30 - t0 : null, lastMile: y30 != null && y10 != null ? y10 - y30 : null,
        projected: (y30 != null && y30 > LAST_ACTUAL) || (y10 != null && y10 > LAST_ACTUAL), path: trail,
      }
    }).filter(Boolean)
    const past = lastMile.filter(e => !e.current && e.firstMile != null && e.lastMile != null)
    const lastMileStats = {
      medianFirst: median(past.map(e => e.firstMile)), medianLast: median(past.map(e => e.lastMile)),
      longer: past.filter(e => e.lastMile > e.firstMile).length, n: past.length,
    }

    return {
      built: new Date().toISOString(), tookMs: Date.now() - t0, tariffError, lastActual: LAST_ACTUAL,
      passThrough: { origins, tariff },
      invoicing,
      reerCa, imbalances, largest, largestYear: topYear, lastMile, lastMileStats,
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    if (!mem) {
      const disk = load()
      if (disk?.built && Date.now() - Date.parse(disk.built) < TTL) { mem = { ts: Date.parse(disk.built), data: disk }; return disk }
    }
    if (inflight) return inflight
    inflight = (async () => {
      try { const data = await build(); mem = { ts: Date.now(), data }; save(data); return data }
      catch (e) { const disk = load(); if (disk) return disk; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
