import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import { CHOROPLETH_METRICS, BUILD_COST_PER_SQFT } from "../lib/constants.js";
import MetroComparison from "./realEstate/MetroComparison.jsx";
import RefinancingView from "./realEstate/RefinancingView.jsx";
import { DEFAULT_PROPERTY } from "../lib/propertyAnalysis.js";
import "./realEstate/PropertyResearch.css";
import StateChoropleth from "../components/StateChoropleth.jsx";
import HousingSubTab, { HousingHealthPanel } from "./HousingSubTab.jsx";

// ============================================================================
// REAL ESTATE — fundamentals and fair value
// Organizing principle: every real-estate price is judged against four
// anchors — income (affordability / rent), replacement cost (Tobin's q),
// yield vs bonds (cap-rate spread), and supply/credit (vacancy, delinquency,
// construction, lending standards). Sub-tabs:
//   Fair Value    one 0–100 score per sector (the valuation anchors'
//                 percentiles averaged, archived daily by /api/re-composite),
//                 the verdict tiles, the anchors, REIT EBITDA yields by type
//   Residential   synthesis first: what would have to change (price or rate)
//                 to restore affordability, own-vs-rent, the mortgage lock-in
//                 gap (FHFA NMDB), the Redfin tape (sale-to-list, price
//                 drops, months of supply), the supply pipeline; the raw
//                 series live behind a fold
//   Commercial    price cycle, credit (delinquency + SLOOS lending
//                 standards), Kastle office attendance, construction, vacancy,
//                 replacement ratio, REIT enterprise EBITDA yields by property type
//   Metro         one metro at a time (Seattle first): Realtor.com listing
//                 flow, Case-Shiller vs the 20-city, unemployment, Zillow
//                 value/rent — plus every metro ranked on price-to-rent
//   State Map     prices (list and SALE), value (price-to-income, price-to-
//                 rent, build cost, land share), market tape (Redfin), vacancy
// Every panel wears its source and cadence; a print older than its cadence
// allows is flagged "lagged" rather than left to look wrong.
// What's NOT here, honestly: private-market cap rates and occupancy by
// property type (broker surveys, paywalled) and state-level foreclosures
// (ATTOM, paywalled) — CURATED_COMMERCIAL below is where hand-entered
// survey numbers go, in the same verify-and-extend pattern as the rest.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee";
const fin = v => v != null && isFinite(v);
const pc = (v, dp = 1) => (fin(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%` : "—");
const pc0 = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
const usd = v => (fin(v) ? (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(0)}K`) : "—");
const usd0 = v => (fin(v) ? `$${Math.round(v).toLocaleString()}` : "—");
const kk = v => (fin(v) ? `${Math.round(v).toLocaleString()}K` : "—");
const mon = d => (d ? (/^\d{4}Q\d$/.test(d) ? d : new Date(d.slice(0, 10) + "T00:00:00").toLocaleString("en-US", { month: "short", year: "numeric" })) : "—");
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const pAndI = (P, rate) => { const r = rate / 1200; return P * r / (1 - Math.pow(1 + r, -360)); };

// Map metrics, grouped for the button rail (order = display order)
const MAP_CATS = {
  reListPrice: "Prices", rfSalePrice: "Prices", rfSaleYoY: "Prices", reHpiYoY: "Prices", reListYoY: "Prices", zillowHomeValue: "Prices",
  rePriceToIncome: "Value", rePriceToRent: "Value", reGrossYield: "Value", rePriceSqft: "Value", reBuildCost: "Value", rePriceVsBuild: "Value", reLandShare: "Value",
  rfSaleToList: "Tape", rfAboveList: "Tape", rfPriceDrops: "Tape", rfMonths: "Tape", rfDom: "Tape", reDom: "Tape", reInvYoY: "Tape", zillowInventory: "Tape",
  reRentVac: "Vacancy", reOwnVac: "Vacancy",
};
const RE_MAP_METRICS = Object.keys(MAP_CATS).map(k => { const m = CHOROPLETH_METRICS.find(x => x.key === k); return m ? { ...m, cat: MAP_CATS[k] } : null; }).filter(Boolean);

// Hand-curated commercial survey numbers (private-market cap rates and
// occupancy by property type). Empty until you log a broker release —
// CBRE/Cushman/JLL cap-rate surveys and STR (hotels), each with a date.
// Format: { asOf: "2026-Q2", type: "Office", capRate: 8.2, occupancy: 81,
//           source: "CBRE H1 2026 Cap Rate Survey" }
const CURATED_COMMERCIAL = [];

const useJson = url => {
  const [d, setD] = useState(null);
  useEffect(() => { if (!url) return; fetch(url).then(r => r.json()).then(x => { if (x && !x.error) setD(x); }).catch(() => {}); }, [url]);
  return d;
};

// ── small building blocks ───────────────────────────────────────────────────
// Source · cadence · latest print · age. Amber + "lagged" when the print is
// older than the cadence allows, so a stale number reads as lagged, not wrong.
function AsOf({ d, cadence = "monthly", src, extra }) {
  if (!d) return null;
  const q = /^(\d{4})Q(\d)$/.exec(d);
  const dt = q ? new Date(+q[1], +q[2] * 3 - 1, 1) : new Date(d.slice(0, 10) + "T00:00:00");
  const months = (Date.now() - dt.getTime()) / (30.44 * 86400000);
  const allow = { weekly: 0.75, monthly: 2.2, quarterly: 5.5, annual: 15 }[cadence] ?? 3;
  const stale = months > allow;
  const age = months < 1 ? `${Math.max(0, Math.round(months * 30))}d old` : `${Math.round(months)} mo old`;
  return <div style={{ fontSize: 9, color: stale ? AMBER : DIM, fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.4 }}>{[src, cadence, `latest ${mon(d)}`, age, stale ? "lagged" : null, extra].filter(Boolean).join(" · ")}</div>;
}
function Fold({ title, sub, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", textAlign: "left", cursor: "pointer", background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", fontSize: 12, fontFamily: fonts.heading, fontWeight: 700, color: "#cbd5e1" }}>
        <span style={{ color: INDIGO, marginRight: 8 }}>{open ? "▾" : "▸"}</span>{title}
        {sub && <span style={{ fontWeight: 400, fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginLeft: 10 }}>{sub}</span>}
      </button>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  );
}
function Verdict({ title, verdict, color, why, onOpen, dest, foot }) {
  return (
    <div onClick={onOpen} style={{ ...card, position: "relative", overflow: "hidden", cursor: onOpen ? "pointer" : "default" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: color }} />
      <div style={label}>{title}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.4, marginTop: 4, lineHeight: 1.15 }}>{verdict}</div>
      <div style={{ fontSize: 9.5, color: SLATE, fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.45, minHeight: 28 }}>{why}</div>
      {foot}
      {dest && <div style={{ fontSize: 10, color: INDIGO, fontFamily: fonts.mono, marginTop: 6 }}>{dest} →</div>}
    </div>
  );
}
function Stat({ title, value, sub, color = "var(--text-primary)", foot }) {
  return (
    <div style={{ ...card, padding: "10px 14px" }}>
      <div style={label}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.4, lineHeight: 1.15, marginTop: 3 }}>{value}</div>
      <div style={{ ...note, marginTop: 2 }}>{sub}</div>
      {foot}
    </div>
  );
}
function Series({ title, data, lines, height = 220, yFmt = v => v, refY, foot, xFmt = d => String(d).slice(0, 4), domain = ["auto", "auto"] }) {
  return (
    <div style={{ ...card, padding: "12px 14px 6px", marginBottom: 12 }}>
      <div style={label}>{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 14, bottom: 0, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={xFmt} minTickGap={40} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={yFmt} axisLine={false} tickLine={false} width={52} domain={domain} />
          <Tooltip contentStyle={tip} labelFormatter={d => String(d).slice(0, 7)} formatter={(v, n) => [yFmt(v), n]} />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="plainline" />}
          {refY != null && <ReferenceLine y={refY} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} />}
          {lines.map(l => <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={l.width || 1.8} strokeDasharray={l.dash} dot={false} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
      {foot && <div style={{ ...note, padding: "4px 0 4px 6px" }}>{foot}</div>}
    </div>
  );
}
// merge several [{d,v}] series into rows keyed by date (for multi-line charts)
function merge(named) {
  const rows = {};
  for (const [key, arr] of Object.entries(named)) for (const p of arr || []) { (rows[p.d] = rows[p.d] || { d: p.d })[key] = p.v; }
  return Object.values(rows).sort((a, b) => a.d.localeCompare(b.d));
}
// index each series to 100 at its first shared date
function indexed(named) {
  const out = {};
  for (const [key, arr] of Object.entries(named)) { const base = arr?.find(p => p.v)?.v; out[key] = base ? arr.map(p => ({ d: p.d, v: +((p.v / base) * 100).toFixed(1) })) : []; }
  return merge(out);
}
// horizontal segmented bar (shares that sum to ~100)
function Segments({ parts, height = 12 }) {
  const total = parts.reduce((a, p) => a + (fin(p.v) ? p.v : 0), 0) || 1;
  return (<>
    <div style={{ display: "flex", height, borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
      {parts.map(p => fin(p.v) && p.v > 0 && <div key={p.label} title={`${p.label}: ${p.v.toFixed(1)}%`} style={{ width: `${(p.v / total) * 100}%`, background: p.color, opacity: 0.9 }} />)}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 5 }}>
      {parts.map(p => <span key={p.label} style={{ fontSize: 9, color: SLATE, fontFamily: fonts.mono }}><span style={{ display: "inline-block", width: 7, height: 7, background: p.color, borderRadius: 2, marginRight: 4 }} />{p.label} {fin(p.v) ? `${p.v.toFixed(0)}%` : "—"}</span>)}
    </div>
  </>);
}
const scoreWord = p => (p >= 75 ? "high" : p >= 58 ? "above middle" : p >= 42 ? "middle" : p >= 25 ? "below middle" : "low");
function ScoreCard({ name, sec, support, history, histKey, foot }) {
  const hist = (history || []).filter(h => fin(h[histKey]));
  const parts = sec ? sec.anchors.filter(a => fin(a.pct)).map(a => `${scoreWord(a.pct)} on ${a.label.replace("Price vs ", "")} (${a.key === 'yield' ? 'rule score ' : 'p'}${a.pct})`) : [];
  return (
    <div style={{ ...card, padding: "14px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={label}>{name} · valuation context score</div>
        <span style={{ fontSize: 9.5, color: DIM, fontFamily: fonts.mono }}>0 low · 100 high on the selected measures</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: sec?.tone?.color || SLATE, fontFamily: fonts.heading, letterSpacing: -1, lineHeight: 1 }}>{sec && fin(sec.score) ? sec.score : "…"}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: sec?.tone?.color || SLATE, fontFamily: fonts.heading }}>{fin(sec?.score) ? scoreWord(sec.score) : "loading"}</span>
        {sec && <span style={{ fontSize: 9.5, color: DIM, fontFamily: fonts.mono }}>{sec.n} of {sec.anchors.length} anchors</span>}
      </div>
      <div style={{ position: "relative", height: 10, borderRadius: 5, marginTop: 10, background: "linear-gradient(90deg, #22d3ee 0%, #4ade80 28%, #94a3b8 50%, #fbbf24 72%, #f87171 100%)", opacity: 0.9 }}>
        {sec && fin(sec.score) && <div style={{ position: "absolute", left: `calc(${sec.score}% - 6px)`, top: -4, width: 12, height: 18, borderRadius: 3, background: "#f8fafc", border: `2px solid ${sec.tone.color}`, boxShadow: "0 0 8px rgba(0,0,0,0.6)" }} />}
      </div>
      <div style={{ fontSize: 10.5, color: "#cbd5e1", fontFamily: fonts.mono, marginTop: 10, lineHeight: 1.5 }}>{sec && fin(sec.score) ? `${parts.join(", ")}.` : "Waiting for the anchor feeds."}</div>
      {sec && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 8 }}>
          {sec.anchors.map(a => (
            <div key={a.key} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "6px 8px" }}>
              <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase" }}>{a.label}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, fontFamily: fonts.mono, color: fin(a.pct) ? (a.pct >= 75 ? RED : a.pct >= 58 ? AMBER : a.pct >= 42 ? SLATE : GREEN) : DIM }}>{fin(a.value) ? `${a.value}${a.unit?.startsWith("%") ? "%" : a.unit?.startsWith("×") ? "×" : ""}` : "—"} <span style={{ fontWeight: 400, color: DIM }}>{fin(a.pct) ? `${a.key === "yield" ? "rule " : "p"}${a.pct}` : "n/a"}</span></div>
            </div>
          ))}
        </div>
      )}
      {support && <div style={{ ...note, marginTop: 8 }}>Support (not scored): {support}</div>}
      {hist.length >= 2 ? (
        <div style={{ marginTop: 8 }}>
          <ResponsiveContainer width="100%" height={60}>
            <LineChart data={hist} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <YAxis domain={[0, 100]} hide /><XAxis dataKey="d" hide />
              <Tooltip contentStyle={tip} formatter={v => [v, "score"]} />
              <Line type="monotone" dataKey={histKey} stroke={sec?.tone?.color || SLATE} strokeWidth={1.6} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={note}>score history · {hist.length} daily readings since {hist[0].d}</div>
        </div>
      ) : <div style={{ ...note, marginTop: 6 }}>Score archived daily from today — the history line appears once there are two readings.</div>}
      {foot}
    </div>
  );
}

// ── Fair Value ──────────────────────────────────────────────────────────────
function FairValueView({ housing, repl, cre, reit, comp, credit, rents, go }) {
  const hv = housing?.verdict, rv = repl?.verdict, cv = cre?.cycle, kv = reit?.verdict;
  const light = l => (l?.label === "green" ? GREEN : l?.label === "amber" ? AMBER : l?.label === "red" ? RED : SLATE);
  const rentA = comp?.residential?.anchors?.find(a => a.key === "rent");
  const p2r = rentA?.value ?? rents?.national?.p2r ?? null, p2rPct = rentA?.pct ?? rents?.national?.p2rPct ?? null;
  const supportRes = comp?.support?.residential ? `${comp.support.residential.supplyMonths?.toFixed(1)} months' supply (p${comp.support.residential.supplyPct}) · mortgage delinquency ${pc0(comp.support.residential.mortgageDq, 2)} · ${comp.support.residential.verdict}` : null;
  const supportCom = comp?.support?.commercial ? `CRE delinquency ${pc0(comp.support.commercial.dq, 2)} (p${comp.support.commercial.dqPct}, ${pc(comp.support.commercial.dqChg1y, 2)} 1y) · prices ${pc(comp.support.commercial.priceYoy)} YoY (${mon(comp.support.commercial.priceAsOf)}) · rental vacancy ${pc0(comp.support.commercial.rentalVacancy)}${credit?.sloos ? ` · ${credit.sloos.verdict.label.toLowerCase()} (SLOOS)` : ""}` : null;
  return (<>
    <SH>Valuation Context — Prices, Income and Financing</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12, marginBottom: 12 }}>
      <ScoreCard name="Residential" sec={comp?.residential} support={supportRes} history={comp?.history} histKey="res" />
      <ScoreCard name="Commercial" sec={comp?.commercial} support={supportCom} history={comp?.history} histKey="com" />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginBottom: 12 }}>
      <Verdict title="Residential · health" verdict={hv?.label ?? "…"} color={hv?.color ?? SLATE}
        why={housing ? `affordability ${light(housing.afford?.light) === RED ? "red" : light(housing.afford?.light) === AMBER ? "amber" : "green"} (${pc0(housing.afford?.current)} of income, p${housing.afford?.pct}) · supply p${housing.supply?.pct} · valuation p${housing.valuation?.pct}` : "loading"}
        foot={<AsOf d={housing?.supply?.lastDate} cadence="monthly" src="Census / Freddie Mac via FRED" />} dest="Residential" onOpen={() => go("residential")} />
      <Verdict title="Residential · vs rebuild cost" verdict={rv?.label ?? "…"} color={rv?.color ?? SLATE}
        why={rv ? `price ÷ build-cost ratio ${rv.ratio} (100 = sample mean) · p${rv.pct} since ${repl.ratioSince}${rv.chg1y != null ? ` · ${rv.chg1y >= 0 ? "+" : ""}${rv.chg1y} over 12mo` : ""}` : "loading"}
        foot={<AsOf d={repl?.tiles?.constructionInputs?.last} cadence="monthly" src="Case-Shiller ÷ PPI via FRED" />} dest="Residential" onOpen={() => go("residential")} />
      <Verdict title="Commercial · price cycle" verdict={cv?.label ?? "…"} color={cv?.color ?? SLATE}
        why={cre ? `CRE prices ${pc(cre.price.yoy)} YoY (BIS) · CRE loan delinquency ${pc0(cre.delinquency.cre.current, 2)} (p${cre.delinquency.cre.pct}, ${pc(cre.delinquency.cre.chg1y, 2)} 1y)` : "loading"}
        foot={<AsOf d={cre?.price?.asOf} cadence="quarterly" src="BIS via FRED" />} dest="Commercial" onOpen={() => go("commercial")} />
      <Verdict title="Commercial · yield vs bonds" verdict={kv?.label ?? "…"} color={kv?.color ?? SLATE}
        why={reit?.available ? `REIT enterprise EBITDA yield ${pc0(reit.avgCap)} vs 10Y ${pc0(reit.tenYear, 2)} → spread ${reit.spread >= 0 ? "+" : ""}${reit.spread?.toFixed(1)} pts · ${reit.coverage} REITs` : reit ? "EBITDA yield data unavailable" : "loading"}
        foot={<AsOf d={reit?.asOf} cadence="weekly" src="FMP fundamentals + FRED 10Y" />} dest="Commercial" onOpen={() => go("commercial")} />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, marginBottom: 12 }}>
      <div style={card}>
        <div style={label}>Residential — the anchors</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
          <Stat title="Price vs income" value={pc0(housing?.afford?.current)} color={light(housing?.afford?.light)} sub={housing ? `median payment as % of income · p${housing.afford?.pct} since ${housing.afford?.since} · long-run median ${pc0(housing.afford?.median)}` : "—"} />
          <Stat title="Price vs rent" value={fin(p2r) ? `${Number(p2r).toFixed(1)}×` : "—"} color={fin(p2rPct) ? (p2rPct >= 75 ? RED : p2rPct >= 50 ? AMBER : GREEN) : SLATE} sub={fin(p2r) ? `Zillow value ÷ annual rent · gross yield ${pc0(100 / p2r)}${fin(p2rPct) ? ` · p${p2rPct} since ${rents?.national?.since || "2015"}` : ""}` : "Zillow ZHVI/ZORI"} />
          <Stat title="Price vs rebuild" value={rv ? `${rv.ratio}` : "—"} color={rv?.color || SLATE} sub={rv ? `Case-Shiller ÷ construction PPI, 100 = sample mean · p${rv.pct}` : "—"} />
          <Stat title="Supply & credit" value={housing ? `${housing.supply?.current?.toFixed(1)} mo` : "—"} color={light(housing?.supply?.light)} sub={housing ? `months of supply (p${housing.supply?.pct}) · mortgage delinquency ${pc0(cre?.delinquency?.mortgage?.current, 2)}` : "—"} />
        </div>
      </div>
      <div style={card}>
        <div style={label}>Commercial — the anchors</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
          <Stat title="Yield vs bonds" value={reit?.available ? `${reit.spread >= 0 ? "+" : ""}${reit.spread?.toFixed(1)} pts` : "—"} color={kv?.color || SLATE} sub={reit?.available ? `EBITDA yield ${pc0(reit.avgCap)} − 10Y ${pc0(reit.tenYear, 2)} · screening comparison` : "REIT proxy"} />
          <Stat title="Price vs rebuild" value={cre?.replacement?.current != null ? `${cre.replacement.current}` : "—"} color={cre?.replacement?.pct != null ? (cre.replacement.pct >= 70 ? RED : cre.replacement.pct >= 30 ? AMBER : GREEN) : SLATE} sub={cre ? `CRE price index ÷ construction-input PPI, mean = 100 · p${cre.replacement.pct} since ${cre.replacement.since}` : "—"} />
          <Stat title="Price momentum" value={pc(cre?.price?.yoy)} color={cre ? (cre.price.yoy < 0 ? RED : cre.price.yoy > 3 ? GREEN : AMBER) : SLATE} sub={cre ? `BIS commercial property prices, YoY · rents (CPI) ${pc(cre.rent.cpiYoy)} · build inputs ${pc(cre.cost.ppiYoy)}` : "—"} />
          <Stat title="Credit & lending" value={pc0(cre?.delinquency?.cre?.current, 2)} color={cre ? (cre.delinquency.cre.chg1y > 0.3 ? RED : cre.delinquency.cre.chg1y > 0 ? AMBER : GREEN) : SLATE} sub={cre ? `CRE loan delinquency (p${cre.delinquency.cre.pct})${credit?.sloos ? ` · SLOOS net tightening ${credit.sloos.avg >= 0 ? "+" : ""}${credit.sloos.avg}%` : ""} · rental vacancy ${pc0(cre.vacancy.rental.current)}` : "—"} />
        </div>
      </div>
    </div>

    {reit?.available && (
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={label}>REIT enterprise EBITDA yield by property type · spread over the 10-year ({pc0(reit.tenYear, 2)})</div>
          <span style={note}>EBITDA ÷ enterprise value · {reit.coverage} bellwethers · {reit.asOf}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "4px 20px", marginTop: 8 }}>
          {reit.bySector.map(s => {
            const c = s.spread == null ? SLATE : s.spread < 1 ? RED : s.spread < 2.5 ? AMBER : GREEN;
            return (
              <div key={s.sector} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                <span style={{ width: 128, fontSize: 10.5, color: "#cbd5e1", fontFamily: fonts.mono, flexShrink: 0 }}>{s.sector}</span>
                <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 4, position: "relative" }}>
                  <div style={{ width: `${Math.min(100, (s.cap / 12) * 100)}%`, height: "100%", background: c, borderRadius: 4, opacity: 0.85 }} />
                  {fin(reit.tenYear) && <div style={{ position: "absolute", left: `${Math.min(100, (reit.tenYear / 12) * 100)}%`, top: -3, width: 2, height: 14, background: "#f1f5f9" }} title="10-year Treasury" />}
                </div>
                <span style={{ width: 44, textAlign: "right", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.mono }}>{pc0(s.cap)}</span>
                <span style={{ width: 54, textAlign: "right", fontSize: 10, color: c, fontFamily: fonts.mono }}>{s.spread != null ? `${s.spread >= 0 ? "+" : ""}${s.spread.toFixed(1)}` : "—"}</span>
              </div>
            );
          })}
        </div>
        <div style={{ ...note, marginTop: 8 }}>White tick = the 10-year Treasury yield. These are enterprise EBITDA yields using annual accounts and current prices. Capital intensity, corporate costs and growth differ across property types; a larger spread does not by itself indicate better value.</div>
      </div>
    )}

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>The framework.</strong> These scores describe valuation context, not an intrinsic value or expected return. Residential components are historical percentiles; the commercial EBITDA spread component is a rule: a 3.5-point spread scores 0 and a zero spread scores 100, clipped at the ends. The price-to-construction-input ratio is normalized to its sample mean, not actual replacement cost. Component coverage and lookback periods can differ. Compare income, recurring capital needs, financing and local supply before drawing an investment conclusion.
    </InfoBox>
  </>);
}

// ── Residential ─────────────────────────────────────────────────────────────
function ownVsRent(zn, mortgageMonthly) {
  const zh = zn?.zhvi?.history || [], zo = zn?.zori?.history || [];
  if (!zh.length || !zo.length || !mortgageMonthly?.length) return null;
  const rateBy = Object.fromEntries(mortgageMonthly.map(p => [p.d.slice(0, 7), p.v]));
  const rentBy = Object.fromEntries(zo.map(p => [p.d.slice(0, 7), p.v]));
  const CARRY = 0.026; // property tax ≈ 1.1% + insurance ≈ 0.5% + maintenance ≈ 1.0% of value per year
  const rows = [];
  for (const p of zh) {
    const m = p.d.slice(0, 7), r = rateBy[m], rent = rentBy[m];
    if (!r || !rent) continue;
    const own = pAndI(p.v * 0.8, r) + (p.v * CARRY) / 12;
    rows.push({ d: p.d, own: Math.round(own), rent: Math.round(rent), premium: +(((own / rent) - 1) * 100).toFixed(1), rate: r, price: p.v });
  }
  const cur = rows[rows.length - 1];
  if (!cur) return null;
  let lo = 0.25, hi = 20;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; const own = pAndI(cur.price * 0.8, mid) + (cur.price * CARRY) / 12; if (own > cur.rent) hi = mid; else lo = mid; }
  const breakeven = (lo + hi) / 2;
  const prem = rows.map(r => r.premium);
  return { rows, cur, breakeven: breakeven > 0.3 ? +breakeven.toFixed(2) : null, minP: Math.min(...prem), maxP: Math.max(...prem), carry: CARRY };
}

function ResidentialView({ hd, md, zillowData, housing, pipe, redfin, rents }) {
  const zn = zillowData?.national;
  const ovr = useMemo(() => ownVsRent(zn, pipe?.mortgageMonthly), [zn, pipe]);
  const wi = housing?.afford?.whatIf, lock = pipe?.lockin && !pipe.lockin.error ? pipe.lockin : null;
  const rateNow = pipe?.mortgageNow ?? md?.MORTGAGE30US?.current ?? housing?.afford?.rate ?? null;
  const lockRows = useMemo(() => {
    if (!lock?.series || !pipe?.mortgageMonthly) return [];
    const q = lock.series.map(p => { const m = /^(\d{4})Q(\d)$/.exec(p.d); return m ? { d: `${m[1]}-${String(+m[2] * 3).padStart(2, "0")}-01`, v: p.v } : null; }).filter(Boolean);
    const mkt = pipe.mortgageMonthly.filter(p => p.d >= (q[0]?.d || "2013"));
    return merge({ outstanding: q, market: mkt });
  }, [lock, pipe]);
  const rf = redfin?.national, rfl = rf?.latest, rfp = rf?.pct;
  const rfSeries = rf?.series || [];
  const rfYoy = rfSeries.length > 12 ? ((rfSeries[rfSeries.length - 1].price / rfSeries[rfSeries.length - 13].price) - 1) * 100 : null;
  const cons = pipe?.construction, starts = pipe?.starts, lst = pipe?.listings;
  const tone = (pct, hiBad) => (!fin(pct) ? SLATE : (hiBad ? pct : 100 - pct) >= 75 ? RED : (hiBad ? pct : 100 - pct) >= 50 ? AMBER : GREEN);
  return (<>
    {zn && <HousingHealthPanel zn={zn} metros={zillowData?.metros || []} />}

    <SH>What Would Have to Change</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, marginBottom: 12 }}>
      <Stat title="Back to normal affordability" value={wi?.toMedian ? `${pc(wi.toMedian.priceChg, 0)} prices` : "…"} color={wi?.toMedian ? (wi.toMedian.priceChg < -10 ? RED : wi.toMedian.priceChg < 0 ? AMBER : GREEN) : SLATE}
        sub={wi?.toMedian ? `…at today's ${pc0(housing.afford.rate, 2)} mortgage — or a ${pc0(wi.toMedian.rate, 2)} mortgage at today's prices. Payment share now ${pc0(housing.afford.current)} of income vs a long-run median of ${pc0(housing.afford.median)}.` : "loading /api/housing-health"}
        foot={<AsOf d={housing?.supply?.lastDate} cadence="monthly" src="Median price (Census) × Freddie Mac rate ÷ median income" />} />
      <Stat title="To the 28% rule" value={wi?.to28 ? `${pc(wi.to28.priceChg, 0)} prices` : "…"} color={wi?.to28 ? (wi.to28.priceChg < -10 ? RED : wi.to28.priceChg < 0 ? AMBER : GREEN) : SLATE}
        sub={wi?.to28 ? `…or a ${pc0(wi.to28.rate, 2)} mortgage, for the median household to carry the median home at the classic 28% front-end limit (payment ${usd0(wi.to28.payment)}/mo vs ${usd0(housing.afford.payment)} today).` : "—"} />
      <Stat title="Own vs rent, monthly" value={ovr ? `${pc(ovr.cur.premium, 0)} to own` : "…"} color={ovr ? (ovr.cur.premium > 30 ? RED : ovr.cur.premium > 10 ? AMBER : GREEN) : SLATE}
        sub={ovr ? `${usd0(ovr.cur.own)}/mo to own the typical home (P&I at ${ovr.cur.rate}% + ${(ovr.carry * 100).toFixed(1)}% carry) vs ${usd0(ovr.cur.rent)} to rent it · 5y range ${pc(ovr.minP, 0)} to ${pc(ovr.maxP, 0)}${ovr.breakeven ? ` · owning breaks even at a ${pc0(ovr.breakeven, 2)} mortgage` : ""}` : "Zillow value + rent, Freddie Mac rate"}
        foot={<AsOf d={ovr?.cur?.d} cadence="monthly" src="Zillow ZHVI / ZORI" />} />
      <Stat title="Mortgage lock-in gap" value={lock && fin(rateNow) ? `${(rateNow - lock.avgRate).toFixed(1)} pts` : "…"} color={lock && fin(rateNow) ? (rateNow - lock.avgRate > 2 ? RED : rateNow - lock.avgRate > 1 ? AMBER : GREEN) : SLATE}
        sub={lock ? `Homeowners pay ${pc0(lock.avgRate)} on average vs ${pc0(rateNow, 2)} to move · ${pc0(lock.below4, 0)} of all mortgages are below 4% · ${pc0(lock.ge6, 0)} at 6%+ (the share that can refinance when rates fall)` : pipe?.lockin?.error ? "FHFA file unavailable" : "loading FHFA NMDB"}
        foot={<AsOf d={lock?.asOf} cadence="quarterly" src="FHFA National Mortgage Database" />} />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12 }}>
      {ovr && <Series title="Monthly cost — own the typical home vs rent it ($/mo)" data={ovr.rows} lines={[{ key: "own", name: "Own (P&I + 2.6% carry)", color: INDIGO, width: 2 }, { key: "rent", name: "Rent (Zillow ZORI)", color: GREEN, width: 2 }]} yFmt={v => `$${(Number(v) / 1000).toFixed(1)}K`} xFmt={d => String(d).slice(0, 7)}
        foot={`Own = principal & interest on 80% of the Zillow typical value at that month's 30-year rate, plus ${(ovr.carry * 100).toFixed(1)}%/yr of value for tax, insurance and upkeep; no tax deduction, no appreciation. The gap is what a buyer pays for optionality on price.`} />}
      {lockRows.length > 0 && (
        <div style={{ ...card, padding: "12px 14px 6px", marginBottom: 12 }}>
          <div style={label}>Rate on outstanding mortgages vs the market rate (%)</div>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={lockRows} margin={{ top: 10, right: 14, bottom: 0, left: -6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="d" tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={d => d.slice(0, 4)} minTickGap={40} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tip} labelFormatter={d => d.slice(0, 7)} formatter={(v, n) => [`${Number(v).toFixed(2)}%`, n]} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="plainline" />
              <Line type="monotone" dataKey="market" name="30-year market rate" stroke={AMBER} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
              <Line type="stepAfter" dataKey="outstanding" name="Avg rate, outstanding mortgages" stroke={CYAN} strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          {lock && <div style={{ padding: "6px 6px 4px" }}>
            <Segments parts={[{ label: "< 3%", v: lock.below3, color: CYAN }, { label: "3–4%", v: lock.r3to4, color: GREEN }, { label: "4–5%", v: lock.r4to5, color: SLATE }, { label: "5–6%", v: lock.r5to6, color: AMBER }, { label: "6%+", v: lock.ge6, color: RED }]} />
            <div style={{ ...note, marginTop: 6 }}>Share of outstanding mortgages by rate, {lock.asOf}. The lock-in gap is why for-sale supply stays thin while affordability is stretched: selling means trading the cyan line for the amber one. It closes from both ends — as rates fall, and as the 6%+ cohort grows.</div>
          </div>}
        </div>
      )}
    </div>

    <SH>The Tape — What Is Actually Clearing (Redfin, national)</SH>
    {rfl ? (<>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
        <Stat title="Median sale price" value={usd(rfl.price)} color={fin(rfYoy) ? (rfYoy < 0 ? RED : rfYoy < 2 ? AMBER : GREEN) : SLATE} sub={`${pc(rfYoy)} YoY · $${rfl.ppsf?.toFixed(0)}/sq ft · seasonally adjusted`} />
        <Stat title="Sale-to-list ratio" value={pc0(rfl.saleToList * 100)} color={tone(rfp?.saleToList, false)} sub={`p${rfp?.saleToList} since 2012 · below 100% = buyers negotiating · ${pc0(rfl.aboveList * 100, 0)} sold above list`} />
        <Stat title="Listings with price drops" value={pc0(rfl.priceDrops * 100, 0)} color={tone(rfp?.priceDrops, true)} sub={`p${rfp?.priceDrops} since 2012 · the leading tell for softening — sellers capitulating before prices print`} />
        <Stat title="Months of supply" value={`${rfl.months?.toFixed(1)} mo`} color={tone(rfp?.months, true)} sub={`p${rfp?.months} · inventory ÷ monthly sales · ${kk(rfl.inventory / 1000)} for sale, ${kk(rfl.sold / 1000)} sold`} />
        <Stat title="Days on market" value={`${rfl.dom?.toFixed(0)}d`} color={tone(rfp?.dom, true)} sub={`p${rfp?.dom} · median days to pending · ${pc0(rfl.offMarket2w * 100, 0)} off market within two weeks`} />
      </div>
      <AsOf d={redfin.asOf} cadence="monthly" src="Redfin Data Center" extra={`Redfin's public file last refreshed ${redfin.fileUpdated || "n/a"}`} />
      <div style={{ height: 8 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12 }}>
        <Series title="Sale-to-list ratio (%) — what buyers pay vs the ask" data={rfSeries.map(p => ({ d: p.d, v: fin(p.saleToList) ? +(p.saleToList * 100).toFixed(2) : null }))} lines={[{ key: "v", name: "Sale-to-list", color: INDIGO, width: 2 }]} yFmt={v => `${Number(v).toFixed(1)}%`} refY={100} foot="Above 100% = bidding wars (2021–22). The ratio leads price: it fell below 100% months before Case-Shiller rolled over in 2022." />
        <Series title="Share of listings with a price drop (%) and months of supply" data={rfSeries.map(p => ({ d: p.d, drops: fin(p.priceDrops) ? +(p.priceDrops * 100).toFixed(1) : null, months: p.months }))} lines={[{ key: "drops", name: "Price drops (% of listings)", color: RED, width: 2 }, { key: "months", name: "Months of supply", color: AMBER }]} yFmt={v => Number(v).toFixed(1)} foot="Price drops are the sellers' vote; months of supply is the arithmetic. Both rising together is the pre-correction pattern (2022); drops rising with supply flat is a slow grind." />
      </div>
    </>) : <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>{redfin ? "Redfin data unavailable." : "Loading the Redfin market tracker (first load downloads ~10 MB and caches it for a day)…"}</div>}

    <SH>Supply Pipeline — What Is Being Built</SH>
    {cons ? (<>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
        <Stat title="Apartments under construction" value={kk(cons.multi)} color={cons.multiPct >= 85 ? RED : cons.multiPct >= 60 ? AMBER : GREEN} sub={`5+ units · ${pc(cons.multiYoy)} YoY · p${cons.multiPct} of history · peak ${kk(cons.multiPeak)} (${mon(cons.multiPeakDate)})`} />
        <Stat title="Single-family under construction" value={kk(cons.single)} color={SLATE} sub={`${pc(cons.singleYoy)} YoY · total ${kk(cons.underConstruction)} units`} />
        <Stat title="Completions" value={kk(cons.completions)} color={SLATE} sub={`annual rate · ${pc(cons.completionsYoy)} YoY · what lands on the rental market this year`} />
        <Stat title="Multifamily starts / permits" value={`${kk(starts.multi)} / ${kk(starts.permitsMulti)}`} color={starts.permitsMultiYoy < -10 ? CYAN : starts.permitsMultiYoy > 10 ? AMBER : SLATE} sub={`starts ${pc(starts.multiYoy)} · permits ${pc(starts.permitsMultiYoy)} YoY · the pipeline two years out`} />
        <Stat title="Single-family starts / permits" value={`${kk(starts.single)} / ${kk(starts.permitsSingle)}`} color={SLATE} sub={`starts ${pc(starts.singleYoy)} · permits ${pc(starts.permitsSingleYoy)} YoY`} />
        {lst && <Stat title="Listings with a price cut" value={pc0(lst.reducedShare)} color={lst.reducedPct >= 75 ? RED : lst.reducedPct >= 50 ? AMBER : GREEN} sub={`Realtor.com, of active listings · ${pc0(lst.reducedShare1y)} a year ago · new listings ${pc(lst.newYoy)} · active ${pc(lst.activeYoy)} YoY`} />}
      </div>
      <AsOf d={cons.asOf} cadence="monthly" src="Census construction survey via FRED" />
      <div style={{ height: 8 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12 }}>
        <Series title="Units under construction (thousands) — apartments vs single-family" data={cons.series} lines={[{ key: "multi", name: "5+ units", color: AMBER, width: 2 }, { key: "single", name: "Single-family", color: INDIGO, width: 2 }, { key: "completions", name: "Completions (annual rate)", color: SLATE, dash: "4 3" }]} yFmt={v => `${Number(v).toFixed(0)}K`} foot="The apartment wave: the 2022–24 peak in 5+ unit construction is what is landing on the rental market now and holding rents down. When this line falls below completions, the wave has passed." />
        <Series title="Starts and permits (thousands, annual rate)" data={starts.series} lines={[{ key: "single", name: "SF starts", color: INDIGO, width: 2 }, { key: "multi", name: "MF starts", color: AMBER, width: 2 }, { key: "permitsSingle", name: "SF permits", color: INDIGO, dash: "4 3" }, { key: "permitsMulti", name: "MF permits", color: AMBER, dash: "4 3" }]} yFmt={v => `${Number(v).toFixed(0)}K`} foot="Permits lead starts by a few months; starts lead completions by a year (single-family) to two (apartments). Falling multifamily permits today mean tighter rental supply in 2027–28." />
        {lst?.series?.length > 0 && <Series title="Listing flow (Realtor.com) — new listings, active listings, share with a price cut" data={indexed({ newListings: lst.series.map(r => ({ d: r.d, v: r.newListings })), active: lst.series.map(r => ({ d: r.d, v: r.active })) }).map(r => ({ ...r, reduced: lst.series.find(x => x.d === r.d)?.reduced ?? null }))} lines={[{ key: "active", name: "Active listings (indexed)", color: INDIGO, width: 2 }, { key: "newListings", name: "New listings (indexed)", color: GREEN }, { key: "reduced", name: "Price-cut share (%)", color: RED, width: 2 }]} yFmt={v => Number(v).toFixed(0)} xFmt={d => String(d).slice(0, 7)} foot="Active and new listings indexed to the start of the series; the price-cut share is in percent on the same axis. Active listings rising faster than new listings = homes are not selling." />}
      </div>
    </>) : <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading the supply pipeline (FRED)…</div>}

    <Fold title="Underlying series — Zillow values and rents, inventory, construction, replacement cost, top metros" sub="the former Housing tab, unchanged">
      <HousingSubTab hd={hd} md={md} zillow={zillowData} hideHealth />
    </Fold>

    <InfoBox color="#3B82F6">
      <strong style={{ color: "#cbd5e1" }}>Reading residential.</strong> Prices are set at the margin by the few homes that trade, and three things gate that margin: whether the median household can carry the median payment (the what-would-have-to-change numbers), whether owners can afford to move (the lock-in gap), and whether new supply is arriving (the pipeline). The Redfin tape is the earliest read on all three — sale-to-list and price-drop share move months before the price indexes. A market that is unaffordable but under-supplied grinds sideways; one that is unaffordable and loosening corrects.
    </InfoBox>
  </>);
}

// ── Commercial ──────────────────────────────────────────────────────────────
function KastleCard({ k }) {
  if (!k || k.error) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>{k?.error ? `Kastle barometer unavailable (${k.error}).` : "Loading Kastle office attendance…"}</div>;
  const cities = Object.entries(k.cities || {}).sort((a, b) => b[1].v - a[1].v);
  const c = v => (v >= 60 ? GREEN : v >= 50 ? AMBER : RED);
  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={label}>Office attendance — Kastle 10-city barometer (card swipes vs Feb-2020 = 100%)</div>
        <span style={note}>week of {k.d} · weekly</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: c(k.avg), fontFamily: fonts.heading, letterSpacing: -0.8 }}>{pc0(k.avg)}</span>
        <span style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>weekly average{fin(k.prev) ? ` · ${k.avg - k.prev >= 0 ? "+" : ""}${(k.avg - k.prev).toFixed(1)} vs prior week (${pc0(k.prev)})` : ""}{fin(k.peak) ? ` · peak day ${pc0(k.peak)}` : ""}</span>
      </div>
      {cities.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "3px 20px", marginTop: 8 }}>
          {cities.map(([name, v]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
              <span style={{ width: 96, fontSize: 10.5, color: "#cbd5e1", fontFamily: fonts.mono, flexShrink: 0 }}>{name}</span>
              <div style={{ flex: 1, height: 7, background: "rgba(255,255,255,0.05)", borderRadius: 4 }}><div style={{ width: `${Math.min(100, v.v)}%`, height: "100%", background: c(v.v), borderRadius: 4, opacity: 0.85 }} /></div>
              <span style={{ width: 40, textAlign: "right", fontSize: 11, fontWeight: 700, fontFamily: fonts.mono, color: "var(--text-primary)" }}>{v.v.toFixed(1)}%</span>
              <span style={{ width: 34, textAlign: "right", fontSize: 9.5, fontFamily: fonts.mono, color: v.chg >= 0 ? GREEN : RED }}>{v.chg >= 0 ? "+" : ""}{v.chg.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
      {k.weeks?.length >= 3 && (
        <ResponsiveContainer width="100%" height={90}>
          <LineChart data={k.weeks} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="d" hide /><YAxis domain={["auto", "auto"]} hide /><Tooltip contentStyle={tip} formatter={v => [`${v}%`, "10-city avg"]} />
            <Line type="monotone" dataKey="avg" stroke={INDIGO} strokeWidth={1.8} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <div style={{ ...note, marginTop: 6 }}>Kastle measures attendance in participating buildings relative to February 2020. It does not measure leased occupancy, rent collection or NOI. Use leasing spreads, lease expirations, concessions and operating expenses to assess office cash flows. This local archive contains {k.weeks?.length || 1} weekly observations.</div>
    </div>
  );
}

function CommercialView({ cre, reit, credit }) {
  if (!cre) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading commercial fundamentals (FRED)…</div>;
  const cv = cre.cycle, sl = credit?.sloos;
  const priceRows = merge({ yoy: cre.price.series });
  const dqRows = merge({ cre: cre.delinquency.cre.series, mortgage: cre.delinquency.mortgage.series });
  const consRows = indexed({ commercial: cre.construction.commercial, office: cre.construction.office, residential: cre.construction.residential, manufacturing: cre.construction.manufacturing });
  const vacRows = merge({ rental: cre.vacancy.rental.series, owner: cre.vacancy.owner.series });
  const replRows = merge({ ratio: cre.replacement.ratio });
  const th = t => <th style={{ padding: "6px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{t}</th>;
  const td = (v, extra = {}) => <td style={{ padding: "6px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "#cbd5e1", whiteSpace: "nowrap", ...extra }}>{v}</td>;
  return (<>
    <SH>Commercial — Price Cycle, Credit, Supply</SH>
    <div style={{ ...card, marginBottom: 12, position: "relative", overflow: "hidden", padding: "16px 20px" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: cv.color }} />
      <div style={label}>Where commercial property is in its cycle</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: cv.color, fontFamily: fonts.heading, letterSpacing: -0.5, marginTop: 4 }}>{cv.label}</div>
      <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5, maxWidth: 860 }}>{cv.note} Prices {pc(cre.price.yoy)} YoY as of {mon(cre.price.asOf)}; CRE loan delinquency {pc0(cre.delinquency.cre.current, 2)} ({pc(cre.delinquency.cre.chg1y, 2)} over a year, p{cre.delinquency.cre.pct} of history); bank CRE loans {pc(cre.loans.yoy)} YoY{sl ? `; ${sl.verdict.label.toLowerCase()} on CRE loans (net ${sl.avg >= 0 ? "+" : ""}${sl.avg}% tightening)` : ""}.</div>
      <AsOf d={cre.price.asOf} cadence="quarterly" src="BIS commercial property price index via FRED" extra="the BIS index publishes with a ~1-year lag — the REIT table and lending standards below are the current read" />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
      <Stat title="CRE prices YoY" value={pc(cre.price.yoy)} color={cre.price.yoy < 0 ? RED : GREEN} sub={`BIS commercial property index · ${mon(cre.price.asOf)}`} />
      <Stat title="CRE loan delinquency" value={pc0(cre.delinquency.cre.current, 2)} color={cre.delinquency.cre.chg1y > 0 ? AMBER : GREEN} sub={`p${cre.delinquency.cre.pct} since 1991 · ${pc(cre.delinquency.cre.chg1y, 2)} 1y`} />
      <Stat title="Bank CRE loans YoY" value={pc(cre.loans.yoy)} color={cre.loans.yoy < 0 ? RED : cre.loans.yoy < 2 ? AMBER : GREEN} sub={`$${(cre.loans.current / 1000).toFixed(2)}T outstanding (H.8)`} />
      <Stat title="Lending standards" value={sl ? `${sl.avg >= 0 ? "+" : ""}${sl.avg}%` : "…"} color={sl?.verdict?.color || SLATE} sub={sl ? `${sl.verdict.label} · net % of banks tightening CRE standards (SLOOS, ${mon(sl.asOf)})` : "loading SLOOS"} />
      <Stat title="Rental vacancy" value={pc0(cre.vacancy.rental.current)} color={cre.vacancy.rental.pct >= 70 ? RED : cre.vacancy.rental.pct >= 35 ? AMBER : GREEN} sub={`p${cre.vacancy.rental.pct} · homeowner vacancy ${pc0(cre.vacancy.owner.current)}`} />
      <Stat title="Office attendance" value={credit?.kastle && !credit.kastle.error ? pc0(credit.kastle.avg) : "…"} color={credit?.kastle && fin(credit.kastle.avg) ? (credit.kastle.avg >= 60 ? GREEN : credit.kastle.avg >= 50 ? AMBER : RED) : SLATE} sub={credit?.kastle && !credit.kastle.error ? `Kastle 10-city weekly average vs Feb-2020 · week of ${credit.kastle.d}` : "Kastle barometer"} />
      <Stat title="Price vs rebuild" value={cre.replacement.current ?? "—"} color={cre.replacement.pct >= 70 ? RED : cre.replacement.pct >= 30 ? AMBER : GREEN} sub={`index ÷ construction PPI · p${cre.replacement.pct} since ${cre.replacement.since}`} />
    </div>

    <SH>Credit Availability &amp; Occupancy — The Current Read</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12 }}>
      {sl ? (
        <div style={{ ...card, padding: "12px 14px 6px", marginBottom: 12, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: sl.verdict.color }} />
          <div style={label}>Banks tightening CRE lending standards — net % (SLOOS, quarterly)</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: sl.verdict.color, fontFamily: fonts.heading, marginTop: 4 }}>{sl.verdict.label}</div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5 }}>{sl.verdict.note} Construction &amp; land {sl.cld >= 0 ? "+" : ""}{sl.cld}% · non-residential {sl.nonres >= 0 ? "+" : ""}{sl.nonres}% · multifamily {sl.multi >= 0 ? "+" : ""}{sl.multi}%.</div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={sl.series} margin={{ top: 10, right: 14, bottom: 0, left: -6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="d" tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={d => d.slice(0, 4)} minTickGap={40} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} width={46} />
              <Tooltip contentStyle={tip} labelFormatter={d => d.slice(0, 7)} formatter={(v, n) => [`${v >= 0 ? "+" : ""}${v}%`, n]} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="plainline" />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} />
              <Line type="monotone" dataKey="cld" name="Construction & land" stroke={RED} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="nonres" name="Non-residential" stroke={INDIGO} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="multi" name="Multifamily" stroke={AMBER} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ ...note, padding: "4px 0 4px 6px" }}>Positive = more banks tightening than easing. Standards tightened through 2023–24 while the BIS index was still being marked down; easing here leads the price bottom because it is what lets maturing loans refinance instead of sell. <AsOf d={sl.asOf} cadence="quarterly" src="Fed SLOOS via FRED" /></div>
        </div>
      ) : <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading lending standards (SLOOS)…</div>}
      <KastleCard k={credit?.kastle} />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12 }}>
      <Series title="Commercial property prices — YoY % (BIS, quarterly)" data={priceRows} lines={[{ key: "yoy", name: "CRE price YoY", color: INDIGO, width: 2 }]} yFmt={v => `${Number(v).toFixed(0)}%`} refY={0} foot="Negative = values falling year over year. The 2009–10 and 2023–24 legs are the two corrections in this series." />
      <Series title="Loan delinquency — CRE vs residential mortgages (%)" data={dqRows} lines={[{ key: "cre", name: "CRE loans", color: RED, width: 2 }, { key: "mortgage", name: "Mortgages", color: SLATE }]} yFmt={v => `${Number(v).toFixed(1)}%`} foot="Fed H.8, all commercial banks. Commercial credit turns after prices; the peak in delinquencies has marked the price bottom." />
      <Series title="Construction spending — indexed to 100 (monthly, SAAR)" data={consRows} lines={[{ key: "commercial", name: "Commercial", color: INDIGO, width: 2 }, { key: "office", name: "Office", color: RED }, { key: "residential", name: "Residential", color: GREEN }, { key: "manufacturing", name: "Manufacturing", color: AMBER }]} yFmt={v => Number(v).toFixed(0)} foot="Supply response by segment. A price-above-replacement gap that persists shows up here as a building boom — the manufacturing line is the CHIPS/AI build." />
      <Series title="Vacancy — rental vs homeowner (%)" data={vacRows} lines={[{ key: "rental", name: "Rental vacancy", color: AMBER, width: 2 }, { key: "owner", name: "Homeowner vacancy", color: CYAN }]} yFmt={v => `${Number(v).toFixed(1)}%`} foot="Census HVS covers the household rental market across structure types. It is not a direct occupancy measure for institutional apartments. Kastle measures office attendance, which is distinct from leased occupancy." />
      <Series title="Commercial price vs cost to build — ratio, mean = 100" data={replRows} lines={[{ key: "ratio", name: "CRE price ÷ construction-input PPI", color: CYAN, width: 2 }]} yFmt={v => Number(v).toFixed(0)} refY={100} foot="A relative price-to-input-cost index with its sample mean set to 100. It omits land, financing, soft costs and local economics; 100 is not dollar replacement-cost parity." />
    </div>

    <SH>REIT Enterprise EBITDA Yields</SH>
    {reit?.available ? (
      <div style={{ ...card, padding: "10px 12px", marginBottom: 12, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Average EBITDA yield <strong style={{ color: "var(--text-primary)" }}>{pc0(reit.avgCap)}</strong> vs 10Y {pc0(reit.tenYear, 2)} → spread <strong style={{ color: reit.verdict.color }}>{reit.spread >= 0 ? "+" : ""}{reit.spread?.toFixed(1)} pts</strong> · {reit.verdict.label}</span>
          <span style={note}>{reit.coverage} names · fiscal-year EBITDA ÷ current EV · {reit.asOf}</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ padding: "6px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Property type · REIT</th>{th("EBITDA yield")}{th("Spread vs 10Y")}{th("Div. yield")}{th("Debt / EV")}{th("Off 52w high")}{th("EV")}</tr></thead>
          <tbody>
            {reit.rows.filter(r => !r.error).sort((a, b) => a.sector.localeCompare(b.sector) || b.cap - a.cap).map(r => {
              const sp = fin(reit.tenYear) ? r.cap - reit.tenYear : null;
              const c = sp == null ? SLATE : sp < 1 ? RED : sp < 2.5 ? AMBER : GREEN;
              return (
                <tr key={r.t} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "6px 8px", fontSize: 11, fontFamily: fonts.mono, color: "#cbd5e1" }}><span style={{ color: DIM }}>{r.sector}</span> · <strong style={{ color: "var(--text-primary)" }}>{r.t}</strong></td>
                  {td(pc0(r.cap), { color: "var(--text-primary)", fontWeight: 700 })}
                  {td(sp != null ? `${sp >= 0 ? "+" : ""}${sp.toFixed(1)}` : "—", { color: c, fontWeight: 700 })}
                  {td(pc0(r.divYield))}
                  {td(pc0(r.debtToEv, 0))}
                  {td(pc(r.offHigh, 0), { color: r.offHigh < -20 ? RED : SLATE })}
                  {td(`$${(r.ev / 1e9).toFixed(0)}B`, { color: DIM })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ ...note, marginTop: 6 }}>Enterprise EBITDA yield = fiscal-year EBITDA ÷ (current market cap + reported debt − cash). It mixes annual financial statements with current prices and excludes recurring capital expenditure. Corporate costs and asset mix differ by REIT; this is not a property NOI cap rate and has no reliable fixed adjustment to private-market cap rates.</div>
      </div>
    ) : <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>{reit ? `REIT EBITDA yields unavailable (${reit.reason || "no data"}).` : "Loading REIT EBITDA yields (FMP)…"}</div>}

    <div style={{ ...card, marginBottom: 12 }}>
      <div style={label}>Private-market cap rates &amp; occupancy by property type — curated{CURATED_COMMERCIAL.length ? "" : " (awaiting first entry)"}</div>
      {CURATED_COMMERCIAL.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
          <thead><tr><th style={{ padding: "6px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textAlign: "left" }}>Type</th>{th("Cap rate")}{th("Occupancy")}<th style={{ padding: "6px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textAlign: "left" }}>Source</th></tr></thead>
          <tbody>{CURATED_COMMERCIAL.map((r, i) => <tr key={i}><td style={{ padding: "6px 8px", fontSize: 11, fontFamily: fonts.mono, color: "#cbd5e1" }}>{r.type}</td>{td(pc0(r.capRate))}{td(pc0(r.occupancy, 0))}<td style={{ padding: "6px 8px", fontSize: 10, fontFamily: fonts.mono, color: DIM }}>{r.source} · {r.asOf}</td></tr>)}</tbody>
        </table>
      ) : (
        <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.6 }}>
          No verified private-market observations have been added yet. Broker surveys, transaction reports and property disclosures can add useful comparisons when geography, asset quality, observation date and the definition of NOI are matched.
        </div>
      )}
    </div>

    <InfoBox color={CYAN}>
      <strong style={{ color: "#cbd5e1" }}>Reading commercial.</strong> Connect effective rents and leased occupancy to operating expenses, capital needs and debt maturities. Lending surveys describe changes in standards; delinquency measures realized stress. Construction authorizations and spending do not establish delivery timing. Kastle attendance is a separate demand indicator. Use the Refinancing tab to test whether income and property value can support a new loan.
    </InfoBox>
  </>);
}

// ── Metro ───────────────────────────────────────────────────────────────────
function MetroView({ rents }) {
  const [list, setList] = useState([]);
  const [code, setCode] = useState(() => { try { return localStorage.getItem("re-metro") || "42660"; } catch { return "42660"; } });
  const [sortP2r, setSortP2r] = useState("desc");
  useEffect(() => { fetch("/api/re-metro").then(r => r.json()).then(d => setList(d.metros || [])).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem("re-metro", code); } catch {} }, [code]);
  // Netlify fork: addressed as a baked file path rather than a query string, so
  // it works identically in `npm run preview` and on Netlify. _redirects cannot
  // be exercised locally, so no data path is allowed to depend on it.
  const m = useJson(`/api/re-metro/${code}`);
  const cur = m && m.code === code ? m : null;
  const L = cur?.listing, cs = cur?.caseShiller, ur = cur?.unemployment, z = cur?.zillow;
  const natP2r = rents?.national?.p2r ?? null;
  const ranked = useMemo(() => { const arr = (rents?.metros || []).slice(0, 60); arr.sort((a, b) => (sortP2r === "desc" ? b.p2r - a.p2r : a.p2r - b.p2r)); return arr; }, [rents, sortP2r]);
  const sel = { padding: "7px 12px", borderRadius: 8, border: "1px solid rgba(129,140,248,0.4)", background: "rgba(129,140,248,0.12)", color: "#c7d2fe", fontSize: 12, fontFamily: fonts.mono, cursor: "pointer" };
  return (<>
    <SH>Metro — One Market at a Time</SH>
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      <select value={code} onChange={e => setCode(e.target.value)} style={sel}>
        {(list.length ? list : [{ code: "42660", name: "Seattle" }]).map(x => <option key={x.code} value={x.code} style={{ background: "#0f172a" }}>{x.name}</option>)}
      </select>
      <span style={note}>Realtor.com listing series (FRED), Case-Shiller metro index, BLS metro unemployment, Zillow value &amp; rent. Seattle is the default; the choice is remembered.</span>
    </div>
    {!cur ? <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading {list.find(x => x.code === code)?.name || "metro"} (first load pulls ~9 FRED series)…</div> : (<>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 10, marginBottom: 12 }}>
        <Stat title="Median listing price" value={usd(L.price)} color={fin(L.priceYoy) ? (L.priceYoy < 0 ? RED : L.priceYoy < 2 ? AMBER : GREEN) : SLATE} sub={`${pc(L.priceYoy)} YoY · $${L.ppsf?.toFixed(0)}/sq ft (${pc(L.ppsfYoy)})`} />
        <Stat title="Active listings" value={fin(L.active) ? L.active.toLocaleString() : "—"} color={fin(L.activeYoy) ? (L.activeYoy > 20 ? RED : L.activeYoy > 5 ? AMBER : GREEN) : SLATE} sub={`${pc(L.activeYoy, 0)} YoY · new listings ${pc(L.newYoy, 0)} YoY (${fin(L.newListings) ? L.newListings.toLocaleString() : "—"}/mo)`} />
        <Stat title="Listings with a price cut" value={pc0(L.reducedShare)} color={fin(L.reducedShare) ? (L.reducedShare > 35 ? RED : L.reducedShare > 25 ? AMBER : GREEN) : SLATE} sub={`${pc0(L.reducedShare1y)} a year ago · days on market ${L.dom ?? "—"} (${L.dom1y ?? "—"} a year ago)`} />
        <Stat title="Case-Shiller" value={cs ? pc(cs.yoy) : "n/a"} color={cs ? (cs.yoy < 0 ? RED : cs.yoy < 2 ? AMBER : GREEN) : SLATE} sub={cs ? `YoY vs 20-city ${pc(cs.yoyUs)} · ${pc(cs.fromPeak)} from the metro's peak · ${mon(cs.asOf)}` : "no Case-Shiller index for this metro"} />
        <Stat title="Unemployment" value={ur ? pc0(ur.cur) : "n/a"} color={ur ? (ur.cur >= 5.5 ? RED : ur.cur >= 4.5 ? AMBER : GREEN) : SLATE} sub={ur ? `${fin(ur.yr) ? `${ur.cur - ur.yr >= 0 ? "+" : ""}${(ur.cur - ur.yr).toFixed(1)} pts vs a year ago · ` : ""}${mon(ur.asOf)} · demand for housing follows jobs` : "no metro unemployment series"} />
        <Stat title="Price-to-rent (Zillow)" value={z ? `${z.p2r}×` : "n/a"} color={z && fin(natP2r) ? (z.p2r > natP2r * 1.25 ? RED : z.p2r > natP2r * 1.05 ? AMBER : GREEN) : SLATE} sub={z ? `value ${usd(z.zhvi)} (${pc(z.zhviYoy)}) ÷ rent ${usd0(z.zori)}/mo (${pc(z.zoriYoy)}) · gross yield ${pc0(z.yield)} · U.S. ${fin(natP2r) ? `${natP2r}×` : "—"}` : "not in the Zillow metro file"} />
      </div>
      <AsOf d={L.asOf} cadence="monthly" src="Realtor.com via FRED" />
      <div style={{ height: 8 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12 }}>
        {cs?.series?.length > 0 && <Series title={`Case-Shiller — ${cur.name} vs the 20-city composite (indexed, ${cs.since} = 100)`} data={cs.series} lines={[{ key: "metro", name: cur.name, color: INDIGO, width: 2.2 }, { key: "us", name: "20-city", color: SLATE }]} yFmt={v => Number(v).toFixed(0)} foot="Relative performance is the story: a metro that outran the composite into 2022 has more to give back; one that lagged has less air underneath." />}
        <Series title="Median listing price ($) and $/sq ft" data={L.series.map(r => ({ d: r.d, price: r.price, ppsf: r.ppsf }))} lines={[{ key: "price", name: "Listing price", color: INDIGO, width: 2 }]} yFmt={v => usd(v)} xFmt={d => String(d).slice(0, 7)} foot={`$/sq ft ${fin(L.ppsf) ? `$${L.ppsf.toFixed(0)}` : "—"} today (${pc(L.ppsfYoy)} YoY). Listing prices lead sale prices; watch the YoY sign.`} />
        <Series title="Active vs new listings (count) — is the market clearing?" data={L.series.map(r => ({ d: r.d, active: r.active, newListings: r.newListings }))} lines={[{ key: "active", name: "Active listings", color: AMBER, width: 2 }, { key: "newListings", name: "New listings / mo", color: GREEN }]} yFmt={v => `${(Number(v) / 1000).toFixed(1)}K`} xFmt={d => String(d).slice(0, 7)} foot="Active rising while new listings are flat means homes are sitting; both falling is the lock-in freeze." />
        <Series title="Share of listings with a price cut (%) and days on market" data={L.series.map(r => ({ d: r.d, reduced: r.reducedShare, dom: r.dom }))} lines={[{ key: "reduced", name: "Price-cut share (%)", color: RED, width: 2 }, { key: "dom", name: "Days on market", color: SLATE }]} yFmt={v => Number(v).toFixed(0)} xFmt={d => String(d).slice(0, 7)} foot="Sellers' capitulation and buyers' patience on one chart. A rising price-cut share with rising days on market is the pre-correction pairing." />
      </div>
    </>)}

    {ranked.length > 0 && (
      <div style={{ ...card, padding: "10px 12px", marginBottom: 12, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          <div style={label}>The 60 largest metros ranked on price-to-rent · U.S. {fin(natP2r) ? `${natP2r}×` : "—"}</div>
          <button onClick={() => setSortP2r(s => (s === "desc" ? "asc" : "desc"))} style={{ ...sel, padding: "4px 10px", fontSize: 10 }}>{sortP2r === "desc" ? "most expensive first ▾" : "cheapest first ▴"}</button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead><tr>{["Metro", "Home value", "YoY", "Rent / mo", "Rent YoY", "Price-to-rent", "Gross yield"].map((h, i) => <th key={h} style={{ padding: "6px 8px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: i ? "right" : "left", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>)}</tr></thead>
          <tbody>
            {ranked.map(r => {
              const c = fin(natP2r) ? (r.p2r > natP2r * 1.25 ? RED : r.p2r > natP2r * 1.05 ? AMBER : r.p2r < natP2r * 0.85 ? CYAN : GREEN) : SLATE;
              const isSel = list.find(x => x.code === code)?.z === r.name;
              const tdS = { padding: "5px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "#cbd5e1", whiteSpace: "nowrap" };
              return (
                <tr key={r.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: isSel ? "rgba(129,140,248,0.08)" : "transparent" }}>
                  <td style={{ ...tdS, textAlign: "left", color: isSel ? "#c7d2fe" : "#cbd5e1", fontWeight: isSel ? 700 : 400 }}>{r.name}<span style={{ color: DIM, marginLeft: 6, fontSize: 9 }}>#{r.rank}</span></td>
                  <td style={tdS}>{usd(r.zhvi)}</td>
                  <td style={{ ...tdS, color: r.zhviYoy < 0 ? RED : GREEN }}>{pc(r.zhviYoy)}</td>
                  <td style={tdS}>{usd0(r.zori)}</td>
                  <td style={{ ...tdS, color: r.zoriYoy < 0 ? RED : GREEN }}>{pc(r.zoriYoy)}</td>
                  <td style={{ ...tdS, color: c, fontWeight: 700 }}>{r.p2r.toFixed(1)}×</td>
                  <td style={tdS}>{pc0(r.yield)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ ...note, marginTop: 6 }}>Zillow typical value ÷ 12 × Zillow asking rent. Coastal metros run 25–35×, the Midwest and South 12–18×; a metro far above the U.S. ratio is priced for appreciation, not income. <AsOf d={rents?.asOf} cadence="monthly" src="Zillow ZHVI / ZORI metro files" /></div>
      </div>
    )}
  </>);
}

// ── State map: server-sourced metric cache ──────────────────────────────────
function buildServerCache({ redfin, rents, build, choroplethCache }) {
  const out = {};
  const put = (key, states, national) => { if (states && Object.keys(states).length) out[key] = { ...states, ...(national ? { _national: national } : {}) }; };
  if (redfin?.states) {
    const S = (f, scale = 1) => { const o = {}; for (const [st, r] of Object.entries(redfin.states)) if (fin(r[f])) o[st] = { v: r[f] * scale, d: r.d }; return o; };
    const l = redfin.national?.latest, ser = redfin.national?.series || [];
    const N = (f, scale = 1) => (l && fin(l[f]) ? { v: l[f] * scale, d: l.d } : null);
    const nYoy = ser.length > 12 && ser[ser.length - 13].price ? ((ser[ser.length - 1].price / ser[ser.length - 13].price) - 1) * 100 : null;
    put("rfSalePrice", S("price"), N("price"));
    put("rfSaleYoY", S("priceYoy", 100), fin(nYoy) ? { v: nYoy, d: l.d } : null);
    put("rfSaleToList", S("saleToList", 100), N("saleToList", 100));
    put("rfAboveList", S("aboveList", 100), N("aboveList", 100));
    put("rfPriceDrops", S("priceDrops", 100), N("priceDrops", 100));
    put("rfMonths", S("months"), N("months"));
    put("rfDom", S("dom"), N("dom"));
  }
  if (rents?.states) {
    const p2r = {}, yld = {};
    for (const [st, r] of Object.entries(rents.states)) { p2r[st] = { v: r.p2r, d: rents.asOf }; yld[st] = { v: r.yield, d: rents.asOf }; }
    put("rePriceToRent", p2r, fin(rents.national?.p2r) ? { v: rents.national.p2r, d: rents.asOf } : null);
    put("reGrossYield", yld, fin(rents.national?.yield) ? { v: rents.national.yield, d: rents.asOf } : null);
  }
  if (build?.states) {
    const o = {};
    for (const [st, b] of Object.entries(build.states)) o[st] = { v: b.cost, d: b.d };
    put("reBuildCost", o, { v: build.base.value, d: build.us.d });
  }
  const zh = choroplethCache?.zillowHomeValue, inc = choroplethCache?.medianIncome;
  if (zh && inc) {
    const o = {};
    for (const [st, v] of Object.entries(zh)) { if (st === "_national") continue; const i = inc[st]; if (v?.v && i?.v) o[st] = { v: v.v / i.v, d: v.d }; }
    put("rePriceToIncome", o, zh._national?.v && inc._national?.v ? { v: zh._national.v / inc._national.v, d: zh._national.d } : null);
  }
  const ppsf = choroplethCache?.rePriceSqft;
  if (ppsf && build?.states) {
    const o = {};
    for (const [st, p] of Object.entries(ppsf)) { if (st === "_national") continue; const b = build.states[st]; if (p?.v && b?.cost) o[st] = { v: (1 - b.cost / p.v) * 100, d: p.d }; }
    put("reLandShare", o, ppsf._national?.v ? { v: (1 - build.base.value / ppsf._national.v) * 100, d: ppsf._national.d } : null);
  }
  return out;
}

// ── Tab ─────────────────────────────────────────────────────────────────────
export default function RealEstateTab({ hd, md, zillowData, choroplethCache, choroplethMetric, setChoroplethMetric, fetchChoroplethData, choroplethLoading, choroplethProgress }) {
  const [view, setView] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const section = query.get('section');
    return ['fair','residential','commercial','metro','refinance','map'].includes(section) ? section : query.get('view') === 'research' ? 'metro' : 'fair';
  });
  const [metroView, setMetroView] = useState('comparison');
  const [property, setProperty] = useState({...DEFAULT_PROPERTY});
  const housing = useJson("/api/housing-health");
  const repl = useJson("/api/replacement-cost");
  const cre = useJson("/api/cre-fundamentals");
  const reit = useJson("/api/reit-caprates");
  const comp = useJson("/api/re-composite");
  const pipe = useJson("/api/re-pipeline");
  const redfin = useJson("/api/redfin");
  const rents = useJson("/api/re-rents");
  const credit = useJson("/api/cre-credit");
  const build = useJson("/api/re-buildcost");

  const serverCache = useMemo(() => buildServerCache({ redfin, rents, build, choroplethCache }), [redfin, rents, build, choroplethCache]);
  const mapCache = useMemo(() => ({ ...choroplethCache, ...serverCache }), [choroplethCache, serverCache]);

  // the map: keep the shared metric a real-estate one while this tab owns it; FRED-sourced
  // metrics load state by state, server-sourced ones only need their FRED prerequisites
  useEffect(() => {
    if (view !== "map") return;
    const key = RE_MAP_METRICS.some(m => m.key === choroplethMetric) ? choroplethMetric : RE_MAP_METRICS[0]?.key;
    if (key && key !== choroplethMetric) setChoroplethMetric(key);
    const m = RE_MAP_METRICS.find(x => x.key === key);
    if (!m) return;
    if (m.source === "server") { for (const dep of m.needs || []) fetchChoroplethData(dep); }
    else if (!m.source) fetchChoroplethData(key);
  }, [view, choroplethMetric, setChoroplethMetric, fetchChoroplethData]);

  const VIEWS = [["fair", "Valuation Context"], ["residential", "Residential"], ["commercial", "Commercial"], ["metro", "Metro Markets"], ["refinance", "Refinancing"], ["map", "State Map"]];
  return (<>
    <header className="market-masthead"><div><div className="market-edition">Ledger / Property research</div><h1>Real estate</h1><p>Income, supply and the cost of capital.</p></div><button onClick={() => setView('metro')}>Explore local markets ↗</button></header>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: "var(--bg-subtle)", borderRadius: 10, padding: 3, marginBottom: 18 }}>
      {VIEWS.map(([id, text]) => (
        <button key={id} onClick={() => setView(id)} style={{
          flex: "1 1 auto", padding: "8px 10px", border: "none", borderRadius: 8,
          background: view === id ? "linear-gradient(135deg, rgba(129,140,248,0.2), rgba(99,102,241,0.1))" : "transparent",
          color: view === id ? "var(--tab-active-color)" : "var(--tab-inactive-color)", fontSize: 12, fontWeight: view === id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.15s", borderBottom: view === id ? "2px solid #818cf8" : "2px solid transparent",
        }}>{text}</button>
      ))}
    </div>

    {view === "fair" && <FairValueView housing={housing} repl={repl} cre={cre} reit={reit} comp={comp} credit={credit} rents={rents} go={setView} />}
    {view === "residential" && <ResidentialView hd={hd} md={md} zillowData={zillowData} housing={housing} pipe={pipe} redfin={redfin} rents={rents} />}
    {view === "commercial" && <CommercialView cre={cre} reit={reit} credit={credit} />}
    {view === "metro" && <>
      <div className="property-research"><div className="lab-nav" aria-label="Metro market views">
        {[["comparison", "Market dashboard"], ["detail", "Local market detail"]].map(([id, text]) => <button key={id} aria-pressed={metroView === id} data-active={metroView === id} onClick={() => setMetroView(id)}>{text}</button>)}
      </div>{metroView === "comparison" && <MetroComparison />}</div>
      {metroView === "detail" && <MetroView rents={rents} />}
    </>}
    {view === "refinance" && <div className="property-research"><RefinancingView p={property} setP={setProperty} /></div>}
    {view === "map" && (<>
      <StateChoropleth title="State-Level Real Estate" metrics={RE_MAP_METRICS} metric={choroplethMetric} setMetric={setChoroplethMetric} cache={mapCache} loading={choroplethLoading} progress={choroplethProgress}
        note={`Prices: Realtor.com listing price and FHFA index (via FRED), Redfin median SALE price (${redfin?.asOf ? `latest ${mon(redfin.asOf)}` : "loading"}), Zillow typical value. Value: price-to-income (Zillow value ÷ Census median household income), price-to-rent and gross yield (Zillow metro ratios rolled up to states with Zipf weights, since Zillow publishes rents by metro), estimated build cost per sq ft (the national $${BUILD_COST_PER_SQFT.value} NAHB hard cost scaled by each state's construction hourly earnings, labor share 40%), listing $/sq ft vs that cost, and the price-minus-hard-cost residual (1 − build cost ÷ listing $/sq ft). It includes land, soft costs, financing, developer profit and measurement differences; it is not an observed land share. Tape: Redfin sale-to-list, sold-above-list, price-drop share, months of supply and days on market, plus Realtor.com days on market and active-listing growth. Vacancy: Census HVS, annual. State-level foreclosures and private cap rates have no free feed; the national delinquency series on the Commercial tab is the honest substitute.`} />
    </>)}
  </>);
}
