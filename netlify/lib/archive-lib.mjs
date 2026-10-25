import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

export const ARCHIVE_STORE = 'archive';
export const DELETED_STORE = 'archive-deleted';
// ID photos and pay stubs are kept separately, for 30 days after the lease is fully signed, then deleted.
export const ID_STORE = 'archive-ids';
export const ID_DAYS = 30;
const DAY = 86400000;

export function isComplete(d) {
  return !!(d && d.tenantSignerName && d.landlordSignerName && d.tenantSignedAt && d.landlordSignedAt);
}

export function archiveKey(d) {
  const basis = JSON.stringify([d.tenantName || '', d.propertyAddress || '', d.unitLabel || '', d.tenantSignedAt || 0, d.landlordSignedAt || 0]);
  return createHash('sha256').update(basis).digest('hex').slice(0, 20);
}

// Permanent copy: the signed lease and signatures only. ID photos and pay stubs go to ID_STORE for 30 days.
export function stripForArchive(d) {
  const { tenantIdImage, tenantPayStubImage, ...rest } = d;
  return { ...rest, archivedAt: Date.now() };
}

export function summaryOf(d) {
  return {
    tenant: [d.tenantName, d.tenantName2].filter(Boolean).join(' and '),
    property: (d.propertyAddress || '') + (d.unitLabel ? ', ' + d.unitLabel : ''),
    cityZip: d.cityZip || '',
    entity: d.entity || '',
    termType: d.termType || '',
    startDate: d.startDate || '',
    endDate: d.endDate || '',
    rent: d.rent || '',
    completedAt: Math.max(d.tenantSignedAt || 0, d.landlordSignedAt || 0),
  };
}

export function completedAt(d) { return Math.max(d.tenantSignedAt || 0, d.landlordSignedAt || 0); }

async function keepIdsFor30Days(key, d) {
  if (!d.tenantIdImage && !d.tenantPayStubImage) return;
  const keepUntil = completedAt(d) + ID_DAYS * DAY;
  if (keepUntil < Date.now()) return;
  const ids = getStore({ name: ID_STORE, consistency: 'strong' });
  const have = await ids.getMetadata(key).catch(() => null);
  if (have) return;
  await ids.setJSON(key, { tenantIdImage: d.tenantIdImage || '', tenantPayStubImage: d.tenantPayStubImage || '' }, { metadata: { keepUntil } });
}

export async function purgeExpiredIds() {
  const ids = getStore({ name: ID_STORE, consistency: 'strong' });
  const { blobs } = await ids.list();
  const live = {};
  for (const b of blobs) {
    const m = await ids.getMetadata(b.key).catch(() => null);
    const until = m && m.metadata && m.metadata.keepUntil;
    if (!until || until < Date.now()) await ids.delete(b.key).catch(() => {});
    else live[b.key] = until;
  }
  return live;
}

export async function idsFor(key) {
  const ids = getStore({ name: ID_STORE, consistency: 'strong' });
  const r = await ids.getWithMetadata(key, { type: 'json' }).catch(() => null);
  if (!r) return null;
  const until = r.metadata && r.metadata.keepUntil;
  if (!until || until < Date.now()) { await ids.delete(key).catch(() => {}); return null; }
  return { ...r.data, idKeepUntil: until };
}

export async function deleteIds(key) { await getStore({ name: ID_STORE, consistency: 'strong' }).delete(key).catch(() => {}); }

export async function archiveIfComplete(store, d) {
  if (!isComplete(d)) return null;
  const key = archiveKey(d);
  // Never bring back a lease the landlord deleted from the archive
  const deleted = await getStore({ name: DELETED_STORE, consistency: 'strong' }).getMetadata(key).catch(() => null);
  if (deleted) return null;
  await keepIdsFor30Days(key, d).catch(() => {});
  const existing = await store.getMetadata(key).catch(() => null);
  if (existing) return key;
  await store.setJSON(key, stripForArchive(d), { metadata: summaryOf(d) });
  return key;
}

export async function markDeleted(key) {
  await getStore({ name: DELETED_STORE, consistency: 'strong' }).setJSON(key, { deletedAt: Date.now() }, { metadata: { deletedAt: Date.now() } });
}
