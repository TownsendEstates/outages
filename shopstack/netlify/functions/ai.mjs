// ShopStack AI gateway: one endpoint, task-specific prompts, plan-metered.
// Env: ANTHROPIC_API_KEY (+ _lib.mjs env)
import Anthropic from "@anthropic-ai/sdk";
import { handle, authorize, admin } from "../lib/core.mjs";

const client = new Anthropic();
const MODEL = process.env.AI_MODEL || "claude-opus-5-5";

const BASE = `You are ShopStack AI, built into a Canadian tire and automotive shop management platform.
Use Canadian spelling, CAD currency, metric units with imperial in brackets where customers expect it (tire pressure in PSI).
Be concise and practical. Never invent prices, stock, labour times or part numbers that aren't in the provided context. If you need data you don't have, say what is missing.
Alberta shops are AMVIC-regulated: estimates must be written and customer authorization is required before exceeding them.`;

// task -> { system, json, effort }
const TASKS = {
  estimate: {
    effort: "medium",
    json: true,
    system: `${BASE}
Turn a customer's concern plus vehicle details into a draft repair estimate.
Return JSON only: {"summary":string,"jobs":[{"title":string,"type":"labour"|"part"|"tire"|"fee","description":string,"hours":number|null,"qty":number,"sku":string|null,"notes":string}],"questions":[string],"safety_flags":[string]}
Use the shop's inventory list when a matching SKU exists. Hours are typical book-time estimates labelled as estimates in notes; the advisor will verify against MOTOR or ALLDATA.`,
  },
  explain: {
    effort: "low",
    system: `${BASE}
Rewrite technician notes and inspection results into a friendly, plain-language message for the vehicle owner (SMS-length unless asked otherwise).
Group by urgency: Needs attention now (red), Plan soon (yellow), Good (green). No jargon, no scare tactics.`,
  },
  forecast: {
    effort: "medium",
    json: true,
    system: `${BASE}
You forecast tire and parts demand for a Canadian shop. Account for seasonality: the provincial winter tire laws (Quebec Dec 1 - Mar 15, BC highway routes Oct 1 - Apr 30) and the fall/spring changeover rush in the Prairies (Oct-Nov, Apr-May).
Return JSON only: {"insights":[string],"reorder":[{"sku":string,"description":string,"on_hand":number,"suggested_qty":number,"reason":string}],"risks":[string]}`,
  },
  pricing: {
    effort: "medium",
    system: `${BASE}
Review item costs, prices, distributor quotes and margins. Recommend pricing moves, call out margin leaks (items under target margin, stale costs), and say which distributor to buy from for each line. Keep it to a short prioritized list.`,
  },
  report: {
    effort: "medium",
    system: `${BASE}
You answer business questions using the JSON snapshot of the shop's data provided. Show the numbers you used. If the snapshot can't answer it, say exactly which report to run instead.`,
  },
  categorize: {
    effort: "low",
    json: true,
    system: `${BASE}
Categorize bank transactions to the shop's chart of accounts. Return JSON only: {"items":[{"id":string,"account":string,"confidence":number,"reason":string}]}. Use only account codes from the provided chart.`,
  },
  review: {
    effort: "low",
    system: `${BASE}
Draft a short, warm, professional public reply to a customer review. Don't admit legal liability or disclose personal information (PIPA).`,
  },
  campaign: {
    effort: "low",
    system: `${BASE}
Write marketing copy for SMS (max 300 chars) and email (subject + body). CASL: include the business name and an opt-out line ("Reply STOP to opt out" for SMS, unsubscribe line for email).`,
  },
  anomaly: {
    effort: "medium",
    system: `${BASE}
Audit the provided data for problems: unbilled technician hours, work orders open too long, discounts above policy, negative margins, inventory shrink, AR over 60 days, payroll anomalies. Return a prioritized list with the dollar impact where you can calculate it.`,
  },
  chat: {
    effort: "medium",
    system: `${BASE}
You are the in-app assistant. Help staff use ShopStack and run the business. The JSON context is a snapshot of the tenant's current data.`,
  },
};

async function checkQuota(sb, tenant) {
  const { data: plan } = await sb.from("plans").select("ai_actions").eq("id", tenant.plan_id).single();
  if (!plan || plan.ai_actions < 0) return;
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const { count } = await sb
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .gte("at", since.toISOString());
  if ((count || 0) >= plan.ai_actions) throw { status: 429, message: `AI limit of ${plan.ai_actions} actions/month reached for your plan` };
}

export const handler = handle(async ({ tenantId, task, prompt, context, history }, event) => {
  const t = TASKS[task];
  if (!t) throw { status: 400, message: `Unknown task ${task}` };
  if (!prompt || String(prompt).length > 20000) throw { status: 400, message: "Prompt missing or too long" };
  const auth = await authorize(event, tenantId);
  const sb = auth.demo ? null : admin();
  if (sb) await checkQuota(sb, auth.tenant);

  const ctx = context ? `\n\n<shop_context>\n${JSON.stringify(context).slice(0, 150000)}\n</shop_context>` : "";
  const prior = Array.isArray(history)
    ? history.slice(-10).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    : [];

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: t.effort },
    system: [{ type: "text", text: t.system, cache_control: { type: "ephemeral" } }],
    messages: [...prior, { role: "user", content: `${prompt}${ctx}` }],
  });

  if (response.stop_reason === "refusal") {
    return { text: "The AI declined this request. Try rephrasing it, or contact support if it looks like a mistake.", refused: true };
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();

  if (sb) {
    await sb.from("ai_usage").insert({
      tenant_id: auth.tenant.id,
      user_id: auth.user.id,
      task,
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
    });
  }

  let data = null;
  if (t.json) {
    const m = text.match(/\{[\s\S]*\}/);
    try { data = m ? JSON.parse(m[0]) : null; } catch { data = null; }
  }
  return { text, data, truncated: response.stop_reason === "max_tokens" };
});
