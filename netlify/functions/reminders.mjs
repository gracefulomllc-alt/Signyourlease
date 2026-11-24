// Staff: check email setup, send a test email, or run today's reminders now.
import { sendMail, parseEmails, reminderHtml, mailConfigured } from '../lib/mailer.mjs';
import { runReminders } from '../lib/reminder-run.mjs';

const STAFF_CODES = ['1208', '6040'];
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (!STAFF_CODES.includes(url.searchParams.get('key') || '')) return json({ error: 'unauthorized' }, 401);
    return json({ configured: mailConfigured() });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let body; try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  if (!STAFF_CODES.includes(String(body.key || ''))) return json({ error: 'unauthorized' }, 401);
  if (!mailConfigured()) return json({ error: 'not set up' }, 503);
  if (body.action === 'test') {
    const to = parseEmails(body.to); if (!to.length) return json({ error: 'enter a valid email address' }, 400);
    const subject = 'Lease Desk test email';
    const text = 'This is a test. Eviction step reminders from Lease Desk will come from this address.';
    try { const r = await sendMail({ to, subject, text, html: reminderHtml(subject, text, '') }); return json({ ok: true, via: r.via }); }
    catch (e) { return json({ error: String(e.message || e).slice(0, 200) }, 502); }
  }
  if (body.action === 'run') return json({ ok: true, ...(await runReminders()) });
  return json({ error: 'unknown action' }, 400);
};
export const config = { path: '/api/reminders' };
