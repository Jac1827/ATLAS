// One canonical representation is shared by the browser, integrity worker and publication tools.
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(item => stableJson(item ?? null)).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
