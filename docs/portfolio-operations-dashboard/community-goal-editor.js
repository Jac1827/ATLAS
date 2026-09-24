/* Scoped goal editor. Persistence lives in the canonical goals adapter. */
function communityCommandGoalWeeks(editor) {
  const days = new Date(editor.year, editor.monthIdx + 1, 0).getDate();
  const period = buildPeriodKey(editor.monthIdx, editor.year);
  const startDay = editor.effectiveDate?.slice(0,7) === period ? Number(editor.effectiveDate.slice(8)) : 1;
  return { startDay, count: Math.ceil((days - startDay + 1) / 7) };
}

function renderCommunityCommandWeeklyEditor(editor) {
  const {count,startDay} = communityCommandGoalWeeks(editor);
  return `<details><summary>Weekly goal breakdown</summary><label><input type="checkbox" id="cc-goal-custom-weeks" ${editor.customWeeks ? "checked" : ""} onchange="updateCommunityCommandGoalEditor()">Use adjusted weekly allocations</label><table class="community-command-plan-table"><thead><tr><th>Week Starting</th><th>Applications</th><th>Gross Leases</th><th>Net Leases</th></tr></thead><tbody>${Array.from({length:count},(_,i)=>`<tr><td>${startDay+i*7}</td>${["applicationGoal","grossLeaseGoal","netLeaseGoal"].map(key=>`<td><input type="number" min="0" step="1" aria-label="Week ${i+1} ${key}" id="cc-week-${key}-${i}" oninput="updateCommunityCommandGoalEditor()" value="${editor.customWeeks && editor.values.weeklyGoals?.length === count ? editor.values.weeklyGoals[i]?.[key] ?? "" : communityCommandWeeklyAllocation(editor.values[key],count)[i] ?? ""}"></td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
}

function communityCommandWeeklyAllocation(total,count) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(count) || count < 1) return [];
  return Array.from({length:count},(_,i)=>Math.floor(total/count)+(i<total%count?1:0));
}

function updateCommunityCommandGoalEditor() {
  const editor = communityCommandGoalEditor;
  if (!editor || editor.loading || editor.saving || !document.getElementById("cc-goal-reason")) return;
  for (const key of COMMUNITY_GOAL_FIELDS) editor.values[key] = normalizeOptionalNumber(document.getElementById(`cc-goal-${key}`)?.value);
  editor.reason = document.getElementById("cc-goal-reason").value;
  editor.effectiveDate = document.getElementById("cc-goal-effective").value;
  editor.customWeeks = Boolean(document.getElementById("cc-goal-custom-weeks")?.checked);
  if (editor.customWeeks) {
    const {count,startDay} = communityCommandGoalWeeks(editor);
    editor.values.weeklyGoals = Array.from({length:count},(_,i)=>({week:i+1,startDay:startDay+i*7,...Object.fromEntries(["applicationGoal","grossLeaseGoal","netLeaseGoal"].map(key=>[key,normalizeOptionalNumber(document.getElementById(`cc-week-${key}-${i}`)?.value)]))}));
  }
  editor.dirty = true; editor.message = "Unsaved edits"; editor.error = "";
  communityCommandGoalBuffers.set(editor.key,editor);
}

async function approveCommunityCommandMonthlyGoals(monthIdx = getSelectedDashboardMonthIndex()) {
  const context=syncCommunityCommandGoalContext();
  const current=()=>context.current() && atlasCommunityGoalStore.context===context;
  if (!current()) {alert("Verify your shared ATLAS access before opening goals.");return;}
  if (!communityCommandCanApproveGoals()) {alert("Only Admin or VP / Executive roles can approve official monthly goals.");return;}
  const model = buildCommunityCommandModel(getProp().name,getCurrentCommunityRecord());
  const row = buildCommunityCommandLeasingPlanRows(model)[clampNumber(monthIdx,0,11)] || {};
  const scope = communityCommandGoalScope(model.propName,row.monthIdx,model.year);
  if (!scope.communityId) {alert("This community is missing its shared identity. Goals were not changed.");return;}
  const recommendation = {applicationGoal:row.recommendedApps,grossLeaseGoal:row.recommendedGrossLeases,netLeaseGoal:row.netLeaseGoal,requiredMoveIns:row.requiredMoveIns,occupancyGoal:row.budgetPct,leasedGoal:null,economicGoal:null,renewalGoal:null};
  const pending = communityCommandGoalBuffers.get(scope.key);
  const editor = pending?.dirty ? pending : { ...scope, propName:model.propName,monthIdx:row.monthIdx,year:model.year,values:{},reason:"",effectiveDate:`${scope.period}-01`,recommended:recommendation,revision:0,dirty:false };
  editor.viewMonthIdx=model.monthIdx; editor.loading=true; editor.loadFailed=false; editor.error=""; editor.recommendationError="";
  communityCommandGoalEditor=editor; renderTab();
  try {
    await hydrateCommunityCommandGoals({force:true});
    if (!current()) return;
    if (!getAtlasCentralStatus().signedIn || !atlasCommunityGoalStore.loaded) throw Error("Sign in to shared ATLAS to read and save goals.");
    const saved=atlasCommunityGoalStore.scopes.get(scope.key);
    if (!editor.dirty) {
      const legacy=normalizeCommunityCommandState(communityCommandState);
      const recovered=legacy.goalDrafts.find(goal=>communityCommandGoalKey(goal.propName,goal.monthIdx,goal.year)===communityCommandGoalKey(model.propName,row.monthIdx,model.year)) || legacy.approvedGoals.filter(goal=>communityCommandGoalKey(goal.propName,goal.monthIdx,goal.year)===communityCommandGoalKey(model.propName,row.monthIdx,model.year)).sort((a,b)=>b.version-a.version)[0];
      const record=saved?.draft || saved?.approved || recovered;
      editor.values=Object.fromEntries(COMMUNITY_GOAL_FIELDS.map(key=>[key,record ? record[key] ?? null : recommendation[key]]));
      editor.values.weeklyGoals=record?.weeklyGoals || [];
      editor.customWeeks=Boolean(record?.customWeeks);
      editor.reason=record?.reason || ""; editor.effectiveDate=record?.effectiveDate?.slice(0,10) || `${scope.period}-01`;
      editor.revision=saved?.revision || 0;
      editor.message= saved?.draft ? "Loaded saved draft" : saved?.approved ? "Loaded approved goals" : recovered ? "Recovered browser values. Save to shared ATLAS to preserve them." : "No saved goals. Starting from current recommendations.";
      editor.sourceRecord=record || null;
    }
    editor.recommended=recommendation;
    // Recommendation history is independent: it never changes the human goal revision.
    const api=atlasCommunityGoalStore.module;
    const changed=!saved?.recommended || COMMUNITY_GOAL_FIELDS.some(key=>saved.recommended[key]!==recommendation[key]);
    if (changed) {
      try {
        const result=await api.saveGoals(context.central,{communityId:scope.communityId,period:scope.period,kind:"recommended",expectedRevision:saved?.recommendationRevision||0,requestId:crypto.randomUUID(),payload:{...recommendation,reason:"ATLAS recommendation recalculated",effectiveDate:`${scope.period}-01`},signal:context.signal});
        if (!current()) return;
        atlasCommunityGoalStore.scopes.set(scope.key,mergeCommunityCommandGoalScope(result,atlasCommunityGoalStore.scopes.get(scope.key)));
      } catch (error) {if(current())editor.recommendationError="Current recommendation could not be archived: "+error.message;}
    }
  } catch (error) {if(current()){editor.error="Goals could not be loaded: "+error.message;editor.loadFailed=true;}}
  finally {if(current()){editor.loading=false;if(communityCommandGoalEditor===editor)renderTab();}}
}

function cancelCommunityCommandGoalEditor() {
  if(communityCommandGoalEditor?.saving)return;
  if(communityCommandGoalEditor && !communityCommandGoalEditor.dirty)communityCommandGoalBuffers.delete(communityCommandGoalEditor.key);
  communityCommandGoalEditor=null;renderTab();
}

function renderCommunityCommandGoalEditor(model) {
  const editor=communityCommandGoalEditor;
  if(!editor || editor.propName!==model.propName || editor.year!==model.year || editor.viewMonthIdx!==model.monthIdx)return "";
  const fields={requiredMoveIns:"Required Move-Ins",applicationGoal:"Applications",grossLeaseGoal:"Gross Leases",netLeaseGoal:"Net Leases",occupancyGoal:"Physical Occupancy %",leasedGoal:"Leased Occupancy %",economicGoal:"Economic Occupancy %",renewalGoal:"Renewal Conversion %"};
  const disabled=editor.loading||editor.saving||editor.loadFailed;
  return `<section style="margin:16px 0" aria-label="Edit goals"><h3>Edit Goals · ${escapeHtml(FULL_MONTHS[editor.monthIdx])} ${editor.year}</h3><p role="status">${escapeHtml(editor.loading?"Reading saved goals…":editor.saving?"Saving goals…":editor.message||"")}</p>${editor.error?`<p role="alert" class="alert-red">${escapeHtml(editor.error)} Your edits are retained.</p>`:""}${editor.recommendationError?`<p>${escapeHtml(editor.recommendationError)}</p>`:""}<p>Physical occupancy measures occupied homes. Reaching a physical target requires move-ins after accounting for move-outs; signed leases alone do not meet it.</p><fieldset ${disabled?"disabled":""} style="border:0;padding:0"><div class="community-command-scroll"><table class="community-command-plan-table"><thead><tr><th>Metric</th><th>Current recommendation</th><th>Your goals</th></tr></thead><tbody>${Object.entries(fields).map(([key,label])=>`<tr><td>${label}</td><td>${communityCommandFormatNumber(editor.recommended[key],["occupancyGoal","leasedGoal","economicGoal","renewalGoal"].includes(key)?2:0)}</td><td><input id="cc-goal-${key}" aria-label="${label}" type="number" min="0" ${["occupancyGoal","leasedGoal","economicGoal","renewalGoal"].includes(key)?'max="100" step="0.01"':'step="1"'} oninput="updateCommunityCommandGoalEditor()" value="${escapeHtml(editor.values[key]??"")}"></td></tr>`).join("")}</tbody></table></div><label>Adjustment reason<textarea id="cc-goal-reason" required oninput="updateCommunityCommandGoalEditor()">${escapeHtml(editor.reason)}</textarea></label><label>Effective date<input id="cc-goal-effective" type="date" value="${escapeHtml(editor.effectiveDate)}" onchange="updateCommunityCommandGoalEditor()"></label>${renderCommunityCommandWeeklyEditor(editor)}</fieldset><div class="data-import2-inline-actions"><button class="btn btn-gray" ${disabled?"disabled":""} onclick="saveCommunityCommandGoalEditor(false)">Save as Draft</button><button class="btn btn-blue" ${disabled?"disabled":""} onclick="saveCommunityCommandGoalEditor(true)">Approve Goals</button>${editor.loadFailed?'<button class="btn btn-gray" onclick="approveCommunityCommandMonthlyGoals(communityCommandGoalEditor.monthIdx)">Retry loading goals</button>':""}<button class="btn btn-gray" ${editor.saving?"disabled":""} onclick="cancelCommunityCommandGoalEditor()">Close</button></div></section>`;
}

async function saveCommunityCommandGoalEditor(approve) {
  const context=syncCommunityCommandGoalContext();
  const current=()=>context.current() && atlasCommunityGoalStore.context===context;
  if(!current())return;
  updateCommunityCommandGoalEditor();
  const editor=communityCommandGoalEditor;
  if(!editor||editor.loading||editor.saving||editor.loadFailed||!communityCommandCanApproveGoals()||getProp().name!==editor.propName)return;
  const values={...editor.values},reason=editor.reason.trim(),effectiveDate=editor.effectiveDate;
  const fail=message=>{editor.error=message;editor.message="";renderTab();};
  if(!reason||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||!Number.isFinite(Date.parse(effectiveDate))){fail("A reason and valid effective date are required.");return;}
  const counts=[values.requiredMoveIns,values.applicationGoal,values.grossLeaseGoal,values.netLeaseGoal];
  const percentages=[values.occupancyGoal,values.leasedGoal,values.economicGoal,values.renewalGoal];
  if(counts.some(v=>v!==null&&(!Number.isInteger(v)||v<0))||percentages.some(v=>v!==null&&(v<0||v>100))){fail("Goals must be nonnegative whole counts or percentages from 0 to 100.");return;}
  if(approve&&(counts.some(v=>v===null)||values.netLeaseGoal>values.grossLeaseGoal||values.grossLeaseGoal>values.applicationGoal)){fail("Complete every production goal; applications must cover gross leases, and gross leases must cover net leases.");return;}
  const model=buildCommunityCommandModel(editor.propName,getCurrentCommunityRecord());
  const row=buildCommunityCommandLeasingPlanRows(model)[editor.monthIdx];
  const mappingIssues=(dataImport2State.exceptions||[]).some(issue=>issue.communityName===editor.propName&&issue.status!=="Resolved"&&["unmapped","conflict","held"].includes(issue.type));
  if(approve&&(row.occupancy.beginningUnits===null||mappingIssues||row.occupancy.warnings.some(warning=>!warning.startsWith("Approved plan:")))){fail("Approval held: resolve beginning occupancy, reconciliation warnings, and source mappings first.");return;}
  const {count,startDay}=communityCommandGoalWeeks(editor);
  const weekly=Array.from({length:count},(_,i)=>({week:i+1,startDay:startDay+i*7,...Object.fromEntries(["applicationGoal","grossLeaseGoal","netLeaseGoal"].map(key=>[key,communityCommandWeeklyAllocation(values[key],count)[i]??null]))}));
  if(editor.customWeeks){
    for(const key of ["applicationGoal","grossLeaseGoal","netLeaseGoal"]){const edited=editor.values.weeklyGoals?.map(w=>w[key])||[];if(edited.length!==count||edited.some(v=>!Number.isInteger(v)||v<0)||edited.reduce((sum,v)=>sum+v,0)!==values[key]){fail("Each weekly breakdown must total exactly to its monthly goal.");return;}}
    weekly.splice(0,weekly.length,...editor.values.weeklyGoals);
  }
  const payload={...values,weeklyGoals:weekly,customWeeks:editor.customWeeks,reason,effectiveDate,recommended:editor.recommended,sourceVersion:JSON.stringify({beginning:row.occupancy.lineage,inputs:row.occupancy.inputs})};
  const kind=approve?"approved":"draft",fingerprint=JSON.stringify({kind,payload});
  if(editor.requestFingerprint!==fingerprint){editor.requestId=crypto.randomUUID();editor.requestFingerprint=fingerprint;}
  editor.requestId ||= crypto.randomUUID();editor.saving=true;editor.error="";renderTab();
  try{
    const result=await atlasCommunityGoalStore.module.saveGoals(context.central,{communityId:editor.communityId,period:editor.period,kind,expectedRevision:editor.revision,requestId:editor.requestId,payload,signal:context.signal});
    if(!current())return;
    atlasCommunityGoalStore.scopes.set(editor.key,mergeCommunityCommandGoalScope(result,atlasCommunityGoalStore.scopes.get(editor.key)));
    editor.revision=result.revision;editor.values={...result.savedRecord};editor.dirty=false;editor.requestId=null;editor.requestFingerprint=null;
    const record=result.savedRecord;
    editor.message=`${approve?"Goals approved":"Draft saved"} · ${record.revisedAt||record.approvedAt||"Persistence verified"}`;
    if(communityCommandGoalBuffers.get(editor.key)===editor)communityCommandGoalBuffers.delete(editor.key);
    communityCommandGoalNotices.set(editor.key,editor.message);
    // Every consumer now resolves the same scoped canonical approval; local workspace imports cannot replace it.
    atlasBonusNavigationSnapshot=null;atlasBonusSectionCache.clear();
    window.dispatchEvent(new CustomEvent("atlas-community-goals-changed",{detail:{communityId:editor.communityId,period:editor.period,revision:result.revision}}));
    renderPropGrid();
  }catch(error){if(current()){editor.error=`${approve?"Approval":"Draft save"} failed: ${error.message||error}`;editor.message="";editor.dirty=true;if(!communityCommandGoalBuffers.has(editor.key)||communityCommandGoalBuffers.get(editor.key)===editor)communityCommandGoalBuffers.set(editor.key,editor);}}
  finally{if(current()){editor.saving=false;if(communityCommandGoalEditor===editor)renderTab();}}
}
