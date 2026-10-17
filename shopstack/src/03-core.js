/* ================= CORE: config, utilities, store, auth, shell ================= */
const CFG = Object.assign({ supabaseUrl: '', supabaseAnonKey: '', api: '/.netlify/functions', defaultAdminPin: '107451' }, window.SHOPSTACK_CONFIG || {});
const DEMO = !CFG.supabaseUrl;
const S = { root: null, tenant: null, user: null, data: {}, view: 'dashboard', sub: null, loc: 'all', sb: null, session: null, chat: [] };
const E = Engine, r2 = E.r2;

// ---------- utilities ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = 'id') => p.slice(0, 3) + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const money = (n) => (Number(n) || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
const num = (n, d = 0) => (Number(n) || 0).toLocaleString('en-CA', { maximumFractionDigits: d, minimumFractionDigits: d });
const fdate = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const hash = (str, seed = 7) => { let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); };
const pinHash = (pin, salt = 'shopstack') => hash(salt + ':' + pin, 31);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3000);
}
function modal(title, body, buttons = [], opts = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="box ${opts.narrow ? 'narrow' : ''}"><header><h2>${esc(title)}</h2><button class="btn sm" onclick="closeModal()" aria-label="Close">✕</button></header>
    <div class="body">${body}</div>${buttons.length ? `<footer>${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-mb="${i}">${esc(b.label)}</button>`).join('')}</footer>` : ''}</div>`;
  m.classList.add('on');
  buttons.forEach((b, i) => { $(`[data-mb="${i}"]`, m).onclick = async () => { const keep = await b.onClick?.(m); if (keep !== true) closeModal(); }; });
  m.onclick = (e) => { if (e.target === m && !opts.sticky) closeModal(); };
  setTimeout(() => $('input,select,textarea', m)?.focus(), 30);
  return m;
}
function closeModal() { $('#modal').classList.remove('on'); $('#modal').innerHTML = ''; }
function confirmBox(msg) { return new Promise((res) => modal('Please confirm', `<p>${esc(msg)}</p>`, [{ label: 'Cancel', onClick: () => res(false) }, { label: 'Confirm', cls: 'primary', onClick: () => res(true) }], { narrow: true })); }
function readForm(el) {
  const o = {};
  $$('[data-k]', el).forEach((i) => {
    const k = i.dataset.k;
    if (i.type === 'checkbox') o[k] = i.checked;
    else if (i.type === 'number' || i.dataset.num) o[k] = i.value === '' ? null : Number(i.value);
    else o[k] = i.value;
  });
  return o;
}
function csvDownload(name, rows) {
  if (!rows.length) return toast('Nothing to export');
  const cols = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object');
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name + '.csv'; a.click();
}
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase().replace(/\s+/g, '_'), (r[i] || '').trim()])));
}

// ---------- plans, modules, roles ----------
const PLANS = {
  starter: { name: 'Starter', price: 149, users: 3, ai: 50, connectors: 2, modules: ['dashboard', 'workorders', 'pos', 'schedule', 'customers', 'vehicles', 'timeclock', 'inventory', 'purchasing', 'integrations', 'ai', 'reports', 'settings'] },
  pro: { name: 'Pro', price: 299, users: 15, ai: 500, connectors: -1, modules: ['dashboard', 'workorders', 'pos', 'schedule', 'customers', 'vehicles', 'storage', 'timeclock', 'inventory', 'purchasing', 'integrations', 'accounting', 'crm', 'ai', 'reports', 'settings'] },
  enterprise: { name: 'Enterprise', price: 549, users: 100, ai: -1, connectors: -1, modules: ['dashboard', 'workorders', 'pos', 'schedule', 'customers', 'vehicles', 'storage', 'timeclock', 'inventory', 'purchasing', 'integrations', 'accounting', 'payroll', 'crm', 'ai', 'reports', 'settings'] },
  distribution: { name: 'Distribution / Banner', price: 0, users: 1000, ai: -1, connectors: -1, modules: ['dashboard', 'workorders', 'pos', 'schedule', 'customers', 'vehicles', 'storage', 'timeclock', 'inventory', 'purchasing', 'integrations', 'accounting', 'payroll', 'crm', 'ai', 'reports', 'settings'] },
};
const MODULES = [
  { k: 'dashboard', label: 'Dashboard', icon: '▦', sec: 'Shop' },
  { k: 'workorders', label: 'Work Orders', icon: '🔧', sec: 'Shop' },
  { k: 'pos', label: 'Point of Sale', icon: '🧾', sec: 'Shop' },
  { k: 'schedule', label: 'Schedule', icon: '📅', sec: 'Shop' },
  { k: 'customers', label: 'Customers', icon: '👤', sec: 'Shop' },
  { k: 'vehicles', label: 'Vehicles', icon: '🚗', sec: 'Shop' },
  { k: 'storage', label: 'Tire Storage', icon: '🛞', sec: 'Shop' },
  { k: 'timeclock', label: 'Time Clock', icon: '⏱', sec: 'Shop' },
  { k: 'inventory', label: 'Inventory', icon: '📦', sec: 'Supply' },
  { k: 'purchasing', label: 'Purchasing', icon: '🛒', sec: 'Supply' },
  { k: 'integrations', label: 'Vendors & Integrations', icon: '🔌', sec: 'Supply' },
  { k: 'accounting', label: 'Accounting', icon: '📒', sec: 'Back Office' },
  { k: 'payroll', label: 'Payroll', icon: '💵', sec: 'Back Office' },
  { k: 'crm', label: 'CRM', icon: '🤝', sec: 'Back Office' },
  { k: 'ai', label: 'AI Assistant', icon: '✨', sec: 'Insights' },
  { k: 'reports', label: 'Reports', icon: '📊', sec: 'Insights' },
  { k: 'settings', label: 'Settings', icon: '⚙', sec: 'Admin' },
  { k: 'platform', label: 'Platform Admin', icon: '🏢', sec: 'Admin' },
];
const ROLES = ['owner', 'manager', 'advisor', 'technician', 'accountant', 'sales', 'viewer'];
function defaultPerms() {
  const all = (lvl) => Object.fromEntries(MODULES.map((m) => [m.k, lvl]));
  const p = { owner: all('edit'), manager: all('edit'), viewer: all('view') };
  p.manager.platform = 'none'; p.owner.platform = 'none';
  Object.assign(p.viewer, { payroll: 'none', settings: 'none', platform: 'none', timeclock: 'none' });
  p.advisor = Object.assign(all('none'), { dashboard: 'view', workorders: 'edit', pos: 'edit', schedule: 'edit', customers: 'edit', vehicles: 'edit', storage: 'edit', timeclock: 'edit', inventory: 'view', purchasing: 'edit', integrations: 'view', crm: 'edit', ai: 'edit', reports: 'view' });
  p.technician = Object.assign(all('none'), { dashboard: 'view', workorders: 'edit', schedule: 'view', vehicles: 'view', storage: 'view', timeclock: 'edit', inventory: 'view', ai: 'edit' });
  p.accountant = Object.assign(all('none'), { dashboard: 'view', customers: 'view', inventory: 'view', purchasing: 'view', accounting: 'edit', payroll: 'edit', timeclock: 'view', ai: 'edit', reports: 'edit' });
  p.sales = Object.assign(all('none'), { dashboard: 'view', customers: 'edit', vehicles: 'view', crm: 'edit', pos: 'edit', schedule: 'edit', ai: 'edit', reports: 'view', timeclock: 'edit' });
  return p;
}
function can(mod, lvl = 'view') {
  if (!S.user) return false;
  if (mod === 'platform') return !!S.user.platform;
  const plan = PLANS[S.tenant?.plan_id] || PLANS.starter;
  if (!plan.modules.includes(mod)) return false;
  if (S.tenant.settings.modules?.[mod] === false) return false;
  if (S.user.platform) return true;
  const p = (S.tenant.settings.perms || defaultPerms())[S.user.role]?.[mod] || 'none';
  return lvl === 'view' ? p !== 'none' : p === 'edit';
}

// ---------- default tenant settings ----------
const DEFAULT_COA = [
  ['1000', 'Bank - Chequing', 'asset'], ['1010', 'Cash on Hand', 'asset'], ['1020', 'Card Clearing', 'asset'], ['1100', 'Accounts Receivable', 'asset'],
  ['1200', 'Inventory - Tires', 'asset'], ['1210', 'Inventory - Parts', 'asset'], ['1500', 'Shop Equipment', 'asset'], ['1510', 'Accumulated Depreciation', 'asset'],
  ['2000', 'Accounts Payable', 'liability'], ['2100', 'Customer Deposits', 'liability'], ['2200', 'GST/HST Payable', 'liability'], ['2205', 'GST/HST Input Tax Credits', 'liability'],
  ['2210', 'PST/QST Payable', 'liability'], ['2220', 'Tire Recycling Levy Payable', 'liability'], ['2300', 'Payroll Liabilities - CRA', 'liability'], ['2310', 'Vacation Pay Payable', 'liability'],
  ['3000', "Owner's Equity", 'equity'], ['3100', 'Retained Earnings', 'equity'],
  ['4000', 'Labour Revenue', 'revenue'], ['4100', 'Parts Sales', 'revenue'], ['4200', 'Tire Sales', 'revenue'], ['4300', 'Shop Supplies & Fees', 'revenue'], ['4400', 'Tire Storage Revenue', 'revenue'], ['4900', 'Discounts Given', 'revenue'],
  ['5000', 'COGS - Tires', 'cogs'], ['5010', 'COGS - Parts', 'cogs'],
  ['6000', 'Wages & Salaries', 'expense'], ['6010', 'Employer CPP/EI', 'expense'], ['6100', 'Rent', 'expense'], ['6200', 'Utilities', 'expense'], ['6300', 'Insurance', 'expense'],
  ['6400', 'Advertising & Marketing', 'expense'], ['6500', 'Software & Subscriptions', 'expense'], ['6600', 'Shop Supplies Expense', 'expense'], ['6700', 'Bank & Card Fees', 'expense'],
  ['6800', 'Repairs & Maintenance', 'expense'], ['6900', 'Office & Admin', 'expense'], ['6950', 'Vehicle & Fuel', 'expense'],
];
const DEFAULT_INSPECTION = ['Tire tread depth (LF/RF/LR/RR)', 'Tire pressure / TPMS', 'Brake pads & rotors - front', 'Brake pads & rotors - rear', 'Suspension & steering', 'Wheel bearings', 'Battery & charging', 'Belts & hoses', 'Engine oil & filter', 'Coolant / antifreeze', 'Wipers & washer fluid', 'Lights & signals', 'Exhaust', 'CV boots / axles', 'Wheel torque & lug nuts'];
function defaultSettings(name, province = 'AB') {
  return {
    branding: { name, logo: '', primary: '#0F766E', accent: '#F59E0B', invoiceFooter: 'Thank you for your business!', gstNo: '', amvicNo: '', phone: '', email: '', address: '', website: '' },
    province, taxOverride: { enabled: false, gst: 0.05, pst: 0, label: '' },
    labourRates: [{ name: 'Standard', rate: 145 }, { name: 'Diagnostic', rate: 165 }, { name: 'Fleet', rate: 125 }, { name: 'Tire install (per tire)', rate: 0 }],
    markups: { fleet: 22, wholesale: 12 }, targetMargin: 30,
    shopSuppliesPct: 5, shopSuppliesCap: 40, envFeeTire: 4.0, storageFee: 89,
    estimateTolerancePct: 10, estimateToleranceCap: 100,
    lateFeePctMonthly: 2, termsDays: 30,
    woStatuses: ['Estimate', 'Awaiting Approval', 'Approved', 'In Progress', 'Waiting Parts', 'Ready for Pickup', 'Invoiced'],
    dealStages: ['Lead', 'Qualified', 'Quote Sent', 'Negotiation', 'Won', 'Lost'],
    inspection: DEFAULT_INSPECTION.slice(),
    customFields: {}, modules: {}, perms: defaultPerms(),
    numbering: { wo: 'WO-', inv: 'INV-', po: 'PO-', est: 'EST-', next: { wo: 1001, inv: 5001, po: 301 } },
    payrollYear: 2026, payrollPeriods: 26, payrollTables: null,
    bays: ['Bay 1', 'Bay 2', 'Bay 3', 'Alignment'], hours: { open: '08:00', close: '17:30' },
    lock_date: '', lang: 'en', theme: 'auto',
  };
}
const ST = () => S.tenant.settings;
function nextNo(kind) {
  const n = ST().numbering;
  const v = n.next[kind] || 1;
  n.next[kind] = v + 1;
  Store.saveTenant();
  return (n[kind] || '') + v;
}

// ---------- store (demo: localStorage; cloud: Supabase) ----------
const COLLECTIONS = ['customers', 'vehicles', 'workorders', 'appointments', 'inventory', 'purchase_orders', 'vendors', 'invoices', 'payments', 'bills', 'journal', 'accounts', 'deals', 'activities', 'campaigns', 'tire_storage', 'bank_txns', 'locations', 'connectors', 'staff', 'employees', 'timesheets', 'payruns'];
const KEY = 'shopstack.demo';
const Store = {
  persistDemo: debounce(() => { if (!lsSet(KEY, JSON.stringify(S.root))) toast('Browser storage unavailable: demo changes will not survive a reload', 'bad'); }, 300),
  loadDemo() {
    let root = null;
    try { root = JSON.parse(lsGet(KEY) || 'null'); } catch { root = null; }
    if (!root || !root.tenants?.length) root = seedDemo();
    S.root = root;
  },
  bindTenant(t) {
    S.tenant = t;
    if (DEMO) S.data = S.root.data[t.id] ||= {};
    for (const c of COLLECTIONS) S.data[c] ||= [];
    applyBranding();
  },
  list: (col) => S.data[col] || (S.data[col] = []),
  get: (col, id) => Store.list(col).find((r) => r.id === id),
  async save(col, obj) {
    obj.id ||= uid(col);
    obj.updated_at = new Date().toISOString();
    obj.created_at ||= obj.updated_at;
    if (obj.location_id === undefined && S.loc !== 'all' && ['workorders', 'invoices', 'appointments', 'inventory', 'payments', 'purchase_orders'].includes(col)) obj.location_id = S.loc;
    const arr = Store.list(col), i = arr.findIndex((r) => r.id === obj.id);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
    if (DEMO) Store.persistDemo();
    else {
      const { error } = await S.sb.from(col).upsert({ id: obj.id, tenant_id: S.tenant.id, location_id: obj.location_id || null, data: obj });
      if (error) { toast(`Save failed (${col}): ${error.message}`, 'bad'); throw error; }
    }
    return obj;
  },
  async remove(col, id) {
    S.data[col] = Store.list(col).filter((r) => r.id !== id);
    if (DEMO) Store.persistDemo();
    else { const { error } = await S.sb.from(col).delete().eq('id', id); if (error) toast(error.message, 'bad'); }
  },
  async saveTenant() {
    if (DEMO) { Store.persistDemo(); return; }
    const { error } = await S.sb.from('tenants').update({ settings: S.tenant.settings, name: S.tenant.name, plan_id: S.tenant.plan_id, status: S.tenant.status }).eq('id', S.tenant.id);
    if (error) toast('Settings not saved: ' + error.message, 'bad');
  },
  async loadCloudTenant(t) {
    S.data = {};
    await Promise.all(COLLECTIONS.map(async (c) => {
      const { data, error } = await S.sb.from(c).select('id,location_id,data').eq('tenant_id', t.id).limit(10000);
      S.data[c] = error ? [] : data.map((r) => ({ ...r.data, id: r.id, location_id: r.location_id }));
    }));
    if (!S.data.accounts.length) for (const [code, name, type] of DEFAULT_COA) await Store.save('accounts', { id: 'acc_' + code, code, name, type });
  },
};
const accounts = () => Store.list('accounts').slice().sort((a, b) => a.code.localeCompare(b.code));
const accName = (code) => accounts().find((a) => a.code === code)?.name || code;
const custName = (id) => Store.get('customers', id)?.name || '';
const vehName = (id) => { const v = Store.get('vehicles', id); return v ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() : ''; };
const empName = (id) => Store.get('employees', id)?.name || '';
const inLoc = (r) => S.loc === 'all' || !r.location_id || r.location_id === S.loc;
async function postJournal(entry) {
  if (ST().lock_date && entry.date <= ST().lock_date) throw new Error(`Period locked through ${ST().lock_date}`);
  return Store.save('journal', { ...entry, id: uid('jnl') });
}

// ---------- API calls (AI + connectors) ----------
async function api(fn, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.session?.access_token) headers.Authorization = 'Bearer ' + S.session.access_token;
  const r = await fetch(`${CFG.api}/${fn}`, { method: 'POST', headers, body: JSON.stringify({ tenantId: S.tenant.id, ...body }) });
  const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// ---------- branding ----------
function applyBranding() {
  const b = S.tenant?.settings?.branding || {};
  const root = document.documentElement;
  root.style.setProperty('--brand', b.primary || '#0F766E');
  root.style.setProperty('--accent', b.accent || '#F59E0B');
  const th = S.tenant?.settings?.theme;
  if (th === 'light' || th === 'dark') root.dataset.theme = th; else delete root.dataset.theme;
  document.title = (b.name || S.tenant?.name || 'ShopStack') + ' · ShopStack';
}

// ---------- auth ----------
function renderLogin(msg = '') {
  $('#root').innerHTML = `<div id="login"><div class="card">
    <div class="logo" style="width:48px;height:48px;border-radius:12px;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:800;font-size:22px;margin:0 auto 8px">S</div>
    <h2 style="margin:4px 0">ShopStack</h2>
    <div class="muted small">Cloud shop management for tire &amp; auto businesses</div>
    ${DEMO ? `<div id="pinbox"><div class="pindots mono" id="dots">&nbsp;</div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '⏎'].map((k) => `<button onclick="pinKey('${k}')">${k}</button>`).join('')}</div>
      <p class="small muted" style="margin-top:12px">Demo mode: data stays in this browser.<br>Admin PIN <b class="mono">${esc(CFG.defaultAdminPin)}</b> · Advisor 1111 · Tech 2222 · Accountant 3333</p></div>`
      : `<div style="text-align:left;margin-top:14px" class="grid"><div><label>Email</label><input id="lem" type="email" autocomplete="username"></div>
      <div><label>Password</label><input id="lpw" type="password" autocomplete="current-password"></div>
      <button class="btn primary" onclick="cloudLogin()">Sign in</button>
      <button class="btn" onclick="cloudSignup()">Create a new shop account</button></div>`}
    <div class="small" style="color:var(--bad);margin-top:8px">${esc(msg)}</div></div></div>`;
  S.pin = '';
}
function pinKey(k) {
  if (k === 'C') S.pin = '';
  else if (k === '⏎') return pinLogin(S.pin);
  else if (S.pin.length < 8) S.pin += k;
  $('#dots').textContent = '•'.repeat(S.pin.length) || ' ';
  if (S.pin.length >= 6 && S.pin === CFG.defaultAdminPin) pinLogin(S.pin);
}
document.addEventListener('keydown', (e) => { if ($('#pinbox') && /^[0-9]$/.test(e.key)) pinKey(e.key); else if ($('#pinbox') && e.key === 'Enter') pinKey('⏎'); else if ($('#pinbox') && e.key === 'Backspace') { S.pin = S.pin.slice(0, -1); $('#dots').textContent = '•'.repeat(S.pin.length) || ' '; } });
function pinLogin(pin) {
  const h = pinHash(pin);
  const pu = S.root.platformUsers.find((u) => u.pin_hash === h);
  if (pu) { S.user = { ...pu, platform: true, role: 'owner' }; Store.bindTenant(S.root.tenants[0]); return boot(); }
  for (const t of S.root.tenants) {
    const staff = (S.root.data[t.id]?.staff || []).find((u) => u.pin_hash === h && u.active !== false);
    if (staff) {
      if (t.status === 'suspended') return renderLogin('This account is suspended. Contact billing.');
      S.user = staff; Store.bindTenant(t); return boot();
    }
  }
  renderLogin('PIN not recognized');
}
async function loadSupabase() {
  if (window.supabase) return;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function cloudLogin() {
  const { data, error } = await S.sb.auth.signInWithPassword({ email: $('#lem').value, password: $('#lpw').value });
  if (error) return renderLogin(error.message);
  S.session = data.session; await cloudEnter();
}
async function cloudSignup() {
  const email = $('#lem').value, password = $('#lpw').value;
  if (!email || password.length < 8) return renderLogin('Enter an email and a password of 8+ characters');
  const { data, error } = await S.sb.auth.signUp({ email, password });
  if (error) return renderLogin(error.message);
  if (!data.session) return renderLogin('Check your email to confirm your account, then sign in.');
  S.session = data.session;
  modal('Create your shop', `<div class="grid"><div><label>Business name</label><input id="nsn"></div><div><label>Province</label><select id="nsp">${Object.keys(E.TAX).map((p) => `<option ${p === 'AB' ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>`,
    [{ label: 'Create', cls: 'primary', onClick: async () => { const { error: e2 } = await S.sb.rpc('create_tenant', { p_name: $('#nsn').value || 'My Shop', p_province: $('#nsp').value }); if (e2) toast(e2.message, 'bad'); await cloudEnter(); } }], { narrow: true, sticky: true });
}
async function cloudEnter() {
  const uidv = S.session.user.id;
  const { data: pa } = await S.sb.from('platform_admins').select('user_id').eq('user_id', uidv).maybeSingle();
  const { data: mem } = await S.sb.from('tenant_members').select('role,display_name,tenants(*)').eq('user_id', uidv).eq('active', true);
  let tenants = (mem || []).map((m) => m.tenants);
  if (pa) { const { data: all } = await S.sb.from('tenants').select('*'); tenants = all || tenants; }
  if (!tenants.length) return renderLogin('No shop is linked to this account yet.');
  S.root = { tenants, platformUsers: [] };
  const t = tenants[0];
  t.settings = Object.assign(defaultSettings(t.name, t.province), t.settings || {});
  const m = (mem || []).find((x) => x.tenants.id === t.id);
  S.user = { id: uidv, name: m?.display_name || S.session.user.email, email: S.session.user.email, role: m?.role || 'owner', platform: !!pa };
  Store.bindTenant(t);
  await Store.loadCloudTenant(t);
  boot();
}
function logout() { S.user = null; S.tenant = null; S.chat = []; if (!DEMO) S.sb.auth.signOut(); renderLogin(); }
async function switchTenant(id) {
  const t = S.root.tenants.find((x) => x.id === id);
  if (!t) return;
  if (!DEMO) { t.settings = Object.assign(defaultSettings(t.name, t.province), t.settings || {}); Store.bindTenant(t); await Store.loadCloudTenant(t); }
  else Store.bindTenant(t);
  S.loc = 'all'; S.chat = []; go('dashboard');
}

// ---------- shell & router ----------
function boot() {
  $('#root').innerHTML = `<div id="app"><aside id="side"></aside><div id="main"><div id="top"></div><div id="view"></div></div></div>`;
  go(S.view && can(S.view) ? S.view : 'dashboard');
}
function renderShell() {
  const b = ST().branding;
  let sec = '';
  const nav = MODULES.filter((m) => can(m.k)).map((m) => {
    const head = m.sec !== sec ? `<div class="sec">${esc((sec = m.sec))}</div>` : '';
    return `${head}<a href="#${m.k}" class="${S.view === m.k ? 'on' : ''}" onclick="go('${m.k}');return false"><span aria-hidden="true">${m.icon}</span>${esc(m.label)}</a>`;
  }).join('');
  $('#side').innerHTML = `<div class="brand">${b.logo ? `<img src="${esc(b.logo)}" alt="">` : `<div class="logo">${esc((b.name || 'S')[0])}</div>`}<div style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.name || S.tenant.name)}</div><div class="small muted">${esc(PLANS[S.tenant.plan_id]?.name || '')} plan</div></div></div><nav>${nav}</nav>
    <div class="small muted" style="padding:16px 10px">Signed in as<br><b>${esc(S.user.name)}</b> · ${esc(S.user.platform ? 'Platform admin' : S.user.role)}<br><a href="#" onclick="logout();return false">Sign out</a></div>`;
  const locs = Store.list('locations');
  const m = MODULES.find((x) => x.k === S.view);
  $('#top').innerHTML = `<button class="btn sm" id="menuBtn" onclick="$('#side').classList.toggle('open')" aria-label="Menu">☰</button>
    <h1 class="grow">${esc(m?.label || '')}</h1>
    ${S.user.platform && S.root.tenants.length > 1 ? `<select class="hide-m" style="width:auto" onchange="switchTenant(this.value)" title="Switch tenant">${S.root.tenants.map((t) => `<option value="${t.id}" ${t.id === S.tenant.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}
    ${locs.length > 1 ? `<select style="width:auto" onchange="S.loc=this.value;go(S.view)" title="Location"><option value="all">All locations</option>${locs.map((l) => `<option value="${l.id}" ${S.loc === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}
    ${can('ai') ? `<button class="btn ai sm" onclick="go('ai')">✨ Ask AI</button>` : ''}`;
}
function go(view, sub) {
  if (!can(view)) view = MODULES.find((m) => can(m.k))?.k || 'dashboard';
  S.view = view; S.sub = sub ?? null;
  renderShell();
  $('#side')?.classList.remove('open');
  const v = $('#view');
  try { (VIEWS[view] || (() => (v.innerHTML = '<div class="empty">Not found</div>')))(v); }
  catch (e) { console.error(e); v.innerHTML = `<div class="flag bad">Something went wrong rendering this screen: ${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
const VIEWS = {};
const tabs = (list, active, on) => `<div class="tabs">${list.map(([k, l]) => `<button class="${k === active ? 'on' : ''}" onclick="${on}('${k}')">${esc(l)}</button>`).join('')}</div>`;
const statusPill = (s) => { const m = { Invoiced: 'good', Paid: 'good', Approved: 'good', Won: 'good', Received: 'good', Stored: 'info', 'In Progress': 'info', 'Ready for Pickup': 'good', 'Waiting Parts': 'warn', 'Awaiting Approval': 'warn', Overdue: 'bad', Lost: 'bad', Draft: '', Sent: 'info', Open: 'warn', Partial: 'warn', Released: '' }; return `<span class="pill ${m[s] || ''}">${esc(s)}</span>`; };
