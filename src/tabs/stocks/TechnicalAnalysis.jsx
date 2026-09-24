import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import { fetchFMP } from "../../lib/api.js";
import { analyze, indicators, fin } from "../../lib/technicals.js";
import TechChart, { UP, DOWN, MA_COLORS } from "./TechChart.jsx";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN,
  card, label, note, tip, axis, chip, DenseHeader, Panel, Note, DataTable, useIsPhone, chartH,
} from "../../components/dense.jsx";

// ============================================================================
// TECHNICAL ANALYSIS — a stock page view (Stocks → any ticker → Technical
// analysis). What a desk would expect on one screen:
//   the chart     candles, 20/50/200-day averages, Bollinger bands, volume,
//                 RSI and MACD panes, support/resistance lines, signal markers
//   the read      a scorecard of trend, momentum, volume and relative-strength
//                 checks rolled into a posture, stated in plain words
//   the levels    a price ladder: swing support and resistance, 52-week
//                 extremes, weekly pivots and Fibonacci retracements
//   the record    a dated signal log, returns against the S&P 500, relative
//                 strength, drawdown and volatility
// Math in src/lib/technicals.js. Prices from the stock page's own FMP history
// (five years, split-adjusted); the S&P 500 benchmark is SPY from the same
// source, fetched once per session.
// ============================================================================

let spyCache = null; // { at, bars }
async function loadSpy(fmpKey) {
  if (spyCache && Date.now() - spyCache.at < 30 * 60e3) return spyCache.bars;
  const raw = await fetchFMP("/historical-price-eod/full?symbol=SPY", fmpKey);
  const arr = Array.isArray(raw) ? raw : raw?.historical || [];
  const bars = arr.map(p => ({ d: p.date, c: +p.close })).filter(b => b.d && fin(b.c)).sort((a, b) => a.d.localeCompare(b.d));
  spyCache = { at: Date.now(), bars };
  return bars;
}

const RANGES = [["3M", 63], ["6M", 126], ["1Y", 252], ["2Y", 504], ["5Y", Infinity]];
const POSTURE_TONE = { Bullish: GREEN, "Leaning bullish": "#a3e635", Neutral: SLATE, "Leaning bearish": AMBER, Bearish: RED };
const MARKER_KINDS = new Set(["golden cross", "death cross", "200-day reclaimed", "200-day lost", "52-week high", "52-week low", "gap up", "gap down"]);
const sgn = (v, dp = 1) => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}` : "—");
const px = v => (!fin(v) ? "—" : v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2));
const fmtCheck = (v, unit) => (!fin(v) ? "—" : unit === "%" ? `${sgn(v)}%` : unit === "pp" ? `${sgn(v)}pp` : unit === "×" ? `${v.toFixed(2)}×` : v.toFixed(1));
const toneOf = s => (s > 0 ? GREEN : s < 0 ? RED : SLATE);

function sliceInd(I, from, maList) {
  const s = a => a.slice(from);
  return {
    ma: Object.fromEntries(maList.map(p => [p, s(I.ma[p] || [])])),
    bb: { up: s(I.bb.up), mid: s(I.bb.mid), lo: s(I.bb.lo) },
    rsi: s(I.rsi), macd: { line: s(I.macd.line), signal: s(I.macd.signal), hist: s(I.macd.hist) },
  };
}

function Toggle({ on, onClick, children, color }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 9px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono,
      border: `1px solid ${on ? color || "#818cf8" : "var(--border-subtle)"}`,
      background: on ? "rgba(129,140,248,0.12)" : "transparent", color: on ? color || "#c7d2fe" : SLATE,
    }}>{children}</button>
  );
}

export default function TechnicalAnalysis({ data, fmpKey }) {
  const phone = useIsPhone();
  const [bench, setBench] = useState(null);
  const [benchErr, setBenchErr] = useState(null);
  const [range, setRange] = useState("1Y");
  const [ivChoice, setIvChoice] = useState(null); // null = automatic
  const [log, setLog] = useState(false);
  const [show, setShow] = useState({ ma20: true, ma50: true, ma200: true, ma10: true, ma40: true, bb: false, volume: true, rsi: true, macd: true, levels: true, markers: true });
  const [allEvents, setAllEvents] = useState(false);
  const flip = k => setShow(s => ({ ...s, [k]: !s[k] }));
  const symbol = data.symbol;
  const isBench = symbol === "SPY";

  useEffect(() => {
    if (isBench) return;
    let alive = true;
    loadSpy(fmpKey).then(b => alive && setBench(b)).catch(e => alive && setBenchErr(String(e.message || e)));
    return () => { alive = false; };
  }, [fmpKey, isBench]);

  const bars = useMemo(() => (data.longHist || [])
    .map(p => { const c = +(p.close); return { d: p.date, o: fin(+p.open) ? +p.open : c, h: fin(+p.high) ? +p.high : c, l: fin(+p.low) ? +p.low : c, c, v: fin(+p.volume) ? +p.volume : 0 }; })
    .filter(b => b.d && fin(b.c) && b.c > 0), [data]);
  const A = useMemo(() => (bars.length > 60 ? analyze(bars, isBench ? null : bench) : null), [bars, bench, isBench]);

  const interval = ivChoice || (range === "2Y" || range === "5Y" ? "W" : "D");
  const series = useMemo(() => {
    if (!A) return null;
    const weekly = interval === "W";
    const src = weekly ? A.W : bars;
    const I = weekly ? indicators(A.W, true) : A.I;
    const want = RANGES.find(r => r[0] === range)[1];
    const count = weekly ? (fin(want) ? Math.ceil(want / 5) : Infinity) : want;
    const from = fin(count) ? Math.max(0, src.length - count) : 0;
    const maList = weekly ? [10, 40] : [20, 50, 200];
    const vis = src.slice(from);
    const markers = show.markers ? A.events.filter(e => MARKER_KINDS.has(e.kind) && e.tone !== 0).map(e => {
      const i = vis.findIndex(b => b.d >= e.d);
      return i >= 0 ? { ...e, i } : null;
    }).filter(Boolean) : [];
    return { bars: vis, ind: sliceInd(I, from, maList), maList, weekly, markers };
  }, [A, bars, interval, range, show.markers]);

  if (!bars.length) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>No price history is available for {symbol}.</div>;
  if (!A) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Only {bars.length} days of history — not enough for a technical read.</div>;

  const L = A.levels;
  const res1 = L.res[0], sup1 = L.sup[0];
  const dist = p => (fin(p) ? (p / A.px - 1) * 100 : null);
  const rs6 = A.returns.find(r => r.label === "6 months")?.excess;
  const tone = POSTURE_TONE[A.posture] || SLATE;
  const chartLevels = show.levels ? [
    ...L.res.map((z, k) => ({ p: z.price, label: k === 0 ? "R" : `R${k + 1}`, color: DOWN })),
    ...L.sup.map((z, k) => ({ p: z.price, label: k === 0 ? "S" : `S${k + 1}`, color: UP })),
    { p: A.hi52, label: "52H", color: "#64748b", dash: "2 3" }, { p: A.lo52, label: "52L", color: "#64748b", dash: "2 3" },
  ] : [];

  // the price ladder: every level, sorted, with the last price slotted in
  const ladder = [
    ...L.res.map(z => ({ p: z.price, type: "Resistance", detail: `${z.touches} turn${z.touches === 1 ? "" : "s"} · last ${z.last}`, color: DOWN })),
    ...L.sup.map(z => ({ p: z.price, type: "Support", detail: `${z.touches} turn${z.touches === 1 ? "" : "s"} · last ${z.last}`, color: UP })),
    { p: A.hi52, type: "52-week high", detail: A.hi52d, color: SLATE }, { p: A.lo52, type: "52-week low", detail: A.lo52d, color: SLATE },
    ...(L.pivW ? [["R2", L.pivW.R2], ["R1", L.pivW.R1], ["Pivot", L.pivW.P], ["S1", L.pivW.S1], ["S2", L.pivW.S2]].map(([k, v]) => ({ p: v, type: `Weekly ${k}`, detail: "from last week's high, low, close", color: INDIGO })) : []),
    ...L.fib.levels.map(f => ({ p: f.p, type: `Fib ${(f.r * 100).toFixed(1)}%`, detail: `${L.fib.up ? "retracement of the rise" : "retracement of the fall"} ${px(L.fib.from)}→${px(L.fib.to)}`, color: AMBER })),
  ].filter(r => fin(r.p)).sort((a, b) => b.p - a.p);
  const cut = ladder.findIndex(r => r.p < A.px);
  const ladderRows = [...(cut < 0 ? ladder : ladder.slice(0, cut)), { p: A.px, type: "Last price", detail: A.date, color: "var(--text-primary)", now: true }, ...(cut < 0 ? [] : ladder.slice(cut))]
    .map((r, k) => ({ ...r, key: `${r.type}-${k}` }));

  const events = allEvents ? A.events : A.events.slice(0, 12);
  const vsMA = name => A.checks.find(c => c.name === name)?.value;
  const ddSeries = A.dd.slice(-504);

  return (<>
    <DenseHeader
      eyebrow={`Technical analysis · ${symbol} · daily prices to ${A.date}${A.partial ? " · today's bar is still trading" : ""}`}
      headline={<>
        <span style={{ color: tone }}>{A.posture}</span> — {/^not/.test(A.trendState) ? A.trendState : `${/^[aeiou]/.test(A.trendState) ? "an" : "a"} ${A.trendState}`}
        {fin(A.rsi) ? `, RSI ${A.rsi.toFixed(0)}` : ""}{fin(A.macd.hist) ? `, MACD ${A.macd.hist >= 0 ? "above" : "below"} its signal` : ""}
        {fin(rs6) ? `, ${Math.abs(rs6).toFixed(1)} points ${rs6 >= 0 ? "ahead of" : "behind"} the S&P 500 over six months` : ""}
      </>}
      blurb={<>
        {res1 ? <>Nearest resistance <strong style={{ color: DOWN }}>{px(res1.price)}</strong> ({sgn(dist(res1.price))}%, {res1.touches} turn{res1.touches === 1 ? "" : "s"})</> : <>No swing resistance overhead — the stock is at or near its highs</>}
        {sup1 ? <>; nearest support <strong style={{ color: UP }}>{px(sup1.price)}</strong> ({sgn(dist(sup1.price))}%, {sup1.touches} turn{sup1.touches === 1 ? "" : "s"})</> : <>; no swing support below in two years</>}.
        {fin(A.atr) && <> A typical day moves {A.atrPct.toFixed(1)}% (ATR {px(A.atr)}), so the nearest level is {res1 || sup1 ? `${(Math.min(...[res1, sup1].filter(Boolean).map(z => Math.abs(z.price - A.px))) / A.atr).toFixed(1)} days' range away` : "—"}.</>}
        {fin(A.bb.bwPct) && A.bb.bwPct <= 10 && <> Bollinger bands are {A.bb.bwPct <= 2 ? "the narrowest in six months" : "near their narrowest of the past six months"} — volatility is compressed, and a move often follows.</>}
      </>}
      meta={<>{A.n.toLocaleString()} daily bars · split-adjusted<br />benchmark {isBench ? "— (this is the benchmark)" : bench ? "SPY" : benchErr ? "unavailable" : "loading…"}</>}
      chips={[
        chip("posture", A.posture, tone, `${A.checks.filter(c => c.s > 0).length} bullish · ${A.checks.filter(c => c.s < 0).length} bearish checks`),
        chip("vs 50-day", `${sgn(vsMA("Price vs 50-day average"))}%`, A.px > A.ma.s50 ? GREEN : RED, `average ${px(A.ma.s50)}`),
        chip("vs 200-day", `${sgn(vsMA("Price vs 200-day average"))}%`, A.px > A.ma.s200 ? GREEN : RED, `average ${px(A.ma.s200)}, ${A.ma.slope200 > 0 ? "rising" : "falling"}`),
        chip("RSI 14", fin(A.rsi) ? A.rsi.toFixed(1) : "—", A.rsi >= 70 || A.rsi <= 30 ? AMBER : "var(--text-primary)", A.rsi >= 70 ? "overbought" : A.rsi <= 30 ? "oversold" : "in range"),
        chip("ADX 14", fin(A.adx.adx) ? A.adx.adx.toFixed(1) : "—", A.adx.adx >= 25 ? CYAN : "var(--text-primary)", A.adx.adx >= 25 ? "trending" : A.adx.adx >= 20 ? "trend forming" : "range-bound"),
        chip("52-week range", fin(A.pos52) ? `${A.pos52.toFixed(0)}%` : "—", "var(--text-primary)", `${sgn(A.fromHi)}% from the high`),
        !isBench && chip("beta", fin(A.beta) ? A.beta.toFixed(2) : "—", "var(--text-primary)", fin(A.beta3y) ? `1-yr · 3-yr ${A.beta3y.toFixed(2)}` : "1-year, vs S&P 500"),
        chip("volatility", fin(A.hv20) ? `${A.hv20.toFixed(0)}%` : "—", "var(--text-primary)", `20-day annualised · 60-day ${fin(A.hv60) ? A.hv60.toFixed(0) : "—"}%`),
      ].filter(Boolean)}
    />

    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 }}>
      {RANGES.map(([k]) => <Toggle key={k} on={range === k} onClick={() => setRange(k)}>{k}</Toggle>)}
      <span style={{ width: 8 }} />
      <Toggle on={interval === "D"} onClick={() => setIvChoice("D")}>Daily</Toggle>
      <Toggle on={interval === "W"} onClick={() => setIvChoice("W")}>Weekly</Toggle>
      <Toggle on={log} onClick={() => setLog(v => !v)}>Log</Toggle>
      <span style={{ width: 8 }} />
      {series.maList.map(p => <Toggle key={p} on={show[`ma${p}`]} onClick={() => flip(`ma${p}`)} color={MA_COLORS[p]}>{series.weekly ? `${p}w` : `${p}d`}</Toggle>)}
      <Toggle on={show.bb} onClick={() => flip("bb")}>Bollinger</Toggle>
      <Toggle on={show.levels} onClick={() => flip("levels")}>Levels</Toggle>
      <Toggle on={show.markers} onClick={() => flip("markers")}>Signals</Toggle>
      <Toggle on={show.volume} onClick={() => flip("volume")}>Volume</Toggle>
      <Toggle on={show.rsi} onClick={() => flip("rsi")}>RSI</Toggle>
      <Toggle on={show.macd} onClick={() => flip("macd")}>MACD</Toggle>
    </div>

    <div style={{ ...card, padding: "8px 6px 4px", marginBottom: 12 }}>
      <TechChart bars={series.bars} ind={series.ind} maList={series.maList} show={show} log={log} levels={chartLevels} markers={series.markers} phone={phone} />
      <div style={{ ...note, padding: "2px 6px 4px" }}>
        {series.weekly ? "Weekly bars; 10- and 40-week averages stand in for the 50- and 200-day." : "Daily bars."} Hollow candles closed up, filled closed down.
        {show.levels && " R and S lines are swing resistance and support; dotted lines the 52-week extremes."}
        {show.markers && " Triangles mark crosses of the 50/200-day averages, the 200-day itself, 52-week extremes and high-volume gaps."} Hover for values.
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Technical scorecard" right="each check reads bullish, neutral or bearish" style={{ marginBottom: 0 }}>
        {A.cats.map(cat => (
          <div key={cat.cat} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--border-subtle)", paddingBottom: 3, marginBottom: 3 }}>
              <span style={{ ...label, fontSize: 9 }}>{cat.cat}</span>
              <span style={{ fontSize: 10, fontFamily: fonts.mono, color: toneOf(cat.score > 0.15 ? 1 : cat.score < -0.15 ? -1 : 0) }}>
                {cat.n ? `${cat.bull} bullish · ${cat.bear} bearish of ${cat.n}` : "not available"}
              </span>
            </div>
            {A.checks.filter(c => c.cat === cat.cat).map(c => (
              <div key={c.name} style={{ display: "grid", gridTemplateColumns: "14px minmax(0,1fr) auto", gap: 8, alignItems: "baseline", padding: "2px 0" }}>
                <span style={{ color: toneOf(c.s), fontSize: 10 }}>{c.s > 0 ? "▲" : c.s < 0 ? "▼" : "●"}</span>
                <span style={{ fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", minWidth: 0 }}>
                  {c.name}{c.note && <span style={{ color: DIM, fontSize: 9.5 }}> · {c.note}</span>}
                </span>
                <span style={{ fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-primary)", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtCheck(c.value, c.unit)}</span>
              </div>
            ))}
          </div>
        ))}
        <Note>
          The posture is the average of these checks: {A.checks.filter(c => fin(c.value)).length} were measurable, scoring {sgn(A.overall, 2)} on a −1 to +1 scale.
          Overbought and oversold readings count as neutral rather than as signals — a strong stock can stay overbought for months. This
          describes how the price has behaved; it is not a forecast.
        </Note>
      </Panel>

      <Panel title="Key levels — the price ladder" right="nearest levels either side of the last price" style={{ marginBottom: 0 }}>
        <DataTable
          dense
          rows={ladderRows}
          cols={[
            { key: "type", label: "level", primary: true, render: r => <span style={{ color: r.color, fontWeight: r.now ? 700 : 500 }}>{r.now ? "▶ " : ""}{r.type}</span> },
            { key: "p", label: "price", render: r => <span style={{ fontWeight: r.now ? 700 : 400, color: r.now ? "var(--text-primary)" : "var(--text-secondary)" }}>{px(r.p)}</span> },
            { key: "dist", label: "distance", render: r => (r.now ? "—" : <span style={{ color: r.p > A.px ? DOWN : UP }}>{sgn(dist(r.p))}%</span>) },
            { key: "detail", label: "basis", align: "left", hide: true, render: r => <span style={{ color: DIM }}>{r.detail}</span> },
          ]}
          note={<>
            Support and resistance are swing highs and lows over two years (a bar that is the extreme of the five either side), grouped
            where they cluster; more turns at a level means more of the market has traded around it. Pivots are the floor-trader set from
            last week&apos;s range. Fibonacci retracements divide the 52-week swing.
          </>}
        />
      </Panel>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Signal log" right={<>last six months · <button onClick={() => setAllEvents(v => !v)} style={{ background: "none", border: "none", padding: 0, color: "#a5b4fc", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>{allEvents ? "show recent" : `show all ${A.events.length}`}</button></>} style={{ marginBottom: 0 }}>
        {events.length ? (
          <DataTable
            dense
            rows={events.map((e, k) => ({ ...e, key: `${e.d}-${e.kind}-${k}` }))}
            cols={[
              { key: "d", label: "date", primary: true, render: r => <span style={{ fontFamily: fonts.mono }}>{r.d}</span> },
              { key: "kind", label: "signal", align: "left", render: r => <span style={{ color: toneOf(r.tone), fontWeight: 600 }}>{r.kind}</span> },
              { key: "text", label: "what happened", align: "left", hide: true, render: r => <span style={{ color: DIM, whiteSpace: "normal" }}>{r.text}</span> },
            ]}
          />
        ) : <div style={{ ...note }}>No signals in the last six months.</div>}
      </Panel>

      <Panel title={isBench ? "Returns" : "Returns against the S&P 500"} right="price return, dividends excluded" style={{ marginBottom: 0 }}>
        <DataTable
          dense
          rows={A.returns.map(r => ({ ...r, key: r.label }))}
          cols={[
            { key: "label", label: "period", primary: true },
            { key: "stock", label: symbol, render: r => <span style={{ color: fin(r.stock) ? (r.stock >= 0 ? UP : DOWN) : DIM, fontWeight: 600 }}>{fin(r.stock) ? `${sgn(r.stock)}%` : "—"}</span> },
            ...(isBench ? [] : [
              { key: "bench", label: "S&P 500", render: r => (fin(r.bench) ? `${sgn(r.bench)}%` : "—") },
              { key: "excess", label: "difference", render: r => <span style={{ color: fin(r.excess) ? (r.excess >= 0 ? UP : DOWN) : DIM }}>{fin(r.excess) ? `${sgn(r.excess)}pp` : "—"}</span> },
            ]),
          ]}
        />
        <Note>
          Max drawdown {fin(A.maxDD1y) ? `${A.maxDD1y.toFixed(1)}%` : "—"} over one year, {fin(A.maxDD5y) ? `${A.maxDD5y.toFixed(1)}%` : "—"} over the full record;
          {" "}{fin(A.ddNow) && A.ddNow < -0.5 ? `${Math.abs(A.ddNow).toFixed(1)}% below its peak today` : "at its high today"}.
          {!isBench && fin(A.beta) && <> Beta {A.beta.toFixed(2)} and correlation {A.corr.toFixed(2)} with the S&P 500 over a year{fin(A.beta3y) ? `; ${A.beta3y.toFixed(2)} and ${A.corr3y.toFixed(2)} over three` : ""}
            {fin(A.beta3y) && Math.abs(A.beta - A.beta3y) > 0.4 ? " — the stock's relationship with the market has shifted" : ""}.</>}
        </Note>
      </Panel>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      {!isBench && (
        <Panel title="Relative strength against the S&P 500" right="price ratio, 100 = one year ago" style={{ marginBottom: 0 }}>
          {A.rsLine.length > 10 ? (
            <ResponsiveContainer width="100%" height={chartH(phone, 180)}>
              <LineChart data={A.rsLine} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 7)} minTickGap={50} />
                <YAxis tick={axis} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                <ReferenceLine y={100} stroke="var(--border-subtle)" />
                <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={v => [fin(v) ? v.toFixed(1) : "—", "relative strength"]} />
                <Line type="monotone" dataKey="v" stroke={CYAN} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div style={note}>{benchErr ? `Benchmark unavailable: ${benchErr}` : "Loading the benchmark…"}</div>}
          <Note>
            A rising line means {symbol} is beating the index, whatever the index is doing. {A.rsAtHigh ? "The line is at a 52-week high — leadership." : "The line is below its 52-week high."}
          </Note>
        </Panel>
      )}
      <Panel title="Drawdown from peak" right="two years · % below the running high" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 180)}>
          <AreaChart data={ddSeries} margin={{ top: 6, right: 8, left: phone ? -22 : -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 7)} minTickGap={50} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["dataMin", 0]} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={v => [`${v}%`, "drawdown"]} />
            <Area type="monotone" dataKey="v" stroke={DOWN} fill={DOWN} fillOpacity={0.18} strokeWidth={1.3} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        <Note>
          Volatility {fin(A.hv20) ? `${A.hv20.toFixed(0)}%` : "—"} annualised over 20 days and {fin(A.hv60) ? `${A.hv60.toFixed(0)}%` : "—"} over 60
          {fin(A.hv20) && fin(A.hv60) ? (A.hv20 < A.hv60 * 0.8 ? " — calming" : A.hv20 > A.hv60 * 1.2 ? " — heating up" : " — steady") : ""}.
          {fin(A.volume.rel) && <> Volume {A.partial ? "so far today" : "on the last day"} is {A.volume.rel.toFixed(2)}× its 50-day average.</>}
        </Note>
      </Panel>
    </div>

    <div style={{ ...card, fontSize: 10, fontFamily: fonts.mono, color: SLATE, lineHeight: 1.65, marginBottom: 12 }}>
      <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>Method.</span> Simple moving averages 20/50/200-day (10/40-week on the
      weekly chart); Bollinger bands 20-day, 2 standard deviations; RSI 14 and ATR 14 and ADX 14 with Wilder smoothing; MACD 12/26/9 on
      exponential averages; slow stochastic 14/3/3; on-balance volume. Momentum 12-1 is the return from twelve months ago to one month ago,
      the academic momentum factor. Prices are split-adjusted, not dividend-adjusted, as on most charting platforms, so returns here are
      price returns. Source: Financial Modeling Prep end-of-day history ({bars[0].d} to {A.date}); benchmark SPY.
    </div>
  </>);
}
