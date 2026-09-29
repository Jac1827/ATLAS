// Preserve HTML entry URLs published by the finance compatibility release when
// the current operational runtime is selected. No duplicate finance asset tree.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Existing compatibility HTML entries, plus the explicit preparation page
// delivered before the current operational runtime is activated.
export const FINANCE_HTML_ENTRIES = Object.freeze([
  'activate/index.html',
  'auth/callback/index.html',
  'index.html',
  'invite/index.html',
  'performance-platform.html',
  'portfolio-operations-dashboard/RISE-Budget-Builder.html',
  'portfolio-operations-dashboard/RISE-Marketing-Command-Center.html',
  'portfolio-operations-dashboard/RISE-Performance-Platform.html',
  'portfolio-operations-dashboard/RISE-Weekly-Maintenance-Report.html',
  'portfolio-operations-dashboard/activate/index.html',
  'portfolio-operations-dashboard/auth/callback/index.html',
  'portfolio-operations-dashboard/budget-dashboard-review/executive-accountability-workbench.html',
  'portfolio-operations-dashboard/budget-dashboard-review/playground.html',
  'portfolio-operations-dashboard/financial-accountability.html',
  'portfolio-operations-dashboard/index.html',
  'portfolio-operations-dashboard/invite/index.html',
  'portfolio-operations-dashboard/leasing-velocity-report-template.html',
  'portfolio-operations-dashboard/scout-visual-prototype.html',
  'portfolio-operations-dashboard/set-password/index.html',
  'portfolio-operations-dashboard/workspace-activation.html',
  'reit-management/index.html',
  'reit-management/uploads/RISE-Budget-Builder.html',
  'reit-management/uploads/RISE-Marketing-Command-Center.html',
  'reit-management/uploads/RISE-Performance-Platform.html',
  'reit-management/uploads/RISE-Weekly-Maintenance-Report.html',
  'set-password/index.html',
]);

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
async function inventory(directory, prefix = '') {
  const rows = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), {withFileTypes:true})) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw Error('Current site source cannot contain symlinks: ' + relative);
    if (entry.isDirectory()) rows.push(...await inventory(directory, relative));
    else if (entry.isFile()) {
      const bytes = await fs.readFile(path.join(directory, relative));
      rows.push({path:relative, sha256:sha(bytes), bytes:bytes.length});
    } else throw Error('Unsupported current site source entry: ' + relative);
  }
  return rows.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function financeEntryAlias(relative) {
  if (!FINANCE_HTML_ENTRIES.includes(relative)) throw Error('Unreviewed finance HTML entry');
  const alias = 'finance/' + relative;
  const target = path.posix.relative(path.posix.dirname(alias), relative);
  // Use the visible URL, not document.baseURI: canonical packaging adds a
  // frozen asset base. This also preserves the Pages project prefix and leaves
  // a directly opened immutable alias inside its own immutable release.
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Opening ATLAS</title></head><body>'
    + '<p>Opening ATLAS… <a id="atlas-current-entry" href="' + target + '">Continue</a></p>'
    + '<script>const target=new URL(' + JSON.stringify(target) + ',location.href);target.search=location.search;target.hash=location.hash;document.getElementById("atlas-current-entry").href=target.href;location.replace(target.href);</script>'
    + '</body></html>\n';
}

export async function stageFinanceEntryAliases({source, out} = {}) {
  if (!source || !out) throw Error('Explicit current source and staging directory are required');
  source = await fs.realpath(source);
  out = path.join(await fs.realpath(path.dirname(path.resolve(out))), path.basename(out));
  if (inside(source,out) || inside(out,source)) throw Error('Alias staging must be separate from the source');
  try { await fs.lstat(out); throw Error('Alias staging directory already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sourceFiles = await inventory(source);
  if (sourceFiles.some(row => row.path.startsWith('finance/'))) throw Error('Finance entry aliases require an uncomposed current source');
  const names = new Set(sourceFiles.map(row => row.path));
  for (const relative of FINANCE_HTML_ENTRIES) if (!names.has(relative)) throw Error('Current finance entry destination is missing: ' + relative);
  await fs.mkdir(out);
  try {
    await fs.cp(source,out,{recursive:true});
    const aliases = [];
    for (const relative of FINANCE_HTML_ENTRIES) {
      const name = 'finance/' + relative, bytes = Buffer.from(financeEntryAlias(relative));
      await fs.mkdir(path.dirname(path.join(out,name)),{recursive:true});
      await fs.writeFile(path.join(out,name),bytes);
      aliases.push({path:name,target:relative,sha256:sha(bytes),bytes:bytes.length});
    }
    const currentFiles = await inventory(source), staged = await inventory(out);
    const originals = staged.filter(row => !row.path.startsWith('finance/'));
    if (JSON.stringify(currentFiles) !== JSON.stringify(sourceFiles) || JSON.stringify(originals) !== JSON.stringify(sourceFiles)) throw Error('Current source changed during alias staging');
    return {source:out, aliases, originalSourceFiles:sourceFiles.length, originalSourceInventoryHash:sha(JSON.stringify(sourceFiles))};
  } catch (error) { await fs.rm(out,{recursive:true,force:true}); throw error; }
}
