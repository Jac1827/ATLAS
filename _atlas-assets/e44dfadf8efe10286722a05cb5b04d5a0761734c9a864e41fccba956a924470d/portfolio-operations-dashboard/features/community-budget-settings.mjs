import {resolveCommunity} from './financial-package.mjs?v=fb2b9dde0a554114';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLASSES=['Multifamily','Student Housing'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const actorOf=central=>central?.getSession?.()?.user?.id;
function sessionGuard(central,actor){if(!actor||actorOf(central)!==actor)throw Error('Your session changed. Reopen Community Settings.');}
function adminGuard(central,actor){sessionGuard(central,actor);const profile=central.getStoredProfile?.();if(profile?.user_id!==actor||profile.role!=='admin'||profile.status!=='active')throw Error('An active Admin must verify the financial calendar.');}
const rpc=(central,name,args)=>central.fetchJson('/rpc/'+name,{method:'POST',body:JSON.stringify(args)});

export async function readCommunityBudgetSettings(central,communityId){
 if(!UUID.test(communityId||''))throw Error('Select a canonical community before verifying its calendar.');
 const actor=actorOf(central);sessionGuard(central,actor);
 const [rows,calendar]=await Promise.all([
  central.fetchJson('/atlas_communities?community_id=eq.'+communityId+'&select=community_id,display_name,canonical_name,market,version,budget_calendar&limit=1'),
  rpc(central,'atlas_read_budget_calendar',{p_community_id:communityId})
 ]);
 sessionGuard(central,actor);
 if(!Array.isArray(rows)||rows.length!==1||rows[0].community_id!==communityId||!Number.isInteger(rows[0].version))throw Error('The selected community or its current version could not be verified.');
 return {community:rows[0],calendar};
}

export async function saveCommunityBudgetSettings(central,{communityId,expectedVersion,classification,reason}){
 const actor=actorOf(central);adminGuard(central,actor);
 if(!UUID.test(communityId||'')||!Number.isInteger(expectedVersion)||expectedVersion<1||!CLASSES.includes(classification)||String(reason||'').trim().length<3)throw Error('Choose a financial classification and enter a verification reason.');
 await central.refreshSession?.();adminGuard(central,actor);
 const saved=await rpc(central,'atlas_set_budget_calendar',{p_community_id:communityId,p_expected_version:expectedVersion,p_classification:classification,p_reason:reason.trim()});
 adminGuard(central,actor);
 const readback=await readCommunityBudgetSettings(central,communityId);adminGuard(central,actor);
 if(saved?.verified!==true||readback.calendar?.verified!==true||readback.calendar.classification!==classification||readback.calendar.startMonth!==(classification==='Student Housing'?8:1)||readback.community.version<=expectedVersion||readback.calendar.settingsVersion!==saved.settingsVersion)throw Error('The saved calendar could not be confirmed against the latest community version. Reload Community Settings.');
 return readback;
}

export async function mountCommunityBudgetSettings(panel,{central,communityId,communityName,isCurrent=()=>true}={}){
 if(!panel||!central||!actorOf(central))return;
 panel.querySelector('[data-community-budget-settings]')?.remove();
 const host=panel.ownerDocument.createElement('section');host.className='card mb4';host.dataset.communityBudgetSettings='1';host.style.cssText='padding:20px';panel.prepend(host);
 const actor=actorOf(central),current=()=>host.isConnected&&isCurrent()&&actorOf(central)===actor;
 host.innerHTML='<h2>Financial calendar</h2><p role="status">Reading verified Community Settings…</p>';
 let state,busy=false;
 function render(message=''){
  if(!current())return;
  const {community,calendar}=state,profile=central.getStoredProfile?.(),admin=profile?.user_id===actor&&profile.role==='admin'&&profile.status==='active';
  const verified=calendar?.verified===true,kind=calendar?.classification||community.budget_calendar?.classification||'',cycle=calendar?.startMonth===8?'August–July':calendar?.startMonth===1?'January–December':'Not verified';
  host.innerHTML='<h2>Financial calendar · '+escape(community.display_name||community.canonical_name)+'</h2><p><strong>'+escape(verified?'Verified':'Needs verification')+'</strong> · '+escape(cycle)+'</p><p>Source: '+escape(calendar?.source||community.budget_calendar?.source||'No verified source')+(calendar?.settingsVersion?' · Settings version '+escape(calendar.settingsVersion):'')+'</p>'+
   (calendar?.startMonth===8?'<p>Student Housing uses its school-year cycle, including the summer turn period.</p>':'')+
   (admin?'<form data-calendar-form><label>Financial classification <select data-calendar-classification required><option value="">Choose classification</option>'+CLASSES.map(value=>'<option value="'+value+'"'+(value===kind?' selected':'')+'>'+value+'</option>').join('')+'</select></label> <label>Verification reason <input data-calendar-reason type="text" required minlength="3" placeholder="Source and reason for this classification"></label> <button class="btn btn-blue" type="submit">Verify and save calendar</button></form>':'<p>An Admin can verify or correct this calendar in Community Settings.</p>')+
   '<p role="status" data-calendar-status>'+escape(message||calendar?.reason||'')+'</p>';
  const form=host.querySelector('[data-calendar-form]');if(!form)return;
  form.onsubmit=async event=>{
   event.preventDefault();if(!current()||busy)return;
   const classification=host.querySelector('[data-calendar-classification]').value,reason=host.querySelector('[data-calendar-reason]').value,button=form.querySelector('button'),status=host.querySelector('[data-calendar-status]');
   busy=true;button.disabled=true;status.textContent='Saving and checking the shared calendar…';
   try{
    const saved=await saveCommunityBudgetSettings(central,{communityId:community.community_id,expectedVersion:community.version,classification,reason});
    if(!current())return;state=saved;render('Verified and saved. Budget Builder and month-end review now use this calendar.');
    panel.dispatchEvent(new CustomEvent('atlas-budget-calendar-updated',{bubbles:true,detail:{communityId:community.community_id}}));
   }catch(error){if(current()){status.textContent=error.message;button.disabled=false;}}
   finally{busy=false;}
  };
 }
 try{
  const [communities,aliases]=await Promise.all([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000')]);
  if(!current())return;
  const exact=UUID.test(communityId||'')?communities.find(row=>row.community_id===communityId):null;
  if(UUID.test(communityId||'')&&!exact)throw Error('The selected canonical community is outside your current authorized scope.');
  const id=exact?.community_id||resolveCommunity(communityName,communities,aliases).communityId;
  if(!id)throw Error('Select the correct canonical community in Community Settings. Its calendar cannot be inferred from a name.');
  state=await readCommunityBudgetSettings(central,id);if(current())render();
 }catch(error){if(current())host.innerHTML='<h2>Financial calendar</h2><p role="status">'+escape(error.message)+'</p>';}
}
