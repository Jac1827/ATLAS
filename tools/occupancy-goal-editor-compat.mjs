// Patch only reviewed advice/history boundaries. The retained editor keeps its
// own authentication, persistence, validation and approved-goal behavior.
export function patchOccupancyGoalEditor(oldEditor,currentEditor){
 let result=oldEditor;
 for(const prefix of ['  const recommendation = ','    const changed=','  const payload={']){
  const before=oldEditor.split('\n').filter(line=>line.startsWith(prefix));
  const after=currentEditor.split('\n').filter(line=>line.startsWith(prefix));
  if(before.length!==1||after.length!==1)throw Error('Reviewed occupancy goal editor boundary changed: '+prefix);
  result=result.replace(before[0],after[0]);
 }
 const marker='/* Scoped occupancy planning hook. This also runs on the retained operational shell. */';
 if(oldEditor.includes(marker)||currentEditor.split(marker).length!==2)throw Error('Reviewed occupancy goal hook boundary changed.');
 const hook=marker+currentEditor.split(marker)[1];
 const importPath=/'\.\/features\/community-goal-planning\.mjs(?:\?v=[a-f0-9]+)?'/g;
 if([...hook.matchAll(importPath)].length!==1)throw Error('Reviewed occupancy planning import boundary changed.');
 return result+'\n'+hook.replace(importPath,value=>value.replace('./features/','../finance/portfolio-operations-dashboard/features/'));
}
