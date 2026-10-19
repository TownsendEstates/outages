// Minimal PostgREST client. Uses the service role key, so this file must only run server side.

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return { url: url.replace(/\/$/, ''), key };
}

async function rest(method, path, body, extraHeaders = {}) {
  const { url, key } = cfg();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...extraHeaders
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path} failed ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

export const db = {
  select: (table, query = '') => rest('GET', `${table}?${query}`),
  insert: (table, row) => rest('POST', table, row),
  upsert: (table, row, onConflict) =>
    rest('POST', `${table}?on_conflict=${onConflict}`, row, { prefer: 'return=representation,resolution=merge-duplicates' }),
  update: (table, query, patch) => rest('PATCH', `${table}?${query}`, patch),
  remove: (table, query) => rest('DELETE', `${table}?${query}`),
  rpc: (fn, args) => rest('POST', `rpc/${fn}`, args)
};

export async function findVip(phoneE164) {
  if (!phoneE164) return null;
  const rows = await db.select('vip_contacts', `phone_e164=eq.${encodeURIComponent(phoneE164)}&active=eq.true&limit=1`);
  return rows?.[0] || null;
}

export async function getSettings() {
  const rows = await db.select('receptionist_settings', 'id=eq.1');
  return rows?.[0] || null;
}

export async function audit(action, detail, ip) {
  try { await db.insert('admin_audit', { action, detail, actor_ip: ip || null }); } catch { /* audit must never break a call */ }
}
