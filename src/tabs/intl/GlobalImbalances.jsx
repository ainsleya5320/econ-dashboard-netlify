import React, { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { fonts } from "../../lib/styles.js";
import { AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, TEAL, fin, card, tip, axis, Panel, Note, DataTable, useIsPhone, chartH } from "../../components/dense.jsx";

// ============================================================================
// GLOBAL IMBALANCES — International → Forex → Global drivers.
// The world's current-account surpluses and deficits as a share of world GDP,
// 1980 through the IMF's projections, split by who runs them. Gita Gopinath's
// warning (Conversations with Tyler, Sept 2026): imbalances matter when they
// reflect policy failures, and growing imbalances preceded both the 1980s
// trade war that ended in the Plaza Accord and 2008. The U.S. current account
// on its own lives on the U.S. Tightening monitor; this is the world view.
// Data: /api/trade-flows (server/tradeFlows.js), IMF DataMapper.
// ============================================================================

const GROUPS = [["china", "China", RED], ["euro", "Euro area", CYAN], ["japan", "Japan", VIOLET], ["oil", "Oil exporters", AMBER], ["us", "United States", INDIGO], ["rest", "Everyone else", SLATE]];

export default function GlobalImbalances() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const phone = useIsPhone();
  useEffect(() => {
    fetch("/api/trade-flows").then(r => r.json()).then(x => (x.error ? setErr(x.error) : setD(x))).catch(e => setErr(String(e)));
  }, []);
  if (err) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono, marginTop: 10 }}>Global imbalances could not load: {err}</div>;
  if (!d) return null;

  const rows = d.imbalances;
  const actual = rows.filter(r => !r.proj);
  const now = actual[actual.length - 1];
  const peak = actual.reduce((m, r) => (!m || r.gross > m.gross ? r : m), null);
  const plaza = rows.find(r => r.y === 1985);
  const low = actual.filter(r => r.y >= 2015).reduce((m, r) => (!m || r.gross < m.gross ? r : m), null);
  const last = rows[rows.length - 1];
  const firstProj = rows.find(r => r.proj)?.y;
  const chinaPeak = actual.reduce((m, r) => (!m || r.china > m.china ? r : m), null);

  return (
    <Panel title="Global imbalances — the world's surpluses and deficits" right={`% of world GDP · IMF actuals to ${now?.y}, projections to ${last?.y}`} style={{ marginTop: 12 }}>
      <ResponsiveContainer width="100%" height={chartH(phone, 260)}>
        <ComposedChart data={rows} stackOffset="sign" margin={{ top: 8, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="y" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={24} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
          {firstProj && <ReferenceArea x1={firstProj} x2={last.y} fill="var(--text-muted)" fillOpacity={0.07} label={{ value: "IMF projection", position: "insideTop", fontSize: 8.5, fill: DIM, fontFamily: fonts.mono }} />}
          <ReferenceLine x={1985} stroke={DIM} strokeDasharray="3 3" label={{ value: "Plaza", position: "top", fontSize: 8.5, fill: DIM, fontFamily: fonts.mono }} />
          <ReferenceLine x={2007} stroke={DIM} strokeDasharray="3 3" label={{ value: "2007", position: "top", fontSize: 8.5, fill: DIM, fontFamily: fonts.mono }} />
          <ReferenceLine y={0} stroke="var(--border-subtle)" />
          <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }}
            labelFormatter={y => `${y}${rows.find(r => r.y === y)?.proj ? " (projection)" : ""}`}
            formatter={(v, n) => [fin(v) ? `${v.toFixed(2)}%` : "—", n]} />
          <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
          {GROUPS.map(([k, name, c]) => <Bar key={k} dataKey={k} name={name} stackId="ca" fill={c} fillOpacity={0.75} />)}
          <Line type="monotone" dataKey="gross" name="all surpluses + deficits" stroke="var(--text-primary)" strokeWidth={1.6} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <Note>
        Bars above zero are surpluses, below are deficits; the line adds every country&apos;s surplus and deficit together, the usual
        measure of how imbalanced the world is. It stood at {plaza?.gross.toFixed(1)}% in 1985, peaked at {peak?.gross.toFixed(1)}% in
        {" "}{peak?.y}, fell to {low?.gross.toFixed(1)}% in {low?.y} and is back to {now?.gross.toFixed(1)}% in {now?.y} —
        {" "}{now && plaza ? (now.gross > plaza.gross ? "above" : "below") : ""} the Plaza level, {now && peak && now.gross < peak.gross * 0.8 ? "well below" : "near"} {peak?.y}. China&apos;s surplus is {now?.china.toFixed(2)}% of world GDP{chinaPeak && chinaPeak.y !== now?.y ? `, against its ${chinaPeak.y} peak of ${chinaPeak.china.toFixed(2)}%` : ", its highest on record"}.
        Gopinath&apos;s reading: a Chinese surplus of this size reflects weak household demand and a property bust rather than
        export strength, and imbalances like these preceded both the 1980s trade war and 2008. Surpluses and deficits do not sum to
        zero because the world&apos;s statistics never have. Euro-area membership is held at today&apos;s for every year.
      </Note>
      <DataTable
        dense
        rows={d.largest.map(x => ({ ...x, key: x.iso }))}
        cols={[
          { key: "name", label: `largest balances, ${d.largestYear}`, primary: true, render: r => r.name },
          { key: "usdB", label: "$bn", render: r => <span style={{ color: r.usdB >= 0 ? TEAL : RED, fontWeight: 600 }}>{r.usdB >= 0 ? "+" : "−"}${Math.abs(r.usdB).toFixed(0)}B</span> },
          { key: "ca", label: "% of own GDP", render: r => `${r.ca > 0 ? "+" : ""}${r.ca}%` },
          { key: "world", label: "% of world GDP", render: r => `${r.world > 0 ? "+" : ""}${r.world}%` },
        ]}
      />
    </Panel>
  );
}
