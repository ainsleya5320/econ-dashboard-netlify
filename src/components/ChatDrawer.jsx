import React, { useState, useRef, useEffect, useCallback } from "react";
import { STATIC_BUILD } from "../lib/deploy.js";
import { fonts } from "../lib/styles.js";
import { getVerdictContext } from "../lib/assistantContext.js";

/* ── Data-context builders ─────────────────────────────────── */
function fmtV(v) { return v == null ? "N/A" : typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v); }

function buildContext(tab, p, live) {
  const lines = [`You are an AI assistant embedded in a personal Economic Dashboard. The user is currently viewing the "${tab}" tab. Answer concisely using the data provided. Use bullet points for lists. Bold key numbers with **value**. The dashboard computes its own verdicts (market regime, valuation lenses, the AI compute chain, profits, credit, housing) — they appear at the end of this context and are the app's current read; use them when the question touches those topics and say when a verdict is a model output rather than a fact.`, ""];

  // ═══ ECONOMY ═══
  if (tab === "economy") {
    lines.push("=== Mortgage Rates ===");
    if (p.md) {
      for (const [id, meta] of [["MORTGAGE30US","30Y Fixed"],["MORTGAGE15US","15Y Fixed"],["MORTGAGE5US","5/1 ARM"]]) {
        const d = p.md[id]; if (d) lines.push(`${meta}: ${fmtV(d.current)}% (${d.lastDate || ""})`);
      }
    }
    lines.push("=== Treasury Yields ===");
    if (p.td) {
      for (const [id, lbl] of [["DGS2","2Y"],["DGS5","5Y"],["DGS10","10Y"],["DGS30","30Y"]]) {
        const d = p.td[id]; if (d) lines.push(`${lbl}: ${fmtV(d.current)}% (${d.lastDate || ""})`);
      }
      // Compute spread if available
      const y2 = p.td.DGS2?.current, y10 = p.td.DGS10?.current;
      if (y2 != null && y10 != null) lines.push(`10Y-2Y Spread: ${(y10 - y2).toFixed(2)}%`);
    }
    lines.push("=== Inflation ===");
    if (p.cd) {
      for (const [id, lbl] of [["CPIAUCSL","CPI All Items"],["CPILFESL","Core CPI (ex Food & Energy)"],["PCEPI","PCE All Items"],["PCEPILFE","Core PCE"]]) {
        const d = p.cd[id]; if (d) lines.push(`${lbl}: ${fmtV(d.yoy ?? d.current)}% YoY (${d.lastDate || ""})`);
      }
      const be = p.cd.T10YIE; if (be) lines.push(`10Y Breakeven Inflation: ${fmtV(be.current)}%`);
      const sp = p.cd.T10Y2Y; if (sp) lines.push(`10Y-2Y Spread: ${fmtV(sp.current)}%`);
    }
    lines.push("=== Housing ===");
    if (p.hd) {
      for (const [id, lbl] of [["MSPUS","Median Home Price ($)"],["CSUSHPINSA","Case-Shiller Index"],["HOUST","Housing Starts (K annualized)"],["EXHOSLUSM495S","Existing Home Sales (M annualized)"],["PERMIT","Building Permits (K)"],["MSACSR","Months Supply"]]) {
        const d = p.hd[id]; if (d) lines.push(`${lbl}: ${fmtV(d.current)} (${d.lastDate || ""})`);
      }
    }
    if (p.zillowData) {
      const z = p.zillowData;
      if (z.national?.zhvi) lines.push(`Zillow Home Value Index (national): $${fmtV(z.national.zhvi.current)}`);
      if (z.national?.inventory) lines.push(`Zillow Active Inventory (national): ${fmtV(z.national.inventory.current)}`);
    }
    lines.push("=== Consumer Health ===");
    if (p.csm) {
      for (const [id, lbl] of [
        ["PSAVERT","Personal Savings Rate (%)"],["DRCCLACBS","Consumer Loan Delinquency (%)"],
        ["DRSFRMACBS","Mortgage Delinquency (%)"],["DRCRELEXFACBS","Credit Card Delinquency (%)"],
        ["TOTALSL","Total Consumer Credit ($B)"],["REVOLSL","Revolving Credit ($B)"],
        ["TNWBSHNO","Household Net Worth ($B)"],["HDTGPDUSQ163N","Household Debt/GDP (%)"],
        ["MEHOINUSA672N","Median Household Income ($)"],
      ]) {
        const d = p.csm[id]; if (d) lines.push(`${lbl}: ${fmtV(d.current)} (${d.lastDate || ""})`);
      }
    }

  // ═══ COMMODITIES ═══
  } else if (tab === "commodities") {
    lines.push("=== Precious Metal Spot Prices ===");
    if (live.commodities?.length) {
      for (const c of live.commodities) {
        lines.push(`${c.name}: $${fmtV(c.price)} ${c.unit} | Change: ${c.changePct != null ? (c.changePct >= 0 ? "+" : "") + (c.changePct * 100).toFixed(2) + "%" : "N/A"}`);
      }
    } else {
      lines.push("(Spot prices loading...)");
    }
    lines.push("");
    lines.push("This tab also shows FRED energy data (WTI crude, natural gas, gasoline), industrial metals, agriculture prices, and CFTC Commitment of Traders positioning for 12 major futures contracts (WTI, NatGas, Gold, Silver, Copper, Corn, Wheat, Soybeans, S&P 500, USD Index, 10Y T-Note, Euro FX).");
    lines.push("CFTC data shows net speculative positioning as % of open interest — useful for gauging market sentiment extremes.");

  // ═══ STOCKS ═══
  } else if (tab === "stocks") {
    lines.push("=== Major Index ETF Fundamentals ===");
    if (live.indexPE?.length) {
      for (const idx of live.indexPE) {
        lines.push(`${idx.flag} ${idx.name} (${idx.symbol}): Price $${fmtV(idx.price)} | PE ${fmtV(idx.pe)} | Earnings Yield ${idx.earningsYield != null ? fmtV(idx.earningsYield) + "%" : "N/A"} | Day Change ${idx.changePct != null ? (idx.changePct >= 0 ? "+" : "") + (idx.changePct * 100).toFixed(2) + "%" : "N/A"}`);
      }
    } else {
      lines.push("(Index data loading...)");
    }
    lines.push("");
    lines.push("This tab also features: a covered-call screening tool (CSP Screener) for finding high-premium options plays, detailed options chain data via CBOE, and a profit-margin Sankey diagram for individual stocks.");

  // ═══ INTERNATIONAL ═══
  } else if (tab === "intl") {
    lines.push("=== Global Central Bank Policy Rates ===");
    if (p.gd) {
      for (const [id, lbl] of [
        ["DFF","US Federal Funds"],["ECBDFR","ECB Deposit Rate"],["IUDSOIA","UK SONIA"],
        ["IRSTCB01JPM156N","Japan (BoJ)"],["IRSTCB01CAM156N","Canada (BoC)"],
        ["IRSTCB01CHM156N","Switzerland (SNB)"],["IRSTCB01AUM156N","Australia (RBA)"],
        ["IRSTCB01KRM156N","South Korea (BoK)"],["IRSTCB01MXM156N","Mexico (Banxico)"],
        ["IRSTCB01BRM156N","Brazil (BCB)"],
      ]) {
        const d = p.gd[id]; if (d) lines.push(`${lbl}: ${fmtV(d.current)}% (${d.lastDate || ""})`);
      }
    }
    lines.push("");
    lines.push("This tab also shows World Bank development indicators (GDP growth, PPP GDP, population, life expectancy) and the Trade-Weighted US Dollar Index.");

  // ═══ AI ECONOMY ═══
  } else if (tab === "ai") {
    lines.push("=== AI Token Pricing (OpenRouter, per 1M tokens) ===");
    if (live.aiPrices?.live?.tokens?.models?.length) {
      for (const m of live.aiPrices.live.tokens.models) {
        lines.push(`${m.name}: Input $${fmtV(m.input)} / Output $${fmtV(m.output)} (ctx: ${(m.context/1000).toFixed(0)}K)`);
      }
      const stats = live.aiPrices.live.tokens;
      lines.push(`Market: ${stats.totalModels} total models, ${stats.paidModels} paid. Median input: $${fmtV(stats.medianInput)}/1M tokens`);
    } else if (p.aiModels?.length) {
      lines.push(`${p.aiModels.length} AI models tracked via OpenRouter.`);
    }
    lines.push("");
    if (live.aiPrices?.live?.gpus) {
      lines.push("=== GPU Rental Pricing (Vast.ai, $/hr on-demand) ===");
      for (const [name, g] of Object.entries(live.aiPrices.live.gpus)) {
        lines.push(`${name} (${g.vram || "?"}GB): Min $${fmtV(g.min)} | Median $${fmtV(g.median)} | Max $${fmtV(g.max)} (${g.count} offers)`);
      }
    }
    lines.push("");
    lines.push("Historical pricing snapshots are stored daily. This tab also shows OpenRouter model rankings over time.");

  // ═══ HISTORICAL ═══
  } else if (tab === "history") {
    lines.push("The Historical Returns tab shows long-run asset class returns (S&P 500, bonds, gold, real estate, Bitcoin, etc.) across 1Y, 5Y, 10Y, 20Y, and 30Y+ time horizons. It includes inflation-adjusted (real) returns and annualized CAGR figures.");
  }

  lines.push("", "When referencing data above, cite the numbers. If asked about data not shown, say so honestly. Keep answers concise (3-5 sentences unless the user asks for more detail).");
  return lines.join("\n");
}

/* ── Simple markdown-lite renderer ─────────────────────────── */
function renderMsg(text) {
  return text.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((seg, j) => {
      if (seg.startsWith("**") && seg.endsWith("**")) return <strong key={j}>{seg.slice(2, -2)}</strong>;
      if (seg.startsWith("`") && seg.endsWith("`")) return <code key={j} style={{ background: "var(--bg-subtle)", padding: "1px 4px", borderRadius: 3, fontFamily: fonts.mono, fontSize: "0.9em" }}>{seg.slice(1, -1)}</code>;
      return seg;
    });
    return <React.Fragment key={i}>{parts}{i < text.split("\n").length - 1 && <br />}</React.Fragment>;
  });
}

/* ── Icons ─────────────────────────────────────────────────── */
const ChatIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
const ClearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

/* ── ChatDrawer ────────────────────────────────────────────── */
export default function ChatDrawer({ tab, md, td, gd, cd, csm, hd, aiModels, zillowData }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  // Live data from server endpoints (cached in component)
  const [liveData, setLiveData] = useState({ commodities: null, indexPE: null, aiPrices: null });
  const liveDataRef = useRef(liveData);
  liveDataRef.current = liveData;

  // Fetch live data from server endpoints when drawer opens or tab changes
  const fetchLiveData = useCallback(async () => {
    const fetches = {};
    try {
      if (tab === "commodities" && !liveDataRef.current.commodities) {
        const r = await fetch("/api/commodity-spot"); const d = await r.json();
        fetches.commodities = d;
      }
      if (tab === "stocks" && !liveDataRef.current.indexPE) {
        const r = await fetch("/api/index-pe"); const d = await r.json();
        fetches.indexPE = d;
      }
      if (tab === "ai" && !liveDataRef.current.aiPrices) {
        const r = await fetch("/api/ai-prices"); const d = await r.json();
        fetches.aiPrices = d;
      }
    } catch (e) { console.warn("ChatDrawer live fetch:", e.message); }
    if (Object.keys(fetches).length) setLiveData(prev => ({ ...prev, ...fetches }));
  }, [tab]);

  useEffect(() => { if (open) { fetchLiveData(); getVerdictContext().catch(() => {}); } }, [open, tab, fetchLiveData]); // warm the verdict block on open

  // Auto-scroll on new messages
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  // Focus input when drawer opens
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100); }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      // Netlify fork: answering a question needs an Anthropic key, and this build
      // deliberately ships none. Say so plainly instead of letting the request
      // fall through to the SPA fallback and fail as a JSON parse error.
      if (STATIC_BUILD) {
        setMessages(prev => [...prev, { role: "assistant", content: "Chat is off in the hosted build. It needs a live Anthropic key, and this version ships no credentials to the browser — every other panel reads data baked at build time. Run the app locally with an ANTHROPIC_API_KEY in .env to use it." }]);
        return;
      }
      // Re-fetch live data if needed before building context
      await fetchLiveData();
      const verdicts = await getVerdictContext().catch(() => "");
      const context = buildContext(tab, { md, td, gd, cd, csm, hd, aiModels, zillowData }, liveDataRef.current) + (verdicts ? `

${verdicts}` : "");
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, context }),
      });
      const json = await resp.json();
      if (json.error) throw new Error(json.error);
      setMessages(prev => [...prev, { role: "assistant", content: json.reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  // Toggle button (always visible)
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="AI Assistant"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          width: 52, height: 52, borderRadius: "50%", border: "none",
          background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
          color: "#fff", cursor: "pointer", boxShadow: "0 4px 20px rgba(99,102,241,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "transform 0.2s, box-shadow 0.2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        <ChatIcon />
      </button>
    );
  }

  // Drawer panel
  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 400, maxWidth: "100vw",
      zIndex: 10000, display: "flex", flexDirection: "column",
      background: "var(--page-bg)", borderLeft: "1px solid var(--border-subtle)",
      boxShadow: "-8px 0 30px rgba(0,0,0,0.25)",
      animation: "slideInRight 0.25s ease",
      fontFamily: fonts.heading,
    }}>
      <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes dotPulse { 0%,80%,100% { opacity: 0.3; } 40% { opacity: 1; } }`}
      </style>

      {/* Header */}
      <div style={{
        padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
        }} />
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)", flex: 1 }}>AI Assistant</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: fonts.mono }}>Claude Opus 5</span>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            title="Clear chat"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "2px 4px", display: "flex", alignItems: "center" }}
          ><ClearIcon /></button>
        )}
        <button
          onClick={() => setOpen(false)}
          style={{
            background: "none", border: "none", color: "var(--text-muted)",
            fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1,
          }}
        >&times;</button>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "12px 14px",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, marginTop: 40 }}>
            <p style={{ marginBottom: 8 }}>Ask me about the data on your dashboard.</p>
            <p style={{ fontSize: 11, fontFamily: fonts.mono, color: "var(--text-muted)", marginBottom: 16 }}>
              Currently viewing: <strong style={{ color: "var(--text-secondary)" }}>{tab}</strong>
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              {[
                tab === "economy" ? "What's the yield curve telling us?" : null,
                tab === "economy" ? "Summarize the housing market" : null,
                tab === "commodities" ? "What are gold and silver doing today?" : null,
                tab === "stocks" ? "Compare index valuations" : null,
                tab === "intl" ? "Which central banks have the highest rates?" : null,
                tab === "ai" ? "What's the cheapest frontier model?" : null,
              ].filter(Boolean).slice(0, 3).map((q, i) => (
                <button key={i} onClick={() => { setInput(q); }} style={{
                  background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)",
                  borderRadius: 8, padding: "6px 12px", fontSize: 11, color: "var(--text-secondary)",
                  cursor: "pointer", fontFamily: fonts.heading, maxWidth: "90%",
                }}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "88%",
          }}>
            <div style={{
              padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.55,
              ...(m.role === "user" ? {
                background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff",
                borderBottomRightRadius: 4,
              } : {
                background: "var(--bg-subtle)", color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)", borderBottomLeftRadius: 4,
              }),
            }}>
              {m.role === "assistant" ? renderMsg(m.content) : m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start", padding: "10px 14px", background: "var(--bg-subtle)", border: "1px solid var(--border-subtle)", borderRadius: 12, borderBottomLeftRadius: 4 }}>
            <span style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)",
                  animation: `dotPulse 1.4s infinite ${i * 0.2}s`,
                }} />
              ))}
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input bar */}
      <div style={{
        padding: "10px 14px", borderTop: "1px solid var(--border-subtle)",
        display: "flex", gap: 8, flexShrink: 0,
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about your data..."
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border-subtle)",
            background: "var(--status-input-bg)", color: "var(--text-primary)",
            fontFamily: fonts.heading, fontSize: 13, outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            width: 40, height: 40, borderRadius: 10, border: "none",
            background: loading || !input.trim() ? "var(--bg-subtle)" : "linear-gradient(135deg, #6366F1, #8B5CF6)",
            color: loading || !input.trim() ? "var(--text-muted)" : "#fff",
            cursor: loading || !input.trim() ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.2s",
          }}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
