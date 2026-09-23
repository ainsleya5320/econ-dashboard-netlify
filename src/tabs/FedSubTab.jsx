import React, { useState, useEffect, useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ReferenceLine, CartesianGrid } from "recharts";
import { fonts } from "../lib/styles.js";
import { fetchFred } from "../lib/api.js";
import { SH } from "../components/shared.jsx";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, BLUE, ORANGE, PINK, TEAL,
  fin, card, label, note, tip, axis, pc, tn, bn, money, fmtDay, th, td, tdL, tableStyle,
  chip, DenseHeader, Panel, Note, lastV, lastD, backV,
} from "../components/dense.jsx";

// a signed change in $B, dropped to $M when it is smaller than a billion
const delta = v => (!fin(v) ? "—" : Math.abs(v) < 1 ? `${v >= 0 ? "+" : "−"}$${Math.abs(v * 1000).toFixed(0)}M` : `${v > 0 ? "+" : "−"}$${Math.abs(v).toFixed(0)}B`);

// ============================================================================
// FEDERAL RESERVE BALANCE SHEET — read off the H.4.1 release via FRED.
//
// Rewritten Sept 2026. The previous version wired five series that either do
// not exist on FRED (MORTGAGE, EXCRESBA, DMONRNJ) or were the wrong thing
// entirely and stopped updating in 2021 — WIMFSL is institutional money-market
// fund assets, not Fed liabilities, and MMNRNJ is a bank deposit *interest
// rate*. Both were being printed as dollar totals. The chart axes also divided
// millions by a thousand and labelled the result trillions, so every axis was
// off by 1000×. Everything below is normalised to $ billions once, on ingest.
//
// All W-prefixed series are Wednesday levels in millions; RRPONTSYD is daily in
// billions; GDP is quarterly in billions.
// ============================================================================

const MIL = 1 / 1000; // millions → billions

// side: "a" assets, "l" liabilities & capital, "x" memo
const SERIES = {
  // ── assets ──
  WALCL:    { side: "t", label: "Total assets",            scale: MIL, limit: 800, color: INDIGO },
  WSHOBL:   { side: "a", label: "Treasury bills",          scale: MIL, limit: 800, color: TEAL,   group: "Securities held outright" },
  WSHONBNL: { side: "a", label: "Treasury notes & bonds",  scale: MIL, limit: 800, color: BLUE,   group: "Securities held outright" },
  WSHOICL:  { side: "a", label: "TIPS + inflation comp.",  scale: MIL, limit: 800, color: VIOLET, group: "Securities held outright" },
  WSHOMCB:  { side: "a", label: "Mortgage-backed securities", scale: MIL, limit: 800, color: GREEN, group: "Securities held outright" },
  WLCFLPCL: { side: "a", label: "Discount window (primary credit)", scale: MIL, limit: 800, color: AMBER, group: "Lending facilities" },
  WORAL:    { side: "a", label: "Repurchase agreements",   scale: MIL, limit: 800, color: ORANGE, group: "Lending facilities" },
  SWPT:     { side: "a", label: "Central bank liquidity swaps", scale: MIL, limit: 800, color: PINK, group: "Lending facilities" },
  // ── liabilities & capital ──
  WLTLECL:  { side: "t", label: "Total liabilities",       scale: MIL, limit: 800, color: RED },
  WRESBAL:  { side: "l", label: "Reserve balances",        scale: MIL, limit: 800, color: CYAN },
  WCURCIR:  { side: "l", label: "Currency in circulation", scale: MIL, limit: 800, color: GREEN },
  WTREGEN:  { side: "l", label: "Treasury General Account", scale: MIL, limit: 800, color: AMBER },
  WLRRAL:   { side: "l", label: "Reverse repos (ON RRP + foreign)", scale: MIL, limit: 800, color: VIOLET },
  WCTCL:    { side: "l", label: "Total capital",           scale: MIL, limit: 800, color: SLATE },
  // ── memo ──
  RRPONTSYD: { side: "x", label: "Overnight RRP (daily)",  scale: 1,   limit: 900, color: VIOLET },
  GDP:       { side: "x", label: "Nominal GDP",            scale: 1,   limit: 90,  color: DIM },
};

const ASSET_ROWS = ["WSHOBL", "WSHONBNL", "WSHOICL", "WSHOMCB", "WLCFLPCL", "WORAL", "SWPT"];
const LIAB_ROWS = ["WRESBAL", "WCURCIR", "WTREGEN", "WLRRAL"];
const BATCH = 5;

function FedSubTab({ fredKey }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [range, setRange] = useState("5Y");

  useEffect(() => {
    if (!fredKey || data) return;
    (async () => {
      const out = {};
      const entries = Object.entries(SERIES);
      for (let b = 0; b < entries.length; b += BATCH) {
        const got = await Promise.all(entries.slice(b, b + BATCH).map(async ([id, m]) => {
          try { return [id, (await fetchFred(id, fredKey, m.limit)).map(o => ({ d: o.d, v: o.v * m.scale }))]; }
          catch (e) { console.warn(`Fed: ${id} failed —`, e.message); return [id, []]; }
        }));
        got.forEach(([id, obs]) => { out[id] = obs; });
      }
      if (!out.WALCL?.length) setErr("FRED returned no observations for WALCL.");
      setData(out);
    })();
  }, [fredKey, data]);

  const months = range === "1Y" ? 12 : range === "5Y" ? 60 : range === "10Y" ? 120 : 9999;
  const cutoff = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - months); return d.toISOString().slice(0, 10); }, [months]);

  // Weekly series share the same Wednesday dates, so a plain date join works.
  const weekly = useMemo(() => {
    if (!data?.WALCL?.length) return [];
    const ids = Object.keys(SERIES).filter(id => SERIES[id].scale === MIL);
    const idx = {};
    for (const id of ids) { idx[id] = new Map((data[id] || []).map(o => [o.d, o.v])); }
    return data.WALCL.filter(o => o.d >= cutoff).map(o => {
      const row = { d: o.d };
      for (const id of ids) { const v = idx[id].get(o.d); if (v != null) row[id] = v; }
      return row;
    });
  }, [data, cutoff]);

  if (err) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Fed balance sheet could not load: {err}</div>;
  if (!data) return <div style={{ ...card, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading the H.4.1 release from FRED…</div>;

  const V = id => lastV(data[id]);
  const D = id => lastD(data[id]);
  const B = (id, n) => backV(data[id], n);

  const assets = V("WALCL"), liabs = V("WLTLECL"), capital = V("WCTCL");
  const asOf = D("WALCL");
  const wk1 = assets != null && B("WALCL", 1) != null ? assets - B("WALCL", 1) : null;
  const wk13 = assets != null && B("WALCL", 13) != null ? assets - B("WALCL", 13) : null;
  const wk52 = assets != null && B("WALCL", 52) != null ? assets - B("WALCL", 52) : null;
  const pace = fin(wk13) ? (wk13 / 13) * 52 : null;          // annualised from the last quarter
  const gdp = lastV(data.GDP);
  const pctGdp = fin(assets) && fin(gdp) ? (assets / gdp) * 100 : null;
  const reserves = V("WRESBAL");
  const resGdp = fin(reserves) && fin(gdp) ? (reserves / gdp) * 100 : null;
  const onRrp = V("RRPONTSYD");
  const identity = fin(assets) && fin(liabs) && fin(capital) ? assets - liabs - capital : null;

  // peak for the drawdown line
  const peak = (data.WALCL || []).reduce((m, o) => (o.v > (m?.v ?? -Infinity) ? o : m), null);
  const offPeak = fin(assets) && peak ? assets - peak.v : null;

  const row = (id, total, n1 = 13, n2 = 52) => {
    const m = SERIES[id], v = V(id);
    if (!fin(v)) return null;
    const d13 = fin(B(id, n1)) ? v - B(id, n1) : null;
    const d52 = fin(B(id, n2)) ? v - B(id, n2) : null;
    return (
      <tr key={id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: m.color, marginRight: 6 }} />{m.label}
        </td>
        {td(money(v), "var(--text-primary)")}
        {td(fin(total) && total > 0 ? pc((v / total) * 100, (v / total) * 100 < 1 ? 2 : 1) : "—", DIM)}
        {td(delta(d13), !fin(d13) ? DIM : d13 > 0 ? GREEN : RED)}
        {td(delta(d52), !fin(d52) ? DIM : d52 > 0 ? GREEN : RED)}
      </tr>
    );
  };

  const Hover = ({ active, payload, label: l }) => {
    if (!active || !payload?.length) return null;
    const r = weekly.find(x => x.d === l);
    if (!r) return null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{fmtDay(l)}</div>
        <div style={{ fontSize: 10.5, marginTop: 3 }}>total assets {tn(r.WALCL)} · Treasuries {tn((r.WSHOBL || 0) + (r.WSHONBNL || 0) + (r.WSHOICL || 0))} · MBS {tn(r.WSHOMCB)}</div>
        <div style={{ fontSize: 10.5, color: CYAN }}>reserves {tn(r.WRESBAL)} · TGA {tn(r.WTREGEN)} · reverse repos {tn(r.WLRRAL)}</div>
      </div>
    );
  };

  const paceWord = !fin(pace) ? "flat" : pace > 40 ? "growing" : pace < -40 ? "shrinking" : "roughly flat";
  const rangeBtn = r => ({
    padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 9.5, fontFamily: fonts.mono,
    border: `1px solid ${range === r ? "#818cf8" : "var(--border-subtle)"}`,
    background: range === r ? "rgba(129,140,248,0.15)" : "transparent",
    color: range === r ? "#c7d2fe" : SLATE, fontWeight: range === r ? 600 : 400,
  });

  return (<>
    <DenseHeader
      eyebrow="Federal Reserve balance sheet · H.4.1, Wednesday level"
      headline={<>The balance sheet is {tn(assets)} and {paceWord} at {fin(pace) ? `${delta(pace)} a year` : "an unclear pace"} — {fin(offPeak) ? `${tn(Math.abs(offPeak))} below the ${peak?.d?.slice(0, 4)} peak` : "off its peak"}, with {tn(reserves)} of reserves left in the system</>}
      blurb="Assets are what the Fed owns and liabilities are what it owes; reserves, the Treasury's account and the reverse-repo facility all compete for the same pool. When reverse repos run to zero and reserves keep falling, the next dollar of runoff comes straight out of bank reserves — that is the point at which balance-sheet policy starts moving money-market rates."
      meta={<>as of {fmtDay(asOf)} · FRED / Federal Reserve H.4.1<br />all figures normalised to $ billions on ingest</>}
      chips={[
        chip("total assets", tn(assets), INDIGO, fin(pctGdp) ? `${pc(pctGdp)} of GDP` : null),
        chip("week on week", delta(wk1), fin(wk1) ? (wk1 > 0 ? GREEN : RED) : SLATE, fin(wk52) ? `${delta(wk52)} over 52 weeks` : null),
        chip("annualised pace", fin(pace) ? `${delta(pace)}/yr` : "—", fin(pace) ? (pace > 0 ? GREEN : RED) : SLATE, "from the last 13 weeks"),
        chip("reserve balances", tn(reserves), reserves < 2800 ? AMBER : CYAN, fin(resGdp) ? `${pc(resGdp)} of GDP` : null),
        chip("overnight RRP", money(onRrp), onRrp < 25 ? AMBER : VIOLET, `daily, ${fmtDay(D("RRPONTSYD"))}`),
        chip("Treasury account", tn(V("WTREGEN")), AMBER, "cash the Treasury parks at the Fed"),
      ]}
    />

    <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
      {["1Y", "5Y", "10Y", "MAX"].map(r => <button key={r} onClick={() => setRange(r)} style={rangeBtn(r)}>{r}</button>)}
    </div>

    <Panel title="Asset composition — what the Fed actually holds" right={`${weekly.length} weekly observations`}>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={weekly} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
          <defs>
            {["WSHOBL", "WSHONBNL", "WSHOICL", "WSHOMCB"].map(id => (
              <linearGradient key={id} id={`fed-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={SERIES[id].color} stopOpacity={0.45} />
                <stop offset="95%" stopColor={SERIES[id].color} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(1)}T`} />
          <Tooltip content={<Hover />} />
          <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={7} />
          <Area type="monotone" dataKey="WSHOBL" stackId="1" name="Bills" stroke={TEAL} fill={`url(#fed-WSHOBL)`} strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="WSHONBNL" stackId="1" name="Notes & bonds" stroke={BLUE} fill={`url(#fed-WSHONBNL)`} strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="WSHOICL" stackId="1" name="TIPS" stroke={VIOLET} fill={`url(#fed-WSHOICL)`} strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="WSHOMCB" stackId="1" name="MBS" stroke={GREEN} fill={`url(#fed-WSHOMCB)`} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="WALCL" name="Total assets" stroke={INDIGO} strokeWidth={2} dot={false} strokeDasharray="4 3" />
        </AreaChart>
      </ResponsiveContainer>
      <Note>The gap between the dashed total and the stack is unamortised premium, lending facilities, swaps, gold and the float — small in normal times, and the first thing to swell in a crisis.</Note>
    </Panel>

    <Panel title="The balance sheet, line by line" right={`Wednesday level, ${fmtDay(asOf)}`} pad="10px 12px 8px">
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr>
            {th("line", "left")}{th("level")}{th("share")}{th("13-wk chg")}{th("52-wk chg")}
          </tr></thead>
          <tbody>
            <tr><td colSpan={5} style={{ ...label, padding: "8px 6px 3px", fontSize: 8.5, color: INDIGO }}>Assets</td></tr>
            {ASSET_ROWS.map(id => row(id, assets))}
            <tr style={{ borderTop: "1.5px solid var(--text-muted)" }}>
              {tdL("Total assets", "var(--text-primary)", { fontWeight: 700 })}
              {td(tn(assets), INDIGO, { fontWeight: 700 })}{td("100.0%", DIM)}
              {td(delta(wk13), fin(wk13) && wk13 > 0 ? GREEN : RED, { fontWeight: 700 })}
              {td(delta(wk52), fin(wk52) && wk52 > 0 ? GREEN : RED, { fontWeight: 700 })}
            </tr>
            <tr><td colSpan={5} style={{ ...label, padding: "12px 6px 3px", fontSize: 8.5, color: RED }}>Liabilities &amp; capital</td></tr>
            {LIAB_ROWS.map(id => row(id, assets))}
            {row("WCTCL", assets)}
            <tr style={{ borderTop: "1.5px solid var(--text-muted)" }}>
              {tdL("Total liabilities + capital", "var(--text-primary)", { fontWeight: 700 })}
              {td(tn(fin(liabs) && fin(capital) ? liabs + capital : null), RED, { fontWeight: 700 })}
              {td(fin(identity) ? (Math.abs(identity) < 1 ? "balances" : `off by ${delta(identity)}`) : "—", Math.abs(identity ?? 0) < 1 ? GREEN : AMBER)}
              {td("", DIM)}{td("", DIM)}
            </tr>
          </tbody>
        </table>
      </div>
      <Note>Residual lines the H.4.1 reports separately — the float, deferred credit, other deposits and the eliminations from consolidation — are not shown, so the listed rows do not sum to the totals. The identity check above is on the published totals, which do balance.</Note>
    </Panel>

    <Panel title="The liability side — who holds the Fed's money" right="reserves vs the Treasury's account vs reverse repos">
      <ResponsiveContainer width="100%" height={230}>
        <LineChart data={weekly} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(1)}T`} />
          <Tooltip content={<Hover />} />
          <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={7} />
          <Line type="monotone" dataKey="WRESBAL" name="Reserve balances" stroke={CYAN} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="WCURCIR" name="Currency" stroke={GREEN} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="WTREGEN" name="Treasury General Account" stroke={AMBER} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="WLRRAL" name="Reverse repos" stroke={VIOLET} strokeWidth={1.5} dot={false} />
          <ReferenceLine y={2800} stroke={`${AMBER}66`} strokeDasharray="4 4" label={{ value: "≈ reserve scarcity zone", fill: AMBER, fontSize: 8.5, position: "insideTopRight", fontFamily: fonts.mono }} />
        </LineChart>
      </ResponsiveContainer>
      <Note>
        Currency only grows. The Treasury's account swings with tax dates and debt-ceiling episodes, and every dollar into it drains a dollar of reserves. The scarcity marker is a rule of thumb, not an official line — the Fed has never published a reserve floor, and the 2019 repo squeeze arrived with reserves near 7% of GDP.
      </Note>
    </Panel>

    <div style={{ ...card, fontSize: 10.5, fontFamily: fonts.mono, color: SLATE, lineHeight: 1.6 }}>
      <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>What to watch.</span> Three numbers decide whether runoff is still painless:
      reserves as a share of GDP <span style={{ color: CYAN }}>({pc(resGdp)} now)</span>, whether the overnight RRP is still absorbing anything
      <span style={{ color: VIOLET }}> ({money(onRrp)}{fin(onRrp) && onRrp < 10 ? " — effectively drained" : ""})</span>,
      and whether banks are touching the discount window <span style={{ color: AMBER }}>({money(V("WLCFLPCL"))})</span>.
      Reverse repos near zero mean the buffer is gone and further runoff lands on reserves directly.
    </div>
  </>);
}

export default FedSubTab;
