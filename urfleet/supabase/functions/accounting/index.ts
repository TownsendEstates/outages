// UrFleet — Accounting integration (Xero + QuickBooks Online)
//
//   GET  /accounting/callback/xero|qbo?code=..&state=..        OAuth redirect target (public)
//   POST { action: "connect",    provider }        -> { url }          (admin/manager)
//   POST { action: "disconnect", provider }                           (admin/manager)
//   POST { action: "lookup",     provider }        -> tax codes, revenue accounts, items (for mapping UI)
//   POST { action: "push",       provider, run_id, account_ids? }     -> creates DRAFT invoices
//
// Secrets: XERO_CLIENT_ID, XERO_CLIENT_SECRET, QBO_CLIENT_ID, QBO_CLIENT_SECRET,
//          QBO_ENV (sandbox|production), APP_URL (where to send the user back), XERO_SCOPES (optional)
// Invoices are always created as DRAFT so they can be reviewed in Xero/QBO before sending.
import { admin, handle, HttpError, json, logSync, randomToken, requireStaff, round2 } from "../_shared/util.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/accounting`;
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:8080";
const XERO_SCOPES = Deno.env.get("XERO_SCOPES") ??
  "openid profile email offline_access accounting.invoices accounting.contacts accounting.settings.read";
const QBO_BASE = (Deno.env.get("QBO_ENV") ?? "production") === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
const QBO_MINOR = "75";

const cfg = {
  xero: {
    id: () => Deno.env.get("XERO_CLIENT_ID")!, secret: () => Deno.env.get("XERO_CLIENT_SECRET")!,
    authorize: "https://login.xero.com/identity/connect/authorize",
    token: "https://identity.xero.com/connect/token",
  },
  qbo: {
    id: () => Deno.env.get("QBO_CLIENT_ID")!, secret: () => Deno.env.get("QBO_CLIENT_SECRET")!,
    authorize: "https://appcenter.intuit.com/connect/oauth2",
    token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  },
} as const;
type Provider = keyof typeof cfg;

const redirectUri = (p: Provider) => `${FN_URL}/callback/${p}`;

async function tokenRequest(p: Provider, params: Record<string, string>) {
  const res = await fetch(cfg[p].token, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${cfg[p].id()}:${cfg[p].secret()}`),
      "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json",
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!res.ok) throw new HttpError(400, `${p} token error: ${body.error_description ?? body.error ?? res.status}`);
  return body as { access_token: string; refresh_token: string; expires_in: number };
}

async function saveTokens(sb: SupabaseClient, p: Provider, t: { access_token: string; refresh_token: string; expires_in: number }) {
  await sb.from("integration_secrets").upsert({
    provider: p, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), oauth_state: null,
    updated_at: new Date().toISOString(),
  });
}

async function accessToken(sb: SupabaseClient, p: Provider): Promise<{ token: string; tenant: string; settings: Record<string, string> }> {
  const [{ data: sec }, { data: integ }] = await Promise.all([
    sb.from("integration_secrets").select("*").eq("provider", p).single(),
    sb.from("integrations").select("*").eq("provider", p).single(),
  ]);
  if (!integ?.connected || !sec?.refresh_token) throw new HttpError(400, `${p.toUpperCase()} is not connected`);
  let token = sec.access_token;
  if (!sec.expires_at || new Date(sec.expires_at).getTime() < Date.now() + 30_000) {
    const t = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: sec.refresh_token });
    await saveTokens(sb, p, t); // refresh tokens rotate on both platforms — always persist the new one
    token = t.access_token;
  }
  return { token, tenant: integ.tenant_id, settings: integ.settings ?? {} };
}

// ---------------------------------------------------------------------------
// Xero
// ---------------------------------------------------------------------------
async function xero(sb: SupabaseClient, path: string, init: RequestInit = {}) {
  const { token, tenant } = await accessToken(sb, "xero");
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "xero-tenant-id": tenant, Accept: "application/json",
      "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = body?.Elements?.[0]?.ValidationErrors?.map((v: { Message: string }) => v.Message).join("; ") ?? body?.Detail ?? body?.Message ?? text;
    throw new HttpError(res.status, `Xero: ${detail}`);
  }
  return body;
}

async function xeroContactId(sb: SupabaseClient, acct: Record<string, string>) {
  if (acct.xero_contact_id) return acct.xero_contact_id;
  const where = encodeURIComponent(`Name=="${acct.name.replace(/"/g, '\\"')}"`);
  const found = await xero(sb, `Contacts?where=${where}`);
  let id = found?.Contacts?.[0]?.ContactID;
  if (!id) {
    const created = await xero(sb, "Contacts", {
      method: "POST",
      body: JSON.stringify({ Contacts: [{
        Name: acct.name, EmailAddress: acct.billing_email ?? undefined,
        Addresses: [{ AddressType: "POBOX", AddressLine1: acct.address1 ?? "", AddressLine2: acct.address2 ?? "",
          City: acct.city ?? "", Region: acct.province ?? "", PostalCode: acct.postal_code ?? "", Country: acct.country ?? "Canada" }],
        Phones: acct.phone ? [{ PhoneType: "DEFAULT", PhoneNumber: acct.phone }] : [],
      }] }),
    });
    id = created.Contacts[0].ContactID;
  }
  await sb.from("accounts").update({ xero_contact_id: id }).eq("id", acct.id);
  return id;
}

// ---------------------------------------------------------------------------
// QuickBooks Online
// ---------------------------------------------------------------------------
async function qbo(sb: SupabaseClient, path: string, init: RequestInit = {}) {
  const { token, tenant } = await accessToken(sb, "qbo");
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${QBO_BASE}/v3/company/${tenant}/${path}${sep}minorversion=${QBO_MINOR}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.Fault) {
    const err = body?.Fault?.Error?.[0];
    throw new HttpError(res.status >= 400 ? res.status : 400, `QuickBooks: ${err?.Message ?? ""} ${err?.Detail ?? ""}`.trim());
  }
  return body;
}

const qboQuery = (sb: SupabaseClient, q: string) => qbo(sb, `query?query=${encodeURIComponent(q)}`);

async function qboCustomerId(sb: SupabaseClient, acct: Record<string, string>) {
  if (acct.qbo_customer_id) return acct.qbo_customer_id;
  const safe = acct.name.replace(/'/g, "\\'");
  const found = await qboQuery(sb, `select Id from Customer where DisplayName = '${safe}'`);
  let id = found?.QueryResponse?.Customer?.[0]?.Id;
  if (!id) {
    const created = await qbo(sb, "customer", {
      method: "POST",
      body: JSON.stringify({
        DisplayName: acct.name, CompanyName: acct.name,
        PrimaryEmailAddr: acct.billing_email ? { Address: acct.billing_email } : undefined,
        PrimaryPhone: acct.phone ? { FreeFormNumber: acct.phone } : undefined,
        BillAddr: { Line1: acct.address1 ?? "", Line2: acct.address2 ?? "", City: acct.city ?? "",
          CountrySubDivisionCode: acct.province ?? "AB", PostalCode: acct.postal_code ?? "", Country: acct.country ?? "Canada" },
      }),
    });
    id = created.Customer.Id;
  }
  await sb.from("accounts").update({ qbo_customer_id: id }).eq("id", acct.id);
  return id;
}

// ---------------------------------------------------------------------------
// Invoice building (shared)
// ---------------------------------------------------------------------------
type Line = { line_type: string; description: string; billable: number | null; rate: number | null; amount: number;
  item_code: string | null; account_code: string | null; tax_code: string | null; sort: number; contract_id: string | null };

/** Quantity × unit price, collapsed to 1 × amount when the CPP rate has more precision than the ledger allows. */
function qtyUnit(l: Line, maxDp: number) {
  const qty = Number(l.billable ?? 0);
  const rate = Number(l.rate ?? 0);
  if (qty > 0 && rate > 0 && Math.abs(round2(qty * rate) - round2(l.amount)) < 0.005 &&
      Number.isInteger(Math.round(rate * 10 ** maxDp * 1e6) / 1e6)) {
    return { qty, unit: rate };
  }
  return { qty: 1, unit: round2(l.amount) };
}

async function push(sb: SupabaseClient, p: Provider, runId: string, accountIds?: string[]) {
  const { data: run } = await sb.from("billing_runs").select("*").eq("id", runId).single();
  if (!run) throw new HttpError(404, "billing run not found");
  if (run.status === "draft") throw new HttpError(400, "Approve the billing run before exporting");
  const { data: lines } = await sb.from("billing_lines").select("*").eq("run_id", runId).order("sort");
  const { data: settingsRow } = await sb.from("integrations").select("settings").eq("provider", p).single();
  const s = (settingsRow?.settings ?? {}) as Record<string, string>;
  const { data: billSettings } = await sb.from("app_settings").select("value").eq("key", "billing").maybeSingle();
  const prefix = billSettings?.value?.invoice_prefix ?? "MPS-";
  const grouped = new Map<string, Line[]>();
  for (const l of (lines ?? []) as (Line & { account_id: string })[]) {
    if (accountIds?.length && !accountIds.includes(l.account_id)) continue;
    if (l.line_type === "device" || Math.abs(Number(l.amount)) < 0.005) continue; // detail rows / zero lines not invoiced
    grouped.set(l.account_id, [...(grouped.get(l.account_id) ?? []), l]);
  }
  const results: Record<string, unknown>[] = [];
  const invoiceDate = run.invoice_date ?? new Date().toISOString().slice(0, 10);
  for (const [accountId, ls] of grouped) {
    const { data: acct } = await sb.from("accounts").select("*").eq("id", accountId).single();
    const { data: contract } = ls[0].contract_id
      ? await sb.from("contracts").select("payment_terms_days,po_number").eq("id", ls[0].contract_id).maybeSingle()
      : { data: null };
    const due = new Date(invoiceDate);
    due.setUTCDate(due.getUTCDate() + (contract?.payment_terms_days ?? Number(billSettings?.value?.due_days ?? 30)));
    const dueDate = due.toISOString().slice(0, 10);
    const total = round2(ls.reduce((a, l) => a + Number(l.amount), 0));
    const reference = `${run.name}${contract?.po_number ? ` / PO ${contract.po_number}` : ""}`;
    const { data: already } = await sb.from("invoice_exports").select("id").eq("run_id", runId)
      .eq("account_id", accountId).eq("target", p).eq("status", "sent").maybeSingle();
    if (already) { results.push({ account: acct.name, skipped: "already exported" }); continue; }
    try {
      let externalId: string, number: string;
      if (p === "xero") {
        const contactId = await xeroContactId(sb, acct);
        const body = { Invoices: [{
          Type: "ACCREC", Contact: { ContactID: contactId }, Date: invoiceDate, DueDate: dueDate,
          Reference: reference, Status: "DRAFT", LineAmountTypes: "Exclusive", CurrencyCode: "CAD",
          LineItems: ls.map((l) => {
            const { qty, unit } = qtyUnit(l, 4);
            return {
              Description: l.description, Quantity: qty, UnitAmount: unit,
              AccountCode: l.account_code || s[`${l.line_type}_account`] || s.default_account || "200",
              TaxType: l.tax_code || s.tax_type || (() => {
                throw new HttpError(400, "Map the Xero GST tax rate in Administration → Integrations before exporting");
              })(),
              ...(l.item_code || s[`${l.line_type}_item`] ? { ItemCode: l.item_code || s[`${l.line_type}_item`] } : {}),
            };
          }),
        }] };
        const out = await xero(sb, "Invoices?unitdp=4", {
          method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": `${runId}-${accountId}` },
        });
        externalId = out.Invoices[0].InvoiceID;
        number = out.Invoices[0].InvoiceNumber;
      } else {
        const customerId = await qboCustomerId(sb, acct);
        const body = {
          CustomerRef: { value: customerId }, TxnDate: invoiceDate, DueDate: dueDate,
          PrivateNote: reference, CustomerMemo: { value: `Managed print services — ${run.name}` },
          GlobalTaxCalculation: "TaxExcluded",
          BillEmail: acct.billing_email ? { Address: acct.billing_email } : undefined,
          Line: ls.map((l) => {
            const { qty, unit } = qtyUnit(l, 7);
            const item = l.item_code || s[`${l.line_type}_item`] || s.default_item;
            if (!item) throw new HttpError(400, `Map a QuickBooks product/service for "${l.line_type}" lines in Administration → Integrations`);
            return {
              DetailType: "SalesItemLineDetail", Amount: round2(qty * unit), Description: l.description,
              SalesItemLineDetail: { ItemRef: { value: item }, Qty: qty, UnitPrice: unit,
                TaxCodeRef: { value: l.tax_code || s.tax_code_id || (() => {
                  throw new HttpError(400, "Map the QuickBooks GST tax code in Administration → Integrations before exporting");
                })() } },
            };
          }),
        };
        const out = await qbo(sb, "invoice", { method: "POST", body: JSON.stringify(body) });
        externalId = out.Invoice.Id;
        number = out.Invoice.DocNumber ?? `${prefix}${externalId}`;
      }
      await sb.from("invoice_exports").insert({ run_id: runId, account_id: accountId, target: p, external_id: externalId,
        invoice_number: number, status: "sent", total });
      await logSync(sb, p, "push_invoice", true, `${acct.name}: ${number} $${total}`, "account", accountId);
      results.push({ account: acct.name, ok: true, invoice: number, total });
    } catch (e) {
      const msg = (e as Error).message;
      await sb.from("invoice_exports").insert({ run_id: runId, account_id: accountId, target: p, status: "error", error: msg, total });
      await logSync(sb, p, "push_invoice", false, `${acct?.name}: ${msg}`, "account", accountId);
      results.push({ account: acct?.name, ok: false, error: msg });
    }
  }
  const failed = results.filter((r) => r.ok === false).length;
  if (!failed) await sb.from("billing_runs").update({ status: "exported", target: p }).eq("id", runId);
  await sb.from("integrations").update({ last_sync_at: new Date().toISOString(), last_error: failed ? `${failed} invoice(s) failed` : null }).eq("provider", p);
  return { ok: failed === 0, results };
}

// ---------------------------------------------------------------------------
Deno.serve(handle(async (req) => {
  const url = new URL(req.url);
  const sb = admin();

  // OAuth callback (browser redirect from Xero / Intuit)
  const cb = url.pathname.match(/\/callback\/(xero|qbo)\/?$/);
  if (req.method === "GET" && cb) {
    const p = cb[1] as Provider;
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const back = (ok: boolean, msg = "") =>
      Response.redirect(`${APP_URL}#/admin/integrations?provider=${p}&ok=${ok ? 1 : 0}&msg=${encodeURIComponent(msg)}`, 302);
    if (!(p in cfg)) return back(false, "unknown provider");
    const { data: sec } = await sb.from("integration_secrets").select("oauth_state").eq("provider", p).single();
    if (!state || sec?.oauth_state !== state) return back(false, "OAuth state mismatch — start again");
    try {
      const t = await tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri(p) });
      await saveTokens(sb, p, t);
      let tenantId = "", tenantName = "";
      if (p === "xero") {
        const r = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${t.access_token}` } });
        const conns = await r.json();
        tenantId = conns?.[0]?.tenantId ?? "";
        tenantName = conns?.[0]?.tenantName ?? "";
      } else {
        tenantId = url.searchParams.get("realmId") ?? "";
        const r = await fetch(`${QBO_BASE}/v3/company/${tenantId}/companyinfo/${tenantId}?minorversion=${QBO_MINOR}`, {
          headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" },
        });
        tenantName = (await r.json())?.CompanyInfo?.CompanyName ?? "";
      }
      await sb.from("integrations").update({ connected: true, tenant_id: tenantId, tenant_name: tenantName,
        connected_at: new Date().toISOString(), last_error: null }).eq("provider", p);
      await logSync(sb, p, "connect", true, `Connected to ${tenantName}`);
      return back(true, tenantName);
    } catch (e) {
      await logSync(sb, p, "connect", false, (e as Error).message);
      return back(false, (e as Error).message);
    }
  }

  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const body = await req.json();
  const p = body.provider as Provider;
  if (!(p in cfg)) throw new HttpError(400, "provider must be xero or qbo");

  if (body.action === "connect") {
    await requireStaff(req, ["admin", "manager"]);
    if (!cfg[p].id()) throw new HttpError(400, `${p.toUpperCase()}_CLIENT_ID secret is not set on the function`);
    const state = randomToken(16);
    await sb.from("integration_secrets").upsert({ provider: p, oauth_state: state, updated_at: new Date().toISOString() });
    const q = new URLSearchParams({
      response_type: "code", client_id: cfg[p].id(), redirect_uri: redirectUri(p), state,
      scope: p === "xero" ? XERO_SCOPES : "com.intuit.quickbooks.accounting",
    });
    return json({ ok: true, url: `${cfg[p].authorize}?${q}` });
  }

  if (body.action === "disconnect") {
    await requireStaff(req, ["admin", "manager"]);
    await sb.from("integration_secrets").update({ access_token: null, refresh_token: null, expires_at: null }).eq("provider", p);
    await sb.from("integrations").update({ connected: false, tenant_id: null, tenant_name: null }).eq("provider", p);
    return json({ ok: true });
  }

  if (body.action === "lookup") {
    await requireStaff(req);
    if (p === "xero") {
      const [tax, accts, items] = await Promise.all([
        xero(sb, "TaxRates"), xero(sb, `Accounts?where=${encodeURIComponent('Class=="REVENUE"')}`), xero(sb, "Items"),
      ]);
      return json({ ok: true,
        tax: tax.TaxRates?.filter((t: { Status: string }) => t.Status === "ACTIVE").map((t: Record<string, unknown>) => ({ id: t.TaxType, name: `${t.Name} (${t.EffectiveRate}%)` })),
        accounts: accts.Accounts?.map((a: Record<string, unknown>) => ({ id: a.Code, name: `${a.Code} — ${a.Name}` })),
        items: items.Items?.map((i: Record<string, unknown>) => ({ id: i.Code, name: `${i.Code} — ${i.Name ?? ""}` })) });
    }
    const [tax, items] = await Promise.all([
      qboQuery(sb, "select * from TaxCode where Active = true"),
      qboQuery(sb, "select * from Item where Active = true maxresults 1000"),
    ]);
    return json({ ok: true,
      tax: tax.QueryResponse?.TaxCode?.map((t: Record<string, unknown>) => ({ id: t.Id, name: t.Name })),
      items: items.QueryResponse?.Item?.map((i: Record<string, unknown>) => ({ id: i.Id, name: i.Name })) });
  }

  if (body.action === "push") {
    await requireStaff(req, ["admin", "manager"]);
    return json(await push(sb, p, body.run_id, body.account_ids));
  }

  throw new HttpError(400, "unknown action");
}));
