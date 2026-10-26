import {tokensFromJsonBlob} from './migration-token-stream.mjs';

const encoder=new TextEncoder();
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

// Keep the portable JSON format readable by older releases. Only its large
// top-level base64 scalar is held in a Blob; metadata still passes through the
// archive grammar reader, including its duplicate-key and prototype safeguards.
export async function readPortableBundleFile(file,{api,isCurrent,signal,maxMetadataBytes=64*1024*1024,maxDepth=256}={}){
  if(!(file instanceof Blob))throw new TypeError('A portable bundle file is required.');
  if(typeof api?.createSelectedTokenReader!=='function'||typeof api?.TYPE!=='string')throw new TypeError('The migration archive reader is unavailable.');
  if(!Number.isSafeInteger(maxMetadataBytes)||maxMetadataBytes<1||!Number.isSafeInteger(maxDepth)||maxDepth<1)throw new RangeError('Invalid portable bundle limits.');
  const check=()=>{
    if(signal?.aborted)throw signal.reason||new DOMException('Bundle read cancelled.','AbortError');
    if(isCurrent&&!isCurrent())throw new DOMException('Workspace changed while reading the bundle.','AbortError');
  };
  check();
  if(file.size===0)throw new Error('The selected file is empty.');
  let metadataBytes=0,depth=0,dataString=false,readingData=false,dataLength=0,paddingAt=-1,base64Valid=true;
  let dataParts=[],pendingData=[];
  const spend=bytes=>{metadataBytes+=bytes;if(metadataBytes>maxMetadataBytes)throw new Error('Bundle metadata exceeds the supported size. The original file has not been changed.');};
  const grammar=api.createSelectedTokenReader((path,type)=>{
    if(path.length===1&&path[0]==='data'&&type==='string'){
      dataString=true;readingData=true;return false;
    }
    return true;
  });
  // Blob implementations can emit different chunk sizes. Bound the decoder's
  // input even if a host supplies the entire file in one byte chunk.
  const boundedInput={stream:()=>file.stream().pipeThrough(new TransformStream({
    transform(bytes,controller){
      for(let offset=0;offset<bytes.length;offset+=65536){
        check();controller.enqueue(bytes.subarray(offset,offset+65536));
      }
    }
  }))};
  try{
    for await(const batch of tokensFromJsonBlob(boundedInput,{signal})){
      check();
      for(const token of batch){
        const [type,value]=token;
        if(type==='object'||type==='array'){
          if(++depth>maxDepth)throw new Error('Bundle metadata exceeds the supported nesting depth.');
        }else if(type==='end')depth--;
        if(readingData&&type==='text'){
          // Escaped fragments also preserve lone surrogates if this turns out
          // to be an ordinary bundle's data field rather than an archive.
          pendingData.push(JSON.stringify(value).slice(1,-1));
          if(base64Valid){
            if(!/^[A-Za-z0-9+/=]*$/.test(value))base64Valid=false;
            else{
              const equals=value.indexOf('=');
              if(paddingAt>=0){if(!/^=*$/.test(value))base64Valid=false;}
              else if(equals>=0){paddingAt=dataLength+equals;if(!/^=*$/.test(value.slice(equals)))base64Valid=false;}
            }
          }
          dataLength+=value.length;
        }else if(type==='text')spend(encoder.encode(JSON.stringify(value).slice(1,-1)).byteLength);
        else spend(type==='value'?JSON.stringify(value).length+1:2);
        grammar.accept(token);
        if(readingData&&type==='endString')readingData=false;
      }
      if(pendingData.length){dataParts.push(new Blob(pendingData,{type:'text/plain'}));pendingData=[];}
      check();
    }
    const result=grammar.finish();
    check();
    if(result?.bundleType===api.TYPE){
      if(own(result,'dataBlob')||own(result,'bytesData'))throw new Error('A portable archive contains conflicting transport fields.');
      if(own(result,'data')&&!dataString)throw new Error('Archive data must be a base64 string.');
    }
    if(!dataString)return result;
    const dataBlob=new Blob(dataParts,{type:'text/plain'});dataParts=[];
    if(result?.bundleType===api.TYPE){
      const padding=paddingAt<0?0:dataLength-paddingAt;
      if(!base64Valid||dataLength%4!==0||padding>2||(padding===1&&paddingAt%4!==3)||(padding===2&&paddingAt%4!==2))throw new Error('Archive data is not valid base64.');
      // Older hydrated downloads can also contain central document references.
      // The retained inline bytes are the local restore source; no remote read
      // should replace them after this file has been selected.
      delete result.dataDocuments;
      Object.defineProperty(result,'dataBlob',{value:dataBlob,writable:true,enumerable:true,configurable:true});
    }else{
      spend(dataBlob.size);
      // This fallback is bounded by the metadata budget and keeps the exact
      // string semantics of JSON.parse for older ordinary storage bundles.
      const data=JSON.parse('"'+await dataBlob.text()+'"');
      check();
      Object.defineProperty(result,'data',{value:data,writable:true,enumerable:true,configurable:true});
    }
    return result;
  }finally{dataParts=[];pendingData=[];}
}
