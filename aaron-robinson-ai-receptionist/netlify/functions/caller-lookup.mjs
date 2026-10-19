// POST /api/caller-lookup
// Called by Ulio.ai when a call connects (inbound call webhook / dynamic variables) and available as the
// in-call tool "lookup_caller". Tells the agent whether the caller is a VIP or a known Follow Up Boss contact,
// and whether it is after hours, so the greeting and flow can adapt.
// Returns only what the agent needs to greet the caller. No CRM notes or deal details are exposed to the AI.

import { findVip, getSettings } from '../../lib/supabase.mjs';
import { findPersonByPhone } from '../../lib/fub.mjs';
import { webhookAuthorized } from '../../lib/auth.mjs';
import { toE164, isAfterHours, json } from '../../lib/util.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!webhookAuthorized(req)) return json(401, { error: 'unauthorized' });
  const body = await req.json().catch(() => ({}));
  const raw = body.from_number || body.phone || body.caller_number || body.call?.from_number || body.args?.phone || body.call_inbound?.from_number;
  const phone = toE164(raw);

  const [vip, settings] = await Promise.all([findVip(phone).catch(() => null), getSettings().catch(() => null)]);
  let known = null;
  if (!vip && phone && process.env.FUB_API_KEY) {
    // Hard 1.5s cap so a slow CRM never delays the greeting.
    known = await Promise.race([findPersonByPhone(phone).catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))]);
  }
  const afterHours = isAfterHours(new Date(), settings);
  const nowLocal = new Date().toLocaleString('en-CA', { timeZone: 'America/Edmonton', weekday: 'long', hour: 'numeric', minute: '2-digit' });

  const vars = {
    caller_phone: phone || 'unknown',
    is_vip: vip ? 'true' : 'false',
    vip_name: vip?.display_name || '',
    vip_relationship: vip?.relationship || '',
    vip_priority: vip?.priority || '',
    known_contact: known ? 'true' : 'false',
    known_first_name: known?.firstName || '',
    after_hours: afterHours ? 'true' : 'false',
    local_time: nowLocal
  };
  // Shape accepted by Ulio's inbound webhook (dynamic variables) and by a plain tool call.
  return json(200, { dynamic_variables: vars, call_inbound: { dynamic_variables: vars }, ...vars });
};

export const config = { path: '/api/caller-lookup' };
