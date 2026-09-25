/* Lazy bonus presentation layer. Shared state, calculations and write handlers remain in the shell. */
function renderBonusSharedDataPanel(propName = getProp().name) {
  const sharedData = normalizeAtlasSharedData(atlasSharedData);
  const assignments = getSharedAssignmentsForCommunity(propName);
  const employeeCount = Object.keys(sharedData.employees || {}).length;
  const currentAssignmentCount = sharedData.assignments.filter(assignment => isSharedAssignmentActiveOnDate(assignment, getAtlasTodayISODate())).length;
  const changeCount = Array.isArray(sharedData.employeeChangeEvents) ? sharedData.employeeChangeEvents.length : 0;
  const migrationCount = Array.isArray(sharedData.migrationBatches) ? sharedData.migrationBatches.length : 0;
  const issues = Array.isArray(sharedData.validationIssues) ? sharedData.validationIssues : [];
  const propertyIssues = issues.filter(issue =>
    !issue.communityName
    || normalizeCommunityLookupName(issue.communityName) === normalizeCommunityLookupName(propName)
    || String(issue.message || "").toLowerCase().includes(String(propName || "").toLowerCase())
  );
  const roleCounts = PROPERTY_TEAM_ROLE_ORDER
    .map(roleType => {
      const count = assignments.filter(assignment => assignment.bonusRoleType === roleType).length;
      return count ? `${SHARED_BONUS_ROLE_LABELS[roleType]}: ${count}` : "";
    })
    .filter(Boolean)
    .join(" · ");
  const assignmentRows = assignments.length
    ? assignments.map(assignment => `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--border2)">
        <div>
          <div style="font-size:0.74rem;font-weight:700;color:var(--text)">${escapeHtml(assignment.employeeName)}</div>
          <div style="font-size:0.64rem;color:var(--muted)">${escapeHtml(assignment.title || SHARED_BONUS_ROLE_LABELS[assignment.bonusRoleType] || "Role")} · ${escapeHtml(formatSharedAssignmentDateRange(assignment))}</div>
        </div>
        <span class="bonus-scope-pill">${escapeHtml(SHARED_BONUS_ROLE_LABELS[assignment.bonusRoleType] || assignment.bonusRoleType)}</span>
      </div>`).join("")
    : `<div style="font-size:0.7rem;color:var(--muted);padding-top:6px">No current People assignments are mapped to ${escapeHtml(propName)} for ${bonusQuarter}. Manual bonus entries remain visible as fallback rows.</div>`;
  const issueRows = propertyIssues.length
    ? `<div style="margin-top:10px;padding:10px;border:1px solid rgba(217,153,34,0.32);background:rgba(217,153,34,0.06);border-radius:8px">
        <div style="font-size:0.68rem;font-weight:700;color:#d29922;margin-bottom:6px">Shared data validation</div>
        ${propertyIssues.slice(0, 5).map(issue => `<div style="font-size:0.66rem;color:var(--muted);line-height:1.45">${escapeHtml(String(issue.severity || "warn").toUpperCase())}: ${escapeHtml(issue.message || issue.code || "Review shared data")}</div>`).join("")}
        ${propertyIssues.length > 5 ? `<div style="font-size:0.62rem;color:var(--muted);margin-top:4px">+${propertyIssues.length - 5} more issue${propertyIssues.length - 5 === 1 ? "" : "s"} in shared validation.</div>` : ""}
      </div>`
    : `<div style="margin-top:10px;font-size:0.66rem;color:#3fb950">No assignment validation issues for this community.</div>`;
  return `<div class="bonus-role-card" style="border-color:rgba(68,147,248,0.26)">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <div>
        <div class="bonus-role-name" style="font-size:0.84rem">Shared People Assignment Feed</div>
        <div style="font-size:0.68rem;color:var(--muted);margin-top:4px">People is the source for employee identity, status, title, and current community assignment. Bonus uses the assignment active for ${bonusQuarter} ${new Date().getFullYear()}.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span class="bonus-scope-pill">${employeeCount} People employees</span>
        <span class="bonus-scope-pill">${currentAssignmentCount} current assignments</span>
        <span class="bonus-scope-pill">${sharedData.historyBacked ? "Effective-dated history" : "Current-row fallback"}</span>
        <span class="bonus-scope-pill">${changeCount} employee changes</span>
        <span class="bonus-scope-pill">${sharedData.readOnlySnapshotCount || 0} snapshots</span>
        ${migrationCount ? `<span class="bonus-scope-pill">${migrationCount} migration batch${migrationCount === 1 ? "" : "es"}</span>` : ""}
        <span class="bonus-scope-pill">${sharedData.lastPeopleRosterVersion ? `Roster ${escapeHtml(sharedData.lastPeopleRosterVersion)}` : "Roster not versioned"}</span>
      </div>
    </div>
    <div style="font-size:0.68rem;color:var(--muted);margin-bottom:8px">${roleCounts || "No bonus-eligible People roles mapped here yet."}</div>
    ${assignmentRows}
    ${issueRows}
  </div>`;
}

function renderBonusEngineKpi(label, value, sub, tone = "", section = "calculations", field = "", filterValue = "") {
  return `<button type="button" class="bonus-engine-card bonus-engine-kpi bonus-engine-link-card ${tone}" onclick='atlasBonusDrill(${atlasBonusJsArg(section)},${atlasBonusJsArg(field)},${atlasBonusJsArg(filterValue)})'>
    <div>
      <div class="k">${escapeHtml(label)}</div>
      <div class="v">${escapeHtml(String(value))}</div>
      <div class="s">${escapeHtml(sub || "Open drill-down")}</div>
    </div>
    <div class="workspace-snapshot-link">Drill down</div>
  </button>`;
}

function renderBonusEngineFilters(rows = atlasBonusBuildCalculationRows({ filters: defaultBonusEngineState().filters })) {
  const state = atlasBonusState();
  const filters = state.filters;
  const optionValues = (values) => Array.from(new Set(values.map(item => String(item || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const regions = optionValues(rows.map(row => atlasBonusEmployeeRegionLabel(row.employee)));
  const communities = optionValues(rows.map(row => row.employee.communityName));
  const roles = optionValues([...BONUS_ENGINE_INITIAL_ROLES, ...rows.map(row => row.employee.bonusRole)]);
  const cadences = optionValues(["Weekly", "Monthly", "Quarterly", "Semiannual", "Annual", "One-time", "Custom period", ...atlasBonusState().plans.map(plan => plan.payoutCadence)]);
  const plans = atlasBonusState().plans;
  const statuses = optionValues(["Calculated", "Regional Approved", "Overrides Pending Approval", "HR Ready", "Paid", "Exceptions Blocking Approval", ...rows.map(row => row.approvalStatus)]);
  const select = (field, label, options) => `<div class="bonus-engine-field"><label>${escapeHtml(label)}</label><select onchange='atlasBonusUpdateFilter(${atlasBonusJsArg(field)},this.value)'><option value="all">All</option>${options.map(value => `<option value="${escapeHtml(value)}" ${filters[field] === value ? "selected" : ""}>${escapeHtml(value.replace(/_/g, " "))}</option>`).join("")}</select></div>`;
  return `<div class="bonus-engine-filters">
    <div class="bonus-engine-field"><label>Bonus Period</label><select onchange='atlasBonusUpdateFilter("periodKey",this.value)'><option value="${escapeHtml(atlasBonusPeriodFromQuarter().periodKey)}">${escapeHtml(atlasBonusPeriodFromQuarter().periodKey)}</option><option value="2026-Q1">2026-Q1</option><option value="2026-Q2">2026-Q2</option><option value="2026-Q3">2026-Q3</option><option value="2026-Q4">2026-Q4</option><option value="2027-Q1">2027-Q1</option></select></div>
    ${select("region", "Region", regions)}
    ${select("community", "Community", communities)}
    ${select("role", "Role", roles)}
    <div class="bonus-engine-field"><label>Employee</label><input value="${escapeHtml(filters.employee || "")}" placeholder="Search employee" oninput='atlasBonusUpdateFilter("employee",this.value)'></div>
    <div class="bonus-engine-field"><label>Plan</label><select onchange='atlasBonusUpdateFilter("planId",this.value)'><option value="all">All</option>${plans.map(plan => `<option value="${escapeHtml(plan.id)}" ${filters.planId === plan.id ? "selected" : ""}>${escapeHtml(plan.name)}</option>`).join("")}</select></div>
    ${select("approvalStatus", "Approval Status", statuses)}
    ${select("cadence", "Payout Cadence", cadences)}
    <div class="bonus-engine-field"><label>Operating Type</label><select onchange='atlasBonusUpdateFilter("operatingType",this.value)'><option value="all">All</option><option value="stabilized" ${filters.operatingType === "stabilized" ? "selected" : ""}>Stabilized</option><option value="lease_up" ${filters.operatingType === "lease_up" ? "selected" : ""}>Lease-up</option></select></div>
    <div class="bonus-engine-field"><label>Reset</label><button type="button" class="btn btn-gray btn-sm" onclick="atlasBonusResetFilters()">Clear Filters</button></div>
  </div>`;
}

function renderBonusEngineBarChart(rows = [], keyFn = () => "", title = "Breakdown") {
  const totals = atlasBonusGroupTotals(rows, keyFn).slice(0, 8);
  const max = Math.max(...totals.map(row => row.payout), 1);
  return `<div class="bonus-engine-card">
    <h3>${escapeHtml(title)}</h3>
    <div class="bonus-engine-chart-bars">
      ${totals.map(row => `<div class="bonus-engine-bar-row">
        <span>${escapeHtml(row.key)}</span>
        <div class="bonus-engine-progress"><span style="width:${Math.max(4, Math.min(100, (row.payout / max) * 100))}%"></span></div>
        <strong>${atlasBonusCurrency(row.payout)}</strong>
      </div>`).join("") || `<div class="bonus-engine-warning">No records are available for this breakdown.</div>`}
    </div>
  </div>`;
}

function renderBonusOverviewSection(rows) {
  const summary = atlasBonusSummary(rows);
  const pipeline = ["Calculated", "Regional Approved", "Overrides Pending Approval", "HR Ready", "Paid", "Exceptions Blocking Approval"];
  return `<div class="bonus-engine-grid">
    ${renderBonusEngineKpi("Current Bonus Period", atlasBonusPeriodFromQuarter().periodKey, `${atlasBonusDateLabel(atlasBonusPeriodFromQuarter().start)} to ${atlasBonusDateLabel(atlasBonusPeriodFromQuarter().end)}`, "gold", "calculations")}
    ${renderBonusEngineKpi("Bonus Eligible Employees", summary.employeeCount, "Permission-scoped employees in the current filter set", "", "calculations")}
    ${renderBonusEngineKpi("Projected Payout", atlasBonusCurrency(summary.projected), "Live projection from current ATLAS data", "green", "projected")}
    ${renderBonusEngineKpi("Approved Payout", atlasBonusCurrency(summary.approved), "Regional/HR approved amount", "", "approvals")}
    ${renderBonusEngineKpi("Bonus Budget", atlasBonusCurrency(summary.budget), "Current approved bonus pool", "gold", "forecast")}
    ${renderBonusEngineKpi("Variance To Budget", atlasBonusCurrency(summary.variance), summary.variance >= 0 ? "Projected under budget" : "Projected over budget", summary.variance >= 0 ? "green" : "red", "forecast")}
    ${renderBonusEngineKpi("Regional Approval", summary.awaitingRegional, "Payouts awaiting Regional review", "", "approvals", "approvalStatus", "Calculated")}
    ${renderBonusEngineKpi("HR Approval", summary.awaitingHr, "Payouts awaiting HR review", "", "approvals", "approvalStatus", "Regional Approved")}
    ${renderBonusEngineKpi("Exceptions", summary.criticalExceptions, "Critical exceptions block final approval", summary.criticalExceptions ? "red" : "green", "exceptions")}
    ${renderBonusEngineKpi("Above Goal", summary.aboveGoal, "Employees at or above current bonus potential", "green", "projected")}
    ${renderBonusEngineKpi("Below Goal", summary.belowGoal, "Employees currently below threshold or partial payout", "red", "projected")}
  </div>
  <div class="bonus-engine-grid three">
    ${renderBonusEngineBarChart(rows, row => atlasBonusEmployeeRegionLabel(row.employee), "Regional Comparison")}
    ${renderBonusEngineBarChart(rows, row => row.employee.communityName || "Portfolio / Central", "Property Comparison")}
    ${renderBonusEngineBarChart(rows, row => row.employee.bonusRole || "Role missing", "Role Comparison")}
  </div>
  <div class="bonus-engine-card">
    <div class="bonus-engine-section-head"><div><h3>Approval Pipeline</h3><p>Every status is clickable through the filtered Approval Center.</p></div><button class="btn btn-blue btn-sm" onclick='atlasBonusSetSection("approvals")'>Open Approval Center</button></div>
    <div class="bonus-engine-pipeline" style="margin-top:12px">
      ${pipeline.map(status => {
        const scoped = rows.filter(row => row.approvalStatus === status);
        return `<div class="bonus-engine-stage"><div class="bonus-engine-stage-title">${escapeHtml(status)}</div>${scoped.slice(0, 4).map(row => `<div class="bonus-engine-stage-row"><strong>${escapeHtml(atlasBonusEmployeeDisplayName(row.employee))}</strong><br>${escapeHtml(row.plan?.name || "No plan")}<br>${atlasBonusCurrency(row.finalPayout)}</div>`).join("") || `<div class="bonus-engine-stage-row">No records</div>`}<button class="btn btn-gray btn-sm" onclick='atlasBonusDrill("approvals","approvalStatus",${atlasBonusJsArg(status)})'>View</button></div>`;
      }).join("")}
    </div>
  </div>`;
}

function renderBonusMyBonusSection() {
  const projection = atlasBonusPersonalProjection();
  const hidden = atlasBonusPayoutHidden();
  return `${renderAtlasSelfSalaryPreview()}<div class="bonus-engine-grid two">
    ${renderAtlasPersonalBonusLandingWidget({ standalone: true })}
    <div class="bonus-engine-card">
      <h3>My Bonus Measurements</h3>
      <p>Employees can view goals, progress, projected payout, and completed payout history. Official editing, approval and overrides remain restricted. The private salary preview above is illustrative.</p>
      <div class="bonus-engine-small-list" style="margin-top:12px">
        ${projection.rows.map(row => `<div class="bonus-engine-small-row"><span>${escapeHtml(row.plan?.name || "No plan")}</span><strong>${hidden ? "•••••" : atlasBonusCurrency(row.projectedPayout)}</strong></div>`).join("") || `<div class="bonus-engine-warning">No personal bonus record matched this login.</div>`}
      </div>
    </div>
  </div>
  ${projection.rows.map(row => `<div class="bonus-engine-card">
    <div class="bonus-engine-section-head"><div><h3>${escapeHtml(atlasBonusEmployeeDisplayName(row.employee))} - ${escapeHtml(row.plan?.name || "No plan")}</h3><p>Controlling plan: ${escapeHtml(row.planSource)}. Salary calculation detail is excluded from this view.</p></div><span class="bonus-engine-pill ${row.unresolvedCritical ? "bad" : "good"}">${escapeHtml(row.approvalStatus)}</span></div>
    <div class="bonus-engine-table-wrap" style="margin-top:12px"><table class="bonus-engine-table"><thead><tr><th>Metric</th><th>Goal</th><th>Actual</th><th>Achievement</th><th>Projected Metric Payout</th><th>Source</th></tr></thead><tbody>
      ${row.metricResults.map(result => `<tr><td><strong>${escapeHtml(result.metric.name)}</strong></td><td>${escapeHtml(result.metric.format === "pct" ? atlasBonusPct(result.metric.goal, 1) : (result.metric.goal == null ? "Pending" : String(result.metric.goal)))}</td><td>${escapeHtml(result.actual === null ? "Calculation Pending - Missing Required Data" : result.metric.format === "pct" ? atlasBonusPct(result.actual, 1) : String(Number(result.actual).toFixed(1).replace(/\.0$/, "")))}</td><td>${atlasBonusPct(result.achievementPct, 0)}</td><td>${hidden ? "....." : atlasBonusCurrency(result.earned)}</td><td>${escapeHtml(result.metric.dataSource)}</td></tr>`).join("")}
    </tbody></table></div>
  </div>`).join("")}`;
}

function renderBonusPlanBuilderSection() {
  const state = atlasBonusState();
  const plan = atlasBonusFindPlan(state.selectedPlanId) || state.plans[0];
  if (!plan) return `<div class="bonus-engine-warning">No bonus plans are configured.</div>`;
  const weightTotal = plan.metrics.reduce((sum, metric) => sum + Number(metric.weight || 0), 0);
  const canEdit = atlasBonusCan("edit_bonus_plans");
  return `<div class="bonus-engine-grid two">
    <div class="bonus-engine-card">
      <div class="bonus-engine-section-head"><div><h3>Planning plan library</h3><p>Explore plan assumptions here. Use shared plan setup above to save reviewed terms for the approval workflow.</p></div><button class="btn btn-blue btn-sm" onclick='atlasBonusDuplicatePlan(${atlasBonusJsArg(plan.id)})' ${canEdit ? "" : "disabled"}>Duplicate Plan</button></div>
      <div class="bonus-engine-small-list" style="margin-top:12px">${state.plans.map(item => `<button type="button" class="bonus-engine-small-row" style="width:100%;background:transparent;border:0;cursor:pointer" onclick='atlasBonusSetSelectedPlan(${atlasBonusJsArg(item.id)})'><span><strong>${escapeHtml(item.name)}</strong><br><span style="font-size:0.62rem;color:var(--muted)">Version ${escapeHtml(item.version)} · ${escapeHtml(item.effectiveStart)} to ${escapeHtml(item.effectiveEnd)}</span></span><span class="bonus-engine-pill ${item.status === "active" ? "good" : item.status === "draft" ? "warn" : "info"}">${escapeHtml(item.status)}</span></button>`).join("")}</div>
    </div>
    <div class="bonus-engine-card">
      <h3>Plan Details</h3>
      <p>${escapeHtml(plan.description || "No description saved.")}</p>
      <div class="bonus-engine-grid two" style="margin-top:12px">
        <div class="bonus-engine-field"><label>Plan Name</label><input value="${escapeHtml(plan.name)}" onchange='atlasBonusUpdatePlanField(${atlasBonusJsArg(plan.id)},"name",this.value)' ${canEdit ? "" : "disabled"}></div>
        <div class="bonus-engine-field"><label>Status</label><select onchange='atlasBonusUpdatePlanField(${atlasBonusJsArg(plan.id)},"status",this.value)' ${canEdit ? "" : "disabled"}>${["draft","scheduled","active","expired","archived"].map(status => `<option value="${status}" ${plan.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></div>
        <div class="bonus-engine-field"><label>Effective Start</label><input type="date" value="${escapeHtml(plan.effectiveStart)}" onchange='atlasBonusUpdatePlanField(${atlasBonusJsArg(plan.id)},"effectiveStart",this.value)' ${canEdit ? "" : "disabled"}></div>
        <div class="bonus-engine-field"><label>Effective End</label><input type="date" value="${escapeHtml(plan.effectiveEnd)}" onchange='atlasBonusUpdatePlanField(${atlasBonusJsArg(plan.id)},"effectiveEnd",this.value)' ${canEdit ? "" : "disabled"}></div>
        <div class="bonus-engine-field"><label>Payout Cadence</label><select onchange='atlasBonusUpdatePlanField(${atlasBonusJsArg(plan.id)},"payoutCadence",this.value)' ${canEdit ? "" : "disabled"}>${["Weekly","Monthly","Quarterly","Semiannual","Annual","One-time","Custom period"].map(cadence => `<option value="${cadence}" ${plan.payoutCadence === cadence ? "selected" : ""}>${cadence}</option>`).join("")}</select></div>
        <div class="bonus-engine-field"><label>Operating Type</label><select onchange='atlasBonusUpdatePlanField(${atlasBonusJsArg(plan.id)},"eligibleOperatingType",this.value)' ${canEdit ? "" : "disabled"}>${[["any","Any"],["stabilized","Stabilized"],["lease_up","Lease-up"]].map(([value,label]) => `<option value="${value}" ${plan.eligibleOperatingType === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>
        <div class="bonus-engine-field"><label>Eligible Roles</label><input value="${escapeHtml(plan.eligibleRoles.join(", "))}" onchange='atlasBonusUpdatePlanField(${atlasBonusJsArg(plan.id)},"eligibleRoles",this.value)' ${canEdit ? "" : "disabled"}></div>
        <div class="bonus-engine-field"><label>Target / Max Payout</label><input type="number" value="${plan.maximumPayout}" onchange='atlasBonusUpdatePlanField(${atlasBonusJsArg(plan.id)},"maximumPayout",this.value)' ${canEdit ? "" : "disabled"}></div>
      </div>
      ${weightTotal > 100 || weightTotal < 75 ? `<div class="bonus-engine-warning" style="margin-top:12px">Metric weights total ${weightTotal}%. ATLAS warns on unusual weighting, but does not block activation solely because weights do not equal 100%.</div>` : ""}
    </div>
  </div>
  <div class="bonus-engine-card">
    <div class="bonus-engine-section-head"><div><h3>Bonus Metrics</h3><p>Select automatic ATLAS metrics or custom/manual metrics. Multiple payout structures and cadences can coexist inside one plan.</p></div><button class="btn btn-blue btn-sm" onclick='atlasBonusAddMetric(${atlasBonusJsArg(plan.id)})' ${canEdit ? "" : "disabled"}>Add Metric</button></div>
    <div class="bonus-engine-table-wrap" style="margin-top:12px"><table class="bonus-engine-table"><thead><tr><th>Metric</th><th>Goal</th><th>Weight</th><th>Payout Structure</th><th>Cadence</th><th>Data Source</th><th>Favorable</th><th>Max</th></tr></thead><tbody>
      ${plan.metrics.map(metric => `<tr>
        <td><input value="${escapeHtml(metric.name)}" onchange='atlasBonusUpdateMetric(${atlasBonusJsArg(plan.id)},${atlasBonusJsArg(metric.id)},"name",this.value)' ${canEdit ? "" : "disabled"}></td>
        <td><input type="number" value="${metric.goal}" onchange='atlasBonusUpdateMetric(${atlasBonusJsArg(plan.id)},${atlasBonusJsArg(metric.id)},"goal",this.value)' ${canEdit ? "" : "disabled"}></td>
        <td><input type="number" value="${metric.weight}" onchange='atlasBonusUpdateMetric(${atlasBonusJsArg(plan.id)},${atlasBonusJsArg(metric.id)},"weight",this.value)' ${canEdit ? "" : "disabled"}></td>
        <td><select onchange='atlasBonusUpdateMetric(${atlasBonusJsArg(plan.id)},${atlasBonusJsArg(metric.id)},"payoutStructure",this.value)' ${canEdit ? "" : "disabled"}>${BONUS_ENGINE_PAYOUT_STRUCTURES.map(([value,label]) => `<option value="${value}" ${metric.payoutStructure === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></td>
        <td><select onchange='atlasBonusUpdateMetric(${atlasBonusJsArg(plan.id)},${atlasBonusJsArg(metric.id)},"cadence",this.value)' ${canEdit ? "" : "disabled"}>${["Weekly","Monthly","Quarterly","Semiannual","Annual","One-time","Custom period"].map(cadence => `<option value="${cadence}" ${metric.cadence === cadence ? "selected" : ""}>${cadence}</option>`).join("")}</select></td>
        <td><select onchange='atlasBonusUpdateMetric(${atlasBonusJsArg(plan.id)},${atlasBonusJsArg(metric.id)},"dataSource",this.value)' ${canEdit ? "" : "disabled"}>${Array.from(new Set(BONUS_ENGINE_METRIC_LIBRARY.map(item => item[3]))).map(source => `<option value="${escapeHtml(source)}" ${metric.dataSource === source ? "selected" : ""}>${escapeHtml(source)}</option>`).join("")}</select></td>
        <td><select onchange='atlasBonusUpdateMetric(${atlasBonusJsArg(plan.id)},${atlasBonusJsArg(metric.id)},"favorable",this.value)' ${canEdit ? "" : "disabled"}><option value="higher" ${metric.favorable === "higher" ? "selected" : ""}>Higher</option><option value="lower" ${metric.favorable === "lower" ? "selected" : ""}>Lower</option></select></td>
        <td><input type="number" value="${metric.maximumPayout}" onchange='atlasBonusUpdateMetric(${atlasBonusJsArg(plan.id)},${atlasBonusJsArg(metric.id)},"maximumPayout",this.value)' ${canEdit ? "" : "disabled"}></td>
      </tr>`).join("")}
    </tbody></table></div>
  </div>`;
}

function renderBonusAssignmentsSection(rows) {
  const state = atlasBonusState();
  const hierarchy = ["Individual Employee Override", "Property-Specific Plan", "Role Plan", "Default Bonus Plan"];
  return `<div class="bonus-engine-grid two">
    <div class="bonus-engine-card"><h3>Assignment Hierarchy</h3><p>${hierarchy.join(" -> ")}</p><div class="bonus-engine-small-list" style="margin-top:12px">${hierarchy.map((item, idx) => `<div class="bonus-engine-small-row"><span>${idx + 1}. ${escapeHtml(item)}</span><strong>${idx === 0 ? "Highest" : idx === hierarchy.length - 1 ? "Fallback" : "Next"}</strong></div>`).join("")}</div></div>
    <div class="bonus-engine-card"><h3>Operating Type Coverage</h3><p>Community operating type can be managed from Communities or the assignment layer.</p><div class="bonus-engine-small-list" style="margin-top:12px">${Object.entries(state.communityOperatingTypes).map(([name,type]) => `<div class="bonus-engine-small-row"><span>${escapeHtml(name)}</span><strong>${escapeHtml(type === "lease_up" ? "Lease-up" : "Stabilized")}</strong></div>`).join("") || `<div class="bonus-engine-warning">No explicit community operating overrides are saved.</div>`}</div></div>
  </div>
  <div class="bonus-engine-card">
    <h3>Active Assignments</h3>
    <div class="bonus-engine-table-wrap" style="margin-top:12px"><table class="bonus-engine-table"><thead><tr><th>Level</th><th>Role</th><th>Community</th><th>Employee</th><th>Operating Type</th><th>Plan</th><th>Effective Dates</th></tr></thead><tbody>
      ${state.assignments.map(item => `<tr><td><span class="bonus-engine-pill info">${escapeHtml(item.level)}</span></td><td>${escapeHtml(item.role || "Any")}</td><td>${escapeHtml(item.communityName || "Any")}</td><td>${escapeHtml(item.employeeId || "Any")}</td><td>${escapeHtml(item.operatingType)}</td><td>${escapeHtml(atlasBonusFindPlan(item.planId)?.name || item.planId)}</td><td>${escapeHtml(item.effectiveStart)} - ${escapeHtml(item.effectiveEnd || "Current")}</td></tr>`).join("")}
    </tbody></table></div>
  </div>
  <div class="bonus-engine-card">
    <h3>Controlling Plan by Employee</h3>
    <div class="bonus-engine-table-wrap" style="margin-top:12px"><table class="bonus-engine-table"><thead><tr><th>Employee</th><th>Role</th><th>Community</th><th>Controlling Plan</th><th>Source</th><th>Hierarchy</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td><strong>${escapeHtml(atlasBonusEmployeeDisplayName(row.employee))}</strong></td><td>${escapeHtml(row.employee.bonusRole)}</td><td>${escapeHtml(row.employee.communityName || "Portfolio / Central")}</td><td>${escapeHtml(row.plan?.name || "Missing plan")}</td><td>${escapeHtml(row.planSource)}</td><td>${escapeHtml(row.hierarchy)}</td></tr>`).join("")}
    </tbody></table></div>
  </div>`;
}

function renderBonusCalculationRows(rows, options = {}) {
  const showSalary = options.showSalary && atlasBonusCanViewSalary();
  return `<div class="bonus-engine-table-wrap"><table class="bonus-engine-table"><thead><tr><th>Employee</th><th>Role / Community</th><th>Plan</th><th>Potential</th><th>Projected</th><th>Approved receipt</th><th>Proration</th><th>Status</th><th>${showSalary ? "Salary" : "Actions"}</th></tr></thead><tbody>
    ${rows.map(row => `<tr>
      <td><strong>${escapeHtml(atlasBonusEmployeeDisplayName(row.employee))}</strong><div style="color:var(--muted);font-size:0.62rem">${escapeHtml(row.employee.payrollEmployeeId || row.employee.employeeId || "")}</div></td>
      <td>${escapeHtml(row.employee.bonusRole || "Role missing")}<div style="color:var(--muted);font-size:0.62rem">${escapeHtml(row.employee.communityName || "Portfolio / Central")} · ${escapeHtml(row.operatingType)}</div></td>
      <td>${escapeHtml(row.plan?.name || "Missing plan")}<div style="color:var(--muted);font-size:0.62rem">${escapeHtml(row.planSource)}</div></td>
      <td>${atlasBonusCurrency(row.maximumPotential)}</td>
      <td>${atlasBonusCurrency(row.projectedPayout)}</td>
      <td><strong>${atlasBonusCurrency(row.finalPayout)}</strong></td>
      <td>${atlasBonusPct(row.proration.factor * 100, 0)}<div style="color:var(--muted);font-size:0.62rem">${row.proration.eligibleDays}/${row.proration.totalDays} days${row.proration.segments.length ? " · transfer" : ""}</div></td>
      <td><span class="bonus-engine-pill ${row.unresolvedCritical ? "bad" : row.approvalStatus.includes("Approved") || row.approvalStatus === "Paid" ? "good" : row.approvalStatus.includes("Override") ? "warn" : "info"}">${escapeHtml(row.approvalStatus)}</span></td>
      <td>${showSalary ? atlasBonusCurrency(row.employee.salary) : `<button class="btn btn-gray btn-sm" onclick='atlasBonusDrill("projected","employee",${atlasBonusJsArg(atlasBonusEmployeeDisplayName(row.employee))})'>Detail</button>`}</td>
    </tr>`).join("") || `<tr><td colspan="9">No calculation rows match the current filters.</td></tr>`}
  </tbody></table></div>`;
}

function renderBonusCalculationsSection(rows) {
  return `<div class="bonus-engine-card">
    <div class="bonus-engine-section-head"><div><h3>Bonus calculations</h3><p>The shared workflow above stores calculated amounts, review decisions, and payroll confirmations. Planning projections remain available below.</p></div><div class="bonus-engine-actions"><button class="btn btn-blue btn-sm" onclick="atlasBonusRunCalculations()" ${atlasBonusCan("run_calculations") ? "" : "disabled"}>Create Shared Calculation</button><button class="btn btn-gray btn-sm" onclick="atlasBonusFinalizePeriod()" ${atlasBonusCan("finalize_period") ? "" : "disabled"}>Payroll Confirmations</button></div></div>
  </div>${renderBonusCalculationRows(rows)}`;
}

function renderBonusProjectedSection(rows) {
  return `<div class="bonus-engine-grid">${rows.map(row => {
    const pct = row.projectedPayout === null || row.maximumPotential === null ? null : row.maximumPotential > 0 ? Math.min(100, (row.projectedPayout / row.maximumPotential) * 100) : 0;
    return `<div class="bonus-engine-card">
      <div class="bonus-engine-section-head"><div><h3>${escapeHtml(atlasBonusEmployeeDisplayName(row.employee))}</h3><p>${escapeHtml(row.plan?.name || "Missing plan")} · ${escapeHtml(row.planSource)}</p></div><span class="bonus-engine-pill ${row.unresolvedCritical ? "bad" : "info"}">${escapeHtml(row.approvalStatus)}</span></div>
      <div class="bonus-engine-kpi" style="border-left-color:#fcb53b;margin-top:12px;min-height:auto"><div class="v">${atlasBonusCurrency(row.projectedPayout)}</div><div class="s">${atlasBonusPct(pct, 0)} of ${atlasBonusCurrency(row.maximumPotential)} maximum potential</div></div>
      <div class="bonus-engine-progress" style="margin:10px 0 12px"><span style="width:${pct}%"></span></div>
      <div class="bonus-engine-small-list">${row.metricResults.map(result => `<div class="bonus-engine-small-row"><span>${escapeHtml(result.metric.name)}<br><span style="font-size:0.6rem;color:var(--muted)">${escapeHtml(result.metric.dataSource)} · ${escapeHtml(result.metric.cadence)}</span></span><strong>${result.actual === null ? "Pending" : atlasBonusCurrency(result.earned)}</strong></div>`).join("")}</div>
      ${row.proration.segments.length ? `<div class="bonus-engine-warning" style="margin-top:12px">Transfer calculation: ${row.proration.segments.map(segment => `${escapeHtml(segment.communityName)} ${segment.days} days`).join(" + ")}. Community-level detail is preserved in the calculation record.</div>` : ""}
    </div>`;
  }).join("")}</div>`;
}

function renderBonusApprovalsSection(rows) {
  return `<div class="bonus-engine-card"><h3>Shared approval history</h3><p>Use Shared approvals and payroll confirmations above to review saved calculations, record approval, and lock verified amounts for payroll.</p><button type="button" class="btn btn-blue btn-sm" onclick="atlasBonusOpenSharedWorkflow()">Open shared workflow</button></div>${renderBonusCalculationRows(rows)}`;
}

function renderBonusExceptionsSection(rows) {
  const groups = atlasBonusExceptionGroups(rows);
  const critical = groups.filter(g => g.exception.severity === "critical").length;
  return `<div class="bonus-engine-card">
    <div class="bonus-engine-section-head"><div><h3>Bonus Exception Queue</h3><p>Grouped by prerequisite, community, plan and period. Recording review does not clear a missing source. Recalculation removes a blocker only when its prerequisite is verified.</p></div><span class="bonus-engine-pill ${critical ? "bad" : "good"}">${critical} critical · ${groups.length-critical} warnings</span></div>
    <div class="bonus-engine-table-wrap" style="margin-top:12px"><table class="bonus-engine-table"><thead><tr><th>Root cause / prerequisite</th><th>Scope</th><th>Owner and required action</th><th>Approval / synchronization</th><th>Lineage and review history</th></tr></thead><tbody>
    ${groups.map(g => `<tr><td><strong>${escapeHtml(g.exception.message)}</strong><br>${escapeHtml(g.rule[0])}<br>${escapeHtml(g.metric?.metric.dataSource || g.rule[1])}</td><td>${escapeHtml(g.community || "Missing community")}<br>${escapeHtml(g.plan || "Missing plan")}<br>${escapeHtml(g.period)}<details><summary>${g.rows.length} affected employee${g.rows.length===1?"":"s"}</summary>${g.rows.map(row=>`<p>${escapeHtml(atlasBonusEmployeeDisplayName(row.employee))}<br>ID: ${escapeHtml(row.employee.employeeId || "Missing")}</p>`).join("")}</details></td><td>${escapeHtml(g.rule[1])}<br>${escapeHtml(g.rule[2])}</td><td>${g.exception.severity === "critical" ? "Payout approval blocked" : "Advisory; no automatic pay reduction"}<br>Awaiting verified prerequisite<br>Source as of: ${escapeHtml(g.rows[0].employee.sourceUpdatedAt || "Not recorded")}<br>Last People sync: ${escapeHtml(atlasSharedData?.lastPeopleSyncAt || "Not recorded")}</td><td><details><summary>Source lineage and reviewer history</summary><pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify({source:g.metric?.metric.dataSource||g.rule[1],period:g.period,community:g.community,plan:g.rows[0].plan?{id:g.rows[0].plan.id,version:g.rows[0].plan.version}:null,approvedGoalVersions:g.metric?.approvedGoalVersions||[],financialEvidence:g.metric?.financialEvidence||null},null,2))}</pre>${g.rows.map(row=>{const key=`${row.rowId}_${g.exception.code}_${g.exception.metricId || ""}`;return `<p>${escapeHtml(atlasBonusEmployeeDisplayName(row.employee))}: ${escapeHtml(atlasBonusState().exceptionStatusById[key] || "Not reviewed")} <button class="btn btn-gray btn-sm" onclick='atlasBonusResolveException(${atlasBonusJsArg(row.rowId)},${atlasBonusJsArg(g.exception.code)},${atlasBonusJsArg(g.exception.metricId || "")})' ${atlasBonusCan("override_calculations")?"":"disabled"}>Record review</button></p>`;}).join("")}<p>Full reviewer actions remain in Audit Trail.</p></details></td></tr>`).join("") || '<tr><td colspan="5">No exceptions in this scope.</td></tr>'}
    </tbody></table></div></div>`;
}

function renderBonusForecastSection(rows) {
  const summary = atlasBonusSummary(rows);
  return `<div class="bonus-engine-grid">
    ${renderBonusEngineKpi("Portfolio Projection", atlasBonusCurrency(summary.projected), "Current projected portfolio payout", "green", "projected")}
    ${renderBonusEngineKpi("Budgeted Bonus Pool", atlasBonusCurrency(summary.budget), "Approved bonus budget", "gold", "forecast")}
    ${renderBonusEngineKpi("Budget Variance", atlasBonusCurrency(summary.variance), "Positive means remaining budget capacity", summary.variance >= 0 ? "green" : "red", "forecast")}
    ${renderBonusEngineKpi("Approved Payout", atlasBonusCurrency(summary.approved), "Approved through current workflow", "", "approvals")}
    ${renderBonusEngineKpi("Remaining Exposure", atlasBonusCurrency(Math.max(summary.budget - summary.approved, 0)), "Budget remaining after approved payouts", "gold", "forecast")}
  </div>
  <div class="bonus-engine-grid three">
    ${renderBonusEngineBarChart(rows, row => atlasBonusEmployeeRegionLabel(row.employee), "Forecast by Region")}
    ${renderBonusEngineBarChart(rows, row => row.employee.communityName || "Portfolio / Central", "Forecast by Property")}
    ${renderBonusEngineBarChart(rows, row => row.plan?.name || "Missing Plan", "Forecast by Bonus Plan")}
  </div>`;
}

function renderBonusReportsSection() {
  const reports = [
    ["regional_summary", "Regional Bonus Approval Summary", "Designed for Regional review and electronic certification."],
    ["employee_detail", "Employee Detail Calculation", "Metric, actual performance, goal, payout, and final result."],
    ["property_summary", "Property Bonus Summary", "Bonus-eligible employees by property."],
    ["exceptions", "Exceptions & Overrides Report", "Manual adjustments and exception-based payouts."],
    ["hr_payroll", "HR Payroll Processing Report", "Employee ID, property, position, period, approved payout, payroll code, status, approval date, and notes. Salary is excluded."],
    ["executive_summary", "Executive Portfolio Bonus Summary", "Companywide bonus performance and cost."],
  ];
  return `<div class="bonus-engine-card">
    <div class="bonus-engine-section-head"><div><h3>Reports & Exports</h3><p>PDF is optimized for approval and signatures. Excel/CSV are optimized for HR, payroll, accounting, and finance.</p></div><span class="bonus-engine-pill good">Salary excluded from standard exports</span></div>
    <div class="bonus-engine-table-wrap" style="margin-top:12px"><table class="bonus-engine-table"><thead><tr><th>Report</th><th>Purpose</th><th>Formats</th></tr></thead><tbody>
      ${reports.map(([key,title,purpose]) => `<tr><td><strong>${escapeHtml(title)}</strong></td><td>${escapeHtml(purpose)}</td><td><div class="bonus-engine-actions"><button class="btn btn-gray btn-sm" onclick='atlasBonusExportReport(${atlasBonusJsArg(key)},"pdf")'>PDF</button><button class="btn btn-gray btn-sm" onclick='atlasBonusExportReport(${atlasBonusJsArg(key)},"excel")'>Excel</button><button class="btn btn-gray btn-sm" onclick='atlasBonusExportReport(${atlasBonusJsArg(key)},"csv")'>CSV</button></div></td></tr>`).join("")}
    </tbody></table></div>
  </div>
  <div class="bonus-engine-secure-note">Secure calculation detail is available only to Admin and HR roles with View Salary permission. Payroll reports intentionally exclude salary even when exported by HR.</div>
  ${atlasBonusCanViewSalary() ? `<div class="bonus-engine-card"><h3>Secure Calculation Detail</h3><p>Admin/HR salary view. This block is not rendered for unauthorized roles.</p>${renderBonusCalculationRows(atlasBonusBuildCalculationRows(), { showSalary: true })}</div>` : ""}`;
}

function renderBonusHistorySection(rows) {
  const state = atlasBonusState();
  const simulation = state.simulation;
  return `<div class="bonus-engine-grid two">
    <div class="bonus-engine-card"><div class="bonus-engine-section-head"><div><h3>Plan Simulation</h3><p>Simulate a proposed bonus plan against historical data without changing actual historical records.</p></div><button class="btn btn-blue btn-sm" onclick="atlasBonusRunSimulation()" ${atlasBonusCan("run_calculations") ? "" : "disabled"}>Simulate Using Historical Data</button></div>${simulation ? `<div class="bonus-engine-grid two" style="margin-top:12px">${renderBonusEngineKpi("Proposed Payout", atlasBonusCurrency(simulation.proposed), "Simulation result", "green", "history")}${renderBonusEngineKpi("Historical Payout", atlasBonusCurrency(simulation.historicalActual), "Actual prior payout", "", "history")}${renderBonusEngineKpi("Variance", atlasBonusCurrency(simulation.variance), "Proposed vs actual", simulation.variance >= 0 ? "gold" : "red", "history")}${renderBonusEngineKpi("Employees Gaining", simulation.gainingEmployees, `${simulation.losingEmployees} losing payout`, "info", "history")}</div>` : `<div class="bonus-engine-warning" style="margin-top:12px">No simulation has been run yet.</div>`}</div>
    <div class="bonus-engine-card"><h3>Finalized Historical Records</h3><p>Historical records stay tied to the plan version used at calculation time, even when an employee changes role, transfers, leaves RISE, or becomes inactive.</p><div class="bonus-engine-small-list" style="margin-top:12px">${rows.slice(0, 6).map(row => `<div class="bonus-engine-small-row"><span>${escapeHtml(row.period.periodKey)} · ${escapeHtml(atlasBonusEmployeeDisplayName(row.employee))}</span><strong>${escapeHtml(row.plan?.version || "Version pending")}</strong></div>`).join("")}</div></div>
  </div>
  <div class="bonus-engine-card"><h3>Historical Bonus Plans</h3><div class="bonus-engine-table-wrap" style="margin-top:12px"><table class="bonus-engine-table"><thead><tr><th>Plan</th><th>Version</th><th>Status</th><th>Effective Dates</th><th>Metrics</th><th>Action</th></tr></thead><tbody>${state.plans.map(plan => `<tr><td><strong>${escapeHtml(plan.name)}</strong></td><td>${escapeHtml(plan.version)}</td><td><span class="bonus-engine-pill ${plan.status === "active" ? "good" : plan.status === "draft" ? "warn" : "info"}">${escapeHtml(plan.status)}</span></td><td>${escapeHtml(plan.effectiveStart)} - ${escapeHtml(plan.effectiveEnd)}</td><td>${plan.metrics.length}</td><td><button class="btn btn-gray btn-sm" onclick='atlasBonusSetSelectedPlan(${atlasBonusJsArg(plan.id)})'>Open</button></td></tr>`).join("")}</tbody></table></div></div>`;
}

function renderBonusAuditSection() {
  const rows = atlasBonusState().auditTrail || [];
  return `<div class="bonus-engine-card"><h3>Full Audit Trail</h3><p>Tracks plan changes, metric changes, employee assignments, calculation runs, overrides, approvals, finalization, and reopen actions.</p><div class="bonus-engine-table-wrap" style="margin-top:12px"><table class="bonus-engine-table"><thead><tr><th>Action</th><th>Entity</th><th>User</th><th>Date / Time</th><th>Previous</th><th>New</th><th>Reason</th></tr></thead><tbody>${rows.map(row => `<tr><td><strong>${escapeHtml(row.action)}</strong></td><td>${escapeHtml(row.entity)}</td><td>${escapeHtml(row.user)}</td><td>${row.at ? new Date(row.at).toLocaleString() : ""}</td><td>${escapeHtml(row.previousValue)}</td><td>${escapeHtml(row.newValue)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join("") || `<tr><td colspan="7">No audit activity recorded yet.</td></tr>`}</tbody></table></div></div>`;
}

function renderBonusSettingsSection() {
  const role = atlasBonusCurrentRole();
  return `<div class="bonus-engine-grid two">
    <div class="bonus-engine-card"><h3>Bonus Permissions</h3><p>Granular permissions are surfaced in People -> ATLAS User Setup -> Permissions. Salary is Admin/HR only by default.</p><div class="bonus-engine-table-wrap" style="margin-top:12px"><table class="bonus-engine-table"><thead><tr><th>Permission</th><th>This Role</th></tr></thead><tbody>${BONUS_ENGINE_PERMISSION_DEFS.map(([key,label]) => `<tr><td>${escapeHtml(label)}</td><td><span class="bonus-engine-pill ${atlasBonusCan(key) ? "good" : "bad"}">${atlasBonusCan(key) ? "On" : "Off"}</span></td></tr>`).join("")}</tbody></table></div></div>
    <div class="bonus-engine-card"><h3>People Bonus Fields</h3><p>Use the shared eligibility setup above to record approved employee eligibility. Calculation readiness is checked against shared plans and source records.</p><div class="bonus-engine-small-list" style="margin-top:12px">${["Bonus Eligible - Yes / No","Bonus Plan","Effective Date","Target Bonus","Assigned Community","Assigned Region","Salary","Payroll / Employee ID","Bonus Role","Override Plan","Bonus Plan Status"].map(field => `<div class="bonus-engine-small-row"><span>${escapeHtml(field)}</span><strong>Verify source</strong></div>`).join("")}</div></div>
  </div>
  <div class="bonus-engine-secure-note">Current role: ${escapeHtml(role)}. View Salary = ${atlasBonusCanViewSalary() ? "ON" : "OFF"}. When off, salary values are not rendered in screens, tooltips, reports, exports, dashboard widgets, or calculation payloads sent from this module.</div>`;
}

function renderBonusEngineSection(section, rows) {
  if (section === "overview") return renderBonusOverviewSection(rows);
  if (section === "my_bonus") return renderBonusMyBonusSection();
  if (section === "builder") return renderBonusPlanBuilderSection();
  if (section === "assignments") return renderBonusAssignmentsSection(rows);
  if (section === "calculations") return renderBonusCalculationsSection(rows);
  if (section === "projected") return renderBonusProjectedSection(rows);
  if (section === "approvals") return renderBonusApprovalsSection(rows);
  if (section === "exceptions") return renderBonusExceptionsSection(rows);
  if (section === "forecast") return renderBonusForecastSection(rows);
  if (section === "reports") return renderBonusReportsSection();
  if (section === "history") return renderBonusHistorySection(rows);
  if (section === "audit") return renderBonusAuditSection();
  if (section === "settings") return renderBonusSettingsSection();
  return renderBonusOverviewSection(rows);
}

function renderBonusTab() {
  const state = atlasBonusState();
  const allRows = atlasBonusBuildCalculationRows({ filters: defaultBonusEngineState().filters });
  const rows = atlasBonusBuildCalculationRows({ sourceRows: allRows });
  const summary = atlasBonusSummary(rows);
  const period = atlasBonusPeriodFromQuarter();
  const sections = atlasBonusVisibleSections();
  atlasBonusSectionCache.clear();
  atlasBonusNavigationSnapshot = {rows,period};
  if (!sections.length) {
    return `<div class="card"><div class="card-title">Bonus & Incentives</div><div class="alert-red">This ATLAS account does not have Bonus & Incentives access.</div></div>`;
  }
  const activeSection = sections.some(([id]) => id === state.activeSection) ? state.activeSection : sections[0][0];
  atlasBonusMountSharedWorkflow(period);
  return `<section class="bonus-engine-shell">
    <div class="bonus-engine-hero">
      <div class="bonus-engine-kicker">RISE ATLAS / Bonus & Incentives Engine</div>
      <h1>Performance, compensation, approval, and payroll readiness in one workspace.</h1>
      <p>Use shared approvals for verified plan terms, employee eligibility, calculations, review and payroll confirmations. The planning sections below retain draft projections and examples.</p>
      <div class="bonus-engine-toolbar">
        <span class="bonus-engine-pill good">${escapeHtml(period.periodKey)}</span>
        <span class="bonus-engine-pill">${summary.employeeCount} people in planning view</span>
        <span class="bonus-engine-pill ${summary.criticalExceptions ? "bad" : "good"}">${summary.criticalExceptions} critical exceptions</span>
        <span class="bonus-engine-pill info">Projected ${atlasBonusCurrency(summary.projected)}</span>
        ${atlasBonusCan("run_calculations") ? `<button type="button" class="btn btn-blue btn-sm" onclick="atlasBonusRunCalculations()">Run Calculations</button>` : ""}
        ${atlasBonusSectionVisible("reports") ? `<button type="button" class="btn btn-gray btn-sm" onclick='atlasBonusSetSection("reports")'>Reports</button>` : ""}
      </div>
    </div>
    <div id="atlas-bonus-shared-workflow" data-workflow-context="${escapeHtml(atlasBonusSharedWorkflowContext(period))}" aria-live="polite"></div>
    <div class="bonus-engine-nav">
      ${sections.map(([id, label]) => `<button type="button" data-bonus-section="${escapeHtml(id)}" class="bonus-engine-tab ${activeSection === id ? "active" : ""}" onclick='atlasBonusSetSection(${atlasBonusJsArg(id)})'>${escapeHtml(label)}</button>`).join("")}
    </div>
    ${renderBonusEngineFilters(allRows)}
    <div data-bonus-section>${renderBonusEngineSection(activeSection, rows)}
    ${activeSection === "exceptions" && atlasBonusCan("run_calculations") ? renderAtlasBonusAgingDisclosure(period,state) : ""}</div>
  </section>`;
}
window.AtlasBonusWorkspace = true;
