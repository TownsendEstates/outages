import crypto from 'node:crypto';

// Canadian / NANP numbers to E.164. Returns null if it cannot be parsed.
export function toE164(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 10) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

// 587.200.4953 style for SMS and email display
export function prettyPhone(e164) {
  if (!e164) return 'unknown number';
  const d = e164.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}` : e164;
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Is this moment outside Aaron's business hours? Settings come from receptionist_settings.
export function isAfterHours(date, settings) {
  const s = {
    business_hours_tz: 'America/Edmonton',
    business_hours_start: '08:00',
    business_hours_end: '20:00',
    business_days: [1, 2, 3, 4, 5, 6],
    ...(settings || {})
  };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: s.business_hours_tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const day = dayMap[get('weekday')];
  const mins = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  const toMins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  if (!s.business_days.includes(day)) return true;
  return mins < toMins(s.business_hours_start) || mins >= toMins(s.business_hours_end);
}

// Backup urgency check in case the AI's own classification is missing.
const URGENT_PATTERNS = [
  /offer (is )?(expir|due|deadline)/i, /expir(es|ing) (today|tonight|in)/i, /condition(s)? (removal|deadline|due)/i,
  /\bsubject removal\b/i, /\bpossession (today|tomorrow)\b/i, /\bclosing (today|tomorrow)\b/i,
  /\bcompeting offer\b/i, /\bmultiple offers\b/i, /\blocked out\b/i, /\bemergency\b/i, /\burgent\b/i, /\basap\b/i
];
export function fallbackUrgency(text) {
  if (!text) return 'normal';
  return URGENT_PATTERNS.some((r) => r.test(text)) ? 'urgent' : 'normal';
}

export function splitName(full) {
  const n = String(full || '').trim().replace(/\s+/g, ' ');
  if (!n) return { firstName: 'Unknown', lastName: 'Caller' };
  const parts = n.split(' ');
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || '' };
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
