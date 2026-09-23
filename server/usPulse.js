// ============================================================================
// U.S. PULSE — the U.S. Economy landing feed, built for an investor's three
// questions: where are the LEADING indicators pointing, how healthy is the
// CONSUMER, and what does the DEBT picture look like (sovereign burden and
// private-credit stress). ~50 FRED series → one JSON:
//   rows      per indicator: latest, change, YoY, 24-point sparkline, 10-year
//             percentile, a tone (green/amber/red from explicit thresholds),
//             and which detail sub-tab it drills into
//   charts    leading-diffusion history (share of leading indicators improving
//             over six months, LEI-style) — the one chart that exists only
//             here. Everything else is charted on the page a row drills into.
//   scores    one 0–100 health score per lens + rule-based verdicts
// Cached 3 hours in memory and on disk (us-pulse.json); only complete builds
// are cached. All series verified on FRED 2026-09.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 60 * 60 * 1000
const TTL = 3 * H
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const pctile = (arr, val) => { const xs = (arr || []).filter(fin); if (!xs.length || !fin(val)) return null; return Math.round((xs.filter(x => x <= val).length / xs.length) * 100) }
const toneOf = (v, [g, a], dir) => (!fin(v) ? null : dir > 0 ? (v >= g ? 'green' : v >= a ? 'amber' : 'red') : (v <= g ? 'green' : v <= a ? 'amber' : 'red'))
const TONE_PTS = { green: 100, amber: 50, red: 0 }

// Series spec. kind: 'level' (display the level) or 'yoy' (display the 12-month %
// change). good: the direction that is good news. tone: [green, amber] bounds
// applied in the `good` direction (green if beyond the first bound, amber if
// beyond the second, red otherwise); null = informational, no tone. drill: the
// U.S. Economy sub-tab that holds the detail.
const SERIES = [
  // ── Leading indicators ─────────────────────────────────────────────────
  { id: 'T10Y3M', group: 'lead', label: 'Yield curve 10y−3m', unit: '%', freq: 'D', kind: 'level', good: 1, tone: [0.5, 0], drill: 'rates', note: 'inverted before every recession since 1970; the un-inversion is the late warning' },
  { id: 'IC4WSA', group: 'lead', label: 'Initial claims, 4-wk avg', unit: 'K', scale: 1e-3, freq: 'W', kind: 'yoy', good: -1, tone: [5, 20], drill: 'labor', note: 'the fastest labor read there is; a sustained +20% YoY has meant recession' },
  { id: 'CCSA', group: 'lead', label: 'Continuing claims', unit: 'K', scale: 1e-3, freq: 'W', kind: 'yoy', good: -1, tone: [5, 15], drill: 'labor', note: 'how hard it is to find the next job' },
  { id: 'TEMPHELPS', group: 'lead', label: 'Temp-help employment', unit: 'K', freq: 'M', kind: 'yoy', good: 1, tone: [0, -5], drill: 'labor', note: 'temps are hired first and cut first' },
  { id: 'NEWORDER', group: 'lead', label: 'Core capital goods orders', unit: '$M', freq: 'M', kind: 'yoy', good: 1, tone: [2, -2], drill: 'gdp', note: 'business investment intentions, ex aircraft and defense' },
  { id: 'PERMIT', group: 'lead', label: 'Building permits', unit: 'K', freq: 'M', kind: 'yoy', good: 1, tone: [0, -10], drill: 'gdp', note: 'housing leads the cycle by 6–12 months' },
  { id: 'AWHMAN', group: 'lead', label: 'Mfg weekly hours', unit: 'hrs', freq: 'M', kind: 'level', good: 1, tone: [41.2, 40.6], drill: 'labor', note: 'hours are cut before people are' },
  { id: 'REGMFG', group: 'lead', label: 'Regional Fed mfg (NY + Philly)', unit: 'idx', freq: 'M', kind: 'level', good: 1, tone: [5, -5], drill: 'gdp', derived: true, note: 'the two earliest manufacturing surveys each month' },
  { id: 'ISRATIO', group: 'lead', label: 'Inventory / sales ratio', unit: 'x', freq: 'M', kind: 'level', good: -1, tone: [1.35, 1.42], drill: 'gdp', note: 'rising = goods piling up, production cuts follow' },
  { id: 'SP500', group: 'lead', label: 'S&P 500', unit: 'idx', freq: 'D', kind: 'yoy', good: 1, tone: [0, -5], drill: 'tightening', note: 'an LEI component: the market discounts the next two quarters' },
  { id: 'BAMLH0A0HYM2', group: 'lead', label: 'High-yield spread', unit: '%', freq: 'D', kind: 'level', good: -1, tone: [3.5, 5], drill: 'debt', note: 'credit sniffs out trouble before equities' },
  { id: 'NFCI', group: 'lead', label: 'Financial conditions (NFCI)', unit: 'idx', freq: 'W', kind: 'level', good: -1, tone: [-0.3, 0.3], drill: 'tightening', note: 'below zero = looser than average' },
  { id: 'UMCSENT', group: 'lead', label: 'Consumer sentiment', unit: 'idx', freq: 'M', kind: 'level', good: 1, tone: [75, 60], drill: 'consumer', note: 'Michigan; expectations lead spending' },
  { id: 'SAHMREALTIME', group: 'lead', label: 'Sahm rule', unit: 'pp', freq: 'M', kind: 'level', good: -1, tone: [0.3, 0.5], drill: 'labor', note: 'triggers at 0.50; no false positives since 1970' },
  { id: 'CFNAI', group: 'lead', label: 'Chicago Fed activity index', unit: 'idx', freq: 'M', kind: 'level', good: 1, tone: [-0.3, -0.7], drill: 'gdp', note: 'coincident check: 3-month average below −0.7 = recession underway' },
  // ── Consumer health ────────────────────────────────────────────────────
  { id: 'DSPIC96', group: 'consumer', label: 'Real disposable income', unit: '$B', freq: 'M', kind: 'yoy', good: 1, tone: [2, 0], drill: 'consumer', note: 'the fuel; spending can outrun it only by borrowing or dissaving' },
  { id: 'PCEC96', group: 'consumer', label: 'Real consumer spending', unit: '$B', freq: 'M', kind: 'yoy', good: 1, tone: [2, 0], drill: 'consumer', note: '68% of GDP' },
  { id: 'RRSFS', group: 'consumer', label: 'Real retail sales', unit: '$M', freq: 'M', kind: 'yoy', good: 1, tone: [1, -1], drill: 'consumer', note: 'goods spending, inflation-adjusted' },
  { id: 'PSAVERT', group: 'consumer', label: 'Saving rate', unit: '%', freq: 'M', kind: 'level', good: 1, tone: [5, 3.5], drill: 'consumer', note: 'below 4% the consumer is running on fumes' },
  { id: 'REALWAGE', group: 'consumer', label: 'Real wage growth', unit: 'pp', freq: 'M', kind: 'level', good: 1, tone: [0.5, 0], drill: 'labor', derived: true, note: 'average hourly earnings YoY minus CPI YoY' },
  { id: 'UNRATE', group: 'consumer', label: 'Unemployment rate', unit: '%', freq: 'M', kind: 'level', good: -1, tone: [4.5, 5.5], drill: 'labor', note: 'level matters less than the change — see the Sahm rule' },
  { id: 'JTSQUR', group: 'consumer', label: 'Quits rate', unit: '%', freq: 'M', kind: 'level', good: 1, tone: [2.2, 1.9], drill: 'labor', note: 'workers quit when they are confident of the next job' },
  { id: 'JTSJOL', group: 'consumer', label: 'Job openings', unit: 'K', freq: 'M', kind: 'yoy', good: 1, tone: [0, -10], drill: 'labor', note: 'labor demand' },
  { id: 'REVOLSL', group: 'consumer', label: 'Credit-card balances', unit: '$B', scale: 1e-3, freq: 'M', kind: 'yoy', good: -1, tone: [5, 8], drill: 'consumer', note: 'fast growth = spending funded on plastic' },
  { id: 'TERMCBCCALLNS', group: 'consumer', label: 'Credit-card APR', unit: '%', freq: 'M', kind: 'level', good: -1, tone: [18, 21], drill: 'consumer', note: 'the price of carrying a balance' },
  { id: 'DRCCLACBS', group: 'consumer', label: 'Card delinquency', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [3, 4], drill: 'consumer', note: 'the first place consumer stress shows up' },
  { id: 'DRCLACBS', group: 'consumer', label: 'Consumer-loan delinquency', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [2.5, 3.5], drill: 'banks', note: 'auto and personal loans' },
  { id: 'TDSP', group: 'consumer', label: 'Debt service ratio', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [11.5, 13], drill: 'consumer', note: 'debt payments as a share of disposable income' },
  { id: 'GASREGW', group: 'consumer', label: 'Gasoline', unit: '$', freq: 'W', kind: 'level', good: -1, tone: [3.25, 4], drill: 'consumer', note: 'the most visible price in America' },
  // ── Debt picture ───────────────────────────────────────────────────────
  { id: 'GFDEGDQ188S', group: 'debt', sub: 'burden', label: 'Federal debt / GDP', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [100, 120], drill: 'budget', note: 'held by the public plus intragovernmental' },
  { id: 'DEFICIT12', group: 'debt', sub: 'burden', label: 'Federal deficit, 12-mo', unit: '% GDP', freq: 'M', kind: 'level', good: -1, tone: [3, 5], drill: 'budget', derived: true, note: 'rolling 12-month deficit as a share of GDP; 3% is the old ceiling' },
  { id: 'INTREC', group: 'debt', sub: 'burden', label: 'Interest / federal receipts', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [12, 16], drill: 'budget', derived: true, note: 'the fiscal squeeze in one number' },
  { id: 'EFFRATE', group: 'debt', sub: 'burden', label: 'Effective rate on federal debt', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [3, 3.6], drill: 'budget', derived: true, note: 'interest paid ÷ debt; climbs as old debt rolls into new rates' },
  { id: 'THREEFYTP10', group: 'debt', sub: 'burden', label: '10y term premium', unit: '%', freq: 'D', kind: 'level', good: -1, tone: [0.5, 1.0], drill: 'rates', note: 'what bond investors charge to hold duration; rises when supply worries them' },
  { id: 'FOREIGN', group: 'debt', sub: 'burden', label: 'Foreign share of federal debt', unit: '%', freq: 'Q', kind: 'level', good: 1, tone: null, drill: 'tightening', derived: true, note: 'who funds it; a falling share means domestic savers must' },
  { id: 'HHDEBT', group: 'debt', sub: 'private', label: 'Household debt / GDP', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [75, 90], drill: 'model', derived: true, note: 'households deleveraged after 2008 and stayed there' },
  { id: 'CORPDEBT', group: 'debt', sub: 'private', label: 'Corporate debt / GDP', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [45, 52], drill: 'model', derived: true, note: 'non-financial corporate debt securities and loans' },
  { id: 'BAMLC0A0CM', group: 'debt', sub: 'stress', label: 'Investment-grade spread', unit: '%', freq: 'D', kind: 'level', good: -1, tone: [1.2, 1.8], drill: 'debt', note: 'the market price of corporate credit risk' },
  { id: 'STLFSI4', group: 'debt', sub: 'stress', label: 'Financial stress index', unit: 'idx', freq: 'W', kind: 'level', good: -1, tone: [0, 1], drill: 'tightening', note: 'St. Louis Fed; zero = average stress' },
  { id: 'DRTSCILM', group: 'debt', sub: 'stress', label: 'Banks tightening C&I standards', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [5, 20], drill: 'banks', note: 'net share of banks tightening; credit availability leads defaults' },
  { id: 'DRTSCLCC', group: 'debt', sub: 'stress', label: 'Banks tightening card standards', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [5, 20], drill: 'banks', note: 'consumer credit availability' },
  { id: 'TOTLL', group: 'debt', sub: 'stress', label: 'Bank loan growth', unit: '$B', freq: 'W', kind: 'yoy', good: 1, tone: [3, 0], drill: 'banks', note: 'loans and leases at all commercial banks — the series the Banks view charts' },
  { id: 'DRBLACBS', group: 'debt', sub: 'stress', label: 'Business-loan delinquency', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [2, 3], drill: 'banks', note: 'C&I loans' },
  { id: 'DRCRELEXFACBS', group: 'debt', sub: 'stress', label: 'CRE-loan delinquency', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [2, 3], drill: 'banks', note: 'commercial real estate' },
  { id: 'DRSFRMACBS', group: 'debt', sub: 'stress', label: 'Mortgage delinquency', unit: '%', freq: 'Q', kind: 'level', good: -1, tone: [3, 5], drill: 'banks', note: 'single-family' },
  { id: 'WALCL', group: 'debt', sub: 'stress', label: 'Fed balance sheet', unit: '$T', scale: 1e-6, freq: 'W', kind: 'yoy', good: 1, tone: null, drill: 'fed', note: 'shrinking = quantitative tightening draining reserves' },
]
// raw inputs the derived rows need
const RAW_EXTRA = [
  { id: 'GACDISA066MSFRBNY', freq: 'M' }, { id: 'GACDFSA066MSFRBPHI', freq: 'M' }, { id: 'CES0500000003', freq: 'M' }, { id: 'CPIAUCSL', freq: 'M' },
  { id: 'MTSDS133FMS', freq: 'M' }, { id: 'GDP', freq: 'Q' }, { id: 'FGRECPT', freq: 'Q' }, { id: 'A091RC1Q027SBEA', freq: 'Q' }, { id: 'GFDEBTN', freq: 'Q' },
  { id: 'FDHBFIN', freq: 'Q' }, { id: 'CMDEBT', freq: 'Q' }, { id: 'BCNSDODNS', freq: 'Q' },
]
const LIMIT = { D: 2700, W: 560, M: 150, Q: 52 }

export function createUsPulse({ fetchFredSeries, dir }) {
  const FILE = path.join(dir, 'us-pulse.json')
  let mem = null, inflight = null
  const load = () => { try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {} return null }
  const save = obj => { try { fs.writeFileSync(FILE, JSON.stringify(obj)) } catch (e) { console.error('us-pulse save:', e.message) } }

  // ── series algebra on [{d:'YYYY-MM', v}] monthly-keyed arrays ───────────
  const monthly = obs => { const m = new Map(); for (const p of obs || []) m.set(p.d.slice(0, 7), p.v); return [...m].map(([d, v]) => ({ d, v })) }
  const at = (arr, d) => { let v = null; for (const p of arr) { if (p.d <= d) v = p.v; else break } return v } // forward-fill lookup
  const ratio = (a, b, f) => a.map(p => { const bv = at(b, p.d); return fin(bv) ? { d: p.d, v: f(p.v, bv) } : null }).filter(Boolean)
  const roll = (arr, n) => arr.map((p, i) => (i >= n - 1 ? { d: p.d, v: arr.slice(i - n + 1, i + 1).reduce((s, x) => s + x.v, 0) } : null)).filter(Boolean)
  const yoyArr = (arr, step) => arr.map((p, i) => (i >= step && arr[i - step].v ? { d: p.d, v: ((p.v / arr[i - step].v) - 1) * 100 } : null)).filter(Boolean)

  function describe(spec, base) {
    // base: [{d, v}] at the series' own cadence (monthly-keyed); Q series are quarterly-spaced
    const q = spec.freq === 'Q'
    const step = q ? 4 : 12, look = q ? 2 : 6, win = q ? 40 : 120
    if (!base.length) return null
    const scale = spec.scale || 1
    const disp = spec.kind === 'yoy' ? yoyArr(base, step) : base.map(p => ({ d: p.d, v: p.v * scale }))
    if (!disp.length) return null
    const cur = last(disp), prev = disp.length > look ? disp[disp.length - 1 - look] : null
    const yoy = spec.kind === 'level' ? last(yoyArr(base, step))?.v ?? null : cur.v
    const chg = prev ? cur.v - prev.v : null
    const window = disp.slice(-win).map(p => p.v)
    // six-month direction of the UNDERLYING level, signed by the good direction (LEI-style diffusion input)
    const lvlNow = last(base)?.v, lvlPrev = base.length > look ? base[base.length - 1 - look].v : null
    const improving = fin(lvlNow) && fin(lvlPrev) ? Math.sign(lvlNow - lvlPrev) * spec.good > 0 : null
    return {
      id: spec.id, group: spec.group, sub: spec.sub || null, label: spec.label, unit: spec.kind === 'yoy' ? '%yoy' : spec.unit, freq: spec.freq, kind: spec.kind, good: spec.good, drill: spec.drill, note: spec.note,
      value: r2(cur.v), date: cur.d, chg: r2(chg), chgMonths: q ? 6 : 6, yoy: r1(yoy), pct: pctile(window, cur.v), spark: disp.slice(-24).map(p => r2(p.v)),
      tone: spec.tone ? toneOf(cur.v, spec.tone, spec.good) : null, improving,
    }
  }

  async function build() {
    const raw = {}
    const need = [...SERIES.filter(s => !s.derived).map(s => ({ id: s.id, freq: s.freq })), ...RAW_EXTRA]
    for (const s of need) raw[s.id] = await fetchFredSeries(s.id, LIMIT[s.freq])
    const got = need.filter(s => (raw[s.id] || []).length > 5).length
    if (got < need.length * 0.85) throw new Error(`only ${got}/${need.length} FRED series came back`)
    const M = id => monthly(raw[id] || [])
    // derived monthly/quarterly arrays
    const nyM = M('GACDISA066MSFRBNY'), phM = M('GACDFSA066MSFRBPHI')
    const gdp = M('GDP')
    const derived = {
      REGMFG: nyM.map(p => { const ph = phM.find(x => x.d === p.d); return ph ? { d: p.d, v: (p.v + ph.v) / 2 } : null }).filter(Boolean),
      REALWAGE: (() => { const w = yoyArr(M('CES0500000003'), 12), c = M('CPIAUCSL'); const cy = yoyArr(c, 12); return w.map(p => { const ci = cy.find(x => x.d === p.d); return ci ? { d: p.d, v: p.v - ci.v } : null }).filter(Boolean) })(),
      DEFICIT12: ratio(roll(M('MTSDS133FMS'), 12), gdp, (def, g) => (-def / 1000 / g) * 100),
      INTREC: ratio(M('A091RC1Q027SBEA'), M('FGRECPT'), (i, r) => (i / r) * 100),
      EFFRATE: ratio(M('A091RC1Q027SBEA'), M('GFDEBTN'), (i, d) => (i / (d / 1000)) * 100),
      FOREIGN: ratio(M('FDHBFIN'), M('GFDEBTN'), (f, d) => (f / (d / 1000)) * 100),
      HHDEBT: ratio(M('CMDEBT'), gdp, (h, g) => (h / 1000 / g) * 100),
      CORPDEBT: ratio(M('BCNSDODNS'), gdp, (c, g) => (c / 1000 / g) * 100),
    }
    const rows = SERIES.map(s => describe(s, s.derived ? derived[s.id] || [] : M(s.id))).filter(Boolean)
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))

    // ── leading diffusion history: share of leading series whose level improved over 6 months ──
    const leadSpecs = SERIES.filter(s => s.group === 'lead')
    const leadBase = leadSpecs.map(s => ({ s, b: s.derived ? derived[s.id] || [] : M(s.id) }))
    const months = [...new Set(leadBase.flatMap(x => x.b.map(p => p.d)))].sort().slice(-121)
    const diffusion = months.map(d => {
      let n = 0, up = 0
      for (const { s, b } of leadBase) {
        const i = b.findIndex(p => p.d > d); const end = (i === -1 ? b.length : i) - 1
        if (end < 6) continue
        n++; if (Math.sign(b[end].v - b[end - 6].v) * s.good > 0) up++
      }
      return n >= 8 ? { d, v: Math.round((up / n) * 100) } : null
    }).filter(Boolean)

    // Charts beyond the diffusion live on their home pages: income vs spending
    // vs saving on Consumer, debt by sector on Machine → Stock-flow model, the
    // interest squeeze on Fiscal. This page is the index that routes to them.

    // ── scores + verdicts ──
    const pts = list => mean(list.filter(r => r.tone).map(r => TONE_PTS[r.tone]))
    const lead = rows.filter(r => r.group === 'lead'), cons = rows.filter(r => r.group === 'consumer'), debt = rows.filter(r => r.group === 'debt')
    const diffNow = last(diffusion)?.v ?? null
    const leadScore = fin(diffNow) ? Math.round(diffNow * 0.6 + (pts(lead) ?? diffNow) * 0.4) : Math.round(pts(lead) ?? 50)
    const consScore = Math.round(pts(cons) ?? 50)
    const burden = pts(debt.filter(r => r.sub === 'burden' || r.sub === 'private')), stress = pts(debt.filter(r => r.sub === 'stress'))
    const debtScore = Math.round(mean([burden, stress]) ?? 50)
    const names = list => list.map(r => r.label.replace(/ \(.*\)/, ''))
    const worst = list => list.filter(r => r.tone === 'red'), best = list => list.filter(r => r.tone === 'green')
    const up = lead.filter(r => r.improving === true), down = lead.filter(r => r.improving === false)
    const leadTone = leadScore >= 60 ? 'green' : leadScore >= 40 ? 'amber' : 'red'
    const leadVerdict = {
      label: leadTone === 'green' ? 'Expansion broadening' : leadTone === 'amber' ? 'Mixed — no recession signal yet' : 'Leading indicators rolling over',
      why: `${fin(diffNow) ? `${diffNow}% of leading indicators improved over six months` : 'diffusion unavailable'}; ${up.length} rising, ${down.length} falling. Red: ${names(worst(lead)).join(', ') || 'none'}.`,
      up: names(up).slice(0, 5), down: names(down).slice(0, 5),
    }
    const consTone = consScore >= 70 ? 'green' : consScore >= 45 ? 'amber' : 'red'
    const sav0 = byId.PSAVERT?.value, inc0 = byId.DSPIC96?.value, spd0 = byId.PCEC96?.value
    const consVerdict = {
      label: consTone === 'green' ? 'Consumer healthy' : consTone === 'amber' ? 'Stretched but still spending' : 'Consumer under strain',
      why: `Real spending ${fin(spd0) ? `${spd0 >= 0 ? '+' : ''}${spd0.toFixed(1)}%` : 'n/a'} vs real income ${fin(inc0) ? `${inc0 >= 0 ? '+' : ''}${inc0.toFixed(1)}%` : 'n/a'} YoY${fin(sav0) ? `, saving rate ${sav0.toFixed(1)}%` : ''}${fin(spd0) && fin(inc0) && spd0 > inc0 + 0.5 ? ' — spending is outrunning income, funded from savings and cards' : ''}. Red: ${names(worst(cons)).join(', ') || 'none'}; green: ${names(best(cons)).join(', ') || 'none'}.`,
    }
    const debtTone = debtScore >= 70 ? 'green' : debtScore >= 45 ? 'amber' : 'red'
    const debtVerdict = {
      label: fin(stress) && stress >= 70 && fin(burden) && burden < 45 ? 'Sovereign burden rising, private credit calm' : fin(stress) && stress < 45 ? 'Credit stress building' : debtTone === 'green' ? 'Debt picture benign' : 'Leverage elevated, credit steady',
      why: `Burden score ${fin(burden) ? Math.round(burden) : 'n/a'} (federal debt ${byId.GFDEGDQ188S?.value ?? 'n/a'}% of GDP, deficit ${byId.DEFICIT12?.value ?? 'n/a'}% of GDP, interest ${byId.INTREC?.value ?? 'n/a'}% of receipts; households ${byId.HHDEBT?.value ?? 'n/a'}%, corporates ${byId.CORPDEBT?.value ?? 'n/a'}% of GDP) · stress score ${fin(stress) ? Math.round(stress) : 'n/a'} (HY ${byId.BAMLH0A0HYM2?.value ?? 'n/a'}%, IG ${byId.BAMLC0A0CM?.value ?? 'n/a'}%, C&I standards ${byId.DRTSCILM?.value ?? 'n/a'}%).`,
      burden: fin(burden) ? Math.round(burden) : null, stress: fin(stress) ? Math.round(stress) : null,
    }
    const tones = [leadTone, consTone, debtTone]
    const overallTone = tones.includes('red') ? (tones.filter(t => t === 'red').length >= 2 ? 'red' : 'amber') : tones.includes('amber') ? 'amber' : 'green'
    const overall = {
      tone: overallTone,
      label: overallTone === 'green' ? 'Expansion intact' : overallTone === 'amber' ? 'Late-cycle, no break yet' : 'Downturn risk elevated',
      sentence: `${leadVerdict.label}; ${consVerdict.label.toLowerCase()}; ${debtVerdict.label.toLowerCase()}.`,
    }
    return {
      rows, charts: { diffusion },
      scores: { lead: { score: leadScore, tone: leadTone, ...leadVerdict }, consumer: { score: consScore, tone: consTone, ...consVerdict }, debt: { score: debtScore, tone: debtTone, ...debtVerdict } },
      overall, coverage: `${rows.length}/${SERIES.length}`, updated: new Date().toISOString(),
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    const disk = mem || load()
    if (disk && Date.now() - disk.ts < TTL) { mem = disk; return disk.data }
    if (inflight) return inflight
    inflight = (async () => {
      try { const data = await build(); mem = { data, ts: Date.now() }; save(mem); return data }
      catch (e) { console.warn('us-pulse:', e.message); if (disk) return disk.data; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
