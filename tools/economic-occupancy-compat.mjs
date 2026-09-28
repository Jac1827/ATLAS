/** Forward only the shared closed-economic read and presentation boundaries. */
export const ECONOMIC_FUNCTIONS=['getAtlasClosedFinancialVersion','refreshAtlasClosedFinancials','getCommunityCommandEconomicOccupancyData','communityCommandMetricValue','renderCommunityCommandKpi','renderCommunityCommandHealthSnapshot','buildCommunityCommandAlerts','addCommunityCommandDashboardOverride','communityCommandBonusGoalResult'];
function fn(source,name){const matches=[...source.matchAll(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','gm'))];if(matches.length!==1)throw Error('Economic occupancy function boundary changed: '+name);return matches[0][0];}
export function patchEconomicOccupancyBoundary(source,current){
 const original=source,undo=[];
 const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('Economic occupancy anchor changed');source=source.replace(before,after);undo.push([after,before]);};
 // The retained host does not have the newer bounded financial read queue.
 const begin='let atlasFinanceRequestController = null;',end='function getAtlasClosedFinancialVersion(';
 if(current.split(begin).length!==2||current.split(end).length!==2||source.includes(begin))throw Error('Economic occupancy queue boundary changed');
 const helpers=current.slice(current.indexOf(begin),current.indexOf(end));
 replace(fn(source,'getAtlasClosedFinancialVersion'),helpers+fn(source,'getAtlasClosedFinancialVersion'));
 for(const name of ECONOMIC_FUNCTIONS)replace(fn(source,name),fn(current,name));
 const periodHelpers=['shiftAccountingPeriod','priorAccountingPeriods','resolveCommunityCommandCloseScope','communityCommandEconomicOccupancyLabel'].map(name=>fn(current,name)).join('\n\n')+'\n\n';
 if(source.includes('function resolveCommunityCommandCloseScope('))throw Error('Economic occupancy scope already composed');
 replace(fn(source,'getCommunityCommandEconomicOccupancyData'),periodHelpers+fn(source,'getCommunityCommandEconomicOccupancyData'));
 const rosterBefore=fn(source,'renderPortfolioScopedCommunityCommandTab');
 let roster=rosterBefore;
 const currentRoster=fn(current,'renderPortfolioScopedCommunityCommandTab');
 const cell=currentRoster.split('\n').find(line=>line.includes('data-closed-economic-state='));
 if(!cell)throw Error('Economic occupancy roster cell missing');
 const leased='        <td>${communityCommandFormatPct(model.leasedPct)}</td>';
 if(roster.split(leased).length!==2)throw Error('Economic occupancy roster boundary changed');
 roster=roster.replace(leased,leased+'\n'+cell).replace('<th>Leased</th><th>Budget</th>','<th>Leased</th><th>Closed economic occupancy</th><th>Budget</th>').replace('colspan="12"','colspan="13"');
 replace(rosterBefore,roster);
 const importBefore='    const periodEntries = getWritableMonthlyPeriodEntries(record, period.monthIdx, period.year);\n    [periodEntries?.historyEntry, periodEntries?.liveEntry].filter(Boolean).forEach(month => {\n      month.economicOccupancyPct = getCommunityCommandEconomicOccupancyData(record, period.monthIdx, period.year).mtdPct;\n    });';
 const importAfter='    // Economic occupancy is read from the governed close cache at presentation\n    // time. An operating import cannot store a prior close under this month.';
 if(!fn(current,'dataImportApplyGroupedSnapshot').includes(importAfter))throw Error('Economic occupancy import boundary changed');
 replace(importBefore,importAfter);
 let proof=source;for(const [after,before] of undo.reverse()){if(proof.split(after).length!==2)throw Error('Economic occupancy reverse boundary changed');proof=proof.replace(after,before);}if(proof!==original)throw Error('Economic occupancy patch changed unrelated operational bytes');
 return source;
}
