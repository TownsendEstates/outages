// Shared helpers for ShopStack Netlify functions.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONNECTOR_KEY (32+ chars), ALLOWED_ORIGIN
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const admin = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

const cors = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", ...cors },
  body: JSON.stringify(body),
});

export const preflight = (event) => (event.httpMethod === "OPTIONS" ? { statusCode: 204, headers: cors } : null);

/** Demo mode: the function has no Supabase configured. Lets the static demo call AI/connectors. */
export const isDemoBackend = () => !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Verify the caller's Supabase JWT and tenant membership.
 * Returns { user, tenant, role } or throws { status, message }.
 */
export async function authorize(event, tenantId, roles = null) {
  if (isDemoBackend()) {
    if (process.env.ALLOW_DEMO !== "true") throw { status: 503, message: "Backend not configured" };
    return { user: { id: "demo" }, tenant: { id: tenantId, plan_id: "enterprise", settings: {} }, role: "owner", demo: true };
  }
  const token = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw { status: 401, message: "Missing token" };
  const sb = admin();
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u?.user) throw { status: 401, message: "Invalid session" };
  const { data: m } = await sb
    .from("tenant_members")
    .select("role, active, tenants(*)")
    .eq("tenant_id", tenantId)
    .eq("user_id", u.user.id)
    .maybeSingle();
  let role = m?.active ? m.role : null;
  let tenant = m?.tenants;
  if (!role) {
    const { data: pa } = await sb.from("platform_admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!pa) throw { status: 403, message: "Not a member of this tenant" };
    role = "owner";
    ({ data: tenant } = await sb.from("tenants").select("*").eq("id", tenantId).single());
  }
  if (tenant?.status === "suspended") throw { status: 402, message: "Tenant suspended" };
  if (roles && !roles.includes(role)) throw { status: 403, message: "Insufficient role" };
  return { user: u.user, tenant, role };
}

// ---- Secret envelope (AES-256-GCM) for connector credentials ----
const key = () => crypto.createHash("sha256").update(process.env.CONNECTOR_KEY || "").digest();

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function unseal(b64) {
  const buf = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
}

export const handle = (fn) => async (event) => {
  const pf = preflight(event);
  if (pf) return pf;
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  try {
    const body = JSON.parse(event.body || "{}");
    return json(200, await fn(body, event));
  } catch (e) {
    if (e?.status) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: e?.message || "Server error" });
  }
};
