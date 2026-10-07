# Economic Dashboard: the map

This file holds no facts. It says where things live: one line per area, and each area file
points at the real code, state and docs, so anything is two hops from here. Area files have
the same six sections: **Projects** (code that does the work), **State** (files it reads and
writes; the feed caches, `.env`, `tickers.json` and `state/` are gitignored), **Skills**
(commands to run), **Memory** (docs), **Routines** (what runs on a schedule), **Not here**
(what people look for here but lives elsewhere). The map check fails if any line goes stale.

## Areas

- [Front end](docs/map/front-end.md): the Vite + React app, its tabs, components and client-side analysis
- [Server data modules](docs/map/server.md): vite.config.js and server/, the /api feeds behind every tab
- [Data snapshots](docs/map/data.md): the tracked JSON archives at the root and the reference tables in data/
- [SFC model](docs/map/sfc.md): the Python stock-flow-consistent ledger and simulation, and its JSON output
- [Scripts and automation](docs/map/operations.md): refresh scripts, the special-situations digest job, tests, setup

## Rules for working here

- Update the signpost in the same change that adds, moves or renames a file.
- Every fact has one home. Link to it; don't copy it.
- API keys live in `.env` (see `.env.example`); never commit them.
- Tracked archives (the root JSON snapshots) are append-only history; caches are re-derivable and gitignored.
- Run the map check before pushing: `node ../orbit/bin/map-check.js .`
