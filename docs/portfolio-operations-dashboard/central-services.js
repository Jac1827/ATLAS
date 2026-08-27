(function () {
  "use strict";

  const STORAGE_KEY = "atlas_central_services_phase1_v2";
  const LEGACY_STORAGE_KEYS = ["atlas_central_services_phase1_v1"];
  const TODAY_ISO = new Date().toISOString().slice(0, 10);
  const MONTH_LABELS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const MODULES = [
    ["overview", "Overview", "squares-four"],
    ["renewals", "Renewals", "arrows-clockwise"],
    ["moveOuts", "Move-Outs", "door-open"],
    ["inspections", "Inspections", "clipboard-text"],
    ["collections", "Collections", "phone-call"],
    ["evictions", "Evictions", "gavel"],
    ["invoices", "Invoices", "receipt"],
    ["tasks", "Work Queue", "check-square"],
    ["settings", "Settings", "gear-six"],
    ["architecture", "Architecture", "blueprint"],
    ["questions", "Build Questions", "question"]
  ];
  const EMPTY_ARRAY_KEYS = [
    "renewals",
    "moveOutCases",
    "tasks",
    "collections",
    "evictions",
    "invoices",
    "notifications",
    "auditTrail",
    "importHistory",
    "accountingContacts"
  ];
  const RENEWAL_STATUS_OPTIONS = [
    "Pending Decision",
    "Offer Sent",
    "Follow-Up Due",
    "Renewal Signed",
    "Transfer",
    "NTV Received"
  ];
  const MOVE_OUT_STEPS = [
    "NTV Received",
    "MOG Required",
    "MOG Sent",
    "Awaiting Signature",
    "MOG Completed",
    "Inspection Scheduled",
    "Inspection Completed",
    "MORF/SODA Required",
    "MORF/SODA Completed",
    "Sent to Accounting",
    "Accounting Confirmed",
    "Closed"
  ];
  const CENTRAL_DEPARTMENT_PATTERNS = [
    /\bcentral\s+services?\b/i,
    /\bcentra\b/i
  ];
  const RENEWAL_FIELD_ALIASES = {
    residentName: ["resident name", "resident", "name", "primary resident", "lease holder", "tenant name"],
    residentId: ["resident id", "residentid", "tenant id", "customer id"],
    leaseId: ["lease id", "leaseid", "lease number"],
    unit: ["unit", "apartment", "apt", "apartment number", "unit number"],
    unitType: ["unit type", "floor plan", "floorplan", "bed bath"],
    expirationDate: ["expiration date", "lease expiration", "lease end", "lease end date", "expire date"],
    notice90Date: ["90 day notice date", "90-day notice date", "90 day", "90-day"],
    notice60Date: ["60 day notice date", "60-day notice date", "60 day", "60-day"],
    notice30Date: ["30 day notice date", "30-day notice date", "30 day", "30-day"],
    depositHeld: ["deposit held", "deposit", "security deposit"],
    currentRate: ["current rate", "current rent", "rent"],
    recommendedOffer: ["recommended offer", "renewal offer", "recommended renewal offer"],
    investorOverridePct: ["investor override % increase", "investor override percent", "override %"],
    investorOverrideOffer: ["investor override offer", "override offer"],
    offer1: ["offer 1 - conservative", "offer 1", "conservative offer"],
    offer2: ["offer 2 - balanced", "offer 2", "balanced offer"],
    offer3: ["offer 3 - aggressive", "offer 3", "aggressive offer"],
    signedOffer: ["signed offer", "signed renewal rent", "new rent"],
    status: ["status", "renewal status", "decision", "response", "resident response"],
    renewalSigned: ["renewal signed", "signed", "renewed"],
    transfer: ["transfer", "transfer renewal"],
    ntvReceived: ["ntv received", "notice to vacate", "ntv", "notice received"],
    ntvReceivedDate: ["ntv received date", "notice received date", "notice date"],
    scheduledMoveOutDate: ["scheduled move-out date", "scheduled move out date", "move-out date", "move out date"],
    phone: ["phone", "mobile", "cell", "resident phone"],
    email: ["email", "resident email", "e-mail"],
    notes: ["notes", "comments", "central services notes"],
    marketRate: ["market rate", "market rent"],
    budgetRate: ["budget rate", "budget rent"],
    occupancyPosition: ["occupancy - under / over", "occupancy position", "occupancy"],
    rentGrowthOffer1: ["rent growth - offer 1", "offer 1 growth"],
    rentGrowthOffer2: ["rent growth - offer 2", "offer 2 growth"],
    rentGrowthOffer3: ["rent growth - offer 3", "offer 3 growth"],
    signedRentGrowth: ["signed rent growth", "signed growth"]
  };

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function cleanString(value) {
    return String(value ?? "").trim();
  }

  function normalizeKey(value) {
    return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function escapeHtml(value) {
    return cleanString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const cleaned = cleanString(value).replace(/[$,%\s,]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function whole(value) {
    return Math.max(0, Math.round(numberValue(value)));
  }

  function formatNumber(value) {
    return whole(value).toLocaleString();
  }

  function formatMoney(value) {
    const numeric = numberValue(value);
    if (!numeric) return "";
    return numeric.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function formatPercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : "n/a";
  }

  function formatDate(value) {
    const normalized = normalizeDate(value);
    if (!normalized) return "";
    const parsed = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return normalized;
    return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function normalizeDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + value * 86400000).toISOString().slice(0, 10);
    }
    const raw = cleanString(value);
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (iso) {
      const normalized = `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
      return Number.isNaN(Date.parse(`${normalized}T00:00:00`)) ? "" : normalized;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }

  function addDays(dateIso, days) {
    const base = normalizeDate(dateIso) || TODAY_ISO;
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function daysUntil(dateIso) {
    const normalized = normalizeDate(dateIso);
    if (!normalized) return null;
    const today = new Date(`${TODAY_ISO}T00:00:00`).getTime();
    const target = new Date(`${normalized}T00:00:00`).getTime();
    return Math.ceil((target - today) / 86400000);
  }

  function simpleHash(value) {
    const source = cleanString(value);
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
      hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function makeId(prefix, parts) {
    return `${prefix}_${simpleHash(asArray(parts).join("|"))}`;
  }

  function safeJsonParse(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      alert(`Central Services could not save this change: ${error?.message || error}`);
      return false;
    }
  }

  function removeLegacyStorage() {
    try {
      LEGACY_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
    } catch {
      // Browser storage may be unavailable in private or blocked contexts.
    }
  }

  function defaultUi() {
    return {
      module: "overview",
      propertyId: "all",
      monthIdx: null,
      year: new Date().getFullYear(),
      search: "",
      workflowFilter: "all",
      selectedRenewalId: "",
      selectedMoveOutId: "",
      selectedTaskId: ""
    };
  }

  function defaultState() {
    return {
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ui: defaultUi(),
      renewals: [],
      moveOutCases: [],
      tasks: [],
      collections: [],
      evictions: [],
      invoices: [],
      notifications: [],
      auditTrail: [],
      importHistory: [],
      accountingContacts: []
    };
  }

  function normalizeState(input) {
    const base = defaultState();
    const source = asObject(input);
    const normalized = {
      ...base,
      ...source,
      schemaVersion: 2,
      ui: {
        ...base.ui,
        ...asObject(source.ui)
      }
    };
    normalized.ui.module = MODULES.some(([key]) => key === normalized.ui.module) ? normalized.ui.module : "overview";
    normalized.ui.propertyId = cleanString(normalized.ui.propertyId) || "all";
    const storedMonthIdx = source.ui?.monthIdx;
    normalized.ui.monthIdx = storedMonthIdx === null || storedMonthIdx === undefined || storedMonthIdx === ""
      ? null
      : Number.isInteger(Number(storedMonthIdx))
        ? Math.max(0, Math.min(11, Number(storedMonthIdx)))
        : null;
    normalized.ui.year = Number.isFinite(Number(normalized.ui.year)) ? Number(normalized.ui.year) : new Date().getFullYear();
    normalized.ui.search = cleanString(normalized.ui.search);
    EMPTY_ARRAY_KEYS.forEach(key => {
      normalized[key] = asArray(source[key]).filter(item => item && typeof item === "object").map(item => ({ ...item }));
    });
    return normalized;
  }

  function loadState() {
    removeLegacyStorage();
    return normalizeState(safeJsonParse(storageGet(STORAGE_KEY), {}));
  }

  function saveState(state) {
    const next = normalizeState({
      ...state,
      updatedAt: new Date().toISOString()
    });
    return storageSet(STORAGE_KEY, JSON.stringify(next));
  }

  function renderActiveTab() {
    if (typeof renderTab === "function") {
      renderTab();
    } else {
      const panel = document.getElementById("tab-panel-15");
      if (panel) panel.innerHTML = window.renderCentralServicesTab();
    }
  }

  function addAudit(state, label, details = {}) {
    state.auditTrail.unshift({
      id: makeId("audit", [Date.now(), label, JSON.stringify(details)]),
      at: new Date().toISOString(),
      label,
      details
    });
    state.auditTrail = state.auditTrail.slice(0, 250);
  }

  function selectedMonthIdx(state) {
    const storedMonthIdx = state?.ui?.monthIdx;
    if (storedMonthIdx !== null && storedMonthIdx !== undefined && storedMonthIdx !== "" && Number.isInteger(Number(storedMonthIdx))) {
      return Math.max(0, Math.min(11, Number(storedMonthIdx)));
    }
    const visibleMonthControl = document.getElementById("workspace-current-month") || document.getElementById("atlas-topbar-period");
    if (visibleMonthControl && Number.isInteger(Number(visibleMonthControl.value))) {
      return Math.max(0, Math.min(11, Number(visibleMonthControl.value)));
    }
    if (typeof getSelectedDashboardMonthIndex === "function") return getSelectedDashboardMonthIndex();
    return new Date().getMonth();
  }

  function selectedYear(state) {
    return Number.isFinite(Number(state?.ui?.year)) ? Number(state.ui.year) : new Date().getFullYear();
  }

  function localPeriodKey(monthIdx, year) {
    if (typeof buildPeriodKey === "function") return buildPeriodKey(monthIdx, year);
    return `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  }

  function getAtlasPropertyNames() {
    const names = [];
    const seen = new Set();
    const add = value => {
      const name = cleanString(value);
      if (!name || seen.has(name)) return;
      seen.add(name);
      names.push(name);
    };
    try {
      if (typeof getAllCommunityNames === "function") getAllCommunityNames().forEach(add);
    } catch {
      // Fall back below.
    }
    try {
      if (typeof savedData !== "undefined") Object.keys(savedData || {}).forEach(add);
    } catch {
      // Fall back below.
    }
    try {
      if (Array.isArray(PROPERTIES)) PROPERTIES.forEach(property => add(property.name));
    } catch {
      // No static property list is available yet.
    }
    return names;
  }

  function getCommunityRecord(name) {
    try {
      const raw = typeof savedData !== "undefined" ? savedData?.[name] : null;
      if (typeof normalizeSavedCommunityRecord === "function") return normalizeSavedCommunityRecord(name, raw || {});
      return asObject(raw);
    } catch {
      return {};
    }
  }

  function getPropertyUnits(name, record) {
    try {
      const prop = typeof getPropertyByName === "function" ? getPropertyByName(name) : { name };
      if (typeof getResolvedTotalUnitsForRecord === "function") return whole(getResolvedTotalUnitsForRecord(name, record, { prop }));
      if (typeof getTotalUnitsFor === "function") return whole(getTotalUnitsFor(prop, record?.customUnits));
      return whole(record?.customUnits || prop?.units);
    } catch {
      return whole(record?.customUnits);
    }
  }

  function getPortfolioProperties() {
    return getAtlasPropertyNames().map(name => {
      const record = getCommunityRecord(name);
      return {
        id: name,
        name,
        record,
        units: getPropertyUnits(name, record),
        region: cleanString(record.communityRegionalGrouping || record.communityMarket),
        market: cleanString(record.communityMarket),
        propertyType: cleanString(record.communityPropertyType),
        active: typeof isCommunityStatusActive === "function" ? isCommunityStatusActive(record) : true
      };
    });
  }

  function getScopedProperties(state) {
    const properties = getPortfolioProperties();
    if (state.ui.propertyId === "all") return properties;
    return properties.filter(property => property.name === state.ui.propertyId);
  }

  function getRenewalEntry(property, monthIdx, year) {
    try {
      if (typeof getRenewalMonthEntryForRecord === "function") return getRenewalMonthEntryForRecord(property.record, monthIdx, year) || {};
    } catch {
      // Fall through to the normalized record data.
    }
    return asObject(property.record?.monthlyData?.[monthIdx]);
  }

  function renewalSummaryFromEntry(entry) {
    try {
      if (typeof getRenewalSummaryForMonth === "function") {
        const summary = getRenewalSummaryForMonth(entry) || {};
        return {
          expirations: whole(summary.expirations),
          signed: whole(summary.signed),
          ntv: whole(summary.ntv),
          transfers: whole(summary.transfers),
          undecided: summary.undecided === null ? whole(entry.renewalUndecided) : whole(summary.undecided),
          earlyTermination: whole(summary.earlyTermination),
          retentionRate: summary.retentionRate,
          decidedRetentionRate: summary.decidedRetentionRate
        };
      }
    } catch {
      // Fall through to direct monthly fields.
    }
    const expirations = whole(entry.renewalExpirations);
    const signed = whole(entry.renewalSigned);
    const ntv = whole(entry.renewalNTV);
    const transfers = whole(entry.renewalTransfers);
    const earlyTermination = whole(entry.renewalEarlyTermination);
    return {
      expirations,
      signed,
      ntv,
      transfers,
      undecided: whole(entry.renewalUndecided || Math.max(expirations - signed - ntv - transfers - earlyTermination, 0)),
      earlyTermination,
      retentionRate: expirations > 0 ? signed / expirations * 100 : null,
      decidedRetentionRate: signed + ntv > 0 ? signed / (signed + ntv) * 100 : null
    };
  }

  function rowIsInScope(row, state) {
    const periodKey = localPeriodKey(selectedMonthIdx(state), selectedYear(state));
    const propertyOk = state.ui.propertyId === "all" || row.propertyName === state.ui.propertyId;
    return propertyOk && row.periodKey === periodKey;
  }

  function summarizeRenewalRows(rows) {
    const summary = { expirations: rows.length, signed: 0, ntv: 0, transfers: 0, undecided: 0, earlyTermination: 0 };
    rows.forEach(row => {
      const status = cleanString(row.status).toLowerCase();
      if (status.includes("signed") || status.includes("renewed")) summary.signed += 1;
      else if (status.includes("ntv") || status.includes("notice")) summary.ntv += 1;
      else if (status.includes("transfer")) summary.transfers += 1;
      else summary.undecided += 1;
    });
    summary.retentionRate = summary.expirations > 0 ? summary.signed / summary.expirations * 100 : null;
    summary.decidedRetentionRate = summary.signed + summary.ntv > 0 ? summary.signed / (summary.signed + summary.ntv) * 100 : null;
    return summary;
  }

  function getDetailedRowsForProperty(state, propertyName) {
    const periodKey = localPeriodKey(selectedMonthIdx(state), selectedYear(state));
    return state.renewals.filter(row => row.propertyName === propertyName && row.periodKey === periodKey);
  }

  function getPropertyMonthSummaries(state) {
    const monthIdx = selectedMonthIdx(state);
    const year = selectedYear(state);
    return getScopedProperties(state).map(property => {
      const entry = getRenewalEntry(property, monthIdx, year);
      const detailedRows = getDetailedRowsForProperty(state, property.name);
      const summary = detailedRows.length ? summarizeRenewalRows(detailedRows) : renewalSummaryFromEntry(entry);
      const hasSummaryData = Object.values(summary).some(value => Number(value) > 0);
      let sourceLabel = hasSummaryData ? "ATLAS monthly summary" : "No renewal data loaded";
      try {
        const periodKey = localPeriodKey(monthIdx, year);
        const stamp = typeof getPeriodImportStamp === "function" ? getPeriodImportStamp(property.record, "renewals", periodKey) : {};
        if (stamp?.sourceFileName) sourceLabel = stamp.sourceFileName;
      } catch {
        // Keep the generic source label.
      }
      if (detailedRows.length) sourceLabel = "Central Services import";
      return {
        propertyId: property.name,
        propertyName: property.name,
        region: property.region,
        market: property.market,
        units: property.units,
        active: property.active,
        sourceLabel,
        hasDetailed: detailedRows.length > 0,
        hasSummaryData,
        expirations: whole(summary.expirations),
        signed: whole(summary.signed),
        ntv: whole(summary.ntv),
        transfers: whole(summary.transfers),
        undecided: whole(summary.undecided),
        earlyTermination: whole(summary.earlyTermination),
        retentionRate: summary.retentionRate,
        moveOuts: whole(entry.moveOuts),
        moveIns: whole(entry.moveIns)
      };
    });
  }

  function getScopedRenewals(state) {
    const rows = state.renewals.filter(row => rowIsInScope(row, state));
    const query = normalizeKey(state.ui.search);
    if (!query) return rows;
    return rows.filter(row => normalizeKey([
      row.residentName,
      row.propertyName,
      row.unit,
      row.status,
      row.owner,
      row.notes
    ].join(" ")).includes(query));
  }

  function getScopedMoveOuts(state) {
    const periodKey = localPeriodKey(selectedMonthIdx(state), selectedYear(state));
    const scopedPropertyNames = new Set(getScopedProperties(state).map(property => property.name));
    return state.moveOutCases.filter(item => {
      const propertyOk = state.ui.propertyId === "all" ? scopedPropertyNames.has(item.propertyName) : item.propertyName === state.ui.propertyId;
      const periodOk = !item.periodKey || item.periodKey === periodKey;
      return propertyOk && periodOk;
    });
  }

  function getScopedTasks(state) {
    const scopedPropertyNames = new Set(getScopedProperties(state).map(property => property.name));
    const query = normalizeKey(state.ui.search);
    return state.tasks
      .filter(task => state.ui.propertyId === "all" ? scopedPropertyNames.has(task.propertyName) : task.propertyName === state.ui.propertyId)
      .filter(task => !query || normalizeKey([task.title, task.propertyName, task.residentName, task.owner, task.type].join(" ")).includes(query));
  }

  function getKpis(state, centralEmployees) {
    const summaries = getPropertyMonthSummaries(state);
    const moveOutCases = getScopedMoveOuts(state);
    const tasks = getScopedTasks(state);
    const openTasks = tasks.filter(task => task.status !== "Completed");
    const overdueTasks = openTasks.filter(task => {
      const delta = daysUntil(task.dueDate);
      return delta !== null && delta < 0;
    });
    return {
      propertyCount: getScopedProperties(state).length,
      rosterCount: centralEmployees.length,
      expirations: summaries.reduce((sum, row) => sum + row.expirations, 0),
      signed: summaries.reduce((sum, row) => sum + row.signed, 0),
      ntv: summaries.reduce((sum, row) => sum + row.ntv, 0),
      undecided: summaries.reduce((sum, row) => sum + row.undecided, 0),
      transfers: summaries.reduce((sum, row) => sum + row.transfers, 0),
      moveOutsInMonth: summaries.reduce((sum, row) => sum + row.moveOuts, 0),
      moveOutCaseCount: moveOutCases.length,
      mogAwaiting: moveOutCases.filter(item => ["MOG Sent", "Awaiting Signature"].includes(item.workflowStatus) || item.mogStatus === "Awaiting Signature").length,
      openTasks: openTasks.length,
      overdueTasks: overdueTasks.length
    };
  }

  function pickEmployeeValue(employee, keys) {
    for (const key of keys) {
      if (employee?.[key] !== undefined && cleanString(employee[key])) return cleanString(employee[key]);
    }
    return "";
  }

  function getEmployeeName(employee = {}) {
    const direct = pickEmployeeValue(employee, ["name", "fullName", "employeeName", "Employee Name", "Full Name"]);
    if (direct) return direct;
    const first = pickEmployeeValue(employee, ["firstName", "First Name"]);
    const last = pickEmployeeValue(employee, ["lastName", "Last Name"]);
    return cleanString(`${first} ${last}`);
  }

  function employeeIsActive(raw = {}, normalized = {}) {
    const status = cleanString(raw.status || raw.Status || raw.employmentStatus || raw.employment_status || normalized.status || "Active").toLowerCase();
    if (status.includes("terminated") || status.includes("inactive") || status.includes("archived")) return false;
    if (raw.archived || raw.deleted || raw.isDeleted) return false;
    if (normalizeDate(raw.terminationDate || raw["Termination Date"] || normalized.terminationDate)) return false;
    if (normalized.active === false) return false;
    return true;
  }

  function employeeCentralSignal(raw = {}, normalized = {}) {
    const departmentFields = [
      raw.department,
      raw.Department,
      raw.departmentName,
      raw.homeDepartment,
      raw.orgUnit,
      raw.organizationUnit,
      raw.businessUnit,
      raw.costCenter,
      raw.team,
      raw.division,
      normalized.department
    ];
    const directDepartment = departmentFields.map(cleanString).filter(Boolean).join(" ");
    if (CENTRAL_DEPARTMENT_PATTERNS.some(pattern => pattern.test(directDepartment))) return true;

    const fallbackFields = [
      raw.title,
      raw.role,
      raw["Job Title"],
      raw.position,
      raw.group,
      raw.location,
      normalized.title,
      normalized.source
    ].map(cleanString).filter(Boolean).join(" ");
    return !directDepartment && CENTRAL_DEPARTMENT_PATTERNS.some(pattern => pattern.test(fallbackFields));
  }

  function normalizeCentralEmployee(raw = {}, meta = {}) {
    const normalized = asObject(meta.normalized);
    const email = pickEmployeeValue(raw, ["email", "workEmail", "Work Email", "Email"]) || cleanString(normalized.email);
    const employeeNumber = pickEmployeeValue(raw, ["employeeNumber", "Employee Number", "employee_number"]) || cleanString(normalized.employeeNumber);
    const name = getEmployeeName(raw) || cleanString(normalized.name);
    const title = pickEmployeeValue(raw, ["title", "role", "Job Title", "position"]) || cleanString(normalized.title);
    const department = pickEmployeeValue(raw, [
      "department",
      "Department",
      "departmentName",
      "homeDepartment",
      "orgUnit",
      "organizationUnit",
      "businessUnit",
      "costCenter",
      "team",
      "division"
    ]);
    const key = employeeNumber
      ? `empnum:${employeeNumber}`
      : email
        ? `email:${email.toLowerCase()}`
        : `name:${normalizeKey(name)}:${normalizeKey(title)}`;
    return {
      employeeId: cleanString(normalized.employeeId || raw.employeeId || raw.id || key),
      peopleEmployeeId: cleanString(normalized.peopleEmployeeId || raw.peopleEmployeeId || raw.id),
      employeeNumber,
      email: email.toLowerCase(),
      name,
      title,
      department,
      status: pickEmployeeValue(raw, ["status", "Status", "employmentStatus", "employment_status"]) || cleanString(normalized.status || "Active"),
      source: cleanString(meta.source || normalized.source || "People roster"),
      key
    };
  }

  function addCentralEmployee(map, raw = {}, meta = {}) {
    const normalized = normalizeCentralEmployee(raw, meta);
    if (!normalized.name) return;
    if (!employeeIsActive(raw, meta.normalized)) return;
    if (!employeeCentralSignal(raw, { ...meta.normalized, department: normalized.department, title: normalized.title })) return;
    const existing = map.get(normalized.key);
    map.set(normalized.key, {
      ...existing,
      ...normalized,
      department: normalized.department || existing?.department || "",
      title: normalized.title || existing?.title || "",
      email: normalized.email || existing?.email || "",
      employeeId: normalized.employeeId || existing?.employeeId || normalized.key
    });
  }

  function getCentralServicesEmployees() {
    const employees = new Map();
    try {
      if (typeof loadPeoplePlatformStateForSharedData === "function") {
        const peopleState = loadPeoplePlatformStateForSharedData() || {};
        asArray(peopleState.employees).forEach(employee => addCentralEmployee(employees, employee, { source: "People roster" }));
      }
    } catch {
      // Keep any other sources that are available.
    }
    try {
      const key = typeof PERFORMANCE_PLATFORM_STORAGE_KEY !== "undefined" ? PERFORMANCE_PLATFORM_STORAGE_KEY : "rise_performance_platform_github_v1";
      const peopleState = safeJsonParse(storageGet(key), {});
      asArray(peopleState.employees).forEach(employee => addCentralEmployee(employees, employee, { source: "People roster" }));
    } catch {
      // Keep any other sources that are available.
    }
    try {
      if (typeof atlasSharedData !== "undefined") {
        Object.values(asObject(atlasSharedData.employees)).forEach(employee => {
          addCentralEmployee(employees, employee, { source: "ATLAS shared people", normalized: employee });
        });
      }
    } catch {
      // Shared data has not loaded yet.
    }
    return [...employees.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  function defaultOwner(centralEmployees) {
    return centralEmployees[0]?.name || "Unassigned";
  }

  function ownerOptionsHtml(centralEmployees, selectedOwner) {
    const names = ["Unassigned", ...centralEmployees.map(employee => employee.name)].filter(Boolean);
    return [...new Set(names)].map(name => `<option value="${escapeAttr(name)}" ${name === selectedOwner ? "selected" : ""}>${escapeHtml(name)}</option>`).join("");
  }

  function statusPill(status) {
    return `<span class="cs-status" data-status="${escapeAttr(status)}">${escapeHtml(status || "Not Started")}</span>`;
  }

  function icon(name) {
    return `<i class="ph ph-${escapeAttr(name)}" aria-hidden="true"></i>`;
  }

  function propertyOptionsHtml(selected, includeAll = true) {
    const all = includeAll ? `<option value="all" ${selected === "all" ? "selected" : ""}>All ATLAS properties</option>` : "";
    return `${all}${getPortfolioProperties().map(property => `<option value="${escapeAttr(property.name)}" ${property.name === selected ? "selected" : ""}>${escapeHtml(property.name)}</option>`).join("")}`;
  }

  function monthOptionsHtml(selectedIdx) {
    return MONTH_LABELS.map((label, idx) => `<option value="${idx}" ${idx === selectedIdx ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  }

  function renderModuleNav(state) {
    return `<div class="cs-module-nav" role="tablist" aria-label="Central Services modules">
      ${MODULES.map(([key, label, iconName]) => `<button type="button" class="cs-module-tab ${state.ui.module === key ? "is-active" : ""}" onclick="atlasCsSetModule('${key}')">${icon(iconName)} ${escapeHtml(label)}</button>`).join("")}
    </div>`;
  }

  function renderControls(state) {
    const monthIdx = selectedMonthIdx(state);
    return `<div class="cs-panel">
      <div class="cs-panel-body">
        <div class="cs-control-grid">
          <label class="cs-field">
            <span>Property Scope</span>
            <select onchange="atlasCsSetProperty(this.value)">${propertyOptionsHtml(state.ui.propertyId, true)}</select>
          </label>
          <label class="cs-field">
            <span>Reporting Month</span>
            <select onchange="atlasCsSetMonth(this.value)">${monthOptionsHtml(monthIdx)}</select>
          </label>
          <label class="cs-field">
            <span>Reporting Year</span>
            <input type="number" min="2020" max="2035" value="${escapeAttr(selectedYear(state))}" onchange="atlasCsSetYear(this.value)">
          </label>
          <label class="cs-field" style="grid-column:span 3">
            <span>Search Imported Workflow Records</span>
            <input type="search" value="${escapeAttr(state.ui.search)}" placeholder="Resident, unit, property, owner, status" onchange="atlasCsSetSearch(this.value)">
          </label>
        </div>
      </div>
    </div>`;
  }

  function renderKpi(config) {
    return `<button type="button" class="cs-kpi" data-tone="${escapeAttr(config.tone || "")}" data-module="${escapeAttr(config.module || "overview")}" data-filter="${escapeAttr(config.filter || "")}" onclick="atlasCsDrill(this.dataset.module,this.dataset.filter)">
      <div class="cs-kpi-top">
        <div class="cs-kpi-label">${escapeHtml(config.label)}</div>
        <div class="cs-kpi-icon">${icon(config.icon || "chart-line")}</div>
      </div>
      <div class="cs-kpi-value">${escapeHtml(config.value)}</div>
      <div class="cs-kpi-sub">${escapeHtml(config.sub || "Click to open the records behind this card.")}</div>
    </button>`;
  }

  function renderKpiGrid(state, employees) {
    const kpis = getKpis(state, employees);
    const retention = kpis.expirations > 0 ? kpis.signed / kpis.expirations * 100 : null;
    return `<div class="cs-kpi-grid">
      ${renderKpi({ label: "Properties in Scope", value: formatNumber(kpis.propertyCount), sub: "Compiled from the ATLAS property list.", icon: "buildings", module: "renewals" })}
      ${renderKpi({ label: "Central Services Roster", value: formatNumber(kpis.rosterCount), sub: "Employees whose roster department includes Centra or Central Services.", icon: "users-three", module: "settings" })}
      ${renderKpi({ label: "Renewal Expirations", value: formatNumber(kpis.expirations), sub: `${MONTH_LABELS[selectedMonthIdx(state)]} ${selectedYear(state)} across selected properties.`, icon: "calendar-dots", module: "renewals" })}
      ${renderKpi({ label: "Renewal Conversion", value: formatPercent(retention), sub: "Signed renewals divided by expirations from ATLAS or imported rows.", icon: "trend-up", tone: "green", module: "renewals" })}
      ${renderKpi({ label: "Pending Decisions", value: formatNumber(kpis.undecided), sub: "Outstanding renewal decisions in the selected period.", icon: "hourglass", tone: "amber", module: "renewals", filter: "pending" })}
      ${renderKpi({ label: "NTV / Move-Out Exposure", value: formatNumber(kpis.ntv), sub: "Notices to vacate from ATLAS summaries or imported renewal records.", icon: "door", tone: "red", module: "moveOuts" })}
      ${renderKpi({ label: "Detailed Move-Out Cases", value: formatNumber(kpis.moveOutCaseCount), sub: "Only cases created from imported records or Central Services actions.", icon: "folders", tone: "violet", module: "moveOuts" })}
      ${renderKpi({ label: "Open Work Queue", value: formatNumber(kpis.openTasks), sub: `${formatNumber(kpis.overdueTasks)} overdue tasks in the selected scope.`, icon: "check-square-offset", tone: kpis.overdueTasks ? "red" : "teal", module: "tasks" })}
    </div>`;
  }

  function renderRosterPanel(employees) {
    if (!employees.length) {
      return `<div class="cs-alert is-warn">
        No Central Services employees were found from the employee roster yet. The roster filter is looking for active employees whose department, org unit, business unit, cost center, team, or division contains "Centra" or "Central Services".
      </div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Employee</th><th>Title</th><th>Department</th><th>Email</th><th>Source</th></tr></thead>
        <tbody>
          ${employees.map(employee => `<tr>
            <td><div class="cs-name-cell"><strong>${escapeHtml(employee.name)}</strong><span>${escapeHtml(employee.employeeNumber || employee.peopleEmployeeId || employee.employeeId)}</span></div></td>
            <td>${escapeHtml(employee.title || "Not listed")}</td>
            <td>${escapeHtml(employee.department || "Matched from available roster fields")}</td>
            <td>${employee.email ? `<a href="mailto:${escapeAttr(employee.email)}">${escapeHtml(employee.email)}</a>` : "Not listed"}</td>
            <td>${escapeHtml(employee.source)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderTaskTable(state, options = {}) {
    const tasks = getScopedTasks(state).filter(task => options.openOnly ? task.status !== "Completed" : true);
    if (!tasks.length) {
      return `<div class="cs-empty"><div><strong>No Central Services tasks yet.</strong><br>Tasks will appear here after a real renewal import creates workflow work or after users create assignments from Central Services records.</div></div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Task</th><th>Property</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${tasks.map(task => {
            const dueDelta = daysUntil(task.dueDate);
            const dueTone = dueDelta !== null && dueDelta < 0 && task.status !== "Completed" ? "Overdue" : task.status;
            return `<tr>
              <td><div class="cs-name-cell"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml([task.type, task.residentName].filter(Boolean).join(" - "))}</span></div></td>
              <td>${escapeHtml(task.propertyName)}</td>
              <td>${escapeHtml(task.owner || "Unassigned")}</td>
              <td>${escapeHtml(formatDate(task.dueDate) || "Not dated")}</td>
              <td>${statusPill(dueTone || "Open")}</td>
              <td class="right">
                <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(task.id)}" onclick="atlasCsOpenTask(this.dataset.id)">Open</button>
                <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(task.id)}" onclick="atlasCsToggleTask(this.dataset.id)">${task.status === "Completed" ? "Reopen" : "Complete"}</button>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderOverview(state, employees) {
    return `<div class="cs-dashboard-grid">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Portfolio Workload</div>
            <div class="cs-panel-sub">Every card opens the matching Central Services module or filter.</div>
          </div>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('settings')">${icon("sliders-horizontal")} Customize</button>
        </div>
        <div class="cs-panel-body">${renderKpiGrid(state, employees)}</div>
      </div>
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">My Work Queue</div>
            <div class="cs-panel-sub">Open assignments generated from real Central Services records.</div>
          </div>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('tasks')">Open Queue</button>
        </div>
        <div class="cs-panel-body">${renderTaskTable(state, { openOnly: true })}</div>
      </div>
      <div class="cs-panel" style="grid-column:1 / -1">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">ATLAS Property Renewal Summary</div>
            <div class="cs-panel-sub">Compiled from every ATLAS property in scope for ${escapeHtml(MONTH_LABELS[selectedMonthIdx(state)])} ${escapeHtml(selectedYear(state))}.</div>
          </div>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('renewals')">Open Renewals</button>
        </div>
        <div class="cs-panel-body">${renderPropertySummaryTable(state)}</div>
      </div>
      <div class="cs-panel" style="grid-column:1 / -1">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Central Services Roster</div>
            <div class="cs-panel-sub">Fed from the People employee roster. No names are seeded in this workspace.</div>
          </div>
        </div>
        <div class="cs-panel-body">${renderRosterPanel(employees)}</div>
      </div>
    </div>`;
  }

  function renderPropertySummaryTable(state) {
    const rows = getPropertyMonthSummaries(state);
    if (!rows.length) {
      return `<div class="cs-empty"><div><strong>No ATLAS properties are available yet.</strong><br>Once properties exist in ATLAS, Central Services will compile them here.</div></div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead>
          <tr><th>Property</th><th>Region</th><th class="right">Units</th><th class="right">Expiring</th><th class="right">Signed</th><th class="right">NTV</th><th class="right">Transfer</th><th class="right">Pending</th><th class="right">Move-Outs</th><th>Source</th><th></th></tr>
        </thead>
        <tbody>
          ${rows.map(row => `<tr>
            <td><div class="cs-name-cell"><strong>${escapeHtml(row.propertyName)}</strong><span>${escapeHtml(row.market || row.propertyType || (row.active ? "Active" : "Inactive"))}</span></div></td>
            <td>${escapeHtml(row.region || "Not grouped")}</td>
            <td class="right">${formatNumber(row.units)}</td>
            <td class="right">${formatNumber(row.expirations)}</td>
            <td class="right">${formatNumber(row.signed)}</td>
            <td class="right">${formatNumber(row.ntv)}</td>
            <td class="right">${formatNumber(row.transfers)}</td>
            <td class="right">${formatNumber(row.undecided)}</td>
            <td class="right">${formatNumber(row.moveOuts)}</td>
            <td><span class="cs-chip ${row.hasDetailed ? "is-strong" : ""}">${escapeHtml(row.sourceLabel)}</span></td>
            <td class="right"><button type="button" class="cs-btn cs-btn-sm" data-property="${escapeAttr(row.propertyName)}" onclick="atlasCsOpenPropertyRenewals(this.dataset.property)">Open</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderImportPanel(state) {
    const selected = state.ui.propertyId === "all" ? "" : state.ui.propertyId;
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Upload Renewal Report</div>
          <div class="cs-panel-sub">Use an actual Entrata renewal export. Imported resident rows become Central Services workflow records and can feed ATLAS renewal summaries.</div>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-import-flow" style="margin-bottom:12px">
          ${["Validate file", "Map columns", "Deduplicate records", "Create NTV move-out cases", "Write ATLAS summary"].map((step, idx) => `<div class="cs-import-step"><strong>${idx + 1}. ${escapeHtml(step)}</strong><span>Runs from the uploaded report, not seeded data.</span></div>`).join("")}
        </div>
        <div class="cs-control-grid" style="margin-bottom:12px">
          <label class="cs-field">
            <span>Import Property</span>
            <select id="atlas-cs-renewal-property">${propertyOptionsHtml(selected, false)}</select>
          </label>
          <label class="cs-field">
            <span>Import Month</span>
            <select id="atlas-cs-renewal-month">${monthOptionsHtml(selectedMonthIdx(state))}</select>
          </label>
          <label class="cs-field">
            <span>Import Year</span>
            <input id="atlas-cs-renewal-year" type="number" min="2020" max="2035" value="${escapeAttr(selectedYear(state))}">
          </label>
          <label class="cs-dropzone" style="grid-column:span 3">
            ${icon("upload-simple")}
            <strong>Choose XLSX or CSV renewal report</strong>
            <span>Rows must include at least resident, unit, and lease expiration for resident-level tracking.</span>
            <input type="file" accept=".xlsx,.xls,.xlsm,.csv" onchange="atlasCsHandleRenewalUpload(this)">
          </label>
        </div>
      </div>
    </div>`;
  }

  function renderRenewalTable(state, employees) {
    const rows = getScopedRenewals(state);
    if (!rows.length) {
      return `<div class="cs-empty"><div><strong>No resident-level renewal rows in Central Services yet.</strong><br>Upload the actual Entrata renewal report for a property and month to unlock resident drilldowns, ownership, status changes, and NTV workflow creation.</div></div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Resident</th><th>Property / Unit</th><th>Expiration</th><th>Status</th><th>Owner</th><th>Next Action</th><th>Due</th><th></th></tr></thead>
        <tbody>
          ${rows.map(row => `<tr class="${state.ui.selectedRenewalId === row.id ? "is-selected" : ""}">
            <td><div class="cs-name-cell"><strong>${escapeHtml(row.residentName)}</strong><span>${escapeHtml(row.email || row.phone || "Resident contact not imported")}</span></div></td>
            <td><div class="cs-name-cell"><strong>${escapeHtml(row.propertyName)}</strong><span>Unit ${escapeHtml(row.unit || "n/a")} ${row.unitType ? `- ${escapeHtml(row.unitType)}` : ""}</span></div></td>
            <td>${escapeHtml(formatDate(row.expirationDate) || "Not imported")}</td>
            <td><select data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalStatus(this.dataset.id,this.value)">${RENEWAL_STATUS_OPTIONS.map(status => `<option value="${escapeAttr(status)}" ${status === row.status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></td>
            <td><select data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalField(this.dataset.id,'owner',this.value)">${ownerOptionsHtml(employees, row.owner || "Unassigned")}</select></td>
            <td><input value="${escapeAttr(row.nextAction || "")}" placeholder="Next action" data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalField(this.dataset.id,'nextAction',this.value)"></td>
            <td><input type="date" value="${escapeAttr(row.dueDate || "")}" data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalField(this.dataset.id,'dueDate',this.value)"></td>
            <td class="right">
              <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(row.id)}" onclick="atlasCsSelectRenewal(this.dataset.id)">Open</button>
              <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(row.id)}" onclick="atlasCsCreateMoveOutFromRenewal(this.dataset.id)">Move-Out</button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderRenewalDetail(state) {
    const rows = getScopedRenewals(state);
    const row = rows.find(item => item.id === state.ui.selectedRenewalId) || rows[0];
    if (!row) {
      return `<div class="cs-detail-panel"><div class="cs-detail-title"><h3>Renewal Detail</h3></div><div class="cs-alert">Open an imported renewal row to see resident-level details.</div></div>`;
    }
    const fields = [
      ["Resident", row.residentName],
      ["Phone", row.phone],
      ["Email", row.email],
      ["Property", row.propertyName],
      ["Unit", row.unit],
      ["Unit Type", row.unitType],
      ["Expiration", formatDate(row.expirationDate)],
      ["Deposit Held", formatMoney(row.depositHeld)],
      ["Current Rate", formatMoney(row.currentRate)],
      ["Market Rate", formatMoney(row.marketRate)],
      ["Budget Rate", formatMoney(row.budgetRate)],
      ["Recommended Offer", formatMoney(row.recommendedOffer)],
      ["Signed Offer", formatMoney(row.signedOffer)],
      ["90-Day", formatDate(row.notice90Date)],
      ["60-Day", formatDate(row.notice60Date)],
      ["30-Day", formatDate(row.notice30Date)],
      ["Occupancy", row.occupancyPosition],
      ["Signed Growth", row.signedRentGrowth]
    ];
    return `<div class="cs-detail-panel">
      <div class="cs-detail-title">
        <div>
          <h3>${escapeHtml(row.residentName)}</h3>
          <div class="cs-detail-meta">${escapeHtml(row.propertyName)} - Unit ${escapeHtml(row.unit || "n/a")}</div>
        </div>
        ${statusPill(row.status)}
      </div>
      <div class="cs-section-grid">
        ${fields.map(([label, value]) => `<div class="cs-data-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not imported")}</strong></div>`).join("")}
      </div>
      <label class="cs-field">
        <span>Notes</span>
        <textarea data-id="${escapeAttr(row.id)}" onchange="atlasCsUpdateRenewalField(this.dataset.id,'notes',this.value)">${escapeHtml(row.notes || "")}</textarea>
      </label>
      <div class="cs-chip-row">
        <span class="cs-chip is-strong">Source: ${escapeHtml(row.sourceFileName || "Central Services import")}</span>
        <span class="cs-chip">Persistent ID: ${escapeHtml(row.id)}</span>
      </div>
    </div>`;
  }

  function renderRenewals(state, employees) {
    return `<div class="cs-two-col">
      <div style="display:grid;gap:14px">
        ${renderImportPanel(state)}
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Property Month Summary</div>
              <div class="cs-panel-sub">Uses imported Central Services rows where available; otherwise uses ATLAS monthly renewal summaries.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderPropertySummaryTable(state)}</div>
        </div>
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Resident-Level Tracker</div>
              <div class="cs-panel-sub">Only populated by actual uploaded renewal reports.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderRenewalTable(state, employees)}</div>
        </div>
      </div>
      ${renderRenewalDetail(state)}
    </div>`;
  }

  function workflowStepClass(caseRecord, step) {
    const activeIndex = Math.max(0, MOVE_OUT_STEPS.indexOf(caseRecord.workflowStatus || "MOG Required"));
    const stepIndex = MOVE_OUT_STEPS.indexOf(step);
    if (stepIndex < activeIndex) return "is-done";
    if (stepIndex === activeIndex) return "is-active";
    return "";
  }

  function renderMoveOutWorkflow(caseRecord) {
    return `<div class="cs-workflow">
      ${MOVE_OUT_STEPS.map((step, idx) => `<div class="cs-step ${workflowStepClass(caseRecord, step)}"><span class="cs-step-index">${idx + 1}</span><strong>${escapeHtml(step)}</strong><span>${step === caseRecord.workflowStatus ? "Current stage" : "Workflow stage"}</span></div>`).join("")}
    </div>`;
  }

  function renderMoveOutTable(state) {
    const cases = getScopedMoveOuts(state);
    if (!cases.length) {
      return `<div class="cs-empty"><div><strong>No resident-level move-out cases yet.</strong><br>NTV renewal records from an actual import will create move-out cases automatically. Until then, only the ATLAS monthly move-out counts are shown in the property summary.</div></div>`;
    }
    return `<div class="cs-table-wrap">
      <table class="cs-table">
        <thead><tr><th>Resident</th><th>Property / Unit</th><th>Lease Expiration</th><th>Scheduled Move-Out</th><th>MOG</th><th>Workflow</th><th>Owner</th><th></th></tr></thead>
        <tbody>
          ${cases.map(item => `<tr class="${state.ui.selectedMoveOutId === item.id ? "is-selected" : ""}">
            <td><div class="cs-name-cell"><strong>${escapeHtml(item.residentName)}</strong><span>${escapeHtml(item.email || item.phone || "Resident contact not imported")}</span></div></td>
            <td><div class="cs-name-cell"><strong>${escapeHtml(item.propertyName)}</strong><span>Unit ${escapeHtml(item.unit || "n/a")}</span></div></td>
            <td>${escapeHtml(formatDate(item.leaseExpiration) || "Not imported")}</td>
            <td>${escapeHtml(formatDate(item.scheduledMoveOutDate) || "Needed from MOG")}</td>
            <td>${statusPill(item.mogStatus || "Not Initiated")}</td>
            <td>${statusPill(item.workflowStatus || "MOG Required")}</td>
            <td>${escapeHtml(item.owner || "Unassigned")}</td>
            <td class="right"><button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsSelectMoveOut(this.dataset.id)">Open</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function renderMoveOutDetail(state) {
    const cases = getScopedMoveOuts(state);
    const item = cases.find(row => row.id === state.ui.selectedMoveOutId) || cases[0];
    if (!item) {
      return `<div class="cs-detail-panel"><div class="cs-detail-title"><h3>Move-Out Detail</h3></div><div class="cs-alert">Open a real move-out case to run MOG, inspection, MORF/SODA, and accounting steps.</div></div>`;
    }
    const fields = [
      ["Resident", item.residentName],
      ["Phone", item.phone],
      ["Email", item.email],
      ["Property", item.propertyName],
      ["Unit", item.unit],
      ["Lease Expiration", formatDate(item.leaseExpiration)],
      ["Scheduled Move-Out", formatDate(item.scheduledMoveOutDate)],
      ["NTV Received", formatDate(item.ntvReceivedDate)],
      ["Deposit Held", formatMoney(item.depositHeld)],
      ["Forwarding Address", item.forwardingAddress],
      ["Inspection Date", formatDate(item.inspectionDate)],
      ["Accounting Contact", item.accountingContactName || item.accountingContactEmail]
    ];
    return `<div class="cs-detail-panel">
      <div class="cs-detail-title">
        <div>
          <h3>${escapeHtml(item.residentName)}</h3>
          <div class="cs-detail-meta">${escapeHtml(item.propertyName)} - Unit ${escapeHtml(item.unit || "n/a")}</div>
        </div>
        ${statusPill(item.workflowStatus || "MOG Required")}
      </div>
      ${renderMoveOutWorkflow(item)}
      <div class="cs-section-grid">
        ${fields.map(([label, value]) => `<div class="cs-data-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not captured")}</strong></div>`).join("")}
      </div>
      <div class="cs-chip-row">
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsSendMog(this.dataset.id)">Send MOG</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsCompleteMog(this.dataset.id)">Complete MOG</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsScheduleInspection(this.dataset.id)">Schedule Inspection</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsCompleteInspection(this.dataset.id)">Complete Inspection</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsSendToAccounting(this.dataset.id)">Send to Accounting</button>
        <button type="button" class="cs-btn cs-btn-sm" data-id="${escapeAttr(item.id)}" onclick="atlasCsDownloadCasePacket(this.dataset.id)">Export Case</button>
      </div>
      <label class="cs-field">
        <span>Case Notes</span>
        <textarea data-id="${escapeAttr(item.id)}" onchange="atlasCsUpdateMoveOutField(this.dataset.id,'notes',this.value)">${escapeHtml(item.notes || "")}</textarea>
      </label>
    </div>`;
  }

  function renderMoveOuts(state) {
    return `<div class="cs-two-col">
      <div style="display:grid;gap:14px">
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">Move-Out Cases</div>
              <div class="cs-panel-sub">Case records are created only from imported NTVs or user actions on imported renewal rows.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderMoveOutTable(state)}</div>
        </div>
        <div class="cs-panel">
          <div class="cs-panel-head">
            <div>
              <div class="cs-panel-title">ATLAS Move-Out Counts by Property</div>
              <div class="cs-panel-sub">Monthly counts from ATLAS remain visible even before resident-level cases are imported.</div>
            </div>
          </div>
          <div class="cs-panel-body">${renderPropertySummaryTable(state)}</div>
        </div>
      </div>
      ${renderMoveOutDetail(state)}
    </div>`;
  }

  function renderEmptyWorkflowModule(state, config) {
    const rows = asArray(state[config.key]);
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">${escapeHtml(config.title)}</div>
          <div class="cs-panel-sub">${escapeHtml(config.sub)}</div>
        </div>
        <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('questions')">${icon("question")} Build Questions</button>
      </div>
      <div class="cs-panel-body">
        ${rows.length ? `<div class="cs-table-wrap"><table class="cs-table"><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.title || row.id)}</td><td>${statusPill(row.status || "Open")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="cs-empty"><div><strong>No ${escapeHtml(config.title.toLowerCase())} records have been connected yet.</strong><br>${escapeHtml(config.empty)}</div></div>`}
      </div>
    </div>`;
  }

  function renderInspections(state) {
    const cases = getScopedMoveOuts(state).filter(item => item.inspectionStatus && item.inspectionStatus !== "Not Scheduled");
    if (!cases.length) {
      return `<div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Inspections</div>
            <div class="cs-panel-sub">Inspection scheduling will connect to move-out cases once you confirm the operational rules.</div>
          </div>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('questions')">${icon("question")} Build Questions</button>
        </div>
        <div class="cs-panel-body">
          <div class="cs-empty"><div><strong>No inspections are scheduled yet.</strong><br>Use a real move-out case to schedule inspections, or answer the build questions so this module can connect to the right scheduling source.</div></div>
        </div>
      </div>`;
    }
    return `<div class="cs-panel"><div class="cs-panel-head"><div><div class="cs-panel-title">Scheduled Inspections</div><div class="cs-panel-sub">Inspections created from move-out cases.</div></div></div><div class="cs-panel-body">${renderMoveOutTable(state)}</div></div>`;
  }

  function renderTasks(state) {
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Central Services Work Queue</div>
          <div class="cs-panel-sub">Consolidated tasks generated from real Central Services workflow records.</div>
        </div>
      </div>
      <div class="cs-panel-body">${renderTaskTable(state)}</div>
    </div>`;
  }

  function renderAccountingContacts(state) {
    const contacts = state.accountingContacts;
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Accounting Transmittal Contacts</div>
          <div class="cs-panel-sub">No accounting recipients are seeded. Add the real routing contacts here before using Send to Accounting.</div>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-control-grid" style="margin-bottom:12px">
          <label class="cs-field"><span>Property</span><select id="atlas-cs-accounting-property">${propertyOptionsHtml("all", true)}</select></label>
          <label class="cs-field"><span>Name</span><input id="atlas-cs-accounting-name" placeholder="Contact name"></label>
          <label class="cs-field"><span>Email</span><input id="atlas-cs-accounting-email" type="email" placeholder="name@company.com"></label>
          <label class="cs-field"><span>Role</span><input id="atlas-cs-accounting-role" placeholder="Accounting, AP, AR, etc."></label>
          <div class="cs-field"><span>&nbsp;</span><button type="button" class="cs-btn cs-btn-primary" onclick="atlasCsAddAccountingContact()">${icon("plus")} Add Contact</button></div>
        </div>
        ${contacts.length ? `<div class="cs-table-wrap"><table class="cs-table"><thead><tr><th>Contact</th><th>Property Scope</th><th>Role</th><th></th></tr></thead><tbody>${contacts.map(contact => `<tr><td><div class="cs-name-cell"><strong>${escapeHtml(contact.name)}</strong><span>${escapeHtml(contact.email)}</span></div></td><td>${escapeHtml(contact.propertyName === "all" ? "All properties" : contact.propertyName)}</td><td>${escapeHtml(contact.role || "Not listed")}</td><td class="right"><button type="button" class="cs-btn cs-btn-sm cs-btn-danger" data-id="${escapeAttr(contact.id)}" onclick="atlasCsDeleteAccountingContact(this.dataset.id)">Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="cs-empty"><div><strong>No accounting contacts configured.</strong><br>Add real routing contacts before sending MORF/SODA or final-accounting work from Central Services.</div></div>`}
      </div>
    </div>`;
  }

  function renderSettings(state, employees) {
    return `<div style="display:grid;gap:14px">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Central Services Employees</div>
            <div class="cs-panel-sub">Sourced from the employee roster page using Centra or Central Services department signals.</div>
          </div>
        </div>
        <div class="cs-panel-body">${renderRosterPanel(employees)}</div>
      </div>
      ${renderAccountingContacts(state)}
    </div>`;
  }

  function renderArchitecture() {
    const entities = ["ATLAS Properties", "Employee Roster", "Renewal Import", "Renewal Record", "Move-Out Case", "MOG", "Inspection", "Accounting"].map(label => `<div class="cs-entity"><strong>${escapeHtml(label)}</strong><span>Connected through shared ATLAS records and Central Services workflow IDs.</span></div>`).join("");
    return `<div style="display:grid;gap:14px">
      <div class="cs-panel">
        <div class="cs-panel-head">
          <div>
            <div class="cs-panel-title">Central Services Data Architecture</div>
            <div class="cs-panel-sub">The workspace compiles portfolio data from ATLAS and creates workflow records only from imports or user actions.</div>
          </div>
          <button type="button" class="cs-btn cs-btn-sm" onclick="atlasCsSetModule('questions')">Open Build Questions</button>
        </div>
        <div class="cs-panel-body"><div class="cs-entity-map">${entities}</div></div>
      </div>
      <div class="cs-architecture-grid">
        <div class="cs-architecture-item"><h3>What is live now</h3><p>All properties in ATLAS are considered in the compiled property summaries. Central Services employees are read from the People roster when their department fields identify them as Centra or Central Services.</p></div>
        <div class="cs-architecture-item"><h3>What stays empty until connected</h3><p>Resident-level renewal rows, move-out cases, collections, evictions, invoices, AP contacts, and tasks remain empty until they come from a report import or a user-created workflow action.</p></div>
        <div class="cs-architecture-item"><h3>Renewal import behavior</h3><p>The actual Entrata renewal report creates persistent resident workflow records, updates ATLAS summary metrics, and creates move-out cases when a row is marked NTV.</p></div>
        <div class="cs-architecture-item"><h3>Next build area</h3><p>The unanswered workflow sections need process rules before I wire buttons into document, messaging, scheduling, legal, collections, and accounting systems.</p></div>
      </div>
    </div>`;
  }

  function renderQuestions() {
    const questions = [
      "Which exact employee roster department values should count as Central Services or Centra?",
      "Should Central Services include inactive/retired ATLAS properties, or only active communities?",
      "Which Entrata renewal export will be the resident-level source of truth, and does it include resident ID and lease ID?",
      "What should happen after each NTV: MOG generation, e-signature, inspection scheduling, MORF/SODA, and accounting handoff?",
      "Who receives accounting transmittals, and does routing vary by property, region, ownership group, or transaction type?",
      "Which workflow should be built first: MOG, inspections, MORF/SODA, collections, evictions, or invoice processing?",
      "What are the SLA rules for renewal follow-up, MOG signature, inspection scheduling, MORF/SODA completion, and accounting confirmation?",
      "Which roles can edit records, close tasks, send resident documents, and change accounting or legal status?"
    ];
    return `<div class="cs-panel">
      <div class="cs-panel-head">
        <div>
          <div class="cs-panel-title">Build Questions</div>
          <div class="cs-panel-sub">These are the details needed before the drilldowns can become full operational workflows instead of placeholders.</div>
        </div>
      </div>
      <div class="cs-panel-body">
        <div class="cs-architecture-grid">
          ${questions.map((question, idx) => `<div class="cs-architecture-item"><h3>${idx + 1}. ${escapeHtml(question)}</h3><p>Answering this lets ATLAS connect the button to a real record, rule, recipient, or source system.</p></div>`).join("")}
        </div>
      </div>
    </div>`;
  }

  function renderImportHistory(state) {
    if (!state.importHistory.length) return "";
    return `<div class="cs-alert">
      Last import: ${escapeHtml(state.importHistory[0].propertyName)} - ${escapeHtml(state.importHistory[0].fileName)} - ${escapeHtml(state.importHistory[0].rowCount)} rows - ${escapeHtml(formatDate(state.importHistory[0].importedAt) || state.importHistory[0].importedAt)}
    </div>`;
  }

  function renderModule(state, employees) {
    if (state.ui.module === "renewals") return renderRenewals(state, employees);
    if (state.ui.module === "moveOuts") return renderMoveOuts(state);
    if (state.ui.module === "inspections") return renderInspections(state);
    if (state.ui.module === "collections") return renderEmptyWorkflowModule(state, {
      key: "collections",
      title: "Delinquency & Collections",
      sub: "Waiting on the real delinquency source, ownership rules, and follow-up cadence.",
      empty: "No collection records are connected. This module will stay empty until the source report or system integration is defined."
    });
    if (state.ui.module === "evictions") return renderEmptyWorkflowModule(state, {
      key: "evictions",
      title: "Evictions",
      sub: "Waiting on legal status source, role permissions, and attorney/court workflow rules.",
      empty: "No eviction records are connected. Once the source and stages are confirmed, drilldowns can become real legal workflow records."
    });
    if (state.ui.module === "invoices") return renderEmptyWorkflowModule(state, {
      key: "invoices",
      title: "Invoice Processing",
      sub: "Waiting on invoice intake source, PO matching rules, and approval routing.",
      empty: "No invoice records are connected. Add the source and routing rules before invoice buttons are wired."
    });
    if (state.ui.module === "tasks") return renderTasks(state);
    if (state.ui.module === "settings") return renderSettings(state, employees);
    if (state.ui.module === "architecture") return renderArchitecture(state);
    if (state.ui.module === "questions") return renderQuestions(state);
    return renderOverview(state, employees);
  }

  function renderCentralServices() {
    const state = loadState();
    const employees = getCentralServicesEmployees();
    const monthLabel = MONTH_LABELS[selectedMonthIdx(state)];
    return `<div class="cs-page">
      <div class="cs-command-header">
        <div>
          <div class="cs-kicker">ATLAS Central Services</div>
          <div class="cs-command-title">Central Services Workspace</div>
          <div class="cs-command-copy">This workspace compiles live ATLAS portfolio data across all selected properties and uses the employee roster to identify Central Services team members. It does not display seeded residents, fake contacts, or mock tasks. Workflow records appear only after a real import or a user action creates them.</div>
          <div class="cs-chip-row" style="margin-top:10px">
            <span class="cs-chip is-strong">${escapeHtml(monthLabel)} ${escapeHtml(selectedYear(state))}</span>
            <span class="cs-chip">${escapeHtml(state.ui.propertyId === "all" ? "All ATLAS properties" : state.ui.propertyId)}</span>
            <span class="cs-chip">${escapeHtml(employees.length)} roster employees</span>
          </div>
        </div>
        <div class="cs-command-actions">
          <button type="button" class="cs-btn" onclick="atlasCsSetModule('architecture')">${icon("blueprint")} Architecture</button>
          <button type="button" class="cs-btn" onclick="atlasCsExportData()">${icon("download-simple")} Export Data</button>
          <button type="button" class="cs-btn cs-btn-primary" onclick="atlasCsSetModule('questions')">${icon("question")} Build Questions</button>
        </div>
      </div>
      ${renderModuleNav(state)}
      ${renderControls(state)}
      ${renderImportHistory(state)}
      ${!employees.length ? `<div class="cs-alert is-warn">Central Services ownership is currently unassigned because no active employees in the roster match Centra or Central Services department fields.</div>` : ""}
      ${renderModule(state, employees)}
    </div>`;
  }

  function getImportControlValue(id) {
    return cleanString(document.getElementById(id)?.value);
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const source = String(text || "");
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (char === '"' && inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") index += 1;
        row.push(cell);
        if (row.some(value => cleanString(value))) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell);
    if (row.some(value => cleanString(value))) rows.push(row);
    return rows;
  }

  function findHeaderIndex(rows) {
    return rows.findIndex(row => {
      const keys = row.map(normalizeKey);
      const joined = keys.join(" ");
      return /(resident|tenant|name)/.test(joined) && /(unit|apartment|apt)/.test(joined) && /(expiration|lease end|expire)/.test(joined);
    });
  }

  function rowsToObjects(rows) {
    const headerIndex = findHeaderIndex(rows);
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map(header => normalizeKey(header));
    return rows.slice(headerIndex + 1).map(row => {
      const object = {};
      headers.forEach((header, idx) => {
        if (header) object[header] = row[idx];
      });
      return object;
    }).filter(row => Object.values(row).some(value => cleanString(value)));
  }

  function findAliasedValue(row, fieldName) {
    const aliases = RENEWAL_FIELD_ALIASES[fieldName] || [];
    for (const alias of aliases) {
      const key = normalizeKey(alias);
      if (row[key] !== undefined && cleanString(row[key])) return row[key];
    }
    return "";
  }

  function yesValue(value) {
    const normalized = normalizeKey(value);
    return ["yes", "y", "true", "signed", "received", "x", "1"].includes(normalized);
  }

  function inferRenewalStatus(row) {
    const explicit = cleanString(findAliasedValue(row, "status"));
    if (explicit) return explicit;
    if (yesValue(findAliasedValue(row, "renewalSigned"))) return "Renewal Signed";
    if (yesValue(findAliasedValue(row, "transfer"))) return "Transfer";
    if (yesValue(findAliasedValue(row, "ntvReceived"))) return "NTV Received";
    return "Pending Decision";
  }

  function mapRenewalRecord(row, context, employees) {
    const residentName = cleanString(findAliasedValue(row, "residentName"));
    const unit = cleanString(findAliasedValue(row, "unit"));
    const expirationDate = normalizeDate(findAliasedValue(row, "expirationDate"));
    if (!residentName || !unit || !expirationDate) return null;
    const residentId = cleanString(findAliasedValue(row, "residentId"));
    const leaseId = cleanString(findAliasedValue(row, "leaseId"));
    const id = makeId("renewal", [
      context.propertyName,
      residentId,
      leaseId,
      residentName,
      unit,
      expirationDate
    ]);
    const status = inferRenewalStatus(row);
    return {
      id,
      source: "renewal_import",
      sourceFileName: context.fileName,
      importedAt: new Date().toISOString(),
      propertyName: context.propertyName,
      monthIdx: context.monthIdx,
      year: context.year,
      periodKey: localPeriodKey(context.monthIdx, context.year),
      residentName,
      residentId,
      leaseId,
      unit,
      unitType: cleanString(findAliasedValue(row, "unitType")),
      expirationDate,
      notice90Date: normalizeDate(findAliasedValue(row, "notice90Date")),
      notice60Date: normalizeDate(findAliasedValue(row, "notice60Date")),
      notice30Date: normalizeDate(findAliasedValue(row, "notice30Date")),
      depositHeld: numberValue(findAliasedValue(row, "depositHeld")),
      currentRate: numberValue(findAliasedValue(row, "currentRate")),
      recommendedOffer: numberValue(findAliasedValue(row, "recommendedOffer")),
      investorOverridePct: numberValue(findAliasedValue(row, "investorOverridePct")),
      investorOverrideOffer: numberValue(findAliasedValue(row, "investorOverrideOffer")),
      offer1: numberValue(findAliasedValue(row, "offer1")),
      offer2: numberValue(findAliasedValue(row, "offer2")),
      offer3: numberValue(findAliasedValue(row, "offer3")),
      signedOffer: numberValue(findAliasedValue(row, "signedOffer")),
      ntvReceivedDate: normalizeDate(findAliasedValue(row, "ntvReceivedDate")),
      scheduledMoveOutDate: normalizeDate(findAliasedValue(row, "scheduledMoveOutDate")),
      phone: cleanString(findAliasedValue(row, "phone")),
      email: cleanString(findAliasedValue(row, "email")).toLowerCase(),
      notes: cleanString(findAliasedValue(row, "notes")),
      marketRate: numberValue(findAliasedValue(row, "marketRate")),
      budgetRate: numberValue(findAliasedValue(row, "budgetRate")),
      occupancyPosition: cleanString(findAliasedValue(row, "occupancyPosition")),
      rentGrowthOffer1: numberValue(findAliasedValue(row, "rentGrowthOffer1")),
      rentGrowthOffer2: numberValue(findAliasedValue(row, "rentGrowthOffer2")),
      rentGrowthOffer3: numberValue(findAliasedValue(row, "rentGrowthOffer3")),
      signedRentGrowth: cleanString(findAliasedValue(row, "signedRentGrowth")),
      status,
      owner: defaultOwner(employees),
      nextAction: status === "NTV Received" ? "Create move-out workflow" : "Review renewal decision",
      dueDate: normalizeDate(findAliasedValue(row, "notice30Date")) || normalizeDate(findAliasedValue(row, "notice60Date")) || normalizeDate(findAliasedValue(row, "notice90Date")) || expirationDate,
      activity: [{
        at: new Date().toISOString(),
        label: `Imported from ${context.fileName}`
      }]
    };
  }

  async function parseRenewalFile(file, context, employees) {
    const lower = cleanString(file.name).toLowerCase();
    let rows = [];
    if (lower.endsWith(".csv")) {
      rows = rowsToObjects(parseCsvRows(await file.text()));
    } else {
      if (typeof XLSX === "undefined") throw new Error("The spreadsheet parser is not available in this ATLAS session.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      workbook.SheetNames.forEach(sheetName => {
        const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
        rows = rows.concat(rowsToObjects(sheetRows));
      });
    }
    return rows.map(row => mapRenewalRecord(row, context, employees)).filter(Boolean);
  }

  function upsertRenewals(state, rows) {
    const byId = new Map(state.renewals.map(row => [row.id, row]));
    rows.forEach(row => {
      const existing = byId.get(row.id);
      byId.set(row.id, {
        ...existing,
        ...row,
        owner: existing?.owner && existing.owner !== "Unassigned" ? existing.owner : row.owner,
        notes: existing?.notes ? existing.notes : row.notes,
        activity: [...asArray(existing?.activity), ...asArray(row.activity)].slice(-50)
      });
    });
    state.renewals = [...byId.values()];
  }

  function renewalIsNtv(row) {
    const status = cleanString(row.status).toLowerCase();
    return status.includes("ntv") || status.includes("notice");
  }

  function createMoveOutCaseFromRenewal(state, row) {
    if (!row || !renewalIsNtv(row)) return null;
    const id = makeId("moveout", [row.id, row.propertyName, row.unit, row.expirationDate]);
    const existing = state.moveOutCases.find(item => item.id === id);
    if (existing) return existing;
    const caseRecord = {
      id,
      renewalId: row.id,
      source: "renewal_ntv",
      sourceFileName: row.sourceFileName,
      createdAt: new Date().toISOString(),
      periodKey: row.periodKey,
      propertyName: row.propertyName,
      residentName: row.residentName,
      residentId: row.residentId,
      leaseId: row.leaseId,
      unit: row.unit,
      unitType: row.unitType,
      phone: row.phone,
      email: row.email,
      leaseExpiration: row.expirationDate,
      scheduledMoveOutDate: row.scheduledMoveOutDate,
      depositHeld: row.depositHeld,
      ntvReceivedDate: row.ntvReceivedDate,
      owner: row.owner || "Unassigned",
      workflowStatus: "MOG Required",
      mogStatus: "Not Initiated",
      inspectionStatus: "Not Scheduled",
      morfSodaStatus: "Not Started",
      accountingStatus: "Not Sent",
      forwardingAddress: "",
      notes: row.notes || "",
      activity: [{
        at: new Date().toISOString(),
        label: "Move-out case created from imported NTV renewal record."
      }]
    };
    state.moveOutCases.unshift(caseRecord);
    state.tasks.unshift({
      id: makeId("task", [id, "mog-required"]),
      sourceCaseId: id,
      sourceRenewalId: row.id,
      type: "Move-Out",
      propertyName: row.propertyName,
      residentName: row.residentName,
      title: `Prepare MOG for ${row.residentName}`,
      owner: row.owner || "Unassigned",
      dueDate: TODAY_ISO,
      status: "Open",
      priority: "High",
      createdAt: new Date().toISOString()
    });
    addAudit(state, "Created move-out case from imported NTV", { residentName: row.residentName, propertyName: row.propertyName });
    return caseRecord;
  }

  function createMoveOutCasesForNtvRows(state, rows) {
    rows.filter(renewalIsNtv).forEach(row => createMoveOutCaseFromRenewal(state, row));
  }

  function syncRenewalSummaryToAtlas(propertyName, monthIdx, year, state) {
    const rows = state.renewals.filter(row => row.propertyName === propertyName && row.periodKey === localPeriodKey(monthIdx, year));
    if (!rows.length) return;
    const summary = summarizeRenewalRows(rows);
    try {
      if (typeof savedData === "undefined") return;
      const matched = typeof matchPropertyName === "function" ? matchPropertyName(propertyName, { fallbackToCurrent: false }) || propertyName : propertyName;
      const record = typeof normalizeSavedCommunityRecord === "function"
        ? normalizeSavedCommunityRecord(matched, savedData?.[matched] || {})
        : asObject(savedData?.[matched]);
      if (typeof applyRenewalSummaryToRecord === "function") {
        applyRenewalSummaryToRecord(record, monthIdx, {
          expirations: summary.expirations,
          renewalsSigned: summary.signed,
          ntv: summary.ntv,
          transfers: summary.transfers,
          undecided: summary.undecided,
          earlyTermination: summary.earlyTermination
        }, year);
      } else {
        record.monthlyData = Array.isArray(record.monthlyData) ? record.monthlyData : [];
        record.monthlyData[monthIdx] = {
          ...asObject(record.monthlyData[monthIdx]),
          renewalExpirations: summary.expirations,
          renewalSigned: summary.signed,
          renewalNTV: summary.ntv,
          renewalTransfers: summary.transfers,
          renewalUndecided: summary.undecided,
          renewalEarlyTermination: summary.earlyTermination
        };
      }
      try {
        if (typeof setRecordPeriodImportStamp === "function") {
          setRecordPeriodImportStamp(record, "renewals", localPeriodKey(monthIdx, year), {
            importedAt: new Date().toISOString(),
            sourceFileName: "Central Services detailed renewal import",
            propertyName
          });
        }
      } catch {
        // Import tracking is optional.
      }
      savedData[matched] = record;
      if (typeof persistSaved === "function") persistSaved();
      if (typeof renderPropGrid === "function") renderPropGrid();
    } catch (error) {
      console.warn("Central Services could not sync renewal summary to ATLAS", error);
    }
  }

  function findMoveOutCase(state, id) {
    return state.moveOutCases.find(item => item.id === id);
  }

  function pushCaseActivity(caseRecord, label) {
    caseRecord.activity = asArray(caseRecord.activity);
    caseRecord.activity.unshift({ at: new Date().toISOString(), label });
    caseRecord.activity = caseRecord.activity.slice(0, 50);
  }

  function getAccountingContactForCase(state, caseRecord) {
    return state.accountingContacts.find(contact => contact.propertyName === caseRecord.propertyName) || state.accountingContacts.find(contact => contact.propertyName === "all");
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  window.renderCentralServicesTab = renderCentralServices;

  window.atlasCsSetModule = function (module) {
    const state = loadState();
    state.ui.module = MODULES.some(([key]) => key === module) ? module : "overview";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetProperty = function (propertyName) {
    const state = loadState();
    state.ui.propertyId = cleanString(propertyName) || "all";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetMonth = function (value) {
    const state = loadState();
    state.ui.monthIdx = Math.max(0, Math.min(11, Number(value) || 0));
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetYear = function (value) {
    const state = loadState();
    state.ui.year = Number.isFinite(Number(value)) ? Number(value) : new Date().getFullYear();
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSetSearch = function (value) {
    const state = loadState();
    state.ui.search = cleanString(value);
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDrill = function (module, filter) {
    const state = loadState();
    state.ui.module = MODULES.some(([key]) => key === module) ? module : "overview";
    state.ui.workflowFilter = cleanString(filter) || "all";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsOpenPropertyRenewals = function (propertyName) {
    const state = loadState();
    state.ui.propertyId = cleanString(propertyName) || "all";
    state.ui.module = "renewals";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSelectRenewal = function (id) {
    const state = loadState();
    state.ui.selectedRenewalId = cleanString(id);
    state.ui.module = "renewals";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateRenewalField = function (id, field, value) {
    const state = loadState();
    const allowed = new Set(["owner", "nextAction", "dueDate", "notes"]);
    if (!allowed.has(field)) return;
    const row = state.renewals.find(item => item.id === id);
    if (!row) return;
    row[field] = field === "dueDate" ? normalizeDate(value) : cleanString(value);
    row.activity = asArray(row.activity);
    row.activity.unshift({ at: new Date().toISOString(), label: `Updated ${field}.` });
    addAudit(state, "Updated renewal field", { id, field });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateRenewalStatus = function (id, status) {
    const state = loadState();
    const row = state.renewals.find(item => item.id === id);
    if (!row) return;
    row.status = cleanString(status) || "Pending Decision";
    row.activity = asArray(row.activity);
    row.activity.unshift({ at: new Date().toISOString(), label: `Status changed to ${row.status}.` });
    if (renewalIsNtv(row)) createMoveOutCaseFromRenewal(state, row);
    syncRenewalSummaryToAtlas(row.propertyName, row.monthIdx, row.year, state);
    addAudit(state, "Updated renewal status", { id, status: row.status });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCreateMoveOutFromRenewal = function (id) {
    const state = loadState();
    const row = state.renewals.find(item => item.id === id);
    if (!row) return;
    if (!renewalIsNtv(row)) {
      alert("Set the renewal status to NTV Received before creating a move-out case.");
      return;
    }
    const caseRecord = createMoveOutCaseFromRenewal(state, row);
    state.ui.module = "moveOuts";
    state.ui.selectedMoveOutId = caseRecord?.id || "";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsHandleRenewalUpload = async function (input) {
    const file = input?.files?.[0];
    if (!file) return;
    const propertyName = getImportControlValue("atlas-cs-renewal-property");
    if (!propertyName || propertyName === "all") {
      alert("Choose the ATLAS property for this renewal report before importing.");
      input.value = "";
      return;
    }
    const monthIdx = Math.max(0, Math.min(11, Number(getImportControlValue("atlas-cs-renewal-month")) || 0));
    const year = Number(getImportControlValue("atlas-cs-renewal-year")) || new Date().getFullYear();
    const state = loadState();
    const employees = getCentralServicesEmployees();
    try {
      const rows = await parseRenewalFile(file, { propertyName, monthIdx, year, fileName: file.name }, employees);
      if (!rows.length) {
        alert("No resident-level renewal rows could be imported. Check that the file includes resident name, unit, and lease expiration columns.");
        input.value = "";
        return;
      }
      upsertRenewals(state, rows);
      createMoveOutCasesForNtvRows(state, rows);
      syncRenewalSummaryToAtlas(propertyName, monthIdx, year, state);
      state.importHistory.unshift({
        id: makeId("import", [file.name, propertyName, Date.now()]),
        importedAt: new Date().toISOString(),
        fileName: file.name,
        propertyName,
        monthIdx,
        year,
        rowCount: rows.length,
        ntvCount: rows.filter(renewalIsNtv).length,
        source: "Entrata renewal report upload"
      });
      state.importHistory = state.importHistory.slice(0, 50);
      state.ui.module = "renewals";
      state.ui.propertyId = propertyName;
      state.ui.monthIdx = monthIdx;
      state.ui.year = year;
      addAudit(state, "Imported renewal report", { propertyName, fileName: file.name, rows: rows.length });
      saveState(state);
      input.value = "";
      renderActiveTab();
    } catch (error) {
      alert(`Renewal import failed: ${error?.message || error}`);
      input.value = "";
    }
  };

  window.atlasCsSelectMoveOut = function (id) {
    const state = loadState();
    state.ui.selectedMoveOutId = cleanString(id);
    state.ui.module = "moveOuts";
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsUpdateMoveOutField = function (id, field, value) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item || !["notes", "scheduledMoveOutDate", "forwardingAddress"].includes(field)) return;
    item[field] = field === "scheduledMoveOutDate" ? normalizeDate(value) : cleanString(value);
    pushCaseActivity(item, `Updated ${field}.`);
    addAudit(state, "Updated move-out case", { id, field });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSendMog = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    item.mogStatus = "Awaiting Signature";
    item.workflowStatus = "Awaiting Signature";
    pushCaseActivity(item, "MOG marked as sent and awaiting resident signature.");
    addAudit(state, "Sent MOG", { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCompleteMog = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const forwardingAddress = prompt("Enter the forwarding address captured on the signed MOG.");
    if (!cleanString(forwardingAddress)) {
      alert("The signed MOG needs a forwarding address before this step can be completed.");
      return;
    }
    item.forwardingAddress = cleanString(forwardingAddress);
    item.mogStatus = "Completed";
    item.workflowStatus = "MOG Completed";
    item.mogCompletedAt = new Date().toISOString();
    pushCaseActivity(item, "MOG completed with forwarding address.");
    addAudit(state, "Completed MOG", { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsScheduleInspection = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const date = normalizeDate(prompt("Enter the inspection date (for example, 2026-09-15)."));
    if (!date) {
      alert("Enter a valid inspection date to schedule the inspection.");
      return;
    }
    item.inspectionDate = date;
    item.inspectionStatus = "Inspection Scheduled";
    item.workflowStatus = "Inspection Scheduled";
    pushCaseActivity(item, `Inspection scheduled for ${date}.`);
    addAudit(state, "Scheduled inspection", { id, date });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsCompleteInspection = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    item.inspectionStatus = "Completed";
    item.workflowStatus = "Inspection Completed";
    item.inspectionCompletedAt = new Date().toISOString();
    pushCaseActivity(item, "Inspection marked complete.");
    addAudit(state, "Completed inspection", { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsSendToAccounting = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    const contact = getAccountingContactForCase(state, item);
    if (!contact) {
      alert("Add the real accounting contact in Central Services Settings before sending this case to accounting.");
      state.ui.module = "settings";
      saveState(state);
      renderActiveTab();
      return;
    }
    item.accountingStatus = "Sent to Accounting";
    item.workflowStatus = "Sent to Accounting";
    item.accountingContactName = contact.name;
    item.accountingContactEmail = contact.email;
    pushCaseActivity(item, `Sent to accounting contact ${contact.name} (${contact.email}).`);
    addAudit(state, "Sent case to accounting", { id, contact: contact.email });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDownloadCasePacket = function (id) {
    const state = loadState();
    const item = findMoveOutCase(state, id);
    if (!item) return;
    downloadJson(`central-services-${item.propertyName}-${item.unit || item.id}.json`.replace(/[^a-z0-9_.-]+/gi, "-"), item);
  };

  window.atlasCsOpenTask = function (id) {
    const state = loadState();
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;
    state.ui.selectedTaskId = id;
    if (task.sourceCaseId) {
      state.ui.module = "moveOuts";
      state.ui.selectedMoveOutId = task.sourceCaseId;
    } else if (task.sourceRenewalId) {
      state.ui.module = "renewals";
      state.ui.selectedRenewalId = task.sourceRenewalId;
    } else {
      state.ui.module = "tasks";
    }
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsToggleTask = function (id) {
    const state = loadState();
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;
    task.status = task.status === "Completed" ? "Open" : "Completed";
    task.completedAt = task.status === "Completed" ? new Date().toISOString() : "";
    addAudit(state, `${task.status === "Completed" ? "Completed" : "Reopened"} task`, { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsAddAccountingContact = function () {
    const state = loadState();
    const propertyName = getImportControlValue("atlas-cs-accounting-property") || "all";
    const name = getImportControlValue("atlas-cs-accounting-name");
    const email = getImportControlValue("atlas-cs-accounting-email").toLowerCase();
    const role = getImportControlValue("atlas-cs-accounting-role");
    if (!name || !email || !email.includes("@")) {
      alert("Enter a real accounting contact name and email address.");
      return;
    }
    state.accountingContacts.push({
      id: makeId("acct", [propertyName, email]),
      propertyName,
      name,
      email,
      role,
      createdAt: new Date().toISOString()
    });
    addAudit(state, "Added accounting contact", { propertyName, email });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsDeleteAccountingContact = function (id) {
    const state = loadState();
    state.accountingContacts = state.accountingContacts.filter(contact => contact.id !== id);
    addAudit(state, "Removed accounting contact", { id });
    saveState(state);
    renderActiveTab();
  };

  window.atlasCsExportData = function () {
    const state = loadState();
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      scope: {
        propertyId: state.ui.propertyId,
        month: MONTH_LABELS[selectedMonthIdx(state)],
        year: selectedYear(state)
      },
      centralServicesEmployees: getCentralServicesEmployees(),
      propertyMonthSummaries: getPropertyMonthSummaries(state),
      centralServicesState: state
    };
    downloadJson("atlas-central-services-export.json", exportPayload);
  };
})();
