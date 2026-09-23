/* Isolated browser acceptance with the production UI, adapter and real SQL functions. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{fixture}=require('./reforecast-fixture.cjs');
(async()=>{const {db,A,B,signIn}=await fixture();const root=path.resolve(__dirname,'..');let failNext=false;let queue=Promise.resolve();
 const ids=[A,B],actor=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
 await db.exec('reset role');
 await db.query("update atlas_approved_budget_versions set payload=jsonb_set(payload,'{rows}',$1)",[JSON.stringify([['5120','Rent','income','RENT'],['5220','Vacancy','contra_income','VACANCY'],['6100','Payroll','expense','PAYROLL'],['6200','Utilities','expense','UTILITIES'],['8100','Capital','capital','CAPITAL']].map(([glCode,name,nature,group],i)=>({glCode,name,nature,group,monthly:Array(12).fill([1000,-50,200,50,20][i])})))]);
 await signIn(1);
 const users=[{user_id:actor(1),display_name:'Test Admin',role:'admin',status:'active'},{user_id:actor(2),display_name:'Test Regional',role:'regional',status:'active'}];
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>ATLAS isolated reforecast acceptance</title></head><body style="font:14px system-ui;background:#eef3f7"><h1>Isolated reforecast acceptance</h1><p>Synthetic financial fixture. No production records are changed.</p><button id="fail">Fail next save</button><button id="workspace">Working Reforecast</button><button id="approvals">Approval Center</button><button id="gap">Gap Report</button><div id="app"></div><script type="module">
 import {mountReforecast} from '/docs/portfolio-operations-dashboard/features/reforecast-ui.mjs';
 const central={getSession:()=>({user:{id:'${actor(1)}'}}),getStoredProfile:()=>({role:'admin'}),refreshSession:async()=>{},readCommunitiesForAccess:async()=>${JSON.stringify(ids.map((community_id,i)=>({community_id,display_name:['Test Doro','Test New Delivery'][i]})))},readUserProfiles:async()=>${JSON.stringify(users)},fetchJson:async(route,options={})=>{const res=await fetch('/__api'+route,{...options,headers:{'content-type':'application/json'}});const data=await res.json();if(!res.ok)throw Error(data.message);return data;}};
 window.ATLAS_CENTRAL=central;
 const R={app:{year:()=>2026,notifyAtlasHeight:()=>{},go:view=>mount(view==='reforecastapprovals'?'approvals':view==='reforecastgap'?'gap':'workspace')}};
 async function mount(mode='workspace'){await mountReforecast(document.querySelector('#app'),{central,hostWindow:window,R,mode});}
 document.querySelector('#workspace').onclick=()=>mount();document.querySelector('#approvals').onclick=()=>mount('approvals');document.querySelector('#gap').onclick=()=>mount('gap');document.querySelector('#fail').onclick=async()=>{await fetch('/__fail',{method:'POST'});document.querySelector('#fail').textContent='Next save will fail';};mount();
 </script></body></html>`;
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');const respond=(status,body,type='application/json')=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body);};
 try{
  if(url.pathname==='/__fail'){failNext=true;respond(200,{ok:true});return;}
  if(url.pathname==='/'){respond(200,html,'text/html');return;}
  if(url.pathname.startsWith('/__api')){
   let raw='';for await(const chunk of req)raw+=chunk;if(raw.length>40000000)throw Error('Fixture request too large');
   const route=url.pathname.slice(6),body=raw?JSON.parse(raw):null;
   const task=queue.then(async()=>{await signIn(1);if(route.startsWith('/rpc/')){const name=route.slice(5);if(!new Set(['atlas_save_reforecast_upload','atlas_save_reforecast_registry','atlas_read_reforecast_source','atlas_save_reforecast_scenario','atlas_publish_reforecast','atlas_read_reforecast_workspace','atlas_read_active_reforecast']).has(name))throw Error('Fixture RPC not permitted');if(failNext&&name.startsWith('atlas_save_')){failNext=false;throw Error('Simulated persistence failure');}const keys=Object.keys(body);if(keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Invalid fixture parameter');const args=keys.map(k=>body[k]&&typeof body[k]==='object'&&!Array.isArray(body[k])?JSON.stringify(body[k]):body[k]);return (await db.query(`select to_jsonb(${name}(${keys.map((k,i)=>k+'=> $'+(i+1)).join(',')})) as value`,args)).rows[0].value;}
    const table=route.slice(1);if(!/^atlas_reforecast_[a-z_]+$/.test(table))throw Error('Fixture table not permitted');const filters=[],values=[];for(const [k,v]of url.searchParams){if(['select','limit','offset','order'].includes(k))continue;if(!/^[a-z_]+$/.test(k)||!v.startsWith('eq.'))throw Error('Invalid fixture filter');values.push(v.slice(3));filters.push(k+'=$'+values.length);}const query='select to_jsonb(t) as value from '+table+' t'+(filters.length?' where '+filters.join(' and '):'')+' limit '+Math.min(1000,Number(url.searchParams.get('limit')||1000));return (await db.query(query,values)).rows.map(r=>r.value);
   });queue=task.catch(()=>{});respond(200,await task);return;
  }
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){respond(404,{message:'Not found'});return;}
  const type=file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/octet-stream';respond(200,fs.readFileSync(file),type);
 }catch(e){respond(400,{message:e.message});}});
 const port=Number(process.env.PORT||8772);server.listen(port,'127.0.0.1',()=>console.log('Reforecast acceptance http://127.0.0.1:'+port));
})().catch(e=>{console.error(e);process.exitCode=1;});
