const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const XLSX = require(process.env.ATLAS_XLSX || 'xlsx');
const workerSource = fs.readFileSync('docs/portfolio-operations-dashboard/features/workbook-worker.js', 'utf8');
async function inspect(book, bytes = XLSX.write(book,{type:"array",bookType:"xlsx"})) {
  const messages = [];
  const context = {XLSX, performance, importScripts(){}, self:{postMessage:message=>messages.push(message)}};
  vm.createContext(context); vm.runInContext(workerSource, context);
  await context.self.onmessage({data:{id:1,operation:'open',buffer:bytes}});
  assert.equal(messages[0].error, undefined);
  for (const name of book.SheetNames) {
    await context.self.onmessage({data:{id:2,operation:'sheet',name,metadata:false}});
    const {result,error} = messages.at(-1); assert.equal(error,undefined);
    const all = XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:false});
    assert.equal(result.rowCount, all.length, 'Full row count is preserved for ' + name);
    assert.deepEqual(JSON.parse(JSON.stringify(result.rows)),JSON.parse(JSON.stringify(result.candidate?all:all.slice(0,80))),name);
  }
  return messages;
}
(async()=>{
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Budget','Value'],...Array.from({length:20000},(_,i)=>['Expense',i])]),'Unrelated');
  const sections=Array.from({length:200},()=>['']);
  sections[0]=['Availability (As of 09/18/2026)']; sections[150]=['Lead Conversions']; sections[199]=['Applications',17];
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(sections),'Multi-section');
  const messages=await inspect(book);
  assert.equal(messages[1].result.rows.length,80);assert.equal(messages[1].result.candidate,false);
  assert.equal(messages[2].result.rows.length,200);assert.equal(messages[2].result.candidate,true);
  if(process.env.ATLAS_BOX_SCORE_FIXTURE) {
    const bytes = fs.readFileSync(process.env.ATLAS_BOX_SCORE_FIXTURE);
    await inspect(XLSX.read(bytes,{type:'buffer',cellDates:true,raw:false}),bytes);
  }
  console.log('PASS worker preview parity: bounded unrelated samples, full multi-section candidates, exact row counts');
})().catch(error=>{console.error(error);process.exitCode=1;});
