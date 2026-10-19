// Post-call alerts to Aaron. SMS via Twilio, email via Resend.
// These go to Aaron only (internal business notices), so CASL consent rules for callers do not apply here.
// The AI line never sends marketing texts or emails to callers.

import { prettyPhone } from './util.mjs';

const INTENT_LABEL = {
  buyer: 'Buyer', seller: 'Seller', buyer_and_seller: 'Buyer and seller', landlord: 'Landlord', tenant: 'Tenant',
  investor: 'Investor', existing_client: 'Existing client', vendor: 'Vendor or service provider',
  personal: 'Personal', other: 'Other'
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function headline(rec, vip) {
  if (vip) return rec.urgency === 'urgent' ? `URGENT VIP CALL: ${vip.display_name}` : `VIP CALL: ${vip.display_name}`;
  if (rec.urgency === 'urgent') return 'URGENT CALL';
  if (rec.urgency === 'high') return 'PRIORITY CALL';
  return 'New AI Line call';
}

function fmtAppt(a) {
  if (!a) return null;
  const when = new Date(a.start).toLocaleString('en-CA', { timeZone: 'America/Edmonton', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${a.type}, ${when}${a.address ? `, ${a.address}` : ''}`;
}

export function renderSms(rec, vip, links) {
  const name = vip?.display_name || rec.caller_name || 'Unknown caller';
  const lines = [
    headline(rec, vip),
    `${name} ${prettyPhone(rec.callback_phone_e164)}`,
    `Reason: ${INTENT_LABEL[rec.intent] || rec.intent}${rec.urgency_reason ? `. ${rec.urgency_reason}` : ''}`,
    `Summary: ${rec.summary || 'No summary captured.'}`,
    `Next: ${rec.next_step}`
  ];
  const appt = fmtAppt(rec.appointment);
  if (appt) lines.push(`Booked: ${appt}`);
  if (rec.after_hours) lines.push('(after hours)');
  if (links.transcript) lines.push(links.transcript);
  let out = lines.join('\n');
  // Keep under 3 SMS segments. The full detail is in the email and the call log.
  if (out.length > 450) {
    const over = out.length - 450;
    const s = rec.summary || '';
    out = out.replace(`Summary: ${s}`, `Summary: ${s.slice(0, Math.max(40, s.length - over - 3))}...`);
  }
  return out;
}

export function renderEmail(rec, vip, links) {
  const name = vip?.display_name ? `${vip.display_name}${vip.full_name ? ` (${vip.full_name})` : ''}` : (rec.caller_name || 'Unknown caller');
  const urgent = rec.urgency === 'urgent';
  const subject = `${urgent ? '[URGENT] ' : ''}${vip ? '[VIP] ' : ''}AI Line: ${vip?.display_name || rec.caller_name || prettyPhone(rec.callback_phone_e164)}, ${INTENT_LABEL[rec.intent] || rec.intent}`;
  const row = (k, v) => `<tr><td style="padding:6px 12px 6px 0;color:#555;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#111">${esc(v || 'Not given')}</td></tr>`;
  const banner = urgent
    ? `<div style="background:#B42318;color:#fff;padding:12px 16px;font-weight:700;font-size:16px">URGENT: ${esc(rec.urgency_reason || 'Caller flagged this as time sensitive.')} Call back now.</div>`
    : vip
      ? `<div style="background:#1D7FC4;color:#fff;padding:12px 16px;font-weight:700">VIP caller: ${esc(name)}. Priority message.</div>`
      : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff">
${banner}
<div style="padding:20px 16px 8px"><div style="font-size:12px;letter-spacing:.08em;color:#777;text-transform:uppercase">Radical Robinson AI Line</div>
<h1 style="margin:6px 0 4px;font-size:20px;color:#111">${esc(name)}</h1>
<a href="tel:${esc(rec.callback_phone_e164)}" style="font-size:18px;color:#1D7FC4;text-decoration:none;font-weight:700">${esc(prettyPhone(rec.callback_phone_e164))}</a></div>
<div style="padding:8px 16px"><h2 style="font-size:14px;margin:12px 0 4px;color:#111">Summary</h2><p style="margin:0;color:#222;line-height:1.5">${esc(rec.summary || 'No summary captured.')}</p>
<h2 style="font-size:14px;margin:16px 0 4px;color:#111">Next step</h2><p style="margin:0;color:#222;line-height:1.5">${esc(rec.next_step)}</p></div>
<div style="padding:8px 16px"><table style="border-collapse:collapse;font-size:14px">
${row('Reason', INTENT_LABEL[rec.intent] || rec.intent)}
${row('Urgency', rec.urgency)}
${row('Email', rec.caller_email)}
${row('Property or area', rec.property_or_area)}
${row('Timeline', rec.timeline)}
${row('Preapproval', rec.preapproval_status)}
${row('Best time to call', rec.best_time_to_call)}
${row('Appointment', fmtAppt(rec.appointment) || 'None booked')}
${row('Live transfer', rec.transfer_attempted ? (rec.transfer_result || 'attempted') : 'Not attempted')}
${row('After hours', rec.after_hours ? 'Yes' : 'No')}
${row('Recording consent', rec.recording_consent)}
${row('Follow Up Boss', links.fubStatus)}
</table></div>
${links.transcript ? `<div style="padding:12px 16px 20px"><a href="${esc(links.transcript)}" style="display:inline-block;background:#0D1B2A;color:#fff;padding:10px 16px;text-decoration:none;border-radius:4px">Open transcript and recording</a></div>` : ''}
<div style="padding:12px 16px;border-top:1px solid #eee;font-size:11px;color:#888;line-height:1.5">Aaron Robinson, REALTOR&reg;, Century 21 Masters. This notice contains personal information collected under the AI Line privacy notice. Do not forward outside the brokerage. The AI gives no advice or opinions; all follow up is by Aaron personally.</div>
</div></body></html>`;
  const text = renderSms(rec, vip, links);
  return { subject, html, text };
}

export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return 'skipped_not_configured';
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body })
  });
  return res.ok ? 'sent' : `error_${res.status}`;
}

export async function sendEmail(to, { subject, html, text }) {
  const key = process.env.RESEND_API_KEY, from = process.env.ALERT_FROM_EMAIL;
  if (!key || !from) return 'skipped_not_configured';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [].concat(to), subject, html, text })
  });
  return res.ok ? 'sent' : `error_${res.status}`;
}
