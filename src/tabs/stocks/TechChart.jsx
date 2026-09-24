import React, { useEffect, useMemo, useRef, useState } from "react";
import { fonts } from "../../lib/styles.js";
import { fin } from "../../lib/technicals.js";

// ============================================================================
// TECH CHART — a stacked price / RSI / MACD chart drawn in SVG.
// Recharts has no candlestick and no shared crosshair across panes, and a
// charting library is a dependency this app does not otherwise need, so this
// draws its own: candles (or a close line when bars get thinner than 2px),
// moving averages, Bollinger bands, volume under the price, support and
// resistance lines, signal markers, and one crosshair across every pane.
// Props are the visible bars plus indicator arrays already sliced to match.
// ============================================================================

export const UP = "#26a69a", DOWN = "#ef5350";
export const MA_COLORS = { 10: "#f59e0b", 20: "#f59e0b", 40: "#a855f7", 50: "#3b82f6", 200: "#a855f7" };
const AXIS_W = 58, PADL = 4;

function niceTicks(lo, hi, count = 5) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const fmtPx = v => (!fin(v) ? "—" : v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2));
const fmtVol = v => (!fin(v) ? "—" : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v}`);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// an SVG path through the finite points of a series, breaking at gaps
function linePath(vals, x, y) {
  let d = "", pen = false;
  vals.forEach((v, i) => { if (!fin(v)) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
  return d;
}

export default function TechChart({ bars, ind, maList, show, log, levels = [], markers = [], phone }) {
  const ref = useRef(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(e => setW(Math.max(280, Math.floor(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = bars.length;
  const H_PRICE = phone ? 250 : 340, H_RSI = phone ? 66 : 82, H_MACD = phone ? 72 : 92, GAP = 10, H_X = 18;
  const plotW = w - AXIS_W - PADL;
  const step = plotW / Math.max(n, 1);
  const x = i => PADL + (i + 0.5) * step;
  const rsiTop = H_PRICE + GAP, macdTop = rsiTop + (show.rsi ? H_RSI + GAP : 0);
  const totalH = macdTop + (show.macd ? H_MACD + GAP : 0) + H_X - GAP;

  const geo = useMemo(() => {
    if (!n) return null;
    // price domain from what is actually drawn
    const vals = [];
    bars.forEach((b, i) => {
      vals.push(b.h, b.l);
      for (const p of maList) if (show[`ma${p}`] && fin(ind.ma[p]?.[i])) vals.push(ind.ma[p][i]);
      if (show.bb && fin(ind.bb.up[i])) vals.push(ind.bb.up[i], ind.bb.lo[i]);
    });
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.04; lo = Math.max(lo - pad, log ? lo * 0.97 : -Infinity); hi += pad;
    const top = 16, bottom = H_PRICE * (show.volume ? 0.8 : 0.97);
    const y = log
      ? v => top + ((Math.log(hi) - Math.log(Math.max(v, 1e-9))) / (Math.log(hi) - Math.log(lo))) * (bottom - top)
      : v => top + ((hi - v) / (hi - lo)) * (bottom - top);
    const inv = py => (log ? Math.exp(Math.log(hi) - ((py - top) / (bottom - top)) * (Math.log(hi) - Math.log(lo))) : hi - ((py - top) / (bottom - top)) * (hi - lo));
    const vMax = Math.max(...bars.map(b => b.v || 0), 1);
    const volY = v => H_PRICE - (v / vMax) * H_PRICE * 0.18;

    // date ticks: first bar of each month, thinned to ~70px apart
    const ticks = [];
    let lastX = -Infinity;
    const yearly = n > 0 && (Date.parse(bars[n - 1].d) - Date.parse(bars[0].d)) / 864e5 > 900;
    bars.forEach((b, i) => {
      const prev = bars[i - 1];
      const newPeriod = !prev || (yearly ? b.d.slice(0, 4) !== prev.d.slice(0, 4) : b.d.slice(0, 7) !== prev.d.slice(0, 7));
      if (!newPeriod || x(i) - lastX < 70 || x(i) < 16 || x(i) > PADL + plotW - 12) return;
      lastX = x(i);
      const m = +b.d.slice(5, 7) - 1;
      ticks.push({ i, label: yearly || m === 0 ? b.d.slice(0, 4) : MON[m] });
    });

    const candles = step >= 2;
    const bodyW = Math.max(1, Math.min(step * 0.68, 14));
    // level tags sit on the price axis, nudged apart so none overlap
    const tags = levels.map(lv => ({ ...lv, ly: y(lv.p) })).filter(t => t.ly >= top && t.ly <= bottom).sort((a, b) => a.ly - b.ly);
    tags.forEach((t, k) => { t.ty = k && t.ly - tags[k - 1].ty < 14 ? tags[k - 1].ty + 14 : t.ly; });
    return { lo, hi, y, inv, volY, ticks, candles, bodyW, top, bottom, tags, priceTicks: niceTicks(lo, hi, 6) };
  }, [bars, ind, maList, show, log, levels, n, H_PRICE, step, plotW]);

  if (!n || !geo) return <div ref={ref} style={{ height: 200 }} />;
  const { y, volY, candles, bodyW } = geo;
  const hi = hover?.i ?? n - 1, hb = bars[hi], prevC = hi > 0 ? bars[hi - 1].c : null;
  const chg = fin(prevC) ? (hb.c / prevC - 1) * 100 : null;

  // sub-pane scales
  const rsiY = v => rsiTop + 4 + ((100 - v) / 100) * (H_RSI - 8);
  const mv = [...(ind.macd.line || []), ...(ind.macd.signal || []), ...(ind.macd.hist || [])].filter(fin);
  const mAbs = Math.max(...mv.map(Math.abs), 1e-9);
  const macdY = v => macdTop + H_MACD / 2 - (v / mAbs) * (H_MACD / 2 - 6);

  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    const mx = pt.clientX - r.left, my = pt.clientY - r.top;
    const i = Math.max(0, Math.min(n - 1, Math.floor((mx - PADL) / step)));
    setHover({ i, y: my });
  };

  const legend = [
    ["O", fmtPx(hb.o)], ["H", fmtPx(hb.h)], ["L", fmtPx(hb.l)], ["C", fmtPx(hb.c)],
  ];
  const txt = { fontFamily: fonts.mono, fontSize: 9.5, fill: "var(--text-muted)" };

  return (
    <div ref={ref} style={{ width: "100%", position: "relative", userSelect: "none" }}>
      <svg width={w} height={totalH} style={{ display: "block", touchAction: "pan-y" }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={() => setHover(null)}>
        {/* price grid and axis */}
        {geo.priceTicks.map(t => { const py = y(t); if (py < geo.top - 2 || py > geo.bottom + 2) return null; return (
          <g key={`p${t}`}>
            <line x1={PADL} x2={PADL + plotW} y1={py} y2={py} stroke="var(--border-subtle)" strokeDasharray="2 4" />
            <text x={w - AXIS_W + 6} y={py + 3} style={txt}>{fmtPx(t)}</text>
          </g>); })}
        {geo.ticks.map(t => <line key={`g${t.i}`} x1={x(t.i)} x2={x(t.i)} y1={0} y2={totalH - H_X} stroke="var(--border-subtle)" strokeDasharray="2 4" opacity={0.6} />)}

        {/* volume */}
        {show.volume && bars.map((b, i) => (
          <rect key={`v${i}`} x={x(i) - Math.max(bodyW, 0.6) / 2} width={Math.max(bodyW, 0.6)} y={volY(b.v || 0)} height={H_PRICE - volY(b.v || 0)}
            fill={i && b.c < bars[i - 1].c ? DOWN : UP} opacity={0.28} />
        ))}

        {/* Bollinger bands */}
        {show.bb && (<>
          <path d={`${linePath(ind.bb.up, x, y)}`} fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
          <path d={`${linePath(ind.bb.lo, x, y)}`} fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
          <path d={`${linePath(ind.bb.mid, x, y)}`} fill="none" stroke="#94a3b8" strokeWidth={0.8} opacity={0.5} />
        </>)}

        {/* support / resistance: dashed lines across the plot */}
        {geo.tags.map((t, k) => <line key={`lv${k}`} x1={PADL} x2={PADL + plotW} y1={t.ly} y2={t.ly} stroke={t.color} strokeWidth={1} strokeDasharray={t.dash || "6 4"} opacity={0.7} />)}

        {/* price */}
        {candles ? bars.map((b, i) => {
          const up = b.c >= b.o, col = up ? UP : DOWN, yo = y(b.o), yc = y(b.c);
          return (
            <g key={`c${i}`}>
              <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - bodyW / 2} width={bodyW} y={Math.min(yo, yc)} height={Math.max(1, Math.abs(yc - yo))} fill={up ? "var(--card-bg, transparent)" : col} stroke={col} strokeWidth={1} />
            </g>);
        }) : <path d={linePath(bars.map(b => b.c), x, y)} fill="none" stroke="var(--text-primary)" strokeWidth={1.3} />}

        {/* moving averages */}
        {maList.map(p => show[`ma${p}`] && <path key={`ma${p}`} d={linePath(ind.ma[p] || [], x, y)} fill="none" stroke={MA_COLORS[p]} strokeWidth={1.4} />)}

        {/* signal markers: bullish below the low, bearish above the high */}
        {markers.map((m, k) => {
          const b = bars[m.i]; if (!b) return null;
          const up = m.tone > 0, cx = x(m.i), cy = up ? y(b.l) + 9 : y(b.h) - 9;
          return <path key={`mk${k}`} d={up ? `M${cx},${cy - 5}L${cx - 4},${cy + 2}L${cx + 4},${cy + 2}Z` : `M${cx},${cy + 5}L${cx - 4},${cy - 2}L${cx + 4},${cy - 2}Z`}
            fill={up ? UP : DOWN} opacity={0.9}><title>{`${m.d}: ${m.kind}`}</title></path>;
        })}

        {/* legend */}
        <text x={PADL + 4} y={11} style={{ ...txt, fontSize: 10 }}>
          <tspan fill="var(--text-secondary)">{hb.d}</tspan>
          {legend.map(([k, v]) => <tspan key={k} dx={8}><tspan fill="var(--text-muted)">{k} </tspan><tspan fill="var(--text-primary)">{v}</tspan></tspan>)}
          {fin(chg) && <tspan dx={8} fill={chg >= 0 ? UP : DOWN}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</tspan>}
          {show.volume && <tspan dx={8}><tspan fill="var(--text-muted)">Vol </tspan><tspan fill="var(--text-primary)">{fmtVol(hb.v)}</tspan></tspan>}
          {!phone && maList.map(p => show[`ma${p}`] && fin(ind.ma[p]?.[hi]) && <tspan key={`lg${p}`} dx={8} fill={MA_COLORS[p]}>MA{p} {fmtPx(ind.ma[p][hi])}</tspan>)}
        </text>

        {/* RSI */}
        {show.rsi && (<g>
          <rect x={PADL} y={rsiY(70)} width={plotW} height={rsiY(30) - rsiY(70)} fill="#8b5cf6" opacity={0.05} />
          {[70, 50, 30].map(v => <line key={`r${v}`} x1={PADL} x2={PADL + plotW} y1={rsiY(v)} y2={rsiY(v)} stroke={v === 50 ? "var(--border-subtle)" : "#8b5cf6"} strokeDasharray="3 3" opacity={v === 50 ? 1 : 0.5} />)}
          {[70, 30].map(v => <text key={`rt${v}`} x={w - AXIS_W + 6} y={rsiY(v) + 3} style={txt}>{v}</text>)}
          <path d={linePath(ind.rsi, x, rsiY)} fill="none" stroke="#8b5cf6" strokeWidth={1.3} />
          <text x={PADL + 4} y={rsiTop + 11} style={txt}>RSI 14 <tspan fill="#8b5cf6">{fin(ind.rsi[hi]) ? ind.rsi[hi].toFixed(1) : "—"}</tspan></text>
          <line x1={PADL} x2={PADL + plotW} y1={rsiTop - GAP / 2} y2={rsiTop - GAP / 2} stroke="var(--border-subtle)" />
        </g>)}

        {/* MACD */}
        {show.macd && (<g>
          <line x1={PADL} x2={PADL + plotW} y1={macdY(0)} y2={macdY(0)} stroke="var(--border-subtle)" />
          {ind.macd.hist.map((v, i) => fin(v) && <rect key={`h${i}`} x={x(i) - Math.max(bodyW, 0.6) / 2} width={Math.max(bodyW, 0.6)} y={Math.min(macdY(v), macdY(0))} height={Math.abs(macdY(v) - macdY(0))} fill={v >= 0 ? UP : DOWN} opacity={0.5} />)}
          <path d={linePath(ind.macd.line, x, macdY)} fill="none" stroke="#3b82f6" strokeWidth={1.3} />
          <path d={linePath(ind.macd.signal, x, macdY)} fill="none" stroke="#f59e0b" strokeWidth={1.1} />
          <text x={PADL + 4} y={macdTop + 11} style={txt}>MACD 12 26 9 <tspan fill="#3b82f6">{fin(ind.macd.line[hi]) ? ind.macd.line[hi].toFixed(2) : "—"}</tspan> <tspan fill="#f59e0b">{fin(ind.macd.signal[hi]) ? ind.macd.signal[hi].toFixed(2) : "—"}</tspan> <tspan fill={(ind.macd.hist[hi] ?? 0) >= 0 ? UP : DOWN}>{fin(ind.macd.hist[hi]) ? ind.macd.hist[hi].toFixed(2) : "—"}</tspan></text>
          <line x1={PADL} x2={PADL + plotW} y1={macdTop - GAP / 2} y2={macdTop - GAP / 2} stroke="var(--border-subtle)" />
        </g>)}

        {/* level tags on the price axis */}
        {geo.tags.map((t, k) => (
          <g key={`tag${k}`}>
            {Math.abs(t.ty - t.ly) > 1 && <line x1={w - AXIS_W} x2={w - AXIS_W + 3} y1={t.ly} y2={t.ty} stroke={t.color} />}
            <rect x={w - AXIS_W + 2} y={t.ty - 7} width={AXIS_W - 3} height={14} rx={3} fill={t.color} />
            <text x={w - AXIS_W + 5} y={t.ty + 3} style={{ ...txt, fill: "#fff", fontSize: 8.5, fontWeight: 700 }}>{t.label} {fmtPx(t.p)}</text>
          </g>
        ))}

        {/* date axis */}
        {geo.ticks.map(t => <text key={`t${t.i}`} x={x(t.i)} y={totalH - 5} textAnchor="middle" style={txt}>{t.label}</text>)}

        {/* crosshair */}
        {hover && (<g pointerEvents="none">
          <line x1={x(hover.i)} x2={x(hover.i)} y1={0} y2={totalH - H_X} stroke="var(--text-muted)" strokeDasharray="3 3" />
          {hover.y > geo.top && hover.y < geo.bottom && (<>
            <line x1={PADL} x2={PADL + plotW} y1={hover.y} y2={hover.y} stroke="var(--text-muted)" strokeDasharray="3 3" />
            <rect x={w - AXIS_W + 1} y={hover.y - 8} width={AXIS_W - 2} height={16} rx={3} fill="var(--text-primary)" />
            <text x={w - AXIS_W + 6} y={hover.y + 3} style={{ ...txt, fill: "var(--page-bg, #0b1020)", fontWeight: 700 }}>{fmtPx(geo.inv(hover.y))}</text>
          </>)}
        </g>)}
      </svg>
    </div>
  );
}
