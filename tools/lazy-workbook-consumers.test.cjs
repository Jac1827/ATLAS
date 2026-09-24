const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const base='docs/portfolio-operations-dashboard/';
function extract(source,name){const start=new RegExp('^\\s*(?:async )?function '+name+'\\(','m').exec(source);assert(start,name);for(const match of source.slice(start.index).matchAll(/^\s*\}/gm)){const text=source.slice(start.index,start.index+match.index+match[0].length);try{new vm.Script(text);return text;}catch{}}throw Error(name);}
(async()=>{
 let contextKey='actor-a:scope-a',loads=0,writes=0,release,alerts=[];
 const source=fs.readFileSync(base+'investor-packet-ui.js','utf8');
 const xlsx={utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}},writeFile(){writes++;}};
 const context={Blob,console,refreshSources:async()=>{},build:()=>({community:'Synthetic',period:'2026-09',rows:[],issues:[],segments:[]}),P:{forecastLabel:()=> 'Forecast'},alert:message=>alerts.push(message),window:{getAtlasRenderContextKey:()=>contextKey,AtlasFeatures:{load:async name=>{assert.equal(name,'xlsx');loads++;await new Promise(resolve=>release=resolve);context.XLSX=xlsx;}}}};
 vm.createContext(context);vm.runInContext(extract(source,'exportPacket'),context);
 const first=context.exportPacket('xlsx');await new Promise(setImmediate);assert.equal(loads,1);assert.equal(writes,0);release();await first;assert.equal(writes,1);
 delete context.XLSX;const stale=context.exportPacket('xlsx');await new Promise(setImmediate);contextKey='actor-b:scope-b';release();await stale;assert.equal(writes,1,'Pending dependency cannot download a prior actor/scope packet');assert.match(alerts.at(-1),/workspace changed/);
 // The full Application UI starts without SheetJS; only explicit export loads it.
 let loadHandler,appLoad=0,appWrites=0,key='scope-a';const app={window:{AtlasApplicationLineage:{},AtlasScreeningSummary:{},getAtlasRenderContextKey:()=>key,addEventListener:(name,fn)=>{if(name==='load')loadHandler=fn;},AtlasFeatures:{load:async name=>{assert.equal(name,'xlsx');appLoad++;app.window.XLSX={utils:{book_new:()=>({}),json_to_sheet:rows=>rows,book_append_sheet(){}},writeFile:()=>appWrites++};}}},document:{querySelector:()=>null},console};
 vm.createContext(app);vm.runInContext(fs.readFileSync(base+'application-performance-ui.js','utf8'),app);assert.equal(appLoad,0);loadHandler();assert.equal(appLoad,0);
 // Model primitives return an empty but explicit reconciled report.
 Object.assign(app.window.AtlasApplicationLineage,{cohort:()=>[],summarize:()=>({processing:{}}),monthly:()=>[],inventory:()=>[],periodConversion:()=>({})});Object.assign(app.window.AtlasScreeningSummary,{select:()=>[],summarize:()=>({})});
 app.window.getAtlasApplicationLineageExport();await app.window.atlasApplicationExport();assert.equal(appLoad,1);assert.equal(appWrites,1);
 console.log('PASS explicit investor/Application exports load SheetJS on demand, never during initialization, and stale actor/scope dependency completion cannot download an old packet.');
})().catch(error=>{console.error(error);process.exitCode=1;});
