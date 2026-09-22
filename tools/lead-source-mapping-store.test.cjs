const assert=require('node:assert/strict');
const Store=require('../docs/portfolio-operations-dashboard/lead-source-mapping-store.js');
(async()=>{
 let doc=null;
 const client={readDocument:async()=>structuredClone(doc),saveDocument:async({payload,expectedVersion})=>{
  if((doc?.version??null)!==expectedVersion)throw Error('conflict');
  doc={version:(doc?.version||0)+1,payload:structuredClone(payload)};
 }};
 const a=Store.create(client),b=Store.create(client);
 await assert.rejects(a.save({rules:[]}),/Load/);
 await a.load();await b.load();
 const payload={rules:[{id:'one',canonicalField:'emails_online',mappingVersion:'v1'}],history:[{previousMappingVersion:null,newMappingVersion:'v1'}]};
 await a.save(payload);
 await assert.rejects(b.save({rules:[]}),/another session/);
 assert.deepEqual(await b.load(),payload,'Second independent session reads the same rules and version history');
 const next={rules:[{id:'one',canonicalField:'text_chat_other',mappingVersion:'v2'}],history:[...payload.history,{previousMappingVersion:'v1',newMappingVersion:'v2'}]};
 await b.save(next);
 assert.deepEqual(await a.load(),next,'Reload observes reassignment');
 const rejected=Store.create({...client,saveDocument:async()=>{throw Error('Not authorized');}});
 await rejected.load();await assert.rejects(rejected.save(payload),/Not authorized/);
 assert.deepEqual(doc.payload,next);
 console.log('PASS shared save, optimistic conflict rejection, reload, two independent simulated sessions, immutable version history and authorization-error propagation');
})().catch(e=>{console.error(e);process.exitCode=1;});
