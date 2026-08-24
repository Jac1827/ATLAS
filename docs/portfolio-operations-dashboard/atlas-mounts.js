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
      lede: "Property budgets, scenarios and month-end review on the RISE finance theme. Approved scenarios lock and publish back to ATLAS.",
      title: "Budget Builder",
      note: "Property budget, monthly view, GL detail, actuals and the exception report all run in the Budget Builder itself — ATLAS reads the published scenario.",
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

  function iframeSrc(key, mount) {
    return appendParams(mount.src, "atlasEmbedded=1&atlasMountKey=" + encodeURIComponent(key) + "&v=20260824-inline");
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
    window.ATLAS_EMBEDDED_PEOPLE_ROSTER = roster;
    try {
      if (typeof activeTab !== "undefined" && Number(activeTab) === 13 && typeof refreshAtlasPeopleAccessPanel === "function") {
        refreshAtlasPeopleAccessPanel();
        if (typeof applyAtlasAccessFormDraftToPanel === "function") applyAtlasAccessFormDraftToPanel();
      }
    } catch (err) {
      // Ignore refresh failures; the embedded roster cache is still updated.
    }
  }

  function syncMountFrame(iframe, key) {
    if (!iframe) return;
    applyFrameHeight(iframe, measureFrameHeight(iframe));
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
    iframe.__atlasSyncTimer = window.setInterval(function () {
      syncMountFrame(iframe, key);
    }, 2000);
  };

  window.addEventListener("message", function (event) {
    var data = event && event.data;
    if (!data || data.type !== "atlas-embedded-height") return;
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
    var accessPanel = "";
    try {
      accessPanel = key === "people" && typeof window.renderAtlasEmployeeAccessPanel === "function"
        ? window.renderAtlasEmployeeAccessPanel()
        : "";
    } catch (err) {
      accessPanel = "";
    }
    var embeddedSrc = iframeSrc(key, m);
    return [
      '<div class="atlas-screen-head">',
      "  <div>",
      "    <h1>" + esc(m.screen) + "</h1>",
      "    <p>" + esc(m.lede) + "</p>",
      "  </div>",
      "</div>",
      '<div id="atlas-people-access-panel">' + accessPanel + "</div>",
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
