import React, { useState, useMemo, useEffect } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { fmtDate, fmtAxisDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";

function HousingSubTab({ hd, md, zillow, hideHealth = false }) {
  const [metroSort, setMetroSort] = useState("zhvi");
  const [metroSortAsc, setMetroSortAsc] = useState(false);
  const [metroView, setMetroView] = useState("table"); // table | chart

  const z = zillow || {};
  const zn = z.national || {};
  const metros = z.metros || [];

  // National ZHVI trend
  const zhviHistory = useMemo(() => {
    if (!zn.zhvi?.history?.length) return [];
    return zn.zhvi.history.map(h => ({ d: h.d, ZHVI: h.v }));
  }, [zn.zhvi]);

  // National ZORI trend
  const zoriHistory = useMemo(() => {
    if (!zn.zori?.history?.length) return [];
    return zn.zori.history.map(h => ({ d: h.d, ZORI: h.v }));
  }, [zn.zori]);

  // National inventory trend
  const inventoryHistory = useMemo(() => {
    if (!zn.inventory?.history?.length) return [];
    return zn.inventory.history.map(h => ({ d: h.d, Inventory: h.v }));
  }, [zn.inventory]);

  // National new listings trend
  const newListHistory = useMemo(() => {
    if (!zn.newListings?.history?.length) return [];
    return zn.newListings.history.map(h => ({ d: h.d, NewListings: h.v }));
  }, [zn.newListings]);

  // Combined inventory + new listings
  const supplyHistory = useMemo(() => {
    if (!zn.inventory?.history?.length) return [];
    const inv = zn.inventory.history;
    const nl = zn.newListings?.history || [];
    return inv.map(h => {
      const nlPoint = nl.find(n => n.d === h.d);
      const row = { d: h.d, Inventory: h.v };
      if (nlPoint) row.NewListings = nlPoint.v;
      return row;
    });
  }, [zn.inventory, zn.newListings]);

  // Construction from FRED
  const constructionData = useMemo(() => {
    const starts = hd?.HOUST?.history || [];
    return starts.map(h => {
      const r = { d: h.d, HOUST: h.v };
      const p = hd?.PERMIT?.history?.find(x => x.d === h.d);
      if (p) r.PERMIT = p.v;
      return r;
    });
  }, [hd]);

  // Sorted metros
  const sortedMetros = useMemo(() => {
    const arr = [...metros].filter(m => m.zhvi);
    arr.sort((a, b) => {
      let va = a[metroSort], vb = b[metroSort];
      if (va == null) va = metroSortAsc ? Infinity : -Infinity;
      if (vb == null) vb = metroSortAsc ? Infinity : -Infinity;
      return metroSortAsc ? va - vb : vb - va;
    });
    return arr;
  }, [metros, metroSort, metroSortAsc]);

  const toggleMetroSort = (col) => {
    if (metroSort === col) setMetroSortAsc(!metroSortAsc);
    else { setMetroSort(col); setMetroSortAsc(col === "name"); }
  };

  const fmtDollar = (v) => {
    if (v == null) return "—";
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    return `$${(v / 1000).toFixed(0)}K`;
  };
  const fmtRent = (v) => v == null ? "—" : `$${Math.round(v).toLocaleString()}`;
  const fmtPct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const fmtInv = (v) => {
    if (v == null) return "—";
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toLocaleString();
  };

  const sortArrow = (col) => metroSort === col ? (metroSortAsc ? " ▲" : " ▼") : "";

  const isLoading = !zillow;

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>🏠</div>
        <div style={{ fontSize: 13, color: "#94a3b8", fontFamily: fonts.mono }}>Loading Zillow housing data...</div>
        <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginTop: 6 }}>Fetching home values, rents, and inventory</div>
      </div>
    );
  }

  return (<>
    {/* Synthesis layer — derived gauges, verdict, breadth */}
    {!hideHealth && <HousingHealthPanel zn={zn} metros={metros} />}

    {/* National Overview Cards */}
    <SH>National Housing Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Typical Home Value" value={zn.zhvi?.current} color="#3B82F6" format="dollar" subtitle={zn.zhvi?.yoy != null ? `${zn.zhvi.yoy >= 0 ? "+" : ""}${zn.zhvi.yoy.toFixed(1)}% YoY` : "Zillow ZHVI"} date={zn.zhvi?.lastDate} />
      <RateCard label="Typical Monthly Rent" value={zn.zori?.current} color="#8B5CF6" format="plain" subtitle={zn.zori?.yoy != null ? `${zn.zori.yoy >= 0 ? "+" : ""}${zn.zori.yoy.toFixed(1)}% YoY` : "Zillow ZORI"} date={zn.zori?.lastDate} />
      <RateCard label="30-Year Mortgage" value={md?.MORTGAGE30US?.current} color="#F59E0B" subtitle="Fixed rate avg" date={md?.MORTGAGE30US?.lastDate} />
      <RateCard label="For-Sale Inventory" value={zn.inventory?.current} color="#10B981" format="plain" subtitle={zn.inventory?.yoy != null ? `${zn.inventory.yoy >= 0 ? "+" : ""}${zn.inventory.yoy.toFixed(1)}% YoY` : "Total listings"} date={zn.inventory?.lastDate} />
      <RateCard label="Housing Starts" value={hd?.HOUST?.current} color="#E8553A" format="thousands" subtitle="Thousands, SAAR" date={hd?.HOUST?.lastDate} small />
      <RateCard label="Months' Supply" value={hd?.MSACSR?.current} color="#D946EF" format="months" subtitle={hd?.MSACSR?.current < 4 ? "Tight market" : hd?.MSACSR?.current > 6 ? "Buyer's market" : "Balanced"} date={hd?.MSACSR?.lastDate} small />
    </div>

    <InfoBox color="#3B82F6">
      <strong style={{ color: "#cbd5e1" }}>Zillow Home Value Index (ZHVI)</strong> is a smoothed, seasonally adjusted measure of the typical home value across a given region. <strong style={{ color: "#cbd5e1" }}>ZORI</strong> tracks typical monthly rents. Both are considered more timely than Census or FHFA data.
    </InfoBox>

    {/* Home Value Trend */}
    {zhviHistory.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>
          National Home Value (Zillow ZHVI)
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={zhviHistory} margin={{ top: 5, right: 8, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="g-zhvi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={fmtAxisDate} interval={Math.max(0, Math.floor(zhviHistory.length / 8) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={fmtDate} formatter={v => [`$${Math.round(v).toLocaleString()}`, "Home Value"]} />
            <Area type="monotone" dataKey="ZHVI" stroke="#3B82F6" fill="url(#g-zhvi)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* Rent Trend */}
    {zoriHistory.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, paddingLeft: 12 }}>
          National Typical Rent (Zillow ZORI)
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={zoriHistory} margin={{ top: 5, right: 8, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="g-zori" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={fmtAxisDate} interval={Math.max(0, Math.floor(zoriHistory.length / 8) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v).toLocaleString()}`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={fmtDate} formatter={v => [`$${Math.round(v).toLocaleString()}/mo`, "Typical Rent"]} />
            <Area type="monotone" dataKey="ZORI" stroke="#8B5CF6" fill="url(#g-zori)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* Supply & Inventory */}
    <SH>Supply & Inventory</SH>
    {supplyHistory.length > 0 && (
      <ChartCard data={supplyHistory} series={{ Inventory: { label: "For-Sale Inventory", color: "#10B981" }, NewListings: { label: "New Listings", color: "#F59E0B" } }} title="National Inventory & New Listings" yFormatter={v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`} />
    )}

    <div style={{ height: 14 }} />
    <ChartCard data={(hd?.MSACSR?.history || []).map(h => ({ d: h.d, MSACSR: h.v }))} series={{ MSACSR: { label: "Months' Supply", color: "#D946EF" } }} title="Months' Supply of Homes (FRED)" yFormatter={v => `${v}`} refLine={6} />

    {/* Construction Activity */}
    <SH>Construction Activity</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Housing Starts" value={hd?.HOUST?.current} color="#10B981" format="thousands" subtitle="Thousands, SAAR" date={hd?.HOUST?.lastDate} small />
      <RateCard label="Building Permits" value={hd?.PERMIT?.current} color="#8B5CF6" format="thousands" subtitle="Thousands, SAAR" date={hd?.PERMIT?.lastDate} small />
      <RateCard label="Existing Sales" value={hd?.EXHOSLUSM495S?.current} color="#F59E0B" format="thousands" subtitle="Thousands, SAAR" date={hd?.EXHOSLUSM495S?.lastDate} small />
    </div>
    {constructionData.length > 0 && (
      <ChartCard data={constructionData} series={{ HOUST: { label: "Housing Starts", color: "#10B981" }, PERMIT: { label: "Building Permits", color: "#8B5CF6" } }} title="New Construction (Thousands, SAAR)" yFormatter={v => `${v}`} />
    )}

    <InfoBox color="#10B981">
      <strong style={{ color: "#cbd5e1" }}>Months' supply</strong> under 4 = seller's market; over 6 = buyer's market. <strong style={{ color: "#cbd5e1" }}>Starts</strong> and <strong style={{ color: "#cbd5e1" }}>permits</strong> are leading indicators of future supply.
    </InfoBox>

    {/* Replacement cost — Tobin's Q for housing */}
    <ReplacementCostPanel />

    {/* Top Metros Table */}
    {sortedMetros.length > 0 && (<>
      <SH>Top Metros Comparison</SH>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr style={{ background: "rgba(59,130,246,0.08)" }}>
                <th style={{ ...thStyle, width: 40, cursor: "default" }}>#</th>
                <th onClick={() => toggleMetroSort("name")} style={{ ...thStyle, textAlign: "left", cursor: "pointer" }}>Metro{sortArrow("name")}</th>
                <th onClick={() => toggleMetroSort("zhvi")} style={{ ...thStyle, cursor: "pointer" }}>Home Value{sortArrow("zhvi")}</th>
                <th onClick={() => toggleMetroSort("zhviYoy")} style={{ ...thStyle, cursor: "pointer" }}>1Y Change{sortArrow("zhviYoy")}</th>
                <th onClick={() => toggleMetroSort("zori")} style={{ ...thStyle, cursor: "pointer" }}>Monthly Rent{sortArrow("zori")}</th>
                <th onClick={() => toggleMetroSort("listPrice")} style={{ ...thStyle, cursor: "pointer" }}>List Price{sortArrow("listPrice")}</th>
                <th onClick={() => toggleMetroSort("inventory")} style={{ ...thStyle, cursor: "pointer" }}>Inventory{sortArrow("inventory")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedMetros.map((m, i) => (
                <tr key={m.name} style={{ borderBottom: i < sortedMetros.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ ...tdStyle, color: "#64748b", fontSize: 10 }}>{i + 1}</td>
                  <td style={{ ...tdStyle, textAlign: "left", fontWeight: 500, color: "#e2e8f0" }}>
                    <div style={{ fontSize: 12, fontFamily: fonts.heading }}>{m.name.split(",")[0]}</div>
                    <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>{m.state || m.name.split(",").slice(1).join(",").trim()}</div>
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: "#f1f5f9" }}>{fmtDollar(m.zhvi)}</td>
                  <td style={{ ...tdStyle, color: m.zhviYoy > 0 ? "#4ade80" : m.zhviYoy < 0 ? "#f87171" : "#94a3b8", fontWeight: 600 }}>{fmtPct(m.zhviYoy)}</td>
                  <td style={{ ...tdStyle, color: "#c4b5fd" }}>{fmtRent(m.zori)}</td>
                  <td style={{ ...tdStyle, color: "#cbd5e1" }}>{fmtDollar(m.listPrice)}</td>
                  <td style={{ ...tdStyle, color: "#94a3b8" }}>{fmtInv(m.inventory)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>)}
  </>);
}

const thStyle = {
  padding: "10px 12px", fontSize: 10, color: "#818cf8", fontFamily: fonts.mono,
  textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right", userSelect: "none",
};
const tdStyle = {
  padding: "8px 12px", fontSize: 12, fontFamily: fonts.mono, textAlign: "right",
};

// ─── Housing Health — the synthesis layer ────────────────────────────────────
// Four derived gauges instead of raw levels: affordability (payment share of
// income, 1984→, from /api/housing-health), supply (months' supply pctile),
// valuation (price-to-rebuild pctile), momentum (Zillow ZHVI YoY + metro
// breadth, computed here from the zillow prop the tab already holds).
function HousingHealthPanel({ zn, metros }) {
  const [hh, setHh] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/housing-health")
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setHh(d); })
      .catch(() => setError(true));
  }, []);

  // ── Client-side gauges from Zillow (only the client has this data) ──
  const zil = useMemo(() => {
    const zh = zn?.zhvi?.history || [], zo = zn?.zori?.history || [];
    // price-to-rent: ZHVI ÷ ZORI matched by month, indexed to first = 100
    const zoByM = Object.fromEntries(zo.map(p => [p.d.slice(0, 7), p.v]));
    const raw = zh.filter(p => zoByM[p.d.slice(0, 7)] > 0).map(p => ({ d: p.d, v: p.v / zoByM[p.d.slice(0, 7)] }));
    const p2r = raw.length ? raw.map(p => ({ d: p.d, v: +((p.v / raw[0].v) * 100).toFixed(1) })) : [];
    const p2rCur = p2r.length ? p2r[p2r.length - 1].v : null;
    const p2rYr = p2r.length > 12 ? p2r[p2r.length - 13].v : null;
    // metro breadth
    const withYoY = (metros || []).filter(m => m.zhviYoy != null);
    const posShare = withYoY.length ? Math.round((withYoY.filter(m => m.zhviYoy > 0).length / withYoY.length) * 100) : null;
    const byYoY = [...withYoY].sort((a, b) => b.zhviYoy - a.zhviYoy);
    const momYoY = zn?.zhvi?.yoy ?? null;
    const momLight = momYoY == null ? { color: "#64748b" } : momYoY >= 2 ? { color: "#4ade80" } : momYoY >= 0 ? { color: "#fbbf24" } : { color: "#ef4444" };
    return {
      p2r, p2rCur, p2rChg1y: (p2rCur != null && p2rYr != null) ? +(((p2rCur / p2rYr) - 1) * 100).toFixed(1) : null,
      zhviYoY: momYoY, zoriYoY: zn?.zori?.yoy ?? null,
      posShare, top: byYoY.slice(0, 3), bottom: byYoY.slice(-3).reverse(), nMetros: withYoY.length,
      momLight,
    };
  }, [zn, metros]);

  if (error || (!hh && !zil.p2r.length)) return null;

  const gauge = (name, light, big, sub) => (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", display: "flex", gap: 12, alignItems: "center" }}>
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: light?.color || "#64748b", boxShadow: `0 0 10px ${light?.color || "transparent"}55`, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{name}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, lineHeight: 1.2 }}>{big}</div>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono }}>{sub}</div>
      </div>
    </div>
  );

  return (<>
    <SH>Housing Health — Synthesis</SH>

    {/* Verdict hero */}
    {hh && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 12, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: hh.verdict.color }} />
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>U.S. Residential Real Estate</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: hh.verdict.color, fontFamily: fonts.heading, letterSpacing: -0.5 }}>{hh.verdict.label}</div>
        <div style={{ fontSize: 11.5, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6, maxWidth: 880, lineHeight: 1.55 }}>{hh.verdict.note}</div>
      </div>
    )}

    {/* Four-gauge dial */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(215px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      {hh && gauge("Affordability", hh.afford.light,
        `${hh.afford.current?.toFixed(1)}% of income`,
        `P&I on median home · p${hh.afford.pct} since ${hh.afford.since}`)}
      {hh && gauge("Supply (new homes)", hh.supply.light,
        `${hh.supply.current?.toFixed(1)} months`,
        `p${hh.supply.pct} of history — existing-home supply runs tighter`)}
      {hh && gauge("Valuation", hh.valuation.light,
        `${hh.valuation.ratio} vs rebuild`,
        `price ÷ construction cost · p${hh.valuation.pct} (100 = parity)`)}
      {gauge("Momentum", zil.momLight,
        zil.zhviYoY != null ? `${zil.zhviYoY >= 0 ? "+" : ""}${zil.zhviYoY.toFixed(1)}% YoY` : "—",
        zil.posShare != null ? `${zil.posShare}% of ${zil.nMetros} metros rising` : "national ZHVI")}
    </div>

    {/* Affordability history — the anchor chart */}
    {hh && hh.afford.series?.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={230}>
          <AreaChart data={hh.afford.series} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
            <defs>
              <linearGradient id="affordGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={hh.afford.light.color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={hh.afford.light.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={50} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(val, n, p) => [`${val}% of median income  ·  $${p?.payload?.pay?.toLocaleString?.() || "—"}/mo`, "Payment burden"]} labelFormatter={d => d.slice(0, 7)} />
            <Area type="monotone" dataKey="v" stroke={hh.afford.light.color} fill="url(#affordGrad)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 16, paddingBottom: 6, lineHeight: 1.55 }}>
          Mortgage payment as % of median household income — the cycle in one line: ~30% at the 2006 peak, ~21% at the 2012 trough, ~37% at the 2022 rate shock, <strong style={{ color: "#cbd5e1" }}>{hh.afford.current?.toFixed(1)}% today</strong> (median home ${Math.round((hh.afford.medianPrice || 0) / 1000)}K @ {hh.afford.rate}% → ${hh.afford.payment?.toLocaleString()}/mo; a buyer needs ~${Math.round((hh.afford.incomeNeeded || 0) / 1000)}K income at 28% DTI). Assumes 20% down, P&I only; income data through {hh.afford.incomeAsOf}, carried forward since.
        </div>
      </div>
    )}

    {/* Price-to-rent + metro breadth, side by side */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(330px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      {zil.p2r.length > 12 && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 14px 6px 4px" }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", paddingLeft: 14, marginBottom: 6 }}>
            Price-to-Rent (ZHVI ÷ ZORI, start = 100)
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={zil.p2r} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 7)} minTickGap={46} />
              <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={d => d.slice(0, 7)} formatter={v => [v, "Price ÷ rent (indexed)"]} />
              <Line type="monotone" dataKey="v" stroke="#8B5CF6" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "4px 0 6px 14px", lineHeight: 1.5 }}>
            {zil.p2rChg1y != null ? `${zil.p2rChg1y >= 0 ? "+" : ""}${zil.p2rChg1y}% over 12mo — ` : ""}prices {zil.zhviYoY != null ? `${zil.zhviYoY >= 0 ? "+" : ""}${zil.zhviYoY.toFixed(1)}%` : "—"} vs rents {zil.zoriYoY != null ? `${zil.zoriYoY >= 0 ? "+" : ""}${zil.zoriYoY.toFixed(1)}%` : "—"} YoY. Falling line = renting cheapens vs owning (or rents catching up) — better cap rates ahead for landlords, less urgency for buyers.
          </div>
        </div>
      )}
      {zil.posShare != null && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
            Metro Breadth — Who&apos;s Rising, Who&apos;s Falling
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1, height: 10, background: "rgba(248,113,113,0.25)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ width: `${zil.posShare}%`, height: "100%", background: "#4ade80", borderRadius: 5 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: zil.posShare >= 60 ? "#4ade80" : zil.posShare >= 40 ? "#fbbf24" : "#f87171", fontFamily: fonts.mono, flexShrink: 0 }}>{zil.posShare}% rising</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[["Hottest", zil.top, "#4ade80"], ["Coldest", zil.bottom, "#f87171"]].map(([lbl, list, col]) => (
              <div key={lbl}>
                <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>{lbl} (ZHVI YoY)</div>
                {list.map(m => (
                  <div key={m.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, fontFamily: fonts.mono, padding: "2px 0" }}>
                    <span style={{ color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(m.name || "").replace(/, [A-Z]{2}$/, "")}</span>
                    <span style={{ color: col, fontWeight: 700, flexShrink: 0 }}>{m.zhviYoy >= 0 ? "+" : ""}{m.zhviYoy.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9.5, color: "#475569", fontFamily: fonts.mono, marginTop: 10, lineHeight: 1.5 }}>
            Breadth below ~40% with a positive national number = the average is hiding a broadening correction. Above ~70% = broad-based strength.
          </div>
        </div>
      )}
    </div>

    <InfoBox color="#3B82F6">
      <strong style={{ color: "#cbd5e1" }}>Reading the dial together.</strong> Affordability is the demand side (can buyers pay?), months&apos; supply is the pressure gauge (note: it tracks <em>new</em> homes — existing-home supply runs structurally tighter), valuation vs rebuild cost is gravity (deep-dive panel below), and breadth tells you whether the national number is broad truth or a coastal average. The classic tops pair stretched affordability with loosening supply; the classic bottoms pair cheap payments with construction below replacement cost.
    </InfoBox>
  </>);
}

// ─── Replacement Cost — Tobin's Q for housing ────────────────────────────────
// Market price (Case-Shiller) vs cost-to-build (residential construction input
// PPI). Both start ~1986-87, so the ratio has ~40 years of honest percentiles.
// Data from /api/replacement-cost (FRED batch, server-cached).
function ReplacementCostPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/replacement-cost")
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setData(d); })
      .catch(() => setError(true));
  }, []);

  const yoyTile = (label, yoy, sub) => (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.heading, marginTop: 3, color: yoy == null ? "#64748b" : yoy > 5 ? "#f87171" : yoy > 2 ? "#fbbf24" : "#4ade80" }}>
        {yoy == null ? "—" : `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`}
      </div>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2 }}>{sub}</div>
    </div>
  );

  if (error) return null; // quiet fail — the rest of the housing tab stands alone
  if (!data) return <div style={{ padding: 20, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading replacement-cost data…</div>;

  const v = data.verdict;
  const t = data.tiles;

  return (<>
    <SH>Replacement Cost — Price vs Cost-to-Build</SH>

    {/* Verdict hero */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "18px 22px", marginBottom: 14, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: v.color }} />
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>U.S. Homes vs What They&apos;d Cost to Rebuild</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: v.color, fontFamily: fonts.heading, letterSpacing: -0.5 }}>{v.label}</span>
        <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono }}>
          ratio {v.ratio} (100 = long-run parity) · p{v.pct} since {data.ratioSince}{v.chg1y != null ? ` · ${v.chg1y >= 0 ? "+" : ""}${v.chg1y} over 12mo` : ""}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6, maxWidth: 860, lineHeight: 1.5 }}>
        {v.pct >= 60
          ? "Existing homes trade well above what building them would cost — fat homebuilder economics, and the gap historically closes via construction booms or price stagnation. Notably, the gap is currently closing from the cost side: construction inputs are inflating faster than prices."
          : v.pct <= 25
          ? "Homes trade near or below rebuild cost — new construction doesn't pencil, so supply stays constrained and the existing stock is cheap insurance. This was the 2011-2012 setup."
          : "Prices and rebuild costs are near their long-run relationship — neither a builder's bonanza nor a construction freeze."}
      </div>
    </div>

    {/* Ratio chart — the 40-year Tobin's Q */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data.ratio} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={50} />
          <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={val => [val, "Price ÷ build cost (100 = parity)"]} labelFormatter={d => d.slice(0, 7)} />
          <Line type="monotone" dataKey="v" stroke={v.color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 16, paddingBottom: 6, lineHeight: 1.5 }}>
        Case-Shiller ÷ residential construction-input PPI, scaled so the {data.ratioSince}–today average = 100. The 2006 peak (~132), the 2011 trough (~82, homes below rebuild cost), and the 2022 run are all visible — this ratio mean-reverts, slowly.
      </div>
    </div>

    {/* Cost pressure tiles */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 10, marginBottom: 14 }}>
      {yoyTile("Construction Inputs", t.constructionInputs?.yoy, "materials PPI, YoY")}
      {yoyTile("Construction Wages", t.wages?.yoy, t.wages?.cur ? `$${t.wages.cur.toFixed(2)}/hr avg` : "YoY")}
      {yoyTile("Lumber", t.lumber?.yoy, "PPI, YoY")}
      {yoyTile("New Home Median", t.newHomePrice?.yoy, t.newHomePrice?.cur ? `$${Math.round(t.newHomePrice.cur / 1000)}K` : "YoY")}
    </div>

    {/* Indexed price vs cost since 2006 */}
    {data.chart?.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.chart} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={50} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} labelFormatter={d => d.slice(0, 7)} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 6 }} iconType="circle" iconSize={7} />
            <Line type="monotone" dataKey="price" name="Home prices (Case-Shiller)" stroke="#3B82F6" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="cost" name="Construction materials" stroke="#E8553A" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="wage" name="Construction wages" stroke="#F59E0B" strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 16, paddingBottom: 6 }}>
          All indexed to 100 at {data.chartBase}. When the blue line pulls away from the cost lines, the rebuild gap widens.
        </div>
      </div>
    )}

    <InfoBox color="#22d3ee">
      <strong style={{ color: "#cbd5e1" }}>How to use replacement cost.</strong> It&apos;s the housing market&apos;s gravity: prices far above rebuild cost invite a construction supply response (good for builders — ITB/XHB, DHI, LEN — until it isn&apos;t); prices below rebuild cost freeze construction and make the existing stock scarce (the 2011 bottom signal). Caveats: the cost side here is <em>materials</em> PPI — it excludes land, which is exactly why coastal metros sustain price-to-rebuild premiums indefinitely; use this as a national cycle gauge, not a metro-level appraisal.
    </InfoBox>
  </>);
}

export { HousingHealthPanel };
export default HousingSubTab;
