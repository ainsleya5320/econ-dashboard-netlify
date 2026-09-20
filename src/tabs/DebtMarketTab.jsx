import React, { useEffect, useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import DAMODARAN from "../lib/damodaran.json";

// Damodaran synthetic rating: interest coverage → rating → default spread
// (large non-financial firm table from ratings.xls, updated each January).
const ratingFor = (coverage) => {
  if (coverage == null || !isFinite(coverage)) return null;
  const bands = DAMODARAN.ratings?.large || [];
  const b = bands.find(b => coverage > b.min && coverage <= b.max);
  return b ? { rating: b.rating.split("/")[1] || b.rating, spread: b.spread } : null;
};
const ratingColor = (r) => !r ? "#475569" : /^A/.test(r) ? "#4ade80" : /^BBB|^BB\+/.test(r) ? "#fbbf24" : "#f87171";

/*
 * DebtMarketTab — what is credit priced for, and can corporates carry it?
 * Thesis: spreads are the market's default forecast; coverage is the
 * fundamentals' rebuttal. Stress starts where refi cost crosses coverage.
 * Data: /api/debt-market (FRED spreads + Z.1 coverage + FMP basket).
 * NOTE: ICE BofA series on FRED are license-capped to ~3 years of history,
 * so long-history percentiles come from BAA10Y (Moody's, 1987→).
 */

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8";
const HY_C = "#F59E0B", IG_C = "#818cf8", BAA_C = "#a78bfa", COV_C = "#4ade80";
const TONE_C = { green: GREEN, amber: AMBER, red: RED };

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

function WarnTile({ label, value, sub, pct, spark, tone, note }) {
  const c = TONE_C[tone] || INDIGO;
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", minWidth: 0, borderLeft: `3px solid ${c}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {pct != null && <span style={{ fontSize: 9, color: "#a5b4fc", fontFamily: fonts.mono, whiteSpace: "nowrap" }}>{pct}th %ile</span>}
      </div>
      <div style={{ fontSize: 21, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3, lineHeight: 1.1 }}>
        {value} {note && <span style={{ fontWeight: 400, color: c, fontSize: 10, fontFamily: fonts.mono }}>{note}</span>}
      </div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      <div style={{ marginTop: 6 }}><Spark values={spark} color={c} /></div>
    </div>
  );
}

const chartTooltip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axisTick = { fill: "#475569", fontSize: 9, fontFamily: fonts.mono };

function DebtMarketTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = (force = false) => {
    setLoading(true);
    fetch(`/api/debt-market${force ? "?refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => { setData(d); setError(!!d.error); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(false); }, []);

  // Refi squeeze: forward-fill quarterly coverage onto the weekly HY-yield grid
  const squeeze = useMemo(() => {
    const hy = data?.squeeze?.hyYield || [];
    const cov = data?.squeeze?.coverage || [];
    if (!hy.length) return null;
    let ci = 0, last = null;
    return hy.map(o => {
      while (ci < cov.length && cov[ci].d <= o.d) { last = cov[ci].v; ci++; }
      return { d: o.d, yld: o.v, cov: last };
    });
  }, [data]);

  if (loading && !data) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading debt market…</div>;
  if (error || !data?.verdict) return <InfoBox color="#F97316">Unable to load debt-market data — FRED may be temporarily unavailable.</InfoBox>;

  const v = data.verdict, sp = data.spreads, sq = data.squeeze, w = data.warning, b = data.basket;

  const verdictBlurb =
    v.label === "Priced for Perfection" ? `High-yield spreads at ${v.hy?.toFixed(2)}% pay near the least in ${sp.baa.since ? `~${new Date().getFullYear() - +sp.baa.since} years` : "decades"} for default risk (Baa−10Y at the ${v.baaPct}th percentile since ${sp.baa.since}). Nothing is breaking — but nothing is priced to break, so the risk in credit is asymmetric: little upside in spread compression left, a full repricing below.`
    : v.label === "Credit Stress" ? `High-yield spreads at ${v.hy?.toFixed(2)}% are at levels historically associated with default cycles. Credit markets are pricing real distress.`
    : v.label === "Stress Building" ? `High-yield spreads at ${v.hy?.toFixed(2)}%${v.d3m > 0 ? `, up ${v.d3m.toFixed(2)}pp in three months` : ""} — the market is beginning to charge for default risk again. Watch the early-warning tiles below for confirmation.`
    : `High-yield spreads at ${v.hy?.toFixed(2)}% are in their normal range — credit is neither complacent nor stressed.`;

  // Early-warning tones (SLOOS: net % of banks tightening C&I standards)
  const sloosTone = w.sloos == null ? null : w.sloos.current >= 20 ? "red" : w.sloos.current > 5 ? "amber" : "green";
  const delinqTone = w.delinq == null ? null : w.delinq.current >= 2.5 ? "red" : w.delinq.current >= 1.75 ? "amber" : "green";

  return (<>
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
      <button onClick={() => load(true)} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono }}>↻ Refresh</button>
    </div>

    {/* Verdict banner */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: v.color }} />
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>The Credit Market</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: v.color, fontFamily: fonts.heading, letterSpacing: -0.5 }}>{v.label}</span>
        <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono }}>
          HY OAS {v.hy?.toFixed(2)}% · IG {sp.ig.current?.toFixed(2)}% · Baa−10Y p{v.baaPct} since {sp.baa.since} · 3m {v.d3m >= 0 ? "+" : ""}{v.d3m?.toFixed(2)}pp · as of {v.asOf}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", fontFamily: fonts.mono, marginTop: 6, maxWidth: 820, lineHeight: 1.5 }}>{verdictBlurb}</div>
    </div>

    {/* Spread charts: HY vs IG (3y window — FRED/ICE license cap) + Baa−10Y long history */}
    <SH>Credit Spreads — What the Market Charges for Default Risk</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 14, marginBottom: 18 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, paddingLeft: 12, marginBottom: 4 }}>
          HY vs IG option-adjusted spread (weekly · since {sp.since}, the window FRED licenses for ICE data)
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={sp.weekly} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={axisTick} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor((sp.weekly?.length || 0) / 7) - 1)} tickFormatter={d => d.slice(0, 7)} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={x => `${x}%`} />
            <Tooltip contentStyle={chartTooltip} formatter={(x, n) => [`${x}%`, n]} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={7} />
            <Line type="monotone" dataKey="hy" name="High-yield OAS" stroke={HY_C} strokeWidth={2.2} dot={false} connectNulls />
            <Line type="monotone" dataKey="ig" name="Investment-grade OAS" stroke={IG_C} strokeWidth={1.8} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, paddingLeft: 12, marginBottom: 4 }}>
          Baa − 10Y Treasury spread (weekly · since {sp.baa.since} — the long-history percentile source) · now p{sp.baa.pct}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={sp.baa.weekly} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={axisTick} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor((sp.baa.weekly?.length || 0) / 7) - 1)} tickFormatter={d => d.slice(0, 4)} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={x => `${x}%`} domain={[0, "auto"]} />
            <Tooltip contentStyle={chartTooltip} formatter={x => [`${x}%`, "Baa − 10Y"]} />
            <ReferenceLine y={sp.baa.current} stroke={BAA_C} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="v" name="Baa − 10Y" stroke={BAA_C} strokeWidth={1.4} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>

    {/* Refi squeeze */}
    <SH>The Refi Squeeze — Cost of New Debt vs Ability to Carry It</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 18 }}>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={squeeze || []} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={axisTick} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor((squeeze?.length || 0) / 8) - 1)} tickFormatter={d => d.slice(0, 7)} />
          <YAxis yAxisId="y" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={x => `${x}%`} />
          <YAxis yAxisId="c" orientation="right" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={x => `${x}×`} />
          <Tooltip contentStyle={chartTooltip} formatter={(x, n) => [n.includes("coverage") ? `${x}×` : `${x}%`, n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <Line yAxisId="y" type="monotone" dataKey="yld" name="HY effective yield (refi cost)" stroke={HY_C} strokeWidth={2.2} dot={false} connectNulls />
          <Line yAxisId="c" type="stepAfter" dataKey="cov" name="Aggregate interest coverage (EBIT-proxy ÷ interest)" stroke={COV_C} strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Amber = what it costs a high-yield issuer to refinance today ({sq.hyYieldCur?.toFixed(2)}%). Green = how many times over U.S. nonfinancial corporates as a whole can pay their interest bill ({sq.coverageCur?.toFixed(1)}×, {sq.coveragePct}th percentile since 1947 — coverage proxy: (pre-tax profits + interest paid) ÷ interest paid, BEA + Fed Z.1, quarterly, forward-filled). The scissors to watch: rising amber against falling green means maturing debt rolls into rates the income can&apos;t carry.
      </div>
    </div>

    {/* Early-warning tiles */}
    <SH>Early Warning — What Leads the Default Cycle</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: 10, marginBottom: 18 }}>
      {w.sloos && <WarnTile label="Banks Tightening C&I" value={`${w.sloos.current?.toFixed(1)}%`} note={sloosTone === "green" ? "easy" : sloosTone === "amber" ? "tightening" : "credit crunch"} sub={`SLOOS net % · leads defaults 2–4q · ${w.sloos.lastDate.slice(0, 7)}`} pct={w.sloos.pct} spark={w.sloos.spark} tone={sloosTone} />}
      {w.delinq && <WarnTile label="C&I Delinquency" value={`${w.delinq.current?.toFixed(2)}%`} note={delinqTone === "green" ? "low" : delinqTone === "amber" ? "creeping" : "elevated"} sub={`bank business loans · ${w.delinq.lastDate.slice(0, 7)}`} pct={w.delinq.pct} spark={w.delinq.spark} tone={delinqTone} />}
      {data.rates?.fedfunds && <WarnTile label="Fed Funds" value={`${data.rates.fedfunds.current?.toFixed(2)}%`} sub="the base of every borrowing cost" pct={data.rates.fedfunds.pct} spark={data.rates.fedfunds.spark} />}
      {data.rates?.dgs10 && <WarnTile label="10Y Treasury" value={`${data.rates.dgs10.current?.toFixed(2)}%`} sub="the IG refi benchmark" pct={data.rates.dgs10.pct} spark={data.rates.dgs10.spark} />}
    </div>

    {/* Basket fundamentals */}
    <SH>Corporate Balance Sheets — {b.size}-Name Non-Financial Basket (FMP, annual)</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 14, marginBottom: 16 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, paddingLeft: 12, marginBottom: 4 }}>
          Median interest coverage &amp; net debt / EBITDA by fiscal year
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={b.byYear} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="fy" tick={axisTick} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} />
            <YAxis yAxisId="cov" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={x => `${x}×`} />
            <YAxis yAxisId="nde" orientation="right" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={x => `${x}×`} />
            <Tooltip contentStyle={chartTooltip} formatter={(x, n) => [`${x}×`, n]} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={7} />
            <Line yAxisId="cov" type="monotone" dataKey="coverage" name="Median coverage" stroke={COV_C} strokeWidth={2.2} dot={{ r: 3 }} connectNulls />
            <Line yAxisId="nde" type="monotone" dataKey="netDebtToEbitda" name="Median net debt/EBITDA" stroke={RED} strokeWidth={1.8} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto" }}>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, padding: "12px 14px 4px" }}>
          Thinnest coverage in the basket (latest fiscal year)
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            {["Ticker", "FY", "Coverage", "Synthetic Rating", "Implied Spread", "Net Debt/EBITDA"].map((h, i) => (
              <th key={h} style={{ padding: "7px 14px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", textAlign: i >= 2 ? "right" : "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {(b.rows || []).slice(0, 8).map((r, i, arr) => {
              const syn = ratingFor(r.coverage);
              return (
                <tr key={r.t} style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ padding: "6px 14px", fontSize: 11.5, fontFamily: fonts.heading, color: "var(--text-primary)", fontWeight: 600 }}>{r.t}</td>
                  <td style={{ padding: "6px 14px", fontSize: 10.5, fontFamily: fonts.mono, color: "#64748b" }}>{r.fy}</td>
                  <td style={{ padding: "6px 14px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", fontWeight: 600, color: r.coverage == null ? "#475569" : r.coverage < 3 ? RED : r.coverage < 6 ? AMBER : GREEN }}>{r.coverage != null ? `${r.coverage.toFixed(1)}×` : "—"}</td>
                  <td style={{ padding: "6px 14px", fontSize: 11.5, fontFamily: fonts.mono, textAlign: "right", fontWeight: 700, color: ratingColor(syn?.rating) }}>{syn?.rating ?? "—"}</td>
                  <td style={{ padding: "6px 14px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: syn ? "var(--text-secondary)" : "#475569" }}>{syn ? `+${(syn.spread * 100).toFixed(2)}pp` : "—"}</td>
                  <td style={{ padding: "6px 14px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: r.netDebtToEbitda == null ? "#475569" : r.netDebtToEbitda > 3 ? RED : "var(--text-secondary)" }}>{r.netDebtToEbitda != null ? `${r.netDebtToEbitda.toFixed(1)}×` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {b.latest && <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "8px 14px", lineHeight: 1.5 }}>
          Basket medians FY{b.latest.fy}: coverage {b.latest.coverage?.toFixed(1)}×, net debt/EBITDA {b.latest.netDebtToEbitda?.toFixed(1)}× ({b.latest.n} filers). <strong style={{ color: "#94a3b8" }}>Synthetic rating</strong> = Damodaran&apos;s coverage→rating map (large non-financial firms, Jan {(DAMODARAN.asOf || "").slice(0, 4)}); implied spread is the default premium over treasuries that rating carries — coverage + spread = a fundamentals-based cost of debt, no agency required. Caveat: one ratio, not a full credit model; agencies weigh scale, industry and cash-flow stability too. Annual data; nulls = issuers that don&apos;t break out interest expense.
        </div>}
      </div>
    </div>

    <InfoBox color="#a78bfa">
      <strong style={{ color: "var(--text-primary)" }}>Reading the debt market.</strong>
      &nbsp;<strong>Spreads</strong> are the market&apos;s live default forecast — tight spreads mean investors demand almost nothing for credit risk, which says more about positioning than about safety.
      &nbsp;The <strong>refi squeeze</strong> is the mechanism by which high rates actually bite: not on day one, but as cheap 2020-21 debt matures into today&apos;s yields.
      &nbsp;<strong>SLOOS tightening</strong> is the best forward indicator in credit — banks pull back 2–4 quarters before defaults show up; <strong>delinquencies</strong> confirm the cycle has arrived.
      &nbsp;The <strong>basket</strong> grounds it in filings: median coverage near 9× means large caps can carry current rates — the stress, when it comes, starts in the leveraged tail (utilities, telecom, anyone below 3×).
      &nbsp;FRED + BEA/Z.1 + FMP; cached 4 hours.
    </InfoBox>
  </>);
}

export default DebtMarketTab;
