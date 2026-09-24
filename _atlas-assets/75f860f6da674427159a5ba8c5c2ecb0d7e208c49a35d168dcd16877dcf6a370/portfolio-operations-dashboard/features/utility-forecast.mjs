/* Annual forecasts are changes against the same month in the previous year, never tariffs or usage. */
export const UTILITIES=['electricity','natural_gas','sewer','water'];
export const CROSSWALK={'6450':['electricity'],'6451':['water','sewer'],'6452':['natural_gas'],'6460':['electricity'],'6461':['electricity'],'6463':['water','sewer'],'6464':['natural_gas']};
export const number=v=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
export const key=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export function percentage(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 const s=String(value??'').trim();if(!s)return null;
 const m=s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*%$/);if(m)return Number(m[1])/100;
 // Bare CSV decimals follow XLSX's fractional convention; ambiguous text is not zero.
 return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)?Number(s):null;
}
export function annualTolerance(value){const raw=String(value??'').trim(),n=percentage(value);if(n===null||n===0)return 1e-10;const digits=(raw.replace('%','').split('.')[1]||'').length;return Math.max(1e-10,Math.min(.0005,.5*Math.pow(10,-digits)/(raw.includes('%')?100:1)));}
export function utility(value){return ({electric:'electricity',electricity:'electricity',naturalgas:'natural_gas',gas:'natural_gas',sewer:'sewer',water:'water'})[key(value)]||null;}
export function sourceStatus(values,cancelled=false){
 if(cancelled)return 'Archived/cancelled source';const text=values.join(' ').toLowerCase();
 if(/non[ -]?billed/.test(text))return 'Non-billed utility';
 if(/fixed[ -]?(term|rate)|contract.*rate/.test(text))return 'Fixed-rate contract';
 if(/unavailable|propane|supplier(?:[ -]|only)|tax bill|unassigned|in process|not.available|n\/a/.test(text))return 'Forecast unavailable';
 return 'Eligible';
}
function date(v){if(typeof v==='string'&&/^\d{5}(?:\.\d+)?$/.test(v.trim()))v=Number(v);if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='number')return new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10);const d=new Date(String(v));return Number.isNaN(+d)?null:d.toISOString().slice(0,10);}
export function parseForecast(sheets,{fileName='',fileHash='',resolve=()=>null}={}){
 const errors=[],warnings=[],rows=[];let metadata=null;
 for(const [sheetName,data] of Object.entries(sheets)){
  const h=data.findIndex(r=>r.some(v=>key(v)==='propertyname')&&r.some(v=>key(v)==='utilitytype'));
  if(h<0)continue;
  const header=data[h].map(key),col=name=>header.indexOf(key(name));
  const required=['Property Name','City','State','Utility Type','Utility Provider'];
  for(const name of required)if(col(name)<0)errors.push(`${sheetName}: missing ${name}`);
  const annual=header.findIndex(v=>v.includes('projectedannual'));
  if(annual<0)errors.push(`${sheetName}: missing projected annual percentage`);
  const monthCols=header.map((v,i)=>({m:months.indexOf(v.slice(0,3)),i})).filter(v=>v.m>=0);
  if(monthCols.length!==12||new Set(monthCols.map(v=>v.m)).size!==12){errors.push(`${sheetName}: 12 distinct fiscal months required`);continue;}
  const meta={};for(const row of data.slice(0,h))for(let i=0;i<row.length-1;i++){const k=key(row[i]).replace(/version$/, '');if(['budgettype','completeddateinitial','completeddateupdate'].includes(k))meta[k]=row[i+1];}
  const period=String(meta.budgettype||'').match(/(?:Fiscal Year|FY)\s*(\d{4}).*?(\d{2})\/(\d{2})\/(\d{2,4})\s*-\s*(\d{2})\/(\d{2})\/(\d{2,4})/i);
  if(!period){errors.push(`${sheetName}: fiscal year and dated period required`);continue;}
  const yr=v=>Number(v)<100?2000+Number(v):Number(v),start=`${yr(period[4])}-${period[2]}-${period[3]}`,end=`${yr(period[7])}-${period[5]}-${period[6]}`;
  const periods=Array.from({length:12},(_,i)=>{const d=new Date(start+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+i);return d.toISOString().slice(0,7);});
  if(periods.at(-1)!==end.slice(0,7)||monthCols.some((c,i)=>c.m!==Number(periods[i].slice(5))-1))errors.push(`${sheetName}: monthly columns must follow the declared fiscal period`);
  const local={fiscalYear:Number(period[1]),start,end,periods,initialCompleted:date(meta.completeddateinitial),updateCompleted:date(meta.completeddateupdate)};
  if(!metadata||key(sheetName)==='report')metadata=local;
  const cancelled=/cancelled|canceled|disposed/i.test(sheetName);
  for(let i=h+1;i<data.length;i++){
   const r=data[i];if(!String(r[col('Property Name')]??'').trim())continue;
   const property=String(r[col('Property Name')]).trim(),type=utility(r[col('Utility Type')]);
   const rowCancelled=cancelled||/cancelled|canceled|disposed|archived/i.test(String(r[col('Status')]||''));
   const raw=monthCols.map(c=>r[c.i]),monthly=raw.map(percentage),status=sourceStatus([r[col('Status')],r[col('Utility Provider')],r[annual],...raw],rowCancelled);
   const city=String(r[col('City')]??'').trim(),state=String(r[col('State')]??'').trim().toUpperCase(),provider=String(r[col('Utility Provider')]??'').trim();
   const communityId=resolve(property),annualPercentage=percentage(r[annual]),average=monthly.every(v=>v!==null)?monthly.reduce((s,v)=>s+v,0)/12:null;
   const rowErrors=[];if(!type)rowErrors.push('Unknown utility');if(!city||!/^[A-Z]{2}$/.test(state)||!provider)rowErrors.push('City, state and provider required');
   if(status==='Eligible'&&(average===null||annualPercentage===null))rowErrors.push('Missing or invalid percentage');
   if(average!==null&&annualPercentage!==null&&Math.abs(average-annualPercentage)>annualTolerance(r[annual]))rowErrors.push('Annual percentage does not reconcile to 12-month average');
   if(monthly.some(v=>v!==null&&v< -1))rowErrors.push('Forecast below -100%');
   if(!rowCancelled&&!communityId)warnings.push(`${sheetName} row ${i+1}: canonical community mapping required; excluded from active matching`);
   rows.push({property,communityId,type,city,state,provider,analyst:String(r[col('Assigned To')]??''),monthly:status==='Eligible'?monthly:Array(12).fill(null),annual:status==='Eligible'?average:null,reportedAnnual:annualPercentage,annualTolerance:annualTolerance(r[annual]),status:status==='Eligible'&&average===null?'Forecast unavailable':status,cancelled:rowCancelled,sheet:sheetName,row:i+1,raw,validation:rowErrors});
   rowErrors.forEach(e=>errors.push(`${sheetName} row ${i+1} ${property}: ${e}`));
  }
 }
 if(!metadata)errors.push('No forecast header and fiscal metadata found');
 const seen=new Set();for(const r of rows){const k=key(r.property)+'|'+r.type;if(seen.has(k))errors.push(`Duplicate property/utility: ${r.property} / ${r.type}`);seen.add(k);}
 if(metadata&&!metadata.initialCompleted)errors.push('Initial completion date required');
 if(metadata?.updateCompleted&&metadata.updateCompleted<metadata.initialCompleted)errors.push('Update precedes initial completion');
 rows.filter(r=>!r.cancelled&&r.status!=='Eligible').forEach(r=>warnings.push(`${r.property} / ${r.type}: ${r.status}`));
 return {schemaVersion:1,fileName,fileHash,...metadata,version:metadata?.updateCompleted?'updated':'initial',completed:metadata?.updateCompleted||metadata?.initialCompleted,rows,validation:{errors,warnings},counts:{active:rows.filter(r=>!r.cancelled).length,cancelled:rows.filter(r=>r.cancelled).length,properties:new Set(rows.filter(r=>!r.cancelled).map(r=>r.property)).size}};
}
export function reconcile(previous,next){
 if(previous&&(previous.fiscalYear!==next.fiscalYear||previous.start!==next.start||previous.end!==next.end))throw Error('Different fiscal periods cannot replace each other');
 const before=new Map((previous?.rows||[]).map(r=>[key(r.property)+'|'+r.type,r]));
 return next.rows.filter(r=>!r.cancelled&&before.has(key(r.property)+'|'+r.type)).filter(r=>{const b=before.get(key(r.property)+'|'+r.type);return JSON.stringify([b.monthly,b.provider,b.status,b.analyst,b.city,b.state])!==JSON.stringify([r.monthly,r.provider,r.status,r.analyst,r.city,r.state]);}).map(r=>({property:r.property,type:r.type,before:before.get(key(r.property)+'|'+r.type).monthly,after:r.monthly}));
}
export function canActivate(next,current){return !next.validation.errors.length&&(!current||(next.fiscalYear===current.fiscalYear&&next.completed>current.completed));}
export function matchForecast(rows,{communityId,type,location={},provider='',territory,manualRow,approvePeer=false}={}){
 const candidates=rows.filter(r=>!r.cancelled&&r.communityId&&r.type===type),eligible=r=>r.status==='Eligible'&&r.monthly.every(v=>number(v)!==null);
 const exact=candidates.find(r=>r.communityId===communityId);
 const result=(row,method,confidence)=>({row,method,confidence,location:{...location},provider:row?.provider||provider,status:row?(method==='Exact property forecast'?method:method==='User-selected proxy'?method:'Area/provider forecast'):'Forecast unavailable'});
 if(exact&&eligible(exact))return result(exact,'Exact property forecast','High');
 if(exact&&['Non-billed utility','Fixed-rate contract'].includes(exact.status))return {...result(exact,exact.status,'High'),status:exact.status};
 const sameProvider=r=>provider&&key(r.provider)===key(provider),sameCity=r=>location.city&&location.state&&key(r.city)===key(location.city)&&key(r.state)===key(location.state);
 const levels=[['Configured provider territory',r=>sameProvider(r)&&territory?.(r,location)],['ZIP/provider',r=>sameProvider(r)&&location.zip&&r.zip===location.zip],['City/state/provider',r=>sameProvider(r)&&sameCity(r)]];
 for(const [method,test] of levels){const found=candidates.filter(r=>eligible(r)&&test(r));if(found.length===1)return result(found[0],method,'Medium');if(found.length>1)return {...result(null,'Manual selection required','Unresolved'),candidates:found};}
 if(manualRow){const r=candidates.find(r=>r.sheet===manualRow.sheet&&r.row===manualRow.row);if(r&&eligible(r)&&(sameProvider(r)||approvePeer))return result(r,'User-selected proxy','User approved');}
 return {...result(null,'Forecast unavailable','Unresolved'),candidates:candidates.filter(r=>eligible(r)&&sameCity(r)),sourceStatus:exact?.status};
}
export function recommend({forecast,month,usage=null,tariff=null,fixed=0,demand=0,historicalCost=null,historicalFixed=0,occupancyFactor=1,unitFactor=1,seasonalityFactor=1,operationalFactor=1,basis=null}){
 const pct=number(forecast),common={forecast:pct,month,basis};
 if(pct===null)return {...common,cost:null,method:'Forecast unavailable'};
 if([fixed,demand,historicalFixed,occupancyFactor,unitFactor,seasonalityFactor,operationalFactor].some(v=>number(v)===null||v<0))return {...common,cost:null,method:'Review normalization assumptions'};
 if(number(usage)!==null&&number(tariff)!==null)return {...common,cost:usage*tariff*(1+pct)+fixed+demand,method:'Projected usage × effective tariff × (1 + monthly forecast) + fixed + demand',inputs:{usage,tariff,fixed,demand}};
 if(number(historicalCost)===null||!basis)return {...common,cost:null,method:'Prior-year same-month cost unavailable'};
 const normalized=(historicalCost-historicalFixed)*occupancyFactor*unitFactor*seasonalityFactor*operationalFactor;
 return {...common,cost:normalized*(1+pct)+historicalFixed,method:'Normalized prior-year same-month variable cost × (1 + monthly forecast) + known fixed charges',inputs:{historicalCost,historicalFixed,occupancyFactor,unitFactor,seasonalityFactor,operationalFactor}};
}
export function blendedForecast(water,sewer,allocation){
 if(number(water)===null||number(sewer)===null||number(allocation?.water)===null||number(allocation?.sewer)===null||allocation.water<0||allocation.sewer<0||allocation.water+allocation.sewer<=0||!allocation.source)return null;
 return (water*allocation.water+sewer*allocation.sewer)/(allocation.water+allocation.sewer);
}
export function actualMetrics(row){const cost=number(row.totalCost),usage=number(row.usage),occupied=number(row.occupiedUnits);return {...row,usage,costPerOccupiedUnit:cost!==null&&occupied>0?cost/occupied:null,usagePerOccupiedUnit:usage!==null&&occupied>0?usage/occupied:null,usageStatus:usage===null?'Actual usage unavailable':row.estimated?'Estimated usage':'Bill-confirmed usage'};}
export function communityLocation(record={}){const address=typeof record.address==='string'?record.address:record.communityAddress||record.propertyAddress||'',m=address.match(/,\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i);return {city:record.communityCity||record.city||record.address?.city||m?.[1]?.trim()||'',state:record.communityState||record.state||record.address?.state||m?.[2]||'',zip:record.communityZip||record.zip||record.zipCode||record.address?.zip||m?.[3]||''};}
