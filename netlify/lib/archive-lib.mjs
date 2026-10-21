import { createHash } from 'node:crypto';

export const ARCHIVE_STORE = 'archive';

export function isComplete(d) {
  return !!(d && d.tenantSignerName && d.landlordSignerName && d.tenantSignedAt && d.landlordSignedAt);
}

export function archiveKey(d) {
  const basis = JSON.stringify([d.tenantName || '', d.propertyAddress || '', d.unitLabel || '', d.tenantSignedAt || 0, d.landlordSignedAt || 0]);
  return createHash('sha256').update(basis).digest('hex').slice(0, 20);
}

// Permanent copy: the signed lease and signatures only. ID photos and pay stubs are not kept.
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

export async function archiveIfComplete(store, d) {
  if (!isComplete(d)) return null;
  const key = archiveKey(d);
  const existing = await store.getMetadata(key).catch(() => null);
  if (existing) return key;
  await store.setJSON(key, stripForArchive(d), { metadata: summaryOf(d) });
  return key;
}
