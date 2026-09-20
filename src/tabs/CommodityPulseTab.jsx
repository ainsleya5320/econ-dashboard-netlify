import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

// ============================================================================
// COMMODITIES PULSE — the Commodities tab's landing, cockpit-style
// Header: verdict, three scores (momentum breadth, real-price value, macro
// tailwind) and the ratio chips (copper/gold, gold/oil, dollar, real 10-yr,
// breakeven). The board: fifteen contracts — tape, 52-week range, real price
// vs each one's own history, speculative positioning, sparkline. Charts: the
// real all-commodity index since 1992, gold vs the real 10-year, copper/gold
// vs the 10-year. Data: /api/commodity-pulse (server-cached 1h).
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", GOLD = "#facc15";
const TONE = { green: GREEN, amber: AMBER, red: RED };
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const pc = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}%` : "—");
const upDown = v => (!fin(v) || v === 0 ? SLATE : v > 0 ? GREEN : RED);
const price = (v, unit) => (!fin(v) ? "—" : unit?.startsWith("¢") ? `${v.toFixed(0)}¢` : v >= 1000 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`);
const realTone = p => (!fin(p) ? SLATE : p >= 85 ? RED : p >= 65 ? AMBER : p <= 20 ? CYAN : p <= 40 ? GREEN : SLATE);
const GROUP_NAME = { metals: "Precious metals", energy: "Energy", industrial: "Industrial metals", agriculture: "Grains & fibers", softs: "Softs" };

function Spark({ values, color, w = 72, h = 18 }) {
  const v = (values || []).filter(fin);
  if (v.length < 3) return <svg width={w} height={h} />;
  const min = Math.min(...v), max = Math.max(...v), range = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${(1 - (x - min) / range) * (h - 4) + 2}`).join(" ");
  return <svg width={w} height={h} style={{ display: "block" }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" /></svg>;
}
function RangeBar({ pos, color, w = 60 }) {
  if (!fin(pos)) return <div style={{ width: w }} />;
  return <div style={{ position: "relative", width: w, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.07)" }}><div style={{ position: "absolute", left: `calc(${Math.max(0, Math.min(100, pos))}% - 2px)`, top: -3, width: 4, height: 12, borderRadius: 2, background: color }} /></div>;
}
function Score({ name, s }) {
  const c = s ? TONE[s.tone] : SLATE;
  return (
    <div style={{ flex: "1 1 150px", minWidth: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={label}>{name}</span><span style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: fonts.heading, letterSpacing: -0.6, lineHeight: 1 }}>{s ? s.score : "…"}</span></div>
      <div style={{ position: "relative", height: 5, borderRadius: 3, marginTop: 5, background: "linear-gradient(90deg, #f87171 0%, #fbbf24 50%, #4ade80 100%)", opacity: 0.85 }}>{s && <div style={{ position: "absolute", left: `calc(${s.score}% - 4px)`, top: -3, width: 8, height: 11, borderRadius: 2, background: "#f8fafc", border: `1.5px solid ${c}` }} />}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: fonts.heading, marginTop: 6, lineHeight: 1.2 }}>{s?.label || "loading"}</div>
    </div>
  );
}
function VerdictCard({ title, s }) {
  if (!s) return null;
  const c = TONE[s.tone] || SLATE;
  return (
    <div style={{ ...card, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: c }} />
      {title && <div style={label}>{title}</div>}
      {s.label && <div style={{ fontSize: 13.5, fontWeight: 700, color: c, fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: title ? 3 : 0 }}>{s.label}</div>}
      <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.5 }}>{s.why}</div>
    </div>
  );
}
const chartBox = (title, children, foot) => (
  <div style={{ ...card, padding: "10px 10px 4px" }}>
    <div style={{ ...label, paddingLeft: 4 }}>{title}</div>
    {children}
    {foot && <div style={{ ...note, padding: "2px 4px 4px" }}>{foot}</div>}
  </div>
);

const invFmt = (v, unit) => (!fin(v) ? "—" : unit === "MBBL" ? `${(v / 1000).toFixed(1)}M bbl` : unit === "BCF" ? `${Math.round(v).toLocaleString()} bcf` : unit === "MBBL/D" ? `${(v / 1000).toFixed(2)}M b/d` : `${v.toFixed(1)}%`);
const invWow = (v, unit) => (!fin(v) ? "—" : unit === "MBBL" ? `${sgn(v)}${(Math.abs(v) / 1000).toFixed(1)}M` : unit === "BCF" ? `${sgn(v)}${Math.abs(Math.round(v))} bcf` : unit === "MBBL/D" ? `${sgn(v)}${Math.abs(Math.round(v))}K b/d` : `${sgn(v)}${Math.abs(v).toFixed(1)}pp`);
const invTone = (v, tone) => (!tone || !fin(v) ? SLATE : v < -12 ? RED : v < -5 ? AMBER : v > 8 ? CYAN : SLATE);
function Inventories({ inv }) {
  if (!inv) return null;
  if (!inv.available) return <div style={{ ...card, marginBottom: 14, fontSize: 10.5, color: "#64748b", fontFamily: fonts.mono }}>Inventories unavailable: {inv.reason}</div>;
  const items = inv.items.filter(i => !i.error);
  const tightest = items.filter(i => i.tone && fin(i.vs5y)).sort((a, b) => a.vs5y - b.vs5y)[0];
  return (<>
    <SH>Inventories — What Is Actually in the Tanks (EIA, weekly)</SH>
    <div style={{ ...note, marginTop: -8, marginBottom: 8 }}>Level, week-on-week change, and the gap to the five-year average for the same week of the year — the seasonal yardstick the energy market prices off. Amber = tighter than normal, red = much tighter, cyan = ample.{tightest ? ` Tightest: ${tightest.label.toLowerCase()} ${pc(tightest.vs5y, 0)} vs its five-year average.` : ""}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      {items.map(i => { const c = invTone(i.vs5y, i.tone); return (
        <div key={i.key} title={`${i.note} · ${i.date} · a year ago ${pc(i.yoyPct)} · five-year average ${invFmt(i.avg5y, i.unit)} (${i.yearsIn5y} yrs)`} style={{ ...card, padding: "10px 12px", borderLeft: `3px solid ${c}` }}>
          <div style={label}>{i.label}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, marginTop: 3 }}><span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.4 }}>{invFmt(i.value, i.unit)}</span><span style={{ fontSize: 10, fontFamily: fonts.mono, color: !fin(i.wow) || i.wow === 0 ? DIM : i.wow > 0 ? CYAN : AMBER }}>{invWow(i.wow, i.unit)} w/w</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginTop: 4 }}><span style={{ fontSize: 10, fontFamily: fonts.mono, fontWeight: 700, color: c }}>{i.tone ? `${pc(i.vs5y, 0)} vs 5-yr avg` : `${pc(i.yoyPct)} y/y`}</span><Spark values={i.spark} color={c} w={64} h={16} /></div>
        </div>); })}
    </div>
  </>);
}

const COLS = [
  { key: "name", label: "Contract", align: "left" }, { key: "price", label: "Price" }, { key: "day", label: "Day" }, { key: "ytd", label: "YTD" }, { key: "r1y", label: "1 yr" }, { key: "vs200", label: "vs 200-d" },
  { key: "pos52", label: "52-wk range", align: "center" }, { key: "realPct", label: "Real price vs history", align: "center" }, { key: "cot", label: "Spec. net % OI" }, { key: "spark", label: "1 yr", align: "center" },
];

function CommodityPulseTab() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [sort, setSort] = useState({ key: "r1y", asc: false });
  useEffect(() => { fetch("/api/commodity-pulse").then(r => r.json()).then(x => (x && !x.error ? setD(x) : setErr(x?.error || "unavailable"))).catch(e => setErr(e.message)); }, []);
  const rows = useMemo(() => {
    if (!d) return [];
    const get = r => ({ name: r.name, price: r.price, day: r.day, ytd: r.ytd, r1y: r.r1y, vs200: r.vs200, pos52: r.pos52, realPct: r.real?.pct, cot: r.cot?.net })[sort.key];
    const dir = sort.asc ? 1 : -1;
    return [...d.rows].sort((a, b) => { const x = get(a), y = get(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir; });
  }, [d, sort]);
  if (err) return <div style={{ ...card, color: RED, fontFamily: fonts.mono, fontSize: 12 }}>Commodities Pulse unavailable: {err}</div>;
  if (!d) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading the commodities pulse (24 FRED series, 21 market histories, the CFTC report — about 30 seconds the first time, then cached)…</div>;
  const s = d.scores, m = s.macro, oc = TONE[d.overall.tone];
  const th = c => <th key={c.key} onClick={() => c.key !== "spark" && setSort(o => ({ key: c.key, asc: o.key === c.key ? !o.asc : c.key === "name" }))} style={{ padding: "5px 6px", fontSize: 8.5, color: sort.key === c.key ? "#c7d2fe" : DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: c.align || "right", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap", cursor: c.key === "spark" ? "default" : "pointer", userSelect: "none" }}>{c.label}{sort.key === c.key ? (sort.asc ? " ▲" : " ▼") : ""}</th>;
  const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;
  const chips = [["copper / gold", fin(m.copperGold) ? `${m.copperGold} (${pc(m.copperGoldChg6m, 0)} 6m)` : "—"], ["gold / oil", fin(m.goldOil) ? `${m.goldOil} bbl per oz` : "—"], ["dollar", fin(m.dxy) ? `${m.dxy} (${pc(m.dxyYoy)} y/y, p${m.dxyPct})` : "—"], ["real 10-yr", fin(m.realYield) ? `${m.realYield}% (p${m.realYieldPct})` : "—"], ["breakeven", fin(m.breakeven) ? `${m.breakeven}% (p${m.breakevenPct})` : "—"]];

  return (<>
    <div style={{ ...card, padding: "14px 18px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 18, alignItems: "start" }}>
      <div>
        <div style={label}>Commodities · pulse</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: oc, fontFamily: fonts.heading, letterSpacing: -0.7, lineHeight: 1.1, marginTop: 4 }}>{d.overall.label}</div>
        <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>{d.overall.sentence}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>{chips.map(([t, v]) => <span key={t} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "3px 8px" }}>{t} <strong style={{ color: "var(--text-primary)" }}>{v}</strong></span>)}</div>
        <div style={{ ...note, marginTop: 8 }}>15 contracts · Yahoo futures, IMF prices via FRED, CFTC · refreshed {new Date(d.updated).toLocaleString()} · hover a cell for its detail</div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><Score name="Momentum" s={s.momentum} /><Score name="Real-price value" s={s.value} /><Score name="Macro tailwind" s={s.macro} /></div>
    </div>

    <SH>The Board — Fifteen Contracts, One Screen</SH>
    <div style={{ ...note, marginTop: -8, marginBottom: 8 }}>Real price = today&apos;s price in today&apos;s dollars ranked against every month of that commodity&apos;s own history (marker on the bar, p = percentile; red = rich, cyan = cheap). Spec. net = CFTC non-commercial longs minus shorts as % of open interest, ranked over three years; crowded = top or bottom decile.</div>
    <div style={{ ...card, padding: "6px 8px", overflowX: "auto", marginBottom: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
        <thead><tr>{COLS.map(th)}</tr></thead>
        <tbody>
          {rows.map(r => {
            const rp = r.real?.pct, rc = realTone(rp);
            return (
              <tr key={r.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(129,140,248,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{r.icon} <strong>{r.name}</strong><span style={{ color: DIM, fontSize: 8.5, marginLeft: 6 }}>{GROUP_NAME[r.group] || r.group} · {r.unit}</span></td>
                {td(price(r.price, r.unit), "var(--text-primary)", { fontWeight: 700 })}{td(pc(r.day, 2), upDown(r.day))}{td(pc(r.ytd), upDown(r.ytd))}{td(pc(r.r1y), upDown(r.r1y), { fontWeight: 700 })}{td(pc(r.vs200), upDown(r.vs200), { title: "distance from the 200-day moving average" })}
                <td style={{ padding: "4px 6px", textAlign: "center" }} title={fin(r.pos52) ? `${r.pos52.toFixed(0)}% of the way from the 52-week low (${price(r.lo52, r.unit)}) to the high (${price(r.hi52, r.unit)})` : ""}><RangeBar pos={r.pos52} color={upDown(r.r1y)} /></td>
                <td style={{ padding: "4px 6px", textAlign: "center" }} title={r.real ? `${r.real.src}; deflated by CPI. Today ≈ ${r.real.now} vs a 20-year median of ${r.real.median20y} in today's dollars (${pc(r.real.vsMedian20y, 0)}); range ${r.real.min}–${r.real.max}; last data month ${r.real.asOf}` : "no long history"}><div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}><RangeBar pos={rp} color={rc} /><span style={{ fontSize: 9.5, fontFamily: fonts.mono, color: rc, width: 26, textAlign: "right", fontWeight: 700 }}>{fin(rp) ? `p${rp}` : "—"}</span><span style={{ fontSize: 9, fontFamily: fonts.mono, color: DIM, width: 40, textAlign: "right" }}>{r.real ? pc(r.real.vsMedian20y, 0) : ""}</span></div></td>
                {td(r.cot ? <>{pc(r.cot.net, 0)} <span style={{ color: DIM, fontSize: 9 }}>p{r.cot.pct}</span>{r.cot.flag && <span style={{ color: r.cot.flag === "crowded long" ? RED : CYAN, fontSize: 8.5, marginLeft: 4, fontWeight: 700 }}>{r.cot.flag === "crowded long" ? "▲ crowded" : "▼ crowded"}</span>}</> : "—", "#cbd5e1", { title: r.cot ? `non-commercial net position ${pc(r.cot.net)} of open interest, ${pc(r.cot.chg13, 0)} in 13 weeks, ${r.cot.pct}th percentile of three years · ${r.cot.d}` : "no CFTC report (ICE Europe contract)" })}
                <td style={{ padding: "2px 6px", textAlign: "center" }}><Spark values={r.spark} color={upDown(r.r1y)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    <Inventories inv={d.inventories} />

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      {chartBox("Real commodity prices since 1992 — IMF indexes in today's dollars (average = 100)",
        <ResponsiveContainer width="100%" height={180}><LineChart data={d.charts.realIndex} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip contentStyle={tip} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" /><ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} />
          <Line type="monotone" dataKey="all" name="All commodities" stroke={INDIGO} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="metals" name="Metals" stroke={AMBER} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="food" name="Food" stroke={GREEN} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
        </LineChart></ResponsiveContainer>,
        `The fair-value chart for the asset class: the 2008 and 2011 peaks, the 2015–20 trough, the 2022 spike. Today the all-commodity index sits at p${d.indexNow.all?.pct} of its real history (${pc(d.indexNow.all?.vsAvg, 0)} vs average); metals p${d.indexNow.metals?.pct}, food p${d.indexNow.food?.pct}.`)}
      {chartBox("Gold vs the real 10-year yield — 10 years",
        <ResponsiveContainer width="100%" height={180}><ComposedChart data={d.charts.goldReal} margin={{ top: 8, right: 4, bottom: 0, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v / 1000)}K`} width={40} domain={["auto", "auto"]} /><YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
          <Tooltip contentStyle={tip} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" />
          <Line yAxisId="l" type="monotone" dataKey="gold" name="Gold ($/oz)" stroke={GOLD} strokeWidth={1.8} dot={false} isAnimationActive={false} /><Line yAxisId="r" type="monotone" dataKey="realYield" name="Real 10-yr (TIPS, right)" stroke={CYAN} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart></ResponsiveContainer>,
        "Gold is a zero-coupon real asset, so it normally falls when real yields rise. When it rises anyway — as since 2022 — the buyers are central banks and people hedging the debt picture, not rate traders.")}
      {chartBox("Copper / gold ratio vs the 10-year yield — 10 years",
        <ResponsiveContainer width="100%" height={180}><ComposedChart data={d.charts.copperGold} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} /><YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
          <Tooltip contentStyle={tip} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" />
          <Line yAxisId="l" type="monotone" dataKey="ratio" name="Copper/gold (×1000)" stroke={"#f97316"} strokeWidth={1.8} dot={false} isAnimationActive={false} /><Line yAxisId="r" type="monotone" dataKey="y10" name="10-yr Treasury (right)" stroke={SLATE} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart></ResponsiveContainer>,
        "Gundlach's growth gauge: copper is industrial demand, gold is fear, and their ratio has tracked the 10-year yield for decades. A ratio falling while yields hold up says the bond market is pricing more growth than the metals see.")}
      {d.spxGoldStats && chartBox(`S&P 500 priced in gold — ounces per index point, monthly since ${d.spxGoldStats.since}`,
        <>
          <ResponsiveContainer width="100%" height={150}><LineChart data={d.charts.spxGold} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [n === "ratio" ? `${v} oz` : n === "spx" ? v.toLocaleString() : `$${v.toLocaleString()}`, n === "ratio" ? "S&P / gold" : n === "spx" ? "S&P 500" : "Gold"]} />
            <Line type="monotone" dataKey="ratio" stroke={GOLD} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>
          <table style={{ width: "100%", borderCollapse: "collapse", margin: "4px 0 2px" }}>
            <thead><tr>{["Window", "S&P in gold", "S&P in $", "Gold in $"].map((h, i) => <th key={h} style={{ padding: "3px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: i ? "right" : "left", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>)}</tr></thead>
            <tbody>{d.spxGoldStats.windows.map(w => <tr key={w.label}><td style={{ padding: "2px 6px", fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1" }}>{w.label}</td><td style={{ padding: "2px 6px", fontSize: 10, fontFamily: fonts.mono, fontWeight: 700, textAlign: "right", color: upDown(w.ratio) }}>{pc(w.ratio, 0)}</td><td style={{ padding: "2px 6px", fontSize: 10, fontFamily: fonts.mono, textAlign: "right", color: upDown(w.spx) }}>{pc(w.spx, 0)}</td><td style={{ padding: "2px 6px", fontSize: 10, fontFamily: fonts.mono, textAlign: "right", color: upDown(w.gold) }}>{pc(w.gold, 0)}</td></tr>)}</tbody>
          </table>
        </>,
        `Today ${d.spxGoldStats.now} oz buys one S&P point (p${d.spxGoldStats.pct} since ${d.spxGoldStats.since}; peak ${d.spxGoldStats.peak.v} in ${d.spxGoldStats.peak.d.slice(0, 4)}, trough ${d.spxGoldStats.trough.v} in ${d.spxGoldStats.trough.d.slice(0, 4)}). When the line falls, stocks are losing to hard money even if they are rising in dollars — the Dalio question of whether paper wealth is real.`)}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      <div style={card}>
        <div style={label}>By group · YTD, 1-yr, real-price percentile</div>
        {d.groups.map(g => (
          <div key={g.group} style={{ display: "grid", gridTemplateColumns: "118px 1fr 48px 48px 40px", alignItems: "center", gap: 8, height: 22 }}>
            <span style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1" }}>{GROUP_NAME[g.group] || g.group} <span style={{ color: DIM, fontSize: 8.5 }}>{g.n}</span></span>
            <div style={{ position: "relative", height: 7, background: "rgba(255,255,255,0.05)", borderRadius: 3 }}><div style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 11, background: "rgba(255,255,255,0.25)" }} /><div style={{ position: "absolute", top: 0, height: "100%", borderRadius: 3, background: upDown(g.ytd), opacity: 0.85, left: g.ytd >= 0 ? "50%" : `${50 - (Math.min(60, Math.abs(g.ytd)) / 60) * 50}%`, width: `${(Math.min(60, Math.abs(g.ytd)) / 60) * 50}%` }} /></div>
            <span style={{ fontSize: 10, fontFamily: fonts.mono, fontWeight: 700, color: upDown(g.ytd), textAlign: "right" }}>{pc(g.ytd, 0)}</span><span style={{ fontSize: 10, fontFamily: fonts.mono, color: upDown(g.r1y), textAlign: "right" }}>{pc(g.r1y, 0)}</span><span style={{ fontSize: 9.5, fontFamily: fonts.mono, color: realTone(g.realPct), textAlign: "right", fontWeight: 700 }}>p{g.realPct}</span>
          </div>
        ))}
      </div>
      <VerdictCard title="Momentum" s={s.momentum} /><VerdictCard title="Real-price value" s={s.value} /><VerdictCard title="Macro" s={s.macro} /><VerdictCard title="Positioning" s={{ tone: s.positioning.crowdedLong.length || s.positioning.crowdedShort.length ? "amber" : "green", label: s.positioning.crowdedLong.length || s.positioning.crowdedShort.length ? "Crowded trades present" : "No crowded trades", why: s.positioning.why }} />
    </div>

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How to read it.</strong> Commodities have no cash flows, so &quot;fair value&quot; is the real price against its own history: over decades, prices revert toward the marginal cost of production, which is why a commodity at the 90th percentile of its inflation-adjusted history is priced for a shortage and one at the 10th is priced for a glut. Momentum says which way the tape is leaning now; the macro score says whether the dollar, real yields and inflation expectations are helping or hurting; positioning says whether the trade is already crowded. The combination to look for is cheap on real price, turning up on momentum, with a macro tailwind and speculators still short. Precious metals use futures history from 2000 because the IMF does not publish them; everything else is the IMF&apos;s monthly average since 1992, deflated by CPI, with today&apos;s price marked to the spot move since the last monthly print.
    </InfoBox>
  </>);
}

export default CommodityPulseTab;
