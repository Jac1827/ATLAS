const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const fn=name=>{const match=source.match(new RegExp('^function '+name+'\\([^]*?^\\}','m'));assert(match,name);return match[0];};
const role=(id,ora=83)=>({id,title:'Synthetic manager',name:'Synthetic',group:'Leadership',salary:40000,bonusRate:10,metrics:[
 {cat:'ORA',syncKey:'oraScore',actual:ora,goal:62,weight:20,format:'decimal'},
 {cat:'Known hit',syncKey:'known',actual:80,goal:70,weight:50},
 {cat:'Known miss',actual:0,goal:10,weight:30}
]});
const property={Q1:[role('manager',83)],Q2:[role('manager',0)],Q3:[role('manager',92)],Q4:[role('manager',76)]},team=[role('regional_test',88)];
const originalProperty=JSON.stringify(property),originalTeam=JSON.stringify(team);let persisted=null,csv='';
const stop=Error('Unrelated render tail');
const context={bonusRolesByQ:property,jacsTeamBonus:team,bonusQuarter:'Q4',getProp:()=>({name:'Synthetic A'}),
 getJacRoleScope:()=>({savedNames:['Synthetic A'],metrics:{totalUnits:100},explicitAssignments:[]}),getJacsAutoMetrics:()=>({oraScore:99,known:80}),
 persistOpsGlobalData:()=>persisted=JSON.stringify(team),isCombinedAbsorptionMetric:()=>false,
 syncSharedPeopleAssignments:()=>{},syncPropertyBonusStructureFromSharedAssignments:()=>{},syncAbsorptionMetricsFromMonthlyData:()=>{},syncPropertyMsoeMetrics:()=>{},
 getCommissionAgents:()=>[],calcCommissionPayout:()=>({agentPayouts:[]}),getQuarterlyAbsorptionTotals:()=>({}),getBonusRoleAssignmentBySlot:()=>({}),
 getEarnedMetricDetails:()=>[],getBonusRoleDisplayContext:()=>({name:'Synthetic',title:'Manager',communityName:'Synthetic A'}),
 MONTHS:['October'],currentMonth:0,regionalAssignments:{},isMarketingManagedJacRole:()=>false,isSalaryAccessAllowed:()=>true,salarySecurity:{enabled:false},
 renderRegionalAssignmentMatrix:()=>{throw stop;},escapeHtml:String,resolveExportBrandLogoSrc:()=>'',atlasBonusSafeSpreadsheetCell:value=>value,
 Blob:class{constructor(parts){csv=parts.join('');}},URL:{createObjectURL:()=>''},document:{createElement:()=>({click(){}})}};
vm.createContext(context);
for(const name of ['getAtlasQuarterOra','deriveAtlasReputationBonusRole','syncPropertyOraMetrics','roundJacMetricValue','syncJacsTeamMetricsFromDashboard','getMetricOutcome','isVpCommunityBudgetMetric','getJacMetricScoring','calcRolePayout','getBonusExportData','exportBonusPayoutCSV','buildBonusPayoutReportDocument','renderPropertyBonusTab','renderJacsTeamBonusTab'])vm.runInContext(fn(name),context);
for(const name of ['getBonusRoles','getJacsTeamRoles'])vm.runInContext(source.match(new RegExp('^function '+name+'.*$','m'))[0],context);
const derived=context.syncPropertyOraMetrics();
for(const quarter of Object.keys(property)){
 assert.equal(derived[quarter][0].metrics[0].actual,null);assert.notEqual(derived[quarter][0],property[quarter][0]);
 const payout=context.calcRolePayout(derived[quarter][0]);assert.equal(payout.earned,500);assert.equal(payout.pending,200);assert.equal(payout.missed,300);assert.equal(payout.incomplete,true);
}
assert.equal(JSON.stringify(property),originalProperty,'Derived scoring never changes quarter histories or metric payout fields');
assert.equal(context.getBonusRoles(),property.Q4,'Editing still receives the stored role array');assert.equal(context.getJacsTeamRoles(),team);
const teamDerived=context.syncJacsTeamMetricsFromDashboard();assert.equal(teamDerived[0].metrics[0].actual,null);assert.equal(persisted,originalTeam,'Automatic persistence retains saved ORA');
context.calcRolePayout(teamDerived[0]);assert.equal(JSON.stringify(team),originalTeam);
const exported=context.getBonusExportData();assert.equal(exported.roleEmployees.length,4);
for(const row of exported.roleEmployees){assert.equal(row.quarterlyPayout,500);assert.equal(row.pendingPotential,200);assert.equal(row.incomplete,true);}
assert.equal(JSON.stringify(property),originalProperty,'Export preparation preserves all saved quarter actuals');
const html=context.buildBonusPayoutReportDocument();assert.match(html,/Earned subtotal \(incomplete\)/);assert.match(html,/Reputation pending: \$200\.00/);assert.doesNotMatch(html,/Total Payout Due/);
context.exportBonusPayoutCSV();assert.match(csv,/calculation_status/);assert.match(csv,/Incomplete - reputation pending/);assert.match(csv,/"200"/);
// Execute the shipped render setup through all reputation preparation and scoring.
const agents=context.getCommissionAgents;context.getCommissionAgents=()=>{throw stop;};assert.throws(()=>context.renderPropertyBonusTab(),error=>error===stop);context.getCommissionAgents=agents;
assert.throws(()=>context.renderJacsTeamBonusTab(),error=>error===stop);
assert.equal(JSON.stringify(property),originalProperty);assert.equal(JSON.stringify(team),originalTeam);assert.equal(persisted,originalTeam);
// A measured zero remains a scored miss; positive actuals retain the existing tiers.
for(const [actual,earned,missed] of [[0,500,500],[80,700,300]]){
 const scored=context.deriveAtlasReputationBonusRole(property.Q4[0],actual),payout=context.calcRolePayout(scored);
 assert.equal(payout.earned,earned);assert.equal(payout.missed,missed);assert.equal(payout.pending,0);assert.equal(payout.incomplete,false);
}
console.log('PASS reputation bonus preparation preserves saved quarter/team history and edit references; pending potential stays separate from known missed amounts; HTML/CSV show incomplete subtotals; measured zero and approved scoring math unchanged.');
