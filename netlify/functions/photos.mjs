import { getStore } from '@netlify/blobs';

// Listing photos for the public "Our properties" page on the TLDR website.
// GET ?id=<listingId>            -> { photos: ['/api/photos?id=..&n=0', ...] }
// GET ?id=<listingId>&n=<index>  -> the JPEG itself, cacheable
// POST {key, id, photos:[dataUrl]} -> replace the photo set for one listing (staff only)
//
// Photos live in their own blob store so the listings JSON stays small. An
// `index` key maps listingId -> count, which /api/listings reads to attach
// photo URLs to each property without loading the images themselves.
const STAFF_CODES = ['1208', '6040'];
const MAX_PHOTOS = 8;
const MAX_BYTES = 600000; // per photo, after the client compresses it
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
const okId = (v) => /^[a-z0-9]{2,40}$/.test(String(v || ''));

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Accepts a data URL from the client and returns the bare base64 payload.
function cleanPhoto(v) {
  const s = String(v == null ? '' : v);
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(s.trim());
  if (!m) return null;
  if (m[2].length > MAX_BYTES) return null;
  return m[2];
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  const store = getStore({ name: 'listingphotos', consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const id = String(url.searchParams.get('id') || '');
    if (!okId(id)) return json({ error: 'bad id' }, 400);
    const rec = await store.get(id, { type: 'json' }).catch(() => null);
    const photos = (rec && Array.isArray(rec.photos)) ? rec.photos : [];

    const nRaw = url.searchParams.get('n');
    if (nRaw != null) {
      const n = parseInt(nRaw, 10);
      if (!(n >= 0) || n >= photos.length) return new Response('Not found', { status: 404, headers: cors });
      return new Response(b64ToBytes(photos[n]), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' },
      });
    }
    return json({ photos: photos.map((_, n) => `/api/photos?id=${encodeURIComponent(id)}&n=${n}`) }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!STAFF_CODES.includes(String(body.key || ''))) return json({ error: 'unauthorized' }, 401);
    const id = String(body.id || '');
    if (!okId(id)) return json({ error: 'bad id' }, 400);
    if (!Array.isArray(body.photos)) return json({ error: 'bad photos' }, 400);

    const photos = [];
    for (const p of body.photos.slice(0, MAX_PHOTOS)) {
      const c = cleanPhoto(p);
      if (c) photos.push(c);
    }
    if (photos.length !== body.photos.slice(0, MAX_PHOTOS).length) {
      return json({ error: 'one or more photos were too large or not an image' }, 400);
    }

    if (photos.length) await store.setJSON(id, { photos, updatedAt: Date.now() });
    else await store.delete(id).catch(() => {});

    const index = (await store.get('index', { type: 'json' }).catch(() => null)) || {};
    if (photos.length) index[id] = photos.length; else delete index[id];
    await store.setJSON('index', index).catch(() => {});

    return json({ ok: true, count: photos.length });
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/photos' };
