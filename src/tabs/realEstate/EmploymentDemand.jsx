import React,{useEffect,useState} from 'react';
import {ResponsiveContainer,LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,ReferenceLine,Legend} from 'recharts';
const finite=Number.isFinite;
const pct=v=>finite(v)?`${v>=0?'+':''}${v.toFixed(1)}%`:'—';
const num=v=>finite(v)?Math.round(v).toLocaleString():'—';
const signed=v=>finite(v)?`${v>=0?'+':''}${num(v)}`:'—';
const month=d=>d?new Date(d.slice(0,7)+'-01T00:00:00').toLocaleString('en-US',{month:'short',year:'numeric'}):'Date unavailable';
const tip={background:'var(--tooltip-bg)',border:'1px solid var(--border-subtle)',borderRadius:4,fontFamily:'var(--font-number)',fontSize:12};

export function EmploymentEvidence({focus,data}) {
  const [type,setType]=useState('multi'),[years,setYears]=useState(5);
  const rents=type==='all'?focus.history:focus.rentTypes?.[type]?.history;
  const merged={};
  for(const p of data.history||[])merged[p.date]={date:p.date,jobs:p.yoy,national:p.nationalYoy};
  for(const p of rents||[])(merged[p.date]??={date:p.date}).rent=p.rentYoy;
  const chart=Object.values(merged).sort((a,b)=>a.date.localeCompare(b.date)).slice(-12*years);
  const paired=chart.filter(p=>finite(p.jobs)&&finite(p.rent)).at(-1);
  const sectors=[...(data.sectors||[])].sort((a,b)=>(b.change??-Infinity)-(a.change??-Infinity));
  const available=sectors.filter(s=>finite(s.change)),maxChange=Math.max(1,...available.map(s=>Math.abs(s.change)));
  const leader=available[0]?.change>0?available[0]:null,laggard=available.at(-1)?.change<0?available.at(-1):null;
  const latest=data.latest,wage=data.wage;
  function download(){
    const columns=['Metro','BLS area','Month','Industry','Jobs','Jobs change over year','Jobs growth percent','Share of total jobs percent','Contribution to total growth percentage points','Preliminary','BLS series'];
    const body=sectors.map(s=>[focus.name,data.areaName,s.date,s.name,s.jobs,s.change,s.yoy,s.share,s.contribution,s.preliminary,s.id]);
    const csv=[columns,...body].map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download=`ledger-employment-${focus.code}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <>
    {data.stale&&<div className="lab-insight" role="status">{data.warning}</div>}
    {data.partial&&<div className="lab-insight" role="status">Some employment series are unavailable. Industry figures use the total-employment observation month; missing comparisons remain blank.</div>}
    {latest?.date&&Date.now()-Date.parse(latest.date+'-01')>100*86400000&&<div className="lab-insight" role="status">The latest available employment observation is more than three months old.</div>}
    <section className="lab-panel"><div className="lab-section-top"><div><div className="market-edition">Demand / payroll employment</div><h2 style={{marginTop:8}}>Are jobs supporting rental demand?</h2></div><span className="lab-tag">{month(latest?.date)}{latest?.preliminary?' · preliminary':''}</span></div>
      <div className="employment-facts"><div><span>Local jobs · year over year</span><strong>{pct(latest?.yoy)}</strong><small>U.S. {pct(latest?.nationalYoy)} in the same month</small></div><div><span>Jobs added over the year</span><strong>{signed(latest?.change)}</strong><small>{num(latest?.jobs)} total payroll jobs</small></div><div><span>Private hourly earnings · YoY</span><strong>{pct(wage?.yoy)}</strong><small>{finite(wage?.value)?`$${wage.value.toFixed(2)} average · ${month(wage.date)}${wage.preliminary?' · preliminary':''}`:'Hourly earnings series unavailable'}</small></div></div>
      <div className="market-chart-controls"><label className="lab-field">Compare employment with<select value={type} onChange={e=>setType(e.target.value)}><option value="multi">Multifamily asking rents</option><option value="single">Single-family asking rents</option><option value="all">All asking rents</option></select></label><div className="market-segment employment-range" aria-label="Employment history length">{[3,5].map(y=><button key={y} aria-pressed={years===y} onClick={()=>setYears(y)}>{y}Y</button>)}</div></div>
      <div className="lab-chart" style={{height:320}}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{top:14,left:-8,right:15,bottom:5}}><CartesianGrid vertical={false} stroke="var(--border-subtle)"/><XAxis dataKey="date" ticks={chart.filter(p=>p.date.endsWith('-01')).map(p=>p.date)} tickFormatter={v=>v.slice(0,4)} axisLine={false} tickLine={false} stroke="var(--text-secondary)"/><YAxis tickFormatter={v=>`${v}%`} width={50} axisLine={false} tickLine={false} stroke="var(--text-secondary)"/><ReferenceLine y={0} stroke="var(--text-muted)"/><Tooltip labelFormatter={month} formatter={(v,n)=>[pct(v),n]} contentStyle={tip}/><Legend wrapperStyle={{fontSize:13}}/><Line dataKey="jobs" name={`${focus.name} jobs`} stroke="var(--chart-blue)" strokeWidth={2.6} dot={false} isAnimationActive={false}/><Line dataKey="rent" name="Asking rents" stroke="var(--chart-gold)" strokeWidth={2.6} dot={false} isAnimationActive={false}/><Line dataKey="national" name="U.S. jobs" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>
      <div className="lab-insight"><strong>{paired?`${month(paired.date)}: jobs ${pct(paired.jobs)}, asking rents ${pct(paired.rent)}`:'No matching rent and employment observations'}</strong><p>{paired&&paired.jobs>0&&paired.rent<0?'Jobs are expanding while asking rents remain below last year. Investigate deliveries, concessions, and household formation before assuming employment growth will translate into rent growth.':paired&&paired.jobs<0&&paired.rent>0?'Asking rents are rising alongside a smaller payroll base. Check the durability of tenant demand and the timing of supply.':'Employment provides one check on rental demand. Supply, migration, household formation, and affordability also influence leasing conditions.'}</p></div>
      <p className="lab-note">All plotted changes are year over year. Employment is not seasonally adjusted; rents are smoothed and seasonally adjusted. Observations are joined by calendar month without filling gaps. These co-movements do not establish causation.</p>
    </section>
    <section className="lab-panel"><div className="lab-section-top"><div><div className="market-edition">Demand / industry mix</div><h2 style={{marginTop:8}}>Where are jobs being added or lost?</h2></div><button className="lab-button" onClick={download}>Export industry data ↓</button></div>
      <p className="lab-note">{available.filter(s=>s.change>0).length} of {available.length} comparable industries added jobs over the year to {month(latest?.date)}. Industry size is shown as a share of all local payroll jobs.</p>
      {leader&&<p className="employment-reading"><strong>{leader.name}</strong> added the most jobs among the industries shown ({signed(leader.change)}). {laggard&&<><strong>{laggard.name}</strong> had the largest decline ({signed(laggard.change)}).</>}</p>}
      <div className="lab-table-wrap"><table className="lab-table employment-table"><thead><tr><th>Industry</th><th>Annual jobs change</th><th>Jobs YoY</th><th>Share of local jobs</th></tr></thead><tbody>{sectors.map(s=><tr key={s.code}><td>{s.name}</td><td><span>{signed(s.change)}</span><div className="employment-bar" aria-hidden="true"><i style={{left:s.change<0?`${50-Math.abs(s.change)/maxChange*50}%`:'50%',width:`${finite(s.change)?Math.abs(s.change)/maxChange*50:0}%`,background:s.change<0?'var(--chart-red)':'var(--chart-blue)'}}/></div></td><td>{pct(s.yoy)}</td><td>{finite(s.share)?`${s.share.toFixed(1)}%`:'—'}</td></tr>)}</tbody></table></div>
      <p className="lab-note">Broad industries are mutually exclusive; combined mining/construction is used where published. Missing industries and rounding can prevent totals from reconciling exactly. “Information” is an industry classification, not a count of all technology workers.</p>
    </section>
    <details className="lab-panel"><summary>Employment sources and interpretation</summary><p className="lab-note"><a href="https://www.bls.gov/sae/data/" target="_blank" rel="noreferrer">BLS Current Employment Statistics</a>, {data.areaName}. Counts reflect jobs at local workplaces, including commuters and multiple jobholders, rather than resident workers or households. Recent estimates are preliminary and historical figures can be revised.</p><p className="lab-note">Hourly earnings cover private-sector employees and are nominal averages. Changes can reflect the mix of workers and industries; they are not a direct measure of renter income or wage increases for the same workers. Geography follows the BLS metro series and can differ from historical Zillow boundaries.</p><p className="lab-note">Total employment: <a href={`https://data.bls.gov/timeseries/${data.catalog.total}`} target="_blank" rel="noreferrer">{data.catalog.total}</a>. National comparison: <a href="https://data.bls.gov/timeseries/CEU0000000001" target="_blank" rel="noreferrer">CEU0000000001</a>. {data.catalog.wage&&<>Hourly earnings: <a href={`https://data.bls.gov/timeseries/${data.catalog.wage}`} target="_blank" rel="noreferrer">{data.catalog.wage}</a>.</>} Retrieved {data.fetchedAt?.slice(0,10)}. Industry downloads include each source series.</p></details>
  </>;
}

export default function EmploymentDemand({focus}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setError('');
    fetch(`/api/re-metro-employment/${encodeURIComponent(focus.code)}`,{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Employment data is unavailable');return d;}).then(d=>{if(!controller.signal.aborted)setData(d);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>controller.abort();
  },[focus.code,retry]);
  if(error)return <div className="lab-empty" role="status"><h2>Employment data unavailable</h2><p>{error}</p><button className="lab-button" onClick={()=>setRetry(v=>v+1)}>Retry employment data</button></div>;
  if(data?.code!==focus.code)return <div className="lab-empty" role="status">Loading payroll employment and industry detail for {focus.name}…</div>;
  return <EmploymentEvidence key={focus.code} focus={focus} data={data}/>;
}
