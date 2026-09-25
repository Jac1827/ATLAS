// Shared save guards; evaluated before the main script, called after its state initializes.
async function awaitAtlasPersistenceResults(saves) {
  const settled = await Promise.allSettled(saves.map(save => save.result?.completion));
  const failures = settled.flatMap((completion, index) => {
    const { result, label } = saves[index];
    if (completion.status === "fulfilled" && result?.ok === true && result.pending !== true) return [];
    const reason = completion.status === "rejected" ? completion.reason : null;
    const message = result?.message || reason?.message || String(reason || "The save did not complete. Keep this tab open and retry.");
    return [`${label}: ${message}`];
  });
  if (failures.length) throw new Error(failures.join(" "));
}

function updateMarketSurveyImportInputs() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("#market-survey-input").forEach(input => {
    input.disabled = Boolean(marketSurveyImportOperation?.isCurrent());
  });
}

function assertAtlasSaveContext(isCurrent) {
  if (isCurrent && !isCurrent()) throw new DOMException("Workspace changed before data could be saved.", "AbortError");
}

function invalidateAtlasSaveContext() {
  atlasSaveAuthRevision += 1;
}

function getAtlasSaveContextKey() {
  const status = getAtlasCentralStatus();
  const profile = getAtlasAccessProfile();
  const actor = window.ATLAS_CENTRAL?.getSession?.()?.user?.id || "";
  if (shouldBlockAtlasSensitiveAccess() || !atlasAccessDecision(activeTab).ok) return "";
  if (status.configured && (!status.signedIn || !actor || !profile || profile.status !== "active")) return "";
  const config = getAtlasCentralConfig();
  const period = getSelectedDashboardPeriodKey();
  return JSON.stringify({
    authRevision: atlasSaveAuthRevision, navigation: atlasNavigationEpoch,
    configured: Boolean(status.configured), signedIn: Boolean(status.signedIn), actor,
    database: ATLAS_STATE_DB_NAME, service: config.supabaseUrl || config.apiBaseUrl || "", document: config.documentKey || "",
    profile: profile ? {
      user: profile.user_id, employee: profile.employee_id, role: profile.role,
      status: profile.status, accountStatus: profile.account_status,
      communities: profile.allowed_community_ids || profile.allowedCommunityIds,
      markets: profile.allowed_market_values || profile.allowedMarketValues,
      regions: profile.allowed_region_values || profile.allowedRegionValues,
      locations: atlasProfileCommunityRestrictionValues(profile).allowedLocationGroups,
      lockedTabs: profile.locked_tab_ids, lockedPages: profile.locked_page_keys,
      permissions: profile.bonus_permissions || profile.bonusPermissions,
      communityAccess: profile.community_access_records
    } : null,
    tab: activeTab, scope: workspaceScopeValue, community: getProp()?.name, period,
    portfolioScope: portfolioMonthScopeByPeriod[period] || null
  });
}

function observeAtlasSaveContext() {
  const key = getAtlasSaveContextKey();
  if (observeAtlasSaveContext.key !== key) {
    observeAtlasSaveContext.key = key;
    observeAtlasSaveContext.revision = (observeAtlasSaveContext.revision || 0) + 1;
  }
  return observeAtlasSaveContext.revision;
}

function captureAtlasSaveContext() {
  const revision = observeAtlasSaveContext();
  let current = Boolean(observeAtlasSaveContext.key);
  return () => current && (current = revision === observeAtlasSaveContext());
}
