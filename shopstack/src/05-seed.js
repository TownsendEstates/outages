/* ================= DEMO SEED: realistic multi-tenant sample data ================= */
function seedDemo() {
  const root = { version: 1, tenants: [], data: {}, platformUsers: [{ id: 'pu_scott', name: 'Scott Townsend', email: 'primary@townsendestates.ca', pin_hash: pinHash(CFG.defaultAdminPin) }] };
  const mk = (name, province, plan, opts = {}) => {
    const t = { id: uid('ten'), name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), plan_id: plan, status: opts.status || 'active', province, created_at: addDays(today(), -(opts.age || 200)) + 'T12:00:00Z', settings: defaultSettings(name, province) };
    Object.assign(t.settings.branding, opts.branding || {});
    root.tenants.push(t);
    root.data[t.id] = seedTenant(t, opts);
    return t;
  };
  mk('Northgate Tire & Auto', 'AB', 'enterprise', { full: true, age: 420, branding: { primary: '#0F766E', accent: '#F59E0B', phone: '(780) 555-0142', email: 'service@northgatetire.example', address: '12840 97 St NW, Edmonton, AB T5E 4C2', gstNo: '81234 5678 RT0001', amvicNo: 'B1234567', website: 'northgatetire.example' } });
  mk('Prairie Fleet Service', 'AB', 'pro', { age: 150, branding: { primary: '#1D4ED8', accent: '#EAB308', address: '4410 52 Ave SE, Calgary, AB' } });
  mk('Riverbend Auto Care', 'SK', 'starter', { age: 30, status: 'trial', branding: { primary: '#9333EA', accent: '#22C55E', address: 'Saskatoon, SK' } });
  return root;
}

function seedTenant(t, opts) {
  const D = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  const s = t.settings;
  const add = (col, o) => { o.id ||= uid(col); o.created_at ||= new Date().toISOString(); D[col].push(o); return o; };
  for (const [code, name, type] of DEFAULT_COA) add('accounts', { id: 'acc_' + code, code, name, type });
  const loc1 = add('locations', { name: opts.full ? 'Northgate (Edmonton)' : t.name, address: s.branding.address, phone: s.branding.phone, amvic: s.branding.amvicNo });
  const loc2 = opts.full ? add('locations', { name: 'Sherwood Park', address: '2020 Broadmoor Blvd, Sherwood Park, AB', phone: '(780) 555-0188' }) : null;

  // Staff logins (demo PINs) & employees
  add('staff', { name: 'Jordan Lee', role: 'advisor', pin_hash: pinHash('1111'), active: true });
  add('staff', { name: 'Sam Patel', role: 'technician', pin_hash: pinHash('2222'), active: true });
  add('staff', { name: 'Morgan Chen', role: 'accountant', pin_hash: pinHash('3333'), active: true });
  const emps = [
    add('employees', { name: 'Sam Patel', position: 'Licensed Technician (Red Seal)', pay_type: 'flat_rate', rate: 0, flat_rate: 38, province: t.province, vacation_pct: 4, hire_date: '2021-03-15', active: true, clock_pin: '2222', sin: '046454286' }),
    add('employees', { name: 'Riley Thompson', position: 'Apprentice', pay_type: 'hourly', rate: 24.5, province: t.province, vacation_pct: 4, hire_date: '2024-05-01', active: true, clock_pin: '4444' }),
    add('employees', { name: 'Avery Nguyen', position: 'Tire Technician', pay_type: 'hourly', rate: 22, province: t.province, vacation_pct: 4, hire_date: '2023-09-12', active: true, clock_pin: '5555' }),
    add('employees', { name: 'Jordan Lee', position: 'Service Advisor', pay_type: 'salary', rate: 58000, commission_pct: 1.5, province: t.province, vacation_pct: 6, hire_date: '2019-01-07', active: true, clock_pin: '1111' }),
  ];

  // Vendors wired to connectors
  const vend = {
    dyn: add('vendors', { name: 'Dynamic Tire Corp', connector: 'dynamic_tire', account_no: 'NG-44120', contact: 'Western Sales Desk', phone: '1-800-555-0101', terms: 'Net 30' }),
    ntd: add('vendors', { name: 'National Tire Distributors', connector: 'ntd_canada', account_no: 'AB-77821', phone: '1-800-555-0102', terms: 'Net 30' }),
    fw: add('vendors', { name: 'Fountain Tire Wholesale', connector: 'fountain_wholesale', account_no: 'W-2231', phone: '1-800-555-0103', terms: 'Net 15' }),
    napa: add('vendors', { name: 'NAPA Auto Parts', connector: 'napa_ca', account_no: '88123', phone: '(780) 555-0199', terms: 'Net 30' }),
    pt: add('vendors', { name: 'PartsTech', connector: 'partstech', terms: 'Net 30' }),
  };
  for (const id of ['nhtsa_vpic', 'tc_recalls', 'dynamic_tire', 'ntd_canada', 'napa_ca', 'partstech', 'qbo', 'twilio', 'moneris']) add('connectors', { id: 'con_' + id, connector: id, enabled: true, status: ['nhtsa_vpic', 'tc_recalls'].includes(id) ? 'connected' : 'demo' });

  // Inventory
  const tire = (sku, brand, model, size, season, li, sp, cost, price, qty, min, max, v) => add('inventory', { sku, type: 'tire', brand, model, description: `${brand} ${model} ${size} ${li}${sp}`, size, season, load_index: li, speed: sp, cost, price, qty, min, max, bin: 'T-' + size.slice(0, 3), vendor_id: v.id, location_id: loc1.id });
  const items = [
    tire('MIC-XIS-2256517', 'Michelin', 'X-Ice Snow SUV', '225/65R17', 'Winter', '106', 'T', 189, 279, 12, 8, 24, vend.dyn),
    tire('BRI-WS90-2155516', 'Bridgestone', 'Blizzak WS90', '215/55R16', 'Winter', '97', 'H', 142, 219, 4, 8, 20, vend.ntd),
    tire('NOK-R5-2356018', 'Nokian', 'Hakkapeliitta R5 SUV', '235/60R18', 'Winter', '107', 'R', 205, 309, 8, 8, 20, vend.fw),
    tire('TOY-GSI6-2656517', 'Toyo', 'Observe GSi-6', '265/65R17', 'Winter', '112', 'T', 168, 249, 16, 8, 24, vend.dyn),
    tire('NOK-WR4-2256517', 'Nokian', 'WR SUV 4', '225/65R17', 'All-weather', '106', 'H', 176, 259, 6, 4, 16, vend.fw),
    tire('MIC-CC2-2155517', 'Michelin', 'CrossClimate2', '215/55R17', 'All-weather', '98', 'W', 198, 289, 3, 4, 12, vend.dyn),
    tire('GY-WRL-2757018', 'Goodyear', 'Wrangler Workhorse AT', 'LT275/70R18', 'All-season', '125/122', 'S', 231, 339, 8, 4, 16, vend.ntd),
    tire('BFG-KO2-2656517', 'BFGoodrich', 'All-Terrain T/A KO2', 'LT265/70R17', 'All-season', '121/118', 'S', 244, 359, 4, 4, 12, vend.ntd),
    tire('CON-VC7-2054516', 'Continental', 'VikingContact 7', '205/55R16', 'Winter', '94', 'T', 138, 205, 20, 8, 24, vend.dyn),
    tire('HAN-IZ3-2257017', 'Hankook', 'Winter i*cept iZ3', '225/70R16', 'Winter', '103', 'T', 129, 192, 2, 4, 12, vend.ntd),
    tire('YOK-G015-2457017', 'Yokohama', 'Geolandar A/T G015', '245/70R17', 'All-season', '110', 'T', 172, 255, 7, 4, 12, vend.fw),
    add('inventory', { sku: 'BP-D1210', type: 'part', description: 'Ceramic brake pads - front (D1210)', brand: 'Wagner', cost: 42, price: 89, qty: 10, min: 4, max: 12, vendor_id: vend.napa.id, location_id: loc1.id }),
    add('inventory', { sku: 'RT-55097', type: 'part', description: 'Brake rotor - front (55097)', brand: 'Raybestos', cost: 58, price: 119, qty: 6, min: 4, max: 10, vendor_id: vend.napa.id, location_id: loc1.id }),
    add('inventory', { sku: 'OF-PH7317', type: 'part', description: 'Oil filter PH7317', brand: 'FRAM', cost: 5.2, price: 14.95, qty: 40, min: 15, max: 60, vendor_id: vend.napa.id, location_id: loc1.id }),
    add('inventory', { sku: 'OIL-5W30-SYN', type: 'fluid', description: '5W-30 full synthetic (per L)', brand: 'Castrol', cost: 6.1, price: 13.5, qty: 180, min: 60, max: 300, vendor_id: vend.napa.id, location_id: loc1.id }),
    add('inventory', { sku: 'TPMS-UNI', type: 'part', description: 'Programmable TPMS sensor', brand: 'Schrader EZ-sensor', cost: 38, price: 89, qty: 14, min: 8, max: 24, vendor_id: vend.pt.id, location_id: loc1.id }),
    add('inventory', { sku: 'BAT-H6', type: 'battery', description: 'Battery Group H6 760CCA', brand: 'Interstate', cost: 168, price: 269, qty: 3, min: 3, max: 8, vendor_id: vend.napa.id, location_id: loc1.id }),
    add('inventory', { sku: 'WB-22', type: 'part', description: 'Winter wiper blade 22"', brand: 'Bosch', cost: 11, price: 29.95, qty: 18, min: 10, max: 30, vendor_id: vend.napa.id, location_id: loc1.id }),
    add('inventory', { sku: 'VS-RUB', type: 'part', description: 'Valve stem (rubber TR413)', brand: 'Dill', cost: 0.6, price: 4.95, qty: 300, min: 100, max: 500, vendor_id: vend.pt.id, location_id: loc1.id }),
  ];
  const bySku = Object.fromEntries(items.map((i) => [i.sku, i]));

  // Customers & vehicles
  const people = [
    ['Taylor Morrison', 'Retail', '(780) 555-0111', 'taylor.m@example.com', 'Edmonton', [2019, 'Toyota', 'RAV4', 'XLE', '225/65R17', 'JTMB1RFV5KD012345']],
    ['Chris Okafor', 'Retail', '(780) 555-0112', 'chris.o@example.com', 'St. Albert', [2021, 'Honda', 'Civic', 'EX', '215/55R16', '2HGFE2F59MH512345']],
    ['Dana Belanger', 'Retail', '(780) 555-0113', 'dana.b@example.com', 'Edmonton', [2018, 'Ford', 'F-150', 'XLT', 'LT275/70R18', '1FTEW1EP4JFA12345']],
    ['Priya Sharma', 'Retail', '(780) 555-0114', 'priya.s@example.com', 'Sherwood Park', [2022, 'Subaru', 'Forester', 'Touring', '225/55R18', 'JF2SKAJC8NH412345']],
    ['Marcus Gray', 'Retail', '(780) 555-0115', 'mgray@example.com', 'Edmonton', [2017, 'Jeep', 'Grand Cherokee', 'Limited', '265/60R18', '1C4RJFBG2HC612345']],
    ['Elena Rossi', 'Retail', '(780) 555-0116', 'elena.r@example.com', 'Spruce Grove', [2020, 'Mazda', 'CX-5', 'GT', '225/55R19', 'JM3KFBDM3L0812345']],
    ['Northern Plumbing Ltd.', 'Fleet', '(780) 555-0120', 'fleet@northernplumbing.example', 'Edmonton', [2020, 'Ram', 'ProMaster 2500', '', 'LT225/75R16', '3C6TRVCG6LE112345']],
    ['Capital Couriers Inc.', 'Fleet', '(780) 555-0121', 'ops@capitalcouriers.example', 'Edmonton', [2021, 'Ford', 'Transit 250', '', '235/65R16', '1FTBR1C82MKA12345']],
    ['Wei Zhang', 'Retail', '(780) 555-0117', 'wei.z@example.com', 'Edmonton', [2016, 'Honda', 'CR-V', 'EX-L', '225/65R17', '2HKRM4H75GH612345']],
    ['Fatima Haddad', 'Retail', '(780) 555-0118', 'fatima.h@example.com', 'Leduc', [2023, 'Hyundai', 'Tucson', 'Preferred', '235/60R18', 'KM8JBCAE1PU112345']],
  ];
  const custs = people.map(([name, type, phone, email, city, v], i) => {
    const c = add('customers', { name, type, phone, email, city, province: t.province, pricing_tier: type === 'Fleet' ? 'fleet' : 'retail', terms: type === 'Fleet' ? 'Net 30' : 'Due on receipt', consent_marketing: i % 3 !== 2, consent_date: i % 3 !== 2 ? addDays(today(), -300 + i * 10) : '', consent_source: i % 3 !== 2 ? 'In person (express)' : '', tags: type === 'Fleet' ? 'fleet,commercial' : i % 2 ? 'winter-swap' : '' });
    const veh = add('vehicles', { customer_id: c.id, year: v[0], make: v[1], model: v[2], trim: v[3], tire_size: v[4], vin: v[5], plate: ['CKX', 'BRT', 'DMN', 'CPL', 'BWZ', 'CJR', 'FLT', 'FLV', 'BMQ', 'DLE'][i] + '-' + (1000 + i * 137), odometer: 42000 + i * 9100, next_service_date: addDays(today(), -10 + i * 9), unit_no: type === 'Fleet' ? 'U-' + (100 + i) : '' });
    if (type === 'Fleet') add('vehicles', { customer_id: c.id, year: 2019, make: v[1], model: v[2], tire_size: v[4], plate: 'FLX-' + (2000 + i), unit_no: 'U-' + (200 + i), odometer: 118000 + i * 1000 });
    return { c, veh };
  });

  // Historical invoices (posted to GL) over last 75 days
  const labourRate = s.labourRates[0].rate;
  const tax = { province: t.province, taxOverride: s.taxOverride, shopSuppliesPct: s.shopSuppliesPct, shopSuppliesCap: s.shopSuppliesCap, envFeeTire: s.envFeeTire };
  const jobs = [
    () => { const it = bySku['MIC-XIS-2256517']; return [{ type: 'tire', sku: it.sku, desc: it.description, qty: 4, price: it.price, cost: it.cost, item_id: it.id }, { type: 'labour', desc: 'Mount & balance 4 tires, TPMS relearn', hours: 1.2, rate: labourRate, tech_id: emps[2].id }, { type: 'part', sku: 'VS-RUB', desc: 'Valve stems', qty: 4, price: 4.95, cost: 0.6, item_id: bySku['VS-RUB'].id }]; },
    () => [{ type: 'labour', desc: 'Seasonal tire changeover (on rims)', hours: 0.6, rate: labourRate, tech_id: emps[2].id }],
    () => [{ type: 'labour', desc: 'Front brake service', hours: 1.8, rate: labourRate, tech_id: emps[0].id }, { type: 'part', sku: 'BP-D1210', desc: bySku['BP-D1210'].description, qty: 1, price: 89, cost: 42, item_id: bySku['BP-D1210'].id }, { type: 'part', sku: 'RT-55097', desc: bySku['RT-55097'].description, qty: 2, price: 119, cost: 58, item_id: bySku['RT-55097'].id }],
    () => [{ type: 'labour', desc: 'Oil & filter service, multi-point inspection', hours: 0.5, rate: labourRate, tech_id: emps[1].id }, { type: 'part', sku: 'OF-PH7317', desc: 'Oil filter', qty: 1, price: 14.95, cost: 5.2, item_id: bySku['OF-PH7317'].id }, { type: 'part', sku: 'OIL-5W30-SYN', desc: '5W-30 synthetic', qty: 5, price: 13.5, cost: 6.1, item_id: bySku['OIL-5W30-SYN'].id }],
    () => { const it = bySku['CON-VC7-2054516']; return [{ type: 'tire', sku: it.sku, desc: it.description, qty: 4, price: it.price, cost: it.cost, item_id: it.id }, { type: 'labour', desc: 'Mount & balance 4 tires', hours: 1.0, rate: labourRate, tech_id: emps[2].id }]; },
    () => [{ type: 'labour', desc: 'Check engine light diagnostic', hours: 1.0, rate: s.labourRates[1].rate, tech_id: emps[0].id }, { type: 'battery', type2: 'part', desc: 'Battery H6 + install', qty: 1, price: 269, cost: 168, item_id: bySku['BAT-H6'].id, sku: 'BAT-H6' }].map((l) => (l.type2 ? { ...l, type: l.type2 } : l)),
  ];
  let invNo = 5001;
  for (let d = 75; d >= 1; d--) {
    const date = addDays(today(), -d);
    const dow = new Date(date + 'T00:00:00').getDay();
    if (dow === 0) continue;
    const n = (d % 3) + (opts.full ? 2 : 1);
    for (let k = 0; k < n; k++) {
      const { c, veh } = custs[(d * 3 + k) % custs.length];
      const lines = jobs[(d + k) % jobs.length]().map((l) => ({ taxable: true, ...l }));
      const totals = Engine.totals(lines, tax);
      const inv = add('invoices', { number: 'INV-' + invNo++, date, due: c.terms === 'Net 30' ? addDays(date, 30) : date, customer_id: c.id, vehicle_id: veh.id, lines, totals, balance: totals.total, status: 'Open', location_id: (loc2 && k % 2) ? loc2.id : loc1.id });
      add('journal', { ...Engine.postInvoice(inv), id: uid('jnl') });
      const paid = c.terms === 'Net 30' ? (d > 40 ? totals.total : 0) : totals.total;
      if (paid > 0) {
        const p = add('payments', { invoice_id: inv.id, date, amount: paid, method: ['debit', 'credit', 'cash', 'etransfer'][(d + k) % 4], location_id: inv.location_id });
        add('journal', { ...Engine.postPayment(p, inv.number), id: uid('jnl') });
        inv.balance = r2(inv.balance - paid); inv.status = inv.balance <= 0 ? 'Paid' : 'Partial';
      }
    }
  }
  s.numbering.next.inv = invNo;

  // Opening balance & monthly expenses
  add('journal', { ...Engine.je(addDays(today(), -80), 'Opening balances', 'opening', [{ account: '1000', debit: 48000 }, { account: '1200', debit: 32000 }, { account: '1210', debit: 9500 }, { account: '1500', debit: 85000 }, { account: '3000', credit: 174500 }]), id: uid('jnl') });
  for (const m of [70, 40, 10]) {
    const date = addDays(today(), -m);
    const b = add('bills', { number: 'R-' + m, vendor_id: '', vendorName: 'Landlord - Northgate Plaza', date, due: date, lines: [{ account: '6100', desc: 'Rent', qty: 1, cost: 6500 }], subtotal: 6500, gst: 325, total: 6825, balance: 0, status: 'Paid' });
    add('journal', { ...Engine.postBill(b), id: uid('jnl') });
    add('journal', { ...Engine.postBillPayment(b, 6825, date), id: uid('jnl') });
    const u = add('bills', { number: 'EP-' + m, vendorName: 'EPCOR Utilities', date, due: addDays(date, 21), lines: [{ account: '6200', desc: 'Power & water', qty: 1, cost: 1180 }], subtotal: 1180, gst: 59, total: 1239, balance: m > 20 ? 0 : 1239, status: m > 20 ? 'Paid' : 'Open' });
    add('journal', { ...Engine.postBill(u), id: uid('jnl') });
    if (m > 20) add('journal', { ...Engine.postBillPayment(u, 1239, addDays(date, 14)), id: uid('jnl') });
  }
  const tb = add('bills', { number: 'DYN-88412', vendor_id: vend.dyn.id, vendorName: vend.dyn.name, date: addDays(today(), -12), due: addDays(today(), 18), lines: [{ account: '1200', desc: 'Winter tire stock order', qty: 1, cost: 9840 }], subtotal: 9840, gst: 492, total: 10332, balance: 10332, status: 'Open' });
  add('journal', { ...Engine.postBill(tb), id: uid('jnl') });

  // Open work orders
  const wo = (i, status, lines, concern, extra = {}) => {
    const { c, veh } = custs[i];
    const ls = lines.map((l) => ({ taxable: true, ...l }));
    const totals = Engine.totals(ls, tax);
    return add('workorders', { number: 'WO-' + (1001 + D.workorders.length), date: today(), customer_id: c.id, vehicle_id: veh.id, status, concern, lines: ls, totals, odometer_in: veh.odometer, inspection: {}, tech_id: emps[0].id, promised: today() + 'T16:00', location_id: loc1.id, ...extra });
  };
  wo(0, 'In Progress', [{ type: 'labour', desc: 'Seasonal changeover - winters on rims', hours: 0.6, rate: labourRate, tech_id: emps[2].id }], 'Swap to winters; customer has set in storage', { approvedTotal: 0 });
  const w2 = wo(4, 'Awaiting Approval', [{ type: 'labour', desc: 'Diagnose grinding noise front end', hours: 1.0, rate: s.labourRates[1].rate, tech_id: emps[0].id }, { type: 'labour', desc: 'Replace front pads & rotors', hours: 1.8, rate: labourRate, tech_id: emps[0].id }, { type: 'part', sku: 'BP-D1210', desc: bySku['BP-D1210'].description, qty: 1, price: 89, cost: 42, item_id: bySku['BP-D1210'].id }, { type: 'part', sku: 'RT-55097', desc: bySku['RT-55097'].description, qty: 2, price: 119, cost: 58, item_id: bySku['RT-55097'].id }], 'Grinding noise when braking, worse in the morning');
  w2.inspection = { 'Brake pads & rotors - front': { s: 'r', n: '2mm pads, rotors scored' }, 'Tire tread depth (LF/RF/LR/RR)': { s: 'y', n: '4/4/5/5 mm (32nds: 5/5/6/6)' }, 'Battery & charging': { s: 'g', n: '' }, 'Wipers & washer fluid': { s: 'y', n: 'Streaking' } };
  wo(6, 'Waiting Parts', [{ type: 'tire', sku: 'GY-WRL-2757018', desc: bySku['GY-WRL-2757018'].description, qty: 4, price: Engine.tierPrice(bySku['GY-WRL-2757018'], 'fleet', s), cost: 231, item_id: bySku['GY-WRL-2757018'].id }, { type: 'labour', desc: 'Mount & balance, fleet', hours: 1.2, rate: s.labourRates[2].rate, tech_id: emps[2].id }], 'Unit U-106: 4 new all-terrains per fleet agreement', { approvedTotal: 1, po: 'NP-55120' });
  wo(3, 'Estimate', [], 'Rattle from rear over bumps');
  D.workorders[2].approvedTotal = D.workorders[2].totals.total;
  D.workorders[2].approval = { by: 'Fleet manager (phone)', at: today() + 'T09:12', method: 'Phone' };
  s.numbering.next.wo = 1001 + D.workorders.length;

  // Appointments this week
  const svc = ['Seasonal tire changeover', 'Winter tire install', 'Oil change + inspection', 'Brake inspection', 'Wheel alignment', 'Fleet PM service'];
  for (let d = 0; d < 6; d++) for (let k = 0; k < 3 + (d % 2); k++) {
    const { c, veh } = custs[(d * 4 + k) % custs.length];
    add('appointments', { date: addDays(today(), d), time: ['08:30', '09:30', '11:00', '13:00', '14:30'][k], duration: 60, bay: s.bays[k % s.bays.length], tech_id: emps[k % 3].id, customer_id: c.id, vehicle_id: veh.id, service: svc[(d + k) % svc.length], status: d === 0 && k === 0 ? 'Arrived' : 'Booked', location_id: loc1.id });
  }

  // Tire storage (tire hotel)
  custs.slice(0, 8).forEach(({ c, veh }, i) => add('tire_storage', { customer_id: c.id, vehicle_id: veh.id, description: ['Michelin X-Ice', 'Bridgestone Blizzak', 'Michelin Defender', 'Toyo Observe', 'Nokian Hakka R5', 'Continental TrueContact', 'BFGoodrich KO2', 'Goodyear Assurance'][i], size: veh.tire_size, qty: 4, season: i % 2 ? 'Winter' : 'Summer', on_rims: i % 3 === 0, tread_mm: 3 + (i % 5) * 1.5, rack: `R${1 + (i % 4)}-${String.fromCharCode(65 + i)}`, stored_date: addDays(today(), -160 + i), fee: s.storageFee, status: 'Stored' }));

  // CRM
  add('deals', { name: 'Capital Couriers - fleet tire & PM program', customer_id: custs[7].c.id, stage: 'Quote Sent', value: 48000, probability: 50, close_date: addDays(today(), 21), owner: 'Scott Townsend', source: 'Fleet RFP' });
  add('deals', { name: 'Northern Plumbing - 14 vans winter package', customer_id: custs[6].c.id, stage: 'Negotiation', value: 22400, probability: 70, close_date: addDays(today(), 7), owner: 'Jordan Lee', source: 'Referral' });
  add('deals', { name: 'City of St. Albert - parks dept trucks', stage: 'Qualified', value: 65000, probability: 25, close_date: addDays(today(), 60), owner: 'Scott Townsend', source: 'Fleet RFP' });
  add('deals', { name: 'Edmonton Dental Group - staff tire day', stage: 'Lead', value: 6000, probability: 10, close_date: addDays(today(), 45), owner: 'Jordan Lee', source: 'Event' });
  add('activities', { type: 'Call', subject: 'Follow up on fleet quote', customer_id: custs[7].c.id, due: addDays(today(), 1), owner: 'Scott Townsend', done: false });
  add('activities', { type: 'Follow-up', subject: 'Post-service check-in: brakes', customer_id: custs[2].c.id, due: addDays(today(), -1), owner: 'Jordan Lee', done: false });
  add('activities', { type: 'Task', subject: 'Send winter storage reminders', due: today(), owner: 'Jordan Lee', done: false });
  add('campaigns', { name: 'Fall changeover - stored winters', channel: 'SMS', segment: 'stored_winter', message: `Hi {first}, it's ${t.name}. Your winter tires are ready in storage. Book your changeover: reply YES or call us. Reply STOP to opt out.`, status: 'Draft' });

  // Timesheets: last 14 days for hourly staff
  for (let d = 14; d >= 1; d--) {
    const date = addDays(today(), -d), dow = new Date(date + 'T00:00:00').getDay();
    if (dow === 0 || dow === 6) continue;
    for (const e of emps) add('timesheets', { employee_id: e.id, date, in: '08:00', out: d % 5 === 0 ? '18:30' : '16:30', hours: d % 5 === 0 ? 10 : 8, approved: true });
  }
  if (!opts.full) { D.deals = D.deals.slice(0, 1); D.workorders = D.workorders.slice(0, 2); }
  return D;
}
