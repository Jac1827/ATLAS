const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/index.html','utf8');
const extract=(name,next)=>source.slice(source.indexOf('function '+name+'('),source.indexOf('\nfunction '+next+'(',source.indexOf('function '+name+'(')));
let computed=[];
const ctx={bonusQuarter:3,atlasBonusState:()=>({filters:{}}),atlasBonusPeriodFromQuarter:()=>({}),atlasBonusAuthorizedEmployees:()=>[{employeeId:'a',email:'a@example.test'},{employeeId:'b',email:'b@example.test'}],atlasBonusBuildRow:e=>(computed.push(e.employeeId),{employee:e}),getAtlasApplicationAgingRows:()=>[],getAtlasAccessProfile:()=>({employee_id:'b'}),getAtlasCentralStatus:()=>({}),Date};
vm.createContext(ctx);vm.runInContext(extract('atlasBonusBuildCalculationRows','atlasBonusSummary')+extract('atlasBonusPersonalRows','atlasBonusPersonalProjection'),ctx);
assert.equal(ctx.atlasBonusPersonalRows()[0].employee.employeeId,'b');assert.deepEqual(computed,['b']);
computed=[];ctx.getAtlasAccessProfile=()=>({employee_id:'absent'});assert.equal(ctx.atlasBonusPersonalRows().length,0);assert.deepEqual(computed,[]);
ctx.getAtlasAccessProfile=()=>({email:' A@EXAMPLE.TEST '});assert.equal(ctx.atlasBonusPersonalRows()[0].employee.employeeId,'a');
const widget=extract('renderAtlasDashboardHomeWidget','atlasDashboardHomeSlotClass');
assert(widget.indexOf('return renderAtlasPersonalBonusLandingWidget')<widget.indexOf('buildAtlasDashboardWidgetSnapshot'));
console.log('PASS personal identity filtering before calculation, no substitute payout, no unused bonus portfolio snapshot');

let builds=0;ctx.buildPortfolioDetailsForMonth=month=>(builds++, [{month}]);
vm.runInContext('let atlasHomeRenderDetails=null;'+extract('atlasHomePortfolioDetails','getAtlasDashboardAuthorizedCommunityOptions'),ctx);
vm.runInContext('atlasHomeRenderDetails=new Map()',ctx);
assert.equal(ctx.atlasHomePortfolioDetails(8),ctx.atlasHomePortfolioDetails(8));assert.equal(builds,1);
ctx.atlasHomePortfolioDetails(7);assert.equal(builds,2);
vm.runInContext('atlasHomeRenderDetails=null',ctx);ctx.atlasHomePortfolioDetails(8);assert.equal(builds,3);
assert.match(extract('renderAtlasWelcomeDashboard','buildAtlasCentralPeoplePayload'),/finally \{ atlasHomeRenderDetails = previous/);

assert.match(extract('renderAtlasPersonalBonusLandingWidget','renderBonusMyBonusSection'),/!primary \? "Not available"/);
