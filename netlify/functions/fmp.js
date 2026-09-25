// ============================================================================
// FMP KEY PROXY — the one thing that cannot be baked.
//
// Quotes, options chains and ticker search are per-symbol and interactive, so
// there is no finite set of responses to pre-render. The alternative to this
// function is compiling the paid FMP key into the client bundle, where anyone
// who opens devtools on the deployed site can read it.
//
// FMP answers in well under a second, so this stays far inside the function
// timeout. Set FMP_KEY in the Netlify UI — note the absence of a VITE_ prefix,
// which is what keeps it server-side.
// ============================================================================
const UPSTREAM = 'https://financialmodelingprep.com/stable'
// Only the endpoints this app actually uses. An open forwarder would let anyone
// spend the account's quota on whatever they liked.
const ALLOWED = new Set([
  'quote', 'profile', 'search-symbol', 'search-name', 'treasury-rates',
  'economic-indicators', 'options-chain', 'historical-price-eod',
  'company-screener', 'news-general-latest', 'news-stock-latest',
  'ratios-ttm', 'key-metrics-ttm', 'income-statement', 'balance-sheet-statement',
  'cash-flow-statement', 'enterprise-values', 'analyst-estimates',
  'price-target-consensus', 'stock-peers', 'market-capitalization',
  // the stock page's research sheet: annual ratios and key metrics (ROIC,
  // ROE), and the analyst ratings summary
  'ratios', 'key-metrics', 'grades-consensus',
])

export default async (req) => {
  const key = process.env.FMP_KEY
  if (!key) return json({ error: 'FMP_KEY is not set on this deploy' }, 500)

  const url = new URL(req.url)
  // /api/fmp/historical-price-eod/full?symbol=AAPL -> path "historical-price-eod/full",
  // allowlisted on its first segment. The whole path is forwarded: keeping only
  // the first segment turned ".../full" into a different endpoint and broke
  // five-year price history on the deployed site.
  const sub = url.pathname.replace(/^.*\/fmp\/?/, '')
  const endpoint = sub.split('/')[0]
  if (!endpoint) return json({ error: 'no endpoint given' }, 400)
  if (!ALLOWED.has(endpoint)) return json({ error: `endpoint not allowed: ${endpoint}` }, 403)
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(sub)) return json({ error: 'bad path' }, 400)

  const qs = new URLSearchParams(url.search)
  qs.delete('apikey')          // never honour a caller-supplied key
  qs.set('apikey', key)

  try {
    const r = await fetch(`${UPSTREAM}/${sub}?${qs}`, {
      headers: { 'User-Agent': 'econ-dashboard (netlify)' },
      signal: AbortSignal.timeout(8000),
    })
    const body = await r.text()
    return new Response(body, {
      status: r.status,
      headers: {
        'Content-Type': 'application/json',
        // quotes move; a short edge cache blunts repeat loads without going stale
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    })
  } catch (e) {
    return json({ error: `upstream: ${e.message}` }, 502)
  }
}

const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

export const config = { path: '/api/fmp/*' }
