import React, { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { SH } from "../../components/shared.jsx";

/* ── country roster ───────────────────────────────────────────── */
const COUNTRIES = [
  { code: "US",  iso3: "USA", name: "United States",  flag: "🇺🇸", color: "#3b82f6" },
  { code: "CN",  iso3: "CHN", name: "China",          flag: "🇨🇳", color: "#ef4444" },
  { code: "JP",  iso3: "JPN", name: "Japan",          flag: "🇯🇵", color: "#ec4899" },
  { code: "DE",  iso3: "DEU", name: "Germany",        flag: "🇩🇪", color: "#fbbf24" },
  { code: "GB",  iso3: "GBR", name: "United Kingdom", flag: "🇬🇧", color: "#8b5cf6" },
  { code: "IN",  iso3: "IND", name: "India",          flag: "🇮🇳", color: "#f97316" },
  { code: "BR",  iso3: "BRA", name: "Brazil",         flag: "🇧🇷", color: "#22c55e" },
  { code: "CA",  iso3: "CAN", name: "Canada",         flag: "🇨🇦", color: "#e11d48" },
  { code: "AU",  iso3: "AUS", name: "Australia",      flag: "🇦🇺", color: "#6366f1" },
  { code: "KR",  iso3: "KOR", name: "South Korea",    flag: "🇰🇷", color: "#14b8a6" },
  { code: "CH",  iso3: "CHE", name: "Switzerland",    flag: "🇨🇭", color: "#10b981" },
  { code: "MX",  iso3: "MEX", name: "Mexico",         flag: "🇲🇽", color: "#d946ef" },
];

const countryCodes = COUNTRIES.map(c => c.code).join(";");
const countryByCode = Object.fromEntries(COUNTRIES.map(c => [c.code, c]));

/* ── World Bank indicator IDs ─────────────────────────────────── */
const WB = {
  gdp:         "NY.GDP.MKTP.CD",
  gdpGrowth:   "NY.GDP.MKTP.KD.ZG",
  gdpPerCap:   "NY.GDP.PCAP.CD",
  debtGdp:     "GC.DOD.TOTL.GD.ZS",
  inflation:   "FP.CPI.TOTL.ZG",
  pop:         "SP.POP.TOTL",
  lifeExp:     "SP.DYN.LE00.IN",
  fertility:   "SP.DYN.TFRT.IN",
  unemployment:"SL.UEM.TOTL.ZS",
};

/* ── fetcher ──────────────────────────────────────────────────── */
async function fetchWB(indicator, dateRange = "2000:2025", perPage = 1000) {
  const url = `https://api.worldbank.org/v2/country/${countryCodes}/indicator/${indicator}?format=json&per_page=${perPage}&date=${dateRange}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!Array.isArray(json) || json.length < 2 || !json[1]) return [];
  return json[1].filter(d => d.value != null);
}

/* ── helpers ───────────────────────────────────────────────────── */
function fmtBig(v) {
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function fmtPop(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

/* ── bar chart tooltip ─────────────────────────────────────────── */
const ttStyle = { background: "var(--tooltip-bg, #0f172a)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading };

/* ── subtab definitions ───────────────────────────────────────── */
/* ── build latest-value map { countryCode → value } ──────────── */
function latestByCountry(rows) {
  const map = {};
  rows.forEach(r => {
    const cc = r.country.id;
    if (!map[cc] || +r.date > +map[cc].date) map[cc] = r;
  });
  const out = {};
  for (const cc in map) out[cc] = { value: map[cc].value, year: map[cc].date };
  return out;
}

/* ── build time-series array for one country ─────────────────── */
/* ── reusable horizontal bar chart (ranked) ──────────────────── */
function RankedBarChart({ data, formatter, unit, height = 380 }) {
  if (!data.length) return null;
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 10px 8px", marginBottom: 14 }}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
          <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={formatter} />
          <YAxis type="category" dataKey="label" tick={{ fill: "var(--text-secondary)", fontSize: 10, fontFamily: fonts.heading }} width={130} />
          <Tooltip contentStyle={ttStyle} formatter={(v) => [formatter(v), unit]} labelStyle={{ color: "var(--text-secondary)" }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.75} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── reusable multi-country line chart ───────────────────────── */
function MultiLineChart({ series, yFormatter, height = 300, title }) {
  // series: { data: [{year, US: v, CN: v, ...}], countries: [list of codes shown] }
  if (!series || !series.data.length) return null;
  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 10px 8px", marginBottom: 14 }}>
      {title && <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8, paddingLeft: 12 }}>{title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={series.data} margin={{ top: 5, right: 20, left: -5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey="year" tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 9, fontFamily: fonts.mono }} tickFormatter={yFormatter} />
          <Tooltip contentStyle={ttStyle} labelStyle={{ color: "var(--text-secondary)" }}
            formatter={(v, name) => { const c = countryByCode[name]; return [yFormatter(v), `${c?.flag || ""} ${c?.name || name}`]; }} />
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.heading, paddingTop: 6 }} iconType="circle" iconSize={7}
            formatter={(val) => { const c = countryByCode[val]; return `${c?.flag || ""} ${c?.name || val}`; }} />
          {series.countries.map(cc => {
            const c = countryByCode[cc];
            return <Line key={cc} type="monotone" dataKey={cc} stroke={c?.color || "#888"} dot={false} strokeWidth={1.8} connectNulls />;
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── snapshot cards row ────────────────────────────────────────── */
function SnapshotCards({ latest, formatter, unit }) {
  const sorted = COUNTRIES
    .map(c => ({ ...c, val: latest[c.code]?.value, year: latest[c.code]?.year }))
    .filter(c => c.val != null)
    .sort((a, b) => b.val - a.val);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(170px, 100%),1fr))", gap: 10, marginBottom: 16 }}>
      {sorted.map(c => (
        <div key={c.code} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: c.color, borderRadius: "14px 14px 0 0" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 16 }}>{c.flag}</span>
            <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{c.name}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>{formatter(c.val)}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 2 }}>{c.year} · {unit}</div>
        </div>
      ))}
    </div>
  );
}

/* ── build multiline data ──────────────────────────────────────── */
function buildMultiLine(rows) {
  const yearMap = {};
  rows.forEach(r => {
    const yr = +r.date;
    if (!yearMap[yr]) yearMap[yr] = { year: yr };
    yearMap[yr][r.country.id] = r.value;
  });
  const data = Object.values(yearMap).sort((a, b) => a.year - b.year);
  const countries = COUNTRIES.map(c => c.code).filter(cc => data.some(d => d[cc] != null));
  return { data, countries };
}

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════════ */
export default function WorldBankSubTab({ view }) {
  const [wbSub, setWbSub] = useState("gdp");
  const activeView = view || wbSub;

  /* ── data stores ──────────────────────────────────────────────── */
  const [gdpData, setGdpData]       = useState(null);
  const [growthData, setGrowthData] = useState(null);
  const [pcData, setPcData]         = useState(null);
  const [debtData, setDebtData]     = useState(null);
  const [inflData, setInflData]     = useState(null);
  const [popData, setPopData]       = useState(null);
  const [leData, setLeData]         = useState(null);
  const [fertData, setFertData]     = useState(null);
  const [unempData, setUnempData]   = useState(null);
  const [loading, setLoading]       = useState(false);

  /* ── fetch on subtab change ───────────────────────────────────── */
  useEffect(() => {
    if (activeView === "gdp" && !gdpData) {
      setLoading(true);
      Promise.all([
        fetchWB(WB.gdp),
        fetchWB(WB.gdpGrowth),
        fetchWB(WB.gdpPerCap),
      ]).then(([g, gr, pc]) => {
        setGdpData(g); setGrowthData(gr); setPcData(pc); setLoading(false);
      }).catch(() => setLoading(false));
    }
    if (activeView === "debt" && !debtData) {
      setLoading(true);
      fetchWB(WB.debtGdp).then(d => { setDebtData(d); setLoading(false); }).catch(() => setLoading(false));
    }
    if (activeView === "infl" && !inflData) {
      setLoading(true);
      fetchWB(WB.inflation).then(d => { setInflData(d); setLoading(false); }).catch(() => setLoading(false));
    }
    if (activeView === "demo" && !popData) {
      setLoading(true);
      Promise.all([
        fetchWB(WB.pop),
        fetchWB(WB.lifeExp),
        fetchWB(WB.fertility),
        fetchWB(WB.unemployment),
      ]).then(([p, le, f, u]) => {
        setPopData(p); setLeData(le); setFertData(f); setUnempData(u); setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [activeView, gdpData, debtData, inflData, popData]);

  /* ── derived data: GDP ────────────────────────────────────────── */
  const gdpLatest    = useMemo(() => gdpData    ? latestByCountry(gdpData)    : {}, [gdpData]);
  const growthLatest = useMemo(() => growthData ? latestByCountry(growthData) : {}, [growthData]);
  const pcLatest     = useMemo(() => pcData     ? latestByCountry(pcData)     : {}, [pcData]);
  const gdpLine      = useMemo(() => gdpData    ? buildMultiLine(gdpData)     : null, [gdpData]);
  const growthLine   = useMemo(() => growthData ? buildMultiLine(growthData)  : null, [growthData]);

  const gdpBarData = useMemo(() =>
    COUNTRIES.map(c => ({ label: `${c.flag} ${c.name}`, value: gdpLatest[c.code]?.value, color: c.color }))
      .filter(d => d.value != null).sort((a, b) => b.value - a.value),
  [gdpLatest]);

  const pcBarData = useMemo(() =>
    COUNTRIES.map(c => ({ label: `${c.flag} ${c.name}`, value: pcLatest[c.code]?.value, color: c.color }))
      .filter(d => d.value != null).sort((a, b) => b.value - a.value),
  [pcLatest]);

  /* ── derived data: Debt ───────────────────────────────────────── */
  const debtLatest = useMemo(() => debtData ? latestByCountry(debtData) : {}, [debtData]);
  const debtLine   = useMemo(() => debtData ? buildMultiLine(debtData)  : null, [debtData]);
  const debtBarData = useMemo(() =>
    COUNTRIES.map(c => ({ label: `${c.flag} ${c.name}`, value: debtLatest[c.code]?.value, color: c.color }))
      .filter(d => d.value != null).sort((a, b) => b.value - a.value),
  [debtLatest]);

  /* ── derived data: Inflation ──────────────────────────────────── */
  const inflLatest  = useMemo(() => inflData ? latestByCountry(inflData) : {}, [inflData]);
  const inflLine    = useMemo(() => inflData ? buildMultiLine(inflData)  : null, [inflData]);
  const inflBarData = useMemo(() =>
    COUNTRIES.map(c => ({ label: `${c.flag} ${c.name}`, value: inflLatest[c.code]?.value, color: c.color }))
      .filter(d => d.value != null).sort((a, b) => b.value - a.value),
  [inflLatest]);

  /* ── derived data: Demographics ───────────────────────────────── */
  const popLatest   = useMemo(() => popData   ? latestByCountry(popData)   : {}, [popData]);
  const leLatest    = useMemo(() => leData    ? latestByCountry(leData)    : {}, [leData]);
  const fertLatest  = useMemo(() => fertData  ? latestByCountry(fertData)  : {}, [fertData]);
  const unempLatest = useMemo(() => unempData ? latestByCountry(unempData) : {}, [unempData]);
  const popLine     = useMemo(() => popData   ? buildMultiLine(popData)    : null, [popData]);
  const leLine      = useMemo(() => leData    ? buildMultiLine(leData)     : null, [leData]);

  const popBarData = useMemo(() =>
    COUNTRIES.map(c => ({ label: `${c.flag} ${c.name}`, value: popLatest[c.code]?.value, color: c.color }))
      .filter(d => d.value != null).sort((a, b) => b.value - a.value),
  [popLatest]);

  const leBarData = useMemo(() =>
    COUNTRIES.map(c => ({ label: `${c.flag} ${c.name}`, value: leLatest[c.code]?.value, color: c.color }))
      .filter(d => d.value != null).sort((a, b) => b.value - a.value),
  [leLatest]);

  /* ── loading state ────────────────────────────────────────────── */
  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 12 }}>Loading World Bank data…</div>;

  /* ══════════ GDP VIEW ══════════ */
  if (activeView === "gdp") return (<>
    {!gdpData ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 12 }}>Loading GDP data…</div> : (<>
      <SH>GDP — Nominal (Current US$)</SH>
      <SnapshotCards latest={gdpLatest} formatter={fmtBig} unit="Nominal GDP" />
      <SH>GDP Ranking</SH>
      <RankedBarChart data={gdpBarData} formatter={fmtBig} unit="GDP" height={Math.max(300, gdpBarData.length * 34)} />

      <SH>GDP Per Capita</SH>
      <SnapshotCards latest={pcLatest} formatter={v => `$${(v/1000).toFixed(1)}K`} unit="Per Capita" />
      <RankedBarChart data={pcBarData} formatter={v => `$${(v/1000).toFixed(0)}K`} unit="GDP Per Capita" height={Math.max(300, pcBarData.length * 34)} />

      <SH>GDP Over Time</SH>
      {gdpLine && <MultiLineChart series={gdpLine} yFormatter={fmtBig} height={340} />}

      <SH>GDP Growth Rate (%)</SH>
      <SnapshotCards latest={growthLatest} formatter={v => `${v.toFixed(1)}%`} unit="Annual Growth" />
      {growthLine && <MultiLineChart series={growthLine} yFormatter={v => `${v.toFixed(1)}%`} height={300} />}
    </>)}
  </>);

  /* ══════════ DEBT VIEW ══════════ */
  if (activeView === "debt") return (<>
    {!debtData ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 12 }}>Loading debt data…</div> : (<>
      <SH>Government Debt (% of GDP)</SH>
      <SnapshotCards latest={debtLatest} formatter={v => `${v.toFixed(1)}%`} unit="Debt/GDP" />
      <SH>Debt-to-GDP Ranking</SH>
      <RankedBarChart data={debtBarData} formatter={v => `${v.toFixed(0)}%`} unit="% of GDP" height={Math.max(300, debtBarData.length * 34)} />
      <SH>Debt-to-GDP Over Time</SH>
      {debtLine && <MultiLineChart series={debtLine} yFormatter={v => `${v.toFixed(0)}%`} height={340} />}
    </>)}
  </>);

  /* ══════════ INFLATION VIEW ══════════ */
  if (activeView === "infl") return (<>
    {!inflData ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 12 }}>Loading inflation data…</div> : (<>
      <SH>Inflation — Consumer Prices (Annual %)</SH>
      <SnapshotCards latest={inflLatest} formatter={v => `${v.toFixed(1)}%`} unit="CPI Annual" />
      <SH>Inflation Ranking</SH>
      <RankedBarChart data={inflBarData} formatter={v => `${v.toFixed(1)}%`} unit="CPI %" height={Math.max(300, inflBarData.length * 34)} />
      <SH>Inflation Over Time</SH>
      {inflLine && <MultiLineChart series={inflLine} yFormatter={v => `${v.toFixed(1)}%`} height={340} />}
    </>)}
  </>);

  /* ══════════ DEMOGRAPHICS VIEW ══════════ */
  if (activeView === "demo") return (<>
    {!popData ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontFamily: fonts.mono, fontSize: 12 }}>Loading demographics data…</div> : (<>
      <SH>Population</SH>
      <SnapshotCards latest={popLatest} formatter={fmtPop} unit="Total Population" />
      <SH>Population Ranking</SH>
      <RankedBarChart data={popBarData} formatter={fmtPop} unit="Population" height={Math.max(300, popBarData.length * 34)} />
      <SH>Population Over Time</SH>
      {popLine && <MultiLineChart series={popLine} yFormatter={fmtPop} height={340} />}

      <SH>Life Expectancy (Years)</SH>
      <SnapshotCards latest={leLatest} formatter={v => `${v.toFixed(1)} yr`} unit="Life Expectancy" />
      <RankedBarChart data={leBarData} formatter={v => `${v.toFixed(0)} yr`} unit="Years" height={Math.max(300, leBarData.length * 34)} />
      {leLine && <MultiLineChart series={leLine} yFormatter={v => `${v.toFixed(0)}`} height={300} title="Life Expectancy Over Time" />}

      <SH>Fertility & Unemployment</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(170px, 100%),1fr))", gap: 10, marginBottom: 16 }}>
        {COUNTRIES.map(c => {
          const fert = fertLatest[c.code];
          const unemp = unempLatest[c.code];
          return (
            <div key={c.code} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: c.color, borderRadius: "14px 14px 0 0" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>{c.flag}</span>
                <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" }}>{c.name}</span>
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginBottom: 2 }}>Fertility</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{fert ? `${fert.value.toFixed(2)}` : "—"}</div>
                  {fert && <div style={{ fontSize: 8, color: "var(--text-muted)", fontFamily: fonts.mono }}>{fert.year} · births/woman</div>}
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginBottom: 2 }}>Unemployment</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{unemp ? `${unemp.value.toFixed(1)}%` : "—"}</div>
                  {unemp && <div style={{ fontSize: 8, color: "var(--text-muted)", fontFamily: fonts.mono }}>{unemp.year} · ILO est.</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>)}
  </>);

  return null;
}
