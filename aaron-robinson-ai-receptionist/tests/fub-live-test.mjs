// LIVE Follow Up Boss test. Run once Aaron's FUB API key is in place:
//   FUB_API_KEY=... FUB_ASSIGNED_USER_ID=... node tests/fub-live-test.mjs
// Step 1 sends a NEW caller (fictional 780-555-01xx number) and expects a lead created with source
// "Radical Robinson AI Line". Step 2 calls again from the same number and expects it to MATCH the
// existing contact and add a note and call. Optional: EXISTING_PHONE=7805551234 to test against a real
// existing contact instead. Pass --cleanup to delete the test lead afterwards.
import { syncCallToFub, findPersonByPhone } from '../lib/fub.mjs';

if (!process.env.FUB_API_KEY) { console.error('Set FUB_API_KEY first.'); process.exit(1); }
const testPhone = '+1780555' + String(100 + Math.floor(Math.random() * 99)).padStart(4, '0').slice(-4);
const base = {
  duration_seconds: 120, caller_email: 'ailine.test@example.com', property_or_area: 'Test area, Edmonton',
  timeline: '3 to 6 months', preapproval_status: 'in_progress', best_time_to_call: 'Evenings', urgency: 'normal',
  after_hours: false, appointment: null, next_step: 'TEST ONLY. Delete this contact.'
};
const links = { transcript: (process.env.SITE_URL || 'https://example.com') + '/admin/#call=LIVE-TEST' };

const r1 = await syncCallToFub({ ...base, caller_name: 'AI Line Test New', caller_phone_e164: testPhone, callback_phone_e164: testPhone,
  intent: 'buyer', summary: 'LIVE TEST 1 of 2: new caller should create a lead.' }, links);
console.log('Step 1 new caller:', r1);
if (r1.status !== 'created') console.warn('  Expected "created". If "ignored_by_lead_flow", check FUB Admin > Lead Flow for the source.');

const existingPhone = process.env.EXISTING_PHONE ? '+1' + process.env.EXISTING_PHONE.replace(/\D/g, '').slice(-10) : testPhone;
const r2 = await syncCallToFub({ ...base, caller_name: 'AI Line Test Existing', caller_phone_e164: existingPhone, callback_phone_e164: existingPhone,
  intent: 'existing_client', urgency: 'urgent', urgency_reason: 'LIVE TEST: urgent flag check',
  summary: 'LIVE TEST 2 of 2: existing caller should match and get a note.' }, links);
console.log('Step 2 existing caller:', r2);
if (r2.status !== 'matched') console.warn('  Expected "matched".');

if (process.argv.includes('--cleanup') && r1.personId) {
  const key = Buffer.from(`${process.env.FUB_API_KEY}:`).toString('base64');
  const res = await fetch(`https://api.followupboss.com/v1/people/${r1.personId}`, { method: 'DELETE', headers: { authorization: `Basic ${key}`, 'X-System': process.env.FUB_X_SYSTEM || 'RadicalRobinsonAI' } });
  console.log('Cleanup delete test lead:', res.status);
} else {
  const p = await findPersonByPhone(testPhone);
  console.log(`Open FUB and search ${testPhone} (person ${p?.id}) to check the timeline, tags, source and assignment.`);
}
