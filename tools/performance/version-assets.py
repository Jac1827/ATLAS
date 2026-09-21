"""Refresh content-derived cache keys; children are versioned before their parents."""
from pathlib import Path
import hashlib, json, re
root=Path(__file__).resolve().parents[2]/'docs/portfolio-operations-dashboard'
entries=[
 ('centralization/atlas-central-client.js',[('index.html','./centralization/atlas-central-client.js')]),
 ('vendor/pptxgen-4.0.1.js',[('performance/feature-loader.js','vendor/pptxgen-4.0.1.js')]),
 ('vendor/jszip.min.js',[('performance/feature-loader.js','vendor/jszip.min.js')]),
 ('features/workbook-worker.js',[('features/workbook-session.mjs','./workbook-worker.js')]),
 ('features/workbook-session.mjs',[('index.html','./features/workbook-session.mjs')]),
 ('features/portfolio-map.mjs',[('index.html','./features/portfolio-map.mjs')]),
 ('features/presentation-slides.mjs',[('index.html','./features/presentation-slides.mjs')]),
 ('performance/diagnostics.js',[('index.html','./performance/diagnostics.js')]),
 ('performance/feature-loader.js',[('index.html','./performance/feature-loader.js')]),
 ('migration-archive.js',[('index.html','./migration-archive.js')]),
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
