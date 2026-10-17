/* ================= ACCOUNTING & PAYROLL ================= */
const acctTab = (k) => go('accounting', k);
VIEWS.accounting = (el) => {
  let tab = S.sub || 'invoices';
  if (tab.startsWith('inv:')) return invoiceView(el, tab.slice(4));
  if (tab.startsWith('bill:')) return billView(el, tab.slice(5));
  const T = [['invoices', 'Invoices (A/R)'], ['bills', 'Bills (A/P)'], ['banking', 'Banking'], ['journal', 'Journal'], ['coa', 'Chart of accounts'], ['statements', 'Financial statements'], ['tax', 'GST/HST'], ['close', 'Period close']];
  el.innerHTML = tabs(T, tab, 'acctTab') + '<div id="acTab"></div>';
  ACCT[tab]($('#acTab'));
};
const range = () => (S.range ||= { from: today().slice(0, 8) + '01', to: today() });
const rangeBar = (view, sub) => `<div class="row" style="margin-bottom:10px"><label style="margin:0">From</label><input type="date" style="width:auto" value="${range().from}" onchange="S.range.from=this.value;go('${view}','${sub}')"><label style="margin:0">To</label><input type="date" style="width:auto" value="${range().to}" onchange="S.range.to=this.value;go('${view}','${sub}')">
  ${[['MTD', today().slice(0, 8) + '01', today()], ['Last 30', addDays(today(), -30), today()], ['YTD', today().slice(0, 4) + '-01-01', today()]].map(([l, f, t]) => `<button class="btn sm" onclick="S.range={from:'${f}',to:'${t}'};go('${view}','${sub}')">${l}</button>`).join('')}</div>`;
const ACCT = {
  invoices(el) {
    const ag = E.aging(Store.list('invoices').filter(inLoc), today());
    const rows = Store.list('invoices').filter(inLoc).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
    el.innerHTML = `<div class="grid g4">${[['Current', ag.buckets.current], ['1-30 days', ag.buckets.d30], ['31-60 days', ag.buckets.d60], ['60+ days', ag.buckets.d90]].map(([l, v]) => `<div class="card kpi"><div class="l">${l}</div><div class="v">${money(v)}</div></div>`).join('')}</div>
      <div class="row" style="margin:12px 0"><b class="grow">Total A/R ${money(ag.buckets.total)}</b><button class="btn sm" onclick="csvDownload('invoices',Store.list('invoices').map(i=>({number:i.number,date:i.date,customer:custName(i.customer_id),total:i.totals.total,balance:i.balance,status:i.status})))">Export</button>${can('accounting', 'edit') ? `<button class="btn sm" onclick="statementRun()">Customer statements</button>` : ''}</div>
      <div class="card tablewrap" style="padding:0"><table class="t"><tr><th>Number</th><th>Date</th><th>Due</th><th>Customer</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr>${rows.slice(0, 300).map((i) => { const od = i.balance > 0 && i.due < today(); return `<tr class="click" onclick="go('accounting','inv:${i.id}')"><td>${esc(i.number)}</td><td>${fdate(i.date)}</td><td>${fdate(i.due)}</td><td>${esc(custName(i.customer_id))}</td><td class="num">${money(i.totals.total)}</td><td class="num">${money(i.balance)}</td><td>${statusPill(od ? 'Overdue' : i.status)}</td></tr>`; }).join('')}</table></div>`;
  },
  bills(el) {
    const ag = E.aging(Store.list('bills'), today());
    el.innerHTML = `<div class="grid g4">${[['Current', ag.buckets.current], ['1-30 days', ag.buckets.d30], ['31-60 days', ag.buckets.d60], ['60+ days', ag.buckets.d90]].map(([l, v]) => `<div class="card kpi"><div class="l">${l} payable</div><div class="v">${money(v)}</div></div>`).join('')}</div>
      <div class="row" style="margin:12px 0"><b class="grow">Total A/P ${money(ag.buckets.total)}</b>${can('accounting', 'edit') ? `<button class="btn primary" onclick="newBill()">+ Enter bill / expense</button>` : ''}</div>
      <div class="card tablewrap" style="padding:0"><table class="t"><tr><th>Bill #</th><th>Vendor</th><th>Date</th><th>Due</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr>${Store.list('bills').slice().sort((a, b) => b.date.localeCompare(a.date)).map((b) => `<tr class="click" onclick="go('accounting','bill:${b.id}')"><td>${esc(b.number)}</td><td>${esc(b.vendorName || Store.get('vendors', b.vendor_id)?.name || '')}</td><td>${fdate(b.date)}</td><td>${fdate(b.due)}</td><td class="num">${money(b.total)}</td><td class="num">${money(b.balance)}</td><td>${statusPill(b.balance > 0 && b.due < today() ? 'Overdue' : b.status)}</td></tr>`).join('')}</table></div>`;
  },
  banking(el) {
    const tx = Store.list('bank_txns').sort((a, b) => b.date.localeCompare(a.date));
    const book = E.balances(Store.list('journal'), accounts()).find((a) => a.code === '1000')?.balance || 0;
    el.innerHTML = `<div class="grid g3"><div class="card kpi"><div class="l">Book balance (1000 Bank)</div><div class="v">${money(book)}</div></div><div class="card kpi"><div class="l">Unreviewed bank lines</div><div class="v">${tx.filter((t) => !t.posted).length}</div></div>
      <div class="card"><b>Import bank statement</b><div class="small muted">CSV with date, description, amount (negative = withdrawal). Works with any Canadian bank's export.</div><input type="file" accept=".csv" onchange="bankImport(this.files[0])" style="margin-top:6px"></div></div>
      <div class="row" style="margin:12px 0"><span class="grow"></span>${can('ai') && tx.some((t) => !t.posted) ? `<button class="btn ai sm" onclick="aiCategorize()">✨ AI categorize</button>` : ''}</div>
      <div class="card tablewrap" style="padding:0"><table class="t"><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Account</th><th></th></tr>${tx.map((t) => `<tr><td>${fdate(t.date)}</td><td>${esc(t.description)}${t.ai ? `<div class="small muted">AI: ${esc(t.ai)}</div>` : ''}</td><td class="num" style="color:${t.amount < 0 ? 'var(--bad)' : 'var(--good)'}">${money(t.amount)}</td>
        <td>${t.posted ? esc(accName(t.account)) + (t.matched ? ' <span class="pill good">matched</span>' : '') : `<select id="ba_${t.id}">${matchOptions(t)}${accounts().filter((a) => a.code !== '1000').map((a) => `<option value="${a.code}" ${a.code === t.account ? 'selected' : ''}>${a.code} ${esc(a.name)}</option>`).join('')}</select>`}</td>
        <td>${t.posted ? '✓' : `<button class="btn sm primary" onclick="bankPost('${t.id}')">Post</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Import a statement to start reconciling</td></tr>'}</table></div>`;
  },
  journal(el) {
    const j = Store.list('journal').filter((e) => e.date >= range().from && e.date <= range().to).sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = rangeBar('accounting', 'journal') + `<div class="row" style="margin-bottom:10px"><span class="grow muted small">${j.length} entries</span>${can('accounting', 'edit') ? `<button class="btn primary" onclick="manualJE()">+ Journal entry</button>` : ''}</div>
      <div class="card tablewrap" style="padding:0"><table class="t"><tr><th>Date</th><th>Memo</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr>${j.slice(0, 200).map((e) => e.lines.map((l, i) => `<tr><td>${i ? '' : fdate(e.date)}</td><td>${i ? '' : esc(e.memo)}</td><td>${esc(l.account)} ${esc(accName(l.account))}</td><td class="num">${l.debit ? money(l.debit) : ''}</td><td class="num">${l.credit ? money(l.credit) : ''}</td></tr>`).join('')).join('')}</table></div>`;
  },
  coa(el) {
    const bal = Object.fromEntries(E.balances(Store.list('journal'), accounts()).map((a) => [a.code, a.balance]));
    el.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="grow"></span>${can('accounting', 'edit') ? `<button class="btn primary" onclick="editRecord('accounts',null,{type:'expense'})">+ Account</button>` : ''}</div><div class="card tablewrap" style="padding:0"><table class="t"><tr><th>Code</th><th>Name</th><th>Type</th><th class="num">Balance</th></tr>${accounts().map((a) => `<tr class="click" onclick="editRecord('accounts','${a.id}')"><td class="mono">${esc(a.code)}</td><td>${esc(a.name)}</td><td>${esc(a.type)}</td><td class="num">${money(bal[a.code])}</td></tr>`).join('')}</table></div>`;
  },
  statements(el) {
    const j = Store.list('journal'), p = E.pnl(j, accounts(), range().from, range().to), bs = E.balanceSheet(j, accounts(), range().to), tb = E.balances(j, accounts(), null, range().to).filter((a) => a.debit || a.credit);
    const sec = (title, rows, total, label) => `<tr><td colspan="2"><b>${title}</b></td></tr>${rows.map((a) => `<tr><td style="padding-left:20px">${esc(a.code)} ${esc(a.name)}</td><td class="num">${money(a.balance)}</td></tr>`).join('')}<tr><td><b>${label}</b></td><td class="num"><b>${money(total)}</b></td></tr>`;
    el.innerHTML = rangeBar('accounting', 'statements') + `<div class="grid g2"><div class="card"><h3>Income statement · ${fdate(range().from)} to ${fdate(range().to)}</h3><table class="t">
        ${sec('Revenue', p.rows.filter((a) => a.type === 'revenue'), p.revenue, 'Total revenue')}${sec('Cost of goods sold', p.rows.filter((a) => a.type === 'cogs'), p.cogs, 'Total COGS')}
        <tr><td><b>Gross profit</b> (${pct(p.gross, p.revenue)}%)</td><td class="num"><b>${money(p.gross)}</b></td></tr>${sec('Operating expenses', p.rows.filter((a) => a.type === 'expense'), p.expense, 'Total expenses')}
        <tr><td><b>Net income</b></td><td class="num" style="font-size:16px"><b>${money(p.net)}</b></td></tr></table></div>
      <div class="card"><h3>Balance sheet · as of ${fdate(range().to)} ${bs.balanced ? '<span class="pill good">balanced</span>' : '<span class="pill bad">out of balance</span>'}</h3><table class="t">
        ${sec('Assets', bs.rows.filter((a) => a.type === 'asset'), bs.assets, 'Total assets')}${sec('Liabilities', bs.rows.filter((a) => a.type === 'liability'), bs.liabilities, 'Total liabilities')}
        ${sec('Equity', [...bs.rows.filter((a) => a.type === 'equity'), { code: '', name: 'Current earnings', balance: bs.earnings }], bs.equity, 'Total equity')}</table></div></div>
      <div class="card tablewrap" style="margin-top:12px"><h3>Trial balance</h3><table class="t"><tr><th>Account</th><th class="num">Debits</th><th class="num">Credits</th></tr>${tb.map((a) => `<tr><td>${esc(a.code)} ${esc(a.name)}</td><td class="num">${money(a.debit)}</td><td class="num">${money(a.credit)}</td></tr>`).join('')}
        <tr><td><b>Totals</b></td><td class="num"><b>${money(tb.reduce((s, a) => s + a.debit, 0))}</b></td><td class="num"><b>${money(tb.reduce((s, a) => s + a.credit, 0))}</b></td></tr></table>
        <button class="btn sm" style="margin-top:8px" onclick="csvDownload('trial-balance',E.balances(Store.list('journal'),accounts(),null,'${range().to}').map(({code,name,type,debit,credit,balance})=>({code,name,type,debit,credit,balance})))">Export for accountant (CSV)</button></div>`;
  },
  tax(el) {
    const g = E.gstReturn(Store.list('journal'), range().from, range().to), pstBal = E.balances(Store.list('journal'), accounts(), range().from, range().to).find((a) => a.code === '2210')?.balance || 0;
    const env = E.balances(Store.list('journal'), accounts(), range().from, range().to).find((a) => a.code === '2220')?.balance || 0;
    el.innerHTML = rangeBar('accounting', 'tax') + `<div class="card"><h3>GST/HST return worksheet (GST34) · ${fdate(range().from)} to ${fdate(range().to)}</h3><table class="t">
      <tr><td>Line 101: Sales and other revenue</td><td class="num">${money(g.line101)}</td></tr><tr><td>Line 103: GST/HST collected</td><td class="num">${money(g.line103)}</td></tr>
      <tr><td>Line 106: Input tax credits (ITCs)</td><td class="num">${money(g.line106)}</td></tr><tr><td><b>Line 109: Net tax ${g.line109 >= 0 ? 'owing' : 'refund'}</b></td><td class="num"><b>${money(Math.abs(g.line109))}</b></td></tr></table>
      <p class="small muted">File via CRA My Business Account or GST/HST NETFILE. Keep supporting invoices 6 years (CRA).</p></div>
      <div class="grid g2" style="margin-top:12px"><div class="card kpi"><div class="l">Provincial sales tax collected (${esc(ST().province)})</div><div class="v">${money(pstBal)}</div><div class="small muted">${ST().province === 'AB' ? 'Alberta has no PST.' : 'Remit to your provincial ministry of finance.'}</div></div>
      <div class="card kpi"><div class="l">Tire recycling levies collected</div><div class="v">${money(env)}</div><div class="small muted">${ST().province === 'AB' ? 'Remit to Alberta Recycling Management Authority (ARMA).' : 'Remit to your provincial tire stewardship program.'}</div></div></div>`;
  },
  close(el) {
    el.innerHTML = `<div class="card"><h3>Lock accounting periods</h3><p class="muted">Entries dated on or before the lock date can't be added, changed or deleted, which protects filed GST returns and year-end statements.</p>
      <div class="row"><input type="date" id="lockd" style="width:auto" value="${esc(ST().lock_date || '')}"><button class="btn primary" onclick="ST().lock_date=$('#lockd').value;Store.saveTenant();toast('Lock date saved')" ${can('accounting', 'edit') ? '' : 'disabled'}>Save lock date</button></div>
      <h3 style="margin-top:20px">Month-end checklist</h3>${['Reconcile bank and card clearing accounts', 'Review A/R aging and send statements', 'Enter all vendor bills and receive open POs', 'Count tire inventory (cycle count high-value SKUs)', 'Post payroll and verify CRA remittance (PD7A)', 'File / accrue GST/HST', 'Remit tire recycling levies', 'Review P&L vs last month; investigate margin changes'].map((t) => `<label class="row" style="color:var(--ink);font-size:14px"><input type="checkbox"> ${esc(t)}</label>`).join('')}</div>`;
  },
};
function matchOptions(t) {
  const cands = [...Store.list('payments').filter((p) => Math.abs(p.amount - t.amount) < 0.01 && Math.abs(new Date(p.date) - new Date(t.date)) < 4 * 864e5).map((p) => `<option value="match:payment:${p.id}">Match payment ${esc(Store.get('invoices', p.invoice_id)?.number || '')} ${fdate(p.date)}</option>`),
    ...Store.list('bills').filter((b) => Math.abs(b.total + t.amount) < 0.01).map((b) => `<option value="match:bill:${b.id}">Match bill ${esc(b.number)} ${esc(b.vendorName || '')}</option>`)];
  return cands.join('');
}
async function bankImport(file) {
  if (!file) return;
  const rows = parseCSV(await file.text());
  let n = 0;
  for (const r of rows) { const amt = Number(String(r.amount || r.amt || (r.credit ? r.credit : r.debit ? '-' + r.debit : '')).replace(/[$,]/g, '')); if (!r.date || isNaN(amt)) continue; await Store.save('bank_txns', { date: new Date(r.date).toISOString().slice(0, 10), description: r.description || r.desc || r.memo || '', amount: amt, posted: false }); n++; }
  toast(`${n} bank lines imported`); go('accounting', 'banking');
}
async function bankPost(id) {
  const t = Store.get('bank_txns', id), v = $('#ba_' + id).value;
  if (v.startsWith('match:')) {
    const [, kind, rid] = v.split(':');
    if (kind === 'bill') { const b = Store.get('bills', rid); if (b.balance > 0) { await postJournal(E.postBillPayment(b, Math.abs(t.amount), t.date)); b.balance = 0; b.status = 'Paid'; await Store.save('bills', b); } }
    t.matched = kind + ':' + rid; t.account = kind === 'bill' ? '2000' : '1100';
  } else {
    t.account = v;
    await postJournal(E.je(t.date, t.description, `bank:${t.id}`, t.amount >= 0 ? [{ account: '1000', debit: t.amount }, { account: v, credit: t.amount }] : [{ account: v, debit: -t.amount }, { account: '1000', credit: -t.amount }]));
  }
  t.posted = true; await Store.save('bank_txns', t); go('accounting', 'banking');
}
function manualJE() {
  S.je = { date: today(), memo: '', lines: [{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }] };
  const render = () => {
    const d = r2(S.je.lines.reduce((a, l) => a + (+l.debit || 0), 0)), c = r2(S.je.lines.reduce((a, l) => a + (+l.credit || 0), 0));
    $('#jeb').innerHTML = `<div class="grid g2"><div><label>Date</label><input type="date" value="${S.je.date}" onchange="S.je.date=this.value"></div><div><label>Memo</label><input value="${esc(S.je.memo)}" onchange="S.je.memo=this.value"></div></div>
      <table class="t" style="margin-top:8px">${S.je.lines.map((l, i) => `<tr><td><select onchange="S.je.lines[${i}].account=this.value"><option value="">Account...</option>${accounts().map((a) => `<option value="${a.code}" ${a.code === l.account ? 'selected' : ''}>${a.code} ${esc(a.name)}</option>`).join('')}</select></td><td><input type="number" step="0.01" placeholder="Debit" value="${l.debit || ''}" onchange="S.je.lines[${i}].debit=+this.value;window._jer()"></td><td><input type="number" step="0.01" placeholder="Credit" value="${l.credit || ''}" onchange="S.je.lines[${i}].credit=+this.value;window._jer()"></td></tr>`).join('')}</table>
      <div class="row"><button class="btn sm" onclick="S.je.lines.push({account:'',debit:0,credit:0});window._jer()">+ Line</button><span class="grow"></span><span class="pill ${Math.abs(d - c) < 0.005 && d > 0 ? 'good' : 'bad'}">Dr ${money(d)} / Cr ${money(c)}</span></div>`;
  };
  window._jer = render;
  modal('Journal entry', '<div id="jeb"></div>', [{ label: 'Cancel' }, { label: 'Post', cls: 'primary', onClick: async () => { try { await postJournal(E.je(S.je.date, S.je.memo || 'Manual entry', 'manual', S.je.lines.filter((l) => l.account))); toast('Posted'); go('accounting', 'journal'); } catch (e) { toast(e.message, 'bad'); return true; } } }]);
  render();
}
function invoiceView(el, id) {
  const i = Store.get('invoices', id);
  if (!i) return (el.innerHTML = '<div class="empty">Invoice not found</div>');
  const pays = Store.list('payments').filter((p) => p.invoice_id === id);
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn sm" onclick="go('accounting','invoices')">← Invoices</button><h2 class="grow" style="margin:0">${esc(i.number)} ${statusPill(i.balance > 0 && i.due < today() ? 'Overdue' : i.status)}</h2>
    <button class="btn sm" onclick="printInvoice('${id}')">Print / PDF</button>${i.balance > 0 && can('accounting', 'edit') || i.balance > 0 && can('pos', 'edit') ? `<button class="btn primary sm" onclick="takePayment('${id}')">Take payment</button>` : ''}</div>
    <div class="grid g3"><div class="card"><b>${esc(custName(i.customer_id))}</b><br>${esc(vehName(i.vehicle_id))}<br><span class="muted">${fdate(i.date)} · due ${fdate(i.due)}</span></div><div class="card kpi"><div class="l">Total</div><div class="v">${money(i.totals.total)}</div></div><div class="card kpi"><div class="l">Balance</div><div class="v">${money(i.balance)}</div></div></div>
    <div class="card tablewrap" style="margin-top:12px"><table class="t"><tr><th>Description</th><th class="num">Qty/Hrs</th><th class="num">Amount</th></tr>${i.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td class="num">${esc(l.type === 'labour' ? l.hours : l.qty)}</td><td class="num">${money(E.lineAmount(l))}</td></tr>`).join('')}
      <tr><td colspan="2" class="right">Subtotal</td><td class="num">${money(i.totals.subtotal)}</td></tr><tr><td colspan="2" class="right">Tax</td><td class="num">${money(i.totals.gst + i.totals.pst)}</td></tr></table></div>
    <div class="card" style="margin-top:12px"><h3>Payments</h3>${pays.map((p) => `<div>${fdate(p.date)} · ${esc(p.method)} · ${money(p.amount)} ${p.ref ? `<span class="muted">(${esc(p.ref)})</span>` : ''}</div>`).join('') || '<div class="muted">None</div>'}</div>`;
}
function billView(el, id) {
  const b = Store.get('bills', id);
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn sm" onclick="go('accounting','bills')">← Bills</button><h2 class="grow" style="margin:0">${esc(b.number)} · ${esc(b.vendorName || '')} ${statusPill(b.status)}</h2>
    ${b.balance > 0 && can('accounting', 'edit') ? `<button class="btn primary sm" onclick="payBill('${id}')">Pay bill</button>` : ''}</div>
    <div class="card"><table class="t">${b.lines.map((l) => `<tr><td>${esc(accName(l.account))}</td><td>${esc(l.desc || '')}</td><td class="num">${money((l.qty || 1) * l.cost)}</td></tr>`).join('')}<tr><td colspan="2" class="right">GST/HST (ITC)</td><td class="num">${money(b.gst)}</td></tr><tr><td colspan="2" class="right"><b>Total</b></td><td class="num"><b>${money(b.total)}</b></td></tr><tr><td colspan="2" class="right">Balance</td><td class="num">${money(b.balance)}</td></tr></table></div>`;
}
async function payBill(id) {
  const b = Store.get('bills', id);
  modal('Pay bill', `<div class="grid g2"><div><label>Amount</label><input id="bpa" type="number" step="0.01" value="${b.balance}"></div><div><label>Date</label><input id="bpd" type="date" value="${today()}"></div></div>`, [{ label: 'Cancel' }, { label: 'Pay', cls: 'primary', onClick: async () => {
    const amt = r2(+$('#bpa').value); await postJournal(E.postBillPayment(b, amt, $('#bpd').value)); b.balance = r2(b.balance - amt); b.status = b.balance <= 0 ? 'Paid' : 'Partial'; await Store.save('bills', b); go('accounting', 'bill:' + id);
  } }], { narrow: true });
}
function newBill() {
  const exp = accounts().filter((a) => ['expense', 'asset', 'cogs'].includes(a.type));
  modal('Enter bill / expense', `<div class="grid g2"><div><label>Vendor</label><input id="nbv" list="vlist"><datalist id="vlist">${Store.list('vendors').map((v) => `<option value="${esc(v.name)}">`).join('')}</datalist></div><div><label>Bill #</label><input id="nbn"></div>
    <div><label>Date</label><input id="nbd" type="date" value="${today()}"></div><div><label>Due</label><input id="nbdue" type="date" value="${addDays(today(), 30)}"></div>
    <div><label>Account</label><select id="nba">${exp.map((a) => `<option value="${a.code}">${a.code} ${esc(a.name)}</option>`).join('')}</select></div><div><label>Amount before tax</label><input id="nbamt" type="number" step="0.01"></div>
    <div><label>GST/HST paid (ITC)</label><input id="nbg" type="number" step="0.01" placeholder="auto"></div><div><label>Description</label><input id="nbdesc"></div></div>`,
    [{ label: 'Cancel' }, { label: 'Save bill', cls: 'primary', onClick: async () => {
      const sub = r2(+$('#nbamt').value), gst = $('#nbg').value === '' ? r2(sub * E.taxFor(ST().province, ST().taxOverride).gst) : r2(+$('#nbg').value);
      if (!(sub > 0)) { toast('Enter an amount', 'bad'); return true; }
      const vname = $('#nbv').value, v = Store.list('vendors').find((x) => x.name === vname);
      const b = await Store.save('bills', { number: $('#nbn').value || 'EXP-' + Date.now().toString(36).slice(-5), vendor_id: v?.id || '', vendorName: vname, date: $('#nbd').value, due: $('#nbdue').value, lines: [{ account: $('#nba').value, desc: $('#nbdesc').value, qty: 1, cost: sub }], subtotal: sub, gst, total: r2(sub + gst), balance: r2(sub + gst), status: 'Open' });
      await postJournal(E.postBill(b)); toast('Bill posted to A/P'); go('accounting', 'bills');
    } }]);
}
function statementRun() {
  const owing = Store.list('customers').map((c) => ({ c, invs: Store.list('invoices').filter((i) => i.customer_id === c.id && i.balance > 0) })).filter((x) => x.invs.length);
  openPrint(`<!doctype html><html><head><meta charset="utf-8"><title>Statements</title><style>body{font:13px system-ui;margin:30px}.pg{page-break-after:always}td,th{padding:4px 8px;border-bottom:1px solid #ddd;text-align:left}</style></head><body>${owing.map(({ c, invs }) => `<div class="pg"><h2>${esc(ST().branding.name)}: Statement of account</h2><p>${esc(c.name)}<br>As of ${fdate(today())}</p><table><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Balance</th></tr>${invs.map((i) => `<tr><td>${esc(i.number)}</td><td>${fdate(i.date)}</td><td>${fdate(i.due)}</td><td>${money(i.balance)}</td></tr>`).join('')}</table><h3>Total due ${money(invs.reduce((a, i) => a + i.balance, 0))}</h3><p><small>Interest of ${ST().lateFeePctMonthly}% per month (${r2(ST().lateFeePctMonthly * 12)}% per annum) applies to overdue balances.</small></p></div>`).join('') || '<p>No balances owing.</p>'}<script>onload=()=>print()<\/script></body></html>`);
}

// ---------------- Payroll ----------------
const payTab = (k) => go('payroll', k);
const payTables = () => { const t = JSON.parse(JSON.stringify(E.PAYROLL_2026)); const o = ST().payrollTables; if (o) { Object.assign(t, o); t.prov = { ...E.PAYROLL_2026.prov, ...(o.prov || {}) }; } return t; };
VIEWS.payroll = (el) => {
  const tab = S.sub || 'run';
  el.innerHTML = tabs([['run', 'Run payroll'], ['history', 'Pay runs'], ['employees', 'Employees'], ['remit', 'CRA remittance'], ['t4', 'T4 / year-end'], ['tables', 'Rates & tables']], tab, 'payTab') + '<div id="pyTab"></div>';
  PAY[tab]($('#pyTab'));
};
function ytdFor(empId, year, beforeDate) {
  const y = { gross: 0, cpp: 0, cpp2: 0, ei: 0, fedTax: 0, provTax: 0, net: 0, vacation: 0, hours: 0 };
  for (const run of Store.list('payruns')) if (run.payDate.startsWith(String(year)) && (!beforeDate || run.payDate < beforeDate)) for (const r of run.rows) if (r.employee_id === empId) for (const k of Object.keys(y)) y[k] = r2(y[k] + (+r[k] || 0));
  return y;
}
function computePayRow(e, start, end, P, adj = {}) {
  const R = payTables();
  const ts = Store.list('timesheets').filter((t) => t.employee_id === e.id && t.date >= start && t.date <= end && t.approved !== false);
  const weeks = {};
  for (const t of ts) (weeks[E.weekKey(t.date)] ||= []).push(t);
  let reg = 0, ot = 0;
  for (const w of Object.values(weeks)) { const o = E.albertaOvertime(w); reg += o.regular; ot += o.overtime; }
  let flagged = 0;
  for (const inv of Store.list('invoices').filter((i) => i.date >= start && i.date <= end)) for (const l of inv.lines) if (l.type === 'labour' && l.tech_id === e.id) flagged += +l.hours || 0;
  flagged = r2(flagged);
  let base = 0, sales = 0;
  if (e.pay_type === 'salary') base = r2((+e.rate || 0) / P);
  else if (e.pay_type === 'flat_rate') base = r2(flagged * (+e.flat_rate || 0));
  else base = r2(reg * (+e.rate || 0) + ot * (+e.rate || 0) * 1.5);
  if (+e.commission_pct > 0) { for (const inv of Store.list('invoices').filter((i) => i.date >= start && i.date <= end)) sales += inv.totals.subtotal; }
  const commission = r2(sales * (+e.commission_pct || 0) / 100 * (e.pay_type === 'commission' ? 1 : 0.25)); // advisors: shared pool (25% weight) - configurable policy
  const bonus = +adj.bonus || 0;
  const vacation = r2((base + commission + bonus) * (+e.vacation_pct || 0) / 100);
  const gross = r2(base + commission + bonus + vacation);
  const y = ytdFor(e.id, end.slice(0, 4), end);
  const calc = E.payroll(gross, P, y, e, R);
  const flags = [];
  const clocked = r2(reg + ot), minW = R.minWage?.[e.province];
  if (e.pay_type === 'flat_rate' && minW && clocked > 0 && base < clocked * minW) flags.push(`Flat-rate pay ${money(base)} is below minimum wage for ${clocked} clocked hours (${money(clocked * minW)}). Top-up required.`);
  if (ot > 0 && e.pay_type !== 'hourly') flags.push(`${ot} overtime hours recorded on a ${e.pay_type} employee: confirm the overtime agreement.`);
  return { employee_id: e.id, name: e.name, pay_type: e.pay_type, hours: clocked, regular: r2(reg), overtime: r2(ot), flagged, base, commission, bonus, vacation, ...calc, flags };
}
const PAY = {
  run(el) {
    const P = ST().payrollPeriods || 26;
    S.pr ||= { start: addDays(E.weekKey(today()), -14), end: addDays(E.weekKey(today()), -1), payDate: addDays(E.weekKey(today()), 4), adj: {} };
    const emps = Store.list('employees').filter((e) => e.active !== false);
    let rows = [], err = '';
    try { rows = emps.map((e) => computePayRow(e, S.pr.start, S.pr.end, P, S.pr.adj[e.id])); } catch (e) { err = e.message; }
    S.prRows = rows;
    const tot = (k) => r2(rows.reduce((a, r) => a + (+r[k] || 0), 0));
    el.innerHTML = `<div class="card grid g4"><div><label>Period start</label><input type="date" value="${S.pr.start}" onchange="S.pr.start=this.value;go('payroll','run')"></div><div><label>Period end</label><input type="date" value="${S.pr.end}" onchange="S.pr.end=this.value;go('payroll','run')"></div>
      <div><label>Pay date</label><input type="date" value="${S.pr.payDate}" onchange="S.pr.payDate=this.value"></div><div><label>Frequency</label><select onchange="ST().payrollPeriods=+this.value;Store.saveTenant();go('payroll','run')">${[[52, 'Weekly'], [26, 'Bi-weekly'], [24, 'Semi-monthly'], [12, 'Monthly']].map(([v, l]) => `<option value="${v}" ${v === P ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      ${err ? `<div class="flag bad">${esc(err)}</div>` : ''}
      <div class="flag info small">Source deductions use the CRA T4127 annualization method with ${payTables().year} rates (CPP 5.95% + CPP2 4%, EI ${(payTables().ei.rate * 100).toFixed(2)}%, federal 14% bracket, ${esc(ST().province)} provincial). Overtime follows Alberta rules (over 8 h/day or 44 h/week at 1.5×). Verify against CRA PDOC before your first live run.</div>
      <div class="card tablewrap" style="padding:0;margin-top:10px"><table class="t"><tr><th>Employee</th><th class="num">Hrs (OT)</th><th class="num">Flagged</th><th class="num">Bonus</th><th class="num">Gross</th><th class="num">CPP+CPP2</th><th class="num">EI</th><th class="num">Fed tax</th><th class="num">Prov tax</th><th class="num">Net</th></tr>
      ${rows.map((r) => `<tr><td><b>${esc(r.name)}</b><div class="small muted">${esc(r.pay_type)}</div>${r.flags.map((f) => `<div class="small" style="color:var(--warn)">⚠ ${esc(f)}</div>`).join('')}</td><td class="num">${r.hours} (${r.overtime})</td><td class="num">${r.flagged}</td>
        <td class="num" style="width:100px"><input type="number" step="0.01" value="${S.pr.adj[r.employee_id]?.bonus || ''}" onchange="(S.pr.adj['${r.employee_id}']||={}).bonus=+this.value;go('payroll','run')"></td>
        <td class="num">${money(r.gross)}</td><td class="num">${money(r.cpp + r.cpp2)}</td><td class="num">${money(r.ei)}</td><td class="num">${money(r.fedTax)}</td><td class="num">${money(r.provTax)}</td><td class="num"><b>${money(r.net)}</b></td></tr>`).join('')}
      <tr><td><b>Totals</b></td><td></td><td></td><td></td><td class="num"><b>${money(tot('gross'))}</b></td><td class="num">${money(tot('cpp') + tot('cpp2'))}</td><td class="num">${money(tot('ei'))}</td><td class="num">${money(tot('fedTax'))}</td><td class="num">${money(tot('provTax'))}</td><td class="num"><b>${money(tot('net'))}</b></td></tr></table></div>
      <div class="row" style="margin-top:10px"><span class="small muted grow">Employer cost: CPP ${money(tot('erCpp'))} + EI ${money(tot('erEi'))}. Total CRA remittance for this run: <b>${money(tot('deductions') + tot('erCpp') + tot('erEi'))}</b></span>
      ${can('ai') ? `<button class="btn ai sm" onclick="aiRun('anomaly','Check this pay run for anomalies before I post it.',{run:S.prRows})">✨ AI check</button>` : ''}
      ${can('payroll', 'edit') && !err ? `<button class="btn primary" onclick="postPayrunUI()">Approve & post pay run</button>` : ''}</div>`;
  },
  history(el) {
    const runs = Store.list('payruns').sort((a, b) => b.payDate.localeCompare(a.payDate));
    el.innerHTML = `<div class="card tablewrap" style="padding:0"><table class="t"><tr><th>Pay date</th><th>Period</th><th class="num">Employees</th><th class="num">Gross</th><th class="num">Net</th><th></th></tr>${runs.map((r) => `<tr><td>${fdate(r.payDate)}</td><td>${fdate(r.periodStart)} to ${fdate(r.periodEnd)}</td><td class="num">${r.rows.length}</td><td class="num">${money(r.rows.reduce((a, x) => a + x.gross, 0))}</td><td class="num">${money(r.rows.reduce((a, x) => a + x.net, 0))}</td><td><button class="btn sm" onclick="printStubs('${r.id}')">Pay stubs</button></td></tr>`).join('') || '<tr><td class="empty" colspan="6">No pay runs posted yet</td></tr>'}</table></div>`;
  },
  employees(el) { listView(el, 'employees', { onNew: `editRecord('employees',null,{province:ST().province,vacation_pct:4,pay_type:'hourly',active:true})` }); },
  remit(el) {
    const months = {};
    for (const r of Store.list('payruns')) { const m = r.payDate.slice(0, 7); const t = (months[m] ||= { gross: 0, cpp: 0, ei: 0, tax: 0, count: new Set() }); for (const x of r.rows) { t.gross += x.gross; t.cpp += x.cpp + x.cpp2 + x.erCpp; t.ei += x.ei + x.erEi; t.tax += x.fedTax + x.provTax; t.count.add(x.employee_id); } }
    el.innerHTML = `<div class="card tablewrap"><h3>PD7A remittance summary (regular remitter: due the 15th of the following month)</h3><table class="t"><tr><th>Month</th><th class="num">Gross payroll</th><th class="num">CPP (ee + er)</th><th class="num">EI (ee + er)</th><th class="num">Income tax</th><th class="num">Total remittance</th><th>Due</th></tr>
      ${Object.entries(months).sort().reverse().map(([m, t]) => { const [y, mo] = m.split('-').map(Number); const due = new Date(y, mo, 15).toISOString().slice(0, 10); return `<tr><td>${m}</td><td class="num">${money(t.gross)}</td><td class="num">${money(t.cpp)}</td><td class="num">${money(t.ei)}</td><td class="num">${money(t.tax)}</td><td class="num"><b>${money(t.cpp + t.ei + t.tax)}</b></td><td>${statusPill(due < today() ? 'Overdue' : fdate(due))}</td></tr>`; }).join('') || '<tr><td class="empty" colspan="7">Post a pay run to see remittances</td></tr>'}</table>
      <p class="small muted">Pay through your bank's CRA payroll remittance option or CRA My Business Account. Late remittance penalties start at 3%.</p></div>`;
  },
  t4(el) {
    const year = S.t4y || today().slice(0, 4);
    const emps = Store.list('employees');
    el.innerHTML = `<div class="card tablewrap"><div class="row"><h3 class="grow">T4 slip data · ${year}</h3><select style="width:auto" onchange="S.t4y=this.value;go('payroll','t4')">${[0, 1, 2].map((d) => { const y = String(new Date().getFullYear() - d); return `<option ${y === year ? 'selected' : ''}>${y}</option>`; }).join('')}</select><button class="btn sm" onclick="csvDownload('t4-${year}',Store.list('employees').map(e=>{const y=ytdFor(e.id,'${year}');return {employee:e.name,sin:e.sin||'',box14:y.gross,box16:r2(y.cpp),box16A:y.cpp2,box18:y.ei,box22:r2(y.fedTax+y.provTax),box24:Math.min(y.gross,payTables().ei.mie),box26:Math.min(y.gross,payTables().cpp.ympe)}}))">Export CSV</button></div>
      <table class="t"><tr><th>Employee</th><th class="num">Box 14 Employment income</th><th class="num">16 CPP</th><th class="num">16A CPP2</th><th class="num">18 EI</th><th class="num">22 Tax deducted</th><th class="num">24 EI insurable</th><th class="num">26 CPP pensionable</th></tr>
      ${emps.map((e) => { const y = ytdFor(e.id, year); return `<tr><td>${esc(e.name)}</td><td class="num">${money(y.gross)}</td><td class="num">${money(y.cpp)}</td><td class="num">${money(y.cpp2)}</td><td class="num">${money(y.ei)}</td><td class="num">${money(y.fedTax + y.provTax)}</td><td class="num">${money(Math.min(y.gross, payTables().ei.mie))}</td><td class="num">${money(Math.min(y.gross, payTables().cpp.ympe))}</td></tr>`; }).join('')}</table>
      <p class="small muted">T4 slips and the T4 Summary are due to CRA and employees by the last day of February. File with CRA Internet File Transfer (XML) or through your payroll export connector (Wagepoint, Rise).</p></div>`;
  },
  tables(el) {
    const R = payTables();
    el.innerHTML = `<div class="card"><h3>Payroll rates (${R.year})</h3><p class="small muted">Pre-loaded for federal + Alberta. Other provinces: add their brackets and basic personal amount below (JSON) from CRA T4127 before running payroll for employees there.</p>
      <textarea id="ptj" class="mono" style="min-height:360px">${esc(JSON.stringify(R, null, 2))}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn" onclick="ST().payrollTables=null;Store.saveTenant();go('payroll','tables')">Reset to built-in</button><button class="btn primary" onclick="try{ST().payrollTables=JSON.parse($('#ptj').value);Store.saveTenant();toast('Payroll tables saved')}catch(e){toast('Invalid JSON: '+e.message,'bad')}" ${can('payroll', 'edit') ? '' : 'disabled'}>Save tables</button></div></div>`;
  },
};
async function postPayrunUI() {
  const P = ST().payrollPeriods || 26;
  const rows = Store.list('employees').filter((e) => e.active !== false).map((e) => computePayRow(e, S.pr.start, S.pr.end, P, S.pr.adj[e.id])).filter((r) => r.gross > 0);
  if (!rows.length) return toast('Nothing to pay for this period', 'bad');
  if (Store.list('payruns').some((r) => r.periodStart === S.pr.start && r.periodEnd === S.pr.end)) { if (!(await confirmBox('A pay run already exists for this period. Post another?'))) return; }
  const run = { id: uid('pay'), periodStart: S.pr.start, periodEnd: S.pr.end, payDate: S.pr.payDate, periods: P, rows: rows.map(({ flags, ...r }) => r), posted_by: S.user.name };
  await postJournal(E.postPayrun(run));
  await Store.save('payruns', run);
  S.pr = null; toast('Pay run posted to the general ledger'); go('payroll', 'history');
}
function printStubs(id) {
  const run = Store.get('payruns', id), b = ST().branding;
  openPrint(`<!doctype html><html><head><meta charset="utf-8"><title>Pay stubs</title><style>body{font:12px system-ui;margin:24px}.stub{border:1px solid #ccc;border-radius:8px;padding:14px;margin-bottom:18px;page-break-inside:avoid}td{padding:3px 8px}.r{text-align:right}</style></head><body>${run.rows.map((r) => { const y = ytdFor(r.employee_id, run.payDate.slice(0, 4)); return `<div class="stub"><b>${esc(b.name)}</b> · Statement of earnings<br>${esc(r.name)} · Period ${fdate(run.periodStart)} to ${fdate(run.periodEnd)} · Paid ${fdate(run.payDate)}
    <table style="width:100%;margin-top:8px"><tr><th align="left">Earnings</th><th class="r">Current</th><th align="left">Deductions</th><th class="r">Current</th><th class="r">YTD</th></tr>
    <tr><td>Regular / flat rate</td><td class="r">${money(r.base)}</td><td>CPP</td><td class="r">${money(r.cpp)}</td><td class="r">${money(y.cpp)}</td></tr>
    <tr><td>Commission</td><td class="r">${money(r.commission)}</td><td>CPP2</td><td class="r">${money(r.cpp2)}</td><td class="r">${money(y.cpp2)}</td></tr>
    <tr><td>Bonus</td><td class="r">${money(r.bonus)}</td><td>EI</td><td class="r">${money(r.ei)}</td><td class="r">${money(y.ei)}</td></tr>
    <tr><td>Vacation pay</td><td class="r">${money(r.vacation)}</td><td>Federal tax</td><td class="r">${money(r.fedTax)}</td><td class="r">${money(y.fedTax)}</td></tr>
    <tr><td><b>Gross</b></td><td class="r"><b>${money(r.gross)}</b></td><td>Provincial tax</td><td class="r">${money(r.provTax)}</td><td class="r">${money(y.provTax)}</td></tr>
    <tr><td>Hours ${r.hours} (OT ${r.overtime}) · flagged ${r.flagged}</td><td></td><td><b>Net pay</b></td><td class="r"><b>${money(r.net)}</b></td><td class="r">YTD gross ${money(y.gross)}</td></tr></table></div>`; }).join('')}<script>onload=()=>print()<\/script></body></html>`);
}
