import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, ScatterChart, Scatter, Line, Bar, XAxis, YAxis, ZAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, LabelList } from "recharts";
import { fonts } from "../../lib/styles.js";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, TEAL, ORANGE,
  fin, card, label, note, tip, axis, fmtMon, chip, DenseHeader, Panel, Note, DataTable, useIsPhone, chartH,
} from "../../components/dense.jsx";

// ============================================================================
// TRADE & PASS-THROUGH — International → Forex → Trade & pass-through.
//
// Gita Gopinath's research, turned into three tests (her Conversations with
// Tyler episode of September 2026 walked through each):
//   1. Tariffs land on dollar prices; exchange rates mostly do not, because
//      most U.S. imports are priced in dollars at sticky prices (dominant-
//      currency pricing). Effective tariff rate vs import prices by origin.
//   2. Who prices in dollars: the invoicing shares behind that result.
//   3. Does a cheaper currency shrink the deficit? Five-year changes in the
//      real exchange rate against five-year changes in the current account.
// The valuation gaps elsewhere on this page assume test 3 holds; this view is
// where to check how well it does.
// Data: /api/trade-flows (server/tradeFlows.js).
// ============================================================================

const sgn = (v, dp = 1) => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}` : "—");
const INV_SHOW = ["USA", "DEU", "FRA", "ITA", "JPN", "GBR", "CHE", "SWE", "NOR", "AUS", "NZL", "KOR", "IND", "IDN", "THA", "BRA", "ARG", "TUR", "ZAF"];
const SEG = [["USD", INDIGO], ["EUR", CYAN], ["CNY", RED], ["Home", AMBER]];

function Shares({ r, side }) {
  const v = SEG.map(([k, c]) => [k, c, r?.[`${side}${k}`]]);
  const known = v.reduce((s, [, , x]) => s + (fin(x) ? x : 0), 0);
  if (!known) return <span style={{ color: DIM }}>—</span>;
  return (
    <div title={v.filter(([, , x]) => fin(x)).map(([k, , x]) => `${k} ${x}%`).join(" · ") + (known < 99 ? ` · other ${(100 - known).toFixed(0)}%` : "")}
      style={{ display: "flex", height: 9, width: "100%", minWidth: 90, borderRadius: 3, overflow: "hidden", background: "var(--bg-subtle)" }}>
      {v.map(([k, c, x]) => (fin(x) && x > 0 ? <div key={k} style={{ width: `${x}%`, background: c, opacity: 0.85 }} /> : null))}
    </div>
  );
}

export default function TradeFlows() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [allInv, setAllInv] = useState(false);
  const phone = useIsPhone();

  useEffect(() => {
    fetch("/api/trade-flows").then(r => r.json())
      .then(x => (x.error ? setErr(x.error) : setD(x)))
      .catch(e => setErr(String(e)));
  }, []);

  const tariff = useMemo(() => (d?.passThrough.tariff || []).filter(p => p.d >= "2017-01"), [d]);
  if (err) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Trade flows could not load: {err}</div>;
  if (!d) return <div style={{ ...card, fontSize: 11, color: "var(--text-muted)", fontFamily: fonts.mono }}>Reading Treasury customs receipts, BLS import prices and the IMF…</div>;

  const { origins } = d.passThrough;
  const china = origins.find(o => o.key === "china");
  const rated = tariff.filter(p => fin(p.rate));
  const latest = rated[rated.length - 1];
  const base24 = rated.filter(p => p.d.startsWith("2024")).map(p => p.rate);
  const baseline = base24.length ? base24.reduce((a, b) => a + b, 0) / base24.length : null;
  const peak = rated.reduce((m, p) => (!m || p.rate > m.rate ? p : m), null);
  const recent = d.passThrough.tariff.slice(-6);
  const refunds6 = recent.reduce((s, p) => s + (p.refund || 0), 0);
  const cg = tariff.filter(p => fin(p.coreGoods));
  const cg24 = cg.filter(p => p.d.startsWith("2024")).map(p => p.coreGoods);
  const cgBase = cg24.length ? cg24.reduce((a, b) => a + b, 0) / cg24.length : null;
  const cgNow = cg[cg.length - 1];
  const rc = d.reerCa;
  const r2 = fin(rc.corr) ? rc.corr * rc.corr : null;
  const econ = d.invoicing.economies;
  const invRows = (allInv ? Object.keys(econ).sort((a, b) => (econ[b].latest.xUSD ?? -1) - (econ[a].latest.xUSD ?? -1)) : INV_SHOW.filter(k => econ[k]))
    .map(k => ({ key: k, ...econ[k] }));

  // fitted line across the scatter's x range
  const xs = rc.points.map(p => p.dReer);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const my = rc.points.reduce((s, p) => s + p.dCa, 0) / rc.points.length, mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const fitLine = fin(rc.beta) ? [{ x: xMin, y: my + rc.beta * (xMin - mx) }, { x: xMax, y: my + rc.beta * (xMax - mx) }] : [];

  const ScatterHover = ({ active, payload }) => {
    const p = active && payload?.length ? payload[0].payload : null;
    if (!p?.name) return null;
    return (
      <div style={{ ...tip, padding: "7px 9px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 11.5 }}>{p.name} · {p.window}</div>
        <div style={{ fontSize: 10.5 }}>real exchange rate {sgn(p.x)}%</div>
        <div style={{ fontSize: 10.5 }}>current account {sgn(p.y)}pp of GDP</div>
      </div>
    );
  };

  return (<>
    <DenseHeader
      eyebrow="Trade & pass-through · after Gita Gopinath"
      headline={<>
        Tariffs moved U.S. prices; currencies barely do. A 10% weaker yuan has lowered what the U.S. pays for Chinese goods by
        about {fin(china?.beta) ? `${Math.abs(china.beta * 10).toFixed(1)}%` : "—"}, while the effective tariff rate went from
        {" "}{fin(baseline) ? `${baseline.toFixed(1)}%` : "—"} to a peak of {peak ? `${peak.rate.toFixed(1)}%` : "—"}
      </>}
      blurb={<>
        Most goods crossing borders are priced in dollars and those prices are sticky, so when a currency moves, the dollar price
        of its exports hardly changes. That is Gopinath&apos;s dominant-currency paradigm, and it has a corollary: a weaker currency
        shrinks a country&apos;s imports more than it grows its exports, and a cheaper dollar does little to U.S. import prices. A
        tariff is different — it is added straight onto the dollar price.
      </>}
      meta={<>Treasury monthly statement · BLS import prices · Census · BIS · IMF<br />built {new Date(d.built).toLocaleString()}</>}
      chips={[
        latest && chip("effective tariff", `${latest.rate.toFixed(1)}%`, AMBER, `gross duties ÷ imports, 3 mo to ${fmtMon(latest.d)}`),
        chip("refunds, 6 months", `$${refunds6.toFixed(0)}B`, refunds6 > 20 ? RED : "var(--text-primary)", "customs duties paid back"),
        china && chip("yuan pass-through", `${sgn(china.beta * 10)}%`, CYAN, "import prices per 10% weaker yuan"),
        cgNow && chip("core goods CPI", `${sgn(cgNow.coreGoods)}%`, "var(--text-primary)", fin(cgBase) ? `yoy · ${sgn(cgBase)}% in 2024` : "yoy"),
        chip("textbook sign", fin(rc.textbookShare) ? `${rc.textbookShare}%` : "—", "var(--text-primary)", "of big currency moves, 5-yr"),
        chip("explained", fin(r2) ? `${Math.round(r2 * 100)}%` : "—", SLATE, "of current-account change by the currency"),
      ].filter(Boolean)}
    />

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Tariffs land on the dollar price" right="effective rate · core goods CPI · collections and refunds" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 180)}>
          <ComposedChart data={tariff} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 4)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <ReferenceLine y={0} stroke="var(--border-subtle)" />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtMon} formatter={(v, n) => [fin(v) ? `${v.toFixed(2)}%` : "—", n]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <Line type="monotone" dataKey="rate" name="effective tariff rate" stroke={AMBER} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="coreGoods" name="core goods CPI, yoy" stroke={INDIGO} strokeWidth={1.4} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={chartH(phone, 120)}>
          <ComposedChart data={tariff.filter(p => p.d >= "2024-01")} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(2, 7)} minTickGap={24} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${v}B`} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtMon} formatter={(v, n) => [`$${v}B`, n]} />
            <Bar dataKey="gross" name="duties collected" fill={AMBER} fillOpacity={0.7} />
            <Bar dataKey="refund" name="refunded" fill={RED} fillOpacity={0.75} />
          </ComposedChart>
        </ResponsiveContainer>
        <Note>
          The effective rate is customs duties actually collected divided by goods imports, over three months. It
          {fin(baseline) && peak ? ` ran ${baseline.toFixed(1)}% through 2024, peaked at ${peak.rate.toFixed(1)}% in ${fmtMon(peak.d)}` : " rose sharply in 2025"}
          {latest ? `, and was ${latest.rate.toFixed(1)}% in the three months to ${fmtMon(latest.d)}` : ""}. Refunds are kept apart
          ({`$${refunds6.toFixed(0)}B`} paid back in the last six months) — netting them would make 2026 read as a negative tariff.
          Core goods inflation, the consumer end, {fin(cgBase) && cgNow ? `moved from ${sgn(cgBase)}% in 2024 to ${sgn(cgNow.coreGoods)}%` : "moved"}:
          a tariff shows up in U.S. prices in a way a currency move does not.
        </Note>
      </Panel>

      <Panel title="Currencies mostly don't — the pass-through test" right="import prices by origin vs the origin's currency, since 2005" style={{ marginBottom: 0 }}>
        {china && (
          <ResponsiveContainer width="100%" height={chartH(phone, 170)}>
            <ComposedChart data={china.series} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 4)} minTickGap={40} />
              <YAxis tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
              <ReferenceLine y={100} stroke="var(--border-subtle)" />
              <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtMon} formatter={(v, n) => [fin(v) ? v.toFixed(1) : "—", n]} />
              <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
              <Line type="monotone" dataKey="fx" name="yuan per dollar (up = weaker yuan)" stroke={RED} strokeWidth={1.6} dot={false} connectNulls />
              <Line type="monotone" dataKey="price" name="U.S. import prices from China" stroke={CYAN} strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <DataTable
          dense
          rows={origins.map(o => ({ ...o }))}
          cols={[
            { key: "name", label: "origin", primary: true, render: r => <span title={`BLS ${r.ipi} (${r.ipiLabel}) vs FRED ${r.fx}`}>{r.name} <span style={{ color: DIM }}>{r.ccy}</span></span> },
            { key: "beta", label: "10% weaker →", render: r => <span style={{ color: CYAN, fontWeight: 600 }}>{fin(r.beta) ? `${sgn(r.beta * 10)}%` : "—"}</span> },
            { key: "corr", label: "corr", hide: true, render: r => (fin(r.corr) ? r.corr.toFixed(2) : "—") },
            { key: "inv", label: "exports in $", render: r => (fin(r.exportsInUSD) ? `${r.exportsInUSD}%` : <span style={{ color: DIM }}>not reported</span>) },
            { key: "last", label: "last 12 mo", align: "left", hide: true, render: r => <span style={{ color: DIM }}>{r.ccy} {sgn(r.last.fxYoY)}% · prices {sgn(r.last.priceYoY)}%</span> },
          ]}
          note={<>
            Each row regresses the 12-month change in U.S. import prices from that origin (BLS, which excludes duties) on the 12-month
            change in its currency against the dollar. If exporters priced in their own currency, a 10% weaker currency would cut the
            dollar price by about 10%; under dollar pricing, by close to nothing. Most origins sit near the second. Canada is the
            outlier, probably because its manufactured exports lean on metals, wood and paper, whose dollar prices move with the
            Canadian dollar — the same commodity link that makes its all-industries index (mostly oil) useless for this test, which is
            why manufacturing indices are used wherever BLS publishes one. Overlapping 12-month changes, so read the slopes as
            descriptive rather than precise.
          </>}
        />
      </Panel>
    </div>

    <Panel title="Who prices in dollars" right={<>share of goods exports and imports by invoicing currency · {" "}
      <button onClick={() => setAllInv(v => !v)} style={{ background: "none", border: "none", padding: 0, color: "#a5b4fc", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>{allInv ? `show the Forex set` : `show all ${Object.keys(econ).length}`}</button></>}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        {SEG.map(([k, c]) => <span key={k} style={{ ...note, display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{k === "Home" ? "own currency" : k}</span>)}
        <span style={{ ...note }}>· remainder = other currencies or unreported</span>
      </div>
      <DataTable
        dense
        rows={invRows}
        cols={[
          { key: "name", label: "economy", primary: true, render: r => <span>{r.name}</span> },
          { key: "xUSD", label: "exports in $", render: r => (fin(r.latest.xUSD) ? `${r.latest.xUSD}%` : "—") },
          { key: "xbar", label: "exports", align: "left", width: "22%", render: r => <Shares r={r.latest} side="x" /> },
          { key: "mUSD", label: "imports in $", render: r => (fin(r.latest.mUSD) ? `${r.latest.mUSD}%` : "—") },
          { key: "mbar", label: "imports", align: "left", width: "22%", hide: true, render: r => <Shares r={r.latest} side="m" /> },
          { key: "trend", label: "$ exports vs earlier", hide: true, render: r => (r.earlier && fin(r.earlier.xUSD) && fin(r.latest.xUSD)
            ? <span style={{ color: DIM }}>{sgn(r.latest.xUSD - r.earlier.xUSD)}pp since {r.earlier.year}</span> : "—") },
          { key: "year", label: "year", render: r => <span style={{ color: r.latest.year < 2020 ? AMBER : DIM }}>{r.latest.year}</span> },
        ]}
        note={<>
          How to read a currency move with this: where a country&apos;s exports are priced in dollars, a weaker currency does not make
          them cheaper abroad, so the adjustment runs through imports instead. The euro area is the exception to dollar dominance —
          Germany prices three quarters of its trade in euros, much of it with other euro users. {d.invoicing.missing}
          {" "}Source: {d.invoicing.citation} Licence: {d.invoicing.licence}
        </>}
      />
    </Panel>

    <Panel title="Does a cheaper currency shrink the deficit?" right={`five-year changes, non-overlapping windows to ${rc.lastActual} · ${rc.n} country-windows`}>
      <ResponsiveContainer width="100%" height={chartH(phone, 280)}>
        <ScatterChart margin={{ top: 10, right: 14, bottom: 14, left: phone ? -18 : -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis type="number" dataKey="x" name="real exchange rate" tick={axis} tickFormatter={v => `${v}%`}
            label={{ value: "real exchange rate, % change (up = dearer)", position: "insideBottom", offset: -8, fontSize: 9, fill: "var(--text-muted)" }} />
          <YAxis type="number" dataKey="y" name="current account" tick={axis} tickFormatter={v => `${v}pp`}
            label={phone ? undefined : { value: "current account, % of GDP", angle: -90, position: "insideLeft", offset: 30, dy: 60, fontSize: 9, fill: "var(--text-muted)" }} />
          <ZAxis range={[28, 28]} />
          <ReferenceLine x={0} stroke="var(--border-subtle)" /><ReferenceLine y={0} stroke="var(--border-subtle)" />
          <Tooltip cursor={false} content={<ScatterHover />} />
          <Scatter data={rc.points.filter(p => !p.latest).map(p => ({ ...p, x: p.dReer, y: p.dCa }))} fill={SLATE} fillOpacity={0.45} />
          <Scatter data={rc.points.filter(p => p.latest).map(p => ({ ...p, x: p.dReer, y: p.dCa }))} fill={VIOLET}>
            {!phone && <LabelList dataKey="iso" position="top" style={{ fontSize: 8.5, fill: "#c4b5fd", fontFamily: fonts.mono }} />}
          </Scatter>
          {fitLine.length === 2 && <Scatter data={fitLine} line={{ stroke: AMBER, strokeWidth: 1.5, strokeDasharray: "5 3" }} shape={() => null} legendType="none" />}
        </ScatterChart>
      </ResponsiveContainer>
      <Note>
        Each dot is one economy over five years: how much its real exchange rate moved against how much its current account changed.
        The textbook says dots should run from top-left to bottom-right, and on direction they mostly do — in {rc.textbookShare}% of
        the {rc.bigMoves} windows where the currency moved at least 5%, the current account went the textbook way. But the slope is
        shallow ({fin(rc.beta) ? `${sgn(rc.beta * 10, 1)}pp of GDP per 10%` : "—"}, dashed) and the currency explains only
        {" "}{fin(r2) ? `${Math.round(r2 * 100)}%` : "—"} of the variation. That is Gopinath&apos;s point: trade balances follow relative
        demand — how fast a country spends against its trading partners — more than relative prices. Keep it in mind when reading the
        valuation gaps on this page, which assume the currency does the adjusting. Latest window ({rc.lastActual - 5}–{rc.lastActual}) in violet.
      </Note>
    </Panel>
  </>);
}
