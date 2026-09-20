import React, { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import OwnerWealthPanel from "./consumer/OwnerWealth.jsx";
import HouseholdWealthPanel from "./consumer/HouseholdWealth.jsx";

/*
 * ConsumerTab — is the American household healthy?
 * Thesis: healthy when INCOME funds spending, stressed when BORROWING does.
 * Data: /api/consumer-health (batched FRED, precomputed composites).
 */

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8";
const TONE_C = { green: GREEN, amber: AMBER, red: RED };
const pctS = (v, dp = 1) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;

function Spark({ values, color = INDIGO, h = 26 }) {
  const v = (values || []).filter(x => x != null && isFinite(x));
  if (v.length < 3) return <div style={{ height: h }} />;
  const min = Math.min(...v), max = Math.max(...v), range = (max - min) || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${(1 - (x - min) / range) * (h - 4) + 2}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AffTile({ label, value, sub, pct, spark, sparkColor }) {
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {pct != null && <span style={{ fontSize: 9, color: "#a5b4fc", fontFamily: fonts.mono, whiteSpace: "nowrap" }}>{pct}th %ile</span>}
      </div>
      <div style={{ fontSize: 21, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      <div style={{ marginTop: 6 }}><Spark values={spark} color={sparkColor || INDIGO} /></div>
    </div>
  );
}

// Stress lights — each returns { tone, note }
function stressLight(id, c) {
  switch (id) {
    case "delinq": {
      const lvl = c.cardDelinq, dir = c.cardDelinqDir;
      if (lvl == null) return null;
      if (lvl > 4 || (dir != null && dir > 0.5)) return { tone: "red", note: "rising / elevated" };
      if (lvl > 2.8 || (dir != null && dir > 0.15)) return { tone: "amber", note: "creeping up" };
      return { tone: "green", note: "low & stable" };
    }
    case "dsr": {
      const v = c.debtService;
      if (v == null) return null;
      return v < 11 ? { tone: "green", note: "affordable" } : v < 12.5 ? { tone: "amber", note: "moderate" } : { tone: "red", note: "heavy" };
    }
    case "savings": {
      const p = c.savingsPct;
      if (p == null) return null;
      return p > 40 ? { tone: "green", note: "healthy buffer" } : p > 15 ? { tone: "amber", note: "thin cushion" } : { tone: "red", note: "near record low" };
    }
    case "income": {
      const v = c.incomeGrowth;
      if (v == null) return null;
      return v > 1.5 ? { tone: "green", note: "real gains" } : v >= 0 ? { tone: "amber", note: "barely positive" } : { tone: "red", note: "shrinking" };
    }
    case "borrow": {
      const v = c.borrowGrowth;
      if (v == null) return null;
      return v < 6 ? { tone: "green", note: "restrained" } : v < 9 ? { tone: "amber", note: "accelerating" } : { tone: "red", note: "borrowing to spend" };
    }
    default: return null;
  }
}

function ConsumerTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = (force = false) => {
    setLoading(true);
    fetch(`/api/consumer-health${force ? "?refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => { setData(d); setError(!!d.error); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(false); }, []);

  if (loading && !data) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading consumer health…</div>;
  if (error || !data?.series) return <InfoBox color="#F97316">Unable to load consumer data — FRED may be temporarily unavailable.</InfoBox>;

  const s = data.series, c = data.computed || {};

  const LIGHTS = [
    { id: "income",  name: "Real Income Growth", val: pctS(c.incomeGrowth) + " YoY" },
    { id: "savings", name: "Savings Rate",        val: c.savings != null ? `${c.savings.toFixed(1)}%` : "—" },
    { id: "delinq",  name: "Card Delinquency",    val: c.cardDelinq != null ? `${c.cardDelinq.toFixed(2)}%` : "—" },
    { id: "dsr",     name: "Debt Service Ratio",  val: c.debtService != null ? `${c.debtService.toFixed(1)}%` : "—" },
    { id: "borrow",  name: "Revolving Credit",    val: pctS(c.borrowGrowth) + " YoY" },
  ].map(l => ({ ...l, ...(stressLight(l.id, c) || { tone: "amber", note: "n/a" }) }));

  const reds = LIGHTS.filter(l => l.tone === "red").length;
  const ambers = LIGHTS.filter(l => l.tone === "amber").length;
  const verdict = reds >= 2 ? { label: "Deteriorating", color: RED }
    : (reds === 1 || ambers >= 3) ? { label: "Stretched", color: AMBER }
    : { label: "Healthy", color: GREEN };

  const gap = c.spendVsIncome;
  const gapNote = gap == null ? ""
    : gap > 0.5 ? `Spending is outrunning income by ${gap.toFixed(1)}pp — the shortfall is being covered by savings drawdown and credit.`
    : gap < -0.5 ? `Income is outpacing spending by ${Math.abs(gap).toFixed(1)}pp — households have room and are building buffers.`
    : "Spending and income are growing in step.";

  return (<>
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
      <button onClick={() => load(true)} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono }}>↻ Refresh</button>
    </div>

    {/* Verdict banner */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: verdict.color }} />
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>The American Consumer</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: verdict.color, fontFamily: fonts.heading, letterSpacing: -0.5 }}>{verdict.label}</span>
        <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono }}>income {pctS(c.incomeGrowth)} · spending {pctS(c.spendGrowth)} · {reds} red / {ambers} amber signals</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", fontFamily: fonts.mono, marginTop: 6, maxWidth: 800, lineHeight: 1.5 }}>{gapNote}</div>
    </div>

    {/* Stress dial */}
    <SH>Consumer Stress Dial</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px", marginBottom: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: 8 }}>
        {LIGHTS.map(l => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", background: "var(--bg-subtle)", borderRadius: 9, borderLeft: `3px solid ${TONE_C[l.tone]}` }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: TONE_C[l.tone], flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: "var(--text-secondary)", fontFamily: fonts.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.mono, fontWeight: 700 }}>{l.val} <span style={{ fontWeight: 400, color: TONE_C[l.tone], fontSize: 10 }}>{l.note}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Mechanism chart — the whole story */}
    <SH>The Mechanism — Income vs Spending vs Borrowing (YoY %)</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 18 }}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={c.mechanism} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor((c.mechanism?.length || 0) / 9) - 1)} tickFormatter={d => d.slice(0, 7)} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`${v}%`, n]} labelFormatter={d => d.slice(0, 7)} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <ReferenceLine y={0} stroke="rgba(148,163,184,0.4)" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="income" name="Real disposable income" stroke={GREEN} strokeWidth={2.2} dot={false} connectNulls />
          <Line type="monotone" dataKey="spend" name="Real consumer spending" stroke={INDIGO} strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="revolving" name="Revolving credit (cards)" stroke={RED} strokeWidth={1.6} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        When the indigo spending line runs above the green income line — and the red credit line accelerates — households are spending money they aren&apos;t earning. That gap, funded by savings drawdown and card balances, is the earliest sign of consumer stress.
      </div>
    </div>

    {/* Affordability strip */}
    <SH>Affordability — What It Feels Like to Be a Household</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(155px, 100%), 1fr))", gap: 10, marginBottom: 18 }}>
      <AffTile label="Debt Service Ratio" value={c.debtService != null ? `${c.debtService.toFixed(1)}%` : "—"} sub="of disposable income" pct={s.TDSP?.pctRaw} spark={s.TDSP?.sparkRaw} sparkColor={c.debtService > 12.5 ? RED : INDIGO} />
      <AffTile label="Credit Card APR" value={c.cardApr != null ? `${c.cardApr.toFixed(1)}%` : "—"} sub="avg assessed rate" pct={s.TERMCBCCALLNS?.pctRaw} spark={s.TERMCBCCALLNS?.sparkRaw} sparkColor={RED} />
      <AffTile label="Savings Rate" value={c.savings != null ? `${c.savings.toFixed(1)}%` : "—"} sub={`${c.savingsPct}th pctile of history`} pct={c.savingsPct} spark={s.PSAVERT?.sparkRaw} sparkColor={c.savingsPct < 15 ? RED : INDIGO} />
      <AffTile label="Gas Price" value={c.gas != null ? `$${c.gas.toFixed(2)}` : "—"} sub={`regular · ${pctS(c.gasYoY)} YoY`} pct={s.GASREGW?.pctRaw} spark={s.GASREGW?.sparkRaw} sparkColor={(c.gasYoY ?? 0) > 0 ? RED : GREEN} />
      <AffTile label="Retail Sales" value={pctS(c.retailYoY)} sub="real, YoY" pct={s.RRSFS?.pctRaw} spark={s.RRSFS?.sparkRaw} sparkColor={(c.retailYoY ?? 0) >= 0 ? GREEN : RED} />
      <AffTile label="Sentiment" value={c.sentiment != null ? c.sentiment.toFixed(1) : "—"} sub={`U. Michigan · ${c.sentimentPct}th pctile`} pct={c.sentimentPct} spark={s.UMCSENT?.sparkRaw} sparkColor={c.sentimentPct < 25 ? RED : INDIGO} />
    </div>

    {/* K-shape panel */}
    <SH>Household Net Worth — The Survey of Consumer Finances</SH>
    <HouseholdWealthPanel />

    <SH>Where Private Business Wealth Is — The Everywhere Millionaire, Tested</SH>
    <OwnerWealthPanel />

    <SH>The K-Shaped Consumer — Whose Strength?</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 14, marginBottom: 16 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Top 1% Wealth Share</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: GREEN, fontFamily: fonts.heading }}>{c.top1 != null ? `${c.top1.toFixed(1)}%` : "—"}</span>
          <span style={{ fontSize: 11, color: (c.top1Dir ?? 0) >= 0 ? GREEN : RED, fontFamily: fonts.mono }}>{c.top1Dir != null ? `${c.top1Dir >= 0 ? "▲" : "▼"} ${Math.abs(c.top1Dir).toFixed(1)}pp/yr` : ""}</span>
        </div>
        <div style={{ marginTop: 8 }}><Spark values={s.WFRBST01134?.sparkRaw} color={GREEN} h={34} /></div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Bottom 50% Wealth Share</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: (c.bottom50 ?? 9) < 3 ? RED : INDIGO, fontFamily: fonts.heading }}>{c.bottom50 != null ? `${c.bottom50.toFixed(1)}%` : "—"}</span>
          <span style={{ fontSize: 11, color: (c.bottom50Dir ?? 0) >= 0 ? GREEN : RED, fontFamily: fonts.mono }}>{c.bottom50Dir != null && c.bottom50Dir !== 0 ? `${c.bottom50Dir >= 0 ? "▲" : "▼"} ${Math.abs(c.bottom50Dir).toFixed(1)}pp/yr` : "flat"}</span>
        </div>
        <div style={{ marginTop: 8 }}><Spark values={s.WFRBSB50215?.sparkRaw} color={(c.bottom50 ?? 9) < 3 ? RED : INDIGO} h={34} /></div>
      </div>
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "var(--text-primary)" }}>Reading consumer health.</strong>
      &nbsp;The <strong>mechanism chart</strong> is the core: healthy consumption is funded by rising real income (green); when spending (indigo) outpaces it and card credit (red) accelerates, growth is being borrowed from the future.
      &nbsp;The <strong>stress dial</strong> distills five signals — real income, the savings buffer, card delinquencies, the debt-service burden, and how fast revolving credit is growing.
      &nbsp;The <strong>K-shape</strong> panel is the advisor&apos;s caveat: aggregate spending can look fine because the top decile — sitting on record wealth — does an outsized share of it, while the bottom half (just {c.bottom50 != null ? `${c.bottom50.toFixed(1)}%` : "~2%"} of all wealth) feels every APR tick and gas-price move. &quot;The consumer&quot; is really two consumers.
      &nbsp;All data from FRED; cached 4 hours.
    </InfoBox>
  </>);
}

export default ConsumerTab;
