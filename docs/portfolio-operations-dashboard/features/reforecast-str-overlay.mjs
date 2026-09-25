import {stableStringify,validateForecastPeriods} from './reforecast-engine.mjs?v=3d3b7e538bd36581';

const clone=value=>structuredClone(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const month=/^20\d{2}-(0[1-9]|1[0-2])$/;
const equal=(left,right)=>stableStringify(left)===stableStringify(right);
export const isRiseOverlay=draft=>draft?.scenarioPurpose==='str_overlay'||draft?.strStreams?.some(stream=>stream.id==='rise_str');
export function riseReviewScope(stream){
 const fields=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value?.[key]??null]));
 return {...fields(stream,['id','mappingVersion','incomeBasis','application','incomeAccountCode','vacancyAccountCode','feeAccountCode','assumptionReason']),units:(stream.units||[]).map(unit=>fields(unit,['id','availableFrom','takeBackMonth'])),monthly:(stream.monthly||[]).map(row=>fields(row,['period','includedUnitIds','availableUnits','occupancyPercent','grossPerOccupiedNight','netPerOccupiedNight','feePerAvailableUnit','netMethod','feesIncludedInNet']))};
}

// This creates a new scenario configuration; the publication and its original budget
// are immutable ancestors. Missing STR inputs are intentionally left unavailable.
export function createStrOverlayDraft(publication,{actor,name='Conventional + RISE STR',timestamp=new Date().toISOString()}={}){
 if(!actor||publication?.verified!==true||publication.approved!==true||publication.locked!==true||!publication.publicationId||!publication.revisionId||!publication.contentHash||!publication.snapshot||publication.source?.scenario?.scenarioPurpose==='str_overlay'||publication.snapshot.strSchedules?.some(row=>row.streamId==='rise_str'))throw Error('Choose a verified approved and locked Conventional publication as the STR parent.');
 const identity=publication.snapshot.identity,periods=validateForecastPeriods(publication.periods||identity?.periods);
 if(identity?.communityId!==publication.communityId||!identity.mappingRegistryVersion||!identity.baselineVersionIds?.length)throw Error('The Conventional parent must retain its community, mapping and original budget ancestry.');
 return {governanceSchemaVersion:2,name,model:'mixed',scenarioPurpose:'str_overlay',periods,calendar:{basis:'calendar',startMonth:1,confirmed:true,periods,scenario:name,reviewedBy:actor,reviewedAt:timestamp},baselineType:'approved_reforecast',baselinePublicationIds:[publication.publicationId],baselineVersionIds:clone(identity.baselineVersionIds),registryVersionId:identity.mappingRegistryVersion,parentPublication:{publicationId:publication.publicationId,revisionId:publication.revisionId,contentHash:publication.contentHash,communityId:publication.communityId,periods:clone(periods),originalBudgetVersionIds:clone(identity.baselineVersionIds)},sourceUploadIds:[],ownerId:actor,drivers:[],overrides:[],history:[],reason:'',strStreams:[{id:'rise_str',reviewed:false,mappingVersion:identity.mappingRegistryVersion,units:[],monthly:periods.map(period=>({period,occupancyPercent:null,grossPerOccupiedNight:null,netPerOccupiedNight:null,feePerAvailableUnit:null,netMethod:null})),incomeBasis:'gross',application:'add',incomeAccountCode:'',vacancyAccountCode:'',feeAccountCode:'',assumptionReason:'',sourceReviewId:null}]};
}

export function validateRiseOverlay(draft,source){
 const streams=(draft.strStreams||[]).filter(stream=>stream.id==='rise_str');
 if(!streams.length&&draft.scenarioPurpose!=='str_overlay')return [];
 const issues=[],add=(code,message,detail={})=>issues.push({code,severity:'blocking',message,...detail}),parent=draft.parentPublication;
 if(draft.scenarioPurpose!=='str_overlay'||streams.length!==1||(draft.strStreams||[]).length!==1)add('str_overlay_required','RISE STR requires a separate overlay with exactly one RISE stream; Hello Landing remains in Conventional.');
 if(!parent?.publicationId||!parent.revisionId||!parent.contentHash||parent.communityId!==source.communityId||draft.baselineType!=='approved_reforecast'||!equal(draft.baselinePublicationIds,[parent.publicationId])||!equal([...(draft.periods||[])].sort(),[...(parent.periods||[])].sort())||!equal(draft.baselineVersionIds,parent.originalBudgetVersionIds))add('str_parent_required','Bind the overlay to the exact Conventional publication, revision, periods and original budget ancestry.');
 if(parent&&(source.baseline?.periodVersions||[]).some(row=>row.publicationId!==parent.publicationId||row.versionId!==parent.revisionId||row.contentHash!==parent.contentHash))add('str_parent_mismatch','Selected baseline differs from the retained Conventional parent.');
 if((draft.drivers||[]).length||(draft.overrides||[]).some(row=>row.source?.kind!=='str_schedule'))add('str_overlay_only','An STR overlay may contain only its reviewed STR contribution.');
 const periods=(draft.periods||[]).filter(period=>!source.lockedPeriods?.includes(period)&&!(source.actuals?.latestFullClosePeriod&&period<=source.actuals.latestFullClosePeriod));
 for(const stream of streams){
  if(!stream.reviewed||!stream.reviewedBy||!stream.reviewedAt||!stream.assumptionReason?.trim())add('str_review_required','Accept the roster, rates, signed fees and application reason before applying RISE STR.');
  if(stream.mappingVersion!==source.registry?.version||draft.registryVersionId!==source.registry?.version)add('str_mapping_version','RISE STR must use the exact reviewed GL mapping version.');
  if(!['gross','net'].includes(stream.incomeBasis)||!['add','replace'].includes(stream.application))add('str_method_required','Choose the reviewed gross/net basis and add/replace application.');
  const receipt=source.sourceReceipts?.find(row=>row.reviewId===stream.sourceReviewId&&row.sourceType==='rise_str'&&row.review?.status==='approved'&&!row.stale&&row.sourceHash&&row.review?.mapping?.version===stream.mappingVersion);
  if(!receipt||!draft.sourceUploadIds?.includes(receipt.uploadId))add('str_source_required','Link an approved RISE STR source review for the roster, rates, signed fees and this mapping version.');
  else if(!equal(receipt.review.mapping.riseScheduleEvidence,riseReviewScope(stream)))add('str_review_scope_changed','The roster, rates, signed fees or application changed after source review. Obtain a new review of this exact schedule.');
  const codes=[stream.incomeAccountCode,...(stream.incomeBasis==='gross'?[stream.vacancyAccountCode,stream.feeAccountCode]:[])].filter(Boolean);
  if(codes.includes('5144')&&!(receipt?.review?.mapping?.allowHelloLandingGl5144===true&&stream.protectedGlApprovalReviewId===receipt.reviewId))add('str_hello_landing_protected','GL 5144 belongs to Hello Landing and requires explicit approval before any RISE posting.');
  if(stream.application==='replace'&&codes.some(code=>periods.some(period=>source.baseline?.lines?.some(row=>row.period===period&&row.accountCode===code&&row.amount!==0))))add('str_replace_nonzero','Replacement requires dedicated zero-balance STR accounts; preserve the Conventional contribution.');
  if(!Array.isArray(stream.units)||!stream.units.length||stream.units.some(unit=>!unit.id||!month.test(unit.availableFrom||'')||(unit.takeBackMonth&&!month.test(unit.takeBackMonth))))add('str_roster_required','Review a full-month roster with an availability month and any take-back month for every unit.');
  for(const period of periods){const row=stream.monthly?.find(item=>item.period===period),detail={period};
   if(!row||!finite(row.occupancyPercent)||row.occupancyPercent<0||row.occupancyPercent>100||!finite(row.grossPerOccupiedNight)||row.grossPerOccupiedNight<0||!finite(row.feePerAvailableUnit))add('str_month_required','Each open month requires occupancy, gross rate and an explicit signed fee (including reviewed zero).',detail);
   if(!['per_occupied_night','gross_plus_signed_fees'].includes(row?.netMethod))add('str_net_method','Choose an explicit net income method for each month.',detail);
   if(row?.netMethod==='per_occupied_night'&&(!finite(row.netPerOccupiedNight)||row.netPerOccupiedNight<0||row.feesIncludedInNet!==true))add('str_net_fees','Reviewed net rates must explicitly include fees, which will not be posted again.',detail);
   if(stream.incomeBasis==='gross'&&row?.feePerAvailableUnit!==0&&(!stream.feeAccountCode||codes.length!==new Set(codes).size||source.registry?.accounts?.find(account=>account.accountCode===stream.feeAccountCode)?.nature!=='contra_income'))add('str_fee_mapping','Gross-basis signed fees require a separate reviewed contra-income GL.',detail);
  }
 }
 return issues;
}

export function assertRiseOverlay(draft,source){const issues=validateRiseOverlay(draft,source);if(issues.length)throw Error(issues.map(row=>row.message).join(' '));}
