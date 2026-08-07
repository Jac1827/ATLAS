/* ==========================================================================
   ATLAS — embedded RISE platform mounts
   --------------------------------------------------------------------------
   Ported from "ATLAS Redesign v2.dc.html". Each of the four RISE tools is
   rendered INLINE inside its own ATLAS tab — selecting the tab lands you on
   the platform's own dashboard. Nothing opens in a second browser tab and
   there is no click-to-open gate.

   Each tool still runs as its own self-contained application inside the
   iframe: its logic, storage and exports are untouched by ATLAS.
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
      barSub: "Runs as its own application — intake, validation, MSOE rollover and print export, logic untouched",
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
      barSub: "Runs as its own application against its own database — logic and integrations untouched",
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
      barSub: "Runs as its own application, on the RISE finance theme — logic and exports untouched",
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
      barSub: "Runs as its own application — reviews, training plans and accountability, logic untouched",
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
      '    <a class="atlas-mount-open" href="' + esc(m.src) + '" target="_blank" rel="noopener">',
      '      <i class="ph ph-arrow-square-out" aria-hidden="true"></i>Open full screen',
      "    </a>",
      "  </div>",
      '  <div class="atlas-mount-note">' + esc(m.note) + "</div>",
      '  <div class="atlas-mount-frame">',
      '    <div class="atlas-mount-bar">',
      '      <i class="ph ' + esc(m.icon) + '" aria-hidden="true"></i>',
      '      <span class="atlas-mount-bar-title">' + esc(m.barTitle) + "</span>",
      '      <span class="atlas-mount-bar-sub">' + esc(m.barSub) + "</span>",
      meta ? '      <span class="atlas-mount-bar-meta">' + esc(meta) + "</span>" : "",
      "    </div>",
      '    <iframe src="' + esc(m.src) + '" title="' + esc(m.barTitle) + '"',
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
