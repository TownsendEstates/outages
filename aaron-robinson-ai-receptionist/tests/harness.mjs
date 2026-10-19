// In-memory fakes for Supabase REST, Follow Up Boss, Twilio and Resend, so the functions run end to end offline.

import fs from 'node:fs';

export function setEnv(extra = {}) {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc',
    ULIO_WEBHOOK_SECRET: 'test-secret', ADMIN_PIN: '107451', AARON_PIN: '246810',
    SESSION_SECRET: 'x'.repeat(40), SITE_URL: 'https://ai-line.example.com',
    FUB_API_KEY: 'fubkey', FUB_X_SYSTEM: 'RadicalRobinsonAI', FUB_ASSIGNED_USER_ID: '7',
    AARON_ALERT_PHONE: '+17805550999', AARON_ALERT_EMAIL: 'aaron@example.com',
    TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+15875550000',
    RESEND_API_KEY: 're', ALERT_FROM_EMAIL: 'AI Line <ailine@example.com>', ...extra
  });
}

export function fixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

export function installFakes({ fubPeople = [] } = {}) {
  const state = {
    tables: {
      vip_contacts: [{ id: 'vip-1', display_name: 'Scott', full_name: 'Scott Townsend', relationship: 'Business partner', phone_e164: '+15872004953', priority: 'high', sync_to_crm: false, active: true }],
      call_logs: [], admin_audit: [],
      receptionist_settings: [{ id: 1, business_hours_tz: 'America/Edmonton', business_hours_start: '08:00', business_hours_end: '20:00', business_days: [1, 2, 3, 4, 5, 6], recording_retention_days: 90, transcript_retention_days: 730 }]
    },
    fubPeople: structuredClone(fubPeople), fub: [], sms: [], email: [], nextFubId: 5000
  };

  const filterRows = (rows, qs) => {
    let out = rows;
    for (const [k, v] of qs) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
      const [op, ...rest] = v.split('.'); const val = rest.join('.');
      out = out.filter((r) => {
        const cell = r[k];
        if (op === 'eq') return String(cell) === val;
        if (op === 'gte') return String(cell) >= val;
        return true;
      });
    }
    return out;
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const ok = (data, status = 200) => new Response(data === null ? '' : JSON.stringify(data), { status });

    if (url.host === 'fake.supabase.co') {
      const path = url.pathname.replace('/rest/v1/', '');
      if (path.startsWith('rpc/')) {
        if (path === 'rpc/delete_caller_data') {
          const before = state.tables.call_logs.length;
          state.tables.call_logs = state.tables.call_logs.filter((r) => r.caller_phone_e164 !== body.p_phone);
          return ok(before - state.tables.call_logs.length);
        }
        return ok(null, 204);
      }
      const t = state.tables[path];
      const qs = [...url.searchParams.entries()];
      if (method === 'GET') return ok(filterRows(t, qs));
      if (method === 'POST') {
        const conflict = url.searchParams.get('on_conflict');
        const existing = conflict && t.find((r) => r[conflict] === body[conflict]);
        if (existing) { Object.assign(existing, body); return ok([existing], 201); }
        const row = { id: `row-${t.length + 1}`, created_at: new Date().toISOString(), ...body };
        t.push(row); return ok([row], 201);
      }
      if (method === 'PATCH') { const rows = filterRows(t, qs); rows.forEach((r) => Object.assign(r, body)); return ok(rows); }
      if (method === 'DELETE') { const rows = filterRows(t, qs); state.tables[path] = t.filter((r) => !rows.includes(r)); return ok(null, 204); }
    }

    if (url.host === 'api.followupboss.com') {
      state.fub.push({ method, path: url.pathname + url.search, body, headers: init.headers });
      const p = url.pathname.replace('/v1', '');
      if (method === 'GET' && p === '/people') {
        const ten = url.searchParams.get('phone');
        return ok({ people: state.fubPeople.filter((x) => x.phones.some((ph) => ph.value.replace(/\D/g, '').endsWith(ten))) });
      }
      if (method === 'POST' && p === '/events') {
        const id = state.nextFubId++;
        state.fubPeople.push({ id, firstName: body.person.firstName, lastName: body.person.lastName, phones: body.person.phones, tags: body.person.tags, assignedUserId: body.person.assignedUserId });
        return ok({ id: 1, personId: id }, 201);
      }
      if (method === 'PUT' && p.startsWith('/people/')) return ok({ id: Number(p.split('/')[2]) });
      if (method === 'POST') return ok({ id: Math.floor(Math.random() * 1e6) }, 201);
      return ok({});
    }

    if (url.host === 'api.twilio.com') { state.sms.push(Object.fromEntries(new URLSearchParams(init.body))); return ok({ sid: 'SM1' }, 201); }
    if (url.host === 'api.resend.com') { state.email.push(body); return ok({ id: 'em1' }); }
    throw new Error('Unexpected fetch ' + url);
  };
  return state;
}

export function webhookReq(path, payload, secret = 'test-secret') {
  return new Request(`https://ai-line.example.com${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-ulio-secret': secret }, body: JSON.stringify(payload)
  });
}
