import React, { useEffect, useState } from "react";
import { fonts, cardBg, cardBorder } from "../lib/styles.js";
import { InfoBox } from "../components/shared.jsx";
import { fetchOptionsChain, fetchFMP } from "../lib/api.js";
import CSPScreener from "./stocks/CSPScreener.jsx";
import { VolSurface } from "./StocksTab.jsx";
import ExpectationsView from "./options/ExpectationsView.jsx";
import IncomeView from "./options/IncomeView.jsx";
import WatchlistLadder from "./options/WatchlistLadder.jsx";
import DecisionWorkbench, {modelInputs} from "./options/DecisionWorkbench.jsx";
import VolatilityHistory, {saveVolSnapshot} from "./options/VolatilityHistory.jsx";
import {quoteQuality, dateOnly, daysBetween, todayNY} from "../lib/optionsAnalysis.js";
import "./options/OptionsResearch.css";

// Shared quotes, valuation inputs, and event context for options research.

const DEFAULT_SYMBOL = "SPY";
const QUICK_SYMBOLS = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "TSLA", "META", "AMZN", "GOOGL"];
const VIEWS = [["decision", "Valuation & payoffs"], ["expect", "Implied ranges"], ["income", "Premium & strikes"], ["watchlist", "Watchlist"], ["history", "Events & history"], ["surface", "Volatility detail"]];

function OptionsTab({ fmpKey }) {
  const [view, setView] = useState("expect");
  const [refresh,setRefresh]=useState(0),[context,setContext]=useState(null);
  const [theses,setTheses]=useState(()=>{try{const saved=JSON.parse(localStorage.getItem('ledger-option-theses')||'{}');return saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};}catch{return {};}});
  useEffect(()=>{try{localStorage.setItem('ledger-option-theses',JSON.stringify(theses));}catch{}},[theses]);

  // the symbol shared by the single-name views (persisted)
  const [symbol, setSymbol] = useState(() => {
    try { return localStorage.getItem("opt-vol-symbol") || DEFAULT_SYMBOL; } catch { return DEFAULT_SYMBOL; }
  });
  const [symInput, setSymInput] = useState("");
  useEffect(() => { try { localStorage.setItem("opt-vol-symbol", symbol); } catch {} }, [symbol]);

  // one chain + one price history + one consensus target per symbol, shared
  const [chain, setChain] = useState(null);
  useEffect(()=>{if(chain?.symbol===symbol)saveVolSnapshot(symbol,chain);},[chain,symbol]);
  const [chainErr, setChainErr] = useState(null);
  const [closes, setCloses] = useState(null);
  const [target, setTarget] = useState(null);
  useEffect(() => {
    let alive = true;
    setChain(null); setChainErr(null); setCloses(null); setTarget(null); setContext(null);
    fetchOptionsChain(symbol).then(d => { if (alive) setChain(d); }).catch(e => { if (alive) setChainErr(e?.message || "chain unavailable"); });
    fetch(`/api/options-context/${encodeURIComponent(symbol)}`).then(r=>r.ok?r.json():Promise.reject()).then(d=>{if(alive)setContext(d);}).catch(()=>{if(alive)setContext({events:[],status:{earnings:'unavailable',dividends:'unavailable',rates:'unavailable'},partial:true});});
    if (fmpKey) {
      fetchFMP(`/historical-price-eod/full?symbol=${symbol}`, fmpKey).then(d => {
        const rows = Array.isArray(d) ? d : (d?.historical || []);
        const chron = [...rows].filter(r => r.close != null).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        if (alive) setCloses(chron.slice(-800).map(r => ({ date: r.date, close: r.adjClose??r.close })));
      }).catch(() => { if (alive) setCloses([]); });
      fetchFMP(`/price-target-consensus?symbol=${symbol}`, fmpKey).then(d => { if (alive && Array.isArray(d) && d.length) setTarget(d[0]); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [symbol, fmpKey, refresh]);

  // the screener/ladder share the watchlist with Stocks (via /api/tickers, mirrored to localStorage)
  const [tickers, setTickers] = useState([]);
  const [tickerInput, setTickerInput] = useState("");
  const [showGrid, setShowGrid] = useState(false);
  useEffect(() => {
    fetch("/api/tickers")
      .then(r => r.json())
      .then(saved => { if (Array.isArray(saved) && saved.length) setTickers(saved); })
      .catch(() => { try { const saved = localStorage.getItem("econ-dash-tickers"); if (saved) setTickers(JSON.parse(saved)); } catch {} });
  }, []);
  useEffect(() => {
    if (!tickers.length) return;
    try { localStorage.setItem("econ-dash-tickers", JSON.stringify(tickers)); } catch {}
    fetch("/api/tickers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tickers) }).catch(() => {});
  }, [tickers]);

  const submitSymbol = () => { const s = symInput.trim().toUpperCase(); if (s) { setSymbol(s); setSymInput(""); } };
  const addTicker = () => { const t = tickerInput.trim().toUpperCase(); if (t && !tickers.includes(t)) { setTickers(prev => [...prev, t]); setTickerInput(""); } };
  const removeTicker = t => setTickers(prev => prev.filter(x => x !== t));

  const inputStyle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: fonts.mono, outline: "none", width: 130 };
  const btnStyle = { background: "#6366F1", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading };
  const labelStyle = { fontSize: 12, color: "#64748b", fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" };

  const symbolPicker = (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <label style={labelStyle}>Symbol</label>
      <input value={symInput} onChange={e => setSymInput(e.target.value)} onKeyDown={e => e.key === "Enter" && submitSymbol()} placeholder={symbol} style={inputStyle} />
      <button onClick={submitSymbol} style={btnStyle}>Load</button>
      <button className="opt-button" onClick={()=>setRefresh(v=>v+1)}>Refresh quotes</button>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginLeft: 6 }}>
        {QUICK_SYMBOLS.map(s => (
          <button key={s} onClick={() => setSymbol(s)} style={{
            background: symbol === s ? "#818cf8" : "rgba(255,255,255,0.05)", border: "1px solid " + (symbol === s ? "#818cf8" : "rgba(255,255,255,0.1)"),
            color: symbol === s ? "#0f172a" : "#94a3b8", padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: fonts.heading, borderRadius: 6,
          }}>{s}</button>
        ))}
      </div>
      <span style={{ fontSize: 12, color: "#475569", fontFamily: fonts.mono, marginLeft: "auto" }}>{chain ? `${chain.options.length.toLocaleString()} contracts · CBOE delayed` : chainErr ? "chain unavailable" : "loading chain…"}</span>
    </div>
  );
  const chainState = chainErr
    ? <InfoBox color="#F97316"><strong style={{ color: "#cbd5e1" }}>No chain for {symbol}.</strong> {chainErr} — try another symbol.</InfoBox>
    : !chain ? <div style={{ padding: 40, textAlign: "center", color: "#64748b", fontFamily: fonts.mono, fontSize: 12 }}>Loading {symbol} options chain (CBOE)…</div>
    : !(chain.spot>0)||!chain.options.length ? <InfoBox color="#F97316">A usable stock price and future option contracts are required. Try another symbol.</InfoBox> : null;

  const thesis=theses[symbol]||{};
  const model=modelInputs(context,chain?.spot);
  const usable=chain?.options.filter(o=>quoteQuality(o).usable).length||0;
  const tradeDate=dateOnly(chain?.underlyingLastTrade),oldTrade=tradeDate&&daysBetween(tradeDate,todayNY())>0;
  const quality=chain&&<div className="opt-quote-banner"><strong>{symbol} · delayed market snapshot</strong><p>Feed timestamp: {chain.sourceTimestamp||'not supplied'} · underlying last trade: {chain.underlyingLastTrade||'not supplied'}. Source times are shown as supplied; no timezone is asserted.</p><p>{usable.toLocaleString()} of {chain.options.length.toLocaleString()} contracts pass the default quote checks (spread ≤35% of midpoint, open interest ≥50, matching contract root). Contract-level quote age is unavailable; last trade time is a different measure. Displayed bids are indications, not guaranteed fills.</p>{oldTrade&&<p><strong>The underlying’s last trade is dated {tradeDate}.</strong> The market may be closed; review a current quote before using the figures.</p>}</div>;
  return (<div className="options-research">
    <nav className="opt-tabs" aria-label="Options research">
      {VIEWS.map(([id, text]) => (
        <button key={id} onClick={() => setView(id)} aria-pressed={view===id}>{text}</button>
      ))}
    </nav>
    {view!=='watchlist'&&<>{symbolPicker}{quality}</>}
    {view==='decision'&&(chainState||<DecisionWorkbench key={symbol} symbol={symbol} chain={chain} context={context} thesis={thesis} onThesisChange={t=>setTheses(old=>({...old,[symbol]:t}))}/>)}
    {view==='history'&&(chainState||<VolatilityHistory key={symbol} symbol={symbol} chain={chain} context={context} closes={closes}/>)}

    {view === "expect" && (<>
      {chainState || <ExpectationsView symbol={symbol} chain={chain} closes={closes} target={target} model={model} context={context} thesis={thesis} />}
    </>)}

    {view === "income" && (<>
      {chainState || <IncomeView symbol={symbol} fmpKey={fmpKey} chain={chain} closes={closes} context={context} />}
    </>)}

    {view === "watchlist" && (<>
      <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: "12px 16px", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <label style={labelStyle}>Watchlist</label>
          <input value={tickerInput} onChange={e => setTickerInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addTicker()} placeholder="Add ticker (e.g. COST)" style={inputStyle} />
          <button onClick={addTicker} style={btnStyle}>Add</button>
          <span style={{ fontSize: 12, color: "#475569", fontFamily: fonts.mono, marginLeft: "auto" }}>shared with Stocks → Watchlist and the Cockpit rail</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tickers.map(t => (
            <span key={t} style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontFamily: fonts.mono, color: "#c7d2fe", display: "flex", alignItems: "center", gap: 6 }}>
              {t}<span onClick={() => removeTicker(t)} style={{ cursor: "pointer", color: "#f87171", fontWeight: 700, fontSize: 13 }}>×</span>
            </span>
          ))}
          {tickers.length === 0 && <span style={{ fontSize: 12, color: "#64748b", fontFamily: fonts.mono }}>No tickers yet — add one above to build the ladder.</span>}
        </div>
      </div>
      <WatchlistLadder tickers={tickers} theses={theses} onInspect={s=>{setSymbol(s);setView('decision');}} />
      <button onClick={() => setShowGrid(s => !s)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, margin: "4px 0 10px", fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: fonts.heading }}>
        <span style={{ color: "#818cf8", marginRight: 8 }}>{showGrid ? "▾" : "▸"}</span>ATM put premiums by maturity
      </button>
      {showGrid && <CSPScreener tickers={tickers} />}
    </>)}

    {view === "surface" && (<>
      {chainState || <VolSurface symbol={symbol} spot={null} chain={chain} />}
      <InfoBox color="#818cf8">
        <strong style={{ color: "var(--text-primary)" }}>Volatility detail.</strong> The heatmap and surface compare quoted implied volatility across strikes and expiries. Greeks describe price sensitivity; open interest describes outstanding contracts. Implied ranges presents an approximate pricing distribution using the same snapshot.
      </InfoBox>
    </>)}
  </div>);
}

export default OptionsTab;
