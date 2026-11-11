import {Sha256} from './bounded-json-integrity.mjs?v=a4ea8821996c3b57';
const encoder=new TextEncoder();
const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Archive operation cancelled','AbortError');};

// The archive's strings are fragmented independently of Unicode pairs. Keep a
// trailing high surrogate until the next fragment so bytes match JSON.stringify.
export function createJsonTokenSink({signal,hashOnly=false}={}){
  const transform=hashOnly?null:new CompressionStream('gzip'),writer=transform?.writable.getWriter();
  const result=transform?new Response(transform.readable).blob():Promise.resolve(null),hash=new Sha256(),stack=[];
  let text='',chunks=[],root=false,done=false,string=null;
  const emit=value=>{text+=value;if(text.length>=65536){chunks.push(encoder.encode(text));text='';}};
  const prefix=()=>{const top=stack.at(-1);if(!top){if(root)throw Error('Multiple JSON roots');root=true;return;}if(top.type==='array'){if(top.count++)emit(',');return;}if(!top.hasKey)throw Error('Missing JSON object key');top.hasKey=false;top.count++;};
  const escaped=value=>{let next=(string.carry||'')+value;string.carry='';if(next.length&&/[\uD800-\uDBFF]/.test(next.at(-1))){string.carry=next.at(-1);next=next.slice(0,-1);}if(next)emit(JSON.stringify(next).slice(1,-1));};
  return {
    add(token){
      if(done)throw Error('JSON token sink is closed');
      const [type,value]=token,top=stack.at(-1);
      if(type==='key'){if(top?.type!=='object'||top.keyPending||top.hasKey)throw Error('Invalid JSON key');top.keyPending=true;}
      else if(type==='string'){
        if(string)throw Error('Nested JSON string');const key=!!top?.keyPending;
        if(key){top.keyPending=false;if(top.count)emit(',');}else prefix();
        emit('"');string={key,carry:''};
      }else if(type==='text'){if(!string||typeof value!=='string')throw Error('Invalid JSON string fragment');escaped(value);}
      else if(type==='endString'){
        if(!string)throw Error('Missing JSON string');if(string.carry)emit(JSON.stringify(string.carry).slice(1,-1));emit('"');
        if(string.key){emit(':');top.hasKey=true;}string=null;
      }else if(type==='object'||type==='array'){if(string)throw Error('Invalid JSON container');prefix();emit(type==='object'?'{':'[');stack.push({type,count:0,hasKey:false,keyPending:false});}
      else if(type==='end'){if(string||!top||top.hasKey||top.keyPending)throw Error('Incomplete JSON container');stack.pop();emit(top.type==='object'?'}':']');}
      else if(type==='value'){if(string||value!==null&&!['number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw Error('Invalid JSON value');prefix();emit(JSON.stringify(value));}
      else if(type==='date')throw Error('Typed dates require a lossless retained record reader');
      else throw Error('Import history must contain JSON values only');
    },
    async flush(){check(signal);if(text){chunks.push(encoder.encode(text));text='';}const pending=chunks;chunks=[];for(const bytes of pending){check(signal);hash.update(bytes);if(writer)await writer.write(bytes);}},
    async finish(){if(stack.length||string||!root)throw Error('Incomplete JSON token stream');await this.flush();done=true;if(writer)await writer.close();return {blob:await result,sha256:hash.digestHex()};},
    async abort(error){done=true;chunks=[];text='';if(writer)await writer.abort(error).catch(()=>{});await result.catch(()=>{});}
  };
}

// Incremental JSON tokenizer for retained gzip records. It never builds a
// complete JSON string, snapshot object, or unbounded string scalar.
export async function* tokensFromJsonBlob(blob,{gzip=false,signal}={}){
  let stream=blob.stream();if(gzip)stream=stream.pipeThrough(new DecompressionStream('gzip'));
  const reader=stream.pipeThrough(new TextDecoderStream('utf-8',{fatal:true,ignoreBOM:true})).getReader();
  const stack=[];let root='value',mode='',lex='',fragment='',escape='',unicode='',stringKey=false,out=[];
  const expectation=()=>stack.at(-1)?.state||root;
  const complete=()=>{const top=stack.at(-1);if(top){if(top.state!=='value'&&top.state!=='first')throw Error('Unexpected JSON value');top.state='comma';}else{if(root!=='value')throw Error('Multiple JSON roots');root='done';}};
  const append=char=>{fragment+=char;if(fragment.length>=8192){out.push(['text',fragment]);fragment='';}};
  const finishPrimitive=()=>{let value;try{value=JSON.parse(lex);}catch{throw Error('Invalid retained JSON primitive');}if(value!==null&&!['boolean','number'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw Error('Invalid retained JSON primitive');out.push(['value',value]);lex='';mode='';complete();};
  try{
    while(true){check(signal);const next=await reader.read();if(next.done)break;const text=next.value;
      for(let i=0;i<text.length;i++){
        const char=text[i];
        if(mode==='string'){
          if(unicode){if(!/[a-fA-F0-9]/.test(char))throw Error('Invalid JSON Unicode escape');unicode+=char;if(unicode.length===5){append(String.fromCharCode(parseInt(unicode.slice(1),16)));unicode='';}continue;}
          if(escape){escape='';if(char==='u'){unicode='u';continue;}const escapes={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};if(!Object.hasOwn(escapes,char))throw Error('Invalid JSON escape');append(escapes[char]);continue;}
          if(char==='\\'){escape='\\';continue;}
          if(char==='"'){if(fragment)out.push(['text',fragment]);fragment='';out.push(['endString']);mode='';if(stringKey)stack.at(-1).state='colon';else complete();continue;}
          if(char.charCodeAt(0)<32)throw Error('Invalid JSON control character');append(char);continue;
        }
        if(mode==='primitive'){
          if(/[ \t\r\n,\]}]/.test(char)){finishPrimitive();i--;continue;}lex+=char;if(lex.length>128)throw Error('Oversized JSON primitive');continue;
        }
        if(/[ \t\r\n]/.test(char))continue;
        const top=stack.at(-1),expected=expectation();
        if(char==='}'||char===']'){
          if(!top||top.type!==(char==='}'?'object':'array')||!['first','comma','key-first'].includes(expected))throw Error('Incomplete JSON container');stack.pop();out.push(['end']);complete();continue;
        }
        if(expected==='comma'){if(char!==',')throw Error('Missing JSON comma');top.state=top.type==='object'?'key':'value';continue;}
        if(expected==='colon'){if(char!==':')throw Error('Missing JSON colon');top.state='value';continue;}
        if(expected==='key'||expected==='key-first'){
          if(char!=='"')throw Error('Invalid JSON object key');out.push(['key'],['string']);mode='string';stringKey=true;continue;
        }
        if(expected!=='value'&&expected!=='first')throw Error('Unexpected JSON token');
        if(char==='{'||char==='['){out.push([char==='{'?'object':'array']);stack.push({type:char==='{'?'object':'array',state:char==='{'?'key-first':'first'});}
        else if(char==='"'){out.push(['string']);mode='string';stringKey=false;}
        else if(/[-0-9tfn]/.test(char)){lex=char;mode='primitive';}
        else throw Error('Invalid JSON value');
      }
      if(out.length){yield out;out=[];}
    }
    if(mode==='primitive')finishPrimitive();
    if(mode||escape||unicode||stack.length||root!=='done')throw Error('Incomplete retained JSON');
    if(out.length)yield out;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
