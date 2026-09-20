import React, { useState, useEffect, useMemo } from "react";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, BarChart, Bar, Cell,
  ReferenceLine, ScatterChart, Scatter, CartesianGrid, ZAxis, LineChart, Line, ComposedChart,
} from "recharts";
import { fonts } from "../lib/styles.js";
import { fetchFred } from "../lib/api.js";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, BLUE, ORANGE, PINK, TEAL,
  fin, card, label, note, tip, axis, pc, pp, kk, fmtMon, fmtDay, th, td, tdL, tableStyle,
  chip, DenseHeader, Panel, Note, RangeBar, pctile, lastV, lastD, backV, DataTable, useIsPhone, chartH,
} from "../components/dense.jsx";

// ============================================================================
// LABOR — a headline payroll print is one number with a ±120k confidence
// interval, so the useful reading is breadth and direction: which industries
// are actually adding, how much slack there is on the six official measures
// rather than the one everybody quotes, and what the fast-moving series that
// historically turn first (temp help, weekly hours, quits) are doing.
// ============================================================================

const HEAD = {
  UNRATE:       { label: "Unemployment (U-3)", color: RED, lim: 720 },
  PAYEMS:       { label: "Nonfarm payrolls", color: BLUE, lim: 720 },
  UNEMPLOY:     { label: "Unemployed persons", color: RED, lim: 720 },
  CIVPART:      { label: "Participation rate", color: INDIGO, lim: 720 },
  LNS11300060:  { label: "Prime-age participation", color: TEAL, lim: 720 },
  LNS12300060:  { label: "Prime-age employment rate", color: CYAN, lim: 720 },
  CES0500000003: { label: "Average hourly earnings", color: VIOLET, lim: 400 },
  SAHMREALTIME: { label: "Sahm rule", color: RED, lim: 400 },
  UEMPMED:      { label: "Median weeks unemployed", color: ORANGE, lim: 720 },
};

// the full slack ladder, U-1 through U-6
const LADDER = [
  { id: "U1RATE", label: "U-1", what: "unemployed 15 weeks or longer", color: "#1e40af" },
  { id: "U2RATE", label: "U-2", what: "lost a job or finished a temp one", color: "#2563eb" },
  { id: "UNRATE", label: "U-3", what: "the headline — jobless and looking", color: RED },
  { id: "U4RATE", label: "U-4", what: "U-3 plus discouraged workers", color: ORANGE },
  { id: "U5RATE", label: "U-5", what: "U-4 plus everyone marginally attached", color: AMBER },
  { id: "U6RATE", label: "U-6", what: "U-5 plus part-time for economic reasons", color: "#facc15" },
];

// series that historically turn before the headline does
const LEADING = [
  { id: "TEMPHELPS", label: "Temporary help employment", unit: "k", invert: false, note: "firms shed temps before staff" },
  { id: "AWHAETP", label: "Average weekly hours, private", unit: "hr", invert: false, note: "hours get cut before heads" },
  { id: "JTSQUR", label: "Quits rate", unit: "%", invert: false, note: "confidence to walk out" },
  { id: "JTSHIR", label: "Hires rate", unit: "%", invert: false, note: "gross hiring, not net" },
  { id: "JTSLDR", label: "Layoffs & discharges rate", unit: "%", invert: true, note: "still historically low is the point" },
  { id: "IC4WSA", label: "Initial claims, 4-week average", unit: "k", invert: true, note: "the only weekly reading" },
  { id: "UEMPMED", label: "Median weeks unemployed", unit: "wk", invert: true, note: "how hard it is to get rehired" },
];

const INDUSTRY = [
  { id: "USEHS", label: "Private education & health", color: GREEN },
  { id: "USPBS", label: "Professional & business services", color: INDIGO },
  { id: "USLAH", label: "Leisure & hospitality", color: PINK },
  { id: "USGOVT", label: "Government", color: SLATE },
  { id: "USTRADE", label: "Retail trade", color: AMBER },
  { id: "MANEMP", label: "Manufacturing", color: ORANGE },
  { id: "USCONS", label: "Construction", color: TEAL },
  { id: "CES4300000001", label: "Transportation & warehousing", color: CYAN },
  { id: "USFIRE", label: "Financial activities", color: BLUE },
  { id: "USINFO", label: "Information", color: VIOLET },
  { id: "USMINE", label: "Mining & logging", color: "#a16207" },
];

const OTHER = [
  ["U6RATE", 400], ["ICSA", 300], ["CCSA", 300], ["JTSJOL", 400], ["JTSQUR", 400],
  ["JTSHIR", 400], ["JTSLDR", 400], ["IC4WSA", 300], ["TEMPHELPS", 720], ["AWHAETP", 720],
  ["U1RATE", 400], ["U2RATE", 400], ["U4RATE", 400], ["U5RATE", 400], ["USPRIV", 720],
];

const IDS = [
  ...Object.entries(HEAD).map(([id, m]) => [id, m.lim]),
  ...OTHER,
  ...INDUSTRY.map(i => [i.id, 400]),
];

const kDelta = v => (fin(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}k` : "—");
const mom = (arr, n = 1) => { const a = backV(arr, n), b = lastV(arr); return fin(a) && fin(b) ? b - a : null; };
const avgMom = (arr, n) => { const d = mom(arr, n); return fin(d) ? d / n : null; };

function LaborSubTab({ fredKey }) {
  const [f, setF] = useState(null);
  const [range, setRange] = useState("5Y");

  useEffect(() => {
    if (f) return;
    (async () => {
      const out = {};
      for (let i = 0; i < IDS.length; i += 6) {
        const got = await Promise.all(IDS.slice(i, i + 6).map(async ([id, lim]) => {
          try { return [id, await fetchFred(id, fredKey, lim)]; }
          catch (e) { console.warn(`Labor: ${id} —`, e.message); return [id, []]; }
        }));
        got.forEach(([id, obs]) => { out[id] = obs; });
      }
      setF(out);
    })();
  }, [fredKey, f]);

  const months = range === "5Y" ? 60 : range === "10Y" ? 120 : range === "20Y" ? 240 : 9999;
  const cutoff = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - months); return d.toISOString().slice(0, 10); }, [months]);
  const clip = arr => (arr || []).filter(p => p.d >= cutoff);

  const payrollChange = useMemo(() => {
    const raw = clip(f?.PAYEMS);
    if (raw.length < 2) return [];
    return raw.slice(1).map((p, i) => ({ d: p.d, v: p.v - raw[i].v }));
  }, [f, cutoff]);

  // April 2020 lost 20.5 million jobs, which flattens every other bar in the
  // chart to nothing. Scale to the 97th percentile of absolute moves and let the
  // pandemic clip off the bottom rather than dictate the axis.
  const payDomain = useMemo(() => {
    const xs = payrollChange.map(p => Math.abs(p.v)).filter(fin).sort((a, b) => a - b);
    if (!xs.length) return ["auto", "auto"];
    const m = Math.max((xs[Math.floor(xs.length * 0.97)] || xs[xs.length - 1]) * 1.2, 400);
    return [-m, m];
  }, [payrollChange]);
  const payClipped = payrollChange.some(p => Math.abs(p.v) > (fin(payDomain[1]) ? payDomain[1] : Infinity));

  const earningsYoY = useMemo(() => {
    const raw = f?.CES0500000003 || [];
    const out = [];
    for (let i = 12; i < raw.length; i++) {
      const prev = raw[i - 12].v;
      if (prev > 0) out.push({ d: raw[i].d, v: ((raw[i].v - prev) / prev) * 100 });
    }
    return out.filter(p => p.d >= cutoff);
  }, [f, cutoff]);

  // openings per unemployed person — the ratio the Fed actually cites
  const vu = useMemo(() => {
    if (!f?.JTSJOL?.length || !f?.UNEMPLOY?.length) return [];
    const u = new Map(f.UNEMPLOY.map(o => [o.d, o.v]));
    const un = new Map((f.UNRATE || []).map(o => [o.d, o.v]));
    return f.JTSJOL.map(o => {
      const un_ = u.get(o.d);
      return un_ ? { d: o.d, ratio: o.v / un_, openings: o.v / 1000, unemployment: un.get(o.d) ?? null } : null;
    }).filter(Boolean);
  }, [f]);

  const beveridge = useMemo(() => vu.filter(p => p.d >= cutoff && fin(p.unemployment)), [vu, cutoff]);

  if (!f) return <div style={{ ...card, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading payrolls, the slack ladder, JOLTS and the industry detail…</div>;

  const V = id => lastV(f[id]);
  const D = id => lastD(f[id]);

  const payroll1 = payrollChange.length ? payrollChange[payrollChange.length - 1].v : null;
  const payroll3 = avgMom(f.PAYEMS, 3);
  const payroll12 = avgMom(f.PAYEMS, 12);
  const totalEmp = V("PAYEMS");
  const u3 = V("UNRATE"), u6 = V("U6RATE"), sahm = V("SAHMREALTIME");
  const claims4 = V("IC4WSA");
  const ratio = vu.length ? vu[vu.length - 1].ratio : null;
  const quits = V("JTSQUR");
  const primeEpop = V("LNS12300060");
  const wage = earningsYoY.length ? earningsYoY[earningsYoY.length - 1].v : null;
  const asOf = D("PAYEMS");

  const hiring = !fin(payroll3) ? "unclear" : payroll3 > 150 ? "solid" : payroll3 > 75 ? "slowing but positive" : payroll3 > 0 ? "close to stall speed" : "shrinking";
  const u3Up = fin(u3) && fin(backV(f.UNRATE, 12)) ? u3 - backV(f.UNRATE, 12) : null;

  const rangeBtn = r => ({
    padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 9.5, fontFamily: fonts.mono,
    border: `1px solid ${range === r ? "#818cf8" : "var(--border-subtle)"}`,
    background: range === r ? "rgba(129,140,248,0.15)" : "transparent",
    color: range === r ? "#c7d2fe" : SLATE, fontWeight: range === r ? 600 : 400,
  });

  const PayrollHover = ({ active, label: l }) => {
    if (!active) return null;
    const r = payrollChange.find(x => x.d === l);
    if (!r) return null;
    const i = payrollChange.findIndex(x => x.d === l);
    const t3 = i >= 2 ? (payrollChange[i].v + payrollChange[i - 1].v + payrollChange[i - 2].v) / 3 : null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{fmtMon(l)}</div>
        <div style={{ fontSize: 10.5, marginTop: 3 }}>{r.v >= 0 ? "+" : "−"}{Math.abs(r.v).toFixed(0)}k jobs{fin(t3) ? ` · three-month average ${t3 >= 0 ? "+" : "−"}${Math.abs(t3).toFixed(0)}k` : ""}</div>
      </div>
    );
  };

  const industryRows = INDUSTRY.map(ind => {
    const arr = f[ind.id], v = lastV(arr);
    if (!fin(v)) return null;
    const m1 = mom(arr, 1), m3 = avgMom(arr, 3), m12 = mom(arr, 12);
    return { ...ind, v, m1, m3, m12, share: fin(totalEmp) ? (v / totalEmp) * 100 : null };
  }).filter(Boolean).sort((a, b) => (b.m3 ?? -1e9) - (a.m3 ?? -1e9));

  const adding = industryRows.filter(r => fin(r.m3) && r.m3 > 0).length;

  return (<>
    <DenseHeader
      eyebrow="Labor market · breadth, slack and what turns first"
      headline={<>Hiring is {hiring} at {fin(payroll3) ? `${payroll3 >= 0 ? "+" : "−"}${Math.abs(payroll3).toFixed(0)}k a month` : "an unclear pace"} over three months, with {adding} of {industryRows.length} industries still adding and unemployment at {pc(u3, 1)}{fin(u3Up) ? `, ${pp(u3Up, 1)}pp on a year ago` : ""}</>}
      blurb="One payroll print has a 90% confidence interval of roughly ±120,000 and gets revised twice, so a single month is close to noise. Breadth across industries, the direction of the fast-turning series, and the gap between the narrow and broad unemployment rates carry more signal than any headline number does."
      meta={<>establishment survey through {fmtMon(asOf)} · JOLTS through {fmtMon(D("JTSJOL"))}<br />claims through {fmtDay(D("IC4WSA"))} · BLS via FRED</>}
      chips={[
        chip("payrolls, 3-month avg", fin(payroll3) ? `${payroll3 >= 0 ? "+" : "−"}${Math.abs(payroll3).toFixed(0)}k` : "—", payroll3 > 100 ? GREEN : payroll3 > 0 ? AMBER : RED, fin(payroll1) ? `latest month ${payroll1 >= 0 ? "+" : "−"}${Math.abs(payroll1).toFixed(0)}k` : null),
        chip("unemployment", pc(u3, 1), u3 > 4.5 ? AMBER : GREEN, `U-6 ${pc(u6, 1)}`),
        chip("Sahm rule", fin(sahm) ? sahm.toFixed(2) : "—", sahm >= 0.5 ? RED : GREEN, sahm >= 0.5 ? "recession signal triggered" : "below the 0.50 threshold"),
        chip("initial claims", fin(claims4) ? `${(claims4 / 1000).toFixed(0)}k` : "—", claims4 > 260000 ? AMBER : GREEN, "four-week average"),
        chip("openings per unemployed", fin(ratio) ? `${ratio.toFixed(2)}×` : "—", ratio < 0.9 ? AMBER : GREEN, "the Fed's slack gauge"),
        chip("quits rate", pc(quits, 1), quits < 2 ? AMBER : GREEN, "workers confident enough to leave"),
        chip("prime-age employed", pc(primeEpop, 1), GREEN, "25–54, employment-to-population"),
        chip("wage growth", pc(wage, 1), wage > 4 ? AMBER : GREEN, "average hourly earnings, year over year"),
      ]}
    />

    <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
      {["5Y", "10Y", "20Y", "MAX"].map(r => <button key={r} onClick={() => setRange(r)} style={rangeBtn(r)}>{r}</button>)}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(350px, 100%),1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Payrolls, monthly change" right="bars are months; the line is the three-month average" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={236}>
          <ComposedChart data={payrollChange.map((p, i, a) => ({ ...p, avg3: i >= 2 ? (a[i].v + a[i - 1].v + a[i - 2].v) / 3 : null }))} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} domain={payDomain} allowDataOverflow tickFormatter={v => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}M` : `${v.toFixed(0)}k`)} />
            <Tooltip content={<PayrollHover />} />
            <ReferenceLine y={0} stroke="var(--text-muted)" />
            <Bar dataKey="v" radius={[2, 2, 0, 0]}>
              {payrollChange.map((p, i) => <Cell key={i} fill={p.v >= 0 ? GREEN : RED} fillOpacity={0.55} />)}
            </Bar>
            <Line type="monotone" dataKey="avg3" stroke={INDIGO} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <Note>Roughly 80–100k a month is the level that holds unemployment steady given current labour-force growth — below that, the rate drifts up even with positive prints.{payClipped ? " The 2020 collapse and rebound run off the scale; the axis is set to the 97th percentile of monthly moves so the rest stays readable." : ""}</Note>
      </Panel>

      <Panel title="Where the jobs are coming from" right={`three-month average, ${fmtMon(asOf)}`} style={{ marginBottom: 0 }}>
        <DataTable
          dense
          rows={industryRows.map(r => ({ ...r, key: r.id }))}
          cols={[
            { key: "label", label: "industry", primary: true, render: r => (<>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: r.color, marginRight: 6 }} />{r.label}
            </>) },
            { key: "v", label: "employed", render: r => `${(r.v / 1000).toFixed(1)}M` },
            { key: "share", label: "share", render: r => <span style={{ color: DIM }}>{pc(r.share, 1)}</span> },
            { key: "m1", label: "1m", render: r => <span style={{ color: !fin(r.m1) ? DIM : r.m1 > 0 ? GREEN : RED }}>{kDelta(r.m1)}</span> },
            { key: "m3", label: "3m avg", render: r => <span style={{ color: !fin(r.m3) ? DIM : r.m3 > 0 ? GREEN : RED, fontWeight: 600 }}>{kDelta(r.m3)}</span> },
            { key: "m12", label: "12m", render: r => <span style={{ color: !fin(r.m12) ? DIM : r.m12 > 0 ? GREEN : RED }}>{kDelta(r.m12)}</span> },
          ]}
        />
        <Note>
          {adding} of {industryRows.length} industries are adding on a three-month basis. When that count falls below about half, the headline is being carried by one or two sectors — historically health care and government — and the expansion is narrower than it looks.
        </Note>
      </Panel>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(350px, 100%),1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="The full slack ladder, U-1 to U-6" right={fmtMon(D("UNRATE"))} style={{ marginBottom: 0 }}>
        <DataTable
          rows={[
            ...LADDER.filter(m => fin(lastV(f[m.id]))).map(m => {
              const arr = f[m.id], v = lastV(arr), d12 = mom(arr, 12);
              return { key: m.id, m, v, d12, arr };
            }),
            { key: "gap", gap: true, v: fin(u6) && fin(u3) ? u6 - u3 : null },
          ]}
          cols={[
            { key: "label", label: "measure", primary: true, render: r => (r.gap ? <span style={{ color: SLATE }}>U-6 minus U-3</span> : (<>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: r.m.color, marginRight: 6 }} />{r.m.label}
            </>)) },
            { key: "what", label: "counts", align: "left", hide: true, render: r => <span style={{ color: DIM, fontSize: 9.5 }}>{r.gap ? "hidden slack" : r.m.what}</span> },
            { key: "rate", label: "rate", render: r => <span style={{ color: r.gap ? AMBER : r.m.color, fontWeight: 600 }}>{r.gap ? (fin(r.v) ? `${r.v.toFixed(1)}pp` : "—") : pc(r.v, 1)}</span> },
            { key: "d12", label: "1y chg", render: r => (r.gap ? "" : <span style={{ color: !fin(r.d12) ? DIM : r.d12 > 0 ? RED : GREEN }}>{fin(r.d12) ? `${pp(r.d12, 1)}pp` : "—"}</span>) },
            { key: "range", label: "20y range", render: r => (r.gap ? "" : <RangeBar pct={pctile((r.arr || []).slice(-240).map(o => o.v), r.v)} color={r.m.color} />) },
          ]}
        />
        <Note>The gap between U-6 and U-3 is the part of the labour market that wants more work but does not show up in the headline. It has averaged close to 4pp in expansions and widens first when conditions soften.</Note>
      </Panel>

      <Panel title="The series that turn first" right="direction against six months ago" style={{ marginBottom: 0 }}>
        <DataTable
          rows={LEADING.filter(m => fin(lastV(f[m.id]))).map(m => {
            const arr = f[m.id], v = lastV(arr);
            const prev = backV(arr, m.id === "IC4WSA" ? 26 : 6);   // claims are weekly
            const d = fin(prev) ? v - prev : null;
            const fmt = x => !fin(x) ? "—" : m.unit === "k" ? (m.id === "IC4WSA" ? `${(x / 1000).toFixed(0)}k` : `${(x / 1000).toFixed(2)}M`) : m.unit === "%" ? pc(x, 1) : x.toFixed(1);
            return { key: m.id, m, v, prev, d, fmt, good: fin(d) && d !== 0 ? ((d > 0) !== m.invert) : null };
          })}
          cols={[
            { key: "label", label: "indicator", primary: true, render: r => r.m.label },
            { key: "now", label: "now", render: r => <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.fmt(r.v)}</span> },
            { key: "prev", label: "6m ago", render: r => <span style={{ color: DIM }}>{r.fmt(r.prev)}</span> },
            { key: "chg", label: "change", render: r => <span style={{ color: r.good === null ? DIM : r.good ? GREEN : RED }}>
              {fin(r.d) ? (r.m.unit === "k" ? `${r.d >= 0 ? "+" : "−"}${Math.abs(r.d / 1000).toFixed(r.m.id === "IC4WSA" ? 0 : 2)}${r.m.id === "IC4WSA" ? "k" : "M"}` : pp(r.d, 1)) : "—"}
            </span> },
            { key: "note", label: "reading", align: "left", render: r => <span style={{ color: DIM, fontSize: 9 }}>{r.m.note}</span> },
          ]}
        />
        <Note>Green is the direction that means a healthier labour market for that particular series — falling claims and falling layoffs are good; falling quits and falling hours are not.</Note>
      </Panel>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(350px, 100%),1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Unemployment — narrow against broad" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={clip(f.UNRATE).map(p => ({ d: p.d, u3: p.v, u6: (f.U6RATE || []).find(x => x.d === p.d)?.v ?? null }))} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="l-u3" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={RED} stopOpacity={0.3} /><stop offset="95%" stopColor={RED} stopOpacity={0} /></linearGradient>
              <linearGradient id="l-u6" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={AMBER} stopOpacity={0.15} /><stop offset="95%" stopColor={AMBER} stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtMon} formatter={(v, n) => [pc(v, 1), n === "u3" ? "U-3" : "U-6"]} />
            <Area type="monotone" dataKey="u6" name="u6" stroke={AMBER} fill="url(#l-u6)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="u3" name="u3" stroke={RED} fill="url(#l-u3)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Jobless claims" right="weekly — the most timely labour reading there is" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={clip(f.ICSA).map(p => ({ d: p.d, ic: p.v / 1000, cc: (f.CCSA || []).find(x => x.d === p.d)?.v / 1000 || null }))} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="l-ic" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={VIOLET} stopOpacity={0.3} /><stop offset="95%" stopColor={VIOLET} stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(0)}k`} />
            <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(1)}M`} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtDay} formatter={(v, n) => [n === "ic" ? `${v.toFixed(0)}k` : `${(v / 1000).toFixed(2)}M`, n === "ic" ? "initial claims" : "continued claims"]} />
            <Area yAxisId="l" type="monotone" dataKey="ic" name="ic" stroke={VIOLET} fill="url(#l-ic)" strokeWidth={2} dot={false} />
            <Line yAxisId="r" type="monotone" dataKey="cc" name="cc" stroke={PINK} strokeWidth={1.4} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <Note>Initial claims are people losing jobs; continued claims are people failing to find new ones. Continued claims rising while initial claims stay low is a hiring freeze, not a layoff wave — a different problem with a different fix.</Note>
      </Panel>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(350px, 100%),1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Openings per unemployed person, and the quits rate" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={216}>
          <ComposedChart data={vu.filter(p => p.d >= cutoff).map(p => ({ ...p, quits: (f.JTSQUR || []).find(x => x.d === p.d)?.v ?? null }))} margin={{ top: 6, right: 16, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="l-vu" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={GREEN} stopOpacity={0.3} /><stop offset="95%" stopColor={GREEN} stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(1)}×`} />
            <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtMon} formatter={(v, n) => [n === "ratio" ? `${v.toFixed(2)} openings per unemployed` : pc(v, 1), n === "ratio" ? "V/U" : "quits rate"]} />
            <ReferenceLine yAxisId="l" y={1} stroke="var(--text-muted)" strokeDasharray="4 4" label={{ value: "one opening each", fill: SLATE, fontSize: 8.5, position: "insideTopRight", fontFamily: fonts.mono }} />
            <Area yAxisId="l" type="monotone" dataKey="ratio" name="ratio" stroke={GREEN} fill="url(#l-vu)" strokeWidth={2} dot={false} />
            <Line yAxisId="r" type="monotone" dataKey="quits" name="quits" stroke={AMBER} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
          </ComposedChart>
        </ResponsiveContainer>
        <Note>This ratio peaked near 2.0 in 2022 and is the single number the Fed used to argue the labour market was too tight. Below 1.0 there are more people looking than jobs advertised.</Note>
      </Panel>

      <Panel title="Beveridge curve" right="openings against unemployment, colour runs light to dark over time" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={216}>
          <ScatterChart margin={{ top: 8, right: 14, left: -8, bottom: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis type="number" dataKey="unemployment" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickFormatter={v => `${v}%`} domain={["dataMin - 0.3", "dataMax + 0.3"]} />
            <YAxis type="number" dataKey="openings" tick={axis} axisLine={false} tickFormatter={v => `${v.toFixed(1)}M`} domain={["dataMin - 0.3", "dataMax + 0.3"]} />
            <ZAxis range={[18, 18]} />
            <Tooltip
              contentStyle={tip} itemStyle={{ fontFamily: fonts.mono }}
              formatter={(v, n) => [n === "unemployment" ? pc(v, 1) : `${v.toFixed(2)}M openings`, n === "unemployment" ? "unemployment" : "openings"]}
              labelFormatter={() => ""}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload;
                return (
                  <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
                    <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{fmtMon(p.d)}</div>
                    <div style={{ fontSize: 10.5, marginTop: 3 }}>{p.openings.toFixed(2)}M openings against {pc(p.unemployment, 1)} unemployment</div>
                    <div style={{ fontSize: 10.5, color: GREEN }}>{p.ratio.toFixed(2)} openings per unemployed person</div>
                  </div>
                );
              }}
            />
            <Scatter data={beveridge}>
              {beveridge.map((p, i) => {
                const t = i / Math.max(beveridge.length - 1, 1);
                return <Cell key={i} fill={`rgb(${Math.round(96 + t * 33)},${Math.round(165 - t * 25)},${Math.round(250 - t * 2)})`} fillOpacity={0.25 + t * 0.7} />;
              })}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <Note>Moving down-and-right along the same curve is ordinary cooling. The whole curve shifting outward — many openings <em>and</em> high unemployment — means employers and workers are not matching, which rate cuts cannot fix.</Note>
      </Panel>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(350px, 100%),1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Participation — headline against prime age" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={196}>
          <LineChart data={clip(f.CIVPART).map(p => ({
            d: p.d, all: p.v,
            prime: (f.LNS11300060 || []).find(x => x.d === p.d)?.v ?? null,
            epop: (f.LNS12300060 || []).find(x => x.d === p.d)?.v ?? null,
          }))} margin={{ top: 6, right: 16, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["dataMin - 0.4", "dataMax + 0.4"]} />
            <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["dataMin - 0.4", "dataMax + 0.4"]} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtMon} formatter={(v, n) => [pc(v, 1), n === "all" ? "all ages, participation" : n === "prime" ? "prime-age participation" : "prime-age employment rate"]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} formatter={v => (v === "all" ? "all ages (left)" : v === "prime" ? "prime-age (right)" : "prime-age employed (right)")} />
            <Line yAxisId="l" type="monotone" dataKey="all" name="all" stroke={INDIGO} strokeWidth={2} dot={false} />
            <Line yAxisId="r" type="monotone" dataKey="prime" name="prime" stroke={TEAL} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            <Line yAxisId="r" type="monotone" dataKey="epop" name="epop" stroke={CYAN} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <Note>The all-ages rate is dragged down by retirements and tells you little about demand. Prime-age is the clean read, and the employment-to-population version of it removes the judgement call about who counts as looking.</Note>
      </Panel>

      <Panel title="Wage growth and the Sahm rule" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={196}>
          <ComposedChart data={earningsYoY.map(p => ({ d: p.d, wage: p.v, sahm: (f.SAHMREALTIME || []).find(x => x.d === p.d)?.v ?? null }))} margin={{ top: 6, right: 16, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="l-sahm" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={RED} stopOpacity={0.3} /><stop offset="95%" stopColor={RED} stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(0)}%`} />
            <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => v.toFixed(1)} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtMon} formatter={(v, n) => [n === "wage" ? pc(v, 1) : v.toFixed(2), n === "wage" ? "wage growth, year over year" : "Sahm rule"]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} formatter={v => (v === "wage" ? "wage growth (left)" : "Sahm rule (right)")} />
            <ReferenceLine yAxisId="r" y={0.5} stroke={RED} strokeDasharray="4 4" label={{ value: "0.50", fill: RED, fontSize: 8.5, position: "insideTopRight", fontFamily: fonts.mono }} />
            <Area yAxisId="r" type="monotone" dataKey="sahm" name="sahm" stroke={RED} fill="url(#l-sahm)" strokeWidth={1.4} dot={false} />
            <Line yAxisId="l" type="monotone" dataKey="wage" name="wage" stroke={VIOLET} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <Note>
          Wage growth around 3.5% is consistent with 2% inflation given trend productivity; it is currently {pc(wage, 1)}. The Sahm rule fires when the three-month average unemployment rate runs 0.50pp above its prior twelve-month low — it is at {fin(sahm) ? sahm.toFixed(2) : "—"}. Claudia Sahm has said herself it was built as a trigger for sending cheques, not as a forecast.
        </Note>
      </Panel>
    </div>
  </>);
}

export default LaborSubTab;
