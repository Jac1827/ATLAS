/** Add only the reviewed evidence, reporting-period, and replay boundaries. */
function functionRange(source,name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`,'m'));
  if(!match)throw new Error(`Retained occupancy boundary function missing: ${name}`);
  if(source.indexOf(match[0])!==source.lastIndexOf(match[0]))throw new Error(`Duplicate occupancy boundary function: ${name}`);
  return {start:match.index,text:match[0]};
}
function block(source,start,end) {
  if(source.split(start).length!==2||source.split(end).length!==2)throw new Error('Current occupancy boundary anchors are missing or ambiguous.');
  const begin=source.indexOf(start),finish=source.indexOf(end,begin)+end.length;
  if(finish<=begin)throw new Error('Current occupancy boundary order changed.');
  return source.slice(begin,finish);
}
function changes(currentCore,currentImportWorkspace) {
  const read=functionRange(currentCore,'dataImportReadStructuredRows').text;
  const route=functionRange(currentCore,'dataImportRouteStructuredFile').text;
  const reader=(start,end)=>({name:'dataImportReadStructuredRows',before:start+'\n'+end,after:block(read,start,end)});
  const router=(start,end)=>({name:'dataImportRouteStructuredFile',before:start+'\n'+end,after:block(route,start,end)});
  const period=functionRange(currentCore,'dataImportRowPeriod').text;
  const oldTypes='["box_score", "trending_occupancy", "delinquency", "leasing_resident_data"].includes(entry.reportType)';
  const newTypes='["box_score", "trending_occupancy", "delinquency", "leasing_resident_data", "rent_roll"].includes(entry.reportType)';
  const allowlist=(source,name)=>{
    const reviewed=functionRange(source,name).text;
    if(reviewed.split(newTypes).length!==2||reviewed.includes(oldTypes))throw new Error(`Current rent roll replay boundary changed: ${name}`);
    return {name,before:oldTypes,after:newTypes};
  };
  const edits=[
    reader('  const sheets = [];','  (workbook.SheetNames || []).forEach(sheetName => {'),
    reader('    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: true });','    if (plan.reportType === "renewal_tracker" && window.atlasCsPreviewRenewalSheetRows) {'),
    router('  const grouped = new Map();','  for (const sheet of sheets) {'),
    router('        originalValues: sourceRow.values,','        leadSourceEvidence: sourceRow.leadComponents || [],'),
    router('      if (["held", "older", "duplicate"].includes(upsert.disposition)) continue;','      result.communities.add(communityName);'),
    {name:'dataImportRowPeriod',before:'function dataImportRowPeriod(mapped = {}, sourceRow = {}, plan = {}) {\n  const sectionDate = sourceRow.period?.start || sourceRow.period?.asOf;',after:block(period,'function dataImportRowPeriod(mapped = {}, sourceRow = {}, plan = {}) {','  const sectionDate = sourceRow.period?.start || sourceRow.period?.asOf;')},
    router('      const period = dataImportRowPeriod(mapped, sourceRow, plan);','      if (plan.reportType === "renewal_tracker" && !period.periodKey) {'),
    allowlist(currentCore,'reprocessDataImportBoxScore'),
    allowlist(currentImportWorkspace,'renderDataImportArchiveView')
  ];
  if(edits.some(edit=>edit.before===edit.after))throw new Error('Current occupancy evidence boundary is incomplete.');
  if(!edits[0].after.includes('parseOccupancySheet')||!edits[1].after.includes('raw:true')||!edits[3].after.includes('occupancyEvidence:'))throw new Error('Current occupancy evidence boundary no longer matches the reviewed aggregate contract.');
  if(!edits[5].after.includes('return {monthIdx:null, year:null, periodKey:""};')||!edits[6].after.includes('Rent roll reporting period is missing'))throw new Error('Current rent roll period boundary is incomplete.');
  return edits;
}
function apply(source,edit,reverse=false) {
  const range=functionRange(source,edit.name),before=reverse?edit.after:edit.before,after=reverse?edit.before:edit.after;
  if(range.text.split(before).length!==2)throw new Error(`Retained occupancy boundary anchor changed: ${edit.name}`);
  return source.slice(0,range.start)+range.text.replace(before,after)+source.slice(range.start+range.text.length);
}
export function patchOccupancyImportBoundary(oldIndex,currentCore,currentImportWorkspace) {
  const edits=changes(currentCore,currentImportWorkspace);let patched=oldIndex;
  for(const edit of edits)patched=apply(patched,edit);
  let proof=patched;for(const edit of [...edits].reverse())proof=apply(proof,edit,true);
  if(proof!==oldIndex)throw new Error('Occupancy boundary patch changed operational bytes outside the allowlist.');
  return patched;
}
