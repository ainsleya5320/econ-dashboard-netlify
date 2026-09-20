# econ-dashboard — Netlify build

A fork of [econ-dashboard](https://github.com/ainsleya5320/econ-dashboard) that deploys as a static site.

The upstream app is not a static site. It runs a Vite dev server whose
`configureServer` hook answers about sixty `/api/*` routes from ~5,700 lines of
feed code in `server/`. `vite build` throws all of that away, so uploading the
upstream repo to Netlify produces a shell where every panel renders its error
state. This fork closes that gap.

---

## How it works

**The data is baked at build time, not served at request time.**

`scripts/bake.mjs` starts the real dev server, asks it for every route, writes
the answers into `public/api/*.json`, and shuts it down. Vite then copies
`public/` into `dist/`, and Netlify serves the JSON from its CDN.

Two reasons it works this way rather than as serverless functions:

1. **Several feeds take minutes to build cold.** Special Situations crawls EDGAR
   full-text search (~64s), the FX fundamentals feed rebuilds from IMF and BIS
   data (~154s cold), and Capex Returns walks the SEC XBRL company-concept API.
   Netlify's synchronous functions cap at 10s on the free tier and 26s on Pro.
   Every one of those would time out on a cold start.
2. **The data does not move faster than the build.** Almost every feed already
   carries a 4-hour-to-7-day TTL. A twice-daily rebuild is comfortably ahead of
   all of them.

Baking also means **no API key is ever compiled into the browser bundle**, which
the upstream app does (`VITE_FRED_KEY` and `VITE_FMP_KEY` in `App.jsx`). That is
harmless on localhost and would publish a paid credential on a public URL.

```
npm run build:netlify
  ├─ check:routes   fail if src/ requests a path nothing bakes
  ├─ bake           start vite → fetch every endpoint → public/api/*.json
  └─ vite build     bundle the SPA, copy public/ into dist/
```

### FRED

The client calls `/api/fred?series_id=X&limit=N` hundreds of times, so it cannot
be a single file. The bake writes one file per series and a `_redirects` rule
maps the query string onto it, leaving the client's URLs unchanged:

```
/api/fred  series_id=:sid  /api/fred/:sid.json  200
```

`fred-cache.json` **is committed to this fork** — unlike upstream, where it is
ignored. It is the set of series the running app has actually requested (~1,200),
which is a far better list than a regex over `src/` produces. Each build asks the
relay for every one of them, so its TTL logic refreshes whatever has gone stale
and leaves the rest alone.

When you add a panel that uses new FRED series: run it locally once so the cache
picks them up, then commit the updated `fred-cache.json`.

### FMP

The one thing that cannot be baked. Quotes, options chains and ticker search are
per-symbol and interactive — there is no finite set of responses to pre-render.
`netlify/functions/fmp.js` forwards those calls with the key held server-side,
against an allowlist of the endpoints this app uses. It responds in well under a
second, so the function timeout is not a concern.

### What is switched off

| | Why | What happens instead |
|---|---|---|
| Chat drawer | needs a live Anthropic key | explains itself when you send |
| Deal Book pins | nothing to POST to | saved in `localStorage` |

Both are gated on flags in `src/lib/deploy.js` rather than deleted, so panels
added upstream merge in unchanged.

---

## Deploying

1. Push this repo to GitHub and connect it to Netlify. `netlify.toml` already
   sets the build command, publish directory and Node version.

2. Set environment variables in **Site settings → Environment variables**:

   | Variable | Needed for |
   |---|---|
   | `FRED_KEY` | the bake step |
   | `FMP_KEY` | the bake step **and** the FMP function |
   | `BLS_KEY` | CPI category detail |
   | `BEA_KEY` | PCE |
   | `EIA_API_KEY` | energy |
   | `ARTIFICIAL_ANALYSIS_KEY` | AI model pricing |

   None carry a `VITE_` prefix, which is what keeps them out of the bundle.
   `ANTHROPIC_API_KEY` is deliberately not needed — chat is off here.

3. Raise the build timeout if needed. A cold build runs several minutes, mostly
   waiting on upstream sources; Netlify's default cap is 15 minutes.

4. Create a build hook (**Build & deploy → Build hooks**) and add the URL as the
   `NETLIFY_BUILD_HOOK` repository secret. `.github/workflows/refresh.yml` then
   redeploys at 06:00 and 18:00 Pacific to refresh the data.

## Running locally

Identical to upstream — `npm run dev` on port 5180, with `.env` in the project
root. The dev server also answers `/api/fmp/*`, so the proxy path behaves the
same locally as it does deployed.

To check what the deployed site will actually look like:

```bash
npm run build:netlify
npm run preview
```

## Keeping up with upstream

This fork changes five client files and adds the build plumbing. Everything else
is untouched, so upstream work merges cleanly:

```bash
git remote add upstream https://github.com/ainsleya5320/econ-dashboard.git
git fetch upstream && git merge upstream/master
```

Changed here: `src/lib/constants.js` (FMP base), `src/lib/api.js` (FRED limit
applied client-side), `src/App.jsx` (no bundled keys),
`src/components/ChatDrawer.jsx` and `src/tabs/stocks/SpecialSituations.jsx`
(both gated on `deploy.js`), plus a dev-only `/api/fmp` route in
`vite.config.js`. Added: `scripts/`, `netlify.toml`, `public/_redirects`,
`netlify/functions/`, `src/lib/deploy.js`.

## Reading a build

`public/api/_bake.json` records what happened: which routes baked, which kept a
previous copy because the source was down, and which are missing outright. A
route that fails but has a previous file ships that file rather than a hole. If
more than a quarter of routes go missing, the build fails instead of deploying a
mostly-broken site.
