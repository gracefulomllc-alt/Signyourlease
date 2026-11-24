// Daily at 14:00 UTC (7 a.m. Mountain standard time, 8 a.m. daylight time).
import { runReminders } from '../lib/reminder-run.mjs';
export default async () => {
  const r = await runReminders();
  console.log('reminders', JSON.stringify(r));
  return new Response('ok');
};
export const config = { schedule: '0 14 * * *' };
