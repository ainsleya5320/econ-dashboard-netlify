# Server data modules

Back to the [master map](../../CLAUDE.md).

## Projects
- [vite.config.js](../../vite.config.js): the whole back end: dev-server middleware for every /api route, inline feeds (FRED relay, S&P screener, fear & greed, AI usage, memory prices …), proxies for CBOE, FRED, OpenRouter, Zillow, CFTC, and the /api/chat assistant (Anthropic SDK)
- [server/](../../server): one module per feed, each `createX({ dir, keys })` with memory, disk and rebuild caching
- [server/usPulse.js](../../server/usPulse.js): U.S. Economy landing feed (~50 FRED series, leading indicators, consumer, debt)
- [server/intlPulse.js](../../server/intlPulse.js): International landing feed (13 economies, Big Mac index)
- [server/fxFundamentals.js](../../server/fxFundamentals.js): FX valuation, PPP and central-bank stance for 14 currencies
- [server/tradeFlows.js](../../server/tradeFlows.js): tariffs, pass-through and dollar invoicing (/api/trade-flows)
- [server/machine.js](../../server/machine.js): Dalio "economic machine" tracker from FRED
- [server/tightening.js](../../server/tightening.js): bond-market tightening monitor (FRED and Treasury FiscalData)
- [server/damodaranErp.js](../../server/damodaranErp.js): Damodaran monthly implied ERP workbook reader
- [server/commodityPulse.js](../../server/commodityPulse.js): 15 commodity contracts, real-price fair value, CFTC positioning
- [server/aiPulse.js](../../server/aiPulse.js): AI Economy landing feed: token tracker, Artificial Analysis, GPU rentals
- [server/gpuEconomics.js](../../server/gpuEconomics.js): GPU-hour cost vs revenue by generation (InferenceX)
- [server/tokenEstimates.js](../../server/tokenEstimates.js): bounding OpenAI and Anthropic token volume four ways
- [server/tokenSpot.js](../../server/tokenSpot.js): $/token derived from GPU rental prices
- [server/capexReturns.js](../../server/capexReturns.js): AI capex returns on capital from SEC XBRL
- [server/householdWealth.js](../../server/householdWealth.js): Distributional Financial Accounts wealth by percentile
- [server/ownerWealth.js](../../server/ownerWealth.js): IRS SOI state tables, the business-owner wealth question
- [server/realEstateFeeds.js](../../server/realEstateFeeds.js): Redfin, FRED pipeline, rents, build costs, CRE credit, Kastle
- [server/marketMap.js](../../server/marketMap.js): Real Estate → Market Map: states, metros and counties from Zillow and Realtor.com joined to the annual seed (/api/market-map)
- [server/marketMapSeed.js](../../server/marketMapSeed.js): builds that annual seed from Census (SAIPE, ACS, estimates, permits, CBSA) and Realtor.com's 2017–19 baseline
- [server/metroComparison.js](../../server/metroComparison.js): metro housing stock, permits and rents joined
- [server/metroEmployment.js](../../server/metroEmployment.js): BLS CES metro employment by industry
- [server/localMarketData.js](../../server/localMarketData.js): Census ACS and Zillow parsers for local markets
- [server/rentalConcessions.js](../../server/rentalConcessions.js): Zillow rent-report concession parser
- [server/municipalities.js](../../server/municipalities.js): one metro at a time: labor, housing, WARN notices
- [server/bankruptcy.js](../../server/bankruptcy.js): U.S. Courts F-2 tables, CM/ECF feeds, CourtListener, 8-K Item 1.03
- [server/specialSituations.js](../../server/specialSituations.js): spinoffs, mergers, tenders, insider buys from SEC EDGAR and FMP
- [server/specialScore.js](../../server/specialScore.js): 0-100 score for special-situation ideas
- [server/peopleScreener.js](../../server/peopleScreener.js): S&P 500 revenue and profit per employee (FMP)
- [server/optionsContext.js](../../server/optionsContext.js): earnings and dividend events for the options views
- [server/sfcModel.js](../../server/sfcModel.js): serves the SFC model JSON to the SFC Model tab

## State
- [.env.example](../../.env.example): key names; the real `.env` also takes ANTHROPIC_API_KEY, EIA_API_KEY, ARTIFICIAL_ANALYSIS_KEY
- [.env](../../.env): API keys, gitignored; every key is optional and its feed degrades without it
- [fred-cache.json](../../fred-cache.json): shared FRED observation cache (gitignored)
- [tickers.json](../../tickers.json): the saved watchlist behind /api/tickers (gitignored)
- [special-dealbook.json](../../special-dealbook.json): the personal Deal Book behind /api/special-dealbook (gitignored)
- Other feed caches (us-pulse.json, redfin.json, gpu-economics.json …) are gitignored; see [.gitignore](../../.gitignore)
- Tracked archives these modules append to: [data snapshots](data.md)

## Skills
- `npm run dev`: start the dev server, which is also the API server (port 5180 or `$PORT`)
- `curl localhost:5180/api/tickers`: cheap health check (reads a local file, no upstream calls)

## Memory
- The header comment of each server/ module documents its sources, scores and cache TTLs

## Routines
None on a schedule: each feed rebuilds on request once its TTL (2h to 30 days) expires.

## Not here
- The tabs that render these feeds: [front end](front-end.md)
- The tracked JSON archives: [data snapshots](data.md)
- The Python model that writes data/sfc/: [SFC model](sfc.md)
- The emailed special-situations digest: [scripts and automation](operations.md)
