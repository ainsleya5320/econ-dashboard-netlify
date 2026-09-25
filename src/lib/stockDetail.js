import {fetchFMP} from './api.js';
import {uniquePeriods,numeric} from './stockResearch.js';

// lite: skip the analyst endpoints (estimates, targets, ratings) — the research
// sheet does not use them, and the flip-book loads a sheet per page turn.
export async function fetchStockDetail(symbol,key,{lite=false}={}) {
  if(!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol||''))throw Error('Invalid stock symbol');
  const s=encodeURIComponent(symbol);
  const all=[
    ['inc','Annual income statements',`/income-statement?symbol=${s}&period=annual&limit=20`,'income-statement'],
    ['bs','Annual balance sheets',`/balance-sheet-statement?symbol=${s}&period=annual&limit=20`,'balance-sheet-statement'],
    ['cf','Annual cash-flow statements',`/cash-flow-statement?symbol=${s}&period=annual&limit=20`,'cashflow-statement'],
    ['rat','Annual financial ratios',`/ratios?symbol=${s}&period=annual&limit=20`,'ratios'],
    ['km','Annual key metrics',`/key-metrics?symbol=${s}&period=annual&limit=20`,'key-metrics'],
    ['prof','Company profile',`/profile?symbol=${s}`,'profile-symbol'],
    ['quote','Market quote',`/quote?symbol=${s}`,'quote'],
    ['prices','Price history',`/historical-price-eod/full?symbol=${s}`,'historical-price-eod-full'],
    ['est','Analyst estimates',`/analyst-estimates?symbol=${s}&period=annual&limit=10`,'analyst-estimates'],
    ['pt','Consensus targets',`/price-target-consensus?symbol=${s}`,'price-target-consensus'],
    ['grades','Analyst ratings',`/grades-consensus?symbol=${s}`,'grades-consensus'],
    ['qinc','Quarterly income statements',`/income-statement?symbol=${s}&period=quarter&limit=12`,'income-statement'],
    ['qbs','Quarterly balance sheets',`/balance-sheet-statement?symbol=${s}&period=quarter&limit=8`,'balance-sheet-statement'],
    ['qcf','Quarterly cash-flow statements',`/cash-flow-statement?symbol=${s}&period=quarter&limit=8`,'cashflow-statement'],
  ];
  const requests=lite?all.filter(([id])=>!['est','pt','grades'].includes(id)):all;
  const fetched=await Promise.allSettled(requests.map(async([id,,url])=>{
    const d=await fetchFMP(url,key);
    if(Array.isArray(d))return d;
    if(id==='prices'&&Array.isArray(d?.historical))return d.historical;
    throw Error('Unexpected financial-data response');
  }));
  const raw=Object.fromEntries(requests.map(([id],i)=>[id,fetched[i].status==='fulfilled'?fetched[i].value:[]]));
  if(!raw.prof.length&&!raw.inc.length&&!raw.quote.length)throw Error('Company data is unavailable');
  const longHist=raw.prices.filter(p=>p.date&&numeric(p.close)>0).sort((a,b)=>a.date.localeCompare(b.date));
  return {symbol,price:numeric(raw.quote[0]?.price??raw.prof[0]?.price),prof:raw.prof[0],quote:raw.quote[0],hist:longHist.slice(-90),longHist,
    years:uniquePeriods(raw.inc).map(i=>String(i.fiscalYear)),
    inc:uniquePeriods(raw.inc),bs:uniquePeriods(raw.bs),cf:uniquePeriods(raw.cf),rat:uniquePeriods(raw.rat),km:uniquePeriods(raw.km),
    qinc:uniquePeriods(raw.qinc),qbs:uniquePeriods(raw.qbs),qcf:uniquePeriods(raw.qcf),
    est:(raw.est||[]).sort((a,b)=>(a.date||'').localeCompare(b.date||'')),pt:raw.pt?.[0]??null,grades:raw.grades?.[0]??null,retrievedAt:new Date().toISOString(),
    sources:requests.map(([id,label,endpoint,doc],i)=>({id,label,endpoint,doc,rows:raw[id].length,status:fetched[i].status==='fulfilled'?(raw[id].length?'Available':'No rows returned'):'Unavailable'}))};
}
