import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceDot, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "./shared.jsx";

// ============================================================================
// MORNINGSTAR US MARKET FAIR VALUE — the bottom-up valuation lens
// Morningstar's analysts keep a DCF fair value on ~1,500 US stocks; the
// median price/fair-value across all of them is their market gauge. Negative
// = the market trades below analysts' fair value (cheap), positive = above.
// Daily since 2016 via /api/ms-fair-value (archived server-side).
// Two faces: ValuationLensesCard (Cockpit — beside the two top-down reads,
// ERP and Damodaran) and MarketFairValuePanel (Stocks → S&P Overview).
// ============================================================================

const GREEN = "#4ade80", RED = "#f87171", AMBER = "#fbbf24", INDIGO = "#818cf8", SLATE = "#94a3b8";
const fin = v => v != null && isFinite(v);
const fmtFv = v => (!fin(v) ? "—" : `${Math.abs(v * 100).toFixed(1)}% ${v < 0 ? "undervalued" : v > 0 ? "overvalued" : "at fair value"}`);
const fmtSigned = v => (!fin(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const fmtDate = d => (d ? `${d.slice(0, 4)}-${d.slice(5, 7)}` : "");
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: "#475569", fontFamily: fonts.mono, lineHeight: 1.5 };

// Damodaran's monthly implied ERP (/api/damodaran-erp); null until loaded or if unavailable
export function useDamodaranMonthly() {
  const [d, setD] = useState(null);
  useEffect(() => { fetch("/api/damodaran-erp").then(r => r.json()).then(x => { if (x && !x.error && fin(x.erp)) setD(x); }).catch(() => {}); }, []);
  return d;
}
// percentile of a value within the annual series (the long-run yardstick)
export const damPct = (dam, v) => (dam && fin(v) ? Math.round((dam.series.filter(r => r.erp < v).length / dam.series.length) * 100) : null);
export const ord = n => (!fin(n) ? "n/a" : `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`);
export const damColor = p => (p == null ? SLATE : p >= 70 ? GREEN : p >= 30 ? AMBER : RED);
const monthLabel = d => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleString("en-US", { month: "short", year: "numeric" }) : "");

export function useMsFairValue() {
  const [d, setD] = useState(null);
  useEffect(() => {
    fetch("/api/ms-fair-value").then(r => r.json()).then(x => { if (x && !x.error) setD(x); }).catch(() => {});
  }, []);
  return d;
}

// Tone from "cheaper than X% of days": today is cheaper than most history → Cheap.
export function fvTone(cheaperThan) {
  if (!fin(cheaperThan)) return { label: "—", color: SLATE };
  if (cheaperThan >= 80) return { label: "Cheap", color: GREEN };
  if (cheaperThan >= 40) return { label: "Fair", color: AMBER };
  return { label: "Rich", color: RED };
}

// Split-color area around fair value: green below zero (cheap), red above.
export function FairValueChart({ series, height = 160, extremes, compact = false }) {
  const { data, domain, off } = useMemo(() => {
    const data = (series || []).map(p => ({ d: p.d, v: +(p.v * 100).toFixed(2) }));
    const vals = data.map(p => p.v);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const bottom = Math.floor(lo) - 2, top = Math.ceil(hi) + 2;
    return { data, domain: [bottom, top], off: top / (top - bottom) }; // where zero sits, from the top
  }, [series]);
  if (!data.length) return null;
  // ReferenceDots must sit on a plotted x value — snap each extreme to the nearest plotted date
  const snap = pt => { if (!pt) return null; let best = data[0]; for (const q of data) if (Math.abs(Date.parse(q.d) - Date.parse(pt.d)) < Math.abs(Date.parse(best.d) - Date.parse(pt.d))) best = q; return { ...pt, x: best.d }; };
  const exMin = snap(extremes?.min), exMax = snap(extremes?.max);
  const years = new Set();
  const tickFmt = d => { const y = d.slice(0, 4); if (years.has(y)) return ""; years.add(y); return y; };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: compact ? 6 : 16, bottom: 0, left: compact ? -14 : 0 }}>
        <defs>
          <linearGradient id="msfv-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset={0} stopColor={RED} stopOpacity={0.45} />
            <stop offset={off} stopColor={RED} stopOpacity={0.08} />
            <stop offset={off} stopColor={GREEN} stopOpacity={0.08} />
            <stop offset={1} stopColor={GREEN} stopOpacity={0.45} />
          </linearGradient>
          <linearGradient id="msfv-stroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset={off} stopColor={RED} />
            <stop offset={off} stopColor={GREEN} />
          </linearGradient>
        </defs>
        {!compact && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />}
        <XAxis dataKey="d" tickFormatter={compact ? (d => d.slice(0, 4)) : tickFmt} tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} interval={compact ? Math.max(1, Math.floor(data.length / 5)) : "preserveStartEnd"} minTickGap={compact ? 40 : 30} axisLine={false} tickLine={false} />
        <YAxis domain={domain} tickFormatter={v => `${v}%`} tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} width={compact ? 36 : 44} axisLine={false} tickLine={false} hide={compact} />
        <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [fmtFv(v / 100), "vs Morningstar fair value"]} labelFormatter={l => l} />
        <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.7} label={compact ? undefined : { value: "fair value", position: "insideTopRight", fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} />
        <Area type="monotone" dataKey="v" baseValue={0} stroke="url(#msfv-stroke)" strokeWidth={1.6} fill="url(#msfv-fill)" dot={false} isAnimationActive={false} />
        {!compact && exMin && <ReferenceDot x={exMin.x} y={+(exMin.v * 100).toFixed(2)} r={4} fill={GREEN} stroke="#0f172a" label={{ value: `${fmtSigned(exMin.v)} · ${fmtDate(exMin.d)}`, position: "bottom", fill: GREEN, fontSize: 9.5, fontFamily: fonts.mono }} />}
        {!compact && exMax && <ReferenceDot x={exMax.x} y={+(exMax.v * 100).toFixed(2)} r={4} fill={RED} stroke="#0f172a" label={{ value: `${fmtSigned(exMax.v)} · ${fmtDate(exMax.d)}`, position: "top", fill: RED, fontSize: 9.5, fontFamily: fonts.mono }} />}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Cockpit: three valuation lenses in one card ─────────────────────────────
// Bottom-up (Morningstar) gets the visual; the two top-down reads sit beside
// it; the footer says whether the lenses agree — disagreement is the signal.
const TONE_COLOR = { success: "#10b981", neutral: INDIGO, warning: "#f59e0b", danger: "#ef4444" };
export function ValuationLensesCard({ erp, dam, onNavigate }) {
  const ms = useMsFairValue();
  const dm = useDamodaranMonthly();
  const damNow = dm ? { erp: dm.erp, tbond: dm.tbond, pct: damPct(dam, dm.erp), when: `${monthLabel(dm.asOf)} (monthly)` } : dam ? { erp: dam.last.erp, tbond: dam.last.tbond, pct: dam.pct, when: `end-${dam.last.y} (annual)` } : null;
  const tone = fvTone(ms?.cheaperThan);
  const msColor = !ms ? SLATE : ms.latest < 0 ? GREEN : RED;
  const erpColor = erp ? (TONE_COLOR[erp.tone] || INDIGO) : SLATE;
  // agreement between the bottom-up read and the top-down ERP read
  let agree = null;
  if (ms && erp && fin(erp.percentile)) {
    const msCheap = ms.cheaperThan >= 60, msRich = ms.cheaperThan <= 30;
    const erpRich = erp.percentile <= 30, erpCheap = erp.percentile >= 66;
    if (msCheap && erpRich) agree = { color: AMBER, text: "The lenses disagree: analysts' bottom-up fair values say cheap while the earnings yield says bonds win. Analyst growth assumptions are carrying those fair values — the Stocks → Valuation panel shows exactly what the price requires." };
    else if (msRich && erpCheap) agree = { color: AMBER, text: "The lenses disagree: the earnings yield looks generous but analysts' bottom-up fair values say the market is ahead of itself — earnings may be at a cyclical high." };
    else if (msCheap && erpCheap) agree = { color: GREEN, text: "Top-down and bottom-up agree: cheap. Both the earnings-yield spread and analysts' fair values favor stocks over bonds." };
    else if (msRich && erpRich) agree = { color: RED, text: "Top-down and bottom-up agree: rich. Neither the earnings-yield spread nor analysts' fair values leave much margin for error." };
    else agree = { color: SLATE, text: "Neither lens is at an extreme — valuation isn't the argument right now, growth delivery is." };
  }
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: msColor }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={label}>Valuation — three lenses</span>
        <button onClick={() => onNavigate?.("stocks")} style={{ fontSize: 10, color: INDIGO, fontFamily: fonts.mono, cursor: "pointer", background: "none", border: "none", padding: 0 }}>Stocks →</button>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 8, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* bottom-up: number + 10-yr chart */}
        <div style={{ flex: "1 1 300px", minWidth: 260 }}>
          <div style={{ ...label, fontSize: 9, color: "#475569" }}>Bottom-up · Morningstar analysts&apos; fair value · ~1,500 stocks</div>
          {ms ? (<>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: msColor, fontFamily: fonts.heading, letterSpacing: -0.8, lineHeight: 1 }}>{fmtFv(ms.latest)}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: tone.color, background: `${tone.color}1e`, padding: "2px 8px", borderRadius: 6, fontFamily: fonts.mono }}>{tone.label}</span>
            </div>
            <div style={{ fontSize: 9.5, color: SLATE, fontFamily: fonts.mono, marginTop: 3, lineHeight: 1.4 }}>
              median price / fair value · cheaper than {ms.cheaperThan}% of days since {ms.start?.slice(0, 4)} · {ms.asOf}
            </div>
            <div style={{ marginTop: 6 }}><FairValueChart series={ms.series10y} height={88} compact /></div>
            <div style={{ ...note, textAlign: "right", marginTop: -2 }}>10 yrs · green = below fair value · low {fmtSigned(ms.min?.v)} ({fmtDate(ms.min?.d)}) · high {fmtSigned(ms.max?.v)} ({fmtDate(ms.max?.d)})</div>
          </>) : <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 8 }}>Loading Morningstar fair value…</div>}
        </div>
        {/* top-down: the two reads the Cockpit already had */}
        <div style={{ flex: "0 1 230px", minWidth: 200, display: "flex", flexDirection: "column", gap: 10, justifyContent: "center", borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 16 }}>
          <div>
            <div style={{ ...label, fontSize: 9, color: "#475569" }}>Top-down · earnings yield − 10Y</div>
            {erp ? (<>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: erpColor, fontFamily: fonts.heading, letterSpacing: -0.6, lineHeight: 1 }}>{fin(erp.currentErp) ? `${erp.currentErp > 0 ? "+" : ""}${erp.currentErp.toFixed(2)}pp` : "—"}</span>
                {erp.verdict && <span style={{ fontSize: 9, fontWeight: 700, color: erpColor, background: `${erpColor}1e`, padding: "2px 7px", borderRadius: 6, fontFamily: fonts.mono }}>{erp.verdict}</span>}
              </div>
              <div style={{ fontSize: 9.5, color: SLATE, fontFamily: fonts.mono, marginTop: 3 }}>EY {erp.earningsYield?.toFixed(2)}% − 10Y {erp.tenYear?.toFixed(2)}%{fin(erp.percentile) ? ` · ${ord(erp.percentile)} pct / 25y` : ""}</div>
            </>) : <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 4 }}>Loading…</div>}
          </div>
          <div>
            <div style={{ ...label, fontSize: 9, color: "#475569" }}>Top-down · Damodaran implied ERP</div>
            {damNow ? (<>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3 }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: damColor(damNow.pct), fontFamily: fonts.heading, letterSpacing: -0.6, lineHeight: 1 }}>{(damNow.erp * 100).toFixed(2)}%</span>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: damColor(damNow.pct), fontFamily: fonts.mono }}>{ord(damNow.pct)} pct</span>
              </div>
              <div style={{ fontSize: 9.5, color: SLATE, fontFamily: fonts.mono, marginTop: 3 }}>FCFE, {damNow.when} · vs 10Y {fin(damNow.tbond) ? `${(damNow.tbond * 100).toFixed(2)}%` : "—"}{dm && dam ? ` · end-${dam.last.y} ${(dam.last.erp * 100).toFixed(2)}%` : ""}</div>
            </>) : <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 4 }}>Unavailable.</div>}
          </div>
        </div>
      </div>
      {agree && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: agree.color, flexShrink: 0 }} />
          <div style={{ fontSize: 10.5, color: "#cbd5e1", fontFamily: fonts.heading, lineHeight: 1.5 }}>{agree.text}</div>
        </div>
      )}
    </div>
  );
}

// ── Stocks → S&P Overview: the full panel ───────────────────────────────────
export default function MarketFairValuePanel() {
  const ms = useMsFairValue();
  if (!ms) return null;
  const tone = fvTone(ms.cheaperThan);
  const msColor = ms.latest < 0 ? GREEN : RED;
  const yr = ms.series1y || [];
  const yrLo = yr.length ? yr.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const yrHi = yr.length ? yr.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const stat = (t, v, sub, color = "var(--text-primary)") => (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: "10px 14px" }}>
      <div style={label}>{t}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.4, lineHeight: 1.15, marginTop: 2 }}>{v}</div>
      <div style={{ ...note, marginTop: 2 }}>{sub}</div>
    </div>
  );
  return (<>
    <SH>Market Valuation — Morningstar Bottom-Up Fair Value</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 10, marginBottom: 12 }}>
      {stat("Today", fmtFv(ms.latest), `median P/FV across ~1,500 covered stocks · ${ms.asOf}`, msColor)}
      {stat("Since " + ms.start?.slice(0, 4), `${tone.label} · cheaper than ${ms.cheaperThan}%`, "of trading days in the archive", tone.color)}
      {stat("1-year range", `${fmtSigned(yrLo?.v)} to ${fmtSigned(yrHi?.v)}`, `${fmtDate(yrLo?.d)} low · ${fmtDate(yrHi?.d)} high`)}
      {stat("10-year extremes", `${fmtSigned(ms.min?.v)} / ${fmtSigned(ms.max?.v)}`, `${fmtDate(ms.min?.d)} trough · ${fmtDate(ms.max?.d)} peak`)}
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px 8px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={label}>Median price / fair value of Morningstar-covered US stocks · daily, 10 years</span>
        <span style={note}>{ms.source === "live" ? "live" : "archive"} · {ms.n} days archived</span>
      </div>
      <div style={{ marginTop: 8 }}><FairValueChart series={ms.series10y} height={280} extremes={{ min: ms.min, max: ms.max }} /></div>
    </div>
    <InfoBox color={msColor}>
      <strong style={{ color: "#cbd5e1" }}>How to read it.</strong> Morningstar&apos;s analysts keep a discounted-cash-flow fair value on every stock they cover; this is the median of price ÷ that fair value, so it&apos;s a <em>bottom-up</em> valuation gauge — the mirror image of the top-down earnings-yield and Damodaran reads on the Cockpit. It has been most useful at the extremes (the 2020 and 2022 troughs, the 2021 premium) and noisy in between. When it disagrees with the top-down lenses, the difference is analyst growth assumptions — which is exactly what the reverse DCF&apos;s expectations panel tests one company at a time. Source: <a href="https://www.morningstar.com/markets/fair-value" target="_blank" rel="noopener" style={{ color: INDIGO }}>morningstar.com/markets/fair-value</a> (public chart feed, fetched daily and archived).
    </InfoBox>
  </>);
}
