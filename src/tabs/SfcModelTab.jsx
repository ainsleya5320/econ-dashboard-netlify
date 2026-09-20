import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

// ============================================================================
// SFC MODEL — the stock-flow-consistent ledger (Layer 1, actual FRED data) and
// the four-layer simulation built on it (Layers 2-4, model output).
//
// The argument the page makes: Dalio's debt cycle, MMT's sectoral balances and
// the "AI is breaking the statistics" case are all claims about the same set of
// balance sheets, so they can be put in one ledger and made to disagree
// precisely. The three scores are the three schools; the crux table at the
// bottom is where they actually part company.
//
// Data: /api/sfc (server/sfcModel.js reads data/sfc/*.json, written offline by
// `python run_sfc.py`). Scenario paths are model output, never forecasts.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee";
const TONE = { green: GREEN, amber: AMBER, red: RED, slate: SLATE };
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const num = (v, dp = 1) => (fin(v) ? v.toFixed(dp) : "—");
const dlt = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}` : "—");
const qtr = d => (d ? `${d.slice(0, 4)}Q${Math.floor(+d.slice(5, 7) / 3) + 1}` : "—");

// Fixed per scenario, so "baseline" is the same colour on every chart.
const SCEN_COLORS = {
  baseline: "#94a3b8", credit_boom: "#f87171", baseline_high_capital_mpc: "#c084fc",
  dark_output_captured: "#22d3ee", dark_output_passthrough: "#4ade80", dark_output_mixed: "#38bdf8",
  dark_output_fiscal_offset: "#a3e635", mosler_zirp_fiscal: "#fbbf24", rate_hike_300bp: "#fb923c",
  rate_hike_300bp_cost_channel: "#f97316", rate_hike_300bp_high_capital_mpc: "#e879f9", fiscal_dominance: "#ef4444",
};
const scenColor = n => SCEN_COLORS[n] || INDIGO;
const SCEN_LABEL = {
  baseline: "Baseline", credit_boom: "Credit boom", baseline_high_capital_mpc: "Baseline, high capital MPC",
  dark_output_captured: "Dark output — captured", dark_output_passthrough: "Dark output — passed through",
  dark_output_mixed: "Dark output — mixed", dark_output_fiscal_offset: "Dark output + fiscal offset",
  mosler_zirp_fiscal: "Mosler: ZIRP + fiscal", rate_hike_300bp: "Rate hike +300bp",
  rate_hike_300bp_cost_channel: "Rate hike + cost channel", rate_hike_300bp_high_capital_mpc: "Rate hike, high capital MPC",
  fiscal_dominance: "Fiscal dominance",
};
const METRIC_LABEL = {
  u_true: "True utilization", u_meas: "Measured utilization (what the CB sees)", inflation_yoy: "Inflation, % yoy",
  policy_rate: "Policy rate, %", debt_household: "Household debt, % GDP", debt_bottom50: "Bottom-50% debt, % GDP",
  debt_firms: "Firm debt, % GDP", debt_gov: "Government debt, % GDP", debt_total: "Total debt, % GDP",
  bal_gov: "Government balance, % GDP", bal_private: "Private balance, % GDP",
  gov_interest_pct_gdp: "Government interest paid, % GDP", wage_share: "Wage share, %",
  dsr_bottom: "Bottom-50% debt service, %", dsr_top: "Top-50% debt service, %",
  writeoffs_pct_gdp: "Loan write-offs, % GDP", real_gdp_meas: "Measured real GDP (index)",
  real_potential_true: "True potential output (index)", adoption: "AI adoption (0-1)",
  new_credit_pct_gdp: "New credit, % GDP", credit_supply: "Credit supply (index)",
  leverage_bottom: "Bottom-50% leverage target", income_bottom_real: "Bottom-50% real income",
  income_top_real: "Top-50% real income",
};
const CHART_GROUPS = [
  ["u_true", "u_meas"], ["inflation_yoy", "policy_rate"], ["debt_gov", "debt_household"],
];

function Spark({ values, color, w = 68, h = 18 }) {
  const v = (values || []).filter(fin);
  if (v.length < 3) return <svg width={w} height={h} />;
  const min = Math.min(...v), max = Math.max(...v), range = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${(1 - (x - min) / range) * (h - 4) + 2}`).join(" ");
  return <svg width={w} height={h} style={{ display: "block" }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" /></svg>;
}
function Score({ name, s }) {
  const c = s ? TONE[s.tone] : SLATE;
  return (
    <div style={{ flex: "1 1 160px", minWidth: 160 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={label}>{name}</span><span style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: fonts.heading, letterSpacing: -0.6, lineHeight: 1 }}>{s ? s.score : "…"}</span></div>
      <div style={{ position: "relative", height: 5, borderRadius: 3, marginTop: 5, background: "linear-gradient(90deg, #f87171 0%, #fbbf24 50%, #4ade80 100%)", opacity: 0.85 }}>{s && <div style={{ position: "absolute", left: `calc(${s.score}% - 4px)`, top: -3, width: 8, height: 11, borderRadius: 2, background: "#f8fafc", border: `1.5px solid ${c}` }} />}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: fonts.heading, marginTop: 6, lineHeight: 1.2 }}>{s?.label || "loading"}</div>
    </div>
  );
}
function VerdictCard({ title, s }) {
  const c = TONE[s.tone] || SLATE;
  return (
    <div style={{ ...card, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: c }} />
      <div style={label}>{title}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c, fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 3 }}>{s.label}</div>
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
const th = (t, align = "right") => <th key={t} style={{ padding: "5px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{t}</th>;
const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;

// percentile-of-own-history bar, same idiom as the other pulse boards
function PctBar({ pct, tone }) {
  if (!fin(pct)) return <span style={{ color: DIM, fontSize: 10 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ position: "relative", flex: 1, minWidth: 40, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
        <div style={{ position: "absolute", left: `calc(${pct}% - 2px)`, top: -2, width: 4, height: 8, borderRadius: 1, background: TONE[tone] || SLATE }} />
      </div>
      <span style={{ fontSize: 9, color: DIM, fontFamily: fonts.mono, width: 22, textAlign: "right" }}>p{pct}</span>
    </div>
  );
}

function Toggle({ on, color, children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, cursor: "pointer",
      background: on ? `${color}22` : "rgba(255,255,255,0.03)", border: `1px solid ${on ? color : "rgba(255,255,255,0.08)"}`,
      color: on ? "#e2e8f0" : "#64748b", fontFamily: fonts.mono, fontSize: 10, whiteSpace: "nowrap",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: on ? color : "#334155" }} />{children}
    </button>
  );
}

export default function SfcModelTab() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [metric, setMetric] = useState("u_true");
  const [picked, setPicked] = useState(["baseline", "credit_boom", "dark_output_mixed"]);

  useEffect(() => {
    fetch("/api/sfc").then(r => r.json()).then(x => { if (x.error) setErr(x.error); else setD(x); }).catch(e => setErr(String(e)));
  }, []);

  const scenRows = useMemo(() => {
    if (!d) return [];
    const byQ = new Map();
    for (const name of picked) {
      const s = d.scenarios.list.find(x => x.name === name);
      if (!s) continue;
      s.years.forEach((y, i) => {
        const row = byQ.get(y) || { year: y };
        row[name] = s.series[metric]?.[i] ?? null;
        byQ.set(y, row);
      });
    }
    return [...byQ.values()].sort((a, b) => a.year - b.year);
  }, [d, picked, metric]);

  const crux = useMemo(() => {
    if (!d?.crux) return null;
    const debts = [...new Set(d.crux.data.map(x => x.debt_gov))].sort((a, b) => a - b);
    const mpcs = [...new Set(d.crux.data.map(x => x.mpc_capital))].sort((a, b) => a - b);
    return { debts, mpcs, at: (m, g) => d.crux.data.find(x => x.mpc_capital === m && x.debt_gov === g) };
  }, [d]);

  if (err) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono, lineHeight: 1.6 }}>Could not load the SFC model: {err}.<br />The ledger and scenarios are built offline — run <code style={{ color: "#c7d2fe" }}>python run_sfc.py</code> in the repo root (needs <code style={{ color: "#c7d2fe" }}>pip install pandas numpy requests</code>) to regenerate <code style={{ color: "#c7d2fe" }}>data/sfc/*.json</code>.</div>;
  if (!d) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading the ledger and 12 scenarios…</div>;

  const H = d.headline, C = d.scenarios.calibration;
  const flat = Object.fromEntries(d.board.flatMap(g => g.rows.map(r => [r.id, r])));
  const at = id => flat[id]?.v;
  const chips = [
    ["credit gap", `${dlt(at("credit_gap"), 1)}pp`],
    ["federal debt", `${num(at("debt_federal"), 0)}%`],
    ["interest paid", `${num(at("fed_interest_pct_gdp"), 2)}% of GDP`],
    ["household DSR", `${num(at("household_dsr"), 1)}%`],
    ["private balance", `${dlt(at("bal_private"), 1)}%`],
    ["wage share", `${num(at("wage_share"), 1)}%`],
  ];
  const balNote = "Godley's identity is an accounting fact, not a theory: the three balances sum to zero. Read it as who is absorbing whose deficit — the private surplus since 2008 is the mirror of the federal deficit.";

  return (<>
    {/* ── header ───────────────────────────────────────────────────────── */}
    <div style={{ ...card, padding: "14px 18px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 18, alignItems: "start" }}>
      <div>
        <div style={label}>Stock-flow ledger · four-layer model</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: H.color, fontFamily: fonts.heading, letterSpacing: -0.7, lineHeight: 1.1, marginTop: 4 }}>{H.label}</div>
        <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>{H.why}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>{chips.map(([t, v]) => <span key={t} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "3px 8px" }}>{t} <strong style={{ color: "var(--text-primary)" }}>{v}</strong></span>)}</div>
        <div style={{ ...note, marginTop: 8 }}>Ledger {d.quarters} quarters, {qtr(d.since)}–{qtr(d.latest)} · balance sheets calibrated to {qtr(d.asOf)} (Z.1 lags the rate and labour series) · 12 scenarios × 40 years</div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Score name="Private credit (Dalio)" s={d.scores.credit} />
        <Score name="Interest channel (Mosler)" s={d.scores.interest} />
        <Score name="Measurement (dark output)" s={d.scores.measure} />
      </div>
    </div>

    {/* ── Layer 1: the ledger ──────────────────────────────────────────── */}
    <SH>Layer 1 — The Ledger, 46 Years of Balance Sheets</SH>
    <div style={{ ...note, marginTop: -8, marginBottom: 8 }}>Every row is FRED data, not model output: Z.1 financial accounts for the stocks, NIPA for the balances, the Distributional Financial Accounts for who holds what. Percentiles are against each series&apos; own history; tone marks the comfortable end, not the direction of travel.</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      <div style={{ ...card, padding: "6px 8px", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{th("Series", "left")}{th("Latest")}{th("As of")}{th("1-yr Δ")}{th("Range since start", "left")}{th("44 qtrs", "center")}</tr></thead>
          <tbody>
            {d.board.map(g => (
              <React.Fragment key={g.group}>
                <tr><td colSpan={6} style={{ padding: "8px 6px 3px", fontSize: 8.5, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>{g.group}</td></tr>
                {g.rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }} title={r.note ? `${r.note} (${r.n} observations from ${r.since}, range ${r.min} to ${r.max})` : `${r.n} observations from ${r.since}, range ${r.min} to ${r.max}`}>
                    <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: TONE[r.tone], marginRight: 7, verticalAlign: "middle", opacity: r.tone === "slate" ? 0.4 : 1 }} />{r.label.replace(/, % of GDP|, %$|, pp$/, "")}
                    </td>
                    {td(num(r.v, Math.abs(r.v) >= 100 ? 0 : Math.abs(r.v) >= 10 ? 1 : 2), "var(--text-primary)", { fontWeight: 700 })}
                    {td(qtr(r.d), DIM)}
                    {td(dlt(r.chg1y, Math.abs(r.chg1y ?? 0) >= 10 ? 0 : 1), r.dir === 0 || !fin(r.chg1y) ? SLATE : r.chg1y * r.dir > 0 ? RED : GREEN)}
                    <td style={{ padding: "4px 6px", minWidth: 90 }}><PctBar pct={r.pct} tone={r.tone} /></td>
                    <td style={{ padding: "2px 6px", textAlign: "center" }}><Spark values={r.spark} color={TONE[r.tone] === SLATE ? INDIGO : TONE[r.tone]} /></td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {chartBox("Sectoral balances, % of GDP — the Godley mirror",
          <ResponsiveContainer width="100%" height={168}><LineChart data={d.charts.balances} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="date" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={34} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tip} labelFormatter={qtr} formatter={(v, n) => [`${v}%`, n === "bal_gov" ? "Government" : n === "bal_private" ? "Private" : "Foreign"]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
            <Line type="monotone" dataKey="bal_gov" stroke={RED} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="bal_private" stroke={GREEN} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="bal_foreign" stroke={CYAN} strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer>, balNote)}
        {chartBox("BIS credit gap and debt-minus-income growth, pp",
          <ResponsiveContainer width="100%" height={150}><AreaChart data={d.charts.credit} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="date" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={34} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tip} labelFormatter={qtr} formatter={(v, n) => [`${v}pp`, n === "credit_gap" ? "Credit gap" : "Debt − income growth"]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
            <Area type="monotone" dataKey="credit_gap" stroke={AMBER} fill={AMBER} fillOpacity={0.18} strokeWidth={1.6} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="debt_minus_income_growth" stroke={INDIGO} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
          </AreaChart></ResponsiveContainer>,
          "The gap peaked at +9 before 2008 and reads −11 today: private credit is further below trend than at any point since the early 1990s. That is the deleveraging half of the Dalio long cycle, and the reason the private score is green while the public one is not.")}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      {chartBox("Debt by sector, % of GDP",
        <ResponsiveContainer width="100%" height={160}><LineChart data={d.charts.debt} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="date" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={34} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tip} labelFormatter={qtr} formatter={(v, n) => [`${v}%`, { debt_household: "Household", debt_business: "Business", debt_federal: "Federal", debt_financial: "Financial" }[n]]} />
          <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono }} iconType="plainline" formatter={n => ({ debt_household: "Household", debt_business: "Business", debt_federal: "Federal", debt_financial: "Financial" }[n])} />
          <Line type="monotone" dataKey="debt_household" stroke={GREEN} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="debt_business" stroke={AMBER} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="debt_federal" stroke={RED} strokeWidth={1.8} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="debt_financial" stroke={SLATE} strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>,
        "Household debt is 32 points below its 2008 peak; federal debt is at the top of its range. Financial-sector debt halving since 2008 is the shadow-banking unwind, and it double-counts credit, so it is excluded from the private aggregate.")}
      {chartBox("Federal interest paid vs the policy rate, %",
        <ResponsiveContainer width="100%" height={160}><LineChart data={d.charts.burden} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="date" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={34} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tip} labelFormatter={qtr} formatter={(v, n) => [`${v}%`, { fed_interest_pct_gdp: "Interest paid, % GDP", policy_rate: "Policy rate", ten_year: "10-year" }[n]]} />
          <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono }} iconType="plainline" formatter={n => ({ fed_interest_pct_gdp: "Interest, % GDP", policy_rate: "Policy rate", ten_year: "10-year" }[n])} />
          <Line type="monotone" dataKey="fed_interest_pct_gdp" stroke={AMBER} strokeWidth={1.9} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="policy_rate" stroke={INDIGO} strokeWidth={1.3} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="ten_year" stroke={CYAN} strokeWidth={1.1} dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>,
        "The 1980s paid more interest on far less debt; today's burden comes from the stock, not the rate. That distinction is the whole Mosler argument — and it is what makes the sign of the next hike genuinely uncertain.")}
      {chartBox("Dark-output proxies (2007 →)",
        <ResponsiveContainer width="100%" height={160}><LineChart data={d.charts.dark} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="date" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={30} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tip} labelFormatter={qtr} formatter={(v, n) => [`${v}pp`, { dark_output_signal: "Signal", productivity_yoy: "Productivity yoy", prof_services_ahe_yoy: "Prof. services wages", legal_emp_yoy: "Legal employment" }[n]]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
          <Line type="monotone" dataKey="dark_output_signal" stroke={CYAN} strokeWidth={1.9} dot={false} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="productivity_yoy" stroke={GREEN} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="legal_emp_yoy" stroke={SLATE} strokeWidth={1.1} dot={false} connectNulls isAnimationActive={false} />
        </LineChart></ResponsiveContainer>,
        "Professional-services wage growth minus legal-services employment growth: the \"fewer jobs at higher pay\" pattern. It spiked in 2009 for ordinary recession reasons, which is exactly why it is a proxy to corroborate, not a measure to trust.")}
    </div>

    {/* ── Layers 2-4: scenarios ────────────────────────────────────────── */}
    <SH>Layers 2–4 — The Model, Under Assumptions You Can Name</SH>
    <div style={{ ...note, marginTop: -8, marginBottom: 8 }}>Everything below is simulation, not data and not forecast. Two household groups, firms, banks with a capital target, a consolidated government and central bank, and a rest of the world holding bills. Balance-sheet identities are asserted every quarter — the sum of net financial assets across sectors must be zero — which is what makes the scenarios arguable rather than decorative. Calibrated to {qtr(d.asOf)}: household debt {num(C.debt_household_pct_gdp, 0)}% of GDP, federal {num(C.debt_federal_pct_gdp, 0)}%, wage share {num(C.wage_share * 100, 0)}%.</div>
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <span style={label}>Metric</span>
        <select value={metric} onChange={e => setMetric(e.target.value)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(129,140,248,0.35)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 10.5, fontFamily: fonts.mono, minWidth: 240 }}>
          {d.scenarios.metrics.map(m => <option key={m} value={m} style={{ background: "#0f172a" }}>{METRIC_LABEL[m] || m}</option>)}
        </select>
        <span style={{ ...note, marginLeft: "auto" }}>quick pairs:</span>
        {CHART_GROUPS.map(([a, b]) => <button key={a} onClick={() => setMetric(metric === a ? b : a)} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#94a3b8", fontFamily: fonts.mono, fontSize: 9.5, cursor: "pointer" }}>{(METRIC_LABEL[a] || a).split(" (")[0]} ↔ {(METRIC_LABEL[b] || b).split(" (")[0]}</button>)}
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
        {d.scenarios.list.map(s => (
          <Toggle key={s.name} on={picked.includes(s.name)} color={scenColor(s.name)} title={`${s.note}${s.divergedAt != null ? ` — diverges at quarter ${s.divergedAt}` : ""}`}
            onClick={() => setPicked(p => p.includes(s.name) ? p.filter(x => x !== s.name) : [...p, s.name])}>
            {SCEN_LABEL[s.name] || s.name}{s.divergedAt != null ? " ⚠" : ""}
          </Toggle>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={scenRows} margin={{ top: 8, right: 14, bottom: 4, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="year" type="number" domain={[0, "dataMax"]} tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}y`} minTickGap={28} />
          <YAxis tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={46} />
          <Tooltip contentStyle={tip} labelFormatter={v => `year ${v}`} formatter={(v, n) => [fin(v) ? v.toFixed(3) : "—", SCEN_LABEL[n] || n]} />
          {(metric.startsWith("bal") || metric === "inflation_yoy") && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />}
          {metric === "u_true" || metric === "u_meas" ? <ReferenceLine y={1} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" /> : null}
          {picked.map(n => <Line key={n} type="monotone" dataKey={n} stroke={scenColor(n)} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ ...label, marginTop: 6 }}>{METRIC_LABEL[metric] || metric}</div>
      <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
        {picked.map(n => { const s = d.scenarios.list.find(x => x.name === n); if (!s) return null; return (
          <div key={n} style={{ fontSize: 10, color: SLATE, fontFamily: fonts.mono, lineHeight: 1.5 }}>
            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: scenColor(n), marginRight: 6 }} />
            <strong style={{ color: "#cbd5e1" }}>{SCEN_LABEL[n] || n}</strong> — {s.note}
            {s.divergedAt != null && <span style={{ color: RED }}> Diverges at quarter {s.divergedAt}; the path stops there rather than reporting nonsense.</span>}
          </div>
        ); })}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      <VerdictCard title="Private credit (Dalio)" s={d.scores.credit} />
      <VerdictCard title="Interest channel (Mosler)" s={d.scores.interest} />
      <VerdictCard title="Measurement (dark output)" s={d.scores.measure} />
    </div>

    {/* ── the crux ─────────────────────────────────────────────────────── */}
    {crux && (<>
      <SH>The Crux — Does a Rate Hike Still Cool the Economy?</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
        <div style={{ ...card, padding: "8px 10px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
            <thead><tr>{th("MPC out of capital income", "left")}{crux.debts.map(g => th(`gov debt ${g}%`))}</tr></thead>
            <tbody>{crux.mpcs.map(m => (
              <tr key={m}>
                <td style={{ padding: "5px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", fontWeight: 700 }}>{m.toFixed(1)}</td>
                {crux.debts.map(g => {
                  const c = crux.at(m, g), v = c?.d_utilization;
                  const bg = c?.diverged ? "rgba(239,68,68,0.35)" : !fin(v) ? "transparent" : v < 0 ? `rgba(74,222,128,${Math.min(0.42, Math.abs(v) / 8)})` : `rgba(248,113,113,${Math.min(0.55, v / 4)})`;
                  return <td key={g} style={{ padding: "5px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", background: bg, color: c?.diverged ? "#fecaca" : !fin(v) ? DIM : v > 0 ? "#fecaca" : "#cbd5e1", borderRadius: 4 }}
                    title={c ? `${c.diverged ? "diverges" : `utilization ${dlt(v, 2)}pp, inflation ${dlt(c.d_inflation, 2)}pp`} over 12 quarters after a 3pp hike` : ""}>
                    {c?.diverged ? "explodes" : !fin(v) ? "—" : dlt(v, 2)}
                  </td>;
                })}
              </tr>
            ))}</tbody>
          </table>
          <div style={{ ...note, marginTop: 8 }}>Change in true utilization, percentage points, averaged over the 12 quarters after a 3pp policy-rate shock, each cell against its own calibrated baseline. <strong style={{ color: GREEN }}>Green = the hike cooled the economy</strong> (the conventional sign). <strong style={{ color: "#fecaca" }}>Red = it heated it</strong>, because the interest paid to bondholders outweighed the cost of credit. Rows: how much of each extra dollar of interest and dividends gets spent. Columns: government debt as a share of GDP.</div>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...card }}>
            <div style={label}>Why this is the crux</div>
            <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.6 }}>
              A rate rise does two opposite things. It raises the cost of credit, which is contractionary, and it raises the interest the government pays to whoever owns its debt, which is expansionary. Which one wins depends on the size of the debt and on how much of that interest income gets spent.
              <br /><br />At <strong style={{ color: "var(--text-primary)" }}>50% debt</strong> the conventional sign holds across the whole range — the credit channel always wins. At <strong style={{ color: "var(--text-primary)" }}>today&apos;s ~107%</strong> the sign flips once the propensity to consume out of capital income passes roughly <strong style={{ color: "var(--text-primary)" }}>0.5</strong>. At 150% it flips sooner and, at the top of the range, the model stops converging.
              <br /><br />So the disagreement between a conventional central banker and Mosler is not philosophical. It reduces to one number nobody has measured well: what share of interest and dividend income is spent rather than saved. The empirical literature on MPCs out of capital income is thin, which is precisely why this is worth putting on a dashboard rather than arguing about.
            </div>
          </div>
        </div>
      </div>
    </>)}

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>What this is, and what it is not.</strong> Layer 1 is an accounting ledger: Z.1, NIPA and the Distributional Financial Accounts, arranged so the sectoral balances sum to zero and the credit gap is the BIS definition. Trust it the way you trust the source data. Layers 2–4 are a small simulation calibrated to that ledger — demand-determined output, an endogenous credit cycle with write-offs above a debt-service threshold, an interest-income channel, and a central bank that sets policy off <em>measured</em> utilization while inflation responds to the true number. Scenario paths are what the model does under stated assumptions; they are arguments with the arithmetic checked, not predictions. Known limits, from the author&apos;s own README: the goods economy is closed (the rest of the world only holds bills), potential output is one aggregate number, there are two household groups rather than a population, there are no asset prices — and the credit-boom scenario settles into a limit cycle rather than a single bust, which is a known habit of accelerator models and the first thing to fix. Rebuild the whole thing with <code style={{ color: "#c7d2fe" }}>python run_sfc.py</code>.
    </InfoBox>
  </>);
}
