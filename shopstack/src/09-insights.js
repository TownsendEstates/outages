/* ================= CRM, AI, REPORTS ================= */
const crmTab = (k) => go('crm', k);
const SEGMENTS = {
  all: ['All consented customers', () => Store.list('customers')],
  fleet: ['Fleet & commercial accounts', () => Store.list('customers').filter((c) => ['Fleet', 'Commercial'].includes(c.type))],
  stored_winter: ['Winter tires in storage', () => { const ids = new Set(Store.list('tire_storage').filter((t) => t.status === 'Stored' && t.season === 'Winter').map((t) => t.customer_id)); return Store.list('customers').filter((c) => ids.has(c.id)); }],
  stored_summer: ['Summer tires in storage', () => { const ids = new Set(Store.list('tire_storage').filter((t) => t.status === 'Stored' && t.season !== 'Winter').map((t) => t.customer_id)); return Store.list('customers').filter((c) => ids.has(c.id)); }],
  service_due: ['Service due in next 30 days', () => { const ids = new Set(Store.list('vehicles').filter((v) => v.next_service_date && v.next_service_date <= addDays(today(), 30)).map((v) => v.customer_id)); return Store.list('customers').filter((c) => ids.has(c.id)); }],
  lapsed: ['No visit in 12 months', () => { const recent = new Set(Store.list('invoices').filter((i) => i.date >= addDays(today(), -365)).map((i) => i.customer_id)); return Store.list('customers').filter((c) => !recent.has(c.id)); }],
};
const segmentList = (k, channel) => (SEGMENTS[k]?.[1]() || []).filter((c) => c.consent_marketing && (channel === 'Email' ? c.email : c.phone));
VIEWS.crm = (el) => {
  const tab = S.sub || 'pipeline';
  el.innerHTML = tabs([['pipeline', 'Pipeline'], ['activities', 'Activities'], ['campaigns', 'Campaigns'], ['reviews', 'Reviews']], tab, 'crmTab') + '<div id="crmTab"></div>';
  const box = $('#crmTab');
  if (tab === 'activities') return listView(box, 'activities', { rows: Store.list('activities').slice().sort((a, b) => (a.done - b.done) || (a.due || '').localeCompare(b.due || '')), onNew: `editRecord('activities',null,{type:'Call',due:today(),owner:S.user.name})` });
  if (tab === 'campaigns') {
    const list = Store.list('campaigns');
    box.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="grow small muted">Only customers with recorded CASL consent are included. Every message carries your business name and an opt-out.</span>${can('crm', 'edit') ? `<button class="btn primary" onclick="campaignOpen()">+ Campaign</button>` : ''}</div>
      <div class="card tablewrap" style="padding:0"><table class="t"><tr><th>Name</th><th>Channel</th><th>Segment</th><th class="num">Eligible</th><th>Status</th><th class="num">Sent</th></tr>${list.map((c) => `<tr class="click" onclick="campaignOpen('${c.id}')"><td>${esc(c.name)}</td><td>${esc(c.channel)}</td><td>${esc(SEGMENTS[c.segment]?.[0] || c.segment)}</td><td class="num">${segmentList(c.segment, c.channel).length}</td><td>${statusPill(c.status)}</td><td class="num">${c.sent_count || 0}</td></tr>`).join('') || '<tr><td class="empty" colspan="6">No campaigns yet</td></tr>'}</table></div>`;
    return;
  }
  if (tab === 'reviews') {
    box.innerHTML = `<div class="card"><h3>Review requests & replies</h3><p class="muted">Connect Google Business Profile, Podium or Birdeye in Integrations to pull reviews in. Paste one here to draft a reply.</p><textarea id="rvt" placeholder="Paste a customer review..."></textarea>
      <div class="row" style="margin-top:8px">${can('ai') ? `<button class="btn ai" onclick="aiRun('review','Draft a reply to this review for '+ST().branding.name+':\\n\\n'+$('#rvt').value)">✨ Draft reply</button>` : ''}<button class="btn" onclick="reviewAsk()">Send review requests to last 7 days' customers</button></div></div>`;
    return;
  }
  const stages = ST().dealStages, deals = Store.list('deals');
  const open = deals.filter((d) => !['Won', 'Lost'].includes(d.stage));
  box.innerHTML = `<div class="grid g3" style="margin-bottom:12px"><div class="card kpi"><div class="l">Open pipeline</div><div class="v">${money(open.reduce((a, d) => a + (+d.value || 0), 0))}</div></div><div class="card kpi"><div class="l">Weighted forecast</div><div class="v">${money(open.reduce((a, d) => a + (+d.value || 0) * (+d.probability || 0) / 100, 0))}</div></div><div class="card kpi"><div class="l">Won (all time)</div><div class="v">${money(deals.filter((d) => d.stage === 'Won').reduce((a, d) => a + (+d.value || 0), 0))}</div></div></div>
    <div class="row" style="margin-bottom:8px"><span class="grow"></span>${can('crm', 'edit') ? `<button class="btn primary" onclick="editRecord('deals',null,{stage:'${esc(stages[0])}',owner:S.user.name,probability:10})">+ Deal</button>` : ''}</div>
    <div class="kanban">${stages.map((s) => { const list = deals.filter((d) => d.stage === s); return `<div class="kcol" data-stage="${esc(s)}" ondragover="event.preventDefault();this.classList.add('drop')" ondragleave="this.classList.remove('drop')" ondrop="dealDrop(event,this)"><h4><span>${esc(s)}</span><span>${money(list.reduce((a, d) => a + (+d.value || 0), 0))}</span></h4>
      ${list.map((d) => `<div class="kcard" draggable="true" ondragstart="event.dataTransfer.setData('text','${d.id}')" onclick="editRecord('deals','${d.id}')"><b>${esc(d.name)}</b><div class="small muted">${esc(custName(d.customer_id))}</div><div class="row small" style="justify-content:space-between"><span>${money(d.value)}</span><span class="muted">${fdate(d.close_date)}</span></div></div>`).join('')}</div>`; }).join('')}</div>`;
};
async function dealDrop(ev, col) { ev.preventDefault(); col.classList.remove('drop'); const d = Store.get('deals', ev.dataTransfer.getData('text')); if (!d) return; d.stage = col.dataset.stage; if (d.stage === 'Won') d.probability = 100; if (d.stage === 'Lost') d.probability = 0; await Store.save('deals', d); go('crm'); }
function campaignOpen(id) {
  const c = id ? { ...Store.get('campaigns', id) } : { name: '', channel: 'SMS', segment: 'all', message: '', status: 'Draft' };
  modal(id ? c.name : 'New campaign', `<div class="grid g2"><div><label>Name</label><input id="cpn" value="${esc(c.name)}"></div><div><label>Channel</label><select id="cpc">${['SMS', 'Email'].map((x) => `<option ${x === c.channel ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div style="grid-column:1/-1"><label>Segment</label><select id="cps" onchange="$('#cpcount').textContent=segmentList(this.value,$('#cpc').value).length">${Object.entries(SEGMENTS).map(([k, [l]]) => `<option value="${k}" ${k === c.segment ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><div class="small muted"><span id="cpcount">${segmentList(c.segment, c.channel).length}</span> consented recipients</div></div>
    ${c.channel === 'Email' ? `<div style="grid-column:1/-1"><label>Subject</label><input id="cpsub" value="${esc(c.subject || '')}"></div>` : ''}
    <div style="grid-column:1/-1"><label>Message ({first} = first name)</label><textarea id="cpm" style="min-height:110px">${esc(c.message)}</textarea></div></div>`,
    [...(can('ai') ? [{ label: '✨ Write with AI', cls: 'ai', onClick: async () => { const r = await aiCall('campaign', `Write a ${$('#cpc').value} campaign for "${$('#cpn').value || 'a seasonal promotion'}" targeting: ${SEGMENTS[$('#cps').value][0]}. Business: ${ST().branding.name}, phone ${ST().branding.phone}.`); if (r) $('#cpm').value = r.text; return true; } }] : []),
      { label: 'Save draft', onClick: async () => { await Store.save('campaigns', { ...c, name: $('#cpn').value, channel: $('#cpc').value, segment: $('#cps').value, message: $('#cpm').value, subject: $('#cpsub')?.value || c.subject }); go('crm', 'campaigns'); } },
      { label: 'Send now', cls: 'primary', onClick: async () => {
        const camp = await Store.save('campaigns', { ...c, name: $('#cpn').value, channel: $('#cpc').value, segment: $('#cps').value, message: $('#cpm').value, subject: $('#cpsub')?.value || c.subject });
        if (!/stop|unsubscribe/i.test(camp.message)) { toast('CASL: add an opt-out ("Reply STOP to opt out" / unsubscribe link) before sending', 'bad'); return true; }
        const list = segmentList(camp.segment, camp.channel);
        if (!(await confirmBox(`Send to ${list.length} consented recipients?`))) return true;
        let sent = 0;
        for (const cu of list) {
          const body = camp.message.replace(/\{first\}/g, (cu.name || '').split(' ')[0]);
          try { await api('connectors', { action: 'message', channel: camp.channel, to: camp.channel === 'Email' ? cu.email : cu.phone, subject: camp.subject, body }); } catch { /* demo / offline: logged only */ }
          await Store.save('activities', { type: camp.channel === 'Email' ? 'Email' : 'SMS', subject: `Campaign: ${camp.name}`, customer_id: cu.id, due: today(), done: true, owner: S.user.name });
          sent++;
        }
        camp.status = 'Sent'; camp.sent_count = (camp.sent_count || 0) + sent; camp.sent_at = new Date().toISOString(); await Store.save('campaigns', camp);
        toast(`Sent to ${sent} recipients`); go('crm', 'campaigns');
      } }]);
}
async function reviewAsk() {
  const ids = [...new Set(Store.list('invoices').filter((i) => i.date >= addDays(today(), -7)).map((i) => i.customer_id))];
  const list = ids.map((id) => Store.get('customers', id)).filter((c) => c && c.phone && c.consent_marketing);
  for (const c of list) await Store.save('activities', { type: 'SMS', subject: 'Review request sent', customer_id: c.id, due: today(), done: true, owner: S.user.name });
  toast(`Review requests queued for ${list.length} consented customers`);
}

// ---------------- AI ----------------
function snapshot() {
  const inv = Store.list('invoices'), m0 = today().slice(0, 8) + '01';
  const p = E.pnl(Store.list('journal'), accounts(), m0, today());
  return {
    business: ST().branding.name, province: ST().province, plan: S.tenant.plan_id, today: today(), labourRates: ST().labourRates, targetMargin: ST().targetMargin,
    mtd: { revenue: p.revenue, gross: p.gross, net: p.net, invoices: inv.filter((i) => i.date >= m0).length },
    ar: E.aging(inv, today()).buckets, ap: E.aging(Store.list('bills'), today()).buckets,
    openWorkOrders: Store.list('workorders').filter((w) => w.status !== 'Invoiced').slice(0, 30).map((w) => ({ no: w.number, status: w.status, date: w.date, customer: custName(w.customer_id), vehicle: vehName(w.vehicle_id), total: w.totals?.total, concern: w.concern })),
    lowStock: Store.list('inventory').filter((i) => +i.qty <= +i.min).map((i) => ({ sku: i.sku, d: i.description, qty: i.qty, min: i.min })),
    techs: Store.list('employees').map((e) => ({ name: e.name, pay: e.pay_type })),
    appointmentsNext7: Store.list('appointments').filter((a) => a.date >= today() && a.date <= addDays(today(), 7)).length,
    pipeline: Store.list('deals').filter((d) => !['Won', 'Lost'].includes(d.stage)).map((d) => ({ name: d.name, stage: d.stage, value: d.value })),
    storage: Store.list('tire_storage').filter((t) => t.status === 'Stored').length,
  };
}
async function aiCall(task, prompt, context, history) {
  try { return await api('ai', { task, prompt, context, history }); }
  catch (e) { const off = AI_OFFLINE[task]?.(prompt, context); if (off) return { ...off, offline: true, why: e.message }; toast('AI unavailable: ' + e.message, 'bad'); return null; }
}
async function aiRun(task, prompt, context) {
  modal('✨ ShopStack AI', '<div class="muted">Thinking...</div>', []);
  const r = await aiCall(task, prompt, context ?? snapshot());
  if (!r) return closeModal();
  $('#modal .body').innerHTML = `${r.offline ? `<div class="flag small">Offline rules-based result: the AI service isn't connected (${esc(r.why)}). Deploy with ANTHROPIC_API_KEY for full AI.</div>` : ''}<div style="white-space:pre-wrap">${esc(r.text)}</div>
    <div class="row" style="margin-top:12px"><button class="btn sm" onclick="navigator.clipboard?.writeText(${JSON.stringify(r.text).replace(/"/g, '&quot;')});toast('Copied')">Copy</button></div>`;
  return r;
}
async function aiEstimate() {
  const w = S.wo, v = Store.get('vehicles', w.vehicle_id) || {};
  if (!w.concern) return toast('Enter the customer concern first', 'bad');
  modal('✨ AI estimate', '<div class="muted">Drafting an estimate from the concern...</div>', []);
  const r = await aiCall('estimate', `Customer concern: ${w.concern}\nTech notes: ${w.cause || 'none'}`, { vehicle: { year: v.year, make: v.make, model: v.model, engine: v.engine, odometer: w.odometer_in || v.odometer, tire_size: v.tire_size }, labourRates: ST().labourRates, inventory: Store.list('inventory').map((i) => ({ sku: i.sku, d: i.description, price: i.price, qty: i.qty, type: i.type })) });
  if (!r) return closeModal();
  const data = r.data || { summary: r.text, jobs: [] };
  S.aiJobs = data.jobs || [];
  $('#modal .body').innerHTML = `${r.offline ? `<div class="flag small">Rules-based draft (AI offline: ${esc(r.why)}).</div>` : ''}<p>${esc(data.summary || '')}</p>
    <table class="t"><tr><th></th><th>Job</th><th>Type</th><th class="num">Hrs/Qty</th><th>Notes</th></tr>${S.aiJobs.map((j, i) => `<tr><td><input type="checkbox" checked id="aij${i}"></td><td><b>${esc(j.title)}</b><div class="small muted">${esc(j.description || '')}</div></td><td>${esc(j.type)}</td><td class="num">${esc(j.hours ?? j.qty ?? '')}</td><td class="small">${esc(j.notes || '')}${j.sku ? ` <span class="mono">${esc(j.sku)}</span>` : ''}</td></tr>`).join('')}</table>
    ${data.questions?.length ? `<h4>Ask the customer</h4><ul>${data.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}${data.safety_flags?.length ? `<div class="flag bad">${data.safety_flags.map(esc).join('<br>')}</div>` : ''}
    <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn primary" onclick="aiEstimateApply()">Add selected to work order</button></div>`;
}
function aiEstimateApply() {
  const rate = ST().labourRates[0].rate;
  S.aiJobs.forEach((j, i) => {
    if (!$('#aij' + i)?.checked) return;
    const it = j.sku && Store.list('inventory').find((x) => x.sku === j.sku);
    if (j.type === 'labour') S.wo.lines.push({ type: 'labour', desc: j.title + (j.notes ? ' (AI est., verify book time)' : ''), hours: +j.hours || 1, rate, tech_id: S.wo.tech_id || '', taxable: true });
    else S.wo.lines.push({ type: j.type === 'tire' ? 'tire' : j.type === 'fee' ? 'fee' : 'part', desc: it?.description || j.title, sku: it?.sku || j.sku || '', qty: +j.qty || 1, price: it ? E.tierPrice(it, custTier(), ST()) : 0, cost: it?.cost || 0, item_id: it?.id, taxable: true });
  });
  closeModal(); S.woTab = 'lines'; woTabRender('lines'); toast('Added. Unpriced lines show $0: price them before approval.');
}
async function aiExplain() {
  const w = S.wo, insp = Object.entries(w.inspection || {}).map(([k, v]) => `${k}: ${{ g: 'GOOD', y: 'SOON', r: 'NOW' }[v.s] || '?'} ${v.n || ''}`).join('\n');
  const r = await aiRun('explain', `Vehicle: ${vehName(w.vehicle_id)}\nCustomer: ${custName(w.customer_id)}\nConcern: ${w.concern || ''}\nFindings: ${w.cause || ''}\nInspection:\n${insp || 'none'}\nEstimate total: ${money(E.totals(w.lines, taxCtx()).total)}\nShop: ${ST().branding.name}`, {});
  if (r) $('#modal .body').insertAdjacentHTML('beforeend', `<button class="btn primary sm" style="margin-top:8px" onclick="Store.save('activities',{type:'SMS',subject:'Inspection results sent',customer_id:S.wo.customer_id,due:today(),done:true,owner:S.user.name,notes:${JSON.stringify(r.text).replace(/"/g, '&quot;')}});toast('Logged to customer timeline (sends via Twilio when connected)');closeModal()">Send to customer</button>`);
}
async function aiForecast() {
  const months = {};
  for (const i of Store.list('invoices')) for (const l of i.lines) if (l.item_id) { const k = i.date.slice(0, 7); (months[l.item_id] ||= {})[k] = (months[l.item_id][k] || 0) + (+l.qty || 0); }
  const r = await aiRun('forecast', `Forecast the next 60 days of demand and recommend reorders. Today is ${today()}, province ${ST().province}.`, { items: Store.list('inventory').map((i) => ({ sku: i.sku, d: i.description, season: i.season, qty: i.qty, min: i.min, max: i.max, cost: i.cost, monthly_sales: months[i.id] || {} })) });
  return r;
}
async function aiAudit() { return aiRun('anomaly', 'Run a full business health audit and list the top issues with dollar impact.', { ...snapshot(), labour: techEfficiency(addDays(today(), -30), today()) }); }
async function aiCategorize() {
  const tx = Store.list('bank_txns').filter((t) => !t.posted);
  const r = await aiCall('categorize', 'Categorize these bank transactions.', { chart: accounts().map((a) => ({ code: a.code, name: a.name, type: a.type })), transactions: tx.map((t) => ({ id: t.id, date: t.date, description: t.description, amount: t.amount })) });
  if (!r) return;
  const items = r.data?.items || [];
  for (const it of items) { const t = Store.get('bank_txns', it.id); if (t && accounts().some((a) => a.code === it.account)) { t.account = it.account; t.ai = `${accName(it.account)} (${Math.round((it.confidence || 0) * 100)}%): ${it.reason || ''}`; await Store.save('bank_txns', t); } }
  toast(`${items.length} suggestion${items.length === 1 ? '' : 's'} applied${r.offline ? ' (rules-based)' : ''}. Review, then post.`); go('accounting', 'banking');
}
// Rules-based fallbacks so the demo works without the AI backend
const AI_OFFLINE = {
  estimate(prompt) {
    const p = prompt.toLowerCase(), jobs = [];
    const add = (title, type, hours, qty, sku, notes = '') => jobs.push({ title, type, hours, qty, sku, notes, description: '' });
    if (/brake|grind|squeal|squeak|pedal/.test(p)) { add('Brake inspection & measurement', 'labour', 0.5); add('Replace front pads & rotors', 'labour', 1.8, null, null, 'Typical book time; verify'); add('Front brake pads', 'part', null, 1, 'BP-D1210'); add('Front rotors', 'part', null, 2, 'RT-55097'); }
    if (/tire|winter|swap|changeover|flat|puncture/.test(p)) add(/flat|puncture/.test(p) ? 'Flat repair (plug-patch), balance' : 'Seasonal changeover', 'labour', /flat|puncture/.test(p) ? 0.5 : 0.6);
    if (/oil|service|maintenance/.test(p)) { add('Oil & filter service', 'labour', 0.5); add('Oil filter', 'part', null, 1, 'OF-PH7317'); add('5W-30 synthetic (L)', 'part', null, 5, 'OIL-5W30-SYN'); }
    if (/check engine|cel|light|code/.test(p)) add('Check engine light diagnostic', 'labour', 1.0);
    if (/battery|start|crank|dead/.test(p)) { add('Battery & charging system test', 'labour', 0.3); add('Battery (if test fails)', 'part', null, 1, 'BAT-H6'); }
    if (/pull|align|wander|vibrat|shake/.test(p)) add('Four-wheel alignment', 'labour', 1.0);
    if (/noise|rattle|clunk|knock/.test(p) && !jobs.length) add('Noise diagnosis & road test', 'labour', 1.0);
    if (!jobs.length) add('Diagnosis & road test', 'labour', 1.0);
    return { text: '', data: { summary: 'Draft based on keywords in the concern. Verify labour times against your labour guide.', jobs, questions: ['When did it start, and is it constant or intermittent?', 'Any recent work done elsewhere?'], safety_flags: /brake|grind/.test(p) ? ['Brake noise can mean metal-to-metal contact: advise the customer not to drive far until inspected.'] : [] } };
  },
  explain(prompt) {
    const lines = prompt.split('\n'), now = lines.filter((l) => / NOW /.test(l + ' ')), soon = lines.filter((l) => / SOON /.test(l + ' '));
    return { text: `Hi! Here's what we found on your vehicle today:\n\n${now.length ? `Needs attention now:\n${now.map((l) => '• ' + l.replace(/: NOW/, ':')).join('\n')}\n\n` : ''}${soon.length ? `Plan for soon:\n${soon.map((l) => '• ' + l.replace(/: SOON/, ':')).join('\n')}\n\n` : ''}Everything else checked out well. Reply YES to approve the recommended work or call us with any questions.` };
  },
  forecast(_, ctx) {
    const s = E.reorder(ctx.items.map((i, k) => ({ ...i, id: String(k), description: i.d, vendor_id: '' })), Object.fromEntries(ctx.items.map((i, k) => [String(k), Object.values(i.monthly_sales || {}).reduce((a, b) => a + b, 0)])), 90);
    const m = new Date().getMonth();
    return { text: `${m >= 8 && m <= 11 ? 'Fall changeover season: winter tire demand peaks Oct-Nov in the Prairies. Stock winter sizes to max now.' : m >= 2 && m <= 5 ? 'Spring changeover: shift buying to all-season/summer sizes.' : 'Off-peak: buy to minimums only.'}\n\nReorder now:\n${s.map((i) => `• ${i.description}: on hand ${i.qty}, order ${i.suggested}`).join('\n') || '• Nothing below reorder point.'}` };
  },
  anomaly(_, ctx) {
    const out = [];
    if (ctx?.ar?.d90 > 0) out.push(`• ${money(ctx.ar.d90)} of receivables are over 60 days: call these accounts this week.`);
    if (ctx?.ar?.d60 > 0) out.push(`• ${money(ctx.ar.d60)} is 31-60 days overdue: send statements.`);
    (ctx?.openWorkOrders || []).filter((w) => w.date < addDays(today(), -3)).forEach((w) => out.push(`• ${w.no} (${w.customer}) has been open since ${w.date}: ${w.status}.`));
    (ctx?.labour || []).filter((t) => t.clocked > 0 && t.efficiency < 75).forEach((t) => out.push(`• ${t.name}: ${t.efficiency}% efficiency (${t.flagged} flagged / ${t.clocked} clocked hrs). Check for unbilled labour.`));
    (ctx?.lowStock || []).slice(0, 5).forEach((i) => out.push(`• Low stock: ${i.d} (${i.qty} left).`));
    (ctx?.run || []).filter((r) => r.net < 0 || r.gross > 10000).forEach((r) => out.push(`• Payroll check: ${r.name} gross ${money(r.gross)}, net ${money(r.net)}.`));
    return { text: out.length ? 'Top issues found:\n\n' + out.join('\n') : 'No issues found in the current data.' };
  },
  categorize(_, ctx) {
    const rules = [[/rent|lease|plaza/i, '6100'], [/epcor|atco|enmax|fortis|direct energy|telus|shaw|rogers|bell/i, '6200'], [/insur|intact|aviva|wawanesa/i, '6300'], [/google|facebook|meta|kijiji|radio/i, '6400'], [/microsoft|adobe|shopstack|quickbooks|xero|software/i, '6500'], [/moneris|stripe|square|helcim|fee|service charge/i, '6700'], [/shell|esso|petro|husky|co-op gas|fuel/i, '6950'], [/napa|lordco|dynamic|ntd|fountain|kal tire|atd/i, '2000'], [/receiver general|cra/i, '2300'], [/deposit|settlement|batch/i, '1020']];
    return { text: '', data: { items: ctx.transactions.map((t) => { const r = rules.find(([re]) => re.test(t.description)); return { id: t.id, account: r ? r[1] : t.amount > 0 ? '1020' : '6900', confidence: r ? 0.8 : 0.3, reason: r ? 'Matched vendor keyword' : 'No rule matched; default' }; }) } };
  },
  pricing(_, ctx) {
    const low = (ctx.items || []).filter((i) => i.price && (i.price - i.cost) / i.price < (ST().targetMargin || 30) / 100);
    return { text: low.length ? `Items under your ${ST().targetMargin}% target margin:\n${low.map((i) => `• ${i.d}: cost ${money(i.cost)}, price ${money(i.price)} → suggest ${money(i.cost / (1 - ST().targetMargin / 100))}`).join('\n')}` : 'All items meet the target margin.' };
  },
  review() { return { text: `Thank you for taking the time to share your experience with ${ST().branding.name}! We appreciate your feedback and would love to make things right where we fell short. Please reach out at ${ST().branding.phone || 'the shop'} so we can help.` }; },
  campaign(p) { return { text: `Hi {first}, it's ${ST().branding.name}. ${/winter|fall|changeover/i.test(p) ? 'Winter is coming: book your tire changeover before the rush.' : 'We have a special offer for you this month.'} Call ${ST().branding.phone} or reply YES to book. Reply STOP to opt out.` }; },
  chat() { return { text: 'The AI assistant needs the ShopStack AI service (ANTHROPIC_API_KEY on the Netlify deployment). Meanwhile, try the AI buttons on work orders, inventory, banking and the dashboard: they have offline rules-based versions.' }; },
  report: () => null,
};
VIEWS.ai = (el) => {
  const quick = ['How did we do this month vs our target margin?', 'Which open work orders need attention today?', 'What should I reorder before the winter rush?', 'Write a fleet proposal intro for Capital Couriers', 'Which customers owe us money over 30 days?', 'How do I set up a new technician on flat-rate pay?'];
  el.innerHTML = `<div class="grid g3"><div class="card" style="grid-column:span 2"><div class="chat" id="chat">${S.chat.map((m) => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">${esc(m.content)}</div>`).join('') || '<div class="muted">Ask anything about your shop. The assistant sees a live snapshot of your work orders, sales, A/R, stock and pipeline.</div>'}</div>
      <div class="row" style="margin-top:10px;flex-wrap:nowrap"><input id="chatq" placeholder="Ask ShopStack AI..." onkeydown="if(event.key==='Enter')chatSend()"><button class="btn ai" onclick="chatSend()">Send</button></div></div>
    <div class="card"><h3>Try asking</h3>${quick.map((q) => `<button class="btn sm" style="margin:0 6px 6px 0;white-space:normal;text-align:left" onclick="$('#chatq').value=this.textContent;chatSend()">${esc(q)}</button>`).join('')}
      <h3 style="margin-top:14px">AI tools</h3><div class="grid"><button class="btn" onclick="aiAudit()">Business health audit</button><button class="btn" onclick="aiForecast()">Seasonal demand forecast</button><button class="btn" onclick="go('accounting','banking')">Categorize bank lines</button><button class="btn" onclick="go('crm','campaigns')">Write a campaign</button><button class="btn" onclick="go('workorders')">Estimate from concern (in a work order)</button></div>
      <p class="small muted" style="margin-top:10px">AI usage this plan: ${PLANS[S.tenant.plan_id].ai < 0 ? 'unlimited (fair use)' : PLANS[S.tenant.plan_id].ai + ' actions / month'}. AI drafts are suggestions: staff review before anything reaches a customer.</p></div></div>`;
  const c = $('#chat'); c.scrollTop = c.scrollHeight; $('#chatq').focus();
};
async function chatSend() {
  const q = $('#chatq').value.trim();
  if (!q) return;
  const history = S.chat.slice(-10);
  S.chat.push({ role: 'user', content: q }); go('ai');
  $('#chat').insertAdjacentHTML('beforeend', '<div class="msg a muted" id="typing">Thinking...</div>');
  const r = await aiCall('chat', q, snapshot(), history);
  S.chat.push({ role: 'assistant', content: r ? r.text + (r.offline ? `\n\n(offline: ${r.why})` : '') : 'Sorry, the AI service is unavailable.' });
  go('ai');
}

// ---------------- Reports ----------------
function techEfficiency(from, to) {
  return Store.list('employees').map((e) => {
    let flagged = 0, sales = 0;
    for (const i of Store.list('invoices').filter((x) => x.date >= from && x.date <= to)) for (const l of i.lines) if (l.type === 'labour' && l.tech_id === e.id) { flagged += +l.hours || 0; sales += E.lineAmount(l); }
    const clocked = Store.list('timesheets').filter((t) => t.employee_id === e.id && t.date >= from && t.date <= to).reduce((a, t) => a + (+t.hours || 0), 0);
    return { name: e.name, position: e.position, flagged: r2(flagged), clocked: r2(clocked), efficiency: clocked ? Math.round((flagged / clocked) * 100) : 0, labourSales: r2(sales) };
  }).filter((x) => x.flagged || x.clocked);
}
const REPORTS = {
  sales_category: ['Sales by category', (f, t) => { const inv = Store.list('invoices').filter((i) => i.date >= f && i.date <= t && inLoc(i)); const k = ['labour', 'parts', 'tires', 'fees', 'supplies', 'discount', 'envFees']; return k.map((x) => ({ category: x, amount: r2(inv.reduce((a, i) => a + (i.totals[x] || 0), 0)) })); }],
  tech: ['Technician productivity', (f, t) => techEfficiency(f, t)],
  customers: ['Top customers', (f, t) => { const m = {}; for (const i of Store.list('invoices').filter((i) => i.date >= f && i.date <= t)) { const r = (m[i.customer_id] ||= { customer: custName(i.customer_id), visits: 0, sales: 0, balance: 0 }); r.visits++; r.sales = r2(r.sales + i.totals.subtotal); r.balance = r2(r.balance + i.balance); } return Object.values(m).sort((a, b) => b.sales - a.sales); }],
  tires: ['Tire sales by brand & size', (f, t) => { const m = {}; for (const i of Store.list('invoices').filter((i) => i.date >= f && i.date <= t)) for (const l of i.lines.filter((l) => l.type === 'tire')) { const it = Store.get('inventory', l.item_id) || {}; const k = (it.brand || '?') + ' ' + (it.size || ''); const r = (m[k] ||= { brand_size: k, units: 0, sales: 0, cost: 0 }); r.units += +l.qty; r.sales = r2(r.sales + l.qty * l.price); r.cost = r2(r.cost + l.qty * l.cost); } return Object.values(m).map((r) => ({ ...r, margin_pct: pct(r.sales - r.cost, r.sales) })).sort((a, b) => b.units - a.units); }],
  payments: ['Payment method mix', (f, t) => { const m = {}; for (const p of Store.list('payments').filter((p) => p.date >= f && p.date <= t)) { const r = (m[p.method] ||= { method: p.method, count: 0, amount: 0 }); r.count++; r.amount = r2(r.amount + p.amount); } return Object.values(m); }],
  daily: ['Daily sales & car count', (f, t) => { const m = {}; for (const i of Store.list('invoices').filter((i) => i.date >= f && i.date <= t && inLoc(i))) { const r = (m[i.date] ||= { date: i.date, cars: 0, sales: 0, gross_profit: 0 }); r.cars++; r.sales = r2(r.sales + i.totals.subtotal); r.gross_profit = r2(r.gross_profit + i.totals.margin); } return Object.values(m).sort((a, b) => b.date.localeCompare(a.date)); }],
  locations: ['Sales by location', (f, t) => Store.list('locations').map((l) => { const inv = Store.list('invoices').filter((i) => i.location_id === l.id && i.date >= f && i.date <= t); return { location: l.name, invoices: inv.length, sales: r2(inv.reduce((a, i) => a + i.totals.subtotal, 0)) }; })],
  wo_cycle: ['Work order cycle time', () => Store.list('workorders').filter((w) => w.status === 'Invoiced').map((w) => { const inv = Store.get('invoices', w.invoice_id); return { wo: w.number, opened: w.date, invoiced: inv?.date || '', days: inv ? Math.round((new Date(inv.date) - new Date(w.date)) / 864e5) : '' }; })],
};
VIEWS.reports = (el) => {
  const k = S.sub || 'sales_category', [title, fn] = REPORTS[k], rows = fn(range().from, range().to);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><select style="width:auto" onchange="go('reports',this.value)">${Object.entries(REPORTS).map(([key, [t]]) => `<option value="${key}" ${key === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><span class="grow"></span>
    <button class="btn sm" onclick="csvDownload('${k}',REPORTS['${k}'][1](range().from,range().to))">Export CSV</button>${can('ai') ? `<button class="btn ai sm" onclick="aiRun('report','Analyze this ${esc(title)} report and give me three actions.',{report:REPORTS['${k}'][1](range().from,range().to)})">✨ Explain</button>` : ''}</div>
    ${rangeBar('reports', k)}<div class="card tablewrap" style="padding:0"><table class="t"><tr>${cols.map((c) => `<th class="${typeof rows[0][c] === 'number' ? 'num' : ''}">${esc(c.replace(/_/g, ' '))}</th>`).join('')}</tr>
    ${rows.map((r) => `<tr>${cols.map((c) => `<td class="${typeof r[c] === 'number' ? 'num' : ''}">${typeof r[c] === 'number' && /amount|sales|cost|balance|profit/.test(c) ? money(r[c]) : esc(r[c])}</td>`).join('')}</tr>`).join('') || '<tr><td class="empty">No data in this range</td></tr>'}</table></div>
    ${k === 'tech' ? '<p class="small muted">Efficiency = flagged (billed) hours ÷ clocked hours. Under 75% usually means unbilled labour, comebacks, or idle time.</p>' : ''}`;
};
