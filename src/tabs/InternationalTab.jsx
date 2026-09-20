import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Area, AreaChart, LineChart, Line, CartesianGrid, ReferenceLine, BarChart, Bar, Cell, LabelList } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { GLOBAL_RATE_SERIES } from "../lib/constants.js";
import { fetchFMP, fetchFred } from "../lib/api.js";
import { fmtDate, fmtAxisDate, RateCard, ChartCard, SH, InfoBox } from "../components/shared.jsx";
import WorldBankSubTab from "./intl/WorldBankSubTab.jsx";
import LiquiditySubTab from "./intl/LiquiditySubTab.jsx";
import IntlPulseTab from "./intl/IntlPulseTab.jsx";
import ForexFundamentals from "./intl/ForexTab.jsx";

const INTL_ETFS = [
  { symbol: "EFA",  label: "EAFE (Developed ex-US)", flag: "INTL", color: "#818cf8" },
  { symbol: "VWO",  label: "Emerging Markets",       flag: "🌏", color: "#f97316" },
  { symbol: "EWJ",  label: "Japan",                  flag: "🇯🇵", color: "#ec4899" },
  { symbol: "EWG",  label: "Germany",                flag: "🇩🇪", color: "#fbbf24" },
  { symbol: "EWU",  label: "United Kingdom",         flag: "🇬🇧", color: "#8b5cf6" },
  { symbol: "FXI",  label: "China",                  flag: "🇨🇳", color: "#ef4444" },
  { symbol: "INDA", label: "India",                  flag: "🇮🇳", color: "#f97316" },
  { symbol: "EWZ",  label: "Brazil",                 flag: "🇧🇷", color: "#22c55e" },
  { symbol: "EWY",  label: "South Korea",            flag: "🇰🇷", color: "#14b8a6" },
  { symbol: "EWA",  label: "Australia",              flag: "🇦🇺", color: "#6366f1" },
  { symbol: "EWC",  label: "Canada",                 flag: "🇨🇦", color: "#e11d48" },
  { symbol: "EWL",  label: "Switzerland",            flag: "🇨🇭", color: "#10b981" },
];

const FX_PAIRS = [
  { symbol: "EURUSD", label: "EUR/USD", flag: "🇪🇺", base: "Euro", color: "#3b82f6" },
  { symbol: "GBPUSD", label: "GBP/USD", flag: "🇬🇧", base: "British Pound", color: "#8b5cf6" },
  { symbol: "USDJPY", label: "USD/JPY", flag: "🇯🇵", base: "Japanese Yen", color: "#ec4899", invert: true },
  { symbol: "USDCHF", label: "USD/CHF", flag: "🇨🇭", base: "Swiss Franc", color: "#10b981", invert: true },
  { symbol: "AUDUSD", label: "AUD/USD", flag: "🇦🇺", base: "Australian Dollar", color: "#6366f1" },
  { symbol: "USDCAD", label: "USD/CAD", flag: "🇨🇦", base: "Canadian Dollar", color: "#e11d48", invert: true },
  { symbol: "NZDUSD", label: "NZD/USD", flag: "🇳🇿", base: "New Zealand Dollar", color: "#14b8a6" },
  { symbol: "USDCNY", label: "USD/CNY", flag: "🇨🇳", base: "Chinese Yuan", color: "#ef4444", invert: true },
  { symbol: "USDINR", label: "USD/INR", flag: "🇮🇳", base: "Indian Rupee", color: "#f97316", invert: true },
  { symbol: "USDBRL", label: "USD/BRL", flag: "🇧🇷", base: "Brazilian Real", color: "#22c55e", invert: true },
  { symbol: "USDMXN", label: "USD/MXN", flag: "🇲🇽", base: "Mexican Peso", color: "#d946ef", invert: true },
  { symbol: "USDKRW", label: "USD/KRW", flag: "🇰🇷", base: "South Korean Won", color: "#fbbf24", invert: true },
];

const INTL_SUB_TABS = [
  { id: "pulse",     label: "Pulse" },
  { id: "markets",   label: "Market Overview" },
  { id: "rates",     label: "Central Banks" },
  { id: "forex",     label: "Forex" },
  { id: "liquidity", label: "Liquidity & Debt" },
  { id: "gdp",       label: "GDP" },
  { id: "debt",      label: "Debt" },
  { id: "infl",      label: "Inflation" },
  { id: "demo",      label: "Demographics" },
];

// Central bank metadata — ids are 2-letter country codes matching /api/cb-rates
const CENTRAL_BANKS = [
  { id: "US", flag: "🇺🇸", country: "United States",  bank: "Federal Reserve",  color: "#E8553A" },
  { id: "EU", flag: "🇪🇺", country: "Euro Area",       bank: "ECB",              color: "#3B82F6" },
  { id: "GB", flag: "🇬🇧", country: "United Kingdom",  bank: "Bank of England",  color: "#8B5CF6" },
  { id: "JP", flag: "🇯🇵", country: "Japan",           bank: "Bank of Japan",    color: "#EC4899" },
  { id: "CA", flag: "🇨🇦", country: "Canada",          bank: "Bank of Canada",   color: "#F59E0B" },
  { id: "CH", flag: "🇨🇭", country: "Switzerland",     bank: "SNB",              color: "#10B981" },
  { id: "AU", flag: "🇦🇺", country: "Australia",       bank: "RBA",              color: "#6366F1" },
  { id: "KR", flag: "🇰🇷", country: "South Korea",     bank: "Bank of Korea",    color: "#14B8A6" },
  { id: "MX", flag: "🇲🇽", country: "Mexico",          bank: "Banxico",          color: "#D946EF" },
  { id: "BR", flag: "🇧🇷", country: "Brazil",          bank: "BCB",              color: "#F97316" },
];

/* ── Trade-Weighted Dollar Index series (FRED) ─────────────── */
const TWI_SERIES = [
  { id: "DTWEXBGS",   label: "Broad (26 currencies)", color: "#E8553A", shortLabel: "Broad" },
  { id: "DTWEXAFEGS", label: "Advanced Economies",    color: "#3B82F6", shortLabel: "Advanced" },
  { id: "DTWEXEMEGS", label: "Emerging Markets",       color: "#10B981", shortLabel: "Emerging" },
];

function InternationalTab({ fmpKey, fredKey, gd }) {
  const [intlSub, setIntlSub] = useState("pulse");
  const [quotes, setQuotes] = useState(null);
  const [history, setHistory] = useState(null);
  const [sortCol, setSortCol] = useState("ytd");
  const [sortAsc, setSortAsc] = useState(false);
  const [fxQuotes, setFxQuotes] = useState(null);
  const [fxHistory, setFxHistory] = useState(null);
  const [fxSortCol, setFxSortCol] = useState("dayChg");
  const [fxSortAsc, setFxSortAsc] = useState(false);
  const [twiData, setTwiData] = useState(null);
  const [twiRange, setTwiRange] = useState("1y"); // "ytd" | "1y" | "5y" | "max"
  const [twiError, setTwiError] = useState(false);
  const [twiLoading, setTwiLoading] = useState(false);
  const [cbRates, setCbRates] = useState(null);
  const [cbRatesLoading, setCbRatesLoading] = useState(false);
  const [cbRatesError, setCbRatesError] = useState(false);

  // Fetch central bank rates from /api/cb-rates (live data, replaces stale FRED OECD series)
  useEffect(() => {
    if (intlSub !== 'rates' || cbRates !== null || cbRatesLoading) return;
    setCbRatesLoading(true);
    setCbRatesError(false);
    fetch('/api/cb-rates')
      .then(r => r.json())
      .then(data => { setCbRates(data); setCbRatesLoading(false); })
      .catch(() => { setCbRatesLoading(false); setCbRatesError(true); });
  }, [intlSub, cbRates, cbRatesLoading]);

  // Fetch ETF quotes on mount
  useEffect(() => {
    if (!fmpKey) return;
    Promise.all(
      INTL_ETFS.map(e =>
        fetchFMP(`/quote?symbol=${e.symbol}`, fmpKey)
          .then(data => (Array.isArray(data) && data.length) ? data[0] : null)
          .catch(() => null)
      )
    ).then(results => {
      const map = {};
      results.forEach(d => { if (d?.symbol) map[d.symbol] = d; });
      if (Object.keys(map).length) setQuotes(map);
    });
  }, [fmpKey]);

  // Fetch YTD historical data for ETF performance chart
  useEffect(() => {
    if (!fmpKey) return;
    const ytdStart = `${new Date().getFullYear()}-01-01`;
    Promise.all(
      INTL_ETFS.map(e =>
        fetchFMP(`/historical-price-eod/light?symbol=${e.symbol}&from=${ytdStart}`, fmpKey)
          .then(data => ({ symbol: e.symbol, data: Array.isArray(data) ? data : [] }))
          .catch(() => ({ symbol: e.symbol, data: [] }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.symbol] = r.data; });
      setHistory(map);
    });
  }, [fmpKey]);

  // Fetch forex quotes when forex sub-tab first selected
  useEffect(() => {
    if (intlSub !== "forex" || fxQuotes || !fmpKey) return;
    Promise.all(
      FX_PAIRS.map(p =>
        fetchFMP(`/quote?symbol=${p.symbol}`, fmpKey)
          .then(data => (Array.isArray(data) && data.length) ? data[0] : null)
          .catch(() => null)
      )
    ).then(results => {
      const map = {};
      results.forEach(d => { if (d?.symbol) map[d.symbol] = d; });
      if (Object.keys(map).length) setFxQuotes(map);
    });
  }, [intlSub, fxQuotes, fmpKey]);

  // Fetch forex YTD history when forex sub-tab first selected
  useEffect(() => {
    if (intlSub !== "forex" || fxHistory || !fmpKey) return;
    const ytdStart = `${new Date().getFullYear()}-01-01`;
    Promise.all(
      FX_PAIRS.filter(p => !p.invert).map(p =>
        fetchFMP(`/historical-price-eod/light?symbol=${p.symbol}&from=${ytdStart}`, fmpKey)
          .then(data => ({ symbol: p.symbol, data: Array.isArray(data) ? data : [] }))
          .catch(() => ({ symbol: p.symbol, data: [] }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.symbol] = r.data; });
      setFxHistory(map);
    });
  }, [intlSub, fxHistory, fmpKey]);

  // Fetch Trade-Weighted Dollar Index when forex tab selected
  const fetchTwi = useCallback(async () => {
    if (!fredKey) return;
    setTwiLoading(true);
    setTwiError(false);
    try {
      // Stagger requests to avoid FRED rate limits (wait 500ms between each)
      const map = {};
      for (const s of TWI_SERIES) {
        try {
          const obs = await fetchFred(s.id, fredKey, 5200);
          map[s.id] = obs;
        } catch (e) {
          console.warn(`TWI fetch failed for ${s.id}:`, e.message);
          map[s.id] = [];
        }
        await new Promise(r => setTimeout(r, 500));
      }
      const hasData = TWI_SERIES.some(s => map[s.id].length > 0);
      if (hasData) {
        setTwiData(map);
      } else {
        setTwiError(true);
      }
    } catch {
      setTwiError(true);
    } finally {
      setTwiLoading(false);
    }
  }, [fredKey]);

  useEffect(() => {
    if (intlSub !== "forex" || twiData || !fredKey) return;
    fetchTwi();
  }, [intlSub, twiData, fredKey, fetchTwi]);

  // Build TWI chart data (merged by date, filtered by range)
  const twiChartData = useMemo(() => {
    if (!twiData) return [];
    const dateMap = {};
    TWI_SERIES.forEach(s => {
      (twiData[s.id] || []).forEach(pt => {
        if (!dateMap[pt.d]) dateMap[pt.d] = { date: pt.d };
        dateMap[pt.d][s.id] = pt.v;
      });
    });
    let all = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
    // Apply range filter
    const now = new Date();
    if (twiRange === "ytd") {
      const ytdStart = `${now.getFullYear()}-01-01`;
      all = all.filter(d => d.date >= ytdStart);
    } else if (twiRange === "1y") {
      const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
      all = all.filter(d => d.date >= oneYearAgo);
    } else if (twiRange === "5y") {
      const fiveYearAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
      all = all.filter(d => d.date >= fiveYearAgo);
    }
    return all;
  }, [twiData, twiRange]);

  // TWI snapshot values (latest, YTD change, 1Y change)
  const twiSnapshot = useMemo(() => {
    if (!twiData) return [];
    const ytdStart = `${new Date().getFullYear()}-01-01`;
    const oneYearAgo = new Date(new Date().getFullYear() - 1, new Date().getMonth(), new Date().getDate()).toISOString().slice(0, 10);
    return TWI_SERIES.map(s => {
      const obs = twiData[s.id] || [];
      if (!obs.length) return { ...s, latest: null, ytdChg: null, yrChg: null };
      const latest = obs[obs.length - 1];
      const ytdStart_ = obs.find(o => o.d >= ytdStart);
      const yrStart_ = obs.find(o => o.d >= oneYearAgo);
      return {
        ...s,
        latest: latest.v,
        latestDate: latest.d,
        ytdChg: ytdStart_ ? ((latest.v - ytdStart_.v) / ytdStart_.v) * 100 : null,
        yrChg: yrStart_ ? ((latest.v - yrStart_.v) / yrStart_.v) * 100 : null,
      };
    });
  }, [twiData]);

  // ETF YTD %
  const ytdPct = useMemo(() => {
    if (!history || !quotes) return {};
    const result = {};
    INTL_ETFS.forEach(e => {
      const hist = history[e.symbol];
      const q = quotes[e.symbol];
      if (!hist?.length || !q) return;
      const sorted = [...hist].sort((a, b) => a.date.localeCompare(b.date));
      const startPrice = sorted[0]?.price;
      if (startPrice && q.price) result[e.symbol] = ((q.price - startPrice) / startPrice) * 100;
    });
    return result;
  }, [history, quotes]);

  // ETF normalized YTD chart
  const chartData = useMemo(() => {
    if (!history) return [];
    const dateSet = new Set();
    INTL_ETFS.forEach(e => { (history[e.symbol] || []).forEach(d => dateSet.add(d.date)); });
    const dates = [...dateSet].sort();
    if (!dates.length) return [];
    const bases = {};
    INTL_ETFS.forEach(e => {
      const sorted = [...(history[e.symbol] || [])].sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length) bases[e.symbol] = sorted[0].price;
    });
    const priceLookup = {};
    INTL_ETFS.forEach(e => {
      priceLookup[e.symbol] = {};
      (history[e.symbol] || []).forEach(d => { priceLookup[e.symbol][d.date] = d.price; });
    });
    const lastPrice = {};
    return dates.map(date => {
      const row = { date };
      INTL_ETFS.forEach(e => {
        const p = priceLookup[e.symbol][date];
        if (p != null) lastPrice[e.symbol] = p;
        if (lastPrice[e.symbol] != null && bases[e.symbol]) row[e.symbol] = (lastPrice[e.symbol] / bases[e.symbol]) * 100;
      });
      return row;
    });
  }, [history]);

  // Forex YTD %
  const fxYtdPct = useMemo(() => {
    if (!fxHistory || !fxQuotes) return {};
    const result = {};
    FX_PAIRS.forEach(p => {
      const hist = fxHistory[p.symbol];
      const q = fxQuotes[p.symbol];
      if (!hist?.length || !q) return;
      const sorted = [...hist].sort((a, b) => a.date.localeCompare(b.date));
      const startPrice = sorted[0]?.price;
      if (startPrice && q.price) result[p.symbol] = ((q.price - startPrice) / startPrice) * 100;
    });
    return result;
  }, [fxHistory, fxQuotes]);

  // Forex chart data (major pairs rebased to 100)
  const fxChartData = useMemo(() => {
    if (!fxHistory) return [];
    const majors = FX_PAIRS.filter(p => !p.invert);
    const dateSet = new Set();
    majors.forEach(p => { (fxHistory[p.symbol] || []).forEach(d => dateSet.add(d.date)); });
    const dates = [...dateSet].sort();
    if (!dates.length) return [];
    const bases = {};
    majors.forEach(p => {
      const sorted = [...(fxHistory[p.symbol] || [])].sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length) bases[p.symbol] = sorted[0].price;
    });
    const priceLookup = {};
    majors.forEach(p => {
      priceLookup[p.symbol] = {};
      (fxHistory[p.symbol] || []).forEach(d => { priceLookup[p.symbol][d.date] = d.price; });
    });
    const lastPrice = {};
    return dates.map(date => {
      const row = { date };
      majors.forEach(p => {
        const pr = priceLookup[p.symbol][date];
        if (pr != null) lastPrice[p.symbol] = pr;
        if (lastPrice[p.symbol] != null && bases[p.symbol]) row[p.symbol] = (lastPrice[p.symbol] / bases[p.symbol]) * 100;
      });
      return row;
    });
  }, [fxHistory]);

  // ETF sortable table
  const tableRows = useMemo(() => {
    const rows = INTL_ETFS.map(e => ({
      ...e, price: quotes?.[e.symbol]?.price, dayChg: quotes?.[e.symbol]?.changePercentage,
      ytd: ytdPct[e.symbol] ?? null, yearHigh: quotes?.[e.symbol]?.yearHigh, yearLow: quotes?.[e.symbol]?.yearLow,
    }));
    rows.sort((a, b) => {
      let av, bv;
      if (sortCol === "region") { av = a.label; bv = b.label; return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av); }
      av = a[sortCol === "high" ? "yearHigh" : sortCol === "low" ? "yearLow" : sortCol] ?? -Infinity;
      bv = b[sortCol === "high" ? "yearHigh" : sortCol === "low" ? "yearLow" : sortCol] ?? -Infinity;
      return sortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [quotes, ytdPct, sortCol, sortAsc]);

  // Forex sortable table
  const fxTableRows = useMemo(() => {
    if (!fxQuotes) return [];
    const rows = FX_PAIRS.map(p => {
      const q = fxQuotes[p.symbol];
      return { ...p, price: q?.price, dayChg: q?.changePercentage, ytd: fxYtdPct[p.symbol] ?? null, yearHigh: q?.yearHigh, yearLow: q?.yearLow };
    });
    rows.sort((a, b) => {
      let av, bv;
      if (fxSortCol === "pair") { av = a.label; bv = b.label; return fxSortAsc ? av.localeCompare(bv) : bv.localeCompare(av); }
      av = a[fxSortCol === "high" ? "yearHigh" : fxSortCol === "low" ? "yearLow" : fxSortCol] ?? -Infinity;
      bv = b[fxSortCol === "high" ? "yearHigh" : fxSortCol === "low" ? "yearLow" : fxSortCol] ?? -Infinity;
      return fxSortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [fxQuotes, fxYtdPct, fxSortCol, fxSortAsc]);

  const toggleSort = (col) => { if (sortCol === col) setSortAsc(!sortAsc); else { setSortCol(col); setSortAsc(col === "region"); } };
  const sortArrow = (col) => sortCol === col ? (sortAsc ? " ▲" : " ▼") : "";
  const toggleFxSort = (col) => { if (fxSortCol === col) setFxSortAsc(!fxSortAsc); else { setFxSortCol(col); setFxSortAsc(col === "pair"); } };
  const fxSortArrow = (col) => fxSortCol === col ? (fxSortAsc ? " ▲" : " ▼") : "";
  const chgColor = (v) => v == null ? "#64748b" : v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#64748b";
  const thStyle = { padding: "10px 12px", fontSize: 10, color: "#818cf8", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer", userSelect: "none" };

  return (<>
    {/* Sub-tab bar */}
    <div style={{ display: "flex", gap: 4, background: "var(--bg-subtle)", borderRadius: 10, padding: 3, marginBottom: 18, flexWrap: "wrap" }}>
      {INTL_SUB_TABS.map(t => (
        <button key={t.id} onClick={() => setIntlSub(t.id)} style={{
          flex: "1 1 auto", minWidth: 90, padding: "8px 10px", border: "none", borderRadius: 8,
          background: intlSub === t.id ? "var(--tab-active-bg)" : "transparent",
          color: intlSub === t.id ? "var(--tab-active-color)" : "var(--tab-inactive-color)", fontSize: 12, fontWeight: intlSub === t.id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.15s",
          borderBottom: intlSub === t.id ? "2px solid #818cf8" : "2px solid transparent",
        }}>{t.label}</button>
      ))}
    </div>

    {/* ===== MARKETS SUB-TAB ===== */}
    {intlSub === "pulse" && <IntlPulseTab go={setIntlSub} />}

    {intlSub === "markets" && (<>
      {!quotes ? <div style={{ textAlign: "center", padding: 40, color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading international market data...</div> : (<>
        <SH>International Market Overview</SH>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px, 100%),1fr))", gap: 10, marginBottom: 16 }}>
          {INTL_ETFS.map(e => {
            const q = quotes[e.symbol];
            const ytd = ytdPct[e.symbol];
            return (
              <div key={e.symbol} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>{e.flag}</span>
                  <div>
                    <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600, fontFamily: fonts.heading }}>{e.label}</div>
                    <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>{e.symbol}</div>
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, marginBottom: 4 }}>
                  {q?.price != null ? `$${q.price.toFixed(2)}` : "—"}
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  {q?.changePercentage != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: chgColor(q.changePercentage) }}>Day {q.changePercentage > 0 ? "+" : ""}{q.changePercentage.toFixed(2)}%</span>}
                  {ytd != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: chgColor(ytd) }}>YTD {ytd > 0 ? "+" : ""}{ytd.toFixed(1)}%</span>}
                </div>
              </div>
            );
          })}
        </div>

        {chartData.length > 1 && (<>
          <SH>YTD Performance (Rebased to 100)</SH>
          <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 10px 8px", marginBottom: 14 }}>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => v.toFixed(0)} domain={["dataMin - 2", "dataMax + 2"]} />
                <ReferenceLine y={100} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 11, fontFamily: fonts.mono }}
                  formatter={(v, name) => { const etf = INTL_ETFS.find(e => e.symbol === name); return [`${v.toFixed(1)}`, `${etf?.flag || ""} ${etf?.label || name}`]; }}
                  labelFormatter={l => fmtDate(l)}
                />
                {INTL_ETFS.map(e => <Line key={e.symbol} type="monotone" dataKey={e.symbol} stroke={e.color} dot={false} strokeWidth={1.5} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>)}

        <SH>Regional Breakdown</SH>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(129,140,248,0.08)" }}>
                <th onClick={() => toggleSort("region")} style={{ ...thStyle, textAlign: "left" }}>Region{sortArrow("region")}</th>
                <th style={{ ...thStyle, textAlign: "center", width: 50, cursor: "default", color: "#64748b" }}>ETF</th>
                <th onClick={() => toggleSort("price")} style={{ ...thStyle, textAlign: "right", width: 80 }}>Price{sortArrow("price")}</th>
                <th onClick={() => toggleSort("dayChg")} style={{ ...thStyle, textAlign: "right", width: 80 }}>Day %{sortArrow("dayChg")}</th>
                <th onClick={() => toggleSort("ytd")} style={{ ...thStyle, textAlign: "right", width: 80 }}>YTD %{sortArrow("ytd")}</th>
                <th onClick={() => toggleSort("high")} style={{ ...thStyle, textAlign: "right", width: 80 }}>52W Hi{sortArrow("high")}</th>
                <th onClick={() => toggleSort("low")} style={{ ...thStyle, textAlign: "right", width: 80 }}>52W Lo{sortArrow("low")}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, i) => (
                <tr key={r.symbol} style={{ borderBottom: i < tableRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}><span style={{ marginRight: 8 }}>{r.flag}</span>{r.label}</td>
                  <td style={{ padding: "10px 12px", fontSize: 10, fontFamily: fonts.mono, color: "#64748b", textAlign: "center" }}>{r.symbol}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.mono, color: "var(--text-primary)", textAlign: "right", fontWeight: 600 }}>{r.price != null ? `$${r.price.toFixed(2)}` : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: chgColor(r.dayChg), textAlign: "right" }}>{r.dayChg != null ? `${r.dayChg > 0 ? "+" : ""}${r.dayChg.toFixed(2)}%` : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: chgColor(r.ytd), textAlign: "right", fontWeight: 600 }}>{r.ytd != null ? `${r.ytd > 0 ? "+" : ""}${r.ytd.toFixed(1)}%` : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-secondary)", textAlign: "right" }}>{r.yearHigh != null ? `$${r.yearHigh.toFixed(2)}` : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-secondary)", textAlign: "right" }}>{r.yearLow != null ? `$${r.yearLow.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}
    </>)}

    {/* ===== CENTRAL BANKS SUB-TAB ===== */}
    {intlSub === "rates" && (() => {
      const rows = CENTRAL_BANKS.map(cb => ({
        ...cb,
        rate: cbRates?.[cb.id]?.rate ?? null,
        date: cbRates?.[cb.id]?.date ?? null,
        source: cbRates?.[cb.id]?.source ?? null,
      })).sort((a, b) => (b.rate ?? -Infinity) - (a.rate ?? -Infinity));
      const maxRate = Math.max(...rows.map(r => r.rate ?? 0));
      const usRate = rows.find(r => r.id === "US")?.rate;

      return (<>
        <SH>Global Central Bank Policy Rates</SH>
        <InfoBox color="#3B82F6">
          <strong style={{ color: "var(--text-primary)" }}>Policy rates set by major central banks.</strong>{" "}
          US/EU/UK/KR/BR from FRED (daily/weekly). All others from FMP economic calendar (most recent decision).
          UK shows SONIA overnight rate (tracks BoE base rate closely).
        </InfoBox>

        {/* Loading / error states */}
        {cbRatesLoading && (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 12 }}>
            Fetching live central bank rate data…
          </div>
        )}
        {cbRatesError && (
          <div style={{ textAlign: "center", padding: 30 }}>
            <div style={{ color: "#f87171", fontFamily: fonts.mono, fontSize: 11, marginBottom: 10 }}>Failed to load central bank rates.</div>
            <button onClick={() => { setCbRates(null); setCbRatesError(false); }} style={{
              background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)",
              borderRadius: 8, padding: "6px 18px", fontSize: 11, fontFamily: fonts.mono, color: "#3B82F6", cursor: "pointer",
            }}>Retry</button>
          </div>
        )}

        {/* Rate cards grid */}
        {!cbRatesLoading && !cbRatesError && rows.some(r => r.rate != null) && (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 10, marginBottom: 20 }}>
            {rows.map(cb => {
              if (cb.rate == null) return null;
              const spread = usRate != null ? cb.rate - usRate : null;
              return (
                <div key={cb.id} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", borderTop: `3px solid ${cb.color}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>{cb.flag}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading }}>{cb.country}</div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono }}>{cb.bank}</div>
                    </div>
                    {cb.source && (
                      <span style={{ fontSize: 8, fontFamily: fonts.mono, color: cb.source === "FRED" ? "#4ade80" : "#818cf8",
                        background: cb.source === "FRED" ? "rgba(74,222,128,0.1)" : "rgba(129,140,248,0.1)",
                        border: `1px solid ${cb.source === "FRED" ? "rgba(74,222,128,0.2)" : "rgba(129,140,248,0.2)"}`,
                        borderRadius: 4, padding: "1px 5px" }}>
                        {cb.source}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>
                    {cb.rate.toFixed(2)}<span style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 400 }}>%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                    <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono }}>as of {cb.date}</span>
                    {spread != null && cb.id !== "US" && (
                      <span style={{ fontSize: 9, fontFamily: fonts.mono, color: spread > 0 ? "#4ade80" : spread < 0 ? "#f87171" : "var(--text-muted)" }}>
                        vs US: {spread > 0 ? "+" : ""}{spread.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bar chart comparison */}
          <SH>Rate Comparison</SH>
          <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "20px 10px 10px", marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={rows.filter(r => r.rate != null).map(r => ({ name: r.country.split(" ")[0], rate: r.rate, color: r.color, flag: r.flag }))}
                margin={{ top: 24, right: 20, left: -10, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: fonts.heading }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => `${v}%`} domain={[0, Math.ceil(maxRate) + 1]} />
                <Tooltip
                  contentStyle={{ background: "var(--tooltip-bg, #1e293b)", border: "1px solid var(--border-subtle)", borderRadius: 10, fontSize: 11, fontFamily: fonts.mono }}
                  formatter={(v, _, props) => [`${v.toFixed(2)}%`, props.payload?.flag ? `${props.payload.flag} ${props.payload.name}` : props.payload.name]}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                  {rows.filter(r => r.rate != null).map((r, i) => <Cell key={i} fill={r.color} fillOpacity={0.85} />)}
                  <LabelList dataKey="rate" position="top" formatter={v => `${v.toFixed(1)}%`} style={{ fontSize: 9, fontFamily: fonts.mono, fill: "var(--text-secondary)" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <SH>Policy Rate Details</SH>
          <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(59,130,246,0.08)" }}>
                  <th style={{ ...thStyle, textAlign: "left", cursor: "default" }}>Country</th>
                  <th style={{ ...thStyle, textAlign: "left", cursor: "default" }}>Central Bank</th>
                  <th style={{ ...thStyle, textAlign: "right", cursor: "default" }}>Rate</th>
                  <th style={{ ...thStyle, textAlign: "right", cursor: "default" }}>vs US</th>
                  <th style={{ ...thStyle, textAlign: "right", cursor: "default" }}>Last Updated</th>
                  <th style={{ ...thStyle, textAlign: "center", cursor: "default" }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const spread = usRate != null && r.id !== "US" ? r.rate - usRate : null;
                  return (
                    <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border-subtle)" : "none", background: r.id === "US" ? "rgba(232,85,58,0.04)" : "transparent" }}>
                      <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "var(--text-primary)", fontWeight: r.id === "US" ? 600 : 400 }}>
                        <span style={{ marginRight: 8 }}>{r.flag}</span>{r.country}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-muted)" }}>{r.bank}</td>
                      <td style={{ padding: "10px 12px", fontSize: 14, fontFamily: fonts.mono, color: r.rate != null ? r.color : "var(--text-muted)", textAlign: "right", fontWeight: 700 }}>
                        {r.rate != null ? `${r.rate.toFixed(2)}%` : "—"}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, textAlign: "right", color: spread == null ? "var(--text-muted)" : spread > 0 ? "#4ade80" : spread < 0 ? "#f87171" : "var(--text-muted)" }}>
                        {spread != null ? `${spread > 0 ? "+" : ""}${spread.toFixed(2)}%` : r.id === "US" ? "—" : "N/A"}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 10, fontFamily: fonts.mono, color: "var(--text-muted)", textAlign: "right" }}>{r.date || "—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        {r.source && (
                          <span style={{ fontSize: 8, fontFamily: fonts.mono,
                            color: r.source === "FRED" ? "#4ade80" : "#818cf8",
                            background: r.source === "FRED" ? "rgba(74,222,128,0.1)" : "rgba(129,140,248,0.1)",
                            border: `1px solid ${r.source === "FRED" ? "rgba(74,222,128,0.2)" : "rgba(129,140,248,0.2)"}`,
                            borderRadius: 4, padding: "2px 6px",
                          }}>{r.source}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>)}
      </>);
    })()}

    {/* ===== FOREX SUB-TAB ===== */}
    {/* ===== WORLD BANK SUB-TABS ===== */}
    {["gdp", "debt", "infl", "demo"].includes(intlSub) && <WorldBankSubTab view={intlSub} />}

    {/* ===== LIQUIDITY & DEBT SUB-TAB ===== */}
    {intlSub === "liquidity" && <LiquiditySubTab />}

    {intlSub === "forex" && (<ForexFundamentals prices={<>
      {/* ── Trade-Weighted Dollar Index ───────────────────────── */}
      <SH>Trade-Weighted U.S. Dollar Index</SH>
      <InfoBox color="#E8553A">
        <strong style={{ color: "var(--text-primary)" }}>Federal Reserve Broad Dollar Index.</strong> Measures the USD against 26 trading partner currencies weighted by goods trade. Base = 100 (Jan 2006). Higher = stronger dollar.
      </InfoBox>

      {twiSnapshot.length > 0 && twiSnapshot[0].latest != null && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
          {twiSnapshot.map(s => (
            <div key={s.id} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", borderTop: `3px solid ${s.color}` }}>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>{s.latest.toFixed(2)}</div>
              <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                {s.ytdChg != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: s.ytdChg > 0 ? "#4ade80" : s.ytdChg < 0 ? "#f87171" : "var(--text-muted)" }}>YTD {s.ytdChg > 0 ? "+" : ""}{s.ytdChg.toFixed(2)}%</span>}
                {s.yrChg != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: s.yrChg > 0 ? "#4ade80" : s.yrChg < 0 ? "#f87171" : "var(--text-muted)" }}>1Y {s.yrChg > 0 ? "+" : ""}{s.yrChg.toFixed(2)}%</span>}
              </div>
              <div style={{ fontSize: 8, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 3 }}>as of {s.latestDate}</div>
            </div>
          ))}
        </div>
      )}

      {twiChartData.length > 1 && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 10px 8px", marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 8, paddingRight: 10 }}>
            {["ytd", "1y", "5y", "max"].map(r => (
              <button key={r} onClick={() => setTwiRange(r)} style={{
                background: twiRange === r ? "rgba(232,85,58,0.18)" : "transparent",
                border: twiRange === r ? "1px solid rgba(232,85,58,0.4)" : "1px solid var(--border-subtle)",
                borderRadius: 6, padding: "3px 10px", fontSize: 10, fontFamily: fonts.mono,
                color: twiRange === r ? "#E8553A" : "var(--text-muted)", cursor: "pointer", fontWeight: twiRange === r ? 700 : 400,
              }}>{r.toUpperCase()}</button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={twiChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={d => d.slice(0, 7)} interval="preserveStartEnd" minTickGap={50} />
              <YAxis tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "var(--tooltip-bg, #1e293b)", border: "1px solid var(--border-subtle)", borderRadius: 10, fontSize: 11, fontFamily: fonts.mono }}
                formatter={(v, name) => { const s = TWI_SERIES.find(t => t.id === name); return [v.toFixed(2), s?.label || name]; }}
                labelFormatter={l => fmtDate(l)}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 4 }} iconType="circle" iconSize={7}
                formatter={(val) => { const s = TWI_SERIES.find(t => t.id === val); return s?.shortLabel || val; }} />
              {TWI_SERIES.map(s => <Line key={s.id} type="monotone" dataKey={s.id} stroke={s.color} dot={false} strokeWidth={2} connectNulls />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {twiLoading && <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 11 }}>Loading trade-weighted dollar index...</div>}
      {twiError && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <div style={{ color: "#f87171", fontFamily: fonts.mono, fontSize: 11, marginBottom: 8 }}>Failed to load dollar index data (FRED rate limit likely).</div>
          <button onClick={() => { setTwiError(false); fetchTwi(); }} style={{ background: "rgba(232,85,58,0.15)", border: "1px solid rgba(232,85,58,0.3)", borderRadius: 8, padding: "6px 18px", fontSize: 11, fontFamily: fonts.mono, color: "#E8553A", cursor: "pointer" }}>Retry</button>
        </div>
      )}
      {!fredKey && <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 11 }}>FRED API key needed for dollar index data.</div>}

      {!fxQuotes ? <div style={{ textAlign: "center", padding: 40, color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading forex data...</div> : (<>
        <SH>Major Currency Pairs</SH>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px, 100%),1fr))", gap: 10, marginBottom: 16 }}>
          {FX_PAIRS.map(p => {
            const q = fxQuotes[p.symbol];
            const ytd = fxYtdPct[p.symbol];
            const decimals = (q?.price != null && q.price > 100) ? 2 : 4;
            return (
              <div key={p.symbol} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>{p.flag}</span>
                  <div>
                    <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 700, fontFamily: fonts.mono }}>{p.label}</div>
                    <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.heading }}>{p.base}</div>
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.mono, marginBottom: 4 }}>
                  {q?.price != null ? q.price.toFixed(decimals) : "—"}
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {q?.changePercentage != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: chgColor(q.changePercentage) }}>Day {q.changePercentage > 0 ? "+" : ""}{q.changePercentage.toFixed(3)}%</span>}
                  {ytd != null && <span style={{ fontSize: 10, fontFamily: fonts.mono, color: chgColor(ytd) }}>YTD {ytd > 0 ? "+" : ""}{ytd.toFixed(1)}%</span>}
                  {q?.yearHigh != null && q?.yearLow != null && <span style={{ fontSize: 9, fontFamily: fonts.mono, color: "#64748b" }}>52W: {q.yearLow.toFixed(decimals > 2 ? 3 : 1)}-{q.yearHigh.toFixed(decimals > 2 ? 3 : 1)}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Forex YTD chart (major XXX/USD pairs rebased to 100) */}
        {fxChartData.length > 1 && (<>
          <SH>Major Pairs vs USD — YTD (Rebased to 100)</SH>
          <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 10px 8px", marginBottom: 14 }}>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={fxChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748b", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={v => v.toFixed(1)} domain={["dataMin - 0.5", "dataMax + 0.5"]} />
                <ReferenceLine y={100} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 11, fontFamily: fonts.mono }}
                  formatter={(v, name) => { const p = FX_PAIRS.find(f => f.symbol === name); return [`${v.toFixed(2)}`, `${p?.flag || ""} ${p?.label || name}`]; }}
                  labelFormatter={l => fmtDate(l)}
                />
                {FX_PAIRS.filter(p => !p.invert).map(p => <Line key={p.symbol} type="monotone" dataKey={p.symbol} stroke={p.color} dot={false} strokeWidth={1.5} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>)}

        {/* Forex sortable table */}
        <SH>All Currency Pairs</SH>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(129,140,248,0.08)" }}>
                <th onClick={() => toggleFxSort("pair")} style={{ ...thStyle, textAlign: "left" }}>Pair{fxSortArrow("pair")}</th>
                <th onClick={() => toggleFxSort("price")} style={{ ...thStyle, textAlign: "right", width: 100 }}>Rate{fxSortArrow("price")}</th>
                <th onClick={() => toggleFxSort("dayChg")} style={{ ...thStyle, textAlign: "right", width: 90 }}>Day %{fxSortArrow("dayChg")}</th>
                <th onClick={() => toggleFxSort("ytd")} style={{ ...thStyle, textAlign: "right", width: 90 }}>YTD %{fxSortArrow("ytd")}</th>
                <th onClick={() => toggleFxSort("high")} style={{ ...thStyle, textAlign: "right", width: 100 }}>52W Hi{fxSortArrow("high")}</th>
                <th onClick={() => toggleFxSort("low")} style={{ ...thStyle, textAlign: "right", width: 100 }}>52W Lo{fxSortArrow("low")}</th>
              </tr>
            </thead>
            <tbody>
              {fxTableRows.map((r, i) => {
                const dec = (r.price != null && r.price > 100) ? 2 : 4;
                return (
                  <tr key={r.symbol} style={{ borderBottom: i < fxTableRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                    <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: fonts.heading, color: "#e2e8f0", fontWeight: 500 }}>
                      <span style={{ marginRight: 8 }}>{r.flag}</span><span style={{ fontFamily: fonts.mono, fontWeight: 700 }}>{r.label}</span>
                      <span style={{ fontSize: 9, color: "#64748b", marginLeft: 8 }}>{r.base}</span>
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 13, fontFamily: fonts.mono, color: "var(--text-primary)", textAlign: "right", fontWeight: 700 }}>{r.price != null ? r.price.toFixed(dec) : "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: chgColor(r.dayChg), textAlign: "right" }}>{r.dayChg != null ? `${r.dayChg > 0 ? "+" : ""}${r.dayChg.toFixed(3)}%` : "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: chgColor(r.ytd), textAlign: "right", fontWeight: 600 }}>{r.ytd != null ? `${r.ytd > 0 ? "+" : ""}${r.ytd.toFixed(1)}%` : "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-secondary)", textAlign: "right" }}>{r.yearHigh != null ? r.yearHigh.toFixed(dec) : "—"}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, fontFamily: fonts.mono, color: "var(--text-secondary)", textAlign: "right" }}>{r.yearLow != null ? r.yearLow.toFixed(dec) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>)}
    </>} />)}
  </>);
}


export default InternationalTab;
