/* ==========================================================================
   ATLAS — embedded RISE platform mounts
   --------------------------------------------------------------------------
   Ported from "ATLAS Redesign v2.dc.html". Each of the four RISE tools is
   rendered INLINE inside its own ATLAS tab — selecting the tab lands you on
   the platform's own dashboard. Nothing opens in a second browser tab and
   there is no click-to-open gate.

   Each tool still runs as its own self-contained application inside the iframe.
   During centralization, these mounts are transitional surfaces until the
   hosted data layer replaces local/browser storage as the shared source.
   ========================================================================== */
(function () {
  "use strict";

  var lastPublishedPeopleRosterKey = "";
  var mountedFrames = new Map();
  var mountTabs = { maintenance: 10, marketing: 11, budget: 12, people: 13 };

  function mountContextKey(tab) {
    var central = window.ATLAS_CENTRAL;
    var profile = typeof getAtlasAccessProfile === "function" ? getAtlasAccessProfile() || {} : {};
    var config = central && central.getConfig ? central.getConfig() || {} : {};
    var access = typeof atlasAccessDecision === "function" ? atlasAccessDecision(tab).ok : true;
    var record = typeof getCurrentCommunityRecord === "function" ? getCurrentCommunityRecord() : {};
    return JSON.stringify({
      actor: central && central.getSession ? central.getSession()?.user?.id || "" : "", access: access,
      database: config.supabaseUrl || config.apiBaseUrl || "", employee: profile.employee_id,
      role: profile.role, status: profile.status, accountStatus: profile.account_status,
      communities: profile.allowed_community_ids, regions: profile.allowed_region_values, markets: profile.allowed_market_values,
      lockedTabs: profile.locked_tab_ids, lockedPages: profile.locked_page_keys, bonusPermissions: profile.bonus_permissions || profile.bonusPermissions,
      workspace: typeof workspaceScopeValue === "undefined" ? "" : workspaceScopeValue,
      community: typeof getProp === "function" ? getProp()?.name : "",
      month: typeof getSelectedDashboardMonthIndex === "function" ? getSelectedDashboardMonthIndex() : null,
      year: Number(record && record.reportYear) || new Date().getFullYear()
    });
  }

  function stopFrameTasks(iframe, state) {
    if (iframe.__atlasSyncTimer) window.clearInterval(iframe.__atlasSyncTimer);
    iframe.__atlasSyncTimer = null;
    state.delays.forEach(function (id) { window.clearTimeout(id); });
    state.delays = [];
    state.active = false;
  }

  function frameVisible(iframe) {
    var panel = iframe.closest && iframe.closest(".tab-panel");
    return iframe.isConnected && document.visibilityState !== "hidden" && !iframe.hidden &&
      (!panel || (!panel.hidden && panel.style.display !== "none"));
  }

  function reconcileMounts() {
    mountedFrames.forEach(function (state, iframe) {
      if (!iframe.isConnected) { stopFrameTasks(iframe, state); mountedFrames.delete(iframe); return; }
      if (state.context !== mountContextKey(mountTabs[state.key])) {
        stopFrameTasks(iframe, state); mountedFrames.delete(iframe);
        var panel = iframe.closest && iframe.closest(".tab-panel");
        if (panel) { delete panel.dataset.atlasStableMountMounted; delete panel.dataset.atlasPeopleMounted; }
        iframe.remove();
        return;
      }
      var active = frameVisible(iframe);
      if (active === state.active) return;
      if (!active) { stopFrameTasks(iframe, state); return; }
      state.active = true;
      syncMountFrame(iframe, state.key);
      iframe.__atlasSyncTimer = window.setInterval(function () {
        if (!frameVisible(iframe) || state.context !== mountContextKey(mountTabs[state.key])) { reconcileMounts(); return; }
        syncMountFrame(iframe, state.key);
      }, 2000);
    });
  }
  window.AtlasMounts = Object.freeze({ contextKey: mountContextKey, reconcile: reconcileMounts,
    dispose: function (iframe) { var state = mountedFrames.get(iframe); if (state) stopFrameTasks(iframe, state); mountedFrames.delete(iframe); }
  });
  document.addEventListener("visibilitychange", reconcileMounts);
  window.addEventListener("atlas-central-auth-change", reconcileMounts);
  window.addEventListener("pagehide", function () { mountedFrames.forEach(function (state, iframe) { stopFrameTasks(iframe, state); }); });
  window.addEventListener("pageshow", reconcileMounts);
  if (typeof MutationObserver !== "undefined") {
    var mountObserver = new MutationObserver(reconcileMounts);
    var observeMounts = function () { if (document.body) mountObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden"] }); };
    if (document.body) observeMounts(); else document.addEventListener("DOMContentLoaded", observeMounts, { once: true });
  }

  var MOUNTS = {
    maintenance: {
      screen: "Maintenance",
      lede: "Work-order performance across the portfolio. The weekly intake, reconciliation and one-page export run in the report generator itself — upload the three Entrata exports here and the figures roll up to the portfolio view.",
      title: "Weekly Maintenance Report",
      note: "The weekly intake, reconciliation and one-page export run in the report generator itself — upload the three Entrata exports here and the figures above are what they roll up to.",
      barTitle: "RISE Weekly Maintenance Report",
      barSub: "Legacy standalone mode — central Maintenance data migration required",
      src: "RISE-Weekly-Maintenance-Report.html",
      background: "#F4F7F9",
      icon: "ph-wrench"
    },
    marketing: {
      screen: "Marketing",
      lede: "Creative intake, approvals and routing for every community, with lead-source performance rolled up to the portfolio.",
      title: "Marketing Command Center",
      note: "Intake, the AI creative brief, approvals, routing and team metrics run in the Command Center itself — this is the portfolio read of it.",
      barTitle: "RISE Marketing Command Center",
      barSub: "Shares team, routing, and bonus settings with Atlas Bonus & Incentives",
      src: "RISE-Marketing-Command-Center.html?v=20260916-glitch-review",
      background: "#F0F4F6",
      icon: "ph-megaphone"
    },
    budget: {
      screen: "Budget Builder",
      lede: "Property budgets, scenarios, actuals, budget-vs-actual review and financial performance reports on the RISE finance theme. Approved scenarios lock and publish back to ATLAS.",
      title: "Budget Builder",
      note: "Property budget, monthly view, GL detail, actuals, financial review and exception reporting all run in Budget Builder itself — ATLAS reads the published scenario.",
      barTitle: "RISE Budget Builder",
      barSub: "Standalone finance tool — central Budget and actuals migration required",
      src: "RISE-Budget-Builder.html?v=372a88eab8931d00",
      background: "#F1F4F6",
      icon: "ph-calculator"
    },
    people: {
      screen: "People",
      lede: "Roster, reviews, coaching plans and accountability. Reads the same roster keyed by employee ID as Communities, so a reassignment lands here without a second import.",
      title: "Performance Platform",
      note: "Reviews, coaching plans, training and accountability run in the RISE Performance Platform. It reads the same roster keyed by employee ID, so a reassignment in Communities lands here without a second import.",
      barTitle: "RISE Performance Platform",
      barSub: "People source data feeds Atlas migration snapshots and shared assignments",
      src: "RISE-Performance-Platform.html?v=20260918-unified-employee-access",
      background: "#F3F6F8",
      icon: "ph-trophy"
    }
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function appendParams(src, params) {
    var separator = src.indexOf("?") >= 0 ? "&" : "?";
    return src + separator + params;
  }

  function initialViewFor(key) {
    try {
      if (key !== "budget" || !window.ATLAS_PENDING_BUDGET_VIEW) return "";
      var view = String(window.ATLAS_PENDING_BUDGET_VIEW || "").trim();
      window.ATLAS_PENDING_BUDGET_VIEW = "";
      return view;
    } catch (err) {
      return "";
    }
  }

  // Read the same authorized Community Settings record used by the workspace.
  window.atlasCommunityLocationRecord = function(name) {
    var matched = typeof matchPropertyName === 'function' ? matchPropertyName(name, {fallbackToCurrent:false}) : name;
    var record = typeof savedData !== 'undefined' && matched && savedData[matched] ? savedData[matched] : {};
    return {communityAddress:record.communityAddress||'',communityCity:record.communityCity||record.city||'',communityState:record.communityState||record.state||'',communityZip:record.communityZip||record.zip||record.zipCode||''};
  };

  function embeddedWorkspaceContext() {
    try {
      var monthIdx = typeof getSelectedDashboardMonthIndex === "function"
        ? Number(getSelectedDashboardMonthIndex())
        : (typeof currentMonth !== "undefined" ? Number(currentMonth) : new Date().getMonth());
      var details = typeof getWorkspaceScopedDetails === "function"
        ? getWorkspaceScopedDetails(monthIdx)
        : [];
      var names = details.map(function (detail) { return String(detail && detail.name || "").trim(); }).filter(Boolean);
      var record = typeof getCurrentCommunityRecord === "function" ? getCurrentCommunityRecord() : null;
      var year = Number(record && record.reportYear) || new Date().getFullYear();
      var singleName = typeof getProp === "function" ? String((getProp() || {}).name || "").trim() : "";
      return {
        monthIdx: monthIdx,
        month: typeof FULL_MONTHS !== "undefined" ? String(FULL_MONTHS[monthIdx] || "") : "",
        year: year,
        scopeCount: names.length,
        scopeLabel: names.length === 1 ? (names[0] || singleName) : (names.length ? names.length + " ATLAS communities" : singleName),
        propertyNames: names
      };
    } catch (err) {
      return { monthIdx: new Date().getMonth(), month: "", year: new Date().getFullYear(), scopeCount: 0, scopeLabel: "ATLAS workspace", propertyNames: [] };
    }
  }

  function iframeSrc(key, mount) {
    var params = "atlasEmbedded=1&atlasMountKey=" + encodeURIComponent(key) + "&v=20260911-central-services-roster";
    var context = embeddedWorkspaceContext();
    params += "&atlasMonth=" + encodeURIComponent(context.month);
    params += "&atlasYear=" + encodeURIComponent(context.year);
    params += "&atlasScopeCount=" + encodeURIComponent(context.scopeCount);
    params += "&atlasScopeLabel=" + encodeURIComponent(context.scopeLabel);
    var initialView = initialViewFor(key);
    if (initialView) params += "&atlasView=" + encodeURIComponent(initialView);
    return appendParams(mount.src, params);
  }

  function frameDoc(iframe) {
    try {
      return iframe && iframe.contentDocument ? iframe.contentDocument : (iframe && iframe.contentWindow ? iframe.contentWindow.document : null);
    } catch (err) {
      return null;
    }
  }

  function measureFrameHeight(iframe) {
    var doc = frameDoc(iframe);
    if (!doc) return 1180;
    var body = doc.body;
    var root = doc.documentElement;
    var next = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0,
      720
    );
    return Math.min(Math.max(next, 720), 12000);
  }

  function applyFrameHeight(iframe, height) {
    if (!iframe) return;
    iframe.style.height = Math.max(720, Number(height) || 1180) + "px";
  }

  function readEmbeddedPeopleRoster(iframe) {
    try {
      var win = iframe && iframe.contentWindow;
      if (!win) return [];
      var source = typeof win.activeVisibleEmployees === "function"
        ? win.activeVisibleEmployees()
        : (typeof win.sortedVisibleEmployees === "function" ? win.sortedVisibleEmployees() : []);
      var isTerminated = typeof win.isEmployeeTerminated === "function"
        ? win.isEmployeeTerminated
        : function (employee) {
          return String(employee && employee.status || "").trim().toLowerCase().indexOf("terminated") >= 0;
        };
      return (Array.isArray(source) ? source : [])
        .filter(function (employee) { return employee && !isTerminated(employee); })
        .map(function (employee) {
          return {
            employeeId: String(employee.peopleEmployeeId || employee.employeeId || employee.id || "").trim(),
            employeeNumber: String(employee.employeeNumber || "").trim(),
            email: String(employee.email || "").trim().toLowerCase(),
            fullName: String(employee.name || employee.fullName || "").trim(),
            role: String(employee.role || employee.title || "").trim(),
            department: String(employee.department || "").trim(),
            corporateSpecialty: String(employee.corporateSpecialty || employee.corporate_specialty || "").trim(),
            communityName: String(employee.community || employee.communityName || "").trim(),
            region: String(employee.region || "").trim(),
            status: String(employee.status || "").trim(),
            active: true,
            source: "embedded_roster"
          };
        })
        .filter(function (employee) { return employee.employeeId || employee.email || employee.fullName; });
    } catch (err) {
      return [];
    }
  }

  function publishPeopleRoster(roster) {
    if (!Array.isArray(roster) || !roster.length) return;
    var rosterKey = "";
    try {
      rosterKey = JSON.stringify(roster.map(function (employee) {
        return [
          String(employee.employeeId || "").trim(),
          String(employee.email || "").trim().toLowerCase(),
          String(employee.fullName || "").trim(),
          String(employee.role || "").trim(),
          String(employee.department || "").trim(),
          String(employee.corporateSpecialty || "").trim(),
          String(employee.communityName || "").trim(),
          String(employee.region || "").trim(),
          String(employee.status || "").trim()
        ];
      }));
    } catch (err) {
      rosterKey = "";
    }
    if (rosterKey && rosterKey === lastPublishedPeopleRosterKey) return;
    lastPublishedPeopleRosterKey = rosterKey;
    window.ATLAS_EMBEDDED_PEOPLE_ROSTER = roster;
  }

  function syncMountFrame(iframe, key) {
    if (!iframe) return;
    applyFrameHeight(iframe, measureFrameHeight(iframe));
    if (key === "people") publishPeopleRoster(readEmbeddedPeopleRoster(iframe));
  }

  window.handleAtlasMountLoad = function (iframe, key) {
    if (!iframe || !iframe.isConnected) return;
    iframe.dataset.atlasMountKey = key || "";
    window.AtlasMounts.dispose(iframe);
    var state = { key: key, context: iframe.dataset.atlasMountContext || mountContextKey(mountTabs[key]), active: false, delays: [] };
    mountedFrames.set(iframe, state);
    reconcileMounts();
    try {
      var context = embeddedWorkspaceContext();
      iframe.contentWindow.postMessage({ type: "atlas-shell-context", context: context }, window.location.origin);
    } catch (err) {}
    if (state.active) [150, 700, 1600].forEach(function (delay) {
      state.delays.push(window.setTimeout(function () { if (frameVisible(iframe) && state.context === mountContextKey(mountTabs[key])) syncMountFrame(iframe, key); }, delay));
    });
  };

  function isBudgetFrameSource(source) {
    try {
      var frame = document.querySelector('iframe[data-atlas-mount-key="budget"]');
      return !!frame && frame.contentWindow === source;
    } catch (err) {
      return false;
    }
  }

  function publishBudgetToAtlas() {
    // Retired: a browser-cache write cannot approve or publish governed budgets.
    return {ok:false,published:false,status:"blocked",scope:"central_approval_required",publicationId:null,receiptId:null,
      message:"Blocked: browser-cache budget sync is retired. Open Review staged budgets for central approval; only an Admin-approved version with verified receipt reaches shared reports."};
  }

  function publishBudgetContractToAtlas(payload) {
    if (!payload || !payload.contract) {
      return { ok: false, message: "ATLAS could not read the contract intake packet." };
    }
    try {
      var rawPropertyName = String(
        payload.propertyName ||
        payload.contract.propertyName ||
        payload.contract.propertyId ||
        ""
      ).trim();
      var matchedName = typeof matchPropertyName === "function"
        ? matchPropertyName(rawPropertyName, { fallbackToCurrent: false })
        : rawPropertyName;
      if (!matchedName && typeof matchPropertyName === "function") {
        matchedName = matchPropertyName(rawPropertyName.replace(/^RISE\s+/i, ""), { fallbackToCurrent: false });
      }
      if (!matchedName || !savedData || !savedData[matchedName]) {
        return { ok: false, message: "ATLAS could not match this contract to an active community." };
      }

      var timestamp = new Date().toISOString();
      var record = typeof normalizeSavedCommunityRecord === "function"
        ? normalizeSavedCommunityRecord(matchedName, savedData[matchedName])
        : savedData[matchedName];
      if (String(record && record.communityStatus || "active").toLowerCase() !== "active") {
        return { ok: false, message: "This contract was not linked because the matched property is not active in ATLAS." };
      }
      var contractId = String(payload.contract.id || ("contract-" + Date.now())).trim();
      var packet = Object.assign({}, payload, {
        sourceKind: "rise_budget_builder_contract",
        importedAt: timestamp,
        propertyName: matchedName
      });
      var existingDocs = Array.isArray(record.financialContractDocuments)
        ? record.financialContractDocuments.slice()
        : [];
      var docIndex = existingDocs.findIndex(function (item) {
        return String(item && item.contract && item.contract.id || "") === contractId;
      });
      if (docIndex >= 0) existingDocs[docIndex] = packet;
      else existingDocs.unshift(packet);

      record.financialContractDocuments = existingDocs;
      record.financialContractUpdatedAt = timestamp;
      record.importTracking = Object.assign({}, record.importTracking || {}, {
        financialContracts: Object.assign({}, record.importTracking && record.importTracking.financialContracts || {}, {
          [contractId]: {
            importedAt: timestamp,
            sourceFileName: String(payload.document && payload.document.name || payload.contract.sourceFile || "Contract document").trim(),
            property: matchedName
          }
        })
      });
      savedData[matchedName] = typeof normalizeSavedCommunityRecord === "function"
        ? normalizeSavedCommunityRecord(matchedName, record)
        : record;

      if (typeof syncSharedPropertyFromPortfolioRecord === "function") {
        syncSharedPropertyFromPortfolioRecord(matchedName, savedData[matchedName], { timestamp: timestamp });
      }
      if (typeof persistSaved === "function") persistSaved();
      return { ok: true, message: "Contract retained and linked to " + matchedName + "." };
    } catch (err) {
      return { ok: false, message: "ATLAS could not save this contract: " + String(err && err.message || err) };
    }
  }

  window.navigateAtlasBudgetMount = function (view) {
    var iframe = document.querySelector('iframe[data-atlas-mount-key="budget"]');
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "atlas-budget-navigate", view: String(view || "dashboard") }, "*");
  };

  window.addEventListener("message", async function (event) {
    var data = event && event.data;
    if (!data) return;
    if (data.type === "atlas-budget-return-home" && isBudgetFrameSource(event.source)) {
      if (typeof setTab === "function") setTab(0);
      return;
    }
    if (data.type === "atlas-budget-catalog-request" && isBudgetFrameSource(event.source)) {
      const names = typeof getAtlasDashboardAuthorizedCommunityOptions === "function" ? getAtlasDashboardAuthorizedCommunityOptions().map(row => row.name) : [];
      const communities = names.map(name => ({ name, totalUnits: typeof getResolvedTotalUnitsForRecord === "function" ? getResolvedTotalUnitsForRecord(name, typeof savedData !== "undefined" ? savedData[name] || {} : {}) || null : null }));
      event.source.postMessage({ type: "atlas-budget-catalog", names: names, communities: communities }, window.location.origin);
      return;
    }
    if (data.type === "atlas-budget-publish" && isBudgetFrameSource(event.source)) {
      var result = publishBudgetToAtlas(data.payload);
      if(result.completion) await result.completion;
      try { event.source.postMessage({ type: "atlas-budget-publish-result", requestId:data.requestId, result: {ok:result.ok,published:result.published,status:result.status,scope:result.scope,publicationId:result.publicationId,receiptId:result.receiptId,message:result.message} }, window.location.origin); } catch (err) {}
      return;
    }
    if (data.type === "atlas-budget-contract-import" && isBudgetFrameSource(event.source)) {
      var contractResult = publishBudgetContractToAtlas(data.payload);
      try { event.source.postMessage({ type: "atlas-budget-contract-import-result", result: contractResult }, "*"); } catch (err) {}
      return;
    }
    if (data.type !== "atlas-embedded-height") return;
    var iframe = document.querySelector('iframe[data-atlas-mount-key="' + String(data.key || "") + '"]');
    if (!iframe || iframe.contentWindow !== event.source || !frameVisible(iframe)) return;
    applyFrameHeight(iframe, data.height);
    if (data.key === "people" && Array.isArray(data.activeEmployees)) publishPeopleRoster(data.activeEmployees);
  });

  /* Best-effort context line. Falls back silently so a change in the host
     dashboard's globals can never break the mount from rendering. */
  function contextMeta() {
    try {
      var scope = typeof getWorkspaceScopeLabel === "function"
        ? getWorkspaceScopeLabel()
        : (typeof isPortfolioWorkspaceSelected === "function" && isPortfolioWorkspaceSelected()
          ? "All communities"
          : (typeof getProp === "function" ? (getProp() || {}).name : ""));
      var monthNames = typeof FULL_MONTHS !== "undefined" ? FULL_MONTHS : null;
      var monthIdx = typeof currentMonth !== "undefined" ? Number(currentMonth) : null;
      var period = monthNames && monthIdx != null && monthNames[monthIdx]
        ? monthNames[monthIdx] + " " + new Date().getFullYear()
        : "";
      return [scope, period].filter(Boolean).join(" · ");
    } catch (err) {
      return "";
    }
  }

  function renderMount(key) {
    var m = MOUNTS[key];
    if (!m) return "";
    var meta = contextMeta();
    var embeddedSrc = iframeSrc(key, m);
    var contextKey = esc(mountContextKey(mountTabs[key]));
    if (key === "budget") {
      return [
        '<section class="atlas-budget-workspace" id="atlas-mount-budget">',
        '  <div class="atlas-budget-workspace-bar">',
        '    <div><span class="atlas-budget-eyebrow">Finance workspace</span><h1>Budget Builder</h1></div>',
        '    <div class="atlas-budget-workspace-actions">',
        '      <button type="button" onclick="window.navigateAtlasBudgetMount(\'dashboard\')">Dashboard</button>',
        '      <button type="button" onclick="window.navigateAtlasBudgetMount(\'actuals\')">Actuals</button>',
        '      <button type="button" onclick="window.navigateAtlasBudgetMount(\'financialreview\')">Financial review</button>',
        '      <button type="button" onclick="window.navigateAtlasBudgetMount(\'exports\')">Reports</button>',
        '      <button type="button" onclick="document.querySelector(\'iframe[data-atlas-mount-key=budget]\')?.contentWindow.AtlasBudgetCommand?.review()">Approve Shared Original Budget</button>',
        '    </div>',
        '  </div>',
        '  <p class="atlas-budget-workspace-note">Admin approval publishes the shared original budget. Closing a completed accounting month automatically refreshes financial reporting. The workspace stays open while you move through ATLAS.</p>',
        '  <div class="atlas-mount-frame atlas-budget-frame">',
        '    <iframe src="' + esc(embeddedSrc) + '" title="' + esc(m.barTitle) + '" data-atlas-mount-key="budget" data-atlas-mount-context="' + contextKey + '" onload="window.handleAtlasMountLoad && window.handleAtlasMountLoad(this, \'budget\')" loading="lazy" style="background:' + esc(m.background) + '"></iframe>',
        '  </div>',
        '</section>'
      ].join("\n");
    }
    return [
      '<div class="atlas-screen-head">',
      "  <div>",
      "    <h1>" + esc(m.screen) + "</h1>",
      "    <p>" + esc(m.lede) + "</p>",
      "  </div>",
      "</div>",
      '<section class="atlas-mount-section" id="atlas-mount-' + esc(key) + '">',
      '  <div class="atlas-mount-head">',
      "    <h3>" + esc(m.title) + "</h3>",
      "  </div>",
      '  <div class="atlas-mount-note">' + esc(m.note) + "</div>",
      '  <div class="atlas-mount-frame">',
      '    <div class="atlas-mount-bar">',
      '      <i class="ph ' + esc(m.icon) + '" aria-hidden="true"></i>',
      '      <span class="atlas-mount-bar-title">' + esc(m.barTitle) + "</span>",
      '      <span class="atlas-mount-bar-sub">' + esc(m.barSub) + "</span>",
      meta ? '      <span class="atlas-mount-bar-meta">' + esc(meta) + "</span>" : "",
      "    </div>",
      '    <iframe src="' + esc(embeddedSrc) + '" title="' + esc(m.barTitle) + '" data-atlas-mount-key="' + esc(key) + '" data-atlas-mount-context="' + contextKey + '" onload="window.handleAtlasMountLoad && window.handleAtlasMountLoad(this, \'' + esc(key) + '\')"',
      '            loading="lazy" style="background:' + esc(m.background) + '"></iframe>',
      "  </div>",
      "</section>"
    ].filter(Boolean).join("\n");
  }

  window.renderMaintenanceTab = function () { return renderMount("maintenance"); };
  window.renderMarketingTab = function () { return renderMount("marketing"); };
  window.renderBudgetBuilderTab = function () { return renderMount("budget"); };
  window.renderPeopleTab = function () { return renderMount("people"); };
  window.ATLAS_MOUNTS = MOUNTS;
})();
