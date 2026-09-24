// ============================================================================
// SPECIAL SITUATIONS — Greenblatt's "You Can Be a Stock Market Genius" and
// Suria's "The Event-Driven Edge", as a candidate pipeline
//   spinoffs   Form 10-12B registrations (the SpinCo registers itself) and the
//              parent's 8-K announcing a separation. Ratio, record and
//              distribution dates parsed from the information statement.
//   mergers    SC TO-T third-party tenders (target and bidder both named),
//              8-K Item 1.01 with an Agreement and Plan of Merger, DEFM14A
//              proxies as the vote stage, and FMP's M&A list to settle who is
//              acquiring whom. Cash terms parsed from the filing; spread and
//              annualised spread from the live quote. CVR / warrant / preferred
//              consideration is broken out as "merger securities" — the part
//              of merger arb Greenblatt actually recommends.
//   reorg      the bankruptcy feed's 8-K Item 1.03 petitions, then plan
//              effectiveness 8-Ks and 8-A12B new-equity registrations joined
//              by CIK — the post-reorganisation equity window.
//   rights     8-K rights offerings: subscription price, ratio, record and
//              expiry, oversubscription privilege, backstop.
//   recaps     SC TO-I issuer self-tenders (Dutch auctions and fixed-price,
//              interval-fund repurchases filtered out) and 8-K special
//              dividends — the leveraged-recap / stub setups.
//   insider    FMP open-market purchases (Form 4 code P), archived so clusters
//              build over 30 and 90 days.
//   activist   SCHEDULE 13D initial filings by fund-like filers.
//   spacs      424B4 SPAC prospectuses for the universe (trust per unit and the
//              deadline parsed; $10.00 and 24 months assumed until read), then
//              business-combination 8-Ks, DEFM14A votes, extension proxies and
//              liquidations for the stage. Suria's trade is the pre-deal SPAC
//              below trust: discount and yield-to-trust from the live quote,
//              with trust accreted at an assumed 4% a year since the IPO.
//   buybacks   8-K repurchase authorisations: size parsed, set against FMP
//              market cap, and flagged where insiders are buying alongside.
// Every parsed term is flagged as parsed: the boards surface candidates, the
// Deal Book is where the reading happens. EDGAR full-text search is free and
// keyless; FMP is the dashboard's existing key. Documents are fetched once and
// their parsed terms kept in special-archive.json, so a rebuild costs the
// sweeps plus quotes. Cached 6h, disk-backed, stale served on error.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { scoreIdeas } from './specialScore.js'

const H = 3600e3, TTL = 6 * H, DAY = 864e5
const fin = v => v != null && Number.isFinite(v)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ymd = d => new Date(d).toISOString().slice(0, 10)
const today = () => ymd(Date.now())
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const median = xs => { const a = xs.filter(fin).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null }
const MON = '(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}'
const toIso = s => { const t = Date.parse(s); return Number.isFinite(t) ? ymd(t) : null }
const num = s => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? v : null }
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const wnum = s => (s == null ? null : WORDS[String(s).toLowerCase()] ?? num(s))
const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|l\.p|holdings?|group|trust|n\.v|s\.a|ag|se)\b\.?/gi
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim()
const firstWord = s => norm(s).split(' ')[0] || ''
const similar = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; return x === y || x.startsWith(y) || y.startsWith(x) || (firstWord(a).length > 3 && firstWord(a) === firstWord(b)) }
const cleanName = s => (s == null ? null : String(s).replace(/\s*,?\s+an?\s+[A-Z][a-z]+\s+(?:corporation|company|limited|partnership|limited liability company|public limited company)\b.*$/i, '').replace(/\s+,/g, ',').replace(/[\s,.;:]+$/, '').trim() || null)
const FUNDLIKE = /\b(L\.?P\.?|Partners?|Capital|Management|Advisors?|Advisers?|Fund|Investments?|Asset|Master|Opportunit\w+|Value|Ventures|Holdings|Group|Associates|Equity|Activist|LLC)\b/i
const INTERVAL = /\bfund\b|\btrust\b|\bbdc\b|\bportfolio\b|private credit|infrastructure|\bincome\b|\breit\b|\bcapital corp/i
const SPAC = /acquisition corp|acquisition co\b|acquisition company|\bSPAC\b|capital corp\b|blank check/i
// the universe filter is a little wider: numbered vehicles ("Churchill Capital Corp XIII", "Cohen Circle Acquisition Corp. II")
const SPACISH = /acquisition|\bSPAC\b|blank check|capital corp\b|\b(?:corp|corporation|ltd|limited|inc|co)\.?\s+(?:I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV)\b\s*$/i

// ── regex sets — every match is a candidate value, flagged parsed ────────────
const RX = {
  spin: {
    ratio: new RegExp(`(\\d+(?:\\.\\d+)?|one|two|three)\\s+shares?\\s+of\\s+[^.]{0,90}?for\\s+(?:each|every)\\s+(\\w+)\\s+shares?`, 'i'),
    record: new RegExp(`record date[^.]{0,80}?(${MON})`, 'i'),
    dist: new RegExp(`distribution date[^.]{0,80}?(${MON})`, 'i'),
    distAlt: new RegExp(`(?:distribut\\w+|completed|complete the separation)[^.]{0,60}?(?:on or about|on)\\s+(${MON})`, 'i'),
    whenIssued: /when-?issued/i,
    ticker: /(?:under the (?:ticker )?symbol|ticker symbol|trading symbol)\s+["“”']*([A-Z]{1,5})["“”']*/,
    parent: /wholly[- ]owned subsidiary of ([A-Z][A-Za-z0-9&.,'’\- ]{2,70}?)(?:\s*\(|,|\.|;| and | that | which )/,
    taxFree: /tax-free|section 355/i,
    spin: /(?:pro rata|tax-free)\s+(?:distribution|spin-?off)|spin-?off of|separat(?:e|ion) into two|two (?:independent|separate|standalone) (?:publicly[- ]traded |public )?compan|distribution of (?:all|the) (?:outstanding )?(?:shares|common stock) of/i,
    incentive: /(?:equity|long-term|stock) incentive plan|founder|stock options? (?:to|for) (?:our |the )?(?:executive|management|officers)/i,
  },
  merger: {
    cash: /\$\s?([\d.]+)\s+(?:per share\s+)?in cash/i,
    cash2: /(?:cash consideration|purchase price|offer price)\s+(?:of|equal to)\s+\$\s?([\d.]+)\s+per share/i,
    cash3: /\$\s?([\d.]+)\s+per share(?:,| in cash| net to the seller| without interest)/i,
    stock: /(\d\.\d{2,4})\s+(?:of a\s+)?shares?\s+of\s+(?:[A-Z][\w.&'’-]*\s+){1,6}(?:common stock|ordinary shares|class [AB])/i,
    cvr: /contingent value right/i,
    warrant: /warrants? (?:to purchase|exercisable)/i,
    preferred: /preferred (?:stock|shares) (?:as|of) (?:merger )?consideration|consideration[^.]{0,80}preferred/i,
    outside: new RegExp(`(?:outside date|end date|termination date|long-?stop date)[^.]{0,90}?(${MON})`, 'i'),
    expiry: new RegExp(`(?:expire|expiration)[^.]{0,120}?(${MON})`, 'i'),
    meeting: new RegExp(`special meeting[^.]{0,120}?(${MON})`, 'i'),
    hsr: /Hart-Scott-Rodino|\bHSR\b/i,
    cfius: /CFIUS|Committee on Foreign Investment/i,
    goShop: /go-shop/i,
    financing: /financing condition|debt financing|commitment letter/i,
    parentDef: /([A-Z][A-Za-z0-9&.,'’\- ]{2,80}?)\s*\(\s*(?:the\s+)?["“”']?Parent["“”']?\s*\)/,
    companyDef: /([A-Z][A-Za-z0-9&.,'’\- ]{2,80}?)\s*\(\s*(?:the\s+)?["“”']?Company["“”']?\s*\)/,
    acquiredBy: /(?:to be|will be|being|was) acquired by ([A-Z][A-Za-z0-9&.,'’\- ]{2,70}?)(?:\s*\(|,|\.|;| for | in | pursuant)/,
    willAcquire: /(?:will|to|agreed to) acquire (?:all of the outstanding shares of |all outstanding shares of )?([A-Z][A-Za-z0-9&.,'’\- ]{2,70}?)(?:\s*\(|,|\.|;| for | in | pursuant)/,
  },
  reorg: {
    effective: new RegExp(`(?:effective date of the plan|plan became effective|became effective|emerged from|emergence from)[^.]{0,160}?(${MON})`, 'i'),
    confirmed: new RegExp(`(?:confirm(?:ed|ing)|confirmation order)[^.]{0,120}?(${MON})`, 'i'),
    confirmAny: /confirm(?:ed|ing|ation)[^.]{0,60}plan/i,
    newShares: /([\d,]{6,})\s+shares? of (?:new )?(?:common stock|ordinary shares)/i,
    freshStart: /fresh[- ]start/i,
    ch11: /chapter 11|bankruptcy code|title 11|bankruptcy court/i,
    otc: /\bOTC\b|over-the-counter|pink/i,
    listing: /(?:listed|listing|trade) on (?:the )?(?:New York Stock Exchange|NYSE|Nasdaq)/i,
  },
  rights: {
    subPrice: /subscription price(?: of|,| equal to| will be)?[^.$]{0,60}\$\s?([\d.]+)/i,
    ratio: /(one|two|three|\d+(?:\.\d+)?)\s*(?:\(\d+\)\s*)?(?:non-?transferable\s+|transferable\s+)?(?:subscription\s+)?rights?\s+(?:for|per)\s+(?:each|every)?\s*(one|\d+(?:,\d{3})*|\w+)?\s*shares?/i,
    perRight: /(?:each|every)\s+(?:subscription\s+)?right\s+(?:will\s+)?entitle[^.]{0,80}?(?:purchase|subscribe for)\s+(one|\d+(?:\.\d+)?)\s+shares?/i,
    record: new RegExp(`record date[^.]{0,80}?(${MON})`, 'i'),
    expiry: new RegExp(`(?:expire|expiration)[^.]{0,120}?(${MON})`, 'i'),
    oversub: /over-?subscription (?:privilege|right)/i,
    backstop: /backstop|standby purchas/i,
    transferable: /\b(non-?transferable|transferable)\b/i,
    gross: /(?:gross proceeds|raise|aggregate)[^.]{0,60}?\$\s?([\d.]+)\s*(million|billion)/i,
  },
  toi: {
    upTo: /(?:purchase|repurchase|tender)[^.]{0,160}?up to\s+(\$?[\d,.]+\s*(?:million|billion)|[\d,]+\s+shares)/i,
    range: /not (?:less|lower) than \$\s?([\d.]+)[^.]{0,60}?(?:not (?:greater|more|higher) than|up to|and not more than|to) \$\s?([\d.]+)/i,
    fixed: /(?:purchase price of|at a price of|price of)\s+\$\s?([\d.]+)\s+per share/i,
    dutch: /(?:modified )?dutch auction/i,
    expiry: new RegExp(`(?:expire|expiration)[^.]{0,120}?(${MON})`, 'i'),
    oddLot: /odd lot/i,
    recap: /recapitalization|term loan|notes offering|senior notes|credit facility/i,
    optionExchange: /option exchange|eligible options|exchange (?:offer|program)[^.]{0,60}(?:stock options|option holders)|outstanding options? for/i,
    preferredOnly: /depositary shares?|preferred (?:stock|shares)[^.]{0,40}tender/i,
  },
  div: {
    amount: /special (?:cash )?dividend of \$\s?([\d.]+)\s+per share/i,
    amount2: /\$\s?([\d.]+)\s+per share special (?:cash )?dividend/i,
    payable: new RegExp(`(?:payable|paid) on[^.]{0,60}?(${MON})`, 'i'),
    record: new RegExp(`record[^.]{0,80}?(${MON})`, 'i'),
    recap: /recapitalization|term loan|notes offering|senior notes|credit facility|borrow/i,
  },
  spac: {
    trust: /\$\s?(10\.\d{2}|10)\s+per (?:unit|public share|share)[^.]{0,80}?(?:trust|deposited)/i,
    trust2: /(?:trust account|held in trust)[^.]{0,120}?\$\s?(10\.\d{2}|10)\s+per (?:unit|public share|share)/i,
    months: /(\d{1,2})\s+months?\s+(?:from|after|following)\s+the\s+(?:closing|consummation|effective(?:ness)?)/i,
    months2: /(?:within|have|has|of)\s+(\d{1,2})\s+months?[^.]{0,60}?(?:closing|consummation) of (?:this|the|our) (?:initial public )?offering/i,
    units: /([\d,]{9,})\s+units/i,
    warrant: /(one-(?:half|third|fourth|fifth|sixth|eighth|tenth)|one)\s+(?:of one\s+)?(?:redeemable\s+)?warrant/i,
  },
  bca: {
    targetDef: /([A-Z][A-Za-z0-9&.,'’\- ]{2,70}?)\s*\(\s*(?:the\s+)?["“”']?(?:Target|Company)["“”']?\s*\)/g,
    withName: /Business Combination Agreement[^.]{0,220}?(?:with|among)\s+(?:the Company,\s*)?([A-Z][A-Za-z0-9&.,'’\- ]{2,60}?)(?:,| \(| and )/,
    among: /by and among\s+([^.]{10,340})/i,
    ev: /(?:pro forma )?(?:enterprise|equity) value[^.]{0,80}?\$\s?([\d.]+)\s*(million|billion)/i,
    pipe: /\bPIPE\b/,
  },
  bb: {
    usd: /(?:repurchase|buyback|buy back)[^.]{0,120}?up to\s+\$\s?([\d.]+)\s*(million|billion)/i,
    usd2: /\$\s?([\d.]+)\s*(million|billion)\s+(?:share |stock |common stock )?(?:repurchase|buyback)/i,
    usd3: /(?:authoriz\w+|approv\w+)[^.]{0,80}?\$\s?([\d.]+)\s*(million|billion)/i,
    shares: /(?:repurchase|buyback)[^.]{0,80}?up to\s+([\d,]{6,})\s+shares/i,
    pct: /(?:approximately|representing|about)\s+([\d.]+)%\s+of (?:its|the company['’]s|the)[^.]{0,40}?outstanding/i,
    additional: /additional|increas\w+|new (?:share )?repurchase|replaces?|expand/i,
    expiry: new RegExp(`(?:through|until|expir\\w+|remains? in effect|valid)[^.]{0,40}?(${MON})`, 'i'),
    asr: /accelerated share repurchase/i,
    debt: /term loan|notes offering|senior notes|borrow|credit facility/i,
  },
  d13: {
    pct: /percent of class represented[^0-9]{0,120}?([\d.]+)\s*%?/i,
    pctXml: /<percentOfClass>\s*([\d.]+)/i,
    purpose: /purpose of transaction\.?\s*(.{60,700}?)(?:item 5|interest in securities)/i,
    purposeXml: /<transactionPurpose>\s*([\s\S]{40,900}?)<\/transactionPurpose>/i,
    board: /board (?:seat|representation|of directors)|nominate|proxy (?:contest|fight)|director candidates/i,
    strategic: /strategic alternatives|sale of the (?:company|issuer)|maximize (?:shareholder|stockholder) value|undervalued/i,
  },
}

function parse(text, rx) {
  const out = {}
  for (const [k, re] of Object.entries(rx)) {
    const m = text.match(re)
    out[k] = m ? (m[2] !== undefined ? [m[1], m[2]] : m[1] !== undefined ? m[1] : true) : null
  }
  return out
}

const strip = html => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;|&#x2019;/g, '’').replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
  .replace(/\s+/g, ' ')

// "NAME  (TICK, TICK2)  (CIK 0000123)" → { name, tickers, ticker, cik }
function party(disp) {
  const m = String(disp || '').match(/^(.*?)\s*(?:\(([A-Z0-9.,\- ]+)\))?\s*\(CIK\s*(\d+)\)\s*$/)
  if (!m) return { name: String(disp || '').trim(), tickers: [], ticker: null, cik: null }
  const tickers = (m[2] || '').split(',').map(s => s.trim()).filter(Boolean)
  // the common: prefer a symbol with no share-class or preferred suffix
  const ticker = tickers.find(t => !/-/.test(t) && t.length <= 4) || tickers.find(t => !/-/.test(t)) || tickers[0] || null
  return { name: m[1].trim(), tickers, ticker, cik: +m[3] }
}

function row(h) {
  const s = h._source || {}
  const [adsh, fname] = String(h._id || '').split(':')
  const parties = (s.display_names || []).map(party)
  const p = parties[0] || { name: '?', tickers: [], ticker: null, cik: (s.ciks || [])[0] ? +(s.ciks || [])[0] : null }
  const cik = p.cik || ((s.ciks || [])[0] ? +(s.ciks || [])[0] : null)
  return {
    adsh, form: s.form, date: s.file_date, items: s.items || [], parties, name: p.name, ticker: p.ticker, cik,
    state: (s.biz_states || [])[0] || null, sic: (s.sics || [])[0] || null,
    doc: cik && adsh && fname ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, '')}/${fname}` : null,
    index: cik && adsh ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, '')}/${adsh}-index.htm` : null,
  }
}

export function createSpecialSituations({ fetchYahooSparkline, FMP_KEY, UA, dir, bankruptcy }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  const FILE = 'special-situations.json', ARCHIVE = 'special-archive.json', BOOK = 'special-dealbook.json'
  let mem = null, inflight = null
  // docs: parsed terms by "category:adsh" (permanent — a filing does not change);
  // insider: open-market purchases by key, pruned at 120 days
  const archive = load(ARCHIVE) || { docs: {}, insider: {} }
  archive.docs = archive.docs || {}; archive.insider = archive.insider || {}
  for (const k of Object.keys(archive.docs)) if (/^(13d|conf|eff):/.test(k)) delete archive.docs[k] // parsed under earlier rules

  const EH = { 'User-Agent': UA, Accept: 'application/json' }
  let edgarNext = 0
  // One request slot every 150 ms (EDGAR allows ten a second), claimed
  // synchronously so concurrent callers queue behind each other instead of
  // bursting. The full-text backend returns sporadic 500s even on queries that
  // succeed a second later, so a 5xx or 429 is retried twice with a growing pause.
  async function edgar(url, asJson = true) {
    for (let attempt = 0; ; attempt++) {
      const slot = Math.max(Date.now(), edgarNext); edgarNext = slot + 150
      const wait = slot - Date.now()
      if (wait > 0) await sleep(wait)
      const r = await fetch(url, { headers: asJson ? EH : { 'User-Agent': UA } })
      if (r.ok) return asJson ? r.json() : r.text()
      if ((r.status >= 500 || r.status === 429) && attempt < 2) { await sleep(1500 * (attempt + 1)); continue }
      throw new Error(`EDGAR HTTP ${r.status}`)
    }
  }

  // full-text search, paged; q must be non-empty on this endpoint so form-only
  // sweeps use a stop word
  async function fts({ q = 'a', forms, days = 180, pages = 1 }) {
    const end = today(), start = ymd(Date.now() - days * DAY)
    const out = []
    for (let p = 0; p < pages; p++) {
      let j
      try { j = await edgar(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}${forms ? `&forms=${encodeURIComponent(forms)}` : ''}&dateRange=custom&startdt=${start}&enddt=${end}&from=${p * 100}`) }
      catch (e) { if (p === 0) throw e; console.warn(`special fts page ${p} of ${forms || q}:`, e.message); break }
      const hits = j.hits?.hits || []
      out.push(...hits.map(row))
      if (hits.length < 100) break
    }
    return out
  }

  // a small worker pool: n items in flight, results in input order
  async function pmap(items, n, fn) {
    const out = new Array(items.length); let i = 0
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } }))
    return out
  }

  // fetch-and-parse once per filing per category. Budgeted per category per
  // build, newest first, so a cold start spends about a minute on documents and
  // the archive fills in over the following builds.
  const BUDGET = { spin: 14, spinann: 16, tot: 12, m8k: 16, defm: 6, conf2: 8, eff2: 10, rights: 16, toi: 10, div: 12, '13dx': 16, spac: 16, bca: 14, bb: 40 }
  let budget = {}
  async function terms(cat, r, rx, { xml = false, post = null } = {}) {
    const key = `${cat}:${r.adsh}`
    if (archive.docs[key]) return archive.docs[key]
    if (!r.doc || (budget[cat] ?? 0) <= 0) return null
    budget[cat]--
    try {
      const raw = await edgar(r.doc, false)
      if (raw.length > 4e6) { archive.docs[key] = { skipped: 'too large' }; return archive.docs[key] }
      const text = strip(raw)
      const t = parse(text, rx)
      if (xml) { const px = raw.match(RX.d13.pctXml); if (px) t.pct = px[1]; const pu = raw.match(RX.d13.purposeXml); if (pu) t.purpose = strip(pu[1]) }
      if (post) post(text, t)
      t.len = text.length
      archive.docs[key] = t
      return t
    } catch (e) { console.warn(`special doc ${cat} ${r.doc}: ${e.message}`); return null }
  }

  // read a board's documents three at a time before its row loop runs; cached ones cost nothing
  const prefetchDocs = (cat, rows, rx, opts) => pmap(rows, 3, r => terms(cat, r, rx, opts))

  // ── quotes: memoised per build, fetched four at a time ────────────────────
  // The same chart request vite's fetchYahooQuote makes, made here so the
  // status is visible: a 429 or 5xx is a rate limit and the pool slows down,
  // while an unknown ticker (a SPAC whose units have not split) is just null.
  let yahooGap = 120
  async function yahooQuote(t) {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=1d&interval=1d`, { headers: { 'User-Agent': UA } })
    if (r.status === 429 || r.status >= 500) { yahooGap = Math.min(yahooGap * 2, 1000); await sleep(3000); return null }
    if (!r.ok) return null
    const m = (await r.json())?.chart?.result?.[0]?.meta
    if (!m || m.regularMarketPrice == null) return null
    const prev = m.chartPreviousClose ?? m.previousClose ?? null, price = m.regularMarketPrice
    return { price, change: prev != null ? price - prev : null, changePct: prev ? (price - prev) / prev : null, prevClose: prev, timestamp: m.regularMarketTime ?? null }
  }
  // the memo holds promises, so a ticker requested twice is fetched once
  const quotes = {}
  function quote(t) {
    if (!t) return Promise.resolve(null)
    if (quotes[t] === undefined) quotes[t] = (async () => { await sleep(yahooGap); return yahooQuote(t).catch(() => null) })()
    return quotes[t]
  }
  const prefetchQuotes = tickers => pmap([...new Set(tickers.filter(Boolean))].filter(t => quotes[t] === undefined), 4, quote)
  async function spark(t) { if (!t) return []; await sleep(120); return (await fetchYahooSparkline(t, '3mo', '1d').catch(() => [])).map(p => r2(p.v)).filter(fin) }

  let fmpNext = 0
  async function fmp(pathq) {
    if (!FMP_KEY) return null
    const slot = Math.max(Date.now(), fmpNext); fmpNext = slot + 200
    if (slot > Date.now()) await sleep(slot - Date.now())
    const sep = pathq.includes('?') ? '&' : '?'
    const r = await fetch(`https://financialmodelingprep.com/stable/${pathq}${sep}apikey=${FMP_KEY}`)
    if (!r.ok) throw new Error(`FMP HTTP ${r.status}`)
    const j = await r.json()
    return Array.isArray(j) ? j : null
  }

  // fetched once per build, shared by the merger and SPAC boards
  let memo = {}
  const proxiesAll = () => (memo.proxies ??= fts({ forms: 'DEFM14A', days: 180, pages: 1 }).then(newest))
  const maList = () => (memo.ma ??= (async () => { try { return [...(await fmp('mergers-acquisitions-latest?page=0&limit=100') || []), ...(await fmp('mergers-acquisitions-latest?page=1&limit=100') || [])] } catch (e) { console.warn('special M&A:', e.message); return [] } })())
  // FMP market cap, kept a week in the archive; a build reads at most forty fresh ones
  archive.mcap = archive.mcap || {}
  let mcapBudget = 0
  async function marketCap(t) {
    if (!t) return null
    const c = archive.mcap[t]
    if (c && Date.now() - c.ts < 7 * DAY) return c.v
    if (mcapBudget <= 0) return c?.v ?? null
    mcapBudget--
    try { const rows = await fmp(`profile?symbol=${encodeURIComponent(t)}`); const v = rows?.[0]?.marketCap; if (fin(v)) { archive.mcap[t] = { v, ts: Date.now() }; return v } } catch {}
    return c?.v ?? null
  }
  const amtM = v => { if (!v) return null; const [n, u] = Array.isArray(v) ? v : [v, 'million']; const x = num(n); return x == null ? null : /^b/i.test(u) ? x * 1000 : x }

  const dedupeBy = (rows, keyOf) => { const m = new Map(); for (const r of rows) { const k = keyOf(r); if (!m.has(k)) m.set(k, r) } return [...m.values()] }
  const newest = rows => [...rows].sort((a, b) => b.date.localeCompare(a.date))

  // ── spinoffs ──────────────────────────────────────────────────────────────
  async function spinoffs() {
    const [f10, ann] = await Promise.all([fts({ forms: '10-12B,10-12B/A', days: 240, pages: 2 }).then(newest), fts({ q: '"spin-off" "separation"', forms: '8-K', days: 180, pages: 2 }).then(newest)])
    const byCik = new Map()
    for (const r of f10) {
      const g = byCik.get(r.cik) || { spinco: r.name, ticker: r.ticker, cik: r.cik, filings: [], first: r.date, latest: r.date }
      if (!g.filings.some(f => f.adsh === r.adsh)) g.filings.push(r); g.first = r.date < g.first ? r.date : g.first; g.latest = r.date > g.latest ? r.date : g.latest
      if (r.ticker && !g.ticker) g.ticker = r.ticker
      byCik.set(r.cik, g)
    }
    const out = []
    await prefetchDocs('spin', [...byCik.values()].map(g => newest(g.filings)[0]), RX.spin)
    await prefetchQuotes([...byCik.values()].map(g => g.ticker))
    for (const g of byCik.values()) {
      const latest = newest(g.filings)[0]
      const t = await terms('spin', latest, RX.spin)
      const afterFiling = d => (d && d >= ymd(Date.parse(g.first) - 30 * DAY) ? d : null)
      const dist = afterFiling(t ? toIso(t.dist || (Array.isArray(t.distAlt) ? t.distAlt[0] : t.distAlt)) : null)
      const record = afterFiling(t ? toIso(t.record) : null)
      const parent = cleanName(t?.parent)
      if (t && !t.spin && !(parent && !similar(parent, g.spinco))) continue // registered itself; not a separation
      const ratio = t?.ratio ? `${wnum(t.ratio[0])} for ${wnum(t.ratio[1]) ?? t.ratio[1]}` : null
      const distributed = dist && dist <= today()
      const stage = distributed ? 'distributed' : dist ? 'dated' : g.filings.length > 1 ? `Form 10 amended ×${g.filings.length - 1}` : 'Form 10 filed'
      const q = distributed && g.ticker ? await quote(g.ticker) : null
      const sp = distributed && g.ticker ? await spark(g.ticker) : []
      out.push({
        kind: 'form10', spinco: g.spinco, ticker: g.ticker, cik: g.cik, parent, parentTicker: null, stage, amendments: g.filings.length - 1,
        firstFiled: g.first, latestFiled: g.latest, record, dist, daysToDist: dist ? daysBetween(today(), dist) : null, ratio,
        whenIssued: !!t?.whenIssued, taxFree: !!t?.taxFree, incentive: !!t?.incentive, symbolInDoc: t?.ticker || null,
        price: q?.price ?? null, changePct: fin(q?.changePct) ? r2(q.changePct * 100) : null, spark: sp, sinceDist: sp.length > 2 && distributed ? r1((sp[sp.length - 1] / sp[0] - 1) * 100) : null,
        parsed: !!t, url: latest.index, state: latest.state,
      })
    }
    // parent announcements whose CIK has no Form 10 of its own
    const f10Ciks = new Set(byCik.keys())
    const corporate = r => !r.items.length || r.items.some(i => /^(1\.01|2\.01|7\.01|8\.01|3\.03|5\.03)/.test(i))
    const parents = dedupeBy(ann.filter(r => !f10Ciks.has(r.cik) && r.ticker && corporate(r)), r => r.cik)
    await prefetchDocs('spinann', parents, RX.spin)
    await prefetchQuotes(parents.map(r => r.ticker))
    for (const r of parents) {
      const t = await terms('spinann', r, RX.spin)
      if (t && !t.spin) continue // read it, and it is not a separation of a business
      const dist = (d => (d && d >= ymd(Date.parse(r.date) - 30 * DAY) ? d : null))(t ? toIso(t.dist || (Array.isArray(t.distAlt) ? t.distAlt[0] : t.distAlt)) : null)
      const q = await quote(r.ticker)
      out.push({
        kind: 'parent8k', spinco: null, ticker: null, cik: r.cik, parent: r.name, parentTicker: r.ticker, stage: dist && dist <= today() ? 'distributed' : dist ? 'dated' : 'announced',
        amendments: 0, firstFiled: r.date, latestFiled: r.date, record: t ? toIso(t.record) : null, dist, daysToDist: dist ? daysBetween(today(), dist) : null,
        ratio: t?.ratio ? `${wnum(t.ratio[0])} for ${wnum(t.ratio[1]) ?? t.ratio[1]}` : null, whenIssued: !!t?.whenIssued, taxFree: !!t?.taxFree, incentive: !!t?.incentive, symbolInDoc: t?.ticker || null,
        price: q?.price ?? null, changePct: fin(q?.changePct) ? r2(q.changePct * 100) : null, spark: [], sinceDist: null, parsed: !!t, url: r.index, state: r.state,
      })
    }
    return out.sort((a, b) => (b.latestFiled || '').localeCompare(a.latestFiled || ''))
  }

  // ── merger arb ────────────────────────────────────────────────────────────
  async function mergers() {
    const [tot, k8, proxies, cvrs, fmpMa] = await Promise.all([
      fts({ forms: 'SC TO-T,SC TO-T/A', days: 180, pages: 2 }).then(rows => newest(rows).filter(r => !SPAC.test(r.name))),
      fts({ q: '"Agreement and Plan of Merger"', forms: '8-K', days: 120, pages: 3 }).then(rows => newest(rows).filter(r => r.items.includes('1.01') && !r.items.includes('2.01') && !SPAC.test(r.name))),
      proxiesAll().then(rows => rows.filter(r => !SPAC.test(r.name))),
      fts({ q: '"contingent value right"', forms: '8-K', days: 180, pages: 1 }).then(newest),
      maList(),
    ])
    await Promise.all([prefetchDocs('tot', dedupeBy(tot, r => r.cik), RX.merger), prefetchDocs('m8k', dedupeBy(k8, r => r.cik), RX.merger), prefetchDocs('defm', dedupeBy(proxies, r => r.cik), RX.merger)])
    const byAcq = new Map(fmpMa.map(m => [+m.cik, m])), byTgt = new Map(fmpMa.map(m => [+m.targetedCik, m]))

    const deals = new Map() // key: target cik
    const upsert = (cik, patch) => { const d = deals.get(cik) || { targetCik: cik, filings: [], flags: {}, consideration: {} }; Object.assign(d, patch, { flags: { ...d.flags, ...(patch.flags || {}) }, consideration: { ...d.consideration, ...(patch.consideration || {}) } }); deals.set(cik, d); return d }

    // tenders: target first, bidder second
    for (const r of dedupeBy(tot, r => r.cik)) {
      const bidder = r.parties[1] || null
      const t = await terms('tot', r, RX.merger)
      const d = upsert(r.cik, { target: r.name, ticker: r.ticker, acquirer: bidder?.name || null, acquirerTicker: bidder?.ticker || null, stage: 'tender', announced: r.date, tenderExpiry: t ? toIso(t.expiry) : null, url: r.index, role: 'filing' })
      if (t) Object.assign(d.consideration, { cash: num(t.cash || t.cash2 || t.cash3), stock: t.stock ? num(t.stock) : null, cvr: !!t.cvr, warrant: !!t.warrant, preferred: !!t.preferred }), Object.assign(d.flags, { hsr: !!t.hsr, cfius: !!t.cfius, financing: !!t.financing })
      d.filings.push({ form: r.form, date: r.date, url: r.index })
    }
    // 8-K 1.01: settle the role with FMP first, then the defined terms in the text
    for (const r of dedupeBy(k8, r => r.cik)) {
      const t = await terms('m8k', r, RX.merger)
      let role = null, other = null, otherTicker = null
      if (byTgt.has(r.cik)) { role = 'target'; const m = byTgt.get(r.cik); other = m.companyName; otherTicker = m.symbol }
      else if (byAcq.has(r.cik)) { role = 'acquirer'; const m = byAcq.get(r.cik); other = m.targetedCompanyName; otherTicker = m.targetedSymbol || null }
      else if (t) {
        const parentDef = t.parentDef, companyDef = t.companyDef
        if (parentDef && similar(parentDef, r.name)) { role = 'acquirer'; other = companyDef || (t.willAcquire || null) }
        else if (companyDef && similar(companyDef, r.name)) { role = 'target'; other = parentDef || t.acquiredBy || null }
        else if (t.acquiredBy) { role = 'target'; other = t.acquiredBy }
        else if (t.willAcquire) { role = 'acquirer'; other = t.willAcquire }
        other = cleanName(other)
      }
      if (!role) continue // an 8-K we cannot place is not a candidate yet
      if (other && (norm(other).length < 4 || /^(?:the )?(?:company|parent|merger sub|company stock|buyer|seller|purchaser)$/i.test(norm(other)))) other = null
      if (role === 'acquirer' && !other) continue // an acquirer with no identifiable target is not a row
      const targetCik = role === 'target' ? r.cik : -r.cik // acquirer-side rows key on a negative cik until a target filing matches
      const existing = role === 'acquirer' ? [...deals.values()].find(d => d.target && other && similar(d.target, other)) : null
      const d = existing || upsert(targetCik, {})
      Object.assign(d, {
        target: d.target || (role === 'target' ? r.name : other), ticker: d.ticker || (role === 'target' ? r.ticker : otherTicker),
        acquirer: d.acquirer || (role === 'acquirer' ? r.name : other), acquirerTicker: d.acquirerTicker || (role === 'acquirer' ? r.ticker : otherTicker),
        stage: d.stage || 'announced', announced: d.announced && d.announced < r.date ? d.announced : r.date, url: d.url || r.index, role: d.role || (byTgt.has(r.cik) || byAcq.has(r.cik) ? 'FMP' : 'parsed'),
      })
      if (t) {
        if (!fin(d.consideration.cash)) d.consideration.cash = num(t.cash || t.cash2 || t.cash3)
        if (!fin(d.consideration.stock) && t.stock) d.consideration.stock = num(t.stock)
        d.consideration.cvr = d.consideration.cvr || !!t.cvr; d.consideration.warrant = d.consideration.warrant || !!t.warrant; d.consideration.preferred = d.consideration.preferred || !!t.preferred
        d.outsideDate = d.outsideDate || (t.outside ? toIso(t.outside) : null)
        Object.assign(d.flags, { hsr: d.flags.hsr || !!t.hsr, cfius: d.flags.cfius || !!t.cfius, goShop: d.flags.goShop || !!t.goShop, financing: d.flags.financing || !!t.financing })
      }
      d.filings.push({ form: r.form, date: r.date, url: r.index })
    }
    // proxies mark the vote stage
    for (const r of dedupeBy(proxies, r => r.cik)) {
      const d = deals.get(r.cik) || [...deals.values()].find(x => x.target && similar(x.target, r.name))
      const t = await terms('defm', r, RX.merger)
      if (d) { if (d.stage !== 'tender') d.stage = 'proxy'; d.meeting = t ? toIso(t.meeting) : null; d.filings.push({ form: r.form, date: r.date, url: r.index }); if (t) { if (!fin(d.consideration.cash)) d.consideration.cash = num(t.cash || t.cash2 || t.cash3); d.consideration.cvr = d.consideration.cvr || !!t.cvr; d.outsideDate = d.outsideDate || (t.outside ? toIso(t.outside) : null) } }
      else upsert(r.cik, { target: r.name, ticker: r.ticker, stage: 'proxy', announced: r.date, url: r.index, role: 'proxy', meeting: t ? toIso(t.meeting) : null, consideration: t ? { cash: num(t.cash || t.cash2 || t.cash3), cvr: !!t.cvr } : {} }).filings.push({ form: r.form, date: r.date, url: r.index })
    }
    for (const r of cvrs) { const d = deals.get(r.cik) || [...deals.values()].find(x => x.target && similar(x.target, r.name)); if (d) d.consideration.cvr = true }

    // a quote only matters where there are terms to set against it
    const priced = d => d.target && (fin(d.consideration.cash) || fin(d.consideration.stock))
    const pricedDeals = [...deals.values()].filter(priced)
    await prefetchQuotes([...pricedDeals.map(d => d.ticker), ...pricedDeals.filter(d => fin(d.consideration.stock)).map(d => d.acquirerTicker)])
    const out = []
    for (const d of deals.values()) {
      if (!d.target) continue
      const q = priced(d) ? await quote(d.ticker) : null
      const aq = fin(d.consideration.stock) ? await quote(d.acquirerTicker) : null
      const price0 = q?.price ?? null
      const rawCash = d.consideration.cash
      const cash = fin(rawCash) && rawCash > 0 && (!fin(price0) || (rawCash >= 0.7 * price0 && rawCash <= 2 * price0)) ? rawCash : null
      const stockVal = fin(d.consideration.stock) && aq?.price ? d.consideration.stock * aq.price : null
      const value = fin(cash) || fin(stockVal) ? (cash || 0) + (stockVal || 0) : null
      const price = q?.price ?? null
      const gross = fin(value) && fin(price) && price > 0 ? (value / price - 1) * 100 : null
      const close = d.tenderExpiry || d.meeting || d.outsideDate || null
      const closeAssumed = !close
      const pastClose = !!close && close < today()
      const days = close ? Math.max(daysBetween(today(), close), 1) : Math.max(150 - daysBetween(d.announced, today()), 30)
      // past the last dated milestone the deal has closed, lapsed or gone quiet — the spread stays, the annualising stops
      const ann = fin(gross) && !pastClose ? gross * (365 / days) : null
      out.push({
        target: d.target, ticker: d.ticker, targetCik: d.targetCik > 0 ? d.targetCik : null, acquirer: d.acquirer, acquirerTicker: d.acquirerTicker, stage: pastClose ? `${d.stage} · past date` : d.stage, announced: d.announced, role: d.role, pastClose,
        cash: fin(cash) ? r2(cash) : null, stock: fin(d.consideration.stock) ? d.consideration.stock : null, acquirerPrice: aq?.price ?? null, value: fin(value) ? r2(value) : null,
        price, gross: r2(gross), annualized: r1(ann), daysToClose: days, closeDate: close, closeAssumed, outsideDate: d.outsideDate || null, meeting: d.meeting || null, tenderExpiry: d.tenderExpiry || null,
        securities: { cvr: !!d.consideration.cvr, warrant: !!d.consideration.warrant, preferred: !!d.consideration.preferred }, flags: d.flags,
        filings: d.filings.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), url: d.url,
      })
    }
    return out.sort((a, b) => (fin(b.gross) ? 1 : 0) - (fin(a.gross) ? 1 : 0) || (b.announced || '').localeCompare(a.announced || ''))
  }

  // ── restructurings ────────────────────────────────────────────────────────
  async function reorg() {
    let petitions = []
    try { const bk = await bankruptcy(); petitions = (bk?.public?.list || []).map(r => ({ ...r, cik: r.url ? +(r.url.match(/edgar\/data\/(\d+)/) || [])[1] || null : null })) } catch (e) { console.warn('special reorg: bankruptcy feed', e.message) }
    const petitionCiks = new Set(petitions.map(p => p.cik).filter(Boolean))
    // Item 1.03 is where plan confirmation and effectiveness get reported; an
    // 8-K without it and without a petition on file is an incentive-plan 8-K
    const bankrupt = r => r.items.includes('1.03') || petitionCiks.has(r.cik)
    const [eff, conf, listings] = await Promise.all([
      fts({ q: '"effective date of the plan" "reorganization"', forms: '8-K', days: 240, pages: 2 }).then(rows => newest(rows).filter(bankrupt)),
      fts({ q: '"confirmation order" "plan of reorganization"', forms: '8-K', days: 240, pages: 2 }).then(rows => newest(rows).filter(bankrupt)),
      fts({ forms: '8-A12B,8-A12B/A', days: 240, pages: 2 }).then(newest),
    ])
    await Promise.all([prefetchDocs('conf2', dedupeBy(conf, r => r.cik), RX.reorg), prefetchDocs('eff2', dedupeBy(eff, r => r.cik), RX.reorg)])
    const byCik = new Map()
    const get = (cik, name, ticker) => { const g = byCik.get(cik) || { cik, name, ticker: ticker || null, tickers: new Set(), petition: null, confirmed: null, emerged: null, listed: null, filings: [] }; if (ticker) g.tickers.add(ticker); byCik.set(cik, g); return g }
    for (const p of petitions) if (p.cik) { const g = get(p.cik, String(p.name).replace(/\s*\([A-Z0-9.,\- ]+\)\s*$/, '').trim(), p.ticker); g.petition = g.petition && g.petition < p.date ? g.petition : p.date; g.filings.push({ form: '8-K 1.03', date: p.date, url: p.url }) }
    for (const r of dedupeBy(conf, r => r.cik)) { const t = await terms('conf2', r, RX.reorg); if (t && !t.ch11) continue; const g = get(r.cik, r.name, r.ticker); g.confirmed = (t && toIso(t.confirmed)) || r.date; g.filings.push({ form: '8-K confirmed', date: r.date, url: r.index }) }
    for (const r of dedupeBy(eff, r => r.cik)) {
      const t = await terms('eff2', r, RX.reorg); if (t && !t.ch11) continue
      const g = get(r.cik, r.name, r.ticker)
      g.emerged = (t && toIso(t.effective)) || r.date; g.newShares = t?.newShares ? num(t.newShares) : null; g.freshStart = !!t?.freshStart; g.otc = !!t?.otc; g.exchange = !!t?.listing
      g.filings.push({ form: '8-K effective', date: r.date, url: r.index })
    }
    const known = new Set(byCik.keys())
    for (const r of listings) if (known.has(r.cik)) { const g = byCik.get(r.cik); g.listed = g.listed && g.listed < r.date ? g.listed : r.date; if (r.ticker) g.tickers.add(r.ticker); g.filings.push({ form: r.form, date: r.date, url: r.index }) }
    const out = []
    for (const g of byCik.values()) {
      if (!g.emerged && !g.confirmed && !g.listed) continue // plain petitions stay on the bankruptcy tab
      // post-emergence symbol: the one without the Q suffix if any
      const tickers = [...g.tickers]
      const ticker = tickers.find(t => !/Q$/.test(t)) || tickers[0] || null
      const stage = g.listed ? 'listed' : g.emerged ? (g.emerged <= today() ? 'emerged' : 'effective date set') : 'plan confirmed'
      const q = ticker ? await quote(ticker) : null
      const sp = ticker && stage !== 'plan confirmed' ? await spark(ticker) : []
      out.push({
        name: g.name, ticker, oldTickers: tickers.filter(t => /Q$/.test(t) && t !== ticker), cik: g.cik, stage, petition: g.petition, confirmed: g.confirmed, emerged: g.emerged, listed: g.listed,
        daysSince: g.emerged ? daysBetween(g.emerged, today()) : null, newShares: g.newShares || null, freshStart: !!g.freshStart, otc: !!g.otc, exchange: !!g.exchange,
        price: q?.price ?? null, spark: sp, since: sp.length > 2 ? r1((sp[sp.length - 1] / sp[0] - 1) * 100) : null,
        filings: g.filings.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), url: g.filings[0]?.url || null,
      })
    }
    return out.sort((a, b) => (b.emerged || b.confirmed || '').localeCompare(a.emerged || a.confirmed || ''))
  }

  // ── rights offerings ──────────────────────────────────────────────────────
  async function rights() {
    const hits = newest(await fts({ q: '"rights offering"', forms: '8-K', days: 150, pages: 2 })).filter(r => r.ticker && !SPAC.test(r.name))
    const rows = dedupeBy(hits, r => r.cik)
    await prefetchDocs('rights', rows, RX.rights)
    const read = []
    for (const [i, r] of rows.entries()) { const t = await terms('rights', r, RX.rights); read.push({ r, t, needs: (t != null && num(t.subPrice) != null) || i < 30 }) }
    await prefetchQuotes(read.filter(x => x.needs).map(x => x.r.ticker))
    const out = []
    for (const { r, t, needs } of read) {
      const sub = t ? num(t.subPrice) : null
      const record = t ? toIso(t.record) : null, expiry = t ? toIso(t.expiry) : null
      const q = needs ? await quote(r.ticker) : null
      const disc = fin(sub) && q?.price ? (1 - sub / q.price) * 100 : null
      const stage = expiry && expiry < today() ? 'closed' : record && record <= today() ? 'open' : daysBetween(r.date, today()) > 60 && !expiry ? 'likely closed' : 'announced'
      const rr = t?.ratio ? (Array.isArray(t.ratio) ? t.ratio : [t.ratio, null]) : null
      const ratio = rr ? `${wnum(rr[0]) ?? rr[0]} right${wnum(rr[0]) === 1 ? '' : 's'} per ${wnum(rr[1]) ?? rr[1] ?? 1} share` : null
      out.push({
        name: r.name, ticker: r.ticker, cik: r.cik, filed: r.date, stage, subPrice: sub, ratio, perRight: t?.perRight ? wnum(t.perRight) : null, record, expiry, daysToExpiry: expiry ? daysBetween(today(), expiry) : null,
        oversub: !!t?.oversub, backstop: !!t?.backstop, transferable: t?.transferable ? !/non/i.test(t.transferable) : null, gross: t?.gross ? `${t.gross[0]}${t.gross[1][0] === 'b' ? 'B' : 'M'}` : null,
        price: q?.price ?? null, discount: r1(disc), parsed: !!t, url: r.index, state: r.state,
      })
    }
    return out
  }

  // ── recaps: self-tenders and special dividends ────────────────────────────
  async function recaps() {
    const [toi, divs] = await Promise.all([
      fts({ forms: 'SC TO-I,SC TO-I/A', days: 90, pages: 4 }).then(rows => newest(rows).filter(r => r.ticker && !INTERVAL.test(r.name) && !SPAC.test(r.name))),
      fts({ q: '"special dividend"', forms: '8-K', days: 150, pages: 2 }).then(rows => newest(rows).filter(r => r.ticker)),
    ])
    const tenders = dedupeBy(toi, r => r.cik), dividends = dedupeBy(divs, r => r.cik)
    await Promise.all([prefetchDocs('toi', tenders, RX.toi), prefetchDocs('div', dividends, RX.div)])
    const divRead = []
    for (const [i, r] of dividends.entries()) { const t = await terms('div', r, RX.div); divRead.push({ r, t, needs: (t != null && num(t.amount || t.amount2) != null) || i < 30 }) }
    await prefetchQuotes([...tenders.map(r => r.ticker), ...divRead.filter(x => x.needs).map(x => x.r.ticker)])
    const out = []
    for (const r of tenders) {
      const t = await terms('toi', r, RX.toi)
      if (t && t.optionExchange) continue // an employee option repricing, not a buyback
      const range = t?.range ? [num(t.range[0]), num(t.range[1])] : null
      const fixed = t ? num(t.fixed) : null
      const expiry = t ? toIso(t.expiry) : null
      const q = await quote(r.ticker)
      const top = range ? range[1] : fixed
      const premium = fin(top) && q?.price ? (top / q.price - 1) * 100 : null
      out.push({
        kind: 'self-tender', name: r.name, ticker: r.ticker, cik: r.cik, filed: r.date, stage: expiry && expiry < today() ? 'closed' : 'open', amendments: toi.filter(x => x.cik === r.cik).length - 1,
        type: t?.dutch ? 'Dutch auction' : fixed ? 'fixed price' : 'tender', size: t?.upTo || null, low: range?.[0] ?? null, high: top ?? null, expiry, daysToExpiry: expiry ? daysBetween(today(), expiry) : null,
        oddLot: !!t?.oddLot, debtFunded: !!t?.recap, preferred: !!t?.preferredOnly, price: q?.price ?? null, premium: r1(premium), parsed: !!t, url: r.index, state: r.state,
      })
    }
    for (const { r, t, needs } of divRead) {
      const amt = t ? num(t.amount || t.amount2) : null
      const q = needs ? await quote(r.ticker) : null
      out.push({
        kind: 'special dividend', name: r.name, ticker: r.ticker, cik: r.cik, filed: r.date, stage: t?.payable && toIso(t.payable) < today() ? 'paid' : 'declared', amendments: 0,
        type: 'special dividend', size: fin(amt) ? `$${amt}/sh` : null, low: null, high: fin(amt) ? amt : null, expiry: t?.payable ? toIso(t.payable) : null, daysToExpiry: null,
        oddLot: false, debtFunded: !!t?.recap, price: q?.price ?? null, premium: fin(amt) && q?.price ? r1((amt / q.price) * 100) : null, parsed: !!t, url: r.index, state: r.state,
      })
    }
    return out.sort((a, b) => b.filed.localeCompare(a.filed))
  }

  // ── insider buying (FMP Form 4 purchases, archived) ───────────────────────
  async function insider() {
    let rows = []
    for (const p of [0, 1]) { try { rows.push(...(await fmp(`insider-trading/search?transactionType=P-Purchase&page=${p}&limit=1000`) || [])) } catch (e) { console.warn('special insider:', e.message); break } }
    for (const x of rows) {
      if (!(x.price > 0) || !(x.securitiesTransacted > 0) || !x.symbol) continue
      const key = `${x.symbol}|${x.reportingCik}|${x.transactionDate}|${x.securitiesTransacted}|${x.price}`
      archive.insider[key] = { s: x.symbol, d: x.transactionDate, f: x.filingDate, n: x.reportingName, c: x.reportingCik, t: x.typeOfOwner || '', sh: x.securitiesTransacted, p: x.price, own: x.securitiesOwned ?? null }
    }
    const cutoff = ymd(Date.now() - 120 * DAY)
    for (const k of Object.keys(archive.insider)) if ((archive.insider[k].d || '') < cutoff) delete archive.insider[k]
    const d30 = ymd(Date.now() - 30 * DAY), d90 = ymd(Date.now() - 90 * DAY)
    const bySym = new Map()
    for (const x of Object.values(archive.insider)) {
      if (x.d < d90) continue
      const g = bySym.get(x.s) || { symbol: x.s, buys30: 0, buyers30: new Set(), dollars30: 0, shares30: 0, buys90: 0, buyers90: new Set(), dollars90: 0, shares90: 0, ceoCfo: false, tenPctOnly: true, last: x.d, names: new Map() }
      const usd = x.sh * x.p
      // "president" alone, not every vice president
      const exec = /chief executive|chief financial|\bceo\b|\bcfo\b/i.test(x.t) || (/president/i.test(x.t) && !/vice[ -]?president/i.test(x.t))
      if (exec) g.ceoCfo = true
      if (!/10 percent/i.test(x.t) || /director|officer/i.test(x.t)) g.tenPctOnly = false
      g.buys90++; g.buyers90.add(x.c); g.dollars90 += usd; g.shares90 += x.sh
      if (x.d >= d30) { g.buys30++; g.buyers30.add(x.c); g.dollars30 += usd; g.shares30 += x.sh }
      if (x.d > g.last) g.last = x.d
      const nm = g.names.get(x.c) || { name: x.n, title: x.t.replace(/,\s*$/, ''), usd: 0 }; nm.usd += usd; g.names.set(x.c, nm)
      bySym.set(x.s, g)
    }
    const list = [...bySym.values()].filter(g => g.dollars90 >= 25000).map(g => ({
      symbol: g.symbol, buys30: g.buys30, buyers30: g.buyers30.size, dollars30: Math.round(g.dollars30), avg30: g.shares30 ? r2(g.dollars30 / g.shares30) : null,
      buys90: g.buys90, buyers90: g.buyers90.size, dollars90: Math.round(g.dollars90), avg90: g.shares90 ? r2(g.dollars90 / g.shares90) : null,
      cluster: g.buyers30.size >= 3, ceoCfo: g.ceoCfo, tenPctOnly: g.tenPctOnly, last: g.last,
      top: [...g.names.values()].sort((a, b) => b.usd - a.usd).slice(0, 3).map(n => ({ name: n.name, title: n.title, usd: Math.round(n.usd) })),
    })).sort((a, b) => (b.cluster - a.cluster) || (b.dollars30 - a.dollars30) || (b.dollars90 - a.dollars90)).slice(0, 80)
    await prefetchQuotes(list.slice(0, 40).map(g => g.symbol))
    for (const g of list.slice(0, 40)) { const q = await quote(g.symbol); g.price = q?.price ?? null; g.since = fin(g.avg90) && q?.price ? r1((q.price / g.avg90 - 1) * 100) : null }
    return { list, archived: Object.keys(archive.insider).length, window: { d30, d90 } }
  }

  // ── activist 13Ds ─────────────────────────────────────────────────────────
  async function activist() {
    const hits = newest(await fts({ forms: 'SCHEDULE 13D', days: 60, pages: 3 }))
    const cands = hits.filter(r => r.parties[0]?.ticker && r.parties.slice(1).some(f => FUNDLIKE.test(f.name) && !similar(f.name, r.parties[0].name))).slice(0, 80)
    await prefetchDocs('13dx', cands, RX.d13, { xml: true })
    await prefetchQuotes(cands.map(r => r.parties[0].ticker))
    const out = []
    for (const r of hits) {
      const subject = r.parties[0], filers = r.parties.slice(1)
      if (!subject?.ticker) continue
      const funds = filers.filter(f => FUNDLIKE.test(f.name) && !similar(f.name, subject.name))
      if (!funds.length) continue
      const filer = { name: funds.map(f => f.name).join(' / ') }
      if (out.some(o => o.adsh === r.adsh || (o.cik === subject.cik && o.filer === filer.name))) continue
      const t = await terms('13dx', r, RX.d13, { xml: true })
      const twin = out.find(o => o.cik === subject.cik && o.filed === r.date && fin(o.pct) && t?.pct && Math.abs(o.pct - num(t.pct)) < 0.05)
      if (twin) { twin.filer = [...new Set([...twin.filer.split(' / '), ...filer.name.split(' / ')])].join(' / '); continue }
      const q = await quote(subject.ticker)
      out.push({
        name: subject.name, ticker: subject.ticker, cik: subject.cik, adsh: r.adsh, filer: filer.name, filed: r.date, pct: t?.pct ? num(t.pct) : null,
        purpose: t?.purpose ? String(t.purpose).slice(0, 320) : null, board: !!t?.board, strategic: !!t?.strategic,
        price: q?.price ?? null, changePct: fin(q?.changePct) ? r2(q.changePct * 100) : null, parsed: !!t, url: r.index, state: r.state,
      })
      if (out.length >= 60) break
    }
    // FMP fills the stake size where the filing did not parse
    let filled = 0
    for (const o of out) {
      if (fin(o.pct) || filled >= 20) continue
      try { const rows = await fmp(`acquisition-of-beneficial-ownership?symbol=${encodeURIComponent(o.ticker)}&limit=5`); const m = (rows || []).find(x => o.filer.split(' / ').some(f => similar(x.nameOfReportingPerson, f))); if (m && num(m.percentOfClass) != null) { o.pct = num(m.percentOfClass); o.pctSource = 'FMP' } filled++ } catch {}
    }
    return out
  }

  // ── SPACs ─────────────────────────────────────────────────────────────────
  async function spacs() {
    const [ipos, bcaAll, votes, exts, liqs] = await Promise.all([
      fts({ q: '"blank check company" "trust account"', forms: '424B4', days: 720, pages: 4 }).then(rows => newest(rows).filter(r => SPACISH.test(r.name))),
      fts({ q: '"business combination agreement"', forms: '8-K', days: 150, pages: 3 }).then(rows => newest(rows).filter(r => SPACISH.test(r.name))),
      proxiesAll().then(rows => rows.filter(r => SPAC.test(r.name))),
      fts({ q: '"extend the date by which"', forms: 'DEF 14A,DEFA14A', days: 120, pages: 1 }).then(newest),
      fts({ q: '"redeem all of its outstanding public shares"', forms: '8-K', days: 150, pages: 1 }).then(newest),
    ])
    const bcas = bcaAll.filter(r => r.items.includes('1.01') && !r.items.includes('2.01'))
    const completed = new Map(bcaAll.filter(r => r.items.includes('2.01')).map(r => [r.cik, r.date]))
    await Promise.all([prefetchDocs('spac', dedupeBy(ipos, r => r.cik), RX.spac), prefetchDocs('defm', dedupeBy(votes, r => r.cik), RX.merger)])
    const byAcq = new Map((await maList()).map(m => [+m.cik, m]))
    const bySpac = new Map()
    const get = r => { const g = bySpac.get(r.cik) || { name: r.name, ticker: r.ticker, tickers: r.parties[0]?.tickers || [], cik: r.cik, ipo: null, trust: null, months: null, units: null, warrant: null, stage: 'searching', target: null, targetTicker: null, ev: null, pipe: false, deal: null, vote: null, ext: null, liq: null, parsed: false, filings: [] }; if (!g.ticker && r.ticker) g.ticker = r.ticker; if (!g.tickers.length && r.parties[0]?.tickers?.length) g.tickers = r.parties[0].tickers; bySpac.set(r.cik, g); return g }
    for (const r of dedupeBy(ipos, r => r.cik)) {
      const g = get(r); g.ipo = r.date
      const t = await terms('spac', r, RX.spac)
      if (t) { g.parsed = true; g.trust = num(t.trust || t.trust2); g.months = num(t.months || t.months2); g.units = t.units ? num(t.units) : null; g.warrant = t.warrant || null }
      g.filings.push({ form: '424B4', date: r.date, url: r.index })
    }
    for (const r of dedupeBy(bcas, r => r.cik)) {
      const g = get(r)
      const t = await terms('bca', r, RX.bca, { post: (text, t) => {
        t.targets = [...text.matchAll(RX.bca.targetDef)].map(m => cleanName(m[1])).filter(Boolean).slice(0, 6)
        // "by and among SPAC Corp, Merger Sub Inc., a wholly owned subsidiary, and Target Ltd" — the target is the last real party
        const among = text.match(RX.bca.among)
        t.parties = among ? among[1].replace(/\([^)]*\)/g, '').split(/,\s*|\s+and\s+/).map(x => cleanName(x)).filter(x => x && x.length > 3 && !/merger sub|sponsor|representative|holder|subsidiary|each of|collectively|together/i.test(x)).slice(0, 8) : []
      } })
      const fm = byAcq.get(r.cik)
      const notSpac = n => n && !similar(n, r.name) && !SPAC.test(n)
      // FMP sometimes names the vehicle itself as the target, so every candidate goes through the same filter
      g.target = [fm?.targetedCompanyName, ...(t?.targets || []), ...[...(t?.parties || [])].reverse(), cleanName(t?.withName)].find(notSpac) || null
      g.targetTicker = fm?.targetedSymbol || null
      g.ev = t?.ev ? `$${t.ev[0]}${t.ev[1][0].toLowerCase() === 'b' ? 'B' : 'M'}` : null; g.pipe = !!t?.pipe
      g.deal = g.deal && g.deal < r.date ? g.deal : r.date; g.stage = 'deal announced'
      g.filings.push({ form: '8-K BCA', date: r.date, url: r.index })
    }
    for (const r of dedupeBy(votes, r => r.cik)) { const g = bySpac.get(r.cik); if (!g) continue; const t = await terms('defm', r, RX.merger); g.vote = (t && toIso(t.meeting)) || null; g.stage = 'vote'; g.filings.push({ form: 'DEFM14A', date: r.date, url: r.index }) }
    for (const r of dedupeBy(exts.filter(r => SPACISH.test(r.name)), r => r.cik)) { const g = get(r); g.ext = r.date; if (g.stage === 'searching') g.stage = 'extension vote'; g.filings.push({ form: r.form, date: r.date, url: r.index }) }
    for (const r of dedupeBy(liqs, r => r.cik)) { const g = bySpac.get(r.cik); if (!g) continue; g.liq = r.date; g.stage = 'liquidating'; g.filings.push({ form: '8-K', date: r.date, url: r.index }) }
    const stale = ymd(Date.now() - 45 * DAY)
    let done = 0
    for (const g of bySpac.values()) { if (completed.has(g.cik) || (g.vote && g.vote < stale)) { g.stage = 'completed'; done++ } }

    // deals and votes first, then the newest IPOs — quotes are the cost here
    const all = [...bySpac.values()].filter(g => g.ticker && g.stage !== 'completed').sort((a, b) => ((b.deal || b.vote) ? 1 : 0) - ((a.deal || a.vote) ? 1 : 0) || (b.ipo || '').localeCompare(a.ipo || ''))
    const out = []
    await prefetchQuotes(all.slice(0, 160).map(g => g.ticker))
    for (const g of all.slice(0, 160)) {
      const trustIpo = g.trust ?? 10, trustAssumed = g.trust == null
      const yrs = g.ipo ? Math.max(daysBetween(g.ipo, today()), 0) / 365 : 0
      const trustNow = trustIpo * Math.pow(1.04, yrs) // interest accretes; 4% a year assumed
      const months = g.months ?? 24, monthsAssumed = g.months == null
      const dl = g.ipo ? new Date(`${g.ipo}T00:00:00Z`) : null; if (dl) dl.setUTCMonth(dl.getUTCMonth() + months)
      const deadline = dl ? ymd(dl) : null
      const monthsLeft = deadline ? daysBetween(today(), deadline) / 30.4 : null
      const unit = g.tickers.find(t => /U$|-UN$/.test(t)) || null, wt = g.tickers.find(t => /W$|-WT$/.test(t)) || null
      let q = await quote(g.ticker), priceOf = 'common'
      if (!q && unit) { q = await quote(unit); priceOf = q ? 'unit' : 'common' }
      const price = q?.price ?? null
      const disc = fin(price) && price > 0 ? (1 - price / trustNow) * 100 : null
      const ytt = fin(disc) && fin(monthsLeft) && monthsLeft > 0.5 ? (trustNow / price - 1) * 100 * (12 / monthsLeft) : null
      const verify = fin(disc) && (disc > 15 || disc < -40) // trust is not $10, or this is no longer a SPAC
      const wq = wt && (g.deal || g.vote) ? await quote(wt) : null
      out.push({
        name: g.name, ticker: g.ticker, cik: g.cik, stage: g.stage, ipo: g.ipo, trustIpo, trustAssumed, trustNow: r2(trustNow), months, monthsAssumed, deadline, monthsLeft: r1(monthsLeft),
        price, priceOf, discount: r2(disc), yieldToTrust: r1(ytt), verify, target: g.target, targetTicker: g.targetTicker, ev: g.ev, pipe: g.pipe, deal: g.deal, vote: g.vote, ext: g.ext, liq: g.liq,
        units: g.units, warrant: g.warrant, warrantTicker: wt, warrantPrice: wq?.price ?? null, parsed: g.parsed,
        filings: g.filings.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), url: g.filings[0]?.url || null,
      })
    }
    out.completed = done
    return out.sort((a, b) => (a.verify ? 1 : 0) - (b.verify ? 1 : 0) || (fin(b.discount) ? 1 : 0) - (fin(a.discount) ? 1 : 0) || (b.discount ?? -99) - (a.discount ?? -99))
  }

  // ── buybacks ──────────────────────────────────────────────────────────────
  async function buybacks(insiderList) {
    const hits = newest(await fts({ q: '"share repurchase program" authorized', forms: '8-K', days: 60, pages: 3 }))
      .filter(r => r.ticker && r.items.some(i => /^(8\.01|7\.01|2\.02|1\.01)/.test(i)) && !SPAC.test(r.name) && !INTERVAL.test(r.name))
    const insiders = new Map((insiderList || []).map(i => [i.symbol, i]))
    const rows = dedupeBy(hits, r => r.cik)
    await prefetchDocs('bb', rows, RX.bb)
    const read = []
    for (const [i, r] of rows.entries()) { const t = await terms('bb', r, RX.bb); const usdM = t ? amtM(t.usd || t.usd2 || t.usd3) : null; const shares = t?.shares ? num(t.shares) : null; read.push({ r, t, usdM, shares, needs: usdM != null || shares != null || i < 40 }) }
    await Promise.all([
      prefetchQuotes(read.filter(x => x.needs).map(x => x.r.ticker)),
      pmap(read.filter(x => x.usdM != null || x.shares != null).map(x => x.r.ticker), 2, marketCap),
    ])
    const out = []
    for (const { r, t, usdM, shares, needs } of read) {
      const q = needs ? await quote(r.ticker) : null
      const mcap = usdM != null || shares != null ? await marketCap(r.ticker) : null
      const usd = usdM != null ? usdM * 1e6 : fin(shares) && q?.price ? shares * q.price : null
      const pctCap = fin(usd) && fin(mcap) && mcap > 0 ? usd / mcap * 100 : null
      const ins = insiders.get(r.ticker) || null
      out.push({
        name: r.name, ticker: r.ticker, cik: r.cik, filed: r.date, usd: fin(usd) ? Math.round(usd) : null, shares, statedPct: t?.pct ? num(t.pct) : null, pctCap: r1(pctCap), mcap: fin(mcap) ? mcap : null,
        expiry: (e => (e && e >= r.date ? e : null))(t ? toIso(t.expiry) : null), verify: fin(pctCap) && pctCap > 50, asr: !!t?.asr, additional: !!t?.additional, debtFunded: !!t?.debt, inEarnings: r.items.includes('2.02') && !r.items.includes('8.01'),
        price: q?.price ?? null, changePct: fin(q?.changePct) ? r2(q.changePct * 100) : null,
        insiders: ins ? { buyers30: ins.buyers30, dollars30: ins.dollars30, cluster: ins.cluster, ceoCfo: ins.ceoCfo } : null,
        parsed: !!t, url: r.index, state: r.state,
      })
    }
    // flagged sizes sort after the real ones, so the top of the board is the signal and not the parse errors
    return out.sort((a, b) => (a.verify ? 1 : 0) - (b.verify ? 1 : 0) || (fin(b.pctCap) ? 1 : 0) - (fin(a.pctCap) ? 1 : 0) || (b.pctCap ?? 0) - (a.pctCap ?? 0) || b.filed.localeCompare(a.filed))
  }

  // ── build ─────────────────────────────────────────────────────────────────
  async function build() {
    const t0 = Date.now()
    budget = { ...BUDGET }
    memo = {}; mcapBudget = 60
    for (const k of Object.keys(quotes)) delete quotes[k]
    yahooGap = 120
    const status = {}, timing = {}
    const run = async (name, fn, empty) => { const t1 = Date.now(); try { const v = await fn(); status[name] = 'ok'; return v } catch (e) { status[name] = e.message; console.warn(`special ${name}:`, e.message); return empty } finally { timing[name] = r1((Date.now() - t1) / 1000) } }
    const sp = await run('spinoffs', spinoffs, [])
    const mg = await run('mergers', mergers, [])
    const rg = await run('reorg', reorg, [])
    const rt = await run('rights', rights, [])
    const rc = await run('recaps', recaps, [])
    const ins = await run('insider', insider, { list: [], archived: 0 })
    const act = await run('activist', activist, [])
    const sq = await run('spacs', spacs, [])
    const bb = await run('buybacks', () => buybacks(ins.list), [])
    save(ARCHIVE, archive)

    const wk = ymd(Date.now() - 7 * DAY)
    const live = mg.filter(m => fin(m.gross) && m.gross > -5 && m.gross < 60)
    const securities = mg.filter(m => m.securities.cvr || m.securities.warrant || m.securities.preferred)
    const pipeline = {
      spinoffs: { n: sp.length, pending: sp.filter(s => s.stage !== 'distributed').length, next30: sp.filter(s => fin(s.daysToDist) && s.daysToDist >= 0 && s.daysToDist <= 30).length, recent: sp.filter(s => s.stage === 'distributed' && s.dist >= ymd(Date.now() - 90 * DAY)).length },
      mergers: { n: mg.length, live: live.length, medianGross: r1(median(live.map(m => m.gross))), medianAnn: r1(median(live.map(m => m.annualized))), securities: securities.length, tenders: mg.filter(m => m.stage === 'tender').length },
      reorg: { n: rg.length, emerged90: rg.filter(r => r.emerged && r.emerged >= ymd(Date.now() - 90 * DAY) && r.emerged <= today()).length, confirmed: rg.filter(r => r.stage === 'plan confirmed').length },
      rights: { n: rt.length, open: rt.filter(r => r.stage === 'open').length, backstopped: rt.filter(r => r.backstop).length },
      recaps: { n: rc.length, tenders: rc.filter(r => r.kind === 'self-tender' && r.stage === 'open').length, dutch: rc.filter(r => r.type === 'Dutch auction').length, dividends: rc.filter(r => r.kind === 'special dividend').length },
      insider: { clusters: ins.list.filter(i => i.cluster).length, symbols: ins.list.length, ceoCfo: ins.list.filter(i => i.ceoCfo).length, archived: ins.archived },
      activist: { n: act.length, n30: act.filter(a => a.filed >= ymd(Date.now() - 30 * DAY)).length, board: act.filter(a => a.board).length },
      spacs: { n: sq.length, searching: sq.filter(x => x.stage === 'searching' || x.stage === 'extension vote').length, belowTrust: sq.filter(x => fin(x.discount) && x.discount > 0 && !x.verify && (x.stage === 'searching' || x.stage === 'extension vote')).length, medianYield: r1(median(sq.filter(x => fin(x.discount) && x.discount > 0 && !x.verify && x.stage === 'searching').map(x => x.yieldToTrust))), deals: sq.filter(x => x.stage === 'deal announced' || x.stage === 'vote').length, liquidating: sq.filter(x => x.stage === 'liquidating').length, completed: sq.completed || 0 },
      buybacks: { n: bb.length, big: bb.filter(x => fin(x.pctCap) && x.pctCap >= 5 && !x.verify).length, withInsiders: bb.filter(x => x.insiders && x.insiders.buyers30 >= 2).length, asr: bb.filter(x => x.asr).length },
    }
    const newThisWeek = [
      ...sp.filter(s => s.latestFiled >= wk).map(s => ({ cat: 'spinoff', name: s.spinco || s.parent, ticker: s.ticker || s.parentTicker, date: s.latestFiled, note: s.stage })),
      ...mg.filter(m => m.announced >= wk).map(m => ({ cat: 'merger', name: m.target, ticker: m.ticker, date: m.announced, note: m.acquirer ? `← ${m.acquirer}` : m.stage })),
      ...rg.filter(r => (r.emerged || r.confirmed || '') >= wk).map(r => ({ cat: 'reorg', name: r.name, ticker: r.ticker, date: r.emerged || r.confirmed, note: r.stage })),
      ...rt.filter(r => r.filed >= wk).map(r => ({ cat: 'rights', name: r.name, ticker: r.ticker, date: r.filed, note: fin(r.subPrice) ? `$${r.subPrice} sub` : r.stage })),
      ...rc.filter(r => r.filed >= wk).map(r => ({ cat: 'recap', name: r.name, ticker: r.ticker, date: r.filed, note: r.type })),
      ...act.filter(a => a.filed >= wk).map(a => ({ cat: '13D', name: a.name, ticker: a.ticker, date: a.filed, note: a.filer })),
      ...sq.filter(x => x.deal && x.deal >= wk).map(x => ({ cat: 'spac', name: x.name, ticker: x.ticker, date: x.deal, note: x.target ? `→ ${x.target}` : 'deal' })),
      ...bb.filter(x => x.filed >= wk && fin(x.pctCap) && x.pctCap >= 3 && !x.verify).map(x => ({ cat: 'buyback', name: x.name, ticker: x.ticker, date: x.filed, note: `${x.pctCap}% of cap` })),
    ].sort((a, b) => b.date.localeCompare(a.date))

    return {
      ts: Date.now(), built: new Date().toISOString(), buildSecs: Math.round((Date.now() - t0) / 1000), ttlHours: TTL / H, status, timing,
      docsRead: Object.values(BUDGET).reduce((a, b) => a + b, 0) - Object.values(budget).reduce((a, b) => a + b, 0), quotesFetched: Object.keys(quotes).length,
      pipeline, newThisWeek, spinoffs: sp, mergers: mg, securities, reorg: rg, rights: rt, recaps: rc, insider: ins.list, insiderWindow: ins.window || null, activist: act, spacs: sq, buybacks: bb,
      docsCached: Object.keys(archive.docs).length,
      source: 'SEC EDGAR full-text search (Form 10-12B, SC TO-T, SC TO-I, DEFM14A, SCHEDULE 13D, 8-A12B, and 8-K phrase sweeps), with deal terms parsed from the primary document of each filing; FMP mergers-acquisitions, insider-trading (Form 4 open-market purchases) and beneficial-ownership endpoints; Yahoo Finance quotes; the bankruptcy tracker’s 8-K Item 1.03 list. SPAC trust values assume $10.00 a unit and a 24-month deadline until the prospectus is read, and accrete at an assumed 4% a year. Buyback sizes are set against FMP market cap. Every parsed field is a regex match on filing text and is labelled as such.',
    }
  }

  // The ranked ideas (server/specialScore.js) are scored on the way out rather
  // than stored, so freshness is measured from today even on a cached build.
  const scored = d => (d ? { ...d, ideas: scoreIdeas(d) } : d)
  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return scored(mem)
    if (!mem) { const disk = load(FILE); if (disk && Date.now() - disk.ts < TTL) { mem = disk; return scored(mem) } }
    if (inflight) return inflight.then(scored)
    inflight = (async () => {
      try { const d = await build(); mem = d; save(FILE, d); return d }
      catch (e) { console.warn('special situations build:', e.message); const disk = mem || load(FILE); if (disk) return disk; throw e }
      finally { inflight = null }
    })()
    return inflight.then(scored)
  }

  // ── the Deal Book: the user's own pins, notes, dates and checklists ───────
  const dealBook = {
    list() { return load(BOOK) || { entries: [] } },
    save(obj) {
      const entries = Array.isArray(obj?.entries) ? obj.entries.slice(0, 500) : []
      // ideas marked "not interested" on the Top ideas view, by idea id
      const dismissed = Array.isArray(obj?.dismissed) ? obj.dismissed.filter(x => typeof x === 'string').slice(-2000) : []
      const out = { ts: Date.now(), entries, dismissed }; save(BOOK, out); return out
    },
  }

  return { get, build, dealBook }
}
