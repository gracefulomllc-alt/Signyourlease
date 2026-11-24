import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';

// Rent / buy inquiries from the website's property map.
// POST (public): save one inquiry. GET ?key: list (staff). POST {key, action:'delete'|'done', id}: staff.
const STAFF_CODES = ['1208', '6040'];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  const store = getStore({ name: 'inquiries', consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (!STAFF_CODES.includes(String(url.searchParams.get('key') || ''))) return json({ error: 'unauthorized' }, 401);
    const { blobs } = await store.list();
    const items = [];
    for (const b of blobs) { const d = await store.get(b.key, { type: 'json' }).catch(() => null); if (d) items.push(d); }
    items.sort((a, b) => (b.at || 0) - (a.at || 0));
    return json({ items });
  }

  if (req.method === 'POST') {
    const text = await req.text();
    if (!text || text.length > 8000) return json({ error: 'too large' }, 413);
    let b; try { b = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400); }

    if (b.action === 'delete' || b.action === 'done') {
      if (!STAFF_CODES.includes(String(b.key || ''))) return json({ error: 'unauthorized' }, 401);
      const id = str(b.id, 40);
      if (b.action === 'delete') { await store.delete(id).catch(() => {}); return json({ ok: true }); }
      const d = await store.get(id, { type: 'json' }).catch(() => null);
      if (d) { d.done = !d.done; await store.setJSON(id, d); }
      return json({ ok: true });
    }

    // public inquiry
    if (b.website) return json({ ok: true }); // honeypot: bots fill hidden fields
    const d = {
      id: 'q' + randomBytes(8).toString('hex'), at: Date.now(), done: false,
      interest: /buy/i.test(b.interest) ? 'buy' : 'rent',
      name: str(b.name, 120), phone: str(b.phone, 40), email: str(b.email, 160), message: str(b.message, 2000),
      listingId: str(b.listingId, 40), property: str(b.property, 200),
    };
    if (!d.name || (!d.phone && !d.email)) return json({ error: 'Please give your name and a phone number or email.' }, 400);
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return json({ error: 'That email address doesn\'t look right.' }, 400);
    await store.setJSON(d.id, d);
    return json({ ok: true });
  }
  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/inquiries' };
