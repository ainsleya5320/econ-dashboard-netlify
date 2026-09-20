import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { fetchFred } from "../lib/api.js";
import { SH, InfoBox } from "../components/shared.jsx";

// ============================================================================
// GROWTH — output and the activity gauges that lead it.
// Replaces the old GDP tab (nine generic stat cards, most of them duplicated on
// Pulse). Built around what Pulse actually drills here: core capital goods
// orders, building permits, the two earliest regional Fed surveys, the
// inventory/sales ratio and the Chicago Fed index — with real GDP as the
// lagging confirmation. All FRED, fetched client-side like the Labor tab.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", ORANGE = "#fb923c";
const TONE = { green: GREEN, amber: AMBER, red: RED, slate: SLATE };
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const pc = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}%` : "—");
const num = (v, dp = 0) => (fin(v) ? v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp }) : "—");
const ymd = d => (typeof d === "string" ? d.slice(0, 7) : "—");
const yr4 = x => (typeof x === "string" ? x.slice(0, 4) : "");
const last = a => (a && a.length ? a[a.length - 1] : null);
const back = (a, n) => (a && a.length > n ? a[a.length - 1 - n] : null);
const chg = (a, b) => (fin(a) && fin(b) && b !== 0 ? ((a / b) - 1) * 100 : null);
const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />;

// [id, label, freq, limit, kind, good, [greenAt, redAt], unit, note]. Tones mirror the Pulse rows that drill here.
const SERIES = [
  ["A191RL1Q225SBEA", "Real GDP growth, annualized", "Q", 120, "level", 1, [2.5, 0], "%", "quarter on quarter, seasonally adjusted annual rate"],
  ["GDPC1", "Real GDP, yoy", "Q", 120, "yoy", 1, [2.5, 1], "%", "chained 2017 dollars"],
  ["A939RX0Q048SBEA", "Real GDP per capita, yoy", "Q", 120, "yoy", 1, [1.5, 0.5], "%", ""],
  ["INDPRO", "Industrial production, yoy", "M", 300, "yoy", 1, [1, -1], "%", "the coincident gauge of the goods economy"],
  ["NEWORDER", "Core capital goods orders, yoy", "M", 300, "yoy", 1, [2, -2], "%", "business investment intentions, ex aircraft and defense"],
  ["PERMIT", "Building permits, yoy", "M", 300, "yoy", 1, [0, -10], "%", "housing leads the cycle by six to twelve months"],
  ["GACDISA066MSFRBNY", "Empire State manufacturing", "M", 200, "level", 1, [5, -5], "idx", "New York Fed, the first survey of each month"],
  ["GACDFSA066MSFRBPHI", "Philadelphia Fed manufacturing", "M", 200, "level", 1, [5, -5], "idx", "the second; together the earliest read on factories"],
  ["ISRATIO", "Inventory / sales ratio", "M", 300, "level", -1, [1.35, 1.42], "×", "rising = goods piling up, production cuts follow"],
  ["CFNAIMA3", "Chicago Fed activity, 3-mo avg", "M", 300, "level", 1, [-0.3, -0.7], "idx", "below −0.7 has coincided with every recession since 1970"],
  ["DGORDER", "Durable goods orders, yoy", "M", 300, "yoy", 1, [2, -2], "%", ""],
  ["RRSFS", "Real retail sales, yoy", "M", 300, "yoy", 1, [1.5, 0], "%", "the goods half of the consumer"],
];

function Spark({ values, color, w = 68, h = 18 }) {
  const v = (values || []).filter(fin);
  if (v.length < 3) return <svg width={w} height={h} />;
  const min = Math.min(...v), max = Math.max(...v), range = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${(1 - (x - min) / range) * (h - 4) + 2}`).join(" ");
  return <svg width={w} height={h} style={{ display: "block" }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" /></svg>;
}
const chartBox = (title, children, foot) => (
  <div style={{ ...card, padding: "10px 10px 4px" }}>
    <div style={{ ...label, paddingLeft: 4 }}>{title}</div>
    {children}
    {foot && <div style={{ ...note, padding: "2px 4px 4px" }}>{foot}</div>}
  </div>
);
const th = (t, align = "right") => <th key={t} style={{ padding: "5px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{t}</th>;
const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;

export default function GrowthTab({ fredKey }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!fredKey) { setErr("FRED key missing"); return; }
    Promise.all(SERIES.map(([id, , , limit]) => fetchFred(id, fredKey, limit).catch(() => [])))
      .then(all => setData(Object.fromEntries(SERIES.map(([id], i) => [id, all[i]]))))
      .catch(e => setErr(String(e)));
  }, [fredKey]);

  const rows = useMemo(() => {
    if (!data) return [];
    return SERIES.map(([id, lbl, freq, , kind, good, [g, r], unit, n]) => {
      const s = data[id] || [];
      const L = last(s); if (!L) return null;
      const per = freq === "Q" ? 4 : 12;
      const val = kind === "yoy" ? chg(L.v, back(s, per)?.v) : L.v;
      const yr = kind === "yoy" ? chg(back(s, per)?.v, back(s, 2 * per)?.v) : back(s, per)?.v ?? null;
      const fav = fin(val) ? (good > 0 ? (val >= g ? "green" : val <= r ? "red" : "amber") : (val <= g ? "green" : val >= r ? "red" : "amber")) : "slate";
      const hist = kind === "yoy" ? s.map((p, i) => (i >= per ? chg(p.v, s[i - per].v) : null)).filter(fin) : s.map(p => p.v);
      return { id, label: lbl, freq, kind, unit, note: n, v: val, d: L.d, yr, tone: fav, spark: hist.slice(-36) };
    }).filter(Boolean);
  }, [data]);

  const charts = useMemo(() => {
    if (!data) return null;
    const q = (data.A191RL1Q225SBEA || []).filter(p => p.d >= "2000-01-01").map(p => ({ d: p.d, v: p.v }));
    const gdp = data.GDPC1 || [];
    const gdpYoy = new Map(gdp.map((p, i) => [p.d, i >= 4 ? chg(p.v, gdp[i - 4].v) : null]));
    for (const p of q) p.yoy = fin(gdpYoy.get(p.d)) ? +gdpYoy.get(p.d).toFixed(1) : null;
    const yoyM = (s, from) => { const a = data[s] || []; return a.map((p, i) => ({ d: p.d, v: i >= 12 ? +chg(p.v, a[i - 12].v).toFixed(1) : null })).filter(p => p.d >= from && fin(p.v)); };
    const merge = (a, b, ka, kb) => { const m = new Map(a.map(p => [p.d, { d: p.d, [ka]: p.v }])); for (const p of b) { const r = m.get(p.d) || { d: p.d }; r[kb] = p.v; m.set(p.d, r); } return [...m.values()].sort((x, y) => x.d.localeCompare(y.d)); };
    const lead = merge(yoyM("NEWORDER", "2005-01-01"), yoyM("PERMIT", "2005-01-01"), "capex", "permits");
    const fed = merge((data.GACDISA066MSFRBNY || []).filter(p => p.d >= "2010-01-01"), (data.GACDFSA066MSFRBPHI || []).filter(p => p.d >= "2010-01-01"), "ny", "philly");
    const cfnai = merge((data.CFNAIMA3 || []).filter(p => p.d >= "2000-01-01"), (data.ISRATIO || []).filter(p => p.d >= "2000-01-01"), "cfnai", "isr");
    return { q, lead, fed, cfnai };
  }, [data]);

  if (err) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Could not load growth data: {err}</div>;
  if (!data) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading twelve FRED series…</div>;

  const R = Object.fromEntries(rows.map(r => [r.id, r]));
  const head = [
    ["Real GDP, latest qtr", R.A191RL1Q225SBEA ? pc(R.A191RL1Q225SBEA.v) : "—", "annualized"],
    ["Real GDP, yoy", R.GDPC1 ? pc(R.GDPC1.v) : "—", R.GDPC1 ? ymd(R.GDPC1.d) : ""],
    ["Per capita, yoy", R.A939RX0Q048SBEA ? pc(R.A939RX0Q048SBEA.v) : "—", ""],
    ["Industrial production, yoy", R.INDPRO ? pc(R.INDPRO.v) : "—", R.INDPRO ? ymd(R.INDPRO.d) : ""],
    ["Chicago Fed, 3-mo avg", R.CFNAIMA3 ? num(R.CFNAIMA3.v, 2) : "—", "−0.7 = recession"],
  ];
  const fmt = r => (r.unit === "%" ? pc(r.v) : r.unit === "×" ? num(r.v, 2) : num(r.v, 1));
  const fmtYr = r => (r.kind === "yoy" ? pc(r.yr) : r.unit === "×" ? num(r.yr, 2) : num(r.yr, 1));
  const recess = charts.cfnai.filter(p => fin(p.cfnai) && p.cfnai < -0.7).length;

  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      {head.map(([t, v, sub]) => (
        <div key={t} style={{ ...card, padding: "10px 12px" }}>
          <div style={label}>{t}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5, marginTop: 3 }}>{v}</div>
          {sub && <div style={note}>{sub}</div>}
        </div>))}
    </div>

    <SH>Activity — What Leads Output, and Output Itself</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      <div style={{ ...card, padding: "6px 8px", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{th("Gauge", "left")}{th("Latest")}{th("As of")}{th("A year ago")}{th("3 yrs", "center")}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }} title={`${r.id}${r.note ? ` · ${r.note}` : ""}`}>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: TONE[r.tone], marginRight: 7, verticalAlign: "middle" }} />{r.label}
                {r.note ? <span style={{ color: DIM, marginLeft: 6, fontSize: 9 }}>{r.note.length > 44 ? r.note.slice(0, 42) + "…" : r.note}</span> : null}
              </td>
              {td(fmt(r), "var(--text-primary)", { fontWeight: 700 })}{td(ymd(r.d), DIM)}{td(fmtYr(r), SLATE)}
              <td style={{ padding: "2px 6px", textAlign: "center" }}><Spark values={r.spark} color={TONE[r.tone] === SLATE ? INDIGO : TONE[r.tone]} /></td>
            </tr>))}</tbody>
        </table>
        <div style={{ ...note, marginTop: 6 }}>Tones use the same thresholds as the Pulse rows that drill here. GDP is the lagging confirmation; the six rows from capital goods orders down are what move first.</div>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {chartBox("Real GDP — quarterly growth, annualized, with year-on-year",
          <ResponsiveContainer width="100%" height={180}><BarChart data={charts.q} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            {grid}<XAxis dataKey="d" tick={axis} tickFormatter={yr4} minTickGap={34} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={[-10, 10]} allowDataOverflow />
            <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [`${v}%`, n === "v" ? "Annualized q/q" : "Year on year"]} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
            <Bar dataKey="v" isAnimationActive={false}>{charts.q.map(p => <Cell key={p.d} fill={p.v >= 0 ? GREEN : RED} fillOpacity={0.75} />)}</Bar>
            <Line type="monotone" dataKey="yoy" stroke={INDIGO} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
          </BarChart></ResponsiveContainer>,
          "The 2020 quarters run off the axis on purpose; the scale is set for ordinary cycles.")}
        {chartBox("Chicago Fed activity index (3-mo avg) and the inventory / sales ratio",
          <ResponsiveContainer width="100%" height={150}><LineChart data={charts.cfnai} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            {grid}<XAxis dataKey="d" tick={axis} tickFormatter={yr4} minTickGap={34} axisLine={false} tickLine={false} /><YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} domain={[-2.5, 1.5]} allowDataOverflow /><YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} domain={[1.2, 1.6]} width={30} />
            <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [num(v, 2), n === "cfnai" ? "CFNAI 3-mo" : "Inventory / sales"]} /><ReferenceLine yAxisId="l" y={-0.7} stroke={RED} strokeDasharray="4 4" />
            <Line yAxisId="l" type="monotone" dataKey="cfnai" stroke={INDIGO} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} /><Line yAxisId="r" type="monotone" dataKey="isr" stroke={AMBER} strokeWidth={1.1} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer>,
          `The dashed line is the recession threshold; the 3-month average has been below it in ${recess} months since 2000. Inventories relative to sales (right axis) rise before production is cut.`)}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      {chartBox("Core capital goods orders and building permits, % yoy since 2005",
        <ResponsiveContainer width="100%" height={170}><LineChart data={charts.lead} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          {grid}<XAxis dataKey="d" tick={axis} tickFormatter={yr4} minTickGap={34} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={[-40, 40]} allowDataOverflow />
          <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [`${v}%`, n === "capex" ? "Core capex orders" : "Building permits"]} /><Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono }} iconType="plainline" formatter={n => (n === "capex" ? "Core capex orders" : "Building permits")} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
          <Line type="monotone" dataKey="capex" stroke={CYAN} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="permits" stroke={ORANGE} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
        </LineChart></ResponsiveContainer>,
        "Business investment intentions and the housing pipeline: the two private-sector decisions that turn before hiring does.")}
      {chartBox("Regional Fed manufacturing surveys — Empire State and Philadelphia, since 2010",
        <ResponsiveContainer width="100%" height={170}><LineChart data={charts.fed} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          {grid}<XAxis dataKey="d" tick={axis} tickFormatter={yr4} minTickGap={34} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} domain={[-40, 40]} allowDataOverflow />
          <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [num(v, 1), n === "ny" ? "Empire State" : "Philadelphia"]} /><Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono }} iconType="plainline" formatter={n => (n === "ny" ? "Empire State" : "Philadelphia")} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
          <Line type="monotone" dataKey="ny" stroke={INDIGO} strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="philly" stroke={GREEN} strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} />
        </LineChart></ResponsiveContainer>,
        "Diffusion indexes: above zero means more factories reported expansion than contraction. Noisy month to month, informative when both agree for a quarter.")}
    </div>
    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How to read it.</strong> Output is reported late and revised for years; the point of this page is the ordering. Orders for capital goods, permits and the factory surveys move first, the Chicago Fed index and industrial production confirm within a quarter or two, and GDP arrives last. When the leading rows are green and GDP is soft, the slowdown is probably already over; when GDP is fine and the leading rows have gone red, it isn't. The Profits view alongside asks the next question — who captured the output.
    </InfoBox>
  </>);
}
