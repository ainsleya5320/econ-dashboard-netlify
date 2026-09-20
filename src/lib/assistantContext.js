// ============================================================================
// ASSISTANT CONTEXT — the dashboard's own verdicts, as text for the chat model
// The Cockpit and the theme tabs already compute one-word verdicts from live
// data (regime, valuation lenses, the AI chain, profits, credit, housing).
// This module re-derives them with the SAME exported functions the tabs use
// and renders a compact block that ChatDrawer appends to every request, so
// the assistant can discuss what's actually on screen instead of guessing.
// Everything comes from server-cached endpoints; a failed feed just drops
// its line. Cached for 5 minutes so chatting doesn't re-pull the world.
// ============================================================================
import { computeRegime, damodaranSummary } from "../tabs/OverviewTab.jsx";
import { chainModel, chainVerdicts, chainHeadline } from "../tabs/AIEconomyTab.jsx";
import { fvTone } from "../components/MarketFairValue.jsx";

const fin = v => v != null && isFinite(v);
const pct = (v, dp = 2) => (fin(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%` : "n/a");
const num = (v, dp = 2) => (fin(v) ? v.toFixed(dp) : "n/a");
const tok = n => (!fin(n) ? "n/a" : n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(0)}B` : `${(n / 1e6).toFixed(0)}M`);
const firstClause = s => (s || "").split(/ — |\. /)[0];
const ord = n => (!fin(n) ? "n/a" : `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`);

const FEEDS = {
  summary: "/api/dashboard-summary", erp: "/api/erp", ms: "/api/ms-fair-value", fg: "/api/fear-greed",
  kalecki: "/api/kalecki", debt: "/api/debt-market", bank: "/api/bank-credit", housing: "/api/housing-health",
  or: "/api/or-rankings-history", ornn: "/api/ornn", semi: "/api/semi-h100", mem: "/api/memory",
  reComp: "/api/re-composite", rePipe: "/api/re-pipeline", redfin: "/api/redfin", creCredit: "/api/cre-credit", pulse: "/api/us-pulse", intl: "/api/intl-pulse", machine: "/api/machine", dam: "/api/damodaran-erp", commod: "/api/commodity-pulse", ai: "/api/ai-pulse", sfc: "/api/sfc", bk: "/api/bankruptcy", sea: "/api/municipality/seattle", sf: "/api/municipality/sf", austin: "/api/municipality/austin", nyc: "/api/municipality/nyc",
};

let cache = { text: "", ts: 0 };
const TTL = 5 * 60 * 1000;

async function getJson(url) {
  try { const r = await fetch(url); if (!r.ok) return null; const d = await r.json(); return d && !d.error ? d : null; } catch { return null; }
}

export function buildVerdictText(d) {
  const L = ["=== Dashboard verdicts (computed live by the app — cite these when relevant) ==="];
  const asOf = d.summary?.asOf ? new Date(d.summary.asOf).toLocaleString() : null;
  if (asOf) L.push(`Snapshot time: ${asOf}`);

  // Cockpit — regime + tape
  const reg = d.summary ? computeRegime(d.summary.indexes || [], d.summary.commodities || [], d.summary.crypto || []) : null;
  if (reg) {
    L.push(`Cockpit regime: ${reg.regime} — SPY ${pct(reg.spyChg)} at $${num(reg.spy.price)}; ${reg.upCount}/${reg.n} major indexes up; VIX ${pct(reg.vixChg, 1)}; read: ${reg.note}.`);
    L.push(`Cross-asset today: ${reg.rows.map(r => `${r.label} ${pct(r.chg)}`).join(", ")}.`);
  }

  // Valuation lenses
  const lens = [];
  if (d.erp && fin(d.erp.currentErp)) lens.push(`simple ERP ${d.erp.currentErp >= 0 ? "+" : ""}${num(d.erp.currentErp)}pp ("${d.erp.verdict}", ${ord(d.erp.percentile)} pct of 25y; earnings yield ${num(d.erp.earningsYield)}% vs 10Y ${num(d.erp.tenYear)}%)`);
  const dam = damodaranSummary();
  if (d.dam && fin(d.dam.erp) && dam) { const p = Math.round((dam.series.filter(r => r.erp < d.dam.erp).length / dam.series.length) * 100); lens.push(`Damodaran implied ERP ${(d.dam.erp * 100).toFixed(2)}% as of ${d.dam.asOf} (his monthly update; ${ord(p)} pct of the annual series since ${dam.series[0].y}; vs 10Y ${fin(d.dam.tbond) ? `${(d.dam.tbond * 100).toFixed(2)}%` : 'n/a'}; end-${dam.last.y} annual print ${(dam.last.erp * 100).toFixed(2)}%)`); }
  else if (dam) lens.push(`Damodaran implied ERP ${(dam.last.erp * 100).toFixed(2)}% (${ord(dam.pct)} pct since ${dam.series[0].y}, end-${dam.last.y})`);
  if (d.ms?.available) lens.push(`Morningstar bottom-up fair value: market ${Math.abs(d.ms.latest * 100).toFixed(1)}% ${d.ms.latest < 0 ? "undervalued" : "overvalued"} (median price/fair value across ~1,500 covered stocks; cheaper than ${d.ms.cheaperThan}% of days since ${String(d.ms.start).slice(0, 4)}; tone ${fvTone(d.ms.cheaperThan).label}; as of ${d.ms.asOf})`);
  if (lens.length) L.push(`Valuation lenses: ${lens.join("; ")}.`);

  // Rates + sentiment
  const rates = d.summary?.rates || [];
  const rv = id => rates.find(r => r.id === id)?.value;
  const rlist = [["Fed funds", "DFF"], ["2Y", "DGS2"], ["10Y", "DGS10"], ["30Y", "DGS30"], ["30Y mortgage", "MORTGAGE30US"]].filter(([, id]) => fin(rv(id))).map(([l, id]) => `${l} ${num(rv(id))}%`);
  const sp = rv("spread2s10s");
  if (rlist.length) L.push(`Rates: ${rlist.join(", ")}${fin(sp) ? `; 2s10s ${sp >= 0 ? "+" : ""}${sp.toFixed(0)}bp (${sp < 0 ? "inverted" : "un-inverted"})` : ""}.`);
  if (d.fg && fin(d.fg.composite)) {
    const s = d.fg.composite;
    const zone = s < 25 ? "Extreme Fear" : s < 45 ? "Fear" : s < 55 ? "Neutral" : s < 75 ? "Greed" : "Extreme Greed";
    const comp = k => { const v = d.fg.components?.[k]; return v == null ? null : Math.round(typeof v === "number" ? v : v.score); };
    L.push(`Fear & Greed: ${Math.round(s)} (${zone}) — VIX ${comp("vix") ?? "n/a"}, momentum ${comp("momentum") ?? "n/a"}, safe haven ${comp("safeHaven") ?? "n/a"}, junk demand ${comp("junkBond") ?? "n/a"}, breadth ${comp("breadth") ?? "n/a"}.`);
  }

  // AI chain
  if (d.or || d.ornn || d.semi || d.mem) {
    const c = chainModel(d.or, d.ornn, d.semi, d.mem);
    const v = chainVerdicts(c);
    const h = chainHeadline(c);
    L.push(`AI chain (AI Economy tab) headline: ${h.label}${h.why ? ` — ${h.why}` : ""}.`);
    L.push(`  Stage 1 Token demand: ${v.vDemand[0]} — ${tok(c.wkLast?.v)} API tokens/wk (OpenRouter sample), 13-week ${pct(c.demand13, 0)}.`);
    L.push(`  Link A realized $/M tokens (big-4 avg): ${c.otpiNow ? `$${c.otpiNow.v.toFixed(2)} (30d ${pct(c.otpiChg, 1)})` : "n/a"}.`);
    L.push(`  Stage 2 Models & labs: ${v.vLabs[0]} — disclosed AI revenue run-rates sum $${c.arrTotal.toFixed(0)}B; revenue-per-GW wedge ${c.wedge.latestRev ? `latest $${c.wedge.latestRev.rev.toFixed(0)}M/MW/yr vs $${c.wedge.costBand.min}–${c.wedge.costBand.max}M compute cost` : "no print yet"} (status ${c.wedge.status.title}).`);
    L.push(`  Stage 3 Compute & power: ${v.vCompute[0]} — tracked lab footprint ${c.wedge.gwTotal ? `${c.wedge.gwTotal.toFixed(0)} GW by ${c.wedge.gwDate} (incl. projections)` : "n/a"}; AI debt announced $${c.debtTotal.toFixed(0)}B; PJM capacity $${c.pjm?.price}/MW-day.`);
    L.push(`  Link C H100 1-yr contract: ${c.hNow ? `$${c.hNow.h100.toFixed(2)}/hr (4wk ${pct(c.hChg, 1)})` : "n/a"}.`);
    L.push(`  Stage 4 Silicon & memory: ${v.vSilicon[0]} — DDR5 16Gb spot $${c.ddr5 ? c.ddr5.avg.toFixed(1) : "n/a"}; memory breadth ${c.memUp} up / ${c.memDown} down of ${c.memTotal} parts (TrendForce).`);
  }

  // Theme verdicts from the U.S. Economy tabs
  if (d.kalecki?.verdict) {
    const k = d.kalecki, kl = k.latest;
    L.push(`Profits engine (Kalecki-Levy): ${k.verdict.label}${kl ? ` — corporate profits ${kl.actual.toFixed(1)}% of GDP (p${k.pct}); ${kl.gov > kl.inv ? "the government deficit is the largest engine" : "private investment is the largest engine"}` : ""}.`);
  }
  if (d.debt?.verdict) L.push(`Debt & credit: ${d.debt.verdict.label}${fin(d.debt.verdict.hy) ? ` — HY spread ${d.debt.verdict.hy.toFixed(2)}%${fin(d.debt.verdict.hyPct) ? ` (${ord(d.debt.verdict.hyPct)} pct, 3y)` : ""}` : ""}.`);
  if (d.bank?.verdict) L.push(`Bank credit (Fed H.8): ${d.bank.verdict.label} — ${firstClause(d.bank.verdict.note)}.`);
  if (d.housing?.verdict) L.push(`Housing health: ${d.housing.verdict.label} — ${firstClause(d.housing.verdict.note)}.`);

  // U.S. Economy → Pulse: three 0–100 health scores and the red indicators behind them
  if (d.pulse?.scores) {
    const p = d.pulse, red = g => p.rows.filter(r => r.group === g && r.tone === "red").map(r => `${r.label} ${r.unit === "%yoy" ? `${r.value >= 0 ? "+" : ""}${r.value}%` : r.value}`).join(", ") || "none";
    L.push(`U.S. Pulse (U.S. Economy tab): ${p.overall.label} — ${p.overall.sentence} Scores (0 worst, 100 best): leading ${p.scores.lead.score} (${p.scores.lead.label}), consumer ${p.scores.consumer.score} (${p.scores.consumer.label}), debt ${p.scores.debt.score} (${p.scores.debt.label}; burden ${p.scores.debt.burden}, stress ${p.scores.debt.stress}).`);
    L.push(`  Red indicators — leading: ${red("lead")}; consumer: ${red("consumer")}; debt: ${red("debt")}.`);
  }

  // U.S. Economy → Machine: Dalio's three cycles, the rules of thumb, the four levers
  if (d.machine?.shortCycle) {
    const m = d.machine, st = m.shortCycle.stages.find(s => s.key === m.shortCycle.stage);
    L.push(`Economic Machine (Dalio tracker, U.S. Economy tab): productivity — ${m.productivity.label} (${m.productivity.why}) Short-term debt cycle — ${m.shortCycle.name}, ${st ? `${st.met}/${st.known} conditions met` : ''}: ${m.shortCycle.why} Long-term debt cycle — ${m.longCycle.stage}, ${m.longCycle.beautiful.label}: ${m.longCycle.why}`);
    L.push(`  Rules of thumb: ${m.rules.map(r => `${r.text} — ${r.status.toUpperCase()} (${r.detail})`).join('; ')}. Levers: ${m.longCycle.levers.map(l => `${l.name} ${l.setting}`).join(', ')}. Gold $${m.longCycle.monetization.goldNow} (${pct(m.longCycle.monetization.goldR1y, 0)} 1y).`);
  }

  // Commodities → Pulse: momentum / real-price value / macro scores, the richest and cheapest on real price, crowded positioning
  if (d.ai?.scores) {
    const a = d.ai, t = a.tokens, sc = a.scores;
    L.push(`AI ECONOMY PULSE (OpenRouter token archive, Artificial Analysis, GPU marketplaces):`);
    L.push(`  Scores 0-100: token demand ${sc.demand.score} (${sc.demand.label}); price efficiency ${sc.efficiency.score} (${sc.efficiency.label}); compute cost ${sc.compute.score} (${sc.compute.label}).`);
    L.push(`  Tokens: ${(t.week.total / 1e12).toFixed(1)}T in the week of ${t.week.d} (complete weeks), 1-wk ${pct(t.growth.w1, 0)}, 4-wk ${pct(t.growth.w4, 0)}, 13-wk ${pct(t.growth.w13, 0)}, 52-wk ${pct(t.growth.w52, 0)}; open-weight labs ${t.shares.open}% of flow; top-5 models ${t.shares.top5Models}% of the rankings snapshot (${t.snapshot.d}).`);
    L.push(`  Labs by share: ${t.labs.slice(0, 8).map(l => `${l.lab} ${l.share}% (4-wk ${pct(l.chg4w, 0)})`).join(', ')}.`);
    if (t.movers.span) L.push(`  Movers (${t.movers.span} days): up ${t.movers.up.slice(0, 3).map(m => m.name).join(', ')}; down ${t.movers.down.slice(0, 3).map(m => m.name).join(', ')}.`);
    if (a.aa) L.push(`  Artificial Analysis: best ${a.aa.best.name} (index ${a.aa.best.idx}, $${a.aa.best.price}/M); cheapest within 5 pts ${a.aa.frontier?.name} at $${a.aa.frontier?.price}/M; top-10 median $${a.aa.top10MedianPrice}/M; ${a.aa.releases90d} releases in 90 days; ${a.aa.pareto.length} models on the price/intelligence frontier.`);
    const g = a.gpu;
    L.push(`  GPU rentals: ${g.vast.filter(v => v.median != null).map(v => `${v.gpu} $${v.median}/hr`).join(', ')} (Vast.ai medians); Ornn H100 ${g.ornn.latest?.h100?.current != null ? `$${g.ornn.latest.h100.current.toFixed(2)} (30d ${pct(g.ornn.latest.h100.chg30, 0)})` : 'n/a'}; SemiAnalysis 1-yr contract ${g.semi.h100Contract != null ? `$${g.semi.h100Contract}` : 'n/a'}. Bridge: $${g.bridge.costPerM1000}/M tokens at 1,000 tok/s vs realized ~$${g.bridge.otpiAvg}/M; break-even ≈ ${g.bridge.breakevenTps} tok/s per H100.`);
  }
  for (const m of [d.sea]) {
    if (!m?.scores) continue;
    const sc = m.scores, C = m.city, U = m.labor.unemployment, P = m.labor.payrolls, J = m.labor.postings;
    const cs = m.housing.metro?.caseShiller, Z = m.housing.metro?.zillow, I = m.housing.inventory, Pr = m.prices, W = m.business.warn, G = m.giants;
    L.push(`${C.name.toUpperCase()} METRO (${C.msa} MSA; BLS/BEA/Census via FRED, Indeed, Zillow/Case-Shiller, ${C.stateName} WARN, ${C.court} bankruptcies, Yahoo):`);
    L.push(`  Verdict: ${m.headline.label}. Scores 0-100: labor ${sc.labor.score} (${sc.labor.label}); housing ${sc.housing.score} (${sc.housing.label}); cost of living ${sc.prices.score} (${sc.prices.label}); business ${sc.business.score} (${sc.business.label}).`);
    L.push(`  Labor (${U.msaD?.slice(0, 7)}): unemployment metro ${U.msa}% (${U.counties.filter(c => c.v != null).map(c => `${c.name} ${c.v}%`).join(', ')}; ${C.state} ${U.state}%, US ${U.us}%), ${pct(U.msaChg1y, 1)}pp yoy, ${U.msaPct}th percentile. Payrolls ${(P.total / 1e3).toFixed(3)}M, ${pct(P.yoy, 1)} yoy (US ${pct(P.yoyUs, 1)}), ${pct(P.sinceFeb2020, 1)} vs Feb 2020; sectors yoy: ${P.sectors.map(x => `${x.label} ${pct(x.yoy, 1)} (${x.share}%)`).join(', ')}. Avg hourly earnings $${m.labor.earnings.ahe} (${pct(m.labor.earnings.aheYoy, 1)}; US $${m.labor.earnings.aheUs}). ${C.stateName} initial claims 4-wk ${m.labor.claims.state4w} (${pct(m.labor.claims.state4wYoy, 1)} yoy). Indeed postings ${J.metro} vs US ${J.us} (Feb 2020 = 100), ${pct(J.metroChg1y, 1)} yoy.`);
    L.push(`  Housing: Case-Shiller ${pct(cs?.yoy, 1)} yoy (US ${pct(cs?.yoyUs, 1)}), ${pct(cs?.fromPeak, 1)} from peak; high tier ${pct(m.housing.tiers.high, 1)}, low ${pct(m.housing.tiers.low, 1)}; ZHVI $${Math.round(Z?.zhvi ?? 0).toLocaleString()} (${pct(Z?.zhviYoy, 1)}), ZORI $${Math.round(Z?.zori ?? 0).toLocaleString()} (${pct(Z?.zoriYoy, 1)}); active listings ${I.active?.toLocaleString()} (${pct(I.activeYoy, 1)} yoy), median DOM ${I.dom} vs ${I.dom1y}; permits ${m.housing.permits.m12?.toLocaleString()} in 12 months (${pct(m.housing.permits.m12Yoy, 1)}).`);
    L.push(`  Prices: metro CPI ${pct(Pr.cpi.metro, 1)} yoy vs US ${pct(Pr.cpi.usAtSameMonth, 1)}; rent CPI ${pct(Pr.rent.metro, 1)} vs ${pct(Pr.rent.usAtSameMonth, 1)}; gasoline $${Pr.gas.metro} vs US $${Pr.gas.us}; regional price parity ${Pr.rpp.v}.`);
    L.push(`  Business: WARN ${W.local90.workers.toLocaleString()} ${C.region} workers in ${W.local90.notices} notices over 90 days (prior 90: ${W.local90prev.workers.toLocaleString()}); latest: ${W.notices.slice(0, 6).map(n => `${n.company} ${n.workers} (${n.location}, ${n.received})`).join('; ')}. ${C.stateName} business applications ${m.business.apps.m12?.toLocaleString()}/mo (${pct(m.business.apps.m12Yoy, 1)}).${m.business.bk ? ` ${C.court} bankruptcies ${m.business.bk.total} last quarter (${pct(m.business.bk.yoy, 1)}), business ch.11 ${m.business.bk.bizCh11T4} in a year (p${m.business.bk.bizCh11Pct}).` : ''}`);
    L.push(`  Growth (annual, lagged): ${m.growth.map(g => `${g.label} ${g.unit === '$' ? '$' + Math.round(g.v).toLocaleString() : g.unit === '$k' ? '$' + (g.v / 1e6).toFixed(1) + 'B' : g.unit === 'k' ? (g.v / 1e3).toFixed(2) + 'M' : g.v.toFixed(1)} (${g.d?.slice(0, 4)}, ${g.unit === '%' || g.unit === 'ratio' || g.unit === 'index' ? (g.yoy >= 0 ? '+' : '') + g.yoy : pct(g.yoy, 1)})`).join('; ')}.`);
    L.push(`  ${C.giantsName} (equal weight): ${pct(G.ewYtd, 1)} YTD vs SPY ${pct(G.spyYtd, 1)}; ${G.rows.filter(r => r.sym !== 'SPY').map(r => `${r.sym} ${pct(r.ytd, 1)} YTD`).join(', ')}.`);
  }
  for (const m of [d.sf, d.austin, d.nyc]) {
    if (!m?.scores) continue;
    const sc = m.scores, C = m.city, U = m.labor.unemployment, P = m.labor.payrolls, J = m.labor.postings;
    const cs = m.housing.metro?.caseShiller, Z = m.housing.metro?.zillow, Pr = m.prices, W = m.business.warn, G = m.giants;
    L.push(`${C.name.toUpperCase()} METRO (${C.msa}): ${m.headline.label}. Scores labor ${sc.labor.score} / housing ${sc.housing.score} / cost of living ${sc.prices.score} / business ${sc.business.score}. Unemployment ${U.msa}% (${C.state} ${U.state}%, US ${U.us}%), payrolls ${pct(P.yoy, 1)} yoy and ${pct(P.sinceFeb2020, 1)} vs Feb 2020, avg hourly earnings $${m.labor.earnings.ahe}; Indeed postings ${J.metro ?? 'n/a'} vs US ${J.us}. Home prices ${cs?.yoy != null ? `Case-Shiller ${pct(cs.yoy, 1)}` : `FHFA ${pct(m.housing.fhfa.yoy, 1)} (not in Case-Shiller)`}, Zillow value $${Math.round(Z?.zhvi ?? 0).toLocaleString()} (${pct(Z?.zhviYoy, 1)}), rent $${Math.round(Z?.zori ?? 0).toLocaleString()} (${pct(Z?.zoriYoy, 1)}), active listings ${pct(m.housing.inventory.activeYoy, 1)}, permits ${m.housing.permits.m12?.toLocaleString()} (${pct(m.housing.permits.m12Yoy, 1)}). ${Pr.cpi.label} CPI ${pct(Pr.cpi.metro, 1)} vs US ${pct(Pr.cpi.usAtSameMonth, 1)}, price parity ${Pr.rpp.v}. ${W ? (W.stale ? `WARN feed lagging ${W.lagDays} days` : `WARN ${W.local90.workers.toLocaleString()} ${C.region} workers in 90 days`) : 'no state WARN feed'}; ${C.stateName} business applications ${m.business.apps.m12?.toLocaleString()}/mo (${pct(m.business.apps.m12Yoy, 1)}). ${C.giantsName} ${pct(G.ewYtd, 1)} YTD vs SPY ${pct(G.spyYtd, 1)}.`);
  }
  if (d.bk?.scores) {
    const b = d.bk, sc = b.scores, N = b.national?.latest, home = (b.board || []).find(x => x.id === b.home);
    const fq = q => (q ? `${q.slice(0, 4)}Q${Math.ceil(+q.slice(5, 7) / 3)}` : '');
    L.push(`BANKRUPTCY TRACKER (U.S. Courts F-2 quarterly through ${fq(N?.q)}, West Coast court dockets, CourtListener, EDGAR, FRED credit stress):`);
    L.push(`  Verdict: ${b.headline.label}. Scores 0-100: national filings ${sc.filings.score} (${sc.filings.label}); bank credit stress ${sc.credit.score} (${sc.credit.label}); W.D. Washington ${sc.local.score} (${sc.local.label}).`);
    if (N) L.push(`  National ${fq(N.q)}: ${N.total.toLocaleString()} cases (${pct(N.yoy, 1)} yoy; ${(N.t4 / 1e3).toFixed(0)}k trailing year), chapter 7 ${N.ch7.toLocaleString()}, chapter 13 ${N.ch13.toLocaleString()}, chapter 11 ${N.ch11.toLocaleString()} of which business ${N.bizCh11.toLocaleString()} (${pct(N.bizCh11Yoy, 0)} yoy).`);
    L.push(`  West Coast districts ${fq(home?.q)}: ${(b.board || []).map(x => `${x.district} ${x.total?.toLocaleString()} (${pct(x.yoy, 1)}), biz ch.11 ${x.bizCh11}`).join('; ')}.`);
    const lv = b.live || {};
    const homeLive = (lv.ch11Recent || []).filter(c => c.court === b.home).slice(0, 8);
    if (homeLive.length) L.push(`  Live Seattle/Tacoma chapter 11 petitions (court RSS, archived since ${lv.firstDay}): ${homeLive.map(c => `${c.name}${c.office ? ` (${c.office})` : ''} ${c.day}`).join('; ')}.`);
    const rec = b.recent?.[b.home]?.cases || [];
    if (rec.length) L.push(`  Named W.D. Washington chapter 11 cases, last 180 days (CourtListener, partial coverage, ${b.recent[b.home].count} on record): ${rec.filter(c => c.entity).slice(0, 12).map(c => `${c.name} (${c.filed})`).join('; ')}.`);
    if (b.public) L.push(`  Public-company bankruptcies (EDGAR 8-K Item 1.03, since ${b.public.since}): ${b.public.n} filings, ${b.public.west} West Coast; latest ${b.public.list.slice(0, 5).map(r => `${r.name}${r.ticker ? ` (${r.ticker})` : ''} ${r.date} ${r.state || ''}`).join('; ')}.`);
    const F = Object.fromEntries((b.fred || []).map(r => [r.id, r]));
    L.push(`  Credit stress: business-loan delinquency ${F.DRBLACBS?.v}% (p${F.DRBLACBS?.pct}), consumer ${F.DRCLACBS?.v}%, credit card ${F.DRCCLACBS?.v}% (p${F.DRCCLACBS?.pct}), CRE ${F.DRCRELEXFACBS?.v}%; charge-offs business ${F.CORBLACBS?.v}%; net ${F.DRTSCILM?.v}% of banks tightening C&I; HY OAS ${F.BAMLH0A0HYM2?.v}%. Business applications US ${F.BABATOTALSAUS?.v?.toLocaleString()}/mo, WA ${F.BABATOTALSAWA?.v?.toLocaleString()}/mo.`);
  }
  if (d.sfc?.scores) {
    const m = d.sfc, sc = m.scores, flat = Object.fromEntries((m.board || []).flatMap(g => g.rows.map(r => [r.id, r])));
    const at = id => flat[id]?.v;
    L.push(`SFC LEDGER & MODEL (Z.1/NIPA/DFA ledger, ${m.quarters} quarters to ${m.latest}; four-layer simulation calibrated to ${m.asOf}):`);
    L.push(`  Verdict: ${m.headline.label}. ${m.headline.why}`);
    L.push(`  Scores 0-100: private credit ${sc.credit.score} (${sc.credit.label}); interest channel ${sc.interest.score} (${sc.interest.label}); measurement ${sc.measure.score} (${sc.measure.label}).`);
    L.push(`  Ledger now: household debt ${at('debt_household')}% of GDP, business ${at('debt_business')}%, federal ${at('debt_federal')}%; BIS credit gap ${at('credit_gap')}pp; household debt service ${at('household_dsr')}% of disposable income; federal interest ${at('fed_interest_pct_gdp')}% of GDP; wage share ${at('wage_share')}%; dark-output signal ${at('dark_output_signal')}pp.`);
    L.push(`  Sectoral balances (Godley, sum to zero): government ${at('bal_gov')}%, private ${at('bal_private')}%, foreign ${at('bal_foreign')}% of GDP.`);
    if (m.crux?.data) {
      const flip = m.crux.data.filter(x => x.debt_gov > 100 && x.d_utilization > 0).sort((a, b) => a.mpc_capital - b.mpc_capital)[0];
      L.push(`  Crux — a 3pp rate hike stops cooling the economy at today's debt ratio once the MPC out of capital income passes ~${flip ? flip.mpc_capital : 0.5}; at 50% government debt it never flips. Scenario paths are model output under stated assumptions, not forecasts.`);
    }
  }
  if (d.commod?.scores) {
    const p = d.commod, sc = p.scores;
    L.push(`Commodities Pulse (Commodities tab): ${p.overall.label} — ${p.overall.sentence} Scores (0 worst, 100 best): momentum ${sc.momentum.score} (${sc.momentum.label}), real-price value ${sc.value.score} (${sc.value.label}), macro ${sc.macro.score} (${sc.macro.label}). ${sc.macro.why.split('. A weaker')[0]}.`);
    const rp = [...p.rows].filter(r => r.real).sort((a, b) => b.real.pct - a.real.pct);
    L.push(`  Real-price percentiles (each vs its own history since 1992): ${rp.map(r => `${r.name} p${r.real.pct} (${pct(r.r1y, 0)} 1y)`).join(', ')}. ${sc.positioning.why}`);
    const sg = p.spxGoldStats;
    if (sg) L.push(`  S&P 500 priced in gold: ${sg.now} oz per index point (p${sg.pct} since ${sg.since}; ${sg.windows.map(w => `${w.label} ${pct(w.ratio, 0)}`).join(', ')}) — S&P in dollars ${sg.windows.map(w => `${w.label} ${pct(w.spx, 0)}`).join(', ')}; gold ${sg.windows.map(w => `${w.label} ${pct(w.gold, 0)}`).join(', ')}.`);
    const inv = p.inventories;
    if (inv?.available) L.push(`  EIA inventories (${inv.asOf}): ${inv.items.filter(i => !i.error).map(i => `${i.label} ${i.unit === 'MBBL' ? `${(i.value / 1000).toFixed(1)}M bbl` : i.unit === 'BCF' ? `${Math.round(i.value)} bcf` : i.unit === 'MBBL/D' ? `${(i.value / 1000).toFixed(2)}M b/d` : `${i.value}%`}${i.tone ? ` (${pct(i.vs5y, 0)} vs 5-yr avg)` : ''}`).join('; ')}.`);
  }

  // International → Pulse: dollar / risk / growth scores, the board's USD-return ranking, Big Mac summary
  if (d.intl?.scores) {
    const p = d.intl, sc = p.scores;
    L.push(`International Pulse (International tab): ${p.overall.label} — ${p.overall.sentence} Scores (0 worst, 100 best): dollar ${sc.dollar.score} (${sc.dollar.label}), risk appetite ${sc.risk.score} (${sc.risk.label}), growth breadth ${sc.growth.score} (${sc.growth.label}).`);
    const rk = [...p.rows].filter(r => fin(r.eq?.usd1y)).sort((a, b) => b.eq.usd1y - a.eq.usd1y);
    if (rk.length) L.push(`  1-year equity returns in USD: ${rk.map(r => `${r.name} ${pct(r.eq.usd1y, 0)}`).join(', ')}.`);
    const bm = p.bigmacSummary;
    if (bm) L.push(`  Big Mac index (${bm.asOf} print re-marked at today's FX): ${bm.underRaw} of ${bm.n} currencies undervalued vs the dollar (raw), ${bm.underAdj} GDP-adjusted; cheapest ${bm.cheapest.map(x => `${x.name} ${pct(x.rawNow, 0)}`).join(', ')}; priciest ${bm.priciest.map(x => `${x.name} ${pct(x.rawNow, 0)}`).join(', ')}.`);
  }

  // Real Estate tab — fair-value scores, lock-in, supply pipeline, the Redfin tape, CRE credit and office occupancy
  if (d.reComp) {
    const r = d.reComp.residential, c = d.reComp.commercial;
    const anch = s => s.anchors.filter(a => fin(a.pct)).map(a => `${a.label.toLowerCase()} ${fin(a.value) ? a.value : "n/a"}${a.unit ? ` ${a.unit}` : ""} (${a.key === "yield" ? "rule score " : "historical percentile "}${a.pct})`).join(", ");
    if (fin(r?.score)) L.push(`Real estate (Real Estate tab) — residential valuation-context score ${r.score}/100 (average historical percentile; not intrinsic value): ${anch(r)}.`);
    if (fin(c?.score)) L.push(`Real estate — commercial valuation-context score ${c.score}/100 (mixes a historical ratio percentile and a rule-based EBITDA spread score; not intrinsic value): ${anch(c)}.`);
    const sr = d.reComp.support?.residential, sc = d.reComp.support?.commercial;
    if (sr) L.push(`  Residential support (not scored): ${num(sr.supplyMonths, 1)} months' supply (p${sr.supplyPct}), mortgage delinquency ${num(sr.mortgageDq)}%; housing regime "${sr.verdict}".`);
    if (sc) L.push(`  Commercial support: CRE loan delinquency ${num(sc.dq)}% (p${sc.dqPct}, ${pct(sc.dqChg1y)} over 1y), BIS prices ${pct(sc.priceYoy, 1)} YoY as of ${sc.priceAsOf} (lagged ~1y), rental vacancy ${num(sc.rentalVacancy, 1)}%; cycle "${sc.cycle}".`);
  }
  const lk = d.rePipe?.lockin;
  if (lk && fin(lk.avgRate)) L.push(`  Mortgage lock-in (FHFA NMDB ${lk.asOf}): average rate on outstanding mortgages ${num(lk.avgRate, 1)}% vs ${num(d.rePipe.mortgageNow)}% market; ${num(lk.below4, 0)}% of mortgages are below 4%, ${num(lk.ge6, 0)}% at 6%+.`);
  const cn = d.rePipe?.construction, wi = d.housing?.afford?.whatIf;
  if (wi?.toMedian) L.push(`  Affordability what-if: prices ${pct(wi.toMedian.priceChg, 0)} at today's rate, or a ${num(wi.toMedian.rate)}% mortgage at today's prices, returns the payment share to its long-run median (${num(wi.toMedian.target, 1)}% of income; now ${num(d.housing.afford.current, 1)}%).`);
  if (cn && fin(cn.multi)) L.push(`  Supply pipeline: ${Math.round(cn.multi)}K apartments under construction (${pct(cn.multiYoy, 0)} YoY, p${cn.multiPct} of history), ${Math.round(cn.single)}K single-family; multifamily permits ${pct(d.rePipe.starts?.permitsMultiYoy, 0)} YoY.`);
  const rf = d.redfin?.national?.latest, rp = d.redfin?.national?.pct;
  if (rf) L.push(`  Redfin national tape (${d.redfin.asOf}): median sale price $${Math.round(rf.price / 1000)}K, sale-to-list ${num(rf.saleToList * 100, 1)}% (p${rp?.saleToList} since 2012), ${num(rf.priceDrops * 100, 0)}% of listings with price drops (p${rp?.priceDrops}), ${num(rf.months, 1)} months of supply, ${Math.round(rf.dom)} days on market.`);
  const sl = d.creCredit?.sloos, ks = d.creCredit?.kastle;
  if (sl?.verdict) L.push(`  CRE lending standards (Fed SLOOS ${sl.asOf}): ${sl.verdict.label} — net ${pct(sl.avg, 1)} of banks tightening (construction & land ${pct(sl.cld, 1)}, non-residential ${pct(sl.nonres, 1)}, multifamily ${pct(sl.multi, 1)}).`);
  if (ks && fin(ks.avg)) L.push(`  Office attendance, not leased occupancy or NOI (Kastle 10-city, week of ${ks.d}): ${num(ks.avg, 1)}% of the Feb-2020 baseline${ks.cities ? `; ${Object.entries(ks.cities).sort((a, b) => b[1].v - a[1].v).map(([n, v]) => `${n} ${v.v}%`).join(", ")}` : ""}.`);

  return L.length > 1 ? L.join("\n") : "";
}

// Fetch every feed in parallel (all server-cached), build the block, cache 5 min.
export async function getVerdictContext(force = false) {
  if (!force && cache.text && Date.now() - cache.ts < TTL) return cache.text;
  const keys = Object.keys(FEEDS);
  const results = await Promise.all(keys.map(k => getJson(FEEDS[k])));
  const d = Object.fromEntries(keys.map((k, i) => [k, results[i]]));
  const text = buildVerdictText(d);
  if (text) cache = { text, ts: Date.now() };
  return text;
}
