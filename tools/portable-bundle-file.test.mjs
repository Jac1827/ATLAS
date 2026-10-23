import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readPortableBundleFile} from '../docs/portfolio-operations-dashboard/features/portable-bundle-file.mjs';
const require=createRequire(import.meta.url),api=require('../docs/portfolio-operations-dashboard/migration-archive.js');
const read=(text,options={})=>readPortableBundleFile(new Blob([text]),{api,...options});

test('portable archive streams data in any field order without reading the full file as text',async()=>{
  const data='QUJD'.repeat(65536),metadata={bundleType:api.TYPE,sha256:'a'.repeat(64),bytes:196608,recordCount:11,reconciliation:{zero:0,missing:null}};
  for(const value of [{...metadata,data},{data,...metadata}]){
    const file=new Blob([JSON.stringify(value)]);
    file.text=()=>{throw Error('Full-file text is forbidden');};
    file.arrayBuffer=()=>{throw Error('Full-file buffer is forbidden');};
    const result=await readPortableBundleFile(file,{api,maxMetadataBytes:2048});
    assert.equal(await result.dataBlob.text(),data);
    assert.equal(Object.hasOwn(result,'data'),false);
    const {dataBlob,...rest}=result;assert.deepEqual(rest,metadata);
  }
});

test('ordinary bundles preserve data types, escaped text, Unicode and own prototype keys',async()=>{
  for(const data of [null,0,false,[0,null],{nested:'data'},'not base64: \n"\\/😀\ud800','a'.repeat(8191)+'😀\ud800']){
    const value={bundleType:'ordinary',data,nested:{data:'kept'},zero:0,missing:null};
    assert.deepEqual(await read(JSON.stringify(value)),value);
  }
  const value=await read('{"__proto__":{"polluted":true},"data":"ordinary","constructor":0}');
  assert.equal(Object.getPrototypeOf(value),Object.prototype);assert.equal(value.__proto__.polluted,true);assert.equal({}.polluted,undefined);
  assert.deepEqual(await read('[0,null,"text"]'),[0,null,'text']);
});

test('escaped archive base64 keeps decoded JSON string semantics',async()=>{
  const result=await read('{"data":"\\u0051UJD\\/w==","bundleType":"'+api.TYPE+'"}');
  assert.equal(await result.dataBlob.text(),'QUJD/w==');
});

test('strict JSON, duplicate keys and truncated files are rejected before returning a bundle',async()=>{
  for(const text of ['', ' ', '{"x":1,}', '[0,]', '{"x":"unfinished', '{"x":tru}', '{"x":1,"x":2}', '{"x":{"a":0,"a":1}}', '{"data":"QQ==","data":"Qg=="}', '{}{}','{"x":\u00a01}', '\ufeff{}', '{"x":1}\u000b', '{"x":\u000c1}', '{"x":1\u00a0}', '{"x":"\\q"}', '{"x":01}', '{"x":1e999}']){
    await assert.rejects(read(text),/JSON|empty|duplicate|migration/i,text);
  }
  await assert.rejects(readPortableBundleFile(new Blob([Uint8Array.of(123,34,120,34,58,34,255,34,125)]),{api}),/encoded|encoding/i);
});

test('archive base64 and conflicting runtime transports are rejected',async()=>{
  for(const data of ['A','AAA','A===','AA=A','AA==AAAA','AA===','====','QUJD\n','QUJDé','QUJD\\','AAAA=']){
    await assert.rejects(read(JSON.stringify({bundleType:api.TYPE,data})),/base64/);
  }
  for(const name of ['dataBlob','bytesData'])await assert.rejects(read(JSON.stringify({bundleType:api.TYPE,data:'QUJD',[name]:{}})),/conflicting/);
  for(const data of [null,[],{},0])await assert.rejects(read(JSON.stringify({bundleType:api.TYPE,data})),/base64 string/);
  for(const name of ['dataBlob','bytesData'])await assert.rejects(read(JSON.stringify({bundleType:api.TYPE,[name]:{}})),/conflicting/);
  const hydrated=await read(JSON.stringify({bundleType:api.TYPE,data:'QUJD',dataDocuments:[{documentKey:'old-reference'}]}));
  assert.equal(Object.hasOwn(hydrated,'dataDocuments'),false);assert.equal(await hydrated.dataBlob.text(),'QUJD');
});

test('metadata and ordinary data limits are measured in encoded bytes while archive data stays streamed',async()=>{
  await assert.rejects(read(JSON.stringify({metadata:'é'.repeat(100)}),{maxMetadataBytes:150}),/size/);
  await assert.rejects(read(JSON.stringify({data:'é'.repeat(100)}),{maxMetadataBytes:150}),/size/);
  await assert.rejects(read(JSON.stringify({data:{nested:{deeper:{}}}}),{maxDepth:3}),/depth/);
  const result=await read(JSON.stringify({data:'QUJD'.repeat(4096),bundleType:api.TYPE}),{maxMetadataBytes:128});
  assert.equal(result.dataBlob.size,16384);
});

test('cancelled or changed workspace reads throw without producing a result',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(read('{}',{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(read('{}',{isCurrent:()=>false}),{name:'AbortError'});
  let checks=0;
  await assert.rejects(read(JSON.stringify({bundleType:api.TYPE,data:'QUJD'.repeat(65536)}),{isCurrent:()=>++checks<6}),{name:'AbortError'});
});
