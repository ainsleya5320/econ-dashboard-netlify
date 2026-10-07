# Data snapshots

Back to the [master map](../../CLAUDE.md).

## Projects
- [vite.config.js](../../vite.config.js): writes and reads most root archives (one `*_FILE` constant each)
- [server/](../../server): the feed modules that own the rest (named per file below)

## State
- [rankings-history.json](../../rankings-history.json): OpenRouter token rankings, daily archive (largest file, ~11 MB)
- [hf-rankings-history.json](../../hf-rankings-history.json): Hugging Face top models by downloads, daily archive
- [vercel-ai.json](../../vercel-ai.json): Vercel AI Gateway token and spend shares by model and lab
- [sdk-downloads.json](../../sdk-downloads.json): PyPI and npm AI SDK downloads, daily snapshots
- [usage-signals-history.json](../../usage-signals-history.json): Stack Overflow, GitHub stars, Cloudflare Radar AI signals, daily
- [usage-signals-so-monthly.json](../../usage-signals-so-monthly.json): Stack Overflow monthly tag counts backfill
- [ai-prices.json](../../ai-prices.json): token and GPU price snapshots (also read by server/gpuEconomics.js)
- [ai-pulse-archive.json](../../ai-pulse-archive.json): Artificial Analysis daily history (server/aiPulse.js)
- [gpu-rentals.json](../../gpu-rentals.json): GPU rental spot prices, daily (server/aiPulse.js)
- [ornn-data.json](../../ornn-data.json): Ornn GPU rental indices and per-lab token price index
- [semi-h100-index.json](../../semi-h100-index.json): SemiAnalysis 1-year contract GPU prices
- [memory-prices.json](../../memory-prices.json): TrendForce DRAM and NAND spot prices, append-only
- [hyperscaler-capex.json](../../hyperscaler-capex.json): quarterly hyperscaler capex from FMP
- [sp500-data.json](../../sp500-data.json): S&P 500 screener profiles and metrics (FMP)
- [sp500-people.json](../../sp500-people.json): per-company headcount, revenue and profit, the people screener (server/peopleScreener.js)
- [ms-fair-value.json](../../ms-fair-value.json): Morningstar market price-to-fair-value history
- [fs-markets.json](../../fs-markets.json): FutureSearch prediction-market positions and S&P valuations
- [debt-market-fmp.json](../../debt-market-fmp.json): annual FMP ratios for the ~30 large-cap debt basket
- [special-archive.json](../../special-archive.json): parsed merger and tender filings, Form 4 insider buys, caps (server/specialSituations.js)
- [bk-official.json](../../bk-official.json): U.S. Courts F-2 quarterly filings by district (server/bankruptcy.js)
- [bk-filings.json](../../bk-filings.json): daily CM/ECF petition counts and named Chapter 11 debtors (server/bankruptcy.js)
- [warn-ca.json](../../warn-ca.json): California WARN layoff notices (server/municipalities.js)
- [warn-tx.json](../../warn-tx.json): Texas WARN layoff notices (server/municipalities.js)
- [warn-wa.json](../../warn-wa.json): Washington WARN layoff notices (server/municipalities.js)
- [kastle.json](../../kastle.json): Kastle 10-city office occupancy, weekly, append-only (server/realEstateFeeds.js)
- [re-composite.json](../../re-composite.json): daily 0-100 real-estate fair-value composite, append-only (server/realEstateFeeds.js)
- [data/ai/](../../data/ai): hand-kept assumption tables: gpu-econ.json (GPU cost lines), token-estimates.json, token-spot.json (vendor specs)
- [data/fx/](../../data/fx): reference tables: cb-stance.json, imf-esr.json (FX fundamentals), invoicing.json (trade flows)
- [data/seeds/](../../data/seeds): committed inputs rebuilt by scripts/refresh-seeds.mjs: bls-employment-catalog.json and imf-datamapper.json (fallbacks for hosts that refuse Netlify) and market-map-annual.json (the Market Map's Census and baseline half)
- `data/ai/silicon-data-marks.json` is typed in by hand and gitignored (licence is internal-use only)

## Skills
- `npm run dev`: the main writer; each archive grows when its /api route is hit and the cache is stale

## Memory
- [.gitignore](../../.gitignore): says which files are tracked archives and which are re-derivable caches

## Routines
- The [special-situations digest](../../.github/workflows/special-digest.yml) restores and saves special-archive.json in the Actions cache; it never commits

## Not here
- The SFC outputs in data/sfc/: [SFC model](sfc.md)
- The code behind each file: [server data modules](server.md)
- Damodaran's annual series and the lab revenue log live in src/: [front end](front-end.md)
