const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>typeof value==='string'&&value.trim().length>0;
const issue=(code,message)=>({code,severity:'blocking',message});

function validateCollections({properties,programmes,lines}){
 if(!Array.isArray(properties)||!Array.isArray(programmes)||!Array.isArray(lines)||properties.some(row=>!record(row)||!identity(row.id))||programmes.some(row=>!record(row)||!identity(row.id)||!identity(row.propertyId))||lines.some(row=>!record(row)))throw Error('The saved source must contain identified properties, STR programmes and retained lines.');
 if(new Set(properties.map(row=>row.id)).size!==properties.length||new Set(programmes.map(row=>row.id)).size!==programmes.length||programmes.some(row=>properties.filter(property=>property.id===row.propertyId).length!==1))throw Error('Each saved property and programme must have a unique identity and one exact property assignment.');
}

/** V2 is a scoped recovery source; its sibling rows and proposed UI drivers
 * remain evidence, not implicit contributions or applied configuration. */
export function validateSavedStrSource(payload){
 if(!record(payload)||![1,2].includes(payload.formatVersion)||!record(payload.state))throw Error('Choose a supported format 1 or 2 Budget Builder save containing properties, lines and STR programmes.');
 const state=payload.state;validateCollections({properties:state.properties,programmes:state.strPrograms,lines:state.lines});return state;
}

export function selectSavedStrSource({properties,programmes,lines,formatVersion},{propertyId,programmeId}){
 validateCollections({properties,programmes,lines});
 if(!identity(propertyId)||!identity(programmeId))throw Error('Explicitly select a property and one of its saved programmes.');
 const property=properties.find(row=>row.id===propertyId),programme=programmes.find(row=>row.id===programmeId&&row.propertyId===propertyId);
 if(!property||!programme)throw Error('Select exactly one saved property and one of its programmes.');
 if(programme.config!=null&&!record(programme.config))throw Error('The selected programme configuration must be a retained object or explicitly missing.');
 const lineEvidence=lines.flatMap((line,index)=>line.propertyId===propertyId&&line.strProgramId===programmeId?[{sourceLineIndex:index,line}]:[]),blockers=[],ids=lineEvidence.map(({line})=>line.id);
 if(ids.some(id=>!identity(id))||new Set(ids).size!==ids.length)blockers.push(issue('saved_str_line_identity','Source programme line identifiers must be nonempty and unique.'));
 const declared=programme.lineIds;
 if(declared!==undefined||formatVersion===2){
  if(!Array.isArray(declared)||declared.some(id=>!identity(id))||new Set(declared).size!==declared.length||declared.length!==ids.length||declared.some(id=>!ids.includes(id)))blockers.push(issue('saved_str_line_mapping','The selected programme line list must match exactly its retained property- and programme-tagged rows. Unrelated source rows cannot fill missing programme lines.'));
 }
 return {property,programme,lineEvidence,blockers};
}
