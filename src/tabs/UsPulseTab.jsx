import React, { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

// ============================================================================
// U.S. PULSE — the U.S. Economy landing, cockpit-style
// Three lenses an investor actually trades on — leading indicators, consumer
// health, the debt picture — each as a dense signal board (latest · change ·
// sparkline · 10-year percentile · tone) beside one synthesis chart and a
// verdict. The header carries the regime, three 0–100 health scores, the
// growth/inflation quadrant and the real-rate read. Every row drills into the
// detail sub-tab that owns it. Data: /api/us-pulse (50 FRED series, cached
// 3h) and /api/macro-dashboard (regime path, real rates).
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee";
const TONE = { green: GREEN, amber: AMBER, red: RED };
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const fmtVal = (v, unit) => {
  if (!fin(v)) return "—";
  const a = Math.abs(v);
  switch (unit) {
    case "%yoy": return `${sgn(v)}${a.toFixed(1)}%`;
    case "%": case "% GDP": return `${v.toFixed(a >= 10 ? 1 : 2)}%`;
    case "pp": return `${sgn(v)}${a.toFixed(2)}pp`;
    case "$": return `$${v.toFixed(2)}`;
    case "$B": return `$${(v / 1e3).toFixed(1)}T`;
    case "$M": return `$${(v / 1e3).toFixed(0)}B`;
    case "$T": return `$${v.toFixed(2)}T`;
    case "K": return a >= 1000 ? `${(v / 1000).toFixed(2)}M` : `${Math.round(v).toLocaleString()}K`;
    case "hrs": return `${v.toFixed(1)}h`;
    case "x": return `${v.toFixed(2)}×`;
    default: return a >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2);
  }
};
const fmtChg = (v, unit) => {
  if (!fin(v)) return "—";
  const a = Math.abs(v);
  switch (unit) {
    case "%yoy": case "%": case "% GDP": case "pp": return `${sgn(v)}${a.toFixed(a >= 10 ? 1 : 2)}pp`;
    case "$": return `${sgn(v)}$${a.toFixed(2)}`;
    case "$B": return `${sgn(v)}$${(a / 1e3).toFixed(2)}T`;
    case "$M": return `${sgn(v)}$${(a / 1e3).toFixed(1)}B`;
    case "$T": return `${sgn(v)}$${a.toFixed(2)}T`;
    case "K": return `${sgn(v)}${Math.round(a).toLocaleString()}K`;
    case "hrs": return `${sgn(v)}${a.toFixed(1)}h`;
    case "x": return `${sgn(v)}${a.toFixed(2)}`;
    default: return `${sgn(v)}${a.toFixed(a >= 10 ? 0 : 1)}`;
  }
};

function Spark({ values, color, w = 84, h = 20 }) {
  const v = (values || []).filter(fin);
  if (v.length < 3) return <svg width={w} height={h} />;
  const min = Math.min(...v), max = Math.max(...v), range = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${(1 - (x - min) / range) * (h - 4) + 2}`).join(" ");
  return <svg width={w} height={h} style={{ display: "block" }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" /><circle cx={w} cy={(1 - (v[v.length - 1] - min) / range) * (h - 4) + 2} r="1.8" fill={color} /></svg>;
}
function PctBar({ pct, good, tone }) {
  if (!fin(pct)) return <div style={{ width: 64 }} />;
  const c = tone ? TONE[tone] : SLATE;
  return (
    <div title={`${pct}th percentile of the last 10 years${good > 0 ? " (high is good)" : good < 0 ? " (low is good)" : ""}`} style={{ position: "relative", width: 64, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.07)" }}>
      <div style={{ position: "absolute", left: `calc(${pct}% - 2px)`, top: -3, width: 4, height: 12, borderRadius: 2, background: c }} />
    </div>
  );
}

// The dense table: tone dot · indicator · latest · 6-mo change · 24-pt sparkline · 10-y percentile
function SignalBoard({ rows, go }) {
  const th = (t, extra = {}) => <th style={{ padding: "4px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap", ...extra }}>{t}</th>;
  return (
    <div style={{ ...card, padding: "6px 8px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{th("", { width: 14 })}{th("Indicator", { textAlign: "left" })}{th("Latest")}{th("6-mo Δ")}{th("2 yrs", { textAlign: "center" })}{th("10-y %ile", { textAlign: "center" })}</tr></thead>
        <tbody>
          {rows.map(r => {
            const c = r.tone ? TONE[r.tone] : SLATE;
            const stale = r.freq === "Q" ? false : (Date.now() - new Date(r.date + "-15").getTime()) / 864e5 > 75;
            return (
              <tr key={r.id} onClick={() => go?.(r.drill)} title={`${r.note}${fin(r.yoy) && r.kind === "level" && ["$", "K", "$B", "$M", "$T", "hrs", "x"].includes(r.unit) ? ` · YoY ${sgn(r.yoy)}${Math.abs(r.yoy).toFixed(1)}%` : ""} · FRED ${r.id} · ${r.freq === "D" ? "daily" : r.freq === "W" ? "weekly" : r.freq === "M" ? "monthly" : "quarterly"} · latest ${r.date}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)", cursor: go ? "pointer" : "default" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(129,140,248,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td style={{ padding: "3px 4px" }}><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: c, boxShadow: r.tone ? `0 0 6px ${c}66` : "none" }} /></td>
                <td style={{ padding: "3px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "#cbd5e1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 210 }}>{r.label}<span style={{ color: DIM, fontSize: 8.5, marginLeft: 5 }}>{r.kind === "yoy" ? "yoy" : ""}{stale ? " · lagged" : ""}</span></td>
                <td style={{ padding: "3px 6px", fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, color: "var(--text-primary)", textAlign: "right", whiteSpace: "nowrap" }}>{fmtVal(r.value, r.unit)}</td>
                <td style={{ padding: "3px 6px", fontSize: 10, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color: !fin(r.chg) || r.chg === 0 ? DIM : (r.chg > 0) === (r.good > 0) ? GREEN : RED }}>{fmtChg(r.chg, r.unit)}</td>
                <td style={{ padding: "3px 6px", textAlign: "center" }}><Spark values={r.spark} color={c} /></td>
                <td style={{ padding: "3px 6px", textAlign: "center" }}><div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}><PctBar pct={r.pct} good={r.good} tone={r.tone} /><span style={{ fontSize: 9, color: DIM, fontFamily: fonts.mono, width: 22, textAlign: "right" }}>{fin(r.pct) ? `p${r.pct}` : ""}</span></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Score({ name, s }) {
  const c = s ? TONE[s.tone] : SLATE;
  return (
    <div style={{ flex: "1 1 150px", minWidth: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={label}>{name}</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: fonts.heading, letterSpacing: -0.6, lineHeight: 1 }}>{s ? s.score : "…"}</span>
      </div>
      <div style={{ position: "relative", height: 5, borderRadius: 3, marginTop: 5, background: "linear-gradient(90deg, #f87171 0%, #fbbf24 50%, #4ade80 100%)", opacity: 0.85 }}>
        {s && <div style={{ position: "absolute", left: `calc(${s.score}% - 4px)`, top: -3, width: 8, height: 11, borderRadius: 2, background: "#f8fafc", border: `1.5px solid ${c}` }} />}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: fonts.heading, marginTop: 6, lineHeight: 1.2 }}>{s?.label || "loading"}</div>
    </div>
  );
}

function VerdictCard({ s, extra }) {
  if (!s) return null;
  const c = TONE[s.tone];
  return (
    <div style={{ ...card, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: c }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: c, fontFamily: fonts.heading, letterSpacing: -0.3 }}>{s.label}</div>
      <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.5 }}>{s.why}</div>
      {s.up && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
          {s.up.map(x => <span key={x} style={{ fontSize: 9, fontFamily: fonts.mono, color: GREEN, background: "rgba(74,222,128,0.1)", borderRadius: 4, padding: "2px 6px" }}>▲ {x}</span>)}
          {s.down.map(x => <span key={x} style={{ fontSize: 9, fontFamily: fonts.mono, color: RED, background: "rgba(248,113,113,0.1)", borderRadius: 4, padding: "2px 6px" }}>▼ {x}</span>)}
        </div>
      )}
      {extra}
    </div>
  );
}

// Growth × inflation quadrant, compact (path from /api/macro-dashboard)
function Quadrant({ path }) {
  if (!path?.length) return null;
  const W = 220, Hh = 150, pl = 26, pr = 8, pt = 14, pb = 22, gw = W - pl - pr, gh = Hh - pt - pb;
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x = g => pl + ((cl(g, -2, 6) + 2) / 8) * gw, y = i => pt + (1 - cl(i, 0, 6) / 6) * gh;
  const last = path[path.length - 1];
  const q = last.growth >= 2 ? (last.inflation >= 2.5 ? "Overheating" : "Goldilocks") : last.inflation >= 2.5 ? "Stagflation" : "Recessionary";
  const qc = q === "Goldilocks" ? GREEN : q === "Overheating" ? AMBER : q === "Stagflation" ? RED : SLATE;
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={label}>Regime</span><span style={{ fontSize: 11, fontWeight: 700, color: qc, fontFamily: fonts.heading }}>{q}</span></div>
      <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" style={{ display: "block" }}>
        <rect x={pl} y={pt} width={gw} height={gh} fill="none" stroke="rgba(255,255,255,0.08)" />
        <line x1={x(2)} y1={pt} x2={x(2)} y2={pt + gh} stroke="rgba(148,163,184,0.3)" strokeDasharray="3 3" /><line x1={pl} y1={y(2.5)} x2={pl + gw} y2={y(2.5)} stroke="rgba(148,163,184,0.3)" strokeDasharray="3 3" />
        <text x={pl + 4} y={pt + 9} fontSize="7.5" fill={RED} fontFamily="monospace">Stagflation</text><text x={pl + gw - 4} y={pt + 9} fontSize="7.5" fill={AMBER} fontFamily="monospace" textAnchor="end">Overheating</text>
        <text x={pl + 4} y={pt + gh - 4} fontSize="7.5" fill={SLATE} fontFamily="monospace">Recession</text><text x={pl + gw - 4} y={pt + gh - 4} fontSize="7.5" fill={GREEN} fontFamily="monospace" textAnchor="end">Goldilocks</text>
        <polyline points={path.map(p => `${x(p.growth)},${y(p.inflation)}`).join(" ")} fill="none" stroke={INDIGO} strokeWidth="1" opacity="0.5" />
        {path.map((p, i) => <circle key={p.d} cx={x(p.growth)} cy={y(p.inflation)} r={i === path.length - 1 ? 4.5 : 2} fill={i === path.length - 1 ? INDIGO : "rgba(129,140,248,0.45)"} stroke={i === path.length - 1 ? "#f1f5f9" : "none"} strokeWidth="1.2" />)}
        <text x={pl + gw / 2} y={Hh - 5} fontSize="7.5" fill={DIM} fontFamily="monospace" textAnchor="middle">real GDP growth →</text>
        <text x={8} y={pt + gh / 2} fontSize="7.5" fill={DIM} fontFamily="monospace" textAnchor="middle" transform={`rotate(-90 8 ${pt + gh / 2})`}>CPI →</text>
      </svg>
      <div style={note}>{last.d.slice(0, 7)}: growth {last.growth.toFixed(1)}%, CPI {last.inflation.toFixed(1)}% · trail {path.length} quarters</div>
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
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };

function UsPulseTab({ go }) {
  const [d, setD] = useState(null);
  const [m, setM] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetch("/api/us-pulse").then(r => r.json()).then(x => (x && !x.error ? setD(x) : setErr(x?.error || "unavailable"))).catch(e => setErr(e.message));
    fetch("/api/macro-dashboard").then(r => r.json()).then(x => { if (x && !x.error) setM(x); }).catch(() => {});
  }, []);
  if (err) return <div style={{ ...card, color: RED, fontFamily: fonts.mono, fontSize: 12 }}>U.S. Pulse unavailable: {err}</div>;
  if (!d) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading the pulse (50 FRED series — about 30 seconds the first time, then cached)…</div>;
  const c = m?.computed || {};
  const rows = g => d.rows.filter(r => r.group === g);
  const oc = TONE[d.overall.tone];
  const realChip = (t, v) => fin(v) ? <span style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "3px 8px" }}>{t} <strong style={{ color: v > 0 ? GREEN : RED }}>{sgn(v)}{Math.abs(v).toFixed(2)}pp</strong></span> : null;
  const Section = ({ title, sub, board, right }) => (<>
    <SH>{title}</SH>
    {sub && <div style={{ ...note, marginTop: -8, marginBottom: 8 }}>{sub}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      {board}
      <div style={{ display: "grid", gap: 12 }}>{right}</div>
    </div>
  </>);

  return (<>
    {/* header: regime · three scores · quadrant · real rates */}
    <div style={{ ...card, padding: "14px 18px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 18, alignItems: "start" }}>
      <div>
        <div style={label}>U.S. economy · pulse</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: oc, fontFamily: fonts.heading, letterSpacing: -0.7, lineHeight: 1.1, marginTop: 4 }}>{d.overall.label}</div>
        <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>{d.overall.sentence}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>{realChip("real policy rate", c.realFFR)}{realChip("real 10Y", c.real10Y)}{realChip("real wages", c.realWages)}</div>
        <div style={{ ...note, marginTop: 8 }}>{d.coverage} indicators · FRED · refreshed {new Date(d.updated).toLocaleString()} · click any row to drill in</div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Score name="Leading" s={d.scores.lead} /><Score name="Consumer" s={d.scores.consumer} /><Score name="Debt" s={d.scores.debt} />
      </div>
      <Quadrant path={c.regimePath} />
    </div>

    <Section title="Leading Indicators — Where Is the Cycle Going?" sub="Ordered like the Conference Board's index: labor, orders, housing, sentiment, financial. Percentiles rank today within the last ten years; the tone uses the thresholds that have mattered historically."
      board={<SignalBoard rows={rows("lead")} go={go} />}
      right={<>
        {chartBox("Leading diffusion — share of indicators improving over six months (%)",
          <ResponsiveContainer width="100%" height={170}><LineChart data={d.charts.diffusion} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tick={axis} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tip} formatter={v => [`${v}%`, "improving"]} /><ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} /><ReferenceLine y={35} stroke={RED} strokeDasharray="2 3" strokeOpacity={0.5} />
            <Line type="monotone" dataKey="v" stroke={INDIGO} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>,
          "Breadth, not level: recessions start when fewer than about a third of leading indicators are still improving (red line), and expansions re-broaden from there.")}
        <VerdictCard s={d.scores.lead} />
      </>} />

    <Section title="Consumer Health — Can the Household Keep Carrying the Economy?" sub="Income, spending, saving and the cost of credit; delinquencies and the debt-service ratio are the stress gauges."
      board={<SignalBoard rows={rows("consumer")} go={go} />}
      right={<>
        {chartBox("The consumer engine — real income vs real spending (YoY %) and the saving rate",
          <ResponsiveContainer width="100%" height={190}><ComposedChart data={d.charts.consumer} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} domain={[-8, 16]} allowDataOverflow tickFormatter={v => `${v}%`} /><YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [`${Number(v).toFixed(1)}%`, n]} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" /><ReferenceLine yAxisId="l" y={0} stroke="#94a3b8" strokeOpacity={0.5} />
            <Area yAxisId="r" type="monotone" dataKey="saving" name="Saving rate (right)" stroke={CYAN} fill={CYAN} fillOpacity={0.08} strokeWidth={1} dot={false} isAnimationActive={false} />
            <Line yAxisId="l" type="monotone" dataKey="income" name="Real income YoY" stroke={GREEN} strokeWidth={1.8} dot={false} isAnimationActive={false} /><Line yAxisId="l" type="monotone" dataKey="spending" name="Real spending YoY" stroke={INDIGO} strokeWidth={1.8} dot={false} isAnimationActive={false} />
          </ComposedChart></ResponsiveContainer>,
          "Spending above income is borrowed time: it runs on a falling saving rate and rising card balances. The 2020–21 spike is the stimulus; the axis is clipped to keep the rest readable.")}
        <VerdictCard s={d.scores.consumer} />
      </>} />

    <Section title="Debt Picture — Who Owes What, and Is Credit Still Flowing?" sub="Burden (sovereign, household, corporate leverage and the interest squeeze) and stress (what markets and banks are charging and tolerating)."
      board={<SignalBoard rows={rows("debt")} go={go} />}
      right={<>
        {chartBox("Debt as % of GDP — federal, household, corporate",
          <ResponsiveContainer width="100%" height={160}><LineChart data={d.charts.debt} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [`${Number(v).toFixed(1)}%`, n]} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" />
            <Line type="monotone" dataKey="federal" name="Federal" stroke={RED} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="household" name="Household" stroke={GREEN} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="corporate" name="Corporate" stroke={AMBER} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer>,
          "The leverage migrated: households and companies deleveraged after 2008 while the sovereign absorbed it. That is why credit spreads can be calm while the fiscal numbers are not.")}
        {chartBox("Federal interest squeeze — interest as % of receipts and the effective rate on the debt",
          <ResponsiveContainer width="100%" height={140}><ComposedChart data={d.charts.interest} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} /><YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [`${Number(v).toFixed(2)}%`, n]} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" />
            <Line yAxisId="l" type="monotone" dataKey="interestToReceipts" name="Interest / receipts" stroke={RED} strokeWidth={2} dot={false} isAnimationActive={false} /><Line yAxisId="r" type="monotone" dataKey="effRate" name="Effective rate (right)" stroke={AMBER} strokeWidth={1.4} dot={false} isAnimationActive={false} />
          </ComposedChart></ResponsiveContainer>,
          "The effective rate keeps rising as 1–2% debt matures into 4% debt, so the interest share climbs even if yields go nowhere.")}
        <VerdictCard s={d.scores.debt} extra={fin(d.scores.debt.burden) && <div style={{ ...note, marginTop: 6 }}>burden score {d.scores.debt.burden} · stress score {d.scores.debt.stress} (100 = healthiest)</div>} />
      </>} />

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How to read it.</strong> The three scores are 0–100 health readings: Leading blends the diffusion (breadth of improvement) with the tone of each indicator; Consumer and Debt average their indicators&apos; tones, where green counts 100, amber 50, red 0. Tones come from the thresholds that have mattered historically, not from percentiles alone, because a yield curve at a low percentile can still be positive and a spread at a low percentile is a comfort, not a warning. The percentile bars show where today sits in the last ten years; the 6-month change shows momentum. For an investor the sequence to watch is leading → consumer → credit: leading indicators turn first, the consumer holds until the labor market cracks, and credit stress arrives last but does the damage.
    </InfoBox>
  </>);
}

export default UsPulseTab;
