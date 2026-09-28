/* Reports UI and document templates. Loaded on demand; shared calculations stay in the shell. */
let atlasReportRenderContext = null;
let atlasReportSourceEpoch = 0;
function atlasReportMemoizedCall(fn, args) {
  if (!atlasReportRenderContext) return fn(...args);
  let node = atlasReportRenderContext.get(fn);
  if (!node) atlasReportRenderContext.set(fn, node = new Map());
  for (const argument of args) {
    if (!node.has(argument)) node.set(argument, new Map());
    node = node.get(argument);
  }
  if (!node.has(atlasReportMemoResult)) node.set(atlasReportMemoResult, fn(...args));
  return node.get(atlasReportMemoResult);
}
const atlasReportMemoResult = Symbol("report synchronous result");
// These selectors are read-only during a report render. Exact argument identity
// matters: different records, periods, or names must never reuse one another.
// The context is discarded before returning to the event loop, so edits and
// actor/access/source changes always start with fresh values on the next render.
for (const name of ["getAtlasAccessProfile", "getAtlasCentralStatus", "getAtlasCommunityAccessRecord", "normalizeCommunityLookupName", "matchPropertyName", "getPropertyByName", "defaultSavedCommunityRecord", "normalizePropertyTeamConfig", "rebuildBonusRolesByQuarter", "normalizeSavedCommunityRecord", "buildCommunityDetailForMonth", "getCommunityCommandApprovedGoal", "communityCommandSharedGoalScope", "getRecordSavedBudgetOccPct", "getRenewalMonthEntryForRecord", "getImportReadinessStatus", "buildCommunityProgressTrendRows"]) {
  const original = window[name];
  if (typeof original === "function") window[name] = (...args) => atlasReportMemoizedCall(original, args);
}
// The record default factory is used only by normalizeSavedCommunityRecord,
// which spreads its top level and does not mutate the default tree. Reports read
// the retained nested defaults; outside this synchronous context the factory
// still produces a fresh mutable tree for every call.
// Staffing counts and quarter templates likewise retain only read-only normalized
// inputs here. Do not memoize buildPropertyBonusRoles or mergeMetricList: quarterly
// evaluation intentionally writes actuals onto their fresh per-evaluation copies.
// Month selectors read exactly these three source fields. Report builders make
// shallow record copies for each month; those copies still share the same source
// arrays. Reuse that work within this synchronous render, without retaining any
// record or result after its source/access context can change.
for (const name of ["normalizeCommunityMonthlySources", "getRecordMonthlyDataForYear"]) {
  const original = window[name];
  if (typeof original !== "function") continue;
  const select = (monthlyData, monthlyHistoryByPeriod, savedBudgetTargets, year) =>
    original({monthlyData, monthlyHistoryByPeriod, savedBudgetTargets}, year);
  window[name] = (record, ...rest) => !atlasReportRenderContext || !record || typeof record !== "object"
    ? original(record, ...rest)
    : atlasReportMemoizedCall(select, [record.monthlyData, record.monthlyHistoryByPeriod, record.savedBudgetTargets, ...rest]);
}
let atlasCommunityProgressPreview = null;
function atlasExactReportInputString(input) { return atlasExactPresentationInputString(input); }

function atlasCommunityProgressPreviewInputs() {
  // Cache only this preview: other report types have independent remote stores.
  // Serialize current values (including in-place edits), never object identity.
  if (typeof PROPERTIES === "undefined" || typeof dataImport2State === "undefined" ||
      typeof atlasCommunityGoalStore === "undefined" || typeof photoAssetUrlCache === "undefined") return null;
  try {
    return atlasExactReportInputString({
      schema: "community-progress-preview-v1", context: atlasReportPreviewContext(),
      today: getAtlasTodayISODate(), properties: PROPERTIES, records: savedData,
      currentFallback: savedData?.[getProp().name] ? null : getCurrentCommunityRecord(),
      selectedProperty: getProp().name, monthScope: portfolioMonthScopeByPeriod,
      communityScopeMode: getCommunityScopeMode(), view: communityProgressViewMode,
      bonusQuarter, regionalAssignments, jacsTeamBonus, command: communityCommandState,
      shared: atlasSharedData, sharedGraph: localStorage.getItem("atlas_shared_property_graph_v1"),
      goals: {actor: atlasCommunityGoalStore.actor, scopes: [...atlasCommunityGoalStore.scopes]},
      photos: [...photoAssetUrlCache],
      // A published metric is read from its retained value and lineage. Mapping
      // rules/drafts govern a future import; normalizing their audit/confidence
      // metadata must not rebuild an otherwise identical retained report.
      imports: Object.fromEntries(["canonicalRecords", "lineage", "propertyAliases",
        "sourceDefinitions", "freshnessPolicies", "reportRequirementOverrides", "closedPeriods", "customFields"]
        .map(key => [key, dataImport2State[key]]))
    });
  } catch { return null; } // Unknown/unserializable input always recomputes.
}
const atlasBuildCommunityProgressPreview = window.renderCommunityProgressReportingWorkspace;
if (typeof atlasBuildCommunityProgressPreview === "function") window.renderCommunityProgressReportingWorkspace = (...args) => {
  const inputs = atlasCommunityProgressPreviewInputs();
  if (inputs !== null && atlasCommunityProgressPreview?.inputs === inputs) {
    window.AtlasPerformance?.record?.("report-preview-cache-hit");
    return atlasCommunityProgressPreview.html;
  }
  window.AtlasPerformance?.record?.("report-preview-cache-miss", 0, { reason: inputs === null ? "unavailable-input" : "changed-input" });
  const html = atlasBuildCommunityProgressPreview(...args);
  atlasCommunityProgressPreview = inputs === null ? null : { inputs, html };
  return html;
};
function atlasReportPortfolioDetails(month, records = savedData, year = new Date().getFullYear()) {
  if (!atlasReportRenderContext) return buildPortfolioDetailsForMonth(month, records, year);
  let periods = atlasReportRenderContext.get(records);
  if (!periods) atlasReportRenderContext.set(records, periods = new Map());
  const key = `${year}|${month}`;
  if (!periods.has(key)) periods.set(key, buildPortfolioDetailsForMonth(month, records, year));
  return periods.get(key);
}
function atlasReportPreviewContext() {
  const central = window.ATLAS_CENTRAL;
  const profile = typeof getAtlasAccessProfile === "function" ? getAtlasAccessProfile() || {} : {};
  const config = central?.getConfig?.() || {};
  return JSON.stringify({
    actor: central?.getSession?.()?.user?.id || "", database: config.supabaseUrl || config.apiBaseUrl || "",
    accessContext: central?.getAccessContextKey?.() || "",
    selectedCommunity: typeof getProp === "function" ? getProp()?.name : "",
    workspaceMonth: typeof getSelectedDashboardMonthIndex === "function" ? getSelectedDashboardMonthIndex() : null,
    source: typeof atlasWorkspaceAccess === "undefined" ? null : [atlasWorkspaceAccess.source, atlasWorkspaceAccess.binding],
    profile: { user: profile.user_id, employee: profile.employee_id, role: profile.role, status: profile.status,
      accountStatus: profile.account_status, communities: profile.allowed_community_ids, regions: profile.allowed_region_values,
      markets: profile.allowed_market_values, tabs: profile.locked_tab_ids, pages: profile.locked_page_keys,
      bonus: profile.bonus_permissions || profile.bonusPermissions, communityRecords: profile.community_access_records },
    period: [getReportHubYear(), getReportHubMonthIndex()], type: reportHubType,
    perspective: reportHubPerspective, workspace: typeof workspaceScopeValue === "undefined" ? "" : workspaceScopeValue,
    filters: portfolioReportFilters, sections: portfolioReportSections,
    selectedCommunities: reportHubCommunityProgressCommunities, lvr: reportHubLvrCommunity,
    sourceEpoch: atlasReportSourceEpoch,
    documentVersion: typeof atlasCentralRuntimeMeta === "undefined" ? null : [atlasCentralRuntimeMeta.lastDocumentVersion, atlasCentralRuntimeMeta.lastDocumentHash]
  });
}
const atlasReportRenderedMarkup = new WeakMap();
function atlasRenderReportsInto(panel, html) {
  const context = atlasReportPreviewContext();
  const retained = atlasReportRenderedMarkup.get(panel);
  // Equal computed output and access/source context need no DOM replacement.
  // Verify node identity too, since another workspace can replace this panel.
  if (retained?.html === html && retained.context === context &&
      retained.children.length === panel.childNodes.length &&
      retained.children.every((node, index) => node === panel.childNodes[index])) return;
  const template = document.createElement("template");
  template.innerHTML = html;
  const previous = panel.querySelector("#reporting-inline-preview");
  const next = template.content.querySelector("#reporting-inline-preview");
  if (previous?.parentNode === panel && next?.parentNode === template.content &&
      panel.dataset.reportPreviewContext === context && previous.outerHTML === next.outerHTML) {
    // Keep the iframe connected: moving it through a fragment would reload its document.
    for (const child of [...panel.childNodes]) if (child !== previous) child.remove();
    let before = true;
    for (const child of [...template.content.childNodes]) {
      if (child === next) { before = false; continue; }
      if (before) panel.insertBefore(child, previous); else panel.appendChild(child);
    }
  } else panel.replaceChildren(template.content);
  panel.dataset.reportPreviewContext = context;
  atlasReportRenderedMarkup.set(panel, { html, context, children: [...panel.childNodes] });
}
window.AtlasReports = Object.freeze({
  details: atlasReportPortfolioDetails, renderInto: atlasRenderReportsInto,
  beginRender() { const previous = atlasReportRenderContext; atlasReportRenderContext ||= new Map(); return previous; },
  endRender(previous) { atlasReportRenderContext = previous; }
});
function atlasReportAccessContext() {
  const central = window.ATLAS_CENTRAL;
  return central?.getAccessContextKey?.() || JSON.stringify([central?.getSession?.()?.user?.id,
    central?.getConfig?.(), typeof getAtlasAccessProfile === "function" ? getAtlasAccessProfile() : null]);
}
let atlasReportLastAccessContext = atlasReportAccessContext();
window.addEventListener("atlas-central-auth-change", () => {
  const next = atlasReportAccessContext();
  if (next !== atlasReportLastAccessContext) {
    atlasReportLastAccessContext = next; atlasReportSourceEpoch += 1; atlasCommunityProgressPreview = null;
  }
});
for (const event of ["atlas-finance-updated", "atlas-reforecast-updated", "atlas-application-hydrated"]) {
  window.addEventListener(event, () => { atlasReportSourceEpoch += 1; atlasCommunityProgressPreview = null; });
}
function renderReportingTab() {
  const previous = atlasReportRenderContext;
  atlasReportRenderContext ||= new Map();
  try { return renderReportingTabContent(); }
  finally { atlasReportRenderContext = previous; }
}
function renderReportingTabContent() {
  if (reportHubType === "investor_community_packet") {
    reportHubPerspective = "investor";
    return `<div style="margin-bottom:14px"><button class="btn btn-gray btn-sm" onclick="setReportHubType('monthly_investor_deck')">All reporting options</button></div>${AtlasPacketUI.render()}`;
  }
  ensureValidReportHubAction();
  reportHubType = normalizeReportHubType(reportHubType);
  if (!["dlr", "bonus_payout", "community_progress", "market_comparison", "leasing_velocity", "renewal_performance", "financial_review", "eviction_report", "application_resident_data"].includes(reportHubType) && reportHubPerspective === "regional") {
    reportHubPerspective = "investor";
  }
  if (reportHubType === "community_progress" || reportHubType === "market_comparison" || reportHubType === "leasing_velocity" || reportHubType === "renewal_performance" || reportHubType === "financial_review" || reportHubType === "eviction_report" || reportHubType === "application_resident_data") {
    reportHubPerspective = "csuite";
  }
  if (normalizeReportHubType(reportHubType) === "dlr") {
    syncDlrTargetFromReportHub({ preserveCommunity: true });
  }
  const normalizedType = normalizeReportHubType(reportHubType);
  const reportHubContacts = ensureReportHubRecipientSelection();
  const reportHubActionOptions = getReportHubActionOptions();
  const isCommunitySelectionReport = ["community_progress", "market_comparison"].includes(normalizedType);
  // These reports have their own exact community picker and no portfolio scope
  // or recommendations editor. Their recipient lookup already reads that scope.
  const reportBuilderDetails = isCommunitySelectionReport ? [] : atlasReportPortfolioDetails(getReportHubMonthIndex());
  const reportableCommunityNames = isCommunitySelectionReport ? getReportableCommunityNames(getReportHubMonthIndex()) : [];
  const communityProgressSelectionNames = isCommunitySelectionReport ? getCommunityProgressReportCommunityNames() : [];
  const selectedRecipientCount = reportHubContacts.filter(contact => reportHubRecipientKeys.includes(contact.key)).length;
  const isLvrReport = normalizedType === "leasing_velocity";
  const currentScopeName = isCommunitySelectionReport
    ? getCommunityProgressReportScopeLabel()
    : isLvrReport
      ? getLvrReportCommunityName()
      : getWorkspaceScopeDisplayName();
  const currentScopeMode = isCommunitySelectionReport
    ? (communityProgressSelectionNames.length === 0
      ? "select one or more communities"
      : `${communityProgressSelectionNames.length > 1 ? "multi-community c-suite mode" : "single-community c-suite mode"}`)
    : isLvrReport
      ? "single-community LVR mode"
      : (isPortfolioWorkspaceSelected() ? "portfolio aggregate mode" : "community-specific mode");
  const reportHubRecipientsHtml = reportHubContacts.length > 0
    ? reportHubContacts.map(contact => {
        const isActive = reportHubRecipientKeys.includes(contact.key);
        const label = contact.name ? `${contact.name} · ${contact.community}` : `${contact.email} · ${contact.community}`;
        return `<button type="button" class="bonus-community-chip${isActive ? " active" : ""}" onclick='toggleReportHubRecipient(${JSON.stringify(contact.key)})'>
          ${escapeHtml(label)}
          <span>${escapeHtml(contact.email)}</span>
        </button>`;
      }).join("")
    : `<div style="font-size:0.72rem;color:var(--muted)">No saved community contacts are available in the current scope yet.</div>`;
  const reportMonthLabel = `${getDashboardMonthLabel(getReportHubMonthIndex())} ${getReportHubYear()}`;
  const selectedReportSections = getSelectedPortfolioReportSections();
  const ownerFilterSummary = normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE
    ? `${(portfolioReportFilters.investorGroups ?? []).length} distribution group(s) · ${(portfolioReportFilters.investorCommunities ?? []).length} property override${(portfolioReportFilters.investorCommunities ?? []).length === 1 ? "" : "s"}`
    : `${(portfolioReportFilters.investorGroups ?? []).length} investor group(s) · ${(portfolioReportFilters.investorCommunities ?? []).length} highlighted communit${(portfolioReportFilters.investorCommunities ?? []).length === 1 ? "y" : "ies"}`;
  const communityProgressFilterSummary = `${communityProgressSelectionNames.length} communit${communityProgressSelectionNames.length === 1 ? "y" : "ies"} selected`;
  const reportNeedsScopeBuilder = normalizedType !== "dlr" && normalizedType !== "bonus_payout" && normalizedType !== "leasing_velocity" && normalizedType !== "renewal_performance" && normalizedType !== "financial_review" && normalizedType !== "eviction_report" && normalizedType !== "application_resident_data" && !["community_progress", "market_comparison"].includes(normalizedType);
  const reportNeedsSectionBuilder = normalizedType !== RISE_WEEKLY_LEASING_REPORT_TYPE && normalizedType !== "dlr" && normalizedType !== "bonus_payout" && normalizedType !== "leasing_velocity" && normalizedType !== "renewal_performance" && normalizedType !== "financial_review" && normalizedType !== "eviction_report" && normalizedType !== "application_resident_data" && !["community_progress", "market_comparison"].includes(normalizedType);
  const reportTypeDescription = normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE
    ? "Printable weekly application activity, professional workload, and documented concessions with month-to-date context."
    : normalizedType === "investor_marketing_report"
    ? "Combines traffic and funnel performance with comp calculator and market-survey context."
    : normalizedType === "monthly_investor_deck"
      ? "Builds the branded monthly report deck from the selected investor scope."
      : normalizedType === "bonus_payout"
        ? "Payroll-ready payout reporting using the saved bonus calculator data."
        : normalizedType === "dlr"
          ? "Single-community daily leasing report with upload-backed activity checks."
          : normalizedType === "leasing_velocity"
            ? "Portable ATLAS LVR export with stabilized and lease-up views, image slots, and print-ready Letter pages."
          : normalizedType === "renewal_performance"
            ? "Central Services renewal conversion, rent growth, pricing discipline, and employee performance from imported tracker records."
          : normalizedType === "financial_review"
            ? "Budget Builder financial operating review using preserved budgets, uploaded actuals, variance drivers, commentary, exceptions, forecast and report packs."
          : normalizedType === "eviction_report"
            ? "Central Services eviction, stipulation, court-funds, exception, attorney, judge, and outcome reporting from imported delinquency cases."
          : normalizedType === "application_resident_data"
            ? "Application and resident-data import validation, property mapping, lifecycle totals, and monthly ATLAS variance review."
          : normalizedType === "community_progress"
            ? "C-suite month-to-date community progress report with photo-led visuals, pace analysis, and explicit data alerts when source fields are incomplete."
            : normalizedType === "market_comparison"
              ? "C-suite market-versus-subject report built from the weekly AptIQ survey feed and saved community metrics."
          : "Investor-facing operating snapshot across the selected investor groups and highlighted communities.";
  const investorOptions = reportNeedsScopeBuilder ? getInvestorReportFilterOptions() : [];
  const scopeFilterHTML = reportNeedsScopeBuilder ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
      <div class="report-hub-card">
        <div class="card-title" style="margin-bottom:8px">${normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE ? "Portfolio / Distribution Groups" : "Investor Groups"}</div>
        <div class="bonus-assignment-chip-wrap">
          ${investorOptions.length > 0 ? investorOptions.map(name => {
            const isActive = (portfolioReportFilters.investorGroups ?? []).includes(name);
            return `<button class="bonus-community-chip ${isActive ? "active" : ""}" onclick='togglePortfolioReportFilter("investorGroups", ${JSON.stringify(name)})'>${escapeHtml(name)}</button>`;
          }).join("") : `<div style="font-size:0.72rem;color:var(--muted)">${normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE ? "Add group names in Community Setup to filter or distribute this report." : "Add investor names in Community Setup to group communities here."}</div>`}
        </div>
      </div>
      <div class="report-hub-card">
        <div class="card-title" style="margin-bottom:8px">${normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE ? "Property / Portfolio Scope" : "Highlighted Communities"}</div>
        <div class="bonus-assignment-chip-wrap">
          ${reportBuilderDetails.map(detail => {
            const name = detail.name;
            const isActive = (portfolioReportFilters.investorCommunities ?? []).includes(name);
            return `<button class="bonus-community-chip ${isActive ? "active" : ""}" onclick='togglePortfolioReportFilter("investorCommunities", ${JSON.stringify(name)})'>${escapeHtml(name)}</button>`;
          }).join("") || `<div style="font-size:0.72rem;color:var(--muted)">Save communities to filter them here.</div>`}
        </div>
      </div>
    </div>` : "";
  const communityProgressScopeHTML = ["community_progress", "market_comparison"].includes(normalizedType)
    ? `<div class="report-hub-card" style="margin-bottom:14px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div class="card-title" style="margin-bottom:6px">${normalizedType === "market_comparison" ? "Market Comparison Selection" : "Community Selection"}</div>
          <p style="font-size:0.72rem;color:var(--muted)">${normalizedType === "market_comparison"
            ? "Pick one or more communities to compare against their weekly APTIQ submarket snapshots. The top summary rolls them up together and the detailed sections break out each community below."
            : "Pick one or more communities to feed the report. The top summary rolls them up together and the detailed sections break out each community below."}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-gray btn-sm" onclick="setAllCommunityProgressReportCommunities(true)">Select All</button>
          <button class="btn btn-gray btn-sm" onclick="setAllCommunityProgressReportCommunities(false)">Clear</button>
        </div>
      </div>
      <div style="font-size:0.68rem;color:var(--muted);margin-bottom:10px">${escapeHtml(communityProgressFilterSummary)} · ${escapeHtml(communityProgressSelectionNames.join(", ") || "No communities selected yet")}</div>
      <div class="bonus-assignment-chip-wrap">
        ${reportableCommunityNames.length > 0 ? reportableCommunityNames.map(name => {
          const isActive = communityProgressSelectionNames.includes(name);
          const hasSavedData = Boolean(savedData?.[name] || (name === getProp().name && getCurrentCommunityRecord()));
          return `<button class="bonus-community-chip ${isActive ? "active" : ""}${hasSavedData ? "" : " missing"}" onclick='toggleCommunityProgressReportCommunity(${JSON.stringify(name)})'>${escapeHtml(name)}</button>`;
        }).join("") : `<div style="font-size:0.72rem;color:var(--muted)">No saved communities are available for the selected month yet.</div>`}
      </div>
    </div>`
    : "";
  const editableRecommendationDetails = ["community_progress", "market_comparison"].includes(normalizedType)
    ? []
    : isLvrReport
    ? getReportBuilderScopedDetails().slice(0, 1)
    : (reportHubPerspective === "csuite" || reportHubPerspective === "regional")
    ? getScopedPortfolioReportDetails(reportBuilderDetails).slice(0, 8)
    : [];
  const recommendationsEditorHtml = editableRecommendationDetails.length > 0
    ? `<div class="report-hub-card" style="margin-top:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div class="card-title" style="margin-bottom:6px">Editable Management Recommendations</div>
          <p>${reportHubPerspective === "csuite" ? "These recommendations flow into C-Suite style report pulls so you can tune the management adjustments before exporting." : "Regional view keeps the sharper operating focus and pain-point detail editable before export."}</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">
        ${editableRecommendationDetails.map(detail => `<label style="display:block">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
            <span style="font-size:0.72rem;font-weight:700;color:var(--text)">${escapeHtml(detail.name)}</span>
            <button type="button" class="btn btn-gray btn-sm" onclick='resetReportRecommendationOverride(${JSON.stringify(detail.name)})'>Reset</button>
          </div>
          <textarea rows="5" onchange='updateReportRecommendationOverride(${JSON.stringify(detail.name)}, this.value)' style="min-height:110px">${escapeHtml(getEditableReportRecommendation(detail))}</textarea>
        </label>`).join("")}
      </div>
    </div>`
    : "";
  return `<div class="card mb4">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <h2 style="font-size:0.95rem;font-weight:700;margin-bottom:4px">🗂 Reporting Hub</h2>
        <p style="font-size:0.72rem;color:var(--muted)">Build the report from the current month, selected investor scope, and highlighted communities, then review the live preview below before you export or email it.</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-gray btn-sm" onmousedown="return queueCurrentWorkspaceTab(7)">Open Data Import</button>
        ${normalizedType === "bonus_payout" ? `<button type="button" class="btn btn-gray btn-sm" onmousedown="return queueCurrentWorkspaceTab(9)">Open Bonus Calc</button>` : ""}
        <button type="button" class="btn btn-gray btn-sm" onmousedown="return queueCurrentWorkspaceTab(0)">Back to Portfolio Home</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:14px">
      <div class="report-hub-card">
        <div class="card-title" style="margin-bottom:6px">Current Scope</div>
        <div style="font-size:0.82rem;font-weight:700;color:var(--accent)">${escapeHtml(currentScopeName)}</div>
        <div style="font-size:0.68rem;color:var(--muted);margin-top:6px">${escapeHtml(reportMonthLabel)} report period · ${escapeHtml(currentScopeMode)}</div>
      </div>
      <div class="report-hub-card">
        <div class="card-title" style="margin-bottom:6px">Report Type</div>
        <select onchange="setReportHubType(this.value)">
          <option value="${RISE_WEEKLY_LEASING_REPORT_TYPE}" ${reportHubType===RISE_WEEKLY_LEASING_REPORT_TYPE?"selected":""}>${RISE_WEEKLY_LEASING_REPORT_TITLE}</option>
          <option value="dlr" ${reportHubType==="dlr"?"selected":""}>DLR</option>
          <option value="investor_marketing_report" ${reportHubType==="investor_marketing_report"?"selected":""}>Marketing Report</option>
          <option value="bonus_payout" ${reportHubType==="bonus_payout"?"selected":""}>Bonus Payout Report</option>
          <option value="monthly_investor_deck" ${reportHubType==="monthly_investor_deck"?"selected":""}>Monthly Report</option>
          <option value="investor_community_packet" ${reportHubType==="investor_community_packet"?"selected":""}>Investor Community Packet</option>
          <option value="community_progress" ${reportHubType==="community_progress"?"selected":""}>Community Progress Report</option>
          <option value="market_comparison" ${reportHubType==="market_comparison"?"selected":""}>Market Comparison Report</option>
          <option value="leasing_velocity" ${reportHubType==="leasing_velocity"?"selected":""}>Leasing Velocity Report</option>
          <option value="renewal_performance" ${reportHubType==="renewal_performance"?"selected":""}>Renewal Performance Report</option>
          <option value="financial_review" ${reportHubType==="financial_review"?"selected":""}>Budget vs Actual Financial Review</option>
          <option value="eviction_report" ${reportHubType==="eviction_report"?"selected":""}>Eviction Report</option>
          <option value="application_resident_data" ${reportHubType==="application_resident_data"?"selected":""}>Application / Resident Data Report</option>
        </select>
        <div style="font-size:0.66rem;color:var(--muted);margin-top:6px">${escapeHtml(reportTypeDescription)}</div>
      </div>
      <div class="report-hub-card">
        <div class="card-title" style="margin-bottom:6px">Report View</div>
        ${normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE || normalizedType === "community_progress" || normalizedType === "leasing_velocity" || normalizedType === "renewal_performance" || normalizedType === "financial_review" || normalizedType === "eviction_report" || normalizedType === "application_resident_data"
          ? `<div style="padding:8px 10px;border:1px solid var(--border2);border-radius:10px;background:var(--bg2);font-size:0.78rem;font-weight:700;color:var(--accent)">${normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE ? "Portfolio Leasing Weekly" : (normalizedType === "leasing_velocity" ? "LVR Template" : (normalizedType === "application_resident_data" ? "Import Validation View" : "C-Suite View"))}</div>
             <div style="font-size:0.66rem;color:var(--muted);margin-top:6px">${normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE ? "Preview, print, HTML, CSV and Excel use the same selected week and authorized reporting scope." : (normalizedType === "leasing_velocity" ? "The exported template contains its own stabilized / lease-up mode control." : "This report is locked to a c-suite lens so the output stays focused on operating performance and data confidence checks.")}</div>`
          : `<select onchange="setReportHubPerspective(this.value)">
              <option value="investor" ${reportHubPerspective==="investor"?"selected":""}>Investor facing</option>
              <option value="csuite" ${reportHubPerspective==="csuite"?"selected":""}>C-Suite View</option>
            </select>
            <div style="font-size:0.66rem;color:var(--muted);margin-top:6px">${reportHubPerspective === "investor" ? "Highlights wins and keeps the delivery investor-ready." : "High-level, clear wins and headwinds with management adjustments shown as controlled actions."}</div>`}
      </div>
      <div class="report-hub-card">
        <div class="card-title" style="margin-bottom:6px">Report Period</div>
        <div style="display:grid;grid-template-columns:1fr 92px;gap:8px">
          <select onchange="setReportHubDateField('month', this.value)">
            ${MONTHS.map((month, idx) => `<option value="${idx}" ${idx===getReportHubMonthIndex()?"selected":""}>${month}</option>`).join("")}
          </select>
          <input type="number" min="2020" max="2099" value="${getReportHubYear()}" onchange="setReportHubDateField('year', this.value)">
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr);gap:12px;margin-bottom:14px">
      <div class="report-hub-card">
        <div class="card-title" style="margin-bottom:6px">Action</div>
        <select onchange="setReportHubAction(this.value)">
          ${reportHubActionOptions.map(option => `<option value="${option.value}" ${reportHubAction===option.value?"selected":""}>${option.label}</option>`).join("")}
        </select>
      </div>
      <div class="report-hub-card">
        <div class="card-title" style="margin-bottom:6px">Run Selected Action</div>
        <button class="btn btn-blue btn-sm" onclick="runReportHubAction()">${escapeHtml(getReportHubTypeLabel())} · ${reportHubActionOptions.find(option => option.value === reportHubAction)?.label || "Run"}</button>
        <div style="font-size:0.68rem;color:var(--muted);margin-top:8px">${selectedRecipientCount} recipient${selectedRecipientCount === 1 ? "" : "s"} selected for email actions.</div>
      </div>
    </div>
    ${reportNeedsScopeBuilder ? `<div class="report-hub-card" style="margin-bottom:14px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div class="card-title" style="margin-bottom:6px">${normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE ? "Property / Portfolio Scope" : "Portfolio Report Builder"}</div>
          <p style="font-size:0.72rem;color:var(--muted)">${normalizedType === RISE_WEEKLY_LEASING_REPORT_TYPE ? "Default output is the full RISE portfolio. Select a group or property only when the weekly report needs a narrower scope." : "Use investor groups and highlighted communities to define the reporting scope. The live preview below updates from this builder."}</p>
        </div>
        <div style="font-size:0.68rem;color:var(--muted)">${ownerFilterSummary}</div>
      </div>
      ${reportNeedsSectionBuilder ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px">
        <div class="report-hub-card">
          <div class="card-title" style="margin-bottom:8px">Sections to Include</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">
            ${Object.keys(portfolioReportSections).map(sectionKey => `<label style="display:flex;align-items:center;gap:8px;font-size:0.72rem;color:var(--text)">
              <input type="checkbox" ${portfolioReportSections[sectionKey]?"checked":""} onchange="setPortfolioReportSection('${sectionKey}',this.checked)">
              <span>${getPortfolioReportSectionLabel(sectionKey)}</span>
            </label>`).join("")}
          </div>
        </div>
      </div>` : ""}
      ${scopeFilterHTML}
    </div>` : ""}
    ${communityProgressScopeHTML}
    <div class="report-hub-card" style="margin-bottom:14px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <h3 style="font-size:0.85rem;font-weight:700;margin-bottom:6px">Recipient Selection</h3>
          <p style="font-size:0.72rem;color:var(--muted)">Use the saved community contact list for the current scope. Select one, many, or all before using the email draft action.</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-gray btn-sm" onclick="setAllReportHubRecipients(true)">Select All</button>
          <button class="btn btn-gray btn-sm" onclick="setAllReportHubRecipients(false)">Clear</button>
        </div>
      </div>
      <div class="bonus-assignment-chip-wrap">${reportHubRecipientsHtml}</div>
    </div>
    ${recommendationsEditorHtml}
  </div>
  ${renderReportHubInlinePreview(normalizedType, selectedReportSections)}`;
}

function renderReportHubPreviewFrame(title, description, documentHtml, controlsHtml = "") {
  if (!documentHtml) {
    return `<div class="card mb4" id="reporting-inline-preview">
      <div class="report-hub-card">
        <div class="alert-red">The selected report could not be previewed yet. Adjust the current scope or save the required source data first.</div>
      </div>
    </div>`;
  }
  return `<div class="card mb4" id="reporting-inline-preview">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <h3 style="font-size:0.9rem;font-weight:700;margin-bottom:6px">${escapeHtml(title)} Preview</h3>
        <p style="font-size:0.72rem;color:var(--muted)">${escapeHtml(description)}</p>
      </div>
      ${controlsHtml ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${controlsHtml}</div>` : ""}
    </div>
    <iframe title="${escapeHtml(title)} Preview" srcdoc="${escapeHtml(documentHtml)}" style="width:100%;min-height:980px;border:1px solid var(--border);border-radius:16px;background:#fff"></iframe>
  </div>`;
}

function renderReportHubFinancialReviewBridge() {
  const reportOutputs = [
    "Property Financial Review",
    "Budget vs Actual Report",
    "YTD Variance Report",
    "Monthly Financial Review",
    "Executive Financial Summary",
    "Portfolio Financial Comparison",
    "Material Variance Report",
    "Unmapped Account Report"
  ];
  return `<div class="card mb4" id="reporting-inline-preview">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <h3 style="font-size:0.9rem;font-weight:700;margin-bottom:6px">Budget vs Actual Financial Review Preview</h3>
        <p style="font-size:0.72rem;color:var(--muted)">The financial review runs inside Budget Builder so it can use the preserved annual budget, uploaded monthly actuals, account mapping, variance drivers, commentary and report packs without duplicating financial state.</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-blue btn-sm" onmousedown="return openAtlasBudgetFinancialReview('financialreview')">Open Financial Review</button>
        <button class="btn btn-gray btn-sm" onmousedown="return openAtlasBudgetFinancialReview('reports')">Open Report Packs</button>
      </div>
    </div>
    <div class="report-hub-card" style="margin-bottom:14px">
      <div class="card-title" style="margin-bottom:8px">Financial Reporting Outputs</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">
        ${reportOutputs.map(name => `<div style="padding:8px 10px;border:1px solid var(--border2);border-radius:8px;background:var(--bg2);font-size:0.72rem;font-weight:700;color:var(--text)">${escapeHtml(name)}</div>`).join("")}
      </div>
      <p style="font-size:0.72rem;color:var(--muted);margin-top:10px">Doro is the first working property for this review. Additional properties will appear in the comparison view once their monthly actuals are uploaded.</p>
    </div>
  </div>`;
}

function renderReportHubInlinePreview(type = normalizeReportHubType(reportHubType), selectedSections = getSelectedPortfolioReportSections()) {
  if (type === RISE_WEEKLY_LEASING_REPORT_TYPE) {
    return renderRisePortfolioLeasingWeeklyWorkspace();
  }
  if (type === "dlr") {
    return `<div class="card mb4" id="reporting-inline-preview">${renderDlrReportingWorkspace()}</div>`;
  }
  if (type === "leasing_velocity") {
    return renderLvrTemplateWorkspace();
  }
  if (type === "community_progress") {
    return `<div class="card mb4" id="reporting-inline-preview">${renderCommunityProgressReportingWorkspace()}</div>`;
  }
  if (type === "market_comparison") {
    return renderMarketComparisonReportingWorkspace();
  }
  if (type === "financial_review") {
    return renderReportHubFinancialReviewBridge();
  }
  if (type === "bonus_payout") {
    return renderReportHubPreviewFrame(
      "Bonus Payout Report",
      "Payroll-ready output built from the saved bonus calculator state.",
      buildBonusPayoutReportDocument(),
      `<button class="btn btn-gray btn-sm" onclick="exportBonusPayoutCSV()">⬇ CSV</button><button class="btn btn-blue btn-sm" onclick="openBonusPayoutReport(true)">🖨 PDF / Print</button>`
    );
  }
  if (type === "renewal_performance") {
    return typeof window.renderAtlasRenewalPerformanceReport === "function"
      ? `<div class="card mb4" id="reporting-inline-preview">${window.renderAtlasRenewalPerformanceReport({ monthIdx: getReportHubMonthIndex(), year: getReportHubYear(), periodMode: "month" })}</div>`
      : `<div class="card mb4" id="reporting-inline-preview"><div class="report-hub-card"><div class="alert-red">Renewal Performance Report is unavailable until Central Services finishes loading.</div></div></div>`;
  }
  if (type === "eviction_report") {
    return typeof window.renderAtlasEvictionReport === "function"
      ? `<div class="card mb4" id="reporting-inline-preview">${window.renderAtlasEvictionReport({ monthIdx: getReportHubMonthIndex(), year: getReportHubYear(), periodMode: "month" })}</div>`
      : `<div class="card mb4" id="reporting-inline-preview"><div class="report-hub-card"><div class="alert-red">Eviction Report is unavailable until Central Services finishes loading.</div></div></div>`;
  }
  if (type === "application_resident_data") {
    applicationResidentDataState = normalizeApplicationResidentDataState({
      ...applicationResidentDataState,
      reportMonthIdx: getReportHubMonthIndex(),
      reportYear: getReportHubYear()
    });
    return typeof window.renderApplicationResidentDataReportingWorkspace === "function"
      ? window.renderApplicationResidentDataReportingWorkspace()
      : `<div class="card mb4" id="reporting-inline-preview"><div class="report-hub-card"><div class="alert-red">Application / Resident Data Report is unavailable until Data Import finishes loading.</div></div></div>`;
  }
  if (selectedSections.length === 0) {
    return `<div class="card mb4" id="reporting-inline-preview">
      <div class="report-hub-card">
        <div class="alert-red">Select at least one report section to build the preview.</div>
      </div>
    </div>`;
  }
  if (type === "monthly_investor_deck") {
    const report = buildMonthlyInvestorPresentationData("monthly_investor_deck", { silent: true });
    return renderReportHubPreviewFrame(
      "Monthly Report",
      "Branded monthly report deck preview for the selected investor scope.",
      report ? buildMonthlyInvestorPresentationDocument(report) : "",
      `<button class="btn btn-gray btn-sm" onclick="downloadMonthlyInvestorPresentationBrief()">⬇ Editable HTML</button><button class="btn btn-blue btn-sm" onclick="openMonthlyInvestorPresentation(true)">🖨 PDF / Print</button>`
    );
  }
  const payload = buildPortfolioReportRows({ silent: true });
  return renderReportHubPreviewFrame(
    type === "investor_marketing_report" ? "Marketing Report" : "Community Report",
    type === "investor_marketing_report"
      ? "Preview blends traffic and funnel momentum with comp calculator and market-survey context."
      : "Preview shows the current investor-facing operating report for the selected scope.",
    payload ? buildPortfolioPerformanceReportDocument(payload.report) : "",
    `<button class="btn btn-gray btn-sm" onclick="exportPortfolioReportCSV()">⬇ CSV</button><button class="btn btn-gray btn-sm" onclick="exportPortfolioReportExcel()">📊 Excel</button><button class="btn btn-blue btn-sm" onclick="openPortfolioPerformanceReport(true)">🖨 PDF / Print</button>`
  );
}

function buildPortfolioPerformanceReportDocument(report) {
  if (!report) return "";
  const recommendationSourcesBySection = {
    overview: ["Overview", "Traffic", "Renewals"],
    traffic: ["Traffic"],
    renewals: ["Renewals"],
    reputation: []
  };
  const brandMark = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
    <img src="${resolveExportBrandLogoSrc()}" alt="ATLAS RISE logo" style="height:34px;width:auto;object-fit:contain;display:block;flex:0 0 auto">
    <div>
      <div style="font-size:20px;font-weight:700;color:#1d4ed8">${report.title}</div>
      <div style="font-size:12px;color:#6b7280">${report.subtitle} · ${report.scopeSummary} · Generated ${report.generatedAt.toLocaleString()}</div>
    </div>
  </div>`;
  const sectionBlocks = report.selectedSections.map(sectionKey => {
    const label = getPortfolioReportSectionLabel(sectionKey);
    const portfolioMetrics = buildPortfolioSectionMetrics(sectionKey, report.aggregate);
    const detailBlocks = report.mode === "regional"
      ? report.details.map(detail => {
          const metrics = buildPortfolioSectionMetrics(sectionKey, detail.summary);
          const recommendations = detail.recommendations.filter(item => (recommendationSourcesBySection[sectionKey] ?? []).includes(item.source));
          const recommendationText = getEditableReportRecommendation(detail);
          return `<div style="margin-top:14px;padding:12px;border:1px solid #d1d5db;border-radius:10px">
            <div style="font-size:14px;font-weight:700;margin-bottom:8px">${detail.name}</div>
            <table style="width:100%;border-collapse:collapse">
              <tbody>${metrics.map(item => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#4b5563">${item.metric}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:700;text-align:right">${item.value}</td></tr>`).join("")}</tbody>
            </table>
            ${(recommendations.length > 0 || recommendationText) ? `<div style="margin-top:10px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:6px">${escapeHtml(getReportPerspectiveLabel())} Recommendations</div><div style="font-size:12px;color:#374151;line-height:1.65;white-space:pre-line">${escapeHtml(recommendationText)}</div></div>` : ""}
          </div>`;
        }).join("")
      : "";
    return `<section style="margin-bottom:20px">
      <h2 style="font-size:16px;margin:0 0 10px;color:#111827">${label}</h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #d1d5db;border-radius:10px;overflow:hidden">
        <tbody>${portfolioMetrics.map(item => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#4b5563">${item.metric}</td><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:700;text-align:right">${item.value}</td></tr>`).join("")}</tbody>
      </table>
      ${detailBlocks}
    </section>`;
  }).join("");
  const investorMarketingBlocks = report.type === "investor_marketing_report"
    ? report.details.map(detail => {
        const market = buildRegionalPricingWorksheetSnapshot(detail, null, report.currentMonthIdx);
        const snapshot = buildCompCalculatorSnapshotData(detail, market, report.currentMonthIdx);
        const compRows = snapshot.landscapeRows.slice(0, 6).map(row => `<tr>
          <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:12px">${escapeHtml(row.name)}${row.isSubject ? " (Subject)" : ""}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right">${row.rent > 0 ? formatDlrCurrency(row.rent) : "—"}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right">${row.ner > 0 ? formatDlrCurrency(row.ner) : "—"}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right">${formatPresentationPercentValue(row.leasedPct)} / ${formatPresentationPercentValue(row.exposurePct)}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right">${Math.round(row.applicationsLast30 || 0)} / ${Math.round(row.leasesLast30 || 0)}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:12px">${escapeHtml(row.concessionDetails || "—")}</td>
        </tr>`).join("");
        return `<section style="margin-bottom:22px;padding:14px;border:1px solid #d1d5db;border-radius:12px">
          <h2 style="font-size:16px;margin:0 0 6px;color:#111827">${escapeHtml(detail.name)} Marketing + Comp Intelligence</h2>
          <div style="font-size:12px;color:#4b5563;line-height:1.6;margin-bottom:10px">${escapeHtml(snapshot.recommendation.summary)} ${escapeHtml(market.pricingNotes || market.compNarrative || "")}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px">
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px"><strong>${formatDlrCurrency(market.subjectAskingRent)}</strong><br><span style="font-size:11px;color:#64748b">Subject ask vs comp avg ${formatDlrCurrency(market.compAverageRent)}</span></div>
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px"><strong>${formatPresentationPercentValue(market.compAverageLeasedPct)}</strong><br><span style="font-size:11px;color:#64748b">Comp leased occupancy · exposure ${formatPresentationPercentValue(market.compAverageExposurePct)}</span></div>
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px"><strong>${Math.round(snapshot.activity.applications)} / ${Math.round(snapshot.activity.leasesSigned)}</strong><br><span style="font-size:11px;color:#64748b">Subject apps / leases</span></div>
            <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:10px"><strong>${escapeHtml(getRegionalPricingActionLabel(market))}</strong><br><span style="font-size:11px;color:#64748b">${escapeHtml(market.specialsRecommendation || snapshot.playbook.primaryLabel || "Special pending")}</span></div>
          </div>
          <table style="width:100%;border-collapse:collapse"><thead><tr style="background:#eef2ff"><th style="padding:7px 8px;text-align:left;font-size:11px">Property</th><th style="padding:7px 8px;text-align:right;font-size:11px">Rent</th><th style="padding:7px 8px;text-align:right;font-size:11px">NER</th><th style="padding:7px 8px;text-align:right;font-size:11px">Leased / Exposure</th><th style="padding:7px 8px;text-align:right;font-size:11px">Apps / Leases</th><th style="padding:7px 8px;text-align:left;font-size:11px">Specials</th></tr></thead><tbody>${compRows}</tbody></table>
        </section>`;
      }).join("")
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${report.title}</title><style>
    body{font-family:'DM Sans',Arial,sans-serif;padding:28px;color:#111827}
    table{width:100%;border-collapse:collapse}
    @media print { body{padding:18px} }
  </style></head><body>${brandMark}${investorMarketingBlocks}${sectionBlocks}</body></html>`;
}

function renderMonthlyInvestorPresentationSlide(report, title, subtitle, bodyHtml, accent = "#1f6feb", options = {}) {
  const accentSoft = options.accentSoft ?? getPresentationAccentSoft(accent);
  const photoPanel = options.photoUrl
    ? `<div class="deck-side-photo">
        <img src="${options.photoUrl}" alt="" class="deck-side-photo-img">
        <div class="deck-side-photo-overlay"></div>
      </div>`
    : "";
  return `<section class="deck-slide">
    <div class="deck-shell${options.photoUrl ? " has-photo" : ""}" style="--deck-accent:${accent};--deck-accent-soft:${accentSoft}">
      <div class="deck-pattern-layer"></div>
      ${photoPanel}
      <div class="deck-header">
        <div class="deck-brand">
          <img src="${resolveExportBrandLogoSrc()}" alt="ATLAS RISE logo">
          <div>
            <div class="deck-brand-sub">${escapeHtml(report.currentMonthLabel)} · ${escapeHtml(report.scopeSummary)}</div>
          </div>
        </div>
        <div class="deck-meta">
          <div>${escapeHtml(formatPresentationDate(report.generatedAt))}</div>
          <div>${report.details.length === 1 ? escapeHtml(report.details[0].name) : `${report.details.length} Communities`}</div>
        </div>
      </div>
      <div class="deck-ribbon" style="background:linear-gradient(90deg, rgba(255,255,255,0.14) 0%, ${accentSoft} 48%, ${accent} 100%)">
        <div class="deck-ribbon-label">${escapeHtml(subtitle)}</div>
      </div>
      <h1 class="deck-title">${escapeHtml(title)}</h1>
      <div class="deck-body">${bodyHtml}</div>
      <div class="deck-footer">${escapeHtml(report.footerLabel || "ATLAS RISE Ops · Monthly Market Analysis")}</div>
    </div>
  </section>`;
}

function buildMonthlyInvestorPresentationCoverSlide(report) {
  const coverPhoto = report.primaryPhoto;
  const heroImage = coverPhoto
    ? `<div class="deck-cover-hero">
        <img src="${coverPhoto}" alt="" class="deck-cover-hero-img">
      </div>`
    : "";
  return `<section class="deck-slide">
    <div class="deck-shell deck-cover-shell" style="--deck-accent:${RISE_PRESENTATION_BRAND.blue};--deck-accent-soft:${RISE_PRESENTATION_BRAND.cyan}">
      <div class="deck-pattern-layer"></div>
      ${heroImage}
      <div class="deck-cover-overlay"></div>
      <div class="deck-cover-content">
        <img src="${resolveExportBrandLogoSrc()}" alt="ATLAS RISE logo" class="deck-cover-logo">
        <h1 class="deck-cover-title">${escapeHtml(report.title)}</h1>
        <div class="deck-cover-subtitle">${escapeHtml(report.subtitle)}</div>
        <div class="deck-cover-month">${escapeHtml(report.coverMonthLabel || `${report.currentMonthLabel} Investor Presentation`)}</div>
        ${buildMonthlyPresentationRegionalStaffPanel(report)}
      </div>
    </div>
  </section>`;
}

function buildMonthlyInvestorPresentationContentsSlide(report) {
  const agenda = buildMonthlyInvestorPresentationAgenda(report);
  const agendaList = agenda.map((item, idx) => `<div class="deck-agenda-row">
      <span class="deck-agenda-num">${String(idx + 1).padStart(2, "0")}</span>
      <span class="deck-agenda-text">${escapeHtml(item)}</span>
    </div>`).join("");
  return renderMonthlyInvestorPresentationSlide(
    report,
    "Contents",
    "Presentation map",
    `<div class="deck-two-col">
      <div class="deck-panel deck-panel-soft">
        ${agendaList}
      </div>
      <div class="deck-panel deck-panel-transparent">
        ${buildMonthlyPresentationPhotoMosaic(report, 3)}
      </div>
    </div>`,
    RISE_PRESENTATION_BRAND.blue,
    { photoUrl: report.photoPool[1]?.src ?? report.primaryPhoto }
  );
}

function buildMonthlyPresentationCommunitySnapshotSlide(report) {
  const occupancyChart = buildDeckHorizontalCompareChart(
    "Physical Occupancy vs Saved Budget",
    report.details.map(detail => ({
      label: detail.name,
      value: getSummaryOccPct(detail.summary),
      target: Number(detail.summary.budgetOccPct ?? 0),
      note: `Leased ${getSummaryLeasedPct(detail.summary).toFixed(1)}% · ${Math.round(detail.summary.applicationsApproved ?? 0)} approved apps MTD`,
      color: RISE_PRESENTATION_BRAND.blue
    })),
    {
      max: 100,
      subtitle: "Each community is measured against its saved physical occupancy budget for the active month.",
      valueFormatter: value => `${Number(value || 0).toFixed(1)}%`,
      targetFormatter: value => `${Number(value || 0).toFixed(1)}%`
    }
  );
  const approvalsChart = buildDeckHorizontalCompareChart(
    "Approved Applications vs Received (Month To Date)",
    report.details.map(detail => ({
      label: detail.name,
      value: Number(detail.summary.applicationsApproved ?? 0),
      target: Number(detail.summary.applications ?? 0),
      note: `${(detail.summary.applicationApprovalPct ?? 0).toFixed(1)}% approval rate · ${formatSignedDisplay(detail.summary.monthAbsorption ?? 0)} absorption`,
      color: RISE_PRESENTATION_BRAND.cyan
    })),
    {
      subtitle: "The bar shows approved applications, while the goal marker shows total applications received.",
      valueFormatter: value => `${Math.round(value || 0)}`,
      targetFormatter: value => `${Math.round(value || 0)}`
    }
  );
  return renderMonthlyInvestorPresentationSlide(
    report,
    report.details.length > 1 ? "Selected Community Snapshot" : `${report.details[0]?.name ?? "Community"} Snapshot`,
    "Scope summary",
    `<div class="deck-two-col">
      ${occupancyChart}
      ${approvalsChart}
    </div>
    <div class="deck-panel deck-panel-transparent" style="margin-top:16px">
      <div class="deck-panel-title">Scope read</div>
      <ul class="deck-bullets">
        <li>${report.details.length} selected communit${report.details.length === 1 ? "y is" : "ies are"} represented across ${report.investorGroups.length} investment portfolio${report.investorGroups.length === 1 ? "" : "s"}.</li>
        <li>${report.aggregate.totalUnits.toLocaleString()} total units are included in this monthly presentation scope.</li>
        <li>${(report.regionalStaff ?? []).length > 0 ? `${report.regionalStaff.length} Regional leader${report.regionalStaff.length === 1 ? "" : "s"} are directly represented on the cover based on assigned community scope.` : "Add Regional headshots in Jac's Team to visually connect leadership coverage to the selected communities."}</li>
      </ul>
    </div>`,
    RISE_PRESENTATION_BRAND.cyan,
    { photoUrl: report.photoPool[1]?.src ?? report.primaryPhoto }
  );
}

function buildMonthlyPresentationCommunitySpotlightSlide(report, detail, photoIndex = 0) {
  const summary = detail.summary;
  const photoUrl = getDetailPresentationPhoto(detail, report);
  const packetMode = report?.variant === "investor_property_packet";
  const recommendations = detail.recommendations.slice(0, 3);
  const packetHighlights = buildInvestorPropertyPacketHighlights(detail, report.currentMonthIdx);
  const teamPanel = buildPresentationTeamPanel(getPresentationCommunityStaffForDetail(detail), "People Behind This Community");
  const marketSurveyCharts = buildCommunityMarketSurveyCharts(detail);
  const pricingActionPanel = buildCommunitySpotlightPricingPanel(detail);
  const monthEntry = getMonthlyPresentationCurrentEntry(detail);
  const market = buildRegionalPricingWorksheetSnapshot(detail, null, report.currentMonthIdx);
  const scopeMeta = getCompCalculatorScopeMeta(detail, market);
  const addressLine = String(detail.record?.communityAddress ?? "").trim();
  const overviewFacts = [
    getInvestorPortfolioName(detail.record),
    addressLine,
    scopeMeta.city && scopeMeta.marketArea ? `${scopeMeta.city} · ${scopeMeta.marketArea}` : (scopeMeta.marketArea || scopeMeta.city || ""),
    `${getDashboardMonthLabel(detail.record?.currentMonth ?? currentMonth)} operating picture`
  ].filter(Boolean);
  const spotlightBullets = packetMode
    ? packetHighlights
    : (recommendations.length > 0
        ? recommendations.map(item => `<strong>${escapeHtml(item.title)}:</strong> ${escapeHtml(item.body)}`)
        : ["No active watchlist items surfaced from the current dashboard sections."]);
  const pricingChart = buildDeckHorizontalCompareChart(
    "Rates & Effective Rent",
    [
      { label: "Market Rent", value: Number(monthEntry.marketRent ?? 0), color: RISE_PRESENTATION_BRAND.blue },
      { label: "Budget Rent", value: Number(monthEntry.proformaRent ?? 0), color: RISE_PRESENTATION_BRAND.sky },
      { label: "Actual NER", value: Number(monthEntry.nerActual ?? 0), color: RISE_PRESENTATION_BRAND.mint }
    ],
    {
      subtitle: "Current pricing markers for the selected operating period.",
      valueFormatter: value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"
    }
  );
  return renderMonthlyInvestorPresentationSlide(
    report,
    detail.name,
    packetMode ? "Investment spotlight + market position" : "Community spotlight + pricing action",
    `<div class="deck-spotlight-grid">
      <div class="deck-spotlight-stack">
        <div class="deck-panel deck-panel-soft">
          <div class="deck-panel-title">${packetMode ? "Community overview" : "Community spotlight"}</div>
          ${overviewFacts.map(line => `<div class="deck-spotlight-meta">${escapeHtml(line)}</div>`).join("")}
          <div class="deck-kpi-stack" style="margin-top:14px">
            <div><strong>${getSummaryOccPct(summary).toFixed(1)}%</strong><span>Physical occupancy</span></div>
            <div><strong>${getSummaryLeasedPct(summary).toFixed(1)}%</strong><span>Leased occupancy</span></div>
            <div><strong>${Math.round(summary.applicationsApproved ?? 0)}</strong><span>Approved applications MTD</span></div>
            <div><strong>${formatSignedDisplay(summary.monthAbsorption ?? 0)}</strong><span>Net absorption MTD</span></div>
            <div><strong>${(summary.renewalRetentionRate ?? 0).toFixed(1)}%</strong><span>Renewal retention</span></div>
            <div><strong>${(summary.oraScore ?? 0) > 0 ? (summary.oraScore ?? 0).toFixed(1) : "—"}</strong><span>ORA average</span></div>
          </div>
        </div>
        <div class="deck-panel deck-panel-soft">
          ${pricingChart}
        </div>
        <div class="deck-panel deck-panel-transparent">
          <div class="deck-panel-title">${packetMode ? "Investment highlights" : "Operating focus"}</div>
          <ul class="deck-bullets">
            ${packetMode
              ? spotlightBullets.map(item => `<li>${escapeHtml(item)}</li>`).join("")
              : spotlightBullets.map(item => `<li>${item}</li>`).join("")}
          </ul>
        </div>
      </div>
      <div class="deck-spotlight-stack">
        ${pricingActionPanel}
        ${marketSurveyCharts}
        ${teamPanel}
      </div>
    </div>`,
    RISE_PRESENTATION_BRAND.sky,
    { photoUrl }
  );
}

function buildInvestorCommunityInformationSlides(report) {
  const metricCards = buildMonthlyInvestorPresentationMetricCards(report);
  const narrative = buildMonthlyInvestorPresentationNarrative(report);
  const communityCards = report.details.map(detail => {
    const summary = detail.summary ?? {};
    const market = buildRegionalPricingWorksheetSnapshot(detail, null, report.currentMonthIdx);
    const meta = getCompCalculatorScopeMeta(detail, market);
    const addressLine = String(detail.record?.communityAddress ?? "").trim();
    const photoUrl = getDetailPresentationPhoto(detail, report, true);
    const team = getPresentationCommunityStaffForDetail(detail)
      .map(member => member.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(" · ");
    const highlights = buildInvestorPropertyPacketHighlights(detail, report.currentMonthIdx);
    const marketLine = [
      meta.city || "",
      meta.marketArea && meta.marketArea !== meta.city ? meta.marketArea : ""
    ].filter(Boolean).join(" · ");
    return `<article class="deck-info-card">
      ${photoUrl ? `<img src="${photoUrl}" alt="" class="deck-info-photo">` : ""}
      <div class="deck-info-content">
        <div class="deck-info-name">${escapeHtml(detail.name)}</div>
        ${addressLine ? `<div class="deck-info-meta">${escapeHtml(addressLine)}</div>` : ""}
        ${marketLine ? `<div class="deck-info-meta">${escapeHtml(marketLine)}</div>` : ""}
        <div class="deck-info-stats">
          <span>${Math.round(summary.totalUnits ?? getTotalUnitsFor(getPropertyByName(detail.name), detail.record?.customUnits) ?? 0)} units</span>
          <span>${getSummaryOccPct(summary).toFixed(1)}% occ</span>
          <span>${getSummaryLeasedPct(summary).toFixed(1)}% leased</span>
          <span>${Math.round(summary.guestCards ?? 0)} leads</span>
          <span>${Math.round(summary.tours ?? 0)} tours</span>
          <span>${Math.round(summary.applications ?? 0)} apps</span>
          <span>${Math.round(summary.applicationsApproved ?? 0)} approved</span>
          <span>${formatSignedDisplay(summary.monthAbsorption ?? 0)} absorption</span>
        </div>
        <div class="deck-info-highlight">${escapeHtml(highlights[0] || "Current ATLAS activity shows a clear operating picture for the selected reporting month.")}</div>
        <div class="deck-info-team">${escapeHtml(team || "Community leadership details available from setup")}</div>
      </div>
    </article>`;
  }).join("");
  const aggregateMarket = buildMarketSurveyAggregateForDetails(report.details);
  const aggregateFacts = [
    aggregateMarket.compAverageRentCount > 0 ? `Average comp rent: ${formatPresentationCurrencyValue(aggregateMarket.compAverageRentTotal / aggregateMarket.compAverageRentCount)}` : "",
    aggregateMarket.compAverageNerCount > 0 ? `Average comp NER: ${formatPresentationCurrencyValue(aggregateMarket.compAverageNerTotal / aggregateMarket.compAverageNerCount)}` : "",
    Number(aggregateMarket.applicationsLast30 ?? 0) > 0 ? `${Math.round(aggregateMarket.applicationsLast30)} APTIQ applications in the last 30 days` : "",
    Number(aggregateMarket.leasesLast30 ?? 0) > 0 ? `${Math.round(aggregateMarket.leasesLast30)} APTIQ leases in the last 30 days` : ""
  ].filter(Boolean);
  return [
    renderMonthlyInvestorPresentationSlide(
      report,
      report.title,
      "High-level community information",
      `<div class="deck-metric-grid deck-metric-grid-tight">
        ${metricCards.slice(0, 4).map(card => `<div class="deck-metric-card">
          <div class="deck-metric-label">${escapeHtml(card.label)}</div>
          <div class="deck-metric-value">${escapeHtml(card.value)}</div>
          <div class="deck-metric-sub">${escapeHtml(card.sub)}</div>
        </div>`).join("")}
      </div>
      <div class="deck-two-col">
        <div class="deck-narrative">
          ${narrative.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}
          ${aggregateFacts.length > 0 ? `<p>${aggregateFacts.map(escapeHtml).join(" · ")}</p>` : ""}
        </div>
        <div class="deck-panel deck-panel-transparent">
          ${buildMonthlyPresentationPhotoMosaic(report, 4)}
        </div>
      </div>`,
      RISE_PRESENTATION_BRAND.blue,
      { photoUrl: report.photoPool[0]?.src ?? report.primaryPhoto }
    ),
    renderMonthlyInvestorPresentationSlide(
      report,
      report.details.length === 1 ? `${report.details[0].name} Community Detail` : "Selected Community Details",
      "Operating snapshot, market color, and team coverage",
      `<div class="deck-info-grid">${communityCards}</div>`,
      RISE_PRESENTATION_BRAND.cyan
    )
  ];
}

function buildMonthlyPresentationPricingSlide(report) {
  const blank = label => `<span class="deck-fill-blank">${escapeHtml(label)}</span>`;
  const formatCurrency = value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "";
  const formatPercent = value => value > 0 ? `${Number(value).toFixed(1)}%` : "";
  const rentChart = buildDeckHorizontalCompareChart(
    "Our Market Rent vs Comp Average Rent",
    report.details.map(detail => {
      const monthEntry = getMonthlyPresentationCurrentEntry(detail);
      const market = buildRegionalPricingWorksheetSnapshot(detail);
      return {
        label: detail.name,
        value: Number(monthEntry.marketRent ?? 0),
        target: Number(market.compAverageRent ?? 0),
        note: Number(market.compAverageNer ?? 0) > 0 ? `Comp NER ${formatCurrency(market.compAverageNer)}` : "Add comp average rent and NER from APTIQ",
        color: RISE_PRESENTATION_BRAND.blue
      };
    }),
    {
      subtitle: "The bar shows the community's saved market rent. The goal marker shows the current comp-average market rent from the APTIQ survey worksheet.",
      valueFormatter: value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—",
      targetFormatter: value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"
    }
  );
  return renderMonthlyInvestorPresentationSlide(
    report,
    "Pricing Plan / Recommendations",
    "Regional worksheet built from APTIQ market survey inputs",
    `<div class="deck-two-col">
      ${rentChart}
      <div class="deck-panel deck-panel-soft">
        <div class="deck-panel-title">How Regionals should fill this out</div>
        <ul class="deck-bullets">
          <li>Use the APTIQ market survey to update comp-average rent, comp-average NER, concessions, leased %, exposure %, and recent application activity for each community.</li>
          <li>Identify whether rent should move <strong>up</strong>, <strong>down</strong>, or <strong>hold</strong> based on comp pricing, exposure, and app velocity.</li>
          <li>Recommend specials using the concession language the comp set is actively reporting, then summarize the pricing story in one short Regional note for investors.</li>
        </ul>
        <table class="deck-table deck-table-dark" style="margin-top:14px">
          <thead><tr><th>Community</th><th>Comp Signals</th><th>Rent Adjustment</th><th>Recommended Specials</th><th>Regional Note</th></tr></thead>
          <tbody>
            ${report.details.map(detail => {
              const market = buildRegionalPricingWorksheetSnapshot(detail);
              const adjustmentDirection = ({
                up: "Increase",
                down: "Decrease",
                hold: "Hold"
              })[market.rentAdjustmentDirection] ?? "Hold";
              const adjustmentAmount = Number(market.rentAdjustmentAmount ?? 0);
              const adjustmentText = adjustmentDirection === "Hold"
                ? "Hold rate"
                : `${adjustmentDirection} ${adjustmentAmount > 0 ? formatCurrency(adjustmentAmount) : blank("enter $")}`;
              const compSignals = [
                formatCurrency(market.compAverageRent) ? `Comp Avg Rent ${formatCurrency(market.compAverageRent)}` : "Comp Avg Rent " + blank("enter"),
                formatCurrency(market.compAverageNer) ? `Comp Avg NER ${formatCurrency(market.compAverageNer)}` : "Comp Avg NER " + blank("enter"),
                formatPercent(market.compAverageLeasedPct) ? `Leased ${formatPercent(market.compAverageLeasedPct)}` : "Leased " + blank("enter %"),
                formatPercent(market.compAverageExposurePct) ? `Exposure ${formatPercent(market.compAverageExposurePct)}` : "Exposure " + blank("enter %"),
                market.applicationsLast7 > 0 || market.applicationsLast30 > 0
                  ? `Apps ${Math.round(market.applicationsLast7 || 0)} / ${Math.round(market.applicationsLast30 || 0)}`
                  : "Apps " + blank("7 / 30"),
                market.marketConcessions ? `Comps: ${escapeHtml(market.marketConcessions)}` : "Comps: " + blank("reported specials")
              ];
              return `<tr>
                <td><strong>${escapeHtml(detail.name)}</strong></td>
                <td>${compSignals.join("<br>")}</td>
                <td>${adjustmentText}</td>
                <td>${market.specialsRecommendation ? escapeHtml(market.specialsRecommendation) : blank("enter specials recommendation")}</td>
                <td>${market.pricingNotes ? escapeHtml(market.pricingNotes) : blank("enter Regional investor note")}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`,
    RISE_PRESENTATION_BRAND.sky,
    { photoUrl: report.photoPool[2]?.src ?? report.primaryPhoto }
  );
}

function buildMonthlyInvestorPresentationSlides(report) {
  if (report?.variant === "investor_property_packet") {
    return buildInvestorCommunityInformationSlides(report);
  }
  const metricCards = buildMonthlyInvestorPresentationMetricCards(report);
  const narrative = buildMonthlyInvestorPresentationNarrative(report);
  const opportunities = buildMonthlyInvestorPresentationOpportunities(report, 8);
  const slides = [];
  slides.push(buildMonthlyInvestorPresentationCoverSlide(report));
  slides.push(buildMonthlyInvestorPresentationContentsSlide(report));
  slides.push(renderMonthlyInvestorPresentationSlide(
    report,
    "Executive Summary",
    "Topline operating story",
    `<div class="deck-metric-grid">
      ${metricCards.map(card => `<div class="deck-metric-card">
        <div class="deck-metric-label">${escapeHtml(card.label)}</div>
        <div class="deck-metric-value">${escapeHtml(card.value)}</div>
        <div class="deck-metric-sub">${escapeHtml(card.sub)}</div>
      </div>`).join("")}
    </div>
    <div class="deck-narrative">
      ${narrative.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}
    </div>`,
    RISE_PRESENTATION_BRAND.blue,
    { photoUrl: report.photoPool[0]?.src ?? report.primaryPhoto }
  ));
  if (report.details.length > 1) {
    slides.push(buildMonthlyPresentationCommunitySnapshotSlide(report));
  }
  if (report.selectedSections.includes("overview")) {
    const occupancyChart = buildDeckHorizontalCompareChart(
      "Occupancy vs Saved Budget by Community",
      report.details.map(detail => ({
        label: detail.name,
        value: getSummaryOccPct(detail.summary),
        target: Number(detail.summary.budgetOccPct ?? 0),
        note: `${detail.summary.budgetOccOnTrack ? "On track to budget" : `${Math.max(detail.summary.occGapUnits ?? 0, 0)} units below target`}`,
        color: RISE_PRESENTATION_BRAND.blue
      })),
      {
        max: 100,
        valueFormatter: value => `${Number(value || 0).toFixed(1)}%`,
        targetFormatter: value => `${Number(value || 0).toFixed(1)}%`
      }
    );
    const nerChart = buildDeckHorizontalCompareChart(
      "Actual NER vs Budgeted NER",
      report.details.map(detail => ({
        label: detail.name,
        value: Number(detail.summary.currentNer ?? 0),
        target: Number(detail.summary.proformaNer ?? 0),
        note: Number(detail.summary.currentNer ?? 0) > 0 && Number(detail.summary.proformaNer ?? 0) > 0
          ? `Delta ${formatSignedDisplay((detail.summary.currentNer ?? 0) - (detail.summary.proformaNer ?? 0), 0)}`
          : "Awaiting complete NER data",
        color: RISE_PRESENTATION_BRAND.cyan
      })),
      {
        valueFormatter: value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—",
        targetFormatter: value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"
      }
    );
    slides.push(renderMonthlyInvestorPresentationSlide(
      report,
      "Budget & Revenue Position",
      "Saved budget pacing and rate health",
      `<div class="deck-metric-grid deck-metric-grid-tight">
        <div class="deck-metric-card"><div class="deck-metric-label">Budget Attainment</div><div class="deck-metric-value">${(report.aggregate.avgBudgetOccAttainmentPct ?? 0).toFixed(1)}%</div><div class="deck-metric-sub">Average occupancy attainment vs saved budget across selected communities</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">Occ Gap vs Budget</div><div class="deck-metric-value">${formatSignedDisplay(report.aggregate.occGapPts, 1, " pts")}</div><div class="deck-metric-sub">Portfolio occupancy gap versus current budget target</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">Leased Gap vs Budget</div><div class="deck-metric-value">${formatSignedDisplay(report.aggregate.leasedGapPts ?? 0, 1, " pts")}</div><div class="deck-metric-sub">Leased occupancy gap versus saved budget target</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">NER Delta vs Budget</div><div class="deck-metric-value">${report.aggregate.nerDelta ? formatSignedDisplay(report.aggregate.nerDelta, 0) : "—"}</div><div class="deck-metric-sub">Weighted effective rent delta vs budgeted NER</div></div>
      </div>
      <div class="deck-two-col">
        ${occupancyChart}
        ${nerChart}
      </div>
      <div class="deck-two-col" style="margin-top:16px">
        <div class="deck-panel">
          <div class="deck-panel-title">Budget read</div>
          <ul class="deck-bullets">
            <li>${report.aggregate.onTrackBudgetOccCount ?? 0} of ${report.aggregate.trackedBudgetOccCount ?? 0} communities are currently on track to saved occupancy budget.</li>
            <li>Occupancy is ${formatSignedDisplay(report.aggregate.occGapPts, 1, " points").replace("points", "points versus budget")} and leased occupancy is ${formatSignedDisplay(report.aggregate.leasedGapPts ?? 0, 1, " points").replace("points", "points versus budget")}.</li>
            <li>NER delta is shown on a weighted basis so larger occupied communities carry appropriate influence in the investor narrative.</li>
          </ul>
        </div>
        <div class="deck-panel">
          <div class="deck-panel-title">Investor takeaway</div>
          <p class="deck-panel-copy">This slide keeps the presentation tied back to budget, not just raw volume. It is designed to help investors quickly see whether current leasing momentum is translating into the occupancy and revenue targets originally underwritten for the month.</p>
        </div>
      </div>`,
      RISE_PRESENTATION_BRAND.blue,
      { photoUrl: report.photoPool[1]?.src ?? report.primaryPhoto }
    ));
  }
  if (report.selectedSections.includes("traffic") || report.selectedSections.includes("overview")) {
    const applicationChart = buildDeckHorizontalCompareChart(
      "Approved Applications vs Total Applications",
      report.details.map(detail => ({
        label: detail.name,
        value: Number(detail.summary.applicationsApproved ?? 0),
        target: Number(detail.summary.applications ?? 0),
        note: `${(detail.summary.applicationApprovalPct ?? 0).toFixed(1)}% approval rate`,
        color: RISE_PRESENTATION_BRAND.blue
      })),
      {
        valueFormatter: value => `${Math.round(value || 0)}`,
        targetFormatter: value => `${Math.round(value || 0)}`
      }
    );
    const conversionChart = buildDeckHorizontalCompareChart(
      "Tour to Lease Conversion by Community",
      report.details.map(detail => {
        const plan = getCommunityPerformancePlan(detail.name, detail.record);
        const needed = Number(plan?.currentTourToLeaseNeededPct ?? 0);
        return {
          label: detail.name,
          value: Number(detail.summary.tourToLeasePct ?? 0),
          target: needed > 0 ? Math.max(28, needed) : 28,
          note: `${Math.round(detail.summary.tours ?? 0)} tours · ${Math.round(detail.summary.leasesSigned ?? 0)} leases`,
          color: RISE_PRESENTATION_BRAND.cyan
        };
      }),
      {
        max: 100,
        subtitle: "The goal marker flexes upward where the saved traffic plan needs more closing power to stay on budget.",
        valueFormatter: value => `${Number(value || 0).toFixed(1)}%`,
        targetFormatter: value => `${Number(value || 0).toFixed(1)}%`
      }
    );
    slides.push(renderMonthlyInvestorPresentationSlide(
      report,
      "Leasing Traffic & Conversion",
      "Month-to-date funnel performance",
      `<div class="deck-metric-grid deck-metric-grid-tight">
        <div class="deck-metric-card"><div class="deck-metric-label">Applications (MTD)</div><div class="deck-metric-value">${Math.round(report.aggregate.applications ?? 0)}</div><div class="deck-metric-sub">${formatPortfolioTrendValue(report.aggregate.applications ?? 0, report.aggregate.previousApplications ?? 0, "count_pct")}</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">Approved Applications</div><div class="deck-metric-value">${Math.round(report.aggregate.applicationsApproved ?? 0)}</div><div class="deck-metric-sub">${formatPortfolioTrendValue(report.aggregate.applicationsApproved ?? 0, report.aggregate.previousApplicationsApproved ?? 0, "count_pct")}</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">Tour to App</div><div class="deck-metric-value">${(report.aggregate.tourToAppPct ?? 0).toFixed(1)}%</div><div class="deck-metric-sub">${formatPortfolioTrendValue(report.aggregate.tourToAppPct ?? 0, report.aggregate.previousTourToAppPct ?? 0, "point")}</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">Tour to Lease</div><div class="deck-metric-value">${(report.aggregate.tourToLeasePct ?? 0).toFixed(1)}%</div><div class="deck-metric-sub">${formatPortfolioTrendValue(report.aggregate.tourToLeasePct ?? 0, report.aggregate.previousTourToLeasePct ?? 0, "point")}</div></div>
      </div>
      <div class="deck-two-col">
        ${applicationChart}
        ${conversionChart}
      </div>
      <div class="deck-two-col" style="margin-top:16px">
        <div class="deck-panel">
          <div class="deck-panel-title">Funnel read</div>
          <ul class="deck-bullets">
            <li>Applications are ${formatPortfolioTrendValue(report.aggregate.applications ?? 0, report.aggregate.previousApplications ?? 0, "count_pct").replace("MoM", "month over month")} while approved applications are ${formatPortfolioTrendValue(report.aggregate.applicationsApproved ?? 0, report.aggregate.previousApplicationsApproved ?? 0, "count_pct").replace("MoM", "month over month")}.</li>
            <li>The portfolio is closing ${(report.aggregate.tourToLeasePct ?? 0).toFixed(1)}% of tours into leases and converting ${(report.aggregate.applicationApprovalPct ?? 0).toFixed(1)}% of applications into approvals.</li>
            <li>Net absorption is ${formatSignedDisplay(report.aggregate.monthAbsorption ?? 0)} units for the month, reflecting move-ins against move-outs already captured in the schedule.</li>
          </ul>
        </div>
        <div class="deck-panel">
          <div class="deck-panel-title">Investor takeaway</div>
          <p class="deck-panel-copy">The leasing story in this deck emphasizes month-to-date performance, but the ratios still leverage the full historical dataset saved in the dashboard to keep the narrative anchored in trend rather than only one isolated month.</p>
        </div>
      </div>`,
      RISE_PRESENTATION_BRAND.cyan,
      { photoUrl: report.photoPool[2]?.src ?? report.primaryPhoto }
    ));
  }
  if (report.selectedSections.includes("renewals") || report.selectedSections.includes("reputation")) {
    const retentionChart = buildDeckHorizontalCompareChart(
      "Renewal Retention vs Goal by Community",
      report.details.map(detail => {
        const plan = getCommunityPerformancePlan(detail.name, detail.record);
        return {
          label: detail.name,
          value: Number(detail.summary.renewalRetentionRate ?? 0),
          target: Number(plan?.recommendedRenewalGoal ?? 60),
          note: `${Math.round(detail.summary.renewalProjectedAttrition ?? 0)} projected attrition units`,
          color: RISE_PRESENTATION_BRAND.mint
        };
      }),
      {
        max: 100,
        valueFormatter: value => `${Number(value || 0).toFixed(1)}%`,
        targetFormatter: value => `${Number(value || 0).toFixed(1)}%`
      }
    );
    const oraChart = buildDeckHorizontalCompareChart(
      "ORA by Community vs National Average",
      report.details.map(detail => ({
        label: detail.name,
        value: Number(detail.summary.oraScore ?? 0),
        target: 62,
        note: Number(detail.summary.googleQuarterlyRating ?? 0) > 0 ? `Quarterly Google ${Number(detail.summary.googleQuarterlyRating).toFixed(2)}` : "Quarterly Google pending",
        color: RISE_PRESENTATION_BRAND.blue
      })),
      {
        max: 100,
        subtitle: "The goal marker reflects the 62 national ORA average baseline used elsewhere in the dashboard.",
        valueFormatter: value => Number(value || 0) > 0 ? Number(value).toFixed(1) : "—",
        targetFormatter: value => Number(value || 0).toFixed(0)
      }
    );
    slides.push(renderMonthlyInvestorPresentationSlide(
      report,
      "Renewals, Retention & Resident Experience",
      "Stability and resident sentiment",
      `<div class="deck-metric-grid deck-metric-grid-tight">
        <div class="deck-metric-card"><div class="deck-metric-label">Expirations (MTD)</div><div class="deck-metric-value">${Math.round(report.aggregate.renewalExpirations ?? 0)}</div><div class="deck-metric-sub">${formatPortfolioTrendValue(report.aggregate.renewalExpirations ?? 0, report.aggregate.previousRenewalExpirations ?? 0, "count_pct")}</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">Renewals Signed</div><div class="deck-metric-value">${Math.round(report.aggregate.renewalsSigned ?? 0)}</div><div class="deck-metric-sub">${formatPortfolioTrendValue(report.aggregate.renewalsSigned ?? 0, report.aggregate.previousRenewalsSigned ?? 0, "count_pct")}</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">Retention Rate</div><div class="deck-metric-value">${(report.aggregate.renewalRetentionRate ?? 0).toFixed(1)}%</div><div class="deck-metric-sub">${formatPortfolioTrendValue(report.aggregate.renewalRetentionRate ?? 0, report.aggregate.previousRenewalRetentionRate ?? 0, "point")}</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">Projected Attrition</div><div class="deck-metric-value">${Math.round(report.aggregate.renewalProjectedAttrition ?? 0)}</div><div class="deck-metric-sub">MTD risk units in lease planning</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">ORA</div><div class="deck-metric-value">${(report.aggregate.oraScore ?? 0) > 0 ? (report.aggregate.oraScore ?? 0).toFixed(1) : "—"}</div><div class="deck-metric-sub">Portfolio average</div></div>
        <div class="deck-metric-card"><div class="deck-metric-label">Quarterly Google</div><div class="deck-metric-value">${(report.aggregate.googleQuarterlyRating ?? 0) > 0 ? (report.aggregate.googleQuarterlyRating ?? 0).toFixed(2) : "—"}</div><div class="deck-metric-sub">Current quarter rating</div></div>
      </div>
      <div class="deck-two-col">
        ${retentionChart}
        ${oraChart}
      </div>`,
      RISE_PRESENTATION_BRAND.mint,
      { photoUrl: report.photoPool[3]?.src ?? report.primaryPhoto }
    ));
  }
  report.details.forEach((detail, idx) => {
    slides.push(buildMonthlyPresentationCommunitySpotlightSlide(report, detail, idx));
  });
  slides.push(renderMonthlyInvestorPresentationSlide(
    report,
    "Thank You / Next Steps",
    "Watchlist and action items",
    `<div class="deck-two-col">
      <div class="deck-panel deck-panel-soft">
        <div class="deck-panel-title">Top watchlist items</div>
        <ul class="deck-bullets">
          ${opportunities.length > 0 ? opportunities.map(item => `<li><strong>${escapeHtml(item.community)}:</strong> ${escapeHtml(item.title)} - ${escapeHtml(item.body)}</li>`).join("") : "<li>No active recommendation items are currently flagged in the selected sections.</li>"}
        </ul>
      </div>
      <div class="deck-panel deck-panel-transparent">
        <div class="deck-panel-title">Presentation workflow</div>
        <ul class="deck-bullets">
          <li>Open the Canva template from the dashboard to keep branding consistent.</li>
          <li>Use the exported PDF for a clean static presentation or copy the outline into Canva for a more polished live deck.</li>
          <li>The narrative and metrics in this export stay aligned with the selected communities and saved dashboard data for this month.</li>
        </ul>
      </div>
    </div>`,
    RISE_PRESENTATION_BRAND.blue,
    { photoUrl: report.primaryPhoto }
  ));
  return slides.join("");
}

function buildMonthlyInvestorPresentationDocument(report, { editable = false } = {}) {
  const slidesHtml = buildMonthlyInvestorPresentationSlides(report);
  const bodyAttrs = editable ? ` contenteditable="true" spellcheck="false" data-deck-mode="editable"` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(report.title)}</title><style>
    :root{
      --deck-bg:${RISE_PRESENTATION_BRAND.navy};
      --deck-ink:${RISE_PRESENTATION_BRAND.ink};
      --deck-muted:${RISE_PRESENTATION_BRAND.muted};
      --deck-line:${RISE_PRESENTATION_BRAND.line};
      --deck-panel:rgba(16, 41, 64, 0.72);
      --deck-panel-strong:rgba(255,255,255,0.1);
      --deck-accent:${RISE_PRESENTATION_BRAND.blue};
      --deck-accent-soft:${RISE_PRESENTATION_BRAND.cyan};
    }
    *{box-sizing:border-box}
    body{margin:0;background:
      radial-gradient(circle at top left, rgba(68,147,248,0.16), transparent 24%),
      linear-gradient(180deg, #061726 0%, var(--deck-bg) 100%);
      font-family:'DM Sans',Arial,sans-serif;color:var(--deck-ink)}
    body[data-deck-mode="editable"]:focus{outline:none}
    .deck-slide{padding:28px;page-break-after:always}
    .deck-slide:last-child{page-break-after:auto}
    .deck-shell{background:linear-gradient(180deg, rgba(8,27,43,0.98), rgba(14,37,58,0.98));border:none;border-radius:24px;padding:28px 30px;min-height:960px;position:relative;overflow:hidden;isolation:isolate;box-shadow:0 30px 60px rgba(2,10,18,0.28)}
    .deck-shell.has-photo{padding-right:320px}
    .deck-pattern-layer{position:absolute;inset:0;background:
      radial-gradient(circle at 18% 68%, rgba(68,147,248,0.14) 0 5px, transparent 6px) 0 0/34px 34px,
      linear-gradient(140deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 24%, transparent 25%),
      linear-gradient(180deg, rgba(4,22,35,0.04), rgba(4,22,35,0.32));
      opacity:0.9;pointer-events:none;z-index:0}
    .deck-side-photo{position:absolute;right:0;top:0;bottom:0;width:290px;z-index:0;overflow:hidden}
    .deck-side-photo-img{width:100%;height:100%;display:block;object-fit:cover;object-position:center;filter:saturate(1.08) contrast(1.08) brightness(1.02);transform:scale(1.01)}
    .deck-side-photo-overlay{position:absolute;inset:0;background:linear-gradient(90deg, rgba(7,28,44,0.94), rgba(7,28,44,0.16))}
    .deck-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px;padding-top:12px}
    .deck-brand{display:flex;align-items:center;gap:14px;position:relative;z-index:2}
    .deck-brand img{height:38px;width:auto;object-fit:contain;display:block}
    .deck-brand-sub{font-size:12px;color:var(--deck-muted);line-height:1.5;max-width:560px}
    .deck-meta{font-size:12px;color:var(--deck-muted);text-align:right;line-height:1.55;position:relative;z-index:2}
    .deck-ribbon{width:min(420px,68%);height:86px;background:linear-gradient(90deg, rgba(255,255,255,0.14) 0%, var(--deck-accent-soft) 48%, var(--deck-accent) 100%);border-radius:0 0 18px 0;display:flex;align-items:flex-start;padding:18px 20px;position:relative;z-index:2;margin-bottom:10px;box-shadow:0 20px 40px rgba(0,0,0,0.15)}
    .deck-ribbon-label{font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:rgba(255,255,255,0.85)}
    .deck-title{font-size:52px;line-height:0.98;letter-spacing:-0.04em;margin:0 0 18px;position:relative;z-index:2;max-width:880px}
    .deck-body{position:relative;z-index:2}
    .deck-footer{position:absolute;left:30px;right:30px;bottom:22px;border-top:1px solid var(--deck-line);padding-top:10px;font-size:11px;color:var(--deck-muted);text-transform:uppercase;letter-spacing:0.08em;z-index:2}
    .deck-cover-shell{padding:0}
    .deck-cover-hero{position:absolute;right:0;top:0;bottom:0;width:47%;z-index:0;overflow:hidden}
    .deck-cover-hero-img{width:100%;height:100%;display:block;object-fit:cover;object-position:center;filter:saturate(1.08) contrast(1.08) brightness(1.02);transform:scale(1.01)}
    .deck-cover-overlay{position:absolute;inset:0;background:linear-gradient(90deg, rgba(7,28,44,0.98) 0%, rgba(7,28,44,0.98) 57%, rgba(7,28,44,0.34) 74%, rgba(7,28,44,0.08) 100%);z-index:1}
    .deck-cover-content{position:relative;z-index:2;padding:40px 36px;max-width:720px}
    .deck-cover-logo{height:72px;width:auto;display:block;margin-bottom:34px}
    .deck-cover-title{font-size:92px;line-height:0.9;letter-spacing:-0.05em;margin:0 0 24px;max-width:620px}
    .deck-cover-subtitle{font-size:22px;line-height:1.5;color:var(--deck-accent-soft);margin-bottom:12px;max-width:620px;font-weight:500}
    .deck-cover-month{font-size:18px;color:rgba(255,255,255,0.84);max-width:620px}
    .deck-cover-staff-wrap{margin-top:28px;max-width:640px}
    .deck-cover-staff-label{font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--deck-muted);margin-bottom:12px}
    .deck-cover-staff-grid{display:flex;flex-wrap:wrap;gap:12px}
    .deck-cover-staff-card{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:999px;background:rgba(7,28,44,0.72);border:1px solid var(--deck-line);backdrop-filter:blur(8px)}
    .deck-cover-avatar{width:50px;height:50px;border-radius:50%;background-size:cover;background-position:center;border:2px solid rgba(255,255,255,0.22);flex:0 0 auto;filter:saturate(1.04) contrast(1.06)}
    .deck-cover-staff-name{font-size:13px;font-weight:700;color:#fff}
    .deck-cover-staff-meta{font-size:11px;color:var(--deck-muted);margin-top:3px}
    .deck-photo-mosaic,.deck-metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .deck-photo-mosaic-1{grid-template-columns:1fr}
    .deck-photo-mosaic-2{grid-template-columns:repeat(2,1fr)}
    .deck-photo-mosaic-3{grid-template-columns:repeat(2,1fr)}
    .deck-photo-tile{position:relative;min-height:200px;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,0.12)}
    .deck-photo-img{width:100%;height:100%;display:block;object-fit:cover;object-position:center;filter:saturate(1.08) contrast(1.08) brightness(1.02);transform:scale(1.01)}
    .deck-photo-tile:nth-child(1):last-child{min-height:360px}
    .deck-photo-tile::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%)}
    .deck-photo-chip{position:absolute;left:12px;bottom:12px;z-index:2;font-size:12px;font-weight:700;color:#fff;background:rgba(0,0,0,0.28);padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.2)}
    .deck-photo-placeholder{border:1px dashed rgba(255,255,255,0.24);border-radius:20px;padding:30px;min-height:280px;display:flex;flex-direction:column;justify-content:center}
    .deck-photo-placeholder-title{font-size:24px;font-weight:700;margin-bottom:10px}
    .deck-photo-placeholder-copy{font-size:14px;line-height:1.7;color:var(--deck-muted)}
    .deck-metric-card,.deck-panel{background:var(--deck-panel);backdrop-filter:blur(6px);border:1px solid var(--deck-line);border-radius:18px;padding:16px}
    .deck-panel-soft{background:rgba(255,255,255,0.12)}
    .deck-panel-transparent{background:rgba(255,255,255,0.06)}
    .deck-highlight-label,.deck-metric-label,.deck-panel-title{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--deck-muted);margin-bottom:8px}
    .deck-highlight-value,.deck-metric-value{font-size:28px;font-weight:700;line-height:1.05;color:#ffffff}
    .deck-metric-sub{font-size:12px;color:var(--deck-muted);margin-top:8px;line-height:1.5}
    .deck-metric-grid{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:18px}
    .deck-metric-grid-tight{grid-template-columns:repeat(4,minmax(0,1fr))}
    .deck-narrative{background:rgba(255,255,255,0.08);border:1px solid var(--deck-line);border-radius:18px;padding:18px}
    .deck-narrative p,.deck-panel-copy,.deck-community-meta,.deck-spotlight-meta{font-size:14px;line-height:1.75;color:#f5fbfb;margin:0 0 10px}
    .deck-narrative p:last-child,.deck-panel-copy:last-child{margin-bottom:0}
    .deck-chart-subtitle,.deck-empty-copy{font-size:12px;line-height:1.7;color:var(--deck-muted)}
    .deck-empty-copy{margin-top:6px}
    .deck-chart-stack{display:grid;gap:12px;margin-top:12px}
    .deck-chart-row{display:grid;gap:6px}
    .deck-chart-row-head{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:var(--deck-muted)}
    .deck-chart-row-head strong{font-size:13px;color:#fff;font-weight:700}
    .deck-chart-track{position:relative;height:14px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden}
    .deck-chart-target{position:absolute;top:1px;bottom:1px;width:2px;border-radius:999px;background:rgba(255,255,255,0.9);box-shadow:0 0 0 3px rgba(255,255,255,0.08)}
    .deck-chart-bar{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg, var(--deck-accent-soft), var(--deck-accent))}
    .deck-chart-bar-empty{width:0 !important}
    .deck-chart-note{font-size:11px;color:var(--deck-muted);line-height:1.5}
    .deck-fill-blank{display:inline-block;min-width:92px;padding-bottom:1px;border-bottom:1px dashed rgba(140,199,255,0.75);color:#cde4ff;font-style:italic}
    .deck-table{width:100%;border-collapse:collapse;border:1px solid var(--deck-line);border-radius:18px;overflow:hidden;background:rgba(0,0,0,0.08)}
    .deck-table th{background:rgba(255,255,255,0.08);color:var(--deck-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.08em;padding:12px;text-align:left}
    .deck-table td{border-top:1px solid var(--deck-line);padding:12px;font-size:13px;vertical-align:top;color:#fff}
    .deck-cell-sub{font-size:11px;color:var(--deck-muted);margin-top:4px}
    .deck-two-col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    .deck-spotlight-grid{display:grid;grid-template-columns:minmax(0,0.94fr) minmax(0,1.06fr);gap:16px}
    .deck-spotlight-stack{display:grid;gap:16px;align-content:start}
    .deck-bullets{padding-left:18px;margin:0}
    .deck-bullets li{font-size:14px;line-height:1.7;color:#f5fbfb;margin:0 0 10px}
    .deck-kpi-stack{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .deck-kpi-stack div{background:rgba(255,255,255,0.08);border:1px solid var(--deck-line);border-radius:14px;padding:12px}
    .deck-kpi-stack strong{display:block;font-size:26px;line-height:1;color:#ffffff;margin-bottom:6px}
    .deck-kpi-stack span{font-size:12px;color:var(--deck-muted)}
    .deck-team-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
    .deck-team-card{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:16px;background:rgba(255,255,255,0.08);border:1px solid var(--deck-line)}
    .deck-team-avatar{width:52px;height:52px;border-radius:50%;background-size:cover;background-position:center;flex:0 0 auto;border:2px solid rgba(255,255,255,0.16)}
    .deck-team-name{font-size:13px;font-weight:700;color:#ffffff}
    .deck-team-role{font-size:11px;color:var(--deck-muted);margin-top:3px}
    .deck-info-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
    .deck-info-card{display:grid;grid-template-columns:82px minmax(0,1fr);gap:12px;background:rgba(255,255,255,0.09);border:1px solid var(--deck-line);border-radius:16px;padding:10px;min-height:132px;overflow:hidden}
    .deck-info-photo{width:82px;height:112px;border-radius:12px;object-fit:cover;object-position:center;filter:saturate(1.08) contrast(1.05)}
    .deck-info-content{min-width:0}
    .deck-info-name{font-size:15px;font-weight:700;color:#fff;line-height:1.2;margin-bottom:4px}
    .deck-info-meta{font-size:10px;color:var(--deck-muted);line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .deck-info-stats{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}
    .deck-info-stats span{font-size:9.5px;line-height:1;padding:5px 6px;border-radius:999px;background:rgba(140,199,255,0.12);border:1px solid rgba(140,199,255,0.18);color:#eaf6ff}
    .deck-info-highlight{font-size:10.5px;line-height:1.45;color:#f5fbfb;margin-top:4px}
    .deck-info-team{font-size:10px;color:var(--deck-accent-soft);line-height:1.35;margin-top:6px}
    .deck-signal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}
    .deck-signal-card,.deck-pricing-action-card{background:rgba(255,255,255,0.08);border:1px solid var(--deck-line);border-radius:14px;padding:12px}
    .deck-signal-label{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--deck-muted);margin-bottom:6px}
    .deck-signal-value,.deck-pricing-action-value{font-size:24px;font-weight:700;line-height:1.05;color:#ffffff}
    .deck-signal-sub{font-size:11px;color:var(--deck-muted);line-height:1.55;margin-top:6px}
    .deck-pricing-action-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
    .deck-pricing-action-card-wide{grid-column:1 / -1}
    .deck-pricing-action-copy{font-size:14px;line-height:1.65;color:#f5fbfb}
    .deck-agenda-row{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.12)}
    .deck-agenda-row:last-child{border-bottom:none}
    .deck-agenda-num{font-size:12px;font-weight:700;color:var(--deck-accent);min-width:24px}
    .deck-agenda-text{font-size:20px;line-height:1.3;color:#fff}
    @media (max-width:900px){
      .deck-shell.has-photo{padding-right:30px}
      .deck-side-photo{display:none}
      .deck-two-col,.deck-metric-grid-tight,.deck-metric-grid,.deck-spotlight-grid{grid-template-columns:1fr 1fr}
      .deck-cover-title{font-size:72px}
    }
    @media (max-width:680px){
      .deck-two-col,.deck-metric-grid-tight,.deck-metric-grid,.deck-photo-mosaic,.deck-kpi-stack,.deck-spotlight-grid,.deck-signal-grid,.deck-pricing-action-grid{grid-template-columns:1fr}
      .deck-header,.deck-brand{flex-direction:column;align-items:flex-start}
      .deck-meta{text-align:left}
      .deck-ribbon{width:100%;height:auto}
      .deck-shell.has-photo{padding-right:30px}
    }
    @media print{
      body{background:#fff}
      .deck-slide{padding:0}
      .deck-shell{border:none;border-radius:0;min-height:auto;height:100vh;box-shadow:none}
    }
  </style></head><body${bodyAttrs}>${slidesHtml}</body></html>`;
}

function buildCommunityProgressReportDocument(report) {
  if (!report) return "";
  const alerts = Array.isArray(report.dataAlerts) ? report.dataAlerts : buildCommunityProgressReportAlerts(report);
  const heroPhotos = Array.isArray(report.photoPoolResolved) && report.photoPoolResolved.length > 0
    ? report.photoPoolResolved.slice(0, 3)
    : Array.isArray(report.photoPool) ? report.photoPool.slice(0, 3) : [];
  const heroPhoto = heroPhotos[0]?.resolvedSrc || heroPhotos[0]?.previewSrc || heroPhotos[0]?.src || String(report.communityPhotoPreviewSrc || "");
  const photoStripHtml = heroPhotos.length > 0
    ? `<div class="progress-photo-strip">
        ${heroPhotos.map(photo => {
          const src = photo.resolvedSrc || photo.previewSrc || photo.src || "";
          return `<div class="progress-photo-frame">
            <img src="${src}" alt="" class="progress-photo-img">
            <div class="progress-photo-label">${escapeHtml(photo.community || report.communityName || "ATLAS")}</div>
          </div>`;
        }).join("")}
      </div>`
    : `<div class="progress-photo-placeholder">
        <img src="${resolveExportBrandLogoSrc()}" alt="ATLAS RISE logo" class="progress-photo-logo">
        <div class="progress-photo-placeholder-copy">
          <div class="progress-photo-placeholder-title">Add a Community Photo</div>
          <div class="progress-photo-placeholder-sub">The report will use the saved community photo library when one is available.</div>
        </div>
      </div>`;
  const heroCards = [
    { label: "Physical Occupancy", value: formatDlrPercent(report.occupancyPct), sub: `${formatDlrMetricValue(report.occupiedUnits)} occupied units` },
    { label: "Leased", value: formatDlrPercent(report.leasedPct), sub: `${formatDlrMetricValue(report.leasedUnits)} leased units` },
    { label: "Approved Apps MTD", value: formatDlrMetricValue(report.trafficMetrics?.approvals), sub: `${formatDlrMetricValue(report.trafficMetrics?.applications)} total applications` },
    { label: "Net Absorption", value: formatDlrSignedNumber(report.monthAbsorption), sub: `${formatDlrMetricValue(report.trafficMetrics?.moveIns)} ins / ${formatDlrMetricValue(report.trafficMetrics?.moveOuts)} outs` },
    { label: "Renewal Retention", value: formatDlrPercent(report.renewalSnapshot?.retentionRate, 0), sub: `${formatDlrMetricValue(report.renewalSnapshot?.signed)} signed of ${formatDlrMetricValue(report.renewalSnapshot?.expirations)}` },
    { label: "Move-In Need", value: formatDlrMetricValue(report.moveInsNeeded), sub: `${formatDlrMetricValue(report.moveInGoalPerWeek)} per week target` }
  ];
  const alertsHtml = alerts.length > 0
    ? `<div class="progress-alert-grid">
        ${alerts.map(alertItem => `<div class="progress-alert ${alertItem.level || "info"}">
          <div class="progress-alert-title">${escapeHtml(alertItem.title)}</div>
          <div class="progress-alert-body">${escapeHtml(alertItem.body)}</div>
        </div>`).join("")}
      </div>`
    : `<div class="progress-alert success">
        <div class="progress-alert-title">All required breakout fields are present</div>
        <div class="progress-alert-body">The current month has enough saved data to render the report without inventing missing breakouts.</div>
      </div>`;
  const paceTable = `<div class="progress-card">
    <div style="font-size:14px;font-weight:700;margin-bottom:10px">Month-to-Date Pace</div>
    ${buildCommunityProgressPacePanel(report)}
  </div>`;
  const trafficMix = `<div class="progress-card">
    <div style="font-size:14px;font-weight:700;margin-bottom:10px">Traffic Mix</div>
    ${buildCommunityProgressTrafficMixPanel(report)}
  </div>`;
  const forwardRows = (report.forwardLook ?? []).map(row => `<tr>
    <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-size:11px;font-weight:700">${escapeHtml(row.label)}</td>
    <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-size:11px;text-align:center">${formatDlrMetricValue(row.leaseExpirations)}</td>
    <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-size:11px;text-align:center">${formatDlrMetricValue(row.pendingMoveOuts)}</td>
    <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-size:11px;text-align:center">${formatDlrMetricValue(row.pendingMoveIns)}</td>
    <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-size:11px;text-align:center">${formatDlrPercent(row.budgetedOccupancy)}</td>
    <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-size:11px;text-align:center">${formatDlrPercent(row.projectedOccupancy)}</td>
    <td style="padding:6px 8px;border-top:1px solid #e5e7eb;font-size:11px;text-align:center;font-weight:700">${formatDlrMetricValue(row.moveInsNeeded)}</td>
  </tr>`).join("");
  const communitySectionsHtml = Array.isArray(report.communityReports) && report.communityReports.length > 1
    ? (communityProgressViewMode === "pdf"
      ? `<div class="progress-card section">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
            <div>
              <div style="font-size:14px;font-weight:700;margin-bottom:4px">By Community</div>
              <div style="font-size:12px;color:#64748b">This export stays aggregate-only in separate-PDF mode. Open the individual community PDFs from the Reporting Hub or the workspace view.</div>
            </div>
            <div style="font-size:12px;color:#475569">${escapeHtml(String(report.communityCount || 0))} communities selected</div>
          </div>
        </div>`
      : `<div class="progress-card section">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
            <div>
              <div style="font-size:14px;font-weight:700;margin-bottom:4px">By Community</div>
              <div style="font-size:12px;color:#64748b">Each selected community is appended below as a full report page so the rollup can be compared against the individual property views in the exported PDF.</div>
            </div>
            <div style="font-size:12px;color:#475569">${escapeHtml(String(report.communityCount || 0))} communities selected</div>
          </div>
          <div class="progress-community-export-stack">
            ${report.communityReports.map(child => {
              const childDocBody = extractHtmlBodyContent(buildCommunityProgressReportDocument(child));
              return `<section class="progress-community-report-page">
                <div class="progress-community-frame-header">
                  <div>
                    <div class="progress-community-frame-title">${escapeHtml(child.communityName)}</div>
                    <div class="progress-community-frame-sub">${escapeHtml(child.reportPeriodLabel)} · individual community view</div>
                  </div>
                </div>
                <div class="progress-community-export-body">${childDocBody}</div>
              </section>`;
            }).join("")}
          </div>
        </div>`)
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title><style>
    *{box-sizing:border-box}
    body{font-family:'DM Sans',Arial,sans-serif;padding:28px;color:#0f172a;background:#ffffff}
    table{width:100%;border-collapse:collapse}
    .progress-shell{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px;padding:18px 20px;border:1px solid #dbe4f0;border-radius:20px;background:linear-gradient(135deg,#f8fbff 0%,#eef5ff 100%)}
    .progress-brand{display:flex;align-items:center;gap:14px}
    .progress-brand img{height:38px;width:auto;object-fit:contain;display:block}
    .progress-title{font-size:24px;font-weight:700;color:#1d4ed8}
    .progress-sub{font-size:13px;color:#64748b}
    .progress-meta{font-size:11px;color:#64748b;text-align:right}
    .progress-meta-thumbs{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:10px;max-width:380px}
    .progress-meta-thumb{width:42px;height:42px;border-radius:999px;overflow:hidden;border:1px solid rgba(148,163,184,0.55);background:#0f172a;box-shadow:0 6px 16px rgba(15,23,42,0.12)}
    .progress-meta-thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .progress-meta-thumb-label{font-size:8px;line-height:1.1;text-align:center;color:#475569;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46px}
    .progress-photo-hero{position:relative;min-height:220px;border-radius:22px;overflow:hidden;border:1px solid #dbe4f0;background:#0f172a;margin-bottom:18px}
    .progress-photo-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
    .progress-photo-hero-overlay{position:absolute;inset:0;background:linear-gradient(90deg,rgba(15,23,42,.82),rgba(15,23,42,.34),rgba(15,23,42,.08))}
    .progress-photo-hero-copy{position:relative;z-index:1;color:#fff;padding:28px;max-width:560px}
    .progress-photo-kicker{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#bfdbfe;margin-bottom:8px}
    .progress-photo-title{font-size:30px;font-weight:800;margin-bottom:8px}
    .progress-photo-sub{font-size:13px;line-height:1.6;color:#e2e8f0}
    .progress-photo-pill{display:inline-flex;align-items:center;gap:8px;margin-top:14px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(191,219,254,.35);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#dbeafe}
    .progress-photo-strip{display:grid;grid-template-columns:repeat(${Math.max(heroPhotos.length, 1)},minmax(0,1fr));gap:12px;margin-bottom:18px}
    .progress-photo-frame{position:relative;min-height:160px;border-radius:18px;overflow:hidden;border:1px solid #dbe4f0;background:#0f172a}
    .progress-photo-label{position:absolute;left:12px;bottom:12px;padding:6px 10px;border-radius:999px;background:rgba(15,23,42,.74);border:1px solid rgba(191,219,254,.4);color:#dbeafe;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
    .progress-photo-placeholder{display:flex;align-items:center;gap:16px;min-height:160px;border-radius:18px;border:1px dashed #cbd5e1;background:#f8fafc;padding:18px}
    .progress-photo-logo{height:42px;width:auto;flex:0 0 auto}
    .progress-photo-placeholder-title{font-size:18px;font-weight:800;color:#0f172a}
    .progress-photo-placeholder-sub{font-size:12px;color:#64748b;line-height:1.6;margin-top:4px}
    .progress-grid-2{display:grid;grid-template-columns:1.1fr 0.9fr;gap:14px}
    .progress-grid-equal{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .progress-snapshot-widget{border:1px solid #dbe4f0;border-radius:16px;padding:16px;background:linear-gradient(180deg,#f8fbff 0%,#f4f8ff 100%)}
    .progress-snapshot-widget-kicker{font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b}
    .progress-snapshot-widget-value{font-size:28px;font-weight:800;line-height:1;margin-top:8px}
    .progress-snapshot-widget-sub{font-size:12px;line-height:1.6;color:#475569;margin-top:8px}
    .progress-snapshot-widget-detail{font-size:11px;line-height:1.6;color:#64748b;margin-top:4px}
    .progress-card{border:1px solid #dbe4f0;border-radius:16px;padding:16px;background:#ffffff;overflow:hidden}
    .progress-alert-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-bottom:18px}
    .progress-alert{border-radius:14px;padding:14px 16px;border:1px solid #dbe4f0;background:#f8fafc}
    .progress-alert.critical{background:#fef2f2;border-color:#fecaca}
    .progress-alert.warning{background:#fff7ed;border-color:#fed7aa}
    .progress-alert.info{background:#eff6ff;border-color:#bfdbfe}
    .progress-alert.success{background:#ecfdf5;border-color:#a7f3d0}
    .progress-alert-title{font-size:12px;font-weight:800;color:#0f172a;margin-bottom:4px}
    .progress-alert-body{font-size:12px;line-height:1.6;color:#334155}
    .progress-community-stack{display:grid;gap:14px}
    .progress-community-export-stack{display:grid;gap:18px}
    .progress-community-frame{border:1px solid #dbe4f0;border-radius:18px;overflow:hidden;background:#f8fafc}
    .progress-community-frame-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #dbe4f0;background:linear-gradient(180deg,#f8fbff 0%,#f1f7ff 100%)}
    .progress-community-frame-title{font-size:15px;font-weight:800;color:#0f172a}
    .progress-community-frame-sub{font-size:12px;color:#64748b;margin-top:4px}
    .progress-community-frame iframe{width:100%;min-height:1120px;border:0;display:block;background:#fff}
    .progress-community-report-page{border:1px solid #dbe4f0;border-radius:18px;overflow:hidden;background:#ffffff;break-before:page;page-break-before:always}
    .progress-community-export-body{padding:16px;background:#ffffff}
    .progress-community-export-body .progress-shell{margin-bottom:18px}
    .section{margin-bottom:18px}
    @media print {
      body{max-width:none;padding:0}
      .progress-grid-2,.progress-grid-equal{grid-template-columns:1fr 1fr}
      .progress-card-occupancy-trend{grid-column:1 / -1}
      .progress-card.section,.progress-grid-2 > .progress-card,.progress-grid-equal > .progress-card{
        break-inside:avoid;
        page-break-inside:avoid;
      }
    }
  </style></head><body>
    <div class="progress-shell">
      <div class="progress-brand">
        <img src="${resolveExportBrandLogoSrc()}" alt="ATLAS RISE logo">
        <div>
          <div class="progress-title">${escapeHtml(report.title)}</div>
          <div class="progress-sub">${escapeHtml(report.subtitle)}</div>
          <div class="progress-sub" style="margin-top:6px;max-width:640px">${escapeHtml(report.communityName)} · ${escapeHtml(report.reportPeriodLabel)} · month-to-date c-suite progress review</div>
        </div>
      </div>
      <div class="progress-meta">
        <div>Generated ${escapeHtml(formatPresentationTimestamp(report.generatedAt))}</div>
        <div style="margin-top:6px">${escapeHtml(report.sourceSummary)}</div>
        ${buildCommunityProgressThumbnailRail(report)}
      </div>
    </div>
    ${heroPhotos.length > 0 ? `<div class="progress-photo-hero">
      <img src="${heroPhoto}" alt="" class="progress-photo-img">
      <div class="progress-photo-hero-overlay"></div>
      <div class="progress-photo-hero-copy">
        <div class="progress-photo-kicker">${report.communityCount > 1 ? "Portfolio field view" : "Community field view"}</div>
        <div class="progress-photo-title">${escapeHtml(report.communityName)}</div>
        <div class="progress-photo-sub">${escapeHtml(report.communityCount > 1
          ? "A c-suite month-to-date portfolio operating view anchored by the saved community photo library and the combined occupancy, leasing, and renewal story."
          : "A c-suite month-to-date operating view anchored by the saved community photo library and the current occupancy, leasing, and renewal story.")}</div>
        <div class="progress-photo-pill">${escapeHtml(report.communityCount > 1 ? "Portfolio Progress" : "Community Progress")}</div>
      </div>
    </div>` : ""}
    ${photoStripHtml}
    <div class="progress-grid-equal section">
      ${heroCards.map(card => `<div class="progress-card">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:6px">${escapeHtml(card.label)}</div>
        <div style="font-size:24px;font-weight:700;color:#0f172a;margin-bottom:4px">${escapeHtml(card.value)}</div>
        <div style="font-size:12px;color:#475569">${escapeHtml(card.sub)}</div>
      </div>`).join("")}
    </div>
    ${buildCommunityProgressSnapshotWidgets(report)}
    ${buildCommunityProgressTrendSection(report, { showPointLabels: true })}
    ${alerts.length > 0 ? `<div class="progress-alert-grid">
        ${alerts.map(alertItem => `<div class="progress-alert ${alertItem.level || "info"}">
          <div class="progress-alert-title">${escapeHtml(alertItem.title)}</div>
          <div class="progress-alert-body">${escapeHtml(alertItem.body)}</div>
        </div>`).join("")}
      </div>` : `<div class="progress-alert success" style="margin-bottom:18px">
        <div class="progress-alert-title">All required breakout fields are present</div>
        <div class="progress-alert-body">The current month has enough saved data to render the report without inventing missing breakouts.</div>
      </div>`}
    <div class="progress-grid-2 section">
      <div>${buildDlrOccupancyPositionChart(report)}</div>
      <div>${buildDlrRenewalHealthChart(report)}</div>
    </div>
    <div class="progress-grid-2 section">
      <div class="progress-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px">Month-to-Date Pace</div>
        ${buildCommunityProgressPacePanel(report)}
      </div>
      <div class="progress-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px">Traffic Mix</div>
        ${buildCommunityProgressTrafficMixPanel(report)}
      </div>
    </div>
    <div class="progress-card section">
      <div style="font-size:14px;font-weight:700;margin-bottom:10px">Floor Plan Rent Variance vs Budget</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:12px">This chart compares each approved blended current-year projected/target budget rent against the current marketed rent by floor plan, using the saved floor plan rate first and imported market survey matches as fallback.</div>
      ${buildDlrFloorPlanVarianceChart(report)}
    </div>
    <div class="progress-card section">
      <div style="font-size:14px;font-weight:700;margin-bottom:10px">Forward Look</div>
      <div style="margin-bottom:12px">${buildDlrForwardLookChart(report)}</div>
      <table>
        <thead>
          <tr style="background:#eff6ff">
            <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#475569;text-align:left">Month</th>
            <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#475569;text-align:center">Expirations</th>
            <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#475569;text-align:center">Pending Outs</th>
            <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#475569;text-align:center">Pending Ins</th>
            <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#475569;text-align:center">Budget Occ</th>
            <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#475569;text-align:center">Projected Occ</th>
            <th style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#475569;text-align:center">Move-Ins Needed</th>
          </tr>
        </thead>
        <tbody>${forwardRows}</tbody>
      </table>
    </div>
  </body></html>`;
}

function buildMarketComparisonReportDocument(report) {
  if (!report) return "";
  const heroPhotos = Array.isArray(report.photoPool) ? report.photoPool.slice(0, 3) : [];
  const heroPhoto = heroPhotos[0]?.resolvedSrc || heroPhotos[0]?.previewSrc || heroPhotos[0]?.src || "";
  const heroCards = [
    { label: "Subject Occupancy", value: formatDlrPercent(report.subject?.occupancyPct), sub: `${formatDlrMetricValue(report.subject?.occupiedUnits)} occupied units` },
    { label: "Market Leased Occupancy", value: formatDlrPercent(report.market?.leasedPct), sub: `${formatDlrMetricValue(report.marketCoverageCount)} communities with market data` },
    { label: "Subject Rent", value: formatDlrCurrency(report.subject?.rent), sub: "Current subject rent" },
    { label: "Market Rent", value: formatDlrCurrency(report.market?.rent), sub: "Comp average rent" },
    { label: "Subject NER", value: formatDlrCurrency(report.subject?.ner), sub: "Current subject NER" },
    { label: "Market NER", value: formatDlrCurrency(report.market?.ner), sub: "Comp average NER" }
  ];
  const overallSectionHtml = buildMarketComparisonSectionHtml(report, { title: report.communityCount > 1 ? "Overall Portfolio Comparison" : report.communityName });
  const childSectionsHtml = Array.isArray(report.communityReports) && report.communityReports.length > 1
    ? report.communityReports.map(child => buildMarketComparisonSectionHtml(child, { title: child.communityName, compact: true })).join("")
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title><style>
    *{box-sizing:border-box}
    body{font-family:'DM Sans',Arial,sans-serif;padding:28px;color:#0f172a;background:#ffffff}
    .comparison-shell{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px;padding:18px 20px;border:1px solid #dbe4f0;border-radius:20px;background:linear-gradient(135deg,#f8fbff 0%,#eef5ff 100%)}
    .comparison-brand{display:flex;align-items:center;gap:14px}
    .comparison-brand img{height:38px;width:auto;object-fit:contain;display:block}
    .comparison-title{font-size:24px;font-weight:700;color:#1d4ed8}
    .comparison-sub{font-size:13px;color:#64748b}
    .comparison-meta{font-size:11px;color:#64748b;text-align:right}
    .comparison-photo-hero{position:relative;min-height:210px;border-radius:22px;overflow:hidden;border:1px solid #dbe4f0;background:#0f172a;margin-bottom:18px}
    .comparison-photo-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
    .comparison-photo-overlay{position:absolute;inset:0;background:linear-gradient(90deg,rgba(15,23,42,.82),rgba(15,23,42,.34),rgba(15,23,42,.08))}
    .comparison-photo-copy{position:relative;z-index:1;color:#fff;padding:28px;max-width:580px}
    .comparison-photo-kicker{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#bfdbfe;margin-bottom:8px}
    .comparison-photo-headline{font-size:30px;font-weight:800;margin-bottom:8px}
    .comparison-photo-copytext{font-size:13px;line-height:1.6;color:#e2e8f0}
    .comparison-photo-pill{display:inline-flex;align-items:center;gap:8px;margin-top:14px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(191,219,254,.35);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#dbeafe}
    .comparison-photo-strip{display:grid;grid-template-columns:repeat(${Math.max(heroPhotos.length, 1)},minmax(0,1fr));gap:12px;margin-bottom:18px}
    .comparison-photo-frame{position:relative;min-height:160px;border-radius:18px;overflow:hidden;border:1px solid #dbe4f0;background:#0f172a}
    .comparison-photo-label{position:absolute;left:12px;bottom:12px;padding:6px 10px;border-radius:999px;background:rgba(15,23,42,.74);border:1px solid rgba(191,219,254,.4);color:#dbeafe;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
    .comparison-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .comparison-card{border:1px solid #dbe4f0;border-radius:16px;padding:16px;background:#ffffff}
    .comparison-section{margin-bottom:18px}
    .comparison-child-stack{display:grid;gap:14px}
    .comparison-alert{border-radius:14px;padding:14px 16px;border:1px solid #dbe4f0;background:#f8fafc}
    @media print { body{padding:18px} .comparison-grid-2{grid-template-columns:1fr 1fr} }
  </style></head><body>
    <div class="comparison-shell">
      <div class="comparison-brand">
        <img src="${resolveExportBrandLogoSrc()}" alt="ATLAS RISE logo">
        <div>
          <div class="comparison-title">${escapeHtml(report.title)}</div>
          <div class="comparison-sub">${escapeHtml(report.subtitle)}</div>
          <div class="comparison-sub" style="margin-top:6px">${escapeHtml(report.sourceSummary)}</div>
        </div>
      </div>
      <div class="comparison-meta">
        <div>Generated ${escapeHtml(formatPresentationTimestamp(report.generatedAt))}</div>
        <div style="margin-top:6px">${escapeHtml(report.reportPeriodLabel)}</div>
      </div>
    </div>
    ${heroPhotos.length > 0 ? `<div class="comparison-photo-hero">
      <img src="${heroPhoto}" alt="" class="comparison-photo-img">
      <div class="comparison-photo-overlay"></div>
      <div class="comparison-photo-copy">
        <div class="comparison-photo-kicker">Market vs Subject</div>
        <div class="comparison-photo-headline">${escapeHtml(report.communityName)}</div>
        <div class="comparison-photo-copytext">A c-suite month-to-date operating view that compares the saved ATLAS subject performance against the weekly AptIQ submarket survey feed.</div>
        <div class="comparison-photo-pill">Market Comparison Report</div>
      </div>
    </div>` : ""}
    ${heroPhotos.length > 0 ? `<div class="comparison-photo-strip">
      ${heroPhotos.map(photo => {
        const src = photo.resolvedSrc || photo.previewSrc || photo.src || "";
        return `<div class="comparison-photo-frame">
          <img src="${src}" alt="" class="comparison-photo-img">
          <div class="comparison-photo-label">${escapeHtml(photo.community || report.communityName || "ATLAS")}</div>
        </div>`;
      }).join("")}
    </div>` : ""}
    <div class="comparison-grid-2 section">
      ${heroCards.map(card => `<div class="comparison-card">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:6px">${escapeHtml(card.label)}</div>
        <div style="font-size:24px;font-weight:700;color:#0f172a;margin-bottom:4px">${escapeHtml(card.value)}</div>
        <div style="font-size:12px;color:#475569">${escapeHtml(card.sub)}</div>
      </div>`).join("")}
    </div>
    <div class="comparison-section">
      ${overallSectionHtml}
    </div>
    ${childSectionsHtml ? `<div class="comparison-section">
      <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:10px">By Community</div>
      <div class="comparison-child-stack">${childSectionsHtml}</div>
    </div>` : ""}
  </body></html>`;
}
