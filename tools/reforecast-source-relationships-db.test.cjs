// Exercise complete atomic import acceptance with relationship governance added;
// additional focused cases tamper the immutable upload's normalized metadata.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const originalRead=fs.readFileSync,fixtures=require('./reforecast-fixture.cjs'),originalFixture=fixtures.fixture;
const relationship=originalRead.call(fs,path.join(__dirname,'../supabase/migrations/20260925013918_reforecast_import_source_relationships.sql'),'utf8');
fs.readFileSync=function(file,...args){const value=originalRead.call(this,file,...args);return String(file).endsWith('/20260925012933_reforecast_atomic_create_from_import.sql')?value+relationship:value;};
fixtures.fixture=async(...args)=>{const context=await originalFixture(...args),close=context.db.close.bind(context.db);context.db.close=async()=>{
 await context.db.exec('reset role');const u=(await context.db.query('select payload from atlas_reforecast_uploads order by created_at limit 1')).rows[0].payload,r=(await context.db.query("select payload from atlas_reforecast_revisions where payload->>'uploadId' is not null order by created_at limit 1")).rows[0].payload;
 const audit=(await context.db.query('select evidence from atlas_workbook_audits where audit_id=$1',[u.integrity.auditId])).rows[0].evidence,mapping=r.importMapping;
 const validate=(upload,review=mapping)=>context.db.query('select atlas_private.validate_reforecast_source_relationships($1,$2,$3)',[upload,audit,review]);
 const changedGL=structuredClone(u);changedGL.lines.find(l=>l.id===mapping.selectedLineIds[0]).accountCode='6100';await assert.rejects(()=>validate(changedGL),/Source GL relationship/);
 const changedMonth=structuredClone(u);changedMonth.lines.find(l=>l.id===mapping.selectedLineIds[0]).period='2026-03';await assert.rejects(()=>validate(changedMonth),/period or scenario/);
 const otherColumn=structuredClone(u);otherColumn.lines.find(l=>l.id===mapping.selectedLineIds[0]).headerAddresses=['D2'];await assert.rejects(()=>validate(otherColumn),/same audited amount column/);
 const changedScenario=structuredClone(u);changedScenario.lines.find(l=>l.id===mapping.selectedLineIds[0]).scenario='Actual';await assert.rejects(()=>validate(changedScenario),/audited selection/);
 const changedIdentifier=structuredClone(u);changedIdentifier.lines.find(l=>l.id===mapping.selectedLineIds[0]).identifiers[0].value='Forged department';await assert.rejects(()=>validate(changedIdentifier),/identifier relationship|identifier differs/);
 const obsolete={...u,parserVersion:'atlas-reforecast-xlsx/2'};await assert.rejects(()=>validate(obsolete),/Reparse the retained original/);
 // Exclusions remain legitimate when their normalized source lines are retained.
 const subset={...mapping,selectedLineIds:[mapping.selectedLineIds[1]]};await validate(u,subset);
 const dropped=structuredClone(u);dropped.lines=dropped.lines.filter(l=>l.id!==mapping.selectedLineIds[0]);await assert.rejects(()=>validate(dropped,subset),/inventory omitted or changed/);
 // Historical committed receipts remain exact readable records after an old
 // parser is superseded; a new write using that parser fails closed.
 const uploadId=randomUUID();await context.db.query("insert into atlas_reforecast_uploads(upload_id,community_id,request_id,source_hash,content_hash,payload,created_by,created_role) values($1,$2,$3,$4,'old-parser-fixture',$5,$6,'admin')",[uploadId,context.A,randomUUID(),u.source.sha256,obsolete,'00000000-0000-0000-0000-000000000001']);
 const oldConfig={...r,uploadId,importHistory:[]};const source=(await context.db.query('select source from atlas_reforecast_revisions order by created_at limit 1')).rows[0].source;await assert.rejects(()=>context.db.query('select atlas_private.reforecast_import_issues($1,$2)',[source,oldConfig]),/Reparse the retained original/);
 console.log('PASS independent audited GL/header/scenario bindings, forged same-amount metadata rejection, old-parser write denial, retained exclusions and complete numeric inventory coverage');await close();};return context;};
require('./reforecast-atomic-import-db.test.cjs');
