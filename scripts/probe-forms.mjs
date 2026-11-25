// Downloads official court PDFs and lists every fillable field (name, type, page, position, tooltip, options).
import { PDFDocument, PDFName, PDFRadioGroup, PDFDropdown, PDFCheckBox } from 'pdf-lib';
import fs from 'node:fs';
const BASE = 'https://www.coloradojudicial.gov';
const LIST = (process.env.FORMS || '').split(/\s+/).filter(Boolean);
fs.mkdirSync('probe-out', { recursive: true });
for (const item of LIST) {
  const [id, path] = item.split('=');
  try {
    const r = await fetch(BASE + path, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const bytes = new Uint8Array(await r.arrayBuffer());
    fs.writeFileSync('probe-out/' + id + '.pdf', bytes);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = doc.getPages();
    const lines = ['FORM ' + id + ' status=' + r.status + ' pages=' + pages.length];
    let fields = []; try { fields = doc.getForm().getFields(); } catch (e) { lines.push('NO FORM ' + e.message); }
    for (const f of fields) {
      let tu = ''; try { const t = f.acroField.dict.get(PDFName.of('TU')); tu = t ? t.decodeText() : ''; } catch (e) {}
      const ws = f.acroField.getWidgets().map(w => { const rc = w.getRectangle(); let pg = pages.findIndex(p => p.node.Annots() && p.node.Annots().asArray().some(a => String(a) === String(doc.context.getObjectRef(w.dict)))); let on = ''; try { on = w.getOnValue() ? w.getOnValue().decodeText() : ''; } catch (e) {} return (pg + 1) + '@' + Math.round(rc.x) + ',' + Math.round(rc.y) + (on ? '=' + on : ''); }).join(' ');
      let opts = ''; if (f instanceof PDFRadioGroup || f instanceof PDFDropdown) { try { opts = ' opts=' + f.getOptions().join('/'); } catch (e) {} }
      lines.push(f.constructor.name.replace('PDF', '') + ' | ' + f.getName() + ' | ' + ws + ' | ' + tu.replace(/\s+/g, ' ').slice(0, 200) + opts);
    }
    fs.writeFileSync('probe-out/' + id + '.txt', lines.join('\n'));
    console.log(lines.length, id);
  } catch (e) { console.log('FAIL', id, e.message); }
}
