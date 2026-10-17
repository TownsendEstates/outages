/* ENGINE-START: pure business logic (no DOM); unit-tested in tests/engine.test.mjs */
const Engine = (() => {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ---------------- Sales tax by province (2026) ----------------
  // gst = federal GST or the full HST; pst = provincial portion where separate.
  const TAX = {
    AB: { gst: 0.05, pst: 0, label: 'GST 5%' },
    BC: { gst: 0.05, pst: 0.07, label: 'GST 5% + PST 7%' },
    SK: { gst: 0.05, pst: 0.06, label: 'GST 5% + PST 6%' },
    MB: { gst: 0.05, pst: 0.07, label: 'GST 5% + RST 7%' },
    ON: { gst: 0.13, pst: 0, hst: true, label: 'HST 13%' },
    QC: { gst: 0.05, pst: 0.09975, label: 'GST 5% + QST 9.975%' },
    NS: { gst: 0.14, pst: 0, hst: true, label: 'HST 14%' },
    NB: { gst: 0.15, pst: 0, hst: true, label: 'HST 15%' },
    NL: { gst: 0.15, pst: 0, hst: true, label: 'HST 15%' },
    PE: { gst: 0.15, pst: 0, hst: true, label: 'HST 15%' },
    YT: { gst: 0.05, pst: 0, label: 'GST 5%' },
    NT: { gst: 0.05, pst: 0, label: 'GST 5%' },
    NU: { gst: 0.05, pst: 0, label: 'GST 5%' },
  };
  const taxFor = (prov, override) => (override && override.enabled ? { gst: +override.gst || 0, pst: +override.pst || 0, label: override.label || 'Custom tax' } : TAX[prov] || TAX.AB);

  // ---------------- Line pricing & document totals ----------------
  // line: {type:'labour'|'part'|'tire'|'fee'|'discount', qty, hours, rate, price, cost, taxable, envFee}
  function lineAmount(l) {
    if (l.type === 'labour') return r2((+l.hours || 0) * (+l.rate || 0));
    if (l.type === 'discount') return -Math.abs(r2((+l.qty || 1) * (+l.price || 0)));
    return r2((+l.qty || 0) * (+l.price || 0));
  }
  function totals(lines = [], s = {}) {
    const tax = taxFor(s.province, s.taxOverride);
    let labour = 0, parts = 0, tires = 0, fees = 0, discount = 0, cost = 0, taxable = 0, envFees = 0, tireCount = 0;
    for (const l of lines) {
      const a = lineAmount(l);
      if (l.type === 'labour') labour += a;
      else if (l.type === 'tire') { tires += a; tireCount += +l.qty || 0; }
      else if (l.type === 'part') parts += a;
      else if (l.type === 'fee') fees += a;
      else if (l.type === 'discount') discount += a;
      if (l.type === 'part' || l.type === 'tire') cost += r2((+l.qty || 0) * (+l.cost || 0));
      if (l.taxable !== false) taxable += a;
      if (l.type === 'tire' && l.envFee !== false && (s.envFeeTire || 0) > 0) envFees += r2((+l.qty || 0) * s.envFeeTire);
    }
    let supplies = 0;
    if ((s.shopSuppliesPct || 0) > 0 && labour > 0) {
      supplies = r2(labour * s.shopSuppliesPct / 100);
      if (s.shopSuppliesCap > 0) supplies = Math.min(supplies, s.shopSuppliesCap);
    }
    // Environmental levies are taxable in AB (GST applies to the levy); supplies are taxable.
    taxable += supplies + envFees;
    const gst = r2(taxable * tax.gst), pst = r2(taxable * tax.pst);
    const subtotal = r2(labour + parts + tires + fees + discount + supplies + envFees);
    const total = r2(subtotal + gst + pst);
    return { labour: r2(labour), parts: r2(parts), tires: r2(tires), fees: r2(fees), discount: r2(discount), supplies, envFees: r2(envFees), tireCount,
      subtotal, gst, pst, total, cost: r2(cost), margin: r2(subtotal - cost - envFees), taxLabel: tax.label, hst: !!tax.hst };
  }

  // Customer pricing tiers: retail uses list price; fleet / wholesale are cost-plus.
  function tierPrice(item, tier, s = {}) {
    const m = (s.markups || {})[tier];
    if (!tier || tier === 'retail' || m == null || !(+item.cost > 0)) return +item.price || 0;
    return r2(+item.cost * (1 + m / 100));
  }

  // ---------------- AMVIC estimate tolerance (Alberta) ----------------
  // Final bill may not exceed the authorized estimate by more than the tolerance
  // without recorded customer re-authorization.
  function estimateCheck(approvedTotal, finalTotal, s = {}) {
    if (!(approvedTotal > 0)) return { ok: false, reason: 'No authorized estimate on file' };
    const pct = s.estimateTolerancePct ?? 10, cap = s.estimateToleranceCap ?? 100;
    const allowed = r2(Math.min(approvedTotal * pct / 100, cap));
    const over = r2(finalTotal - approvedTotal);
    return { ok: over <= allowed, over, allowed, limit: r2(approvedTotal + allowed) };
  }

  // ---------------- Tire size parsing ----------------
  // 225/65R17 102H, P225/65R17, LT275/70R18 125/122S, 225/65-17
  function parseTire(str = '') {
    const m = String(str).toUpperCase().replace(/\s+/g, ' ').match(/(P|LT|ST)?\s?(\d{3})\s?\/\s?(\d{2})\s?(Z?R|-|D|B)?\s?(\d{2}(?:\.\d)?)(?:\s+(\d{2,3}(?:\/\d{2,3})?)\s?([A-Z]))?/);
    if (!m) return null;
    return { prefix: m[1] || '', width: +m[2], aspect: +m[3], rim: +m[5], load: m[6] || '', speed: m[7] || '',
      size: `${m[2]}/${m[3]}R${m[5]}`, diameterIn: r2((2 * m[2] * m[3] / 100) / 25.4 + +m[5]) };
  }

  // ---------------- Double-entry posting ----------------
  const ACC = { bank: '1000', card: '1020', ar: '1100', invTire: '1200', invPart: '1210', ap: '2000', gst: '2200', itc: '2205', pst: '2210', env: '2220', payroll: '2300',
    labour: '4000', parts: '4100', tires: '4200', fees: '4300', storage: '4400', discount: '4900', cogsTire: '5000', cogsPart: '5010', wages: '6000', erTax: '6010' };

  function je(date, memo, source, lines) {
    const ls = lines.filter((l) => r2(l.debit) || r2(l.credit)).map((l) => ({ account: l.account, debit: r2(l.debit), credit: r2(l.credit) }));
    const d = r2(ls.reduce((a, l) => a + l.debit, 0)), c = r2(ls.reduce((a, l) => a + l.credit, 0));
    if (Math.abs(d - c) > 0.005) throw new Error(`Unbalanced entry "${memo}": Dr ${d} / Cr ${c}`);
    return { date, memo, source, lines: ls };
  }

  function postInvoice(inv) {
    const t = inv.totals, tireCost = r2((inv.lines || []).filter((l) => l.type === 'tire').reduce((a, l) => a + (+l.qty || 0) * (+l.cost || 0), 0));
    const partCost = r2(t.cost - tireCost);
    return je(inv.date, `Invoice ${inv.number}`, `invoice:${inv.id}`, [
      { account: ACC.ar, debit: t.total },
      { account: ACC.labour, credit: t.labour },
      { account: ACC.parts, credit: t.parts },
      { account: ACC.tires, credit: t.tires },
      { account: ACC.fees, credit: r2(t.fees + t.supplies) },
      { account: ACC.discount, debit: -t.discount },
      { account: ACC.env, credit: t.envFees },
      { account: ACC.gst, credit: t.gst },
      { account: ACC.pst, credit: t.pst },
      { account: ACC.cogsTire, debit: tireCost }, { account: ACC.invTire, credit: tireCost },
      { account: ACC.cogsPart, debit: partCost }, { account: ACC.invPart, credit: partCost },
    ]);
  }
  function postPayment(p, invNumber) {
    const acct = p.method === 'credit' ? ACC.card : ACC.bank;
    return je(p.date, `Payment ${invNumber || ''} (${p.method})`, `payment:${p.id}`, [{ account: acct, debit: p.amount }, { account: ACC.ar, credit: p.amount }]);
  }
  function postBill(b) {
    const lines = (b.lines || []).map((l) => ({ account: l.account || ACC.invPart, debit: r2((+l.qty || 1) * (+l.cost || 0)) }));
    return je(b.date, `Bill ${b.number || ''} ${b.vendorName || ''}`.trim(), `bill:${b.id}`, [...lines, { account: ACC.itc, debit: b.gst || 0 }, { account: ACC.ap, credit: b.total }]);
  }
  function postBillPayment(b, amount, date) {
    return je(date, `Pay bill ${b.number || ''}`, `billpay:${b.id}`, [{ account: ACC.ap, debit: amount }, { account: ACC.bank, credit: amount }]);
  }

  // ---------------- Reports ----------------
  function balances(journal, accounts, from, to) {
    const map = {};
    for (const a of accounts) map[a.code] = { ...a, debit: 0, credit: 0 };
    for (const e of journal) {
      if ((from && e.date < from) || (to && e.date > to)) continue;
      for (const l of e.lines) {
        if (!map[l.account]) map[l.account] = { code: l.account, name: '(unknown ' + l.account + ')', type: 'expense', debit: 0, credit: 0 };
        map[l.account].debit += +l.debit || 0;
        map[l.account].credit += +l.credit || 0;
      }
    }
    return Object.values(map).map((a) => {
      const debitNormal = ['asset', 'cogs', 'expense'].includes(a.type);
      return { ...a, debit: r2(a.debit), credit: r2(a.credit), balance: r2(debitNormal ? a.debit - a.credit : a.credit - a.debit) };
    }).sort((a, b) => a.code.localeCompare(b.code));
  }
  function pnl(journal, accounts, from, to) {
    const b = balances(journal, accounts, from, to);
    const sum = (type) => r2(b.filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0));
    const revenue = sum('revenue'), cogs = sum('cogs'), expense = sum('expense');
    return { rows: b.filter((a) => ['revenue', 'cogs', 'expense'].includes(a.type) && (a.debit || a.credit)), revenue, cogs, gross: r2(revenue - cogs), expense, net: r2(revenue - cogs - expense) };
  }
  function balanceSheet(journal, accounts, asOf) {
    const b = balances(journal, accounts, null, asOf);
    const sum = (type) => r2(b.filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0));
    const earnings = r2(sum('revenue') - sum('cogs') - sum('expense'));
    const assets = sum('asset'), liabilities = sum('liability'), equity = r2(sum('equity') + earnings);
    return { rows: b.filter((a) => ['asset', 'liability', 'equity'].includes(a.type) && (a.debit || a.credit)), assets, liabilities, equity, earnings, balanced: Math.abs(assets - liabilities - equity) < 0.01 };
  }
  function gstReturn(journal, from, to) {
    let sales = 0, collected = 0, itc = 0;
    for (const e of journal) {
      if (e.date < from || e.date > to) continue;
      for (const l of e.lines) {
        if (l.account === ACC.gst) collected += (+l.credit || 0) - (+l.debit || 0);
        if (l.account === ACC.itc) itc += (+l.debit || 0) - (+l.credit || 0);
        if (/^4/.test(l.account)) sales += (+l.credit || 0) - (+l.debit || 0);
      }
    }
    return { line101: r2(sales), line103: r2(collected), line106: r2(itc), line109: r2(collected - itc) };
  }
  function aging(docs, asOf) {
    const b = { current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
    const rows = [];
    for (const d of docs) {
      const bal = r2(d.balance);
      if (bal <= 0.004) continue;
      const days = Math.floor((new Date(asOf) - new Date(d.due || d.date)) / 86400000);
      const k = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : 'd90';
      b[k] = r2(b[k] + bal); b.total = r2(b.total + bal);
      rows.push({ ...d, days, bucket: k });
    }
    return { buckets: b, rows };
  }

  // ---------------- Canadian payroll (CRA T4127 annualization method) ----------------
  // 2026 values. VERIFY against the CRA T4127 (Jan 2026) before live use; update each Jan & Jul.
  const PAYROLL_2026 = {
    year: 2026,
    cpp: { rate: 0.0595, baseRate: 0.0495, ympe: 74600, exemption: 3500, max: 4230.45 },
    cpp2: { rate: 0.04, yampe: 85000, max: 416.0 },
    ei: { rate: 0.0163, mie: 68900, max: 1123.07, employer: 1.4 },
    fed: { brackets: [[0, 0.14], [58523, 0.205], [117045, 0.26], [181440, 0.29], [258482, 0.33]], bpa: 16452, cea: 1501 },
    prov: {
      AB: { brackets: [[0, 0.08], [61200, 0.10], [154259, 0.12], [185111, 0.13], [246813, 0.14], [370220, 0.15]], bpa: 22769 },
    },
    minWage: { AB: 15.0 },
  };
  const progressive = (A, brackets) => {
    let tax = 0;
    for (let i = 0; i < brackets.length; i++) {
      const [lo, rate] = brackets[i];
      const hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
      if (A > lo) tax += (Math.min(A, hi) - lo) * rate;
    }
    return tax;
  };

  /**
   * gross: taxable/pensionable/insurable earnings this period
   * P: pay periods per year; ytd: {gross, cpp, cpp2, ei}; emp: {province, td1_fed, td1_prov}
   */
  function payroll(gross, P, ytd = {}, emp = {}, R = PAYROLL_2026) {
    gross = r2(gross);
    const prov = emp.province || 'AB';
    const PT = R.prov[prov];
    if (!PT) throw new Error(`Payroll tables for ${prov} are not configured. Add them in Settings > Payroll.`);
    const y = { gross: +ytd.gross || 0, cpp: +ytd.cpp || 0, cpp2: +ytd.cpp2 || 0, ei: +ytd.ei || 0 };
    // CPP (base + first additional): T4127 C = min(max - YTD, rate x (PI - exemption/P)); the max enforces YMPE
    const cpp = r2(Math.max(0, Math.min(R.cpp.max - y.cpp, R.cpp.rate * (gross - R.cpp.exemption / P))));
    // CPP2 (second additional) on earnings between YMPE and YAMPE
    const cpp2Earn = Math.max(0, Math.min(y.gross + gross, R.cpp2.yampe) - Math.max(y.gross, R.cpp.ympe));
    const cpp2 = r2(Math.max(0, Math.min(cpp2Earn * R.cpp2.rate, R.cpp2.max - y.cpp2)));
    // EI
    const eiEarn = Math.max(0, Math.min(gross, R.ei.mie - y.gross));
    const ei = r2(Math.max(0, Math.min(eiEarn * R.ei.rate, R.ei.max - y.ei)));
    // Annual taxable income: enhanced CPP portion (F5A) and CPP2 are deductions from income
    const f5 = cpp * ((R.cpp.rate - R.cpp.baseRate) / R.cpp.rate) + cpp2;
    const A = Math.max(0, P * (gross - f5));
    const lowF = R.fed.brackets[0][1], lowP = PT.brackets[0][1];
    const baseCppAnnual = Math.min(P * cpp * (R.cpp.baseRate / R.cpp.rate), R.cpp.max * (R.cpp.baseRate / R.cpp.rate));
    const eiAnnual = Math.min(P * ei, R.ei.max);
    const tcF = emp.td1_fed > 0 ? +emp.td1_fed : R.fed.bpa;
    const tcP = emp.td1_prov > 0 ? +emp.td1_prov : PT.bpa;
    const fedAnnual = Math.max(0, progressive(A, R.fed.brackets) - lowF * tcF - lowF * (baseCppAnnual + eiAnnual) - lowF * Math.min(A, R.fed.cea));
    const provAnnual = Math.max(0, progressive(A, PT.brackets) - lowP * tcP - lowP * (baseCppAnnual + eiAnnual));
    const fedTax = r2(fedAnnual / P), provTax = r2(provAnnual / P);
    const deductions = r2(cpp + cpp2 + ei + fedTax + provTax);
    return { gross, cpp, cpp2, ei, fedTax, provTax, deductions, net: r2(gross - deductions), erCpp: r2(cpp + cpp2), erEi: r2(ei * R.ei.employer) };
  }

  // Alberta overtime: greater of daily (>8h) or weekly (>44h) overtime, at 1.5x.
  function albertaOvertime(days /* [{date, hours}] within one week */) {
    const total = days.reduce((a, d) => a + (+d.hours || 0), 0);
    const daily = days.reduce((a, d) => a + Math.max(0, (+d.hours || 0) - 8), 0);
    const weekly = Math.max(0, total - 44);
    const ot = Math.max(daily, weekly);
    return { total: r2(total), regular: r2(total - ot), overtime: r2(ot) };
  }
  const weekKey = (iso) => { const d = new Date(iso + 'T00:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); };

  function postPayrun(run) {
    const t = run.rows.reduce((a, r) => ({ gross: a.gross + r.gross, net: a.net + r.net, ded: a.ded + r.deductions, er: a.er + r.erCpp + r.erEi }), { gross: 0, net: 0, ded: 0, er: 0 });
    return je(run.payDate, `Payroll ${run.periodStart} to ${run.periodEnd}`, `payrun:${run.id}`, [
      { account: ACC.wages, debit: t.gross }, { account: ACC.erTax, debit: t.er },
      { account: ACC.payroll, credit: r2(t.ded + t.er) }, { account: ACC.bank, credit: t.net },
    ]);
  }

  // ---------------- Inventory & forecasting ----------------
  function reorder(items, salesByItem = {}, days = 90) {
    return items.filter((i) => i.type !== 'service').map((i) => {
      const sold = +salesByItem[i.id] || 0, daily = sold / days;
      const target = Math.max(+i.max || 0, Math.ceil(daily * 30));
      const need = (+i.qty || 0) <= (+i.min || 0) ? Math.max(0, target - (+i.qty || 0)) : 0;
      return { ...i, sold, daily: r2(daily), suggested: need, daysCover: daily > 0 ? Math.floor((+i.qty || 0) / daily) : null };
    }).filter((i) => i.suggested > 0).sort((a, b) => b.suggested - a.suggested);
  }

  return { r2, TAX, taxFor, lineAmount, totals, tierPrice, estimateCheck, parseTire, ACC, je, postInvoice, postPayment, postBill, postBillPayment,
    balances, pnl, balanceSheet, gstReturn, aging, PAYROLL_2026, progressive, payroll, albertaOvertime, weekKey, postPayrun, reorder };
})();
/* ENGINE-END */
