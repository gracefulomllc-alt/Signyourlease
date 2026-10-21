import { getStore } from '@netlify/blobs';
import { ARCHIVE_STORE, archiveIfComplete, markDeleted } from '../lib/archive-lib.mjs';

const STAFF_CODES = ['1208', '6040'];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Pick up any fully signed lease still in the 30-day signing store that isn't archived yet
async function backfill(archive) {
  const leases = getStore({ name: 'leases', consistency: 'strong' });
  const { blobs } = await leases.list();
  for (const b of blobs) {
    try {
      const text = await leases.get(b.key, { type: 'text' });
      if (!text) continue;
      await archiveIfComplete(archive, JSON.parse(text));
    } catch (e) { /* skip unreadable */ }
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  const archive = getStore({ name: ARCHIVE_STORE, consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (!STAFF_CODES.includes(String(url.searchParams.get('key') || ''))) return json({ error: 'unauthorized' }, 401);
    const id = url.searchParams.get('id');
    if (id) {
      const d = await archive.get(id, { type: 'json' }).catch(() => null);
      if (!d) return json({ error: 'not found' }, 404);
      return json(d);
    }
    await backfill(archive).catch(() => {});
    const { blobs } = await archive.list();
    const items = [];
    for (const b of blobs) {
      const m = await archive.getMetadata(b.key).catch(() => null);
      if (m) items.push({ id: b.key, ...(m.metadata || {}) });
    }
    items.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    return json({ items });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!STAFF_CODES.includes(String(body.key || ''))) return json({ error: 'unauthorized' }, 401);
    if (body.action === 'delete') {
      if (!body.id) return json({ error: 'missing id' }, 400);
      await markDeleted(String(body.id)).catch(() => {});
      await archive.delete(String(body.id)).catch(() => {});
      return json({ ok: true });
    }
    return json({ error: 'unknown action' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/archive' };
