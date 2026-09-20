import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ReferenceLine, LabelList, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { InfoBox } from "../../components/shared.jsx";
import SubViews from "../../components/SubViews.jsx";

// ============================================================================
// FOREX — Donnelly's fundamentals chapter as four views.
//   Valuation      the long-term answer: how cheap or rich each currency is
//                  against the dollar on PPP, Big Mac, BIS REER and the IMF's
//                  External Sector Report, and the median of those.
//   Global drivers his four: world growth, commodities, risk aversion,
//                  geopolitics — the regime today, and each currency's measured
//                  sensitivity to it.
//   Scorecard      his three domestic drivers scored against the dollar —
//                  monetary policy split four ways, capital flows, trade —
//                  next to the long-term number, so the two horizons never get
//                  confused for each other.
//   Prices         the page as it was: trade-weighted dollar, pairs, YTD, table.
// Data: /api/fx-fundamentals (server/fxFundamentals.js).
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", VIOLET = "#a78bfa";
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const pc = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}%` : "—");
const pp = (v, dp = 2) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}pp` : "—");
const bp = v => (fin(v) ? `${sgn(v)}${Math.abs(Math.round(v * 100))}bp` : "—");
const num = (v, dp = 2) => (fin(v) ? v.toFixed(dp) : "—");
const fd = s => { if (!s) return "—"; const d = new Date(`${s.length === 7 ? s + "-01" : s}T00:00:00`); return isNaN(d) ? s : d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }); };
const th = (t, align = "right", extra = {}) => <th key={t} style={{ padding: "5px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap", ...extra }}>{t}</th>;
const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;
const Pill = ({ children, color = SLATE, title }) => <span title={title} style={{ fontSize: 8.5, fontFamily: fonts.mono, color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 5px", verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</span>;
const Dot = ({ color }) => <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: color, marginRight: 6, verticalAlign: "middle" }} />;
const rowStyle = { borderBottom: "1px solid rgba(255,255,255,0.04)" };
const toneUnder = v => (!fin(v) ? SLATE : v > 10 ? GREEN : v < -10 ? RED : v > 0 ? "#a3e635" : AMBER);
const toneScore = v => (v >= 2 ? GREEN : v === 1 ? "#a3e635" : v === 0 ? SLATE : v === -1 ? AMBER : RED);
const Score = ({ v, title }) => <Pill color={toneScore(v)} title={title}>{v > 0 ? `+${v}` : v}</Pill>;
const dirArrow = d => (d > 0 ? "▲" : d < 0 ? "▼" : "→");
const chip = (k, v, color = "#e2e8f0", sub) => (
  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, minWidth: 96 }}>
    <span style={{ ...label, fontSize: 8.5 }}>{k}</span><span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.3 }}>{v}</span>{sub && <span style={{ ...note, fontSize: 8.5 }}>{sub}</span>}
  </div>
);

// a −40…+40 bar with zero in the middle; green to the right is cheap
function GapBar({ v, lo, hi }) {
  if (!fin(v)) return <span style={{ color: DIM }}>—</span>;
  const x = p => `${clampPct(50 + p * 1.25)}%`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: 110, height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.18)" }} />
        {fin(lo) && fin(hi) && <div style={{ position: "absolute", left: x(Math.min(lo, hi)), width: `calc(${x(Math.max(lo, hi))} - ${x(Math.min(lo, hi))})`, top: 2, bottom: 2, background: `${toneUnder(v)}33`, borderRadius: 2 }} />}
        <div style={{ position: "absolute", left: `calc(${x(v)} - 2px)`, top: -2, width: 4, height: 12, borderRadius: 1, background: toneUnder(v) }} />
      </div>
      <span style={{ color: toneUnder(v), width: 48, textAlign: "right", fontWeight: 700 }}>{pc(v, 0)}</span>
    </div>
  );
}
const clampPct = p => Math.max(2, Math.min(98, p));

export default function ForexFundamentals({ prices }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState("valuation");
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/fx-fundamentals").then(r => r.json()).then(x => { if (!alive) return; if (x.error) setErr(x.error); else setD(x); }).catch(e => alive && setErr(String(e)));
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const rows = useMemo(() => (d ? d.currencies.filter(c => !c.error) : []), [d]);
  const byUnder = useMemo(() => [...rows].sort((a, b) => (b.valuation.under ?? -99) - (a.valuation.under ?? -99)), [rows]);
  const byTilt = useMemo(() => [...rows].sort((a, b) => b.domestic.scores.tilt - a.domestic.scores.tilt), [rows]);

  const pricesView = { id: "prices", label: "Prices", render: () => <>{prices}</> };
  if (err) return (<>{prices}<div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 14 }}>Fundamentals could not load: {err}</div></>);
  if (!d) {
    return (<>
      <div style={{ ...card, padding: "18px 22px", textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>Building the fundamentals — {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</div>
        <div style={{ ...note, marginTop: 6, maxWidth: 560, margin: "6px auto 0" }}>About sixty FRED series behind a shared rate limit, four IMF tables, the BIS real rates and the geopolitical-risk file. A minute or so the first time; cached six hours after that. The price views below work meanwhile.</div>
      </div>
      {prices}
    </>);
  }

  const U = d.usd, R = d.regime, Hd = d.headline;
  const drivers = [
    { key: "growth", name: "World growth", dir: R.growth.dir, read: fin(R.growth.world) ? `WEO ${R.growth.year}: ${num(R.growth.world, 1)}% (${num(R.growth.worldPrev, 1)}% prior)` : "—", extra: `copper 3m ${pc(R.growth.copper3m)} · S&P 3m ${pc(R.growth.spx3m)}`, favours: "risk-on and commodity currencies when rising; JPY, CHF, USD when falling" },
    { key: "commodities", name: "Commodity prices", dir: R.commodities.dir, read: fin(R.commodities.wti) ? `WTI $${num(R.commodities.wti, 0)} · 3m ${pc(R.commodities.wti3m)} · 12m ${pc(R.commodities.wti12m)}` : "—", extra: `copper 3m ${pc(R.commodities.copper3m)}`, favours: "exporters (CAD, NOK, AUD, BRL, MXN) when rising; importers (JPY, INR, KRW) when falling" },
    { key: "risk", name: "Risk aversion", dir: R.risk.dir, read: fin(R.risk.vix) ? `VIX ${num(R.risk.vix, 1)} (${sgn(R.risk.vix3m)}${num(Math.abs(R.risk.vix3m), 1)} on 3m) · HY ${num(R.risk.hy, 2)}% (${bp(R.risk.hy3m)})` : "—", extra: `S&P 3m ${pc(R.risk.spx3m)}`, favours: "JPY, CHF, USD when rising; AUD, NZD and EM when falling" },
    { key: "geopolitics", name: "Geopolitics", dir: R.geopolitics.dir, read: fin(R.geopolitics.v) ? `GPR ${num(R.geopolitics.v, 0)} (${fd(R.geopolitics.d)}) · vs 12m avg ${pc(R.geopolitics.vsAvg12, 0)}` : "—", extra: fin(R.geopolitics.pct) ? `${R.geopolitics.pct}th pct since 1985` : "", favours: "USD, CHF, JPY and gold when rising; EM and high-beta when calm" },
  ];
  const dirColor = (key, dir) => (dir === 0 ? SLATE : key === "risk" || key === "geopolitics" ? (dir > 0 ? RED : GREEN) : dir > 0 ? GREEN : RED);

  // ── header ────────────────────────────────────────────────────────────────
  const header = (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={label}>Currencies against the dollar · Donnelly&apos;s fundamentals</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 3 }}>
            {U.imf ? `The IMF puts the dollar ${pc(U.imf.gap, 1)} above fundamentals (±${U.imf.range})` : "Dollar valuation"} · {fin(U.basketOver) ? `the fourteen average ${pc(U.basketOver, 0)} cheap against it` : ""}
          </div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5 }}>
            Cheapest: {Hd.cheapest.map(c => `${c.ccy} ${pc(c.under, 0)}`).join(" · ")} — richest: {Hd.richest.map(c => `${c.ccy} ${pc(c.under, 0)}`).join(" · ")}.
            {Hd.bullish.length ? ` Short-term drivers favour ${Hd.bullish.join(", ")}` : " No currency has strongly favourable short-term drivers"}{Hd.bearish.length ? `; against ${Hd.bearish.join(", ")}` : ""}.
          </div>
        </div>
        <div style={{ ...note, textAlign: "right" }}>built {new Date(d.built).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} in {d.buildSecs}s · IMF ESR {d.esr ? `${fd(d.esr.published)} (${d.esr.dataYear} data)` : "—"} · stances reviewed {fd(d.stanceReviewed)}</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {chip("dollar · IMF REER gap", U.imf ? pc(U.imf.gap, 1) : "—", U.imf && U.imf.gap > 5 ? RED : SLATE, U.imf ? `${U.imf.assessment} · CA gap ${pp(U.imf.caGap, 1)} of GDP` : "")}
        {chip("dollar · REER vs 10y", U.reer ? pc(U.reer.vs10y, 1) : "—", U.reer && U.reer.vs10y > 5 ? RED : SLATE, U.reer ? `vs 20y ${pc(U.reer.vs20y, 1)} · ${fd(U.reer.d)}` : "")}
        {chip("basket cheapness", pc(U.basketOver, 0), toneUnder(U.basketOver), "average of 14 composites")}
        {drivers.map(x => chip(x.name, `${dirArrow(x.dir)} ${x.dir > 0 ? "rising" : x.dir < 0 ? "falling" : "flat"}`, dirColor(x.key, x.dir), x.read.length > 34 ? x.read.slice(0, 34) + "…" : x.read))}
        {chip("US rates", `${num(U.policy, 2)}% / ${num(U.y10, 2)}%`, "#e2e8f0", `policy / 10y · CPI ${num(U.inflation, 1)}% · CA ${pp(U.ca, 1)}`)}
      </div>
    </div>
  );

  const Board = ({ intro, cols, children, foot }) => (
    <div style={{ ...card, padding: "10px 10px 6px" }}>
      {intro && <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, lineHeight: 1.55, padding: "2px 4px 8px" }}>{intro}</div>}
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{cols.map(([t, a]) => th(t, a))}</tr></thead><tbody>{children}</tbody></table></div>
      {foot && <div style={{ ...note, padding: "6px 4px 2px" }}>{foot}</div>}
    </div>
  );
  const Ccy = ({ c }) => <><span style={{ marginRight: 6 }}>{c.flag}</span><span style={{ fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.mono }}>{c.ccy}</span><span style={{ color: DIM, marginLeft: 6, fontSize: 9.5 }}>{c.name}</span>{c.haven && <Pill color={CYAN}>haven</Pill>}{c.em && <Pill color={VIOLET}>EM</Pill>}</>;

  // ── valuation ─────────────────────────────────────────────────────────────
  const valuation = () => {
    const cols = [["Currency", "left"], ["Spot", "right"], ["12m", "right"], ["Composite · cheap vs USD →", "left"], ["PPP", "right"], ["Big Mac", "right"], ["REER", "right"], ["IMF ESR", "right"], ["Verdict", "left"]];
    return (<>
      <Board cols={cols}
        intro={<>Positive means the currency is <b>cheap against the dollar</b>; the composite is the median of the lenses that exist for it, the shaded band their spread. PPP is the IMF&apos;s implied conversion rate against spot — struck through for the five EM currencies, where raw PPP always flatters the poorer economy (Balassa–Samuelson) and the GDP-adjusted Big Mac does that job instead. Big Mac is The Economist&apos;s GDP-adjusted reading re-marked at today&apos;s rate. REER is the BIS real effective rate against its own ten-year average, expressed relative to the dollar&apos;s same deviation. IMF ESR is the External Sector Report&apos;s staff gap, likewise relative to the dollar&apos;s ({U.imf ? pc(U.imf.gap, 1) : "—"}). Donnelly&apos;s caveat stands: this is where a currency should be over years, and says nothing about the next twelve months.</>}
        foot={`IMF WEO PPP rates (current-year estimate) · The Economist Big Mac via the International pulse · BIS REER monthly · IMF ${d.esr ? d.esr.report.replace(/:.*/, "") : "ESR"}, ${d.esr?.dataYear} data, published ${fd(d.esr?.published)}. NOK and NZD are not ESR economies. A lens shown as — did not exist for that currency.`}>
        {byUnder.map(c => {
          const v = c.valuation, L = v.lenses, D = v.detail;
          return (
            <tr key={c.ccy} style={rowStyle}>
              {td(<><Dot color={toneUnder(v.under)} /><Ccy c={c} /></>, "#cbd5e1", { textAlign: "left" })}
              {td(<span title={`${c.spot.usdPer} USD per unit · ${c.spot.localPerUsd} per USD · ${fd(c.spot.d)}`}>{c.spot.usdQuoted ? num(c.spot.usdPer, 4) : `${c.spot.localPerUsd} /$`}</span>)}
              {td(pc(c.spot.chg12m), fin(c.spot.chg12m) && c.spot.chg12m > 0 ? GREEN : fin(c.spot.chg12m) ? RED : SLATE)}
              {td(<GapBar v={v.under} lo={v.low} hi={v.high} />, "#cbd5e1", { textAlign: "left" })}
              {td(<span title={D.ppp ? `IMF PPP ${D.ppp.rate} per intl $ (${D.ppp.year}) vs spot ${c.spot.localPerUsd}${v.pppExcluded ? " · raw PPP flatters poorer economies (Balassa–Samuelson); shown, not in the composite" : ""}` : "no PPP rate"} style={v.pppExcluded ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>{pc(L.ppp, 0)}</span>, toneUnder(L.ppp))}
              {td(<span title={D.bigMac ? `GDP-adjusted ${pc(D.bigMac.adj)} · raw ${pc(D.bigMac.raw)} (Economist convention, negative = cheap)` : "not in the index"}>{pc(L.bigMac, 0)}</span>, toneUnder(L.bigMac))}
              {td(<span title={D.reer ? `BIS REER ${D.reer.v} (${fd(D.reer.d)}) · vs 10y avg ${pc(D.reer.vs10y)} · vs 20y ${pc(D.reer.vs20y)} · dollar vs 10y ${pc(D.reer.usVs10y)}` : "no REER"}>{pc(L.reer, 0)}</span>, toneUnder(L.reer))}
              {td(<span title={D.imf ? `IMF staff REER gap ${pc(D.imf.gap)} ±${D.imf.range} (${D.imf.assessment}) · CA gap ${pp(D.imf.caGap, 1)} · dollar gap ${pc(D.imf.usGap)}` : "not an ESR economy"}>{pc(L.imf, 0)}</span>, toneUnder(L.imf))}
              {td(<><span style={{ color: toneUnder(v.under) }}>{v.verdict}</span><span style={{ color: DIM }}> · {v.n} lens{v.n === 1 ? "" : "es"}</span></>, SLATE, { textAlign: "left" })}
            </tr>
          );
        })}
      </Board>
    </>);
  };

  // Recharts renders an empty tooltip box for a scatter driven by `formatter`,
  // because the payload carries no named series — so the card is built here.
  const SensHover = ({ active, payload, rows: rs }) => {
    const p = active && payload?.length ? payload[0].payload : null;
    const c = p ? (rs || []).find(x => x.ccy === p.ccy) : null;
    if (!c) return null;
    return (
      <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{c.flag} {c.ccy}<span style={{ color: SLATE, fontWeight: 400, marginLeft: 6 }}>{c.name}</span></div>
        <div style={{ fontSize: 10.5, marginTop: 3 }}>risk: corr {num(c.sensitivity.riskCorr)} · β {num(c.sensitivity.riskBeta)}</div>
        <div style={{ fontSize: 10.5 }}>commodities: corr {num(c.sensitivity.cmdtyCorr)} · β {num(c.sensitivity.cmdtyBeta)}</div>
        <div style={{ fontSize: 10.5, color: toneUnder(c.valuation.under), marginTop: 3 }}>{pc(c.valuation.under, 0)} vs the dollar · {c.valuation.verdict}</div>
      </div>
    );
  };

  // ── global drivers ────────────────────────────────────────────────────────
  const globalView = () => {
    const cols = [["Currency", "left"], ["Risk corr", "right"], ["Risk β", "right"], ["Cmdty corr", "right"], ["Cmdty β", "right"], ["Growth", "right"], ["Commodities", "right"], ["Risk aversion", "right"], ["Geopolitics", "right"], ["Global tilt", "right"]];
    const scatter = rows.filter(c => fin(c.sensitivity.riskCorr) && fin(c.sensitivity.cmdtyCorr)).map(c => ({ ccy: c.ccy, x: c.sensitivity.riskCorr, y: c.sensitivity.cmdtyCorr, z: 1 }));
    return (<>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(230px, 100%), 1fr))", gap: 10, marginBottom: 10 }}>
        {drivers.map(x => (
          <div key={x.key} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={label}>{x.name}</span><span style={{ fontSize: 14, fontWeight: 800, color: dirColor(x.key, x.dir), fontFamily: fonts.heading }}>{dirArrow(x.dir)} {x.dir > 0 ? "rising" : x.dir < 0 ? "falling" : "flat"}</span></div>
            <div style={{ fontSize: 11, color: "#e2e8f0", fontFamily: fonts.mono, marginTop: 6 }}>{x.read}</div>
            <div style={{ ...note, marginTop: 2 }}>{x.extra}</div>
            <div style={{ ...note, marginTop: 6, color: SLATE }}>Favours {x.favours}.</div>
            <div style={{ fontSize: 10, fontFamily: fonts.mono, marginTop: 6 }}>
              <span style={{ color: GREEN }}>+ {rows.filter(c => c.global[x.key] > 0).map(c => c.ccy).join(" ") || "—"}</span>
              <span style={{ color: RED, marginLeft: 10 }}>− {rows.filter(c => c.global[x.key] < 0).map(c => c.ccy).join(" ") || "—"}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 10, alignItems: "start" }}>
        <div style={{ ...card, padding: "10px 10px 4px" }}>
          <div style={{ ...label, paddingLeft: 4 }}>Measured sensitivity · 52 weeks</div>
          <ResponsiveContainer width="100%" height={250}>
            <ScatterChart margin={{ top: 14, right: 14, bottom: 8, left: -14 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" dataKey="x" domain={[-0.8, 0.8]} tick={{ fontSize: 9, fill: "#64748b", fontFamily: fonts.mono }} label={{ value: "corr with S&P 500 (risk)", position: "insideBottom", offset: -2, fontSize: 9, fill: "#64748b" }} />
              <YAxis type="number" dataKey="y" domain={[-0.6, 0.6]} tick={{ fontSize: 9, fill: "#64748b", fontFamily: fonts.mono }} label={{ value: "corr with WTI", angle: -90, position: "insideLeft", offset: 22, fontSize: 9, fill: "#64748b" }} />
              <ZAxis dataKey="z" range={[40, 40]} />
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)" /><ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
              <Tooltip cursor={false} content={<SensHover rows={rows} />} />
              <Scatter data={scatter} fill={INDIGO}><LabelList dataKey="ccy" position="top" style={{ fontSize: 9, fill: "#cbd5e1", fontFamily: fonts.mono }} /></Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ ...note, padding: "0 4px 4px" }}>Top-right is a commodity risk currency; bottom-left a haven. Weekly returns of each currency against the dollar, regressed on the S&amp;P 500 and on WTI.</div>
        </div>
        <Board cols={cols}
          intro={<>Donnelly&apos;s four global drivers act on a currency through its sensitivities, so those are measured rather than assumed: a positive risk correlation is a currency that sells off when stocks do. Each driver&apos;s cell is its direction today crossed with the currency&apos;s sensitivity; the tilt is the sum.</>}
          foot="Correlations and betas from 52 weekly returns (FRED H.10 daily rates, S&P 500, WTI). Geopolitics uses the book's haven list (JPY, CHF) and the EM tag rather than a beta, because the GPR index is monthly.">
          {[...rows].sort((a, b) => b.global.tilt - a.global.tilt).map(c => (
            <tr key={c.ccy} style={rowStyle}>
              {td(<Ccy c={c} />, "#cbd5e1", { textAlign: "left" })}
              {td(num(c.sensitivity.riskCorr), fin(c.sensitivity.riskCorr) && Math.abs(c.sensitivity.riskCorr) > 0.3 ? "#e2e8f0" : SLATE)}
              {td(num(c.sensitivity.riskBeta))}
              {td(num(c.sensitivity.cmdtyCorr), fin(c.sensitivity.cmdtyCorr) && Math.abs(c.sensitivity.cmdtyCorr) > 0.25 ? "#e2e8f0" : SLATE)}
              {td(num(c.sensitivity.cmdtyBeta))}
              {td(<Score v={c.global.growth} />)}{td(<Score v={c.global.commodities} />)}{td(<Score v={c.global.risk} />)}{td(<Score v={c.global.geopolitics} />)}
              {td(<span style={{ color: toneScore(Math.max(-2, Math.min(2, c.global.tilt))), fontWeight: 700 }}>{c.global.tilt > 0 ? `+${c.global.tilt}` : c.global.tilt}</span>)}
            </tr>
          ))}
        </Board>
      </div>
    </>);
  };

  // ── scorecard ─────────────────────────────────────────────────────────────
  const scorecard = () => {
    const cols = [["Currency", "left"], ["Long-term", "right"], ["Policy", "right"], ["10y diff", "right"], ["Δ3m", "right"], ["Real diff", "right"], ["Bal. sheet", "right"], ["Inflation", "right"], ["CB prefers", "left"], ["Monetary", "right"], ["Equity rel.", "right"], ["Flows", "right"], ["CA %GDP", "right"], ["Trade", "right"], ["Short-term", "left"]];
    return (
      <Board cols={cols}
        intro={<>His three domestic drivers, each scored against the dollar. <b>Monetary policy</b> is split his way: the three-month change in the 10-year differential as the expectations proxy (±25bp), the real 10-year differential (±1pp), balance-sheet growth relative to the Fed&apos;s where a series exists (±5pp), and the central bank&apos;s own preference — which is judgment, dated, and editable. <b>Capital flows</b> are proxied by the local equity market in dollars against the S&amp;P year to date (±5pp). <b>Trade</b> is the IMF&apos;s current account (±2% of GDP) plus terms of trade when the commodity move is large and the currency is sensitive to it. The long-term column is the valuation composite, kept beside the short-term tilt so neither is mistaken for the other.</>}
        foot={`10-year yields: OECD via FRED, monthly (China and Brazil have none). Inflation: this year's IMF WEO estimate unless a fresh monthly print exists. Balance sheets: Fed, ECB, BoJ only. Central-bank stances reviewed ${fd(d.stanceReviewed)} — hover for the reasoning. Tilt ≥ +3 reads bullish, ≤ −3 bearish.`}>
        {byTilt.map(c => {
          const D = c.domestic, S = D.scores;
          const tiltColor = S.tilt >= 3 ? GREEN : S.tilt <= -3 ? RED : S.tilt > 0 ? "#a3e635" : S.tilt < 0 ? AMBER : SLATE;
          return (
            <tr key={c.ccy} style={rowStyle}>
              {td(<Ccy c={c} />, "#cbd5e1", { textAlign: "left" })}
              {td(pc(c.valuation.under, 0), toneUnder(c.valuation.under))}
              {td(<span title={D.policy ? `${D.policy.src} · ${fd(D.policy.d)}` : ""}>{D.policy ? `${num(D.policy.v, 2)}% (${pp(D.policy.diff, 2)})` : "—"}</span>)}
              {td(D.y10 ? `${num(D.y10.v, 2)}% (${pp(D.y10.diff, 2)})` : "—")}
              {td(bp(D.y10?.diff3m), fin(D.y10?.diff3m) ? (D.y10.diff3m > 0.25 ? GREEN : D.y10.diff3m < -0.25 ? RED : SLATE) : DIM)}
              {td(pp(D.realDiff), fin(D.realDiff) ? (D.realDiff > 1 ? GREEN : D.realDiff < -1 ? RED : SLATE) : DIM)}
              {td(D.balanceSheet ? <span title={`own ${pc(D.balanceSheet.yoy)} yoy · Fed ${pc(D.balanceSheet.fedYoy)} yoy`}>{pc(D.balanceSheet.yoy, 0)} <span style={{ color: DIM }}>({pp(D.balanceSheet.rel, 0)})</span></span> : <span style={{ color: DIM }}>n/a</span>)}
              {td(D.inflation ? <span title={D.inflation.src}>{num(D.inflation.v, 1)}%</span> : "—")}
              {td(D.stance ? <span title={`${D.stance.bank}: ${D.stance.note}`} style={{ color: D.stance.stance > 0 ? "#a3e635" : D.stance.stance < 0 ? AMBER : SLATE, cursor: "help", borderBottom: "1px dotted rgba(255,255,255,0.2)" }}>{D.stance.label}</span> : "—", SLATE, { textAlign: "left" })}
              {td(<Score v={S.monetary.total} title={`expectations ${sgn(S.monetary.expectations)}${Math.abs(S.monetary.expectations)} · real ${sgn(S.monetary.real)}${Math.abs(S.monetary.real)} · balance sheet ${sgn(S.monetary.balanceSheet)}${Math.abs(S.monetary.balanceSheet)} · stance ${sgn(S.monetary.stance)}${Math.abs(S.monetary.stance)}`} />)}
              {td(<span title="local index in USD vs S&P 500, year to date">{pp(D.eqRel, 0)}</span>, fin(D.eqRel) ? (D.eqRel > 5 ? GREEN : D.eqRel < -5 ? RED : SLATE) : DIM)}
              {td(<Score v={S.flows} />)}
              {td(D.ca ? <span title={`IMF WEO ${D.ca.year}`}>{pp(D.ca.v, 1)}</span> : "—", fin(D.ca?.v) ? (D.ca.v > 2 ? GREEN : D.ca.v < -2 ? RED : SLATE) : DIM)}
              {td(<Score v={S.trade.total} title={`current account ${sgn(S.trade.level)}${Math.abs(S.trade.level)} · terms of trade ${sgn(S.trade.termsOfTrade)}${Math.abs(S.trade.termsOfTrade)}`} />)}
              {td(<><span style={{ color: tiltColor, fontWeight: 700 }}>{S.tilt > 0 ? `+${S.tilt}` : S.tilt}</span><span style={{ color: tiltColor, marginLeft: 6 }}>{D.tiltLabel}</span></>, SLATE, { textAlign: "left" })}
            </tr>
          );
        })}
      </Board>
    );
  };

  const views = [
    { id: "valuation", label: "Valuation · long term", render: valuation },
    { id: "global", label: "Global drivers", render: globalView },
    { id: "scorecard", label: "Domestic scorecard · short term", render: scorecard },
    pricesView,
  ];
  const accent = { valuation: GREEN, global: CYAN, scorecard: AMBER, prices: INDIGO }[view] || INDIGO;

  return (<>
    {header}
    <SubViews views={views} view={view} onChange={setView} accent={accent} />
    {view !== "prices" && (
      <div style={{ marginTop: 14 }}>
        <InfoBox color={INDIGO}>
          <b>How to read this.</b> Donnelly separates what a currency is worth (years) from what moves it (months). The valuation view is the first; the global drivers and the domestic scorecard are the second. A currency can be badly undervalued and still fall for a year because its central bank is cutting into a risk-off tape — the point of showing both is to keep that straight. {d.source}
        </InfoBox>
      </div>
    )}
  </>);
}
