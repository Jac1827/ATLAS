/* Lossless transport for the migration bundle and its retained import evidence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasMigrationArchive=api;})(typeof window!=='undefined'?window:globalThis,function(){
  const TYPE='atlas_migration_archive_v1';
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  async function encode(v){
    if(v instanceof Blob){const bytes=new Uint8Array(await v.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return {__atlasMigrationBlob:true,type:v.type,base64:btoa(s)};}
    if(Array.isArray(v))return Promise.all(v.map(encode));
    if(v&&typeof v==='object'){const o={};for(const [k,x]of Object.entries(v))o[k]=await encode(x);return o;}return v;
  }
  function decode(v){
    if(v?.__atlasMigrationBlob===true){const s=atob(v.base64);return new Blob([Uint8Array.from(s,c=>c.charCodeAt(0))],{type:v.type});}
    if(Array.isArray(v))return v.map(decode);
    if(v&&typeof v==='object'){const o={};for(const[k,x]of Object.entries(v))o[k]=decode(x);return o;}return v;
  }
  const SEGMENTED='segmented-json-v1',DEFAULT_SEGMENT_BYTES=1048576,DEFAULT_INLINE_LIMIT=16*1048576,BASE64_READ_BYTES=262144,BLOB_FRAGMENT=Symbol('migrationBlobFragment');
  const utf8=new TextEncoder();
  const inlineLimit=value=>{if(!Number.isSafeInteger(value)||value<0||value>DEFAULT_INLINE_LIMIT)throw Error('Invalid inline archive limit');return value;};
  const checkArchiveOperation=({signal,isCurrent=()=>true}={})=>{if(signal?.aborted||!isCurrent())throw signal?.reason||new DOMException('Workspace changed during archive transport','AbortError');};
  function archiveTransport(archive){
    if(archive?.bundleType!==TYPE||archive.encoding!=='zip+base64'||!Number.isSafeInteger(archive.bytes)||archive.bytes<0||!Number.isSafeInteger(archive.recordCount)||archive.recordCount<0)throw Error('Invalid migration archive transport');
    if(!/^[a-f0-9]{64}$/.test(archive.sha256||''))throw Error('Migration archive fingerprint mismatch');
    const text=typeof archive.data==='string',blob=archive.dataBlob instanceof Blob;
    if(text===blob||archive.data!=null&&!text||archive.dataBlob!=null&&!blob)throw Error('Invalid migration archive data transport');
    const length=text?archive.data.length:archive.dataBlob.size;
    if(length!==Math.ceil(archive.bytes/3)*4)throw Error('Migration archive fingerprint mismatch (encoded length)');
    return {length,read:async(start,end)=>text?archive.data.slice(start,end):archive.dataBlob.slice(start,end).text(),part:(start,end)=>text?archive.data.slice(start,end):archive.dataBlob.slice(start,end)};
  }
  function base64Bytes(text,final){
    if(text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text)||!final&&text.includes('='))throw Error('Invalid migration archive base64 data');
    const raw=atob(text),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;
  }
  async function* archiveTextChunks(transport,options={},size=BASE64_READ_BYTES){
    for(let offset=0;offset<transport.length;offset+=size){
      checkArchiveOperation(options);const end=Math.min(transport.length,offset+size),text=await transport.read(offset,end);checkArchiveOperation(options);
      if(text.length!==end-offset)throw Error('Invalid migration archive base64 text');
      yield {text,bytes:base64Bytes(text,end===transport.length),offset,end};
    }
  }
  async function decodeArchiveTransport(archive,options={}){
    const transport=archiveTransport(archive),bytes=new Uint8Array(archive.bytes);let offset=0;
    for await(const part of archiveTextChunks(transport,options)){if(offset+part.bytes.length>bytes.length)throw Error('Migration archive decoded length mismatch');bytes.set(part.bytes,offset);offset+=part.bytes.length;}
    if(offset!==bytes.length)throw Error('Migration archive decoded length mismatch');checkArchiveOperation(options);return bytes;
  }
  // Preserve the portable JSON format without creating one archive-sized string.
  async function toJsonBlob(archive,options={}){
    checkArchiveOperation(options);const transport=archiveTransport(archive);let decoded=0;
    for await(const part of archiveTextChunks(transport,options))decoded+=part.bytes.length;
    if(decoded!==archive.bytes)throw Error('Migration archive decoded length mismatch');
    const {data,dataBlob,bytesData,dataDocuments,...metadata}=archive;
    const header=JSON.stringify(metadata);checkArchiveOperation(options);
    return new Blob([header.slice(0,-1),',"data":"',transport.part(0,transport.length),'"}'],{type:'application/json'});
  }
  const supportedLayout=entry=>{if(entry.layout!==undefined&&entry.layout!==SEGMENTED)throw Error('Unsupported migration record layout');};
  // Conservative sizing stops before allocating a whole oversized JSON string.
  // Small ordinary records retain the exact original v1 encoding and hashes.
  function legacyFits(value,limit){
    let remaining=limit;const ancestors=new Set();
    const visit=v=>{
      if(remaining<0)return false;
      if(v instanceof Date)return false;
      if(v instanceof Blob){remaining-=Math.ceil(v.size/3)*4+String(v.type).length*6+96;return remaining>=0;}
      if(typeof v==='bigint')throw Error('BigInt is unsupported in migration JSON');
      if(v===null||typeof v!=='object'){remaining-=typeof v==='string'?v.length*6+2:32;return remaining>=0;}
      if(ancestors.has(v))throw Error('Cyclic migration records are unsupported');
      ancestors.add(v);remaining-=2;
      if(Array.isArray(v)){for(let i=0;i<v.length;i++){remaining--;if(!visit(v[i])){ancestors.delete(v);return false;}}}
      else for(const [key,item]of Object.entries(v)){if(key==='__proto__'){ancestors.delete(v);return false;}remaining-=key.length*6+4;if(!visit(item)){ancestors.delete(v);return false;}}
      ancestors.delete(v);return remaining>=0;
    };
    return visit(value);
  }
  // Tokens never contain an entire object/array, or an unbounded text/blob.
  // Their order is the source property/array order, including null versus zero.
  function* recordTokens(value,limit=DEFAULT_SEGMENT_BYTES,ancestors=new Set()){
    const chunkChars=Math.max(1,Math.floor((limit-128)/12));
    if(value instanceof Blob){
      yield ['blob'];yield* recordTokens(value.type,limit,ancestors);
      const size=Math.max(1,Math.floor((limit-128)*3/8));
      for(let offset=0;offset<value.size;offset+=size)yield {[BLOB_FRAGMENT]:value.slice(offset,offset+size)};
      yield ['endBlob'];return;
    }
    if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw Error('Invalid date in migration record');yield ['date',value.toISOString()];return;}
    if(typeof value==='string'){yield ['string'];for(let i=0;i<value.length;i+=chunkChars)yield ['text',value.slice(i,i+chunkChars)];yield ['endString'];return;}
    if(value===null||typeof value!=='object'){
      if(typeof value==='bigint')throw Error('BigInt is unsupported in migration JSON');
      yield ['value',typeof value==='number'&&!Number.isFinite(value)||value===undefined||typeof value==='function'||typeof value==='symbol'?null:value];return;
    }
    if(ancestors.has(value))throw Error('Cyclic migration records are unsupported');ancestors.add(value);
    if(Array.isArray(value)){yield ['array'];for(let i=0;i<value.length;i++)yield* recordTokens(value[i],limit,ancestors);}
    else{yield ['object'];for(const [key,item]of Object.entries(value)){if(item===undefined||typeof item==='function'||typeof item==='symbol')continue;yield ['key'];yield* recordTokens(key,limit,ancestors);yield* recordTokens(item,limit,ancestors);}}
    yield ['end'];ancestors.delete(value);
  }
  async function* recordSegments(value,limit){
    let tokens=[],size=2;
    // Synchronous traversal avoids a Promise for every primitive/history field.
    // Only Blob chunks and completed segment I/O cross an async boundary.
    for(let token of recordTokens(value,limit)){
      if(token[BLOB_FRAGMENT]){const bytes=new Uint8Array(await token[BLOB_FRAGMENT].arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));token=['bytes',btoa(text)];}
      const text=JSON.stringify(token),bytes=utf8.encode(text).length;
      if(bytes+2>limit)throw Error('Migration token exceeds the segment limit');
      if(tokens.length&&size+bytes+1>limit){yield utf8.encode('['+tokens.join(',')+']');tokens=[];size=2;}
      tokens.push(text);size+=bytes+(tokens.length>1?1:0);
    }
    if(tokens.length)yield utf8.encode('['+tokens.join(',')+']');
  }
  const segmentName=(name,index)=>name+'.segment-'+String(index).padStart(8,'0');
  const entryFingerprint=entry=>digest(utf8.encode(JSON.stringify({layout:entry.layout,name:entry.name,segmentBytes:entry.segmentBytes,segments:entry.segments})));
  function segmentLimit(value){if(!Number.isSafeInteger(value)||value<512||value>DEFAULT_SEGMENT_BYTES)throw Error('Invalid migration segment limit');return value;}
  const joinBytes=(parts,total)=>{const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;};
  async function boundedTransform(bytes,kind,limit){
    const Transform=kind==='compress'?globalThis.CompressionStream:globalThis.DecompressionStream;
    if(typeof Transform!=='function')throw Error('This browser does not support bounded migration compression.');
    // The caller owns this bounded byte array until transformation completes.
    // Enqueue it directly: copying every segment into a Blob lets native input
    // buffers accumulate outside the JavaScript heap during large exports.
    const input=new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
    const reader=input.pipeThrough(new Transform('deflate')).getReader(),parts=[];let total=0;
    try{while(true){const next=await reader.read();if(next.done)break;total+=next.value.length;if(total>limit){await reader.cancel().catch(()=>{});throw Error('Migration segment exceeds its verified byte limit');}parts.push(next.value);}return joinBytes(parts,total);}
    finally{reader.releaseLock();}
  }
  // JSZip's documented StreamHelper API permits a byte limit before retaining
  // the complete ZIP member. No private JSZip fields or compression internals.
  function boundedZipMember(file,limit){
    return new Promise((resolve,reject)=>{
      const parts=[];let total=0,failed=false;const stream=file.internalStream('uint8array');
      stream.on('data',bytes=>{if(failed)return;total+=bytes.length;if(total>limit){failed=true;parts.length=0;stream.pause();reject(Error('Migration stored segment exceeds its verified byte limit'));return;}parts.push(bytes);});
      stream.on('error',error=>{if(!failed){failed=true;parts.length=0;reject(error);}});
      stream.on('end',()=>{if(!failed)resolve(joinBytes(parts,total));});stream.resume();
    });
  }
  async function addRecord(zip,manifest,name,value,limit,forceSegmented=false){
    if(!forceSegmented&&legacyFits(value,limit)){
      const text=JSON.stringify(await encode(value));if(text===undefined)throw Error('Undefined migration record');const bytes=utf8.encode(text);
      if(bytes.length>limit)throw Error('Migration record exceeded its verified size');
      manifest.entries.push({name,sha256:await digest(bytes),bytes:bytes.length});await zip.file(name,bytes);return;
    }
    // Deliberately omit the logical name: v1-only readers must fail before
    // applying any record, rather than misinterpreting a descriptor as data.
    const entry={name,layout:SEGMENTED,segmentBytes:limit,segments:[],bytes:0};
    for await(const bytes of recordSegments(value,limit)){
      const stored=await boundedTransform(bytes,'compress',limit+65536);
      const part={name:segmentName(name,entry.segments.length),encoding:'deflate',bytes:bytes.length,sha256:await digest(bytes),storedBytes:stored.length,storedSha256:await digest(stored)};
      await zip.file(part.name,stored,{compression:'STORE'});entry.segments.push(part);entry.bytes+=bytes.length;
    }
    entry.sha256=await entryFingerprint(entry);manifest.entries.push(entry);
  }
  // Prepare in the history worker so expanded rollback objects never need to
  // cross a structured-clone boundary. Only bounded compressed members leave it.
  async function packRecord(name,value,{segmentBytes=DEFAULT_SEGMENT_BYTES,onProgress}={}){
    const files=[],manifest={entries:[]};
    await addRecord({file(name,bytes,options){files.push({name,bytes,compression:options?.compression});onProgress?.(files.length);}},manifest,name,value,segmentLimit(segmentBytes));
    return {entry:manifest.entries[0],files};
  }
  // History readers yield bounded batches so multi-gigabyte histories do not
  // allocate a Promise for every scalar. The grammar validator keeps no values.
  async function packTokenRecord(name,batches,{segmentBytes=DEFAULT_SEGMENT_BYTES,onProgress}={}){
    const limit=segmentLimit(segmentBytes),files=[],entry={name,layout:SEGMENTED,segmentBytes:limit,segments:[],bytes:0};
    const reader=selectedTokenReader(()=>false);let tokens=[],size=2;
    const flush=async()=>{
      if(!tokens.length)return;
      const bytes=utf8.encode('['+tokens.join(',')+']');tokens=[];size=2;
      const stored=await boundedTransform(bytes,'compress',limit+65536);
      const part={name:segmentName(name,entry.segments.length),encoding:'deflate',bytes:bytes.length,sha256:await digest(bytes),storedBytes:stored.length,storedSha256:await digest(stored)};
      files.push({name:part.name,bytes:stored,compression:'STORE'});entry.segments.push(part);entry.bytes+=bytes.length;
      onProgress?.({phase:'Packing retained history',completed:files.length});
    };
    for await(const batch of batches){
      if(!batch||typeof batch[Symbol.iterator]!=='function')throw Error('Invalid migration token batch');
      for(let token of batch){
        if(token?.[BLOB_FRAGMENT]){const bytes=new Uint8Array(await token[BLOB_FRAGMENT].arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));token=['bytes',btoa(text)];}
        const pieces=[];
        if(Array.isArray(token)&&['text','bytes'].includes(token[0])&&typeof token[1]==='string'){
          const max=Math.max(4,Math.floor((limit-128)/12/4)*4);
          if(!token[1].length)pieces.push(token);
          else for(let offset=0;offset<token[1].length;offset+=max)pieces.push([token[0],token[1].slice(offset,offset+max)]);
        }else pieces.push(token);
        for(const piece of pieces){
          reader.accept(piece);const text=JSON.stringify(piece),bytes=utf8.encode(text).length;
          if(bytes+2>limit)throw Error('Migration token exceeds the segment limit');
          if(tokens.length&&size+bytes+1>limit)await flush();
          tokens.push(text);size+=bytes+(tokens.length>1?1:0);
        }
      }
    }
    reader.finish();await flush();entry.sha256=await entryFingerprint(entry);
    return {entry,files};
  }
  async function addPackedRecord(zip,manifest,name,packed){
    const entry=packed?.entry,files=packed?.files;
    if(!entry||entry.name!==name||!Array.isArray(files))throw Error('Invalid prepared migration record');
    supportedLayout(entry);
    const expected=entry.layout===SEGMENTED?entry.segments:[entry];
    if(!Array.isArray(expected)||files.length!==expected.length||!files.length)throw Error('Incomplete prepared migration record');
    if(entry.layout===SEGMENTED){
      segmentLimit(entry.segmentBytes);
      if(await entryFingerprint(entry)!==entry.sha256)throw Error('Prepared migration record fingerprint mismatch');
    }
    let total=0;
    for(let i=0;i<files.length;i++){
      const file=files[i],part=expected[i],segmented=entry.layout===SEGMENTED;
      const wantedName=segmented?segmentName(name,i):name;
      if(file.name!==wantedName||part.name!==wantedName||!(file.bytes instanceof Uint8Array)
        ||file.bytes.length!==(segmented?part.storedBytes:part.bytes)
        ||await digest(file.bytes)!==(segmented?part.storedSha256:part.sha256)
        ||segmented&&(part.encoding!=='deflate'||part.bytes>entry.segmentBytes||part.storedBytes>entry.segmentBytes+65536))throw Error('Prepared migration segment changed');
      total+=part.bytes;
      zip.file(file.name,file.bytes,segmented?{compression:'STORE'}:undefined);
    }
    if(total!==entry.bytes)throw Error('Prepared migration record length mismatch');
    manifest.entries.push(entry);
  }
  function tokenReader(){
    const stack=[];let result,complete=false;
    const attach=value=>{
      if(!stack.length){if(complete)throw Error('Multiple migration record roots');result=value;complete=true;return;}
      const top=stack.at(-1);
      if(top.type==='array')top.value.push(value);
      else if(top.type==='object'){
        if(top.expectKey){if(typeof value!=='string')throw Error('Invalid migration object key');top.key=value;top.expectKey=false;top.hasKey=true;}
        else{if(!top.hasKey||Object.hasOwn(top.value,top.key))throw Error('Missing or duplicate migration object key');Object.defineProperty(top.value,top.key,{value,writable:true,enumerable:true,configurable:true});top.hasKey=false;top.key=null;}
      }else if(top.type==='blob'&&top.mime===undefined){if(typeof value!=='string')throw Error('Invalid migration blob type');top.mime=value;}
      else throw Error('Unexpected migration record value');
    };
    return {
      accept(token){
        if(!Array.isArray(token)||typeof token[0]!=='string')throw Error('Invalid migration record token');
        const [type,value]=token,top=stack.at(-1),arity=['value','text','bytes','date'].includes(type)?2:1;
        if(token.length!==arity)throw Error('Invalid migration token arity');
        if(type==='object'||type==='array'){const value=type==='array'?[]:{};attach(value);stack.push({type,value});}
        else if(type==='key'){if(top?.type!=='object'||top.hasKey||top.expectKey)throw Error('Unexpected migration object key');top.expectKey=true;}
        else if(type==='end'){if(!top||!['object','array'].includes(top.type)||top.hasKey||top.expectKey)throw Error('Incomplete migration container');stack.pop();}
        else if(type==='value'){if(value!==null&&!['boolean','number'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw Error('Invalid migration primitive');attach(value);}
        else if(type==='date'){if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw Error('Invalid migration date');attach(new Date(value));}
        else if(type==='string')stack.push({type:'string',parts:[]});
        else if(type==='text'){if(top?.type!=='string'||typeof value!=='string')throw Error('Unexpected migration string fragment');top.parts.push(value);}
        else if(type==='endString'){if(top?.type!=='string')throw Error('Incomplete migration string');stack.pop();attach(top.parts.join(''));}
        else if(type==='blob')stack.push({type:'blob',parts:[]});
        else if(type==='bytes'){if(top?.type!=='blob'||typeof top.mime!=='string'||typeof value!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('Invalid migration blob fragment');const raw=atob(value);top.parts.push(Uint8Array.from(raw,c=>c.charCodeAt(0)));}
        else if(type==='endBlob'){if(top?.type!=='blob'||typeof top.mime!=='string')throw Error('Incomplete migration blob');stack.pop();attach(new Blob(top.parts,{type:top.mime}));}
        else throw Error('Unsupported migration token');
      },
      finish(){if(stack.length||!complete)throw Error('Incomplete migration record');return result;}
    };
  }
  async function visitSegmentTokens(zip,entry,accept,readBytes,onBatch,onProgress){
    segmentLimit(entry.segmentBytes);
    if(zip.file(entry.name)||!Array.isArray(entry.segments)||!entry.segments.length||await entryFingerprint(entry)!==entry.sha256)throw Error('Migration segment manifest fingerprint mismatch');
    let total=0;
    for(let i=0;i<entry.segments.length;i++){
      const part=entry.segments[i];if(part.name!==segmentName(entry.name,i)||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>entry.segmentBytes)throw Error('Invalid migration segment manifest');
      if(part.encoding!=='deflate'||!Number.isSafeInteger(part.storedBytes)||part.storedBytes<1||part.storedBytes>entry.segmentBytes+65536)throw Error('Unsupported migration segment encoding or size');
      const file=zip.file(part.name);if(!file)throw Error('Migration segment is missing');
      const stored=readBytes?await readBytes(part.name,part.storedBytes):await boundedZipMember(file,part.storedBytes);if(stored.length!==part.storedBytes||await digest(stored)!==part.storedSha256)throw Error('Migration stored segment fingerprint mismatch');
      const bytes=await boundedTransform(stored,'decompress',part.bytes);if(bytes.length!==part.bytes||await digest(bytes)!==part.sha256)throw Error('Migration segment fingerprint mismatch');
      const tokens=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!Array.isArray(tokens))throw Error('Invalid migration segment tokens');if(onBatch)await onBatch(tokens);else for(const token of tokens)accept(token);total+=bytes.length;onProgress?.({phase:'verifying_bundle',completed:i+1,total:entry.segments.length});
    }
    if(total!==entry.bytes)throw Error('Migration record byte count mismatch');
  }
  async function readRecord(zip,entry,readBytes){
    supportedLayout(entry);
    if(entry.layout===undefined){const file=zip.file(entry.name);if(!file)throw Error('Migration record is missing');const bytes=readBytes?await readBytes(entry.name,entry.bytes):await file.async('uint8array');if(bytes.length!==entry.bytes||await digest(bytes)!==entry.sha256)throw Error('Migration record fingerprint mismatch');return decode(JSON.parse(new TextDecoder().decode(bytes)));}
    const reader=tokenReader();await visitSegmentTokens(zip,entry,token=>reader.accept(token),readBytes);return reader.finish();
  }
  // Projection readers visit every token, including omitted subtrees, without
  // constructing those subtrees. Grammar and segment integrity stay mandatory.
  // A false selection prunes that subtree; container counts remain available at
  // its boundary. Paths below a pruned container are deliberately not allocated.
  function selectedTokenReader(select,onContainer,onScalar){
    const stack=[];let result,complete=false;
    const location=()=>{
      const top=stack.at(-1);
      if(!top){if(complete)throw Error('Multiple migration record roots');return {path:[]};}
      if(top.type==='array')return {path:top.keep?top.path.concat(top.count):null};
      if(top.type==='object'){
        if(top.expectKey)return {path:null,isKey:true};
        if(!top.hasKey)throw Error('Missing migration object key');
        return {path:top.keep?top.path.concat(top.key):null};
      }
      if(top.type==='blob'&&top.mime===undefined)return {path:null,isMime:true};
      throw Error('Unexpected migration record value');
    };
    const attach=(frame,value)=>{
      const top=stack.at(-1);
      if(frame.isKey){
        if(top?.type!=='object'||typeof value!=='string'||top.keys.has(value))throw Error('Missing or duplicate migration object key');
        top.keys.add(value);top.key=value;top.hasKey=true;top.expectKey=false;return;
      }
      if(frame.isMime){if(top?.type!=='blob'||typeof value!=='string')throw Error('Invalid migration blob type');top.mime=value;return;}
      if(!top){if(complete)throw Error('Multiple migration record roots');result=value;complete=true;}
      else if(top.type==='array'){if(frame.keep)top.value.push(value);top.count++;}
      else if(top.type==='object'){
        if(!top.hasKey||top.expectKey)throw Error('Missing migration object key');
        if(frame.keep)Object.defineProperty(top.value,top.key,{value,writable:true,enumerable:true,configurable:true});
        top.hasKey=false;top.key=null;top.count++;
      }else throw Error('Unexpected migration record value');
      if(frame.path!==null&&['object','array'].includes(frame.type))onContainer?.(frame.path,frame.type,frame.count);
      else if(frame.path!==null&&frame.keep&&frame.type!=='blob')onScalar?.(frame.path,frame.type,value);
    };
    return {
      accept(token){
        if(!Array.isArray(token)||typeof token[0]!=='string')throw Error('Invalid migration record token');
        const [type,value]=token,top=stack.at(-1),arity=['value','text','bytes','date'].includes(type)?2:1;
        if(token.length!==arity)throw Error('Invalid migration token arity');
        let frame;
        if(['object','array','string','blob','value','date'].includes(type)){
          const where=location();
          if((where.isKey||where.isMime)&&type!=='string')throw Error('Invalid migration object key or blob type');
          frame={...where,type,keep:!!(where.isKey||where.isMime||where.path!==null&&select(where.path,type)),count:0};
        }
        if(type==='object'||type==='array')stack.push({...frame,value:frame.keep?(type==='array'?[]:{}):undefined,keys:type==='object'?new Set():null,key:null,hasKey:false,expectKey:false});
        else if(type==='key'){if(top?.type!=='object'||top.hasKey||top.expectKey)throw Error('Unexpected migration object key');top.expectKey=true;}
        else if(type==='end'){if(!top||!['object','array'].includes(top.type)||top.hasKey||top.expectKey)throw Error('Incomplete migration container');stack.pop();attach(top,top.value);}
        else if(type==='value'){if(value!==null&&!['boolean','number'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw Error('Invalid migration primitive');attach(frame,frame.keep?value:undefined);}
        else if(type==='date'){if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw Error('Invalid migration date');attach(frame,frame.keep?new Date(value):undefined);}
        else if(type==='string')stack.push({...frame,parts:frame.keep?[]:null});
        else if(type==='text'){if(top?.type!=='string'||typeof value!=='string')throw Error('Unexpected migration string fragment');if(top.keep)top.parts.push(value);}
        else if(type==='endString'){if(top?.type!=='string')throw Error('Incomplete migration string');stack.pop();attach(top,top.keep?top.parts.join(''):undefined);}
        else if(type==='blob')stack.push({...frame,parts:frame.keep?[]:null});
        else if(type==='bytes'){
          if(top?.type!=='blob'||typeof top.mime!=='string'||typeof value!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('Invalid migration blob fragment');
          if(top.keep){const raw=atob(value);top.parts.push(Uint8Array.from(raw,c=>c.charCodeAt(0)));}
        }
        else if(type==='endBlob'){if(top?.type!=='blob'||typeof top.mime!=='string')throw Error('Incomplete migration blob');stack.pop();attach(top,top.keep?new Blob(top.parts,{type:top.mime}):undefined);}
        else throw Error('Unsupported migration token');
      },
      finish(){if(stack.length||!complete)throw Error('Incomplete migration record');return result;}
    };
  }
  function selectLegacyRecord(value,select,onContainer,onScalar,path=[]){
    const type=value?.__atlasMigrationBlob===true?'blob':Array.isArray(value)?'array':value&&typeof value==='object'?'object':typeof value==='string'?'string':'value';
    const keep=select(path,type);
    if(['object','array'].includes(type))onContainer?.(path,type,type==='array'?value.length:Object.keys(value).length);
    if(!keep)return undefined;
    if(type==='blob')return decode(value);
    if(type==='array'){
      let target=0;for(let index=0;index<value.length;index++){const item=selectLegacyRecord(value[index],select,onContainer,onScalar,path.concat(index));if(item!==undefined)value[target++]=item;}
      value.length=target;return value;
    }
    if(type==='object')for(const key of Object.keys(value)){
      const item=selectLegacyRecord(value[key],select,onContainer,onScalar,path.concat(key));
      if(item===undefined)delete value[key];else Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});
    }
    if(!['object','array','blob'].includes(type))onScalar?.(path,type,value);
    return value;
  }
  function validateLegacyBlobs(value){
    // JSON syntax is already validated. Match the complete legacy decoder's
    // Blob validation even when a projection omits the containing subtree.
    if(value?.__atlasMigrationBlob===true){atob(value.base64);return;}
    if(Array.isArray(value)){for(const item of value)validateLegacyBlobs(item);}
    else if(value&&typeof value==='object')for(const item of Object.values(value))validateLegacyBlobs(item);
  }
  async function verifyRecord(value,entry){
    supportedLayout(entry);
    if(entry.layout===undefined){const bytes=utf8.encode(JSON.stringify(await encode(value)));if(bytes.length!==entry.bytes||await digest(bytes)!==entry.sha256)throw Error('Rollback storage readback differs from its source');return;}
    segmentLimit(entry.segmentBytes);let count=0,total=0;
    for await(const bytes of recordSegments(value,entry.segmentBytes)){
      const expected=entry.segments[count++];if(!expected||bytes.length!==expected.bytes||await digest(bytes)!==expected.sha256)throw Error('Rollback segment readback differs from its source');total+=bytes.length;
    }
    if(count!==entry.segments.length||total!==entry.bytes||await entryFingerprint(entry)!==entry.sha256)throw Error('Rollback segmented record differs from its source');
  }
  async function packRecords(bundle,source,Zip,{segmentBytes=DEFAULT_SEGMENT_BYTES,onProgress,inlineLimit:requestedInlineLimit=DEFAULT_INLINE_LIMIT}={}){
    let phase='initialization';
    try{
    if(!source||!Number.isSafeInteger(source.count)||source.count<0||typeof source.readRecord!=='function')throw Error('Invalid migration record source');
    let zip=new Zip();const manifest={format:TYPE,entries:[]};
    const limit=segmentLimit(segmentBytes),maxInline=inlineLimit(requestedInlineLimit);
    const add=async(name,value)=>{phase='record '+name;return addRecord(zip,manifest,name,value,limit);};
    onProgress?.({phase:'packing',completed:0,total:source.count+1});
    await add('bundle.json',bundle);onProgress?.({phase:'packing',completed:1,total:source.count+1});
    const addNext=async i=>{
      phase='source record '+i;
      const name=`record-${i}.json`,packed=await source.readPackedRecord?.(i,name);
      if(packed){await addPackedRecord(zip,manifest,name,packed);return;}
      let value=await source.readRecord(i);
      try{await add(name,value);}finally{value=null;}
    };
    for(let i=0;i<source.count;i++){await addNext(i);onProgress?.({phase:'packing',completed:i+2,total:source.count+1});}
    phase='manifest';zip.file('manifest.json',JSON.stringify(manifest));
    phase='archive compression';onProgress?.({phase:'Compressing archive'});const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
    // The archive owns these bytes now. Release the ZIP's retained member
    // buffers before encoding, and avoid a second archive-sized binary string.
    zip=null;phase='archive encoding';onProgress?.({phase:'Encoding archive'});
    const encoded=[];for(let i=0;i<bytes.length;i+=32766)encoded.push(btoa(String.fromCharCode(...bytes.subarray(i,i+32766))));
    const transport=Math.ceil(bytes.length/3)*4<=maxInline?{data:encoded.join('')}:{dataBlob:new Blob(encoded,{type:'text/plain'})};
    return {bundleType:TYPE,encoding:'zip+base64',sha256:await digest(bytes),bytes:bytes.length,recordCount:source.count,...transport};
    }catch(error){throw new Error('Migration archive pack failed ('+phase+'): '+error.message,{cause:error});}
  }
  async function pack(bundle,records,Zip,options){
    return packRecords(bundle,{count:records.length,readRecord:i=>records[i]},Zip,options);
  }
  async function openArchive(archive,Zip,options={}){
    let phase='archive fingerprint';
    try{
      checkArchiveOperation(options);
      // Decode bounded base64 slices into the ZIP bytes, without an archive-sized
      // text or binary string. Worker-provided bytes keep the same hash checks.
      let bytes=archive.bytesData;
      if(!(bytes instanceof Uint8Array))bytes=await decodeArchiveTransport(archive,options);
      checkArchiveOperation(options);
      if(bytes.length!==archive.bytes||await digest(bytes)!==archive.sha256)throw Error('Migration archive fingerprint mismatch');
      checkArchiveOperation(options);
      phase='manifest';const zip=await Zip.loadAsync(bytes),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
      checkArchiveOperation(options);
      if(manifest.format!==TYPE||!Array.isArray(manifest.entries)||!Number.isSafeInteger(archive.recordCount)||archive.recordCount<0||manifest.entries.length!==archive.recordCount+1)throw Error('Migration manifest is incomplete');
      for(let i=0;i<manifest.entries.length;i++)if(manifest.entries[i].name!==(i===0?'bundle.json':`record-${i-1}.json`))throw Error('Migration record order or name is invalid');
      return {zip,manifest};
    }catch(error){throw new Error('Migration archive unpack failed ('+phase+'): '+error.message,{cause:error});}
  }
  async function readArchiveRecord(zip,entry){
    try{return await readRecord(zip,entry);}catch(error){throw new Error('Migration archive unpack failed (record '+entry.name+'): '+error.message,{cause:error});}
  }
  async function unpack(archive,Zip){
    if(archive?.bundleType!==TYPE)return {bundle:archive,records:[]};
    const {zip,manifest}=await openArchive(archive,Zip),values=[];
    for(const entry of manifest.entries)values.push(await readArchiveRecord(zip,entry));
    return {bundle:values[0],records:values.slice(1),manifest};
  }
  // Additive read-only API: each verified reduced record is consumed before the
  // next one. Existing unpack/restore callers keep their complete-record API.
  async function visitSelectedRecords(archive,Zip,{select,onContainer,onScalar,onRecord,onProgress}={}){
    if(archive?.bundleType!==TYPE||typeof select!=='function'||typeof onRecord!=='function')throw Error('Invalid migration projection reader');
    const {zip,manifest}=await openArchive(archive,Zip);
    for(const entry of manifest.entries){
      supportedLayout(entry);
      const selected=(path,type)=>select(entry.name,path,type),container=(path,type,count)=>onContainer?.(entry.name,path,type,count),scalar=(path,type,value)=>onScalar?.(entry.name,path,type,value);
      let value;
      if(entry.layout===undefined){
        const file=zip.file(entry.name);if(!file)throw Error('Migration record is missing');
        const bytes=await file.async('uint8array');
        if(bytes.length!==entry.bytes||await digest(bytes)!==entry.sha256)throw Error('Migration record fingerprint mismatch');
        const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));validateLegacyBlobs(parsed);
        value=selectLegacyRecord(parsed,selected,container,scalar);
      }else{
        const reader=selectedTokenReader(selected,container,scalar);await visitSegmentTokens(zip,entry,token=>reader.accept(token),undefined,undefined,onProgress);value=reader.finish();
      }
      await onRecord(entry.name,value);value=null;
    }
    return {manifest,recordsVerified:manifest.entries.length};
  }
  async function verifyBundle(archive,Zip,{onProgress,isCurrent=()=>true}={}){
    if(archive?.bundleType!==TYPE)throw Error('Unsupported migration archive for bundle verification');
    let bundle;
    // Validate every retained member's bytes and token grammar without
    // rebuilding the complete import history just to discard it afterward.
    const verified=await visitSelectedRecords(archive,Zip,{
      select:name=>name==='bundle.json',
      onProgress:event=>{if(!isCurrent())throw new DOMException('Workspace changed during archive verification','AbortError');onProgress?.(event);},
      onRecord(name,value){if(name==='bundle.json')bundle=value;}
    });
    return {bundle,...verified};
  }
  async function verifyRestore(archive,Zip,{signal,isCurrent=()=>true,onProgress}={}){
    const check=()=>{if(signal?.aborted||!isCurrent())throw new DOMException('Workspace changed during rollback verification','AbortError');};
    check();
    if(archive?.bundleType!==TYPE)throw Error('Unsupported migration archive for rollback verification');
    const {zip,manifest}=await openArchive(archive,Zip),name='atlas_migration_rollback_test_'+crypto.randomUUID();
    check();
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const total=manifest.entries.reduce((sum,entry)=>sum+(entry.layout===SEGMENTED?entry.segments?.length||0:1),0);let completed=0;
    const progress=()=>{check();onProgress?.({phase:'Verifying rollback storage',completed,total});};
    const write=(key,item)=>new Promise((resolve,reject)=>{check();const tx=db.transaction('records','readwrite');try{tx.objectStore('records').put(item,key);}catch(error){tx.abort();reject(error);return;}tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});
    const read=key=>new Promise((resolve,reject)=>{check();const r=db.transaction('records').objectStore('records').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try {
      progress();
      for(let i=0;i<manifest.entries.length;i++){
        check();const entry=manifest.entries[i];supportedLayout(entry);
        try{
          if(entry.layout===SEGMENTED){
            // Restore the exact bounded transport members. Comparing every
            // native readback to its original fingerprint and validating every
            // token proves the logical record without constructing its value.
            const header={name:entry.name,sha256:entry.sha256,layout:entry.layout,bytes:entry.bytes,segmentBytes:entry.segmentBytes,segments:entry.segments.length};
            await write(i,header);const storedHeader=await read(i);check();
            if(JSON.stringify(storedHeader)!==JSON.stringify(header))throw Error('Rollback record descriptor differs');
            const grammar=selectedTokenReader(()=>false);
            await visitSegmentTokens(zip,entry,token=>grammar.accept(token),async(member,limit)=>{
              check();const file=zip.file(member);if(!file)throw Error('Migration segment is missing');
              let bytes=await boundedZipMember(file,limit);check();await write(member,bytes);bytes=null;
              const readback=await read(member);check();
              if(!(readback instanceof Uint8Array)||readback.length>limit)throw Error('Rollback stored member is missing or exceeds its byte limit');
              completed++;progress();return readback;
            });
            grammar.finish();
          }else{
            let value=await readArchiveRecord(zip,entry);check();
            await write(i,value);value=null;const readback=await read(i);check();
            await verifyRecord(readback,entry);completed++;progress();
          }
        }catch(error){throw new Error('Migration rollback readback failed (record '+i+'): '+error.message,{cause:error});}
      }
      check();return {passed:true,archiveSha256:archive.sha256,recordsRestored:manifest.entries.length,testedAt:new Date().toISOString()};
    } finally {
      db.close();
      await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});
    }
  }
  async function publish(archive,client,chunkSize=524288,{signal,isCurrent=()=>true}={}) {
    const check=()=>{if(signal?.aborted||!isCurrent())throw new DOMException('Workspace changed during archive publication','AbortError');};
    check();
    if(archive?.bundleType!==TYPE)return archive;
    if(!Number.isSafeInteger(chunkSize)||chunkSize<4||chunkSize%4||chunkSize>DEFAULT_SEGMENT_BYTES)throw Error('Invalid migration publication part size');
    const transport=archiveTransport(archive);
    if(typeof archive.data==='string'&&transport.length<=chunkSize){await decodeArchiveTransport(archive,{signal,isCurrent});return archive;}
    const references=[];let decoded=0;
    for await(const part of archiveTextChunks(transport,{signal,isCurrent},chunkSize)){
      check();decoded+=part.bytes.length;
      const data=part.text,sha256=await digest(new TextEncoder().encode(data));
      const documentKey='atlas_migration_part_v1:'+sha256;
      check();
      let existing=await client.readDocument(documentKey,{signal});
      check();
      if(!existing){
        await client.saveDocument({signal,isCurrent,documentKey,moduleKey:'dashboard',payload:{documentType:'atlas_migration_part_v1',sha256,data},expectedVersion:null,sourceModule:'atlas_dashboard',sourceHash:sha256,metadata:{purpose:'Verified migration archive part'}});
        check();
        existing=await client.readDocument(documentKey,{signal});
        check();
      }
      if(existing?.payload?.data!==data||existing?.payload?.sha256!==sha256)throw Error('Central migration part readback mismatch');
      references.push({documentKey,sha256,length:data.length});
    }
    if(decoded!==archive.bytes)throw Error('Migration archive decoded length mismatch');check();
    const {data,dataBlob,bytesData,dataDocuments,...manifest}=archive;
    return {...manifest,dataDocuments:references};
  }
  async function hydrate(archive,client,{concurrency=3,signal,inlineLimit:requestedInlineLimit=DEFAULT_INLINE_LIMIT}={}){
    if(!archive?.dataDocuments)return archive;
    const maxInline=inlineLimit(requestedInlineLimit);
    const refs=archive.dataDocuments;
    if(!Array.isArray(refs)||!refs.length||refs.some(ref=>!Number.isSafeInteger(ref?.length)||ref.length<1||ref.length>DEFAULT_SEGMENT_BYTES||typeof ref.documentKey!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256||'')))throw Error('Central migration part is missing or changed (invalid inventory)');
    const pieces=new Array(refs.length);
    const length=refs.reduce((sum,ref)=>sum+ref.length,0);
    if(!Number.isSafeInteger(length)||length!==Math.ceil(archive.bytes/3)*4)throw Error('Migration archive fingerprint mismatch (part lengths)');
    const finish=globalThis.AtlasPerformance?.start('archive-part-hydration',{parts:refs.length,bytes:archive.bytes});
    let cursor=0,failure=null;
    const check=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Archive hydration cancelled','AbortError');};
    const worker=async()=>{
      while(!failure&&cursor<refs.length){
        check();
        const index=cursor++,ref=refs[index];
        try {
          const row=await client.readDocument(ref.documentKey,{signal}),data=row?.payload?.data;
          check();
          if(typeof data!=='string'||data.length!==ref.length||await digest(new TextEncoder().encode(data))!==ref.sha256)throw Error('Central migration part is missing or changed');
          pieces[index]=data;
        }catch(error){failure=error;throw error;}
      }
    };
    try {
      const count=Math.min(refs.length,Math.max(1,Math.min(4,Math.floor(Number(concurrency)||3))));
      const results=await Promise.allSettled(Array.from({length:count},worker));
      const rejected=results.find(result=>result.status==='rejected');
      if(rejected)throw rejected.reason;
      check();
      const {data,dataBlob,bytesData,...metadata}=archive;
      return {...metadata,...(length<=maxInline?{data:pieces.join('')}:{dataBlob:new Blob(pieces,{type:'text/plain'})})};
    } finally {pieces.length=0;finish?.({failed:!!failure});}
  }
  // Each callback consumes a verified, bounded token batch. Expose the grammar
  // reader separately so consumers can retain only selected state while every
  // omitted snapshot token is still validated.
  async function visitEntryTokenBatches(zip,entry,onBatch){
    supportedLayout(entry);
    if(entry.layout===SEGMENTED)return visitSegmentTokens(zip,entry,null,null,onBatch);
    if(entry.bytes>DEFAULT_SEGMENT_BYTES)throw Error('Oversized unsegmented archive requires a streaming legacy reader');
    const value=await readArchiveRecord(zip,entry);let batch=[],size=0;
    for(const token of recordTokens(value,DEFAULT_SEGMENT_BYTES)){
      if(token[BLOB_FRAGMENT])throw Error('Unsegmented binary record requires its verified record reader');
      batch.push(token);size+=JSON.stringify(token).length;if(size>=65536){await onBatch(batch);batch=[];size=0;}
    }
    if(batch.length)await onBatch(batch);
  }
  return {TYPE,pack,packRecord,packTokenRecord,packRecords,unpack,verifyBundle,verifyRestore,visitSelectedRecords,publish,hydrate,toJsonBlob,openArchive,readArchiveRecord,visitEntryTokenBatches,createSelectedTokenReader:selectedTokenReader,recordTokens};
});
