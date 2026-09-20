import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { SH, InfoBox } from "../../components/shared.jsx";

// ============================================================================
// INTERNATIONAL PULSE — the International tab's landing, cockpit-style
// One board for thirteen economies (equity local and in USD, currency,
// policy / 10-year / real rates, unemployment, GDP momentum, BIS real
// exchange rate vs its 10-year average, Big Mac valuation), three scores
// (dollar, risk appetite, growth breadth) with verdicts, the dollar and EM-
// spread context charts, and the Big Mac index for all 54 currencies — The
// Economist's July print and a re-mark at today's exchange rates.
// Data: /api/intl-pulse (server-cached 3h).
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee";
const TONE = { green: GREEN, amber: AMBER, red: RED };
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const pc = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}%` : "—");
const pc0 = (v, dp = 2) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
const pp = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}` : "—");
const upDown = (v, good = 1) => (!fin(v) || v === 0 ? SLATE : (v > 0) === (good > 0) ? GREEN : RED);
const valTone = v => (!fin(v) ? SLATE : v < -25 ? CYAN : v < -5 ? GREEN : v <= 5 ? SLATE : v <= 25 ? AMBER : RED);

function Spark({ values, color, w = 72, h = 18 }) {
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
function VerdictCard({ s }) {
  if (!s) return null;
  const c = TONE[s.tone];
  return (
    <div style={{ ...card, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: c }} />
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c, fontFamily: fonts.heading, letterSpacing: -0.3 }}>{s.label}</div>
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

// ── the country board ────────────────────────────────────────────────────────
const COLS = [
  { key: "name", label: "Economy", align: "left" }, { key: "eqYtd", label: "Equity YTD" }, { key: "eq1y", label: "1 yr" }, { key: "usd1y", label: "1 yr in USD" }, { key: "spark", label: "52 wks", align: "center" },
  { key: "fx1y", label: "FX vs $ 1 yr" }, { key: "policy", label: "Policy" }, { key: "y10", label: "10-yr" }, { key: "real", label: "Real 10-yr" }, { key: "unemp", label: "Unemp." }, { key: "gdp", label: "GDP q/q" }, { key: "reer", label: "Real FX vs 10y" }, { key: "bmRaw", label: "Big Mac" }, { key: "bmAdj", label: "GDP-adj." },
];
function Board({ rows, sortKey, setSortKey }) {
  const th = (c) => <th key={c.key} onClick={() => c.key !== "spark" && setSortKey(s => ({ key: c.key, asc: s.key === c.key ? !s.asc : c.key === "name" }))} style={{ padding: "5px 6px", fontSize: 8.5, color: sortKey.key === c.key ? "#c7d2fe" : DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: c.align || "right", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap", cursor: c.key === "spark" ? "default" : "pointer", userSelect: "none" }}>{c.label}{sortKey.key === c.key ? (sortKey.asc ? " ▲" : " ▼") : ""}</th>;
  const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;
  return (
    <div style={{ ...card, padding: "6px 8px", overflowX: "auto", marginBottom: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
        <thead><tr>{COLS.map(th)}</tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.code} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(129,140,248,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{r.flag} <strong>{r.name}</strong><span style={{ color: DIM, fontSize: 8.5, marginLeft: 6 }}>{r.indexName}</span></td>
              {td(pc(r.eq?.ytd), upDown(r.eq?.ytd))}{td(pc(r.eq?.r1y), upDown(r.eq?.r1y))}{td(pc(r.eq?.usd1y), upDown(r.eq?.usd1y), { fontWeight: 700 })}
              <td style={{ padding: "2px 6px", textAlign: "center" }}><Spark values={r.eq?.spark} color={upDown(r.eq?.r1y)} /></td>
              {td(r.code === "US" ? "—" : pc(r.fx?.r1y), r.code === "US" ? DIM : upDown(r.fx?.r1y))}
              {td(r.policy ? pc0(r.policy.v) : "—", "var(--text-primary)", { title: r.policy ? `${r.policy.src === "live" ? "central-bank feed" : "FRED"} · ${r.policy.d}` : "" })}
              {td(r.y10 ? pc0(r.y10.v) : "—", "var(--text-primary)", { title: r.y10 ? `6-mo change ${pp(r.y10.chg6m, 2)}pp · ${r.y10.d}` : "no 10-year series on FRED" })}
              {td(fin(r.real10y) ? pc0(r.real10y) : "—", fin(r.real10y) ? (r.real10y > 1 ? GREEN : r.real10y > 0 ? SLATE : RED) : DIM, { title: r.cpi ? `10-yr minus CPI ${r.cpi.v}% (${r.cpi.d})` : "inflation series not fresh enough for a real yield" })}
              {td(r.unemp ? `${r.unemp.v}%${fin(r.unemp.chg1y) ? ` ${r.unemp.chg1y > 0 ? "▲" : r.unemp.chg1y < 0 ? "▼" : "•"}` : ""}` : "—", r.unemp ? (fin(r.unemp.chg1y) && r.unemp.chg1y > 0.3 ? RED : "#cbd5e1") : DIM, { title: r.unemp ? `${pp(r.unemp.chg1y)}pp vs a year ago · ${r.unemp.d}` : "" })}
              {td(r.gdp ? pc(r.gdp.qoq) : "—", upDown(r.gdp?.qoq), { title: r.gdp ? `latest quarter, not annualized · ${r.gdp.d}` : "no fresh quarterly GDP on FRED" })}
              {td(r.reer ? pc(r.reer.vsAvg, 0) : "—", r.reer ? (r.reer.vsAvg > 10 ? RED : r.reer.vsAvg < -10 ? GREEN : "#cbd5e1") : DIM, { title: r.reer ? `BIS real effective exchange rate ${r.reer.v} (p${r.reer.pct} of 10y) · ${r.reer.d}` : "" })}
              {td(r.bigmac ? pc(r.bigmac.rawNow, 0) : "—", valTone(r.bigmac?.rawNow), { title: r.bigmac ? `raw index at today's FX; July print ${pc(r.bigmac.raw, 0)}` : "not in the Big Mac index" })}
              {td(r.bigmac && fin(r.bigmac.adjNow) ? pc(r.bigmac.adjNow, 0) : "—", valTone(r.bigmac?.adjNow), { title: r.bigmac ? `GDP-adjusted at today's FX; July print ${pc(r.bigmac.adj, 0)}` : "" })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Big Mac: all 54 currencies ───────────────────────────────────────────────
function BigMacPanel({ bm, s }) {
  const [mode, setMode] = useState("rawNow");
  const [onlyTracked, setOnlyTracked] = useState(false);
  const list = useMemo(() => (bm || []).filter(b => b.ccy !== "USD" && fin(b[mode]) && (!onlyTracked || b.tracked)).sort((a, b) => b[mode] - a[mode]), [bm, mode, onlyTracked]);
  if (!bm?.length || !s) return null;
  const btn = (on) => ({ padding: "4px 9px", borderRadius: 6, border: on ? "1px solid rgba(129,140,248,0.6)" : "1px solid rgba(255,255,255,0.1)", background: on ? "rgba(129,140,248,0.18)" : "transparent", color: on ? "#c7d2fe" : SLATE, fontSize: 10, fontFamily: fonts.mono, cursor: "pointer" });
  const maxAbs = Math.max(30, ...list.map(b => Math.abs(b[mode])));
  return (<>
    <SH>Big Mac Index — Currency Valuation Against the Dollar</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12, marginBottom: 12, alignItems: "start" }}>
      <div style={{ ...card, padding: "10px 12px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          {[["rawNow", "Raw · today's FX"], ["raw", `Raw · ${s.asOf.slice(0, 7)} print`], ["adjNow", "GDP-adjusted · today's FX"], ["adj", `GDP-adjusted · ${s.asOf.slice(0, 7)} print`]].map(([k, t]) => <button key={k} onClick={() => setMode(k)} style={btn(mode === k)}>{t}</button>)}
          <button onClick={() => setOnlyTracked(o => !o)} style={btn(onlyTracked)}>{onlyTracked ? "13 tracked" : "all currencies"}</button>
          <span style={note}>{list.length} currencies · negative = undervalued vs the dollar</span>
        </div>
        <div style={{ maxHeight: 460, overflowY: "auto", paddingRight: 4 }}>
          {list.map(b => {
            const v = b[mode], c = valTone(v);
            return (
              <div key={b.iso3} title={`${b.name}: Big Mac ${b.localPrice.toLocaleString()} ${b.ccy} = $${b.dollarPriceNow} at ${b.fxNow} ${b.ccy}/$ (${b.fxSource === "live" ? "live" : "July"} rate) vs $${s.usPrice} in the U.S. · PPP rate ${b.pppRate} · FX since July ${pc(b.fxMove)}`} style={{ display: "grid", gridTemplateColumns: "150px 1fr 56px", alignItems: "center", gap: 8, height: 17 }}>
                <span style={{ fontSize: 10, fontFamily: fonts.mono, color: b.tracked ? "#e2e8f0" : SLATE, fontWeight: b.tracked ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name} <span style={{ color: DIM, fontSize: 8.5 }}>{b.ccy}</span></span>
                <div style={{ position: "relative", height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>
                  <div style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 12, background: "rgba(255,255,255,0.25)" }} />
                  <div style={{ position: "absolute", top: 0, height: "100%", borderRadius: 3, background: c, opacity: 0.85, left: v >= 0 ? "50%" : `${50 - (Math.abs(v) / maxAbs) * 50}%`, width: `${(Math.abs(v) / maxAbs) * 50}%` }} />
                </div>
                <span style={{ fontSize: 10, fontFamily: fonts.mono, fontWeight: 700, color: c, textAlign: "right" }}>{pc(v, 0)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={card}>
          <div style={label}>The dollar, in burgers</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.6, marginTop: 4 }}>{s.underRaw} of {s.n}</div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, lineHeight: 1.5 }}>currencies are undervalued against the dollar on the raw index at today&apos;s rates ({s.underAdj} of {s.n} after adjusting for GDP per head). Median valuation {pc(s.medianRaw, 0)}. A U.S. Big Mac costs ${s.usPrice}.</div>
        </div>
        <div style={card}>
          <div style={label}>Most undervalued · most overvalued (raw, today&apos;s FX)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
            <div>{s.cheapest.map(x => <div key={x.ccy} style={{ fontSize: 10.5, fontFamily: fonts.mono, color: "#cbd5e1", display: "flex", justifyContent: "space-between" }}><span>{x.name}</span><strong style={{ color: GREEN }}>{pc(x.rawNow, 0)}</strong></div>)}</div>
            <div>{s.priciest.map(x => <div key={x.ccy} style={{ fontSize: 10.5, fontFamily: fonts.mono, color: "#cbd5e1", display: "flex", justifyContent: "space-between" }}><span>{x.name}</span><strong style={{ color: RED }}>{pc(x.rawNow, 0)}</strong></div>)}</div>
          </div>
        </div>
        {s.movers?.length > 0 && (
          <div style={card}>
            <div style={label}>Biggest FX moves since the {s.asOf.slice(0, 7)} print</div>
            {s.movers.map(m => <div key={m.ccy} style={{ fontSize: 10.5, fontFamily: fonts.mono, color: "#cbd5e1", display: "flex", justifyContent: "space-between", marginTop: 3 }}><span>{m.name} <span style={{ color: DIM }}>{m.ccy}</span></span><span><span style={{ color: m.fxMove > 0 ? GREEN : RED }}>{pc(m.fxMove)}</span> <span style={{ color: DIM }}>· {pc(m.raw, 0)} → {pc(m.rawNow, 0)}</span></span></div>)}
            <div style={{ ...note, marginTop: 6 }}>positive = the currency strengthened against the dollar since July, which raises its burger price in dollars</div>
          </div>
        )}
        <div style={note}>Source: The Economist&apos;s open Big Mac data (July {s.asOf.slice(0, 4)} print, {s.n + 1} economies), re-marked here with live Yahoo exchange rates for {s.liveShare}% of currencies (the rest keep the July rate). Raw = local burger price in dollars vs the U.S. price. GDP-adjusted = vs the price the country&apos;s GDP per head would predict, which removes the &quot;poor countries are cheap&quot; effect and is the better fair-value read. Burger prices are updated twice a year; between prints only the exchange rate moves.</div>
      </div>
    </div>
  </>);
}

function IntlPulseTab({ go }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [sortKey, setSortKey] = useState({ key: "usd1y", asc: false });
  useEffect(() => { fetch("/api/intl-pulse").then(r => r.json()).then(x => (x && !x.error ? setD(x) : setErr(x?.error || "unavailable"))).catch(e => setErr(e.message)); }, []);
  const rows = useMemo(() => {
    if (!d) return [];
    const get = r => ({ name: r.name, eqYtd: r.eq?.ytd, eq1y: r.eq?.r1y, usd1y: r.eq?.usd1y, fx1y: r.fx?.r1y, policy: r.policy?.v, y10: r.y10?.v, real: r.real10y, unemp: r.unemp?.v, gdp: r.gdp?.qoq, reer: r.reer?.vsAvg, bmRaw: r.bigmac?.rawNow, bmAdj: r.bigmac?.adjNow })[sortKey.key];
    const dir = sortKey.asc ? 1 : -1;
    return [...d.rows].sort((a, b) => { const x = get(a), y = get(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir; });
  }, [d, sortKey]);
  if (err) return <div style={{ ...card, color: RED, fontFamily: fonts.mono, fontSize: 12 }}>International Pulse unavailable: {err}</div>;
  if (!d) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading the international pulse (60 FRED series, 80 market quotes — about 45 seconds the first time, then cached)…</div>;
  const oc = TONE[d.overall.tone], s = d.scores;
  const ranking = [...d.rows].filter(r => fin(r.eq?.usd1y)).sort((a, b) => b.eq.usd1y - a.eq.usd1y);
  const maxR = Math.max(10, ...ranking.map(r => Math.abs(r.eq.usd1y)));
  return (<>
    <div style={{ ...card, padding: "14px 18px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 18, alignItems: "start" }}>
      <div>
        <div style={label}>International · pulse</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: oc, fontFamily: fonts.heading, letterSpacing: -0.7, lineHeight: 1.1, marginTop: 4 }}>{d.overall.label}</div>
        <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>{d.overall.sentence}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {[["broad dollar", fin(s.dollar.dxy) ? `${s.dollar.dxy} (${pc(s.dollar.dxyYoy)} y/y, p${s.dollar.dxyPct})` : "—"], ["EM spread", fin(s.risk.emOas) ? `${s.risk.emOas}% (p${s.risk.emPct} since ${s.risk.emSince || "2023"})` : "—"], ["EM vs S&P, 1 yr", fin(s.risk.eemR1y) && fin(s.risk.spxR1y) ? `${pp(s.risk.eemR1y - s.risk.spxR1y)} pts` : "—"]].map(([t, v]) => <span key={t} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "3px 8px" }}>{t} <strong style={{ color: "var(--text-primary)" }}>{v}</strong></span>)}
        </div>
        <div style={{ ...note, marginTop: 8 }}>13 economies · FRED, Yahoo, The Economist · refreshed {new Date(d.updated).toLocaleString()} · hover any cell for its date and source</div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><Score name="Dollar" s={s.dollar} /><Score name="Risk appetite" s={s.risk} /><Score name="Growth breadth" s={s.growth} /></div>
    </div>

    <SH>The Board — Thirteen Economies, One Screen</SH>
    <div style={{ ...note, marginTop: -8, marginBottom: 8 }}>Click a column to sort. &quot;1 yr in USD&quot; is what a dollar investor actually earned: local index return compounded with the currency. Real FX = BIS real effective exchange rate vs its own 10-year average (positive = expensive). Big Mac = raw and GDP-adjusted valuation vs the dollar at today&apos;s exchange rate.</div>
    <Board rows={rows} sortKey={sortKey} setSortKey={setSortKey} />

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      {chartBox("Broad dollar index — 10 years (Fed trade-weighted, goods & services)",
        <ResponsiveContainer width="100%" height={170}><LineChart data={d.charts.dollar} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip contentStyle={tip} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" />{fin(d.charts.dxyAvg10y) && <ReferenceLine y={d.charts.dxyAvg10y} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} />}
          <Line type="monotone" dataKey="broad" name="Broad dollar" stroke={INDIGO} strokeWidth={2} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="em" name="vs emerging markets" stroke={AMBER} strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} />
        </LineChart></ResponsiveContainer>,
        "Dashed line = 10-year average. A dollar well above it has usually mean-reverted, and every 10% of dollar decline adds roughly 10 points to unhedged foreign returns.")}
      {chartBox(`Emerging-market corporate spread — since ${d.charts.emSince || "2023"} (%)`,
        <ResponsiveContainer width="100%" height={170}><LineChart data={d.charts.emSpread} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(0, 4)} minTickGap={36} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
          <Tooltip contentStyle={tip} formatter={v => [`${v}%`, "EM OAS"]} /><Line type="monotone" dataKey="v" stroke={RED} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>,
        "ICE BofA EM corporate index option-adjusted spread. Spikes are the risk-off episodes (2016, 2020, 2022); a spread near its lows means the world is being paid little to take EM credit risk.")}
      {chartBox("One-year equity return in dollars — ranked",
        <div style={{ padding: "6px 4px 2px" }}>{ranking.map(r => { const v = r.eq.usd1y, c = upDown(v); return (
          <div key={r.code} style={{ display: "grid", gridTemplateColumns: "118px 1fr 52px", alignItems: "center", gap: 8, height: 19 }}>
            <span style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.flag} {r.name}</span>
            <div style={{ position: "relative", height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 3 }}><div style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 12, background: "rgba(255,255,255,0.25)" }} /><div style={{ position: "absolute", top: 0, height: "100%", borderRadius: 3, background: c, opacity: 0.85, left: v >= 0 ? "50%" : `${50 - (Math.abs(v) / maxR) * 50}%`, width: `${(Math.abs(v) / maxR) * 50}%` }} /></div>
            <span style={{ fontSize: 10, fontFamily: fonts.mono, fontWeight: 700, color: c, textAlign: "right" }}>{pc(v, 0)}</span>
          </div>); })}</div>,
        "Local index return compounded with the currency's move against the dollar — the number that lands in a U.S. account.")}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 14 }}><VerdictCard s={s.dollar} /><VerdictCard s={s.risk} /><VerdictCard s={s.growth} /></div>

    <BigMacPanel bm={d.bigmac} s={d.bigmacSummary} />

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How to read it.</strong> For a dollar-based investor three things decide foreign returns: the dollar (a strong dollar subtracts from everything abroad and tightens conditions for anyone who borrowed in it), risk appetite (EM spreads and EM equity momentum say whether the world is paying for risk), and growth breadth (how many economies are actually expanding). The board&apos;s valuation cluster — real exchange rate vs its own history and the Big Mac read — is where mean reversion lives: a currency that is cheap on both, in an economy that is growing, with a positive real yield, is the classic setup. Real yields appear only where inflation data is fresh; the OECD inflation series on FRED stopped updating in 2024 and are deliberately excluded rather than shown stale.
    </InfoBox>
  </>);
}

export default IntlPulseTab;
