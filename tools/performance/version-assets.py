"""Refresh content-derived cache keys; children are versioned before their parents."""
from pathlib import Path
import hashlib, json, re, posixpath
root=Path(__file__).resolve().parents[2]/'docs/portfolio-operations-dashboard'
entries=[
 ('market-save-guards.js',[('index.html','./market-save-guards.js')]),
 ('workforce-sync.js',[('index.html','./workforce-sync.js')]),
 ('workforce-assignment.js',[('index.html','./workforce-assignment.js')]),
 ('application-aging.js',[('index.html','./application-aging.js')]),
 ('budget-workbook-import.js',[('RISE-Budget-Builder.html','./budget-workbook-import.js')]),
 ('features/reforecast-engine.mjs', [('features/reforecast-legacy-bridge.mjs', './reforecast-engine.mjs'), ('features/reforecast-ui.mjs', './reforecast-engine.mjs')]),
 ('features/reforecast-active.mjs', [('features/reforecast-store.mjs', './reforecast-active.mjs'), ('features/community-plan-report.mjs', './reforecast-active.mjs')]),
 ('features/reforecast-store.mjs', [('features/reforecast-ui.mjs', './reforecast-store.mjs'), ('features/reforecast-import-ui.mjs', './reforecast-store.mjs'), ('features/reforecast-consumers.mjs', './reforecast-store.mjs'), ('features/scout-reforecast.mjs', './reforecast-store.mjs'), ('investor-budget-bridge.js', './features/reforecast-store.mjs')]),
 ('features/reforecast-report.mjs', [('features/reforecast-ui.mjs', './reforecast-report.mjs'), ('features/reforecast-consumers.mjs', './reforecast-report.mjs'), ('features/scout-reforecast.mjs', './reforecast-report.mjs')]),
 ('features/reforecast-intake.mjs', [('features/reforecast-ui.mjs', './reforecast-intake.mjs'), ('features/reforecast-import-ui.mjs', './reforecast-intake.mjs'), ('features/financial-close-report.mjs','./reforecast-intake.mjs')]),
 ('features/reforecast-import-ui.mjs', [('features/reforecast-ui.mjs', './reforecast-import-ui.mjs')]),
 ('features/reforecast-legacy-bridge.mjs', [('reforecast-navigation.js', './features/reforecast-legacy-bridge.mjs'), ('features/reforecast-ui.mjs', './reforecast-legacy-bridge.mjs')]),
 ('features/reforecast-ui.mjs', [('reforecast-navigation.js', './features/reforecast-ui.mjs')]),
 ('features/reforecast-consumers.mjs', [('reforecast-consumers.js', './features/reforecast-consumers.mjs'), ('features/scout-reforecast.mjs', './reforecast-consumers.mjs')]),
 ('features/scout-reforecast.mjs', [('scout-visual-prototype.html', './features/scout-reforecast.mjs')]),
 ('reforecast-consumers.js', [('index.html', './reforecast-consumers.js')]),
 ('reforecast-navigation.js', [('RISE-Budget-Builder.html', './reforecast-navigation.js')]),
 ('features/canonical-finance.mjs',[('features/financial-comparison.mjs','./canonical-finance.mjs'),('features/financial-package-review.mjs','./canonical-finance.mjs'),('features/financial-close-report.mjs','./canonical-finance.mjs'),('features/approved-budget.mjs','./canonical-finance.mjs'),('features/financial-close.mjs','./canonical-finance.mjs'),('features/community-finance.mjs','./canonical-finance.mjs'),('features/community-plan.mjs','./canonical-finance.mjs'),('features/budget-command-publication.mjs','./canonical-finance.mjs'),('investor-budget-bridge.js','./features/canonical-finance.mjs')]),
 ('features/approved-budget.mjs',[('features/budget-command-publication.mjs','./approved-budget.mjs')]),

 ('application-lineage.js',[('index.html','./application-lineage.js')]),
 ('screening-summary.js',[('index.html','./screening-summary.js')]),
 ('lead-source-contract.js',[('index.html','./lead-source-contract.js')]),
 ('lead-source-mapping-store.js',[('index.html','./lead-source-mapping-store.js')]),
 ('lead-source-review.js',[('index.html','./lead-source-review.js')]),
 ('application-source-bridge.js',[('index.html','./application-source-bridge.js')]),
 ('application-performance-ui.js',[('index.html','./application-performance-ui.js')]),

 ('atlas-dashboard-reskin.js',[('index.html','./atlas-dashboard-reskin.js')]),
 ('atlas-redesign.css',[('index.html','atlas-redesign.css')]),
 ('contract-terms.js',[('RISE-Budget-Builder.html','./contract-terms.js')]),
 ('features/import-history-store.mjs',[('features/import-history.mjs','./import-history-store.mjs'),('features/import-history-worker.mjs','./import-history-store.mjs')]),
 ('features/import-history-worker.mjs',[('features/import-history.mjs','./import-history-worker.mjs')]),
 ('features/import-history.mjs',[('index.html','./features/import-history.mjs')]),
 ('features/financial-ocr.mjs',[('features/financial-package-reader.mjs','./financial-ocr.mjs')]),
 ('features/financial-row-reconciliation.mjs',[('features/financial-package.mjs','./financial-row-reconciliation.mjs')]),
 ('features/financial-package.mjs',[('features/financial-intake-store.mjs','./financial-package.mjs'),('features/financial-workbook-parser.mjs','./financial-package.mjs'),('features/financial-package-reader.mjs','./financial-package.mjs'),('features/financial-package-review.mjs','./financial-package.mjs'),('features/financial-package-batch.mjs','./financial-package.mjs'),('features/financial-comparison.mjs','./financial-package.mjs'),('budget-navigation.js','./features/financial-package.mjs'),('investor-budget-bridge.js','./features/financial-package.mjs'),('features/budget-command-publication.mjs','./financial-package.mjs')]),
 ('features/financial-workbook-parser.mjs',[('features/financial-workbook-worker.mjs','./financial-workbook-parser.mjs')]),
 ('features/financial-workbook-worker.mjs',[('features/financial-package-reader.mjs','./financial-workbook-worker.mjs')]),
 ('features/financial-package-reader.mjs',[('features/financial-package-review.mjs','./financial-package-reader.mjs'),('features/financial-package-batch.mjs','./financial-package-reader.mjs')]),
 ('features/financial-intake-store.mjs',[('features/financial-close.mjs','./financial-intake-store.mjs'),('features/financial-package-review.mjs','./financial-intake-store.mjs'),('features/financial-package-batch.mjs','./financial-intake-store.mjs')]),
 ('features/financial-close.mjs',[('features/financial-close-report.mjs','./financial-close.mjs'),('features/financial-comparison.mjs','./financial-close.mjs'),('features/financial-package-batch.mjs','./financial-close.mjs'),('budget-navigation.js','./features/financial-close.mjs'),('index.html','./features/financial-close.mjs')]),
 ('features/financial-close-report.mjs',[('features/financial-comparison.mjs','./financial-close-report.mjs')]),
 ('features/financial-comparison.mjs',[('features/financial-package-review.mjs','./financial-comparison.mjs'),('budget-navigation.js','./features/financial-comparison.mjs')]),
 ('features/financial-package-review.mjs',[('budget-navigation.js','./features/financial-package-review.mjs')]),
 ('financial-publication.js',[('index.html','financial-publication.js'),('financial-accountability.html','financial-publication.js')]),
 ('budget-navigation.js',[('RISE-Budget-Builder.html','./budget-navigation.js')]),
 ('budget-navigation.css',[('RISE-Budget-Builder.html','./budget-navigation.css')]),
 ('budget-mapped-import.js',[('RISE-Budget-Builder.html','./budget-mapped-import.js')]),
 ('features/community-plan-report.mjs',[('features/community-plan.mjs','./community-plan-report.mjs')]),
 ('community-command-contract.js',[('features/community-finance.mjs','../community-command-contract.js')]),
 ('features/community-finance.mjs',[('index.html','./features/community-finance.mjs')]),
 ('features/budget-command-publication.mjs',[('RISE-Budget-Builder.html','./features/budget-command-publication.mjs')]),
 ('investor-packet-core.js',[('index.html','./investor-packet-core.js')]),
 ('investor-packet-sources.js',[('index.html','./investor-packet-sources.js')]),
 ('investor-packet-ui.js',[('index.html','investor-packet-ui.js')]),
 ('investor-budget-bridge.js',[('RISE-Budget-Builder.html','./investor-budget-bridge.js')]),
 ('RISE-Budget-Builder.html',[('atlas-mounts.js','RISE-Budget-Builder.html')]),
 ('atlas-mounts.js',[('index.html','./atlas-mounts.js')]),
 ('features/community-plan.mjs',[('index.html','./features/community-plan.mjs')]),
 ('features/community-goals.mjs',[('index.html','./features/community-goals.mjs')]),
 ('community-goal-editor.js',[('index.html','./community-goal-editor.js')]),
 ('centralization/atlas-central-client.js',[('index.html','./centralization/atlas-central-client.js'), ('scout-visual-prototype.html','./centralization/atlas-central-client.js')]),
 ('vendor/pptxgen-4.0.1.js',[('performance/feature-loader.js','vendor/pptxgen-4.0.1.js')]),
 ('vendor/jszip.min.js',[('performance/feature-loader.js','vendor/jszip.min.js')]),
 ('features/workbook-worker.js',[('features/workbook-session.mjs','./workbook-worker.js')]),
 ('features/workbook-session.mjs',[('index.html','./features/workbook-session.mjs'),('occupancy-replay-browser.js','./features/workbook-session.mjs')]),
 ('occupancy-replay-browser.js',[('performance/feature-loader.js','occupancy-replay-browser.js')]),
 ('features/portfolio-map.mjs',[('index.html','./features/portfolio-map.mjs')]),
 ('features/presentation-slides.mjs',[('index.html','./features/presentation-slides.mjs')]),
 ('performance/diagnostics.js',[('index.html','./performance/diagnostics.js')]),
 ('migration-archive.js',[('performance/feature-loader.js','migration-archive.js')]),
 ('performance/feature-loader.js',[('index.html','./performance/feature-loader.js')]),
 ('investor-packet-ui.js',[('index.html','./investor-packet-ui.js')]),
]
# Discover imports of governed modules so a stale parent cannot keep an old
# child after deployment. A topological pass versions every child first.
tracked={asset: list(refs) for asset,refs in entries}
for asset in ['features/reforecast-report-library.mjs','features/original-budget-version-report.mjs']:
 tracked.setdefault(asset,[])
for asset in ['features/workbook-rich-images.mjs','features/reforecast-str-overlay.mjs','features/reforecast-authority.mjs','features/reforecast-recovery.mjs','features/reforecast-registry-proposal.mjs','features/reforecast-str-json-recovery.mjs','features/reforecast-parser-recovery.mjs','features/reforecast-str-saved-programme.mjs','features/reforecast-str-saved-programme-runtime.mjs','features/reforecast-str-saved-programme-ui.mjs','features/reforecast-str-registry-extension.mjs']:
 tracked.setdefault(asset,[])
for asset in ['features/bonus-workflow-client.mjs','features/bonus-workflow.mjs','features/reforecast-bonus.mjs','features/reforecast-provider.mjs','features/reforecast-builder-ui.mjs','features/reforecast-utility.mjs','features/workbook-integrity.mjs','features/planning-governance.mjs','features/workbook-audit-store.mjs','features/financial-workbook-governance.mjs','features/financial-snapshot.mjs','features/snapshot-pdf.mjs','features/canonical-budget-report.mjs','features/original-budget-intake.mjs','vendor/pdf-lib-1.17.1.mjs']:
 tracked.setdefault(asset,[])
for parent in root.rglob('*'):
 if parent.suffix not in ('.mjs','.js','.html'):continue
 relative=parent.relative_to(root).as_posix()
 for match in re.finditer(r"[\"']((?:\.\.?/)[^\"'?#\s]+)(?:\?v=[^\"'\s]+)?[\"']",parent.read_text()):
  if re.search(r'require\s*\(\s*$',parent.read_text()[:match.start()]):continue
  ref=match.group(1);target=posixpath.normpath(posixpath.join(posixpath.dirname(relative),ref))
  if target in tracked and (relative,ref) not in tracked[target]:tracked[target].append((relative,ref))
children={asset:set() for asset in tracked}
for child,refs in tracked.items():
 for parent,ref in refs:
  if parent in tracked:children[parent].add(child)
ordered=[];visiting=set();done=set()
def visit(asset):
 if asset in done:return
 if asset in visiting:raise RuntimeError('Circular versioned asset dependency: '+asset)
 visiting.add(asset)
 for child in sorted(children[asset]):visit(child)
 visiting.remove(asset);done.add(asset);ordered.append((asset,tracked[asset]))
for asset in tracked:visit(asset)
manifest={}
for asset,refs in ordered:
 data=(root/asset).read_bytes(); digest=hashlib.sha256(data).hexdigest()[:16]
 manifest[asset]={'sha256':digest,'bytes':len(data),'references':refs}
 for parent,ref in refs:
  p=root/parent;s=p.read_text()
  pattern=re.escape(ref)+r'(?:\?v=[^\'"\s)]+)?(?=[\'"\s)])'
  s,count=re.subn(pattern,ref+'?v='+digest,s)
  if not count:raise RuntimeError('Missing reference '+str((parent,ref)))
  p.write_text(s)
(root/'performance/asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
