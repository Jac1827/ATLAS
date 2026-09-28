import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixture}=require('./financial-intake-fixture.cjs'),{db,signIn}=await fixture();
const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const base={schemaVersion:'atlas.workbook-integrity.v1',inventory:{sourceHash:'a'.repeat(64),packageMetadataAvailable:true,dateSystem:'1900',definedNames:[],sheets:[{name:'Input',cells:[{id:'Input!A1',sheet:'Input',address:'A1',row:1,column:1,type:'n',value:0},{id:'Input!B1',sheet:'Input',address:'B1',row:1,column:2,type:'n',value:2,formula:'A1+2',cachePresent:true,cachedValue:2}]}]},graph:{nodes:[{id:'Input!A1',sheet:'Input',address:'A1',kind:'cell'},{id:'Input!B1',sheet:'Input',address:'B1',kind:'cell',formula:'A1+2'}],edges:[{from:'Input!B1',to:'Input!A1'}]},authorityScope:{type:'selected_cells_and_dependencies',selectedCells:['Input!B1'],requiredNodes:['Input!A1','Input!B1']},summary:{populatedCells:2,formulas:1},findings:[]};
const cases=[['valid exact cells and zero',JSON.stringify(base)]];
function changed(name,edit){const a=structuredClone(base);edit(a);cases.push([name,JSON.stringify(a)]);}
for(const value of [null,0,false,'text',[],{}]){
 for(const kind of ['cell','node','edge','name','sheet'])changed(`${kind} element ${JSON.stringify(value)}`,a=>{if(kind==='cell')a.inventory.sheets[0].cells.push(value);if(kind==='node')a.graph.nodes.push(value);if(kind==='edge')a.graph.edges.push(value);if(kind==='name')a.inventory.definedNames.push(value);if(kind==='sheet')a.inventory.sheets.push(value);});
}
for(const field of ['cells','nodes','edges','definedNames'])for(const value of [null,{},'text',[],0])changed(`${field} container ${JSON.stringify(value)}`,a=>{if(field==='cells')a.inventory.sheets[0].cells=value;else if(field==='definedNames')a.inventory.definedNames=value;else a.graph[field]=value;});
for(const value of [null,'1',1.25,'1.25','invalid',2147483648,{},[]])changed(`coordinate ${JSON.stringify(value)}`,a=>{a.inventory.sheets[0].cells[0].row=value;});
for(const value of [null,0,false,{},[]])changed(`nullable typed metadata ${JSON.stringify(value)}`,a=>{a.graph.nodes[0].formula=value;a.inventory.sheets[0].cells[0].formula=value;a.graph.nodes[0].sheet=value;a.inventory.sheets[0].name=value;});
changed('missing cells property',a=>{delete a.inventory.sheets[0].cells;});
changed('missing coordinate property',a=>{delete a.inventory.sheets[0].cells[0].row;});
changed('empty workbook',a=>{a.inventory.sheets=[];a.graph={nodes:[],edges:[]};a.summary={populatedCells:0,formulas:0};a.authorityScope=null;});
changed('inactive range malformed bounds',a=>a.graph.nodes.push({id:'@range:Input!A9:A1',kind:'range',sheet:'Input',start:'A9',end:'A1'}));
changed('inactive edge missing endpoint',a=>a.graph.edges.push({from:'Input!A1',to:'Input!Missing'}));
changed('inactive duplicate node',a=>a.graph.nodes.push({...a.graph.nodes[0]}));
changed('undefined supporting name',a=>a.inventory.definedNames.push({name:'Rate',sheet:null,reference:'Input!A1'}));
const raw=JSON.stringify(base);
for(const [name,from,to] of [
 ['duplicate cell ID last wins','"id":"Input!A1"','"id":"discarded","id":"Input!A1"'],
 ['duplicate cell ID final null','"id":"Input!A1"','"id":"Input!A1","id":null'],
 ['duplicate cells container last wins','"cells":[','"cells":null,"cells":['],
 ['duplicate coordinate last wins','"row":1','"row":"invalid","row":1'],
 ['duplicate graph field last wins','"edges":[','"edges":null,"edges":['],
 ['duplicate sheet name last wins','"name":"Input"','"name":false,"name":"Input"'],
 ['JSON explicit null versus missing','"formula":"A1+2"','"formula":null,"formula":"A1+2"']
])cases.push([name,raw.replace(from,to)]);
cases.push(['JSON null','null'],['JSON scalar','42'],['SQL null',null]);
async function result(name,value){try{return {kind:'result',value:(await db.query(`select atlas_private.${name}($1::json) result`,[value])).rows[0].result};}catch(error){return {kind:'error',code:error.code,message:error.message};}}
try{
 await db.exec('reset role');
 for(const name of ['20260924121641_planning_cell_workbook_integrity_governance.sql','20260924121647_immutable_workbook_audits_and_monthly_governance.sql','20260924232845_bounded_workbook_audit_transport.sql','20260925011545_workbook_audit_validation_performance.sql','20260925032350_workbook_raw_json_canonical.sql','20260925033844_workbook_raw_evidence_projections.sql'])await db.exec(migration(name));
 const before=(await db.query("select pg_get_functiondef('atlas_private.workbook_global_validation_raw(json)'::regprocedure) definition,pg_get_functiondef('atlas_private.finalize_workbook_audit_upload(uuid,uuid,text)'::regprocedure) finalizer")).rows[0];
 await db.exec(migration('20260925035358_workbook_typed_raw_validation.sql'));
 const after=(await db.query("select pg_get_functiondef('atlas_private.workbook_global_validation_raw_before_typed(json)'::regprocedure) definition,pg_get_functiondef('atlas_private.finalize_workbook_audit_upload(uuid,uuid,text)'::regprocedure) finalizer")).rows[0];assert.equal(after.definition.replaceAll('workbook_global_validation_raw_before_typed','workbook_global_validation_raw'),before.definition);assert.equal(after.finalizer,before.finalizer,'Typed helper install does not activate upload behavior');
 let errors=0,successes=0;
 for(const [name,value] of cases){const old=await result('workbook_global_validation_raw_before_typed',value),typed=await result('workbook_global_validation_raw',value);assert.deepEqual(typed,old,'Typed/raw semantic parity: '+name);if(old.kind==='error')errors++;else successes++;}
 await signIn(1);await assert.rejects(db.query('select atlas_private.workbook_global_validation_raw_before_typed($1::json)',[raw]),/permission denied/);await assert.rejects(db.query('select atlas_private.workbook_global_validation_raw($1::json)',[raw]),/permission denied/);
 const proof={scope:'Local isolated PostgreSQL; no production activation',cases:cases.length,resultParityCases:successes,errorParityCases:errors,malformedNullDuplicateEmptyNonobjectParity:true,priorDefinitionPreservedExactly:true,helperInstallationDoesNotActivate:true,newHelperPrivate:true};
 if(process.env.ATLAS_TYPED_VALIDATION_PROOF)fs.writeFileSync(process.env.ATLAS_TYPED_VALIDATION_PROOF,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}catch(error){console.error(JSON.stringify({message:error.message,code:error.code,where:error.where}));process.exitCode=1;}finally{await db.close();}
