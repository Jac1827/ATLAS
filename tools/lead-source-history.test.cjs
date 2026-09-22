const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const rule={id:'r',mappingVersion:'v2',canonicalField:'emails_online',originalField:'Email',sourceSystem:'Entrata',reportType:'box_score',sharedLeadMapping:true};
 let writes=0;const alerts=[];
 const ctx=vm.createContext({console,window:{atlasLeadMappingSession:{load:async()=>({rules:[rule]})}},
  dataImport2State:{mappingRules:[rule]},dataImportApprovalInProgress:false,
  savedData:{A:{month:{walkIn:1,offSiteEvent:0,phoneCalls:2,emailsOnline:3,textChatOther:4,applications:91,guestCards:10}}},
  dataImportCanManageArchitecture:()=>true,atlasCurrentUserDisplayName:()=> 'Authorized Test User',
  dataImportMakeId:()=> 'revision1',getWritableMonthlyPeriodEntries:r=>({historyEntry:r.month,liveEntry:null}),
  persistDataImportPublication:async()=>{writes++;},loadPropertyData:()=>{},getProp:()=>({name:'A'}),renderTab:()=>{},alert:s=>alerts.push(s)});
 vm.runInContext(fs.readFileSync('docs/portfolio-operations-dashboard/lead-source-review.js','utf8'),ctx);
 const prepare=()=>{ctx.window.atlasLeadHistoryPreview={rows:[{community:'A',period:{periodKey:'2026-09',monthIdx:8,year:2026},after:{buckets:{walk_in:1,off_site_event:0,phone_calls:2,emails_online:5,text_chat_other:2},controls:[{value:10,variance:0}]} }],targets:{walk_in:'walkIn',off_site_event:'offSiteEvent',phone_calls:'phoneCalls',emails_online:'emailsOnline',text_chat_other:'textChatOther'},sourceFingerprint:JSON.stringify(ctx.savedData),mappingFingerprint:ctx.dataImportLeadMappingFingerprint()};};
 prepare();const before=JSON.stringify(ctx.savedData);ctx.cancelDataImportLeadHistory();assert.equal(JSON.stringify(ctx.savedData),before);assert.equal(writes,0);
 prepare();await ctx.approveDataImportLeadHistory();assert.equal(writes,1);assert.equal(ctx.savedData.A.month.emailsOnline,5);assert.equal(ctx.savedData.A.month.applications,91);assert.equal(ctx.savedData.A.month.guestCards,10);
 assert.equal(ctx.dataImport2State.leadSourceHistoricalRevisions[0].rows[0].beforeSlots[0].emailsOnline.value,3);
 prepare();ctx.savedData.A.month.applications=92;await ctx.approveDataImportLeadHistory();assert.equal(writes,1);assert.equal(ctx.savedData.A.month.applications,92);
 prepare();ctx.window.atlasLeadMappingSession.load=async()=>({rules:[{...rule,mappingVersion:'v3'}]});await ctx.approveDataImportLeadHistory();assert.equal(writes,1);assert.equal(ctx.savedData.A.month.applications,92);
 console.log('PASS historical cancel, explicit approval, five-field-only changes, unchanged controls, retained rollback values and stale source/shared-version rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});
