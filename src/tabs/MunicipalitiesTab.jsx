import React, { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

// ============================================================================
// MUNICIPALITIES — one metro economy at a time, picked from the dropdown.
// Seattle is the default; San Francisco is the second city.
//   1. Labor: metro vs state vs US unemployment, the counties, payrolls by
//      sector, earnings, claims, Indeed postings.
//   2. Housing: prices (Case-Shiller, tiers, FHFA), rents, inventory, permits.
//   3. Cost of living: metro CPI and rent CPI vs US, gasoline, price parity.
//   4. Business: the district's bankruptcies, WARN layoffs, business formation.
//   5. Growth and income (annual), and the local majors vs the S&P 500.
// Data: /api/municipality?city=<id> (server/municipalities.js). Monthly series
// lag one to two months, the annual ones a year; the WARN archive and the
// court docket accumulate from the day the tracker was switched on.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", PINK = "#f472b6";
const TONE = { green: GREEN, amber: AMBER, red: RED, slate: SLATE };
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const pc = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}%` : "—");
const pp = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}pp` : "—");
const num = (v, dp = 0) => (fin(v) ? v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp }) : "—");
const k = v => (!fin(v) ? "—" : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(Math.abs(v) >= 1e5 ? 0 : 1)}k` : `${Math.round(v)}`);
const ymd = d => (typeof d === "string" ? d.slice(0, 7) : "—");
const upGood = v => (!fin(v) || v === 0 ? SLATE : v > 0 ? GREEN : RED);

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
    <div style={{ flex: "1 1 140px", minWidth: 140 }}>
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
const th = (t, align = "right", key) => <th key={key || t} style={{ padding: "5px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{t}</th>;
const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;
const tdl = (v, extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", whiteSpace: "nowrap", ...extra }}>{v}</td>;
const Dot = ({ tone }) => <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: TONE[tone] || SLATE, marginRight: 7, verticalAlign: "middle", opacity: tone === "slate" ? 0.4 : 1 }} />;
const Pill = ({ children, color = SLATE }) => <span style={{ fontSize: 8.5, fontFamily: fonts.mono, color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 5px", marginLeft: 6, verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</span>;
const A = ({ href, children }) => (href ? <a href={href} target="_blank" rel="noopener" style={{ color: "#c7d2fe", textDecoration: "none" }}>{children}</a> : children);
const toneRel = (v, good = 1, scale = 1) => (!fin(v) ? "slate" : v * good > scale ? "green" : v * good < -scale ? "red" : "amber");
const yr4 = x => (typeof x === "string" ? x.slice(0, 4) : "");
const XA = p => <XAxis dataKey="d" tick={axis} tickFormatter={yr4} minTickGap={34} axisLine={false} tickLine={false} {...p} />;
const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />;

// While a metro builds for the first time (about fifty throttled FRED series,
// two to three minutes) this reports what is happening and which cities are
// already warm, so an empty page is never mistaken for a broken one.
function BuildNotice({ cityId, cities }) {
  const [status, setStatus] = useState(null);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const poll = () => fetch("/api/municipality-status").then(r => r.json()).then(x => setStatus(x.cities || null)).catch(() => {});
    poll();
    const a = setInterval(poll, 5000), b = setInterval(() => setSecs(s => s + 1), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  const me = status?.find(c => c.id === cityId);
  const warm = (status || []).filter(c => c.warm && c.id !== cityId);
  const mm = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const name = cities.find(c => c.id === cityId)?.name || cityId;
  return (
    <div style={{ ...card, padding: "22px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3 }}>
        Building {name} — {mm}
      </div>
      <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.6, maxWidth: 560, margin: "6px auto 0" }}>
        About fifty FRED series behind a shared rate limit, plus the metro&apos;s housing feed, WARN notices and a dozen quotes. First open of a city takes two to three minutes; after that it is cached for three hours and loads instantly.
        {me && !me.building && !me.warm ? " Queued behind another build." : ""}
      </div>
      {warm.length > 0 && (
        <div style={{ fontSize: 10, color: DIM, fontFamily: fonts.mono, marginTop: 10 }}>
          Ready now: {warm.map(c => c.name).join(" · ")} — switch with the dropdown above while this finishes.
        </div>
      )}
    </div>
  );
}

const FALLBACK_CITIES = [{ id: "seattle", name: "Seattle", msa: "Seattle-Tacoma-Bellevue" }, { id: "sf", name: "San Francisco", msa: "San Francisco-Oakland-Fremont" }];

export default function MunicipalitiesTab({ go }) {
  const [cityId, setCityId] = useState("seattle");
  const [byCity, setByCity] = useState({});
  const [warnScope, setWarnScope] = useState("metro");
  const [err, setErr] = useState(null);
  const pending = useRef({});

  useEffect(() => {
    if (byCity[cityId] || pending.current[cityId]) return;
    pending.current[cityId] = true;
    setErr(null);
  // Netlify fork: addressed as a baked file path rather than a query string, so
  // it works identically in `npm run preview` and on Netlify. _redirects cannot
  // be exercised locally, so no data path is allowed to depend on it.
    fetch(`/api/municipality/${cityId}`)
      .then(r => r.json())
      .then(x => { if (x.error) setErr(x.error); else setByCity(prev => ({ ...prev, [cityId]: x })); })
      .catch(e => setErr(String(e)))
      .finally(() => { pending.current[cityId] = false; });
  }, [cityId, byCity]);

  const d = byCity[cityId];
  const cityList = d?.cities || Object.values(byCity)[0]?.cities || FALLBACK_CITIES;
  const sectorBars = useMemo(() => (d ? d.labor.payrolls.sectors.map(s => ({ name: s.label, yoy: s.yoy, share: s.share })) : []), [d]);

  const Picker = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={label}>Municipality</span>
      <select value={cityId} onChange={e => setCityId(e.target.value)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(129,140,248,0.4)", background: "rgba(129,140,248,0.10)", color: "#e2e8f0", fontSize: 12, fontWeight: 600, fontFamily: fonts.heading, minWidth: 210, cursor: "pointer" }}>
        {cityList.map(c => <option key={c.id} value={c.id} style={{ background: "#0f172a" }}>{c.name} — {c.msa}</option>)}
      </select>
      {d && <span style={note}>{d.city.msa} MSA · CBSA {d.city.cbsa} · {d.city.court}</span>}
    </div>
  );

  if (err && !d) return (<>{Picker}<div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Could not load {cityId}: {err}</div></>);
  if (!d) return (<>{Picker}<BuildNotice cityId={cityId} cities={cityList} /></>);

  const H = d.headline, S = d.scores, L = d.labor, U = L.unemployment, P = L.payrolls, E = L.earnings, J = L.postings, C = L.claims;
  const Hs = d.housing, M = Hs.metro, cs = M?.caseShiller, Z = M?.zillow, LS = M?.listing, I = Hs.inventory, Pm = Hs.permits;
  const Pr = d.prices, B = d.business, W = B.warn, G = d.giants, CT = d.city;
  const accent = CT.colour || INDIGO;
  const chips = [
    ["unemployment", fin(U.msa) ? `${U.msa}%` : "—"], ["payrolls yoy", pc(P.yoy)], ["postings vs Feb-20", fin(J.metro) ? `${J.metro}` : "—"],
    ["Case-Shiller yoy", pc(cs?.yoy)], ["rent yoy", pc(Z?.zoriYoy)], ["metro CPI", pc(Pr.cpi.metro)],
    ...(W ? [["WARN 90d", `${num(W.local90.workers)} workers`]] : []), ...(B.bk ? [["biz ch.11 / yr", num(B.bk.bizCh11T4)]] : []),
  ];
  const countyRows = U.counties.filter(c => fin(c.v)).map(c => ({ label: `Unemployment, ${c.name} County`, v: c.v, unit: "%", d: c.d, chg: null, tone: "slate", note: "not seasonally adjusted" }));
  const laborRows = [
    { label: "Unemployment, metro (SA)", v: U.msa, unit: "%", d: U.msaD, chg: U.msaChg1y, chgKind: "pp", tone: toneRel(-(U.msaChg1y ?? 0), 1, 0.2), spark: U.spark, note: `${U.msaPct}th percentile of its own history; NSA ${U.msaNsa}%` },
    ...countyRows,
    { label: `Unemployment, ${CT.stateName} / US`, v: fin(U.state) && fin(U.us) ? `${U.state.toFixed(1)}% / ${U.us.toFixed(1)}%` : null, unit: "", d: U.usD, chg: null, tone: "slate", raw: true },
    { label: "Nonfarm payrolls, metro", v: fin(P.total) ? P.total / 1e3 : null, unit: "M", dp: 3, d: P.d, chg: P.yoy, chgKind: "%", tone: toneRel(P.yoy, 1, 0.5), spark: P.spark, note: `${pc(P.sinceFeb2020)} vs Feb 2020; US ${pc(P.yoyUs)} yoy` },
    { label: "Labor force, metro", v: fin(L.laborForce.v) ? L.laborForce.v / 1e6 : null, unit: "M", dp: 3, d: L.laborForce.d, chg: L.laborForce.yoy, chgKind: "%", tone: toneRel(L.laborForce.yoy, 1, 0.5) },
    { label: "Avg hourly earnings, private", v: E.ahe, unit: "$", dp: 2, d: E.d, chg: E.aheYoy, chgKind: "%", tone: toneRel((E.aheYoy ?? 0) - (E.aheUsYoy ?? 0), 1, 0.5), spark: E.spark, note: `${pc(E.premium)} above US ($${E.aheUs}); US wages ${pc(E.aheUsYoy)} yoy` },
    { label: `${CT.stateName} initial claims, 4-wk avg`, v: C.state4w, unit: "", d: C.d, chg: C.state4wYoy, chgKind: "%", tone: toneRel(-(C.state4wYoy ?? 0), 1, 5), note: "weekly, state level" },
    { label: "Indeed postings, metro", v: J.metro, unit: "", dp: 1, d: J.d, chg: J.metroChg1y, chgKind: "%", tone: toneRel(J.metroChg1y, 1, 3), note: `Feb 2020 = 100; US ${J.us} (${pc(J.usChg1y)} yoy); 30-day ${pc(J.metroChg30)}` },
  ].filter(r => r.v != null);
  const housingRows = [
    { label: "Case-Shiller, yoy", v: cs?.yoy, unit: "%", d: cs?.asOf, tone: toneRel(cs?.yoy, 1, 1), note: `US 20-city ${pc(cs?.yoyUs)}; ${pc(cs?.fromPeak)} from peak` },
    { label: "High tier / low tier, yoy", v: fin(Hs.tiers.high) ? `${pc(Hs.tiers.high)} / ${pc(Hs.tiers.low)}` : null, unit: "", d: Hs.tiers.d, tone: "slate", raw: true, note: "the bottom third of the market leads turns" },
    { label: "FHFA all-transactions, yoy", v: Hs.fhfa.yoy, unit: "%", d: Hs.fhfa.d, tone: toneRel(Hs.fhfa.yoy, 1, 1), note: `${Hs.fhfa.note}; ${pc(Hs.fhfa.fromPeak)} from peak` },
    { label: "Zillow home value (ZHVI)", v: Z?.zhvi, unit: "$", d: Z?.d, chg: Z?.zhviYoy, chgKind: "%", tone: toneRel(Z?.zhviYoy, 1, 1) },
    { label: "Zillow rent (ZORI)", v: Z?.zori, unit: "$", d: Z?.d, chg: Z?.zoriYoy, chgKind: "%", tone: toneRel(Z?.zoriYoy, 1, 1), note: `price-to-rent ${Z?.p2r}×, gross yield ${Z?.yield}%` },
    { label: "Median list price", v: I.medList, unit: "$", d: I.d, chg: I.medListYoy, chgKind: "%", tone: toneRel(I.medListYoy, 1, 1), note: LS ? `Redfin sale price $${num(LS.price)} (${pc(LS.priceYoy)}), ${LS.reducedShare}% of listings cut` : "" },
    { label: "Active listings", v: I.active, unit: "", d: I.d, chg: I.activeYoy, chgKind: "%", tone: toneRel(-(I.activeYoy ?? 0), 1, 5), note: "rising inventory = softening" },
    { label: "New listings", v: I.newl, unit: "", d: I.d, chg: I.newYoy, chgKind: "%", tone: "slate" },
    { label: "Median days on market", v: I.dom, unit: " days", d: I.d, chg: fin(I.dom) && fin(I.dom1y) ? I.dom - I.dom1y : null, chgKind: "d", tone: toneRel(-((I.dom ?? 0) - (I.dom1y ?? 0)), 1, 3) },
    { label: "Permits, 12 months", v: Pm.m12, unit: " units", d: Pm.d, chg: Pm.m12Yoy, chgKind: "%", tone: toneRel(Pm.m12Yoy, 1, 5), note: `${Pm.pct}th percentile since 1988` },
  ].filter(r => r.v != null);
  const priceRows = [
    { label: `${Pr.cpi.label} CPI, all items yoy`, v: Pr.cpi.metro, unit: "%", d: Pr.cpi.d, tone: toneRel(-(Pr.cpi.metro ?? 0) + 2.5, 1, 0.5), note: `US ${pc(Pr.cpi.usAtSameMonth)} the same month; ${Pr.cpi.note}` },
    { label: `${Pr.rent.label} rent CPI, yoy`, v: Pr.rent.metro, unit: "%", d: Pr.rent.d, tone: toneRel(-(Pr.rent.metro ?? 0) + 3, 1, 0.5), note: `US ${pc(Pr.rent.usAtSameMonth)}` },
    { label: Pr.gas.label, v: Pr.gas.metro, unit: "$", dp: 2, d: Pr.gas.d, chg: Pr.gas.metroYoy, chgKind: "%", tone: toneRel(-(Pr.gas.metroYoy ?? 0), 1, 5), note: `US $${Pr.gas.us}; ${pc(Pr.gas.premium)} premium` },
    { label: "Regional price parity", v: Pr.rpp.v, unit: "", dp: 1, d: Pr.rpp.d, tone: "slate", note: "BEA, US = 100 — the metro's overall price level" },
  ].filter(r => r.v != null);
  const fmtV = r => (r.raw ? r.v : r.unit === "$" ? `$${num(r.v, r.dp ?? 0)}` : `${num(r.v, r.dp ?? (r.unit === "%" ? 1 : 0))}${r.unit}`);
  const fmtChg = r => (!fin(r.chg) ? "—" : r.chgKind === "pp" ? pp(r.chg) : r.chgKind === "d" ? `${sgn(r.chg)}${Math.abs(r.chg)}d` : pc(r.chg));
  const Board = ({ rows, title }) => (
    <div style={{ ...card, padding: "6px 8px", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{th(title, "left")}{th("Latest")}{th("As of")}{th("1-yr Δ")}{th("3 yrs", "center")}</tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.label} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }} title={r.note || ""}>
            {tdl(<><Dot tone={r.tone} />{r.label}{r.note ? <span style={{ color: DIM, marginLeft: 6, fontSize: 9 }}>{r.note.length > 46 ? r.note.slice(0, 44) + "…" : r.note}</span> : null}</>)}
            {td(fmtV(r), "var(--text-primary)", { fontWeight: 700 })}{td(ymd(r.d), DIM)}{td(fmtChg(r), r.tone === "slate" ? SLATE : TONE[r.tone])}
            <td style={{ padding: "2px 6px", textAlign: "center" }}><Spark values={r.spark} color={TONE[r.tone] === SLATE ? accent : TONE[r.tone]} /></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
  const loading = pending.current[cityId];

  return (<>
    {Picker}

    {/* ── header ───────────────────────────────────────────────────────── */}
    <div style={{ ...card, padding: "14px 18px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 18, alignItems: "start", opacity: loading ? 0.55 : 1, transition: "opacity 0.2s" }}>
      <div>
        <div style={label}>{CT.msa} · the {CT.region} economy</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: H.color, fontFamily: fonts.heading, letterSpacing: -0.7, lineHeight: 1.1, marginTop: 4 }}>{H.label}</div>
        <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>{H.why}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>{chips.map(([t, v]) => <span key={t} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "3px 8px" }}>{t} <strong style={{ color: "var(--text-primary)" }}>{v}</strong></span>)}</div>
        <div style={{ ...note, marginTop: 8 }}>Labor through {ymd(U.msaD)} · housing through {ymd(I.d)} · postings through {J.d || "—"} · {W ? `WARN archive ${W.archived} notices since ${W.since || "today"} · ` : ""}refreshed {new Date(d.updated).toLocaleString()}</div>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}><Score name="Labor" s={S.labor} /><Score name="Housing" s={S.housing} /><Score name="Cost of living" s={S.prices} /><Score name="Business" s={S.business} /></div>
    </div>

    {/* ── labor ────────────────────────────────────────────────────────── */}
    <SH>Labor — Who Is Working, Where, and for How Much</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 12, marginBottom: 12, alignItems: "start" }}>
      <Board rows={laborRows} title="Labor market" />
      <div style={{ display: "grid", gap: 12 }}>
        {chartBox(`Unemployment rate — metro vs ${CT.stateName} vs US, since 2000`,
          <ResponsiveContainer width="100%" height={170}><LineChart data={U.series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            {grid}<XA /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [`${v}%`, n === "msa" ? `${CT.name} MSA` : n === "state" ? CT.stateName : "US"]} />
            <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono }} iconType="plainline" formatter={n => (n === "msa" ? `${CT.name} MSA` : n === "state" ? CT.stateName : "US")} />
            <Line type="monotone" dataKey="msa" stroke={accent} strokeWidth={1.9} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="state" stroke={CYAN} strokeWidth={1.1} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="us" stroke={SLATE} strokeWidth={1.1} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer>,
          `The metro normally tracks close to the nation; a local rate persistently above the US rate is the signal worth watching, and county rates below are not seasonally adjusted.`)}
        {chartBox("Indeed job postings — metro vs US, Feb 2020 = 100",
          <ResponsiveContainer width="100%" height={150}><LineChart data={J.series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            {grid}<XA /><YAxis tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [v, n === "metro" ? CT.name : "US"]} /><ReferenceLine y={100} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="metro" stroke={accent} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="us" stroke={SLATE} strokeWidth={1.1} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer>,
          `${J.source}. The metro reads ${fin(J.metro) ? J.metro : "—"} against ${J.us} nationally — the fastest read on local hiring there is, and the one that moved first in 2022.`)}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      {chartBox(`Payroll employment by sector — year-on-year change, ${ymd(P.d)}`,
        <ResponsiveContainer width="100%" height={220}><BarChart data={sectorBars} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 10 }}>
          {grid}<XAxis type="number" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} /><YAxis type="category" dataKey="name" tick={{ ...axis, fontSize: 9 }} width={130} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tip} formatter={(v, n, p) => [`${pc(v)} · ${p.payload.share}% of jobs`, "yoy"]} /><ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" />
          <Bar dataKey="yoy" isAnimationActive={false}>{sectorBars.map(s => <Cell key={s.name} fill={s.yoy >= 0 ? GREEN : RED} fillOpacity={0.8} />)}</Bar>
        </BarChart></ResponsiveContainer>,
        `Total ${pc(P.yoy)} against US ${pc(P.yoyUs)}. ${P.sectors[0]?.label} is the largest sector at ${P.sectors[0]?.share}% of jobs; information is ${P.sectors.find(s => s.key === "INFO")?.share}% here against about 2% nationally.`)}
      <div style={{ display: "grid", gap: 12 }}>
        {chartBox("Payroll growth, yoy — metro vs US",
          <ResponsiveContainer width="100%" height={130}><LineChart data={P.series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            {grid}<XA /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={[-8, 8]} allowDataOverflow />
            <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [`${v}%`, n === "msa" ? `${CT.name} MSA` : "US"]} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
            <Line type="monotone" dataKey="msa" stroke={accent} strokeWidth={1.7} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="us" stroke={SLATE} strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer>)}
        <VerdictCard title="Labor" s={S.labor} />
      </div>
    </div>

    {/* ── housing ──────────────────────────────────────────────────────── */}
    <SH>Housing — Prices, Rents, Inventory, Permits</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      <Board rows={housingRows} title="Housing" />
      <div style={{ display: "grid", gap: 12 }}>
        {cs?.series?.length ? chartBox(`Case-Shiller — ${CT.name} vs US 20-city, indexed (since ${cs.since})`,
          <ResponsiveContainer width="100%" height={150}><LineChart data={cs.series} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
            {grid}<XA /><YAxis tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [v, n === "metro" ? CT.name : "US 20-city"]} />
            <Line type="monotone" dataKey="metro" stroke={accent} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="us" stroke={SLATE} strokeWidth={1.1} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer>,
          `${CT.name} ${pc(cs.yoy)} against US ${pc(cs.yoyUs)} year on year. Coastal metros swing wider than the national index in both directions.`) : null}
        {chartBox("Inventory — active and new listings, median days on market",
          <ResponsiveContainer width="100%" height={150}><AreaChart data={I.series} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
            {grid}<XA /><YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={k} width={40} /><YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={28} />
            <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [n === "dom" ? `${v} days` : num(v), { active: "Active listings", newl: "New listings", dom: "Days on market" }[n]]} />
            <Area yAxisId="l" type="monotone" dataKey="active" stroke={AMBER} fill={AMBER} fillOpacity={0.18} strokeWidth={1.5} isAnimationActive={false} /><Line yAxisId="l" type="monotone" dataKey="newl" stroke={CYAN} strokeWidth={1.1} dot={false} isAnimationActive={false} /><Line yAxisId="r" type="monotone" dataKey="dom" stroke={SLATE} strokeWidth={1.1} dot={false} isAnimationActive={false} />
          </AreaChart></ResponsiveContainer>,
          `Realtor.com, since 2016. Active listings ${pc(I.activeYoy)} year on year and ${I.dom} days on market against ${I.dom1y} — inventory turns before prices do.`)}
        <VerdictCard title="Housing" s={S.housing} />
      </div>
    </div>

    {/* ── prices ───────────────────────────────────────────────────────── */}
    <SH>Cost of Living — Local Prices Against the Nation</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      <Board rows={priceRows} title="Prices" />
      {chartBox(`CPI, all items — ${Pr.cpi.label.toLowerCase()} vs US, % yoy since 2000`,
        <ResponsiveContainer width="100%" height={180}><LineChart data={Pr.cpi.series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          {grid}<XA /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [`${v}%`, n === "metro" ? Pr.cpi.label : "US"]} /><ReferenceLine y={2} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="metro" stroke={accent} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="us" stroke={SLATE} strokeWidth={1.1} dot={false} connectNulls isAnimationActive={false} />
        </LineChart></ResponsiveContainer>,
        `${CT.name} ${pc(Pr.cpi.metro)} against US ${pc(Pr.cpi.usAtSameMonth)}. Shelter is about a third of the local basket, so the rent line usually explains the gap.`)}
      <div style={{ display: "grid", gap: 12 }}>
        {chartBox(`Rent CPI — ${Pr.rent.label.toLowerCase()} vs US, % yoy`,
          <ResponsiveContainer width="100%" height={120}><LineChart data={Pr.rent.series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            {grid}<XA /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [`${v}%`, n === "metro" ? CT.name : "US"]} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
            <Line type="monotone" dataKey="metro" stroke={PINK} strokeWidth={1.7} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="us" stroke={SLATE} strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer>)}
        <VerdictCard title="Cost of living" s={S.prices} />
      </div>
    </div>

    {/* ── business ─────────────────────────────────────────────────────── */}
    <SH>Business Conditions — Layoffs, Insolvencies, Formation</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 12 }}>
        {W ? (<div style={{ ...card, padding: "8px 10px", overflowX: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={label}>WARN notices · {CT.stateName}</div>
              {[["metro", CT.region], ["state", "all " + CT.state]].map(([m, t]) => <button key={m} onClick={() => setWarnScope(m)} style={{ padding: "2px 8px", borderRadius: 6, border: "1px solid " + (warnScope === m ? accent : "rgba(255,255,255,0.08)"), background: warnScope === m ? accent + "22" : "transparent", color: warnScope === m ? "#e2e8f0" : "#64748b", fontFamily: fonts.mono, fontSize: 9.5, cursor: "pointer" }}>{t}</button>)}
            </div>
            <div style={{ fontSize: 10, fontFamily: fonts.mono, color: SLATE }}>90 days: <strong style={{ color: "#e2e8f0" }}>{num(W.local90.workers)}</strong> {CT.region} workers in {W.local90.notices} notices{W.local90prev.workers ? ` (prior 90: ${num(W.local90prev.workers)})` : ""} · statewide {num(W.state90.workers)}</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
            <thead><tr>{th("Received", "left")}{th("Employer", "left")}{th("Location", "left")}{th("Workers")}{th("Kind", "left")}{th("Effective", "left")}</tr></thead>
            <tbody>{W.notices.filter(n => warnScope === "state" || n.local).slice(0, 22).map(n => (
              <tr key={n.company + n.received + n.location} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)", background: n.local ? `${accent}12` : "transparent" }}>
                {td(n.received, DIM, { textAlign: "left" })}{tdl(<>{n.company}{n.local ? <Pill color={accent}>{CT.region}</Pill> : n.statewide ? <Pill>statewide</Pill> : null}</>, { fontWeight: n.local ? 700 : 400, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" })}
                <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.location}</td>
                {td(num(n.workers), "var(--text-primary)", { fontWeight: 700 })}{td(n.kind === "Closure" ? "closure" : "layoff", n.kind === "Closure" ? RED : SLATE, { textAlign: "left" })}{td(n.start || "—", DIM, { textAlign: "left" })}
              </tr>))}</tbody>
          </table>
          <div style={{ ...note, marginTop: 6 }}>{W.source}. Archived here ({W.archived} notices so far){W.local90prev.notices ? ", so the 90-day comparisons sharpen as history builds" : ", and the source's own window is why the prior-90-day comparison is still empty"}. Showing {warnScope === "state" ? "every notice in the state" : CT.region + " notices only"}.{W.stale ? ` This feed last advanced ${W.lagDays} days ago (newest notice ${W.newest}), so the 90-day window is empty and does not feed the business score.` : ""}</div>
        </div>) : (
          <div style={{ ...card }}>
            <div style={label}>WARN notices · {CT.stateName}</div>
            <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.55 }}>{CT.stateName} publishes no machine-readable WARN feed with worker counts — the labor department posts notices as web pages without headcounts, and its public listing has not advanced since 2024. Layoffs therefore do not feed this metro&apos;s business score; the other two inputs still do.</div>
          </div>
        )}
        {B.bk && (
          <div style={{ ...card }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={label}>Bankruptcies · {B.bk.court}</div>
              {go && <button onClick={() => go("credit", "defaults")} style={{ padding: "2px 8px", borderRadius: 6, border: "1px solid rgba(129,140,248,0.35)", background: "rgba(129,140,248,0.12)", color: "#c7d2fe", fontFamily: fonts.mono, fontSize: 9.5, cursor: "pointer" }}>open the tracker →</button>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: 8, marginTop: 8 }}>
              {[["Filings, latest qtr", num(B.bk.total), pc(B.bk.yoy) + " yoy"], ["Trailing year", num(B.bk.t4), `p${B.bk.t4Pct} of the decade`], ["Business ch.11, qtr", num(B.bk.bizCh11), `${num(B.bk.bizCh11T4)} in a year, p${B.bk.bizCh11Pct}`], ["Live docket, 30d", `${B.bk.live30?.ch11 ?? 0} ch.11`, `${B.bk.live30?.ch7 ?? 0} ch.7 · ${B.bk.live30?.ch13 ?? 0} ch.13`]].map(([t, v, sub]) => (
                <div key={t}><div style={label}>{t}</div><div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.4, marginTop: 2 }}>{v}</div><div style={note}>{sub}</div></div>))}
            </div>
            {(B.bk.liveCh11.length || B.bk.recent.length) ? <div style={{ ...note, marginTop: 8 }}><strong style={{ color: "#cbd5e1" }}>Recent business Chapter 11s:</strong> {[...B.bk.liveCh11.map(c => c.name), ...B.bk.recent.map(c => c.name)].filter((x, i, a) => a.indexOf(x) === i).slice(0, 10).join(" · ")}</div> : null}
            <div style={{ ...note, marginTop: 6 }}>The district is wider than the metro — it is the bankruptcy court&apos;s territory, not the CBSA.</div>
          </div>
        )}
        {!B.bk && (
          <div style={{ ...card }}>
            <div style={label}>Bankruptcies · {CT.court}</div>
            <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.55 }}>The bankruptcy tracker does not carry {CT.court} yet — adding it is one entry in its court list. Business formation below and, where a state publishes one, WARN notices carry this metro&apos;s business score on their own.</div>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {chartBox(`Business applications, ${CT.stateName} — monthly since 2010`,
          <ResponsiveContainer width="100%" height={140}><AreaChart data={B.apps.series} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
            {grid}<XA /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={k} />
            <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={v => [num(v), "applications"]} />
            <Area type="monotone" dataKey="v" stroke={GREEN} fill={GREEN} fillOpacity={0.15} strokeWidth={1.4} isAnimationActive={false} />
          </AreaChart></ResponsiveContainer>,
          `Census Business Formation Statistics. ${num(B.apps.m12)}/month on a 12-month average, ${pc(B.apps.m12Yoy)} — the birth side of the ledger the bankruptcy tracker keeps the death side of.`)}
        {W && W.monthly.length > 2 ? chartBox(`WARN-notice workers by month received — ${CT.region} vs rest of ${CT.stateName}`,
          <ResponsiveContainer width="100%" height={130}><BarChart data={W.monthly} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
            {grid}<XAxis dataKey="d" tick={axis} tickFormatter={x => (typeof x === "string" ? x.slice(2, 7) : "")} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={k} />
            <Tooltip contentStyle={tip} labelFormatter={ymd} formatter={(v, n) => [num(v), n === "local" ? CT.region : `Rest of ${CT.state}`]} />
            <Bar dataKey="local" stackId="w" fill={accent} fillOpacity={0.85} isAnimationActive={false} /><Bar dataKey="other" stackId="w" fill={SLATE} fillOpacity={0.5} isAnimationActive={false} />
          </BarChart></ResponsiveContainer>) : null}
        <VerdictCard title="Business" s={S.business} />
      </div>
    </div>

    {/* ── growth & the local majors ────────────────────────────────────── */}
    <SH>Growth, Income, and the {CT.giantsName}</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
      <div style={{ ...card, padding: "6px 8px", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{th("Annual (lagged a year)", "left")}{th("Latest")}{th("Year")}{th("Δ yr")}{th("5-yr CAGR")}{th("15 yrs", "center")}</tr></thead>
          <tbody>{d.growth.map(g => {
            const rate = g.unit === "%" || g.unit === "ratio" || g.unit === "index";
            return (
              <tr key={g.key} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }} title={g.note}>
                {tdl(g.label)}
                {td(g.unit === "$" ? `$${num(g.v)}` : g.unit === "$k" ? `$${k(g.v * 1e3)}` : g.unit === "k" ? k(g.v * 1e3) : `${num(g.v, rate ? (g.unit === "ratio" ? 2 : 1) : 2)}${g.unit === "%" ? "%" : ""}`, "var(--text-primary)", { fontWeight: 700 })}
                {td(g.d?.slice(0, 4), DIM)}
                {td(rate ? (fin(g.yoy) ? `${sgn(g.yoy)}${Math.abs(g.yoy).toFixed(g.unit === "%" ? 1 : 2)}` : "—") : pc(g.yoy), rate ? SLATE : upGood(g.yoy))}
                {td(fin(g.cagr5) ? pc(g.cagr5) : "—", SLATE)}
                <td style={{ padding: "2px 6px", textAlign: "center" }}><Spark values={g.spark} color={accent} /></td>
              </tr>);
          })}</tbody>
        </table>
        <div style={{ ...note, marginTop: 6 }}>BEA and Census county series. Regional price parity of {Pr.rpp.v} means a dollar here buys what {fin(Pr.rpp.v) ? ((100 / Pr.rpp.v) * 100).toFixed(0) : "—"} cents buys in the average metro.</div>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ ...card, padding: "6px 8px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{th(CT.giantsName, "left")}{th("Price")}{th("Day")}{th("YTD")}{th("1 yr")}{th("52 wks", "center")}</tr></thead>
            <tbody>{G.rows.map(g => (
              <tr key={g.sym} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)", background: g.sym === "SPY" ? "rgba(255,255,255,0.03)" : "transparent" }}>
                {tdl(<><strong>{g.sym}</strong><span style={{ color: DIM, marginLeft: 6, fontSize: 9 }}>{g.name}{g.city ? ` · ${g.city}` : ""}</span></>)}
                {td(fin(g.price) ? `$${num(g.price, 2)}` : "—", "var(--text-primary)")}{td(pc(g.chgPct, 2), upGood(g.chgPct))}{td(pc(g.ytd), upGood(g.ytd))}{td(pc(g.yr1), upGood(g.yr1))}
                <td style={{ padding: "2px 6px", textAlign: "center" }}><Spark values={g.spark} color={g.sym === "SPY" ? SLATE : fin(g.yr1) && g.yr1 >= 0 ? GREEN : RED} /></td>
              </tr>))}</tbody>
          </table>
          <div style={{ ...note, marginTop: 6 }}>Equal-weighted, the twelve are {pc(G.ewYtd)} year to date and {pc(G.ewYr)} over a year, against {pc(G.spyYtd)} and {pc(G.spyYr)} for the S&P 500. {CT.giantsNote}</div>
        </div>
        {chartBox(`${CT.giantsName}, equal-weight, vs SPY — one year, rebased to 100`,
          <ResponsiveContainer width="100%" height={130}><LineChart data={G.index} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            {grid}<XAxis dataKey="d" tick={axis} tickFormatter={x => (typeof x === "string" ? x.slice(2, 7) : "")} minTickGap={30} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [v, n === "local" ? CT.giantsName : "SPY"]} /><ReferenceLine y={100} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="local" stroke={accent} strokeWidth={1.8} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="spy" stroke={SLATE} strokeWidth={1.1} dot={false} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>)}
      </div>
    </div>

    <InfoBox color={accent}>
      <strong style={{ color: "#cbd5e1" }}>Reading {CT.name}.</strong> {CT.blurb} The three fastest gauges on this page are Indeed postings (daily), WARN notices (filed weeks before the layoff takes effect) and the bankruptcy docket (same day); the BLS series arrive a month or two later and get revised; the BEA and Census annual series are already a year old on release. County unemployment rates are not seasonally adjusted, so compare them with the metro&apos;s NSA figure in the first row&apos;s note, not the headline. {W ? `The ${CT.region} flag on WARN rows is a name match on each notice's ${CT.state === "CA" ? "county" : CT.state === "TX" ? "county and city" : "location"} field. ` : ""}{B.bk ? "The bankruptcy court covers a wider territory than the metro." : ""}
    </InfoBox>
  </>);
}
