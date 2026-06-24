(() => {
  const BUILD_ID = "2026-05-01.1";
  const STORAGE_KEY = "rise_financial_accountability_page_v1";
  const COMMUNITY_STORAGE_KEY = "rise_ops_dashboard_data_v1";
  const LEGACY_COMMUNITY_STORAGE_KEY = "rise_leasing_v5";
  const COMMUNITY_STORAGE_KEYS = [COMMUNITY_STORAGE_KEY, LEGACY_COMMUNITY_STORAGE_KEY];
  const OPS_WORKSPACE_CONTEXT_KEY = "rise_ops_workspace_context_v1";
  const OPS_PROPERTY_CATALOG_KEY = "rise_ops_property_catalog_v1";
  const PORTFOLIO_SCOPE_LABEL = "ATLAS RISE Portfolio";
  const FINANCIAL_HISTORY_STORAGE_KEY = "rise_financial_history_v1";
  const AUTO_IMPORT_SCOPE = "__AUTO__";
  const APPROVED_BUDGET_STORAGE_KEY = "rise_financial_accountability_approved_budgets_v1";
  const FALLBACK_COMMUNITIES = [
    { name: "Bartram Park", units: 297 },
    { name: "Baymeadows", units: 331 },
    { name: "Nocatee", units: 178 },
    { name: "Doro", units: 247 },
    { name: "St Augustine", units: null },
    { name: "Sutton House", units: null },
    { name: "Viera", units: 166 },
    { name: "Florence Villa", units: 224 },
    { name: "Citrus Ridge", units: 222 },
    { name: "Sereno", units: 320 },
    { name: "Glen Kernan Park", units: 308 },
  ];

  const FINANCIAL_LINES = [
    { key: "rentalIncome", label: "Rental Income", glCode: "4000", section: "Operating Income" },
    { key: "otherIncome", label: "Other Income", glCode: "4010", section: "Operating Income" },
    { key: "concessions", label: "Concessions", glCode: "4020", section: "Operating Income" },
    { key: "badDebt", label: "Bad Debt", glCode: "4030", section: "Operating Income" },
    { key: "payroll", label: "Payroll", glCode: "5000", section: "Operating Expenses" },
    { key: "utilities", label: "Utilities", glCode: "5010", section: "Operating Expenses" },
    { key: "repairsMaintenance", label: "Repairs & Maintenance", glCode: "5020", section: "Operating Expenses" },
    { key: "turnExpense", label: "Turn Expense", glCode: "5030", section: "Operating Expenses" },
  ];


  const FILE_SPECS = {
    financial: {
      label: "Financial",
      required: {
        lineItem: ["lineitem", "accountname", "name", "description", "accountdescription"],
        actual: ["actual", "actualamount", "ytdactual", "mtdactual"],
        budget: ["budget", "budgetamount", "ytdbudget", "mtdbudget"],
      },
      recommended: {
        property: ["property", "propertyname", "community", "asset", "assetname", "site"],
        period: ["period", "month", "asof", "asofmonth", "reportingmonth", "date"],
        section: ["section", "category", "accountsection", "finsection"],
        glCode: ["gl", "glcode", "account", "accountnumber", "glaccount"],
        annualBudget: ["annualbudget", "fybudget", "fullyearbudget", "annualplan", "budgetannual"],
      },
    },
    operations: {
      label: "Operational",
      required: {
        property: ["property", "propertyname", "community", "asset", "site"],
        period: ["period", "month", "asof", "asofmonth", "reportingmonth", "date"],
      },
      recommended: {
        units: ["units", "unitcount", "apts", "homes"],
        turns: ["turns", "make readies", "makereadies", "turncount"],
        openWorkOrders: ["openworkorders", "openwo", "workordersopen", "openservicerequests"],
        completedWorkOrders: ["completedworkorders", "completedwo", "closedworkorders", "completedservicerequests"],
        avgMakeReadyDays: ["avgmakereadydays", "makereadydays", "avgturndays", "turndays"],
        payrollHours: ["payrollhours", "hoursworked", "workedhours"],
        overtimeHours: ["overtimehours", "othours", "overtime"],
        payrollCost: ["payrollcost", "payroll", "laborcost"],
        utilitiesCost: ["utilitiescost", "utilities", "utilitycost"],
        rmCost: ["rmcost", "repairsmaintenancecost", "repairsandmaintenance", "repairscost"],
      },
    },
    leasing: {
      label: "Leasing",
      required: {
        property: ["property", "propertyname", "community", "asset", "site"],
        period: ["period", "month", "asof", "asofmonth", "reportingmonth", "date"],
      },
      recommended: {
        units: ["units", "unitcount", "apts", "homes"],
        occupancyPct: ["occupancypct", "occupancy", "physicaloccupancy", "occupiedpct"],
        leasedPct: ["leasedpct", "leased", "economicoccupancy", "leasedpercent"],
        concessionsPct: ["concessionspct", "concessions", "concessionrate"],
        traffic: ["traffic", "guestcards", "prospecttraffic", "leads"],
        tours: ["tours", "tourcount", "propertytours"],
        applications: ["applications", "apps"],
        approvals: ["approvals", "approvedapplications", "applicationsapproved", "approvedapps"],
        leases: ["leases", "signedleases", "moveins"],
        delinquencyPct: ["delinquencypct", "delinquency", "baddebtpct"],
      },
    },
  };

  const CROSSWALKS = [
    {
      pattern: /rental income|rent/i,
      group: "Leasing",
      label: "Rental income",
      narrative: "Revenue softness usually starts with occupancy, leased exposure, conversion, or collections pressure.",
      drivers: ["occupancyPct", "leasedPct", "trafficToLeasePct", "delinquencyPct"],
    },
    {
      pattern: /concession/i,
      group: "Leasing",
      label: "Concessions",
      narrative: "Higher concession spend is often the cost of maintaining leasing pace when occupancy or conversion weakens.",
      drivers: ["concessionsPct", "occupancyPct", "trafficToLeasePct"],
    },
    {
      pattern: /bad debt|delinquency/i,
      group: "Leasing",
      label: "Bad debt",
      narrative: "Bad debt pressure tends to track collections health and downstream delinquency behavior.",
      drivers: ["delinquencyPct", "occupancyPct", "leasedPct"],
    },
    {
      pattern: /payroll/i,
      group: "Operations",
      label: "Payroll",
      narrative: "Payroll variance typically follows labor intensity from turns, service backlog, and overtime.",
      drivers: ["turnsPer100", "openWorkOrdersPer100", "overtimeHoursPer100"],
    },
    {
      pattern: /utilit/i,
      group: "Operations",
      label: "Utilities",
      narrative: "Utility overages usually show up with high occupied load or inefficient turn activity.",
      drivers: ["utilitiesCostPerUnit", "occupancyPct", "turnsPer100"],
    },
    {
      pattern: /repair|maintenance|r&m|turn expense/i,
      group: "Operations",
      label: "R&M / Turns",
      narrative: "R&M and turn spend rise when unit churn, open work orders, and make-ready days drift up together.",
      drivers: ["rmCostPerUnit", "turnsPer100", "openWorkOrdersPer100", "avgMakeReadyDays"],
    },
  ];

  function defaultManualPeriodSelection() {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    return `${today.getFullYear()}-${month}`;
  }

  function buildManualPeriodOptions(anchorPeriod) {
    const normalized = parsePeriod(anchorPeriod) || defaultManualPeriodSelection();
    const match = /^(\d{4})-(\d{2})$/.exec(normalized);
    let baseDate = new Date();
    if (match) {
      baseDate = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    }
    const options = [];
    for (let delta = -3; delta <= 3; delta += 1) {
      const candidate = new Date(baseDate.getFullYear(), baseDate.getMonth() + delta, 1);
      options.push(`${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}`);
    }
    return Array.from(new Set(options));
  }

  function setManualPeriodValue(value, syncPeriod = false) {
    if (!value) return;
    state.manualPeriod = value;
    if (dom.manualPeriodInput && dom.manualPeriodInput.value !== value) {
      dom.manualPeriodInput.value = value;
    }
    if (syncPeriod) {
      state.selectedPeriod = value;
      syncWorkspaceContextFromCurrentSelection();
      persistState();
    }
  }

  const state = {
    layer: "financial",
    selectedPeriod: null,
    selectedProperty: null,
    manualPeriod: defaultManualPeriodSelection(),
    pendingFinancial: null,
    pendingApprovedBudget: null,
    financialImport: {
      scope: AUTO_IMPORT_SCOPE,
      mode: "merge",
      periodMode: "csv",
      periodMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
      periodYear: String(new Date().getFullYear()),
    },
    snapshotScope: {
      mode: "all",
      search: "",
      selectedEntities: [],
    },
    financialLineFilter: {
      period: "selected",
      glCode: "all",
      status: "all",
    },
    datasets: {
      financial: null,
      operations: null,
      leasing: null,
    },
    approvedBudgets: {
      records: [],
      benchmarks: [],
      updatedAt: null,
    },
    lastApprovedBudgetNotice: null,
    approvedBudgetImport: {
      scope: "RISE Corporate",
      year: "2026",
      expandAcrossYear: true,
    },
    lastFinancialApplyNotice: null,
  };

  function ensureFinancialPageBridgeElements() {
    const appRoot = document.getElementById("app");
    if (!appRoot || document.getElementById("financial-workspace-bridge")) {
      return;
    }
    const bridge = document.createElement("section");
    bridge.id = "financial-workspace-bridge";
    bridge.style.maxWidth = "1440px";
    bridge.style.margin = "20px auto 0";
    bridge.style.padding = "0 18px";
    bridge.innerHTML = `
      <div style="background:#ffffff;border:1px solid rgba(15,23,42,0.08);border-radius:18px;padding:16px 18px;box-shadow:0 14px 42px rgba(15,23,42,0.08);display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div style="min-width:260px;flex:1">
          <div style="font-size:0.78rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#013e51">ATLAS Workspace Bridge</div>
          <div id="ops-workspace-note" style="margin-top:6px;font-size:0.92rem;line-height:1.45;color:#475569">Connected to <strong>Portfolio Operations Dashboard</strong>.</div>
          <div id="ops-workspace-chips" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"></div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <a id="back-to-operations" href="./index.html" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;background:#013e51;color:#ffffff;text-decoration:none;font-weight:700;font-size:0.9rem">Back To ATLAS</a>
          <a id="open-selected-ops" href="./index.html" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;border:1px solid rgba(1,62,81,0.18);background:#f8fafc;color:#013e51;text-decoration:none;font-weight:700;font-size:0.9rem">Open Selected Community In Ops</a>
        </div>
      </div>
    `;
    appRoot.parentNode.insertBefore(bridge, appRoot);
  }

  ensureFinancialPageBridgeElements();

  const dom = {
    periodSelect: document.getElementById("period-select"),
    manualPeriodInput: document.getElementById("manual-period-input"),
    dataReadiness: document.getElementById("data-readiness"),
    ledgerDebug: document.getElementById("ledger-debug"),
    opsWorkspaceChips: document.getElementById("ops-workspace-chips"),
    opsWorkspaceNote: document.getElementById("ops-workspace-note"),
    backToOperations: document.getElementById("back-to-operations"),
    openSelectedOps: document.getElementById("open-selected-ops"),
    financialImportScope: document.getElementById("financial-import-scope"),
    financialImportMode: document.getElementById("financial-import-mode"),
    financialPeriodMode: document.getElementById("financial-period-mode"),
    financialPeriodMonth: document.getElementById("financial-period-month"),
    financialPeriodYear: document.getElementById("financial-period-year"),
    financialImportSummary: document.getElementById("financial-import-summary"),
    financialImportCoverage: document.getElementById("financial-import-coverage"),
    financialImportWorkspaceChip: document.getElementById("financial-import-workspace-chip"),
    financialHistoryStatus: document.getElementById("financial-history-status"),
    reloadFinancialHistory: document.getElementById("reload-financial-history"),
    clearFinancialHistory: document.getElementById("clear-financial-history"),
    openFinancialImport: document.getElementById("open-financial-import"),
    openFinancialImportHeader: document.getElementById("open-financial-import-header"),
    financialInput: document.getElementById("financial-input"),
    snapshotScopeMode: document.getElementById("snapshot-scope-mode"),
    snapshotEntitySearch: document.getElementById("snapshot-entity-search"),
    snapshotSelectVisible: document.getElementById("snapshot-select-visible"),
    snapshotClearSelection: document.getElementById("snapshot-clear-selection"),
    snapshotScopeSummary: document.getElementById("snapshot-scope-summary"),
    snapshotScopeCount: document.getElementById("snapshot-scope-count"),
    snapshotEntityChips: document.getElementById("snapshot-entity-chips"),
    snapshotGrid: document.getElementById("snapshot-grid"),
    rankingBody: document.getElementById("ranking-body"),
    selectedPropertyShell: document.getElementById("selected-property-shell"),
    layerContent: document.getElementById("layer-content"),
    crosswalkContent: document.getElementById("crosswalk-content"),
    boardSummary: document.getElementById("board-summary"),
    crosswalkLibrary: document.getElementById("crosswalk-library"),
    financialFilterPeriod: document.getElementById("financial-filter-period"),
    financialFilterGl: document.getElementById("financial-filter-gl"),
    financialFilterStatus: document.getElementById("financial-filter-status"),
    financialFilterNote: document.getElementById("financial-filter-note"),
    exportScorecards: document.getElementById("export-scorecards"),
    exportSummary: document.getElementById("export-summary"),
    exportReport: document.getElementById("export-report"),
    exportPptx: document.getElementById("export-pptx"),
    applyFinancialUpload: document.getElementById("apply-financial-upload"),
    clearFinancialStaging: document.getElementById("clear-financial-staging"),
    syncDashboardHistory: document.getElementById("sync-dashboard-history"),
    approvedBudgetScope: document.getElementById("approved-budget-scope"),
    approvedBudgetYear: document.getElementById("approved-budget-year"),
    approvedBudgetExpandYear: document.getElementById("approved-budget-expand-year"),
    approvedBudgetInput: document.getElementById("approved-budget-input"),
    openApprovedBudgetImport: document.getElementById("open-approved-budget-import"),
    applyApprovedBudgetUpload: document.getElementById("apply-approved-budget-upload"),
    clearApprovedBudgetStaging: document.getElementById("clear-approved-budget-staging"),
    approvedBudgetChip: document.getElementById("approved-budget-chip"),
    approvedBudgetMeta: document.getElementById("approved-budget-meta"),
    approvedBudgetSummary: document.getElementById("approved-budget-summary"),
  };

  let xlsxLoaderPromise = null;
  let pdfLoaderPromise = null;
  let pendingApprovedBudgetFiles = [];
  const CSV_AND_EXCEL_FILE_ACCEPT = ".csv,text/csv,.xlsx,.xls,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12";

  function logDebug(...args) {
    // Keep console noise low in normal operation, but invaluable while we harden imports.
    try {
      // eslint-disable-next-line no-console
      console.log("[financial-accountability]", ...args);
    } catch (_error) {}
  }

  function applySupportedFileAcceptAttributes() {
    try {
      if (dom.financialInput) {
        dom.financialInput.accept = `${CSV_AND_EXCEL_FILE_ACCEPT},.pdf,application/pdf`;
      }
      if (dom.approvedBudgetInput) {
        dom.approvedBudgetInput.accept = CSV_AND_EXCEL_FILE_ACCEPT;
      }
    } catch (_error) {}
  }

  function isLegacyCdnParserErrorNotice(notice) {
    const message = String(notice?.message || "");
    if (!message) return false;
    return (
      /Excel parser could not be loaded from CDN/i.test(message) &&
      !/Offline parser detail:/i.test(message)
    );
  }

  function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      }, timeoutMs);
      Promise.resolve(promise)
        .then((value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(error);
        });
    });
  }

  function normalizeKey(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function normalizeCommunityLookupName(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/rise:\s*a\s+real\s+estate\s+company/gi, "")
      .replace(/\brise\s+real\s+estate\b/gi, "")
      .replace(/^rise\s+at\s+/gi, "")
      .replace(/^rise\s+/gi, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function loadDashboardCommunityStore() {
    try {
      for (const key of COMMUNITY_STORAGE_KEYS) {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          return JSON.parse(raw);
        }
      }
      return {};
    } catch (_error) {
      return {};
    }
  }

  function loadSavedCommunityCatalog() {
    try {
      const store = loadDashboardCommunityStore();
      return Object.entries(store || {})
        .map(([name, record]) => ({
          name: String(name ?? "").trim(),
          units: parseAmount(record?.totalUnitsOverride ?? record?.totalUnits ?? record?.unitCount ?? null),
        }))
        .filter((entry) => Boolean(entry.name));
    } catch (_error) {
      return [];
    }
  }

  function loadOpsPropertyCatalog() {
    try {
      const raw = window.localStorage.getItem(OPS_PROPERTY_CATALOG_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const properties = Array.isArray(parsed?.properties) ? parsed.properties : [];
      return properties
        .map((entry) => ({
          name: String(entry?.name ?? "").trim(),
          units: parseAmount(entry?.units) ?? null,
        }))
        .filter((entry) => Boolean(entry.name));
    } catch (_error) {
      return [];
    }
  }

  function loadApprovedBudgets() {
    try {
      const raw = window.localStorage.getItem(APPROVED_BUDGET_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") {
        return { records: [], benchmarks: [], updatedAt: null };
      }
      return {
        records: Array.isArray(parsed.records) ? parsed.records : [],
        benchmarks: Array.isArray(parsed.benchmarks) ? parsed.benchmarks : [],
        updatedAt: parsed.updatedAt || null,
      };
    } catch (_error) {
      return { records: [], benchmarks: [], updatedAt: null };
    }
  }

  function persistApprovedBudgets() {
    try {
      window.localStorage.setItem(
        APPROVED_BUDGET_STORAGE_KEY,
        JSON.stringify({
          records: Array.isArray(state.approvedBudgets.records) ? state.approvedBudgets.records : [],
          benchmarks: Array.isArray(state.approvedBudgets.benchmarks) ? state.approvedBudgets.benchmarks : [],
          updatedAt: state.approvedBudgets.updatedAt || null,
        }),
      );
    } catch (_error) {}
  }

  function formatPeriodLabel(period) {
    const normalized = parsePeriod(period);
    const match = /^(\d{4})-(\d{2})$/.exec(String(normalized ?? ""));
    if (!match) {
      return String(period ?? "");
    }
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return `${monthNames[Math.max(0, Math.min(11, Number(match[2]) - 1))]} ${match[1]}`;
  }

  function normalizeWorkspaceContext(input = {}) {
    const community = String(input.community ?? input.property ?? "").trim();
    const normalizedPeriod = parsePeriod(input.period ?? input.month ?? "");
    let monthIndex = Number.isInteger(input.monthIndex) ? input.monthIndex : null;
    if (monthIndex == null && normalizedPeriod) {
      const monthMatch = /^(\d{4})-(\d{2})$/.exec(normalizedPeriod);
      monthIndex = monthMatch ? Number(monthMatch[2]) - 1 : null;
    }
    if (!community && !normalizedPeriod && monthIndex == null) {
      return null;
    }
    return {
      community,
      period: normalizedPeriod || "",
      monthIndex,
      source: String(input.source ?? "portfolio-operations-dashboard").trim() || "portfolio-operations-dashboard",
      updatedAt: String(input.updatedAt ?? "").trim() || new Date().toISOString(),
    };
  }

  function loadWorkspaceContextFromStorage() {
    try {
      const raw = window.localStorage.getItem(OPS_WORKSPACE_CONTEXT_KEY);
      return raw ? normalizeWorkspaceContext(JSON.parse(raw)) : null;
    } catch (_error) {
      return null;
    }
  }

  function loadWorkspaceContextFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const community = params.get("community");
      const period = params.get("period") || params.get("month");
      return normalizeWorkspaceContext({
        community,
        period,
        source: "portfolio-operations-dashboard",
      });
    } catch (_error) {
      return null;
    }
  }

  function persistWorkspaceContext(context) {
    const normalized = normalizeWorkspaceContext(context);
    if (!normalized) {
      return null;
    }
    try {
      window.localStorage.setItem(OPS_WORKSPACE_CONTEXT_KEY, JSON.stringify(normalized));
    } catch (_error) {}
    return normalized;
  }

  function getCommunityCatalog() {
    // IMPORTANT:
    // This page should prioritize the Operations Dashboard catalog, but it also needs
    // resilient fallbacks when the live origin has not refreshed that catalog yet.
    // We therefore merge the ops catalog first, then saved ops community records,
    // then any already-loaded financial entities, and finally a safe portfolio seed.
    const merged = new Map();
    const collect = (entries = []) => {
      entries.forEach((entry) => {
        const name = String(entry?.name ?? entry?.property ?? "").trim();
        if (!name || /^rise corporate$/i.test(name)) return;
        const existing = merged.get(name) || { name, units: null };
        const units = parseAmount(entry?.units ?? entry?.totalUnits ?? entry?.unitCount ?? null);
        merged.set(name, {
          name,
          units: existing.units ?? units ?? null,
        });
      });
    };

    collect(loadOpsPropertyCatalog());
    collect(loadSavedCommunityCatalog());
    collect((state.datasets.financial?.records || []).map((record) => ({ name: record?.property })));
    collect((state.approvedBudgets?.records || []).map((record) => ({ name: record?.property })));
    collect(FALLBACK_COMMUNITIES);

    return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  function matchCommunityName(rawName) {
    const cleaned = String(rawName ?? "").trim();
    if (!cleaned) {
      return "";
    }

    if (/^atlas rise portfolio$/i.test(cleaned) || /^__rise_portfolio__$/i.test(cleaned)) {
      return PORTFOLIO_SCOPE_LABEL;
    }

    const normalized = normalizeCommunityLookupName(cleaned);
    if (normalized === "corporate" || normalized === "risecorporate" || normalized === "rise corporate") {
      return "RISE Corporate";
    }

    const communities = getCommunityCatalog().map((community) => community.name);
    const exact = communities.find((name) => {
      const candidate = normalizeCommunityLookupName(name);
      return name.toLowerCase() === cleaned.toLowerCase() || candidate === normalized;
    });
    if (exact) {
      return exact;
    }

    const fuzzy = communities.find((name) => {
      const candidate = normalizeCommunityLookupName(name);
      return (
        (normalized && candidate.includes(normalized)) ||
        (normalized && normalized.includes(candidate)) ||
        candidate.split(" ")[0] === normalized.split(" ")[0]
      );
    });

    return fuzzy || cleaned;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function buildOperationsDashboardHref(context = {}) {
    const normalized = normalizeWorkspaceContext(context) || normalizeWorkspaceContext({
      community: state.selectedProperty,
      period: state.selectedPeriod,
    });
    const params = new URLSearchParams();
    if (normalized?.community) {
      params.set("community", normalized.community);
    }
    if (normalized?.period) {
      params.set("period", normalized.period);
    }
    const query = params.toString();
    return `index.html${query ? `?${query}` : ""}`;
  }

  function applyWorkspaceContext(context, { forceSelection = false, updateImportScope = false } = {}) {
    const normalized = normalizeWorkspaceContext(context);
    if (!normalized) {
      return null;
    }
    const matchedCommunity = normalized.community ? matchCommunityName(normalized.community) : "";
    const isPortfolioScope = matchedCommunity === PORTFOLIO_SCOPE_LABEL;
    if (isPortfolioScope) {
      state.snapshotScope.mode = "all";
      state.snapshotScope.selectedEntities = [];
      if (forceSelection) {
        state.selectedProperty = null;
      }
      if (updateImportScope && (forceSelection || !state.financialImport.scope)) {
        state.financialImport.scope = AUTO_IMPORT_SCOPE;
      }
    }
    if (matchedCommunity && (forceSelection || !state.selectedProperty)) {
      state.selectedProperty = isPortfolioScope ? null : matchedCommunity;
    }
    if (normalized.period && (forceSelection || !state.selectedPeriod)) {
      state.selectedPeriod = normalized.period;
      setManualPeriodValue(normalized.period, false);
    }
    if (
      matchedCommunity &&
      !isPortfolioScope &&
      updateImportScope &&
      (forceSelection || !state.financialImport.scope || state.financialImport.scope === AUTO_IMPORT_SCOPE)
    ) {
      state.financialImport.scope = matchedCommunity;
    }
    return {
      ...normalized,
      community: matchedCommunity || normalized.community,
    };
  }

  function syncWorkspaceContextFromCurrentSelection(source = "financial-accountability") {
    return persistWorkspaceContext({
      community: state.selectedProperty || loadWorkspaceContextFromStorage()?.community || "",
      period: state.selectedPeriod || loadWorkspaceContextFromStorage()?.period || "",
      source,
      updatedAt: new Date().toISOString(),
    });
  }

  function renderWorkspaceBridge() {
    const storedContext = loadWorkspaceContextFromStorage();
    const currentContext = normalizeWorkspaceContext({
      community: state.selectedProperty || storedContext?.community || "",
      period: state.selectedPeriod || storedContext?.period || "",
      source: storedContext?.source || "portfolio-operations-dashboard",
      updatedAt: storedContext?.updatedAt || new Date().toISOString(),
    });
    const opsHref = buildOperationsDashboardHref(currentContext || storedContext || {});
    const lastUpdatedText = storedContext?.updatedAt
      ? new Date(storedContext.updatedAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "";

    if (dom.backToOperations) {
      dom.backToOperations.href = opsHref;
    }
    if (dom.openSelectedOps) {
      dom.openSelectedOps.href = opsHref;
      dom.openSelectedOps.textContent = currentContext?.community
        ? `Open ${currentContext.community} In Ops`
        : "Open Selected Community In Ops";
    }
    if (dom.opsWorkspaceChips) {
      const chips = [
        `<span class="chip good">Live ops sync ready</span>`,
        currentContext?.community ? `<span class="chip">${escapeHtml(currentContext.community)}</span>` : "",
        currentContext?.period ? `<span class="chip">${escapeHtml(formatPeriodLabel(currentContext.period))}</span>` : "",
        lastUpdatedText ? `<span class="chip">${escapeHtml(lastUpdatedText)}</span>` : "",
      ].filter(Boolean);
      dom.opsWorkspaceChips.innerHTML = chips.join("");
    }
    if (dom.opsWorkspaceNote) {
      const scopeText = currentContext?.community
        ? `<strong>${escapeHtml(currentContext.community)}</strong>${currentContext?.period ? ` · <strong>${escapeHtml(formatPeriodLabel(currentContext.period))}</strong>` : ""}`
        : "the latest saved ops workspace";
      const lastUpdated = lastUpdatedText ? ` Last workspace update ${escapeHtml(lastUpdatedText)}.` : "";
      dom.opsWorkspaceNote.innerHTML = `Connected to <strong>Portfolio Operations Dashboard</strong>. Operations and leasing drivers will sync from ${scopeText}.${lastUpdated}`;
    }
  }

  function getFinancialImportScopeLabel(scopeValue) {
    return scopeValue && scopeValue !== AUTO_IMPORT_SCOPE ? scopeValue : "Use property or community from CSV";
  }

  function getFinancialImportModeLabel(modeValue) {
    if (modeValue === "replace_scope") {
      return "replace the selected entity scope";
    }
    if (modeValue === "replace_all") {
      return "replace all loaded financial history";
    }
    return "merge into the loaded financial history";
  }

  function getFinancialPeriodOverride(importState = state.financialImport) {
    if ((importState?.periodMode || "csv") !== "override") {
      return null;
    }
    const month = String(importState?.periodMonth || "").padStart(2, "0");
    const year = String(importState?.periodYear || "").trim();
    if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month)) {
      return null;
    }
    return `${year}-${month}`;
  }

  function getSnapshotScopeLabel(modeValue, selectedCount = 0) {
    if (modeValue === "corporate") {
      return "RISE Corporate only";
    }
    if (modeValue === "communities") {
      return "communities only";
    }
    if (modeValue === "custom") {
      return selectedCount > 0 ? `${selectedCount} selected entities` : "custom selection";
    }
    return "all loaded entities";
  }

  function formatStoredTimestamp(value) {
    if (!value) {
      return "--";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return parsed.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function loadFinancialHistoryStore() {
    try {
      const raw = window.localStorage.getItem(FINANCIAL_HISTORY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  function saveFinancialHistoryStore(dataset) {
    if (!dataset?.records?.length) {
      return;
    }

    const payload = {
      savedAt: new Date().toISOString(),
      dataset: {
        type: "financial",
        fileName: dataset.fileName || "financial-history.csv",
        sourceKind: dataset.sourceKind || "file",
        sourceText: dataset.sourceText || "",
        records: dataset.records || [],
        diagnostics: dataset.diagnostics || null,
      },
    };
    try {
      window.localStorage.setItem(FINANCIAL_HISTORY_STORAGE_KEY, JSON.stringify(payload));
    } catch (_error) {
      // Storage quota errors should not prevent the UI from updating.
      state.lastFinancialApplyNotice = {
        at: new Date().toISOString(),
        kind: "error",
        message:
          "Could not save the financial ledger into local stored history because browser storage is full. Clear stored history and try again.",
      };
    }
  }

  function clearFinancialHistoryStore() {
    try {
      window.localStorage.removeItem(FINANCIAL_HISTORY_STORAGE_KEY);
    } catch (_error) {}
  }

  function populateFinancialImportScopeOptions() {
    if (!dom.financialImportScope) {
      return;
    }

    const selectedValue = state.financialImport.scope || AUTO_IMPORT_SCOPE;
    const knownCommunityMap = new Map();
    getCommunityCatalog().forEach((community) => {
      knownCommunityMap.set(community.name, `${community.name}${community.units ? ` (${community.units} units)` : ""}`);
    });

    const options = [
      { value: AUTO_IMPORT_SCOPE, label: "CSV contains entity names" },
      { value: "RISE Corporate", label: "RISE Corporate only" },
      ...Array.from(knownCommunityMap.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    ];
    if (selectedValue && !options.find((option) => option.value === selectedValue)) {
      options.push({ value: selectedValue, label: `${selectedValue} (selected scope)` });
    }

    dom.financialImportScope.innerHTML = options
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}" ${option.value === selectedValue ? "selected" : ""}>${escapeHtml(
            option.label,
          )}</option>`,
      )
      .join("");
  }

  function populateApprovedBudgetScopeOptions() {
    if (!dom.approvedBudgetScope) {
      return;
    }
    const selectedValue = state.approvedBudgetImport.scope || "RISE Corporate";
    const options = [
      { value: "RISE Corporate", label: "RISE Corporate only" },
      ...getCommunityCatalog().map((community) => ({
        value: community.name,
        label: `${community.name}${community.units ? ` (${community.units} units)` : ""}`,
      })),
    ];
    if (selectedValue && !options.find((entry) => entry.value === selectedValue)) {
      options.push({ value: selectedValue, label: `${selectedValue} (selected)` });
    }
    dom.approvedBudgetScope.innerHTML = options
      .map(
        (entry) =>
          `<option value="${escapeHtml(entry.value)}" ${entry.value === selectedValue ? "selected" : ""}>${escapeHtml(
            entry.label,
          )}</option>`,
      )
      .join("");
  }

  function getApprovedBudgetCoverage(records = state.approvedBudgets?.records || []) {
    const safeRecords = Array.isArray(records) ? records : [];
    const properties = Array.from(new Set(safeRecords.map((record) => record?.property).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
    const years = Array.from(
      new Set(
        safeRecords
          .map((record) => String(record?.period || "").slice(0, 4))
          .filter((year) => /^\d{4}$/.test(year)),
      ),
    ).sort((a, b) => a.localeCompare(b));
    const benchmarkYears = Array.from(
      new Set(
        (state.approvedBudgets?.benchmarks || [])
          .map((record) => String(record?.period || "").slice(0, 4))
          .filter((year) => /^\d{4}$/.test(year)),
      ),
    ).sort((a, b) => a.localeCompare(b));
    return {
      rowCount: safeRecords.length,
      entityCount: properties.length,
      properties,
      years,
      benchmarkYears,
      updatedAt: state.approvedBudgets?.updatedAt || null,
    };
  }

  function parseCsv(text) {
    const source = String(text ?? "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        continue;
      }

      if (char === ",") {
        row.push(cell);
        cell = "";
        continue;
      }

      if (char === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        continue;
      }

      if (char !== "\r") {
        cell += char;
      }
    }

    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }

    return rows
      .map((currentRow) => currentRow.map((value) => String(value ?? "").trim()))
      .filter((currentRow) => currentRow.some((value) => value !== ""));
  }

  function parseAmount(value) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return null;
    }
    const stripped = raw.replace(/[$,%]/g, "").replace(/,/g, "");
    const negativeMatch = /^\((.*)\)$/.exec(stripped);
    const numeric = Number(negativeMatch ? `-${negativeMatch[1]}` : stripped);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function parsePercent(value) {
    const numeric = parseAmount(value);
    if (numeric == null) {
      return null;
    }
    return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  }

  function columnRefToIndex(cellRef = "") {
    const match = /^([A-Za-z]+)/.exec(String(cellRef));
    if (!match) {
      return -1;
    }
    const letters = match[1].toUpperCase();
    let index = 0;
    for (let i = 0; i < letters.length; i += 1) {
      index = (index * 26) + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  function readUInt16LE(buffer, offset) {
    return buffer[offset] | (buffer[offset + 1] << 8);
  }

  function readUInt32LE(buffer, offset) {
    return (
      buffer[offset] |
      (buffer[offset + 1] << 8) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 24)
    ) >>> 0;
  }

  function findEocdOffset(buffer) {
    // EOCD is located in the last 65,557 bytes max (ZIP spec).
    const minOffset = Math.max(0, buffer.length - 65557);
    for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
      if (
        buffer[i] === 0x50 &&
        buffer[i + 1] === 0x4b &&
        buffer[i + 2] === 0x05 &&
        buffer[i + 3] === 0x06
      ) {
        return i;
      }
    }
    return -1;
  }

  async function inflateRawBytes(compressedBytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Browser does not support DecompressionStream for offline XLSX parsing.");
    }
    const stream = new DecompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    await writer.write(compressedBytes);
    await writer.close();
    const decompressedBuffer = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(decompressedBuffer);
  }

  async function unzipEntryBytes(zipBytes, entry) {
    const localOffset = entry.localHeaderOffset;
    if (
      zipBytes[localOffset] !== 0x50 ||
      zipBytes[localOffset + 1] !== 0x4b ||
      zipBytes[localOffset + 2] !== 0x03 ||
      zipBytes[localOffset + 3] !== 0x04
    ) {
      throw new Error(`Invalid ZIP local header for ${entry.name}`);
    }
    const localNameLen = readUInt16LE(zipBytes, localOffset + 26);
    const localExtraLen = readUInt16LE(zipBytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;
    const compressed = zipBytes.slice(dataStart, dataEnd);

    if (entry.compressionMethod === 0) {
      return compressed;
    }
    if (entry.compressionMethod === 8) {
      return inflateRawBytes(compressed);
    }
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}`);
  }

  function xmlElementsByTag(root, tagName) {
    if (!root) return [];
    const direct = Array.from(root.getElementsByTagName(tagName) || []);
    if (direct.length) return direct;
    if (typeof root.getElementsByTagNameNS === "function") {
      return Array.from(root.getElementsByTagNameNS("*", tagName) || []);
    }
    return [];
  }

  function firstXmlElementByTag(root, tagName) {
    return xmlElementsByTag(root, tagName)[0] || null;
  }

  function xmlText(root, tagName) {
    return String(firstXmlElementByTag(root, tagName)?.textContent ?? "");
  }

  function extractRowsFromSheetXml(sheetXml, parser, sharedStrings) {
    if (!sheetXml) {
      return [];
    }
    const sheetDoc = parser.parseFromString(sheetXml, "application/xml");
    const rows = [];
    xmlElementsByTag(sheetDoc, "row").forEach((rowNode) => {
      const rowValues = [];
      xmlElementsByTag(rowNode, "c").forEach((cellNode) => {
        const cellRef = cellNode.getAttribute("r") || "";
        const colIndex = columnRefToIndex(cellRef);
        if (colIndex < 0) {
          return;
        }
        const cellType = cellNode.getAttribute("t") || "";
        let value = "";
        if (cellType === "s") {
          const idx = Number(xmlText(cellNode, "v"));
          value = Number.isFinite(idx) ? String(sharedStrings[idx] ?? "") : "";
        } else if (cellType === "inlineStr") {
          value = xmlElementsByTag(cellNode, "t")
            .map((node) => node.textContent || "")
            .join("");
        } else {
          value = xmlText(cellNode, "v");
        }
        rowValues[colIndex] = value;
      });
      const normalized = rowValues.map((entry) => String(entry ?? "").trim());
      if (normalized.some((entry) => entry !== "")) {
        rows.push(normalized);
      }
    });
    return rows;
  }

  async function parseXlsxRowsOffline(buffer) {
    const zipBytes = new Uint8Array(buffer);
    const decoder = new TextDecoder("utf-8");
    const eocdOffset = findEocdOffset(zipBytes);
    if (eocdOffset < 0) {
      throw new Error("Invalid XLSX/ZIP file: EOCD not found.");
    }
    const centralDirectorySize = readUInt32LE(zipBytes, eocdOffset + 12);
    const centralDirectoryOffset = readUInt32LE(zipBytes, eocdOffset + 16);
    const centralEnd = centralDirectoryOffset + centralDirectorySize;

    const entries = new Map();
    let cursor = centralDirectoryOffset;
    while (cursor < centralEnd) {
      if (
        zipBytes[cursor] !== 0x50 ||
        zipBytes[cursor + 1] !== 0x4b ||
        zipBytes[cursor + 2] !== 0x01 ||
        zipBytes[cursor + 3] !== 0x02
      ) {
        break;
      }
      const compressionMethod = readUInt16LE(zipBytes, cursor + 10);
      const compressedSize = readUInt32LE(zipBytes, cursor + 20);
      const nameLen = readUInt16LE(zipBytes, cursor + 28);
      const extraLen = readUInt16LE(zipBytes, cursor + 30);
      const commentLen = readUInt16LE(zipBytes, cursor + 32);
      const localHeaderOffset = readUInt32LE(zipBytes, cursor + 42);
      const nameStart = cursor + 46;
      const nameBytes = zipBytes.slice(nameStart, nameStart + nameLen);
      const name = decoder.decode(nameBytes);
      entries.set(name, {
        name,
        compressionMethod,
        compressedSize,
        localHeaderOffset,
      });
      cursor = nameStart + nameLen + extraLen + commentLen;
    }

    const readEntryXml = async (name) => {
      const entry = entries.get(name);
      if (!entry) return null;
      const bytes = await unzipEntryBytes(zipBytes, entry);
      return decoder.decode(bytes);
    };

    const workbookXml = await readEntryXml("xl/workbook.xml");
    const relsXml = await readEntryXml("xl/_rels/workbook.xml.rels");
    if (!workbookXml || !relsXml) {
      throw new Error("Invalid XLSX file: workbook metadata not found.");
    }

    const parser = new DOMParser();
    const workbookDoc = parser.parseFromString(workbookXml, "application/xml");
    const relsDoc = parser.parseFromString(relsXml, "application/xml");

    const relMap = new Map();
    xmlElementsByTag(relsDoc, "Relationship").forEach((node) => {
      relMap.set(node.getAttribute("Id"), node.getAttribute("Target"));
    });

    const sheetNodes = xmlElementsByTag(workbookDoc, "sheet");
    if (!sheetNodes.length) {
      return [];
    }

    const sharedStringsXml = await readEntryXml("xl/sharedStrings.xml");
    const sharedStrings = [];
    if (sharedStringsXml) {
      const sstDoc = parser.parseFromString(sharedStringsXml, "application/xml");
      xmlElementsByTag(sstDoc, "si").forEach((si) => {
        const text = xmlElementsByTag(si, "t")
          .map((node) => node.textContent || "")
          .join("");
        sharedStrings.push(text);
      });
    }

    const normalizeSheetPath = (target = "") => {
      if (target.startsWith("/")) {
        return target.replace(/^\//, "");
      }
      const normalized = `xl/${target.replace(/^\.?\//, "")}`;
      return normalized.replace(/\/\.\//g, "/").replace(/\/[^/]+\/\.\.\//g, "/");
    };

    for (const sheetNode of sheetNodes) {
      const rid = sheetNode.getAttribute("r:id") || sheetNode.getAttribute("id");
      const relTarget = relMap.get(rid);
      if (!relTarget) {
        continue;
      }
      const sheetPath = normalizeSheetPath(relTarget);
      const sheetXml = await readEntryXml(sheetPath);
      const rows = extractRowsFromSheetXml(sheetXml, parser, sharedStrings);
      if (rows.length) {
        return rows;
      }
    }
    throw new Error("Invalid XLSX file: worksheet XML missing.");
  }

  async function ensurePdfJsLoaded() {
    if (typeof window.pdfjsLib !== "undefined") {
      return true;
    }
    if (!pdfLoaderPromise) {
      const candidateUrls = [
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
        "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
      ];
      const loadScriptWithTimeout = (url, timeoutMs = 3500) =>
        new Promise((resolve, reject) => {
          const script = document.createElement("script");
          let settled = false;
          const timer = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
              script.remove();
            } catch (_error) {}
            reject(new Error(`Timed out loading ${url}`));
          }, timeoutMs);
          const finish = (ok, error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            if (ok) resolve(true);
            else reject(error || new Error(`Failed loading ${url}`));
          };
          script.src = url;
          script.async = true;
          script.onload = () => finish(true);
          script.onerror = () => finish(false, new Error(`Failed loading ${url}`));
          document.head.appendChild(script);
        });
      pdfLoaderPromise = new Promise((resolve, reject) => {
        const tryLoad = (index) => {
          if (typeof window.pdfjsLib !== "undefined") {
            resolve(true);
            return;
          }
          const nextUrl = candidateUrls[index];
          if (!nextUrl) {
            reject(new Error("PDF parser could not be loaded. Upload CSV/XLSX instead or enable internet access for PDF parsing."));
            return;
          }
          loadScriptWithTimeout(nextUrl)
            .then(() => {
              if (typeof window.pdfjsLib !== "undefined") resolve(true);
              else tryLoad(index + 1);
            })
            .catch(() => tryLoad(index + 1));
        };
        tryLoad(0);
      }).catch((error) => {
        pdfLoaderPromise = null;
        throw error;
      });
    }
    await pdfLoaderPromise;
    return true;
  }

  function monthNameToPeriodToken(token) {
    const normalized = String(token || "").trim().toLowerCase();
    const months = {
      jan: "01",
      january: "01",
      feb: "02",
      february: "02",
      mar: "03",
      march: "03",
      apr: "04",
      april: "04",
      may: "05",
      jun: "06",
      june: "06",
      jul: "07",
      july: "07",
      aug: "08",
      august: "08",
      sep: "09",
      sept: "09",
      september: "09",
      oct: "10",
      october: "10",
      nov: "11",
      november: "11",
      dec: "12",
      december: "12",
    };
    return months[normalized] || "";
  }

  function normalizePdfLine(line) {
    return String(line ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isFinancialPdfSectionLine(line) {
    if (!line) return false;
    if (/\d/.test(line)) return false;
    if (/^(property:|account|actual|budget|variance|accrual basis|page \d+|ytd\b|rise - )/i.test(line)) return false;
    return /^[A-Za-z&/,\- ]+$/.test(line);
  }

  function extractFinancialPdfMetadata(lines, fallbackProperty = "", fallbackPeriod = "") {
    let property = matchCommunityName(fallbackProperty || "");
    let period = parsePeriod(fallbackPeriod || "");
    for (const rawLine of lines) {
      const line = normalizePdfLine(rawLine);
      if (!line) continue;
      if (!property) {
        const propertyMatch = line.match(/^Property:\s*(.+)$/i);
        if (propertyMatch) {
          property = matchCommunityName(propertyMatch[1]);
        } else {
          const risePropertyMatch = line.match(/^RISE\s+(.+)$/i);
          if (risePropertyMatch && !/balance sheet|income statement|budget comparison/i.test(line)) {
            property = matchCommunityName(risePropertyMatch[1]);
          }
        }
      }
      if (!period) {
        const monthMatch = line.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(20\d{2})\b/i);
        if (monthMatch) {
          const month = monthNameToPeriodToken(monthMatch[1]);
          if (month) {
            period = `${monthMatch[2]}-${month}`;
          }
        }
      }
      if (property && period) break;
    }
    return { property, period };
  }

  function parseFinancialPdfLine(line, context = {}) {
    const normalized = normalizePdfLine(line);
    if (!normalized) return null;
    const rowMatch = normalized.match(
      /^(?:(\d{3,5})\s+)?(.+?)\s+(\(?-?[\d,]+\.\d{2}\)?)\s+(\(?-?[\d,]+\.\d{2}\)?)\s+(\(?-?[\d,]+\.\d{2}\)?)\s+(-?[\d,]+\.\d+%)\s+(\(?-?[\d,]+\.\d{2}\)?)\s+(\(?-?[\d,]+\.\d{2}\)?)\s+(\(?-?[\d,]+\.\d{2}\)?)\s+(-?[\d,]+\.\d+%)\s+(\(?-?[\d,]+\.\d{2}\)?)$/,
    );
    if (!rowMatch) return null;
    return [
      rowMatch[1] || "",
      rowMatch[2] || "",
      rowMatch[3] || "",
      rowMatch[4] || "",
      rowMatch[10] || "",
      context.section || "",
      context.property || "",
      context.period || "",
    ];
  }

  async function readPdfToRows(file, options = {}) {
    await ensurePdfJsLoaded();
    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer, disableWorker: true }).promise;
    const lines = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const grouped = new Map();
      Array.from(textContent.items || []).forEach((item) => {
        const text = normalizePdfLine(item?.str || "");
        if (!text) return;
        const transform = item?.transform || [];
        const y = Math.round(Number(transform[5] || 0));
        const x = Number(transform[4] || 0);
        const bucket = grouped.get(y) || [];
        bucket.push({ x, text });
        grouped.set(y, bucket);
      });
      Array.from(grouped.entries())
        .sort((left, right) => right[0] - left[0])
        .forEach(([, entries]) => {
          const line = normalizePdfLine(
            entries
              .sort((left, right) => left.x - right.x)
              .map((entry) => entry.text)
              .join(" "),
          );
          if (line) lines.push(line);
        });
    }

    const sourceText = lines.join("\n");
    const fallbackScope =
      options.scopeOverride && options.scopeOverride !== AUTO_IMPORT_SCOPE ? options.scopeOverride : "";
    const metadata = extractFinancialPdfMetadata(lines, fallbackScope, options.periodOverride || options.period);
    const rows = [["Account", "Account Name", "Actual", "Budget", "Annual Budget", "Section", "Property", "Period"]];
    let inIncomeStatement = false;
    let currentSection = "";
    lines.forEach((line) => {
      if (/budget comparison - income statement|income statement - budget vs actual/i.test(line)) {
        inIncomeStatement = true;
        return;
      }
      if (!inIncomeStatement) return;
      if (/^Account\s+Account Name\s+Actual\s+Budget/i.test(line)) return;
      if (/^Property:/i.test(line) || /^Accrual Basis$/i.test(line) || /generated .* page \d+/i.test(line)) return;
      const parsedRow = parseFinancialPdfLine(line, {
        section: currentSection,
        property: metadata.property,
        period: metadata.period,
      });
      if (parsedRow) {
        rows.push(parsedRow);
        return;
      }
      if (isFinancialPdfSectionLine(line)) {
        currentSection = line;
      }
    });

    if (rows.length <= 1) {
      throw new Error(`No financial statement rows were detected in ${file?.name || "PDF"}.`);
    }
    return { rows, sourceText };
  }

  function parsePeriod(value) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return "";
    }

    let match = /^(\d{4})[-/](\d{1,2})/.exec(raw);
    if (match) {
      return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
    }

    match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(raw);
    if (match) {
      const year = match[3].length === 2 ? `20${match[3]}` : match[3];
      return `${year}-${String(Number(match[1])).padStart(2, "0")}`;
    }

    match = /^([a-zA-Z]+)\s+(\d{4})$/.exec(raw);
    if (match) {
      const monthIndex = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
      ].findIndex((name) => name.startsWith(match[1].toLowerCase()));
      if (monthIndex >= 0) {
        return `${match[2]}-${String(monthIndex + 1).padStart(2, "0")}`;
      }
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
    }

    return raw;
  }

  function comparePeriod(a, b) {
    return String(a).localeCompare(String(b));
  }

  function shiftPeriod(period, monthDelta) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(period ?? ""));
    if (!match) {
      return null;
    }

    const date = new Date(Number(match[1]), Number(match[2]) - 1 + monthDelta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function getDatasetCoverage(dataset) {
    const records = dataset?.records || [];
    const properties = Array.from(new Set(records.map((record) => record.property).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right),
    );
    const periods = Array.from(new Set(records.map((record) => record.period).filter(Boolean))).sort(comparePeriod);
    return {
      recordCount: records.length,
      entityCount: properties.length,
      properties,
      periodStart: periods[0] || null,
      periodEnd: periods[periods.length - 1] || null,
    };
  }

  function normalizeStoredFinancialDataset(dataset, fallbackFileName = "Stored financial history") {
    if (!dataset?.records?.length) {
      return null;
    }

    return {
      type: "financial",
      fileName: dataset.fileName || fallbackFileName,
      sourceKind: dataset.sourceKind || "stored",
      sourceText: dataset.sourceText || "",
      records: dataset.records || [],
      diagnostics:
        dataset.diagnostics || {
          parsedRows: dataset.records.length,
          fileRows: dataset.records.length,
          missingRequired: [],
          missingRecommended: [],
          detected: {},
        },
    };
  }

  function getFinancialEntityNames() {
    const allowed = new Set(getCommunityCatalog().map((community) => community.name));
    allowed.add("RISE Corporate");
    return Array.from(
      new Set((state.datasets.financial?.records || []).map((record) => record.property).filter(Boolean)),
    )
      .filter((property) => allowed.has(property))
      .sort((left, right) => left.localeCompare(right));
  }

  function getScopeEntityPool(properties, mode) {
    if (mode === "corporate") {
      return properties.filter((property) => property === "RISE Corporate");
    }
    if (mode === "communities") {
      return properties.filter((property) => property !== "RISE Corporate");
    }
    return properties;
  }

  function getScopedPropertyNames(properties) {
    const mode = state.snapshotScope.mode || "all";
    if (mode === "custom") {
      const selected = new Set((state.snapshotScope.selectedEntities || []).filter(Boolean));
      return properties.filter((property) => selected.has(property));
    }
    return getScopeEntityPool(properties, mode);
  }

  function getVisibleScopeEntityNames(properties) {
    const mode = state.snapshotScope.mode || "all";
    const basePool = mode === "custom" ? properties : getScopeEntityPool(properties, mode);
    const search = normalizeCommunityLookupName(state.snapshotScope.search || "");
    if (!search) {
      return basePool;
    }
    return basePool.filter((property) => normalizeCommunityLookupName(property).includes(search));
  }

  function normalizeFinancialRecords(records) {
    const expenseValues = records
      .filter((record) => !isIncomeSection(record.section))
      .flatMap((record) => [record.actual, record.budget, record.annualBudget])
      .filter((value) => value != null && value !== 0);

    const negativeExpenseShare =
      expenseValues.length > 0 ? expenseValues.filter((value) => value < 0).length / expenseValues.length : 0;

    if (negativeExpenseShare < 0.6) {
      return records;
    }

    return records.map((record) =>
      isIncomeSection(record.section)
        ? record
        : {
            ...record,
            actual: Math.abs(record.actual ?? 0),
            budget: Math.abs(record.budget ?? 0),
            annualBudget: Math.abs(record.annualBudget ?? 0),
          },
    );
  }

  function getQuarterForMonthIndex(monthIndex) {
    if (monthIndex <= 2) {
      return "Q1";
    }
    if (monthIndex <= 5) {
      return "Q2";
    }
    if (monthIndex <= 8) {
      return "Q3";
    }
    return "Q4";
  }

  function getRenewalSummaryForEntry(entry = {}) {
    const expirations = Math.max(0, Number(entry.renewalExpirations) || 0);
    const signed = Math.max(0, Number(entry.renewalSigned) || 0);
    const ntv = Math.max(0, Number(entry.renewalNTV) || 0);
    const transfers = Math.max(0, Number(entry.renewalTransfers) || 0);
    const earlyTermination = Math.max(0, Number(entry.renewalEarlyTermination) || 0);
    const undecided = Math.max(expirations - signed - ntv - transfers, 0);
    const decidedBase = signed + ntv;
    const decidedRetentionRate = decidedBase > 0 ? (signed / decidedBase) * 100 : 50;
    const projectedUndecidedLosses = undecided > 0 ? Math.round(undecided * ((100 - decidedRetentionRate) / 100)) : 0;
    const projectedRenewalAttrition = Math.max(ntv + projectedUndecidedLosses, 0);
    const projectedAttrition = Math.max(projectedRenewalAttrition + earlyTermination, 0);
    return {
      projectedAttrition,
    };
  }

  function getEffectiveMoveOutsForEntry(entry = {}) {
    const manualMoveOuts = Math.max(0, Number(entry.moveOuts) || 0);
    const renewalMoveOuts = getRenewalSummaryForEntry(entry).projectedAttrition;
    return manualMoveOuts > 0 ? manualMoveOuts : renewalMoveOuts;
  }

  function estimateSnapshotUnitsForRecord(monthEntries, targetMonth, anchorMonth, anchorUnits, snapshotKey, totalUnits) {
    let runningUnits = Math.max(0, Number(anchorUnits) || 0);
    if (!Number.isInteger(targetMonth) || !Number.isInteger(anchorMonth)) {
      return runningUnits;
    }
    if (targetMonth === anchorMonth) {
      return runningUnits;
    }

    if (targetMonth < anchorMonth) {
      for (let month = anchorMonth; month > targetMonth; month -= 1) {
        const priorSnapshot = Number(monthEntries[month - 1]?.[snapshotKey] ?? 0);
        if (priorSnapshot > 0) {
          return priorSnapshot;
        }
        runningUnits = Math.max(
          runningUnits + getEffectiveMoveOutsForEntry(monthEntries[month]) - (Number(monthEntries[month]?.moveIns) || 0),
          0,
        );
        runningUnits = totalUnits > 0 ? Math.min(runningUnits, totalUnits) : runningUnits;
      }
      return runningUnits;
    }

    for (let month = anchorMonth + 1; month <= targetMonth; month += 1) {
      const explicitSnapshot = Number(monthEntries[month]?.[snapshotKey] ?? 0);
      if (explicitSnapshot > 0) {
        runningUnits = explicitSnapshot;
        continue;
      }
      runningUnits = Math.max(
        runningUnits - getEffectiveMoveOutsForEntry(monthEntries[month]) + (Number(monthEntries[month]?.moveIns) || 0),
        0,
      );
      runningUnits = totalUnits > 0 ? Math.min(runningUnits, totalUnits) : runningUnits;
    }

    return runningUnits;
  }

  function buildDashboardDataset(type) {
    const saved = loadDashboardCommunityStore();
    const catalog = getCommunityCatalog();
    const currentYear = new Date().getFullYear();
    const records = [];

    catalog.forEach((community) => {
      const stored = saved[community.name];
      if (!stored) {
        return;
      }

      const monthlyEntries =
        Array.isArray(stored.monthlyData) && stored.monthlyData.length === 12
          ? stored.monthlyData
          : Array.from({ length: 12 }, () => ({}));
      const anchorMonth = Number.isInteger(stored.currentMonth) ? stored.currentMonth : new Date().getMonth();
      const units = parseAmount(stored.customUnits) || community.units || null;
      const anchorOccupied = Number(stored.currentOccupied) || 0;
      const anchorLeased = Number(stored.currentLeased) || 0;

      monthlyEntries.forEach((entry, monthIndex) => {
        const period = `${currentYear}-${String(monthIndex + 1).padStart(2, "0")}`;
        const turns = getEffectiveMoveOutsForEntry(entry);
        const occupiedUnits =
          Number(entry.occupiedSnapshot) > 0
            ? Number(entry.occupiedSnapshot)
            : estimateSnapshotUnitsForRecord(
                monthlyEntries,
                monthIndex,
                anchorMonth,
                anchorOccupied,
                "occupiedSnapshot",
                units,
              );
        const leasedUnits =
          Number(entry.leasedSnapshot) > 0
            ? Number(entry.leasedSnapshot)
            : estimateSnapshotUnitsForRecord(
                monthlyEntries,
                monthIndex,
                anchorMonth,
                anchorLeased,
                "leasedSnapshot",
                units,
              );
        const concessionsPct =
          Number(entry.marketRent) > 0 && Number(entry.concessions) > 0
            ? (Number(entry.concessions) / Number(entry.marketRent)) * 100
            : null;
        const delinquencyPct = parsePercent(entry.delinquency);
        const hasData =
          [
            turns,
            entry.moveIns,
            entry.guestCards,
            entry.tours,
            entry.applications,
            entry.applicationsApproved,
            entry.leasesSignedActual,
            entry.marketRent,
            entry.concessions,
            occupiedUnits,
            leasedUnits,
          ].some((value) => Number(value) > 0) ||
          Number(stored.msoeByQuarter?.[getQuarterForMonthIndex(monthIndex)]) > 0;

        if (!hasData) {
          return;
        }

        if (type === "operations") {
          records.push({
            property: community.name,
            period,
            units,
            turns,
            openWorkOrders: null,
            completedWorkOrders: null,
            avgMakeReadyDays: null,
            payrollHours: null,
            overtimeHours: null,
            payrollCost: null,
            utilitiesCost: null,
            rmCost: null,
            msoeCompletionPct: parseAmount(stored.msoeByQuarter?.[getQuarterForMonthIndex(monthIndex)]),
          });
          return;
        }

        records.push({
          property: community.name,
          period,
          units,
          occupancyPct: units ? (occupiedUnits / units) * 100 : null,
          leasedPct: units ? (leasedUnits / units) * 100 : null,
          concessionsPct,
          traffic: parseAmount(entry.guestCards) || parseAmount(entry.tours),
          tours: parseAmount(entry.tours),
          applications: parseAmount(entry.applications),
          approvals: getApplicationsApprovedCount(entry),
          leases: parseAmount(entry.leasesSignedActual),
          delinquencyPct,
        });
      });
    });

    return {
      type,
      fileName: "Synced from operations dashboard",
      sourceKind: "dashboard",
      sourceText: "",
      records,
      diagnostics: {
        parsedRows: records.length,
        fileRows: records.length,
        missingRequired: [],
        missingRecommended: [],
        detected: { source: COMMUNITY_STORAGE_KEY },
      },
    };
  }

  function quoteCsvCell(value) {
    const text = String(value ?? "");
    return /[,"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function toCsv(headers, records) {
    const lines = [headers.join(",")];
    for (const record of records) {
      lines.push(headers.map((header) => quoteCsvCell(record[header])).join(","));
    }
    return lines.join("\n");
  }

  function formatCurrency(value) {
    if (value == null) {
      return "--";
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatPercent(value, digits = 1) {
    if (value == null) {
      return "--";
    }
    return `${Number(value).toFixed(digits)}%`;
  }

  function formatSignedPercent(value, digits = 1) {
    if (value == null || Number.isNaN(Number(value))) {
      return "--";
    }
    const numeric = Number(value);
    const prefix = numeric > 0 ? "+" : "";
    return `${prefix}${numeric.toFixed(digits)}%`;
  }

  function calcPercentChange(delta, baseline) {
    if (delta == null || baseline == null) {
      return null;
    }
    const base = Math.abs(Number(baseline));
    if (!Number.isFinite(base) || base === 0) {
      return null;
    }
    return (Number(delta) / base) * 100;
  }

  function trendVerb(value, positive = "Improved", negative = "Declined", neutral = "Flat") {
    if (value == null || Number.isNaN(Number(value))) {
      return "--";
    }
    const numeric = Number(value);
    if (numeric > 0) return positive;
    if (numeric < 0) return negative;
    return neutral;
  }

  function formatNumber(value, digits = 0) {
    if (value == null) {
      return "--";
    }
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
  }

  function isIncomeSection(section) {
    return /income|revenue/i.test(section);
  }

  function pickHeader(headers, aliases) {
    const normalizedHeaders = headers.map((header) => ({
      original: header,
      normalized: normalizeKey(header),
    }));

    for (const alias of aliases) {
      const normalizedAlias = normalizeKey(alias);
      const exact = normalizedHeaders.find((header) => header.normalized === normalizedAlias);
      if (exact) {
        return exact.original;
      }
    }

    for (const alias of aliases) {
      const normalizedAlias = normalizeKey(alias);
      const partial = normalizedHeaders.find(
        (header) =>
          header.normalized.includes(normalizedAlias) || normalizedAlias.includes(header.normalized),
      );
      if (partial) {
        return partial.original;
      }
    }

    return null;
  }

  function detectFields(headers, spec) {
    const detected = {};
    const missingRequired = [];
    const missingRecommended = [];

    for (const [key, aliases] of Object.entries(spec.required)) {
      const match = pickHeader(headers, aliases);
      if (match) {
        detected[key] = match;
      } else {
        missingRequired.push(key);
      }
    }

    for (const [key, aliases] of Object.entries(spec.recommended || {})) {
      const match = pickHeader(headers, aliases);
      if (match) {
        detected[key] = match;
      } else {
        missingRecommended.push(key);
      }
    }

    return { detected, missingRequired, missingRecommended };
  }

  function getField(row, fieldMap, key) {
    const column = fieldMap[key];
    return column ? row[column] : "";
  }

  function parseDataset(type, text, fileName, options = {}) {
    const scopeOverride =
      type === "financial" && options.scopeOverride && options.scopeOverride !== AUTO_IMPORT_SCOPE
        ? matchCommunityName(options.scopeOverride)
        : null;
    const periodOverride =
      type === "financial" && options.periodOverride ? parsePeriod(options.periodOverride) : null;
    const spec = {
      ...FILE_SPECS[type],
      required: { ...(FILE_SPECS[type].required || {}) },
      recommended: { ...(FILE_SPECS[type].recommended || {}) },
    };
    if (type === "financial" && !scopeOverride) {
      // If the user didn't choose a scope override, the file must supply an entity name.
      spec.required.property = FILE_SPECS.financial.recommended.property;
    }
    if (periodOverride) {
      delete spec.required.period;
    }
    const rawRows = parseCsv(text);
    return parseDatasetFromRows(type, rawRows, fileName, {
      ...options,
      sourceText: text,
      _specOverride: spec,
      _scopeOverride: scopeOverride,
      periodOverride,
    });
  }

  function parseDatasetFromRows(type, rawRows, fileName, options = {}) {
    const scopeOverride =
      type === "financial" && options._scopeOverride
        ? options._scopeOverride
        : type === "financial" && options.scopeOverride && options.scopeOverride !== AUTO_IMPORT_SCOPE
          ? matchCommunityName(options.scopeOverride)
          : null;
    const periodOverride =
      type === "financial" && options.periodOverride ? parsePeriod(options.periodOverride) : null;
    const spec = options._specOverride
      ? options._specOverride
      : {
          ...FILE_SPECS[type],
          required: { ...(FILE_SPECS[type].required || {}) },
          recommended: { ...(FILE_SPECS[type].recommended || {}) },
        };
    const allowBudgetOnly = type === "financial" && Boolean(options.allowBudgetOnly);
    if (type === "financial" && !scopeOverride && !options._specOverride) {
      spec.required.property = FILE_SPECS.financial.recommended.property;
    }
    if (type === "financial" && allowBudgetOnly) {
      delete spec.required.actual;
      const budgetAliases = new Set([
        ...(spec.required.budget || []),
        ...(FILE_SPECS.financial.recommended?.annualBudget || []),
      ]);
      spec.required.budget = Array.from(budgetAliases);
    }
    if (type === "financial" && periodOverride && spec.required?.period) {
      delete spec.required.period;
    }

    const headerRowIndex = (() => {
      if (!rawRows.length) return -1;
      for (let i = 0; i < rawRows.length; i += 1) {
        const candidate = rawRows[i];
        if (!candidate || candidate.length < 2) continue;
        const info = detectFields(candidate, spec);
        if (!info.missingRequired.length) return i;
      }
      return 0;
    })();
    const rows = headerRowIndex >= 0 ? rawRows.slice(headerRowIndex) : rawRows;

    if (!rows.length) {
      return {
        type,
        fileName,
        sourceKind: "file",
        sourceText: String(options.sourceText ?? ""),
        records: [],
        diagnostics: {
          parsedRows: 0,
          missingRequired: ["No rows found"],
          missingRecommended: [],
          detected: {},
        },
      };
    }

    const headers = rows[0];
    const fieldInfo = detectFields(headers, spec);
    const records = [];

    if (!fieldInfo.missingRequired.length) {
      let currentSection = "";
      for (const rowCells of rows.slice(1)) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = rowCells[index] ?? "";
        });

        if (type === "financial") {
          // If the file doesn't contain an entity column, the import workspace scope acts as the entity source of truth.
          const property = matchCommunityName(scopeOverride || getField(row, fieldInfo.detected, "property")) || matchCommunityName(scopeOverride);
          const rawPeriod = getField(row, fieldInfo.detected, "period");
          const period =
            periodOverride ||
            parsePeriod(rawPeriod) ||
            parsePeriod(options.period) ||
            state.selectedPeriod ||
            state.manualPeriod;
          const rawSection = getField(row, fieldInfo.detected, "section");
          const rawLineItem = getField(row, fieldInfo.detected, "lineItem");
          const glCodeRaw = getField(row, fieldInfo.detected, "glCode").trim();
          const glCodeCandidate = glCodeRaw && /^\d{3,}$/.test(glCodeRaw) ? glCodeRaw : "";
          const sectionHeaderCandidate = rawSection || rawLineItem || glCodeRaw;
          const hasNumeric =
            parseAmount(getField(row, fieldInfo.detected, "actual")) != null ||
            parseAmount(getField(row, fieldInfo.detected, "budget")) != null;

          // For "Income Statement - Budget vs Actual" style exports, section headers appear as
          // rows with no numeric values. Some exports put the section label in the Account/GL column.
          if (sectionHeaderCandidate && !hasNumeric && !rawLineItem) {
            currentSection = String(sectionHeaderCandidate).trim();
            continue;
          }

          const section = String(rawSection || currentSection || "Uncategorized").trim();
          const lineItem = String(rawLineItem).trim();
          let actual = parseAmount(getField(row, fieldInfo.detected, "actual"));
          let budget = parseAmount(getField(row, fieldInfo.detected, "budget"));
          const annualBudgetCandidate = parseAmount(getField(row, fieldInfo.detected, "annualBudget"));
          if (allowBudgetOnly) {
            if (actual == null) {
              actual = 0;
            }
            if (budget == null && annualBudgetCandidate != null) {
              budget = annualBudgetCandidate / 12;
            }
          }

          const noBudgetValue = budget == null && annualBudgetCandidate == null;
          if (!property || !period || !section || !lineItem || (!allowBudgetOnly && actual == null && budget == null) || (allowBudgetOnly && noBudgetValue)) {
            continue;
          }

          const annualBudget =
            annualBudgetCandidate ??
            ((budget ?? 0) * 12);

          records.push({
            property: property.trim(),
            period,
            section: section.trim(),
            lineItem: lineItem.trim(),
            glCode: glCodeCandidate,
            actual: actual ?? 0,
            budget: budget ?? 0,
            annualBudget,
          });
        }

        if (type === "operations") {
          const property = matchCommunityName(getField(row, fieldInfo.detected, "property"));
          const period = parsePeriod(getField(row, fieldInfo.detected, "period"));
          if (!property || !period) {
            continue;
          }

          records.push({
            property: property.trim(),
            period,
            units: parseAmount(getField(row, fieldInfo.detected, "units")),
            turns: parseAmount(getField(row, fieldInfo.detected, "turns")),
            openWorkOrders: parseAmount(getField(row, fieldInfo.detected, "openWorkOrders")),
            completedWorkOrders: parseAmount(getField(row, fieldInfo.detected, "completedWorkOrders")),
            avgMakeReadyDays: parseAmount(getField(row, fieldInfo.detected, "avgMakeReadyDays")),
            payrollHours: parseAmount(getField(row, fieldInfo.detected, "payrollHours")),
            overtimeHours: parseAmount(getField(row, fieldInfo.detected, "overtimeHours")),
            payrollCost: parseAmount(getField(row, fieldInfo.detected, "payrollCost")),
            utilitiesCost: parseAmount(getField(row, fieldInfo.detected, "utilitiesCost")),
            rmCost: parseAmount(getField(row, fieldInfo.detected, "rmCost")),
          });
        }

        if (type === "leasing") {
          const property = matchCommunityName(getField(row, fieldInfo.detected, "property"));
          const period = parsePeriod(getField(row, fieldInfo.detected, "period"));
          if (!property || !period) {
            continue;
          }

          records.push({
            property: property.trim(),
            period,
            units: parseAmount(getField(row, fieldInfo.detected, "units")),
            occupancyPct: parsePercent(getField(row, fieldInfo.detected, "occupancyPct")),
            leasedPct: parsePercent(getField(row, fieldInfo.detected, "leasedPct")),
            concessionsPct: parsePercent(getField(row, fieldInfo.detected, "concessionsPct")),
            traffic: parseAmount(getField(row, fieldInfo.detected, "traffic")),
            tours: parseAmount(getField(row, fieldInfo.detected, "tours")),
            applications: parseAmount(getField(row, fieldInfo.detected, "applications")),
            approvals: parseAmount(getField(row, fieldInfo.detected, "approvals")),
            leases: parseAmount(getField(row, fieldInfo.detected, "leases")),
            delinquencyPct: parsePercent(getField(row, fieldInfo.detected, "delinquencyPct")),
          });
        }
      }
    }

    const normalizedRecords = type === "financial" ? normalizeFinancialRecords(records) : records;
    const finalRecords =
      type === "financial" && scopeOverride
        ? normalizedRecords.map((record) => ({
            ...record,
            property: record.property || matchCommunityName(scopeOverride),
          }))
        : normalizedRecords;

    return {
      type,
      fileName,
      sourceKind: "file",
      sourceText: String(options.sourceText ?? ""),
      records: finalRecords,
      diagnostics: {
        parsedRows: finalRecords.length,
        fileRows: Math.max(0, rows.length - 1),
        missingRequired: fieldInfo.missingRequired,
        missingRecommended: fieldInfo.missingRecommended,
        detected: fieldInfo.detected,
      },
    };
  }

  function detectBudgetMonthColumns(rows = []) {
    const monthLookup = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    let monthHeaderIndex = -1;
    let monthColumns = [];
    let totalColumnIndex = -1;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const mapped = [];
      let monthHits = 0;
      for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
        const token = String(row[colIndex] ?? "").trim().toLowerCase();
        const key = token.slice(0, 3);
        if (monthLookup[key]) {
          mapped.push({ colIndex, month: monthLookup[key] });
          monthHits += 1;
        }
        if (token === "total") {
          totalColumnIndex = colIndex;
        }
      }
      if (monthHits >= 6) {
        monthHeaderIndex = rowIndex;
        monthColumns = mapped.sort((a, b) => a.colIndex - b.colIndex);
        break;
      }
    }
    return { monthHeaderIndex, monthColumns, totalColumnIndex };
  }

  function parseFinalizedBudgetMatrixRows(rawRows, options = {}) {
    const rows = Array.isArray(rawRows) ? rawRows : [];
    if (!rows.length) {
      return { records: [], benchmarks: [], yearsDetected: [] };
    }
    const scopeOverride = matchCommunityName(options.scopeOverride || "RISE Corporate");
    const year = String(Number(options.year || new Date().getFullYear()) || new Date().getFullYear());
    const { monthHeaderIndex, monthColumns, totalColumnIndex } = detectBudgetMonthColumns(rows);

    if (monthHeaderIndex < 0 || !monthColumns.length) {
      return { records: [], benchmarks: [], yearsDetected: [] };
    }

    const records = [];
    const benchmarks = [];
    const yearsDetected = new Set([year]);
    let currentSection = "Uncategorized";
    let currentContextLineItem = "";
    for (const row of rows.slice(monthHeaderIndex + 1)) {
      const first = String(row?.[0] ?? "").trim();
      const second = String(row?.[1] ?? "").trim();
      const label = second || first;
      const lowerLabel = label.toLowerCase();
      const monthlyValues = monthColumns.map(({ colIndex }) => parseAmount(row?.[colIndex]));
      const hasMonthlyValues = monthlyValues.some((value) => value != null);
      const glMatch = /^\d{3,}$/.test(first) ? first : "";
      const isSectionHeader = !glMatch && !second && !hasMonthlyValues && first && !/total/i.test(first);
      const isTotalRow = /total/i.test(first) || /total/i.test(second);
      const isActualRow = /actual/i.test(first) || /actual/i.test(second);
      const yearMatch = /\b(20\d{2})\b/.exec(`${first} ${second}`);
      const isYearComparativeRow = Boolean(
        yearMatch && /(actual|budget|forecast|prior|plan)/i.test(`${first} ${second}`),
      );

      if (isSectionHeader) {
        currentSection = first;
        continue;
      }
      if (!label || !hasMonthlyValues) {
        continue;
      }

      if (isYearComparativeRow) {
        const benchmarkYear = yearMatch?.[1];
        if (benchmarkYear) {
          yearsDetected.add(benchmarkYear);
          const totalValue = totalColumnIndex >= 0 ? parseAmount(row?.[totalColumnIndex]) : null;
          const contextLineItem = currentContextLineItem || currentSection || "Comparative";
          monthColumns.forEach(({ colIndex, month }) => {
            const amount = parseAmount(row?.[colIndex]);
            if (amount == null) {
              return;
            }
            benchmarks.push({
              property: scopeOverride,
              period: `${benchmarkYear}-${month}`,
              year: benchmarkYear,
              section: currentSection || "Uncategorized",
              lineItem: contextLineItem,
              benchmarkLabel: label,
              amount,
              totalAmount: totalValue,
            });
          });
        }
        continue;
      }

      if (isTotalRow || isActualRow) {
        if (first) {
          currentContextLineItem = first;
        }
        continue;
      }

      const totalValue = totalColumnIndex >= 0 ? parseAmount(row?.[totalColumnIndex]) : null;
      const inferredAnnual = totalValue ?? monthlyValues.reduce((sum, value) => sum + (value ?? 0), 0);
      if (first && !glMatch) {
        currentContextLineItem = first;
      } else if (label) {
        currentContextLineItem = label;
      }
      monthColumns.forEach(({ colIndex, month }) => {
        const budget = parseAmount(row?.[colIndex]);
        if (budget == null) {
          return;
        }
        records.push({
          property: scopeOverride,
          period: `${year}-${month}`,
          section: currentSection || "Uncategorized",
          lineItem: label,
          glCode: glMatch,
          actual: 0,
          budget,
          annualBudget: inferredAnnual || (budget * 12),
        });
      });
    }
    const dedupedBenchmarks = new Map();
    benchmarks.forEach((entry) => {
      const key = `${entry.property}::${entry.period}::${entry.section}::${entry.lineItem}::${entry.benchmarkLabel}`;
      dedupedBenchmarks.set(key, entry);
    });
    return {
      records: normalizeFinancialRecords(records),
      benchmarks: Array.from(dedupedBenchmarks.values()),
      yearsDetected: Array.from(yearsDetected).sort((a, b) => a.localeCompare(b)),
    };
  }

  function fileExt(name = "") {
    const match = /\.([a-z0-9]+)$/i.exec(String(name));
    return match ? match[1].toLowerCase() : "";
  }

  function readWorkbookRowsWithXlsx(buffer) {
    if (typeof window.XLSX === "undefined") {
      throw new Error("Excel parser is not loaded.");
    }
    const workbook = window.XLSX.read(buffer, { type: "array" });
    const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
    const sheetName =
      sheetNames.find((name) => {
        const sheet = workbook.Sheets?.[name];
        if (!sheet) return false;
        const data = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
        return Array.isArray(data) && data.some((row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== ""));
      }) || sheetNames[0];
    const sheet = sheetName ? workbook.Sheets?.[sheetName] : null;
    if (!sheet) {
      return [];
    }
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    return (Array.isArray(rows) ? rows : [])
      .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []))
      .filter((row) => row.some((cell) => cell !== ""));
  }

  async function readFileToRows(file, options = {}) {
    const ext = fileExt(file?.name || "");
    const isWorkbook = ["xlsx", "xlsm", "xls"].includes(ext);
    const isPdf = ext === "pdf";
    if (isPdf) {
      return readPdfToRows(file, options);
    }
    if (!isWorkbook) {
      const text = await file.text();
      return { rows: parseCsv(text), sourceText: text };
    }

    const buffer = await file.arrayBuffer();
    let offlineError = null;
    let xlsxError = null;

    if (typeof window.XLSX !== "undefined") {
      try {
        return { rows: readWorkbookRowsWithXlsx(buffer), sourceText: "" };
      } catch (error) {
        xlsxError = error;
        logDebug("xlsx-library-parse-failed", file?.name, error?.message || error);
      }
    }

    if (typeof window.XLSX === "undefined") {
      if (!xlsxLoaderPromise) {
        const candidateUrls = [
          "assets/xlsx.full.min.js",
          "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
          "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js",
          "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
        ];
        const loadScriptWithTimeout = (url, timeoutMs = 3500) =>
          new Promise((resolve, reject) => {
            const script = document.createElement("script");
            let settled = false;
            const timer = window.setTimeout(() => {
              if (settled) return;
              settled = true;
              try {
                script.remove();
              } catch (_error) {}
              reject(new Error(`Timed out loading ${url}`));
            }, timeoutMs);

            const finish = (ok, error) => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              if (ok) {
                resolve(true);
              } else {
                reject(error || new Error(`Failed loading ${url}`));
              }
            };

            script.src = url;
            script.async = true;
            script.onload = () => finish(true);
            script.onerror = () => finish(false, new Error(`Failed loading ${url}`));
            document.head.appendChild(script);
          });
        xlsxLoaderPromise = new Promise((resolve, reject) => {
          const tryLoad = (index) => {
            if (typeof window.XLSX !== "undefined") {
              resolve(true);
              return;
            }
            const nextUrl = candidateUrls[index];
            if (!nextUrl) {
              const suffix = offlineError ? ` Offline parser detail: ${offlineError?.message || String(offlineError)}` : "";
              reject(new Error(`Excel parser could not be loaded from CDN.${suffix} Upload CSV, use .xlsx in a Chromium browser, or enable internet access for XLSX parsing.`));
              return;
            }
            loadScriptWithTimeout(nextUrl)
              .then(() => {
                if (typeof window.XLSX !== "undefined") {
                  resolve(true);
                } else {
                  tryLoad(index + 1);
                }
              })
              .catch(() => {
                tryLoad(index + 1);
              });
          };
          tryLoad(0);
        }).catch((error) => {
          xlsxLoaderPromise = null;
          throw error;
        });
      }
      await xlsxLoaderPromise;
    }

    if (typeof window.XLSX !== "undefined") {
      try {
        return { rows: readWorkbookRowsWithXlsx(buffer), sourceText: "" };
      } catch (error) {
        xlsxError = error;
        logDebug("xlsx-library-parse-after-load-failed", file?.name, error?.message || error);
      }
    }

    if ((ext === "xlsx" || ext === "xlsm") && typeof window.XLSX === "undefined") {
      try {
        const offlineRows = await withTimeout(
          parseXlsxRowsOffline(buffer),
          4000,
          `Offline XLSX parsing timed out for ${file?.name || "workbook"}.`,
        );
        if (Array.isArray(offlineRows) && offlineRows.length) {
          return { rows: offlineRows, sourceText: "" };
        }
      } catch (error) {
        offlineError = error;
        logDebug("offline-xlsx-parse-failed", file?.name, error?.message || error);
      }
    }

    if (typeof window.XLSX === "undefined") {
      const suffix = offlineError ? ` Offline parser detail: ${offlineError?.message || String(offlineError)}` : "";
      throw new Error(`Excel parser is not available.${suffix} Upload CSV, use .xlsx in a Chromium browser, or enable internet access for XLSX parsing.`);
    }

    const xlsxSuffix = xlsxError ? ` Parser detail: ${xlsxError?.message || String(xlsxError)}` : "";
    const offlineSuffix = offlineError ? ` Offline parser detail: ${offlineError?.message || String(offlineError)}` : "";
    throw new Error(`Excel workbook could not be parsed.${xlsxSuffix}${offlineSuffix}`);
  }

  async function parseApprovedBudgetFiles(fileList, options = {}) {
    const scopeOverride = matchCommunityName(options.scopeOverride || "RISE Corporate");
    const parsedYear = String(Number(options.year || "2026") || 2026);
    const yearFallbackPeriod = `${parsedYear}-01`;
    let staged = null;
    const stagedFiles = [];
    const benchmarkRows = [];
    const detectedYears = new Set([parsedYear]);

    for (const file of Array.from(fileList || []).filter(Boolean)) {
      const { rows, sourceText } = await withTimeout(
        readFileToRows(file, {
          scopeOverride,
          periodOverride: yearFallbackPeriod,
          period: yearFallbackPeriod,
        }),
        12000,
        `Timed out reading ${file?.name || "workbook"}. Try the file again or upload a CSV export for this budget.`,
      );
      let parsed = parseDatasetFromRows("financial", rows, file.name, {
        scopeOverride,
        replaceMode: "approved_budget",
        period: yearFallbackPeriod,
        periodOverride: yearFallbackPeriod,
        sourceText,
        allowBudgetOnly: true,
      });
      const matrixParsed = parseFinalizedBudgetMatrixRows(rows, {
        scopeOverride,
        year: parsedYear,
      });
      matrixParsed.yearsDetected?.forEach((yearToken) => detectedYears.add(String(yearToken)));
      if (Array.isArray(matrixParsed.benchmarks) && matrixParsed.benchmarks.length) {
        benchmarkRows.push(...matrixParsed.benchmarks);
      }
      if (matrixParsed.records.length) {
        const mergedRecords = mergeDatasetRecords("financial", parsed.records || [], matrixParsed.records);
        parsed = {
          ...parsed,
          records: mergedRecords,
          diagnostics: {
            ...(parsed.diagnostics || {}),
            parsedRows: mergedRecords.length,
            fileRows: Math.max(0, rows.length - 1),
            detected: {
              ...((parsed.diagnostics && parsed.diagnostics.detected) || {}),
              source: "finalized-budget-matrix-with-comparatives",
            },
          },
        };
      }
      if (!parsed.records?.length && matrixParsed.records.length) {
        parsed = {
          type: "financial",
          fileName: file.name,
          sourceKind: "file",
          sourceText,
          records: matrixParsed.records,
          diagnostics: {
            parsedRows: matrixParsed.records.length,
            fileRows: Math.max(0, rows.length - 1),
            missingRequired: [],
            missingRecommended: [],
            detected: { source: "finalized-budget-matrix-with-comparatives" },
          },
        };
      }
      staged = staged
        ? {
            ...parsed,
            fileName: `${staged.fileName || "approved-budget-staged"} + ${parsed.fileName || file.name}`,
            sourceKind: "staged",
            records: mergeDatasetRecords("financial", staged.records || [], parsed.records || []),
            diagnostics: {
              ...(parsed.diagnostics || {}),
              parsedRows: (staged.records?.length || 0) + (parsed.records?.length || 0),
              fileRows: (staged.records?.length || 0) + (parsed.records?.length || 0),
            },
          }
        : {
            ...parsed,
            sourceKind: "staged",
          };
      stagedFiles.push(file.name);
    }

    return {
      staged,
      stagedFiles,
      scopeOverride,
      parsedYear,
      benchmarkRows,
      detectedYears: Array.from(detectedYears).sort((a, b) => a.localeCompare(b)),
    };
  }

  function recordKeyForType(type, record) {
    if (type === "financial") {
      return [record.property, record.period, record.section, record.lineItem, record.glCode].join("::");
    }
    return [record.property, record.period].join("::");
  }

  function mergeDatasetRecords(type, existingRecords = [], incomingRecords = []) {
    const merged = new Map();
    [...existingRecords, ...incomingRecords].forEach((record) => {
      merged.set(recordKeyForType(type, record), record);
    });
    return Array.from(merged.values()).sort(
      (left, right) =>
        comparePeriod(left?.period, right?.period) ||
        String(left?.property ?? "").localeCompare(String(right?.property ?? "")),
    );
  }

  function pruneFinancialRecords(existingRecords = [], scopeOverride = AUTO_IMPORT_SCOPE, incomingRecords = []) {
    const targetEntities = new Set();
    if (scopeOverride && scopeOverride !== AUTO_IMPORT_SCOPE) {
      targetEntities.add(matchCommunityName(scopeOverride));
    }
    incomingRecords.forEach((record) => {
      if (record.property) {
        targetEntities.add(record.property);
      }
    });
    if (!targetEntities.size) {
      return existingRecords;
    }
    return existingRecords.filter((record) => !targetEntities.has(record.property));
  }

  function setDataset(type, text, fileName, sourceKind = "file", options = {}) {
    const parsed = parseDataset(type, text, fileName, options);
    parsed.sourceKind = sourceKind;
    const replaceMode = options.replaceMode || "merge";
    const shouldMerge = Boolean(options.merge);

    if (type === "financial" && state.datasets[type]?.records?.length) {
      let baseRecords = state.datasets[type].records;
      if (replaceMode === "replace_all") {
        baseRecords = [];
      } else if (replaceMode === "replace_scope") {
        baseRecords = pruneFinancialRecords(baseRecords, options.scopeOverride, parsed.records);
      }

      if (shouldMerge || replaceMode === "replace_scope" || replaceMode === "replace_all") {
        parsed.records = mergeDatasetRecords(type, baseRecords, parsed.records);
        parsed.diagnostics.parsedRows = parsed.records.length;
        parsed.diagnostics.fileRows = parsed.records.length;
      }
    } else if (shouldMerge && state.datasets[type]?.records?.length) {
      parsed.records = mergeDatasetRecords(type, state.datasets[type].records, parsed.records);
      parsed.diagnostics.parsedRows = parsed.records.length;
      parsed.diagnostics.fileRows = parsed.records.length;
      parsed.fileName = `${state.datasets[type].fileName || type}.csv + ${fileName}`;
    }
    state.datasets[type] = parsed;
    if (type === "financial" && sourceKind === "file") {
      saveFinancialHistoryStore(parsed);
    }
    persistState();
    render();
  }

  function setDatasetObject(type, dataset) {
    state.datasets[type] = dataset;
    if (type === "financial" && dataset?.records?.length && dataset.sourceKind !== "sample") {
      saveFinancialHistoryStore(dataset);
    }
    persistState();
    render();
  }

  function syncDashboardDriverDatasets() {
    state.datasets.operations = buildDashboardDataset("operations");
    state.datasets.leasing = buildDashboardDataset("leasing");
  }

  function clearState() {
    pendingApprovedBudgetFiles = [];
    state.selectedPeriod = null;
    state.selectedProperty = null;
    state.layer = "financial";
    state.pendingFinancial = null;
    state.pendingApprovedBudget = null;
    state.financialImport = {
      scope: AUTO_IMPORT_SCOPE,
      mode: "merge",
      periodMode: "csv",
      periodMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
      periodYear: String(new Date().getFullYear()),
    };
    state.approvedBudgetImport = {
      scope: "RISE Corporate",
      year: "2026",
      expandAcrossYear: true,
    };
    state.lastApprovedBudgetNotice = null;
    state.snapshotScope = {
      mode: "all",
      search: "",
      selectedEntities: [],
    };
    state.financialLineFilter = {
      period: "selected",
      glCode: "all",
      status: "all",
    };
    state.datasets = {
      financial: null,
      operations: null,
      leasing: null,
    };
    window.localStorage.removeItem(STORAGE_KEY);
    syncDashboardDriverDatasets();
    persistState();
    render();
  }

  function persistState() {
    const payload = {
      layer: state.layer,
      selectedPeriod: state.selectedPeriod,
      selectedProperty: state.selectedProperty,
      manualPeriod: state.manualPeriod,
      financialImport: state.financialImport,
      approvedBudgetImport: state.approvedBudgetImport,
      lastApprovedBudgetNotice: state.lastApprovedBudgetNotice,
      lastFinancialApplyNotice: state.lastFinancialApplyNotice,
      snapshotScope: state.snapshotScope,
      financialLineFilter: state.financialLineFilter,
      datasets: Object.fromEntries(
        Object.entries(state.datasets).map(([key, dataset]) => [
          key,
          dataset
            ? {
                fileName: dataset.fileName,
                sourceKind: dataset.sourceKind || "file",
                sourceText: dataset.sourceText || "",
                records: dataset.records || [],
                diagnostics: dataset.diagnostics || null,
              }
            : null,
        ]),
      ),
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_error) {
      // Quota errors would otherwise prevent apply/render from completing.
      state.lastFinancialApplyNotice = {
        at: new Date().toISOString(),
        kind: "error",
        message:
          "Could not save dashboard state because browser storage is full. Clear stored history or remove older uploads, then retry Apply To Ledger.",
      };
    }
  }

  function restoreState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return false;
      }
      const parsed = JSON.parse(raw);
      state.layer = parsed.layer || "financial";
      state.selectedPeriod = parsed.selectedPeriod || null;
      state.selectedProperty = parsed.selectedProperty || null;
      state.manualPeriod = parsePeriod(parsed.manualPeriod) || state.manualPeriod;
      state.lastFinancialApplyNotice = parsed.lastFinancialApplyNotice || null;
      state.lastApprovedBudgetNotice = parsed.lastApprovedBudgetNotice || null;
      if (isLegacyCdnParserErrorNotice(state.lastFinancialApplyNotice)) {
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "approved_budget",
          message: "Previous XLSX parser error cleared after build update. Re-upload the finalized budget file to test current parsing.",
        };
      }
      if (isLegacyCdnParserErrorNotice(state.lastApprovedBudgetNotice)) {
        state.lastApprovedBudgetNotice = {
          at: new Date().toISOString(),
          kind: "approved_budget",
          message: "Previous XLSX parser error cleared after build update. Re-upload the finalized budget file to test current parsing.",
        };
      }
      state.financialImport = {
        scope: parsed.financialImport?.scope || AUTO_IMPORT_SCOPE,
        mode: parsed.financialImport?.mode || "merge",
        periodMode: parsed.financialImport?.periodMode || "csv",
        periodMonth:
          parsed.financialImport?.periodMonth || String(new Date().getMonth() + 1).padStart(2, "0"),
        periodYear: parsed.financialImport?.periodYear || String(new Date().getFullYear()),
      };
      state.approvedBudgetImport = {
        scope: parsed.approvedBudgetImport?.scope || "RISE Corporate",
        year: parsed.approvedBudgetImport?.year || "2026",
        expandAcrossYear:
          parsed.approvedBudgetImport?.expandAcrossYear == null ? true : Boolean(parsed.approvedBudgetImport.expandAcrossYear),
      };
      state.snapshotScope = {
        mode: parsed.snapshotScope?.mode || "all",
        search: parsed.snapshotScope?.search || "",
        selectedEntities: Array.isArray(parsed.snapshotScope?.selectedEntities)
          ? parsed.snapshotScope.selectedEntities
          : [],
      };
      state.financialLineFilter = {
        period: parsed.financialLineFilter?.period || "selected",
        glCode: parsed.financialLineFilter?.glCode || "all",
        status: parsed.financialLineFilter?.status || "all",
      };

      for (const key of ["financial", "operations", "leasing"]) {
        const entry = parsed.datasets?.[key];
        if (!entry) {
          continue;
        }
        if (entry.sourceKind === "dashboard") {
          state.datasets[key] = buildDashboardDataset(key);
          continue;
        }
        if (Array.isArray(entry.records)) {
          state.datasets[key] = {
            type: key,
            fileName: entry.fileName || `${key}.csv`,
            sourceKind: entry.sourceKind || "file",
            sourceText: entry.sourceText || "",
            records: entry.records,
            diagnostics:
              entry.diagnostics || {
                parsedRows: entry.records.length,
                fileRows: entry.records.length,
                missingRequired: [],
                missingRecommended: [],
                detected: {},
              },
          };
          continue;
        }
        if (entry.sourceText) {
          state.datasets[key] = parseDataset(key, entry.sourceText, entry.fileName || `${key}.csv`);
        }
      }

      if (!state.datasets.financial) {
        const storedHistory = loadFinancialHistoryStore();
        const storedDataset = normalizeStoredFinancialDataset(storedHistory?.dataset, "Stored financial history");
        if (storedDataset) {
          state.datasets.financial = storedDataset;
        }
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  function latestRecordFor(records, property, asOf) {
    return records
      .filter((record) => record.property === property && record.period && comparePeriod(record.period, asOf) <= 0)
      .sort((left, right) => comparePeriod(right.period, left.period))[0];
  }

  function scoreLowerBetter(value, good, bad) {
    if (value == null) {
      return null;
    }
    if (value <= good) {
      return 100;
    }
    if (value >= bad) {
      return 0;
    }
    return Math.max(0, Math.min(100, ((bad - value) / (bad - good)) * 100));
  }

  function scoreHigherBetter(value, good, bad) {
    if (value == null) {
      return null;
    }
    if (value >= good) {
      return 100;
    }
    if (value <= bad) {
      return 0;
    }
    return Math.max(0, Math.min(100, ((value - bad) / (good - bad)) * 100));
  }

  function average(values) {
    const filtered = values.filter((value) => value != null);
    if (!filtered.length) {
      return null;
    }
    return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
  }

  function weightedAverage(entries) {
    const usable = entries.filter((entry) => entry.value != null && entry.weight > 0);
    if (!usable.length) {
      return null;
    }
    const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
    return usable.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
  }

  function formatMetricValue(metricKey, value) {
    if (value == null) {
      return "No data";
    }
    if (
      [
        "occupancyPct",
        "leasedPct",
        "concessionsPct",
        "delinquencyPct",
        "trafficToLeasePct",
      ].includes(metricKey)
    ) {
      return formatPercent(value);
    }
    if (
      ["payrollCost", "utilitiesCost", "rmCost", "payrollCostPerUnit", "utilitiesCostPerUnit", "rmCostPerUnit"].includes(
        metricKey,
      )
    ) {
      return formatCurrency(value);
    }
    return formatNumber(value, value % 1 ? 1 : 0);
  }

  function scoreClass(score) {
    if (score == null) {
      return "warn";
    }
    if (score >= 75) {
      return "good";
    }
    if (score >= 55) {
      return "warn";
    }
    return "bad";
  }

  function riskLabel(score) {
    if (score == null) {
      return "Incomplete";
    }
    if (score >= 75) {
      return "Stable";
    }
    if (score >= 55) {
      return "Watch";
    }
    return "At Risk";
  }

  function buildFinancialRollup(records, projectionMonths = null) {
    if (!records?.length) {
      return null;
    }

    const lineMap = new Map();

    for (const record of records) {
      const key = `${record.section}::${record.lineItem}`;
      const current =
        lineMap.get(key) ||
        {
          section: record.section,
          lineItem: record.lineItem,
          glCode: record.glCode,
          ytdActual: 0,
          ytdBudget: 0,
          annualBudget: 0,
        };

      current.ytdActual += record.actual;
      current.ytdBudget += record.budget;
      current.annualBudget = Math.max(current.annualBudget, record.annualBudget || 0);
      lineMap.set(key, current);
    }

    const lines = Array.from(lineMap.values()).map((line) => {
      const projection =
        projectionMonths && projectionMonths > 0 ? (line.ytdActual / projectionMonths) * 12 : null;
      const favorableVariance = isIncomeSection(line.section)
        ? line.ytdActual - line.ytdBudget
        : line.ytdBudget - line.ytdActual;

      return {
        ...line,
        projection,
        favorableVariance,
        unfavorableAmount: Math.max(0, -favorableVariance),
      };
    });

    const revenueActual = lines
      .filter((line) => isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.ytdActual, 0);
    const revenueBudget = lines
      .filter((line) => isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.ytdBudget, 0);
    const expenseActual = lines
      .filter((line) => !isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.ytdActual, 0);
    const expenseBudget = lines
      .filter((line) => !isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.ytdBudget, 0);
    const annualBudgetRevenue = lines
      .filter((line) => isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.annualBudget, 0);
    const annualBudgetExpense = lines
      .filter((line) => !isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.annualBudget, 0);

    const projectedRevenue = lines
      .filter((line) => isIncomeSection(line.section))
      .reduce((sum, line) => sum + (line.projection ?? 0), 0);
    const projectedExpense = lines
      .filter((line) => !isIncomeSection(line.section))
      .reduce((sum, line) => sum + (line.projection ?? 0), 0);

    return {
      lines,
      revenueActual,
      revenueBudget,
      expenseActual,
      expenseBudget,
      annualBudgetRevenue,
      annualBudgetExpense,
      projectedRevenue: projectionMonths ? projectedRevenue : null,
      projectedExpense: projectionMonths ? projectedExpense : null,
      noiActual: revenueActual - expenseActual,
      noiBudget: revenueBudget - expenseBudget,
      annualBudgetNoi: annualBudgetRevenue - annualBudgetExpense,
      projectedNoi: projectionMonths ? projectedRevenue - projectedExpense : null,
    };
  }

  function normalizeBudgetGlToken(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[^0-9]/g, "")
      .trim();
  }

  function normalizeBudgetLineToken(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .trim();
  }

  function approvedBudgetKeyCandidates(record, granularity = "period") {
    const property = String(record?.property ?? "").trim();
    const period = String(record?.period ?? "").trim();
    const year = period.slice(0, 4);
    const glToken = normalizeBudgetGlToken(record?.glCode);
    const lineToken = normalizeBudgetLineToken(record?.lineItem);
    const prefix = granularity === "year" ? `${property}::${year}` : `${property}::${period}`;
    const keys = [];
    if (glToken) keys.push(`${prefix}::gl:${glToken}`);
    if (lineToken) keys.push(`${prefix}::line:${lineToken}`);
    if (!keys.length) keys.push(`${prefix}::line:unknown`);
    return keys;
  }

  function buildApprovedBudgetIndex(records = [], year, property) {
    const exactIndex = new Map();
    const yearIndex = new Map();
    for (const record of records) {
      if (!record?.property || !record?.period) continue;
      if (year && !String(record.period).startsWith(String(year))) continue;
      if (property && record.property !== property) continue;
      approvedBudgetKeyCandidates(record, "period").forEach((key) => exactIndex.set(key.toLowerCase(), record));
      approvedBudgetKeyCandidates(record, "year").forEach((key) => {
        const normalizedKey = key.toLowerCase();
        const matches = yearIndex.get(normalizedKey) || [];
        matches.push(record);
        yearIndex.set(normalizedKey, matches);
      });
    }
    return { exactIndex, yearIndex };
  }

  function findApprovedBudgetMatch(record, approvedIndex) {
    if (!record || !approvedIndex) return null;
    const exactIndex = approvedIndex instanceof Map ? approvedIndex : approvedIndex.exactIndex;
    const yearIndex = approvedIndex instanceof Map ? null : approvedIndex.yearIndex;
    const exactCandidates = approvedBudgetKeyCandidates(record, "period").map((key) => key.toLowerCase());
    const exactMatch = exactCandidates.map((key) => exactIndex?.get(key)).find(Boolean);
    if (exactMatch) return exactMatch;
    const yearCandidates = approvedBudgetKeyCandidates(record, "year").map((key) => key.toLowerCase());
    for (const key of yearCandidates) {
      const matches = yearIndex?.get(key) || [];
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  function applyApprovedBudgetToRecords(records = [], approvedIndex) {
    if (!approvedIndex) {
      return records;
    }
    const exactIndex = approvedIndex instanceof Map ? approvedIndex : approvedIndex.exactIndex;
    const yearIndex = approvedIndex instanceof Map ? approvedIndex : approvedIndex.yearIndex;
    const exactSize = exactIndex?.size || 0;
    const yearSize = yearIndex?.size || 0;
    if (!exactSize && !yearSize) {
      return records;
    }
    return records.map((record) => {
      const approved = findApprovedBudgetMatch(record, approvedIndex);
      if (!approved) return record;
      return {
        ...record,
        budget: Number(approved.budget ?? record.budget ?? 0),
        annualBudget: Number(approved.annualBudget ?? record.annualBudget ?? 0),
      };
    });
  }

  function countApprovedBudgetMatches(records = [], approvedIndex) {
    if (!records.length || !approvedIndex) return 0;
    let matched = 0;
    for (const record of records) {
      if (findApprovedBudgetMatch(record, approvedIndex)) matched += 1;
    }
    return matched;
  }

  function sumApprovedBudgetNoiForPeriod(property, period) {
    if (!property || !period) return null;
    const approvedRecords = (state.approvedBudgets?.records || []).filter(
      (record) => record.property === property && record.period === period,
    );
    if (!approvedRecords.length) {
      return null;
    }
    const rollup = buildFinancialRollup(approvedRecords, 1);
    return rollup?.noiBudget ?? null;
  }

  function formatFilterGlValue(glCode) {
    const normalized = String(glCode || "").trim();
    return normalized || "unmapped";
  }

  function lineTrackStatus(line) {
    if (!line) return "off_track";
    return (line.favorableVariance ?? 0) >= 0 ? "on_track" : "off_track";
  }

  function normalizeNoiToken(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function isNoiLineItem(value) {
    const token = normalizeNoiToken(value);
    return token.includes("netoperatingincome") || token === "noi" || token.endsWith("noi");
  }

  function summarizeNoiYear(property, year, throughMonth = 12) {
    const monthValueMap = new Map();
    const approvedRows = (state.approvedBudgets?.records || []).filter(
      (row) =>
        row.property === property &&
        String(row.period || "").startsWith(`${year}-`) &&
        isNoiLineItem(row.lineItem),
    );
    approvedRows.forEach((row) => {
      monthValueMap.set(String(row.period), Number(row.budget || 0));
    });

    const benchmarkRows = (state.approvedBudgets?.benchmarks || []).filter(
      (row) =>
        row.property === property &&
        String(row.period || "").startsWith(`${year}-`) &&
        (isNoiLineItem(row.lineItem) || isNoiLineItem(row.section)),
    );
    benchmarkRows.forEach((row) => {
      const period = String(row.period || "");
      const nextValue = Number(row.amount || 0);
      if (!monthValueMap.has(period)) {
        monthValueMap.set(period, nextValue);
        return;
      }
      // If duplicate NOI rows exist, keep the larger absolute value as the stronger signal.
      const currentValue = Number(monthValueMap.get(period) || 0);
      if (Math.abs(nextValue) > Math.abs(currentValue)) {
        monthValueMap.set(period, nextValue);
      }
    });

    const months = Array.from(monthValueMap.entries()).sort((left, right) => comparePeriod(left[0], right[0]));
    const annualNoi = months.reduce((sum, [, value]) => sum + Number(value || 0), 0);
    const ytdNoi = months.reduce((sum, [period, value]) => {
      const month = Number(String(period).slice(5, 7)) || 0;
      return month > 0 && month <= throughMonth ? sum + Number(value || 0) : sum;
    }, 0);
    return {
      year: String(year),
      annualNoi,
      ytdNoi,
      monthsLoaded: months.length,
    };
  }

  function buildNoiTrendSummary(property, asOf) {
    const asOfYear = Number(String(asOf || "").slice(0, 4));
    const throughMonth = Number(String(asOf || "").slice(5, 7)) || 12;
    if (!asOfYear || !property) {
      return null;
    }
    const years = [asOfYear, asOfYear - 1, asOfYear - 2];
    const series = years.map((year) => summarizeNoiYear(property, year, throughMonth));
    const current = series[0];
    const prior = series[1];
    const twoBack = series[2];
    return {
      asOfYear: String(asOfYear),
      throughMonth,
      series,
      currentYtd: current?.monthsLoaded ? current.ytdNoi : null,
      priorYtd: prior?.monthsLoaded ? prior.ytdNoi : null,
      twoBackYtd: twoBack?.monthsLoaded ? twoBack.ytdNoi : null,
      yoyImprovement:
        current?.monthsLoaded && prior?.monthsLoaded ? current.ytdNoi - prior.ytdNoi : null,
      twoYearImprovement:
        current?.monthsLoaded && twoBack?.monthsLoaded ? current.ytdNoi - twoBack.ytdNoi : null,
    };
  }

  function buildFilteredFinancialLines(summary, asOf, overrides = {}) {
    if (!summary?.property || !asOf) {
      return {
        lines: [],
        optionPeriods: [],
        optionGlCodes: [],
        selectedPeriodLabel: "--",
        includedPeriodCount: 0,
      };
    }

    const dataset = state.datasets.financial;
    if (!dataset?.records?.length) {
      return {
        lines: [],
        optionPeriods: [],
        optionGlCodes: [],
        selectedPeriodLabel: "--",
        includedPeriodCount: 0,
      };
    }

    const selectedYear = String(asOf).slice(0, 4);
    const approvedIndex = buildApprovedBudgetIndex(state.approvedBudgets?.records || [], selectedYear, summary.property);
    const sourceRecords = applyApprovedBudgetToRecords(
      dataset.records.filter(
        (record) =>
          record.property === summary.property &&
          String(record.period || "").startsWith(selectedYear) &&
          comparePeriod(record.period, asOf) <= 0,
      ),
      approvedIndex,
    );

    const optionPeriods = Array.from(new Set(sourceRecords.map((record) => record.period).filter(Boolean))).sort(comparePeriod);
    const optionGlCodes = Array.from(
      new Set(
        sourceRecords.map((record) => formatFilterGlValue(record.glCode)).filter(Boolean),
      ),
    ).sort((left, right) => {
      if (left === "unmapped") return 1;
      if (right === "unmapped") return -1;
      return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    });

    const periodFilter = overrides.period ?? state.financialLineFilter.period ?? "selected";
    const allowedPeriods = (() => {
      if (periodFilter === "selected") return new Set([asOf]);
      if (periodFilter === "ytd") return new Set(optionPeriods);
      if (periodFilter.startsWith("period:")) return new Set([periodFilter.slice(7)]);
      return new Set(optionPeriods);
    })();

    const glFilter = overrides.glCode ?? state.financialLineFilter.glCode ?? "all";
    const statusFilter = overrides.status ?? state.financialLineFilter.status ?? "all";

    const lineMap = new Map();
    sourceRecords
      .filter((record) => allowedPeriods.has(record.period))
      .forEach((record) => {
        const key = `${record.section}::${record.lineItem}::${record.glCode || ""}`;
        const current =
          lineMap.get(key) ||
          {
            section: record.section,
            lineItem: record.lineItem,
            glCode: record.glCode || "",
            ytdActual: 0,
            ytdBudget: 0,
            annualBudget: 0,
          };
        current.ytdActual += Number(record.actual || 0);
        current.ytdBudget += Number(record.budget || 0);
        current.annualBudget = Math.max(current.annualBudget, Number(record.annualBudget || 0));
        lineMap.set(key, current);
      });

    const lines = Array.from(lineMap.values())
      .map((line) => {
        const favorableVariance = isIncomeSection(line.section)
          ? line.ytdActual - line.ytdBudget
          : line.ytdBudget - line.ytdActual;
        const unfavorableAmount = Math.max(0, -favorableVariance);
        const railWidth = Math.min(100, (unfavorableAmount / Math.max(Math.abs(line.ytdBudget), 1)) * 250);
        return {
          ...line,
          favorableVariance,
          unfavorableAmount,
          railWidth,
          status: lineTrackStatus({ favorableVariance }),
        };
      })
      .filter((line) => (glFilter === "all" ? true : formatFilterGlValue(line.glCode) === glFilter))
      .filter((line) => (statusFilter === "all" ? true : line.status === statusFilter))
      .sort((left, right) => right.unfavorableAmount - left.unfavorableAmount);

    const selectedPeriodLabel =
      periodFilter === "selected"
        ? formatPeriodLabel(asOf)
        : periodFilter === "ytd"
          ? `YTD through ${formatPeriodLabel(asOf)}`
          : periodFilter.startsWith("period:")
            ? formatPeriodLabel(periodFilter.slice(7))
            : "Filtered period";

    return {
      lines,
      optionPeriods,
      optionGlCodes,
      selectedPeriodLabel,
      includedPeriodCount: allowedPeriods.size,
    };
  }

  function buildBudgetRecommendations(summary, filteredLines) {
    const recommendations = [];
    if (summary?.financial?.projectedGap < 0 && summary.financial.remainingMonths > 0) {
      recommendations.push(
        `Close ${formatCurrency(summary.financial.projectedGap)} projected gap by improving NOI ${formatCurrency(
          summary.financial.requiredMonthlyLift,
        )} per remaining month.`,
      );
    }
    if (summary?.financial?.momNoiChange != null && summary.financial.momNoiChange < 0) {
      recommendations.push(
        `Month-over-month NOI softened ${formatCurrency(summary.financial.momNoiChange)}. Prioritize expense controls before next close.`,
      );
    }
    filteredLines
      .filter((line) => line.unfavorableAmount > 0)
      .slice(0, 3)
      .forEach((line) => {
        const bucket = `${line.section} ${line.lineItem}`.toLowerCase();
        let suggestion = "Audit posted charges and recode one-time items so recurring spend tracks true run-rate.";
        if (/payroll|overtime/.test(bucket)) {
          suggestion = "Rebalance staffing and overtime schedules; enforce weekly labor variance reviews by GL.";
        } else if (/utilit/.test(bucket)) {
          suggestion = "Review utility spikes by meter and tighten vacant-unit consumption controls.";
        } else if (/repair|maintenance|turn/.test(bucket)) {
          suggestion = "Prioritize make-ready scope discipline and pre-approve high-cost work orders before posting.";
        } else if (/concession|rent|income|bad debt|delinquency/.test(bucket)) {
          suggestion = "Protect rent collections and pricing strategy to recover NOI while limiting concession exposure.";
        }
        recommendations.push(`${line.lineItem}: ${suggestion}`);
      });
    return recommendations.slice(0, 4);
  }

  function summarizeFinancial(property, asOf) {
    const dataset = state.datasets.financial;
    if (!dataset) {
      return null;
    }

    const year = String(asOf).slice(0, 4);
    const approvedIndex = buildApprovedBudgetIndex(state.approvedBudgets?.records || [], year, property);
    const records = applyApprovedBudgetToRecords(
      dataset.records.filter(
      (record) => record.property === property && record.period.startsWith(year) && comparePeriod(record.period, asOf) <= 0,
      ),
      approvedIndex,
    );

    if (!records.length) {
      return null;
    }

    const periodsObserved = Array.from(new Set(records.map((record) => record.period))).sort(comparePeriod);
    const elapsedMonths = Number(String(asOf).slice(5, 7)) || periodsObserved.length || 1;
    const ytdRollup = buildFinancialRollup(records, elapsedMonths);
    const currentMonthRawRecords = dataset.records.filter((record) => record.property === property && record.period === asOf);
    const currentMonthBudgetMatches = countApprovedBudgetMatches(currentMonthRawRecords, approvedIndex);
    const currentMonthBudgetTotalLines = currentMonthRawRecords.length;
    const currentMonthApprovedBudgetNoi = sumApprovedBudgetNoiForPeriod(property, asOf);
    const budgetSourceLabel =
      currentMonthApprovedBudgetNoi != null ? `Approved budget library ${year}` : "Uploaded actual-vs-budget file";
    const currentMonthRollup = buildFinancialRollup(
      applyApprovedBudgetToRecords(
        currentMonthRawRecords,
        approvedIndex,
      ),
      1,
    );
    const priorMonthPeriod = shiftPeriod(asOf, -1);
    const priorMonthRollup = priorMonthPeriod
      ? buildFinancialRollup(
          applyApprovedBudgetToRecords(
            dataset.records.filter((record) => record.property === property && record.period === priorMonthPeriod),
            approvedIndex,
          ),
          1,
        )
      : null;
    const priorYearPeriod = shiftPeriod(asOf, -12);
    const priorYearRollup = priorYearPeriod
      ? buildFinancialRollup(
          applyApprovedBudgetToRecords(
            dataset.records.filter((record) => record.property === property && record.period === priorYearPeriod),
            approvedIndex,
          ),
          1,
        )
      : null;
    const priorYearBudgetNoi = priorYearPeriod ? sumApprovedBudgetNoiForPeriod(property, priorYearPeriod) : null;
    const noiTrend = buildNoiTrendSummary(property, asOf);

    const revenueActual = ytdRollup.revenueActual;
    const revenueBudget = ytdRollup.revenueBudget;
    const expenseActual = ytdRollup.expenseActual;
    const expenseBudget = ytdRollup.expenseBudget;
    const annualBudgetNoi = ytdRollup.annualBudgetNoi;
    const projectedNoi = ytdRollup.projectedNoi;
    const noiActual = ytdRollup.noiActual;
    const noiBudget = ytdRollup.noiBudget;
    const noiVariance = noiActual - noiBudget;
    const projectedGap = projectedNoi - annualBudgetNoi;
    const pacePct = noiBudget ? (noiActual / noiBudget) * 100 : 0;
    const unfavorableNoi = Math.max(0, noiBudget - noiActual);
    const unfavorableProjection = Math.max(0, annualBudgetNoi - projectedNoi);
    const remainingMonths = Math.max(12 - elapsedMonths, 0);
    const requiredMonthlyLift =
      projectedGap < 0 && remainingMonths > 0 ? Math.abs(projectedGap) / remainingMonths : 0;
    const financialScore = Math.max(
      0,
      Math.min(
        100,
        100 -
          (unfavorableNoi / Math.max(Math.abs(noiBudget), 1)) * 220 -
          (unfavorableProjection / Math.max(Math.abs(annualBudgetNoi), 1)) * 120,
      ),
    );

    return {
      lines: ytdRollup.lines.sort((left, right) => right.unfavorableAmount - left.unfavorableAmount),
      revenueActual,
      revenueBudget,
      expenseActual,
      expenseBudget,
      noiActual,
      noiBudget,
      annualBudgetNoi,
      projectedNoi,
      noiVariance,
      projectedGap,
      pacePct,
      periodsObserved,
      elapsedMonths,
      currentMonthNoi: currentMonthRollup?.noiActual ?? null,
      currentMonthBudgetNoi: currentMonthRollup?.noiBudget ?? null,
      currentMonthVariance:
        currentMonthRollup && currentMonthRollup.noiBudget != null
          ? currentMonthRollup.noiActual - currentMonthRollup.noiBudget
          : null,
      currentMonthPacePct:
        currentMonthRollup?.noiBudget ? (currentMonthRollup.noiActual / currentMonthRollup.noiBudget) * 100 : null,
      priorMonthNoi: priorMonthRollup?.noiActual ?? null,
      priorMonthLabel: priorMonthPeriod,
      priorYearNoi: priorYearRollup?.noiActual ?? null,
      priorYearLabel: priorYearPeriod,
      priorYearBudgetNoi,
      momNoiChange:
        currentMonthRollup && priorMonthRollup ? currentMonthRollup.noiActual - priorMonthRollup.noiActual : null,
      yoyNoiChange:
        currentMonthRollup && priorYearRollup ? currentMonthRollup.noiActual - priorYearRollup.noiActual : null,
      yoyBudgetNoiChange:
        currentMonthRollup && priorYearBudgetNoi != null ? currentMonthRollup.noiActual - priorYearBudgetNoi : null,
      requiredMonthlyLift,
      remainingMonths,
      score: financialScore,
      budgetSourceLabel,
      currentMonthBudgetMatches,
      currentMonthBudgetTotalLines,
      currentMonthApprovedBudgetNoi,
      noiTrend,
      noiYtdCurrent: noiTrend?.currentYtd ?? null,
      noiYtdPrior: noiTrend?.priorYtd ?? null,
      noiYtdTwoBack: noiTrend?.twoBackYtd ?? null,
      noiYoYImprovement: noiTrend?.yoyImprovement ?? null,
      noiTwoYearImprovement: noiTrend?.twoYearImprovement ?? null,
    };
  }

  function summarizeOperations(property, asOf) {
    const dataset = state.datasets.operations;
    if (!dataset) {
      return null;
    }

    const record = latestRecordFor(dataset.records, property, asOf);
    if (!record) {
      return null;
    }

    const units = record.units || null;
    const latestFinancialPeriod = state.datasets.financial?.records
      ?.filter((entry) => entry.property === property && comparePeriod(entry.period, asOf) <= 0)
      .map((entry) => entry.period)
      .sort(comparePeriod)
      .pop();
    const latestFinancialLines = latestFinancialPeriod
      ? state.datasets.financial.records.filter(
          (entry) => entry.property === property && entry.period === latestFinancialPeriod,
        )
      : [];
    const payrollFinancialLines = latestFinancialLines.filter((entry) => /payroll/i.test(entry.lineItem));
    const utilityFinancialLines = latestFinancialLines.filter((entry) => /utilit/i.test(entry.lineItem));
    const rmFinancialLines = latestFinancialLines.filter((entry) => /repair|maintenance|r&m|turn expense/i.test(entry.lineItem));
    const payrollCostFallback =
      record.payrollCost ?? (payrollFinancialLines.length ? payrollFinancialLines.reduce((sum, entry) => sum + entry.actual, 0) : null);
    const utilitiesCostFallback =
      record.utilitiesCost ?? (utilityFinancialLines.length ? utilityFinancialLines.reduce((sum, entry) => sum + entry.actual, 0) : null);
    const rmCostFallback =
      record.rmCost ?? (rmFinancialLines.length ? rmFinancialLines.reduce((sum, entry) => sum + entry.actual, 0) : null);
    const turnsPer100 = units ? (record.turns || 0) / units * 100 : null;
    const openWorkOrdersPer100 = units ? (record.openWorkOrders || 0) / units * 100 : null;
    const overtimeHoursPer100 = units ? (record.overtimeHours || 0) / units * 100 : null;
    const payrollCostPerUnit = units && payrollCostFallback != null ? payrollCostFallback / units : null;
    const utilitiesCostPerUnit = units && utilitiesCostFallback != null ? utilitiesCostFallback / units : null;
    const rmCostPerUnit = units && rmCostFallback != null ? rmCostFallback / units : null;

    const metrics = [
      {
        key: "turnsPer100",
        label: "Turns / 100 units",
        value: turnsPer100,
        targetText: "Healthy <= 4.5",
        score: scoreLowerBetter(turnsPer100, 4.5, 10),
      },
      {
        key: "openWorkOrdersPer100",
        label: "Open work orders / 100 units",
        value: openWorkOrdersPer100,
        targetText: "Healthy <= 6",
        score: scoreLowerBetter(openWorkOrdersPer100, 6, 18),
      },
      {
        key: "avgMakeReadyDays",
        label: "Average make-ready days",
        value: record.avgMakeReadyDays,
        targetText: "Healthy <= 7 days",
        score: scoreLowerBetter(record.avgMakeReadyDays, 7, 15),
      },
      {
        key: "overtimeHoursPer100",
        label: "Overtime hours / 100 units",
        value: overtimeHoursPer100,
        targetText: "Healthy <= 8",
        score: scoreLowerBetter(overtimeHoursPer100, 8, 22),
      },
      {
        key: "utilitiesCostPerUnit",
        label: "Utilities / unit",
        value: utilitiesCostPerUnit,
        targetText: "Healthy <= $70",
        score: scoreLowerBetter(utilitiesCostPerUnit, 70, 110),
      },
      {
        key: "rmCostPerUnit",
        label: "R&M / unit",
        value: rmCostPerUnit,
        targetText: "Healthy <= $55",
        score: scoreLowerBetter(rmCostPerUnit, 55, 105),
      },
      {
        key: "msoeCompletionPct",
        label: "MSOE completion",
        value: record.msoeCompletionPct,
        targetText: "Healthy >= 90%",
        score: scoreHigherBetter(record.msoeCompletionPct, 90, 70),
      },
    ];

    return {
      ...record,
      turnsPer100,
      openWorkOrdersPer100,
      overtimeHoursPer100,
      payrollCost: payrollCostFallback,
      utilitiesCost: utilitiesCostFallback,
      rmCost: rmCostFallback,
      payrollCostPerUnit,
      utilitiesCostPerUnit,
      rmCostPerUnit,
      metrics,
      score: average(metrics.map((metric) => metric.score)),
    };
  }

  function summarizeLeasing(property, asOf) {
    const dataset = state.datasets.leasing;
    if (!dataset) {
      return null;
    }

    const record = latestRecordFor(dataset.records, property, asOf);
    if (!record) {
      return null;
    }

    const conversionDenominator =
      record.tours != null && Number(record.tours) > 0 ? Number(record.tours) : record.traffic;
    const conversionNumerator =
      record.approvals != null && Number(record.approvals) >= 0 ? Number(record.approvals) : record.leases;
    const trafficToLeasePct =
      conversionDenominator && conversionNumerator != null
        ? (conversionNumerator / Math.max(conversionDenominator, 1)) * 100
        : null;
    const conversionLabel =
      record.tours != null && Number(record.tours) > 0
        ? (record.approvals != null && Number(record.approvals) >= 0 ? "Tour-to-approval" : "Tour-to-lease")
        : "Traffic-to-lease";

    const metrics = [
      {
        key: "occupancyPct",
        label: "Occupancy",
        value: record.occupancyPct,
        targetText: "Healthy >= 95%",
        score: scoreHigherBetter(record.occupancyPct, 95, 89),
      },
      {
        key: "leasedPct",
        label: "Leased %",
        value: record.leasedPct,
        targetText: "Healthy >= 97%",
        score: scoreHigherBetter(record.leasedPct, 97, 91),
      },
      {
        key: "concessionsPct",
        label: "Concessions",
        value: record.concessionsPct,
        targetText: "Healthy <= 3%",
        score: scoreLowerBetter(record.concessionsPct, 3, 7),
      },
      {
        key: "trafficToLeasePct",
        label: conversionLabel,
        value: trafficToLeasePct,
        targetText: "Healthy >= 22%",
        score: scoreHigherBetter(trafficToLeasePct, 22, 10),
      },
      {
        key: "delinquencyPct",
        label: "Delinquency",
        value: record.delinquencyPct,
        targetText: "Healthy <= 2%",
        score: scoreLowerBetter(record.delinquencyPct, 2, 5.5),
      },
    ];

    return {
      ...record,
      trafficToLeasePct,
      metrics,
      score: average(metrics.map((metric) => metric.score)),
    };
  }

  function metricByKey(summary, key) {
    if (!summary) {
      return null;
    }
    if (summary.metrics) {
      const metric = summary.metrics.find((entry) => entry.key === key);
      if (metric) {
        return metric;
      }
    }
    if (summary[key] != null) {
      return { key, value: summary[key], label: key, score: null, targetText: "" };
    }
    return null;
  }

  function buildCrosswalkRowsFromLines(lines, operations, leasing) {
    if (!lines?.length) {
      return [];
    }

    return lines
      .filter((line) => line.unfavorableAmount > 0)
      .slice(0, 5)
      .map((line) => {
        const config =
          CROSSWALKS.find((crosswalk) => crosswalk.pattern.test(line.lineItem)) ||
          CROSSWALKS.find((crosswalk) => crosswalk.pattern.test(line.section));

        const evidence = (config?.drivers || [])
          .map((driverKey) => metricByKey(driverKey.includes("Pct") || driverKey.includes("lease") ? leasing : operations, driverKey))
          .filter(Boolean)
          .map((metric) => ({
            ...metric,
            status: scoreClass(metric.score),
          }))
          .sort((left, right) => (left.score ?? 100) - (right.score ?? 100));

        const weakEvidence = evidence.filter((metric) => (metric.score ?? 100) < 70).slice(0, 3);
        const reason =
          weakEvidence.length > 0
            ? `${config?.narrative ?? "This line is linked to current operating conditions."} ${weakEvidence
                .map(
                  (metric) =>
                    `${metric.label || metric.key} is at ${formatMetricValue(metric.key, metric.value)} (${metric.targetText})`,
                )
                .join("; ")}.`
            : `${config?.narrative ?? "This line is outside budget, but the linked drivers are not materially outside threshold."}`;

        return {
          lineItem: line.lineItem,
          section: line.section,
          unfavorableAmount: line.unfavorableAmount,
          group: config?.group || "Financial",
          reason,
          evidence,
        };
      });
  }

  function buildCrosswalkRows(financial, operations, leasing) {
    if (!financial) {
      return [];
    }
    return buildCrosswalkRowsFromLines(financial.lines, operations, leasing);
  }

  function getAvailableViewPeriods() {
    const periods = new Set();
    for (const dataset of Object.values(state.datasets || {})) {
      for (const record of dataset?.records || []) {
        if (record?.period) {
          periods.add(record.period);
        }
      }
    }
    return Array.from(periods).sort(comparePeriod);
  }

  function buildPropertySummary(property, asOf) {
    const financial = summarizeFinancial(property, asOf);
    const operations = summarizeOperations(property, asOf);
    const leasing = summarizeLeasing(property, asOf);

    if (!financial && !operations && !leasing) {
      return null;
    }

    const composite = weightedAverage([
      { value: financial?.score ?? null, weight: 0.5 },
      { value: operations?.score ?? null, weight: 0.25 },
      { value: leasing?.score ?? null, weight: 0.25 },
    ]);

    const crosswalkRows = buildCrosswalkRows(financial, operations, leasing);
    const topCrosswalk = crosswalkRows[0];

    return {
      property,
      financial,
      operations,
      leasing,
      score: composite,
      risk: riskLabel(composite),
      primaryDriver:
        topCrosswalk?.lineItem ||
        ((operations?.score ?? 100) < (leasing?.score ?? 100) ? "Operational drag" : "Leasing drag"),
      crosswalkRows,
    };
  }

  function aggregatePortfolioLines(propertySummaries) {
    const lineMap = new Map();

    for (const summary of propertySummaries) {
      for (const line of summary.financial?.lines || []) {
        const current =
          lineMap.get(line.lineItem) ||
          {
            lineItem: line.lineItem,
            section: line.section,
            unfavorableAmount: 0,
          };
        current.unfavorableAmount += line.unfavorableAmount;
        lineMap.set(line.lineItem, current);
      }
    }

    return Array.from(lineMap.values()).sort((left, right) => right.unfavorableAmount - left.unfavorableAmount);
  }

  function buildPortfolioSummary(propertySummaries, asOf) {
    const financialSummaries = propertySummaries.map((summary) => summary.financial).filter(Boolean);
    const leasingSummaries = propertySummaries.map((summary) => summary.leasing).filter(Boolean);
    const operationsSummaries = propertySummaries.map((summary) => summary.operations).filter(Boolean);
    const hasFinancialData = financialSummaries.length > 0;
    const totalOperationsUnits = operationsSummaries.reduce((sum, entry) => sum + Math.max(0, Number(entry.units) || 0), 0);
    const totalTurns = operationsSummaries.reduce((sum, entry) => sum + Math.max(0, Number(entry.turns) || 0), 0);
    const remainingMonths =
      financialSummaries.find((entry) => entry.remainingMonths != null)?.remainingMonths ??
      Math.max(12 - (Number(String(asOf).slice(5, 7)) || 0), 0);

    const portfolio = {
      revenueActual: financialSummaries.reduce((sum, entry) => sum + entry.revenueActual, 0),
      revenueBudget: financialSummaries.reduce((sum, entry) => sum + entry.revenueBudget, 0),
      expenseActual: financialSummaries.reduce((sum, entry) => sum + entry.expenseActual, 0),
      expenseBudget: financialSummaries.reduce((sum, entry) => sum + entry.expenseBudget, 0),
      currentMonthNoi: financialSummaries.reduce((sum, entry) => sum + (entry.currentMonthNoi || 0), 0),
      currentMonthBudgetNoi: financialSummaries.reduce((sum, entry) => sum + (entry.currentMonthBudgetNoi || 0), 0),
      priorMonthNoi: financialSummaries.some((entry) => entry.priorMonthNoi != null)
        ? financialSummaries.reduce((sum, entry) => sum + (entry.priorMonthNoi || 0), 0)
        : null,
      priorYearNoi: financialSummaries.some((entry) => entry.priorYearNoi != null)
        ? financialSummaries.reduce((sum, entry) => sum + (entry.priorYearNoi || 0), 0)
        : null,
      priorYearBudgetNoi: financialSummaries.some((entry) => entry.priorYearBudgetNoi != null)
        ? financialSummaries.reduce((sum, entry) => sum + (entry.priorYearBudgetNoi || 0), 0)
        : null,
      projectedNoi: financialSummaries.reduce((sum, entry) => sum + entry.projectedNoi, 0),
      annualBudgetNoi: financialSummaries.reduce((sum, entry) => sum + entry.annualBudgetNoi, 0),
      requiredMonthlyLift: financialSummaries.reduce((sum, entry) => sum + (entry.requiredMonthlyLift || 0), 0),
      currentMonthBudgetMatches: financialSummaries.reduce((sum, entry) => sum + (entry.currentMonthBudgetMatches || 0), 0),
      currentMonthBudgetTotalLines: financialSummaries.reduce((sum, entry) => sum + (entry.currentMonthBudgetTotalLines || 0), 0),
      noiYtdCurrent: financialSummaries.some((entry) => entry.noiYtdCurrent != null)
        ? financialSummaries.reduce((sum, entry) => sum + (entry.noiYtdCurrent || 0), 0)
        : null,
      noiYtdPrior: financialSummaries.some((entry) => entry.noiYtdPrior != null)
        ? financialSummaries.reduce((sum, entry) => sum + (entry.noiYtdPrior || 0), 0)
        : null,
      noiYtdTwoBack: financialSummaries.some((entry) => entry.noiYtdTwoBack != null)
        ? financialSummaries.reduce((sum, entry) => sum + (entry.noiYtdTwoBack || 0), 0)
        : null,
      remainingMonths,
      priorMonthLabel: financialSummaries.find((entry) => entry.priorMonthLabel)?.priorMonthLabel || shiftPeriod(asOf, -1),
      priorYearLabel: financialSummaries.find((entry) => entry.priorYearLabel)?.priorYearLabel || shiftPeriod(asOf, -12),
      score: average(propertySummaries.map((summary) => summary.score)),
      occupancyPct: weightedAverage(
        leasingSummaries.map((entry) => ({
          value: entry.occupancyPct,
          weight: Math.max(0, Number(entry.units) || 0),
        })),
      ),
      leasedPct: weightedAverage(
        leasingSummaries.map((entry) => ({
          value: entry.leasedPct,
          weight: Math.max(0, Number(entry.units) || 0),
        })),
      ),
      delinquencyPct: weightedAverage(
        leasingSummaries.map((entry) => ({
          value: entry.delinquencyPct,
          weight: Math.max(0, Number(entry.units) || 0),
        })),
      ),
      turnsPer100: totalOperationsUnits > 0 ? (totalTurns / totalOperationsUnits) * 100 : null,
      atRiskCount: propertySummaries.filter((summary) => summary.score != null && summary.score < 55).length,
      watchCount: propertySummaries.filter((summary) => summary.score != null && summary.score >= 55 && summary.score < 75).length,
      topProperties: propertySummaries.slice(0, 3),
      topLines: aggregatePortfolioLines(propertySummaries).slice(0, 4),
      asOf,
    };

    if (hasFinancialData) {
      portfolio.noiActual = portfolio.revenueActual - portfolio.expenseActual;
      portfolio.noiBudget = portfolio.revenueBudget - portfolio.expenseBudget;
      portfolio.noiVariance = portfolio.noiActual - portfolio.noiBudget;
      portfolio.projectedGap = portfolio.projectedNoi - portfolio.annualBudgetNoi;
      portfolio.currentMonthVariance = portfolio.currentMonthNoi - portfolio.currentMonthBudgetNoi;
      portfolio.currentMonthPacePct = portfolio.currentMonthBudgetNoi
        ? (portfolio.currentMonthNoi / portfolio.currentMonthBudgetNoi) * 100
        : null;
      portfolio.momNoiChange =
        portfolio.priorMonthNoi != null ? portfolio.currentMonthNoi - portfolio.priorMonthNoi : null;
      portfolio.yoyNoiChange =
        portfolio.priorYearNoi != null ? portfolio.currentMonthNoi - portfolio.priorYearNoi : null;
      portfolio.yoyBudgetNoiChange =
        portfolio.priorYearBudgetNoi != null ? portfolio.currentMonthNoi - portfolio.priorYearBudgetNoi : null;
      portfolio.noiYoYImprovement =
        portfolio.noiYtdCurrent != null && portfolio.noiYtdPrior != null
          ? portfolio.noiYtdCurrent - portfolio.noiYtdPrior
          : null;
      portfolio.noiTwoYearImprovement =
        portfolio.noiYtdCurrent != null && portfolio.noiYtdTwoBack != null
          ? portfolio.noiYtdCurrent - portfolio.noiYtdTwoBack
          : null;
    } else {
      portfolio.revenueActual = null;
      portfolio.revenueBudget = null;
      portfolio.expenseActual = null;
      portfolio.expenseBudget = null;
      portfolio.currentMonthNoi = null;
      portfolio.currentMonthBudgetNoi = null;
      portfolio.priorMonthNoi = null;
      portfolio.priorYearNoi = null;
      portfolio.priorYearBudgetNoi = null;
      portfolio.projectedNoi = null;
      portfolio.annualBudgetNoi = null;
      portfolio.requiredMonthlyLift = null;
      portfolio.currentMonthVariance = null;
      portfolio.currentMonthPacePct = null;
      portfolio.noiActual = null;
      portfolio.noiBudget = null;
      portfolio.noiVariance = null;
      portfolio.projectedGap = null;
      portfolio.momNoiChange = null;
      portfolio.yoyNoiChange = null;
      portfolio.yoyBudgetNoiChange = null;
      portfolio.noiYtdCurrent = null;
      portfolio.noiYtdPrior = null;
      portfolio.noiYtdTwoBack = null;
      portfolio.noiYoYImprovement = null;
      portfolio.noiTwoYearImprovement = null;
      portfolio.currentMonthBudgetMatches = 0;
      portfolio.currentMonthBudgetTotalLines = 0;
      portfolio.topLines = [];
    }

    return portfolio;
  }

  function computeViewModel() {
    const availablePeriods = getAvailableViewPeriods();
    const hasAnyDataset = Object.values(state.datasets).some((dataset) => dataset?.records?.length);

    if (!availablePeriods.length || !hasAnyDataset) {
      return null;
    }

    if (!state.selectedPeriod || !availablePeriods.includes(state.selectedPeriod)) {
      state.selectedPeriod = availablePeriods[availablePeriods.length - 1];
    }

    const allProperties = getFinancialEntityNames();
    state.snapshotScope.selectedEntities = (state.snapshotScope.selectedEntities || []).filter((entity) =>
      allProperties.includes(entity),
    );

    const summaryMap = new Map(
      allProperties
        .map((property) => [property, buildPropertySummary(property, state.selectedPeriod)])
        .filter(([, summary]) => Boolean(summary)),
    );

    const scopedProperties = getScopedPropertyNames(allProperties).filter((property) => summaryMap.has(property));
    const visibleEntities = getVisibleScopeEntityNames(allProperties);

    const propertySummaries = scopedProperties
      .map((property) => summaryMap.get(property))
      .sort((left, right) => (left.score ?? 100) - (right.score ?? 100));

    if (!state.selectedProperty || !propertySummaries.find((summary) => summary.property === state.selectedProperty)) {
      state.selectedProperty = propertySummaries[0]?.property || null;
    }

    const selectedSummary = propertySummaries.find((summary) => summary.property === state.selectedProperty) || null;
    const portfolio = buildPortfolioSummary(propertySummaries, state.selectedPeriod);

    return {
      availablePeriods,
      hasFinancialData: propertySummaries.some((summary) => Boolean(summary.financial)),
      allProperties,
      scopedProperties,
      visibleEntities,
      propertySummaries,
      selectedSummary,
      portfolio,
    };
  }

  function renderCrosswalkLibrary() {
    if (!dom.crosswalkLibrary) {
      return;
    }
    dom.crosswalkLibrary.innerHTML = CROSSWALKS.map(
      (crosswalk) => `
        <div class="line-item">
          <div class="crosswalk-top">
            <div>
              <strong>${escapeHtml(crosswalk.label)}</strong>
              <span>${escapeHtml(crosswalk.group)} crosswalk</span>
            </div>
            <span class="chip ${crosswalk.group === "Leasing" ? "good" : "warn"}">${escapeHtml(crosswalk.group)}</span>
          </div>
          <div class="crosswalk-body">${escapeHtml(crosswalk.narrative)}</div>
          <div class="chip-row" style="margin-top: 10px">
            ${crosswalk.drivers
              .map((driver) => `<span class="chip">${escapeHtml(driver)}</span>`)
              .join("")}
          </div>
        </div>
      `,
    ).join("");
  }

  function renderFinancialImportWorkspace() {
    if (dom.financialImportScope && dom.financialImportScope.value !== (state.financialImport.scope || AUTO_IMPORT_SCOPE)) {
      dom.financialImportScope.value = state.financialImport.scope || AUTO_IMPORT_SCOPE;
    }
    if (dom.financialImportMode && dom.financialImportMode.value !== (state.financialImport.mode || "merge")) {
      dom.financialImportMode.value = state.financialImport.mode || "merge";
    }
    if (dom.financialPeriodMode && dom.financialPeriodMode.value !== (state.financialImport.periodMode || "csv")) {
      dom.financialPeriodMode.value = state.financialImport.periodMode || "csv";
    }
    if (dom.financialPeriodMonth && dom.financialPeriodMonth.value !== (state.financialImport.periodMonth || "01")) {
      dom.financialPeriodMonth.value = state.financialImport.periodMonth || "01";
    }
    if (dom.financialPeriodYear && dom.financialPeriodYear.value !== String(state.financialImport.periodYear || "")) {
      dom.financialPeriodYear.value = String(state.financialImport.periodYear || "");
    }

    const scopeValue = dom.financialImportScope?.value || state.financialImport.scope || AUTO_IMPORT_SCOPE;
    const modeValue = dom.financialImportMode?.value || state.financialImport.mode || "merge";
    const periodOverride = getFinancialPeriodOverride(state.financialImport);
    const coverage = getDatasetCoverage(state.datasets.financial);
    const allowedEntities = (() => {
      const allowed = new Set(getCommunityCatalog().map((community) => community.name));
      allowed.add("RISE Corporate");
      return allowed;
    })();
    const filteredCoverageProperties = coverage.properties.filter((property) => allowedEntities.has(property));
    const filteredCoverage = {
      ...coverage,
      entityCount: filteredCoverageProperties.length,
      properties: filteredCoverageProperties,
    };
    const scopeLabel = getFinancialImportScopeLabel(scopeValue);
    const modeLabel = getFinancialImportModeLabel(modeValue);
    const storedHistory = loadFinancialHistoryStore();
    const storedCoverage = getDatasetCoverage(storedHistory?.dataset);
    const stagedCount = Number(state.pendingFinancial?.dataset?.records?.length || 0);

    if (dom.financialImportWorkspaceChip) {
      dom.financialImportWorkspaceChip.className = `chip ${stagedCount ? "warn" : coverage.recordCount ? "good" : "warn"}`;
      dom.financialImportWorkspaceChip.textContent = stagedCount
        ? `${formatNumber(stagedCount)} rows staged`
        : coverage.recordCount
          ? `${formatNumber(coverage.recordCount)} rows loaded`
          : "Ready to import";
    }

    if (dom.financialImportSummary) {
      const notice = state.lastFinancialApplyNotice;
      const noticeHtml = notice?.message
        ? `<div style="margin:10px 0 0;padding:10px 12px;border-radius:12px;background:${
            notice.kind === "error" ? "var(--red-soft)" : "var(--green-soft)"
          };border:1px solid ${notice.kind === "error" ? "#e6c8c8" : "#c8dcae"};color:${
            notice.kind === "error" ? "var(--red)" : "var(--green)"
          };font-size:0.78rem">
            <strong>${notice.kind === "error" ? "Could not apply:" : "Confirmed:"}</strong> ${escapeHtml(notice.message)}
            <span style="color:var(--muted);margin-left:8px">(${escapeHtml(formatStoredTimestamp(notice.at))})</span>
          </div>`
        : "";
      dom.financialImportSummary.innerHTML = coverage.recordCount
        ? `Next financial upload will <strong>${escapeHtml(modeLabel)}</strong> and map rows to <strong>${escapeHtml(
            scopeLabel,
          )}</strong>${
            periodOverride
              ? ` with the upload period forced to <span class="mono">${escapeHtml(periodOverride)}</span>`
              : " using periods from the CSV"
          }. Current ledger covers <strong>${formatNumber(filteredCoverage.entityCount)}</strong> entities from <span class="mono">${escapeHtml(
            filteredCoverage.periodStart || "--",
          )}</span> through <span class="mono">${escapeHtml(coverage.periodEnd || "--")}</span>.`
        : `Next financial upload will <strong>${escapeHtml(modeLabel)}</strong> and map rows to <strong>${escapeHtml(
            scopeLabel,
          )}</strong>${
            periodOverride
              ? ` with the upload period forced to <span class="mono">${escapeHtml(periodOverride)}</span>`
              : " using periods from the CSV"
          }. Import financial history to unlock community ranking plus MoM and YoY pacing.`;
      dom.financialImportSummary.innerHTML += noticeHtml;
    }

    if (dom.financialImportCoverage) {
      if (!coverage.recordCount) {
        dom.financialImportCoverage.innerHTML = `
          <span class="chip">No financial ledger loaded</span>
          <span class="chip">MoM and YoY need prior periods</span>
          <span class="chip">Community ranking activates after import</span>
        `;
        return;
      }

      const visibleEntities = filteredCoverage.properties.slice(0, 4)
        .map((property) => `<span class="chip good">${escapeHtml(property)}</span>`)
        .join("");
      const overflowCount = Math.max(filteredCoverage.properties.length - 4, 0);
      dom.financialImportCoverage.innerHTML = `
        <span class="chip good">${formatNumber(filteredCoverage.entityCount)} entities</span>
        <span class="chip good">${escapeHtml(coverage.periodStart || "--")} to ${escapeHtml(coverage.periodEnd || "--")}</span>
        ${visibleEntities}
        ${overflowCount ? `<span class="chip">+${formatNumber(overflowCount)} more</span>` : ""}
      `;
    }

    if (dom.financialHistoryStatus) {
      dom.financialHistoryStatus.innerHTML = storedCoverage.recordCount
        ? `Stored ledger: <strong>${formatNumber(storedCoverage.entityCount)}</strong> entities and <strong>${formatNumber(
            storedCoverage.recordCount,
          )}</strong> rows from <span class="mono">${escapeHtml(storedCoverage.periodStart || "--")}</span> to <span class="mono">${escapeHtml(
            storedCoverage.periodEnd || "--",
          )}</span>. Last saved ${escapeHtml(formatStoredTimestamp(storedHistory?.savedAt))}.`
        : "No stored financial ledger yet. Imported file-based history will be saved locally for future trend reviews.";
    }

    if (dom.reloadFinancialHistory) {
      dom.reloadFinancialHistory.disabled = !storedCoverage.recordCount;
    }
    if (dom.clearFinancialHistory) {
      dom.clearFinancialHistory.disabled = !storedCoverage.recordCount;
    }
  }

  function renderApprovedBudgetWorkspace() {
    populateApprovedBudgetScopeOptions();
    if (dom.approvedBudgetScope && dom.approvedBudgetScope.value !== (state.approvedBudgetImport.scope || "RISE Corporate")) {
      dom.approvedBudgetScope.value = state.approvedBudgetImport.scope || "RISE Corporate";
    }
    if (dom.approvedBudgetYear) {
      const nextYear = String(state.approvedBudgetImport.year || "2026");
      if (dom.approvedBudgetYear.value !== nextYear) {
        dom.approvedBudgetYear.value = nextYear;
      }
    }
    if (dom.approvedBudgetExpandYear) {
      const mode = state.approvedBudgetImport.expandAcrossYear ? "yes" : "no";
      if (dom.approvedBudgetExpandYear.value !== mode) {
        dom.approvedBudgetExpandYear.value = mode;
      }
    }

    const coverage = getApprovedBudgetCoverage();
    const stagedRows = Number(state.pendingApprovedBudget?.dataset?.records?.length || 0);
    const selectedBudgetFileCount = Number(pendingApprovedBudgetFiles.length || state.pendingApprovedBudget?.files?.length || 0);
    if (dom.approvedBudgetChip) {
      dom.approvedBudgetChip.className = `chip ${stagedRows || selectedBudgetFileCount ? "warn" : coverage.rowCount ? "good" : ""}`;
      dom.approvedBudgetChip.textContent = stagedRows
        ? `${formatNumber(stagedRows)} budget rows staged`
        : selectedBudgetFileCount
          ? `${formatNumber(selectedBudgetFileCount)} budget file${selectedBudgetFileCount === 1 ? "" : "s"} selected`
        : coverage.rowCount
          ? `${formatNumber(coverage.rowCount)} budget rows stored`
          : "No budget staged";
    }

    if (dom.approvedBudgetSummary) {
      const yearsText = coverage.years.length ? coverage.years.join(", ") : "--";
      const benchmarkYearsText = coverage.benchmarkYears?.length ? coverage.benchmarkYears.join(", ") : "--";
      const statusText = coverage.rowCount
        ? `Approved budget library: <strong>${formatNumber(coverage.rowCount)}</strong> rows across <strong>${formatNumber(
            coverage.entityCount,
          )}</strong> entities for year(s) <span class="mono">${escapeHtml(yearsText)}</span>. Comparative rows: <span class="mono">${escapeHtml(
            benchmarkYearsText,
          )}</span>. Last updated ${escapeHtml(
            formatStoredTimestamp(coverage.updatedAt),
          )}.`
        : "No finalized budget baseline stored yet. Upload approved budgets here first, then upload monthly actuals.";
      const notice = state.lastApprovedBudgetNotice;
      const noticeText = notice?.message
        ? `<div style="margin-top:8px;padding:9px 11px;border-radius:10px;background:${
            notice.kind === "error" ? "var(--red-soft)" : "var(--green-soft)"
          };border:1px solid ${notice.kind === "error" ? "#e6c8c8" : "#c8dcae"};color:${
            notice.kind === "error" ? "var(--red)" : "var(--green)"
          };">${escapeHtml(notice.message)} <span style="color:var(--muted)">(${escapeHtml(formatStoredTimestamp(notice.at))})</span></div>`
        : "";
      dom.approvedBudgetSummary.innerHTML = `${statusText}${noticeText}`;
    }

    if (dom.approvedBudgetMeta) {
      if (stagedRows || selectedBudgetFileCount) {
        const files = state.pendingApprovedBudget?.files || [];
        const options = state.pendingApprovedBudget?.options || {};
        const detectedYears = state.pendingApprovedBudget?.detectedYears || [];
        dom.approvedBudgetMeta.innerHTML = `
          <div class="status-line">
            <strong>${stagedRows ? "Finalized budget staged" : "Finalized budget selected"}</strong><br />
            Files: ${escapeHtml(files.slice(0, 4).join(", ") || "—")}${files.length > 4 ? ` (+${formatNumber(files.length - 4)} more)` : ""}<br />
            ${stagedRows ? `Rows staged: ${formatNumber(stagedRows)} · ` : ""}Entity: <strong>${escapeHtml(options.scopeOverride || "RISE Corporate")}</strong><br />
            Budget year: <span class="mono">${escapeHtml(options.year || state.approvedBudgetImport.year || "2026")}</span> · Apply across year: <strong>${
              options.expandAcrossYear ? "Yes" : "No"
            }</strong><br />
            Comparative years detected: <span class="mono">${escapeHtml(detectedYears.join(", ") || "--")}</span>
          </div>
        `;
      } else {
        dom.approvedBudgetMeta.innerHTML = `
          <div class="status-line">
            Upload finalized budgets by entity as CSV or Excel. These rows become the source-of-truth budget baseline used when scoring monthly income statement actuals.
          </div>
        `;
      }
    }
  }

  function renderSnapshotScopeControls(view) {
    if (dom.snapshotScopeMode && dom.snapshotScopeMode.value !== (state.snapshotScope.mode || "all")) {
      dom.snapshotScopeMode.value = state.snapshotScope.mode || "all";
    }
    if (dom.snapshotEntitySearch && dom.snapshotEntitySearch.value !== (state.snapshotScope.search || "")) {
      dom.snapshotEntitySearch.value = state.snapshotScope.search || "";
    }

    if (!dom.snapshotEntityChips || !dom.snapshotScopeSummary || !dom.snapshotScopeCount) {
      return;
    }

    if (!view) {
      dom.snapshotScopeSummary.innerHTML =
        "Load financial history first, then use search and selection to switch the page between corporate, communities, or a custom combined group.";
      dom.snapshotScopeCount.textContent = "";
      dom.snapshotEntityChips.innerHTML = `<span class="filter-chip muted">No entities loaded yet</span>`;
      if (dom.snapshotSelectVisible) {
        dom.snapshotSelectVisible.disabled = true;
      }
      if (dom.snapshotClearSelection) {
        dom.snapshotClearSelection.disabled = true;
      }
      return;
    }

    const scopedCount = view.scopedProperties.length;
    const totalCount = view.allProperties.length;
    const visibleCount = view.visibleEntities.length;
    const mode = state.snapshotScope.mode || "all";
    const search = state.snapshotScope.search || "";
    const selectedSet = new Set(state.snapshotScope.selectedEntities || []);
    const scopeLabel = getSnapshotScopeLabel(mode, scopedCount);

    dom.snapshotScopeSummary.innerHTML =
      mode === "custom"
        ? scopedCount
          ? `Snapshot is currently scoped to <strong>${escapeHtml(scopeLabel)}</strong>. Search to refine and click chips to add or remove entities from the combined view.`
          : `Custom scope is active but no entities are selected. Search for communities or corporate, then click chips or use <strong>Select Visible</strong>.`
        : `Snapshot is currently scoped to <strong>${escapeHtml(scopeLabel)}</strong> with <strong>${formatNumber(
            scopedCount,
          )}</strong> of <strong>${formatNumber(totalCount)}</strong> loaded entities reflected across the page.`;

    dom.snapshotScopeCount.textContent = `${formatNumber(visibleCount)} visible · ${formatNumber(scopedCount)} in scope`;
    dom.snapshotEntityChips.innerHTML = view.visibleEntities.length
      ? view.visibleEntities
          .map((entity) => {
            const active = mode === "custom" ? selectedSet.has(entity) : view.scopedProperties.includes(entity);
            return `<button class="filter-chip ${active ? "active" : ""}" type="button" data-entity-chip="${escapeHtml(
              entity,
            )}">${escapeHtml(entity)}</button>`;
          })
          .join("")
      : `<span class="filter-chip muted">${
          search ? "No entities match this search" : "No entities available in this scope"
        }</span>`;

    if (dom.snapshotSelectVisible) {
      dom.snapshotSelectVisible.disabled = !view.visibleEntities.length;
    }
    if (dom.snapshotClearSelection) {
      dom.snapshotClearSelection.disabled = mode !== "custom" && !search;
    }
  }

  function renderUploadMeta(type) {
    const dataset = state.datasets[type];
    const chip = document.getElementById(`${type}-chip`);
    const meta = document.getElementById(`${type}-meta`);
    if (!chip || !meta) {
      return;
    }

    if (type === "financial" && state.pendingFinancial?.dataset) {
      const staged = state.pendingFinancial.dataset;
      const coverage = getDatasetCoverage(staged);
      const stagedOptions = state.pendingFinancial.options || {};
      const stagedPeriod = parsePeriod(stagedOptions.periodOverride || stagedOptions.period || state.manualPeriod);
      const stagedScopeLabel = getFinancialImportScopeLabel(stagedOptions.scopeOverride);
      const stagedModeLabel = getFinancialImportModeLabel(stagedOptions.replaceMode);
      if (chip) {
        chip.className = `chip warn`;
        chip.textContent = coverage.recordCount ? `${formatNumber(coverage.recordCount)} staged` : "Staged";
      }
      if (meta) {
        meta.innerHTML = `
          <div class="status-line">
            <strong>Staged upload ready</strong><br />
            Files: ${escapeHtml((state.pendingFinancial.files || []).slice(0, 4).join(", ") || "—")}${
              (state.pendingFinancial.files || []).length > 4 ? ` (+${formatNumber((state.pendingFinancial.files || []).length - 4)} more)` : ""
            }<br />
            Records staged: ${formatNumber(coverage.recordCount)}<br />
            Upload period: <span class="mono">${escapeHtml(stagedPeriod || "--")}</span><br />
            Scope: <strong>${escapeHtml(stagedScopeLabel)}</strong> · Mode: <strong>${escapeHtml(stagedModeLabel)}</strong><br />
            <span style="color:var(--muted)">Click <strong>Apply To Ledger</strong> to store and refresh the Portfolio Snapshot.</span>
          </div>
        `;
      }
      return;
    }

    if (!dataset) {
      chip.className = "chip";
      chip.textContent = "Awaiting file";
      meta.innerHTML = `<div class="status-line">Upload a ${FILE_SPECS[type].label.toLowerCase()} CSV or sync the dashboard history to activate this section.</div>`;
      return;
    }

    const { diagnostics } = dataset;
    const coverage = getDatasetCoverage(dataset);
    const statusClass =
      dataset.sourceKind === "dashboard"
        ? diagnostics.parsedRows > 0
          ? "good"
          : "warn"
        : diagnostics.missingRequired.length
          ? "bad"
          : "good";
    chip.className = `chip ${statusClass}`;
    chip.textContent =
      dataset.sourceKind === "dashboard"
        ? diagnostics.parsedRows > 0
          ? `${diagnostics.parsedRows} rows synced`
          : "No saved rows"
        : diagnostics.missingRequired.length
          ? `Missing ${diagnostics.missingRequired.length} required`
          : `${diagnostics.parsedRows} rows parsed`;

    const detectedTags = Object.entries(diagnostics.detected)
      .map(
        ([key, header]) =>
          `<span class="chip good">${escapeHtml(key)} → ${escapeHtml(header)}</span>`,
      )
      .join("");

    const missingRequired = diagnostics.missingRequired.length
      ? `<div class="chip-row">${diagnostics.missingRequired
          .map((field) => `<span class="chip bad">Missing ${escapeHtml(field)}</span>`)
          .join("")}</div>`
      : "";

    const missingRecommended = diagnostics.missingRecommended.length
      ? `<div class="chip-row">${diagnostics.missingRecommended
          .slice(0, 5)
          .map((field) => `<span class="chip warn">Optional ${escapeHtml(field)}</span>`)
          .join("")}</div>`
      : "";

    meta.innerHTML = `
      <div class="status-line">
        <strong>${escapeHtml(dataset.fileName || `${type}.csv`)}</strong><br />
        ${
          dataset.sourceKind === "dashboard"
            ? `Synced ${formatNumber(diagnostics.parsedRows)} row(s) from the saved operations dashboard history.`
            : dataset.sourceKind === "stored"
              ? `Loaded ${formatNumber(diagnostics.parsedRows)} row(s) from the locally stored financial history ledger.`
            : `Parsed ${formatNumber(diagnostics.parsedRows)} of ${formatNumber(
                diagnostics.fileRows || diagnostics.parsedRows,
              )} data row(s).`
        }
        ${
          coverage.recordCount
            ? `<br />Coverage: ${formatNumber(coverage.entityCount)} entities${
                coverage.periodStart && coverage.periodEnd
                  ? ` · <span class="mono">${escapeHtml(coverage.periodStart)}</span> to <span class="mono">${escapeHtml(coverage.periodEnd)}</span>`
                  : ""
              }`
            : ""
        }
      </div>
      ${missingRequired}
      ${missingRecommended}
      <div class="chip-row">${detectedTags}</div>
    `;
  }

  function renderReadiness(view) {
    if (!view) {
      const hasDashboardDrivers =
        Boolean(state.datasets.operations?.records?.length) || Boolean(state.datasets.leasing?.records?.length);
      dom.dataReadiness.innerHTML = hasDashboardDrivers
        ? "Operations and leasing history are synced from the main dashboard. Import historical financials to activate community accountability, MoM pacing, and YoY trend tracking."
        : "Sync the main dashboard history for community drivers, then import historical financials to activate pacing, trend, and recovery views.";
      if (dom.ledgerDebug) {
        const dataset = state.datasets.financial;
        const pendingCount = Number(state.pendingFinancial?.rowCount || 0);
        const pendingRecordsLen = Number(state.pendingFinancial?.dataset?.records?.length || 0);
        if (!dataset?.records?.length) {
          dom.ledgerDebug.innerHTML = `
            <span class="chip">0 ledger rows</span>
            <span class="chip">${pendingCount ? `${formatNumber(pendingCount)} staged` : "No staged upload"}</span>
            <span class="chip">${pendingRecordsLen ? `${formatNumber(pendingRecordsLen)} staged records` : "0 staged records"}</span>
            <span class="chip">${dom.applyFinancialUpload?.disabled ? "Apply disabled" : "Apply enabled"}</span>
            <span class="chip">build ${escapeHtml(BUILD_ID)}</span>
          `;
          return;
        }
        const coverage = getDatasetCoverage(dataset);
        const entities = Array.from(new Set(dataset.records.map((r) => r.property).filter(Boolean))).sort((a, b) => a.localeCompare(b));
        const periods = Array.from(new Set(dataset.records.map((r) => r.period).filter(Boolean))).sort(comparePeriod);
      dom.ledgerDebug.innerHTML = `
        <span class="chip good">${formatNumber(coverage.recordCount)} ledger rows</span>
        <span class="chip">${formatNumber(entities.length)} entities</span>
        <span class="chip">${escapeHtml(periods[0] || "--")} to ${escapeHtml(periods[periods.length - 1] || "--")}</span>
        <span class="chip">${pendingCount ? `${formatNumber(pendingCount)} staged` : "No staged upload"}</span>
        <span class="chip">${dom.applyFinancialUpload?.disabled ? "Apply disabled" : "Apply enabled"}</span>
        <span class="chip">build ${escapeHtml(BUILD_ID)}</span>
      `;
    }
      return;
    }

    const loaded = Object.entries(state.datasets)
      .filter(([, dataset]) => dataset?.records.length)
      .map(([key]) => FILE_SPECS[key].label);

    if (!view.propertySummaries.length) {
      dom.dataReadiness.innerHTML = `
        Loaded <span class="mono">${loaded.join(", ")}</span>. No entities match the current snapshot scope.
      `;
      return;
    }

    dom.dataReadiness.innerHTML = `
      Loaded <span class="mono">${loaded.join(", ")}</span>. ${formatNumber(view.propertySummaries.length)} properties in scope through
      <span class="mono">${escapeHtml(view.portfolio.asOf)}</span>. MoM is compared to
      <span class="mono">${escapeHtml(view.portfolio.priorMonthLabel || "--")}</span> and YoY to
      <span class="mono">${escapeHtml(view.portfolio.priorYearLabel || "--")}</span> when history exists.
      Approved budget mapping is currently <strong>${formatNumber(view.portfolio.currentMonthBudgetMatches || 0)}/${formatNumber(
        view.portfolio.currentMonthBudgetTotalLines || 0,
      )}</strong> current-month rows.
    `;
    if (dom.ledgerDebug) {
      const dataset = state.datasets.financial;
      const coverage = getDatasetCoverage(dataset);
      const entities = Array.from(new Set(dataset.records.map((r) => r.property).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      const periods = Array.from(new Set(dataset.records.map((r) => r.period).filter(Boolean))).sort(comparePeriod);
      const selected = state.selectedPeriod || periods[periods.length - 1] || "";
      const selectedEntity = state.snapshotScope?.mode === "corporate" ? "RISE Corporate" : state.selectedProperty || entities[0] || "";
      const selectedRows = dataset.records.filter((r) => r.period === selected && (!selectedEntity || r.property === selectedEntity));
      dom.ledgerDebug.innerHTML = `
        <span class="chip good">${formatNumber(coverage.recordCount)} ledger rows</span>
        <span class="chip">${formatNumber(entities.length)} entities</span>
        <span class="chip">${escapeHtml(periods[0] || "--")} to ${escapeHtml(periods[periods.length - 1] || "--")}</span>
        <span class="chip">${escapeHtml(selectedEntity || "--")} @ ${escapeHtml(selected || "--")} = ${formatNumber(selectedRows.length)} rows</span>
      `;
    }
  }

  function renderPeriodOptions(view) {
    const options = view
      ? view.availablePeriods
      : buildManualPeriodOptions(state.manualPeriod);
    if (!options.length) {
      dom.periodSelect.innerHTML = `<option value="">Select a period</option>`;
      return;
    }
    if (!state.selectedPeriod || !options.includes(state.selectedPeriod)) {
      state.selectedPeriod = options[options.length - 1];
    }
    dom.periodSelect.innerHTML = options
      .map(
        (period) =>
          `<option value="${escapeHtml(period)}" ${
            period === state.selectedPeriod ? "selected" : ""
          }>${escapeHtml(formatPeriodLabel(period))}</option>`,
      )
      .join("");
  }

  function renderFinancialFilterControls(view) {
    if (!dom.financialFilterPeriod || !dom.financialFilterGl || !dom.financialFilterStatus || !dom.financialFilterNote) {
      return;
    }

    if (!view?.selectedSummary) {
      dom.financialFilterPeriod.innerHTML = `<option value="selected">Selected month</option>`;
      dom.financialFilterPeriod.disabled = true;
      dom.financialFilterGl.innerHTML = `<option value="all">All GL codes</option>`;
      dom.financialFilterGl.disabled = true;
      dom.financialFilterStatus.value = "all";
      dom.financialFilterStatus.disabled = true;
      dom.financialFilterNote.textContent = "Filters will unlock after a financial entity is loaded.";
      return;
    }

    const baseFiltered = buildFilteredFinancialLines(view.selectedSummary, view.portfolio.asOf, {
      period: "ytd",
      glCode: "all",
      status: "all",
    });
    const periodOptions = baseFiltered.optionPeriods || [];
    const glOptions = baseFiltered.optionGlCodes || [];

    const validPeriodValues = new Set(["selected", "ytd", ...periodOptions.map((period) => `period:${period}`)]);
    if (!validPeriodValues.has(state.financialLineFilter.period || "")) {
      state.financialLineFilter.period = "selected";
    }
    const validGlValues = new Set(["all", ...glOptions]);
    if (!validGlValues.has(state.financialLineFilter.glCode || "")) {
      state.financialLineFilter.glCode = "all";
    }
    if (!["all", "off_track", "on_track"].includes(state.financialLineFilter.status || "")) {
      state.financialLineFilter.status = "all";
    }

    dom.financialFilterPeriod.disabled = false;
    dom.financialFilterPeriod.innerHTML = [
      `<option value="selected">Selected month (${escapeHtml(formatPeriodLabel(view.portfolio.asOf))})</option>`,
      `<option value="ytd">Year-to-date (through ${escapeHtml(formatPeriodLabel(view.portfolio.asOf))})</option>`,
      ...periodOptions.map(
        (period) => `<option value="period:${escapeHtml(period)}">Only ${escapeHtml(formatPeriodLabel(period))}</option>`,
      ),
    ].join("");
    dom.financialFilterPeriod.value = state.financialLineFilter.period || "selected";

    dom.financialFilterGl.disabled = false;
    dom.financialFilterGl.innerHTML = [
      `<option value="all">All GL codes</option>`,
      ...glOptions.map((glCode) =>
        `<option value="${escapeHtml(glCode)}">${escapeHtml(
          glCode === "unmapped" ? "Unmapped GL code" : `GL ${glCode}`,
        )}</option>`,
      ),
    ].join("");
    dom.financialFilterGl.value = state.financialLineFilter.glCode || "all";

    dom.financialFilterStatus.disabled = false;
    dom.financialFilterStatus.value = state.financialLineFilter.status || "all";

    const activeFiltered = buildFilteredFinancialLines(view.selectedSummary, view.portfolio.asOf);
    const offTrackCount = activeFiltered.lines.filter((line) => line.status === "off_track").length;
    const onTrackCount = activeFiltered.lines.filter((line) => line.status === "on_track").length;
    dom.financialFilterNote.textContent = `${view.selectedSummary.property}: ${activeFiltered.selectedPeriodLabel} · ${offTrackCount} off track · ${onTrackCount} on track`;
  }

  function renderSnapshot(view) {
    if (!view) {
      dom.snapshotGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1">
          Import a financial CSV to start building the portfolio view.
        </div>
      `;
      return;
    }

    if (!view.propertySummaries.length) {
      dom.snapshotGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1">
          No entities are in the current snapshot scope. Search for a community or corporate entity and select it to review combined trends.
        </div>
      `;
      return;
    }

    const recoveryValue =
      view.portfolio.projectedGap < 0 && view.portfolio.remainingMonths > 0
        ? formatCurrency(view.portfolio.requiredMonthlyLift)
        : "On plan";
    const budgetMatched = Number(view.portfolio.currentMonthBudgetMatches || 0);
    const budgetTotal = Number(view.portfolio.currentMonthBudgetTotalLines || 0);
    const selectedFiltered = view.selectedSummary
      ? buildFilteredFinancialLines(view.selectedSummary, view.portfolio.asOf)
      : { lines: [], selectedPeriodLabel: "--" };
    const filteredUnfavorable = selectedFiltered.lines
      .filter((line) => line.unfavorableAmount > 0)
      .reduce((sum, line) => sum + line.unfavorableAmount, 0);
    const filteredOnTrack = selectedFiltered.lines.filter((line) => line.status === "on_track").length;
    const filteredOffTrack = selectedFiltered.lines.filter((line) => line.status === "off_track").length;
    const budgetMatchText =
      budgetTotal > 0
        ? `${formatNumber(budgetMatched)} / ${formatNumber(budgetTotal)} mapped`
        : "No current-month ledger rows";
    const ytdPctVsBudget = calcPercentChange(view.portfolio.noiVariance, view.portfolio.noiBudget);
    const monthVariance = (view.portfolio.currentMonthNoi ?? 0) - (view.portfolio.currentMonthBudgetNoi ?? 0);
    const monthPctVsBudget = calcPercentChange(monthVariance, view.portfolio.currentMonthBudgetNoi);
    const projectedPctVsPlan = calcPercentChange(view.portfolio.projectedGap, view.portfolio.annualBudgetNoi);
    const momPctChange = calcPercentChange(view.portfolio.momNoiChange, view.portfolio.priorMonthNoi);
    const yoyPctChange = calcPercentChange(view.portfolio.yoyNoiChange, view.portfolio.priorYearNoi);
    const yoyBudgetPctChange = calcPercentChange(view.portfolio.yoyBudgetNoiChange, view.portfolio.priorYearBudgetNoi);
    const noiYoYPct = calcPercentChange(view.portfolio.noiYoYImprovement, view.portfolio.noiYtdPrior);
    const noiTwoYearPct = calcPercentChange(view.portfolio.noiTwoYearImprovement, view.portfolio.noiYtdTwoBack);
    const stats = [
      {
        label: "YTD NOI",
        value: formatSignedPercent(ytdPctVsBudget),
        sub: `${trendVerb(view.portfolio.noiVariance)} · ${formatCurrency(view.portfolio.noiActual)} vs budget ${formatCurrency(
          view.portfolio.noiBudget,
        )} · Δ ${formatCurrency(view.portfolio.noiVariance)}`,
      },
      {
        label: `${view.portfolio.asOf} NOI`,
        value: formatSignedPercent(monthPctVsBudget),
        sub: `${trendVerb(monthVariance)} · Actual ${formatCurrency(view.portfolio.currentMonthNoi)} vs budget ${formatCurrency(
          view.portfolio.currentMonthBudgetNoi,
        )} · Δ ${formatCurrency(monthVariance)} · Pace ${formatPercent(
          view.portfolio.currentMonthPacePct,
        )} · ${budgetMatchText}`,
      },
      {
        label: "Projected FY NOI",
        value: formatSignedPercent(projectedPctVsPlan),
        sub: `${trendVerb(
          view.portfolio.projectedGap,
        )} · Projected ${formatCurrency(view.portfolio.projectedNoi)} vs annual plan ${formatCurrency(
          view.portfolio.annualBudgetNoi,
        )} · Gap ${formatCurrency(view.portfolio.projectedGap)}`,
      },
      {
        label: "Recovery Needed / Month",
        value: recoveryValue,
        sub:
          view.portfolio.projectedGap < 0 && view.portfolio.remainingMonths > 0
            ? `${formatNumber(view.portfolio.remainingMonths)} months left to recover current gap`
            : "Current projected run-rate is on plan",
      },
      {
        label: "MoM NOI Change",
        value: formatSignedPercent(momPctChange),
        sub:
          view.portfolio.priorMonthNoi != null
            ? `${trendVerb(view.portfolio.momNoiChange)} · ${formatCurrency(view.portfolio.momNoiChange)} vs ${escapeHtml(
                view.portfolio.priorMonthLabel,
              )} actual ${formatCurrency(view.portfolio.priorMonthNoi)}`
            : "Need prior-month history",
      },
      {
        label: "YoY NOI Change",
        value: formatSignedPercent(yoyPctChange),
        sub:
          view.portfolio.priorYearNoi != null
            ? `${trendVerb(view.portfolio.yoyNoiChange)} · ${formatCurrency(view.portfolio.yoyNoiChange)} vs ${escapeHtml(
                view.portfolio.priorYearLabel,
              )} actual ${formatCurrency(view.portfolio.priorYearNoi)}`
            : view.portfolio.priorYearBudgetNoi != null
              ? `No prior actuals loaded · vs prior-year budget ${formatCurrency(view.portfolio.priorYearBudgetNoi)}`
              : "Need same-month prior-year history",
      },
      {
        label: "YoY vs Prior-Year Budget",
        value: formatSignedPercent(yoyBudgetPctChange),
        sub:
          view.portfolio.priorYearBudgetNoi != null
            ? `${trendVerb(view.portfolio.yoyBudgetNoiChange)} · Δ ${formatCurrency(
                view.portfolio.yoyBudgetNoiChange,
              )} vs ${escapeHtml(view.portfolio.priorYearLabel || "--")} budget baseline ${formatCurrency(
                view.portfolio.priorYearBudgetNoi,
              )}`
            : "Upload prior-year approved budget to unlock YoY budget tracking",
      },
      {
        label: "Avg Portfolio Score",
        value: formatNumber(view.portfolio.score, 0),
        sub: `${view.portfolio.atRiskCount} at risk · ${view.portfolio.watchCount} on watch`,
      },
      {
        label: "NOI YTD Trend (2024/2025/2026)",
        value: `${formatCurrency(view.portfolio.noiYtdTwoBack)} / ${formatCurrency(view.portfolio.noiYtdPrior)} / ${formatCurrency(
          view.portfolio.noiYtdCurrent,
        )}`,
        sub: `Through ${escapeHtml(formatPeriodLabel(view.portfolio.asOf))} using approved budget benchmark history`,
      },
      {
        label: "NOI YoY Improvement",
        value: formatSignedPercent(noiYoYPct),
        sub:
          view.portfolio.noiYoYImprovement != null
            ? `${trendVerb(view.portfolio.noiYoYImprovement)} · ${formatCurrency(
                view.portfolio.noiYoYImprovement,
              )} versus prior year YTD`
            : "Load prior-year benchmark rows to activate",
      },
      {
        label: "NOI Two-Year Improvement",
        value: formatSignedPercent(noiTwoYearPct),
        sub:
          view.portfolio.noiTwoYearImprovement != null
            ? `${trendVerb(view.portfolio.noiTwoYearImprovement)} · ${formatCurrency(
                view.portfolio.noiTwoYearImprovement,
              )} versus two-year baseline`
            : "Load two-year benchmark rows to activate",
      },
      {
        label: "Average Occupancy",
        value: formatPercent(view.portfolio.occupancyPct),
        sub: `Delinquency ${formatPercent(view.portfolio.delinquencyPct)}`,
      },
      {
        label: "Turns / 100",
        value: formatNumber(view.portfolio.turnsPer100, 1),
        sub: `Physical stress at ${escapeHtml(view.portfolio.asOf)}`,
      },
      {
        label: "Budget Baseline Status",
        value: budgetMatchText,
        sub:
          budgetMatched > 0
            ? "Current month actuals are actively comparing to approved baseline rows"
            : "Approved budget baseline is not mapped to current rows yet",
      },
      {
        label: "Filtered GL Variance",
        value: formatCurrency(-filteredUnfavorable),
        sub: `${selectedFiltered.selectedPeriodLabel} · ${formatNumber(filteredOffTrack)} off track · ${formatNumber(
          filteredOnTrack,
        )} on track`,
      },
    ];

    dom.snapshotGrid.innerHTML = stats
      .map(
        (stat) => `
          <div class="stat">
            <div class="label">${escapeHtml(stat.label)}</div>
            <div class="value">${escapeHtml(stat.value)}</div>
            <div class="sub">${escapeHtml(stat.sub)}</div>
          </div>
        `,
      )
      .join("");
  }

  function renderRanking(view) {
    if (!view?.propertySummaries.length) {
      dom.rankingBody.innerHTML = `
        <tr>
          <td colspan="8">No properties available yet.</td>
        </tr>
      `;
      return;
    }

    dom.rankingBody.innerHTML = view.propertySummaries
      .map((summary) => {
        const score = summary.score ?? 0;
        const badgeClass =
          score >= 75 ? "score-good" : score >= 55 ? "score-watch" : "score-risk";
        return `
          <tr class="clickable ${summary.property === state.selectedProperty ? "active-row" : ""}" data-property="${escapeHtml(summary.property)}">
            <td><strong>${escapeHtml(summary.property)}</strong></td>
            <td><span class="score-badge ${badgeClass}">${formatNumber(score, 0)}</span></td>
            <td>${escapeHtml(summary.risk)}</td>
            <td>${formatCurrency(summary.financial?.noiVariance)}</td>
            <td>${formatCurrency(summary.financial?.projectedGap)}</td>
            <td>${summary.leasing ? formatPercent(summary.leasing.occupancyPct) : "No data"}</td>
            <td>${summary.operations ? formatNumber(summary.operations.turnsPer100, 1) : "No data"}</td>
            <td>${escapeHtml(summary.primaryDriver)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderSelectedProperty(view) {
    const summary = view?.selectedSummary;
    if (!summary) {
      dom.selectedPropertyShell.innerHTML = `<div class="empty-state">Select an entity from the filtered scope once financial data is loaded.</div>`;
      return;
    }

    const score = summary.score ?? 0;
    const hasFinancialData = Boolean(view.hasFinancialData);
    const driverText =
      summary.crosswalkRows[0]?.reason ||
      (hasFinancialData
        ? "No crosswalk narrative available yet."
        : "Operations and leasing data are loaded for this community.");
    const detailSection = hasFinancialData
      ? `
      <div class="metric-triad">
        <div class="metric-block">
          <div class="kicker">YTD NOI</div>
          <div class="headline">${formatCurrency(summary.financial?.noiActual)}</div>
          <div class="note">Budget ${formatCurrency(summary.financial?.noiBudget)} · Variance ${formatCurrency(summary.financial?.noiVariance)}</div>
        </div>
        <div class="metric-block">
          <div class="kicker">${escapeHtml(state.selectedPeriod)} NOI</div>
          <div class="headline">${formatCurrency(summary.financial?.currentMonthNoi)}</div>
          <div class="note">
            Budget ${formatCurrency(summary.financial?.currentMonthBudgetNoi)} ·
            MoM ${formatCurrency(summary.financial?.momNoiChange)} ·
            YoY ${formatCurrency(summary.financial?.yoyNoiChange)}
            <br />
            ${escapeHtml(summary.financial?.budgetSourceLabel || "Budget source unavailable")} · ${formatNumber(
              summary.financial?.currentMonthBudgetMatches || 0,
            )}/${formatNumber(summary.financial?.currentMonthBudgetTotalLines || 0)} rows mapped
            <br />
            NOI trend YTD: 2024 ${formatCurrency(summary.financial?.noiYtdTwoBack)} · 2025 ${formatCurrency(
              summary.financial?.noiYtdPrior,
            )} · 2026 ${formatCurrency(summary.financial?.noiYtdCurrent)}
          </div>
        </div>
        <div class="metric-block">
          <div class="kicker">Recovery Path</div>
          <div class="headline">${escapeHtml(summary.primaryDriver)}</div>
          <div class="note">${
            summary.financial?.projectedGap < 0 && summary.financial?.remainingMonths > 0
              ? `Projected gap ${formatCurrency(summary.financial?.projectedGap)} · Need ${formatCurrency(summary.financial?.requiredMonthlyLift)} NOI per remaining month`
              : `Projected FY NOI ${formatCurrency(summary.financial?.projectedNoi)} vs plan ${formatCurrency(summary.financial?.annualBudgetNoi)}`
          }</div>
        </div>
      </div>
      `
      : `
      <div class="metric-triad">
        <div class="metric-block">
          <div class="kicker">Occupancy</div>
          <div class="headline">${formatPercent(summary.leasing?.occupancyPct)}</div>
          <div class="note">Leased ${formatPercent(summary.leasing?.leasedPct)} · Delinquency ${formatPercent(summary.leasing?.delinquencyPct)}</div>
        </div>
        <div class="metric-block">
          <div class="kicker">Leasing Pace</div>
          <div class="headline">${formatPercent(summary.leasing?.trafficToLeasePct)}</div>
          <div class="note">Traffic-to-lease conversion · Applications ${formatNumber(summary.leasing?.applications, 0)} · Leases ${formatNumber(
            summary.leasing?.leases,
            0,
          )}</div>
        </div>
        <div class="metric-block">
          <div class="kicker">Operations</div>
          <div class="headline">${formatNumber(summary.operations?.turnsPer100, 1)}</div>
          <div class="note">
            Turns / 100 units · Open WOs / 100 ${formatNumber(summary.operations?.openWorkOrdersPer100, 1)} · MSOE ${formatPercent(
              summary.operations?.msoeCompletionPct,
            )}
          </div>
        </div>
      </div>
      `;

    dom.selectedPropertyShell.innerHTML = `
      <div class="property-hero">
        <div class="score-ring" style="--score:${score}">
          <div class="score-ring-inner">
            <div>
              <strong>${formatNumber(score, 0)}</strong>
              <span>Score</span>
            </div>
          </div>
        </div>
        <div>
          <h2>${escapeHtml(summary.property)}</h2>
          <p>${escapeHtml(driverText)}</p>
          <div class="hero-meta">
            <span class="chip ${scoreClass(summary.financial?.score)}">Financial ${formatNumber(summary.financial?.score, 0)}</span>
            <span class="chip ${scoreClass(summary.operations?.score)}">Operations ${formatNumber(summary.operations?.score, 0)}</span>
            <span class="chip ${scoreClass(summary.leasing?.score)}">Leasing ${formatNumber(summary.leasing?.score, 0)}</span>
            <span class="chip ${score < 55 ? "bad" : score < 75 ? "warn" : "good"}">${escapeHtml(summary.risk)}</span>
          </div>
        </div>
      </div>
      ${detailSection}
    `;
  }

  function renderFinancialLayer(summary, view) {
    if (!summary?.financial) {
      return `<div class="empty-state">Financial data is required for this layer.</div>`;
    }
    const asOf = view?.portfolio?.asOf || state.selectedPeriod;
    const filtered = buildFilteredFinancialLines(summary, asOf);
    const lines = filtered.lines.slice(0, 8);
    const offTrackCount = filtered.lines.filter((line) => line.status === "off_track").length;
    const onTrackCount = filtered.lines.filter((line) => line.status === "on_track").length;
    const revenueActual = filtered.lines
      .filter((line) => isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.ytdActual, 0);
    const revenueBudget = filtered.lines
      .filter((line) => isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.ytdBudget, 0);
    const expenseActual = filtered.lines
      .filter((line) => !isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.ytdActual, 0);
    const expenseBudget = filtered.lines
      .filter((line) => !isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.ytdBudget, 0);
    const filteredNoiActual = revenueActual - expenseActual;
    const filteredNoiBudget = revenueBudget - expenseBudget;
    const filteredPace = filteredNoiBudget ? (filteredNoiActual / filteredNoiBudget) * 100 : null;
    const glFilterLabel =
      state.financialLineFilter.glCode === "all"
        ? "All GL codes"
        : state.financialLineFilter.glCode === "unmapped"
          ? "Unmapped GL code"
          : `GL ${state.financialLineFilter.glCode}`;
    const recommendations = buildBudgetRecommendations(summary, filtered.lines);

    if (!filtered.lines.length) {
      return `<div class="empty-state">No financial lines match the current month/GL/status filters.</div>`;
    }

    return `
      <div class="layer-grid">
        <div class="line-list">
          ${lines
            .map((line) => {
              const lineClass = line.favorableVariance >= 0 ? "good" : "bad";
              return `
                <div class="line-item">
                  <div class="line-top">
                    <div>
                      <strong>${escapeHtml(line.lineItem)}</strong>
                      <span>${escapeHtml(line.section)} · ${
                        line.glCode ? `GL ${escapeHtml(line.glCode)}` : "GL unmapped"
                      } · ${escapeHtml(filtered.selectedPeriodLabel)} ${formatCurrency(line.ytdActual)} vs ${formatCurrency(line.ytdBudget)}</span>
                    </div>
                    <div class="variance">
                      <div class="amt ${lineClass}">${formatCurrency(line.favorableVariance)}</div>
                      <span>Favorable variance</span>
                    </div>
                  </div>
                  <div class="rail ${lineClass === "good" ? "good" : "bad"}"><span style="width:${line.railWidth}%"></span></div>
                  <div class="metric-foot">
                    <span>${line.status === "off_track" ? "Off track" : "On track"} · ${glFilterLabel}</span>
                    <span>Annual plan ${formatCurrency(line.annualBudget)}</span>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
        <div class="line-list">
          <div class="line-item">
            <div class="line-top">
              <div>
                <strong>Accountability Summary</strong>
                <span>Core financial signals (${escapeHtml(filtered.selectedPeriodLabel)})</span>
              </div>
            </div>
            <div class="metric-list" style="margin-top:10px">
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>Revenue vs budget</strong>
                    <span>${formatCurrency(revenueActual)} vs ${formatCurrency(revenueBudget)}</span>
                  </div>
                  <strong>${formatCurrency(revenueActual - revenueBudget)}</strong>
                </div>
              </div>
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>Expense vs budget</strong>
                    <span>${formatCurrency(expenseActual)} vs ${formatCurrency(expenseBudget)}</span>
                  </div>
                  <strong>${formatCurrency(expenseBudget - expenseActual)}</strong>
                </div>
              </div>
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>NOI pace (filtered lines)</strong>
                    <span>${formatPercent(filteredPace)}</span>
                  </div>
                  <strong>${formatNumber(summary.financial.score, 0)}</strong>
                </div>
              </div>
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>${escapeHtml(filtered.selectedPeriodLabel)} NOI</strong>
                    <span>${formatCurrency(summary.financial.currentMonthNoi)} vs ${formatCurrency(summary.financial.currentMonthBudgetNoi)}</span>
                  </div>
                  <strong>${formatCurrency(summary.financial.currentMonthVariance)}</strong>
                </div>
              </div>
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>MoM / YoY actual</strong>
                    <span>${escapeHtml(summary.financial.priorMonthLabel || "--")} and ${escapeHtml(summary.financial.priorYearLabel || "--")}</span>
                  </div>
                  <strong>${formatCurrency(summary.financial.momNoiChange)} / ${formatCurrency(summary.financial.yoyNoiChange)}</strong>
                </div>
              </div>
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>YoY vs prior-year budget</strong>
                    <span>Budget baseline ${formatCurrency(summary.financial.priorYearBudgetNoi)}</span>
                  </div>
                  <strong>${formatCurrency(summary.financial.yoyBudgetNoiChange)}</strong>
                </div>
              </div>
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>Filter coverage</strong>
                    <span>${formatNumber(filtered.lines.length)} GL line(s) · ${formatNumber(filtered.includedPeriodCount)} month(s)</span>
                  </div>
                  <strong>${formatNumber(offTrackCount)} off · ${formatNumber(onTrackCount)} on</strong>
                </div>
              </div>
            </div>
            <p class="footnote" style="margin-top:12px">
              Budget source: ${escapeHtml(summary.financial.budgetSourceLabel || "Unknown")} · current-month mapping ${formatNumber(
                summary.financial.currentMonthBudgetMatches || 0,
              )}/${formatNumber(summary.financial.currentMonthBudgetTotalLines || 0)} lines.
            </p>
            <div class="crosswalk-body" style="margin-top:8px">
              <strong>Trend and recommendations:</strong>
              <ul style="margin:8px 0 0;padding-left:18px">
                ${recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderMetricLayer(metrics, title, description) {
    const visibleMetrics = (metrics || []).filter((metric) => metric.value != null);
    if (!visibleMetrics.length) {
      return `<div class="empty-state">${escapeHtml(description)}</div>`;
    }

    return `
      <div class="layer-grid">
        <div class="metric-list">
          ${visibleMetrics
            .map((metric) => {
              const score = metric.score ?? 50;
              const className = scoreClass(score);
              return `
                <div class="metric-rail">
                  <div class="metric-top">
                    <div>
                      <strong>${escapeHtml(metric.label)}</strong>
                      <span>${escapeHtml(metric.targetText)}</span>
                    </div>
                    <strong>${escapeHtml(formatMetricValue(metric.key, metric.value))}</strong>
                  </div>
                  <div class="rail ${className}"><span style="width:${Math.max(3, score)}%"></span></div>
                  <div class="metric-foot">
                    <span>${escapeHtml(title)}</span>
                    <span>Health ${formatNumber(score, 0)}</span>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
        <div class="line-item">
          <div class="line-top">
            <div>
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(description)}</span>
            </div>
          </div>
          <div class="crosswalk-body">
            Metrics on the left are scored against simple executive thresholds so the ranking model can compare service load, labor intensity,
            occupancy health, and collections pressure in the same frame as financial variance.
          </div>
        </div>
      </div>
    `;
  }

  function renderLayerContent(view) {
    const summary = view?.selectedSummary;
    if (!summary) {
      dom.layerContent.innerHTML = `<div class="empty-state">No property selected.</div>`;
      return;
    }

    if (state.layer === "financial") {
      dom.layerContent.innerHTML = renderFinancialLayer(summary, view);
      return;
    }

    if (state.layer === "operations") {
      dom.layerContent.innerHTML = renderMetricLayer(
        summary.operations?.metrics || [],
        "Operational drivers",
        "Turns, work orders, labor, and controllable spend show whether service demand is behind the budget miss.",
      );
      return;
    }

    dom.layerContent.innerHTML = renderMetricLayer(
      summary.leasing?.metrics || [],
      "Leasing drivers",
      "Occupancy, leased %, concessions, conversion, and delinquency explain the revenue side of the story.",
    );
  }

  function renderCrosswalkContent(view) {
    const summary = view?.selectedSummary;
    const asOf = view?.portfolio?.asOf || state.selectedPeriod;
    const filtered = summary ? buildFilteredFinancialLines(summary, asOf) : { lines: [] };
    const rows = summary
      ? buildCrosswalkRowsFromLines(filtered.lines, summary.operations, summary.leasing)
      : [];
    if (!rows.length) {
      dom.crosswalkContent.innerHTML = `<div class="empty-state">No unfavorable lines for the selected month/GL/status filter. Switch filters to review additional driver narratives.</div>`;
      return;
    }

    dom.crosswalkContent.innerHTML = `
      <div class="crosswalk-list">
        ${rows
          .map(
            (row) => `
              <div class="crosswalk-card">
                <div class="crosswalk-top">
                  <div>
                    <strong>${escapeHtml(row.lineItem)}</strong>
                    <span>${escapeHtml(row.group)} driver set · ${escapeHtml(filtered.selectedPeriodLabel)}</span>
                  </div>
                  <div class="variance">
                    <div class="amt bad">${formatCurrency(row.unfavorableAmount)}</div>
                    <span>Unfavorable</span>
                  </div>
                </div>
                <div class="crosswalk-body">${escapeHtml(row.reason)}</div>
                <div class="crosswalk-evidence">
                  ${row.evidence
                    .slice(0, 4)
                    .map(
                      (metric) =>
                        `<span class="chip ${metric.status}">${escapeHtml(metric.label)} ${escapeHtml(
                          formatMetricValue(metric.key, metric.value),
                        )}</span>`,
                    )
                    .join("")}
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function buildBoardSummaryBullets(view) {
    const portfolio = view.portfolio;
    const selected = view.selectedSummary;
    const hasFinancialData = Boolean(view.hasFinancialData);
    const topProps = portfolio.topProperties
      .map((summary) =>
        hasFinancialData
          ? `${summary.property} (${formatNumber(summary.score, 0)}) is ${summary.risk.toLowerCase()} with NOI variance ${formatCurrency(summary.financial?.noiVariance)} and primary pressure in ${summary.primaryDriver}.`
          : `${summary.property} (${formatNumber(summary.score, 0)}) is ${summary.risk.toLowerCase()} with ${formatPercent(summary.leasing?.occupancyPct)} occupancy, ${formatPercent(summary.leasing?.leasedPct)} leased, and primary pressure in ${summary.primaryDriver}.`,
      )
      .slice(0, 3);

    const portfolioLines = hasFinancialData
      ? portfolio.topLines
          .filter((line) => line.unfavorableAmount > 0)
          .map(
            (line) =>
              `${line.lineItem} is carrying ${formatCurrency(line.unfavorableAmount)} of unfavorable variance across the portfolio.`,
          )
          .slice(0, 3)
      : [];

    const selectedBullets = hasFinancialData
      ? [
          `${selected.property} is tracking ${formatCurrency(selected.financial?.noiVariance)} to budget with projected year-end NOI of ${formatCurrency(selected.financial?.projectedNoi)}.`,
          `${selected.property} posted ${formatCurrency(selected.financial?.currentMonthNoi)} in ${view.portfolio.asOf}, a ${formatCurrency(
            selected.financial?.momNoiChange,
          )} MoM move and ${formatCurrency(selected.financial?.yoyNoiChange)} YoY change.`,
          selected.financial?.priorYearBudgetNoi != null
            ? `${selected.property} is ${formatCurrency(selected.financial?.yoyBudgetNoiChange)} versus prior-year budget baseline (${formatCurrency(
                selected.financial?.priorYearBudgetNoi,
              )}).`
            : `Load prior-year approved budget rows for ${selected.property} to activate YoY budget baseline comparisons.`,
          selected.financial?.projectedGap < 0 && selected.financial?.remainingMonths > 0
            ? `To recover the current projected gap, ${selected.property} needs roughly ${formatCurrency(
                selected.financial?.requiredMonthlyLift,
              )} of additional NOI per remaining month.`
            : `${selected.property} is currently pacing at or above its projected annual NOI plan.`,
          selected.crosswalkRows[0]?.reason || "Upload operations and leasing data to complete the driver narrative.",
          selected.operations
            ? `Operationally, turns are ${formatNumber(selected.operations.turnsPer100, 1)} per 100 units with ${formatNumber(
                selected.operations.openWorkOrdersPer100,
                1,
              )} open work orders per 100 units.`
            : "Operational data is not loaded for the selected property.",
          selected.leasing
            ? `Leasing is at ${formatPercent(selected.leasing.occupancyPct)} occupancy, ${formatPercent(
                selected.leasing.leasedPct,
              )} leased, with delinquency at ${formatPercent(selected.leasing.delinquencyPct)}.`
            : "Leasing data is not loaded for the selected property.",
        ]
      : [
          `${selected.property} is at ${formatPercent(selected.leasing?.occupancyPct)} occupancy and ${formatPercent(selected.leasing?.leasedPct)} leased through ${view.portfolio.asOf}.`,
          selected.leasing?.trafficToLeasePct != null
            ? `${selected.property} is converting ${formatPercent(selected.leasing.trafficToLeasePct)} of traffic to leases with delinquency at ${formatPercent(selected.leasing?.delinquencyPct)}.`
            : `${selected.property} delinquency is ${formatPercent(selected.leasing?.delinquencyPct)}.`,
          selected.operations
            ? `${selected.property} is seeing ${formatNumber(selected.operations.turnsPer100, 1)} turns / 100 units and ${formatNumber(
                selected.operations.openWorkOrdersPer100,
                1,
              )} open work orders / 100 units.`
            : `Operational data is not loaded for ${selected.property}.`,
          selected.operations?.msoeCompletionPct != null
            ? `${selected.property} MSOE completion is ${formatPercent(selected.operations.msoeCompletionPct)}.`
            : `MSOE completion is not loaded for ${selected.property}.`,
          selected.crosswalkRows[0]?.reason || `Leasing and operations data are loaded for ${selected.property}, but no financial crosswalk is available yet.`,
        ];

    const portfolioBullets = hasFinancialData
      ? [
          `Portfolio NOI is ${formatCurrency(portfolio.noiActual)} against ${formatCurrency(
            portfolio.noiBudget,
          )} budget through ${portfolio.asOf}, a variance of ${formatCurrency(portfolio.noiVariance)}.`,
          `${portfolio.asOf} NOI is ${formatCurrency(portfolio.currentMonthNoi)} versus ${formatCurrency(
            portfolio.currentMonthBudgetNoi,
          )} budget, with ${formatCurrency(portfolio.momNoiChange)} MoM movement and ${formatCurrency(
            portfolio.yoyNoiChange,
          )} YoY change.`,
          portfolio.priorYearBudgetNoi != null
            ? `${portfolio.asOf} NOI is ${formatCurrency(portfolio.yoyBudgetNoiChange)} versus prior-year budget baseline ${formatCurrency(
                portfolio.priorYearBudgetNoi,
              )}.`
            : "Prior-year approved budget baseline has not been loaded for YoY budget comparisons.",
          portfolio.noiYoYImprovement != null
            ? `NOI YTD improvement is ${formatCurrency(portfolio.noiYoYImprovement)} versus last year and ${formatCurrency(
                portfolio.noiTwoYearImprovement,
              )} versus two years ago.`
            : "NOI YTD trend will populate after prior-year benchmark rows are loaded.",
          `Projected full-year NOI is ${formatCurrency(portfolio.projectedNoi)} versus annual plan of ${formatCurrency(
            portfolio.annualBudgetNoi,
          )}, creating a projected gap of ${formatCurrency(portfolio.projectedGap)}.`,
          portfolio.projectedGap < 0 && portfolio.remainingMonths > 0
            ? `Closing the current projected gap requires about ${formatCurrency(
                portfolio.requiredMonthlyLift,
              )} of NOI improvement per remaining month across the loaded portfolio.`
            : "The current projected run-rate is pacing at or above annual plan.",
          ...topProps,
          ...portfolioLines,
        ]
      : [
          `Portfolio occupancy is ${formatPercent(portfolio.occupancyPct)} with delinquency at ${formatPercent(
            portfolio.delinquencyPct,
          )} across ${formatNumber(portfolio.topProperties.length)} properties.`,
          `Portfolio operations are running at ${formatNumber(portfolio.turnsPer100, 1)} turns / 100 units.`,
          `Top communities by current score: ${portfolio.topProperties
            .slice(0, 3)
            .map((summary) => `${summary.property} (${formatNumber(summary.score, 0)})`)
            .join(", ")}.`,
          `Upload financial rows to unlock NOI, budget variance, and recovery pacing for ${portfolio.asOf}.`,
          ...topProps,
        ];

    return { portfolioBullets, selectedBullets };
  }

  function renderBoardSummary(view) {
    if (!view?.selectedSummary || !view.propertySummaries.length) {
      dom.boardSummary.innerHTML = `<div class="empty-state">Board-style summary will appear after the portfolio view is loaded.</div>`;
      return;
    }

    const { portfolioBullets, selectedBullets } = buildBoardSummaryBullets(view);

    dom.boardSummary.innerHTML = `
      <div class="summary-columns">
        <div class="summary-box">
          <h3>Portfolio talking points</h3>
          <ul>
            ${portfolioBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
          </ul>
        </div>
        <div class="summary-box">
          <h3>${escapeHtml(view.selectedSummary.property)} talking points</h3>
          <ul>
            ${selectedBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
          </ul>
        </div>
      </div>
    `;
  }

  function updateExportButtons(enabled) {
    dom.exportScorecards.disabled = !enabled;
    dom.exportSummary.disabled = !enabled;
    dom.exportReport.disabled = !enabled;
    dom.exportPptx.disabled = !enabled;
  }

  function applyFinancialRecordsToOpsStore(records = []) {
    if (!Array.isArray(records) || records.length === 0) {
      return;
    }
    const store = loadDashboardCommunityStore();
    const updatedAt = new Date().toISOString();

    for (const record of records) {
      const property = String(record?.property ?? "").trim();
      const period = String(record?.period ?? "").trim();
      if (!property || !period) continue;

      if (property === "RISE Corporate") {
        continue;
      }

      const existing = store[property];
      if (!existing) continue;
      const existingLedger = existing.financialLedger && typeof existing.financialLedger === "object" ? existing.financialLedger : {};
      const periodRows = Array.isArray(existingLedger[period]) ? existingLedger[period] : [];
      periodRows.push({
        section: String(record.section ?? ""),
        lineItem: String(record.lineItem ?? ""),
        glCode: String(record.glCode ?? ""),
        actual: Number(record.actual ?? 0),
        budget: Number(record.budget ?? 0),
        annualBudget: Number(record.annualBudget ?? 0),
        updatedAt,
      });
      existingLedger[period] = periodRows;
      store[property] = { ...existing, financialLedger: existingLedger, financialUpdatedAt: updatedAt };
    }

    try {
      const serialized = JSON.stringify(store);
      window.localStorage.setItem(COMMUNITY_STORAGE_KEY, serialized);
      window.localStorage.setItem(LEGACY_COMMUNITY_STORAGE_KEY, serialized);
    } catch (_error) {}
  }

  function applyStagedFinancialUpload() {
    try {
      const staged = state.pendingFinancial?.dataset;
      if (!staged || !Array.isArray(staged.records) || staged.records.length === 0) {
        window.alert("No staged financial upload found. Upload a CSV first.");
        return;
      }

      const options = state.pendingFinancial.options || {};
      const replaceMode = options.replaceMode || "merge";
      const scopeOverride = options.scopeOverride || AUTO_IMPORT_SCOPE;
      const periodOverride = options.periodOverride || null;

      logDebug("apply start", {
        stagedRecords: staged?.records?.length || 0,
        replaceMode,
        scopeOverride,
        periodOverride,
      });
      // Expose lightweight state for console inspection without leaking huge blobs.
      window.__riseFinancialDebug = {
        build: BUILD_ID,
        pendingRowCount: state.pendingFinancial?.rowCount || 0,
        pendingRecordsLen: state.pendingFinancial?.dataset?.records?.length || 0,
        selectedPeriod: state.selectedPeriod,
        manualPeriod: state.manualPeriod,
        importScope: scopeOverride,
        importMode: replaceMode,
        periodOverride,
        ledgerLoaded: Boolean(state.datasets.financial?.records?.length),
        ledgerRowCount: state.datasets.financial?.records?.length || 0,
      };

      const sanitizedStagedRecords = staged.records
        .map((record) => ({
          ...record,
          property: matchCommunityName(record?.property || scopeOverride),
          period: parsePeriod(record?.period) || periodOverride || state.selectedPeriod || state.manualPeriod,
        }))
        .filter((record) => Boolean(record.property) && Boolean(record.period));

      if (!sanitizedStagedRecords.length) {
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message:
            "No usable ledger rows were detected after mapping. Confirm the report has line item + actual/budget columns, and that Upload Scope is set correctly.",
        };
        persistState();
        render();
        return;
      }

      if (replaceMode === "approved_budget") {
        const approvedAt = new Date().toISOString();
        const existing = Array.isArray(state.approvedBudgets.records) ? state.approvedBudgets.records : [];
        const stagedRecords = sanitizedStagedRecords.map((record) => ({
          ...record,
          actual: 0,
          source: "approved_budget",
          updatedAt: approvedAt,
        }));

        state.approvedBudgets = {
          records: mergeDatasetRecords("financial", existing, stagedRecords).map((record) => ({
            ...record,
            actual: 0,
            source: "approved_budget",
          })),
          updatedAt: approvedAt,
        };
        persistApprovedBudgets();

        state.pendingFinancial = null;
        state.lastFinancialApplyNotice = {
          at: approvedAt,
          kind: "approved_budget",
          message: `Approved budget baseline saved: ${formatNumber(sanitizedStagedRecords.length)} rows applied to ${getFinancialImportScopeLabel(
            scopeOverride,
          )}${periodOverride ? ` for ${periodOverride}` : ""}.`,
        };
        if (periodOverride) {
          state.selectedPeriod = periodOverride;
        }
        if (scopeOverride === "RISE Corporate") {
          state.snapshotScope.mode = "corporate";
          state.snapshotScope.selectedEntities = [];
          state.selectedProperty = "RISE Corporate";
        } else if (scopeOverride && scopeOverride !== AUTO_IMPORT_SCOPE) {
          state.snapshotScope.mode = "custom";
          state.snapshotScope.selectedEntities = [matchCommunityName(scopeOverride)];
          state.selectedProperty = matchCommunityName(scopeOverride);
        }
        persistState();
        render();
        return;
      }

      let baseRecords = state.datasets.financial?.records || [];
      if (replaceMode === "replace_all") {
        baseRecords = [];
      } else if (replaceMode === "replace_scope") {
        baseRecords = pruneFinancialRecords(baseRecords, scopeOverride, sanitizedStagedRecords);
      }

      const mergedRecords = mergeDatasetRecords("financial", baseRecords, sanitizedStagedRecords);
      state.datasets.financial = {
        type: "financial",
        fileName: staged.fileName || "Financial CSV",
        sourceKind: "file",
        sourceText: "",
        records: mergedRecords,
        diagnostics: {
          parsedRows: mergedRecords.length,
          fileRows: mergedRecords.length,
          missingRequired: [],
          missingRecommended: [],
          detected: { source: "staged" },
        },
      };
      // Keep a stored ledger copy for trend comparisons across sessions.
      saveFinancialHistoryStore(state.datasets.financial);

      applyFinancialRecordsToOpsStore(sanitizedStagedRecords);

      const afterCoverage = getDatasetCoverage(state.datasets.financial);
      state.pendingFinancial = null;
      const appliedAt = new Date().toISOString();
      state.lastFinancialApplyNotice = {
        at: appliedAt,
        kind: "actuals",
        message: `Upload applied: ${formatNumber(
          sanitizedStagedRecords.length,
        )} mapped row(s) stored for ${getFinancialImportScopeLabel(scopeOverride)}${
          periodOverride ? ` (${periodOverride})` : ""
        }. Ledger now has ${formatNumber(afterCoverage.recordCount)} row(s) across ${formatNumber(
          afterCoverage.entityCount,
        )} entit${afterCoverage.entityCount === 1 ? "y" : "ies"} (${afterCoverage.periodStart || "--"} to ${
          afterCoverage.periodEnd || "--"
        }).`,
      };
      if (periodOverride) {
        state.selectedPeriod = periodOverride;
      }
      if (scopeOverride === "RISE Corporate") {
        state.snapshotScope.mode = "corporate";
        state.snapshotScope.selectedEntities = [];
        state.selectedProperty = "RISE Corporate";
      } else if (scopeOverride && scopeOverride !== AUTO_IMPORT_SCOPE) {
        state.snapshotScope.mode = "custom";
        state.snapshotScope.selectedEntities = [matchCommunityName(scopeOverride)];
        state.selectedProperty = matchCommunityName(scopeOverride);
      }
      persistState();
      render();

      // Update the debug handle post-apply.
      window.__riseFinancialDebug = {
        ...(window.__riseFinancialDebug || {}),
        appliedAt,
        ledgerLoaded: Boolean(state.datasets.financial?.records?.length),
        ledgerRowCount: state.datasets.financial?.records?.length || 0,
        ledgerEntities: afterCoverage.properties,
        ledgerPeriods: [afterCoverage.periodStart, afterCoverage.periodEnd],
      };
      logDebug("apply done", window.__riseFinancialDebug);
    } catch (error) {
      state.lastFinancialApplyNotice = {
        at: new Date().toISOString(),
        kind: "error",
        message: `Apply To Ledger failed: ${error?.message || String(error)}`,
      };
      persistState();
      render();
      window.alert(state.lastFinancialApplyNotice.message);
    }
  }

  function pruneApprovedBudgetRecords(existingRecords = [], scopeOverride = "RISE Corporate", year = "", incomingRecords = []) {
    const normalizedYear = String(year || "").trim();
    const targetEntities = new Set();
    if (scopeOverride) {
      targetEntities.add(matchCommunityName(scopeOverride));
    }
    incomingRecords.forEach((record) => {
      if (record?.property) {
        targetEntities.add(matchCommunityName(record.property));
      }
    });
    if (!targetEntities.size) {
      return existingRecords;
    }
    return existingRecords.filter((record) => {
      const sameEntity = targetEntities.has(matchCommunityName(record?.property));
      const sameYear = normalizedYear ? String(record?.period || "").startsWith(normalizedYear) : true;
      return !(sameEntity && sameYear);
    });
  }

  function mergeApprovedBudgetBenchmarks(existingRows = [], incomingRows = []) {
    const merged = new Map();
    [...(existingRows || []), ...(incomingRows || [])].forEach((row) => {
      const key = [
        matchCommunityName(row?.property || ""),
        String(row?.period || "").slice(0, 7),
        String(row?.section || "").trim().toLowerCase(),
        String(row?.lineItem || "").trim().toLowerCase(),
        String(row?.benchmarkLabel || "").trim().toLowerCase(),
      ].join("::");
      merged.set(key, {
        property: matchCommunityName(row?.property || ""),
        period: String(row?.period || "").slice(0, 7),
        year: String(row?.period || "").slice(0, 4),
        section: String(row?.section || "").trim(),
        lineItem: String(row?.lineItem || "").trim(),
        benchmarkLabel: String(row?.benchmarkLabel || "").trim(),
        amount: Number(row?.amount || 0),
        totalAmount: row?.totalAmount == null ? null : Number(row.totalAmount),
      });
    });
    return Array.from(merged.values()).sort(
      (left, right) =>
        comparePeriod(left?.period, right?.period) ||
        String(left?.property || "").localeCompare(String(right?.property || "")) ||
        String(left?.lineItem || "").localeCompare(String(right?.lineItem || "")),
    );
  }

  function pruneApprovedBudgetBenchmarks(existingRows = [], scopeOverride = "RISE Corporate", incomingRows = []) {
    const targetProperty = matchCommunityName(scopeOverride);
    const incomingYears = new Set(
      (incomingRows || [])
        .map((row) => String(row?.period || "").slice(0, 4))
        .filter((token) => /^\d{4}$/.test(token)),
    );
    return (existingRows || []).filter((row) => {
      const sameProperty = matchCommunityName(row?.property || "") === targetProperty;
      const sameYear = incomingYears.size ? incomingYears.has(String(row?.period || "").slice(0, 4)) : true;
      return !(sameProperty && sameYear);
    });
  }

  async function handleApprovedBudgetUpload(files) {
    const fileList = Array.from(files || []).filter(Boolean);
    if (!fileList.length) {
      return;
    }
    const scopeOverride = matchCommunityName(dom.approvedBudgetScope?.value || state.approvedBudgetImport.scope || "RISE Corporate");
    const parsedYear = String(Number(dom.approvedBudgetYear?.value || state.approvedBudgetImport.year || "2026") || 2026);
    const expandAcrossYear = (dom.approvedBudgetExpandYear?.value || "yes") !== "no";

    state.approvedBudgetImport.scope = scopeOverride;
    state.approvedBudgetImport.year = parsedYear;
    state.approvedBudgetImport.expandAcrossYear = expandAcrossYear;
    pendingApprovedBudgetFiles = fileList;

    state.pendingApprovedBudget = {
      dataset: null,
      benchmarkRows: [],
      detectedYears: [parsedYear],
      files: fileList.map((file) => file.name),
      options: {
        scopeOverride,
        year: parsedYear,
        expandAcrossYear,
      },
      stagedAt: new Date().toISOString(),
    };
    state.lastApprovedBudgetNotice = {
      at: new Date().toISOString(),
      kind: "approved_budget",
      message: `Selected ${formatNumber(fileList.length)} finalized budget file(s) for ${scopeOverride} (${parsedYear}). Click Apply Finalized Budget to parse and store.`,
    };
    state.lastFinancialApplyNotice = {
      at: new Date().toISOString(),
      kind: "approved_budget",
      message: `Finalized budget file ready: ${formatNumber(fileList.length)} file(s) selected for ${scopeOverride} (${parsedYear}). Click Apply Finalized Budget.`,
    };
    persistState();
    render();
  }

  async function applyStagedApprovedBudgetUpload() {
    let staged = state.pendingApprovedBudget?.dataset;
    const options = state.pendingApprovedBudget?.options || {};

    if (!staged?.records?.length && pendingApprovedBudgetFiles.length) {
      const scopeOverride = matchCommunityName(options.scopeOverride || state.approvedBudgetImport.scope || "RISE Corporate");
      const year = String(options.year || state.approvedBudgetImport.year || "2026");
      state.lastApprovedBudgetNotice = {
        at: new Date().toISOString(),
        kind: "approved_budget",
        message: `Parsing ${formatNumber(pendingApprovedBudgetFiles.length)} finalized budget file(s) for ${scopeOverride} (${year})...`,
      };
      persistState();
      render();

      try {
        const parsedStage = await parseApprovedBudgetFiles(pendingApprovedBudgetFiles, { scopeOverride, year });
        staged = parsedStage.staged;
        state.pendingApprovedBudget = {
          dataset: staged,
          benchmarkRows: parsedStage.benchmarkRows || [],
          detectedYears: parsedStage.detectedYears || [parsedStage.parsedYear],
          files: parsedStage.stagedFiles,
          options: {
            scopeOverride: parsedStage.scopeOverride,
            year: parsedStage.parsedYear,
            expandAcrossYear: Boolean(options.expandAcrossYear ?? state.approvedBudgetImport.expandAcrossYear),
          },
          stagedAt: new Date().toISOString(),
        };
        if (!staged?.records?.length) {
          state.lastApprovedBudgetNotice = {
            at: new Date().toISOString(),
            kind: "error",
            message: "Finalized budget file was read, but 0 rows mapped. Check that the workbook includes line items and monthly budget values.",
          };
          persistState();
          render();
          return;
        }
      } catch (error) {
        state.lastApprovedBudgetNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Finalized budget parse failed: ${error?.message || String(error)}`,
        };
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Finalized budget parse failed: ${error?.message || String(error)}`,
        };
        persistState();
        render();
        return;
      }
    }

    staged = state.pendingApprovedBudget?.dataset;
    if (!staged?.records?.length) {
      state.lastApprovedBudgetNotice = {
        at: new Date().toISOString(),
        kind: "error",
        message: "No finalized budget rows are staged. Upload a finalized budget first.",
      };
      state.lastFinancialApplyNotice = {
        at: new Date().toISOString(),
        kind: "error",
        message: "No finalized budget rows are staged. Upload a finalized budget first.",
      };
      persistState();
      render();
      return;
    }

    const scopeOverride = matchCommunityName(options.scopeOverride || state.approvedBudgetImport.scope || "RISE Corporate");
    const year = String(options.year || state.approvedBudgetImport.year || "2026");
    const expandAcrossYear = Boolean(options.expandAcrossYear ?? state.approvedBudgetImport.expandAcrossYear);
    const stagedBenchmarkRows = Array.isArray(state.pendingApprovedBudget?.benchmarkRows)
      ? state.pendingApprovedBudget.benchmarkRows
      : [];
    const detectedYears = Array.isArray(state.pendingApprovedBudget?.detectedYears)
      ? state.pendingApprovedBudget.detectedYears
      : [year];
    const sanitized = staged.records
      .map((record) => ({
        ...record,
        property: matchCommunityName(record?.property || scopeOverride),
        period: parsePeriod(record?.period) || `${year}-01`,
        actual: 0,
        source: "approved_budget",
        updatedAt: new Date().toISOString(),
      }))
      .filter((record) => Boolean(record.property) && Boolean(record.period));

    const uniquePeriods = Array.from(new Set(sanitized.map((record) => String(record.period).slice(0, 7)).filter(Boolean)));
    const shouldExpandAcrossYear = expandAcrossYear && uniquePeriods.length <= 1;
    const expandedRecords = shouldExpandAcrossYear
      ? sanitized.flatMap((record) =>
          Array.from({ length: 12 }, (_, monthIndex) => ({
            ...record,
            period: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
          })),
        )
      : sanitized.map((record) => ({ ...record, period: String(record.period).startsWith(year) ? record.period : `${year}-01` }));

    const existing = Array.isArray(state.approvedBudgets.records) ? state.approvedBudgets.records : [];
    const pruned = pruneApprovedBudgetRecords(existing, scopeOverride, year, expandedRecords);
    const merged = mergeDatasetRecords("financial", pruned, expandedRecords).map((record) => ({
      ...record,
      actual: 0,
      source: "approved_budget",
    }));
    const existingBenchmarks = Array.isArray(state.approvedBudgets.benchmarks) ? state.approvedBudgets.benchmarks : [];
    const sanitizedBenchmarkRows = stagedBenchmarkRows
      .map((row) => ({
        ...row,
        property: matchCommunityName(row?.property || scopeOverride),
        period: parsePeriod(row?.period),
      }))
      .filter((row) => Boolean(row.property) && Boolean(row.period));
    const prunedBenchmarks = pruneApprovedBudgetBenchmarks(existingBenchmarks, scopeOverride, sanitizedBenchmarkRows);
    const mergedBenchmarks = mergeApprovedBudgetBenchmarks(prunedBenchmarks, sanitizedBenchmarkRows);
    state.approvedBudgets = {
      records: merged,
      benchmarks: mergedBenchmarks,
      updatedAt: new Date().toISOString(),
    };
    persistApprovedBudgets();

    pendingApprovedBudgetFiles = [];
    state.pendingApprovedBudget = null;
    const coverage = getApprovedBudgetCoverage(merged);
    const ledgerRecords = Array.isArray(state.datasets.financial?.records) ? state.datasets.financial.records : [];
    const scopedLedgerRows = ledgerRecords.filter(
      (record) =>
        matchCommunityName(record?.property) === scopeOverride &&
        String(record?.period || "").startsWith(year),
    );
    const approvedIndex = buildApprovedBudgetIndex(merged, year, scopeOverride);
    const matchedRows = countApprovedBudgetMatches(scopedLedgerRows, approvedIndex);
    state.lastFinancialApplyNotice = {
      at: new Date().toISOString(),
      kind: "approved_budget",
      message: `Finalized budget applied: ${formatNumber(expandedRecords.length)} row(s) stored for ${scopeOverride} (${year}). Budget library now has ${formatNumber(
        coverage.rowCount,
      )} rows across ${formatNumber(coverage.entityCount)} entities (benchmark years: ${escapeHtml(
        (coverage.benchmarkYears || []).join(", ") || "--",
      )}). Snapshot mapping matched ${formatNumber(matchedRows)} of ${formatNumber(
        scopedLedgerRows.length,
      )} loaded ledger rows for ${scopeOverride} ${year}.`,
    };
    state.lastApprovedBudgetNotice = {
      at: new Date().toISOString(),
      kind: "approved_budget",
      message: `Finalized budget applied: ${formatNumber(expandedRecords.length)} row(s) stored for ${scopeOverride} (${year})${
        shouldExpandAcrossYear ? " across all 12 months" : ""
      }. Snapshot mapping: ${formatNumber(matchedRows)} / ${formatNumber(scopedLedgerRows.length)} rows matched. Comparative years detected: ${escapeHtml(
        (detectedYears || []).join(", "),
      )}.`,
    };
    persistState();
    render();
  }

  function render() {
    renderCrosswalkLibrary();
    renderFinancialImportWorkspace();
    renderApprovedBudgetWorkspace();
    ["financial"].forEach(renderUploadMeta);

    const view = computeViewModel();
    renderWorkspaceBridge();
    renderSnapshotScopeControls(view);
    renderPeriodOptions(view);
    renderFinancialFilterControls(view);
    if (dom.manualPeriodInput) {
      dom.manualPeriodInput.value = state.manualPeriod;
    }
    renderReadiness(view);
    renderSnapshot(view);
    renderRanking(view);
    renderSelectedProperty(view);
    renderLayerContent(view);
    renderCrosswalkContent(view);
    renderBoardSummary(view);
    updateExportButtons(Boolean(view?.propertySummaries?.length));
    if (dom.applyFinancialUpload) {
      const hasStaged = Boolean(state.pendingFinancial?.rowCount || state.pendingFinancial?.dataset?.records?.length);
      dom.applyFinancialUpload.disabled = !hasStaged;
    }
    if (dom.clearFinancialStaging) {
      dom.clearFinancialStaging.disabled = !Boolean(state.pendingFinancial);
    }
    if (dom.applyApprovedBudgetUpload) {
      dom.applyApprovedBudgetUpload.disabled = !Boolean(
        state.pendingApprovedBudget?.dataset?.records?.length || pendingApprovedBudgetFiles.length,
      );
    }
    if (dom.clearApprovedBudgetStaging) {
      dom.clearApprovedBudgetStaging.disabled = !Boolean(state.pendingApprovedBudget);
    }

    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.layer === state.layer);
    });
  }

  function downloadBlob(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 250);
  }

  function exportScorecardsCsv() {
    const view = computeViewModel();
    if (!view) {
      return;
    }
    const rows = view.propertySummaries.map((summary) => ({
      property: summary.property,
      score: formatNumber(summary.score, 0),
      risk: summary.risk,
      ytd_noi: Math.round(summary.financial?.noiActual || 0),
      budget_noi: Math.round(summary.financial?.noiBudget || 0),
      noi_variance: Math.round(summary.financial?.noiVariance || 0),
      projected_noi: Math.round(summary.financial?.projectedNoi || 0),
      projected_gap: Math.round(summary.financial?.projectedGap || 0),
      occupancy_pct: summary.leasing?.occupancyPct != null ? summary.leasing.occupancyPct.toFixed(1) : "",
      leased_pct: summary.leasing?.leasedPct != null ? summary.leasing.leasedPct.toFixed(1) : "",
      delinquency_pct: summary.leasing?.delinquencyPct != null ? summary.leasing.delinquencyPct.toFixed(1) : "",
      turns_per_100: summary.operations?.turnsPer100 != null ? summary.operations.turnsPer100.toFixed(1) : "",
      open_work_orders_per_100:
        summary.operations?.openWorkOrdersPer100 != null ? summary.operations.openWorkOrdersPer100.toFixed(1) : "",
      primary_driver: summary.primaryDriver,
    }));
    const csv = toCsv(
      [
        "property",
        "score",
        "risk",
        "ytd_noi",
        "budget_noi",
        "noi_variance",
        "projected_noi",
        "projected_gap",
        "occupancy_pct",
        "leased_pct",
        "delinquency_pct",
        "turns_per_100",
        "open_work_orders_per_100",
        "primary_driver",
      ],
      rows,
    );
    downloadBlob(`atlas_property_scorecards_${view.portfolio.asOf}.csv`, csv, "text/csv");
  }

  function buildSummaryText(view) {
    const { portfolioBullets, selectedBullets } = buildBoardSummaryBullets(view);
    return [
      `RISE Executive Accountability Summary`,
      `As of ${view.portfolio.asOf}`,
      ``,
      `Portfolio`,
      ...portfolioBullets.map((bullet) => `- ${bullet}`),
      ``,
      `${view.selectedSummary.property}`,
      ...selectedBullets.map((bullet) => `- ${bullet}`),
      ``,
      `Top crosswalks`,
      ...view.selectedSummary.crosswalkRows.map(
        (row) => `- ${row.lineItem}: ${formatCurrency(row.unfavorableAmount)} unfavorable. ${row.reason}`,
      ),
    ].join("\n");
  }

  function exportBoardSummary() {
    const view = computeViewModel();
    if (!view) {
      return;
    }
    downloadBlob(`atlas_board_summary_${view.portfolio.asOf}.txt`, buildSummaryText(view), "text/plain");
  }

  function buildOwnershipReportHtml(view) {
    const { portfolioBullets, selectedBullets } = buildBoardSummaryBullets(view);
    const hasFinancialData = Boolean(view.hasFinancialData);
    const rankingRows = view.propertySummaries
      .map((summary) =>
        hasFinancialData
          ? `
          <tr>
            <td>${escapeHtml(summary.property)}</td>
            <td>${formatNumber(summary.score, 0)}</td>
            <td>${escapeHtml(summary.risk)}</td>
            <td>${formatCurrency(summary.financial?.noiVariance)}</td>
            <td>${formatCurrency(summary.financial?.projectedGap)}</td>
            <td>${summary.leasing ? formatPercent(summary.leasing.occupancyPct) : "No data"}</td>
            <td>${escapeHtml(summary.primaryDriver)}</td>
          </tr>
        `
          : `
          <tr>
            <td>${escapeHtml(summary.property)}</td>
            <td>${formatNumber(summary.score, 0)}</td>
            <td>${escapeHtml(summary.risk)}</td>
            <td>${summary.leasing ? formatPercent(summary.leasing.occupancyPct) : "No data"}</td>
            <td>${summary.leasing ? formatPercent(summary.leasing.leasedPct) : "No data"}</td>
            <td>${summary.operations ? formatNumber(summary.operations.turnsPer100, 1) : "No data"}</td>
            <td>${escapeHtml(summary.primaryDriver)}</td>
          </tr>
        `,
      )
      .join("");

    const reportTitle = hasFinancialData ? "RISE Executive Accountability Ownership Report" : "ATLAS RISE Community Progress Report";
    const reportIntro = hasFinancialData
      ? `This report summarizes current financial performance, scorecard context, and driver narratives for the selected portfolio snapshot.`
      : `This report summarizes the uploaded operations and leasing data for the selected community snapshot. Financial rows are not loaded yet, so the report emphasizes occupancy, leasing, turns, and delinquency instead of NOI.`;
    const titleMetrics = hasFinancialData
      ? [
          { label: "YTD NOI", value: formatCurrency(view.portfolio.noiActual) },
          { label: "Budget NOI", value: formatCurrency(view.portfolio.noiBudget) },
          { label: "Projected NOI", value: formatCurrency(view.portfolio.projectedNoi) },
          { label: "Avg Portfolio Score", value: formatNumber(view.portfolio.score, 0) },
        ]
      : [
          { label: "Average Occupancy", value: formatPercent(view.portfolio.occupancyPct) },
          { label: "Average Leased", value: formatPercent(view.portfolio.leasedPct) },
          { label: "Turns / 100", value: formatNumber(view.portfolio.turnsPer100, 1) },
          { label: "Avg Portfolio Score", value: formatNumber(view.portfolio.score, 0) },
        ];
    const rankingHeaders = hasFinancialData
      ? ["Property", "Score", "Risk", "NOI Var", "Proj Gap", "Occ", "Primary Driver"]
      : ["Property", "Score", "Risk", "Occupancy", "Leased", "Turns / 100", "Primary Driver"];

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(reportTitle)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 28px; color: #1f2937; }
            h1, h2, h3 { margin: 0 0 10px; color: #17324a; }
            p { margin: 0 0 12px; line-height: 1.5; }
            .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
            .card { border: 1px solid #d9dde1; border-radius: 12px; padding: 14px; }
            .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
            .value { font-size: 24px; font-weight: 700; margin-top: 6px; }
            table { width: 100%; border-collapse: collapse; margin-top: 14px; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 10px 8px; text-align: left; font-size: 12px; }
            th { text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; font-size: 11px; }
            ul { margin: 10px 0 0; padding-left: 18px; }
            li { margin: 0 0 8px; line-height: 1.5; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(reportTitle)}</h1>
          <p>As of ${escapeHtml(view.portfolio.asOf)}</p>
          <p>${escapeHtml(reportIntro)}</p>

          <div class="grid">
            ${titleMetrics
              .map(
                (card) => `
              <div class="card"><div class="label">${escapeHtml(card.label)}</div><div class="value">${escapeHtml(card.value)}</div></div>
            `,
              )
              .join("")}
          </div>

          <h2>Portfolio summary</h2>
          <ul>${portfolioBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>

          <h2>${escapeHtml(view.selectedSummary.property)} detail</h2>
          <ul>${selectedBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>

          <h2>Property ranking</h2>
          <table>
            <thead>
              <tr>
                ${rankingHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}
              </tr>
            </thead>
            <tbody>${rankingRows}</tbody>
          </table>
        </body>
      </html>
    `;
  }

  function exportOwnershipReport() {
    const view = computeViewModel();
    if (!view) {
      return;
    }
    downloadBlob(
      `atlas_ownership_report_${view.portfolio.asOf}.html`,
      buildOwnershipReportHtml(view),
      "text/html",
    );
  }

  async function exportBoardDeck() {
    const view = computeViewModel();
    if (!view) {
      return;
    }

    const PptxCtor = window.PptxGenJS?.default || window.PptxGenJS || window.pptxgen?.default || window.pptxgen;
    if (!PptxCtor) {
      window.alert("The PPTX library did not load in this browser session.");
      return;
    }

    const pptx = new PptxCtor();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "ATLAS RISE Ops Dashboard";
    pptx.company = "ATLAS RISE";
    pptx.subject = `Executive Accountability ${view.portfolio.asOf}`;
    pptx.title = "RISE Executive Accountability Workbench";

    const slide1 = pptx.addSlide();
    slide1.background = { color: "F5F5F3" };
    slide1.addText("RISE Executive Accountability", {
      x: 0.55,
      y: 0.45,
      w: 5.6,
      h: 0.5,
      fontFace: "Aptos",
      fontSize: 24,
      bold: true,
      color: "17324A",
    });
    slide1.addText(`As of ${view.portfolio.asOf}`, {
      x: 0.55,
      y: 0.98,
      w: 2.2,
      h: 0.3,
      fontSize: 11,
      color: "64748B",
    });

    const headlineMetrics = [
      ["YTD NOI", formatCurrency(view.portfolio.noiActual)],
      ["Budget NOI", formatCurrency(view.portfolio.noiBudget)],
      ["Projected NOI", formatCurrency(view.portfolio.projectedNoi)],
      ["Avg Score", formatNumber(view.portfolio.score, 0)],
    ];

    headlineMetrics.forEach(([label, value], index) => {
      const x = 0.55 + index * 3.05;
      slide1.addShape(pptx.ShapeType.roundRect, {
        x,
        y: 1.45,
        w: 2.75,
        h: 1.05,
        rectRadius: 0.08,
        fill: { color: "FFFFFF" },
        line: { color: "D8DEE3" },
      });
      slide1.addText(label, {
        x: x + 0.15,
        y: 1.63,
        w: 2.3,
        h: 0.2,
        fontSize: 10,
        color: "64748B",
      });
      slide1.addText(value, {
        x: x + 0.15,
        y: 1.92,
        w: 2.3,
        h: 0.32,
        fontSize: 18,
        bold: true,
        color: "17324A",
      });
    });

    slide1.addText("Portfolio talking points", {
      x: 0.55,
      y: 2.9,
      w: 3,
      h: 0.25,
      fontSize: 14,
      bold: true,
      color: "17324A",
    });
    slide1.addText(buildBoardSummaryBullets(view).portfolioBullets.map((bullet) => ({ text: bullet, options: { bullet: { indent: 14 } } })), {
      x: 0.65,
      y: 3.25,
      w: 5.75,
      h: 3.0,
      fontSize: 10,
      color: "243443",
      breakLine: true,
      margin: 0.06,
    });

    slide1.addText("Selected property", {
      x: 6.8,
      y: 2.9,
      w: 2.5,
      h: 0.25,
      fontSize: 14,
      bold: true,
      color: "17324A",
    });
    slide1.addText(
      `${view.selectedSummary.property}\nScore ${formatNumber(view.selectedSummary.score, 0)} · ${view.selectedSummary.risk}\nNOI variance ${formatCurrency(
        view.selectedSummary.financial?.noiVariance,
      )}\nProjected gap ${formatCurrency(view.selectedSummary.financial?.projectedGap)}\nPrimary driver ${view.selectedSummary.primaryDriver}`,
      {
        x: 6.9,
        y: 3.25,
        w: 5.2,
        h: 1.55,
        fontSize: 12,
        color: "243443",
        bold: false,
      },
    );

    slide1.addText(buildBoardSummaryBullets(view).selectedBullets.map((bullet) => ({ text: bullet, options: { bullet: { indent: 14 } } })), {
      x: 6.9,
      y: 4.95,
      w: 5.2,
      h: 1.7,
      fontSize: 10,
      color: "243443",
      breakLine: true,
      margin: 0.06,
    });

    const slide2 = pptx.addSlide();
    slide2.background = { color: "F5F5F3" };
    slide2.addText("Property ranking and scorecards", {
      x: 0.55,
      y: 0.45,
      w: 5.8,
      h: 0.35,
      fontSize: 22,
      bold: true,
      color: "17324A",
    });

    const tableRows = [
      [
        { text: "Property", options: { bold: true, color: "17324A" } },
        { text: "Score", options: { bold: true, color: "17324A" } },
        { text: "Risk", options: { bold: true, color: "17324A" } },
        { text: "NOI Var", options: { bold: true, color: "17324A" } },
        { text: "Proj Gap", options: { bold: true, color: "17324A" } },
        { text: "Primary Driver", options: { bold: true, color: "17324A" } },
      ],
      ...view.propertySummaries.map((summary) => [
        summary.property,
        formatNumber(summary.score, 0),
        summary.risk,
        formatCurrency(summary.financial?.noiVariance),
        formatCurrency(summary.financial?.projectedGap),
        summary.primaryDriver,
      ]),
    ];

    slide2.addTable(tableRows, {
      x: 0.55,
      y: 1.1,
      w: 12.1,
      h: 4.3,
      border: { color: "D8DEE3", pt: 1 },
      fill: "FFFFFF",
      fontFace: "Aptos",
      fontSize: 10,
      margin: 0.06,
      rowH: 0.42,
      colW: [2.3, 0.85, 1.0, 1.4, 1.4, 4.8],
    });

    const slide3 = pptx.addSlide();
    slide3.background = { color: "F5F5F3" };
    slide3.addText("Why it is off budget", {
      x: 0.55,
      y: 0.45,
      w: 4.2,
      h: 0.35,
      fontSize: 22,
      bold: true,
      color: "17324A",
    });
    slide3.addText(`${view.selectedSummary.property} crosswalks`, {
      x: 0.55,
      y: 0.92,
      w: 3.5,
      h: 0.25,
      fontSize: 12,
      color: "64748B",
    });

    view.selectedSummary.crosswalkRows.slice(0, 4).forEach((row, index) => {
      const top = 1.35 + index * 1.25;
      slide3.addShape(pptx.ShapeType.roundRect, {
        x: 0.55,
        y: top,
        w: 12.1,
        h: 0.95,
        rectRadius: 0.05,
        fill: { color: "FFFFFF" },
        line: { color: "D8DEE3" },
      });
      slide3.addText(`${row.lineItem} · ${formatCurrency(row.unfavorableAmount)} unfavorable`, {
        x: 0.75,
        y: top + 0.12,
        w: 4.9,
        h: 0.18,
        fontSize: 12,
        bold: true,
        color: "17324A",
      });
      slide3.addText(row.reason, {
        x: 0.75,
        y: top + 0.36,
        w: 10.9,
        h: 0.35,
        fontSize: 9.5,
        color: "243443",
      });
    });

    await pptx.writeFile({ fileName: `atlas_executive_accountability_${view.portfolio.asOf}.pptx` });
  }

  async function handleDatasetUpload(type, files) {
    const fileList = Array.from(files || []).filter(Boolean);
    if (!fileList.length) {
      return;
    }

    if (type !== "financial") {
      return;
    }

    const scopeOverride = dom.financialImportScope?.value || state.financialImport.scope || AUTO_IMPORT_SCOPE;
    const replaceMode = dom.financialImportMode?.value || state.financialImport.mode || "merge";
    const manualPeriodOverride = dom.manualPeriodInput?.value || state.manualPeriod;
    const periodOverride =
      getFinancialPeriodOverride({
        ...state.financialImport,
        periodMode: dom.financialPeriodMode?.value || state.financialImport.periodMode || "csv",
        periodMonth: dom.financialPeriodMonth?.value || state.financialImport.periodMonth,
        periodYear: dom.financialPeriodYear?.value || state.financialImport.periodYear,
      }) || null;

    // Persist the most recent backfill selection so the next upload behaves consistently.
    state.financialImport.periodMode = dom.financialPeriodMode?.value || state.financialImport.periodMode || "csv";
    state.financialImport.periodMonth = dom.financialPeriodMonth?.value || state.financialImport.periodMonth;
    state.financialImport.periodYear = Number(dom.financialPeriodYear?.value || state.financialImport.periodYear || "") || state.financialImport.periodYear;

    let staged = state.pendingFinancial?.dataset || null;
    const stagedFiles = state.pendingFinancial?.files ? [...state.pendingFinancial.files] : [];
    let stagedRowCount = state.pendingFinancial?.rowCount || 0;

    state.lastFinancialApplyNotice = {
      at: new Date().toISOString(),
      kind: "actuals",
      message: `Reading ${formatNumber(fileList.length)} file(s)…`,
    };
    persistState();
    render();

    for (const file of fileList) {
      const { rows, sourceText } = await readFileToRows(file, {
        scopeOverride,
        periodOverride,
        period: manualPeriodOverride,
      });
      const parsed = parseDatasetFromRows("financial", rows, file.name, {
        scopeOverride,
        replaceMode,
        period: manualPeriodOverride,
        sourceText,
        periodOverride,
      });
      staged = staged
        ? {
            ...parsed,
            fileName: `${staged.fileName || "staged"} + ${parsed.fileName || file.name}`,
            sourceKind: "staged",
            records: mergeDatasetRecords("financial", staged.records || [], parsed.records || []),
            diagnostics: {
              ...(parsed.diagnostics || {}),
              parsedRows: (staged.records?.length || 0) + (parsed.records?.length || 0),
              fileRows: (staged.records?.length || 0) + (parsed.records?.length || 0),
            },
          }
        : {
            ...parsed,
            sourceKind: "staged",
          };
      stagedFiles.push(file.name);
      stagedRowCount += parsed.records?.length || 0;
    }

    state.pendingFinancial = {
      dataset: staged,
      files: stagedFiles,
      rowCount: stagedRowCount,
      options: { scopeOverride, replaceMode, period: manualPeriodOverride, periodOverride },
      stagedAt: new Date().toISOString(),
    };
    state.lastFinancialApplyNotice = {
      at: new Date().toISOString(),
      kind: staged?.records?.length ? "actuals" : "error",
      message: staged?.records?.length
        ? `Staged ${formatNumber(staged.records.length)} row(s). Click Apply To Ledger.`
        : "Upload read completed, but 0 rows were mapped. Check that the file contains Account Name, Actual, and Budget columns.",
    };
    persistState();
    render();

    // Belt + suspenders: ensure the Apply button becomes clickable immediately after staging,
    // even if some downstream render code changes.
    if (dom.applyFinancialUpload) {
      dom.applyFinancialUpload.disabled = false;
    }
    if (dom.clearFinancialStaging) {
      dom.clearFinancialStaging.disabled = false;
    }
  }

  function loadStoredFinancialHistoryIntoPage() {
    const storedHistory = loadFinancialHistoryStore();
    const storedDataset = normalizeStoredFinancialDataset(storedHistory?.dataset, "Stored financial history");
    if (!storedDataset) {
      render();
      return;
    }
    state.datasets.financial = storedDataset;
    persistState();
    render();
  }

  function bindDropzone(type) {
    const dropzone = document.getElementById(`${type}-dropzone`);
    const input = document.getElementById(`${type}-input`);
    if (!dropzone || !input) {
      state.lastFinancialApplyNotice = {
        at: new Date().toISOString(),
        kind: "error",
        message: `Upload controls missing in DOM for ${type}. Refresh the page.`,
      };
      persistState();
      return;
    }

    if (type === "financial") {
      try {
        input.accept = `${CSV_AND_EXCEL_FILE_ACCEPT},.pdf,application/pdf`;
      } catch (_error) {}
    }

    input.addEventListener("change", (event) => {
      logDebug("input change", type, event?.target?.files?.length || 0);
      try {
        const fileNames = Array.from(event?.target?.files || [])
          .map((file) => file?.name)
          .filter(Boolean);
        if (fileNames.length) {
          dropzone.querySelector("strong").textContent = `Selected: ${fileNames.slice(0, 2).join(", ")}${fileNames.length > 2 ? ` (+${fileNames.length - 2} more)` : ""}`;
        }
      } catch (_error) {}
      Promise.resolve(handleDatasetUpload(type, event.target.files || [])).catch((error) => {
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Upload failed: ${error?.message || String(error)}`,
        };
        persistState();
        render();
        window.alert(state.lastFinancialApplyNotice.message);
      });
      // Allow re-selecting the same file twice (browser won't fire change otherwise).
      try {
        event.target.value = "";
      } catch (_error) {}
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add("dragging");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.remove("dragging");
      });
    });

    dropzone.addEventListener("drop", (event) => {
      const files = event.dataTransfer?.files || [];
      logDebug("drop", type, files?.length || 0);
      try {
        const fileNames = Array.from(files || [])
          .map((file) => file?.name)
          .filter(Boolean);
        if (fileNames.length) {
          dropzone.querySelector("strong").textContent = `Dropped: ${fileNames.slice(0, 2).join(", ")}${fileNames.length > 2 ? ` (+${fileNames.length - 2} more)` : ""}`;
        }
      } catch (_error) {}
      Promise.resolve(handleDatasetUpload(type, files)).catch((error) => {
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Upload failed: ${error?.message || String(error)}`,
        };
        persistState();
        render();
        window.alert(state.lastFinancialApplyNotice.message);
      });
    });
  }

  function bindApprovedBudgetDropzone() {
    const dropzone = document.getElementById("approved-budget-dropzone");
    const input = dom.approvedBudgetInput;
    if (!dropzone || !input) {
      return;
    }

    try {
      input.accept = CSV_AND_EXCEL_FILE_ACCEPT;
      const strong = dropzone.querySelector("strong");
      const hint = dropzone.querySelector("span");
      if (strong) {
        strong.textContent = "Drop or choose finalized budget CSV or Excel files";
      }
      if (hint) {
        hint.textContent = "Supports .csv, .xlsx, .xls, and .xlsm. Use the finalized budget export with line items and monthly budget values.";
      }
    } catch (_error) {}

    input.addEventListener("change", (event) => {
      try {
        const fileNames = Array.from(event?.target?.files || [])
          .map((file) => file?.name)
          .filter(Boolean);
        if (fileNames.length) {
          dropzone.querySelector("strong").textContent = `Selected: ${fileNames.slice(0, 2).join(", ")}${fileNames.length > 2 ? ` (+${fileNames.length - 2} more)` : ""}`;
        }
      } catch (_error) {}
      Promise.resolve(handleApprovedBudgetUpload(event.target.files || [])).catch((error) => {
        state.lastApprovedBudgetNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Finalized budget upload failed: ${error?.message || String(error)}`,
        };
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Finalized budget upload failed: ${error?.message || String(error)}`,
        };
        persistState();
        render();
      });
      try {
        event.target.value = "";
      } catch (_error) {}
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add("dragging");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.remove("dragging");
      });
    });

    dropzone.addEventListener("drop", (event) => {
      const files = event.dataTransfer?.files || [];
      try {
        const fileNames = Array.from(files || [])
          .map((file) => file?.name)
          .filter(Boolean);
        if (fileNames.length) {
          dropzone.querySelector("strong").textContent = `Dropped: ${fileNames.slice(0, 2).join(", ")}${fileNames.length > 2 ? ` (+${fileNames.length - 2} more)` : ""}`;
        }
      } catch (_error) {}
      Promise.resolve(handleApprovedBudgetUpload(files)).catch((error) => {
        state.lastApprovedBudgetNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Finalized budget upload failed: ${error?.message || String(error)}`,
        };
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Finalized budget upload failed: ${error?.message || String(error)}`,
        };
        persistState();
        render();
      });
    });
  }

  function bindEvents() {
    applySupportedFileAcceptAttributes();
    populateFinancialImportScopeOptions();
    populateApprovedBudgetScopeOptions();
    if (dom.financialImportMode) {
      dom.financialImportMode.value = state.financialImport.mode || "merge";
    }
    if (dom.financialPeriodMode) {
      dom.financialPeriodMode.value = state.financialImport.periodMode || "csv";
    }
    if (dom.financialPeriodMonth) {
      dom.financialPeriodMonth.value = state.financialImport.periodMonth || String(new Date().getMonth() + 1).padStart(2, "0");
    }
    if (dom.financialPeriodYear) {
      dom.financialPeriodYear.value = String(state.financialImport.periodYear || new Date().getFullYear());
    }
    if (dom.snapshotScopeMode) {
      dom.snapshotScopeMode.value = state.snapshotScope.mode || "all";
    }
    if (dom.snapshotEntitySearch) {
      dom.snapshotEntitySearch.value = state.snapshotScope.search || "";
    }

    bindDropzone("financial");
    bindApprovedBudgetDropzone();

    // Make the import workspace act as a drop target too, so it's obvious the page is "alive".
    const importWorkspace = document.querySelector(".import-workspace");
    if (importWorkspace) {
      ["dragenter", "dragover"].forEach((eventName) => {
        importWorkspace.addEventListener(eventName, (event) => {
          event.preventDefault();
          importWorkspace.classList.add("dragging");
        });
      });
      ["dragleave", "drop"].forEach((eventName) => {
        importWorkspace.addEventListener(eventName, (event) => {
          event.preventDefault();
          importWorkspace.classList.remove("dragging");
        });
      });
      importWorkspace.addEventListener("drop", (event) => {
        const files = event.dataTransfer?.files || [];
        if (files?.length) {
          Promise.resolve(handleDatasetUpload("financial", files)).catch((error) => {
            state.lastFinancialApplyNotice = {
              at: new Date().toISOString(),
              kind: "error",
              message: `Upload failed: ${error?.message || String(error)}`,
            };
            persistState();
            render();
            window.alert(state.lastFinancialApplyNotice.message);
          });
        }
      });
    }

    [dom.openFinancialImport, dom.openFinancialImportHeader].filter(Boolean).forEach((button) => {
      button.addEventListener("click", () => {
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "actuals",
          message: "Opening file picker…",
        };
        persistState();
        render();
        document.getElementById("financial-dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" });
        dom.financialInput?.click();
      });
    });

    dom.financialImportScope?.addEventListener("change", (event) => {
      state.financialImport.scope = event.target.value || AUTO_IMPORT_SCOPE;
      persistState();
      render();
    });

    dom.approvedBudgetScope?.addEventListener("change", (event) => {
      state.approvedBudgetImport.scope = matchCommunityName(event.target.value || "RISE Corporate");
      persistState();
      render();
    });
    dom.approvedBudgetYear?.addEventListener("input", (event) => {
      const next = String(Number(event.target.value || state.approvedBudgetImport.year || "2026") || 2026);
      state.approvedBudgetImport.year = next;
      persistState();
      render();
    });
    dom.approvedBudgetExpandYear?.addEventListener("change", (event) => {
      state.approvedBudgetImport.expandAcrossYear = (event.target.value || "yes") !== "no";
      persistState();
      render();
    });
    dom.openApprovedBudgetImport?.addEventListener("click", () => {
      state.lastApprovedBudgetNotice = {
        at: new Date().toISOString(),
        kind: "approved_budget",
        message: "Opening finalized budget file picker…",
      };
      persistState();
      render();
      dom.approvedBudgetInput?.click();
    });
    dom.applyApprovedBudgetUpload?.addEventListener("click", (event) => {
      event.preventDefault();
      Promise.resolve(applyStagedApprovedBudgetUpload()).catch((error) => {
        state.lastApprovedBudgetNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Finalized budget apply failed: ${error?.message || String(error)}`,
        };
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message: `Finalized budget apply failed: ${error?.message || String(error)}`,
        };
        persistState();
        render();
      });
    });
    dom.clearApprovedBudgetStaging?.addEventListener("click", () => {
      pendingApprovedBudgetFiles = [];
      state.pendingApprovedBudget = null;
      persistState();
      render();
    });

    dom.financialImportMode?.addEventListener("change", (event) => {
      state.financialImport.mode = event.target.value || "merge";
      persistState();
      render();
    });

    dom.financialPeriodMode?.addEventListener("change", (event) => {
      state.financialImport.periodMode = event.target.value || "csv";
      persistState();
      render();
    });

    dom.financialPeriodMonth?.addEventListener("change", (event) => {
      state.financialImport.periodMonth = event.target.value || state.financialImport.periodMonth;
      persistState();
      render();
    });

    dom.financialPeriodYear?.addEventListener("input", (event) => {
      state.financialImport.periodYear = String(event.target.value || "").trim();
      persistState();
      render();
    });

    dom.reloadFinancialHistory?.addEventListener("click", loadStoredFinancialHistoryIntoPage);
    dom.clearFinancialHistory?.addEventListener("click", () => {
      clearFinancialHistoryStore();
      render();
    });

    dom.snapshotScopeMode?.addEventListener("change", (event) => {
      const nextMode = event.target.value || "all";
      if (nextMode === "custom" && !(state.snapshotScope.selectedEntities || []).length && state.selectedProperty) {
        state.snapshotScope.selectedEntities = [state.selectedProperty];
      }
      state.snapshotScope.mode = nextMode;
      persistState();
      render();
    });

    dom.snapshotEntitySearch?.addEventListener("input", (event) => {
      state.snapshotScope.search = event.target.value || "";
      persistState();
      render();
    });

    dom.snapshotSelectVisible?.addEventListener("click", () => {
      const visibleEntities = getVisibleScopeEntityNames(getFinancialEntityNames());
      state.snapshotScope.mode = "custom";
      state.snapshotScope.selectedEntities = visibleEntities;
      persistState();
      render();
    });

    dom.snapshotClearSelection?.addEventListener("click", () => {
      state.snapshotScope.search = "";
      if (state.snapshotScope.mode === "custom") {
        state.snapshotScope.selectedEntities = [];
      } else {
        state.snapshotScope.mode = "all";
      }
      persistState();
      render();
    });

    dom.snapshotEntityChips?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-entity-chip]");
      if (!button) {
        return;
      }
      const entity = button.dataset.entityChip;
      if (!entity) {
        return;
      }
      const selected = new Set(state.snapshotScope.selectedEntities || []);
      if (selected.has(entity)) {
        selected.delete(entity);
      } else {
        selected.add(entity);
      }
      state.snapshotScope.mode = "custom";
      state.snapshotScope.selectedEntities = Array.from(selected).sort((left, right) => left.localeCompare(right));
      persistState();
      render();
    });

    dom.financialFilterPeriod?.addEventListener("change", (event) => {
      state.financialLineFilter.period = event.target.value || "selected";
      persistState();
      render();
    });

    dom.financialFilterGl?.addEventListener("change", (event) => {
      state.financialLineFilter.glCode = event.target.value || "all";
      persistState();
      render();
    });

    dom.financialFilterStatus?.addEventListener("change", (event) => {
      state.financialLineFilter.status = event.target.value || "all";
      persistState();
      render();
    });

    const loadSamplePackButton = document.getElementById("load-sample-pack");
    loadSamplePackButton?.addEventListener("click", () => {
      setDataset("financial", samplePack.financial, "sample-financial.csv", "sample");
      setDataset("operations", samplePack.operations, "sample-operations.csv", "sample");
      setDataset("leasing", samplePack.leasing, "sample-leasing.csv", "sample");
    });

    const clearAllButton = document.getElementById("clear-all");
    clearAllButton?.addEventListener("click", clearState);

    dom.syncDashboardHistory?.addEventListener("click", () => {
      syncDashboardDriverDatasets();
      persistState();
      render();
    });

    dom.periodSelect?.addEventListener("change", (event) => {
      state.selectedPeriod = event.target.value;
      syncWorkspaceContextFromCurrentSelection();
      persistState();
      render();
    });
    dom.manualPeriodInput?.addEventListener("change", (event) => {
      const value = event.target.value;
      if (value) {
        setManualPeriodValue(value, true);
        render();
      }
    });

    dom.applyFinancialUpload?.addEventListener("click", (event) => {
      event?.preventDefault?.();
      state.lastFinancialApplyNotice = {
        at: new Date().toISOString(),
        kind: "actuals",
        message: "Apply To Ledger clicked…",
      };
      persistState();
      render();
      if (!state.pendingFinancial?.dataset?.records?.length) {
        state.lastFinancialApplyNotice = {
          at: new Date().toISOString(),
          kind: "error",
          message:
            "Nothing is staged yet. Click “Choose Financial Files” and select a CSV, Excel, or PDF file first, then click Apply To Ledger.",
        };
        persistState();
        render();
        window.alert(state.lastFinancialApplyNotice.message);
        return;
      }
      applyStagedFinancialUpload();
    });
    dom.clearFinancialStaging?.addEventListener("click", () => {
      state.pendingFinancial = null;
      persistState();
      render();
    });

    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => {
        state.layer = button.dataset.layer;
        persistState();
        render();
      });
    });

    dom.rankingBody.addEventListener("click", (event) => {
      const row = event.target.closest("[data-property]");
      if (!row) {
        return;
      }
      state.selectedProperty = row.dataset.property;
      syncWorkspaceContextFromCurrentSelection();
      persistState();
      render();
    });

    dom.exportScorecards?.addEventListener("click", exportScorecardsCsv);
    dom.exportSummary?.addEventListener("click", exportBoardSummary);
    dom.exportReport?.addEventListener("click", exportOwnershipReport);
    dom.exportPptx?.addEventListener("click", exportBoardDeck);
  }

  function handleSharedStorageSync(event) {
    if (!event) {
      return;
    }
    if (COMMUNITY_STORAGE_KEYS.includes(event.key)) {
      syncDashboardDriverDatasets();
      persistState();
      render();
      return;
    }
    if (event.key === OPS_WORKSPACE_CONTEXT_KEY) {
      applyWorkspaceContext(loadWorkspaceContextFromStorage(), { forceSelection: true, updateImportScope: true });
      persistState();
      render();
      renderWorkspaceBridge();
    }
  }

  const restored = restoreState();
  logDebug("boot", { build: BUILD_ID, restored });
  state.approvedBudgets = loadApprovedBudgets();
  if (!restored) {
    applyWorkspaceContext(loadWorkspaceContextFromStorage(), { forceSelection: true, updateImportScope: true });
  }
  const incomingWorkspaceContext = loadWorkspaceContextFromUrl();
  if (incomingWorkspaceContext) {
    const applied = applyWorkspaceContext(incomingWorkspaceContext, { forceSelection: true, updateImportScope: true });
    if (applied) {
      persistWorkspaceContext(applied);
    }
  }
  if (!restored) {
    syncDashboardDriverDatasets();
    const storedHistory = loadFinancialHistoryStore();
    const storedDataset = normalizeStoredFinancialDataset(storedHistory?.dataset, "Stored financial history");
    if (storedDataset) {
      state.datasets.financial = storedDataset;
    }
    persistState();
  } else if (!state.datasets.operations || !state.datasets.leasing) {
    syncDashboardDriverDatasets();
    persistState();
  }
  bindEvents();
  populateFinancialImportScopeOptions();
  if (dom.financialImportMode) {
    dom.financialImportMode.value = state.financialImport.mode || "merge";
  }
  render();
  syncWorkspaceContextFromCurrentSelection();
  window.addEventListener("storage", handleSharedStorageSync);
})();
