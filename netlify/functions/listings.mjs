import { getStore } from '@netlify/blobs';

// Property listings for the public "Our properties" map on the TLDR website.
// GET (no key): properties marked "show on website", with map coordinates.
// GET ?key=...: every property, for the landlord editor. POST {key, items}: save the list.
const STAFF_CODES = ['1208', '6040'];
const INNAGO = 'https://my.innago.com/a/M2P3Rl0S1bT';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });

const P = (id, address, city, zip, extra = {}) => ({ id, address, unit: '', city, state: 'CO', zip, type: 'House', beds: '', baths: '', rent: '', rentNote: '', available: false, availableNote: '', show: true, applyUrl: '', notes: '', ...extra });
const SEED = [
  P('troy411', '411 Troy Ave', 'Pueblo', '81001', { type: 'Studio apartments', beds: 'Studio', baths: '1', rent: '805', rentNote: 'per month, all utilities included', available: true, availableNote: 'Limited space available', applyUrl: INNAGO, notes: 'Renovated studios. Housing vouchers accepted. Storage units available.' }),
  P('e4th2043a', '2043 E 4th St', 'Pueblo', '81001', { unit: 'Unit A', type: 'Duplex unit' }),
  P('e4th2043b', '2043 E 4th St', 'Pueblo', '81001', { unit: 'Unit B', type: 'Duplex unit' }),
  P('e4th2045', '2045 E 4th St', 'Pueblo', '81001'),
  P('catalina312', '312 Catalina Ct', 'Colorado Springs', '80906'),
  P('catalina310', '310 Catalina Ct', 'Colorado Springs', '80906'),
  P('catalina310h', '310 1/2 Catalina Ct', 'Colorado Springs', '80906', { type: 'Cottage' }),
  P('brinn625', '625 Brinn Ct', 'Colorado Springs', '80911'),
  P('willamette2420', '2420 E Willamette Ave', 'Colorado Springs', '80909'),
  P('casden2728', '2728 Casden Cir', 'Colorado Springs', '80909'),
  P('deerfield4258', '4258 Deerfield Hills Rd', 'Colorado Springs', '80916'),
  P('deerfield4166', '4166 Deerfield Hills Rd', 'Colorado Springs', '80916'),
  P('platte544', '544 E Platte Ave', 'Colorado Springs', '80903'),
  P('london4445', '4445 London Ln', 'Colorado Springs', '80916'),
  P('loomis4206', '4206 Loomis Ave', 'Colorado Springs', '80906'),
  P('loomis4208', '4208 Loomis Ave', 'Colorado Springs', '80906'),
  P('loomis4210', '4210 Loomis Ave', 'Colorado Springs', '80906'),
  P('windsor410', '410 Windsor Ln', 'Fountain', '80817'),
  P('windsor412', '412 Windsor Ln', 'Fountain', '80817'),
  P('windsor414', '414 Windsor Ln', 'Fountain', '80817'),
  P('windsor416', '416 Windsor Ln', 'Fountain', '80817'),
];
const CITY_CENTER = { pueblo: [38.2544, -104.6091], 'colorado springs': [38.8339, -104.8214], fountain: [38.6822, -104.7008] };
const FIELDS = ['id', 'address', 'unit', 'city', 'state', 'zip', 'type', 'beds', 'baths', 'rent', 'rentNote', 'available', 'availableNote', 'show', 'applyUrl', 'notes', 'lat', 'lng', 'approx'];
const str = (v, n = 300) => String(v == null ? '' : v).slice(0, n);

function clean(it) {
  const o = {};
  for (const k of FIELDS) o[k] = it[k];
  o.id = /^[a-z0-9]{2,40}$/.test(String(o.id || '')) ? o.id : Math.random().toString(36).slice(2, 12);
  for (const k of ['address', 'unit', 'city', 'state', 'zip', 'type', 'beds', 'baths', 'rent', 'rentNote', 'availableNote']) o[k] = str(o[k], 160);
  o.notes = str(o.notes, 600);
  o.applyUrl = /^(https?:|mailto:|tel:)/i.test(String(o.applyUrl || '')) ? str(o.applyUrl, 400) : '';
  o.available = !!o.available; o.show = o.show !== false;
  o.lat = typeof o.lat === 'number' ? o.lat : null; o.lng = typeof o.lng === 'number' ? o.lng : null; o.approx = !!o.approx;
  return o;
}

async function geocodeOne(it, cache) {
  const q = [it.address.replace(/\b(\d+)\s+1\/2\b/, '$1'), it.city, it.state || 'CO', it.zip].filter(Boolean).join(', ');
  const key = q.toLowerCase();
  if (cache[key]) return cache[key];
  try {
    const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q);
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const m = ((await r.json()).result || {}).addressMatches || [];
      if (m.length) { const c = m[0].coordinates; cache[key] = { lat: c.y, lng: c.x, approx: false }; return cache[key]; }
    }
  } catch (e) {}
  try {
    const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q);
    const r = await fetch(u, { headers: { 'User-Agent': 'LeaseDesk/1.0 (tldrenterprise@gmail.com)' }, signal: AbortSignal.timeout(6000) });
    if (r.ok) { const a = await r.json(); if (a.length) { cache[key] = { lat: +a[0].lat, lng: +a[0].lon, approx: false }; return cache[key]; } }
  } catch (e) {}
  return null;
}

async function withCoords(items, store) {
  const cache = (await store.get('geocache', { type: 'json' }).catch(() => null)) || {};
  let changed = false;
  const todo = items.filter(it => it.lat == null || it.lng == null).slice(0, 25);
  await Promise.all(todo.map(async (it) => {
    const g = await geocodeOne(it, cache);
    if (g) { it.lat = g.lat; it.lng = g.lng; it.approx = false; changed = true; }
  }));
  if (changed) await store.setJSON('geocache', cache).catch(() => {});
  return changed;
}

async function load(store) {
  const saved = await store.get('items', { type: 'json' }).catch(() => null);
  return saved && Array.isArray(saved.items) ? saved.items : SEED.map(clean);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  const store = getStore({ name: 'listings', consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const staff = STAFF_CODES.includes(String(url.searchParams.get('key') || ''));
    const items = await load(store);
    if (await withCoords(items, store)) await store.setJSON('items', { items, updatedAt: Date.now() }).catch(() => {});
    if (staff) return json({ items });
    const pub = items.filter(it => it.show).map(it => {
      const o = { ...it };
      if (o.lat == null) { const c = CITY_CENTER[(o.city || '').toLowerCase()]; if (c) { o.lat = c[0]; o.lng = c[1]; o.approx = true; } }
      return o;
    });
    return json({ items: pub, contact: { email: 'tldrenterprise@gmail.com', phone: '(719) 359-7502' } }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!STAFF_CODES.includes(String(body.key || ''))) return json({ error: 'unauthorized' }, 401);
    if (!Array.isArray(body.items) || body.items.length > 200) return json({ error: 'bad items' }, 400);
    const prev = await load(store);
    const items = body.items.map(clean).map(it => {
      const old = prev.find(p => p.id === it.id);
      // address changed: re-locate the pin
      if (old && (old.address !== it.address || old.city !== it.city || old.zip !== it.zip)) { it.lat = null; it.lng = null; }
      else if (old && it.lat == null) { it.lat = old.lat; it.lng = old.lng; }
      return it;
    });
    await withCoords(items, store);
    await store.setJSON('items', { items, updatedAt: Date.now() });
    return json({ ok: true, items });
  }
  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/listings' };
