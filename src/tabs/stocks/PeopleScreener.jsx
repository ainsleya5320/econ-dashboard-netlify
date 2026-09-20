import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { InfoBox } from "../../components/shared.jsx";

// ============================================================================
// PEOPLE SCREENER — the S&P 500 by revenue per employee
// Data: /api/people-screener (FMP 10-K headcounts + fiscal-year income
// statements, joined to the S&P feed for market cap and sector; refreshed
// monthly on the server, zero model tokens). This file is display only:
// sector medians, a log-log scatter of revenue/employee vs market cap/employee,
// and a sortable table with operating leverage (revenue growth − headcount
// growth). Click any name to open the stock detail.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569";
const SECTOR_COLORS = {
  Technology: "#818cf8", "Communication Services": "#a78bfa", "Consumer Cyclical": "#f472b6", "Consumer Defensive": "#fb923c", Healthcare: "#34d399",
  "Financial Services": "#22d3ee", Industrials: "#fbbf24", Energy: "#f87171", "Basic Materials": "#a3e635", "Real Estate": "#2dd4bf", Utilities: "#94a3b8", Unknown: "#64748b",
};
const fin = v => v != null && isFinite(v);
const perEmp = v => (!fin(v) ? "—" : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(0)}K`);
const big = v => (!fin(v) ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : `$${(v / 1e6).toFixed(0)}M`);
const people = v => (!fin(v) ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v));
const pct = (v, dp = 0) => (fin(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%` : "—");
const median = xs => { const a = xs.filter(fin).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px" };
const sel = { padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(129,140,248,0.35)", background: "rgba(129,140,248,0.1)", color: "#c7d2fe", fontSize: 11, fontFamily: fonts.mono, cursor: "pointer" };

const COLS = [
  { key: "symbol", label: "Ticker", align: "left" }, { key: "name", label: "Company", align: "left" }, { key: "sector", label: "Sector", align: "left" },
  { key: "employees", label: "Employees", fmt: people }, { key: "revenue", label: "Revenue (FY)", fmt: big },
  { key: "revPerEmp", label: "Rev / Emp", fmt: perEmp, strong: true }, { key: "vsSector", label: "vs Sector", fmt: v => (fin(v) ? `${v.toFixed(1)}×` : "—"), tone: v => (v >= 1.5 ? GREEN : v < 0.6 ? RED : SLATE) },
  { key: "opIncPerEmp", label: "Op Inc / Emp", fmt: perEmp, tone: v => (v < 0 ? RED : SLATE) }, { key: "mktCapPerEmp", label: "Mkt Cap / Emp", fmt: perEmp },
  { key: "empGrowth", label: "Staff YoY", fmt: v => pct(v, 1), tone: v => (v > 10 ? AMBER : v < -5 ? RED : SLATE) }, { key: "revGrowth", label: "Rev YoY", fmt: v => pct(v, 1), tone: v => (v < 0 ? RED : v > 15 ? GREEN : SLATE) },
  { key: "leverage", label: "Leverage", fmt: v => pct(v, 1), tone: v => (v > 10 ? GREEN : v < -5 ? RED : SLATE) }, { key: "fy", label: "FY", align: "left" },
];

function PeopleScreener({ onSelectStock }) {
  const [d, setD] = useState(null);
  const [sector, setSector] = useState("All");
  const [minCap, setMinCap] = useState(0);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "revPerEmp", asc: false });
  useEffect(() => {
    let alive = true, timer;
    const load = () => fetch("/api/people-screener").then(r => r.json()).then(x => { if (!alive || !x || x.error) return; setD(x); if (x.building || !x.ready) timer = setTimeout(load, 8000); }).catch(() => { if (alive) timer = setTimeout(load, 15000); });
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const rows = useMemo(() => {
    const all = d?.rows || [];
    const bySector = {};
    for (const r of all) (bySector[r.sector] = bySector[r.sector] || []).push(r.revPerEmp);
    const med = Object.fromEntries(Object.entries(bySector).map(([s, xs]) => [s, median(xs)]));
    return all.map(r => ({ ...r, vsSector: med[r.sector] ? r.revPerEmp / med[r.sector] : null, leverage: fin(r.revGrowth) && fin(r.empGrowth) ? +(r.revGrowth - r.empGrowth).toFixed(1) : null, color: SECTOR_COLORS[r.sector] || SECTOR_COLORS.Unknown }));
  }, [d]);
  const sectors = useMemo(() => [...new Set(rows.map(r => r.sector))].sort(), [rows]);
  const sectorMedians = useMemo(() => sectors.map(s => { const xs = rows.filter(r => r.sector === s); return { sector: s, n: xs.length, revPerEmp: median(xs.map(r => r.revPerEmp)), mktCapPerEmp: median(xs.map(r => r.mktCapPerEmp)), color: SECTOR_COLORS[s] || SECTOR_COLORS.Unknown }; }).sort((a, b) => b.revPerEmp - a.revPerEmp), [rows, sectors]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = rows.filter(r => (sector === "All" || r.sector === sector) && (!minCap || (r.mktCap || 0) >= minCap) && (!needle || r.symbol.toLowerCase().includes(needle) || (r.name || "").toLowerCase().includes(needle)));
    const k = sort.key, dir = sort.asc ? 1 : -1;
    return [...f].sort((a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir; });
  }, [rows, sector, minCap, q, sort]);
  const spMedian = median(rows.map(r => r.revPerEmp));
  const top = rows.length ? [...rows].sort((a, b) => b.revPerEmp - a.revPerEmp)[0] : null;
  const bottom = rows.length ? [...rows].sort((a, b) => a.revPerEmp - b.revPerEmp)[0] : null;
  const lev = rows.filter(r => fin(r.leverage));
  const posLev = lev.length ? Math.round((lev.filter(r => r.leverage > 0).length / lev.length) * 100) : null;
  const clickSort = key => setSort(s => ({ key, asc: s.key === key ? !s.asc : ["symbol", "name", "sector", "fy"].includes(key) }));

  if (!d) return <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading the people screener…</div>;
  if (!d.ready) return (
    <div style={{ ...card, textAlign: "center", padding: 30 }}>
      <div style={{ fontSize: 13, color: "#cbd5e1", fontFamily: fonts.heading, fontWeight: 600 }}>Building the dataset — two FMP calls per company, about five minutes the first time</div>
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: fonts.mono, marginTop: 6 }}>{d.progress ? `progress ${d.progress}` : "starting"} · this page refreshes itself · afterwards it is cached for a month</div>
    </div>
  );

  const scatterData = filtered.filter(r => fin(r.revPerEmp) && fin(r.mktCapPerEmp) && r.revPerEmp > 0 && r.mktCapPerEmp > 0);
  const ScatterTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const r = payload[0].payload;
    return (
      <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 10px", fontSize: 11, fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{r.symbol} · {r.name}</div>
        <div style={{ color: r.color }}>{r.sector}</div>
        <div>rev / employee {perEmp(r.revPerEmp)} · mkt cap / employee {perEmp(r.mktCapPerEmp)}</div>
        <div>{people(r.employees)} employees · revenue {big(r.revenue)} · staff {pct(r.empGrowth, 1)} · revenue {pct(r.revGrowth, 1)}</div>
      </div>
    );
  };

  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10, marginBottom: 12 }}>
      {[
        ["S&P 500 median", perEmp(spMedian), `revenue per employee · ${d.coverage} companies covered`],
        ["Most productive", top ? `${top.symbol} ${perEmp(top.revPerEmp)}` : "—", top ? `${people(top.employees)} employees · ${top.sector}` : ""],
        ["Least productive", bottom ? `${bottom.symbol} ${perEmp(bottom.revPerEmp)}` : "—", bottom ? `${people(bottom.employees)} employees · ${bottom.sector}` : ""],
        ["Positive operating leverage", posLev != null ? `${posLev}%` : "—", "share growing revenue faster than headcount (latest FY)"],
      ].map(([t, v, s]) => (
        <div key={t} style={{ ...card, padding: "10px 14px" }}>
          <div style={label}>{t}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.4, marginTop: 3 }}>{v}</div>
          <div style={{ fontSize: 9.5, color: DIM, fontFamily: fonts.mono, marginTop: 2 }}>{s}</div>
        </div>
      ))}
    </div>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
      <select value={sector} onChange={e => setSector(e.target.value)} style={sel}><option value="All" style={{ background: "#0f172a" }}>All sectors</option>{sectors.map(s => <option key={s} value={s} style={{ background: "#0f172a" }}>{s}</option>)}</select>
      <select value={minCap} onChange={e => setMinCap(+e.target.value)} style={sel}>{[[0, "Any market cap"], [1e10, "≥ $10B"], [5e10, "≥ $50B"], [1e11, "≥ $100B"], [5e11, "≥ $500B"]].map(([v, t]) => <option key={v} value={v} style={{ background: "#0f172a" }}>{t}</option>)}</select>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="ticker or name" style={{ ...sel, cursor: "text", width: 160, background: "rgba(255,255,255,0.04)", color: "#e2e8f0" }} />
      <span style={{ fontSize: 10, color: DIM, fontFamily: fonts.mono }}>{filtered.length} companies · click a header to sort, a row to open · FY headcount and revenue from each 10-K (* = headcount from the company profile where the 10-K feed had no usable print) · refreshed {d.asOf ? new Date(d.asOf).toLocaleDateString() : "—"}{d.building ? ` · updating ${d.progress}` : ""}</span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <div style={{ ...card, padding: "12px 10px 6px" }}>
        <div style={{ ...label, paddingLeft: 6 }}>Revenue per employee vs market cap per employee · log scales · color = sector</div>
        <ResponsiveContainer width="100%" height={340}>
          <ScatterChart margin={{ top: 12, right: 16, bottom: 8, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" dataKey="revPerEmp" scale="log" domain={["auto", "auto"]} tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={perEmp} axisLine={false} tickLine={false} name="Rev / employee" />
            <YAxis type="number" dataKey="mktCapPerEmp" scale="log" domain={["auto", "auto"]} tick={{ fontSize: 9.5, fill: "#64748b", fontFamily: fonts.mono }} tickFormatter={perEmp} axisLine={false} tickLine={false} width={58} name="Mkt cap / employee" />
            <ZAxis range={[28, 28]} />
            <Tooltip content={<ScatterTip />} cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.2)" }} />
            <Scatter data={scatterData} isAnimationActive={false} onClick={p => p?.symbol && onSelectStock?.(p.symbol)} shape={props => <circle cx={props.cx} cy={props.cy} r={4.2} fill={props.payload.color} fillOpacity={0.8} stroke="#0f172a" strokeWidth={0.6} style={{ cursor: "pointer" }} />} />
          </ScatterChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: DIM, fontFamily: fonts.mono, padding: "2px 6px 4px", lineHeight: 1.5 }}>Up and to the right is the money-printing corner: few people, lots of revenue, and a market that pays for it. A name far above the cloud at its revenue level is being valued for growth or margin, not for today&apos;s sales per head; far below it, the market doubts the revenue is worth much.</div>
      </div>
      <div style={card}>
        <div style={label}>Sector medians · revenue per employee</div>
        <div style={{ marginTop: 8 }}>
          {sectorMedians.map(s => (
            <div key={s.sector} onClick={() => setSector(sector === s.sector ? "All" : s.sector)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", opacity: sector === "All" || sector === s.sector ? 1 : 0.4 }}>
              <span style={{ width: 128, fontSize: 10, color: "#cbd5e1", fontFamily: fonts.mono, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.sector}</span>
              <div style={{ flex: 1, height: 7, background: "rgba(255,255,255,0.05)", borderRadius: 4 }}><div style={{ width: `${Math.min(100, (s.revPerEmp / (sectorMedians[0]?.revPerEmp || 1)) * 100)}%`, height: "100%", background: s.color, borderRadius: 4, opacity: 0.85 }} /></div>
              <span style={{ width: 54, textAlign: "right", fontSize: 10.5, fontWeight: 700, fontFamily: fonts.mono, color: "var(--text-primary)" }}>{perEmp(s.revPerEmp)}</span>
              <span style={{ width: 26, textAlign: "right", fontSize: 9, fontFamily: fonts.mono, color: DIM }}>{s.n}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 9.5, color: DIM, fontFamily: fonts.mono, marginTop: 8, lineHeight: 1.5 }}>Compare within a sector, not across: energy and financials book revenue through pass-through costs and interest, retail and restaurants through low-wage headcount. Click a sector to filter.</div>
      </div>
    </div>

    <div style={{ ...card, padding: "8px 10px", overflowX: "auto", marginBottom: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
        <thead><tr>{COLS.map(c => <th key={c.key} onClick={() => clickSort(c.key)} style={{ padding: "7px 8px", fontSize: 8.5, color: sort.key === c.key ? "#c7d2fe" : DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: c.align || "right", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>{c.label}{sort.key === c.key ? (sort.asc ? " ▲" : " ▼") : ""}</th>)}</tr></thead>
        <tbody>
          {filtered.map(r => (
            <tr key={r.symbol} onClick={() => onSelectStock?.(r.symbol)} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(129,140,248,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              {COLS.map(c => {
                const v = r[c.key];
                const color = c.key === "symbol" ? INDIGO : c.key === "sector" ? r.color : c.tone && fin(v) ? c.tone(v) : c.strong ? "var(--text-primary)" : "#cbd5e1";
                const fromProfile = c.key === "employees" && String(r.empSource || "").startsWith("profile");
                return <td key={c.key} title={fromProfile ? r.empSource : undefined} style={{ padding: "6px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: c.align || "right", color, fontWeight: c.strong || c.key === "symbol" ? 700 : 400, whiteSpace: "nowrap", maxWidth: c.key === "name" ? 220 : undefined, overflow: "hidden", textOverflow: "ellipsis" }}>{c.fmt ? c.fmt(v) : (v ?? "—")}{fromProfile && <span style={{ color: AMBER, marginLeft: 2 }}>*</span>}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>Reading it.</strong> Revenue per employee is a productivity and business-model number, not a quality number on its own: it flatters pass-through businesses (refiners, distributors, insurers, banks with interest income) and punishes labor-heavy ones (retail, restaurants, staffing), so the &quot;vs sector&quot; column is the honest comparison. The two columns worth a second look are <strong style={{ color: "#cbd5e1" }}>operating income per employee</strong> (what each head actually earns the owners) and <strong style={{ color: "#cbd5e1" }}>leverage</strong> — revenue growth minus headcount growth. Sustained positive leverage is the signature of a scalable model, and of the AI question everyone is asking: whether companies can grow without hiring. Headcounts come from each company&apos;s 10-K and include part-timers where the filer counts them; contractors and franchise staff are excluded, which is why franchisors look superhuman.
    </InfoBox>
  </>);
}

export default PeopleScreener;
