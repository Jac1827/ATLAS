// Loaded only by its owning workflow; existing dashboard globals retain their contracts.
export default async function buildMonthlyInvestorPresentationPptxSlides(pptx, report) {
  const assetCache = new Map();
  const coverPhotoData = await getPhotoAssetDataForPptx(getMonthlyInvestorPresentationPrimaryPhotoAsset(report), assetCache);
  const ribbonCover = "Monthly investor presentation";

  const coverSlide = pptx.addSlide();
  await addPptxDeckShell(coverSlide, pptx, report, {
    title: report.title,
    ribbon: ribbonCover,
    accent: RISE_PRESENTATION_BRAND.blue,
    photoData: coverPhotoData,
    titleSize: 34
  });
  coverSlide.addText(report.subtitle, {
    x: 0.35, y: 2.18, w: 6.4, h: 0.32,
    fontFace: "Arial", fontSize: 18, color: getPptxColorHex(RISE_PRESENTATION_BRAND.cyan), margin: 0, fit: "shrink"
  });
  coverSlide.addText(`${report.currentMonthLabel} Investor Presentation`, {
    x: 0.35, y: 2.56, w: 5.8, h: 0.22,
    fontFace: "Arial", fontSize: 14, color: "D9E7F5", margin: 0, fit: "shrink"
  });
  await addPptxMemberStrip(coverSlide, pptx, report.regionalStaff, assetCache, {
    x: 0.35, y: 3.05, w: 8.95, h: 1.0, title: "Leadership in scope", max: 5
  });

  const contentsSlide = pptx.addSlide();
  await addPptxDeckShell(contentsSlide, pptx, report, {
    title: "Contents",
    ribbon: "Presentation map",
    accent: RISE_PRESENTATION_BRAND.blue,
    photoData: coverPhotoData
  });
  addPptxBulletPanel(contentsSlide, pptx, {
    x: 0.35, y: 2.05, w: 4.65, h: 3.75,
    title: "Agenda",
    items: buildMonthlyInvestorPresentationAgenda(report)
  });
  const mosaicPhotos = (report.photoPool ?? []).slice(0, 3);
  addPptxPanel(contentsSlide, pptx, { x: 5.18, y: 2.05, w: 4.45, h: 3.75, title: "Selected communities", fillColor: "17324A" });
  for (let index = 0; index < mosaicPhotos.length; index += 1) {
    const photoData = await getPhotoAssetDataForPptx(mosaicPhotos[index], assetCache);
    if (!photoData) continue;
    const layout = [
      { x: 5.32, y: 2.28, w: 2.02, h: 1.48 },
      { x: 7.42, y: 2.28, w: 2.02, h: 1.48 },
      { x: 5.32, y: 3.88, w: 4.12, h: 1.55 }
    ][index];
    contentsSlide.addImage({ data: photoData, ...layout });
    contentsSlide.addText(String(mosaicPhotos[index].community ?? ""), {
      x: layout.x + 0.08, y: layout.y + layout.h - 0.22, w: layout.w - 0.16, h: 0.14,
      fontFace: "Arial", fontSize: 8, bold: true, color: "FFFFFF", margin: 0
    });
  }

  const summarySlide = pptx.addSlide();
  await addPptxDeckShell(summarySlide, pptx, report, {
    title: "Executive Summary",
    ribbon: "Topline operating story",
    accent: RISE_PRESENTATION_BRAND.blue,
    photoData: coverPhotoData
  });
  addPptxMetricGrid(summarySlide, pptx, buildMonthlyInvestorPresentationMetricCards(report), {
    x: 0.35, y: 2.0, w: 9.15, h: 1.86, cols: 3, valueSize: 18, subSize: 7.2
  });
  addPptxTextPanel(summarySlide, pptx, {
    x: 0.35, y: 4.02, w: 9.15, h: 2.08,
    title: "Narrative",
    body: buildMonthlyInvestorPresentationNarrative(report).join("\n\n"),
    fontSize: 11
  });

  if (report.details.length > 1) {
    const snapshotSlide = pptx.addSlide();
    await addPptxDeckShell(snapshotSlide, pptx, report, {
      title: "Selected Community Snapshot",
      ribbon: "Scope summary",
      accent: RISE_PRESENTATION_BRAND.cyan,
      photoData: coverPhotoData
    });
    addPptxBarPanel(snapshotSlide, pptx, {
      x: 0.35, y: 2.0, w: 4.52, h: 3.1,
      title: "Physical Occupancy vs Saved Budget",
      subtitle: "Each community is measured against its saved physical occupancy budget for the active month.",
      items: report.details.map(detail => ({
        label: detail.name,
        value: getSummaryOccPct(detail.summary),
        target: Number(detail.summary.budgetOccPct ?? 0),
        note: `Leased ${getSummaryLeasedPct(detail.summary).toFixed(1)}% · ${Math.round(detail.summary.applicationsApproved ?? 0)} approved apps MTD`,
        color: RISE_PRESENTATION_BRAND.blue
      })),
      max: 100,
      valueFormatter: value => `${Number(value || 0).toFixed(1)}%`,
      targetFormatter: value => `${Number(value || 0).toFixed(1)}%`
    });
    addPptxBarPanel(snapshotSlide, pptx, {
      x: 5.0, y: 2.0, w: 4.52, h: 3.1,
      title: "Approved Applications vs Received",
      subtitle: "The bar shows approved applications, while the target marker shows total applications received.",
      items: report.details.map(detail => ({
        label: detail.name,
        value: Number(detail.summary.applicationsApproved ?? 0),
        target: Number(detail.summary.applications ?? 0),
        note: `${(detail.summary.applicationApprovalPct ?? 0).toFixed(1)}% approval rate · ${formatSignedDisplay(detail.summary.monthAbsorption ?? 0)} absorption`,
        color: RISE_PRESENTATION_BRAND.cyan
      })),
      valueFormatter: value => `${Math.round(value || 0)}`,
      targetFormatter: value => `${Math.round(value || 0)}`
    });
    addPptxBulletPanel(snapshotSlide, pptx, {
      x: 0.35, y: 5.28, w: 9.15, h: 1.35,
      title: "Scope read",
      items: [
        `${report.details.length} selected communities are represented across ${report.investorGroups.length} investment portfolios.`,
        `${report.aggregate.totalUnits.toLocaleString()} total units are included in this monthly presentation scope.`,
        `${(report.regionalStaff ?? []).length > 0 ? `${report.regionalStaff.length} leadership headshots are included based on scope.` : "Add VP or Regional headshots to strengthen the cover and spotlight slides."}`
      ],
      fontSize: 10
    });
  }

  if (report.selectedSections.includes("overview")) {
    const overviewSlide = pptx.addSlide();
    await addPptxDeckShell(overviewSlide, pptx, report, {
      title: "Budget & Revenue Position",
      ribbon: "Saved budget pacing and rate health",
      accent: RISE_PRESENTATION_BRAND.blue,
      photoData: coverPhotoData
    });
    addPptxMetricGrid(overviewSlide, pptx, [
      { label: "Budget Attainment", value: `${(report.aggregate.avgBudgetOccAttainmentPct ?? 0).toFixed(1)}%`, sub: "Average occupancy attainment vs saved budget" },
      { label: "Occ Gap vs Budget", value: formatSignedDisplay(report.aggregate.occGapPts ?? 0, 1, " pts"), sub: "Portfolio occupancy gap versus budget" },
      { label: "Leased Gap vs Budget", value: formatSignedDisplay(report.aggregate.leasedGapPts ?? 0, 1, " pts"), sub: "Leased occupancy gap versus target" },
      { label: "NER Delta vs Budget", value: report.aggregate.nerDelta ? formatSignedDisplay(report.aggregate.nerDelta, 0) : "—", sub: "Weighted effective rent delta versus budget" }
    ], {
      x: 0.35, y: 2.0, w: 9.15, h: 0.95, cols: 4, valueSize: 14.5, subSize: 6.7
    });
    addPptxBarPanel(overviewSlide, pptx, {
      x: 0.35, y: 3.1, w: 4.52, h: 2.72,
      title: "Occupancy vs Saved Budget by Community",
      items: report.details.map(detail => ({
        label: detail.name,
        value: getSummaryOccPct(detail.summary),
        target: Number(detail.summary.budgetOccPct ?? 0),
        note: detail.summary.budgetOccOnTrack ? "On track to budget" : `${Math.max(detail.summary.occGapUnits ?? 0, 0)} units below target`,
        color: RISE_PRESENTATION_BRAND.blue
      })),
      max: 100,
      valueFormatter: value => `${Number(value || 0).toFixed(1)}%`,
      targetFormatter: value => `${Number(value || 0).toFixed(1)}%`
    });
    addPptxBarPanel(overviewSlide, pptx, {
      x: 5.0, y: 3.1, w: 4.52, h: 2.72,
      title: "Actual NER vs Budgeted NER",
      items: report.details.map(detail => ({
        label: detail.name,
        value: Number(detail.summary.currentNer ?? 0),
        target: Number(detail.summary.proformaNer ?? 0),
        note: Number(detail.summary.currentNer ?? 0) > 0 && Number(detail.summary.proformaNer ?? 0) > 0
          ? `Delta ${formatSignedDisplay((detail.summary.currentNer ?? 0) - (detail.summary.proformaNer ?? 0), 0)}`
          : "Awaiting complete NER data",
        color: RISE_PRESENTATION_BRAND.cyan
      })),
      valueFormatter: value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—",
      targetFormatter: value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"
    });
  }

  if (report.selectedSections.includes("traffic") || report.selectedSections.includes("overview")) {
    const trafficSlide = pptx.addSlide();
    await addPptxDeckShell(trafficSlide, pptx, report, {
      title: "Leasing Traffic & Conversion",
      ribbon: "Month-to-date funnel performance",
      accent: RISE_PRESENTATION_BRAND.cyan,
      photoData: coverPhotoData
    });
    addPptxMetricGrid(trafficSlide, pptx, [
      { label: "Applications (MTD)", value: `${Math.round(report.aggregate.applications ?? 0)}`, sub: formatPortfolioTrendValue(report.aggregate.applications ?? 0, report.aggregate.previousApplications ?? 0, "count_pct") },
      { label: "Approved Applications", value: `${Math.round(report.aggregate.applicationsApproved ?? 0)}`, sub: formatPortfolioTrendValue(report.aggregate.applicationsApproved ?? 0, report.aggregate.previousApplicationsApproved ?? 0, "count_pct") },
      { label: "Tour to App", value: `${(report.aggregate.tourToAppPct ?? 0).toFixed(1)}%`, sub: formatPortfolioTrendValue(report.aggregate.tourToAppPct ?? 0, report.aggregate.previousTourToAppPct ?? 0, "point") },
      { label: "Tour to Lease", value: `${(report.aggregate.tourToLeasePct ?? 0).toFixed(1)}%`, sub: formatPortfolioTrendValue(report.aggregate.tourToLeasePct ?? 0, report.aggregate.previousTourToLeasePct ?? 0, "point") }
    ], {
      x: 0.35, y: 2.0, w: 9.15, h: 0.95, cols: 4, valueSize: 14.5, subSize: 6.7
    });
    addPptxBarPanel(trafficSlide, pptx, {
      x: 0.35, y: 3.1, w: 4.52, h: 2.72,
      title: "Approved Applications vs Total Applications",
      items: report.details.map(detail => ({
        label: detail.name,
        value: Number(detail.summary.applicationsApproved ?? 0),
        target: Number(detail.summary.applications ?? 0),
        note: `${(detail.summary.applicationApprovalPct ?? 0).toFixed(1)}% approval rate`,
        color: RISE_PRESENTATION_BRAND.blue
      })),
      valueFormatter: value => `${Math.round(value || 0)}`,
      targetFormatter: value => `${Math.round(value || 0)}`
    });
    addPptxBarPanel(trafficSlide, pptx, {
      x: 5.0, y: 3.1, w: 4.52, h: 2.72,
      title: "Tour to Lease Conversion by Community",
      subtitle: "The target flexes upward where the saved traffic plan needs more closing power to stay on budget.",
      items: report.details.map(detail => {
        const plan = getCommunityPerformancePlan(detail.name, detail.record);
        const needed = Number(plan?.currentTourToLeaseNeededPct ?? 0);
        return {
          label: detail.name,
          value: Number(detail.summary.tourToLeasePct ?? 0),
          target: needed > 0 ? Math.max(28, needed) : 28,
          note: `${Math.round(detail.summary.tours ?? 0)} tours · ${Math.round(detail.summary.leasesSigned ?? 0)} leases`,
          color: RISE_PRESENTATION_BRAND.cyan
        };
      }),
      max: 100,
      valueFormatter: value => `${Number(value || 0).toFixed(1)}%`,
      targetFormatter: value => `${Number(value || 0).toFixed(1)}%`
    });
  }

  if (report.selectedSections.includes("renewals") || report.selectedSections.includes("reputation")) {
    const renewalsSlide = pptx.addSlide();
    await addPptxDeckShell(renewalsSlide, pptx, report, {
      title: "Renewals, Retention & Resident Experience",
      ribbon: "Stability and resident sentiment",
      accent: RISE_PRESENTATION_BRAND.mint,
      photoData: coverPhotoData
    });
    addPptxMetricGrid(renewalsSlide, pptx, [
      { label: "Expirations (MTD)", value: `${Math.round(report.aggregate.renewalExpirations ?? 0)}`, sub: formatPortfolioTrendValue(report.aggregate.renewalExpirations ?? 0, report.aggregate.previousRenewalExpirations ?? 0, "count_pct") },
      { label: "Renewals Signed", value: `${Math.round(report.aggregate.renewalsSigned ?? 0)}`, sub: formatPortfolioTrendValue(report.aggregate.renewalsSigned ?? 0, report.aggregate.previousRenewalsSigned ?? 0, "count_pct") },
      { label: "Retention Rate", value: `${(report.aggregate.renewalRetentionRate ?? 0).toFixed(1)}%`, sub: formatPortfolioTrendValue(report.aggregate.renewalRetentionRate ?? 0, report.aggregate.previousRenewalRetentionRate ?? 0, "point") },
      { label: "Projected Attrition", value: `${Math.round(report.aggregate.renewalProjectedAttrition ?? 0)}`, sub: "MTD risk units in lease planning" },
      { label: "ORA", value: (report.aggregate.oraScore ?? 0) > 0 ? (report.aggregate.oraScore ?? 0).toFixed(1) : "—", sub: "Portfolio average" },
      { label: "Quarterly Google", value: (report.aggregate.googleQuarterlyRating ?? 0) > 0 ? (report.aggregate.googleQuarterlyRating ?? 0).toFixed(2) : "—", sub: "Current quarter rating" }
    ], {
      x: 0.35, y: 2.0, w: 9.15, h: 1.72, cols: 3, valueSize: 15.5, subSize: 6.8
    });
    addPptxBarPanel(renewalsSlide, pptx, {
      x: 0.35, y: 3.9, w: 4.52, h: 2.34,
      title: "Renewal Retention vs Goal by Community",
      items: report.details.map(detail => {
        const plan = getCommunityPerformancePlan(detail.name, detail.record);
        return {
          label: detail.name,
          value: Number(detail.summary.renewalRetentionRate ?? 0),
          target: Number(plan?.recommendedRenewalGoal ?? 60),
          note: `${Math.round(detail.summary.renewalProjectedAttrition ?? 0)} projected attrition units`,
          color: RISE_PRESENTATION_BRAND.mint
        };
      }),
      max: 100,
      valueFormatter: value => `${Number(value || 0).toFixed(1)}%`,
      targetFormatter: value => `${Number(value || 0).toFixed(1)}%`
    });
    addPptxBarPanel(renewalsSlide, pptx, {
      x: 5.0, y: 3.9, w: 4.52, h: 2.34,
      title: "ORA by Community vs National Average",
      subtitle: "The target marker reflects the 62 ORA national average baseline used elsewhere in the dashboard.",
      items: report.details.map(detail => ({
        label: detail.name,
        value: Number(detail.summary.oraScore ?? 0),
        target: 62,
        note: Number(detail.summary.googleQuarterlyRating ?? 0) > 0 ? `Quarterly Google ${Number(detail.summary.googleQuarterlyRating).toFixed(2)}` : "Quarterly Google pending",
        color: RISE_PRESENTATION_BRAND.blue
      })),
      max: 100,
      valueFormatter: value => Number(value || 0) > 0 ? Number(value).toFixed(1) : "—",
      targetFormatter: value => `${Number(value || 0).toFixed(0)}`
    });
  }

  for (const detail of (report.details ?? [])) {
    const detailSlide = pptx.addSlide();
    const detailPhotoData = await getPhotoAssetDataForPptx(getDetailPhotoBank(detail)[0], assetCache);
    await addPptxDeckShell(detailSlide, pptx, report, {
      title: detail.name,
      ribbon: "Community spotlight + pricing action",
      accent: RISE_PRESENTATION_BRAND.sky,
      photoData: detailPhotoData
    });
    const summary = detail.summary;
    const monthEntry = getMonthlyPresentationCurrentEntry(detail);
    const market = buildRegionalPricingWorksheetSnapshot(detail);
    const people = getPresentationCommunityStaffForDetail(detail);
    addPptxTextPanel(detailSlide, pptx, {
      x: 0.35, y: 2.0, w: 4.55, h: 1.16,
      title: "Community spotlight",
      body: [
        getInvestorPortfolioName(detail.record),
        `${getDashboardMonthLabel(detail.record?.currentMonth ?? currentMonth)} operating picture`
      ].join("\n"),
      fontSize: 11
    });
    addPptxMetricGrid(detailSlide, pptx, [
      { label: "Physical occupancy", value: `${getSummaryOccPct(summary).toFixed(1)}%` },
      { label: "Leased occupancy", value: `${getSummaryLeasedPct(summary).toFixed(1)}%` },
      { label: "Approved apps MTD", value: `${Math.round(summary.applicationsApproved ?? 0)}` },
      { label: "Net absorption MTD", value: formatSignedDisplay(summary.monthAbsorption ?? 0) },
      { label: "Renewal retention", value: `${(summary.renewalRetentionRate ?? 0).toFixed(1)}%` },
      { label: "ORA average", value: (summary.oraScore ?? 0) > 0 ? (summary.oraScore ?? 0).toFixed(1) : "—" }
    ], {
      x: 0.35, y: 3.25, w: 4.55, h: 1.52, cols: 2, valueSize: 13.5, subSize: 0
    });
    addPptxBarPanel(detailSlide, pptx, {
      x: 0.35, y: 4.92, w: 4.55, h: 1.12,
      title: "Rates & Effective Rent",
      items: [
        { label: "Market Rent", value: Number(monthEntry.marketRent ?? 0), color: RISE_PRESENTATION_BRAND.blue },
        { label: "Budget Rent", value: Number(monthEntry.proformaRent ?? 0), color: RISE_PRESENTATION_BRAND.sky },
        { label: "Actual NER", value: Number(monthEntry.nerActual ?? 0), color: RISE_PRESENTATION_BRAND.mint }
      ],
      valueFormatter: value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"
    });
    addPptxBulletPanel(detailSlide, pptx, {
      x: 5.05, y: 2.0, w: 4.45, h: 1.46,
      title: "Regional pricing action",
      items: [
        `Comp Avg Rent: ${formatPresentationCurrencyValue(market.compAverageRent)}`,
        `Comp Avg NER: ${formatPresentationCurrencyValue(market.compAverageNer)}`,
        `Comp Leased / Exposure: ${formatPresentationPercentValue(market.compAverageLeasedPct)} / ${formatPresentationPercentValue(market.compAverageExposurePct)}`,
        `App Pace (7 / 30): ${Math.round(market.applicationsLast7 || 0)} / ${Math.round(market.applicationsLast30 || 0)}`,
        `Rent action: ${getRegionalPricingActionLabel(market)}`,
        `Recommended specials: ${market.specialsRecommendation || "Pending Regional input"}`,
        `Regional note: ${market.pricingNotes || market.compNarrative || "Pending Regional input"}`
      ],
      fontSize: 8.7
    });
    const comps = Array.isArray(market.surveyComps) ? market.surveyComps : [];
    const visibleComps = comps.length > 0
      ? [...(comps.find(comp => comp.isSubject) ? [comps.find(comp => comp.isSubject)] : []), ...comps.filter(comp => !comp.isSubject).slice(0, 4)].slice(0, 5)
      : [];
    addPptxBarPanel(detailSlide, pptx, {
      x: 5.05, y: 3.63, w: 4.45, h: 1.12,
      title: "Market Survey Rents",
      items: visibleComps.map(comp => ({
        label: comp.isSubject ? `${comp.name} (Subject)` : comp.name,
        value: Number(comp.rent ?? 0),
        note: Number(comp.ner ?? 0) > 0 ? `NER $${Number(comp.ner).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "",
        color: comp.isSubject ? RISE_PRESENTATION_BRAND.cyan : RISE_PRESENTATION_BRAND.blue
      })),
      valueFormatter: value => value > 0 ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"
    });
    addPptxBarPanel(detailSlide, pptx, {
      x: 5.05, y: 4.92, w: 4.45, h: 1.12,
      title: "Last 30 Days: Leases vs Applications",
      items: visibleComps.map(comp => ({
        label: comp.isSubject ? `${comp.name} (Subject)` : comp.name,
        value: Number(comp.leasesLast30 ?? 0),
        target: Number(comp.applicationsLast30 ?? 0),
        note: `${Math.round(comp.applicationsLast30 ?? 0)} apps · ${Math.round(comp.leasesLast30 ?? 0)} leases`,
        color: comp.isSubject ? RISE_PRESENTATION_BRAND.mint : RISE_PRESENTATION_BRAND.sky
      })),
      valueFormatter: value => `${Math.round(value || 0)}`,
      targetFormatter: value => `${Math.round(value || 0)}`
    });
    const recommendationLines = detail.recommendations.length > 0
      ? detail.recommendations.slice(0, 3).map(item => `${item.title}: ${item.body}`)
      : ["No active watchlist items surfaced from the current dashboard sections."];
    addPptxBulletPanel(detailSlide, pptx, {
      x: 0.35, y: 6.18, w: 5.8, h: 0.88,
      title: "Operating focus",
      items: recommendationLines,
      fontSize: 8.8
    });
    await addPptxMemberStrip(detailSlide, pptx, people, assetCache, {
      x: 6.3, y: 6.18, w: 3.2, h: 0.88, title: "People behind this community", max: 4
    });
  }

  const closeSlide = pptx.addSlide();
  await addPptxDeckShell(closeSlide, pptx, report, {
    title: "Thank You / Next Steps",
    ribbon: "Watchlist and action items",
    accent: RISE_PRESENTATION_BRAND.blue,
    photoData: coverPhotoData
  });
  const opportunities = buildMonthlyInvestorPresentationOpportunities(report, 8);
  addPptxBulletPanel(closeSlide, pptx, {
    x: 0.35, y: 2.05, w: 4.55, h: 3.9,
    title: "Top watchlist items",
    items: opportunities.length > 0
      ? opportunities.map(item => `${item.community}: ${item.title} - ${item.body}`)
      : ["No active recommendation items are currently flagged in the selected sections."]
  });
  addPptxBulletPanel(closeSlide, pptx, {
    x: 5.05, y: 2.05, w: 4.45, h: 3.9,
    title: "Canva import workflow",
    items: [
      "Use Export for Canva (PPTX) to generate a native slide deck from the live dashboard data.",
      "Import the PPTX into Canva to continue editing with slide-level objects and images in place.",
      "Use the HTML deck or PDF export when you need a quick visual review before final investor distribution."
    ]
  });
}
