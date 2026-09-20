import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, BarChart, Bar, ReferenceLine, Cell, CartesianGrid, LineChart, Line } from "recharts";
import { fonts } from "../lib/styles.js";
import { CPI_COMPONENTS, PCE_COMPONENTS } from "../lib/constants.js";
import { fetchFred } from "../lib/api.js";
import { SH } from "../components/shared.jsx";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, BLUE, ORANGE, PINK, TEAL,
  fin, card, label, note, tip, axis, pc, pp, fmtMon, th, td, tdL, tableStyle,
  chip, DenseHeader, Panel, Note, RangeBar, pctile, annualized, lastV, lastD,
} from "../components/dense.jsx";

// ============================================================================
// INFLATION — the level everyone quotes is a twelve-month average, which is a
// lagging summary of a series that turns much faster. So the centrepiece here
// is momentum: the same index read over one, three, six and twelve months, all
// annualised, for every measure the Fed actually looks at. If the three-month
// is running below the twelve-month, disinflation is still happening; if it is
// above, the annual number is about to stop falling no matter what it says now.
// ============================================================================

// index-level series, so momentum can be computed rather than looked up
const INDEX = {
  CPIAUCSL:       { label: "CPI, all items",            color: RED,    group: "Headline" },
  CPILFESL:       { label: "Core CPI",                  color: BLUE,   group: "Headline" },
  PCEPI:          { label: "PCE, all items",            color: ORANGE, group: "Headline" },
  PCEPILFE:       { label: "Core PCE — the Fed's target", color: GREEN, group: "Headline" },
  CUSR0000SACL1E: { label: "Core goods",                color: TEAL,   group: "Underneath" },
  CUSR0000SASLE:  { label: "Core services",             color: VIOLET, group: "Underneath" },
  CUSR0000SAH1:   { label: "Shelter",                   color: CYAN,   group: "Underneath" },
  CUSR0000SA0L2:  { label: "CPI excluding shelter",     color: PINK,   group: "Underneath" },
};

// already published as a rate of change — shown as reported
const RATE = {
  CORESTICKM159SFRBATL:  { label: "Sticky-price core CPI", color: AMBER,  m3: "CORESTICKM679SFRBATL" },
  MEDCPIM159SFRBCLE:     { label: "Median CPI (Cleveland)", color: INDIGO, m3: null, m1: "MEDCPIM158SFRBCLE" },
  TRMMEANCPIM159SFRBCLE: { label: "16% trimmed-mean CPI",  color: SLATE,  m3: null },
  PCETRIM12M159SFRBDAL:  { label: "Trimmed-mean PCE (Dallas)", color: DIM, m3: null },
};

const EXPECT = [
  { id: "T5YIE", label: "5-year breakeven", src: "TIPS market", color: AMBER },
  { id: "T10YIE", label: "10-year breakeven", src: "TIPS market", color: ORANGE },
  { id: "T5YIFR", label: "5y5y forward", src: "TIPS market", color: RED },
  { id: "EXPINF1YR", label: "1-year expected", src: "Cleveland Fed model", color: CYAN },
  { id: "EXPINF5YR", label: "5-year expected", src: "Cleveland Fed model", color: TEAL },
  { id: "EXPINF10YR", label: "10-year expected", src: "Cleveland Fed model", color: BLUE },
  { id: "MICH", label: "1-year, households", src: "U. Michigan survey", color: VIOLET },
];

const IDS = [
  ...Object.keys(INDEX).map(id => [id, 420]),
  ...Object.keys(RATE).map(id => [id, 420]),
  ["CORESTICKM679SFRBATL", 420], ["MEDCPIM158SFRBCLE", 420],
  ...EXPECT.map(e => [e.id, e.id.startsWith("T") ? 1300 : 420]),
];

const BLS_CATEGORIES = [
  { id: "CUSR0000SA0", label: "All items", color: RED },
  { id: "CUSR0000SA0L1E", label: "Core CPI", color: BLUE },
  { id: "CUSR0000SAF1", label: "Food", color: ORANGE },
  { id: "CUSR0000SA0E", label: "Energy", color: AMBER },
  { id: "CUSR0000SAH1", label: "Shelter", color: CYAN },
  { id: "CUSR0000SAM", label: "Medical care", color: PINK },
  { id: "CUSR0000SAT", label: "Transportation", color: GREEN },
  { id: "CUSR0000SAA", label: "Apparel", color: VIOLET },
  { id: "CUSR0000SAR", label: "Recreation", color: TEAL },
  { id: "CUSR0000SAE", label: "Education & communication", color: INDIGO },
  { id: "CUSR0000SETA02", label: "Used cars & trucks", color: "#34d399" },
  { id: "CUSR0000SETA01", label: "New vehicles", color: "#4ade80" },
];

// annualised change over n months of an index series
const ann = (arr, n) => annualized(arr, n, 12);
const dirColor = (fast, slow) => (!fin(fast) || !fin(slow) ? DIM : fast > slow + 0.15 ? RED : fast < slow - 0.15 ? GREEN : SLATE);
const arrow = (fast, slow) => (!fin(fast) || !fin(slow) ? "" : fast > slow + 0.15 ? "▲" : fast < slow - 0.15 ? "▼" : "▪");

function CpiTab({ cd }) {
  const [f, setF] = useState(null);
  const [bls, setBls] = useState(null);
  const [beaPce, setBeaPce] = useState(null);
  const [expandCPI, setExpandCPI] = useState(false);
  const [expandPCE, setExpandPCE] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const out = {};
      for (let i = 0; i < IDS.length; i += 6) {
        const got = await Promise.all(IDS.slice(i, i + 6).map(async ([id, lim]) => {
          try { return [id, await fetchFred(id, null, lim)]; }
          catch (e) { console.warn(`Inflation: ${id} —`, e.message); return [id, []]; }
        }));
        got.forEach(([id, obs]) => { out[id] = obs; });
      }
      if (live) setF(out);
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => { fetch("/api/bls-cpi").then(r => r.json()).then(setBls).catch(e => console.warn("BLS CPI:", e.message)); }, []);
  useEffect(() => { fetch("/api/bea-pce").then(r => r.json()).then(d => { if (d?.PCEPI) setBeaPce(d); }).catch(() => {}); }, []);

  const pceData = beaPce?.PCEPI || cd.PCEPI;
  const corePceData = beaPce?.PCEPILFE || cd.PCEPILFE;

  // goods-vs-services YoY history, the structural split
  // year-over-year, joined on dates rather than on array position, since the
  // three series need not start in the same month
  const splitHist = useMemo(() => {
    if (!f?.CUSR0000SACL1E?.length) return [];
    const yoyOf = arr => {
      const by = new Map((arr || []).map(o => [o.d, o.v]));
      const out = new Map();
      for (const o of arr || []) {
        const p = o.d.split("-");
        const prior = by.get(`${+p[0] - 1}-${p[1]}-${p[2]}`);
        if (fin(prior) && prior !== 0) out.set(o.d, ((o.v - prior) / prior) * 100);
      }
      return out;
    };
    const g = yoyOf(f.CUSR0000SACL1E), s = yoyOf(f.CUSR0000SASLE), h = yoyOf(f.CUSR0000SAH1);
    return [...g.keys()].sort()
      .map(d => ({ d, goods: g.get(d) ?? null, services: s.get(d) ?? null, shelter: h.get(d) ?? null }))
      .slice(-84);
  }, [f]);

  const catBars = useMemo(() => {
    if (!bls) return [];
    return BLS_CATEGORIES.filter(c => c.id !== "CUSR0000SA0" && c.id !== "CUSR0000SA0L1E")
      .map(c => ({ name: c.label, value: bls[c.id]?.yoy ?? 0, color: c.color }))
      .sort((a, b) => a.value - b.value);
  }, [bls]);

  if (!f) return <div style={{ ...card, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading price indices, trimmed measures and inflation expectations…</div>;

  const V = id => lastV(f[id]);
  const corePce12 = ann(f.PCEPILFE, 12), corePce3 = ann(f.PCEPILFE, 3), corePce6 = ann(f.PCEPILFE, 6);
  const coreCpi12 = ann(f.CPILFESL, 12), coreCpi3 = ann(f.CPILFESL, 3);
  const cpi12 = ann(f.CPIAUCSL, 12);
  const asOf = lastD(f.CPIAUCSL);

  const trend = !fin(corePce3) || !fin(corePce12) ? "hard to read"
    : corePce3 < corePce12 - 0.2 ? "still under way" : corePce3 > corePce12 + 0.2 ? "over — prices are re-accelerating" : "stalled";
  const gap = fin(corePce12) ? corePce12 - 2 : null;

  const momentumRow = (id, m) => {
    const arr = f[id];
    const a1 = ann(arr, 1), a3 = ann(arr, 3), a6 = ann(arr, 6), a12 = ann(arr, 12);
    if (!fin(a12)) return null;
    return (
      <tr key={id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: m.color, marginRight: 6 }} />{m.label}
        </td>
        {td(pc(a1, 1), dirColor(a1, a12))}
        {td(pc(a3, 1), dirColor(a3, a12), { fontWeight: 600 })}
        {td(pc(a6, 1), dirColor(a6, a12))}
        {td(pc(a12, 1), "var(--text-primary)", { fontWeight: 600 })}
        {td(`${arrow(a3, a12)} ${fin(a3) && fin(a12) ? pp(a3 - a12, 1) : "—"}`, dirColor(a3, a12), { fontSize: 9.5 })}
        <td style={{ padding: "4px 6px", textAlign: "right" }}><RangeBar pct={pctile((arr || []).slice(-240).map((_, i, s) => (i >= 12 ? ((s[i].v - s[i - 12].v) / s[i - 12].v) * 100 : null)).filter(fin), a12)} color={m.color} /></td>
      </tr>
    );
  };

  const rateRow = (id, m) => {
    const v = V(id);
    if (!fin(v)) return null;
    const m3 = m.m3 ? V(m.m3) : null, m1 = m.m1 ? V(m.m1) : null;
    return (
      <tr key={id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: m.color, marginRight: 6 }} />{m.label}
        </td>
        {td(pc(m1, 1), fin(m1) ? dirColor(m1, v) : DIM)}
        {td(pc(m3, 1), fin(m3) ? dirColor(m3, v) : DIM, { fontWeight: 600 })}
        {td("—", DIM)}
        {td(pc(v, 1), "var(--text-primary)", { fontWeight: 600 })}
        {td(fin(m3) ? `${arrow(m3, v)} ${pp(m3 - v, 1)}` : "—", fin(m3) ? dirColor(m3, v) : DIM, { fontSize: 9.5 })}
        <td style={{ padding: "4px 6px", textAlign: "right" }}><RangeBar pct={pctile((f[id] || []).slice(-240).map(o => o.v), v)} color={m.color} /></td>
      </tr>
    );
  };

  const SplitHover = ({ active, label: l }) => {
    if (!active) return null;
    const r = splitHist.find(x => x.d === l);
    if (!r) return null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{fmtMon(l)} · year over year</div>
        <div style={{ fontSize: 10.5, marginTop: 3 }}>core goods <span style={{ color: TEAL }}>{pc(r.goods)}</span> · core services <span style={{ color: VIOLET }}>{pc(r.services)}</span></div>
        <div style={{ fontSize: 10.5, color: CYAN }}>shelter {pc(r.shelter)}</div>
      </div>
    );
  };

  return (<>
    <DenseHeader
      eyebrow="Inflation · the level, and — more usefully — the momentum"
      headline={<>Core PCE is {pc(corePce12, 1)}, {fin(gap) ? `${pp(gap, 1)}pp ${gap > 0 ? "above" : "below"} target` : "near target"}, and the three-month run rate of {pc(corePce3, 1)} says disinflation is {trend}</>}
      blurb="A twelve-month rate is an average of twelve decisions, eleven of which are already history. Reading the same index over one, three and six months annualised shows where it is going rather than where it has been — and when the short windows sit below the twelve-month, the annual figure still has room to fall on arithmetic alone."
      meta={<>CPI through {fmtMon(asOf)} · PCE through {fmtMon(lastD(f.PCEPILFE))}<br />BLS · BEA{beaPce ? " (live)" : ""} · Cleveland, Atlanta &amp; Dallas Fed</>}
      chips={[
        chip("CPI", pc(cd.CPIAUCSL?.yoy ?? cpi12, 1), RED, `core ${pc(cd.CPILFESL?.yoy ?? coreCpi12, 1)}`),
        chip("core CPI, 3-month", pc(coreCpi3, 1), dirColor(coreCpi3, coreCpi12), `vs ${pc(coreCpi12, 1)} over twelve`),
        chip("PCE", pc(pceData?.yoy, 1), ORANGE, "BEA headline"),
        chip("core PCE", pc(corePce12, 1), corePce12 > 2.5 ? AMBER : GREEN, "the Fed's actual target"),
        chip("core PCE, 3-month", pc(corePce3, 1), dirColor(corePce3, corePce12), `six-month ${pc(corePce6, 1)}`),
        chip("median CPI", pc(V("MEDCPIM159SFRBCLE"), 1), INDIGO, "least distorted by outliers"),
        chip("sticky core", pc(V("CORESTICKM159SFRBATL"), 1), AMBER, "prices that reset slowly"),
        chip("10Y breakeven", pc(V("T10YIE"), 2), V("T10YIE") > 2.5 ? AMBER : GREEN, `5y5y ${pc(V("T5YIFR"), 2)}`),
      ]}
    />

    <Panel title="Momentum — the same index over one, three, six and twelve months, annualised" right={`through ${fmtMon(asOf)}`} pad="10px 12px 8px">
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr>{th("measure", "left")}{th("1-month")}{th("3-month")}{th("6-month")}{th("12-month")}{th("3m vs 12m")}{th("20y range")}</tr></thead>
          <tbody>
            <tr><td colSpan={7} style={{ ...label, padding: "8px 6px 3px", fontSize: 8.5, color: INDIGO }}>Headline measures</td></tr>
            {Object.entries(INDEX).filter(([, m]) => m.group === "Headline").map(([id, m]) => momentumRow(id, m))}
            <tr><td colSpan={7} style={{ ...label, padding: "12px 6px 3px", fontSize: 8.5, color: VIOLET }}>What sits underneath</td></tr>
            {Object.entries(INDEX).filter(([, m]) => m.group === "Underneath").map(([id, m]) => momentumRow(id, m))}
            <tr><td colSpan={7} style={{ ...label, padding: "12px 6px 3px", fontSize: 8.5, color: AMBER }}>Trimmed and central-tendency measures</td></tr>
            {Object.entries(RATE).map(([id, m]) => rateRow(id, m))}
          </tbody>
        </table>
      </div>
      <Note>
        Colour is relative to each row's own twelve-month rate: <span style={{ color: GREEN }}>green</span> means the short window is running cooler than the annual figure, <span style={{ color: RED }}>red</span> hotter. The trimmed measures publish as rates rather than indices, so only the windows their sources compute are shown. The range marker is the percentile of the twelve-month rate within its last twenty years.
      </Note>
    </Panel>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(340px, 100%),1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Goods against services — two different inflations" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={224}>
          <LineChart data={splitHist} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(0)}%`} allowDecimals={false} />
            <Tooltip content={<SplitHover />} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <ReferenceLine y={2} stroke={`${AMBER}55`} strokeDasharray="4 4" />
            <ReferenceLine y={0} stroke="var(--text-muted)" />
            <Line type="monotone" dataKey="goods" name="Core goods" stroke={TEAL} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="services" name="Core services" stroke={VIOLET} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="shelter" name="Shelter" stroke={CYAN} strokeWidth={1.4} dot={false} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
        <Note>Goods inflation is a supply-chain and dollar story and turns fast. Services inflation is mostly wages and shelter, turns slowly, and is the part that decides whether the Fed can cut.</Note>
      </Panel>

      <Panel title={`Category detail — year over year, ${bls ? fmtMon(bls["CUSR0000SA0"]?.lastDate) : "loading"}`} style={{ marginBottom: 0 }}>
        {!bls ? (
          <div style={{ ...note, padding: "30px 6px", textAlign: "center" }}>Loading BLS categories…</div>
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            <BarChart data={catBars} layout="vertical" margin={{ top: 0, right: 26, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`} />
              <YAxis type="category" dataKey="name" tick={{ ...axis, fontSize: 9 }} axisLine={false} tickLine={false} width={126} />
              <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={v => [pc(v, 2), "year over year"]} />
              <ReferenceLine x={0} stroke="var(--text-muted)" />
              <ReferenceLine x={2} stroke={AMBER} strokeDasharray="4 4" label={{ value: "2%", fill: AMBER, fontSize: 8.5, fontFamily: fonts.mono, position: "top" }} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} barSize={12}>
                {catBars.map((e, i) => <Cell key={i} fill={e.value > 2 ? RED : e.value < 0 ? GREEN : BLUE} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <Note>Straight from the BLS API rather than FRED, so it reflects the release the morning it lands.</Note>
      </Panel>
    </div>

    <Panel title="What the market and households expect next" right="breakevens carry a liquidity discount; surveys carry a gasoline bias">
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead><tr>{th("measure", "left")}{th("source", "left")}{th("level")}{th("1m chg")}{th("1y chg")}{th("vs 2% target")}{th("own 5y range")}</tr></thead>
          <tbody>
            {EXPECT.map(e => {
              const arr = f[e.id], v = lastV(arr);
              if (!fin(v)) return null;
              const n1 = e.id.startsWith("T") ? 21 : 1, n12 = e.id.startsWith("T") ? 252 : 12;
              const d1 = arr.length > n1 ? v - arr[arr.length - 1 - n1].v : null;
              const d12 = arr.length > n12 ? v - arr[arr.length - 1 - n12].v : null;
              return (
                <tr key={e.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: e.color, marginRight: 6 }} />{e.label}
                  </td>
                  {tdL(e.src, DIM, { fontSize: 9.5 })}
                  {td(pc(v, 2), e.color, { fontWeight: 600 })}
                  {td(fin(d1) ? `${d1 > 0 ? "+" : "−"}${Math.abs(d1 * 100).toFixed(0)}bp` : "—", !fin(d1) ? DIM : d1 > 0 ? RED : GREEN)}
                  {td(fin(d12) ? `${d12 > 0 ? "+" : "−"}${Math.abs(d12 * 100).toFixed(0)}bp` : "—", !fin(d12) ? DIM : d12 > 0 ? RED : GREEN)}
                  {td(pp(v - 2, 2), v > 2.4 ? AMBER : v < 1.7 ? BLUE : GREEN)}
                  <td style={{ padding: "4px 6px", textAlign: "right" }}><RangeBar pct={pctile((arr || []).map(o => o.v), v)} color={e.color} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Note>
        Breakevens are CPI-referenced while the Fed targets PCE, and CPI has run roughly 0.3pp hotter over long stretches — so a 2.3% breakeven is close to a 2% PCE target, not above it. The Michigan survey moves with gasoline prices far more than with realised inflation; treat a jump there as a petrol headline, not a regime change.
      </Note>
    </Panel>

    <Panel title="Component detail" right="click a group to expand the full FRED component list">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => setExpandCPI(v => !v)} style={{
          padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono,
          border: `1px solid ${expandCPI ? "#818cf8" : "var(--border-subtle)"}`,
          background: expandCPI ? "rgba(129,140,248,0.15)" : "transparent", color: expandCPI ? "#c7d2fe" : SLATE,
        }}>{expandCPI ? "▲" : "▼"} CPI components</button>
        <button onClick={() => setExpandPCE(v => !v)} style={{
          padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono,
          border: `1px solid ${expandPCE ? "#f97316" : "var(--border-subtle)"}`,
          background: expandPCE ? "rgba(249,115,22,0.15)" : "transparent", color: expandPCE ? "#fdba74" : SLATE,
        }}>{expandPCE ? "▲" : "▼"} PCE components</button>
      </div>
      {expandCPI && <ComponentTable components={CPI_COMPONENTS} cd={cd} accent={RED} />}
      {expandPCE && <ComponentTable components={PCE_COMPONENTS} cd={cd} accent={ORANGE} />}
    </Panel>
  </>);
}

// ── the old expandable bar list, rebuilt as a two-column dense table ──
function ComponentTable({ components, cd, accent }) {
  const items = Object.entries(components)
    .map(([id, m]) => ({ id, label: m.label, color: m.color, group: m.group, freq: m.freq, yoy: cd[id]?.yoy, date: cd[id]?.lastDate }))
    .filter(x => fin(x.yoy));
  if (!items.length) return <Note>Component data still loading.</Note>;
  const maxAbs = Math.max(...items.map(x => Math.abs(x.yoy)), 0.1);
  const groups = [...new Set(items.map(x => x.group))];

  return (
    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(310px, 100%),1fr))", gap: "0 18px" }}>
      {groups.map(g => (
        <div key={g} style={{ breakInside: "avoid" }}>
          <div style={{ ...label, fontSize: 8.5, color: accent, margin: "8px 0 2px" }}>{g}</div>
          <table style={tableStyle}>
            <tbody>
              {items.filter(x => x.group === g).sort((a, b) => b.yoy - a.yoy).map(x => (
                <tr key={x.id}>
                  <td style={{ padding: "2.5px 6px 2.5px 0", fontSize: 10, fontFamily: fonts.mono, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {x.label}{x.freq === "Q" ? <span style={{ color: DIM, fontSize: 8 }}> Q</span> : null}
                  </td>
                  <td style={{ width: "48%", padding: "2.5px 6px" }}>
                    <span style={{ display: "block", position: "relative", height: 8, background: "var(--bg-subtle)", borderRadius: 2 }}>
                      <span style={{
                        position: "absolute", top: 0, bottom: 0, borderRadius: 2,
                        [x.yoy < 0 ? "right" : "left"]: "50%",
                        width: `${(Math.abs(x.yoy) / maxAbs) * 50}%`,
                        background: x.yoy < 0 ? GREEN : x.yoy > 2 ? RED : BLUE, opacity: 0.8,
                      }} />
                      <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--text-muted)" }} />
                    </span>
                  </td>
                  {td(`${x.yoy > 0 ? "+" : ""}${x.yoy.toFixed(1)}%`, x.yoy < 0 ? GREEN : x.yoy > 2 ? RED : "var(--text-secondary)", { fontSize: 10, width: 52 })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default CpiTab;
