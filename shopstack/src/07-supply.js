/* ================= CUSTOMERS, VEHICLES, STORAGE, INVENTORY, PURCHASING, INTEGRATIONS ================= */
VIEWS.customers = (el) => {
  if (S.sub) return customerProfile(el, S.sub);
  listView(el, 'customers', { onOpen: 'openCustomer', extra: `<button class="btn sm" onclick="importCSV('customers')">Import CSV</button>` });
};
const openCustomer = (id) => go('customers', id);
function customerProfile(el, id) {
  const c = Store.get('customers', id);
  if (!c) return (el.innerHTML = '<div class="empty">Customer not found</div>');
  const vehs = Store.list('vehicles').filter((v) => v.customer_id === id);
  const invs = Store.list('invoices').filter((i) => i.customer_id === id).sort((a, b) => b.date.localeCompare(a.date));
  const ltv = r2(invs.reduce((a, i) => a + i.totals.subtotal, 0)), bal = r2(invs.reduce((a, i) => a + i.balance, 0));
  const acts = Store.list('activities').filter((a) => a.customer_id === id);
  const stor = Store.list('tire_storage').filter((t) => t.customer_id === id && t.status === 'Stored');
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn sm" onclick="go('customers')">← Customers</button><h2 class="grow" style="margin:0">${esc(c.name)} <span class="pill">${esc(c.type || '')}</span></h2>
    <button class="btn sm" onclick="editRecord('customers','${id}',{},()=>go('customers','${id}'))">Edit</button><button class="btn sm" onclick="editRecord('activities',null,{customer_id:'${id}',type:'Call',due:today(),owner:S.user.name},()=>go('customers','${id}'))">+ Activity</button><button class="btn primary sm" onclick="newWO({customer_id:'${id}',vehicle_id:'${vehs[0]?.id || ''}'})">+ Work order</button></div>
    <div class="grid g4"><div class="card kpi"><div class="l">Lifetime sales</div><div class="v">${money(ltv)}</div></div><div class="card kpi"><div class="l">Visits</div><div class="v">${invs.length}</div></div><div class="card kpi"><div class="l">Balance</div><div class="v" style="color:${bal > 0 ? 'var(--bad)' : 'inherit'}">${money(bal)}</div></div><div class="card kpi"><div class="l">Last visit</div><div class="v" style="font-size:16px">${fdate(invs[0]?.date) || '-'}</div></div></div>
    <div class="grid g2" style="margin-top:12px"><div class="card"><h3>Contact</h3><div>${esc(c.phone || '')}<br>${esc(c.email || '')}<br>${esc([c.address, c.city, c.province, c.postal].filter(Boolean).join(', '))}</div>
      <div style="margin-top:8px">${c.consent_marketing ? `<span class="pill good">CASL consent · ${esc(c.consent_source || '')} ${fdate(c.consent_date)}</span>` : '<span class="pill warn">No marketing consent</span>'} <span class="pill">${esc(c.pricing_tier || 'retail')} pricing</span> <span class="pill">${esc(c.terms || '')}</span></div>
      ${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}</div>
      <div class="card"><h3>Vehicles</h3>${vehs.map((v) => `<div class="row" style="justify-content:space-between;padding:4px 0"><a href="#" onclick="editRecord('vehicles','${v.id}',{},()=>go('customers','${id}'));return false">${esc(vehName(v.id))} ${esc(v.plate || '')}</a><span class="small muted">${esc(v.tire_size || '')} · ${num(v.odometer)} km</span></div>`).join('') || '<div class="muted">None</div>'}
      <button class="btn sm" style="margin-top:6px" onclick="editRecord('vehicles',null,{customer_id:'${id}'},()=>go('customers','${id}'))">+ Vehicle</button>
      ${stor.length ? `<div class="flag info" style="margin-top:8px">Storing: ${stor.map((s) => `${esc(s.qty)}× ${esc(s.season)} ${esc(s.size)} (${esc(s.rack)})`).join(', ')}</div>` : ''}</div></div>
    <div class="grid g2" style="margin-top:12px"><div class="card tablewrap"><h3>Invoices</h3><table class="t">${invs.slice(0, 15).map((i) => `<tr class="click" onclick="go('accounting','inv:${i.id}')"><td>${fdate(i.date)}</td><td>${esc(i.number)}</td><td class="num">${money(i.totals.total)}</td><td>${statusPill(i.status)}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table></div>
      <div class="card"><h3>Activity</h3>${acts.map((a) => `<div style="padding:4px 0;border-bottom:1px dashed var(--line)"><span class="pill">${esc(a.type)}</span> ${esc(a.subject)} <span class="small muted">${fdate(a.due)} ${a.done ? '✓' : ''}</span></div>`).join('') || '<div class="muted">None</div>'}</div></div>`;
}
VIEWS.vehicles = (el) => listView(el, 'vehicles');
VIEWS.storage = (el) => {
  const stored = Store.list('tire_storage').filter((t) => t.status === 'Stored');
  listView(el, 'tire_storage', { extra: `<span class="pill info">${stored.length} sets stored</span><span class="pill">${stored.reduce((a, t) => a + (+t.qty || 0), 0)} tires</span>${can('crm', 'edit') ? `<button class="btn sm accent" onclick="swapCampaign()">Seasonal swap campaign</button>` : ''}`, onNew: `editRecord('tire_storage',null,{stored_date:today(),qty:4,status:'Stored',fee:ST().storageFee})` });
  el.insertAdjacentHTML('beforeend', `<p class="small muted" style="margin-top:8px">Tread under 4 mm (winter) or 3 mm (summer) is flagged at release so the advisor can quote replacements before the changeover.</p>`);
};
async function swapCampaign() {
  const month = new Date().getMonth(), season = month >= 8 || month <= 1 ? 'Winter' : 'Summer';
  const c = await Store.save('campaigns', { name: `${season} changeover ${new Date().getFullYear()}`, channel: 'SMS', segment: season === 'Winter' ? 'stored_winter' : 'stored_summer', status: 'Draft', message: `Hi {first}, it's ${ST().branding.name}. Your ${season.toLowerCase()} tires are ready in storage. Book your changeover: reply YES or call ${ST().branding.phone}. Reply STOP to opt out.` });
  toast('Campaign drafted in CRM'); go('crm', 'campaigns'); setTimeout(() => campaignOpen(c.id), 50);
}

// ---------------- Inventory ----------------
const invTab = (k) => go('inventory', k);
VIEWS.inventory = (el) => {
  const tab = S.sub || 'items';
  el.innerHTML = tabs([['items', 'Items'], ['reorder', 'Reorder suggestions'], ['tires', 'Tire finder'], ['valuation', 'Valuation']], tab, 'invTab') + '<div id="invTab"></div>';
  const box = $('#invTab');
  if (tab === 'items') return listView(box, 'inventory', { extra: `<button class="btn sm" onclick="importCSV('inventory')">Import CSV</button>` });
  if (tab === 'valuation') {
    const items = Store.list('inventory').filter(inLoc), v = (t) => r2(items.filter((i) => t(i)).reduce((a, i) => a + (+i.qty || 0) * (+i.cost || 0), 0));
    box.innerHTML = `<div class="grid g3"><div class="card kpi"><div class="l">Tires at cost</div><div class="v">${money(v((i) => i.type === 'tire'))}</div></div><div class="card kpi"><div class="l">Parts & other at cost</div><div class="v">${money(v((i) => i.type !== 'tire'))}</div></div><div class="card kpi"><div class="l">Retail value</div><div class="v">${money(items.reduce((a, i) => a + (+i.qty || 0) * (+i.price || 0), 0))}</div></div></div>
      <div class="card tablewrap" style="margin-top:12px"><table class="t"><tr><th>Item</th><th class="num">Qty</th><th class="num">Cost</th><th class="num">Price</th><th class="num">Margin</th></tr>${items.map((i) => { const m = pct(i.price - i.cost, i.price); return `<tr><td>${esc(i.description)}</td><td class="num">${i.qty}</td><td class="num">${money(i.cost)}</td><td class="num">${money(i.price)}</td><td class="num"><span class="pill ${m < (ST().targetMargin || 30) ? 'warn' : 'good'}">${m}%</span></td></tr>`; }).join('')}</table></div>
      ${can('ai') ? `<button class="btn ai" style="margin-top:10px" onclick="aiRun('pricing','Review my inventory pricing and margins. Target margin ${ST().targetMargin}%.',{items:Store.list('inventory').map(i=>({sku:i.sku,d:i.description,cost:i.cost,price:i.price,qty:i.qty}))})">✨ AI pricing review</button>` : ''}`;
    return;
  }
  if (tab === 'tires') {
    box.innerHTML = `<div class="card"><div class="row"><input id="tf" class="grow" placeholder="Enter a tire size, e.g. 225/65R17" value="${esc(S.tf || '')}"><select id="tfs" style="width:auto"><option value="">Any season</option><option>Winter</option><option>All-weather</option><option>All-season</option><option>Summer</option></select><button class="btn primary" onclick="S.tf=$('#tf').value;tireFind()">Find</button></div><div id="tfres" style="margin-top:10px"></div></div>`;
    if (S.tf) tireFind();
    return;
  }
  const sales = {};
  for (const i of Store.list('invoices').filter((x) => x.date >= addDays(today(), -90))) for (const l of i.lines) if (l.item_id) sales[l.item_id] = (sales[l.item_id] || 0) + (+l.qty || 0);
  const sug = E.reorder(Store.list('inventory').filter(inLoc), sales, 90);
  box.innerHTML = `<div class="card tablewrap"><div class="row" style="margin-bottom:8px"><b class="grow">${sug.length} items at or below reorder point</b>${can('ai') ? `<button class="btn ai sm" onclick="aiForecast()">✨ AI seasonal forecast</button>` : ''}${can('purchasing', 'edit') && sug.length ? `<button class="btn primary sm" onclick="createReorderPOs()">Create POs by vendor</button>` : ''}</div>
    <table class="t"><tr><th>Item</th><th>Vendor</th><th class="num">On hand</th><th class="num">Reorder at</th><th class="num">Sold 90d</th><th class="num">Days cover</th><th class="num">Suggested</th></tr>${sug.map((i) => `<tr><td>${esc(i.description)}</td><td>${esc(Store.get('vendors', i.vendor_id)?.name || '-')}</td><td class="num">${i.qty}</td><td class="num">${i.min}</td><td class="num">${i.sold}</td><td class="num">${i.daysCover ?? '-'}</td><td class="num"><b>${i.suggested}</b></td></tr>`).join('') || '<tr><td class="muted">Nothing to reorder</td></tr>'}</table></div>`;
};
function tireFind() {
  const p = E.parseTire(S.tf), season = $('#tfs')?.value;
  const box = $('#tfres');
  if (!p) return (box.innerHTML = '<div class="flag">Enter a size like 225/65R17 or LT275/70R18.</div>');
  const plus = Store.list('inventory').filter((i) => i.type === 'tire').map((i) => ({ i, t: E.parseTire(i.size) })).filter(({ i, t }) => t && (!season || i.season === season));
  const exact = plus.filter(({ t }) => t.size === p.size), alt = plus.filter(({ t }) => t.size !== p.size && Math.abs(t.diameterIn - p.diameterIn) / p.diameterIn <= 0.03 && t.rim >= p.rim - 1);
  const row = ({ i, t }) => `<tr><td>${esc(i.description)}</td><td>${esc(i.season)}</td><td>${esc(i.load_index)}${esc(i.speed)}</td><td class="num">${i.qty}</td><td class="num">${money(i.price)}</td><td class="num small">${t.diameterIn}"</td></tr>`;
  box.innerHTML = `<p><b>${esc(p.size)}</b> · overall diameter ${p.diameterIn}"</p><h4>In stock, exact size</h4><table class="t">${exact.map(row).join('') || '<tr><td class="muted">None in stock</td></tr>'}</table>
    <h4>Alternate sizes (within 3% diameter: verify load index and fitment before selling)</h4><table class="t">${alt.map(row).join('') || '<tr><td class="muted">None</td></tr>'}</table>
    <div id="dsres" style="margin-top:10px"></div><button class="btn" onclick="distSearch('${esc(p.size)}','po')">Search distributors for ${esc(p.size)}</button>`;
}
async function importCSV(ent) {
  modal(`Import ${ent} from CSV`, `<p class="small muted">First row must be headers matching field names (${fieldsOf(ent).map((f) => f.k).join(', ')}).</p><input type="file" id="csvf" accept=".csv,text/csv">`, [{ label: 'Cancel' }, { label: 'Import', cls: 'primary', onClick: async () => {
    const f = $('#csvf').files[0]; if (!f) return true;
    const rows = parseCSV(await f.text()), keys = fieldsOf(ent).map((x) => x.k);
    let n = 0;
    for (const r of rows) { const o = {}; for (const k of keys) if (r[k] !== undefined && r[k] !== '') o[k] = ['cost', 'price', 'qty', 'min', 'max', 'credit_limit', 'year', 'odometer'].includes(k) ? Number(r[k]) : r[k]; if (Object.keys(o).length) { await Store.save(ent, o); n++; } }
    toast(`Imported ${n} ${ent}`); go(S.view, S.sub);
  } }], { narrow: true });
}

// ---------------- Purchasing ----------------
VIEWS.purchasing = (el) => {
  if (S.sub && S.sub !== 'search') return poEditor(el, S.sub);
  const tab = S.sub || 'pos';
  el.innerHTML = `<div class="tabs"><button class="${tab === 'pos' ? 'on' : ''}" onclick="go('purchasing')">Purchase orders</button><button class="${tab === 'search' ? 'on' : ''}" onclick="go('purchasing','search')">Distributor search</button></div><div id="puTab"></div>`;
  const box = $('#puTab');
  if (tab === 'search') {
    box.innerHTML = `<div class="card"><p class="muted small">One search across every enabled distributor: live stock, warehouse, ETA and your cost, sorted cheapest first.</p><div class="row"><input id="dsq" class="grow" placeholder="Tire size (225/65R17), part number or keyword"><button class="btn primary" onclick="distSearch($('#dsq').value,'po')">Search all distributors</button></div><div id="dsres" style="margin-top:12px"></div></div>`;
    return;
  }
  const pos = Store.list('purchase_orders').sort((a, b) => (b.number || '').localeCompare(a.number || '', undefined, { numeric: true }));
  box.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="grow"></span>${can('purchasing', 'edit') ? `<button class="btn" onclick="go('inventory','reorder')">From reorder suggestions</button><button class="btn primary" onclick="newPO()">+ New PO</button>` : ''}</div>
    <div class="card tablewrap" style="padding:0"><table class="t"><tr><th>PO</th><th>Date</th><th>Vendor</th><th>Status</th><th class="num">Total</th><th>Confirmation</th></tr>${pos.map((p) => `<tr class="click" onclick="go('purchasing','${p.id}')"><td>${esc(p.number)}</td><td>${fdate(p.date)}</td><td>${esc(Store.get('vendors', p.vendor_id)?.name || '')}</td><td>${statusPill(p.status)}</td><td class="num">${money(p.total)}</td><td class="mono small">${esc(p.confirmation || '')}</td></tr>`).join('') || '<tr><td class="empty" colspan="6">No purchase orders yet</td></tr>'}</table></div>`;
};
async function newPO(defaults = {}) { const p = await Store.save('purchase_orders', { number: nextNo('po'), date: today(), status: 'Draft', lines: [], total: 0, ...defaults }); go('purchasing', p.id); return p; }
async function dsToPO(i) {
  const it = S.dsItems[i];
  let v = Store.list('vendors').find((x) => x.connector === it.connector) || await Store.save('vendors', { name: it.vendor, connector: it.connector, terms: 'Net 30' });
  let p = Store.list('purchase_orders').find((x) => x.vendor_id === v.id && x.status === 'Draft') || await Store.save('purchase_orders', { number: nextNo('po'), date: today(), status: 'Draft', vendor_id: v.id, lines: [], total: 0 });
  const inv = Store.list('inventory').find((x) => x.sku === it.sku);
  p.lines.push({ sku: it.sku, desc: it.description, qty: E.parseTire(it.description) ? 4 : 1, cost: it.cost, item_id: inv?.id || '', size: E.parseTire(it.description)?.size || '' });
  p.total = r2(p.lines.reduce((a, l) => a + l.qty * l.cost, 0));
  await Store.save('purchase_orders', p);
  toast(`Added to ${p.number} (${v.name})`);
}
async function createReorderPOs() {
  const sales = {};
  for (const i of Store.list('invoices').filter((x) => x.date >= addDays(today(), -90))) for (const l of i.lines) if (l.item_id) sales[l.item_id] = (sales[l.item_id] || 0) + (+l.qty || 0);
  const sug = E.reorder(Store.list('inventory'), sales, 90), byV = {};
  for (const s of sug) (byV[s.vendor_id || 'none'] ||= []).push(s);
  let n = 0;
  for (const [vid, list] of Object.entries(byV)) { await Store.save('purchase_orders', { number: nextNo('po'), date: today(), status: 'Draft', vendor_id: vid === 'none' ? '' : vid, lines: list.map((s) => ({ sku: s.sku, desc: s.description, qty: s.suggested, cost: +s.cost, item_id: s.id })), total: r2(list.reduce((a, s) => a + s.suggested * s.cost, 0)) }); n++; }
  toast(`${n} draft POs created`); go('purchasing');
}
function poEditor(el, id) {
  const p = Store.get('purchase_orders', id);
  if (!p) return (el.innerHTML = '<div class="empty">PO not found</div>');
  const v = Store.get('vendors', p.vendor_id), ro = p.status === 'Received' || !can('purchasing', 'edit');
  const conn = v?.connector && CONNECTORS.find((c) => c.id === v.connector);
  const sub = r2(p.lines.reduce((a, l) => a + (+l.qty || 0) * (+l.cost || 0), 0)), gst = r2(sub * E.taxFor(ST().province, ST().taxOverride).gst);
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn sm" onclick="go('purchasing')">← Purchase orders</button><h2 class="grow" style="margin:0">${esc(p.number)} ${statusPill(p.status)}</h2></div>
    <div class="card grid g3"><div><label>Vendor</label><select onchange="poSet('${id}','vendor_id',this.value)" ${ro ? 'disabled' : ''}><option value="">-</option>${Store.list('vendors').map((x) => `<option value="${x.id}" ${x.id === p.vendor_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div><label>Date</label><input type="date" value="${esc(p.date)}" onchange="poSet('${id}','date',this.value)" ${ro ? 'disabled' : ''}></div><div><label>Electronic ordering</label><div>${conn ? `<span class="pill info">${esc(conn.name)}</span>` : '<span class="muted small">Email / phone order</span>'}</div></div></div>
    <div class="card tablewrap" style="margin-top:12px;padding:0"><table class="t"><tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Cost</th><th class="num">Amount</th><th></th></tr>
      ${p.lines.map((l, i) => `<tr><td class="mono small">${esc(l.sku)}</td><td>${esc(l.desc)}</td><td style="width:90px"><input type="number" value="${l.qty}" onchange="poLine('${id}',${i},'qty',+this.value)" ${ro ? 'disabled' : ''}></td><td style="width:110px"><input type="number" step="0.01" value="${l.cost}" onchange="poLine('${id}',${i},'cost',+this.value)" ${ro ? 'disabled' : ''}></td><td class="num">${money(l.qty * l.cost)}</td><td>${ro ? '' : `<button class="btn sm danger" onclick="poLine('${id}',${i},null)">✕</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No lines</td></tr>'}
      <tr><td colspan="4" class="right">Subtotal</td><td class="num">${money(sub)}</td><td></td></tr><tr><td colspan="4" class="right">GST/HST (ITC)</td><td class="num">${money(gst)}</td><td></td></tr></table></div>
    ${ro ? '' : `<div class="row" style="margin-top:8px"><button class="btn sm" onclick="poAddItem('${id}')">+ Inventory item</button><button class="btn sm" onclick="go('purchasing','search')">Search distributors</button></div>`}
    <div class="row" style="margin-top:12px;justify-content:flex-end">${p.status === 'Draft' && can('purchasing', 'edit') ? `<button class="btn danger" onclick="Store.remove('purchase_orders','${id}').then(()=>go('purchasing'))">Delete</button><button class="btn primary" onclick="poSend('${id}')">${conn ? 'Send electronically' : 'Mark sent'}</button>` : ''}
      ${p.status === 'Sent' && can('purchasing', 'edit') ? `<button class="btn primary" onclick="poReceive('${id}')">Receive & create bill</button>` : ''}</div>`;
}
async function poSet(id, k, v) { const p = Store.get('purchase_orders', id); p[k] = v; await Store.save('purchase_orders', p); go('purchasing', id); }
async function poLine(id, i, k, v) { const p = Store.get('purchase_orders', id); if (k === null) p.lines.splice(i, 1); else p.lines[i][k] = v; p.total = r2(p.lines.reduce((a, l) => a + l.qty * l.cost, 0)); await Store.save('purchase_orders', p); go('purchasing', id); }
function poAddItem(id) {
  modal('Add inventory item', `<select id="poi">${Store.list('inventory').map((i) => `<option value="${i.id}">${esc(i.sku)} · ${esc(i.description)} (${i.qty} on hand)</option>`).join('')}</select><label style="margin-top:8px">Qty</label><input id="poq" type="number" value="4">`,
    [{ label: 'Add', cls: 'primary', onClick: async () => { const it = Store.get('inventory', $('#poi').value), p = Store.get('purchase_orders', id); p.lines.push({ sku: it.sku, desc: it.description, qty: +$('#poq').value, cost: +it.cost, item_id: it.id }); p.total = r2(p.lines.reduce((a, l) => a + l.qty * l.cost, 0)); await Store.save('purchase_orders', p); go('purchasing', id); } }], { narrow: true });
}
async function poSend(id) {
  const p = Store.get('purchase_orders', id), v = Store.get('vendors', p.vendor_id);
  if (!p.lines.length) return toast('PO has no lines', 'bad');
  if (v?.connector) {
    try { const r = await api('connectors', { action: 'order', connector: v.connector, po: p.number, lines: p.lines }); p.confirmation = r.confirmation || r.result?.confirmation || r.result?.id || 'Submitted'; if (r.demo) toast('Demo order (no live credentials yet)'); }
    catch (e) { p.confirmation = 'DEMO-' + Date.now().toString(36).toUpperCase(); toast('Gateway offline; marked sent with a demo confirmation', 'bad'); }
  }
  p.status = 'Sent'; p.sent_at = new Date().toISOString(); await Store.save('purchase_orders', p); go('purchasing', id);
}
async function poReceive(id) {
  const p = Store.get('purchase_orders', id), v = Store.get('vendors', p.vendor_id);
  for (const l of p.lines) {
    let it = l.item_id && Store.get('inventory', l.item_id);
    if (!it) it = await Store.save('inventory', { sku: l.sku, type: l.size ? 'tire' : 'part', description: l.desc, size: l.size || '', cost: l.cost, price: r2(l.cost / (1 - (ST().targetMargin || 30) / 100)), qty: 0, min: 0, max: 0, vendor_id: p.vendor_id });
    it.qty = (+it.qty || 0) + (+l.qty || 0); it.cost = l.cost; await Store.save('inventory', it); l.item_id = it.id;
  }
  const subtotal = r2(p.lines.reduce((a, l) => a + l.qty * l.cost, 0)), gst = r2(subtotal * E.taxFor(ST().province, ST().taxOverride).gst);
  const bill = await Store.save('bills', { number: p.confirmation || p.number, vendor_id: p.vendor_id, vendorName: v?.name || '', po_id: p.id, date: today(), due: addDays(today(), v?.terms === 'Net 15' ? 15 : v?.terms === 'COD' ? 0 : 30),
    lines: p.lines.map((l) => ({ account: l.size || Store.get('inventory', l.item_id)?.type === 'tire' ? '1200' : '1210', desc: l.desc, qty: l.qty, cost: l.cost })), subtotal, gst, total: r2(subtotal + gst), balance: r2(subtotal + gst), status: 'Open' });
  await postJournal(E.postBill(bill));
  p.status = 'Received'; p.received_at = new Date().toISOString(); p.bill_id = bill.id; await Store.save('purchase_orders', p);
  toast('Stock received and bill posted to A/P'); go('purchasing', id);
}

// ---------------- Vendors & integrations ----------------
VIEWS.integrations = (el) => {
  const tab = S.sub || 'catalog';
  el.innerHTML = `<div class="tabs"><button class="${tab === 'catalog' ? 'on' : ''}" onclick="go('integrations')">Integration marketplace</button><button class="${tab === 'vendors' ? 'on' : ''}" onclick="go('integrations','vendors')">Vendors</button></div><div id="igTab"></div>`;
  const box = $('#igTab');
  if (tab === 'vendors') return listView(box, 'vendors');
  const enabled = Object.fromEntries(Store.list('connectors').map((c) => [c.connector, c]));
  const plan = PLANS[S.tenant.plan_id], used = Object.values(enabled).filter((c) => c.enabled).length;
  const q = (S.igQ || '').toLowerCase();
  const cats = [...new Set(CONNECTORS.map((c) => c.cat))];
  const statusTxt = { live: ['good', 'Live: no agreement needed'], oauth: ['info', 'Connect your account'], partner: ['warn', 'Dealer agreement required'] };
  box.innerHTML = `<div class="row" style="margin-bottom:10px"><input class="grow" style="max-width:340px" placeholder="Search ${CONNECTORS.length} integrations..." value="${esc(S.igQ || '')}" oninput="S.igQ=this.value;clearTimeout(window._ig);window._ig=setTimeout(()=>go('integrations'),250)">
    <span class="small muted">${used} enabled${plan.connectors > 0 ? ` of ${plan.connectors} on ${esc(plan.name)}` : ' · unlimited on your plan'}</span></div>
    ${cats.map((cat) => { const list = CONNECTORS.filter((c) => c.cat === cat && (!q || (c.name + c.cat + c.caps.join(' ')).toLowerCase().includes(q))); if (!list.length) return '';
      return `<h3 style="margin:16px 0 8px">${esc(cat)}</h3><div class="grid g3">${list.map((c) => { const e = enabled[c.id], [cls, txt] = statusTxt[c.status];
        return `<div class="card"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>${esc(c.name)}</b>${e?.enabled ? `<span class="pill good">${e.status === 'connected' ? 'Connected' : 'Enabled'}</span>` : ''}</div>
          <div class="small muted" style="margin:4px 0">${c.caps.map((x) => x.replace(/_/g, ' ')).join(' · ')}</div><span class="pill ${cls}">${txt}</span>
          ${can('integrations', 'edit') ? `<div class="row" style="margin-top:8px">${e?.enabled ? `<button class="btn sm" onclick="connSetup('${c.id}')">Configure</button><button class="btn sm danger" onclick="connToggle('${c.id}',false)">Disable</button>` : `<button class="btn sm primary" onclick="connToggle('${c.id}',true)">Enable</button>`}</div>` : ''}</div>`; }).join('')}</div>`; }).join('')}
    <div class="flag info" style="margin-top:16px">Credentials are encrypted (AES-256-GCM) in the ShopStack cloud and never reach the browser. "Dealer agreement required" connectors run in demo mode with sample quotes until your distributor issues API or EDI credentials. Your rep or ShopStack onboarding can help request them.</div>`;
};
async function connToggle(id, on) {
  const plan = PLANS[S.tenant.plan_id], used = Store.list('connectors').filter((c) => c.enabled).length;
  if (on && plan.connectors > 0 && used >= plan.connectors) return modal('Upgrade to add more integrations', `<p>${esc(plan.name)} includes ${plan.connectors} integrations. Pro and Enterprise include unlimited integrations.</p>`, [{ label: 'Close' }, { label: 'See plans', cls: 'primary', onClick: () => go('settings', 'billing') }], { narrow: true });
  const c = Store.list('connectors').find((x) => x.connector === id) || { id: 'con_' + id, connector: id };
  c.enabled = on; c.status = CONNECTORS.find((x) => x.id === id).status === 'live' ? 'connected' : c.status || 'demo';
  await Store.save('connectors', c); go('integrations');
  if (on && CONNECTORS.find((x) => x.id === id).fields.length) connSetup(id);
}
function connSetup(id) {
  const c = CONNECTORS.find((x) => x.id === id), rec = Store.list('connectors').find((x) => x.connector === id) || {};
  modal(`Configure ${c.name}`, `${c.fields.length ? `<div class="grid">${c.fields.map((f) => `<div><label>${esc(f.label)}</label><input data-k="${f.k}" type="${f.secret ? 'password' : 'text'}" placeholder="${f.secret && rec.hasSecret ? '•••••• saved' : ''}" value="${f.secret ? '' : esc(rec.config?.[f.k] || '')}"></div>`).join('')}</div>` : '<p>No credentials needed.</p>'}
    ${c.status === 'partner' ? '<p class="small muted">Ask your distributor rep for "dealer API" or "EDI 850/810" access and paste the details here. Until then, searches use sample quotes.</p>' : ''}
    ${['qbo', 'xero', 'gbp'].includes(id) ? '<p class="small muted">Uses OAuth: after saving, you\'ll be redirected to sign in to your account (cloud mode).</p>' : ''}`,
    [{ label: 'Test connection', onClick: async () => { try { const r = await api('connectors', { action: 'test', connector: id }); toast(r.ok ? 'Connection OK' : r.message || 'Not connected', r.ok ? '' : 'bad'); } catch (e) { toast('Gateway unreachable: ' + e.message, 'bad'); } return true; } },
      { label: 'Save', cls: 'primary', onClick: async (m) => {
        const all = readForm(m), pub = {}, secret = {};
        for (const f of c.fields) (f.secret ? secret : pub)[f.k] = all[f.k];
        const recd = Store.list('connectors').find((x) => x.connector === id) || { id: 'con_' + id, connector: id, enabled: true };
        recd.config = pub;
        if (Object.values(secret).some(Boolean)) { try { await api('connectors', { action: 'save_credentials', connector: id, creds: { ...pub, ...secret } }); recd.hasSecret = true; recd.status = 'connected'; } catch (e) { toast('Credentials not saved (gateway offline): ' + e.message, 'bad'); } }
        await Store.save('connectors', recd); toast('Saved'); go('integrations');
      } }]);
}
