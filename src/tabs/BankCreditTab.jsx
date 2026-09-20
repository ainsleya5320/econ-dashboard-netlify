import React, { useEffect, useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

/* ── Bank Credit — the lender's view of the credit cycle ─────────────────────
   Eisman's lens: banks see deterioration first and confess it in loan
   growth, charge-offs, and provisions. Aggregate data from /api/bank-credit
   (Fed H.8 weekly loan books + quarterly loss rates, all commercial banks).
   Per-bank big-4 numbers are curated by hand at earnings time (see
   BIG4_LOANBOOK below) — FMP's as-reported bank statements proved partial
   to the point of being untrustworthy, and invented numbers are worse than
   an empty table. */

// ── Big-4 curation table — fill each earnings season (Jan/Apr/Jul/Oct) ──────
// One row per bank per quarter, straight from the earnings release:
//   provisions: provision for credit losses ($B) — the forward confession
//   nco: net charge-offs ($B) · allowance: ACL ($B) · loans: avg loans ($B)
// Leave [] and the panel shows collection instructions instead of fake data.
const BIG4_LOANBOOK = [
  // { bank: "JPM", q: "2026-Q2", provisions: null, nco: null, allowance: null, loans: null },
];

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171";

function StatCard({ label, val, sub, color }) {
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color || "#818cf8" }} />
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{val}</div>
      {sub && <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const chartTooltip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };

export default function BankCreditTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/bank-credit")
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setData(d); })
      .catch(() => setError(true));
  }, []);

  // Merge loan-growth YoY series onto one date grid for the impulse chart
  const impulse = useMemo(() => {
    if (!data?.loans) return { rows: [], keys: [] };
    const keys = Object.entries(data.loans).map(([id, l]) => ({ id, label: l.label, color: l.color }));
    const byDate = {};
    for (const [id, l] of Object.entries(data.loans)) {
      for (const p of l.series || []) (byDate[p.d] = byDate[p.d] || { d: p.d })[id] = p.v;
    }
    return { rows: Object.values(byDate).sort((a, b) => a.d.localeCompare(b.d)), keys };
  }, [data]);

  // Merge charge-off series (quarterly) onto one grid
  const lossChart = useMemo(() => {
    if (!data?.losses) return { rows: [], keys: [] };
    const ids = Object.entries(data.losses).filter(([, l]) => l.group === "chargeoff");
    const byDate = {};
    for (const [id, l] of ids) for (const p of l.series || []) (byDate[p.d] = byDate[p.d] || { d: p.d })[id] = p.v;
    return { rows: Object.values(byDate).sort((a, b) => a.d.localeCompare(b.d)), keys: ids.map(([id, l]) => ({ id, label: l.label, color: l.color })) };
  }, [data]);

  // Big-vs-small split (cards + C&I)
  const splitChart = useMemo(() => {
    if (!data?.losses) return { rows: [], keys: [] };
    const ids = Object.entries(data.losses).filter(([, l]) => l.group === "split" || l.group === "split2");
    const byDate = {};
    for (const [id, l] of ids) for (const p of l.series || []) (byDate[p.d] = byDate[p.d] || { d: p.d })[id] = p.v;
    return { rows: Object.values(byDate).sort((a, b) => a.d.localeCompare(b.d)), keys: ids.map(([id, l]) => ({ id, label: l.label, color: l.color, dash: l.group === "split2" ? "5 4" : undefined })) };
  }, [data]);

  if (error) return <InfoBox color="#F97316">Unable to load bank-credit data — FRED may be temporarily unavailable.</InfoBox>;
  if (!data) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading the banking system&apos;s loan book…</div>;

  const v = data.verdict;
  const L = data.loans || {};
  const cardSplit = [data.losses?.CORCCT100S, data.losses?.CORCCOBS];

  return (<>
    {/* ── Verdict hero ── */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 14, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: v.color }} />
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>Credit Cycle — Read From the Banks&apos; Own Books</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: v.color, fontFamily: fonts.heading, letterSpacing: -0.5 }}>{v.label}</div>
      <div style={{ fontSize: 11.5, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6, maxWidth: 880, lineHeight: 1.55 }}>{v.note}</div>
    </div>

    {/* ── Loan book cards ── */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(175px, 100%), 1fr))", gap: 10, marginBottom: 16 }}>
      {Object.entries(L).map(([id, l]) => (
        <StatCard key={id} label={l.label} val={`$${(l.level / 1000).toFixed(2)}T`}
          sub={`${l.yoy >= 0 ? "+" : ""}${l.yoy?.toFixed(1)}% YoY · p${l.yoyPct} of history`}
          color={l.yoy == null ? "#64748b" : l.yoy < 0 ? RED : l.yoy < 3 ? AMBER : l.color} />
      ))}
    </div>

    {/* ── Credit impulse ── */}
    <SH>The Credit Impulse — Loan Growth YoY by Category</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={290}>
        <LineChart data={impulse.rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={50} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={x => `${x}%`} />
          <Tooltip contentStyle={chartTooltip} formatter={(x, n) => [`${x}%`, n]} labelFormatter={d => d.slice(0, 10)} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.7} />
          {impulse.keys.map(k => (
            <Line key={k.id} type="monotone" dataKey={k.id} name={k.label} stroke={k.color} strokeWidth={k.id === "TOTLL" ? 2.4 : 1.5} dot={false} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Fed H.8 (weekly, all US commercial banks) — this IS the aggregate loan book. The red line is the one that matters: total loan growth crossing below zero has preceded every modern recession. C&amp;I is the sharpest cyclical read — businesses stop borrowing before they stop hiring.
      </div>
    </div>

    {/* ── Loss cycle ── */}
    <SH>The Loss Cycle — Charge-Off Rates by Loan Type</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={270}>
        <LineChart data={lossChart.rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={50} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={x => `${x}%`} />
          <Tooltip contentStyle={chartTooltip} formatter={(x, n) => [`${x}%`, n]} labelFormatter={d => d.slice(0, 10)} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          {lossChart.keys.map(k => (
            <Line key={k.id} type="monotone" dataKey={k.id} name={k.label} stroke={k.color} strokeWidth={1.7} dot={false} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Annualized net charge-offs as % of loans (quarterly, ~40yrs — the 2009 peaks are the scale-setter). Cards run structurally high; the cycle signal is the <em>direction</em> of each line, not the level.
      </div>
    </div>

    {/* ── Big vs small banks ── */}
    <SH>Where the Stress Hides — Top-100 Banks vs Everyone Else</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(175px, 100%), 1fr))", gap: 10, marginBottom: 12 }}>
      {cardSplit[0] && <StatCard label="Card Charge-offs · Top 100" val={`${cardSplit[0].current.toFixed(2)}%`} sub={`1y chg ${cardSplit[0].chg1y >= 0 ? "+" : ""}${cardSplit[0].chg1y}`} color={GREEN} />}
      {cardSplit[1] && <StatCard label="Card Charge-offs · Small Banks" val={`${cardSplit[1].current.toFixed(2)}%`} sub={`1y chg ${cardSplit[1].chg1y >= 0 ? "+" : ""}${cardSplit[1].chg1y}`} color={RED} />}
      {cardSplit[0] && cardSplit[1] && <StatCard label="Small-Bank Premium" val={`${(cardSplit[1].current - cardSplit[0].current).toFixed(1)}pp`} sub="small minus large — the stress gap" color={AMBER} />}
    </div>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={splitChart.rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={50} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={x => `${x}%`} />
          <Tooltip contentStyle={chartTooltip} formatter={(x, n) => [`${x}%`, n]} labelFormatter={d => d.slice(0, 10)} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          {splitChart.keys.map(k => (
            <Line key={k.id} type="monotone" dataKey={k.id} name={k.label} stroke={k.color} strokeWidth={1.7} strokeDasharray={k.dash} dot={false} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Solid = credit cards, dashed = C&amp;I. When small-bank loss rates decouple upward from the top 100 (as in cards now), the weakest borrowers — who bank downmarket — are cracking first. That gap widening is how credit cycles start; it reaching the big banks is how they end.
      </div>
    </div>

    {/* ── Big-4 curation panel ── */}
    <SH>The Big 4&apos;s Own Confession — Provisions &amp; Reserves</SH>
    {BIG4_LOANBOOK.length > 0 ? (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead><tr>
            {["Bank", "Quarter", "Provisions", "Net Charge-offs", "Allowance", "ACL / Loans"].map((h, i) => (
              <th key={h} style={{ padding: "8px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", textAlign: i >= 2 ? "right" : "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {BIG4_LOANBOOK.map((r, i) => (
              <tr key={`${r.bank}-${r.q}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "7px 12px", fontSize: 11.5, fontFamily: fonts.heading, fontWeight: 700, color: "var(--text-primary)" }}>{r.bank}</td>
                <td style={{ padding: "7px 12px", fontSize: 10.5, fontFamily: fonts.mono, color: "#64748b" }}>{r.q}</td>
                <td style={{ padding: "7px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", color: "var(--text-primary)" }}>{r.provisions != null ? `$${r.provisions.toFixed(1)}B` : "—"}</td>
                <td style={{ padding: "7px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", color: "var(--text-secondary)" }}>{r.nco != null ? `$${r.nco.toFixed(1)}B` : "—"}</td>
                <td style={{ padding: "7px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", color: "var(--text-secondary)" }}>{r.allowance != null ? `$${r.allowance.toFixed(1)}B` : "—"}</td>
                <td style={{ padding: "7px 12px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", fontWeight: 600, color: "var(--text-primary)" }}>{r.allowance != null && r.loans ? `${(r.allowance / r.loans * 100).toFixed(2)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 20px", marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24", fontFamily: fonts.heading, marginBottom: 6 }}>⏳ Awaiting curation — by design, not by accident</div>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.6, maxWidth: 840 }}>
          Per-bank provisions and reserves can&apos;t be pulled reliably from any API on our plan (FMP&apos;s as-reported bank statements came back with Citi&apos;s total assets 6× too small — we won&apos;t show numbers like that). Instead: each earnings season (mid-Jan/Apr/Jul/Oct), ask Claude to pull JPM, BAC, WFC and C&apos;s provisions, net charge-offs, allowance and average loans from the earnings releases into <code style={{ color: "#a5b4fc" }}>BIG4_LOANBOOK</code> in BankCreditTab.jsx — four rows a quarter, sourced from the horse&apos;s mouth. The table and reserve-ratio math render automatically once filled.
        </div>
      </div>
    )}

    <InfoBox color="#818cf8">
      <strong style={{ color: "#cbd5e1" }}>The Eisman lens.</strong> Banks are the first to see credit deterioration — they watch every payment in the economy clear — and provisioning rules force them to <em>act</em> on what they see. So read this page top-down as a lie detector: the loan book says whether credit is flowing, charge-offs say what&apos;s already broken, the small-bank/big-bank gap says where it&apos;s breaking, and provisions (when curated) say what the best-informed lenders expect to break <em>next</em>. When all four agree with the Debt &amp; Credit tab&apos;s market spreads, trust the picture; when banks provision while spreads stay tight, trust the banks.
    </InfoBox>
  </>);
}
