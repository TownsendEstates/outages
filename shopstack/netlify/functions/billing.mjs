// SaaS billing: Stripe Checkout for plan upgrades + webhook to sync tenant status.
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, APP_URL (+ core env)
import Stripe from "stripe";
import { admin, authorize, json, preflight } from "../lib/core.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_missing");

export const handler = async (event) => {
  const pf = preflight(event);
  if (pf) return pf;
  const sb = admin();

  // Stripe webhook
  if (event.headers["stripe-signature"]) {
    let evt;
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
      evt = stripe.webhooks.constructEvent(raw, event.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      return json(400, { error: `Bad signature: ${e.message}` });
    }
    const obj = evt.data.object;
    const tenantId = obj.metadata?.tenant_id || obj.subscription_details?.metadata?.tenant_id;
    if (evt.type === "checkout.session.completed" && tenantId) {
      await sb.from("tenants").update({
        plan_id: obj.metadata.plan_id, status: "active",
        stripe_customer: obj.customer, stripe_subscription: obj.subscription,
      }).eq("id", tenantId);
    }
    if (evt.type === "customer.subscription.updated" || evt.type === "customer.subscription.deleted") {
      const status = { active: "active", trialing: "trial", past_due: "past_due", unpaid: "suspended", canceled: "cancelled" }[obj.status] || "active";
      await sb.from("tenants").update({ status }).eq("stripe_subscription", obj.id);
    }
    return json(200, { received: true });
  }

  // Create checkout session (owner only)
  try {
    const { tenantId, planId } = JSON.parse(event.body || "{}");
    const auth = await authorize(event, tenantId, ["owner"]);
    const { data: plan } = await sb.from("plans").select("*").eq("id", planId).single();
    if (!plan?.stripe_price) return json(400, { error: "Plan is not purchasable online; contact sales" });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan.stripe_price, quantity: 1 }],
      customer: auth.tenant.stripe_customer || undefined,
      customer_email: auth.tenant.stripe_customer ? undefined : auth.user.email,
      automatic_tax: { enabled: true }, // GST/HST on the SaaS subscription itself
      metadata: { tenant_id: tenantId, plan_id: planId },
      subscription_data: { metadata: { tenant_id: tenantId, plan_id: planId } },
      success_url: `${process.env.APP_URL}/?billing=success`,
      cancel_url: `${process.env.APP_URL}/?billing=cancel`,
    });
    return json(200, { url: session.url });
  } catch (e) {
    return json(e.status || 500, { error: e.message });
  }
};
