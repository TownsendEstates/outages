// Unit tests for the pure business engine embedded in the single-file app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../src/02-engine.js", import.meta.url), "utf8");
const ctx = {};
vm.runInNewContext(src + "\nthis.Engine = Engine;", ctx);
const E = ctx.Engine;
const near = (a, b, tol = 0.02) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test("Alberta totals: GST 5%, shop supplies capped, tire levy taxable", () => {
  const t = E.totals(
    [
      { type: "tire", qty: 4, price: 200, cost: 130 },
      { type: "labour", hours: 1, rate: 145 },
    ],
    { province: "AB", shopSuppliesPct: 5, shopSuppliesCap: 5, envFeeTire: 4 }
  );
  assert.equal(t.tires, 800);
  assert.equal(t.supplies, 5); // 7.25 capped at 5
  assert.equal(t.envFees, 16);
  assert.equal(t.subtotal, 966);
  assert.equal(t.gst, 48.3);
  assert.equal(t.pst, 0);
  assert.equal(t.total, 1014.3);
  assert.equal(t.margin, 966 - 520 - 16);
});

test("Ontario HST and BC PST", () => {
  const on = E.totals([{ type: "part", qty: 1, price: 100 }], { province: "ON" });
  assert.equal(on.gst, 13); assert.ok(on.hst);
  const bc = E.totals([{ type: "part", qty: 1, price: 100 }], { province: "BC" });
  assert.equal(bc.gst, 5); assert.equal(bc.pst, 7);
});

test("AMVIC estimate tolerance: lesser of % or cap", () => {
  assert.equal(E.estimateCheck(500, 545, { estimateTolerancePct: 10, estimateToleranceCap: 100 }).ok, true);
  assert.equal(E.estimateCheck(500, 551, { estimateTolerancePct: 10, estimateToleranceCap: 100 }).ok, false);
  assert.equal(E.estimateCheck(2000, 2150, { estimateTolerancePct: 10, estimateToleranceCap: 100 }).ok, false); // cap binds
  assert.equal(E.estimateCheck(0, 10, {}).ok, false);
});

test("tire size parser", () => {
  assert.equal(E.parseTire("225/65R17 102H").size, "225/65R17");
  assert.equal(E.parseTire("LT275/70R18 125/122S").prefix, "LT");
  assert.equal(E.parseTire("P215/55ZR16").rim, 16);
  near(E.parseTire("225/65R17").diameterIn, 28.51);
  assert.equal(E.parseTire("hello"), null);
});

test("tier pricing: fleet cost-plus, retail list", () => {
  const item = { cost: 100, price: 150 };
  assert.equal(E.tierPrice(item, "retail", { markups: { fleet: 20 } }), 150);
  assert.equal(E.tierPrice(item, "fleet", { markups: { fleet: 20 } }), 120);
});

test("invoice, payment and bill postings balance", () => {
  const lines = [{ type: "tire", qty: 4, price: 200, cost: 130 }, { type: "part", qty: 1, price: 50, cost: 20 }, { type: "labour", hours: 1, rate: 100 }, { type: "discount", qty: 1, price: 10 }];
  const totals = E.totals(lines, { province: "SK", shopSuppliesPct: 5, envFeeTire: 4 });
  const inv = { id: "i1", number: "INV-1", date: "2026-10-01", lines, totals };
  const j = E.postInvoice(inv);
  const d = j.lines.reduce((a, l) => a + l.debit, 0), c = j.lines.reduce((a, l) => a + l.credit, 0);
  near(d, c, 0.001);
  assert.ok(j.lines.find((l) => l.account === "5000" && l.debit === 520));
  E.postPayment({ id: "p", date: "2026-10-01", amount: totals.total, method: "credit" }, "INV-1");
  E.postBill({ id: "b", date: "2026-10-01", lines: [{ account: "1200", qty: 1, cost: 1000 }], gst: 50, total: 1050 });
  assert.throws(() => E.je("2026-10-01", "bad", "x", [{ account: "1000", debit: 10 }, { account: "4000", credit: 9 }]));
});

test("financial statements: balance sheet balances, GST return", () => {
  const journal = [
    E.je("2026-10-01", "open", "o", [{ account: "1000", debit: 1000 }, { account: "3000", credit: 1000 }]),
    E.je("2026-10-02", "sale", "s", [{ account: "1100", debit: 105 }, { account: "4000", credit: 100 }, { account: "2200", credit: 5 }]),
    E.je("2026-10-03", "bill", "b", [{ account: "6100", debit: 50 }, { account: "2205", debit: 2.5 }, { account: "2000", credit: 52.5 }]),
  ];
  const accts = [["1000", "asset"], ["1100", "asset"], ["2000", "liability"], ["2200", "liability"], ["2205", "liability"], ["3000", "equity"], ["4000", "revenue"], ["6100", "expense"]].map(([code, type]) => ({ code, name: code, type }));
  const p = E.pnl(journal, accts, "2026-10-01", "2026-10-31");
  assert.equal(p.revenue, 100); assert.equal(p.net, 50);
  const bs = E.balanceSheet(journal, accts, "2026-10-31");
  assert.ok(bs.balanced, JSON.stringify(bs));
  const g = E.gstReturn(journal, "2026-10-01", "2026-10-31");
  assert.equal(g.line103, 5); assert.equal(g.line106, 2.5); assert.equal(g.line109, 2.5);
});

test("payroll 2026: bi-weekly $2,500 Alberta employee, basic claims", () => {
  const r = E.payroll(2500, 26, {}, { province: "AB" });
  near(r.cpp, 140.74);           // 5.95% x (2500 - 3500/26)
  near(r.cpp2, 0);
  near(r.ei, 40.75);             // 1.63%
  near(r.fedTax, 242.58, 0.5);   // T4127 annualized, 14% lowest bracket
  near(r.provTax, 117.87, 0.5);  // AB 8% bracket
  near(r.net, 2500 - r.cpp - r.ei - r.fedTax - r.provTax);
  near(r.erEi, 57.05);
});

test("payroll caps: CPP max, CPP2 band, EI max", () => {
  const ytd = { gross: 80000, cpp: 4230.45, cpp2: 200, ei: 1123.07 };
  const r = E.payroll(5000, 26, ytd, { province: "AB" });
  assert.equal(r.cpp, 0);
  assert.equal(r.ei, 0);
  near(r.cpp2, 200); // (85000-80000) x 4% = 200, within remaining 216
  const r2 = E.payroll(4000, 26, { gross: 73000, cpp: 4000, cpp2: 0, ei: 1100 }, { province: "AB" });
  near(r2.cpp2, (77000 - 74600) * 0.04);
  near(r2.ei, 0); // YTD earnings already past the $68,900 EI maximum insurable
  near(E.payroll(4000, 26, { gross: 66000, ei: 1075.8 }, { province: "AB" }).ei, 47.27); // only $2,900 still insurable
  assert.throws(() => E.payroll(1000, 26, {}, { province: "QC" }), /not configured/);
});

test("Alberta overtime: greater of daily or weekly", () => {
  const daily = E.albertaOvertime([{ hours: 10 }, { hours: 10 }, { hours: 8 }, { hours: 8 }]);
  assert.equal(daily.overtime, 4);
  const weekly = E.albertaOvertime([{ hours: 8 }, { hours: 8 }, { hours: 8 }, { hours: 8 }, { hours: 8 }, { hours: 8 }]);
  assert.equal(weekly.overtime, 4);
  assert.equal(weekly.regular, 44);
});

test("reorder suggestions", () => {
  const s = E.reorder([{ id: "a", qty: 2, min: 4, max: 20 }, { id: "b", qty: 10, min: 4, max: 20 }], { a: 90 }, 90);
  assert.equal(s.length, 1);
  assert.equal(s[0].suggested, 28); // 30-day demand (30) exceeds max: 30 - 2
});
