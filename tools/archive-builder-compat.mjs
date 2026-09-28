/** Three exact archive-construction boundaries; startup and restore are unchanged. */
export const ARCHIVE_BUILDER_BOUNDARY_COUNT=3;
function fn(source,name){const match=source.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'));if(!match||source.indexOf(match[0])!==source.lastIndexOf(match[0]))throw Error('Missing or ambiguous archive builder: '+name);return match[0];}
export function patchArchiveBuilderBoundary(source,current){
 const original=source,helper=fn(current,'packAtlasCentralRetainedRecords'),currentBuilder=fn(current,'buildAtlasCentralAppStatePayload'),anchor='async function buildAtlasCentralAppStatePayload() {';
 if(source.includes('function packAtlasCentralRetainedRecords(')||source.split(anchor).length!==2)throw Error('Archive packing helper boundary changed');
 if(!currentBuilder.includes('await packAtlasCentralRetainedRecords(bundle, { expandImportHistory: true })')||!currentBuilder.includes('await window.AtlasMigrationArchive.verifyBundle(portableBundle, JSZip)'))throw Error('Current archive builder contract changed');
 const capture='  const retainedRecords = (await withAtlasStateStore("readonly", store => store.getAll())).filter(record =>\n    record.key === DATA_IMPORT_2_STATE_KEY || record.key.startsWith(DATA_IMPORT_FILE_ARCHIVE_PREFIX) || record.key.startsWith("occupancy_replay_backup:"));\n  const portableBundle = await window.AtlasMigrationArchive.pack(bundle, retainedRecords, JSZip);';
 const packed='  const portableBundle = await packAtlasCentralRetainedRecords(bundle);';
 const oldVerify='  const restored = await window.AtlasMigrationArchive.unpack(portableBundle, JSZip);',newVerify='  const restored = await window.AtlasMigrationArchive.verifyBundle(portableBundle, JSZip);';
 const builder=fn(source,'buildAtlasCentralAppStatePayload');for(const part of [capture,oldVerify])if(builder.split(part).length!==2)throw Error('Retained archive builder boundary changed');
 source=source.replace(builder,builder.replace(capture,packed).replace(oldVerify,newVerify)).replace(anchor,helper+'\n\n'+anchor);
 const patched=fn(source,'buildAtlasCentralAppStatePayload');const proof=source.replace(helper+'\n\n'+anchor,anchor).replace(patched,patched.replace(packed,capture).replace(newVerify,oldVerify));
 if(proof!==original)throw Error('Archive builder changed unrelated operational bytes');
 return source;
}
