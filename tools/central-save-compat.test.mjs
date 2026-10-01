import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {patchCentralSaveAccessContext} from './central-save-compat.mjs';
import {OPERATIONAL_RELEASE} from './compose-finance-compat-source.mjs';
const retained=execFileSync('git',['show',`origin/atlas-asset-releases:_atlas-assets/${OPERATIONAL_RELEASE}/portfolio-operations-dashboard/centralization/atlas-central-client.js`],{encoding:'utf8'});
const current=await fs.readFile('docs/portfolio-operations-dashboard/centralization/atlas-central-client.js','utf8');
const patched=patchCentralSaveAccessContext(retained,current);
function fixture(source){
 const values=new Map(),writes=[];
 const session={user:{id:'actor-a'},access_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600};
 const profile={user_id:'actor-a',role:'admin',status:'active',allowed_community_ids:['one']};
 values.set('atlas_central_auth_session_v1',JSON.stringify(session));
 values.set('atlas_central_profile_v1',JSON.stringify(profile));
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const window={addEventListener(){},dispatchEvent(){},setTimeout(){return 0;},clearTimeout(){}};
 const context={window,localStorage:storage,sessionStorage:storage,TextEncoder,performance,DOMException,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{writes.push({url,options});return {ok:true,status:200,text:async()=>JSON.stringify({version:2})};}};
 vm.runInNewContext(source,context);
 return {client:window.ATLAS_CENTRAL,writes,values,profile};
}
const options={payload:{fixture:true},sourceHash:'synthetic-hash',expectedVersion:1};
await assert.rejects(fixture(retained).client.saveDocument(options),/getAccessContextKey is not defined/,'Reproduce the actual retained release failure without stubbing the missing helper');
const success=fixture(patched);assert.equal((await success.client.saveDocument(options)).version,2);assert.equal(success.writes.length,1);
for(const field of ['role','allowed_community_ids','locked_page_keys']){
 const f=fixture(patched);let calls=0;
 await assert.rejects(f.client.saveDocument({...options,isCurrent(){if(++calls===1)f.values.set('atlas_central_profile_v1',JSON.stringify({...f.profile,[field]:field==='role'?'viewer':['changed']}));return true;}}),/context changed/);
 assert.equal(f.writes.length,0,'Changed access cannot write: '+field);
}
for(const bad of [patched,retained.replace('  function getSession() {','  function movedSession() {'),retained+'\n  function getSession() {'])assert.throws(()=>patchCentralSaveAccessContext(bad,current),/boundary changed/);
assert.equal(patched.replace(current.match(/^  function getAccessContextKey\(\) \{[\s\S]*?^  \}/m)[0]+'\n\n',''),retained,'Removing only the helper restores every retained byte');
console.log('PASS actual retained Central save failure reproduced; full patched client saves and blocks changed roles/scopes/pages; exact helper-only boundary verified.');
