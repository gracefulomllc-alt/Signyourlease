import { getStore } from '@netlify/blobs';
import { PDFDocument, PDFName, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, StandardFonts } from 'pdf-lib';

// Official Colorado eviction court forms, always pulled from the court's own form pages
// so the newest revision is used, then pre-filled from the tenant file. Staff only.
const STAFF_CODES = ['1208', '6040'];
const BASE = 'https://www.coloradojudicial.gov';
const PAGES = {
  JDF98: 'affidavit-service',
  JDF99A: 'demand-compliance-residential-eviction',
  JDF99B: 'notice-terminate-tenancy-residential-eviction',
  JDF99C: 'notice-no-fault-eviction',
  JDF101: 'eviction-complaint-residential',
  JDF102: 'eviction-summons-form-1a-and-jdf-186-sc',
  JDF103: 'eviction-answer-residential',
  JDF105: 'notice-about-remote-participation',
  JDF106A: 'stipulated-agreement-evictions',
  JDF106B: 'order-re-stipulated-agreement-eviction',
  JDF107A: 'motion-entry-judgment',
  JDF107B: 'judgment-order',
  JDF108: 'request-documents-evictions-jdf-185-sc-and-jdf-187-sc',
  JDF109: 'writ-restitution-eviction',
};
// Last known good links, used only if the form page can't be read.
const FALLBACK = {
  JDF98: '/sites/default/files/2025-04/JDF98.pdf',
  JDF99A: '/sites/default/files/2026-02/JDF99A.pdf',
  JDF99B: '/sites/default/files/2025-05/JDF99B.pdf',
  JDF99C: '/sites/default/files/2025-05/JDF99C.pdf',
  JDF101: '/sites/default/files/2024-12/JDF101.pdf',
  JDF102: '/sites/default/files/2025-08/JDF102.pdf',
  JDF103: '/sites/default/files/2024-11/JDF103.pdf',
  JDF106A: '/sites/default/files/2024-05/JDF106A.pdf',
};
const SPANISH_OK = new Set(['JDF99A', 'JDF99B', 'JDF99C', 'JDF101', 'JDF102', 'JDF103', 'JDF106A']);
const DAY = 86400000;

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; LeaseDesk/1.0)' };

async function currentUrl(form, lang, store) {
  const cacheKey = 'url:' + form + ':' + lang;
  const hit = await store.get(cacheKey, { type: 'json' }).catch(() => null);
  if (hit && Date.now() - hit.at < DAY) return hit.url;
  let url = '';
  try {
    const r = await fetch(BASE + '/self-help-and-forms/self-help-forms/' + PAGES[form], { headers: UA });
    if (r.ok) {
      const html = await r.text();
      const file = form.replace(/^JDF/, 'JDF') + (lang === 'es' ? '.spanish' : '') + '.pdf';
      const re = new RegExp('(?:https://www\\.coloradojudicial\\.gov)?(/sites/default/files/[0-9]{4}-[0-9]{2}/' + file.replace(/\./g, '\\.') + ')', 'gi');
      const found = [...html.matchAll(re)].map(m => m[1]).sort();
      if (found.length) url = BASE + found[found.length - 1];
    }
  } catch (e) {}
  if (!url && lang !== 'es' && FALLBACK[form]) url = BASE + FALLBACK[form];
  if (url) await store.setJSON(cacheKey, { url, at: Date.now() }).catch(() => {});
  return url;
}

async function formBytes(form, lang, store) {
  const url = await currentUrl(form, lang, store);
  if (!url) throw new Error('Could not find ' + form + (lang === 'es' ? ' (Spanish)' : ''));
  const key = 'pdf:' + url.replace(/[^A-Za-z0-9.]/g, '_');
  const cached = await store.get(key, { type: 'arrayBuffer' }).catch(() => null);
  if (cached) return { bytes: new Uint8Array(cached), url };
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('Court site returned ' + r.status + ' for ' + form);
  const bytes = new Uint8Array(await r.arrayBuffer());
  await store.set(key, bytes).catch(() => {});
  return { bytes, url };
}

function tooltip(field) {
  try { const t = field.acroField.dict.get(PDFName.of('TU')); return t ? t.decodeText() : ''; } catch (e) { return ''; }
}

async function probe(form, lang, store) {
  const { bytes, url } = await formBytes(form, lang, store);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages(); const refs = pages.map(p => p.ref);
  const lines = ['FORM ' + form + ' ' + url + ' pages=' + pages.length + ' encrypted=' + doc.isEncrypted];
  let fields = [];
  try { fields = doc.getForm().getFields(); } catch (e) { lines.push('NO FORM: ' + e.message); }
  for (const f of fields) {
    const type = f.constructor.name.replace('PDF', '');
    const ws = f.acroField.getWidgets();
    const pos = ws.map(w => {
      const r = w.getRectangle(); const pref = w.P(); let pg = -1;
      if (pref) pg = refs.findIndex(rf => rf === pref || String(rf) === String(pref));
      if (pg < 0) { const wref = doc.context.getObjectRef(w.dict); if (wref) pages.forEach((p, i) => { const an = p.node.Annots(); if (an && an.asArray().some(a => String(a) === String(wref))) pg = i; }); }
      let on = ''; try { on = w.getOnValue() ? w.getOnValue().decodeText() : ''; } catch (e) {}
      return (pg + 1) + '@' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + 'x' + Math.round(r.height) + (on ? '=' + on : '');
    }).join(' ');
    let opts = '';
    if (f instanceof PDFRadioGroup || f instanceof PDFDropdown || f instanceof PDFOptionList) { try { opts = ' opts=' + f.getOptions().join('/'); } catch (e) {} }
    lines.push(type + ' | ' + f.getName() + ' | ' + pos + ' | ' + tooltip(f).replace(/\s+/g, ' ').slice(0, 160) + opts);
  }
  return lines.join('\n');
}

// values: { fieldName: string | true | false }
async function fillOne(form, lang, values, store, font) {
  const { bytes } = await formBytes(form, lang, store);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  let f = null; try { f = doc.getForm(); } catch (e) {}
  const misses = [];
  if (f && values) {
    for (const [name, v] of Object.entries(values)) {
      if (v === '' || v == null || v === false) continue;
      let field; try { field = f.getField(name); } catch (e) { misses.push(name); continue; }
      try {
        if (field instanceof PDFTextField) { field.setText(String(v)); }
        else if (field instanceof PDFCheckBox) { field.check(); }
        else if (field instanceof PDFRadioGroup) { field.select(String(v)); }
        else if (field instanceof PDFDropdown) { field.select(String(v)); }
      } catch (e) { misses.push(name); }
    }
    try { f.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica)); } catch (e) {}
  }
  return { doc, misses };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  const store = getStore({ name: 'courtforms' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (!STAFF_CODES.includes(String(url.searchParams.get('key') || ''))) return json({ error: 'unauthorized' }, 401);
    const lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';
    const p = url.searchParams.get('probe');
    if (p) {
      if (!PAGES[p]) return json({ error: 'unknown form' }, 400);
      try { const txt = await probe(p, lang, store); txt.split('\n').forEach((l, i) => console.log('P' + String(i).padStart(3, '0') + ' ' + l)); return new Response(txt, { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } }); }
      catch (e) { return json({ error: e.message }, 502); }
    }
    // list of forms with their current court link
    const out = [];
    for (const form of Object.keys(PAGES)) out.push({ form, url: await currentUrl(form, 'en', store), spanish: SPANISH_OK.has(form) });
    return json({ items: out });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!STAFF_CODES.includes(String(body.key || ''))) return json({ error: 'unauthorized' }, 401);
    const list = Array.isArray(body.forms) ? body.forms.filter(x => x && PAGES[x.form]).slice(0, 20) : [];
    if (!list.length) return json({ error: 'no forms' }, 400);
    try {
      const out = await PDFDocument.create();
      const misses = {};
      for (const item of list) {
        const lang = item.lang === 'es' ? 'es' : 'en';
        const { doc, misses: m } = await fillOne(item.form, lang, item.values || {}, store);
        if (m.length) misses[item.form] = m;
        try { doc.getForm().flatten(); } catch (e) {}
        const copies = Math.max(1, Math.min(4, parseInt(item.copies, 10) || 1));
        for (let c = 0; c < copies; c++) {
          const pages = await out.copyPages(doc, doc.getPageIndices());
          pages.forEach(pg => out.addPage(pg));
        }
      }
      out.setTitle(body.title || 'Eviction forms');
      const bytes = await out.save();
      return new Response(bytes, { headers: { ...cors, 'Content-Type': 'application/pdf', 'X-Missed-Fields': encodeURIComponent(JSON.stringify(misses)).slice(0, 4000), 'Access-Control-Expose-Headers': 'X-Missed-Fields' } });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/courtforms' };
