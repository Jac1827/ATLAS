import {createHash} from 'node:crypto';

export const PROPERTY_SPECIALS_CLIENT = 'centralization/atlas-central-client.js';
export const PROPERTY_SPECIALS_UI = ['property-organization.js', 'concession-insights.js'];
export const PROPERTY_SPECIALS_ASSETS = [PROPERTY_SPECIALS_CLIENT, ...PROPERTY_SPECIALS_UI];

// Import exactly this self-contained request method. The retained client's auth,
// configuration, profile loading and every other service method remain its own.
const methodBoundary = /^    async propertySpecials\(action, body = \{\}\) \{\n(?:(?!^    \},)[\s\S])*^    \},(?=\n    async evictionCase\(action, body = \{\}, binary = false\) \{)/gm;
export function patchPropertySpecialsClient(retained, current) {
  for (const source of [retained,current]) if ([...source.matchAll(/^    async propertySpecials\(/gm)].length !== 1) throw Error('The reviewed propertySpecials client method boundary changed.');
  const before = [...retained.matchAll(methodBoundary)], after = [...current.matchAll(methodBoundary)];
  if (before.length !== 1 || after.length !== 1) throw Error('The reviewed propertySpecials client method boundary changed.');
  return retained.replace(methodBoundary, () => after[0][0]);
}

export function patchPropertySpecialsReferences(index, sources) {
  let result = index;
  for (const name of PROPERTY_SPECIALS_ASSETS) {
    if (typeof sources[name] !== 'string') throw Error('Missing reviewed website-special asset: ' + name);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundary = new RegExp('\\./' + escaped + '(?:\\?v=[A-Za-z0-9-]+)?(?=["\'])', 'g');
    // The retained client also has a fallback loader constant in the inline shell.
    const expected = name === PROPERTY_SPECIALS_CLIENT ? 2 : 1;
    if ([...result.matchAll(boundary)].length !== expected) throw Error('The reviewed website-special script reference boundary changed: ' + name);
    const hash = createHash('sha256').update(sources[name]).digest('hex').slice(0, 16);
    result = result.replace(boundary, './' + name + '?v=' + hash);
  }
  return result;
}
