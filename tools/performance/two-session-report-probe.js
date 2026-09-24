// Read-only browser expression. Invoke the returned async function through a DOM
// evaluation tool on the NEW acceptance tab, never on the user's working tab.
// No application functions, storage, auth state, network, or DOM writes are used.
async function atlasTwoSessionReportProbe() {
  const fail = code => ({format: 1, status: 'not_ready', code});
  const panel = document.querySelector('#tab-panel-8');
  const frame = panel?.querySelector('#reporting-inline-preview iframe');
  const report = frame?.contentDocument;
  const rawContext = panel?.getAttribute('data-report-preview-context');
  if (!rawContext || !report?.body || report.title !== 'Weekly Leasing Report') return fail('weekly_report_not_ready');
  let context;
  try { context = JSON.parse(rawContext); } catch { return fail('source_receipt_missing'); }
  // Read only these non-personal fields from rendered DOM metadata. Never return
  // the complete context: it also contains access-profile and recipient details.
  const identity = context?.source?.[0];
  const binding = context?.source?.[1];
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (identity?.documentKey !== 'atlas_dashboard_state_v1' || !Number.isSafeInteger(identity.version) ||
      !hex(identity.archiveHash) || !Number.isFinite(Date.parse(identity.effectiveAt))) return fail('source_receipt_unavailable');
  const projectionBinding = Number.isSafeInteger(binding?.projectionVersion) && hex(binding.projectionContentHash) &&
    binding.projectionHashFormat === 'postgres-jsonb-sha256' && typeof binding.fullProjection === 'boolean'
    ? {version: binding.projectionVersion, contentHash: binding.projectionContentHash,
      hashFormat: binding.projectionHashFormat, fullProjection: binding.fullProjection} : null;
  const compact = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const sourceBanner = document.querySelector('#atlas-workspace-source')?.textContent || '';
  if (!sourceBanner.includes(`· version ${identity.version} · source effective ${identity.effectiveAt} · verified `)) return fail('source_banner_context_mismatch');
  const selected = () => ({
    type: panel.querySelector('select[onchange="setReportHubType(this.value)"]')?.value,
    month: panel.querySelector('select[onchange="setReportHubDateField(\'month\', this.value)"]')?.value,
    year: panel.querySelector('input[onchange="setReportHubDateField(\'year\', this.value)"]')?.value,
    through: panel.querySelector('input[onchange="setWeeklyLeasingThroughDate(this.value)"]')?.value,
    workspace: document.querySelector('#workspace-community-select')?.value,
    scope: [...panel.querySelectorAll('button.active[onclick^="togglePortfolioReportFilter("]')]
      .map(node => node.getAttribute('onclick')).sort()
  });
  const selection = selected();
  if (selection.type !== 'rise_weekly_leasing' || !/^\d{4}$/.test(selection.year || '') ||
      !/^(?:[0-9]|1[01])$/.test(selection.month || '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(selection.through || '') || !selection.scope.length) return fail('explicit_report_selection_missing');
  if (!selection.through.startsWith(`${selection.year}-${String(Number(selection.month) + 1).padStart(2, '0')}-`)) return fail('period_mismatch');
  const originalText = report.body.textContent;
  const footer = report.querySelector('footer')?.textContent || '';
  const generated = /^Generated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z · /;
  if (!generated.test(footer)) return fail('unsupported_report_footer');
  const stableFooter = footer.replace(generated, 'Generated <export-time> · ');
  const text = compact(originalText.replace(footer, stableFooter));
  const cards = [...report.querySelectorAll('.cards .card')].map(node => compact(node.textContent));
  const tables = [...report.querySelectorAll('table')].map(table => [...table.rows]
    .map(row => [...row.cells].map(cell => compact(cell.textContent))));
  const notes = [...report.querySelectorAll('.note')].map(node => compact(node.textContent));
  const sources = [...report.querySelectorAll('footer')].map(() => compact(stableFooter));
  const runtime = [...document.scripts].filter(script => /\/(?:workspace-core|weekly-leasing-report|reports-workspace)\.js(?:\?|$)/.test(script.src))
    .map(script => { const url = new URL(script.src); return `${url.pathname}?v=${url.searchParams.get('v') || ''}`; }).sort();
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const hashes = await Promise.all([selection, text, cards, tables, [notes, sources], runtime].map(digest));
  if (panel !== document.querySelector('#tab-panel-8') || panel.getAttribute('data-report-preview-context') !== rawContext ||
      frame.contentDocument !== report || report.body.textContent !== originalText ||
      JSON.stringify(selected()) !== JSON.stringify(selection) ||
      document.querySelector('#atlas-workspace-source')?.textContent !== sourceBanner) return fail('report_changed_during_capture');
  return {
    format: 1, status: 'captured', reportType: 'rise_weekly_leasing',
    source: {
      documentKey: identity.documentKey, version: identity.version, archiveHash: identity.archiveHash,
      effectiveAt: identity.effectiveAt,
      verified: Number.isFinite(Date.parse(identity.verifiedAt)) && !/refresh unavailable|not yet checked|Source version not verified/.test(sourceBanner),
      localChanges: identity.localChanges === true || /local changes pending publication/.test(sourceBanner)
    },
    projectionBinding,
    period: `${selection.year}-${String(Number(selection.month) + 1).padStart(2, '0')}`,
    through: selection.through,
    selectionHash: hashes[0], reportTextHash: hashes[1], cardsHash: hashes[2],
    tablesHash: hashes[3], sourceNotesHash: hashes[4], runtimeHash: hashes[5],
    cardCount: cards.length, tableCount: tables.length, tableRowCount: tables.reduce((sum, table) => sum + table.length, 0)
  };
}
