import React, { useMemo } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import { INDUSTRY_AS_OF, DAMODARAN_INPUTS, returnOnCapital, companyYardstick } from "../../lib/costOfCapital.js";
import { GREEN, RED, SLATE, INDIGO, fin, tip, axis, chip, DenseHeader, Panel, Note, useIsPhone, chartH } from "../../components/dense.jsx";

// ============================================================================
// VALUATION TAB, the Damodaran panels (src/lib/costOfCapital.js does the math):
//   Cost of capital        the bottom-up build-up, line by line, beside the
//                          industry and the market at today's rates
//   Earning its keep?      return on capital each year against today's cost
//                          of capital (his excess-return lens)
//   Against its industry   risk, returns and multiples beside his industry and
//                          market averages. Margins, working capital and
//                          reinvestment sit on Debt & cash next to the
//                          company's own history, so each figure has one home.
// ============================================================================

const p1 = v => (fin(v) ? `${(v * 100).toFixed(1)}%` : "—");
const p2 = v => (fin(v) ? `${(v * 100).toFixed(2)}%` : "—");
const pts = v => (fin(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} pts` : "—");
const x2 = v => (fin(v) ? v.toFixed(2) : "—");
const mx = v => (fin(v) ? `${v.toFixed(1)}×` : "—");
const money = v => { if (!fin(v)) return "—"; const a = Math.abs(v); return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`; };
const indLabel = ind => (ind.how === "market" ? `the market (FMP industry "${ind.fmp || "none"}" has no Damodaran match)` : `${ind.name}${ind.row?.n ? `, ${ind.row.n} firms` : ""}`);
const th = (t, align = "right") => <th key={t} style={{ padding: "5px 8px", fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{t}</th>;
const tdS = { padding: "4px 8px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color: "var(--text-secondary)" };

export function CostOfCapitalPanel({ data, coc, inputs }) {
  const { ind } = coc;
  const build = coc.equityOnly ? [
    ["Riskfree rate", p2(coc.rf), inputs.rfLabel],
    ["Levered beta", x2(coc.betaL), `${ind.name} average, as published (Damodaran, ${INDUSTRY_AS_OF}): for banks and insurers debt is raw material, so the beta is not relevered`],
    ["Equity risk premium", p2(coc.erp), inputs.erpLabel],
    ["Cost of equity", p2(coc.ke), `${p2(coc.rf)} + ${x2(coc.betaL)} × ${p2(coc.erp)}`, true],
  ] : [
    ["Riskfree rate", p2(coc.rf), inputs.rfLabel],
    ["Business beta (unlevered)", x2(coc.betaU), `${ind.name}, corrected for cash (Damodaran, ${INDUSTRY_AS_OF})`],
    ["Debt ÷ equity (market)", p1(coc.de), `debt ${money(coc.debt)} ÷ market value ${money(coc.mcap)}`],
    ["Levered beta", x2(coc.betaL), `${x2(coc.betaU)} × (1 + (1 − ${p1(coc.t)}) × ${p1(coc.de)})`],
    ["Equity risk premium", p2(coc.erp), inputs.erpLabel],
    ["Cost of equity", p2(coc.ke), `${p2(coc.rf)} + ${x2(coc.betaL)} × ${p2(coc.erp)}`, true],
    ["Synthetic rating", coc.rating ? coc.rating.rating : "—", coc.rating ? `interest coverage ${coc.coverage.toFixed(1)}×${coc.interestEst ? " (no interest reported, so estimated at riskfree + industry spread on its debt)" : ""} → his ${coc.rating.large ? "large" : "small"}-firm table, default spread ${p2(coc.rating.spread)}` : coc.kdBasis === "industry" ? (coc.lossMaking ? "operating loss: a coverage-based rating would read D, so the industry's credit spread stands in" : "no interest expense reported, so the industry's credit spread stands in") : "no debt cost available"],
    ["Pre-tax cost of debt", p2(coc.kdPre), coc.rating ? `${p2(coc.rf)} + ${p2(coc.rating.spread)}` : "riskfree + industry spread"],
    ["After-tax cost of debt", p2(coc.kdAfter), `× (1 − ${p1(coc.t)} marginal tax rate)`],
    ["Weights", `${p1(coc.wE)} / ${p1(coc.wD)}`, "equity / debt, at market value (debt at book, leases included)"],
    ["Cost of capital", p2(coc.wacc), `${p1(coc.wE)} × ${p2(coc.ke)} + ${p1(coc.wD)} × ${p2(coc.kdAfter)}`, true],
  ];
  const row = ind.row || {}, mk = coc.market || {}, iN = coc.indNow || {}, mN = coc.marketNow || {};
  const compare = coc.equityOnly ? [
    ["Levered beta", x2(coc.betaL), x2(row.beta), x2(row.beta), x2(mk.beta)],
    ["Cost of equity", p2(coc.ke), p2(iN.ke), p2(row.ke), p2(mN.ke)],
  ] : [
    ["Levered beta", x2(coc.betaL), x2(row.beta), x2(row.beta), x2(mk.beta)],
    ["Cost of equity", p2(coc.ke), p2(iN.ke), p2(row.ke), p2(mN.ke)],
    ["Pre-tax cost of debt", p2(coc.kdPre), p2(iN.kdPre), p2(row.kdPre), p2(mN.kdPre)],
    ["Debt ÷ (debt + equity)", p1(coc.wD), p1(row.dW), p1(row.dW), p1(mk.dW)],
    ["Cost of capital", p2(coc.wacc), p2(iN.wacc), p2(row.wacc), p2(mN.wacc)],
  ];
  const gap = fin(coc.wacc) && fin(iN.wacc) ? coc.wacc - iN.wacc : fin(coc.ke) && fin(iN.ke) ? coc.ke - iN.ke : null;
  return (<>
    <DenseHeader
      eyebrow={`Cost of capital · ${data.symbol} · Damodaran's bottom-up method`}
      headline={coc.equityOnly
        ? <>Cost of equity {p1(coc.ke)}. {data.symbol} is a financial firm, valued on equity, so there is no weighted cost of capital.</>
        : <>Cost of capital {p1(coc.wacc)}: equity at {p1(coc.ke)}, debt at {p1(coc.kdAfter)} after tax, {p1(coc.wD)} of the mix in debt{fin(gap) ? <>; {Math.abs(gap) < 0.0025 ? "in line with" : gap > 0 ? `${pts(gap).replace("+", "")} above` : `${pts(-gap).replace("+", "")} below`} its industry at today&apos;s rates</> : null}.</>}
      blurb={<>The beta of the business — his industry average, stripped of debt and cash — relevered at {data.symbol}&apos;s own debt, priced at today&apos;s 10-year Treasury and his latest implied equity risk premium. His January industry figures are re-priced at today&apos;s rates so the comparison is like for like. The Valuation models below start from this rate.</>}
      meta={<>Industry: {indLabel(ind)}<br />{ind.fmp ? `FMP: ${ind.fmp}` : ""}</>}
      chips={[
        chip("riskfree", p2(coc.rf), "var(--text-primary)", "10-year Treasury"),
        chip("equity risk premium", p2(coc.erp), "var(--text-primary)", "Damodaran, implied"),
        chip("levered beta", x2(coc.betaL), "var(--text-primary)", `industry ${x2(row.beta)}`),
        chip("cost of equity", p2(coc.ke), "var(--text-primary)", `industry ${p2(iN.ke)}`),
        ...(coc.equityOnly ? [] : [
          chip("synthetic rating", coc.rating?.rating || "—", "var(--text-primary)", coc.rating ? `spread ${p2(coc.rating.spread)}` : "industry spread used"),
          chip("cost of capital", p2(coc.wacc), INDIGO, `industry ${p2(iN.wacc)} · market ${p2(mN.wacc)}`),
        ]),
      ]}
    />
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="The build-up" right="each line feeds the next" style={{ marginBottom: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}><tbody>
          {build.map(([l, v, how, strong]) => (
            <tr key={l} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "var(--text-secondary)", fontWeight: strong ? 700 : 400, whiteSpace: "nowrap" }}>{l}</td>
              <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", color: "var(--text-primary)", fontWeight: strong ? 700 : 400, whiteSpace: "nowrap" }}>{v}</td>
              <td style={{ padding: "4px 6px", fontSize: 9.5, fontFamily: fonts.mono, color: "var(--text-muted)" }}>{how}</td>
            </tr>
          ))}
        </tbody></table>
      </Panel>
      <Panel title="Against its industry and the market" right={`${ind.name} · today's rates vs his January figures`} style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
            <thead><tr>{th("", "left")}{th(data.symbol)}{th("Industry today")}{th("Industry, Jan")}{th("Market today")}</tr></thead>
            <tbody>{compare.map(([l, ...v]) => (
              <tr key={l} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ ...tdS, textAlign: "left" }}>{l}</td>
                {v.map((x, i) => <td key={i} style={{ ...tdS, color: i === 0 ? "var(--text-primary)" : tdS.color, fontWeight: i === 0 ? 700 : 400 }}>{x}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <Note>
          His January costs were set at a {p2(DAMODARAN_INPUTS.rf)} T-bond and a {p2(DAMODARAN_INPUTS.erp)} premium; "today" keeps each industry&apos;s beta, debt mix and credit spread and swaps in today&apos;s rates. Default spreads come from his January ratings table.
          {ind.how === "market" ? " This company's FMP industry has no Damodaran match, so the market average stands in for the industry." : ""}
        </Note>
      </Panel>
    </div>
  </>);
}

// Return on capital each year against today's cost of capital. Financial firms:
// return on equity against the cost of equity.
export function ExcessReturnPanel({ data, coc }) {
  const phone = useIsPhone();
  const eq = coc.equityOnly;
  const series = useMemo(() => {
    if (!eq) return returnOnCapital(data).slice(-11).map(r => ({ y: r.y, v: r.roic }));
    const bsBy = new Map((data.bs || []).map(b => [String(b.fiscalYear), b]));
    return (data.inc || []).map(r => { const prev = bsBy.get(String(Number(r.fiscalYear) - 1)); return prev?.totalStockholdersEquity > 0 && fin(r.netIncome) ? { y: String(r.fiscalYear), v: r.netIncome / prev.totalStockholdersEquity } : null; }).filter(Boolean).slice(-10);
  }, [data, eq]);
  const hurdle = eq ? coc.ke : coc.wacc;
  if (!series.length || !fin(hurdle)) return null;
  const last = series[series.length - 1], spread = last.v - hurdle;
  const annual = series.filter(s => s.y !== "TTM");
  const above = annual.filter(s => s.v > hurdle).length;
  const avg5 = annual.slice(-5).reduce((s, r) => s + r.v, 0) / Math.max(1, annual.slice(-5).length);
  const indRet = eq ? coc.ind.row?.roe : coc.ind.row?.roc, indHurdle = eq ? coc.indNow?.ke : coc.indNow?.wacc;
  const indSpread = fin(indRet) && fin(indHurdle) ? indRet - indHurdle : null;
  const what = eq ? "return on equity" : "return on capital", hurdleName = eq ? "cost of equity" : "cost of capital";
  return (<>
    <DenseHeader
      eyebrow={`Earning its keep? · ${what} vs ${hurdleName}`}
      headline={<>{p1(last.v)} {what} ({last.y === "TTM" ? "trailing year" : `FY${last.y}`}) against a {p1(hurdle)} {hurdleName}: {pts(spread)} — {spread > 0.005 ? "growth here creates value" : spread < -0.005 ? "growth here destroys value; each new dollar invested earns less than it costs" : "growth roughly breaks even on value"}.</>}
      blurb={<>Damodaran&apos;s test of a business: a company that earns more on capital than capital costs creates value when it grows; one that earns less destroys value with every dollar it reinvests, however fast it grows. {eq ? "Banks and insurers are judged on equity: net income ÷ last year's book equity." : "Return on capital is his definition: operating income after tax ÷ (debt + equity − cash) at the start of the year."}</>}
      chips={[
        chip(what, p1(last.v), spread > 0 ? GREEN : RED, last.y === "TTM" ? "trailing year" : `FY${last.y}`),
        chip(hurdleName, p1(hurdle), "var(--text-primary)", "today's rates"),
        chip("excess return", pts(spread), spread > 0 ? GREEN : RED, spread > 0 ? "creating value" : "destroying value"),
        chip("industry excess", pts(indSpread), "var(--text-primary)", `${coc.ind.name}, today's rates`),
        chip("5-year average", p1(avg5), "var(--text-primary)", `${above} of ${annual.length} years above the hurdle`),
      ]}
    />
    <Panel title={`${what[0].toUpperCase()}${what.slice(1)} by year`} right={`solid line: today's ${hurdleName} · dashed: ${coc.ind.name} average`}>
      <ResponsiveContainer width="100%" height={chartH(phone, 210)}>
        <ComposedChart data={series.map(s => ({ y: s.y, v: +(s.v * 100).toFixed(2) }))} margin={{ top: 8, right: 8, left: phone ? -18 : -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="y" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={v => [`${Number(v).toFixed(1)}%`, what]} />
          <ReferenceLine y={0} stroke="var(--border-subtle)" />
          <Bar dataKey="v" name={what} radius={[3, 3, 0, 0]}>
            {series.map(s => <Cell key={s.y} fill={s.v >= hurdle ? GREEN : RED} fillOpacity={s.y === "TTM" ? 0.95 : 0.7} />)}
          </Bar>
          <ReferenceLine y={+(hurdle * 100).toFixed(2)} stroke="var(--text-primary)" strokeWidth={1.5} label={{ value: `${hurdleName} ${p1(hurdle)}`, position: "insideTopRight", fill: "var(--text-secondary)", fontSize: 9.5, fontFamily: fonts.mono }} />
          {fin(indRet) && <ReferenceLine y={+(indRet * 100).toFixed(2)} stroke={SLATE} strokeDasharray="5 4" label={{ value: `industry ${p1(indRet)}`, position: "insideBottomRight", fill: "var(--text-muted)", fontSize: 9.5, fontFamily: fonts.mono }} />}
        </ComposedChart>
      </ResponsiveContainer>
      <Note>Green bars clear today&apos;s {hurdleName}, red ones fall short. Every year is held to today&apos;s rate; Treasury yields were lower through most of the decade, so earlier years cleared a lower bar than this one shows.</Note>
    </Panel>
  </>);
}

// risk, returns and multiples beside his industry and market averages
export function IndustryYardstick({ data, coc }) {
  const c = useMemo(() => companyYardstick(data, coc), [data, coc]);
  const row = coc.ind.row || {}, mk = coc.market || {};
  const prem = (a, b) => (fin(a) && fin(b) && b > 0 && a > 0 ? a / b - 1 : null);
  const dif = (a, b) => (fin(a) && fin(b) ? a - b : null);
  const rows = [
    ["Risk", "Levered beta", c.beta, row.beta, mk.beta, x2, "x"],
    ["Risk", "Debt ÷ equity (market)", c.de, row.de, mk.de, p1, "pts"],
    ["Returns", `Return on capital (${c.rocBasis === "TTM" ? "trailing" : c.rocBasis ? `FY${c.rocBasis}` : "—"})`, c.roc, row.roc, mk.roc, p1, "pts"],
    ["Returns", "Return on equity", c.roe, row.roe, mk.roe, p1, "pts"],
    ["Returns", "Sales ÷ invested capital", c.s2c, row.s2c, mk.s2c, v => (fin(v) ? `${v.toFixed(2)}×` : "—"), "x"],
    ["Multiples", "P/E, trailing", c.peTrail, row.peTrail, mk.peTrail, mx, "prem"],
    ["Multiples", `P/E, forward${c.peFwdYear ? ` (FY${c.peFwdYear})` : ""}`, c.peFwd, row.peFwd, mk.peFwd, mx, "prem"],
    ["Multiples", "EV / EBITDA", c.evEbitda, row.evEbitda, mk.evEbitda, mx, "prem"],
    ["Multiples", "EV / EBIT", c.evEbit, row.evEbit, mk.evEbit, mx, "prem"],
    ["Multiples", "EV / sales", c.evS, row.evS, mk.evS, v => (fin(v) ? `${v.toFixed(2)}×` : "—"), "prem"],
    ["Multiples", "Price / book", c.pbv, row.pbv, mk.pbv, mx, "prem"],
    ["Multiples", "EV / invested capital", c.evIc, row.evIc, mk.evIc, mx, "prem"],
  ];
  // banks, insurers and brokers: enterprise value and invested capital mean
  // nothing when debt is the raw material, so only equity measures are shown
  const EQ_ROWS = new Set(["Levered beta", "Return on equity", "P/E, trailing", "Price / book"]);
  const shown = coc.equityOnly ? rows.filter(r => EQ_ROWS.has(r[1]) || r[1].startsWith("P/E, forward")) : rows;
  const evPrem = coc.equityOnly ? prem(c.peTrail, row.peTrail) : prem(c.evEbitda, row.evEbitda) ?? prem(c.peTrail, row.peTrail), rocGap = coc.equityOnly ? null : dif(c.roc, row.roc);
  const versus = (kind, a, b) => {
    if (kind === "prem") { const p = prem(a, b); return p == null ? "—" : `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(0)}%`; }
    if (kind === "pts") return pts(dif(a, b));
    const r = fin(a) && fin(b) && b !== 0 ? a / b : null; return r == null ? "—" : `${r.toFixed(2)}× its`;
  };
  return (
    <Panel title={`Against its industry · ${coc.ind.name}`} right={`Damodaran's U.S. averages, ${INDUSTRY_AS_OF}${!coc.equityOnly && c.ev ? ` · EV ${money(c.ev)}` : ""}`}>
      {(fin(evPrem) || fin(rocGap)) && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, margin: "2px 0 8px" }}>
          {fin(evPrem) ? <>Priced {Math.abs(evPrem) < 0.05 ? "in line with" : `${Math.abs(evPrem * 100).toFixed(0)}% ${evPrem > 0 ? "above" : "below"}`} its industry on {!coc.equityOnly && fin(prem(c.evEbitda, row.evEbitda)) ? "EV/EBITDA" : "trailing P/E"}</> : "No comparable multiple"}
          {fin(rocGap) ? <>, earning {Math.abs(rocGap) < 0.01 ? "about the same" : `${Math.abs(rocGap * 100).toFixed(1)} points ${rocGap > 0 ? "more" : "less"}`} on capital.</> : "."}
          {fin(evPrem) && fin(rocGap) && <span style={{ fontWeight: 400, color: "var(--text-secondary)", fontSize: 11 }}> {evPrem > 0.05 && rocGap > 0.02 ? " A premium the returns can support." : evPrem > 0.05 && rocGap <= 0 ? " A premium without the returns to back it." : evPrem < -0.05 && rocGap >= 0 ? " A discount despite returns at or above the industry's — worth a look." : evPrem < -0.05 ? " A discount that matches weaker returns." : ""}</span>}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead><tr>{th("", "left")}{th(data.symbol)}{th("Industry")}{th("Market")}{th("vs industry")}</tr></thead>
          <tbody>{shown.map(([g, l, a, b, m, f, kind], i) => (
            <tr key={l} style={{ borderBottom: "1px solid var(--border-subtle)", borderTop: i && shown[i - 1][0] !== g ? "1px solid var(--text-muted)" : undefined }}>
              <td style={{ ...tdS, textAlign: "left" }}>{l}</td>
              <td style={{ ...tdS, color: "var(--text-primary)", fontWeight: 700 }}>{f(a)}</td>
              <td style={tdS}>{f(b)}</td>
              <td style={tdS}>{f(m)}</td>
              <td style={{ ...tdS, color: "var(--text-muted)" }}>{versus(kind, a, b)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Note>
        His industry averages for U.S. firms ({coc.ind.row?.n ?? "—"} in {coc.ind.name}); EV/EBITDA and EV/EBIT use only firms with positive EBITDA. Company figures are the trailing year at today&apos;s price; EV = market value + debt − cash. Margins, working capital and reinvestment are compared on Debt &amp; cash beside the company&apos;s own history.
      </Note>
    </Panel>
  );
}
