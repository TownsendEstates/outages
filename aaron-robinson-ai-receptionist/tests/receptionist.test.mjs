import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setEnv, installFakes, fixture, webhookReq } from './harness.mjs';

setEnv();
const postCall = (await import('../netlify/functions/ulio-post-call.mjs')).default;
const lookup = (await import('../netlify/functions/caller-lookup.mjs')).default;
const alert = (await import('../netlify/functions/priority-alert.mjs')).default;
const admin = (await import('../netlify/functions/vip-admin.mjs')).default;
const { normalizeUlioPayload } = await import('../lib/normalize-payload.mjs');
const { isAfterHours, toE164 } = await import('../lib/util.mjs');

const EXISTING = [{ id: 321, firstName: 'Mark', lastName: 'Chen', assignedUserId: null, tags: ['Seller'], phones: [{ value: '(780) 555-0222' }] }];

test('rejects webhook without the shared secret', async () => {
  installFakes();
  const res = await postCall(webhookReq('/api/ulio-post-call', fixture('new-buyer.json'), 'wrong'));
  assert.equal(res.status, 401);
});

test('NEW LEAD: creates FUB lead via /events with source, tags, assignment, call and appointment', async () => {
  const s = installFakes();
  const res = await postCall(webhookReq('/api/ulio-post-call', fixture('new-buyer.json')));
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.equal(out.fub, 'created');
  const evt = s.fub.find((c) => c.method === 'POST' && c.path === '/v1/events');
  assert.ok(evt, 'event posted');
  assert.equal(evt.body.source, 'Radical Robinson AI Line');
  assert.equal(evt.body.person.firstName, 'Priya');
  assert.equal(evt.body.person.lastName, 'Sharma');
  assert.equal(evt.body.person.phones[0].value, '+17805550111');
  assert.equal(evt.body.person.emails[0].value, 'priya.test@example.com');
  assert.equal(evt.body.person.assignedUserId, 7);
  assert.deepEqual(evt.body.person.tags.filter((t) => ['AI Line', 'Buyer', 'Appointment Booked'].includes(t)), ['AI Line', 'Buyer', 'Appointment Booked']);
  assert.match(evt.body.description, /Transcript and recording: https:\/\/ai-line\.example\.com\/admin\/#call=/);
  assert.ok(s.fub.some((c) => c.path === '/v1/calls' && c.body.personId === 5000 && c.body.isIncoming));
  const appt = s.fub.find((c) => c.path === '/v1/appointments');
  assert.ok(appt && appt.body.invitees.some((i) => i.personId === 5000) && appt.body.invitees.some((i) => i.userId === 7));
  assert.match(s.fub[0].headers.authorization, /^Basic /);
  // Alerts
  assert.equal(s.sms.length, 1);
  assert.match(s.sms[0].Body, /^New AI Line call\nPriya Sharma 780\.555\.0111/);
  assert.equal(s.email.length, 1);
  assert.match(s.email[0].subject, /AI Line: Priya Sharma, Buyer/);
  // Log
  const log = s.tables.call_logs[0];
  assert.equal(log.fub_status, 'created');
  assert.equal(log.fub_person_id, 5000);
  assert.equal(log.sms_status, 'sent');
  assert.equal(log.email_status, 'sent');
  assert.ok(log.transcript.includes('Priya'));
});

test('EXISTING CLIENT + URGENT: matches on phone, adds note and call, merges tags, assigns Aaron, urgent at top', async () => {
  const s = installFakes({ fubPeople: EXISTING });
  const out = await (await postCall(webhookReq('/api/ulio-post-call', fixture('existing-seller-urgent.json')))).json();
  assert.equal(out.fub, 'matched');
  assert.ok(!s.fub.some((c) => c.path === '/v1/events'), 'no duplicate lead event for an existing contact');
  const put = s.fub.find((c) => c.method === 'PUT');
  assert.equal(put.path, '/v1/people/321?mergeTags=true');
  assert.ok(put.body.tags.includes('Urgent'));
  assert.equal(put.body.assignedUserId, 7);
  const n = s.fub.find((c) => c.path === '/v1/notes');
  assert.equal(n.body.personId, 321);
  assert.match(n.body.subject, /URGENT/);
  assert.match(n.body.body, /Counter offer expires 6 pm today/);
  assert.ok(s.fub.some((c) => c.path === '/v1/calls' && c.body.personId === 321));
  assert.match(s.sms[0].Body, /^URGENT CALL\nMark Chen 780\.555\.0222/);
  assert.match(s.email[0].subject, /^\[URGENT\]/);
  assert.match(s.email[0].html, /URGENT: Counter offer expires 6 pm today/);
});

test('existing contact already assigned to someone else keeps that assignment', async () => {
  const s = installFakes({ fubPeople: [{ ...EXISTING[0], assignedUserId: 99 }] });
  await postCall(webhookReq('/api/ulio-post-call', fixture('existing-seller-urgent.json')));
  const put = s.fub.find((c) => c.method === 'PUT');
  assert.equal(put.body.assignedUserId, undefined);
});

test('VIP: greeted by name, priority alert, kept out of FUB', async () => {
  const s = installFakes();
  const out = await (await postCall(webhookReq('/api/ulio-post-call', fixture('vip-scott.json')))).json();
  assert.equal(out.vip, true);
  assert.equal(out.fub, 'skipped_vip');
  assert.equal(s.fub.length, 0);
  assert.match(s.sms[0].Body, /^VIP CALL: Scott\nScott 587\.200\.4953/);
  assert.match(s.email[0].subject, /\[VIP\]/);
  assert.equal(s.tables.call_logs[0].urgency, 'high');
});

test('duplicate webhook delivery is processed once', async () => {
  const s = installFakes();
  await postCall(webhookReq('/api/ulio-post-call', fixture('new-buyer.json')));
  const again = await (await postCall(webhookReq('/api/ulio-post-call', fixture('new-buyer.json')))).json();
  assert.equal(again.duplicate, true);
  assert.equal(s.sms.length, 1);
  assert.equal(s.fub.filter((c) => c.path === '/v1/events').length, 1);
});

test('non-final lifecycle events are ignored', async () => {
  const s = installFakes();
  const out = await (await postCall(webhookReq('/api/ulio-post-call', { event: 'call_started', call: { call_id: 'x' } }))).json();
  assert.equal(out.ignored, 'call_started');
  assert.equal(s.tables.call_logs.length, 0);
});

test('declined recording consent drops the recording link', async () => {
  const s = installFakes();
  const p = fixture('new-buyer.json');
  p.call.call_analysis.custom_analysis_data.recording_consent = 'declined';
  await postCall(webhookReq('/api/ulio-post-call', p));
  assert.equal(s.tables.call_logs[0].recording_url, null);
});

test('FUB outage still logs the call and alerts Aaron', async () => {
  const s = installFakes();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u).includes('followupboss') ? new Response('down', { status: 503 }) : realFetch(u, i));
  const out = await (await postCall(webhookReq('/api/ulio-post-call', fixture('new-buyer.json')))).json();
  assert.equal(out.fub, 'error');
  assert.equal(s.sms.length, 1);
  assert.match(s.email[0].html, /SYNC FAILED/);
  globalThis.fetch = realFetch;
});

test('caller lookup flags VIPs and known FUB contacts', async () => {
  installFakes({ fubPeople: EXISTING });
  const vip = await (await lookup(webhookReq('/api/caller-lookup', { from_number: '+15872004953' }))).json();
  assert.equal(vip.dynamic_variables.is_vip, 'true');
  assert.equal(vip.dynamic_variables.vip_name, 'Scott');
  const known = await (await lookup(webhookReq('/api/caller-lookup', { from_number: '7805550222' }))).json();
  assert.equal(known.is_vip, 'false');
  assert.equal(known.known_contact, 'true');
  assert.equal(known.known_first_name, 'Mark');
  const stranger = await (await lookup(webhookReq('/api/caller-lookup', { from_number: '+14035550000' }))).json();
  assert.equal(stranger.known_contact, 'false');
});

test('priority alert texts Aaron mid-call', async () => {
  const s = installFakes();
  const out = await (await alert(webhookReq('/api/priority-alert', { args: { callback_number: '587.200.4953', reason: 'Wants a call back about tomorrow.' } }))).json();
  assert.equal(out.status, 'sent');
  assert.match(s.sms[0].Body, /^VIP ON AI LINE NOW: Scott 587\.200\.4953/);
});

test('admin: PIN login, add VIP, edit, list, lockout after 5 bad PINs', async () => {
  const s = installFakes();
  const req = (b) => new Request('https://x/api/vip-admin', { method: 'POST', headers: { 'x-nf-client-connection-ip': '1.2.3.4' }, body: JSON.stringify(b) });
  const login = await (await admin(req({ action: 'login', pin: '246810' }))).json();
  assert.equal(login.role, 'aaron');
  const add = await admin(req({ action: 'vip_save', token: login.token, vip: { display_name: 'Mom', phone: '780.555.0123', relationship: 'Family' } }));
  assert.equal(add.status, 200);
  assert.ok(s.tables.vip_contacts.some((v) => v.phone_e164 === '+17805550123' && v.sync_to_crm === false));
  const bad = await admin(req({ action: 'vip_save', token: login.token, vip: { display_name: 'X', phone: '12' } }));
  assert.equal(bad.status, 400);
  const list = await (await admin(req({ action: 'vip_list', token: login.token }))).json();
  assert.equal(list.vips.length, 2);
  assert.equal((await admin(req({ action: 'vip_list', token: 'forged.token' }))).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await admin(req({ action: 'login', pin: '000000' }))).status, 401);
  assert.equal((await admin(req({ action: 'login', pin: '107451' }))).status, 429);
});

test('admin privacy delete removes all call rows for a number', async () => {
  const s = installFakes();
  await postCall(webhookReq('/api/ulio-post-call', fixture('new-buyer.json')));
  const req = (b) => new Request('https://x/api/vip-admin', { method: 'POST', body: JSON.stringify(b) });
  const { token } = await (await admin(req({ action: 'login', pin: '107451' }))).json();
  const out = await (await admin(req({ action: 'privacy_delete', token, phone: '780-555-0111' }))).json();
  assert.equal(out.deleted, 1);
  assert.equal(s.tables.call_logs.length, 0);
});

test('payload normalizer handles both Ulio payload shapes', () => {
  const a = normalizeUlioPayload(fixture('new-buyer.json'));
  assert.equal(a.caller_phone_e164, '+17805550111');
  assert.equal(a.duration_seconds, 240);
  const b = normalizeUlioPayload(fixture('existing-seller-urgent.json'));
  assert.equal(b.caller_phone_e164, '+17805550222');
  assert.equal(b.duration_seconds, 190);
  assert.match(b.transcript, /^AI: Hi/);
  assert.equal(b.transfer_attempted, true);
});

test('urgency fallback catches deadlines when the AI did not classify', () => {
  const p = fixture('new-buyer.json');
  delete p.call.call_analysis.custom_analysis_data.urgency;
  p.call.call_analysis.call_summary = 'Caller says their offer expires tonight.';
  assert.equal(normalizeUlioPayload(p).urgency, 'urgent');
});

test('after-hours detection uses Edmonton time', () => {
  assert.equal(isAfterHours(new Date('2026-10-19T16:00:00Z')), false); // Mon 10:00 MDT
  assert.equal(isAfterHours(new Date('2026-10-20T04:30:00Z')), true);  // Mon 22:30 MDT
  assert.equal(isAfterHours(new Date('2026-10-18T18:00:00Z')), true);  // Sunday
  assert.equal(toE164('587.200.4953'), '+15872004953');
});
