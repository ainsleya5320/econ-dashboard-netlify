import React, { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import { isBankOrInsurer } from "../../lib/stockResearch.js";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, TEAL,
  fin, card, note, tip, axis, chip, DenseHeader, Panel, Note, useIsPhone, chartH,
} from "../../components/dense.jsx";

// ============================================================================
// DEBT & CASH — the stock page's credit and cash-conversion view (replaces
// "Financial checks"; no price history here — that lives on the chart pages).
//   the debt stack      every debt line FMP reports on the latest balance
//                       sheet, leases included, against cash, equity,
//                       capital, EBITDA and market value
//   carrying it         ten years of leverage, coverage, implied borrowing
//                       cost, cash flow to debt and net borrowing
//   cash conversion     how much of reported profit turns into operating and
//                       free cash, what capex and stock pay take out
//   the working-capital machine  days of receivables, inventory and payables,
//                       the cash conversion cycle, turnover and returns
//   recent quarters     debt, cash and quarterly free cash flow
// Everything comes from the statements, ratios and key metrics the stock page
// already fetched (20 annual periods, 8–12 quarters): no extra FMP calls.
// TTM = the last four reported quarters summed (flows) or the latest quarter
// (balances).
// ============================================================================

const n = v => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
// FMP writes 0 where a company does not break a line out (Apple stopped
// reporting interest expense separately in FY2024), so 0 reads as "not reported"
const nz = v => (n(v) ? Math.abs(n(v)) : null);
const div = (a, b) => (fin(a) && fin(b) && b !== 0 ? a / b : null);
const money = v => { if (!fin(v)) return "—"; if (v === 0) return "0"; const a = Math.abs(v), s = v < 0 ? "−" : ""; return a >= 1e12 ? `${s}${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}${(a / 1e6).toFixed(0)}M` : `${s}${(a / 1e3).toFixed(0)}K`; };
const pct = (v, dp = 0) => (fin(v) ? `${(v * 100).toFixed(dp)}%` : "—");
const x = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}×` : "—");
const days = v => (fin(v) ? `${Math.round(v)}d` : "—");
const tone = (v, good, bad, higherBetter = true) => (!fin(v) ? DIM : higherBetter ? (v >= good ? GREEN : v <= bad ? RED : AMBER) : (v <= good ? GREEN : v >= bad ? RED : AMBER));

// annual rows joined across statements by fiscal year
function annual(data) {
  const by = (rows, k) => new Map((rows || []).filter(r => (r.period || "FY") === "FY").map(r => [String(r.fiscalYear), r]));
  const I = by(data.inc), B = by(data.bs), C = by(data.cf), R = by(data.rat), K = by(data.km);
  return [...I.keys()].sort().map(y => ({ y, i: I.get(y) || {}, b: B.get(y) || {}, c: C.get(y) || {}, r: R.get(y) || {}, k: K.get(y) || {} }));
}
function ttm(data) {
  const q = rows => (rows || []).filter(r => /^Q[1-4]$/.test(r.period || ""));
  const qi = q(data.qinc).slice(-4), qc = q(data.qcf).slice(-4), qb = q(data.qbs);
  if (qi.length < 4 || qc.length < 4) return null;
  const sum = (rows, f) => rows.reduce((s, r) => s + (n(r[f]) ?? 0), 0);
  const i = Object.fromEntries(["revenue", "ebit", "ebitda", "operatingIncome", "interestExpense", "interestIncome", "netIncome", "depreciationAndAmortization", "grossProfit", "costOfRevenue"].map(f => [f, sum(qi, f)]));
  const c = Object.fromEntries(["operatingCashFlow", "capitalExpenditure", "freeCashFlow", "stockBasedCompensation", "changeInWorkingCapital", "netDebtIssuance", "interestPaid", "commonStockRepurchased", "netDividendsPaid", "acquisitionsNet", "netIncome", "depreciationAndAmortization"].map(f => [f, sum(qc, f)]));
  // capex is an outflow; a positive quarter is FMP deriving Q4 as FY − 9M with
  // the sign flipped (DECK fiscal Q4 2026), which cancels a year of capex
  const badCapex = qc.some(r => n(r.capitalExpenditure) > 0);
  if (badCapex) { c.capitalExpenditure = null; c.freeCashFlow = null; }
  return { y: "TTM", i, c, b: qb[qb.length - 1] || {}, r: {}, k: {}, through: qi[qi.length - 1]?.date, badCapex };
}
// the measures, computed the same way for every column
function measures(p) {
  const { i, b, c, r, k } = p;
  const debt = n(b.totalDebt), cash = n(b.cashAndShortTermInvestments) ?? n(b.cashAndCashEquivalents);
  const netDebt = fin(debt) && fin(cash) ? debt - cash : n(b.netDebt);
  const ebitda = n(i.ebitda), ebit = n(i.ebit) ?? n(i.operatingIncome), intPaid = nz(c.interestPaid), intExp = nz(i.interestExpense) ?? intPaid;
  const ocf = n(c.operatingCashFlow), capex = fin(n(c.capitalExpenditure)) ? Math.abs(n(c.capitalExpenditure)) : null, fcf = n(c.freeCashFlow) ?? (fin(ocf) && fin(capex) ? ocf - capex : null);
  const ni = n(i.netIncome) ?? n(c.netIncome), rev = n(i.revenue), sbc = n(c.stockBasedCompensation), da = n(i.depreciationAndAmortization) ?? n(c.depreciationAndAmortization);
  const equity = n(b.totalStockholdersEquity);
  return {
    debt, cash, netDebt, ebitda, ebit, intExp, ocf, capex, fcf, ni, rev, sbc, equity,
    stDebt: n(b.shortTermDebt), ltInv: nz(b.longTermInvestments), ltDebt: n(b.longTermDebt), leases: nz(b.capitalLeaseObligations) ?? (((nz(b.capitalLeaseObligationsCurrent) ?? 0) + (nz(b.capitalLeaseObligationsNonCurrent) ?? 0)) || null), intFromCash: !nz(i.interestExpense) && !!intPaid,
    ndEbitda: div(netDebt, ebitda), debtEbitda: div(debt, ebitda), cover: div(ebit, intExp), ebitdaCover: div(ebitda, intExp),
    rate: intExp && fin(debt) && debt > 0 ? intExp / debt : null,
    ocfDebt: div(ocf, debt), debtCap: n(r.debtToCapitalRatio) ?? div(debt, fin(debt) && fin(equity) ? debt + equity : null), debtEq: n(r.debtToEquityRatio) ?? div(debt, equity),
    current: n(r.currentRatio) ?? div(n(b.totalCurrentAssets), n(b.totalCurrentLiabilities)), quick: n(r.quickRatio), cashRatio: n(r.cashRatio),
    dscr: n(r.debtServiceCoverageRatio), borrow: n(c.netDebtIssuance), intPaid,
    ocfNi: div(ocf, ni), fcfNi: div(fcf, ni), fcfMargin: div(fcf, rev), capexRev: div(capex, rev), capexDa: div(capex, da),
    sbcRev: div(sbc, rev), fcfAfterSbc: fin(fcf) ? fcf - (sbc || 0) : null, wc: n(c.changeInWorkingCapital), quality: n(k.incomeQuality) ?? div(ocf, ni),
    dso: n(k.daysOfSalesOutstanding), dio: n(k.daysOfInventoryOutstanding), dpo: n(k.daysOfPayablesOutstanding), ccc: n(k.cashConversionCycle),
    assetTurn: n(r.assetTurnover), fixedTurn: n(r.fixedAssetTurnover), roic: n(k.returnOnInvestedCapital), roce: n(k.returnOnCapitalEmployed),
    gm: div(n(i.grossProfit), rev), ebitMargin: div(ebit, rev), ebitdaMargin: div(ebitda, rev),
    buyback: fin(n(c.commonStockRepurchased)) ? Math.abs(n(c.commonStockRepurchased)) : null, dividends: fin(n(c.netDividendsPaid)) ? Math.abs(n(c.netDividendsPaid)) : null,
  };
}

function HistoryTable({ cols, rows }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
        <thead><tr>
          <th style={{ textAlign: "left", padding: "4px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", borderBottom: "1px solid var(--border-subtle)" }}>measure</th>
          {cols.map(c => <th key={c.y} style={{ textAlign: "right", padding: "4px 6px", fontSize: 8.5, color: c.y === "TTM" ? CYAN : DIM, fontFamily: fonts.mono, borderBottom: "1px solid var(--border-subtle)" }}>{c.y}</th>)}
        </tr></thead>
        <tbody>{rows.map(([label, get, fmt, colorOf]) => (
          <tr key={label} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <td style={{ padding: "3px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{label}</td>
            {cols.map(c => { const v = get(c.m); return <td key={c.y} style={{ padding: "3px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color: colorOf ? colorOf(v) : "var(--text-primary)" }}>{fmt(v)}</td>; })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function DebtCash({ data }) {
  const phone = useIsPhone();
  const [span, setSpan] = useState(10);
  const bank = isBankOrInsurer(data);
  const rows = useMemo(() => annual(data).map(p => ({ y: p.y, m: measures(p) })), [data]);
  const t = useMemo(() => { const p = ttm(data); return p ? { y: "TTM", m: measures(p), through: p.through, badCapex: p.badCapex } : null; }, [data]);
  const quarters = useMemo(() => {
    const qb = (data.qbs || []).filter(r => /^Q/.test(r.period || "")), qc = new Map((data.qcf || []).map(r => [r.date, r]));
    return qb.slice(-8).map(b => { const c = qc.get(b.date) || {}; const debt = n(b.totalDebt), cash = n(b.cashAndShortTermInvestments) ?? n(b.cashAndCashEquivalents); return { d: `${b.fiscalYear} ${b.period}`, debt: debt, cash, net: fin(debt) && fin(cash) ? debt - cash : null, fcf: n(c.capitalExpenditure) > 0 ? null : n(c.freeCashFlow) }; });
  }, [data]);

  if (!rows.length) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>No statement history is available for {data.symbol}.</div>;
  const cols = [...rows.slice(-span), ...(t ? [t] : [])];
  const now = (t || rows[rows.length - 1]).m, lastFY = rows[rows.length - 1].m;
  // cash-conversion reads fall back to the last fiscal year when TTM capex is unusable
  const conv = fin(now.fcfNi) ? now : lastFY, convLbl = conv === now ? "" : ` (FY${rows[rows.length - 1].y})`;
  const cur = data.inc?.[data.inc.length - 1]?.reportedCurrency || "";
  const mcap = n(data.quote?.marketCap) ?? n(data.prof?.marketCap);
  const netCash = fin(now.netDebt) && now.netDebt < 0;
  const chart = rows.slice(-span).map(({ y, m }) => ({ y, debt: m.debt, cash: m.cash, nd: fin(m.ndEbitda) ? +m.ndEbitda.toFixed(2) : null, ni: m.ni, ocf: m.ocf, fcf: m.fcf, dso: m.dso, dio: m.dio, dpo: m.dpo, ccc: m.ccc }));
  const scale = v => (fin(v) ? v / 1e9 : null);
  const fmtB = v => (fin(v) ? `${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}B` : "—");

  return (<>
    <DenseHeader
      eyebrow={`Debt & cash · ${data.symbol} · ${cur}${t ? ` · TTM through ${t.through}` : ""}`}
      headline={bank ? <>Funding: {money(now.debt)} of borrowings against {money(now.equity)} of equity ({x(now.debtEq, 2)}); {money(now.cash)} of cash and short-term investments</> : <>
        {netCash ? <>Net cash of {money(-now.netDebt)}</> : fin(now.netDebt) ? <>Net debt {money(now.netDebt)}{fin(now.ndEbitda) ? `, ${x(now.ndEbitda)} EBITDA` : ""}</> : "Debt position unavailable"}
        {fin(now.cover) ? <>; interest covered {x(now.cover)} by operating profit</> : now.intExp ? "" : "; interest expense not broken out"}
        {fin(conv.fcfNi) ? <>; {pct(conv.fcfNi)} of net income arrives as free cash{convLbl}</> : ""}
      </>}
      blurb={bank
        ? <>This is a bank or insurer: its debt is its raw material, so leverage and coverage ratios built for industrial companies do not apply. Read the balance sheet lines as funding structure, not credit risk.</>
        : <>Leverage is judged against earnings power (EBITDA) and against the interest bill, then against cash: a company that turns profit into cash can carry more debt than its ratios alone suggest. Values in {cur || "reported currency"}; debt includes finance and operating lease liabilities where the company reports them.</>}
      meta={<>FMP statements, ratios and key metrics<br />{rows.length} fiscal years{data.qbs?.length ? `, ${data.qbs.length} quarters` : ""}</>}
      chips={[
        chip(netCash ? "net cash" : "net debt", money(netCash ? -now.netDebt : now.netDebt), netCash ? GREEN : "var(--text-primary)", `debt ${money(now.debt)} · cash ${money(now.cash)}`),
        chip("net debt / EBITDA", netCash ? "net cash" : x(now.ndEbitda), bank ? SLATE : netCash ? GREEN : tone(now.ndEbitda, 2, 4, false), "above 4× is stretched"),
        chip("interest cover", x(now.cover), bank ? SLATE : tone(now.cover, 6, 2.5), "EBIT ÷ interest expense"),
        chip("implied rate", pct(now.rate, 1), "var(--text-primary)", "interest ÷ total debt"),
        chip("debt / capital", pct(now.debtCap), bank ? SLATE : tone(now.debtCap, 0.4, 0.65, false), fin(mcap) && fin(now.debt) ? `debt ${pct(now.debt / mcap)} of market cap` : ""),
        chip("FCF / net income", pct(conv.fcfNi), bank ? SLATE : tone(conv.fcfNi, 0.9, 0.6), `cash conversion${convLbl}`),
        chip("cash cycle", days(lastFY.ccc), "var(--text-primary)", `FY: ${days(lastFY.dso)} DSO · ${days(lastFY.dio)} DIO · ${days(lastFY.dpo)} DPO`),
        chip("capex / D&A", x(conv.capexDa), "var(--text-primary)", `above 1× = growing the asset base${convLbl}`),
      ]}
    />

    <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
      <span style={note}>History</span>
      {[5, 10, 20].map(s => <button key={s} onClick={() => setSpan(s)} style={{ padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono, border: `1px solid ${span === s ? "#818cf8" : "var(--border-subtle)"}`, background: span === s ? "rgba(129,140,248,0.15)" : "transparent", color: span === s ? "#c7d2fe" : SLATE }}>{s} years</button>)}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="The debt stack" right={`latest balance sheet${t ? ` · ${t.through}` : ""}`} style={{ marginBottom: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}><tbody>
          {[
            ["Short-term debt", now.stDebt], ["Long-term debt", now.ltDebt], ["Lease liabilities", now.leases], ["Total debt", now.debt, true],
            ["Cash & short-term investments", now.cash], ...(now.ltInv ? [["Long-term investments (not netted)", now.ltInv]] : []), [netCash ? "Net cash" : "Net debt", netCash ? -now.netDebt : now.netDebt, true],
          ].map(([l, v, strong]) => (
            <tr key={l} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", fontWeight: strong ? 700 : 400 }}>{l}</td>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "var(--text-primary)", fontWeight: strong ? 700 : 400 }}>{money(v)}</td>
            </tr>
          ))}
          {[
            ["Debt / equity", x(now.debtEq, 2)], ["Debt / EBITDA", x(now.debtEbitda)], ["Debt / market value", fin(mcap) ? pct(div(now.debt, mcap)) : "—"],
            ["Current ratio", x(now.current, 2)], ["Quick ratio", x(lastFY.quick, 2)], ["Cash ratio", x(lastFY.cashRatio, 2)],
          ].map(([l, v]) => (
            <tr key={l} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: DIM }}>{l}</td>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "var(--text-secondary)" }}>{v}</td>
            </tr>
          ))}
        </tbody></table>
        <Note>Lease liabilities are counted in total debt where FMP includes them. Net debt nets only cash and short-term investments; long-term securities are shown but not subtracted, since they may be illiquid or strategic stakes. the quick and cash ratios are fiscal-year figures from FMP&apos;s ratios. FMP does not carry maturity schedules or agency ratings — the 10-K debt footnote is where the maturity wall lives.</Note>
      </Panel>

      <Panel title="Debt against cash, and leverage" right="bars $B · line net debt ÷ EBITDA" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 230)}>
          <ComposedChart data={chart.map(c => ({ ...c, debt: scale(c.debt), cash: scale(c.cash) }))} margin={{ top: 6, right: phone ? 4 : 0, left: phone ? -18 : -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="y" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={16} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={fmtB} />
            <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}×`} hide={phone} />
            <ReferenceLine yAxisId="r" y={0} stroke="var(--border-subtle)" />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={(v, nm) => [nm.includes("EBITDA") ? x(v) : fmtB(v), nm]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <Bar yAxisId="l" dataKey="debt" name="total debt" fill={RED} fillOpacity={0.6} />
            <Bar yAxisId="l" dataKey="cash" name="cash & investments" fill={GREEN} fillOpacity={0.55} />
            <Line yAxisId="r" type="monotone" dataKey="nd" name="net debt ÷ EBITDA" stroke={AMBER} strokeWidth={2} dot={{ r: 2 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
    </div>

    <Panel title="Carrying the debt" right={`${span}-year record${t ? " plus TTM" : ""}`}>
      <HistoryTable cols={cols} rows={[
        ["Total debt", m => m.debt, money],
        ["Net debt (− = net cash)", m => m.netDebt, money],
        ["Net debt ÷ EBITDA", m => m.ndEbitda, v => x(v), v => (bank ? DIM : fin(v) && v < 0 ? GREEN : tone(v, 2, 4, false))],
        ["EBIT ÷ interest", m => m.cover, v => x(v), v => (bank ? DIM : tone(v, 6, 2.5))],
        ["EBITDA ÷ interest", m => m.ebitdaCover, v => x(v)],
        ["Interest expense", m => (m.intFromCash ? null : m.intExp), money],
        ["Interest paid (cash)", m => m.intPaid, money],
        ["Implied rate on debt", m => m.rate, v => pct(v, 1)],
        ["Operating cash flow ÷ debt", m => m.ocfDebt, v => pct(v), v => (bank ? DIM : tone(v, 0.4, 0.15))],
        ["Debt ÷ capital", m => m.debtCap, v => pct(v)],
        ["Debt-service coverage", m => m.dscr, v => x(v)],
        ["Net borrowing (+) / repayment (−)", m => m.borrow, money, v => (fin(v) ? (v > 0 ? AMBER : GREEN) : DIM)],
      ]} />
      <Note>Where the income statement does not break interest out, coverage and the implied rate use cash interest paid instead; blank means FMP has neither. The implied rate is this year&apos;s interest expense over year-end debt — a rough read of what the company pays, which rises as cheap old debt is refinanced. Net borrowing comes from the cash-flow statement: positive means the company added debt that year.</Note>
    </Panel>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Profit into cash" right="net income · operating cash flow · free cash flow, $B" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 220)}>
          <ComposedChart data={chart.map(c => ({ y: c.y, ni: scale(c.ni), ocf: scale(c.ocf), fcf: scale(c.fcf) }))} margin={{ top: 6, right: 8, left: phone ? -18 : -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="y" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={16} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={fmtB} />
            <ReferenceLine y={0} stroke="var(--border-subtle)" />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={(v, nm) => [fmtB(v), nm]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <Bar dataKey="ni" name="net income" fill={SLATE} fillOpacity={0.6} />
            <Bar dataKey="ocf" name="operating cash flow" fill={CYAN} fillOpacity={0.65} />
            <Bar dataKey="fcf" name="free cash flow" fill={GREEN} fillOpacity={0.7} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="The working-capital machine" right="days · cash conversion cycle = DSO + DIO − DPO" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 220)}>
          <ComposedChart data={chart} margin={{ top: 6, right: 8, left: phone ? -18 : -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="y" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} minTickGap={16} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}d`} />
            <ReferenceLine y={0} stroke="var(--border-subtle)" />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={(v, nm) => [days(v), nm]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <Line type="monotone" dataKey="dso" name="receivables (DSO)" stroke={INDIGO} strokeWidth={1.4} dot={false} connectNulls />
            <Line type="monotone" dataKey="dio" name="inventory (DIO)" stroke={AMBER} strokeWidth={1.4} dot={false} connectNulls />
            <Line type="monotone" dataKey="dpo" name="payables (DPO)" stroke={TEAL} strokeWidth={1.4} dot={false} connectNulls />
            <Line type="monotone" dataKey="ccc" name="cash conversion cycle" stroke="var(--text-primary)" strokeWidth={2.2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
    </div>

    <Panel title="Cash conversion and operating metrics" right={`${span}-year record${t ? " plus TTM" : ""}`}>
      <HistoryTable cols={cols} rows={[
        ["Operating cash flow ÷ net income", m => m.ocfNi, v => pct(v), v => tone(v, 1, 0.8)],
        ["Free cash flow ÷ net income", m => m.fcfNi, v => pct(v), v => tone(v, 0.9, 0.6)],
        ["Free-cash-flow margin", m => m.fcfMargin, v => pct(v, 1)],
        ["FCF after stock compensation", m => m.fcfAfterSbc, money],
        ["Stock compensation ÷ revenue", m => m.sbcRev, v => pct(v, 1), v => tone(v, 0.03, 0.1, false)],
        ["Capex ÷ revenue", m => m.capexRev, v => pct(v, 1)],
        ["Capex ÷ depreciation", m => m.capexDa, v => x(v)],
        ["Working-capital change (cash)", m => m.wc, money, v => (fin(v) ? (v >= 0 ? GREEN : AMBER) : DIM)],
        ["Buybacks", m => m.buyback, money],
        ["Dividends paid", m => m.dividends, money],
        ["Gross margin", m => m.gm, v => pct(v, 1)],
        ["EBIT margin", m => m.ebitMargin, v => pct(v, 1)],
        ["Days sales outstanding", m => m.dso, days],
        ["Days inventory outstanding", m => m.dio, days],
        ["Days payables outstanding", m => m.dpo, days],
        ["Cash conversion cycle", m => m.ccc, days],
        ["Asset turnover", m => m.assetTurn, v => x(v, 2)],
        ["Fixed-asset turnover", m => m.fixedTurn, v => x(v, 1)],
        ["Return on invested capital", m => m.roic, v => pct(v, 1), v => tone(v, 0.12, 0.06)],
        ["Return on capital employed", m => m.roce, v => pct(v, 1)],
      ]} />
      <Note>
        Cash conversion above 100% means reported profit understates cash (heavy depreciation, customer prepayments); persistently below 80% means
        profit is being tied up in receivables, inventory or capex. Free cash flow after stock compensation treats stock pay as the cash cost it
        replaces. Working-capital days, turnover and returns are FMP key metrics, so the TTM column is blank for them.
        {t?.badCapex && <> <span style={{ color: AMBER }}>TTM capex and free cash flow are blank: one of FMP&apos;s last four quarters reports capex with the wrong sign, so the sum would be wrong. The fiscal-year columns are unaffected.</span></>}
      </Note>
    </Panel>

    {quarters.length > 0 && (
      <Panel title="Recent quarters" right="debt, cash and free cash flow by quarter">
        <HistoryTable cols={quarters.map(q => ({ y: q.d, m: q }))} rows={[
          ["Total debt", m => m.debt, money],
          ["Cash & investments", m => m.cash, money],
          ["Net debt (− = net cash)", m => m.net, money],
          ["Free cash flow", m => m.fcf, money, v => (fin(v) ? (v >= 0 ? GREEN : RED) : DIM)],
        ]} />
      </Panel>
    )}
  </>);
}
