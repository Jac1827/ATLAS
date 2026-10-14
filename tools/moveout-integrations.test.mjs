import assert from 'node:assert/strict';
import {handleMoveOutIntegration,eventBody} from '../src/moveout-integrations.mjs';
const cid='11111111-1111-4111-8111-111111111111',rid='22222222-2222-4222-8222-222222222222';
let records=new Map(),calls=[],deny=false,failGraph=false,tokenFail=false,unknown=false,deleted=false;
const env={ATLAS_MS_TENANT_ID:'test',ATLAS_MS_CLIENT_ID:'test',ATLAS_MS_CLIENT_SECRET:'test'};
const api={apiResponse:(data,init)=>new Response(JSON.stringify(data),{status:init?.status||200}),requireAtlasAccessUser:async()=>({config:{},user:{id:cid},role:'admin',profile:{display_name:'Synthetic Sender'}}),community:async()=>{if(deny)throw Object.assign(Error('Denied'),{status:403});return {community_id:cid,display_name:'Sample Community'};},supabaseRequest:async(config,path,options={})=>{
 if(path.includes('document_templates'))return [{template:{kind:'mog',instructions:'',fields:[],sections:[]}}];
 if(path.includes('atlas_employees'))return [{employee_id:cid,email:'tech@example.invalid'}];
 if(path.includes('atlas_employee_assignments'))return [{title:'Maintenance Technician',effective_start:'2020-01-01',effective_end:null}];
 if(path.includes('/rpc/')){const b=options.body,key=b.p_request_id;if(records.has(key))return {claimed:false,operation:records.get(key)};records.set(key,{status:'pending',result:{},body:b});return {claimed:true};}
 const key=new URL('https://example.invalid'+path).searchParams.get('request_id')?.replace('eq.','');
 if(options.method==='PATCH'){const r=records.get(key);Object.assign(r,options.body);return null;}
 if(path.includes('kind=eq.calendar'))return [...records.values()].filter(r=>r.body.p_kind==='calendar'&&r.body.p_entity_id===new URL('https://example.invalid'+path).searchParams.get('entity_id')?.replace('eq.','')&&['synchronized','cancelled'].includes(r.status)).reverse().slice(0,1).map(r=>({result:r.result,request_payload:r.body.p_request_payload}));
 return key?(records.has(key)?[records.get(key)]:[]):[];
}};
const fetcher=async(url,opts)=>{calls.push({url,opts});if(url.includes('login.microsoft'))return new Response(JSON.stringify(tokenFail?{}:{access_token:'synthetic'}),{status:tokenFail?401:200});if(opts.method==='GET')return new Response(JSON.stringify({id:'event-1',start:{dateTime:'2026-11-02T11:00:00'},end:{dateTime:'2026-11-02T12:00:00'}}),{status:deleted?404:200});if(unknown)throw Error('Connection lost');if(failGraph)return new Response('{}',{status:400});return new Response(opts.method==='POST'&&url.endsWith('/events')?JSON.stringify({id:'event-1'}):null,{status:url.endsWith('/sendMail')?202:opts.method==='POST'?201:204});};
const request=(path,body)=>new Request('https://worker.test/api/atlas/moveout/'+path,{method:'POST',body:JSON.stringify(body)});
const body={requestId:rid,caseId:'case',communityName:'Sample Community',to:['resident@example.invalid'],cc:[],subject:'MOG',message:'Please review.',document:{kind:'mog',title:'MOG',pdfBase64:'JVBERi0test',templateVersion:1,values:{etf:'No'}}};
let response=await handleMoveOutIntegration(request('email',body),{},api,fetcher);assert.equal(response.status,503);assert.equal(records.size,0);
response=await handleMoveOutIntegration(request('email',body),env,api,fetcher);assert.equal((await response.json()).status,'Accepted by Microsoft');assert.ok(calls.some(c=>c.url.includes('/users/central@risere.com/sendMail')));const sends=calls.filter(c=>c.url.endsWith('sendMail')).length;
response=await handleMoveOutIntegration(request('email',body),env,api,fetcher);assert.equal((await response.json()).status,'Accepted by Microsoft');assert.equal(calls.filter(c=>c.url.endsWith('sendMail')).length,sends,'Stable request does not resend');
deny=true;response=await handleMoveOutIntegration(request('email',{...body,requestId:crypto.randomUUID()}),env,api,fetcher);assert.equal(response.status,403);deny=false;
unknown=true;const uncertain={...body,requestId:crypto.randomUUID()};response=await handleMoveOutIntegration(request('email',uncertain),env,api,fetcher);assert.equal((await response.json()).status,'Outcome unknown');unknown=false;const n=calls.length;await handleMoveOutIntegration(request('email',uncertain),env,api,fetcher);assert.equal(calls.length,n+1,'Only token refresh; no uncertain send replay');
const appointment={id:crypto.randomUUID(),kind:'field',date:'2026-11-01',time:'10:30',duration:60,timeZone:'America/New_York',technicianEmail:'tech@example.invalid',purpose:'Field review',instructions:'Sample instructions',unit:'101',residentName:'Synthetic'};
const event=eventBody({caseId:'case',appointment},'Sample Community');assert.ok(event.subject.startsWith('Field Inspection'));assert.equal(event.start.timeZone,'Eastern Standard Time');assert.equal(event.end.dateTime,'2026-11-01T11:30:00');assert.ok(event.body.content.includes('moveOutCase=case'));assert.throws(()=>eventBody({appointment:{...appointment,date:'2026-02-31'}},'Sample'),/Invalid date/);
response=await handleMoveOutIntegration(request('calendar',{requestId:crypto.randomUUID(),caseId:'case',communityName:'Sample',action:'create',appointment}),env,api,fetcher);assert.equal((await response.json()).eventId,'event-1');
console.log('PASS Microsoft configuration and scope gates, shared mailbox, accepted-not-delivered semantics, durable duplicate/unknown protection, active technician check, field event type, time zone and case link. No real messages/events sent.');

const cal={requestId:crypto.randomUUID(),caseId:'case',communityName:'Sample',action:'refresh',appointment};
response=await handleMoveOutIntegration(request('calendar',cal),env,api,fetcher);let refreshed=await response.json();assert.equal(refreshed.appointment.date,'2026-11-02');assert.equal(refreshed.appointment.duration,60);
response=await handleMoveOutIntegration(request('calendar',{...cal,requestId:crypto.randomUUID(),action:'update',appointment:{...appointment,time:'13:00'}}),env,api,fetcher);assert.equal((await response.json()).status,'Synchronized');assert.ok(calls.some(c=>c.opts.method==='PATCH'&&c.url.endsWith('/events/event-1')));
deleted=true;response=await handleMoveOutIntegration(request('calendar',cal),env,api,fetcher);assert.equal((await response.json()).appointment.cancelled,true);deleted=false;
response=await handleMoveOutIntegration(request('calendar',{...cal,requestId:crypto.randomUUID(),action:'cancel'}),env,api,fetcher);assert.equal((await response.json()).status,'Cancelled');assert.ok(calls.some(c=>c.opts.method==='DELETE'&&c.url.endsWith('/events/event-1')));
failGraph=true;response=await handleMoveOutIntegration(request('email',{...body,requestId:crypto.randomUUID()}),env,api,fetcher);assert.equal((await response.json()).status,'Failed');failGraph=false;
console.log('PASS retained calendar binding, updates, Outlook changes, external deletion, cancellation and explicit email rejection.');
