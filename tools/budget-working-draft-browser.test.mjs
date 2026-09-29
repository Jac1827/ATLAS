// Real legacy Budget Builder, native browser storage, synthetic financial values.
// Run with ATLAS_PLAYWRIGHT pointing to an installed Playwright package if needed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const repo=path.resolve(import.meta.dirname,'..');
const assets=path.join(repo,'docs/portfolio-operations-dashboard');
const output=path.join(repo,'output/playwright/budget-working-draft');
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/away'){
      res.setHeader('content-type','text/html');
      res.end('<!doctype html><title>Outside Budget Builder</title><a href="/RISE-Budget-Builder.html#workspace">Reopen Budget Builder</a>');
      return;
    }
    const file=path.resolve(assets,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(assets+path.sep))throw Error('Invalid fixture asset');
    res.setHeader('content-type',file.endsWith('.html')?'text/html':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch(error){res.writeHead(404);res.end(error.message);}
});

let browser,page,stage='start';
const errors=[],remoteRequests=[],dialogs=[];
try{
  await fs.mkdir(output,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.ATLAS_BROWSER_CHANNEL?{channel:process.env.ATLAS_BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1600,height:1050}});
  page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',async dialog=>{
    dialogs.push(dialog.type());
    if(dialog.type()==='beforeunload')await dialog.accept();else await dialog.dismiss();
  });
  await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin===origin)return route.continue();
    remoteRequests.push(route.request().url());return route.abort();
  });
  const ready=()=>page.waitForFunction(()=>window.RBB?.engine?._reforecastBridge&&RBB.persist.renderReady&&RBB.app.state&&document.querySelector('.main .h1'));
  const row=gl=>page.locator('.main tbody tr').filter({has:page.locator('td.mono',{hasText:new RegExp('^'+gl+'$')})});
  const cell=(gl,month)=>row(gl).locator('input').nth(month);
  const scenario=()=>page.locator('.topbar select[onchange*="setScenario"]');
  const saved=async()=>{
    await page.waitForFunction(()=>!RBB.persist.dirty&&document.querySelector('#savestat .l')?.textContent==='Saved'&&document.querySelector('#browser-draft-save-status')?.textContent==='Saved in this browser');
    assert.equal(await page.locator('#savestat .l').innerText(),'Saved');
    assert.equal(await page.locator('#browser-draft-save-status').innerText(),'Saved in this browser');
  };
  const edit=async(gl,month,value)=>{
    await cell(gl,month).fill(String(value));
    await cell(gl,month).press('Tab');
    assert.equal(await cell(gl,month).inputValue(),String(value),'Recalculation retains the amount just entered');
    assert.equal(await page.locator('#savestat .l').innerText(),'Saving…');
    assert.equal(await page.locator('#browser-draft-save-status').innerText(),'Unsaved changes');
  };
  const sourceEvidence=()=>page.evaluate(()=>{
    const R=RBB,state=R.app.state;
    const calc=(id,year)=>{
      const result=R.engine.computeProperty(state,'DORO',id,year);
      return {values:Object.fromEntries(Object.values(result.results).map(row=>[row.line.gl,row.monthly])),annual:result.rollup.annual};
    };
    return {lines:state.lines,approvedSources:state.approvedBudgetImports,history:state.budgetImportHistory,
      approved2026:calc('SC-APPROVED',2026),approved2027:calc('SC-APPROVED',2027),other:calc('SC-OTHER',2026)};
  });
  stage='load genuine builder';
  await page.goto(origin+'/RISE-Budget-Builder.html#workspace');await ready();
  stage='seed synthetic mapped approved sources';
  await page.evaluate(()=>{
    const R=RBB,A=R.app,state=R.buildState(),property=state.properties[0];
    property.name='Synthetic Community';property.code='SYNTH';property.generalManager='';property.regionalDirector='';
    property.source='synthetic-fixture.xlsx';property.status='stabilized';property.totalUnits=12;
    property.units=[
      {id:'synthetic-conventional',cat:'conventional',code:'TEST',label:'Synthetic conventional',units:10,beds:10,marketRent:100,avgSqft:500},
      {id:'synthetic-str-units',cat:'str',code:'TEST-STR',label:'Synthetic STR programme',programmeId:'synthetic-str',units:2,beds:2,marketRent:100,avgSqft:500}
    ];
    property.occupancy={conventional:Array(12).fill(0.9)};
    property.occupancyByYear={2026:Array(12).fill(0.9),2027:Array(12).fill(0.9)};
    property.turnCurve='flat';property.strCurve='flat';
    property.str={enabled:true,unitGroup:'synthetic-str-units',adr:100,occupancy:0.7,alos:4,blockedPct:0};
    state.properties=[property];
    state.scenarios=[
      {id:'SC-APPROVED',name:'Synthetic Approved Budget',type:'approved',locked:true,status:'approved',assumptionOverrides:{},lineOverrides:{}},
      {id:'SC-WORK',name:'Working Draft',type:'working',status:'draft',assumptionOverrides:{},lineOverrides:{}},
      {id:'SC-OTHER',name:'Other Working Draft',type:'working',status:'draft',assumptionOverrides:{},lineOverrides:{}}
    ];
    const template=state.lines[0];
    state.lines=[['5120','Gross Potential Rent (GPR)',1000,'conventional'],['5144','Synthetic STR revenue',200,'str'],['6330','Synthetic expense',50,'property']].map(([gl,name,amount,unitCategory],i)=>{
      const account=R.gl(gl);
      return {...structuredClone(template),id:'synthetic-line-'+i,propertyId:'DORO',gl,name,unitCategory,
        section:account.group,coaGroup:account.group,nature:account.nature,department:gl==='6330'?'Operations':'Revenue',
        method:'imported',behavior:'fixed',driver:{},overrides:{},manualMonthly:null,importedMonthly:null,
        yearData:{2026:Array(12).fill(amount),2027:Array(12).fill(amount*2)},sourceFile:'synthetic-fixture.xlsx',
        ...(unitCategory==='str'?{strProgram:'Synthetic STR programme',strProgramId:'synthetic-str'}:{})};
    });
    state.contracts=[];state.actuals={};state.actualsDetail=[];state.periods={};state.imports=[];state.auditLog=[];
    state.strReference=null;state.strDraft=null;
    state.strPrograms=[{id:'synthetic-str',propertyId:'DORO',name:'Synthetic STR programme',applied:true,lineIds:['synthetic-line-1']}];
    state.budgetYear=2026;state.activeProperty='DORO';state.activeScenario='SC-APPROVED';
    for(const year of [2026,2027]){
      const accepted=state.lines.map((line,i)=>({property:'DORO',gl:line.gl,gl_name:line.name,year:String(year),effective_date:year+'-01-01',__monthly:line.yearData[year].map(value=>value*1.17),__row:i+2}));
      R.importer.apply('approved_budget',{accepted,errors:[],fileName:'synthetic-approved-'+year+'.xlsx',sheetName:'Budget',headerRow:1},state);
    }
    A.state=state;A.view='workspace';A.segment='combined';A.hideZero=false;A.cache=null;A.render();
    R.persist.autosave();
  });
  const baseline=await sourceEvidence();
  assert.equal(baseline.approved2026.values['5120'][0],1170);
  assert.equal(await row('5120').locator('input').count(),0,'Approved budget stays visibly locked');
  stage='working draft autosave and consistent indicators';
  await scenario().selectOption('SC-WORK');
  assert.equal(await cell('5120',0).inputValue(),'1170','Mapped approved snapshot drives the initial draft');
  await edit('5120',0,499999.25);await saved();
  await edit('5120',1,0);await saved();
  await edit('5120',2,-123.45);await saved();
  assert.deepEqual(await sourceEvidence(),baseline,'Grid edits do not change source lines, approved imports, history or another draft');

  stage='blank amount does not silently save zero';
  const checkpointBeforeBlank=await page.evaluate(()=>localStorage.getItem(RBB.persist.AUTOSAVE_KEY));
  await cell('5120',0).fill('');
  await cell('5120',0).press('Tab');
  assert.equal(await cell('5120',0).inputValue(),'499999.25','Clearing a cell restores its previous amount instead of converting blank to zero');
  assert.match(await page.locator('#toast').innerText(),/blank.*(?:not saved|ignored|unchanged)|(?:not saved|ignored|unchanged).*blank/i,'The user receives an explanation that the blank edit was not saved');
  await saved();
  assert.equal(await page.evaluate(()=>localStorage.getItem(RBB.persist.AUTOSAVE_KEY)),checkpointBeforeBlank,'Rejected blank input leaves the saved checkpoint unchanged');
  assert.equal(await cell('5120',1).inputValue(),'0','An explicitly entered zero remains valid');

  stage='year and scenario isolation';
  await page.locator('.yearsel').getByRole('button',{name:'2027',exact:true}).click();
  assert.equal(await cell('5120',0).inputValue(),'2340','2026 edit does not leak into 2027');
  await edit('5120',0,765432.1);await saved();
  await page.locator('.yearsel').getByRole('button',{name:'2026',exact:true}).click();
  assert.equal(await cell('5120',0).inputValue(),'499999.25');
  await scenario().selectOption('SC-OTHER');
  assert.equal(await cell('5120',0).inputValue(),'1170','Other working draft remains at its own baseline');
  await scenario().selectOption('SC-APPROVED');
  assert.equal(await row('5120').locator('input').count(),0);
  assert.equal((await row('5120').locator('td').nth(8).innerText()).trim(),'1,170');
  await scenario().selectOption('SC-WORK');
  assert.equal(await cell('5120',0).inputValue(),'499999.25');

  stage='conventional and STR isolation';
  await page.locator('button[onclick*="setSegment(\'conventional\')"]').click();
  const conventional=await page.evaluate(()=>RBB.engine.segment(RBB.app.cp(),'conventional').rollup);
  assert.equal(await row('5144').count(),0);
  await page.locator('button[onclick*="setSegment(\'combined\')"]').click();
  await edit('5144',0,888.5);await saved();
  assert.deepEqual(await page.evaluate(()=>RBB.engine.segment(RBB.app.cp(),'conventional').rollup),conventional,'STR edit leaves Conventional-only baseline exactly unchanged');
  assert.equal(await cell('5120',0).inputValue(),'499999.25');
  const reconciliation=await page.evaluate(()=>RBB.engine.segments(RBB.app.cp()));
  assert.equal(reconciliation.reconciles,true,'Combined remains conventional plus STR');
  assert.deepEqual(await sourceEvidence(),baseline);

  stage='reload restores scenario, values and truthful status';
  await page.reload();await ready();await saved();
  assert.equal(await scenario().inputValue(),'SC-WORK');
  assert.equal(await cell('5120',0).inputValue(),'499999.25');
  assert.equal(await cell('5120',1).inputValue(),'0');
  assert.equal(await cell('5120',2).inputValue(),'-123.45');
  assert.equal(await cell('5144',0).inputValue(),'888.5');
  assert.deepEqual(await sourceEvidence(),baseline);

  stage='navigate away and reopen';
  await page.getByRole('link',{name:'Monthly view',exact:true}).click();
  await page.getByRole('link',{name:'Property budget',exact:true}).click();
  assert.equal(await cell('5120',0).inputValue(),'499999.25');
  await page.goto(origin+'/away');
  await page.getByRole('link',{name:'Reopen Budget Builder',exact:true}).click();await ready();await saved();
  assert.equal(await scenario().inputValue(),'SC-WORK');
  assert.equal(await cell('5120',0).inputValue(),'499999.25');

  stage='explicit Save immediately after edit';
  // Leave the edited input focused: a blur/change repaint used to swallow the
  // Save click, leaving the previously saved amount in the reopening checkpoint.
  await cell('5120',0).fill('600001.75');
  await page.locator('.topbar').getByRole('button',{name:'Save',exact:true}).click();
  const receipt=await page.evaluate(()=>({autosave:JSON.parse(localStorage.getItem(RBB.persist.AUTOSAVE_KEY)),slots:RBB.persist.index()}));
  assert.equal(receipt.autosave.state.scenarios.find(row=>row.id==='SC-WORK').lineOverrides['synthetic-line-0'].monthlyOverridesByYear['2026']['0'],600001.75,'Focused-cell Save writes the newest amount immediately, before the autosave debounce');
  await saved();
  assert.equal(receipt.slots.length,0,'Header Save updates the reopening checkpoint without filling named save points');
  await page.reload();await ready();await saved();
  assert.equal(await cell('5120',0).inputValue(),'600001.75','Immediate Save refresh restores the newest amount');
  assert.deepEqual(await sourceEvidence(),baseline);
  stage='reload commits the focused unfinished cell';
  await cell('5120',0).fill('700002.5');
  await page.reload();await ready();await saved();
  assert.equal(await cell('5120',0).inputValue(),'700002.5','Reload saves and restores the focused cell without requiring Tab or Save');
  assert.deepEqual(await sourceEvidence(),baseline);
  stage='independent page reopens the same browser checkpoint';
  const second=await context.newPage();
  second.on('pageerror',error=>errors.push(error.message));
  await second.goto(origin+'/RISE-Budget-Builder.html#workspace');
  await second.waitForFunction(()=>window.RBB?.engine?._reforecastBridge&&RBB.persist.renderReady&&RBB.app.state?.activeScenario==='SC-WORK');
  const secondReceipt=await second.evaluate(()=>({year:RBB.app.year(),scenario:RBB.app.scenario().id,values:RBB.app.cp().results['synthetic-line-0'].monthly,status:document.querySelector('#savestat .l')?.textContent,context:document.querySelector('#browser-draft-save-status')?.textContent}));
  assert.equal(secondReceipt.year,2026);assert.equal(secondReceipt.scenario,'SC-WORK');
  assert.deepEqual(secondReceipt.values.slice(0,3),[700002.5,0,-123.45]);
  assert.equal(secondReceipt.status,'Saved');assert.equal(secondReceipt.context,'Saved in this browser');
  await second.close();
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[],'Valid focused edits save during reload without an unsaved-changes prompt');
  assert.deepEqual(remoteRequests,[],'Fixture never contacts production or external services');
  await page.screenshot({path:path.join(output,'saved-working-draft.png'),fullPage:true});
  console.log('PASS real Property budget browser: mapped approved snapshot; typed positive/zero/negative cells; blank input preserves saved amount; autosave and both save indicators; scenario/year isolation; Conventional/STR equality; reload; navigate away/reopen; focused-cell Save and reload retain the newest value; independent page readback; immutable approved/source/history evidence; no remote requests.');
}catch(error){
  console.error('BUDGET_DRAFT_BROWSER_FAILURE',JSON.stringify({stage,error:error.stack,errors,remoteRequests}));
  if(page&&!page.isClosed()){
    console.error((await page.locator('body').innerText()).slice(-5000));
    await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});
  }
  throw error;
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
