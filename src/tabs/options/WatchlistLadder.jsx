import React,{useEffect,useMemo,useRef,useState} from 'react';
import {fetchOptionsChain} from '../../lib/api.js';
import {chooseCandidates,usableOptions,eventsForExpiry,number,dateOnly,todayNY} from '../../lib/optionsAnalysis.js';
import {money} from './DecisionWorkbench.jsx';

export function watchlistCandidate(chain,thesis={}) {
  if(!(chain?.spot>0))return {};
  const dates=usableOptions(chain).filter(o=>Math.abs(o.dte-45)<=18);
  const expiry=dates.sort((a,b)=>Math.abs(a.dte-45)-Math.abs(b.dte-45)||a.expiryDate.localeCompare(b.expiryDate))[0]?.expiryDate;
  if(!expiry)return {};
  const rows=chooseCandidates(chain,{expiryDate:expiry,buyBelow:number(thesis.buyBelow),sellAbove:number(thesis.sellAbove),fee:.65});
  const put=rows.find(o=>o.type==='P'&&o.strike<=chain.spot&&o.matches);
  const call=rows.find(o=>o.type==='C'&&o.strike>=chain.spot&&o.matches);
  return {expiry,put,call,dte:dates.find(o=>o.expiryDate===expiry)?.dte};
}

export default function WatchlistLadder({tickers,theses={},onInspect}) {
  const [records,setRecords]=useState({}),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false);
  const cache=useRef({}),key=JSON.stringify(tickers);
  useEffect(()=>{
    let alive=true;
    const names=JSON.parse(key);
    async function load() {
      setLoading(true);
      for(let i=0;i<names.length&&alive;i+=3){
        const batch=await Promise.all(names.slice(i,i+3).map(async symbol=>{
          if(cache.current[symbol])return [symbol,cache.current[symbol]];
          const [chain,event]=await Promise.allSettled([fetchOptionsChain(symbol),fetch(`/api/options-context/${encodeURIComponent(symbol)}`).then(r=>{if(!r.ok)throw Error('Unavailable');return r.json();})]);
          return [symbol,{chain:chain.status==='fulfilled'?chain.value:null,error:chain.status==='rejected',context:event.status==='fulfilled'?event.value:null}];
        }));
        if(!alive)return;
        for(const [s,data] of batch)cache.current[s]=data;
        setRecords({...cache.current});
      }
      if(alive)setLoading(false);
    }
    load();
    return ()=>{alive=false;};
  },[key,refresh]);
  const rows=useMemo(()=>[...tickers].sort().map(symbol=>({symbol,...records[symbol],...watchlistCandidate(records[symbol]?.chain,theses[symbol])})),[tickers,records,theses]);
  const status=(symbol,type,option)=>number(theses[symbol]?.[type==='P'?'buyBelow':'sellAbove'])==null?'Set a valuation':option?'Meets your threshold':'No qualifying contract';
  return <section className="opt-card"><div className="opt-section-label">Watchlist / valuation first</div><h2>Where do quoted strikes meet your prices?</h2>
    <p className="opt-note">Uses the eligible expiration closest to 45 days, within 18 days. Select a company to enter purchase and sale thresholds in Valuation &amp; payoffs. Companies remain alphabetical. Blank thresholds produce no candidate.</p>
    <button className="opt-button" disabled={loading} onClick={()=>{cache.current={};setRecords({});setRefresh(v=>v+1);}}>{loading?'Loading quotes and events…':'Refresh watchlist'}</button>
    <div className="opt-table-wrap"><table className="opt-table"><thead><tr><th>Company / stock</th><th>Expiration</th><th>Put strike / net premium</th><th>Effective entry</th><th>Purchase threshold</th><th>Call strike / net premium</th><th>Sale threshold</th><th>Events through expiry</th></tr></thead><tbody>
      {rows.map(r=>{const events=eventsForExpiry(r.context?.events,r.expiry),eventMissing=!r.context||r.context.partial||r.context.stale;return <tr key={r.symbol}><td><button onClick={()=>onInspect?.(r.symbol)}>{r.symbol}</button><small>{money(r.chain?.spot)}</small><small>Underlying trade {dateOnly(r.chain?.underlyingLastTrade)||'unknown'}</small>{dateOnly(r.chain?.underlyingLastTrade)&&dateOnly(r.chain.underlyingLastTrade)<todayNY()&&<small>Prior-session snapshot</small>}</td>
        {r.error?<td colSpan={7}>Quotes unavailable</td>:!r.chain?<td colSpan={7}>Loading…</td>:!(r.chain.spot>0)?<td colSpan={7}>Stock price unavailable</td>:!r.expiry?<td colSpan={7}>No eligible expiry near 45 days</td>:<>
          <td>{r.expiry}<small>{r.dte} calendar days</small></td>
          <td>{money(r.put?.strike)}<small>{r.put?money(r.put.premium)+' net / contract':'—'}</small>{r.put&&<small>Spread {(r.put.spread*100).toFixed(1)}%</small>}</td><td>{money(r.put?.entry)}</td><td>{money(number(theses[r.symbol]?.buyBelow))}<small>{status(r.symbol,'P',r.put)}</small></td>
          <td>{money(r.call?.strike)}<small>{r.call?money(r.call.premium)+' net / contract':'—'}</small>{r.call&&<small>Spread {(r.call.spread*100).toFixed(1)}%</small>}</td><td>{money(number(theses[r.symbol]?.sellAbove))}<small>{status(r.symbol,'C',r.call)}</small></td>
          <td>{events.length?events.map((e,i)=><small key={i}>{e.type}: {e.date}</small>):'No dates returned'}{eventMissing&&<small>Calendar incomplete or unavailable</small>}</td>
        </>}</tr>;})}
      {!rows.length&&<tr><td colSpan={8}>Add companies above to compare them.</td></tr>}
    </tbody></table></div>
    <p className="opt-note">The put uses the highest strike at or below spot whose premium-adjusted entry meets your maximum purchase price. The call uses the lowest strike at or above spot meeting your minimum sale strike. Assumes one standard 100-share contract and a $0.65 entry fee; the detailed workspace allows a different fee. These are comparison candidates, not rankings by expected return. Put cash collateral is strike × 100; covered calls require 100 shares.</p>
    <p className="opt-note">Quotes require a positive bid, a valid ask, open interest ≥50, and a spread ≤35% of midpoint. Delayed bid premiums are indications, not guaranteed fills. Individual quote timestamps are unavailable; last-trade timestamps do not establish quote freshness. Earnings dates may change and undeclared dividends may be missing.</p>
  </section>;
}
