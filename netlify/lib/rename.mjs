// Oct 2026: Troy Ave in Pueblo was renamed Thunderwolf Dr (same number and ZIP).
const TROY = /\bTroy\s+Ave(?:nue)?\b\.?/gi;
export function fixTroy(s) { return typeof s === 'string' ? s.replace(TROY, 'Thunderwolf Dr') : s; }
export function hasTroy(s) { return typeof s === 'string' && /\bTroy\s+Ave/i.test(s); }
// Apply to the named string fields of an object. Returns true if anything changed.
export function fixFields(obj, fields) {
  let changed = false;
  if (!obj || typeof obj !== 'object') return false;
  for (const f of fields) if (hasTroy(obj[f])) { obj[f] = fixTroy(obj[f]); changed = true; }
  return changed;
}
