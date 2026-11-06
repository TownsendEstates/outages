// UrFleet — HubSpot CRM sync
// POST { action: "status" | "ensure_properties" | "push_companies" | "pull_companies" |
//        "push_alert_tickets" | "push_billing_notes", ... }
import { admin, handle, HttpError, json, requireStaff } from "../_shared/util.ts";
import { ensureProperties, hs, pullCompanies, pushAlertTickets, pushBillingNotes, pushCompanies } from "../_shared/hubspot.ts";

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const body = await req.json();
  const sb = admin();

  switch (body.action) {
    case "status": {
      await requireStaff(req);
      const info = await hs("/account-info/v3/details");
      await sb.from("integrations").update({ connected: true, tenant_id: String(info.portalId),
        tenant_name: info.uiDomain ?? `Portal ${info.portalId}`, connected_at: new Date().toISOString(), last_error: null })
        .eq("provider", "hubspot");
      return json({ ok: true, portalId: info.portalId, timeZone: info.timeZone, currency: info.companyCurrency });
    }
    case "ensure_properties":
      await requireStaff(req, ["admin", "manager"]);
      return json({ ok: true, created: await ensureProperties() });
    case "push_companies":
      await requireStaff(req, ["admin", "manager", "sales"]);
      await ensureProperties();
      return json({ ok: true, ...(await pushCompanies(sb, body.account_ids)) });
    case "pull_companies":
      await requireStaff(req, ["admin", "manager", "sales"]);
      return json({ ok: true, ...(await pullCompanies(sb, body.only_customers !== false)) });
    case "push_alert_tickets":
      await requireStaff(req, ["admin", "manager", "tech"]);
      return json({ ok: true, ...(await pushAlertTickets(sb, body.alert_ids)) });
    case "push_billing_notes":
      await requireStaff(req, ["admin", "manager"]);
      return json({ ok: true, ...(await pushBillingNotes(sb, body.run_id)) });
    default:
      throw new HttpError(400, "unknown action");
  }
}));
