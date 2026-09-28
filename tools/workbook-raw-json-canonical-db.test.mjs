import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require('@electric-sql/pglite');
const db=new PGlite(),timings=[];
const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const timed=async(operation,work)=>{const start=performance.now(),result=await work();timings.push({operation,milliseconds:Math.round(performance.now()-start)});return result;};
try{
 await db.exec('create schema atlas_private;create role anon;create role authenticated;grant usage on schema atlas_private to anon,authenticated;');
 const original=migration('20260925011545_workbook_audit_validation_performance.sql').match(/create or replace function atlas_private\.workbook_canonical_json\([\s\S]*?\$\$;/)[0];
 await db.exec(original);
 const prior=(await db.query("select pg_get_functiondef('atlas_private.workbook_canonical_json(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(migration('20260925032350_workbook_raw_json_canonical.sql'));
 assert.equal((await db.query("select pg_get_functiondef('atlas_private.workbook_canonical_json(jsonb)'::regprocedure) definition")).rows[0].definition,prior,'Installing raw helpers must leave the existing native verifier unchanged');
 assert.equal((await db.query("select count(*)::int count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows[0].count,0,'Private helper installation exposes no public RPC');
 const padding=JSON.stringify('x'.repeat(66000));
 const examples=[
  'null','true','false','0','-0','1.000','-1.2500','1.2e5','1.2e-7','123456789012345678901234567890.00000',
  '"é / \\uD83D\\uDE00 \\t \\n \\" \\\\ \\u2028"','"\\u0061"','{}','[]','[0,null,false,"",{},[],1e2]',
  '{"z":0,"a":1,"A":2,"é":3,"😀":4,"":5}',
  '{"a":1,"b":2,"a":3,"\\u0062":4,"a":null}',
  '{"fingerprint":"remove","nested":{"fingerprint":"keep"}}',
  `{"padding":${padding},"a":1,"b":{"x":1,"x":2},"a":3,"fingerprint":0,"fingerprint":"last"}`,
  `[${Array.from({length:9000},(_,i)=>i%3===0?'null':i%3===1?'0':JSON.stringify({z:i,a:'é'})).join(',')}]`,
  `{"first":[${Array.from({length:9000},(_,i)=>`{"same":${i},"same":${i+1}}`).join(',')}],"padding":${padding}}`,
  `{"padding":${padding},"\\u0061":0,"a":1,"😀":2,"\\ud83d\\ude00":3,"":null}`,
  `{"padding":${padding},"fingerprint":{"nested":[0,null]},"nested":{"fingerprint":"must remain"}}`,
  `{"padding":${padding},"a":0,"z":1,"a":null,"z":false}`,
 ];
 for(const text of examples){
  const result=(await db.query('select atlas_private.workbook_canonical_json_raw($1::json) actual,atlas_private.workbook_canonical_json($1::jsonb) expected',[text])).rows[0];
  assert.equal(result.actual,result.expected,'Raw canonical text must equal native canonical text exactly');
  if(text[0]==='{'){
   const body=(await db.query("select atlas_private.workbook_canonical_audit_body_raw($1::json) actual,atlas_private.workbook_canonical_json($1::jsonb-'fingerprint') expected",[text])).rows[0];assert.equal(body.actual,body.expected,'Only the top-level fingerprint is omitted');
  }
 }
 // Failures hidden by a duplicate key, an omitted key, or a large-container
 // branch must still be rejected before canonicalization selects survivors.
 const bad=['"\\u0000"','"\\ud800"','"\\udc00"','"\\ud800x"','1e131072','1e-16384'];
 const invalid=bad.flatMap(value=>[value,`{"x":${value},"x":1}`,`{"padding":${padding},"x":${value},"x":1}`,`{"padding":${padding},"fingerprint":${value},"fingerprint":"last"}`]);
 for(const text of invalid){
  await assert.rejects(db.query('select $1::jsonb',[text]),'Adversarial fixture must also fail native JSONB');
  await assert.rejects(db.query('select atlas_private.workbook_canonical_json_raw($1::json)',[text]),'Raw canonicalization must reject invalid native values even if overwritten');
  if(text[0]==='{')await assert.rejects(db.query('select atlas_private.workbook_canonical_audit_body_raw($1::json)',[text]),'Fingerprint omission must not hide invalid native values');
 }
 for(const text of ['[]','null','1','"value"'])await assert.rejects(db.query('select atlas_private.workbook_canonical_audit_body_raw($1::json)',[text]),'Audit hashing requires an object');
 assert.equal((await db.query('select atlas_private.workbook_canonical_json_raw(null::json) value')).rows[0].value,null);
 for(const role of ['anon','authenticated'])for(const signature of ['workbook_canonical_json_raw_value(json,text)','workbook_canonical_json_raw(json)','workbook_canonical_audit_body_raw(json)','workbook_audit_fingerprint_raw(json)'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,'atlas_private.'+signature])).rows[0].allowed,false);
 const proof={scope:'Isolated PostgreSQL; no production installation or acceptance claimed',validParityCases:examples.length,invalidParityCases:invalid.length,overwrittenAndOmittedInvalidValuesRejected:true,existingNativeVerifierUnchanged:true,privateHelpersOnly:true,timings};
 if(process.env.ATLAS_DORO_EVIDENCE){
  const file=JSON.parse(fs.readFileSync(process.env.ATLAS_DORO_EVIDENCE,'utf8')),audit=file.integrity||file,auditText=JSON.stringify(audit);
  const raw=await timed('actual_raw_canonical_fingerprint',async()=>(await db.query('select atlas_private.workbook_audit_fingerprint_raw($1::json) fingerprint',[auditText])).rows[0]);
  assert.equal(raw.fingerprint,audit.fingerprint,'Complete actual raw evidence must retain its independently computed fingerprint');
  const native=await timed('actual_native_canonical_fingerprint',async()=>(await db.query("select encode(sha256(convert_to(atlas_private.workbook_canonical_json($1::jsonb-'fingerprint'),'UTF8')),'hex') fingerprint",[auditText])).rows[0]);
  assert.equal(raw.fingerprint,native.fingerprint);
  Object.assign(proof,{auditBytes:Buffer.byteLength(auditText),auditFingerprint:raw.fingerprint,completeActualNativeFingerprintParity:true});
 }
 if(process.env.ATLAS_RAW_JSON_PROOF)fs.writeFileSync(process.env.ATLAS_RAW_JSON_PROOF,JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify(proof));
}finally{await db.close();}
