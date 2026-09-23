// ============================================================================
// ROUTE MANIFEST — every /api path the client asks for, and the parameter
// values it asks for them with.
//
// Kept as data rather than scraped, because a missed route is a panel that
// renders its error state on the deployed site with nothing in the build log to
// say so. `npm run check:routes` diffs this list against the paths actually
// referenced in src/, and fails the build if they have drifted apart.
// ============================================================================

import { METROS } from '../server/realEstateFeeds.js'
import { CITIES } from '../server/municipalities.js'

// Routes that take no parameters: one request, one file.
export const PLAIN = [
  'ai-impact', 'ai-prices', 'ai-pulse', 'bank-credit', 'bankruptcy', 'bea-pce',
  'bls-cpi', 'capex-returns', 'cb-rates', 'commodity-pulse', 'commodity-spot',
  'consumer-health', 'cre-credit', 'cre-fundamentals', 'damodaran-erp',
  'dashboard-summary', 'debt-market', 'erp', 'fear-greed', 'fs-markets',
  'fx-fundamentals', 'global-liquidity', 'gpu-economics', 'hf-rankings',
  'household-wealth', 'housing-health', 'hyperscaler-capex', 'index-pe',
  'intl-pulse', 'kalecki', 'machine', 'macro-dashboard', 'memory',
  'metal-history', 'ms-fair-value', 'municipality-status',
  'or-rankings-history', 'ornn', 'owner-wealth', 'people-screener',
  're-buildcost', 're-composite', 're-metro-comparison', 're-pipeline',
  're-rents', 'redfin', 'reit-caprates', 'replacement-cost', 'semi-h100',
  'sfc', 'sp500-screener', 'special-dealbook', 'special-situations',
  'tickers', 'tightening', 'token-estimates', 'trade-flows', 'token-spot', 'us-pulse', 'usage-signals',
]

// Routes with a small, enumerable parameter set: one file per value, written to
// <route>/<value>.json. The client asks for that path directly rather than
// relying on a _redirects query-string rule, which cannot be tested locally.
// The Options tab defaults to SPY and remembers whatever symbol you last used.
// Arbitrary symbols cannot be pre-rendered, so bake the liquid ones people
// actually trade options on; for anything else the client already falls back to
// an "unavailable" state rather than breaking.
export const OPTION_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']

export const ENUMERATED = [
  { route: 'municipality', param: 'city', values: CITIES.map(c => c.id) },
  { route: 'options-context', param: 'symbol', values: OPTION_SYMBOLS },
  { route: 're-metro', param: 'code', values: METROS.map(m => m.code) },
  { route: 're-metro-employment', param: 'code', values: METROS.map(m => m.code) },
]

// Routes that cannot be baked, and what the fork does with each instead.
export const EXCLUDED = {
  chat: 'needs a live Anthropic key — the drawer is disabled in this build',
  fred: 'parameterised over ~1,200 series — baked per series from fred-cache.json',
  'fred-cache': 'internal dev diagnostic, not called by the client',
  'aa-check': 'internal dev diagnostic, not called by the client',
}

// Every path the bake step will produce, for the coverage check.
export function expectedPaths() {
  const out = PLAIN.map(r => `/api/${r}`)
  for (const e of ENUMERATED) out.push(`/api/${e.route}`)
  out.push('/api/fred')
  return out.sort()
}
