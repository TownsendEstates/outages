// Follow Up Boss integration.
// New caller  -> POST /v1/events (FUB's recommended way to add leads: dedupes, runs lead flow and action plans).
// Known caller -> match on phone, then POST /v1/notes + /v1/calls on their timeline, merge tags, assign to Aaron.
// Booked appointment -> POST /v1/appointments linked to the person and Aaron.
// Auth: HTTP Basic with the API key as username. X-System / X-System-Key identify the integration.

import { splitName, prettyPhone } from './util.mjs';

const BASE = 'https://api.followupboss.com/v1';
export const LEAD_SOURCE = 'Radical Robinson AI Line';

function headers() {
  const key = process.env.FUB_API_KEY;
  if (!key) throw new Error('FUB_API_KEY must be set');
  const h = {
    authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64'),
    'content-type': 'application/json',
    'X-System': process.env.FUB_X_SYSTEM || 'RadicalRobinsonAI'
  };
  if (process.env.FUB_X_SYSTEM_KEY) h['X-System-Key'] = process.env.FUB_X_SYSTEM_KEY;
  return h;
}

async function fub(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (res.status === 204) return { status: 204, data: null };
  if (!res.ok) throw new Error(`FUB ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// FUB stores numbers in mixed formats; search by the 10 digit form, which FUB normalizes.
export async function findPersonByPhone(e164) {
  const ten = e164.replace(/\D/g, '').slice(-10);
  const { data } = await fub('GET', `/people?phone=${encodeURIComponent(ten)}&limit=5&fields=id,name,firstName,lastName,assignedUserId,tags,phones`);
  const people = data?.people || [];
  // Guard against loose matches: require the last 10 digits to match exactly.
  return people.find((p) => (p.phones || []).some((ph) => String(ph.value || '').replace(/\D/g, '').slice(-10) === ten))
    || null;
}

let cachedAaronId = null;
export async function aaronUserId() {
  if (process.env.FUB_ASSIGNED_USER_ID) return Number(process.env.FUB_ASSIGNED_USER_ID);
  if (cachedAaronId) return cachedAaronId;
  const email = process.env.AARON_EMAIL;
  if (!email) return null;
  const { data } = await fub('GET', `/users?email=${encodeURIComponent(email)}`);
  cachedAaronId = data?.users?.[0]?.id || null;
  return cachedAaronId;
}

export function tagsFor(rec) {
  const tags = ['AI Line'];
  const intentTag = {
    buyer: 'Buyer', seller: 'Seller', buyer_and_seller: ['Buyer', 'Seller'], landlord: 'Landlord',
    tenant: 'Tenant', investor: 'Investor', existing_client: 'Past/Current Client'
  }[rec.intent];
  if (intentTag) tags.push(...[].concat(intentTag));
  if (rec.urgency === 'urgent') tags.push('Urgent');
  else if (rec.urgency === 'high') tags.push('Priority');
  if (rec.after_hours) tags.push('After Hours');
  if (rec.appointment) tags.push('Appointment Booked');
  return tags;
}

function eventType(rec) {
  if (rec.intent === 'seller' || rec.intent === 'buyer_and_seller') return 'Seller Inquiry';
  if (rec.intent === 'buyer' && rec.property_or_area && /\d/.test(rec.property_or_area)) return 'Property Inquiry';
  return 'General Inquiry';
}

export function noteBody(rec, links) {
  const lines = [
    `AI Line call ${rec.urgency === 'urgent' ? '(URGENT) ' : ''}from ${rec.caller_name || 'unknown caller'} at ${prettyPhone(rec.callback_phone_e164)}`,
    '',
    `Summary: ${rec.summary || 'No summary.'}`,
    `Next step: ${rec.next_step}`,
    '',
    `Type: ${rec.intent}`,
    `Property or area: ${rec.property_or_area || 'not given'}`,
    `Timeline: ${rec.timeline || 'not given'}`,
    `Preapproval: ${rec.preapproval_status || 'unknown'}`,
    `Best time to call: ${rec.best_time_to_call || 'not given'}`,
    `Email: ${rec.caller_email || 'not given'}`
  ];
  if (rec.urgency_reason) lines.push(`Urgency reason: ${rec.urgency_reason}`);
  if (rec.appointment) lines.push(`Appointment booked: ${rec.appointment.type} at ${rec.appointment.start}${rec.appointment.address ? `, ${rec.appointment.address}` : ''}`);
  if (links.transcript) lines.push('', `Transcript and recording: ${links.transcript}`);
  lines.push('', 'Logged automatically by the Radical Robinson AI Line. The AI gives no advice; Aaron to follow up personally.');
  return lines.join('\n');
}

async function addCall(personId, rec, userId) {
  await fub('POST', '/calls', {
    personId,
    phone: rec.caller_phone_e164,
    isIncoming: true,
    outcome: 'Interested',
    duration: rec.duration_seconds || 0,
    note: `Answered by AI Line. ${rec.summary || ''}`.slice(0, 1000),
    ...(userId ? { userId } : {})
  });
}

async function addAppointment(personId, rec, userId) {
  if (!rec.appointment) return;
  const start = rec.appointment.start;
  const end = rec.appointment.end || new Date(Date.parse(start) + 30 * 60 * 1000).toISOString();
  await fub('POST', '/appointments', {
    title: `${rec.appointment.type}: ${rec.caller_name || 'AI Line caller'}`,
    start, end,
    location: rec.appointment.address || '',
    description: `Booked by the Radical Robinson AI Line. ${rec.summary || ''}`.slice(0, 1000),
    invitees: [{ personId }, ...(userId ? [{ userId }] : [])]
  });
}

async function addTimeline(personId, rec, links, userId) {
  await fub('POST', '/notes', {
    personId,
    subject: `AI Line call: ${rec.intent}${rec.urgency === 'urgent' ? ' (URGENT)' : ''}`,
    body: noteBody(rec, links),
    isHtml: false
  });
  await addCall(personId, rec, userId);
  await addAppointment(personId, rec, userId);
}

// Main entry. Returns { status: 'created'|'matched', personId }.
export async function syncCallToFub(rec, links) {
  const userId = await aaronUserId();
  const tags = tagsFor(rec);
  const existing = await findPersonByPhone(rec.caller_phone_e164);

  if (existing) {
    // mergeTags=true adds tags without wiping the ones Aaron already set.
    await fub('PUT', `/people/${existing.id}?mergeTags=true`, {
      tags,
      ...(!existing.assignedUserId && userId ? { assignedUserId: userId } : {})
    });
    await addTimeline(existing.id, rec, links, userId);
    return { status: 'matched', personId: existing.id };
  }

  const { firstName, lastName } = splitName(rec.caller_name);
  const person = {
    firstName, lastName,
    phones: [{ value: rec.callback_phone_e164, type: 'mobile' }],
    ...(rec.caller_email ? { emails: [{ value: rec.caller_email }] } : {}),
    tags,
    ...(userId ? { assignedUserId: userId } : {})
  };
  if (rec.caller_phone_e164 !== rec.callback_phone_e164 && rec.caller_phone_e164) {
    person.phones.push({ value: rec.caller_phone_e164, type: 'other' });
  }
  const evt = {
    source: LEAD_SOURCE,
    system: process.env.FUB_X_SYSTEM || 'RadicalRobinsonAI',
    type: eventType(rec),
    message: rec.summary || 'Inbound call to the Radical Robinson AI Line.',
    description: noteBody(rec, links),
    person,
    ...(rec.property_or_area ? { property: { street: rec.property_or_area, city: 'Edmonton', state: 'AB' } } : {}),
    ...(links.transcript ? { sourceUrl: links.transcript } : {})
  };
  const { status, data } = await fub('POST', '/events', evt);
  // 204 means FUB lead flow is set to ignore this source. Surface it rather than fail silently.
  if (status === 204) return { status: 'ignored_by_lead_flow', personId: null };
  let personId = data?.personId || data?.person?.id || null;
  if (!personId) personId = (await findPersonByPhone(rec.callback_phone_e164))?.id || null;
  if (personId) {
    // The event carries the summary. Add the call record and appointment on top.
    await addCall(personId, rec, userId);
    await addAppointment(personId, rec, userId);
  }
  return { status: status === 200 ? 'matched' : 'created', personId };
}
