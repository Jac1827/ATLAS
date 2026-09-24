import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const NAMESPACE = '_atlas-assets';
const RELEASE_MANIFEST = '.atlas-release.json';
const SITE_MANIFEST = 'atlas-asset-manifest.json';
const FORMAT = 1;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const contained = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const exists = async value => fs.access(value).then(() => true, () => false);
async function realDestination(value) {
  const resolved = path.resolve(value);
  try { return await fs.realpath(resolved); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return path.join(await realDestination(path.dirname(resolved)),path.basename(resolved));
  }
}
const safeRelative = value => typeof value === 'string' && value && !value.includes('\\') && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');

async function filesIn(root, prefix = '') {
  const result = [];
  for (const entry of (await fs.readdir(path.join(root, prefix), {withFileTypes:true})).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw Error(`Asset symlink is not allowed: ${relative}`);
    if (entry.isDirectory()) result.push(...await filesIn(root, relative));
    else if (entry.isFile()) result.push(relative);
    else throw Error(`Unsupported asset type: ${relative}`);
  }
  return result.sort();
}

async function describe(root, names) {
  return Promise.all(names.map(async relative => {
    const bytes = await fs.readFile(path.join(root, relative));
    return {path:relative, sha256:sha256(bytes), bytes:bytes.length};
  }));
}

function releaseDescriptor(files) { return {schemaVersion:FORMAT, packagerVersion:FORMAT, files}; }
function releaseIdFor(files) { return sha256(JSON.stringify(releaseDescriptor(files))); }

export async function verifyRelease(directory, expectedId = path.basename(directory)) {
  if (!/^[a-f0-9]{64}$/.test(expectedId)) throw Error('Invalid retained release identifier');
  const manifest = JSON.parse(await fs.readFile(path.join(directory, RELEASE_MANIFEST), 'utf8'));
  if (manifest.schemaVersion !== FORMAT || manifest.packagerVersion !== FORMAT || manifest.releaseId !== expectedId || !Array.isArray(manifest.files)) throw Error('Unsupported retained release manifest');
  const names = manifest.files.map(file => file.path);
  if (!names.every(safeRelative) || new Set(names).size !== names.length || names.includes(RELEASE_MANIFEST)) throw Error('Invalid retained file paths');
  const actualNames = (await filesIn(directory)).filter(name => name !== RELEASE_MANIFEST);
  if (JSON.stringify(actualNames) !== JSON.stringify(names)) throw Error('Retained release file inventory changed');
  const files = await describe(directory, names);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files) || releaseIdFor(files) !== expectedId) throw Error('Retained release content hash mismatch');
  return manifest;
}

async function retainedReleases(root) {
  const namespace = path.join(root, NAMESPACE);
  if (!await exists(namespace)) return [];
  const result = [];
  for (const entry of (await fs.readdir(namespace, {withFileTypes:true})).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) throw Error('Unexpected retained release entry');
    const directory = path.join(namespace, entry.name);
    result.push({directory, manifest:await verifyRelease(directory, entry.name)});
  }
  return result;
}

// A base preserves document-relative scripts, inline dynamic imports, lazy classic
// scripts and iframe URLs. Native module imports, CSS URLs and import.meta worker
// URLs keep their existing relative paths inside the complete frozen tree.
export function canonicalHtml(html, relative, releaseId) {
  if (relative === 'index.html') return html; // Existing root redirect remains canonical.
  if (/<base\b/i.test(html)) throw Error(`Existing HTML base requires explicit review: ${relative}`);
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw Error(`HTML head is required: ${relative}`);
  const directory = path.posix.dirname(relative);
  const target = `${NAMESPACE}/${releaseId}/${relative}`;
  let base = path.posix.relative(directory, target);
  if (!base.startsWith('.')) base = './' + base;
  const escaped = base.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  return html.replace(/<head(?:\s[^>]*)?>/i, tag => `${tag}\n<base data-atlas-asset-release="${releaseId}" href="${escaped}">`);
}

export async function packageAssets({source = 'docs', out = 'output/atlas-site', retained, allowEmptyRetained = false, maxFiles = 19000} = {}) {
  source = await fs.realpath(path.resolve(source));
  out = await realDestination(out);
  if (contained(source,out) || contained(out,source)) throw Error('Source and output must be separate trees');
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw Error('Invalid asset file limit');
  const names = await filesIn(source);
  if (names.some(name => name === SITE_MANIFEST || name === RELEASE_MANIFEST || name === NAMESPACE || name.startsWith(NAMESPACE + '/'))) throw Error('Source contains reserved generated asset paths');
  const files = await describe(source,names);
  const releaseId = releaseIdFor(files);
  const manifest = {...releaseDescriptor(files),releaseId};
  const releases = new Map();
  if (retained) {
    retained = await fs.realpath(path.resolve(retained));
    if (contained(source,retained) || contained(retained,source) || contained(out,retained) || contained(retained,out)) throw Error('Retained input, source and output must be separate trees');
    for (const item of await retainedReleases(retained)) releases.set(item.manifest.releaseId,item);
  }
  if (await exists(out)) {
    if (!await exists(path.join(out,SITE_MANIFEST))) throw Error('Refusing to replace an output directory without the generated site manifest');
    for (const item of await retainedReleases(out)) releases.set(item.manifest.releaseId,item);
  }
  if (!releases.size && !allowEmptyRetained) throw Error('Verified retained releases are required; use --allow-empty-retained only for the first immutable release');
  const retainedIds = [...new Set([...releases.keys(),releaseId])].sort();
  const fileCount = names.length + 2 + retainedIds.reduce((n,id) => n + (id === releaseId ? files.length : releases.get(id).manifest.files.length) + 1,0);
  if (fileCount > maxFiles) throw Error(`Retained assets require ${fileCount} files, above the ${maxFiles} safety limit. Review retention and hosting limits; no releases were pruned.`);
  await fs.mkdir(path.dirname(out),{recursive:true});
  const staging = await fs.mkdtemp(path.join(path.dirname(out),'.atlas-package-'));
  try {
    for (const item of releases.values()) await fs.cp(item.directory,path.join(staging,NAMESPACE,item.manifest.releaseId),{recursive:true,errorOnExist:true,force:false});
    const current = path.join(staging,NAMESPACE,releaseId);
    if (!await exists(current)) {
      await fs.cp(source,current,{recursive:true,errorOnExist:true,force:false});
      await fs.writeFile(path.join(current,RELEASE_MANIFEST),JSON.stringify(manifest,null,2)+'\n');
    }
    await verifyRelease(current,releaseId);
    for (const relative of names) {
      const destination = path.join(staging,relative);
      await fs.mkdir(path.dirname(destination),{recursive:true});
      const bytes = await fs.readFile(path.join(source,relative));
      // Refuse source changes during the package operation, including child files.
      const expected = files.find(file => file.path === relative);
      if (sha256(bytes) !== expected.sha256) throw Error(`Source changed during packaging: ${relative}`);
      await fs.writeFile(destination, /\.html?$/i.test(relative) ? canonicalHtml(bytes.toString('utf8'),relative,releaseId) : bytes);
    }
    const canonicalFiles = await describe(staging,names);
    const siteManifest = {schemaVersion:FORMAT,releaseId,retainedReleaseIds:retainedIds,sourceFiles:files,canonicalFiles};
    await fs.writeFile(path.join(staging,SITE_MANIFEST),JSON.stringify(siteManifest,null,2)+'\n');
    // GitHub Pages must serve the underscore-prefixed immutable namespace.
    await fs.writeFile(path.join(staging,'.nojekyll'),'');
    if (await exists(out)) await fs.rm(out,{recursive:true});
    await fs.rename(staging,out);
    return {releaseId,out,releaseCount:retainedIds.length,fileCount,manifestPath:path.join(out,SITE_MANIFEST)};
  } catch (error) { await fs.rm(staging,{recursive:true,force:true}); throw error; }
}

async function main() {
  const options = {};
  const names = {'--source':'source','--out':'out','--retained':'retained','--max-files':'maxFiles'};
  for (let index=2;index<process.argv.length;index++) {
    const argument=process.argv[index];
    if (argument==='--allow-empty-retained') options.allowEmptyRetained=true;
    else if (names[argument] && process.argv[index+1] && !process.argv[index+1].startsWith('--')) options[names[argument]]=argument==='--max-files'?Number(process.argv[++index]):process.argv[++index];
    else throw Error(`Unknown or incomplete argument: ${argument}`);
  }
  console.log(JSON.stringify(await packageAssets(options),null,2));
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});
