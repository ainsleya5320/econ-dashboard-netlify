import React, { useEffect, useMemo, useRef, useState } from "react";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { InfoBox } from "../../components/shared.jsx";
import SubViews from "../../components/SubViews.jsx";
import { LS, lsGet, lsSet } from "../../lib/deploy.js";

// ============================================================================
// SPECIAL SITUATIONS — Greenblatt's "You Can Be a Stock Market Genius" and
// Suria's "The Event-Driven Edge" as a working pipeline.
//   Boards   candidates surfaced from filings: spinoffs, merger arb (with the
//            merger-securities corner Greenblatt actually likes), post-reorg
//            equity, rights offerings, self-tenders and special dividends,
//            insider clusters, activist 13Ds, pre-deal SPACs priced against
//            trust, buyback authorisations sized against market cap. Every number pulled from a filing
//            is a regex match and is labelled parsed.
//   Deal Book  the pins: thesis, notes, key dates and the per-type checklist,
//            persisted server-side. The boards find; the book decides.
// Data: /api/special-situations and /api/special-dealbook (server/specialSituations.js).
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", ORANGE = "#fb923c", VIOLET = "#a78bfa", PINK = "#f472b6", SKY = "#38bdf8", YELLOW = "#facc15";
const CAT = {
  spinoff: { label: "Spinoff", color: INDIGO }, merger: { label: "Merger arb", color: CYAN }, reorg: { label: "Post-reorg", color: ORANGE },
  rights: { label: "Rights", color: GREEN }, recap: { label: "Recap", color: AMBER }, insider: { label: "Insider", color: VIOLET }, "13D": { label: "13D", color: PINK },
  spac: { label: "SPAC", color: SKY }, buyback: { label: "Buyback", color: YELLOW },
};
const VIEW_ACCENT = { book: INDIGO, spinoffs: INDIGO, mergers: CYAN, reorg: ORANGE, rights: GREEN, recaps: AMBER, insider: VIOLET, activist: PINK, spacs: SKY, buybacks: YELLOW };
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "");
const pc = (v, dp = 1) => (fin(v) ? `${sgn(v)}${Math.abs(v).toFixed(dp)}%` : "—");
const usd = v => (!fin(v) ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v.toFixed(0)}`);
const px = v => (fin(v) ? `$${v < 10 ? v.toFixed(2) : v.toFixed(2)}` : "—");
const thisYear = new Date().getFullYear();
const fd = s => { if (!s) return "—"; const d = new Date(`${s}T00:00:00`); if (isNaN(d)) return s; return d.toLocaleDateString(undefined, d.getFullYear() === thisYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "2-digit" }); };
const days = n => (!fin(n) ? "—" : n === 0 ? "today" : n > 0 ? `in ${n}d` : `${-n}d ago`);
const upGood = v => (!fin(v) || v === 0 ? SLATE : v > 0 ? GREEN : RED);

function Spark({ values, color, w = 68, h = 18 }) {
  const v = (values || []).filter(fin);
  if (v.length < 3) return <svg width={w} height={h} />;
  const min = Math.min(...v), max = Math.max(...v), range = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${(1 - (x - min) / range) * (h - 4) + 2}`).join(" ");
  return <svg width={w} height={h} style={{ display: "block" }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" /></svg>;
}
const th = (t, align = "right") => <th key={t} style={{ padding: "5px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: align, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{t}</th>;
const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;
const Pill = ({ children, color = SLATE, ml = 6 }) => <span style={{ fontSize: 8.5, fontFamily: fonts.mono, color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 5px", marginLeft: ml, verticalAlign: "middle", whiteSpace: "nowrap" }}>{children}</span>;
const A = ({ href, children, color = "#c7d2fe" }) => (href ? <a href={href} target="_blank" rel="noopener" style={{ color, textDecoration: "none" }}>{children}</a> : children);
const Flag = ({ on, children, color = AMBER }) => (on ? <Pill color={color} ml={0}>{children}</Pill> : null);
const Dot = ({ color }) => <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: color, marginRight: 6, verticalAlign: "middle" }} />;
const chip = (k, v, color = "#e2e8f0") => (
  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, minWidth: 92 }}>
    <span style={{ ...label, fontSize: 8.5 }}>{k}</span><span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.3 }}>{v}</span>
  </div>
);
const Parsed = ({ ok }) => <Pill color={ok ? DIM : "#7c2d12"} ml={0}>{ok ? "parsed" : "no doc"}</Pill>;

// Greenblatt's and Suria's questions, per situation type — the part no feed can answer
const CHECKLIST = {
  spinoff: ["Do insiders get stock or options in the SpinCo (read the Form 10 incentive section)?", "Who is forced to sell — index funds, size mandates, dividend mandates?", "Hidden leverage: what debt did the parent load onto the SpinCo?", "Is the parent the better business after the split, or is the SpinCo?", "Wait for the post-distribution dump before buying?"],
  merger: ["Cash, stock or mixed — what is the hedge and what does it cost?", "Regulatory path: HSR second request, CFIUS, foreign approvals?", "Financing condition, and is the buyer's balance sheet good for it?", "What merger securities (CVR, warrants, preferred) get thrown off, and who has to sell them?", "Downside if the deal breaks — where does the target trade unaffected?"],
  reorg: ["Who owns the new equity — creditors who want out, or sponsors who want in?", "Fresh-start balance sheet: leverage after emergence?", "Management incentive plan on the new shares?", "Listing: exchange or OTC — who is allowed to own it?", "Does the business earn its new capital structure?"],
  rights: ["Are insiders or a backstop party committing capital at the subscription price?", "Oversubscription privilege — can you buy more than your pro rata?", "Transferable rights: are they trading below intrinsic value?", "Use of proceeds — deleveraging, or a hole?", "Why a rights offering rather than a normal placement?"],
  recap: ["Post-recap Debt/EBITDA and interest coverage?", "Stub math: what does the leveraged equity earn on a normal year?", "Are insiders tendering, or staying in?", "Is the tender funded by cash on hand or new debt?", "What is the odd-lot angle, if any?"],
  insider: ["Open-market purchases only — no option exercises, no plan buys?", "Cluster or lone buyer? CEO/CFO or a 10% holder averaging down?", "Size relative to the buyer's holdings and pay?", "What weakness are they buying into, and do they know something structural?", "Any 10b5-1 plan disclosed?"],
  "13D": ["The filer's track record — do they win, and how?", "Item 4 purpose: board seats, sale process, capital return?", "Is the stake still being built (amendments) or complete?", "What is the valuation gap they cite, and is it real?", "Who else is in the register — allies or defenders?"],
  spac: ["Price below trust — what is the yield to the deadline, and is the trust really $10 (read the 10-Q)?", "Deadline and extension votes: will the sponsor extend, and does the trust get topped up or drained?", "If a target is announced — would you own the de-SPAC? Most trade down; redeem unless you would.", "Warrant and founder-share dilution on the pro forma?", "Sponsor track record on prior vehicles?"],
  buyback: ["New authorisation, or a re-announcement of an old one in an earnings release?", "Size against market cap and against free cash flow — can they actually execute it?", "Funded from cash or from new debt?", "Are insiders buying alongside, or selling into it?", "Is the share count actually falling, net of stock comp (check the 10-Q cover)?"],
};

export default function SpecialSituations({ onSelectStock }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [book, setBook] = useState({ entries: [] });
  const [view, setView] = useState(null);
  const [secs, setSecs] = useState(0);
  const saveTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/special-situations").then(r => r.json()).then(x => { if (!alive) return; if (x.error) setErr(x.error); else setD(x); }).catch(e => alive && setErr(String(e)));
    // Netlify fork: this build cannot write to the server, so pins live in
    // localStorage. Anything saved here wins over the snapshot baked at build
    // time; with nothing saved yet, that snapshot is the starting point.
    const local = lsGet(LS.dealbook);
    if (local && Array.isArray(local.entries)) {
      setBook(local); setView(v => v || (local.entries.length ? "book" : "spinoffs"));
      return;
    }
    fetch("/api/special-dealbook").then(r => r.json()).then(x => { if (!alive) return; const b = x && Array.isArray(x.entries) ? x : { entries: [] }; setBook(b); setView(v => v || (b.entries.length ? "book" : "spinoffs")); }).catch(() => setView(v => v || "spinoffs"));
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // every board contributes to one price lookup so the Deal Book shows live marks
  const quotes = useMemo(() => {
    const q = {};
    if (!d) return q;
    for (const r of d.spinoffs) { if (r.ticker && fin(r.price)) q[r.ticker] = r.price; if (r.parentTicker && fin(r.price)) q[r.parentTicker] = r.price; }
    for (const r of d.mergers) if (r.ticker && fin(r.price)) q[r.ticker] = r.price;
    for (const r of d.reorg) if (r.ticker && fin(r.price)) q[r.ticker] = r.price;
    for (const r of [...d.rights, ...d.recaps, ...d.activist]) if (r.ticker && fin(r.price)) q[r.ticker] = r.price;
    for (const r of d.insider) if (r.symbol && fin(r.price)) q[r.symbol] = r.price;
    for (const r of [...(d.spacs || []), ...(d.buybacks || [])]) if (r.ticker && fin(r.price)) q[r.ticker] = r.price;
    return q;
  }, [d]);

  const persist = next => {
    setBook(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { lsSet(LS.dealbook, next); }, 700);
  };
  const pinned = (cat, key) => book.entries.some(e => e.cat === cat && e.key === key);
  const pin = (cat, key, fields) => {
    if (pinned(cat, key)) { persist({ ...book, entries: book.entries.filter(e => !(e.cat === cat && e.key === key)) }); return; }
    const entry = { id: `${cat}:${key}:${Date.now()}`, cat, key, addedAt: new Date().toISOString().slice(0, 10), thesis: "", notes: "", checks: {}, ...fields, dates: (fields.dates || []).filter(x => x.date) };
    persist({ ...book, entries: [entry, ...book.entries] });
  };
  const update = (id, patch) => persist({ ...book, entries: book.entries.map(e => (e.id === id ? { ...e, ...patch } : e)) });
  const PinBtn = ({ cat, k, fields }) => { const on = pinned(cat, k); return <button onClick={() => pin(cat, k, fields)} title={on ? "Remove from Deal Book" : "Pin to Deal Book"} style={{ background: on ? `${CAT[cat].color}22` : "transparent", border: `1px solid ${on ? CAT[cat].color : "rgba(255,255,255,0.12)"}`, color: on ? CAT[cat].color : DIM, borderRadius: 5, fontSize: 10, padding: "1px 6px", cursor: "pointer", fontFamily: fonts.mono }}>{on ? "✓" : "+"}</button>; };
  const Tk = ({ t, color = "#e2e8f0" }) => (t ? <span onClick={() => onSelectStock && onSelectStock(t)} style={{ color, fontWeight: 700, cursor: onSelectStock ? "pointer" : "default", fontFamily: fonts.mono }}>{t}</span> : <span style={{ color: DIM }}>—</span>);

  if (err) return <div style={{ ...card, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Could not load special situations: {err}</div>;
  if (!d) {
    const mm = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    return (
      <div style={{ ...card, padding: "22px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3 }}>Sweeping EDGAR — {mm}</div>
        <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 6, lineHeight: 1.6, maxWidth: 600, margin: "6px auto 0" }}>
          About twenty-five full-text searches across Form 10, tender, proxy, 13D and 8-K filings, then the primary document of each new candidate for its terms, then a quote for every name. First build runs two to three minutes; after that it is cached for six hours and documents already read are never fetched again.
        </div>
      </div>
    );
  }

  const P = d.pipeline;
  const SQ = d.spacs || [], BB = d.buybacks || [];
  const PS = P.spacs || {}, PB = P.buybacks || {};
  const errs = Object.entries(d.status || {}).filter(([, v]) => v !== "ok");

  // ── header: the pipeline ──────────────────────────────────────────────────
  const header = (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={label}>Special situations · pipeline</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 3 }}>
            {P.mergers.live} live spreads · {P.spinoffs.pending} spinoffs pending · {P.reorg.emerged90} emerged in 90d · {P.rights.open} rights open · {P.insider.clusters} insider clusters · {PS.belowTrust ?? 0} SPACs below trust · {PB.big ?? 0} buybacks ≥5% of cap
          </div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5 }}>
            Greenblatt&apos;s five situation types plus Suria&apos;s insider and activist signals, surfaced from filings as they land. The boards find candidates; the Deal Book is where the reading and the checklist happen.
          </div>
        </div>
        <div style={{ ...note, textAlign: "right" }} title={d.timing ? Object.entries(d.timing).map(([k, v]) => `${k} ${v}s`).join(" · ") : undefined}>built {new Date(d.built).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} in {d.buildSecs}s{fin(d.docsRead) ? ` (${d.docsRead} filings read, ${d.quotesFetched} quotes)` : ""} · {d.docsCached} filings parsed to date · refreshes every {d.ttlHours}h</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {chip("spinoffs in pipe", P.spinoffs.n, INDIGO)}
        {chip("distributing ≤30d", P.spinoffs.next30, INDIGO)}
        {chip("live spreads", P.mergers.live, CYAN)}
        {chip("median gross / ann.", fin(P.mergers.medianGross) ? `${pc(P.mergers.medianGross)} / ${pc(P.mergers.medianAnn, 0)}` : "—", CYAN)}
        {chip("merger securities", P.mergers.securities, CYAN)}
        {chip("emerged, 90d", P.reorg.emerged90, ORANGE)}
        {chip("rights open", `${P.rights.open} · ${P.rights.backstopped} backstopped`, GREEN)}
        {chip("self-tenders open", `${P.recaps.tenders} · ${P.recaps.dutch} Dutch`, AMBER)}
        {chip("insider clusters", `${P.insider.clusters} of ${P.insider.symbols}`, VIOLET)}
        {chip("13Ds, 30d", `${P.activist.n30} · ${P.activist.board} seek board`, PINK)}
        {chip("SPACs below trust", `${PS.belowTrust ?? 0} of ${PS.searching ?? 0}${fin(PS.medianYield) ? ` · median ${pc(PS.medianYield, 1)} to trust` : ""}`, SKY)}
        {chip("buybacks ≥5% of cap", `${PB.big ?? 0} · ${PB.withInsiders ?? 0} with insiders buying`, YELLOW)}
      </div>
      {d.newThisWeek.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...label, marginRight: 4 }}>new this week</span>
          {d.newThisWeek.slice(0, 14).map((n, i) => (
            <span key={i} style={{ fontSize: 10, fontFamily: fonts.mono, color: "#cbd5e1", background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap" }}>
              <Dot color={CAT[n.cat === "13D" ? "13D" : n.cat]?.color || SLATE} />{n.ticker ? <Tk t={n.ticker} /> : n.name?.slice(0, 22)}<span style={{ color: DIM }}> · {n.note}</span>
            </span>
          ))}
          {d.newThisWeek.length > 14 && <span style={note}>+{d.newThisWeek.length - 14} more</span>}
        </div>
      )}
      {errs.length > 0 && <div style={{ ...note, color: AMBER, marginTop: 8 }}>Partial build — {errs.map(([k, v]) => `${k}: ${v}`).join(" · ")}. Other boards are current; this one is serving nothing until the next refresh.</div>}
    </div>
  );

  const Board = ({ intro, cols, children, foot }) => (
    <div style={{ ...card, padding: "10px 10px 6px" }}>
      {intro && <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, lineHeight: 1.55, padding: "2px 4px 8px" }}>{intro}</div>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{cols.map(([t, a]) => th(t, a))}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {foot && <div style={{ ...note, padding: "6px 4px 2px" }}>{foot}</div>}
    </div>
  );
  const empty = (cols, msg) => <tr><td colSpan={cols} style={{ ...note, padding: 14, textAlign: "center" }}>{msg}</td></tr>;
  const rowStyle = { borderBottom: "1px solid rgba(255,255,255,0.04)" };

  // ── spinoffs ──────────────────────────────────────────────────────────────
  const spinoffs = () => {
    const cols = [["", "left"], ["SpinCo", "left"], ["Parent", "left"], ["Stage", "left"], ["Ratio", "right"], ["Record", "right"], ["Distribution", "right"], ["When", "right"], ["Price", "right"], ["Since dist.", "right"], ["Flags", "left"], ["Filing", "right"]];
    return (
      <Board cols={cols}
        intro={<>Greenblatt ch.3–4: the SpinCo registers on Form 10; its holders did not choose it, so index funds and size mandates sell in the first weeks and months. Read the incentive section — insiders who get options struck after the distribution want a low first print. Suria adds the parent: it is often the better trade.</>}
        foot="Form 10-12B and amendments, 240 days; parent 8-Ks mentioning a spin-off and separation, 180 days. Ratio and dates parsed from the information statement where one was filed; a row without them has a Form 10 whose exhibits carry the terms — open the filing.">
        {d.spinoffs.length === 0 && empty(cols.length, "No spinoffs found in the window.")}
        {d.spinoffs.map(r => {
          const key = String(r.cik);
          const tone = r.stage === "distributed" ? GREEN : r.stage === "dated" ? AMBER : SLATE;
          return (
            <tr key={key} style={rowStyle}>
              {td(<PinBtn cat="spinoff" k={key} fields={{ name: r.spinco || r.parent, ticker: r.ticker || r.parentTicker, url: r.url, dates: [{ label: "record", date: r.record }, { label: "distribution", date: r.dist }] }} />, DIM, { textAlign: "left" })}
              {td(<><Dot color={tone} />{r.ticker ? <Tk t={r.ticker} /> : null}<span style={{ color: "#cbd5e1", marginLeft: r.ticker ? 6 : 0 }}>{r.spinco || <span style={{ color: DIM }}>—</span>}</span>{r.amendments > 0 && <Pill>A×{r.amendments}</Pill>}{!r.ticker && r.symbolInDoc && <Pill color={INDIGO}>doc names {r.symbolInDoc}</Pill>}</>, "#cbd5e1", { textAlign: "left" })}
              {td(<>{r.parentTicker ? <Tk t={r.parentTicker} /> : null}<span style={{ marginLeft: r.parentTicker ? 6 : 0, color: r.parent ? "#cbd5e1" : DIM }}>{r.parent ? r.parent.slice(0, 34) : "—"}</span></>, "#cbd5e1", { textAlign: "left" })}
              {td(r.stage, tone, { textAlign: "left" })}
              {td(r.ratio || "—")}
              {td(fd(r.record))}
              {td(fd(r.dist))}
              {td(days(r.daysToDist), fin(r.daysToDist) && r.daysToDist >= 0 && r.daysToDist <= 30 ? AMBER : SLATE)}
              {td(px(r.price))}
              {td(<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Spark values={r.spark} color={upGood(r.sinceDist)} /><span style={{ color: upGood(r.sinceDist), width: 44, textAlign: "right" }}>{pc(r.sinceDist)}</span></span>)}
              {td(<span style={{ display: "inline-flex", gap: 4 }}><Flag on={r.taxFree} color={GREEN}>tax-free</Flag><Flag on={r.incentive} color={INDIGO}>incentives</Flag><Flag on={r.whenIssued} color={SLATE}>when-issued</Flag><Parsed ok={r.parsed} /></span>, SLATE, { textAlign: "left" })}
              {td(<A href={r.url}>{fd(r.latestFiled)} ↗</A>)}
            </tr>
          );
        })}
      </Board>
    );
  };

  // ── merger arb ────────────────────────────────────────────────────────────
  const mergers = () => {
    const cols = [["", "left"], ["Target", "left"], ["Acquirer", "left"], ["Stage", "left"], ["Consideration", "right"], ["Price", "right"], ["Gross", "right"], ["Annualised", "right"], ["Close", "right"], ["Flags", "left"], ["Securities", "left"], ["Filing", "right"]];
    const rows = d.mergers;
    const cons = r => (fin(r.cash) && fin(r.stock) ? `$${r.cash} + ${r.stock}×` : fin(r.cash) ? `$${r.cash} cash` : fin(r.stock) ? `${r.stock}× ${r.acquirerTicker || "acq."}` : "—");
    const tr = r => {
      const key = r.targetCik ? String(r.targetCik) : `${r.target}`;
      const tone = !fin(r.gross) || r.pastClose ? SLATE : r.gross < 0 ? RED : r.gross > 15 ? AMBER : GREEN;
      return (
        <tr key={key + r.announced} style={rowStyle}>
          {td(<PinBtn cat="merger" k={key} fields={{ name: r.target, ticker: r.ticker, url: r.url, dates: [{ label: "tender expiry", date: r.tenderExpiry }, { label: "vote", date: r.meeting }, { label: "outside date", date: r.outsideDate }] }} />, DIM, { textAlign: "left" })}
          {td(<><Dot color={tone} /><Tk t={r.ticker} /><span style={{ marginLeft: r.ticker ? 6 : 0, color: "#cbd5e1" }}>{r.target?.slice(0, 30)}</span></>, "#cbd5e1", { textAlign: "left" })}
          {td(<><Tk t={r.acquirerTicker} color="#cbd5e1" /><span style={{ marginLeft: r.acquirerTicker ? 6 : 0, color: r.acquirer ? "#cbd5e1" : DIM }}>{r.acquirer ? r.acquirer.slice(0, 30) : "—"}</span>{r.role === "parsed" && <Pill>role parsed</Pill>}</>, "#cbd5e1", { textAlign: "left" })}
          {td(r.stage, r.stage === "tender" ? CYAN : r.stage === "proxy" ? AMBER : SLATE, { textAlign: "left" })}
          {td(cons(r))}
          {td(px(r.price))}
          {td(pc(r.gross, 1), tone)}
          {td(pc(r.annualized, 0), tone)}
          {td(<>{r.closeDate ? fd(r.closeDate) : <span style={{ color: DIM }}>~{r.daysToClose}d</span>}{r.closeAssumed && fin(r.gross) && <Pill>assumed</Pill>}</>)}
          {td(<span style={{ display: "inline-flex", gap: 4 }}><Flag on={r.flags?.hsr} color={AMBER}>HSR</Flag><Flag on={r.flags?.cfius} color={RED}>CFIUS</Flag><Flag on={r.flags?.goShop} color={GREEN}>go-shop</Flag><Flag on={r.flags?.financing} color={AMBER}>financing</Flag></span>, SLATE, { textAlign: "left" })}
          {td(<span style={{ display: "inline-flex", gap: 4 }}><Flag on={r.securities?.cvr} color={CYAN}>CVR</Flag><Flag on={r.securities?.warrant} color={CYAN}>warrants</Flag><Flag on={r.securities?.preferred} color={CYAN}>preferred</Flag></span>, SLATE, { textAlign: "left" })}
          {td(<A href={r.url}>{fd(r.announced)} ↗</A>)}
        </tr>
      );
    };
    return (<>
      <Board cols={cols}
        intro={<>Greenblatt ch.6: plain merger arb is a crowded trade with a bad payoff shape — small spread, large break. The corner worth working is the <b>merger securities</b>: the CVRs, warrants and preferreds paid out as part-consideration, which most target holders sell without pricing. Spread math here uses cash terms parsed from the filing and the live quote; where the close date is not in the filing it is assumed at 150 days from announcement.</>}
        foot="SC TO-T tenders (target and bidder named), 8-K Item 1.01 with an Agreement and Plan of Merger (SPAC names and completed deals excluded), DEFM14A proxies as the vote stage, and FMP's M&A list to settle the acquirer/target roles. Stock-component deals price the acquirer at the live quote.">
        {rows.length === 0 && empty(cols.length, "No deals found.")}
        {rows.map(tr)}
      </Board>
      {d.securities.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...label, margin: "4px 0 6px" }}>merger securities — consideration that includes a CVR, warrants or preferred</div>
          <Board cols={cols}>{d.securities.map(tr)}</Board>
        </div>
      )}
    </>);
  };

  // ── restructurings ────────────────────────────────────────────────────────
  const reorg = () => {
    const cols = [["", "left"], ["Company", "left"], ["Stage", "left"], ["Petition", "right"], ["Confirmed", "right"], ["Emerged", "right"], ["Since", "right"], ["New shares", "right"], ["Listing", "left"], ["Price", "right"], ["3 months", "right"], ["Filing", "right"]];
    return (
      <Board cols={cols}
        intro={<>Greenblatt ch.5: the new equity of a company leaving Chapter 11 goes to creditors who never wanted stock and sell it as soon as it lists, often into no coverage and no index. The window is the months after emergence. Fresh-start accounting resets the balance sheet — read the plan for leverage and the management incentive plan.</>}
        foot="Petitions from the bankruptcy tracker's 8-K Item 1.03 list; plan confirmation and effectiveness from 8-K phrase sweeps; 8-A12B registrations matched by CIK for the listing. Companies with only a petition stay on the Credit › Defaults view. Old symbols ending in Q are the pre-emergence shares.">
        {d.reorg.length === 0 && empty(cols.length, "No confirmations or emergences in the window.")}
        {d.reorg.map(r => {
          const key = String(r.cik);
          const tone = r.stage === "listed" ? GREEN : r.stage === "emerged" ? CYAN : AMBER;
          return (
            <tr key={key} style={rowStyle}>
              {td(<PinBtn cat="reorg" k={key} fields={{ name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: "emerged", date: r.emerged }, { label: "listed", date: r.listed }] }} />, DIM, { textAlign: "left" })}
              {td(<><Dot color={tone} /><Tk t={r.ticker} /><span style={{ marginLeft: r.ticker ? 6 : 0, color: "#cbd5e1" }}>{r.name.slice(0, 34)}</span>{r.oldTickers?.length > 0 && <Pill>{r.oldTickers.join(" ")}</Pill>}</>, "#cbd5e1", { textAlign: "left" })}
              {td(r.stage, tone, { textAlign: "left" })}
              {td(fd(r.petition))}
              {td(fd(r.confirmed))}
              {td(fd(r.emerged))}
              {td(fin(r.daysSince) ? `${r.daysSince}d` : "—", fin(r.daysSince) && r.daysSince <= 120 ? AMBER : SLATE)}
              {td(fin(r.newShares) ? r.newShares.toLocaleString() : "—")}
              {td(<span style={{ display: "inline-flex", gap: 4 }}><Flag on={r.exchange} color={GREEN}>exchange</Flag><Flag on={r.otc} color={AMBER}>OTC</Flag><Flag on={r.freshStart} color={SLATE}>fresh-start</Flag></span>, SLATE, { textAlign: "left" })}
              {td(px(r.price))}
              {td(<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Spark values={r.spark} color={upGood(r.since)} /><span style={{ color: upGood(r.since), width: 44, textAlign: "right" }}>{pc(r.since)}</span></span>)}
              {td(<A href={r.url}>{fd(r.filings?.[0]?.date)} ↗</A>)}
            </tr>
          );
        })}
      </Board>
    );
  };

  // ── rights offerings ──────────────────────────────────────────────────────
  const rights = () => {
    const cols = [["", "left"], ["Issuer", "left"], ["Stage", "left"], ["Sub. price", "right"], ["Ratio", "right"], ["Record", "right"], ["Expiry", "right"], ["Price", "right"], ["Discount", "right"], ["Terms", "left"], ["Raise", "right"], ["Filing", "right"]];
    return (
      <Board cols={cols}
        intro={<>Greenblatt ch.7: a rights offering with an oversubscription privilege lets the holders who pay attention buy the shares of the holders who do not, at the subscription price. The tell is a backstop — an insider or sponsor committing to take whatever is left. Transferable rights sometimes trade below their intrinsic value in the last days.</>}
        foot="8-Ks mentioning a rights offering, 150 days, listed issuers only. Subscription price, ratio and dates are parsed from the 8-K; the prospectus supplement carries the full terms. Discount is the subscription price against the live quote.">
        {d.rights.length === 0 && empty(cols.length, "No rights offerings in the window.")}
        {d.rights.map(r => {
          const key = String(r.cik);
          const tone = r.stage === "open" ? GREEN : r.stage === "announced" ? AMBER : SLATE;
          return (
            <tr key={key} style={rowStyle}>
              {td(<PinBtn cat="rights" k={key} fields={{ name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: "record", date: r.record }, { label: "expiry", date: r.expiry }] }} />, DIM, { textAlign: "left" })}
              {td(<><Dot color={tone} /><Tk t={r.ticker} /><span style={{ marginLeft: 6, color: "#cbd5e1" }}>{r.name.slice(0, 34)}</span></>, "#cbd5e1", { textAlign: "left" })}
              {td(r.stage, tone, { textAlign: "left" })}
              {td(px(r.subPrice))}
              {td(r.ratio || "—")}
              {td(fd(r.record))}
              {td(<>{fd(r.expiry)}{fin(r.daysToExpiry) && r.daysToExpiry >= 0 && <span style={{ color: DIM }}> · {days(r.daysToExpiry)}</span>}</>)}
              {td(px(r.price))}
              {td(pc(r.discount, 0), fin(r.discount) && r.discount > 0 ? GREEN : SLATE)}
              {td(<span style={{ display: "inline-flex", gap: 4 }}><Flag on={r.oversub} color={GREEN}>oversub</Flag><Flag on={r.backstop} color={INDIGO}>backstop</Flag><Flag on={r.transferable === true} color={CYAN}>transferable</Flag><Flag on={r.transferable === false} color={SLATE}>non-transferable</Flag><Parsed ok={r.parsed} /></span>, SLATE, { textAlign: "left" })}
              {td(r.gross ? `$${r.gross}` : "—")}
              {td(<A href={r.url}>{fd(r.filed)} ↗</A>)}
            </tr>
          );
        })}
      </Board>
    );
  };

  // ── recaps ────────────────────────────────────────────────────────────────
  const recaps = () => {
    const cols = [["", "left"], ["Company", "left"], ["Kind", "left"], ["Stage", "left"], ["Size", "right"], ["Price range / amount", "right"], ["Expiry / payable", "right"], ["Price", "right"], ["Premium / yield", "right"], ["Flags", "left"], ["Filing", "right"]];
    return (
      <Board cols={cols}
        intro={<>Greenblatt ch.7, the recapitalisation: a company borrows to buy back a large slice of its own stock or pay a special dividend, and what remains is a leveraged stub — small equity on a large business, which the market tends to misprice for a while. A Dutch-auction self-tender also gives an odd-lot holder priority. Interval-fund and BDC repurchase tenders are filtered out.</>}
        foot="SC TO-I issuer tenders, 90 days, listed non-fund issuers; 8-Ks declaring a special dividend, 150 days. Premium is the tender's top price against the live quote; for a special dividend it is the dividend as a yield. Debt-funded flags a tender or dividend whose filing mentions a term loan, notes or a credit facility.">
        {d.recaps.length === 0 && empty(cols.length, "No self-tenders or special dividends in the window.")}
        {d.recaps.map(r => {
          const key = `${r.kind}:${r.cik}`;
          const tone = r.stage === "open" || r.stage === "declared" ? GREEN : SLATE;
          return (
            <tr key={key} style={rowStyle}>
              {td(<PinBtn cat="recap" k={key} fields={{ name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: r.kind === "self-tender" ? "expiry" : "payable", date: r.expiry }] }} />, DIM, { textAlign: "left" })}
              {td(<><Dot color={tone} /><Tk t={r.ticker} /><span style={{ marginLeft: 6, color: "#cbd5e1" }}>{r.name.slice(0, 32)}</span>{r.amendments > 0 && <Pill>A×{r.amendments}</Pill>}</>, "#cbd5e1", { textAlign: "left" })}
              {td(r.type, r.type === "Dutch auction" ? AMBER : r.kind === "special dividend" ? VIOLET : SLATE, { textAlign: "left" })}
              {td(r.stage, tone, { textAlign: "left" })}
              {td(r.size || "—")}
              {td(fin(r.low) && fin(r.high) ? `$${r.low}–$${r.high}` : fin(r.high) ? px(r.high) : "—")}
              {td(<>{fd(r.expiry)}{fin(r.daysToExpiry) && r.daysToExpiry >= 0 && <span style={{ color: DIM }}> · {days(r.daysToExpiry)}</span>}</>)}
              {td(px(r.price))}
              {td(<>{pc(r.premium, 1)}{fin(r.premium) && r.premium > 15 && r.kind === "self-tender" && <Pill color={AMBER}>verify</Pill>}</>, fin(r.premium) && r.premium > 15 && r.kind === "self-tender" ? AMBER : fin(r.premium) && r.premium > 0 ? GREEN : SLATE)}
              {td(<span style={{ display: "inline-flex", gap: 4 }}><Flag on={r.debtFunded} color={AMBER}>debt-funded</Flag><Flag on={r.oddLot} color={CYAN}>odd-lot</Flag><Flag on={r.preferred} color={SLATE}>preferred</Flag><Parsed ok={r.parsed} /></span>, SLATE, { textAlign: "left" })}
              {td(<A href={r.url}>{fd(r.filed)} ↗</A>)}
            </tr>
          );
        })}
      </Board>
    );
  };

  // ── insider buying ────────────────────────────────────────────────────────
  const insider = () => {
    const cols = [["", "left"], ["Symbol", "left"], ["Cluster", "left"], ["Buyers 30d", "right"], ["$ 30d", "right"], ["Avg 30d", "right"], ["Buyers 90d", "right"], ["$ 90d", "right"], ["Who", "left"], ["Last", "right"], ["Price", "right"], ["vs avg 90d", "right"]];
    return (
      <Board cols={cols}
        intro={<>Suria ch.2–3: open-market purchases by several insiders inside a month — a cluster — carry far more signal than a lone buy, and a CEO or CFO buying carries more than a 10% holder averaging down. Size matters relative to the buyer&apos;s pay and holdings, not in dollars alone. Option exercises and plan purchases are excluded at the source.</>}
        foot={`FMP Form 4 open-market purchases (code P, priced), archived here since the first build so the 30- and 90-day windows fill in over time (${P.insider.archived} purchases in the archive). "vs avg 90d" is the live quote against the volume-weighted purchase price.`}>
        {d.insider.length === 0 && empty(cols.length, "No purchases in the archive yet.")}
        {d.insider.map(r => (
          <tr key={r.symbol} style={rowStyle}>
            {td(<PinBtn cat="insider" k={r.symbol} fields={{ name: r.symbol, ticker: r.symbol, url: null, dates: [{ label: "last buy", date: r.last }] }} />, DIM, { textAlign: "left" })}
            {td(<><Dot color={r.cluster ? GREEN : r.ceoCfo ? AMBER : SLATE} /><Tk t={r.symbol} /></>, "#cbd5e1", { textAlign: "left" })}
            {td(<span style={{ display: "inline-flex", gap: 4 }}><Flag on={r.cluster} color={GREEN}>cluster</Flag><Flag on={r.ceoCfo} color={AMBER}>CEO/CFO</Flag><Flag on={r.tenPctOnly} color={SLATE}>10% holder only</Flag></span>, SLATE, { textAlign: "left" })}
            {td(r.buyers30 || "—")}
            {td(usd(r.dollars30), r.dollars30 > 0 ? "#e2e8f0" : DIM)}
            {td(px(r.avg30))}
            {td(r.buyers90)}
            {td(usd(r.dollars90))}
            {td(<span style={{ color: SLATE }}>{r.top.map(t => `${t.name.split(" ")[0]} (${t.title.split(",")[0].replace(/officer:\s*/i, "").slice(0, 18)}) ${usd(t.usd)}`).join(" · ")}</span>, SLATE, { textAlign: "left", whiteSpace: "normal", maxWidth: 300, fontSize: 9.5 })}
            {td(fd(r.last))}
            {td(px(r.price))}
            {td(pc(r.since, 1), upGood(r.since))}
          </tr>
        ))}
      </Board>
    );
  };

  // ── activist 13Ds ─────────────────────────────────────────────────────────
  const activist = () => {
    const cols = [["", "left"], ["Company", "left"], ["Filer", "left"], ["Filed", "right"], ["Stake", "right"], ["Intent", "left"], ["Purpose (Item 4)", "left"], ["Price", "right"], ["Day", "right"], ["Filing", "right"]];
    return (
      <Board cols={cols}
        intro={<>Suria: an initial Schedule 13D is a fund telling you it owns more than 5% and intends to do something about it. Item 4 is the only part worth reading — board seats, a sale process, capital return. Amendments (13D/A) are excluded here so each row is a new campaign; affiliates and insiders filing on their own company are filtered out by name.</>}
        foot="EDGAR SCHEDULE 13D initial filings, 60 days, listed subjects, fund-like filers only. Stake and purpose parsed from the filing; where the stake did not parse, FMP's beneficial-ownership record for the same filer fills it in.">
        {d.activist.length === 0 && empty(cols.length, "No qualifying 13Ds in the window.")}
        {d.activist.map(r => {
          const key = `${r.cik}:${r.filer}`;
          return (
            <tr key={key} style={rowStyle}>
              {td(<PinBtn cat="13D" k={key} fields={{ name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: "13D filed", date: r.filed }] }} />, DIM, { textAlign: "left" })}
              {td(<><Dot color={r.board || r.strategic ? PINK : SLATE} /><Tk t={r.ticker} /><span style={{ marginLeft: 6, color: "#cbd5e1" }}>{r.name.slice(0, 30)}</span></>, "#cbd5e1", { textAlign: "left" })}
              {td(r.filer.slice(0, 36), "#cbd5e1", { textAlign: "left" })}
              {td(fd(r.filed))}
              {td(fin(r.pct) ? <>{r.pct.toFixed(1)}%{r.pctSource && <Pill>{r.pctSource}</Pill>}</> : "—")}
              {td(<span style={{ display: "inline-flex", gap: 4 }}><Flag on={r.board} color={PINK}>board</Flag><Flag on={r.strategic} color={AMBER}>strategic</Flag><Parsed ok={r.parsed} /></span>, SLATE, { textAlign: "left" })}
              {td(<span style={{ color: SLATE }}>{r.purpose ? r.purpose.slice(0, 160) + (r.purpose.length > 160 ? "…" : "") : "—"}</span>, SLATE, { textAlign: "left", whiteSpace: "normal", maxWidth: 360, fontSize: 9.5, lineHeight: 1.4 })}
              {td(px(r.price))}
              {td(pc(r.changePct, 1), upGood(r.changePct))}
              {td(<A href={r.url}>↗</A>)}
            </tr>
          );
        })}
      </Board>
    );
  };

  // ── SPACs ─────────────────────────────────────────────────────────────────
  const spacs = () => {
    const cols = [["", "left"], ["SPAC", "left"], ["Stage", "left"], ["IPO", "right"], ["Trust / unit", "right"], ["Trust now", "right"], ["Price", "right"], ["vs trust", "right"], ["Deadline", "right"], ["Months", "right"], ["Yield to trust", "right"], ["Target", "left"], ["Warrant", "left"], ["Filing", "right"]];
    const vs = v => (!fin(v) ? "—" : v >= 0 ? `${v.toFixed(1)}% below` : `${(-v).toFixed(1)}% above`);
    return (
      <Board cols={cols}
        intro={<>Suria&apos;s SPAC trade is the pre-deal vehicle below trust: a T-bill with a free option, because every public share can be redeemed for its share of the trust at the deadline or at the deal vote. The trap is holding through a de-SPAC you would not have bought. Trust per unit and the deadline come from the prospectus; until it is read they are assumed at $10.00 and 24 months, and trust accretes at an assumed 4% a year.</>}
        foot={`424B4 SPAC prospectuses, two years, SPAC-named filers only; 8-K business-combination agreements, DEFM14A votes, extension proxies and liquidation notices for the stage; ${PS.completed ?? 0} vehicles whose merger has closed are dropped. A pre-deal SPAC more than 15% below the assumed trust is flagged rather than celebrated: the trust is not $10, or the vehicle is no longer a SPAC. Common-share quotes; where the shares have not yet split from the units the unit price is shown, which includes the warrant. Yield to trust annualises the discount over the months to the assumed deadline.`}>
        {SQ.length === 0 && empty(cols.length, "No SPACs in the window.")}
        {SQ.map(r => {
          const key = String(r.cik);
          const pre = r.stage === "searching" || r.stage === "extension vote";
          const tone = r.verify ? AMBER : r.stage === "liquidating" ? RED : pre ? (fin(r.discount) && r.discount > 0 ? GREEN : SLATE) : CYAN;
          return (
            <tr key={key} style={rowStyle}>
              {td(<PinBtn cat="spac" k={key} fields={{ name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: "deadline (est.)", date: r.deadline }, { label: "vote", date: r.vote }] }} />, DIM, { textAlign: "left" })}
              {td(<><Dot color={tone} /><Tk t={r.ticker} /><span style={{ marginLeft: 6, color: "#cbd5e1" }}>{r.name.slice(0, 30)}</span></>, "#cbd5e1", { textAlign: "left" })}
              {td(r.stage, tone, { textAlign: "left" })}
              {td(fd(r.ipo))}
              {td(<>{px(r.trustIpo)}{r.trustAssumed && <Pill>assumed</Pill>}</>)}
              {td(px(r.trustNow))}
              {td(<>{px(r.price)}{r.priceOf === "unit" && <Pill color={AMBER}>unit</Pill>}</>)}
              {td(<>{vs(r.discount)}{r.verify && <Pill color={AMBER}>verify trust</Pill>}</>, r.verify ? AMBER : fin(r.discount) && r.discount > 0 ? GREEN : fin(r.discount) ? SLATE : SLATE)}
              {td(<>{fd(r.deadline)}{r.monthsAssumed && <Pill>assumed</Pill>}</>)}
              {td(fin(r.monthsLeft) ? r.monthsLeft.toFixed(1) : "—", fin(r.monthsLeft) && r.monthsLeft < 3 ? AMBER : SLATE)}
              {td(r.verify ? "—" : pc(r.yieldToTrust, 1), fin(r.yieldToTrust) && r.yieldToTrust > 0 && !r.verify ? GREEN : SLATE)}
              {td(<>{r.targetTicker ? <Tk t={r.targetTicker} color="#cbd5e1" /> : null}<span style={{ marginLeft: r.targetTicker ? 6 : 0, color: r.target ? "#cbd5e1" : DIM }}>{r.target ? r.target.slice(0, 26) : "—"}</span>{r.ev && <Pill>{r.ev}</Pill>}{r.pipe && <Pill color={CYAN}>PIPE</Pill>}</>, "#cbd5e1", { textAlign: "left" })}
              {td(<>{r.warrantTicker ? <Tk t={r.warrantTicker} color={SLATE} /> : <span style={{ color: DIM }}>—</span>}{fin(r.warrantPrice) && <span style={{ color: SLATE, marginLeft: 6 }}>{px(r.warrantPrice)}</span>}{r.warrant && <Pill>{r.warrant} / unit</Pill>}<Parsed ok={r.parsed} /></>, SLATE, { textAlign: "left" })}
              {td(<A href={r.url}>{fd(r.filings?.[0]?.date)} ↗</A>)}
            </tr>
          );
        })}
      </Board>
    );
  };

  // ── buybacks ──────────────────────────────────────────────────────────────
  const buybacks = () => {
    const cols = [["", "left"], ["Company", "left"], ["Filed", "right"], ["Authorisation", "right"], ["% of mkt cap", "right"], ["Mkt cap", "right"], ["Stated", "right"], ["Through", "right"], ["Type", "left"], ["Price", "right"], ["Day", "right"], ["Insiders, 30d", "left"], ["Filing", "right"]];
    return (
      <Board cols={cols}
        intro={<>Suria: a fresh authorisation worth five to ten percent of the market cap is a signal, and one that lands alongside insider buying is a stronger one. Announced is not executed — most programmes run for years and many never finish — so the check is the share count on the next 10-Q cover, net of stock comp.</>}
        foot="8-Ks announcing an authorised share repurchase programme, 60 days, listed operating companies, Items 8.01 / 7.01 / 2.02 / 1.01. Size parsed from the filing and set against FMP market cap (a week old at most). Insider figures are the same open-market purchases as the Insider board.">
        {BB.length === 0 && empty(cols.length, "No authorisations in the window.")}
        {BB.map(r => {
          const key = String(r.cik);
          const tone = r.verify ? AMBER : fin(r.pctCap) && r.pctCap >= 10 ? GREEN : fin(r.pctCap) && r.pctCap >= 5 ? AMBER : SLATE;
          return (
            <tr key={key} style={rowStyle}>
              {td(<PinBtn cat="buyback" k={key} fields={{ name: r.name, ticker: r.ticker, url: r.url, dates: [{ label: "through", date: r.expiry }] }} />, DIM, { textAlign: "left" })}
              {td(<><Dot color={tone} /><Tk t={r.ticker} /><span style={{ marginLeft: 6, color: "#cbd5e1" }}>{r.name.slice(0, 30)}</span></>, "#cbd5e1", { textAlign: "left" })}
              {td(fd(r.filed))}
              {td(fin(r.usd) ? usd(r.usd) : fin(r.shares) ? `${(r.shares / 1e6).toFixed(1)}M sh` : "—")}
              {td(<>{fin(r.pctCap) ? `${r.pctCap.toFixed(1)}%` : "—"}{r.verify && <Pill color={AMBER}>verify</Pill>}</>, tone)}
              {td(usd(r.mcap))}
              {td(fin(r.statedPct) ? `${r.statedPct}%` : "—")}
              {td(fd(r.expiry))}
              {td(<span style={{ display: "inline-flex", gap: 4 }}><Flag on={r.asr} color={CYAN}>ASR</Flag><Flag on={r.additional} color={SLATE}>additional</Flag><Flag on={r.debtFunded} color={AMBER}>debt-funded</Flag><Flag on={r.inEarnings} color={DIM}>in earnings 8-K</Flag><Parsed ok={r.parsed} /></span>, SLATE, { textAlign: "left" })}
              {td(px(r.price))}
              {td(pc(r.changePct, 1), upGood(r.changePct))}
              {td(r.insiders ? <span style={{ color: r.insiders.cluster ? GREEN : VIOLET }}>{r.insiders.buyers30} buyer{r.insiders.buyers30 === 1 ? "" : "s"} · {usd(r.insiders.dollars30)}{r.insiders.ceoCfo ? " · CEO/CFO" : ""}</span> : <span style={{ color: DIM }}>—</span>, SLATE, { textAlign: "left" })}
              {td(<A href={r.url}>↗</A>)}
            </tr>
          );
        })}
      </Board>
    );
  };

  // ── the Deal Book ─────────────────────────────────────────────────────────
  const dealBook = () => {
    const entries = book.entries;
    const inp = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#e2e8f0", fontFamily: fonts.mono, fontSize: 10.5, padding: "5px 7px", width: "100%", boxSizing: "border-box" };
    if (entries.length === 0) return <div style={{ ...card, ...note, padding: 18, textAlign: "center" }}>Nothing pinned yet. Press + on any board row to bring it here with its dates, a thesis box and the checklist for its situation type.</div>;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(420px, 100%), 1fr))", gap: 10 }}>
        {entries.map(e => {
          const c = CAT[e.cat] || { label: e.cat, color: SLATE };
          const live = e.ticker ? quotes[e.ticker] : null;
          const checks = CHECKLIST[e.cat] || [];
          const done = checks.filter((_, i) => e.checks?.[i]).length;
          const nextDate = (e.dates || []).filter(x => x.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date))[0];
          return (
            <div key={e.id} style={{ ...card, borderLeft: `3px solid ${c.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <Pill color={c.color} ml={0}>{c.label}</Pill>
                  <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading }}>{e.name}</span>
                  {e.ticker && <span style={{ marginLeft: 8 }}><Tk t={e.ticker} color={c.color} /></span>}
                  {fin(live) && <span style={{ marginLeft: 8, fontSize: 10.5, fontFamily: fonts.mono, color: SLATE }}>{px(live)}</span>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  {e.url && <A href={e.url}><span style={{ fontSize: 10, fontFamily: fonts.mono }}>filing ↗</span></A>}
                  <button onClick={() => persist({ ...book, entries: entries.filter(x => x.id !== e.id) })} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: DIM, borderRadius: 5, fontSize: 10, padding: "1px 6px", cursor: "pointer", fontFamily: fonts.mono }}>remove</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                {(e.dates || []).map((x, i) => <span key={i} style={{ fontSize: 9.5, fontFamily: fonts.mono, color: x === nextDate ? AMBER : SLATE, background: "rgba(255,255,255,0.03)", borderRadius: 5, padding: "2px 6px" }}>{x.label} {fd(x.date)}</span>)}
                <span style={{ ...note, marginLeft: "auto" }}>pinned {fd(e.addedAt)} · {done}/{checks.length} checked</span>
              </div>
              <textarea value={e.thesis || ""} onChange={ev => update(e.id, { thesis: ev.target.value })} placeholder="Thesis — why this is mispriced, who is the forced seller, what is the catalyst and when" rows={2} style={{ ...inp, marginTop: 8, resize: "vertical" }} />
              <div style={{ marginTop: 8 }}>
                {checks.map((q, i) => (
                  <label key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 10.5, color: e.checks?.[i] ? "#e2e8f0" : SLATE, fontFamily: fonts.mono, lineHeight: 1.45, padding: "2px 0", cursor: "pointer" }}>
                    <input type="checkbox" checked={!!e.checks?.[i]} onChange={ev => update(e.id, { checks: { ...(e.checks || {}), [i]: ev.target.checked } })} style={{ marginTop: 2, accentColor: c.color }} />
                    <span>{q}</span>
                  </label>
                ))}
              </div>
              <textarea value={e.notes || ""} onChange={ev => update(e.id, { notes: ev.target.value })} placeholder="Notes" rows={2} style={{ ...inp, marginTop: 8, resize: "vertical" }} />
            </div>
          );
        })}
      </div>
    );
  };

  const views = [
    { id: "book", label: `Deal Book${book.entries.length ? ` · ${book.entries.length}` : ""}`, render: dealBook },
    { id: "spinoffs", label: `Spinoffs · ${d.spinoffs.length}`, render: spinoffs },
    { id: "mergers", label: `Merger arb · ${d.mergers.length}`, render: mergers },
    { id: "reorg", label: `Post-reorg · ${d.reorg.length}`, render: reorg },
    { id: "rights", label: `Rights · ${d.rights.length}`, render: rights },
    { id: "recaps", label: `Recaps · ${d.recaps.length}`, render: recaps },
    { id: "insider", label: `Insider buying · ${d.insider.length}`, render: insider },
    { id: "activist", label: `13Ds · ${d.activist.length}`, render: activist },
    { id: "spacs", label: `SPACs · ${SQ.length}`, render: spacs },
    { id: "buybacks", label: `Buybacks · ${BB.length}`, render: buybacks },
  ];

  return (<>
    {header}
    <SubViews views={views} view={view || "spinoffs"} onChange={setView} accent={VIEW_ACCENT[view] || INDIGO} />
    <div style={{ marginTop: 14 }}>
      <InfoBox color={INDIGO}>
        <b>How this works.</b> {d.source} Nothing here is a recommendation: a row is a filing that matches a pattern, and the numbers next to it are what a regular expression found in that filing, checked against a live quote. The books&apos; actual method — reading the Form 10 for insider incentives, the plan for the new balance sheet, the proxy for the break price — happens in the Deal Book, which keeps your thesis, dates and the checklist for each situation type on this machine.
      </InfoBox>
    </div>
  </>);
}
