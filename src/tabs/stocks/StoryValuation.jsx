import React, { useEffect, useMemo, useState } from "react";
import { fonts } from "../../lib/styles.js";
import { MARGINAL_TAX, companyYardstick } from "../../lib/costOfCapital.js";
import { GREEN, RED, INDIGO, fin, chip, DenseHeader, Panel, Note } from "../../components/dense.jsx";

// ============================================================================
// YOUR STORY, VALUED — a simplified version of Damodaran's FCFF "Ginzu":
// the reverse DCF above reads what the price assumes; this prices the
// assumptions you choose.
//   revenue      year-1 growth, a years 2–5 pace, then a straight fade to the
//                terminal growth rate by year 10
//   margin       today's operating margin moves in a straight line to a target
//                margin, reached in the year you choose
//   reinvestment each extra dollar of revenue needs 1 ÷ (sales to capital)
//                dollars of capital; free cash flow = after-tax operating
//                income − reinvestment
//   tax          the effective rate for five years, then a fade to the 25%
//                marginal rate
//   discount     the company's cost of capital (Cost of capital panel) for
//                five years, fading to a mature firm's riskfree + ERP by year 10
//   terminal     growth no faster than the riskfree rate, and new investment
//                earning the return you set (default: the terminal cost of
//                capital, i.e. growth that adds no value) — his defaults
//   equity       operating assets − debt + cash + long-term investments −
//                minority interests, over diluted shares
// Seeds: analyst revenue estimates where FMP has them, else history; the
// company's own margin and sales-to-capital, else its industry's.
// Simplifications against the full Ginzu: no failure probability, no
// operating-loss carryforwards, no employee options.
// ============================================================================

const p1 = v => (fin(v) ? `${(v * 100).toFixed(1)}%` : "—");
const money = v => { if (!fin(v)) return "—"; const a = Math.abs(v), s = v < 0 ? "−" : ""; return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : `${s}$${(a / 1e6).toFixed(0)}M`; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function Field({ label, value, onChange, min, max, step, fmt, hint }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 9.5, fontFamily: fonts.mono, marginBottom: 2 }}>
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ width: "100%", accentColor: INDIGO }} aria-label={label} />
      {hint && <div style={{ fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono, lineHeight: 1.35 }}>{hint}</div>}
    </div>
  );
}

// the ten-year model; every input is a fraction except yc (years)
export function storyValue(s) {
  const years = [];
  let rev = s.rev0, df = 1, pv = 0, reinvSum = 0;
  for (let t = 1; t <= 10; t++) {
    const g = t === 1 ? s.g1 : t <= 5 ? s.g25 : s.g25 - ((s.g25 - s.gT) * (t - 5)) / 5;
    const revPrev = rev; rev = revPrev * (1 + g);
    const m = t >= s.yc ? s.mT : s.m0 + ((s.mT - s.m0) * t) / s.yc;
    const tax = t <= 5 ? s.t0 : s.t0 + ((MARGINAL_TAX - s.t0) * (t - 5)) / 5;
    const ebit = rev * m, nopat = ebit > 0 ? ebit * (1 - tax) : ebit;
    const reinv = (rev - revPrev) / s.s2c;
    const fcff = nopat - reinv;
    const w = t <= 5 ? s.w0 : s.w0 + ((s.wT - s.w0) * (t - 5)) / 5;
    df /= 1 + w;
    pv += fcff * df; reinvSum += reinv;
    years.push({ t, g, rev, m, tax, ebit, nopat, reinv, fcff, w, df, pv: fcff * df });
  }
  const last = years[9];
  const revT = last.rev * (1 + s.gT), nopatT = revT * s.mT * (1 - MARGINAL_TAX);
  const reinvT = s.roicT > 0 ? (s.gT / s.roicT) * nopatT : 0;
  const fcffT = nopatT - reinvT;
  const tv = s.wT > s.gT ? fcffT / (s.wT - s.gT) : null;
  const pvTV = fin(tv) ? tv * last.df : null;
  const ops = fin(pvTV) ? pv + pvTV : null;
  const equity = fin(ops) ? ops - s.debt + s.cash + s.nonOp - s.minority : null;
  const perShare = fin(equity) && s.shares > 0 ? equity / s.shares : null;
  // his sanity check: the return on capital the story implies by year 10
  const roic10 = s.ic0 > 0 ? last.nopat / (s.ic0 + reinvSum) : null;
  return { years, terminal: { rev: revT, nopat: nopatT, reinv: reinvT, fcff: fcffT, tv, pv: pvTV, w: s.wT, g: s.gT }, pv, ops, equity, perShare, roic10, tvShare: fin(pvTV) && ops > 0 ? pvTV / ops : null };
}

export default function StoryValuation({ data, coc }) {
  const seed = useMemo(() => {
    const T = coc.T, rev0 = T.revenue;
    if (!fin(rev0) || rev0 <= 0 || coc.equityOnly || !fin(coc.wacc)) return null;
    const inc = data.inc || [], lastFy = inc[inc.length - 1];
    const ests = (data.est || []).filter(e => (e.date || "") > (lastFy?.date || "") && fin(e.revenueAvg) && e.revenueAvg > 0);
    const hist = n => { const past = inc[inc.length - 1 - n]; return past?.revenue > 0 && lastFy?.revenue > 0 ? (lastFy.revenue / past.revenue) ** (1 / n) - 1 : null; };
    const g1 = ests[0] && lastFy?.revenue > 0 ? ests[0].revenueAvg / lastFy.revenue - 1 : hist(3) ?? hist(5) ?? 0.05;
    const far = ests.length > 1 ? ests[Math.min(ests.length - 1, 3)] : null, nFar = far ? ests.indexOf(far) : 0;
    const g25 = far && nFar > 0 ? (far.revenueAvg / ests[0].revenueAvg) ** (1 / nFar) - 1 : g1;
    const y = companyYardstick(data, coc), I = coc.ind.row || {};
    const m0 = fin(T.ebit) ? T.ebit / rev0 : I.opm ?? 0.1;
    const t0 = fin(T.tax) && fin(T.pretax) && T.pretax > 0 ? clamp(T.tax / T.pretax, 0, 0.35) : MARGINAL_TAX;
    const b = T.bNow || {};
    const ic0 = fin(b.totalStockholdersEquity) ? (b.totalDebt || 0) + b.totalStockholdersEquity - (b.cashAndShortTermInvestments ?? 0) : null;
    const gT = clamp(coc.rf, 0, 0.06), wT = coc.rf + coc.erp;
    return {
      rev0, g1: clamp(g1, -0.2, 0.6), g25: clamp(g25, -0.1, 0.5), gT, m0, mT: m0 > 0 ? m0 : I.opm ?? 0.1, yc: 5,
      s2c: fin(y.s2c) && y.s2c > 0 ? clamp(y.s2c, 0.3, 8) : I.s2c ?? 1.5, t0, w0: coc.wacc, wT, roicT: wT,
      debt: coc.debt || 0, cash: coc.cash || 0, nonOp: Math.max(0, b.longTermInvestments || 0), minority: Math.max(0, b.minorityInterest || 0),
      shares: coc.shares, ic0, hints: { estYears: ests.length, farYear: far?.date?.slice(0, 4) ?? null, hist3: hist(3), hist5: hist(5), indMargin: I.opm, indS2c: I.s2c, compS2c: y.s2c },
    };
  }, [data, coc]);

  const [s, setS] = useState(seed);
  useEffect(() => { setS(seed); }, [seed]);
  const out = useMemo(() => (s ? storyValue(s) : null), [s]);
  if (!seed) {
    return coc.equityOnly ? null : <Panel title="Your story, valued"><Note>Not enough data to seed the model (no trailing revenue or cost of capital).</Note></Panel>;
  }
  if (!s || !out) return null;
  const set = k => v => setS(o => ({ ...o, [k]: v }));
  const price = data.price, worthless = fin(out.perShare) && out.perShare <= 0;
  const gap = !worthless && fin(out.perShare) && fin(price) && price > 0 ? out.perShare / price - 1 : null;
  const h = s.hints;
  const rows = [
    ["Revenue growth", r => p1(r.g), p1(s.gT)],
    ["Revenue", r => money(r.rev), money(out.terminal.rev)],
    ["Operating margin", r => p1(r.m), p1(s.mT)],
    ["Operating income", r => money(r.ebit), money(out.terminal.rev * s.mT)],
    ["Tax rate", r => p1(r.tax), p1(MARGINAL_TAX)],
    ["After-tax operating income", r => money(r.nopat), money(out.terminal.nopat)],
    ["− Reinvestment", r => money(r.reinv), money(out.terminal.reinv)],
    ["= Free cash flow to the firm", r => money(r.fcff), money(out.terminal.fcff)],
    ["Cost of capital", r => p1(r.w), p1(s.wT)],
    ["Present value", r => money(r.pv), money(out.terminal.pv)],
  ];
  return (<>
    <DenseHeader
      eyebrow={`Your story, valued · ${data.symbol} · Damodaran's FCFF model, simplified`}
      headline={worthless
        ? <>On this story the shares are worth nothing: the operating business ({money(out.ops)}) is worth less than the debt net of cash and investments. At a {p1(s.mT)} target margin each extra dollar of revenue costs more capital than it earns back, so faster growth only deepens the hole — the story needs a higher margin.</>
        : fin(out.perShare)
        ? <>Value per share {fin(out.perShare) ? `$${out.perShare.toFixed(2)}` : "—"} against a price of ${fin(price) ? price.toFixed(2) : "—"}: {fin(gap) ? (Math.abs(gap) < 0.05 ? "about fair on this story" : `${Math.abs(gap * 100).toFixed(0)}% ${gap > 0 ? "undervalued" : "overvalued"} on this story`) : "—"}.</>
        : <>On these inputs the terminal value is undefined: the terminal cost of capital must exceed terminal growth.</>}
      blurb={<>The reverse DCF reads what the price assumes; this prices the story you set below. Revenue grows, margins move toward a target, every dollar of growth costs 1 ÷ (sales to capital) in reinvestment, and the cost of capital drifts from the company&apos;s own to a mature firm&apos;s. Defaults come from analyst estimates, the company&apos;s history and its industry — change any of them.</>}
      chips={[
        chip("value / share", worthless ? "$0" : fin(out.perShare) ? `${out.perShare.toFixed(2)}` : "—", fin(gap) ? (gap > 0 ? GREEN : RED) : "var(--text-primary)", fin(gap) ? `${gap > 0 ? "+" : "−"}${Math.abs(gap * 100).toFixed(0)}% vs price` : worthless ? "equity below zero on this story" : ""),
        chip("operating assets", money(out.ops), "var(--text-primary)", `terminal value ${p1(out.tvShare)} of it`),
        chip("equity value", money(out.equity), "var(--text-primary)", `− debt ${money(s.debt)} + cash ${money(s.cash)}${s.nonOp > 0 ? ` + investments ${money(s.nonOp)}` : ""}`),
        chip("implied ROIC, year 10", p1(out.roic10), "var(--text-primary)", `industry ${p1(coc.ind.row?.roc)} · terminal ${p1(s.roicT)}`),
      ]}
    />
    <Panel title="The story" right="drag to change; the table and value update as you go">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: "10px 16px" }}>
        <Field label="Revenue growth, year 1" value={s.g1} onChange={set("g1")} min={-0.2} max={0.6} step={0.005} fmt={p1} hint={h.estYears ? "seeded from analysts' next-year estimate" : `history: 3-yr ${p1(h.hist3)}, 5-yr ${p1(h.hist5)}`} />
        <Field label="Revenue growth, years 2–5" value={s.g25} onChange={set("g25")} min={-0.1} max={0.5} step={0.005} fmt={p1} hint={h.farYear ? `analysts' revenue pace through FY${h.farYear}` : "same as year 1"} />
        <Field label="Operating margin today" value={s.m0} onChange={set("m0")} min={-0.3} max={0.6} step={0.005} fmt={p1} hint="trailing operating income ÷ revenue" />
        <Field label="Target operating margin" value={s.mT} onChange={set("mT")} min={-0.1} max={0.6} step={0.005} fmt={p1} hint={`industry ${p1(h.indMargin)}`} />
        <Field label="Year the target is reached" value={s.yc} onChange={v => set("yc")(Math.round(v))} min={1} max={10} step={1} fmt={v => `year ${v}`} />
        <Field label="Sales to capital" value={s.s2c} onChange={set("s2c")} min={0.3} max={8} step={0.05} fmt={v => `${v.toFixed(2)}×`} hint={`company ${fin(h.compS2c) ? `${h.compS2c.toFixed(2)}×` : "—"} · industry ${fin(h.indS2c) ? `${h.indS2c.toFixed(2)}×` : "—"}`} />
        <Field label="Cost of capital, years 1–5" value={s.w0} onChange={set("w0")} min={0.04} max={0.16} step={0.0025} fmt={p1} hint="from the Cost of capital panel" />
        <Field label="Cost of capital, mature" value={s.wT} onChange={set("wT")} min={0.04} max={0.14} step={0.0025} fmt={p1} hint={`riskfree ${p1(coc.rf)} + ERP ${p1(coc.erp)} (beta of 1)`} />
        <Field label="Terminal growth" value={s.gT} onChange={v => set("gT")(Math.min(v, s.wT - 0.005))} min={0} max={0.06} step={0.0025} fmt={p1} hint={`capped below the mature cost of capital; his default is the riskfree rate`} />
        <Field label="Return on new capital, terminal" value={s.roicT} onChange={set("roicT")} min={0.04} max={0.4} step={0.0025} fmt={p1} hint="= mature cost of capital: growth that adds no value" />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={() => setS(seed)} style={{ padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)" }}>Reset to the defaults</button>
        {fin(h.indMargin) && <button onClick={() => setS(o => ({ ...o, mT: h.indMargin, s2c: fin(h.indS2c) ? h.indS2c : o.s2c }))} style={{ padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-secondary)" }}>Use the industry&apos;s margin and sales to capital</button>}
      </div>
    </Panel>
    <Panel title="Ten years and the terminal value" right={`base revenue ${money(s.rev0)} (trailing) · ${(s.shares / 1e6).toFixed(0)}M diluted shares`}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>
            <th style={{ textAlign: "left", padding: "4px 6px", fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono, borderBottom: "1px solid var(--border-subtle)" }}></th>
            {out.years.map(r => <th key={r.t} style={{ textAlign: "right", padding: "4px 6px", fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono, borderBottom: "1px solid var(--border-subtle)" }}>Y{r.t}</th>)}
            <th style={{ textAlign: "right", padding: "4px 6px", fontSize: 8.5, color: INDIGO, fontFamily: fonts.mono, borderBottom: "1px solid var(--border-subtle)" }}>TERMINAL</th>
          </tr></thead>
          <tbody>{rows.map(([l, f, term]) => (
            <tr key={l} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "3px 6px", fontSize: 10, fontFamily: fonts.mono, color: "var(--text-secondary)", whiteSpace: "nowrap", fontWeight: l.startsWith("=") ? 700 : 400 }}>{l}</td>
              {out.years.map(r => <td key={r.t} style={{ padding: "3px 6px", fontSize: 10, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{f(r)}</td>)}
              <td style={{ padding: "3px 6px", fontSize: 10, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{term}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Note>
        Terminal value = next year&apos;s free cash flow ÷ (mature cost of capital − terminal growth), with reinvestment set so growth of {p1(s.gT)} earns {p1(s.roicT)} on new capital.
        Sum of present values {money(out.pv)} + terminal {money(out.terminal.pv)} = operating assets {money(out.ops)}; less debt {money(s.debt)}, plus cash {money(s.cash)}{s.nonOp > 0 ? `, long-term investments ${money(s.nonOp)}` : ""}{s.minority > 0 ? `, less minority interests ${money(s.minority)}` : ""} = equity {money(out.equity)}.
        Check the story against reality: by year 10 it implies a {p1(out.roic10)} return on capital ({coc.ind.name} averages {p1(coc.ind.row?.roc)}).
        Left out from his full model: the chance of failure, operating-loss carryforwards and employee options.
      </Note>
    </Panel>
  </>);
}
