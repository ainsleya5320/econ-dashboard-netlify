import fs from 'node:fs';
import path from 'node:path';
import {dateOnly,number,todayNY,daysBetween} from '../src/lib/optionsAnalysis.js';

export function normalizeEvents(earnings,dividends,today=todayNY()) {
  const reports=(Array.isArray(earnings)?earnings:[]).filter(r=>dateOnly(r.date)).map(r=>({type:'Earnings',date:dateOnly(r.date),timing:['bmo','amc'].includes(r.time)?r.time:null,updated:dateOnly(r.lastUpdated),status:dateOnly(r.date)>today?'Provider scheduled; confirm with issuer':'Historical report'}));
  const payments=(Array.isArray(dividends)?dividends:[]).filter(r=>dateOnly(r.date)).map(r=>({type:'Ex-dividend',date:dateOnly(r.date),amount:number(r.dividend),adjustedAmount:number(r.adjDividend),declared:dateOnly(r.declarationDate),paymentDate:dateOnly(r.paymentDate),status:'Provider dividend record'}));
  return {events:[...reports,...payments].filter(e=>e.date>=today).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,20),pastEarnings:reports.filter(e=>e.date<today).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8),dividends:payments.filter(e=>e.date<=today&&daysBetween(e.date,today)<=365)};
}

export function createOptionsContext({dir,fmpKey}) {
  const cacheDir=path.join(dir,'.investment-lab'),pending=new Map();
  const read=s=>{try{return JSON.parse(fs.readFileSync(path.join(cacheDir,`options-context-${s}.json`),'utf8'));}catch{return null;}};
  let ratesPending,ratesCache;
  async function get(endpoint) {
    if(!fmpKey)throw new Error('Market-data connection unavailable');
    const r=await fetch(`https://financialmodelingprep.com/stable${endpoint}${endpoint.includes('?')?'&':'?'}apikey=${fmpKey}`,{signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error('Market-data source unavailable');const d=await r.json();if(!Array.isArray(d))throw new Error('Unexpected source response');return d;
  }
  async function rates() {
    if(ratesCache&&Date.now()-ratesCache.time<6*3600000)return ratesCache.data;
    if(ratesPending)return ratesPending;
    ratesPending=(async()=>{try{const from=new Date(Date.now()-14*86400000).toISOString().slice(0,10);const rows=await get(`/treasury-rates?from=${from}&to=${todayNY()}`);const latest=rows.sort((a,b)=>b.date.localeCompare(a.date))[0];if(!latest)throw new Error('Rate observations unavailable');ratesCache={time:Date.now(),data:latest};return latest;}finally{ratesPending=null;}})();return ratesPending;
  }
  async function context(symbol) {
    if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol||''))throw new Error('Invalid symbol');
    const old=read(symbol);if(old?.version===1&&Date.now()-Date.parse(old.fetchedAt)<(old.partial?3600000:6*3600000))return old;
    if(pending.has(symbol))return pending.get(symbol);
    const promise=(async()=>{try{
      const results=await Promise.allSettled([get(`/earnings?symbol=${encodeURIComponent(symbol)}&limit=20`),get(`/dividends?symbol=${encodeURIComponent(symbol)}&limit=40`),rates()]);
      const value=i=>results[i].status==='fulfilled'?results[i].value:null;
      const status=Object.fromEntries(['earnings','dividends','rates'].map((k,i)=>[k,results[i].status==='fulfilled'?'available':'unavailable']));
      if(results.every(r=>r.status==='rejected')&&old)return {...old,stale:true};
      const data={version:1,symbol,...normalizeEvents(value(0),value(1)),rates:value(2),status,partial:Object.values(status).includes('unavailable'),fetchedAt:new Date().toISOString(),stale:false};
      fs.mkdirSync(cacheDir,{recursive:true});const file=path.join(cacheDir,`options-context-${symbol}.json`);fs.writeFileSync(file+'.tmp',JSON.stringify(data));fs.renameSync(file+'.tmp',file);return data;
    }finally{pending.delete(symbol);}})();pending.set(symbol,promise);return promise;
  }
  function register(server) {
    server.middlewares.use('/api/options-context',async(req,res,next)=>{
      const url=new URL(req.url||'/','http://localhost');
      // Netlify fork: also accept /api/options-context/<SYMBOL>.json, which is how
      // the baked file is addressed. req.url arrives stripped to "/SPY.json".
      const viaPath=(url.pathname.match(/^\/([A-Za-z0-9_.-]{1,64}?)(?:\.json)?$/)||[])[1];
      if(url.pathname!=='/'&&!viaPath)return next();
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return;}
      try{res.end(JSON.stringify(await context(viaPath||url.searchParams.get('symbol'))));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}));}
    });
  }
  return {context,register};
}
