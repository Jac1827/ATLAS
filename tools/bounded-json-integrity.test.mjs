import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {jsonChunks,hashJson,jsonEqual,Sha256} from '../docs/portfolio-operations-dashboard/features/bounded-json-integrity.mjs';
import {sha256} from '../docs/portfolio-operations-dashboard/features/financial-snapshot.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const expectedHash=value=>digest(new TextEncoder().encode(JSON.stringify(value===undefined?null:value,(_key,item)=>{if(typeof item==='function'||typeof item==='symbol')throw Error('unsupported');return item;})));
const encoder=new TextEncoder();
for(const length of [0,1,7,55,56,63,64,65,119,120,127,128,129,1000,1000000]){
 const bytes=encoder.encode('a'.repeat(length));
 for(const step of [1,17,64,1009]){
  const stream=new Sha256();for(let offset=0;offset<bytes.length;offset+=step)stream.update(bytes.subarray(offset,offset+step));
  assert.equal(stream.digestHex(),digest(bytes),'SHA-256 block/padding boundary '+length+'/'+step);
  assert.throws(()=>stream.update(bytes),/finalized/);assert.throws(()=>stream.digestHex(),/finalized/);
 }
}
for(const text of ['', 'abc','Unicode € 文書 😀','a'.repeat(100000)])assert.equal(new Sha256().update(encoder.encode(text)).digestHex(),sha256(text),'Existing financial SHA-256 compatibility');
const nullProto=Object.create(null);Object.defineProperty(nullProto,'__proto__',{value:{zero:0},enumerable:true});nullProto.constructor=null;nullProto.toString='retained';
const shared={same:0},symbolTag={retained:true};Object.defineProperty(symbolTag,Symbol.toStringTag,{get(){throw Error('Stringify must not read custom symbol tag');}});
const boxed=new Number(4);boxed.valueOf=()=>5;
const cases=[undefined,null,false,true,0,-0,NaN,Infinity,-Infinity,'',nullProto,shared,[shared,shared],symbolTag,boxed,new Boolean(false),new String('x😀'),Object(Symbol('x')),new Date('2026-09-29T12:00:00Z'),new Date('invalid'),new Uint8Array([0,1,255]),new Blob(['retained bytes']),{z:1,'10':'ten','2':'two',a:undefined},[undefined,,NaN,Infinity],{get a(){return undefined},b:null}];
for(let length=0;length<70;length++)cases.push({['k'.repeat(length)+'😀']:'x'.repeat(length)+'😀\ud800|\udc00|\u0000\n\r\t"\\€'});
for(const value of cases)for(const chunkSize of [16,17,31,64,65536]){
 const chunks=[...jsonChunks(value,{chunkSize})],text=chunks.join('');
 assert.equal(text,JSON.stringify(value)??'','Native JSON text compatibility');
 assert(chunks.every(chunk=>chunk.length<=chunkSize));
 for(let i=0;i+1<chunks.length;i++)assert(!(/[\uD800-\uDBFF]$/.test(chunks[i])&&/^[\uDC00-\uDFFF]/.test(chunks[i+1])),'Chunk must not split surrogate pair');
 // Function-valued boxed metadata is ignored by native boxed conversion only
 // after the replacer sees the object, matching the retained hash contract.
 assert.equal(await hashJson(value,{chunkSize,smallBytes:0}),expectedHash(value));
 assert.equal(await hashJson(value,{chunkSize}),expectedHash(value));
}
let seed=0x73219af;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/0x100000000;};
const choose=values=>values[Math.floor(random()*values.length)];
function generated(depth=0){
 if(depth>4||random()<.45)return choose([null,undefined,true,false,0,-0,NaN,Infinity,random()*1e30-1e29,'雪😀\ud800\udc00\udfff\n"\\'.repeat(Math.floor(random()*10))]);
 if(random()<.5)return Array.from({length:Math.floor(random()*8)},()=>generated(depth+1));
 const value=Object.create(random()<.2?null:Object.prototype);
 for(let i=0;i<Math.floor(random()*8);i++)Object.defineProperty(value,choose(['z','01','9','2','__proto__','constructor','雪😀'])+i,{value:generated(depth+1),enumerable:true});
 return value;
}
for(let i=0;i<500;i++){
 const value=generated(),size=choose([16,17,31,63,127]);
 assert.equal([...jsonChunks(value,{chunkSize:size})].join(''),JSON.stringify(value)??'');
 assert.equal(await hashJson(value,{chunkSize:size,smallBytes:i%2?0:128}),expectedHash(value));
 assert.equal(jsonEqual(value,structuredClone(value),{chunkSize:size}),true);
}
for(const make of [
 calls=>({toJSON(key){calls.push(['root',key]);return {child:{toJSON(key){calls.push(['child',key]);return 'value😀';}}};}}),
 calls=>[{toJSON(key){calls.push(['array',key]);return 0;}}],
 calls=>({value:{toJSON(key){calls.push(['field',key]);return undefined;}}}),
]){
 const nativeCalls=[],chunkCalls=[],hashCalls=[];
 const expected=JSON.stringify(make(nativeCalls));
 assert.equal([...jsonChunks(make(chunkCalls),{chunkSize:16})].join(''),expected);
 assert.deepEqual(chunkCalls,nativeCalls,'toJSON receives each native property key exactly once');
 await hashJson(make(hashCalls),{chunkSize:16,smallBytes:0});assert.deepEqual(hashCalls,nativeCalls,'Hashing never revisits toJSON during hybrid transition');
}
for(const value of [()=>0,Symbol('value'),{nested:()=>0},[Symbol('item')],{toJSON(){return Symbol('result')}}])await assert.rejects(hashJson(value),error=>error.code==='history_integrity');
for(const value of [1n,Object(1n),{nested:1n}]){assert.throws(()=>[...jsonChunks(value)],TypeError);await assert.rejects(hashJson(value),TypeError);}
const cycle={};cycle.self=cycle;assert.throws(()=>[...jsonChunks(cycle)],/circular/);await assert.rejects(hashJson(cycle),/circular/);
assert(jsonEqual({a:undefined,b:0},{b:0}));assert(jsonEqual([undefined,,NaN],[null,null,null]));assert(jsonEqual(undefined,()=>{}));
assert(!jsonEqual({a:1,b:2},{b:2,a:1}),'Object key order remains part of exact JSON comparison');
assert(!jsonEqual({n:0},{n:null}));assert(!jsonEqual({p:'x'.repeat(10000)},{p:'x'.repeat(9999)+'y'},{chunkSize:16}));
// Simulate the full-root/string ceiling with a small forced streaming threshold.
// Native stringify is permitted only for scalar fragments, never whole graphs.
const large={rows:Array.from({length:1000},(_,i)=>({i,text:'😀\ud800<>&\\'.repeat(20),nested:{zero:0,missing:null}}))},hash=expectedHash(large),nativeStringify=JSON.stringify;
try{
 JSON.stringify=(value,...args)=>{assert(value===null||typeof value!=='object','Whole object stringify defeats bounded traversal');if(typeof value==='string')assert(value.length<100,'Unbounded string fragment');return nativeStringify(value,...args);};
 assert.equal(await hashJson(large,{chunkSize:32,smallBytes:64}),hash);
 assert(jsonEqual(large,structuredClone(large),{chunkSize:32}));
}finally{JSON.stringify=nativeStringify;}
console.log('PASS bounded JSON integrity: native text/hash parity, existing SHA vectors, 500 randomized graphs, single toJSON calls, key order, special keys, shared/cyclic graphs, Unicode boundaries, unsupported values, and forced bounded traversal.');
