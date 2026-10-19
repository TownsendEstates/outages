// Turns the Ulio.ai post-call webhook into one flat call record.
// Ulio's white-label engine can emit a few payload shapes depending on account version, so this
// accepts the common ones: flat, { call: {...} } with call_analysis, and { message: {...} } end-of-call reports.
// The extracted field names match agent/ulio-agent-config.json > post_call_analysis.

import { toE164, fallbackUrgency } from './util.mjs';

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

function transcriptToText(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) {
    return t.map((m) => `${(m.role || m.speaker || 'unknown').replace('assistant', 'AI').replace('agent', 'AI')
      .replace('user', 'Caller')}: ${m.content || m.text || m.message || ''}`).join('\n');
  }
  return String(t);
}

export function normalizeUlioPayload(body) {
  const call = body?.call || body?.message?.call || body?.data || body || {};
  const msg = body?.message || {};
  const analysis = pick(call.call_analysis, call.analysis, msg.analysis, body.analysis) || {};
  const x = pick(analysis.custom_analysis_data, analysis.structuredData, analysis.extracted, body.extracted,
    call.extracted_variables, call.variables) || {};

  const fromRaw = pick(call.from_number, call.from, call.caller_number, call.customer?.number, body.from_number, body.from);
  const callback = toE164(x.callback_number);
  const fromE164 = toE164(fromRaw);

  const transcript = transcriptToText(pick(call.transcript, call.transcript_object, msg.artifact?.transcript,
    msg.artifact?.messages, body.transcript));
  const summary = pick(x.summary, analysis.call_summary, analysis.summary, body.summary, '');

  const startMs = pick(call.start_timestamp, call.started_at, msg.startedAt, body.started_at);
  const endMs = pick(call.end_timestamp, call.ended_at, msg.endedAt, body.ended_at);
  const toIso = (v) => (v ? new Date(typeof v === 'number' ? v : Date.parse(v)).toISOString() : null);
  const started = toIso(startMs);
  const ended = toIso(endMs);

  const urgencyRaw = String(pick(x.urgency, '')).toLowerCase();
  const urgency = ['urgent', 'high', 'normal', 'low'].includes(urgencyRaw)
    ? urgencyRaw
    : fallbackUrgency(`${summary}\n${transcript}`);

  const appt = x.appointment_start
    ? { start: x.appointment_start, end: x.appointment_end || null, type: x.appointment_type || 'Call back',
        address: x.appointment_address || x.property_or_area || null, calendar_event_id: x.calendar_event_id || null }
    : null;

  return {
    provider_call_id: pick(call.call_id, call.id, body.call_id, body.id, null),
    started_at: started,
    ended_at: ended,
    duration_seconds: pick(call.duration_seconds, call.duration,
      started && ended ? Math.round((Date.parse(ended) - Date.parse(started)) / 1000) : null),
    caller_phone_e164: fromE164 || callback,
    callback_phone_e164: callback || fromE164,
    caller_name: pick(x.caller_name, call.caller_name, null),
    caller_email: pick(x.caller_email, null),
    intent: String(pick(x.caller_type, x.intent, 'other')).toLowerCase(),
    urgency,
    urgency_reason: pick(x.urgency_reason, null),
    property_or_area: pick(x.property_or_area, null),
    timeline: pick(x.timeline, null),
    preapproval_status: pick(x.preapproval_status, 'unknown'),
    best_time_to_call: pick(x.best_time_to_call, null),
    transfer_attempted: Boolean(x.transfer_attempted === true || x.transfer_attempted === 'true'),
    transfer_result: pick(x.transfer_result, null),
    recording_consent: pick(x.recording_consent, 'unknown'),
    appointment: appt,
    summary,
    next_step: pick(x.next_step, 'Aaron to call back.'),
    transcript,
    recording_url: pick(call.recording_url, msg.artifact?.recordingUrl, msg.recordingUrl, body.recording_url, null),
    transcript_url: pick(call.public_log_url, call.transcript_url, body.transcript_url, null)
  };
}
