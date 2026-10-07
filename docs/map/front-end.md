# Front end

Back to the [master map](../../CLAUDE.md).

## Projects
- [index.html](../../index.html): the page shell Vite serves at /
- [src/main.jsx](../../src/main.jsx): React entry point
- [src/App.jsx](../../src/App.jsx): the shell: tab groups (Today, Valuation, Income, Macro, Themes), data loading, data-health status
- [src/tabs/](../../src/tabs): one component per tab and sub-tab (Overview cockpit, Rates, CPI, U.S. Economy, SFC Model, Tightening …)
- [src/tabs/stocks/](../../src/tabs/stocks): S&P 500 screener, people screener, research sheet, debt & cash (with optimal debt), technicals, valuation (cost of capital, industry yardstick, story valuation), value book, special situations
- [src/tabs/options/](../../src/tabs/options): options income, expectations, volatility history, watchlist ladder
- [src/tabs/realEstate/](../../src/tabs/realEstate): market map (states, metros, counties), market profile, metro comparison, rental pricing, refinancing
- [src/tabs/ai/](../../src/tabs/ai): capex returns, GPU economics, token estimates, token spot
- [src/tabs/intl/](../../src/tabs/intl): FX, trade flows, global imbalances, liquidity, World Bank, international pulse
- [src/tabs/consumer/](../../src/tabs/consumer): household wealth and owner wealth panels
- [src/components/](../../src/components): shared widgets: chat drawer, data-health panel, fear & greed gauge, choropleth, ticker search
- [src/lib/](../../src/lib): client logic: api.js (FRED/FMP fetches), constants, fallback data, options/property/rental/stock analysis, technicals, styles, Damodaran cost of capital (costOfCapital.js) and the FMP → Damodaran industry map (industryMap.js)
- [src/lib/assistantContext.js](../../src/lib/assistantContext.js): turns the dashboard's verdicts into text for the chat assistant
- [src/theme.css](../../src/theme.css): global theme

## State
- [src/lib/damodaran.json](../../src/lib/damodaran.json): Damodaran annual implied ERP (1960 on) and rating spreads, built by the refresh script
- [src/lib/damodaranIndustries.json](../../src/lib/damodaranIndustries.json): his U.S. industry averages (betas, costs of capital, margins, returns, multiples, working capital), built by the same script
- [src/data/labRevenueTracker.json](../../src/data/labRevenueTracker.json): hand-curated AI lab revenue and deployed-GW observations (append by hand)
- [src/lib/fallbackData.js](../../src/lib/fallbackData.js): baked-in series shown when FRED is unreachable
- [src/lib/forecasts.js](../../src/lib/forecasts.js): curated FutureSearch forecast snapshots
- `/api/tickers` persists the watchlist to the gitignored `tickers.json` at the root

## Skills
- `npm run dev`: Vite dev server on port 5180 (or `$PORT`), all interfaces
- `npm run build`: production bundle into `dist/`
- `npm run preview`: serve the built bundle

## Memory
- [README.md](../../README.md): quick start and what each tab shows (partly out of date: the port is now 5180)

## Routines
None. The browser pulls from the /api routes on load; see [server data modules](server.md) for cache TTLs.

## Not here
- The /api routes and the code that fetches FRED, FMP, BLS, BEA and the rest: [server data modules](server.md)
- The JSON archives those routes read and append: [data snapshots](data.md)
- The SFC simulation behind the SFC Model tab: [SFC model](sfc.md)
- Unit tests for src/lib analysis code: [scripts and automation](operations.md)
