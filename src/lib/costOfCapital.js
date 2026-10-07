// ============================================================================
// COST OF CAPITAL, Damodaran's way, and the industry yardsticks it rests on.
//
// Bottom-up, as in his valuation classes and the "Ginzu" spreadsheets:
//   beta          his industry unlevered beta (corrected for cash) relevered at
//                 the company's own market debt-to-equity:
//                   βL = βu × (1 + (1 − t) × D/E),  t = 25% marginal U.S. rate
//   cost of equity  riskfree + βL × equity risk premium. The riskfree rate is
//                 the 10-year Treasury; the premium is his latest monthly
//                 implied ERP (/api/damodaran-erp) — both live, not January's.
//   cost of debt  riskfree + the default spread for the company's synthetic
//                 rating (interest coverage → his ratings.xls table: large
//                 firms ≥ $5B market cap use the large-firm map)
//   weights       market equity and debt (book debt, leases included)
// Banks, insurers and brokers are valued on equity: debt is their raw
// material, so the page shows the cost of equity and no WACC.
//
// Industry yardsticks: src/lib/damodaranIndustries.json (his January update,
// refreshed by scripts/refresh-damodaran.mjs) through the FMP → Damodaran
// industry map in industryMap.js. His costs of capital were set at a 3.95%
// T-bond and 4.46% ERP; restate() re-prices them at today's rates so a company
// and its industry are compared on the same day.
// ============================================================================
import IND from "./damodaranIndustries.json";
import DAMODARAN from "./damodaran.json";
import { FMP_TO_DAMODARAN, SYMBOL_OVERRIDES } from "./industryMap.js";

const fin = v => v != null && Number.isFinite(v);
const nz = v => (fin(v) && v !== 0 ? v : null);
const div = (a, b) => (fin(a) && fin(b) && b !== 0 ? a / b : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const INDUSTRY_AS_OF = IND.asOf;
export const DAMODARAN_INPUTS = IND.inputs;
export const MARGINAL_TAX = fin(IND.inputs?.marginalTax) ? IND.inputs.marginalTax : 0.25;
const ROWS = Object.fromEntries(Object.entries(IND.rows).map(([n, v]) => [n, Object.fromEntries(IND.keys.map((k, i) => [k, v[i]]))]));
export const industryRow = name => ROWS[name] || null;
export const MARKET = ROWS["Total Market"];
export const MARKET_EX_FIN = ROWS["Total Market (without financials)"];

const EQUITY_ONLY = /^(Bank \(|Banks \(|Brokerage|Insurance|Reinsurance)/;
export function industryOf(data) {
  const sym = data?.symbol, fmp = data?.prof?.industry || data?.industry || null;
  const name = SYMBOL_OVERRIDES[sym] || FMP_TO_DAMODARAN[fmp] || null;
  if (name && ROWS[name]) return { name, row: ROWS[name], how: SYMBOL_OVERRIDES[sym] ? "company" : "industry", fmp, equityOnly: EQUITY_ONLY.test(name) };
  const financial = /financial/i.test(data?.prof?.sector || data?.sector || "");
  return { name: financial ? "Total Market" : "Total Market (without financials)", row: financial ? MARKET : MARKET_EX_FIN, how: "market", fmp, equityOnly: false };
}
// the market yardstick that matches an industry: financials compare with the
// whole market, everything else with the market excluding financials
export const marketFor = ind => (ind?.equityOnly || /^(Financial|Investments)/.test(ind?.name || "") ? MARKET : MARKET_EX_FIN);

// His January industry costs at today's riskfree rate and ERP. Cost of debt
// keeps his spread (cost of debt − his T-bond rate) on top of today's rate.
export function restate(row, rf, erp) {
  if (!row || !fin(rf) || !fin(erp)) return null;
  const { rf: rf0, marginalTax: t } = IND.inputs;
  const ke = fin(row.beta) ? rf + row.beta * erp : null;
  const kdPre = fin(row.kdPre) ? row.kdPre - rf0 + rf : null;
  const wacc = fin(ke) && fin(kdPre) && fin(row.eW) && fin(row.dW) ? row.eW * ke + row.dW * kdPre * (1 - t) : null;
  return { ke, kdPre, wacc, excess: fin(row.roc) && fin(wacc) ? row.roc - wacc : null, equityExcess: fin(row.roe) && fin(ke) ? row.roe - ke : null };
}

// interest coverage → his synthetic rating and default spread
export function syntheticRating(coverage, mktCap) {
  if (!fin(coverage)) return null;
  const large = fin(mktCap) && mktCap >= 5e9;
  const table = (large ? DAMODARAN.ratings?.large : DAMODARAN.ratings?.small) || [];
  const band = table.find(b => coverage > b.min && coverage <= b.max);
  if (!band) return null;
  const [moodys, sp] = String(band.rating).split("/");
  return { rating: sp || moodys, moodys, spread: band.spread, large, coverage };
}

// trailing twelve months from the last four reported quarters; balances from
// the latest quarter and the one a year earlier. FMP writes 0 for lines a
// company does not break out, so 0 reads as "not reported".
export function trailing(data) {
  const q = rows => (rows || []).filter(r => /^Q[1-4]$/.test(r.period || ""));
  const qi = q(data?.qinc), qc = q(data?.qcf), qb = q(data?.qbs);
  const lastFy = rows => (rows || [])[rows?.length - 1] || null;
  const fy = { i: lastFy(data?.inc), c: lastFy(data?.cf), b: lastFy(data?.bs) };
  const useQ = qi.length >= 4 && qc.length >= 4 && qb.length >= 1;
  const sum = (rows, f) => { let s = 0, any = false; for (const r of rows) { const v = r?.[f]; if (fin(v)) { s += v; if (v !== 0) any = true; } } return any ? s : null; };
  const I = useQ ? qi.slice(-4) : null, C = useQ ? qc.slice(-4) : null;
  // FMP derives Q4 as FY − 9M; with its fiscal-year figure missing the derived
  // quarter is minus the other three (DECK fiscal 2026: capex positive, stock
  // compensation negative). A wrong-signed quarter sends that line to the
  // fiscal year's figure instead of a sum that cancels itself out.
  const SIGN = { capitalExpenditure: -1, stockBasedCompensation: 1, depreciationAndAmortization: 1 };
  const bad = f => useQ && SIGN[f] && C.some(r => fin(r?.[f]) && r[f] * SIGN[f] < 0);
  const flow = (f, src) => (useQ && !bad(f) ? sum(src === "c" ? C : I, f) : nz(fy[src]?.[f]));
  const bNow = useQ ? qb[qb.length - 1] : fy.b;
  const bAgo = useQ && qb.length >= 5 ? qb[qb.length - 5] : (data?.bs || [])[(data?.bs?.length || 0) - 2] || null;
  return {
    basis: useQ ? "TTM" : `FY${fy.i?.fiscalYear ?? ""}`, through: useQ ? I[3]?.date : fy.i?.date,
    revenue: flow("revenue", "i"), gross: flow("grossProfit", "i"), ebit: flow("operatingIncome", "i"), ebitda: flow("ebitda", "i"),
    net: flow("netIncome", "i"), pretax: flow("incomeBeforeTax", "i"), tax: flow("incomeTaxExpense", "i"), interest: flow("interestExpense", "i"),
    rd: flow("researchAndDevelopmentExpenses", "i"), da: flow("depreciationAndAmortization", "c"), sbc: flow("stockBasedCompensation", "c"),
    capex: fin(flow("capitalExpenditure", "c")) ? Math.abs(flow("capitalExpenditure", "c")) : null, interestPaid: flow("interestPaid", "c"),
    bNow, bAgo,
  };
}

const investedCapital = b => (b && fin(b.totalStockholdersEquity) ? (b.totalDebt || 0) + b.totalStockholdersEquity - (b.cashAndShortTermInvestments ?? b.cashAndCashEquivalents ?? 0) : null);
const effTax = (tax, pretax) => (fin(tax) && fin(pretax) && pretax > 0 ? clamp(tax / pretax, 0, 0.5) : null);

// Return on capital his way: EBIT × (1 − effective tax) ÷ (book debt + book
// equity − cash) at the START of the year. Annual, plus the trailing year.
export function returnOnCapital(data) {
  const bsBy = new Map((data?.bs || []).map(b => [String(b.fiscalYear), b]));
  const out = [];
  for (const r of data?.inc || []) {
    const prev = bsBy.get(String(Number(r.fiscalYear) - 1));
    const ic = investedCapital(prev);
    if (!fin(r.operatingIncome) || !(ic > 0)) continue;
    const t = effTax(r.incomeTaxExpense, r.incomeBeforeTax) ?? 0;
    const nopat = r.operatingIncome > 0 ? r.operatingIncome * (1 - t) : r.operatingIncome;
    out.push({ y: String(r.fiscalYear), roic: nopat / ic, nopat, ic, t });
  }
  const T = trailing(data), icAgo = investedCapital(T.bAgo);
  if (T.basis === "TTM" && fin(T.ebit) && icAgo > 0) {
    const t = effTax(T.tax, T.pretax) ?? 0;
    const nopat = T.ebit > 0 ? T.ebit * (1 - t) : T.ebit;
    out.push({ y: "TTM", roic: nopat / icAgo, nopat, ic: icAgo, t });
  }
  return out;
}

const dilutedShares = data => {
  const q = (data?.qinc || []).filter(r => fin(r.weightedAverageShsOutDil) && r.weightedAverageShsOutDil > 0);
  return q.length ? q[q.length - 1].weightedAverageShsOutDil : data?.inc?.[data.inc.length - 1]?.weightedAverageShsOutDil ?? null;
};

export function costOfCapital(data, { rf, erp }) {
  const ind = industryOf(data), t = MARGINAL_TAX, T = trailing(data), b = T.bNow || {};
  const shares = dilutedShares(data);
  const mcap = nz(data?.quote?.marketCap) ?? (fin(data?.price) && shares ? data.price * shares : null) ?? nz(data?.prof?.marketCap) ?? nz(data?.prof?.mktCap);
  const debt = fin(b.totalDebt) ? b.totalDebt : 0;
  const cash = b.cashAndShortTermInvestments ?? b.cashAndCashEquivalents ?? null;
  const de = fin(mcap) && mcap > 0 ? debt / mcap : null;
  const betaU = ind.row?.betaUc ?? ind.row?.betaU ?? null;
  // banks, insurers and brokers: debt is operating, so his industry levered
  // beta is used as published rather than relevered at a 140% D/E
  const betaL = ind.equityOnly ? ind.row?.beta ?? null : fin(betaU) && fin(de) ? betaU * (1 + (1 - t) * de) : null;
  const ke = fin(rf) && fin(erp) && fin(betaL) ? rf + betaL * erp : null;
  // interest: the income statement, else cash interest paid, else (debt but no
  // interest reported — Apple since FY2024) an estimate at riskfree plus the
  // industry spread; then coverage → rating
  let interest = nz(T.interest) ? Math.abs(T.interest) : nz(T.interestPaid) ? Math.abs(T.interestPaid) : null, interestEst = false;
  if (!interest && debt > 0 && fin(rf) && fin(T.ebit)) { interest = debt * (rf + ((ind.row?.kdPre ?? IND.inputs.rf) - IND.inputs.rf)); interestEst = true; }
  const coverage = fin(T.ebit) && interest ? T.ebit / interest : null;
  // an operating loss makes coverage negative and the synthetic rating a D —
  // he would not rate a money-loser on this year's income, so the industry's
  // credit spread stands in (lossMaking flags it for the page)
  const lossMaking = fin(T.ebit) && T.ebit <= 0;
  const rating = lossMaking ? null : syntheticRating(coverage, mcap);
  let kdPre = null, kdBasis = null;
  if (rating && fin(rf)) { kdPre = rf + rating.spread; kdBasis = "rating"; }
  else if (fin(rf) && fin(ind.row?.kdPre)) { kdPre = rf + (ind.row.kdPre - IND.inputs.rf); kdBasis = "industry"; }
  const kdAfter = fin(kdPre) ? kdPre * (1 - t) : null;
  const V = fin(mcap) ? mcap + debt : null;
  const wE = V ? mcap / V : null, wD = V ? debt / V : null;
  const wacc = !ind.equityOnly && fin(ke) && fin(kdAfter) && V ? wE * ke + wD * kdAfter : null;
  return {
    ind, market: marketFor(ind), rf, erp, t, T, mcap, shares, debt, cash, de, betaU, betaL, ke, interest, interestEst, coverage, rating, lossMaking, kdPre, kdAfter, kdBasis, wE, wD, wacc,
    equityOnly: ind.equityOnly, indNow: restate(ind.row, rf, erp), marketNow: restate(marketFor(ind), rf, erp),
  };
}

// Company figures beside his industry averages (same definitions as his files)
export function companyYardstick(data, coc) {
  const T = coc.T, b = T.bNow || {}, eq = b.totalStockholdersEquity;
  const ev = fin(coc.mcap) ? coc.mcap + coc.debt - (coc.cash || 0) : null;
  const rocs = returnOnCapital(data), roic = rocs.length ? rocs[rocs.length - 1] : null;
  const eqAgo = T.bAgo?.totalStockholdersEquity;
  const lastFyDate = data?.inc?.[data.inc.length - 1]?.date || "";
  const nextEst = (data?.est || []).find(e => (e.date || "") > lastFyDate && fin(e.epsAvg));
  const ic = investedCapital(b);
  return {
    gross: div(T.gross, T.revenue), opm: div(T.ebit, T.revenue), net: div(T.net, T.revenue), ebitdaM: div(T.ebitda, T.revenue),
    rdS: div(T.rd, T.revenue), sbcS: div(T.sbc, T.revenue), capexDep: div(T.capex, T.da),
    roe: T.net != null && eqAgo > 0 ? T.net / eqAgo : null, roc: roic?.roic ?? null, rocBasis: roic?.y ?? null,
    s2c: ic > 0 ? div(T.revenue, ic) : null,
    arS: div(b.netReceivables ?? b.accountsReceivables, T.revenue), invS: div(b.inventory, T.revenue), apS: div(b.accountPayables, T.revenue),
    ncwcS: fin(b.totalCurrentAssets) && fin(b.totalCurrentLiabilities) ? div((b.totalCurrentAssets - (b.cashAndShortTermInvestments ?? 0)) - (b.totalCurrentLiabilities - (b.shortTermDebt ?? 0)), T.revenue) : null,
    peTrail: T.net > 0 ? div(coc.mcap, T.net) : null,
    peFwd: nextEst && fin(data?.price) && nextEst.epsAvg > 0 ? data.price / nextEst.epsAvg : null, peFwdYear: nextEst?.date?.slice(0, 4) ?? null,
    evEbitda: T.ebitda > 0 ? div(ev, T.ebitda) : null, evEbit: T.ebit > 0 ? div(ev, T.ebit) : null, evS: div(ev, T.revenue),
    ps: div(coc.mcap, T.revenue), pbv: eq > 0 ? div(coc.mcap, eq) : null, evIc: ic > 0 ? div(ev, ic) : null,
    de: coc.de, beta: coc.betaL, ev,
  };
}

// The Value book's screen data has no balance sheet, so its cost of capital is
// approximate: the industry beta relevered at net debt ÷ market cap (implied by
// EV/EBITDA and net debt/EBITDA) and the industry's credit spread.
export function screenCostOfCapital(x, { rf, erp }) {
  const ind = industryOf({ symbol: x.symbol, industry: x.industry, sector: x.sector });
  if (ind.equityOnly || !fin(rf) || !fin(erp)) return null;
  const e = x.evEbitda, n = x.netDebtEbitda;
  const de = fin(e) && fin(n) && e > n && e > 0 ? Math.max(0, n / (e - n)) : 0;
  const betaU = ind.row?.betaUc ?? ind.row?.betaU;
  if (!fin(betaU)) return null;
  const ke = rf + betaU * (1 + (1 - MARGINAL_TAX) * de) * erp;
  const kd = rf + ((ind.row?.kdPre ?? IND.inputs.rf) - IND.inputs.rf);
  return { wacc: (ke + de * kd * (1 - MARGINAL_TAX)) / (1 + de), ind };
}
