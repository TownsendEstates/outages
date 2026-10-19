// Writes sample SMS and email alerts to ../notifications/samples so Scott and Aaron can review the exact output.
import fs from 'node:fs';
import { normalizeUlioPayload } from '../lib/normalize-payload.mjs';
import { renderSms, renderEmail } from '../lib/notify.mjs';

const dir = new URL('../notifications/samples/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const load = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const links = { transcript: 'https://ai-line-radicalrobinson.netlify.app/admin/#call=SAMPLE', fubStatus: 'New lead created' };
const cases = [
  ['new-lead', normalizeUlioPayload(load('new-buyer.json')), null],
  ['urgent-existing-client', normalizeUlioPayload(load('existing-seller-urgent.json')), null],
  ['vip', { ...normalizeUlioPayload(load('vip-scott.json')), urgency: 'high' }, { display_name: 'Scott', full_name: 'Scott Townsend' }]
];
for (const [name, rec, vip] of cases) {
  rec.after_hours = false;
  const l = { ...links, fubStatus: vip ? 'Not synced (VIP, personal)' : name === 'new-lead' ? 'New lead created' : 'Added to existing contact' };
  fs.writeFileSync(new URL(`${name}.sms.txt`, dir), renderSms(rec, vip, l) + '\n');
  const e = renderEmail(rec, vip, l);
  fs.writeFileSync(new URL(`${name}.email.html`, dir), `<!-- Subject: ${e.subject} -->\n${e.html}\n`);
}
console.log('Samples written to notifications/samples/');
