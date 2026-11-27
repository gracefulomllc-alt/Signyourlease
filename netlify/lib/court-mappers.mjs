// ---- what goes in each form. Keys are the court PDF's field names; a value of RegExp selects a radio/dropdown option.
const mdy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[2] + '/' + m[3] + '/' + m[1] : ''; };
const dueList = (n) => (n.rentRows || []).map(r => mdy(r.due)).filter(Boolean).join(', ');
const money = (n) => { const v = parseFloat(n); return isNaN(v) || !v ? '' : '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
function splitAddr(s) {
  // "123 Main St, Pueblo, CO 81003" -> { street, city, state, zip }
  const m = /^(.*?),\s*([^,]+?),\s*([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)\s*$/.exec(s || '');
  return m ? { street: m[1], city: m[2], state: m[3].toUpperCase(), zip: m[4] } : { street: s || '', city: '', state: '', zip: '' };
}
function caption(d) {
  return {
    'Court': /County Court/, 'Court_Type': /County Court/,
    'Court County': d.county, 'Court_County': d.county,
    'Court Address': d.courtAddress, 'Court_Address': d.courtAddress,
    '@plaintiff': d.landlord, '@defendant': d.tenants.join(', ') + (d.tenants.length ? ', and all other occupants' : ''),
    'Case Number': d.caseNumber,
  };
}
function failedAttempts(n) {
  return (n.attempts || []).filter(a => a.result === 'noanswer' || a.result === 'refused').map(a => a.date).filter(Boolean).sort();
}
function servedPersonally(n) { return n && n.served && !n.posted; }
function facts(d) {
  const n = d.notice; if (!n) return '';
  const out = [];
  if (n.rentOn) out.push('Tenant failed to pay rent of ' + money(n.rentTotal) + ' due ' + dueList(n) + '.');
  if (n.violationOn) out.push('Tenant violated this lease term: ' + n.violationTerm + '. ' + n.violationText);
  if (n.conductOn) out.push('Disturbing conduct: ' + n.conductText);
  if (n.repeatOn) out.push('Repeat violation of lease term "' + n.repeatTerm + '" after a Demand for Compliance served ' + mdy(n.repeatPrior) + '. ' + n.repeatText);
  if (n.substantialOn) out.push('Substantial violation: ' + n.substantialText);
  if (n.served) out.push((n.kind === 'terminate' ? 'Notice to Terminate' : 'Demand for Compliance') + ' served ' + mdy(n.served) + ' (' + n.serviceMethod + '); deadline ' + mdy(n.moveOut) + ' at 11:59 p.m. passed and Tenant did not ' + (n.kind === 'terminate' ? 'vacate.' : 'comply or vacate.'));
  return out.join(' ');
}
function serviceBlock(n, servedField, methodField, failedField) {
  if (!n || !n.served) return {};
  const o = { [servedField]: mdy(n.served) };
  if (servedPersonally(n)) o[methodField] = /Personal/i;
  else { o[methodField] = /Posting/i; const f = failedAttempts(n); if (f.length) o[failedField] = f.map(mdy).join(', '); }
  return o;
}
export const MAPPERS = {
  JDF99A: (d) => {
    const n = d.notice || {};
    return {
      '0.0': d.tenants.join(' and '), '0.1': true,
      '0.2': mdy(n.moveOut), '0.3': n.moveOut ? '11:59 p.m.' : '', 'Group4.0': n.moveOut ? /^(PM|p\.? ?m\.?)$/i : '',
      'Group3.0': d.cares ? /CARES/ : /regular residential/i,
      '1A.0': !!n.rentOn, '1A.1': n.rentOn ? money(n.rentTotal) : '', '1A.2': n.rentOn ? dueList(n) : '',
      '1B.0': !!n.violationOn, '1B.1': n.violationTerm, '1B.2': n.violationText,
      '1C.0': !!n.conductOn, '1C.1': n.conductText,
      '4.1': d.street, '4.2': d.city, '4.3': d.county, '4.7': money(d.rent), '4.8': /Month/,
      'Group5.0': /^The Landlord$/,
      ...serviceBlock(n, '7.1', 'Group6.0', '7.2'),
    };
  },
  JDF99B: (d) => {
    const n = d.notice || {};
    const kinds = n.substantialKinds || [];
    const k = kinds.includes('felony') ? /felony/i : kinds.includes('nuisance') ? /180 days/ : kinds.includes('endanger') ? /Endangered/ : '';
    return {
      '0.0': d.tenants.join(' and '), '0.1': true,
      '1.1': mdy(n.moveOut), '1.2': n.moveOut ? '11:59 p.m.' : '', 'Group1.0': n.moveOut ? /^(PM|p\.? ?m\.?)$/i : '',
      'Group2.0': n.substantialOn ? /substantial/i : n.repeatOn ? /repeat/i : '',
      '2B.0': n.substantialOn ? k : '',
      '2C.2': n.repeatOn ? mdy(n.repeatPrior) : '', '2C.1': !!(n.repeatOn && d.assisted),
      '3.0': n.repeatOn ? ('Lease term violated again: ' + n.repeatTerm + '. ' + n.repeatText) : n.substantialOn ? n.substantialText : '',
      '4.1': d.street, '4.2': d.city, '4.3': d.county,
      'Group5.0': /^The Landlord$/,
      ...serviceBlock(n, '7.1', 'Group6.0', '7.2'),
    };
  },
  JDF99C: (d) => ({ '0.0': d.tenants.join(' and '), '0.1': true, '4.1': d.street, '4.2': d.city, '4.3': d.county, 'Group5.0': /^The Landlord$/ }),
  JDF101: (d) => {
    const n = d.notice; const pa = splitAddr(d.plaintiffAddress); const x = d.x || {};
    const rentDaily = d.rent ? (parseFloat(d.rent) * 12 / 365) : 0;
    const f = n ? failedAttempts(n) : [];
    const rentOwed = x.rentOwed != null ? x.rentOwed : (n && n.rentOn ? n.rentTotal : 0);
    const late = parseFloat(x.lateFees) || 0, dmg = parseFloat(x.damages) || 0;
    const total = (parseFloat(rentOwed) || 0) + late + dmg;
    const med = x.mediation || (d.mediationEligible ? '' : 'not_said');
    return {
      ...caption(d), 'Group1.1': /County Court/,
      'Name': d.landlord, 'Street address': pa.street, 'City': pa.city, 'State': pa.state, 'Zip': pa.zip, 'Phone': d.plaintiffPhone, 'Email': d.plaintiffEmail,
      'Group6.1': x.interpreter ? /^Yes/ : /No, I don/i, '6.2': x.interpreter || '',
      'Group6.3': x.attend === 'remote' ? /remotely/i : x.attend === 'person' ? /in-person/i : '',
      '6.4': d.landlord, '6.5A': pa.street, '6.5B': [pa.city, [pa.state, pa.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), '6.6': d.plaintiffPhone, '6.7': d.plaintiffEmail,
      '7.0': d.tenants.join(', '), '7.1': d.street, '7.2': d.city, '7.3': d.county, '7.4': d.zip,
      'Group7.8': x.fedMortgage === 'yes' || (!x.fedMortgage && d.cares) ? /^Yes/ : x.fedMortgage === 'no' ? /^No/ : '',
      'Group8.1': /^Written/,
      'Group8.2': n ? (n.kind === 'terminate' ? /99 B/ : /99 A/) : '',
      'Group8.3': n && n.served ? (servedPersonally(n) ? /personal service/i : /Posting/i) : '',
      '8.2': money(d.rent), '8.3': d.rent ? '1st' : '',
      '8.1': n ? mdy(n.served) : '', '8.4': n && !servedPersonally(n) ? mdy(f[0]) : '', '8.5': n && !servedPersonally(n) ? mdy(f[1]) : '',
      '10A.1': !!(n && n.rentOn), '10A.2': n && n.rentOn ? money(rentOwed) : '', '10A.3': late ? money(late) : '',
      '10A.4': n && n.rentOn ? (x.rentDates || dueList(n)) : '', '10A.5': n && n.rentOn && rentDaily ? money(rentDaily) : '',
      '10B.1': !!(n && (n.violationOn || n.repeatOn)), '10B.2': !!(n && n.repeatOn), '10C.1': !!(n && n.substantialOn), '10F.0': !!(n && n.conductOn),
      '11.0': facts(d),
      '12.0': dmg > 0, '12.1': dmg ? money(dmg) : '', '12.2': x.damagesDaily ? money(x.damagesDaily) : '', '12.3': total ? money(total) : '',
      'Group13.1': x.military === 'yes' ? /^Yes/ : x.military === 'no' ? /^No/ : '',
      'Group15.1': med === 'attended' ? /^Yes/ : med ? /^No/ : '',
      '15.2': med === 'not_said', '15.3': med === 'not_receive', '15.5': med === 'under6',
      'Sig1_Name': signerLine(d),
      '19.0': x.damagesText ? 'Damages: ' + x.damagesText : '',
    };
  },
  JDF102: (d) => {
    const x = d.x || {}; const pa = splitAddr(d.plaintiffAddress); const sv = x.service || {};
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/.exec(d.returnDate || '');
    return { ...caption(d), 'Name': d.landlord, 'Street address': pa.street, 'CSZ': [pa.city, [pa.state, pa.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      'Phone': d.plaintiffPhone, 'Email': d.plaintiffEmail, 'Division': [x.division, x.courtroom].filter(Boolean).join(' / '),
      'Group8.1': /Clerk/i, '8.4': d.plaintiffAddress, '8.5': d.plaintiffPhone,
      '2A.1': x.returnISO ? mdy(x.returnISO) : (m ? m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3] : ''), '2A.2': x.returnTime || (m ? m[4].trim() : ''),
      '9.1': sv.how === 'posted' && !!sv.mailedISO, '9.2': sv.how === 'posted' ? mdy(sv.mailedISO) : '', '9.3': sv.how === 'posted' && sv.mailedISO ? premises(d) : '' };
  },
  JDF103: (d) => ({ ...caption(d), 'Group1.1': /County Court/, ...division(d) }),
  JDF105: (d) => { const pa = splitAddr(d.plaintiffAddress); const x = d.x || {};
    return { ...caption(d), 'Group1.1': /County Court/, ...division(d), 'Street address': pa.street, 'City': pa.city, 'State': pa.state, 'Zip': pa.zip, 'Phone': d.plaintiffPhone, 'Email': d.plaintiffEmail,
      'Name': d.landlord, 'Group6.1': x.attend === 'remote' ? /Remotely/ : x.attend === 'person' ? /In-Person/ : '' }; },
  JDF106A: (d) => ({ ...caption(d), ...division(d) }),
  JDF106B: (d) => ({ ...caption(d), 'GroupA.1': /County Court/, ...division(d) }),
  JDF108: (d) => ({ ...caption(d), 'Group1.1': /County Court/, ...division(d) }),
  JDF98: (d) => {
    const x = d.x || {}; const sv = x.service || {};
    const o = { ...caption(d), ...division(d), '6.1': true, '6.2': true, '6.4': true, '6.5': true, '6.10': true, '6.11': 'JDF 108 Request for Documents; eviction information form',
      '7.2': d.county, '7.3': 'Colorado', '7.6': premises(d) };
    if (sv.serverName) { o['Sig_Name'] = sv.serverName; o['Name'] = sv.serverName; }
    if (sv.serverType === 'sheriff') { o['Group9'] = /Sheriff/; o['9.3'] = d.county; } else if (sv.serverType === 'private') o['Group9'] = /Private/;
    if (sv.how === 'posted') { o['8E.6'] = true; o['8E.7'] = mdy(sv.servedISO); }
    if (sv.servedISO) o['7.4'] = mdy(sv.servedISO);
    return o;
  },
  JDF107A: (d) => {
    const x = d.x || {}; const j = x.judgment || {}; const cos = x.cos || {};
    return { ...caption(d), 'Division': [x.division, x.courtroom].filter(Boolean).join(' / '),
      '1.1': d.landlord, '1.2': d.plaintiffAddress, '1.3': d.plaintiffPhone, '1.4': d.plaintiffEmail,
      '2.1': d.tenants.join(', '), '2.2': true,
      '3A_0': !!(j.money && j.principal), '3A.1': j.money && j.principal ? money(j.principal) : '',
      '3B.0': !!(j.money && j.interest), '3B.1': j.money && j.interest ? money(j.interest) : '',
      '3D.0': !!(j.money && j.costs), '3D.1': j.money && j.costs ? money(j.costs) : '',
      '4A.0': true, '4A.1': d.street, '4A.2': [d.city, 'CO ' + (d.zip || '')].filter(Boolean).join(', '), '4B.0': !!d.mediationEligible,
      'CoS_Date': mdy(cos.iso), 'Group_CoS': cos.iso ? /regular mail/i : '', 'CoS_Mail_Name': cos.iso ? d.tenants.join(', ') : '', 'CoS_Mail_Address': cos.iso ? premises(d) : '',
      'Sig1_Name': signerLine(d) };
  },
  JDF107B: (d) => {
    const x = d.x || {}; const j = x.judgment || {};
    return { ...caption(d), 'GroupA.1': /County Court/, ...division(d), '1.0': true, '2.0': d.landlord, '2.1': d.tenants.join(', '),
      '2.2': j.money && j.total ? money(j.total) : '', '2.3': true, '2.4': premises(d), '3.0': !!j.money, '3.3': true };
  },
  JDF109: (d) => { const x = d.x || {}; const j = x.judgment || {};
    return { ...caption(d), 'Division': [x.division, x.courtroom].filter(Boolean).join(' / '), '√ All Other Tenants': true, '1.1': mdy(j.iso),
      '2.1': d.street, '2.2': d.city, 'County': d.county, '3.1': true, 'Group3.2': d.mediationEligible ? /30/ : /10/, 'Group4.1': /All defendants/ }; },
  // ---- collecting the money
  FORM7: (d) => { const pa = d.plaintiffAddress; const x = d.x || {}; const dbt = (x.debtor || {}).name || d.tenants[0] || '';
    return { 'county': d.county, 'court_address1': d.courtAddress, 'plantiff': d.landlord, 'defendant': d.tenants.join(', '),
      'atty1': d.landlord, 'atty2': pa + (d.plaintiffPhone ? '  Phone: ' + d.plaintiffPhone : ''), 'atty_email': d.plaintiffEmail,
      'case_num': d.caseNumber, 'division': x.division || '', 'courtroom': x.courtroom || '', 'judgment_debtor': dbt }; },
  FORM26: (d) => garnCommon(d, 'FORM26'),
  FORM29: (d) => garnCommon(d, 'FORM29'),
  FORM27: (d) => { const x = d.x || {}; const dbt = (x.debtor || {}).name || d.tenants[0] || '';
    return { 'court_type_1': 'County Court', 'court_county_1': d.county, 'court_city': x.courtCity || d.city, 'court_case_1': d.caseNumber, 'court_div_1': x.division || '', 'court_jud_nam_1': dbt,
      'plaintiff_1': d.landlord, 'defendant_1': d.tenants.join(', '),
      'court_type_2': 'County Court', 'court_county_2': d.county, 'court_city_2': x.courtCity || d.city, 'court_case_2': d.caseNumber, 'court_div_2': x.division || '', 'court_jud_nam_2': dbt,
      'plaintiff_2': d.landlord, 'defendant_2': d.tenants.join(', ') }; },
};
function premises(d) { return [d.street, d.city, 'CO ' + (d.zip || '')].filter(Boolean).join(', '); }
function division(d) { const x = d.x || {}; return { 'Division': x.division || '', 'Courtroom': x.courtroom || '' }; }
function signerLine(d) { return d.signer ? d.signer + (d.signer !== d.landlord ? ', for ' + d.landlord : '') : d.landlord; }
function courtLines(addr) { const i = (addr || '').indexOf(','); return i > 0 ? [addr.slice(0, i), addr.slice(i + 1).trim()] : [addr || '', '']; }
function garnCommon(d, form) {
  const x = d.x || {}; const c = x.collect || {}; const db = x.debtor || {}; const pa = splitAddr(d.plaintiffAddress);
  const [ca1, ca2] = courtLines(d.courtAddress);
  const g = form === 'FORM26' ? (db.employer || {}) : (db.bank || {});
  const debtorLine = [db.name || d.tenants[0] || '', db.address || premises(d)].filter(Boolean).join(', ');
  const o = { 'court-1': true, 'court': d.county, 'court_address_1': ca1, 'court_address_2': ca2, 'plaintiff': d.landlord, 'defendent': d.tenants.join(', '),
    'attorney_1': d.landlord + ', ' + d.plaintiffAddress, 'phone': d.plaintiffPhone, 'email': d.plaintiffEmail, 'case': d.caseNumber, 'division': x.division || '', 'courtroom': x.courtroom || '',
    'changes-1': true };
  if (form === 'FORM26') Object.assign(o, {
    'address_1': debtorLine.slice(0, 80), 'address_2': debtorLine.slice(80) || (db.other || ''),
    'judgement_date': mdy(c.judgmentISO), 'judgement_amount': money(c.judgmentAmount), 'period-2': true,
    'interest_annum': c.rate ? String(c.rate) + '%' : '', 'interest_amount': c.interestAmt ? money(c.interestAmt) : '', 'taxable_amount': c.costs ? money(c.costs) : '',
    'paid_amount': c.paid ? money(c.paid) : '$0.00', 'owing_amount': money(c.owing), 'statement_date': mdy(c.asOfISO),
    'creditor_name': d.landlord, 'creditor_address_1': pa.street, 'creditor_address_2': [pa.city, [pa.state, pa.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    'writ_garnishee': [g.name, g.address].filter(Boolean).join(', '),
    'writ_payable_3-1': true, 'writ_payable_3-1-1-1': true, 'writ_payable_3-1-2': x.courtCity || d.city,
    'questions_name': db.name || d.tenants[0] || '', 'questions_case': d.caseNumber });
  else Object.assign(o, {
    'creditor-3': true,
    'debtor_identity_1': (db.name || d.tenants[0] || ''), 'debtor_identity_2': db.address || premises(d), 'debtor_identity_3': db.other || '',
    'original_date': mdy(c.judgmentISO), 'amount_1': money(c.judgmentAmount), 'interest': c.rate ? String(c.rate) + '%' : '', 'amount_2': c.interestAmt ? money(c.interestAmt) : '',
    'amount_3': c.costs ? money(c.costs) : '', 'amount_4': c.paid ? money(c.paid) : '$0.00', 'amount_5': money(c.owing),
    'creditor_name': d.landlord, 'creditor_street': pa.street, 'creditor_city': pa.city, 'creditor_state': pa.state, 'creditor_zip': pa.zip,
    'authorized_name': d.signer || '', 'authorized_street': pa.street, 'authorized_city': pa.city, 'authorized_state': pa.state, 'authorized_zip': pa.zip,
    'creditor_title_phone': [x.signerTitle, d.plaintiffPhone].filter(Boolean).join(', '),
    'writ_garnishee': [g.name, g.address].filter(Boolean).join(', '),
    'writ_payable-3': true, 'writ_payable-3-1-1': true, 'writ_payable-3-2': x.courtCity || d.city,
    'questions_name': db.name || d.tenants[0] || '', 'questions_case': d.caseNumber });
  return o;
}
// ---- papers Lease Desk writes itself (see own-forms.mjs)
MAPPERS.LDREP = (d) => {
  const r = d.rep || (d.x || {}).rep || {};
  return { county: d.county, courtAddress: d.courtAddress, plaintiff: d.landlord, defendants: d.tenants.join(', ') + (d.tenants.length ? ', and all other occupants' : ''),
    caseNumber: d.caseNumber, premises: premises(d), entity: d.landlord,
    entityType: r.entityType || 'Colorado limited liability company', isLLC: /LLC|L\.L\.C|limited liability/i.test(d.landlord + ' ' + (r.entityType || '')),
    owners: r.owners || '1', members: r.members || [], affiant: r.affiant || '', affiantTitle: r.affiantTitle || 'Member', affiantRole: r.affiantRole || 'a member',
    rep: r.name || '', repRole: r.role || '' };
};
MAPPERS.LDMIL = (d) => ({ ...MAPPERS.LDREP(d), mil: (d.x || {}).militaryCheck || {}, tenantsList: d.tenants, signer: d.signer || d.landlord, signerTitle: (d.x || {}).signerTitle || '' });
MAPPERS.LDCOVER = (d) => ({ ...MAPPERS.LDREP(d), cover: (d.x || {}).cover || {} });
export function valuesFor(form, d) {
  const fn = MAPPERS[form];
  const v = fn ? fn(d) : caption(d);
  delete v._;
  return v;
}
