import React, { useEffect, useState } from "react";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { InfoBox } from "../../components/shared.jsx";

// ============================================================================
// TOKEN VOLUME ESTIMATES — OpenAI and Anthropic without their own disclosures.
// Four independent estimators, drawn as a band with the spread shown rather
// than averaged away, plus the cross-check that says when two of them are
// mutually impossible. Every hand-entered input is printed with its source,
// date and confidence. Data: /api/token-estimates (server/tokenEstimates.js);
// inputs in data/ai/token-estimates.json.
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", VIOLET = "#a78bfa";
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const usd = (v, dp = 2) => (fin(v) ? `$${v.toFixed(dp)}` : "—");
const bn = v => (!fin(v) ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : `$${(v / 1e6).toFixed(0)}M`);
const qd = v => (fin(v) ? `${v.toFixed(v < 10 ? 1 : 0)}Q` : "—");
const CONF = { high: GREEN, medium: AMBER, low: RED, "n/a": DIM };
const Pill = ({ children, color = SLATE, title }) => <span title={title} style={{ fontSize: 8.5, fontFamily: fonts.mono, color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 5px", marginLeft: 6, verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</span>;

const METHODS = {
  A: { name: "Compute identity", color: CYAN, how: "counterparty backlog attributed to the lab × recognition rate × inference share ÷ measured cost per million tokens" },
  B: { name: "Revenue ÷ price", color: GREEN, how: "API revenue ÷ the lab's realized dollars per million tokens (Ornn OTPI)" },
  C: { name: "Calibrated proxy", color: VIOLET, how: "OpenRouter volume × a multiplier fitted at a disclosure; the path is measured even though the anchor is not" },
  D: { name: "Physics ceiling", color: AMBER, how: "fleet in H100-equivalents × measured tokens/s/GPU × hours × utilisation — nothing can exceed it" },
};

// a log-scale band from 1Q to 1000Q with each method's point marked on it
function Band({ lab }) {
  const lo = 1, hi = 1000;
  const x = v => `${Math.max(0, Math.min(100, (Math.log10(Math.max(v, lo)) / Math.log10(hi)) * 100))}%`;
  const pts = Object.entries(lab.methods).filter(([, m]) => m && fin(m.tokensQ));
  if (!pts.length) return <div style={{ ...note, padding: "8px 0" }}>no method produced an estimate</div>;
  return (
    <div style={{ padding: "10px 4px 2px" }}>
      <div style={{ position: "relative", height: 26, background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
        {lab.band && <div style={{ position: "absolute", left: x(lab.band.lowQ), width: `calc(${x(lab.band.highQ)} - ${x(lab.band.lowQ)})`, top: 0, bottom: 0, background: "rgba(129,140,248,0.14)", borderRadius: 4 }} />}
        {[1, 10, 100, 1000].map(t => <div key={t} style={{ position: "absolute", left: x(t), top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.12)" }} />)}
        {pts.map(([k, m]) => (
          <div key={k} title={`${METHODS[k].name}: ${qd(m.tokensQ)} — ${METHODS[k].how}`} style={{ position: "absolute", left: `calc(${x(m.tokensQ)} - 6px)`, top: 3, width: 12, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: METHODS[k].color, fontFamily: fonts.mono, textShadow: "0 0 4px #0f172a" }}>{k}</span>
          </div>
        ))}
        {lab.anchor && <div title={`their own words: ${lab.anchor.source}`} style={{ position: "absolute", left: `calc(${x(lab.anchor.annualTokensQ)} - 1px)`, top: -3, bottom: -3, width: 2, background: "#e2e8f0" }} />}
      </div>
      <div style={{ position: "relative", height: 12 }}>
        {[1, 10, 100, 1000].map(t => <span key={t} style={{ position: "absolute", left: x(t), transform: "translateX(-50%)", ...note, fontSize: 8.5 }}>{t}Q</span>)}
      </div>
    </div>
  );
}

export default function TokenEstimatesPanel() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { fetch("/api/token-estimates").then(r => r.json()).then(x => (x.error ? setErr(x.error) : setD(x))).catch(e => setErr(String(e))); }, []);
  if (err) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Token estimates could not load: {err}</div>;
  if (!d) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading token estimates (SEC XBRL, measured cost per token, realized prices)…</div>;

  const M = d.measured, labs = d.labs.filter(l => l.key !== "google"), g = d.labs.find(l => l.key === "google");

  return (<>
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={label}>Token volume · estimated without the labs&apos; own disclosures</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 3 }}>
            One million H100-equivalents makes {qd(M.oneMillionH100Q)} a year — a million B200s, {qd(M.oneMillionB200Q)}
          </div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5, maxWidth: 940 }}>
            Nobody outside these companies can measure their token volume. What can be done is bound it four ways off sources they don&apos;t control — counterparties&apos; mandatory SEC filings, a measured cost per token, realized prices, and physics — then show the spread instead of averaging it into a false single number. The width of each band is the honest finding.
          </div>
        </div>
        <div style={{ ...note, textAlign: "right" }}>
          built {new Date(d.built).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · inputs reviewed {d.reviewed}<br />
          measured: H100 {M.h100Tps?.toLocaleString()} tok/s at {usd(M.h100CostPerM, 3)}/M · B200 {M.b200Tps?.toLocaleString()} at {usd(M.b200CostPerM, 3)}/M
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {Object.entries(METHODS).map(([k, m]) => (
          <div key={k} title={m.how} style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "5px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, cursor: "help" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: m.color, fontFamily: fonts.mono }}>{k}</span>
            <span style={{ fontSize: 10, color: "#cbd5e1", fontFamily: fonts.mono }}>{m.name}</span>
          </div>
        ))}
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(430px, 100%), 1fr))", gap: 12, marginBottom: 12 }}>
      {labs.map(l => (
        <div key={l.key} style={{ ...card, borderLeft: `3px solid ${l.color}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{l.name}</span>
            <span style={{ ...note }}>realized {usd(l.realizedPerM, 3)}/M · OpenRouter {l.openRouter ? `${(l.openRouter.weeklyTokens / 1e12).toFixed(1)}T/wk` : "—"}</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: l.band ? "#e2e8f0" : DIM, fontFamily: fonts.heading, letterSpacing: -0.5, marginTop: 4 }}>
            {l.band ? `${qd(l.band.lowQ)} – ${qd(l.band.highQ)}` : "no estimate"}
            {l.band && <span style={{ fontSize: 10.5, color: l.band.spreadX > 5 ? AMBER : SLATE, fontFamily: fonts.mono, marginLeft: 8 }}>a {l.band.spreadX}× spread</span>}
          </div>
          <Band lab={l} />
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
            <tbody>
              {Object.entries(l.methods).map(([k, m]) => (
                <tr key={k} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "3px 6px", fontSize: 10, fontFamily: fonts.mono, color: METHODS[k].color, fontWeight: 700, width: 14 }}>{k}</td>
                  <td style={{ padding: "3px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE }}>{METHODS[k].name}</td>
                  <td style={{ padding: "3px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: m && fin(m.tokensQ) ? "#e2e8f0" : DIM, textAlign: "right", fontWeight: 700 }}>
                    {m && fin(m.tokensQ) ? qd(m.tokensQ) : "—"}
                  </td>
                  <td style={{ padding: "3px 6px", fontSize: 9.5, fontFamily: fonts.mono, color: DIM, textAlign: "right" }}>
                    {m?.unavailable ? m.why
                      : k === "A" && m ? `${bn(m.inferenceSpendUsd)}/yr inference ÷ ${usd(m.costPerM, 3)}/M${m.excluded?.length ? ` · ${m.excluded.length} counterparty excluded` : ""}`
                      : k === "B" && m ? `${bn(m.apiRevenueUsd)} API rev ÷ ${usd(m.realizedPerM, 3)}/M`
                      : k === "D" && m ? `${(m.h100Equivalents / 1e6).toFixed(1)}M H100-eq × ${Math.round(m.inferenceShare * 100)}% inference`
                      : ""}
                    {m && !m.unavailable && m.confidence && <Pill color={CONF[m.confidence]}>{m.confidence}</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {l.consistency && (
            <div style={{ marginTop: 8, padding: "7px 9px", borderRadius: 8, background: l.consistency.gapX > 2 || l.consistency.gapX < 0.5 ? "rgba(251,191,36,0.08)" : "rgba(74,222,128,0.07)", border: `1px solid ${l.consistency.gapX > 2 || l.consistency.gapX < 0.5 ? AMBER : GREEN}33` }}>
              <div style={{ fontSize: 10, fontFamily: fonts.mono, color: l.consistency.gapX > 2 || l.consistency.gapX < 0.5 ? AMBER : GREEN, fontWeight: 700 }}>
                cross-check: A implies {(l.consistency.impliedH100Equivalents / 1e6).toFixed(2)}M H100-equivalents, D assumes {(l.consistency.statedH100Equivalents / 1e6).toFixed(2)}M — {l.consistency.gapX}×
              </div>
              <div style={{ ...note, marginTop: 2 }}>{l.consistency.verdict}</div>
            </div>
          )}
          {l.anchor && <div style={{ ...note, marginTop: 6 }}>their own words, for calibration only: {qd(l.anchor.annualTokensQ)}/yr ({l.anchor.scope}, {l.anchor.date}) — {l.anchor.source}</div>}
          {l.note && <div style={{ ...note, marginTop: 4, color: SLATE }}>{l.note}</div>}
        </div>
      ))}
    </div>

    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={label}>The mandatory rail · SEC XBRL, quarterly and audited</span>
        <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", color: INDIGO, fontFamily: fonts.mono, fontSize: 10, cursor: "pointer" }}>{open ? "hide inputs" : "show every hand-entered input"}</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {Object.entries(d.filings).map(([t, f]) => {
          const rpo = f.concepts?.RevenueRemainingPerformanceObligation?.latest;
          const capex = f.concepts?.PaymentsToAcquirePropertyPlantAndEquipment?.latest;
          return (
            <div key={t} style={{ padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, minWidth: 130 }}>
              <div style={{ ...label, fontSize: 8.5 }}>{f.name}{f.serves?.length ? ` → ${f.serves.join(", ")}` : ""}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#e2e8f0", fontFamily: fonts.heading }}>{rpo ? `${bn(rpo.val)} RPO` : capex ? `${bn(capex.val)} capex` : "—"}</div>
              <div style={{ ...note, fontSize: 8.5 }}>{rpo ? `as of ${rpo.end}` : capex ? `${capex.end}` : "concept not tagged"}</div>
            </div>
          );
        })}
      </div>
      {open && (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {labs.flatMap(l => [
                l.inputs.revenue && <tr key={l.key + "r"} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: l.color, fontWeight: 700 }}>{l.name}</td>
                  <td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE }}>revenue run-rate</td>
                  <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "#e2e8f0", textAlign: "right" }}>{bn(l.inputs.revenue.annualRunRateUsd)} · {Math.round(l.inputs.revenue.apiShare * 100)}% API</td>
                  <td style={{ padding: "4px 6px", fontSize: 9.5, fontFamily: fonts.mono, color: DIM }}>{l.inputs.revenue.asOf} — {l.inputs.revenue.source}<Pill color={CONF[l.inputs.revenue.confidence]}>{l.inputs.revenue.confidence}</Pill></td>
                </tr>,
                l.inputs.fleet && <tr key={l.key + "f"} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td /><td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE }}>fleet</td>
                  <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: "#e2e8f0", textAlign: "right" }}>{(l.inputs.fleet.h100Equivalents / 1e6).toFixed(2)}M H100-eq</td>
                  <td style={{ padding: "4px 6px", fontSize: 9.5, fontFamily: fonts.mono, color: DIM }}>{l.inputs.fleet.asOf} — {l.inputs.fleet.source}<Pill color={CONF[l.inputs.fleet.confidence]}>{l.inputs.fleet.confidence}</Pill></td>
                </tr>,
                ...(l.methods.A?.counterparties || []).map((c, i) => (
                  <tr key={l.key + "c" + i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td /><td style={{ padding: "4px 6px", fontSize: 10, fontFamily: fonts.mono, color: SLATE }}>{c.name} backlog</td>
                    <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, color: c.excluded ? DIM : "#e2e8f0", textAlign: "right" }}>{c.excluded ? "excluded" : `${bn(c.rpoUsd)} × ${Math.round(c.share * 100)}%`}</td>
                    <td style={{ padding: "4px 6px", fontSize: 9.5, fontFamily: fonts.mono, color: DIM }}>{c.excluded ? c.why : c.shareSource}{c.shareConfidence && !c.excluded && <Pill color={CONF[c.shareConfidence]}>{c.shareConfidence}</Pill>}</td>
                  </tr>
                )),
              ].filter(Boolean))}
            </tbody>
          </table>
          <div style={{ ...note, marginTop: 6 }}>Every row above is in data/ai/token-estimates.json and is yours to correct. {d.knowledgeCutoffWarning}</div>
        </div>
      )}
    </div>

    <InfoBox color={INDIGO}>
      <strong style={{ color: "#cbd5e1" }}>What this is and is not.</strong> It is not a measurement — it is four bounds off sources the labs don&apos;t control, shown with their disagreement intact. The bands are wide on purpose: a narrow number here would be a lie. {g?.anchor && <>The one lab that does publish, Google, said {qd(g.anchor.annualTokensQ)}/yr as of {g.anchor.date} — across every surface including Search, which is a supply-side decision rather than measured demand, and so is not comparable to an API figure.</>} {d.caveat} The cross-check is the most useful line on the panel: when the compute identity and the fleet estimate imply different worlds, the right response is to go fix an input, not to split the difference. {d.source}
    </InfoBox>
  </>);
}
