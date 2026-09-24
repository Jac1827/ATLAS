/* Production UI + transport against the real PostgreSQL fixture RPCs. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const url=process.env.ATLAS_FORECAST_TEST_URL||'http://127.0.0.1:8772',cid='10000000-0000-0000-0000-000000000001';
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await fs.mkdir('output/playwright/forecast-builder',{recursive:true});
const idle=async()=>{await page.waitForFunction(()=>!document.querySelector('[data-refresh]')?.disabled);};
const save=async action=>{await page.locator('[data-action="'+action+'"]').click();await idle();const message=await page.locator('[role=alert]').allTextContents();assert.equal(message.length,0,message.join('\n'));};
try{
 await page.goto(url);await page.locator('[data-community]').selectOption(cid);await idle();
 await page.locator('[data-new]').click();await page.locator('[data-last]').fill('2026-03');await page.locator('[data-last]').dispatchEvent('change');await page.waitForFunction(()=>!document.querySelector('[data-create]')?.disabled);
 assert.equal(await page.locator('[data-first]').inputValue(),'2026-02','default begins after the latest governed full close');
 await page.locator('[data-model]').selectOption('mixed');await page.locator('[data-stream][value=hello_landing]').check();await page.locator('dialog [data-calendar-confirm]').check();await page.locator('[data-create]').click();
 await page.locator('[data-edit=reviewerId]').selectOption('00000000-0000-0000-0000-000000000001');await page.locator('[data-edit=reason]').fill('Synthetic two-month mixed forecast review');
 await save('save_draft');
 let section=page.locator('[data-str-stream="0"]');
 await section.locator('[data-str-field=incomeAccountCode]').fill('5120');await section.locator('[data-str-field=incomeAccountCode]').dispatchEvent('change');
 await section.locator('[data-str-field=vacancyAccountCode]').fill('5220');await section.locator('[data-str-field=vacancyAccountCode]').dispatchEvent('change');
 await section.locator('[data-str-field=assumptionReason]').fill('Reviewed synthetic nightly-rate assumption');await section.locator('[data-str-field=assumptionReason]').dispatchEvent('change');
 await section.getByText('Included unit roster and take-backs (0)',{exact:true}).click();
 await section.locator('[data-new-unit]').fill('SYNTHETIC-UNIT-A');await section.locator('[data-add-unit]').click();
 await section.locator('[data-new-unit]').fill('SYNTHETIC-UNIT-B');await section.locator('[data-add-unit]').click();
 await section.locator('[data-unit="1"] [data-unit-field=takeBackMonth]').fill('2026-03');await section.locator('[data-unit="1"] [data-unit-field=takeBackMonth]').dispatchEvent('change');
 for(const index of [0,1])for(const [field,value]of [['occupancyPercent','50'],['grossPerOccupiedNight','100']]){const input=section.locator('[data-str-month="'+index+'"] [data-month-field="'+field+'"]');await input.fill(value);await input.dispatchEvent('change');}
 await section.locator('[data-str-apply]').click();assert.equal((await page.locator('[role=alert]').allTextContents()).length,0);
 await save('save_draft');
 // Two independent contexts must read the same committed version.
 const otherContext=await browser.newContext({viewport:{width:390,height:844}}),other=await otherContext.newPage();await other.goto(url+'/?user=2');await other.locator('[data-community]').selectOption(cid);await other.waitForFunction(()=>!document.querySelector('[data-refresh]').disabled);
 const first=await page.evaluate(async cid=>window.ATLAS_CENTRAL.fetchJson('/rpc/atlas_read_reforecast_workspace',{method:'POST',body:JSON.stringify({p_community_ids:[cid]})}),cid),second=await other.evaluate(async cid=>window.ATLAS_CENTRAL.fetchJson('/rpc/atlas_read_reforecast_workspace',{method:'POST',body:JSON.stringify({p_community_ids:[cid]})}),cid);
 assert.equal(first[0].snapshot.fingerprint,second[0].snapshot.fingerprint);assert.equal(first[0].snapshot.strSchedules.length,2);assert.equal(first[0].snapshot.strSchedules[0].grossIncome,2800);assert.equal(first[0].snapshot.strSchedules[1].grossIncome,1550);
 const id=first[0].head.scenario_id;await other.locator('[data-scenario]').selectOption(id);await other.waitForFunction(()=>!document.querySelector('[data-refresh]').disabled);await other.screenshot({path:'output/playwright/forecast-builder/mobile.png',fullPage:true});
 assert(await other.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'mobile page does not overflow outside scrollable tables');
 // Failed persistence must keep working edits and permit a verified retry.
 await page.locator('[data-edit=reason]').fill('Retained after a simulated persistence failure');await page.locator('#fail').click();await page.locator('[data-action=save_draft]').click();await idle();assert.match((await page.locator('[role=alert]').allTextContents()).join(' '),/Simulated persistence failure/);assert.equal(await page.locator('[data-edit=reason]').inputValue(),'Retained after a simulated persistence failure');await save('save_draft');
 const staleResult=await other.evaluate(async({cid,id,payload,revision})=>{try{await window.ATLAS_CENTRAL.fetchJson('/rpc/atlas_save_reforecast_scenario',{method:'POST',body:JSON.stringify({p_community_id:cid,p_scenario_id:id,p_expected_revision:revision,p_request_id:crypto.randomUUID(),p_action:'save_draft',p_payload:payload})});return 'unexpected stale save';}catch(error){return error.message;}},{cid,id,payload:second[0].revision.payload,revision:second[0].head.revision});assert.match(staleResult,/another session|changed|stale/i);
 await save('reconcile');await save('ready');await save('submit');
 const deniedContext=await browser.newContext(),denied=await deniedContext.newPage();await denied.goto(url+'/?user=2');await denied.locator('[data-community]').selectOption(cid);await denied.waitForFunction(()=>!document.querySelector('[data-refresh]').disabled);await denied.locator('[data-scenario]').selectOption(id);await denied.waitForFunction(()=>!document.querySelector('[data-refresh]').disabled);assert.equal(await denied.locator('[data-approve-review]').count(),0);
 const deniedResult=await denied.evaluate(async cid=>{const rows=await window.ATLAS_CENTRAL.fetchJson('/rpc/atlas_read_reforecast_workspace',{method:'POST',body:JSON.stringify({p_community_ids:[cid]})});try{await window.ATLAS_CENTRAL.fetchJson('/rpc/atlas_save_reforecast_scenario',{method:'POST',body:JSON.stringify({p_community_id:cid,p_scenario_id:rows[0].head.scenario_id,p_expected_revision:rows[0].head.revision,p_request_id:crypto.randomUUID(),p_action:'approve_lock',p_payload:rows[0].revision.payload})});return 'unexpected approval';}catch(error){return error.message;}},cid);assert.match(deniedResult,/Admin or executive/);
 await page.locator('[data-approve-review]').click();await page.locator('[data-approval-confirm]').check();await page.locator('[data-confirm-approval]').click();await page.waitForSelector('[data-confirm-approval]',{state:'detached'});await idle();
 const active=await page.evaluate(async cid=>window.ATLAS_CENTRAL.fetchJson('/rpc/atlas_read_active_reforecast',{method:'POST',body:JSON.stringify({p_community_ids:[cid],p_periods:['2026-02','2026-03']})}),cid);
 assert.equal(active.length,1);assert.equal(active[0].verified,true);await other.reload();
 const independent=await other.evaluate(async cid=>window.ATLAS_CENTRAL.fetchJson('/rpc/atlas_reforecast_effective_baseline',{method:'POST',body:JSON.stringify({p_community_ids:[cid],p_periods:['2026-02','2026-03']})}),cid);assert(independent.every(row=>row.publicationId===active[0].publicationId&&row.verified===true));
 const receiptRead=async target=>target.evaluate(async({publicationId,cid})=>{const report=await window.ATLAS_CENTRAL.fetchJson('/rpc/atlas_read_reforecast_publication',{method:'POST',body:JSON.stringify({p_publication_id:publicationId})}),baselines=await window.ATLAS_CENTRAL.fetchJson('/rpc/atlas_reforecast_effective_baseline',{method:'POST',body:JSON.stringify({p_community_ids:[cid],p_periods:['2026-02','2026-03']})});return {report,baselines};},{publicationId:active[0].publicationId,cid});
 const editorReceipts=await Promise.all([receiptRead(page),receiptRead(other)]);assert.deepEqual(editorReceipts[0],editorReceipts[1],'Admin and Regional reload identical immutable report totals and monthly Bonus target input evidence');
 for(const type of ['pdf','xlsx']){const pending=page.waitForEvent('download');await page.locator('[data-official-export="'+type+'"]').click();const download=await pending;await download.saveAs('output/playwright/forecast-builder/'+download.suggestedFilename());}
 await page.screenshot({path:'output/playwright/forecast-builder/desktop.png',fullPage:true});
 await page.locator('#gap').click();await idle();const [csvDownload]=await Promise.all([page.waitForEvent('download'),page.locator('[data-export=csv]').click()]),csvPath='output/playwright/forecast-builder/'+csvDownload.suggestedFilename();await csvDownload.saveAs(csvPath);const csvText=await fs.readFile(csvPath,'utf8');assert.match(csvText,/2800/);assert(!csvText.includes('SYNTHETIC-UNIT-'),'CSV export suppresses private unit references');
 await page.locator('#approvals').click();await idle();for(const type of ['html','pdf','xlsx']){const pending=page.waitForEvent('download');await page.locator('[data-digest-export="'+type+'"]').click();const download=await pending;await download.saveAs('output/playwright/forecast-builder/'+download.suggestedFilename());}

 assert.deepEqual(errors,[]);await deniedContext.close();await otherContext.close();
 console.log('PASS browser: full-month baseline setup, real SQL save/readback, two STR months with takeback, two independent sessions, mobile layout, denied Regional approval, atomic Admin approval, active baseline, matching Admin/Regional report and Bonus target evidence, and PDF/XLSX/CSV downloads');
}catch(error){console.error('UI at failure:',(await page.locator('body').innerText()).slice(-6500));await page.screenshot({path:'output/playwright/forecast-builder/failure.png',fullPage:true});throw error;}
finally{await browser.close();}
