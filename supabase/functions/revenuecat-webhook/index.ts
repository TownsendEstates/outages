// RevenueCat -> Supabase. Keeps organizations.plan in step with the store
// subscription. This is the ONLY place a plan changes.
//
// In RevenueCat: Integrations -> Webhooks
//   URL:            https://<project>.supabase.co/functions/v1/revenuecat-webhook
//   Authorization:  Bearer <REVENUECAT_WEBHOOK_SECRET>
// The app identifies each customer to RevenueCat by organization id, so
// event.app_user_id is the organization id.
import { createClient } from "npm:@supabase/supabase-js@2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Event types after which the customer holds whatever entitlements are listed.
const ACTIVE = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
]);

function timingSafeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) {
    return new Response("unauthorized", { status: 401 });
  }

  const event = (await req.json().catch(() => null))?.event;
  if (!event?.type) return new Response("bad request", { status: 400 });

  // CANCELLATION and BILLING_ISSUE do not end access: the customer keeps the
  // plan until EXPIRATION arrives at the end of the paid period.
  let plan: "free" | "pro" | "business" | null = null;
  if (ACTIVE.has(event.type)) {
    const entitlements: string[] = event.entitlement_ids ?? [];
    plan = entitlements.includes("business") ? "business" : entitlements.includes("pro") ? "pro" : null;
  } else if (event.type === "EXPIRATION") {
    plan = "free";
  }
  if (!plan) return new Response("ignored", { status: 200 });

  // A TRANSFER or alias can list several ids; the organization id is the UUID.
  const ids: string[] = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]
    .filter((id): id is string => typeof id === "string" && UUID.test(id));
  if (!ids.length) return new Response("no organization id", { status: 200 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await admin.from("organizations").update({ plan }).in("id", ids);
  if (error) return new Response(error.message, { status: 500 }); // RevenueCat retries on 5xx

  return new Response("ok", { status: 200 });
});
