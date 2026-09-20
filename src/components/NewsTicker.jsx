import React, { useState } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";

export default function NewsTicker({ items, loading }) {
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const fmtAge = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const diffMs = Date.now() - d.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return `${Math.floor(diffMs / 60000)}m ago`;
    if (diffH < 24) return `${diffH}h ago`;
    const days = Math.floor(diffH / 24);
    return days === 1 ? "1d ago" : `${days}d ago`;
  };

  if (loading) {
    return (
      <div style={{ height: 38, background: "rgba(15,23,42,0.8)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, marginBottom: 16, display: "flex", alignItems: "center", paddingLeft: 14 }}>
        <span style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, letterSpacing: 1 }}>LOADING NEWS...</span>
      </div>
    );
  }

  if (!items?.length) return null;

  const doubled = [...items, ...items];
  const duration = Math.max(80, items.length * 6);

  return (
    <>
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-hl:hover { color: #93c5fd !important; }
        .news-badge:hover { filter: brightness(1.2); }
        .news-card:hover { border-color: rgba(59,130,246,0.3) !important; background: rgba(30,41,59,0.8) !important; }
      `}</style>

      {/* Ticker bar */}
      <div style={{ display: "flex", alignItems: "center", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, marginBottom: (selected || showAll) ? 8 : 16, overflow: "hidden", height: 38, position: "relative" }}>

        {/* NEWS badge — clickable */}
        <div
          className="news-badge"
          onClick={() => { setShowAll(v => !v); setSelected(null); }}
          style={{ flexShrink: 0, padding: "0 14px", height: "100%", display: "flex", alignItems: "center", gap: 6, background: showAll ? "linear-gradient(135deg, #4f46e5, #7c3aed)" : "linear-gradient(135deg, #2563eb, #4f46e5)", fontSize: 9, fontWeight: 700, color: "#fff", letterSpacing: 2, fontFamily: fonts.mono, zIndex: 2, cursor: "pointer", transition: "all 0.2s" }}
        >
          NEWS {showAll ? "▲" : "▼"}
        </div>

        {/* Left fade */}
        <div style={{ position: "absolute", left: 72, width: 32, height: "100%", background: "linear-gradient(to right, rgba(12,15,26,0.9), transparent)", zIndex: 1, pointerEvents: "none" }} />

        {/* Scrolling strip */}
        <div
          // minWidth:0 matters: a flex item defaults to min-width:auto, so this
          // refuses to shrink below the marquee's content width (~38,000px) and
          // drags the whole page sideways on a phone. overflow:hidden alone does
          // not stop it, because the item is already wider than its parent.
          style={{ overflow: "hidden", flex: 1, minWidth: 0, height: "100%", cursor: "default" }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div style={{
            display: "inline-flex", alignItems: "center", height: "100%", whiteSpace: "nowrap",
            animation: `ticker-scroll ${duration}s linear infinite`,
            animationPlayState: paused ? "paused" : "running",
          }}>
            {doubled.map((item, i) => (
              <span
                key={i}
                className="ticker-hl"
                onClick={() => { setSelected(prev => prev?.url === item.url ? null : item); setShowAll(false); }}
                style={{
                  padding: "0 24px", fontSize: 11, flexShrink: 0,
                  color: selected?.url === item.url ? "#93c5fd" : "#cbd5e1",
                  fontFamily: fonts.heading, borderRight: "1px solid rgba(255,255,255,0.05)",
                  cursor: "pointer", transition: "color 0.15s", userSelect: "none",
                }}
              >
                {item.site && (
                  <span style={{ color: "#818cf8", marginRight: 8, fontSize: 9, fontFamily: fonts.mono, fontWeight: 700, letterSpacing: 0.3 }}>
                    {item.site}{item.paywalled ? " 🔒" : ""}
                  </span>
                )}
                {item.tickers && (
                  <span style={{ color: "#3b82f6", marginRight: 8, fontSize: 9, fontFamily: fonts.mono, fontWeight: 600 }}>
                    {item.tickers.split(",")[0].replace("NASDAQ:", "").replace("NYSE:", "")}
                  </span>
                )}
                {item.title}
              </span>
            ))}
          </div>
        </div>

        {/* Right fade */}
        <div style={{ position: "absolute", right: 0, width: 40, height: "100%", background: "linear-gradient(to left, rgba(12,15,26,0.9), transparent)", zIndex: 1, pointerEvents: "none" }} />
      </div>

      {/* Single article expand panel */}
      {selected && !showAll && (
        <div style={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "16px 20px", marginBottom: 16, position: "relative" }}>
          <button onClick={() => setSelected(null)} style={{ position: "absolute", top: 10, right: 14, background: "none", border: "none", color: "#475569", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 0 }} aria-label="Close">×</button>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {selected.image && (
              <img src={selected.image} alt="" onError={e => { e.target.style.display = "none"; }} style={{ width: 130, height: 80, objectFit: "cover", borderRadius: 8, flexShrink: 0, border: "1px solid rgba(255,255,255,0.07)" }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                <span style={{ color: "#818cf8", fontWeight: 700 }}>{selected.site}{selected.paywalled ? " 🔒" : ""}</span>
                {selected.publishedDate ? ` · ${fmtAge(selected.publishedDate)}` : ""}
                {selected.tickers ? ` · ${selected.tickers}` : ""}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", fontFamily: fonts.heading, marginBottom: 8, lineHeight: 1.45 }}>
                {selected.title}
              </div>
              {selected.text && (
                <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.65, marginBottom: 12 }}>
                  {selected.text.length > 350 ? selected.text.slice(0, 350) + "…" : selected.text}
                </div>
              )}
              <a href={selected.url} target="_blank" rel="noreferrer noopener" style={{ fontSize: 11, color: "#3b82f6", fontFamily: fonts.mono, textDecoration: "none" }}>
                Read full story at {selected.site} →
              </a>
              {selected.paywalled && (
                <span style={{ fontSize: 9, color: "#64748b", fontFamily: fonts.mono, marginLeft: 10 }}>🔒 may require a subscription</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full news page */}
      {showAll && (
        <div style={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "20px 24px", marginBottom: 16, maxHeight: "70vh", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", fontFamily: fonts.heading }}>
              Market News
              <span style={{ fontSize: 10, color: "#475569", fontFamily: fonts.mono, marginLeft: 10 }}>{items.length} articles</span>
            </div>
            <button onClick={() => setShowAll(false)} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "5px 12px", fontSize: 10, color: "#94a3b8", cursor: "pointer", fontFamily: fonts.mono }}>Close</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: 12 }}>
            {items.map((item, i) => (
              <a
                key={i}
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="news-card"
                style={{
                  display: "block", textDecoration: "none",
                  background: cardBg, border: cardBorder, borderRadius: 12,
                  padding: 14, transition: "all 0.15s", cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {item.image && (
                    <img src={item.image} alt="" onError={e => { e.target.style.display = "none"; }} style={{ width: 80, height: 56, objectFit: "cover", borderRadius: 6, flexShrink: 0, border: "1px solid rgba(255,255,255,0.05)" }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9, color: "#475569", fontFamily: fonts.mono, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {item.site && <span style={{ color: "#818cf8", fontWeight: 700 }}>{item.site}{item.paywalled ? " 🔒" : ""}</span>}
                      {item.site ? " · " : ""}{fmtAge(item.publishedDate)}
                      {item.tickers ? ` · ${item.tickers.split(",").slice(0,3).map(t => t.replace("NASDAQ:","").replace("NYSE:","")).join(", ")}` : ""}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", fontFamily: fonts.heading, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {item.title}
                    </div>
                    {item.text && (
                      <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5, marginTop: 5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {item.text.slice(0, 200)}
                      </div>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
