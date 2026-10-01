import test from 'node:test';
import assert from 'node:assert/strict';
import {createFromImport} from '../docs/portfolio-operations-dashboard/features/reforecast-store.mjs';
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const options={communityId:id(1),scenarioId:id(2),requestId:id(3),uploadId:id(4),expectedRevision:0,mapping:{version:id(5),confirmed:true},payload:{reason:'Retain this exact review',history:[{action:'reviewed',reason:'Do not shorten or remove'}]},expectedLines:[{period:'2026-09',accountCode:'5120',amount:0,sourceLineId:'Input!A1'},{period:'2026-10',accountCode:'5120',amount:-10,sourceLineId:'Input!B1'}]};
const detail={code:'reforecast_payload_too_large',payloadBytes:2166735,limitBytes:2097152,measurement:'postgres_jsonb_text_utf8',stage:'save_reforecast_builder',retainedReviewHistory:'preserve'};
const failure=change=>Object.assign(Error('Forecast save payload exceeds the 2 MiB limit.'),{code:'P0001',details:JSON.stringify(detail),hint:'Preserve all retained reviews and history.',...change});
const saved={head:{scenario_id:options.scenarioId,community_id:options.communityId},revision:{revision_id:id(6),scenario_id:options.scenarioId,community_id:options.communityId,payload:{...options.payload,overrides:options.expectedLines}},snapshot:{lines:options.expectedLines.map(row=>({...row,forecast:row.amount}))},receipt:{verified:true,request_id:options.requestId,upload_id:options.uploadId,mapping_version:options.mapping.version,revision_id:id(6),importedCells:options.expectedLines}};
function fixture(error,{receipt=null,receiptFailure=false,initialReceiptFailure=false}={}){
 const calls=[];let reads=0;
 const central={getSession:()=>({user:{id:id(7)}}),async fetchJson(path,{body}){const value=JSON.parse(body);calls.push({path,value});if(path==='/rpc/atlas_read_reforecast_import_receipt'){reads++;if(initialReceiptFailure||reads>1&&receiptFailure)throw Error('Receipt unavailable');return reads>1?receipt:null;}assert.equal(path,'/rpc/atlas_create_reforecast_from_import');throw error;}};
 return {calls,run:()=>createFromImport(central,options)};
}
test('validated oversize metadata guides repair only after absent receipt and leaves exact request/reviews/history unchanged',async()=>{
 const before=structuredClone(options),error=failure(),f=fixture(error);
 await assert.rejects(f.run,e=>e===error&&e.code==='P0001'&&e.details===JSON.stringify(detail)&&/2166735 bytes; limit: 2097152 bytes/.test(e.message)&&/Keep all retained reviews and history/.test(e.message)&&/sending it unchanged will exceed/.test(e.message)&&!/Retry the retained request/.test(e.message));
 assert.deepEqual(options,before);assert.deepEqual(f.calls.map(row=>row.path),['/rpc/atlas_read_reforecast_import_receipt','/rpc/atlas_create_reforecast_from_import','/rpc/atlas_read_reforecast_import_receipt']);assert.deepEqual(f.calls[1].value.p_payload,before.payload);assert.equal(f.calls[1].value.p_request_id,before.requestId);
});
test('committed receipt takes precedence over size error and unknown receipts retain uncertainty',async()=>{
 const f=fixture(failure(),{receipt:saved});assert.deepEqual(await f.run(),saved);assert.equal(f.calls.length,3);
 const uncertain=fixture(failure(),{receiptFailure:true});await assert.rejects(uncertain.run,e=>/response is uncertain/.test(e.message)&&!/No committed receipt|sending it unchanged/.test(e.message));assert.equal(uncertain.calls.length,3);
 const unknown=fixture(failure(),{initialReceiptFailure:true});await assert.rejects(unknown.run,/Receipt unavailable/);assert.equal(unknown.calls.length,1);
});
test('unrecognized, malformed, or incompatible diagnostics retain existing generic failure behavior',async()=>{
 const changed=[{code:'22023'},{details:'not JSON'},{details:JSON.stringify({code:detail.code})},{details:JSON.stringify({...detail,code:'other_error'})},{details:JSON.stringify({...detail,payloadBytes:'2166735'})},{details:JSON.stringify({...detail,payloadBytes:2097152})},{details:JSON.stringify({...detail,limitBytes:4194304})},{details:JSON.stringify({...detail,stage:'other_stage'})},{details:JSON.stringify({...detail,measurement:'wire_bytes'})},{details:JSON.stringify({...detail,retainedReviewHistory:'discard'})}];
 for(const change of changed){const f=fixture(failure(change));await assert.rejects(f.run,e=>/No committed receipt was found\. Retry the retained request\.$/.test(e.message)&&!/Expanded save payload:/.test(e.message));assert.equal(f.calls.length,3);}
});
