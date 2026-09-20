import React, { useEffect, useMemo, useState } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, Line, LineChart, CartesianGrid, ReferenceLine, BarChart, Bar, Cell } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { SH, InfoBox } from "../../components/shared.jsx";

// ── formatting: values arrive in billions USD ──
const fmtB = (v, dp = 1) => {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1000) return `$${(v / 1000).toFixed(dp)}T`;
  return `$${v.toFixed(0)}B`;
};
const fmtAxis = v => Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `$${v.toFixed(0)}B`;
const fmtPct = v => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtMon = d => {
  if (!d) return "";
  const p = d.split("-");
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1] - 1] } '${p[0].slice(2)}`;
};

// Generic area chart for a single series (history = [{d, v}])
function LiqChart({ title, history, color = "#6366F1", height = 220, yFmt = fmtAxis, badge, refZero }) {
  if (!history?.length) return null;
  const tickInt = Math.max(0, Math.floor(history.length / 9) - 1);
  const gid = `liq-${title.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingLeft: 12, paddingRight: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{title}</div>
        {badge != null && <div style={{ fontSize: 10, color: badge >= 0 ? "#4ade80" : "#f87171", fontFamily: fonts.mono, fontWeight: 600 }}>YoY: {fmtPct(badge)}</div>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={history} margin={{ top: 5, right: 8, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={tickInt} tickFormatter={fmtMon} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={yFmt} width={62} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={fmtMon} formatter={v => [yFmt(v), title]} />
          {refZero && <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />}
          <Area type="monotone" dataKey="v" stroke={color} fill={`url(#${gid})`} strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Multi-line chart from several series, merged by date
function MultiLineChart({ title, seriesList, height = 280, yFmt = fmtAxis }) {
  const data = useMemo(() => {
    const byDate = new Map();
    seriesList.forEach(s => {
      (s.history || []).forEach(p => {
        if (!byDate.has(p.d)) byDate.set(p.d, { d: p.d });
        byDate.get(p.d)[s.key] = p.v;
      });
    });
    return [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d));
  }, [seriesList]);
  if (!data.length) return null;
  const tickInt = Math.max(0, Math.floor(data.length / 9) - 1);
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8, paddingLeft: 12 }}>{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={tickInt} tickFormatter={fmtMon} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={yFmt} width={62} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={fmtMon} formatter={(v, n) => [yFmt(v), n]} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
          {seriesList.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={s.strong ? 2.2 : 1.5} dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatTile({ label, val, sub, color }) {
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "14px 14px 0 0" }} />
      <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>{val}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, fontFamily: fonts.mono }}>{sub}</div>}
    </div>
  );
}

function LiquiditySubTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/global-liquidity")
      .then(r => r.json())
      .then(d => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading && !data) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading global liquidity &amp; debt data…</div>;
  if (error || !data?.series) return <InfoBox color="#F97316">Unable to load liquidity data — FRED may be temporarily unavailable.</InfoBox>;

  const s = data.series;
  const netLiq = data.netLiquidity || [];
  const netLiqLatest = netLiq.length ? netLiq[netLiq.length - 1] : null;
  const netLiqYoY = netLiq.length > 52 ? ((netLiqLatest.v - netLiq[netLiq.length - 53].v) / Math.abs(netLiq[netLiq.length - 53].v)) * 100 : null;
  const holders = data.holders;
  const interestShare = s.A091RC1Q027SBEA && s.GFDEBTN ? (s.A091RC1Q027SBEA.current / s.GFDEBTN.current) * 100 : null;

  // Big-3 central bank total
  const big3 = (s.WALCL?.current || 0) + (s.ECBASSETSW?.current || 0) + (s.JPNASSETS?.current || 0);

  return (<>
    {/* ════════ DOLLAR LIQUIDITY ════════ */}
    <SH>U.S. Dollar Liquidity — How Much Cash Is Available to Markets</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(165px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      <StatTile label="Net Liquidity" val={fmtB(netLiqLatest?.v)} sub={`YoY ${fmtPct(netLiqYoY)} · Fed B/S − RRP − TGA`} color="#10B981" />
      <StatTile label="Fed Balance Sheet" val={fmtB(s.WALCL?.current)} sub={`YoY ${fmtPct(s.WALCL?.yoy)}`} color="#E8553A" />
      <StatTile label="Reverse Repo (RRP)" val={fmtB(s.RRPONTSYD?.current)} sub="Drained — was $2.5T in 2022" color="#F59E0B" />
      <StatTile label="Treasury General Acct" val={fmtB(s.WTREGEN?.current)} sub={`YoY ${fmtPct(s.WTREGEN?.yoy)} · Gov's checking acct`} color="#8B5CF6" />
      <StatTile label="M2 Money Supply" val={fmtB(s.M2SL?.current)} sub={`YoY ${fmtPct(s.M2SL?.yoy)}`} color="#3B82F6" />
      <StatTile label="Broad Dollar Index" val={s.DTWEXBGS?.current?.toFixed(1) ?? "—"} sub={`YoY ${fmtPct(s.DTWEXBGS?.yoy)} · higher = stronger $`} color="#14B8A6" />
    </div>

    <LiqChart title="Net Liquidity (Fed Balance Sheet − RRP − TGA, weekly)" history={netLiq} color="#10B981" height={260} badge={netLiqYoY} />
    <InfoBox color="#10B981">
      <strong style={{ color: "var(--text-primary)" }}>Why net liquidity matters.</strong> The Fed&apos;s balance sheet is gross dollars created, but two big buckets sit <em>outside</em> markets: the reverse-repo facility (money funds parking cash at the Fed) and the Treasury General Account (the government&apos;s checking account). What&apos;s left — net liquidity — is the cash actually sloshing through the financial system, and it correlates tightly with risk-asset performance. RRP is now essentially <strong>fully drained</strong> (~$0.4B vs $2.5T at the 2022 peak), which removed the market&apos;s biggest liquidity cushion: from here, any Fed tightening or TGA rebuild bites markets directly.
    </InfoBox>

    <MultiLineChart
      title="The Three Components (weekly, billions USD)"
      seriesList={[
        { key: "fed", label: "Fed Balance Sheet", color: "#E8553A", history: s.WALCL?.history, strong: true },
        { key: "rrp", label: "Reverse Repo", color: "#F59E0B", history: s.RRPONTSYD?.history },
        { key: "tga", label: "Treasury General Acct", color: "#8B5CF6", history: s.WTREGEN?.history },
      ]}
    />

    {/* ════════ WHERE THE WORLD'S CASH SITS ════════ */}
    <SH>Where the Cash Sits — Big-3 Central Banks &amp; Money Stock</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(165px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      <StatTile label="Big-3 Central Banks" val={fmtB(big3)} sub="Fed + ECB + BOJ combined" color="#6366F1" />
      <StatTile label="ECB Balance Sheet" val={fmtB(s.ECBASSETSW?.current)} sub={`In USD @ ${data.fx?.eurUsd?.toFixed(3)} EURUSD`} color="#3B82F6" />
      <StatTile label="BOJ Balance Sheet" val={fmtB(s.JPNASSETS?.current)} sub={`In USD @ ${data.fx?.usdJpy?.toFixed(0)} USDJPY`} color="#EC4899" />
      <StatTile label="Bank Reserves" val={fmtB(s.WRESBAL?.current)} sub={`YoY ${fmtPct(s.WRESBAL?.yoy)} · at the Fed`} color="#F97316" />
      <StatTile label="Physical Currency" val={fmtB(s.CURRCIR?.current)} sub="Notes & coins in circulation" color="#84CC16" />
    </div>

    <MultiLineChart
      title="Central Bank Balance Sheets in USD (Fed weekly, ECB weekly, BOJ monthly)"
      seriesList={[
        { key: "fed", label: "Federal Reserve", color: "#E8553A", history: s.WALCL?.history, strong: true },
        { key: "ecb", label: "ECB (USD)", color: "#3B82F6", history: s.ECBASSETSW?.history },
        { key: "boj", label: "Bank of Japan (USD)", color: "#EC4899", history: s.JPNASSETS?.history },
      ]}
    />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <LiqChart title="M2 Money Supply (monthly)" history={s.M2SL?.history} color="#3B82F6" badge={s.M2SL?.yoy} />
      <LiqChart title="Bank Reserves at the Fed (weekly)" history={s.WRESBAL?.history} color="#F97316" badge={s.WRESBAL?.yoy} />
    </div>
    <InfoBox color="#3B82F6">
      <strong style={{ color: "var(--text-primary)" }}>Reading the central-bank chart.</strong> ECB and BOJ are converted at today&apos;s FX rates, so currency swings move the lines as much as actual policy. The structural story: all three printed massively in 2020–21, then shrank (QT). When the combined line turns up again, that&apos;s the global liquidity spigot reopening — historically the strongest tailwind for risk assets, gold, and crypto.
    </InfoBox>

    {/* ════════ THE DEBT ════════ */}
    <SH>U.S. Debt — How Much, and What It Costs</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(165px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      <StatTile label="Federal Debt" val={fmtB(s.GFDEBTN?.current)} sub={`YoY ${fmtPct(s.GFDEBTN?.yoy)}`} color="#EF4444" />
      <StatTile label="Debt / GDP" val={s.GFDEGDQ188S?.current != null ? `${s.GFDEGDQ188S.current.toFixed(0)}%` : "—"} sub="Above 120% — WWII territory" color="#F97316" />
      <StatTile label="Annual Interest Cost" val={fmtB(s.A091RC1Q027SBEA?.current)} sub={`YoY ${fmtPct(s.A091RC1Q027SBEA?.yoy)} · annualized`} color="#F59E0B" />
      <StatTile label="Avg Rate on Debt" val={interestShare != null ? `${interestShare.toFixed(2)}%` : "—"} sub="Interest ÷ total debt" color="#8B5CF6" />
      <StatTile label="Household Debt" val={fmtB(s.CMDEBT?.current)} sub={`YoY ${fmtPct(s.CMDEBT?.yoy)}`} color="#3B82F6" />
      <StatTile label="Corporate Debt" val={fmtB(s.BCNSDODNS?.current)} sub={`YoY ${fmtPct(s.BCNSDODNS?.yoy)} · nonfinancial`} color="#10B981" />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <LiqChart title="Federal Debt Total (quarterly)" history={s.GFDEBTN?.history} color="#EF4444" badge={s.GFDEBTN?.yoy} />
      <LiqChart title="Federal Interest Payments (annualized, quarterly)" history={s.A091RC1Q027SBEA?.history} color="#F59E0B" badge={s.A091RC1Q027SBEA?.yoy} />
    </div>
    <LiqChart title="Federal Debt as % of GDP" history={s.GFDEGDQ188S?.history} color="#F97316" height={200} yFmt={v => `${v.toFixed(0)}%`} />

    {/* ════════ WHO IS LENDING ════════ */}
    <SH>Who Is Lending to the U.S. Government</SH>
    {holders && (<>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
          Holders of ${(holders.total / 1000).toFixed(1)}T Federal Debt · {holders.asOf}
        </div>
        {/* proportional bar */}
        <div style={{ display: "flex", height: 34, borderRadius: 8, overflow: "hidden", margin: "12px 0 10px" }}>
          {holders.breakdown.map(b => (
            <div key={b.name} title={`${b.name}: ${fmtB(b.value)}`} style={{ width: `${(b.value / holders.total) * 100}%`, background: b.color, position: "relative" }} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))", gap: 8 }}>
          {holders.breakdown.map(b => (
            <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: b.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, flex: 1 }}>{b.name}</span>
              <span style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.mono, fontWeight: 700 }}>{fmtB(b.value)}</span>
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono }}>{((b.value / holders.total) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>

      <MultiLineChart
        title="Major Holder Categories Over Time (quarterly, billions USD)"
        seriesList={[
          { key: "foreign", label: "Foreign Investors", color: "#3B82F6", history: s.FDHBFIN?.history, strong: true },
          { key: "fed", label: "Federal Reserve", color: "#E8553A", history: s.FDHBFRBN?.history },
          { key: "trusts", label: "US Gov Trust Funds", color: "#8B5CF6", history: s.FDHBATN?.history },
        ]}
      />
    </>)}

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <LiqChart title="Household Debt (quarterly)" history={s.CMDEBT?.history} color="#3B82F6" badge={s.CMDEBT?.yoy} />
      <LiqChart title="Nonfinancial Corporate Debt (quarterly)" history={s.BCNSDODNS?.history} color="#10B981" badge={s.BCNSDODNS?.yoy} />
    </div>

    <InfoBox color="#EF4444">
      <strong style={{ color: "var(--text-primary)" }}>The debt math that matters.</strong> The US now pays <strong>{fmtB(s.A091RC1Q027SBEA?.current)}/yr in interest</strong> — more than the defense budget — and the largest single lender bloc is no longer foreigners or the Fed but <strong>US private investors</strong> (banks, money funds, pensions, households). Watch two things: (1) the <em>foreign</em> line flattening while total debt grows ~6%/yr means domestic buyers must absorb ever more issuance, which pressures yields; (2) the Fed&apos;s holdings shrinking (QT) adds to that supply. If both persist, the path of least resistance is higher term premium — or the Fed restarting purchases, which would show up in the net-liquidity chart above.
    </InfoBox>

    <InfoBox color="#8B5CF6">
      <strong style={{ color: "var(--text-primary)" }}>Sources &amp; units.</strong> All series from FRED (Federal Reserve H.4.1, Treasury, BEA, Z.1 Financial Accounts). ECB and BOJ balance sheets converted to USD at live FX rates ({data.fx?.eurUsd?.toFixed(3)} EURUSD, {data.fx?.usdJpy?.toFixed(1)} USDJPY) — currency moves shift those lines independently of policy. Quarterly debt data lags one to two quarters. Cached 4 hours; force-refresh via <code style={{ color: "#a5b4fc" }}>/api/global-liquidity?refresh=1</code>.
    </InfoBox>
  </>);
}

export default LiquiditySubTab;
