// Sends a push notification to a page's followers for one incident update.
// Called by the owner's app right after an update is posted.
//
// POST { update_id: string }   Authorization: Bearer <owner JWT>
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATUS_LABEL: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const { update_id } = await req.json().catch(() => ({}));
  if (typeof update_id !== "string") return json({ error: "update_id_required" }, 400);

  // 1. Authorize: read the update as the caller. RLS only returns it to the
  //    owner of the organization it belongs to.
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: update } = await asCaller
    .from("incident_updates")
    .select("id, org_id, incident_id, status, body")
    .eq("id", update_id)
    .maybeSingle();
  if (!update) return json({ error: "not_found" }, 404);

  // 2. Claim the update so a retry or double tap never notifies twice.
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: claimed } = await admin
    .from("incident_updates")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", update_id)
    .is("notified_at", null)
    .select("id");
  if (!claimed?.length) return json({ sent: 0, already_notified: true });

  const [{ data: org }, { data: incident }, { data: targets }] = await Promise.all([
    admin.from("organizations").select("name, slug").eq("id", update.org_id).single(),
    admin.from("incidents").select("title").eq("id", update.incident_id).single(),
    admin.rpc("notification_targets", { p_org: update.org_id }),
  ]);
  if (!org || !incident || !targets?.length) return json({ sent: 0 });

  const body = `${STATUS_LABEL[update.status] ?? update.status}: ${update.body}`.slice(0, 240);
  const messages = targets.map((t: { push_token: string }) => ({
    to: t.push_token,
    title: `${org.name} — ${incident.title}`.slice(0, 120),
    body,
    sound: "default",
    channelId: "status-updates",
    data: { slug: org.slug },
  }));

  // 3. Expo push API accepts up to 100 messages per request.
  let sent = 0;
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) continue;
    const { data: tickets } = await res.json();
    (tickets ?? []).forEach((ticket: { status: string; details?: { error?: string } }, n: number) => {
      if (ticket.status === "ok") sent++;
      else if (ticket.details?.error === "DeviceNotRegistered") dead.push(chunk[n].to);
    });
  }

  // 4. Drop tokens for devices that uninstalled or revoked permission.
  if (dead.length) {
    await admin.from("devices").update({ push_token: null }).in("push_token", dead);
  }

  return json({ sent, targeted: messages.length });
});
