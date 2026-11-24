// Sends email for Lease Desk reminders.
// Option A (simplest): a Gmail address + Gmail app password  -> env GMAIL_USER, GMAIL_APP_PASSWORD
// Option B: a Resend account                                  -> env RESEND_API_KEY (+ optional REMINDER_FROM)
import nodemailer from 'nodemailer';

const env = (k) => (typeof Netlify !== 'undefined' && Netlify.env && Netlify.env.get(k)) || process.env[k] || '';

export function mailConfigured() {
  return !!((env('GMAIL_USER') && env('GMAIL_APP_PASSWORD')) || env('RESEND_API_KEY'));
}

export function parseEmails(s) {
  return String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 5);
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function reminderHtml(subject, text, link) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1E2A3A;">
    <div style="border-top:4px solid #8C2F39;padding:18px 20px;background:#fff;border:1px solid #E5DCCF;">
      <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8a7a66;">Lease Desk reminder</div>
      <h2 style="margin:6px 0 12px;font-size:20px;">${escHtml(subject)}</h2>
      ${String(text).split(/\n\n+/).map(p => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px;">${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('')}
      ${link ? `<p style="margin:18px 0 4px;"><a href="${escHtml(link)}" style="background:#C9962B;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:bold;display:inline-block;">Open the checklist</a></p>` : ''}
    </div>
    <p style="font-size:12px;color:#8a7a66;margin-top:10px;">You turned this reminder on in Lease Desk. To stop it, uncheck the reminder in that step, or close the case.</p>
  </div>`;
}

export async function sendMail({ to, subject, text, html }) {
  const list = Array.isArray(to) ? to : parseEmails(to);
  if (!list.length) throw new Error('no valid email address');
  if (env('GMAIL_USER') && env('GMAIL_APP_PASSWORD')) {
    const tx = nodemailer.createTransport({ service: 'gmail', auth: { user: env('GMAIL_USER'), pass: env('GMAIL_APP_PASSWORD').replace(/\s+/g, '') } });
    await tx.sendMail({ from: `Lease Desk <${env('GMAIL_USER')}>`, to: list.join(', '), subject, text, html });
    return { via: 'gmail' };
  }
  if (env('RESEND_API_KEY')) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('REMINDER_FROM') || 'Lease Desk <onboarding@resend.dev>', to: list, subject, text, html }),
    });
    if (!r.ok) throw new Error('resend ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return { via: 'resend' };
  }
  throw new Error('not set up');
}
