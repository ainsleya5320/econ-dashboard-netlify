import React, { useMemo, useState } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { formatDateLabel, toneColor } from "../lib/dataHealth.js";

function StatusDot({ tone }) {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: toneColor[tone] || toneColor.unknown,
        boxShadow: `0 0 8px ${(toneColor[tone] || toneColor.unknown)}66`,
        flexShrink: 0,
      }}
    />
  );
}

function statusText(source) {
  if (source.error) return "Error";
  if (source.loading) return "Loading";
  if (!source.live) return "Sample";
  if (source.freshness.ageDays == null) return "No date";
  if (source.freshness.tone === "stale") return `${source.freshness.ageDays}d old`;
  return "Fresh";
}

export default function DataHealthPanel({ sources = [] }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => {
    const errors = sources.filter(s => s.tone === "error").length;
    const stale = sources.filter(s => s.tone === "stale").length;
    const loading = sources.filter(s => s.tone === "loading").length;
    if (errors) return { tone: "error", text: `${errors} source${errors === 1 ? "" : "s"} need attention` };
    if (loading) return { tone: "loading", text: `${loading} source${loading === 1 ? "" : "s"} loading` };
    if (stale) return { tone: "stale", text: `${stale} source${stale === 1 ? "" : "s"} may be stale` };
    return { tone: "fresh", text: "Sources healthy" };
  }, [sources]);

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, marginBottom: 16, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "var(--text-primary)",
          fontFamily: fonts.mono,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        <StatusDot tone={summary.tone} />
        <span>Data Health</span>
        <span style={{ color: toneColor[summary.tone], marginLeft: "auto" }}>{summary.text}</span>
        <span style={{ color: "var(--text-muted)" }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "10px 14px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10 }}>
          {sources.map(source => (
            <div key={source.label} style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
              <StatusDot tone={source.tone} />
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--text-primary)", fontSize: 11, fontWeight: 700 }}>{source.label}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: fonts.mono }}>
                  {statusText(source)} | {formatDateLabel(source.date)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
