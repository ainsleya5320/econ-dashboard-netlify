// ============================================================================
// TIGHTENING MONITOR — a leading-indicator board for one specific worry: that
// the AI investment boom tightens financial conditions through the bond market
// before the stock market notices.
//
// The mechanism, in the stock-flow terms the Fed uses to explain QE and QT:
// duration supply (Treasury coupons, Fed runoff, AI-related corporate debt)
// has to be absorbed by private and foreign buyers, and if they are unwilling
// the term premium and credit spreads rise. The dollar adds the foreign
// channel. If the world decides it holds too much of the U.S. stock (the net
// international investment position), yields rise WHILE the dollar falls and
// auctions go badly. That combination is the tell.
//
// Composite financial-conditions indices sit at the end as the scoreboard, not
// the signal: an equity boom registers as loosening until it stops.
//
// Three derived views carry the page:
//   tell        yields up + dollar down + weak auctions in the same four weeks,
//               each threshold one standard deviation of its own four-week move
//   divergence  bond-and-dollar stress (mean z-score) against equity extension
//   sequence    for each gauge, when it crossed its warning line (z >= 1 in the
//               stress direction, five-year window) — i.e. who moved first
//
// Sources: FRED through the shared disk-cached fetchFredSeries, plus Treasury
// FiscalData — auction results (who bought) and the monthly statement of the
// public debt (bills vs coupons). Auction TAILS need the when-issued yield at
// the close, a dealer quote that is not public, so they are not here.
// Cached 6h in memory and on disk (tightening.json).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, TTL = 6 * H
const FD = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service'
const fin = v => v != null && Number.isFinite(v)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const sd = xs => { const v = xs.filter(fin), m = mean(v); return v.length > 1 ? Math.sqrt(mean(v.map(x => (x - m) ** 2))) : null }
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null } // FiscalData sends the string "null"
const DAY = 864e5
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10)

// How much history each series needs. Daily series get ~16 years so a
// five-year z window still leaves ten years of output.
const FRED_IDS = {
  DGS10: 4200, THREEFYTP10: 4200, BAA10Y: 4200, BAMLH0A0HYM2: 1000, DTWEXBGS: 4200, SP500: 2700,
  SOFR: 2200, IORB: 1400, WMTSECL1: 1100, WRESBAL: 1100, SWPT: 1100, TREAST: 1100,
  NFCI: 1100, NFCICREDIT: 1100, NFCILEVERAGE: 1100, NFCIRISK: 1100, STLFSI4: 700,
  IEABC: 120, IIPUSNETIQ: 120, GDP: 140, FDHBFIN: 120, FDHBFRBN: 120, FDHBATN: 120, GFDEBTN: 120,
}

// ── series algebra on a weekly (Friday) grid ──
function fridays(from, to) {
  const out = [], d = new Date(from + 'T00:00:00Z')
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1)
  const end = Date.parse(to + 'T00:00:00Z')
  for (; d.getTime() <= end; d.setUTCDate(d.getUTCDate() + 7)) out.push(d.toISOString().slice(0, 10))
  if (out[out.length - 1] < to) out.push(to) // the latest print, even mid-week
  return out
}
// last observation on or before each grid date, carried forward at most maxGap days
function sample(obs, grid, maxGap = 21) {
  let j = -1
  return grid.map(g => {
    while (j + 1 < obs.length && obs[j + 1].d <= g) j++
    if (j < 0) return null
    return (Date.parse(g) - Date.parse(obs[j].d)) / DAY <= maxGap ? obs[j].v : null
  })
}
const chg = (a, k) => a.map((v, i) => (i >= k && fin(v) && fin(a[i - k]) ? v - a[i - k] : null))
const pchg = (a, k) => a.map((v, i) => (i >= k && fin(v) && fin(a[i - k]) && a[i - k] !== 0 ? (v / a[i - k] - 1) * 100 : null))
// z against the trailing five years, excluding the point itself
function rollZ(a, W = 260, minN = 104) {
  return a.map((v, i) => {
    if (!fin(v)) return null
    const win = a.slice(Math.max(0, i - W), i).filter(fin)
    if (win.length < minN) return null
    const m = mean(win), s = sd(win)
    return s > 0 ? (v - m) / s : null
  })
}

// ── Treasury auctions ──
function tenorYears(term) {
  const y = /(\d+)-Year/.exec(term || ''), m = /(\d+)-Month/.exec(term || '')
  const t = (y ? +y[1] : 0) + (m ? +m[1] / 12 : 0)
  return t > 0 ? t : null
}
// modified duration of a par bond, semiannual coupons
const parDuration = (T, yPct) => { const y = (fin(yPct) && yPct > 0.05 ? yPct : 4) / 100; return (1 - Math.pow(1 + y / 2, -2 * T)) / y }

function shapeAuctions(rows) {
  const out = rows.map(r => {
    const pd = num(r.primary_dealer_accepted), dir = num(r.direct_bidder_accepted), ind = num(r.indirect_bidder_accepted)
    const comp = (pd || 0) + (dir || 0) + (ind || 0)
    const tips = r.inflation_index_security === 'Yes', frn = r.floating_rate === 'Yes'
    return {
      d: r.auction_date, term: r.security_term, tenor: r.original_security_term && r.original_security_term !== 'null' ? r.original_security_term : r.security_term,
      T: tenorYears(r.security_term), reopen: r.reopening === 'Yes', tips, frn,
      kind: tips ? 'TIPS' : frn ? 'FRN' : 'nominal',
      size: fin(num(r.offering_amt)) ? num(r.offering_amt) / 1e9 : null,
      hy: num(r.high_yield), btc: num(r.bid_to_cover_ratio),
      ind: comp > 0 && fin(ind) ? (ind / comp) * 100 : null,
      dir: comp > 0 && fin(dir) ? (dir / comp) * 100 : null,
      dealer: comp > 0 && fin(pd) ? (pd / comp) * 100 : null,
    }
  }).filter(a => a.d && fin(a.size)).sort((x, y) => x.d.localeCompare(y.d))
  // each auction against the last six of the same tenor and kind — a 30-year
  // is judged against 30-years, not against 2-years
  const hist = new Map()
  for (const a of out) {
    const k = `${a.kind}|${a.tenor}`, prev = hist.get(k) || []
    const p = prev.slice(-6)
    if (p.length >= 3) {
      if (fin(a.ind)) a.dInd = a.ind - mean(p.map(x => x.ind))
      if (fin(a.dealer)) a.dDealer = a.dealer - mean(p.map(x => x.dealer))
      if (fin(a.btc)) a.dBtc = a.btc - mean(p.map(x => x.btc))
    }
    if (fin(a.ind)) prev.push(a)
    hist.set(k, prev)
  }
  return out
}

// mean of a field over auctions in the trailing `days` before each grid date
function auctionWindow(auctions, grid, field, days) {
  let lo = 0, hi = 0
  return grid.map(g => {
    const from = addDays(g, -days)
    while (hi < auctions.length && auctions[hi].d <= g) hi++
    while (lo < hi && auctions[lo].d <= from) lo++
    return mean(auctions.slice(lo, hi).map(a => a[field]))
  })
}

async function fdAll(UA, pathQ) {
  const out = []
  for (let page = 1; page <= 12; page++) {
    const url = `${FD}${pathQ}&page%5Bsize%5D=10000&page%5Bnumber%5D=${page}`
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90_000) })
    if (!r.ok) throw new Error(`FiscalData ${r.status} for ${pathQ.split('?')[0]}`)
    const j = await r.json()
    out.push(...(j.data || []))
    if (page >= (j.meta?.['total-pages'] || 1)) break
  }
  return out
}

// The gauges. `t` is the transform onto the weekly grid; `sign` is the stress
// direction (+1: higher is tighter; -1: lower is tighter); `home` is the page
// that owns the full chart, so the board never pretends to be the detail.
const GAUGES = [
  { key: 'tp', label: '10-year term premium', block: 'Price of duration', unit: 'pp', sign: 1, home: 'Rates & Fed → Treasuries', composite: true,
    why: 'What investors charge to hold duration. The stock view says it rises when more duration must be absorbed than buyers want.' },
  { key: 'y10', label: '10-year yield, 13-week change', block: 'Price of duration', unit: 'bp', sign: 1, home: 'Rates & Fed → Treasuries', composite: true,
    why: 'The level is policy; the pace of the move is the stress.' },
  { key: 'ind', label: 'Auction indirect share vs norm', block: 'Absorption', unit: 'pp', sign: -1, home: 'here', composite: true,
    why: 'Foreign and fund demand at coupon auctions over the last eight weeks, each auction against the last six of its own tenor.' },
  { key: 'dealer', label: 'Dealer takedown vs norm', block: 'Absorption', unit: 'pp', sign: 1, home: 'here',
    why: 'What primary dealers were left holding because nobody else bid.' },
  { key: 'fo', label: 'Foreign official holdings, 13-week change', block: 'Absorption', unit: '%', sign: -1, home: 'here', composite: true,
    why: 'Treasuries the NY Fed holds in custody for foreign central banks, weekly — the fastest read on whether they are adding or trimming.' },
  { key: 'usd', label: 'Broad dollar, 13-week change', block: 'Dollar', unit: '%', sign: -1, home: 'International', composite: true,
    why: 'Here a FALLING dollar is the stress direction: foreigners stepping back from U.S. assets. A funding squeeze pushes the dollar up instead, and shows in the swap lines.' },
  { key: 'baa', label: 'Baa corporate spread to the 10-year', block: 'Credit', unit: 'pp', sign: 1, home: 'Credit → Corporate', composite: true,
    why: 'The long-history credit spread (since 1986), used to judge how unusual a reading is.' },
  { key: 'hy', label: 'High-yield spread', block: 'Credit', unit: 'pp', sign: 1, home: 'Credit → Corporate',
    why: 'Where levered AI borrowers price. FRED now keeps only three years, so its z-score window is short.' },
  { key: 'repo', label: 'SOFR minus IORB', block: 'Plumbing', unit: 'bp', sign: 1, home: 'Rates & Fed → Treasuries',
    why: 'Repo trading above the rate the Fed pays on reserves means reserves are getting scarce.' },
  { key: 'res', label: 'Bank reserves, 13-week change', block: 'Plumbing', unit: '%', sign: -1, home: 'Rates & Fed → Fed balance sheet',
    why: 'The cushion that absorbs Treasury cash-balance swings and runoff.' },
  { key: 'swpt', label: 'Fed dollar swap lines', block: 'Plumbing', unit: '$B', sign: 1, home: 'Rates & Fed → Fed balance sheet', threshold: 5,
    why: 'Free stand-in for cross-currency basis stress: foreign central banks borrow dollars from the Fed only when offshore funding breaks. Lit above $5B.' },
  { key: 'nfci', label: 'Chicago Fed NFCI', block: 'Scoreboard', unit: 'idx', sign: 1, home: 'here',
    why: 'The lagging scoreboard, kept on the board to test whether it does lag.' },
]

export function createTightening({ fetchFredSeries, UA, dir }) {
  const FILE = path.join(dir, 'tightening.json')
  let mem = null, inflight = null
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return null } }
  const save = o => { try { fs.writeFileSync(FILE, JSON.stringify(o)) } catch (e) { console.error('tightening save:', e.message) } }

  async function build() {
    const t0 = Date.now()
    const raw = {}
    for (const [id, limit] of Object.entries(FRED_IDS)) {
      try { raw[id] = await fetchFredSeries(id, limit) } catch { raw[id] = [] }
    }
    const got = Object.values(raw).filter(o => o.length > 5).length
    if (got < Object.keys(FRED_IDS).length * 0.8) throw new Error(`only ${got}/${Object.keys(FRED_IDS).length} FRED series came back`)

    // ── Treasury FiscalData: auctions and the debt mix ──
    let auctions = [], mspd = [], fdError = null
    try {
      const [aRows, mRows] = await Promise.all([
        fdAll(UA, '/v1/accounting/od/auctions_query?filter=security_type:in:(Note,Bond),auction_date:gte:2000-01-01'
          + '&fields=auction_date,security_term,original_security_term,reopening,inflation_index_security,floating_rate,offering_amt,high_yield,bid_to_cover_ratio,primary_dealer_accepted,direct_bidder_accepted,indirect_bidder_accepted'
          + '&sort=auction_date'),
        fdAll(UA, '/v1/debt/mspd/mspd_table_1?filter=security_type_desc:in:(Marketable,Total Marketable)&fields=record_date,security_type_desc,security_class_desc,total_mil_amt&sort=record_date'),
      ])
      auctions = shapeAuctions(aRows)
      mspd = mRows
    } catch (e) { fdError = e.message; console.error('tightening: fiscaldata —', e.message) }
    const coupons = auctions.filter(a => a.kind === 'nominal' && fin(a.ind))

    // ── the weekly grid ──
    const lastDaily = ['DGS10', 'DTWEXBGS', 'BAA10Y'].map(id => raw[id].at(-1)?.d).filter(Boolean).sort().at(-1)
    const grid = fridays('2006-01-06', lastDaily)
    const S = (id, gap) => sample(raw[id] || [], grid, gap)
    const dgs10 = S('DGS10'), usd = S('DTWEXBGS')
    const sofr = S('SOFR'), iorb = S('IORB')
    const sp = raw.SP500 || []
    // equity extension: % above the 200-day average, computed on the daily series
    const spExt = sp.map((p, i) => (i >= 199 ? { d: p.d, v: (p.v / mean(sp.slice(i - 199, i + 1).map(x => x.v)) - 1) * 100 } : null)).filter(Boolean)
    const swptB = S('SWPT', 14).map(v => (fin(v) ? v / 1000 : null))

    const base = {
      tp: S('THREEFYTP10'),
      y10: chg(dgs10, 13).map(v => (fin(v) ? v * 100 : null)),
      ind: auctionWindow(coupons, grid, 'dInd', 56),
      dealer: auctionWindow(coupons, grid, 'dDealer', 56),
      fo: pchg(S('WMTSECL1', 14), 13),
      usd: pchg(usd, 13),
      baa: S('BAA10Y'),
      hy: S('BAMLH0A0HYM2'),
      repo: sofr.map((v, i) => (fin(v) && fin(iorb[i]) ? (v - iorb[i]) * 100 : null)),
      res: pchg(S('WRESBAL', 14), 13),
      swpt: swptB,
      nfci: S('NFCI', 14),
    }
    const stressZ = {}
    for (const g of GAUGES) {
      if (g.threshold != null) { stressZ[g.key] = base[g.key].map(v => (fin(v) ? (v > g.threshold ? 1 : 0) : null)); continue }
      stressZ[g.key] = rollZ(base[g.key]).map(z => (fin(z) ? z * g.sign : null))
    }

    // ── sequence: who crossed the warning line first ──
    const n = grid.length, from = Math.max(0, n - 53)
    const sequence = GAUGES.map(g => {
      const s = stressZ[g.key]
      const above = i => fin(s[i]) && s[i] >= 1
      let status = 'quiet', since = null, lastLit = null
      if (above(n - 1)) {
        let i = n - 1
        while (i > 0 && above(i - 1)) i--
        status = 'above'; since = grid[i]
      } else {
        for (let i = n - 2; i >= from; i--) if (above(i)) { lastLit = grid[i]; status = 'crossed'; break }
      }
      const lastIdx = (() => { for (let i = n - 1; i >= 0; i--) if (fin(base[g.key][i])) return i; return -1 })()
      return {
        key: g.key, label: g.label, block: g.block, unit: g.unit, home: g.home, why: g.why, threshold: g.threshold ?? null,
        value: lastIdx >= 0 ? r2(base[g.key][lastIdx]) : null, asOf: lastIdx >= 0 ? grid[lastIdx] : null,
        z: g.threshold != null ? null : r2(s[n - 1] ?? s[lastIdx]),
        status, since, lastLit,
      }
    })
    const rank = { above: 0, crossed: 1, quiet: 2 }
    sequence.sort((a, b) => rank[a.status] - rank[b.status]
      || (a.status === 'above' ? a.since.localeCompare(b.since) : a.status === 'crossed' ? b.lastLit.localeCompare(a.lastLit) : (b.z ?? -9) - (a.z ?? -9)))

    // ── divergence: bond-and-dollar stress against equity extension ──
    const compKeys = GAUGES.filter(g => g.composite).map(g => g.key)
    const stress = grid.map((_, i) => { const zs = compKeys.map(k => stressZ[k][i]).filter(fin); return zs.length >= 4 ? mean(zs) : null })
    const equity = rollZ(sample(spExt, grid, 7))
    const divergence = grid.map((d, i) => ({ d, stress: r2(stress[i]), equity: r2(equity[i]) })).filter(p => fin(p.stress) || fin(p.equity)).slice(-520)
    const lastDiv = [...divergence].reverse().find(p => fin(p.stress) && fin(p.equity)) || null
    const quadrant = !lastDiv ? null
      : lastDiv.stress >= 0.5 && lastDiv.equity >= 0.5 ? { key: 'warning', label: 'Bonds tightening under a strong stock market', tone: 'red' }
      : lastDiv.stress >= 0.5 ? { key: 'riskoff', label: 'Risk-off — both markets see it', tone: 'amber' }
      : lastDiv.equity >= 0.5 ? { key: 'boom', label: 'Boom with easy bond conditions', tone: 'green' }
      : { key: 'quiet', label: 'Quiet on both sides', tone: 'slate' }

    // ── the tell: yields up, dollar down, auctions weak, same four weeks ──
    const y4 = chg(dgs10, 4).map(v => (fin(v) ? v * 100 : null)), d4 = pchg(usd, 4)
    const a4 = auctionWindow(coupons, grid, 'dInd', 28)
    const yT = sd(y4), dT = sd(d4), aT = sd(a4)
    const lit = i => ({ y: fin(y4[i]) && y4[i] >= yT, d: fin(d4[i]) && d4[i] <= -dT, a: fin(a4[i]) && a4[i] <= -aT })
    // Episodes of weeks with at least `k` lamps lit, merged across gaps of up
    // to five weeks. All three together is rare, so the two-of-three record is
    // what gives the light a track record at all.
    const episodesOf = k => {
      const out = []
      for (let i = 0; i < n; i++) {
        const L = lit(i), on = ['y', 'd', 'a'].filter(x => L[x])
        if (on.length < k) continue
        const e = out[out.length - 1]
        if (e && (Date.parse(grid[i]) - Date.parse(e.to)) / DAY <= 35) { e.to = grid[i]; for (const x of on) if (!e.lamps.includes(x)) e.lamps.push(x) }
        else out.push({ from: grid[i], to: grid[i], lamps: on })
      }
      return out
    }
    const episodes = episodesOf(3), pairs = episodesOf(2)
    const lastWhen = key => { for (let i = n - 1; i >= 0; i--) if (lit(i)[key]) return grid[i]; return null }
    const L = lit(n - 1)
    const tell = {
      lamps: [
        { key: 'y', label: '10-year yield up', value: r1(y4[n - 1]), unit: 'bp in 4 weeks', threshold: `≥ +${Math.round(yT)}bp`, lit: L.y, last: lastWhen('y') },
        { key: 'd', label: 'Dollar down', value: r2(d4[n - 1]), unit: '% in 4 weeks', threshold: `≤ −${dT.toFixed(1)}%`, lit: L.d, last: lastWhen('d') },
        { key: 'a', label: 'Auctions weak', value: r1(a4[n - 1]), unit: 'pp indirect share vs norm, 4 weeks', threshold: fin(aT) ? `≤ −${aT.toFixed(1)}pp` : '—', lit: L.a, last: lastWhen('a') },
      ],
      count: [L.y, L.d, L.a].filter(Boolean).length,
      episodes: episodes.slice(-8), pairs: pairs.slice(-10), pairCount: pairs.length,
      since: grid.find((_, i) => fin(y4[i]) && fin(d4[i]) && fin(a4[i])) || null,
    }

    // ── supply ──
    const billsShare = (() => {
      const byM = new Map()
      for (const r of mspd) {
        const m = r.record_date.slice(0, 7), e = byM.get(m) || {}
        if (r.security_type_desc === 'Marketable' && r.security_class_desc === 'Bills') e.bills = num(r.total_mil_amt)
        if (r.security_type_desc === 'Total Marketable') e.total = num(r.total_mil_amt)
        byM.set(m, e)
      }
      return [...byM].filter(([, e]) => fin(e.bills) && fin(e.total) && e.total > 0)
        .map(([d, e]) => ({ d, share: r1((e.bills / e.total) * 100), totalT: r2(e.total / 1e6) }))
    })()
    const couponMonthly = (() => {
      const byM = new Map()
      for (const a of auctions) {
        if (a.kind === 'FRN' || !fin(a.T)) continue
        const m = a.d.slice(0, 7), e = byM.get(m) || { gross: 0, tenYE: 0 }
        e.gross += a.size
        // weight each auction by its duration relative to a 10-year at the same
        // yield: $1 of 30-year is roughly two 10-year dollars of rate risk
        e.tenYE += a.size * parDuration(a.T, a.hy) / parDuration(10, a.hy)
        byM.set(m, e)
      }
      return [...byM].sort(([x], [y]) => x.localeCompare(y)).map(([d, e]) => ({ d, gross: r1(e.gross), tenYE: r1(e.tenYE) }))
    })()
    const sum3 = (arr, k, end) => arr.slice(Math.max(0, end - 2), end + 1).reduce((s, p) => s + (p[k] || 0), 0)
    const cm = couponMonthly, ce = cm.length - 1
    // the current month may be part-way through its auction calendar; compare full months
    const curMonth = new Date().toISOString().slice(0, 7)
    const endIdx = cm[ce]?.d === curMonth ? ce - 1 : ce
    const couponSupply = {
      monthly: cm.slice(-120),
      last3: r1(sum3(cm, 'tenYE', endIdx)), yearAgo3: r1(sum3(cm, 'tenYE', endIdx - 12)),
      through: cm[endIdx]?.d || null,
    }
    const treast = raw.TREAST || []
    const fedRunoff = treast.length > 52 ? {
      level: r2(treast.at(-1).v / 1e6), asOf: treast.at(-1).d,
      chg13: r1((treast.at(-1).v - treast.at(-14).v) / 1e3), chg52: r1((treast.at(-1).v - treast.at(-53).v) / 1e3),
    } : null

    // ── absorption ──
    const recentAuctions = coupons.slice(-14).reverse().map(a => ({
      d: a.d, term: a.term, tenor: a.tenor, reopen: a.reopen, size: r1(a.size), hy: a.hy, btc: r2(a.btc),
      ind: r1(a.ind), dir: r1(a.dir), dealer: r1(a.dealer), dInd: r1(a.dInd), dDealer: r1(a.dDealer), dBtc: r2(a.dBtc),
    }))
    const auctionTrend = (() => {
      const out = [], byMonth = new Map()
      coupons.forEach((a, i) => {
        if (i < 11) return
        const w = coupons.slice(i - 11, i + 1)
        byMonth.set(a.d.slice(0, 7), { d: a.d.slice(0, 7), ind: r1(mean(w.map(x => x.ind))), dealer: r1(mean(w.map(x => x.dealer))), dir: r1(mean(w.map(x => x.dir))) })
      })
      for (const v of byMonth.values()) out.push(v)
      return out.filter(p => p.d >= '2009-01')
    })()
    const q = id => (raw[id] || []).map(p => ({ d: p.d.slice(0, 7), v: p.v }))
    const at = (arr, d) => { let v = null; for (const p of arr) { if (p.d <= d) v = p.v; else break } return v }
    const gfd = q('GFDEBTN'), qF = q('FDHBFIN'), qFed = q('FDHBFRBN'), qAg = q('FDHBATN')
    const holders = gfd.filter(p => p.d >= '2000-01').map(p => {
      const tot = p.v / 1000 // $B
      // FDHBFIN and FDHBFRBN are published in $B; FDHBATN in $M
      const f = at(qF, p.d), fed = at(qFed, p.d), agM = at(qAg, p.d), ag = fin(agM) ? agM / 1000 : null
      if (![f, fed, ag].every(fin) || !(tot > 0)) return null
      const s = x => r1((x / tot) * 100)
      return { d: p.d, foreign: s(f), fed: s(fed), agencies: s(ag), private: r1(100 - (f + fed + ag) / tot * 100) }
    }).filter(Boolean)
    const woff = raw.WMTSECL1 || []
    const foreignOfficial = woff.length > 60 ? {
      series: woff.slice(-260).map(p => ({ d: p.d, v: r2(p.v / 1e6) })), // $T
      level: r2(woff.at(-1).v / 1e6), asOf: woff.at(-1).d,
      chg13: r1((woff.at(-1).v / woff.at(-14).v - 1) * 100), chg52: r1((woff.at(-1).v / woff.at(-53).v - 1) * 100),
    } : null

    // ── the dollar: flow (current account) against stock (net international position) ──
    const gdpQ = q('GDP'), caQ = q('IEABC')
    const dollarStockFlow = q('IIPUSNETIQ').map(p => {
      const g = at(gdpQ, p.d), ca = at(caQ, p.d)
      if (!fin(g)) return null
      return { d: p.d, niip: r1((p.v / 1000 / g) * 100), ca: fin(ca) ? r2((ca * 4 / 1000 / g) * 100) : null }
    }).filter(Boolean)

    // ── the scoreboard ──
    const nfciIds = ['NFCI', 'NFCIRISK', 'NFCICREDIT', 'NFCILEVERAGE']
    const nf = nfciIds.map(id => raw[id] || [])
    const scoreboard = nf[0].slice(-260).map(p => {
      const row = { d: p.d }
      nfciIds.forEach((id, k) => { row[id] = r2(nf[k].find(x => x.d === p.d)?.v) })
      return row
    })
    const stl = raw.STLFSI4 || []

    const latest = id => { const o = raw[id] || []; return o.length ? { v: o.at(-1).v, d: o.at(-1).d } : null }
    return {
      built: new Date().toISOString(), tookMs: Date.now() - t0, fdError,
      asOf: grid[n - 1],
      now: {
        tp: latest('THREEFYTP10'), dgs10: latest('DGS10'), baa: latest('BAA10Y'), hy: latest('BAMLH0A0HYM2'),
        usd4: r2(d4[n - 1]), y4: r1(y4[n - 1]), stlfsi: stl.length ? { v: r2(stl.at(-1).v), d: stl.at(-1).d } : null,
        nfci: latest('NFCI'), repo: fin(base.repo[n - 1]) ? r1(base.repo[n - 1]) : null,
      },
      tell, divergence, quadrant, lastDiv, sequence,
      supply: { billsShare, couponSupply, fedRunoff },
      absorption: { recentAuctions, auctionTrend, holders, foreignOfficial, auctionsFrom: coupons[0]?.d || null },
      dollarStockFlow, scoreboard,
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
