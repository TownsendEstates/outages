// HubSpot CRM helpers (private app token in HUBSPOT_TOKEN)
// Required private-app scopes: crm.objects.companies.read/write, crm.objects.contacts.read,
// crm.schemas.companies.write (for custom properties), tickets, crm.objects.notes? (notes use the
// standard objects scope on most portals).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { HttpError, logSync, round2 } from "./util.ts";

const HS = "https://api.hubapi.com";

export async function hs(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("HUBSPOT_TOKEN");
  if (!token) throw new HttpError(400, "HUBSPOT_TOKEN secret is not set on the function");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${HS}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1100 * (attempt + 1))); continue; }
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new HttpError(res.status, `HubSpot: ${body.message ?? text}`);
    return body;
  }
  throw new HttpError(429, "HubSpot rate limit — try again shortly");
}

const PROPS = [
  { name: "urfleet_account_id", label: "UrFleet Account ID", type: "string", fieldType: "text" },
  { name: "urfleet_devices", label: "UrFleet Devices", type: "number", fieldType: "number" },
  { name: "urfleet_managed_devices", label: "UrFleet Managed Devices", type: "number", fieldType: "number" },
  { name: "urfleet_monthly_volume", label: "UrFleet Monthly Volume (AMV)", type: "number", fieldType: "number" },
  { name: "urfleet_open_alerts", label: "UrFleet Open Alerts", type: "number", fieldType: "number" },
  { name: "urfleet_last_reported", label: "UrFleet Last Reported", type: "datetime", fieldType: "date" },
  { name: "urfleet_contract_tier", label: "UrFleet Contract Tier", type: "string", fieldType: "text" },
  { name: "urfleet_mrr", label: "UrFleet Est. Monthly Revenue", type: "number", fieldType: "number" },
];

export async function ensureProperties() {
  try {
    await hs("/crm/v3/properties/companies/groups", { method: "POST",
      body: JSON.stringify({ name: "urfleet", label: "UrFleet Managed Print", displayOrder: -1 }) });
  } catch (e) { if ((e as HttpError).status !== 409) throw e; }
  let created = 0;
  for (const p of PROPS) {
    try {
      await hs("/crm/v3/properties/companies", { method: "POST", body: JSON.stringify({ ...p, groupName: "urfleet" }) });
      created++;
    } catch (e) { if ((e as HttpError).status !== 409) throw e; }
  }
  return created;
}

async function accountStats(sb: SupabaseClient, accountId: string) {
  const [{ data: devs }, { count: openAlerts }, { data: contracts }] = await Promise.all([
    sb.from("devices").select("is_managed,amv_total,amv_mono,amv_color,last_audit,contract_id").eq("account_id", accountId).eq("is_blocked", false),
    sb.from("alerts").select("id", { count: "exact", head: true }).eq("account_id", accountId).neq("status", "closed"),
    sb.from("contracts").select("*").eq("account_id", accountId).eq("status", "active"),
  ]);
  const d = devs ?? [];
  const last = d.map((x) => x.last_audit).filter(Boolean).sort().pop();
  let mrr = 0;
  for (const c of contracts ?? []) {
    const cd = d.filter((x) => x.contract_id === c.id);
    const mono = cd.reduce((a, x) => a + (x.amv_mono ?? 0), 0);
    const color = cd.reduce((a, x) => a + (x.amv_color ?? 0), 0);
    const cycle = c.billing_cycle === "quarterly" ? 3 : c.billing_cycle === "annual" ? 12 : 1;
    mrr += Number(c.base_fee) / cycle
      + Math.max(0, mono - c.included_mono / cycle) * Number(c.mono_rate)
      + Math.max(0, color - c.included_color / cycle) * Number(c.color_rate);
  }
  return {
    urfleet_devices: d.length,
    urfleet_managed_devices: d.filter((x) => x.is_managed).length,
    urfleet_monthly_volume: d.reduce((a, x) => a + (x.amv_total ?? 0), 0),
    urfleet_open_alerts: openAlerts ?? 0,
    urfleet_last_reported: last ? new Date(last).toISOString() : null,
    urfleet_contract_tier: (contracts ?? []).map((c) => c.tier).join(", ") || null,
    urfleet_mrr: round2(mrr),
  };
}

export async function pushCompanies(sb: SupabaseClient, accountIds?: string[]) {
  let q = sb.from("accounts").select("*").neq("status", "inactive");
  if (accountIds?.length) q = q.in("id", accountIds);
  const { data: accounts } = await q;
  const out = { created: 0, updated: 0, failed: 0, errors: [] as string[] };
  for (const a of accounts ?? []) {
    try {
      const props: Record<string, unknown> = {
        name: a.name, phone: a.phone ?? undefined, address: a.address1 ?? undefined, city: a.city ?? undefined,
        state: a.province ?? undefined, zip: a.postal_code ?? undefined, country: a.country ?? undefined,
        industry: undefined, numberofemployees: a.employees ?? undefined,
        domain: a.website ? a.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : undefined,
        urfleet_account_id: a.id, ...(await accountStats(sb, a.id)),
      };
      Object.keys(props).forEach((k) => props[k] === undefined && delete props[k]);
      let id = a.hubspot_company_id;
      if (!id) {
        const filters = props.domain
          ? [{ propertyName: "domain", operator: "EQ", value: props.domain }]
          : [{ propertyName: "name", operator: "EQ", value: a.name }];
        const found = await hs("/crm/v3/objects/companies/search", { method: "POST",
          body: JSON.stringify({ filterGroups: [{ filters }], properties: ["name"], limit: 1 }) });
        id = found.results?.[0]?.id;
      }
      if (id) {
        await hs(`/crm/v3/objects/companies/${id}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
        out.updated++;
      } else {
        const c = await hs("/crm/v3/objects/companies", { method: "POST", body: JSON.stringify({ properties: props }) });
        id = c.id;
        out.created++;
      }
      if (id !== a.hubspot_company_id) await sb.from("accounts").update({ hubspot_company_id: id }).eq("id", a.id);
    } catch (e) {
      out.failed++;
      out.errors.push(`${a.name}: ${(e as Error).message}`);
      await logSync(sb, "hubspot", "push_company", false, (e as Error).message, "account", a.id);
    }
  }
  await logSync(sb, "hubspot", "push_companies", out.failed === 0, `created ${out.created}, updated ${out.updated}, failed ${out.failed}`);
  return out;
}

export async function pullCompanies(sb: SupabaseClient, onlyCustomers = true) {
  let after: string | undefined;
  let created = 0, linked = 0;
  const { data: existing } = await sb.from("accounts").select("id,name,hubspot_company_id");
  const byHs = new Map((existing ?? []).filter((a) => a.hubspot_company_id).map((a) => [a.hubspot_company_id, a]));
  const byName = new Map((existing ?? []).map((a) => [a.name.trim().toLowerCase(), a]));
  do {
    const body: Record<string, unknown> = {
      limit: 100, after, properties: ["name", "phone", "address", "city", "state", "zip", "country", "domain", "industry", "numberofemployees", "lifecyclestage"],
      filterGroups: onlyCustomers ? [{ filters: [{ propertyName: "lifecyclestage", operator: "EQ", value: "customer" }] }] : [],
    };
    const page = await hs("/crm/v3/objects/companies/search", { method: "POST", body: JSON.stringify(body) });
    for (const c of page.results ?? []) {
      const p = c.properties;
      if (!p.name || byHs.has(c.id)) continue;
      const match = byName.get(String(p.name).trim().toLowerCase());
      if (match) {
        await sb.from("accounts").update({ hubspot_company_id: c.id }).eq("id", match.id);
        linked++;
      } else {
        await sb.from("accounts").insert({
          name: p.name, phone: p.phone, address1: p.address, city: p.city, province: p.state || "AB", postal_code: p.zip,
          country: p.country || "Canada", website: p.domain, industry: p.industry,
          employees: p.numberofemployees ? Number(p.numberofemployees) : null, hubspot_company_id: c.id,
          status: p.lifecyclestage === "customer" ? "active" : "prospect",
        });
        created++;
      }
    }
    after = page.paging?.next?.after;
  } while (after);
  await logSync(sb, "hubspot", "pull_companies", true, `created ${created}, linked ${linked}`);
  return { created, linked };
}

export async function pushAlertTickets(sb: SupabaseClient, alertIds?: string[], onlyFlagged = false) {
  let q = sb.from("alerts").select("*, devices(serial,model,manufacturer,ip,location), accounts(name,hubspot_company_id), alert_definitions(create_hubspot_ticket)")
    .neq("status", "closed").is("hubspot_ticket_id", null);
  if (alertIds?.length) q = q.in("id", alertIds);
  const { data: alerts } = await q.limit(200);
  const { data: integ } = await sb.from("integrations").select("settings").eq("provider", "hubspot").single();
  const st = (integ?.settings ?? {}) as Record<string, string>;
  let created = 0;
  const errors: string[] = [];
  for (const a of alerts ?? []) {
    if (onlyFlagged && !a.alert_definitions?.create_hubspot_ticket) continue;
    try {
      const dev = a.devices ?? {};
      const t = await hs("/crm/v3/objects/tickets", { method: "POST", body: JSON.stringify({ properties: {
        subject: `[UrFleet] ${a.accounts?.name ?? ""} — ${a.message ?? a.kind}`.slice(0, 250),
        content: [`Alert: ${a.message}`, `Device: ${dev.manufacturer ?? ""} ${dev.model ?? ""}`, `Serial: ${dev.serial ?? ""}`,
          `IP: ${dev.ip ?? ""}`, `Location: ${dev.location ?? ""}`, `Est. empty: ${a.est_empty_date ?? "n/a"}`,
          `First detected: ${a.first_detected}`].join("\n"),
        hs_pipeline: st.ticket_pipeline || "0",
        hs_pipeline_stage: st.ticket_stage || "1",
        hs_ticket_priority: a.severity === "critical" ? "HIGH" : a.severity === "warning" ? "MEDIUM" : "LOW",
      } }) });
      if (a.accounts?.hubspot_company_id) {
        await hs(`/crm/v4/objects/tickets/${t.id}/associations/default/companies/${a.accounts.hubspot_company_id}`, { method: "PUT" });
      }
      await sb.from("alerts").update({ hubspot_ticket_id: t.id }).eq("id", a.id);
      created++;
    } catch (e) {
      errors.push((e as Error).message);
      await logSync(sb, "hubspot", "push_ticket", false, (e as Error).message, "alert", a.id);
    }
  }
  if (created) await logSync(sb, "hubspot", "push_tickets", true, `created ${created} ticket(s)`);
  return { created, errors };
}

export async function pushBillingNotes(sb: SupabaseClient, runId: string) {
  const { data: run } = await sb.from("billing_runs").select("*").eq("id", runId).single();
  const { data: lines } = await sb.from("billing_lines").select("account_id,line_type,pages,amount").eq("run_id", runId);
  const byAcct = new Map<string, { mono: number; color: number; total: number }>();
  for (const l of lines ?? []) {
    const x = byAcct.get(l.account_id) ?? { mono: 0, color: 0, total: 0 };
    if (l.line_type === "mono") x.mono += Number(l.pages ?? 0);
    if (l.line_type === "color") x.color += Number(l.pages ?? 0);
    if (l.line_type !== "device") x.total += Number(l.amount);
    byAcct.set(l.account_id, x);
  }
  let created = 0;
  for (const [accountId, x] of byAcct) {
    const { data: a } = await sb.from("accounts").select("name,hubspot_company_id").eq("id", accountId).single();
    if (!a?.hubspot_company_id) continue;
    const note = await hs("/crm/v3/objects/notes", { method: "POST", body: JSON.stringify({ properties: {
      hs_timestamp: new Date().toISOString(),
      hs_note_body: `<b>UrFleet meter billing — ${run.name}</b><br>Period ${run.period_start} to ${run.period_end}<br>` +
        `Mono pages: ${x.mono.toLocaleString()}<br>Colour pages: ${x.color.toLocaleString()}<br>Invoice subtotal: $${round2(x.total).toFixed(2)} CAD (+GST)`,
    } }) });
    await hs(`/crm/v4/objects/notes/${note.id}/associations/default/companies/${a.hubspot_company_id}`, { method: "PUT" });
    created++;
  }
  await logSync(sb, "hubspot", "push_billing_notes", true, `${created} note(s) for ${run.name}`);
  return { created };
}
