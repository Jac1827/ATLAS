const assert=require('node:assert/strict'),{create}=require('../docs/portfolio-operations-dashboard/workforce-sync.js');
(async()=>{let heads=[{employee_id:'a',version:1}],reads=0,refreshes=[],fail=false;const sync=create({readHeads:async()=>{reads++;return heads;},refresh:async ids=>{if(fail)throw Error('offline');refreshes.push(ids);}});
await Promise.all([sync.poll('user'),sync.poll('user')]);assert.equal(reads,1);assert.equal(refreshes.length,1);await sync.poll('user');assert.equal(refreshes.length,1);
heads=[{employee_id:'a',version:2}];fail=true;await sync.poll('user');assert.equal(sync.state.status,'Pending Sync');fail=false;await sync.poll('user');assert.equal(sync.state.status,'Current');assert.equal(refreshes.length,2);
heads=[{employee_id:'a',version:1}];await sync.poll('user');assert.equal(refreshes.length,2,'out-of-order version cannot roll back');
heads=[{employee_id:'a',version:3},{employee_id:'b',version:1}];await sync.poll('user');assert.deepEqual(refreshes.at(-1),['a','b']);await sync.poll('other');assert.equal(refreshes.length,4,'new sessions receive their own scoped state');
console.log('PASS versioned sync coalescing, scoped refresh, retries, replay, out-of-order events and account changes');})().catch(e=>{console.error(e);process.exitCode=1;});
