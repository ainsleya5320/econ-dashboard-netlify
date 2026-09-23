import React, { useState, useEffect } from "react";
import { fonts } from "../lib/styles.js";
import { CHOROPLETH_METRICS } from "../lib/constants.js";
import StateChoropleth from "../components/StateChoropleth.jsx";
import SubViews from "../components/SubViews.jsx";
import UsPulseTab from "./UsPulseTab.jsx";
import MunicipalitiesTab from "./MunicipalitiesTab.jsx";
import LaborSubTab from "./LaborSubTab.jsx";
import ConsumerTab from "./ConsumerTab.jsx";
import CpiTab from "./CpiTab.jsx";
import GrowthTab from "./GrowthTab.jsx";
import ProfitsEngineTab from "./ProfitsEngineTab.jsx";
import DebtMarketTab from "./DebtMarketTab.jsx";
import BankCreditTab from "./BankCreditTab.jsx";
import BankruptcyTab from "./BankruptcyTab.jsx";
import RatesTab from "./RatesTab.jsx";
import FedSubTab from "./FedSubTab.jsx";
import TighteningTab from "./TighteningTab.jsx";
import BudgetSubTab from "./BudgetSubTab.jsx";
import MachineTab from "./MachineTab.jsx";
import SfcModelTab from "./SfcModelTab.jsx";

// ============================================================================
// U.S. ECONOMY — ten sub-tabs (consolidated from sixteen, Sept 2026).
//   Pulse · Regional · Labor · Consumer · Inflation · Growth · Credit ·
//   Rates & Fed · Fiscal · Machine
// Five of them fold former pages into views (SubViews): Regional = metros /
// states map; Growth = activity / profits engine; Credit = corporate / banks /
// defaults; Rates & Fed = treasuries / Fed balance sheet / tightening
// monitor; Machine = Dalio /
// stock-flow model. Pulse rows and cross-links still use the old drill ids,
// which DRILL maps onto a tab and a view.
// ============================================================================

const ECON_SUB_TABS = [
  { id: "dashboard", label: "Pulse" },
  { id: "regional",  label: "Regional" },
  { id: "labor",     label: "Labor" },
  { id: "consumer",  label: "Consumer" },
  { id: "inflation", label: "Inflation" },
  { id: "growth",    label: "Growth" },
  { id: "credit",    label: "Credit" },
  { id: "rates",     label: "Rates & Fed" },
  { id: "fiscal",    label: "Fiscal" },
  { id: "machine",   label: "Machine" },
];

// Old sub-tab ids (still used by Pulse's drill field and older links) → [tab, view].
const DRILL = {
  gdp: ["growth", "activity"], profits: ["growth", "profits"],
  debt: ["credit", "corporate"], banks: ["credit", "banks"], bankruptcy: ["credit", "defaults"],
  fed: ["rates", "fed"], tightening: ["rates", "tightening"], budget: ["fiscal"], cpi: ["inflation"],
  model: ["machine", "sfc"], stateLevel: ["regional", "states"], municipal: ["regional", "metros"],
};
const DEFAULT_VIEW = { regional: "metros", growth: "activity", credit: "corporate", rates: "treasuries", machine: "dalio" };

function USEconomyTab({ md, td, gd, cd, csm, hd, zillowData, fredKey, fmpKey, choroplethCache, choroplethMetric, setChoroplethMetric, fetchChoroplethData, choroplethLoading, choroplethProgress }) {
  const [econSubTab, setEconSubTab] = useState("dashboard");
  const [views, setViews] = useState(DEFAULT_VIEW);

  // Auto-fetch the state map when its metric changes
  useEffect(() => { fetchChoroplethData(choroplethMetric); }, [choroplethMetric, fetchChoroplethData]);

  // The State-Level map keeps the economy metrics; real-estate metrics live on the Real Estate tab.
  const ECON_MAP_METRICS = CHOROPLETH_METRICS.filter(m => m.group !== "realestate" && m.source !== "zillow");

  // go(id[, view]) accepts either a current tab id or a legacy drill id.
  const go = (id, view) => {
    const m = DRILL[id];
    const tab = m ? m[0] : id;
    const v = view || (m && m[1]);
    setEconSubTab(tab);
    if (v) setViews(s => ({ ...s, [tab]: v }));
  };
  const setView = tab => v => setViews(s => ({ ...s, [tab]: v }));

  return (<>
    {/* Economy sub-tab bar */}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: "var(--bg-subtle)", borderRadius: 10, padding: 3, marginBottom: 18 }}>
      {ECON_SUB_TABS.map(t => (
        <button key={t.id} onClick={() => setEconSubTab(t.id)} style={{
          flex: "1 1 auto", padding: "8px 10px", border: "none", borderRadius: 8,
          background: econSubTab === t.id ? "linear-gradient(135deg, rgba(129,140,248,0.2), rgba(99,102,241,0.1))" : "transparent",
          color: econSubTab === t.id ? "var(--tab-active-color)" : "var(--tab-inactive-color)",
          fontSize: 12, fontWeight: econSubTab === t.id ? 600 : 400,
          fontFamily: fonts.heading, cursor: "pointer", transition: "all 0.15s",
          borderBottom: econSubTab === t.id ? "2px solid #818cf8" : "2px solid transparent",
        }}>{t.label}</button>
      ))}
    </div>

    {/* Pulse landing — leading indicators, consumer health, debt picture; rows drill into the tabs below */}
    {econSubTab === "dashboard" && <UsPulseTab go={go} />}

    {/* Regional — one metro at a time (Seattle by default), or the state choropleth */}
    {econSubTab === "regional" && (
      <SubViews view={views.regional} onChange={setView("regional")} views={[
        { id: "metros", label: "Metros", hint: "Seattle, San Francisco, Austin, New York", render: () => <MunicipalitiesTab go={go} /> },
        { id: "states", label: "States", hint: "one metric across all fifty", render: () => <StateChoropleth title="State-Level Economic Data" metrics={ECON_MAP_METRICS} metric={choroplethMetric} setMetric={setChoroplethMetric} cache={choroplethCache} loading={choroplethLoading} progress={choroplethProgress} /> },
      ]} />
    )}

    {econSubTab === "labor" && <LaborSubTab fredKey={fredKey} />}
    {econSubTab === "consumer" && <ConsumerTab csm={csm} />}
    {econSubTab === "inflation" && <CpiTab cd={cd} />}

    {/* Growth — output and its leading gauges, then who captured it */}
    {econSubTab === "growth" && (
      <SubViews view={views.growth} onChange={setView("growth")} views={[
        { id: "activity", label: "Activity", hint: "GDP and the gauges that lead it", render: () => <GrowthTab fredKey={fredKey} /> },
        { id: "profits", label: "Profits engine", hint: "the Kalecki decomposition", render: () => <ProfitsEngineTab /> },
      ]} />
    )}

    {/* Credit — corporate spreads and balance sheets, bank lending and losses, the default cycle */}
    {econSubTab === "credit" && (
      <SubViews view={views.credit} onChange={setView("credit")} views={[
        { id: "corporate", label: "Corporate", hint: "spreads, the refi squeeze, balance sheets", render: () => <DebtMarketTab /> },
        { id: "banks", label: "Banks", hint: "loan growth, delinquencies, lending standards, charge-offs", render: () => <BankCreditTab /> },
        { id: "defaults", label: "Defaults", hint: "bankruptcies, Seattle first", render: () => <BankruptcyTab /> },
      ]} />
    )}

    {/* Rates & Fed — the price of money, the balance sheet behind it, and the
        leading-indicator board for tightening that starts in the bond market */}
    {econSubTab === "rates" && (
      <SubViews view={views.rates} onChange={setView("rates")} views={[
        { id: "treasuries", label: "Treasuries & mortgages", render: () => <RatesTab md={md} td={td} fmpKey={fmpKey} fredKey={fredKey} /> },
        { id: "fed", label: "Fed balance sheet", render: () => <FedSubTab fredKey={fredKey} /> },
        { id: "tightening", label: "Tightening monitor", hint: "does the AI boom tighten through bonds before stocks?", render: () => <TighteningTab go={go} /> },
      ]} />
    )}

    {econSubTab === "fiscal" && <BudgetSubTab fredKey={fredKey} />}

    {/* Machine — two balance-sheet lenses on the same economy */}
    {econSubTab === "machine" && (
      <SubViews view={views.machine} onChange={setView("machine")} views={[
        { id: "dalio", label: "Dalio cycle", hint: "How the Economic Machine Works, tracked", render: () => <MachineTab /> },
        { id: "sfc", label: "Stock-flow model", hint: "the ledger and the four-layer simulation", render: () => <SfcModelTab /> },
      ]} />
    )}
  </>);
}

export default USEconomyTab;
