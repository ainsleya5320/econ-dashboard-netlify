import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ReferenceLine, LabelList, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { fonts, cardBg, cardBorder } from "../../lib/styles.js";
import { InfoBox } from "../../components/shared.jsx";
import SubViews from "../../components/SubViews.jsx";

// ============================================================================
// OWNER WEALTH — "The Everywhere Millionaire" tested against public data.
//   Everywhere   each state's share of million-dollar filers against its share
//                of all filers. The book's claim is that this wealth tracks
//                population; the public data says the count does not, but the
//                composition does.
//   Composition  what share of a state's $1M+ filers have partnership or
//                S-corp income — owners rather than employees.
//   Home state   the county ladder, which is the finest public geography and
//                the one that answers "how many are within driving distance".
//   Live & book  quarterly BEA proprietors' income by state, and the authors'
//                own top-wealth-share series for contrast.
// Data: /api/owner-wealth (server/ownerWealth.js).
// ============================================================================

const GREEN = "#4ade80", AMBER = "#fbbf24", RED = "#f87171", INDIGO = "#818cf8", SLATE = "#94a3b8", DIM = "#475569", CYAN = "#22d3ee", VIOLET = "#a78bfa";
const fin = v => v != null && isFinite(v);
const card = { background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 14px" };
const label = { fontSize: 10, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };
const note = { fontSize: 9.5, color: DIM, fontFamily: fonts.mono, lineHeight: 1.5 };
const tip = { background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 };
const axis = { fontSize: 9, fill: "#64748b", fontFamily: fonts.mono };
const n0 = v => (fin(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—");
const pct = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : "—");
const bn = v => (!fin(v) ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
const th = (t, a = "right") => <th key={t} style={{ padding: "5px 6px", fontSize: 8.5, color: DIM, fontFamily: fonts.mono, textTransform: "uppercase", letterSpacing: 0.4, textAlign: a, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" }}>{t}</th>;
const td = (v, color = "#cbd5e1", extra = {}) => <td style={{ padding: "4px 6px", fontSize: 10.5, fontFamily: fonts.mono, textAlign: "right", whiteSpace: "nowrap", color, ...extra }}>{v}</td>;
const rowStyle = { borderBottom: "1px solid rgba(255,255,255,0.04)" };
const chip = (k, v, color = "#e2e8f0", sub) => (
  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, minWidth: 104 }}>
    <span style={{ ...label, fontSize: 8.5 }}>{k}</span><span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: fonts.heading, letterSpacing: -0.3 }}>{v}</span>{sub && <span style={{ ...note, fontSize: 8.5 }}>{sub}</span>}
  </div>
);
// a 0–100 bar with the home state marked
const Bar = ({ v, max, color, home }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <div style={{ flex: 1, minWidth: 60, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
      <div style={{ width: `${Math.max(1, Math.min(100, (v / max) * 100))}%`, height: "100%", background: color, borderRadius: 2, opacity: home ? 1 : 0.65 }} />
    </div>
    <span style={{ width: 44, textAlign: "right", color: home ? "#e2e8f0" : SLATE, fontWeight: home ? 700 : 400 }}>{pct(v)}</span>
  </div>
);

export default function OwnerWealthPanel() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState("everywhere");
  useEffect(() => { fetch("/api/owner-wealth").then(r => r.json()).then(x => (x.error ? setErr(x.error) : setD(x))).catch(e => setErr(String(e))); }, []);

  const states = useMemo(() => d?.states || [], [d]);
  if (err) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: SLATE, fontFamily: fonts.mono }}>Owner wealth could not load: {err}</div>;
  if (!d) return <div style={{ ...card, marginBottom: 12, fontSize: 11, color: "#64748b", fontFamily: fonts.mono }}>Loading IRS SOI state and county files (about 40 MB the first time, then kept permanently — a filed tax year does not change)…</div>;

  const H = d.home, N = d.national, C = d.counties;
  const byPship = [...states].sort((a, b) => b.pshipShare - a.pshipShare);
  const maxPship = byPship[0]?.pshipShare || 100;
  const homeRank = byPship.findIndex(s => s.st === d.homeState) + 1;

  // ── the everywhere test ───────────────────────────────────────────────────
  const everywhere = () => {
    const pts = states.map(s => ({ st: s.st, x: s.shareOfAll, y: s.shareOfTop, index: s.index, home: s.st === d.homeState }));
    const max = Math.max(...pts.map(p => Math.max(p.x, p.y))) * 1.08;
    const ranked = [...states].sort((a, b) => b.index - a.index);
    // a scatter tooltip driven by `formatter` renders an empty box, because the
    // payload carries no named series — so build the contents directly
    const Hover = ({ active, payload }) => {
      const p = active && payload?.length ? payload[0].payload : null;
      const s = p ? states.find(x => x.st === p.st) : null;
      if (!s) return null;
      return (
        <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
          <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>{s.st}
            <span style={{ color: s.index >= 1 ? GREEN : AMBER, marginLeft: 8 }}>{s.index.toFixed(2)}× its share of filers</span>
          </div>
          <div style={{ fontSize: 10.5, marginTop: 3 }}>{n0(s.topReturns)} returns at $1M or more</div>
          <div style={{ fontSize: 10.5 }}>{pct(s.shareOfTop, 2)} of the nation&apos;s million-dollar filers</div>
          <div style={{ fontSize: 10.5 }}>{pct(s.shareOfAll, 2)} of all filers · {s.perThousand} per 1,000</div>
          <div style={{ fontSize: 10.5, color: VIOLET, marginTop: 3 }}>{pct(s.pshipShare)} of them own the business</div>
        </div>
      );
    };
    return (<>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12 }}>
        <div style={{ ...card, padding: "10px 10px 4px" }}>
          <div style={{ ...label, paddingLeft: 4 }}>Share of $1M+ filers vs share of all filers · tax year {d.taxYear}</div>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 14, right: 16, bottom: 6, left: -12 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" dataKey="x" domain={[0, max]} tick={axis} tickFormatter={v => `${v.toFixed(0)}%`} label={{ value: "share of all filers", position: "insideBottom", offset: -3, fontSize: 9, fill: "#64748b" }} />
              <YAxis type="number" dataKey="y" domain={[0, max]} tick={axis} tickFormatter={v => `${v.toFixed(0)}%`} label={{ value: "share of $1M+ filers", angle: -90, position: "insideLeft", offset: 20, fontSize: 9, fill: "#64748b" }} />
              <ZAxis range={[36, 36]} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 3" />
              <Tooltip cursor={false} content={<Hover />} />
              <Scatter data={pts.filter(p => !p.home)} fill={INDIGO} />
              <Scatter data={pts.filter(p => p.home)} fill={AMBER}><LabelList dataKey="st" position="right" style={{ fontSize: 10, fill: AMBER, fontFamily: fonts.mono, fontWeight: 700 }} /></Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div style={{ ...note, padding: "0 4px 4px" }}>On the dashed line a state has exactly its population&apos;s worth of million-dollar filers. Above it, more; below, fewer. The spread runs {ranked[ranked.length - 1].index}× to {ranked[0].index}×, so the count is <em>not</em> proportional — the book&apos;s &quot;everywhere&quot; claim is about the kind of wealth, not its density.</div>
        </div>
        <div style={{ ...card, padding: "10px 10px 6px" }}>
          <div style={{ ...label, paddingLeft: 4, marginBottom: 4 }}>Concentration index · 1.00 = exactly its share of filers</div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{[["State", "left"], ["$1M+ returns", "right"], ["per 1,000 filers", "right"], ["Index", "right"]].map(([t, a]) => th(t, a))}</tr></thead>
              <tbody>
                {ranked.map(s => {
                  const home = s.st === d.homeState;
                  return (
                    <tr key={s.st} style={{ ...rowStyle, background: home ? "rgba(251,191,36,0.07)" : undefined }}>
                      {td(<span style={{ fontWeight: home ? 700 : 400, color: home ? AMBER : "#cbd5e1" }}>{s.st}</span>, "#cbd5e1", { textAlign: "left" })}
                      {td(n0(s.topReturns))}
                      {td(s.perThousand)}
                      {td(s.index.toFixed(2), s.index >= 1.2 ? GREEN : s.index < 0.6 ? RED : SLATE)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>);
  };

  // ── composition ───────────────────────────────────────────────────────────
  const composition = () => (
    <div style={{ ...card, padding: "10px 10px 6px" }}>
      <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, lineHeight: 1.55, padding: "2px 4px 8px" }}>
        This is where the book&apos;s argument survives contact with public data. In the states with the <em>fewest</em> million-dollar filers, a far higher share of the ones that exist are business owners. {byPship[0].st} {pct(byPship[0].pshipShare)}, {byPship[1].st} {pct(byPship[1].pshipShare)}, {byPship[2].st} {pct(byPship[2].pshipShare)} — against {d.homeState} at {pct(H.pshipShare)}, {homeRank}th of {states.length}. Coastal millionaires are disproportionately employees; everywhere else they own the business.
      </div>
      <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{[["State", "left"], ["$1M+ returns", "right"], ["With pass-through", "right"], ["Share that are owners", "left"], ["Pass-through $", "right"], ["Wages", "right"], ["P'ship/S-corp", "right"], ["Cap gains", "right"]].map(([t, a]) => th(t, a))}</tr></thead>
          <tbody>
            {byPship.map(s => {
              const home = s.st === d.homeState;
              return (
                <tr key={s.st} style={{ ...rowStyle, background: home ? "rgba(251,191,36,0.07)" : undefined }}>
                  {td(<span style={{ fontWeight: home ? 700 : 400, color: home ? AMBER : "#cbd5e1" }}>{s.st}</span>, "#cbd5e1", { textAlign: "left" })}
                  {td(n0(s.topReturns))}
                  {td(n0(s.pshipReturns))}
                  {td(<Bar v={s.pshipShare} max={maxPship} color={home ? AMBER : VIOLET} home={home} />, "#cbd5e1", { textAlign: "left", minWidth: 130 })}
                  {td(bn(s.pshipAmt))}
                  {td(pct(s.mix?.wages, 0), SLATE)}
                  {td(pct(s.mix?.pship, 0), SLATE)}
                  {td(pct(s.mix?.capgain, 0), SLATE)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ ...note, padding: "6px 4px 2px" }}>&quot;With pass-through&quot; counts returns reporting partnership or S-corporation net income (SOI line 26270). The last three columns split the bracket&apos;s total income. IRS SOI Historic Table 2, tax year {d.taxYear}.</div>
    </div>
  );

  // ── home state ────────────────────────────────────────────────────────────
  const homeView = () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(400px, 100%), 1fr))", gap: 12 }}>
      <div style={{ ...card, padding: "10px 10px 6px" }}>
        <div style={{ ...label, paddingLeft: 4, marginBottom: 6 }}>{d.homeState} counties · filers with AGI {C?.stubLabel || "in the top bracket"}</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{[["County", "left"], ["Returns", "right"], ["Share of state", "right"], ["Per 1,000 filers", "right"], ["With pass-through", "right"], ["%", "right"]].map(([t, a]) => th(t, a))}</tr></thead>
            <tbody>
              {(C?.home || []).slice(0, 20).map(c => (
                <tr key={c.fips} style={rowStyle}>
                  {td(c.name, "#cbd5e1", { textAlign: "left" })}
                  {td(n0(c.returns))}
                  {td(pct(c.shareOfState))}
                  {td(c.perThousand ?? "—")}
                  {td(n0(c.pshipReturns))}
                  {td(pct(c.pshipShare), c.pshipShare > 25 ? GREEN : SLATE)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...note, padding: "6px 4px 2px" }}>County data tops out at {C?.stubLabel} rather than $1M — the finest public geography. {C ? `${n0(C.homeTotal)} such filers statewide.` : ""} Note how the owner share rises as you leave King County: the salaried-millionaire effect is a Seattle phenomenon, not a Washington one.</div>
      </div>
      <div style={{ ...card, padding: "10px 10px 6px" }}>
        <div style={{ ...label, paddingLeft: 4, marginBottom: 6 }}>{d.homeState} income ladder · every AGI bracket, tax year {d.taxYear}</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{[["Bracket", "left"], ["Returns", "right"], ["AGI", "right"], ["With p'ship/S-corp", "right"], ["Pass-through $", "right"]].map(([t, a]) => th(t, a))}</tr></thead>
            <tbody>
              {(H?.ladder || []).filter(l => l.returns > 0).map(l => {
                const top = l.stub === 10;
                return (
                  <tr key={l.stub} style={{ ...rowStyle, background: top ? "rgba(74,222,128,0.07)" : undefined }}>
                    {td(<span style={{ fontWeight: top ? 700 : 400, color: top ? GREEN : "#cbd5e1" }}>{l.label}</span>, "#cbd5e1", { textAlign: "left" })}
                    {td(n0(l.returns))}
                    {td(bn(l.agi))}
                    {td(n0(l.pshipN))}
                    {td(bn(l.pship))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ ...note, padding: "6px 4px 2px" }}>The $1M+ row is the book&apos;s population: {n0(H?.topReturns)} returns in {d.homeState}, {n0(H?.pshipReturns)} of them reporting pass-through income.</div>
      </div>
    </div>
  );

  // ── live and book ─────────────────────────────────────────────────────────
  const liveView = () => {
    const w = d.wealthShares;
    const byProp = states.filter(s => s.proprietors).sort((a, b) => b.proprietors.yoy - a.proprietors.yoy);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 12 }}>
        <div style={{ ...card, padding: "10px 10px 6px" }}>
          <div style={{ ...label, paddingLeft: 4, marginBottom: 6 }}>Proprietors&apos; nonfarm income by state · quarterly, current</div>
          <div style={{ maxHeight: 330, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{[["State", "left"], ["Latest", "right"], ["YoY", "right"], ["Share of US", "right"]].map(([t, a]) => th(t, a))}</tr></thead>
              <tbody>
                {byProp.map(s => {
                  const home = s.st === d.homeState, p = s.proprietors;
                  return (
                    <tr key={s.st} style={{ ...rowStyle, background: home ? "rgba(251,191,36,0.07)" : undefined }}>
                      {td(<span style={{ fontWeight: home ? 700 : 400, color: home ? AMBER : "#cbd5e1" }}>{s.st}</span>, "#cbd5e1", { textAlign: "left" })}
                      {td(bn(p.v * 1e6))}
                      {td(pct(p.yoy), p.yoy > 3 ? GREEN : p.yoy < 0 ? RED : SLATE)}
                      {td(pct(p.shareOfUs, 2))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ ...note, padding: "6px 4px 2px" }}>BEA via FRED ({"{"}state{"}"}ONON), as of {N.proprietorsAsOf}. This is the only layer here that is current — SOI runs two to three years behind, so this is what tells you whether the owner economy is growing right now.</div>
        </div>
        <div style={{ ...card, padding: "10px 10px 4px" }}>
          <div style={{ ...label, paddingLeft: 4 }}>The authors&apos; own estimates · top wealth shares</div>
          {w ? (<>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={w.rows} margin={{ top: 12, right: 12, left: -12, bottom: 4 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="year" tick={axis} />
                <YAxis tick={axis} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={tip} labelStyle={{ color: "#e2e8f0", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} formatter={(v, n) => [pct(v), n]} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: fonts.mono }} />
                <Line type="monotone" dataKey="top1" name="Top 1%" stroke={INDIGO} strokeWidth={1.8} dot={false} />
                <Line type="monotone" dataKey="top01" name="Top 0.1%" stroke={CYAN} strokeWidth={1.6} dot={false} />
                <Line type="monotone" dataKey="top001" name="Top 0.01%" stroke={VIOLET} strokeWidth={1.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ ...note, padding: "0 4px 4px" }}>{w.source}. National only, and it ends where the paper ends — the restricted microdata behind it is not obtainable. Shown so the gap between the free proxies above and the estimates the book actually rests on is visible rather than implied.</div>
          </>) : <div style={{ ...note, padding: 14 }}>The authors&apos; supplemental workbook could not be read this build.</div>}
        </div>
      </div>
    );
  };

  const views = [
    { id: "everywhere", label: "The everywhere test", render: everywhere },
    { id: "composition", label: "Owners vs employees", render: composition },
    { id: "home", label: `${d.homeState} close-up`, render: homeView },
    { id: "live", label: "Live & the book", render: liveView },
  ];

  return (<>
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={label}>Where private business wealth actually is · public data only</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", fontFamily: fonts.heading, letterSpacing: -0.3, marginTop: 3 }}>
            {pct(N.pshipShare)} of America&apos;s {n0(N.topReturns)} million-dollar filers report pass-through income — in {d.homeState}, {pct(H?.pshipShare)}
          </div>
          <div style={{ fontSize: 10.5, color: SLATE, fontFamily: fonts.mono, marginTop: 4, lineHeight: 1.5, maxWidth: 940 }}>
            Zidar and Zwick&apos;s argument rests on IRS microdata linking businesses to their owners, which nobody outside Treasury can obtain. These are the public substitutes, and they get further than they are usually given credit for: they cannot value a firm, but they can count how many high-income filers in a given county report partnership or S-corporation income.
          </div>
        </div>
        <div style={{ ...note, textAlign: "right" }}>
          SOI tax year {d.taxYear} · built {new Date(d.built).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}<br />
          tax-year files are fetched once and kept — a filed year does not change
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {chip(`${d.homeState} · $1M+ filers`, n0(H?.topReturns), AMBER, `${pct(H?.shareOfTop, 2)} of US · index ${H?.index}`)}
        {chip(`${d.homeState} · owners among them`, n0(H?.pshipReturns), VIOLET, `${pct(H?.pshipShare)} — ${homeRank}th of ${states.length}`)}
        {chip("US $1M+ filers", n0(N.topReturns), "#e2e8f0", `${N.topPerThousand} per 1,000 filers`)}
        {C && chip(`${C.home[0]?.name} County`, n0(C.home[0]?.returns), GREEN, `${pct(C.home[0]?.shareOfState)} of state's ${C.stubLabel}`)}
        {H?.proprietors && chip(`${d.homeState} proprietors' income`, bn(H.proprietors.v * 1e6), H.proprietors.yoy > 0 ? GREEN : RED, `${pct(H.proprietors.yoy)} yoy · ${H.proprietors.d}`)}
      </div>
    </div>

    <SubViews views={views} view={view} onChange={setView} accent={{ everywhere: INDIGO, composition: VIOLET, home: AMBER, live: GREEN }[view] || INDIGO} />

    <div style={{ marginTop: 14 }}>
      <InfoBox color={INDIGO}>
        <strong style={{ color: "#cbd5e1" }}>What this can and cannot tell you.</strong> It counts filers and their income types by geography. It cannot value a private business, link an owner to a firm, or reproduce the wealth estimates the book reports — that requires restricted Treasury microdata, which is the whole reason the book is interesting. Two findings survive the translation to public data, and they pull in opposite directions: million-dollar filers are <em>not</em> spread proportionally (the concentration index runs {Math.min(...states.map(s => s.index)).toFixed(2)}× to {Math.max(...states.map(s => s.index)).toFixed(2)}×), but the <em>kind</em> of wealth is — the states with the fewest millionaires have by far the highest share of them owning the business. {d.source}
      </InfoBox>
    </div>
  </>);
}
