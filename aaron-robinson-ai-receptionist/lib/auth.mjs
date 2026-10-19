import crypto from 'node:crypto';
import { safeEqual } from './util.mjs';

// Webhook calls from Ulio.ai carry a shared secret in a header or ?key= (whichever Ulio's webhook UI allows).
export function webhookAuthorized(req) {
  const secret = process.env.ULIO_WEBHOOK_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  const supplied = req.headers.get('x-ulio-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('key');
  return safeEqual(supplied, secret);
}

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars)');
  return s;
}

// Returns 'admin' (Scott), 'aaron', or null.
export function checkPin(pin) {
  const p = String(pin || '');
  if (process.env.ADMIN_PIN && safeEqual(p, process.env.ADMIN_PIN)) return 'admin';
  if (process.env.AARON_PIN && safeEqual(p, process.env.AARON_PIN)) return 'aaron';
  return null;
}

export function issueToken(role, hours = 8) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + hours * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  if (!safeEqual(sig, expect)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}
