import test from 'node:test';
import assert from 'node:assert/strict';
import {computeReforecast,applyRecommendations,recommendReforecast,recommendationAvailability} from '../docs/portfolio-operations-dashboard/features/reforecast-engine.mjs';
import {retainedReviewedForecastBlank,confirmedReviewedForecastBlank,confirmedForecastBlank,retainedWorkbookBlank,resolveInheritedReviewedForecastBlank} from '../docs/portfolio-operations-dashboard/features/reforecast-workbook-source-policy.mjs';

const period='2026-09',actor='reviewer',reviewedAt='2026-09-29T00:00:00Z';
function fixture(){
 const review={period,accountCode:'expense',confirmed:true,reviewedBy:actor,reviewedAt,reason:'Keep the account in forecast as an editable intentional blank'};
 const mapping={version:'mapping',confirmed:true,reviewedBy:actor,sourceScenario:'Plan',periods:[period],selectedLineIds:[],workbookSourcePolicy:{schemaVersion:1,mode:'workbook_exact',blankDisposition:'preserve_null',confirmed:true,reviewedBy:actor,reviewedAt,reason:review.reason,reviewedForecastBlanks:[review],outsideForecastScope:[]}};
 const cell={period,accountCode:'expense',amount:null,disposition:'reviewed_forecast_blank',isBlank:true,legitimateBlank:true,reviewedForecastBlankConfirmed:true,sourceScopeExclusionConfirmed:false,source:{kind:'reviewed_forecast_blank',workbookSourceAbsent:true,uploadId:'upload',auditId:'audit',sourceHash:'source-hash',sourceScenario:'Plan',mappingVersion:'mapping',review}};
 const input={communityId:'community',periods:[period],baseline:{versionId:'budget',lines:[{period,accountCode:'expense',amount:80}]},actuals:{},registry:{version:'mapping',accounts:[{accountCode:'expense',name:'Expense',category:'Expenses',nature:'expense',placement:'above_noi'}]},scenario:{name:'Working forecast',calendar:{basis:'calendar',startMonth:1,periods:[period],scenario:'Working forecast',confirmed:true,reviewedBy:actor,reviewedAt},governanceSchemaVersion:2,versionId:'draft',driverVersion:'drivers',uploadId:'upload',importMapping:mapping,drivers:[],overrides:[]},workbookReviewedForecastBlankCells:[cell]};
 return {input,mapping,cell,review};
}
const row=result=>result.lines.find(line=>line.accountCode==='expense'&&line.period===period);
const manual=amount=>({period,accountCode:'expense',amount,confirmed:true,reason:'Reviewed forecast adjustment',ownerId:actor,effectivePeriod:period,reviewedAt,before:null,after:amount});
const history=(values=[0,30,60])=>values.map((actual,i)=>{const month=`2026-0${i+1}`;return {period:month,status:'available',eligible:true,fullMonth:true,closeVersionId:'close-'+month,sourceHash:'actual-'+month,lines:[{accountCode:'expense',actual,closeVersionId:'close-'+month}],baseline:{period:month,status:'available',verified:true,approved:true,locked:true,sourceType:'original_budget',versionId:'budget',contentHash:'budget-hash',lines:[{accountCode:'expense',amount:0}]}};});

test('intentional in-scope blank is distinct from workbook blank, exclusion and unresolved absence',()=>{
 const {input,mapping,cell}=fixture(),before=JSON.stringify(input),result=computeReforecast(input),line=row(result);
 assert.equal(JSON.stringify(input),before);assert.equal(retainedReviewedForecastBlank(cell,mapping,{uploadId:'upload'}),true);
 assert.equal(retainedWorkbookBlank(cell,mapping),false);assert.equal(confirmedReviewedForecastBlank(line),true);assert.equal(confirmedForecastBlank(line,'forecast'),true);
 assert.equal(line.forecast,null);assert.equal(line.originalBudget,80);assert.equal(line.selectedBaseline,80);assert.equal(line.workbookSourceAmount,null);assert.equal(line.workbookSourceDisposition,'source_absent');assert.equal(line.sourceScopeExclusionConfirmed,false);
 assert.equal(result.status,'ready',JSON.stringify(result.diagnostics));assert.equal(result.workbookCoverage.reviewedForecastBlankCellCount,1);assert.equal(result.workbookCoverage.workbookBlankCellCount,0);assert.equal(result.workbookCoverage.outsideForecastScopeCellCount,0);assert.equal(result.workbookCoverage.sourceAbsentCellCount,0);assert.equal(result.workbookCoverage.complete,true);
 assert.equal(result.totals.reforecast.expenses,0,'Additive aggregate may be zero while the source and forecast cell stay null');assert.equal(line.forecast,null);
});

test('projection flags alone cannot authorize an intentional blank or mask an invalid review',()=>{
 const changes=[f=>{f.cell.source.uploadId='other';},f=>{f.cell.source.auditId='';},f=>{f.cell.source.sourceHash='';},f=>{f.cell.source.mappingVersion='other';},f=>{f.cell.source.sourceScenario='Other';},f=>{f.cell.source.workbookSourceAbsent=false;},f=>{f.cell.amount=0;},f=>{f.cell.sourceScopeExclusionConfirmed=true;},f=>{f.review.reviewedBy='other';},f=>{f.review.reason='';},f=>{f.cell.source.review={...f.review,reason:'Unbound review'};},f=>{f.mapping.workbookSourcePolicy.reviewedForecastBlanks=[];},f=>{f.mapping.workbookSourcePolicy.reviewedForecastBlanks={};},f=>{f.mapping.workbookSourcePolicy.reviewedForecastBlanks.push({...f.review});},f=>{f.mapping.workbookSourcePolicy.outsideForecastScope=[{...f.review}];},f=>{f.input.workbookReviewedForecastBlankCells.push(structuredClone(f.cell));}];
 for(const change of changes){const f=fixture();change(f);const result=computeReforecast(f.input);assert.equal(row(result).forecast,null);assert.equal(row(result).disposition,'source_absent');assert.equal(result.status,'action_required');assert.equal(result.workbookCoverage.reviewedForecastBlankCellCount,0);}
 const f=fixture();f.input.workbookReviewedForecastBlankCells=[];f.input.scenario.overrides=[manual(12)];assert.equal(row(computeReforecast(f.input)).disposition,'source_absent','Ordinary unreviewed absence remains blocked even after a manual edit');
});

test('manual values and explicit zero can replace the intentional blank and removal restores its retained decision',()=>{
 const {input,cell}=fixture();
 for(const amount of [25,0]){input.scenario.overrides=[manual(amount)];const result=computeReforecast(input),line=row(result);assert.equal(result.status,'ready',JSON.stringify(result.diagnostics));assert.equal(line.forecast,amount);assert.equal(line.disposition,'reviewer_override');assert.equal(line.workbookSourceAmount,null);assert.equal(line.workbookSourceDisposition,'source_absent');assert.deepEqual(line.workbookSource,cell.source);assert.equal(result.workbookCoverage.reviewerEditedCellCount,1);assert.equal(result.workbookCoverage.reviewedForecastBlankCellCount,0);}
 input.scenario.overrides=[{...manual(25),confirmed:false}];assert.equal(computeReforecast(input).status,'action_required');
 input.scenario.overrides=[];const restored=computeReforecast(input);assert.equal(row(restored).forecast,null);assert.equal(row(restored).disposition,'reviewed_forecast_blank');assert.deepEqual(row(restored).source,cell.source);
});

test('approved blank inherits without budget fallback; later actual close and immutable inheritance stay protected',()=>{
 const f=fixture(),approved=row(computeReforecast(f.input));
 const inherited=fixture().input;delete inherited.scenario.importMapping;delete inherited.scenario.uploadId;inherited.scenario.baselineType='approved_reforecast';inherited.scenario.baselinePublicationIds=['publication'];inherited.baseline={sourceType:'approved_reforecast',versionId:'approved',periodVersions:[{period,sourceType:'approved_reforecast',publicationId:'publication',versionId:'approved',contentHash:'approved-hash'}],lines:[{...approved,amount:null,source:{sourceType:'approved_reforecast',publicationId:'publication',versionId:'approved',revisionId:'approved',contentHash:'approved-hash',priorSource:approved.source}}],originalBudgetLines:f.input.baseline.lines};
 assert.equal(row(computeReforecast(inherited)).disposition,'reviewed_forecast_blank');assert.equal(row(computeReforecast(inherited)).originalBudget,80);
 inherited.scenario.overrides=[manual(20)];const edited=row(computeReforecast(inherited));assert.equal(edited.forecast,20);assert.equal(edited.disposition,'reviewer_override');assert.deepEqual(edited.workbookSource,approved.source);
 inherited.scenario.overrides=[{...manual(0),source:{kind:'str_schedule',sourceKind:'saved_json_monthly_programme',sourceReceiptId:'approved-str',sourceAmount:0,application:'add'}}];const combined=row(computeReforecast(inherited));assert.equal(combined.forecast,0);assert.equal(combined.legitimateBlank,false);assert.equal(combined.disposition,'reviewer_override');assert.equal(combined.source.kind,'str_schedule');assert.deepEqual(combined.workbookSource,approved.source);assert.equal(approved.forecast,null);
 const closed=fixture().input;closed.actuals={cutoffPeriod:period,closeVersions:[{period,versionId:'close-september',status:'closed',fullMonth:true,sourceHash:'actual-september'}],lines:[{period,accountCode:'expense',amount:35,closeVersionId:'close-september'}]};closed.scenario.overrides=[manual(999)];const actual=row(computeReforecast(closed));assert.equal(actual.sourceKind,'closed_actual');assert.equal(actual.forecast,35);assert.equal(actual.actual,35);
 const locked=fixture().input;locked.lockedPeriods=[period];locked.inheritedLines=[approved];locked.scenario.overrides=[manual(999)];const frozen=row(computeReforecast(locked));assert.equal(frozen.forecast,null);assert.equal(frozen.disposition,'reviewed_forecast_blank');assert.deepEqual(frozen.source,approved.source);
});

test('historical amount proposals use governed actuals, including real zeros, and do not apply themselves',()=>{
 const {input}=fixture();input.recommendationHistory=history();const result=computeReforecast(input),proposal=result.recommendations[0];
 assert.equal(row(result).forecast,null);assert.equal(proposal.operation,'amount');assert.equal(proposal.proposedValue,40);assert.equal(proposal.evidence.method,'weighted_governed_actual_amount');assert.equal(proposal.evidence.sampleCount,3);assert.equal(proposal.cutoff,'2026-03');assert(proposal.evidence.observations.every(o=>o.sourceRows.every(r=>r.versionId&&r.sourceHash)));assert.equal(result.recommendationAvailability[0].status,'eligible');
 const rejected=applyRecommendations(input.scenario,[proposal],{ids:[proposal.id],action:'reject',actor,timestamp:reviewedAt,versionId:'v2',driverVersion:'d2',reason:'Keep intentional blank'});assert.deepEqual(rejected.drivers,[]);assert.equal(rejected.suggestionDecisions[0].status,'rejected');assert.equal(row(computeReforecast({...input,scenario:rejected})).forecast,null);
 const accepted=applyRecommendations(input.scenario,[proposal],{ids:[proposal.id],actor,timestamp:reviewedAt,versionId:'v3',driverVersion:'d3',edits:{[proposal.id]:55},reason:'Use supported changed estimate'}),edited=computeReforecast({...input,scenario:accepted});
 assert.equal(row(edited).forecast,55);assert.equal(row(edited).disposition,'reviewer_override');assert.equal(row(edited).workbookSourceAmount,null);assert.equal(row(edited).workbookSourceDisposition,'source_absent');assert.equal(accepted.drivers[0].recommendationReview.reviewedBy,actor);assert.equal(accepted.drivers[0].recommendationReview.proposedValue,40);assert.equal(accepted.suggestionDecisions[0].appliedValue,55);
 assert.throws(()=>applyRecommendations(input.scenario,[proposal],{ids:[proposal.id],actor,timestamp:reviewedAt,versionId:'v3',driverVersion:'d3',edits:{[proposal.id]:55}}),/review reason/);
 const zero=computeReforecast({...input,recommendationHistory:history([0,0,0])});assert.equal(zero.recommendations[0].proposedValue,0,'Zero estimate is allowed only because the governed observed amounts are zero');
});

test('missing, duplicated, stale, partial and insufficient actual evidence never invents an amount',()=>{
 const {input}=fixture();const blank=computeReforecast(input);
 assert.deepEqual(blank.recommendations,[]);assert.equal(blank.recommendationAvailability[0].reason,'insufficient_history');
 const short=computeReforecast({...input,recommendationHistory:history([30,60])});assert.deepEqual(short.recommendations,[]);assert.equal(short.recommendationAvailability[0].sampleCount,2);assert.deepEqual(recommendReforecast({snapshot:short,minClosedPeriods:1}),[]);assert.equal(recommendationAvailability(short,{minClosedPeriods:1})[0].requiredCount,3);
 for(const patch of [{eligible:false},{sourceHash:''},{partial:true},{fullMonth:false},{stale:true},{closeStatus:'reopened'}]){const observations=history();Object.assign(observations[0],patch);const snapshot={...blank,recommendationHistory:observations};assert.deepEqual(recommendReforecast({snapshot}),[],JSON.stringify(patch));assert.equal(recommendationAvailability(snapshot)[0].reason,'insufficient_history');}
 const duplicate={...blank,recommendationHistory:[...history([30,60]),history([30,60])[0]]};assert.deepEqual(recommendReforecast({snapshot:duplicate}),[]);assert.equal(recommendationAvailability(duplicate)[0].sampleCount,2);
});


test('weighted amount uses exact decimal final rounding and excludes invalid weighting or conflicting history',()=>{
 const {input}=fixture(),blank=computeReforecast(input);
 for(const [values,expected]of [[[0,0,0.01],0.01],[[0,0,-0.01],-0.01],[[0,0,0],0]]){const snapshot={...blank,recommendationHistory:history(values)};assert.equal(recommendReforecast({snapshot})[0].proposedValue,expected);}
 const snapshot={...blank,recommendationHistory:history()};
 const decimalWeights=recommendReforecast({snapshot,weights:{'2026-01':0.1,'2026-02':0.2,'2026-03':0.3}})[0];assert.equal(decimalWeights.evidence.totalWeight,0.6);assert.equal(JSON.stringify(decimalWeights.evidence.totalWeight),'0.6');assert.equal(decimalWeights.proposedValue,40);assert.deepEqual(decimalWeights.evidence.observations.map(row=>row.weight),[0.1,0.2,0.3]);
 for(const weight of [-1,0,NaN])assert.deepEqual(recommendReforecast({snapshot,weights:{'2026-01':weight}}),[],'At least three positively weighted observations are required');
 const conflicting=history();conflicting.push({...structuredClone(conflicting[0]),closeVersionId:'conflicting-close',lines:[{accountCode:'expense',actual:0,closeVersionId:'conflicting-close'}]});assert.deepEqual(recommendReforecast({snapshot:{...blank,recommendationHistory:conflicting}}),[]);
 const hashes=history();hashes.push({...structuredClone(hashes[0]),sourceHash:'conflicting-hash'});assert.deepEqual(recommendReforecast({snapshot:{...blank,recommendationHistory:hashes}}),[]);
});


test('intentional blank amount suggestions do not imply support for predecessor history chains',()=>{
 const {input}=fixture(),blank=computeReforecast(input),prior=history().map(month=>({...month,lines:month.lines.map(line=>({...line,accountCode:'old-expense'})),baseline:{...month.baseline,lines:month.baseline.lines.map(line=>({...line,accountCode:'old-expense'}))}}));
 const snapshot={...blank,recommendationHistory:prior,sunsetRelationships:[{accountCode:'old-expense',successorAccountCode:'expense',retiredAfter:'2026-08',approved:true,mappingRegistryVersion:blank.identity.mappingRegistryVersion}]};
 assert.deepEqual(recommendReforecast({snapshot}),[]);
 const availability=recommendationAvailability(snapshot).find(row=>row.accountCode==='expense');assert.equal(availability.status,'unavailable');assert.equal(availability.reason,'successor_history_review_required');assert.equal(availability.sampleCount,3);
});


test('approved baseline resolver binds the real SQL wrapper and direct client lineage exactly once',()=>{
 const {input}=fixture(),approved=row(computeReforecast(input)),version={period,sourceType:'approved_reforecast',publicationId:'publication',versionId:'revision',contentHash:'publication-hash'},baseline={sourceType:'approved_reforecast',communityId:'community',periodVersions:[version],lines:[{...approved,amount:null,source:{...version,revisionId:'revision',priorSource:approved.source}}]},options={communityId:'community',publicationIds:['publication']};
 const resolved=resolveInheritedReviewedForecastBlank(baseline.lines[0],baseline,options);assert(resolved);assert.deepEqual(resolved.source,approved.source);assert.equal(resolved.baselineLineage.publicationId,'publication');assert.equal(baseline.lines[0].source.sourceType,'approved_reforecast','Resolver never rewrites retained baseline');
 const direct=structuredClone(baseline);direct.lines[0].source=structuredClone(approved.source);direct.lines[0].baselineLineage=structuredClone(version);assert(resolveInheritedReviewedForecastBlank(direct.lines[0],direct,options));
 const mutations=[b=>{b.lines[0].source.publicationId='other';},b=>{b.lines[0].source.contentHash='other';},b=>{b.lines[0].source.versionId='other';},b=>{b.lines[0].source.revisionId='other';},b=>{b.lines[0].source.priorSource.review.confirmed=false;},b=>{b.lines[0].source.priorSource.review.reason='Changed without matching retained review';},b=>{b.lines[0].source.priorSource.review.accountCode='other';},b=>{b.lines[0].source.priorSource.review.reviewedAt='not-a-time';},b=>{b.lines[0].source.priorSource={sourceType:'approved_reforecast',priorSource:b.lines[0].source.priorSource};},b=>{b.lines.push(structuredClone(b.lines[0]));},b=>{b.periodVersions.push(structuredClone(b.periodVersions[0]));},b=>{b.communityId='other';},b=>{b.lines[0].workbookSourceAmount=0;},b=>{b.lines[0].amount=0;}];
 for(const change of mutations){const altered=structuredClone(baseline);change(altered);assert.equal(resolveInheritedReviewedForecastBlank(altered.lines[0],altered,options),null);}
 assert.equal(resolveInheritedReviewedForecastBlank(baseline.lines[0],baseline,{...options,publicationIds:['other']}),null);
 assert.equal(resolveInheritedReviewedForecastBlank(direct.lines[0],{...direct,periodVersions:[]},options),null);
 const malformed=structuredClone(baseline);malformed.lines[0].source.contentHash='other';const next={...input,baseline:{...malformed,versionIds:['budget'],originalBudgetLines:input.baseline.lines},scenario:{...input.scenario,uploadId:null,importMapping:null,baselineType:'approved_reforecast',baselinePublicationIds:['publication']}};assert.equal(computeReforecast(next).status,'action_required','Unbound inherited flag cannot authorize blank totals');
});
