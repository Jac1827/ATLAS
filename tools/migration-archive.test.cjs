const assert=require('node:assert/strict');
const api=require('../docs/portfolio-operations-dashboard/migration-archive.js');
const Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
(async()=>{
 const bundle={bundleType:'atlas_browser_storage_bundle_v2',keys:{people:'{"employees":[{"id":"test"}]}'},indexedDb:{communityData:{Test:{monthlyData:[{occupiedSnapshot:0,rentableUnits:100}],financialLedger:{actual:42}}},dailyBackups:{prior:{value:17}}}};
 const records=[{key:'atlas_data_import_2_state_v1',value:{canonicalRecords:[{occupied_units:0,source_leased_units:null}],lineage:[{id:'original'}]}},{key:'atlas_data_import_source_file:test',value:{blob:new Blob(['original workbook bytes'],{type:'application/octet-stream'})}}];
 const packed=await api.pack(bundle,records,Zip),restored=await api.unpack(JSON.parse(JSON.stringify(packed)),Zip);
 assert.deepEqual(restored.bundle,bundle);assert.deepEqual(restored.records[0],records[0]);assert.equal(await restored.records[1].value.blob.text(),'original workbook bytes');
 assert.equal(restored.records[1].value.blob.type,'application/octet-stream');
 assert.deepEqual(await api.unpack(bundle,Zip),{bundle,records:[]});
 await assert.rejects(api.unpack({...packed,sha256:'bad'},Zip),/fingerprint/);
 const docs=new Map();let writes=0;const client={readDocument:async k=>docs.get(k)||null,saveDocument:async o=>{writes++;assert.ok(o.payload.data.length<=128);docs.set(o.documentKey,{payload:o.payload});}};
 const published=await api.publish(packed,client,128);assert.equal(published.data,undefined);assert.ok(published.dataDocuments.length>1);
 const roundTrip=await api.unpack(await api.hydrate(published,client),Zip);assert.deepEqual(roundTrip.bundle,bundle);
 const firstWrites=writes;await api.publish(packed,client,128);assert.equal(writes,firstWrites,'duplicate transfer must reuse immutable parts');
 docs.get(published.dataDocuments[0].documentKey).payload.data='corrupt';await assert.rejects(api.hydrate(published,client),/missing or changed/);
 await assert.rejects(api.publish(packed,client,128),/readback mismatch/);
 console.log('PASS migration archive: lossless history, unrelated fields, zero/null values, workbook bytes, legacy compatibility and corruption rejection');
})().catch(e=>{console.error(e);process.exit(1);});
