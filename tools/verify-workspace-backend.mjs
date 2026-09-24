// The anonymous probe can establish only RPC deployment and its denied public
// access. Authenticated value/performance acceptance is a separate release gate.
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/centralization/atlas-central-client.js',import.meta.url),'utf8');
const url=source.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
const key=source.match(/supabaseAnonKey:\s*"([^"]+)"/)?.[1];
if(!url||!key)throw Error('Public backend configuration is missing');
const probes=await Promise.allSettled([
  ['atlas_read_workspace_projection',{}],
  ['atlas_publish_workspace_projection',{p_projection:null}]
].map(async ([name,args])=>{
  const result=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
  const body=await result.json();
  if(![401,403].includes(result.status)||body.code!=='42501')throw Error(`${name} is not ready with denied anonymous access (${result.status}, ${body.code||'unknown'}). Deploy its migration before this client.`);
}));
const failed=probes.find(result=>result.status==='rejected');
if(failed)throw failed.reason;
console.log('PASS scoped workspace reader and publisher are deployed and deny anonymous access; authenticated production acceptance remains required.');
