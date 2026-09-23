import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import { AMBER, SLATE, DIM, CYAN, fin, card, tip, axis, Panel, Note, DataTable, useIsPhone, chartH } from "../../components/dense.jsx";

// ============================================================================
// THE LAST MILE — International → Pulse.
// Argentina's disinflation against every triple-digit episode since 1980, to
// test Gita Gopinath's claim (Conversations with Tyler, Sept 2026) that the
// last stretch — from around 30% down to single digits — always takes longer
// than getting out of triple digits. The clock starts at each episode's LAST
// triple-digit year. Annual-average CPI from the IMF, so it lags the monthly
// prints Argentina's headlines quote; years past the last actual are the
// IMF's projections.
// Data: /api/trade-flows (server/tradeFlows.js), IMF DataMapper PCPIPCH.
// ============================================================================

export default function LastMile() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const phone = useIsPhone();
  useEffect(() => {
    fetch("/api/trade-flows").then(r => r.json()).then(x => (x.error ? setErr(x.error) : setD(x))).catch(e => setErr(String(e)));
  }, []);

  const chart = useMemo(() => {
    if (!d) return [];
    const byT = new Map();
    for (const e of d.lastMile) for (const p of e.path) {
      if (p.t < -1) continue
      const row = byT.get(p.t) || { t: p.t };
      row[e.key] = Math.max(p.v, 0.5); // log axis: clamp deflation to a floor
      byT.set(p.t, row);
    }
    return [...byT.values()].sort((a, b) => a.t - b.t);
  }, [d]);

  if (err) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>The last-mile panel could not load: {err}</div>;
  if (!d) return null;

  const cur = d.lastMile.find(e => e.current);
  const past = d.lastMile.filter(e => !e.current);
  const s = d.lastMileStats;
  const curPath = cur ? cur.path.filter(p => p.t >= 0) : [];
  const Hover = ({ active, label: t, payload }) => {
    if (!active || !payload?.length) return null;
    const vals = d.lastMile.map(e => ({ e, p: e.path.find(p => p.t === t) })).filter(x => x.p).sort((a, b) => (b.e.current ? 1 : 0) - (a.e.current ? 1 : 0) || b.p.v - a.p.v);
    return (
      <div style={{ ...tip, padding: "7px 9px", fontFamily: fonts.mono, color: "#cbd5e1", maxWidth: 260 }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 11.5 }}>{t === 0 ? "last triple-digit year" : `${t > 0 ? "+" : ""}${t} year${Math.abs(t) === 1 ? "" : "s"}`}</div>
        {vals.slice(0, 8).map(({ e, p }) => (
          <div key={e.key} style={{ fontSize: 10, color: e.current ? CYAN : "#cbd5e1" }}>{e.name} {p.y}: {p.v}%{p.proj ? " (IMF proj.)" : ""}</div>
        ))}
      </div>
    );
  };

  return (
    <Panel title="Argentina's last mile — against every triple-digit disinflation since 1980" right="annual CPI inflation, log scale · years since the last triple-digit year">
      <ResponsiveContainer width="100%" height={chartH(phone, 250)}>
        <ComposedChart data={chart} margin={{ top: 6, right: 28, left: phone ? -18 : -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="t" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={t => (t === 0 ? "0" : `${t > 0 ? "+" : ""}${t}`)} />
          <YAxis scale="log" domain={[1, 20000]} allowDataOverflow tick={axis} axisLine={false} tickLine={false} ticks={[1, 3, 10, 30, 100, 300, 1000, 3000, 10000]} tickFormatter={v => `${v}%`} />
          <ReferenceLine y={30} stroke={AMBER} strokeDasharray="4 3" label={{ value: "30%", position: "right", fontSize: 8.5, fill: AMBER, fontFamily: fonts.mono }} />
          <ReferenceLine y={10} stroke={CYAN} strokeDasharray="4 3" label={{ value: "10%", position: "right", fontSize: 8.5, fill: CYAN, fontFamily: fonts.mono }} />
          <Tooltip content={<Hover />} />
          {past.map(e => <Line key={e.key} type="monotone" dataKey={e.key} stroke={SLATE} strokeOpacity={0.45} strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />)}
          {cur && <Line type="monotone" dataKey={cur.key} stroke={CYAN} strokeWidth={2.6} dot={{ r: 2.5, fill: CYAN }} connectNulls isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
      <Note>
        Grey lines are past episodes, the cyan one Argentina ({cur?.t0} was its last triple-digit year, at {cur?.peak}%). Across the
        {" "}{s.n} past episodes the median was {s.medianFirst} years to get below 30% and another {s.medianLast} to reach single digits —
        the last mile took longer in {s.longer} of {s.n}, which supports Gopinath&apos;s claim as a tendency, not a law: Brazil&apos;s Real
        plan and Bulgaria&apos;s currency board did it in a year.
        {cur && fin(cur.firstMile) && <> The IMF projects Argentina below 30% in {cur.y30} and below 10% in {cur.y10 ?? "—"}
          {fin(cur.lastMile) ? ` — a ${cur.lastMile}-year last mile against the historical median of ${s.medianLast}` : ""}, which is
          the optimistic end of the record.</>}
        {" "}Annual averages lag the monthly prints Argentina reports{curPath.length ? ` (IMF: ${curPath.slice(0, 4).map(p => `${p.y} ${p.v}%`).join(", ")})` : ""}.
      </Note>
      <DataTable
        dense
        rows={d.lastMile.map(e => ({ ...e }))}
        cols={[
          { key: "name", label: "episode", primary: true, render: r => <span style={{ color: r.current ? CYAN : "var(--text-primary)", fontWeight: r.current ? 700 : 400 }}>{r.name} <span style={{ color: DIM }}>{r.t0}</span></span> },
          { key: "peak", label: "peak", render: r => `${r.peak >= 1000 ? Math.round(r.peak).toLocaleString() : r.peak}%` },
          { key: "firstMile", label: "years to <30%", render: r => (fin(r.firstMile) ? r.firstMile : "—") },
          { key: "lastMile", label: "then to <10%", render: r => (fin(r.lastMile)
            ? <span style={{ color: r.lastMile > r.firstMile ? AMBER : "var(--text-secondary)", fontWeight: r.lastMile > r.firstMile ? 600 : 400 }}>{r.lastMile}</span> : "—") },
          { key: "proj", label: "", hide: true, render: r => (r.projected ? <span style={{ color: DIM }}>IMF projection</span> : "") },
        ]}
      />
    </Panel>
  );
}
