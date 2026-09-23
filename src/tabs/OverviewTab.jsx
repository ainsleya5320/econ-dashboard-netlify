import React, { useEffect, useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, YAxis, AreaChart, Area, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { InfoBox } from "../components/shared.jsx";
import FearGreedGauge from "../components/FearGreedGauge.jsx";
import { fetchOptionsChain, fetchFMP } from "../lib/api.js";
import DAMODARAN from "../lib/damodaran.json";
import { EarningsWeekAhead } from "./stocks/ResearchPanels.jsx";
import { chainModel, chainHeadline } from "./AIEconomyTab.jsx";
import { ValuationLensesCard, useDamodaranMonthly, damPct, damColor } from "../components/MarketFairValue.jsx";

// ============================================================================
// COCKPIT — "terminal" layout (2026-09 revamp, option A)
// Market on the left, my book on the right:
//   LEFT   Today hero (SPY + regime + every asset on one bar scale) → a KPI
//          band (ERP · Damodaran · earnings yield by index · yield curve ·
//          real yield) →
//          rates strip → Fear & Greed meter → implied move → commodities,
//          with the full charts folded away at the bottom.
//   RIGHT  a sticky rail: the watchlist (shared with Stocks & Options), its
//          earnings in the next 10 days, and a Theme Pulse of the verdicts
//          computed on the other tabs — each row links to its owner.
// ============================================================================

const fmtPct = (v, dp = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`);
const TONE_COLOR = { success: "#10b981", neutral: "#818cf8", warning: "#f59e0b", danger: "#ef4444" };
const GREEN = "#4ade80", RED = "#f87171", INDIGO = "#818cf8", AMBER = "#fbbf24";
const cardStyle = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const cardTitle = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const linkStyle = { fontSize: 10, color: INDIGO, fontFamily: fonts.mono, cursor: "pointer", background: "none", border: "none", padding: 0 };
// Mirrors StocksTab: the watchlist is shared via this localStorage key.
const DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "BRK-B", "JPM", "V"];
function loadTickers() {
  try { const s = localStorage.getItem("econ-dash-tickers"); return s ? JSON.parse(s) : DEFAULT_TICKERS; } catch { return DEFAULT_TICKERS; }
}

// ── Sparklines ──────────────────────────────────────────────────────────────
function Sparkline({ data, color = "#10b981", height = 24, width = "100%" }) {
  if (!data || data.length < 2) return <div style={{ height, width }} />;
  const series = data.map((v, i) => ({ i, v }));
  const ys = data.filter(v => v != null);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.08 || 0.5;
  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <YAxis hide domain={[minY - pad, maxY + pad]} />
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function HeroSparkArea({ data, color = "#10b981", height = 40 }) {
  if (!data || data.length < 2) return <div style={{ height }} />;
  const series = data.map((v, i) => ({ i, v }));
  const ys = data.filter(v => v != null);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.08 || 0.5;
  const id = `g-${color.replace("#", "")}-${height}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[minY - pad, maxY + pad]} />
        <Area type="monotone" dataKey="v" stroke={color} fill={`url(#${id})`} strokeWidth={1.6} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Regime: derived from cross-asset moves (equities × VIX × gold × crypto) ──
export function computeRegime(indexes, commodities, crypto) {
  const by = s => indexes.find(i => i.symbol === s);
  const spy = by("SPY"), qqq = by("QQQ"), iwm = by("IWM"), dia = by("DIA");
  const vix = indexes.find(i => /VIX/.test(i.symbol || ""));
  const gold = commodities.find(c => c.symbol === "GC=F");
  const oil = commodities.find(c => c.symbol === "CL=F");
  const btc = crypto.find(c => c.symbol === "BTC");
  if (!spy) return null;
  const eqs = [spy, qqq, iwm, dia].filter(Boolean);
  const eqAvg = eqs.reduce((s, i) => s + (i.changePct || 0), 0) / (eqs.length || 1) * 100;
  const vixChg = (vix?.changePct ?? 0) * 100;
  const upCount = eqs.filter(i => (i.changePct || 0) > 0).length;
  const sorted = [...eqs].sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
  const leader = sorted[0], laggard = sorted[sorted.length - 1];

  let regime, color, note;
  if (eqAvg <= -0.8 && vixChg > 5) { regime = "Risk-Off"; color = RED; note = `broad selloff (${upCount}/${eqs.length} up) with a vol bid`; }
  else if (eqAvg >= 0.8 && vixChg < 0) { regime = "Risk-On"; color = GREEN; note = `broad advance (${upCount}/${eqs.length} up), vol offered`; }
  else if (Math.abs(eqAvg) < 0.25) { regime = "Quiet Tape"; color = INDIGO; note = "indexes little changed"; }
  else { regime = "Mixed Tape"; color = AMBER; note = `${leader.symbol} leads, ${laggard.symbol} lags — rotation, not direction`; }
  if (eqAvg < -0.5 && (gold?.changePct ?? 0) > 0.3) note += " · safe-haven bid in gold";
  if (eqAvg < -0.5 && (btc?.changePct ?? -1) > 0.5) note += " · crypto shrugging it off";

  const spyChg = (spy.changePct || 0) * 100;
  const rows = [
    qqq && { label: "Nasdaq (QQQ)", chg: qqq.changePct * 100 },
    iwm && { label: "Russell (IWM)", chg: iwm.changePct * 100 },
    dia && { label: "Dow (DIA)", chg: dia.changePct * 100 },
    vix && { label: `VIX ${vix.price?.toFixed(1)}`, chg: vixChg, invert: true },
    gold && { label: "Gold", chg: gold.changePct * 100 },
    oil && { label: "Oil (WTI)", chg: oil.changePct * 100 },
    btc && { label: "Bitcoin", chg: btc.changePct * 100 },
  ].filter(Boolean);
  const maxAbs = Math.max(1, Math.abs(spyChg), ...rows.map(r => Math.abs(r.chg)));
  return { regime, color, note, spy, spyChg, vixChg, upCount, n: eqs.length, rows, maxAbs };
}

// One diverging bar on a shared scale — length is the size of the move.
function BarRow({ label, chg, invert, maxAbs }) {
  const up = chg >= 0;
  const good = invert ? !up : up;
  const c = good ? GREEN : RED;
  const w = Math.min(50, (Math.abs(chg) / maxAbs) * 50);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 96, fontSize: 10.5, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, position: "relative", height: 14 }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.14)" }} />
        <div style={{ position: "absolute", top: 2, bottom: 2, borderRadius: 3, background: c, opacity: 0.85, left: up ? "50%" : `${50 - w}%`, width: `${w}%` }} />
      </div>
      <span style={{ width: 58, fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, color: c, flexShrink: 0, textAlign: "right" }}>{fmtPct(chg)}</span>
    </div>
  );
}

// ── TODAY hero — SPY anchors the day, the chip names the regime, every other
// asset's move is a diverging bar on one shared scale ────────────────────────
function TodayHero({ regime }) {
  if (!regime) return null;
  const spyColor = regime.spyChg >= 0 ? GREEN : RED;
  return (
    <div style={{ ...cardStyle, padding: "16px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: regime.color }} />
      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "stretch" }}>
        <div style={{ flex: "1 1 240px", minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ ...cardTitle, letterSpacing: 0.8 }}>Today — S&amp;P 500</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: regime.color, background: `${regime.color}1e`, padding: "2px 9px", borderRadius: 6, fontFamily: fonts.mono }}>{regime.regime}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 4 }}>
            <span style={{ fontSize: 36, fontWeight: 700, color: spyColor, fontFamily: fonts.heading, letterSpacing: -1.5, lineHeight: 1 }}>{fmtPct(regime.spyChg)}</span>
            <span style={{ fontSize: 13, color: "var(--text-secondary)", fontFamily: fonts.mono }}>${regime.spy.price?.toFixed(2)}</span>
          </div>
          <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>{regime.note}</div>
          <div style={{ height: 32, marginTop: 8 }}><HeroSparkArea data={regime.spy.spark} color={spyColor} height={32} /></div>
          <div style={{ fontSize: 8.5, color: "#475569", fontFamily: fonts.mono, textAlign: "right" }}>trailing month</div>
        </div>
        <div style={{ flex: "1 1 300px", minWidth: 280, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
          {regime.rows.map(r => <BarRow key={r.label} label={r.label} chg={r.chg} invert={r.invert} maxAbs={regime.maxAbs} />)}
          <div style={{ fontSize: 8.5, color: "#475569", fontFamily: fonts.mono, textAlign: "center", marginTop: 3 }}>
            bars share one scale — length is the size of the move · VIX colored inverted (up = stress)
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Compact rate card (rates strip) ─────────────────────────────────────────
function RateRow({ rate }) {
  const val = rate.value;
  const c = rate.change == null ? INDIGO : rate.change >= 0 ? "#10b981" : RED;
  return (
    <div style={{ ...cardStyle, borderRadius: 12, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...cardTitle, fontSize: 9 }}>{rate.name}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, lineHeight: 1.15 }}>
          {val != null ? (rate.unit === "bp" ? `${val.toFixed(0)} bp` : `${val.toFixed(2)}%`) : "—"}
        </div>
        {rate.change != null && (
          <div style={{ fontSize: 9, color: c, fontFamily: fonts.mono, marginTop: 1 }}>{rate.change >= 0 ? "+" : ""}{(rate.change * 100).toFixed(0)} bp · ~1mo</div>
        )}
      </div>
      <div style={{ flex: 1, maxWidth: 64, minWidth: 44 }}>
        {rate.spark && rate.spark.length > 1 && <Sparkline data={rate.spark} color={c} height={26} />}
      </div>
    </div>
  );
}

function fmtTimeAgo(ts) {
  if (!ts) return "";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

// ── Implied move: ±1σ expected range from ATM IV, one line with an ETF toggle
// Same math as the Options page tiles, computed from the CBOE options chain.
const IMOVE_ETFS = [
  { sym: "SPY", label: "S&P 500" },
  { sym: "QQQ", label: "Nasdaq 100" },
  { sym: "IWM", label: "Russell 2000" },
];

function ImpliedMoveLine() {
  const [sel, setSel] = useState("SPY");
  const [chain, setChain] = useState({}); // cache keyed by symbol
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (chain[sel]) return;
    let cancelled = false;
    setLoading(true); setErr(false);
    fetchOptionsChain(sel)
      .then(d => { if (!cancelled) setChain(c => ({ ...c, [sel]: d })); })
      .catch(() => { if (!cancelled) setErr(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const moves = useMemo(() => {
    const d = chain[sel];
    if (!d || !d.options?.length || !d.spot) return [];
    const spot = d.spot;
    const byDte = {};
    d.options.filter(o => o.type === "C").forEach(o => {
      if (!byDte[o.dte] || Math.abs(o.strike - spot) < Math.abs(byDte[o.dte].strike - spot)) byDte[o.dte] = o;
    });
    const ts = Object.values(byDte).map(o => ({ dte: o.dte, iv: o.iv * 100 })).filter(t => t.iv != null).sort((a, b) => a.dte - b.dte);
    if (!ts.length) return [];
    const targets = [{ label: "1 day", dte: 1 }, { label: "1 week", dte: 7 }, { label: "1 month", dte: 30 }, { label: "3 months", dte: 90 }];
    return targets.map(t => {
      let best = null, minDiff = Infinity;
      for (const x of ts) { const diff = Math.abs(x.dte - t.dte); if (diff < minDiff) { minDiff = diff; best = x; } }
      if (!best || best.iv == null) return null;
      const sigma = spot * (best.iv / 100) * Math.sqrt(t.dte / 365);
      return { label: t.label, iv: best.iv, expectedMove: sigma, pctMove: (sigma / spot) * 100, upper: spot + sigma, lower: spot - sigma };
    }).filter(Boolean);
  }, [chain, sel]);

  const chipStyle = active => ({
    padding: "2px 8px", borderRadius: 6, border: `1px solid ${active ? INDIGO : "rgba(255,255,255,0.1)"}`,
    background: active ? INDIGO : "rgba(255,255,255,0.05)", color: active ? "#0f172a" : "#94a3b8",
    fontSize: 9.5, fontWeight: 600, fontFamily: fonts.mono, cursor: "pointer",
  });

  return (
    <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
      <div style={{ flex: "0 0 150px" }}>
        <div style={cardTitle}>Implied move · {sel}</div>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 3 }}>±1σ from ATM IV</div>
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          {IMOVE_ETFS.map(e => <button key={e.sym} onClick={() => setSel(e.sym)} style={chipStyle(sel === e.sym)} title={e.label}>{e.sym}</button>)}
        </div>
      </div>
      {loading && !chain[sel] ? (
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>Loading {sel} options chain…</div>
      ) : err || !moves.length ? (
        <div style={{ fontSize: 10, color: AMBER, fontFamily: fonts.mono }}>Implied-move data unavailable for {sel} right now (options feed may be rate-limited).</div>
      ) : (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          {moves.filter(im => [im.iv, im.expectedMove, im.pctMove, im.lower, im.upper].every(v => v != null && isFinite(v))).map(im => (
            <div key={im.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>{im.label} · {im.iv.toFixed(0)}% IV</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>±${im.expectedMove.toFixed(2)}</span>
              <span style={{ fontSize: 9.5, color: "#94a3b8", fontFamily: fonts.mono }}>±{im.pctMove.toFixed(2)}% · ${im.lower.toFixed(0)}–${im.upper.toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Damodaran implied ERP (FCFE) — the PROPER risk premium ──────────────────
// Annual series 1960→ from src/lib/damodaran.json (refresh script, January).
export function damodaranSummary() {
  const series = (DAMODARAN.erp || []).filter(r => r.erp != null);
  if (series.length < 20) return null;
  const last = series[series.length - 1];
  const vals = series.map(r => r.erp);
  const pct = Math.round((vals.filter(v => v < last.erp).length / vals.length) * 100);
  const color = pct >= 70 ? GREEN : pct >= 30 ? AMBER : RED;
  return { series, last, pct, color, spark: series.map(r => +(r.erp * 100).toFixed(2)) };
}

function DamodaranErpStrip() {
  const d = damodaranSummary();
  const dm = useDamodaranMonthly();
  if (!d) return null;
  const { series } = d;
  const last = dm ? { erp: dm.erp, tbond: dm.tbond ?? d.last.tbond, y: `${new Date(dm.asOf.slice(0, 10) + "T00:00:00").toLocaleString("en-US", { month: "short", year: "numeric" })} (monthly update)` } : { ...d.last, y: `end-${d.last.y}` };
  const pct = dm ? damPct(d, dm.erp) : d.pct;
  const dColor = dm ? damColor(pct) : d.color;
  const spark = series.map(r => ({ i: r.y, v: +(r.erp * 100).toFixed(2) }));
  const ys = spark.map(p => p.v);
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ ...cardTitle, letterSpacing: 0.6 }}>Damodaran Implied ERP (FCFE) · {last.y}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 3, flexWrap: "wrap" }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: dColor, fontFamily: fonts.heading, lineHeight: 1 }}>{(last.erp * 100).toFixed(2)}%</span>
          <span style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono }}>{pct}th pctile since {series[0].y} · vs 10Y {(last.tbond * 100).toFixed(2)}%</span>
        </div>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.5, maxWidth: 520 }}>
          The forward-looking premium (expected cash flows vs today&apos;s index) — the measure Damodaran argues for. It differs from the simple gap above because that gap ignores buybacks and growth; when the two diverge hard, growth expectations are carrying the market.
        </div>
      </div>
      <div style={{ flex: "1 1 220px", minWidth: 180, height: 56 }}>
        <ResponsiveContainer width="100%" height={56}>
          <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="derp-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={dColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={dColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[Math.min(...ys) - 0.3, Math.max(...ys) + 0.3]} />
            <Area type="monotone" dataKey="v" stroke={dColor} fill="url(#derp-grad)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, textAlign: "right", marginTop: -2 }}>{series[0].y}–{last.y} annual · source: Damodaran (updated {DAMODARAN.asOf})</div>
      </div>
    </div>
  );
}

// ── Equity Risk Premium hero (full-chart fold) ──────────────────────────────
function ErpHero({ erp }) {
  if (!erp || erp.currentErp == null) return null;
  const color = TONE_COLOR[erp.tone] || INDIGO;
  const spark = (erp.history || []).map(h => ({ i: h.d, v: h.v }));
  const ys = spark.map(p => p.v);
  const minY = ys.length ? Math.min(...ys) : -2, maxY = ys.length ? Math.max(...ys) : 5;
  return (
    <div style={{ ...cardStyle, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: color }} />
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ ...cardTitle, letterSpacing: 0.6 }}>Equity Risk Premium · S&amp;P 500 vs 10Y</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 32, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -1, lineHeight: 1 }}>{erp.currentErp != null ? `${erp.currentErp > 0 ? "+" : ""}${erp.currentErp.toFixed(2)}pp` : "—"}</span>
            {erp.verdict && <span style={{ fontSize: 11, fontWeight: 600, color, background: `${color}1e`, padding: "3px 9px", borderRadius: 6, fontFamily: fonts.mono }}>{erp.verdict}</span>}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>
            Earnings yield {erp.earningsYield != null ? `${erp.earningsYield.toFixed(2)}%` : "—"} − 10Y treasury {erp.tenYear != null ? `${erp.tenYear.toFixed(2)}%` : "—"}
            {erp.percentile != null && <> · <span style={{ color }}>{erp.percentile}th percentile</span> of 25 yrs</>}
          </div>
        </div>
        {spark.length > 4 && (
          <div style={{ flex: "1 1 220px", minWidth: 180, height: 62 }}>
            <ResponsiveContainer width="100%" height={62}>
              <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="erp-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={[Math.min(minY, 0) - 0.3, maxY + 0.3]} />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" strokeOpacity={0.6} />
                <Area type="monotone" dataKey="v" stroke={color} fill="url(#erp-grad)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, textAlign: "right", marginTop: -2 }}>25-yr history · dashed = 0 (stocks = bonds)</div>
          </div>
        )}
      </div>
      <DamodaranErpStrip />
    </div>
  );
}

// ── Yield curve mini-viz from the rates the summary already provides ─────────
function YieldCurve({ rates }) {
  const pick = id => rates.find(r => r.id === id)?.value;
  const pts = [
    { label: "Fed", val: pick("DFF") },
    { label: "2Y",  val: pick("DGS2") },
    { label: "10Y", val: pick("DGS10") },
    { label: "30Y", val: pick("DGS30") },
  ].filter(p => p.val != null);
  const spread = rates.find(r => r.id === "spread2s10s")?.value;
  if (pts.length < 2) return null;
  // padT leaves room for the value label above the highest point — usually the
  // 30Y, whose label otherwise ran off the top of the viewBox and got clipped.
  const W = 220, H = 80, padX = 24, padT = 20, padB = 20;
  const vals = pts.map(p => p.val);
  const lo = Math.min(...vals), hi = Math.max(...vals), range = (hi - lo) || 1;
  const x = i => padX + (i / (pts.length - 1)) * (W - padX * 2);
  const y = v => padT + (1 - (v - lo) / range) * (H - padT - padB);
  const line = pts.map((p, i) => `${x(i)},${y(p.val)}`).join(" ");
  const inverted = spread != null && spread < 0;
  return (
    <div style={cardStyle}>
      <div style={cardTitle}>Yield Curve</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet" style={{ marginTop: 4 }}>
        <polyline points={line} fill="none" stroke={INDIGO} strokeWidth="1.6" />
        {pts.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.val)} r="2.6" fill={INDIGO} />
            <text x={x(i)} y={H - 6} fontSize="8" fill="#64748b" textAnchor="middle" fontFamily="monospace">{p.label}</text>
            <text x={x(i)} y={y(p.val) - 7} fontSize="9.5" fontWeight="600" style={{ fill: "var(--text-primary)" }} textAnchor="middle" fontFamily="monospace">{p.val != null ? p.val.toFixed(2) : ""}</text>
          </g>
        ))}
      </svg>
      {spread != null && (
        <div style={{ fontSize: 10.5, color: inverted ? RED : GREEN, fontFamily: fonts.mono, marginTop: 2 }}>
          2s10s {spread >= 0 ? "+" : ""}{spread.toFixed(0)} bp · {inverted ? "inverted — recession signal" : "un-inverted"}
        </div>
      )}
    </div>
  );
}

// ── Real yield: what bonds pay after inflation — the band's third number ────
// The 10-year TIPS yield and the 10-year breakeven from FRED, the real yield's
// percentile across the whole TIPS record (2003 on), and the earnings yield set
// against it. The Valuation card compares the earnings yield with the nominal
// 10-year; this is the same comparison after inflation, which is the one that
// decides whether "bonds win" survives.
const ord = n => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
function RealYieldCard({ ey }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    let alive = true;
    // Netlify fork: baked path rather than the relay query form.
    const load = id => fetch(`/api/fred/${id}`).then(r => r.json())
      .then(j => (j.observations || []).filter(o => o.value !== ".").map(o => ({ d: o.date, v: parseFloat(o.value) })).reverse())
      .catch(() => []);
    Promise.all([load("DFII10"), load("T10YIE")]).then(([real, be]) => { if (alive) setS({ real, be }); });
    return () => { alive = false; };
  }, []);
  const real = s?.real || [], be = s?.be || [];
  const last = real[real.length - 1], monthAgo = real[Math.max(0, real.length - 22)];
  const ry = last?.v ?? null, bev = be[be.length - 1]?.v ?? null;
  const chg = ry != null && monthAgo && real.length > 22 ? (ry - monthAgo.v) * 100 : null;
  const pct = ry != null && real.length > 250 ? Math.round((real.filter(o => o.v < ry).length / real.length) * 100) : null;
  const gap = ey != null && ry != null ? ey - ry : null;
  const c = chg == null ? INDIGO : chg >= 0 ? "#10b981" : RED;
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={cardTitle}>Real yield — 10y TIPS</span>
        <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>after inflation</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.6, lineHeight: 1.1 }}>{ry != null ? `${ry.toFixed(2)}%` : s ? "—" : "…"}</div>
          <div style={{ fontSize: 9, color: c, fontFamily: fonts.mono, marginTop: 2, whiteSpace: "nowrap" }}>
            {chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(0)} bp · ~1mo` : ""}{pct != null ? ` · ${ord(pct)} pct since 2003` : ""}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 56 }}>{real.length > 1 && <Sparkline data={real.slice(-250).map(o => o.v)} color={c} height={30} />}</div>
      </div>
      <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6 }}>
        breakeven {bev != null ? `${bev.toFixed(2)}%` : "—"}{ry != null && bev != null ? ` · nominal ${(ry + bev).toFixed(2)}% implied` : ""}
      </div>
      {gap != null && (
        <div style={{ fontSize: 10, color: gap >= 0 ? GREEN : RED, fontFamily: fonts.mono, marginTop: 3 }}>
          EY {ey.toFixed(2)}% − real {ry.toFixed(2)}% = {gap >= 0 ? "+" : ""}{gap.toFixed(2)}pp · {gap >= 0 ? "stocks pay more after inflation" : "bonds pay more after inflation"}
        </div>
      )}
      <div style={{ fontSize: 8.5, color: "#475569", fontFamily: fonts.mono, marginTop: 5 }}>FRED DFII10 · T10YIE · sparkline 1 yr · pct = share of days since 2003 below today</div>
    </div>
  );
}

// ── Fear & Greed as a meter (the gauge lives in the fold) ───────────────────
const FG_PARTS = [["vix", "VIX"], ["momentum", "Momentum"], ["safeHaven", "Safe haven"], ["junkBond", "Junk demand"], ["breadth", "Breadth"]];
function FgMeter({ fg }) {
  const score = fg?.composite ?? null;
  const label = score == null ? "—" : score < 25 ? "Extreme Fear" : score < 45 ? "Fear" : score < 55 ? "Neutral" : score < 75 ? "Greed" : "Extreme Greed";
  const color = score == null ? "#64748b" : score < 45 ? RED : score < 55 ? AMBER : GREEN;
  const comp = k => { const v = fg?.components?.[k]; return v == null ? null : Math.round(typeof v === "number" ? v : v.score); };
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={cardTitle}>Fear &amp; Greed</span>
        <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>composite of five, updated every 15 min</span>
      </div>
      {score == null ? (
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 8 }}>{fg ? "Fear & Greed unavailable." : "Loading Fear & Greed…"}</div>
      ) : (<>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6 }}>
          <span style={{ fontSize: 26, fontWeight: 700, color, fontFamily: fonts.heading, lineHeight: 1 }}>{Math.round(score)}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}1e`, padding: "2px 9px", borderRadius: 6, fontFamily: fonts.mono }}>{label}</span>
          <div style={{ flex: 1, position: "relative", height: 8, borderRadius: 4, background: "linear-gradient(90deg, #f87171, #fbbf24, #4ade80)", opacity: 0.9 }}>
            <div style={{ position: "absolute", left: `${Math.min(100, Math.max(0, score))}%`, top: -4, width: 3, height: 16, background: "var(--text-primary)", borderRadius: 2, transform: "translateX(-50%)" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {FG_PARTS.map(([k, name]) => {
            const v = comp(k);
            return (
              <div key={k} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: v == null ? "#64748b" : v >= 60 ? GREEN : v >= 40 ? AMBER : RED, fontFamily: fonts.heading }}>{v ?? "—"}</div>
                <div style={{ fontSize: 8.5, color: "#64748b", fontFamily: fonts.mono }}>{name}</div>
              </div>
            );
          })}
        </div>
      </>)}
    </div>
  );
}

// ── Fold: collapsed by default, the summary value stays visible ─────────────
function Evidence({ title, summary, open, onToggle, children }) {
  return (
    <div>
      <button onClick={onToggle} style={{ width: "100%", textAlign: "left", cursor: "pointer", background: cardBg, border: cardBorder, borderRadius: 12, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading }}>
          <span style={{ color: INDIGO, marginRight: 8 }}>{open ? "▾" : "▸"}</span>{title}
        </span>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: "right" }}>{summary}</span>
      </button>
      {open && <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>}
    </div>
  );
}

// ── Right rail: the watchlist ───────────────────────────────────────────────
function WatchlistCard({ quotes, tickers, fmpKey, onTicker, onNavigate }) {
  const rows = useMemo(() => (quotes || []).map(q => {
    const chg = q.changePercentage ?? q.changesPercentage ?? null;
    const vs50 = q.priceAvg50 ? ((q.price / q.priceAvg50) - 1) * 100 : null;
    const offHi = q.yearHigh ? ((q.price / q.yearHigh) - 1) * 100 : null;
    return { sym: q.symbol, price: q.price, chg, offHi, vs50 };
  }), [quotes]);
  const withChg = rows.filter(r => r.chg != null);
  const nUp = withChg.filter(r => r.chg > 0).length;
  const worst = withChg.length ? withChg.reduce((a, b) => (b.chg < a.chg ? b : a)) : null;
  const best = withChg.length ? withChg.reduce((a, b) => (b.chg > a.chg ? b : a)) : null;
  const cell = { fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap" };
  const grid = { display: "grid", gridTemplateColumns: "56px 1fr 60px 56px 46px", gap: 6 };
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={cardTitle}>My watchlist · {tickers.length}</span>
        <button onClick={() => onNavigate?.("stocks")} style={linkStyle}>Stocks →</button>
      </div>
      {!fmpKey ? (
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 8 }}>Add an FMP key to see quotes for your list.</div>
      ) : !quotes ? (
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 8 }}>Loading quotes…</div>
      ) : (<>
        <div style={{ ...grid, fontSize: 8.5, color: "#475569", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 8, paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span>Ticker</span><span style={{ textAlign: "right" }}>Price</span><span style={{ textAlign: "right" }}>Day</span><span style={{ textAlign: "right" }}>vs 50d</span><span style={{ textAlign: "right" }}>52w hi</span>
        </div>
        {rows.map(r => (
          <div key={r.sym} style={{ ...grid, alignItems: "center", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <button onClick={() => onTicker?.(r.sym)} title={`Open ${r.sym} in Stocks`} style={{ ...linkStyle, fontSize: 12, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, textAlign: "left" }}>{r.sym}</button>
            <span style={{ ...cell, color: "#94a3b8" }}>{r.price != null ? `$${r.price.toFixed(2)}` : "—"}</span>
            <span style={{ ...cell, fontWeight: 700, color: r.chg == null ? "#64748b" : r.chg >= 0 ? GREEN : RED }}>{fmtPct(r.chg)}</span>
            <span style={{ ...cell, color: r.vs50 == null ? "#64748b" : r.vs50 >= 0 ? "#86efac" : "#fca5a5" }}>{fmtPct(r.vs50, 1)}</span>
            <span style={{ ...cell, color: r.offHi == null ? "#64748b" : r.offHi > -3 ? "#86efac" : r.offHi > -15 ? "#94a3b8" : "#fca5a5" }}>{fmtPct(r.offHi, 1)}</span>
          </div>
        ))}
        <div style={{ fontSize: 8.5, color: "#475569", fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>
          {withChg.length ? `${nUp} up · ${withChg.length - nUp} down${best ? ` · best ${best.sym} ${fmtPct(best.chg)}` : ""}${worst ? ` · worst ${worst.sym} ${fmtPct(worst.chg)}` : ""}` : "no quotes"} · 52w hi = distance from the 52-week high · shared with Stocks &amp; Options
        </div>
      </>)}
    </div>
  );
}

// ── Right rail: theme pulse — verdicts computed on the other tabs ───────────
function ThemePulse({ rows }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={cardTitle}>Theme pulse</span>
        <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>verdicts from each tab</span>
      </div>
      <div style={{ marginTop: 2 }}>
        {rows.map(r => (
          <div key={r.name} onClick={r.onOpen} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: r.onOpen ? "pointer" : "default" }}>
            <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: r.color }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono }}>{r.name}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: r.color, fontFamily: fonts.heading, marginTop: 2, lineHeight: 1.2 }}>{r.verdict}</div>
              {r.why && <div style={{ fontSize: 9.5, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 2, lineHeight: 1.4 }}>{r.why}</div>}
            </div>
            <span style={{ fontSize: 12, color: "#64748b" }}>→</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({ fmpKey, onNavigate, onTicker }) {
  const [data, setData] = useState(null);
  const [indexYields, setIndexYields] = useState([]);
  const [erp, setErp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0); // for re-rendering "X min ago" timestamp
  // Rail + meter sources — each loads independently so the page fills in progressively
  const [fg, setFg] = useState(null);
  const [kalecki, setKalecki] = useState(null);
  const [debt, setDebt] = useState(null);
  const [bank, setBank] = useState(null);
  const [housing, setHousing] = useState(null);
  const [chain, setChain] = useState({ or: null, ornn: null, semi: null, mem: null });
  const [quotes, setQuotes] = useState(null);
  const [showCharts, setShowCharts] = useState(false);
  const tickers = useMemo(loadTickers, []);

  const load = (force = false) => {
    setLoading(true);
    Promise.all([
      fetch(`/api/dashboard-summary${force ? "?refresh=1" : ""}`).then(r => {
        if (!r.ok) throw new Error("Dashboard summary unavailable");
        return r.json();
      }),
      fetch(`/api/index-pe${force ? "?refresh=1" : ""}`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/erp${force ? "?refresh=1" : ""}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([summary, yields, erpData]) => {
        setData(summary);
        if (Array.isArray(yields)) setIndexYields(yields);
        if (erpData && !erpData.error) setErp(erpData);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load(false);
    const refresh = setInterval(() => load(false), 60 * 1000);
    return () => clearInterval(refresh);
  }, []);

  // Verdict feeds: all server-cached, fetched once per visit (not on the 60s loop)
  useEffect(() => {
    const ok = set => d => { if (d && !d.error) set(d); };
    const setC = k => d => setChain(c => ({ ...c, [k]: d }));
    fetch("/api/fear-greed").then(r => r.json()).then(ok(setFg)).catch(() => {});
    fetch("/api/kalecki").then(r => r.json()).then(ok(setKalecki)).catch(() => {});
    fetch("/api/debt-market").then(r => r.json()).then(ok(setDebt)).catch(() => {});
    fetch("/api/bank-credit").then(r => r.json()).then(ok(setBank)).catch(() => {});
    fetch("/api/housing-health").then(r => r.json()).then(ok(setHousing)).catch(() => {});
    fetch("/api/or-rankings-history").then(r => r.json()).then(setC("or")).catch(() => {});
    fetch("/api/ornn").then(r => r.json()).then(ok(setC("ornn"))).catch(() => {});
    fetch("/api/semi-h100").then(r => r.json()).then(ok(setC("semi"))).catch(() => {});
    fetch("/api/memory").then(r => r.json()).then(ok(setC("mem"))).catch(() => {});
  }, []);

  // Watchlist quotes: one FMP call per ticker, once per visit
  useEffect(() => {
    if (!fmpKey || !tickers.length) return;
    let alive = true;
    Promise.all(tickers.map(t =>
      fetchFMP(`/quote?symbol=${t}`, fmpKey).then(d => (Array.isArray(d) && d.length ? d[0] : null)).catch(() => null)
    )).then(qs => { if (alive) setQuotes(qs.filter(Boolean)); });
    return () => { alive = false; };
  }, [fmpKey, tickers]);

  // Re-render every 30s so the "X min ago" label stays current
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const regime = useMemo(() => data ? computeRegime(data.indexes || [], data.commodities || [], data.crypto || []) : null, [data]);
  const chainC = useMemo(() => chainModel(chain.or, chain.ornn, chain.semi, chain.mem), [chain]);
  const chainH = useMemo(() => chainHeadline(chainC), [chainC]);
  const dam = useMemo(damodaranSummary, []);

  if (loading && !data) {
    return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading market snapshot…</div>;
  }
  if (error || !data) {
    return <InfoBox color="#F97316">Unable to load market snapshot. Try refresh, or check that the dev server is running.</InfoBox>;
  }

  const { commodities = [], crypto = [], rates = [] } = data;
  const tape = [...commodities.map(c => ({ ...c, kind: "commodity" })), ...crypto.map(c => ({ ...c, kind: "crypto" }))];
  const firstClause = s => (s || "").split(/ — |\. /)[0];

  // Theme pulse rows — only the verdicts the other tabs actually computed
  const kv = kalecki?.verdict, kl = kalecki?.latest;
  const themes = [
    { name: "AI Economy · The Chain", verdict: chainH.label, color: chainH.color, why: chainH.why || "loading token demand, H100 and memory feeds", onOpen: () => onNavigate?.("ai") },
    { name: "U.S. Economy · Profits Engine", verdict: kv ? kv.label.split(" — ")[0] : "…", color: kv?.color ?? "#64748b",
      why: kl ? `${kl.actual.toFixed(1)}% of GDP · p${kalecki.pct} · ${kl.gov > kl.inv ? "deficit is the largest engine" : "investment is the largest engine"}` : "", onOpen: () => onNavigate?.("economy") },
    { name: "U.S. Economy · Debt & Credit", verdict: debt?.verdict?.label ?? "…", color: debt?.verdict?.color ?? "#64748b",
      why: debt?.verdict?.hy != null ? `HY spread ${debt.verdict.hy.toFixed(2)}%${debt.verdict.hyPct != null ? ` · ${debt.verdict.hyPct}th pct (3y)` : ""}` : "", onOpen: () => onNavigate?.("economy") },
    { name: "U.S. Economy · Bank Credit", verdict: bank?.verdict?.label ?? "…", color: bank?.verdict?.color ?? "#64748b", why: firstClause(bank?.verdict?.note), onOpen: () => onNavigate?.("economy") },
    { name: "U.S. Economy · Housing", verdict: housing?.verdict?.label ?? "…", color: housing?.verdict?.color ?? "#64748b", why: firstClause(housing?.verdict?.note), onOpen: () => onNavigate?.("economy") },
  ];

  return (<>
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>Cockpit</span>
        <span style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>What am I paid to own stocks today — and what&apos;s in my book.</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>Updated {fmtTimeAgo(data.asOf)}<span style={{ display: "none" }}>{tick}</span></span>
        <button onClick={() => load(true)} title="Re-pull the market snapshot" style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "4px 9px", fontSize: 10, fontFamily: fonts.mono, color: "var(--text-secondary)", cursor: "pointer" }}>↻</button>
      </div>
    </div>

    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ── LEFT: the market ── */}
      <div style={{ flex: "1 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <TodayHero regime={regime} />

        {/* KPI band: what am I paid, and what does money cost */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 10 }}>
          {/* bottom-up (Morningstar) beside the two top-down reads — spans the row */}
          <div style={{ gridColumn: "1 / -1" }}>
            <ValuationLensesCard erp={erp} dam={dam} onNavigate={onNavigate} />
          </div>

          <div style={cardStyle}>
            <span style={cardTitle}>Earnings yield by index</span>
            {indexYields.filter(i => i.earningsYield != null).map(i => (
              <div key={i.symbol} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                <span style={{ width: 66, fontSize: 9.5, color: "#94a3b8", fontFamily: fonts.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.name}>{i.name}</span>
                <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                  <div style={{ width: `${Math.min(100, i.earningsYield * 10)}%`, height: "100%", background: GREEN, borderRadius: 2, opacity: 0.8 }} />
                </div>
                <span style={{ width: 42, textAlign: "right", fontSize: 10, fontWeight: 700, color: GREEN, fontFamily: fonts.mono }}>{i.earningsYield.toFixed(2)}%</span>
              </div>
            ))}
            {!indexYields.length && <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 8 }}>Loading…</div>}
            <div style={{ fontSize: 8.5, color: "#475569", fontFamily: fonts.mono, marginTop: 6 }}>shared 0–10% scale · longer = cheaper · P/E in Stocks</div>
          </div>

          <YieldCurve rates={rates} />
          <RealYieldCard ey={(indexYields.find(i => /s&p/i.test(i.name || "")) || indexYields[0])?.earningsYield ?? null} />
        </div>

        {/* Rates strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: 8 }}>
          {["DFF", "DGS2", "DGS10", "MORTGAGE30US"].map(id => rates.find(r => r.id === id)).filter(Boolean).map(r => <RateRow key={r.id} rate={r} />)}
        </div>

        <FgMeter fg={fg} />
        <ImpliedMoveLine />

        {/* Commodities & crypto — context, not the main event */}
        <div style={{ ...cardStyle, borderRadius: 12, padding: "6px 4px", display: "flex", flexWrap: "wrap" }}>
          {tape.map(item => {
            const up = item.changePct != null && item.changePct >= 0;
            const px = item.kind === "crypto" && item.price >= 1000 ? `${(item.price / 1000).toFixed(1)}k`
              : item.price >= 1000 ? item.price.toFixed(0) : item.price?.toFixed(2);
            return (
              <div key={item.symbol} style={{ padding: "6px 12px", borderRight: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", minWidth: 92 }}>
                <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4 }}>{item.name}</span>
                <span style={{ fontSize: 12, fontFamily: fonts.mono, color: "var(--text-primary)", fontWeight: 600 }}>
                  {px} <span style={{ color: up ? GREEN : RED, fontWeight: 600 }}>{item.changePct != null ? `${up ? "+" : ""}${(item.changePct * 100).toFixed(1)}%` : ""}</span>
                </span>
              </div>
            );
          })}
        </div>

        {/* The full charts, folded */}
        <Evidence title="Full charts — ERP 25-yr history, Damodaran, Fear & Greed gauge" open={showCharts} onToggle={() => setShowCharts(o => !o)}
          summary={erp && erp.currentErp != null ? `${erp.currentErp > 0 ? "+" : ""}${erp.currentErp.toFixed(2)}pp${dam ? ` · ${(dam.last.erp * 100).toFixed(2)}%` : ""}${fg?.composite != null ? ` · F&G ${Math.round(fg.composite)}` : ""}` : "—"}>
          {erp && <ErpHero erp={erp} />}
          <FearGreedGauge />
        </Evidence>
      </div>

      {/* ── RIGHT: my book ── */}
      <div style={{ flex: "0 1 340px", minWidth: 300, position: "sticky", top: 20, alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: 10 }}>
        <WatchlistCard quotes={quotes} tickers={tickers} fmpKey={fmpKey} onTicker={onTicker} onNavigate={onNavigate} />
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={cardTitle}>Earnings — next 10 days</span>
            <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>from your watchlist</span>
          </div>
          <EarningsWeekAhead tickers={tickers} fmpKey={fmpKey} />
        </div>
        <ThemePulse rows={themes} />
      </div>
    </div>
  </>);
}

export default OverviewTab;
