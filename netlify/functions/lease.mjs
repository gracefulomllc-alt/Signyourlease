import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';

const EXPIRY_DAYS = 7;
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB ceiling to keep photos sane

function makeId() {
  // short, url-safe, unambiguous (no 0/O/1/l)
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

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: cors });
  }

  const store = getStore({ name: 'leases', consistency: 'strong' });

  // ---- SAVE ----
  if (req.method === 'POST') {
    let body;
    try {
      body = await req.text();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'unreadable body' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (!body || body.length > MAX_BYTES) {
      return new Response(JSON.stringify({ error: 'payload too large or empty' }), { status: 413, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const id = makeId();
    const expiresAt = Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    try {
      await store.set(id, body, { metadata: { expiresAt } });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'store failed' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ id, expiresAt }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // ---- LOAD ----
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ error: 'missing id' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    let entry;
    try {
      entry = await store.getWithMetadata(id, { type: 'text' });
    } catch (e) {
      entry = null;
    }
    if (!entry || entry.data == null) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const expiresAt = entry.metadata && entry.metadata.expiresAt;
    if (expiresAt && Date.now() > expiresAt) {
      try { await store.delete(id); } catch (e) {}
      return new Response(JSON.stringify({ error: 'expired' }), { status: 410, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    return new Response(entry.data, { status: 200, headers: { ...cors, 'Content-Type': 'text/plain' } });
  }

  return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
};

export const config = { path: '/api/lease' };
