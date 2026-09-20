import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Line, LineChart, ReferenceLine, Legend, CartesianGrid, Area, ComposedChart } from "recharts";
import { fonts } from "../lib/styles.js";
import { US_MORTGAGE_SERIES } from "../lib/constants.js";
import { fetchFMP, fetchFred } from "../lib/api.js";
import { SH } from "../components/shared.jsx";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, BLUE, ORANGE, PINK, TEAL,
  fin, card, label, note, tip, axis, pc, pp, fmtDay, th, td, tdL, tableStyle,
  chip, DenseHeader, Panel, Note, RangeBar, pctile, lastV, lastD, DataTable, useIsPhone, chartH,
} from "../components/dense.jsx";

// ============================================================================
// RATES — the price of money, priced off the whole curve rather than four
// tenors. Every maturity gets its level, what it has done over a day, a month
// and a year, and where it sits in its own five-year range. The curve itself is
// drawn against where it was a month and a year ago, because the shape moving
// is the information. Real yields, breakevens and the term premium separate the
// three things a nominal yield is actually made of.
// ============================================================================

// tenor → FRED id, in months, for the curve
const CURVE = [
  { id: "DGS1MO", label: "1M", m: 1 }, { id: "DGS3MO", label: "3M", m: 3 },
  { id: "DGS6MO", label: "6M", m: 6 }, { id: "DGS1", label: "1Y", m: 12 },
  { id: "DGS2", label: "2Y", m: 24 }, { id: "DGS3", label: "3Y", m: 36 },
  { id: "DGS5", label: "5Y", m: 60 }, { id: "DGS7", label: "7Y", m: 84 },
  { id: "DGS10", label: "10Y", m: 120 }, { id: "DGS20", label: "20Y", m: 240 },
  { id: "DGS30", label: "30Y", m: 360 },
];

const REAL = [
  { id: "DFII5", label: "5Y real (TIPS)", be: "T5YIE", nom: "DGS5", color: TEAL },
  { id: "DFII10", label: "10Y real (TIPS)", be: "T10YIE", nom: "DGS10", color: CYAN },
  { id: "DFII30", label: "30Y real (TIPS)", be: null, nom: "DGS30", color: VIOLET },
];

const POLICY = [
  { id: "DFEDTARU", label: "Fed funds target (upper)", color: RED },
  { id: "EFFR", label: "Effective fed funds", color: ORANGE },
  { id: "SOFR", label: "SOFR (secured overnight)", color: AMBER },
  { id: "IORB", label: "Interest on reserves", color: GREEN },
];

const DAILY = 1300, WEEKLY = 320;
const IDS = [
  ...CURVE.map(c => [c.id, DAILY]), ...REAL.map(r => [r.id, DAILY]),
  ...POLICY.map(p => [p.id, DAILY]),
  ["T5YIE", DAILY], ["T10YIE", DAILY], ["T5YIFR", DAILY],
  ["T10Y2Y", DAILY], ["T10Y3M", DAILY], ["THREEFYTP10", DAILY],
  ["MORTGAGE30US", WEEKLY], ["MORTGAGE15US", WEEKLY],
];

const BOND_ETFS = [
  { symbol: "SHY", label: "1–3Y Treasury", color: "#a78bfa", cat: "Treasury" },
  { symbol: "IEF", label: "7–10Y Treasury", color: "#8b5cf6", cat: "Treasury" },
  { symbol: "TLT", label: "20+Y Treasury", color: "#6366f1", cat: "Treasury" },
  { symbol: "TIP", label: "TIPS", color: "#f97316", cat: "Treasury" },
  { symbol: "AGG", label: "U.S. Aggregate", color: "#818cf8", cat: "Broad" },
  { symbol: "LQD", label: "IG corporate", color: "#3b82f6", cat: "Corporate" },
  { symbol: "HYG", label: "High yield", color: "#ef4444", cat: "Corporate" },
  { symbol: "MUB", label: "Municipal", color: "#22c55e", cat: "Muni" },
  { symbol: "BNDX", label: "International", color: "#14b8a6", cat: "Global" },
  { symbol: "EMB", label: "EM sovereign", color: "#f59e0b", cat: "Global" },
];

// value nearest to N calendar days before the last observation
function at(arr, daysAgo) {
  if (!arr?.length) return null;
  const end = Date.parse(arr[arr.length - 1].d);
  const want = end - daysAgo * 86400000;
  let best = null, gap = Infinity;
  for (const o of arr) { const g = Math.abs(Date.parse(o.d) - want); if (g < gap) { gap = g; best = o; } }
  return gap <= 12 * 86400000 ? best : null;
}
const bp = v => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(0)}bp` : "—");

function RatesTab({ md, td: tdata, fmpKey, fredKey }) {
  const [f, setF] = useState(null);
  const [bondQuotes, setBondQuotes] = useState(null);

  useEffect(() => {
    if (!fredKey || f) return;
    (async () => {
      const out = {};
      for (let i = 0; i < IDS.length; i += 6) {
        const got = await Promise.all(IDS.slice(i, i + 6).map(async ([id, lim]) => {
          try { return [id, await fetchFred(id, fredKey, lim)]; }
          catch (e) { console.warn(`Rates: ${id} —`, e.message); return [id, []]; }
        }));
        got.forEach(([id, obs]) => { out[id] = obs; });
      }
      setF(out);
    })();
  }, [fredKey, f]);

  useEffect(() => {
    if (!fmpKey) return;
    Promise.all(BOND_ETFS.map(e =>
      Promise.all([
        fetchFMP(`/quote?symbol=${e.symbol}`, fmpKey).then(d => (Array.isArray(d) && d.length ? d[0] : null)).catch(() => null),
        fetchFMP(`/profile?symbol=${e.symbol}`, fmpKey).then(d => (Array.isArray(d) && d.length ? d[0] : null)).catch(() => null),
      ]).then(([q, p]) => (q ? { ...q, divYield: p?.lastDividend && q.price ? (p.lastDividend / q.price) * 100 : null, lastDividend: p?.lastDividend } : null))
    )).then(rs => {
      const map = {};
      rs.forEach(d => { if (d?.symbol) map[d.symbol] = d; });
      if (Object.keys(map).length) setBondQuotes(map);
    });
  }, [fmpKey]);

  const mc = (md?.MORTGAGE30US?.history || []).map(h => {
    const r = { d: h.d };
    Object.keys(US_MORTGAGE_SERIES).forEach(k2 => { const m = md[k2]?.history?.find(x => x.d === h.d); if (m) r[k2] = m.v; });
    return r;
  });

  // three curves: today, a month ago, a year ago
  const curves = useMemo(() => {
    if (!f) return null;
    const build = days => CURVE.map(c => {
      const arr = f[c.id];
      const o = days === 0 ? (arr?.length ? arr[arr.length - 1] : null) : at(arr, days);
      return { label: c.label, m: c.m, v: o?.v ?? null };
    });
    return { now: build(0), m1: build(30), y1: build(365) };
  }, [f]);

  const chartCurve = useMemo(() => {
    if (!curves) return [];
    return curves.now.map((p, i) => ({ label: p.label, now: p.v, m1: curves.m1[i]?.v ?? null, y1: curves.y1[i]?.v ?? null }));
  }, [curves]);

  // spreads over time
  const spreadHist = useMemo(() => {
    if (!f?.T10Y2Y?.length) return [];
    const i3m = new Map((f.T10Y3M || []).map(o => [o.d, o.v]));
    const iTp = new Map((f.THREEFYTP10 || []).map(o => [o.d, o.v]));
    return f.T10Y2Y.map(o => ({ d: o.d, s210: o.v, s310: i3m.get(o.d) ?? null, tp: iTp.get(o.d) ?? null }));
  }, [f]);

  const realHist = useMemo(() => {
    if (!f?.DFII10?.length) return [];
    const be = new Map((f.T10YIE || []).map(o => [o.d, o.v]));
    const fwd = new Map((f.T5YIFR || []).map(o => [o.d, o.v]));
    const nom = new Map((f.DGS10 || []).map(o => [o.d, o.v]));
    return f.DFII10.map(o => ({ d: o.d, real: o.v, be: be.get(o.d) ?? null, fwd: fwd.get(o.d) ?? null, nom: nom.get(o.d) ?? null }));
  }, [f]);

  if (!f) return <div style={{ ...card, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading the Treasury curve, real yields and policy rates…</div>;

  const V = id => lastV(f[id]);
  const chg = (id, days) => { const a = at(f[id], days), b = lastV(f[id]); return fin(b) && a ? b - a.v : null; };

  const y10 = V("DGS10"), y2 = V("DGS2"), y30 = V("DGS30"), y3m = V("DGS3MO");
  const s210 = V("T10Y2Y"), s310 = V("T10Y3M");
  const real10 = V("DFII10"), be10 = V("T10YIE"), fwd55 = V("T5YIFR"), tp = V("THREEFYTP10");
  const funds = V("DFEDTARU"), sofr = V("SOFR");
  const mort = md?.MORTGAGE30US?.current ?? lastV(f.MORTGAGE30US);
  const mortSpread = fin(mort) && fin(y10) ? mort - y10 : null;
  const asOf = lastD(f.DGS10);

  const shape = !fin(s210) ? "an unclear shape"
    : s210 < -0.1 ? "inverted" : s210 < 0.15 ? "flat" : s210 < 1 ? "modestly upward-sloping" : "steep";
  const realWord = !fin(real10) ? "" : real10 > 2.5 ? "restrictive by any post-2008 standard" : real10 > 1.5 ? "clearly positive in real terms" : real10 > 0 ? "barely positive in real terms" : "negative in real terms";

  const curveRows = CURVE.filter(c => fin(lastV(f[c.id]))).map(c => {
    const arr = f[c.id];
    return {
      key: c.id, label: c.label, v: lastV(arr),
      d1: chg(c.id, 1), d30: chg(c.id, 30), d365: chg(c.id, 365),
      p: pctile((arr || []).map(o => o.v), lastV(arr)),
    };
  });
  const bpCell = d => <span style={{ color: !fin(d) ? DIM : d > 0 ? RED : GREEN }}>{bp(d)}</span>;

  const SpreadHover = ({ active, payload, label: l }) => {
    if (!active || !payload?.length) return null;
    const r = spreadHist.find(x => x.d === l);
    if (!r) return null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{fmtDay(l)}</div>
        <div style={{ fontSize: 10.5, marginTop: 3 }}>10Y − 2Y {pp(r.s210)}pp · 10Y − 3M {pp(r.s310)}pp</div>
        <div style={{ fontSize: 10.5, color: VIOLET }}>10-year term premium {pp(r.tp)}pp</div>
      </div>
    );
  };

  const RealHover = ({ active, payload, label: l }) => {
    if (!active || !payload?.length) return null;
    const r = realHist.find(x => x.d === l);
    if (!r) return null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{fmtDay(l)}</div>
        <div style={{ fontSize: 10.5, marginTop: 3 }}>10Y nominal {pc(r.nom, 2)} = real {pc(r.real, 2)} + breakeven {pc(r.be, 2)}</div>
        <div style={{ fontSize: 10.5, color: AMBER }}>5y5y forward inflation {pc(r.fwd, 2)}</div>
      </div>
    );
  };

  return (<>
    <DenseHeader
      eyebrow="U.S. rates · the whole curve, not four points on it"
      headline={<>The curve is {shape} at {pp(s210)}pp between 2s and 10s, and the 10-year real yield of {pc(real10, 2)} is {realWord}</>}
      blurb="A nominal yield is three things bolted together: what the market expects the Fed to average, what it expects inflation to be, and what it charges for holding duration. Splitting them tells you whether a move in the 10-year is a growth story, an inflation story or a supply story — and only the last one is about the deficit."
      meta={<>Treasury constant maturities as of {fmtDay(asOf)}<br />FRED · H.15 · Cleveland &amp; NY Fed decompositions</>}
      chips={[
        chip("fed funds (upper)", pc(funds, 2), RED, fin(sofr) ? `SOFR ${pc(sofr, 2)}` : null),
        chip("2-year", pc(y2, 2), INDIGO, `${bp(chg("DGS2", 30))} in a month`),
        chip("10-year", pc(y10, 2), INDIGO, `${bp(chg("DGS10", 30))} in a month`),
        chip("30-year", pc(y30, 2), INDIGO, `${bp(chg("DGS30", 30))} in a month`),
        chip("10Y real", pc(real10, 2), real10 > 2 ? AMBER : CYAN, `breakeven ${pc(be10, 2)}`),
        chip("2s10s", `${pp(s210)}pp`, s210 < 0 ? RED : GREEN, `10Y−3M ${pp(s310)}pp`),
        chip("term premium", `${pp(tp)}pp`, tp > 0.5 ? AMBER : VIOLET, "10Y zero-coupon, ACM"),
        chip("30Y mortgage", pc(mort, 2), ORANGE, fin(mortSpread) ? `${pp(mortSpread)}pp over the 10Y` : null),
      ]}
    />

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(330px, 100%),1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="The curve today, a month ago, a year ago" right={fmtDay(asOf)} style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={232}>
          <LineChart data={chartCurve} margin={{ top: 6, right: 10, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="label" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(1)}%`} domain={["dataMin - 0.15", "dataMax + 0.15"]} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={(v, n) => [pc(v, 2), n]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <Line type="monotone" dataKey="y1" name="1 year ago" stroke={DIM} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            <Line type="monotone" dataKey="m1" name="1 month ago" stroke={SLATE} strokeWidth={1.5} dot={false} strokeDasharray="2 2" />
            <Line type="monotone" dataKey="now" name="today" stroke={INDIGO} strokeWidth={2.4} dot={{ fill: INDIGO, r: 2.5 }} />
          </LineChart>
        </ResponsiveContainer>
        <Note>Parallel shifts are Fed repricing. The front end moving alone is policy; the long end moving alone is term premium or supply.</Note>
      </Panel>

      <Panel title="Every tenor — level, moves, and its own five-year range" style={{ marginBottom: 0 }}>
        <DataTable
          rows={curveRows}
          cols={[
            { key: "label", label: "tenor", primary: true },
            { key: "v", label: "yield", render: r => <span style={{ color: INDIGO, fontWeight: 600 }}>{pc(r.v, 2)}</span> },
            { key: "d1", label: "1d", render: r => bpCell(r.d1) },
            { key: "d30", label: "1m", render: r => bpCell(r.d30) },
            { key: "d365", label: "1y", render: r => bpCell(r.d365) },
            { key: "range", label: "5y range", render: r => <RangeBar pct={r.p} /> },
          ]}
        />
        <Note>The range marker is the percentile of today's yield within its own five years of daily history — 100 means the highest it has been.</Note>
      </Panel>
    </div>

    <Panel title="Curve spreads and the term premium" right="the shape, and what is paying for it">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={spreadHist} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={44} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(1)}pp`} domain={["dataMin - 0.25", "dataMax + 0.25"]} />
          <Tooltip content={<SpreadHover />} />
          <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={6} />
          <ReferenceLine y={0} stroke="var(--text-muted)" />
          <Line type="monotone" dataKey="s210" name="10Y − 2Y" stroke={INDIGO} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="s310" name="10Y − 3M" stroke={CYAN} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="tp" name="10Y term premium" stroke={VIOLET} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
        </LineChart>
      </ResponsiveContainer>
      <Note>
        Inversion has preceded every post-war recession, but the recession has arrived after the curve <em>re-steepens</em>, not while it is inverted. A term premium above zero means investors are again demanding to be paid for duration risk — for most of 2010–2021 they were paying for the privilege.
      </Note>
    </Panel>

    <Panel title="What the 10-year is actually made of" right="real yield + breakeven inflation = nominal">
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={realHist} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="r-real" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CYAN} stopOpacity={0.3} /><stop offset="95%" stopColor={CYAN} stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={44} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(1)}%`} domain={["dataMin - 0.3", "dataMax + 0.3"]} />
          <Tooltip content={<RealHover />} />
          <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={6} />
          <ReferenceLine y={2} stroke={`${AMBER}55`} strokeDasharray="4 4" label={{ value: "2% target", fill: AMBER, fontSize: 8.5, position: "insideTopRight", fontFamily: fonts.mono }} />
          <Area type="monotone" dataKey="real" name="10Y real (TIPS)" stroke={CYAN} fill="url(#r-real)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="nom" name="10Y nominal" stroke={INDIGO} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="be" name="10Y breakeven" stroke={AMBER} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="fwd" name="5y5y forward inflation" stroke={ORANGE} strokeWidth={1.2} dot={false} strokeDasharray="3 3" />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table style={tableStyle}>
          <thead><tr>{th("maturity", "left")}{th("nominal")}{th("real")}{th("breakeven")}{th("1m chg, real")}{th("5y range, real")}</tr></thead>
          <tbody>
            {REAL.map(r => {
              const real = V(r.id), nom = V(r.nom), be = r.be ? V(r.be) : (fin(nom) && fin(real) ? nom - real : null);
              const d30 = chg(r.id, 30);
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: r.color, marginRight: 6 }} />{r.label}
                  </td>
                  {td(pc(nom, 2), "var(--text-primary)")}{td(pc(real, 2), r.color, { fontWeight: 600 })}
                  {td(pc(be, 2), AMBER)}
                  {td(bp(d30), !fin(d30) ? DIM : d30 > 0 ? RED : GREEN)}
                  <td style={{ padding: "4px 6px", textAlign: "right" }}><RangeBar pct={pctile((f[r.id] || []).map(o => o.v), real)} color={r.color} /></td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "1.5px solid var(--text-muted)" }}>
              {tdL("5y5y forward inflation", SLATE)}{td("—", DIM)}{td("—", DIM)}{td(pc(fwd55, 2), ORANGE, { fontWeight: 600 })}
              {td(bp(chg("T5YIFR", 30)), DIM)}
              <td style={{ padding: "4px 6px", textAlign: "right" }}><RangeBar pct={pctile((f.T5YIFR || []).map(o => o.v), fwd55)} color={ORANGE} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <Note>Breakevens are TIPS-implied and carry a liquidity premium, so they sit a touch below true expected inflation. The 5y5y forward strips out the next five years entirely — it is the cleanest read on whether long-run expectations are still anchored.</Note>
    </Panel>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(330px, 100%),1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Policy and money-market rates" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead><tr>{th("rate", "left")}{th("level")}{th("1m")}{th("1y")}{th("as of", "right")}</tr></thead>
            <tbody>
              {POLICY.map(p => {
                const v = V(p.id);
                if (!fin(v)) return null;
                return (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: p.color, marginRight: 6 }} />{p.label}
                    </td>
                    {td(pc(v, 2), p.color, { fontWeight: 600 })}
                    {td(bp(chg(p.id, 30)), DIM)}{td(bp(chg(p.id, 365)), DIM)}
                    {td(fmtDay(lastD(f[p.id])), DIM, { fontSize: 9 })}
                  </tr>
                );
              })}
              <tr style={{ borderTop: "1.5px solid var(--text-muted)" }}>
                {tdL("SOFR − interest on reserves", SLATE)}
                {td(fin(sofr) && fin(V("IORB")) ? bp(sofr - V("IORB")) : "—", fin(sofr) && sofr - V("IORB") > 0.05 ? AMBER : SLATE, { fontWeight: 600 })}
                {td("", DIM)}{td("", DIM)}{td("", DIM)}
              </tr>
            </tbody>
          </table>
        </div>
        <Note>SOFR printing persistently above the interest paid on reserves is the classic tell that reserves are getting scarce — it is what broke in September 2019.</Note>
      </Panel>

      <Panel title="Mortgages — the rate households actually pay" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={188}>
          <LineChart data={mc} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(1)}%`} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtDay} formatter={(v, n) => [pc(v, 2), US_MORTGAGE_SERIES[n]?.label || n]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} formatter={v => US_MORTGAGE_SERIES[v]?.label || v} />
            {Object.entries(US_MORTGAGE_SERIES).map(([id, m]) => (
              <Line key={id} type="monotone" dataKey={id} name={id} stroke={m.color} strokeWidth={id === "MORTGAGE30US" ? 2 : 1.4} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <Note>
          The 30-year fixed is {pc(mort, 2)}, {fin(mortSpread) ? `${pp(mortSpread)}pp` : "—"} over the 10-year Treasury. That spread averaged about 1.7pp before 2022; anything wider is prepayment risk and thin demand for mortgage paper, not Fed policy — and it is the part that can compress without the Fed cutting at all.
        </Note>
      </Panel>
    </div>

    {bondQuotes && (
      <Panel title="Bond market — what the instruments are doing" right="FMP quotes, trailing dividend yield">
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead><tr>{th("etf", "left")}{th("exposure", "left")}{th("price")}{th("day")}{th("yield")}{th("$/yr")}{th("52-week range", "left")}</tr></thead>
            <tbody>
              {BOND_ETFS.map(e => {
                const q = bondQuotes[e.symbol];
                if (!q) return null;
                const posn = fin(q.yearHigh) && fin(q.yearLow) && q.yearHigh > q.yearLow ? ((q.price - q.yearLow) / (q.yearHigh - q.yearLow)) * 100 : null;
                return (
                  <tr key={e.symbol} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: e.color, fontWeight: 600 }}>{e.symbol}</td>
                    {tdL(e.label, "var(--text-secondary)")}
                    {td(fin(q.price) ? `$${q.price.toFixed(2)}` : "—", "var(--text-primary)")}
                    {td(fin(q.changePercentage) ? `${q.changePercentage > 0 ? "+" : ""}${q.changePercentage.toFixed(2)}%` : "—", !fin(q.changePercentage) ? DIM : q.changePercentage > 0 ? GREEN : RED)}
                    {td(pc(q.divYield, 2), GREEN)}
                    {td(fin(q.lastDividend) ? `$${q.lastDividend.toFixed(2)}` : "—", DIM)}
                    <td style={{ padding: "4px 6px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <RangeBar pct={posn} color={e.color} width={54} />
                        <span style={{ fontSize: 9, fontFamily: fonts.mono, color: DIM }}>
                          {fin(q.yearLow) ? `$${q.yearLow.toFixed(0)}–${q.yearHigh.toFixed(0)}` : ""}
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Note>Dividend yield here is the last declared distribution over price — it lags a fund whose portfolio yield is moving, so read it alongside the curve above rather than as a forward number.</Note>
      </Panel>
    )}
  </>);
}

export default RatesTab;
