import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart, BarChart, Bar, ReferenceLine, LineChart, Line, CartesianGrid } from "recharts";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { fetchFMP, fetchOptionsChain } from "../lib/api.js";
import { quoteQuality } from "../lib/optionsAnalysis.js";
import { RateCard, SH, InfoBox } from "../components/shared.jsx";
import ProfitSankey from "./stocks/ProfitSankey.jsx";
import TickerSearch from "../components/TickerSearch.jsx";
import { ValuationBands, PeerCompare, DividendSafety, EarningsWeekAhead, PIEPanel, SyntheticRating } from "./stocks/ResearchPanels.jsx";
import SP500Screener from "./stocks/SP500Screener.jsx";
import ExpectationsPanel, { consensusGrowth } from "./stocks/ExpectationsPanel.jsx";
import MarketFairValuePanel from "../components/MarketFairValue.jsx";
import SP500Overview from "./stocks/SP500Overview.jsx";
import PeopleScreener from "./stocks/PeopleScreener.jsx";
import SpecialSituations from "./stocks/SpecialSituations.jsx";
import StockResearchSheet from "./stocks/StockResearchSheet.jsx";
import {fetchStockDetail} from "../lib/stockDetail.js";

const Plot = createPlotlyComponent(Plotly);

const DEFAULT_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "BRK-B", "JPM", "V"];
const STOCK_COLS = [
  { key: "symbol", label: "Ticker", width: 70 },
  { key: "changePct", label: "Day %", format: "chgpct", width: 68 },
  { key: "mktCap", label: "Mkt Cap", format: "bigdollar", width: 85 },
  { key: "totalAssets", label: "Assets", format: "bigdollar", width: 80 },
  { key: "equity", label: "Equity", format: "bigdollar", width: 80 },
  { key: "earningsYield", label: "Earn Yld", format: "pct", width: 72 },
  { key: "fcfYield", label: "FCF Yld", format: "pct", width: 70 },
  { key: "roe", label: "ROE", format: "pct", width: 62 },
  { key: "roe5y", label: "ROE 5Y", format: "pct", width: 68 },
  { key: "roic", label: "ROIC", format: "pct", width: 62 },
  { key: "roic5y", label: "ROIC 5Y", format: "pct", width: 70 },
  { key: "peg", label: "PEG", format: "num2", width: 55 },
  { key: "sbcPct", label: "SBC/Rev", format: "pct", width: 72 },
  { key: "cash", label: "Cash", format: "bigdollar", width: 75 },
  { key: "debt", label: "Debt", format: "bigdollar", width: 75 },
  { key: "taxPct", label: "Tax/Rev", format: "pct", width: 70 },
];

const DETAIL_SECTIONS = [
  { title: "Financials", rows: [
    { label: "Revenue", fmt: "bigdollar", get: (d, i) => d.inc[i]?.revenue },
    { label: "  ↳ Rev Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.inc[i]?.revenue, prev = d.inc[i - 1]?.revenue; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "  Gross Profit", fmt: "bigdollar", get: (d, i) => d.inc[i]?.grossProfit },
    { label: "  Operating Income", fmt: "bigdollar", get: (d, i) => d.inc[i]?.operatingIncome },
    { label: "  ↳ Op Inc Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.inc[i]?.operatingIncome, prev = d.inc[i - 1]?.operatingIncome; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "  Net Income", fmt: "bigdollar", get: (d, i) => d.inc[i]?.netIncome },
    { label: "  ↳ Net Inc Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.inc[i]?.netIncome, prev = d.inc[i - 1]?.netIncome; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "EBITDA", fmt: "bigdollar", get: (d, i) => d.inc[i]?.ebitda },
    { label: "EPS (Diluted)", fmt: "num2", get: (d, i) => d.inc[i]?.epsDiluted },
    { label: "  ↳ EPS Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.inc[i]?.epsDiluted, prev = d.inc[i - 1]?.epsDiluted; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "Dividends/Share", fmt: "num2", get: (d, i) => { const div = Math.abs(d.cf[i]?.netDividendsPaid || 0), sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? div / sh : null; } },
    { label: "Shares Out (Dil)", fmt: "bignum", get: (d, i) => d.inc[i]?.weightedAverageShsOutDil },
  ]},
  { title: "Profitability", rows: [
    { label: "Tax Rate %", fmt: "pct", get: (d, i) => d.inc[i]?.incomeTaxExpense != null && d.inc[i]?.incomeBeforeTax ? d.inc[i].incomeTaxExpense / d.inc[i].incomeBeforeTax : null },
    { label: "Gross Margin %", fmt: "pct", get: (d, i) => d.rat[i]?.grossProfitMargin ?? (d.inc[i]?.revenue ? d.inc[i].grossProfit / d.inc[i].revenue : null) },
    { label: "Operating Margin %", fmt: "pct", get: (d, i) => d.rat[i]?.operatingProfitMargin ?? (d.inc[i]?.revenue ? d.inc[i].operatingIncome / d.inc[i].revenue : null) },
    { label: "Net Margin %", fmt: "pct", get: (d, i) => d.rat[i]?.netProfitMargin ?? (d.inc[i]?.revenue ? d.inc[i].netIncome / d.inc[i].revenue : null) },
    { label: "FCF Margin %", fmt: "pct", get: (d, i) => { const fcf = d.cf[i]?.freeCashFlow, rev = d.inc[i]?.revenue; return rev ? fcf / rev : null; } },
  ]},
  { title: "Profitability — Returns", rows: [
    { label: "Return on Assets %", fmt: "pct", get: (d, i) => { const ni = d.inc[i]?.netIncome, ta = d.bs[i]?.totalAssets; return ta ? ni / ta : null; } },
    { label: "Return on Equity %", fmt: "pct", get: (d, i) => { const ni = d.inc[i]?.netIncome, eq = d.bs[i]?.totalStockholdersEquity; return eq ? ni / eq : null; } },
    { label: "Return on Invested Capital %", fmt: "pct", get: (d, i) => { const ebit = d.inc[i]?.operatingIncome, ic = (d.bs[i]?.totalStockholdersEquity || 0) + (d.bs[i]?.totalDebt || 0) - (d.bs[i]?.cashAndCashEquivalents || 0); return ic > 0 && ebit ? ebit * 0.79 / ic : null; } },
    { label: "Asset Turnover", fmt: "num2", get: (d, i) => { const rev = d.inc[i]?.revenue, ta = d.bs[i]?.totalAssets; return ta ? rev / ta : null; } },
    { label: "Inventory Turnover", fmt: "num2", get: (d, i) => { const cogs = d.inc[i]?.costOfRevenue, inv = d.bs[i]?.inventory; return inv ? cogs / inv : null; } },
  ]},
  { title: "Cash Flow", rows: [
    { label: "Operating Cash Flow", fmt: "bigdollar", get: (d, i) => d.cf[i]?.operatingCashFlow },
    { label: "Capital Expenditure", fmt: "bigdollar", get: (d, i) => d.cf[i]?.capitalExpenditure },
    { label: "Free Cash Flow", fmt: "bigdollar", get: (d, i) => d.cf[i]?.freeCashFlow },
    { label: "  ↳ FCF Growth %", fmt: "pct", isGrowth: true, get: (d, i) => { const cur = d.cf[i]?.freeCashFlow, prev = d.cf[i - 1]?.freeCashFlow; return prev ? (cur - prev) / Math.abs(prev) : null; } },
    { label: "FCF/Share", fmt: "num2", get: (d, i) => { const fcf = d.cf[i]?.freeCashFlow, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? fcf / sh : null; } },
    { label: "Dividends Paid", fmt: "bigdollar", get: (d, i) => d.cf[i]?.netDividendsPaid },
    { label: "Stock Buybacks", fmt: "bigdollar", get: (d, i) => d.cf[i]?.commonStockRepurchased },
    { label: "SBC", fmt: "bigdollar", get: (d, i) => d.cf[i]?.stockBasedCompensation },
    { label: "FCF/Net Income", fmt: "pct", get: (d, i) => { const fcf = d.cf[i]?.freeCashFlow, ni = d.inc[i]?.netIncome; return ni ? fcf / ni : null; } },
    { label: "CapEx/Revenue", fmt: "pct", get: (d, i) => { const cap = Math.abs(d.cf[i]?.capitalExpenditure || 0), rev = d.inc[i]?.revenue; return rev ? cap / rev : null; } },
  ]},
  { title: "Financial Health", rows: [
    { label: "Cash & Equivalents", fmt: "bigdollar", get: (d, i) => d.bs[i]?.cashAndCashEquivalents },
    { label: "Short-Term Investments", fmt: "bigdollar", get: (d, i) => d.bs[i]?.shortTermInvestments },
    { label: "Total Current Assets", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalCurrentAssets },
    { label: "Total Assets", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalAssets },
    { label: "Total Current Liabilities", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalCurrentLiabilities },
    { label: "Total Debt", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalDebt },
    { label: "Total Liabilities", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalLiabilities },
    { label: "Shareholders' Equity", fmt: "bigdollar", get: (d, i) => d.bs[i]?.totalStockholdersEquity },
  ]},
  { title: "Financial Health — Ratios", rows: [
    { label: "Current Ratio", fmt: "num2", get: (d, i) => { const ca = d.bs[i]?.totalCurrentAssets, cl = d.bs[i]?.totalCurrentLiabilities; return cl ? ca / cl : null; } },
    { label: "Quick Ratio", fmt: "num2", get: (d, i) => { const ca = d.bs[i]?.totalCurrentAssets, inv = d.bs[i]?.inventory || 0, cl = d.bs[i]?.totalCurrentLiabilities; return cl ? (ca - inv) / cl : null; } },
    { label: "Debt/Equity", fmt: "num2", get: (d, i) => { const debt = d.bs[i]?.totalDebt, eq = d.bs[i]?.totalStockholdersEquity; return eq ? debt / eq : null; } },
    { label: "Debt/EBITDA", fmt: "num2", get: (d, i) => { const debt = d.bs[i]?.totalDebt, eb = d.inc[i]?.ebitda; return eb ? debt / eb : null; } },
    { label: "Interest Coverage", fmt: "num2", get: (d, i) => { const ebit = d.inc[i]?.operatingIncome, int_ = d.inc[i]?.interestExpense; return int_ ? ebit / int_ : null; } },
  ]},
  { title: "Per Share Data", rows: [
    { label: "Revenue/Share", fmt: "num2", get: (d, i) => { const rev = d.inc[i]?.revenue, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? rev / sh : null; } },
    { label: "Book Value/Share", fmt: "num2", get: (d, i) => { const eq = d.bs[i]?.totalStockholdersEquity, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? eq / sh : null; } },
    { label: "Tangible BV/Share", fmt: "num2", get: (d, i) => { const eq = d.bs[i]?.totalStockholdersEquity, gw = d.bs[i]?.goodwillAndIntangibleAssets || 0, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? (eq - gw) / sh : null; } },
    { label: "FCF/Share", fmt: "num2", get: (d, i) => { const fcf = d.cf[i]?.freeCashFlow, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? fcf / sh : null; } },
    { label: "Operating CF/Share", fmt: "num2", get: (d, i) => { const ocf = d.cf[i]?.operatingCashFlow, sh = d.inc[i]?.weightedAverageShsOutDil; return sh ? ocf / sh : null; } },
  ]},
];

function fmtVal(v, fmt) {
  if (v == null || isNaN(v)) return "—";
  if (fmt === "bigdollar") {
    const a = Math.abs(v);
    if (a >= 1e12) return `$${(v/1e12).toFixed(1)}T`;
    if (a >= 1e9) return `$${(v/1e9).toFixed(1)}B`;
    if (a >= 1e6) return `$${(v/1e6).toFixed(0)}M`;
    return `$${v.toLocaleString()}`;
  }
  if (fmt === "bignum") {
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v/1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(v/1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${(v/1e3).toFixed(0)}K`;
    return v.toLocaleString();
  }
  if (fmt === "pct") return `${(v * 100).toFixed(1)}%`;
  if (fmt === "chgpct") return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  if (fmt === "num2") return v.toFixed(2);
  return String(v);
}

function avg(arr) { if (!arr.length) return null; return arr.reduce((s, v) => s + v, 0) / arr.length; }

async function fetchStockData(symbol, fmpKey) {
  const [incArr, bsArr, cfArr, ratArr, kmArr, profile] = await Promise.all([
    fetchFMP(`/income-statement?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/balance-sheet-statement?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/cash-flow-statement?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/ratios?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/key-metrics?symbol=${symbol}&limit=5`, fmpKey),
    fetchFMP(`/profile?symbol=${symbol}`, fmpKey),
  ]);
  const inc = incArr?.[0]; const bs = bsArr?.[0]; const cf = cfArr?.[0]; const rat = ratArr?.[0]; const km = kmArr?.[0]; const prof = profile?.[0];
  if (!inc || !bs) return null;
  const mktCap = prof?.mktCap || km?.marketCap;
  const rev = inc.revenue || 1;
  const equity = bs.totalStockholdersEquity; const totalAssets = bs.totalAssets;
  const cash = bs.cashAndShortTermInvestments || bs.cashAndCashEquivalents;
  const debt = bs.totalDebt;
  const tax = inc.incomeTaxExpense;
  // Use FMP's pre-computed metrics (no hardcoded tax rates)
  const earningsYield = km?.earningsYield ?? null;
  const fcfYield = km?.freeCashFlowYield ?? null;
  const roe = km?.returnOnEquity ?? null;
  const roic = km?.returnOnInvestedCapital ?? null;
  // 5Y averages from key-metrics
  const roes = kmArr?.slice(0, 5).map(r => r.returnOnEquity).filter(v => v != null) || [];
  const roics = kmArr?.slice(0, 5).map(r => r.returnOnInvestedCapital).filter(v => v != null) || [];
  const peg = rat?.priceToEarningsGrowthRatio;
  const sbcPct = km?.stockBasedCompensationToRevenue ?? null;
  const changePct = prof?.changePercentage ?? null;
  const price = prof?.price ?? null;
  return {
    symbol, mktCap, totalAssets, equity, earningsYield, fcfYield, roe,
    roe5y: avg(roes), roic, roic5y: avg(roics),
    peg: peg != null && isFinite(peg) ? peg : null,
    sbcPct,
    cash, debt,
    taxPct: tax != null ? tax / rev : null,
    changePct, price,
  };
}


// ── Reverse DCF helpers ──
function dcfValue(fcf, growthRate, discountRate, termGrowth, years) {
  let total = 0;
  for (let t = 1; t <= years; t++) total += fcf * Math.pow(1 + growthRate, t) / Math.pow(1 + discountRate, t);
  const termFCF = fcf * Math.pow(1 + growthRate, years) * (1 + termGrowth);
  const termValue = termFCF / (discountRate - termGrowth);
  total += termValue / Math.pow(1 + discountRate, years);
  return total;
}

function solveImpliedGrowth(marketCap, fcf, discountRate, termGrowth, years) {
  if (!marketCap || !fcf || fcf <= 0) return null;
  let lo = -0.50, hi = 1.00;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const val = dcfValue(fcf, mid, discountRate, termGrowth, years);
    if (val < marketCap) lo = mid; else hi = mid;
    if (Math.abs(val - marketCap) / marketCap < 0.0001) break;
  }
  return (lo + hi) / 2;
}

function fcfCAGR(cfArr) {
  const valid = (cfArr || []).filter(c => c.freeCashFlow > 0);
  if (valid.length < 2) return null;
  const first = valid[0].freeCashFlow, last = valid[valid.length - 1].freeCashFlow;
  const n = valid.length - 1;
  return Math.pow(last / first, 1 / n) - 1;
}

function SliderInput({ label, value, onChange, min, max, step, fmt }) {
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
        <span style={{ fontSize: 13, color: "var(--text-primary)", fontFamily: fonts.mono, fontWeight: 700 }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#818cf8", height: 4, cursor: "pointer" }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>{fmt(min)}</span>
        <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>{fmt(max)}</span>
      </div>
    </div>
  );
}

function ReverseDCF({ data }) {
  const [discRate, setDiscRate] = useState(0.10);
  const [termGrowth, setTermGrowth] = useState(0.03);
  const [projYears, setProjYears] = useState(10);
  const [showProj, setShowProj] = useState(false);

  const lastCF = data.cf[data.cf.length - 1];
  const lastInc = data.inc[data.inc.length - 1];
  const fcf = lastCF?.freeCashFlow || 0;
  const shares = lastInc?.weightedAverageShsOutDil || 0;
  const price = data.price;
  const mktCap = price && shares ? price * shares : data.prof?.mktCap || 0;
  const fcfPerShare = shares ? fcf / shares : 0;
  const histCAGR = fcfCAGR(data.cf);

  const implied = solveImpliedGrowth(mktCap, fcf, discRate, termGrowth, projYears);
  const street = consensusGrowth(data); // forward consensus relative to the last reported FY

  // Color coding
  const impliedColor = implied == null ? "#94a3b8" : histCAGR != null && implied < histCAGR * 0.8 ? "#4ade80" : histCAGR != null && implied > histCAGR * 1.3 ? "#f87171" : "#fbbf24";
  const verdict = implied == null ? "Insufficient data" : histCAGR != null && implied < histCAGR * 0.8 ? "Market pricing below historical growth — potentially undervalued" : histCAGR != null && implied > histCAGR * 1.3 ? "Market pricing aggressive growth — high expectations baked in" : "Market pricing roughly in line with historical growth";

  // Sensitivity table
  const discRates = [discRate - 0.02, discRate - 0.01, discRate, discRate + 0.01, discRate + 0.02];
  const termRates = [termGrowth - 0.01, termGrowth - 0.005, termGrowth, termGrowth + 0.005, termGrowth + 0.01];
  const sensData = discRates.map(dr => termRates.map(tr => {
    if (tr >= dr) return null;
    return solveImpliedGrowth(mktCap, fcf, dr, tr, projYears);
  }));

  // Projection table
  const projRows = [];
  if (implied != null) {
    for (let t = 1; t <= Math.min(projYears, 15); t++) {
      const projFCF = fcf * Math.pow(1 + implied, t);
      const discounted = projFCF / Math.pow(1 + discRate, t);
      projRows.push({ year: t, fcf: projFCF, pv: discounted });
    }
    const termFCF = fcf * Math.pow(1 + implied, projYears) * (1 + termGrowth);
    const termVal = termFCF / (discRate - termGrowth);
    const pvTerm = termVal / Math.pow(1 + discRate, projYears);
    projRows.push({ year: "Terminal", fcf: termVal, pv: pvTerm });
  }

  return (<>
    <SH>Financial Snapshot</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(140px, 100%),1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label="Stock Price" value={price} color="#818cf8" format="plain" subtitle={price ? `$${price.toFixed(2)}` : null} small />
      <RateCard label="Market Cap" value={mktCap} color="#3B82F6" format="bigdollar" small />
      <RateCard label="TTM Free Cash Flow" value={fcf} color="#10B981" format="bigdollar" small />
      <RateCard label="FCF / Share" value={fcfPerShare} color="#F59E0B" format="plain" subtitle={fcfPerShare ? `$${fcfPerShare.toFixed(2)}` : null} small />
      <RateCard label="Hist. FCF CAGR" value={histCAGR != null ? histCAGR * 100 : null} color="#8B5CF6" subtitle={histCAGR != null ? `${(histCAGR*100).toFixed(1)}% over ${data.cf.filter(c=>c.freeCashFlow>0).length-1}yr` : "N/A"} small />
    </div>

    <SH>Assumptions</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "20px 24px", marginBottom: 14, display: "flex", gap: 24, flexWrap: "wrap" }}>
      <SliderInput label="Discount Rate (WACC)" value={discRate} onChange={setDiscRate} min={0.06} max={0.15} step={0.005} fmt={v => `${(v*100).toFixed(1)}%`} />
      <SliderInput label="Terminal Growth Rate" value={termGrowth} onChange={setTermGrowth} min={0.01} max={0.05} step={0.005} fmt={v => `${(v*100).toFixed(1)}%`} />
      <SliderInput label="Projection Period" value={projYears} onChange={setProjYears} min={5} max={20} step={1} fmt={v => `${v} yrs`} />
    </div>

    <SH>Implied FCF Growth Rate</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "24px 28px", marginBottom: 14, textAlign: "center" }}>
      <div style={{ fontSize: 42, fontWeight: 700, color: impliedColor, fontFamily: fonts.heading, letterSpacing: -1 }}>
        {implied != null ? `${(implied * 100).toFixed(1)}%` : "—"}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 6 }}>annual FCF growth rate implied by current market price</div>
      <div style={{ fontSize: 12, color: impliedColor, fontFamily: fonts.heading, marginTop: 10, fontWeight: 500 }}>{verdict}</div>
      {histCAGR != null && <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginTop: 6 }}>Historical FCF CAGR: {(histCAGR*100).toFixed(1)}% | Implied: {implied != null ? (implied*100).toFixed(1) : "—"}%</div>}
    </div>

    <ExpectationsPanel data={data} implied={implied} fcf={fcf} mktCap={mktCap} shares={shares} price={price} discRate={discRate} termGrowth={termGrowth} projYears={projYears} histCAGR={histCAGR} street={street} />

    <SH>Sensitivity — Implied Growth vs the Street</SH>
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
        <thead>
          <tr>
            <th style={{ padding: "10px 12px", fontSize: 9, color: "#64748b", fontFamily: fonts.mono, textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>WACC \ Term Growth</th>
            {termRates.map(tr => <th key={tr} style={{ padding: "10px 8px", fontSize: 9, color: tr === termGrowth ? "#818cf8" : "var(--text-secondary)", fontFamily: fonts.mono, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.06)", fontWeight: tr === termGrowth ? 700 : 400 }}>{(tr*100).toFixed(1)}%</th>)}
          </tr>
        </thead>
        <tbody>
          {sensData.map((row, ri) => (
            <tr key={ri}>
              <td style={{ padding: "8px 12px", fontSize: 11, color: discRates[ri] === discRate ? "#818cf8" : "var(--text-secondary)", fontFamily: fonts.mono, fontWeight: discRates[ri] === discRate ? 700 : 400, borderBottom: ri < sensData.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>{(discRates[ri]*100).toFixed(1)}%</td>
              {row.map((val, ci) => {
                const isActive = discRates[ri] === discRate && termRates[ci] === termGrowth;
                const st = street?.revCagr3;
                const tone = val == null || st == null ? null : val <= st ? "g" : val <= st + 0.03 ? "a" : "r";
                return <td key={ci} style={{ padding: "8px 8px", fontSize: 11, fontFamily: fonts.mono, textAlign: "center", color: val == null ? "#334155" : tone === "g" ? "#4ade80" : tone === "a" ? "#fbbf24" : tone === "r" ? "#f87171" : val < 0 ? "#f87171" : "var(--text-primary)", background: isActive ? "rgba(129,140,248,0.18)" : tone === "g" ? "rgba(74,222,128,0.07)" : tone === "r" ? "rgba(248,113,113,0.06)" : "transparent", fontWeight: isActive ? 700 : 400, borderBottom: ri < sensData.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", borderRadius: isActive ? 6 : 0 }}>{val != null ? `${(val*100).toFixed(1)}%` : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div style={{ fontSize: 9.5, color: "#475569", fontFamily: fonts.mono, marginTop: -8, marginBottom: 14, lineHeight: 1.5 }}>
      Implied FCF growth for each WACC × terminal-growth pair. {street?.revCagr3 != null ? `Green = at or below the Street's ${(street.revCagr3 * 100).toFixed(1)}%/yr consensus revenue growth (analysts already model it); amber = within 3 pts above; red = the price needs more than the Street sees.` : "No forward consensus for this name, so cells are uncolored."}
    </div>

    <button onClick={() => setShowProj(p => !p)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 10, fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading }}>
      <span style={{ color: "#818cf8", marginRight: 8 }}>{showProj ? "▾" : "▸"}</span>Year-by-year FCF at the implied growth rate
    </button>
    {showProj && (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Year", "Projected FCF", "Present Value"].map((h, i) => <th key={h} style={{ padding: "10px 12px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)", textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {projRows.map((row, i) => (
            <tr key={i} style={{ borderBottom: i < projRows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <td style={{ padding: "8px 12px", fontSize: 11, color: row.year === "Terminal" ? "#818cf8" : "var(--text-secondary)", fontFamily: fonts.mono, fontWeight: row.year === "Terminal" ? 600 : 400 }}>{row.year === "Terminal" ? "Terminal Value" : `Year ${row.year}`}</td>
              <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.mono, textAlign: "right" }}>{fmtVal(row.fcf, "bigdollar")}</td>
              <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.mono, textAlign: "right" }}>{fmtVal(row.pv, "bigdollar")}</td>
            </tr>
          ))}
          {projRows.length > 0 && (
            <tr style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <td style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-primary)", fontFamily: fonts.mono, fontWeight: 700 }}>Total (= Mkt Cap)</td>
              <td />
              <td style={{ padding: "10px 12px", fontSize: 13, color: "#4ade80", fontFamily: fonts.mono, textAlign: "right", fontWeight: 700 }}>{fmtVal(projRows.reduce((s, r) => s + r.pv, 0), "bigdollar")}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    )}

    <InfoBox color="#818cf8">
      <strong style={{ color: "var(--text-primary)" }}>How to read this page.</strong> The implied growth rate is the annual FCF growth the market is pricing into today&apos;s price, given your discount rate and terminal assumptions. The scoreboard puts it next to the two yardsticks that matter — what analysts model for the next few years and what the company has actually delivered — and the hurdle chart draws the same comparison as a path. The value ladder shows how far out the bet lives; the Street check shows what the stock is worth if the analysts are simply right. A stock is interesting when the price asks for less than the Street already expects and the value doesn&apos;t depend on year 11.
    </InfoBox>
  </>);
}

// ── Hover-help tooltips for options terminology ──
// Wrap any label/word with <HelpTip term="atmIV">ATM IV</HelpTip> to get a
// dotted underline + rich pop-over definition on hover. The tooltip uses fixed
// positioning so it escapes parent overflow:hidden containers (like cards).
const OPT_TERMS = {
  spot: {
    title: "Spot Price",
    def: "The current trading price of the underlying stock or ETF — what someone would pay to buy or sell one share right now.",
  },
  atmIV: {
    title: "At-the-Money Implied Volatility (ATM IV)",
    def: "The implied volatility of options whose strike is closest to the current spot price. Best single-number summary of how much movement the market is pricing in.",
    sub: "Annualized. SPY ATM IV of 18% implies ~±0.9% daily moves (18% ÷ √252).",
  },
  ivRange: {
    title: "IV Range",
    def: "The lowest and highest implied volatility across all listed options. Wide ranges mean deep OTM strikes price extreme tail risk relative to ATM.",
  },
  pcSkew: {
    title: "Put/Call Skew",
    def: "Implied vol of OTM puts minus implied vol of OTM calls. Positive skew = investors paying more for downside protection than upside speculation.",
    sub: "Equities normally show positive skew (crash premium). When skew compresses or inverts, sentiment is unusually bullish — historically a contrarian signal.",
  },
  totalOI: {
    title: "Total Open Interest",
    def: "Total number of option contracts currently held open across all strikes and expirations. Higher OI = deeper liquidity and bigger dealer hedging flows.",
  },
  expirations: {
    title: "Expirations",
    def: "Number of distinct expiration dates listed for this ticker. Liquid names like SPY have weekly, monthly, and quarterly expirations stretching out to multi-year LEAPS.",
  },
  totalVolume: {
    title: "Total Volume",
    def: "Total option contracts traded today across all strikes and expirations. Volume shows where the action is right now (vs OI which is cumulative).",
  },
  impliedMove: {
    title: "Implied Move",
    def: "A reference move calculated from ATM implied volatility and square-root-of-time scaling. It does not describe the probability of staying inside a range throughout the period.",
    sub: "Math: spot × IV × √(days/365). Ignores skew, drift and jumps; a real-world 68% coverage rate is not established.",
  },
  volSurface: {
    title: "Volatility Surface",
    def: "A 2D or 3D view of implied volatility plotted against strike price (X axis) and days to expiration (Y axis). Reveals where the market is pricing event risk or crash-protection premium.",
  },
  volSmile: {
    title: "Volatility Smile",
    def: "A cross-section of the surface at one expiration — IV across strikes. Equities usually show a 'skew' (downward slope from low strikes to high) rather than a true U-shape, reflecting the OTM-put crash premium.",
  },
  termStructure: {
    title: "Term Structure",
    def: "ATM implied vol across expirations. Normally upward-sloping (longer-dated options price more uncertainty). Inversion (near-term IV > longer-term) signals an imminent catalyst like earnings or FOMC.",
  },
  greeks: {
    title: "Greeks",
    def: "Partial derivatives of an option's theoretical price with respect to spot, IV, and time. Tell you how the position will behave under various changes.",
  },
  delta: {
    title: "Delta (Δ)",
    def: "Change in option price per $1 change in the underlying, all else equal. Delta is not the probability of receiving an exercise assignment.",
    sub: "ATM calls have Δ ≈ 0.50; deep ITM calls approach 1.00; deep OTM calls approach 0.00. Puts are negative.",
  },
  gamma: {
    title: "Gamma (Γ)",
    def: "Change in Delta per $1 change in the underlying. Highest at ATM and for short-dated options. Tells you how reactive the position is to spot moves.",
    sub: "Long-gamma positions accelerate as the market moves in your favor.",
  },
  theta: {
    title: "Theta (Θ)",
    def: "Dollar value lost per day from time decay, all else equal. Most negative for ATM and short-dated options. This is the rent option buyers pay.",
    sub: "CSP / covered-call sellers harvest theta. Long calls/puts bleed it.",
  },
  vega: {
    title: "Vega (ν)",
    def: "Change in option price per 1 percentage point change in IV. Highest for ATM and longer-dated options. Tells you how exposed the position is to volatility shifts.",
    sub: "Falling IV helps a short option, all else equal; stock moves and other risks can outweigh that effect.",
  },
  maxPain: {
    title: "Max Pain",
    def: "The strike minimizing aggregate intrinsic value at this expiration, weighted by reported open interest. Premiums paid are excluded, so this is not holder profit or loss.",
    sub: "A descriptive open-interest statistic. It does not establish where the stock will trade or reveal dealer hedges.",
  },
  callOI: {
    title: "Total Call Open Interest",
    def: "Number of open call contracts at this expiration. Each has a buyer and seller; open interest alone does not identify investor direction or multi-leg positions.",
  },
  putOI: {
    title: "Total Put Open Interest",
    def: "Number of open put contracts at this expiration. Protective purchases, put sales, and multi-leg positions can all contribute.",
  },
  pcRatio: {
    title: "Put/Call Ratio (OI)",
    def: "Total put OI divided by total call OI at this expiration. Above 1.0 means more put contracts; below 1.0 means more calls.",
    sub: "It does not identify net bullish or bearish exposure without trade direction and position context.",
  },
  spotVsMaxPain: {
    title: "Spot vs Max Pain",
    def: "Percentage distance between current spot and the strike minimizing OI-weighted intrinsic value. Distance alone is not a trading signal.",
  },
};

function HelpTip({ term, children }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const data = OPT_TERMS[term];
  if (!data) return <>{children}</>;

  const onEnter = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    // Position above the label, horizontally aligned to its left edge,
    // clamped to viewport
    const clampedLeft = Math.min(rect.left, window.innerWidth - 340);
    setPos({ x: Math.max(8, clampedLeft), y: rect.top });
  };

  return (<>
    <span
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={() => setPos(null)}
      style={{ borderBottom: "1px dotted rgba(129,140,248,0.55)", cursor: "help" }}
    >{children}</span>
    {pos && (
      <div style={{
        position: "fixed",
        left: pos.x,
        top: pos.y - 8,
        transform: "translateY(-100%)",
        background: "#0f172a",
        border: "1px solid rgba(129,140,248,0.4)",
        borderRadius: 8,
        padding: "11px 14px",
        fontSize: 11,
        color: "#cbd5e1",
        fontFamily: fonts.heading,
        fontWeight: 400,
        minWidth: 240,
        maxWidth: 320,
        lineHeight: 1.55,
        zIndex: 10000,
        textTransform: "none",
        letterSpacing: 0,
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        pointerEvents: "none",
        whiteSpace: "normal",
      }}>
        <div style={{ color: "#a5b4fc", fontWeight: 700, marginBottom: 5, fontSize: 11, letterSpacing: 0.3 }}>{data.title}</div>
        <div>{data.def}</div>
        {data.sub && <div style={{ marginTop: 7, fontSize: 10, color: "#94a3b8", fontStyle: "italic", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6 }}>{data.sub}</div>}
      </div>
    )}
  </>);
}

// ── Vol Surface ──
function VolSurface({ symbol, spot: initialSpot, chain: sharedChain }) {
  const [optData, setOptData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [optType, setOptType] = useState("C");
  const [surfaceView, setSurfaceView] = useState("heatmap");
  const [strikeRange, setStrikeRange] = useState(0.3);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [dteRange, setDteRange] = useState("all");
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    if (sharedChain) { setOptData(sharedChain); setLoading(false); return; }
    fetchOptionsChain(symbol)
      .then(d => { if(alive) { setOptData(d); setLoading(false); } })
      .catch(e => { if(alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [symbol, sharedChain]);

  const processed = useMemo(() => {
    if (!optData) return null;
    const spot = optData.spot || initialSpot;
    if (!(spot > 0)) return null;
    const dteMax = dteRange === "30" ? 30 : dteRange === "90" ? 90 : dteRange === "180" ? 180 : dteRange === "365" ? 365 : dteRange === "leaps" ? 99999 : 99999;
    const dteMin = dteRange === "leaps" ? 365 : 0;
    const filtered = optData.options.filter(o => quoteQuality(o).usable && o.iv > 0 && o.type === optType && Math.abs(o.strike - spot) / spot <= strikeRange && o.dte >= dteMin && o.dte <= dteMax);
    if (!filtered.length) return null;
    const expiries = [...new Set(filtered.map(o => o.dte))].sort((a, b) => a - b);
    const strikes = [...new Set(filtered.map(o => o.strike))].sort((a, b) => a - b);
    // Build IV grid
    const ivMap = {};
    filtered.forEach(o => { ivMap[`${o.dte}-${o.strike}`] = o.iv; });
    const ivGrid = expiries.map(dte => strikes.map(k => {
      const v = ivMap[`${dte}-${k}`];
      return v != null ? v * 100 : null;
    }));
    // ATM IV per expiry (term structure)
    const termStructure = expiries.map(dte => {
      const atm = filtered.filter(o => o.dte === dte).reduce((best, o) => !best || Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best, null);
      return { dte, iv: atm ? atm.iv * 100 : null };
    }).filter(t => t.iv != null);
    // Smile for selected expiry
    const smileExpiry = expiries.includes(selectedExpiry) ? selectedExpiry : (expiries.length > 2 ? expiries[Math.min(2, expiries.length - 1)] : expiries[0]);
    const smile = filtered.filter(o => o.dte === smileExpiry).sort((a, b) => a.strike - b.strike).map(o => ({ strike: o.strike, iv: o.iv * 100, oi: o.oi, moneyness: ((o.strike / spot - 1) * 100).toFixed(1) }));
    // Stats
    const allIVs = filtered.map(o => o.iv * 100).sort((a, b) => a - b);
    const atmIV = termStructure.length ? termStructure[0].iv : null;
    const totalOI = filtered.reduce((s, o) => s + (o.oi || 0), 0);
    const totalVol = filtered.reduce((s, o) => s + (o.vol || 0), 0);
    // IV Skew: compare OTM puts vs OTM calls
    const otmPuts = optData.options.filter(o => quoteQuality(o).usable && o.iv > 0 && o.type === "P" && o.strike < spot * 0.95 && o.dte === smileExpiry);
    const otmCalls = optData.options.filter(o => quoteQuality(o).usable && o.iv > 0 && o.type === "C" && o.strike > spot * 1.05 && o.dte === smileExpiry);
    const avgPutIV = otmPuts.length ? otmPuts.reduce((s, o) => s + o.iv, 0) / otmPuts.length * 100 : null;
    const avgCallIV = otmCalls.length ? otmCalls.reduce((s, o) => s + o.iv, 0) / otmCalls.length * 100 : null;
    const skew = avgPutIV != null && avgCallIV != null ? avgPutIV - avgCallIV : null;
    const ivMin = allIVs[0], ivMax = allIVs[allIVs.length - 1];
    return { spot, expiries, strikes, ivGrid, termStructure, smile, smileExpiry, atmIV, totalOI, totalVol, skew, ivMin, ivMax, filtered };
  }, [optData, optType, strikeRange, selectedExpiry, initialSpot, dteRange]);

  // ── Implied Move: market's expected ±1σ price range at standard tenors ──
  // Uses spot × ATM_IV × √(DTE/365). Nearest available expiry is used when an
  // exact tenor isn't listed (so 1D may pull from the 2-3d expiry, etc.)
  const impliedMoves = useMemo(() => {
    if (!processed) return [];
    const { spot, termStructure } = processed;
    if (!termStructure.length) return [];
    const targets = [
      { label: "1 Day",    dte: 1   },
      { label: "1 Week",   dte: 7   },
      { label: "1 Month",  dte: 30  },
      { label: "3 Months", dte: 90  },
    ];
    return targets.map(t => {
      let best = null, minDiff = Infinity;
      for (const ts of termStructure) {
        const diff = Math.abs(ts.dte - t.dte);
        if (diff < minDiff) { minDiff = diff; best = ts; }
      }
      if (!best || best.iv == null || minDiff > Math.max(3,t.dte*.4)) return null;
      const iv = best.iv / 100;
      const sigma = spot * iv * Math.sqrt(t.dte / 365);
      return {
        label: t.label,
        targetDte: t.dte,
        actualDte: best.dte,
        expiryDate: optData.options.find(o=>o.dte===best.dte)?.expiryDate,
        iv: best.iv,
        expectedMove: sigma,
        pctMove: (sigma / spot) * 100,
        upper: spot + sigma,
        lower: spot - sigma,
      };
    }).filter(Boolean);
  }, [processed]);

  // ── Greeks profile for the selected expiry ──
  // FMP already provides delta/gamma/theta/vega per contract; just shape for plotting.
  const greeksData = useMemo(() => {
    if (!processed) return [];
    const { smileExpiry, filtered } = processed;
    return filtered
      .filter(o => o.dte === smileExpiry)
      .sort((a, b) => a.strike - b.strike)
      .map(o => ({
        strike: o.strike,
        delta: o.delta,
        gamma: o.gamma,
        theta: o.theta,
        vega: o.vega,
      }));
  }, [processed]);

  // ── Open Interest profile + Max Pain ──
  // Max pain = strike that minimizes the total intrinsic value of all
  // open option contracts at expiration (i.e., where option writers collectively
  // intrinsic value only; this is not a forecast of expiration price.
  const oiProfile = useMemo(() => {
    if (!optData || !processed) return null;
    const { smileExpiry, spot } = processed;
    const allAtExpiry = optData.options.filter(o => o.dte === smileExpiry && o.standard !== false && Number.isFinite(o.oi));
    if (!allAtExpiry.length) return null;

    const callsByStrike = new Map();
    const putsByStrike  = new Map();
    allAtExpiry.forEach(o => {
      const m = o.type === "C" ? callsByStrike : putsByStrike;
      m.set(o.strike, (m.get(o.strike) || 0) + (o.oi || 0));
    });
    const allStrikes = [...new Set([...callsByStrike.keys(), ...putsByStrike.keys()])].sort((a, b) => a - b);

    // Brute-force max pain across all listed strikes (n² but n is small)
    let maxPainStrike = null;
    let minLoss = Infinity;
    for (const s of allStrikes) {
      let totalLoss = 0;
      for (const k of allStrikes) {
        const callOI = callsByStrike.get(k) || 0;
        const putOI  = putsByStrike.get(k)  || 0;
        if      (k < s) totalLoss += callOI * (s - k) * 100;  // ITM calls
        else if (k > s) totalLoss += putOI  * (k - s) * 100;  // ITM puts
      }
      if (totalLoss < minLoss) { minLoss = totalLoss; maxPainStrike = s; }
    }

    // Chart data: ±30% around spot, calls positive / puts negative for split bars
    const range = 0.30;
    const chartData = allStrikes
      .filter(k => Math.abs(k - spot) / spot <= range)
      .map(k => ({
        strike: k,
        calls: callsByStrike.get(k) || 0,
        puts:  -(putsByStrike.get(k) || 0),
        callsRaw: callsByStrike.get(k) || 0,
        putsRaw:  putsByStrike.get(k)  || 0,
      }));

    const totalCallOI = [...callsByStrike.values()].reduce((s, v) => s + v, 0);
    const totalPutOI  = [...putsByStrike.values()].reduce((s, v) => s + v, 0);
    const pcRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : null;

    return { chartData, maxPainStrike, totalCallOI, totalPutOI, pcRatio };
  }, [optData, processed]);

  // Canvas heatmap drawing
  useEffect(() => {
    if (!processed || surfaceView !== "heatmap" || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { strikes, expiries, ivGrid, ivMin, ivMax } = processed;
    const W = canvas.width = canvas.parentElement.clientWidth;
    const H = canvas.height = Math.max(300, expiries.length * 22 + 40);
    const padL = 70, padR = 60, padT = 10, padB = 30;
    const gW = W - padL - padR, gH = H - padT - padB;
    const cellW = gW / strikes.length, cellH = gH / expiries.length;
    ctx.fillStyle = "#141829"; ctx.fillRect(0, 0, W, H);
    // Draw cells
    for (let ei = 0; ei < expiries.length; ei++) {
      for (let si = 0; si < strikes.length; si++) {
        const iv = ivGrid[ei][si];
        if (iv == null) continue;
        const t = Math.min(1, Math.max(0, (iv - ivMin) / (ivMax - ivMin + 0.01)));
        const r = Math.round(30 + t * 225), g = Math.round(50 + (1 - Math.abs(t - 0.5) * 2) * 150), b = Math.round(255 - t * 200);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(padL + si * cellW, padT + ei * cellH, cellW - 1, cellH - 1);
      }
    }
    // X axis labels (strikes)
    ctx.fillStyle = "#64748b"; ctx.font = "9px IBM Plex Mono, monospace"; ctx.textAlign = "center";
    const xStep = Math.max(1, Math.floor(strikes.length / 12));
    for (let i = 0; i < strikes.length; i += xStep) {
      ctx.fillText(`$${strikes[i]}`, padL + i * cellW + cellW / 2, H - 8);
    }
    // Y axis labels (DTE)
    ctx.textAlign = "right";
    for (let i = 0; i < expiries.length; i++) {
      ctx.fillText(`${expiries[i]}d`, padL - 6, padT + i * cellH + cellH / 2 + 3);
    }
    // Color legend
    const legX = W - padR + 10, legW = 12, legH = gH;
    for (let y = 0; y < legH; y++) {
      const t = 1 - y / legH;
      const r = Math.round(30 + t * 225), g = Math.round(50 + (1 - Math.abs(t - 0.5) * 2) * 150), b = Math.round(255 - t * 200);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(legX, padT + y, legW, 1);
    }
    ctx.fillStyle = "#94a3b8"; ctx.font = "8px IBM Plex Mono, monospace"; ctx.textAlign = "left";
    ctx.fillText(`${ivMax?.toFixed(0)}%`, legX + legW + 4, padT + 8);
    ctx.fillText(`${ivMin?.toFixed(0)}%`, legX + legW + 4, padT + legH);
  }, [processed, surfaceView]);

  // Hover handler for canvas
  const handleCanvasMove = useCallback((e) => {
    if (!processed || !canvasRef.current || !tooltipRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const { strikes, expiries, ivGrid, spot } = processed;
    const padL = 70, padR = 60, padT = 10, padB = 30;
    const gW = canvas.width - padL - padR, gH = canvas.height - padT - padB;
    const si = Math.floor((x - padL) / (gW / strikes.length));
    const ei = Math.floor((y - padT) / (gH / expiries.length));
    const tip = tooltipRef.current;
    if (si >= 0 && si < strikes.length && ei >= 0 && ei < expiries.length && ivGrid[ei][si] != null) {
      tip.style.display = "block";
      tip.style.left = `${e.clientX - rect.left + 12}px`;
      tip.style.top = `${e.clientY - rect.top - 10}px`;
      const moneyness = ((strikes[si] / spot - 1) * 100).toFixed(1);
      tip.innerHTML = `<b>Strike:</b> $${strikes[si]} (${moneyness > 0 ? '+' : ''}${moneyness}%)<br/><b>DTE:</b> ${expiries[ei]} days<br/><b>IV:</b> ${ivGrid[ei][si].toFixed(1)}%`;
    } else { tip.style.display = "none"; }
  }, [processed]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Loading options chain for {symbol}...</div>;
  if (error) return <div style={{ textAlign: "center", padding: 40 }}><div style={{ color: "#f87171", marginBottom: 8 }}>Error: {error}</div><div style={{ color: "#64748b", fontSize: 11 }}>Options data unavailable for {symbol}. Try major tickers like SPY, AAPL, MSFT, QQQ, etc.</div></div>;
  if (!processed) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>No options data available for {symbol}.</div>;

  const { spot, expiries, strikes, ivGrid, termStructure, smile, smileExpiry, atmIV, totalOI, totalVol, skew, ivMin, ivMax } = processed;

  const smallBtnStyle = (active) => ({ background: active ? "#818cf8" : "rgba(255,255,255,0.05)", border: "1px solid " + (active ? "#818cf8" : "rgba(255,255,255,0.1)"), color: active ? "#0f172a" : "#94a3b8", padding: "4px 12px", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading, borderRadius: 6 });

  return (<>
    <SH>Options Overview</SH>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(130px, 100%),1fr))", gap: 10, marginBottom: 14 }}>
      <RateCard label={<HelpTip term="spot">Spot Price</HelpTip>} value={spot} color="#818cf8" format="plain" subtitle={`$${spot?.toFixed(2)}`} small />
      <RateCard label={<HelpTip term="atmIV">ATM IV</HelpTip>} value={atmIV} color="#3B82F6" subtitle={atmIV ? `${atmIV.toFixed(1)}%` : "—"} small />
      <RateCard label={<HelpTip term="ivRange">IV Range</HelpTip>} value={null} color="#10B981" format="plain" subtitle={ivMin != null ? `${ivMin.toFixed(0)}% – ${ivMax.toFixed(0)}%` : "—"} small />
      <RateCard label={<HelpTip term="pcSkew">Put/Call Skew</HelpTip>} value={skew} color={skew > 0 ? "#F59E0B" : "#10B981"} subtitle={skew != null ? `${skew > 0 ? '+' : ''}${skew.toFixed(1)}pp` : "—"} small />
      <RateCard label={<HelpTip term="totalOI">Total OI</HelpTip>} value={totalOI} color="#8B5CF6" format="plain" subtitle={totalOI ? totalOI.toLocaleString() : "—"} small />
      <RateCard label={<HelpTip term="expirations">Expirations</HelpTip>} value={expiries.length} color="#EC4899" format="plain" subtitle={expiries.length ? `${expiries[0]}d – ${expiries[expiries.length-1]}d` : "—"} small />
      <RateCard label={<HelpTip term="totalVolume">Total Volume</HelpTip>} value={totalVol} color="#06B6D4" format="plain" subtitle={totalVol ? totalVol.toLocaleString() : "—"} small />
    </div>

    {/* ── Implied Move ── */}
    {impliedMoves.length > 0 && (<>
      <SH><HelpTip term="impliedMove">Volatility-scaled reference move</HelpTip> — ATM IV × square root of time</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(180px, 100%),1fr))", gap: 10, marginBottom: 14 }}>
        {impliedMoves.map(im => (
          <div key={im.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#818cf8", borderRadius: "14px 14px 0 0" }} />
            <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
              {im.label} <span style={{ color: "#475569" }}>· IV from {im.expiryDate} ({im.actualDte}d) · {im.iv.toFixed(0)}%</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", fontFamily: fonts.heading, lineHeight: 1.1 }}>
              ±${im.expectedMove.toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, marginTop: 3 }}>
              ±{im.pctMove.toFixed(2)}% · ${im.lower.toFixed(2)}–${im.upper.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </>)}

    {/* Controls */}
    <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={() => setOptType("C")} style={smallBtnStyle(optType === "C")}>Calls</button>
        <button onClick={() => setOptType("P")} style={smallBtnStyle(optType === "P")}>Puts</button>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button onClick={() => setSurfaceView("heatmap")} style={smallBtnStyle(surfaceView === "heatmap")}>Heatmap</button>
        <button onClick={() => setSurfaceView("3d")} style={smallBtnStyle(surfaceView === "3d")}>3D Surface</button>
        <button onClick={() => setSurfaceView("chain")} style={smallBtnStyle(surfaceView === "chain")}>Options Chain</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>Expiry:</span>
        {[["30", "≤30d"], ["90", "≤90d"], ["180", "≤6mo"], ["365", "≤1yr"], ["leaps", "LEAPS"], ["all", "All"]].map(([k, l]) => <button key={k} onClick={() => { setDteRange(k); setSelectedExpiry(null); }} style={smallBtnStyle(dteRange === k)}>{l}</button>)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono }}>Strike Range:</span>
        {[0.15, 0.3, 0.5, 1.0].map(r => <button key={r} onClick={() => setStrikeRange(r)} style={smallBtnStyle(strikeRange === r)}>±{(r*100).toFixed(0)}%</button>)}
      </div>
    </div>

    <SH><HelpTip term="volSurface">Volatility Surface</HelpTip> — {optType === "C" ? "Calls" : "Puts"}</SH>

    {surfaceView === "heatmap" && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 16, marginBottom: 14, position: "relative" }}>
        <canvas ref={canvasRef} onMouseMove={handleCanvasMove} onMouseLeave={() => { if (tooltipRef.current) tooltipRef.current.style.display = "none"; }} style={{ width: "100%", cursor: "crosshair" }} />
        <div ref={tooltipRef} style={{ display: "none", position: "absolute", background: "#0f172aee", border: "1px solid rgba(129,140,248,0.3)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "var(--text-primary)", fontFamily: fonts.mono, pointerEvents: "none", zIndex: 10, lineHeight: 1.6 }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, padding: "0 70px 0 0" }}>
          <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>Strike Price →</span>
          <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono }}>← Days to Expiration (Y axis)</span>
        </div>
      </div>
    )}

    {surfaceView === "3d" && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 8, marginBottom: 14 }}>
        <Plot
          data={[{
            type: "surface",
            x: strikes,
            y: expiries,
            z: ivGrid,
            colorscale: [[0, "#1e3a5f"], [0.25, "#2563eb"], [0.5, "#10b981"], [0.75, "#f59e0b"], [1, "#ef4444"]],
            hovertemplate: "Strike: $%{x}<br>DTE: %{y}d<br>IV: %{z:.1f}%<extra></extra>",
            contours: { z: { show: true, usecolormap: true, highlightcolor: "#fff", project: { z: true } } }
          }]}
          layout={{
            autosize: true, height: 450, margin: { l: 10, r: 10, t: 30, b: 10 },
            paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
            scene: {
              xaxis: { title: "Strike ($)", color: "#64748b", gridcolor: "rgba(255,255,255,0.06)", tickfont: { size: 9, color: "#64748b" } },
              yaxis: { title: "DTE", color: "#64748b", gridcolor: "rgba(255,255,255,0.06)", tickfont: { size: 9, color: "#64748b" } },
              zaxis: { title: "IV (%)", color: "#64748b", gridcolor: "rgba(255,255,255,0.06)", tickfont: { size: 9, color: "#64748b" } },
              bgcolor: "rgba(20,24,41,1)",
              camera: { eye: { x: 1.8, y: -1.5, z: 0.8 } }
            },
            font: { family: "IBM Plex Mono, monospace", color: "#94a3b8" },
          }}
          config={{ responsive: true, displayModeBar: true, modeBarButtonsToRemove: ["toImage", "sendDataToCloud"], displaylogo: false }}
          style={{ width: "100%", height: 450 }}
        />
      </div>
    )}

    {/* Options chain table */}
    {surfaceView === "chain" && (() => {
      const chainExpiry = selectedExpiry || smileExpiry;
      const chainData = processed.filtered.filter(o => o.dte === chainExpiry).sort((a, b) => a.strike - b.strike);
      const cols = [
        { key: "strike", label: "Strike", fmt: v => `$${v}`, align: "left", highlight: true },
        { key: "lastPrice", label: "Last", fmt: v => v != null ? `$${v.toFixed(2)}` : "—" },
        { key: "bid", label: "Bid", fmt: v => v != null ? `$${v.toFixed(2)}` : "—" },
        { key: "ask", label: "Ask", fmt: v => v != null ? `$${v.toFixed(2)}` : "—" },
        { key: "iv", label: "IV", fmt: v => v != null ? `${(v * 100).toFixed(1)}%` : "—" },
        { key: "vol", label: "Volume", fmt: v => v != null ? v.toLocaleString() : "—" },
        { key: "oi", label: "Open Int", fmt: v => v != null ? v.toLocaleString() : "—" },
        { key: "delta", label: "Delta", fmt: v => v != null ? v.toFixed(4) : "—" },
        { key: "gamma", label: "Gamma", fmt: v => v != null ? v.toFixed(4) : "—" },
        { key: "theta", label: "Theta", fmt: v => v != null ? v.toFixed(4) : "—" },
        { key: "vega", label: "Vega", fmt: v => v != null ? v.toFixed(4) : "—" },
        { key: "rho", label: "Rho", fmt: v => v != null ? v.toFixed(4) : "—" },
      ];
      return (<>
        <SH>Options Chain — {chainExpiry} DTE ({optType === "C" ? "Calls" : "Puts"})</SH>
        <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
          {expiries.map(dte => {
            const d = new Date(Date.now() + dte * 86400000);
            const label = dte <= 7 ? `${dte}d` : `${(d.getMonth()+1)}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
            const isLeap = dte > 365;
            return <button key={dte} onClick={() => setSelectedExpiry(dte)} style={{ ...smallBtnStyle((selectedExpiry || smileExpiry) === dte), ...(isLeap ? { borderColor: "rgba(245,158,11,0.4)" } : {}) }}>{label}{isLeap ? " ★" : ""}</button>;
          })}
        </div>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>{cols.map(c => <th key={c.key} style={{ padding: "10px 8px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: c.align || "right", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {chainData.map(o => {
                const isATM = Math.abs(o.strike - spot) / spot < 0.01;
                return (
                  <tr key={o.sym} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: isATM ? "rgba(129,140,248,0.08)" : "transparent" }}>
                    {cols.map(c => <td key={c.key} style={{ padding: "7px 8px", fontSize: 11, color: c.highlight ? (isATM ? "#818cf8" : "var(--text-primary)") : "var(--text-primary)", fontFamily: fonts.mono, textAlign: c.align || "right", fontWeight: c.highlight ? 600 : 400, whiteSpace: "nowrap" }}>{c.fmt(o[c.key])}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {chainData.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#64748b", fontSize: 11 }}>No options at this expiration.</div>}
        </div>
      </>);
    })()}

    {/* Smile chart */}
    <SH><HelpTip term="volSmile">Volatility Smile</HelpTip> — {smileExpiry} DTE</SH>
    <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
      {expiries.map(dte => {
        const d = new Date(Date.now() + dte * 86400000);
        const label = dte <= 7 ? `${dte}d` : `${(d.getMonth()+1)}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
        return <button key={dte} onClick={() => setSelectedExpiry(dte)} style={smallBtnStyle((selectedExpiry || smileExpiry) === dte)}>{label}</button>;
      })}
    </div>
    {smile.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={smile} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs><linearGradient id="g-smile" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} /><stop offset="95%" stopColor="#818cf8" stopOpacity={0} /></linearGradient></defs>
            <XAxis dataKey="strike" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={v => `$${v}`} interval={Math.max(0, Math.floor(smile.length / 10) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} formatter={(v, n) => [`${v.toFixed(1)}%`, "IV"]} labelFormatter={v => `Strike: $${v}`} />
            <ReferenceLine x={spot} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" label={{ value: "ATM", fill: "#64748b", fontSize: 9 }} />
            <Area type="monotone" dataKey="iv" stroke="#818cf8" fill="url(#g-smile)" strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* ── Greeks Profile (Delta / Gamma / Theta / Vega vs strike) ── */}
    {greeksData.length > 0 && (<>
      <SH><HelpTip term="greeks">Greeks Profile</HelpTip> — {smileExpiry} DTE ({optType === "C" ? "Calls" : "Puts"})</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(320px, 100%),1fr))", gap: 14, marginBottom: 14 }}>
        {[
          { key: "delta", label: "Delta",  color: "#10B981", desc: "Δ price per $1 spot move", precision: 3 },
          { key: "gamma", label: "Gamma",  color: "#F59E0B", desc: "Δ delta per $1 spot move", precision: 4 },
          { key: "theta", label: "Theta",  color: "#EF4444", desc: "$ daily time decay",        precision: 3 },
          { key: "vega",  label: "Vega",   color: "#8B5CF6", desc: "Δ price per 1pp IV move",   precision: 3 },
        ].map(g => (
          <div key={g.key} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px 8px 6px" }}>
            <div style={{ paddingLeft: 12, marginBottom: 8, display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 12, color: g.color, fontFamily: fonts.heading, fontWeight: 700, letterSpacing: 0.5 }}>
                <HelpTip term={g.key}>{g.label}</HelpTip>
              </span>
              <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono }}>{g.desc}</span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={greeksData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="strike" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={v => `$${v}`} interval={Math.max(0, Math.floor(greeksData.length / 6) - 1)} />
                <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={v => v == null ? "—" : (g.key === "delta" ? v.toFixed(2) : g.key === "gamma" ? v.toFixed(3) : v.toFixed(1))} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} formatter={(v) => [v != null ? v.toFixed(g.precision) : "—", g.label]} labelFormatter={v => `Strike: $${v}`} />
                <ReferenceLine x={spot} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey={g.key} stroke={g.color} strokeWidth={1.8} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </>)}

    {/* ── Open Interest profile + Max Pain ── */}
    {oiProfile && oiProfile.chartData.length > 0 && (<>
      <SH>Open Interest Profile & <HelpTip term="maxPain">Max Pain</HelpTip> — {smileExpiry} DTE</SH>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(155px, 100%),1fr))", gap: 10, marginBottom: 12 }}>
        <RateCard label={<HelpTip term="maxPain">Max Pain Strike</HelpTip>} value={null} color="#F97316" format="plain" subtitle={oiProfile.maxPainStrike != null ? `$${oiProfile.maxPainStrike}` : "—"} small />
        <RateCard label={<HelpTip term="callOI">Total Call OI</HelpTip>} value={null} color="#10B981" format="plain" subtitle={oiProfile.totalCallOI.toLocaleString()} small />
        <RateCard label={<HelpTip term="putOI">Total Put OI</HelpTip>} value={null} color="#EF4444" format="plain" subtitle={oiProfile.totalPutOI.toLocaleString()} small />
        <RateCard label={<HelpTip term="pcRatio">Put/Call Ratio (OI)</HelpTip>} value={oiProfile.pcRatio} color="#818cf8" subtitle={oiProfile.pcRatio != null ? oiProfile.pcRatio.toFixed(2) : "—"} small />
        <RateCard label={<HelpTip term="spotVsMaxPain">Spot vs Max Pain</HelpTip>} value={null} color="#818cf8" format="plain" subtitle={oiProfile.maxPainStrike != null ? `${(((spot - oiProfile.maxPainStrike) / oiProfile.maxPainStrike) * 100).toFixed(1)}%` : "—"} small />
      </div>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={oiProfile.chartData} margin={{ top: 20, right: 8, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="strike" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={v => `$${v}`} interval={Math.max(0, Math.floor(oiProfile.chartData.length / 12) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => Math.abs(v).toLocaleString()} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
              labelFormatter={v => `Strike: $${v}`}
              formatter={(v, n, p) => n === "calls"
                ? [`${p.payload.callsRaw.toLocaleString()}`, "Call OI"]
                : [`${p.payload.putsRaw.toLocaleString()}`, "Put OI"]}
            />
            <ReferenceLine x={spot} stroke="rgba(129,140,248,0.7)" strokeDasharray="4 4" label={{ value: `Spot $${spot.toFixed(0)}`, fill: "#818cf8", fontSize: 9, position: "top" }} />
            {oiProfile.maxPainStrike != null && <ReferenceLine x={oiProfile.maxPainStrike} stroke="rgba(249,115,22,0.85)" strokeDasharray="2 2" label={{ value: `Max Pain $${oiProfile.maxPainStrike}`, fill: "#F97316", fontSize: 9, position: "insideTop" }} />}
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
            <Bar dataKey="calls" name="Call OI" fill="#10B981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="puts"  name="Put OI"  fill="#EF4444" radius={[0, 0, 3, 3]} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, paddingLeft: 12, paddingTop: 4 }}>
          Calls above axis (green), puts below (red). The marked strike minimizes OI-weighted intrinsic value. It is not a supported forecast of the expiration price.
        </div>
      </div>
    </>)}

    {/* Term structure */}
    <SH><HelpTip term="termStructure">Term Structure</HelpTip> — ATM IV by Expiration</SH>
    {termStructure.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 8px 6px", marginBottom: 14 }}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={termStructure} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs><linearGradient id="g-term" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
            <XAxis dataKey="dte" tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} tickFormatter={v => `${v}d`} interval={Math.max(0, Math.floor(termStructure.length / 10) - 1)} />
            <YAxis tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, fontFamily: fonts.heading }} formatter={(v) => [`${v.toFixed(1)}%`, "ATM IV"]} labelFormatter={v => `${v} DTE`} />
            <Area type="monotone" dataKey="iv" stroke="#10B981" fill="url(#g-term)" strokeWidth={2} dot={{ r: 3, fill: "#10B981", strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}

    <InfoBox color="#818cf8">
      <strong style={{ color: "var(--text-primary)" }}>Reading the tools.</strong>
      &nbsp;<strong>Implied Move</strong>: a volatility-scaled reference range, not a forecast or guaranteed probability band.
      &nbsp;<strong>Greeks</strong>: Delta measures stock-price sensitivity; Gamma measures its change; Theta measures time decay; Vega measures sensitivity to a 1pp IV shift.
      &nbsp;<strong>Max Pain</strong>: an open-interest statistic, without evidence here of a price-targeting effect. OI includes matching standard roots even when their quotes fail the surface filters.
      &nbsp;<strong>Vol Surface</strong>: quote-checked IV across strikes and expiries. The displayed skew averages different strikes and is not a matched-delta risk reversal. Term-structure changes may warrant checking the event calendar.
    </InfoBox>
  </>);
}

function StockDetailView({ data, onBack, fmpKey }) {
  const { symbol, years, prof } = data;
  const [viewMode, setViewMode] = useState("classic");
  const [descExpanded, setDescExpanded] = useState(false);

  const q = data.quote || {};
  const chg = q.change ?? 0;
  const chgPct = q.changePercentage ?? q.changesPercentage ?? 0;
  const isUp = chg >= 0;
  const chgColor = isUp ? "#4ade80" : "#f87171";
  const fmtNum = (n) => n != null && !isNaN(n) ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
  const fmtBig = (n) => { if (n == null) return "—"; const a = Math.abs(n); if (a >= 1e12) return `$${(n/1e12).toFixed(2)}T`; if (a >= 1e9) return `$${(n/1e9).toFixed(2)}B`; if (a >= 1e6) return `$${(n/1e6).toFixed(2)}M`; return `$${fmtNum(n)}`; };
  const fmtVol = (n) => { if (n == null) return "—"; if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`; if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`; return n.toLocaleString(); };

  // Morningstar-style subtabs — content areas when a stock is in context
  const DETAIL_TABS = [
    { id: "classic",    label: "Research sheet" },
    { id: "summary",    label: "Financial checks" },
    { id: "chart",      label: "Chart" },
    { id: "ratios",     label: "Key Ratios" },
    { id: "financials", label: "Profitability waterfall" },
    { id: "dcf",        label: "Valuation" },
    { id: "peers",      label: "Peers" },
  ];

  const priceChart = (height) => (
    data.hist && data.hist.length > 1 ? (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "16px 16px 10px", marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data.hist} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chgColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={chgColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide={height < 200} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={{ stroke: "rgba(255,255,255,0.06)" }} tickLine={false} interval={Math.max(0, Math.floor((data.hist.length) / 8) - 1)} />
            <YAxis domain={["dataMin", "dataMax"]} hide={height < 200} tick={{ fill: "#475569", fontSize: 9, fontFamily: fonts.mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${Number(v).toFixed(0)}`} orientation="right" />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11, fontFamily: fonts.mono }} labelStyle={{ color: "#94a3b8" }} formatter={(v) => [`$${Number(v).toFixed(2)}`, "Price"]} />
            <Area type="monotone" dataKey="close" stroke={chgColor} fill="url(#priceGrad)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginTop: 4 }}>
          <span>{data.hist[0]?.date}</span>
          <span style={{ color: "#64748b" }}>90-Day Price History</span>
          <span>{data.hist[data.hist.length - 1]?.date}</span>
        </div>
      </div>
    ) : null
  );

  const statCell = (label, val) => (
    <div key={label} style={{ padding: "8px 0" }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: fonts.mono, fontWeight: 500 }}>{val}</div>
    </div>
  );

  return (<div className="stock-detail-shell">
    {/* ── Breadcrumb ── */}
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, fontSize: 11, fontFamily: fonts.mono }}>
      <span onClick={onBack} style={{ color: "#818cf8", cursor: "pointer", borderBottom: "1px dashed rgba(129,140,248,0.4)" }}>Stocks</span>
      <span style={{ color: "#475569" }}>›</span>
      <span style={{ color: "var(--text-secondary)" }}>{prof?.companyName || symbol}</span>
    </div>

    {/* ── In-context header: identity + live price, always visible ── */}
    {viewMode!=='classic'&&(
    <div style={{ background: cardBg, border: cardBorder, borderBottom: "none", borderRadius: "14px 14px 0 0", padding: "18px 22px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.5, lineHeight: 1.15 }}>
            {prof?.companyName || symbol}
            <span style={{ color: "#818cf8", fontSize: 15, fontWeight: 600, marginLeft: 10, fontFamily: fonts.mono }}>{symbol}</span>
          </div>
          <div style={{ fontSize: 10.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 4 }}>
            {prof?.exchangeShortName || "Stock"}{prof?.sector ? ` · ${prof.sector}` : ""}{prof?.industry ? ` · ${prof.industry}` : ""}
          </div>
        </div>
        {data.quote && (
          <div style={{ textAlign: "right" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, justifyContent: "flex-end" }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.mono, lineHeight: 1 }}>${fmtNum(q.price)}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: chgColor, fontFamily: fonts.mono }}>
                {isUp ? "+" : ""}{chg.toFixed(2)} ({isUp ? "+" : ""}{chgPct.toFixed(2)}%)
              </span>
            </div>
            <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 4 }}>
              {q.timestamp ? `As of ${new Date(q.timestamp * 1000).toLocaleString()}` : ""}{q.marketCap || prof?.mktCap ? ` · Mkt Cap ${fmtBig(q.marketCap ?? prof?.mktCap)}` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
    )}

    <nav className="stock-detail-nav" aria-label="Company research">
      {DETAIL_TABS.map(t=><button key={t.id} onClick={()=>setViewMode(t.id)} aria-pressed={viewMode===t.id}>{t.label}</button>)}
    </nav>
    {viewMode==='classic'&&<StockResearchSheet data={data}/>}

    {/* ═══ SUMMARY ═══ */}
    {viewMode === "summary" && (<>
      {priceChart(120)}
      {data.quote && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 22px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 }}>Trading Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(130px, 100%), 1fr))", gap: "0 24px" }}>
            {statCell("Open", `$${fmtNum(q.open)}`)}
            {statCell("Prev Close", `$${fmtNum(q.previousClose)}`)}
            {statCell("Day Range", `$${fmtNum(q.dayLow)} – $${fmtNum(q.dayHigh)}`)}
            {statCell("52-Wk Range", `$${fmtNum(q.yearLow)} – $${fmtNum(q.yearHigh)}`)}
            {statCell("Volume", fmtVol(q.volume))}
            {statCell("Avg Volume", fmtVol(q.avgVolume ?? prof?.volAvg))}
            {statCell("Market Cap", fmtBig(q.marketCap ?? prof?.mktCap))}
            {statCell("P/E", fmtNum(q.pe ?? data.rat?.[data.rat.length-1]?.priceToEarningsRatio))}
            {statCell("EPS", `$${fmtNum(q.eps ?? data.inc?.[data.inc.length-1]?.epsDiluted)}`)}
            {statCell("50-Day Avg", `$${fmtNum(q.priceAvg50 ?? prof?.priceAvg50)}`)}
            {statCell("200-Day Avg", `$${fmtNum(q.priceAvg200 ?? prof?.priceAvg200)}`)}
          </div>
        </div>
      )}
      {/* Valuation vs its own 20-year history */}
      <ValuationBands data={data} fmpKey={fmpKey} />
      {/* Damodaran synthetic credit rating from interest coverage */}
      <SyntheticRating data={data} />
      {/* Dividend safety read */}
      <DividendSafety data={data} fmpKey={fmpKey} />
      {prof?.description && (
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 22px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>About {prof?.companyName || symbol}</div>
          <div style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.65, maxHeight: descExpanded ? "none" : 78, overflow: "hidden" }}>{prof.description}</div>
          <span onClick={() => setDescExpanded(p => !p)} style={{ fontSize: 10, color: "#818cf8", cursor: "pointer", fontFamily: fonts.mono, marginTop: 6, display: "inline-block" }}>{descExpanded ? "Show less ▲" : "Show more ▼"}</span>
        </div>
      )}
    </>)}

    {/* ═══ CHART ═══ */}
    {viewMode === "chart" && priceChart(360)}

    {/* ═══ PEERS ═══ */}
    {viewMode === "peers" && <PeerCompare symbol={symbol} fmpKey={fmpKey} />}

    {/* ═══ FINANCIALS — profit waterfall ═══ */}
    {viewMode === "financials" && <ProfitSankey data={data} />}

    {/* ═══ VALUATION — reverse DCF + price-implied expectations ═══ */}
    {viewMode === "dcf" && (<>
      <ReverseDCF data={data} />
      <PIEPanel data={data} />
    </>)}

    {/* ═══ KEY RATIOS ═══ */}
    {viewMode === "ratios" && (<>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 3 }}>
            <tr>
              <th style={{ padding: "10px 14px", fontSize: 10, color: "#64748b", fontFamily: fonts.mono, textAlign: "left", borderBottom: "2px solid rgba(129,140,248,0.3)", background: "#0f1225", position: "sticky", left: 0, minWidth: 200, zIndex: 4, letterSpacing: 0.5, textTransform: "uppercase" }}>Metric</th>
              {years.map(y => <th key={y} style={{ padding: "10px 8px", fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, textAlign: "right", borderBottom: "2px solid rgba(129,140,248,0.3)", background: "#0f1225", minWidth: 80, letterSpacing: 0.3 }}>{y}</th>)}
            </tr>
          </thead>
          <tbody>
            {DETAIL_SECTIONS.map((section, si) => (<React.Fragment key={section.title}>
              {/* Section header row */}
              <tr>
                <td colSpan={years.length + 1} style={{ padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#818cf8", fontFamily: fonts.heading, background: "rgba(129,140,248,0.06)", borderTop: si > 0 ? "2px solid rgba(129,140,248,0.15)" : "none", borderBottom: "1px solid rgba(129,140,248,0.1)", letterSpacing: 0.5, textTransform: "uppercase" }}>
                  {section.title}
                </td>
              </tr>
              {/* Data rows */}
              {section.rows.map((row, ri) => {
                const isIndented = row.label.startsWith("  ");
                const isGrowth = row.isGrowth;
                const label = isIndented ? row.label.trim() : row.label;
                return (
                  <tr key={`${section.title}-${ri}`} style={{ borderBottom: isGrowth ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(255,255,255,0.03)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: isGrowth ? "3px 14px 3px 38px" : isIndented ? "6px 14px 6px 28px" : "6px 14px", fontSize: isGrowth ? 10 : 11, color: isGrowth ? "#6366f1" : isIndented ? "#64748b" : "#94a3b8", fontFamily: isGrowth ? fonts.mono : fonts.heading, fontWeight: isGrowth ? 400 : isIndented ? 400 : 500, fontStyle: isGrowth ? "italic" : "normal", position: "sticky", left: 0, background: "#161a30", zIndex: 1, whiteSpace: "nowrap" }}>{label}</td>
                    {years.map((y, yi) => { const val = row.get(data, yi); return (
                      <td key={y} style={{ padding: isGrowth ? "3px 8px" : "6px 8px", fontSize: isGrowth ? 10 : 11, color: isGrowth ? (val != null && val < 0 ? "#f87171" : val != null && val > 0 ? "#4ade80" : "#475569") : (val != null && val < 0 ? "#f87171" : "var(--text-primary)"), fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap" }}>{fmtVal(val, row.fmt)}</td>
                    ); })}
                  </tr>
                );
              })}
            </React.Fragment>))}
          </tbody>
        </table>
      </div>
    </>)}
  </div>);
}

function StocksTab({ fmpKey, openTicker, onTickerOpened }) {
  const [tickers, setTickers] = useState(() => {
    // Fast initial render from localStorage; server will override on mount
    try { const saved = localStorage.getItem("econ-dash-tickers"); return saved ? JSON.parse(saved) : DEFAULT_TICKERS; } catch { return DEFAULT_TICKERS; }
  });

  // On mount: pull tickers from server so all devices stay in sync
  useEffect(() => {
    fetch('/api/tickers')
      .then(r => r.json())
      .then(saved => { if (Array.isArray(saved) && saved.length) setTickers(saved); })
      .catch(() => {}); // server unavailable → keep localStorage value
  }, []);

  // On mount: fetch index earnings yields
  useEffect(() => {
    fetch('/api/index-pe')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setIndexYields(d); })
      .catch(() => {});
  }, []);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [detailSymbol, setDetailSymbol] = useState(null);
  const detailRequest = useRef(0);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [stockView, setStockView] = useState("overview"); // "overview" | "sp500" | "screener"
  const [indexYields, setIndexYields] = useState(null);

  const loadData = useCallback(async () => {
    if (!fmpKey) { setError("Enter your FMP API key above to load stock data."); return; }
    setLoading(true); setError("");
    const results = [];
    for (const t of tickers) {
      try { const r = await fetchStockData(t, fmpKey); if (r) results.push(r); } catch (e) { console.error(`Error fetching ${t}:`, e); }
    }
    setData(results);
    setLoading(false);
    if (!results.length) setError("No data returned. Check your FMP key or ticker symbols.");
  }, [fmpKey, tickers]);

  // Persist tickers to localStorage AND server whenever they change
  useEffect(() => {
    try { localStorage.setItem("econ-dash-tickers", JSON.stringify(tickers)); } catch {}
    fetch('/api/tickers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tickers),
    }).catch(() => {});
  }, [tickers]);

  // Auto-load on mount
  const hasLoaded = useRef(false);
  useEffect(() => {
    if (fmpKey && tickers.length && !hasLoaded.current) {
      hasLoaded.current = true;
      loadData();
    }
  }, [fmpKey, tickers, loadData]);

  const removeTicker = (t) => { setTickers(prev => prev.filter(x => x !== t)); setData(prev => prev.filter(x => x.symbol !== t)); };

  const sorted = [...data].sort((a, b) => {
    if (!sortCol) return 0;
    const av = a[sortCol], bv = b[sortCol];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; if (bv == null) return -1;
    return sortDir === "asc" ? av - bv : bv - av;
  });

  const toggleSort = (col) => {
    if (sortCol === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortCol(col); setSortDir("desc"); }
  };

  const openDetail = async (symbol) => {
    const request = ++detailRequest.current;
    setDetailSymbol(symbol);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const d = await fetchStockDetail(symbol, fmpKey);
      if(request===detailRequest.current)setDetailData(d);
    } catch (e) { console.error("Detail fetch error:", e); }
    if(request===detailRequest.current)setDetailLoading(false);
  };

  const closeDetail = () => { detailRequest.current++; setDetailSymbol(null); setDetailData(null); setDetailLoading(false); };

  // Global ticker search from the app header opens that stock's detail view
  useEffect(() => {
    if (openTicker) {
      openDetail(openTicker);
      onTickerOpened && onTickerOpened();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTicker]);

  if (detailSymbol) {
    return (<>
      {detailLoading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontFamily: fonts.heading }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Loading {detailSymbol} details…</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Preparing financial history, recent quarters and market prices.</div>
        </div>
      ) : detailData ? (
        <StockDetailView key={detailData.symbol} data={detailData} onBack={closeDetail} fmpKey={fmpKey} />
      ) : (
        <div style={{ textAlign: "center", padding: 60, color: "#f87171", fontFamily: fonts.heading }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Failed to load data for {detailSymbol}</div>
          <button onClick={closeDetail} style={{ background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 12, cursor: "pointer", fontFamily: fonts.heading }}>← Back to Screener</button>
        </div>
      )}
    </>);
  }

  // View toggle
  const viewToggle = (
    <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", marginBottom: 16, background: "rgba(255,255,255,0.03)", padding: 3 }}>
      {[["overview", "🗺️ S&P Overview"], ["sp500", "STK️ S&P 500"], ["people", "👥 Per Employee"], ["screener", "📊 Watchlist"], ["special", "🎯 Special Situations"]].map(([id, label]) => (
        <button key={id} onClick={() => setStockView(id)} style={{
          flex: 1, padding: "10px 16px", border: "none", borderRadius: 8,
          background: stockView === id ? "linear-gradient(135deg, #1e293b, #1a1a2e)" : "transparent",
          color: stockView === id ? "var(--text-primary)" : "#64748b", fontSize: 12, fontWeight: stockView === id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.2s",
          boxShadow: stockView === id ? "0 2px 8px rgba(0,0,0,0.3)" : "none",
        }}>{label}</button>
      ))}
    </div>
  );

  // Shared ticker management (visible on both screener and CSP views)
  const tickerBar = (<>
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
      <TickerSearch
        fmpKey={fmpKey}
        onSelect={(sym) => { if (sym && !tickers.includes(sym)) setTickers(prev => [...prev, sym]); }}
        placeholder="Add by ticker or company name…"
        icon={false}
        boxStyle={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", width: 230 }}
      />
      <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono }}>adds to watchlist · use the top search bar to just look one up</span>
      {stockView === "screener" && (
        <button onClick={loadData} disabled={loading} style={{ background: "#E8553A", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: loading ? "wait" : "pointer", fontFamily: fonts.heading, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Loading..." : "Fetch Data"}
        </button>
      )}
    </div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
      {tickers.map(t => (
        <span key={t} style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: fonts.mono, color: "#c7d2fe", display: "flex", alignItems: "center", gap: 6 }}>
          {t}
          <span onClick={() => removeTicker(t)} style={{ cursor: "pointer", color: "#f87171", fontWeight: 700, fontSize: 13 }}>×</span>
        </span>
      ))}
    </div>
  </>);

  const yieldTiles = indexYields && (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
      {indexYields.map(idx => {
        const chgColor = idx.changePct > 0 ? "#4ade80" : idx.changePct < 0 ? "#f87171" : "var(--text-muted)";
        return (
          <div key={idx.symbol} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: fonts.heading }}>{idx.flag} {idx.name}</span>
              {idx.changePct != null && (
                <span style={{ fontSize: 11, fontWeight: 600, color: chgColor, fontFamily: fonts.mono }}>
                  {idx.changePct > 0 ? "+" : ""}{(idx.changePct * 100).toFixed(2)}%
                </span>
              )}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: idx.earningsYield != null ? "#4ade80" : "var(--text-muted)", fontFamily: fonts.heading, letterSpacing: -0.5 }}>
              {idx.earningsYield != null ? `${idx.earningsYield.toFixed(2)}%` : "—"}
            </div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: fonts.mono, marginTop: 2 }}>
              Earnings Yield{idx.pe != null ? ` · P/E ${idx.pe.toFixed(1)}` : ""}{idx.price != null ? ` · $${idx.price.toFixed(2)}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );

  const earningsStrip = <EarningsWeekAhead tickers={tickers} fmpKey={fmpKey} />;

  if (stockView === "overview") {
    return (<>
      {viewToggle}
      {yieldTiles}
      {earningsStrip}
      {/* market-level bottom-up valuation (Morningstar) before the name-level map */}
      <MarketFairValuePanel />
      <SP500Overview onSelectStock={openDetail} />
    </>);
  }

  if (stockView === "people") {
    return (<>
      {viewToggle}
      <PeopleScreener onSelectStock={openDetail} />
    </>);
  }

  if (stockView === "special") {
    return (<>
      {viewToggle}
      <SpecialSituations onSelectStock={openDetail} />
    </>);
  }

  if (stockView === "sp500") {
    return (<>
      {viewToggle}
      {yieldTiles}
      {earningsStrip}
      <SP500Screener onSelectStock={openDetail} />
    </>);
  }

  return (<>
    {viewToggle}
    {yieldTiles}
    {earningsStrip}
    {tickerBar}

    <SH>Stock Fundamentals Screener</SH>
    <InfoBox color="#6366F1">
      <strong style={{ color: "var(--text-primary)" }}>Financial Modeling Prep data.</strong> Open a company for its research sheet, with up to 20 years of financial statements, recent fiscal quarters, and market prices. Coverage varies by company.
    </InfoBox>

    {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{error}</div>}

    {/* Data table */}
    {sorted.length > 0 && (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
          <thead>
            <tr>
              {STOCK_COLS.map(col => (
                <th key={col.key} onClick={() => col.key !== "symbol" && toggleSort(col.key)}
                  style={{ padding: "10px 8px", fontSize: 10, color: sortCol === col.key ? "#e2e8f0" : "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", textAlign: col.key === "symbol" ? "left" : "right", borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: col.key !== "symbol" ? "pointer" : "default", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#141829", width: col.width }}>
                  {col.label}{sortCol === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, ri) => (
              <tr key={row.symbol} style={{ borderBottom: ri < sorted.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                {STOCK_COLS.map(col => (
                  <td key={col.key} style={{ padding: "10px 8px", fontSize: 12, fontFamily: col.key === "symbol" ? fonts.mono : fonts.heading, color: col.key === "symbol" ? "#818cf8" : col.key === "changePct" ? (row.changePct > 0 ? "#4ade80" : row.changePct < 0 ? "#f87171" : "var(--text-muted)") : "var(--text-primary)", textAlign: col.key === "symbol" ? "left" : "right", fontWeight: col.key === "symbol" || col.key === "changePct" ? 600 : 400, whiteSpace: "nowrap" }}>
                    {col.key === "symbol" ? (
                      <span onClick={() => openDetail(row.symbol)} style={{ cursor: "pointer", borderBottom: "1px dashed rgba(129,140,248,0.4)", paddingBottom: 1 }}
                        onMouseEnter={e => e.target.style.color = "#a5b4fc"} onMouseLeave={e => e.target.style.color = "#818cf8"}>
                        {row.symbol}
                      </span>
                    ) : fmtVal(row[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {sorted.length > 0 && (
      <div style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginTop: 10 }}>
        Click column headers to sort. ROIC uses NOPAT (operating income × 0.79) / invested capital. SBC/Rev = stock-based compensation as % of revenue.
      </div>
    )}
  </>);
}


export default StocksTab;
export { VolSurface };
