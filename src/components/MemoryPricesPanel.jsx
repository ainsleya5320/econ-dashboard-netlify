import React, { useState, useEffect, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { SH, InfoBox } from "./shared.jsx";

// ============================================================================
// MEMORY SPOT PRICES — TrendForce (DRAM chips / modules / GDDR / NAND)
// ----------------------------------------------------------------------------
// Memory is where the AI compute repricing shows up loudest upstream: HBM
// eats DRAM wafer supply, so conventional DRAM tightens and spot rips. The
// server scrapes trendforce.com/price daily (free, server-rendered) into an
// append-only archive (memory-prices.json) — TrendForce's own history is
// member-gated, so OUR history starts the day the scraper first ran and
// grows from there. Keep the dev server running to accumulate days.
//
// SPOT vs CONTRACT: this page is SPOT (the marginal traded price — leads the
// cycle, overshoots both ways). What Samsung/SK hynix/Micron actually bill is
// quarterly CONTRACT, which TrendForce announces via press releases. Those
// don't parse cleanly, so they're hand-curated below in CONTRACT_ANCHORS —
// add an entry whenever a TrendForce press release prints a settled number.
// HBM prices aren't on the free page at all; the HBM story is curated in the
// Supply Ceiling panel (CoWoS + HBM capacity).
// ============================================================================

// Quarterly contract-price anchors, hand-curated from TrendForce press
// releases (trendforce.com/news, also picked up by Reuters/Tom's Hardware).
// Format: { period: "2026-Q3", product: "PC DRAM (DDR5)", chgPct: +8,
//           note: "8-13% QoQ guided", source: "TrendForce PR 2026-07-xx",
//           confidence: "reported" }
// Empty until you log the first release — never backfill from memory.
const CONTRACT_ANCHORS = [];

// Headline items (matched by prefix against TrendForce's item names — if
// TrendForce renames a part, update the prefix here).
const HEADLINES = [
  { prefix: "DDR5 16Gb (2Gx8) 4800", label: "DDR5 16Gb chip", color: "#E8553A", note: "mainstream server/PC die" },
  { prefix: "DDR4 16Gb (2Gx8) 3200", label: "DDR4 16Gb chip", color: "#F59E0B", note: "legacy die — supply squeezed" },
  { prefix: "DDR5 RDIMM 32GB", label: "DDR5 RDIMM 32GB", color: "#10B981", note: "the server module" },
  { prefix: "GDDR6 8Gb", label: "GDDR6 8Gb", color: "#8B5CF6", note: "graphics DRAM" },
];
const GROUP_LABELS = { chip: "DRAM Chips (spot)", module: "Modules (spot)", gddr: "Graphics DRAM", nand: "NAND Flash", mobile: "Mobile DRAM" };
const GROUP_ORDER = ["chip", "module", "gddr", "nand", "mobile"];

const chgColor = c => (c == null ? "#475569" : c > 0 ? "#f87171" : c < 0 ? "#4ade80" : "#64748b");
// note the inversion vs equities: rising memory = input-cost inflation = red

function ChgBadge({ chg }) {
  const txt = chg == null ? "—" : `${chg > 0 ? "+" : ""}${chg.toFixed(2)}%`;
  return <span style={{ color: chgColor(chg), fontFamily: fonts.mono, fontSize: 11, fontWeight: 700 }}>{txt}</span>;
}

export default function MemoryPricesPanel() {
  const [mem, setMem] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/memory").then(r => r.json()).then(d => { if (!d.error) setMem(d); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const model = useMemo(() => {
    if (!mem?.available) return null;
    const latest = mem.latest || [];
    const find = p => latest.find(i => i.n.startsWith(p)) || null;
    const heads = HEADLINES.map(h => ({ ...h, item: find(h.prefix) })).filter(h => h.item);
    // repricing breadth: how much of the complex moved this session, and which way
    const withChg = latest.filter(i => i.chg != null);
    const up = withChg.filter(i => i.chg > 0).length;
    const down = withChg.filter(i => i.chg < 0).length;
    // indexed history for headline items across archive days (index=100 at first day)
    const days = mem.days || [];
    const hist = days.map(d => {
      const row = { d: d.date };
      for (const h of HEADLINES) {
        const it = (d.items || []).find(i => i.n.startsWith(h.prefix));
        if (it) row[h.label] = it.avg;
      }
      return row;
    });
    const base = hist[0] || {};
    const histIdx = hist.map(r => {
      const o = { d: r.d };
      for (const h of HEADLINES) if (r[h.label] != null && base[h.label]) o[h.label] = +((r[h.label] / base[h.label]) * 100).toFixed(1);
      return o;
    });
    const groups = {};
    for (const i of latest) (groups[i.g] = groups[i.g] || []).push(i);
    return { heads, up, down, total: withChg.length, histIdx, groups, archiveDays: days.length };
  }, [mem]);

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 11 }}>Loading memory spot prices…</div>;
  if (!model) return (
    <InfoBox color="#F97316">
      <strong style={{ color: "#cbd5e1" }}>Memory prices unavailable.</strong> TrendForce fetch failed and no archive
      exists yet — the scraper seeds itself on the first successful fetch. Try a reload, or check the dev-server log.
    </InfoBox>
  );

  const stale = mem.daysStale != null && mem.daysStale > 3;

  return (<>
    <SH>Memory Spot — TrendForce DRAM / Modules / GDDR</SH>
    {stale && (
      <div style={{ fontSize: 10, color: "#fbbf24", fontFamily: fonts.mono, marginBottom: 8 }}>
        ⚠ Last successful scrape {mem.asOf} ({mem.daysStale}d ago) — serving archive. 1–3 days is normal (Taiwan weekends/holidays).
      </div>
    )}

    {/* headline KPI cards + breadth */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(160px, 100%),1fr))", gap: 10, marginBottom: 12 }}>
      {model.heads.map(h => (
        <div key={h.label} style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" }}>
          <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>{h.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.heading, color: h.color, margin: "3px 0 1px" }}>
            ${h.item.avg >= 100 ? h.item.avg.toFixed(0) : h.item.avg.toFixed(2)}
          </div>
          <div style={{ fontSize: 9.5, fontFamily: fonts.mono, color: "#64748b" }}>
            <ChgBadge chg={h.item.chg} /> session · {h.note}
          </div>
        </div>
      ))}
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" }}>
        <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.4, textTransform: "uppercase" }}>Repricing Breadth</div>
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.heading, color: model.up > model.down ? "#f87171" : "#4ade80", margin: "3px 0 1px" }}>
          {model.up}▲ / {model.down}▼
        </div>
        <div style={{ fontSize: 9.5, fontFamily: fonts.mono, color: "#64748b" }}>of {model.total} parts moved this session</div>
      </div>
    </div>

    {/* indexed history (accrues daily from our own archive) */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, paddingTop: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", paddingLeft: 14, marginBottom: 6 }}>
        Headline Parts — Indexed to 100 at Archive Start ({model.archiveDays} day{model.archiveDays === 1 ? "" : "s"} archived)
      </div>
      {model.archiveDays > 1 ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={model.histIdx} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#64748b", fontFamily: fonts.mono }} width={40} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={7} />
            {HEADLINES.map(h => (
              <Line key={h.label} type="monotone" dataKey={h.label} stroke={h.color} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ padding: "8px 14px 4px", fontSize: 11, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.5 }}>
          Archive started {mem.asOf} — TrendForce&apos;s own history is member-gated, so this chart builds from our first
          scrape forward, one point per day the dev server runs. Come back tomorrow for the first line segment.
        </div>
      )}
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: fonts.mono, padding: "6px 14px 10px", lineHeight: 1.5 }}>
        Session averages, spot market. Spot leads contract by roughly a quarter and overshoots both ways — read direction
        and breadth, not the level.
      </div>
    </div>

    {/* full table, grouped */}
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
        All Tracked Parts — Session Average &amp; Change · {mem.asOf} · {mem.source}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(280px, 100%),1fr))", gap: "4px 24px" }}>
        {GROUP_ORDER.filter(g => model.groups[g]).map(g => (
          <div key={g}>
            <div style={{ fontSize: 9.5, color: "#94a3b8", fontFamily: fonts.mono, fontWeight: 700, margin: "6px 0 4px" }}>{GROUP_LABELS[g]}</div>
            {model.groups[g].map(i => (
              <div key={i.n} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 10.5, color: "#cbd5e1", fontFamily: fonts.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.n}</span>
                <span style={{ fontSize: 10.5, color: "#f1f5f9", fontFamily: fonts.mono, fontWeight: 600, flexShrink: 0 }}>
                  ${i.avg >= 100 ? i.avg.toFixed(0) : i.avg.toFixed(2)} <ChgBadge chg={i.chg} />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>

    {/* contract anchors — curated scaffold */}
    {CONTRACT_ANCHORS.length === 0 ? (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>Contract-Price Anchors — awaiting curation</div>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: fonts.mono, lineHeight: 1.6 }}>
          Spot (above) is the leading signal; quarterly CONTRACT is what memory makers actually bill. When TrendForce
          announces settled contract prices (their press releases, usually early in each quarter, echoed by Reuters),
          add an entry to CONTRACT_ANCHORS in MemoryPricesPanel.jsx — period, product, QoQ %, source, date. The panel
          renders them here automatically.
        </div>
      </div>
    ) : (
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>Contract-Price Anchors (curated from TrendForce releases)</div>
        {CONTRACT_ANCHORS.map((a, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 10.5, fontFamily: fonts.mono }}>
            <span style={{ color: "#cbd5e1" }}>{a.period} · {a.product}</span>
            <span style={{ color: chgColor(a.chgPct), fontWeight: 700 }}>{a.chgPct > 0 ? "+" : ""}{a.chgPct}% QoQ</span>
            <span style={{ color: "#64748b", flexShrink: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.source}</span>
          </div>
        ))}
      </div>
    )}

    <InfoBox color="#F59E0B">
      <strong style={{ color: "#cbd5e1" }}>Why memory is the upstream tell.</strong> HBM for AI accelerators eats the
      same wafers as conventional DRAM, so an AI compute shortage shows up here first: fabs shift output to HBM,
      commodity DRAM tightens, spot rips, then contract follows a quarter later. Rising memory prices with broad
      breadth = the buildout is still outbidding everyone for wafers (bullish Samsung/SK hynix/Micron, cost headwind
      for everyone buying servers). A rollover here — breadth flipping down while GPU rental also softens — would be
      one of the earliest physical signals that the compute shortage is easing.
    </InfoBox>
  </>);
}
