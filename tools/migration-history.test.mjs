// Pin already-applied SQL without blocking later additive migrations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'supabase/migration-history.json'), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');

export function validateMigrationHistory(files, history) {
  const entries = Object.entries(files), versions = new Set();
  for (const [file] of entries) {
    const parsed = file.match(/^(\d{14})_([a-z0-9_]+)\.sql$/);
    assert(parsed, `Invalid migration filename: ${file}`);
    assert(!versions.has(parsed[1]), `Duplicate migration version: ${parsed[1]}`);
    versions.add(parsed[1]);
  }
  const pinned = new Map(history.records.map(record => [record.file, record]));
  assert.equal(pinned.size, history.records.length, 'Manifest contains duplicate filenames');
  for (const record of history.records) {
    assert(files[record.file] !== undefined, `Applied migration missing or renamed: ${record.file}`);
    assert.equal(record.file, `${record.version}_${record.name}.sql`, 'Manifest identity mismatch');
    const bytes = Buffer.from(files[record.file]);
    assert.equal(bytes.length, record.bytes, `Applied migration byte length changed: ${record.file}`);
    assert.equal(digest(bytes), record.sha256, `Applied migration SQL changed: ${record.file}`);
  }
  for (const [file] of entries) {
    if (!pinned.has(file)) assert(file.slice(0, 14) > history.historicalCutoff, `Unrecognized migration before applied-history cutoff: ${file}`);
  }
  return {pinned: history.records.length, additional: entries.length - history.records.length};
}

const files = Object.fromEntries(fs.readdirSync(path.join(root, 'supabase/migrations')).filter(file => file.endsWith('.sql')).map(file => [file, fs.readFileSync(path.join(root, 'supabase/migrations', file))]));
const result = validateMigrationHistory(files, manifest);
const first = manifest.records[0].file;
assert.throws(() => validateMigrationHistory({...files, [first]: Buffer.concat([files[first], Buffer.from('\n-- drift')])}, manifest), /changed/);
const missing = {...files}; delete missing[first];
assert.throws(() => validateMigrationHistory(missing, manifest), /missing or renamed/);
assert.throws(() => validateMigrationHistory({...files, '20200101000000_unrecorded_baseline.sql': Buffer.from('select 1;')}, manifest), /cutoff/);
const latestVersion = Object.keys(files).map(file => file.slice(0, 14)).sort().at(-1);
const futureVersion = String(BigInt(latestVersion) + 1n);
assert.equal(validateMigrationHistory({...files, [`${futureVersion}_future_change.sql`]: Buffer.from('select 1;')}, manifest).additional, result.additional + 1);
assert.throws(() => validateMigrationHistory({...files, [`${manifest.records[0].version}_duplicate.sql`]: Buffer.from('select 1;')}, manifest), /Duplicate migration/);
console.log(`PASS migration history: ${result.pinned} exact production bodies preserved; ${result.additional} later migration(s); rejects drift, missing/duplicate versions and unrecorded old entries while allowing future migrations.`);
