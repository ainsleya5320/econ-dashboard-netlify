import { FRED_BASE, FMP_BASE } from './constants.js';
import { normalizeChain } from './optionsAnalysis.js';

async function fetchWithTimeout(url, { timeoutMs = 15000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, { label = "Request", timeoutMs = 15000, retries = 0, retryDelayMs = 1000, ...options } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetchWithTimeout(url, { timeoutMs, ...options });
      if (r.status === 429 && attempt < retries) {
        await new Promise(res => setTimeout(res, retryDelayMs));
        continue;
      }
      if (!r.ok) throw new Error(`${label} failed with ${r.status}`);
      return r.json();
    } catch (e) {
      lastError = e;
      if (attempt < retries) await new Promise(res => setTimeout(res, retryDelayMs));
    }
  }
  throw lastError;
}

async function fetchFred(id, key, limit = 12, _retries = 3) {
  // Netlify fork: one baked file per series, served at this exact path. No
  // redirect rule is involved, so `npm run preview` exercises the same URLs the
  // deployed site will. The dev server answers this shape as well as the
  // original query form.
  const d = await fetchJson(`${FRED_BASE}/${encodeURIComponent(id)}`, {
    label: `FRED ${id}`,
    retries: _retries,
    retryDelayMs: 2000,
  });
  // The dev relay applied `limit` server-side. The baked per-series files hold
  // the full history, so trim here — newest-first on the way in, oldest-first out.
  const obs = d.observations.filter(o => o.value !== ".");
  return obs.slice(0, limit).map(o => ({ d: o.date, v: parseFloat(o.value) })).reverse();
}

async function fetchFMP(endpoint, fmpKey) {
  const sep = endpoint.includes("?") ? "&" : "?";
  return fetchJson(`${FMP_BASE}${endpoint}${sep}apikey=${fmpKey}`, { label: `FMP ${endpoint}`, retries: 1 });
}

// FMP-based rate fetches (more current than FRED)
async function fetchFMPTreasuryRates(fmpKey, days = 180) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const data = await fetchFMP(`/treasury-rates?from=${from}&to=${to}`, fmpKey);
  if (!Array.isArray(data) || !data.length) return null;
  // FMP returns newest-first, fields like: date, month1, month2, month3, month6, year1, year2, year3, year5, year7, year10, year20, year30
  const sorted = [...data].reverse();
  const mapKey = { DGS2: "year2", DGS5: "year5", DGS10: "year10", DGS30: "year30" };
  const result = {};
  for (const [fredId, fmpField] of Object.entries(mapKey)) {
    const history = sorted.filter(r => r[fmpField] != null).map(r => ({ d: r.date, v: parseFloat(r[fmpField]) }));
    if (history.length) result[fredId] = { current: history[history.length - 1].v, lastDate: history[history.length - 1].d, history };
  }
  return result;
}

async function fetchFMPMortgageRates(fmpKey) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const names = { MORTGAGE30US: "30YearFixedRateMortgageAverage", MORTGAGE15US: "15YearFixedRateMortgageAverage" };
  const result = {};
  for (const [id, name] of Object.entries(names)) {
    try {
      const data = await fetchFMP(`/economic-indicators?name=${name}&from=${from}&to=${to}`, fmpKey);
      if (Array.isArray(data) && data.length) {
        const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
        const history = sorted.filter(r => r.value != null).map(r => ({ d: r.date, v: parseFloat(r.value) }));
        if (history.length) result[id] = { current: history[history.length - 1].v, lastDate: history[history.length - 1].d, history };
      }
    } catch {}
  }
  return result;
}

async function fetchOptionsChain(ticker) {
  const r = await fetchWithTimeout(`/cboe-api/${ticker}.json`, { timeoutMs: 15000 });
  if (!r.ok) throw new Error("CBOE options error");
  const j = await r.json();
  return normalizeChain(j,ticker);
}

async function fetchOpenRouterModels() {
  const j = await fetchJson("https://openrouter.ai/api/v1/models", { label: "OpenRouter models", retries: 1 });
  return j.data || [];
}

async function fetchOpenRouterRankings() {
  // OpenRouter broke their /rankings endpoint in their Next.js infra upgrade
  // (HTTP 500). We now use Hugging Face's model API as the source: top
  // text-generation models ranked by past-30-day download count, snapshotted
  // daily server-side so the trend chart accumulates real history. Rows have
  // shape { date, rank, id, author, downloads, likes, lastModified, ... }.
  const j = await fetchJson("/api/hf-rankings", { label: "Hugging Face rankings", retries: 1 });
  if (j.error) throw new Error(j.error);
  return j.rows || [];
}

// Recognizable publishers we whitelist from FMP's aggregated feeds. site domain
// → clean chyron label + paywall flag (so the ticker can hint before a click).
const PREMIUM_PUBLISHERS = {
  "wsj.com":            { label: "WSJ",          paywalled: true },
  "barrons.com":        { label: "Barron's",     paywalled: true },
  "nytimes.com":        { label: "NYT",          paywalled: true },
  "bloomberg.com":      { label: "Bloomberg",    paywalled: true },
  "ft.com":             { label: "FT",           paywalled: true },
  "investors.com":      { label: "IBD",          paywalled: true },
  "cnbc.com":           { label: "CNBC",         paywalled: false },
  "reuters.com":        { label: "Reuters",      paywalled: false },
  "marketwatch.com":    { label: "MarketWatch",  paywalled: false },
  "forbes.com":         { label: "Forbes",       paywalled: false },
  "businessinsider.com":{ label: "Insider",      paywalled: false },
  "foxbusiness.com":    { label: "Fox Business", paywalled: false },
  "apnews.com":         { label: "AP",           paywalled: false },
  "finance.yahoo.com":  { label: "Yahoo",        paywalled: false },
};

// Premium-first news: FMP's aggregated general + stock feeds, filtered to the
// recognizable-publisher whitelist above, deduped, newest first. Links point
// straight to the original publisher (wsj.com/…, cnbc.com/…).
async function fetchFMPPremiumNews(fmpKey, limit = 40) {
  const [general, stock] = await Promise.all([
    fetchFMP(`/news/general-latest?page=0&limit=100`, fmpKey).catch(() => []),
    fetchFMP(`/news/stock-latest?page=0&limit=100`, fmpKey).catch(() => []),
  ]);
  const all = [...(Array.isArray(general) ? general : []), ...(Array.isArray(stock) ? stock : [])];
  const seen = new Set();
  const out = [];
  for (const n of all) {
    if (!n.title || !n.url || seen.has(n.url)) continue;
    const pub = PREMIUM_PUBLISHERS[(n.site || "").toLowerCase()];
    if (!pub) continue; // whitelist only
    seen.add(n.url);
    out.push({
      title: n.title,
      url: n.url,
      site: pub.label,
      paywalled: pub.paywalled,
      image: n.image,
      publishedDate: n.publishedDate,
      text: n.text || "",
      tickers: n.symbol || null,
    });
  }
  out.sort((a, b) => (b.publishedDate || "").localeCompare(a.publishedDate || ""));
  return out.slice(0, limit);
}

// ── Zillow CSV helpers ──
function parseCSVLine(line) {
  const result = [];
  let current = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { current += '"'; i++; } else inQ = false; }
      else current += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { result.push(current.trim()); current = ""; }
      else current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseZillowWideCSV(csvText, { lastNMonths = 60 } = {}) {
  const lines = csvText.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const dateStartIdx = headers.findIndex(h => /^\d{4}-\d{2}-\d{2}$/.test(h));
  if (dateStartIdx === -1) return [];
  const allDates = headers.slice(dateStartIdx);
  const datesToUse = lastNMonths ? allDates.slice(-lastNMonths) : allDates;
  const dateOffset = allDates.length - datesToUse.length;

  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const meta = {};
    for (let i = 0; i < dateStartIdx; i++) meta[headers[i]] = vals[i];
    const history = [];
    for (let i = 0; i < datesToUse.length; i++) {
      const raw = vals[dateStartIdx + dateOffset + i];
      if (raw && raw !== "") history.push({ d: datesToUse[i], v: parseFloat(raw) });
    }
    const current = history.length ? history[history.length - 1].v : null;
    const lastDate = history.length ? history[history.length - 1].d : null;
    // YoY: compare current to value ~12 months ago
    let yoy = null;
    if (history.length >= 13) {
      const prev = history[history.length - 13].v;
      if (prev > 0) yoy = ((current - prev) / prev) * 100;
    }
    return { ...meta, history, current, lastDate, yoy };
  });
}

const ZILLOW_URLS = {
  zhviState: "/zillow-csv/zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  zhviMetro: "/zillow-csv/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  zoriMetro: "/zillow-csv/zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv",
  inventoryState: "/zillow-csv/invt_fs/State_invt_fs_uc_sfrcondo_sm_month.csv",
  inventoryMetro: "/zillow-csv/invt_fs/Metro_invt_fs_uc_sfrcondo_sm_month.csv",
  newListingsMetro: "/zillow-csv/new_listings/Metro_new_listings_uc_sfrcondo_sm_month.csv",
  medianListMetro: "/zillow-csv/mlp/Metro_mlp_uc_sfrcondo_sm_month.csv",
};

// Reverse map: "California" → "CA"
const NAME_TO_ABBR = {};
const ST = { AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming" };
for (const [abbr, name] of Object.entries(ST)) NAME_TO_ABBR[name] = abbr;

async function fetchZillowData() {
  const fetchCSV = async (url) => {
    const r = await fetchWithTimeout(url, { timeoutMs: 20000 });
    if (!r.ok) throw new Error(`Zillow CSV error ${r.status}`);
    return r.text();
  };

  // Fetch all CSVs in parallel
  const [zhviStateCSV, zhviMetroCSV, zoriMetroCSV, invStateCSV, invMetroCSV, newListCSV, mlpCSV] = await Promise.all([
    fetchCSV(ZILLOW_URLS.zhviState).catch(() => null),
    fetchCSV(ZILLOW_URLS.zhviMetro).catch(() => null),
    fetchCSV(ZILLOW_URLS.zoriMetro).catch(() => null),
    fetchCSV(ZILLOW_URLS.inventoryState).catch(() => null),
    fetchCSV(ZILLOW_URLS.inventoryMetro).catch(() => null),
    fetchCSV(ZILLOW_URLS.newListingsMetro).catch(() => null),
    fetchCSV(ZILLOW_URLS.medianListMetro).catch(() => null),
  ]);

  const result = { national: {}, states: {}, metros: [] };

  // Parse ZHVI state data (for choropleth)
  if (zhviStateCSV) {
    const rows = parseZillowWideCSV(zhviStateCSV, { lastNMonths: 60 });
    const zhviStates = {};
    for (const row of rows) {
      const abbr = NAME_TO_ABBR[row.RegionName];
      if (abbr) zhviStates[abbr] = { v: row.current, d: row.lastDate, yoy: row.yoy, history: row.history };
    }
    result.states.zhvi = zhviStates;
  }

  // Parse inventory state data (for choropleth)
  if (invStateCSV) {
    const rows = parseZillowWideCSV(invStateCSV, { lastNMonths: 60 });
    const invStates = {};
    for (const row of rows) {
      const abbr = NAME_TO_ABBR[row.RegionName];
      if (abbr) invStates[abbr] = { v: row.current, d: row.lastDate, history: row.history };
    }
    result.states.inventory = invStates;
  }

  // Parse ZHVI metro data — extract national row + top 50 metros
  if (zhviMetroCSV) {
    const rows = parseZillowWideCSV(zhviMetroCSV, { lastNMonths: 60 });
    const national = rows.find(r => r.RegionName === "United States");
    if (national) result.national.zhvi = { current: national.current, lastDate: national.lastDate, yoy: national.yoy, history: national.history };
    // Top 50 metros by SizeRank (lower = bigger)
    const metroRows = rows.filter(r => r.RegionType === "msa").sort((a, b) => +a.SizeRank - +b.SizeRank).slice(0, 50);
    for (const m of metroRows) {
      const existing = result.metros.find(x => x.name === m.RegionName) || { name: m.RegionName, state: m.StateName, sizeRank: +m.SizeRank };
      existing.zhvi = m.current;
      existing.zhviYoy = m.yoy;
      existing.zhviHistory = m.history;
      if (!result.metros.find(x => x.name === m.RegionName)) result.metros.push(existing);
    }
  }

  // Parse ZORI metro data
  if (zoriMetroCSV) {
    const rows = parseZillowWideCSV(zoriMetroCSV, { lastNMonths: 60 });
    const national = rows.find(r => r.RegionName === "United States");
    if (national) result.national.zori = { current: national.current, lastDate: national.lastDate, yoy: national.yoy, history: national.history };
    for (const m of rows.filter(r => r.RegionType === "msa")) {
      const existing = result.metros.find(x => x.name === m.RegionName);
      if (existing) { existing.zori = m.current; existing.zoriYoy = m.yoy; }
    }
  }

  // Parse inventory metro data
  if (invMetroCSV) {
    const rows = parseZillowWideCSV(invMetroCSV, { lastNMonths: 60 });
    const national = rows.find(r => r.RegionName === "United States");
    if (national) result.national.inventory = { current: national.current, lastDate: national.lastDate, yoy: national.yoy, history: national.history };
    for (const m of rows.filter(r => r.RegionType === "msa")) {
      const existing = result.metros.find(x => x.name === m.RegionName);
      if (existing) existing.inventory = m.current;
    }
  }

  // Parse new listings metro data
  if (newListCSV) {
    const rows = parseZillowWideCSV(newListCSV, { lastNMonths: 60 });
    const national = rows.find(r => r.RegionName === "United States");
    if (national) result.national.newListings = { current: national.current, lastDate: national.lastDate, yoy: national.yoy, history: national.history };
  }

  // Parse median list price metro data
  if (mlpCSV) {
    const rows = parseZillowWideCSV(mlpCSV, { lastNMonths: 60 });
    const national = rows.find(r => r.RegionName === "United States");
    if (national) result.national.medianListPrice = { current: national.current, lastDate: national.lastDate, yoy: national.yoy, history: national.history };
    for (const m of rows.filter(r => r.RegionType === "msa")) {
      const existing = result.metros.find(x => x.name === m.RegionName);
      if (existing) existing.listPrice = m.current;
    }
  }

  return result;
}

async function fetchFMPCPI(fmpKey) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 900 * 86400000).toISOString().slice(0, 10); // ~30 months for YoY calc
  const data = await fetchFMP(`/economic-indicators?name=CPI&from=${from}&to=${to}`, fmpKey);
  if (!Array.isArray(data) || data.length < 13) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const indexed = sorted.map(r => ({ d: r.date.slice(0, 7), v: parseFloat(r.value) })).filter(r => !isNaN(r.v));
  if (indexed.length < 13) return null;
  // Compute YoY % change from index values (same as FRED CPIAUCSL logic)
  const history = [];
  for (let i = 12; i < indexed.length; i++) {
    const yoy = parseFloat((((indexed[i].v - indexed[i - 12].v) / indexed[i - 12].v) * 100).toFixed(1));
    history.push({ d: indexed[i].d, v: yoy });
  }
  if (!history.length) return null;
  return { CPIAUCSL: { yoy: history[history.length - 1].v, lastDate: history[history.length - 1].d, history } };
}

export { fetchJson, fetchFred, fetchFMP, fetchFMPTreasuryRates, fetchFMPMortgageRates, fetchFMPCPI, fetchOptionsChain, fetchOpenRouterModels, fetchOpenRouterRankings, fetchFMPPremiumNews, fetchZillowData };
