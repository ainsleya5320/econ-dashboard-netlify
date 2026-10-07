import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoPath } from "d3-geo";
import { feature, mesh, merge } from "topojson-client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { useIsPhone } from "../../components/dense.jsx";

// ============================================================================
// MARKET MAP — Real Estate → Market Map. Every state, metro (CBSA) and county
// on one choropleth, in the manner of Reventure App's map: pick a metric,
// hover for the value, click for the area's scorecard, or switch to the table
// to sort and filter. Data: /api/market-map/{level} (server/marketMap.js);
// outlines: us-atlas counties-albers-10m (already projected, so no projection
// runs here — metros are drawn by merging their member counties).
//
// Colour follows the dataviz method: magnitude metrics take a one-hue indigo
// ramp in five equal-count bins; metrics with a meaningful zero (growth,
// overvaluation, inventory against 2017–19, migration) take a blue/orange
// diverging ramp with a grey neutral band, so above and below zero read as
// two hues rather than a good/bad judgement. Each mode has its own validated
// steps (validate_palette.js --ordinal, both arms, both surfaces).
// ============================================================================

const TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-albers-10m.json";
const W = 975, H = 610;
const RAMPS = {
  dark: {
    seq: ["#4f46e5", "#6366f1", "#818cf8", "#a5b4fc", "#e0e7ff"],                  // low → high
    div: ["#93c5fd", "#3b82f6", "#1d4ed8", "#52525b", "#c2410c", "#f97316", "#fdba74"], // most negative → most positive
    none: "#242a36", edge: "#0b1120", line: "rgba(255,255,255,0.5)", focus: "#f8fafc",
  },
  light: {
    seq: ["#818cf8", "#6366f1", "#4f46e5", "#3730a3", "#1e1b4b"],
    div: ["#1e3a8a", "#2563eb", "#60a5fa", "#a1a1aa", "#fb923c", "#ea580c", "#9a3412"],
    none: "#e5e7eb", edge: "#ffffff", line: "rgba(15,23,42,0.6)", focus: "#0f172a",
  },
};

const fin = v => v != null && Number.isFinite(v);
// signed with the digits actually shown, so −0.03% reads 0.0%, not −0.0%
const signed = (v, dp, unit) => { const s = Math.abs(v).toFixed(dp); return `${Number(s) === 0 ? "" : v > 0 ? "+" : "−"}${s}${unit}`; };
const F = {
  usd: v => `$${Math.round(v).toLocaleString()}`,
  usdK: v => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`),
  pct: v => signed(v, 1, "%"),
  pct0: v => `${v.toFixed(1)}%`,
  pct2: v => `${v.toFixed(2)}%`,
  pp: v => signed(v, 1, " pts"),
  x: v => `${v.toFixed(1)}×`,
  days: v => `${Math.round(v)} days`,
  int: v => Math.round(v).toLocaleString(),
  per1k: v => signed(v, 1, " per 1,000"),
  one: v => v.toFixed(1),
  score: v => `${Math.round(v)} / 100`,
};

// The metric catalogue. scale: "seq" (magnitude) or "div" (zero is meaningful).
const GROUPS = ["Prices & affordability", "Listings", "People & housing", "Investor", "Score"];
const METRICS = [
  { key: "value", g: 0, label: "Home value", fmt: F.usdK, scale: "seq", src: "Zillow ZHVI", desc: "Zillow's typical home value (the middle third of homes), smoothed and seasonally adjusted." },
  { key: "valueYoy", g: 0, label: "Home value, 1 yr", fmt: F.pct, scale: "div", src: "Zillow ZHVI", desc: "Change in the typical home value over twelve months." },
  { key: "value5y", g: 0, label: "Home value, 5 yr", fmt: F.pct, scale: "div", src: "Zillow ZHVI", desc: "Change over five years — the longer run that overvaluation measures against." },
  { key: "valueMom", g: 0, label: "Home value, 1 mo", fmt: F.pct, scale: "div", src: "Zillow ZHVI", desc: "Latest monthly change: the turn shows here first." },
  { key: "fromHi22", g: 0, label: "vs the 2022 high", fmt: F.pct, scale: "div", src: "Zillow ZHVI", desc: "Today against the highest month of 2022, when rates started rising." },
  { key: "crash0712", g: 0, label: "2007–12 crash", fmt: F.pct, scale: "div", src: "Zillow ZHVI", desc: "Peak (highest month 2004–08) to trough (lowest month after it, through 2013)." },
  { key: "vti", g: 0, label: "Value-to-income", fmt: F.x, scale: "seq", src: "Zillow ÷ Census SAIPE", desc: "Typical home value ÷ median household income (SAIPE, carried to today at the area's own five-year pace)." },
  { key: "overvalued", g: 0, label: "Overvalued %", fmt: F.pct, scale: "div", src: "Zillow ÷ Census SAIPE", desc: "Today's value-to-income ratio against the area's own 2000–19 average. Not a forecast — how far prices sit from what local incomes have historically supported." },
  { key: "payPct", g: 0, label: "Payment as % of income", fmt: F.pct0, scale: "seq", src: "Zillow, FRED, Census", desc: "Principal and interest (20% down, 30-year at Freddie Mac's latest rate) plus property tax, ÷ median household income. Excludes insurance and HOA." },
  { key: "payment", g: 0, label: "Monthly payment", fmt: F.usd, scale: "seq", src: "Zillow, FRED, Census", desc: "Principal, interest and property tax on the typical home; same assumptions as above." },
  { key: "salary", g: 0, label: "Salary to afford", fmt: F.usdK, scale: "seq", src: "Zillow, FRED, Census", desc: "Income at which that payment is 30% of gross income." },
  { key: "taxRate", g: 0, label: "Property tax rate", fmt: F.pct2, scale: "seq", src: "Census ACS", desc: "Median real-estate taxes paid ÷ median owner-occupied value." },
  { key: "buyVsRent", g: 0, label: "Buying vs renting", fmt: F.pct, scale: "div", src: "Zillow ZHVI / ZORI", desc: "Monthly payment against Zillow's typical asking rent: +40% means buying costs 40% more a month than renting." },
  { key: "listPrice", g: 1, label: "List price", fmt: F.usdK, scale: "seq", src: "Realtor.com", desc: "Median asking price of active listings." },
  { key: "listYoy", g: 1, label: "List price, 1 yr", fmt: F.pct, scale: "div", src: "Realtor.com", desc: "Asking prices lead sale prices." },
  { key: "ppsf", g: 1, label: "List $ / sq ft", fmt: F.usd, scale: "seq", src: "Realtor.com", desc: "Median asking price per square foot." },
  { key: "active", g: 1, label: "Active listings", fmt: F.int, scale: "seq", src: "Realtor.com", desc: "Homes for sale this month." },
  { key: "activeYoy", g: 1, label: "Active listings, 1 yr", fmt: F.pct, scale: "div", src: "Realtor.com", desc: "Inventory growth over twelve months." },
  { key: "invVs1719", g: 1, label: "Inventory vs 2017–19", fmt: F.pct, scale: "div", src: "Realtor.com", desc: "Active listings against the same calendar month's 2017–19 average — above zero, more supply than before the pandemic." },
  { key: "invPerUnits", g: 1, label: "Listings as % of homes", fmt: F.pct2, scale: "seq", src: "Realtor.com ÷ Census ACS", desc: "Active listings ÷ all housing units." },
  { key: "cut", g: 1, label: "Price cuts", fmt: F.pct0, scale: "seq", src: "Realtor.com", desc: "Share of active listings with a price reduction." },
  { key: "cutYoy", g: 1, label: "Price cuts, 1 yr", fmt: F.pp, scale: "div", src: "Realtor.com", desc: "Change in the price-cut share, in percentage points." },
  { key: "dom", g: 1, label: "Days on market", fmt: F.days, scale: "seq", src: "Realtor.com", desc: "Median days a listing has been on the market." },
  { key: "domYoy", g: 1, label: "Days on market, 1 yr", fmt: F.pct, scale: "div", src: "Realtor.com", desc: "Buyers' patience: rising days on market is a softening tell." },
  { key: "newListings", g: 1, label: "New listings", fmt: F.int, scale: "seq", src: "Realtor.com", desc: "Listings that came on this month." },
  { key: "newYoy", g: 1, label: "New listings, 1 yr", fmt: F.pct, scale: "div", src: "Realtor.com", desc: "Falling new listings with rising inventory means homes are sitting, not that sellers are flooding in." },
  { key: "pop", g: 2, label: "Population", fmt: F.int, scale: "seq", src: "Census estimates", desc: "Resident population, latest July estimate." },
  { key: "popG1", g: 2, label: "Population, 1 yr", fmt: F.pct, scale: "div", src: "Census estimates", desc: "Growth over the latest year." },
  { key: "popG5", g: 2, label: "Population since 2020", fmt: F.pct, scale: "div", src: "Census estimates", desc: "Growth since the 2020 base." },
  { key: "domMig", g: 2, label: "Domestic migration", fmt: F.per1k, scale: "div", src: "Census estimates", desc: "Net moves from elsewhere in the U.S., per 1,000 residents, latest year." },
  { key: "intlMig", g: 2, label: "International migration", fmt: F.per1k, scale: "div", src: "Census estimates", desc: "Net international migration per 1,000 residents, latest year." },
  { key: "natInc", g: 2, label: "Births minus deaths", fmt: F.per1k, scale: "div", src: "Census estimates", desc: "Natural increase per 1,000 residents." },
  { key: "income", g: 2, label: "Median household income", fmt: F.usdK, scale: "seq", src: "Census SAIPE", desc: "Small Area Income and Poverty Estimates, latest year (metros: household-weighted mean of their counties' medians)." },
  { key: "incomeG5", g: 2, label: "Income, 5 yr", fmt: F.pct, scale: "div", src: "Census SAIPE", desc: "Nominal income growth over five years." },
  { key: "poverty", g: 2, label: "Poverty rate", fmt: F.pct0, scale: "seq", src: "Census SAIPE", desc: "Share of people below the poverty line." },
  { key: "ownRate", g: 2, label: "Homeownership", fmt: F.pct0, scale: "seq", src: "Census ACS", desc: "Owner-occupied share of occupied homes (5-year ACS)." },
  { key: "vacancy", g: 2, label: "Vacancy rate", fmt: F.pct0, scale: "seq", src: "Census ACS", desc: "Vacant share of all housing units, seasonal homes included." },
  { key: "rentalVac", g: 2, label: "Rental vacancy", fmt: F.pct0, scale: "seq", src: "Census ACS", desc: "For-rent units ÷ the rental stock." },
  { key: "ownerVac", g: 2, label: "Homeowner vacancy", fmt: F.pct0, scale: "seq", src: "Census ACS", desc: "For-sale units ÷ the owner stock." },
  { key: "otherVac", g: 2, label: "Other vacant (shadow)", fmt: F.pct0, scale: "seq", src: "Census ACS", desc: "Vacant homes not for sale, rent or seasonal use, as a share of all units — the shadow-inventory proxy." },
  { key: "permits", g: 2, label: "Permits per 1,000 homes", fmt: F.one, scale: "seq", src: "Census BPS ÷ ACS", desc: "Housing units authorized last year per 1,000 existing units." },
  { key: "rent", g: 3, label: "Typical rent", fmt: F.usd, scale: "seq", src: "Zillow ZORI", desc: "Zillow's typical asking rent." },
  { key: "rentYoy", g: 3, label: "Rent, 1 yr", fmt: F.pct, scale: "div", src: "Zillow ZORI", desc: "Asking-rent growth over twelve months." },
  { key: "p2r", g: 3, label: "Price-to-rent", fmt: F.x, scale: "seq", src: "Zillow ZHVI / ZORI", desc: "Typical value ÷ a year's typical rent." },
  { key: "grossYield", g: 3, label: "Gross yield", fmt: F.pct0, scale: "seq", src: "Zillow ZHVI / ZORI", desc: "A year's rent ÷ value." },
  { key: "capRate", g: 3, label: "Cap rate (est.)", fmt: F.pct0, scale: "seq", src: "Zillow, Census", desc: "Rent less 25% for vacancy, management and upkeep, less property tax and insurance at 0.5% of value, ÷ value." },
  { key: "rentPct", g: 3, label: "Rent as % of income", fmt: F.pct0, scale: "seq", src: "Zillow ÷ Census", desc: "A year's typical rent ÷ median household income." },
  { key: "forecast", g: 3, label: "Zillow 1-yr forecast", fmt: F.pct, scale: "div", src: "Zillow ZHVF", desc: "Zillow's own twelve-month home-value forecast. Metros only — Zillow publishes none for counties or states.", levels: ["metro"] },
  { key: "risk", g: 4, label: "Correction risk", fmt: F.score, scale: "seq", src: "this page", desc: "Percentile score within the level: overvaluation 35%, inventory vs 2017–19 20%, inventory growth 15%, price-cut share 15%, days-on-market growth 15%." },
];
const POPULAR = ["value", "valueYoy", "overvalued", "invVs1719", "cut", "payPct", "risk"];
const TABLE_COLS = ["value", "valueYoy", "overvalued", "invVs1719", "cut", "risk"];
const PRESETS = [
  ["Most overvalued", "overvalued", "desc"], ["Least overvalued", "overvalued", "asc"], ["Cheapest", "value", "asc"], ["Most expensive", "value", "desc"],
  ["Highest correction risk", "risk", "desc"], ["Inventory building", "invVs1719", "desc"], ["Most price cuts", "cut", "desc"], ["Fastest growing", "popG5", "desc"],
];
const LEVELS = [["state", "States"], ["metro", "Metros"], ["county", "Counties"]];
const POP_FLOORS = [[0, "any size"], [10000, "10K+"], [50000, "50K+"], [250000, "250K+"], [1000000, "1M+"]];

const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: "var(--text-muted)", fontFamily: fonts.mono, lineHeight: 1.5 };
const pill = on => ({
  padding: "4px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", fontSize: 11, fontFamily: fonts.heading,
  background: on ? "rgba(129,140,248,0.18)" : "var(--bg-subtle)", border: `1px solid ${on ? "#818cf8" : "var(--border-subtle)"}`,
  color: on ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: on ? 600 : 400,
});
const select = { background: "var(--bg-subtle)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "5px 8px", fontSize: 11, fontFamily: fonts.mono, maxWidth: "100%" };

const quantile = (sorted, p) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
// five equal-count bins for magnitude; for diverging, a neutral band holding the
// 15% of areas nearest zero and three bins per arm split at the median and the
// 85th percentile of the absolute values — the real breaks go in the legend
function binner(values, scale) {
  const v = values.filter(fin).sort((a, b) => a - b);
  if (!v.length) return null;
  if (scale === "div") {
    const abs = v.map(Math.abs).sort((a, b) => a - b);
    const t = [quantile(abs, 0.15), quantile(abs, 0.5), quantile(abs, 0.85)];
    const bin = x => (x < -t[2] ? 0 : x < -t[1] ? 1 : x < -t[0] ? 2 : x <= t[0] ? 3 : x <= t[1] ? 4 : x <= t[2] ? 5 : 6);
    return { kind: "div", t, bin, min: v[0], max: v[v.length - 1], n: v.length };
  }
  const breaks = [0.2, 0.4, 0.6, 0.8].map(p => quantile(v, p));
  const bin = x => { let i = 0; while (i < breaks.length && x > breaks[i]) i++; return i; };
  return { kind: "seq", breaks, bin, min: v[0], max: v[v.length - 1], n: v.length };
}

// ── shared state: theme, preferences, the data and geometry caches ──
function useTheme() {
  const read = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const [t, setT] = useState(read);
  useEffect(() => {
    const o = new MutationObserver(() => setT(read()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => o.disconnect();
  }, []);
  return t;
}
const PREFS = "marketmap:prefs";
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || "{}") || {}; } catch { return {}; } };
const writePrefs = p => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* private window */ } };

const levelCache = {}, historyCache = {};
let geoPromise = null;
function loadGeometry() {
  if (!geoPromise) {
    geoPromise = fetch(TOPO_URL).then(r => { if (!r.ok) throw new Error(`map outlines HTTP ${r.status}`); return r.json(); }).then(topo => {
      const path = geoPath();
      const counties = feature(topo, topo.objects.counties).features, states = feature(topo, topo.objects.states).features;
      return {
        topo, path,
        county: new Map(counties.map(f => [f.id, path(f)])),
        state: new Map(states.map(f => [f.id, path(f)])),
        stateBounds: new Map(states.map(f => [f.id, path.bounds(f)])),
        stateName: new Map(states.map(f => [f.id, f.properties?.name])),
        countyGeom: new Map(topo.objects.counties.geometries.map(g => [g.id, g])),
        nation: path(feature(topo, topo.objects.nation)),
        stateLines: path(mesh(topo, topo.objects.states, (a, b) => a !== b)),
      };
    });
    geoPromise.catch(() => { geoPromise = null; });
  }
  return geoPromise;
}
function useGeometry() {
  const [g, setG] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { let live = true; loadGeometry().then(x => live && setG(x)).catch(e => live && setErr(e.message)); return () => { live = false; }; }, []);
  return { geo: g, geoError: err };
}
function useLevel(level) {
  const [state, setState] = useState(() => (levelCache[level] ? { data: levelCache[level] } : {}));
  useEffect(() => {
    let live = true;
    if (levelCache[level]) { setState({ data: levelCache[level] }); return; }
    setState({});
    fetch(`/api/market-map/${level}`).then(async r => { const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`); return d; })
      .then(d => { levelCache[level] = d; if (live) setState({ data: d }); })
      .catch(e => live && setState({ error: e.message }));
    return () => { live = false; };
  }, [level]);
  return state;
}
function useHistory(st) {
  const [h, setH] = useState(() => historyCache[st] || null);
  useEffect(() => {
    if (!st) { setH(null); return; }
    if (historyCache[st]) { setH(historyCache[st]); return; }
    let live = true;
    setH(null);
    fetch(`/api/market-map/history/${st}`).then(r => (r.ok ? r.json() : null)).then(d => { if (d && !d.error) { historyCache[st] = d; if (live) setH(d); } }).catch(() => {});
    return () => { live = false; };
  }, [st]);
  return h;
}

// ── the component ──
export default function MarketMap({ extras }) {
  const theme = useTheme(), pal = RAMPS[theme];
  const prefs = useMemo(readPrefs, []);
  const [level, setLevel] = useState(LEVELS.some(l => l[0] === prefs.level) ? prefs.level : "metro");
  const [metric, setMetric] = useState(prefs.metric || "overvalued");
  const [mode, setMode] = useState(prefs.mode === "table" ? "table" : "map");
  const [focusSt, setFocusSt] = useState("");
  const [selected, setSelected] = useState(null);
  const [minPop, setMinPop] = useState(prefs.minPop ?? 50000);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: null, dir: "desc" });
  const [showAll, setShowAll] = useState(false);
  const { geo, geoError } = useGeometry();
  const { data, error } = useLevel(level);
  useEffect(() => writePrefs({ level, metric, mode, minPop }), [level, metric, mode, minPop]);
  useEffect(() => { setSelected(null); setShowAll(false); }, [level]);
  // a new metric sorts the table by itself, unless a preset set both
  useEffect(() => { setSort(s => (s.key === metric ? s : { key: null, dir: "desc" })); }, [metric]);
  const phone = useIsPhone();

  // the state-only metrics carried over from the old State Map (Redfin, FHFA, build cost)
  const extraDefs = useMemo(() => (extras?.metrics || []).map(m => ({
    key: m.key, g: 5, label: m.label, fmt: m.fmt, scale: /yoy/i.test(m.key) ? "div" : "seq", src: [m.src, m.cadence].filter(Boolean).join(" · "),
    desc: m.desc || "State level only.", levels: ["state"], extra: true,
  })), [extras]);
  const defs = useMemo(() => [...METRICS, ...extraDefs].filter(m => !m.levels || m.levels.includes(level)), [extraDefs, level]);
  const cfg = defs.find(m => m.key === metric) || defs.find(m => m.key === "value");
  useEffect(() => { if (cfg && cfg.key !== metric) setMetric(cfg.key); }, [cfg, metric]);
  // keyed on the metric alone: the extras object changes every time a fetch lands
  const needRef = useRef(null);
  needRef.current = extras?.onNeed;
  useEffect(() => { if (cfg?.extra) needRef.current?.(cfg.key); }, [cfg?.key, cfg?.extra]);

  const n = data?.ids.length || 0;
  const rowOf = useMemo(() => new Map((data?.ids || []).map((id, i) => [id, i])), [data]);
  const valuesFor = useCallback(def => {
    if (!data || !def) return [];
    if (def.extra) { const c = extras?.cache?.[def.key] || {}; return data.st.map(st => (fin(c[st]?.v) ? c[st].v : null)); }
    return data.cols[def.key] || [];
  }, [data, extras]);
  const values = useMemo(() => valuesFor(cfg), [valuesFor, cfg]);
  const scale = useMemo(() => (cfg ? binner(values, cfg.scale) : null), [values, cfg]);
  // rank 1 = highest value
  const rankOf = useMemo(() => {
    const idx = values.map((v, i) => [v, i]).filter(([v]) => fin(v)).sort((a, b) => b[0] - a[0]);
    const r = new Array(values.length).fill(null);
    idx.forEach(([, i], k) => { r[i] = k + 1; });
    return { r, count: idx.length };
  }, [values]);

  const fillOf = useCallback(i => {
    const v = values[i];
    if (!fin(v) || !scale) return pal.none;
    return scale.kind === "div" ? pal.div[scale.bin(v)] : pal.seq[scale.bin(v)];
  }, [values, scale, pal]);

  // outlines for the current level, keyed by area id
  const paths = useMemo(() => {
    if (!geo || !data) return null;
    if (level === "county") return geo.county;
    if (level === "state") return geo.state;
    const out = new Map();
    data.ids.forEach((id, i) => {
      const geoms = (data.members?.[i] || []).map(c => geo.countyGeom.get(c)).filter(Boolean);
      if (geoms.length) out.set(id, geo.path(merge(geo.topo, geoms)));
    });
    return out;
  }, [geo, data, level]);

  // ── zoom and pan: the viewBox is the camera ──
  const svgRef = useRef(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  const zoomTo = useCallback((cx, cy, factor) => setVb(v => {
    const w = Math.min(W, Math.max(W / 40, v.w / factor)), h = (w * H) / W;
    return { x: cx - ((cx - v.x) * w) / v.w, y: cy - ((cy - v.y) * h) / v.h, w, h };
  }), []);
  const toSvg = useCallback((clientX, clientY) => {
    const el = svgRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: vb.x + ((clientX - r.left) / r.width) * vb.w, y: vb.y + ((clientY - r.top) / r.height) * vb.h };
  }, [vb]);
  useEffect(() => {
    const el = svgRef.current; if (!el) return undefined;
    // the page scrolls normally; Ctrl / ⌘ + wheel zooms the map
    const onWheel = e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY); if (p) zoomTo(p.x, p.y, e.deltaY < 0 ? 1.35 : 1 / 1.35);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toSvg, zoomTo, mode, paths]);
  useEffect(() => {
    if (!focusSt || !geo) { setVb({ x: 0, y: 0, w: W, h: H }); return; }
    const b = geo.stateBounds.get(focusSt); if (!b) return;
    const [[x0, y0], [x1, y1]] = b, pad = 0.08;
    let w = (x1 - x0) * (1 + pad * 2), h = (y1 - y0) * (1 + pad * 2);
    if (w / h > W / H) h = (w * H) / W; else w = (h * W) / H;
    setVb({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
  }, [focusSt, geo]);

  const [tip, setTip] = useState(null);
  const drag = useRef(null);
  const onPointerDown = e => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, vb, moved: false, id: e.target.getAttribute?.("data-id") }; };
  const onPointerMove = e => {
    const d = drag.current;
    if (d && (d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4)) {
      if (!d.moved) { d.moved = true; e.currentTarget.setPointerCapture?.(e.pointerId); setTip(null); }
      const r = svgRef.current.getBoundingClientRect();
      setVb({ ...d.vb, x: d.vb.x - ((e.clientX - d.x) / r.width) * d.vb.w, y: d.vb.y - ((e.clientY - d.y) / r.height) * d.vb.h });
      return;
    }
    const id = e.target.getAttribute?.("data-id");
    setTip(id ? { id, x: e.clientX, y: e.clientY } : null);
  };
  const onPointerUp = () => {
    const d = drag.current; drag.current = null;
    if (d && !d.moved) setSelected(s => (d.id && s !== d.id ? d.id : d.id ? null : s));
  };
  const onDoubleClick = e => { const p = toSvg(e.clientX, e.clientY); if (p) zoomTo(p.x, p.y, 2); };
  const zoomed = vb.w < W - 1;

  // the filled layer is memoised so hover and zoom do not re-render 3,000 paths
  const layer = useMemo(() => {
    if (!paths || !data) return null;
    const stroke = level === "county" ? 0.3 : 0.6;
    return data.ids.map((id, i) => {
      const d = paths.get(id);
      return d ? <path key={id} d={d} data-id={id} fill={fillOf(i)} stroke={pal.edge} strokeWidth={stroke} vectorEffect="non-scaling-stroke" /> : null;
    });
  }, [paths, data, fillOf, pal, level]);

  // ── table rows ──
  const tableKeys = useMemo(() => [cfg?.key, ...TABLE_COLS.filter(k => k !== cfg?.key && defs.some(d => d.key === k))].filter(Boolean), [cfg, defs]);
  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const sk = sort.key || cfg?.key, sv = sk === cfg?.key ? values : data.cols[sk] || [];
    const out = [];
    for (let i = 0; i < n; i++) {
      if (focusSt && data.st[i] !== stAbbrOf(focusSt)) continue;
      const pop = data.cols.pop[i];
      if (minPop && level !== "state" && !(pop >= minPop)) continue;
      if (q && !data.names[i].toLowerCase().includes(q)) continue;
      out.push(i);
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      const x = sv[a], y = sv[b];
      if (!fin(x) && !fin(y)) return data.names[a].localeCompare(data.names[b]);
      if (!fin(x)) return 1; if (!fin(y)) return -1;
      return (x - y) * dir;
    });
    return out;
  }, [data, n, query, sort, cfg, values, focusSt, minPop, level]);

  const applyPreset = (key, dir) => { setMetric(key); setSort({ key, dir }); setShowAll(false); };
  const downloadCsv = () => {
    if (!data) return;
    const keys = defs.filter(d => !d.extra).map(d => d.key);
    const esc = s => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
    const lines = [["id", "name", "state", ...keys].join(",")];
    for (const i of rows) lines.push([data.ids[i], esc(data.names[i]), data.st[i] || "", ...keys.map(k => (fin(data.cols[k]?.[i]) ? data.cols[k][i] : ""))].join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `market-map-${level}-${data.asOf?.zhvi || "latest"}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const fmt = v => (fin(v) ? cfg.fmt(v) : "—");
  const selIdx = selected != null ? rowOf.get(selected) : null;
  const hoverIdx = tip ? rowOf.get(tip.id) : null;

  return (<>
    {/* controls: level, popular metrics, the full catalogue, state focus, map/table */}
    <div style={{ ...card, marginBottom: 12, display: "grid", gap: 9 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }} role="group" aria-label="Geography">
          {LEVELS.map(([k, t]) => <button key={k} aria-pressed={level === k} onClick={() => setLevel(k)} style={pill(level === k)}>{t}</button>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <select aria-label="Focus on a state" value={focusSt} onChange={e => setFocusSt(e.target.value)} style={select}>
            <option value="">All states</option>
            {geo && [...geo.stateName].sort((a, b) => a[1].localeCompare(b[1])).map(([f, nm]) => <option key={f} value={f}>{nm}</option>)}
          </select>
          <div style={{ display: "flex", gap: 4 }} role="group" aria-label="View">
            {[["map", "Map"], ["table", "Table"]].map(([k, t]) => <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)} style={pill(mode === k)}>{t}</button>)}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        <span style={{ ...label, marginRight: 4 }}>Popular</span>
        {POPULAR.filter(k => defs.some(d => d.key === k)).map(k => { const d = defs.find(x => x.key === k); return <button key={k} onClick={() => setMetric(k)} style={pill(cfg?.key === k)}>{d.label}</button>; })}
        <select aria-label="All metrics" value={cfg?.key || ""} onChange={e => setMetric(e.target.value)} style={{ ...select, marginLeft: "auto" }}>
          {[...GROUPS, "State only"].map((gname, g) => {
            const items = defs.filter(d => d.g === g);
            return items.length ? <optgroup key={gname} label={gname}>{items.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup> : null;
          })}
        </select>
      </div>
      {cfg && <div style={note}><strong style={{ color: "var(--text-secondary)" }}>{cfg.label}.</strong> {cfg.desc} <span style={{ whiteSpace: "nowrap" }}>Source: {cfg.src}.</span></div>}
    </div>

    {error && <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono }}>The market map could not load: {error}</div>}
    {geoError && <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "var(--text-secondary)", fontFamily: fonts.mono }}>Map outlines could not load ({geoError}); the table still works.</div>}
    {!data && !error && <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "var(--text-muted)", fontFamily: fonts.mono }}>Building the market map — the first load of the day downloads Zillow's and Realtor.com's latest files (about 25 MB)…</div>}

    {data && (
      <div style={{ display: "grid", gridTemplateColumns: selIdx != null && !phone ? "minmax(0, 1fr) minmax(0, 360px)" : "minmax(0, 1fr)", gap: 12, alignItems: "start", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          {mode === "map" ? (
            <div style={{ ...card, padding: "10px 12px", position: "relative" }}>
              <Headline data={data} cfg={cfg} values={values} rankOf={rankOf} level={level} fmt={fmt} nat={cfg?.extra ? extras?.cache?.[cfg.key]?._national?.v : data.national?.[cfg?.key]} />
              <div style={{ position: "relative" }}>
                {!geo && !geoError && <div style={{ ...note, padding: 30, textAlign: "center" }}>Loading map outlines…</div>}
                {geo && (
                  <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={`${cfg?.label} by ${level}`}
                    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { setTip(null); }} onDoubleClick={onDoubleClick}
                    style={{ width: "100%", height: "auto", display: "block", cursor: drag.current?.moved ? "grabbing" : "pointer", touchAction: zoomed ? "none" : "pan-y", userSelect: "none" }}>
                    {level === "metro" && <path d={geo.nation} fill={pal.none} stroke="none" pointerEvents="none" />}
                    <g>{layer}</g>
                    <path d={geo.stateLines} fill="none" stroke={pal.line} strokeWidth={level === "state" ? 0.6 : 0.8} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    {hoverIdx != null && paths?.get(tip.id) && <path d={paths.get(tip.id)} fill="none" stroke={pal.focus} strokeWidth={1.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                    {selIdx != null && paths?.get(selected) && <path d={paths.get(selected)} fill="none" stroke={pal.focus} strokeWidth={2.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                  </svg>
                )}
                {geo && (
                  <div style={{ position: "absolute", right: 4, top: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                    {[["+", "Zoom in", () => zoomTo(vb.x + vb.w / 2, vb.y + vb.h / 2, 1.6)], ["−", "Zoom out", () => zoomTo(vb.x + vb.w / 2, vb.y + vb.h / 2, 1 / 1.6)], ["⟲", "Reset view", () => { setFocusSt(""); setVb({ x: 0, y: 0, w: W, h: H }); }]].map(([t, aria, fn]) => (
                      <button key={aria} aria-label={aria} title={aria} onClick={fn} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border-subtle)", background: "var(--card-bg)", color: "var(--text-primary)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>{t}</button>
                    ))}
                  </div>
                )}
              </div>
              <Legend scale={scale} cfg={cfg} values={values} pal={pal} level={level} />
              <div style={{ ...note, marginTop: 4 }}>Drag to pan, double-click or use + to zoom (Ctrl / ⌘ + scroll also zooms), click an area for its scorecard.</div>
              {tip && hoverIdx != null && (
                <div style={{ position: "fixed", left: tip.x + 14, top: tip.y - 12, background: "var(--tooltip-bg)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "7px 11px", pointerEvents: "none", zIndex: 50, fontFamily: fonts.mono, fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap", boxShadow: "0 6px 20px rgba(0,0,0,0.3)" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{fmt(values[hoverIdx])}</div>
                  <div>{data.names[hoverIdx]}{level === "county" && data.st[hoverIdx] ? `, ${data.st[hoverIdx]}` : ""}{level === "metro" && data.kind?.[hoverIdx] === "micro" ? " (micro)" : ""}</div>
                  {rankOf.r[hoverIdx] && <div style={{ color: "var(--text-muted)" }}>#{rankOf.r[hoverIdx].toLocaleString()} of {rankOf.count.toLocaleString()}, highest first</div>}
                </div>
              )}
            </div>
          ) : (
            <TableView data={data} rows={rows} tableKeys={tableKeys} defs={defs} cfg={cfg} values={values} sort={sort} setSort={setSort}
              showAll={showAll} setShowAll={setShowAll} selected={selected} setSelected={setSelected} level={level}
              query={query} setQuery={setQuery} minPop={minPop} setMinPop={setMinPop} applyPreset={applyPreset} downloadCsv={downloadCsv} />
          )}
        </div>
        {selIdx != null && (
          <Scorecard data={data} i={selIdx} level={level} defs={defs} valuesFor={valuesFor} cfg={cfg} setMetric={setMetric} onClose={() => setSelected(null)} extras={extras} />
        )}
      </div>
    )}

    {data && <Method data={data} level={level} />}
  </>);
}

const stAbbrOf = fips => FIPS_ABBR[fips] || null;
const FIPS_ABBR = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };

// the U.S. reading and the extremes, above the map
function Headline({ data, cfg, values, rankOf, level, fmt, nat }) {
  if (!cfg) return null;
  const order = values.map((v, i) => [v, i]).filter(([v]) => fin(v)).sort((a, b) => b[0] - a[0]);
  const hi = order[0], lo = order[order.length - 1];
  const where = i => `${data.names[i]}${level === "county" && data.st[i] ? `, ${data.st[i]}` : ""}`;
  const sv = values.filter(fin).sort((a, b) => a - b), med = quantile(sv, 0.5);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "baseline", marginBottom: 6, paddingRight: 36 }}>
      <div>
        <div style={label}>{cfg.label} · U.S.</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>{fin(nat) ? fmt(nat) : "—"}</div>
      </div>
      {[["Median " + (level === "county" ? "county" : level), fin(med) ? fmt(med) : "—"], ["Highest", hi ? `${fmt(hi[0])} · ${where(hi[1])}` : "—"], ["Lowest", lo ? `${fmt(lo[0])} · ${where(lo[1])}` : "—"], ["With a reading", `${rankOf.count.toLocaleString()} of ${values.length.toLocaleString()}`]].map(([t, v]) => (
        <div key={t} style={{ minWidth: 0 }}>
          <div style={label}>{t}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-secondary)", fontFamily: fonts.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// binned legend: swatch, the real breakpoint, and how many areas sit in each bin
function Legend({ scale, cfg, values, pal, level }) {
  if (!scale || !cfg) return null;
  const f = v => (fin(v) ? cfg.fmt(v) : "—");
  const counts = new Array(scale.kind === "div" ? 7 : 5).fill(0);
  for (const v of values) if (fin(v)) counts[scale.bin(v)]++;
  const max = Math.max(...counts, 1);
  const ramp = scale.kind === "div" ? pal.div : pal.seq;
  const t = scale.t;
  const labels = scale.kind === "div"
    ? [`< −${f(t[2]).replace(/^[+−]/, "")}`, `to −${f(t[1]).replace(/^[+−]/, "")}`, `to −${f(t[0]).replace(/^[+−]/, "")}`, `±${f(t[0]).replace(/^[+−]/, "")}`, `to +${f(t[1]).replace(/^[+−]/, "")}`, `to +${f(t[2]).replace(/^[+−]/, "")}`, `> +${f(t[2]).replace(/^[+−]/, "")}`]
    : [`≤ ${f(scale.breaks[0])}`, `to ${f(scale.breaks[1])}`, `to ${f(scale.breaks[2])}`, `to ${f(scale.breaks[3])}`, `> ${f(scale.breaks[3])}`];
  const unit = level === "county" ? "counties" : level === "metro" ? "metros" : "states";
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
        {ramp.map((c, i) => (
          <div key={c} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height: 16, display: "flex", alignItems: "flex-end" }}><div style={{ width: "100%", height: `${Math.max(8, (counts[i] / max) * 100)}%`, background: c, opacity: 0.35, borderRadius: "2px 2px 0 0" }} /></div>
            <div style={{ height: 9, background: c, borderRadius: 2 }} />
            <div style={{ fontSize: 8.5, color: "var(--text-secondary)", fontFamily: fonts.mono, marginTop: 3, lineHeight: 1.25, overflowWrap: "anywhere" }}>{labels[i]}</div>
            <div style={{ fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono }}>{counts[i].toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div style={{ ...note, marginTop: 4 }}>
        {scale.kind === "div"
          ? `Blue is below zero, orange above, grey the ${counts[3].toLocaleString()} ${unit} nearest zero; each arm splits at the median and the 85th percentile of the distance from zero.`
          : `Five equal-count bins, ${pal === RAMPS.dark ? "deep indigo low to pale high" : "pale low to deep indigo high"}; the labels are the real breaks and the bars count the ${unit} in each.`} Grey-slate areas have no reading.
      </div>
    </div>
  );
}

function TableView({ data, rows, tableKeys, defs, cfg, values, sort, setSort, showAll, setShowAll, selected, setSelected, level, query, setQuery, minPop, setMinPop, applyPreset, downloadCsv }) {
  const shown = showAll ? rows : rows.slice(0, 100);
  const dOf = k => defs.find(d => d.key === k);
  const sk = sort.key || cfg?.key;
  const th = { padding: "6px 8px", fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none", textAlign: "right" };
  const td = { padding: "5px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "var(--text-secondary)", whiteSpace: "nowrap" };
  const click = k => setSort(s => ({ key: k, dir: s.key === k || (!s.key && k === cfg?.key) ? (s.dir === "desc" ? "asc" : "desc") : "desc" }));
  const arrow = k => (sk === k ? (sort.dir === "desc" ? " ▾" : " ▴") : "");
  return (
    <div style={{ ...card, padding: "10px 12px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
        {PRESETS.filter(([, k]) => defs.some(d => d.key === k)).map(([t, k, dir]) => <button key={t} onClick={() => applyPreset(k, dir)} style={pill(sk === k && sort.dir === dir)}>{t}</button>)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Find a ${level}…`} aria-label="Search by name" style={{ ...select, width: 170 }} />
        {level !== "state" && (
          <label style={{ ...note, display: "flex", gap: 6, alignItems: "center" }}>Population
            <select value={minPop} onChange={e => setMinPop(Number(e.target.value))} style={select}>{POP_FLOORS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          </label>
        )}
        <span style={note}>{rows.length.toLocaleString()} {level === "county" ? "counties" : level === "metro" ? "metros" : "states"}</span>
        <button onClick={downloadCsv} style={{ ...pill(false), marginLeft: "auto" }}>Download CSV</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left", cursor: "default" }}>{level === "county" ? "County" : level === "metro" ? "Metro" : "State"}</th>
            <th style={th} onClick={() => click("pop")}>Population{arrow("pop")}</th>
            {tableKeys.map(k => <th key={k} style={{ ...th, color: k === cfg?.key ? "var(--text-primary)" : th.color }} onClick={() => click(k)}>{dOf(k)?.label}{arrow(k)}</th>)}
          </tr></thead>
          <tbody>
            {shown.map(i => {
              const id = data.ids[i], on = selected === id;
              return (
                <tr key={id} onClick={() => setSelected(on ? null : id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border-subtle)", background: on ? "rgba(129,140,248,0.10)" : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", color: "var(--text-primary)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {data.names[i]}{level !== "state" && data.st[i] ? <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 9 }}>{data.st[i]}{level === "metro" && data.kind?.[i] === "micro" ? " · micro" : ""}</span> : null}
                  </td>
                  <td style={td}>{fin(data.cols.pop[i]) ? Math.round(data.cols.pop[i]).toLocaleString() : "—"}</td>
                  {tableKeys.map(k => { const def = dOf(k), v = k === cfg?.key ? values[i] : data.cols[k]?.[i]; return <td key={k} style={{ ...td, color: k === cfg?.key ? "var(--text-primary)" : td.color, fontWeight: k === cfg?.key ? 700 : 400 }}>{fin(v) && def ? def.fmt(v) : "—"}</td>; })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 100 && <button onClick={() => setShowAll(s => !s)} style={{ ...pill(false), marginTop: 8 }}>{showAll ? "Show the first 100" : `Show all ${rows.length.toLocaleString()}`}</button>}
    </div>
  );
}

// ── the scorecard: every metric for one area, with U.S. reading and percentile ──
function Scorecard({ data, i, level, defs, valuesFor, cfg, setMetric, onClose, extras }) {
  const id = data.ids[i], st = data.st[i];
  const history = useHistory(st);
  const h = history?.areas?.[id];
  const pctl = useMemo(() => {
    const out = {};
    for (const d of defs) {
      const vals = valuesFor(d), v = vals[i];
      if (!fin(v)) continue;
      let below = 0, eq = 0, cnt = 0;
      for (const x of vals) if (fin(x)) { cnt++; if (x < v) below++; else if (x === v) eq++; }
      out[d.key] = { v, p: cnt > 1 ? Math.round(((below + (eq - 1) / 2) / (cnt - 1)) * 100) : null };
    }
    return out;
  }, [defs, valuesFor, i]);
  const risk = data.cols.risk?.[i], parts = data.parts?.[i];
  const start = history?.start?.[level];
  const series = useMemo(() => {
    if (!h?.z || !start) return [];
    const [y0, m0] = start.split("-").map(Number);
    return h.z.map((v, k) => { const mm = m0 - 1 + k; return { d: `${y0 + Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, "0")}`, v }; }).filter(p => fin(p.v));
  }, [h, start]);
  const ratio = (h?.ratio || []).map(([y, r]) => ({ d: String(y), r })).concat(fin(h?.now) ? [{ d: "now", r: h.now }] : []);
  const unit = level === "county" ? "counties" : level === "metro" ? "metros" : "states";
  const scoreParts = data.score?.parts || [];
  const partLabel = { overvalued: "Overvaluation", invVs1719: "Inventory vs 2017–19", activeYoy: "Inventory growth", cut: "Price-cut share", domYoy: "Days-on-market growth" };
  return (
    <div style={{ ...card, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={label}>{level === "metro" ? (data.kind?.[i] === "micro" ? "Micropolitan area" : "Metro area") : level === "county" ? `County · ${st}` : "State"}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, lineHeight: 1.2 }}>{data.names[i]}</div>
          {fin(data.cols.pop[i]) && <div style={note}>Population {Math.round(data.cols.pop[i]).toLocaleString()}</div>}
        </div>
        <button onClick={onClose} aria-label="Close scorecard" style={{ border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)", borderRadius: 7, cursor: "pointer", width: 26, height: 26, flexShrink: 0 }}>×</button>
      </div>

      <div style={{ marginTop: 10, padding: "9px 10px", borderRadius: 10, background: "var(--bg-subtle)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={label}>Correction risk</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{fin(risk) ? `${Math.round(risk)}` : "—"}<span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}> / 100</span></span>
        </div>
        {fin(risk) ? (
          <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
            {scoreParts.map((p, k) => (
              <div key={p.key} title={`${partLabel[p.key]}: higher than ${parts?.[k] ?? "—"}% of scored ${unit}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 28px", gap: 6, alignItems: "center", fontSize: 9.5, fontFamily: fonts.mono, color: "var(--text-secondary)" }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{partLabel[p.key]} · {p.w}%</span>
                <div style={{ position: "relative", height: 5, background: "var(--border-subtle)", borderRadius: 3 }}>{fin(parts?.[k]) && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${parts[k]}%`, background: "#818cf8", borderRadius: 3 }} />}</div>
                <span style={{ textAlign: "right", color: "var(--text-primary)" }}>{fin(parts?.[k]) ? parts[k] : "—"}</span>
              </div>
            ))}
            <div style={{ ...note, marginTop: 2 }}>Each bar is the area's percentile among scored {unit} on that input; the score is their weighted average. A relative ranking, not a forecast.</div>
          </div>
        ) : <div style={{ ...note, marginTop: 4 }}>Not scored: it needs an Overvalued % reading (Zillow values back to the 2000s) and at least {data.score?.minListings ?? 50} active listings.</div>}
      </div>

      {series.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <div style={label}>Typical home value ($K) since {series[0].d.slice(0, 4)}</div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={series} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 9, fill: "var(--text-muted)", fontFamily: fonts.mono }} tickFormatter={d => d.slice(0, 4)} minTickGap={28} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)", fontFamily: fonts.mono }} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.mono }} formatter={v => [`$${Number(v).toFixed(0)}K`, "Home value"]} />
              <Line type="monotone" dataKey="v" stroke="#818cf8" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {ratio.length > 3 && (
        <div style={{ marginTop: 6 }}>
          <div style={label}>Value-to-income {fin(h?.base) ? `· 2000–19 average ${h.base.toFixed(1)}×` : ""}</div>
          <ResponsiveContainer width="100%" height={110}>
            <LineChart data={ratio} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 9, fill: "var(--text-muted)", fontFamily: fonts.mono }} minTickGap={22} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)", fontFamily: fonts.mono }} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} tickFormatter={v => `${Number(v).toFixed(1)}×`} />
              <Tooltip contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 11, fontFamily: fonts.mono }} formatter={v => [`${Number(v).toFixed(2)}×`, "Value ÷ income"]} />
              {fin(h?.base) && <ReferenceLine y={h.base} stroke="var(--text-muted)" strokeDasharray="4 3" />}
              <Line type="monotone" dataKey="r" stroke="#818cf8" strokeWidth={2} dot={{ r: 1.5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={note}>Annual average value ÷ that year's SAIPE income; "now" carries income forward. The dashed line is the average the Overvalued % compares against.</div>
        </div>
      )}
      {!history && <div style={{ ...note, marginTop: 8 }}>Loading the price history…</div>}

      {[[0, GROUPS[0]], [1, GROUPS[1]], [2, GROUPS[2]], [3, GROUPS[3]], [5, "State only"]].map(([g, gname]) => {
        const items = defs.filter(d => d.g === g && (pctl[d.key] || !d.extra));
        if (!items.length) return null;
        return (
          <div key={gname} style={{ marginTop: 10 }}>
            <div style={{ ...label, marginBottom: 3 }}>{gname}</div>
            {items.map(d => {
              const r = pctl[d.key], nat = d.extra ? extras?.cache?.[d.key]?._national?.v : data.national?.[d.key], on = cfg?.key === d.key;
              return (
                <button key={d.key} onClick={() => setMetric(d.key)} title={`Map ${d.label}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto 44px", gap: 6, alignItems: "center", width: "100%", textAlign: "left", background: on ? "rgba(129,140,248,0.10)" : "transparent", border: "none", borderTop: "1px solid var(--border-subtle)", padding: "3px 2px", cursor: "pointer", fontFamily: fonts.mono }}>
                  <span style={{ fontSize: 10.5, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-primary)", fontWeight: 600, whiteSpace: "nowrap", textAlign: "right" }}>
                    {r ? d.fmt(r.v) : "—"}{fin(nat) && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · US {d.fmt(nat)}</span>}
                  </span>
                  <span title={r?.p != null ? `higher than ${r.p}% of ${unit}` : ""} style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "right" }}>{r?.p != null ? `p${r.p}` : ""}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      <div style={{ ...note, marginTop: 8 }}>p = percentile among {unit} (p90 = higher than 90% of them). Click a row to map it.</div>
      {level === "metro" && <div style={{ ...note, marginTop: 4 }}>For monthly listing and price histories on the larger metros, Metro Markets → Local market detail keeps the time series; this card is the cross-section.</div>}
    </div>
  );
}

function Method({ data, level }) {
  const a = data.asOf || {}, s = data.assume || {}, c = a.census || {};
  const mon = d => (d ? new Date(`${d.slice(0, 7)}-15T00:00:00`).toLocaleString("en-US", { month: "short", year: "numeric" }) : "—");
  return (
    <details style={{ ...card, marginBottom: 14 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, fontFamily: fonts.heading, fontWeight: 600, color: "var(--text-primary)" }}>Sources, method and caveats</summary>
      <div style={{ ...note, marginTop: 8, display: "grid", gap: 6 }}>
        <div><strong>As of:</strong> Zillow home values {mon(a.zhvi)}, rents {mon(a.zori)}; Realtor.com listings {mon(a.realtor)}; 30-year rate {fin(a.rate?.v) ? `${a.rate.v.toFixed(2)}%` : "—"} (Freddie Mac, {a.rate?.d || "—"}); Census: income {c.saipe} (SAIPE), population {c.pep} (estimates), housing {c.acs}, permits {c.bps}, metro definitions {c.cbsa}. Annual figures are refreshed with <code>node scripts/refresh-seeds.mjs market-map</code>.</div>
        <div><strong>Overvalued %</strong> = today's home value ÷ income, against the area's own average of that ratio over {s.base?.[0]}–{s.base?.[1]} (needs twelve of those years). Income is SAIPE's latest year carried to the latest home-value month at the area's own five-year pace (0–{Math.round((s.incomeGrowthCap || 0) * 100)}% a year). Metros use the household-weighted mean of their counties' SAIPE medians, since SAIPE has no metro estimates.</div>
        <div><strong>Payment</strong>: {Math.round((s.down || 0) * 100)}% down, 30-year fixed at the rate above, plus property tax at the ACS effective rate; no insurance or HOA. <strong>Salary to afford</strong> puts that at {Math.round((s.afford || 0) * 100)}% of gross income. <strong>Cap rate</strong>: rent less {Math.round((s.opex || 0) * 100)}% for vacancy, management and upkeep, less tax and insurance at {((s.insurance || 0) * 100).toFixed(1)}% of value.</div>
        <div><strong>Correction risk</strong> ranks each {level} against the others: {data.score?.parts?.map(p => `${p.key} ${p.w}%`).join(", ")}. Only areas with an Overvalued % reading and at least {data.score?.minListings} active listings are scored — the first keeps every score measuring the same thing, the second keeps small counties' month-to-month noise out. It is a relative screen for where to look, not a forecast.</div>
        <div><strong>Caveats:</strong> Zillow covers most but not all counties; ZORI rents cover about 1,400 counties and most metros. Realtor.com reports Connecticut by its 2022 planning regions while the outlines and Zillow use the old counties, so Connecticut counties show Zillow numbers only. Metros are matched to Zillow by principal city, and Zillow metros the 2023 definitions merged away keep only Realtor.com and Census figures. ACS figures are five-year averages. Metro Markets keeps the larger metros' monthly histories; this map is the cross-section.</div>
        {data.warnings?.length > 0 && <div><strong>This build:</strong> {data.warnings.join(" · ")}</div>}
      </div>
    </details>
  );
}
