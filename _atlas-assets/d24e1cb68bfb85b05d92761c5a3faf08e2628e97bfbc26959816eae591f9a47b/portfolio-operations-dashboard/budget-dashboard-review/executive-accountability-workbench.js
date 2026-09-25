(() => {
  const STORAGE_KEY = "rise_exec_accountability_workbench_v1";

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

  const SAMPLE_MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];

  const SAMPLE_PROPERTIES = [
    {
      property: "Harbor Flats",
      units: 240,
      budgets: {
        rentalIncome: 190000,
        otherIncome: 7000,
        concessions: -3000,
        badDebt: -2500,
        payroll: 33000,
        utilities: 14000,
        repairsMaintenance: 12000,
        turnExpense: 8000,
      },
      financialMultipliers: {
        rentalIncome: [0.997, 1.002, 1.005, 1.008],
        otherIncome: [1.0, 1.02, 1.01, 1.03],
        concessions: [1.0, 0.96, 0.91, 0.88],
        badDebt: [1.0, 0.98, 0.95, 0.91],
        payroll: [1.01, 1.0, 1.02, 1.01],
        utilities: [0.98, 1.0, 0.97, 0.99],
        repairsMaintenance: [0.97, 1.03, 0.98, 0.96],
        turnExpense: [0.92, 1.0, 0.94, 0.9],
      },
      operations: {
        turns: [6, 5, 5, 4],
        openWorkOrders: [15, 14, 12, 11],
        completedWorkOrders: [26, 28, 30, 29],
        avgMakeReadyDays: [7, 7, 6, 6],
        payrollHours: [1320, 1310, 1335, 1325],
        overtimeHours: [18, 16, 14, 12],
      },
      leasing: {
        occupancyPct: [96.2, 96.4, 96.6, 96.8],
        leasedPct: [96.9, 97.0, 97.2, 97.4],
        concessionsPct: [2.4, 2.3, 2.2, 2.1],
        traffic: [46, 48, 47, 48],
        applications: [18, 19, 18, 19],
        leases: [12, 13, 12, 13],
        delinquencyPct: [1.5, 1.4, 1.3, 1.2],
      },
    },
    {
      property: "Cypress Pointe",
      units: 220,
      budgets: {
        rentalIncome: 175000,
        otherIncome: 6000,
        concessions: -4000,
        badDebt: -3000,
        payroll: 31000,
        utilities: 13500,
        repairsMaintenance: 11000,
        turnExpense: 9000,
      },
      financialMultipliers: {
        rentalIncome: [0.98, 0.985, 0.99, 0.992],
        otherIncome: [0.99, 1.0, 1.01, 1.02],
        concessions: [1.05, 1.08, 1.12, 1.15],
        badDebt: [1.05, 1.08, 1.1, 1.12],
        payroll: [1.02, 1.04, 1.08, 1.09],
        utilities: [1.01, 1.03, 1.04, 1.05],
        repairsMaintenance: [1.0, 1.04, 1.08, 1.1],
        turnExpense: [1.05, 1.07, 1.1, 1.12],
      },
      operations: {
        turns: [9, 10, 11, 12],
        openWorkOrders: [21, 24, 26, 29],
        completedWorkOrders: [31, 33, 36, 38],
        avgMakeReadyDays: [8, 9, 10, 10],
        payrollHours: [1280, 1298, 1315, 1322],
        overtimeHours: [24, 28, 34, 37],
      },
      leasing: {
        occupancyPct: [93.8, 93.4, 93.0, 92.8],
        leasedPct: [95.0, 94.7, 94.3, 94.1],
        concessionsPct: [3.8, 4.0, 4.3, 4.5],
        traffic: [55, 58, 59, 61],
        applications: [18, 19, 20, 20],
        leases: [11, 11, 12, 12],
        delinquencyPct: [2.8, 3.0, 3.1, 3.3],
      },
    },
    {
      property: "Lake Vista",
      units: 205,
      budgets: {
        rentalIncome: 160000,
        otherIncome: 5500,
        concessions: -3500,
        badDebt: -2800,
        payroll: 29500,
        utilities: 15000,
        repairsMaintenance: 11500,
        turnExpense: 8500,
      },
      financialMultipliers: {
        rentalIncome: [0.99, 0.995, 1.0, 1.005],
        otherIncome: [1.0, 1.01, 1.0, 1.02],
        concessions: [1.0, 1.02, 1.05, 1.08],
        badDebt: [1.0, 1.03, 1.05, 1.08],
        payroll: [1.0, 1.01, 1.03, 1.05],
        utilities: [1.08, 1.12, 1.15, 1.18],
        repairsMaintenance: [1.04, 1.08, 1.12, 1.18],
        turnExpense: [0.98, 1.0, 1.04, 1.06],
      },
      operations: {
        turns: [7, 8, 8, 9],
        openWorkOrders: [18, 19, 21, 23],
        completedWorkOrders: [29, 30, 32, 34],
        avgMakeReadyDays: [7, 8, 8, 9],
        payrollHours: [1185, 1195, 1210, 1220],
        overtimeHours: [20, 22, 24, 26],
      },
      leasing: {
        occupancyPct: [94.8, 94.9, 95.0, 95.1],
        leasedPct: [95.8, 96.0, 96.2, 96.4],
        concessionsPct: [3.0, 3.1, 3.2, 3.4],
        traffic: [42, 43, 44, 45],
        applications: [15, 15, 16, 16],
        leases: [9, 10, 10, 10],
        delinquencyPct: [2.0, 2.1, 2.2, 2.3],
      },
    },
    {
      property: "North Terrace",
      units: 198,
      budgets: {
        rentalIncome: 150000,
        otherIncome: 5000,
        concessions: -4500,
        badDebt: -3500,
        payroll: 28500,
        utilities: 14500,
        repairsMaintenance: 10500,
        turnExpense: 7800,
      },
      financialMultipliers: {
        rentalIncome: [0.93, 0.91, 0.89, 0.87],
        otherIncome: [0.96, 0.95, 0.93, 0.9],
        concessions: [1.2, 1.28, 1.38, 1.52],
        badDebt: [1.25, 1.35, 1.45, 1.6],
        payroll: [1.08, 1.12, 1.18, 1.24],
        utilities: [1.06, 1.09, 1.11, 1.12],
        repairsMaintenance: [1.12, 1.18, 1.24, 1.32],
        turnExpense: [1.2, 1.28, 1.36, 1.42],
      },
      operations: {
        turns: [12, 14, 16, 18],
        openWorkOrders: [30, 33, 37, 41],
        completedWorkOrders: [42, 46, 54, 60],
        avgMakeReadyDays: [10, 11, 13, 15],
        payrollHours: [1210, 1240, 1290, 1350],
        overtimeHours: [30, 36, 44, 52],
      },
      leasing: {
        occupancyPct: [91.8, 91.0, 90.2, 89.4],
        leasedPct: [93.0, 92.2, 91.4, 90.7],
        concessionsPct: [5.1, 5.6, 6.2, 6.8],
        traffic: [58, 56, 54, 52],
        applications: [17, 17, 17, 17],
        leases: [9, 9, 8, 8],
        delinquencyPct: [4.2, 4.7, 5.1, 5.6],
      },
    },
  ];

  const FILE_SPECS = {
    financial: {
      label: "Financial",
      required: {
        property: ["property", "propertyname", "community", "asset", "assetname", "site"],
        period: ["period", "month", "asof", "asofmonth", "reportingmonth", "date"],
        section: ["section", "category", "accountsection", "finsection"],
        lineItem: ["lineitem", "accountname", "name", "description", "accountdescription"],
        actual: ["actual", "actualamount", "ytdactual", "mtdactual"],
        budget: ["budget", "budgetamount", "ytdbudget", "mtdbudget"],
      },
      recommended: {
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
        applications: ["applications", "apps"],
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

  const state = {
    layer: "financial",
    selectedPeriod: null,
    selectedProperty: null,
    datasets: {
      financial: null,
      operations: null,
      leasing: null,
    },
  };

  const dom = {
    periodSelect: document.getElementById("period-select"),
    dataReadiness: document.getElementById("data-readiness"),
    snapshotGrid: document.getElementById("snapshot-grid"),
    rankingBody: document.getElementById("ranking-body"),
    selectedPropertyShell: document.getElementById("selected-property-shell"),
    layerContent: document.getElementById("layer-content"),
    crosswalkContent: document.getElementById("crosswalk-content"),
    boardSummary: document.getElementById("board-summary"),
    crosswalkLibrary: document.getElementById("crosswalk-library"),
    exportScorecards: document.getElementById("export-scorecards"),
    exportSummary: document.getElementById("export-summary"),
    exportReport: document.getElementById("export-report"),
    exportPptx: document.getElementById("export-pptx"),
  };

  function normalizeKey(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
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

  function generateSamplePack() {
    const financialRows = [];
    const operationsRows = [];
    const leasingRows = [];

    const actualLookup = new Map();

    const getActual = (propertyName, lineKey, monthIndex) => {
      const lookupKey = `${propertyName}::${lineKey}::${monthIndex}`;
      return actualLookup.get(lookupKey);
    };

    for (const property of SAMPLE_PROPERTIES) {
      for (let monthIndex = 0; monthIndex < SAMPLE_MONTHS.length; monthIndex += 1) {
        const period = SAMPLE_MONTHS[monthIndex];

        for (const line of FINANCIAL_LINES) {
          const monthlyBudget = property.budgets[line.key];
          const actual = Math.round(monthlyBudget * property.financialMultipliers[line.key][monthIndex]);
          actualLookup.set(`${property.property}::${line.key}::${monthIndex}`, actual);

          financialRows.push({
            property: property.property,
            period,
            section: line.section,
            gl_code: line.glCode,
            line_item: line.label,
            actual,
            budget: monthlyBudget,
            annual_budget: monthlyBudget * 12,
          });
        }

        operationsRows.push({
          property: property.property,
          period,
          units: property.units,
          turns: property.operations.turns[monthIndex],
          open_work_orders: property.operations.openWorkOrders[monthIndex],
          completed_work_orders: property.operations.completedWorkOrders[monthIndex],
          avg_make_ready_days: property.operations.avgMakeReadyDays[monthIndex],
          payroll_hours: property.operations.payrollHours[monthIndex],
          overtime_hours: property.operations.overtimeHours[monthIndex],
          payroll_cost: getActual(property.property, "payroll", monthIndex),
          utilities_cost: getActual(property.property, "utilities", monthIndex),
          rm_cost: getActual(property.property, "repairsMaintenance", monthIndex),
        });

        leasingRows.push({
          property: property.property,
          period,
          units: property.units,
          occupancy_pct: property.leasing.occupancyPct[monthIndex],
          leased_pct: property.leasing.leasedPct[monthIndex],
          concessions_pct: property.leasing.concessionsPct[monthIndex],
          traffic: property.leasing.traffic[monthIndex],
          applications: property.leasing.applications[monthIndex],
          leases: property.leasing.leases[monthIndex],
          delinquency_pct: property.leasing.delinquencyPct[monthIndex],
        });
      }
    }

    return {
      financial: toCsv(
        ["property", "period", "section", "gl_code", "line_item", "actual", "budget", "annual_budget"],
        financialRows,
      ),
      operations: toCsv(
        [
          "property",
          "period",
          "units",
          "turns",
          "open_work_orders",
          "completed_work_orders",
          "avg_make_ready_days",
          "payroll_hours",
          "overtime_hours",
          "payroll_cost",
          "utilities_cost",
          "rm_cost",
        ],
        operationsRows,
      ),
      leasing: toCsv(
        [
          "property",
          "period",
          "units",
          "occupancy_pct",
          "leased_pct",
          "concessions_pct",
          "traffic",
          "applications",
          "leases",
          "delinquency_pct",
        ],
        leasingRows,
      ),
    };
  }

  const samplePack = generateSamplePack();

  function parseDataset(type, text, fileName) {
    const spec = FILE_SPECS[type];
    const rows = parseCsv(text);

    if (!rows.length) {
      return {
        type,
        fileName,
        sourceText: text,
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
      const headerToIndex = Object.fromEntries(headers.map((header, index) => [header, index]));

      for (const rowCells of rows.slice(1)) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = rowCells[index] ?? "";
        });

        if (type === "financial") {
          const property = getField(row, fieldInfo.detected, "property");
          const period = parsePeriod(getField(row, fieldInfo.detected, "period"));
          const section = getField(row, fieldInfo.detected, "section");
          const lineItem = getField(row, fieldInfo.detected, "lineItem");
          const actual = parseAmount(getField(row, fieldInfo.detected, "actual"));
          const budget = parseAmount(getField(row, fieldInfo.detected, "budget"));

          if (!property || !period || !section || !lineItem || (actual == null && budget == null)) {
            continue;
          }

          const annualBudget =
            parseAmount(getField(row, fieldInfo.detected, "annualBudget")) ??
            ((budget ?? 0) * 12);

          records.push({
            property: property.trim(),
            period,
            section: section.trim(),
            lineItem: lineItem.trim(),
            glCode: getField(row, fieldInfo.detected, "glCode").trim(),
            actual: actual ?? 0,
            budget: budget ?? 0,
            annualBudget,
          });
        }

        if (type === "operations") {
          const property = getField(row, fieldInfo.detected, "property");
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
          const property = getField(row, fieldInfo.detected, "property");
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
            applications: parseAmount(getField(row, fieldInfo.detected, "applications")),
            leases: parseAmount(getField(row, fieldInfo.detected, "leases")),
            delinquencyPct: parsePercent(getField(row, fieldInfo.detected, "delinquencyPct")),
          });
        }
      }
    }

    return {
      type,
      fileName,
      sourceText: text,
      records,
      diagnostics: {
        parsedRows: records.length,
        fileRows: Math.max(0, rows.length - 1),
        missingRequired: fieldInfo.missingRequired,
        missingRecommended: fieldInfo.missingRecommended,
        detected: fieldInfo.detected,
      },
    };
  }

  function setDataset(type, text, fileName) {
    state.datasets[type] = parseDataset(type, text, fileName);
    persistState();
    render();
  }

  function clearState() {
    state.selectedPeriod = null;
    state.selectedProperty = null;
    state.layer = "financial";
    state.datasets = {
      financial: null,
      operations: null,
      leasing: null,
    };
    window.localStorage.removeItem(STORAGE_KEY);
    render();
  }

  function persistState() {
    const payload = {
      layer: state.layer,
      selectedPeriod: state.selectedPeriod,
      selectedProperty: state.selectedProperty,
      datasets: Object.fromEntries(
        Object.entries(state.datasets).map(([key, dataset]) => [
          key,
          dataset
            ? {
                fileName: dataset.fileName,
                sourceText: dataset.sourceText,
              }
            : null,
        ]),
      ),
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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

      for (const key of ["financial", "operations", "leasing"]) {
        const entry = parsed.datasets?.[key];
        if (entry?.sourceText) {
          state.datasets[key] = parseDataset(key, entry.sourceText, entry.fileName || `${key}.csv`);
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

  function summarizeFinancial(property, asOf) {
    const dataset = state.datasets.financial;
    if (!dataset) {
      return null;
    }

    const year = String(asOf).slice(0, 4);
    const records = dataset.records.filter(
      (record) => record.property === property && record.period.startsWith(year) && comparePeriod(record.period, asOf) <= 0,
    );

    if (!records.length) {
      return null;
    }

    const periodsObserved = Array.from(new Set(records.map((record) => record.period))).sort(comparePeriod);
    const elapsedMonths = periodsObserved.length || Number(String(asOf).slice(5, 7)) || 1;
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
      const projection = (line.ytdActual / elapsedMonths) * 12;
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
      .reduce((sum, line) => sum + line.projection, 0);
    const projectedExpense = lines
      .filter((line) => !isIncomeSection(line.section))
      .reduce((sum, line) => sum + line.projection, 0);

    const noiActual = revenueActual - expenseActual;
    const noiBudget = revenueBudget - expenseBudget;
    const annualBudgetNoi = annualBudgetRevenue - annualBudgetExpense;
    const projectedNoi = projectedRevenue - projectedExpense;
    const noiVariance = noiActual - noiBudget;
    const projectedGap = projectedNoi - annualBudgetNoi;
    const pacePct = noiBudget ? (noiActual / noiBudget) * 100 : 0;
    const unfavorableNoi = Math.max(0, noiBudget - noiActual);
    const unfavorableProjection = Math.max(0, annualBudgetNoi - projectedNoi);
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
      lines: lines.sort((left, right) => right.unfavorableAmount - left.unfavorableAmount),
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
      score: financialScore,
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
    const turnsPer100 = units ? (record.turns || 0) / units * 100 : null;
    const openWorkOrdersPer100 = units ? (record.openWorkOrders || 0) / units * 100 : null;
    const overtimeHoursPer100 = units ? (record.overtimeHours || 0) / units * 100 : null;
    const payrollCostPerUnit = units ? (record.payrollCost || 0) / units : null;
    const utilitiesCostPerUnit = units ? (record.utilitiesCost || 0) / units : null;
    const rmCostPerUnit = units ? (record.rmCost || 0) / units : null;

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
    ];

    return {
      ...record,
      turnsPer100,
      openWorkOrdersPer100,
      overtimeHoursPer100,
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

    const trafficToLeasePct =
      record.traffic && record.leases != null ? (record.leases / Math.max(record.traffic, 1)) * 100 : null;

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
        label: "Traffic-to-lease",
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

  function buildCrosswalkRows(financial, operations, leasing) {
    if (!financial) {
      return [];
    }

    return financial.lines
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

    const portfolio = {
      revenueActual: financialSummaries.reduce((sum, entry) => sum + entry.revenueActual, 0),
      revenueBudget: financialSummaries.reduce((sum, entry) => sum + entry.revenueBudget, 0),
      expenseActual: financialSummaries.reduce((sum, entry) => sum + entry.expenseActual, 0),
      expenseBudget: financialSummaries.reduce((sum, entry) => sum + entry.expenseBudget, 0),
      projectedNoi: financialSummaries.reduce((sum, entry) => sum + entry.projectedNoi, 0),
      annualBudgetNoi: financialSummaries.reduce((sum, entry) => sum + entry.annualBudgetNoi, 0),
      score: average(propertySummaries.map((summary) => summary.score)),
      occupancyPct: average(leasingSummaries.map((entry) => entry.occupancyPct)),
      delinquencyPct: average(leasingSummaries.map((entry) => entry.delinquencyPct)),
      turnsPer100: average(operationsSummaries.map((entry) => entry.turnsPer100)),
      atRiskCount: propertySummaries.filter((summary) => summary.score != null && summary.score < 55).length,
      watchCount: propertySummaries.filter((summary) => summary.score != null && summary.score >= 55 && summary.score < 75).length,
      topProperties: propertySummaries.slice(0, 3),
      topLines: aggregatePortfolioLines(propertySummaries).slice(0, 4),
      asOf,
    };

    portfolio.noiActual = portfolio.revenueActual - portfolio.expenseActual;
    portfolio.noiBudget = portfolio.revenueBudget - portfolio.expenseBudget;
    portfolio.noiVariance = portfolio.noiActual - portfolio.noiBudget;
    portfolio.projectedGap = portfolio.projectedNoi - portfolio.annualBudgetNoi;

    return portfolio;
  }

  function computeViewModel() {
    const availablePeriods = Array.from(
      new Set(
        Object.values(state.datasets)
          .filter(Boolean)
          .flatMap((dataset) => dataset.records.map((record) => record.period))
          .filter(Boolean),
      ),
    ).sort(comparePeriod);

    if (!availablePeriods.length || !state.datasets.financial?.records.length) {
      return null;
    }

    if (!state.selectedPeriod || !availablePeriods.includes(state.selectedPeriod)) {
      state.selectedPeriod = availablePeriods[availablePeriods.length - 1];
    }

    const properties = Array.from(
      new Set(
        Object.values(state.datasets)
          .filter(Boolean)
          .flatMap((dataset) => dataset.records.map((record) => record.property))
          .filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right));

    const propertySummaries = properties
      .map((property) => buildPropertySummary(property, state.selectedPeriod))
      .filter(Boolean)
      .sort((left, right) => (left.score ?? 100) - (right.score ?? 100));

    if (!state.selectedProperty || !propertySummaries.find((summary) => summary.property === state.selectedProperty)) {
      state.selectedProperty = propertySummaries[0]?.property || null;
    }

    const selectedSummary = propertySummaries.find((summary) => summary.property === state.selectedProperty) || null;
    const portfolio = buildPortfolioSummary(propertySummaries, state.selectedPeriod);

    return {
      availablePeriods,
      propertySummaries,
      selectedSummary,
      portfolio,
    };
  }

  function renderCrosswalkLibrary() {
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

  function renderUploadMeta(type) {
    const dataset = state.datasets[type];
    const chip = document.getElementById(`${type}-chip`);
    const meta = document.getElementById(`${type}-meta`);

    if (!dataset) {
      chip.className = "chip";
      chip.textContent = "Awaiting file";
      meta.innerHTML = `<div class="status-line">Upload a ${FILE_SPECS[type].label.toLowerCase()} CSV or load the sample file.</div>`;
      return;
    }

    const { diagnostics } = dataset;
    const statusClass = diagnostics.missingRequired.length ? "bad" : "good";
    chip.className = `chip ${statusClass}`;
    chip.textContent = diagnostics.missingRequired.length
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
        Parsed ${formatNumber(diagnostics.parsedRows)} of ${formatNumber(diagnostics.fileRows || diagnostics.parsedRows)} data row(s).
      </div>
      ${missingRequired}
      ${missingRecommended}
      <div class="chip-row">${detectedTags}</div>
    `;
  }

  function renderReadiness(view) {
    if (!view) {
      dom.dataReadiness.innerHTML =
        "The workbench needs a financial CSV to render accountability, then operations and leasing files complete the driver layers.";
      return;
    }

    const loaded = Object.entries(state.datasets)
      .filter(([, dataset]) => dataset?.records.length)
      .map(([key]) => FILE_SPECS[key].label);

    dom.dataReadiness.innerHTML = `
      Loaded <span class="mono">${loaded.join(", ")}</span>. ${formatNumber(view.propertySummaries.length)} properties in scope through
      <span class="mono">${escapeHtml(view.portfolio.asOf)}</span>.
    `;
  }

  function renderPeriodOptions(view) {
    if (!view) {
      dom.periodSelect.innerHTML = `<option value="">Load data first</option>`;
      return;
    }

    dom.periodSelect.innerHTML = view.availablePeriods
      .map(
        (period) =>
          `<option value="${escapeHtml(period)}" ${period === state.selectedPeriod ? "selected" : ""}>${escapeHtml(period)}</option>`,
      )
      .join("");
  }

  function renderSnapshot(view) {
    if (!view) {
      dom.snapshotGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1">
          Load the sample pack or upload a financial CSV to start building the portfolio view.
        </div>
      `;
      return;
    }

    const stats = [
      {
        label: "YTD NOI",
        value: formatCurrency(view.portfolio.noiActual),
        sub: `Budget ${formatCurrency(view.portfolio.noiBudget)} · Variance ${formatCurrency(view.portfolio.noiVariance)}`,
      },
      {
        label: "Projected FY NOI",
        value: formatCurrency(view.portfolio.projectedNoi),
        sub: `Annual plan ${formatCurrency(view.portfolio.annualBudgetNoi)} · Gap ${formatCurrency(view.portfolio.projectedGap)}`,
      },
      {
        label: "Avg Portfolio Score",
        value: formatNumber(view.portfolio.score, 0),
        sub: `${view.portfolio.atRiskCount} at risk · ${view.portfolio.watchCount} on watch`,
      },
      {
        label: "Average Occupancy",
        value: formatPercent(view.portfolio.occupancyPct),
        sub: `Delinquency ${formatPercent(view.portfolio.delinquencyPct)}`,
      },
      {
        label: "Turns / 100",
        value: formatNumber(view.portfolio.turnsPer100, 1),
        sub: `As of ${escapeHtml(view.portfolio.asOf)}`,
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
      dom.selectedPropertyShell.innerHTML = `<div class="empty-state">Select a property once data is loaded.</div>`;
      return;
    }

    const score = summary.score ?? 0;
    const driverText = summary.crosswalkRows[0]?.reason || "No crosswalk narrative available yet.";

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

      <div class="metric-triad">
        <div class="metric-block">
          <div class="kicker">YTD NOI</div>
          <div class="headline">${formatCurrency(summary.financial?.noiActual)}</div>
          <div class="note">Budget ${formatCurrency(summary.financial?.noiBudget)} · Variance ${formatCurrency(summary.financial?.noiVariance)}</div>
        </div>
        <div class="metric-block">
          <div class="kicker">Projected FY NOI</div>
          <div class="headline">${formatCurrency(summary.financial?.projectedNoi)}</div>
          <div class="note">Plan ${formatCurrency(summary.financial?.annualBudgetNoi)} · Gap ${formatCurrency(summary.financial?.projectedGap)}</div>
        </div>
        <div class="metric-block">
          <div class="kicker">Primary Driver</div>
          <div class="headline">${escapeHtml(summary.primaryDriver)}</div>
          <div class="note">${
            summary.leasing
              ? `Occ ${formatPercent(summary.leasing.occupancyPct)} · Delinq ${formatPercent(summary.leasing.delinquencyPct)}`
              : "Upload leasing data for leasing context."
          }</div>
        </div>
      </div>
    `;
  }

  function renderFinancialLayer(summary) {
    if (!summary?.financial) {
      return `<div class="empty-state">Financial data is required for this layer.</div>`;
    }

    const lines = summary.financial.lines.slice(0, 6);
    return `
      <div class="layer-grid">
        <div class="line-list">
          ${lines
            .map((line) => {
              const lineClass = line.favorableVariance >= 0 ? "good" : "bad";
              const railWidth = Math.min(100, (line.unfavorableAmount / Math.max(Math.abs(line.ytdBudget), 1)) * 250);
              return `
                <div class="line-item">
                  <div class="line-top">
                    <div>
                      <strong>${escapeHtml(line.lineItem)}</strong>
                      <span>${escapeHtml(line.section)} · YTD ${formatCurrency(line.ytdActual)} vs ${formatCurrency(line.ytdBudget)}</span>
                    </div>
                    <div class="variance">
                      <div class="amt ${lineClass}">${formatCurrency(line.favorableVariance)}</div>
                      <span>Favorable variance</span>
                    </div>
                  </div>
                  <div class="rail ${lineClass === "good" ? "good" : "bad"}"><span style="width:${railWidth}%"></span></div>
                  <div class="metric-foot">
                    <span>Projection ${formatCurrency(line.projection)}</span>
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
                <span>Core financial signals through ${escapeHtml(state.selectedPeriod)}</span>
              </div>
            </div>
            <div class="metric-list" style="margin-top:10px">
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>Revenue vs budget</strong>
                    <span>${formatCurrency(summary.financial.revenueActual)} vs ${formatCurrency(summary.financial.revenueBudget)}</span>
                  </div>
                  <strong>${formatCurrency(summary.financial.revenueActual - summary.financial.revenueBudget)}</strong>
                </div>
              </div>
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>Expense vs budget</strong>
                    <span>${formatCurrency(summary.financial.expenseActual)} vs ${formatCurrency(summary.financial.expenseBudget)}</span>
                  </div>
                  <strong>${formatCurrency(summary.financial.expenseBudget - summary.financial.expenseActual)}</strong>
                </div>
              </div>
              <div class="metric-rail">
                <div class="metric-top">
                  <div>
                    <strong>NOI pace to plan</strong>
                    <span>${formatPercent(summary.financial.pacePct)}</span>
                  </div>
                  <strong>${formatNumber(summary.financial.score, 0)}</strong>
                </div>
              </div>
            </div>
            <p class="footnote" style="margin-top:12px">
              Financial score weights both current NOI variance and the projected year-end gap so pace issues do not hide in a favorable month.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  function renderMetricLayer(metrics, title, description) {
    if (!metrics?.length) {
      return `<div class="empty-state">${escapeHtml(description)}</div>`;
    }

    return `
      <div class="layer-grid">
        <div class="metric-list">
          ${metrics
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
      dom.layerContent.innerHTML = renderFinancialLayer(summary);
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
    const rows = view?.selectedSummary?.crosswalkRows || [];
    if (!rows.length) {
      dom.crosswalkContent.innerHTML = `<div class="empty-state">Crosswalk narratives appear once a property has an unfavorable financial variance.</div>`;
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
                    <span>${escapeHtml(row.group)} driver set</span>
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
    const topProps = portfolio.topProperties
      .map(
        (summary) =>
          `${summary.property} (${formatNumber(summary.score, 0)}) is ${summary.risk.toLowerCase()} with NOI variance ${formatCurrency(summary.financial?.noiVariance)} and primary pressure in ${summary.primaryDriver}.`,
      )
      .slice(0, 3);

    const portfolioLines = portfolio.topLines
      .filter((line) => line.unfavorableAmount > 0)
      .map(
        (line) =>
          `${line.lineItem} is carrying ${formatCurrency(line.unfavorableAmount)} of unfavorable variance across the portfolio.`,
      )
      .slice(0, 3);

    const selectedBullets = [
      `${selected.property} is tracking ${formatCurrency(selected.financial?.noiVariance)} to budget with projected year-end NOI of ${formatCurrency(selected.financial?.projectedNoi)}.`,
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
    ];

    const portfolioBullets = [
      `Portfolio NOI is ${formatCurrency(portfolio.noiActual)} against ${formatCurrency(
        portfolio.noiBudget,
      )} budget through ${portfolio.asOf}, a variance of ${formatCurrency(portfolio.noiVariance)}.`,
      `Projected full-year NOI is ${formatCurrency(portfolio.projectedNoi)} versus annual plan of ${formatCurrency(
        portfolio.annualBudgetNoi,
      )}, creating a projected gap of ${formatCurrency(portfolio.projectedGap)}.`,
      ...topProps,
      ...portfolioLines,
    ];

    return { portfolioBullets, selectedBullets };
  }

  function renderBoardSummary(view) {
    if (!view) {
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

  function render() {
    renderCrosswalkLibrary();
    ["financial", "operations", "leasing"].forEach(renderUploadMeta);

    const view = computeViewModel();
    renderPeriodOptions(view);
    renderReadiness(view);
    renderSnapshot(view);
    renderRanking(view);
    renderSelectedProperty(view);
    renderLayerContent(view);
    renderCrosswalkContent(view);
    renderBoardSummary(view);
    updateExportButtons(Boolean(view));

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
    const rankingRows = view.propertySummaries
      .map(
        (summary) => `
          <tr>
            <td>${escapeHtml(summary.property)}</td>
            <td>${formatNumber(summary.score, 0)}</td>
            <td>${escapeHtml(summary.risk)}</td>
            <td>${formatCurrency(summary.financial?.noiVariance)}</td>
            <td>${formatCurrency(summary.financial?.projectedGap)}</td>
            <td>${summary.leasing ? formatPercent(summary.leasing.occupancyPct) : "No data"}</td>
            <td>${escapeHtml(summary.primaryDriver)}</td>
          </tr>
        `,
      )
      .join("");

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>RISE Ownership Report</title>
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
          <h1>RISE Executive Accountability Ownership Report</h1>
          <p>As of ${escapeHtml(view.portfolio.asOf)}</p>

          <div class="grid">
            <div class="card"><div class="label">YTD NOI</div><div class="value">${formatCurrency(view.portfolio.noiActual)}</div></div>
            <div class="card"><div class="label">Budget NOI</div><div class="value">${formatCurrency(view.portfolio.noiBudget)}</div></div>
            <div class="card"><div class="label">Projected NOI</div><div class="value">${formatCurrency(view.portfolio.projectedNoi)}</div></div>
            <div class="card"><div class="label">Avg Portfolio Score</div><div class="value">${formatNumber(view.portfolio.score, 0)}</div></div>
          </div>

          <h2>Portfolio summary</h2>
          <ul>${portfolioBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>

          <h2>${escapeHtml(view.selectedSummary.property)} detail</h2>
          <ul>${selectedBullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>

          <h2>Property ranking</h2>
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Score</th>
                <th>Risk</th>
                <th>NOI Var</th>
                <th>Proj Gap</th>
                <th>Occ</th>
                <th>Primary Driver</th>
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

  function handleDatasetUpload(type, file) {
    if (!file) {
      return;
    }
    file.text().then((text) => {
      setDataset(type, text, file.name);
    });
  }

  function bindDropzone(type) {
    const dropzone = document.getElementById(`${type}-dropzone`);
    const input = document.getElementById(`${type}-input`);

    input.addEventListener("change", (event) => handleDatasetUpload(type, event.target.files?.[0] || null));

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
      const file = event.dataTransfer?.files?.[0];
      handleDatasetUpload(type, file || null);
    });
  }

  function bindEvents() {
    bindDropzone("financial");
    bindDropzone("operations");
    bindDropzone("leasing");

    document.getElementById("load-sample-pack").addEventListener("click", () => {
      setDataset("financial", samplePack.financial, "sample-financial.csv");
      setDataset("operations", samplePack.operations, "sample-operations.csv");
      setDataset("leasing", samplePack.leasing, "sample-leasing.csv");
    });

    document.getElementById("clear-all").addEventListener("click", clearState);

    dom.periodSelect.addEventListener("change", (event) => {
      state.selectedPeriod = event.target.value;
      persistState();
      render();
    });

    document.querySelectorAll("[data-sample]").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.sample;
        setDataset(type, samplePack[type], `sample-${type}.csv`);
      });
    });

    document.querySelectorAll("[data-download-sample]").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.downloadSample;
        downloadBlob(`sample-${type}.csv`, samplePack[type], "text/csv");
      });
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
      persistState();
      render();
    });

    dom.exportScorecards.addEventListener("click", exportScorecardsCsv);
    dom.exportSummary.addEventListener("click", exportBoardSummary);
    dom.exportReport.addEventListener("click", exportOwnershipReport);
    dom.exportPptx.addEventListener("click", exportBoardDeck);
  }

  bindEvents();
  if (!restoreState()) {
    setDataset("financial", samplePack.financial, "sample-financial.csv");
    setDataset("operations", samplePack.operations, "sample-operations.csv");
    setDataset("leasing", samplePack.leasing, "sample-leasing.csv");
  } else {
    render();
  }
})();
