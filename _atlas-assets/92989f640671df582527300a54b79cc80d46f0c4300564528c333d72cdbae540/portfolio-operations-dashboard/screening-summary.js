/* Entrata Screening Results Summary 2.0: aggregate evidence, never applicant records. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasScreeningSummary=api;})(typeof window!=='undefined'?window:globalThis,function(){
const text=v=>String(v??'').trim(),num=v=>v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
const iso=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t).toISOString():null;};
function parse(sheets,{fileName='',importIdentity=''}={}){
 const parameters=Object.fromEntries((sheets['Report Parameters']||[]).filter(r=>r[0]&&r[1]).map(r=>[text(r[0]),text(r[1])]));
 if(parameters.Version!=='2.0'||parameters['Report Name']!=='Screening Results Summary'||parameters['Summarize By']!=='Property')throw Error('Screening Results Summary 2.0 summarized by Property is required; applicant drill-ins are not aggregate input.');
 const sourceEffectiveAt=iso(Object.entries(parameters).find(([k])=>/data as of/i.test(k))?.[1]);if(!sourceEffectiveAt)throw Error('Source-effective timestamp required');
 const records=[];
 for(const [sheetName,rows] of Object.entries(sheets)){
  if(sheetName==='Report Parameters')continue;
  const rangeIndex=rows.findIndex(r=>/^\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}$/.test(text(r[0])));
  const community=text(rows[rangeIndex-1]?.[0]),range=text(rows[rangeIndex]?.[0]);const matches=range.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if(!community||!matches)throw Error('Missing community or explicit report dates on '+sheetName);
  const periodStart=`${matches[3]}-${matches[1]}-${matches[2]}`,periodEnd=`${matches[6]}-${matches[4]}-${matches[5]}`;
  const read=(title,fields)=>{let i=title?rows.findIndex(r=>text(r[0])===title):0;i=rows.findIndex((r,j)=>j>i&&text(r[0])==='Property');if(i<0)throw Error('Missing section '+(title||'Results')+' on '+sheetName);const header=rows[i],r=rows[i+1]||[];if(/no data/i.test(text(r[0])))return {availability:'empty',values:null,sourceRow:i+2};if(text(r[0])!==community)throw Error('Source community mismatch on '+sheetName);const values={};for(const [key,label] of Object.entries(fields||Object.fromEntries(header.slice(1).filter(Boolean).map(h=>[h,h])))){const c=header.indexOf(label);const n=num(r[c]);if(c<0||n===null||n<0||!Number.isInteger(n))throw Error('Invalid aggregate '+label+' on '+sheetName);values[key]=n;}return {availability:'reported',values,sourceRow:i+2};};
  const results=read('',{screened:'Screened',inProgress:'In Progress',pass:'Pass',conditional:'Conditional',fail:'Fail'}),failReasons=read('Reasons For Fail'),conditionalReasons=read('Reasons For Conditional'),overrides=read('Overrides',{totalFailed:'Total Failed',pending:'Decision Pending',denied:'Denied',conditional:'Conditional',approved:'Approved'});
  if(results.values){const v=results.values;if(v.screened!==v.inProgress+v.pass+v.conditional+v.fail)throw Error('Screened population does not reconcile on '+sheetName);}
  if(overrides.values){const v=overrides.values;if(v.totalFailed!==v.pending+v.denied+v.conditional+v.approved)throw Error('Override population does not reconcile on '+sheetName);if(results.values&&v.totalFailed!==results.values.fail)throw Error('Failed and override populations differ on '+sheetName);}
  records.push({propertySource:community,sourceSheetName:sheetName,sourceVersion:'2.0',sourceContract:'entrata-screening-summary-2.0',sourceEffectiveAt,periodStart,periodEnd,periodKey:periodStart.slice(0,7)===periodEnd.slice(0,7)?periodStart.slice(0,7):periodStart+'/'+periodEnd,filters:parameters,fileName,importIdentity,results,failReasons,conditionalReasons,overrides});
 }
 return {fileName,importIdentity,sourceEffectiveAt,sourceVersion:'2.0',filters:parameters,records};
}
function select(imports=[],periodKey,scope=[]){const allowed=new Set(scope),groups=new Map();for(const imp of imports){if(imp.deleted_at||imp.deletedAt)continue;for(const r of imp.records||[]){if(r.periodKey!==periodKey||!allowed.has(r.community||r.atlasName||r.propertySource))continue;const key=r.communityId||r.community||r.propertySource,old=groups.get(key),time=r.sourceEffectiveAt;const filterKeys=["Lease Type","Applicant","Summarize By"];const filterContract=x=>JSON.stringify(filterKeys.map(k=>x.filters?.[k]||""));const filters=JSON.stringify(r.filters);if(old&&filterContract(old)!==filterContract(r)){groups.set(key,{...old,conflict:true});continue;}if(!old||time>old.sourceEffectiveAt)groups.set(key,{...r,importIdentity:imp.import_id||r.importIdentity});else if(time===old.sourceEffectiveAt&&JSON.stringify([r.results,r.failReasons,r.conditionalReasons,r.overrides,filters])!==JSON.stringify([old.results,old.failReasons,old.conditionalReasons,old.overrides,JSON.stringify(old.filters)]))groups.set(key,{...old,conflict:true});}}
 return [...groups.values()];}
function summarize(rows=[]){const counts={screened:0,inProgress:0,pass:0,conditional:0,fail:0},overrides={totalFailed:0,pending:0,denied:0,conditional:0,approved:0},failReasons={},conditionalReasons={};let reported=0,empty=0,conflicts=0;for(const r of rows){if(r.conflict){conflicts++;continue;}if(!r.results.values){empty++;continue;}reported++;for(const k in counts)counts[k]+=r.results.values[k]||0;for(const k in overrides)overrides[k]+=r.overrides.values?.[k]||0;for(const [target,source] of [[failReasons,r.failReasons],[conditionalReasons,r.conditionalReasons]])for(const [k,v] of Object.entries(source.values||{}))target[k]=(target[k]||0)+v;}
 return {counts:reported?counts:null,overrides:reported?overrides:null,failReasons,conditionalReasons,reasonEvents:Object.values(failReasons).reduce((a,b)=>a+b,0),reported,empty,conflicts};}
return {parse,select,summarize};
});
