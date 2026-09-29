import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildStrProgrammeReport,strProgrammeExport} from '../docs/portfolio-operations-dashboard/features/saved-str-programmes.mjs';
import {retainedSnapshot} from '../docs/portfolio-operations-dashboard/features/financial-snapshot.mjs';
const XLSX=createRequire(import.meta.url)('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
globalThis.XLSX=XLSX;
const long='A long retained note with 🧭 中文 and spaces.\n'.repeat(160);
const applied={name:'Original name',adr:190.123456789,occupancy:0,identifier:'00012',decimalText:'1.2300',dateText:'2026-09-29',literalJson:'{"not":"structured"}',nothing:null,emptyObject:{},emptyArray:[],driverMeta:{adr:{source:'Exact source',notes:long}},adrMonthly:{2026:[0,null,-1.25]},'slash/key':{'tilde~key':false}};
Object.defineProperty(applied,'constructor',{value:'Literal constructor key',enumerable:true});
const proposed={...applied,adr:205,driverMeta:{notes:long+' Proposed.'}};
const lines=[{id:'a',propertyId:'p',strProgramId:'s',gl:'005144',name:'Retained income',nature:'income',yearData:{2026:[0,null,-1.23456789,...Array(9).fill(123456.789123)]}},{id:'b',propertyId:'p',strProgramId:'s',gl:'006200',name:'Retained cost',nature:'expense',yearData:{2026:Array(12).fill(-45.123456789)}}];
function record(config,proposedConfig=null){const report=buildStrProgrammeReport({name:'Exact saved programme',communityName:'Example',years:[2026],lines,config,proposedConfig});return {head:{community_id:'community',programme_id:'programme'},revision:{revision_id:'revision',revision:3,content_hash:'a'.repeat(64),payload:{name:report.name,years:[2026],sourcePropertyId:'p',sourceProgrammeId:'s',lines,config:proposedConfig||config,reportBasisConfig:config,configurationChangedSinceApplied:Boolean(proposedConfig),reportSnapshot:report}}};}
for(const [name,r] of [['applied',record(applied)],['proposed',record(applied,proposed)],['empty',record(null)]]){
 const before=structuredClone(r),report=r.revision.payload.reportSnapshot,result=await strProgrammeExport(r,'xlsx'),read=XLSX.read(result.bytes,{type:'array',cellNF:true,cellStyles:true});
 assert.deepEqual(r,before,'Export never mutates the saved record');
 const exact={'Monthly STR':report.monthly,'STR GL detail':report.rows.map(({sourceLineId,...row})=>row),'Applied assumptions':report.assumptions,'Proposed driver edits':report.proposedAssumptions,'Calculation status':[{status:report.status,note:report.calculationNote}]};
 for(const [sheet,rows] of Object.entries(exact))assert.deepEqual(XLSX.utils.sheet_to_json(read.Sheets[sheet],{defval:null}),rows,name+' '+sheet+' exact retained data');
 const fingerprint=retainedSnapshot({kind:'saved_str_programme_draft',identity:{communityId:'community',programmeId:'programme',revisionId:'revision',version:3,contentHash:'a'.repeat(64),status:report.status},values:report}).fingerprint;
 assert(XLSX.utils.sheet_to_json(read.Sheets['RISE Report'],{header:1}).flat().includes(fingerprint));
 assert(read.SheetNames.indexOf('Assumptions detail')<read.SheetNames.indexOf('Applied assumptions'));
 const detail=XLSX.utils.sheet_to_json(read.Sheets['Assumptions detail'],{defval:null});
 if(name==='empty')assert.deepEqual(detail,[]);
 else {
  for(const [basis,cfg,sheet] of [['Applied',applied,'Applied assumptions'],...(name==='proposed'?[['Proposed — not applied',proposed,'Proposed driver edits']]:[])]){
   const canonical=exact[sheet],groups=[];for(const row of detail.filter(x=>x.Basis===basis)){if(row.Part.startsWith('1 / '))groups.push([]);groups.at(-1).push(row);}
   for(const group of groups){const index=Number(group[0]['Original cell'].match(/B(\d+)$/)[1])-2,key=canonical[index].name,path=group.map(x=>x.Detail||'').join(''),value=group[0].Type==='string'?group.map(x=>x.Value??'').join(''):group[0].Value;
    let original=cfg[key];if(path)for(const p of path.slice(1).split('/'))original=original[p.replace(/~1/g,'/').replace(/~0/g,'~')];
    assert.deepEqual(value,original!==null&&typeof original==='object'?JSON.stringify(original):original,'Lossless typed leaf and continuation');
    assert.equal(group.map(x=>x.Source||'').join(''),canonical[index].source,'Lossless source continuation');
   }
  }
  assert(detail.some(row=>row.Type==='null'&&row.Value===null));assert(detail.some(row=>row.Type==='number'&&row.Value===0));
  assert(detail.some(row=>row.Type==='string'&&row.Value==='00012'));assert(detail.some(row=>row.Type==='string'&&row.Value==='1.2300'));assert(detail.some(row=>row.Type==='string'&&row.Value==='2026-09-29'));assert(detail.some(row=>row.Value==='{"not":"structured"}'));
  assert(detail.some(row=>row.Assumption==='Constructor'&&row.Value==='Literal constructor key'));
 }
 const zip=XLSX.CFB.read(result.bytes,{type:'buffer'}),text=p=>new TextDecoder().decode(XLSX.CFB.find(zip,'Root Entry/'+p).content),styles=text('xl/styles.xml');
 assert(styles.includes('wrapText="1"'));assert(styles.includes('vertical="top"'));assert(styles.includes('horizontal="right"'));
 for(let i=1;i<=read.SheetNames.length;i++){const xml=text('xl/worksheets/sheet'+i+'.xml');for(const m of xml.matchAll(/\bht="([\d.]+)"/g))assert(Number(m[1])<=409);for(const m of xml.matchAll(/\bwidth="([\d.]+)"/g))assert(Number(m[1])<=255);if(i<read.SheetNames.length){assert(xml.includes('orientation="landscape"'));assert(xml.includes('state="frozen"'));}}
 assert(read.Sheets['Calculation status']['!cols'][0].wch>=38);if(name!=='empty')assert(read.Sheets['Applied assumptions']['!cols'][0].wch>=38);
 const monetary=Object.values(read.Sheets['STR GL detail']).find(cell=>cell?.t==='n'&&cell.v===-1.23456789);assert.equal(monetary.z,'#,##0.00;[Red]-#,##0.00;0.00');
 for(const sheet of Object.values(read.Sheets))for(const [cell,value] of Object.entries(sheet))if(!cell.startsWith('!'))assert(!value.f,'Static retained workbook introduces no formulas');
 console.log('PASS '+name+' exact retained report, typed readable assumptions, lossless continuation, native layout limits and unchanged fingerprint');
}
