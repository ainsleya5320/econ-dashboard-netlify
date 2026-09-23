import React, { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, Line, Area, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { fonts } from "../lib/styles.js";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, ORANGE, TEAL,
  fin, card, label, note, tip, axis, fmtDay, fmtMon, chip, DenseHeader, Panel, Note, DataTable, useIsPhone, chartH,
} from "../components/dense.jsx";

// ============================================================================
// TIGHTENING MONITOR — Rates & Fed → Tightening monitor.
//
// A leading-indicator board for one worry: that the AI investment boom tightens
// financial conditions through the bond market before the stock market notices.
// The page is organised as the mechanism runs — supply of duration, who absorbs
// it, what it costs, the dollar's stock and flow — with three derived views on
// top (the warning light, the divergence gauge, the sequence) and the composite
// financial-conditions indices at the bottom as the lagging scoreboard.
//
// Deliberately NOT here: the term-premium and yield charts (Treasuries view),
// credit-spread charts (Credit → Corporate), the Fed balance sheet (Fed view),
// AI capex and AI debt facilities (AI Economy). Those gauges appear on this page
// only as rows in the sequence table, each naming its home.
// Data: /api/tightening (server/tightening.js).
// ============================================================================

const sgn = (v, dp = 1) => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}` : "—");
const fmtUnit = (v, unit) => {
  if (!fin(v)) return "—";
  if (unit === "bp") return `${sgn(v, 0)}bp`;
  if (unit === "%") return `${sgn(v, 1)}%`;
  if (unit === "pp") return `${v.toFixed(2)}pp`;
  if (unit === "$B") return `$${v.toFixed(1)}B`;
  return v.toFixed(2);
};
const LAMP = { y: "yields", d: "dollar", a: "auctions" };
const STATUS_TONE = { above: RED, crossed: AMBER, quiet: SLATE };
const QUAD_TONE = { red: RED, amber: AMBER, green: GREEN, slate: SLATE };
const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 12, marginBottom: 12 };

export default function TighteningTab({ go }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const phone = useIsPhone();

  useEffect(() => {
    fetch("/api/tightening").then(r => r.json())
      .then(x => (x.error ? setErr(x.error) : setD(x)))
      .catch(e => setErr(String(e)));
  }, []);

  if (err) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Tightening monitor could not load: {err}</div>;
  if (!d) return <div style={{ ...card, fontSize: 11, color: "var(--text-muted)", fontFamily: fonts.mono }}>Reading FRED and Treasury auction results…</div>;

  const { tell, sequence, quadrant, lastDiv, supply, absorption, now } = d;
  const lit = tell.lamps.filter(l => l.lit);
  const above = sequence.filter(s => s.status === "above");
  const lead = above[0];
  const lastAuction = absorption.recentAuctions[0];
  const bills = supply.billsShare[supply.billsShare.length - 1];
  const holders = absorption.holders[absorption.holders.length - 1];
  const holders0 = absorption.holders.find(h => h.d >= "2008-01");
  const fo = absorption.foreignOfficial;
  const cs = supply.couponSupply;
  const csChg = fin(cs.last3) && fin(cs.yearAgo3) && cs.yearAgo3 > 0 ? (cs.last3 / cs.yearAgo3 - 1) * 100 : null;
  const dsf = d.dollarStockFlow, dsfLast = dsf[dsf.length - 1];
  const fullPair = [...tell.pairs].reverse().find(p => p.lamps.length === 3);
  const lastPair = tell.pairs[tell.pairs.length - 1];
  const countWord = ["None", "One", "Two", "All three"][tell.count];
  const link = (id, view, text) => (
    <button onClick={() => go?.(id, view)} style={{ background: "none", border: "none", padding: 0, color: "#a5b4fc", cursor: go ? "pointer" : "default", fontFamily: "inherit", fontSize: "inherit" }}>{text}</button>
  );

  return (<>
    <DenseHeader
      eyebrow="Tightening monitor · does the AI boom tighten conditions through bonds before stocks?"
      headline={<>
        {countWord} of the three warning lamps {tell.count === 1 ? "is" : "are"} lit{lit.length ? ` (${lit.map(l => l.label.toLowerCase()).join(", ")})` : ""};
        {" "}{above.length === 1 ? `only the ${lead.label.toLowerCase()} is past its warning line, since ${fmtDay(lead.since)}`
          : above.length ? `${above.length} of ${sequence.length} gauges are past their warning lines, led by the ${lead.label.toLowerCase()} since ${fmtDay(lead.since)}`
          : "no gauge is past its warning line"}.
      </>}
      blurb={<>
        The mechanism runs in stock-flow terms: duration supply — Treasury coupons, Fed runoff, AI-related corporate debt — has to be
        absorbed by private and foreign buyers, and if they balk the term premium and credit spreads rise. The foreign channel has a
        signature: <strong style={{ color: "var(--text-primary)" }}>yields up while the dollar falls and auctions go badly</strong>. Composite
        financial-conditions indices are equity-heavy enough to read a boom as loosening, so they sit at the bottom as the scoreboard.
      </>}
      meta={<>
        FRED + Treasury FiscalData (auctions since {absorption.auctionsFrom?.slice(0, 4)}, debt mix since 2001)<br />
        through {fmtDay(d.asOf)} · built {new Date(d.built).toLocaleString()}
      </>}
      chips={[
        chip("term premium", `${now.tp?.v?.toFixed(2)}pp`, above.some(s => s.key === "tp") ? RED : VIOLET, "10-year, Kim-Wright"),
        chip("10Y, 4 weeks", `${sgn(now.y4, 0)}bp`, tell.lamps[0].lit ? RED : "var(--text-primary)", `lamp at ${tell.lamps[0].threshold}`),
        chip("dollar, 4 weeks", `${sgn(now.usd4, 1)}%`, tell.lamps[1].lit ? RED : "var(--text-primary)", `lamp at ${tell.lamps[1].threshold}`),
        lastAuction && chip(`last auction · ${lastAuction.tenor}`, `${lastAuction.ind}% indirect`, fin(lastAuction.dInd) && lastAuction.dInd < -3 ? AMBER : "var(--text-primary)", `${sgn(lastAuction.dInd)}pp vs its last six`),
        fo && chip("foreign official", `$${fo.level}T`, fo.chg13 < 0 ? AMBER : "var(--text-primary)", `${sgn(fo.chg13)}% in 13 weeks`),
        bills && chip("bills share", `${bills.share}%`, bills.share > 20 ? AMBER : "var(--text-primary)", "of marketable debt"),
        chip("SOFR − IORB", `${sgn(now.repo, 0)}bp`, now.repo > 0 ? AMBER : "var(--text-primary)", "above zero = reserves scarce"),
        chip("NFCI", now.nfci?.v?.toFixed(2), SLATE, "below zero = looser than average"),
      ].filter(Boolean)}
    />

    <div style={grid2}>
      <Panel title="The warning light — yields up, dollar down, auctions weak" right="all three within the same four weeks" style={{ marginBottom: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: 8 }}>
          {tell.lamps.map(l => (
            <div key={l.key} style={{ background: "var(--bg-subtle)", borderRadius: 8, padding: "8px 10px", borderLeft: `3px solid ${l.lit ? RED : "var(--border-subtle)"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: 9, background: l.lit ? RED : "transparent", border: `1.5px solid ${l.lit ? RED : SLATE}`, boxShadow: l.lit ? `0 0 8px ${RED}` : "none" }} />
                <span style={{ ...label, fontSize: 8.5 }}>{l.label}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: l.lit ? RED : "var(--text-primary)", fontFamily: fonts.heading, marginTop: 4 }}>
                {l.key === "y" ? `${sgn(l.value, 0)}bp` : l.key === "d" ? `${sgn(l.value, 1)}%` : `${sgn(l.value, 1)}pp`}
              </div>
              <div style={{ ...note, fontSize: 8.5 }}>{l.unit} · lit at {l.threshold}</div>
              <div style={{ ...note, fontSize: 8.5 }}>last lit {l.last ? fmtDay(l.last) : "never"}</div>
            </div>
          ))}
        </div>
        <Note>
          Each threshold is one standard deviation of its own four-week move, so a lamp means an unusual week, not a big number.
          {tell.episodes.length === 0
            ? <> All three have never lit in the same week since the record begins ({fmtDay(tell.since)}).</>
            : <> All three last lit together {fmtDay(tell.episodes[tell.episodes.length - 1].to)}.</>}
          {fullPair && <> The closest call: {fmtMon(fullPair.from.slice(0, 7))}{fullPair.to.slice(0, 7) !== fullPair.from.slice(0, 7) ? `–${fmtMon(fullPair.to.slice(0, 7))}` : ""}, when all three lit within a few weeks of each other.</>}
          {lastPair && <> Two of three have coincided {tell.pairCount} times; most recently {fmtDay(lastPair.to)} ({lastPair.lamps.map(k => LAMP[k]).join(" + ")}).</>}
          {" "}Auction tails would sharpen the third lamp but need the when-issued yield, which is not public; this uses who bought instead.
        </Note>
      </Panel>

      <Panel title="Divergence — bond and dollar stress against the stock market" right={quadrant ? <span style={{ color: QUAD_TONE[quadrant.tone] }}>{quadrant.label}</span> : null} style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 210)}>
          <ComposedChart data={d.divergence} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 4)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} domain={[-3, 3]} allowDataOverflow ticks={[-2, -1, 0, 1, 2]} />
            <ReferenceArea y1={0.5} y2={3} fill={RED} fillOpacity={0.05} />
            <ReferenceLine y={0} stroke="var(--border-subtle)" />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtDay} formatter={(v, n) => [fin(v) ? v.toFixed(2) : "—", n]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={6} />
            <Line type="monotone" dataKey="stress" name="bond & dollar stress (z)" stroke={RED} strokeWidth={1.8} dot={false} connectNulls />
            <Line type="monotone" dataKey="equity" name="S&P 500 extension (z)" stroke={INDIGO} strokeWidth={1.4} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
        <Note>
          Stress is the average z-score of the term premium, the 10-year's 13-week move, the Baa spread, the dollar (falling = stress),
          foreign official holdings and auction demand, each against its own last five years. Equity extension is the S&amp;P 500's distance
          above its 200-day average, scored the same way. Normally they move opposite. The warning is both above 0.5 at once — bonds
          tightening under a market still priced for the boom.
          {lastDiv && <> Today: stress {sgn(lastDiv.stress, 2)}, equities {sgn(lastDiv.equity, 2)}.</>}
        </Note>
      </Panel>
    </div>

    <Panel title="Who moved first — every gauge against its own warning line" right="warning line: one standard deviation past its five-year norm, in the stress direction">
      <DataTable
        dense
        rows={sequence.map(s => ({ ...s, key: s.key }))}
        cols={[
          { key: "label", label: "gauge", primary: true, render: r => <span title={r.why}>{r.label}</span> },
          { key: "block", label: "part of the chain", hide: true, align: "left", render: r => <span style={{ color: DIM }}>{r.block}</span> },
          { key: "value", label: "reading", render: r => fmtUnit(r.value, r.unit) },
          { key: "z", label: "z", render: r => (r.threshold != null ? <span style={{ color: DIM }}>lit &gt; ${r.threshold}B</span> : fin(r.z) ? <span style={{ color: r.z >= 1 ? RED : r.z >= 0.5 ? AMBER : "var(--text-secondary)", fontWeight: r.z >= 1 ? 700 : 400 }}>{sgn(r.z, 2)}</span> : "—") },
          { key: "status", label: "status", align: "left", render: r => (
            <span style={{ color: STATUS_TONE[r.status], fontWeight: r.status === "above" ? 700 : 400 }}>
              {r.status === "above" ? `past the line since ${fmtDay(r.since)}` : r.status === "crossed" ? `crossed, last ${fmtDay(r.lastLit)}` : "quiet all year"}
            </span>) },
          { key: "home", label: "full chart", hide: true, align: "left", render: r => <span style={{ color: DIM }}>{r.home === "here" ? "this page" : r.home}</span> },
        ]}
        note={<>
          Sorted by the order things broke: gauges past their line first, earliest first — that is the "watch the order, not the level"
          test. Hover a gauge for why it is here. The high-yield spread has only three years on FRED, so its z-score is less settled than the
          rest; swap-line usage is judged against a fixed $5B line because it sits near zero until a crisis. Every gauge whose full chart
          lives elsewhere says where — this table is the only place they meet.
        </>}
      />
    </Panel>

    <div style={grid2}>
      <Panel title="Supply — bills vs coupons" right="Treasury's choice of how much duration to sell" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 190)}>
          <ComposedChart data={supply.billsShare.filter(p => p.d >= "2006-01")} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 4)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} domain={[10, 40]} tickFormatter={v => `${v}%`} />
            <ReferenceArea y1={15} y2={20} fill={GREEN} fillOpacity={0.07} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={v => fmtMon(v)} formatter={v => [`${v}%`, "bills share"]} />
            <Line type="monotone" dataKey="share" name="bills share" stroke={CYAN} strokeWidth={1.8} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={chartH(phone, 150)}>
          <ComposedChart data={cs.monthly.slice(-60)} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(2, 7)} minTickGap={30} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${v}B`} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={v => fmtMon(v)}
              formatter={(v, n) => [`$${v}B`, n === "tenYE" ? "10-year equivalents" : "gross coupon auctions"]} />
            <Bar dataKey="tenYE" name="tenYE" fill={VIOLET} fillOpacity={0.8} />
          </ComposedChart>
        </ResponsiveContainer>
        <Note>
          Top: bills as a share of marketable debt — {bills?.share}% in {fmtMon(bills?.d)}, above the 15–20% band (shaded) that
          Treasury's borrowing committee has long recommended. Leaning on bills keeps duration off the market, which is why it matters here:
          it is the lever that can be reversed. Bottom: coupon auctions each month in 10-year equivalents — every auction weighted by its
          duration against a 10-year, so a 30-year counts roughly double. The last three months came to ${cs.last3}B,
          {fin(csChg) ? ` ${sgn(csChg)}% on a year earlier` : ""}. Gross, not net of maturing debt.
          {supply.fedRunoff && <> The Fed's own Treasury holdings moved {sgn(supply.fedRunoff.chg13, 0)}B over 13 weeks
            ({supply.fedRunoff.chg13 >= 0 ? "adding, not running off" : "running off"}) — detail on the {link("rates", "fed", "Fed balance sheet")} view.</>}
          {" "}The AI side of supply — hyperscaler capex and the AI debt facilities — is tracked on the AI Economy tab.
        </Note>
      </Panel>

      <Panel title="Absorption — who buys at auction" right="nominal coupons · 12-auction average" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 170)}>
          <ComposedChart data={absorption.auctionTrend} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 4)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} domain={[0, 80]} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={v => fmtMon(v)} formatter={(v, n) => [`${v}%`, n]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <Line type="monotone" dataKey="ind" name="indirect" stroke={TEAL} strokeWidth={1.8} dot={false} />
            <Line type="monotone" dataKey="dir" name="direct" stroke={INDIGO} strokeWidth={1.2} dot={false} />
            <Line type="monotone" dataKey="dealer" name="dealers" stroke={ORANGE} strokeWidth={1.4} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <DataTable
          dense
          rows={absorption.recentAuctions.slice(0, phone ? 6 : 8).map(a => ({ ...a, key: `${a.d}-${a.term}` }))}
          cols={[
            { key: "tenor", label: "auction", primary: true, render: r => <span>{r.tenor}{r.reopen ? <span style={{ color: DIM }}> reopen</span> : ""} <span style={{ color: DIM }}>{r.d.slice(5)}</span></span> },
            { key: "size", label: "size", render: r => `$${r.size}B` },
            { key: "btc", label: "cover", hide: true, render: r => (fin(r.btc) ? r.btc.toFixed(2) : "—") },
            { key: "ind", label: "indirect", render: r => `${r.ind}%` },
            { key: "dInd", label: "vs last six", render: r => <span style={{ color: fin(r.dInd) && r.dInd <= -5 ? RED : fin(r.dInd) && r.dInd < 0 ? AMBER : GREEN }}>{sgn(r.dInd)}pp</span> },
            { key: "dealer", label: "dealers", render: r => `${r.dealer}%` },
          ]}
        />
        <Note>
          Indirect bidders are mostly foreign buyers and funds bidding through dealers; dealers take what nobody else wants. Each auction is
          judged against the last six of its own tenor, because a 30-year and a 2-year draw different crowds.
        </Note>
      </Panel>
    </div>

    <div style={grid2}>
      <Panel title="The dollar's stock and flow" right="% of GDP · quarterly" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 210)}>
          <ComposedChart data={dsf} margin={{ top: 6, right: phone ? 4 : 0, left: phone ? -18 : -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 4)} minTickGap={40} />
            <YAxis yAxisId="s" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <YAxis yAxisId="f" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} hide={phone} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={v => fmtMon(v)} formatter={(v, n) => [`${v}%`, n]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <Area yAxisId="s" type="monotone" dataKey="niip" name="net international position (stock)" stroke={RED} fill={RED} fillOpacity={0.12} strokeWidth={1.6} />
            <Line yAxisId="f" type="monotone" dataKey="ca" name="current account (flow, right)" stroke={AMBER} strokeWidth={1.4} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <Note>
          The flow is the current-account deficit the world absorbs each year — {dsfLast?.ca}% of GDP. The stock is what has piled up: the
          rest of the world's net claim on the U.S. is {Math.abs(dsfLast?.niip)}% of GDP{dsf[0] ? `, from ${Math.abs(dsf[0].niip)}% in ${dsf[0].d.slice(0, 4)}` : ""}.
          The risk is not a bad flow year but holders deciding the stock is too big — which would show up as the warning light above, not
          here. This chart is the reason the light exists.
        </Note>
      </Panel>

      <Panel title="Who holds the federal debt" right="% of total public debt · quarterly" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 210)}>
          <ComposedChart data={absorption.holders} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 4)} minTickGap={40} />
            <YAxis tick={axis} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={v => fmtMon(v)} formatter={(v, n) => [`${v}%`, n]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <Area type="monotone" dataKey="private" name="private domestic" stackId="h" stroke={CYAN} fill={CYAN} fillOpacity={0.35} />
            <Area type="monotone" dataKey="foreign" name="foreign" stackId="h" stroke={AMBER} fill={AMBER} fillOpacity={0.35} />
            <Area type="monotone" dataKey="fed" name="Federal Reserve" stackId="h" stroke={VIOLET} fill={VIOLET} fillOpacity={0.35} />
            <Area type="monotone" dataKey="agencies" name="federal trust funds" stackId="h" stroke={SLATE} fill={SLATE} fillOpacity={0.25} />
          </ComposedChart>
        </ResponsiveContainer>
        <Note>
          This is the stock view of the bond market: whatever the Fed, foreigners and the trust funds do not hold, private domestic
          investors must. Their share is {holders?.private}%{holders0 ? `, up from ${holders0.private}% in 2008` : ""}; foreigners hold
          {" "}{holders?.foreign}%.
          {fo && <> Weekly, foreign central banks keep ${fo.level}T in custody at the NY Fed, {sgn(fo.chg13)}% in 13 weeks and
            {" "}{sgn(fo.chg52)}% in a year.</>}
        </Note>
      </Panel>
    </div>

    <Panel title="The scoreboard — Chicago Fed financial conditions" right="below zero = looser than average · the lagging read">
      <ResponsiveContainer width="100%" height={chartH(phone, 200)}>
        <ComposedChart data={d.scoreboard} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 7)} minTickGap={50} />
          <YAxis tick={axis} axisLine={false} tickLine={false} />
          <ReferenceLine y={0} stroke="var(--border-subtle)" />
          <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={fmtDay} formatter={(v, n) => [fin(v) ? v.toFixed(2) : "—", n]} />
          <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
          <Line type="monotone" dataKey="NFCI" name="NFCI" stroke="var(--text-primary)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="NFCIRISK" name="risk" stroke={RED} strokeWidth={1.2} dot={false} />
          <Line type="monotone" dataKey="NFCICREDIT" name="credit" stroke={AMBER} strokeWidth={1.2} dot={false} />
          <Line type="monotone" dataKey="NFCILEVERAGE" name="leverage" stroke={CYAN} strokeWidth={1.2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <Note>
        The composite is mostly money-market, credit and banking measures, so it is less equity-driven than Goldman's or Bloomberg's
        indices — but it still reads loose while markets are calm, which is the point of keeping it last. Its sub-indices matter more than
        the headline: credit and leverage turning up while risk stays low is the early version of the divergence above.
        {now.stlfsi && <> The St. Louis Fed stress index, the other composite on the Pulse page, reads {now.stlfsi.v}.</>}
      </Note>
    </Panel>

    <div style={{ ...card, fontSize: 10.5, fontFamily: fonts.mono, color: SLATE, lineHeight: 1.7, marginBottom: 12 }}>
      <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>What is deliberately not on this page.</span> The full charts for
      gauges in the table above live on their own pages: the yield curve, term premium and SOFR on the {link("rates", "treasuries", "Treasuries")} view;
      the Fed's balance sheet, reserves and swap lines on the {link("rates", "fed", "Fed balance sheet")} view; credit spreads on {link("credit", "corporate", "Credit → Corporate")};
      bank lending standards on {link("credit", "banks", "Credit → Banks")}. AI capex and the AI debt facilities are on the AI Economy tab, and the
      broad dollar on International. This page adds only what exists nowhere else — auctions, the debt mix, who holds the debt, the
      dollar's stock and flow — and the three views that join the rest together.
    </div>
  </>);
}
