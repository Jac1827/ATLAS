/** Add only the read-only receipt discovery helpers to the retained host. */
export const REPLAY_RECOVERY_DISCOVERY_BOUNDARY_COUNT=3;
export function patchReplayRecoveryDiscoveryBoundary(source,current){
 const original=source,anchor='async function inspectDataImportReplayReceipt(archiveId) {';
 const helpers=['dataImportReplayRecoveryReader','showDataImportReplayCheckpoint','dismissDataImportReplayCheckpoint','selectDataImportReplayCheckpoint'].map(name=>{
  const match=current.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'));
  if(!match||source.includes('function '+name+'('))throw Error('Replay discovery helper boundary changed: '+name);
  return match[0];
 }).join('\n\n')+'\n\n';
 if(source.split(anchor).length!==2||!source.includes('const reader=dataImportReplayRecoveryReader(entry);'))throw Error('Replay discovery inspection boundary changed');
 const capture='    else {beforeSaved=JSON.stringify(savedData);beforeImport=JSON.stringify(dataImport2State);}',progress=capture+'\n    if(checkpoint)window.showDataImportReplayCheckpoint?.(checkpoint);';
 if(source.split(capture).length!==2||!current.includes(progress))throw Error('Replay discovery progress boundary changed');
 const stopped='    if (!checkpoint || checkpoint.mayRender()) alert(`${published ? "The source replay committed, but its completion display stopped" : "Source recovery stopped"}: ${error.message || error}${recovery}`);',dismissed=stopped+'\n    if(checkpoint&&!published&&!recovery)window.dismissDataImportReplayCheckpoint?.(checkpoint.name);';
 if(source.split(stopped).length!==2||!current.includes(dismissed))throw Error('Replay discovery rollback notice boundary changed');
 source=source.replace(anchor,helpers+anchor).replace(capture,progress).replace(stopped,dismissed);
 if(source.split(helpers+anchor).length!==2||source.replace(helpers+anchor,anchor).replace(progress,capture).replace(dismissed,stopped)!==original)throw Error('Replay discovery changed unrelated startup bytes');
 return source;
}
