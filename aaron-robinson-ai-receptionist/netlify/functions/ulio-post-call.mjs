// POST /api/ulio-post-call
// Ulio.ai post-call webhook. For every call: log to Supabase, sync to Follow Up Boss, alert Aaron by SMS and email.

import { normalizeUlioPayload } from '../../lib/normalize-payload.mjs';
import { db, findVip, getSettings } from '../../lib/supabase.mjs';
import { syncCallToFub } from '../../lib/fub.mjs';
import { renderSms, renderEmail, sendSms, sendEmail } from '../../lib/notify.mjs';
import { webhookAuthorized } from '../../lib/auth.mjs';
import { isAfterHours, json } from '../../lib/util.mjs';

// Ulio sends several lifecycle events. Only the final analysed one has the summary and extracted fields.
const FINAL_EVENTS = new Set([undefined, 'call_analyzed', 'call.analyzed', 'end-of-call-report', 'call_ended_analyzed', 'post_call']);

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!webhookAuthorized(req)) return json(401, { error: 'unauthorized' });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: 'invalid json' });
  const evt = body.event || body.type || body.message?.type;
  if (!FINAL_EVENTS.has(evt)) return json(200, { ok: true, ignored: evt });

  const rec = normalizeUlioPayload(body);
  const settings = await getSettings().catch(() => null);
  rec.after_hours = isAfterHours(rec.started_at ? new Date(rec.started_at) : new Date(), settings);

  // Idempotency: Ulio retries on timeouts. Skip if this call was already fully processed.
  if (rec.provider_call_id) {
    const prior = await db.select('call_logs', `provider_call_id=eq.${encodeURIComponent(rec.provider_call_id)}&select=id,fub_status,sms_status`);
    if (prior?.[0]?.fub_status && prior[0].sms_status) return json(200, { ok: true, duplicate: true, id: prior[0].id });
  }

  const vip = await findVip(rec.caller_phone_e164).catch(() => null);
  if (vip && !rec.caller_name) rec.caller_name = vip.full_name || vip.display_name;
  if (vip && rec.urgency === 'normal') rec.urgency = 'high';

  const row = {
    provider_call_id: rec.provider_call_id, started_at: rec.started_at, ended_at: rec.ended_at,
    duration_seconds: rec.duration_seconds, caller_phone_e164: rec.caller_phone_e164, caller_name: rec.caller_name,
    caller_email: rec.caller_email, is_vip: Boolean(vip), vip_id: vip?.id || null, intent: rec.intent,
    urgency: rec.urgency, urgency_reason: rec.urgency_reason, property_or_area: rec.property_or_area,
    timeline: rec.timeline, preapproval_status: rec.preapproval_status, best_time_to_call: rec.best_time_to_call,
    after_hours: rec.after_hours, transfer_attempted: rec.transfer_attempted, transfer_result: rec.transfer_result,
    appointment: rec.appointment, summary: rec.summary, next_step: rec.next_step, transcript: rec.transcript,
    recording_url: rec.recording_consent === 'declined' ? null : rec.recording_url,
    recording_consent: rec.recording_consent, raw_payload: body
  };
  const saved = rec.provider_call_id
    ? (await db.upsert('call_logs', row, 'provider_call_id'))[0]
    : (await db.insert('call_logs', row))[0];

  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  const links = { transcript: site ? `${site}/admin/#call=${saved.id}` : rec.transcript_url, fubStatus: '' };

  // Follow Up Boss. Personal VIPs (family) are kept out of the CRM unless sync_to_crm is on.
  let fub = { status: 'skipped' };
  try {
    if (!rec.caller_phone_e164) fub = { status: 'skipped_no_phone' };
    else if (vip && !vip.sync_to_crm) fub = { status: 'skipped_vip' };
    else if (rec.intent === 'vendor' || rec.intent === 'personal') fub = { status: 'skipped_non_lead' };
    else fub = await syncCallToFub(rec, links);
  } catch (e) {
    fub = { status: 'error', error: String(e.message || e).slice(0, 500) };
  }
  links.fubStatus = { created: 'New lead created', matched: 'Added to existing contact', skipped_vip: 'Not synced (VIP, personal)',
    skipped_no_phone: 'Not synced (no number)', skipped_non_lead: 'Not synced (not a lead)',
    ignored_by_lead_flow: 'FUB lead flow ignored this source, check Admin > Lead Flow', error: 'SYNC FAILED, add manually' }[fub.status] || fub.status;

  // Alerts to Aaron. Email can list several recipients (comma separated), for example Aaron plus an assistant.
  const smsTo = process.env.AARON_ALERT_PHONE;
  const emailTo = (process.env.AARON_ALERT_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  const [smsStatus, emailStatus] = await Promise.all([
    smsTo ? sendSms(smsTo, renderSms(rec, vip, links)).catch((e) => `error_${e.message}`) : 'skipped_no_recipient',
    emailTo.length ? sendEmail(emailTo, renderEmail(rec, vip, links)).catch((e) => `error_${e.message}`) : 'skipped_no_recipient'
  ]);

  await db.update('call_logs', `id=eq.${saved.id}`, {
    fub_person_id: fub.personId || null, fub_status: fub.status, fub_error: fub.error || null,
    sms_status: smsStatus, email_status: emailStatus
  });

  return json(200, { ok: true, id: saved.id, vip: Boolean(vip), fub: fub.status, sms: smsStatus, email: emailStatus });
};

export const config = { path: '/api/ulio-post-call' };
