const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('docs/portfolio-operations-dashboard/RISE-Budget-Builder.html','utf8'),ctx=vm.createContext({console,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,Date,URLSearchParams,location:{search:'?investorReader=1'},window:{},setTimeout:()=>0,clearTimeout:()=>{}});
// Load model modules without app boot; browser-specific listeners are stubbed.
ctx.window=ctx;ctx.addEventListener=()=>{};ctx.document={addEventListener:()=>{},querySelector:()=>null,getElementById:()=>null};
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())vm.runInContext(m[1],ctx);
const R=ctx.RBB,K=R.exporter.kit;
let chart=K.groupedH([{label:'Positive',series:[123456,0]},{label:'Negative / unavailable',series:[-12,null]}],{names:['Budget','Actual']});
assert(chart.includes('$123,456'));assert(chart.includes('$0'));assert(chart.includes('($12)'));assert(chart.includes('N/A'));assert.equal((chart.match(/data-series=/g)||[]).length,4);
const base={gl:'5900',name:'Other Income',coaGroup:'OTHER INCOME',nature:'income',lineIds:['one'],hasActual:true,budget:Array(12).fill(100),actual:[null,0,25,...Array(9).fill(null)],ytdBudget:300,ytdActual:null,fullYearBudget:1200};
let vr={propertyId:'p',year:2026,closedThrough:3,rows:[base],canonicalCoverage:{completeYtd:false}};
let review=R.financialReview.build(vr,{periods:{}},{},{period:'ytd'});assert.equal(review.rows[0].actual,null);assert.equal(review.rows[0].variance,null);assert.equal(review.summary.revenue.actual,null);assert.equal(review.trend.revenueActual[0],null);assert.equal(review.trend.revenueActual[1],0);
review=R.financialReview.build(vr,{periods:{}},{},{period:'current'});assert.equal(review.rows[0].actual,25);assert.equal(review.rows[0].variance,-75);
review=R.financialReview.build(vr,{periods:{}},{},{period:'prior'});assert.equal(review.rows[0].actual,0);assert.equal(review.rows[0].variance,-100);
console.log('Report source values, signed bar labels, explicit zero and missing-coverage checks passed');
(async()=>{global.window={parent:{addEventListener(){}},addEventListener(){}};const {installUtilityForecast}=await import('../docs/portfolio-operations-dashboard/features/utility-forecast-ui.mjs');
const state=R.buildState(),p=state.properties[0],draft=state.scenarios.find(s=>!s.locked),approved=state.scenarios.find(s=>s.type==='approved'),line=state.lines.find(l=>l.propertyId===p.id&&l.gl==='6450');
assert(line);const original=JSON.stringify(state.lines);const before=R.engine.computeProperty(state,p.id,approved.id,2026).results[line.id].monthly[0];installUtilityForecast(R,{getSession:()=>({user:{id:'test'}})},{communities:[],resolve:()=>null,locationFor:()=>({})});
draft.utilityForecastOverrides={[p.id+'|2026|6450']:{0:12345}};
assert.equal(R.engine.computeProperty(state,p.id,draft.id,2026).results[line.id].monthly[0],12345);assert.equal(R.engine.computeProperty(state,p.id,approved.id,2026).results[line.id].monthly[0],before);assert.equal(JSON.stringify(state.lines),original,'draft application never mutates approved source lines');console.log('Utility draft isolation and calculation integration passed');})().catch(e=>{console.error(e);process.exitCode=1});
