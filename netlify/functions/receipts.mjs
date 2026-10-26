import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { fixFields } from '../lib/rename.mjs';

// Saved payment receipts. Staff only. Kept until deleted.
const STAFF_CODES = ['1208', '6040'];
const MAX_BYTES = 1024 * 1024;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Same receipt saved twice (e.g. reopened from an emailed link) gets the same id.
function receiptId(d) {
  // Address is hashed in its pre-rename form so a receipt keeps the same id after Troy Ave -> Thunderwolf Dr.
  const addr = String(d.propertyAddress || '').replace(/Thunderwolf Dr/gi, 'Troy Ave');
  const core = JSON.stringify([d.tenantName, addr, d.dateReceived, d.method, (d.items || []).map(i => [i.label, i.amount]), d.partial || null, d.receivedBy, d.landlordSignedAt || 0, d.tenantSignedAt || 0]);
  return 'r' + createHash('sha256').update(core).digest('hex').slice(0, 20);
}
function summary(d, id) {
  const total = (d.items || []).reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
  return { id, tenant: String(d.tenantName || '').slice(0, 120), property: String(d.propertyAddress || '').slice(0, 160), dateReceived: d.dateReceived || '',
    total: Math.round(total * 100) / 100, method: String(d.method || '').slice(0, 60), items: (d.items || []).map(i => String(i.label || '')).join(', ').slice(0, 200),
    balance: d.partial ? (parseFloat(d.partial.balance) || 0) : 0, savedAt: Date.now() };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  const store = getStore({ name: 'receipts', consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (!STAFF_CODES.includes(String(url.searchParams.get('key') || ''))) return json({ error: 'unauthorized' }, 401);
    const id = url.searchParams.get('id');
    if (id) {
      const d = await store.get(id, { type: 'json' }).catch(() => null);
      if (d && fixFields(d, ['propertyAddress'])) { const m0 = await store.getMetadata(id).catch(() => null); await store.setJSON(id, d, { metadata: { ...summary(d, id), savedAt: (m0 && m0.metadata && m0.metadata.savedAt) || Date.now() } }).catch(() => {}); }
      return d ? json(d) : json({ error: 'not found' }, 404);
    }
    const { blobs } = await store.list();
    const items = [];
    for (const b of blobs) {
      const m = await store.getMetadata(b.key).catch(() => null);
      if (m && m.metadata && m.metadata.id) {
        if (fixFields(m.metadata, ['property'])) {
          const d = await store.get(b.key, { type: 'json' }).catch(() => null);
          if (d) { fixFields(d, ['propertyAddress']); const meta = { ...summary(d, m.metadata.id), savedAt: m.metadata.savedAt }; await store.setJSON(b.key, d, { metadata: meta }).catch(() => {}); items.push(meta); continue; }
        }
        items.push(m.metadata);
      }
    }
    items.sort((a, b) => (b.dateReceived || '').localeCompare(a.dateReceived || '') || (b.savedAt || 0) - (a.savedAt || 0));
    return json({ items });
  }

  if (req.method === 'POST') {
    const text = await req.text();
    if (!text || text.length > MAX_BYTES) return json({ error: 'empty or too large' }, 413);
    let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!STAFF_CODES.includes(String(body.key || ''))) return json({ error: 'unauthorized' }, 401);
    if (body.action === 'save') {
      const d = body.receipt;
      if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return json({ error: 'bad receipt' }, 400);
      fixFields(d, ['propertyAddress']);
      const id = receiptId(d);
      const existing = await store.getMetadata(id).catch(() => null);
      const meta = summary(d, id);
      if (existing && existing.metadata && existing.metadata.savedAt) meta.savedAt = existing.metadata.savedAt;
      await store.setJSON(id, { ...d, _id: id }, { metadata: meta });
      return json({ ok: true, id, existed: !!existing });
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

export const config = { path: '/api/receipts' };
