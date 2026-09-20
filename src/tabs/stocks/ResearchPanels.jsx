import React, { useState, useEffect, useMemo } from "react";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { fetchFMP } from "../../lib/api.js";
import DAMODARAN from "../../lib/damodaran.json";

// ─── Shared bits ─────────────────────────────────────────────────────────────
const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8";
const fin = v => v != null && isFinite(v);
const pctOf = (arr, val) => {
  const a = arr.filter(fin);
  if (a.length < 5 || !fin(val)) return null;
  return Math.round((a.filter(v => v < val).length / a.length) * 100);
};
const median = arr => {
  const a = arr.filter(fin).sort((x, y) => x - y);
  if (!a.length) return null;
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const fmtCap = n => n == null ? "—" : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;

function PanelTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase" }}>{children}</div>
      {sub && <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );
}

// ─── 1. Valuation vs Own History — "is it cheap vs itself" ──────────────────
// History comes from the 20yr annual ratios/key-metrics already fetched for
// the detail view; only the current TTM values need 2 extra calls.
const BAND_METRICS = [
  { key: "pe",  label: "P/E",        hist: d => d.rat.map(r => r.priceToEarningsRatio), ttm: (r, k) => r?.priceToEarningsRatioTTM, lowCheap: true,  fmt: v => `${v.toFixed(1)}×`, cap: 300 },
  { key: "ev",  label: "EV/EBITDA",  hist: d => d.km.map(r => r.evToEBITDA),            ttm: (r, k) => k?.evToEBITDATTM,           lowCheap: true,  fmt: v => `${v.toFixed(1)}×`, cap: 200 },
  { key: "ps",  label: "P/S",        hist: d => d.rat.map(r => r.priceToSalesRatio),    ttm: (r, k) => r?.priceToSalesRatioTTM,    lowCheap: true,  fmt: v => `${v.toFixed(1)}×`, cap: 100 },
  { key: "fcf", label: "FCF Yield",  hist: d => d.km.map(r => r.freeCashFlowYield),     ttm: (r, k) => k?.freeCashFlowYieldTTM,    lowCheap: false, fmt: v => `${(v * 100).toFixed(1)}%`, cap: 1 },
];

export function ValuationBands({ data, fmpKey }) {
  const [ttm, setTtm] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchFMP(`/ratios-ttm?symbol=${data.symbol}`, fmpKey).catch(() => null),
      fetchFMP(`/key-metrics-ttm?symbol=${data.symbol}`, fmpKey).catch(() => null),
    ]).then(([r, k]) => { if (alive) setTtm({ r: r?.[0], k: k?.[0] }); });
    return () => { alive = false; };
  }, [data.symbol, fmpKey]);

  const rows = useMemo(() => {
    if (!ttm) return null;
    return BAND_METRICS.map(m => {
      const hist = m.hist(data).filter(v => fin(v) && v > (m.lowCheap ? 0 : -m.cap) && Math.abs(v) < m.cap);
      const cur = m.ttm(ttm.r, ttm.k);
      if (hist.length < 5 || !fin(cur)) return null;
      const pct = pctOf(hist, cur);
      // cheapness percentile: for multiples low=cheap; for yields high=cheap
      const cheapPct = m.lowCheap ? pct : (pct == null ? null : 100 - pct);
      return { ...m, hist, cur, pct, cheapPct, min: Math.min(...hist), max: Math.max(...hist), med: median(hist) };
    }).filter(Boolean);
  }, [ttm, data]);

  const overall = useMemo(() => {
    if (!rows?.length) return null;
    const cp = median(rows.map(r => r.cheapPct).filter(fin));
    if (cp == null) return null;
    return cp <= 30 ? { label: "Cheap vs Its Own History", color: GREEN, cp }
      : cp <= 70 ? { label: "Mid-Range vs Its Own History", color: AMBER, cp }
      : { label: "Rich vs Its Own History", color: RED, cp };
  }, [rows]);

  if (!rows) return <div style={{ padding: 14, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading valuation history…</div>;
  if (!rows.length) return null;

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 22px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <PanelTitle sub={`Today's multiple vs its own ${rows[0].hist.length}-year annual range — the "cheap vs itself" test. Marker = today; tick = its historical median.`}>
          Valuation vs Own History
        </PanelTitle>
        {overall && (
          <span style={{ fontSize: 12, fontWeight: 700, color: overall.color, fontFamily: fonts.heading }}>
            {overall.label} <span style={{ fontSize: 10, fontFamily: fonts.mono, color: "#64748b" }}>(cheapness pctile {overall.cp})</span>
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 13, marginTop: 8 }}>
        {rows.map(r => {
          const span = r.max - r.min || 1;
          const pos = Math.max(0, Math.min(100, ((r.cur - r.min) / span) * 100));
          const medPos = Math.max(0, Math.min(100, ((r.med - r.min) / span) * 100));
          const color = r.cheapPct == null ? "#94a3b8" : r.cheapPct <= 30 ? GREEN : r.cheapPct <= 70 ? AMBER : RED;
          return (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 78, fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, flexShrink: 0 }}>{r.label}</div>
              <div style={{ flex: 1, position: "relative", height: 18 }}>
                <div style={{ position: "absolute", top: 7, left: 0, right: 0, height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2 }} />
                <div title={`median ${r.fmt(r.med)}`} style={{ position: "absolute", top: 3, left: `${medPos}%`, width: 2, height: 12, background: "#64748b" }} />
                <div title={`today ${r.fmt(r.cur)}`} style={{ position: "absolute", top: 3, left: `calc(${pos}% - 6px)`, width: 12, height: 12, borderRadius: "50%", background: color, border: "2px solid #0f172a" }} />
              </div>
              <div style={{ width: 190, display: "flex", justifyContent: "space-between", gap: 8, flexShrink: 0, fontSize: 10.5, fontFamily: fonts.mono }}>
                <span style={{ color: "#475569" }}>{r.fmt(r.min)}–{r.fmt(r.max)}</span>
                <span style={{ color, fontWeight: 700 }}>{r.fmt(r.cur)} <span style={{ color: "#64748b", fontWeight: 400 }}>p{r.pct}</span></span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginTop: 10, lineHeight: 1.5 }}>
        Percentile = share of its own annual history below today&apos;s TTM value. For FCF yield, HIGH is cheap (percentile inverted in the verdict). A stock can be cheap vs itself and still expensive for a reason — pair with the Peers tab.
      </div>
    </div>
  );
}

// ─── 2. Peer comparison — "cheap for what it is, or cheap for a reason?" ────
export function PeerCompare({ symbol, fmpKey }) {
  const [state, setState] = useState({ loading: true, rows: null, error: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const peers = await fetchFMP(`/stock-peers?symbol=${symbol}`, fmpKey);
        const list = (Array.isArray(peers) ? peers : []).slice(0, 8);
        const all = [{ symbol, companyName: "(this company)", mktCap: null }, ...list];
        const ttm = await Promise.all(all.map(p =>
          fetchFMP(`/ratios-ttm?symbol=${p.symbol}`, fmpKey).then(r => r?.[0]).catch(() => null)
        ));
        if (!alive) return;
        const rows = all.map((p, i) => ({
          symbol: p.symbol,
          name: p.companyName,
          mktCap: p.mktCap ?? null,
          pe: ttm[i]?.priceToEarningsRatioTTM ?? null,
          ps: ttm[i]?.priceToSalesRatioTTM ?? null,
          margin: ttm[i]?.netProfitMarginTTM ?? null,
          gross: ttm[i]?.grossProfitMarginTTM ?? null,
          payout: ttm[i]?.dividendPayoutRatioTTM ?? null,
        }));
        setState({ loading: false, rows, error: null });
      } catch (e) {
        if (alive) setState({ loading: false, rows: null, error: e.message });
      }
    })();
    return () => { alive = false; };
  }, [symbol, fmpKey]);

  if (state.loading) return <div style={{ padding: 40, textAlign: "center", fontSize: 12, color: "#64748b", fontFamily: fonts.mono }}>Loading peer set + TTM ratios (~9 calls)…</div>;
  if (!state.rows?.length) return <div style={{ padding: 30, fontSize: 12, color: "#f87171", fontFamily: fonts.mono }}>Could not load peers{state.error ? ` — ${state.error}` : ""}.</div>;

  const subj = state.rows[0];
  const peersOnly = state.rows.slice(1).sort((a, b) => (b.mktCap || 0) - (a.mktCap || 0));
  const ordered = [subj, ...peersOnly];
  const medOf = k => median(peersOnly.map(r => r[k]));
  const meds = { pe: medOf("pe"), ps: medOf("ps"), margin: medOf("margin"), gross: medOf("gross") };
  const fmtX = v => v == null ? "—" : `${v.toFixed(1)}×`;
  const fmtP = v => v == null ? "—" : `${(v * 100).toFixed(1)}%`;

  const verdict = (() => {
    if (subj.pe == null || meds.pe == null) return null;
    const cheaper = subj.pe < meds.pe;
    const better = subj.margin != null && meds.margin != null && subj.margin > meds.margin;
    if (cheaper && better) return { t: "Cheaper than peers with better margins — screen-worthy.", c: GREEN };
    if (cheaper && !better) return { t: "Cheaper than peers, but margins lag — cheap for a reason?", c: AMBER };
    if (!cheaper && better) return { t: "Premium to peers, justified by superior margins — quality costs.", c: AMBER };
    return { t: "Premium multiple without a margin edge — the burden of proof is on the bull case.", c: RED };
  })();

  return (<>
    {verdict && (
      <div style={{ background: cardBg, border: cardBorder, borderLeft: `3px solid ${verdict.c}`, borderRadius: 12, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#cbd5e1", fontFamily: fonts.heading, fontWeight: 600 }}>
        {verdict.t}
      </div>
    )}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead><tr>
          {["Company", "Mkt Cap", "P/E (TTM)", "P/S (TTM)", "Gross Margin", "Net Margin"].map((h, i) => (
            <th key={h} style={{ padding: "9px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {ordered.map((r, i) => {
            const isSubj = i === 0;
            return (
              <tr key={r.symbol} style={{ background: isSubj ? "rgba(129,140,248,0.08)" : "transparent", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, fontWeight: isSubj ? 700 : 500, color: isSubj ? INDIGO : "#cbd5e1" }}>
                  {r.symbol}<span style={{ marginLeft: 8, fontSize: 10, color: "#64748b", fontFamily: fonts.heading, fontWeight: 400 }}>{r.name}</span>
                </td>
                <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{fmtCap(r.mktCap)}</td>
                {["pe", "ps"].map(k => (
                  <td key={k} style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", fontWeight: isSubj ? 700 : 400, color: r[k] == null ? "#475569" : isSubj && meds[k] != null ? (r[k] < meds[k] ? GREEN : RED) : "var(--text-primary)" }}>{fmtX(r[k])}</td>
                ))}
                {["gross", "margin"].map(k => (
                  <td key={k} style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", fontWeight: isSubj ? 700 : 400, color: r[k] == null ? "#475569" : isSubj && meds[k] != null ? (r[k] > meds[k] ? GREEN : RED) : "var(--text-primary)" }}>{fmtP(r[k])}</td>
                ))}
              </tr>
            );
          })}
          <tr style={{ borderTop: "2px solid rgba(255,255,255,0.08)" }}>
            <td style={{ padding: "8px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#64748b", fontStyle: "italic" }}>Peer median</td>
            <td />
            <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtX(meds.pe)}</td>
            <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtX(meds.ps)}</td>
            <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtP(meds.gross)}</td>
            <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtP(meds.margin)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, lineHeight: 1.5 }}>
      Peer set from FMP&apos;s stock-peers (same industry/size cohort). Subject row colored vs the peer median: green = better (cheaper multiple / higher margin). TTM values.
    </div>
  </>);
}

// ─── 3. Dividend safety — payout, FCF coverage, growth streak ────────────────
export function DividendSafety({ data, fmpKey }) {
  const [divs, setDivs] = useState(undefined); // undefined = loading, null = none

  useEffect(() => {
    let alive = true;
    fetchFMP(`/dividends?symbol=${data.symbol}&limit=60`, fmpKey)
      .then(d => { if (alive) setDivs(Array.isArray(d) && d.length ? d : null); })
      .catch(() => { if (alive) setDivs(null); });
    return () => { alive = false; };
  }, [data.symbol, fmpKey]);

  const calc = useMemo(() => {
    if (!divs) return null;
    // annual dividend-per-share from payment history
    const byYear = {};
    divs.forEach(r => { const y = (r.date || "").slice(0, 4); if (y) byYear[y] = (byYear[y] || 0) + (r.adjDividend || 0); });
    const years = Object.keys(byYear).sort();
    // growth streak over complete years (exclude current partial year)
    const nowY = String(new Date().getFullYear());
    const complete = years.filter(y => y < nowY);
    let streak = 0;
    for (let i = complete.length - 1; i > 0; i--) {
      if (byYear[complete[i]] > byYear[complete[i - 1]] + 1e-9) streak++;
      else break;
    }
    // payout + coverage from the annual statements already loaded
    const lastRat = data.rat?.[data.rat.length - 1];
    const lastCf = data.cf?.[data.cf.length - 1];
    const paid = Math.abs(lastCf?.commonDividendsPaid ?? lastCf?.netDividendsPaid ?? 0);
    const fcf = lastCf?.freeCashFlow ?? null;
    const coverage = paid > 0 && fin(fcf) ? fcf / paid : null;
    const payout = lastRat?.dividendPayoutRatio ?? null;
    const yieldPct = lastRat?.dividendYieldPercentage ?? (lastRat?.dividendYield != null ? lastRat.dividendYield * 100 : null);
    let verdict = { label: "Adequate", color: AMBER };
    if (payout != null && coverage != null) {
      if (payout < 0.6 && coverage > 1.5 && streak >= 5) verdict = { label: "Safe & Growing", color: GREEN };
      else if (payout > 0.8 || coverage < 1.1) verdict = { label: "Strained", color: RED };
    }
    return { streak, payout, coverage, yieldPct, verdict, lastDps: complete.length ? byYear[complete[complete.length - 1]] : null };
  }, [divs, data]);

  if (divs === undefined) return null;
  if (divs === null) return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 22px", marginBottom: 16, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>
      No dividend — {data.symbol} doesn&apos;t pay one.
    </div>
  );

  const c = calc;
  const cell = (label, val, color) => (
    <div>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || "var(--text-primary)", fontFamily: fonts.heading }}>{val}</div>
    </div>
  );

  return (
    <div style={{ background: cardBg, border: cardBorder, borderLeft: `3px solid ${c.verdict.color}`, borderRadius: 14, padding: "14px 22px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <PanelTitle>Dividend Safety</PanelTitle>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: c.verdict.color, fontFamily: fonts.heading }}>{c.verdict.label}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: "8px 20px" }}>
        {cell("Yield", c.yieldPct != null ? `${c.yieldPct.toFixed(2)}%` : "—")}
        {cell("Payout Ratio", c.payout != null ? `${(c.payout * 100).toFixed(0)}%` : "—", c.payout == null ? null : c.payout < 0.6 ? GREEN : c.payout < 0.8 ? AMBER : RED)}
        {cell("FCF Coverage", c.coverage != null ? `${c.coverage.toFixed(1)}×` : "—", c.coverage == null ? null : c.coverage > 1.5 ? GREEN : c.coverage > 1.1 ? AMBER : RED)}
        {cell("Growth Streak", `${c.streak} yr${c.streak === 1 ? "" : "s"}`, c.streak >= 5 ? GREEN : null)}
        {cell("DPS (last full yr)", c.lastDps != null ? `$${c.lastDps.toFixed(2)}` : "—")}
      </div>
      <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginTop: 10, lineHeight: 1.5 }}>
        Coverage = free cash flow ÷ dividends paid (last fiscal year). Streak = consecutive complete years of rising dividend per share. Safe = payout &lt;60%, coverage &gt;1.5×, streak ≥5yrs.
      </div>
    </div>
  );
}

// ─── 4. Earnings week-ahead for the watchlist ────────────────────────────────
export function EarningsWeekAhead({ tickers, fmpKey }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!fmpKey || !tickers?.length) return;
    let alive = true;
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    fetchFMP(`/earnings-calendar?from=${from}&to=${to}`, fmpKey)
      .then(d => {
        if (!alive) return;
        const mine = new Set(tickers);
        const hits = (Array.isArray(d) ? d : []).filter(r => mine.has(r.symbol))
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        // one row per symbol (earliest date)
        const seen = new Set();
        setRows(hits.filter(r => { if (seen.has(r.symbol)) return false; seen.add(r.symbol); return true; }));
      })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [tickers, fmpKey]);

  if (!rows) return null;
  if (!rows.length) return (
    <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginBottom: 14 }}>
      📅 No watchlist earnings in the next 10 days.
    </div>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 }}>
        📅 Watchlist Earnings — Next 10 Days
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {rows.map(r => (
          <div key={r.symbol} style={{ background: cardBg, border: cardBorder, borderLeft: `3px solid ${AMBER}`, borderRadius: 10, padding: "8px 14px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: INDIGO, fontFamily: fonts.mono }}>{r.symbol}</span>
            <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, marginLeft: 10 }}>{r.date}</span>
            {r.epsEstimated != null && <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, marginLeft: 10 }}>est. EPS ${Number(r.epsEstimated).toFixed(2)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Synthetic credit rating (Damodaran coverage→rating→spread) ──────────────
// Interest coverage mapped through Damodaran's ratings.xls bands: large
// non-financial table for mkt cap ≥ $5B, small/risky table below. Financial
// firms excluded (his non-financial tables don't apply to banks). Data comes
// entirely from the detail payload already fetched — zero extra API calls.
export function SyntheticRating({ data }) {
  const sector = data.prof?.sector || "";
  if (/financial/i.test(sector)) return null;
  const inc = data.inc?.[data.inc.length - 1];
  const rat = data.rat?.[data.rat.length - 1];
  let cov = rat?.interestCoverageRatio;
  if (!fin(cov) || cov === 0) {
    const ebit = inc?.operatingIncome, ie = inc?.interestExpense;
    cov = (fin(ebit) && fin(ie) && ie !== 0) ? ebit / Math.abs(ie) : null;
  }
  const mkt = data.quote?.marketCap ?? data.prof?.mktCap ?? 0;
  const sizeLarge = mkt >= 5e9;
  const table = (sizeLarge ? DAMODARAN.ratings?.large : DAMODARAN.ratings?.small) || [];
  const band = fin(cov) ? table.find(b => cov > b.min && cov <= b.max) : null;
  const rating = band ? (band.rating.split("/")[1] || band.rating) : null;
  const color = !rating ? "#64748b" : /^A/.test(rating) ? GREEN : /^BBB|^BB\+/.test(rating) ? AMBER : RED;

  return (
    <div style={{ background: cardBg, border: cardBorder, borderLeft: `3px solid ${color}`, borderRadius: 14, padding: "12px 22px", marginBottom: 16, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase" }}>Synthetic Credit Rating</div>
        <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: fonts.heading, lineHeight: 1.15 }}>{rating ?? "n/a"}</div>
      </div>
      <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.55, flex: 1, minWidth: 240 }}>
        {rating ? (<>
          Interest coverage <strong style={{ color: "#cbd5e1" }}>{cov.toFixed(1)}×</strong> → Damodaran&apos;s {sizeLarge ? "large" : "small"}-firm map → default spread <strong style={{ color: "#cbd5e1" }}>+{(band.spread * 100).toFixed(2)}pp</strong> over treasuries. A fundamentals-only rating — one ratio, so treat it as a floor check, not an agency opinion.
        </>) : (
          <>No disclosed interest expense in the latest fiscal year (common for cash-rich firms) — coverage, and therefore a synthetic rating, can&apos;t be computed.</>
        )}
      </div>
    </div>
  );
}

// ─── 5. PIE — Price-Implied Expectations (Rappaport & Mauboussin) ────────────
// "Expectations Investing" inverted DCF at the VALUE-DRIVER level. Instead of
// asking "what's it worth?", read the price: what revenue growth, operating
// margin, and — the signature metric — how many YEARS of value-creating
// performance (market-implied forecast period) does today's price demand?
// Key convention from the book: the terminal value assumes NO value creation
// (perpetuity of final NOPAT at WACC — new investments earn exactly the cost
// of capital). That makes the forecast horizon T economically meaningful:
// it is precisely the number of value-creating years the price pays for.

// Value operations under the Rappaport driver model → enterprise value
function pieEV(rev0, g, margin, tax, incInv, wacc, T) {
  if (!rev0 || wacc <= 0) return null;
  let ev = 0, rev = rev0, nopat = 0;
  for (let t = 1; t <= T; t++) {
    const revNext = rev * (1 + g);
    nopat = revNext * margin * (1 - tax);
    const fcf = nopat - incInv * (revNext - rev);
    ev += fcf / Math.pow(1 + wacc, t);
    rev = revNext;
  }
  ev += (nopat / wacc) / Math.pow(1 + wacc, T); // no-value-creation terminal
  return ev;
}

const bisect = (fn, lo, hi, iters = 80) => {
  let flo = fn(lo), fhi = fn(hi);
  if (flo == null || fhi == null || flo * fhi > 0) return null; // no sign change
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2, f = fn(mid);
    if (f == null) return null;
    if (flo * f <= 0) { hi = mid; fhi = f; } else { lo = mid; flo = f; }
  }
  return (lo + hi) / 2;
};

function PieSlider({ label, value, onChange, min, max, step, fmt }) {
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, fontFamily: fonts.mono, marginBottom: 3 }}>
        <span style={{ color: "#64748b" }}>{label}</span>
        <span style={{ color: "#a5b4fc", fontWeight: 700 }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ width: "100%", accentColor: "#818cf8" }} />
    </div>
  );
}

export function PIEPanel({ data }) {
  // ── Seed every driver from the company's own history ──
  const seed = useMemo(() => {
    const inc = data.inc || [], cf = data.cf || [], bs = data.bs || [];
    const last = inc[inc.length - 1];
    const rev0 = last?.revenue;
    if (!rev0 || rev0 <= 0 || inc.length < 6) return null;
    const cagr = (yrs) => {
      const past = inc[inc.length - 1 - yrs];
      return past?.revenue > 0 ? Math.pow(rev0 / past.revenue, 1 / yrs) - 1 : null;
    };
    const margins = inc.slice(-5).map(r => r.revenue > 0 ? r.operatingIncome / r.revenue : null).filter(fin);
    const marginCur = last.revenue > 0 ? last.operatingIncome / last.revenue : null;
    const margin5 = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null;
    const taxes = inc.slice(-3).map(r => r.incomeBeforeTax > 0 ? r.incomeTaxExpense / r.incomeBeforeTax : null).filter(fin);
    const tax = Math.min(0.35, Math.max(0.05, median(taxes) ?? 0.21));
    // incremental investment per $ of revenue growth: (capex − D&A) / ΔRev over ≤8yrs
    let capSum = 0, dRevSum = 0;
    for (let i = Math.max(1, cf.length - 8); i < cf.length; i++) {
      const dRev = (inc[i]?.revenue ?? 0) - (inc[i - 1]?.revenue ?? 0);
      if (dRev > 0) {
        capSum += Math.abs(cf[i]?.capitalExpenditure ?? 0) - (cf[i]?.depreciationAndAmortization ?? 0);
        dRevSum += dRev;
      }
    }
    const incInv = dRevSum > 0 ? Math.min(0.8, Math.max(0, capSum / dRevSum)) : 0.3;
    const lastBs = bs[bs.length - 1];
    const mktCap = (data.price && last?.weightedAverageShsOutDil) ? data.price * last.weightedAverageShsOutDil : (data.prof?.mktCap || 0);
    const ev = mktCap + (lastBs?.totalDebt ?? 0) - (lastBs?.cashAndShortTermInvestments ?? 0);
    if (!ev || ev <= 0 || margin5 == null) return null;
    return { rev0, ev, mktCap, marginCur, margin5, tax, incInv, cagr5: cagr(5), cagr10: inc.length > 10 ? cagr(10) : null };
  }, [data]);

  const [g, setG] = useState(null);        // base revenue growth
  const [m, setM] = useState(null);        // base operating margin
  const [wacc, setWacc] = useState(0.085);
  const [T, setT] = useState(10);
  useEffect(() => {
    if (seed && g == null) {
      setG(Math.min(0.35, Math.max(-0.05, seed.cagr5 ?? 0.06)));
      setM(Math.max(0.02, seed.margin5));
    }
  }, [seed, g]);

  const calc = useMemo(() => {
    if (!seed || g == null || m == null) return null;
    const { rev0, ev, tax, incInv } = seed;
    const evAt = (gg, mm, tt) => pieEV(rev0, gg, mm, tax, incInv, wacc, tt);
    // 1) implied growth at base margin & horizon
    const impliedG = bisect(gg => { const v = evAt(gg, m, T); return v == null ? null : v - ev; }, -0.30, 0.60);
    // 2) implied margin at base growth & horizon
    const impliedM = bisect(mm => { const v = evAt(g, mm, T); return v == null ? null : v - ev; }, 0.002, 0.70);
    // 3) market-implied forecast period at base growth & margin
    let mifp = null;
    const v1 = evAt(g, m, 1);
    if (v1 != null && v1 >= ev) mifp = 1;
    else {
      for (let t = 2; t <= 60; t++) {
        const v = evAt(g, m, t);
        if (v != null && v >= ev) { mifp = t; break; }
      }
    }
    // expectations frontier grid
    const gSteps = [-0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06].map(d => g + d);
    const mSteps = [-0.06, -0.03, 0, 0.03, 0.06].map(d => Math.max(0.01, m + d));
    const grid = gSteps.map(gg => mSteps.map(mm => {
      const v = evAt(gg, mm, T);
      return v != null ? v / ev : null;
    }));
    return { impliedG, impliedM, mifp, grid, gSteps, mSteps };
  }, [seed, g, m, wacc, T]);

  if (!seed) return null;
  if (g == null || m == null || !calc) return null;

  const fmtPc = v => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
  const cmp = (implied, delivered, invert = false) => {
    if (implied == null || delivered == null) return "#94a3b8";
    const gap = implied - delivered;
    const bad = invert ? gap < -0.02 : gap > 0.02;
    const good = invert ? gap > 0.02 : gap < -0.02;
    return bad ? RED : good ? GREEN : AMBER;
  };

  const headline = (label, val, sub, color) => (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color || INDIGO }} />
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{val}</div>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
    </div>
  );

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginBottom: 2 }}>
        PIE — Price-Implied Expectations
      </div>
      <div style={{ fontSize: 10.5, color: "#64748b", fontFamily: fonts.mono, marginBottom: 14, maxWidth: 840, lineHeight: 1.55 }}>
        Rappaport &amp; Mauboussin&apos;s <em>Expectations Investing</em>: don&apos;t forecast — read what the price already assumes, then judge whether those expectations are beatable. Terminal value assumes <strong style={{ color: "#94a3b8" }}>no value creation</strong> after the forecast period, so the horizon means something: it&apos;s the years of above-cost-of-capital performance you&apos;re paying for.
      </div>

      {/* Driver assumptions (seeded from this company's history) */}
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px", marginBottom: 12 }}>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
          Base-case drivers — seeded from {data.symbol}&apos;s own history · tax {fmtPc(seed.tax)} · incr. investment {fmtPc(seed.incInv)} of ΔRev · EV {fmtCap(seed.ev)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 16 }}>
          <PieSlider label="Revenue growth" value={g} onChange={setG} min={-0.10} max={0.40} step={0.005} fmt={fmtPc} />
          <PieSlider label="Operating margin" value={m} onChange={setM} min={0.01} max={0.60} step={0.005} fmt={fmtPc} />
          <PieSlider label="WACC" value={wacc} onChange={setWacc} min={0.06} max={0.12} step={0.0025} fmt={fmtPc} />
          <PieSlider label="Forecast horizon (yrs)" value={T} onChange={v => setT(Math.round(v))} min={5} max={20} step={1} fmt={v => `${v}y`} />
        </div>
      </div>

      {/* The three PIE reads */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))", gap: 10, marginBottom: 12 }}>
        {headline("Implied Revenue CAGR", fmtPc(calc.impliedG), `to justify EV over ${T}yrs at your ${fmtPc(m)} margin`, cmp(calc.impliedG, seed.cagr5))}
        {headline("Implied Op. Margin", fmtPc(calc.impliedM), `to justify EV at your ${fmtPc(g)} growth`, cmp(calc.impliedM, seed.margin5))}
        {headline("Implied Forecast Period", calc.mifp == null ? ">60 yrs" : `${calc.mifp} yrs`, "years of value-creating performance the price demands at your base case", calc.mifp == null ? RED : calc.mifp <= 5 ? GREEN : calc.mifp <= 15 ? AMBER : RED)}
      </div>

      {/* Implied vs delivered — the base-rate check */}
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
          <thead><tr>
            {["Driver", "Price Implies", "Delivered (5yr)", "Delivered (10yr)"].map((h, i) => (
              <th key={h} style={{ padding: "8px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.heading, color: "#cbd5e1", fontWeight: 600 }}>Revenue growth</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", fontWeight: 700, color: cmp(calc.impliedG, seed.cagr5) }}>{fmtPc(calc.impliedG)}</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtPc(seed.cagr5)}</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtPc(seed.cagr10)}</td>
            </tr>
            <tr>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.heading, color: "#cbd5e1", fontWeight: 600 }}>Operating margin</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", fontWeight: 700, color: cmp(calc.impliedM, seed.margin5) }}>{fmtPc(calc.impliedM)}</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtPc(seed.margin5)} avg</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", color: "#94a3b8" }}>{fmtPc(seed.marginCur)} current</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 9.5, color: "#475569", fontFamily: fonts.mono, padding: "6px 12px 10px", lineHeight: 1.5 }}>
          Green = the price implies LESS than the company has historically delivered (beatable bar). Red = implies more (heroic bar). The book&apos;s core move: buy when implied expectations sit clearly below demonstrated performance, sell when far above.
        </div>
      </div>

      {/* Expectations frontier */}
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 12 }}>
        <div style={{ padding: "12px 14px 0", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>
          Expectations Frontier — which growth × margin combos justify today&apos;s EV ({T}-yr horizon)
        </div>
        <table style={{ borderCollapse: "collapse", margin: "10px 14px 6px" }}>
          <thead><tr>
            <th style={{ padding: "4px 10px", fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>growth ↓ / margin →</th>
            {calc.mSteps.map((mm, i) => <th key={i} style={{ padding: "4px 10px", fontSize: 9.5, color: Math.abs(mm - m) < 0.001 ? "#a5b4fc" : "#64748b", fontFamily: fonts.mono, fontWeight: Math.abs(mm - m) < 0.001 ? 700 : 400 }}>{fmtPc(mm)}</th>)}
          </tr></thead>
          <tbody>
            {calc.gSteps.map((gg, ri) => (
              <tr key={ri}>
                <td style={{ padding: "4px 10px", fontSize: 9.5, color: Math.abs(gg - g) < 0.001 ? "#a5b4fc" : "#64748b", fontFamily: fonts.mono, fontWeight: Math.abs(gg - g) < 0.001 ? 700 : 400 }}>{fmtPc(gg)}</td>
                {calc.grid[ri].map((ratio, ci) => {
                  const bg = ratio == null ? "transparent" : ratio >= 1.15 ? "rgba(74,222,128,0.28)" : ratio >= 1 ? "rgba(74,222,128,0.14)" : ratio >= 0.85 ? "rgba(251,191,36,0.12)" : "rgba(248,113,113,0.12)";
                  return (
                    <td key={ci} style={{ padding: "4px 10px", fontSize: 10, fontFamily: fonts.mono, textAlign: "center", background: bg, color: ratio == null ? "#475569" : ratio >= 1 ? "#4ade80" : ratio >= 0.85 ? "#fbbf24" : "#f87171", borderRadius: 4 }}>
                      {ratio == null ? "—" : ratio.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 9.5, color: "#475569", fontFamily: fonts.mono, padding: "0 14px 10px", lineHeight: 1.5 }}>
          Cell = model EV ÷ market EV. Green cells (≥1.00) are performance combos that pay for the stock; if only the top-right corner is green, you need everything to go right. Rows/columns step ±2pts growth, ±3pts margin around your base case (indigo).
        </div>
      </div>

      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, lineHeight: 1.6, background: "rgba(129,140,248,0.05)", borderLeft: "2px solid #818cf8", borderRadius: 4, padding: "10px 14px" }}>
        <strong style={{ color: "#cbd5e1" }}>Model notes.</strong> Rappaport driver model: FCF = NOPAT − incremental investment × ΔRevenue; drivers seeded from {data.symbol}&apos;s filings (5-yr averages), all overridable above. Simplifications: single-stage growth, incremental investment rate held constant, EV = mkt cap + total debt − cash. The FCF-based Reverse DCF above answers &ldquo;what growth is priced in?&rdquo; in one number; PIE decomposes it into <em>which driver</em> carries the burden — disagreements between you and the price are only actionable when you know where they live (the book&apos;s &ldquo;turbo trigger&rdquo; is almost always sales).
      </div>
    </div>
  );
}
