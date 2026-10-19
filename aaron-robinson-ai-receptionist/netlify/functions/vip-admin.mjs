// POST /api/vip-admin
// Backend for admin/index.html. PIN login, then VIP list edits, call log viewing, settings and privacy deletes.
// Body: { action, token?, pin?, ...args }

import { db, audit } from '../../lib/supabase.mjs';
import { checkPin, issueToken, verifyToken } from '../../lib/auth.mjs';
import { toE164, json } from '../../lib/util.mjs';

const MAX_FAILS = 5;           // per IP
const LOCK_MINUTES = 15;

async function tooManyFails(ip) {
  const since = new Date(Date.now() - LOCK_MINUTES * 60 * 1000).toISOString();
  const rows = await db.select('admin_audit', `action=eq.login_failed&actor_ip=eq.${encodeURIComponent(ip)}&created_at=gte.${since}&select=id`);
  return (rows?.length || 0) >= MAX_FAILS;
}

function cleanVip(v) {
  const phone = toE164(v.phone_e164 || v.phone);
  if (!phone) throw new Error('Enter a valid 10 digit phone number');
  if (!String(v.display_name || '').trim()) throw new Error('Name is required');
  return {
    display_name: String(v.display_name).trim().slice(0, 60),
    full_name: v.full_name ? String(v.full_name).trim().slice(0, 120) : null,
    relationship: v.relationship ? String(v.relationship).trim().slice(0, 80) : null,
    phone_e164: phone,
    priority: v.priority === 'critical' ? 'critical' : 'high',
    sync_to_crm: Boolean(v.sync_to_crm),
    notes: v.notes ? String(v.notes).slice(0, 500) : null,
    active: v.active !== false
  };
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  const b = await req.json().catch(() => ({}));

  try {
    if (b.action === 'login') {
      if (await tooManyFails(ip)) return json(429, { error: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` });
      const role = checkPin(b.pin);
      if (!role) { await audit('login_failed', {}, ip); return json(401, { error: 'Wrong PIN' }); }
      await audit('login', { role }, ip);
      return json(200, { token: issueToken(role), role });
    }

    const session = verifyToken(b.token);
    if (!session) return json(401, { error: 'Session expired. Enter your PIN again.' });

    switch (b.action) {
      case 'vip_list':
        return json(200, { vips: await db.select('vip_contacts', 'order=display_name.asc') });
      case 'vip_save': {
        const row = cleanVip(b.vip || {});
        const out = b.vip?.id
          ? await db.update('vip_contacts', `id=eq.${encodeURIComponent(b.vip.id)}`, row)
          : await db.insert('vip_contacts', row);
        await audit(b.vip?.id ? 'vip_update' : 'vip_add', { name: row.display_name, last4: row.phone_e164.slice(-4), by: session.role }, ip);
        return json(200, { vip: out[0] });
      }
      case 'vip_delete':
        await db.remove('vip_contacts', `id=eq.${encodeURIComponent(b.id)}`);
        await audit('vip_delete', { id: b.id, by: session.role }, ip);
        return json(200, { ok: true });
      case 'calls_list': {
        const cols = 'id,created_at,caller_name,caller_phone_e164,intent,urgency,is_vip,after_hours,summary,next_step,fub_status,sms_status,email_status,appointment';
        return json(200, { calls: await db.select('call_logs', `select=${cols}&order=created_at.desc&limit=${Math.min(Number(b.limit) || 50, 200)}`) });
      }
      case 'call_get': {
        const rows = await db.select('call_logs', `id=eq.${encodeURIComponent(b.id)}&select=*`);
        if (rows?.[0]) delete rows[0].raw_payload;
        return json(200, { call: rows?.[0] || null });
      }
      case 'settings_get':
        return json(200, { settings: (await db.select('receptionist_settings', 'id=eq.1'))[0] });
      case 'settings_save': {
        const s = b.settings || {};
        const patch = {};
        for (const k of ['business_hours_start', 'business_hours_end']) if (/^\d{2}:\d{2}$/.test(s[k] || '')) patch[k] = s[k];
        if (Array.isArray(s.business_days)) patch.business_days = s.business_days.map(Number).filter((d) => d >= 1 && d <= 7);
        for (const k of ['recording_retention_days', 'transcript_retention_days']) {
          const n = Number(s[k]); if (Number.isInteger(n) && n >= 1 && n <= 3650) patch[k] = n;
        }
        patch.updated_at = new Date().toISOString();
        const out = await db.update('receptionist_settings', 'id=eq.1', patch);
        await audit('settings_save', { ...patch, by: session.role }, ip);
        return json(200, { settings: out[0] });
      }
      case 'privacy_delete': {
        const phone = toE164(b.phone);
        if (!phone) return json(400, { error: 'Enter a valid phone number' });
        const n = await db.rpc('delete_caller_data', { p_phone: phone });
        return json(200, { deleted: n, reminder: 'Also delete this person in Follow Up Boss and in the Ulio.ai call history.' });
      }
      default:
        return json(400, { error: 'unknown action' });
    }
  } catch (e) {
    return json(400, { error: String(e.message || e) });
  }
};

export const config = { path: '/api/vip-admin' };
