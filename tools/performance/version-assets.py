"""Refresh content-derived cache keys; children are versioned before their parents."""
from pathlib import Path
import hashlib, json, re
root=Path(__file__).resolve().parents[2]/'docs/portfolio-operations-dashboard'
entries=[
 ('contract-terms.js',[('RISE-Budget-Builder.html','./contract-terms.js')]),
 ('features/import-history-store.mjs',[('features/import-history.mjs','./import-history-store.mjs'),('features/import-history-worker.mjs','./import-history-store.mjs')]),
 ('features/import-history-worker.mjs',[('features/import-history.mjs','./import-history-worker.mjs')]),
 ('features/import-history.mjs',[('index.html','./features/import-history.mjs')]),
 ('features/financial-ocr.mjs',[('features/financial-package-reader.mjs','./financial-ocr.mjs')]),
 ('features/financial-package.mjs',[('features/financial-package-reader.mjs','./financial-package.mjs'),('features/financial-package-review.mjs','./financial-package.mjs'),('features/financial-comparison.mjs','./financial-package.mjs'),('features/financial-workbook-worker.mjs','./financial-package.mjs')]),
 ('features/financial-workbook-worker.mjs',[('features/financial-package-reader.mjs','./financial-workbook-worker.mjs')]),
 ('features/financial-package-reader.mjs',[('features/financial-package-review.mjs','./financial-package-reader.mjs')]),
 ('features/financial-comparison.mjs',[('features/financial-package-review.mjs','./financial-comparison.mjs'),('budget-navigation.js','./features/financial-comparison.mjs')]),
 ('features/financial-package-review.mjs',[('budget-navigation.js','./features/financial-package-review.mjs')]),
 ('financial-publication.js',[('index.html','financial-publication.js'),('financial-accountability.html','financial-publication.js')]),
 ('budget-navigation.js',[('RISE-Budget-Builder.html','./budget-navigation.js')]),
 ('budget-navigation.css',[('RISE-Budget-Builder.html','./budget-navigation.css')]),
 ('budget-mapped-import.js',[('RISE-Budget-Builder.html','./budget-mapped-import.js')]),
 ('features/fiscal-ytd.mjs',[('features/budget-command-publication.mjs','./fiscal-ytd.mjs')]),
 ('features/community-plan-report.mjs',[('features/community-plan.mjs','./community-plan-report.mjs')]),
 ('community-command-contract.js',[('features/community-finance.mjs','../community-command-contract.js')]),
 ('features/community-finance.mjs',[('index.html','./features/community-finance.mjs')]),
 ('features/budget-command-publication.mjs',[('RISE-Budget-Builder.html','./features/budget-command-publication.mjs')]),
 ('RISE-Budget-Builder.html',[('atlas-mounts.js','RISE-Budget-Builder.html')]),
 ('atlas-mounts.js',[('index.html','./atlas-mounts.js')]),
 ('features/community-plan.mjs',[('index.html','./features/community-plan.mjs')]),
 ('centralization/atlas-central-client.js',[('index.html','./centralization/atlas-central-client.js')]),
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
manifest={}
for asset,refs in entries:
 data=(root/asset).read_bytes(); digest=hashlib.sha256(data).hexdigest()[:16]
 manifest[asset]={'sha256':digest,'bytes':len(data),'references':refs}
 for parent,ref in refs:
  p=root/parent;s=p.read_text()
  pattern=re.escape(ref)+r'(?:\?v=[^\'"\s)]+)?(?=[\'"\s)])'
  s,count=re.subn(pattern,ref+'?v='+digest,s)
  if not count:raise RuntimeError('Missing reference '+str((parent,ref)))
  p.write_text(s)
(root/'performance/asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
