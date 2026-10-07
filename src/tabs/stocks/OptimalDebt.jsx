import React, { useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from "recharts";
import { fonts } from "../../lib/styles.js";
import { syntheticRating } from "../../lib/costOfCapital.js";
import { INDIGO, AMBER, CYAN, fin, tip, axis, chip, DenseHeader, Panel, Note, useIsPhone, chartH } from "../../components/dense.jsx";

// ============================================================================
// OPTIMAL DEBT — Damodaran's cost-of-capital approach (his capstru.xlsx):
// hold today's operating income and firm value fixed, and for each debt ratio
// from 0% to 90%:
//   interest   debt × cost of debt, where the cost of debt comes from the
//              synthetic rating the resulting interest coverage earns — an
//              iteration (more debt → less coverage → lower rating → higher
//              rate → more interest) run until the rating settles
//   tax        the 25% marginal rate, scaled down when interest exceeds
//              operating income (the shield can't exceed the income)
//   beta       the business beta relevered: βu × (1 + (1 − t) × D/E)
//   WACC       E/V × (rf + β × ERP) + D/V × cost of debt × (1 − t)
// The ratio with the lowest WACC is the optimum. The value effect uses his
// perpetual-growth shortcut: the growth rate today's firm value implies at
// today's cost of capital, then the value at the optimal cost of capital.
// It assumes operating income does not change with leverage — no allowance
// for lost customers or managers distracted by distress beyond the rating.
// ============================================================================

const p1 = v => (fin(v) ? `${(v * 100).toFixed(1)}%` : "—");
const p2 = v => (fin(v) ? `${(v * 100).toFixed(2)}%` : "—");
const money = v => { if (!fin(v)) return "—"; const a = Math.abs(v), s = v < 0 ? "−" : ""; return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : `${s}$${(a / 1e6).toFixed(0)}M`; };

export function optimalStructure(coc) {
  const { rf, erp, betaU, t, mcap, T } = coc, debt = coc.debt || 0, ebit = T?.ebit;
  if (coc.equityOnly || ![rf, erp, betaU, mcap, ebit].every(fin) || ebit <= 0) return null;
  const V = mcap + debt;
  const rows = [];
  for (let k = 0; k <= 9; k++) {
    const d = k / 10, D = d * V, E = V - D;
    let kd = null, rating = null, interest = 0, tEff = t;
    if (D > 0) {
      kd = rf + (coc.rating?.spread ?? 0.01);
      const seen = new Set();
      for (let i = 0; i < 25; i++) {
        interest = D * kd;
        rating = syntheticRating(ebit / interest, mcap);
        const next = rf + (rating?.spread ?? 0.2);
        const key = next.toFixed(6);
        if (Math.abs(next - kd) < 1e-7) break;
        if (seen.has(key)) { kd = Math.max(kd, next); break; } // flip-flopping between two ratings: take the dearer
        seen.add(key); kd = next;
      }
      interest = D * kd;
      rating = syntheticRating(ebit / interest, mcap);
      tEff = interest > ebit ? (t * ebit) / interest : t;
    }
    const betaL = betaU * (1 + (1 - tEff) * (D / E));
    const ke = rf + betaL * erp;
    const kdAfter = D > 0 ? kd * (1 - tEff) : null;
    const wacc = (E * ke + D * (kdAfter ?? 0)) / V;
    rows.push({ d, betaL, ke, rating: D > 0 ? rating?.rating ?? "D" : "—", coverage: D > 0 ? ebit / interest : null, kd, tEff, kdAfter, wacc });
  }
  const best = rows.reduce((a, b) => (b.wacc < a.wacc - 1e-9 ? b : a));
  const d0 = debt / V;
  // value effect: implied perpetual growth at today's WACC, then value at the optimum
  const fcff = fin(T.ebit) ? T.ebit * (1 - t) - Math.max(0, (T.capex || 0) - (T.da || 0)) : null;
  let effect = null;
  if (fin(coc.wacc) && fin(fcff) && fcff > 0) {
    const g = (V * coc.wacc - fcff) / (V + fcff);
    if (best.wacc > g + 0.005 && coc.wacc > g) {
      const vOpt = (fcff * (1 + g)) / (best.wacc - g);
      effect = { g, vOpt, change: vOpt - V, perShare: coc.shares > 0 ? (vOpt - V) / coc.shares : null };
    }
  }
  return { rows, best, d0, V, ebit, fcff, effect };
}

export default function OptimalDebt({ coc }) {
  const phone = useIsPhone();
  const o = useMemo(() => optimalStructure(coc), [coc]);
  if (coc.equityOnly) return null;
  if (!o) return <Panel title="Optimal debt ratio"><Note>Needs positive operating income, a market value and an industry beta — a company losing money at the operating line has no debt capacity in this framework.</Note></Panel>;
  const { rows, best, d0 } = o;
  const gapPts = best.d - d0;
  // the curve is usually flat near its bottom: the band within 0.1 points of the minimum
  const flat = rows.filter(r => r.wacc <= best.wacc + 0.001), lo = flat[0].d, hi = flat[flat.length - 1].d;
  // axis framed on the WACC curve so its dip is visible; the cost of equity runs off the top at high debt
  const wLo = Math.min(...rows.map(r => r.wacc), ...rows.filter(r => fin(r.kdAfter)).map(r => r.kdAfter)), wHi = Math.max(...rows.map(r => r.wacc));
  const yDomain = [Math.max(0, Math.floor(wLo * 100) - 1), Math.ceil(wHi * 100) + 2];
  const verdict = Math.abs(gapPts) < 0.1 ? "close to its optimal debt ratio" : gapPts > 0 ? "under-levered: it could carry more debt" : "over-levered: debt is past the point where it lowers the cost of capital";
  return (<>
    <DenseHeader
      eyebrow="Optimal debt ratio · Damodaran's cost-of-capital approach"
      headline={<>Cost of capital is lowest at {p1(best.d)} debt ({p2(best.wacc)}){hi > lo ? <>, and within 0.1 points of that anywhere from {p1(lo)} to {p1(hi)}</> : null}; today it carries {p1(d0)} at {p2(coc.wacc)} — {verdict}.</>}
      blurb={<>Debt is cheaper than equity and its interest is tax-deductible, but every extra dollar lowers interest coverage, the synthetic rating and the equity&apos;s beta. The table walks that trade-off at today&apos;s operating income ({money(o.ebit)}, trailing) and today&apos;s rates, holding the business itself unchanged.</>}
      chips={[
        chip("optimal debt ratio", p1(best.d), INDIGO, `rating ${best.rating} · WACC ${p2(best.wacc)}`),
        chip("today", p1(d0), "var(--text-primary)", `rating ${coc.rating?.rating ?? "—"} · WACC ${p2(coc.wacc)}`),
        chip("industry", p1(coc.ind.row?.dW), "var(--text-primary)", `${coc.ind.name}, debt ÷ (debt + equity)`),
        ...(o.effect ? [chip("value at the optimum", `${o.effect.change >= 0 ? "+" : "−"}${money(Math.abs(o.effect.change))}`, "var(--text-primary)", fin(o.effect.perShare) ? `${o.effect.perShare >= 0 ? "+" : "−"}$${Math.abs(o.effect.perShare).toFixed(2)} a share · implied growth ${p1(o.effect.g)}` : "")] : []),
      ]}
    />
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Costs of capital by debt ratio" right="one axis, framed on the cost of capital; the cost of equity climbs off the top at high debt" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 220)}>
          <LineChart data={rows.map(r => ({ d: r.d * 100, wacc: +(r.wacc * 100).toFixed(2), ke: +(r.ke * 100).toFixed(2), kd: fin(r.kdAfter) ? +(r.kdAfter * 100).toFixed(2) : null }))} margin={{ top: 8, right: 8, left: phone ? -18 : -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="d" type="number" domain={[0, 90]} ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90]} tick={axis} tickFormatter={v => `${v}%`} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={yDomain} allowDataOverflow />
            <Tooltip contentStyle={tip} labelFormatter={v => `${v}% debt`} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={(v, n) => [`${Number(v).toFixed(2)}%`, n]} />
            <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 2 }} iconType="circle" iconSize={6} />
            <ReferenceLine x={+(d0 * 100).toFixed(1)} stroke="var(--text-muted)" strokeDasharray="4 3" label={{ value: "today", position: "insideTopLeft", fill: "var(--text-muted)", fontSize: 9.5, fontFamily: fonts.mono }} />
            <ReferenceLine x={best.d * 100} stroke={INDIGO} strokeDasharray="2 3" label={{ value: "optimum", position: "insideTopRight", fill: INDIGO, fontSize: 9.5, fontFamily: fonts.mono }} />
            <Line type="monotone" dataKey="ke" name="cost of equity" stroke={AMBER} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="kd" name="cost of debt, after tax" stroke={CYAN} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="wacc" name="cost of capital" stroke={INDIGO} strokeWidth={2.4} dot={{ r: 2.5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="The walk" right={`firm value ${money(o.V)} held fixed`} style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 470 }}>
            <thead><tr>{["Debt", "Beta", "Cost of equity", "Coverage", "Rating", "Debt, pre-tax", "Tax", "WACC"].map((h, i) => <th key={h} style={{ textAlign: i ? "right" : "left", padding: "4px 6px", fontSize: 8.5, color: "var(--text-muted)", fontFamily: fonts.mono, textTransform: "uppercase", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => {
              const isBest = r === best, near = Math.abs(r.d - d0) < 0.05;
              const td = { padding: "3px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color: isBest ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: isBest ? 700 : 400 };
              return (
                <tr key={r.d} style={{ borderBottom: "1px solid var(--border-subtle)", background: isBest ? "rgba(129,140,248,0.10)" : "transparent" }}>
                  <td style={{ ...td, textAlign: "left" }}>{p1(r.d).replace(".0", "")}{near ? " · today" : ""}{isBest ? " · optimum" : ""}</td>
                  <td style={td}>{r.betaL.toFixed(2)}</td><td style={td}>{p2(r.ke)}</td>
                  <td style={td}>{fin(r.coverage) ? `${r.coverage.toFixed(1)}×` : "—"}</td><td style={td}>{r.rating}</td>
                  <td style={td}>{p2(r.kd)}</td><td style={td}>{p1(r.tEff)}</td><td style={td}>{p2(r.wacc)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Panel>
    </div>
    <Note style={{ marginTop: -4, marginBottom: 12 }}>
      Coverage is trailing operating income ÷ the interest each debt level would cost; the rating and spread come from his {coc.rating?.large === false ? "small" : "large"}-firm table and the tax rate is trimmed where interest outgrows income.
      {o.effect ? ` The value effect assumes today's ${money(o.V)} firm value grows ${p1(o.effect.g)} a year forever at today's ${p2(coc.wacc)} cost of capital, then re-prices that at ${p2(best.wacc)}; read it as a direction, not a forecast.` : " No value effect: trailing free cash flow to the firm is not positive, so the implied growth can't be solved."}
      {" "}Real limits it leaves out: covenants, the cost of distress beyond the rating, and how much flexibility management wants to keep.
    </Note>
  </>);
}
