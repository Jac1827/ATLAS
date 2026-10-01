// Exact captured function in isolated synthetic tables. This checks the guard,
// immutable replay and unchanged function content, not financial acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite(),limit=2097152,signature='atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb)';
const fixture=await fs.readFile(new URL('./fixtures/reforecast-save-before-size-diagnostic.sql',import.meta.url),'utf8');
const migration=await fs.readFile(new URL('../supabase/migrations/20260929162353_reforecast_payload_size_diagnostic.sql',import.meta.url),'utf8');
const oldGuard=migration.match(/old_guard text:=\$old\$([\s\S]*?)\$old\$/)[1],newGuard=migration.match(/new_guard text:=\$new\$([\s\S]*?)\$new\$/)[1];
const cid=randomUUID(),scenario=randomUUID(),actor=randomUUID(),request=randomUUID(),revision=randomUUID();
const metadata=async()=>(await db.query('select proowner,prosecdef,provolatile,proconfig,proacl::text,prorettype,proargtypes::text from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
const body=async()=>(await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[signature])).rows[0].prosrc;
const bytes=async value=>(await db.query('select octet_length($1::jsonb::text)::int n',[value])).rows[0].n;
const call=args=>db.query('select atlas_private.save_reforecast_builder($1,$2,$3,$4,$5,$6) value',args);
const error=async args=>{try{await call(args);assert.fail('Expected rejection');}catch(e){assert.equal(e.code,'P0001');return {message:e.message,code:e.code,detail:e.detail||null,hint:e.hint||null};}};
const args=(payload,extra={})=>[cid,extra.scenario===undefined?scenario:extra.scenario,extra.expected===undefined?1:extra.expected,extra.request===undefined?randomUUID():extra.request,extra.action===undefined?'save_draft':extra.action,payload];
const hash=async()=>(await db.query("select encode(sha256(convert_to(jsonb_build_object('revisions',(select jsonb_agg(to_jsonb(r) order by revision_id) from public.atlas_reforecast_revisions r),'heads',(select jsonb_agg(to_jsonb(h) order by scenario_id) from public.atlas_reforecast_heads h))::text,'UTF8')),'hex') hash")).rows[0].hash;
try{
 await db.exec(`create schema atlas_private;create schema auth;create role anon;create role authenticated;
 create table public.atlas_reforecast_revisions(revision_id uuid,scenario_id uuid,community_id uuid,revision integer,status text,action text,request_id uuid,request_hash text,payload jsonb,source jsonb,snapshot jsonb,actor_id uuid,actor_role text);
 create table public.atlas_reforecast_heads(scenario_id uuid,community_id uuid,revision integer,revision_id uuid,status text);
 create function auth.uid() returns uuid language sql stable as $$select current_setting('test.actor')::uuid$$;
 create function atlas_private.reforecast_access(uuid,text) returns boolean language sql stable as $$select current_setting('test.allow_edit')='true'$$;`);
 await db.query("select set_config('test.actor',$1,false),set_config('test.allow_edit','true',false)",[actor]);
 await db.exec(fixture);await db.exec(`revoke all on function ${signature} from public,anon,authenticated`);
 const beforeBody=await body(),beforeMetadata=await metadata();
 assert.equal(createHash('sha256').update(beforeBody).digest('hex'),'bf900f53b0cee1c2475876245958c20a79d254874717ebe3503c6c84b42ab87a');
 const base={history:[{action:'review',reason:'Preserve this exact original review'}],importMapping:{reviewedBy:'synthetic-reviewer',reason:'Retained review — no truncation'},padding:''};
 const payload=async target=>{const value=structuredClone(base),remaining=target-await bytes(value);value.padding='é'.repeat(Math.floor(remaining/2))+'x'.repeat(remaining%2);assert.equal(await bytes(value),target);return value;};
 const under=await payload(limit-1),at=await payload(limit),over=await payload(limit+1),overFrozen=structuredClone(over);
 const underArgs=args(under),atArgs=args(at),overArgs=args(over);
 const oldUnder=await error(underArgs),oldAt=await error(atArgs),oldOver=await error(overArgs);
 assert.match(oldUnder.message,/changed in another session/);assert.deepEqual(oldAt,oldUnder);assert.equal(oldOver.message,'Invalid reforecast save request');
 const malformed=[args(over,{scenario:null}),args(over,{request:null}),args(over,{expected:null}),args(over,{expected:-1}),args(over,{action:'invented'}),args(['x'.repeat(limit+1)]),args(null)];
 const oldMalformed=await Promise.all(malformed.map(error));for(const e of oldMalformed)assert.equal(e.message,'Invalid reforecast save request');
 await db.query("select set_config('test.allow_edit','false',false)");const oldDenied=await error(overArgs);assert.equal(oldDenied.message,'Reforecast edit access denied');await db.query("select set_config('test.allow_edit','true',false)");
 // Seed an immutable synthetic receipt. The real captured function must return
 // this exact pre-existing payload, source and snapshot for an idempotent retry.
 const receiptArgs=[cid,scenario,0,request,'save_draft',at],source={retained:true},snapshot={fingerprint:'synthetic-only',forecast:null};
 await db.query("insert into public.atlas_reforecast_revisions values($1,$2,$3,1,'working_draft','save_draft',$4,encode(sha256(convert_to(jsonb_build_array($3::uuid,$2::uuid,0,'save_draft',$5::jsonb)::text,'UTF8')),'hex'),$5,$6,$7,$8,'synthetic')",[revision,scenario,cid,request,at,source,snapshot,actor]);
 await db.query("insert into public.atlas_reforecast_heads values($1,$2,1,$3,'working_draft')",[scenario,cid,revision]);
 const oldReceipt=(await call(receiptArgs)).rows[0].value,storedBefore=await hash();assert.deepEqual(oldReceipt.revision.payload,at);
 const changed=structuredClone(at);changed.history[0].reason='Preserve this exact modified review';assert.equal(await bytes(changed),limit);
 const changedArgs=[...receiptArgs.slice(0,5),changed],oldChanged=await error(changedArgs);assert.match(oldChanged.message,/request ID reused/);
 const changedDefinition=fixture.replace('begin\n','begin \n');assert.notEqual(changedDefinition,fixture);await db.exec(changedDefinition);
 await assert.rejects(()=>db.exec(migration),/Audited reforecast save payload guard differs/);await db.exec('rollback');assert.notEqual(await body(),beforeBody);assert.deepEqual(await metadata(),beforeMetadata);assert.equal(await hash(),storedBefore);
 await db.exec(fixture);await db.exec(migration);
 assert.equal(await body(),beforeBody.replace(oldGuard,newGuard),'Only the audited guard changes; no other receipt, access, payload or history code changes');
 assert.deepEqual(await metadata(),beforeMetadata,'Owner, security mode, volatility, settings, ACLs and signature remain exact');
 // Use unrelated scenario IDs because the deliberately seeded receipt now
 // occupies the original scenario. The same stale-revision gate must follow.
 for(const value of [under,at])assert.deepEqual(await error(args(value,{scenario:randomUUID()})),oldUnder);
 const diagnostic=await error(overArgs);assert.equal(diagnostic.message,'Forecast save payload exceeds the 2 MiB limit.');
 assert.deepEqual(JSON.parse(diagnostic.detail),{code:'reforecast_payload_too_large',payloadBytes:limit+1,limitBytes:limit,measurement:'postgres_jsonb_text_utf8',stage:'save_reforecast_builder',retainedReviewHistory:'preserve'});
 assert.match(diagnostic.hint,/Preserve all retained reviews and history/);assert.match(diagnostic.hint,/sending the same payload again will exceed the same limit/);
 for(let i=0;i<malformed.length;i++)assert.deepEqual(await error(malformed[i]),oldMalformed[i],'Malformed request retains priority over size');
 await db.query("select set_config('test.allow_edit','false',false)");assert.deepEqual(await error(overArgs),oldDenied);await db.query("select set_config('test.allow_edit','true',false)");
 assert.deepEqual((await call(receiptArgs)).rows[0].value,oldReceipt,'Exact prior receipt including retained review history remains unchanged');assert.deepEqual(await error(changedArgs),oldChanged);
 assert.equal(await hash(),storedBefore,'All rejected calls and immutable retries preserve every synthetic stored row');assert.deepEqual(over,overFrozen,'No caller payload or review reason is trimmed');
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed",[role,signature])).rows[0].allowed,false);
 await db.exec('set role anon');await assert.rejects(()=>call(overArgs),/permission denied/);await db.exec('reset role');
 const afterHash=createHash('sha256').update(await body()).digest('hex');
 console.log(JSON.stringify({status:'PASS',syntheticOnly:true,priorBodySha256:createHash('sha256').update(beforeBody).digest('hex'),newBodySha256:afterHash,limitBytes:limit,checkedBytes:[limit-1,limit,limit+1],sqlstate:diagnostic.code,detail:JSON.parse(diagnostic.detail),metadataAndAclPreserved:true,storedRowsPreserved:true,exactReceiptReplayPreserved:true,malformedAndAccessPriorityPreserved:true,driftRejected:true}));
}finally{await db.close();}
