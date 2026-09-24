/* Lazy admin presentation layer. Shared state, calculations and write handlers remain in the shell. */
function renderAtlasAccessCheckboxes(name, options = [], selectedValues = []) {
  const selected = new Set(normalizeAtlasAccessList(selectedValues));
  return `<div class="atlas-access-checks">${options.map(option => {
    const value = String(option.value || "").trim();
    return `<label><input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${selected.has(value) ? "checked" : ""} onchange="syncAtlasAccessFormDraftFromPanel()">${escapeHtml(option.label || value)}</label>`;
  }).join("")}</div>`;
}

function renderAtlasEmployeeAccessRows(displayRows = buildAtlasEmployeeAccessDisplayRows()) {
  const profilesByEmail = new Map((atlasAccessAdminState.profiles || []).map(profile => [String(profile.email || "").toLowerCase(), profile]));
  const rows = Array.isArray(displayRows) ? displayRows : [];
  if (!rows.length) {
    return `<tr><td colspan="5" style="color:var(--muted)">No employee roster or access records are available yet.</td></tr>`;
  }
  return rows.map(row => {
    const email = String(row.email || "").toLowerCase();
    const profile = profilesByEmail.get(email);
    const rosterEligibility = row._atlasRosterEligibility || getAtlasRosterProvisioningEligibility(row._atlasRosterEmployee || row);
    const accessStatus = row._atlasRosterOnly ? "not_configured" : (row.access_status || row.status || profile?.status || "active");
    const accountStatus = getAtlasProvisioningAccountStatus(row, profile);
    const allowedCount = normalizeAtlasAccessList(row.allowed_community_ids || profile?.allowed_community_ids).length;
    const lockedTabs = normalizeAtlasAccessList(row.locked_tab_ids || profile?.locked_tab_ids)
      .filter(tabId => !ATLAS_SELF_SERVICE_TAB_IDS.includes(tabId));
    const lastInvite = formatAtlasProvisioningDate(row.invitation_sent_at || row.password_reset_sent_at || row.updated_at);
    const payload = encodeURIComponent(JSON.stringify({
      email,
      displayName: row.display_name || profile?.display_name || "",
      role: row.role || profile?.role || "viewer",
      status: row.status || profile?.status || "active",
      accessStatus,
      accountStatus,
      employeeId: row.employee_id || profile?.employee_id || "",
      allowedCommunityIds: normalizeAtlasAccessList(row.allowed_community_ids || profile?.allowed_community_ids),
      allowedMarketValues: normalizeAtlasAccessList(row.allowed_market_values || profile?.allowed_market_values),
      allowedRegionValues: normalizeAtlasAccessList(row.allowed_region_values || profile?.allowed_region_values),
      lockedTabIds: lockedTabs,
      lockedPageKeys: normalizeAtlasAccessList(row.locked_page_keys || profile?.locked_page_keys),
      accessNotes: row.access_notes || profile?.access_notes || ""
    }));
    const inviteLabel = ["not_invited", "invitation_expired"].includes(accountStatus) ? "Send Invite" : "Resend Invite";
    const primaryAction = !rosterEligibility.eligible
      ? `<button class="btn btn-gray btn-sm" onclick="prefillAtlasUserAccess('${payload}')">Review</button>`
      : row._atlasRosterOnly
        ? `<button class="btn btn-gray btn-sm" onclick="prefillAtlasUserAccess('${payload}')">Set Up</button>`
        : accountStatus === "active"
      ? `<button class="btn btn-gray btn-sm" onclick="sendAtlasAccessProvisioningAction('${payload}','password_reset')">Reset</button>`
      : `<button class="btn btn-gray btn-sm" onclick="sendAtlasAccessProvisioningAction('${payload}','invite')">${inviteLabel}</button>`;
    const rosterNote = row._atlasRosterOnly
      ? `<span style="color:#6b7280">Roster only · ${escapeHtml(rosterEligibility.message)}</span>`
      : (row._atlasRosterEmployee ? `<span style="color:#6b7280">Roster linked</span>` : "");
    const emailLine = email || rosterEligibility.message || "Email needed";
    return `<tr>
      <td><strong>${escapeHtml(row.display_name || profile?.display_name || emailLine)}</strong><div style="color:var(--muted);font-size:0.64rem">${escapeHtml(emailLine)}</div>${rosterNote ? `<div style="font-size:0.62rem;margin-top:3px">${rosterNote}</div>` : ""}</td>
      <td>${escapeHtml((row.role || profile?.role || "viewer").replace(/_/g, " "))}</td>
      <td>${getAtlasAccessStatusBadge(accessStatus)}<div style="height:4px"></div>${getAtlasAccountStatusBadge(accountStatus)}${lastInvite ? `<div style="color:var(--muted);font-size:0.62rem;margin-top:4px">Last invite: ${escapeHtml(lastInvite)}</div>` : ""}</td>
      <td>${allowedCount ? `${allowedCount} properties` : "Role/default scope"}${lockedTabs.length ? `<div style="color:#8b0000;font-size:0.64rem">${lockedTabs.length} locked tabs</div>` : ""}</td>
      <td style="text-align:right"><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">${primaryAction}<button class="btn btn-gray btn-sm" onclick="prefillAtlasUserAccess('${payload}')">Edit</button></div></td>
    </tr>`;
  }).join("");
}

function renderAtlasEmployeeAccessPanel() {
  const status = getAtlasCentralStatus();
  const profile = getAtlasAccessProfile();
  const profileEditorHtml = status.signedIn ? renderAtlasCurrentProfileEditor(profile, status) : "";
  if (!status.configured) {
    return `<div class="card mb4"><div class="card-title">Employee Access</div><div class="alert-red">Central ATLAS must be configured before employee access can be managed.</div></div>`;
  }
  if (!status.signedIn) {
    return `<div class="card mb4"><div class="card-title">Employee Access</div><div class="alert-red">Sign in from ATLAS Settings before managing employee access.</div></div>`;
  }
  if (!atlasProfileCanManageSettings(profile)) {
    const lockedTabs = normalizeAtlasAccessList(profile?.locked_tab_ids)
      .filter(tabId => !ATLAS_SELF_SERVICE_TAB_IDS.includes(tabId))
      .map(tabId => getAtlasAccessTab(tabId).label);
    const scopeCount = normalizeAtlasAccessList(profile?.allowed_community_ids).length;
    return `${profileEditorHtml}<div class="card mb4">
      <div class="card-title">My ATLAS Access</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span class="atlas-access-pill">${escapeHtml(profile?.display_name || status.userEmail || "Signed-in user")}</span>
        <span class="atlas-access-pill">${escapeHtml((profile?.role || "viewer").replace(/_/g, " "))}</span>
        ${getAtlasAccessStatusBadge(profile?.status || "active")}
      </div>
      <div style="font-size:0.7rem;color:var(--muted);line-height:1.55">Assigned property scope: ${scopeCount || "role/default"}. Locked pages: ${lockedTabs.length ? escapeHtml(lockedTabs.join(", ")) : "none"}.</div>
    </div>`;
  }
  queueAtlasAccessAdminLoad();
  queueAtlasCentralPeopleLoad({ force: false });
  if (!atlasAccessAdminState.loaded) {
    return `${profileEditorHtml}<div class="card mb4">
      <div class="card-title">Employee Access</div>
      <div style="font-size:0.7rem;color:var(--muted);line-height:1.55;margin-bottom:10px">Loading employee access records, active employee roster, and scope options for this admin session.</div>
      ${atlasAccessAdminState.error
        ? `<div class="alert-red">${escapeHtml(atlasAccessAdminState.error)}</div>`
        : `<div class="alert-green">${atlasAccessAdminState.loading ? "Loading access panel..." : "Preparing access panel..."}</div>`}
    </div>`;
  }
  const draft = normalizeAtlasAccessFormDraft(atlasAccessFormDraft);
  const accessDisplayRows = buildAtlasEmployeeAccessDisplayRows();
  const rosterCoverage = buildAtlasAccessRosterCoverage(accessDisplayRows);
  const rosterCoverageText = rosterCoverage.rosterTotal
    ? `${rosterCoverage.rosterTotal} roster employees · ${rosterCoverage.eligibleWithAccess}/${rosterCoverage.eligibleTotal} eligible employees configured · ${rosterCoverage.eligibleWithoutAccess} ready to set up · ${rosterCoverage.emailReviewTotal} need email review`
    : "No roster employees loaded yet.";
  const communityOptions = (atlasAccessAdminState.communities || []).map(community => ({
    value: community.community_id,
    label: `${community.display_name}${community.status === "inactive" ? " · Inactive (explicit assignment only)" : ""}${community.market ? ` · ${community.market}` : ""}`
  }));
  const locationCounts = (atlasAccessAdminState.communities || []).reduce((acc, community) => {
    const key = atlasCommunityLocationScopeValue(community);
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const locationOptions = ATLAS_LOCATION_SCOPE_OPTIONS
    .filter(option => (locationCounts[option.value] || 0) > 0 || option.value === "west")
    .map(option => ({
      value: option.value,
      label: locationCounts[option.value] ? `${option.label} · ${locationCounts[option.value]} properties` : option.label
    }));
  const employeeOptions = buildAtlasAccessEmployeeDirectoryEntries().map(employee => {
    const displayName = employee.profileDisplayName || employee.fullName || employee.email || employee.employeeId;
    const suffix = employee.profileDisplayName && employee.fullName && employee.profileDisplayName !== employee.fullName
      ? ` (${escapeHtml(employee.fullName)})`
      : "";
    return `<option value="${escapeHtml(employee.employeeId)}" ${employee.employeeId === draft.employeeId ? "selected" : ""}>${escapeHtml(displayName)}${employee.email ? ` · ${escapeHtml(employee.email)}` : ""}${suffix}</option>`;
  }).join("");
  const tabOptions = ATLAS_ACCESS_TABS
    .filter(tab => !ATLAS_SELF_SERVICE_TAB_IDS.includes(tab.id))
    .map(tab => ({ value: tab.id, label: tab.label }));
  const bonusPermissionOptions = ATLAS_BONUS_PERMISSION_DEFS.map(([value, label]) => ({ value, label }));
  const saveFeedback = atlasEmployeeRecordSaveState.employeeKey === String(draft.employeeId || draft.email || "") ? atlasEmployeeRecordSaveState : { busy: false, status: "", message: "", savedAt: "" };
  return `${profileEditorHtml}<div class="card mb4">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div class="card-title" style="margin-bottom:6px">Employee Details + Access</div>
        <div style="font-size:0.7rem;color:var(--muted);line-height:1.55">Create or update ATLAS access inside the People workspace after checking the roster. Use linked employee autofill to pull roster identity into the access form, then finalize scope and page permissions here.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-gray btn-sm" onclick="loadAtlasAccessAdminData({ force:true, silent:false })">${atlasAccessAdminState.loading ? "Loading..." : "Refresh Access"}</button>
        <button class="btn btn-gray btn-sm" onclick="copyAtlasAccessSetupInstructions()">Copy Backup Instructions</button>
      </div>
    </div>
    ${atlasAccessAdminState.error ? `<div class="alert-red" style="margin-bottom:10px">${escapeHtml(atlasAccessAdminState.error)}</div>` : ""}
    <div class="atlas-access-workspace">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div>
            <div class="card-title">Roster + Access Records</div>
            <div style="font-size:0.66rem;color:var(--muted);margin-top:4px">${atlasAccessAdminState.lastLoadedAt ? `Loaded ${new Date(atlasAccessAdminState.lastLoadedAt).toLocaleString()}` : "Access records load after sign-in."}</div>
            <div style="font-size:0.66rem;color:var(--muted);margin-top:4px">${escapeHtml(rosterCoverageText)}</div>
          </div>
          <div style="font-size:0.66rem;color:var(--muted)">Choose an existing record to edit, or set up a roster employee before sending an invite.</div>
        </div>
        <div class="tbl-wrap" style="margin:0;max-height:320px;overflow:auto">
          <table class="atlas-access-table">
            <thead><tr><th>User</th><th>Role</th><th>Access / Account</th><th>Scope</th><th></th></tr></thead>
            <tbody>${renderAtlasEmployeeAccessRows(accessDisplayRows)}</tbody>
          </table>
        </div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px">
        <div class="card-title">Create / Edit Access</div>
        <div style="font-size:0.66rem;color:var(--muted);margin:4px 0 10px">This workspace stays below the roster so the People page can use the full desktop height before you enter access details.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:10px">
          <label><span style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Email</span><input id="atlas-access-email" type="email" value="${escapeHtml(draft.email)}" placeholder="employee@risere.com" oninput="syncAtlasAccessFormDraftFromPanel()"></label>
          <label><span style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Display name</span><input id="atlas-access-display-name" value="${escapeHtml(draft.displayName)}" placeholder="Employee name" oninput="syncAtlasAccessFormDraftFromPanel()"></label>
          <label><span style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Role</span><select id="atlas-access-role" onchange="syncAtlasAccessFormDraftFromPanel()">${ATLAS_ACCESS_ROLES.map(([value,label]) => `<option value="${value}" ${value === draft.role ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label><span style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Status</span><select id="atlas-access-status" onchange="syncAtlasAccessFormDraftFromPanel()">${ATLAS_ACCESS_STATUSES.map(([value,label]) => `<option value="${value}" ${value === draft.status ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        </div>
        <label><span style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Linked employee / autofill</span><select id="atlas-access-employee" onchange="handleAtlasAccessEmployeeSelection(this.value)"><option value="">No employee link</option>${employeeOptions}</select></label>
        <div style="font-size:0.64rem;color:var(--muted);margin-top:6px">Select an established employee to prefill email and display name, then adjust any field before saving.</div>
        <div style="display:grid;gap:10px;margin-top:10px">
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div class="card-title">Property Scope</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button type="button" class="btn btn-gray btn-sm" onclick="setAtlasAccessAllProperties(true)">All Active Properties</button>
                <button type="button" class="btn btn-gray btn-sm" onclick="setAtlasAccessAllProperties(false)">Clear</button>
              </div>
            </div>
            <div id="atlas-access-community-summary" style="font-size:0.64rem;color:var(--muted);margin:6px 0 8px">${buildAtlasAccessPropertyScopeSummary(draft.allowedCommunityIds.length, communityOptions.length)}</div>
            ${renderAtlasAccessCheckboxes("atlas-access-communities", communityOptions, draft.allowedCommunityIds)}
          </div>
          <div><div class="card-title">Location Scope</div><div style="font-size:0.64rem;color:var(--muted);margin:4px 0 8px">Markets and regions are consolidated here into consistent East, Central, and West access groupings.</div>${renderAtlasAccessCheckboxes("atlas-access-locations", locationOptions, atlasAccessLocationScopeValues(draft))}</div>
          <div><div class="card-title">Locked Tabs / Pages</div><p style="font-size:0.72rem">Checked means blocked. Leave a page unchecked to allow the role’s normal access.</p>${renderAtlasAccessCheckboxes("atlas-access-tabs", tabOptions, draft.lockedTabIds)}</div>
          <div><div class="card-title">Bonus & Incentives Permissions</div><div style="font-size:0.64rem;color:var(--muted);margin:4px 0 8px">Leave blank to use role defaults. Turn on View Salary only for Admin or HR users.</div>${renderAtlasAccessCheckboxes("atlas-access-bonus-permissions", bonusPermissionOptions, draft.bonusPermissions)}</div>
          <label><span style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Access notes</span><textarea id="atlas-access-notes" placeholder="Optional admin note" oninput="syncAtlasAccessFormDraftFromPanel()">${escapeHtml(draft.accessNotes)}</textarea></label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-blue btn-sm" onclick="submitAtlasUserAccessForm()" ${saveFeedback.busy ? "disabled" : ""}>${saveFeedback.busy ? "Saving..." : "Save Employee Access"}</button>
          ${saveFeedback.status === "success" ? `<div class="alert-green" role="status" style="padding:7px 10px"><strong>Save Confirmed</strong><div style="font-size:0.6rem;margin-top:2px">${escapeHtml(new Date(saveFeedback.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</div></div>` : saveFeedback.status === "error" ? `<div class="alert-red" role="alert" style="padding:7px 10px"><strong>Save failed</strong><div style="font-size:0.6rem;margin-top:2px">${escapeHtml(saveFeedback.message)}</div></div>` : ""}
          <button class="btn btn-blue btn-sm" onclick="saveAndSendAtlasUserInvitation('invite')">${atlasCentralAuthActionState.accessInvite ? "Sending..." : "Save & Send Invitation"}</button>
          <button class="btn btn-gray btn-sm" onclick="saveAndSendAtlasUserInvitation('password_reset')">${atlasCentralAuthActionState.accessReset ? "Sending..." : "Send Password Reset"}</button>
          <button class="btn btn-gray btn-sm" onclick="copyAtlasAccessSetupInstructions()">Copy Backup Instructions</button>
          <button class="btn btn-gray btn-sm" onclick="clearAtlasUserAccessForm()">Clear Form</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderAtlasCentralPlatformPanel() {
  const status = getAtlasCentralStatus();
  const config = getAtlasCentralConfig();
  const profile = window.ATLAS_CENTRAL?.getStoredProfile ? window.ATLAS_CENTRAL.getStoredProfile() : null;
  const badgeColor = status.configured ? "#3fb950" : "#d29922";
  const authColor = status.signedIn ? "#3fb950" : "#d29922";
  const authActionBusy = atlasCentralAnyAuthActionIsRunning();
  const magicLinkBusy = atlasCentralAuthActionState.magicLink;
  const passwordSignInBusy = atlasCentralAuthActionState.passwordSignIn;
  const passwordSignUpBusy = atlasCentralAuthActionState.passwordSignUp;
  const documentVersion = atlasCentralRuntimeMeta.lastDocumentVersion
    ? `Local browser is aligned to central version ${atlasCentralRuntimeMeta.lastDocumentVersion}.`
    : "This browser has not been aligned to a central document version yet.";
  const lastActivity = [
    atlasCentralRuntimeMeta.lastSavedAt ? `saved ${new Date(atlasCentralRuntimeMeta.lastSavedAt).toLocaleString()}` : "",
    atlasCentralRuntimeMeta.lastPulledAt ? `pulled ${new Date(atlasCentralRuntimeMeta.lastPulledAt).toLocaleString()}` : "",
    atlasCentralRuntimeMeta.lastSnapshotUploadedAt ? `snapshot uploaded ${new Date(atlasCentralRuntimeMeta.lastSnapshotUploadedAt).toLocaleString()}` : ""
  ].filter(Boolean).join(" · ") || "No central activity from this browser yet.";
  const autosaveReady = atlasCentralAutosaveGateSatisfied();
  const safetyItems = [
    atlasCentralRuntimeMeta.lastSnapshotUploadedAt ? `Snapshot uploaded ${new Date(atlasCentralRuntimeMeta.lastSnapshotUploadedAt).toLocaleString()}` : "Snapshot upload pending",
    atlasCentralRuntimeMeta.reconciliationReviewedAt ? `Reconciliation reviewed ${new Date(atlasCentralRuntimeMeta.reconciliationReviewedAt).toLocaleString()}` : "Reconciliation review pending",
    atlasCentralRuntimeMeta.rollbackTestedAt ? `Rollback tested ${new Date(atlasCentralRuntimeMeta.rollbackTestedAt).toLocaleString()}` : "Rollback test pending"
  ];
  const migrationActivity = [
    atlasCentralRuntimeMeta.lastPeopleDryRunAt ? `People dry run ${new Date(atlasCentralRuntimeMeta.lastPeopleDryRunAt).toLocaleString()}` : "",
    atlasCentralRuntimeMeta.lastPeopleAppliedAt ? `People applied ${new Date(atlasCentralRuntimeMeta.lastPeopleAppliedAt).toLocaleString()}` : "",
    atlasCentralRuntimeMeta.lastMarketingDryRunAt ? `Marketing dry run ${new Date(atlasCentralRuntimeMeta.lastMarketingDryRunAt).toLocaleString()}` : "",
    atlasCentralRuntimeMeta.lastMarketingAppliedAt ? `Marketing applied ${new Date(atlasCentralRuntimeMeta.lastMarketingAppliedAt).toLocaleString()}` : "",
    atlasCentralRuntimeMeta.lastMaintenanceDryRunAt ? `Maintenance dry run ${new Date(atlasCentralRuntimeMeta.lastMaintenanceDryRunAt).toLocaleString()}` : "",
    atlasCentralRuntimeMeta.lastMaintenanceAppliedAt ? `Maintenance applied ${new Date(atlasCentralRuntimeMeta.lastMaintenanceAppliedAt).toLocaleString()}` : "",
    atlasCentralRuntimeMeta.lastBonusRecordedAt ? `Bonus recorded ${new Date(atlasCentralRuntimeMeta.lastBonusRecordedAt).toLocaleString()}` : ""
  ].filter(Boolean).join(" · ") || "No canonical table promotion has run from this browser yet.";
  return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <div>
        <div class="card-title" style="margin-bottom:6px">Central Platform Control</div>
        <div style="font-size:0.68rem;color:var(--muted);line-height:1.55">Phase 3 adds hosted database connection, authenticated access, read-only migration snapshots, audit-backed central document saves, and version conflict checks. Local records stay intact until an authorized user explicitly pushes or pulls central state.</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <span class="bonus-scope-pill" style="border-color:${badgeColor};color:${badgeColor}">${escapeHtml(status.mode || "legacy-migration")}</span>
        <span class="bonus-scope-pill" style="border-color:${authColor};color:${authColor}">${status.signedIn ? "signed in" : "signed out"}</span>
      </div>
    </div>
    <div style="font-size:0.66rem;color:var(--muted);margin-bottom:10px">${escapeHtml(status.message || "")}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-bottom:10px">
      <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:10px">
        <div class="card-title" style="font-size:0.72rem;margin-bottom:8px">Hosted Database</div>
        <label style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">ATLAS app URL</label>
        <input id="atlas-central-app-url" type="url" value="${escapeHtml(config.appBaseUrl || "")}" placeholder="https://jac1827.github.io/ATLAS/portfolio-operations-dashboard/index.html" style="margin:5px 0 8px">
        <label style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Invitation service URL</label>
        <input id="atlas-central-access-api-url" type="url" value="${escapeHtml(config.accessApiBaseUrl || "")}" placeholder="https://rise-performance-platform-site.jacquelyn-heflin.workers.dev" style="margin:5px 0 8px">
        <label style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Supabase URL</label>
        <input id="atlas-central-url" type="url" value="${escapeHtml(config.supabaseUrl || "")}" placeholder="https://project.supabase.co" style="margin:5px 0 8px">
        <label style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Public publishable / anon key</label>
        <input id="atlas-central-anon-key" type="password" value="${escapeHtml(config.supabaseAnonKey || "")}" placeholder="Public browser anon key" style="margin:5px 0 8px">
        <label style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Central document key</label>
        <input id="atlas-central-document-key" value="${escapeHtml(config.documentKey || "atlas_dashboard_state_v1")}" style="margin:5px 0 8px">
        <label style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Allowed email domains</label>
        <input id="atlas-central-domains" value="${escapeHtml((config.allowedEmailDomains || []).join(", "))}" placeholder="riseresidential.com" style="margin:5px 0 8px">
        <label style="display:flex;gap:8px;align-items:center;font-size:0.68rem;color:var(--muted);margin-top:4px"><input id="atlas-central-autosave" type="checkbox" ${config.autosave ? "checked" : ""} ${autosaveReady ? "" : "disabled"}> Save dashboard changes to central after local save</label>
        <label style="display:flex;gap:8px;align-items:center;font-size:0.68rem;color:var(--muted);margin-top:4px"><input id="atlas-central-realtime" type="checkbox" ${config.realtime ? "checked" : ""}> Enable realtime when the hosted database is ready</label>
        <label style="display:flex;gap:8px;align-items:center;font-size:0.68rem;color:var(--muted);margin-top:4px"><input id="atlas-central-autopull" type="checkbox" ${config.autoPullOnStartup ? "checked" : ""}> Check central version on startup</label>
        <label style="display:flex;gap:8px;align-items:center;font-size:0.68rem;color:var(--muted);margin-top:4px"><input id="atlas-central-allow-signup" type="checkbox" ${config.allowMagicLinkSignup ? "checked" : ""}> Allow login links to create approved-domain accounts</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-blue btn-sm" onclick="saveAtlasCentralRuntimeConfigFromPanel()">Save Central Config</button>
          <button class="btn btn-gray btn-sm" onclick="clearAtlasCentralRuntimeConfigFromPanel()">Clear Browser Config</button>
        </div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:10px">
        <div class="card-title" style="font-size:0.72rem;margin-bottom:8px">User Access</div>
        <div style="font-size:0.66rem;color:var(--muted);margin-bottom:8px">${status.signedIn ? `Signed in as ${escapeHtml(status.userEmail || profile?.email || "authenticated user")}${status.role ? ` · ${escapeHtml(status.role)}` : ""}` : "Use the dedicated ATLAS login page for everyday sign-in. This admin card is only a backup path while settings are being configured."}</div>
        <label style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Display name</label>
        <input id="atlas-central-display-name" value="${escapeHtml(profile?.display_name || "")}" placeholder="Atlas admin name" style="margin:5px 0 8px">
        <label style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Email</label>
        <input id="atlas-central-email" type="email" value="${escapeHtml(status.userEmail || "")}" placeholder="name@riseresidential.com" style="margin:5px 0 8px">
        <label style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em">Password</label>
        <input id="atlas-central-password" type="password" placeholder="Required for sign-in or activation" style="margin:5px 0 8px">
        <label style="display:flex;gap:8px;align-items:center;font-size:0.68rem;color:var(--muted);margin:4px 0 8px"><input id="atlas-central-create-user" type="checkbox" ${config.allowMagicLinkSignup ? "checked" : ""}> Create account if it does not exist</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-gray btn-sm" onclick="sendAtlasCentralMagicLink()" ${authActionBusy ? "disabled" : ""}>${magicLinkBusy ? "Sending Link..." : "Send Sign-In Link"}</button>
          <button class="btn btn-gray btn-sm" onclick="signUpAtlasCentralWithPassword()" ${authActionBusy ? "disabled" : ""}>${passwordSignUpBusy ? "Activating..." : "Activate Account"}</button>
          <button class="btn btn-blue btn-sm" onclick="signInAtlasCentralWithPassword()" ${authActionBusy ? "disabled" : ""}>${passwordSignInBusy ? "Signing In..." : "Sign In"}</button>
          <button class="btn btn-blue btn-sm" onclick="claimAtlasCentralFirstAdmin()" ${status.signedIn ? "" : "disabled"}>Activate First Admin</button>
          <button class="btn btn-gray btn-sm" onclick="signOutAtlasCentral()" ${status.signedIn && !authActionBusy ? "" : "disabled"}>Sign Out</button>
          <button class="btn btn-gray btn-sm" onclick="verifyAtlasCentralConnection()" ${authActionBusy ? "disabled" : ""}>Check Central</button>
        </div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:10px">
        <div class="card-title" style="font-size:0.72rem;margin-bottom:8px">Migration-Safe Central Data</div>
        <div style="font-size:0.66rem;color:var(--muted);line-height:1.5;margin-bottom:8px">${escapeHtml(documentVersion)} ${escapeHtml(lastActivity)}</div>
        <div style="font-size:0.64rem;color:${autosaveReady ? "#3fb950" : "#d29922"};line-height:1.5;margin-bottom:8px">${safetyItems.map(item => escapeHtml(item)).join(" · ")}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-blue btn-sm" onclick="saveAtlasCentralAppState({ silent:false, source:'manual_central_save' })" ${status.signedIn ? "" : "disabled"}>Save Current State To Central</button>
          <button class="btn btn-gray btn-sm" onclick="pullAtlasCentralAppState({ silent:false })" ${status.signedIn ? "" : "disabled"}>Pull Central State</button>
          <button class="btn btn-gray btn-sm" onclick="inspectAtlasOccupancyReadback()">Check Published Occupancy</button>
          <button class="btn btn-gray btn-sm" onclick="uploadAtlasCentralMigrationSnapshot({ silent:false })" ${status.signedIn && !atlasCentralSnapshotUploadInProgress ? "" : "disabled"}>${atlasCentralSnapshotUploadInProgress ? "Uploading Snapshot..." : "Upload Read-Only Snapshot"}</button>
          <button class="btn btn-gray btn-sm" onclick="downloadAtlasCentralMigrationSnapshot()">Export Snapshot JSON</button>
          <button class="btn btn-gray btn-sm" onclick="markAtlasCentralReconciliationReviewed()">Mark Reconciliation Reviewed</button>
          <button class="btn btn-gray btn-sm" onclick="testAtlasCentralRollbackSnapshot()">Test Rollback Snapshot</button>
          <button class="btn btn-gray btn-sm" onclick="disableAtlasLegacySharedBundle()" ${autosaveReady ? "" : "disabled"}>Disable Legacy Shared Bundle</button>
        </div>
        <div style="font-size:0.62rem;color:#d29922;margin-top:8px">Pulling central state downloads a rollback snapshot before changing this browser. Saving central state is blocked if the central version changed since this browser last pulled or saved. Autosave unlocks only after snapshot upload, reconciliation review, and rollback testing.</div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:10px">
        <div class="card-title" style="font-size:0.72rem;margin-bottom:8px">Canonical Table Cutover</div>
        <div style="font-size:0.66rem;color:var(--muted);line-height:1.5;margin-bottom:8px">${escapeHtml(migrationActivity)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-gray btn-sm" onclick="promoteAtlasCentralPeopleDirectory(true)" ${status.signedIn && !atlasCentralPeoplePromotionInProgress ? "" : "disabled"}>${atlasCentralPeoplePromotionMode === "dry_run" ? "Dry Running People..." : "Dry Run People"}</button>
          <button class="btn btn-blue btn-sm" onclick="promoteAtlasCentralPeopleDirectory(false)" ${status.signedIn && !atlasCentralPeoplePromotionInProgress ? "" : "disabled"}>${atlasCentralPeoplePromotionMode === "apply" ? "Applying People..." : "Apply People"}</button>
          <button class="btn btn-gray btn-sm" onclick="loadAtlasCentralPeopleAssignments({ silent:false, force:true })" ${status.signedIn ? "" : "disabled"}>Refresh Central People</button>
          <button class="btn btn-gray btn-sm" onclick="promoteAtlasCentralMarketingMetrics(true)" ${status.signedIn ? "" : "disabled"}>Dry Run Marketing Metrics</button>
          <button class="btn btn-blue btn-sm" onclick="promoteAtlasCentralMarketingMetrics(false)" ${status.signedIn ? "" : "disabled"}>Apply Marketing Metrics</button>
          <button class="btn btn-gray btn-sm" onclick="promoteAtlasCentralMaintenanceInspections(true)" ${status.signedIn ? "" : "disabled"}>Dry Run MSOE/SOE</button>
          <button class="btn btn-blue btn-sm" onclick="promoteAtlasCentralMaintenanceInspections(false)" ${status.signedIn ? "" : "disabled"}>Apply MSOE/SOE</button>
          <button class="btn btn-gray btn-sm" onclick="recordAtlasCentralBonusCalculation()" ${status.signedIn ? "" : "disabled"}>Open Shared Bonus Workflow</button>
        </div>
        <div style="font-size:0.62rem;color:var(--muted);margin-top:8px">People remains the source for employee identity/status/assignment. Marketing metrics and Moonrise MSOE/SOE imports promote only approved or reviewable source records and retain original identifiers.</div>
      </div>
    </div>
    ${atlasCentralRuntimeMeta.lastMessage ? `<div class="alert-green" style="margin-top:10px">${escapeHtml(atlasCentralRuntimeMeta.lastMessage)}</div>` : ""}
    ${atlasCentralRuntimeMeta.lastError ? `<div class="alert-red" style="margin-top:10px">${escapeHtml(atlasCentralRuntimeMeta.lastError)}</div>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn btn-gray btn-sm" href="./centralization/atlas-central-migration-plan.md" target="_blank" rel="noopener">Migration Plan</a>
      <a class="btn btn-gray btn-sm" href="./centralization/atlas-central-schema.sql" target="_blank" rel="noopener">Database Schema</a>
      <a class="btn btn-gray btn-sm" href="./centralization/atlas-central-config.example.js" target="_blank" rel="noopener">Config Template</a>
      <a class="btn btn-gray btn-sm" href="./centralization/atlas-central-rollout-checklist.md" target="_blank" rel="noopener">Rollout Checklist</a>
    </div>
    <div style="font-size:0.62rem;color:var(--muted);margin-top:8px">Legacy JSON and browser bundles remain available only for controlled backup, export, or migration. They should not be treated as the collaboration system of record.</div>
  </div>`;
}

function renderAtlasRegionManagementPanel() {
  const rows = buildAtlasRegionManagementRows();
  const selected = getSelectedAtlasRegionManagementRow();
  const candidates = getAtlasRegionalManagerCandidates();
  const communityOptions = getAllCommunityNames()
    .sort((a, b) => {
      const aActive = isAtlasCommunityActiveByName(a);
      const bActive = isAtlasCommunityActiveByName(b);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return a.localeCompare(b);
    })
    .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}${isAtlasCommunityActiveByName(name) ? "" : " - inactive"}</option>`)
    .join("");
  const managerOptions = [`<option value="">No assigned Regional Manager</option>`, ...candidates.map(person => `<option value="${escapeHtml(person.id)}" ${person.id === selected.regionalManagerId || (person.email && person.email === selected.regionalManagerEmail) ? "selected" : ""}>${escapeHtml(person.name)}${person.email ? ` - ${escapeHtml(person.email)}` : ""}</option>`)].join("");
  const rowHtml = rows.map(row => `<div class="community-command-region-row">
    <strong>${escapeHtml(row.name)}</strong>
    <span class="community-command-status ${row.active ? "good" : "muted"}">${row.active ? "Active" : "Inactive"}</span>
    <span>${escapeHtml(row.regionalManagerName || "Regional Manager pending")}<br><span style="color:var(--muted);font-size:0.6rem">${escapeHtml(row.regionalManagerEmail || `${row.communities.length} communities`)}</span></span>
    <button type="button" class="btn btn-gray btn-sm" onclick='setAtlasRegionManagementSelectedRegion(${JSON.stringify(row.id)})'>Edit</button>
  </div>`).join("");
  return `<div class="card mb4">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div class="card-title" style="margin-bottom:6px">Region Management</div>
        <div style="font-size:0.68rem;color:var(--muted);line-height:1.55">Manage the shared Region relationship that feeds People, Community Settings, Community Command, reporting filters, and scoped dashboard views.</div>
      </div>
      <button class="btn btn-gray btn-sm" onclick="addAtlasManagedRegion()">+ Add Region</button>
    </div>
    <div class="community-command-region-grid">
      <div>
        ${rowHtml || `<div class="community-command-empty">No regions are configured yet.</div>`}
      </div>
      <div class="community-command-section" style="box-shadow:none">
        <div class="windowshade-head">
          <div>
            <h2 style="font-size:0.82rem;font-weight:800">Selected Region</h2>
            <p style="font-size:0.66rem;color:var(--muted);margin-top:2px">${escapeHtml(selected.communities.join(", ") || "No communities assigned yet.")}</p>
          </div>
          <span class="community-command-pill strong">${selected.communities.length} communities</span>
        </div>
        <div class="windowshade-body">
          <div class="community-command-field-grid">
            <label>Region Name<input id="atlas-region-name" value="${escapeHtml(selected.name || "")}" placeholder="Region name"></label>
            <label>Status<select id="atlas-region-status"><option value="active" ${selected.active ? "selected" : ""}>Active</option><option value="inactive" ${!selected.active ? "selected" : ""}>Inactive</option></select></label>
            <label>Regional Manager<select id="atlas-region-manager">${managerOptions}</select></label>
            <label>Move Community<select id="atlas-region-community">${communityOptions}</select></label>
          </div>
          <div class="community-command-actions" style="justify-content:flex-start;margin-top:10px">
            <button type="button" class="btn btn-blue btn-sm" onclick='saveAtlasRegionManagementSelection(${JSON.stringify(selected.id)})'>Save Region</button>
            <button type="button" class="btn btn-gray btn-sm" onclick='assignAtlasCommunityToManagedRegion(${JSON.stringify(selected.id)})'>Assign Selected Community</button>
          </div>
          <div class="community-command-note" style="margin-top:10px">Saving a region writes the same region and Regional Manager details into each assigned community record so Community Settings and People-based scopes stay aligned.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderAtlasSettingsSetupPanel() {
  const details = buildPortfolioDetailsForMonth(getSelectedDashboardMonthIndex());
  const activeCount = details.filter(detail => isCommunityStatusActive(detail.record)).length;
  const addressCount = details.filter(detail => String(detail.record?.address || "").trim()).length;
  const floorPlanCount = details.reduce((sum, detail) => sum + (Array.isArray(detail.record?.communityFloorPlans) ? detail.record.communityFloorPlans.length : 0), 0);
  const investorCount = details.filter(detail => normalizeInvestorEmailContacts(detail.record?.investorEmailContacts).length > 0).length;
  return `<div class="card mb4">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div class="card-title" style="margin-bottom:6px">Community Settings Governance</div>
        <div style="font-size:0.68rem;color:var(--muted);line-height:1.55">Use Community Settings to manage live property setup, but treat this settings space as the admin control point for what must stay configured across the platform.</div>
      </div>
      <button class="btn btn-gray btn-sm" onclick="setTab(1)">Open Community Settings</button>
    </div>
    <div class="grid-4">
      ${statBox("Active Communities", activeCount, `${details.length} communities in current portfolio scope`, "#4493f8")}
      ${statBox("Addresses Saved", addressCount, "Properties with map-ready community addresses", "#3fb950")}
      ${statBox("Floor Plans", floorPlanCount, "Saved floor-plan rows powering budget and comp views", "#d29922")}
      ${statBox("Report Contacts", investorCount, "Communities with saved recipient memory", "#a371f7")}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-gray btn-sm" onclick="setTab(1)">Open Community Settings</button>
      <button class="btn btn-gray btn-sm" onclick="setTab(7)">Open Data Import</button>
      <button class="btn btn-gray btn-sm" onclick="setTab(8)">Open Reporting</button>
    </div>
  </div>`;
}

function renderAtlasSettingsIntegrationsPanel() {
  const centralStatus = getAtlasCentralStatus();
  const syncStatus = getDashboardSharedSyncStatusLine();
  const liveUsers = uniqueAtlasLiveUsers(atlasLivePresenceState.users || []);
  const embeddedApps = ["People", "Maintenance", "Marketing", "Budget Builder"];
  return `<div class="card mb4">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div class="card-title" style="margin-bottom:6px">Integrations</div>
        <div style="font-size:0.68rem;color:var(--muted);line-height:1.55">Monitor the live connection points that control how ATLAS behaves across shared cloud sync, central Supabase state, and the embedded RISE operating surfaces.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-gray btn-sm" onclick="verifyDashboardSharedSyncConnection()">Check Cloud Sync</button>
        <button class="btn btn-gray btn-sm" onclick="verifyAtlasCentralConnection()">Check Central</button>
      </div>
    </div>
    <div class="grid-4">
      ${statBox("Central Mode", centralStatus.configured ? (centralStatus.mode || "centralized") : "legacy", centralStatus.signedIn ? `Signed in as ${centralStatus.userEmail || "approved user"}` : "Not signed into central yet", centralStatus.signedIn ? "#3fb950" : "#d29922")}
      ${statBox("Cloud Sync", dashboardSharedSyncMeta.lastError ? "Issue" : "Healthy", syncStatus, dashboardSharedSyncMeta.lastError ? "#f85149" : "#4493f8")}
      ${statBox("Live Users", liveUsers.length || 0, liveUsers.length ? liveUsers.map(user => atlasUserDisplayName(user)).join(", ") : "No active live-user sessions recorded", "#a371f7")}
      ${statBox("Embedded Apps", embeddedApps.length, embeddedApps.join(" · "), "#58a6ff")}
    </div>
  </div>`;
}

function renderAtlasSettingsMemoryPanel() {
  const dailyBackups = loadDailyBackupIndex();
  const lastBundleActivity = [
    atlasCentralRuntimeMeta.lastSnapshotUploadedAt ? `Central snapshot ${new Date(atlasCentralRuntimeMeta.lastSnapshotUploadedAt).toLocaleString()}` : "",
    atlasCentralRuntimeMeta.rollbackTestedAt ? `Rollback tested ${new Date(atlasCentralRuntimeMeta.rollbackTestedAt).toLocaleString()}` : "",
    dashboardSharedSyncMeta.lastAppliedAt ? `Cloud applied ${new Date(dashboardSharedSyncMeta.lastAppliedAt).toLocaleString()}` : ""
  ].filter(Boolean).join(" · ") || "No recent recovery activity recorded in this browser.";
  return `<div class="card mb4">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div class="card-title" style="margin-bottom:6px">Memory + Recovery</div>
        <div style="font-size:0.68rem;color:var(--muted);line-height:1.55">Manage browser-state memory, rollback exports, and backup coverage from one place before changing central behavior.</div>
      </div>
      <button class="btn btn-gray btn-sm" onclick="setTab(7)">Open Import / Restore Tools</button>
    </div>
    <div class="grid-4">
      ${statBox("Daily Backups", dailyBackups.length, dailyBackups.length ? `Newest ${dailyBackups[0]}` : "No browser daily backups found yet", "#4493f8")}
      ${statBox("Central Safety Gate", atlasCentralAutosaveGateSatisfied() ? "Ready" : "Pending", atlasCentralAutosaveGateSatisfied() ? "Snapshot, reconciliation, and rollback are complete" : "Finish the snapshot, reconciliation, and rollback checks", atlasCentralAutosaveGateSatisfied() ? "#3fb950" : "#d29922")}
      ${statBox("Legacy Bundle", atlasCentralLegacyBundleDisabled() ? "Disabled" : "Available", atlasCentralLegacyBundleDisabled() ? "Legacy shared bundle disabled after safety gate" : "Legacy bundle still available for controlled recovery", atlasCentralLegacyBundleDisabled() ? "#3fb950" : "#d29922")}
      ${statBox("Recovery Activity", dailyBackups.length + (atlasCentralRuntimeMeta.lastSnapshotUploadedAt ? 1 : 0), lastBundleActivity, "#a371f7")}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-gray btn-sm" onclick="downloadAtlasSettingsMemoryBundle()">Export Browser Memory Bundle</button>
      <button class="btn btn-gray btn-sm" onclick="downloadAtlasCentralMigrationSnapshot()">Export Central Snapshot</button>
      <button class="btn btn-gray btn-sm" onclick="testAtlasCentralRollbackSnapshot()">Run Rollback Test</button>
    </div>
  </div>`;
}

function renderAtlasDashboardSelectOptions(options = [], value = "") {
  return options.map(option => {
    const tuple = Array.isArray(option) ? option : [option, option];
    return `<option value="${escapeHtml(tuple[0])}" ${String(tuple[0]) === String(value) ? "selected" : ""}>${escapeHtml(tuple[1])}</option>`;
  }).join("");
}

function renderAtlasDashboardSelectField(label = "", value = "", options = [], changeHandler = "") {
  return `<div class="atlas-dashboard-field">
    <label>${escapeHtml(label)}</label>
    <select onchange="${changeHandler}">${renderAtlasDashboardSelectOptions(options, value)}</select>
  </div>`;
}

function renderAtlasDashboardReadonlyField(label = "", value = "") {
  return `<div class="atlas-dashboard-field">
    <label>${escapeHtml(label)}</label>
    <div class="atlas-dashboard-readonly-value">${escapeHtml(value)}</div>
  </div>`;
}

function renderAtlasDashboardWidgetVisualPreview(instance = {}, snapshot = {}, definition = {}) {
  return window.AtlasReskin.visual(instance, snapshot, definition);
}

function renderAtlasDashboardViewControls() {
  const views = getAtlasDashboardSavedViews();
  const active = getAtlasActiveDashboardView();
  const defaultView = getAtlasDefaultDashboardView();
  const templateOptions = Object.entries(ATLAS_DASHBOARD_ROLE_TEMPLATES).map(([key, template]) => [key, template.label]);
  return `<div class="atlas-dashboard-controls">
    <div class="atlas-dashboard-field">
      <label>Current View</label>
      <select onchange="atlasDashboardSelectView(this.value)">
        ${views.map(view => `<option value="${escapeHtml(view.viewKey)}" ${view.viewKey === active.viewKey ? "selected" : ""}>${escapeHtml(view.viewName)}</option>`).join("")}
      </select>
    </div>
    <div class="atlas-dashboard-field">
      <label>Default Landing View</label>
      <select onchange="atlasDashboardSetDefaultView(this.value)">
        ${views.map(view => `<option value="${escapeHtml(view.viewKey)}" ${view.viewKey === defaultView.viewKey ? "selected" : ""}>${escapeHtml(view.viewName)}</option>`).join("")}
      </select>
    </div>
    <div class="atlas-dashboard-field">
      <label>Starting Template</label>
      <select onchange="atlasDashboardApplyRoleTemplate(this.value)">
        ${renderAtlasDashboardSelectOptions(templateOptions, active.roleTemplateKey)}
      </select>
    </div>
  </div>`;
}

function renderAtlasDashboardActiveWidgetCard(instance = {}) {
  return window.AtlasReskin.card(instance, true);
}

function renderAtlasDashboardActiveLayout() {
  const view = getAtlasActiveDashboardView();
  const widgets = getAtlasDashboardViewWidgets(view);
  if (!widgets.length) {
    return `<div class="atlas-dashboard-empty">No widgets are saved in this view.</div>`;
  }
  return `<div class="atlas-dashboard-layout-grid">${widgets.map(renderAtlasDashboardActiveWidgetCard).join("")}</div>`;
}

function renderAtlasDashboardWidgetLibrary() {
  return window.AtlasReskin.library();
}

function renderAtlasDashboardWidgetConfigPanel(instance = {}) {
  const definition = getAtlasDashboardWidgetDefinition(instance.widgetKey) || {};
  const scope = normalizeAtlasDashboardScopeConfig(instance.scope);
  const propertyOptions = getAtlasDashboardAuthorizedCommunityOptions();
  const propertyNameOptions = propertyOptions.map(item => [item.name, item.name]);
  const regionOptions = atlasDashboardDistinctOptionValues("region").map(item => [item, item]);
  const regionalManagerOptions = atlasDashboardDistinctOptionValues("regionalManager").map(item => [item, item]);
  const ownershipOptions = atlasDashboardDistinctOptionValues("ownershipGroup").map(item => [item, item]);
  const assetTypeOptions = Array.from(new Set([...ATLAS_DASHBOARD_ASSET_TYPE_OPTIONS, ...atlasDashboardDistinctOptionValues("assetType")])).filter(Boolean).map(item => [item, item]);
  const propertyChecks = propertyOptions.map(item => {
    const checked = scope.propertyNames.includes(item.name);
    return `<label><input type="checkbox" ${checked ? "checked" : ""} onchange="atlasDashboardToggleScopeProperty(${atlasDashboardJsArg(instance.instanceId)},${atlasDashboardJsArg(item.name)})"> ${escapeHtml(item.name)}</label>`;
  }).join("");
  const threshold = normalizeAtlasDashboardThreshold(instance.threshold);
  return `<div class="atlas-dashboard-config-card">
    <div class="atlas-dashboard-section-label" style="margin-bottom:10px">Widget Configuration</div>
    <div class="atlas-dashboard-config-grid">
      ${renderAtlasDashboardReadonlyField("Data Source", definition.dataSource || "ATLAS")}
      ${renderAtlasDashboardSelectField("Metric", instance.metric, definition.metrics || [], `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"metric",this.value)`)}
      ${renderAtlasDashboardSelectField("Property Scope", scope.type, ATLAS_DASHBOARD_SCOPE_OPTIONS, `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"scope.type",this.value)`)}
      ${scope.type === "single_property" ? renderAtlasDashboardSelectField("Property", scope.propertyName, propertyNameOptions, `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"scope.propertyName",this.value)`) : ""}
      ${scope.type === "region" ? renderAtlasDashboardSelectField("Region", scope.region, regionOptions, `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"scope.region",this.value)`) : ""}
      ${scope.type === "regional_manager" ? renderAtlasDashboardSelectField("Regional Manager", scope.regionalManager, regionalManagerOptions, `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"scope.regionalManager",this.value)`) : ""}
      ${scope.type === "ownership_group" ? renderAtlasDashboardSelectField("Ownership Group", scope.ownershipGroup, ownershipOptions, `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"scope.ownershipGroup",this.value)`) : ""}
      ${scope.type === "asset_type" ? renderAtlasDashboardSelectField("Asset Type", scope.assetType, assetTypeOptions, `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"scope.assetType",this.value)`) : ""}
      ${renderAtlasDashboardSelectField("Timeframe", instance.timeframe, ATLAS_DASHBOARD_TIMEFRAME_OPTIONS, `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"timeframe",this.value)`)}
      ${renderAtlasDashboardSelectField("Comparison", instance.comparison, ATLAS_DASHBOARD_COMPARISON_OPTIONS, `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"comparison",this.value)`)}
      ${renderAtlasDashboardSelectField("Visualization", instance.visualization, atlasDashboardVisualizationOptions(definition), `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"visualization",this.value)`)}
      ${renderAtlasDashboardSelectField("Drill-Down", instance.drillDown?.mode || "module", [["module", "Open Source Module"], ["records", "Underlying Records"], ["report", "Reporting View"]], `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"drillDown.mode",this.value)`)}
      ${renderAtlasDashboardSelectField("Alert", instance.alert?.enabled ? "on" : "off", [["off", "Dashboard Only"], ["on", "Alert Enabled"]], `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"alert.enabled",this.value==="on")`)}
      ${renderAtlasDashboardSelectField("Threshold Operator", threshold.operator, [["compare_under", "Under Comparison"], ["compare_over", "Over Comparison"], ["<", "Under Value"], ["<=", "At or Under Value"], [">", "Over Value"], [">=", "At or Over Value"], ["=", "Equals Value"], ["between", "Between Values"]], `atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},"threshold.operator",this.value)`)}
      <div class="atlas-dashboard-field">
        <label>Threshold</label>
        <input type="text" value="${escapeHtml(threshold.value)}" onchange="atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},'threshold.value',this.value)" placeholder="Value">
      </div>
      <div class="atlas-dashboard-field">
        <label>Duration</label>
        <input type="text" value="${escapeHtml(threshold.duration)}" onchange="atlasDashboardUpdateWidgetConfig(${atlasDashboardJsArg(instance.instanceId)},'threshold.duration',this.value)" placeholder="Optional">
      </div>
    </div>
    ${(scope.type === "multiple_properties" || scope.type === "custom_group") ? `<div style="margin-top:10px">
      <div class="atlas-dashboard-section-label" style="margin-bottom:8px">Properties</div>
      <div class="atlas-dashboard-property-checks">${propertyChecks || `<div class="atlas-dashboard-widget-sub">No authorized properties are available.</div>`}</div>
    </div>` : ""}
  </div>`;
}

function renderAtlasSettingsDashboardPanel() {
  const previous = atlasHomeRenderDetails;
  atlasHomeRenderDetails = new Map();
  try { return window.AtlasReskin.builder(); }
  finally { atlasHomeRenderDetails = previous; }
}

function renderAtlasSettingsTab() {
  const status = getAtlasCentralStatus();
  const profile = getAtlasAccessProfile();
  const canManage = atlasProfileCanManageSettings(profile);
  const cardsHtml = `<div class="grid-4">
    ${statBox("Access Control", canManage ? "Admin Ready" : (status.signedIn ? "Viewer" : "Sign In"), canManage ? "Manage roles, scope, and page access here." : "Settings opens for connection and profile review first.", canManage ? "#3fb950" : "#d29922")}
    ${statBox("Central Platform", status.configured ? (status.signedIn ? "Connected" : "Configured") : "Not Configured", status.message || "Use this page to configure or verify central Atlas.", status.signedIn ? "#4493f8" : "#d29922")}
    ${statBox("Community Settings", getPortfolioSetupCommunityRecordsForMonth(getSelectedDashboardMonthIndex(), savedData, { includeInactive: true }).length, "Community settings, imports, and outputs route through this admin page.", "#a371f7")}
    ${statBox("Memory", loadDailyBackupIndex().length, "Daily backups plus export and rollback controls live here.", "#58a6ff")}
  </div>`;
  const bodyHtml = `<div>
    ${renderAtlasSettingsDashboardPanel()}
    <details class="atlas-settings-administration"><summary>Account, access &amp; platform settings</summary>
    ${cardsHtml}
    <div class="card mb4" style="margin-top:12px">
      <div class="card-title" style="margin-bottom:6px">ATLAS Settings</div>
      <div style="font-size:0.72rem;color:var(--muted);line-height:1.6">This page keeps profile setup, dashboard personalization, community-governance controls, integrations, memory, and Central Platform Control in one place. Admin-only tools remain hidden unless the signed-in role can manage them.</div>
    </div>
    <div id="atlas-settings-access-panel">${renderAtlasEmployeeAccessPanel()}</div>
    ${renderAtlasSettingsSetupPanel()}
    ${renderAtlasRegionManagementPanel()}
    ${renderAtlasSettingsIntegrationsPanel()}
    ${renderAtlasSettingsMemoryPanel()}
    ${renderAtlasCentralPlatformPanel()}
    </details>
  </div>`;
  return renderPortfolioScopePanel("ATLAS Settings", "Profile, dashboard personalization, access, integrations, memory, and central platform behavior.", "", bodyHtml);
}
window.AtlasAdminWorkspace = true;

window.renderAtlasEmployeeAccessPanel = renderAtlasEmployeeAccessPanel;
