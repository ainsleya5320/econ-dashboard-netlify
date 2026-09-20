import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, Legend, CartesianGrid, LabelList } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { InfoBox } from "../../components/shared.jsx";

// ============================================================================
// GPU UNIT ECONOMICS — the depreciation argument, drawn.
//   Chart 1  cost per million tokens by generation: at today's spot rental, at
//            the owner's cost on a 6-year and a 3-year life, against what the
//            same model's tokens sell for. Throughput is measured (InferenceX)
//            at a chosen interactivity floor.
//   Chart 2  the Chanos test: today's rental (spot and 1-yr contract) against
//            the owner's hourly cost at 3, 5 and 6-year lives and the cash cost
//            (power + hosting), by chip and age. A chip is economically alive
//            while rental clears cash cost, whatever the book life says.
// Data: /api/gpu-economics (server/gpuEconomics.js); assumptions in
// data/ai/gpu-econ.json.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", VIOLET = "#a78bfa";
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };
const usd = (v, dp = 2) => (fin(v) ? `$${v.toFixed(dp)}` : "—");
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const th = (t, align = "right") => <th key={t} style={{ padding: "5px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{t}</th>;
const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;
const Pill = ({ children, color = SLATE, title }) => <span title={title} style={{ fontSize: 8.5, fontFamily: fonts.mono, color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 5px", marginLeft: 6, verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</span>;
const Tick = ({ ok }) => <span style={{ color: ok == null ? DIM : ok ? GREEN : RED, fontWeight: 700 }}>{ok == null ? "—" : ok ? "✓" : "✗"}</span>;
const pillBtn = (on, color) => ({ padding: "3px 10px", borderRadius: 999, cursor: "pointer", background: on ? `${color}22` : "rgba(255,255,255,0.03)", border: `1px solid ${on ? color : "rgba(255,255,255,0.08)"}`, color: on ? "#e2e8f0" : "#64748b", fontFamily: fonts.mono, fontSize: 10, fontWeight: on ? 600 : 400 });

export default function GpuEconomicsPanel() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [floor, setFloor] = useState(50);
  useEffect(() => { fetch("/api/gpu-economics").then(r => r.json()).then(x => (x.error ? setErr(x.error) : setD(x))).catch(e => setErr(String(e))); }, []);

  const rows = useMemo(() => (d ? d.chips.filter(c => c.throughput && c.throughput.intvtyKnown && c.perM?.[floor]) : []), [d, floor]);
  if (err) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>GPU unit economics could not load: {err}</div>;
  if (!d) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading GPU unit economics (InferenceX curves, rentals, cost lines)…</div>;

  const A = d.assumptions, P = d.price;
  const chart1 = rows.map(c => ({ name: c.name, spot: c.perM[floor].atSpot, contract: c.perM[floor].atContract, own6: c.perM[floor].owner[6], own3: c.perM[floor].owner[3], cash: c.perM[floor].cash, tps: c.throughput.byFloor[floor]?.tps }))
    .sort((a, b) => (a.own6 ?? 99) - (b.own6 ?? 99));
  const chart2 = d.chips.filter(c => c.rental.spot || c.rental.contract).map(c => ({ name: `${c.name} · ${c.ageYears}y`, spot: c.rental.spot?.v ?? null, contract: c.rental.contract?.v ?? null, cost3: c.cost.total[3], cost6: c.cost.total[6], cash: c.cost.cash }))
    .sort((a, b) => (b.spot ?? b.contract ?? 0) - (a.spot ?? a.contract ?? 0));
  const h100 = d.chips.find(c => c.key === "h100"), b200 = d.chips.find(c => c.key === "b200"), a100 = d.chips.find(c => c.key === "a100");
  const ratio = h100?.rental.spot && b200?.rental.spot ? b200.rental.spot.v / h100.rental.spot.v : null;
  const tpsRatio = h100?.throughput?.byFloor?.[floor]?.tps && b200?.throughput?.byFloor?.[floor]?.tps ? b200.throughput.byFloor[floor].tps / h100.throughput.byFloor[floor].tps : null;

  const tooltip1 = ({ active, payload, label: l }) => {
    if (!active || !payload?.length) return null;
    const c = rows.find(x => x.name === l); const t = c?.throughput.byFloor[floor];
    return (<div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono }}>
      <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{l}</div>
      {t && <div style={{ color: SLATE, fontSize: 10, marginTop: 2 }}>{t.tps.toLocaleString()} tok/s per GPU at {t.intvty} tok/s/user · {t.framework} {t.precision} · conc {t.conc}</div>}
      {payload.map(p => <div key={p.dataKey} style={{ color: p.color, fontSize: 10.5, marginTop: 2 }}>{p.name}: {usd(p.value, 3)}/M</div>)}
      {P && <div style={{ color: CYAN, fontSize: 10, marginTop: 2 }}>market price: {usd(P.perMOutput, 3)}/M</div>}
    </div>);
  };

  return (<>
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={label}>GPU unit economics · the depreciation argument, drawn</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 3 }}>
            {fin(ratio) && fin(tpsRatio) ? `B200 rents for ${ratio.toFixed(1)}× an H100 and makes ${tpsRatio.toFixed(1)}× the tokens` : "Cost per token by generation"}
            {(() => { const cc = a100?.clearsContract, cs = a100?.clears; const use = cc && cc.life3 ? { ...cc, kind: "contract" } : cs ? { ...cs, kind: "spot" } : cc ? { ...cc, kind: "contract" } : null; return use ? ` · a ${a100.ageYears}-year-old A100 at ${usd(use.rate)}/hr ${use.kind} still clears its ${use.life3 ? "3-year" : use.life6 ? "6-year" : "cash"} cost` : ""; })()}
          </div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5, maxWidth: 900 }}>
            Rental rates are set by where a chip sits on the price-per-token ladder, not by whether GPUs are scarce: a generation that makes more tokens per hour forces the older one to reprice until their cost per token lines up. That is displacement, and it says nothing about demand. The question Chanos raises is different — whether the older chip&apos;s rental falls below the cost a 5–6-year book life assumes — and the second chart answers it directly.
          </div>
        </div>
        <div style={{ ...note, textAlign: "right" }}>
          built {new Date(d.built).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · assumptions reviewed {d.reviewed}<br />
          {P ? `${A.referenceModel} sells for ${usd(P.input, 3)} in / ${usd(P.output, 3)} out per M (OpenRouter, ${P.date})` : "no market price"}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ ...label, marginRight: 4 }}>interactivity floor</span>
        {d.floors.map(f => <button key={f} onClick={() => setFloor(f)} style={pillBtn(floor === f, INDIGO)}>{f} tok/s per user{f === 100 ? " · snappy" : f === 50 ? " · chat" : " · batch / agents"}</button>)}
        <span style={{ ...note, marginLeft: 8 }}>throughput per GPU rises as you accept slower responses; the floor is the product decision, so pick yours</span>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <div style={{ ...card, padding: "10px 10px 4px" }}>
        <div style={{ ...label, paddingLeft: 4 }}>Cost per million output tokens · {A.referenceModel} · {floor} tok/s per user</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chart1} margin={{ top: 18, right: 12, left: -6, bottom: 4 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="name" tick={axis} />
            <YAxis tick={axis} tickFormatter={v => `$${v.toFixed(2)}`} />
            <Tooltip content={tooltip1} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono }} />
            {P && <ReferenceLine y={P.perMOutput} stroke={CYAN} strokeDasharray="4 3" label={{ value: `market ${usd(P.perMOutput, 3)}/M`, position: "right", fontSize: 9, fill: CYAN }} />}
            <Bar dataKey="spot" name="at spot rental" fill={AMBER} radius={[3, 3, 0, 0]} />
            <Bar dataKey="own3" name="owner · 3-yr life" fill={VIOLET} radius={[3, 3, 0, 0]} />
            <Bar dataKey="own6" name="owner · 6-yr life" fill={INDIGO} radius={[3, 3, 0, 0]} />
            <Bar dataKey="cash" name="cash cost only" fill={SLATE} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ ...note, padding: "2px 4px 4px" }}>Owner&apos;s cost = capex ÷ (life × 8,760 h × {Math.round(A.utilization * 100)}% utilisation) + power at PUE {A.pue} and ${A.electricityUsdPerKwh}/kWh + ${A.hostingUsdPerGpuHour}/hr hosting. Spot = Vast.ai median today. The dashed line is what the same model&apos;s tokens sell for. Chips whose bars sit above the line lose money serving this model at this floor; below it they make money — and the gap between the 3-year and 6-year bars is the entire depreciation dispute.</div>
      </div>

      <div style={{ ...card, padding: "10px 10px 4px" }}>
        <div style={{ ...label, paddingLeft: 4 }}>The Chanos test · rental vs the cost lines · $ per GPU-hour</div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chart2} margin={{ top: 18, right: 12, left: -6, bottom: 4 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="name" tick={axis} />
            <YAxis tick={axis} tickFormatter={v => `$${v.toFixed(1)}`} />
            <Tooltip contentStyle={tip} formatter={(v, n) => [usd(v), n]} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono, fontSize: 10.5 }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono }} />
            <Bar dataKey="spot" name="spot rental" fill={AMBER} radius={[3, 3, 0, 0]} />
            <Bar dataKey="contract" name="1-yr contract" fill={GREEN} radius={[3, 3, 0, 0]} />
            <Bar dataKey="cost3" name="cost · 3-yr life" fill={VIOLET} radius={[3, 3, 0, 0]} />
            <Bar dataKey="cost6" name="cost · 6-yr life" fill={INDIGO} radius={[3, 3, 0, 0]} />
            <Bar dataKey="cash" name="cash cost" fill={SLATE} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ ...note, padding: "2px 4px 4px" }}>Chanos needs the rental to fall <em>below the 6-year cost line</em> — that is what makes a 6-year book life an overstatement. A chip is economically alive while rental clears the cash line, whatever the schedule says; the A100 is the exhibit. Contract rates are the SemiAnalysis one-year index; spot is Vast.ai. Age is from first volume shipment.</div>
      </div>
    </div>

    <div style={{ ...card, padding: "10px 10px 6px", marginBottom: 12 }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{[["Chip", "left"], ["Age", "right"], ["Tokens/s per GPU", "right"], ["Spot $/hr", "right"], ["Contract", "right"], ["$/M at spot", "right"], ["$/M owner 6y", "right"], ["$/M owner 3y", "right"], ["Revenue/hr", "right"], ["Margin at spot", "right"], ["Margin as owner (6y)", "right"], ["Clears: cash · 3y · 5y · 6y", "left"]].map(([t, a]) => th(t, a))}</tr></thead>
          <tbody>
            {d.chips.map(c => {
              const t = c.throughput?.byFloor?.[floor], pm = c.perM?.[floor], rv = c.revenue?.[floor];
              const m6 = rv?.marginOwner?.[6];
              return (
                <tr key={c.key} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {td(<><span style={{ fontWeight: 700, color: "#e2e8f0" }}>{c.name}</span><span style={{ color: DIM, marginLeft: 6, fontSize: 9.5 }}>{c.vendor} · {c.memory}</span>{c.throughput?.disagg && <Pill color={AMBER} title="InferenceX runs this disaggregated: throughput per decode chip, not per total chip">disagg</Pill>}{c.note && !c.throughput && <Pill title={c.note}>no benchmark</Pill>}</>, "#cbd5e1", { textAlign: "left" })}
                  {td(`${c.ageYears}y`)}
                  {td(t ? <span title={`${t.framework} ${t.precision} · concurrency ${t.conc} · ${t.intvty} tok/s/user P90 · run ${c.throughput.date}`}>{t.tps.toLocaleString()}</span> : c.throughput ? <span style={{ color: DIM }} title="no run meets this interactivity floor">below floor</span> : "—")}
                  {td(c.rental.spot ? usd(c.rental.spot.v) : "—")}
                  {td(c.rental.contract ? usd(c.rental.contract.v) : "—")}
                  {td(pm ? usd(pm.atSpot, 3) : "—", pm && P && fin(pm.atSpot) ? (pm.atSpot <= P.perMOutput ? GREEN : RED) : SLATE)}
                  {td(pm ? usd(pm.owner[6], 3) : "—", pm && P ? (pm.owner[6] <= P.perMOutput ? GREEN : RED) : SLATE)}
                  {td(pm ? usd(pm.owner[3], 3) : "—", pm && P ? (pm.owner[3] <= P.perMOutput ? GREEN : RED) : SLATE)}
                  {td(rv ? usd(rv.perHr) : "—")}
                  {td(rv && fin(rv.marginAtSpot) ? `${sgn(rv.marginAtSpot)}${usd(Math.abs(rv.marginAtSpot))}` : "—", rv && fin(rv.marginAtSpot) ? (rv.marginAtSpot >= 0 ? GREEN : RED) : SLATE)}
                  {td(fin(m6) ? `${sgn(m6)}${usd(Math.abs(m6))}` : "—", fin(m6) ? (m6 >= 0 ? GREEN : RED) : SLATE)}
                  {td(c.clears || c.clearsContract ? <span style={{ fontSize: 10 }}>{c.clears && <span title={`spot ${usd(c.clears.rate)}/hr`}>spot <span style={{ letterSpacing: 2 }}><Tick ok={c.clears.cash} /> <Tick ok={c.clears.life3} /> <Tick ok={c.clears.life5} /> <Tick ok={c.clears.life6} /></span></span>}{c.clearsContract && <span title={`contract ${usd(c.clearsContract.rate)}/hr`} style={{ marginLeft: c.clears ? 10 : 0 }}>contract <span style={{ letterSpacing: 2 }}><Tick ok={c.clearsContract.cash} /> <Tick ok={c.clearsContract.life3} /> <Tick ok={c.clearsContract.life5} /> <Tick ok={c.clearsContract.life6} /></span></span>}</span> : <span style={{ color: DIM }}>no rental</span>, SLATE, { textAlign: "left" })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ ...note, padding: "6px 4px 2px" }}>Revenue per hour = tokens per GPU-hour × the model&apos;s OpenRouter price (output plus the paired input). Margins are against spot rental (a reseller&apos;s view) and against the owner&apos;s 6-year cost (a hyperscaler&apos;s). &quot;Clears&quot; asks whether today&apos;s rental exceeds each cost line. Capex per chip: {d.chips.map(c => `${c.name} $${(c.capex / 1000).toFixed(0)}k`).join(" · ")} — all editable in data/ai/gpu-econ.json.</div>
    </div>

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>Why this settles more than the headlines do.</strong> Bulls and bears both collapse two different numbers into one. The <em>price</em> of a GPU-hour decays fast, because each generation resets the cost-per-token ladder and the old chip must reprice to stay on it — that is what a falling H100 rate means, and it is compatible with every GPU being sold out. The <em>usefulness</em> of the chip decays slowly: it keeps earning as long as rental clears cash cost, and InferenceX shows the same silicon getting faster on the same model as software improves. Chanos is right that a 6-year book life assumes the price line holds up; the second chart is where you check whether it has. He is wrong if you read &quot;rates fell&quot; as &quot;demand fell&quot; — the first chart shows the fall is the ladder moving. What neither chart can settle: utilisation (the same chip at 50% and 80% is two businesses), and the spot-versus-contract mix, which is why both rates are shown. Spot is the leftover capacity nobody locked up; the contracted fleet is where the real economics live. {d.source}
    </InfoBox>
  </>);
}
