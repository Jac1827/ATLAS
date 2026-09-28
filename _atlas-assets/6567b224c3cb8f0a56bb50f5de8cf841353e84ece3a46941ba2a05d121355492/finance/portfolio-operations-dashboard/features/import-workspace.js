/* Lazy import presentation layer. Shared state, calculations and write handlers remain in the shell. */
function renderDataImportHero(health) {
  return `<section class="data-import2-hero">
    <div>
      <div class="data-import2-title">ATLAS Data Health</div>
      <div class="data-import2-copy">Raw Entrata and APTIQ reports move through detection, property matching, field mapping, validation, approval, archive, and dashboard refresh from one workspace.</div>
    </div>
    <div class="data-import2-kpis">
      <div class="data-import2-kpi"><div class="data-import2-kpi-label">Portfolio Health</div><div class="data-import2-kpi-value">${health.cells.length ? `${health.healthScore}%` : "N/A"}</div><div class="data-import2-kpi-sub">${health.activeCommunities.length} active communities · ${health.cells.length} required feeds${health.inactiveCommunities.length ? ` · ${health.inactiveCommunities.length} inactive below matrix` : ""}</div></div>
      <div class="data-import2-kpi"><div class="data-import2-kpi-label">Fully Current</div><div class="data-import2-kpi-value">${health.fullyCurrentCommunities}</div><div class="data-import2-kpi-sub">all required feeds fresh</div></div>
      <div class="data-import2-kpi"><div class="data-import2-kpi-label">Missing</div><div class="data-import2-kpi-value">${health.missingFeeds}</div><div class="data-import2-kpi-sub">feed gaps</div></div>
      <div class="data-import2-kpi"><div class="data-import2-kpi-label">Stale</div><div class="data-import2-kpi-value">${health.staleFeeds}</div><div class="data-import2-kpi-sub">outside SLA</div></div>
      <div class="data-import2-kpi"><div class="data-import2-kpi-label">Conflicts</div><div class="data-import2-kpi-value">${health.conflicts}</div><div class="data-import2-kpi-sub">need resolution</div></div>
      <div class="data-import2-kpi"><div class="data-import2-kpi-label">Last Import</div><div class="data-import2-kpi-value" style="font-size:0.9rem">${health.lastSuccessfulImport ? escapeHtml(health.lastSuccessfulImport.id) : "None"}</div><div class="data-import2-kpi-sub">${health.lastSuccessfulImport ? escapeHtml(dataImportFormatTimestamp(health.lastSuccessfulImport.approvedAt)) : "source archive empty"}</div></div>
    </div>
  </section>`;
}

function renderDataImportTabs() {
  const tabs = [
    ["overview", "ph-gauge", "Overview"],
    ["upload", "ph-upload-simple", "Upload Center"],
    ["health", "ph-heartbeat", "Data Health"],
    ["exceptions", "ph-warning-diamond", "Exceptions"],
    ["mapping", "ph-brain", "Import Learning"],
    ["aliases", "ph-map-pin", "Property Aliases"],
    ["history", "ph-clock-counter-clockwise", "Import History"],
    ["archive", "ph-archive", "Source Archive"]
  ];
  return `<div class="data-import2-tabs">${tabs.map(([key, icon, label]) =>
    `<button class="data-import2-tab${dataImport2State.activeView === key ? " active" : ""}" onclick="setDataImport2View('${key}')"><i class="ph ${icon}"></i>${label}</button>`
  ).join("")}</div>`;
}

function renderDataImportDropzone() {
  const period = getDataImportUploadPeriod();
  const currentYear = new Date().getFullYear();
  const years = Array.from(new Set([period.year, ...Array.from({length:22}, (_, i) => currentYear + 1 - i)])).sort((a,b) => b-a);
  return `<fieldset style="border:0;padding:0;margin:0 0 16px">
    <legend class="data-import2-section-title">Report period</legend>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <label class="data-import2-field"><span class="data-import2-small-label">Upload type</span><select aria-label="Upload type" onchange="dataImportUploadType = this.value; renderTab()"><option value="auto"${dataImportUploadType === "auto" ? " selected" : ""}>Detect automatically</option><option value="renewal_tracker"${dataImportUploadType === "renewal_tracker" ? " selected" : ""}>Renewal tracker — multiple months</option></select></label>
      ${dataImportUploadType === "renewal_tracker" ? `<label class="data-import2-field"><span class="data-import2-small-label">Tracker community</span><select aria-label="Tracker community" onchange="dataImportUploadCommunity = this.value"><option value="">Detect from document</option>${dataImportGetHealthCommunityNames().map(name => `<option value="${escapeHtml(name)}"${name === dataImportUploadCommunity ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>` : ""}
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <label class="data-import2-field"><span class="data-import2-small-label">Report month</span><select aria-label="Upload report month" ${dataImportUploadType === "renewal_tracker" ? "disabled" : ""} onchange="setDataImportUploadPeriod('monthIdx', this.value)">${FULL_MONTHS.map((name, i) => `<option value="${i}"${i === period.monthIdx ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>
      <label class="data-import2-field"><span class="data-import2-small-label">Report year</span><select aria-label="Upload report year" onchange="setDataImportUploadPeriod('year', this.value)">${years.map(year => `<option value="${year}"${year === period.year ? " selected" : ""}>${year}</option>`).join("")}</select></label>
      <button type="button" class="btn btn-gray btn-sm" onclick="dataImportUploadPeriod = null; renderTab()">Use current month</button>
    </div>
    <p class="data-import2-drop-copy">Single-month reports use the selected month and year. Renewal trackers are automatically reviewed across all expiration months for one community, including future months and years. An advance renewal stays with its agreement’s expiration month. The selected year is used only for month tabs without a year; explicit source dates take precedence. Changing this selection affects new uploads only.</p>
  </fieldset>
  <label class="data-import2-dropzone" ondrop="handleDataImport2Drop(event)" ondragover="event.preventDefault()" ondragenter="event.preventDefault()">
    <div class="data-import2-drop-icon"><i class="ph ph-upload-simple"></i></div>
    <div class="data-import2-drop-title">Upload Raw Reports</div>
    <div class="data-import2-drop-copy">Drop operational reports or ZIP batches here. ATLAS will detect report type, source system, communities, reporting period, fields, and downstream impact before anything is approved.</div>
    <div class="data-import2-supported">
      ${DATA_IMPORT_REPORT_ORDER.map(type => `<span class="data-import2-chip">${escapeHtml(dataImportReportLabel(type))}</span>`).join("")}
      <span class="data-import2-chip info">ZIP</span>
    </div>
    <input type="file" id="csv-input" accept=".csv,.txt,.pdf,.xlsx,.xls,.xlsm,.zip" multiple>
  </label>`;
}

function renderDataImportRecommendations(health) {
  if (!health.cells.length) return `<div class="data-import2-detail-panel">No required feeds in the active portfolio scope.</div>`;
  const recs = dataImportBuildRecommendations(health);
  if (!recs.length) {
    return `<div class="data-import2-detail-panel">All tracked feeds are current for the selected portfolio scope.</div>`;
  }
  return `<div class="data-import2-recommendations">${recs.map(rec => `<div class="data-import2-rec ${rec.severity}">
    <div>
      <div class="data-import2-rec-title">${escapeHtml(rec.title)}</div>
      <div class="data-import2-rec-detail">${escapeHtml(rec.detail)}</div>
    </div>
    <div class="data-import2-severity">${escapeHtml(rec.severity)}</div>
  </div>`).join("")}</div>`;
}

function renderDataImportMatrix(health, compact = false) {
  const rows = health.rows || [];
  const canManage = atlasProfileCanManageSettings(getAtlasAccessProfile());
  if (!rows.length) return `<div class="data-import2-detail-panel">No communities are available for data health tracking yet.</div>`;
  const head = DATA_IMPORT_REPORT_ORDER.map(type => `<th>${escapeHtml(dataImportReportLabel(type))}</th>`).join("");
  const body = rows.map(row => `<tr class="${row.isActive ? "" : "inactive-community-row"}">
    <td><strong>${escapeHtml(row.communityName)}</strong>${row.isActive ? "" : `<div class="data-import2-community-status-note">Inactive</div>`}</td>
    ${row.cells.map(cell => `<td>
      <button class="data-import2-cell-button" onclick='openDataImportHealthCell(${JSON.stringify(cell.communityName)}, ${JSON.stringify(cell.reportType)})'>
        <span class="data-import2-cell-status-line">
          <span class="data-import2-status ${dataImportStatusClass(cell.status)}">${escapeHtml(cell.status)}</span>
          <span class="data-import2-cell-date">${escapeHtml(cell.statusDateLabel || cell.ageLabel)}</span>
        </span>
        <div class="data-import2-cell-detail">${escapeHtml(cell.ageLabel)}</div>
      </button>
      ${row.isActive && cell.serviceSupported ? `<label class="data-import2-cell-detail" style="display:flex;align-items:center;gap:6px;margin-top:8px"><input type="checkbox" style="width:auto;margin:0" aria-label="${escapeHtml(`${cell.communityName}: ${cell.reportLabel} not required`)}" ${cell.requirementOverride?.excluded ? "checked" : ""} ${canManage ? "" : "disabled"} onchange="${escapeHtml(`setDataImportReportNotRequired(${JSON.stringify(cell.communityName)}, ${JSON.stringify(cell.reportType)}, this.checked)`)}">Not required</label>` : ""}
    </td>`).join("")}
  </tr>`).join("");
  const table = `<div class="data-import2-matrix-wrap"><table class="data-import2-matrix"><thead><tr><th>Community</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  if (!compact) return table;
  return renderWindowshadeCard({
    key: "import2_freshness_matrix",
    title: "Community Data Freshness Matrix",
    subtitle: "Freshness is tracked by community and report type. Active communities appear first; inactive communities stay at the bottom for reference.",
    countLabel: `${health.staleFeeds} stale · ${health.missingFeeds} missing · ${health.conflicts} conflicts${health.inactiveCommunities.length ? ` · ${health.inactiveCommunities.length} inactive` : ""}`,
    collapsedPreview: "Expand to review the community-by-report freshness matrix.",
    bodyHtml: table
  });
}

function renderDataImportHealthDetail(health) {
  const cell = dataImportSelectedHealthCell(health);
  if (!cell) return "";
  const archive = cell.archive;
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-magnifying-glass"></i>Selected Feed</div>
    <div class="data-import2-detail-panel">
      <strong>${escapeHtml(cell.communityName)} · ${escapeHtml(cell.reportLabel)}</strong><br>
      Status: ${escapeHtml(cell.status)}<br>
      Most recent upload: ${archive ? escapeHtml(dataImportFormatTimestamp(archive.uploadedAt)) : "None"}<br>
      Reporting date: ${archive ? escapeHtml(archive.metadata?.dataAsOf ? dataImportFormatTimestamp(archive.metadata.dataAsOf) : archive.dataDateLabel || archive.reportingPeriodLabel || "Not detected") : "Missing"}<br>
      Generated: ${archive?.metadata?.generatedAt ? escapeHtml(dataImportFormatTimestamp(archive.metadata.generatedAt)) : "Not recorded"}<br>
      Received: ${archive?.metadata?.receivedAt ? escapeHtml(dataImportFormatTimestamp(archive.metadata.receivedAt)) : archive ? escapeHtml(dataImportFormatTimestamp(archive.uploadedAt)) : "Not recorded"}<br>
      Expected cadence: ${escapeHtml(dataImportEffectiveFreshness(cell.reportType).label)}<br>
      Next due: ${cell.required ? escapeHtml(dataImportNextDueLabel(archive, cell.reportType)) : "Not required"}<br>
      ${cell.requirementOverride ? `Requirement ${cell.requirementOverride.excluded ? "waived" : "restored"} by ${escapeHtml(cell.requirementOverride.updatedBy)} · ${escapeHtml(dataImportFormatTimestamp(cell.requirementOverride.updatedAt))}<br>` : ""}
      Status date: ${escapeHtml(cell.statusDateLabel || "Not recorded")}<br>
      Age: ${escapeHtml(cell.ageLabel)}<br>
      Import batch: ${archive ? escapeHtml(archive.batchId) : "None"}<br>
      Mapping version: ${archive ? escapeHtml(archive.mappingVersion || "ATLAS-RRIM-1.0") : "None"}<br>
      File fingerprint: ${archive?.fileHash ? escapeHtml(`${archive.fileHash.slice(0, 16)}…`) : "Not recorded"}<br>
      Coverage: ${archive ? `${escapeHtml((archive.communities || []).length)}${archive.coverageExpected ? `/${escapeHtml(archive.coverageExpected)}` : ""} communities` : "None"}<br>
      Row disposition: ${archive ? `${escapeHtml(archive.rowsInserted || 0)} inserted · ${escapeHtml(archive.rowsUpdated || 0)} corrected · ${escapeHtml(archive.rowsUnchanged || 0)} unchanged · ${escapeHtml(archive.rowsHeld || 0)} held · ${escapeHtml(archive.rowsRejected || 0)} rejected` : "None"}<br>
      Outstanding problems: ${cell.exceptions.length || 0}<br>
      Recommended action: ${escapeHtml(cell.recommendedAction)}<br>
      Feeds: ${escapeHtml(cell.modulesAffected.join(", ") || "No dependencies configured")}
    </div>
  </div>`;
}

function renderDataImportFreshnessPolicies() {
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-calendar-check"></i>Freshness Policy</div>
    <div class="data-import2-file-meta" style="margin-bottom:10px">Cadence and downstream behavior are configurable by report. Warn &amp; send flags stale data; Block &amp; hold prevents a stale feed from moving downstream.</div>
    <table class="data-import2-table">
      <thead><tr><th>Report</th><th>Cadence</th><th>Threshold</th><th>Clock</th><th>Downstream Action</th><th>Updated</th></tr></thead>
      <tbody>${DATA_IMPORT_REPORT_ORDER.map(reportType => {
        const policy = dataImport2State.freshnessPolicies?.[reportType] || defaultDataImportFreshnessPolicies()[reportType];
        return `<tr>
          <td><strong>${escapeHtml(dataImportReportLabel(reportType))}</strong></td>
          <td><input value="${escapeHtml(policy.cadence || "")}" onchange='updateDataImportFreshnessPolicy(${JSON.stringify(reportType)}, "cadence", this.value)'></td>
          <td><input type="number" min="1" value="${escapeHtml(policy.thresholdDays || 7)}" onchange='updateDataImportFreshnessPolicy(${JSON.stringify(reportType)}, "thresholdDays", this.value)'> days</td>
          <td><select onchange='updateDataImportFreshnessPolicy(${JSON.stringify(reportType)}, "businessDays", this.value)'><option value="false" ${policy.businessDays ? "" : "selected"}>Calendar days</option><option value="true" ${policy.businessDays ? "selected" : ""}>Business days</option></select></td>
          <td><select onchange='updateDataImportFreshnessPolicy(${JSON.stringify(reportType)}, "action", this.value)'><option value="warn_send" ${policy.action === "block_hold" ? "" : "selected"}>Warn &amp; send</option><option value="block_hold" ${policy.action === "block_hold" ? "selected" : ""}>Block &amp; hold</option></select></td>
          <td>${policy.updatedAt ? escapeHtml(dataImportFormatTimestamp(policy.updatedAt)) : "Default"}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
    <div class="data-import2-detail-panel" style="margin-top:10px">
      <div class="data-import2-small-label">Closed Reporting Period Control</div>
      <div class="data-import2-form-grid" style="margin-top:6px">
        <input id="data-import-closed-period" type="month" value="${escapeHtml(buildPeriodKey(getSelectedDashboardMonthIndex(), new Date().getFullYear()))}">
        <button class="btn btn-gray btn-sm" onclick='updateDataImportClosedPeriod("close")'>Close Period</button>
        <button class="btn btn-gray btn-sm" onclick='updateDataImportClosedPeriod("open")'>Reopen for Approved Correction</button>
      </div>
      <div class="data-import2-supported" style="justify-content:flex-start;margin-top:8px">${(dataImport2State.closedPeriods || []).length ? dataImport2State.closedPeriods.map(period => `<span class="data-import2-chip warn">${escapeHtml(period)} closed</span>`).join("") : `<span class="data-import2-chip good">No periods are closed</span>`}</div>
    </div>
  </div>`;
}

function renderDataImportPreviewStats(summary = {}) {
  const stats = [
    ["Files", summary.files || 0],
    ["Communities", summary.communities || 0],
    ["Rows Reviewed", summary.rowsReviewed || 0],
    ["Ready", summary.readyToImport || 0],
    ["Updates", summary.existingRecordsUpdated || 0],
    ["Duplicates", summary.duplicatesIgnored || 0],
    ["Unmapped", summary.unmapped || 0],
    ["Conflicts", summary.conflicts || 0],
    ["Critical", summary.criticalErrors || 0]
  ];
  return `<div class="data-import2-preview-grid">${stats.map(([label, value]) => `<div class="data-import2-preview-stat">
    <div class="data-import2-preview-label">${escapeHtml(label)}</div>
    <div class="data-import2-preview-value">${escapeHtml(value)}</div>
  </div>`).join("")}</div>`;
}

function renderDataImportFileIssues(plan) {
  const issues = plan.issues || [];
  if (!issues.length) return `<span class="data-import2-chip good">No exceptions</span>`;
  return `<div class="data-import2-supported" style="justify-content:flex-start">${issues.slice(0, 4).map(issue =>
    `<span class="data-import2-chip ${issue.severity === "critical" || issue.severity === "high" ? "bad" : issue.type === "duplicate" ? "info" : "warn"}" title="${escapeHtml(issue.detail || "")}">${escapeHtml(issue.type === "low_confidence" ? dataImportMappingReviewLabel(issue.confidence, issue.learningStatus) : DATA_IMPORT_ISSUE_LABELS[issue.type] || issue.title || "Issue")}${issue.confidence ? ` · ${escapeHtml(issue.confidence)}%` : ""}</span>`
  ).join("")}${issues.length > 4 ? `<span class="data-import2-chip">${issues.length - 4} more</span>` : ""}</div>`;
}

function renderDataImportQuestionChoiceOptions(question = {}, selectedValue = "") {
  const selected = selectedValue || (question.kind === "mapping" ? "" : question.value || "");
  if (question.kind === "mapping") return renderDataImportDestinationOptions(selected, question.suggestedField);
  if (question.kind === "report_type") {
    return `<option value="">Choose report type</option>${DATA_IMPORT_REPORT_ORDER.map(type => `<option value="${escapeHtml(type)}"${selected === type ? " selected" : ""}>${escapeHtml(dataImportReportLabel(type))}</option>`).join("")}`;
  }
  if (question.kind === "community") {
    return `<option value="">Choose active community</option>${dataImportGetHealthCommunityNames().map(name => `<option value="${escapeHtml(name)}"${selected === name ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
  }
  const choices = question.kind === "inactive_history"
    ? [["history_only", "Retain for history only"], ["exclude_file", "Exclude this file from approval"]]
    : question.kind === "conflict"
      ? [["authoritative_source", "Use authoritative source hierarchy"], ["keep_existing", "Keep current ATLAS value"], ["hold_review", "Hold for manual review"]]
      : question.kind === "destination"
        ? [["confirm_destinations", "Confirm listed destinations"], ["change_destinations", "Destinations need changes"]]
        : [["confirmed", "Confirm"], ["change_required", "Change required"], ["hold_review", "Hold for review"]];
  return `<option value="">Choose an answer</option>${choices.map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}`;
}

function renderDataImportInlineCustomFieldCreator(context = {}) {
  const active = dataImport2State.activeCustomFieldContext;
  if (!active || active.questionId !== context.questionId || active.auditId !== context.auditId) return "";
  const draft = active.draft || {};
  const categories = DATA_IMPORT_DESTINATION_GROUPS.map(group => group.label);
  const similar = (active.similarFieldKeys || []).map(key => ({ key, label: dataImportMappingDestinationLabel(key), category: dataImportDestinationCategory(key) }));
  const checked = (key, defaultValue) => (draft[key] === undefined ? defaultValue : draft[key]) ? " checked" : "";
  return `<div class="data-import2-detail-panel" style="grid-column:1 / -1;margin-top:10px;border-color:#7db7d2;background:#f5fbfe">
    <div class="data-import2-question-review-head"><div><div class="data-import2-audit-title">Create a New ATLAS Field</div><div class="data-import2-audit-copy">Define the field here, then ATLAS will return it to this mapping question for confirmation.</div></div><button type="button" class="btn btn-gray btn-sm" onclick="closeDataImportInlineCustomField()">Cancel</button></div>
    ${similar.length ? `<div class="alert-yellow" style="margin:10px 0"><strong>A similar ATLAS field may already exist.</strong><div class="data-import2-inline-actions" style="margin-top:8px">${similar.map(item => `<button type="button" class="btn btn-gray btn-sm" onclick='useExistingDataImportFieldForQuestion(${JSON.stringify(item.key)})'>Use ${escapeHtml(item.label)} · ${escapeHtml(item.category)}</button>`).join("")}<button type="button" class="btn btn-blue btn-sm" onclick="saveDataImportInlineCustomField(true)">Create New Anyway</button></div></div>` : ""}
    <div class="data-import2-form-grid wide">
      <label class="data-import2-field"><div class="data-import2-small-label">Field Name</div><input id="data-import-inline-field-name" value="${escapeHtml(draft.fieldName || active.prefill?.fieldName || "")}" placeholder="Internal field name"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Display Label</div><input id="data-import-inline-field-label" value="${escapeHtml(draft.displayLabel || active.prefill?.displayLabel || "")}" placeholder="Label users will see"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Module / Section</div><select id="data-import-inline-field-category">${categories.map(category => `<option value="${escapeHtml(category)}"${(draft.category || active.prefill?.category) === category ? " selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Data Type</div><select id="data-import-inline-field-type">${["Text","Number","Currency","Percentage","Date","Status","Yes / No"].map(type => `<option${(draft.dataType || active.prefill?.dataType || "Text") === type ? " selected" : ""}>${type}</option>`).join("")}</select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Record Type</div><select id="data-import-inline-field-behavior"><option value="current_state"${(draft.recordBehavior || "current_state") === "current_state" ? " selected" : ""}>Current-State Data</option><option value="historical"${draft.recordBehavior === "historical" ? " selected" : ""}>Historical Snapshot</option><option value="lifecycle"${draft.recordBehavior === "lifecycle" ? " selected" : ""}>Lifecycle Data</option></select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Scope</div><select id="data-import-inline-field-scope"><option value="portfolio"${(draft.scope || "portfolio") === "portfolio" ? " selected" : ""}>Portfolio-Wide</option><option value="property"${draft.scope === "property" ? " selected" : ""}>Property-Specific</option></select></label>
      <label class="data-import2-field data-import2-field-wide"><div class="data-import2-small-label">Description / Purpose</div><input id="data-import-inline-field-description" value="${escapeHtml(draft.description || active.prefill?.description || "")}" placeholder="How ATLAS should interpret and use this field"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Default Value</div><input id="data-import-inline-field-default" value="${escapeHtml(draft.defaultValue || "")}" placeholder="Optional"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Allowed Values</div><input id="data-import-inline-field-values" value="${escapeHtml(draft.allowedValues || "")}" placeholder="Comma-separated options"></label>
      <label class="data-import2-field data-import2-field-wide"><div class="data-import2-small-label">Validation Rules</div><input id="data-import-inline-field-validation" value="${escapeHtml(draft.validationRules || "")}" placeholder="Range, format, or required-value rules"></label>
      <label class="data-import2-field data-import2-field-wide"><div class="data-import2-small-label">Allowed Modules</div><input id="data-import-inline-field-modules" value="${escapeHtml(draft.modules || active.prefill?.modules || "")}" placeholder="Reporting, Dashboard, Renewal Management"></label>
    </div>
    <div class="data-import2-supported" style="justify-content:flex-start;margin-top:10px">
      ${[["required","Required",false],["searchable","Searchable",true],["filterable","Filterable",true],["reportable","Reportable",true],["dashboardMetricEligible","Dashboard Metric Eligible",false],["importEligible","Import Eligible",true],["apiEligible","API / Feed Eligible",false],["storesHistory","Store History",true],["sensitive","Sensitive / Restricted",false]].map(([key,label,defaultValue]) => `<label class="data-import2-chip" style="display:inline-flex;align-items:center;gap:5px"><input id="data-import-inline-field-${key}" type="checkbox"${checked(key, defaultValue)}>${label}</label>`).join("")}
    </div>
    <div class="data-import2-inline-actions" style="margin-top:12px"><button type="button" class="btn btn-blue btn-sm" onclick="saveDataImportInlineCustomField(false)">Check & Create Field</button><button type="button" class="btn btn-gray btn-sm" onclick="closeDataImportInlineCustomField()">Cancel</button></div>
  </div>`;
}

function renderDataImportAuditStatusAction(audit = {}, context = "pending", batchId = "") {
  const questions = dataImportAuditQuestionItems(audit);
  const answers = new Set((audit.answers || []).map(answer => answer.questionId));
  const openCount = questions.filter(question => !answers.has(question.id)).length;
  if (!questions.length) {
    return `<span class="data-import2-status ${audit.status === "Verified" ? "ready" : "review"}">${escapeHtml(audit.status === "Verified" ? "Ready to check" : audit.status || "Needs Review")}</span>`;
  }
  const key = dataImportQuestionReviewKey(context, batchId, audit.id);
  const expanded = dataImport2State.activeQuestionReviewKey === key;
  if (!openCount) {
    return `<div class="data-import2-audit-action"><span class="data-import2-status ready"><i class="ph ph-check-circle"></i>Answers Saved</span><button type="button" class="btn btn-gray btn-sm" aria-expanded="${expanded ? "true" : "false"}" onclick='toggleDataImportQuestionReview(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)}, ${JSON.stringify(questions[0]?.id || "")})'>Edit</button></div>`;
  }
  return `<button type="button" class="data-import2-status review" aria-expanded="${expanded ? "true" : "false"}" onclick='toggleDataImportQuestionReview(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)})'><i class="ph ph-question"></i>${escapeHtml(`Needs Answers · ${openCount}`)}</button>`;
}

function renderDataImportQuestionReview(audit = {}, context = "pending", batchId = "") {
  const key = dataImportQuestionReviewKey(context, batchId, audit.id);
  if (dataImport2State.activeQuestionReviewKey !== key) return "";
  const questions = dataImportAuditQuestionItems(audit);
  const selectedIds = new Set(dataImport2State.selectedQuestionIds || []);
  const expandedSamples = new Set(dataImport2State.expandedQuestionSampleIds || []);
  const mappingQuestions = questions.filter(question => question.kind === "mapping");
  const visibleQuestions = questions.filter(question => dataImportQuestionMatchesFilter(question, dataImportQuestionAnswer(audit, question.id)));
  const unresolvedMappingCount = mappingQuestions.filter(question => !dataImportQuestionAnswer(audit, question.id)).length;
  const ignoreConfirmOpen = dataImport2State.pendingIgnoreAllKey === key;
  return `<div class="data-import2-question-review" id="data-import-question-panel-${escapeHtml(dataImportSlug(key))}">
    <div class="data-import2-question-review-head">
      <div><div class="data-import2-audit-title">Import Questions · ${escapeHtml(audit.reportTypeLabel || dataImportReportLabel(audit.reportType))}</div><div class="data-import2-audit-copy">Current-import exclusions apply only to this batch. Confirmed mappings teach ATLAS within the selected source context.</div></div>
      <button type="button" class="btn btn-gray btn-sm" onclick='toggleDataImportQuestionReview(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)})'>Close</button>
    </div>
    ${mappingQuestions.length ? `<div class="data-import2-review-toolbar" style="margin:10px 0">
      <label class="data-import2-field"><div class="data-import2-small-label">Review Queue</div><select onchange="setDataImportQuestionReviewFilter(this.value)"><option value="all"${dataImport2State.questionReviewFilter === "all" ? " selected" : ""}>All questions</option><option value="high"${dataImport2State.questionReviewFilter === "high" ? " selected" : ""}>High confidence</option><option value="low"${dataImport2State.questionReviewFilter === "low" ? " selected" : ""}>Low confidence</option><option value="new"${dataImport2State.questionReviewFilter === "new" ? " selected" : ""}>New fields</option><option value="ignored"${dataImport2State.questionReviewFilter === "ignored" ? " selected" : ""}>Ignored</option><option value="conflict"${dataImport2State.questionReviewFilter === "conflict" ? " selected" : ""}>Conflicts</option></select></label>
      <div class="data-import2-inline-actions">
        <button type="button" class="btn btn-gray btn-sm" onclick='bulkResolveDataImportQuestions(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)}, "accept_high")'>Accept High Confidence</button>
        <button type="button" class="btn btn-gray btn-sm" onclick='bulkResolveDataImportQuestions(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)}, "ignore_selected")'>Ignore Selected for This Import</button>
        ${dataImportCanManageArchitecture() ? `<button type="button" class="btn btn-gray btn-sm" onclick='bulkResolveDataImportQuestions(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)}, "always_ignore_selected")'>Always Ignore Selected</button>` : ""}
        ${unresolvedMappingCount ? `<button type="button" class="btn btn-blue btn-sm" onclick='requestIgnoreAllDataImportQuestions(${JSON.stringify(key)})'>Ignore All for This Import · ${unresolvedMappingCount}</button>` : ""}
      </div>
    </div>` : ""}
    ${ignoreConfirmOpen ? `<div class="alert-yellow" style="margin:10px 0"><strong>Exclude all remaining unresolved fields from this import?</strong><div class="data-import2-audit-copy" style="margin-top:4px">Their values will not be written into ATLAS records in this batch. They remain eligible for review during future uploads.</div><div class="data-import2-inline-actions" style="margin-top:8px"><button type="button" class="btn btn-blue btn-sm" onclick='bulkResolveDataImportQuestions(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)}, "ignore_all")'>Ignore & Continue Import</button><button type="button" class="btn btn-gray btn-sm" onclick="requestIgnoreAllDataImportQuestions('')">Return to Review</button></div></div>` : ""}
    ${visibleQuestions.map(question => {
      const answer = dataImportQuestionAnswer(audit, question.id);
      const choiceId = dataImportQuestionControlId(audit.id, question.id, "choice");
      const noteId = dataImportQuestionControlId(audit.id, question.id, "note");
      const scopeId = dataImportQuestionControlId(audit.id, question.id, "scope");
      const isFocused = dataImport2State.activeQuestionId === question.id;
      const prompt = dataImportQuestionDisplayPrompt(question, audit);
      if (answer && !isFocused) {
        return `<div class="data-import2-question-form answered compact">
          <div>
            <div class="data-import2-question-prompt">${escapeHtml(prompt)}</div>
            <div class="data-import2-question-answer"><i class="ph ph-check-circle"></i> ${escapeHtml(answer.valueLabel || dataImportQuestionValueLabel(question, answer.value))} · ${escapeHtml(dataImportFormatTimestamp(answer.answeredAt))} by ${escapeHtml(answer.answeredBy || "Admin")}</div>
            <div class="data-import2-question-outcome">${escapeHtml(dataImportQuestionOutcomeText(question, answer, audit))}</div>
          </div>
          <button type="button" class="btn btn-gray btn-sm" onclick='toggleDataImportQuestionReview(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)}, ${JSON.stringify(question.id)})'>Edit</button>
        </div>`;
      }
      const draftValue = dataImportQuestionDraftValue(audit.id, question.id, answer?.value || "");
      const sampleValues = Array.from(new Set([...(question.sampleValues || []), question.sampleValue].filter(Boolean))).slice(0, 5);
      return `<div class="data-import2-question-form${answer ? " answered" : ""}"${isFocused ? ` data-question-focus="true"` : ""}>
        <div>
          ${question.kind === "mapping" ? `<label style="display:inline-flex;align-items:center;gap:6px;margin-bottom:6px"><input type="checkbox" ${selectedIds.has(question.id) ? "checked" : ""} onchange='toggleDataImportQuestionSelection(${JSON.stringify(question.id)}, this.checked)'>Select</label>` : ""}
          <div class="data-import2-question-prompt">${escapeHtml(prompt)}</div>
          ${question.previouslyIgnored ? `<div class="data-import2-question-meta"><span class="data-import2-chip warn">Previously ignored for one import</span> ATLAS is asking again because no permanent rule was created.</div>` : ""}
          ${question.kind === "mapping" ? `<div class="data-import2-question-meta"><strong>Source header:</strong> ${escapeHtml(question.originalField || "Not captured")}<br><strong>Proposed destination:</strong> ${escapeHtml(question.suggestedField ? dataImportMappingDestinationLabel(question.suggestedField) : "No destination proposed")}<br><strong>Why ATLAS asked:</strong> ${escapeHtml(question.reason || "The mapping has not been verified for this source context.")}${question.confidence ? `<br><span class="data-import2-chip ${Number(question.confidence || 0) >= 95 ? "info" : "warn"}">${escapeHtml(dataImportMappingReviewLabel(question.confidence, question.learningStatus))} · ${escapeHtml(question.confidence)}%</span>` : ""}</div>` : ""}
          ${question.kind === "mapping" && question.suggestedField && Number(question.confidence || 0) >= 50 ? `<div class="data-import2-question-meta">Confirm the proposed destination or choose another one.</div>` : ""}
          ${question.kind === "mapping" && (!question.suggestedField || Number(question.confidence || 0) < 50) ? `<div class="data-import2-question-meta">ATLAS does not have a reliable suggestion for this field. Choose a verified destination, create a field, or ignore it for this import.</div>` : ""}
          ${question.kind === "mapping" ? `<button type="button" class="btn btn-gray btn-sm" style="margin-top:7px" onclick='toggleDataImportQuestionSamples(${JSON.stringify(question.id)})'><i class="ph ph-eye"></i>${expandedSamples.has(question.id) ? "Hide" : "View"} Sample Data</button>${expandedSamples.has(question.id) ? `<div class="data-import2-supported" style="justify-content:flex-start;margin-top:7px">${sampleValues.length ? sampleValues.map(value => `<span class="data-import2-chip info">${escapeHtml(value)}</span>`).join("") : `<span class="data-import2-chip">No sample value was captured in preview</span>`}<span class="data-import2-chip">${escapeHtml(question.detectedDataType || "Type not detected")}</span><span class="data-import2-chip">${escapeHtml(question.sheetName || "Tab not detected")}</span></div>` : ""}` : ""}
          ${answer ? `<div class="data-import2-question-answer"><i class="ph ph-check-circle"></i> ${escapeHtml(answer.valueLabel || dataImportQuestionValueLabel(question, answer.value))} · ${escapeHtml(dataImportFormatTimestamp(answer.answeredAt))} by ${escapeHtml(answer.answeredBy || "Admin")}</div>` : ""}
        </div>
        <div class="data-import2-question-controls">
          <label class="data-import2-field"><div class="data-import2-small-label">${question.kind === "mapping" ? "Map To" : "Answer"}</div><select id="${escapeHtml(choiceId)}" onchange='handleDataImportQuestionChoiceChange(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)}, ${JSON.stringify(question.id)}, this.value)'>${renderDataImportQuestionChoiceOptions(question, draftValue)}</select></label>
          <label class="data-import2-field"><div class="data-import2-small-label">Note</div><input id="${escapeHtml(noteId)}" value="${escapeHtml(answer?.note || "")}" placeholder="Optional review note"></label>
          ${question.kind === "mapping" ? `<label class="data-import2-field"><div class="data-import2-small-label">Learning Scope</div><select id="${escapeHtml(scopeId)}"><option${(answer?.scope || "Exact Source + Report") === "Exact Source + Report" ? " selected" : ""}>Exact Source + Report</option><option${answer?.scope === "This File Format Only" ? " selected" : ""}>This File Format Only</option><option${answer?.scope === "This Data Source" ? " selected" : ""}>This Data Source</option><option${answer?.scope === "This Property" ? " selected" : ""}>This Property</option><option${answer?.scope === "This Region" ? " selected" : ""}>This Region</option><option${answer?.scope === "Portfolio-Wide" ? " selected" : ""}>Portfolio-Wide</option></select></label>` : ""}
        </div>
        <button type="button" class="btn btn-blue btn-sm" onclick='saveDataImportAuditQuestion(${JSON.stringify(context)}, ${JSON.stringify(audit.id)}, ${JSON.stringify(batchId)}, ${JSON.stringify(question.id)})'>${answer ? "Update Answer" : "Save Answer"}</button>
        ${renderDataImportInlineCustomFieldCreator({ context, auditId: audit.id, batchId, questionId: question.id })}
      </div>`;
    }).join("") || `<div class="data-import2-detail-panel">No questions match this filter.</div>`}
  </div>`;
}

function renderDataImportBatchQuestions(batch) {
  const reviews = (batch?.files || []).filter(plan => plan.selected && plan.status !== "blocked").flatMap(plan => {
    const audit = dataImportBuildDownstreamAuditForPlan(plan);
    return dataImportAuditQuestionItems(audit).map(question => ({ audit, question, answer: dataImportQuestionAnswer(audit, question.id) }));
  }).slice(0, 200);
  if (!reviews.length) return "";
  return `<div class="data-import2-detail-panel" style="margin-top:10px">
    <div class="data-import2-section-title"><i class="ph ph-question"></i>Questions ATLAS Needs Answered</div>
    <div class="data-import2-question-list">
      ${reviews.map(({ audit, question, answer }) => `<div class="data-import2-question${answer ? " answered" : ""}">
        <div class="data-import2-question-copy">${escapeHtml(question.prompt)}${answer ? `<div class="data-import2-question-answer">Answered: ${escapeHtml(answer.valueLabel || dataImportQuestionValueLabel(question, answer.value))}</div>` : ""}</div>
        <button type="button" class="btn ${answer ? "btn-gray" : "btn-blue"} btn-sm" onclick='toggleDataImportQuestionReview("pending", ${JSON.stringify(audit.id)}, ${JSON.stringify(batch.id)}, ${JSON.stringify(question.id)})'>${answer ? "Edit" : "Answer"}</button>
      </div>`).join("")}
    </div>
  </div>`;
}

function renderDataImportPlannedDownstreamAudit(batch) {
  const plans = (batch?.files || []).filter(plan => plan.selected && plan.status !== "blocked");
  if (!plans.length) return "";
  const audits = plans.map(plan => dataImportBuildDownstreamAuditForPlan(plan));
  return `<div class="data-import2-detail-panel" style="margin-top:10px">
    <div class="data-import2-section-title"><i class="ph ph-check-circle"></i>Destination Checks After Approval</div>
    <div class="data-import2-audit-grid">
      ${audits.map(audit => {
        const key = dataImportQuestionReviewKey("pending", batch.id, audit.id);
        return `<div class="data-import2-audit-item${dataImport2State.activeQuestionReviewKey === key ? " open" : ""}"><div class="data-import2-audit-row">
          <div>
            <div class="data-import2-audit-title">${escapeHtml(audit.reportTypeLabel)}</div>
            <div class="data-import2-audit-copy">${escapeHtml(audit.fileName)}</div>
          </div>
          <div class="data-import2-audit-copy">
            ${escapeHtml(audit.modules.slice(0, 5).join(", ") || "No downstream page mapping configured yet.")}
            ${audit.inactiveCommunities.length ? `<div style="margin-top:4px">Inactive detected: ${escapeHtml(audit.inactiveCommunities.join(", "))}</div>` : ""}
          </div>
          ${renderDataImportAuditStatusAction(audit, "pending", batch.id)}
        </div>${renderDataImportQuestionReview(audit, "pending", batch.id)}</div>`;
      }).join("")}
    </div>
  </div>`;
}

function renderDataImportDownstreamAudit(audits = [], owningBatchId = "") {
  const rows = Array.isArray(audits) ? audits : [];
  if (!rows.length) return "";
  return `<div class="data-import2-audit-grid">
    ${rows.map(audit => {
      const batchId = audit.batchId || owningBatchId || "";
      const key = dataImportQuestionReviewKey("history", batchId, audit.id);
      return `<div class="data-import2-audit-item${dataImport2State.activeQuestionReviewKey === key ? " open" : ""}"><div class="data-import2-audit-row">
        <div>
          <div class="data-import2-audit-title">${escapeHtml(audit.reportTypeLabel || dataImportReportLabel(audit.reportType))}</div>
          <div class="data-import2-audit-copy">${escapeHtml(audit.fileName || "Source file")}</div>
        </div>
        <div class="data-import2-audit-copy">
          ${escapeHtml(audit.detail || "")}
          <div style="margin-top:4px">${escapeHtml((audit.modules || []).slice(0, 5).join(", ") || "No downstream page mapping configured yet.")}</div>
        </div>
        ${renderDataImportAuditStatusAction(audit, "history", batchId)}
      </div>${renderDataImportQuestionReview(audit, "history", batchId)}</div>`;
    }).join("")}
  </div>`;
}

function renderDataImportPendingBatch() {
  const batch = dataImport2State.pendingBatch;
  if (!batch) {
    return `<div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-clipboard-text"></i>Import Preview</div>
      <div class="data-import2-detail-panel">Upload raw reports to generate a validation preview before ATLAS updates any dashboard data.</div>
    </div>`;
  }
  const reportOptions = [`<option value="unknown">Needs Review</option>`]
    .concat(DATA_IMPORT_REPORT_ORDER.map(type => `<option value="${type}">${escapeHtml(dataImportReportLabel(type))}</option>`))
    .join("");
  const assignableCommunities = dataImportGetHealthCommunityNames();
  const approvalDisabled = dataImportApprovalInProgress ? "disabled" : "";
  const fileRows = (batch.files || []).map(plan => `<div class="data-import2-file">
    <div>
      <label style="display:flex;align-items:flex-start;gap:8px">
        <input type="checkbox" ${plan.selected ? "checked" : ""} ${plan.status === "blocked" || dataImportApprovalInProgress ? "disabled" : ""} onchange='toggleDataImportFileApproval(${JSON.stringify(plan.fileId)}, this.checked)' style="margin-top:2px">
        <span>
          <div class="data-import2-file-name">${escapeHtml(plan.name)}</div>
          <div class="data-import2-file-meta">${escapeHtml(dataImportFormatBytes(plan.size))}${plan.originalZipName ? ` · from ${escapeHtml(plan.originalZipName)}` : ""} · ${escapeHtml(plan.rowCount || 0)} rows reviewed</div>
          <div class="data-import2-file-meta">SHA-256 ${escapeHtml((plan.fileHash || "not available").slice(0, 12))}${plan.fileHash ? "…" : ""} · mapping ${escapeHtml(plan.mappingVersion || "ATLAS-RRIM-1.0")}</div>
        </span>
      </label>
    </div>
    <div>
      <div class="data-import2-small-label">Detected Report</div>
      <select class="data-import2-select" ${approvalDisabled} onchange='overrideDataImportReportType(${JSON.stringify(plan.fileId)}, this.value)'>
        ${reportOptions.replace(`value="${plan.reportType}"`, `value="${plan.reportType}" selected`)}
      </select>
      <div class="data-import2-file-meta">Source: ${escapeHtml(plan.sourceSystem)}${plan.confidence ? ` · ${escapeHtml(plan.confidence)}% confidence` : ""}</div>
    </div>
    <div>
      <div class="data-import2-small-label">Communities</div>
      <div class="data-import2-supported" style="justify-content:flex-start">${(plan.communities || []).length
        ? plan.communities.slice(0, 8).map(name => `<label class="data-import2-chip good" style="display:inline-flex;align-items:center;gap:4px"><input type="checkbox" ${approvalDisabled} ${(plan.selectedCommunities || plan.communities || []).includes(name) ? "checked" : ""} onchange='toggleDataImportCommunityApproval(${JSON.stringify(plan.fileId)}, ${JSON.stringify(name)}, this.checked)'>${escapeHtml(name)}</label>`).join("") + (plan.communities.length > 8 ? `<span class="data-import2-chip">${plan.communities.length - 8} more</span>` : "")
        : `<select class="data-import2-select" ${approvalDisabled} onchange='assignDataImportPlanCommunity(${JSON.stringify(plan.fileId)}, this.value)'><option value="">Assign active community</option>${assignableCommunities.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}</select>`}</div>
      <div class="data-import2-file-meta">${escapeHtml(plan.reportingPeriodLabel)} · ${escapeHtml(plan.dataDateLabel)} · received ${escapeHtml(dataImportFormatTimestamp(plan.metadata?.receivedAt))}</div>
      ${plan.reportType === "renewal_tracker" ? `<div class="data-import2-file-meta"><strong>One community · multiple expiration months</strong><br>${escapeHtml((plan.renewalPeriods || []).join(", ") || "Periods resolved from agreement expiration dates during review")}<br>Advance renewals reduce exposure in the expiration month. Repeated uploads update matching agreements; omitted months remain intact.</div>` : plan.periodSelection ? `<div class="data-import2-file-meta">Selected: ${escapeHtml(MONTHS[plan.periodSelection.requested.monthIdx])} ${plan.periodSelection.requested.year} · Report: ${escapeHtml(plan.periodSelection.detected.label || "Not detected")}${plan.periodSelection.basis === "user_selected" ? " · Using your selected period; source dates remain unchanged" : ""}</div>` : ""}
      ${(plan.renewalCoverage || []).length ? `<table class="data-import2-table"><caption>Renewal expiration coverage</caption><thead><tr><th>Expiration month</th><th>Agreements</th><th>Renewed</th><th>Notice to vacate</th><th>Undecided</th></tr></thead><tbody>${plan.renewalCoverage.map(item => `<tr><td>${escapeHtml(item.period)}</td><td>${item.expirations}</td><td>${item.renewalsSigned}</td><td>${item.ntv}</td><td>${item.undecided}</td></tr>`).join("")}</tbody></table>` : ""}
    </div>
    <div>
      <div class="data-import2-small-label">Mapped Fields</div>
      <div class="data-import2-file-meta">${(plan.availableFields || []).slice(0, 4).map(field => escapeHtml(dataImportCanonicalFieldLabel(field.canonicalField))).join(", ") || "No mapped fields yet"}</div>
      <div class="data-import2-file-meta">${escapeHtml((plan.downstreamUses || []).slice(0, 2).join(", ") || "No dependencies detected")}</div>
      <div class="data-import2-file-meta">${escapeHtml((plan.relevantTabs || []).filter(name => !dataImportIsMetadataSheetName(name)).slice(0, 3).join(", ") || "No data tab detected")}</div>
    </div>
    <div>
      <span class="data-import2-status ${dataImportStatusClass(plan.status)}">${escapeHtml(plan.status === "ready" ? "Ready" : plan.status === "blocked" ? "Blocked" : "Review")}</span>
      <div style="margin-top:7px">${renderDataImportFileIssues(plan)}</div>
    </div>
  </div>`).join("");
  const zipIssueHtml = (batch.zipIssues || []).length
    ? `<div class="alert-yellow mb4">${batch.zipIssues.map(issue => `<div><strong>${escapeHtml(issue.title || "ZIP issue")}</strong> · ${escapeHtml(issue.detail || issue.fileName || "")}</div>`).join("")}</div>`
    : "";
  return `<div class="data-import2-card">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <div>
        <div class="data-import2-section-title" style="margin-bottom:4px"><i class="ph ph-clipboard-text"></i>Import Preview · ${escapeHtml(batch.id)}</div>
        <div class="data-import2-file-meta">Prepared ${escapeHtml(dataImportFormatTimestamp(batch.uploadedAt))}. Approve clean files, selected communities, or review-ready rows without blocking the full batch.</div>
      </div>
      <div class="data-import2-inline-actions">
        <button class="btn btn-gray btn-sm" ${approvalDisabled} onclick="setDataImportBatchSelection(true)">Select All</button>
        <button class="btn btn-gray btn-sm" ${approvalDisabled} onclick="setDataImportBatchSelection(false)">Clear</button>
        <button class="btn btn-gray btn-sm" ${approvalDisabled} onclick="clearDataImportPendingBatch()">Discard Preview</button>
        <button id="data-import-approve-button" class="btn btn-blue btn-sm" ${approvalDisabled} onclick="approveDataImportBatch()">${dataImportApprovalInProgress ? `Applying ${Math.min(Number(dataImportApprovalProgress.filesDone || 0) + 1, Number(dataImportApprovalProgress.totalFiles || 0))} of ${escapeHtml(dataImportApprovalProgress.totalFiles || 0)}` : "Approve Selected"}</button>
      </div>
    </div>
    <div id="data-import-approval-progress" class="data-import2-approval-progress" role="status" aria-live="polite" aria-busy="${dataImportApprovalInProgress ? "true" : "false"}" ${dataImportApprovalInProgress ? "" : "hidden"}>
      <div class="data-import2-progress-copy"><span id="data-import-approval-copy">Applying selected data</span><span id="data-import-approval-count">0 rows</span></div>
      <div class="data-import2-progress-track"><div id="data-import-approval-fill" class="data-import2-progress-fill"></div></div>
    </div>
    ${renderDataImportPreviewStats(batch.summary)}
    ${zipIssueHtml}
    <div class="data-import2-file-list" style="margin-top:12px">${fileRows || `<div class="data-import2-detail-panel">No supported files were found in this batch.</div>`}</div>
    ${renderDataImportBatchQuestions(batch)}
    ${renderDataImportPlannedDownstreamAudit(batch)}
  </div>`;
}

function renderDataImportOverview(health) {
  return `<div class="data-import2-main-grid">
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-warning-circle"></i>What Needs Updating?</div>
      ${renderDataImportRecommendations(health)}
    </div>
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-upload-simple"></i>Upload Raw Reports</div>
      ${renderDataImportDropzone()}
    </div>
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-activity"></i>Recent Import Activity</div>
      ${renderDataImportRecentActivity()}
    </div>
    <div style="grid-column:1 / -1">${renderDataImportMatrix(health, true)}</div>
  </div>`;
}

function renderDataImportRecentActivity() {
  const batches = (dataImport2State.batches || []).slice(0, 5);
  if (!batches.length) return `<div class="data-import2-detail-panel">No approved import batches have been recorded yet.</div>`;
  return `<div class="data-import2-activity">${batches.map(batch => `<div class="data-import2-activity-row">
    <div><strong>${escapeHtml(batch.id)}</strong><div class="data-import2-file-meta">${escapeHtml(dataImportFormatTimestamp(batch.approvedAt || batch.createdAt))}</div></div>
    <div>${escapeHtml((batch.files || []).map(file => file.reportTypeLabel).filter(Boolean).slice(0, 3).join(", ") || "Import batch")}</div>
    <div><span class="data-import2-status ${dataImportStatusClass(batch.status)}">${escapeHtml(batch.status)}</span></div>
    <div>${escapeHtml(batch.summary?.rowsReviewed || 0)} rows reviewed<div class="data-import2-file-meta">${escapeHtml(dataImportSummarizeDownstreamAudit(batch.downstreamAudit))}</div>${batch.learningSummary ? `<div class="data-import2-file-meta">${escapeHtml(batch.learningSummary.mappingDecisionsConfirmed || 0)} decisions learned · ${escapeHtml(batch.learningSummary.fieldsIgnoredForImport || 0)} temporarily ignored</div>` : ""}</div>
  </div>`).join("")}</div>`;
}

function renderDataImportUploadCenter() {
  return `<div class="data-import2-shell">
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-upload-simple"></i>Upload Center</div>
      ${renderDataImportDropzone()}
    </div>
    ${renderDataImportPendingBatch()}
  </div>`;
}

function renderDataImportHealthView(health) {
  return `<div class="data-import2-shell">
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-heartbeat"></i>Community Data Freshness Matrix</div>
      ${renderDataImportMatrix(health, false)}
    </div>
    ${renderDataImportHealthDetail(health)}
    ${renderDataImportFreshnessPolicies()}
  </div>`;
}

function renderDataImportExceptionsView() {
  const pending = dataImport2State.pendingBatch?.files?.flatMap(plan => (plan.issues || []).map(issue => ({
    id: `${plan.fileId}_${issue.type}_${issue.title}`,
    createdAt: dataImport2State.pendingBatch.uploadedAt,
    status: "Pending Approval",
    batchId: dataImport2State.pendingBatch.id,
    fileName: plan.name,
    communityName: (plan.communities || [])[0] || "Unmapped",
    sourceSystem: plan.sourceSystem,
    reportTypeLabel: plan.reportTypeLabel,
    type: issue.type,
    label: DATA_IMPORT_ISSUE_LABELS[issue.type] || issue.title,
    severity: issue.severity || "medium",
    title: issue.title,
    detail: issue.detail,
    modulesAffected: plan.downstreamUses || [],
    recommendedAction: issue.type === "unmapped" ? "Assign the property or save a new alias." : "Review and resolve before final approval."
  }))) || [];
  const issues = [...pending, ...(dataImport2State.exceptions || [])]
    .filter(Boolean)
    .filter(dataImportIssueBelongsToActiveCommunity);
  if (!issues.length) return `<div class="data-import2-card"><div class="data-import2-section-title"><i class="ph ph-warning-diamond"></i>Exceptions</div><div class="data-import2-detail-panel">No import exceptions are open.</div></div>`;
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-warning-diamond"></i>Exceptions</div>
    <table class="data-import2-table">
      <thead><tr><th>Issue</th><th>Community</th><th>Source</th><th>Why It Matters</th><th>Action</th></tr></thead>
      <tbody>${issues.map(issue => `<tr>
        <td>${issue.type === "unmapped" && issue.status !== "Pending Approval" ? `<button type="button" class="data-import2-status ${dataImportStatusClass(issue.type)}" onclick="return openDataImportExceptionMapping(${escapeHtml(JSON.stringify(issue.id))})">${escapeHtml(issue.label)}</button>` : `<span class="data-import2-status ${dataImportStatusClass(issue.type)}">${escapeHtml(issue.label)}</span>`}<div class="data-import2-file-meta">${escapeHtml(issue.title || "")} · ${escapeHtml(issue.severity || "medium")}</div></td>
        <td>${escapeHtml(issue.communityName || "Unmapped")}<div class="data-import2-file-meta">${escapeHtml(issue.batchId || "")}</div></td>
        <td>${escapeHtml(issue.sourceSystem || "Unknown")}<div class="data-import2-file-meta">${escapeHtml(issue.reportTypeLabel || issue.fileName || "")}</div></td>
        <td>${escapeHtml(issue.detail || "")}<div class="data-import2-file-meta">${escapeHtml((issue.modulesAffected || []).join(", "))}</div></td>
        <td><div class="data-import2-file-meta">${escapeHtml(issue.recommendedAction || "Review")}</div>${issue.status !== "Pending Approval" ? `<button class="btn btn-gray btn-sm" onclick='${issue.type === "unmapped" ? "openDataImportExceptionMapping" : "resolveDataImportException"}(${JSON.stringify(issue.id)})'>${issue.type === "unmapped" ? "Resolve Mapping" : "Mark Resolved"}</button>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function renderDataImportDestinationOptions(selectedField = "", suggestedField = "") {
  const selected = selectedField === "__ignored__" ? "__always_ignore__" : (selectedField || "");
  const optionHtml = dataImportDestinationGroups().map(group => `<optgroup label="${escapeHtml(group.label)}">
    ${group.fields.map(field => `<option value="${escapeHtml(field.key)}"${field.key === selected ? " selected" : ""}>${escapeHtml(field.label)}</option>`).join("")}
  </optgroup>`).join("");
  return `<option value="">Choose destination</option>${optionHtml}`;
}

function renderDataImportMappingReviewSummary(counts) {
  const cards = [
    ["new", counts.newSources, "New Sources", "warn"],
    ["needs", counts.unmappedFields, "Unmapped Fields", "bad"],
    ["low", counts.lowConfidence, "Low Confidence", "warn"],
    ["conflict", counts.conflicts, "Conflicts", "bad"]
  ];
  return `<div class="data-import2-summary-grid">${cards.map(([filter, value, label, tone]) =>
    `<button class="data-import2-summary-card ${tone} ${dataImport2State.mappingReviewFilter === filter ? "active" : ""}" onclick="setDataImportMappingReviewFilter('${filter}')">
      <div class="data-import2-summary-value">${escapeHtml(value)}</div>
      <div class="data-import2-summary-label">${escapeHtml(label)}</div>
    </button>`
  ).join("")}</div>`;
}

function renderDataImportNewSourceQueue(rows = []) {
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-sparkle"></i>New / Unmapped Sources</div>
    ${rows.length ? `<div class="data-import2-review-list">${rows.map(row => `<div class="data-import2-source-card">
      <div><div class="data-import2-review-title">${escapeHtml(row.reportTypeLabel)}</div><div class="data-import2-review-meta">${escapeHtml(row.fileName)} · ${escapeHtml(row.reason)}</div></div>
      <div><div class="data-import2-small-label">Source System</div><strong>${escapeHtml(row.sourceSystem)}</strong></div>
      <div><div class="data-import2-small-label">Communities</div><div class="data-import2-review-meta">${escapeHtml((row.communities || []).slice(0, 5).join(", ") || "Not detected")}</div></div>
      <button class="btn btn-blue btn-sm" onclick='addDataImportSourceDefinitionFromPending(${JSON.stringify(row.id)})'>Add Source</button>
    </div>`).join("")}</div>` : `<div class="data-import2-detail-panel">No new source definitions are waiting. Newly uploaded report types, tabs, or source system variations will appear here first.</div>`}
  </div>`;
}

function renderDataImportMappingToolbar(items = []) {
  const sourceOptions = Array.from(new Set(items.map(item => item.sourceSystem).filter(Boolean))).sort();
  const reportOptions = Array.from(new Map(items.filter(item => item.reportType).map(item => [item.reportType, item.reportTypeLabel || dataImportReportLabel(item.reportType)])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const batchOptions = Array.from(new Set(items.map(item => item.uploadBatch).filter(Boolean))).sort().reverse();
  const filterButtons = [
    ["needs", "Needs Mapping"],
    ["new", "Newly Uploaded"],
    ["low", "Low Confidence"],
    ["conflict", "Conflict"],
    ["mapped", "Mapped"],
    ["ignored", "Ignored"],
    ["all", "All"]
  ];
  return `<div>
    <div class="data-import2-tabs" style="margin-top:10px">${filterButtons.map(([key, label]) =>
      `<button class="data-import2-tab${dataImport2State.mappingReviewFilter === key ? " active" : ""}" onclick="setDataImportMappingReviewFilter('${key}')">${escapeHtml(label)}</button>`
    ).join("")}</div>
    <div class="data-import2-review-toolbar">
      <label class="data-import2-field"><div class="data-import2-small-label">Source System</div><select onchange="setDataImportMappingSelectFilter('mappingSourceFilter', this.value)"><option value="">All</option>${sourceOptions.map(source => `<option value="${escapeHtml(source)}"${dataImport2State.mappingSourceFilter === source ? " selected" : ""}>${escapeHtml(source)}</option>`).join("")}</select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Report Type</div><select onchange="setDataImportMappingSelectFilter('mappingReportFilter', this.value)"><option value="">All</option>${reportOptions.map(([value, label]) => `<option value="${escapeHtml(value)}"${dataImport2State.mappingReportFilter === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Upload Batch</div><select onchange="setDataImportMappingSelectFilter('mappingBatchFilter', this.value)"><option value="">All</option>${batchOptions.map(batch => `<option value="${escapeHtml(batch)}"${dataImport2State.mappingBatchFilter === batch ? " selected" : ""}>${escapeHtml(batch)}</option>`).join("")}</select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Search</div><input value="${escapeHtml(dataImport2State.mappingSearch || "")}" placeholder="Source field, file, destination" onchange="setDataImportMappingSelectFilter('mappingSearch', this.value)"></label>
      <div class="data-import2-inline-actions">
        <button class="btn btn-blue btn-sm" onclick="saveSelectedDataImportMappings()">Save Selected</button>
        <button class="btn btn-gray btn-sm" onclick="acceptHighConfidenceDataImportMappings()">Accept High Confidence</button>
        <button class="btn btn-gray btn-sm" onclick="ignoreSelectedDataImportMappings()">Ignore Selected</button>
        <button class="btn btn-gray btn-sm" onclick="applySameDestinationToSimilarDataImportMappings()">Apply Same Destination</button>
      </div>
    </div>
  </div>`;
}

function renderDataImportMappingReviewList(items = []) {
  if (!items.length) return `<div class="data-import2-detail-panel" style="margin-top:12px">No mapping records match the current filters.</div>`;
  const selectedIds = new Set(dataImport2State.selectedMappingIds || []);
  return `<div class="data-import2-review-list">${items.slice(0, 140).map(item => {
    const destination = dataImportSelectedDestinationForItem(item);
    const confidence = Number(item.confidence || 0);
    return `<div class="data-import2-review-row ${dataImportMappingRowClass(item)}">
      <div><input type="checkbox" ${selectedIds.has(item.id) ? "checked" : ""} onchange='toggleDataImportMappingSelection(${JSON.stringify(item.id)}, this.checked)' aria-label="Select mapping row"></div>
      <div>
        <div class="data-import2-review-title">${escapeHtml(item.originalField)}</div>
        <div class="data-import2-review-meta">${escapeHtml(item.sourceSystem)} · ${escapeHtml(item.reportTypeLabel)}<br>${escapeHtml(item.sourceFile)} · ${escapeHtml(item.sheetName)}</div>
        <div class="data-import2-review-flags">
          ${item.isNew ? `<span class="data-import2-chip bad">New Source</span>` : ""}
          ${item.status === "Needs Mapping" ? `<span class="data-import2-chip bad">Needs Mapping</span>` : ""}
          ${item.status === "Low Confidence" ? `<span class="data-import2-chip warn">Review Required</span>` : ""}
          ${item.status === "Conflict" ? `<span class="data-import2-chip bad">Conflict</span>` : ""}
          ${item.locked ? `<span class="data-import2-chip">Default</span>` : ""}
        </div>
      </div>
      <div>
        <div class="data-import2-small-label">Sample / Type</div>
        <div class="data-import2-review-title">${escapeHtml(item.sampleValue === 0 ? "0" : (item.sampleValue || "No sample"))}</div>
        <div class="data-import2-review-meta">${escapeHtml(item.detectedDataType || "Type not detected")}<br>Updated ${escapeHtml(item.lastUpdated ? dataImportFormatTimestamp(item.lastUpdated) : "Default")} by ${escapeHtml(item.updatedBy || "ATLAS")}</div>
      </div>
      <div>
        <div class="data-import2-small-label">Map To</div>
        <select class="data-import2-map-select" onchange='updateDataImportMappingDraft(${JSON.stringify(item.id)}, this.value)'>${renderDataImportDestinationOptions(destination, item.suggestedField)}</select>
        <div class="data-import2-review-meta">Current: ${escapeHtml(dataImportMappingDestinationLabel(item.currentField || "Unmapped"))}<br>Suggested: ${escapeHtml(item.suggestedField ? dataImportMappingDestinationLabel(item.suggestedField) : "ATLAS needs Admin input")}${confidence && confidence < 85 ? ` · ${escapeHtml(confidence)}%` : ""}</div>
      </div>
      <div>
        <span class="data-import2-status ${dataImportStatusClass(item.status)}">${escapeHtml(item.status)}</span>
        <div class="data-import2-inline-actions" style="margin-top:8px">
          <button class="btn btn-blue btn-sm" onclick='saveDataImportMappingReviewItem(${JSON.stringify(item.id)})' ${!destination || destination === "__create_custom__" ? "disabled" : ""}>Approve Mapping</button>
          ${item.suggestedField ? `<button class="btn btn-gray btn-sm" onclick='acceptDataImportMappingSuggestion(${JSON.stringify(item.id)})'>Accept Suggestion</button>` : ""}
          <button class="btn btn-blue btn-sm" onclick='previewDataImportMappingItem(${JSON.stringify(item.id)})'>Preview</button>
          <button class="btn btn-gray btn-sm" onclick='ignoreDataImportMappingItem(${JSON.stringify(item.id)})'>Ignore</button>
        </div>
      </div>
      ${dataImport2State.selectedMappingPreviewId === item.id ? renderDataImportMappingPreview() : ""}
      ${dataImport2State.selectedMappingPreviewId === item.id && destination === "__create_custom__" ? `<div style="grid-column:1 / -1">${renderDataImportCustomFieldManager()}</div>` : ""}
    </div>`;
  }).join("")}</div>`;
}

function renderDataImportSourceDefinitionsManager() {
  const reportOptions = [`<option value="unknown">Needs Review / New Report</option>`, ...DATA_IMPORT_REPORT_ORDER.map(type => `<option value="${type}">${escapeHtml(dataImportReportLabel(type))}</option>`)].join("");
  const rows = (dataImport2State.sourceDefinitions || []).slice(0, 18);
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-database"></i>Add Data Source</div>
    <div class="data-import2-form-grid wide">
      <label class="data-import2-field"><div class="data-import2-small-label">Source Name</div><input id="data-import-source-name" placeholder="Entrata Box Score"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Source System</div><input id="data-import-source-system" placeholder="Entrata"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Report Type</div><select id="data-import-source-report-type">${reportOptions}</select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Expected Frequency</div><input id="data-import-source-frequency" placeholder="Weekly"></label>
      <label class="data-import2-field data-import2-field-wide"><div class="data-import2-small-label">Description</div><input id="data-import-source-description" placeholder="What this report contains"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Expected Fields</div><input id="data-import-source-fields" placeholder="Occupancy, applications, leads"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Feeds Modules</div><input id="data-import-source-modules" placeholder="Portfolio Dashboard, DLR"></label>
    </div>
    <div class="data-import2-inline-actions" style="margin-top:10px"><button class="btn btn-blue btn-sm" onclick="saveDataImportSourceDefinition()">+ Add Data Source</button></div>
    <div class="data-import2-compact-table" style="margin-top:12px">
      <table class="data-import2-table">
        <thead><tr><th>Source</th><th>Report Type</th><th>Frequency</th><th>Feeds</th><th>Status</th></tr></thead>
        <tbody>${rows.map(source => `<tr>
          <td><strong>${escapeHtml(source.sourceName)}</strong><div class="data-import2-file-meta">${escapeHtml(source.sourceSystem || "Any source system")}</div></td>
          <td>${escapeHtml(source.reportType ? dataImportReportLabel(source.reportType) : "Needs Review")}</td>
          <td>${escapeHtml(source.expectedFrequency || "Not set")}</td>
          <td>${escapeHtml(source.modules || "Not set")}</td>
          <td><span class="data-import2-status ${source.active === false ? "info" : "ready"}">${escapeHtml(source.active === false ? "Inactive" : "Active")}</span><div style="margin-top:5px"><button class="btn btn-gray btn-sm" onclick='toggleDataImportSourceDefinition(${JSON.stringify(source.id)})'>${source.active === false ? "Activate" : "Deactivate"}</button></div></td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
  </div>`;
}

function renderDataImportCustomFieldManager() {
  const categories = DATA_IMPORT_DESTINATION_GROUPS.map(group => group.label);
  if (!dataImportCanManageArchitecture()) {
    return `<div class="data-import2-card"><div class="data-import2-section-title"><i class="ph ph-lock"></i>ATLAS Field Library</div><div class="data-import2-detail-panel">Your role can map imports to approved fields. New field creation and field architecture are available to ATLAS Administrators and Data Managers.</div></div>`;
  }
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-plus-circle"></i>Create New ATLAS Field</div>
    <div class="data-import2-detail-panel" style="margin-bottom:10px">Fields created here are governed ATLAS metadata fields. Import-created fields also retain their source field, source system, batch, creator, and creation date.</div>
    <div class="data-import2-form-grid wide">
      <label class="data-import2-field"><div class="data-import2-small-label">Field Name</div><input id="data-import-custom-field-name" placeholder="Renewal Risk Score"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Display Label</div><input id="data-import-custom-field-label" placeholder="Renewal Risk Score"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Category / Module</div><select id="data-import-custom-field-category">${categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Data Type</div><select id="data-import-custom-field-type"><option>Text</option><option>Number</option><option>Currency</option><option>Percentage</option><option>Date</option><option>Status</option><option>Yes / No</option></select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Record Type</div><select id="data-import-custom-field-behavior"><option value="current_state">Current-State Data</option><option value="historical">Historical Snapshot</option><option value="lifecycle">Lifecycle Data</option></select></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Scope</div><select id="data-import-custom-field-scope"><option value="portfolio">Portfolio-Wide</option><option value="property">Property-Specific</option></select></label>
      <label class="data-import2-field data-import2-field-wide"><div class="data-import2-small-label">Description</div><input id="data-import-custom-field-description" placeholder="How ATLAS should interpret this field"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Default Value</div><input id="data-import-custom-field-default" placeholder="Optional"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Allowed Values</div><input id="data-import-custom-field-values" placeholder="Comma-separated options"></label>
      <label class="data-import2-field data-import2-field-wide"><div class="data-import2-small-label">Validation Rules</div><input id="data-import-custom-field-validation" placeholder="Range, format, or required-value rules"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Allowed Modules</div><input id="data-import-custom-field-modules" placeholder="Reporting, Bonus Engine"></label>
    </div>
    <div class="data-import2-supported" style="justify-content:flex-start;margin-top:10px">
      ${[["required","Required",false],["searchable","Searchable",true],["filterable","Filterable",true],["reportable","Reportable",true],["dashboard","Dashboard Metric Eligible",false],["import","Import Eligible",true],["api","API / Feed Eligible",false],["stores-history","Store History",true],["sensitive","Sensitive / Restricted",false]].map(([key,label,checked]) => `<label class="data-import2-chip" style="display:inline-flex;align-items:center;gap:5px"><input id="data-import-custom-field-${key}" type="checkbox"${checked ? " checked" : ""}>${label}</label>`).join("")}
    </div>
    <div class="data-import2-inline-actions" style="margin-top:10px"><button class="btn btn-blue btn-sm" onclick="saveDataImportCustomField()">+ Create New ATLAS Field</button></div>
  </div>`;
}

function renderDataImportMappingHistory() {
  const audits = dataImport2State.mappingAuditTrail || [];
  if (!audits.length) return `<div class="data-import2-detail-panel">No mapping changes have been saved yet. Each Admin mapping approval will appear here with the previous and new destination.</div>`;
  return `<div class="data-import2-compact-table">
    <table class="data-import2-table">
      <thead><tr><th>Source Field</th><th>Change</th><th>Impact</th><th>Audit</th><th></th></tr></thead>
      <tbody>${audits.slice(0, 36).map(audit => `<tr>
        <td><strong>${escapeHtml(audit.sourceField)}</strong><div class="data-import2-file-meta">${escapeHtml(audit.sourceSystem || "Global")} · ${escapeHtml(audit.sourceFile || "Mapping rule")}</div></td>
        <td>${escapeHtml(dataImportMappingDestinationLabel(audit.previousDestination || "Unmapped"))} → <strong>${escapeHtml(dataImportMappingDestinationLabel(audit.newDestination))}</strong></td>
        <td>${escapeHtml((audit.downstreamModules || []).slice(0, 5).join(", ") || "No downstream module listed")}</td>
        <td>${escapeHtml(dataImportFormatTimestamp(audit.changedAt))}<div class="data-import2-file-meta">${escapeHtml(audit.changedBy || "Admin")} · ${escapeHtml(audit.reason || "Mapping updated")}</div></td>
        <td>${audit.previousDestination ? `<button class="btn btn-gray btn-sm" onclick='restoreDataImportMappingAudit(${JSON.stringify(audit.id)})'>Restore Previous</button>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function renderDataImportLearningLibrary() {
  const rules = (dataImport2State.mappingRules || [])
    .filter(rule => !rule.locked || rule.createdAt || Number(rule.confirmationCount || 0) || Number(rule.successfulUses || 0) || rule.learningStatus === "Permanently Ignored")
    .sort((a, b) => (Date.parse(b.lastUsedAt || b.updatedAt || b.savedAt || "") || 0) - (Date.parse(a.lastUsedAt || a.updatedAt || a.savedAt || "") || 0));
  const settings = dataImport2State.learningSettings || {};
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-brain"></i>Learned Mapping Library</div>
    <div class="data-import2-detail-panel"><strong>Unknown → Asked → Answered → Learned → Suggested → Trusted → Automated</strong><br>Repeated confirmations strengthen a source-specific rule. Overrides lower confidence, low-confidence data never maps silently, and locked rules remain under administrator control.</div>
    ${dataImportCanManageArchitecture() ? `<div class="data-import2-form-grid" style="margin-top:10px">
      <label class="data-import2-field"><div class="data-import2-small-label">Automatic At</div><input id="data-import-learning-auto" type="number" min="1" max="100" value="${escapeHtml(settings.autoMapThreshold || 95)}"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Suggest At</div><input id="data-import-learning-suggest" type="number" min="1" max="99" value="${escapeHtml(settings.suggestionThreshold || 80)}"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Review At</div><input id="data-import-learning-review" type="number" min="0" max="98" value="${escapeHtml(settings.reviewThreshold || 60)}"></label>
      <label class="data-import2-field"><div class="data-import2-small-label">Trust After Confirmations</div><input id="data-import-learning-trust-count" type="number" min="2" max="10" step="1" value="${escapeHtml(settings.trustConfirmationCount || 3)}"></label>
      <button class="btn btn-gray btn-sm" onclick="saveDataImportLearningThresholds()">Save Thresholds</button>
    </div>` : ""}
    ${rules.length ? `<div class="data-import2-compact-table" style="margin-top:12px"><table class="data-import2-table"><thead><tr><th>Source Context</th><th>Destination</th><th>Confidence</th><th>Uses / Overrides</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${rules.slice(0, 100).map(rule => `<tr>
      <td><strong>${escapeHtml(rule.originalField)}</strong><div class="data-import2-file-meta">${escapeHtml(rule.sourceSystem || "Global")} · ${escapeHtml(rule.reportType ? dataImportReportLabel(rule.reportType) : "Any report")} · ${escapeHtml(rule.scope || "Exact Source + Report")}</div></td>
      <td>${escapeHtml(dataImportMappingDestinationLabel(rule.canonicalField || "Needs Mapping"))}<br><button class="btn btn-gray btn-sm" onclick='previewDataImportMappingItem(${JSON.stringify(`rule_${rule.id}`)})'>Edit / Preview</button></td>
      <td><strong>${escapeHtml(Number(rule.confidence || 0))}%</strong><div class="data-import2-file-meta">${escapeHtml(Number(rule.confirmationCount || 0))} confirmations</div></td>
      <td>${escapeHtml(Number(rule.successfulUses || 0))} / ${escapeHtml(Number(rule.overrideCount || 0))}</td>
      <td><span class="data-import2-status ${dataImportStatusClass(rule.status || rule.learningStatus)}">${escapeHtml(rule.learningStatus || "Learning")}</span></td>
      <td>${escapeHtml(dataImportFormatTimestamp(rule.lastUsedAt || rule.updatedAt || rule.savedAt))}<div class="data-import2-file-meta">${escapeHtml(rule.updatedBy || rule.createdBy || "ATLAS")}</div></td>
      <td>${dataImportCanManageArchitecture() ? `<div class="data-import2-inline-actions"><button class="btn btn-gray btn-sm" onclick='updateDataImportLearningRule(${JSON.stringify(rule.id)}, "approve")'>Trust</button><button class="btn btn-gray btn-sm" onclick='updateDataImportLearningRule(${JSON.stringify(rule.id)}, "lock")'>${rule.locked ? "Unlock" : "Lock"}</button><button class="btn btn-gray btn-sm" onclick='updateDataImportLearningRule(${JSON.stringify(rule.id)}, "reset")'>Reset</button>${rule.canonicalField === "__ignored__" ? `<button class="btn btn-gray btn-sm" onclick='updateDataImportLearningRule(${JSON.stringify(rule.id)}, "reactivate")'>Reactivate</button>` : `<button class="btn btn-gray btn-sm" onclick='updateDataImportLearningRule(${JSON.stringify(rule.id)}, "ignore")'>Always Ignore</button>`}<button class="btn btn-gray btn-sm" onclick='updateDataImportLearningRule(${JSON.stringify(rule.id)}, "delete")'>Delete</button></div>` : ""}</td>
    </tr>`).join("")}</tbody></table></div>` : `<div class="data-import2-detail-panel" style="margin-top:10px">No user-taught mappings yet. Confirming an import question will create the first learning record here.</div>`}
  </div>`;
}

function renderDataImportAliasCoverage() {
  const grouped = new Map();
  (dataImport2State.mappingRules || []).forEach(rule => {
    if (!rule.canonicalField || rule.canonicalField === "__ignored__") return;
    if (!grouped.has(rule.canonicalField)) grouped.set(rule.canonicalField, []);
    grouped.get(rule.canonicalField).push(rule.originalField);
  });
  const rows = Array.from(grouped.entries()).sort((a, b) => dataImportMappingDestinationLabel(a[0]).localeCompare(dataImportMappingDestinationLabel(b[0]))).slice(0, 18);
  return `<div class="data-import2-compact-table">
    <table class="data-import2-table">
      <thead><tr><th>ATLAS Destination</th><th>Source Aliases Feeding It</th></tr></thead>
      <tbody>${rows.map(([destination, aliases]) => `<tr>
        <td><strong>${escapeHtml(dataImportMappingDestinationLabel(destination))}</strong><div class="data-import2-file-meta">${escapeHtml(dataImportDestinationCategory(destination))}</div></td>
        <td>${aliases.slice(0, 8).map(alias => `<span class="data-import2-chip">${escapeHtml(alias)}</span>`).join(" ")}${aliases.length > 8 ? ` <span class="data-import2-chip info">${aliases.length - 8} more</span>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function renderDataImportMappingRulesView() {
  const allItems = dataImportBuildMappingReviewItems();
  const visibleItems = dataImportFilterMappingReviewItems(allItems);
  const selectedPreview = allItems.find(item=>item.id===dataImport2State.selectedMappingPreviewId);
  if (selectedPreview && !visibleItems.some(item=>item.id===selectedPreview.id)) visibleItems.unshift(selectedPreview);
  const counts = dataImportMappingReviewCounts(allItems);
  const newSourceRows = dataImportBuildNewSourceReviewItems();
  return `<div class="data-import2-shell">
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-arrows-left-right"></i>Import Learning Review</div>
      ${renderDataImportMappingReviewSummary(counts)}
      ${dataImport2State.mappingBatchFilter ? `<button class="btn btn-blue btn-sm" onclick="reconnectMappedDelinquencyBatch()">Reconnect this batch to Collections</button>` : ""}
      <div class="data-import2-detail-panel" style="margin-top:10px">ATLAS suggests a destination using the source system, report, tab, field, sample values, and prior decisions. Users can accept it, choose a different destination, skip it only for this upload, or create a governed ATLAS field without restarting the import.</div>
    </div>
    ${renderDataImportLearningLibrary()}
    ${renderDataImportNewSourceQueue(newSourceRows)}
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-list-checks"></i>Source Field Mapping Queue</div>
      ${renderDataImportMappingToolbar(allItems)}
      ${renderDataImportMappingReviewList(visibleItems)}
    </div>
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-arrows-clockwise"></i>Add Global Mapping Rule</div>
      <div class="data-import2-form-grid">
        <label class="data-import2-field"><div class="data-import2-small-label">Source Field</div><input id="data-import-map-original" placeholder="Occ %"></label>
        <label class="data-import2-field"><div class="data-import2-small-label">Map To</div><select id="data-import-map-canonical">${renderDataImportDestinationOptions()}</select></label>
        <button class="btn btn-blue btn-sm" onclick="saveDataImportMappingRule()">Save Globally</button>
      </div>
    </div>
    ${renderDataImportSourceDefinitionsManager()}
    ${(dataImport2State.mappingDrafts || {})[dataImport2State.selectedMappingPreviewId] === "__create_custom__" ? "" : renderDataImportCustomFieldManager()}
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-stack"></i>Metric Source Hierarchy</div>
      <div class="data-import2-detail-panel">Default KPI precedence is Box Score first for overlapping operational KPIs, with other source values preserved as history and lineage. Metric-level overrides can be taught here as ATLAS adds more sources.</div>
    </div>
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-git-branch"></i>Destination Alias Coverage</div>
      ${renderDataImportAliasCoverage()}
    </div>
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-clock-counter-clockwise"></i>Mapping Audit Trail</div>
      ${renderDataImportMappingHistory()}
    </div>
  </div>`;
}

function renderDataImportAliasesView() {
  const communityOptions = dataImportGetHealthCommunityNames().map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  const aliases = dataImport2State.propertyAliases || [];
  const unmapped = (dataImport2State.exceptions || []).filter(issue => issue.type === "unmapped" && issue.status !== "Resolved" && dataImportIssueBelongsToActiveCommunity(issue));
  return `<div class="data-import2-shell">
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-map-pin"></i>Property Alias Manager</div>
      <div class="data-import2-form-grid">
        <label class="data-import2-field"><div class="data-import2-small-label">Community</div><select id="data-import-alias-community">${communityOptions}</select></label>
        <label class="data-import2-field"><div class="data-import2-small-label">Alias</div><input id="data-import-alias-value" placeholder="Doro Residences Jacksonville"></label>
        <button class="btn btn-blue btn-sm" onclick="saveDataImportPropertyAlias()">Save Alias</button>
      </div>
    </div>
    <div class="data-import2-card">
      <div class="data-import2-section-title"><i class="ph ph-question"></i>Unmapped Property Queue</div>
      ${unmapped.length ? `<table class="data-import2-table"><tbody>${unmapped.map(issue => `<tr><td>${escapeHtml(issue.fileName || "Source file")}</td><td>${escapeHtml(issue.detail || "")}</td><td><button class="btn btn-gray btn-sm" onclick='${issue.type === "unmapped" ? "openDataImportExceptionMapping" : "resolveDataImportException"}(${JSON.stringify(issue.id)})'>${issue.type === "unmapped" ? "Resolve Mapping" : "Mark Resolved"}</button></td></tr>`).join("")}</tbody></table>` : `<div class="data-import2-detail-panel">No unmapped property rows are waiting for review.</div>`}
    </div>
    <div class="data-import2-card">
      <table class="data-import2-table">
        <thead><tr><th>Alias</th><th>Community</th><th>Saved</th><th></th></tr></thead>
        <tbody>${aliases.slice(0, 100).map(alias => `<tr>
          <td>${escapeHtml(alias.alias)}</td>
          <td>${escapeHtml(alias.communityName)}</td>
          <td>${alias.savedAt ? escapeHtml(dataImportFormatTimestamp(alias.savedAt)) : "Default"}</td>
          <td>${alias.locked ? `<span class="data-import2-chip">Default</span>` : `<button class="btn btn-gray btn-sm" onclick='deleteDataImportPropertyAlias(${JSON.stringify(alias.id)})'>Delete</button>`}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
  </div>`;
}

function dataImportHistoryDisplay(collection) {
  if (!dataImport2State.historyStorage) return { rows: dataImport2State[collection] || [], controls: "", unavailable: false };
  const page = typeof dataImportHistoryPages === "undefined" ? null : dataImportHistoryPages[collection];
  const fresh = page && page.revision === dataImport2State.historyStorage.revision;
  const offset = Math.max(0, Number(page?.offset) || 0);
  const action = target => `loadDataImportHistoryPage('${collection}',${target})`;
  const controls = `<div class="data-import2-detail-panel" role="status" style="margin-bottom:12px">
    ${page?.error ? `<p>${escapeHtml(page.error)}</p>` : ""}
    <span>${page?.loading ? "Loading saved history…" : fresh ? `${offset + (page.rows.length ? 1 : 0)}–${offset + page.rows.length} of ${Number(page.total) || 0} saved records` : "Load saved history to review all retained records."}</span>
    <button class="btn btn-gray btn-sm" onclick="${action(fresh ? offset : 0)}" ${page?.loading ? "disabled" : ""}>${fresh ? "Refresh" : "Load history"}</button>
    ${fresh ? `<button class="btn btn-gray btn-sm" onclick="${action(Math.max(0, offset - 25))}" ${page.loading || offset === 0 ? "disabled" : ""}>Previous</button><button class="btn btn-gray btn-sm" onclick="${action(Math.max(0, Number(page.nextOffset) || 0))}" ${page.loading || page.nextOffset === null || page.nextOffset === undefined ? "disabled" : ""}>Next</button>` : ""}
  </div>`;
  return { rows: fresh ? page.rows : [], controls, unavailable: !fresh };
}

function renderDataImportHistoryView() {
  const history = dataImportHistoryDisplay("batches");
  const batches = history.rows;
  if (!batches.length) return `<div class="data-import2-card"><div class="data-import2-section-title"><i class="ph ph-clock-counter-clockwise"></i>Import History</div>${history.controls}${history.unavailable ? "" : `<div class="data-import2-detail-panel">No import batches have been approved yet.</div>`}</div>`;
  const latestAudit = renderDataImportDownstreamAudit(batches[0]?.downstreamAudit || [], batches[0]?.id || "");
  const latestFiles = batches[0]?.files || [];
  const latestLineage = (dataImport2State.lineage || []).filter(item => item.batchId === batches[0]?.id).slice(0, 20);
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-clock-counter-clockwise"></i>Import History</div>
    ${history.controls}
    <table class="data-import2-table">
      <thead><tr><th>Batch</th><th>Approved</th><th>Files</th><th>Audit</th><th>Status</th><th></th></tr></thead>
      <tbody>${batches.map(batch => `<tr>
        <td><strong>${escapeHtml(batch.id)}</strong><div class="data-import2-file-meta">Uploaded by ${escapeHtml(batch.uploader || "Admin")}</div></td>
        <td>${escapeHtml(dataImportFormatTimestamp(batch.approvedAt || batch.createdAt))}</td>
        <td>${escapeHtml((batch.files || []).map(file => file.reportTypeLabel || file.fileName).slice(0, 3).join(", ") || "Import files")}<div class="data-import2-file-meta">${escapeHtml(batch.summary?.files || 0)} file(s) · ${escapeHtml(batch.summary?.communities || 0)} communities</div></td>
        <td>${escapeHtml(batch.summary?.rowsReviewed || 0)} reviewed · ${escapeHtml(batch.summary?.readyToImport || 0)} written · ${escapeHtml(batch.summary?.duplicatesIgnored || 0)} duplicates · ${escapeHtml(batch.summary?.held || 0)} held · ${escapeHtml(batch.summary?.rejected || 0)} rejected<div class="data-import2-file-meta">${escapeHtml((batch.routeMessages || []).slice(0, 2).join(" "))}</div><div class="data-import2-file-meta">${escapeHtml(dataImportSummarizeDownstreamAudit(batch.downstreamAudit))}</div></td>
        <td><span class="data-import2-status ${dataImportStatusClass(batch.status)}">${escapeHtml(batch.status)}</span>${batch.rollback?.reason ? `<div class="data-import2-file-meta">Reason: ${escapeHtml(batch.rollback.reason)}</div>` : ""}</td>
        <td>${batch.status === "Approved" ? `<button class="btn btn-gray btn-sm" onclick='rollbackDataImportBatch(${JSON.stringify(batch.id)})'>Rollback</button>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
    ${batches[0]?.learningSummary ? `<div class="data-import2-detail-panel" style="margin-top:12px"><div class="data-import2-section-title"><i class="ph ph-brain"></i>ATLAS Learned From This Import</div><div class="data-import2-supported" style="justify-content:flex-start"><span class="data-import2-chip info">${escapeHtml(batches[0].learningSummary.fieldsAutomaticallyMapped || 0)} fields automatically mapped</span><span class="data-import2-chip info">${escapeHtml(batches[0].learningSummary.mappingDecisionsConfirmed || 0)} decisions confirmed</span><span class="data-import2-chip info">${escapeHtml(batches[0].learningSummary.newAtlasFieldsCreated || 0)} new fields</span><span class="data-import2-chip">${escapeHtml(batches[0].learningSummary.fieldsIgnoredForImport || 0)} ignored for this import</span><span class="data-import2-chip">${escapeHtml(batches[0].learningSummary.permanentIgnoreRulesAdded || 0)} permanent ignore rules</span></div>${(batches[0].learningSummary.learnedChanges || []).length ? `<div class="data-import2-file-meta" style="margin-top:8px">${escapeHtml(batches[0].learningSummary.learnedChanges.join(" · "))}</div>` : ""}</div>` : ""}
    ${latestFiles.length ? `<div style="margin-top:12px"><div class="data-import2-section-title"><i class="ph ph-list-checks"></i>Latest Row Disposition</div><table class="data-import2-table"><thead><tr><th>Source</th><th>Coverage</th><th>Inserted</th><th>Corrected</th><th>Unchanged</th><th>Duplicate</th><th>Held</th><th>Rejected</th><th>Destinations</th></tr></thead><tbody>${latestFiles.map(file => `<tr><td><strong>${escapeHtml(file.fileName)}</strong><div class="data-import2-file-meta">${escapeHtml(file.reportTypeLabel || "")}</div></td><td>${escapeHtml((file.communities || []).length)}${file.coverageExpected ? `/${escapeHtml(file.coverageExpected)}` : ""} communities${(file.coverageGaps || []).length ? `<div class="data-import2-file-meta">Gaps: ${escapeHtml(file.coverageGaps.slice(0, 4).join(", "))}${file.coverageGaps.length > 4 ? ` +${file.coverageGaps.length - 4}` : ""}</div>` : ""}</td><td>${escapeHtml(file.rowsInserted || 0)}</td><td>${escapeHtml(file.rowsUpdated || 0)}</td><td>${escapeHtml(file.rowsUnchanged || 0)}</td><td>${escapeHtml(file.duplicatesIgnored || 0)}</td><td>${escapeHtml(file.rowsHeld || 0)}</td><td>${escapeHtml(file.rowsRejected || 0)}</td><td>${escapeHtml((file.downstreamMetricsRefreshed || []).join(", ") || "Archive only")}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${latestLineage.length ? `<div style="margin-top:12px"><div class="data-import2-section-title"><i class="ph ph-git-branch"></i>Latest Source Lineage</div><table class="data-import2-table"><thead><tr><th>Community / Period</th><th>ATLAS Field</th><th>Imported Value</th><th>Original Source</th><th>Location</th><th>State</th></tr></thead><tbody>${latestLineage.map(item => `<tr><td><strong>${escapeHtml(item.communityName)}</strong><div class="data-import2-file-meta">${escapeHtml(item.periodKey)}</div></td><td>${escapeHtml(dataImportCanonicalFieldLabel(item.atlasField))}</td><td>${escapeHtml(item.importedValue)}</td><td>${escapeHtml(item.sourceFile)}<div class="data-import2-file-meta">${escapeHtml(item.originalField || item.atlasField)}</div></td><td>${escapeHtml(item.sourceSheet || "Workbook")} ${item.sourceRow ? `row ${escapeHtml(item.sourceRow)}` : ""}</td><td><span class="data-import2-status ${item.currentState ? "ready" : "info"}">${item.currentState ? "Current" : "Historical"}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${latestAudit ? `<div style="margin-top:12px"><div class="data-import2-section-title"><i class="ph ph-check-circle"></i>Latest Destination Check</div>${latestAudit}</div>` : ""}
  </div>`;
}

function renderDataImportArchiveView() {
  const history = dataImportHistoryDisplay("sourceArchive");
  const entries = history.rows;
  if (!entries.length) return `<div class="data-import2-card"><div class="data-import2-section-title"><i class="ph ph-archive"></i>Source Archive</div>${history.controls}${history.unavailable ? "" : `<div class="data-import2-detail-panel">No original source files have been archived yet.</div>`}</div>`;
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-archive"></i>Source File Archive</div>
    ${history.controls}
    ${dataImportCanManageArchitecture() ? `<button class="btn btn-blue btn-sm" onclick="applyAtlasOccupancyReplay()">Apply reviewed occupancy revision</button>` : ""}
    <table class="data-import2-table">
      <thead><tr><th>Source File</th><th>Classification</th><th>Communities</th><th>Batch</th><th>Status</th><th></th></tr></thead>
      <tbody>${entries.map(entry => `<tr>
        <td><strong>${escapeHtml(entry.fileName)}</strong><div class="data-import2-file-meta">${escapeHtml(dataImportFormatBytes(entry.size))} · received ${escapeHtml(dataImportFormatTimestamp(entry.metadata?.receivedAt || entry.uploadedAt))}${entry.originalZipName ? ` · ZIP ${escapeHtml(entry.originalZipName)}` : ""}</div><div class="data-import2-file-meta">SHA-256 ${escapeHtml((entry.fileHash || "not recorded").slice(0, 16))}${entry.fileHash ? "…" : ""}</div></td>
        <td>${escapeHtml(entry.reportTypeLabel || dataImportReportLabel(entry.reportType))}<div class="data-import2-file-meta">${escapeHtml(entry.sourceSystem || "Unknown")} · ${escapeHtml(entry.reportingPeriodLabel || "Period not detected")}</div><div class="data-import2-file-meta">Generated ${escapeHtml(dataImportFormatTimestamp(entry.metadata?.generatedAt, "not recorded"))} · as of ${escapeHtml(dataImportFormatTimestamp(entry.metadata?.dataAsOf || entry.dataDateIso, "not recorded"))}</div></td>
        <td>${(entry.communities || []).slice(0, 4).map(name => `<span class="data-import2-chip good">${escapeHtml(name)}</span>`).join(" ") || `<span class="data-import2-chip warn">Unmapped</span>`}</td>
        <td>${escapeHtml(entry.batchId || "")}<div class="data-import2-file-meta">Original review: ${escapeHtml(entry.rowsReviewed || 0)} reviewed · ${escapeHtml(entry.rowsUpdated || 0)} corrected · ${escapeHtml(entry.rowsHeld || 0)} held</div><div class="data-import2-file-meta">${escapeHtml(entry.mappingVersion || "ATLAS-RRIM-1.0")}</div>${entry.reprocessResult ? `<div class="data-import2-file-meta">Latest replay: ${(entry.reprocessResult.communities || []).length} communities · ${entry.reprocessResult.rowsHeld || 0} held · ${(entry.reprocessResult.issues || []).length} review items${entry.reprocessResult.sharedRecords ? ` · ${entry.reprocessResult.sharedRecords} shared records` : ""}</div>` : ""}</td>
        <td><span class="data-import2-status ${dataImportStatusClass(entry.importStatus)}">${escapeHtml(entry.importStatus || "Archived")}</span><div class="data-import2-file-meta">${escapeHtml(entry.storageStatus || "Metadata")}</div></td>
        <td><button class="btn btn-gray btn-sm" onclick='downloadDataImportArchiveFile(${JSON.stringify(entry.id)})'>Download</button>${entry.reportType === "box_score" && entry.importStatus === "Approved" && dataImportCanManageArchitecture() ? `<button class="btn btn-gray btn-sm" onclick='previewAtlasOccupancyReplay(${JSON.stringify(entry.id)})'>Preview occupancy repair</button>` : ""}${entry.occupancyRevisions?.length ? `<div class="data-import2-file-meta">Occupancy revisions: ${entry.occupancyRevisions.length} · ${escapeHtml(dataImportFormatTimestamp(entry.occupancyRevisions.at(-1).createdAt))}</div>` : ""}${["box_score", "trending_occupancy", "delinquency", "leasing_resident_data"].includes(entry.reportType) && entry.importStatus === "Approved" && dataImportCanManageArchitecture() ? `<button class="btn btn-blue btn-sm" onclick='reprocessDataImportBoxScore(${JSON.stringify(entry.id)})'>Reconcile approved source</button>` : ""}${entry.reprocessedAt ? `<div class="data-import2-file-meta">Refreshed ${escapeHtml(dataImportFormatTimestamp(entry.reprocessedAt))}</div>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function renderDataImportDependencyView() {
  return `<div class="data-import2-card">
    <div class="data-import2-section-title"><i class="ph ph-tree-structure"></i>Data Dependencies</div>
    <table class="data-import2-table">
      <thead><tr><th>Source Report</th><th>Freshness</th><th>Feeds</th><th>Default Source Role</th></tr></thead>
      <tbody>${DATA_IMPORT_REPORT_ORDER.map(type => {
        const def = dataImportGetReportDef(type);
        return `<tr>
          <td><strong>${escapeHtml(def.label)}</strong><div class="data-import2-file-meta">${escapeHtml(def.sourceSystems.join(", "))}</div></td>
          <td>${escapeHtml(def.freshness.label)}</td>
          <td>${escapeHtml(def.dependencies.join(", "))}</td>
          <td>${type === "box_score" ? "Authoritative for duplicate operational KPIs when present." : "Preserved as source history unless metric-level precedence says otherwise."}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  </div>`;
}

function renderDataImport2View(health) {
  if (dataImport2State.activeView === "upload") return renderDataImportUploadCenter();
  if (dataImport2State.activeView === "health") return renderDataImportHealthView(health);
  if (dataImport2State.activeView === "exceptions") return renderDataImportExceptionsView();
  if (dataImport2State.activeView === "mapping") return renderDataImportMappingRulesView();
  if (dataImport2State.activeView === "aliases") return renderDataImportAliasesView();
  if (dataImport2State.activeView === "history") return renderDataImportHistoryView();
  if (dataImport2State.activeView === "archive") return renderDataImportArchiveView();
  return `${renderDataImportOverview(health)}${renderDataImportDependencyView()}`;
}

function renderDataImport2Tab() {
  dataImport2State = normalizeDataImport2State(dataImport2State);
  const health = dataImportBuildHealthModel();
  const errorHTML = csvError ? `<div class="${getCsvAlertClass(csvError)} mb4">${escapeHtml(csvError)}</div>` : "";
  const logHTML = csvLog.length > 0 ? `<div class="alert-green mb4">${csvLog.map((l,i) => `<div style="${i===0?"color:#3fb950;font-weight:600":"color:var(--muted)"}">${escapeHtml(l)}</div>`).join("")}</div>` : "";
  return `<div class="data-import2-shell">
    ${dataImportPreviewController ? `<div id="atlas-import-preview-status" role="status" aria-live="polite">Inspecting workbook…</div>` : ""}
    ${renderDataImportHero(health)}
    ${renderDataImportTabs()}
    ${errorHTML}
    ${logHTML}
    ${renderDataImport2View(health)}
  </div>`;
}
window.AtlasImportWorkspace = true;
