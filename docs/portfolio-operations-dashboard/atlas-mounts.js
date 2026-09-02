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
      src: "RISE-Marketing-Command-Center.html",
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
      src: "RISE-Budget-Builder.html",
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
      src: "RISE-Performance-Platform.html",
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

  function iframeSrc(key, mount) {
    var params = "atlasEmbedded=1&atlasMountKey=" + encodeURIComponent(key) + "&v=20260902-marketing-studio";
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
    // Budget Builder is a navigable application, not a long report. Keep its
    // own scroll region contained so the surrounding ATLAS workspace stays usable.
    if (key !== "budget") applyFrameHeight(iframe, measureFrameHeight(iframe));
    if (key === "people") publishPeopleRoster(readEmbeddedPeopleRoster(iframe));
  }

  window.handleAtlasMountLoad = function (iframe, key) {
    if (!iframe) return;
    iframe.dataset.atlasMountKey = key || "";
    if (iframe.__atlasSyncTimer) window.clearInterval(iframe.__atlasSyncTimer);
    syncMountFrame(iframe, key);
    window.setTimeout(function () { syncMountFrame(iframe, key); }, 150);
    window.setTimeout(function () { syncMountFrame(iframe, key); }, 700);
    window.setTimeout(function () { syncMountFrame(iframe, key); }, 1600);
    if (key !== "budget") {
      iframe.__atlasSyncTimer = window.setInterval(function () {
        syncMountFrame(iframe, key);
      }, 2000);
    }
  };

  function isBudgetFrameSource(source) {
    try {
      var frame = document.querySelector('iframe[data-atlas-mount-key="budget"]');
      return !!frame && frame.contentWindow === source;
    } catch (err) {
      return false;
    }
  }

  function publishBudgetToAtlas(payload) {
    if (!payload || !payload.locked || !payload.property || !payload.year) {
      return { ok: false, message: "Only a locked approved scenario can be published to ATLAS." };
    }
    try {
      var propertyName = String(payload.property.name || payload.property.code || "").trim();
      var matchedName = typeof matchPropertyName === "function"
        ? matchPropertyName(propertyName, { fallbackToCurrent: false })
        : propertyName;
      if (!matchedName && typeof matchPropertyName === "function") {
        // Budget Builder uses branded property labels (for example, "RISE Doro")
        // while the shared ATLAS catalog keeps the canonical community name.
        matchedName = matchPropertyName(propertyName.replace(/^RISE\s+/i, ""), { fallbackToCurrent: false });
      }
      if (!matchedName || !savedData || !savedData[matchedName]) {
        return { ok: false, message: "ATLAS could not match the Budget Builder property to a community." };
      }

      var timestamp = new Date().toISOString();
      var record = typeof normalizeSavedCommunityRecord === "function"
        ? normalizeSavedCommunityRecord(matchedName, savedData[matchedName])
        : savedData[matchedName];
      record.financialLedger = Object.assign({}, record.financialLedger || {}, payload.actualsByPeriod || {});
      record.financialBudgetLedger = Object.assign({}, record.financialBudgetLedger || {}, payload.budgetByPeriod || {}, {
        sourceKind: "rise_budget_builder",
        sourceFileName: String(payload.sourceFile || "RISE Budget Builder").trim(),
        scenarioId: String(payload.scenario.id || "").trim(),
        scenarioName: String(payload.scenario.name || "").trim(),
        scenarioStatus: String(payload.scenario.status || "").trim(),
        budgetYear: Number(payload.year),
        publishedAt: timestamp
      });
      record.financialUpdatedAt = timestamp;
      record.financialBudgetUpdatedAt = timestamp;
      record.importTracking = Object.assign({}, record.importTracking || {}, {
        financialBudget: Object.assign({}, record.importTracking && record.importTracking.financialBudget || {}, {
          [String(payload.year)]: { importedAt: timestamp, sourceFileName: "RISE Budget Builder", scenario: payload.scenario.name }
        })
      });
      savedData[matchedName] = typeof normalizeSavedCommunityRecord === "function"
        ? normalizeSavedCommunityRecord(matchedName, record)
        : record;

      if (typeof getProp === "function" && getProp() && matchedName === getProp().name) {
        financialLedger = savedData[matchedName].financialLedger;
        financialBudgetLedger = savedData[matchedName].financialBudgetLedger;
        financialUpdatedAt = timestamp;
        financialBudgetUpdatedAt = timestamp;
      }
      if (typeof syncSharedPropertyFromPortfolioRecord === "function") {
        syncSharedPropertyFromPortfolioRecord(matchedName, savedData[matchedName], { timestamp: timestamp });
      }
      if (typeof persistSaved === "function") persistSaved();
      return { ok: true, message: "Published " + payload.scenario.name + " to ATLAS for " + matchedName + "." };
    } catch (err) {
      return { ok: false, message: "ATLAS could not save this publication: " + String(err && err.message || err) };
    }
  }

  window.navigateAtlasBudgetMount = function (view) {
    var iframe = document.querySelector('iframe[data-atlas-mount-key="budget"]');
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "atlas-budget-navigate", view: String(view || "dashboard") }, "*");
  };

  window.addEventListener("message", function (event) {
    var data = event && event.data;
    if (!data) return;
    if (data.type === "atlas-budget-return-home" && isBudgetFrameSource(event.source)) {
      if (typeof setTab === "function") setTab(0);
      return;
    }
    if (data.type === "atlas-budget-publish" && isBudgetFrameSource(event.source)) {
      var result = publishBudgetToAtlas(data.payload);
      try { event.source.postMessage({ type: "atlas-budget-publish-result", result: result }, "*"); } catch (err) {}
      return;
    }
    if (data.type !== "atlas-embedded-height") return;
    var iframe = document.querySelector('iframe[data-atlas-mount-key="' + String(data.key || "") + '"]');
    if (iframe) applyFrameHeight(iframe, data.height);
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
        '    </div>',
        '  </div>',
        '  <p class="atlas-budget-workspace-note">Approved, locked scenarios publish GL budgets and month-end actuals to ATLAS financial reporting. The workspace stays open while you move through ATLAS.</p>',
        '  <div class="atlas-mount-frame atlas-budget-frame">',
        '    <iframe src="' + esc(embeddedSrc) + '" title="' + esc(m.barTitle) + '" data-atlas-mount-key="budget" onload="window.handleAtlasMountLoad && window.handleAtlasMountLoad(this, \'budget\')" loading="lazy" style="background:' + esc(m.background) + '"></iframe>',
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
      '    <iframe src="' + esc(embeddedSrc) + '" title="' + esc(m.barTitle) + '" data-atlas-mount-key="' + esc(key) + '" onload="window.handleAtlasMountLoad && window.handleAtlasMountLoad(this, \'' + esc(key) + '\')"',
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
