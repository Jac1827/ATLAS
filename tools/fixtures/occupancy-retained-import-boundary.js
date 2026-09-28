// Frozen pre-enrichment import functions. Synthetic boundary fixture, no source data.
async function dataImportReadStructuredRows(file, plan = {}) {
  const extension = dataImportGetFileExtension(file?.name || "");
  if (extension === ".pdf") return dataImportReadPdfStructuredRows(file);
  if (![".csv", ".txt", ".xlsx", ".xls", ".xlsm"].includes(extension)) return [];
  if (plan.reportType === "renewal_tracker" && !window.atlasCsPreviewRenewalSheetRows) await window.AtlasFeatures.load("centralServices");
  if (typeof XLSX === "undefined") await window.AtlasFeatures.load("xlsx");
  if (typeof XLSX === "undefined") throw new Error("The spreadsheet reader is unavailable in this ATLAS session.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, raw: false });
  const sheets = [];
  (workbook.SheetNames || []).forEach(sheetName => {
    if (dataImportIsMetadataSheetName(sheetName)) return;
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: true });
    if (plan.reportType === "renewal_tracker" && window.atlasCsPreviewRenewalSheetRows) {
      const prepared = window.atlasCsPreviewRenewalSheetRows(annotateRenewalRowsWithWorkbookVisualStatus(rawRows,workbook.Sheets[sheetName]), {
        propertyName:(plan.selectedCommunities || plan.communities || [])[0] || "", monthIdx:parseMonthIndexValue(sheetName) ?? 0,
        year:parseYearFromValue(sheetName,plan.reportingYear || new Date().getFullYear()), sourceSheetName:sheetName
      });
      if (!prepared.length && /^template$/i.test(sheetName.trim())) return;
      if (prepared.length) {
        const rows = prepared.map((row,index) => ({canonicalSource:true,sourceSheet:sheetName,sourceRow:row.sourceRow || index+1,
          values:{community_name:row.propertyName,lease_id:row.leaseId || row.id,unit:row.unit,resident:row.residentName,
            renewal_expiration:row.expirationDate,renewal_status:row.status,renewal_signed_date:row.renewalSignedDate || row.leaseExecutedDate || ""}}));
        sheets.push({sheetName,headers:Object.keys(rows[0].values),rows});
        return;
      }
    }
    if (plan.reportType === "trending_occupancy") {
      const rows = dataImportParseTrendingRows(rawRows, sheetName);
      if (rows.length) sheets.push({ sheetName, headers: [...new Set(rows.flatMap(row => Object.keys(row.values)))], rows });
      // A recognized Entrata layout must not fall back to generic summary-row mapping.
      if (rows.length || rawRows.some(row => row.some(v => String(v).trim() === "Beginning Occupied Units"))) return;
    }
    if (plan.reportType === "delinquency") {
      const normalize = value => String(value || "").trim().toLowerCase();
      const headerIndex = rawRows.findIndex(row => row.some(v => normalize(v) === "0-30 days") && row.some(v => normalize(v) === "balance") && row.some(v => normalize(v) === "resident"));
      if (headerIndex >= 0) {
        const headers = rawRows[headerIndex];
        const fields = Object.fromEntries(headers.map(header => [normalize(header), dataImportKnownDelinquencyField(header)]).filter(([,field]) => field));
        const rows = rawRows.slice(headerIndex + 1).flatMap((row, index) => {
          if (!row[headers.findIndex(h=>normalize(h)==="resident")] || /^(?:grand\s+)?(?:sub)?total\s*:?$/i.test(String(row[0] || "").trim())) return [];
          const values = {}, locators = {};
          headers.forEach((header,column) => { const field=fields[normalize(header)]; if (!field || row[column] === "" || row[column] == null) return; values[field]=row[column]; locators[field]={row:headerIndex+index+2,column:column+1,section:"aged receivables",sourceHeader:header}; });
          return [{values,locators,canonicalSource:true,sourceSheet:sheetName,sourceRow:headerIndex+index+2}];
        });
        sheets.push({sheetName,headers:Object.values(fields),rows});
        return;
      }
    }
    if (plan.reportType === "box_score" && window.AtlasApplicationSources) {
      const qualified = window.AtlasApplicationSources.boxScore(rawRows);
      if (qualified.length) {
        sheets.push({sheetName, headers: [...new Set(qualified.flatMap(row => Object.keys(row.values)))], rows: qualified.map(row => ({...row, sourceSheet:sheetName}))});
        return;
      }
      // Never reinterpret a sectioned or filtered-empty Box Score as a flat table.
      if (rawRows.some(row => /box score|selected report filters returned no data/i.test(String(row[0] || "")))) return;
    }
    const headerIndex = dataImportFindHeaderRowIndex(rawRows);
    const headerRow = rawRows[headerIndex] || [];
    const headers = headerRow.map((cell, index) => ({ name: String(cell ?? "").trim(), index })).filter(item => item.name);
    if (headers.length < 2) return;
    const rows = rawRows.slice(headerIndex + 1).map((sourceRow, rowOffset) => {
      const values = {};
      headers.forEach(header => { values[header.name] = sourceRow?.[header.index] ?? ""; });
      return {
        values,
        sourceSheet: sheetName,
        sourceRow: headerIndex + rowOffset + 2
      };
    }).filter(row => Object.values(row.values).some(value => String(value ?? "").trim()));
    if (rows.length) sheets.push({ sheetName, headerIndex, headers: headers.map(item => item.name), rows });
  });
  return sheets;
}

async function dataImportRouteStructuredFile(file, plan, batchId) {
  if (plan.reportType === "box_score") await refreshDataImportSharedLeadMappings();
  const sheets = await dataImportReadStructuredRows(file, plan);
  const actualRowsReviewed = sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
  const previewRowsReviewed = Number(plan.rowCount || 0);
  if (dataImportApprovalInProgress && actualRowsReviewed !== previewRowsReviewed) {
    dataImportUpdateApprovalProgress({
      totalRows: Math.max(0, Number(dataImportApprovalProgress.totalRows || 0) - previewRowsReviewed + actualRowsReviewed)
    });
  }
  const selectedCommunityKeys = new Set((plan.selectedCommunities || plan.communities || []).map(dataImportNormalizeText));
  const mappingCache = new Map();
  const communityLookups = {
    aliases: dataImportBuildAliasLookup(),
    internalIds: dataImportBuildInternalCommunityLookup()
  };
  const approvalRowOffset = Number(dataImportApprovalProgress.rowsDone || 0);
  let processedRows = 0;
  const freshness = dataImportEffectiveFreshness(plan.reportType);
  const freshnessDate = plan.metadata?.dataAsOf || plan.dataDateIso || plan.metadata?.generatedAt || plan.metadata?.fileModifiedAt || "";
  const freshnessAge = freshnessDate
    ? (freshness.businessDays ? dataImportBusinessDaysBetween(freshnessDate) : Math.max(0, Math.floor((Date.now() - new Date(freshnessDate).getTime()) / 86400000)))
    : 0;
  const blockStaleDownstream = freshness.action === "block_hold" && Number.isFinite(freshnessAge) && freshnessAge > freshness.days;
  const result = {
    batchId,
    rowsReviewed: actualRowsReviewed,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    rowsRejected: 0,
    rowsHeld: 0,
    duplicatesIgnored: 0,
    communities: new Set(),
    destinations: new Set(),
    issues: [],
    formulas: [],
    coverage: [],
    coverageGaps: [],
    coverageExpected: 0,
    centralRows: []
  };
  if (!sheets.length && !["box_score", "marketing_iq"].includes(plan.reportType)) {
    result.issues.push({ type: "held", severity: "high", title: "No tabular rows extracted", detail: `${plan.name} was archived, but ATLAS found no row structure that could be mapped without guessing.` });
    result.rowsHeld = Math.max(1, Number(plan.rowCount || 0));
  }
  if (blockStaleDownstream) {
    result.issues.push({ type: "held", severity: "high", title: "Stale feed held from downstream use", detail: `${plan.reportTypeLabel} is ${freshnessAge} ${freshness.businessDays ? "business " : ""}days old; this source is configured to block and hold after ${freshness.days} days.` });
  }
  const grouped = new Map();
  for (const sheet of sheets) {
    for (const sourceRow of sheet.rows) {
      processedRows += 1;
      if (dataImportApprovalInProgress && processedRows % 300 === 0) {
        dataImportUpdateApprovalProgress({
          rowsDone: approvalRowOffset + processedRows,
          stage: "Applying rows",
          fileName: plan.name
        });
        await dataImportYieldToBrowser();
      }
      if (plan.reportType === "delinquency" && Object.values(sourceRow.values || {}).slice(0, 2).some(value => /^(?:grand\s+)?(?:sub)?total\s*:?$/i.test(String(value || "").trim()))) continue;
      const { mapped, sourceFields, unmappedFields } = dataImportMapSourceRow(sourceRow, plan, mappingCache);
      const communityName = dataImportResolveRowCommunity(mapped, sourceRow, plan, communityLookups);
      if (!communityName) {
        result.rowsRejected += 1;
        result.issues.push({ type: "unmapped", severity: "high", title: "Community could not be resolved", detail: `${sheet.sheetName} row ${sourceRow.sourceRow} was quarantined without guessing.`, communityName: "Unmapped", sourceSheet: sheet.sheetName, sourceRow: sourceRow.sourceRow });
        continue;
      }
      if (selectedCommunityKeys.size && !selectedCommunityKeys.has(dataImportNormalizeText(communityName))) {
        result.rowsHeld += 1;
        continue;
      }
      if (!dataImportCommunitySupportsReport(communityName, plan.reportType)) {
        result.rowsHeld += 1;
        result.issues.push({ type: "held", severity: "medium", title: "Outside managed service scope", detail: `${communityName} is not enabled for ${plan.reportTypeLabel}; the row was retained as source history without changing operational reporting.`, communityName });
        continue;
      }
      const incomingUnits = dataImportNumericValue(mapped.total_units);
      if (plan.reportType === "community_data" && dataImportNormalizeText(communityName) === dataImportNormalizeText("Baymeadows") && incomingUnits === 340) {
        result.rowsHeld += 1;
        result.issues.push({ type: "reconciliation", severity: "high", title: "Baymeadows unit-count correction required", detail: "Baymeadows is governed at 331 units. The incoming 340-unit row was retained in the raw archive and held from Community Foundation until corrected or explicitly resolved.", communityName });
        continue;
      }
      if (sourceRow.canonicalSource) {
        plan.qualifiedLocators ||= {};
        plan.qualifiedLocators[communityName] = {...plan.qualifiedLocators[communityName], ...sourceFields};
      }
      const period = dataImportRowPeriod(mapped, sourceRow, plan);
      if (plan.reportType === "renewal_tracker" && !period.periodKey) {
        result.rowsHeld += 1;
        result.issues.push({type:"held",severity:"high",title:"Renewal expiration period is missing",detail:`${sheet.sheetName} row ${sourceRow.sourceRow} needs an expiration date or a dated month tab. It was not assigned to the upload month.`,communityName});
        continue;
      }
      if (plan.reportType !== "renewal_tracker" && dataImportPeriodConflict(plan.periodSelection?.requested, period)) {
        result.rowsHeld += 1;
        result.issues.push({ type: "conflict", severity: "high", title: "Source section is outside the selected period", detail: `${sheet.sheetName} row ${sourceRow.sourceRow} belongs to ${period.periodKey}; it was held without changing that date or another month.`, communityName, sourceSheet: sheet.sheetName, sourceRow: sourceRow.sourceRow });
        continue;
      }
      const canonicalRecord = {
        key: dataImportCanonicalRecordKey(plan, communityName, period, mapped, sourceRow),
        reportType: plan.reportType,
        reportTypeLabel: plan.reportTypeLabel,
        communityName,
        periodKey: period.periodKey,
        values: Object.fromEntries(Object.entries(mapped).filter(([field])=>field !== "__leadSourceMix")),
        leadSourceReconciliation: mapped.__leadSourceMix || null,
        originalValues: sourceRow.values,
        leadSourceEvidence: sourceRow.leadComponents || [],
        leadSourceControls: sourceRow.leadControls || [],
        leadSourceReview: sourceRow.leadReview || [],
        sourceLocators: sourceRow.locators || {},
        section: sourceRow.section, sectionPeriod: sourceRow.period,
        periodSelection: plan.periodSelection || null,
        downstreamEligible: !blockStaleDownstream,
        sourceSheet: sourceRow.sourceSheet,
        sourceRow: sourceRow.sourceRow,
        sourceSystem: plan.sourceSystem,
        sourceFile: plan.name,
        fileHash: plan.fileHash || "",
        batchId,
        mappingVersion: mapped.__leadSourceMix?.version || plan.mappingVersion || "ATLAS-RRIM-1.0",
        dataAsOf: plan.metadata?.dataAsOf || plan.dataDateIso || plan.metadata?.generatedAt || "",
        importedAt: new Date().toISOString()
      };
      const upsert = dataImportUpsertCanonicalRecord(canonicalRecord, result, {reprocess: plan.reprocessArchivedSource === true});
      if (["held", "older", "duplicate"].includes(upsert.disposition)) continue;
      result.communities.add(communityName);
      dataImportAddLineage(plan, batchId, canonicalRecord, sourceFields, false);
      if (unmappedFields.length) {
        result.issues.push({ type: "unmapped", severity: "low", title: "Source fields retained without a destination", detail: `${unmappedFields.slice(0, 4).map(item => item.header).join(", ")} remain visible in lineage for Admin mapping.`, communityName, sourceSheet: sourceRow.sourceSheet, sourceRow: sourceRow.sourceRow });
      }
      if (blockStaleDownstream) {
        if (upsert.disposition === "inserted") result.rowsInserted = Math.max(0, result.rowsInserted - 1);
        else if (upsert.disposition === "updated") result.rowsUpdated = Math.max(0, result.rowsUpdated - 1);
        else if (upsert.disposition === "unchanged") result.rowsUnchanged = Math.max(0, result.rowsUnchanged - 1);
        result.rowsHeld += 1;
        continue;
      }
      if (plan.reportType === "delinquency") result.centralRows.push(dataImportCentralDelinquencyRow(canonicalRecord));
      if (plan.reportType === "community_data") {
        dataImportApplyCommunityFoundation(mapped, communityName, plan, result);
      } else {
        const groupKey = `${communityName}::${period.periodKey}`;
        const group = grouped.get(groupKey) || { communityName, period, entries: [] };
        group.entries.push({ row: mapped, sourceRow, sourceFields, canonicalRecord });
        grouped.set(groupKey, group);
      }
    }
  }
  grouped.forEach(group => {
    dataImportApplyGroupedSnapshot(group, plan, result);
    if (plan.reportType === "box_score" && !blockStaleDownstream) atlasCaptureBoxScore(group.communityName, group.entries.map(e=>e.sourceRow), plan.name, plan.metadata?.generatedAt || "");
  });
  if (plan.reportType === "box_score" && !blockStaleDownstream && !result.issues.some(issue => issue.title === "Source section is outside the selected period")) {
    await atlasCaptureBoxScoreFile(file, {floorPlansOnly:true, allowedNames:plan.selectedCommunities || plan.communities || Array.from(result.communities)});
  }
  if (plan.reportType === "delinquency" && result.centralRows.length && typeof window.atlasCsIngestDelinquencyRows === "function") {
      const firstCommunity = Array.from(result.communities)[0] || "Multiple properties";
      const csResult = window.atlasCsIngestDelinquencyRows(result.centralRows, {
        propertyName: result.communities.size === 1 ? firstCommunity : "Multiple properties",
        monthIdx: Number.isInteger(plan.reportingMonthIdx) ? plan.reportingMonthIdx : getSelectedDashboardMonthIndex(),
        year: Number.isInteger(plan.reportingYear) ? plan.reportingYear : new Date().getFullYear(),
        fileName: plan.name,
        sourceSheetName: sheets.length === 1 ? sheets[0].sheetName : `${sheets.length} data sheets`,
        importBatchId: batchId
      }, { importHistory: true, render: false });
      result.centralRowsImported = Number(csResult?.rowsImported || 0);
      if (csResult?.rowsImported) result.destinations.add("Central Services Collections / Evictions");
  }
  result.coverage = Array.from(result.communities).map(communityName => ({ communityName, reportType: plan.reportType, period: plan.reportingPeriodLabel || "Detected per row" }));
  if (dataImportGetReportDef(plan.reportType)?.serviceScope === "leasing") {
    const expected = DATA_IMPORT_LEASING_MANAGED_COMMUNITIES.filter(dataImportIsActiveReportingCommunity);
    const covered = new Set(Array.from(result.communities).map(dataImportNormalizeText));
    result.coverageExpected = expected.length;
    result.coverageGaps = expected.filter(name => !covered.has(dataImportNormalizeText(name)));
  } else {
    result.coverageExpected = result.communities.size;
  }
  result.destinations = Array.from(result.destinations);
  result.communities = Array.from(result.communities);
  delete result.centralRows;
  dataImport2State.reconciliationLog.unshift(...result.formulas.map(formula => ({ id: dataImportMakeId("recon"), batchId, reportType: plan.reportType, fileName: plan.name, formula, createdAt: new Date().toISOString() })));
  // Import audit history is retained; UI views limit their own rendered rows.
  if (dataImportApprovalInProgress) {
    dataImportUpdateApprovalProgress({ rowsDone: approvalRowOffset + result.rowsReviewed });
  } else {
    persistSaved();
  }
  if (result.communities.includes(getProp().name)) loadPropertyData(getProp().name);
  dataImportRecordPlanLearningUsage(plan);
  return result;
}
