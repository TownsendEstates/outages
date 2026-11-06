// UrFleet — scheduled jobs (call hourly from pg_cron via pg_net, header x-cron-secret)
//  1. DCA offline alerts            (sweep_dca_offline())
//  2. Device "no data" alerts       (managed devices silent for N days)
//  3. HubSpot tickets for alerts whose definition has create_hubspot_ticket = true
//  4. Email notifications for new alerts with recipients (Resend, if RESEND_API_KEY is set)
import { admin, handle, HttpError, json } from "../_shared/util.ts";
import { pushAlertTickets } from "../_shared/hubspot.ts";

Deno.serve(handle(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) throw new HttpError(401, "bad cron secret");
  const sb = admin();
  const report: Record<string, unknown> = {};

  const { data: dcaN } = await sb.rpc("sweep_dca_offline");
  report.dca_offline_checked = dcaN;

  // no_data alerts
  const { data: defs } = await sb.from("alert_definitions").select("*").eq("enabled", true).eq("kind", "no_data");
  let opened = 0;
  for (const def of defs ?? []) {
    const cutoff = new Date(Date.now() - Number(def.threshold) * 86_400_000).toISOString();
    let q = sb.from("devices").select("id,account_id,serial,model,last_audit").eq("is_blocked", false).lt("last_audit", cutoff);
    if (def.managed_only) q = q.eq("is_managed", true);
    if (def.account_id) q = q.eq("account_id", def.account_id);
    const { data: stale } = await q;
    for (const d of stale ?? []) {
      const { error } = await sb.from("alerts").insert({
        definition_id: def.id, account_id: d.account_id, device_id: d.id, kind: "no_data", severity: def.severity,
        message: `${d.model ?? "Device"} ${d.serial} has not reported since ${String(d.last_audit).slice(0, 10)}`,
      });
      if (!error) opened++; // unique index suppresses duplicates
    }
  }
  report.no_data_opened = opened;

  if (Deno.env.get("HUBSPOT_TOKEN")) {
    report.hubspot = await pushAlertTickets(sb, undefined, true).catch((e) => ({ error: (e as Error).message }));
  }

  const resend = Deno.env.get("RESEND_API_KEY");
  if (resend) {
    const { data: pending } = await sb.from("alerts")
      .select("*, alert_definitions(recipients,name), accounts(name), devices(serial,model,ip,location)")
      .neq("status", "closed").is("notified_at", null).limit(200);
    const byRecipients = new Map<string, typeof pending>();
    for (const a of pending ?? []) {
      const r = (a.alert_definitions?.recipients ?? []).filter(Boolean);
      if (!r.length) continue;
      const k = r.sort().join(",");
      byRecipients.set(k, [...(byRecipients.get(k) ?? []), a]);
    }
    let sent = 0;
    for (const [to, list] of byRecipients) {
      const rows = list!.map((a) => `<tr><td>${a.accounts?.name ?? ""}</td><td>${a.devices?.model ?? ""} ${a.devices?.serial ?? ""}</td><td>${a.message}</td><td>${a.est_empty_date ?? ""}</td></tr>`).join("");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("ALERT_FROM") ?? "UrFleet Alerts <alerts@urfleet.ca>", to: to.split(","),
          subject: `UrFleet: ${list!.length} new fleet alert(s)`,
          html: `<h3>New UrFleet alerts</h3><table border="1" cellpadding="6" cellspacing="0"><tr><th>Account</th><th>Device</th><th>Alert</th><th>Est. empty</th></tr>${rows}</table>`,
        }),
      });
      if (res.ok) {
        sent += list!.length;
        await sb.from("alerts").update({ notified_at: new Date().toISOString() }).in("id", list!.map((a) => a.id));
      }
    }
    report.emailed = sent;
  }
  return json({ ok: true, ...report });
}));
