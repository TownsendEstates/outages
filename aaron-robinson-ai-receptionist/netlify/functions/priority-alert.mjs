// POST /api/priority-alert
// In-call tool "send_priority_alert". The agent calls it DURING the call for VIP callers and urgent callers,
// so Aaron gets a text right away instead of waiting for the call to end. The full post-call alert still follows.

import { findVip } from '../../lib/supabase.mjs';
import { sendSms } from '../../lib/notify.mjs';
import { webhookAuthorized } from '../../lib/auth.mjs';
import { toE164, prettyPhone, json } from '../../lib/util.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!webhookAuthorized(req)) return json(401, { error: 'unauthorized' });
  const body = await req.json().catch(() => ({}));
  const a = body.args || body.arguments || body;
  const phone = toE164(a.callback_number || a.phone || body.call?.from_number);
  const vip = await findVip(phone).catch(() => null);
  const who = vip?.display_name || a.caller_name || 'Caller';
  const tag = vip ? (a.urgent ? 'URGENT VIP' : 'VIP') : 'URGENT';
  const msg = `${tag} ON AI LINE NOW: ${who} ${prettyPhone(phone)}\n${String(a.reason || 'Wants you to call back.').slice(0, 300)}\nCall back ASAP. Full notes to follow.`;
  const to = process.env.AARON_ALERT_PHONE;
  const status = to ? await sendSms(to, msg).catch(() => 'error') : 'skipped_no_recipient';
  // The agent reads `result` back to itself; keep it short and never promise a callback time.
  return json(200, { result: status === 'sent' ? 'Alert sent to Aaron.' : 'Alert could not be sent; message will still be passed on.', status });
};

export const config = { path: '/api/priority-alert' };
