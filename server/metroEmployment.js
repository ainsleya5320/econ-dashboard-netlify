import fs from 'node:fs';
import path from 'node:path';
import { METROS } from './realEstateFeeds.js';

const DAY=86400000;
const ROOT='https://download.bls.gov/pub/time.series/sm/';
const API='https://api.bls.gov/publicAPI/v2/timeseries/data/';
export const INDUSTRIES={
  '10000000':'Mining & logging','15000000':'Mining, logging & construction','20000000':'Construction',
  '30000000':'Manufacturing','40000000':'Trade, transport & utilities','50000000':'Information',
  '55000000':'Financial activities','60000000':'Professional & business services',
  '65000000':'Private education & health','70000000':'Leisure & hospitality','80000000':'Other services','90000000':'Government',
};
const tsv=text=>{const lines=text.trim().split(/\r?\n/),h=lines.shift().split('\t').map(s=>s.trim());return lines.map(l=>Object.fromEntries(l.split('\t').map((v,i)=>[h[i],v.trim()])));};

export function selectEmploymentSeries(text,code) {
  const rows=tsv(text).filter(s=>s.area_code===code&&s.seasonal==='U');
  const jobs=rows.filter(s=>s.data_type_code==='01');
  const total=jobs.find(s=>s.industry_code==='00000000');
  if(!total) throw new Error('Metro payroll series unavailable');
  // Use mutually exclusive broad industries; never add a combined parent to its children.
  const separate=jobs.some(s=>s.industry_code==='10000000')&&jobs.some(s=>s.industry_code==='20000000');
  const combined=jobs.some(s=>s.industry_code==='15000000');
  const sectors=jobs.filter(s=>INDUSTRIES[s.industry_code]&&
    (separate?s.industry_code!=='15000000':!combined||!['10000000','20000000'].includes(s.industry_code)))
    .map(s=>({id:s.series_id,code:s.industry_code,name:INDUSTRIES[s.industry_code]}));
  const wage=rows.find(s=>s.data_type_code==='03'&&s.industry_code==='05000000');
  return {total:total.series_id,sectors,wage:wage?.series_id??null};
}

export function parseBlsSeries(response) {
  if(response.status!=='REQUEST_SUCCEEDED') throw new Error('BLS request unavailable or daily allowance reached');
  return Object.fromEntries((response.Results?.series||[]).map(s=>[s.seriesID,(s.data||[])
    .filter(p=>/^M(0[1-9]|1[0-2])$/.test(p.period)&&/^\d{4}$/.test(p.year)&&/^\d+(?:\.\d+)?$/.test(p.value))
    .map(p=>({date:`${p.year}-${p.period.slice(1)}`,value:Number(p.value),preliminary:p.footnotes?.some(f=>f.code==='P')??false}))
    .sort((a,b)=>a.date.localeCompare(b.date))]));
}
const yearBefore=date=>`${Number(date.slice(0,4))-1}${date.slice(4)}`;
export function employmentHistory(points=[]) {
  const byDate=Object.fromEntries(points.map(p=>[p.date,p.value]));
  return points.map(p=>{const before=byDate[yearBefore(p.date)];return {...p,yoy:before>0?100*(p.value/before-1):null,change:before!=null?p.value-before:null};});
}
export function summarizeEmployment(series,catalog) {
  const history=employmentHistory(series[catalog.total]);
  const latest=history.at(-1);
  if(!latest) throw new Error('Metro employment observations unavailable');
  const national=Object.fromEntries(employmentHistory(series.CEU0000000001).map(p=>[p.date,p]));
  const sectors=catalog.sectors.map(s=>{
    const point=employmentHistory(series[s.id]).find(p=>p.date===latest.date);
    return {...s,date:latest.date,jobs:point?.value!=null?point.value*1000:null,
      change:point?.change!=null?point.change*1000:null,yoy:point?.yoy??null,
      share:point?.value!=null&&latest.value>0?100*point.value/latest.value:null,
      contribution:point?.change!=null&&latest.change!=null&&latest.value-latest.change>0?100*point.change/(latest.value-latest.change):null,
      preliminary:point?.preliminary??false};
  });
  const wage=catalog.wage?employmentHistory(series[catalog.wage]).at(-1):null;
  const partial=sectors.some(s=>s.change==null)||national[latest.date]?.yoy==null||latest.yoy==null||(catalog.wage&&!wage);
  return {history:history.slice(-84).map(p=>({...p,nationalYoy:national[p.date]?.yoy??null})),
    latest:{...latest,jobs:latest.value*1000,change:latest.change!=null?latest.change*1000:null,nationalYoy:national[latest.date]?.yoy??null},
    sectors,wage:wage??null,partial:Boolean(partial),catalog};
}

export function createMetroEmployment({dir,blsKey=''}) {
  const cacheDir=path.join(dir,'.investment-lab');
  const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(cacheDir,name),'utf8'));}catch{return null;}};
  const write=(name,data)=>{fs.mkdirSync(cacheDir,{recursive:true});const file=path.join(cacheDir,name);fs.writeFileSync(file+'.tmp',JSON.stringify(data));fs.renameSync(file+'.tmp',file);};
  const get=async(url,options={})=>{const r=await fetch(url,{...options,signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error(`BLS returned HTTP ${r.status}`);return r;};
  let metadataPending;
  async function metadata() {
    const old=read('employment-catalog.json');
    if(old?.version===1&&Date.now()-Date.parse(old.fetchedAt)<7*DAY)return old;
    if(metadataPending)return metadataPending;
    metadataPending=(async()=>{
      try {
        const [series,areas]=await Promise.all([get(ROOT+'sm.series').then(r=>r.text()),get(ROOT+'sm.area').then(r=>r.text())]);
        const names=Object.fromEntries(tsv(areas).map(a=>[a.area_code,a.area_name]));
        const catalogs=Object.fromEntries(METROS.map(m=>[m.code,{...selectEmploymentSeries(series,m.code),areaName:names[m.code]??m.name}]));
        const data={version:1,catalogs,fetchedAt:new Date().toISOString()};write('employment-catalog.json',data);return data;
      }catch(e){if(old?.version===1)return old;throw e;}finally{metadataPending=null;}
    })();return metadataPending;
  }
  const pending=new Map();
  async function employment(code) {
    if(!METROS.some(m=>m.code===code))throw new Error('Choose a supported metro');
    const name=`employment-${code}.json`,old=read(name);
    if(old?.version===1&&Date.now()-Date.parse(old.fetchedAt)<DAY)return old;
    if(pending.has(code))return pending.get(code);
    const promise=(async()=>{
      try {
        const catalog=(await metadata()).catalogs[code];
        const ids=[catalog.total,...catalog.sectors.map(s=>s.id),'CEU0000000001',...(catalog.wage?[catalog.wage]:[])];
        const year=new Date().getUTCFullYear();
        const body={seriesid:ids,startyear:String(year-6),endyear:String(year),...(blsKey?{registrationkey:blsKey}:{})};
        const response=await get(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
        const data={version:1,code,areaName:catalog.areaName,...summarizeEmployment(parseBlsSeries(response),catalog),fetchedAt:new Date().toISOString(),stale:false};
        if(!data.partial)write(name,data);
        else if(old)return {...old,stale:true,warning:'The latest employment release was incomplete. Showing the last complete observation set.'};
        return data;
      }catch(e){if(old)return {...old,stale:true,warning:'Employment refresh failed. Showing the last successful observation set.'};throw e;}
      finally{pending.delete(code);}
    })();pending.set(code,promise);return promise;
  }
  function register(server) {
    server.middlewares.use('/api/re-metro-employment',async(req,res,next)=>{
      const url=new URL(req.url||'/','http://localhost');
      // Netlify fork: also accept /api/re-metro-employment/<code>.json, which is
      // how the baked file is addressed. req.url arrives stripped to "/42660.json".
      const viaPath=(url.pathname.match(/^\/([A-Za-z0-9_.-]{1,64}?)(?:\.json)?$/)||[])[1];
      if(url.pathname!=='/'&&!viaPath)return next();
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return;}
      try{res.end(JSON.stringify(await employment(viaPath||url.searchParams.get('code'))));}
      catch(e){res.statusCode=400;res.end(JSON.stringify({error:e.message}));}
    });
  }
  return {employment,register};
}
