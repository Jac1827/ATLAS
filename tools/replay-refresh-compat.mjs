/** Only reviewed replay refresh and small receipt boundaries in retained startup. */
export const REPLAY_REFRESH_BOUNDARY_COUNT=16;
function fn(source,name){const match=source.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'));if(!match)throw Error('Missing replay refresh boundary: '+name);return match[0];}
export function patchReplayRefreshBoundary(source,current,archiveUi){
 const original=source,undo=[];
 const replace=(name,before,after)=>{const body=fn(source,name);if(body.split(before).length!==2)throw Error('Ambiguous replay refresh boundary: '+name);source=source.replace(body,body.replace(before,after));undo.push([name,after,before]);};
 const insert=(name,text)=>{const line=fn(source,name).split('\n')[0];replace(name,line,line+'\n'+text);};
 const copied=fn(current,'inspectDataImportReplayReceipt')+'\n\n',anchor='async function dataImportCreateReplayCheckpoint(entry) {';
 if(source.split(anchor).length!==2||source.includes('function inspectDataImportReplayReceipt('))throw Error('Replay inspection helper boundary changed');source=source.replace(anchor,copied+anchor);undo.push([null,copied+anchor,anchor]);
 const guard='  if(window.AtlasReplayWriteFence)return {changed:false,deferred:true};\n  const replayGeneration=Number(window.AtlasReplayGeneration||0);';
 const after='\n    if(window.AtlasReplayWriteFence||replayGeneration!==Number(window.AtlasReplayGeneration||0))return {changed:false,deferred:true};';
 for(const name of ['pullAtlasSharedPropertyGraphFromCentral','hydrateSharedPropertiesFromMarketingDatabase'])insert(name,guard);
 for(const [name,line] of [['pullAtlasSharedPropertyGraphFromCentral','    const document = await window.ATLAS_CENTRAL.readSharedPropertyGraph();'],['hydrateSharedPropertiesFromMarketingDatabase','    const rows = await fetchMarketingMccTable("properties", query);']])replace(name,line,line+after);
 insert('applySharedPropertyGraphToPortfolio','  if(window.AtlasReplayWriteFence)return false;');
 insert('refreshAtlasSharedRealtime','  if(window.AtlasReplayWriteFence)return atlasSharedRealtimeState;');
 insert('runAtlasInitialRenderPass','  if(window.AtlasReplayWriteFence)return;');
 insert('scheduleAtlasSharedRender','  if(window.AtlasReplayWriteFence)return;\n  const replayGeneration=Number(window.AtlasReplayGeneration||0);');
 replace('scheduleAtlasSharedRender','    const refreshWorkspace = atlasSharedRenderNeedsWorkspace;','    if(window.AtlasReplayWriteFence||replayGeneration!==Number(window.AtlasReplayGeneration||0)){atlasSharedRenderNeedsWorkspace=false;return;}\n    const refreshWorkspace = atlasSharedRenderNeedsWorkspace;');
 const queueGuard=fn(current,'queueAtlasStateWrite').split('\n').find(line=>line.includes('try {replayFenceAtQueue?.assert(replay);'));if(!queueGuard)throw Error('Current synchronous replay queue guard missing');
 replace('queueAtlasStateWrite','  const replayFenceAtQueue=window.AtlasReplayWriteFence;','  const replayFenceAtQueue=window.AtlasReplayWriteFence;\n'+queueGuard);
 insert('persistSaved','  if(window.AtlasReplayWriteFence)return {ok:false,pending:false,completion:Promise.resolve(false),message:"Saving is paused during source replay or checkpoint recovery."};');
 insert('persistDataImport2State','  if(window.AtlasReplayWriteFence)return false;');
 const renderGuard=fn(archiveUi,'renderDataImport2Tab').split('\n')[1];if(!renderGuard.includes('AtlasReplayWriteFence'))throw Error('Current replay render guard missing');insert('renderDataImport2Tab',renderGuard);
 replace('renderDataImportArchiveView','>Reconcile approved source</button>','>Reconcile approved source</button><button class="btn btn-gray btn-sm" onclick=\'inspectDataImportReplayReceipt(${JSON.stringify(entry.id)})\'>Inspect replay receipt</button>');
 const receipt='        const replayReceipt=replay.publicationReceipt?.();\n        if(replayReceipt){const receiptRequest=store.get(replay.receiptKey);receiptRequest.onsuccess=()=>{try{replay.assertCurrent();if(receiptRequest.result)throw new Error("A replay receipt already exists for this checkpoint.");store.put({key:replay.receiptKey,value:replayReceipt,updatedAt:replayReceipt.publishedAt});}catch(error){failure=error;store.transaction.abort();}};}\n';
 replace('persistDataImportPublication','        if(replay.sourceKey){',receipt+'        if(replay.sourceKey){');
 // Metadata and receipt factories are copied through the existing exact helper boundary.
 if(undo.length!==REPLAY_REFRESH_BOUNDARY_COUNT)throw Error('Replay refresh boundary count requires review: '+undo.length);
 let proof=source;for(const [name,after,before] of undo.reverse()){const body=name?fn(proof,name):proof;if(body.split(after).length!==2)throw Error('Ambiguous replay refresh reverse proof: '+name);proof=name?proof.replace(body,body.replace(after,before)):proof.replace(after,before);}if(proof!==original)throw Error('Replay refresh patch changed unrelated bytes');return source;
}
