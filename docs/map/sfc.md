# SFC model

Back to the [master map](../../CLAUDE.md).

## Projects
- [run_sfc.py](../../run_sfc.py): CLI: build the ledger from FRED, run the model, write JSON (`--out`, `--cache`, `--no-crux`)
- [sfc/export.py](../../sfc/export.py): `export_all()` writes the three JSON files
- [sfc/ledger.py](../../sfc/ledger.py): Layer 1: quarterly ledger of debt stocks, Godley sectoral balances, BIS credit gap
- [sfc/model.py](../../sfc/model.py): Layers 2-4: agents, capacity, the dark-output wedge; `simulate`, `calibrate`, `scenarios`, `crux_scan`
- [sfc/series.py](../../sfc/series.py): catalogue of the ~50 FRED series, tagged by layer, with units
- [sfc/fred.py](../../sfc/fred.py): cached FRED fetcher, keyless CSV or keyed API
- [server/sfcModel.js](../../server/sfcModel.js): reads the JSON, derives the board and scores for the SFC Model tab
- [src/tabs/SfcModelTab.jsx](../../src/tabs/SfcModelTab.jsx): the tab that shows it

## State
- [data/sfc/](../../data/sfc): tracked output: sfc_history.json, sfc_scenarios.json, sfc_crux.json, preview.png
- [data/cache/](../../data/cache): FRED download cache (gitignored, re-derivable)

## Skills
- `pip install pandas numpy requests`: the Python dependencies
- `python run_sfc.py`: rebuild everything into data/sfc/
- `python run_sfc.py --no-crux`: skip the slower rate-hike sign scan

## Memory
- [sfc/README.md](../../sfc/README.md): the four layers, JSON contract, ledger conventions and findings

## Routines
None. Run by hand; the dashboard picks up new files by mtime.

## Not here
- Other FRED-driven macro feeds (U.S. pulse, machine, tightening): [server data modules](server.md)
- The rest of the tracked JSON: [data snapshots](data.md)
