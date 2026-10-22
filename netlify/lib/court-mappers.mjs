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
    const n = d.notice; const pa = splitAddr(d.plaintiffAddress);
    const rentDaily = d.rent ? (parseFloat(d.rent) * 12 / 365) : 0;
    const f = n ? failedAttempts(n) : [];
    return {
      ...caption(d), 'Group1.1': /County Court/,
      'Name': d.landlord, 'Street address': pa.street, 'City': pa.city, 'State': pa.state, 'Zip': pa.zip, 'Phone': d.plaintiffPhone, 'Email': d.plaintiffEmail,
      'Group6.1': /No, I don/i,
      '6.4': d.landlord, '6.5A': pa.street, '6.5B': [pa.city, [pa.state, pa.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), '6.6': d.plaintiffPhone, '6.7': d.plaintiffEmail,
      '7.0': d.tenants.join(', '), '7.1': d.street, '7.2': d.city, '7.3': d.county, '7.4': d.zip,
      'Group7.8': d.cares ? /^Yes/ : '',
      'Group8.1': /^Written/,
      'Group8.2': n ? (n.kind === 'terminate' ? /99 B/ : /99 A/) : '',
      'Group8.3': n && n.served ? (servedPersonally(n) ? /personal service/i : /Posting/i) : '',
      '8.2': money(d.rent), '8.3': d.rent ? '1st' : '',
      '8.1': n ? mdy(n.served) : '', '8.4': n && !servedPersonally(n) ? mdy(f[0]) : '', '8.5': n && !servedPersonally(n) ? mdy(f[1]) : '',
      '10A.1': !!(n && n.rentOn), '10A.2': n && n.rentOn ? money(n.rentTotal) : '', '10A.4': n && n.rentOn ? dueList(n) : '', '10A.5': n && n.rentOn && rentDaily ? money(rentDaily) : '',
      '10B.1': !!(n && (n.violationOn || n.repeatOn)), '10B.2': !!(n && n.repeatOn), '10C.1': !!(n && n.substantialOn), '10F.0': !!(n && n.conductOn),
      '11.0': facts(d),
      'Group15.1': d.mediationEligible ? '' : /^No/, '15.2': !d.mediationEligible,
      'Sig1_Name': d.signer ? d.signer + ', for ' + d.landlord : d.landlord,
    };
  },
  JDF102: (d) => {
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/.exec(d.returnDate || '');
    return { ...caption(d), 'Group8.1': /Clerk/i, '8.4': d.plaintiffAddress, '8.5': d.plaintiffPhone,
      '2A.1': m ? m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3] : '', '2A.2': m ? m[4].trim() : '' };
  },
  JDF98: (d) => ({ ...caption(d), '6.1': true, '6.2': true, '6.4': true, '6.10': true, '6.11': 'JDF 108 Request for Documents', '7.2': d.county, '7.3': 'Colorado', '7.6': [d.street, d.city].filter(Boolean).join(', ') + ', CO ' + (d.zip || '') }),
  JDF107A: (d) => {
    const pa = splitAddr(d.plaintiffAddress);
    return { ...caption(d), '1.1': d.landlord, '1.2': d.plaintiffAddress, '1.3': d.plaintiffPhone, '1.4': d.plaintiffEmail,
      '2.1': d.tenants.join(', '), '2.2': true, '4A.0': true, '4A.1': d.street, '4A.2': [d.city, 'CO ' + (d.zip || '')].filter(Boolean).join(', '),
      'Sig1_Name': d.signer ? d.signer + ', for ' + d.landlord : d.landlord, '_': pa };
  },
  JDF109: (d) => ({ ...caption(d), '√ All Other Tenants': true, '2.1': d.street, '2.2': d.city, 'County': d.county, '3.1': true }),
};
export function valuesFor(form, d) {
  const fn = MAPPERS[form];
  const v = fn ? fn(d) : caption(d);
  delete v._;
  return v;
}
