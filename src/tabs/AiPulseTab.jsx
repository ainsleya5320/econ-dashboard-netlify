import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

// ============================================================================
// AI PULSE — the AI Economy landing, cockpit-style, built around the token
// tracker. Header: the chain verdict (the same functions the Cockpit uses) +
// three scores (demand, efficiency, compute cost) + chips. Sections: the
// token tracker (OpenRouter flow by lab and model, mix, movers), intelligence
// vs price (Artificial Analysis frontier), compute cost (GPU rentals from
// Vast.ai, RunPod, Ornn, SemiAnalysis, with the $/GPU-hour → $/M-token bridge).
// Also exports GpuRentalsPanel (Compute sub-tab) and AaModelsPanel (Tokens).
// Data: /api/ai-pulse (server-cached 1h) plus the chain feeds.
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
const pc = (v, dp = 0) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}%` : "—");
const tok = n => (!fin(n) ? "—" : n >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : `${Math.round(n)}`);
const usd = (v, dp = 2) => (fin(v) ? `$${v.toFixed(dp)}` : "—");
const upDown = v => (!fin(v) || v === 0 ? SLATE : v > 0 ? GREEN : RED);
const LAB_COLORS = { deepseek: "#F59E0B", tencent: "#22d3ee", "z-ai": "#fb923c", openai: "#10B981", anthropic: "#E8553A", google: "#4285F4", nvidia: "#76b900", xiaomi: "#f97316", moonshotai: "#a78bfa", minimax: "#ec4899", qwen: "#D946EF", "x-ai": "#14B8A6", "meta-llama": "#8B5CF6", mistralai: "#f472b6", others: "#64748b" };
const labColor = l => LAB_COLORS[l] || "#94a3b8";

// one fetch per page, shared by the panels
let pulseCache = null, pulsePromise = null;
export function useAiPulse() {
  const [d, setD] = useState(pulseCache);
  useEffect(() => { if (pulseCache) return; pulsePromise = pulsePromise || fetch("/api/ai-pulse").then(r => r.json()).then(x => { if (x && !x.error) pulseCache = x; return pulseCache; }); pulsePromise.then(x => x && setD(x)).catch(() => {}); }, []);
  return d;
}
const useJson = url => { const [d, setD] = useState(null); useEffect(() => { fetch(url).then(r => r.json()).then(x => { if (x && !x.error) setD(x); }).catch(() => {}); }, [url]); return d; };

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
function VerdictCard({ title, s }) {
  if (!s) return null;
  const c = TONE[s.tone] || SLATE;
  return (
    <div style={{ ...card, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: c }} />
      {title && <div style={label}>{title}</div>}
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c, fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: title ? 3 : 0 }}>{s.label}</div>
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

// ── GPU rentals (also mounted on the Compute sub-tab) ─────────────────────────
export function GpuRentalsPanel({ compact = false }) {
  const d = useAiPulse();
  if (!d?.gpu) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading GPU rental rates…</div>;
  const g = d.gpu, b = g.bridge, ol = g.ornn.latest || {};
  const ornnKey = { "H100 SXM": "h100", H200: "h200", B200: "b200", "A100 SXM4": "a100", "RTX 5090": "rtx5090" };
  const rpKey = { "H100 SXM": "H100 80GB", "RTX 4090": "RTX 4090", "RTX 5090": "RTX 5090", H200: "H200", B200: "B200", "A100 SXM4": "A100 80GB", L40S: "L40S" };
  const rows = g.vast.map(v => ({ ...v, ornn: ol[ornnKey[v.gpu]]?.current ?? null, ornnChg: ol[ornnKey[v.gpu]]?.chg30 ?? null, runpod: g.runpod?.[rpKey[v.gpu]] ?? null }));
  const chartRows = (g.ornn.rows || []).map(r => ({ d: r.d, h100: r.h100, h200: r.h200, b200: r.b200 }));
  return (<>
    {!compact && <SH>Compute Cost — GPU Rental Rates (live)</SH>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 12, alignItems: "start" }}>
      <div style={{ ...card, padding: "6px 8px", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{th("GPU", "left")}{th("Vast median $/hr")}{th("min")}{th("offers")}{th("Ornn index")}{th("30-d")}{th("RunPod from")}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.gpu} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }} title={r.error ? r.error : `${r.n} on-demand asks on Vast.ai${fin(r.p25) ? `, 25th percentile $${r.p25}` : ""}`}>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", fontWeight: 700, whiteSpace: "nowrap" }}>{r.gpu}</td>
              {td(fin(r.median) ? usd(r.median) : "—", "var(--text-primary)", { fontWeight: 700 })}{td(fin(r.min) ? usd(r.min) : "—")}{td(r.n || "—", DIM)}{td(fin(r.ornn) ? usd(r.ornn) : "—")}{td(pc(r.ornnChg), upDown(fin(r.ornnChg) ? -r.ornnChg : null))}{td(fin(r.runpod) ? usd(r.runpod) : "—")}
            </tr>))}</tbody>
        </table>
        <div style={{ ...note, marginTop: 6 }}>Vast.ai = live on-demand asks per GPU (marketplace floor, unmanaged hosts); Ornn = daily rental index across providers; RunPod = published "from" rate. SemiAnalysis 1-year H100 contract index: <strong style={{ color: "#cbd5e1" }}>{fin(g.semi.h100Contract) ? usd(g.semi.h100Contract) : "—"}</strong>{g.semi.asOf ? ` (${g.semi.asOf})` : " (latest)"}. Green in the 30-day column = getting cheaper. Daily snapshots archive from today ({g.history?.length || 1} day{g.history?.length === 1 ? "" : "s"} so far).</div>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={card}>
          <div style={label}>The bridge · $/GPU-hour → $/M tokens</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.6, marginTop: 4 }}>{fin(b.costPerM1000) ? `$${b.costPerM1000.toFixed(2)}` : "—"}<span style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginLeft: 8 }}>per M tokens at 1,000 tok/s</span></div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, lineHeight: 1.5, marginTop: 4 }}>H100 at {fin(g.h100SpotUsed) ? usd(g.h100SpotUsed) : "—"}/hr ({g.h100Source}). At 400 tok/s: {fin(b.costPerM400) ? usd(b.costPerM400) : "—"}. Realized price per M tokens (Ornn OTPI, big-4 average) is {fin(b.otpiAvg) ? usd(b.otpiAvg, 3) : "—"}, so a GPU must sustain about <strong style={{ color: "var(--text-primary)" }}>{fin(b.breakevenTps) ? b.breakevenTps.toLocaleString() : "—"} tok/s</strong> to break even — batching, caching and the input-heavy mix are how serving clears that bar. That spread is the whole inference business model.</div>
        </div>
        {chartRows.length > 5 && chartBox("Ornn rental index — H100 / H200 / B200 ($/GPU-hr, daily)",
          <ResponsiveContainer width="100%" height={140}><LineChart data={chartRows} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(5)} minTickGap={30} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [`$${Number(v).toFixed(2)}`, n]} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" />
            <Line type="monotone" dataKey="h100" name="H100" stroke={INDIGO} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="h200" name="H200" stroke={CYAN} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="b200" name="B200" stroke={"#f97316"} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer>)}
      </div>
    </div>
  </>);
}

// ── Artificial Analysis model table (Tokens sub-tab) ─────────────────────────
export function AaModelsPanel() {
  const d = useAiPulse();
  const [sort, setSort] = useState({ key: "idx", asc: false });
  const [q, setQ] = useState("");
  const rows = useMemo(() => { const t = (d?.aa?.table || []).filter(m => !q || (m.name + " " + m.creator).toLowerCase().includes(q.toLowerCase())); const dir = sort.asc ? 1 : -1; return [...t].sort((a, b) => { const x = a[sort.key], y = b[sort.key]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir; }); }, [d, sort, q]);
  if (!d) return null;
  if (!d.aa) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Artificial Analysis data unavailable (add ARTIFICIAL_ANALYSIS_KEY to .env).</div>;
  const cols = [["name", "Model", "left"], ["creator", "Creator", "left"], ["idx", "Intelligence"], ["coding", "Coding"], ["price", "$/M blended"], ["priceIn", "$/M in"], ["priceOut", "$/M out"], ["tps", "tok/s"], ["ttft", "TTFT s"], ["release", "Released", "left"]];
  return (
    <div style={{ ...card, padding: "8px 10px", marginBottom: 12, overflowX: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={label}>Artificial Analysis — top 80 models by Intelligence Index · click a column to sort</div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter model or creator" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(129,140,248,0.35)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 10, fontFamily: fonts.mono, width: 170 }} />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
        <thead><tr>{cols.map(([k, t, al]) => <th key={k} onClick={() => setSort(s => ({ key: k, asc: s.key === k ? !s.asc : ["name", "creator", "release"].includes(k) }))} style={{ padding: "5px 6px", fontSize: 8.5, color: sort.key === k ? "#c7d2fe" : DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: al || "right", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>{t}{sort.key === k ? (sort.asc ? " ▲" : " ▼") : ""}</th>)}</tr></thead>
        <tbody>{rows.map(m => (
          <tr key={m.name + m.creator} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }}>
            <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</td>
            <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE, whiteSpace: "nowrap" }}>{m.creator}</td>
            {td(fin(m.idx) ? m.idx.toFixed(1) : "—", "var(--text-primary)", { fontWeight: 700 })}{td(fin(m.coding) ? m.coding.toFixed(1) : "—")}{td(fin(m.price) ? usd(m.price) : "—", GREEN)}{td(fin(m.priceIn) ? usd(m.priceIn) : "—")}{td(fin(m.priceOut) ? usd(m.priceOut) : "—")}{td(fin(m.tps) ? Math.round(m.tps) : "—")}{td(fin(m.ttft) ? m.ttft.toFixed(2) : "—")}
            <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: DIM, whiteSpace: "nowrap" }}>{m.release || "—"}</td>
          </tr>))}</tbody>
      </table>
      <div style={{ ...note, marginTop: 6 }}>{d.aa.source}. Blended price weights input 3:1 over output. Speed and latency are medians of Artificial Analysis&apos;s own runs; blank means not yet measured.</div>
    </div>
  );
}

// ── the landing ───────────────────────────────────────────────────────────────
function AiPulseTab({ chainModel, chainHeadline, chainVerdicts }) {
  const d = useAiPulse();
  const or = useJson("/api/or-rankings-history"), ornn = useJson("/api/ornn"), semi = useJson("/api/semi-h100"), memF = useJson("/api/memory");
  const chain = useMemo(() => (or || ornn || semi || memF) && chainModel ? chainModel(or, ornn, semi, memF) : null, [or, ornn, semi, memF, chainModel]);
  const head = chain && chainHeadline ? chainHeadline(chain) : null;
  const verdicts = chain && chainVerdicts ? chainVerdicts(chain) : null;
  const [labSort, setLabSort] = useState("tokens");
  if (!d) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading the AI pulse (OpenRouter archive, Artificial Analysis, GPU marketplaces — about 20 seconds the first time, then cached)…</div>;
  const T = d.tokens, A = d.aa, s = d.scores;
  const labs = [...T.labs].sort((a, b) => (labSort === "tokens" ? b.tokens - a.tokens : (b[labSort] ?? -999) - (a[labSort] ?? -999)));
  const weeklyLabs = ["deepseek", "tencent", "z-ai", "openai", "google", "anthropic", "nvidia", "minimax", "xiaomi", "others"].filter(k => T.weeklyLabs.includes(k));
  const chips = [["tokens / week", tok(T.week.total)], ["1-wk", pc(T.growth.w1)], ["4-wk", pc(T.growth.w4)], ["13-wk", pc(T.growth.w13)], ["52-wk", pc(T.growth.w52)], ["open weights", `${T.shares.open}%`], ["OTPI avg", fin(d.gpu.bridge.otpiAvg) ? `${usd(d.gpu.bridge.otpiAvg, 3)}/M` : "—"], ["H100", fin(d.gpu.h100SpotUsed) ? `${usd(d.gpu.h100SpotUsed)}/hr` : "—"], ["frontier", A ? `${A.best.name.slice(0, 22)} · ${A.best.idx}` : "—"]];
  const ScatterTip = ({ active, payload }) => { if (!active || !payload?.length) return null; const m = payload[0].payload; return <div style={{ ...tip, padding: "6px 8px", fontFamily: fonts.mono, color: "#cbd5e1" }}><div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{m.name}</div><div>{m.creator} · index {m.idx} · {usd(m.price)}/M{fin(m.tps) ? ` · ${Math.round(m.tps)} tok/s` : ""}{m.pareto ? " · on the frontier" : ""}</div></div>; };
  return (<>
    <div style={{ ...card, padding: "14px 18px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 18, alignItems: "start" }}>
      <div>
        <div style={label}>AI economy · pulse</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: head?.color || SLATE, fontFamily: fonts.heading, letterSpacing: -0.7, lineHeight: 1.1, marginTop: 4 }}>{head?.label || "…"}</div>
        <div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.5 }}>{head?.why || "the chain verdict loads with the token, price and silicon feeds"}{verdicts ? ` · stages: ${[verdicts.vDemand?.[0], verdicts.vLabs?.[0], verdicts.vCompute?.[0], verdicts.vSilicon?.[0]].filter(Boolean).join(" / ")}` : ""}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>{chips.map(([t, v]) => <span key={t} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "3px 8px" }}>{t} <strong style={{ color: "var(--text-primary)" }}>{v}</strong></span>)}</div>
        <div style={{ ...note, marginTop: 8 }}>OpenRouter week of {T.week.d} ({T.week.weeks} complete weeks) · rankings snapshot {T.snapshot.d}{T.snapshot.daysOld > 3 ? ` (${T.snapshot.daysOld} days old)` : ""}, {T.snapshot.models} models · Artificial Analysis {A ? `${A.n} models` : "off"} · refreshed {new Date(d.updated).toLocaleString()}</div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><Score name="Token demand" s={s.demand} /><Score name="Price efficiency" s={s.efficiency} /><Score name="Compute cost" s={s.compute} /></div>
    </div>

    <SH>The Token Tracker — Who Is Consuming Intelligence, and How Fast</SH>
    <div style={{ ...note, marginTop: -8, marginBottom: 8 }}>OpenRouter routes a large, model-agnostic slice of API traffic. Share and growth by lab come from its weekly series (complete weeks only, since {T.week.since}); the model movers come from the per-model rankings this dashboard snapshots daily ({T.snapshot.fullDays} complete snapshots since {T.snapshot.firstFull}).</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12, marginBottom: 12, alignItems: "start" }}>
      <div style={{ ...card, padding: "6px 8px", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{th("Lab", "left")}{[["tokens", "Tokens / wk"], ["share", "Share"], ["chg4w", "4-wk"], ["chg13w", "13-wk"], ["models", "Models"]].map(([k, t]) => <th key={k} onClick={() => setLabSort(k)} style={{ padding: "5px 6px", fontSize: 8.5, color: labSort === k ? "#c7d2fe" : DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", whiteSpace: "nowrap" }}>{t}</th>)}{th("26 wks", "center")}</tr></thead>
          <tbody>{labs.map(l => (
            <tr key={l.lab} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }}>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", whiteSpace: "nowrap" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: labColor(l.lab), marginRight: 6, verticalAlign: "middle" }} /><strong>{l.lab}</strong><span style={{ fontSize: 8.5, color: l.weights === "open" ? GREEN : l.weights === "closed" ? AMBER : DIM, marginLeft: 6 }}>{l.weights}</span></td>
              {td(tok(l.tokens), "var(--text-primary)", { fontWeight: 700 })}{td(`${l.share}%`)}{td(pc(l.chg4w), upDown(l.chg4w))}{td(pc(l.chg13w), upDown(l.chg13w))}{td(l.models, DIM)}
              <td style={{ padding: "2px 6px", textAlign: "center" }}><Spark values={l.spark} color={labColor(l.lab)} /></td>
            </tr>))}</tbody>
        </table>
        <div style={{ ...note, marginTop: 6 }}>Top-3 labs carry {T.shares.top3Labs}% of the weekly flow; in the rankings snapshot the top-5 models carry {T.shares.top5Models}%, completions are {T.mix.completionShare}% of tokens and the average request is {T.mix.tokensPerRequest.toLocaleString()} tokens{fin(T.mix.reasoningShare) ? `, ${T.mix.reasoningShare}% of completions are reasoning` : ""}{fin(T.mix.cachedShare) ? `, ${T.mix.cachedShare}% of prompts are cache hits` : ""}. Weights: open = published weights, closed = API only.</div>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {chartBox(`Weekly tokens by lab — OpenRouter, ${T.weekly.length} weeks`,
          <ResponsiveContainer width="100%" height={200}><AreaChart data={T.weekly} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={x => x.slice(2, 7)} minTickGap={30} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => tok(v)} width={44} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [tok(v), n]} />
            {weeklyLabs.map(k => <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={labColor(k)} fill={labColor(k)} fillOpacity={0.45} strokeWidth={0.8} isAnimationActive={false} />)}
          </AreaChart></ResponsiveContainer>,
          `${tok(T.week.total)} in the week of ${T.week.d} vs ${tok(T.weekly[0]?.total)} in the week of ${T.weekly[0]?.d} — the area is the demand curve for intelligence, and the colors are who gets it.`)}
        <VerdictCard title="Demand" s={s.demand} />
        <div style={card}>
          <div style={label}>Movers — biggest changes in 7-day tokens{T.movers.span ? ` over ${T.movers.span} days (vs ${T.movers.ref})` : ""}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
            {[["up", GREEN], ["down", RED]].map(([k, c]) => <div key={k}>{T.movers[k].map(m => <div key={m.slug} style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", lineHeight: 1.6 }} title={`${m.slug}: ${tok(m.tokens)} tokens in the latest 7-day window, ${pc(m.chg)} vs ${T.movers.ref}`}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span><strong style={{ color: c, flexShrink: 0 }}>{sgn(m.delta)}{tok(Math.abs(m.delta))}</strong></div>)}</div>)}
          </div>
        </div>
      </div>
    </div>

    <SH>Intelligence vs Price — What a Point of Capability Costs</SH>
    {A ? (<>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 10, marginBottom: 12 }}>
        {[["Best model", `${A.best.name}`, `index ${A.best.idx} · ${usd(A.best.price)}/M · ${A.best.creator}`], ["Frontier at a discount", A.frontier ? A.frontier.name : "—", A.frontier ? `within 5 points of the best for ${usd(A.frontier.price)}/M` : ""], ["Top-10 median price", `${usd(A.top10MedianPrice)}/M`, `cost per intelligence point ${fin(A.top10CostPerPoint) ? usd(A.top10CostPerPoint, 3) : "—"}`], ["Cheapest at 80% of best", A.tiers[1]?.model ? `${usd(A.tiers[1].model.price)}/M` : "—", A.tiers[1]?.model ? `${A.tiers[1].model.name} (index ${A.tiers[1].model.idx} vs ${A.tiers[1].min} needed)` : "none"], ["Fastest near-frontier", A.fastest ? `${Math.round(A.fastest.tps)} tok/s` : "—", A.fastest ? `${A.fastest.name} · ${usd(A.fastest.price)}/M` : ""], ["Released last 90 days", `${A.releases90d}`, `of ${A.n} priced, indexed models`]].map(([t, v, sub]) => (
          <div key={t} style={{ ...card, padding: "10px 12px" }}><div style={label}>{t}</div><div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={v}>{v}</div><div style={note}>{sub}</div></div>))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
        {chartBox("Intelligence Index vs blended price per 1M tokens (log) — the frontier is the upper-left edge",
          <ResponsiveContainer width="100%" height={300}><ScatterChart margin={{ top: 10, right: 16, bottom: 4, left: -6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis type="number" dataKey="price" scale="log" domain={[0.02, 200]} ticks={[0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200]} tick={axis} tickFormatter={v => (v >= 1 ? `$${v}` : `${v * 100}¢`)} axisLine={false} tickLine={false} name="$/M" allowDataOverflow /><YAxis type="number" dataKey="idx" domain={["auto", "auto"]} tick={axis} axisLine={false} tickLine={false} width={34} name="index" /><ZAxis range={[22, 22]} />
            <Tooltip content={<ScatterTip />} cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.2)" }} />
            <Scatter data={A.scatter.filter(m => !m.pareto)} fill="#94a3b8" fillOpacity={0.35} isAnimationActive={false} /><Scatter data={A.scatter.filter(m => m.pareto)} fill={CYAN} isAnimationActive={false} shape={p => <circle cx={p.cx} cy={p.cy} r={5} fill={CYAN} stroke="#0f172a" strokeWidth={0.8} />} />
          </ScatterChart></ResponsiveContainer>,
          `Cyan = Pareto frontier: no cheaper model is smarter. ${A.pareto.length} models sit on it, from ${A.pareto[0]?.name} at ${usd(A.pareto[0]?.price)}/M to ${A.pareto[A.pareto.length - 1]?.name}. The frontier moving down and to the left is the deflation that drives token demand.`)}
        <div style={{ display: "grid", gap: 12 }}>
          <div style={card}>
            <div style={label}>Best model per creator</div>
            {A.creators.map(c => <div key={c.creator} style={{ display: "grid", gridTemplateColumns: "88px 1fr 34px 52px", gap: 8, alignItems: "center", height: 20, fontSize: 10, fontFamily: fonts.mono }}><span style={{ color: "#cbd5e1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.creator}</span><div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3 }}><div style={{ width: `${(c.idx / (A.best.idx || 1)) * 100}%`, height: "100%", background: INDIGO, borderRadius: 3, opacity: 0.85 }} /></div><span style={{ color: "var(--text-primary)", fontWeight: 700, textAlign: "right" }}>{c.idx}</span><span style={{ color: GREEN, textAlign: "right" }}>{usd(c.price)}</span></div>)}
          </div>
          <VerdictCard title="Efficiency" s={s.efficiency} />
        </div>
      </div>
    </>) : <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Artificial Analysis data unavailable — add ARTIFICIAL_ANALYSIS_KEY to .env and restart.</div>}

    <GpuRentalsPanel />
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 12, marginBottom: 14 }}><VerdictCard title="Compute cost" s={s.compute} /></div>

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How to read it.</strong> The AI economy is a chain — tokens demanded → models that make them → data centers that run them → silicon they run on — and this page tracks the money-relevant joints. Token demand is the top line; the price of a token is falling by design (the frontier gets cheaper every quarter, the scatter shows how fast), so revenue growth needs volume to outrun deflation. The compute bridge converts a GPU-hour into a cost per million tokens and compares it with what tokens actually sell for; that spread, times utilization, is the margin every lab, cloud and chip vendor is fighting over. OpenRouter is one large sample, not the market: it over-weights open-weight and cost-sensitive traffic, so read shares as relative and growth as directional.
    </InfoBox>
  </>);
}

export default AiPulseTab;
