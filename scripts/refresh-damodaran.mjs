// Refresh Damodaran datasets → src/lib/damodaran.json
// Run once a year (he updates in the first two weeks of January):
//   node scripts/refresh-damodaran.mjs
// Parses:
//   histimpl.xls — implied equity risk premium (FCFE), annual, 1960→
//   ratings.xls  — interest-coverage → synthetic rating → default spread
//   eleven U.S. industry files (betas, wacc, margin, EVA, capex, wcdata,
//   pedata, vebitda, psdata, pbvdata, divfcfe) → src/lib/damodaranIndustries.json,
//   the industry yardsticks and bottom-up betas on the stock pages
// Build-time by design: his server is fragile and the data changes once a
// year, so the app ships a checked-in snapshot with zero runtime dependency.
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "src", "lib", "damodaran.json");
const BASE = "https://pages.stern.nyu.edu/~adamodar/pc/datasets";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

async function download(name) {
  const resp = await fetch(`${BASE}/${name}`, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

// ── histimpl.xls → annual implied ERP series ──
function parseErp(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Historical Impl Premiums"], { header: 1 });
  // header row: Year | Earnings Yield | ... | T.Bond Rate(10) | ... |
  // Implied Premium (DDM)(13) | ... | Implied ERP (FCFE)(15)
  const out = [];
  for (const r of rows) {
    const y = r?.[0];
    if (typeof y !== "number" || y < 1900 || y > 2100) continue;
    out.push({
      y,
      erp: num(r[15]),      // Implied ERP (FCFE) — Damodaran's headline number
      ddm: num(r[13]),      // DDM variant
      ey: num(r[1]),        // earnings yield
      tbond: num(r[10]),    // 10Y T-bond rate at year end
      sp: num(r[3]),        // S&P 500 level
    });
  }
  if (out.length < 50) throw new Error(`histimpl parse suspiciously short: ${out.length} rows`);
  return out;
}

// ── ratings.xls → coverage→rating→spread bands ──
function parseRatings(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Start here Ratings sheet"], { header: 1 });
  const band = (r) => ({ min: num(r[0]), max: num(r[1]), rating: String(r[2]), spread: num(r[3]) });
  const isBand = (r) => typeof r?.[0] === "number" && typeof r?.[1] === "number" && typeof r?.[2] === "string" && typeof r?.[3] === "number";
  // Two tables: large non-financial firms, then smaller/riskier firms.
  const large = [], small = [];
  let section = 0; // 1 = in large table, 2 = in small table
  for (const r of rows) {
    const text = String(r?.[0] ?? "");
    if (text.startsWith("For large non-financial")) section = 1;
    else if (text.startsWith("For smaller and riskier")) section = 2;
    else if (isBand(r) && section) {
      (section === 2 ? small : large).push(band(r));
      if (r[1] >= 99999) section = 0; // Aaa row closes the table
    }
  }
  if (large.length < 10 || small.length < 10) throw new Error(`ratings parse short: large=${large.length} small=${small.length}`);
  return { large, small };
}

// ── U.S. industry averages → src/lib/damodaranIndustries.json ──
// Every file has an "Industry Averages" sheet whose header row starts with
// "Industry Name": 94 industries, then "Total Market" and "Total Market
// (without financials)". Columns are picked by position and checked against
// the header text, so a moved column fails loudly instead of shifting data.
// Values stay as he publishes them (fractions; multiples as multiples).
const INDUSTRY_FILES = {
  "betas.xls": { n: [1, /^number of firms$/], beta: [2, /^beta$/], de: [3, /^d\/e ratio$/], betaU: [5, /^unlevered beta$/], cashFv: [6, /^cash\/firm value$/], betaUc: [7, /^unlevered beta corrected for cash$/], sdEq: [9, /^standard deviation of equity$/] },
  "wacc.xls": { ke: [3, /^cost of equity$/], eW: [4, /^e\/\(d\+e\)$/], kdPre: [6, /^cost of debt$/], kdAfter: [8, /^after-tax cost of debt$/], dW: [9, /^d\/\(d\+e\)$/], wacc: [10, /^cost of capital$/] },
  "margin.xls": { gross: [2, /^gross margin$/], net: [3, /^net margin$/], opm: [5, /^pre-tax unadjusted operating margin$/], ebitdaM: [11, /^ebitda\/sales$/], rdS: [15, /^r&d\/sales$/], sbcS: [17, /^stock-based compensation\/sales$/] },
  "EVA.xls": { roe: [3, /^roe$/], coe: [4, /^cost of equity$/], roc: [8, /^roc$/], rocWacc: [10, /^\(roc - wacc\)$/] },
  "capex.xls": { capexDep: [4, /^cap ex\/deprecn$/], netCapexS: [7, /^net cap ex\/sales$/], s2c: [9, /^sales\/ invested capital/] },
  "wcdata.xls": { arS: [2, /^acc rec\/ sales$/], invS: [3, /^inventory\/sales$/], apS: [4, /^acc pay\/ sales$/], ncwcS: [5, /^non-cash wc\/ sales$/] },
  "pedata.xls": { lossShare: [2, /money losing/], pe: [3, /^current pe$/], peTrail: [4, /^trailing pe$/], peFwd: [5, /^forward pe$/], g5: [8, /^expected growth - next 5 years$/] },
  // the first block is "only positive EBITDA firms", the second "all firms"
  "vebitda.xls": { evEbitda: [3, /^ev\/ebitda$/], evEbit: [4, /^ev\/ebit$/] },
  "psdata.xls": { ps: [2, /^price\/sales$/], evS: [4, /^ev\/sales$/] },
  "pbvdata.xls": { pbv: [2, /^pbv$/], evIc: [4, /^ev\/ invested capital$/], roic: [5, /^roic$/] },
  "divfcfe.xls": { payout: [4, /^payout$/], cashRetFcfe: [10, /^net cash returned\/fcfe \(pre-debt\)$/] },
};
const xlDate = serial => (typeof serial === "number" ? new Date(Date.UTC(1899, 11, 30) + serial * 864e5).toISOString().slice(0, 10) : null);
function industrySheet(buf, file) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Industry Averages"], { header: 1, defval: "" });
  const h = rows.findIndex(r => /^industry\s*name$/i.test(String(r[0]).trim()));
  if (h < 0) throw new Error(`${file}: no "Industry Name" header row`);
  const head = rows[h].map(x => String(x).replace(/\s+/g, " ").trim().toLowerCase());
  for (const [key, [col, re]] of Object.entries(INDUSTRY_FILES[file])) {
    if (!re.test(head[col])) throw new Error(`${file}: column ${col} for ${key} reads "${head[col]}"`);
  }
  const body = rows.slice(h + 1).filter(r => String(r[0]).trim());
  return { rows, h, body };
}
async function parseIndustries() {
  const out = {};
  let inputs = null, asOf = null;
  for (const file of Object.keys(INDUSTRY_FILES)) {
    const { rows, body } = industrySheet(await download(file), file);
    if (file === "wacc.xls") {
      // the inputs he used: T-bond rate, ERP, global default spread, marginal tax
      const find = (re, col) => { const r = rows.find(x => re.test(String(x[0]))); return num(r?.[col]); };
      const tax = rows.find(x => /enter the marginal tax rate/i.test(String(x[0])));
      inputs = { rf: find(/long term treasury bond rate/i, 3), erp: find(/risk premium to use for equity/i, 3), spreadAdd: find(/global default spread/i, 3), marginalTax: num(tax?.[5]) };
      asOf = xlDate(rows[0]?.[1]);
    }
    for (const r of body) {
      const name = String(r[0]).trim(), o = (out[name] ||= {});
      for (const [key, [col]] of Object.entries(INDUSTRY_FILES[file])) o[key] = num(r[col]);
    }
    await new Promise(res => setTimeout(res, 600)); // his server is fragile; pace it
  }
  const names = Object.keys(out);
  if (names.length < 90 || !out["Total Market"] || Object.values(inputs || {}).some(v => v == null)) throw new Error(`industry parse short: ${names.length} industries, inputs ${JSON.stringify(inputs)}`);
  const keys = [...new Set(Object.values(INDUSTRY_FILES).flatMap(c => Object.keys(c)))];
  const round = v => (v == null ? null : Math.round(v * 1e5) / 1e5);
  return { asOf, inputs, keys, rows: Object.fromEntries(names.map(n => [n, keys.map(k => round(out[n][k]))])) };
}

const [histimpl, ratings] = await Promise.all([download("histimpl.xls"), download("ratings.xls")]);
const erp = parseErp(histimpl);
const bands = parseRatings(ratings);
const industries = await parseIndustries();
const IND_OUT = path.join(__dirname, "..", "src", "lib", "damodaranIndustries.json");
fs.writeFileSync(IND_OUT, JSON.stringify({
  asOf: industries.asOf,
  source: "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html",
  note: "Damodaran's U.S. industry averages (January update). inputs = the T-bond rate, equity risk premium, global default spread and marginal tax rate behind his costs of capital. rows: industry → values in the order of keys. Re-run scripts/refresh-damodaran.mjs each January.",
  inputs: industries.inputs, keys: industries.keys, rows: industries.rows,
}));
const data = {
  asOf: new Date().toISOString().slice(0, 10),
  source: "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html",
  note: "Annual snapshot of Damodaran datasets. Re-run scripts/refresh-damodaran.mjs each January.",
  erp,
  ratings: bands,
};
fs.writeFileSync(OUT, JSON.stringify(data, null, 1));
const last = erp[erp.length - 1];
console.log(`Wrote ${OUT}`);
console.log(`  ERP: ${erp.length} years (${erp[0].y}–${last.y}); latest implied ERP (FCFE) ${(last.erp * 100).toFixed(2)}% vs T-bond ${(last.tbond * 100).toFixed(2)}%`);
console.log(`  Ratings: ${bands.large.length} large-firm bands, ${bands.small.length} small-firm bands`);
console.log(`Wrote ${IND_OUT}`);
console.log(`  Industries: ${Object.keys(industries.rows).length} rows × ${industries.keys.length} fields, as of ${industries.asOf}; his inputs rf ${(industries.inputs.rf * 100).toFixed(2)}%, ERP ${(industries.inputs.erp * 100).toFixed(2)}%`);
