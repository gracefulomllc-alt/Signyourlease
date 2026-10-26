import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';
import { fixFields } from '../lib/rename.mjs';

// Tenant files for the eviction toolkit: notices, service logs, late-payment history.
// Staff only. Kept until deleted.
const STAFF_CODES = ['1208', '6040'];
const MAX_BYTES = 512 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function makeId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (const b of randomBytes(10)) out += alphabet[b % alphabet.length];
  return out;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  const store = getStore({ name: 'cases', consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (!STAFF_CODES.includes(String(url.searchParams.get('key') || ''))) return json({ error: 'unauthorized' }, 401);
    const id = url.searchParams.get('id');
    if (id) {
      const c = await store.get(id, { type: 'json' }).catch(() => null);
      if (c && fixFields(c, ['propertyLine', 'notes'])) await store.setJSON(id, c).catch(() => {});
      return c ? json(c) : json({ error: 'not found' }, 404);
    }
    const { blobs } = await store.list();
    const items = [];
    for (const b of blobs) {
      const c = await store.get(b.key, { type: 'json' }).catch(() => null);
      if (c && fixFields(c, ['propertyLine', 'notes'])) await store.setJSON(b.key, c).catch(() => {});
      if (c) items.push(c);
    }
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return json({ items });
  }

  if (req.method === 'POST') {
    const text = await req.text();
    if (!text || text.length > MAX_BYTES) return json({ error: 'empty or too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!STAFF_CODES.includes(String(body.key || ''))) return json({ error: 'unauthorized' }, 401);

    if (body.action === 'save') {
      const c = body.case;
      if (!c || typeof c !== 'object' || !String(c.tenantName || '').trim()) return json({ error: 'tenant name required' }, 400);
      const id = c.id && /^[a-z0-9]{6,24}$/.test(c.id) ? c.id : makeId();
      const saved = { ...c, id, updatedAt: Date.now(), createdAt: c.createdAt || Date.now() };
      await store.setJSON(id, saved);
      return json({ ok: true, case: saved });
    }
    if (body.action === 'delete') {
      if (!body.id) return json({ error: 'missing id' }, 400);
      await store.delete(String(body.id)).catch(() => {});
      return json({ ok: true });
    }
    return json({ error: 'unknown action' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/cases' };
