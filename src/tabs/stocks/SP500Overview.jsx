import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, BarChart, Bar, Cell } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { SH, InfoBox } from "../../components/shared.jsx";

/*
 * SP500Overview — the whole index on one screen.
 *  · Valuation map: earnings yield (or P/E) vs quality/risk, all 500 names
 *  · Sector valuation bars, P/E distribution
 *  · Magic Formula shortlist (cheap × high quality)
 * Data: /api/sp500-screener (already cached server-side) + /api/erp for 10Y.
 */

const SECTOR_COLORS = {
  "Technology": "#6366F1", "Financial Services": "#3B82F6", "Healthcare": "#10B981",
  "Consumer Cyclical": "#F59E0B", "Communication Services": "#8B5CF6", "Industrials": "#94a3b8",
  "Consumer Defensive": "#14B8A6", "Energy": "#EF4444", "Utilities": "#EAB308",
  "Real Estate": "#EC4899", "Basic Materials": "#F97316",
};
const secColor = s => SECTOR_COLORS[s] || "#64748b";

const median = (arr) => {
  const a = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const fmtMc = v => v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : `$${(v / 1e6).toFixed(0)}M`;

// X-axis presets (all in %, except beta)
const X_PRESETS = [
  { id: "roic",   label: "ROIC (quality)",     get: s => s.roic != null ? s.roic * 100 : null,      unit: "%", domain: [-10, 60],  note: "return on invested capital" },
  { id: "margin", label: "Net margin",          get: s => s.netMargin != null ? s.netMargin * 100 : null, unit: "%", domain: [-20, 60], note: "profitability" },
  { id: "beta",   label: "Beta (risk)",         get: s => s.beta,                                    unit: "",  domain: [0, 3],     note: "market sensitivity" },
];

function ScatterTip({ active, payload, yMode }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ background: "#0f172a", border: `1px solid ${secColor(p.sector)}`, borderRadius: 8, padding: "9px 12px", fontSize: 11, fontFamily: fonts.mono, minWidth: 170, boxShadow: "0 6px 20px rgba(0,0,0,0.5)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading }}>{p.symbol}</span>
        <span style={{ fontSize: 9, color: secColor(p.sector) }}>{p.sector}</span>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 10, marginBottom: 5, maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "2px 14px", color: "#cbd5e1" }}>
        <span style={{ color: "#64748b" }}>{yMode === "pe" ? "P/E" : "Earnings yield"}</span><span style={{ textAlign: "right", fontWeight: 600 }}>{yMode === "pe" ? p.pe?.toFixed(1) : `${p.y?.toFixed(2)}%`}</span>
        <span style={{ color: "#64748b" }}>ROIC</span><span style={{ textAlign: "right" }}>{p.roicPct != null ? `${p.roicPct.toFixed(1)}%` : "—"}</span>
        <span style={{ color: "#64748b" }}>Mkt cap</span><span style={{ textAlign: "right" }}>{fmtMc(p.mktCap)}</span>
      </div>
      <div style={{ marginTop: 5, fontSize: 9, color: "#818cf8" }}>Click to open {p.symbol} in context</div>
    </div>
  );
}

function SP500Overview({ onSelectStock }) {
  const [stocks, setStocks] = useState([]);
  const [tenYear, setTenYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [yMode, setYMode] = useState("ey");        // "ey" | "pe"
  const [xPreset, setXPreset] = useState("roic");
  const [sector, setSector] = useState("All");

  useEffect(() => {
    Promise.all([
      fetch("/api/sp500-screener").then(r => r.json()),
      fetch("/api/erp").then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([scr, erp]) => {
      setStocks(Array.isArray(scr?.stocks) ? scr.stocks : Array.isArray(scr) ? scr : []);
      if (erp?.tenYear != null) setTenYear(erp.tenYear);
      setError(false);
    }).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);

  const xCfg = X_PRESETS.find(p => p.id === xPreset) || X_PRESETS[0];

  // Scatter points, cleaned + clamped
  const pts = useMemo(() => {
    return stocks.map(s => {
      const eyPct = s.earningsYield != null ? s.earningsYield * 100 : (s.pe > 0 ? 100 / s.pe : null);
      const y = yMode === "pe" ? s.pe : eyPct;
      const x = xCfg.get(s);
      if (y == null || x == null || !isFinite(y) || !isFinite(x)) return null;
      if (yMode === "pe" && (y <= 0 || y > 80)) return null;
      if (yMode === "ey" && (y < -2 || y > 20)) return null;
      if (x < xCfg.domain[0] || x > xCfg.domain[1]) return null;
      if (sector !== "All" && s.sector !== sector) return null;
      return { symbol: s.symbol, name: s.name, sector: s.sector, mktCap: s.mktCap, pe: s.pe, x: +x.toFixed(2), y: +y.toFixed(2), z: Math.sqrt(s.mktCap || 1e9), roicPct: s.roic != null ? s.roic * 100 : null };
    }).filter(Boolean);
  }, [stocks, yMode, xCfg, sector]);

  // Headline stats
  const stats = useMemo(() => {
    const pes = stocks.map(s => s.pe).filter(v => v > 0 && v < 100);
    const eys = stocks.map(s => s.earningsYield != null ? s.earningsYield * 100 : null).filter(v => v != null);
    const roics = stocks.map(s => s.roic != null ? s.roic * 100 : null).filter(v => v != null);
    const beat10Y = tenYear != null && eys.length ? Math.round((eys.filter(v => v > tenYear).length / eys.length) * 100) : null;
    return { medPe: median(pes), medEy: median(eys), medRoic: median(roics), beat10Y, n: stocks.length };
  }, [stocks, tenYear]);

  // Sector medians (earnings yield, cheapest first)
  const sectorRows = useMemo(() => {
    const by = {};
    stocks.forEach(s => {
      const ey = s.earningsYield != null ? s.earningsYield * 100 : null;
      if (ey == null || !s.sector) return;
      (by[s.sector] = by[s.sector] || []).push(ey);
    });
    return Object.entries(by).map(([sec, arr]) => ({ sector: sec, ey: +median(arr).toFixed(2), n: arr.length }))
      .sort((a, b) => b.ey - a.ey);
  }, [stocks]);

  // P/E histogram (bins of 5, 0–60)
  const histo = useMemo(() => {
    const bins = Array.from({ length: 12 }, (_, i) => ({ bin: `${i * 5}–${i * 5 + 5}`, lo: i * 5, count: 0 }));
    let over = 0;
    stocks.forEach(s => {
      if (!(s.pe > 0)) return;
      if (s.pe >= 60) { over++; return; }
      bins[Math.floor(s.pe / 5)].count++;
    });
    return { bins, over };
  }, [stocks]);

  // Magic Formula: rank(earnings yield) + rank(ROIC), lower combined = better
  const magic = useMemo(() => {
    const elig = stocks.filter(s => s.pe > 0 && s.earningsYield != null && s.roic != null);
    const byEy = [...elig].sort((a, b) => b.earningsYield - a.earningsYield);
    const byRoic = [...elig].sort((a, b) => b.roic - a.roic);
    const rEy = new Map(byEy.map((s, i) => [s.symbol, i + 1]));
    const rRo = new Map(byRoic.map((s, i) => [s.symbol, i + 1]));
    return elig.map(s => ({ ...s, combo: rEy.get(s.symbol) + rRo.get(s.symbol) }))
      .sort((a, b) => a.combo - b.combo).slice(0, 15);
  }, [stocks]);

  if (loading) return <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", fontFamily: fonts.heading, fontSize: 14 }}>Loading S&amp;P 500 fundamentals…</div>;
  if (error || !stocks.length) return <InfoBox color="#F97316">Unable to load S&amp;P 500 data — the screener cache may still be building. Try again in a minute.</InfoBox>;

  const sectors = ["All", ...Object.keys(SECTOR_COLORS).filter(s => stocks.some(x => x.sector === s))];
  const btn = active => ({ padding: "4px 11px", borderRadius: 7, border: `1px solid ${active ? "#818cf8" : "var(--border-subtle)"}`, background: active ? "#818cf8" : "transparent", color: active ? "#0f172a" : "var(--text-secondary)", fontSize: 11, fontWeight: 600, fontFamily: fonts.mono, cursor: "pointer" });
  const open = (sym) => { if (sym && onSelectStock) onSelectStock(sym); };

  return (<>
    {/* Headline stats */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: 10, marginBottom: 16 }}>
      {[
        { l: "Median P/E", v: stats.medPe?.toFixed(1), sub: `${stats.n} constituents`, c: "#6366F1" },
        { l: "Median Earnings Yield", v: stats.medEy != null ? `${stats.medEy.toFixed(2)}%` : "—", sub: "1 ÷ P/E, TTM", c: "#10B981" },
        { l: "Beat the 10Y", v: stats.beat10Y != null ? `${stats.beat10Y}%` : "—", sub: tenYear != null ? `EY above ${tenYear.toFixed(2)}% treasury` : "vs 10Y treasury", c: "#F59E0B" },
        { l: "Median ROIC", v: stats.medRoic != null ? `${stats.medRoic.toFixed(1)}%` : "—", sub: "return on invested capital", c: "#8B5CF6" },
      ].map(t => (
        <div key={t.l} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: t.c }} />
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{t.l}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginTop: 3 }}>{t.v ?? "—"}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 2 }}>{t.sub}</div>
        </div>
      ))}
    </div>

    {/* Valuation map */}
    <SH>Valuation Map — Every S&amp;P 500 Name</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono }}>Y:</span>
          <button style={btn(yMode === "ey")} onClick={() => setYMode("ey")}>Earnings yield</button>
          <button style={btn(yMode === "pe")} onClick={() => setYMode("pe")}>P/E</button>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono }}>X:</span>
          {X_PRESETS.map(p => <button key={p.id} style={btn(xPreset === p.id)} onClick={() => setXPreset(p.id)}>{p.label}</button>)}
        </div>
        <select value={sector} onChange={e => setSector(e.target.value)} style={{ marginLeft: "auto", background: "#0f172a", border: "1px solid var(--border-subtle)", borderRadius: 7, color: "var(--text-secondary)", fontSize: 11, fontFamily: fonts.mono, padding: "4px 8px", cursor: "pointer" }}>
          {sectors.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis type="number" dataKey="x" domain={xCfg.domain} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false}
            label={{ value: `${xCfg.label}${xCfg.unit ? ` (${xCfg.unit})` : ""} →`, position: "insideBottom", offset: -8, style: { fill: "#64748b", fontSize: 10, fontFamily: "monospace" } }} />
          <YAxis type="number" dataKey="y" domain={["auto", "auto"]} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false}
            tickFormatter={v => yMode === "pe" ? v : `${v}%`}
            label={{ value: yMode === "pe" ? "P/E →" : "Earnings yield →", angle: -90, position: "insideLeft", offset: 12, style: { fill: "#64748b", fontSize: 10, fontFamily: "monospace" } }} />
          <ZAxis type="number" dataKey="z" range={[15, 320]} />
          <Tooltip cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.2)" }} content={<ScatterTip yMode={yMode} />} />
          {yMode === "ey" && tenYear != null && <ReferenceLine y={tenYear} stroke="#F59E0B" strokeDasharray="5 4" label={{ value: `10Y ${tenYear.toFixed(2)}%`, fill: "#F59E0B", fontSize: 9, position: "insideTopRight" }} />}
          {yMode === "ey" && stats.medEy != null && <ReferenceLine y={stats.medEy} stroke="rgba(148,163,184,0.5)" strokeDasharray="2 3" label={{ value: "median", fill: "#64748b", fontSize: 9, position: "insideBottomRight" }} />}
          {yMode === "pe" && stats.medPe != null && <ReferenceLine y={stats.medPe} stroke="rgba(148,163,184,0.5)" strokeDasharray="2 3" label={{ value: "median", fill: "#64748b", fontSize: 9, position: "insideTopRight" }} />}
          <Scatter data={pts} isAnimationActive={false} onClick={(e) => open(e?.payload?.symbol ?? e?.symbol)}
            shape={(props) => <circle cx={props.cx} cy={props.cy} r={Math.max(2.4, (props.payload?.z ? Math.min(11, props.payload.z / 45000) : 3))} fill={secColor(props.payload?.sector)} opacity={0.72} style={{ cursor: "pointer" }} />} />
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, paddingLeft: 6 }}>
        {Object.entries(SECTOR_COLORS).map(([s, c]) => (
          <span key={s} onClick={() => setSector(sector === s ? "All" : s)} style={{ fontSize: 9, fontFamily: fonts.mono, color: sector === "All" || sector === s ? "var(--text-secondary)" : "var(--text-muted)", opacity: sector === "All" || sector === s ? 1 : 0.4, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, display: "inline-block" }} />{s}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 6, paddingLeft: 6 }}>
        Bubble size = market cap · {pts.length} names plotted{yMode === "ey" ? " · the hunting ground is top-right: cheap AND high quality, above the 10Y line" : ""} · click a sector chip to isolate it, click any dot to open the stock.
      </div>
    </div>

    {/* Sector valuation + P/E distribution */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 14, marginBottom: 16 }}>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Median Earnings Yield by Sector — Cheapest First</div>
        <ResponsiveContainer width="100%" height={Math.max(240, sectorRows.length * 26)}>
          <BarChart data={sectorRows} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
            <XAxis type="number" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <YAxis type="category" dataKey="sector" width={128} tick={{ fill: "#cbd5e1", fontSize: 9.5, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v, n, p) => [`${v}% median EY · ${p.payload.n} names`, p.payload.sector]} />
            {tenYear != null && <ReferenceLine x={tenYear} stroke="#F59E0B" strokeDasharray="5 4" />}
            <Bar dataKey="ey" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {sectorRows.map(r => <Cell key={r.sector} fill={secColor(r.sector)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {tenYear != null && <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 4 }}>Amber dashed line = 10Y treasury ({tenYear.toFixed(2)}%). Sectors right of it out-yield bonds on earnings.</div>}
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>P/E Distribution</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={histo.bins} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
            <XAxis dataKey="bin" tick={{ fill: "#475569", fontSize: 8.5, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={1} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={v => [`${v} companies`, "Count"]} labelFormatter={l => `P/E ${l}`} />
            <Bar dataKey="count" fill="#818cf8" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 4 }}>
          Median {stats.medPe?.toFixed(1)} · {histo.over} names above P/E 60 not shown · negative earners excluded.
        </div>
      </div>
    </div>

    {/* Magic Formula shortlist */}
    <SH>Cheap × Quality — Magic Formula Top 15</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead>
          <tr>
            {["#", "Ticker", "Company", "Sector", "P/E", "Earnings Yield", "ROIC", "Mkt Cap"].map((h, i) => (
              <th key={h} style={{ padding: "9px 12px", fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase", textAlign: i >= 4 ? "right" : "left", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {magic.map((s, i) => (
            <tr key={s.symbol} onClick={() => open(s.symbol)} style={{ borderBottom: i < magic.length - 1 ? "1px solid rgba(148,163,184,0.08)" : "none", cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(129,140,248,0.06)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: i < 3 ? "#f59e0b" : "var(--text-muted)", fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</td>
              <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: fonts.mono, color: "#818cf8", fontWeight: 700 }}>{s.symbol}</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.heading, color: "var(--text-primary)", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</td>
              <td style={{ padding: "8px 12px" }}><span style={{ fontSize: 9.5, fontFamily: fonts.mono, color: secColor(s.sector), background: `${secColor(s.sector)}18`, padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>{s.sector}</span></td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, color: "var(--text-primary)", textAlign: "right" }}>{s.pe.toFixed(1)}</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, color: "#4ade80", textAlign: "right", fontWeight: 600 }}>{(s.earningsYield * 100).toFixed(2)}%</td>
              <td style={{ padding: "8px 12px", fontSize: 11.5, fontFamily: fonts.mono, color: "#a78bfa", textAlign: "right", fontWeight: 600 }}>{(s.roic * 100).toFixed(1)}%</td>
              <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-secondary)", textAlign: "right" }}>{fmtMc(s.mktCap)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <InfoBox color="#818cf8">
      <strong style={{ color: "var(--text-primary)" }}>How to read this page.</strong>
      &nbsp;The <strong>valuation map</strong> plots every S&amp;P name: with earnings yield on Y and ROIC on X, the top-right corner is the fundamentalist&apos;s hunting ground — businesses that are both cheap and high-quality. Names above the amber 10Y line out-earn a treasury on current earnings.
      &nbsp;<strong>Magic Formula</strong> ranks the index by combined earnings-yield + ROIC rank (Greenblatt&apos;s method) — a starting screen, not a buy list: cheapness sometimes signals real trouble, so click through and check the fundamentals.
      &nbsp;Valuations are TTM from the screener cache (refreshes every 6 hours).
    </InfoBox>
  </>);
}

export default SP500Overview;
