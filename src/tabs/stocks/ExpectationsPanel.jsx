import React, { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { SH } from "../../components/shared.jsx";

// ============================================================================
// EXPECTATIONS PANEL — "what has to go right" for the reverse DCF
// Sits between the implied-growth number and the sensitivity table. Four
// pictures, all driven by the same sliders as the reverse DCF:
//   1. Scoreboard  — what the PRICE requires vs what the STREET models vs
//                    what HISTORY delivered, with the gap named in words.
//   2. Hurdle chart — the company's revenue (or net income): actuals, then
//                    the path the price requires vs the consensus path with
//                    its low–high band. Where the dashed line sits against
//                    the band IS the thesis.
//   3. Value ladder — how much of today's market cap is (a) the current cash
//                    flow held flat forever, (b) growth in the explicit years,
//                    (c) everything after — i.e. how far out the bet lives.
//   4. Street check — fair value if the Street is right / if history repeats,
//                    vs the price; the analyst target range; buy/hold/sell.
// Consensus comes from FMP analyst-estimates (annual, avg/low/high, analyst
// counts), price-target-consensus and grades-consensus, fetched with the
// rest of the stock detail. Never fabricate: thin coverage is shown as thin.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8";
const fin = v => v != null && isFinite(v);
const pcS = (v, dp = 1) => (fin(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%` : "—"); // signed
const pc = (v, dp = 1) => (fin(v) ? `${(v * 100).toFixed(dp)}%` : "—");
const big = v => (!fin(v) ? "—" : Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px", marginBottom: 12 };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: "#475569", fontFamily: fonts.mono, lineHeight: 1.5 };

// ── Consensus, summarized relative to the last REPORTED fiscal year ─────────
export function consensusGrowth(data) {
  const inc = data.inc || [];
  const last = inc[inc.length - 1];
  if (!last) return null;
  const lastFY = +(last.fiscalYear || String(last.date || "").slice(0, 4));
  const fwd = (data.est || [])
    .map(e => ({ ...e, fy: +String(e.date || "").slice(0, 4) }))
    .filter(e => e.fy > lastFY && fin(e.revenueAvg) && e.revenueAvg > 0)
    .sort((a, b) => a.fy - b.fy);
  const rev0 = last.revenue, eps0 = last.epsDiluted, ni0 = last.netIncome;
  if (!fwd.length) return { lastFY, fwd: [], rev0, eps0, ni0, revCagr3: null, epsCagr3: null, revCagr5: null, n3: null, k3: null };
  const at = k => fwd.find(e => e.fy === lastFY + k);
  const cagr = (v0, vk, k) => (fin(v0) && v0 > 0 && fin(vk) && vk > 0 && k > 0 ? Math.pow(vk / v0, 1 / k) - 1 : null);
  const e3 = at(3) || fwd[Math.min(fwd.length - 1, 2)];
  const k3 = e3 ? e3.fy - lastFY : null;
  const e5 = at(5);
  return {
    lastFY, fwd, rev0, eps0, ni0, k3,
    revCagr3: e3 ? cagr(rev0, e3.revenueAvg, k3) : null,
    epsCagr3: e3 ? cagr(eps0, e3.epsAvg, k3) : null,
    revCagr5: e5 ? cagr(rev0, e5.revenueAvg, 5) : null,
    n3: e3?.numAnalystsRevenue ?? null,
    nEps3: e3?.numAnalystsEps ?? null,
    lastEstFY: fwd[fwd.length - 1].fy,
  };
}

// DCF over an explicit per-year growth path, then a Gordon terminal.
function dcfPath(fcf0, growths, r, gT) {
  let pv = 0, f = fcf0;
  growths.forEach((g, i) => { f = f * (1 + g); pv += f / Math.pow(1 + r, i + 1); });
  const N = growths.length;
  const tv = (f * (1 + gT)) / (r - gT);
  return pv + tv / Math.pow(1 + r, N);
}

// "If the Street is right": consensus revenue growth year by year (up to 5
// forward years with ≥2 analysts), then a straight-line fade to the terminal
// rate. Applied to FCF — i.e. it assumes the FCF margin holds.
function streetPathValue(fcf, street, N, r, gT) {
  if (!fin(fcf) || fcf <= 0 || !street?.fwd?.length || !fin(street.rev0) || street.rev0 <= 0) return null;
  const usable = street.fwd.filter(e => (e.numAnalystsRevenue ?? 0) >= 2 && e.fy - street.lastFY <= 5);
  if (!usable.length) return null;
  const growths = [];
  let prev = street.rev0, lastG = null, K = 0;
  for (let k = 1; k <= N; k++) {
    const e = usable.find(x => x.fy === street.lastFY + k);
    if (!e) break;
    lastG = e.revenueAvg / prev - 1; prev = e.revenueAvg; growths.push(lastG); K = k;
  }
  if (!K) return null;
  for (let k = K + 1; k <= N; k++) growths.push(lastG + (gT - lastG) * (k - K) / Math.max(1, N - K));
  return { value: dcfPath(fcf, growths, r, gT), K, growths };
}

// ── 1. Scoreboard ───────────────────────────────────────────────────────────
function Scoreboard({ implied, projYears, street, histRev5, histCAGR }) {
  const req = implied, st = street?.revCagr3;
  let gap;
  if (!fin(req)) gap = { text: "Not enough cash-flow history to solve the implied growth.", color: SLATE };
  else if (!fin(st)) gap = { text: "No forward consensus for this name — the only yardstick is history.", color: SLATE };
  else {
    const d = req - st;
    const yrs = street.k3;
    if (d <= -0.02) gap = { color: SLATE, text: `Consensus revenue growth of ${pc(st)}/yr over ${yrs} years exceeds the modeled FCF growth hurdle of ${pc(req)}/yr over ${projYears} years. These are different measures and horizons: test cash margins, reinvestment and durability before concluding the price is supported.` };
    else if (Math.abs(d) <= 0.02) gap = { color: SLATE, text: `The growth rates are close, but they are not an apples-to-apples valuation check: ${pc(req)}/yr FCF growth over ${projYears} years versus ${pc(st)}/yr revenue growth over ${yrs} years. Cash conversion and the growth path still matter.` };
    else gap = { color: AMBER, text: `The modeled FCF hurdle is ${pc(req)}/yr over ${projYears} years; consensus revenue growth is ${pc(st)}/yr over ${yrs} years. Investigate margins, reinvestment and growth beyond the consensus horizon. Their difference alone does not measure an earnings shortfall or mispricing.` };
  }
  const cell = (title, val, sub, color) => (
    <div style={{ flex: "1 1 160px", minWidth: 150 }}>
      <div style={label}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.8, lineHeight: 1.1, marginTop: 4 }}>{val}</div>
      <div style={{ fontSize: 9.5, color: SLATE, fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.45 }}>{sub}</div>
    </div>
  );
  return (
    <div style={{ ...card, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: gap.color }} />
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        {cell("The price requires", pc(req), `FCF growth per year, ${projYears} yrs, then terminal`, fin(req) ? gap.color : SLATE)}
        {cell("The Street models", pc(st), street?.k3 ? `revenue CAGR to FY${street.lastFY + street.k3} · ${street.n3 ?? "?"} analysts${fin(street.epsCagr3) ? ` · EPS ${pc(street.epsCagr3)}` : ""}` : "no forward estimates", fin(st) ? INDIGO : SLATE)}
        {cell("History delivered", pc(histRev5), `revenue CAGR, last 5 yrs${fin(histCAGR) ? ` · FCF ${pc(histCAGR)}` : ""}`, SLATE)}
      </div>
      <div style={{ fontSize: 11.5, color: "#cbd5e1", fontFamily: fonts.heading, marginTop: 12, lineHeight: 1.55 }}>{gap.text}</div>
      <div style={{ ...note, marginTop: 8 }}>The chart below applies the implied FCF growth rate to revenue or earnings for illustration. That requires constant conversion ratios; it is not an independently solved revenue or earnings requirement.</div>
    </div>
  );
}

// ── 2. Hurdle chart ─────────────────────────────────────────────────────────
function HurdleChart({ data, implied, projYears, street }) {
  const [metric, setMetric] = useState("revenue");
  const rows = useMemo(() => {
    const inc = data.inc || [];
    if (!inc.length || !street) return [];
    const key = metric === "revenue" ? "revenue" : "netIncome";
    const estKey = metric === "revenue" ? "revenueAvg" : "netIncomeAvg";
    const loKey = metric === "revenue" ? "revenueLow" : "netIncomeLow";
    const hiKey = metric === "revenue" ? "revenueHigh" : "netIncomeHigh";
    const lastFY = street.lastFY;
    const byFY = {};
    inc.forEach(r => { const fy = +(r.fiscalYear || String(r.date || "").slice(0, 4)); if (fy) byFY[fy] = r[key]; });
    const base = byFY[lastFY];
    const H = Math.min(projYears, 8);
    const out = [];
    for (let fy = lastFY - 7; fy <= lastFY + H; fy++) {
      const row = { fy: String(fy) };
      if (fy <= lastFY && fin(byFY[fy])) row.actual = byFY[fy];
      if (fy >= lastFY && fin(base) && fin(implied)) row.required = base * Math.pow(1 + implied, fy - lastFY);
      if (fy === lastFY && fin(base)) row.street = base;
      const e = street.fwd.find(x => x.fy === fy);
      if (e && fin(e[estKey])) {
        row.street = e[estKey];
        if (fin(e[loKey]) && fin(e[hiKey])) row.band = [e[loKey], e[hiKey]];
        row.n = e.numAnalystsRevenue;
      }
      out.push(row);
    }
    return out;
  }, [data, implied, projYears, street, metric]);

  if (!rows.length) return null;
  const chip = (id, txt) => (
    <button key={id} onClick={() => setMetric(id)} style={{ padding: "3px 10px", borderRadius: 6, border: `1px solid ${metric === id ? INDIGO : "rgba(255,255,255,0.1)"}`, background: metric === id ? INDIGO : "rgba(255,255,255,0.05)", color: metric === id ? "#0f172a" : SLATE, fontSize: 10, fontWeight: 600, fontFamily: fonts.mono, cursor: "pointer" }}>{txt}</button>
  );
  const fmtTip = (v, name) => {
    if (Array.isArray(v)) return [`${big(v[0])} – ${big(v[1])}`, "Street low–high"];
    return [big(v), name === "required" ? "Price requires" : name === "street" ? "Street consensus" : "Reported"];
  };
  return (
    <div style={{ ...card, padding: "14px 18px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={label}>The hurdle — what the price requires vs what the Street models</div>
          <div style={{ ...note, marginTop: 3 }}>dashed = the path today&apos;s price needs (margins held) · solid indigo = consensus average · shaded = analyst low–high · grey = reported</div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>{chip("revenue", "Revenue")}{chip("netIncome", "Net income")}</div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={rows} margin={{ top: 14, right: 18, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="fy" tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} />
          <YAxis tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={big} width={64} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={fmtTip} labelFormatter={l => `FY${l}`} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="plainline" formatter={v => ({ actual: "reported", required: "price requires", street: "Street consensus", band: "Street low–high" }[v] || v)} />
          <Area type="monotone" dataKey="band" stroke="none" fill={INDIGO} fillOpacity={0.14} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="actual" stroke="#cbd5e1" strokeWidth={2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="street" stroke={INDIGO} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="required" stroke={AMBER} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ ...note, marginTop: 2 }}>
        If the dashed line runs above the shaded band, the price needs the company to beat every analyst, every year. If it runs through or below the band, the Street already models what the price needs — the bet is on those numbers being right and lasting. Estimates thin out in the far years; the last consensus year here is FY{street.lastEstFY}.
      </div>
    </div>
  );
}

// ── 3. Value ladder ─────────────────────────────────────────────────────────
function ValueLadder({ fcf, mktCap, implied, discRate, termGrowth, projYears }) {
  if (!fin(fcf) || fcf <= 0 || !fin(mktCap) || mktCap <= 0 || !fin(implied) || discRate <= termGrowth) return null;
  const r = discRate, g = implied, gT = termGrowth, N = projYears;
  let pvFlat = 0, pvGrow = 0;
  for (let t = 1; t <= N; t++) { pvFlat += fcf / Math.pow(1 + r, t); pvGrow += (fcf * Math.pow(1 + g, t)) / Math.pow(1 + r, t); }
  const base = fcf / r;                                     // today's FCF, flat forever
  const explicit = Math.max(0, pvGrow - pvFlat);           // growth inside the explicit years
  const terminal = Math.max(0, mktCap - base - explicit);   // everything after year N (residual, sums to price)
  const parts = [
    { k: "Today's cash flow, flat forever", v: base, c: "#64748b", d: `${big(fcf)} ÷ ${pc(r)} WACC` },
    { k: `Growth in years 1–${N}`, v: explicit, c: INDIGO, d: `compounding at ${pc(g)}` },
    { k: `Everything after year ${N}`, v: terminal, c: AMBER, d: `terminal at ${pc(gT)}` },
  ];
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  const termShare = terminal / total;
  const read = termShare >= 0.6 ? `${pc(termShare, 0)} of the price lives beyond year ${N}. This is a durability bet: the next few years barely move the needle — what has to go right is that the franchise is still compounding a decade out.`
    : termShare >= 0.35 ? `${pc(termShare, 0)} of the price sits beyond year ${N} and ${pc(explicit / total, 0)} inside the explicit years — a balanced bet on both the visible growth and its persistence.`
    : `Only ${pc(termShare, 0)} of the price is beyond year ${N}; ${pc(base / total, 0)} is covered by today's cash flow held flat. The near term matters most here — a cash-flow story, not a duration story.`;
  return (
    <div style={card}>
      <div style={label}>Where the price comes from — market cap {big(mktCap)} decomposed</div>
      <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", marginTop: 10, background: "rgba(255,255,255,0.04)" }}>
        {parts.map(p => <div key={p.k} title={`${p.k}: ${big(p.v)}`} style={{ width: `${(p.v / total) * 100}%`, background: p.c, opacity: 0.85 }} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 12, marginTop: 10 }}>
        {parts.map(p => (
          <div key={p.k} style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 4, borderRadius: 2, background: p.c, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, lineHeight: 1.1 }}>{pc(p.v / total, 0)} <span style={{ fontSize: 10, color: SLATE, fontFamily: fonts.mono, fontWeight: 400 }}>{big(p.v)}</span></div>
              <div style={{ fontSize: 10, color: "#cbd5e1", fontFamily: fonts.mono, marginTop: 2 }}>{p.k}</div>
              <div style={note}>{p.d}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#cbd5e1", fontFamily: fonts.heading, marginTop: 10, lineHeight: 1.55 }}>{read}</div>
    </div>
  );
}

// ── 4. Street check ─────────────────────────────────────────────────────────
function StreetCheck({ data, fcf, mktCap, shares, price, discRate, termGrowth, projYears, histCAGR, street }) {
  const N = projYears, r = discRate, gT = termGrowth;
  const sp = useMemo(() => streetPathValue(fcf, street, N, r, gT), [fcf, street, N, r, gT]);
  const hp = fin(histCAGR) && fin(fcf) && fcf > 0 && r > gT ? dcfPath(fcf, Array(N).fill(histCAGR), r, gT) : null;
  const perShare = v => (fin(v) && shares > 0 ? v / shares : null);
  const scen = [
    { k: "If the Street is right", v: perShare(sp?.value), sub: sp ? `consensus revenue growth for ${sp.K} yr${sp.K > 1 ? "s" : ""}, fading to ${pc(gT)} by year ${N} · FCF margin held` : "no usable consensus path", c: INDIGO },
    { k: "If history repeats", v: perShare(hp), sub: fin(histCAGR) ? `FCF compounding at its ${pc(histCAGR)} historical CAGR for ${N} yrs` : "no FCF history", c: SLATE },
  ].filter(s => fin(s.v));
  const pt = data.pt, gr = data.grades;
  const buy = (gr?.strongBuy ?? 0) + (gr?.buy ?? 0), hold = gr?.hold ?? 0, sell = (gr?.sell ?? 0) + (gr?.strongSell ?? 0);
  const nGr = buy + hold + sell;
  // one axis for the target range + scenarios + price
  const pts = [price, pt?.targetLow, pt?.targetHigh, pt?.targetConsensus, ...scen.map(s => s.v)].filter(fin);
  const lo = Math.min(...pts) * 0.92, hi = Math.max(...pts) * 1.06;
  const x = v => `${((v - lo) / (hi - lo)) * 100}%`;
  if (!fin(price) || pts.length < 2) return null;
  const up = v => (fin(v) && fin(price) ? v / price - 1 : null);
  return (
    <div style={card}>
      <div style={label}>Street check — fair value under each story vs the price</div>
      {/* axis */}
      <div style={{ position: "relative", height: 74, marginTop: 14 }}>
        {pt && fin(pt.targetLow) && fin(pt.targetHigh) && (
          <div style={{ position: "absolute", top: 30, left: x(pt.targetLow), width: `calc(${x(pt.targetHigh)} - ${x(pt.targetLow)})`, height: 10, borderRadius: 5, background: "rgba(129,140,248,0.18)" }} title={`Analyst targets $${pt.targetLow}–$${pt.targetHigh}`} />
        )}
        {pt && fin(pt.targetConsensus) && (<>
          <div style={{ position: "absolute", top: 26, left: `calc(${x(pt.targetConsensus)} - 1.5px)`, width: 3, height: 18, background: INDIGO, borderRadius: 2 }} />
          <div style={{ position: "absolute", top: 46, left: x(pt.targetConsensus), transform: "translateX(-50%)", fontSize: 9, color: INDIGO, fontFamily: fonts.mono, whiteSpace: "nowrap" }}>target ${pt.targetConsensus.toFixed(0)} ({pcS(up(pt.targetConsensus), 0)})</div>
        </>)}
        {scen.map((s, i) => (
          <div key={s.k}>
            <div style={{ position: "absolute", top: 22, left: `calc(${x(s.v)} - 5px)`, width: 10, height: 10, transform: "rotate(45deg)", background: s.c, border: "2px solid #0f172a", zIndex: 1 }} />
            <div style={{ position: "absolute", top: i === 0 ? 0 : 58, left: x(s.v), transform: "translateX(-50%)", fontSize: 9, color: s.c, fontFamily: fonts.mono, whiteSpace: "nowrap" }}>{s.k.replace("If ", "")} ${s.v.toFixed(0)} ({pcS(up(s.v), 0)})</div>
          </div>
        ))}
        <div style={{ position: "absolute", top: 20, left: `calc(${x(price)} - 1px)`, width: 2, height: 30, background: "#f1f5f9", zIndex: 2 }} />
        <div style={{ position: "absolute", top: 8, left: x(price), transform: "translateX(-50%)", fontSize: 10, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.mono, whiteSpace: "nowrap", zIndex: 2, background: "#0f172a", padding: "0 4px", borderRadius: 3 }}>price ${price.toFixed(2)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 12, marginTop: 8 }}>
        {scen.map(s => (
          <div key={s.k} style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 4, borderRadius: 2, background: s.c, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: up(s.v) >= 0 ? GREEN : RED, fontFamily: fonts.heading, lineHeight: 1.1 }}>{pcS(up(s.v), 0)} <span style={{ fontSize: 10, color: SLATE, fontFamily: fonts.mono, fontWeight: 400 }}>${s.v.toFixed(0)}/sh</span></div>
              <div style={{ fontSize: 10, color: "#cbd5e1", fontFamily: fonts.mono, marginTop: 2 }}>{s.k}</div>
              <div style={note}>{s.sub}</div>
            </div>
          </div>
        ))}
        {pt && (
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 4, borderRadius: 2, background: INDIGO, flexShrink: 0, opacity: 0.5 }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: up(pt.targetConsensus) >= 0 ? GREEN : RED, fontFamily: fonts.heading, lineHeight: 1.1 }}>{pcS(up(pt.targetConsensus), 0)} <span style={{ fontSize: 10, color: SLATE, fontFamily: fonts.mono, fontWeight: 400 }}>${fin(pt.targetConsensus) ? pt.targetConsensus.toFixed(0) : "—"} consensus</span></div>
              <div style={{ fontSize: 10, color: "#cbd5e1", fontFamily: fonts.mono, marginTop: 2 }}>Analyst price targets</div>
              <div style={note}>low ${pt.targetLow} · median ${pt.targetMedian} · high ${pt.targetHigh}</div>
            </div>
          </div>
        )}
      </div>
      {nGr > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={label}>Ratings · {nGr} analysts · consensus {gr.consensus}</span>
            <span style={note}>{buy} buy · {hold} hold · {sell} sell</span>
          </div>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 5, background: "rgba(255,255,255,0.04)" }}>
            <div style={{ width: `${(buy / nGr) * 100}%`, background: GREEN, opacity: 0.8 }} />
            <div style={{ width: `${(hold / nGr) * 100}%`, background: AMBER, opacity: 0.8 }} />
            <div style={{ width: `${(sell / nGr) * 100}%`, background: RED, opacity: 0.8 }} />
          </div>
        </div>
      )}
      <div style={{ ...note, marginTop: 10 }}>
        Both scenario values use your WACC and terminal-growth sliders. &ldquo;If the Street is right&rdquo; is the only forward-looking number here that isn&apos;t yours or the price&apos;s — read the gap between it and the price as the market&apos;s premium (or discount) to consensus. Price targets are the Street&apos;s 12-month opinion, not a valuation; ratings skew bullish industry-wide.
      </div>
    </div>
  );
}

export default function ExpectationsPanel({ data, implied, fcf, mktCap, shares, price, discRate, termGrowth, projYears, histCAGR, street }) {
  const histRev5 = useMemo(() => {
    const inc = data.inc || [];
    const last = inc[inc.length - 1], past = inc[inc.length - 6];
    return last?.revenue > 0 && past?.revenue > 0 ? Math.pow(last.revenue / past.revenue, 1 / 5) - 1 : null;
  }, [data]);
  return (<>
    <SH>What Has to Go Right</SH>
    <Scoreboard implied={implied} projYears={projYears} street={street} histRev5={histRev5} histCAGR={histCAGR} />
    <HurdleChart data={data} implied={implied} projYears={projYears} street={street} />
    <ValueLadder fcf={fcf} mktCap={mktCap} implied={implied} discRate={discRate} termGrowth={termGrowth} projYears={projYears} />
    <StreetCheck data={data} fcf={fcf} mktCap={mktCap} shares={shares} price={price} discRate={discRate} termGrowth={termGrowth} projYears={projYears} histCAGR={histCAGR} street={street} />
  </>);
}
