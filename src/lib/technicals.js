// ============================================================================
// TECHNICALS — indicator math for the stock page's Technical analysis view.
//
// Plain functions on arrays, no React, so they can be checked from node. Every
// indicator uses the textbook definition and the parameters a practitioner
// would expect to see quoted:
//   SMA / EMA            simple and exponential moving averages (EMA seeded
//                        with the SMA of its first window)
//   RSI(14)              Wilder's smoothing
//   MACD(12, 26, 9)      EMA difference, EMA signal, histogram
//   Bollinger(20, 2)     population standard deviation; %B and bandwidth
//   ATR(14), ADX(14)     Wilder's true range and directional movement
//   Stochastic(14, 3, 3) slow stochastic
//   OBV                  on-balance volume
// Bars are {d, o, h, l, c, v}, oldest first. Prices are split-adjusted but
// not dividend-adjusted (the provider's convention, and the charting norm).
// ============================================================================

export const fin = v => v != null && Number.isFinite(v);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

export function sma(x, n) {
  const out = new Array(x.length).fill(null);
  let sum = 0, cnt = 0;
  for (let i = 0; i < x.length; i++) {
    if (fin(x[i])) { sum += x[i]; cnt++; }
    if (i >= n && fin(x[i - n])) { sum -= x[i - n]; cnt--; }
    if (i >= n - 1 && cnt === n) out[i] = sum / n;
  }
  return out;
}

export function ema(x, n) {
  const out = new Array(x.length).fill(null), k = 2 / (n + 1);
  let start = x.findIndex(fin);
  if (start < 0 || x.length - start < n) return out;
  let prev = mean(x.slice(start, start + n));
  out[start + n - 1] = prev;
  for (let i = start + n; i < x.length; i++) { if (!fin(x[i])) { out[i] = prev; continue; } prev = x[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

// Wilder's smoothing, seeded with the simple mean of the first n values
function wilder(x, n, from = 0) {
  const out = new Array(x.length).fill(null);
  if (x.length - from < n) return out;
  let prev = mean(x.slice(from, from + n));
  out[from + n - 1] = prev;
  for (let i = from + n; i < x.length; i++) { prev = (prev * (n - 1) + x[i]) / n; out[i] = prev; }
  return out;
}

export function rsi(c, n = 14) {
  const gain = [0], loss = [0];
  for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1]; gain.push(Math.max(ch, 0)); loss.push(Math.max(-ch, 0)); }
  const ag = wilder(gain, n, 1), al = wilder(loss, n, 1);
  return c.map((_, i) => (fin(ag[i]) && fin(al[i]) ? (al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i])) : null));
}

export function macd(c, fast = 12, slow = 26, sig = 9) {
  const f = ema(c, fast), s = ema(c, slow);
  const line = c.map((_, i) => (fin(f[i]) && fin(s[i]) ? f[i] - s[i] : null));
  const signal = ema(line, sig);
  return { line, signal, hist: line.map((v, i) => (fin(v) && fin(signal[i]) ? v - signal[i] : null)) };
}

export function bollinger(c, n = 20, k = 2) {
  const mid = sma(c, n), up = [], lo = [], pctB = [], bw = [];
  for (let i = 0; i < c.length; i++) {
    if (!fin(mid[i])) { up.push(null); lo.push(null); pctB.push(null); bw.push(null); continue; }
    const w = c.slice(i - n + 1, i + 1), m = mid[i];
    const sd = Math.sqrt(mean(w.map(x => (x - m) ** 2)));
    up.push(m + k * sd); lo.push(m - k * sd);
    pctB.push(sd > 0 ? (c[i] - (m - k * sd)) / (2 * k * sd) : null);
    bw.push(m > 0 ? (2 * k * sd) / m : null);
  }
  return { mid, up, lo, pctB, bw };
}

export function trueRange(h, l, c) {
  return h.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
}
export const atr = (h, l, c, n = 14) => wilder(trueRange(h, l, c), n, 1);

export function adx(h, l, c, n = 14) {
  const tr = trueRange(h, l, c), pdm = [0], mdm = [0];
  for (let i = 1; i < h.length; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  const sTR = wilder(tr, n, 1), sP = wilder(pdm, n, 1), sM = wilder(mdm, n, 1);
  const pdi = h.map((_, i) => (fin(sTR[i]) && sTR[i] > 0 ? (100 * sP[i]) / sTR[i] : null));
  const mdi = h.map((_, i) => (fin(sTR[i]) && sTR[i] > 0 ? (100 * sM[i]) / sTR[i] : null));
  const dx = h.map((_, i) => (fin(pdi[i]) && fin(mdi[i]) && pdi[i] + mdi[i] > 0 ? (100 * Math.abs(pdi[i] - mdi[i])) / (pdi[i] + mdi[i]) : null));
  const first = dx.findIndex(fin);
  const adxLine = first >= 0 ? wilder(dx.map(v => (fin(v) ? v : 0)), n, first) : dx.map(() => null);
  return { adx: adxLine, pdi, mdi };
}

export function stochastic(h, l, c, n = 14, kS = 3, dS = 3) {
  const raw = c.map((_, i) => {
    if (i < n - 1) return null;
    const hh = Math.max(...h.slice(i - n + 1, i + 1)), ll = Math.min(...l.slice(i - n + 1, i + 1));
    return hh > ll ? (100 * (c[i] - ll)) / (hh - ll) : 50;
  });
  const k = sma(raw, kS);
  return { k, d: sma(k, dS) };
}

export function obv(c, v) {
  const out = [0];
  for (let i = 1; i < c.length; i++) out.push(out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0));
  return out;
}

// least-squares slope of the last n points, as % of the mean level per bar
function slopePct(x, n) {
  const w = x.slice(-n).filter(fin);
  if (w.length < n * 0.8) return null;
  const m = mean(w), xm = (w.length - 1) / 2;
  let num = 0, den = 0;
  w.forEach((y, i) => { num += (i - xm) * (y - m); den += (i - xm) ** 2; });
  return m !== 0 ? (num / den / Math.abs(m)) * 100 : null;
}

// ── aggregation ──
export function toWeekly(bars) {
  const out = [];
  let cur = null, key = null;
  for (const b of bars) {
    const dt = new Date(b.d + "T00:00:00Z"), dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
    const k = new Date(dt.getTime() - dow * 864e5).toISOString().slice(0, 10);
    if (k !== key) { if (cur) out.push(cur); key = k; cur = { d: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; }
    else { cur.d = b.d; cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  if (cur) out.push(cur);
  return out;
}

// Every indicator for a bar series, as arrays aligned with it. Daily uses the
// 20/50/200-day averages; weekly the 10- and 40-week, their usual stand-ins.
export function indicators(bars, weekly = false) {
  const o = bars.map(b => b.o), h = bars.map(b => b.h), l = bars.map(b => b.l), c = bars.map(b => b.c), v = bars.map(b => b.v);
  const maP = weekly ? [10, 40] : [20, 50, 200];
  const ma = Object.fromEntries(maP.map(p => [p, sma(c, p)]));
  const bb = bollinger(c, 20, 2), m = macd(c), r = rsi(c), a = atr(h, l, c), dm = adx(h, l, c), st = stochastic(h, l, c), ob = obv(c, v);
  const vAvg = sma(v, weekly ? 10 : 50);
  return { o, h, l, c, v, ma, maP, bb, macd: m, rsi: r, atr: a, adx: dm, stoch: st, obv: ob, vAvg };
}

// ── levels ──
// Swing highs and lows (a bar that is the extreme of the k bars either side),
// clustered into zones: pivots within a tolerance of each other are one level,
// and the number of pivots in a zone is how often price turned there.
export function swingLevels(bars, atrNow, { k = 5, lookback = 504 } = {}) {
  const start = Math.max(k, bars.length - lookback), pts = [];
  for (let i = start; i < bars.length - k; i++) {
    const w = bars.slice(i - k, i + k + 1);
    if (bars[i].h === Math.max(...w.map(b => b.h))) pts.push({ p: bars[i].h, d: bars[i].d, kind: "high" });
    if (bars[i].l === Math.min(...w.map(b => b.l))) pts.push({ p: bars[i].l, d: bars[i].d, kind: "low" });
  }
  const last = bars[bars.length - 1].c;
  const tol = Math.max((atrNow || 0) * 0.6, last * 0.012);
  pts.sort((a, b) => a.p - b.p);
  const zones = [];
  for (const pt of pts) {
    const z = zones[zones.length - 1];
    if (z && pt.p - z.lo <= tol * 1.5) { z.members.push(pt); z.hi = pt.p; }
    else zones.push({ lo: pt.p, hi: pt.p, members: [pt] });
  }
  return zones.map(z => ({
    price: mean(z.members.map(m => m.p)), lo: z.lo, hi: z.hi, touches: z.members.length,
    last: z.members.map(m => m.d).sort().at(-1),
    highs: z.members.filter(m => m.kind === "high").length, lows: z.members.filter(m => m.kind === "low").length,
  }));
}

// classic floor-trader pivots from a completed period's high, low and close
export function pivots(h, l, c) {
  const p = (h + l + c) / 3;
  return { P: p, R1: 2 * p - l, S1: 2 * p - h, R2: p + (h - l), S2: p - (h - l) };
}

// ── the full read ──
export function analyze(bars, bench) {
  const n = bars.length, I = indicators(bars), W = toWeekly(bars);
  const last = n - 1, c = I.c, px = c[last];
  const at = (arr, i = last) => (fin(arr[i]) ? arr[i] : null);
  const back = k => (n - 1 - k >= 0 ? c[n - 1 - k] : null);
  const ret = k => (fin(back(k)) ? (px / back(k) - 1) * 100 : null);

  // benchmark aligned by date
  const bMap = bench ? new Map(bench.map(b => [b.d, b.c])) : null;
  const pairs = bMap ? bars.map(b => [b.d, b.c, bMap.get(b.d)]).filter(x => fin(x[2])) : [];
  const bRet = k => { if (pairs.length <= k) return null; const e = pairs[pairs.length - 1], s = pairs[pairs.length - 1 - k]; return (e[2] / s[2] - 1) * 100; };
  const sRet = k => { if (pairs.length <= k) return null; const e = pairs[pairs.length - 1], s = pairs[pairs.length - 1 - k]; return (e[1] / s[1] - 1) * 100; };
  const ytdStart = (() => { const y = bars[last].d.slice(0, 4); let i = n - 1; while (i > 0 && bars[i - 1].d.slice(0, 4) === y) i--; return i > 0 ? i - 1 : null; })();
  const ytd = ytdStart != null ? (px / c[ytdStart] - 1) * 100 : null;
  const bYtd = (() => { if (!pairs.length) return null; const y = pairs.at(-1)[0].slice(0, 4); const prior = [...pairs].reverse().find(p => p[0].slice(0, 4) < y); return prior ? (pairs.at(-1)[2] / prior[2] - 1) * 100 : null; })();

  // relative strength line (stock / benchmark), rebased to 100 a year back
  const rs = pairs.map(([d, s, b]) => ({ d, v: s / b }));
  const rsBase = rs.length > 252 ? rs[rs.length - 253].v : rs[0]?.v;
  const rsLine = rs.slice(-504).map(p => ({ d: p.d, v: rsBase ? +((p.v / rsBase) * 100).toFixed(2) : null }));
  const rsNow = rs.at(-1)?.v, rsHi = rs.length > 252 ? Math.max(...rs.slice(-252).map(p => p.v)) : null;

  // beta and correlation from daily returns, over one year and three: the
  // two can differ a lot when a stock's role in the market changes
  const betaOver = days => {
    if (pairs.length <= days) return { beta: null, corr: null };
    const w = pairs.slice(-(days + 1)), rs1 = [], rb = [];
    for (let i = 1; i < w.length; i++) { rs1.push(w[i][1] / w[i - 1][1] - 1); rb.push(w[i][2] / w[i - 1][2] - 1); }
    const ms = mean(rs1), mb = mean(rb);
    let cov = 0, vb = 0, vs = 0;
    for (let i = 0; i < rs1.length; i++) { cov += (rs1[i] - ms) * (rb[i] - mb); vb += (rb[i] - mb) ** 2; vs += (rs1[i] - ms) ** 2; }
    return { beta: vb > 0 ? cov / vb : null, corr: vb > 0 && vs > 0 ? cov / Math.sqrt(vb * vs) : null };
  };
  const { beta, corr } = betaOver(252), { beta: beta3y, corr: corr3y } = betaOver(756);

  // volatility and drawdown
  const logr = c.map((x, i) => (i ? Math.log(x / c[i - 1]) : null));
  const hv = k => { const w = logr.slice(-k).filter(fin); if (w.length < k * 0.9) return null; const m = mean(w); return Math.sqrt(mean(w.map(x => (x - m) ** 2)) * 252) * 100; };
  let peak = -Infinity;
  const dd = c.map((x, i) => { peak = Math.max(peak, x); return { d: bars[i].d, v: +((x / peak - 1) * 100).toFixed(2) }; });
  const maxDD = k => Math.min(...dd.slice(-k).map(p => p.v));
  const yr = bars.slice(-252), hi52 = Math.max(...yr.map(b => b.h)), lo52 = Math.min(...yr.map(b => b.l));
  const hi52d = yr.find(b => b.h === hi52)?.d, lo52d = yr.find(b => b.l === lo52)?.d;

  // levels
  const atrNow = at(I.atr);
  const zones = swingLevels(bars, atrNow);
  const lastWeekBars = W.length > 1 ? W[W.length - 2] : null;
  const months = (() => { const m = new Map(); for (const b of bars) { const k = b.d.slice(0, 7), e = m.get(k); if (!e) m.set(k, { h: b.h, l: b.l, c: b.c }); else { e.h = Math.max(e.h, b.h); e.l = Math.min(e.l, b.l); e.c = b.c; } } return [...m.values()]; })();
  const lastMonth = months.length > 1 ? months[months.length - 2] : null;
  const fib = (() => {
    const up = hi52d > lo52d, range = hi52 - lo52;
    return { up, from: up ? lo52 : hi52, to: up ? hi52 : lo52, levels: [0.236, 0.382, 0.5, 0.618, 0.786].map(r => ({ r, p: up ? hi52 - range * r : lo52 + range * r })) };
  })();
  const res = zones.filter(z => z.price > px * 1.002).sort((a, b) => a.price - b.price).slice(0, 3);
  const sup = zones.filter(z => z.price < px * 0.998).sort((a, b) => b.price - a.price).slice(0, 3);

  // ── the checks: each reads +1 bullish, 0 neutral, −1 bearish ──
  const s20 = at(I.ma[20]), s50 = at(I.ma[50]), s200 = at(I.ma[200]);
  const slope50 = slopePct(I.ma[50], 20), slope200 = slopePct(I.ma[200], 20);
  const rsiNow = at(I.rsi), mLine = at(I.macd.line), mSig = at(I.macd.signal), mHist = at(I.macd.hist);
  const adxNow = at(I.adx.adx), pdi = at(I.adx.pdi), mdi = at(I.adx.mdi);
  const kNow = at(I.stoch.k), dNow = at(I.stoch.d);
  const bb = { up: at(I.bb.up), lo: at(I.bb.lo), mid: at(I.bb.mid), pctB: at(I.bb.pctB), bw: at(I.bb.bw) };
  const bwHist = I.bb.bw.slice(-126).filter(fin), bwPct = bwHist.length ? Math.round((bwHist.filter(x => x <= bb.bw).length / bwHist.length) * 100) : null;
  // net on-balance volume over 50 days as a share of all volume traded: +100%
  // would mean every share traded on an up day
  const vol50 = I.v.slice(-50).reduce((s, x) => s + x, 0);
  const obvFlow = n > 51 && vol50 > 0 ? ((I.obv[last] - I.obv[last - 50]) / vol50) * 100 : null;
  const upVol = bars.slice(-50).reduce((s, b, i, a) => s + (i && b.c > a[i - 1].c ? b.v : 0), 0);
  const dnVol = bars.slice(-50).reduce((s, b, i, a) => s + (i && b.c < a[i - 1].c ? b.v : 0), 0);
  const udRatio = dnVol > 0 ? upVol / dnVol : null;
  const rs3 = fin(sRet(63)) && fin(bRet(63)) ? sRet(63) - bRet(63) : null;
  const rs6 = fin(sRet(126)) && fin(bRet(126)) ? sRet(126) - bRet(126) : null;
  const rs12 = fin(sRet(252)) && fin(bRet(252)) ? sRet(252) - bRet(252) : null;
  const tri = (cond, bad) => (cond ? 1 : bad ? -1 : 0);
  const pctFrom = (a, b) => (fin(a) && fin(b) && b ? (a / b - 1) * 100 : null);
  const mom12_1 = n > 252 ? (c[n - 22] / c[n - 253] - 1) * 100 : null;

  const checks = [
    { cat: "Trend", name: "Price vs 50-day average", value: pctFrom(px, s50), unit: "%", s: tri(px > s50, px < s50), note: "above = short-term trend up" },
    { cat: "Trend", name: "Price vs 200-day average", value: pctFrom(px, s200), unit: "%", s: tri(px > s200, px < s200), note: "the line most institutions watch" },
    { cat: "Trend", name: "50-day vs 200-day", value: pctFrom(s50, s200), unit: "%", s: tri(s50 > s200, s50 < s200), note: "above = golden-cross regime" },
    { cat: "Trend", name: "200-day slope (20 days)", value: fin(slope200) ? slope200 * 20 : null, unit: "%", s: tri(slope200 > 0.01, slope200 < -0.01), note: "rising long-term average" },
    { cat: "Trend", name: "ADX(14) and direction", value: adxNow, unit: "", s: fin(adxNow) && adxNow >= 20 ? tri(pdi > mdi, pdi < mdi) : 0, note: fin(adxNow) ? (adxNow >= 25 ? "strong trend" : adxNow >= 20 ? "trend forming" : "no trend — range-bound") + (fin(pdi) ? `, +DI ${pdi.toFixed(0)} / −DI ${mdi.toFixed(0)}` : "") : "" },
    { cat: "Momentum", name: "RSI(14)", value: rsiNow, unit: "", s: fin(rsiNow) ? (rsiNow >= 70 ? 0 : rsiNow <= 30 ? 0 : tri(rsiNow > 55, rsiNow < 45)) : 0, note: fin(rsiNow) ? (rsiNow >= 70 ? "overbought — strong, but stretched" : rsiNow <= 30 ? "oversold — weak, but stretched" : rsiNow > 55 ? "positive momentum" : rsiNow < 45 ? "negative momentum" : "neutral") : "" },
    { cat: "Momentum", name: "MACD vs signal", value: mHist, unit: "", s: tri(mHist > 0, mHist < 0), note: fin(mLine) ? `MACD ${mLine >= 0 ? "above" : "below"} zero` : "" },
    { cat: "Momentum", name: "Stochastic(14,3,3)", value: kNow, unit: "", s: fin(kNow) ? (kNow >= 80 || kNow <= 20 ? 0 : tri(kNow > dNow, kNow < dNow)) : 0, note: fin(kNow) ? (kNow >= 80 ? "overbought zone" : kNow <= 20 ? "oversold zone" : `%K ${kNow > dNow ? "above" : "below"} %D`) : "" },
    { cat: "Momentum", name: "12-month momentum (ex last month)", value: mom12_1, unit: "%", s: tri(mom12_1 > 0, mom12_1 < 0), note: "the academic momentum factor, 12-1" },
    { cat: "Volume", name: "On-balance volume, 50 days", value: obvFlow, unit: "%", s: tri(obvFlow > 10, obvFlow < -10), note: "net up-day volume as a share of all volume" },
    { cat: "Volume", name: "Up/down volume (50 days)", value: udRatio, unit: "×", s: fin(udRatio) ? tri(udRatio > 1.15, udRatio < 0.87) : 0, note: "volume on up days ÷ down days" },
    { cat: "Relative strength", name: "vs S&P 500, 3 months", value: rs3, unit: "pp", s: fin(rs3) ? tri(rs3 > 2, rs3 < -2) : 0, note: "outperformance in percentage points" },
    { cat: "Relative strength", name: "vs S&P 500, 6 months", value: rs6, unit: "pp", s: fin(rs6) ? tri(rs6 > 3, rs6 < -3) : 0, note: "" },
    { cat: "Relative strength", name: "vs S&P 500, 12 months", value: rs12, unit: "pp", s: fin(rs12) ? tri(rs12 > 5, rs12 < -5) : 0, note: "" },
  ].map(x => ({ ...x, value: fin(x.value) ? x.value : null, s: fin(x.value) ? x.s : 0 }));
  const cats = ["Trend", "Momentum", "Volume", "Relative strength"].map(cat => {
    const xs = checks.filter(x => x.cat === cat && fin(x.value));
    const score = xs.length ? xs.reduce((s, x) => s + x.s, 0) / xs.length : null;
    return { cat, score, bull: xs.filter(x => x.s > 0).length, bear: xs.filter(x => x.s < 0).length, n: xs.length };
  });
  const used = checks.filter(x => fin(x.value));
  const overall = used.length ? used.reduce((s, x) => s + x.s, 0) / used.length : 0;
  const posture = overall >= 0.5 ? "Bullish" : overall >= 0.2 ? "Leaning bullish" : overall > -0.2 ? "Neutral" : overall > -0.5 ? "Leaning bearish" : "Bearish";

  const trendState = fin(s50) && fin(s200)
    ? (px > s50 && s50 > s200 && slope200 > 0 ? "uptrend"
      : px < s50 && s50 < s200 && slope200 < 0 ? "downtrend"
      : px > s200 && px < s50 ? "pullback within a long-term uptrend"
      : px < s200 && px > s50 ? "rebound within a long-term downtrend"
      : px > s200 ? "long-term uptrend, short-term mixed" : "long-term downtrend, short-term mixed")
    : "not enough history for a trend read";

  return {
    px, date: bars[last].d, n, I, W,
    ma: { s20, s50, s200, slope50, slope200 }, rsi: rsiNow, macd: { line: mLine, sig: mSig, hist: mHist },
    adx: { adx: adxNow, pdi, mdi }, stoch: { k: kNow, d: dNow }, bb: { ...bb, bwPct },
    atr: atrNow, atrPct: fin(atrNow) ? (atrNow / px) * 100 : null, hv20: hv(20), hv60: hv(60),
    beta, corr, beta3y, corr3y, hi52, lo52,
    // the provider's latest bar is today's while the market is open
    partial: bars[last].d >= new Date().toISOString().slice(0, 10), hi52d, lo52d, pos52: hi52 > lo52 ? ((px - lo52) / (hi52 - lo52)) * 100 : null,
    fromHi: pctFrom(px, hi52), dd, ddNow: dd[last].v, maxDD1y: maxDD(252), maxDD5y: maxDD(n),
    returns: [["1 week", 5], ["1 month", 21], ["3 months", 63], ["6 months", 126], ["YTD", null], ["1 year", 252], ["3 years", 756], ["5 years", 1250]].map(([label, k]) => {
      const s = k == null ? ytd : ret(k), b = k == null ? bYtd : bRet(k);
      return { label, stock: s, bench: b, excess: fin(s) && fin(b) ? s - b : null };
    }),
    rsLine, rsAtHigh: fin(rsNow) && fin(rsHi) ? rsNow >= rsHi * 0.995 : null,
    levels: { res, sup, zones, pivW: lastWeekBars ? pivots(lastWeekBars.h, lastWeekBars.l, lastWeekBars.c) : null, pivM: lastMonth ? pivots(lastMonth.h, lastMonth.l, lastMonth.c) : null, fib },
    volume: { avg50: at(I.vAvg), rel: fin(at(I.vAvg)) && at(I.vAvg) > 0 ? bars[last].v / at(I.vAvg) : null, udRatio },
    checks, cats, overall, posture, trendState,
    events: events(bars, I),
  };
}

// ── the signal log: dated events over the last ~6 months ──
export function events(bars, I, lookback = 126) {
  const out = [], n = bars.length, c = I.c;
  const add = (i, kind, tone, text) => { const e = { i, d: bars[i].d, kind, tone, text }; out.push(e); return e; };
  // A cross that reverses within `gap` bars was a whipsaw: both halves go,
  // and if that leaves the earlier state in place the new cross adds nothing.
  // The log therefore always ends on a cross that still describes today.
  const stack = {};
  const addFlip = (key, gap, i, kind, tone, text) => {
    const st = stack[key] || (stack[key] = []), prev = st[st.length - 1];
    if (prev && prev.kind !== kind && i - prev.i < gap) {
      out.splice(out.indexOf(prev), 1); st.pop();
      if (st[st.length - 1]?.kind === kind) return;
    }
    st.push(add(i, kind, tone, text));
  };
  const crossUp = (a, b, i) => fin(a[i]) && fin(b[i]) && fin(a[i - 1]) && fin(b[i - 1]) && a[i - 1] <= b[i - 1] && a[i] > b[i];
  const crossDn = (a, b, i) => fin(a[i]) && fin(b[i]) && fin(a[i - 1]) && fin(b[i - 1]) && a[i - 1] >= b[i - 1] && a[i] < b[i];
  const lastSeen = {};
  const quiet = (key, i, gap) => { if (lastSeen[key] != null && i - lastSeen[key] < gap) return false; lastSeen[key] = i; return true; };
  const s50 = I.ma[50], s200 = I.ma[200], line = I.macd.line, sig = I.macd.signal, zero = c.map(() => 0);
  for (let i = Math.max(1, n - lookback - 260); i < n; i++) {
    if (crossUp(s50, s200, i)) addFlip("gc", 20, i, "golden cross", 1, "50-day average crossed above the 200-day");
    if (crossDn(s50, s200, i)) addFlip("gc", 20, i, "death cross", -1, "50-day average crossed below the 200-day");
    // closes through the 200-day; a dip of under two weeks collapses as a whipsaw
    if (crossUp(c, s200, i)) addFlip("p200", 10, i, "200-day reclaimed", 1, "closed back above the 200-day average");
    if (crossDn(c, s200, i)) addFlip("p200", 10, i, "200-day lost", -1, "closed below the 200-day average");
    // MACD lines running close together whipsaw; see addFlip
    if (crossUp(line, sig, i)) addFlip("mx", 10, i, "MACD bullish cross", 1, "MACD crossed above its signal line");
    if (crossDn(line, sig, i)) addFlip("mx", 10, i, "MACD bearish cross", -1, "MACD crossed below its signal line");
    if (crossUp(line, zero, i)) addFlip("mz", 10, i, "MACD above zero", 1, "12-day EMA moved above the 26-day");
    if (crossDn(line, zero, i)) addFlip("mz", 10, i, "MACD below zero", -1, "12-day EMA moved below the 26-day");
    const r = I.rsi;
    if (fin(r[i]) && fin(r[i - 1])) {
      if (r[i - 1] < 70 && r[i] >= 70 && quiet("ob", i, 10)) add(i, "RSI overbought", 0, `RSI rose to ${r[i].toFixed(0)}`);
      if (r[i - 1] > 30 && r[i] <= 30 && quiet("os", i, 10)) add(i, "RSI oversold", 0, `RSI fell to ${r[i].toFixed(0)}`);
    }
    if (i >= 252) {
      const yr = bars.slice(i - 251, i);
      if (bars[i].h > Math.max(...yr.map(b => b.h)) && quiet("hi", i, 15)) add(i, "52-week high", 1, `new 52-week high at ${bars[i].h.toFixed(2)}`);
      if (bars[i].l < Math.min(...yr.map(b => b.l)) && quiet("lo", i, 15)) add(i, "52-week low", -1, `new 52-week low at ${bars[i].l.toFixed(2)}`);
    }
    const bw = I.bb.bw;
    if (fin(bw[i]) && i >= 126) {
      const w = bw.slice(i - 125, i + 1).filter(fin);
      if (bw[i] <= Math.min(...w) && quiet("sq", i, 20)) add(i, "Bollinger squeeze", 0, "band width at a 6-month low — volatility compressed, a move often follows");
    }
    const va = I.vAvg[i - 1];
    if (fin(va) && va > 0) {
      const gap = bars[i].o / c[i - 1] - 1;
      if (Math.abs(gap) >= 0.03 && bars[i].v >= 1.5 * va) add(i, gap > 0 ? "gap up" : "gap down", gap > 0 ? 1 : -1, `opened ${(gap * 100).toFixed(1)}% ${gap > 0 ? "higher" : "lower"} on ${(bars[i].v / va).toFixed(1)}× average volume`);
      else if (bars[i].v >= 2.5 * va) add(i, "volume spike", bars[i].c >= c[i - 1] ? 1 : -1, `${(bars[i].v / va).toFixed(1)}× average volume, closed ${bars[i].c >= c[i - 1] ? "up" : "down"} ${Math.abs((bars[i].c / c[i - 1] - 1) * 100).toFixed(1)}%`);
    }
  }
  return out.filter(e => e.i >= n - lookback).reverse();
}
