// Bounded serialization keeps the existing JSON.stringify byte order and SHA-256
// identity. It does not sort keys or introduce a new evidence format.
const OMIT=Symbol('omitted-json-value'),encoder=new TextEncoder();
const ownTag=Object.prototype.toString;
const unsupported=()=>Object.assign(new Error('Import evidence must contain serializable values.'),{code:'history_integrity'});
function unbox(value){
  // A custom toStringTag is never evaluated. Intrinsic probes identify boxed
  // primitives in that unusual case without invoking a user getter.
  if(Symbol.toStringTag in value){
    for(const [probe,convert] of [[Number.prototype.valueOf,v=>+v],[String.prototype.valueOf,v=>`${v}`],[Boolean.prototype.valueOf,v=>Boolean.prototype.valueOf.call(v)],[BigInt.prototype.valueOf,v=>BigInt.prototype.valueOf.call(v)]]){
      try{probe.call(value);}catch{continue;}
      return convert(value);
    }
    return value;
  }
  switch(ownTag.call(value)){
    case '[object Number]':return +value;
    case '[object String]':return `${value}`;
    case '[object Boolean]':return Boolean.prototype.valueOf.call(value);
    case '[object BigInt]':return BigInt.prototype.valueOf.call(value);
    default:return value;
  }
}
function prepare(holder,key,strict){
  let value=holder[key];
  if(value!==null&&['object','function','bigint'].includes(typeof value)){
    const toJSON=value.toJSON;
    if(typeof toJSON==='function')value=toJSON.call(value,key);
  }
  if(strict&&(typeof value==='function'||typeof value==='symbol'))throw unsupported();
  if(value!==null&&typeof value==='object')value=unbox(value);
  if(['undefined','function','symbol'].includes(typeof value))return OMIT;
  if(typeof value==='bigint')JSON.stringify(value); // Preserve native rejection.
  return value;
}
const pairAt=(text,end)=>end>0&&end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff&&text.charCodeAt(end)>=0xdc00&&text.charCodeAt(end)<=0xdfff;
function* stringTokens(value,chunkSize){
  yield '"';
  const size=Math.max(2,Math.floor(chunkSize/6));
  for(let offset=0;offset<value.length;){
    let end=Math.min(value.length,offset+size);
    if(pairAt(value,end))end--;
    yield JSON.stringify(value.slice(offset,end)).slice(1,-1);offset=end;
  }
  yield '"';
}
function* tokens(value,strict,chunkSize,ancestors){
  if(value===OMIT)return;
  if(typeof value==='string'){yield* stringTokens(value,chunkSize);return;}
  if(value===null||typeof value!=='object'){yield JSON.stringify(value);return;}
  if(ancestors.has(value))throw new TypeError('Converting circular structure to JSON');
  ancestors.add(value);
  try{
    if(Array.isArray(value)){
      yield '[';const length=value.length;
      for(let i=0;i<length;i++){
        if(i)yield ',';
        const child=prepare(value,String(i),strict);
        yield* tokens(child===OMIT?null:child,strict,chunkSize,ancestors);
      }
      yield ']';
    }else{
      yield '{';let first=true;
      for(const key of Object.keys(value)){
        const child=prepare(value,key,strict);if(child===OMIT)continue;
        if(!first)yield ',';first=false;
        yield* stringTokens(key,chunkSize);yield ':';
        yield* tokens(child,strict,chunkSize,ancestors);
      }
      yield '}';
    }
  }finally{ancestors.delete(value);}
}
export function* jsonChunks(value,{chunkSize=65536,rejectUnsupported=false}={}){
  if(!Number.isSafeInteger(chunkSize)||chunkSize<16)throw new RangeError('JSON chunkSize must be an integer of at least 16');
  let pending='';
  for(const token of tokens(prepare({'':value},'',rejectUnsupported),rejectUnsupported,chunkSize,new Set())){
    for(let offset=0;offset<token.length;){
      let end=Math.min(token.length,offset+chunkSize-pending.length);
      if(pairAt(token,end))end--;
      if(end===offset){yield pending;pending='';continue;}
      pending+=token.slice(offset,end);offset=end;
      if(pending.length===chunkSize){yield pending;pending='';}
    }
  }
  if(pending)yield pending;
}

// SHA-256 compression constants and rounds match financial-snapshot.mjs.
// Only the input buffering changes: 64-byte carry plus a bounded input chunk.
const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const rotate=(x,n)=>(x>>>n)|(x<<(32-n));
export class Sha256{
  constructor(){this.h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);this.w=new Uint32Array(64);this.carry=new Uint8Array(64);this.used=0;this.bytes=0n;this.finished=false;}
  block(bytes,offset){
    const w=this.w,h=this.h;
    for(let i=0;i<16;i++){const at=offset+i*4;w[i]=(bytes[at]<<24)|(bytes[at+1]<<16)|(bytes[at+2]<<8)|bytes[at+3];}
    for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+w[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0;}
    let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],t=h[7];
    for(let i=0;i<64;i++){const p=(t+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,q=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;t=g;g=f;f=e;e=(d+p)>>>0;d=c;c=b;b=a;a=(p+q)>>>0;}
    h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+t)>>>0;
  }
  update(bytes){
    if(this.finished)throw Error('SHA-256 is already finalized');
    if(!(bytes instanceof Uint8Array))throw new TypeError('SHA-256 requires UTF-8 bytes');
    this.bytes+=BigInt(bytes.byteLength);let offset=0;
    if(this.used){const take=Math.min(64-this.used,bytes.length);this.carry.set(bytes.subarray(0,take),this.used);this.used+=take;offset=take;if(this.used===64){this.block(this.carry,0);this.used=0;}}
    for(;offset+64<=bytes.length;offset+=64)this.block(bytes,offset);
    if(offset<bytes.length){this.carry.set(bytes.subarray(offset));this.used=bytes.length-offset;}
    return this;
  }
  digestHex(){
    if(this.finished)throw Error('SHA-256 is already finalized');this.finished=true;
    const tail=new Uint8Array(this.used<56?64:128);tail.set(this.carry.subarray(0,this.used));tail[this.used]=128;
    const view=new DataView(tail.buffer),bits=this.bytes*8n;view.setUint32(tail.length-8,Number((bits>>32n)&0xffffffffn));view.setUint32(tail.length-4,Number(bits&0xffffffffn));
    for(let offset=0;offset<tail.length;offset+=64)this.block(tail,offset);
    return [...this.h].map(n=>n.toString(16).padStart(8,'0')).join('');
  }
}
export async function hashJson(value,{chunkSize=65536,smallBytes=1048576}={}){
  if(!Number.isSafeInteger(smallBytes)||smallBytes<0)throw new RangeError('Invalid small JSON digest bound');
  let parts=[],length=0,stream=null;
  for(const text of jsonChunks(value===undefined?null:value,{chunkSize,rejectUnsupported:true})){
    const bytes=encoder.encode(text);
    if(!stream&&length+bytes.length<=smallBytes){parts.push(bytes);length+=bytes.length;continue;}
    if(!stream){stream=new Sha256();for(const part of parts)stream.update(part);parts=null;}
    stream.update(bytes);
  }
  if(stream)return stream.digestHex();
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function jsonEqual(left,right,{chunkSize=65536}={}){
  const a=jsonChunks(left,{chunkSize}),b=jsonChunks(right,{chunkSize});
  try{
    while(true){const aa=a.next(),bb=b.next();if(aa.done||bb.done)return aa.done===bb.done;if(aa.value!==bb.value)return false;}
  }finally{a.return();b.return();}
}
