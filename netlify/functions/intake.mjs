import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';

const EXPIRY_DAYS = 30;
const STAFF_CODES = ['1208', '6040'];

function makeId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = randomBytes(8);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const STAGES = ['tenant_to_sign', 'landlord_to_sign', 'complete'];
const cleanStage = (s) => (STAGES.includes(s) ? s : '');
const last4 = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : ''; };

async function allIntakes(store) {
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    try {
      const entry = await store.getWithMetadata(b.key, { type: 'json' });
      if (!entry || entry.data == null) continue;
      const expiresAt = entry.metadata && entry.metadata.expiresAt;
      if (expiresAt && Date.now() > expiresAt) { try { await store.delete(b.key); } catch (e) {} continue; }
      out.push({ id: b.key, ...entry.data });
    } catch (e) { /* skip bad record */ }
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  const store = getStore({ name: 'intakes', consistency: 'strong' });

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }

    if (body.action === 'create') {
      const name = String(body.name || '').trim().slice(0, 120);
      const pin = last4(body.phone);
      if (!name) return json({ error: 'name is required' }, 400);
      if (!pin) return json({ error: 'a cell number with at least 4 digits is required' }, 400);
      const record = {
        name,
        nameKey: norm(name),
        pin,
        phone: String(body.phone || '').trim().slice(0, 40),
        email: String(body.email || '').trim().slice(0, 160),
        unitInterest: String(body.unitInterest || '').trim().slice(0, 200),
        note: String(body.note || '').trim().slice(0, 500),
        status: 'pending',
        leaseId: '',
        createdAt: Date.now(),
      };
      const id = makeId();
      await store.setJSON(id, record, { metadata: { expiresAt: Date.now() + EXPIRY_DAYS * 86400000 } });
      return json({ id });
    }

    if (body.action === 'register') {
      if (!STAFF_CODES.includes(String(body.key || ''))) return json({ error: 'unauthorized' }, 401);
      const name = String(body.name || '').trim().slice(0, 120);
      const pin = last4(body.phone);
      const leaseId = String(body.leaseId || '').trim();
      if (!name || !pin || !leaseId) return json({ error: 'name, phone, and leaseId required' }, 400);
      // replace any older record for the same name+pin so the newest lease wins
      const existing = await allIntakes(store);
      for (const r of existing) {
        if (r.nameKey === norm(name) && r.pin === pin) { try { await store.delete(r.id); } catch (e) {} }
      }
      const id = makeId();
      await store.setJSON(id, { name, nameKey: norm(name), pin,
        phone: String(body.phone || '').trim().slice(0, 40), email: String(body.email || '').trim().slice(0, 160),
        unitInterest: '', note: '', status: 'ready', leaseId, createdAt: Date.now(), readyAt: Date.now(),
        stage: cleanStage(body.stage) || 'tenant_to_sign', property: String(body.property || '').slice(0, 200) },
        { metadata: { expiresAt: Date.now() + EXPIRY_DAYS * 86400000 } });
      return json({ id });
    }

    if (body.action === 'advance') {
      // Anyone holding the current lease id may move the pointer forward to a newer signed version
      const from = String(body.fromLeaseId || '').trim();
      const to = String(body.toLeaseId || '').trim();
      if (!from || !to) return json({ error: 'missing ids' }, 400);
      const items = await allIntakes(store);
      const rec = items.find((r) => r.leaseId === from);
      if (!rec) return json({ ok: true, matched: false });
      const entry = await store.getWithMetadata(rec.id, { type: 'json' }).catch(() => null);
      if (!entry || entry.data == null) return json({ ok: true, matched: false });
      await store.setJSON(rec.id, { ...entry.data, leaseId: to, updatedAt: Date.now(), ...(cleanStage(body.stage) ? { stage: cleanStage(body.stage) } : {}) },
        { metadata: { expiresAt: Date.now() + EXPIRY_DAYS * 86400000 } });
      return json({ ok: true, matched: true });
    }

    if (body.action === 'attach' || body.action === 'remove') {
      if (!STAFF_CODES.includes(String(body.key || ''))) return json({ error: 'unauthorized' }, 401);
      const id = String(body.id || '');
      if (!id) return json({ error: 'missing id' }, 400);
      if (body.action === 'remove') { try { await store.delete(id); } catch (e) {} return json({ ok: true }); }
      const entry = await store.getWithMetadata(id, { type: 'json' }).catch(() => null);
      if (!entry || entry.data == null) return json({ error: 'not found' }, 404);
      const record = { ...entry.data, leaseId: String(body.leaseId || '').trim(), status: 'ready', readyAt: Date.now(),
        stage: cleanStage(body.stage) || 'tenant_to_sign', property: String(body.property || entry.data.property || '').slice(0, 200) };
      await store.setJSON(id, record, { metadata: entry.metadata || {} });
      return json({ ok: true });
    }

    return json({ error: 'unknown action' }, 400);
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);

    if (url.searchParams.get('list') === '1') {
      if (!STAFF_CODES.includes(String(url.searchParams.get('key') || ''))) return json({ error: 'unauthorized' }, 401);
      const items = (await allIntakes(store)).map(({ pin, nameKey, ...rest }) => rest);
      return json({ items });
    }

    const name = url.searchParams.get('name');
    const pin = url.searchParams.get('pin');
    if (name && pin) {
      const items = await allIntakes(store);
      const match = items.find((r) => r.nameKey === norm(name) && r.pin === String(pin).trim());
      if (!match) return json({ error: 'not found' }, 404);
      return json({ status: match.status, stage: match.stage || '', leaseId: match.status !== 'pending' ? (match.leaseId || '') : '', name: match.name });
    }

    return json({ error: 'bad request' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/intake' };
