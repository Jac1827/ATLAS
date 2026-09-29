import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {projectCurrentHistory} from '../docs/portfolio-operations-dashboard/features/import-history-store.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const Archive=require('../docs/portfolio-operations-dashboard/migration-archive.js'),Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFor=archive=>({documentKey:'atlas_dashboard_state_v1',version:12,archiveHash:archive.sha256,effectiveAt:'2026-09-29T12:00:00Z'});
const summarySource={communityName:'Doro',periodKey:'2026-09',fileHash:'source-hash',dataAsOf:'2026-09-28',reportType:'box_score'};
const history={
  activeView:'history',pendingBatch:{doNotProject:'pending-workbook'.repeat(2000)},
  batches:Array.from({length:38},(_,i)=>({id:'batch-'+i,status:'approved',summary:{count:i},beforeSnapshot:{savedData:{privateHistory:'snapshot'.repeat(2000)}},beforeSnapshotRef:{batchId:'batch-'+i,capturedAt:'2026-09-28',sha256:'a'.repeat(64)},files:[{fileName:'retained.xlsx',reportType:'box_score',reportTypeLabel:'Box Score',parsedRows:'rows'.repeat(1000)}],routeMessages:['one','two','excluded-message']})),
  canonicalRecords:[{...summarySource,key:'canonical-zero',values:{occupied_units:0,total_units:25,unrelated:55}},{...summarySource,key:'canonical-null',values:{occupied_units:null}},{...summarySource,key:'not-current',fileHash:'older',values:{occupied_units:9}}],
  lineage:[{...summarySource,id:'lineage-zero',atlasField:'occupied_units',value:0,currentState:true},{...summarySource,id:'lineage-null',atlasField:'total_units',value:null,currentState:true},{...summarySource,id:'lineage-old',atlasField:'occupied_units',value:9,currentState:false}],
  sourceArchive:[{id:'new-source',communities:['Doro'],reportType:'box_score',fileHash:'new'},{id:'older-source',communities:['Doro'],reportType:'box_score',fileHash:'old'}],
  exceptions:Array.from({length:220},(_,i)=>({id:'exception-'+i,value:i===0?null:i})),reconciliationLog:[{id:'retained-audit',text:'audit'.repeat(1000)}],mappingAuditTrail:[{id:'mapping-audit'}],leadSourceHistoricalRevisions:[{id:'lead-history'}],temporaryIgnoreHistory:[{id:'ignore-history'}]
};
const bundle={keys:{rise_ops_global_v1:JSON.stringify({selectedPeriod:'2026-09',zero:0,missing:null}),unrelated:'do-not-keep'},indexedDb:{communityData:{Doro:{occupied:0,unknown:null,reportYear:2026}},dailyBackups:{old:{privateHistory:'backup'.repeat(2000)}}}};
const records=[{key:'occupancy_replay_backup:older',value:{privateHistory:'older-history'.repeat(2000)}},{key:'atlas_data_import_2_state_v1',value:history},{key:'atlas_data_import_source_file:retained',value:new Blob(['original-source'.repeat(4000)])}];
const archive=await Archive.pack(bundle,records,Zip,{segmentBytes:4096});
const root=path.resolve('docs/portfolio-operations-dashboard');
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local'),file=path.resolve(root,'.'+url.pathname);res.setHeader('Content-Type',/\.(mjs|js)$/.test(file)?'text/javascript':'text/html');if(url.pathname==='/harness.html')return res.end('<title>Isolated segmented projection</title>');try{if(!file.startsWith(root+path.sep))throw Error();res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
async function rewriteArchive(original,mutate){
  const zip=await Zip.loadAsync(Buffer.from(original.data,'base64')),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  await mutate(zip,manifest);zip.file('manifest.json',JSON.stringify(manifest));
  const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  return {...original,bytes:bytes.length,sha256:sha(bytes),data:Buffer.from(bytes).toString('base64')};
}
async function alterTokenSegment(zip,entry,change){
  const part=entry.segments[0],stored=await zip.file(part.name).async('uint8array');
  const decoded=await new Response(new Blob([stored]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
  const tokens=JSON.parse(Buffer.from(decoded).toString('utf8'));change(tokens);
  const bytes=Buffer.from(JSON.stringify(tokens)),packed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  entry.bytes+=bytes.length-part.bytes;Object.assign(part,{bytes:bytes.length,sha256:sha(bytes),storedBytes:packed.length,storedSha256:sha(packed)});zip.file(part.name,packed,{compression:'STORE'});
  entry.sha256=sha(Buffer.from(JSON.stringify({layout:entry.layout,name:entry.name,segmentBytes:entry.segmentBytes,segments:entry.segments})));
}
try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/harness.html`);
  const run=(input,source=sourceFor(input))=>page.evaluate(async({archive,source})=>{const worker=new Worker('./features/workspace-projection-worker.js');try{return await new Promise((resolve,reject)=>{worker.onmessage=({data})=>resolve(data);worker.onerror=e=>reject(Error(e.message));worker.postMessage({archive,source});});}finally{worker.terminate();}},{archive:input,source});
  const result=await run(archive);assert.equal(result.ok,true,result.error);
  const expected=projectCurrentHistory(history);expected.historyStorage={...expected.historyStorage,view:'remote',archiveHash:archive.sha256,parentDocument:'atlas_dashboard_state_v1',version:12};
  // Compare the reduced read to the established complete-history projector,
  // including every count, source selection, summary/ref, and null/zero value.
  assert.deepEqual(JSON.parse(JSON.stringify(result.value.importState)),JSON.parse(JSON.stringify(expected)));
  assert.deepEqual(result.value.communityData,bundle.indexedDb.communityData);assert.deepEqual(result.value.opsGlobalData,JSON.parse(bundle.keys.rise_ops_global_v1));
  assert.equal(result.value.importState.historyStorage.counts.batches,38);assert.equal(result.value.importState.historyStorage.counts.exceptions,220);
  assert.equal(result.value.importState.batches.length,25);assert.equal(result.value.importState.exceptions.length,25);
  assert(!JSON.stringify(result).includes('privateHistory'));assert(!JSON.stringify(result).includes('parsedRows'));assert(!JSON.stringify(result).includes('original-source'));
  assert.equal((await run(archive,{...sourceFor(archive),archiveHash:'f'.repeat(64)})).ok,false);
  const corruption=await rewriteArchive(archive,async(zip,m)=>{const part=m.entries.at(-1).segments[0];zip.file(part.name,new Uint8Array([1,2,3]),{compression:'STORE'});});
  assert.match((await run(corruption)).error,/fingerprint|byte limit/);
  const invalidSkipped=await rewriteArchive(archive,async(zip,m)=>alterTokenSegment(zip,m.entries[1],tokens=>{tokens.splice(1,0,['endString']);}));
  assert.match((await run(invalidSkipped)).error,/Incomplete migration string/);
  const duplicateSkipped=await rewriteArchive(archive,async(zip,m)=>alterTokenSegment(zip,m.entries[1],tokens=>{tokens.splice(1,0,['key'],['string'],['text','key'],['endString'],['value',0]);}));
  assert.match((await run(duplicateSkipped)).error,/duplicate migration object key/);
  const missing=await rewriteArchive(archive,async(zip,m)=>zip.remove(m.entries.at(-1).segments.at(-1).name));
  assert.match((await run(missing)).error,/segment is missing/);
  const unsupported=await rewriteArchive(archive,async(_zip,m)=>{m.entries.at(-1).layout='unknown';});
  assert.match((await run(unsupported)).error,/Unsupported migration record layout/);
  const reordered=await Archive.pack(bundle,[{value:history,key:'atlas_data_import_2_state_v1'}],Zip,{segmentBytes:4096});
  assert.match((await run(reordered)).error,/identity must precede/);
  const duplicate=await Archive.pack(bundle,[records[1],records[1]],Zip,{segmentBytes:4096});
  assert.match((await run(duplicate)).error,/duplicate canonical import evidence/);
  const invalidLegacy=await Archive.pack({},[{key:'ignored-source',value:{blob:{__atlasMigrationBlob:true,type:'application/test',base64:'!invalid!'}}}],Zip);
  await assert.rejects(Archive.visitSelectedRecords(invalidLegacy,Zip,{select:(_name,p)=>p.length===0||p[0]==='key',onRecord(){}}),/character|decode/i);
  // All complete-record consumers still restore exactly the same archive.
  const restored=await Archive.unpack(archive,Zip);assert.deepEqual(restored.bundle,bundle);assert.deepEqual(restored.records[1],records[1]);assert.equal(await restored.records[2].value.text(),await records[2].value.text());
  console.log('PASS segmented workspace projection: complete-history parity, pruned snapshots/blobs, original counts, null/zero, exact parent binding, duplicate/missing/corrupt/unknown skipped evidence rejection, legacy reader preservation.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
