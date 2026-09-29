import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {jsonChunks,hashJson,jsonEqual} from '../docs/portfolio-operations-dashboard/features/bounded-json-integrity.mjs';

const text=(value,options={})=>[...jsonChunks(value,options)].join('');
const expectedHash=value=>createHash('sha256').update(JSON.stringify(value===undefined?null:value)).digest('hex');
const plain=Object.create(null);Object.defineProperty(plain,'__proto__',{value:{zero:0},enumerable:true});plain.constructor='retained';
const shared={id:0},cases=[null,undefined,-0,NaN,Infinity,plain,[shared,shared],new Date('2026-09-29T12:00:00Z'),new Uint8Array([0,1,255]),{omitted:undefined,value:0},[undefined,,NaN],{z:1,a:2}];
for(let i=0;i<100;i++)cases.push({id:i,rows:Array.from({length:i%19},(_,j)=>({j,value:(i-j)/7,text:'雪😀\ud800\udfff\n"\\'.repeat((i+j)%12),nested:{zero:0,missing:null}}))});
for(const value of cases)for(const chunkSize of [16,17,63,257,65536]){
 const chunks=[...jsonChunks(value,{chunkSize,trustedData:true})];
 assert.equal(chunks.join(''),JSON.stringify(value)??'');
 assert(chunks.every(chunk=>chunk.length<=chunkSize));
 assert.deepEqual(chunks,[...jsonChunks(value,{chunkSize})],'Fast/fallback tokenization must produce identical comparison chunks');
 assert.equal(await hashJson(value,{chunkSize,trustedData:true,smallBytes:128}),expectedHash(value));
 assert(jsonEqual(value,structuredClone(value),{chunkSize,trustedData:true}));
}

// The default must not run descriptor/prototype preflight on arbitrary objects.
let keyReads=0,valueReads=0,toJSONReads=0;
const proxy=new Proxy({value:'retained'},{
 getPrototypeOf(){throw Error('Generic serialization must not preflight a Proxy');},
 ownKeys(target){keyReads++;return Reflect.ownKeys(target);},
 get(target,key,receiver){if(key==='value')valueReads++;if(key==='toJSON')toJSONReads++;return Reflect.get(target,key,receiver);}
});
assert.equal(text(proxy),' {"value":"retained"}'.trim());
assert.equal(keyReads,1);assert.equal(valueReads,1);assert.equal(toJSONReads,1);

// Invalid opt-in candidates still fall back without preflight invoking accessors.
let getterCalls=0;
const accessor={nested:{get value(){getterCalls++;return 'once';}}};
assert.equal(text(accessor,{trustedData:true}),'{"nested":{"value":"once"}}');assert.equal(getterCalls,1);
let hookCalls=0;
const hooked={toJSON(){hookCalls++;return {answer:42,toJSON(){hookCalls++;return {wrong:true};}};}};
assert.equal(text(hooked,{trustedData:true}),'{"answer":42}');assert.equal(hookCalls,1,'Native fast path must not invoke a returned toJSON hook');
const priorObjectHook=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');
try{
 Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value(){hookCalls++;return this;}});
 hookCalls=0;assert.equal(text({nested:{zero:0}},{trustedData:true}),'{"nested":{"zero":0}}');assert.equal(hookCalls,2);
}finally{if(priorObjectHook)Object.defineProperty(Object.prototype,'toJSON',priorObjectHook);else delete Object.prototype.toJSON;}
const priorArrayHook=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON'),priorIndex=Object.getOwnPropertyDescriptor(Array.prototype,'20');
try{
 Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value(){hookCalls++;return this;}});
 hookCalls=0;assert.equal(text([[0]],{trustedData:true}),'[[0]]');assert.equal(hookCalls,2);
 delete Array.prototype.toJSON;
 Object.defineProperty(Array.prototype,'20',{configurable:true,get(){getterCalls++;return 'inherited';}});
 const sparse=new Array(21);getterCalls=0;
 const expected='['+Array(20).fill('null').join(',')+',"inherited"]';
 assert.equal(text(sparse,{trustedData:true}),expected);assert.equal(getterCalls,1,'Sparse array fallback reads inherited index only once');
}finally{if(priorArrayHook)Object.defineProperty(Array.prototype,'toJSON',priorArrayHook);else delete Array.prototype.toJSON;if(priorIndex)Object.defineProperty(Array.prototype,'20',priorIndex);else delete Array.prototype[20];}
const cycle={small:{}};cycle.small.parent=cycle;assert.throws(()=>text(cycle,{trustedData:true}),/circular/);
for(const value of [{bad:()=>0},[Symbol('bad')]])await assert.rejects(hashJson(value,{trustedData:true}),error=>error.code==='history_integrity');
await assert.rejects(hashJson({bad:1n},{trustedData:true}),TypeError);

// Native output and preflight work stay bounded, even when callers request huge
// chunks or the root has thousands of properties/array slots.
const wide=Object.fromEntries(Array.from({length:2000},(_,i)=>['k'+i,i]));
const rows=Array.from({length:2000},(_,i)=>({id:i,text:'x😀\n'.repeat(30)}));
const deep={};let tail=deep;for(let i=0;i<80;i++)tail=tail.next={};
const nativeStringify=JSON.stringify,nativeDescriptor=Object.getOwnPropertyDescriptor;
let wideDescriptors=0,arrayDescriptors=0,nativeObjects=0;
try{
 Object.getOwnPropertyDescriptor=(value,key)=>{if(value===wide)wideDescriptors++;if(value===rows)arrayDescriptors++;return nativeDescriptor(value,key);};
 JSON.stringify=(value,...rest)=>{
  const result=nativeStringify(value,...rest);
  if(value!==null&&typeof value==='object'){
   nativeObjects++;assert.notEqual(value,wide);assert.notEqual(value,rows);assert.notEqual(value,deep);
   assert(result.length<=65536,'Native JSON allocation exceeds fixed bound');
  }
  return result;
 };
 for(const value of [wide,rows,deep,{text:'\u0000'.repeat(20000)}])assert.equal(text(value,{trustedData:true,chunkSize:1000000}),nativeStringify(value));
 assert(wideDescriptors<=256,'Wide root descriptor preflight exceeds node budget');
 assert.equal(arrayDescriptors,0,'Large arrays must be rejected before index descriptor traversal');
 assert(nativeObjects>0,'Bounded persisted subtrees actually use native serialization');
}finally{JSON.stringify=nativeStringify;Object.getOwnPropertyDescriptor=nativeDescriptor;}

// One side can be eligible while the other requires fallback; equality remains
// exact JSON text, including key order and null versus zero.
assert(jsonEqual({a:1},{ignored:undefined,a:1},{trustedData:true,chunkSize:17}));
assert(!jsonEqual({a:1,b:2},{b:2,a:1},{trustedData:true}));
assert(!jsonEqual({a:0},{a:null},{trustedData:true}));
console.log('PASS trusted-data JSON acceleration: native text/hash/chunk parity, generic Proxy behavior, accessor/toJSON fallback, dense-array guards, fixed allocation/node/depth bounds, and exact comparison.');
