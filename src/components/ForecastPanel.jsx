import React from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "./shared.jsx";
import { FORECASTS, FORECASTS_ASOF } from "../lib/forecasts.js";

// FutureSearch forecast panel — renders dated percentile bands (p10-p90) with
// the app's own live tracked value overlaid where available, so each forecast
// is scoreable against the dashboard's data when it resolves.
// `live` = optional { [forecastId]: { value, label } } from the host tab.
const INDIGO = "#818cf8", GREEN = "#4ade80", AMBER = "#fbbf24";

function Band({ f, live }) {
  // scale across p10..p90 padded 12% each side, live value included in range
  const lo0 = Math.min(f.p10, live?.value ?? f.p10);
  const hi0 = Math.max(f.p90, live?.value ?? f.p90);
  const pad = (hi0 - lo0) * 0.12 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const x = v => `${((v - lo) / (hi - lo)) * 100}%`;
  const w = (a, b) => `${((b - a) / (hi - lo)) * 100}%`;
  return (
    <div style={{ position: "relative", height: 34 }}>
      {/* p10-p90 outer band */}
      <div style={{ position: "absolute", top: 13, left: x(f.p10), width: w(f.p10, f.p90), height: 8, background: "rgba(129,140,248,0.18)", borderRadius: 4 }} />
      {/* p25-p75 inner band */}
      <div style={{ position: "absolute", top: 13, left: x(f.p25), width: w(f.p25, f.p75), height: 8, background: "rgba(129,140,248,0.42)", borderRadius: 4 }} />
      {/* median marker */}
      <div style={{ position: "absolute", top: 8, left: `calc(${x(f.p50)} - 1.5px)`, width: 3, height: 18, background: INDIGO, borderRadius: 2 }} />
      <div style={{ position: "absolute", top: -3, left: x(f.p50), transform: "translateX(-50%)", fontSize: 10, fontFamily: fonts.mono, color: INDIGO, fontWeight: 700 }}>{f.fmt(f.p50)}</div>
      {/* live value marker */}
      {live?.value != null && (<>
        <div title={live.label} style={{ position: "absolute", top: 9, left: `calc(${x(live.value)} - 5px)`, width: 10, height: 10, transform: "rotate(45deg)", background: GREEN, border: "2px solid #0f172a", zIndex: 1 }} />
        <div style={{ position: "absolute", top: 24, left: x(live.value), transform: "translateX(-50%)", fontSize: 9, fontFamily: fonts.mono, color: GREEN, whiteSpace: "nowrap" }}>{f.fmt(live.value)} now</div>
      </>)}
      {/* endpoints */}
      <div style={{ position: "absolute", top: 24, left: x(f.p10), transform: "translateX(-50%)", fontSize: 9, fontFamily: fonts.mono, color: "#475569" }}>{f.fmt(f.p10)}</div>
      <div style={{ position: "absolute", top: 24, left: x(f.p90), transform: "translateX(-50%)", fontSize: 9, fontFamily: fonts.mono, color: "#475569" }}>{f.fmt(f.p90)}</div>
    </div>
  );
}

export default function ForecastPanel({ tag, live = {} }) {
  const items = FORECASTS.filter(f => !tag || f.tags.includes(tag));
  if (!items.length) return null;
  return (<>
    <SH>Forward View — FutureSearch Forecasts</SH>
    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, marginBottom: 12, lineHeight: 1.5, maxWidth: 840 }}>
      Deep-research forecasts with percentile bands, run {FORECASTS_ASOF} via FutureSearch (public track record on Metaculus/markets). Every question resolves against a number this dashboard tracks or a public print — so each one is scoreable, unlike street targets. <span style={{ color: "#4ade80" }}>◆</span> = today&apos;s live value.
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 12, marginBottom: 14 }}>
      {items.map(f => (
        <div key={f.id} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading }}>{f.title}</div>
            <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, flexShrink: 0 }}>resolves {f.resolveBy}</div>
          </div>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, marginTop: 2, marginBottom: f.type === "binary" ? 8 : 14 }}>{f.question}</div>
          {f.type === "binary" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 30, fontWeight: 700, fontFamily: fonts.heading, color: f.probability >= 50 ? AMBER : INDIGO }}>{f.probability}%</div>
              <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${f.probability}%`, height: "100%", background: f.probability >= 50 ? AMBER : INDIGO, borderRadius: 4 }} />
              </div>
            </div>
          ) : (
            <Band f={f} live={live[f.id]} />
          )}
          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.5, marginTop: 10 }}>{f.takeaway}</div>
        </div>
      ))}
    </div>
    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>How to read these.</strong> The bright bar is the p25–p75 band (50/50 the print lands inside it), the faint bar p10–p90, the tick the median. When today&apos;s live value (green diamond) sits below the median, the forecaster expects the series to RISE into resolution — the gap is the signal. These are dated snapshots, not live: re-run the battery to refresh, and score the old ones as they resolve. A forecast that keeps landing inside its band earns trust; one that doesn&apos;t, doesn&apos;t.
    </InfoBox>
  </>);
}
