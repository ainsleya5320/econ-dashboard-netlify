import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { fetchStockDetail } from "../../lib/stockDetail.js";
import StockResearchSheet from "./StockResearchSheet.jsx";

// ============================================================================
// VALUE BOOK — Stocks → 📖 Value book. Flip through the white research sheets
// one company at a time, the way you would leaf through Value Line.
//   the books   S&P 500 in a value order (Greenblatt's magic formula, FCF
//               yield, earnings yield, EV/EBITDA, dividend yield, return on
//               capital, or A–Z; optionally one sector), the watchlist, the
//               Special Situations top ideas, and Keepers — pages you marked.
//   turning     ← → keys, the arrows, or a swipe on a phone. K keeps a page,
//               O opens the full stock page. The next two pages and the one
//               behind load in the background, so a turn is usually instant.
//   memory      the book, order and page are remembered on this browser;
//               loaded sheets are kept for the session (the last 40).
// A sheet costs 11 FMP calls (the analyst endpoints are skipped), so the
// read-ahead stops at two pages to stay inside the plan's rate limit.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", SLATE = "#94a3b8", DIM = "#475569", INDIGO = "#818cf8";
const fin = v => v != null && isFinite(v);
const pct = v => (fin(v) ? `${(v * 100).toFixed(1)}%` : "—");
const mult = v => (fin(v) ? `${v.toFixed(1)}×` : "—");
const LS_PREFS = "flipbook:prefs", LS_KEEP = "flipbook:keepers", LS_POS = "flipbook:pos:";
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

// loaded sheets, shared across visits in this session: symbol → { p, data }
const cache = new Map();
function loadSheet(symbol, key) {
  const hit = cache.get(symbol);
  if (hit) { cache.delete(symbol); cache.set(symbol, hit); return hit.p; }
  const e = {};
  e.p = fetchStockDetail(symbol, key, { lite: true }).then(d => { e.data = d; return d; }, err => { cache.delete(symbol); throw err; });
  cache.set(symbol, e);
  while (cache.size > 40) cache.delete(cache.keys().next().value);
  return e.p;
}

const BOOKS = [["sp500", "S&P 500"], ["watch", "Watchlist"], ["ideas", "Special situations"], ["keep", "Keepers"]];
const SORTS = [
  { id: "magic", label: "Magic formula (Greenblatt)" },
  { id: "fcf", label: "Free-cash-flow yield", short: "FCF yield", key: "fcfYield", dir: -1, fmt: pct },
  { id: "ey", label: "Earnings yield", short: "earnings yield", key: "earningsYield", dir: -1, fmt: pct },
  { id: "ev", label: "EV / EBITDA, lowest first", short: "EV/EBITDA", key: "evEbitda", dir: 1, positive: true, fmt: mult },
  { id: "div", label: "Dividend yield", short: "dividend yield", key: "divYield", dir: -1, fmt: pct },
  { id: "roic", label: "Return on capital", short: "ROIC", key: "roic", dir: -1, fmt: pct },
  { id: "alpha", label: "A to Z" },
];
const IDEA_CAT = { spinoff: "Spin-off", merger: "Merger arb", reorg: "Post-reorg", rights: "Rights", recap: "Recap", insider: "Insider buying", "13D": "13D", spac: "SPAC", buyback: "Buyback" };

const entry = (x, line) => ({ symbol: x.symbol, name: x.name, sector: x.sector, line });
function sp500Entries(rows, sort, sector) {
  const r = rows.filter(x => x.symbol && (!sector || x.sector === sector));
  if (sort === "alpha") return [...r].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(x => entry(x, [x.sector, x.industry].filter(Boolean).join(" · ")));
  if (sort === "magic") {
    // Greenblatt ranks cheapness (EBIT/EV) and return on capital separately and
    // adds the ranks, leaving out financials and utilities. EV/EBITDA stands in
    // for EV/EBIT here — it is what the screener carries.
    const pool = r.filter(x => !/financial|utilit/i.test(x.sector || "") && fin(x.evEbitda) && x.evEbitda > 0 && fin(x.roic));
    const rank = f => new Map([...pool].sort((a, b) => f(b) - f(a)).map((x, i) => [x.symbol, i + 1]));
    const cheap = rank(x => 1 / x.evEbitda), good = rank(x => x.roic);
    return pool.map(x => ({ x, s: cheap.get(x.symbol) + good.get(x.symbol) })).sort((a, b) => a.s - b.s)
      .map(({ x }) => entry(x, `EV/EBITDA ${mult(x.evEbitda)} · ROIC ${pct(x.roic)}`));
  }
  const S = SORTS.find(s => s.id === sort) || SORTS[1];
  return r.filter(x => fin(x[S.key]) && (!S.positive || x[S.key] > 0))
    .sort((a, b) => S.dir * (a[S.key] - b[S.key]))
    .map(x => entry(x, `${S.short} ${S.fmt(x[S.key])}`));
}

export default function FlipBook({ fmpKey, tickers = [], onOpen }) {
  const prefs0 = useMemo(() => lsGet(LS_PREFS, {}), []);
  const [book, setBook] = useState(prefs0.book || "sp500");
  const [sort, setSort] = useState(prefs0.sort || "magic");
  const [sector, setSector] = useState(prefs0.sector || "");
  const [universe, setUniverse] = useState(null);
  const [ideas, setIdeas] = useState(null);
  const [keepers, setKeepers] = useState(() => lsGet(LS_KEEP, []));
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [sheet, setSheet] = useState({ symbol: null, data: null, err: null });
  const [nonce, setNonce] = useState(0);
  const [ready, setReady] = useState(0);
  const [jump, setJump] = useState("");
  const topRef = useRef(null);
  const touch = useRef(null);
  const posKey = book === "sp500" ? `${book}:${sort}:${sector}` : book;

  useEffect(() => { lsSet(LS_PREFS, { book, sort, sector }); }, [book, sort, sector]);
  useEffect(() => {
    fetch("/api/sp500-screener").then(r => r.json()).then(j => setUniverse(j.stocks || [])).catch(() => setUniverse([]));
  }, []);
  useEffect(() => {
    if (book !== "ideas" || ideas) return;
    fetch("/api/special-situations").then(r => r.json()).then(j => setIdeas(j.ideas || [])).catch(() => setIdeas([]));
  }, [book, ideas]);

  const bySym = useMemo(() => new Map((universe || []).map(r => [r.symbol, r])), [universe]);
  const sectors = useMemo(() => [...new Set((universe || []).map(r => r.sector).filter(Boolean))].sort(), [universe]);
  const entries = useMemo(() => {
    if (book === "sp500") return universe ? sp500Entries(universe, sort, sector) : [];
    if (book === "watch") return tickers.map(t => { const x = bySym.get(t); return { symbol: t, name: x?.name || t, sector: x?.sector, line: x ? `${x.sector || ""}${fin(x.fcfYield) ? ` · FCF yield ${pct(x.fcfYield)}` : ""}` : "watchlist" }; });
    if (book === "ideas") return (ideas || []).filter(i => i.ticker && i.score >= 45 && /^[A-Z][A-Z0-9.\-]{0,14}$/.test(i.ticker))
      .map(i => ({ symbol: i.ticker, name: i.name, line: `${IDEA_CAT[i.cat] || i.cat} · ${i.grade} ${i.score} — ${i.headline}` }));
    return keepers.map(k => ({ symbol: k.symbol, name: k.name || k.symbol, line: `kept ${k.at}` }));
  }, [book, sort, sector, universe, ideas, keepers, tickers, bySym]);

  // come back to the page you left, per book and order — but not while the
  // list is still loading, or the empty book would overwrite the saved page
  const restored = useRef(null);
  useEffect(() => {
    if (!entries.length) return;
    const saved = lsGet(LS_POS + posKey, 0);
    setIdx(Math.min(Math.max(0, saved), entries.length - 1));
    restored.current = posKey;
  }, [posKey, entries.length]);
  useEffect(() => { if (entries.length && restored.current === posKey) lsSet(LS_POS + posKey, idx); }, [posKey, idx, entries.length]);

  const cur = entries[idx] || null;
  const kept = cur ? keepers.some(k => k.symbol === cur.symbol) : false;

  // the page, then read ahead: two forward, one back, one at a time
  useEffect(() => {
    if (!cur) return;
    let alive = true;
    const hit = cache.get(cur.symbol);
    setSheet({ symbol: cur.symbol, data: hit?.data || null, err: null });
    loadSheet(cur.symbol, fmpKey)
      .then(d => { if (alive) setSheet({ symbol: cur.symbol, data: d, err: null }); },
        e => { if (alive) setSheet({ symbol: cur.symbol, data: null, err: String(e?.message || e) }); })
      .then(async () => {
        for (const k of [idx + 1, idx + 2, idx - 1]) {
          if (!alive) return;
          const e2 = entries[k];
          if (!e2) continue;
          try { await loadSheet(e2.symbol, fmpKey); if (alive) setReady(n => n + 1); } catch { /* shown when reached */ }
        }
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.symbol, fmpKey, nonce]);

  // a turned page starts at its top
  useEffect(() => {
    const el = topRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }, [idx]);

  const go = useCallback(delta => {
    setDir(delta >= 0 ? 1 : -1);
    setIdx(i => Math.min(Math.max(0, i + delta), Math.max(0, entries.length - 1)));
  }, [entries.length]);
  const goTo = useCallback(i => {
    setDir(i >= idx ? 1 : -1);
    setIdx(Math.min(Math.max(0, i), Math.max(0, entries.length - 1)));
  }, [idx, entries.length]);
  const toggleKeep = useCallback(() => {
    if (!cur) return;
    const next = keepers.some(k => k.symbol === cur.symbol)
      ? keepers.filter(k => k.symbol !== cur.symbol)
      : [{ symbol: cur.symbol, name: cur.name, at: new Date().toISOString().slice(0, 10) }, ...keepers];
    setKeepers(next); lsSet(LS_KEEP, next);
  }, [cur, keepers]);

  useEffect(() => {
    const onKey = e => {
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "k" || e.key === "K") toggleKeep();
      else if ((e.key === "o" || e.key === "O") && cur) onOpen?.(cur.symbol);
      else if (e.key === "Home") { e.preventDefault(); goTo(0); }
      else if (e.key === "End") { e.preventDefault(); goTo(entries.length - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goTo, toggleKeep, cur, onOpen, entries.length]);

  const doJump = () => {
    const q = jump.trim().toUpperCase();
    if (!q) return;
    const n = parseInt(q, 10);
    const i = /^\d+$/.test(q) ? n - 1 : entries.findIndex(e => e.symbol === q);
    if (i >= 0 && i < entries.length) { goTo(i); setJump(""); }
  };

  const onTouchStart = e => { const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY }; };
  const onTouchEnd = e => {
    const s = touch.current; touch.current = null;
    if (!s) return;
    const p = e.changedTouches[0], dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 45) go(dx < 0 ? 1 : -1);
  };

  const btn = (on, onClick, children, color = INDIGO, title) => (
    <button onClick={onClick} title={title} style={{
      padding: "5px 11px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: fonts.mono,
      border: `1px solid ${on ? color : "rgba(255,255,255,0.12)"}`, background: on ? `${color}22` : "transparent", color: on ? color : SLATE,
    }}>{children}</button>
  );
  const nextReady = [idx + 1, idx + 2].map(k => entries[k]).filter(Boolean).map(e => ({ s: e.symbol, ok: !!cache.get(e.symbol)?.data }));
  const sortLabel = book === "sp500" ? SORTS.find(s => s.id === sort)?.label : BOOKS.find(b => b[0] === book)?.[1];
  const loadingList = (book === "sp500" && !universe) || (book === "ideas" && !ideas);

  return (<div ref={topRef}>
    <style>{`
      @keyframes fb-in-r { from { opacity: 0; transform: translateX(30px) } to { opacity: 1; transform: none } }
      @keyframes fb-in-l { from { opacity: 0; transform: translateX(-30px) } to { opacity: 1; transform: none } }
      .fb-page { animation: .2s ease-out both; }
      .fb-in-r { animation-name: fb-in-r; } .fb-in-l { animation-name: fb-in-l; }
      @media (prefers-reduced-motion: reduce) { .fb-page { animation: none; } }
    `}</style>

    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {BOOKS.map(([id, label]) => <React.Fragment key={id}>{btn(book === id, () => setBook(id), id === "keep" ? `${label} · ${keepers.length}` : label, GREEN)}</React.Fragment>)}
        {book === "sp500" && (<>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ marginLeft: 6, background: "transparent", color: "var(--text-primary)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 7, padding: "5px 8px", fontSize: 11, fontFamily: fonts.mono }}>
            {SORTS.map(s => <option key={s.id} value={s.id} style={{ color: "#0f172a" }}>{s.label}</option>)}
          </select>
          <select value={sector} onChange={e => setSector(e.target.value)} style={{ background: "transparent", color: "var(--text-primary)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 7, padding: "5px 8px", fontSize: 11, fontFamily: fonts.mono }}>
            <option value="" style={{ color: "#0f172a" }}>All sectors</option>
            {sectors.map(s => <option key={s} value={s} style={{ color: "#0f172a" }}>{s}</option>)}
          </select>
        </>)}
        <span style={{ marginLeft: "auto", fontSize: 10, color: DIM, fontFamily: fonts.mono }}>← → turn · K keep · O open · Home / End</span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        {btn(false, () => go(-1), "◀", INDIGO, "Previous page (←)")}
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.mono, minWidth: 90, textAlign: "center" }}>
          {entries.length ? `${idx + 1} / ${entries.length}` : "—"}
        </span>
        {btn(false, () => go(1), "▶", INDIGO, "Next page (→)")}
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.mono, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {cur ? <>{cur.symbol} <span style={{ fontWeight: 400, color: SLATE }}>{cur.name}</span></> : loadingList ? "Opening the book…" : "This book is empty"}
          </div>
          <div style={{ fontSize: 10, color: DIM, fontFamily: fonts.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {cur ? `#${idx + 1} by ${sortLabel}${sector && book === "sp500" ? `, ${sector}` : ""} · ${cur.line}` : ""}
          </div>
        </div>
        {btn(kept, toggleKeep, kept ? "★ kept" : "☆ keep", AMBER, "Keep this page (K)")}
        {btn(false, () => cur && onOpen?.(cur.symbol), "open full page ↗", INDIGO, "Open the full stock page (O)")}
        <input value={jump} onChange={e => setJump(e.target.value)} onKeyDown={e => { if (e.key === "Enter") doJump(); }} placeholder="page # or ticker"
          style={{ width: 120, background: "transparent", color: "var(--text-primary)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 7, padding: "5px 8px", fontSize: 11, fontFamily: fonts.mono }} />
      </div>
      {nextReady.length > 0 && (
        <div style={{ fontSize: 9.5, color: DIM, fontFamily: fonts.mono, marginTop: 6 }} data-ready={ready}>
          next: {nextReady.map(n => <span key={n.s} style={{ color: n.ok ? GREEN : DIM, marginRight: 8 }}>{n.s} {n.ok ? "✓" : "…"}</span>)}
          {book === "sp500" && sort === "magic" && <span style={{ marginLeft: 6 }}>· magic formula ranks cheapness (EV/EBITDA) plus return on capital, financials and utilities left out</span>}
        </div>
      )}
      {book === "keep" && !keepers.length && <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 8 }}>Nothing kept yet. Press K on any page to keep it here.</div>}
      {book === "watch" && !tickers.length && <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 8 }}>The watchlist is empty — add tickers on the Watchlist view.</div>}
    </div>

    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ perspective: 1200 }}>
      {cur && (
        <div key={cur.symbol} className={`fb-page ${dir >= 0 ? "fb-in-r" : "fb-in-l"}`}>
          {sheet.symbol === cur.symbol && sheet.data ? (
            <StockResearchSheet data={sheet.data} />
          ) : (
            <article className="stock-sheet" aria-busy={!sheet.err}>
              <header className="sheet-masthead">
                <div className="sheet-identity">
                  <div className="sheet-kicker">{cur.symbol}{cur.sector ? ` / ${cur.sector}` : ""}</div>
                  <h1>{cur.name}</h1>
                  <p>{cur.line}</p>
                </div>
              </header>
              {sheet.err && sheet.symbol === cur.symbol ? (
                <p className="sheet-note">
                  This sheet did not load ({sheet.err}). FMP may be rate-limiting a fast run of pages — wait a moment and{" "}
                  <button onClick={() => setNonce(n => n + 1)} style={{ border: "1px solid var(--sheet-rule)", background: "white", color: "var(--sheet-blue)", padding: "3px 8px", cursor: "pointer" }}>retry</button>, or turn the page.
                </p>
              ) : <p className="sheet-note">Loading the sheet — eleven filings-based datasets from FMP.</p>}
            </article>
          )}
        </div>
      )}
    </div>
  </div>);
}
