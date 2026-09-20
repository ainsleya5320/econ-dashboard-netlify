import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

// ============================================================================
// BANKRUPTCY — the insolvency cycle, Seattle first.
//   1. W.D. Washington: the live docket (Chapter 11 petitions as they land in
//      Seattle and Tacoma), the named Chapter 11 list for the last six months,
//      and the official quarterly series since 2010.
//   2. The tracked districts side by side — the West Coast, plus W.D. Texas
//      and S.D. New York, which back the Austin and New York municipality pages.
//   3. National: official filings by chapter (the credit-stress gauges that lead
//      them live on the Banks view of the same Credit tab).
//   4. Public-company bankruptcies from EDGAR 8-K Item 1.03.
// Data: /api/bankruptcy (server/bankruptcy.js). Official counts are U.S. Courts
// Table F-2 Quarterly; the docket lists are the courts' own CM/ECF feeds and
// CourtListener. Only the F-2 numbers are complete counts.
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
const pc = (v, dp = 0) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}%` : "—");
const num = (v, dp = 0) => (fin(v) ? v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp }) : "—");
const k = v => (!fin(v) ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}k` : `${v}`);
const fq = q => (q ? `${q.slice(0, 4)}Q${Math.ceil(+q.slice(5, 7) / 3)}` : "—");
const upBad = v => (!fin(v) || v === 0 ? SLATE : v > 0 ? RED : GREEN);
const COURT_COLOR = { wawb: INDIGO, waeb: "#a78bfa", orb: GREEN, canb: CYAN, caeb: "#38bdf8", cacb: ORANGE, casb: AMBER, txwb: "#f472b6", nysb: "#facc15" };

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
    <div style={{ flex: "1 1 150px", minWidth: 150 }}>
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
function PctBar({ pct, tone }) {
  if (!fin(pct)) return <span style={{ color: DIM, fontSize: 10 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ position: "relative", flex: 1, minWidth: 40, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}><div style={{ position: "absolute", left: `calc(${pct}% - 2px)`, top: -2, width: 4, height: 8, borderRadius: 1, background: TONE[tone] || SLATE }} /></div>
      <span style={{ fontSize: 9, color: DIM, fontFamily: fonts.mono, width: 22, textAlign: "right" }}>p{pct}</span>
    </div>
  );
}
const toneOf = (pct, dir = 1) => { if (!fin(pct)) return "slate"; const f = dir > 0 ? 100 - pct : pct; return f >= 60 ? "green" : f >= 35 ? "amber" : "red"; };
const Pill = ({ children, color = SLATE }) => <span style={{ fontSize: 8.5, fontFamily: fonts.mono, color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 5px", marginLeft: 6, verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</span>;
const A = ({ href, children, color = "#c7d2fe" }) => (href ? <a href={href} target="_blank" rel="noopener" style={{ color, textDecoration: "none" }}>{children}</a> : children);

export default function BankruptcyTab() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [court, setCourt] = useState("wawb");
  const [listMode, setListMode] = useState("entities");
  useEffect(() => { fetch("/api/bankruptcy").then(r => r.json()).then(x => { if (x.error) setErr(x.error); else setD(x); }).catch(e => setErr(String(e))); }, []);

  const distChart = useMemo(() => {
    if (!d) return [];
    const byQ = new Map();
    for (const c of d.courts) for (const r of d.districts[c.district] || []) { if (r.q < "2015-01-01") continue; const row = byQ.get(r.q) || { q: r.q }; row[c.id] = r.bizCh11; byQ.set(r.q, row); }
    return [...byQ.values()].sort((a, b) => a.q.localeCompare(b.q));
  }, [d]);

  if (err) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Could not load the bankruptcy tracker: {err}</div>;
  if (!d) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading the courts (the first build pulls sixteen years of quarterly tables from uscourts.gov — up to two minutes, then cached)…</div>;

  const H = d.headline, S = d.scores, NL = d.national.latest;
  const home = d.board.find(b => b.id === d.home) || d.board[0];
  const sel = d.board.find(b => b.id === court) || home;
  const selRows = d.districts[sel.district] || [];
  const F = Object.fromEntries(d.fred.map(r => [r.id, r]));
  const liveCases = (d.live.ch11Recent || []).filter(c => c.court === court);
  const recentCases = (d.recent?.[court]?.cases || []).filter(c => listMode === "all" || c.entity);
  const chips = [
    ["filings, trailing yr", k(NL?.t4)], ["yoy", pc(NL?.yoy, 1)], ["business ch.11 / qtr", num(NL?.bizCh11)],
    ["W.D. Wash. trailing yr", num(home?.t4)], ["W.D. Wash. ch.11 / yr", num(home?.bizCh11T4)],
    ["biz-loan delinquency", fin(F.DRBLACBS?.v) ? `${F.DRBLACBS.v}%` : "—"], ["HY spread", fin(F.BAMLH0A0HYM2?.v) ? `${F.BAMLH0A0HYM2.v.toFixed(2)}%` : "—"],
  ];
  const natChart = d.national.rows.map(r => ({ q: r.q, "Chapter 7": r.ch7, "Chapter 13": r.ch13, "Chapter 11": r.ch11, bizCh11: r.bizCh11 }));
  const homeChart = selRows.map(r => ({ q: r.q, total: r.total, bizCh11: r.bizCh11, ch11: r.ch11 }));
  const fredLine = (id, name, color, w = 1.5) => <Line key={id} type="monotone" data={d.fredSeries[id]} dataKey="v" name={name} stroke={color} strokeWidth={w} dot={false} isAnimationActive={false} />;

  return (<>
    {/* ── header ───────────────────────────────────────────────────────── */}
    <div style={{ ...card, padding: "14px 18px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 18, alignItems: "start" }}>
      <div>
        <div style={label}>Bankruptcy · the insolvency cycle, Seattle first</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: H.color, fontFamily: fonts.heading, letterSpacing: -0.7, lineHeight: 1.1, marginTop: 4 }}>{H.label}</div>
        <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>{H.why}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>{chips.map(([t, v]) => <span key={t} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "3px 8px" }}>{t} <strong style={{ color: "var(--text-primary)" }}>{v}</strong></span>)}</div>
        <div style={{ ...note, marginTop: 8 }}>Official counts through {fq(NL?.q)} (U.S. Courts F-2, {d.national.quartersLoaded} quarters since {fq(d.national.since)}) · live dockets refreshed {new Date(d.updated).toLocaleString()} · docket archive {d.live.daysArchived} day{d.live.daysArchived === 1 ? "" : "s"} since {d.live.firstDay}</div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><Score name="Filings (national)" s={S.filings} /><Score name="Bank credit stress" s={S.credit} /><Score name="W.D. Washington" s={S.local} /></div>
    </div>

    {/* ── Seattle first ────────────────────────────────────────────────── */}
    <SH>{sel.name} — {sel.cities}</SH>
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: -6, marginBottom: 10, alignItems: "center" }}>
      {d.board.map(b => <button key={b.id} onClick={() => setCourt(b.id)} style={{ padding: "3px 9px", borderRadius: 999, cursor: "pointer", background: court === b.id ? `${COURT_COLOR[b.id]}22` : "rgba(255,255,255,0.03)", border: `1px solid ${court === b.id ? COURT_COLOR[b.id] : "rgba(255,255,255,0.08)"}`, color: court === b.id ? "#e2e8f0" : "#64748b", fontFamily: fonts.mono, fontSize: 10, whiteSpace: "nowrap" }}>{b.name}</button>)}
      <span style={{ ...note, marginLeft: 6 }}>pick a court · Seattle and Tacoma are the default</span>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div style={label}>Live docket · new petitions{sel.feedOk ? "" : " · feed unavailable this refresh"}</div>
            <div style={{ fontSize: 10, fontFamily: fonts.mono, color: SLATE }}>last 7 days: <strong style={{ color: "#e2e8f0" }}>{sel.live7?.ch11 ?? 0}</strong> ch.11 · {sel.live7?.ch7 ?? 0} ch.7 · {sel.live7?.ch13 ?? 0} ch.13 &nbsp;|&nbsp; 30 days: <strong style={{ color: "#e2e8f0" }}>{sel.live30?.ch11 ?? 0}</strong> ch.11 · {sel.live30?.ch7 ?? 0} ch.7 · {sel.live30?.ch13 ?? 0} ch.13</div>
          </div>
          {liveCases.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
              <thead><tr>{th("Filed", "left")}{th("Debtor", "left")}{th("Case", "left")}{th("Office", "left")}</tr></thead>
              <tbody>{liveCases.slice(0, 25).map(c => (
                <tr key={c.court + c.no} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }}>
                  <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: DIM, whiteSpace: "nowrap" }}>{c.day}</td>
                  <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", fontWeight: c.entity ? 700 : 400 }}><A href={c.link}>{c.name}</A>{c.entity ? <Pill color={INDIGO}>business</Pill> : null}{c.involuntary ? <Pill color={RED}>involuntary</Pill> : null}</td>
                  <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE, whiteSpace: "nowrap" }}>{c.no}</td>
                  <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE, whiteSpace: "nowrap" }}>{c.office || "—"}</td>
                </tr>))}</tbody>
            </table>
          ) : <div style={{ ...note, marginTop: 6 }}>No Chapter 11 petitions captured on this court&apos;s feed yet. The feed shows the last ~24 hours of docket activity and the dashboard archives it each time it runs, so the list fills in from {d.live.firstDay}; the six-month list below comes from CourtListener and is already populated.</div>}
          <div style={{ ...note, marginTop: 6 }}>Source: the court&apos;s own CM/ECF RSS feed ({d.live.feedSize?.[court] ?? 0} docket entries this refresh), filtered to voluntary and involuntary petitions and de-duplicated by case number. Links open the PACER docket (login required). &quot;Business&quot; is a name heuristic — LLCs, Incs, Corps — not the clerk&apos;s classification.</div>
        </div>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div style={label}>Chapter 11 cases, last six months · CourtListener{fin(d.recent?.[court]?.count) ? ` · ${d.recent[court].count} on record` : ""}</div>
            <div style={{ display: "flex", gap: 4 }}>{[["entities", "businesses"], ["all", "all debtors"]].map(([m, t]) => <button key={m} onClick={() => setListMode(m)} style={{ padding: "2px 8px", borderRadius: 6, border: `1px solid ${listMode === m ? INDIGO : "rgba(255,255,255,0.08)"}`, background: listMode === m ? "rgba(129,140,248,0.15)" : "transparent", color: listMode === m ? "#e2e8f0" : "#64748b", fontFamily: fonts.mono, fontSize: 9.5, cursor: "pointer" }}>{t}</button>)}</div>
          </div>
          {recentCases.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
              <thead><tr>{th("Filed", "left")}{th("Debtor", "left")}{th("Case", "left")}{th("Status", "left")}</tr></thead>
              <tbody>{recentCases.slice(0, 40).map(c => (
                <tr key={c.no + c.filed} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }}>
                  <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: DIM, whiteSpace: "nowrap" }}>{c.filed}</td>
                  <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", fontWeight: c.entity ? 700 : 400, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><A href={c.url}>{c.name}</A></td>
                  <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE, whiteSpace: "nowrap" }}>{c.no}</td>
                  <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: c.terminated ? DIM : GREEN, whiteSpace: "nowrap" }}>{c.terminated ? `closed ${c.terminated}` : "open"}</td>
                </tr>))}</tbody>
            </table>
          ) : <div style={{ ...note, marginTop: 6 }}>Nothing returned for this court in the window.</div>}
          <div style={{ ...note, marginTop: 6 }}>CourtListener (Free Law Project) ingests the court feeds continuously; it holds roughly half to two-thirds of the official Chapter 11 count, so read this as the named list, not the tally. Links open the free RECAP docket. Official tally for {sel.district}: {num(sel.ch11)} Chapter 11 cases in {fq(sel.q)}, {num(sel.bizCh11)} of them business.</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {chartBox(`${sel.district} — filings per quarter (all chapters) and business Chapter 11, since ${fq(homeChart[0]?.q)}`,
          <ResponsiveContainer width="100%" height={200}><AreaChart data={homeChart} margin={{ top: 6, right: 6, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="q" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={34} axisLine={false} tickLine={false} /><YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={k} width={40} /><YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={tip} labelFormatter={fq} formatter={(v, n) => [num(v), n === "total" ? "All filings" : n === "bizCh11" ? "Business ch.11" : "All ch.11"]} />
            <Area yAxisId="l" type="monotone" dataKey="total" stroke={COURT_COLOR[court]} fill={COURT_COLOR[court]} fillOpacity={0.15} strokeWidth={1.6} isAnimationActive={false} />
            <Line yAxisId="r" type="monotone" dataKey="bizCh11" stroke={AMBER} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </AreaChart></ResponsiveContainer>,
          `Left axis: all chapters (the household cycle). Right axis: business Chapter 11 (the corporate one) — ${num(sel.bizCh11T4)} in the trailing year, p${sel.bizCh11Pct} of the period since ${d.national.since.slice(0, 4)}, vs ${num(sel.t4)} total filings (p${sel.t4Pct}; the high in that window was ${num(sel.peakT4)}).`)}
        <VerdictCard title="W.D. Washington" s={S.local} />
        <div style={card}>
          <div style={label}>How to read the local picture</div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.55 }}>Three layers with three latencies. The <strong style={{ color: "#cbd5e1" }}>live docket</strong> is same-day and names the debtor, but only what the court posted in the last day. <strong style={{ color: "#cbd5e1" }}>CourtListener</strong> keeps the names for six months with partial coverage. The <strong style={{ color: "#cbd5e1" }}>official quarterly table</strong> is complete and classifies business vs consumer, but lands about two months after the quarter ends. When the three disagree on direction, the newest is right about timing and the oldest is right about level.</div>
        </div>
      </div>
    </div>

    {/* ── West Coast board ─────────────────────────────────────────────── */}
    <SH>The Tracked Districts — Official Counts</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      <div style={{ ...card, padding: "6px 8px", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{th("Court", "left")}{th(`Filings ${fq(home?.q)}`)}{th("Filings yoy")}{th(`Trailing yr vs ${d.national.since.slice(0, 4)}+`, "left")}{th("Biz ch.11 qtr")}{th("Ch.11 yoy")}{th("Live 30d ch.11")}{th("24 qtrs", "center")}</tr></thead>
          <tbody>{d.board.map(b => (
            <tr key={b.id} onClick={() => setCourt(b.id)} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)", cursor: "pointer", background: court === b.id ? "rgba(129,140,248,0.06)" : "transparent" }}>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", whiteSpace: "nowrap" }}><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: TONE[toneOf(b.t4Pct)], marginRight: 7, verticalAlign: "middle" }} /><strong>{b.name}</strong><span style={{ color: DIM, marginLeft: 6, fontSize: 9 }}>{b.cities}</span></td>
              {td(num(b.total), "var(--text-primary)", { fontWeight: 700 })}{td(pc(b.yoy, 1), upBad(b.yoy))}
              <td style={{ padding: "4px 6px", minWidth: 90 }}><PctBar pct={b.t4Pct} tone={toneOf(b.t4Pct)} /></td>
              {td(num(b.bizCh11))}{td(pc(b.bizCh11Yoy, 0), upBad(b.bizCh11Yoy))}{td(b.live30?.ch11 ?? 0, b.feedOk ? "#cbd5e1" : DIM)}
              <td style={{ padding: "2px 6px", textAlign: "center" }}><Spark values={b.spark} color={COURT_COLOR[b.id]} /></td>
            </tr>))}</tbody>
        </table>
        <div style={{ ...note, marginTop: 6 }}>The seven West Coast districts, plus W.D. Texas and S.D. New York, which back the Austin and New York pages on the Municipalities tab. Tone marks the trailing-year total against each district&apos;s own range since {d.national.since.slice(0, 4)} (the U.S. Courts spreadsheets before that are a legacy format): green is the quiet end. Click a row to switch the docket panels above. Live counts accumulate only while the dashboard has been running.</div>
      </div>
      {chartBox("Business Chapter 11 filings per quarter by tracked district, since 2015",
        <ResponsiveContainer width="100%" height={220}><BarChart data={distChart} margin={{ top: 6, right: 6, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="q" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={34} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tip} labelFormatter={fq} formatter={(v, n) => [num(v), d.courts.find(c => c.id === n)?.name || n]} />
          <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono }} formatter={n => d.courts.find(c => c.id === n)?.district || n} />
          {d.courts.map(c => <Bar key={c.id} dataKey={c.id} stackId="w" fill={COURT_COLOR[c.id]} fillOpacity={0.85} isAnimationActive={false} />)}
        </BarChart></ResponsiveContainer>,
        "Central California alone is usually a third of the West Coast's business reorganizations, and S.D. New York carries the large corporate cases that file in Manhattan regardless of where the company sits. The stack is the corporate distress cycle for these districts; the household cycle is ten times larger and lives in Chapters 7 and 13.")}
    </div>

    {/* ── national ─────────────────────────────────────────────────────── */}
    <SH>National — Official Filings by Chapter</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      {chartBox(`Cases commenced per quarter by chapter, since ${fq(natChart[0]?.q)} · business Chapter 11 on the right axis`,
        <ResponsiveContainer width="100%" height={220}><AreaChart data={natChart} margin={{ top: 6, right: 6, bottom: 0, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="q" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={34} axisLine={false} tickLine={false} /><YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={k} width={44} /><YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={k} width={36} />
          <Tooltip contentStyle={tip} labelFormatter={fq} formatter={(v, n) => [num(v), n === "bizCh11" ? "Business ch.11" : n]} />
          <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono }} formatter={n => (n === "bizCh11" ? "Business ch.11 (right)" : n)} />
          <Area yAxisId="l" type="monotone" dataKey="Chapter 7" stackId="1" stroke={INDIGO} fill={INDIGO} fillOpacity={0.4} strokeWidth={0.8} isAnimationActive={false} />
          <Area yAxisId="l" type="monotone" dataKey="Chapter 13" stackId="1" stroke={CYAN} fill={CYAN} fillOpacity={0.35} strokeWidth={0.8} isAnimationActive={false} />
          <Area yAxisId="l" type="monotone" dataKey="Chapter 11" stackId="1" stroke={AMBER} fill={AMBER} fillOpacity={0.6} strokeWidth={0.8} isAnimationActive={false} />
          <Line yAxisId="r" type="monotone" dataKey="bizCh11" stroke={RED} strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </AreaChart></ResponsiveContainer>,
        `${k(Math.max(...d.national.rows.map(r => r.t4).filter(fin)))} a year at the top of this window and a low under the pandemic stimulus and foreclosure moratoria; ${NL ? `${k(NL.t4)} in the trailing year, ${pc(NL.yoy, 1)} year on year.` : ""} The 2010 crisis peak, 1.6M, sits outside the readable spreadsheets.`)}
      <div style={{ display: "grid", gap: 12 }}>
        <VerdictCard title="Filings (national)" s={S.filings} />
        <VerdictCard title="Bank credit stress" s={S.credit} />
        <div style={{ ...note, padding: "0 4px" }}>The delinquency and charge-off gauges behind the credit-stress score are on the Banks view of this tab, where they belong with loan growth and provisions; the score here reads the same series.</div>
      </div>
    </div>

    {/* ── public companies ─────────────────────────────────────────────── */}
    {d.public && (<>
      <SH>Public-Company Bankruptcies — EDGAR 8-K Item 1.03, Last Six Months</SH>
      <div style={{ ...card, padding: "6px 8px", marginBottom: 14, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", padding: "4px 6px" }}>
          <div style={label}>{d.public.n} filings since {d.public.since} · {d.public.tracked} headquartered in {(d.public.states || []).join(", ")}</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{th("Filed", "left")}{th("Company", "left")}{th("Ticker", "left")}{th("HQ", "left")}{th("SIC")}</tr></thead>
          <tbody>{d.public.list.slice(0, 60).map((r, i) => (
            <tr key={r.name + r.date + i} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)", background: r.tracked ? "rgba(129,140,248,0.06)" : "transparent" }}>
              <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: DIM, whiteSpace: "nowrap" }}>{r.date}</td>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", fontWeight: r.tracked ? 700 : 400, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><A href={r.url}>{r.name}</A>{r.tracked ? <Pill color={INDIGO}>{r.state}</Pill> : null}</td>
              <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE }}>{r.ticker || "—"}</td>
              <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: r.tracked ? "#c7d2fe" : SLATE }}>{r.state || "—"}</td>
              {td(r.sic || "—", DIM)}
            </tr>))}</tbody>
        </table>
        <div style={{ ...note, padding: "6px 6px 2px" }}>Item 1.03 is the 8-K line a registrant must file on entering bankruptcy or receivership; the list is every such filing in the window, de-duplicated by company and date, linked to the filing index. Public companies are a sliver of the count and most of the dollars.</div>
      </div>
    </>)}

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>Sources and what each can and cannot say.</strong> The only complete counts on this page are the U.S. Courts F-2 quarterly tables — cases commenced by district and chapter, with the clerk&apos;s business/nonbusiness classification — and they arrive roughly two months after quarter end. FRED carries no filings series at all, which is why the official tables are fetched directly. The live docket is each court&apos;s CM/ECF RSS feed: the last ~24 hours of entries, filtered to petitions and archived by this dashboard every time it runs, so the daily counts have gaps on days the app was closed. CourtListener holds the named Chapter 11 list for six months with partial coverage. EDGAR Item 1.03 catches public companies only. Bank delinquency and charge-off rates, the SLOOS tightening series and the high-yield spread are the leading gauges; filings are the lagging confirmation. The &quot;business&quot; pill on the docket lists is a name heuristic; the official tables use the court&apos;s own classification.
    </InfoBox>
  </>);
}
