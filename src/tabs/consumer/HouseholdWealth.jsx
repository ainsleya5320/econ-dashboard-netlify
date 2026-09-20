import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, BLUE, ORANGE, PINK, TEAL,
  fin, card, label, note, tip, axis, pc, pp, th, td, tdL, tableStyle,
  chip, DenseHeader, Panel, Note, DataTable, useIsPhone,
} from "../../components/dense.jsx";

// ============================================================================
// HOUSEHOLD WEALTH — the Survey of Consumer Finances, two ways.
//
// The Fed's Distributional Financial Accounts carry the SCF distribution
// forward quarterly against the Z.1, so the levels here are current rather than
// a four-year-old snapshot. Because they are built from aggregates, every
// per-household figure below is a MEAN. The SCF's own Table 4 supplies the
// medians, which for wealth run about a fifth of the mean — the last section on
// this panel exists to keep that distinction in front of the reader.
// Data: /api/household-wealth (server/householdWealth.js).
// ============================================================================

const COMP = [
  { k: "equities", label: "Equities & funds", color: GREEN },
  { k: "business", label: "Private business", color: AMBER },
  { k: "realEstate", label: "Real estate", color: CYAN },
  { k: "dcPension", label: "DC pensions (401k/IRA)", color: INDIGO },
  { k: "dbPension", label: "DB pensions", color: VIOLET },
  { k: "durables", label: "Cars & durables", color: ORANGE },
  { k: "other", label: "Other assets", color: SLATE },
];
const GROUP_COLORS = [GREEN, TEAL, INDIGO, VIOLET, RED];

// DFA levels arrive in millions of dollars
const tril = v => (fin(v) ? `$${(v / 1e6).toFixed(2)}T` : "—");
const perHh = v => (!fin(v) ? "—"
  : v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`
  : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
const hh = v => (!fin(v) ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1e3)}k`);
// the SCF publishes in thousands of 2022 dollars
const scfUsd = v => (!fin(v) ? "—" : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(2)}M` : `$${Math.round(v)}k`);

export default function HouseholdWealthPanel() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [cut, setCut] = useState("wealth");

  useEffect(() => {
    fetch("/api/household-wealth").then(r => r.json())
      .then(x => (x.error ? setErr(x.error) : setD(x)))
      .catch(e => setErr(String(e)));
  }, []);

  const C = d?.cuts?.[cut];

  // stacked share history, thinned to one point a year so the axis stays legible
  const shareHist = useMemo(() => {
    if (!C) return [];
    return C.history.filter(r => r.d.endsWith(":Q4") || r.d === C.asOf);
  }, [C]);

  if (err) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Household wealth could not load: {err}</div>;
  if (!d || !C) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "var(--text-muted)", fontFamily: fonts.mono }}>Loading the Distributional Financial Accounts and the SCF tables…</div>;

  const G = C.groups;
  const top = G[0], bottom = G[G.length - 1];
  const scf = d.scf;
  const wealthCut = d.cuts.wealth;
  const top1 = wealthCut.groups[0], top1b = wealthCut.groups[1];
  const top1Share = fin(top1?.share) && fin(top1b?.share) ? top1.share + top1b.share : null;
  const bottom50 = wealthCut.groups[wealthCut.groups.length - 1];
  const gap = fin(top1?.perHousehold) && fin(bottom50?.perHousehold) && bottom50.perHousehold > 0
    ? top1.perHousehold / bottom50.perHousehold : null;
  const boom = d.cuts.generation.groups.find(g => g.key === "BabyBoom");
  const mil = d.cuts.generation.groups.find(g => g.key === "Millennial");
  const scfRatio = scf?.all && scf.all.median > 0 ? scf.all.mean / scf.all.median : null;

  const ShareHover = ({ active, label: l }) => {
    if (!active) return null;
    const r = shareHist.find(x => x.d === l);
    if (!r) return null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{l}</div>
        {G.map((g, i) => (
          <div key={g.key} style={{ fontSize: 10.5, marginTop: 1 }}>
            <span style={{ color: GROUP_COLORS[i % GROUP_COLORS.length] }}>{g.label}</span>
            {" "}{pc(r[g.key], 1)} of all wealth · {perHh(r[`${g.key}_ph`])} each
          </div>
        ))}
      </div>
    );
  };

  const pill = (id, text) => (
    <button key={id} onClick={() => setCut(id)} style={{
      padding: "4px 12px", borderRadius: 7, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono,
      border: `1px solid ${cut === id ? "#818cf8" : "var(--border-subtle)"}`,
      background: cut === id ? "rgba(129,140,248,0.15)" : "transparent",
      color: cut === id ? "#c7d2fe" : SLATE, fontWeight: cut === id ? 600 : 400,
    }}>{text}</button>
  );

  return (<>
    <DenseHeader
      eyebrow={`Household net worth · Survey of Consumer Finances, carried forward to ${C.asOf}`}
      headline={<>
        The top 0.1% — {hh(top1?.households)} households — hold {perHh(top1?.perHousehold)} each, while the bottom half,
        {" "}{hh(bottom50?.households)} households, hold {perHh(bottom50?.perHousehold)} each
        {fin(gap) ? <> — a gap of {Math.round(gap).toLocaleString()}×</> : null}
      </>}
      blurb={<>
        The SCF runs every three years and 2022 is still the latest wave, so the Fed benchmarks its distribution
        to the quarterly Financial Accounts to keep it current. That is what these levels are. Because the method
        starts from aggregates, every per-household figure here is a <strong style={{ color: "var(--text-primary)" }}>mean</strong> —
        for wealth the mean runs about {fin(scfRatio) ? `${scfRatio.toFixed(1)}×` : "five times"} the median, so the
        section at the bottom carries the SCF's own medians as the corrective.
      </>}
      meta={<>
        DFA through {C.asOf} · entry cutoffs from the {C.cutoffAsOf || "—"} survey<br />
        SCF Table 4, {scf?.year || "—"} wave · built {new Date(d.built).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </>}
      chips={[
        chip("top 0.1%", perHh(top1?.perHousehold), GREEN, `${pc(top1?.share, 1)} of all wealth`),
        chip("top 1%", pc(top1Share, 1), GREEN, "share of all household wealth"),
        chip("bottom 50%", perHh(bottom50?.perHousehold), RED, `${pc(bottom50?.share, 1)} of all wealth`),
        chip("to reach the top 1%", perHh(top1b?.cutoff), AMBER, `top 10% at ${perHh(wealthCut.groups[2]?.cutoff)}`),
        chip("Boomers hold", pc(boom?.share, 1), VIOLET, `${hh(boom?.households)} households`),
        chip("Millennials hold", pc(mil?.share, 1), TEAL, `${hh(mil?.households)} households`),
        chip("median household", scfUsd(scf?.all?.median), INDIGO, `SCF ${scf?.year}, real`),
        chip("mean household", scfUsd(scf?.all?.mean), SLATE, fin(scfRatio) ? `${scfRatio.toFixed(1)}× the median` : null),
      ]}
    />

    <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={note}>Cut by</span>
      {pill("wealth", "Wealth percentile")}
      {pill("generation", "Generation")}
      <span style={{ ...note, marginLeft: 4 }}>{C.groups.length} groups · quarterly since {C.since}</span>
    </div>

    <Panel title={`Net worth by ${cut === "wealth" ? "wealth percentile" : "generation"}`} right={`${C.asOf} · levels are means, not medians`} pad="10px 12px 8px">
      <DataTable
        rows={G.map((g, i) => ({ ...g, key: g.key, i, color: GROUP_COLORS[i % GROUP_COLORS.length],
          dShare: fin(g.share) && fin(g.shareThen) ? g.share - g.shareThen : null }))}
        cols={[
          { key: "label", label: "group", primary: true, render: r => (<>
            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: r.color, marginRight: 6 }} />{r.label}
          </>) },
          { key: "blurb", label: "who", align: "left", hide: true, render: r => <span style={{ color: DIM, fontSize: 9 }}>{r.blurb}</span> },
          { key: "hh", label: "households", render: r => hh(r.households) },
          { key: "nw", label: "total net worth", render: r => tril(r.netWorth) },
          { key: "perHh", label: "per household", render: r => <span style={{ color: r.color, fontWeight: 700 }}>{perHh(r.perHousehold)}</span> },
          { key: "share", label: "share", render: r => <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{pc(r.share, 1)}</span> },
          { key: "d5", label: "5y chg", render: r => <span style={{ color: !fin(r.dShare) ? DIM : r.dShare > 0 ? GREEN : RED }}>{fin(r.dShare) ? `${pp(r.dShare, 1)}pp` : "—"}</span> },
          { key: "cutoff", label: "entry cutoff", render: r => <span style={{ color: fin(r.cutoff) ? AMBER : DIM }}>{fin(r.cutoff) ? perHh(r.cutoff) : "—"}</span> },
          { key: "lev", label: "debt / assets", render: r => <span style={{ color: r.leverage > 30 ? RED : r.leverage > 10 ? AMBER : "var(--text-secondary)" }}>{pc(r.leverage, 1)}</span> },
        ]}
      />
      <Note>
        {cut === "wealth"
          ? <>The entry cutoff is the wealth it takes to reach a group&apos;s bottom edge. It comes straight from the survey
              rather than the interpolation, so it exists only in survey years — the last read is {C.cutoffAsOf}. </>
          : <>The DFA publishes entry cutoffs only for the wealth-percentile cut, so that column is empty here. </>}
        Debt over assets is the same balance sheet read as leverage: {bottom?.label} at {pc(bottom?.leverage, 0)}
        {" "}against {top?.label} at {pc(top?.leverage, 0)}.
      </Note>
    </Panel>

    <Panel title="What each group's wealth is actually made of" right="share of gross assets, latest quarter">
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 2 }}>
        {G.map(g => {
          const parts = COMP.map(c => ({ ...c, v: g.comp?.[c.k] })).filter(p => fin(p.v) && p.v > 0);
          const total = parts.reduce((s, p) => s + p.v, 0);
          if (!total) return null;
          return (
            <div key={g.key}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                <span style={{ fontSize: 10, fontFamily: fonts.mono, color: "var(--text-primary)", fontWeight: 600 }}>{g.label}</span>
                <span style={{ ...note }}>{tril(g.assets)} of assets against {tril(g.liabilities)} of debt</span>
              </div>
              <div style={{ display: "flex", height: 17, borderRadius: 3, overflow: "hidden", background: "var(--bg-subtle)" }}>
                {parts.map(p => {
                  const w = (p.v / total) * 100;
                  return (
                    <div key={p.k} title={`${p.label}: ${tril(p.v)} (${w.toFixed(1)}% of assets)`}
                      style={{ width: `${w}%`, background: p.color, opacity: 0.85, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {w > 9 && <span style={{ fontSize: 8.5, fontFamily: fonts.mono, color: "#0b121c", fontWeight: 700 }}>{w.toFixed(0)}%</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 9 }}>
        {COMP.map(c => (
          <span key={c.k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, display: "inline-block" }} />
            <span style={{ fontSize: 9, fontFamily: fonts.mono, color: "var(--text-secondary)" }}>{c.label}</span>
          </span>
        ))}
      </div>
      <Note>
        {cut === "wealth"
          ? <>This is the K-shape stated precisely. The top 0.1% hold 57% of their assets in equities and another 17% in
              private businesses — things that compound, and are taxed only when sold. The bottom half hold 47% in a house
              and 21% in cars and appliances, against debt worth 58% of everything they own. The two groups do not merely
              differ in size; they respond to different things — one to markets, the other to mortgage rates and the
              price of a used car.</>
          : <>This is the life cycle, not a hierarchy. Millennials hold 38% of their assets in real estate and 21% in
              equities, carrying debt equal to 29% of the lot; the Silent generation has it almost exactly reversed —
              45% equities, 19% real estate, 2% leverage. Households buy a leveraged house first and a portfolio later.
              The one line that barely moves across generations is private business, steady near 8% for all four, which
              is a hint that ownership is less about age than about who had capital to start with.</>}
      </Note>
    </Panel>

    <Panel title="Share of all household wealth" right={`year-end readings since ${C.since}, plus ${C.asOf}`}>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={shareHist} margin={{ top: 6, right: 8, left: -10, bottom: 0 }} stackOffset="expand">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 4)} minTickGap={28} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
          <Tooltip content={<ShareHover />} />
          <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={6} />
          {[...G].reverse().map((g) => {
            const i = G.findIndex(x => x.key === g.key);
            return (
              <Area key={g.key} type="monotone" dataKey={g.key} name={g.label} stackId="1"
                stroke={GROUP_COLORS[i % GROUP_COLORS.length]} fill={GROUP_COLORS[i % GROUP_COLORS.length]}
                fillOpacity={0.55} strokeWidth={1} />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
      <Note>
        Bands are shares, so they always sum to 100 — what moves is who owns the pie. Hovering gives each group's dollars
        per household at that date, which is the number that has actually changed: nearly every group is richer in nominal
        terms than in 1989, and the distribution still shifted upward.
      </Note>
    </Panel>

    {scf && (
      <Panel title={`The corrective — SCF ${scf.year} medians against means`} right={scf.unit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(300px, 100%),1fr))", gap: "0 18px" }}>
          <div style={{ gridColumn: "1 / -1", marginBottom: 6 }}>
            <ResponsiveContainer width="100%" height={168}>
              <LineChart data={scf.allHistory} margin={{ top: 6, right: 10, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="year" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => (v >= 1000 ? `$${(v / 1000).toFixed(1)}M` : `$${v}k`)} />
                <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }}
                  labelFormatter={y => `${y} survey`} formatter={(v, n) => [scfUsd(v), n === "median" ? "median family" : "mean family"]} />
                <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6}
                  formatter={v => (v === "median" ? "median family net worth" : "mean family net worth")} />
                <Line type="monotone" dataKey="mean" name="mean" stroke={SLATE} strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="median" name="median" stroke={INDIGO} strokeWidth={2.4} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
            <Note>
              Every wave since 1989, in constant {scf.year} dollars. The two lines started {scf.allHistory?.[0] && scf.allHistory[0].median > 0 ? `${(scf.allHistory[0].mean / scf.allHistory[0].median).toFixed(1)}×` : ""} apart
              and are now {fin(scfRatio) ? `${scfRatio.toFixed(1)}×` : ""} apart. When a headline quotes the mean, this is the number it is quoting.
            </Note>
          </div>

          {scf.sections.map(sec => (
            <div key={sec.name} style={{ breakInside: "avoid" }}>
              <div style={{ ...label, fontSize: 8.5, color: INDIGO, margin: "8px 0 2px" }}>{sec.name}</div>
              <table style={tableStyle}>
                <thead><tr>{th("", "left")}{th("median")}{th("mean")}{th("mean ÷ med")}</tr></thead>
                <tbody>
                  {sec.rows.map(r => (
                    <tr key={r.label} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                      {tdL(r.label, "var(--text-secondary)", { fontSize: 9.5 })}
                      {td(scfUsd(r.median), "var(--text-primary)", { fontSize: 10, fontWeight: 600 })}
                      {td(scfUsd(r.mean), DIM, { fontSize: 10 })}
                      {td(fin(r.ratio) ? `${r.ratio.toFixed(1)}×` : "—", !fin(r.ratio) ? DIM : r.ratio > 6 ? RED : r.ratio > 4 ? AMBER : GREEN, { fontSize: 10 })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <Note>
          Triennial and four years old — the 2025 wave is fielded but unpublished. It is still the only source for a median,
          and the mean-to-median column is the reason it earns the space: the higher that ratio, the more the group's average
          is being carried by a few households at its top, and the less the mean describes anyone in it.
        </Note>
      </Panel>
    )}
  </>);
}
