import React, { useState, useEffect, useMemo } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
import { AreaChart, ComposedChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Legend, LineChart, Line } from "recharts";
import { fonts } from "../lib/styles.js";
import { fetchFred } from "../lib/api.js";
import {
  GREEN, AMBER, RED, INDIGO, SLATE, DIM, CYAN, VIOLET, BLUE, ORANGE, PINK, TEAL,
  fin, card, label, note, tip, axis, pc, pp, money, th, td, tdL, tableStyle,
  chip, DenseHeader, Panel, Note, lastV, lastD, backV,
} from "../components/dense.jsx";

const Plot = createPlotlyComponent(Plotly);

// ============================================================================
// FISCAL — the Monthly Treasury Statement, Table 9, for where the money comes
// from and where it goes, plus the part that is actually changing: what the
// debt costs. The average coupon on outstanding Treasury debt is still well
// below current market yields, so every maturity that rolls reprices upward
// whatever Congress does. That refinancing gap is the fiscal story.
// ============================================================================

const FISCAL_BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const THIS_FY = (() => { const d = new Date(); return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear(); })();
const AVAILABLE_YEARS = Array.from({ length: 7 }, (_, i) => THIS_FY - 6 + i);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const REV_COLORS = ["#818cf8", "#6366f1", "#a78bfa", "#c084fc", "#e879f9", "#f0abfc", "#94a3b8"];
const SPEND_COLORS = ["#f87171", "#fb923c", "#fbbf24", "#facc15", "#4ade80", "#34d399",
  "#2dd4bf", "#38bdf8", "#60a5fa", "#a78bfa", "#f472b6", "#94a3b8"];

const SHORT = {
  "Social Insurance & Retirement": "Payroll / social insurance",
  "Education, Training, Employment, and Social Services": "Education & training",
  "Veterans Benefits and Services": "Veterans benefits",
  "Administration of Justice": "Justice",
  "Community and Regional Development": "Community development",
  "Natural Resources and Environment": "Natural resources",
  "General Science, Space, and Technology": "Science & space",
  "Commerce and Housing Credit": "Commerce & housing",
};
const shorten = n => SHORT[n] || n;

// Pull a whole fiscal year and keep only the latest month present, so a year
// still in progress reports its own year-to-date rather than nothing at all.
// Passing `month` pins the comparison year to the same point in its own cycle —
// without that, eleven months of FY2026 get compared to twelve of FY2025 and
// every category prints a spurious decline.
async function fetchTable9(year, month) {
  try {
    const mf = month ? `,record_calendar_month:eq:${String(month).padStart(2, "0")}` : "";
    const url = `${FISCAL_BASE}/v1/accounting/mts/mts_table_9`
      + `?filter=record_fiscal_year:eq:${year}${mf}&page[size]=2000&sort=-record_date,line_code_nbr`;
    const j = await fetch(url).then(r => r.json());
    const rows = j?.data || [];
    if (!rows.length) return { rows: [], asOf: null, month: null };
    const asOf = rows[0].record_date;
    return { rows: rows.filter(r => r.record_date === asOf), asOf, month: +rows[0].record_calendar_month };
  } catch { return { rows: [], asOf: null, month: null }; }
}

const FRED_IDS = [
  ["FYFSGDA188S", 100], ["FYFRGDA188S", 100], ["FYONGDA188S", 100], ["FYOIGDA188S", 100],
  ["A091RC1Q027SBEA", 160], ["FGRECPT", 160],
  ["GFDEGDQ188S", 120], ["GFDEBTN", 160], ["DGS10", 40],
];

function parseTable9(rows) {
  const receipts = [], outlays = [];
  if (!rows?.length) return { receipts, outlays };
  const inRange = (lc, a, b) => lc > a && lc < b;
  for (const r of rows) {
    const lc = parseInt(r.line_code_nbr, 10);
    const lvl = parseInt(r.sequence_level_nbr, 10);
    const amt = parseFloat(r.current_fytd_rcpt_outly_amt);
    const desc = r.classification_desc || "";
    if (!fin(amt) || amt <= 0) continue;
    if (inRange(lc, 10, 120) && lvl === 2) receipts.push({ name: desc, value: amt });
    else if (lc >= 140 && lc < 340 && lvl === 2
      && !/total|undistributed/i.test(desc)) outlays.push({ name: desc, value: amt });
  }
  // "Social Insurance and Retirement" is a level-2 header with no amount; its
  // level-3 children carry the money, so roll them up into one line.
  const kids = rows.filter(r => {
    const lc = parseInt(r.line_code_nbr, 10);
    return lc > 10 && lc < 120 && parseInt(r.sequence_level_nbr, 10) === 3;
  });
  if (kids.length) {
    const sum = kids.reduce((s, r) => s + (parseFloat(r.current_fytd_rcpt_outly_amt) || 0), 0);
    if (sum > 0) receipts.push({ name: "Social Insurance & Retirement", value: sum });
  }
  return { receipts: receipts.sort((a, b) => b.value - a.value), outlays: outlays.sort((a, b) => b.value - a.value) };
}

function BudgetSubTab({ fredKey }) {
  const [selectedYear, setSelectedYear] = useState(THIS_FY);
  const [cur, setCur] = useState(null);
  const [prev, setPrev] = useState(null);
  const [rates, setRates] = useState(null);
  const [f, setF] = useState(null);
  const [hist, setHist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [histRange, setHistRange] = useState("30y");

  const isDark = useMemo(() => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--page-bg").trim();
    return !bg.startsWith("#f");
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true); setCur(null); setPrev(null);
    (async () => {
      const a = await fetchTable9(selectedYear);
      if (!live) return;
      setCur(a);
      const b = await fetchTable9(selectedYear - 1, a.month || undefined);
      if (!live) return;
      setPrev(b); setLoading(false);
    })();
    return () => { live = false; };
  }, [selectedYear]);

  useEffect(() => {
    fetch(`${FISCAL_BASE}/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=40`)
      .then(r => r.json())
      .then(j => {
        const rows = j?.data || [];
        if (!rows.length) return;
        const asOf = rows[0].record_date;
        setRates({ asOf, rows: rows.filter(r => r.record_date === asOf) });
      })
      .catch(e => console.warn("Treasury avg rates:", e.message));
  }, []);

  useEffect(() => {
    if (f) return;
    (async () => {
      const out = {};
      for (let i = 0; i < FRED_IDS.length; i += 6) {
        const got = await Promise.all(FRED_IDS.slice(i, i + 6).map(async ([id, lim]) => {
          try { return [id, await fetchFred(id, fredKey, lim)]; }
          catch (e) { console.warn(`Fiscal: ${id} —`, e.message); return [id, []]; }
        }));
        got.forEach(([id, obs]) => { out[id] = obs; });
      }
      setF(out);
      const map = {};
      (out.FYFRGDA188S || []).forEach(({ d, v }) => { map[d] = { ...map[d], d, rec: v }; });
      (out.FYONGDA188S || []).forEach(({ d, v }) => { map[d] = { ...map[d], d, out: v }; });
      (out.FYFSGDA188S || []).forEach(({ d, v }) => { map[d] = { ...map[d], d, def: v }; });
      (out.FYOIGDA188S || []).forEach(({ d, v }) => { map[d] = { ...map[d], d, int: v }; });
      setHist(Object.values(map).filter(x => x.rec != null || x.out != null).sort((a, b) => a.d.localeCompare(b.d)));
    })();
  }, [fredKey, f]);

  const { receipts, outlays } = useMemo(() => parseTable9(cur?.rows), [cur]);
  const prevParsed = useMemo(() => parseTable9(prev?.rows), [prev]);
  const prevRec = useMemo(() => new Map(prevParsed.receipts.map(r => [r.name, r.value])), [prevParsed]);
  const prevOut = useMemo(() => new Map(prevParsed.outlays.map(r => [r.name, r.value])), [prevParsed]);

  const totalReceipts = receipts.reduce((s, r) => s + r.value, 0);
  const totalOutlays = outlays.reduce((s, r) => s + r.value, 0);
  const deficit = totalOutlays - totalReceipts;
  const partial = cur?.month != null && cur.month !== 9;
  const monthsIn = cur?.month != null ? ((cur.month - 10 + 12) % 12) + 1 : 12;

  const sankeyData = useMemo(() => {
    if (!receipts.length || !outlays.length) return null;
    const nRev = receipts.length, centerIdx = nRev;
    const hasDef = deficit > 1e9, defIdx = nRev + 1 + outlays.length;
    const labels = [...receipts.map(r => shorten(r.name)), "Federal\nBudget", ...outlays.map(o => shorten(o.name)), ...(hasDef ? ["Deficit\n(Borrowing)"] : [])];
    const nodeColors = [...receipts.map((_, i) => REV_COLORS[i % REV_COLORS.length]), isDark ? "#475569" : "#94a3b8",
      ...outlays.map((_, i) => SPEND_COLORS[i % SPEND_COLORS.length]), ...(hasDef ? ["#ef4444"] : [])];
    const src = [], tgt = [], val = [], col = [];
    receipts.forEach((r, i) => { src.push(i); tgt.push(centerIdx); val.push(r.value / 1e9); col.push(`${REV_COLORS[i % REV_COLORS.length]}66`); });
    if (hasDef) { src.push(defIdx); tgt.push(centerIdx); val.push(deficit / 1e9); col.push("#ef444455"); }
    outlays.forEach((o, i) => { src.push(centerIdx); tgt.push(centerIdx + 1 + i); val.push(o.value / 1e9); col.push(`${SPEND_COLORS[i % SPEND_COLORS.length]}55`); });
    return { labels, nodeColors, src, tgt, val, col };
  }, [receipts, outlays, deficit, isDark]);

  const filteredHist = useMemo(() => {
    if (!hist) return [];
    const now = new Date().getFullYear();
    const cut = histRange === "10y" ? `${now - 10}-01-01` : histRange === "30y" ? `${now - 30}-01-01` : "1900-01-01";
    return hist.filter(d => d.d >= cut);
  }, [hist, histRange]);

  // ── the debt-cost picture ──
  const interestQ = f ? lastV(f.A091RC1Q027SBEA) : null;   // $B, annualised
  const receiptsQ = f ? lastV(f.FGRECPT) : null;            // $B, annualised
  const debt = f ? lastV(f.GFDEBTN) : null;                 // $M
  const debtGdp = f ? lastV(f.GFDEGDQ188S) : null;
  const y10 = f ? lastV(f.DGS10) : null;
  const intOfRec = fin(interestQ) && fin(receiptsQ) && receiptsQ > 0 ? (interestQ / receiptsQ) * 100 : null;
  const marketable = rates?.rows?.find(r => r.security_desc === "Total Marketable");
  const avgRate = marketable ? parseFloat(marketable.avg_interest_rate_amt) : null;
  const refiGap = fin(avgRate) && fin(y10) ? y10 - avgRate : null;
  const latestDefGdp = hist?.length ? [...hist].reverse().find(d => d.def != null) : null;

  // The interest squeeze, quarterly: interest as a share of receipts, and the
  // effective rate on the whole debt (interest ÷ debt outstanding). Interest as
  // a share of GDP is on the share-of-GDP chart below, so it is not repeated.
  const squeeze = useMemo(() => {
    if (!f) return [];
    const rec = new Map((f.FGRECPT || []).map(o => [o.d, o.v]));
    const debtM = new Map((f.GFDEBTN || []).map(o => [o.d, o.v]));
    return (f.A091RC1Q027SBEA || []).map(({ d, v }) => {
      const r = rec.get(d), dm = debtM.get(d);
      return {
        d,
        intRec: fin(r) && r > 0 ? +((v / r) * 100).toFixed(1) : null,
        effRate: fin(dm) && dm > 0 ? +((v / (dm / 1000)) * 100).toFixed(2) : null,
      };
    }).filter(p => p.intRec != null);
  }, [f]);

  const rateRows = useMemo(() => {
    if (!rates?.rows) return [];
    const keep = ["Treasury Bills", "Treasury Notes", "Treasury Bonds", "Treasury Inflation-Protected Securities (TIPS)",
      "Treasury Floating Rate Notes (FRN)", "Total Marketable", "Government Account Series", "Total Interest-bearing Debt"];
    return rates.rows.filter(r => keep.includes(r.security_desc))
      .map(r => ({ desc: r.security_desc, type: r.security_type_desc, rate: parseFloat(r.avg_interest_rate_amt) }))
      .filter(r => fin(r.rate));
  }, [rates]);

  const catRow = (r, i, total, prevMap, colors) => {
    const pct = total > 0 ? (r.value / total) * 100 : 0;
    const was = prevMap.get(r.name);
    const yoy = fin(was) && was > 0 ? ((r.value - was) / was) * 100 : null;
    return (
      <tr key={r.name} style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <td style={{ padding: "3.5px 6px", fontSize: 10, fontFamily: fonts.mono, color: "var(--text-secondary)", maxWidth: 210, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: colors[i % colors.length], marginRight: 6 }} />{shorten(r.name)}
        </td>
        {td(money(r.value / 1e9), "var(--text-primary)", { fontSize: 10 })}
        {td(pc(pct, 1), DIM, { fontSize: 10 })}
        <td style={{ padding: "3.5px 6px", width: 68 }}>
          <span style={{ display: "block", height: 6, background: "var(--bg-subtle)", borderRadius: 2 }}>
            <span style={{ display: "block", height: "100%", width: `${Math.min(100, pct)}%`, background: colors[i % colors.length], borderRadius: 2, opacity: 0.85 }} />
          </span>
        </td>
        {td(fin(yoy) ? `${yoy > 0 ? "+" : "−"}${Math.abs(yoy).toFixed(1)}%` : "—", !fin(yoy) ? DIM : yoy > 0 ? AMBER : GREEN, { fontSize: 10 })}
      </tr>
    );
  };

  const yearBtn = y => ({
    padding: "4px 11px", borderRadius: 7, cursor: "pointer", fontSize: 10, fontFamily: fonts.mono,
    border: `1px solid ${selectedYear === y ? "#818cf8" : "var(--border-subtle)"}`,
    background: selectedYear === y ? "rgba(129,140,248,0.15)" : "transparent",
    color: selectedYear === y ? "#c7d2fe" : SLATE, fontWeight: selectedYear === y ? 600 : 400,
  });

  const HistHover = ({ active, label: l }) => {
    if (!active) return null;
    const r = filteredHist.find(x => x.d === l);
    if (!r) return null;
    return (
      <div style={{ ...tip, padding: "8px 10px", fontFamily: fonts.mono, color: "#cbd5e1" }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>FY{l.slice(0, 4)}</div>
        <div style={{ fontSize: 10.5, marginTop: 3 }}>receipts <span style={{ color: GREEN }}>{pc(r.rec, 1)}</span> · outlays <span style={{ color: RED }}>{pc(r.out, 1)}</span> of GDP</div>
        <div style={{ fontSize: 10.5, color: AMBER }}>deficit {pc(r.def, 1)} · interest {pc(r.int, 1)} of GDP</div>
      </div>
    );
  };

  return (
    <>
      <DenseHeader
        eyebrow={`Federal budget · MTS Table 9 · FY${selectedYear}${partial ? `, ${monthsIn} of 12 months` : ""}`}
        headline={<>
          {partial ? `Through ${MONTHS[(cur.month || 1) - 1]}, ` : ""}FY{selectedYear} has taken in {money(totalReceipts / 1e9)} and spent {money(totalOutlays / 1e9)} — a {deficit > 0 ? "deficit" : "surplus"} of {money(Math.abs(deficit) / 1e9)}
          {fin(intOfRec) ? <>, and interest alone now absorbs {pc(intOfRec, 1)} of federal receipts</> : null}
        </>}
        blurb="The arithmetic that matters is not this year's gap but the price of the existing stock. Treasury pays an average coupon well below today's market yields, so debt issued in the low-rate decade reprices upward every time it matures — a cost increase that happens automatically, with no vote."
        meta={<>
          MTS as of {cur?.asOf || "—"} · Treasury Fiscal Data<br />
          average rates as of {rates?.asOf || "—"} · % of GDP via FRED
        </>}
        chips={[
          chip("receipts", money(totalReceipts / 1e9), GREEN, partial ? `FY${selectedYear} to date` : `FY${selectedYear} full year`),
          chip("outlays", money(totalOutlays / 1e9), RED, partial ? `FY${selectedYear} to date` : `FY${selectedYear} full year`),
          chip(deficit > 0 ? "deficit" : "surplus", money(Math.abs(deficit) / 1e9), deficit > 0 ? RED : GREEN, latestDefGdp ? `${pc(Math.abs(latestDefGdp.def), 1)} of GDP in FY${latestDefGdp.d.slice(0, 4)}` : null),
          chip("net interest", fin(interestQ) ? money(interestQ) : "—", AMBER, "annualised, BEA basis"),
          chip("interest / receipts", pc(intOfRec, 1), intOfRec > 20 ? RED : AMBER, "every dollar here funds nothing"),
          chip("total public debt", fin(debt) ? money(debt / 1000) : "—", VIOLET, fin(debtGdp) ? `${pc(debtGdp, 0)} of GDP` : null),
          chip("avg rate on the debt", pc(avgRate, 2), CYAN, "marketable Treasury securities"),
          chip("refinancing gap", fin(refiGap) ? `${pp(refiGap, 2)}pp` : "—", refiGap > 0 ? RED : GREEN, `10-year is ${pc(y10, 2)}`),
        ]}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ ...note }}>Fiscal year</span>
        {AVAILABLE_YEARS.map(y => <button key={y} onClick={() => setSelectedYear(y)} style={yearBtn(y)}>FY{y}</button>)}
        {partial && <span style={{ ...note, color: AMBER }}>FY{selectedYear} runs to 30 Sep {selectedYear}; figures are year-to-date through {MONTHS[(cur.month || 1) - 1]}.</span>}
      </div>

      {loading && <div style={{ ...card, padding: 36, textAlign: "center", color: DIM, fontFamily: fonts.mono, fontSize: 11, marginBottom: 12 }}>Loading the Monthly Treasury Statement…</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(360px, 100%),1fr))", gap: 12, marginBottom: 12 }}>
        <Panel title="Where the money comes from" right={`vs FY${selectedYear - 1}${partial ? " same point" : ""}`} style={{ marginBottom: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead><tr>{th("source", "left")}{th("amount")}{th("share")}{th("")}{th("yoy")}</tr></thead>
              <tbody>
                {receipts.map((r, i) => catRow(r, i, totalReceipts, prevRec, REV_COLORS))}
                <tr style={{ borderTop: "1.5px solid var(--text-muted)" }}>
                  {tdL("Total receipts", "var(--text-primary)", { fontWeight: 700, fontSize: 10 })}
                  {td(money(totalReceipts / 1e9), GREEN, { fontWeight: 700, fontSize: 10 })}
                  {td("100%", DIM, { fontSize: 10 })}{td("", DIM)}
                  {td(prevParsed.receipts.length ? `${totalReceipts > prevParsed.receipts.reduce((s, r) => s + r.value, 0) ? "+" : "−"}${Math.abs(((totalReceipts / prevParsed.receipts.reduce((s, r) => s + r.value, 0)) - 1) * 100).toFixed(1)}%` : "—", SLATE, { fontSize: 10, fontWeight: 700 })}
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Where it goes" right="by budget function" style={{ marginBottom: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead><tr>{th("function", "left")}{th("amount")}{th("share")}{th("")}{th("yoy")}</tr></thead>
              <tbody>
                {outlays.map((r, i) => catRow(r, i, totalOutlays, prevOut, SPEND_COLORS))}
                <tr style={{ borderTop: "1.5px solid var(--text-muted)" }}>
                  {tdL("Total outlays", "var(--text-primary)", { fontWeight: 700, fontSize: 10 })}
                  {td(money(totalOutlays / 1e9), RED, { fontWeight: 700, fontSize: 10 })}
                  {td("100%", DIM, { fontSize: 10 })}{td("", DIM)}
                  {td(prevParsed.outlays.length ? `${totalOutlays > prevParsed.outlays.reduce((s, r) => s + r.value, 0) ? "+" : "−"}${Math.abs(((totalOutlays / prevParsed.outlays.reduce((s, r) => s + r.value, 0)) - 1) * 100).toFixed(1)}%` : "—", SLATE, { fontSize: 10, fontWeight: 700 })}
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="What the debt costs — and what it will cost" right={`average interest rates as of ${rates?.asOf || "—"}`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(300px, 100%),1fr))", gap: 14 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead><tr>{th("security", "left")}{th("avg rate paid")}{th("market yield")}{th("gap on refi")}</tr></thead>
              <tbody>
                {rateRows.map(r => (
                    <tr key={r.desc} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                      {tdL(r.desc.replace("Treasury ", "").replace(" (TIPS)", ""), /Total/.test(r.desc) ? "var(--text-primary)" : "var(--text-secondary)", { fontSize: 10, fontWeight: /Total/.test(r.desc) ? 700 : 400 })}
                      {td(pc(r.rate, 2), /Total/.test(r.desc) ? CYAN : "var(--text-secondary)", { fontSize: 10, fontWeight: /Total/.test(r.desc) ? 700 : 400 })}
                      {td(r.desc === "Total Marketable" ? pc(y10, 2) : "—", DIM, { fontSize: 10 })}
                      {td(r.desc === "Total Marketable" && fin(refiGap) ? `${pp(refiGap, 2)}pp` : "—", r.desc === "Total Marketable" ? (refiGap > 0 ? RED : GREEN) : DIM, { fontSize: 10, fontWeight: 600 })}
                    </tr>
                ))}
              </tbody>
            </table>
            <Note>
              Treasury still pays {pc(avgRate, 2)} on its marketable debt while the ten-year trades at {pc(y10, 2)}. Nothing has to change for interest expense to keep climbing — the gap closes on its own as the low-coupon stock matures and is reissued at today's rates.
            </Note>
          </div>

          <div>
            <ResponsiveContainer width="100%" height={196}>
              <ComposedChart data={squeeze} margin={{ top: 6, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={36} />
                <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={tip} labelStyle={{ color: "var(--text-primary)", fontFamily: fonts.mono }} itemStyle={{ fontFamily: fonts.mono }} labelFormatter={d => d.slice(0, 7)}
                  formatter={(v, n) => [pc(v, n === "intRec" ? 1 : 2), n === "intRec" ? "interest, % of receipts" : "effective rate on the debt"]} />
                <Area yAxisId="l" type="monotone" dataKey="intRec" name="intRec" stroke={AMBER} fill={AMBER} fillOpacity={0.15} strokeWidth={2} dot={false} />
                <Line yAxisId="r" type="monotone" dataKey="effRate" name="effRate" stroke={CYAN} strokeWidth={1.4} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <Note>
              The squeeze: interest as a share of federal receipts (amber, left) and the effective rate on the whole debt, interest ÷ debt
              outstanding (cyan, right). The effective rate keeps rising as 1–2% debt matures into today's coupons, so the interest share
              climbs even if yields go nowhere. Interest as a share of GDP is on the long-run chart below.
            </Note>
          </div>
        </div>
      </Panel>

      {sankeyData && (
        <Panel title={`FY${selectedYear} budget flow — every dollar in, every dollar out`} right="$ billions" pad="10px 12px 2px">
          <Plot
            data={[{
              type: "sankey", orientation: "h",
              node: {
                pad: 14, thickness: 18, line: { color: "rgba(0,0,0,0)", width: 0 },
                label: sankeyData.labels, color: sankeyData.nodeColors,
                hovertemplate: "<b>%{label}</b><br>$%{value:.1f}B<extra></extra>",
              },
              link: {
                source: sankeyData.src, target: sankeyData.tgt, value: sankeyData.val, color: sankeyData.col,
                hovertemplate: "%{source.label} → %{target.label}<br><b>$%{value:.1f}B</b><extra></extra>",
              },
            }]}
            layout={{
              height: 580, margin: { t: 8, b: 8, l: 8, r: 8 },
              paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
              font: { family: fonts.heading, size: 10, color: isDark ? "#94a3b8" : "#64748b" },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </Panel>
      )}

      {filteredHist.length > 0 && (
        <Panel
          title="Receipts, outlays and the gap — share of GDP"
          right={
            <span style={{ display: "inline-flex", gap: 4 }}>
              {["10y", "30y", "max"].map(r => (
                <button key={r} onClick={() => setHistRange(r)} style={{
                  padding: "2px 8px", borderRadius: 5, cursor: "pointer", fontSize: 9, fontFamily: fonts.mono,
                  border: `1px solid ${histRange === r ? "#818cf8" : "var(--border-subtle)"}`,
                  background: histRange === r ? "rgba(129,140,248,0.15)" : "transparent",
                  color: histRange === r ? "#c7d2fe" : SLATE,
                }}>{r.toUpperCase()}</button>
              ))}
            </span>
          }
        >
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={filteredHist} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="b-rec" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={GREEN} stopOpacity={0.2} /><stop offset="95%" stopColor={GREEN} stopOpacity={0} /></linearGradient>
                <linearGradient id="b-out" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={RED} stopOpacity={0.2} /><stop offset="95%" stopColor={RED} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="d" tick={axis} axisLine={{ stroke: "var(--border-subtle)" }} tickLine={false} tickFormatter={d => d.slice(0, 4)} minTickGap={36} />
              <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(0)}%`} />
              <Tooltip content={<HistHover />} />
              <Legend wrapperStyle={{ fontSize: 9.5, fontFamily: fonts.mono, paddingTop: 4 }} iconType="circle" iconSize={6} />
              <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="rec" name="Receipts" stroke={GREEN} fill="url(#b-rec)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="out" name="Outlays" stroke={RED} fill="url(#b-out)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="def" name="Surplus / deficit" stroke={AMBER} fill="none" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
              <Area type="monotone" dataKey="int" name="Interest" stroke={VIOLET} fill="none" strokeWidth={1.4} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <Note>
            Receipts have sat in a narrow 16–19% band through wildly different tax codes — the denominator moves more than the policy does. Outlays are where the variance lives, and the deficit line is simply the distance between the two.
          </Note>
        </Panel>
      )}
    </>
  );
}

export default BudgetSubTab;
