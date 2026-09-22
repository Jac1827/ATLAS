/* Local-only acceptance boundary. Production functions and SQL are read fresh, never copied. */
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./community-goals-fixture.cjs');
const root=path.resolve(__dirname,'..'),base='/docs/portfolio-operations-dashboard/';
const port=Number(process.env.ATLAS_GOALS_PORT||8768),requests=[];
let failNext=false,db;
const sqlRoot=path.join(root,'docs/portfolio-operations-dashboard/centralization');
function extractedRuntime(){
 const source=fs.readFileSync(path.join(root,'docs/portfolio-operations-dashboard/index.html'),'utf8')+'\n'+fs.readFileSync(path.join(root,'docs/portfolio-operations-dashboard/community-goal-editor.js'),'utf8');
 const names=['defaultCommunityCommandState',...Array.from(source.matchAll(/^function (normalizeCommunityCommand\w+)\(/gm),m=>m[1]),'communityCommandUserLabel','communityCommandCanApproveGoals','communityCommandGoalKey','communityCommandGoalScope','communityCommandSharedGoalScope','mergeCommunityCommandGoalScope','hydrateCommunityCommandGoals','getCommunityCommandApprovedGoal','communityCommandGoalWeeks','renderCommunityCommandWeeklyEditor','communityCommandWeeklyAllocation','updateCommunityCommandGoalEditor','approveCommunityCommandMonthlyGoals','cancelCommunityCommandGoalEditor','renderCommunityCommandGoalEditor','saveCommunityCommandGoalEditor','communityCommandFormatNumber','communityCommandBonusGoalResult'];
 const functions=[...new Set(names)].map(name=>{
  const match=source.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\)\\s*\\{[\\s\\S]*?^\\}','m'));
  if(!match)throw Error('Cannot extract production function '+name);
  return match[0];
 });
 const declarations=['atlasCommunityGoalStore','communityCommandGoalBuffers','communityCommandGoalNotices','COMMUNITY_GOAL_FIELDS'].map(name=>{
  const match=source.match(new RegExp('^const '+name+' = .+;$','m'));if(!match)throw Error('Cannot extract '+name);return match[0];
 });
 return fs.readFileSync(path.join(root,'tools/performance/community-goals-harness-runtime.js'),'utf8').replace('/* PRODUCTION_FUNCTIONS */',[...declarations,...functions].join('\n\n'));
}
async function init(){ ({db}=await fixture()); }
const tables=new Set(['atlas_community_goal_heads','atlas_community_goal_records']);
async function readRows(raw){
 const url=new URL(raw,'http://fixture.invalid'),table=url.pathname.slice(1);
 if(!tables.has(table))throw Error('Unexpected table '+table);
 const args=[],clauses=[];
 for(const [key,value] of url.searchParams){
  if(['select','order','limit','offset'].includes(key))continue;
  if(!['community_id','period_key','record_id','kind'].includes(key))throw Error('Unexpected filter '+key);
  if(value.startsWith('eq.')){args.push(value.slice(3));clauses.push(`${key}=$${args.length}`);}
  else if(value.startsWith('in.(')&&value.endsWith(')')){const list=value.slice(4,-1).split(',').map(v=>v.replace(/^"|"$/g,''));const placeholders=list.map(v=>{args.push(v);return '$'+args.length;});clauses.push(`${key} in (${placeholders.join(',')})`);}
  else throw Error('Unexpected filter operator');
 }
 let query=`select * from ${table}`+(clauses.length?' where '+clauses.join(' and '):'');
 const order=url.searchParams.get('order');
 if(order){const fields=order.split(',').map(term=>{const [field,dir='asc']=term.split('.');if(!['community_id','period_key','revision','created_at','record_id'].includes(field)||!['asc','desc'].includes(dir))throw Error('Unexpected order');return field+' '+dir;});query+=' order by '+fields.join(',');}
 const limit=url.searchParams.get('limit'),offset=url.searchParams.get('offset');
 if(limit){if(!/^\d+$/.test(limit))throw Error('Invalid limit');query+=' limit '+Number(limit);}
 if(offset){if(!/^\d+$/.test(offset))throw Error('Invalid offset');query+=' offset '+Number(offset);}
 // PostgREST serializes PostgreSQL timestamps consistently for table and RPC JSON.
 // PGlite's direct row reader otherwise converts table timestamps into JS Dates.
 return (await db.query(`select to_jsonb(goal_row) as payload from (${query}) goal_row`,args)).rows.map(row=>row.payload);
}
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>300000)throw Error('Request too large');}return JSON.parse(text||'{}');}
async function route(req,res){try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/__goals_api/read'){const raw=url.searchParams.get('path');requests.push({at:new Date().toISOString(),read:raw});return json(res,200,await readRows(raw));}
 if(url.pathname==='/__goals_api/fail'&&req.method==='POST'){failNext=true;return json(res,200,{armed:true});}
 if(url.pathname==='/__goals_api/inspect')return json(res,200,{heads:(await db.query('select * from atlas_community_goal_heads order by community_id,period_key')).rows,records:(await db.query('select * from atlas_community_goal_records order by created_at')).rows,requests:requests.slice(-100)});
 if(url.pathname==='/__goals_api/rpc'&&req.method==='POST'){
  const {name,args}=await body(req);if(name!=='atlas_save_community_goals')throw Error('Unexpected RPC');
  requests.push({at:new Date().toISOString(),rpc:name,args});
  if(failNext&&args.p_kind!=='recommended'){failNext=false;return json(res,503,{message:'Synthetic database unavailable. No changes were committed.'});}
  const p=args,result=await db.query('select public.atlas_save_community_goals($1,$2,$3,$4,$5,$6::jsonb) as result',[p.p_community_id,p.p_period,p.p_kind,p.p_expected_revision,p.p_request_id,JSON.stringify(p.p_payload)]);
  return json(res,200,result.rows[0].result);
 }
 let content,mime='text/plain';
 if(url.pathname===base+'community-goals-harness.html'||url.pathname==='/'){content=fs.readFileSync(path.join(root,'tools/performance/community-goals-harness.html'));mime='text/html';}
 else if(url.pathname===base+'community-goals-harness-runtime.js'){content=extractedRuntime();mime='text/javascript';}
 else{const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(path.join(root,'docs/portfolio-operations-dashboard')+path.sep))throw Error('Invalid local asset');content=fs.readFileSync(file);mime=/\.(m?js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream';}
 res.writeHead(200,{'content-type':mime,'cache-control':'no-store'});res.end(content);
 }catch(error){json(res,500,{message:error.message});}}
init().then(()=>http.createServer(route).listen(port,'127.0.0.1',()=>console.log(`Goal acceptance: http://127.0.0.1:${port}${base}community-goals-harness.html`))).catch(error=>{console.error(error);process.exitCode=1;});
