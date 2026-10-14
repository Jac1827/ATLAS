const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { indexedDB } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('docs/portfolio-operations-dashboard/central-services.js', 'utf8');
const extract = name => source.match(new RegExp('^  (?:async )?function '+name+'\\([^]*?^  \\}', 'm'))[0];
class Reader { async readAsDataURL(blob) { try { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload(); } catch(e) { this.error=e; this.onerror(); } } }
const original = {id:'i',propertyName:'Test Community',residentName:'Test Resident',unit:'101',status:'Awaiting Review',inspectionDate:'2026-10-14',findings:[{id:'f',room:'Living Room',component:'Sink',condition:'Cleaning Required',notes:'Test <script>alert(1)</script>',residentResponsibility:'Recommended',chargebackId:'clean',inspectorRecommendedAmount:125,aiConfidence:99,chargeAudit:[{secret:'internal'}],photos:[]}],audit:[{secret:'internal'}]};
let state = {inspections:[structuredClone(original)],morfRecords:[]}, alerts=[],failSave=false,renders=0;
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context = {indexedDB,FileReader:Reader,crypto:webcrypto,fetch,Blob,URL,window:{location:{href:'https://example.test/portfolio-operations-dashboard/'}},alert:m=>alerts.push(m),asArray:v=>Array.isArray(v)?v:[],escapeHtml:escape,escapeAttr:escape,loadState:()=>structuredClone(state),findInspection:(s,id)=>s.inspections.find(i=>i.id===id),pushInspectionAudit:()=>{},addAudit:()=>{},saveState:s=>{if(failSave)return false; assert.ok(JSON.stringify(s).length < 10000,'Photo bytes must not enter localStorage');state=structuredClone(s);return true;},renderActiveTab:()=>renders++};
vm.createContext(context);
for(const name of ['inspectionPhotoDatabase','inspectionPhotoTransaction','inspectionPhotoDataUrl','resolveInspectionPhotoExport','residentInspectionReportHtml'])vm.runInContext(extract(name),context);
vm.runInContext(source.match(/^  window.atlasCsAttachInspectionPhotos = async function[^]*?^  };/m)[0],context);
(async()=>{
 const big=new Blob([new Uint8Array(6*1024*1024)],{type:'image/jpeg'});big.name='original.jpg';
 const input={files:[big],value:'selected',disabled:false};
 await context.window.atlasCsAttachInspectionPhotos(input,'i','f');
 assert.equal(alerts.length,0);assert.equal(renders,1);assert.equal(input.value,'');
 const photo=state.inspections[0].findings[0].photos[0];assert.ok(photo.photoStorageKey);assert.equal(photo.dataUrl,undefined);
 const stored=await context.inspectionPhotoTransaction('readonly',s=>s.get(photo.photoStorageKey));assert.equal(stored.size,big.size);assert.deepEqual(Buffer.from(await stored.arrayBuffer()),Buffer.from(await big.arrayBuffer()));
 const exported=await context.resolveInspectionPhotoExport(state.inspections[0]);assert.ok(exported.findings[0].photos[0].dataUrl.length>6*1024*1024);assert.equal(exported.findings[0].photos[0].photoStorageKey,undefined);
 const html=context.residentInspectionReportHtml(exported);assert.match(html,/rise-wordmark-blue.png/);assert.match(html,/Print \/ Save as PDF/);assert.match(html,/Potential chargeback/);assert.match(html,/data:image\/jpeg;base64/);assert.match(html,/&lt;script&gt;/);for(const privateField of ['inspectorRecommendedAmount','aiConfidence','chargeAudit','photoStorageKey','internal','125'])assert.ok(!html.includes(privateField),privateField);
 const no=structuredClone(original);no.findings[0].residentResponsibility='No';assert.match(context.residentInspectionReportHtml(no),/No potential chargeback/);
 await assert.rejects(()=>context.inspectionPhotoDataUrl('missing'),/unavailable/);
 const before=JSON.stringify(state);failSave=true;await context.window.atlasCsAttachInspectionPhotos({files:[big],value:'selected'},'i','f');assert.equal(JSON.stringify(state),before);assert.equal(renders,1);failSave=false;
 await context.window.atlasCsAttachInspectionPhotos({files:[{type:'text/plain'}]},'i','f');assert.equal(alerts.length,1);assert.equal(JSON.stringify(state),before);
 // Previously inline originals and MORF thumbnails migrate only after durable storage.
 const inline='data:image/png;base64,aGVsbG8=';state.inspections[0].findings[0].photos.push({id:'legacy',dataUrl:inline});state.morfRecords=[{charges:[{thumbnail:inline}]}];
 await context.window.atlasCsAttachInspectionPhotos({files:[big]},'i','f');const legacy=state.inspections[0].findings[0].photos.find(p=>p.id==='legacy');assert.ok(legacy.photoStorageKey);assert.equal(legacy.dataUrl,undefined);assert.equal(state.morfRecords[0].charges[0].thumbnailStorageKey,legacy.photoStorageKey);assert.equal(await context.inspectionPhotoDataUrl(legacy.photoStorageKey),inline);
 const modules=source.match(/const MODULES = \[([^]*?)\n  \];/)[1];for(const removed of ['communications','invoices','compliance'])assert.ok(!modules.includes(`"${removed}"`));
 const admin=fs.readFileSync('docs/portfolio-operations-dashboard/features/admin-workspace.js','utf8');assert.match(admin,/atlasSetSettingsSection\('compliance'\)/);assert.match(admin,/window.renderAtlasComplianceSettings\(\)/);
 console.log('PASS inspection originals > localStorage quota persist in IndexedDB, metadata stays small, exports contain images, legacy photos migrate, failed saves preserve records, resident report is branded and excludes private fields, and navigation moves Compliance.');
})().catch(e=>{console.error(e);process.exitCode=1;});
