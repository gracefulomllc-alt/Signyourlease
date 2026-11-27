// Fills every form with a sample case and saves the results, so field mapping can be checked by eye.
import fs from 'node:fs';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } from 'pdf-lib';
import { fillOne } from '../netlify/functions/courtforms.mjs';
import { valuesFor } from '../netlify/lib/court-mappers.mjs';
const mem = new Map();
const store = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => mem.set(k, v), setJSON: async (k, v) => mem.set(k, v) };
const d = { tenants: ['Jane Sample', 'John Sample'], street: '411 Thunderwolf Dr, Unit 3', city: 'Pueblo', county: 'Pueblo', zip: '81001', rent: '805',
  landlord: 'TLDR Enterprise LLC', signer: 'Leslie French', plaintiffAddress: '2045 E 4th St, Pueblo, CO 81001', plaintiffPhone: '(719) 555-0100', plaintiffEmail: 'tldrenterprise@gmail.com',
  courtAddress: '501 N. Elizabeth St., Pueblo, CO 81003', caseNumber: '2026C001234', returnDate: '12/14/2026 8:30 a.m.', mediationEligible: false, cares: false,
  notice: { kind: 'demand', moveOut: '2026-11-30', served: '2026-11-20', serviceMethod: 'Handed to tenant', posted: false, attempts: [], rentOn: true, rentTotal: '805.00', rentRows: [{ due: '2026-11-01', amount: '805' }] },
  rep: { entityType: 'Colorado limited liability company', owners: '1', members: ['Leslie French'], affiant: 'Leslie French', affiantTitle: 'Member', affiantRole: 'the sole member', name: 'Leslie French', role: 'Member' },
  x: { interpreter: '', attend: 'person', fedMortgage: 'no', military: 'no', mediation: 'not_receive', rentOwed: 1610, rentDates: '11/01/2026, 12/01/2026', lateFees: 50, damages: 0,
    division: 'A', courtroom: '3', returnISO: '2026-12-14', returnTime: '8:30 a.m.', signerTitle: 'Member',
    service: { serverName: 'Pat Server', serverType: 'private', how: 'personal', servedISO: '2026-12-04' },
    judgment: { iso: '2026-12-14', money: true, principal: 1660, interest: 0, costs: 162, total: 1822 },
    cos: { iso: '2026-12-14' },
    debtor: { name: 'Jane Sample', address: '411 Thunderwolf Dr, Unit 3, Pueblo, CO 81001', employer: { name: 'Acme Foods Inc.', address: '100 Main St, Pueblo, CO 81003' }, bank: { name: 'First Pueblo Bank', address: '200 Union Ave, Pueblo, CO 81003' } },
    collect: { judgmentISO: '2026-12-14', judgmentAmount: 1822, rate: 8, interestAmt: 23.97, costs: 85, paid: 0, owing: 1930.97, asOfISO: '2027-01-15' },
    militaryCheck: { result: 'not', dateText: '12/14/2026' },
    cover: { title: 'Filing packet: what to bring to the clerk', sections: [{ h: 'Bring to the courthouse', lines: ['JDF 101 Complaint (signed) + lease + notice', 'JDF 102 Summons: original + 2 copies'] }, { h: 'After filing', lines: ['Write the case number and court date in Lease Desk'] }] } } };
const forms = (process.env.FORMS || 'JDF101 JDF102 JDF98 JDF107A JDF107B JDF109 FORM7 FORM26 FORM27 FORM29 LDREP LDMIL LDCOVER').split(/\s+/);
fs.mkdirSync('probe-out', { recursive: true });
const out = await PDFDocument.create(); const lines = [];
for (const id of forms) {
  try {
    const values = valuesFor(id, d);
    const { doc, misses, srcUrl } = await fillOne(id, 'en', values, store);
    lines.push('== ' + id + ' ' + (srcUrl || 'own') + ' misses=' + JSON.stringify(misses));
    try { for (const fl of doc.getForm().getFields()) { let v = ''; if (fl instanceof PDFTextField) v = fl.getText() || ''; else if (fl instanceof PDFCheckBox) v = fl.isChecked() ? 'X' : ''; else if (fl instanceof PDFRadioGroup) v = fl.getSelected() || ''; else if (fl instanceof PDFDropdown) v = (fl.getSelected() || []).join(','); if (v) lines.push('  ' + fl.getName() + ' = ' + String(v).slice(0, 100)); } } catch (e) {}
    try { doc.getForm().flatten(); } catch (e) { lines.push('  FLATTEN FAILED ' + e.message); }
    const pages = await out.copyPages(doc, doc.getPageIndices()); pages.forEach(p => out.addPage(p));
    lines.push('  pages=' + pages.length);
  } catch (e) { lines.push('== ' + id + ' ERROR ' + e.message); }
}
fs.writeFileSync('probe-out/filled.pdf', await out.save()); fs.writeFileSync('probe-out/filled.txt', lines.join('\n'));
console.log(lines.join('\n'));
