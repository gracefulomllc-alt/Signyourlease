// Papers Lease Desk writes itself because no statewide court form exists.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const W = 612, H = 792, M = 64;
function wrap(font, text, size, width) {
  const out = [];
  String(text || '').split('\n').forEach(par => {
    const words = par.split(/\s+/); let line = '';
    words.forEach(w => { const t = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t; });
    out.push(line);
  });
  return out;
}
function page(doc, fonts) {
  const p = doc.addPage([W, H]); let y = H - M;
  const api = {
    text(t, o = {}) {
      const f = o.bold ? fonts.b : fonts.r; const size = o.size || 11; const lh = size * 1.4;
      wrap(f, t, size, W - 2 * M - (o.indent || 0)).forEach(l => {
        const x = o.center ? (W - f.widthOfTextAtSize(l, size)) / 2 : M + (o.indent || 0);
        p.drawText(l.replace(/[^\x20-\xFF]/g, ''), { x, y, size, font: f, color: rgb(0, 0, 0) }); y -= lh;
      });
      y -= o.after == null ? 4 : o.after;
    },
    line(label, x2) { p.drawLine({ start: { x: M, y: y + 2 }, end: { x: x2 || W - M, y: y + 2 }, thickness: 0.6 }); p.drawText(label, { x: M, y: y - 10, size: 8, font: fonts.r }); y -= 30; },
    gap(n) { y -= n; },
    box(lines) {
      const top = y + 8; lines.forEach(l => api.text(l, { size: 10, after: 0 })); const bot = y + 4;
      p.drawRectangle({ x: M - 6, y: bot, width: W - 2 * M + 12, height: top - bot, borderWidth: 0.6, borderColor: rgb(0, 0, 0) }); y -= 10;
    },
  };
  return api;
}
function caption(pg, v) {
  pg.box([
    'County Court, ' + (v.county || '________') + ' County, Colorado',
    'Court Address: ' + (v.courtAddress || ''),
    'Plaintiff: ' + (v.plaintiff || ''),
    'v.',
    'Defendant(s): ' + (v.defendants || ''),
    'Case Number: ' + (v.caseNumber || '______________'),
  ]);
}

export async function buildOwn(formId, v) {
  const doc = await PDFDocument.create();
  const fonts = { r: await doc.embedFont(StandardFonts.TimesRoman), b: await doc.embedFont(StandardFonts.TimesRomanBold) };
  if (formId === 'LDREP') {
    // Page 1: affidavit (signed in front of a notary or the clerk)
    let pg = page(doc, fonts); caption(pg, v);
    pg.text('AFFIDAVIT OF REPRESENTATION OF BUSINESS ENTITY', { bold: true, center: true, size: 13, after: 2 });
    pg.text('(C.R.S. 13-1-127)', { center: true, size: 10, after: 12 });
    pg.text('I, ' + v.affiant + ', am the ' + v.affiantTitle + ' of ' + v.entity + '. I am submitting this affidavit to the Court as evidence of the authority of ' + v.rep + ' as the duly designated representative of the above-named business entity in legal proceedings.');
    pg.text('1. The full legal name of the business entity is: ' + v.entity + '.');
    pg.text('2. The entity is the following type of entity: ' + v.entityType + '.');
    pg.text('3. There are ' + v.owners + ' owner(s) of the entity, which is no more than three (3).');
    pg.text('4. I am ' + v.affiantRole + ' of the entity.');
    pg.text('5. Under the entity\'s governing documents, ' + v.rep + (v.repRole ? ' (' + v.repRole + ')' : '') + ' has been designated as the entity\'s representative for purposes of representing the entity in court proceedings involving claims having a value of $15,000.00 or less (exclusive of costs, interest, or statutory penalties). This designation remains in effect until revoked in writing by the entity or until the entity no longer qualifies as a closely held entity under C.R.S. 13-1-127.');
    pg.text('I swear or affirm under penalty of perjury that the information above is true.', { after: 18 });
    pg.line('Signature of Affiant                                                                                        Date', W - M);
    pg.line('Printed name and legal title of Affiant: ' + v.affiant + ', ' + v.affiantTitle, W - M);
    pg.gap(6);
    pg.text('Subscribed and sworn to before me this ______ day of ____________________, 20____, by ' + v.affiant + '.', { size: 10, after: 22 });
    pg.line('Notary Public / Deputy Clerk                                       My commission expires:', W - M);
    pg.text('Sign this in front of a notary or a deputy clerk. Some courts have their own version of this affidavit; if the clerk asks for theirs, use it.', { size: 8.5 });
    // Page 2: the written designation by the owners
    pg = page(doc, fonts);
    pg.text('WRITTEN CONSENT OF THE ' + (v.isLLC ? 'MEMBERS' : 'OWNERS') + ' OF ' + v.entity.toUpperCase(), { bold: true, center: true, size: 13, after: 2 });
    pg.text('Designation of Representative in County Court (C.R.S. 13-1-127)', { center: true, size: 10, after: 14 });
    pg.text('The undersigned, being all of the ' + (v.isLLC ? 'members' : 'owners') + ' of ' + v.entity + ', a ' + v.entityType + ' (the "Company"), consent to and adopt the following:');
    pg.text('RESOLVED, that ' + v.rep + (v.repRole ? ', ' + v.repRole + ' of the Company,' : '') + ' is authorized and designated to represent the Company in County Court in ' + (v.county || '________') + ' County, Colorado, in the eviction (forcible entry and detainer) case against ' + (v.defendants || '________') + ' concerning ' + (v.premises || '________') + ', and in all matters to collect any judgment entered in that case, including signing and filing papers, appearing at hearings and trials, and agreeing to settlements, for claims of $15,000.00 or less exclusive of costs, interest, and statutory penalties.');
    pg.text('This consent stays in effect until revoked in writing.', { after: 20 });
    (v.members && v.members.length ? v.members : ['']).forEach(m => { pg.line('Signature' + (m ? ' of ' + m + ', Member' : ' of Member') + '                                                       Date', W - M); });
    if (v.members && v.members.length < 3) pg.line('Signature of Member (if any)                                                      Date', W - M);
  }
  return doc;
}
