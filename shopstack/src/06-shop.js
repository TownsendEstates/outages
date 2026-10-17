/* ================= SHOP VIEWS: dashboard, work orders, POS, schedule, time clock ================= */
const taxCtx = () => ({ province: ST().province, taxOverride: ST().taxOverride, shopSuppliesPct: ST().shopSuppliesPct, shopSuppliesCap: ST().shopSuppliesCap, envFeeTire: ST().envFeeTire });
const CANNED = [
  { name: 'Seasonal changeover (on rims)', lines: [{ type: 'labour', desc: 'Seasonal changeover - tires on rims, torque & TPMS check', hours: 0.6 }] },
  { name: 'Seasonal changeover (mount & balance)', lines: [{ type: 'labour', desc: 'Dismount/mount & balance 4 tires, TPMS relearn', hours: 1.2 }, { type: 'part', sku: 'VS-RUB', desc: 'Valve stems', qty: 4 }] },
  { name: 'Oil service', lines: [{ type: 'labour', desc: 'Oil & filter change, multi-point inspection', hours: 0.5 }, { type: 'part', sku: 'OF-PH7317', desc: 'Oil filter', qty: 1 }, { type: 'part', sku: 'OIL-5W30-SYN', desc: '5W-30 synthetic', qty: 5 }] },
  { name: 'Four-wheel alignment', lines: [{ type: 'labour', desc: 'Four-wheel alignment with printout', hours: 1.0 }] },
  { name: 'Brake inspection', lines: [{ type: 'labour', desc: 'Brake inspection & measurement', hours: 0.5 }] },
];

// ---------------- Dashboard ----------------
VIEWS.dashboard = (el) => {
  const inv = Store.list('invoices').filter(inLoc), t0 = today(), m0 = t0.slice(0, 8) + '01';
  const sum = (arr, f) => r2(arr.reduce((a, x) => a + (+f(x) || 0), 0));
  const todays = inv.filter((i) => i.date === t0), mtd = inv.filter((i) => i.date >= m0);
  const mtdRev = sum(mtd, (i) => i.totals.subtotal - i.totals.envFees), mtdCost = sum(mtd, (i) => i.totals.cost);
  const open = Store.list('workorders').filter((w) => w.status !== 'Invoiced' && inLoc(w));
  const ar = sum(inv, (i) => i.balance);
  const low = Store.list('inventory').filter((i) => +i.qty <= +i.min && inLoc(i));
  const days = Array.from({ length: 30 }, (_, i) => addDays(t0, i - 29));
  const byDay = days.map((d) => sum(inv.filter((i) => i.date === d), (i) => i.totals.subtotal));
  const max = Math.max(1, ...byDay);
  const appts = Store.list('appointments').filter((a) => a.date === t0 && inLoc(a)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const overdueActs = Store.list('activities').filter((a) => !a.done && a.due && a.due <= t0);
  const kpi = (l, v, sub = '') => `<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="small muted">${sub}</div></div>`;
  el.innerHTML = `
  <div class="grid g4">${kpi("Today's sales", money(sum(todays, (i) => i.totals.subtotal)), `${todays.length} invoices`)}
    ${kpi('Month to date', money(mtdRev), `Gross margin ${pct(mtdRev - mtdCost, mtdRev)}%`)}
    ${kpi('Car count (MTD)', mtd.length, `Avg RO ${money(mtd.length ? mtdRev / mtd.length : 0)}`)}
    ${kpi('A/R outstanding', money(ar), `${inv.filter((i) => i.balance > 0).length} open invoices`)}</div>
  <div class="grid g3" style="margin-top:12px">
    <div class="card" style="grid-column:span 2"><h3>Sales, last 30 days</h3><div class="bars">${byDay.map((v, i) => `<div title="${fdate(days[i])}: ${money(v)}" style="height:${(v / max) * 100}%"></div>`).join('')}</div>
      <div class="row small muted" style="justify-content:space-between"><span>${fdate(days[0])}</span><span>${fdate(t0)}</span></div></div>
    <div class="card"><h3>Shop floor</h3>${ST().woStatuses.filter((s) => s !== 'Invoiced').map((s) => { const n = open.filter((w) => w.status === s).length; return `<div class="row" style="justify-content:space-between;padding:4px 0"><span>${statusPill(s)}</span><b>${n}</b></div>`; }).join('')}
      <button class="btn sm" style="margin-top:8px" onclick="go('workorders')">Open work orders →</button></div>
  </div>
  <div class="grid g3" style="margin-top:12px">
    <div class="card"><h3>Today's appointments</h3>${appts.length ? appts.map((a) => `<div class="appt" onclick="go('schedule')"><b>${esc(a.time || '')}</b> ${esc(custName(a.customer_id))}<br><span class="muted">${esc(a.service || '')} · ${esc(a.bay || '')}</span></div>`).join('') : '<div class="muted">None booked</div>'}</div>
    <div class="card"><h3>Low stock</h3>${low.length ? `<table class="t small">${low.slice(0, 8).map((i) => `<tr><td>${esc(i.description)}</td><td class="num"><span class="pill bad">${i.qty}</span></td></tr>`).join('')}</table><button class="btn sm" style="margin-top:8px" onclick="go('purchasing')">Reorder →</button>` : '<div class="muted">All stocked</div>'}</div>
    <div class="card"><h3>Follow-ups due</h3>${overdueActs.length ? overdueActs.slice(0, 6).map((a) => `<div class="row" style="justify-content:space-between;padding:3px 0"><span>${esc(a.subject)}</span><span class="pill ${a.due < t0 ? 'bad' : 'warn'}">${fdate(a.due)}</span></div>`).join('') : '<div class="muted">All caught up</div>'}
      ${can('ai') ? `<button class="btn ai sm" style="margin-top:10px" onclick="aiAudit()">✨ AI business audit</button>` : ''}</div>
  </div>
  ${S.tenant.status === 'trial' ? `<div class="flag info">Trial account. ${esc(PLANS[S.tenant.plan_id].name)} plan, upgrade anytime in Settings → Subscription.</div>` : ''}`;
};

// ---------------- Work orders ----------------
VIEWS.workorders = (el) => {
  if (S.sub) return woEditor(el, S.sub);
  const st = (S.woFilter ||= 'open');
  let rows = Store.list('workorders').filter(inLoc);
  if (st === 'open') rows = rows.filter((w) => w.status !== 'Invoiced');
  else if (st !== 'all') rows = rows.filter((w) => w.status === st);
  rows.sort((a, b) => (b.number || '').localeCompare(a.number || '', undefined, { numeric: true }));
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><select style="width:auto" onchange="S.woFilter=this.value;go('workorders')">${[['open', 'All open'], ['all', 'All'], ...ST().woStatuses.map((s) => [s, s])].map(([k, l]) => `<option value="${esc(k)}" ${k === st ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <span class="grow"></span>${can('workorders', 'edit') ? `<button class="btn primary" onclick="newWO()">+ New work order</button>` : ''}</div>
    <div class="kanban">${ST().woStatuses.filter((s) => st === 'all' || st === 'open' ? (st === 'all' || s !== 'Invoiced') : s === st).map((s) => {
      const list = rows.filter((w) => w.status === s);
      return `<div class="kcol" data-status="${esc(s)}" ondragover="event.preventDefault();this.classList.add('drop')" ondragleave="this.classList.remove('drop')" ondrop="woDrop(event,this)"><h4><span>${esc(s)}</span><span>${list.length}</span></h4>
        ${list.map((w) => `<div class="kcard" draggable="true" ondragstart="event.dataTransfer.setData('text','${w.id}')" onclick="go('workorders','${w.id}')"><div class="row" style="justify-content:space-between"><b>${esc(w.number)}</b><span class="small">${money(w.totals?.total)}</span></div>
          <div>${esc(custName(w.customer_id))}</div><div class="small muted">${esc(vehName(w.vehicle_id))}</div>${w.tech_id ? `<div class="small muted">👷 ${esc(empName(w.tech_id))}</div>` : ''}</div>`).join('') || '<div class="small muted" style="padding:6px">Drop here</div>'}</div>`;
    }).join('')}</div>`;
};
async function woDrop(ev, col) {
  ev.preventDefault(); col.classList.remove('drop');
  const w = Store.get('workorders', ev.dataTransfer.getData('text'));
  const to = col.dataset.status;
  if (!w || w.status === to) return;
  if (to === 'Invoiced') return go('workorders', w.id);
  w.status = to; await Store.save('workorders', w); go('workorders');
}
async function newWO(defaults = {}) {
  const w = await Store.save('workorders', { number: nextNo('wo'), date: today(), status: ST().woStatuses[0], lines: [], totals: E.totals([], taxCtx()), inspection: {}, ...defaults });
  go('workorders', w.id);
}
function woEditor(el, id) {
  if (!S.wo || S.wo.id !== id) S.wo = JSON.parse(JSON.stringify(Store.get('workorders', id) || {}));
  const w = S.wo;
  if (!w.id) return (el.innerHTML = '<div class="empty">Work order not found</div>');
  const ro = w.status === 'Invoiced' || !can('workorders', 'edit');
  const vehicles = Store.list('vehicles').filter((v) => !w.customer_id || v.customer_id === w.customer_id);
  const emps = Store.list('employees').filter((e) => e.active !== false);
  const tab = S.woTab || 'lines';
  el.innerHTML = `<div class="row noprint" style="margin-bottom:10px"><button class="btn sm" onclick="S.wo=null;go('workorders')">← Work orders</button><h2 style="margin:0" class="grow">${esc(w.number)} ${statusPill(w.status)}</h2>
      ${can('ai') ? `<button class="btn ai sm" onclick="aiEstimate()" ${ro ? 'disabled' : ''}>✨ AI estimate</button><button class="btn ai sm" onclick="aiExplain()">✨ Customer message</button>` : ''}
      <button class="btn sm" onclick="printDoc('wo')">Print estimate</button></div>
    <div class="grid g4 card">
      <div><label>Customer</label><div class="row" style="flex-wrap:nowrap"><select onchange="S.wo.customer_id=this.value;S.wo.vehicle_id='';go('workorders',S.wo.id)" ${ro ? 'disabled' : ''}><option value="">Select...</option>${Store.list('customers').map((c) => `<option value="${c.id}" ${c.id === w.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><button class="btn sm" onclick="editRecord('customers',null,{},(c)=>{S.wo.customer_id=c.id;go('workorders',S.wo.id)})" ${ro ? 'disabled' : ''}>+</button></div></div>
      <div><label>Vehicle</label><div class="row" style="flex-wrap:nowrap"><select onchange="S.wo.vehicle_id=this.value;go('workorders',S.wo.id)" ${ro ? 'disabled' : ''}><option value="">Select...</option>${vehicles.map((v) => `<option value="${v.id}" ${v.id === w.vehicle_id ? 'selected' : ''}>${esc(vehName(v.id))} ${esc(v.plate || '')}</option>`).join('')}</select><button class="btn sm" onclick="editRecord('vehicles',null,{customer_id:S.wo.customer_id},(v)=>{S.wo.vehicle_id=v.id;go('workorders',S.wo.id)})" ${ro ? 'disabled' : ''}>+</button></div></div>
      <div><label>Status</label><select onchange="S.wo.status=this.value" ${ro ? 'disabled' : ''}>${ST().woStatuses.filter((s) => s !== 'Invoiced' || w.status === 'Invoiced').map((s) => `<option ${s === w.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div><label>Lead technician</label><select onchange="S.wo.tech_id=this.value" ${ro ? 'disabled' : ''}><option value="">-</option>${emps.map((e) => `<option value="${e.id}" ${e.id === w.tech_id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>
      <div><label>Odometer in (km)</label><input type="number" value="${esc(w.odometer_in)}" onchange="S.wo.odometer_in=+this.value" ${ro ? 'disabled' : ''}></div>
      <div><label>Promised</label><input type="datetime-local" value="${esc(w.promised || '')}" onchange="S.wo.promised=this.value" ${ro ? 'disabled' : ''}></div>
      <div><label>Customer PO #</label><input value="${esc(w.po || '')}" onchange="S.wo.po=this.value" ${ro ? 'disabled' : ''}></div>
      <div><label>Vehicle tools</label><div class="row"><button class="btn sm" onclick="checkRecalls()" ${w.vehicle_id ? '' : 'disabled'}>Recalls</button><button class="btn sm" onclick="go('vehicles')">History</button></div></div>
    </div>
    <div class="grid g3" style="margin-top:12px">${['concern', 'cause', 'correction'].map((k) => `<div class="card"><label>${k === 'concern' ? 'Customer concern' : k === 'cause' ? 'Cause (tech findings)' : 'Correction (work performed)'}</label><textarea onchange="S.wo.${k}=this.value" ${ro ? 'disabled' : ''}>${esc(w[k] || '')}</textarea></div>`).join('')}</div>
    ${tabs([['lines', 'Lines & pricing'], ['inspection', 'Digital inspection'], ['history', 'Vehicle history']], tab, 'woTabSet')}
    <div id="woTab"></div>
    <div class="row noprint" style="margin-top:12px;justify-content:flex-end">
      ${!ro ? `<button class="btn danger" onclick="deleteWO()">Delete</button><button class="btn" onclick="saveWO()">Save</button><button class="btn" onclick="recordApproval()">Record customer approval</button><button class="btn primary" onclick="invoiceWO()">Invoice & take payment</button>` : ''}
      ${w.invoice_id ? `<button class="btn" onclick="go('accounting','inv:${w.invoice_id}')">View invoice</button>` : ''}</div>`;
  woTabRender(tab);
}
function woTabSet(t) { S.woTab = t; woTabRender(t); $$('.tabs button').forEach((b) => b.classList.toggle('on', b.textContent === { lines: 'Lines & pricing', inspection: 'Digital inspection', history: 'Vehicle history' }[t])); }
function woTabRender(tab) {
  const w = S.wo, el = $('#woTab'), ro = w.status === 'Invoiced' || !can('workorders', 'edit');
  if (tab === 'inspection') {
    el.innerHTML = `<div class="card">${ST().inspection.map((item) => { const v = w.inspection?.[item] || {}; return `<div class="insp"><div><b>${esc(item)}</b><input placeholder="Notes / measurements" value="${esc(v.n || '')}" onchange="inspSet('${esc(item)}','n',this.value)" ${ro ? 'disabled' : ''} style="margin-top:4px"></div>
      <div class="lights">${[['g', 'Good'], ['y', 'Soon'], ['r', 'Now']].map(([k, l]) => `<button class="${k} ${v.s === k ? 'on' : ''}" onclick="inspSet('${esc(item)}','s','${k}');woTabRender('inspection')" ${ro ? 'disabled' : ''}>${l}</button>`).join(' ')}</div></div>`; }).join('')}
      <p class="small muted">Red/yellow items can be sent to the customer as a plain-language summary with "✨ Customer message".</p></div>`;
    return;
  }
  if (tab === 'history') {
    const hist = Store.list('invoices').filter((i) => w.vehicle_id && i.vehicle_id === w.vehicle_id).sort((a, b) => b.date.localeCompare(a.date));
    const stored = Store.list('tire_storage').filter((t) => t.vehicle_id === w.vehicle_id && t.status === 'Stored');
    el.innerHTML = `<div class="card">${stored.length ? `<div class="flag info">In storage: ${stored.map((s) => `${esc(s.qty)}× ${esc(s.description)} ${esc(s.size)} (${esc(s.season)}, rack ${esc(s.rack)})`).join('; ')}</div>` : ''}
      ${hist.length ? `<table class="t"><tr><th>Date</th><th>Invoice</th><th>Work</th><th class="num">Total</th></tr>${hist.map((i) => `<tr><td>${fdate(i.date)}</td><td>${esc(i.number)}</td><td>${esc(i.lines.map((l) => l.desc).join('; ').slice(0, 120))}</td><td class="num">${money(i.totals.total)}</td></tr>`).join('')}</table>` : '<div class="muted">No previous visits for this vehicle.</div>'}</div>`;
    return;
  }
  w.totals = E.totals(w.lines, taxCtx());
  const t = w.totals, chk = E.estimateCheck(w.approvedTotal, t.total, ST());
  const emps = Store.list('employees').filter((e) => e.active !== false);
  el.innerHTML = `<div class="card tablewrap" style="padding:0"><table class="t"><thead><tr><th>Type</th><th style="min-width:220px">Description</th><th>Qty / Hrs</th><th>Price / Rate</th><th class="num">Amount</th><th>Tech</th><th></th></tr></thead><tbody>
    ${w.lines.map((l, i) => `<tr><td><span class="pill">${esc(l.type)}</span></td>
      <td><input value="${esc(l.desc)}" onchange="lineSet(${i},'desc',this.value)" ${ro ? 'disabled' : ''}>${l.sku ? `<div class="small muted mono">${esc(l.sku)}</div>` : ''}</td>
      <td style="width:90px"><input type="number" step="0.1" value="${esc(l.type === 'labour' ? l.hours : l.qty)}" onchange="lineSet(${i},'${l.type === 'labour' ? 'hours' : 'qty'}',+this.value)" ${ro ? 'disabled' : ''}></td>
      <td style="width:110px"><input type="number" step="0.01" value="${esc(l.type === 'labour' ? l.rate : l.price)}" onchange="lineSet(${i},'${l.type === 'labour' ? 'rate' : 'price'}',+this.value)" ${ro ? 'disabled' : ''}></td>
      <td class="num">${money(E.lineAmount(l))}</td>
      <td style="width:140px">${l.type === 'labour' ? `<select onchange="lineSet(${i},'tech_id',this.value,true)" ${ro ? 'disabled' : ''}><option value="">-</option>${emps.map((e) => `<option value="${e.id}" ${e.id === l.tech_id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>` : ''}</td>
      <td>${ro ? '' : `<button class="btn sm danger" onclick="S.wo.lines.splice(${i},1);woTabRender('lines')" aria-label="Remove">✕</button>`}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">No lines yet. Add labour, parts or tires below${can('ai') ? ', or let AI draft an estimate from the concern' : ''}.</td></tr>`}
    </tbody></table></div>
    ${ro ? '' : `<div class="row" style="margin-top:8px"><select id="lrate" style="width:auto">${ST().labourRates.map((r, i) => `<option value="${i}">${esc(r.name)} (${money(r.rate)}/h)</option>`).join('')}</select>
      <button class="btn sm" onclick="addLine('labour')">+ Labour</button><button class="btn sm" onclick="pickItem()">+ Part / tire</button><button class="btn sm" onclick="addLine('fee')">+ Fee</button><button class="btn sm" onclick="addLine('discount')">+ Discount</button>
      <select style="width:auto" onchange="if(this.value!=='')addCanned(+this.value);this.value=''"><option value="">+ Canned job...</option>${CANNED.map((c, i) => `<option value="${i}">${esc(c.name)}</option>`).join('')}</select></div>`}
    <div class="grid g2" style="margin-top:12px">
      <div class="card">${w.approvedTotal > 0 ? `<div class="flag ${chk.ok ? 'info' : 'bad'}"><b>Authorized estimate:</b> ${money(w.approvedTotal)} by ${esc(w.approval?.by || 'customer')} (${esc(w.approval?.method || '')}, ${esc((w.approval?.at || '').replace('T', ' '))})<br>
        ${chk.ok ? `Within tolerance (limit ${money(chk.limit)}).` : `Exceeds the authorized estimate by ${money(chk.over)}, over the allowed ${money(chk.allowed)}. Record new customer authorization before invoicing (AMVIC).`}</div>`
        : `<div class="flag">No customer authorization recorded. Alberta's Automotive Business Regulation requires a written estimate and customer authorization before work begins.</div>`}
        <div class="small muted">Gross profit on this job: <b>${money(t.margin)}</b> (${pct(t.margin, t.subtotal - t.envFees)}%) · Parts/tire cost ${money(t.cost)}</div></div>
      <div class="card"><table class="t">${[['Labour', t.labour], ['Parts', t.parts], ['Tires', t.tires], ['Fees', t.fees], ['Shop supplies', t.supplies], ['Tire recycling levy', t.envFees], ['Discounts', t.discount]].filter(([, v]) => v).map(([l, v]) => `<tr><td>${l}</td><td class="num">${money(v)}</td></tr>`).join('')}
        <tr><td><b>Subtotal</b></td><td class="num"><b>${money(t.subtotal)}</b></td></tr><tr><td>${esc(t.hst ? 'HST' : 'GST')}</td><td class="num">${money(t.gst)}</td></tr>${t.pst ? `<tr><td>PST/QST</td><td class="num">${money(t.pst)}</td></tr>` : ''}
        <tr><td><b>Total (CAD)</b></td><td class="num" style="font-size:18px"><b>${money(t.total)}</b></td></tr></table></div></div>`;
}
function inspSet(item, k, v) { S.wo.inspection ||= {}; S.wo.inspection[item] ||= {}; S.wo.inspection[item][k] = v; }
function lineSet(i, k, v, noRender) { S.wo.lines[i][k] = v; if (!noRender) woTabRender('lines'); }
function addLine(type) {
  const r = ST().labourRates[+($('#lrate')?.value || 0)];
  const l = type === 'labour' ? { type, desc: r.name + ' labour', hours: 1, rate: r.rate, tech_id: S.wo.tech_id || '', taxable: true }
    : type === 'fee' ? { type, desc: 'Fee', qty: 1, price: 0, taxable: true } : { type, desc: 'Discount', qty: 1, price: 0, taxable: true };
  S.wo.lines.push(l); woTabRender('lines');
}
function addCanned(i) {
  const rate = ST().labourRates[0].rate;
  for (const l of CANNED[i].lines) {
    const it = l.sku && Store.list('inventory').find((x) => x.sku === l.sku);
    S.wo.lines.push(l.type === 'labour' ? { ...l, rate, tech_id: S.wo.tech_id || '', taxable: true } : { ...l, price: it ? E.tierPrice(it, custTier(), ST()) : 0, cost: it?.cost || 0, item_id: it?.id, taxable: true });
  }
  woTabRender('lines');
}
const custTier = () => Store.get('customers', S.wo?.customer_id)?.pricing_tier || 'retail';
function pickItem(target = 'wo') {
  const veh = Store.get('vehicles', S.wo?.vehicle_id);
  const size = veh?.tire_size ? E.parseTire(veh.tire_size)?.size || '' : '';
  modal('Add part or tire', `<div class="row"><input id="pq" class="grow" placeholder="Search SKU, description, brand or size (e.g. 225/65R17)" value="${esc(size)}" oninput="pickRender('${target}')">
    <button class="btn" onclick="distSearch($('#pq').value,'${target}')">Search distributors</button></div><div id="pres" style="margin-top:10px"></div>`, []);
  pickRender(target);
}
function pickRender(target) {
  const q = ($('#pq')?.value || '').toLowerCase().replace(/\s/g, '');
  const tier = target === 'wo' ? custTier() : 'retail';
  const items = Store.list('inventory').filter((i) => !q || [i.sku, i.description, i.brand, i.size].join(' ').toLowerCase().replace(/\s/g, '').includes(q)).slice(0, 40);
  $('#pres').innerHTML = items.length ? `<table class="t"><tr><th>Item</th><th>Season</th><th class="num">On hand</th><th class="num">Price (${esc(tier)})</th><th></th></tr>${items.map((i) => `<tr><td>${esc(i.description)}<div class="small muted mono">${esc(i.sku)}</div></td><td>${esc(i.season || '')}</td><td class="num">${+i.qty <= 0 ? '<span class="pill bad">0</span>' : esc(i.qty)}</td><td class="num">${money(E.tierPrice(i, tier, ST()))}</td>
    <td><button class="btn sm primary" onclick="pickAdd('${i.id}','${target}')">Add</button></td></tr>`).join('')}</table>` : '<div class="muted">No stock matches. Try "Search distributors".</div>';
}
function pickAdd(id, target, qtyOverride) {
  const i = Store.get('inventory', id);
  const qty = qtyOverride || (i.type === 'tire' ? 4 : 1);
  const line = { type: i.type === 'tire' ? 'tire' : 'part', sku: i.sku, desc: i.description, qty, price: E.tierPrice(i, target === 'wo' ? custTier() : 'retail', ST()), cost: +i.cost || 0, item_id: i.id, taxable: true };
  if (target === 'pos') { posAdd(line); return; }
  S.wo.lines.push(line); closeModal(); woTabRender('lines');
  if (+i.qty < qty) toast(`Only ${i.qty} on hand. Order the balance from a distributor.`, 'bad');
}
async function distSearch(q, target) {
  const conns = Store.list('connectors').filter((c) => c.enabled && CONNECTORS.find((x) => x.id === c.connector)?.caps.includes('catalog_search')).map((c) => c.connector);
  if (!conns.length) return toast('Enable a distributor in Vendors & Integrations first', 'bad');
  const out = $('#pres') || $('#dsres');
  out.innerHTML = `<div class="muted">Searching ${conns.length} distributors...</div>`;
  const p = E.parseTire(q);
  let res;
  try { res = await api('connectors', { action: 'search', connectors: conns, q, size: p?.size || '' }); }
  catch (e) { res = { items: conns.flatMap((c) => offlineQuotes(c, q, p?.size || '')), errors: [{ error: 'Gateway offline: showing demo quotes (' + e.message + ')' }] }; }
  S.dsItems = res.items;
  out.innerHTML = `${res.errors?.length ? `<div class="flag small">${res.errors.map((e) => esc((e.connector ? e.connector + ': ' : '') + e.error)).join('<br>')}</div>` : ''}
    <table class="t"><tr><th>Distributor</th><th>Item</th><th>Warehouse</th><th>ETA</th><th class="num">Avail</th><th class="num">Cost</th><th></th></tr>
    ${res.items.map((it, i) => `<tr><td>${esc(it.vendor)}${it.demo ? ' <span class="pill warn">demo</span>' : ''}</td><td>${esc(it.description)}<div class="small muted mono">${esc(it.sku)}</div></td><td>${esc(it.warehouse)}</td><td>${esc(it.eta)}</td><td class="num">${esc(it.qty)}</td><td class="num"><b>${money(it.cost)}</b></td>
      <td class="row"><button class="btn sm" onclick="dsToPO(${i})">→ PO</button>${target === 'wo' ? `<button class="btn sm primary" onclick="dsToWO(${i})">Special order</button>` : ''}</td></tr>`).join('')}</table>`;
}
function offlineQuotes(conn, q, size) {
  const c = CONNECTORS.find((x) => x.id === conn);
  const seed = [...(conn + size + q)].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const brands = ['Michelin', 'Bridgestone', 'Goodyear', 'Toyo', 'Nokian', 'Continental'];
  return [0, 1].map((i) => ({ connector: conn, vendor: c?.name || conn, sku: conn.slice(0, 3).toUpperCase() + '-' + ((seed * (i + 3)) % 99999), description: `${brands[(seed + i) % 6]} ${size || q}`, cost: 95 + ((seed * (i + 7)) % 150), qty: (seed + i * 7) % 30, eta: i ? 'Next day' : 'Same day', warehouse: ['Edmonton', 'Calgary'][i], demo: true }));
}
function dsToWO(i) {
  const it = S.dsItems[i], m = ST().targetMargin || 30;
  S.wo.lines.push({ type: E.parseTire(it.description) || E.parseTire(it.size) ? 'tire' : 'part', sku: it.sku, desc: it.description + ' (special order)', qty: 4, price: r2(it.cost / (1 - m / 100)), cost: it.cost, special: { connector: it.connector, vendor: it.vendor }, taxable: true });
  closeModal(); woTabRender('lines'); toast(`Priced at ${m}% margin. Use "→ PO" to order it.`);
}
async function saveWO() {
  S.wo.totals = E.totals(S.wo.lines, taxCtx());
  await Store.save('workorders', S.wo); S.wo = null; toast('Work order saved'); go('workorders', S.sub);
}
async function deleteWO() { if (await confirmBox('Delete this work order?')) { await Store.remove('workorders', S.wo.id); S.wo = null; go('workorders'); } }
function recordApproval() {
  const t = E.totals(S.wo.lines, taxCtx());
  modal('Record customer authorization', `<p>Authorizing <b>${money(t.total)}</b> for ${esc(custName(S.wo.customer_id))}.</p><div class="grid g2"><div><label>Authorized by</label><input id="apby" value="${esc(custName(S.wo.customer_id))}"></div>
    <div><label>Method</label><select id="apm"><option>In person (signed)</option><option>Phone</option><option>SMS reply</option><option>Email</option><option>Online approval link</option></select></div></div><p class="small muted">Stored with the work order as your AMVIC authorization record.</p>`,
    [{ label: 'Cancel' }, { label: 'Record approval', cls: 'primary', onClick: async () => { S.wo.approvedTotal = t.total; S.wo.approval = { by: $('#apby').value, method: $('#apm').value, at: new Date().toISOString().slice(0, 16), user: S.user.name }; if (['Estimate', 'Awaiting Approval'].includes(S.wo.status)) S.wo.status = 'Approved'; await saveWO(); } }], { narrow: true });
}
async function invoiceWO() {
  const w = S.wo;
  if (!w.customer_id) return toast('Select a customer first', 'bad');
  if (!w.lines.length) return toast('Add at least one line', 'bad');
  w.totals = E.totals(w.lines, taxCtx());
  const chk = E.estimateCheck(w.approvedTotal, w.totals.total, ST());
  if (!chk.ok) return modal('Authorization required', `<p>${w.approvedTotal ? `The total ${money(w.totals.total)} exceeds the authorized ${money(w.approvedTotal)} by more than the allowed ${money(chk.allowed)}.` : 'No customer authorization is on file for this work order.'}</p><p>Record the customer's authorization for the new amount before invoicing.</p>`, [{ label: 'Cancel' }, { label: 'Record authorization', cls: 'primary', onClick: () => setTimeout(recordApproval, 10) }], { narrow: true });
  const inv = await createInvoice({ customer_id: w.customer_id, vehicle_id: w.vehicle_id, wo_id: w.id, lines: w.lines, po: w.po, odometer: w.odometer_in, notes: [w.concern && 'Concern: ' + w.concern, w.cause && 'Cause: ' + w.cause, w.correction && 'Correction: ' + w.correction].filter(Boolean).join('\n') });
  w.status = 'Invoiced'; w.invoice_id = inv.id;
  await Store.save('workorders', w);
  const v = Store.get('vehicles', w.vehicle_id);
  if (v && w.odometer_in) { v.odometer = w.odometer_in; v.last_visit = today(); await Store.save('vehicles', v); }
  S.wo = null; go('workorders', w.id); takePayment(inv.id);
}
async function createInvoice({ customer_id, vehicle_id, wo_id, lines, po, notes, odometer }) {
  const c = Store.get('customers', customer_id);
  const totals = E.totals(lines, taxCtx());
  const days = c?.terms === 'Net 30' ? 30 : c?.terms === 'Net 15' ? 15 : 0;
  const inv = await Store.save('invoices', { number: nextNo('inv'), date: today(), due: addDays(today(), days), customer_id, vehicle_id, wo_id, lines, totals, balance: totals.total, status: 'Open', po, notes, odometer });
  await postJournal(E.postInvoice(inv));
  for (const l of lines) if (l.item_id) { const it = Store.get('inventory', l.item_id); if (it) { it.qty = (+it.qty || 0) - (+l.qty || 0); await Store.save('inventory', it); } }
  return inv;
}
function takePayment(invId) {
  const inv = Store.get('invoices', invId);
  if (!inv || inv.balance <= 0) return;
  const pay = Store.list('connectors').find((c) => c.enabled && CONNECTORS.find((x) => x.id === c.connector)?.caps.includes('payments'));
  modal(`Payment for ${inv.number}`, `<div class="grid g2"><div><label>Amount</label><input id="pamt" type="number" step="0.01" value="${inv.balance}"></div>
    <div><label>Method</label><select id="pmeth">${['debit', 'credit', 'cash', 'etransfer', 'cheque', 'financing', 'account'].map((m) => `<option>${m}</option>`).join('')}</select></div>
    <div><label>Date</label><input id="pdate" type="date" value="${today()}"></div><div><label>Reference</label><input id="pref" placeholder="Auth code / cheque #"></div></div>
    ${pay ? `<p class="small muted">Card terminal: ${esc(CONNECTORS.find((x) => x.id === pay.connector).name)} (sends the amount to the paired terminal when live).</p>` : ''}
    <p class="small muted">Balance due ${money(inv.balance)}. "account" leaves it on A/R for terms customers.</p>`,
    [{ label: 'Later' }, { label: 'Print invoice', onClick: () => { printInvoice(inv.id); return true; } }, { label: 'Record payment', cls: 'primary', onClick: async () => {
      const method = $('#pmeth').value;
      if (method === 'account') return;
      await recordPayment(inv, +$('#pamt').value, method, $('#pdate').value, $('#pref').value);
      toast('Payment recorded'); go(S.view, S.sub);
    } }], { narrow: true });
}
async function recordPayment(inv, amount, method, date = today(), ref = '') {
  amount = r2(amount);
  if (!(amount > 0)) { toast('Enter an amount', 'bad'); throw new Error('Invalid amount'); }
  const p = await Store.save('payments', { invoice_id: inv.id, date, amount, method, ref, location_id: inv.location_id });
  await postJournal(E.postPayment(p, inv.number));
  inv.balance = r2(inv.balance - amount); inv.status = inv.balance <= 0.004 ? 'Paid' : 'Partial';
  await Store.save('invoices', inv);
}
async function checkRecalls() {
  const v = Store.get('vehicles', S.wo.vehicle_id);
  modal(`Recalls: ${vehName(v.id)}`, '<div class="muted">Checking Transport Canada...</div>', []);
  try {
    const d = await api('connectors', { action: 'recalls', make: v.make, model: v.model, year: v.year });
    $('#modal .body').innerHTML = d.recalls.length ? `<table class="t">${d.recalls.map((r) => `<tr><td><b>${esc(r['Recall number'] || r.RECALL_NUMBER_NUM || '')}</b></td><td>${esc(r['System type'] || r.SYSTEM_TYPE_ETXT || '')}</td><td>${esc(r['Recall date'] || r.RECALL_DATE_DTE || '')}</td></tr>`).join('')}</table>` : '<div class="flag info">No Transport Canada recalls found for this make, model and year.</div>';
  } catch (e) { $('#modal .body').innerHTML = `<div class="flag bad">Recall lookup unavailable: ${esc(e.message)}. Check <a href="https://tc.canada.ca/en/recalls" target="_blank" rel="noopener">tc.canada.ca/recalls</a>.</div>`; }
}

// ---------------- Printing (estimates / invoices) ----------------
function docHTML(kind, d) {
  const b = ST().branding, c = Store.get('customers', d.customer_id) || {}, v = Store.get('vehicles', d.vehicle_id) || {}, t = d.totals;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(kind)} ${esc(d.number)}</title><style>body{font:13px system-ui,sans-serif;color:#111;margin:32px}h1{margin:0;color:${esc(b.primary)}}table{width:100%;border-collapse:collapse;margin-top:14px}td,th{padding:6px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}.hd{display:flex;justify-content:space-between;gap:20px}.box{border:1px solid #ddd;border-radius:8px;padding:10px;margin-top:12px}small{color:#555}</style></head><body>
  <div class="hd"><div>${b.logo ? `<img src="${esc(b.logo)}" style="height:56px">` : ''}<h1>${esc(b.name)}</h1><small>${esc(b.address)}<br>${esc(b.phone)} · ${esc(b.email)}<br>GST/HST ${esc(b.gstNo || 'n/a')}${b.amvicNo ? ` · AMVIC licence ${esc(b.amvicNo)}` : ''}</small></div>
  <div style="text-align:right"><h2 style="margin:0">${esc(kind.toUpperCase())}</h2><b>${esc(d.number)}</b><br>${fdate(d.date)}${d.due && kind === 'Invoice' ? `<br>Due ${fdate(d.due)}` : ''}${d.po ? `<br>PO ${esc(d.po)}` : ''}</div></div>
  <div class="hd box"><div><b>${esc(c.name || '')}</b><br>${esc(c.address || '')} ${esc(c.city || '')}<br>${esc(c.phone || '')}</div><div style="text-align:right">${esc(vehName(d.vehicle_id))}<br>VIN ${esc(v.vin || '')}<br>Plate ${esc(v.plate || '')} · ${esc(d.odometer || d.odometer_in || v.odometer || '')} km</div></div>
  ${d.concern || d.notes ? `<div class="box" style="white-space:pre-wrap">${esc(d.notes || ['Concern: ' + (d.concern || ''), d.cause && 'Cause: ' + d.cause, d.correction && 'Correction: ' + d.correction].filter(Boolean).join('\n'))}</div>` : ''}
  <table><tr><th>Description</th><th class="r">Qty/Hrs</th><th class="r">Price</th><th class="r">Amount</th></tr>${d.lines.map((l) => `<tr><td>${esc(l.desc)}${l.sku ? ` <small>${esc(l.sku)}</small>` : ''}</td><td class="r">${esc(l.type === 'labour' ? l.hours : l.qty)}</td><td class="r">${money(l.type === 'labour' ? l.rate : l.price)}</td><td class="r">${money(E.lineAmount(l))}</td></tr>`).join('')}
  ${t.supplies ? `<tr><td colspan="3">Shop supplies</td><td class="r">${money(t.supplies)}</td></tr>` : ''}${t.envFees ? `<tr><td colspan="3">Provincial tire recycling levy (${t.tireCount} tires)</td><td class="r">${money(t.envFees)}</td></tr>` : ''}
  <tr><td colspan="3" class="r">Subtotal</td><td class="r">${money(t.subtotal)}</td></tr><tr><td colspan="3" class="r">${t.hst ? 'HST' : 'GST'}</td><td class="r">${money(t.gst)}</td></tr>${t.pst ? `<tr><td colspan="3" class="r">PST</td><td class="r">${money(t.pst)}</td></tr>` : ''}
  <tr><td colspan="3" class="r"><b>Total CAD</b></td><td class="r"><b>${money(t.total)}</b></td></tr>${kind === 'Invoice' ? `<tr><td colspan="3" class="r">Balance due</td><td class="r"><b>${money(d.balance)}</b></td></tr>` : ''}</table>
  ${kind === 'Estimate' ? `<div class="box"><b>Estimate authorization.</b> I authorize the work above at the estimated price of ${money(t.total)}. The final charge will not exceed this estimate by more than the lesser of ${ST().estimateTolerancePct}% or ${money(ST().estimateToleranceCap)} without my further authorization.<br><br>Signature ____________________________ Date __________</div>` : ''}
  ${kind === 'Invoice' && d.balance > 0 && ST().lateFeePctMonthly ? `<p><small>Overdue balances are charged interest of ${ST().lateFeePctMonthly}% per month (${r2(ST().lateFeePctMonthly * 12)}% per annum).</small></p>` : ''}
  <p><small>${esc(b.invoiceFooter)}</small></p><script>onload=()=>print()<\/script></body></html>`;
}
function openPrint(html) { const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', 'bad'); w.document.write(html); w.document.close(); }
function printDoc() { const w = { ...S.wo, totals: E.totals(S.wo.lines, taxCtx()) }; openPrint(docHTML('Estimate', w)); }
function printInvoice(id) { openPrint(docHTML('Invoice', Store.get('invoices', id))); }

// ---------------- Point of sale ----------------
VIEWS.pos = (el) => {
  S.cart ||= { lines: [], customer_id: '' };
  const q = (S.posQ || '').toLowerCase().replace(/\s/g, '');
  const items = Store.list('inventory').filter((i) => +i.qty > 0 && (!q || [i.sku, i.description, i.size, i.brand].join('').toLowerCase().replace(/\s/g, '').includes(q))).slice(0, 24);
  const t = E.totals(S.cart.lines, taxCtx());
  el.innerHTML = `<div class="grid g2"><div><div class="row"><input class="grow" placeholder="Scan or search SKU / size..." value="${esc(S.posQ || '')}" oninput="S.posQ=this.value;clearTimeout(window._pq);window._pq=setTimeout(()=>go('pos'),200)" onkeydown="if(event.key==='Enter'){const i=Store.list('inventory').find(x=>x.sku.toLowerCase()===this.value.toLowerCase());if(i){pickAdd(i.id,'pos',1);S.posQ='';go('pos')}}"></div>
      <div class="grid g3" style="margin-top:10px">${items.map((i) => `<button class="card" style="text-align:left;cursor:pointer" onclick="pickAdd('${i.id}','pos',${i.type === 'tire' ? 4 : 1})"><div class="small muted mono">${esc(i.sku)}</div><div><b>${esc(i.description)}</b></div><div class="row" style="justify-content:space-between"><span>${money(i.price)}</span><span class="small muted">${esc(i.qty)} on hand</span></div></button>`).join('') || '<div class="muted">No items</div>'}</div>
      <div class="row" style="margin-top:10px">${ST().labourRates.slice(0, 3).map((r) => `<button class="btn sm" onclick="posAdd({type:'labour',desc:'${esc(r.name)} labour',hours:1,rate:${r.rate},taxable:true})">+ ${esc(r.name)} hr</button>`).join('')}<button class="btn sm" onclick="posAdd({type:'fee',desc:'Tire storage (season)',qty:1,price:${ST().storageFee},taxable:true})">+ Storage season</button></div></div>
    <div class="card"><h3>Sale</h3><label>Customer (optional for retail)</label><select onchange="S.cart.customer_id=this.value"><option value="">Walk-in</option>${Store.list('customers').map((c) => `<option value="${c.id}" ${c.id === S.cart.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <table class="t" style="margin-top:10px">${S.cart.lines.map((l, i) => `<tr><td>${esc(l.desc)}</td><td style="width:70px"><input type="number" value="${l.type === 'labour' ? l.hours : l.qty}" onchange="S.cart.lines[${i}].${l.type === 'labour' ? 'hours' : 'qty'}=+this.value;go('pos')"></td><td class="num">${money(E.lineAmount(l))}</td><td><button class="btn sm danger" onclick="S.cart.lines.splice(${i},1);go('pos')">✕</button></td></tr>`).join('') || '<tr><td class="muted">Cart is empty</td></tr>'}</table>
      <table class="t"><tr><td>Subtotal</td><td class="num">${money(t.subtotal)}</td></tr><tr><td>Tax (${esc(t.taxLabel)})</td><td class="num">${money(t.gst + t.pst)}</td></tr><tr><td><b>Total</b></td><td class="num" style="font-size:20px"><b>${money(t.total)}</b></td></tr></table>
      <div class="grid g3" style="margin-top:10px">${['debit', 'credit', 'cash', 'etransfer', 'financing', 'account'].map((m) => `<button class="btn ${m === 'debit' ? 'primary' : ''}" onclick="posCheckout('${m}')" ${S.cart.lines.length ? '' : 'disabled'}>${m}</button>`).join('')}</div>
      <button class="btn sm" style="margin-top:8px" onclick="S.cart={lines:[],customer_id:''};go('pos')">Clear</button></div></div>`;
};
function posAdd(line) { S.cart ||= { lines: [], customer_id: '' }; const ex = line.item_id && S.cart.lines.find((l) => l.item_id === line.item_id); if (ex) ex.qty += line.qty; else S.cart.lines.push(line); closeModal(); go('pos'); }
async function posCheckout(method) {
  let cid = S.cart.customer_id;
  if (method === 'account' && !cid) return toast('Charge to account needs a customer', 'bad');
  if (!cid) { let w = Store.list('customers').find((c) => c.name === 'Walk-in Customer'); if (!w) w = await Store.save('customers', { name: 'Walk-in Customer', type: 'Retail', pricing_tier: 'retail' }); cid = w.id; }
  const inv = await createInvoice({ customer_id: cid, lines: S.cart.lines });
  if (method !== 'account') await recordPayment(inv, inv.balance, method);
  S.cart = { lines: [], customer_id: '' }; toast(`Sale complete: ${inv.number}`);
  modal('Sale complete', `<p>${esc(inv.number)} · ${money(inv.totals.total)} (${esc(method)})</p>`, [{ label: 'Close' }, { label: 'Print receipt', cls: 'primary', onClick: () => printInvoice(inv.id) }], { narrow: true });
  go('pos');
}

// ---------------- Schedule ----------------
VIEWS.schedule = (el) => {
  const start = S.weekStart ||= E.weekKey(today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const appts = Store.list('appointments').filter(inLoc);
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn sm" onclick="S.weekStart=addDays(S.weekStart,-7);go('schedule')">←</button><b>Week of ${fdate(start)}</b><button class="btn sm" onclick="S.weekStart=addDays(S.weekStart,7);go('schedule')">→</button><button class="btn sm" onclick="S.weekStart=null;go('schedule')">Today</button>
    <span class="grow"></span><span class="small muted">${appts.filter((a) => days.includes(a.date)).length} bookings · Capacity ${ST().bays.length} bays</span>${can('schedule', 'edit') ? `<button class="btn primary" onclick="editRecord('appointments',null,{date:today(),time:'09:00',duration:60,status:'Booked'})">+ Book</button>` : ''}</div>
    <div class="cal">${days.map((d) => { const list = appts.filter((a) => a.date === d).sort((a, b) => (a.time || '').localeCompare(b.time || '')); const load = list.reduce((a, x) => a + (+x.duration || 60), 0) / (ST().bays.length * 9.5 * 60);
      return `<div class="day ${d === today() ? 'today' : ''}"><div class="row" style="justify-content:space-between"><b>${new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric' })}</b><span class="pill ${load > 0.85 ? 'bad' : load > 0.6 ? 'warn' : 'good'}">${Math.round(load * 100)}%</span></div>
      ${list.map((a) => `<div class="appt" onclick="apptOpen('${a.id}')"><b>${esc(a.time || '')}</b> ${esc(custName(a.customer_id))}<br>${esc(a.service || '')}<br><span class="muted">${esc(a.bay || '')}${a.tech_id ? ' · ' + esc(empName(a.tech_id)) : ''}</span> ${a.status !== 'Booked' ? statusPill(a.status) : ''}</div>`).join('')}
      ${can('schedule', 'edit') ? `<button class="btn sm" style="margin-top:6px;width:100%" onclick="editRecord('appointments',null,{date:'${d}',time:'09:00',duration:60,status:'Booked'})">+</button>` : ''}</div>`; }).join('')}</div>`;
};
function apptOpen(id) {
  const a = Store.get('appointments', id);
  modal(`${a.time || ''} ${custName(a.customer_id)}`, `<p><b>${esc(a.service || '')}</b><br>${esc(vehName(a.vehicle_id))}<br>${esc(a.bay || '')} · ${esc(empName(a.tech_id))}</p><p class="muted">${esc(a.notes || '')}</p>`,
    [{ label: 'Edit', onClick: () => setTimeout(() => editRecord('appointments', id), 10) }, { label: 'Start work order', cls: 'primary', onClick: async () => { a.status = 'Arrived'; await Store.save('appointments', a); newWO({ customer_id: a.customer_id, vehicle_id: a.vehicle_id, concern: a.service, tech_id: a.tech_id, appointment_id: a.id }); } }], { narrow: true });
}

// ---------------- Time clock ----------------
VIEWS.timeclock = (el) => {
  const ts = Store.list('timesheets').filter((t) => t.date >= addDays(today(), -14)).sort((a, b) => (b.date + b.in).localeCompare(a.date + a.in));
  el.innerHTML = `<div class="grid g2"><div class="card" style="text-align:center"><h3>Punch in / out</h3><input id="tcpin" type="password" inputmode="numeric" placeholder="Employee PIN" style="max-width:220px;text-align:center;font-size:20px" onkeydown="if(event.key==='Enter')punch()"><br><button class="btn primary" style="margin-top:10px" onclick="punch()">Punch</button>
      <div class="small muted" style="margin-top:8px">Uses each employee's time clock PIN (Payroll → Employees).</div></div>
    <div class="card"><h3>On the clock now</h3>${Store.list('timesheets').filter((t) => !t.out && t.date === today()).map((t) => `<div class="row" style="justify-content:space-between"><span>${esc(empName(t.employee_id))}</span><span class="pill good">since ${esc(t.in)}</span></div>`).join('') || '<div class="muted">Nobody clocked in</div>'}</div></div>
    <div class="card tablewrap" style="margin-top:12px"><h3>Last 14 days</h3><table class="t"><tr><th>Date</th><th>Employee</th><th>In</th><th>Out</th><th class="num">Hours</th><th>Approved</th></tr>${ts.map((t) => `<tr><td>${fdate(t.date)}</td><td>${esc(empName(t.employee_id))}</td><td>${esc(t.in)}</td><td>${esc(t.out || '')}</td><td class="num">${num(t.hours, 2)}</td><td>${can('payroll', 'edit') ? `<input type="checkbox" ${t.approved ? 'checked' : ''} onchange="tsApprove('${t.id}',this.checked)">` : t.approved ? '✓' : ''}</td></tr>`).join('')}</table></div>`;
};
async function punch() {
  const pin = $('#tcpin').value, e = Store.list('employees').find((x) => x.clock_pin && String(x.clock_pin) === pin && x.active !== false);
  if (!e) return toast('PIN not recognized', 'bad');
  const now = new Date().toTimeString().slice(0, 5);
  const open = Store.list('timesheets').find((t) => t.employee_id === e.id && !t.out);
  if (open) { const [h1, m1] = open.in.split(':').map(Number), [h2, m2] = now.split(':').map(Number); open.out = now; open.hours = r2(Math.max(0, (h2 * 60 + m2 - h1 * 60 - m1) / 60 - (h2 * 60 + m2 - h1 * 60 - m1 > 300 ? 0.5 : 0))); await Store.save('timesheets', open); toast(`${e.name} clocked out (${open.hours} h, 30 min unpaid break deducted over 5 h)`); }
  else { await Store.save('timesheets', { employee_id: e.id, date: today(), in: now, out: '', hours: 0, approved: false }); toast(`${e.name} clocked in at ${now}`); }
  go('timeclock');
}
async function tsApprove(id, v) { const t = Store.get('timesheets', id); t.approved = v; await Store.save('timesheets', t); }
