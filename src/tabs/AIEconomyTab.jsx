import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell, LineChart, Line, CartesianGrid, Area, AreaChart, ReferenceLine, ScatterChart, Scatter, ZAxis } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import ForecastPanel from "../components/ForecastPanel.jsx";
import LabRevenueTracker, { wedgeSummary } from "../components/LabRevenueTracker.jsx";
import MemoryPricesPanel from "../components/MemoryPricesPanel.jsx";
import AiPulseTab, { GpuRentalsPanel, AaModelsPanel, useAiPulse } from "./AiPulseTab.jsx";
import GpuEconomicsPanel from "./ai/GpuEconomics.jsx";
import CapexReturnsPanel from "./ai/CapexReturns.jsx";
import TokenEstimatesPanel from "./ai/TokenEstimates.jsx";

function SubTab({ id, label, active, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        padding: "7px 18px", borderRadius: 20, border: "none", cursor: "pointer",
        fontSize: 12, fontFamily: fonts.heading, fontWeight: 600, letterSpacing: 0.2,
        background: active ? "rgba(99,102,241,0.18)" : "transparent",
        color: active ? "#a5b4fc" : "#64748b",
        outline: active ? "1px solid rgba(99,102,241,0.35)" : "1px solid transparent",
        transition: "all 0.15s",
      }}
    >{label}</button>
  );
}

// --- Stat card (reusable small card) ----------------------------------------
function StatCard({ label, val, sub, color }) {
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "14px 14px 0 0" }} />
      <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{val}</div>
      {sub && <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontFamily: fonts.mono }}>{sub}</div>}
    </div>
  );
}

// --- Sort icon ---------------------------------------------------------------
function SortIcon({ col, sortCol, sortAsc }) {
  if (sortCol !== col) return <span style={{ color: "#334155", marginLeft: 4 }}>{"<>"}</span>;
  return <span style={{ color: "#a5b4fc", marginLeft: 4 }}>{sortAsc ? "up" : "down"}</span>;
}

// ===========================================================
// SUB-TAB 1: AI ECONOMIC IMPACT (live data)
// ===========================================================

// Format large numbers
const fmtPct = (v, decimals = 2) => v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(decimals)}%`;
const fmtDate2 = (d) => {
  if (!d) return "";
  const p = d.split("-");
  const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1]-1];
  return `${mn} ${p[0].slice(2)}`;
};

// FRED time series chart component
function FredChart({ series, title, yFormat, yoyHighlight }) {
  if (!series?.history?.length) return null;
  const tickInt = Math.max(0, Math.floor(series.history.length / 8) - 1);
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingLeft: 12, paddingRight: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{title}</div>
        {yoyHighlight && series.yoy != null && (
          <div style={{ fontSize: 10, color: series.yoy > 0 ? "#4ade80" : "#f87171", fontFamily: fonts.mono, fontWeight: 600 }}>
            YoY: {fmtPct(series.yoy, 1)}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={series.history} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id={`ai-fred-${series.label.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={series.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={series.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} tickFormatter={fmtDate2} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={yFormat || (v => v.toFixed(0))} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={fmtDate2} formatter={v => [yFormat ? yFormat(v) : v.toFixed(2), series.label]} />
          <Area type="monotone" dataKey="v" stroke={series.color} fill={`url(#ai-fred-${series.label.replace(/\s/g, "")})`} strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 4 }}>
        Latest: {fmtDate2(series.lastDate)} | Source: FRED ({series.freq === "Q" ? "Quarterly" : "Monthly"})
      </div>
    </div>
  );
}

// Helper: format values according to FRED series "unit" metadata
const fmtFredVal = (series) => {
  if (series?.current == null) return "-";
  const v = series.current;
  if (series.unit === "billions") return `$${v.toFixed(0)}B`;
  if (series.unit === "dollars_m") return `$${(v / 1000).toFixed(1)}B`; // millions -> billions display
  if (series.unit === "thousands") return `${(v / 1000).toFixed(2)}M`;   // thousands of jobs -> millions
  return v.toFixed(1);
};
const fmtFredChart = (series) => {
  if (series?.unit === "billions") return v => `$${v.toFixed(0)}B`;
  if (series?.unit === "dollars_m") return v => `$${(v/1000).toFixed(0)}B`;
  if (series?.unit === "thousands") return v => `${(v/1000).toFixed(1)}M`;
  return v => v.toFixed(1);
};

// ─── Hyperscaler AI Capex Panel ─────────────────────────────────────────────
// Quarterly capex for MSFT/GOOGL/META/AMZN/ORCL with a configurable per-company
// "AI share %" applied to estimate AI-specific spend. Raw company numbers are
// exact (from FMP); the AI carve-out is interpretation based on earnings-call
// disclosures. Best public proxy for hyperscaler AI infra demand.
const HS_AI_SHARE_DEFAULTS = {
  MSFT: 0.70,   // ~70% of MSFT capex is Azure AI infra per earnings commentary
  GOOGL: 0.65,  // GCP + AI training + data center expansion
  META: 0.55,   // AI for Reels, ads, Llama training — rest is general infra
  AMZN: 0.60,   // AWS AI infra, partially offset by general retail capex
  ORCL: 0.85,   // Oracle's recent pivot is almost entirely OCI AI infra
};

function HyperscalerCapexPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiShare, setAiShare] = useState(HS_AI_SHARE_DEFAULTS);

  useEffect(() => {
    fetch("/api/hyperscaler-capex")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => console.error("Hyperscaler capex error:", e))
      .finally(() => setLoading(false));
  }, []);

  // Build a quarterly time-series keyed by date, with each company as a column
  // and an additional "AI capex" total column = sum(company.capex × aiShare)
  const chartData = useMemo(() => {
    if (!data?.companies) return [];
    const byDate = new Map();
    Object.values(data.companies).forEach(c => {
      c.quarters.forEach(q => {
        if (!byDate.has(q.date)) byDate.set(q.date, { date: q.date });
        const row = byDate.get(q.date);
        row[c.symbol] = (c.capex || 0) / 1e9;  // billions
        row[`${c.symbol}_AI`] = ((c.capex || 0) * (aiShare[c.symbol] || 0)) / 1e9;
      });
    });
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [data, aiShare]);

  // Latest period stats: total capex this Q, AI-share, YoY growth, trailing 4Q
  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const last = chartData[chartData.length - 1];
    const yoy = chartData[chartData.length - 5];
    const tot = (row, suffix = "") => Object.values(data.companies || {})
      .reduce((s, c) => s + (row[`${c.symbol}${suffix}`] || 0), 0);
    const lastTotal = tot(last);
    const lastAi = tot(last, "_AI");
    const yoyTotal = yoy ? tot(yoy) : null;
    const yoyAi = yoy ? tot(yoy, "_AI") : null;
    // Trailing 4 quarters total
    const last4 = chartData.slice(-4);
    const ttmTotal = last4.reduce((s, r) => s + tot(r), 0);
    const ttmAi = last4.reduce((s, r) => s + tot(r, "_AI"), 0);
    return {
      lastDate: last.date,
      lastTotal,
      lastAi,
      yoyGrowth: yoyTotal ? ((lastTotal - yoyTotal) / yoyTotal) * 100 : null,
      yoyAiGrowth: yoyAi ? ((lastAi - yoyAi) / yoyAi) * 100 : null,
      ttmTotal,
      ttmAi,
    };
  }, [chartData, data]);

  if (loading) return <div style={{ padding: 30, fontSize: 11, color: "#64748b", fontFamily: fonts.mono, textAlign: "center" }}>Loading hyperscaler capex from FMP...</div>;
  if (!data?.companies || !Object.keys(data.companies).length) {
    return <InfoBox color="#F97316">Hyperscaler capex data unavailable. FMP may be rate-limited.</InfoBox>;
  }

  const companies = Object.values(data.companies);
  const fmtB = v => `$${v.toFixed(1)}B`;
  const fmtPct1 = v => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const tickInt = Math.max(0, Math.floor(chartData.length / 8) - 1);

  return (<>
    <SH>Hyperscaler Capex — The Demand Behind the Buildout</SH>

    {/* Hero stats */}
    {stats && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="Total Capex Last Q" val={fmtB(stats.lastTotal)} sub={`${stats.lastDate} · ${fmtPct1(stats.yoyGrowth)} YoY`} color="#6366F1" />
        <StatCard label="Implied AI Capex" val={fmtB(stats.lastAi)} sub={`${fmtPct1(stats.yoyAiGrowth)} YoY${stats.lastTotal > 0 ? ` · ${((stats.lastAi/stats.lastTotal)*100).toFixed(0)}% of total` : ""}`} color="#10B981" />
        <StatCard label="TTM Total Capex" val={fmtB(stats.ttmTotal)} sub="Trailing 4 quarters" color="#3B82F6" />
        <StatCard label="TTM Implied AI" val={fmtB(stats.ttmAi)} sub={`Annualized: ${fmtB(stats.ttmAi)}/yr`} color="#F59E0B" />
      </div>
    )}

    {/* Stacked bar chart — total capex */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Quarterly Capex by Company ($B, stacked)</div>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}B`} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`$${v.toFixed(2)}B`, n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          {companies.map(c => (
            <Bar key={c.symbol} dataKey={c.symbol} name={`${c.symbol} (${c.name})`} stackId="capex" fill={c.color} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>

    {/* AI-share sliders */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>AI Share Assumption per Company</div>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 14, lineHeight: 1.5 }}>
        Companies don&apos;t publish AI-specific capex; these sliders apply your estimate of what fraction is AI-related, based on earnings-call disclosures. Adjust to test scenarios.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 16 }}>
        {companies.map(c => (
          <div key={c.symbol}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontFamily: fonts.heading, color: c.color, fontWeight: 600 }}>{c.symbol} · {c.name}</span>
              <span style={{ fontSize: 11, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 700 }}>{((aiShare[c.symbol] || 0) * 100).toFixed(0)}%</span>
            </div>
            <input type="range" min="0" max="100" step="5" value={(aiShare[c.symbol] || 0) * 100}
              onChange={e => setAiShare({ ...aiShare, [c.symbol]: parseInt(e.target.value) / 100 })}
              style={{ width: "100%", accentColor: c.color }} />
          </div>
        ))}
      </div>
    </div>

    {/* AI-only chart */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Implied AI-Specific Capex ($B, stacked)</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={tickInt} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}B`} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`$${v.toFixed(2)}B AI`, n.replace("_AI", "")]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} formatter={n => n.replace("_AI", "")} />
          {companies.map(c => (
            <Bar key={c.symbol} dataKey={`${c.symbol}_AI`} name={`${c.symbol} AI`} stackId="ai" fill={c.color} fillOpacity={0.85} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>

    {/* Per-company quarterly table — most recent quarter */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
        <thead>
          <tr>
            {["Company", "Latest Q", "Capex", "AI Share", "Implied AI", "YoY Total", "TTM Total"].map(h => (
              <th key={h} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: h === "Company" ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {companies.map(c => {
            const qs = c.quarters;
            const last = qs[qs.length - 1];
            const yoy = qs[qs.length - 5];
            const last4 = qs.slice(-4);
            const ttm = last4.reduce((s, q) => s + (q.capex || 0), 0) / 1e9;
            const yoyG = yoy ? ((last.capex - yoy.capex) / yoy.capex) * 100 : null;
            const lastB = (last.capex || 0) / 1e9;
            const aiB = lastB * (aiShare[c.symbol] || 0);
            return (
              <tr key={c.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: c.color, fontWeight: 600 }}>{c.symbol} · {c.name}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{last.date} {last.period}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 600, textAlign: "right" }}>{fmtB(lastB)}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8", textAlign: "right" }}>{((aiShare[c.symbol] || 0) * 100).toFixed(0)}%</td>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#10B981", fontWeight: 600, textAlign: "right" }}>{fmtB(aiB)}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, fontWeight: 600, textAlign: "right", color: (yoyG ?? 0) > 0 ? "#4ade80" : "#f87171" }}>{fmtPct1(yoyG)}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#a5b4fc", fontWeight: 600, textAlign: "right" }}>{fmtB(ttm)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>What this is telling you.</strong> Hyperscaler capex is the most important upstream demand signal in the AI economy — it&apos;s the dollars that get converted into chips, data centers, and ultimately tokens. Adjusted YoY growth above 50% (sustained) means we&apos;re still in expansion. A sharp deceleration would be the clearest signal yet that the build-out is peaking. Raw company numbers are exact (from quarterly filings); the AI-share split is your editorial call.
    </InfoBox>
  </>);
}

// ── Adoption breadth: Census BTOS % of firms using AI (curated releases) ────
function BtosAdoptionPanel() {
  const last = BTOS_AI_ADOPTION[BTOS_AI_ADOPTION.length - 1];
  const first = BTOS_AI_ADOPTION[0];
  return (<>
    <SH>Adoption Breadth — % of U.S. Firms Using AI (Census BTOS)</SH>
    <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px", flex: "0 1 220px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: "#22C55E" }} />
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>Using AI Now</div>
        <div style={{ fontSize: 30, fontWeight: 700, color: "#22C55E", fontFamily: fonts.heading, marginTop: 4 }}>{last.pct}%</div>
        <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5 }}>as of {last.d} — {(last.pct / first.pct).toFixed(1)}× since {first.d.slice(0, 4)}. Expected next 6mo: 20–23%.</div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px", flex: "1 1 300px" }}>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={BTOS_AI_ADOPTION} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${v}%${p.payload.approx ? " (≈)" : ""}`, "firms using AI"]} />
            <Line type="monotone" dataKey="pct" stroke="#22C55E" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px", flex: "0 1 260px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Who&apos;s Adopting (May 2026)</div>
        {BTOS_SPLITS.map(s => (
          <div key={s.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, fontFamily: fonts.mono, padding: "2.5px 0" }}>
            <span style={{ color: "#cbd5e1" }}>{s.label}</span>
            <span style={{ color: s.pct >= 30 ? "#4ade80" : s.pct >= 18 ? "#fbbf24" : "#94a3b8", fontWeight: 700 }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
    <InfoBox color="#22C55E">
      <strong style={{ color: "#cbd5e1" }}>Why breadth matters more than depth here.</strong> Capability (above) says AI <em>can</em> do the work; this says how much of the economy is actually letting it. ~1.2M firms surveyed biweekly by Census — the least gameable adoption number that exists. The 3.7%→{last.pct}% path in under three years is the diffusion curve steepening; when this crosses ~30–40% while capability keeps compounding, the productivity series below stops being an academic question. Points marked ≈ are press-reported between official releases — update from each BTOS release (biweekly cadence, curated in <code style={{ color: "#a5b4fc" }}>BTOS_AI_ADOPTION</code>).
    </InfoBox>
  </>);
}

// ── The power bottleneck, priced: PJM capacity auctions + retail electricity ─
function PowerBottleneckPanel() {
  const [elec, setElec] = useState(null);
  useEffect(() => {
    // Netlify fork: baked path, and the limit applied here since the file
    // carries the full series.
    fetch("/api/fred/APU000072610")
      .then(r => r.json())
      .then(d => {
        const obs = (d.observations || []).slice(0, 240).map(o => ({ d: o.date, v: +o.value })).filter(o => isFinite(o.v)).reverse();
        if (obs.length) setElec(obs);
      })
      .catch(() => {});
  }, []);
  const elecNow = elec?.length ? elec[elec.length - 1] : null;
  const elecYr = elec?.length > 12 ? elec[elec.length - 13] : null;
  const pjmLast = PJM_CAPACITY[PJM_CAPACITY.length - 1];
  const pjmPrev = PJM_CAPACITY[PJM_CAPACITY.length - 3]; // two auctions back = pre-spike base
  return (<>
    <SH>The Power Bottleneck — What the Grid Charges for Scarcity</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", paddingLeft: 14, marginBottom: 6 }}>
          PJM Capacity Auction Clearing Price ($/MW-day)
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={PJM_CAPACITY} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="auction" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`$${v}/MW-day`, "clearing price"]} />
            <Bar dataKey="price" radius={[4, 4, 0, 0]}>
              {PJM_CAPACITY.map((r, i) => <Cell key={i} fill={r.price > 100 ? "#f87171" : "#818cf8"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "4px 0 6px 14px", lineHeight: 1.5 }}>
          The largest US grid&apos;s price for guaranteed capacity: {pjmPrev ? `~${Math.round(pjmLast.price / pjmPrev.price)}× in two auctions` : "a step-change"} — the purest &ldquo;datacenters ate the slack&rdquo; market print. Public auction results; add each new BRA to <code style={{ color: "#a5b4fc" }}>PJM_CAPACITY</code>.
        </div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingLeft: 14, paddingRight: 10, marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>US Retail Electricity ($/kWh)</div>
          {elecNow && elecYr && (
            <div style={{ fontSize: 10, color: elecNow.v > elecYr.v ? "#f87171" : "#4ade80", fontFamily: fonts.mono, fontWeight: 600 }}>
              {((elecNow.v / elecYr.v - 1) * 100).toFixed(1)}% YoY
            </div>
          )}
        </div>
        {elec ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={elec} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={40} />
              <YAxis domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(2)}`} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`$${(+v).toFixed(3)}/kWh`, "avg retail price"]} labelFormatter={d => d.slice(0, 7)} />
              <Line type="monotone" dataKey="v" stroke="#F59E0B" strokeWidth={1.8} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading FRED series…</div>}
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "4px 0 6px 14px", lineHeight: 1.5 }}>
          FRED APU000072610, monthly. The consumer-facing echo of grid tightness — politically explosive if datacenter demand keeps pushing it. Rising power prices are simultaneously the compute thesis CONFIRMING and its biggest regulatory risk.
        </div>
      </div>
    </div>
  </>);
}

function ComputePowerTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = () => {
    setLoading(true);
    fetch("/api/ai-impact")
      .then(r => r.json())
      .then(d => { setData(d); setLastRefresh(Date.now()); })
      .catch(e => console.error("AI Impact error:", e))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading && !data) {
    return <div style={{ padding: 40, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading real-economy AI metrics...</div>;
  }
  if (!data || !data.fred) {
    return <InfoBox color="#F97316">Unable to load real-economy data. FRED API may be temporarily unavailable.</InfoBox>;
  }

  const f = data.fred;
  // Convenience refs
  const prod     = f.OPHNFB;
  const infoProd = f.MPU4910063;
  const softInv  = f.Y694RX1Q020SBEA;
  const ipInv    = f.A679RC1Q027SBEA;
  const hwInv    = f.Y033RC1Q027SBEA;
  const semis    = f.IPG3344S;
  const mfgCons  = f.TLMFGCONS;
  const csdJobs  = f.CES6054150001;
  const infoJobs = f.USINFO;
  const power    = f.IPG2211A2N;

  // Loaded count for health badge
  const loadedCount = Object.keys(f).length;

  return (<>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5 }}>Compute &amp; Power — The Buildout</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>{loadedCount} live series</span>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>
          {lastRefresh ? `| Updated ${new Date(lastRefresh).toLocaleTimeString()}` : ""}
        </span>
        <button onClick={load} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono }}>Refresh Refresh</button>
      </div>
    </div>
    <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 18, maxWidth: 780 }}>
      Stage 3 of the chain: the data-center buildout and what it costs. Who is spending (hyperscaler capex), who is financing it (the AI debt stack), what the grid charges for scarcity (PJM), and whether the buildout is showing up in the real economy — construction, semis output, jobs, power generation, and ultimately productivity.
    </div>

    {/* ======== POWER BOTTLENECK ======== */}
    <PowerBottleneckPanel />

    {/* ======== PRODUCTIVITY ======== */}
    <SH>Productivity - The Ultimate Test</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px, 100%),1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Nonfarm Productivity (idx)" val={prod?.current?.toFixed(1) ?? "-"} sub={`YoY ${fmtPct(prod?.yoy, 1)} | 5y ${fmtPct(prod?.fiveYr, 1)}`} color="#10B981" />
      <StatCard label="Info Sector Productivity (idx)" val={infoProd?.current?.toFixed(1) ?? "-"} sub={`YoY ${fmtPct(infoProd?.yoy, 1)} | ${fmtDate2(infoProd?.lastDate)}`} color="#14B8A6" />
    </div>
    <FredChart series={prod} title="Nonfarm Business Labor Productivity (Index, Quarterly)" yoyHighlight yFormat={v => v.toFixed(1)} />
    <InfoBox color="#10B981">
      <strong style={{ color: "#cbd5e1" }}>The headline number.</strong> US nonfarm productivity has averaged ~2%/yr over the long run. A sustained break above ~2.5% would be the first direct evidence AI is delivering real economic value - not just speculative capex. Most economists consider 2023-24&apos;s uptick encouraging but not yet confirmation.
    </InfoBox>
    {infoProd?.history?.length > 0 && (
      <FredChart series={infoProd} title="Information Sector Labor Productivity (Index, Quarterly)" yoyHighlight yFormat={v => v.toFixed(1)} />
    )}

    {/* ======== CAPITAL FORMATION ======== */}
    <SH>Capital Formation - Where The Money Is Flowing</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px, 100%),1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Real Software Investment" val={fmtFredVal(softInv)} sub={`YoY ${fmtPct(softInv?.yoy, 1)} | 5y ${fmtPct(softInv?.fiveYr, 0)}`} color="#6366F1" />
      <StatCard label="Real IP Products Investment" val={fmtFredVal(ipInv)} sub={`YoY ${fmtPct(ipInv?.yoy, 1)} | 5y ${fmtPct(ipInv?.fiveYr, 0)}`} color="#8B5CF6" />
      <StatCard label="Info-Processing Equipment" val={fmtFredVal(hwInv)} sub={`YoY ${fmtPct(hwInv?.yoy, 1)} | 5y ${fmtPct(hwInv?.fiveYr, 0)}`} color="#A855F7" />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      <FredChart series={softInv} title="Real Software Investment ($B, SAAR)" yoyHighlight yFormat={fmtFredChart(softInv)} />
      <FredChart series={ipInv}   title="Real IP Products Investment ($B, SAAR)" yoyHighlight yFormat={fmtFredChart(ipInv)} />
    </div>
    <FredChart series={hwInv} title="Real Information-Processing Equipment Investment ($B, SAAR)" yoyHighlight yFormat={fmtFredChart(hwInv)} />
    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>Following the capex.</strong> Software, IP products, and info-processing equipment together make up most of US business investment in &quot;intangibles + compute.&quot; If AI is driving a real investment cycle, these three should all be accelerating in tandem - and they largely are, especially hardware since 2023.
    </InfoBox>

    {/* ======== HYPERSCALER CAPEX ======== */}
    <HyperscalerCapexPanel />

    {/* ======== AI DEBT MARKET (who funds the buildout) ======== */}
    <AIDebtPanel />

    {/* ======== PHYSICAL BUILDOUT ======== */}
    <SH>Physical Buildout - Chips &amp; Data Centers</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px, 100%),1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Semi Production (idx)" val={semis?.current?.toFixed(1) ?? "-"} sub={`YoY ${fmtPct(semis?.yoy, 1)} | 5y ${fmtPct(semis?.fiveYr, 0)}`} color="#F59E0B" />
      <StatCard label="Manufacturing Construction" val={fmtFredVal(mfgCons)} sub={`YoY ${fmtPct(mfgCons?.yoy, 1)} | 5y ${fmtPct(mfgCons?.fiveYr, 0)}`} color="#EF4444" />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      <FredChart series={semis}   title="Industrial Production: Semiconductors (Index)" yoyHighlight yFormat={v => v.toFixed(1)} />
      <FredChart series={mfgCons} title="Private Manufacturing Construction ($M, Monthly)" yoyHighlight yFormat={fmtFredChart(mfgCons)} />
    </div>
    <InfoBox color="#EF4444">
      <strong style={{ color: "#cbd5e1" }}>CHIPS Act in motion.</strong> Manufacturing construction spending has roughly tripled since 2021 - an unprecedented, visible-from-space real-economy footprint. Semiconductor production itself has been more cyclical, but the fab-build boom is laying the foundation for the next decade of AI compute capacity.
    </InfoBox>

    {/* ======== EMPLOYMENT ======== */}
    <SH>Employment - Jobs In The AI Supply Chain</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px, 100%),1fr))", gap: 10, marginBottom: 14 }}>
      <StatCard label="Computer Systems Design" val={csdJobs?.current != null ? `${(csdJobs.current / 1000).toFixed(2)}M jobs` : "-"} sub={`YoY ${fmtPct(csdJobs?.yoy, 1)} | 5y ${fmtPct(csdJobs?.fiveYr, 0)}`} color="#3B82F6" />
      <StatCard label="Information Sector" val={infoJobs?.current != null ? `${(infoJobs.current / 1000).toFixed(2)}M jobs` : "-"} sub={`YoY ${fmtPct(infoJobs?.yoy, 1)} | 5y ${fmtPct(infoJobs?.fiveYr, 0)}`} color="#60A5FA" />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      <FredChart series={csdJobs}  title="Computer Systems Design Employment (thousands)" yoyHighlight yFormat={v => `${(v/1000).toFixed(2)}M`} />
      <FredChart series={infoJobs} title="Information Sector Employment (thousands)" yoyHighlight yFormat={v => `${(v/1000).toFixed(2)}M`} />
    </div>
    <InfoBox color="#F59E0B">
      <strong style={{ color: "#cbd5e1" }}>The labor paradox.</strong> Hyperscaler AI capex is projected at $300B+ in 2025-26, yet information-sector headcount has stagnated since 2022. That gap - huge compute spend, flat payrolls - is the signature of a productivity-driven investment cycle: output is rising faster than employment. Watch this spread widen or close.
    </InfoBox>

    {/* ======== POWER ======== */}
    {power?.history?.length > 0 && (<>
      <SH>Power Demand - AI&apos;s Physical Footprint</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px, 100%),1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="Electric Power Generation" val={power.current?.toFixed(1) ?? "-"} sub={`YoY ${fmtPct(power.yoy, 1)} | 5y ${fmtPct(power.fiveYr, 1)}`} color="#EAB308" />
      </div>
      <FredChart series={power} title="Electric Power Generation (Index, Monthly)" yoyHighlight yFormat={v => v.toFixed(1)} />
      <InfoBox color="#EAB308">
        <strong style={{ color: "#cbd5e1" }}>The power problem is real.</strong> US electricity demand was essentially flat for 15 years (2007-2022); utilities now forecast 15-20% growth by 2030, driven largely by AI data centers. Watch this series break from its decade-long flatline - it&apos;s the clearest physical tell that AI compute is expanding at scale.
      </InfoBox>
    </>)}

    <InfoBox color="#8B5CF6">
      <strong style={{ color: "#cbd5e1" }}>Data source:</strong> All time series from <a href="https://fred.stlouisfed.org" target="_blank" rel="noopener" style={{ color: "#a5b4fc" }}>FRED</a> (St. Louis Fed), originating from BLS, BEA, and Federal Reserve G.17 reports. Refreshes every 4 hours server-side. No equity or market-cap data included - this tab is intentionally about the real economy only.
    </InfoBox>
  </>);
}


const MODEL_QUALITY = {
  "openai/gpt-5.5-pro":              { mmlu: 95, gpqa: 88 },
  "openai/gpt-5.5":                  { mmlu: 92, gpqa: 85 },
  "openai/gpt-5.4":                  { mmlu: 90, gpqa: 82 },
  "openai/gpt-5.4-mini":             { mmlu: 86, gpqa: 75 },
  "openai/gpt-5.4-nano":             { mmlu: 78, gpqa: 60 },
  "openai/gpt-5.2-pro":              { mmlu: 91, gpqa: 84 },
  "openai/gpt-5-codex":              { mmlu: 90, gpqa: 80 },
  "openai/o3-pro":                   { mmlu: 91, gpqa: 89 },
  "openai/gpt-4.1":                  { mmlu: 88, gpqa: 72 },
  "openai/gpt-4.1-mini":             { mmlu: 82, gpqa: 65 },
  "openai/gpt-oss-120b":             { mmlu: 79, gpqa: 62 },
  "anthropic/claude-opus-4.8":       { mmlu: 93, gpqa: 87 },
  "anthropic/claude-opus-4.7":       { mmlu: 92, gpqa: 86 },
  "anthropic/claude-opus-4.6":       { mmlu: 91, gpqa: 85 },
  "anthropic/claude-sonnet-4.6":     { mmlu: 89, gpqa: 80 },
  "anthropic/claude-sonnet-4.5":     { mmlu: 88, gpqa: 78 },
  "anthropic/claude-haiku-4.5":      { mmlu: 82, gpqa: 68 },
  "google/gemini-3.1-pro-preview":   { mmlu: 91, gpqa: 84 },
  "google/gemini-3.5-flash":         { mmlu: 87, gpqa: 76 },
  "google/gemini-2.5-pro":           { mmlu: 90, gpqa: 82 },
  "google/gemini-2.5-flash":         { mmlu: 84, gpqa: 72 },
  "google/gemini-2.5-flash-lite":    { mmlu: 76, gpqa: 60 },
  "x-ai/grok-4.3":                   { mmlu: 90, gpqa: 83 },
  "x-ai/grok-4.20":                  { mmlu: 89, gpqa: 81 },
  "deepseek/deepseek-v4-pro":        { mmlu: 87, gpqa: 75 },
  "deepseek/deepseek-v4-flash":      { mmlu: 79, gpqa: 60 },
  "deepseek/deepseek-v3.2":          { mmlu: 84, gpqa: 70 },
  "deepseek/deepseek-r1":            { mmlu: 86, gpqa: 79 },
  "meta-llama/llama-4-maverick":     { mmlu: 83, gpqa: 70 },
  "meta-llama/llama-4-scout":        { mmlu: 78, gpqa: 60 },
  "meta-llama/llama-3.3-70b-instruct": { mmlu: 75, gpqa: 50 },
  "mistralai/mistral-large-2512":    { mmlu: 80, gpqa: 65 },
  "mistralai/mistral-medium-3.1":    { mmlu: 75, gpqa: 55 },
  "qwen/qwen3.7-max":                { mmlu: 86, gpqa: 75 },
  "qwen/qwen3.5-397b-a17b":          { mmlu: 82, gpqa: 68 },
};

// Reported token-volume disclosures — the only public "level" anchors that exist.
// SEED VALUES — reported figures, verify against source and extend as new
// disclosures land. Single-provider platform totals (so total market ≥ the max).
const TOKEN_DISCLOSURES = [
  { date: "2024-04", provider: "Google",    tpm: 9.7e12,  source: "Google I/O 2024 (Pichai)" },
  { date: "2025-05", provider: "Google",    tpm: 480e12,  source: "Google I/O 2025" },
  { date: "2025-07", provider: "Google",    tpm: 980e12,  source: "Alphabet Q2-25 call" },
  { date: "2025-04", provider: "Microsoft", tpm: 33e12,   source: "MSFT FY25 Q3 (~100T/qtr)" },
  { date: "2025-05", provider: "Microsoft", tpm: 167e12,  source: "Build 2025 (~500T/qtr)" },
];
const DISC_COLOR = { Google: "#4285F4", Microsoft: "#00A4EF", OpenAI: "#10B981", Anthropic: "#E8553A" };

// ── AI KPI curated constants (verify & extend — same pattern as TOKEN_DISCLOSURES) ──
// Lab classification for market-structure KPIs (OpenRouter ys keys are lab slugs)
const OPEN_LABS = new Set(["deepseek", "qwen", "z-ai", "meta-llama", "mistralai", "moonshotai", "minimax", "tencent", "xiaomi", "nvidia", "microsoft", "nousresearch", "cognitivecomputations"]);
const CLOSED_LABS = new Set(["anthropic", "openai", "google", "x-ai", "amazon", "cohere", "perplexity", "inflection"]);

// Disclosed AI revenue run-rates ($B annualized) — reported figures from press
// releases / earnings; the DOLLAR check on the token-volume estimate.
const REVENUE_DISCLOSURES = [
  { d: "2023-12", co: "OpenAI",       arr: 1.6,  src: "reported ARR" },
  { d: "2024-06", co: "OpenAI",       arr: 3.4,  src: "reported ARR" },
  { d: "2025-06", co: "OpenAI",       arr: 10,   src: "reported ARR" },
  { d: "2025-12", co: "OpenAI",       arr: 20,   src: "reported ~$20B ARR" },
  { d: "2024-12", co: "Anthropic",    arr: 1.0,  src: "reported ARR" },
  { d: "2025-03", co: "Anthropic",    arr: 2.0,  src: "reported ARR" },
  { d: "2025-08", co: "Anthropic",    arr: 5.0,  src: "reported ARR" },
  { d: "2026-01", co: "Anthropic",    arr: 9.0,  src: "reported ~$9B ARR", approx: true },
  { d: "2025-01", co: "Microsoft AI", arr: 13,   src: "disclosed run-rate" },
];
const REV_CO_COLOR = { OpenAI: "#10B981", Anthropic: "#E8553A", "Microsoft AI": "#00A4EF" };

// PJM capacity auction clearing prices ($/MW-day, RTO) — the market's price on
// grid scarcity. Public auction results; add each Base Residual Auction.
const PJM_CAPACITY = [
  { auction: "2023/24", price: 34.13 },
  { auction: "2024/25", price: 28.92 },
  { auction: "2025/26", price: 269.92 },
  { auction: "2026/27", price: 329.17 },
];

// Census BTOS: % of US firms using AI to produce goods/services. Biweekly
// survey of ~1.2M businesses; points below from Census releases (≈ = read
// from press coverage between official releases — verify on next release).
const BTOS_AI_ADOPTION = [
  { d: "2023-09", pct: 3.7 },
  { d: "2024-02", pct: 5.4 },
  { d: "2024-11", pct: 6.6 },
  { d: "2025-06", pct: 12.0, approx: true },
  { d: "2025-12", pct: 17.0 },
  { d: "2026-05", pct: 19.8 },
];
const BTOS_SPLITS = [
  { label: "Firms 250+ employees", pct: 37 },
  { label: "Firms 100–249", pct: 32 },
  { label: "Information sector", pct: 39.7 },
  { label: "Finance & Insurance", pct: 33.9 },
  { label: "Retail trade", pct: 14 },
];

// Supply ceiling: TSMC CoWoS advanced-packaging capacity (k wafers/month,
// TrendForce-reported estimates — approximate) + HBM sold-out statements.
const SUPPLY_CEILING = {
  cowos: [
    { d: "2023-12", kwpm: 14 },
    { d: "2024-12", kwpm: 35 },
    { d: "2025-12", kwpm: 70 },
    { d: "2026-12", kwpm: 105, est: true },
  ],
  hbm: [
    { d: "2024-05", note: "SK Hynix: 2025 HBM capacity essentially sold out" },
    { d: "2025-04", note: "SK Hynix: 2026 HBM capacity nearly fully booked" },
    { d: "2026-02", note: "Samsung/SKH: HBM4 allocations contested through 2027", approx: true },
  ],
};

// OpenRouter reports the CURRENT in-progress week, whose token total is only
// partly accumulated — it collapses to a fraction of trend and craters any
// level/growth read (the "cliff"). Return weekly totals with trailing partial
// weeks trimmed: drop the last week while it sits below 55% of the median of
// the prior four complete weeks (handles a stale scraper too, up to 2 weeks).
function orWeeklyTotals(or) {
  const ms = or?.marketShare || [];
  let weeks = ms.map(w => ({ d: w.x, v: Object.values(w.ys || {}).reduce((s, x) => s + x, 0) }));
  for (let guard = 0; guard < 2 && weeks.length >= 6; guard++) {
    const prior = weeks.slice(-5, -1).map(w => w.v).sort((a, b) => a - b);
    const med = prior[Math.floor(prior.length / 2)];
    if (med > 0 && weeks[weeks.length - 1].v < 0.55 * med) weeks = weeks.slice(0, -1);
    else break;
  }
  return weeks;
}

// OpenRouter has silently frozen before (path rotations serve a stale archive
// until someone notices). Detect it: how old is the newest data, and did the
// live fetch actually succeed this run (source "live+archive" vs "archive-only")?
function orFreshness(or) {
  if (!or) return null;
  const dates = [];
  const ms = or.marketShare || [];
  if (ms.length) dates.push(ms[ms.length - 1].x);
  const rows = or.rows || [];
  if (rows.length) dates.push(rows.reduce((mx, r) => (r.date > mx ? r.date : mx), rows[0].date));
  if (!dates.length) return null;
  const lastData = dates.sort()[dates.length - 1];
  const daysStale = Math.floor((Date.now() - Date.parse(lastData)) / 86400000);
  const liveFailed = typeof or.source === "string" && !or.source.includes("live");
  return { lastData, daysStale, stale: daysStale > 10, liveFailed, source: or.source };
}

// Renders nothing when the feed is fresh and live; otherwise an inline warning.
function StaleBanner({ or }) {
  const f = orFreshness(or);
  if (!f || (!f.stale && !f.liveFailed)) return null;
  const red = f.stale;
  const color = red ? "#ef4444" : "#fbbf24";
  const msg = f.liveFailed && f.stale
    ? `OpenRouter live fetch is failing and the data hasn't advanced in ${f.daysStale} days — the feed has likely broken again (last time: an API path rotation). Numbers below are a frozen archive.`
    : f.liveFailed
    ? `OpenRouter live fetch failed this run (serving cached archive, source "${f.source}"). Data may stop advancing — watch this banner.`
    : `OpenRouter data hasn't updated in ${f.daysStale} days (latest ${f.lastData}). The feed may have frozen; treat token figures below as stale.`;
  return (
    <div style={{ background: red ? "rgba(239,68,68,0.08)" : "rgba(251,191,36,0.08)", border: `1px solid ${color}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ color, fontSize: 14, lineHeight: 1.2 }}>⚠</span>
      <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, lineHeight: 1.5 }}>{msg}</span>
    </div>
  );
}


// ─── External usage signals panel: SO / GitHub / Cloudflare Radar ──────────
const PROV_COLOR = {
  OpenAI:      "#10B981",
  Anthropic:   "#E8553A",
  Google:      "#3B82F6",
  HuggingFace: "#F59E0B",
  Framework:   "#6366F1",
  Inference:   "#8B5CF6",
  Other:       "#94a3b8",
};

function MiniSpark({ values, color = "#818cf8", h = 30 }) {
  const v = (values || []).filter(x => x != null && isFinite(x));
  if (v.length < 3) return null;
  const min = Math.min(...v), max = Math.max(...v), range = (max - min) || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${(1 - (x - min) / range) * (h - 4) + 2}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// One "corroborating signal" verdict card: read + key stat + spark, detail on expand
function SignalCard({ tone, name, verdict, stat, statSub, spark, sparkColor }) {
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", borderLeft: `3px solid ${tone}`, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 5 }}>{name}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: tone, fontFamily: fonts.heading, lineHeight: 1.25, marginBottom: 6 }}>{verdict}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{stat}</span>
        {statSub && <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono }}>{statSub}</span>}
      </div>
      {spark && <div style={{ marginTop: 8 }}><MiniSpark values={spark} color={sparkColor || tone} /></div>}
    </div>
  );
}

function UsageSignalsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    fetch("/api/usage-signals")
      .then(r => r.json())
      .then(d => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Aggregate SO monthly history across all tags = total AI question volume per month
  const soAggregate = useMemo(() => {
    if (!data?.stackOverflowMonthly) return { months: [], peak: 0, latest: 0, yoy: null, fromPeak: null };
    const mh = data.stackOverflowMonthly;
    const totals = {};
    Object.values(mh).forEach(points => {
      points.forEach(p => { totals[p.month] = (totals[p.month] || 0) + (p.count || 0); });
    });
    const months = Object.entries(totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total }));
    if (!months.length) return { months: [], peak: 0, latest: 0, yoy: null, fromPeak: null };
    const peak = Math.max(...months.map(m => m.total));
    const latest = months[months.length - 1].total;
    const yoy = months.length > 12
      ? ((latest - months[months.length - 13].total) / Math.max(1, months[months.length - 13].total)) * 100
      : null;
    const fromPeak = peak ? ((latest - peak) / peak) * 100 : null;
    return { months, peak, latest, yoy, fromPeak };
  }, [data]);

  // Provider-share-over-time: each month, sum questions per provider category
  const providerShareSeries = useMemo(() => {
    if (!data?.stackOverflowMonthly) return { rows: [], providers: [] };
    const mh = data.stackOverflowMonthly;
    const provByTag = Object.fromEntries((data.stackOverflow || []).map(t => [t.tag, t.provider]));
    const monthsMap = {};
    Object.entries(mh).forEach(([tag, points]) => {
      const prov = provByTag[tag] || "Other";
      points.forEach(p => {
        if (!monthsMap[p.month]) monthsMap[p.month] = {};
        monthsMap[p.month][prov] = (monthsMap[p.month][prov] || 0) + (p.count || 0);
      });
    });
    const providers = [...new Set(Object.values(provByTag))];
    const rows = Object.entries(monthsMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, byProv]) => {
        const row = { month };
        providers.forEach(p => { row[p] = byProv[p] || 0; });
        return row;
      });
    return { rows, providers };
  }, [data]);

  // GitHub aggregate basket stats
  const ghAggregate = useMemo(() => {
    if (!data?.github) return null;
    const total = data.github.reduce((s, r) => s + (r.stars || 0), 0);
    const totalForks = data.github.reduce((s, r) => s + (r.forks || 0), 0);
    const snapDates = Object.keys(data.snapshots || {}).sort();
    let deltaPerDay = null, deltaTotal = null, deltaDays = null;
    if (snapDates.length >= 2) {
      const first = snapDates[0];
      const last = snapDates[snapDates.length - 1];
      const firstTotal = (data.snapshots[first].github || []).reduce((s, r) => s + (r.stars || 0), 0);
      const lastTotal  = (data.snapshots[last].github  || []).reduce((s, r) => s + (r.stars || 0), 0);
      deltaTotal = lastTotal - firstTotal;
      deltaDays = (new Date(last) - new Date(first)) / 86400000 || 1;
      deltaPerDay = Math.round(deltaTotal / Math.max(1, deltaDays));
    }
    return { total, totalForks, deltaPerDay, deltaTotal, deltaDays };
  }, [data]);

  // Per-tag detail (with YoY + peak deltas)
  const tagDetails = useMemo(() => {
    if (!data?.stackOverflowMonthly) return [];
    const mh = data.stackOverflowMonthly;
    const provByTag = Object.fromEntries((data.stackOverflow || []).map(t => [t.tag, { provider: t.provider, label: t.label, total: t.totalQuestions }]));
    return Object.entries(mh).map(([tag, points]) => {
      const latest = points.length ? points[points.length - 1].count || 0 : 0;
      const peak = Math.max(...points.map(p => p.count || 0), 0);
      const yoyPoint = points.length > 12 ? points[points.length - 13].count || 0 : null;
      const yoy = yoyPoint != null && yoyPoint > 0 ? ((latest - yoyPoint) / yoyPoint) * 100 : null;
      const fromPeak = peak > 0 ? ((latest - peak) / peak) * 100 : null;
      const meta = provByTag[tag] || { provider: "Other", label: tag, total: 0 };
      return { tag, label: meta.label, provider: meta.provider, latest, peak, total: meta.total, yoy, fromPeak };
    }).sort((a, b) => b.peak - a.peak);
  }, [data]);

  // Build the GitHub star history from accumulated snapshots
  const ghHistory = useMemo(() => {
    if (!data?.snapshots) return [];
    const dates = Object.keys(data.snapshots).sort();
    if (dates.length < 2) return [];
    const allRepos = new Set();
    dates.forEach(d => (data.snapshots[d].github || []).forEach(r => allRepos.add(r.repo)));
    return dates.map(d => {
      const row = { date: d };
      const snap = data.snapshots[d];
      (snap.github || []).forEach(r => { row[r.repo] = r.stars; });
      return row;
    });
  }, [data]);

  if (loading && !data) {
    return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontSize: 11, fontFamily: fonts.mono }}>Loading external usage signals…</div>;
  }
  if (error || !data) {
    return <InfoBox color="#F97316">Unable to load Stack Overflow / GitHub / Cloudflare data.</InfoBox>;
  }

  const so = (data.stackOverflow || []).slice().sort((a, b) => b.totalQuestions - a.totalQuestions);
  const gh = (data.github || []).slice().sort((a, b) => b.stars - a.stars);
  const cf = data.cloudflare || {};
  // Cloudflare Radar `radar/ai/inference/.../model` = model MIX on Cloudflare's
  // own Workers-AI edge (percentage share, not volume). Heavily embeddings-
  // dominated — a narrow signal, labeled honestly below.
  const cfModels = (() => {
    const s = cf.raw && cf.raw.serie_0;
    if (!s || !s.timestamps || !s.timestamps.length) return null;
    const i = s.timestamps.length - 1;
    const isEmbed = m => /bge|embed|m2m100|whisper/i.test(m);
    const rows = Object.keys(s).filter(k => k !== "timestamps").map(m => ({
      model: m,
      short: m.replace(/^@cf\//, ""),
      share: s[m][i] == null ? 0 : Number(s[m][i]),
      utility: m !== "other" && isEmbed(m),
    })).sort((a, b) => b.share - a.share);
    const utilShare = rows.filter(r => r.utility).reduce((t, r) => t + r.share, 0);
    return { rows, utilShare, asOf: s.timestamps[i] };
  })();
  const fmtN = n => n == null ? "—" : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n);

  const fmtPctSimple = v => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  // Total basket stars per snapshot — the GitHub spark
  const ghSparkVals = ghHistory.map(row => Object.entries(row).filter(([k]) => k !== "date").reduce((s, [, v]) => s + (v || 0), 0));
  const soSparkVals = soAggregate.months.map(m => m.total);

  // ── Three one-line reads (these are corroborating, not primary, lenses) ──
  const ghUp = (ghAggregate?.deltaPerDay ?? 0) > 0;
  const reads = {
    so: {
      tone: "#64748b",
      verdict: "Not a demand gauge — devs moved to AI chat",
      stat: `${fmtPctSimple(soAggregate.fromPeak)} vs peak`,
      statSub: soAggregate.yoy != null ? `${fmtPctSimple(soAggregate.yoy)} YoY` : "",
      spark: soSparkVals, sparkColor: "#F97316",
    },
    gh: {
      tone: ghUp ? "#4ade80" : "#64748b",
      verdict: ghUp ? "Developer mindshare still compounding" : "Mindshare flat — awaiting more snapshots",
      stat: ghAggregate?.deltaPerDay != null ? `+${fmtN(ghAggregate.deltaPerDay)}★/day` : fmtN(ghAggregate?.total),
      statSub: `across ${(data.github || []).length} repos`,
      spark: ghSparkVals.length >= 3 ? ghSparkVals : null, sparkColor: "#8B5CF6",
    },
    cf: cf.available
      ? { tone: "#fbbf24", verdict: cfModels ? `Edge inference is ${cfModels.utilShare.toFixed(0)}% embeddings — narrow lens` : "Edge model mix — narrow lens", stat: cfModels ? `${(100 - cfModels.utilShare).toFixed(0)}% generative` : "live", statSub: "CF Workers-AI only", spark: null }
      : { tone: "#475569", verdict: "Not enabled — needs a free Radar token", stat: "off", statSub: cf.reason || "no_token", spark: null },
  };

  return (<>
    {/* ── SUMMARY: one-line read per corroborating signal ── */}
    <SH>Corroborating Signals — Developer Behavior</SH>
    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, lineHeight: 1.5, maxWidth: 820 }}>
      These three don&apos;t measure tokens — they <em>corroborate</em> the primary lenses above by tracking what developers do. None is a headline number on its own; here&apos;s the one-line read on each, with the charts a click away.
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      <SignalCard name="Stack Overflow — AI Questions" {...reads.so} />
      <SignalCard name="GitHub — AI Repo Stars" {...reads.gh} />
      <SignalCard name="Cloudflare — Edge Model Mix" {...reads.cf} />
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "#cbd5e1" }}>How to read these.</strong> The one that trips everyone up is <strong>Stack Overflow</strong>: its question volume is <em>down {Math.abs(soAggregate.fromPeak || 0).toFixed(0)}% from the 2024 peak</em>, which looks bearish but isn&apos;t — developers now ask AI tools instead of SO, so a <em>falling</em> SO line is actually confirmation that AI adoption is rising. Don&apos;t read it as demand; read it inverted. <strong>GitHub stars</strong> track mindshare (real but vanity-prone). <strong>Cloudflare</strong> is a narrow, embeddings-heavy edge slice. You&apos;re not dumb — these are genuinely the weakest of the demand lenses, which is why they now sit behind a summary. Expand only when you want to see <em>which</em> tool or repo moved.
    </InfoBox>

    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 16px" }}>
      <button onClick={() => setShowRaw(v => !v)} style={{ fontSize: 11, padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.35)", background: showRaw ? "rgba(99,102,241,0.18)" : "transparent", color: "#a5b4fc", cursor: "pointer", fontFamily: fonts.mono }}>
        {showRaw ? "▾ Hide" : "▸ Show"} underlying charts
      </button>
      <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono }}>SO trend & per-tag, GitHub bars & star growth, Cloudflare model mix</span>
    </div>

    {showRaw && (<>
    {/* ── HEADLINE: aggregate AI activity hero stats ── */}
    <SH>Aggregate AI Activity — Are Developers Building More or Less?</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 10, marginBottom: 18 }}>
      <StatCard
        label="SO Questions (Latest mo)"
        val={fmtN(soAggregate.latest)}
        sub={`YoY ${fmtPctSimple(soAggregate.yoy)}  ·  vs peak ${fmtPctSimple(soAggregate.fromPeak)}`}
        color={(soAggregate.yoy ?? 0) < 0 ? "#F97316" : "#10B981"}
      />
      <StatCard
        label="SO 24-Month Peak"
        val={fmtN(soAggregate.peak)}
        sub="questions/mo across all tracked AI tags"
        color="#6366F1"
      />
      <StatCard
        label="GitHub Star Basket"
        val={ghAggregate ? fmtN(ghAggregate.total) : "—"}
        sub={`★ across ${(data.github || []).length} tracked AI repos`}
        color="#8B5CF6"
      />
      <StatCard
        label="Stars Added / Day"
        val={ghAggregate?.deltaPerDay != null ? `+${fmtN(ghAggregate.deltaPerDay)}` : "—"}
        sub={ghAggregate?.deltaPerDay != null ? `Avg over last ${Math.round(ghAggregate.deltaDays)} days` : "Pending more snapshots"}
        color="#10B981"
      />
    </div>

    {/* ── KILLER CHART: 24-month aggregate SO trend ── */}
    <SH>AI Question Volume on Stack Overflow — 24-Month Trend</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 18px 8px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, lineHeight: 1.5 }}>
        Total monthly questions across all tracked AI tags. <strong style={{ color: "#f59e0b" }}>This is the story.</strong> Aggregate volume has fallen from ~{fmtN(soAggregate.peak)} questions/mo (mid-2024 peak) to ~{fmtN(soAggregate.latest)} in the latest month — devs are increasingly using AI tools to debug AI questions, not Stack Overflow.
      </div>
      {soAggregate.months.length > 0 && (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={soAggregate.months} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="g-so-agg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F97316" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor(soAggregate.months.length / 10) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtN} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v} questions`, "Total"]} />
            <Area type="monotone" dataKey="total" stroke="#F97316" fill="url(#g-so-agg)" strokeWidth={2} dot={{ r: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
        Sums {(data.stackOverflow || []).length} AI tags. Backfilled from Stack Exchange API monthly windows.
      </div>
    </div>

    {/* ── Provider category share over time ── */}
    {providerShareSeries.rows.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 18px 8px", marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>Provider Category Share Over Time — Who's Gaining/Losing Mindshare</div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={providerShareSeries.rows} margin={{ top: 5, right: 8, left: -10, bottom: 0 }} stackOffset="expand">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor(providerShareSeries.rows.length / 10) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`${v} questions`, n]} />
            <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} />
            {providerShareSeries.providers.map(p => (
              <Area key={p} type="monotone" dataKey={p} stackId="1" stroke={PROV_COLOR[p] || PROV_COLOR.Other} fill={PROV_COLOR[p] || PROV_COLOR.Other} fillOpacity={0.7} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
          Normalized 0–100%. Shows how the mix of which providers devs ask about has shifted.
        </div>
      </div>
    )}

    {/* ── Per-tag detail table ── */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <div style={{ padding: "12px 18px 0", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>Per-Tag Detail — Where the Drop Is Concentrated</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
        <thead>
          <tr>
            {["Tag", "Provider", "Peak (24mo)", "Latest Month", "YoY", "vs Peak", "All-Time Total"].map(h => (
              <th key={h} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: h === "Tag" || h === "Provider" ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tagDetails.map((r, i) => (
            <tr key={r.tag} style={{ borderBottom: i < tagDetails.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: PROV_COLOR[r.provider] || PROV_COLOR.Other, marginRight: 8, verticalAlign: "middle" }} />
                {r.label}
              </td>
              <td style={{ padding: "8px 12px", fontSize: 10, fontFamily: fonts.mono, color: "#94a3b8" }}>{r.provider}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right" }}>{r.peak}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 600 }}>{r.latest}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", fontWeight: 600, color: r.yoy == null ? "#475569" : r.yoy < 0 ? "#f87171" : "#4ade80" }}>{fmtPctSimple(r.yoy)}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: r.fromPeak == null ? "#475569" : r.fromPeak < -20 ? "#f87171" : r.fromPeak < 0 ? "#fbbf24" : "#4ade80" }}>{fmtPctSimple(r.fromPeak)}</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "#64748b", textAlign: "right" }}>{fmtN(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* ── Original SO bar chart (kept as detail view) ── */}
    <SH>Stack Overflow Tag Activity — Production Usage Signal</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 14, lineHeight: 1.5 }}>
        Total questions ever asked, by tag. Devs only ask Stack Overflow when they&apos;re trying to ship something — high cumulative counts signal sustained production use. The "last 30 days" column shows how question rates have <strong style={{ color: "#f59e0b" }}>collapsed</strong> as devs increasingly ask AI tools instead of SO.
      </div>
      <ResponsiveContainer width="100%" height={Math.max(220, so.length * 28)}>
        <BarChart data={so} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtN} />
          <YAxis type="category" dataKey="label" width={140} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${v.toLocaleString()} questions  · last 30d: ${p.payload.questionsLast30Days}`, p.payload.tag]} />
          <Bar dataKey="totalQuestions" radius={[0, 4, 4, 0]}>
            {so.map((r, i) => <Cell key={i} fill={PROV_COLOR[r.provider] || PROV_COLOR.Other} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
        Source: Stack Exchange API. Hover bars to see last-30-day question rates.
      </div>
    </div>

    {/* ── GitHub repo star history ── */}
    <SH>GitHub Repo Stars — Developer Mindshare</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 14, lineHeight: 1.5 }}>
        Cumulative stars on the most popular AI/ML repos. A star is a stronger signal than an SDK download — it means a dev wants to remember the project, follow updates, or contribute. Inference runtimes (Ollama, llama.cpp, ComfyUI) lead because the long tail of open-source devs adds to them daily.
      </div>
      <ResponsiveContainer width="100%" height={Math.max(280, gh.length * 30)}>
        <BarChart data={gh} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtN} />
          <YAxis type="category" dataKey="label" width={140} tick={{ fill: "#cbd5e1", fontSize: 10, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${v.toLocaleString()} ★  ·  ${p.payload.forks.toLocaleString()} forks`, p.payload.repo]} />
          <Bar dataKey="stars" radius={[0, 4, 4, 0]}>
            {gh.map((r, i) => <Cell key={i} fill={PROV_COLOR[r.provider] || PROV_COLOR.Other} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
        Source: GitHub API. Daily snapshots accumulate — once 7+ days are archived, a star-growth chart will appear below.
      </div>
    </div>

    {/* ── GitHub star-growth time series (only when we have ≥2 snapshots) ── */}
    {ghHistory.length >= 2 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>Star Growth Over Time ({ghHistory.length} snapshots)</div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={ghHistory} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtN} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [v.toLocaleString(), n]} />
            <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} />
            {gh.slice(0, 8).map(r => (
              <Line key={r.repo} type="monotone" dataKey={r.repo} name={r.label} stroke={PROV_COLOR[r.provider] || PROV_COLOR.Other} strokeWidth={1.5} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* ── Cloudflare Radar (token-gated) ── */}
    <SH>Cloudflare Workers-AI — Edge Model Mix</SH>
    {cf.available ? (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#10B981", fontFamily: fonts.mono, marginBottom: 4 }}>✓ Cloudflare Radar live{cfModels ? ` · as of ${String(cfModels.asOf).slice(0, 10)}` : ""}.</div>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.55, marginBottom: 14, maxWidth: 760 }}>
          Model <em>mix</em> (% of requests) running on Cloudflare&apos;s own Workers-AI edge — <strong style={{ color: "#cbd5e1" }}>not</strong> traffic to chat.openai.com / claude.ai, and <strong style={{ color: "#cbd5e1" }}>not</strong> a volume/level. It&apos;s a narrow lens: mostly embeddings &amp; utility models, so treat it as &ldquo;what CF-edge inference is used for,&rdquo; not a token-demand gauge.
        </div>
        {cfModels && (<>
          {cfModels.utilShare > 0 && (
            <div style={{ fontSize: 10.5, color: "#fbbf24", fontFamily: fonts.mono, marginBottom: 10 }}>
              ⚠ {cfModels.utilShare.toFixed(0)}% of this is embeddings / speech / translation — not LLM token generation.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {cfModels.rows.slice(0, 8).map(r => (
              <div key={r.model} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 200, fontSize: 10.5, fontFamily: fonts.mono, color: r.model === "other" ? "#64748b" : "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.short}{r.utility && <span style={{ color: "#64748b" }}> ·util</span>}
                </div>
                <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, r.share)}%`, height: "100%", background: r.utility ? "#64748b" : "#6366F1", borderRadius: 4 }} />
                </div>
                <div style={{ width: 52, textAlign: "right", fontSize: 10.5, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 600 }}>{r.share.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </>)}
        <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 12 }}>
          Source: Cloudflare Radar AI Inference API (28-day, hourly, percentage-normalized).
        </div>
      </div>
    ) : (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "#F59E0B", fontFamily: fonts.heading, fontWeight: 600, marginBottom: 8 }}>
          ⓘ Cloudflare Radar requires a free API token to enable.
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.6, marginBottom: 12 }}>
          Cloudflare Radar AI shows the model mix running on Cloudflare&apos;s Workers-AI edge (which hosted models get called, as a % share) — a narrow, embeddings-heavy lens, not end-user traffic to OpenAI/Anthropic and not a volume metric.
        </div>
        <div style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono, lineHeight: 1.7, padding: "10px 14px", background: "rgba(99,102,241,0.06)", borderLeft: "2px solid #6366F1", borderRadius: 4 }}>
          <strong style={{ color: "#a5b4fc" }}>Setup (one-time, &lt; 2 min):</strong>
          <ol style={{ margin: "8px 0 0 18px", padding: 0 }}>
            <li>Sign in (or create a free account) at <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener" style={{ color: "#a5b4fc" }}>dash.cloudflare.com/profile/api-tokens</a></li>
            <li>Click <strong>Create Token</strong> → <strong>Get started</strong> on "Create Custom Token"</li>
            <li>Permissions: <strong>Account · Cloudflare Radar · Read</strong> (the only permission needed)</li>
            <li>Create + copy the token, then in your project run: <code style={{ color: "#a5b4fc", background: "rgba(0,0,0,0.3)", padding: "2px 5px", borderRadius: 3 }}>setx CLOUDFLARE_API_TOKEN "your_token"</code> then restart the dev server</li>
          </ol>
          <div style={{ marginTop: 8, color: "#64748b" }}>Reason endpoint reported: <code style={{ color: "#94a3b8" }}>{cf.reason || "no_token"}</code></div>
        </div>
      </div>
    )}

    </>)}
  </>);
}

// ===========================================================
// SUB-TAB: AI INVESTMENT SCORECARD
// ===========================================================
// One-screen read: each key signal → current value, trend, 5Y percentile,
// investable plays, and a green/amber/red posture light. Pulls from the same
// endpoints the other subtabs use; all posture logic lives here.
const POSTURE = {
  bullish: { color: "#10B981", label: "Bullish", score:  1   },
  neutral: { color: "#F59E0B", label: "Neutral", score:  0   },
  caution: { color: "#F97316", label: "Caution", score: -0.5 },
  bearish: { color: "#EF4444", label: "Bearish", score: -1   },
};

const pctRank = (value, arr) => {
  const vals = (arr || []).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
  if (vals.length < 4 || value == null) return null;
  const below = vals.filter(v => v < value).length;
  return Math.round((below / vals.length) * 100);
};

// Build the YoY distribution from a raw level history (for percentile context)
const yoyDistribution = (history, lag) => {
  const v = (history || []).map(h => (typeof h === "object" ? h.v : h));
  const out = [];
  for (let i = lag; i < v.length; i++) {
    if (v[i - lag]) out.push(((v[i] - v[i - lag]) / v[i - lag]) * 100);
  }
  return out;
};

function buildScorecard({ impact, capex, prices, or }) {
  const rows = [];
  const fred = impact?.fred || {};

  // ── 0. Token Demand (OpenRouter routed volume, 13-week growth) ──
  // The most direct usage signal on the card — actual tokens, not a proxy.
  // Partial trailing week trimmed so the in-progress week can't flip posture.
  {
    const weekTot = orWeeklyTotals(or);
    if (weekTot.length > 13) {
      const last = weekTot[weekTot.length - 1];
      const w13 = weekTot[weekTot.length - 14];
      const g13 = w13.v ? ((last.v / w13.v) - 1) * 100 : null;
      const posture = g13 == null ? "neutral" : g13 > 30 ? "bullish" : g13 > 10 ? "neutral" : g13 > 0 ? "caution" : "bearish";
      rows.push({
        category: "Usage",
        label: "Token Demand (OpenRouter)",
        value: `${(last.v * (365 / 7 / 12) / 1e12).toFixed(0)}T tok/mo`,
        trendLabel: g13 != null ? `${g13 >= 0 ? "+" : ""}${g13.toFixed(0)}% /13wk` : "—",
        trendUp: (g13 ?? 0) >= 0,
        percentile: null,
        posture,
        tickers: ["NVDA", "MSFT", "GOOGL"],
        implication: "Actual routed API tokens — the demand every other row proxies. Sustained negative growth here is the sell signal for the whole trade.",
      });
    }
  }

  // ── 1. Hyperscaler AI Capex Momentum ──
  if (capex?.companies) {
    const caps = Object.values(capex.companies);
    let lastTotal = 0, yoyTotal = 0;
    caps.forEach(c => {
      const q = c.quarters || [];
      if (q.length) lastTotal += q[q.length - 1].capex || 0;
      if (q.length > 4) yoyTotal += q[q.length - 5].capex || 0;
    });
    const yoy = yoyTotal ? ((lastTotal - yoyTotal) / yoyTotal) * 100 : null;
    const posture = yoy == null ? "neutral" : yoy > 40 ? "bullish" : yoy > 15 ? "neutral" : yoy > 0 ? "caution" : "bearish";
    rows.push({
      category: "Infrastructure Spend",
      label: "Hyperscaler AI Capex",
      value: `$${(lastTotal / 1e9).toFixed(0)}B/qtr`,
      trendLabel: yoy != null ? `${yoy >= 0 ? "+" : ""}${yoy.toFixed(0)}% YoY` : "—",
      trendUp: (yoy ?? 0) >= 0,
      percentile: null,
      posture,
      tickers: ["NVDA", "AVGO", "TSM"],
      implication: "The dollars that become chips, racks, and tokens. Still accelerating → picks-and-shovels demand intact.",
    });

    // ── 2. Capex Intensity (capex / operating cash flow) ──
    let capexSum = 0, ocfSum = 0;
    caps.forEach(c => {
      const q = c.quarters || [];
      if (q.length) { capexSum += q[q.length - 1].capex || 0; ocfSum += q[q.length - 1].operatingCashFlow || 0; }
    });
    const intensity = ocfSum ? (capexSum / ocfSum) * 100 : null;
    const intPosture = intensity == null ? "neutral" : intensity < 40 ? "bullish" : intensity < 55 ? "neutral" : intensity < 70 ? "caution" : "bearish";
    rows.push({
      category: "Spend Discipline",
      label: "Capex Intensity",
      value: intensity != null ? `${intensity.toFixed(0)}% of OCF` : "—",
      trendLabel: "of operating cash flow",
      trendUp: null,
      percentile: null,
      posture: intPosture,
      tickers: ["MSFT", "GOOGL", "META", "AMZN"],
      implication: "Capex as a share of cash generation. Above ~55% historically pressures hyperscaler multiples — a risk gauge on the spenders themselves.",
    });
  }

  // ── FRED-driven rows ──
  const fredRow = (id, cfg) => {
    const s = fred[id];
    if (!s) return;
    const lag = s.freq === "Q" ? 4 : 12;
    const dist = yoyDistribution(s.history, lag);
    const pctile = pctRank(s.yoy, dist);
    const posture = cfg.posture(s.yoy, s.fiveYr, pctile);
    rows.push({
      category: cfg.category,
      label: cfg.label,
      value: cfg.fmtValue(s),
      trendLabel: s.yoy != null ? `${s.yoy >= 0 ? "+" : ""}${s.yoy.toFixed(1)}% YoY` : "—",
      trendUp: (s.yoy ?? 0) >= 0,
      percentile: pctile,
      posture,
      tickers: cfg.tickers,
      implication: cfg.implication,
    });
  };

  // ── 4. Labor Productivity ──
  fredRow("OPHNFB", {
    category: "Productivity Payoff",
    label: "Labor Productivity",
    fmtValue: s => `${s.current?.toFixed(1)} idx`,
    posture: (yoy) => yoy == null ? "neutral" : yoy > 2.5 ? "bullish" : yoy > 1.5 ? "neutral" : "caution",
    tickers: ["SPY"],
    implication: "The ultimate AI ROI test. Sustained growth above the ~2%/yr trend is AI delivering economy-wide — bullish broad equities, not just AI names.",
  });

  // ── 5. Semiconductor Production ──
  fredRow("IPG3344S", {
    category: "Compute Supply",
    label: "Semiconductor Production",
    fmtValue: s => `${s.current?.toFixed(0)} idx`,
    posture: (yoy) => yoy == null ? "neutral" : yoy > 5 ? "bullish" : yoy > 0 ? "neutral" : "caution",
    tickers: ["SMH", "SOXX", "NVDA"],
    implication: "Physical chip output ramping to meet AI demand. Rising = supply catching up; a roll-over would flag a demand air-pocket.",
  });

  // ── 6. Electric Power Generation ──
  fredRow("IPG2211A2N", {
    category: "Power Constraint",
    label: "Electric Power Generation",
    fmtValue: s => `${s.current?.toFixed(0)} idx`,
    posture: (yoy) => yoy == null ? "neutral" : yoy > 3 ? "bullish" : yoy > 1 ? "neutral" : "caution",
    tickers: ["VST", "CEG", "GEV", "NRG"],
    implication: "AI data centers are breaking a 15-year flat power-demand trend — the clearest physical tell of the buildout. Bullish IPPs and grid suppliers.",
  });

  // ── 7. Manufacturing Construction (CHIPS Act buildout) ──
  fredRow("TLMFGCONS", {
    category: "Reshoring Buildout",
    label: "Mfg Construction",
    fmtValue: s => `$${(s.current / 1000).toFixed(0)}B`,
    posture: (yoy, fiveYr) => yoy == null ? "neutral" : yoy > 10 ? "bullish" : yoy > -5 ? "neutral" : "caution",
    tickers: ["PWR", "VMC", "ETN"],
    implication: "Fab + data-center construction spend — up ~150% over 5 years. The visible-from-space AI footprint. Bullish electrical/construction.",
  });

  // ── 8. Inference Cost Deflation ──
  if (prices) {
    const idxFor = (models) => {
      let best = Infinity;
      (models || []).forEach(m => {
        const q = MODEL_QUALITY[m.id];
        if (!q || !m.output) return;
        const score = (q.mmlu + q.gpqa) / 2;
        const ci = m.output / (score / 100);
        if (ci < best) best = ci;
      });
      return best === Infinity ? null : best;
    };
    const hist = prices.history?.tokenHistory || [];
    const liveBest = idxFor(prices.live?.tokens?.models || []);
    const firstBest = hist.length ? idxFor(hist[0].models || []) : null;
    let trend = null;
    if (firstBest && liveBest && firstBest > 0) trend = ((liveBest - firstBest) / firstBest) * 100;
    // Falling cost is bullish for adoption (the broad trade)
    const posture = trend == null ? "bullish" : trend < -5 ? "bullish" : trend < 5 ? "neutral" : "caution";
    rows.push({
      category: "Margins / Adoption",
      label: "Inference Cost Deflation",
      value: liveBest != null ? `$${liveBest.toFixed(2)}/Mq` : "—",
      trendLabel: trend != null ? `${trend >= 0 ? "+" : ""}${trend.toFixed(0)}% since data start` : "cheapest quality-adj",
      trendUp: trend != null ? trend < 0 : true,   // down is "good"
      percentile: null,
      posture,
      tickers: ["Adoption +", "Model-layer −"],
      implication: "Cost per quality-point. Falling = adoption tailwind for the whole stack, but compresses pure-play model-provider margins — favors infra over model layer.",
    });
  }

  // Overall posture
  const score = rows.reduce((s, r) => s + (POSTURE[r.posture]?.score || 0), 0);
  const counts = { bullish: 0, neutral: 0, caution: 0, bearish: 0 };
  rows.forEach(r => { counts[r.posture] = (counts[r.posture] || 0) + 1; });
  const overall = score >= 3 ? { label: "Constructive", color: "#10B981", note: "The AI infrastructure trade has fuel." }
    : score >= 1 ? { label: "Mildly Constructive", color: "#84CC16", note: "Net positive, with pockets of risk." }
    : score >= -1 ? { label: "Mixed", color: "#F59E0B", note: "Signals are conflicting — be selective." }
    : { label: "Cautious", color: "#EF4444", note: "Deterioration across multiple signals." };

  return { rows, counts, overall, score };
}

// Tiny percentile bar
function PctBar({ value }) {
  if (value == null) return <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono }}>—</span>;
  const color = value >= 80 ? "#EF4444" : value >= 60 ? "#F59E0B" : value >= 40 ? "#94a3b8" : "#10B981";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, position: "relative", minWidth: 38 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${value}%`, background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 9, color, fontFamily: fonts.mono, minWidth: 26, textAlign: "right" }}>{value}%</span>
    </div>
  );
}

function ScorecardTab() {
  const [impact, setImpact]   = useState(null);
  const [capex, setCapex]     = useState(null);
  const [prices, setPrices]   = useState(null);
  const [or, setOr]           = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/ai-impact").then(r => r.json()).catch(() => null),
      fetch("/api/hyperscaler-capex").then(r => r.json()).catch(() => null),
      fetch("/api/ai-prices").then(r => r.json()).catch(() => null),
      fetch("/api/or-rankings-history").then(r => r.json()).catch(() => null),
    ]).then(([i, c, p, o]) => { setImpact(i); setCapex(c); setPrices(p); setOr(o); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const { rows, counts, overall } = useMemo(
    () => buildScorecard({ impact, capex, prices, or }),
    [impact, capex, prices, or]
  );

  if (loading && !rows.length) {
    return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Building AI investment scorecard…</div>;
  }
  if (!rows.length) {
    return <InfoBox color="#F97316">Scorecard data unavailable — make sure the dev server is running so the underlying endpoints can be reached.</InfoBox>;
  }

  return (<>
    <StaleBanner or={or} />
    {/* Overall posture banner */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 18, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: overall.color }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>AI Trade Posture</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: overall.color, fontFamily: fonts.heading, letterSpacing: -0.5, lineHeight: 1 }}>{overall.label}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 5 }}>{overall.note}</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {[["bullish", "Bullish"], ["neutral", "Neutral"], ["caution", "Caution"], ["bearish", "Bearish"]].map(([k, lbl]) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: POSTURE[k].color, fontFamily: fonts.heading, lineHeight: 1 }}>{counts[k] || 0}</div>
              <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginTop: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>{lbl}</div>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Each signal → current level, trend, 5-yr percentile, investable plays, and a posture read. Click any subtab above for the full evidence.</div>
      <button onClick={load} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono }}>↻ Refresh</button>
    </div>

    {/* Scorecard table */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
        <thead>
          <tr>
            {["", "Signal", "Current", "Trend", "5Y %ile", "Plays", "What It Means"].map((h, i) => (
              <th key={i} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: i >= 2 && i <= 4 ? "right" : "left", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const p = POSTURE[r.posture];
            return (
              <tr key={i} style={{ borderBottom: i < rows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                {/* Posture light */}
                <td style={{ padding: "12px 12px", borderLeft: `3px solid ${p.color}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: p.color, display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontSize: 9, color: p.color, fontFamily: fonts.mono, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>{p.label}</span>
                  </div>
                </td>
                {/* Signal name + category */}
                <td style={{ padding: "12px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontFamily: fonts.heading }}>{r.label}</div>
                  <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.3, textTransform: "uppercase", marginTop: 2 }}>{r.category}</div>
                </td>
                {/* Current value */}
                <td style={{ padding: "12px 12px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.mono, whiteSpace: "nowrap" }}>{r.value}</td>
                {/* Trend */}
                <td style={{ padding: "12px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 11, fontFamily: fonts.mono, fontWeight: 600, color: r.trendUp == null ? "#94a3b8" : r.trendUp ? "#4ade80" : "#f87171" }}>
                    {r.trendUp != null && (r.trendUp ? "▲ " : "▼ ")}{r.trendLabel}
                  </span>
                </td>
                {/* Percentile */}
                <td style={{ padding: "12px 12px", minWidth: 90 }}><PctBar value={r.percentile} /></td>
                {/* Tickers */}
                <td style={{ padding: "12px 12px" }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {r.tickers.map(t => (
                      <span key={t} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#a5b4fc", background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>{t}</span>
                    ))}
                  </div>
                </td>
                {/* Implication */}
                <td style={{ padding: "12px 12px", fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.5, maxWidth: 320 }}>{r.implication}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>How to use this.</strong> The posture lights translate raw data into a directional read: <span style={{ color: "#10B981" }}>green</span> signals support the AI/infra trade, <span style={{ color: "#F97316" }}>amber/orange</span> flag risk, <span style={{ color: "#EF4444" }}>red</span> warn of deterioration. <strong>Plays</strong> are the most direct instruments for each signal — not recommendations, just where the signal expresses itself. The 5-yr percentile tells you whether today&apos;s reading is historically high or low. Drill into any subtab for the underlying evidence.
    </InfoBox>

    <InfoBox color="#F59E0B">
      <strong style={{ color: "#cbd5e1" }}>Caveats.</strong> Capex intensity and margin estimates are interpretive (the AI-share split and tokenomics assumptions are editorial). FRED series lag 1–3 months. This is a decision-support summary, not investment advice — verify against primary sources before acting.
    </InfoBox>
  </>);
}

// ===========================================================
// SUB-TAB: API USAGE (OpenRouter token throughput)
// ===========================================================
// Overall market growth (weekly token volume by provider, 52 weeks) + which
// individual models are winning by actual API token usage.
const OR_PROVIDER_COLORS = {
  google: "#4285F4", anthropic: "#E8553A", deepseek: "#F59E0B", openai: "#10B981",
  "meta-llama": "#8B5CF6", mistralai: "#EC4899", qwen: "#D946EF", "x-ai": "#14B8A6",
  nousresearch: "#818cf8", "z-ai": "#fb923c", moonshotai: "#22d3ee", others: "#64748b",
};
const orProvColor = p => OR_PROVIDER_COLORS[p] || "#94a3b8";

function ApiUsagePanels() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [shareMode, setShareMode] = useState("absolute"); // "absolute" | "share"

  const load = () => {
    setLoading(true);
    fetch("/api/or-rankings-history")
      .then(r => r.json())
      .then(d => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const fmtTok = n => n == null ? "—" : n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(0)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : String(n);

  // Provider weekly chart from market-share.
  // Keep only the weeks orWeeklyTotals() considers complete — the in-progress
  // week is only partially accumulated and craters the WoW stat and chart tail.
  const { chartRows, providers, growth } = useMemo(() => {
    const complete = new Set(orWeeklyTotals(data).map(w => w.d));
    const ms = (data?.marketShare || []).filter(w => complete.has(w.x));
    if (!ms.length) return { chartRows: [], providers: [], growth: null };
    const provSet = new Set();
    ms.forEach(w => Object.keys(w.ys || {}).forEach(p => provSet.add(p)));
    // order providers by latest-week volume (largest first → bottom of stack)
    const latest = ms[ms.length - 1].ys || {};
    const providers = [...provSet].sort((a, b) => (latest[b] || 0) - (latest[a] || 0));
    const chartRows = ms.map(w => {
      const row = { date: w.x };
      let total = 0;
      providers.forEach(p => { row[p] = w.ys?.[p] || 0; total += w.ys?.[p] || 0; });
      row._total = total;
      return row;
    });
    const firstTot = chartRows[0]._total, lastTot = chartRows[chartRows.length - 1]._total;
    const growth = firstTot ? ((lastTot - firstTot) / firstTot) * 100 : null;
    return { chartRows, providers, growth };
  }, [data]);

  // ── Market structure: concentration + open-weights share, weekly ──
  // The KPI battery for the "do leading models keep the market?" thesis.
  const structure = useMemo(() => {
    const complete = new Set(orWeeklyTotals(data).map(w => w.d));
    const ms = (data?.marketShare || []).filter(w => complete.has(w.x));
    if (ms.length < 8) return null;
    const rows = ms.map(w => {
      const entries = Object.entries(w.ys || {});
      const tot = entries.reduce((s, [, v]) => s + v, 0);
      if (!tot) return null;
      const shares = entries.map(([k, v]) => ({ k, s: v / tot }));
      const hhi = Math.round(shares.reduce((s, x) => s + x.s * x.s * 10000, 0));
      const top3 = +(shares.map(x => x.s).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) * 100).toFixed(1);
      let open = 0, closed = 0;
      for (const { k, s } of shares) {
        if (OPEN_LABS.has(k)) open += s;
        else if (CLOSED_LABS.has(k)) closed += s;
      }
      const openShare = (open + closed) > 0 ? +((open / (open + closed)) * 100).toFixed(1) : null;
      const frontierShare = +((((w.ys.anthropic || 0) + (w.ys.openai || 0) + (w.ys.google || 0)) / tot) * 100).toFixed(1);
      return { d: w.x, hhi, hhiScaled: +(hhi / 100).toFixed(1), top3, openShare, frontierShare };
    }).filter(Boolean);
    const last = rows[rows.length - 1];
    const yrAgo = rows.length > 52 ? rows[rows.length - 53] : rows[0];
    return { rows, last, yrAgo };
  }, [data]);

  // Top individual models (latest snapshot date)
  const topModels = useMemo(() => {
    const rows = data?.rows || [];
    if (!rows.length) return { latest: null, models: [], totalWeek: 0 };
    const dates = [...new Set(rows.map(r => r.date))].sort();
    const latest = dates[dates.length - 1];
    const prior = dates.length > 1 ? dates[dates.length - 2] : null;
    const priorMap = new Map();
    if (prior) rows.filter(r => r.date === prior).forEach(r => priorMap.set(r.model_permaslug, (r.total_prompt_tokens || 0) + (r.total_completion_tokens || 0)));
    const models = rows.filter(r => r.date === latest).map(r => {
      const tot = (r.total_prompt_tokens || 0) + (r.total_completion_tokens || 0);
      const parts = (r.model_permaslug || "").split("/");
      const provider = parts[0] || "—";
      const name = parts.slice(1).join("/").replace(/-\d{8}$/, "");
      const priorTot = priorMap.get(r.model_permaslug);
      const wow = priorTot ? ((tot - priorTot) / priorTot) * 100 : null;
      return { slug: r.model_permaslug, name, provider, tokens: tot, requests: r.count || 0, wow };
    }).sort((a, b) => b.tokens - a.tokens);
    const totalWeek = models.reduce((s, m) => s + m.tokens, 0);
    return { latest, models, totalWeek };
  }, [data]);

  if (loading && !data) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading OpenRouter API usage…</div>;
  if (error || !data) return <InfoBox color="#F97316">Unable to load OpenRouter usage data. The endpoint may be rate-limited — try Refresh.</InfoBox>;

  const latestWeek = chartRows.length ? chartRows[chartRows.length - 1] : null;
  const prevWeek = chartRows.length > 1 ? chartRows[chartRows.length - 2] : null;
  const wowTotal = latestWeek && prevWeek && prevWeek._total ? ((latestWeek._total - prevWeek._total) / prevWeek._total) * 100 : null;
  const topProv = providers[0];

  return (<>
    <StaleBanner or={data} />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5 }}>API Usage — OpenRouter Token Throughput</div>
        <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>Real API token volume across providers — the cleanest read on aggregate market growth and which models are actually winning.</div>
      </div>
      <button onClick={load} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono }}>↻ Refresh</button>
    </div>

    {/* Hero growth stats */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10, marginBottom: 18 }}>
      <StatCard label="Tokens / Week (latest)" val={latestWeek ? `${fmtTok(latestWeek._total)}` : "—"} sub={latestWeek ? `Week of ${latestWeek.date}` : ""} color="#6366F1" />
      <StatCard label="52-Week Growth" val={growth != null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(0)}%` : "—"} sub="Total market throughput" color="#10B981" />
      <StatCard label="Week-over-Week" val={wowTotal != null ? `${wowTotal >= 0 ? "+" : ""}${wowTotal.toFixed(1)}%` : "—"} sub="Latest vs prior week" color={wowTotal >= 0 ? "#10B981" : "#F97316"} />
      <StatCard label="#1 Provider" val={topProv ? topProv.replace("-", " ") : "—"} sub={topProv && latestWeek ? `${((latestWeek[topProv] / latestWeek._total) * 100).toFixed(0)}% of volume` : ""} color="#E8553A" />
    </div>

    {/* Market growth chart */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <SH>Weekly Token Volume by Provider — 52 Weeks</SH>
      <div style={{ display: "flex", gap: 4 }}>
        {[["absolute", "Volume"], ["share", "Share %"]].map(([k, l]) => (
          <button key={k} onClick={() => setShareMode(k)} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: `1px solid ${shareMode === k ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)"}`, background: shareMode === k ? "rgba(99,102,241,0.18)" : "#0f172a", color: shareMode === k ? "#a5b4fc" : "#94a3b8", cursor: "pointer", fontFamily: fonts.mono }}>{l}</button>
        ))}
      </div>
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={340}>
        <AreaChart data={chartRows} margin={{ top: 5, right: 8, left: -4, bottom: 0 }} stackOffset={shareMode === "share" ? "expand" : "none"}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor(chartRows.length / 9) - 1)} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => shareMode === "share" ? `${(v * 100).toFixed(0)}%` : fmtTok(v)} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 10 }} formatter={(v, n) => [fmtTok(v), n.replace("-", " ")]} labelFormatter={l => `Week of ${l}`} />
          <Legend wrapperStyle={{ fontSize: 9, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={6} formatter={n => n.replace("-", " ")} />
          {providers.map(p => (
            <Area key={p} type="monotone" dataKey={p} name={p} stackId="1" stroke={orProvColor(p)} fill={orProvColor(p)} fillOpacity={0.75} strokeWidth={0.5} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
        {shareMode === "share" ? "Normalized to 100% — provider share of total throughput over time." : "Absolute weekly token volume — the height of the stack is total market growth."}
      </div>
    </div>

    {/* ── Market structure: the "do leaders keep the market?" KPIs ── */}
    {structure && (<>
      <SH>Market Structure — Concentration &amp; Open-Weights Share</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10, marginBottom: 12 }}>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#22d3ee" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Open-Weights Token Share</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{structure.last.openShare}%</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>{(structure.last.openShare - structure.yrAgo.openShare) >= 0 ? "+" : ""}{(structure.last.openShare - structure.yrAgo.openShare).toFixed(1)}pp over 12mo</div>
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#E8553A" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Frontier Share (A+O+G)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{structure.last.frontierShare}%</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>{(structure.last.frontierShare - structure.yrAgo.frontierShare) >= 0 ? "+" : ""}{(structure.last.frontierShare - structure.yrAgo.frontierShare).toFixed(1)}pp over 12mo</div>
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#8B5CF6" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Top-3 Lab Share</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{structure.last.top3}%</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>whoever they are that week</div>
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#F59E0B" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>HHI (Concentration)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{structure.last.hhi.toLocaleString()}</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>&lt;1500 = unconcentrated (DOJ scale)</div>
        </div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={structure.rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={46} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={d => d.slice(0, 10)} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
            <Line type="monotone" dataKey="openShare" name="Open-weights share %" stroke="#22d3ee" strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="frontierShare" name="Frontier (Anthropic+OpenAI+Google) %" stroke="#E8553A" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="hhiScaled" name="HHI ÷ 100" stroke="#F59E0B" strokeWidth={1.4} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
          The commoditization scoreboard. <strong style={{ color: "#94a3b8" }}>Big caveat:</strong> OpenRouter over-samples open-weights — closed-model enterprise traffic mostly goes direct to Anthropic/OpenAI/Azure and never touches this data. Read the <em>trend</em> (is open share gaining?), not the level. Cross-check against the realized price premium on Supply &amp; Demand: share moving to open weights while the frontier premium HOLDS means segmentation, not commoditization; share moving while the premium COLLAPSES is the real bear case for closed labs.
        </div>
      </div>
    </>)}


    {/* Top individual models */}
    <SH>Top Models by API Token Usage{topModels.latest ? ` — ${topModels.latest}` : ""}</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead>
          <tr>
            {["#", "Model", "Provider", "Tokens/wk", "Share", "Requests", "WoW"].map((h, i) => (
              <th key={i} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: i <= 2 ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topModels.models.slice(0, 25).map((m, i) => (
            <tr key={m.slug} style={{ borderBottom: i < 24 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "9px 12px", fontSize: 12, fontFamily: fonts.mono, color: i < 3 ? "#f59e0b" : "#475569", fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</td>
              <td style={{ padding: "9px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>{m.name}</td>
              <td style={{ padding: "9px 12px" }}><span style={{ fontSize: 10, fontFamily: fonts.mono, color: orProvColor(m.provider), background: `${orProvColor(m.provider)}1a`, padding: "2px 7px", borderRadius: 5 }}>{m.provider}</span></td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, fontFamily: fonts.mono, color: "#f1f5f9", fontWeight: 600 }}>{fmtTok(m.tokens)}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, fontFamily: fonts.mono, color: "#94a3b8" }}>{topModels.totalWeek ? `${((m.tokens / topModels.totalWeek) * 100).toFixed(1)}%` : "—"}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, fontFamily: fonts.mono, color: "#64748b" }}>{fmtTok(m.requests)}</td>
              <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, fontFamily: fonts.mono, fontWeight: 600, color: m.wow == null ? "#475569" : m.wow >= 0 ? "#4ade80" : "#f87171" }}>{m.wow != null ? `${m.wow >= 0 ? "+" : ""}${m.wow.toFixed(0)}%` : "new"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <InfoBox color="#6366F1">
      <strong style={{ color: "#cbd5e1" }}>Why this is the strongest demand signal here.</strong> Unlike SDK installs (developer intent) or HF downloads (open-weight popularity), this is <em>actual paid API token throughput</em> routed through OpenRouter. The 52-week stack height is the cleanest public proxy for overall AI market growth, and the model table shows exactly which models are capturing that demand right now. WoW flags momentum — a model jumping up the list is gaining real production share.
    </InfoBox>
  </>);
}

// ===========================================================
// SUB-TAB: SUPPLY & DEMAND — the compute balance dashboard
// ===========================================================
// Central question: where is compute supply vs token demand, and how fast is
// each growing? Supply in FLOPs isn't publicly observable, so we read the
// CLEARING PRICES (GPU $/hr, $/M tokens) against demand quantity (OpenRouter
// tokens/week). Demand up + prices flat/down → supply winning the race.
// Demand up + prices up → shortage forming.

const SD_GREEN = "#4ade80", SD_AMBER = "#fbbf24", SD_RED = "#f87171", SD_INDIGO = "#818cf8";
const sdPct = (v, dp = 0) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
const sdTok = n => n == null ? "—" : n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(0)}B` : `${(n / 1e6).toFixed(0)}M`;

// ── Ornn OTPI per-lab token pricing (all companies, toggleable) ─────────────
const OTPI_LAB_META = [
  { id: "anthropic",  label: "Anthropic",  color: "#E8553A", def: true },
  { id: "openai",     label: "OpenAI",     color: "#10B981", def: true },
  { id: "google",     label: "Google",     color: "#3B82F6", def: true },
  { id: "deepseek",   label: "DeepSeek",   color: "#8B5CF6", def: true },
  { id: "z-ai",       label: "Z AI (GLM)", color: "#F59E0B", def: true },
  { id: "qwen",       label: "Qwen",       color: "#22D3EE", def: true },
  { id: "moonshotai", label: "Moonshot",   color: "#EC4899", def: false },
  { id: "minimax",    label: "MiniMax",    color: "#A78BFA", def: false },
  { id: "mistralai",  label: "Mistral",    color: "#FB923C", def: false },
  { id: "meta-llama", label: "Meta Llama", color: "#94A3B8", def: false },
  { id: "xiaomi",     label: "Xiaomi",     color: "#4ADE80", def: false },
];

function OrnnTokenPricePanel({ ornn }) {
  const [on, setOn] = useState(() => new Set(OTPI_LAB_META.filter(l => l.def).map(l => l.id)));
  if (!ornn?.otpiRows?.length) return null;
  const latest = ornn.otpiLatest || {};

  // ── Pricing KPIs: frontier quality premium + blended deflation rate ──
  // premium = avg(frontier realized $/Mtok) ÷ cheapest open-weights lab that
  // day. Holding premium + rising open share = segmentation; collapsing
  // premium = the commoditization bear case actually biting.
  const FRONTIER = ["anthropic", "openai"], OPEN_FLOOR = ["deepseek", "qwen", "z-ai", "meta-llama"];
  const premiumSeries = ornn.otpiRows.map(r => {
    const f = FRONTIER.map(l => r[l]).filter(v => v != null);
    const o = OPEN_FLOOR.map(l => r[l]).filter(v => v != null);
    if (f.length < 2 || !o.length) return null;
    return { d: r.d, v: +((f.reduce((a, b) => a + b, 0) / f.length) / Math.min(...o)).toFixed(1) };
  }).filter(Boolean);
  const premNow = premiumSeries.length ? premiumSeries[premiumSeries.length - 1].v : null;
  const premYr = premiumSeries.length > 250 ? premiumSeries[premiumSeries.length - 251].v : (premiumSeries[0]?.v ?? null);
  // blended big-4 realized price, YoY = the deflation term in every AI revenue model
  const blend = ornn.otpiRows.map(r => {
    const vals = ["anthropic", "openai", "google", "deepseek"].map(l => r[l]).filter(v => v != null);
    return vals.length >= 3 ? { d: r.d, v: vals.reduce((a, b) => a + b, 0) / vals.length } : null;
  }).filter(Boolean);
  const blendNow = blend.length ? blend[blend.length - 1].v : null;
  const blendYr = blend.length > 250 ? blend[blend.length - 251].v : (blend[0]?.v ?? null);
  const deflation = (blendNow != null && blendYr) ? +(((blendNow / blendYr) - 1) * 100).toFixed(1) : null;
  const toggle = (id) => setOn(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const fmtP = v => v == null ? "—" : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`;
  return (<>
    <SH>Token Prices by Company — Ornn OTPI (volume-weighted $/M tokens)</SH>
    {/* Pricing KPIs: the two numbers that decide the leading-models thesis */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 10, marginBottom: 12 }}>
      {premNow != null && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#E8553A" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Frontier Quality Premium</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 3 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{premNow}×</span>
            <span style={{ fontSize: 10, color: premYr != null && premNow >= premYr ? "#4ade80" : "#f87171", fontFamily: fonts.mono }}>{premYr != null ? `${premNow >= premYr ? "+" : ""}${(premNow - premYr).toFixed(1)}× vs 1yr ago` : ""}</span>
          </div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 3, lineHeight: 1.45 }}>avg(Anthropic, OpenAI) ÷ cheapest open-weights lab, realized prices. Holding = moat; collapsing = commoditization.</div>
        </div>
      )}
      {deflation != null && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#8B5CF6" }} />
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Blended Realized Price, YoY</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: deflation <= 0 ? "#22d3ee" : "#fbbf24", fontFamily: fonts.heading, marginTop: 3 }}>{deflation >= 0 ? "+" : ""}{deflation}%</div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 3, lineHeight: 1.45 }}>big-4 average $/Mtok — the deflation term in every AI revenue forecast. Token volumes must outgrow this for revenue to rise.</div>
        </div>
      )}
    </div>
    {/* Company chips: click to toggle a line; each shows current realized price + 30d move */}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {OTPI_LAB_META.filter(l => latest[l.id]).map(l => {
        const v = latest[l.id];
        const active = on.has(l.id);
        return (
          <button key={l.id} onClick={() => toggle(l.id)} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 10, cursor: "pointer",
            border: `1px solid ${active ? l.color : "rgba(255,255,255,0.08)"}`,
            background: active ? `${l.color}22` : "rgba(255,255,255,0.03)",
            opacity: active ? 1 : 0.55, transition: "all 0.15s",
          }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontFamily: fonts.heading, fontWeight: 600, color: "var(--text-primary)" }}>{l.label}</span>
            <span style={{ fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, color: l.color }}>{fmtP(v.current)}</span>
            {v.chg30 != null && (
              <span style={{ fontSize: 9.5, fontFamily: fonts.mono, color: v.chg30 >= 0 ? "#4ade80" : "#f87171" }}>{v.chg30 >= 0 ? "+" : ""}{v.chg30}%/30d</span>
            )}
          </button>
        );
      })}
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={ornn.otpiRows} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={46} />
          <YAxis scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [`$${(+v).toFixed(3)}/Mtok`, OTPI_LAB_META.find(l => l.id === n)?.label || n]} labelFormatter={d => d.slice(0, 10)} />
          {OTPI_LAB_META.filter(l => on.has(l.id)).map(l => (
            <Line key={l.id} type="monotone" dataKey={l.id} name={l.id} stroke={l.color} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Daily settled, volume-weighted price actually paid per million tokens across each company&apos;s models (log scale) — realized price, not list price. Click a company chip to add/remove its line. The Anthropic/OpenAI vs DeepSeek/Qwen spread is the market&apos;s live quality premium; watch whether it compresses (commoditization) or holds (durable moat). Source: <a href="https://dashboard.ornnai.com/tokens" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>Ornn OTPI</a>.
      </div>
    </div>
  </>);
}

// ── AI debt-market tracker (curated, extend by hand) ───────────────────────
// SemiAnalysis ("NVIDIA GPU debt backstop" article) forecasts AI debt becoming
// the 2nd-largest credit market after US mortgages (~$13T): ~$7T outstanding
// by 2029 against ~$11.1T cumulative AI capex 2024-29. No API tracks this —
// deals are public headlines, curated here like TOKEN_DISCLOSURES.
// amt in $B. date = announcement month (some approximate — verify on edit).
// contingent: true = a guarantee (NVIDIA revenue backstop), NOT drawn debt —
// listed in the table but excluded from the cumulative line.
// ADD A ROW whenever a headline AI financing lands. That's the whole upkeep.
const AI_DEBT_DEALS = [
  { date: "2023-08", borrower: "CoreWeave",            amt: 2.3,  lender: "Magnetar + Blackstone",         type: "GPU-collateralized loan" },
  { date: "2024-05", borrower: "CoreWeave",            amt: 7.5,  lender: "Blackstone-led",                type: "DDTL 2.0" },
  { date: "2024-10", borrower: "Crusoe (Abilene DC)",  amt: 3.4,  lender: "Blue Owl-led",                  type: "DC construction financing" },
  { date: "2025-05", borrower: "CoreWeave",            amt: 2.0,  lender: "public market",                 type: "High-yield notes" },
  { date: "2025-06", borrower: "xAI",                  amt: 5.0,  lender: "Morgan Stanley-led",            type: "Notes + term loan" },
  { date: "2025-09", borrower: "Oracle",               amt: 18,   lender: "public market",                 type: "IG bonds (DC buildout)" },
  { date: "2025-09", borrower: "Nebius",               amt: 3.0,  lender: "public market",                 type: "Convertible notes" },
  { date: "2025-10", borrower: "Meta (Hyperion DC)",   amt: 27,   lender: "Blue Owl JV",                   type: "Private credit" },
  { date: "2025-10", borrower: "TeraWulf",             amt: 3.2,  lender: "public (Google-backstopped)",   type: "Notes" },
  { date: "2025-10", borrower: "Meta",                 amt: 30,   lender: "public market",                 type: "IG bonds" },
  { date: "2026-06", borrower: "CoreWeave",            amt: 8.5,  lender: "incl. Meta-backstopped 5.9% tranche", type: "DDTL 4.0", src: "SemiAnalysis" },
  { date: "2026-06", borrower: "Firmus (Melbourne)",   amt: 10,   lender: "Blackstone-led",                type: "Facility", src: "SemiAnalysis" },
  { date: "2026-06", borrower: "SharonAI (40k GB300)", amt: 4.88, lender: "NVIDIA",                        type: "GPU revenue backstop", contingent: true, src: "SemiAnalysis" },
];
// Illustrative glide path to the article's endpoint — ONLY the $7T-by-2029
// point is theirs; intermediate points are a smooth interpolation for scale.
const AI_DEBT_FORECAST = [
  { date: "2024-06", v: 40 }, { date: "2025-06", v: 150 }, { date: "2026-06", v: 450 },
  { date: "2027-06", v: 1200 }, { date: "2028-06", v: 3000 }, { date: "2029-12", v: 7000 },
];

// ── Supply ceiling: advanced packaging (CoWoS) + HBM sold-out timeline ──────
// Accelerator supply is packaging/memory-limited, not wafer-limited. Whether
// supply CAN respond decides if the compute thesis pays via volumes or prices.
function SupplyCeilingPanel() {
  const c = SUPPLY_CEILING;
  return (<>
    <SH>Supply Ceiling — CoWoS Packaging &amp; HBM</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", paddingLeft: 14, marginBottom: 6 }}>
          TSMC CoWoS Capacity (k wafers/month)
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={c.cowos} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${v}k wpm${p.payload.est ? " (est.)" : ""}`, "CoWoS capacity"]} />
            <Bar dataKey="kwpm" radius={[4, 4, 0, 0]}>
              {c.cowos.map((r, i) => <Cell key={i} fill={r.est ? "rgba(129,140,248,0.45)" : "#818cf8"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "4px 0 6px 14px", lineHeight: 1.5 }}>
          ~{Math.round(c.cowos[c.cowos.length - 1].kwpm / c.cowos[0].kwpm)}× in three years, and still the binding constraint. TrendForce-reported estimates (faded bar = forward estimate) — update from TSMC earnings commentary.
        </div>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
          HBM Sold-Out Timeline
        </div>
        {c.hbm.map(h => (
          <div key={h.d} style={{ display: "flex", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, flexShrink: 0, fontWeight: 700 }}>{h.d}</span>
            <span style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.heading, lineHeight: 1.45 }}>{h.note}{h.approx ? " (≈)" : ""}</span>
          </div>
        ))}
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 10, lineHeight: 1.5 }}>
          Memory makers pre-selling capacity 12-24 months out is the market saying demand exceeds supply as far as contracts can reach. The signal to fear: this list <em>stops</em> growing — HBM going un-sold-out would be the first hard evidence the compute-demand thesis is breaking.
        </div>
      </div>
    </div>
  </>);
}

function AIDebtPanel() {
  const calc = useMemo(() => {
    const deals = [...AI_DEBT_DEALS].sort((a, b) => a.date.localeCompare(b.date));
    const drawn = deals.filter(d => !d.contingent);
    let cum = 0;
    const cumPts = drawn.map(d => { cum += d.amt; return { date: d.date, announced: +cum.toFixed(1) }; });
    const total = cum;
    const backstops = deals.filter(d => d.contingent).reduce((s, d) => s + d.amt, 0);
    // trailing-12-month announcement pace
    const lastD = deals[deals.length - 1].date;
    const cutY = `${+lastD.slice(0, 4) - 1}${lastD.slice(4)}`;
    const pace12 = drawn.filter(d => d.date > cutY).reduce((s, d) => s + d.amt, 0);
    // merge cumulative + forecast onto one date axis
    const byDate = {};
    cumPts.forEach(p => { byDate[p.date] = { ...(byDate[p.date] || { date: p.date }), announced: p.announced }; });
    AI_DEBT_FORECAST.forEach(p => { byDate[p.date] = { ...(byDate[p.date] || { date: p.date }), forecast: p.v }; });
    const chart = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    return { deals: deals.slice().reverse(), total, backstops, pace12, chart, pctOfForecast: (total / 7000) * 100 };
  }, []);

  const fmtB = v => v == null ? "—" : v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `$${v.toFixed(v < 10 ? 1 : 0)}B`;

  return (<>
    <SH>AI Debt Market — Announced Facilities vs the $7T Path</SH>
    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, lineHeight: 1.5, maxWidth: 820 }}>
      SemiAnalysis forecasts AI debt becoming the <strong style={{ color: "#cbd5e1" }}>second-largest credit market after US mortgages</strong> — ~$7T outstanding by 2029. This tracker tallies <em>publicly announced, named facilities</em> (a floor on the real number, since much debt is never itemized). Curated by hand — add each headline deal to <code style={{ color: "#a5b4fc" }}>AI_DEBT_DEALS</code>.
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 10, marginBottom: 12 }}>
      <StatCard label="Announced to Date" val={fmtB(calc.total)} sub={`${calc.deals.length} tracked deals`} color={SD_INDIGO} />
      <StatCard label="Trailing-12mo Pace" val={fmtB(calc.pace12)} sub="new facilities announced" color={SD_GREEN} />
      <StatCard label="vs $7T Forecast" val={`${calc.pctOfForecast.toFixed(1)}%`} sub="of the 2029 endpoint" color={SD_AMBER} />
      <StatCard label="NVIDIA Backstops" val={fmtB(calc.backstops)} sub="contingent — not drawn debt" color="#94a3b8" />
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={calc.chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} minTickGap={40} />
          <YAxis scale="log" domain={[10, 8000]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={fmtB} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n) => [fmtB(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <Line type="stepAfter" dataKey="announced" name="Announced facilities (cumulative)" stroke={SD_INDIGO} strokeWidth={2.4} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="forecast" name="SemiAnalysis path to $7T (interpolated)" stroke="#64748b" strokeWidth={1.6} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Log scale, $B. Only the $7T-2029 endpoint is SemiAnalysis&apos;s — the dashed path between is smooth interpolation for scale. The gap between the lines is the story: if the buildout thesis is right, announced facilities must accelerate dramatically; if the step-line stalls for quarters, the debt engine is seizing.
      </div>
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead><tr>
          {["Announced", "Borrower", "Structure", "Lender / Notes", "Amount"].map((h, i) => (
            <th key={h} style={{ padding: "9px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", textAlign: i === 4 ? "right" : "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {calc.deals.map((d, i) => (
            <tr key={`${d.date}-${d.borrower}`} style={{ borderBottom: i < calc.deals.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", opacity: d.contingent ? 0.65 : 1 }}>
              <td style={{ padding: "8px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#64748b" }}>{d.date}</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 600 }}>{d.borrower}</td>
              <td style={{ padding: "8px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#94a3b8" }}>{d.type}{d.contingent ? " ⓘ contingent" : ""}</td>
              <td style={{ padding: "8px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#64748b" }}>{d.lender}{d.src ? ` · ${d.src}` : ""}</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, color: "#f1f5f9", textAlign: "right", fontWeight: 700 }}>{fmtB(d.amt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <InfoBox color={SD_INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>Why this matters for the whole AI trade.</strong> The capex forecast (~$11T through 2029) only happens if debt markets fund it — hyperscaler cash flows alone can&apos;t. So this scoreboard is the <em>fuel gauge</em> for everything else on this tab: announced facilities accelerating = the backstop-unlocked credit machine is working; a multi-quarter stall = the single most important early warning that the buildout (and NVDA&apos;s order book) is at risk. Dates and amounts are curated seed values from public headlines and the SemiAnalysis article — verify before trading on any single row.
    </InfoBox>
  </>);
}

// Small collapsible wrapper for demoted-but-kept panels.
function Collapse({ title, sub, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", textAlign: "left", cursor: "pointer", background: cardBg,
        border: cardBorder, borderRadius: 14, padding: "12px 16px",
        fontSize: 12, fontFamily: fonts.heading, fontWeight: 700, color: "#cbd5e1",
      }}>
        <span style={{ color: "#818cf8", marginRight: 8 }}>{open ? "▾" : "▸"}</span>{title}
        {sub && <span style={{ fontWeight: 400, fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginLeft: 10 }}>{sub}</span>}
      </button>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  );
}

// Self-fetching wrapper so the OTPI panel can live on Models & Labs without
// dragging the whole Silicon tab's data loading with it (/api/ornn is
// server-cached, so the duplicate fetch is nearly free).
function OrnnTokenPriceSection() {
  const [ornn, setOrnn] = useState(null);
  useEffect(() => {
    fetch("/api/ornn").then(r => r.json()).then(d => { if (!d.error) setOrnn(d); }).catch(() => {});
  }, []);
  if (!ornn) return null;
  return <OrnnTokenPricePanel ornn={ornn} />;
}

// ── Tokens: the OpenRouter deep-dive + Artificial Analysis ───────────────
function TokenDemandTab() {
  return (<>
    <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 16, maxWidth: 780 }}>
      Stage 1 of the chain: who wants intelligence, and how fast is that growing. OpenRouter token flow is the
      highest-frequency sample (by lab, by model, by use); Artificial Analysis prices what a point of intelligence
      costs; Census adoption breadth and the developer signals lead it.
    </div>
    <ApiUsagePanels />
    <SH>How Many Tokens Do OpenAI and Anthropic Actually Process?</SH>
    <TokenEstimatesPanel />
    <SH>Intelligence, Price and Speed — Artificial Analysis</SH>
    <AaModelsPanel />
    <BtosAdoptionPanel />
    <Collapse title="Corroborating Signals — Stack Overflow / GitHub / Cloudflare" sub="early-warning breadth, not headline signals">
      <UsageSignalsPanel />
    </Collapse>
  </>);
}

// ── Models & Labs ─────────────────────────────────────────────────────────
function ModelsLabsTab() {
  return (<>
    <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 16, maxWidth: 780 }}>
      Stage 2 of the chain: who converts tokens into money, and at what realized price. The wedge tracker is the
      master KPI; the Ornn token price index is what a token actually sells for.
    </div>
    <LabRevenueTracker />
    <OrnnTokenPriceSection />
  </>);
}

// ── Compute: rentals, power, capex, silicon and memory ────────────────────
function ComputeForecast() {
  const d = useAiPulse();
  return <ForecastPanel tag="ai" live={{
    "h100-1y-oct26": d?.gpu?.semi?.h100Contract != null ? { value: d.gpu.semi.h100Contract, label: "SemiAnalysis index, latest" } : undefined,
    "or-tokens-sep26": d?.tokens?.total != null ? { value: d.tokens.total / 1e12, label: "latest 7-day window" } : undefined,
  }} />;
}
function ComputeTab() {
  return (<>
    <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 16, maxWidth: 780 }}>
      Stages 3 and 4 of the chain: what compute costs to rent today, whether the power and capex build-out keeps
      pace, and the silicon and memory supply behind it.
    </div>
    <GpuRentalsPanel />
    <GpuEconomicsPanel />
    <CapexReturnsPanel />
    <ComputePowerTab />
    <SupplyCeilingPanel />
    <MemoryPricesPanel />
    <ComputeForecast />
  </>);
}

// ── Pulse: the landing ─────────────────────────────────────────────────────
function PulseTab({ go }) {
  return (<>
    <AiPulseTab chainModel={chainModel} chainHeadline={chainHeadline} chainVerdicts={chainVerdicts} />
    <Collapse title="The Chain — tokens → models → data centers → silicon" sub="the four-stage verdict, the wedge tracker and the full KPI scorecard">
      <ChainTab go={go} />
    </Collapse>
  </>);
}

// ── The Chain landing page ──────────────────────────────────────────────────
const CHAIN_STAGES_NOTE = "Click any stage to open its full tab.";

function StageCard({ n, title, question, kpi, kpiSub, verdict, color, extra, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px",
      cursor: "pointer", transition: "border-color 120ms",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase" }}>
          Stage {n} · {title} <span style={{ color: "#475569" }}>— {question}</span>
        </div>
        <div style={{ fontSize: 10, fontFamily: fonts.mono, fontWeight: 700, color, border: `1px solid ${color}44`, borderRadius: 12, padding: "2px 10px" }}>{verdict}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
        <div style={{ fontSize: 26, fontWeight: 800, fontFamily: fonts.heading, color: "#f1f5f9" }}>{kpi}</div>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono }}>{kpiSub}</div>
      </div>
      {extra && <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5 }}>{extra}</div>}
    </div>
  );
}

function ChainLink({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0 6px 26px" }}>
      <span style={{ color: "#475569", fontSize: 14 }}>▼</span>
      <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

// Pure model of the chain from the four server-cached feeds — shared by the
// Chain tab and the Cockpit's verdict tile so both always say the same thing.
export function chainModel(or, ornn, semi, mem) {
    // Stage 1 — token demand (last complete OpenRouter week + 13-week growth)
    const wk = orWeeklyTotals(or);
    const wkLast = wk.length ? wk[wk.length - 1] : null;
    const wk13 = wk.length > 13 ? wk[wk.length - 14] : (wk[0] || null);
    const demand13 = wkLast && wk13 && wk13.v && wkLast !== wk13 ? ((wkLast.v / wk13.v) - 1) * 100 : null;

    // Link A — realized $/M tokens (avg of the big-4 labs' OTPI), ~30d change
    const OTPI_BIG4 = ["anthropic", "openai", "google", "deepseek"];
    const otpi = (ornn?.otpiRows || []).map(r => {
      const vals = OTPI_BIG4.map(l => r[l]).filter(v => v != null);
      return vals.length >= 2 ? { d: r.d, v: vals.reduce((a, b) => a + b, 0) / vals.length } : null;
    }).filter(Boolean);
    const otpiNow = otpi.length ? otpi[otpi.length - 1] : null;
    const cut30 = otpiNow ? new Date(Date.parse(otpiNow.d) - 30 * 86400000).toISOString().slice(0, 10) : null;
    const otpiBase = cut30 ? [...otpi].reverse().find(p => p.d <= cut30) : null;
    const otpiChg = otpiNow && otpiBase?.v ? ((otpiNow.v / otpiBase.v) - 1) * 100 : null;

    // Stage 2 — labs (latest disclosed ARR per lab + the wedge)
    const wedge = wedgeSummary();
    const latestByCo = {};
    for (const r of REVENUE_DISCLOSURES) if (!latestByCo[r.co] || r.d > latestByCo[r.co].d) latestByCo[r.co] = r;
    const arrTotal = Object.values(latestByCo).reduce((a, r) => a + r.arr, 0);
    const spreadX = wedge.latestRev ? wedge.latestRev.rev / ((wedge.costBand.min + wedge.costBand.max) / 2) : null;

    // Stage 3 — compute & power
    const debtTotal = AI_DEBT_DEALS.reduce((a, d) => a + (d.amt || 0), 0);
    const pjm = PJM_CAPACITY[PJM_CAPACITY.length - 1];
    const pjmPrev = PJM_CAPACITY[PJM_CAPACITY.length - 2];

    // Link C — H100 1y-contract clearing price (~4 weeks back for the change)
    const hSeries = (semi?.series || []).filter(r => r.h100 != null);
    const hNow = hSeries.length ? hSeries[hSeries.length - 1] : null;
    const hBase = hSeries.length > 4 ? hSeries[hSeries.length - 5] : null;
    const hChg = hNow && hBase?.h100 ? ((hNow.h100 / hBase.h100) - 1) * 100 : null;

    // Stage 4 — silicon & memory (repricing breadth this session)
    const items = (mem?.latest || []).filter(i => i.chg != null);
    const memUp = items.filter(i => i.chg > 0).length;
    const memDown = items.filter(i => i.chg < 0).length;
    const ddr5 = (mem?.latest || []).find(i => i.n.startsWith("DDR5 16Gb (2Gx8) 4800"));

    return { wkLast, demand13, otpiNow, otpiChg, wedge, arrTotal, spreadX, debtTotal, pjm, pjmPrev, hNow, hChg, memUp, memDown, memTotal: items.length, ddr5 };
}

// Simple, honest verdicts — each one derived from a number shown on the card.
export function chainVerdicts(c) {
  const vDemand = c.demand13 == null ? ["Loading", "#64748b"]
    : c.demand13 < 0 ? ["Cooling", SD_RED]
    : c.demand13 > 15 ? ["Compounding", SD_GREEN]
    : ["Growing", SD_GREEN];
  const vLabs = [c.wedge.status.title, c.wedge.status.color];
  const vCompute = !c.pjm ? ["—", "#64748b"]
    : c.pjm.price > (c.pjmPrev?.price ?? 0) ? ["Scarcity priced in", SD_AMBER]
    : ["Easing", SD_GREEN];
  const vSilicon = c.memTotal === 0 ? ["Loading", "#64748b"]
    : c.memUp > c.memDown ? ["Repricing up", SD_RED]
    : c.memUp === c.memDown ? ["Mixed", SD_AMBER]
    : ["Cooling", SD_GREEN];
  return { vDemand, vLabs, vCompute, vSilicon };
}

// One-line synthesis for the Cockpit tile: token-demand growth against the two
// clearing prices we track daily (H100 1y contract, memory spot breadth).
export function chainHeadline(c) {
  if (c.demand13 == null || (c.hNow == null && c.memTotal === 0)) return { label: "Loading", color: "#64748b", why: "" };
  const priceUp = (c.hChg != null && c.hChg > 2) || c.memUp > c.memDown;
  const priceDown = (c.hChg != null && c.hChg < -2) && c.memDown >= c.memUp;
  let label, color;
  if (c.demand13 < 0) { label = "Demand cooling"; color = SD_RED; }
  else if (c.demand13 > 15 && priceUp) { label = "Shortage forming"; color = SD_RED; }
  else if (priceUp) { label = "Tightening"; color = SD_AMBER; }
  else if (priceDown) { label = "Supply catching up"; color = SD_GREEN; }
  else { label = "Supply keeping pace"; color = SD_GREEN; }
  const why = [
    `tokens ${sdPct(c.demand13)} /13wk`,
    c.hNow ? `H100 $${c.hNow.h100.toFixed(2)}/hr ${sdPct(c.hChg, 1)} 4wk` : null,
    c.memTotal ? `memory ${c.memUp}▲/${c.memDown}▼` : null,
  ].filter(Boolean).join(" · ");
  return { label, color, why };
}

function ChainTab({ go }) {
  const [or, setOr] = useState(null);
  const [ornn, setOrnn] = useState(null);
  const [semi, setSemi] = useState(null);
  const [mem, setMem] = useState(null);
  useEffect(() => {
    fetch("/api/or-rankings-history").then(r => r.json()).then(setOr).catch(() => {});
    fetch("/api/ornn").then(r => r.json()).then(d => { if (!d.error) setOrnn(d); }).catch(() => {});
    fetch("/api/semi-h100").then(r => r.json()).then(d => { if (!d.error) setSemi(d); }).catch(() => {});
    fetch("/api/memory").then(r => r.json()).then(d => { if (!d.error) setMem(d); }).catch(() => {});
  }, []);

  const c = useMemo(() => chainModel(or, ornn, semi, mem), [or, ornn, semi, mem]);
  const { vDemand, vLabs, vCompute, vSilicon } = chainVerdicts(c);

  const linkColor = chg => chg == null ? "#64748b" : chg > 2 ? SD_RED : chg < -2 ? SD_GREEN : SD_AMBER;

  return (<>
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", fontFamily: fonts.heading, letterSpacing: -0.5 }}>The Chain</div>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginTop: 4, maxWidth: 820, lineHeight: 1.55 }}>
        End demand for tokens → the models that monetize them → the data centers they run in → the silicon &amp;
        memory underneath. Each stage&apos;s demand is the next stage&apos;s revenue; the links between stages are the
        prices that tell you whether the buildout still pays. {CHAIN_STAGES_NOTE}
      </div>
    </div>

    <div style={{ display: "flex", flexDirection: "column", maxWidth: 880, margin: "14px 0 6px" }}>
      <StageCard n={1} title="Token Demand" question="who wants intelligence?"
        kpi={`${sdTok(c.wkLast?.v)}/wk`} kpiSub={`API tokens, last complete week (OpenRouter sample) · 13-week ${sdPct(c.demand13)}`}
        verdict={vDemand[0]} color={vDemand[1]} onClick={() => go("tokens")}
        extra="Corroborated by Artificial Analysis pricing and Census adoption breadth — on the Tokens tab." />
      <ChainLink label="Link A · realized $ per M tokens" color={linkColor(c.otpiChg)}
        value={c.otpiNow ? `$${c.otpiNow.v.toFixed(2)}/M big-4 avg · 30d ${sdPct(c.otpiChg, 1)}` : "loading…"} />
      <StageCard n={2} title="Models & Labs" question="who converts it to money?"
        kpi={`$${c.arrTotal.toFixed(0)}B`} kpiSub="latest disclosed AI revenue run-rates, summed (OpenAI + Anthropic + Microsoft AI)"
        verdict={vLabs[0]} color={vLabs[1]} onClick={() => go("models")}
        extra={c.wedge.latestRev
          ? `The wedge: ~$${c.wedge.latestRev.rev.toFixed(0)}M/MW/yr latest print vs $${c.wedge.costBand.min}–${c.wedge.costBand.max}M cost${c.spreadX ? ` — ${c.spreadX.toFixed(1)}× base compute cost` : ""}. Needs a second print to trend.`
          : "Wedge tracker awaiting first rev-per-MW print."} />
      <ChainLink label="Link B · revenue per GW (the master KPI)" color={c.wedge.status.color}
        value={c.wedge.latestRev ? `$${c.wedge.latestRev.rev.toFixed(0)}M/MW · ${c.wedge.status.title.toLowerCase()}` : "collecting baseline"} />
      <StageCard n={3} title="Compute & Power" question="what does the buildout cost?"
        kpi={c.wedge.gwTotal ? `${c.wedge.gwTotal.toFixed(0)} GW` : "—"}
        kpiSub={`tracked lab footprint by ${c.wedge.gwDate || "—"} (incl. projections) · $${c.debtTotal.toFixed(0)}B AI debt announced · PJM $${c.pjm?.price}/MW-day`}
        verdict={vCompute[0]} color={vCompute[1]} onClick={() => go("compute")}
        extra={c.pjmPrev ? `Grid scarcity: PJM capacity cleared $${c.pjmPrev.price} → $${c.pjm.price} across the last two auctions.` : null} />
      <ChainLink label="Link C · $ per GPU-hour (H100 1y contract)" color={linkColor(c.hChg)}
        value={c.hNow ? `$${c.hNow.h100.toFixed(2)}/hr · 4wk ${sdPct(c.hChg, 1)}` : "loading…"} />
      <StageCard n={4} title="Silicon & Memory" question="what does the hardware cost?"
        kpi={c.ddr5 ? `$${c.ddr5.avg.toFixed(1)}` : "—"}
        kpiSub={`DDR5 16Gb spot avg · memory breadth ${c.memUp}▲/${c.memDown}▼ of ${c.memTotal} parts this session`}
        verdict={vSilicon[0]} color={vSilicon[1]} onClick={() => go("silicon")}
        extra="H100 contract/spot, all-generation rental, CoWoS/HBM ceiling, and TrendForce memory spot — the upstream repricing evidence." />
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "#cbd5e1" }}>How to read the chain.</strong> Healthy: stage 1 grows, link A holds or
      falls slowly, link B widens, links C and stage 4 reprice UP (scarcity — bullish suppliers). The bear signature
      is the reverse cascade: stage 1 still growing but link A collapsing, link B flat while GW lands (the wedge
      plateau), then C and memory rolling over as supply catches demand. One stage alone is noise — watch for the
      sequence.
    </InfoBox>

    <div style={{ margin: "22px 0 0" }}>
      <SH>Full Scorecard — Every KPI in One Table</SH>
      <ScorecardTab />
    </div>
  </>);
}

function AIEconomyTab() {
  const [subTab, setSubTab] = useState("pulse");

  // 2026-09 revamp: Pulse landing (token tracker + Artificial Analysis + GPU
  // rentals), then the three deep-dives along the chain.
  const SUB_TABS = [
    { id: "pulse",   label: "Pulse"          },
    { id: "tokens",  label: "Tokens"         },
    { id: "compute", label: "Compute"        },
    { id: "models",  label: "Models & Labs"  },
  ];

  return (<>
    {/* Sub-tab nav */}
    <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
      {SUB_TABS.map(t => (
        <SubTab key={t.id} id={t.id} label={t.label} active={subTab === t.id} onClick={setSubTab} />
      ))}
    </div>

    {subTab === "pulse"   && <PulseTab go={setSubTab} />}
    {subTab === "tokens"  && <TokenDemandTab />}
    {subTab === "compute" && <ComputeTab />}
    {subTab === "models"  && <ModelsLabsTab />}
  </>);
}

export default AIEconomyTab;
