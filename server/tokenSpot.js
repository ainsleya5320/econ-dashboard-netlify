// ============================================================================
// TOKEN SPOT — what a token costs to make, derived from what a GPU costs to rent.
//
//   $/token = (GPU $/hour) / (tokens per GPU-hour x utilisation)
//
// The numerator is a market price we can read. The denominator is not a property
// of the GPU at all: it depends on the model, the batch size, the context
// length, the interactivity floor and the quality of the serving stack. So
// "backing out a token price" means building a throughput estimate from first
// principles and being explicit that the estimate, not the GPU price, is where
// the uncertainty lives.
//
// Two regimes, because inference has two phases with different bottlenecks:
//
//   PREFILL   reading the prompt. Compute-bound. All prompt tokens go through
//             in parallel, ~2 x active params FLOPs each.
//               tokens/sec = FLOPS x efficiency / (2 x activeParams)
//
//   DECODE    generating output. Memory-bandwidth-bound. Each step streams the
//             weights plus every active sequence's KV cache out of HBM and
//             yields one token per sequence in the batch.
//               step bytes = weightBytes + batch x context x kvBytesPerToken
//               tokens/sec = batch / (step bytes / (bandwidth x efficiency))
//
// The whole economics sits in that second formula. Weights are read once per
// step no matter how many users share it, so cost per token falls roughly as
// 1/batch until the KV cache starts to dominate the read.
//
// Against the derived floor we plot what the market actually charges, from
// Artificial Analysis. The gap between them is the part that is not physics.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, TTL = 6 * H
const fin = v => v != null && Number.isFinite(v)
const r2 = v => (fin(v) ? +v.toFixed(2) : null)
const r3 = v => (fin(v) ? +v.toFixed(3) : null)
const r4 = v => (fin(v) ? +v.toFixed(4) : null)
// The SemiAnalysis series mixes ISO dates with RFC-2822 strings
// ("Fri, 01 Aug 2025 00:00:00 GMT"), and the market series is ISO. Both have to
// land on the same key or the join silently produces nulls.
const isoDate = v => {
  const s = String(v || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null
}

// ── the physics ──

// Decode: bandwidth-bound. Returns tokens/sec for the whole GPU.
export function decodeTokensPerSec({ chip, model, batch, context, bandwidthEfficiency, gpus = 1 }) {
  // Tensor parallelism shards weights and KV across the node, so the aggregate
  // bytes moved per step are unchanged while bandwidth and capacity scale with
  // the GPU count. That is what lets a batch exist at all: 256 sequences at 4K
  // context need 238 GB, which no single 80 GB card can hold.
  const weightBytes = model.totalParamsB * 1e9 * model.bytesPerParam
  const kvBytes = batch * context * model.kvBytesPerToken
  const stepBytes = weightBytes + kvBytes
  const effBandwidth = chip.hbmTBs * gpus * 1e12 * bandwidthEfficiency
  const stepSeconds = stepBytes / effBandwidth
  return { tps: batch / stepSeconds, stepSeconds, stepBytes, weightBytes, kvBytes }
}

// Prefill: compute-bound. Returns tokens/sec for the whole GPU.
export function prefillTokensPerSec({ chip, model, computeEfficiency, gpus = 1 }) {
  const flops = (chip.flopsFP8 || chip.flopsFP16) * gpus
  if (!fin(flops)) return { tps: null }
  const flopsPerToken = 2 * model.activeParamsB * 1e9
  return { tps: (flops * computeEfficiency) / flopsPerToken, flops, flopsPerToken }
}

// A GPU-hour costs $R. If it makes T tokens/sec at U utilisation, a million
// tokens costs R / (T * 3600 * U) * 1e6.
const perMillion = (rateUsdHr, tps, utilisation) =>
  (fin(rateUsdHr) && fin(tps) && tps > 0 && utilisation > 0)
    ? (rateUsdHr / (tps * 3600 * utilisation)) * 1e6
    : null

export function costPerMillion({ chip, model, rateUsdHr, a }) {
  const gpus = a.gpusPerNode.value
  const nodeRate = fin(rateUsdHr) ? rateUsdHr * gpus : null   // the node is what is rented
  const dec = decodeTokensPerSec({ chip, model, batch: a.batchSize.value, context: a.contextTokens.value, bandwidthEfficiency: a.bandwidthEfficiency.value, gpus })
  const pre = prefillTokensPerSec({ chip, model, computeEfficiency: a.computeEfficiency.value, gpus })
  const output = perMillion(nodeRate, dec.tps, a.fleetUtilisation.value)
  const input = perMillion(nodeRate, pre.tps, a.fleetUtilisation.value)
  const ratio = a.outputPerInput.value
  // A blended million: `ratio` output tokens for every input token.
  const blended = fin(output) && fin(input) ? (input * (1 - ratio) + output * ratio) : null
  return {
    output: r3(output), input: r3(input), blended: r3(blended),
    decodeTps: Math.round(dec.tps), prefillTps: fin(pre.tps) ? Math.round(pre.tps) : null,
    perUserTps: r2(dec.tps / a.batchSize.value),
    stepMs: r2(dec.stepSeconds * 1000),
    weightShare: r2((dec.weightBytes / dec.stepBytes) * 100),
    nodeRate: r2(nodeRate),
    nodeMemoryGB: chip.memoryGB * gpus,
    stepGB: r2(dec.stepBytes / 1e9),
    fits: dec.stepBytes / 1e9 <= chip.memoryGB * gpus,
    // before the utilisation divide, i.e. if the fleet never idled
    outputAtFullUse: r3(perMillion(nodeRate, dec.tps, 1)),
  }
}

// How cost per million output tokens falls with batch size — the curve that is
// the actual economics of inference.
function batchCurve({ chip, model, rateUsdHr, a }) {
  const sizes = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]
  return sizes.map(b => {
    const gpus = a.gpusPerNode.value
    const d = decodeTokensPerSec({ chip, model, batch: b, context: a.contextTokens.value, bandwidthEfficiency: a.bandwidthEfficiency.value, gpus })
    // A batch is only usable if its KV cache fits alongside the weights.
    const needGB = (d.weightBytes + d.kvBytes) / 1e9
    return {
      batch: b,
      perM: r3(perMillion(fin(rateUsdHr) ? rateUsdHr * gpus : null, d.tps, a.fleetUtilisation.value)),
      perUserTps: r2(d.tps / b),
      memGB: r2(needGB),
      fits: needGB <= chip.memoryGB * a.gpusPerNode.value,
    }
  })
}

// Normalise a rental price by the resource each phase actually consumes, so
// different silicon can be compared on the thing it is being rented for.
function normalise(chip, rateUsdHr) {
  return {
    perTBs: fin(rateUsdHr) ? r3(rateUsdHr / chip.hbmTBs) : null,           // decode
    perPFLOP: fin(rateUsdHr) && (chip.flopsFP8 || chip.flopsFP16)
      ? r3(rateUsdHr / ((chip.flopsFP8 || chip.flopsFP16) / 1e15)) : null,  // prefill
    gbPerDollar: fin(rateUsdHr) && rateUsdHr > 0 ? r2(chip.memoryGB / rateUsdHr) : null,
  }
}

export function createTokenSpot({ dir, UA, semiH100, aiPrices }) {
  const ref = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'ai', 'token-spot.json'), 'utf8'))
  let mem = null, inflight = null

  async function build() {
    const t0 = Date.now()
    const a = ref.assumptions
    const chip = ref.chips.h100
    const model = ref.models.dense70b

    // ── the GPU price history: the one input that is a real market price ──
    let series = []
    try {
      const semi = await semiH100()
      series = (semi?.series || []).map(p => ({ ...p, date: isoDate(p.date) })).filter(p => p.date && fin(p.h100))
      series.sort((x, y) => x.date.localeCompare(y.date))
    } catch (e) { console.error('token-spot: semi-h100 —', e.message) }

    // ── market prices: what the API actually charges, same dates ──
    let market = new Map(), modelsAsOf = null
    try {
      const ap = await aiPrices()
      const th = ap?.history?.tokenHistory || []
      for (const pt of th) {
        const ms = (pt.models || []).filter(m => fin(m.output) && m.output > 0)
        if (!ms.length) continue
        const outs = ms.map(m => m.output).sort((x, y) => x - y)
        const ins = ms.map(m => m.input).filter(fin).sort((x, y) => x - y)
        const med = arr => (arr.length ? arr[Math.floor(arr.length / 2)] : null)
        market.set(isoDate(pt.date), {
          medianOutput: r3(med(outs)), medianInput: r3(med(ins)),
          cheapestOutput: r3(outs[0]), models: ms.length,
        })
        modelsAsOf = isoDate(pt.date)
      }
    } catch (e) { console.error('token-spot: ai-prices —', e.message) }

    // ── the derived floor, one point per day of GPU price history ──
    const history = series.map(p => {
      const c = costPerMillion({ chip, model, rateUsdHr: p.h100, a })
      const mk = market.get(p.date) || null
      return {
        d: p.date, rate: p.h100,
        floorOutput: c.output, floorInput: c.input, floorBlended: c.blended,
        marketOutput: mk?.medianOutput ?? null,
        marketCheapest: mk?.cheapestOutput ?? null,
        markup: mk?.medianOutput && c.output ? r2(mk.medianOutput / c.output) : null,
      }
    })

    const latest = history[history.length - 1] || null
    const rate = latest?.rate ?? null
    const detail = costPerMillion({ chip, model, rateUsdHr: rate, a })

    // every chip at its own current rental, for the comparison table
    const chips = Object.entries(ref.chips).filter(([k]) => !k.startsWith('_')).map(([key, ch]) => {
      const spot = key === 'h100' ? rate
        : key === 'a100' ? (series[series.length - 1]?.a100 ?? null)
        : key === 'b200' ? (series[series.length - 1]?.b200 ?? null)
        : null
      const m = ch.flopsFP8 || ch.flopsFP16 ? costPerMillion({ chip: ch, model, rateUsdHr: spot, a }) : null
      return { key, ...ch, spot: r2(spot), norm: normalise(ch, spot), perM: m }
    })

    return {
      built: new Date().toISOString(), tookMs: Date.now() - t0,
      reviewed: ref.reviewed,
      chip: { key: 'h100', ...chip }, model,
      assumptions: a,
      latest: latest ? { ...latest, ...detail } : null,
      history: history.slice(-900),
      batchCurve: batchCurve({ chip, model, rateUsdHr: rate, a }),
      chips,
      models: Object.entries(ref.models).filter(([k]) => !k.startsWith('_')).map(([key, m]) => ({
        key, ...m, ...costPerMillion({ chip, model: m, rateUsdHr: rate, a }),
      })),
      missingInputs: ref.missingInputs,
      marketAsOf: modelsAsOf,
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    if (inflight) return inflight
    inflight = (async () => {
      try { const data = await build(); mem = { ts: Date.now(), data }; return data }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
