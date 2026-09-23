import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { fonts } from "../../lib/styles.js";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, BLUE, ORANGE, PINK, TEAL,
  fin, card, label, note, tip, axis, pc, fmtDay, th, td, tdL, tableStyle,
  chip, DenseHeader, Panel, Note, DataTable, useIsPhone, chartH,
} from "../../components/dense.jsx";

// ============================================================================
// TOKEN SPOT — a spot price for tokens, derived from the spot price of a GPU.
//
//   $/token = (GPU $/hour) / (tokens per GPU-hour x utilisation)
//
// The left-hand side of the chart is a market price we can read. The right-hand
// side is not a property of the GPU at all — it is a throughput estimate built
// from the prefill/decode physics, and it moves with choices (batch size,
// context length, model) far more than it moves with the silicon. So the panel
// shows both sides and is explicit that the spread between them is not margin:
// it is mostly our own uncertainty about the denominator.
// Data: /api/token-spot (server/tokenSpot.js).
// ============================================================================

const usd = (v, dp = 2) => (fin(v) ? `$${v.toFixed(dp)}` : "—");
const perM = (v, dp = 2) => (fin(v) ? `$${v.toFixed(dp)}` : "—");
const times = v => (fin(v) ? `${v.toFixed(v < 10 ? 2 : 1)}×` : "—");
const signed = v => (fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%` : "—");
const IMPACT = { high: RED, medium: AMBER, low: SLATE };

// ── Silicon Data readings ──
// Present only on a machine holding data/ai/silicon-data-marks.json, which is
// git-ignored: Silicon Data licenses its indices for internal use, and the repo
// is public. Without the file the server sends no `siliconData` block and none
// of this renders — which is what keeps it out of the Netlify build.
function SiliconDataPanels({ sd, outShare }) {
  const v = Object.fromEntries(sd.venues.map(x => [x.key, x]));
  const outs = sd.venues.map(x => x.output).filter(fin);
  const tok = Object.fromEntries(sd.tokens.map(t => [t.key, t]));
  const floor = Object.fromEntries(sd.floors.map(f => [f.key, f]));
  const dense = floor.dense70b;
  const open = tok.open, prop = tok.proprietary;
  const src = `Silicon Data · read ${fmtDay(sd.observed)} · internal use only`;
  const floorCell = key => r => {
    const f = floor[key];
    return <span style={{ color: f?.fits ? "var(--text-secondary)" : DIM }}>{times(r.vsFloor?.[key])}{f && !f.fits ? " †" : ""}</span>;
  };
  const unfit = sd.floors.filter(f => !f.fits);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Where the hour is bought moves the floor" right={src} style={{ marginBottom: 0 }}>
        <DataTable
          dense
          rows={sd.venues}
          cols={[
            { key: "label", label: "H100 market", primary: true },
            { key: "rate", label: "$/hr", render: r => <span style={{ color: INDIGO, fontWeight: 600 }}>{usd(r.rate)}</span> },
            { key: "vs", label: "vs contract", render: r => (r.key === "contract" || !v.contract ? "—" : signed((r.rate / v.contract.rate - 1) * 100)) },
            { key: "output", label: "floor $/M out", render: r => <span style={{ color: CYAN, fontWeight: 600 }}>{perM(r.output, 3)}</span> },
            { key: "blended", label: "blended $/M", render: r => perM(r.blended, 3) },
            { key: "source", label: "source", hide: true, align: "left", render: r => <span style={{ color: DIM }}>{r.source}</span> },
          ]}
        />
        <Note>
          Same chip, same model, same serving assumptions: only the market the hour is bought in changes.
          {v.neocloud && v.contract && <> Silicon Data's neo-cloud index sits {Math.abs(Math.round((v.neocloud.rate / v.contract.rate - 1) * 100))}%
            {v.neocloud.rate < v.contract.rate ? " below" : " above"} SemiAnalysis's 1-year contract price.</>}
          {v.neocloud && v.hyperscaler && <> A hyperscaler charges {times(v.hyperscaler.rate / v.neocloud.rate)} the neo-cloud rate.</>}
          {outs.length > 1 && <> That spreads the floor from {perM(Math.min(...outs), 2)} to {perM(Math.max(...outs), 2)} per million output
            tokens before a single serving assumption moves.</>} The chart above stays on the contract index because it is the only one
          with history.
        </Note>
      </Panel>

      <Panel title="Token indices against the derived floor" right={src} style={{ marginBottom: 0 }}>
        <DataTable
          dense
          rows={sd.tokens}
          cols={[
            { key: "label", label: "index", primary: true },
            { key: "usdPerM", label: "$/M blended", render: r => <span style={{ color: AMBER, fontWeight: 600 }}>{perM(r.usdPerM)}</span> },
            { key: "chg7d", label: "7d", render: r => signed(r.chg7d) },
            { key: "dense70b", label: "× 70B floor", render: floorCell("dense70b") },
            { key: "small30b", label: "× 30B floor", render: floorCell("small30b") },
            { key: "moe_frontier", label: "× MoE floor", hide: true, render: floorCell("moe_frontier") },
          ]}
        />
        <Note>
          Both sides from one source on one day: at Silicon Data's own H100 index ({usd(sd.floorRate)}/hr) the dense 70B archetype costs
          {" "}{perM(dense?.blended, 2)} per blended million to make.
          {open && <> Open-weight tokens sell for {times(open.vsFloor?.dense70b)} that{open.vsFloor?.dense70b < 2 ? ", which is close to cost — what a commodity looks like" : ""}.</>}
          {prop && <> Proprietary tokens sell for {times(prop.vsFloor?.dense70b)}.</>}
          {open && prop && <> The open-weight index is the fair comparison, since only open models have architectures we can put through
            the physics. The {times(prop.usdPerM / open.usdPerM)} premium of proprietary over open is the price of the model, not of the compute.</>}
          {" "}Caveat: the indices blend input and output in a mix Silicon Data does not publish; our blended floor assumes
          {fin(outShare) ? ` ${Math.round(outShare * 100)}% output tokens` : " the output share below"}.
          {unfit.length > 0 && <> † {unfit.map(f => f.label).join(", ")} does not fit on an 8-GPU H100 node, so that floor prices a
            configuration nobody can rent.</>}
        </Note>
      </Panel>
    </div>
  );
}

export default function TokenSpotPanel() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [span, setSpan] = useState("all");
  const phone = useIsPhone();

  useEffect(() => {
    fetch("/api/token-spot").then(r => r.json())
      .then(x => (x.error ? setErr(x.error) : setD(x)))
      .catch(e => setErr(String(e)));
  }, []);

  const hist = useMemo(() => {
    if (!d?.history) return [];
    const n = span === "1y" ? 365 : span === "6m" ? 182 : d.history.length;
    return d.history.slice(-n);
  }, [d, span]);

  if (err) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Token spot could not load: {err}</div>;
  if (!d) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "var(--text-muted)", fontFamily: fonts.mono }}>Deriving a token price from the GPU rental curve…</div>;

  const l = d.latest, a = d.assumptions;
  const sdOn = !!d.siliconData;
  const joined = d.history.filter(h => fin(h.markup));
  const markups = joined.map(h => h.markup);
  const floors = d.history.map(h => h.floorOutput).filter(fin);

  const Hover = ({ active, label: x }) => {
    if (!active) return null;
    const r = hist.find(p => p.d === x);
    if (!r) return null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{fmtDay(r.d)}</div>
        <div style={{ fontSize: 10.5, marginTop: 3 }}>H100 rents for <span style={{ color: INDIGO }}>{usd(r.rate)}/hr</span></div>
        <div style={{ fontSize: 10.5, color: CYAN }}>derived floor {perM(r.floorOutput, 3)}/M output · {perM(r.floorInput, 3)}/M input</div>
        {fin(r.marketOutput) && <div style={{ fontSize: 10.5, color: AMBER }}>market median {perM(r.marketOutput)}/M · cheapest {perM(r.marketCheapest)}/M</div>}
        {fin(r.markup) && <div style={{ fontSize: 10.5, color: VIOLET }}>{r.markup}× the derived floor</div>}
      </div>
    );
  };

  const spanBtn = s => ({
    padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 9.5, fontFamily: fonts.mono,
    border: `1px solid ${span === s ? "#818cf8" : "var(--border-subtle)"}`,
    background: span === s ? "rgba(129,140,248,0.15)" : "transparent",
    color: span === s ? "#c7d2fe" : SLATE,
  });

  return (<>
    <DenseHeader
      eyebrow="A spot price for tokens · derived from the spot price of a GPU"
      headline={<>
        An H100 rents for {usd(l.rate)} an hour, which puts the cost floor for a million output tokens at {perM(l.floorOutput, 2)} —
        while the market charges a median of {perM(l.marketOutput)}, or {fin(l.markup) ? `${l.markup}×` : "several times"} the floor
      </>}
      blurb={<>
        The identity is simple: <strong style={{ color: "var(--text-primary)" }}>$/token = GPU $/hour ÷ (tokens per GPU-hour × utilisation)</strong>.
        The numerator is a real market price. The denominator is not a property of the GPU at all — it depends on the model, the batch
        size, the context length and the serving stack. The same H100-hour yields a million output tokens for anywhere between
        {" "}{perM(d.batchCurve[d.batchCurve.length - 1]?.perM, 2)} and {perM(d.batchCurve[0]?.perM, 0)} depending on those choices. So the gap below is not margin.
        Most of it is our own uncertainty about the denominator.
      </>}
      meta={<>
        GPU index {d.history[0]?.d} → {d.history[d.history.length - 1]?.d}<br />
        market prices from Artificial Analysis · specs reviewed {d.reviewed}
      </>}
      chips={[
        chip("H100 rental", `${usd(l.rate)}/hr`, INDIGO, `${usd(l.nodeRate, 0)}/hr for the ${a.gpusPerNode.value}-GPU node`),
        chip("derived floor", `${perM(l.floorOutput, 2)}/M`, CYAN, "output tokens, after utilisation"),
        chip("market median", `${perM(l.marketOutput)}/M`, AMBER, `cheapest ${perM(l.marketCheapest)}/M`),
        chip("markup", fin(l.markup) ? `${l.markup}×` : "—", VIOLET, markups.length ? `${Math.min(...markups)}–${Math.max(...markups)}× observed` : null),
        chip("throughput", `${(l.decodeTps / 1000).toFixed(1)}k tok/s`, GREEN, `${l.perUserTps} per user at batch ${a.batchSize.value}`),
        chip("input tokens", `${perM(l.floorInput, 2)}/M`, TEAL, "prefill is compute-bound, and cheap"),
      ]}
    />

    <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={note}>Window</span>
      {["6m", "1y", "all"].map(s => <button key={s} onClick={() => setSpan(s)} style={spanBtn(s)}>{s}</button>)}
      <span style={{ ...note, marginLeft: 4 }}>{hist.length} days · {joined.length} with a market price alongside</span>
    </div>

    <Panel title="Both sides — what a token costs to make, and what it sells for" right="log scale; the two are a factor apart, not a percentage">
      <ResponsiveContainer width="100%" height={chartH(phone, 300)}>
        <ComposedChart data={hist} margin={{ top: 6, right: phone ? 6 : 42, left: phone ? -18 : -6, bottom: 0 }}>
          <defs>
            <linearGradient id="ts-floor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CYAN} stopOpacity={0.35} /><stop offset="95%" stopColor={CYAN} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={v => v.slice(0, 7)} minTickGap={44} />
          <YAxis yAxisId="p" scale="log" domain={[0.1, "dataMax"]} allowDataOverflow tick={axis} axisLine={false} tickLine={false}
            tickFormatter={v => `$${v < 1 ? v.toFixed(1) : v.toFixed(0)}`} ticks={[0.1, 0.3, 1, 3, 10, 30]} />
          {!phone && <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />}
          <Tooltip content={<Hover />} />
          <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={6} />
          <Area yAxisId="p" type="monotone" dataKey="floorOutput" name="derived floor, output" stroke={CYAN} fill="url(#ts-floor)" strokeWidth={2} dot={false} connectNulls />
          <Line yAxisId="p" type="monotone" dataKey="floorInput" name="derived floor, input" stroke={TEAL} strokeWidth={1.2} dot={false} strokeDasharray="3 3" connectNulls />
          <Line yAxisId="p" type="monotone" dataKey="marketOutput" name="market median" stroke={AMBER} strokeWidth={2} dot={false} connectNulls />
          <Line yAxisId="p" type="monotone" dataKey="marketCheapest" name="market cheapest" stroke={ORANGE} strokeWidth={1.2} dot={false} strokeDasharray="4 3" connectNulls />
          {!phone && <Line yAxisId="r" type="monotone" dataKey="rate" name="H100 $/hr (right)" stroke={INDIGO} strokeWidth={1.2} dot={false} opacity={0.65} />}
        </ComposedChart>
      </ResponsiveContainer>
      <Note>
        The cyan band is the physics: it moves only because the GPU rental price moves, since every other input is held fixed. The amber
        line is what somebody will actually sell you a token for. They have converged over the window — the cheapest listed price now runs
        <strong style={{ color: "var(--text-primary)" }}> below </strong> our derived floor, which is the useful signal: either those
        providers run at a batch or utilisation well above what we assume, or they are selling below cost to hold share.
      </Note>
    </Panel>

    {d.siliconData && <SiliconDataPanels sd={d.siliconData} outShare={a.outputPerInput?.value} />}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      <Panel title="Batching is the entire economics" right="cost per million output tokens, by batch size" style={{ marginBottom: 0 }}>
        <ResponsiveContainer width="100%" height={chartH(phone, 236)}>
          <ComposedChart data={d.batchCurve} margin={{ top: 6, right: 10, left: phone ? -18 : -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="batch" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} scale="log" domain={["dataMin", "dataMax"]} type="number" ticks={[1, 4, 16, 64, 256, 1024]} />
            <YAxis scale="log" domain={["dataMin", "dataMax"]} tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `$${v < 1 ? v.toFixed(1) : v.toFixed(0)}`} />
            <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }}
              labelFormatter={v => `batch ${v}`}
              formatter={(v, n, p) => n === "perM"
                ? [`$${v}/M · ${p.payload.perUserTps} tok/s per user · ${p.payload.memGB} GB${p.payload.fits ? "" : " — will not fit"}`, "cost"]
                : [v, n]} />
            <ReferenceLine x={a.batchSize.value} stroke={VIOLET} strokeDasharray="4 4" label={{ value: `assumed ${a.batchSize.value}`, fill: VIOLET, fontSize: 8.5, position: "top", fontFamily: fonts.mono }} />
            <Line type="monotone" dataKey="perM" name="perM" stroke={CYAN} strokeWidth={2.4} dot={{ r: 2.5, fill: CYAN }} />
          </ComposedChart>
        </ResponsiveContainer>
        <Note>
          Weights are read out of memory once per step however many users share it, so cost per token falls roughly as 1/batch until the
          KV cache starts to dominate the read. Batch 1 costs {perM(d.batchCurve[0]?.perM, 0)} per million; batch {a.batchSize.value} costs
          {" "}{perM(d.batchCurve.find(b => b.batch === a.batchSize.value)?.perM, 2)}. Same silicon, same hour, {Math.round((d.batchCurve[0]?.perM || 0) / (l.floorOutput || 1))}× apart.
          Past the point where the cache no longer fits in {l.nodeMemoryGB} GB, the batch is not available at any price.
        </Note>
      </Panel>

      <Panel title="Two regimes, two bottlenecks" right="the same hour priced against what each phase consumes" style={{ marginBottom: 0 }}>
        <DataTable
          dense
          rows={d.models.map(m => ({ ...m, key: m.key }))}
          cols={[
            { key: "label", label: "model", primary: true },
            { key: "input", label: "input $/M", render: r => <span style={{ color: TEAL }}>{perM(r.input, 3)}</span> },
            { key: "output", label: "output $/M", render: r => <span style={{ color: CYAN, fontWeight: 600 }}>{perM(r.output, 3)}</span> },
            { key: "ratio", label: "out ÷ in", render: r => (fin(r.input) && r.input > 0 ? `${(r.output / r.input).toFixed(0)}×` : "—") },
            { key: "tps", label: "decode tok/s", render: r => (fin(r.decodeTps) ? r.decodeTps.toLocaleString() : "—") },
          ]}
        />
        <Note>
          Prefill reads your prompt and is <strong style={{ color: "var(--text-primary)" }}>compute-bound</strong>: every prompt token goes
          through in parallel at roughly 2× active-parameter FLOPs. Decode writes the answer and is
          {" "}<strong style={{ color: "var(--text-primary)" }}>memory-bandwidth-bound</strong>: one token per sequence per step, gated by how
          fast weights and cache stream out of HBM. That is why input and output are priced differently everywhere, and why the frontier MoE
          inverts — cheap on FLOPs because only {d.models.find(m => m.kind === "moe")?.activeParamsB}B parameters activate, greedy on
          bandwidth because at large batch nearly every expert gets touched anyway.
        </Note>
      </Panel>
    </div>

    <Panel title="Comparing silicon on what it is actually rented for" right="normalise the hour by the resource each phase consumes">
      <DataTable
        dense
        rows={d.chips.filter(c => fin(c.spot)).map(c => ({ ...c, key: c.key }))}
        cols={[
          { key: "name", label: "chip", primary: true },
          { key: "spot", label: sdOn ? "rental $/hr" : "$/hr", render: r => usd(r.spot) },
          ...(sdOn ? [{ key: "contract", label: "1-yr contract", hide: true, render: r => <span style={{ color: DIM }}>{usd(r.contract)}</span> }] : []),
          { key: "bw", label: "HBM TB/s", hide: true, render: r => r.hbmTBs.toFixed(2) },
          { key: "perTBs", label: "$/hr per TB/s", render: r => <span style={{ color: CYAN, fontWeight: 600 }}>{usd(r.norm.perTBs, 3)}</span> },
          { key: "perPFLOP", label: "$/hr per PFLOP", render: r => <span style={{ color: TEAL }}>{usd(r.norm.perPFLOP, 2)}</span> },
          { key: "gbPer", label: "GB per $", render: r => (fin(r.norm.gbPerDollar) ? r.norm.gbPerDollar.toFixed(1) : "—") },
          { key: "out", label: "→ $/M output", render: r => <span style={{ color: r.perM?.output ? INDIGO : DIM, fontWeight: 600 }}>{r.perM?.output ? perM(r.perM.output, 3) : "—"}</span> },
        ]}
        note={<>
          Decode is bought with bandwidth, so <strong style={{ color: "var(--text-primary)" }}>$/hr per TB/s</strong> is the number that
          decides output-token economics; prefill is bought with FLOPs. Memory per dollar is the third axis and the quiet one — it caps how
          large a batch you can hold, which is what sets your position on the curve to the left. A chip can lose on headline rental and still
          win on all three.
          {sdOn && <> Rental rates here are Silicon Data's indices, read {fmtDay(d.siliconData.observed)} — one source on one day, so the
            chips compare like for like. The contract column is SemiAnalysis, which covers {d.chips.filter(c => fin(c.contract)).length} of
            the {d.chips.length}.</>}
        </>}
      />
    </Panel>

    <Panel title="What we would need to know — and do not" right="ranked by how much each moves the answer">
      <DataTable
        rows={d.missingInputs.map(m => ({ ...m, key: m.key }))}
        cols={[
          { key: "need", label: "missing input", primary: true },
          { key: "impact", label: "impact", render: r => (
            <span style={{ color: IMPACT[r.impact] || SLATE, fontWeight: 600, textTransform: "uppercase", fontSize: 9 }}>{r.impact}</span>) },
          { key: "why", label: "why it matters", align: "left", render: r => <span style={{ whiteSpace: "normal", color: "var(--text-secondary)" }}>{r.why}</span> },
          { key: "where", label: "where it might come from", align: "left", render: r => <span style={{ whiteSpace: "normal", color: DIM }}>{r.where}</span> },
        ]}
      />
      <Note>
        Every number in the derived floor rests on the assumptions below, and each of them moves the answer more than the GPU price does.
        That is the honest summary of this panel: the supply side is measured, the demand side is measured, and the bridge between them is
        estimated.
      </Note>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))", gap: 8, marginTop: 10 }}>
        {Object.entries(a).filter(([k]) => !k.startsWith("_")).map(([k, v]) => (
          <div key={k} style={{ background: "var(--bg-subtle)", borderRadius: 8, padding: "7px 9px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
              <span style={{ ...label, fontSize: 8.5 }}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: AMBER, fontFamily: fonts.mono }}>
                {typeof v.value === "number" && v.value < 1 ? `${(v.value * 100).toFixed(0)}%` : v.value.toLocaleString()}
              </span>
            </div>
            <div style={{ ...note, fontSize: 9, marginTop: 3, whiteSpace: "normal" }}>{v.why}</div>
          </div>
        ))}
      </div>
    </Panel>

    <div style={{ ...card, fontSize: 10.5, fontFamily: fonts.mono, color: SLATE, lineHeight: 1.6 }}>
      <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>Why this is not yet a spot market.</span> The arbitrage logic holds —
      if tokens trade, GPU rental becomes a derived-demand price and the link between them is exactly the equation above. But a token is not
      a barrel of oil. A million tokens from a 70B dense model at 4K context and a million from a frontier MoE at 128K are different
      commodities with {Math.round((d.models.find(m => m.kind === "moe")?.output || 1) / (d.models.find(m => m.key === "small30b")?.output || 1))}× different
      production costs, as the table above shows on our own numbers. A real market would need standardised contracts — model class, latency
      tier, context bucket — which makes it look less like a single clearing price and more like electricity, with delivery zones and
      time-of-day products. The interesting question is where the software gains go: better batching, speculative decoding, FP4 and
      disaggregated prefill all raise tokens per GPU-hour, and whether that accrues to the GPU owner as higher rent or to the buyer as
      cheaper tokens depends entirely on who has pricing power. A liquid token market would pass it to buyers — and turn the toll collector
      into a utility.
    </div>
  </>);
}
