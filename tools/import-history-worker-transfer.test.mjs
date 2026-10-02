import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {historyOperation} from '../docs/portfolio-operations-dashboard/features/import-history.mjs';
globalThis.indexedDB=indexedDB;
const dbName='history-transfer-'+crypto.randomUUID(),storeName='records',key='imports';
const run=(operation,extra={})=>historyOperation({dbName,storeName,key,operation,...extra});
let terminated=0;
class MemoryLimitedWorker {
  postMessage(){throw new DOMException('Data cannot be cloned, out of memory.','DataCloneError');}
  terminate(){terminated++;}
}
const previousWorker=globalThis.Worker;
try {
  globalThis.Worker=MemoryLimitedWorker;
  const initial=await run('load');
  const source={...initial,batches:[{id:'retained',beforeSnapshot:{capturedAt:'2026-09-30',savedData:{A:{occupied:0}}}}],sourceArchive:[{id:'approved-source',fileHash:'source-hash'}]};
  const saved=await run('publish',{value:source,expectedRevision:initial.historyStorage.revision});
  assert.equal(saved.verified,true,'A job rejected before dispatch uses the same guarded storage operation');
  const after=await run('export');
  assert.deepEqual(after.batches[0].beforeSnapshot,source.batches[0].beforeSnapshot);
  assert.deepEqual(after.sourceArchive,source.sourceArchive);
  await assert.rejects(run('publish',{value:source,expectedRevision:initial.historyStorage.revision}),/changed/,'Fallback preserves revision conflict protection');
  assert(terminated>=4,'Every rejected worker is released');
  class AcceptedThenFailedWorker {
    postMessage(){queueMicrotask(()=>this.onerror());}
    terminate(){}
  }
  globalThis.Worker=AcceptedThenFailedWorker;
  await assert.rejects(run('publish',{value:{...source,batches:[]},expectedRevision:saved.revision}),error=>error.code==='history_write_uncertain'&&error.uncertain===true,'An accepted write is never retried after worker failure');
  globalThis.Worker=MemoryLimitedWorker;
  assert.equal((await run('load')).historyStorage.revision,saved.revision,'The uncertain operation was not retried or committed by the client');
  console.log('PASS memory-limited worker dispatch, retained snapshots, revision guards, and no retry after accepted writes.');
} finally {
  globalThis.Worker=previousWorker;
  indexedDB.deleteDatabase(dbName);
}
