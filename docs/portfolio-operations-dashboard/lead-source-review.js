function dataImportLeadMappingFingerprint(rules = dataImport2State.mappingRules) {
  return JSON.stringify((rules || []).filter(r=>r.sharedLeadMapping).map(r=>[r.id,r.mappingVersion,r.canonicalField,r.originalField,r.sourceSystem,r.reportType,r.scope,r.supersededBy]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}

async function previewDataImportLeadHistory(itemId, archiveId) {
  if (!dataImportCanManageArchitecture() || dataImportApprovalInProgress) return;
  const item = dataImportFindMappingReviewItem(itemId);
  const archive = (dataImport2State.sourceArchive || []).find(entry=>entry.id===archiveId && entry.reportType === "box_score" && entry.importStatus === "Approved");
  if (!item?.sharedLeadMapping || !archive) { alert("Select an approved Box Score archive and a saved shared mapping first."); return; }
  try {
    await refreshDataImportSharedLeadMappings();
    const stored = await atlasStateGetValue(`${DATA_IMPORT_FILE_ARCHIVE_PREFIX}${archiveId}`);
    if (!stored?.blob) throw new Error("The original archived source is unavailable in this session.");
    const file = new File([stored.blob],stored.fileName || archive.fileName,{type:stored.type});
    const plan = await dataImportBuildFilePlan(file,{forceReportType:"box_score"});
    if (!archive.fileHash || plan.fileHash !== archive.fileHash) throw new Error("The source hash does not match the approved archive.");
    plan.sourceSystem = archive.sourceSystem;
    plan.reprocessArchivedSource = true;
    const lookups = {aliases:dataImportBuildAliasLookup(),internalIds:dataImportBuildInternalCommunityLookup()};
    const rows = [], held = [], identities = new Set();
    const targets = {walk_in:"walkIn",off_site_event:"offSiteEvent",phone_calls:"phoneCalls",emails_online:"emailsOnline",text_chat_other:"textChatOther"};
    for (const sheet of await dataImportReadStructuredRows(file,plan)) for (const source of sheet.rows) {
      if (!source.leadComponents?.some(c=>window.AtlasLeadSources.normalize(c.label) === window.AtlasLeadSources.normalize(item.originalField))) continue;
      const {mapped} = dataImportMapSourceRow(source,plan);
      const community = dataImportResolveRowCommunity(mapped,source,plan,lookups);
      const period = dataImportRowPeriod(mapped,source,plan);
      const mix = mapped.__leadSourceMix;
      if (!community || !savedData[community] || !period.periodKey || !mix || !/^\d{4}-\d{2}$/.test(period.periodKey)) { held.push(`${sheet.sheetName}: community or period evidence missing`); continue; }
      const identity = `${community}:${period.periodKey}`;
      if (identities.has(identity)) throw new Error(`Multiple source representations exist for ${identity}. Resolve them before reprocessing.`);
      identities.add(identity);
      const precedence = {issues:[]};
      const sourceTime = plan.metadata?.dataAsOf || plan.dataDateIso || "";
      if ((dataImport2State.closedPeriods || []).includes(period.periodKey) || !window.AtlasLeadSources.fields.every(field=>dataImportShouldApplyCurrentMetric(plan,community,period.periodKey,field,sourceTime,precedence))) {
        held.push(`${identity}: closed period or newer controlling source`); continue;
      }
      const copy = JSON.parse(JSON.stringify(savedData[community]));
      const entries = getWritableMonthlyPeriodEntries(copy,period.monthIdx,period.year);
      const before = Object.fromEntries(Object.values(targets).map(field=>[field,entries.historyEntry[field] ?? null]));
      rows.push({community,period,before,after:mix,sourceFile:archive.fileName,sourceSheet:source.sourceSheet,sourceRow:source.sourceRow,importVersion:archive.batchId,fileHash:archive.fileHash});
    }
    window.atlasLeadHistoryPreview = {itemId,archiveId,rows,held,targets,
      sourceFingerprint:JSON.stringify(savedData),mappingFingerprint:dataImportLeadMappingFingerprint()};
    dataImport2State.selectedMappingPreviewId = itemId;
    renderTab();
  } catch(error) { alert(`Historical preview unavailable: ${error.message}`); }
}

function renderDataImportLeadHistoryPreview(itemId) {
  const preview = window.atlasLeadHistoryPreview;
  if (!preview || preview.itemId !== itemId) return "";
  return `<section><h3>Historical reprocessing preview</h3><p>${preview.rows.length} community-month records will change only their five lead-source buckets and mapping evidence. Source controls remain unchanged.</p>
    <div style="overflow:auto"><table class="data-import2-table"><thead><tr><th>Community / period</th><th>Current buckets</th><th>Proposed buckets</th><th>Source control / variance</th><th>Lineage</th></tr></thead><tbody>${preview.rows.map(row=>`<tr><td>${escapeHtml(row.community)}<br>${escapeHtml(row.period.periodKey)}</td><td>${escapeHtml(JSON.stringify(row.before))}</td><td>${escapeHtml(JSON.stringify(row.after.buckets))}</td><td>${escapeHtml(JSON.stringify(row.after.controls.map(c=>({label:c.label,value:c.rawValue,variance:c.variance}))))}</td><td>${escapeHtml(row.sourceFile)}<br>${escapeHtml(row.sourceSheet)} · row ${escapeHtml(row.sourceRow)}<br>${escapeHtml(row.importVersion)}</td></tr>`).join("")}</tbody></table></div>
    ${preview.held.length ? `<p>Held: ${escapeHtml(preview.held.join("; "))}</p>` : ""}
    <button class="btn btn-blue btn-sm" onclick="approveDataImportLeadHistory()" ${preview.rows.length ? "" : "disabled"}>Approve historical reprocessing</button>
    <button class="btn btn-gray btn-sm" onclick="cancelDataImportLeadHistory()">Cancel historical reprocessing</button></section>`;
}

function cancelDataImportLeadHistory() {
  window.atlasLeadHistoryPreview = null;
  renderTab();
}

async function approveDataImportLeadHistory() {
  const preview = window.atlasLeadHistoryPreview;
  if (!dataImportCanManageArchitecture() || dataImportApprovalInProgress || !preview?.rows.length) return;
  if (preview.sourceFingerprint !== JSON.stringify(savedData) || preview.mappingFingerprint !== dataImportLeadMappingFingerprint()) {
    alert("Data or mappings changed after preview. Generate a new preview before approving."); return;
  }
  const beforeImport = JSON.stringify(dataImport2State);
  let mutated = false;
  dataImportApprovalInProgress = true;
  try {
    const shared = await window.atlasLeadMappingSession.load();
    if (preview.mappingFingerprint !== dataImportLeadMappingFingerprint(shared.rules)) throw new Error("Shared mappings changed after preview. Refresh and preview again.");
    if (preview.sourceFingerprint !== JSON.stringify(savedData)) throw new Error("Community data changed after preview. Preview again.");
    const revision = {id:dataImportMakeId("lead-history"),changedBy:atlasCurrentUserDisplayName(),changedAt:new Date().toISOString(),archiveId:preview.archiveId,rows:[]};
    mutated = true;
    for (const row of preview.rows) {
      const record = savedData[row.community];
      const entries = getWritableMonthlyPeriodEntries(record,row.period.monthIdx,row.period.year);
      const slots = [entries.historyEntry,entries.liveEntry].filter(Boolean);
      revision.rows.push({...row,beforeSlots:slots.map(slot=>Object.fromEntries([...Object.values(preview.targets),"leadSourceReconciliation"].map(field=>[field,{present:Object.hasOwn(slot,field),value:slot[field] ?? null}])))});
      for (const slot of slots) {
        for (const [field,storedField] of Object.entries(preview.targets)) slot[storedField] = row.after.buckets[field];
        slot.leadSourceReconciliation = {...row.after,communityName:row.community,period:row.period.periodKey,sourceFile:row.sourceFile,sourceSheet:row.sourceSheet,sourceRow:row.sourceRow,importVersion:row.importVersion,historicalRevision:revision.id};
      }
    }
    dataImport2State.leadSourceHistoricalRevisions = [revision,...(dataImport2State.leadSourceHistoricalRevisions || [])];
    await persistDataImportPublication();
    window.atlasLeadHistoryPreview = null;
    loadPropertyData(getProp().name);
    alert(`Historical lead-source reprocessing saved for ${revision.rows.length} community-month records. Prior values are retained in revision ${revision.id}.`);
  } catch(error) {
    if (mutated) {
      savedData = JSON.parse(preview.sourceFingerprint);
      dataImport2State = JSON.parse(beforeImport);
    }
    alert(`Historical reprocessing stopped: ${error.message}`);
  } finally { dataImportApprovalInProgress = false; renderTab(); }
}

function dataImportLeadMappingEvidence(item, destination) {
  const contract = window.AtlasLeadSources;
  const results = [];
  for (const record of dataImport2State.canonicalRecords || []) {
    if (record.reportType !== "box_score" || !/^lead activity/i.test(record.section || "")) continue;
    const context = {sourceSystem:record.sourceSystem,reportType:record.reportType,section:record.section};
    const components = record.leadSourceEvidence?.length ? record.leadSourceEvidence : Object.entries(record.originalValues || {})
      .filter(([label]) => contract.classify(label,context).field)
      .map(([label,value]) => ({id:`${record.sourceRow}:${label}`,label,value}));
    const matching = components.filter(c => contract.normalize(c.label) === contract.normalize(item.originalField));
    if (!matching.length) continue;
    const controls = record.leadSourceControls?.length ? record.leadSourceControls : Object.entries(record.originalValues || {})
      .filter(([label]) => ["new leads","total guest cards","guest cards"].includes(contract.normalize(label))).map(([label,value])=>({label,value}));
    const proposed = components.map(c => {
      const active = dataImportFindSavedRuleForHeader(c.label,{...context,...c.context});
      return {...c,destination:contract.normalize(c.label) === contract.normalize(item.originalField) ? destination : active?.sharedLeadMapping ? active.canonicalField : undefined,
        mappingVersion:active?.mappingVersion || contract.version};
    });
    const after = contract.aggregate(proposed,context,controls);
    results.push({record,components,after});
  }
  return results;
}

function renderDataImportLeadMappingEvidence(item, destination) {
  const results = dataImportLeadMappingEvidence(item,destination);
  if (!results.length) return `<p>No qualified archived contact-source rows are available for a numeric preview. Upload a representative Box Score before approving a lead-source change.</p>`;
  return `<p>${new Set(results.map(r=>r.record.communityName)).size} communities · ${new Set(results.map(r=>r.record.periodKey)).size} periods · ${results.length} historical source rows eligible for separate reprocessing. Historical rows changed by this save: 0.</p>
    <div style="overflow:auto"><table class="data-import2-table"><thead><tr><th>Community / period</th><th>Source / lineage</th><th>Source components</th><th>Stored values</th><th>Proposed buckets</th><th>Control / variance</th></tr></thead><tbody>${results.map(({record,components,after})=>`<tr>
    <td>${escapeHtml(record.communityName)}<br>${escapeHtml(record.periodKey)}</td>
    <td>${escapeHtml(record.sourceFile)}<br>${escapeHtml(record.sourceSheet)} · row ${escapeHtml(record.sourceRow)}<br>Import ${escapeHtml(record.batchId)} · mapping ${escapeHtml(record.mappingVersion || "legacy")}</td>
    <td>${components.map(c=>`${escapeHtml(c.label)}: ${escapeHtml(c.value ?? "Missing")}`).join("<br>")}</td>
    <td>${window.AtlasLeadSources.fields.map(f=>`${escapeHtml(dataImportMappingDestinationLabel(f))}: ${escapeHtml(record.values?.[f] ?? "Missing")}`).join("<br>")}</td>
    <td>${Object.entries(after.buckets).map(([f,v])=>`${escapeHtml(dataImportMappingDestinationLabel(f))}: ${escapeHtml(v ?? "Missing")}`).join("<br>")}</td>
    <td>${after.controls.map(c=>`${escapeHtml(c.label)}: ${escapeHtml(c.rawValue ?? "Missing")} · variance ${escapeHtml(c.variance ?? "Unavailable")}`).join("<br>")}<br>${escapeHtml(after.status)}</td></tr>`).join("")}</tbody></table></div>`;
}

async function refreshDataImportSharedLeadMappings() {
  const client = window.ATLAS_CENTRAL;
  if (!client?.readDocument || !getAtlasCentralStatus().signedIn) throw new Error("Sign in to load shared lead-source mappings.");
  if (!["admin","executive"].includes(getAtlasCentralStatus().role)) throw new Error("This account cannot read the shared mapping document. An ATLAS administrator must grant access before importing lead sources.");
  window.atlasLeadMappingSession ||= window.AtlasLeadMappingStore.create(client);
  const shared = await window.atlasLeadMappingSession.load();
  const sharedIds = new Set((shared.rules || []).map(r=>r.id));
  dataImport2State.mappingRules = [...(shared.rules || []),...(dataImport2State.mappingRules || []).filter(r=>!sharedIds.has(r.id) && !r.sharedLeadMapping)];
  const events = new Map([...(dataImport2State.mappingAuditTrail || []),...(shared.history || [])].map(e=>[e.id,e]));
  dataImport2State.mappingAuditTrail = [...events.values()];
  persistDataImport2State();
}

async function rollbackDataImportMappingVersion(eventId) {
  const event = (dataImport2State.mappingAuditTrail || []).find(e=>e.id===eventId);
  if (!event?.previousRule) { alert("This change has no previous rule to restore."); return; }
  const item = dataImportFindMappingReviewItem(`rule_${event.newRule.id}`);
  if (!item) return;
  dataImport2State.mappingDrafts[item.id] = event.previousRule.canonicalField;
  previewDataImportMappingItem(item.id);
}



function dataImportUpsertMappingRuleFromItem(item = {}, canonicalField = "", options = {}) {
  if (window.atlasLeadMappingSaveInProgress) return false;
  if (!dataImportCanManageArchitecture()) { alert("An authorized mapping manager is required."); return false; }
  if (!item.originalField || !canonicalField) return false;
  if ((item.sharedLeadMapping || window.AtlasLeadSources?.fields.includes(canonicalField) || window.AtlasLeadSources?.fields.includes(item.currentField)) && !options.leadPreviewApproved) {
    alert("Use Preview and Save on this source row to approve a shared lead-source mapping."); return false;
  }
  if (canonicalField === "__ignore_import__") {
    alert("Ignore for This Import is available while reviewing a live import. It does not create a reusable mapping rule.");
    return false;
  }
  if (canonicalField === "__always_ignore__") canonicalField = "__ignored__";
  if (canonicalField === "__create_custom__") {
    dataImport2State.selectedMappingPreviewId = item.id;
    alert("Open Create New ATLAS Field below, define the field, and ATLAS will return it to this mapping.");
    return false;
  }
  if (!dataImportDestinationExists(canonicalField)) {
    alert("This destination is not registered in ATLAS. Choose an existing destination or create a new ATLAS field first.");
    return false;
  }
  const contextualMatch = (dataImport2State.mappingRules || []).find(rule =>
    !rule.locked
    && dataImportNormalizeText(rule.originalField) === dataImportNormalizeText(item.originalField)
    && dataImportNormalizeText(rule.sourceSystem || "Global") === dataImportNormalizeText(item.sourceSystem || "Global")
    && dataImportNormalizeText(rule.reportType || "") === dataImportNormalizeText(item.reportType || "")
  );
  const priorDestination = item.currentField || contextualMatch?.canonicalField || "";
  const destinationChanged = priorDestination && priorDestination !== canonicalField;
  if (destinationChanged && !options.skipLiveConfirm) {
    const impacted = Array.from(new Set([...dataImportDestinationModules(priorDestination), ...dataImportDestinationModules(canonicalField)])).slice(0, 6);
    const warning = impacted.length
      ? `Changing this mapping may affect: ${impacted.join(", ")}. Continue?`
      : "Changing this mapping may affect live reporting. Continue?";
    if (!confirm(warning)) return false;
  }
  const now = new Date().toISOString();
  const existingRule = item.ruleId ? (dataImport2State.mappingRules || []).find(rule => rule.id === item.ruleId) : null;
  const editableMatch = !existingRule || existingRule.locked
    ? contextualMatch
    : existingRule;
  const priorRule = editableMatch || existingRule || (options.leadPreviewApproved && priorDestination ? {
    originalField:item.originalField, canonicalField:priorDestination,
    sourceSystem:item.sourceSystem, reportType:item.reportType,
    mappingVersion:window.AtlasLeadSources.version, scope:"Exact Source + Report"
  } : null);
  const reason = options.reason ?? (destinationChanged ? "Admin override" : canonicalField === "__ignored__" ? "Field intentionally ignored" : "Mapping approved");
  const confirmationCount = Number(editableMatch?.confirmationCount || 0) + (options.learningConfirmation ? 1 : 0);
  const overrideCount = Number(editableMatch?.overrideCount || 0) + (destinationChanged ? 1 : 0);
  const confidence = canonicalField === "__ignored__"
    ? 100
    : options.learningConfirmation
      ? Math.min(99, Math.max(97, Number(editableMatch?.confidence || 0) + 2))
      : Number(item.confidence || editableMatch?.confidence || 80);
  const learningStatus = canonicalField === "__ignored__"
    ? "Permanently Ignored"
    : options.locked || editableMatch?.locked
      ? "Locked"
      : dataImportLearningStatus(confirmationCount, Number(editableMatch?.successfulUses || 0));
  const mappingVersion = dataImportMakeId("mappingversion");
  const changedBy = atlasCurrentUserDisplayName();
  const nextRule = {
    mappingVersion,
    previousMappingVersion: priorRule?.mappingVersion || priorRule?.id || "",
    id: editableMatch?.id || dataImportMakeId("map"),
    originalField: item.originalField,
    canonicalField,
    sourceSystem: item.sourceSystem || editableMatch?.sourceSystem || "Global",
    reportType: item.reportType || editableMatch?.reportType || "",
    sourceFile: item.sourceFile || editableMatch?.sourceFile || "",
    sheetName: item.sheetName || editableMatch?.sheetName || "",
    sampleValue: item.sampleValue ?? editableMatch?.sampleValue ?? "",
    detectedDataType: item.detectedDataType || editableMatch?.detectedDataType || "",
    scope: options.leadPreviewApproved ? "Exact Source + Report" : options.scope || editableMatch?.scope || "Exact Source + Report",
    status: canonicalField === "__ignored__" ? "Ignored" : "Mapped",
    confidence,
    suggestedField: item.suggestedField || editableMatch?.suggestedField || canonicalField,
    savedBy: editableMatch?.savedBy || "Admin",
    savedAt: editableMatch?.savedAt || now,
    updatedBy: changedBy,
    updatedAt: now,
    locked: options.locked === true || editableMatch?.locked === true,
    sourceFilePattern: dataImportSourceFilePattern(item.sourceFile || editableMatch?.sourceFile || ""),
    propertyName: item.propertyName || editableMatch?.propertyName || "",
    region: item.region || editableMatch?.region || "",
    confirmationCount,
    successfulUses: Number(editableMatch?.successfulUses || 0),
    overrideCount,
    lastUsedAt: editableMatch?.lastUsedAt || "",
    learningStatus,
    createdBy: editableMatch?.createdBy || atlasCurrentUserDisplayName() || "Admin",
    createdAt: editableMatch?.createdAt || now
  };
  if (options.leadPreviewApproved) {
    const normalizedAlias = window.AtlasLeadSources.normalize(item.originalField);
    dataImport2State.mappingRules = (dataImport2State.mappingRules || []).map(rule =>
      rule.id !== editableMatch?.id && window.AtlasLeadSources.normalize(rule.originalField) === normalizedAlias && rule.sourceSystem === nextRule.sourceSystem && rule.reportType === nextRule.reportType
        ? {...rule,supersededBy:mappingVersion,learningStatus:"Superseded"} : rule);
  }
  if (editableMatch) {
    dataImport2State.mappingRules = (dataImport2State.mappingRules || []).map(rule => rule.id === editableMatch.id ? nextRule : rule);
  } else {
    dataImport2State.mappingRules = [nextRule, ...(dataImport2State.mappingRules || [])];
  }
  dataImport2State.mappingAuditTrail = [{
    id: dataImportMakeId("mapaudit"),
    changedAt: now,
    changedBy,
    previousMappingVersion: priorRule?.mappingVersion || priorRule?.id || "",
    newMappingVersion: mappingVersion,
    previousRule: priorRule ? JSON.parse(JSON.stringify(priorRule)) : null,
    newRule: JSON.parse(JSON.stringify(nextRule)),
    effect: "future_imports_only",
    sourceField: item.originalField,
    previousDestination: priorDestination,
    newDestination: canonicalField,
    sourceSystem: item.sourceSystem || "Global",
    reportType: item.reportType || "",
    sourceFile: item.sourceFile || "",
    uploadBatch: item.uploadBatch || "",
    reason,
    downstreamModules: dataImportDestinationModules(canonicalField, item.downstreamModules || [])
  }, ...(dataImport2State.mappingAuditTrail || [])];
  delete dataImport2State.mappingDrafts?.[item.id];
  dataImport2State.selectedMappingIds = (dataImport2State.selectedMappingIds || []).filter(id => id !== item.id);
  dataImport2State.selectedMappingPreviewId = "";
  return true;
}

async function saveDataImportMappingReviewItem(itemId) {
  if (window.atlasLeadMappingSaveInProgress) return;
  const item = dataImportFindMappingReviewItem(itemId);
  if (!item) return;
  const destination = dataImportSelectedDestinationForItem(item);
  if (!destination) {
    alert("Choose a destination before saving this mapping.");
    return;
  }
  if (dataImport2State.selectedMappingPreviewId !== itemId) { previewDataImportMappingItem(itemId); return; }
  const reason = document.getElementById("data-import-mapping-reason")?.value || "";
  const leadChange = item.sharedLeadMapping || window.AtlasLeadSources?.fields.includes(destination) || window.AtlasLeadSources?.fields.includes(item.currentField);
  if (leadChange && getAtlasCentralStatus().role !== "admin") { alert("Shared lead-source mapping changes require an ATLAS administrator."); return; }
  if (leadChange && !dataImportLeadMappingEvidence(item,destination).length) { alert("A qualified source preview is required before saving a lead-source classification."); return; }
  if (leadChange && !window.atlasLeadMappingSession) { alert("Load shared mappings, then preview again before saving."); return; }
  const before = JSON.parse(JSON.stringify({mappingRules:dataImport2State.mappingRules,mappingAuditTrail:dataImport2State.mappingAuditTrail}));
  if (dataImportUpsertMappingRuleFromItem(item, destination, {reason,leadPreviewApproved:leadChange})) {
    window.atlasLeadMappingSaveInProgress = true;
    try {
      if (leadChange) {
        const event = dataImport2State.mappingAuditTrail[0];
        const rule = dataImport2State.mappingRules.find(r=>r.id===event.newRule.id);
        rule.sharedLeadMapping = true;
        rule.learningStatus = "Trusted";
        rule.confidence = 100;
        event.newRule = JSON.parse(JSON.stringify(rule));
        await window.atlasLeadMappingSession.save({rules:dataImport2State.mappingRules.filter(r=>r.sharedLeadMapping),history:dataImport2State.mappingAuditTrail.filter(e=>e.newRule?.id && dataImport2State.mappingRules.some(r=>r.sharedLeadMapping && r.id===e.newRule.id))});
      }
      persistDataImport2State();
      dataImport2State.selectedMappingPreviewId = `rule_${dataImport2State.mappingAuditTrail[0].newRule.id}`;
    } catch (error) {
      Object.assign(dataImport2State,before);
      alert(error.message);
    } finally { window.atlasLeadMappingSaveInProgress = false; }
    renderTab();
  }
}

function renderDataImportMappingPreview() {
  const item = dataImportFindMappingReviewItem(dataImport2State.selectedMappingPreviewId);
  if (!item) return "";
  const destination = dataImportSelectedDestinationForItem(item);
  const modules = dataImportDestinationModules(destination, item.downstreamModules || []);
  return `<div class="data-import2-preview-panel" style="grid-column:1 / -1">
    <div class="data-import2-section-title"><i class="ph ph-eye"></i>Proposed Mapping</div>
    <div class="data-import2-preview-cols">
      <div><div class="data-import2-small-label">Source</div><strong>${escapeHtml(item.originalField)}</strong><div class="data-import2-review-meta">${escapeHtml(item.sourceSystem)} → ${escapeHtml(item.reportTypeLabel)}<br>${escapeHtml(item.sourceFile)} · ${escapeHtml(item.sheetName)}</div></div>
      <div><div class="data-import2-small-label">Destination</div><strong>${escapeHtml(dataImportDestinationCategory(destination))}</strong><div class="data-import2-review-meta">${escapeHtml(dataImportMappingDestinationLabel(destination || "Choose destination"))}</div></div>
      <div><div class="data-import2-small-label">Example Incoming Value</div><strong>${escapeHtml(item.sampleValue === 0 ? "0" : (item.sampleValue || "No sample captured"))}</strong><div class="data-import2-review-meta">${escapeHtml(item.detectedDataType || "Type not detected")}</div></div>
      <div><div class="data-import2-small-label">Downstream Impact</div><div class="data-import2-review-meta">${escapeHtml(modules.slice(0, 6).join(", ") || "No live module dependency configured yet.")}</div></div>
    </div>
    ${(item.sharedLeadMapping || window.AtlasLeadSources?.fields.includes(item.currentField) || window.AtlasLeadSources?.fields.includes(destination)) ? renderDataImportLeadMappingEvidence(item,destination) : ""}
    <p>Future imports only. Historical records remain unchanged. Historical reprocessing requires a separate preview and approval.</p>
    <p>Normalized alias: ${escapeHtml(dataImportNormalizeText(item.originalField))} · Current: ${escapeHtml(dataImportMappingDestinationLabel(item.currentField || "Unmapped"))}</p>
    ${(dataImport2State.mappingAuditTrail || []).filter(e=>e.newRule?.id === item.ruleId && e.previousRule).slice(0,1).map(e=>`<button class="btn btn-gray btn-sm" onclick='rollbackDataImportMappingVersion(${JSON.stringify(e.id)})'>Preview rollback to previous mapping</button>`).join("")}
    ${item.sharedLeadMapping && destination === item.currentField ? `<details><summary>Historical reprocessing (separate approval)</summary><select id="data-import-lead-history-archive"><option value="">Choose an approved source import</option>${(dataImport2State.sourceArchive || []).filter(a=>a.reportType === "box_score" && a.importStatus === "Approved").map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.fileName)} · ${escapeHtml(a.batchId)}</option>`).join("")}</select><button class="btn btn-gray btn-sm" onclick='previewDataImportLeadHistory(${JSON.stringify(item.id)}, document.getElementById("data-import-lead-history-archive").value)'>Preview historical reprocessing</button>${renderDataImportLeadHistoryPreview(item.id)}</details>` : ""}
    <label>Reason (optional)<input id="data-import-mapping-reason" type="text"></label>
    <div class="data-import2-inline-actions" style="margin-top:10px">
      <button class="btn btn-blue btn-sm" onclick='saveDataImportMappingReviewItem(${JSON.stringify(item.id)})'>Save Mapping</button>
      <button class="btn btn-gray btn-sm" onclick="cancelDataImportMappingPreview()">Cancel</button>
    </div>
  </div>`;
}

function dataImportLegacyLeadRow(row = {}, lineage = {}) {
  const names = {walk_in_leads:'Walk In',off_site_event_leads:'Off Site Event',call_leads:'Call',email_leads:'Email',online_leads:'Online',chat_leads:'Chat',text_leads:'Text',other_leads:'Other'};
  const components = [];
  for (const [field,label] of Object.entries(names)) components.push({id:`${lineage.sourceRow}:${field}`,label,value:row[field],...lineage,context:{contactSourceComponent:true}});
  for (const field of window.AtlasLeadSources.fields) if (Object.hasOwn(row,field)) components.push({id:`${lineage.sourceRow}:${field}`,label:field,value:row[field],...lineage});
  const source = {canonicalSource:true,section:'Lead Activity',values:{},leadComponents:components,
    leadControls:[{label:'New Leads',value:row.new_leads,...lineage}],...lineage};
  return dataImportMapSourceRow(source,{sourceSystem:'Entrata',reportType:'box_score',name:lineage.sourceFile}).mapped.__leadSourceMix;
}

function buildRonaldoLeadSourceMonthRow(row = {}, target = {}) {
  const mix = dataImportLegacyLeadRow(row,{sourceRow:target.sourceRow || 1,sourceFile:target.sourceFile || ''});
  return {...makeRonaldoBackfillRow(target,{guest_cards:mix.controls.find(c=>c.status==='valid')?.value ?? '',...mix.buckets,tours:window.AtlasLeadSources.count(row.first_visits_tours)}),__leadSourceMix:mix};
}

async function processRonaldoLeadSourceRows(workbook, fileName = '', options = {}, communityMap = {}) {
  await refreshDataImportSharedLeadMappings();
  const sheetName = workbook?.SheetNames?.[0];
  if (!sheetName) return {rows:[],notes:[]};
  const raw = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false});
  const headers = (raw[0] || []).map(normalizeAtlasColumnKey);
  const forced = getForcedImportTarget(options), groups = new Map(), notes = [];
  raw.slice(1).forEach((cells,index)=>{
    const row = Object.fromEntries(headers.map((key,i)=>[key,cells[i]]));
    const community = resolveRonaldoCommunityFromRow(row,communityMap,forced);
    const monthIdx = forced.monthIdx ?? parseAtlasMonthIndex(row.report_month);
    const yearMatch = String(row.report_month || '').match(/\b(20\d{2})\b/);
    const year = forced.year ?? (yearMatch ? Number(yearMatch[1]) : null);
    if (!community || !Number.isInteger(monthIdx) || !year) { notes.push(`Held source row ${index+2}: community or reporting period is missing.`); return; }
    const key = `${community}:${year}-${String(monthIdx+1).padStart(2,'0')}`;
    const group = groups.get(key) || {community,monthIdx,year,period:key.split(':').pop(),rows:[]};
    group.rows.push({row,sourceRow:index+2}); groups.set(key,group);
  });
  const rows = [];
  for (const group of groups.values()) {
    if (group.rows.length !== 1) { notes.push(`Held ${group.community} ${group.period}: multiple monthly representations require review.`); continue; }
    if ((dataImport2State.closedPeriods || []).includes(group.period)) { notes.push(`Held ${group.community} ${group.period}: reporting period is closed.`); continue; }
    const {row,sourceRow} = group.rows[0];
    const mix = dataImportLegacyLeadRow(row,{sourceRow,sourceFile:fileName,sourceSheet:sheetName,community:group.community,period:group.period});
    const original = getPropertyRecordForApply(group.community,{useCurrentRecord:false});
    if (!original) continue;
    const record = JSON.parse(JSON.stringify(original));
    const entries = getWritableMonthlyPeriodEntries(record,group.monthIdx,group.year);
    if (!entries) continue;
    if (entries.historyEntry.leadSourceReconciliation || window.AtlasLeadSources.storedFields.some(field=>entries.historyEntry[field] != null && entries.historyEntry[field] !== 0)) {
      notes.push(`Held ${group.community} ${group.period}: use the separate historical preview to replace approved lead sources.`); continue;
    }
    for (const field of window.AtlasLeadSources.fields) applyValueToRecord(record,group.monthIdx,field,mix.buckets[field],group.year);
    const control = mix.controls.find(c=>c.status==='valid');
    if (control) applyValueToRecord(record,group.monthIdx,'guest_cards',control.value,group.year);
    for (const slot of [entries.historyEntry,entries.liveEntry].filter(Boolean)) slot.leadSourceReconciliation={...mix,communityName:group.community,period:group.period,sourceFile:fileName,sourceSheet:sheetName,sourceRow,importVersion:new Date().toISOString()};
    savedData[group.community]=normalizeSavedCommunityRecord(group.community,record);
    rows.push({property:group.community,month:buildHistoricalMonthLabel(group.monthIdx,group.year),year:group.year,...mix.buckets,guest_cards:control?.value ?? null,__leadSourceMix:mix});
    if (mix.status !== 'reconciled') notes.push(`${group.community} ${group.period}: ${mix.status}; original evidence and missing values retained.`);
  }
  if (rows.length) {
    const result = persistSaved();
    if (result?.ok === false) throw new Error(result.message);
    if (rows.some(row=>row.property === getProp().name)) loadPropertyData(getProp().name);
    renderPropGrid();
  }
  notes.push(`Applied ${rows.length} community-month lead-source records using the shared contract.`);
  return {rows,notes};
}

function dataImportKnownLeadColumns(headers, cells, lineage = {}) {
  const aliases = {
    walk_in:'Walk In',walk_in_leads:'Walk In',lead_walk_ins:'Walk In',lead_walkins:'Walk In',
    off_site_event:'Off Site Event',off_site_event_leads:'Off Site Event',lead_off_site_event:'Off Site Event',lead_offsiteevent:'Off Site Event',
    phone_calls:'Phone Calls',call_leads:'Call',lead_calls:'Call',
    emails_online:'Emails / Online',lead_emails_online:'Emails / Online',email_leads:'Email',online_leads:'Online',
    text_chat_other:'Text / Chat / Other',lead_chat_text_other:'Text / Chat / Other',lead_chat_other:'Text / Chat / Other',chat_leads:'Chat',text_leads:'Text',other_leads:'Other'
  };
  const context={sourceSystem:'Entrata',reportType:'box_score',section:'Lead Activity'};
  const components=[],controls=[];
  headers.forEach((originalLabel,column)=>{
    const key=normalizeAtlasColumnKey(originalLabel),raw=cells[column];
    if (['new_leads','guest_cards','leads','traffic'].includes(key)) {controls.push({label:originalLabel,value:raw,column:column+1,...lineage});return;}
    const label=key.startsWith('original_contact_method_') ? key.slice(24).replaceAll('_',' ') : aliases[key] || (lineage.contactSourceMix && window.AtlasLeadSources.classify(originalLabel,context).field ? originalLabel : null);
    if (!label) return;
    components.push({id:`${lineage.sourceRow}:${column+1}`,label,originalLabel,value:raw,column:column+1,...lineage,context:{contactSourceComponent:key.startsWith('original_contact_method_')}});
  });
  if (!components.length) return null;
  return dataImportMapSourceRow({canonicalSource:true,section:context.section,values:{},leadComponents:components,leadControls:controls,...lineage},{...context,name:lineage.sourceFile}).mapped.__leadSourceMix;
}

function dataImportLeadCsvCells(text) {
  const rows=[],row=[];let value='',quoted=false;
  for(let i=0;i<String(text).length;i++){
    const ch=text[i];
    if(ch==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(ch===','&&!quoted){row.push(value);value='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(v=>v.trim()))rows.push([...row]);row.length=0;value='';}
    else value+=ch;
  }
  if(quoted)throw new Error('CSV contains an unclosed quoted field.');
  row.push(value);if(row.some(v=>v.trim()))rows.push(row);
  return rows;
}
