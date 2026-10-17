// Tenant user management: invite by email and link to the tenant with a role (owner/manager only).
import { handle, authorize, admin } from "../lib/core.mjs";

const ROLES = ["owner", "manager", "advisor", "technician", "accountant", "sales", "viewer"];

export const handler = handle(async ({ tenantId, email, role, name, active = true }, event) => {
  const auth = await authorize(event, tenantId, ["owner", "manager"]);
  if (auth.demo) return { ok: true, demo: true };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "")) throw { status: 400, message: "Valid email required" };
  if (!ROLES.includes(role)) throw { status: 400, message: "Invalid role" };
  if (role === "owner" && auth.role !== "owner") throw { status: 403, message: "Only an owner can add owners" };
  const sb = admin();

  const { data: plan } = await sb.from("plans").select("max_users").eq("id", auth.tenant.plan_id).single();
  const { count } = await sb.from("tenant_members").select("user_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true);
  if (plan && count >= plan.max_users) throw { status: 402, message: `Your plan allows ${plan.max_users} users` };

  // Existing auth user? Otherwise send a Supabase invite email.
  let userId = null;
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  userId = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id || null;
  if (!userId) {
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo: process.env.APP_URL });
    if (error) throw { status: 400, message: error.message };
    userId = data.user.id;
  }
  const { error } = await sb.from("tenant_members").upsert({ tenant_id: tenantId, user_id: userId, role, display_name: name || email, active });
  if (error) throw { status: 400, message: error.message };
  return { ok: true, userId };
});
