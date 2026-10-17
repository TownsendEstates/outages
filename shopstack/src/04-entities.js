/* ================= ENTITY ENGINE: schema-driven lists & forms + tenant custom fields ================= */
const PROVS = Object.keys(Engine.TAX);
const ENTITIES = {
  customers: { label: 'Customer', fields: [
    { k: 'name', label: 'Name / Company', req: true }, { k: 'type', label: 'Type', type: 'select', options: ['Retail', 'Fleet', 'Commercial', 'Wholesale'] },
    { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' },
    { k: 'address', label: 'Address' }, { k: 'city', label: 'City' }, { k: 'province', label: 'Province', type: 'select', options: PROVS }, { k: 'postal', label: 'Postal code' },
    { k: 'pricing_tier', label: 'Pricing tier', type: 'select', options: ['retail', 'fleet', 'wholesale'] }, { k: 'terms', label: 'Terms', type: 'select', options: ['Due on receipt', 'Net 15', 'Net 30'] },
    { k: 'credit_limit', label: 'Credit limit', type: 'money' }, { k: 'tags', label: 'Tags (comma separated)' },
    { k: 'consent_marketing', label: 'CASL marketing consent', type: 'bool' }, { k: 'consent_date', label: 'Consent date', type: 'date' }, { k: 'consent_source', label: 'Consent source', type: 'select', options: ['', 'In person (express)', 'Web form (express)', 'Purchase in last 2 yrs (implied)', 'Inquiry in last 6 mo (implied)'] },
    { k: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ], cols: ['name', 'type', 'phone', 'email', 'city', 'pricing_tier'] },
  vehicles: { label: 'Vehicle', fields: [
    { k: 'customer_id', label: 'Owner', type: 'ref', ref: 'customers', req: true }, { k: 'vin', label: 'VIN', vin: true },
    { k: 'year', label: 'Year', type: 'number' }, { k: 'make', label: 'Make' }, { k: 'model', label: 'Model' }, { k: 'trim', label: 'Trim' }, { k: 'engine', label: 'Engine' },
    { k: 'plate', label: 'Plate' }, { k: 'unit_no', label: 'Fleet unit #' }, { k: 'odometer', label: 'Odometer (km)', type: 'number' },
    { k: 'tire_size', label: 'Tire size (OE)' }, { k: 'colour', label: 'Colour' },
    { k: 'next_service_km', label: 'Next service (km)', type: 'number' }, { k: 'next_service_date', label: 'Next service date', type: 'date' }, { k: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ], cols: ['year', 'make', 'model', 'plate', 'customer_id', 'tire_size', 'odometer'] },
  inventory: { label: 'Item', fields: [
    { k: 'sku', label: 'SKU / Part #', req: true }, { k: 'type', label: 'Type', type: 'select', options: ['tire', 'part', 'wheel', 'fluid', 'battery', 'accessory'] },
    { k: 'description', label: 'Description', req: true, wide: true }, { k: 'brand', label: 'Brand' }, { k: 'model', label: 'Model / line' },
    { k: 'size', label: 'Tire size (e.g. 225/65R17)' }, { k: 'season', label: 'Season', type: 'select', options: ['', 'Winter', 'All-weather', 'All-season', 'Summer'] },
    { k: 'load_index', label: 'Load index' }, { k: 'speed', label: 'Speed rating' },
    { k: 'cost', label: 'Cost', type: 'money' }, { k: 'price', label: 'Retail price', type: 'money' },
    { k: 'qty', label: 'On hand', type: 'number' }, { k: 'min', label: 'Reorder at', type: 'number' }, { k: 'max', label: 'Stock to', type: 'number' },
    { k: 'bin', label: 'Bin / location' }, { k: 'vendor_id', label: 'Preferred vendor', type: 'ref', ref: 'vendors' }, { k: 'dot', label: 'DOT date code' },
  ], cols: ['sku', 'description', 'size', 'season', 'qty', 'cost', 'price'] },
  vendors: { label: 'Vendor', fields: [
    { k: 'name', label: 'Name', req: true }, { k: 'connector', label: 'Integration', type: 'select', optionsFn: () => ['', ...CONNECTORS.map((c) => c.id)] },
    { k: 'account_no', label: 'Our account #' }, { k: 'contact', label: 'Contact' }, { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' },
    { k: 'terms', label: 'Terms', type: 'select', options: ['Net 30', 'Net 15', 'COD', 'Net 60'] }, { k: 'gst_no', label: 'GST/HST #' }, { k: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ], cols: ['name', 'connector', 'account_no', 'contact', 'phone', 'terms'] },
  employees: { label: 'Employee', fields: [
    { k: 'name', label: 'Full name', req: true }, { k: 'position', label: 'Position', type: 'select', options: ['Technician', 'Licensed Technician (Red Seal)', 'Apprentice', 'Tire Technician', 'Service Advisor', 'Manager', 'Admin', 'Sales'] },
    { k: 'pay_type', label: 'Pay type', type: 'select', options: ['hourly', 'salary', 'flat_rate', 'commission'] },
    { k: 'rate', label: 'Hourly rate / annual salary', type: 'money' }, { k: 'flat_rate', label: 'Flat rate per flagged hour', type: 'money' }, { k: 'commission_pct', label: 'Commission % of sales', type: 'number' },
    { k: 'province', label: 'Province of employment', type: 'select', options: PROVS }, { k: 'td1_fed', label: 'TD1 federal claim (blank = basic)', type: 'money' }, { k: 'td1_prov', label: 'TD1 provincial claim (blank = basic)', type: 'money' },
    { k: 'vacation_pct', label: 'Vacation pay % (AB: 4, 6 after 5 yrs)', type: 'number' }, { k: 'sin', label: 'SIN (owner / manager / accountant only)', sin: true }, { k: 'hire_date', label: 'Hire date', type: 'date' },
    { k: 'email', label: 'Email', type: 'email' }, { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'clock_pin', label: 'Time clock PIN', type: 'password' }, { k: 'active', label: 'Active', type: 'bool' },
  ], cols: ['name', 'position', 'pay_type', 'rate', 'province', 'active'] },
  appointments: { label: 'Appointment', fields: [
    { k: 'date', label: 'Date', type: 'date', req: true }, { k: 'time', label: 'Time', type: 'time' }, { k: 'duration', label: 'Duration (min)', type: 'number' },
    { k: 'bay', label: 'Bay', type: 'select', optionsFn: () => ST().bays }, { k: 'tech_id', label: 'Technician', type: 'ref', ref: 'employees' },
    { k: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' }, { k: 'vehicle_id', label: 'Vehicle', type: 'ref', ref: 'vehicles' },
    { k: 'service', label: 'Service', wide: true }, { k: 'status', label: 'Status', type: 'select', options: ['Booked', 'Confirmed', 'Arrived', 'Done', 'No-show', 'Cancelled'] }, { k: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ], cols: ['date', 'time', 'customer_id', 'service', 'bay', 'status'] },
  deals: { label: 'Deal', fields: [
    { k: 'name', label: 'Deal name', req: true }, { k: 'customer_id', label: 'Account', type: 'ref', ref: 'customers' }, { k: 'stage', label: 'Stage', type: 'select', optionsFn: () => ST().dealStages },
    { k: 'value', label: 'Annual value', type: 'money' }, { k: 'probability', label: 'Probability %', type: 'number' }, { k: 'close_date', label: 'Expected close', type: 'date' },
    { k: 'owner', label: 'Owner' }, { k: 'source', label: 'Source', type: 'select', options: ['Referral', 'Walk-in', 'Website', 'Google', 'Cold call', 'Fleet RFP', 'Event'] }, { k: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ], cols: ['name', 'customer_id', 'stage', 'value', 'close_date', 'owner'] },
  activities: { label: 'Activity', fields: [
    { k: 'type', label: 'Type', type: 'select', options: ['Call', 'Email', 'SMS', 'Meeting', 'Task', 'Follow-up'] }, { k: 'subject', label: 'Subject', req: true, wide: true },
    { k: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers' }, { k: 'due', label: 'Due', type: 'date' }, { k: 'owner', label: 'Owner' }, { k: 'done', label: 'Done', type: 'bool' }, { k: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ], cols: ['due', 'type', 'subject', 'customer_id', 'owner', 'done'] },
  tire_storage: { label: 'Stored set', fields: [
    { k: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', req: true }, { k: 'vehicle_id', label: 'Vehicle', type: 'ref', ref: 'vehicles' },
    { k: 'description', label: 'Description (brand / model)', wide: true }, { k: 'size', label: 'Size' }, { k: 'qty', label: 'Qty', type: 'number' },
    { k: 'season', label: 'Season', type: 'select', options: ['Winter', 'Summer', 'All-season', 'All-weather'] }, { k: 'on_rims', label: 'On rims', type: 'bool' },
    { k: 'tread_mm', label: 'Tread (mm, worst)', type: 'number' }, { k: 'rack', label: 'Rack / location' }, { k: 'stored_date', label: 'Stored on', type: 'date' },
    { k: 'fee', label: 'Season fee', type: 'money' }, { k: 'status', label: 'Status', type: 'select', options: ['Stored', 'Released'] }, { k: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ], cols: ['customer_id', 'description', 'size', 'season', 'qty', 'tread_mm', 'rack', 'status'] },
  locations: { label: 'Location', fields: [{ k: 'name', label: 'Name', req: true }, { k: 'address', label: 'Address', wide: true }, { k: 'phone', label: 'Phone' }, { k: 'amvic', label: 'AMVIC licence #' }], cols: ['name', 'address', 'phone'] },
  accounts: { label: 'Account', fields: [{ k: 'code', label: 'Code', req: true }, { k: 'name', label: 'Name', req: true }, { k: 'type', label: 'Type', type: 'select', options: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'] }], cols: ['code', 'name', 'type'] },
};
const fieldsOf = (ent) => [...ENTITIES[ent].fields, ...((ST().customFields || {})[ent] || []).map((f) => ({ ...f, custom: true }))];
const refLabel = (ref, id) => { const r = Store.get(ref, id); if (!r) return ''; if (ref === 'vehicles') return vehName(id) + (r.plate ? ` (${r.plate})` : ''); return r.name || r.sku || r.code || id; };
function cellVal(ent, f, row) {
  const v = row[f.k];
  if (f.type === 'ref') return esc(refLabel(f.ref, v));
  if (f.type === 'money') return money(v);
  if (f.type === 'bool') return v ? '✓' : '';
  if (f.type === 'date') return fdate(v);
  if (f.sin) return v ? '•••-•••-' + esc(String(v).slice(-3)) : '';
  if (f.k === 'status') return statusPill(v || '');
  if (f.k === 'qty' && ent === 'inventory' && +row.qty <= +row.min) return `<span class="pill bad">${esc(v)}</span>`;
  return esc(v);
}
function inputFor(f, v) {
  const id = `f_${f.k}`, req = f.req ? ' required' : '';
  const opts = f.optionsFn ? f.optionsFn() : f.options;
  if (f.type === 'select') return `<select id="${id}" data-k="${f.k}">${(opts || []).map((o) => `<option ${String(o) === String(v ?? '') ? 'selected' : ''} value="${esc(o)}">${esc(o || '-')}</option>`).join('')}</select>`;
  if (f.type === 'ref') return `<select id="${id}" data-k="${f.k}"><option value="">-</option>${Store.list(f.ref).map((r) => `<option value="${r.id}" ${r.id === v ? 'selected' : ''}>${esc(refLabel(f.ref, r.id))}</option>`).join('')}</select>`;
  if (f.type === 'textarea') return `<textarea id="${id}" data-k="${f.k}">${esc(v)}</textarea>`;
  if (f.type === 'bool') return `<label class="row" style="color:var(--ink);font-size:14px"><input type="checkbox" id="${id}" data-k="${f.k}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
  const type = { money: 'number', number: 'number', date: 'date', time: 'time', email: 'email', tel: 'tel', password: 'password' }[f.type] || 'text';
  return `<div class="row" style="flex-wrap:nowrap"><input id="${id}" data-k="${f.k}" type="${type}" ${f.type === 'money' ? 'step="0.01"' : ''} value="${esc(v)}"${req}>${f.vin ? `<button class="btn sm" type="button" onclick="vinFill()">Decode</button>` : ''}</div>`;
}
function formHTML(ent, row) {
  return `<div class="grid g2">${fieldsOf(ent).map((f) => `<div style="${f.wide || f.type === 'textarea' ? 'grid-column:1/-1' : ''}">${f.type === 'bool' ? '' : `<label for="f_${f.k}">${esc(f.label)}${f.req ? ' *' : ''}${f.custom ? ' <span class="pill">custom</span>' : ''}</label>`}${inputFor(f, row[f.k])}</div>`).join('')}</div>`;
}
function editRecord(ent, id, defaults = {}, after) {
  const row = id ? { ...Store.get(ent, id) } : { ...defaults };
  const E2 = ENTITIES[ent];
  const btns = [];
  if (id && can(S.view, 'edit')) btns.push({ label: 'Delete', cls: 'danger', onClick: async () => { if (await confirmBox(`Delete this ${E2.label.toLowerCase()}?`)) { await Store.remove(ent, id); toast('Deleted'); go(S.view, S.sub); } } });
  btns.push({ label: 'Cancel' });
  if (can(S.view, 'edit')) btns.push({ label: 'Save', cls: 'primary', onClick: async (m) => {
    const data = readForm(m);
    const missing = fieldsOf(ent).filter((f) => f.req && !data[f.k]);
    if (missing.length) { toast('Required: ' + missing.map((f) => f.label).join(', '), 'bad'); return true; }
    const saved = await Store.save(ent, { ...row, ...data });
    toast(`${E2.label} saved`);
    after ? after(saved) : go(S.view, S.sub);
  } });
  modal(`${id ? 'Edit' : 'New'} ${E2.label.toLowerCase()}`, formHTML(ent, row), btns);
}
async function vinFill() {
  const vin = $('#f_vin')?.value.trim();
  if (!vin) return toast('Enter a VIN first');
  try {
    const d = await api('connectors', { action: 'vin_decode', vin });
    for (const k of ['year', 'make', 'model', 'trim', 'engine']) if (d[k] && $('#f_' + k)) $('#f_' + k).value = d[k];
    toast(d.error ? `Decoded with warning: ${d.error}` : `Decoded: ${d.year} ${d.make} ${d.model}`);
  } catch (e) {
    // Offline fallback: model year from VIN position 10
    const yc = 'ABCDEFGHJKLMNPRSTVWXY123456789', i = yc.indexOf(vin[9]?.toUpperCase());
    if (i >= 0 && $('#f_year')) $('#f_year').value = 2010 + i > new Date().getFullYear() + 1 ? 1980 + i : 2010 + i;
    toast('VIN service unavailable (' + e.message + '). Model year filled from VIN; enter make/model manually.', 'bad');
  }
}

// Generic list view with search, sort, CSV export
function listView(el, ent, opts = {}) {
  const E2 = ENTITIES[ent], key = 'lv_' + ent;
  const st = (S[key] ||= { q: '', sort: null, dir: 1 });
  const cols = (opts.cols || E2.cols).map((k) => fieldsOf(ent).find((f) => f.k === k)).filter(Boolean);
  let rows = (opts.rows || Store.list(ent)).filter(inLoc);
  if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter((r) => fieldsOf(ent).some((f) => String(f.type === 'ref' ? refLabel(f.ref, r[f.k]) : r[f.k] ?? '').toLowerCase().includes(q))); }
  if (st.sort) rows = rows.slice().sort((a, b) => { const x = a[st.sort] ?? '', y = b[st.sort] ?? ''; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * st.dir; });
  el.innerHTML = `<div class="row" style="margin-bottom:10px">
      <input class="grow" style="max-width:360px" placeholder="Search ${esc(E2.label.toLowerCase())}s..." value="${esc(st.q)}" oninput="S['${key}'].q=this.value;clearTimeout(window._lvq);window._lvq=setTimeout(()=>go(S.view,S.sub),250)">
      <span class="muted small">${rows.length} records</span><span class="grow"></span>
      ${opts.extra || ''}
      <button class="btn sm" onclick="csvDownload('${ent}', Store.list('${ent}'))">Export CSV</button>
      ${can(S.view, 'edit') && !opts.noNew ? `<button class="btn primary" onclick="${opts.onNew || `editRecord('${ent}')`}">+ New ${esc(E2.label.toLowerCase())}</button>` : ''}
    </div>
    <div class="card tablewrap" style="padding:0">${rows.length ? `<table class="t"><thead><tr>${cols.map((c) => `<th class="${['money', 'number'].includes(c.type) ? 'num' : ''}" onclick="S['${key}'].sort='${c.k}';S['${key}'].dir*=-1;go(S.view,S.sub)">${esc(c.label)}${st.sort === c.k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 500).map((r) => `<tr class="click" onclick="${opts.onOpen ? `${opts.onOpen}('${r.id}')` : `editRecord('${ent}','${r.id}')`}">${cols.map((c) => `<td class="${['money', 'number'].includes(c.type) ? 'num' : ''}">${cellVal(ent, c, r)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<div class="empty">No ${esc(E2.label.toLowerCase())}s yet.</div>`}</div>`;
  $('input', el)?.focus();
  const inp = $('input', el); if (inp) inp.setSelectionRange(inp.value.length, inp.value.length);
}
