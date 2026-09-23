const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../docs/portfolio-operations-dashboard'),A='10000000-0000-0000-0000-000000000001',B='10000000-0000-0000-0000-000000000002';
// A small dialog surface runs the real event handlers. No parser/database writes are mocked as successes.
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.nodes=new Map();this.dataset={};this.style={};this.value='';this.isConnected=true;this._html='';}
 set innerHTML(html){this._html=html;this.children=[];this.nodes=new Map();for(const attr of ['data-result','data-close','data-cancel','data-period','data-history','data-history-list','data-save','data-saved','data-download'])if(html.includes(attr))this.nodes.set('['+attr+']',new Element('control'));if(html.includes('role="status"'))this.nodes.set('[role=status]',new Element('status'));if(html.includes('type="file"'))this.nodes.set('input',new Element('input'));this.buttons=[...html.matchAll(/data-certificate="([^"]+)"/g)].map(m=>{const b=new Element('button');b.dataset.certificate=m[1];return b;});}
 get innerHTML(){return this._html;}
 querySelector(q){return this.nodes.get(q)||this.children.map(c=>c.querySelector(q)).find(Boolean)||null;}
 querySelectorAll(q){return q==='[data-certificate]'?this.buttons||[]:[];}
 append(...items){this.children.push(...items);}prepend(...items){this.children.unshift(...items);}insertBefore(item){this.children.push(item);}replaceChildren(...items){this.children=items;this.nodes.clear();}showModal(){}remove(){this.isConnected=false;}close(){this.onclose?.();this.isConnected=false;}addEventListener(){}
}
(async()=>{
 let actor='reviewer',responseMode='valid',reads=[],applied=[],writes=0,batches=0,parsed;
 const communities=[{community_id:A,display_name:'Doro'},{community_id:B,display_name:'Anthem'}],review={review_id:'review-A',community_id:A,period_key:'2026-02',source_property:'Doro',source_file:'Doro February.pdf',status:'reviewed',certificate:{sourceFile:'Doro February.pdf',sourceHash:'hash',metadata:{period:'2026-02'},checks:[]}};
 const central={getSession:()=>({user:{id:actor}}),readCommunitiesForAccess:async()=>communities,rpc:async()=>{writes++;throw Error('Unexpected write');},fetchJson:async url=>{reads.push(url);if(url.startsWith('/atlas_community_aliases'))return[];if(responseMode==='empty')return[];if(responseMode==='wrong-community')return[{...review,community_id:B}];return[review];}};
 const parent={location:{origin:'https://atlas.test'},ATLAS_CENTRAL:central,atlasAccessDecision:()=>({ok:true})},window={parent},document={body:new Element('body'),createElement:tag=>new Element(tag)},location={origin:'https://atlas.test',href:'https://atlas.test/builder?comparisonPeriod=2026-09'};
 const reviewContext=vm.createContext({window,document,location,URL,Date,AbortController,console,mountBatch:()=>{batches++;},applyControls:async(c,r)=>applied.push(r),readPackage:async()=>parsed,resolveCommunity:name=>({communityId:communities.find(c=>c.display_name===name)?.community_id,status:'matched'})});
 const reviewSource=fs.readFileSync(path.join(root,'features/financial-package-review.mjs'),'utf8').replace(/^import .*;\n/gm,'').replace(/\bexport /g,'');vm.runInContext(reviewSource+'\nglobalThis.reviewAPI={openReview,dispose};',reviewContext);
 const navApp={h:{esc:String},go(){},toast(message){throw Error(message);}},R={app:navApp,views:{actuals:()=>''}};
 const navContext=vm.createContext({RBB:R,document:{addEventListener(){}},__loadReview:async()=>reviewContext.reviewAPI});
 vm.runInContext(fs.readFileSync(path.join(root,'budget-navigation.js'),'utf8').replace(/import\('\.\/features\/financial-package-review\.mjs\?v=[^']+'\)/,"__loadReview()"),navContext);
 const controls=new Map(['data-community','data-year','data-refresh','data-file'].map(key=>['['+key+']',{}])),button={dataset:{nextCid:A,nextMonth:'2026-02',nextStep:'actuals'}},container={querySelector:q=>controls.get(q)||null,querySelectorAll:q=>q==='[data-next-cid]'?[button]:[]};
 const uiContext=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'features/reforecast-ui.mjs'),'utf8').replace(/^import .*;\n/gm,'').replace(/\bexport /g,'')+'\nglobalThis.bindActualsTest=bind;',uiContext);
 // Start on another property/year: the clicked row, not stale workspace or URL context, must govern the review.
 uiContext.bindActualsTest({container,R,cid:B,year:2027,dirty:false});await button.onclick();
 let dialog=document.body.children.at(-1),history=dialog.children.find(c=>c.querySelector('[data-period]'));
 assert.equal(history.querySelector('[data-period]').value,'2026-02');assert.equal(history.querySelector('[data-period]').disabled,true);assert.equal(batches,0,'Scoped review cannot expose unrelated batch publication');
 assert(reads[0].includes('period_key=eq.2026-02&community_id=eq.'+A));assert(dialog.children.some(c=>c.textContent?.includes('Doro · 2026-02')));
 await history.querySelector('[data-history-list]').querySelectorAll('[data-certificate]')[0].onclick();assert.equal(applied.length,1);assert.equal(applied[0].community_id,A);assert(reads.at(-1).includes('period_key=eq.2026-02&community_id=eq.'+A));
 responseMode='wrong-community';await history.querySelector('[data-history]').onclick();assert.match(history.querySelector('[data-history-list]').textContent,/scope mismatch/);assert.equal(applied.length,1,'Out-of-scope rows never create apply controls');responseMode='valid';
 const upload=async metadata=>{parsed={metadata,technicalReconciled:true,sourceFile:'fixture.pdf',sourceBytes:100,rows:[],checks:[],classifications:[],exceptions:[]};await dialog.querySelector('input').onchange({target:{files:[{name:'fixture.pdf'}],value:'fixture.pdf'}});};
 await upload({sourceProperty:'Doro',period:'2026-03'});assert.match(dialog.querySelector('[role=status]').textContent,/selected 2026-02/);assert.equal(history.querySelector('[data-period]').value,'2026-02');
 await upload({sourceProperty:'Anthem',period:'2026-02'});assert.match(dialog.querySelector('[role=status]').textContent,/does not match the selected Doro/);assert.equal(writes,0);
 await assert.rejects(()=>reviewContext.reviewAPI.openReview({communityId:'10000000-0000-0000-0000-000000000099',period:'2026-02'}),/authorized review scope/);
 actor='changed';await history.querySelector('[data-history]').onclick();assert.match(history.querySelector('[data-history-list]').textContent,/signed-in account changed/);actor='reviewer';
 // Existing general entry still defaults to the URL month, exposes normal batch tools and has no property filter.
 responseMode='empty';reads=[];await navApp.openFinancialPackageReview();dialog=document.body.children.at(-1);history=dialog.children.find(c=>c.querySelector('[data-period]'));assert.equal(history.querySelector('[data-period]').value,'2026-09');assert.notEqual(history.querySelector('[data-period]').disabled,true);assert.equal(batches,1);assert.equal(reads.length,0,'Unscoped entry preserves manual history loading');await history.querySelector('[data-history]').onclick();assert(reads[0].includes('period_key=eq.2026-09'));assert(!reads[0].includes('community_id=eq.'));
 console.log('PASS actuals next-step preserves clicked authorized community/month through navigation, scoped history/certificate read, upload mismatch protection and actor changes; general entry retains existing behavior.');
})().catch(e=>{console.error(e);process.exitCode=1;});
