/* Resolve in-cell images from retained OOXML. A cached #VALUE! alone is never
 * sufficient evidence. This module does not evaluate formulas or alter cells. */
const decode = value => String(value ?? '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attrs = text => Object.fromEntries([...String(text).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], decode(m[2] ?? m[3])]));
const elements = (xml, name) => [...String(xml).matchAll(new RegExp('<(?:[\\w.-]+:)?'+name+'\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+name+'\\s*>)','g'))].map(m => ({attributes:attrs(m[1]), body:m[2] || '', xml:m[0]}));
const one = (xml, name) => { const found=elements(xml,name); return found.length===1?found[0]:null; };
const index = value => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) ? Number(value) : -1;
const bytes = entry => { const raw=entry?.content ?? entry?.data ?? entry; return raw instanceof Uint8Array?raw:raw instanceof ArrayBuffer?new Uint8Array(raw):typeof raw==='string'?new TextEncoder().encode(raw):null; };
const targetPart = (base,target) => {
  if(!target||/[\\?#]|^[a-z][\w+.-]*:/i.test(target))return null;
  const path=[];for(const segment of (target.startsWith('/')?target.slice(1):base.slice(0,base.lastIndexOf('/')+1)+target).split('/')){if(segment==='..'){if(!path.length)return null;path.pop();}else if(segment&&segment!=='.')path.push(segment);}return path.join('/');
};
const imageFormat = data => data?.length>=8 && [137,80,78,71,13,10,26,10].every((v,i)=>data[i]===v)?'png':data?.length>=4&&data[0]===255&&data[1]===216&&data[2]===255?'jpeg':null;

export function verifiedWorkbookLocalImages(workbook, hashBytes) {
  const files=new Map(Object.entries(workbook.files || {}).map(([path,value])=>[path.replace(/^\//,''),bytes(value)]));
  const text=path=>{const data=files.get(path);return data?new TextDecoder().decode(data):'';};
  const result=new Map(),metadata=text('xl/metadata.xml'),types=elements(one(metadata,'metadataTypes')?.body,'metadataType'),values=elements(one(metadata,'valueMetadata')?.body,'bk');
  const future=elements(metadata,'futureMetadata').filter(item=>item.attributes.name==='XLRICHVALUE');
  const richPath='xl/richData/rdrichvalue.xml',structurePath='xl/richData/rdrichvaluestructure.xml',valueRelPath='xl/richData/richValueRel.xml',imageRelPath='xl/richData/_rels/richValueRel.xml.rels';
  const rich=elements(one(text(richPath),'rvData')?.body,'rv'),structures=elements(one(text(structurePath),'rvStructures')?.body,'s'),valueRels=elements(one(text(valueRelPath),'richValueRels')?.body,'rel');
  const imageRels=elements(text(imageRelPath),'Relationship'),sheetRels=elements(text('xl/_rels/workbook.xml.rels'),'Relationship');
  if(future.length!==1)return result;
  for(const sheet of elements(text('xl/workbook.xml'),'sheet')){
    const relation=sheetRels.filter(item=>item.attributes.Id===sheet.attributes['r:id']);
    if(relation.length!==1||relation[0].attributes.TargetMode==='External')continue;
    const sheetPath=targetPart('xl/workbook.xml',relation[0].attributes.Target),sheetXml=text(sheetPath);
    for(const cell of elements(sheetXml,'c')){
      const address=cell.attributes.r,source=workbook.Sheets?.[sheet.attributes.name]?.[address];
      // A formula error, a different Excel error, or mismatched parsed value is
      // never reclassified by merely attaching image metadata.
      if(!source||source.f||source.t!=='e'||!([15,'#VALUE!'].includes(source.v))||cell.attributes.t!=='e'||elements(cell.body,'f').length||one(cell.body,'v')?.body.trim()!=='#VALUE!')continue;
      const vm=index(cell.attributes.vm),block=values[vm-1],record=one(block?.body,'rc');
      if(vm<1||!record||types[index(record.attributes.t)-1]?.attributes.name!=='XLRICHVALUE')continue;
      const futureBlock=elements(future[0].body,'bk')[index(record.attributes.v)],reference=one(futureBlock?.body,'rvb');
      const richIndex=index(reference?.attributes.i),richValue=rich[richIndex],structureIndex=index(richValue?.attributes.s),structure=structures[structureIndex];
      if(!richValue||structure?.attributes.t!=='_localImage')continue;
      const keys=elements(structure.body,'k'),fields=elements(richValue.body,'v'),imageKeys=keys.map((key,i)=>({...key,index:i})).filter(key=>key.attributes.n==='_rvRel:LocalImageIdentifier'&&key.attributes.t==='i');
      if(keys.length!==fields.length||imageKeys.length!==1)continue;
      const imageIndex=index(fields[imageKeys[0].index]?.body.trim()),valueRel=valueRels[imageIndex],id=valueRel?.attributes['r:id'];
      const matched=imageRels.filter(item=>item.attributes.Id===id);
      if(!id||matched.length!==1||matched[0].attributes.TargetMode==='External'||!/^https?:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image$/.test(matched[0].attributes.Type || ''))continue;
      const mediaPart=targetPart(valueRelPath,matched[0].attributes.Target),mediaBytes=files.get(mediaPart),format=imageFormat(mediaBytes);
      if(!mediaPart?.startsWith('xl/media/')||!format)continue;
      const evidencePaths=['xl/workbook.xml','xl/_rels/workbook.xml.rels',sheetPath,'xl/metadata.xml',richPath,structurePath,valueRelPath,imageRelPath];
      const evidence={kind:'verified_ooxml_local_image',sheet:sheet.attributes.name,address,sourcePart:sheetPath,sourceCellXml:cell.xml,valueMetadataIndex:vm,richValueIndex:richIndex,structureIndex,imageRelationshipIndex:imageIndex,imageRelationshipId:id,mediaPart,mediaFormat:format,mediaByteLength:mediaBytes.length,mediaSha256:hashBytes(mediaBytes),relationshipEvidence:evidencePaths.map(part=>({part,sha256:hashBytes(files.get(part))}))};
      const key=sheet.attributes.name+'!'+address;
      // Duplicate source coordinates are ambiguous, even if both point to media.
      if(elements(sheetXml,'c').filter(item=>item.attributes.r===address).length===1)result.set(key,evidence);
    }
  }
  return result;
}
