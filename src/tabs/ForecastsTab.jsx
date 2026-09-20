import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, ScatterChart, Scatter, CartesianGrid, ZAxis } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "../components/shared.jsx";
import ForecastPanel from "../components/ForecastPanel.jsx";

// ─── Forecasts tab — market expectations, not a betting book ─────────────────
// Data from /api/fs-markets (markets.futuresearch.ai, cached server-side).
// Framing: the HEADLINE number on every row is what the prediction market
// currently prices (implied probability of the outcome). FutureSearch's own
// forecast rides along as a second opinion (they have a public settled
// record, shown up top). Positions that share an event (e.g. every "Fed
// decision in Jul" outcome) are grouped so you see the whole distribution
// of expectations, not scattered line items.
const GREEN = "#4ade80", RED = "#f87171", AMBER = "#fbbf24", INDIGO = "#818cf8";

// Financial categories first; anything unmatched lands in Politics & World,
// which is collapsed by default.
const CATS = [
  { id: "rates",  label: "Rates & Inflation",     re: /\b(fed|fomc|rate|inflation|cpi|pce|powell|treasury|yield|recession)\b/i },
  { id: "ai",     label: "AI & Compute Prices",   re: /\b(nvidia|gpu|compute|h100|h200|b200|gb200|openai|anthropic|ai model|datacenter|data center|token)\b/i },
  { id: "energy", label: "Energy & Commodities",  re: /\b(oil|wti|brent|natural gas|henry hub|gasoline|opec|gold|silver|copper|uranium|lithium|hormuz)\b/i },
  { id: "crypto", label: "Crypto",                re: /\b(bitcoin|btc|ethereum|eth|crypto|saylor|coinbase|solana)\b/i },
  { id: "econ",   label: "Markets & Economy",     re: /\b(s&p|nasdaq|dow|gdp|unemployment|jobs report|stock|ipo|earnings|market cap|tariff|trade deal|shutdown|debt ceiling|funded)\b/i },
  { id: "world",  label: "Politics & World",      re: /./ },
];
const catOf = title => CATS.find(c => c.re.test(title))?.id ?? "world";

function StatCard({ label, val, sub, color }) {
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color || INDIGO }} />
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{val}</div>
      {sub && <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// One outcome line: market's probability as the headline, FS view secondary.
function OutcomeRow({ outcome, mktYes, fsYes, url, endDate, indent }) {
  const mktPct = Math.round(mktYes * 100);
  const fsPct = fsYes != null ? Math.round(fsYes * 100) : null;
  const disagree = fsPct != null && Math.abs(fsPct - mktPct) >= 15;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: indent ? "5px 0 5px 14px" : "7px 0" }}>
      <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: indent ? 11 : 11.5, fontFamily: fonts.heading, color: "#cbd5e1" }}>
        <a href={url} target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "none" }}>{outcome}</a>
        {endDate && <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginLeft: 8 }}>{String(endDate).slice(0, 10)}</span>}
      </div>
      <div style={{ width: 110, flexShrink: 0, height: 7, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${mktPct}%`, height: "100%", background: mktPct >= 65 ? GREEN : mktPct >= 35 ? AMBER : "rgba(148,163,184,0.6)", borderRadius: 4 }} />
      </div>
      <div style={{ width: 52, flexShrink: 0, textAlign: "right", fontSize: 14, fontWeight: 700, fontFamily: fonts.mono, color: "var(--text-primary)" }}>{mktPct}%</div>
      <div style={{ width: 74, flexShrink: 0, textAlign: "right", fontSize: 10, fontFamily: fonts.mono, color: disagree ? AMBER : "#64748b" }} title="FutureSearch's own forecast">
        {fsPct != null ? `FS ${fsPct}%${disagree ? " ⚠" : ""}` : ""}
      </div>
    </div>
  );
}

export default function ForecastsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [showWorld, setShowWorld] = useState(false);

  useEffect(() => {
    fetch("/api/fs-markets")
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setData(d); })
      .catch(() => setError(true));
  }, []);

  // Open positions → normalized to "probability the OUTCOME happens", grouped
  // into event families by the shared "Event: outcome" title prefix.
  const grouped = useMemo(() => {
    if (!data?.positions) return null;
    const open = data.positions.filter(p => p.status === "open" && p.marketPrice != null);
    const rows = open.map(p => {
      const mktYes = p.position === "NO" ? 1 - p.marketPrice : p.marketPrice;
      const ci = p.title.indexOf(": ");
      const event = ci > 0 ? p.title.slice(0, ci) : p.title;
      const outcome = ci > 0 ? p.title.slice(ci + 2) : p.title;
      return { ...p, mktYes, event, outcome, cat: catOf(p.title) };
    });
    // group by event within category
    const byCat = {};
    for (const r of rows) {
      byCat[r.cat] = byCat[r.cat] || {};
      byCat[r.cat][r.event] = byCat[r.cat][r.event] || [];
      byCat[r.cat][r.event].push(r);
    }
    // shape: [{cat, label, events: [{event, endDate, outcomes(sorted by mkt prob desc)}]}]
    return CATS.map(c => {
      const events = Object.entries(byCat[c.id] || {}).map(([event, list]) => ({
        event,
        endDate: list.map(x => x.endDate).sort()[0] || null,
        outcomes: [...list].sort((a, b) => b.mktYes - a.mktYes),
      })).sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999"));
      const n = events.reduce((s, e) => s + e.outcomes.length, 0);
      return { ...c, events, n };
    }).filter(c => c.n > 0);
  }, [data]);

  const scatter = useMemo(() => {
    if (!data?.companies) return { rows: [], topLong: [], topShort: [] };
    const rows = data.companies.filter(c => c.marketCapB > 0 && c.valuationB > 0);
    const byUpside = [...rows].sort((a, b) => b.upsidePct - a.upsidePct);
    return { rows, topLong: byUpside.slice(0, 6), topShort: byUpside.slice(-6).reverse() };
  }, [data]);

  if (error) return <InfoBox color="#F97316">Unable to load prediction-market data. The source may be temporarily unreachable — the endpoint serves a cached archive when available.</InfoBox>;
  if (!data || !grouped) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading market expectations…</div>;

  const s = data.summary || {};
  const financial = grouped.filter(c => c.id !== "world");
  const world = grouped.find(c => c.id === "world");

  return (<>
    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5, marginBottom: 4 }}>
      Forecasts — What Markets Expect
    </div>
    <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginBottom: 6, maxWidth: 860, lineHeight: 1.5 }}>
      Live prediction-market odds (Kalshi / Polymarket) on financial questions — the <strong style={{ color: "#cbd5e1" }}>bold number is what the market prices</strong>, i.e. the crowd&apos;s probability that the outcome happens. &ldquo;FS&rdquo; is FutureSearch&apos;s own AI forecast as a second opinion (⚠ marks a ≥15pt disagreement). Not a betting tool — a read on expectations. Sourced from <a href="https://markets.futuresearch.ai" target="_blank" rel="noopener" style={{ color: INDIGO }}>markets.futuresearch.ai</a>.
    </div>
    {!data.liveOk && (
      <div style={{ background: "rgba(251,191,36,0.08)", border: "1px solid #fbbf24", borderRadius: 10, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: "#cbd5e1", fontFamily: fonts.mono }}>
        ⚠ Live source unavailable — showing archived snapshot from {String(data.fetchedAt).slice(0, 10)}.
      </div>
    )}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(170px, 100%),1fr))", gap: 10, margin: "12px 0 18px" }}>
      <StatCard label="Markets Tracked" val={s.open ?? "—"} sub="open questions, refreshed ~6h" color={INDIGO} />
      <StatCard label="FS Second-Opinion Record" val={`${s.won ?? "—"}W / ${s.lost ?? "—"}L`} sub={s.winRate != null ? `${s.winRate}% on settled questions` : ""} color={s.winRate >= 55 ? GREEN : AMBER} />
      <StatCard label="Stock Valuations" val={scatter.rows.length} sub="S&P names, FS fair value vs price" color="#8B5CF6" />
      <StatCard label="Snapshot" val={String(data.fetchedAt).slice(0, 10)} sub="markets.futuresearch.ai" color="#94a3b8" />
    </div>

    {/* ── Market expectations, by financial category ── */}
    {financial.map(c => (
      <div key={c.id} style={{ marginBottom: 18 }}>
        <SH>{c.label}</SH>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 12 }}>
          {c.events.map(ev => (
            <div key={ev.event} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 18px" }}>
              {ev.outcomes.length > 1 ? (<>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, marginBottom: 6 }}>
                  {ev.event}
                  {ev.endDate && <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginLeft: 8, fontWeight: 400 }}>resolves {String(ev.endDate).slice(0, 10)}</span>}
                </div>
                {ev.outcomes.map(o => (
                  <OutcomeRow key={o.id} outcome={o.outcome} mktYes={o.mktYes} fsYes={o.probabilityYes} url={o.url} indent />
                ))}
              </>) : (
                <OutcomeRow outcome={ev.outcomes[0].title} mktYes={ev.outcomes[0].mktYes} fsYes={ev.outcomes[0].probabilityYes} url={ev.outcomes[0].url} endDate={ev.endDate} />
              )}
            </div>
          ))}
        </div>
      </div>
    ))}

    {/* ── Politics & world, demoted ── */}
    {world && (<>
      <button onClick={() => setShowWorld(v => !v)} style={{ fontSize: 11, padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.35)", background: showWorld ? "rgba(99,102,241,0.18)" : "transparent", color: "#a5b4fc", cursor: "pointer", fontFamily: fonts.mono, marginBottom: 12 }}>
        {showWorld ? "▾ Hide" : "▸ Show"} politics &amp; world ({world.n} questions)
      </button>
      {showWorld && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 12, marginBottom: 18 }}>
          {world.events.map(ev => (
            <div key={ev.event} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 18px" }}>
              {ev.outcomes.length > 1 ? (<>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading, marginBottom: 6 }}>{ev.event}</div>
                {ev.outcomes.map(o => <OutcomeRow key={o.id} outcome={o.outcome} mktYes={o.mktYes} fsYes={o.probabilityYes} url={o.url} indent />)}
              </>) : (
                <OutcomeRow outcome={ev.outcomes[0].title} mktYes={ev.outcomes[0].mktYes} fsYes={ev.outcomes[0].probabilityYes} url={ev.outcomes[0].url} endDate={ev.endDate} />
              )}
            </div>
          ))}
        </div>
      )}
    </>)}

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How to use this.</strong> Prediction markets are the cleanest real-time read on consensus expectations — when the Fed card says 80%, the crowd (with money down) puts 4-in-5 odds on that outcome, and anything your clients hear on CNBC is already in that number. The FS column is a calibrated AI&apos;s dissent: when it diverges ≥15pts (⚠), either the market is stale or the model is wrong — their {s.winRate ?? "—"}% settled record above is the base rate for taking the model&apos;s side. Caveat: some of these books are thin, so small markets can lag news by hours.
    </InfoBox>

    {/* ── Stock valuation scatter ── */}
    <SH>S&amp;P Valuations — FutureSearch Fair Value vs Market</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 12 }}>
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis type="number" dataKey="marketCapB" name="Market cap" scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(0) + "T" : v.toFixed(0) + "B"}`} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} label={{ value: "Market cap (log)", position: "insideBottom", offset: -4, fill: "#475569", fontSize: 10, fontFamily: fonts.mono }} />
          <YAxis type="number" dataKey="valuationB" name="FS valuation" scale="log" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(0) + "T" : v.toFixed(0) + "B"}`} axisLine={false} tickLine={false} />
          <ZAxis range={[18, 19]} />
          <Tooltip content={({ payload }) => {
            const d = payload?.[0]?.payload;
            if (!d) return null;
            return (
              <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, padding: "8px 12px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
                <div style={{ fontWeight: 700, color: "#f1f5f9" }}>{d.ticker} <span style={{ fontWeight: 400, color: "#64748b" }}>{d.company}</span></div>
                <div>mkt ${d.marketCapB.toFixed(1)}B → FS ${d.valuationB.toFixed(1)}B ({d.upsidePct >= 0 ? "+" : ""}{d.upsidePct.toFixed(0)}%)</div>
              </div>
            );
          }} />
          <Scatter data={scatter.rows.filter(r => r.bucket === "long")} fill={GREEN} fillOpacity={0.55} isAnimationActive={false} />
          <Scatter data={scatter.rows.filter(r => r.bucket === "short")} fill={RED} fillOpacity={0.55} isAnimationActive={false} />
          <Scatter data={scatter.rows.filter(r => r.bucket !== "long" && r.bucket !== "short")} fill="#64748b" fillOpacity={0.35} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingBottom: 6, lineHeight: 1.5 }}>
        Each dot is an S&amp;P company: market cap (x) vs FutureSearch&apos;s modeled fair value (y), both log. Above the diagonal = FS sees upside (green = long), below = overvalued (red = short). {scatter.rows.length} companies.
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      {[["Biggest Upside (FS long book)", scatter.topLong, GREEN], ["Biggest Downside (FS short book)", scatter.topShort, RED]].map(([label, list, color]) => (
        <div key={label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
          {list.map(c => (
            <div key={c.ticker} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", fontSize: 11, fontFamily: fonts.mono }}>
              <span style={{ color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><strong style={{ color: INDIGO }}>{c.ticker}</strong> {c.company}</span>
              <span style={{ color, fontWeight: 700, flexShrink: 0 }}>{c.upsidePct >= 0 ? "+" : ""}{c.upsidePct.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      ))}
    </div>

    <InfoBox color="#F59E0B">
      <strong style={{ color: "#cbd5e1" }}>Caveats.</strong> Market odds are consensus, not truth — they&apos;re your baseline for &ldquo;what&apos;s priced in.&rdquo; The valuation &ldquo;upside&rdquo; numbers are FutureSearch&apos;s model vs price; extreme values (±300%+) usually mean the model disputes the market&apos;s entire framing of a business, which is exactly when models are most often wrong. Nothing here is investment advice — it&apos;s a structured read on expectations.
    </InfoBox>

    {/* ── Our commissioned forecast battery ── */}
    <div style={{ marginTop: 20 }}>
      <ForecastPanel />
    </div>
  </>);
}
