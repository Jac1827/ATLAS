const {readDashboardSource}=require('./dashboard-source.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=readDashboardSource(__dirname+'/../docs/portfolio-operations-dashboard/index.html') + '\n' + fs.readFileSync(__dirname + '/../docs/portfolio-operations-dashboard/features/bonus-workspace.js', 'utf8');
const extract=(name,next)=>source.slice(source.indexOf('function '+name+'('),source.indexOf('\nfunction '+next+'(',source.indexOf('function '+name+'(')));
let computed=[],agingReads=0;
const ctx={bonusQuarter:3,atlasBonusState:()=>({filters:{}}),atlasBonusPeriodFromQuarter:()=>({}),atlasBonusAuthorizedEmployees:()=>[{employeeId:'a',email:'a@example.test'},{employeeId:'b',email:'b@example.test'}],atlasBonusBuildRow:e=>(computed.push(e.employeeId),{employee:e}),getAtlasApplicationAgingRows:()=>{agingReads++;return []},getAtlasAccessProfile:()=>({employee_id:'b'}),getAtlasCentralStatus:()=>({}),Date};
vm.createContext(ctx);vm.runInContext(extract('atlasBonusBuildCalculationRows','atlasBonusSummary')+extract('atlasBonusPersonalRows','atlasBonusPersonalProjection'),ctx);
assert.equal(ctx.atlasBonusPersonalRows()[0].employee.employeeId,'b');assert.deepEqual(computed,['b']);
computed=[];agingReads=0;ctx.getAtlasAccessProfile=()=>({employee_id:'absent'});assert.equal(ctx.atlasBonusPersonalRows().length,0);assert.deepEqual(computed,[]);assert.equal(agingReads,0);
ctx.getAtlasAccessProfile=()=>({email:' A@EXAMPLE.TEST '});assert.equal(ctx.atlasBonusPersonalRows()[0].employee.employeeId,'a');
const reskin=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/atlas-dashboard-reskin.js','utf8');
assert.match(reskin, /instance.widgetKey==='projected_bonus'\?null:buildAtlasDashboardWidgetSnapshot\(instance\)/, 'Personal bonus skips unrelated portfolio snapshot construction');
console.log('PASS personal identity filtering before calculation, no substitute payout, no unused bonus portfolio snapshot');

let builds=0;ctx.savedData={};ctx.buildPortfolioDetailsForMonth=(month,records,year,options)=>{
  assert.equal(records,ctx.savedData);assert.equal(year,new Date().getFullYear());
  assert.equal(options.includeRecommendations,false,'Home skips recommendations while preserving the report builder default');
  builds++;return [{month}];
};
vm.runInContext('let atlasHomeRenderDetails=null;'+extract('atlasHomePortfolioDetails','getAtlasDashboardAuthorizedCommunityOptions'),ctx);
vm.runInContext('atlasHomeRenderDetails=new Map()',ctx);
assert.equal(ctx.atlasHomePortfolioDetails(8),ctx.atlasHomePortfolioDetails(8));assert.equal(builds,1);
ctx.atlasHomePortfolioDetails(7);assert.equal(builds,2);
vm.runInContext('atlasHomeRenderDetails=null',ctx);ctx.atlasHomePortfolioDetails(8);assert.equal(builds,3);
assert.match(extract('renderAtlasWelcomeDashboard','buildAtlasCentralPeoplePayload'),/finally \{ atlasHomeRenderDetails = previous/);

assert.match(extract('renderAtlasPersonalBonusLandingWidget','renderBonusMyBonusSection'),/!primary \? "Not available"/);

const nav=extract('atlasBonusSetSection','renderAtlasBonusAgingDisclosure');
assert(!nav.includes('persistOpsGlobalData'));assert(!nav.includes('atlasBonusBuildCalculationRows'));
assert(nav.includes('atlasBonusSectionCache.has(section)'));
