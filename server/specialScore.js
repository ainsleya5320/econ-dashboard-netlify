// ============================================================================
// SPECIAL SITUATIONS SCORE — one ranked list of what is worth researching now,
// across every board, with the reasons for each rank.
//
//   score (0–100) = situation quality   type-specific, from Greenblatt's and
//                                        Suria's heuristics (below, per board)
//                 + freshness           how new the triggering filing is
//                 + catalyst            a dated event inside six weeks
//                 + confluence          the same ticker on other boards —
//                                        insiders buying into a buyback, a 13D
//                                        beside a self-tender. The strongest
//                                        single "intriguing" signal there is.
//                 − confidence          terms not read, no quote, a number that
//                                        looks like a parse error
//   grades: A ≥ 60 research now · B ≥ 45 worth a look · C ≥ 30 on the radar
//   One idea per ticker: when a stock is on several boards, its best-scoring
//   board leads and the others ride along (their weight is in confluence).
//
// Every point carries its reason, so a rank can be argued with. Pure function
// of the feed, so it runs the same in the dashboard (/api/special-situations →
// ideas) and in the email digest (scripts/special-digest.mjs).
// ============================================================================

const DAY = 864e5
const fin = v => v != null && Number.isFinite(v)
const age = (d, now) => (d ? Math.floor((now - Date.parse(`${d}T00:00:00Z`)) / DAY) : null)
const until = (d, now) => (d ? Math.ceil((Date.parse(`${d}T00:00:00Z`) - now) / DAY) : null)
const usd = v => (!fin(v) ? '—' : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`)
const pct = (v, dp = 1) => (fin(v) ? `${v > 0 ? '+' : ''}${v.toFixed(dp)}%` : '—')

export const GRADES = [[60, 'A', 'research now'], [45, 'B', 'worth a look'], [30, 'C', 'on the radar']]
export const gradeOf = s => GRADES.find(([min]) => s >= min) || [0, '—', 'below the line']

// A small ledger: add(points, why) keeps the arithmetic and the explanation together
function ledger() {
  const reasons = [], risks = []
  return {
    reasons, risks,
    add(pts, why) { if (pts) reasons.push({ pts, why }) },
    risk(pts, why) { risks.push({ pts, why }) },
    get total() { return reasons.reduce((s, r) => s + r.pts, 0) + risks.reduce((s, r) => s + r.pts, 0) },
  }
}

function freshness(L, date, now, what = 'filed') {
  const a = age(date, now)
  if (a == null || a < 0) return
  const pts = a <= 7 ? 15 : a <= 14 ? 11 : a <= 30 ? 7 : a <= 60 ? 3 : 0
  // worded as age alone: the situation's own reason usually names the event
  if (pts) L.add(pts, `fresh — ${what} ${a === 0 ? 'today' : a === 1 ? 'yesterday' : `${a}d ago`}`)
}
function catalyst(L, label, date, now) {
  const u = until(date, now)
  if (fin(u) && u >= 0 && u <= 42) { L.add(8, `${label} ${u === 0 ? 'today' : `in ${u} days`}`); return { label, date } }
  return null
}

// ── per-board scorers: each returns the idea without its final score ──
const SCORERS = {
  spinoff(r, now) {
    const L = ledger(), key = String(r.cik)
    const name = r.spinco || r.parent, ticker = r.ticker || r.parentTicker
    const sinceDist = age(r.dist, now)
    if (r.stage === 'distributed') {
      if (fin(sinceDist) && sinceDist <= 120) L.add(22, `distributed ${sinceDist} days ago — inside the forced-selling window`)
      else if (fin(sinceDist) && sinceDist > 240) L.risk(-15, 'distributed over eight months ago — the forced selling is done')
      if (fin(r.sinceDist) && r.sinceDist <= -10) L.add(10, `down ${Math.abs(r.sinceDist).toFixed(0)}% since distribution — the post-spin dump Greenblatt waits for`)
    } else if (r.stage === 'dated') L.add(22, `distribution dated${r.dist ? ` ${r.dist}` : ''} — when-issued trading and index selling ahead`)
    else L.add(10, r.kind === 'parent8k' ? 'separation announced by the parent' : 'Form 10 on file')
    if (r.incentive) L.add(10, 'insiders get equity or options in the SpinCo')
    if (r.taxFree) L.add(3, 'tax-free (section 355)')
    if (r.kind === 'parent8k') L.add(2, 'the parent side of the trade — Suria: often the better one')
    if (!r.parsed) L.risk(-8, 'terms not read from the filing')
    const cat = r.stage !== 'distributed' ? catalyst(L, 'distribution', r.dist, now) : null
    freshness(L, r.latestFiled, now, r.kind === 'parent8k' ? 'announced' : 'Form 10 filed')
    return {
      cat: 'spinoff', key, name, ticker, url: r.url, date: r.latestFiled, catalyst: cat, L,
      headline: r.kind === 'parent8k' ? `${r.parent} plans a separation${r.ratio ? ` (${r.ratio})` : ''}` : `${r.spinco} spinning out of ${r.parent || 'its parent'}${r.ratio ? `, ${r.ratio}` : ''} · ${r.stage}`,
      pin: { name, ticker, url: r.url, dates: [{ label: 'record', date: r.record }, { label: 'distribution', date: r.dist }] },
      stale: r.stage === 'distributed' && fin(sinceDist) && sinceDist > 365,
    }
  },

  merger(r, now) {
    const L = ledger(), key = r.targetCik ? String(r.targetCik) : `${r.target}`
    const sec = r.securities || {}, fl = r.flags || {}
    const secs = [sec.cvr && 'CVR', sec.warrant && 'warrants', sec.preferred && 'preferred'].filter(Boolean).join(', ')
    // a merger proxy runs to a million characters and names CVRs in passing, so
    // a proxy-only match is a lead to confirm, not a fact
    if (secs && r.stage !== 'proxy') L.add(18, `pays in merger securities (${secs}) — the corner Greenblatt likes; recipients tend to dump them`)
    else if (secs) L.add(4, `the proxy mentions ${secs} — confirm it is this deal's consideration`)
    if (fin(r.annualized) && !r.pastClose) {
      if (r.annualized >= 30) { L.add(12, `${pct(r.annualized, 0)} annualised spread`); L.risk(-4, 'a spread this wide says the market doubts the close') }
      else if (r.annualized >= 12) L.add(22, `${pct(r.annualized, 0)} annualised (${pct(r.gross)} gross)`)
      else if (r.annualized >= 6) L.add(14, `${pct(r.annualized, 0)} annualised (${pct(r.gross)} gross)`)
      else if (r.annualized >= 2) L.add(6, `${pct(r.annualized, 0)} annualised — thin`)
    } else if (fin(r.gross) && r.gross >= 3 && r.gross <= 25 && !r.pastClose) L.add(8, `${pct(r.gross)} gross spread, close date unknown`)
    if (fin(r.gross) && r.gross < 0) L.risk(-6, 'trading above the offer — the market expects a higher bid')
    if (fin(r.gross) && r.gross > 30) L.risk(-12, `${pct(r.gross, 0)} gross — likely a parse error or a deal in trouble`)
    if (r.stage === 'tender') L.add(6, 'tender offer — closes in weeks, not months')
    if (fl.goShop) L.add(4, 'go-shop period — a topping bid is possible')
    if (fl.cfius) L.risk(-8, 'CFIUS review')
    if (fl.financing) L.risk(-8, 'financing condition')
    if (r.pastClose) L.risk(-15, 'past its last dated milestone — closed, lapsed or stalled')
    if (!fin(r.price)) L.risk(-10, 'no quote')
    if (r.closeAssumed) L.risk(-3, 'close date assumed')
    const cat = catalyst(L, r.tenderExpiry ? 'tender expiry' : r.meeting ? 'shareholder vote' : 'outside date', r.tenderExpiry || r.meeting || r.outsideDate, now)
    freshness(L, r.announced, now, 'announced')
    return {
      cat: 'merger', key, name: r.target, ticker: r.ticker, url: r.url, date: r.announced, catalyst: cat, L,
      headline: `${r.target}${r.acquirer ? ` ← ${r.acquirer}` : ''}${fin(r.value) ? ` at $${r.value}` : ''}${fin(r.gross) ? ` · spread ${pct(r.gross)}` : ''}`,
      pin: { name: r.target, ticker: r.ticker, url: r.url, dates: [{ label: 'tender expiry', date: r.tenderExpiry }, { label: 'vote', date: r.meeting }, { label: 'outside date', date: r.outsideDate }] },
      stale: r.pastClose && age(r.closeDate, now) > 30,
    }
  },

  reorg(r, now) {
    const L = ledger(), key = String(r.cik)
    const since = age(r.emerged, now)
    if (r.stage === 'emerged' || r.stage === 'listed') {
      if (fin(since) && since <= 120) L.add(22, `emerged from bankruptcy ${since} days ago — creditors who never wanted equity are selling`)
      else if (fin(since) && since <= 240) L.add(12, `emerged ${since} days ago`)
      if (r.listed && age(r.listed, now) <= 120) L.add(8, 'newly listed on an exchange — index and institutional buyers can now own it')
    } else if (r.stage === 'plan confirmed' || r.stage === 'effective date set') L.add(12, `${r.stage} — the new equity is weeks away`)
    if (fin(r.since) && r.since <= -15) L.add(10, `down ${Math.abs(r.since).toFixed(0)}% since emergence`)
    if (r.otc) L.add(4, 'trades OTC — neglected by most buyers')
    if (r.freshStart) L.add(3, 'fresh-start accounting — a clean balance sheet to read')
    if (!r.ticker) L.risk(-10, 'no new ticker yet')
    freshness(L, r.emerged || r.confirmed || r.listed, now, r.emerged ? 'emerged' : 'confirmed')
    return {
      cat: 'reorg', key, name: r.name, ticker: r.ticker, url: r.url, date: r.emerged || r.confirmed || r.listed, catalyst: null, L,
      headline: `${r.name} · ${r.stage}${r.emerged ? ` ${r.emerged}` : ''}${fin(r.since) ? ` · ${pct(r.since, 0)} since` : ''}`,
      pin: { name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: 'emerged', date: r.emerged }, { label: 'listed', date: r.listed }] },
      stale: fin(since) && since > 365,
    }
  },

  rights(r, now) {
    const L = ledger(), key = String(r.cik)
    const live = r.stage === 'open' || r.stage === 'announced'
    if (live) {
      if (fin(r.discount) && r.discount >= 10) L.add(16, `subscription ${r.discount.toFixed(0)}% below the market`)
      else if (fin(r.discount) && r.discount >= 0) L.add(8, `subscription ${r.discount.toFixed(0)}% below the market`)
      else if (fin(r.discount)) L.risk(-6, 'subscription price above the market')
      if (r.backstop) L.add(8, 'backstopped — someone is committing capital at this price')
      if (r.oversub) L.add(8, 'oversubscription privilege — you can take more than your share')
      if (r.transferable === false) L.add(6, 'non-transferable rights — holders who do not subscribe get diluted, and many do not')
    } else L.risk(-20, `offering ${r.stage}`)
    if (!r.parsed) L.risk(-8, 'terms not read from the filing')
    const cat = catalyst(L, 'rights expiry', r.expiry, now)
    freshness(L, r.filed, now, 'filed')
    return {
      cat: 'rights', key, name: r.name, ticker: r.ticker, url: r.url, date: r.filed, catalyst: cat, L,
      headline: `${r.name} rights offering${fin(r.subPrice) ? ` at $${r.subPrice}` : ''}${r.ratio ? `, ${r.ratio}` : ''} · ${r.stage}`,
      pin: { name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: 'record', date: r.record }, { label: 'expiry', date: r.expiry }] },
      stale: !live && age(r.filed, now) > 90,
    }
  },

  recap(r, now) {
    const L = ledger(), key = `${r.kind}:${r.cik}`
    if (r.kind === 'self-tender') {
      if (r.stage === 'open') {
        if (fin(r.premium) && r.premium >= 10) L.add(18, `tender up to ${pct(r.premium, 0)} above the market`)
        else if (fin(r.premium) && r.premium >= 3) L.add(12, `tender ${pct(r.premium, 0)} above the market`)
        else L.add(6, 'open self-tender')
        if (r.oddLot) L.add(10, 'odd-lot provision — holders of under 100 shares are bought first, without proration')
        if (r.type === 'Dutch auction') L.add(4, 'Dutch auction — the company says what it thinks the shares are worth')
        if (r.debtFunded) L.add(10, 'debt-funded — a leveraged recap leaves a geared stub')
      } else L.risk(-20, 'tender closed')
    } else {
      if (fin(r.premium) && r.premium >= 10) L.add(18, `special dividend ${r.premium.toFixed(0)}% of the share price`)
      else if (fin(r.premium) && r.premium >= 5) L.add(12, `special dividend ${r.premium.toFixed(1)}% of the share price`)
      else L.add(4, 'special dividend')
      if (r.debtFunded) L.add(6, 'debt-funded payout — a recap')
      if (r.stage === 'paid') L.risk(-10, 'already paid')
    }
    if (!r.parsed) L.risk(-8, 'terms not read from the filing')
    const cat = catalyst(L, r.kind === 'self-tender' ? 'tender expiry' : 'payable', r.expiry, now)
    freshness(L, r.filed, now, 'filed')
    return {
      cat: 'recap', key, name: r.name, ticker: r.ticker, url: r.url, date: r.filed, catalyst: cat, L,
      headline: `${r.name} · ${r.type}${r.size ? ` ${r.size}` : ''}${fin(r.high) && r.kind === 'self-tender' ? ` up to $${r.high}` : ''}`,
      pin: { name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: r.kind === 'self-tender' ? 'expiry' : 'payable', date: r.expiry }] },
      stale: (r.stage === 'closed' || r.stage === 'paid') && age(r.filed, now) > 45,
    }
  },

  // Insider buying is Suria's supporting signal rather than a situation in its
  // own right: on its own it tops out as "worth a look"; beside a buyback, a
  // 13D or a reorganisation, confluence makes it "research now".
  insider(r, now) {
    const L = ledger(), key = r.symbol
    if (r.cluster && r.dollars30 >= 100e3) L.add(14, `cluster: ${r.buyers30} insiders bought in 30 days`)
    else if (r.cluster) L.add(7, `small cluster: ${r.buyers30} insiders, ${usd(r.dollars30)} in 30 days`)
    else if (r.buyers30 >= 2) L.add(7, `${r.buyers30} insiders bought in 30 days`)
    if (r.ceoCfo) L.add(8, 'the CEO, CFO or president is among the buyers')
    if (r.dollars30 >= 1e6) L.add(8, `${usd(r.dollars30)} bought in 30 days`)
    else if (r.dollars30 >= 250e3) L.add(4, `${usd(r.dollars30)} bought in 30 days`)
    if (r.tenPctOnly) L.risk(-10, 'only 10% holders buying — often a fund averaging down, not management')
    if (fin(r.since) && r.since <= -40) L.risk(-6, `${pct(r.since, 0)} vs the insiders' average — check for a split or a bad print before believing it`)
    else if (fin(r.since) && r.since <= 0) L.add(4, `trading ${pct(r.since, 0)} vs the insiders' average price — you can buy where they did`)
    if (fin(r.since) && r.since >= 25) L.risk(-6, `already ${pct(r.since, 0)} above the insiders' average`)
    if (!fin(r.price)) L.risk(-5, 'no quote')
    freshness(L, r.last, now, 'last purchase')
    const top = (r.top || [])[0]
    return {
      cat: 'insider', key, name: r.symbol, ticker: r.symbol, url: null, date: r.last, catalyst: null, L,
      headline: `${r.symbol} · ${r.buyers30} buyer${r.buyers30 === 1 ? '' : 's'}, ${usd(r.dollars30)} in 30 days${top ? ` · top: ${top.name}${top.title ? ` (${top.title})` : ''}` : ''}`,
      pin: { name: r.symbol, ticker: r.symbol, url: null, dates: [{ label: 'last buy', date: r.last }] },
      stale: age(r.last, now) > 75,
    }
  },

  '13D'(r, now) {
    const L = ledger(), key = `${r.cik}:${r.filer}`
    if (r.board) L.add(12, 'seeks board representation')
    if (r.strategic) L.add(12, 'pushes strategic alternatives or a sale')
    if (fin(r.pct) && r.pct >= 10) L.add(8, `${r.pct.toFixed(1)}% stake`)
    else if (fin(r.pct) && r.pct >= 5) L.add(4, `${r.pct.toFixed(1)}% stake`)
    if (!r.board && !r.strategic) L.add(4, 'a new activist stake')
    if (!fin(r.price)) L.risk(-5, 'no quote')
    freshness(L, r.filed, now, '13D filed')
    return {
      cat: '13D', key, name: r.name, ticker: r.ticker, url: r.url, date: r.filed, catalyst: null, L,
      headline: `${r.filer} → ${r.name}${fin(r.pct) ? ` · ${r.pct.toFixed(1)}%` : ''}${r.purpose ? ` · “${r.purpose.slice(0, 110)}${r.purpose.length > 110 ? '…' : ''}”` : ''}`,
      pin: { name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: '13D filed', date: r.filed }] },
      stale: age(r.filed, now) > 90,
    }
  },

  spac(r, now) {
    const L = ledger(), key = String(r.cik)
    const pre = r.stage === 'searching' || r.stage === 'extension vote'
    if (r.verify) L.risk(-25, 'discount looks wrong — trust may not be $10, or it is no longer a SPAC')
    if (pre && fin(r.discount) && r.discount > 0) {
      if (fin(r.yieldToTrust) && r.yieldToTrust >= 8) L.add(18, `${r.discount.toFixed(1)}% below trust, ${r.yieldToTrust.toFixed(1)}% a year to the deadline`)
      else if (fin(r.yieldToTrust) && r.yieldToTrust >= 5) L.add(10, `${r.discount.toFixed(1)}% below trust, ${r.yieldToTrust.toFixed(1)}% a year to the deadline`)
      else L.add(4, `${r.discount.toFixed(1)}% below trust`)
    }
    if (r.stage === 'liquidating' && fin(r.discount) && r.discount > 0) L.add(14, `liquidating ${r.discount.toFixed(1)}% below trust — the payout is close to certain`)
    if ((r.stage === 'deal announced' || r.stage === 'vote') && r.warrantTicker) L.add(4, 'deal announced — the warrants carry the upside')
    if (r.trustAssumed) L.risk(-6, 'trust assumed at $10 — read the 10-Q')
    if (!fin(r.price)) L.risk(-10, 'no quote')
    const cat = catalyst(L, r.vote ? 'vote' : 'deadline', r.vote || r.deadline, now)
    freshness(L, r.deal || r.ext || r.liq || r.ipo, now, r.deal ? 'deal announced' : r.liq ? 'liquidation filed' : 'latest filing')
    return {
      cat: 'spac', key, name: r.name, ticker: r.ticker, url: r.url, date: r.deal || r.ext || r.liq || r.ipo, catalyst: cat, L,
      headline: `${r.name} · ${r.stage}${r.target ? ` → ${r.target}` : ''}${fin(r.discount) ? ` · ${pct(-r.discount)} vs trust` : ''}`,
      pin: { name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: 'deadline (est.)', date: r.deadline }, { label: 'vote', date: r.vote }] },
      stale: false,
    }
  },

  buyback(r, now) {
    const L = ledger(), key = String(r.cik)
    if (r.verify) L.risk(-25, 'size looks wrong against market cap — likely a parse error')
    else if (fin(r.pctCap) && r.pctCap >= 10) L.add(26, `authorisation ${r.pctCap.toFixed(1)}% of market cap`)
    else if (fin(r.pctCap) && r.pctCap >= 5) L.add(16, `authorisation ${r.pctCap.toFixed(1)}% of market cap`)
    else if (fin(r.pctCap) && r.pctCap >= 3) L.add(6, `authorisation ${r.pctCap.toFixed(1)}% of market cap`)
    if (r.asr) L.add(6, 'accelerated share repurchase — the shares come off now')
    if (r.inEarnings) L.risk(-4, 'announced inside an earnings release — may be a routine re-up')
    if (!r.parsed) L.risk(-8, 'terms not read from the filing')
    freshness(L, r.filed, now, 'authorised')
    return {
      cat: 'buyback', key, name: r.name, ticker: r.ticker, url: r.url, date: r.filed, catalyst: null, L,
      headline: `${r.name} · ${usd(r.usd)} buyback${fin(r.pctCap) ? `, ${r.pctCap.toFixed(1)}% of cap` : ''}${r.asr ? ' · ASR' : ''}`,
      pin: { name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: 'through', date: r.expiry }] },
      stale: age(r.filed, now) > 90,
    }
  },
}

// ── confluence: which other boards is this ticker on? ──
function signalMap(feed, now) {
  const m = new Map()
  const put = (t, cat, text) => { if (!t) return; const a = m.get(t) || []; if (!a.some(x => x.cat === cat)) a.push({ cat, text }); m.set(t, a) }
  for (const r of feed.insider || []) if (r.buyers30 >= 2 && !r.tenPctOnly) put(r.symbol, 'insider', `${r.buyers30} insiders bought ${usd(r.dollars30)} in 30 days`)
  for (const r of feed.buybacks || []) if (fin(r.pctCap) && r.pctCap >= 3 && !r.verify) put(r.ticker, 'buyback', `buyback ${r.pctCap.toFixed(1)}% of cap`)
  for (const r of feed.activist || []) if (age(r.filed, now) <= 90) put(r.ticker, '13D', `13D by ${r.filer.split(' / ')[0]}`)
  for (const r of feed.recaps || []) if (r.stage === 'open' || r.stage === 'declared') put(r.ticker, 'recap', r.type)
  for (const r of feed.spinoffs || []) { if (r.stage !== 'distributed') { put(r.parentTicker, 'spinoff', 'spinning off a business'); put(r.ticker, 'spinoff', 'a pending spin-off') } }
  for (const r of feed.rights || []) if (r.stage === 'open' || r.stage === 'announced') put(r.ticker, 'rights', 'rights offering')
  for (const r of feed.reorg || []) if (age(r.emerged, now) <= 240) put(r.ticker, 'reorg', 'post-reorganisation equity')
  return m
}

export function scoreIdeas(feed, { now = Date.now() } = {}) {
  if (!feed) return []
  const signals = signalMap(feed, now)
  const rows = [
    ...(feed.spinoffs || []).map(r => SCORERS.spinoff(r, now)),
    ...(feed.mergers || []).map(r => SCORERS.merger(r, now)),
    ...(feed.reorg || []).map(r => SCORERS.reorg(r, now)),
    ...(feed.rights || []).map(r => SCORERS.rights(r, now)),
    ...(feed.recaps || []).map(r => SCORERS.recap(r, now)),
    ...(feed.insider || []).map(r => SCORERS.insider(r, now)),
    ...(feed.activist || []).map(r => SCORERS['13D'](r, now)),
    ...(feed.spacs || []).map(r => SCORERS.spac(r, now)),
    ...(feed.buybacks || []).map(r => SCORERS.buyback(r, now)),
  ]
  const out = []
  const seen = new Set()
  for (const x of rows) {
    if (x.stale) continue
    const id = `${x.cat}:${x.key}`
    if (seen.has(id)) continue
    seen.add(id)
    const also = x.ticker ? (signals.get(x.ticker) || []).filter(s => s.cat !== x.cat && !(x.cat === 'recap' && s.cat === 'recap')) : []
    if (also.length) x.L.add(Math.min(32, also.length * 18), `also on ${also.length === 1 ? 'another board' : `${also.length} other boards`}: ${also.map(s => s.text).join('; ')}`)
    const score = Math.max(0, Math.min(100, Math.round(x.L.total)))
    const [, grade, verdict] = gradeOf(score)
    out.push({
      id, cat: x.cat, key: x.key, name: x.name, ticker: x.ticker || null, url: x.url || null, date: x.date || null,
      score, grade, verdict, headline: x.headline, catalyst: x.catalyst,
      reasons: x.L.reasons.sort((a, b) => b.pts - a.pts), risks: x.L.risks,
      also: also.map(s => s.cat), pin: x.pin,
    })
  }
  out.sort((a, b) => b.score - a.score || (b.date || '').localeCompare(a.date || ''))
  // one idea per ticker: the best board leads, the rest ride along
  const byTicker = new Map(), merged = []
  for (const i of out) {
    const lead = i.ticker ? byTicker.get(i.ticker) : null
    if (lead) { lead.alsoIdeas.push({ cat: i.cat, score: i.score, headline: i.headline }); continue }
    const idea = { ...i, alsoIdeas: [] }
    if (i.ticker) byTicker.set(i.ticker, idea)
    merged.push(idea)
  }
  return merged
}
