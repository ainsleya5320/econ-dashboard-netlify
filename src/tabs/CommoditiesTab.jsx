import React, { useState, useEffect, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, BarChart, Bar, ReferenceLine, Cell } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { fmtDate, SH, InfoBox } from "../components/shared.jsx";
import CftcSubTab from "./CftcSubTab.jsx";
import CommodityPulseTab from "./CommodityPulseTab.jsx";

const COMM_SUB_TABS = [
  { id: "pulse",  label: "Pulse" },
  { id: "prices", label: "Prices" },
  { id: "cftc",   label: "CFTC Positioning" },
];

const RANGE_OPTIONS = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "5Y", days: 365 * 5 },
  { label: "MAX", days: 0 },
];

const GROUP_META = {
  metals:      { label: "Precious Metals",    color: "#F59E0B", desc: "Inflation hedge & safe-haven demand" },
  energy:      { label: "Energy",             color: "#E8553A", desc: "Crude oil (WTI/Brent) and natural gas" },
  industrial:  { label: "Industrial Metals",  color: "#F97316", desc: "\"Dr. Copper\" — construction & electronics demand" },
  agriculture: { label: "Grains & Fiber",     color: "#10B981", desc: "Corn, wheat, soybeans, cotton" },
  softs:       { label: "Softs",              color: "#B45309", desc: "Coffee, cocoa, sugar — weather & geopolitics driven" },
};

/* Compact spot tile with sparkline */
function SpotTile({ c, hist, onClick, selected }) {
  const up = c.change > 0;
  const chgColor = c.change == null ? "var(--text-muted)" : up ? "#4ade80" : "#f87171";
  const accent = up ? "#10B981" : c.change < 0 ? "#EF4444" : "#64748b";

  // Mini sparkline (last 60 weekly points)
  const spark = (hist?.history || []).slice(-60);
  let sparkPath = "";
  if (spark.length > 1) {
    const vals = spark.map(h => h.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const W = 100, H = 26;
    sparkPath = spark.map((p, i) => {
      const x = (i / (spark.length - 1)) * W;
      const y = H - ((p.v - min) / range) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  }

  const fmtPrice = (p) => {
    if (p == null) return "—";
    if (p < 10) return p.toFixed(3);
    if (p < 100) return p.toFixed(2);
    if (p < 1000) return p.toFixed(2);
    return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? "rgba(99,102,241,0.08)" : cardBg,
        border: selected ? "1px solid #6366F1" : cardBorder,
        borderRadius: 14, padding: "14px 16px",
        position: "relative", overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.2s",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: "14px 14px 0 0" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 16 }}>{c.icon}</span>
          <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{c.name}</span>
        </div>
        {c.changePct != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: chgColor, fontFamily: fonts.mono }}>
            {c.changePct > 0 ? "+" : ""}{(c.changePct * 100).toFixed(2)}%
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>
          {c.unit.startsWith("¢") ? "" : c.unit === "$/mt" ? "$" : "$"}{fmtPrice(c.price)}
        </div>
        {sparkPath && (
          <svg width="100" height="26" style={{ marginLeft: 4, flexShrink: 0 }}>
            <path d={sparkPath} fill="none" stroke={c.color || accent} strokeWidth="1.5" strokeLinejoin="round" opacity="0.85" />
          </svg>
        )}
      </div>
      <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 3, fontFamily: fonts.mono }}>
        {c.unit}
        {c.change != null && <span> · {c.change > 0 ? "+" : ""}{c.change.toFixed(2)} day</span>}
      </div>
    </div>
  );
}

/* Range toggle */
function RangeToggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, background: "var(--bg-subtle)", borderRadius: 8, padding: 3, width: "fit-content" }}>
      {RANGE_OPTIONS.map(o => (
        <button key={o.label} onClick={() => onChange(o.label)} style={{
          padding: "5px 12px", border: "none", borderRadius: 6,
          background: value === o.label ? "var(--tab-active-bg)" : "transparent",
          color: value === o.label ? "var(--tab-active-color)" : "var(--tab-inactive-color)",
          fontSize: 10, fontWeight: value === o.label ? 600 : 400,
          fontFamily: fonts.mono, cursor: "pointer", transition: "all 0.2s",
        }}>{o.label}</button>
      ))}
    </div>
  );
}

/* Performance heatmap: how each commodity has moved over the chosen period */
function PerfHeatmap({ spots, histories, range }) {
  const rangeDays = RANGE_OPTIONS.find(o => o.label === range)?.days || 0;
  const rows = spots.map(s => {
    const h = histories?.find(x => x.symbol === s.symbol);
    if (!h?.history?.length) return { ...s, perf: null };
    const cutoff = rangeDays > 0
      ? new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : "1900-01-01";
    const slice = h.history.filter(p => p.d >= cutoff);
    if (slice.length < 2) return { ...s, perf: null };
    const first = slice[0].v;
    const last = slice[slice.length - 1].v;
    return { ...s, perf: ((last - first) / first) * 100 };
  }).filter(r => r.perf != null).sort((a, b) => b.perf - a.perf);

  const maxAbs = Math.max(...rows.map(r => Math.abs(r.perf)), 0.1);

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>
          {range} Performance — Ranked
        </div>
        <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono }}>
          {rows.length} commodities
        </div>
      </div>
      {rows.map(r => {
        const pct = Math.abs(r.perf) / maxAbs;
        const isNeg = r.perf < 0;
        return (
          <div key={r.symbol} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <div style={{ width: 110, fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", flexShrink: 0 }}>
              {r.icon} {r.name}
            </div>
            <div style={{ flex: 1, height: 18, background: "rgba(255,255,255,0.04)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", top: 0, bottom: 0,
                [isNeg ? "right" : "left"]: "50%",
                width: `${pct * 50}%`,
                background: isNeg ? "#EF4444" : "#4ade80",
                borderRadius: 4, opacity: 0.85, transition: "width 0.5s",
              }} />
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.15)" }} />
            </div>
            <div style={{ width: 70, fontSize: 11, fontWeight: 600, color: isNeg ? "#f87171" : "#4ade80", fontFamily: fonts.mono, textAlign: "right", flexShrink: 0 }}>
              {r.perf > 0 ? "+" : ""}{r.perf.toFixed(1)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Single-commodity detail chart */
function DetailChart({ symbol, name, color, history, range }) {
  const rangeDays = RANGE_OPTIONS.find(o => o.label === range)?.days || 0;
  const cutoff = rangeDays > 0
    ? new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : "1900-01-01";
  const data = (history || []).filter(p => p.d >= cutoff);
  if (!data.length) {
    return (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "30px 20px", textAlign: "center", color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 11 }}>
        No history available for {name}
      </div>
    );
  }

  const vals = data.map(d => d.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const first = data[0].v;
  const last = data[data.length - 1].v;
  const changePct = ((last - first) / first) * 100;

  const tickInt = Math.max(0, Math.floor(data.length / 8) - 1);
  const fmtAxisDate = (d) => { const p = d.split("-"); const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1]-1]; return `${mn} ${p[0].slice(2)}`; };

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "14px 14px 0 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, paddingLeft: 12, paddingRight: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>
            {name}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 2 }}>
            Range: {min.toFixed(2)} – {max.toFixed(2)} · Last: {fmtDate(data[data.length - 1].d)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>
            {last.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: changePct > 0 ? "#4ade80" : "#f87171", fontFamily: fonts.mono }}>
            {changePct > 0 ? "+" : ""}{changePct.toFixed(2)}% over {range}
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 5, right: 12, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id={`det-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={tickInt} tickFormatter={fmtAxisDate} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }}
            labelFormatter={fmtDate}
            formatter={(v) => [v.toLocaleString(undefined, { maximumFractionDigits: 2 }), name]}
          />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#det-${symbol})`} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* Group comparison: normalize to 100 at start of range, overlay all in group */
function GroupCompareChart({ group, spots, histories, range }) {
  const meta = GROUP_META[group];
  const members = spots.filter(s => s.group === group);
  if (!members.length) return null;

  const rangeDays = RANGE_OPTIONS.find(o => o.label === range)?.days || 0;
  const cutoff = rangeDays > 0
    ? new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : "1900-01-01";

  // For each member, get indexed history
  const memberData = members.map(m => {
    const h = histories?.find(x => x.symbol === m.symbol);
    if (!h?.history?.length) return null;
    const slice = h.history.filter(p => p.d >= cutoff);
    if (slice.length < 2) return null;
    const base = slice[0].v;
    return { symbol: m.symbol, name: m.name, color: m.color, indexed: slice.map(p => ({ d: p.d, v: (p.v / base) * 100 })) };
  }).filter(Boolean);

  if (!memberData.length) return null;

  // Merge all into a single dataset by date
  const dateMap = {};
  for (const m of memberData) {
    for (const p of m.indexed) {
      if (!dateMap[p.d]) dateMap[p.d] = { d: p.d };
      dateMap[p.d][m.symbol] = p.v;
    }
  }
  const merged = Object.values(dateMap).sort((a, b) => a.d.localeCompare(b.d));
  const tickInt = Math.max(0, Math.floor(merged.length / 8) - 1);
  const fmtAxisDate = (d) => { const p = d.split("-"); const mn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1]-1]; return `${mn} ${p[0].slice(2)}`; };

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>
        {meta.label} — Relative Performance (indexed to 100 at start)
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={merged} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>
            {memberData.map(m => (
              <linearGradient key={m.symbol} id={`g-${m.symbol.replace(/=/g, "_")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={m.color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={m.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <XAxis dataKey="d" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} interval={tickInt} tickFormatter={fmtAxisDate} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={v => v.toFixed(0)} />
          <Tooltip
            contentStyle={{ background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }}
            labelFormatter={fmtDate}
            formatter={(v, n) => [v.toFixed(1), n]}
          />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7} />
          <ReferenceLine y={100} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
          {memberData.map(m => (
            <Area key={m.symbol} type="monotone" dataKey={m.symbol} name={m.name} stroke={m.color} strokeWidth={1.8} fill={`url(#g-${m.symbol.replace(/=/g, "_")})`} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */
export default function CommoditiesTab() {
  const [commSubTab, setCommSubTab] = useState("pulse");
  const [spots, setSpots] = useState([]);
  const [histories, setHistories] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("1Y");
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadSpot = () => {
    return fetch("/api/commodity-spot")
      .then(r => r.json())
      .then(d => { setSpots(Array.isArray(d) ? d : []); setLastUpdated(Date.now()); })
      .catch(e => console.error("Commodity spot error:", e));
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadSpot(),
      fetch("/api/metal-history").then(r => r.json()).then(setHistories).catch(e => console.error("Metal history error:", e)),
    ]).finally(() => setLoading(false));
    const interval = setInterval(loadSpot, 5 * 60 * 1000); // refresh spot every 5 min
    return () => clearInterval(interval);
  }, []);

  // Group spots for organized display
  const groups = useMemo(() => {
    const g = {};
    for (const s of spots) {
      if (!g[s.group]) g[s.group] = [];
      g[s.group].push(s);
    }
    return g;
  }, [spots]);

  // Auto-select first commodity once loaded
  useEffect(() => {
    if (!selectedSymbol && spots.length) setSelectedSymbol(spots[0].symbol);
  }, [spots, selectedSymbol]);

  const selected = spots.find(s => s.symbol === selectedSymbol);
  const selectedHist = histories?.find(h => h.symbol === selectedSymbol);

  const successRate = spots.length ? `${spots.filter(s => s.price != null).length}/${spots.length}` : "—";

  return (
    <>
      {/* Subtab bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: "var(--bg-subtle)", borderRadius: 10, padding: 3, marginBottom: 18 }}>
        {COMM_SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setCommSubTab(t.id)} style={{
            padding: "7px 18px", border: "none", borderRadius: 8, cursor: "pointer",
            background: commSubTab === t.id ? "var(--tab-active-bg)" : "transparent",
            color: commSubTab === t.id ? "var(--tab-active-color)" : "var(--tab-inactive-color)",
            fontSize: 12, fontWeight: commSubTab === t.id ? 600 : 400,
            fontFamily: fonts.heading, transition: "all 0.2s",
            borderBottom: commSubTab === t.id ? "2px solid var(--accent, #6366f1)" : "2px solid transparent",
          }}>{t.label}</button>
        ))}
      </div>

      {commSubTab === "pulse" && <CommodityPulseTab />}
      {commSubTab === "cftc" && <CftcSubTab />}

      {commSubTab === "prices" && <>
        {/* Header row: status + range */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono }}>
              Data: <span style={{ color: "#4ade80" }}>Yahoo Finance futures</span> · {successRate} live · {lastUpdated ? `updated ${new Date(lastUpdated).toLocaleTimeString()}` : "loading..."}
            </span>
            <button onClick={loadSpot} style={{
              fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)",
              background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontFamily: fonts.mono,
            }}>↻ Refresh</button>
          </div>
          <RangeToggle value={range} onChange={setRange} />
        </div>

        {loading && !spots.length && (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 12 }}>
            Loading commodity data...
          </div>
        )}

        {!!spots.length && (
          <>
            {/* Performance heatmap */}
            <PerfHeatmap spots={spots} histories={histories} range={range} />

            {/* Detail chart for selected commodity */}
            {selected && (
              <DetailChart
                symbol={selected.symbol}
                name={selected.name}
                color={selected.color}
                history={selectedHist?.history}
                range={range}
              />
            )}

            {/* Group-by-group sections */}
            {Object.entries(GROUP_META).map(([groupKey, meta]) => {
              const members = groups[groupKey] || [];
              if (!members.length) return null;
              return (
                <div key={groupKey} style={{ marginBottom: 20 }}>
                  <SH>{meta.label}</SH>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: -8, marginBottom: 10 }}>
                    {meta.desc}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
                    {members.map(c => (
                      <SpotTile
                        key={c.symbol}
                        c={c}
                        hist={histories?.find(h => h.symbol === c.symbol)}
                        onClick={() => setSelectedSymbol(c.symbol)}
                        selected={selectedSymbol === c.symbol}
                      />
                    ))}
                  </div>
                  {members.length > 1 && (
                    <GroupCompareChart group={groupKey} spots={spots} histories={histories} range={range} />
                  )}
                </div>
              );
            })}

            <InfoBox color="#F59E0B">
              <strong style={{ color: "var(--text-primary)" }}>Data source:</strong> All commodities are live futures contracts from Yahoo Finance (CME/COMEX/ICE). Prices update every ~15 minutes during market hours. Click any tile to see its full chart. Historical data goes back 10 years at weekly resolution.
            </InfoBox>
          </>
        )}
      </>}
    </>
  );
}
