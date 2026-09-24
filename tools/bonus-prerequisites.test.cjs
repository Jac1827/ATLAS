const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/index.html','utf8');
const fn=n=>html.match(new RegExp('^function '+n+'\\([^]*?^\\}','m'))[0];
const state={exceptionStatusById:{bonus_x_missing_salary_:'resolved'},overrides:[],approvalStatusByRowId:{bonus_x:'Regional Approved'}};
const c={atlasBonusResolvePlanForEmployee:()=>({plan:{id:'plan',targetBonusPercent:20,metrics:[]}}),atlasBonusProration:()=>({factor:1}),simpleHash:()=> 'x',atlasBonusState:()=>state,atlasBonusGetCommunityOperatingType:()=> 'stabilized'};
vm.createContext(c);vm.runInContext(fn('atlasBonusBuildRow'),c);
const row=c.atlasBonusBuildRow({employeeId:'id',communityName:'A',bonusRole:'General Manager'}, {periodKey:'2026-Q3'});
assert.equal(row.unresolvedCritical,true);assert.equal(row.approvalStatus,'Exceptions Blocking Approval');assert.equal(row.projectedPayout,null);assert.equal(row.finalPayout,null);
vm.runInContext(fn('atlasBonusExceptionGroups'),c);
const groups=c.atlasBonusExceptionGroups([row,{...row,employee:{...row.employee,employeeId:'different'}}]);assert.equal(groups.length,1);assert.equal(groups[0].rows.length,2);
const identity=fn('atlasBonusEmployeeDisplayName');assert(!identity.includes('Candidates'));assert(!identity.includes('Context'));
vm.runInContext(identity,c);assert.equal(c.atlasBonusEmployeeDisplayName({name:'Same Name',employeeId:'one'}),'Same Name');
const preview=fn('atlasUpdateSelfSalaryPreview');assert(!/persist|rpc\(|fetch|localStorage|sessionStorage|employeeComp/.test(preview));
let out={innerHTML:'',textContent:''};const controls={'atlas-self-salary':{value:'60000'},'atlas-self-plan':{value:'p'},'atlas-self-salary-result':out};
const x={document:{getElementById:id=>controls[id]},normalizeOptionalNumber:v=>v===''?null:Number(v),atlasBonusFindPlan:()=>({targetBonusPercent:20,payoutCadence:'Quarterly',metrics:[{name:'Occupancy',weight:100}]}),atlasBonusCadenceDivisor:()=>4,atlasBonusMetricPotential:e=>e.salary*0.2/4,atlasBonusCurrency:v=>'$'+v,escapeHtml:String};
vm.createContext(x);vm.runInContext(preview,x);x.atlasUpdateSelfSalaryPreview();assert(out.innerHTML.includes('$3000'));assert(out.innerHTML.includes('HR verification pending'));controls['atlas-self-salary'].value='';x.atlasUpdateSelfSalaryPreview();assert(out.textContent.includes('positive salary'));
console.log('PASS missing salary cannot be dismissed or exported as zero; grouped prerequisites; stable identity; private unsaved salary illustration.');

vm.runInContext(fn('atlasBonusPct'),c);
assert.equal(c.atlasBonusPct(null),'Pending');assert.equal(c.atlasBonusPct(0),'0%');
c.atlasBonusResolvePlanForEmployee=()=>({plan:{id:'plan',targetBonusPercent:0,metrics:[{id:'noi',name:'NOI',inputType:'automatic'}]}});
c.communityCommandBonusGoalResult=()=>null;c.atlasBonusMetricActual=()=>null;c.atlasBonusMetricPotential=()=>100;c.atlasBonusFinancialEvidence=()=>[];
const pending=c.atlasBonusBuildRow({employeeId:'id',communityName:'A',bonusRole:'Manager'}, {periodKey:'2026-Q3'});
assert.equal(pending.metricResults[0].earned,null);assert.equal(pending.metricResults[0].achievementPct,null);assert.equal(pending.finalPayout,null);
c.atlasBonusMetricActual=()=>0;c.atlasBonusCurvePayoutPct=()=>({ratio:0,payoutPct:0,label:'Below threshold'});
const zero=c.atlasBonusBuildRow({employeeId:'id',communityName:'A',bonusRole:'Manager'}, {periodKey:'2026-Q3'});
assert.equal(zero.metricResults[0].earned,0);assert.equal(zero.metricResults[0].achievementPct,0);assert.equal(zero.projectedPayout,0);assert.equal(zero.proposedPayout,0);assert.equal(zero.finalPayout,null);assert.equal(zero.canonicalPayable,false);

// An explicit approved adjustment replaces the projection, including a real zero.
c.atlasBonusMetricActual=()=>100;c.atlasBonusCurvePayoutPct=()=>({ratio:100,payoutPct:100,label:'Achieved'});
const employee={employeeId:'id',communityName:'A',bonusRole:'Manager'},period={periodKey:'2026-Q3'};
for(const amount of [0,50,-25,'0','50','-25']){
 state.overrides=[{employeeId:'id',status:'approved',adjustedAmount:amount}];
 const adjusted=c.atlasBonusBuildRow(employee,period);
 assert.equal(adjusted.projectedPayout,100);assert.equal(adjusted.proposedPayout,Number(amount));
 assert.equal(adjusted.unresolvedCritical,false);assert.equal(adjusted.finalPayout,null);assert.equal(adjusted.canonicalPayable,false);
}
for(const amount of [undefined,null,'','  ','invalid',NaN,Infinity,-Infinity,{},[],false]){
 state.overrides=[{employeeId:'id',status:'approved',adjustedAmount:amount}];
 const invalid=c.atlasBonusBuildRow(employee,period);
 assert.equal(invalid.unresolvedCritical,true);assert.equal(invalid.proposedPayout,null);assert.equal(invalid.finalPayout,null);
 assert(invalid.exceptions.some(item=>item.code==='invalid_override_amount'&&item.severity==='critical'));
 assert.equal(invalid.approvalStatus,'Exceptions Blocking Approval');
}
state.overrides=[{employeeId:'id',status:'pending_approval',adjustedAmount:0}];
const unapproved=c.atlasBonusBuildRow(employee,period);assert.equal(unapproved.proposedPayout,100);assert.equal(unapproved.approvalStatus,'Overrides Pending Approval');
state.overrides=[];assert.equal(c.atlasBonusBuildRow(employee,period).proposedPayout,100);
console.log('PASS approved zero/positive/negative overrides remain exact draft proposals; blank, missing and invalid approved adjustments fail closed; pending adjustments never replace earned values.');
