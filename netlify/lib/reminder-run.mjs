// Sends the eviction-step reminders that are due today (Mountain time).
// The browser builds each case's queue (track.reminders.queue); this only sends what's due and records it.
import { getStore } from '@netlify/blobs';
import { sendMail, parseEmails, reminderHtml, mailConfigured } from './mailer.mjs';

export function denverToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
const STALE_DAYS = 3; // a reminder more than 3 days late is skipped, not sent

export async function runReminders({ now = new Date(), send = sendMail } = {}) {
  const store = getStore({ name: 'cases', consistency: 'strong' });
  const today = denverToday(now); const oldest = addDays(today, -STALE_DAYS);
  const out = { today, configured: mailConfigured(), sent: 0, skipped: 0, failed: 0, errors: [] };
  const { blobs } = await store.list();
  for (const b of blobs) {
    const c = await store.get(b.key, { type: 'json' }).catch(() => null);
    const t = c && c.track; if (!t || t.closed) continue;
    const r = t.reminders || {}; const to = parseEmails(r.to); if (!to.length) continue;
    const sent = r.sent || {};
    const due = (r.queue || []).filter(q => q && q.key && q.on && q.on <= today && !sent[q.key] && (t.remind || {})[q.step]);
    if (!due.length) continue;
    const marks = {};
    for (const q of due) {
      if (q.on < oldest) { marks[q.key] = Date.now(); out.skipped++; continue; }
      try {
        await send({ to, subject: q.subject, text: q.text + (q.link ? '\n\nOpen the checklist: ' + q.link : ''), html: reminderHtml(q.subject, q.text, q.link) });
        marks[q.key] = Date.now(); out.sent++;
      } catch (e) { out.failed++; out.errors.push(String(e.message || e).slice(0, 160)); if (/not set up/.test(e.message)) return out; }
    }
    if (Object.keys(marks).length) {
      const fresh = (await store.get(b.key, { type: 'json' }).catch(() => null)) || c;
      fresh.track = fresh.track || t; fresh.track.reminders = fresh.track.reminders || {};
      fresh.track.reminders.sent = { ...(fresh.track.reminders.sent || {}), ...marks };
      await store.setJSON(b.key, fresh);
    }
  }
  return out;
}
