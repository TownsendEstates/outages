/* ================= SETTINGS (tenant customization), PLATFORM ADMIN, BOOT ================= */
const setTab = (k) => go('settings', k);
const saveSet = async (msg = 'Settings saved') => { await Store.saveTenant(); applyBranding(); toast(msg); };
VIEWS.settings = (el) => {
  const tab = S.sub || 'business';
  const T = [['business', 'Business & branding'], ['locations', 'Locations'], ['tax', 'Tax & fees'], ['pricing', 'Labour & pricing'], ['workflow', 'Workflow'], ['fields', 'Custom fields'], ['users', 'Users & roles'], ['modules', 'Modules'], ['billing', 'Subscription'], ['data', 'Data & privacy']];
  el.innerHTML = tabs(T, tab, 'setTab') + '<div id="stTab"></div>';
  const ed = can('settings', 'edit');
  SET[tab]($('#stTab'), ed);
  if (!ed) $$('#stTab input,#stTab select,#stTab textarea,#stTab button.primary').forEach((x) => (x.disabled = true));
};
const bindSet = (obj, k, num) => `onchange="(${obj})['${k}']=${num ? '+this.value' : 'this.value'};saveSet()"`;
const SET = {
  business(el) {
    const b = ST().branding;
    const f = (k, l, type = 'text') => `<div><label>${l}</label><input type="${type}" value="${esc(b[k] || '')}" ${bindSet('ST().branding', k)}></div>`;
    el.innerHTML = `<div class="card grid g2">${f('name', 'Business name (shown on documents)')}${f('phone', 'Phone')}${f('email', 'Email')}${f('website', 'Website')}<div style="grid-column:1/-1">${f('address', 'Address')}</div>${f('gstNo', 'GST/HST registration #')}${f('amvicNo', 'AMVIC business licence # (Alberta)')}
      ${f('logo', 'Logo URL (square, https)')}<div class="row"><div><label>Primary colour</label><input type="color" value="${esc(b.primary)}" ${bindSet('ST().branding', 'primary')} style="width:80px;height:38px"></div><div><label>Accent colour</label><input type="color" value="${esc(b.accent)}" ${bindSet('ST().branding', 'accent')} style="width:80px;height:38px"></div>
      <div><label>Theme</label><select ${bindSet('ST()', 'theme')}>${['auto', 'light', 'dark'].map((t) => `<option ${ST().theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      <div style="grid-column:1/-1"><label>Invoice footer / terms</label><textarea ${bindSet('ST().branding', 'invoiceFooter')}>${esc(b.invoiceFooter)}</textarea></div></div>
      <p class="small muted">Branding applies to the app, estimates, invoices, statements, pay stubs and customer messages: each tenant is fully white-labelled.</p>`;
  },
  locations(el) { listView(el, 'locations'); },
  tax(el) {
    const s = ST(), t = E.taxFor(s.province, s.taxOverride);
    el.innerHTML = `<div class="card grid g3"><div><label>Province</label><select ${bindSet('ST()', 'province')}>${PROVS.map((p) => `<option ${p === s.province ? 'selected' : ''}>${p}</option>`).join('')}</select><div class="small muted">${esc(t.label)}</div></div>
      <div><label>Tire recycling levy per new tire</label><input type="number" step="0.01" value="${s.envFeeTire}" ${bindSet('ST()', 'envFeeTire', 1)}><div class="small muted">AB (ARMA) passenger default $4.00</div></div>
      <div><label>Shop supplies % of labour</label><input type="number" step="0.1" value="${s.shopSuppliesPct}" ${bindSet('ST()', 'shopSuppliesPct', 1)}></div><div><label>Shop supplies cap ($)</label><input type="number" value="${s.shopSuppliesCap}" ${bindSet('ST()', 'shopSuppliesCap', 1)}></div>
      <div><label>Estimate tolerance %</label><input type="number" value="${s.estimateTolerancePct}" ${bindSet('ST()', 'estimateTolerancePct', 1)}></div><div><label>Estimate tolerance cap ($)</label><input type="number" value="${s.estimateToleranceCap}" ${bindSet('ST()', 'estimateToleranceCap', 1)}></div>
      <div><label>Overdue interest % per month</label><input type="number" step="0.1" value="${s.lateFeePctMonthly}" onchange="if(+this.value*12>=35){toast('Must stay well under the Criminal Code 35% APR limit','bad');this.value=ST().lateFeePctMonthly;return}ST().lateFeePctMonthly=+this.value;saveSet()"></div>
      <div><label>Tire storage fee (per season)</label><input type="number" value="${s.storageFee}" ${bindSet('ST()', 'storageFee', 1)}></div>
      <div><label class="row" style="color:var(--ink)"><input type="checkbox" ${s.taxOverride.enabled ? 'checked' : ''} onchange="ST().taxOverride.enabled=this.checked;saveSet();go('settings','tax')"> Custom tax rates</label>${s.taxOverride.enabled ? `<div class="row"><input type="number" step="0.0001" value="${s.taxOverride.gst}" title="GST/HST rate" ${bindSet('ST().taxOverride', 'gst', 1)}><input type="number" step="0.0001" value="${s.taxOverride.pst}" title="PST rate" ${bindSet('ST().taxOverride', 'pst', 1)}></div>` : ''}</div></div>
      <div class="flag small">Interest disclosed on invoices: ${s.lateFeePctMonthly}%/month = ${r2(s.lateFeePctMonthly * 12)}% per annum. The Criminal Code caps interest at 35% APR; Alberta consumer credit rules require the annual rate to be disclosed.</div>`;
  },
  pricing(el) {
    const s = ST();
    el.innerHTML = `<div class="card"><h3>Labour rates</h3>${s.labourRates.map((r, i) => `<div class="row" style="margin-bottom:6px"><input value="${esc(r.name)}" onchange="ST().labourRates[${i}].name=this.value;saveSet()" style="max-width:260px"><input type="number" step="0.01" value="${r.rate}" onchange="ST().labourRates[${i}].rate=+this.value;saveSet()" style="max-width:140px"><button class="btn sm danger" onclick="ST().labourRates.splice(${i},1);saveSet();go('settings','pricing')">✕</button></div>`).join('')}
      <button class="btn sm" onclick="ST().labourRates.push({name:'New rate',rate:0});saveSet();go('settings','pricing')">+ Rate</button></div>
      <div class="card grid g3" style="margin-top:12px"><div><label>Fleet markup over cost %</label><input type="number" value="${s.markups.fleet}" ${bindSet('ST().markups', 'fleet', 1)}></div><div><label>Wholesale markup over cost %</label><input type="number" value="${s.markups.wholesale}" ${bindSet('ST().markups', 'wholesale', 1)}></div><div><label>Target gross margin %</label><input type="number" value="${s.targetMargin}" ${bindSet('ST()', 'targetMargin', 1)}></div></div>
      <p class="small muted">Retail customers pay list price. Fleet and wholesale customers get cost-plus pricing automatically on work orders and POS. Special-order items are priced to the target margin.</p>`;
  },
  workflow(el) {
    const s = ST();
    const listEd = (key, title, hint) => `<div class="card"><h3>${title}</h3><p class="small muted">${hint}</p><textarea style="min-height:160px" onchange="ST().${key}=this.value.split('\\n').map(x=>x.trim()).filter(Boolean);saveSet()">${esc(s[key].join('\n'))}</textarea></div>`;
    el.innerHTML = `<div class="grid g2">${listEd('woStatuses', 'Work order statuses', 'One per line, in order. Keep "Invoiced" last.')}${listEd('inspection', 'Digital inspection checklist', 'One item per line. Make templates for fleet, tire-only or full multi-point.')}${listEd('dealStages', 'CRM deal stages', 'One per line. Keep "Won" and "Lost".')}${listEd('bays', 'Service bays', 'Used by the scheduler for capacity.')}</div>
      <div class="card grid g4" style="margin-top:12px"><div><label>WO prefix</label><input value="${esc(s.numbering.wo)}" ${bindSet('ST().numbering', 'wo')}></div><div><label>Invoice prefix</label><input value="${esc(s.numbering.inv)}" ${bindSet('ST().numbering', 'inv')}></div><div><label>PO prefix</label><input value="${esc(s.numbering.po)}" ${bindSet('ST().numbering', 'po')}></div><div><label>Next invoice #</label><input type="number" value="${s.numbering.next.inv}" ${bindSet('ST().numbering.next', 'inv', 1)}></div></div>`;
  },
  fields(el) {
    const cf = (ST().customFields ||= {});
    el.innerHTML = `<div class="card"><p class="muted">Add your own fields to any record. They show up on forms, lists, search and CSV import/export, and are stored per tenant without database changes.</p>
      ${Object.keys(ENTITIES).map((ent) => `<h3 style="margin-top:14px">${esc(ENTITIES[ent].label)}s</h3>${(cf[ent] || []).map((f, i) => `<div class="row" style="margin-bottom:6px"><span class="mono small" style="width:140px">${esc(f.k)}</span><b class="grow">${esc(f.label)}</b><span class="pill">${esc(f.type || 'text')}</span><button class="btn sm danger" onclick="ST().customFields['${ent}'].splice(${i},1);saveSet();go('settings','fields')">✕</button></div>`).join('') || '<div class="small muted">None</div>'}
        <div class="row"><input placeholder="Field label" id="cfl_${ent}" style="max-width:240px"><select id="cft_${ent}" style="width:auto">${['text', 'number', 'money', 'date', 'bool', 'select', 'textarea'].map((t) => `<option>${t}</option>`).join('')}</select><input placeholder="Options (comma) for select" id="cfo_${ent}" style="max-width:240px"><button class="btn sm" onclick="addField('${ent}')">+ Add</button></div>`).join('')}</div>`;
  },
  users(el) {
    const p = (ST().perms ||= defaultPerms());
    const staff = Store.list('staff');
    el.innerHTML = `<div class="card"><div class="row"><h3 class="grow">Staff logins</h3><button class="btn primary sm" onclick="staffEdit()">+ User</button></div>
      <table class="t"><tr><th>Name</th><th>Role</th><th>Login</th><th>Active</th><th></th></tr>${staff.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${u.email ? esc(u.email) : '<span class="muted">PIN</span>'}</td><td>${u.active !== false ? '✓' : ''}</td><td><button class="btn sm" onclick="staffEdit('${u.id}')">Edit</button></td></tr>`).join('')}</table>
      <p class="small muted">${DEMO ? 'Demo mode uses PIN logins.' : 'Cloud mode: users are invited by email (Supabase Auth) and linked to this shop with their role.'} Plan limit: ${PLANS[S.tenant.plan_id].users} users.</p></div>
      <div class="card tablewrap" style="margin-top:12px"><h3>Role permissions</h3><table class="t"><tr><th>Module</th>${ROLES.map((r) => `<th>${esc(r)}</th>`).join('')}</tr>${MODULES.filter((m) => m.k !== 'platform').map((m) => `<tr><td>${esc(m.label)}</td>${ROLES.map((r) => `<td><select style="width:auto;padding:3px" onchange="ST().perms['${r}']['${m.k}']=this.value;saveSet()" ${r === 'owner' ? 'disabled' : ''}>${['none', 'view', 'edit'].map((l) => `<option ${p[r]?.[m.k] === l ? 'selected' : ''}>${l}</option>`).join('')}</select></td>`).join('')}</tr>`).join('')}</table>
      <button class="btn sm" style="margin-top:8px" onclick="ST().perms=defaultPerms();saveSet();go('settings','users')">Reset to defaults</button></div>`;
  },
  modules(el) {
    const plan = PLANS[S.tenant.plan_id];
    el.innerHTML = `<div class="card"><p class="muted">Turn modules off to simplify the app for your team. Modules outside your plan are shown locked.</p>${MODULES.filter((m) => !['platform', 'settings', 'dashboard'].includes(m.k)).map((m) => { const inPlan = plan.modules.includes(m.k); return `<label class="row" style="color:var(--ink);font-size:14px;padding:4px 0"><input type="checkbox" ${inPlan && ST().modules[m.k] !== false ? 'checked' : ''} ${inPlan ? '' : 'disabled'} onchange="ST().modules['${m.k}']=this.checked;saveSet();renderShell()"> ${m.icon} ${esc(m.label)} ${inPlan ? '' : '<span class="pill warn">upgrade</span>'}</label>`; }).join('')}</div>`;
  },
  billing(el) {
    el.innerHTML = `<div class="grid g4">${Object.entries(PLANS).map(([k, p]) => `<div class="card" style="${k === S.tenant.plan_id ? 'border-color:var(--brand);border-width:2px' : ''}"><h3>${esc(p.name)}</h3><div class="kpi"><div class="v">${p.price ? money(p.price) : 'Quote'}</div><div class="l">${p.price ? 'per location / month' : 'banner & distributor groups'}</div></div>
      <ul class="small" style="padding-left:18px">${[`${p.users} users`, `AI: ${p.ai < 0 ? 'unlimited' : p.ai + '/mo'}`, `Integrations: ${p.connectors < 0 ? 'unlimited' : p.connectors}`, ...['accounting', 'payroll', 'crm', 'storage'].filter((m) => p.modules.includes(m)).map((m) => MODULES.find((x) => x.k === m).label)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${k === S.tenant.plan_id ? '<span class="pill good">Current plan</span>' : `<button class="btn primary sm" onclick="upgrade('${k}')">${p.price ? 'Switch' : 'Contact sales'}</button>`}</div>`).join('')}</div>
      <p class="small muted">Status: ${statusPill(S.tenant.status)} · Prices in CAD plus GST/HST. Billing runs through Stripe; cancel anytime.</p>`;
  },
  data(el) {
    el.innerHTML = `<div class="card"><h3>Export</h3><p class="muted">Download all of this tenant's data (JSON). You own your data.</p><button class="btn" onclick="exportAll()">Download full backup</button>
      <h3 style="margin-top:16px">Privacy (PIPA / PIPEDA)</h3><ul class="small"><li>Cloud data is hosted in Canada (Supabase ca-central-1), isolated per tenant by row-level security, with every change written to an audit log.</li><li>SINs are masked in the UI and restricted to owner, manager and accountant roles.</li><li>Customer access requests: use "Export customer" on the customer record (or this backup) to respond within 45 days.</li><li>Breaches posing a real risk of significant harm must be reported to the Alberta OIPC and affected people without unreasonable delay.</li></ul>
      ${DEMO ? `<h3 style="margin-top:16px">Demo data</h3><button class="btn danger" onclick="resetDemo()">Reset demo to sample data</button>` : ''}</div>`;
  },
};
function addField(ent) {
  const label = $('#cfl_' + ent).value.trim(); if (!label) return;
  const type = $('#cft_' + ent).value, k = 'x_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  (ST().customFields[ent] ||= []).push({ k, label, type, options: type === 'select' ? ['', ...$('#cfo_' + ent).value.split(',').map((x) => x.trim()).filter(Boolean)] : undefined });
  saveSet('Field added'); go('settings', 'fields');
}
function staffEdit(id) {
  const u = id ? Store.get('staff', id) : { role: 'advisor', active: true };
  if (!id && Store.list('staff').filter((x) => x.active !== false).length >= PLANS[S.tenant.plan_id].users) return toast('User limit reached for your plan', 'bad');
  modal(id ? 'Edit user' : 'New user', `<div class="grid g2"><div><label>Name</label><input id="sun" value="${esc(u.name || '')}"></div><div><label>Role</label><select id="sur">${ROLES.map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    <div><label>${DEMO ? 'PIN (4-8 digits)' : 'Quick-switch PIN (optional)'}</label><input id="sup" type="password" inputmode="numeric" placeholder="${id ? 'unchanged' : ''}"></div><div><label>Email ${DEMO ? '(optional)' : '(sends invite)'}</label><input id="sue" type="email" value="${esc(u.email || '')}"></div>
    <label class="row" style="color:var(--ink)"><input type="checkbox" id="sua" ${u.active !== false ? 'checked' : ''}> Active</label></div>`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: async () => {
      const pin = $('#sup').value;
      if (pin && !/^\d{4,8}$/.test(pin)) { toast('PIN must be 4-8 digits', 'bad'); return true; }
      if (pin && (Store.list('staff').some((x) => x.id !== id && x.pin_hash === pinHash(pin)) || pin === CFG.defaultAdminPin)) { toast('PIN already in use', 'bad'); return true; }
      if (DEMO && !id && !pin) { toast('Set a PIN', 'bad'); return true; }
      if (!DEMO) {
        if (!$('#sue').value) { toast('Email required to invite a user', 'bad'); return true; }
        try { await api('members', { email: $('#sue').value, role: $('#sur').value, name: $('#sun').value, active: $('#sua').checked }); toast('Invite sent'); }
        catch (e) { toast(e.message, 'bad'); return true; }
      }
      await Store.save('staff', { ...u, name: $('#sun').value, role: $('#sur').value, email: $('#sue').value, active: $('#sua').checked, ...(pin ? { pin_hash: pinHash(pin) } : {}) });
      toast('User saved'); go('settings', 'users');
    } }], { narrow: true });
}
async function upgrade(plan) {
  if (!PLANS[plan].price) return modal('Distribution / Banner', '<p>Multi-store groups, banners and distributors get group admin, consolidated reporting and a dealer B2B portal. Contact sales for a quote.</p>', [{ label: 'Close' }], { narrow: true });
  if (DEMO) { S.tenant.plan_id = plan; await Store.saveTenant(); toast(`Demo: switched to ${PLANS[plan].name}`); return go('settings', 'billing'); }
  try { const r = await api('billing', { planId: plan }); location.href = r.url; } catch (e) { toast(e.message, 'bad'); }
}
function exportAll() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ tenant: S.tenant, data: S.data }, null, 2)], { type: 'application/json' })); a.download = `${S.tenant.slug || 'shop'}-backup-${today()}.json`; a.click(); }
async function resetDemo() { if (await confirmBox('Erase all demo changes and reload sample data?')) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } S.root = seedDemo(); Store.persistDemo(); logout(); } }

// ---------------- Platform admin (SaaS operator) ----------------
VIEWS.platform = (el) => {
  const ts = S.root.tenants;
  const mrr = ts.filter((t) => t.status === 'active').reduce((a, t) => a + (PLANS[t.plan_id]?.price || 0) * Math.max(1, (DEMO ? S.root.data[t.id]?.locations?.length : 1) || 1), 0);
  el.innerHTML = `<div class="grid g4"><div class="card kpi"><div class="l">Tenants</div><div class="v">${ts.length}</div></div><div class="card kpi"><div class="l">Active MRR (CAD)</div><div class="v">${money(mrr)}</div></div><div class="card kpi"><div class="l">ARR run-rate</div><div class="v">${money(mrr * 12)}</div></div><div class="card kpi"><div class="l">In trial</div><div class="v">${ts.filter((t) => t.status === 'trial').length}</div></div></div>
    <div class="row" style="margin:12px 0"><span class="grow"></span><button class="btn primary" onclick="newTenant()">+ New tenant</button></div>
    <div class="card tablewrap" style="padding:0"><table class="t"><tr><th>Tenant</th><th>Province</th><th>Plan</th><th>Status</th><th class="num">Locations</th><th class="num">Invoices</th><th>Created</th><th></th></tr>${ts.map((t) => { const d = DEMO ? S.root.data[t.id] || {} : t.id === S.tenant.id ? S.data : {}; return `<tr><td><b>${esc(t.name)}</b><div class="small muted mono">${esc(t.id)}</div></td><td>${esc(t.province)}</td>
      <td><select style="width:auto" onchange="tenantSet('${t.id}','plan_id',this.value)">${Object.keys(PLANS).map((p) => `<option value="${p}" ${p === t.plan_id ? 'selected' : ''}>${esc(PLANS[p].name)}</option>`).join('')}</select></td>
      <td><select style="width:auto" onchange="tenantSet('${t.id}','status',this.value)">${['trial', 'active', 'past_due', 'suspended', 'cancelled'].map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td class="num">${d.locations?.length ?? '-'}</td><td class="num">${d.invoices?.length ?? '-'}</td><td>${fdate(t.created_at)}</td><td><button class="btn sm" onclick="switchTenant('${t.id}')">Enter</button></td></tr>`; }).join('')}</table></div>
    <div class="card" style="margin-top:12px"><h3>Plan entitlements</h3><div class="tablewrap"><table class="t"><tr><th>Module</th>${Object.values(PLANS).map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr>${MODULES.filter((m) => m.k !== 'platform').map((m) => `<tr><td>${esc(m.label)}</td>${Object.values(PLANS).map((p) => `<td>${p.modules.includes(m.k) ? '✓' : ''}</td>`).join('')}</tr>`).join('')}</table></div></div>`;
};
async function tenantSet(id, k, v) {
  const t = S.root.tenants.find((x) => x.id === id); t[k] = v;
  if (DEMO) Store.persistDemo(); else { const { error } = await S.sb.from('tenants').update({ [k]: v }).eq('id', id); if (error) return toast(error.message, 'bad'); }
  toast('Tenant updated'); if (id === S.tenant.id) renderShell();
}
function newTenant() {
  modal('New tenant', `<div class="grid g2"><div><label>Business name</label><input id="ntn"></div><div><label>Province</label><select id="ntp">${PROVS.map((p) => `<option ${p === 'AB' ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div><label>Plan</label><select id="ntl">${Object.entries(PLANS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select></div><div><label>Owner PIN (demo) / email (cloud)</label><input id="nto"></div>
    <label class="row" style="color:var(--ink)"><input type="checkbox" id="nts" checked> Load sample data</label></div>`,
    [{ label: 'Cancel' }, { label: 'Create', cls: 'primary', onClick: async () => {
      const name = $('#ntn').value.trim(); if (!name) { toast('Name required', 'bad'); return true; }
      if (!DEMO) { const { data, error } = await S.sb.rpc('create_tenant', { p_name: name, p_province: $('#ntp').value, p_plan: $('#ntl').value }); if (error) { toast(error.message, 'bad'); return true; } const { data: t } = await S.sb.from('tenants').select('*').eq('id', data).single(); S.root.tenants.push(t); return go('platform'); }
      const t = { id: uid('ten'), name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), plan_id: $('#ntl').value, status: 'trial', province: $('#ntp').value, created_at: new Date().toISOString(), settings: defaultSettings(name, $('#ntp').value) };
      S.root.tenants.push(t);
      S.root.data[t.id] = $('#nts').checked ? seedTenant(t, {}) : Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
      if (!$('#nts').checked) S.root.data[t.id].accounts = DEFAULT_COA.map(([code, nm, type]) => ({ id: 'acc_' + code, code, name: nm, type }));
      const pin = $('#nto').value.trim();
      if (/^\d{4,8}$/.test(pin)) S.root.data[t.id].staff.push({ id: uid('sta'), name: name + ' Owner', role: 'owner', pin_hash: pinHash(pin), active: true });
      Store.persistDemo(); toast('Tenant created'); go('platform');
    } }], { narrow: true });
}

// ---------------- Boot ----------------
(async function start() {
  if (DEMO) { Store.loadDemo(); renderLogin(); return; }
  try {
    await loadSupabase();
    S.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    const { data } = await S.sb.auth.getSession();
    if (data.session) { S.session = data.session; await cloudEnter(); } else renderLogin();
    S.sb.auth.onAuthStateChange((_e, sess) => { S.session = sess; });
  } catch (e) { $('#root').innerHTML = `<div class="flag bad" style="margin:20px">Could not reach the ShopStack cloud: ${esc(e.message)}</div>`; }
})();
</script>
</body>
</html>
