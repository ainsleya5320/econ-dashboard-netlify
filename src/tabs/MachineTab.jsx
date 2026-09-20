import React, { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";

// ============================================================================
// THE ECONOMIC MACHINE — Ray Dalio's framework as a live tracker
// Header: the three cycles (productivity trend, short-term debt cycle stage,
// long-term debt cycle stage) and the three rules of thumb as pass/fail.
// Sections: productivity (per-capita GDP vs trend, output gap), the short
// cycle as Dalio's five-stage sequence with the conditions each stage needs
// (the stage with the most met is where we are), and the long cycle (total
// debt vs GDP since 1951, the beautiful-deleveraging test, the four levers,
// gold as the monetization gauge). Data: /api/machine (FRED + Yahoo gold).
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", GOLD = "#facc15";
const TONE = { green: GREEN, amber: AMBER, red: RED };
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const pc = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}%` : "—");
const pc0 = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
const pp = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}pp` : "—");
const STATUS = { pass: { c: GREEN, t: "PASS" }, watch: { c: AMBER, t: "WATCH" }, fail: { c: RED, t: "FAIL" }, "n/a": { c: SLATE, t: "N/A" } };
const SETTING = { heavy: RED, light: AMBER, off: SLATE, "reverse (QT)": CYAN, "n/a": DIM };

function Dial({ name, big, tone, sub }) {
  const c = TONE[tone] || SLATE;
  return (
    <div style={{ flex: "1 1 170px", minWidth: 170, borderLeft: `3px solid ${c}`, paddingLeft: 10 }}>
      <div style={label}>{name}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: c, fontFamily: fonts.heading, letterSpacing: -0.4, lineHeight: 1.15, marginTop: 3 }}>{big}</div>
      <div style={{ ...note, marginTop: 3 }}>{sub}</div>
    </div>
  );
}
function Board({ rows }) {
  return (
    <div style={{ ...card, padding: "6px 8px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} title={r.title || ""} style={{ borderBottom: "1px solid rgba(255,255,255,0.035)" }}>
              <td style={{ padding: "4px 6px", width: 14 }}>{r.tone && <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: TONE[r.tone] || SLATE, boxShadow: `0 0 6px ${TONE[r.tone] || SLATE}66` }} />}</td>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "#cbd5e1", whiteSpace: "nowrap" }}>{r.label}</td>
              <td style={{ padding: "4px 6px", fontSize: 11, fontFamily: fonts.mono, fontWeight: 700, color: r.color || "var(--text-primary)", textAlign: "right", whiteSpace: "nowrap" }}>{r.value}</td>
              <td style={{ padding: "4px 6px", fontSize: 9.5, fontFamily: fonts.mono, color: DIM, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>{r.sub}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Verdict({ label: l, tone, why, extra }) {
  const c = TONE[tone] || SLATE;
  return (
    <div style={{ ...card, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: c }} />
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c, fontFamily: fonts.heading, letterSpacing: -0.3 }}>{l}</div>
      <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 5, lineHeight: 1.5 }}>{why}</div>
      {extra}
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
const yr = x => String(x).slice(0, 4);

function MachineTab() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { fetch("/api/machine").then(r => r.json()).then(x => (x && !x.error ? setD(x) : setErr(x?.error || "unavailable"))).catch(e => setErr(e.message)); }, []);
  if (err) return <div style={{ ...card, color: RED, fontFamily: fonts.mono, fontSize: 12 }}>The Economic Machine is unavailable: {err}</div>;
  if (!d) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading the machine (26 FRED series — about 20 seconds the first time, then cached)…</div>;
  const P = d.productivity, S = d.shortCycle, L = d.longCycle, I = S.inputs, M = L.monetization, W = L.wealth;
  const stageIdx = S.stages.findIndex(s => s.key === S.stage);
  const shortTone = S.stage === "contraction" ? "red" : S.stage === "tightening" || S.stage === "late" ? "amber" : "green";
  const longTone = L.beautiful.tone;
  const Section = ({ title, sub, children }) => (<><SH>{title}</SH>{sub && <div style={{ ...note, marginTop: -8, marginBottom: 8 }}>{sub}</div>}{children}</>);

  return (<>
    {/* header: the three cycles and the three rules */}
    <div style={{ ...card, padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div><span style={label}>The economic machine · Dalio</span><div style={{ fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 3 }}>Three forces drive the economy: productivity growth, the short-term debt cycle, the long-term debt cycle. Where each one is, today.</div></div>
        <span style={note}>FRED, Yahoo gold · refreshed {new Date(d.updated).toLocaleString()}</span>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12 }}>
        <Dial name="Productivity trend" big={P.label} tone={P.tone} sub={`output per hour ${pc(P.ophYoy)} YoY · ${pc0(P.oph5y)}/yr over 5 yrs`} />
        <Dial name="Short-term debt cycle" big={S.name} tone={shortTone} sub={`stage ${stageIdx + 1} of 5 in Dalio's sequence · ${S.stages[stageIdx].met}/${S.stages[stageIdx].known} conditions met`} />
        <Dial name="Long-term debt cycle" big={`${L.stage} · ${L.beautiful.label}`} tone={longTone} sub={`total debt ${pc0(L.debtGdp, 0)} of GDP · nominal growth ${pc0(L.nominalGrowth)} vs ${pc0(L.effRate, 2)} paid on federal debt`} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8, marginTop: 14 }}>
        {d.rules.map(r => { const s = STATUS[r.status] || STATUS["n/a"]; return (
          <div key={r.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "8px 10px" }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: s.c, fontFamily: fonts.mono, border: `1px solid ${s.c}66`, borderRadius: 5, padding: "2px 6px", flexShrink: 0 }}>{s.t}</span>
            <div><div style={{ fontSize: 10.5, color: "#e2e8f0", fontFamily: fonts.mono, fontWeight: 600 }}>{r.text}</div><div style={note}>{r.detail}</div></div>
          </div>); })}
      </div>
    </div>

    <Section title="1 · Productivity — The Line Everything Else Oscillates Around" sub="Over the long run, living standards rise with productivity; the credit cycles are swings around this line, not the line itself.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <Board rows={[
            { label: "Output per hour, YoY", value: pc(P.ophYoy), tone: P.ophYoy >= 1.5 ? "green" : P.ophYoy >= 0.5 ? "amber" : "red", sub: `nonfarm business · ${P.ophAsOf}` },
            { label: "Productivity, 5-yr / 10-yr", value: `${pc0(P.oph5y)} / ${pc0(P.oph10y)}`, tone: P.tone, sub: `annualized · 20-yr average ${pc0(P.oph20yAvg)}` },
            { label: "Real GDP per person", value: fin(P.perCapita.now) ? `$${Math.round(P.perCapita.now).toLocaleString()}` : "—", tone: P.perCapita.gapVsTrend >= 0 ? "green" : "amber", sub: `${pc(P.perCapita.yoy)} YoY · ${pc(P.perCapita.gapVsTrend)} vs ${pc0(P.perCapita.trendGrowth, 2)}/yr trend since ${P.perCapita.since}` },
            { label: "Output gap", value: pc(P.outputGap), tone: P.outputGap > 1 ? "amber" : P.outputGap > -1 ? "green" : "red", sub: `real GDP vs CBO potential · ${P.outputGapAsOf}`, title: "Positive = running above capacity, which is where inflation is born in Dalio's sequence" },
            { label: "Real GDP, YoY", value: pc(P.realGdpYoy), tone: P.realGdpYoy > 1.5 ? "green" : P.realGdpYoy > 0 ? "amber" : "red", sub: "" },
            { label: "Unit labor costs, YoY", value: pc(P.ulcYoy), tone: P.ulcYoy <= 2.5 ? "green" : P.ulcYoy <= 4 ? "amber" : "red", sub: `real compensation per hour ${pc(P.compYoy)} YoY`, title: "Rule 2: income should not rise faster than productivity" },
          ]} />
          <Verdict label={P.label} tone={P.tone} why={P.why} />
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {chartBox(`Real GDP per person vs its fitted trend (log scale, since ${P.perCapita.since})`,
            <ResponsiveContainer width="100%" height={200}><LineChart data={d.charts.perCapita} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={yr} minTickGap={40} axisLine={false} tickLine={false} /><YAxis scale="log" domain={["auto", "auto"]} tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v / 1000)}K`} width={44} />
              <Tooltip contentStyle={tip} formatter={(v, n) => [`$${Number(v).toLocaleString()}`, n]} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" />
              <Line type="monotone" dataKey="actual" name="Real GDP per person" stroke={INDIGO} strokeWidth={1.8} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="trend" name="Trend" stroke={SLATE} strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </LineChart></ResponsiveContainer>,
            "Dalio's straight line. The 2008 gap never fully closed; whether AI bends the line up is the productivity question of the decade.")}
          {chartBox("Output gap — real GDP vs CBO potential (%)",
            <ResponsiveContainer width="100%" height={130}><ComposedChart data={d.charts.outputGap} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={yr} minTickGap={40} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={tip} formatter={v => [`${v}%`, "gap"]} /><ReferenceLine y={0} stroke="#94a3b8" strokeOpacity={0.5} />
              <Area type="monotone" dataKey="v" stroke={CYAN} fill={CYAN} fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
            </ComposedChart></ResponsiveContainer>,
            "Above zero the economy runs hot and inflation follows; the deep negatives are the recessions.")}
        </div>
      </div>
    </Section>

    <Section title="2 · The Short-Term Debt Cycle — Where We Are in the Sequence" sub="Dalio's loop: credit expands → spending and incomes rise → inflation → the central bank tightens → spending falls → easing → repeat. Each stage lists the conditions it needs; the one with the most met is highlighted.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
        {S.stages.map((s, i) => { const on = s.key === S.stage; const c = on ? TONE[shortTone] : "rgba(255,255,255,0.08)"; return (
          <div key={s.key} style={{ ...card, padding: "10px 12px", border: `1px solid ${on ? TONE[shortTone] + "88" : "rgba(255,255,255,0.06)"}`, background: on ? `${TONE[shortTone]}12` : cardBg }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ ...label, color: on ? TONE[shortTone] : "#64748b" }}>{i + 1} · {s.name}</span><span style={{ fontSize: 10, fontFamily: fonts.mono, fontWeight: 700, color: on ? TONE[shortTone] : DIM }}>{s.met}/{s.known}</span></div>
            <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", margin: "6px 0" }}><div style={{ width: `${s.known ? (s.met / s.known) * 100 : 0}%`, height: "100%", borderRadius: 2, background: on ? TONE[shortTone] : SLATE, opacity: on ? 0.9 : 0.5 }} /></div>
            {s.checks.map(ch => <div key={ch.text} style={{ fontSize: 9.5, fontFamily: fonts.mono, color: ch.met == null ? DIM : ch.met ? "#cbd5e1" : "#64748b", lineHeight: 1.45 }}><span style={{ color: ch.met == null ? DIM : ch.met ? GREEN : RED, marginRight: 4 }}>{ch.met == null ? "·" : ch.met ? "✓" : "✗"}</span>{ch.text}</div>)}
            <div style={{ ...note, marginTop: 6, fontStyle: "italic" }}>{s.dalio}</div>
          </div>); })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12, marginBottom: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <Board rows={[
            { label: "Total credit growth, YoY", value: pc(I.creditYoy), tone: I.creditYoy > I.nominalYoy + 1 ? "amber" : "green", sub: `all sectors · a year ago ${pc(I.creditYrAgo)}`, title: "Credit is the engine of the short cycle: when it grows faster than income, the cycle is maturing" },
            { label: "Nominal GDP growth, YoY", value: pc(I.nominalYoy), tone: I.nominalYoy > 3 ? "green" : I.nominalYoy > 0 ? "amber" : "red", sub: `spending = income · a year ago ${pc(I.nominalYrAgo)}` },
            { label: "Core PCE inflation", value: pc0(I.corePce), tone: I.corePce <= 2.5 ? "green" : I.corePce <= 3.5 ? "amber" : "red", sub: `six months ago ${pc0(I.corePce6m)} · target 2%` },
            { label: "Fed funds", value: pc0(I.ffr, 2), tone: I.ffrChg12 >= 0.25 ? "amber" : "green", sub: `${pp(I.ffrChg12, 2)} over 12 months` },
            { label: "Real policy rate", value: pp(I.realPolicy, 2), tone: I.realPolicy > 1.5 ? "red" : I.realPolicy > 0.5 ? "amber" : "green", sub: "fed funds minus core PCE" },
            { label: "Yield curve 10y−3m", value: pp(I.curve, 2), tone: I.curve < 0 ? "red" : I.curve < 0.5 ? "amber" : "green", sub: `six months ago ${pp(I.curve6m, 2)}` },
            { label: "Unemployment", value: pc0(I.unemp), tone: I.unempChg12 >= 0.3 ? "red" : I.unempChg12 > 0 ? "amber" : "green", sub: `${pp(I.unempChg12)} over 12 months · Sahm ${fin(I.sahm) ? I.sahm.toFixed(2) : "—"}` },
            { label: "Output gap", value: pc(I.outputGap), tone: I.outputGap > 1 ? "amber" : "green", sub: "capacity check" },
          ]} />
          <Verdict label={S.name} tone={shortTone} why={S.why} />
        </div>
        {chartBox("Credit growth vs income growth, with the Fed funds rate (%, since 1960)",
          <ResponsiveContainer width="100%" height={290}><ComposedChart data={d.charts.credit} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={yr} minTickGap={40} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} /><YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [`${Number(v).toFixed(1)}%`, n]} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" /><ReferenceLine yAxisId="l" y={0} stroke="#94a3b8" strokeOpacity={0.5} />
            <Area yAxisId="r" type="monotone" dataKey="ffr" name="Fed funds (right)" stroke={AMBER} fill={AMBER} fillOpacity={0.07} strokeWidth={1} dot={false} isAnimationActive={false} />
            <Line yAxisId="l" type="monotone" dataKey="credit" name="Total credit YoY" stroke={INDIGO} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} /><Line yAxisId="l" type="monotone" dataKey="nominal" name="Nominal GDP YoY" stroke={GREEN} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart></ResponsiveContainer>,
          "The whole framework in one picture: credit outrunning income (purple above green) is the expansion; the Fed's response (amber) is the tightening; credit falling below income is the contraction. Rule 1 is purple staying near green.")}
      </div>
    </Section>

    <Section title="3 · The Long-Term Debt Cycle — Burdens, Deleveraging, and the Four Levers" sub="Debt grows faster than income for decades until it can't; then the burden is reduced by some mix of austerity, defaults, redistribution and printing. A balanced mix is a beautiful deleveraging: nominal growth above the interest rate, with tolerable inflation.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12, marginBottom: 12, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <Board rows={[
            { label: "Total debt / GDP, all sectors", value: pc0(L.debtGdp, 0), tone: L.chg5y > 5 ? "amber" : "green", sub: `${pp(L.chg1y, 0)} 1y · ${pp(L.chg5y, 0)} 5y · peak ${pc0(L.peak.v, 0)} in ${yr(L.peak.d)}` },
            { label: "Federal share of the debt", value: pc0(L.federalShare, 0), tone: L.federalGdp > 100 ? "red" : "amber", sub: `federal ${pc0(L.federalGdp, 0)} of GDP — the sector that took the leverage after 2008` },
            { label: "Household debt service", value: pc0(L.householdDsr), tone: L.householdDsr < 11.5 ? "green" : L.householdDsr < 13 ? "amber" : "red", sub: "payments as % of disposable income" },
            { label: "Federal interest / receipts", value: pc0(L.interestToReceipts), tone: L.interestToReceipts < 12 ? "green" : L.interestToReceipts < 16 ? "amber" : "red", sub: `effective rate on the debt ${pc0(L.effRate, 2)}` },
            { label: "Nominal growth − rate on debt", value: pp(L.beautifulGap), tone: L.beautifulGap > 1 ? "green" : L.beautifulGap > 0 ? "amber" : "red", sub: `nominal GDP ${pc0(L.nominalGrowth)} vs ${pc0(L.effRate, 2)} · 10-yr ${pc0(L.y10, 2)}`, title: "Dalio's test: growth above the interest rate lets debt burdens fall without pain" },
            { label: "Fed balance sheet / GDP", value: pc0(M.walclGdp, 0), tone: M.walclYoy > 10 ? "red" : M.walclYoy > 0 ? "amber" : "green", sub: `${pc(M.walclYoy)} YoY · M2 ${pc(M.m2Yoy)} vs nominal GDP ${pc(L.nominalGrowth)}` },
            { label: "Gold", value: fin(M.goldNow) ? `$${Math.round(M.goldNow).toLocaleString()}` : "—", tone: M.goldCagr5 > 12 ? "amber" : "green", color: GOLD, sub: `${pc(M.goldR1y, 0)} 1y · ${pc0(M.goldCagr5, 0)}/yr over 5y — the market's vote on monetization` },
            { label: "Wealth: top 1% / bottom 50%", value: `${pc0(W.top1)} / ${pc0(W.bot50)}`, tone: W.top1Chg5y > 0.5 ? "amber" : "green", sub: `${pp(W.top1Chg5y)} / ${pp(W.bot50Chg5y)} over 5y · ${W.asOf}`, title: "Wide gaps raise the odds of the redistribution lever and of populist politics" },
          ]} />
          <Verdict label={L.beautiful.label} tone={longTone} why={`${L.why} ${L.beautiful.note}`} />
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {chartBox("Total debt of all sectors vs GDP since 1951 (%) — the long cycle",
            <ResponsiveContainer width="100%" height={190}><LineChart data={d.charts.debt} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={yr} minTickGap={40} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tip} formatter={(v, n) => [`${v}%`, n]} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" />
              <Line type="monotone" dataKey="total" name="All sectors" stroke={INDIGO} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="federal" name="Federal" stroke={RED} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
            </LineChart></ResponsiveContainer>,
            "Seventy-five years of the same direction, with 2008 and 2020 as the two deleveraging attempts — each answered by the sovereign taking on what the private sector shed.")}
          {chartBox("The beautiful-deleveraging test — nominal growth vs the rate on the debt (%, since 1970)",
            <ResponsiveContainer width="100%" height={170}><LineChart data={d.charts.beautiful} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={yr} minTickGap={40} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={[-6, 16]} allowDataOverflow />
              <Tooltip contentStyle={tip} formatter={(v, n) => [`${Number(v).toFixed(2)}%`, n]} /><Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono }} iconType="plainline" />
              <Line type="monotone" dataKey="nominal" name="Nominal GDP YoY" stroke={GREEN} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="effRate" name="Effective rate on federal debt" stroke={RED} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="y10" name="10-yr Treasury" stroke={SLATE} strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
            </LineChart></ResponsiveContainer>,
            "Green above red = burdens shrinking (the 2021–23 inflation did a lot of it). Red above green, as in the early 1980s, is when deleveraging turns ugly.")}
          {chartBox("Gold — 10 years (USD/oz)",
            <ResponsiveContainer width="100%" height={120}><ComposedChart data={d.charts.gold} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="d" tick={axis} tickFormatter={yr} minTickGap={40} axisLine={false} tickLine={false} /><YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v / 1000)}K`} domain={["auto", "auto"]} width={40} />
              <Tooltip contentStyle={tip} formatter={v => [`$${Number(v).toLocaleString()}`, "gold"]} /><Area type="monotone" dataKey="v" stroke={GOLD} fill={GOLD} fillOpacity={0.12} strokeWidth={1.5} isAnimationActive={false} />
            </ComposedChart></ResponsiveContainer>,
            "Dalio's monetization gauge: gold rises when holders of debt expect to be repaid in devalued money.")}
        </div>
      </div>
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={label}>The four levers of a deleveraging — current setting</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(230px, 100%), 1fr))", gap: 10, marginTop: 8 }}>
          {L.levers.map(lv => { const c = SETTING[lv.setting] || SLATE; return (
            <div key={lv.key} style={{ borderLeft: `3px solid ${c}`, paddingLeft: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading }}>{lv.name}</span><span style={{ fontSize: 9.5, fontWeight: 800, color: c, fontFamily: fonts.mono, textTransform: "uppercase" }}>{lv.setting}</span></div>
              <div style={{ fontSize: 10.5, color: "#cbd5e1", fontFamily: fonts.mono, marginTop: 4 }}>{lv.value}</div>
              <div style={note}>{lv.sub}</div>
              <div style={{ ...note, marginTop: 4, fontStyle: "italic" }}>{lv.dalio}</div>
            </div>); })}
        </div>
      </div>
    </Section>

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>The model.</strong> Transactions are spending; spending is income; credit lets spending exceed income today at the cost of spending less tomorrow. Productivity sets the long-run trend; the short-term debt cycle (5–8 years) is the central bank managing credit around it; the long-term debt cycle (75–100 years) is debt burdens ratcheting up until they must come down. The rules of thumb are Dalio&apos;s own: don&apos;t let debt rise faster than income, don&apos;t let income rise faster than productivity, and do everything to raise productivity. The stage-finder above is deliberately his sequence rather than a score: it shows which stage&apos;s conditions are met, so you can see the argument, not just the answer. Total debt is the Fed&apos;s all-sectors series (households, businesses, government, financial); the rate on the debt uses federal interest paid ÷ federal debt because that is the only sector with a clean effective rate.
    </InfoBox>
  </>);
}

export default MachineTab;
