// UrFleet — PIN sign-in & staff/PIN management
//
// POST { action: "login", pin }                       -> { token_hash, user }   (public)
// POST { action: "upsert_user", id?, name, email, role, active, pin? }  (admin/manager JWT)
// POST { action: "set_pin", user_id, pin }            (admin/manager JWT, or the user themself)
//
// The browser exchanges token_hash for a real Supabase session with
// supabase.auth.verifyOtp({ token_hash, type: "email" }), so every table stays
// behind RLS for authenticated staff. PINs are stored as PBKDF2 hashes in
// app_user_secrets (service-role only) and rate-limited per IP.
import { admin, handle, HttpError, hmacHex, json, requireStaff } from "../_shared/util.ts";

const PEPPER = Deno.env.get("PIN_PEPPER") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_ADMIN_PIN = Deno.env.get("DEFAULT_ADMIN_PIN") ?? "107451";
const ADMIN_NAME = Deno.env.get("ADMIN_NAME") ?? "Scott Townsend";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "admin@urfleet.app";
const MAX_FAILS = 5;
const WINDOW_MIN = 15;

async function pbkdf2(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin + PEPPER), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$100000$${btoa(String.fromCharCode(...salt))}$${await pbkdf2(pin, salt)}`;
}

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [, , saltB64, hash] = stored.split("$");
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const calc = await pbkdf2(pin, salt);
  // constant-time compare
  if (calc.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

function validPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,8}$/.test(pin);
}

async function storePin(userId: string, pin: string) {
  const sb = admin();
  const lookup = await hmacHex(PEPPER, pin);
  const { data: clash } = await sb.from("app_user_secrets").select("user_id").eq("pin_lookup", lookup).maybeSingle();
  if (clash && clash.user_id !== userId) throw new HttpError(409, "That PIN is already in use — choose another");
  const { error } = await sb.from("app_user_secrets").upsert({
    user_id: userId, pin_hash: await hashPin(pin), pin_lookup: lookup, updated_at: new Date().toISOString(),
  });
  if (error) throw new HttpError(500, error.message);
}

async function ensureAuthUser(user: { id: string; email: string; auth_user_id: string | null }) {
  const sb = admin();
  if (user.auth_user_id) return user.auth_user_id;
  const { data, error } = await sb.auth.admin.createUser({ email: user.email, email_confirm: true });
  let authId = data?.user?.id;
  if (error) {
    // already registered: find it
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    authId = list?.users.find((u) => u.email?.toLowerCase() === user.email.toLowerCase())?.id;
    if (!authId) throw new HttpError(500, error.message);
  }
  await sb.from("app_users").update({ auth_user_id: authId }).eq("id", user.id);
  return authId!;
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const body = await req.json().catch(() => ({}));
  const sb = admin();

  if (body.action === "login") {
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const { count } = await sb.from("login_attempts").select("id", { count: "exact", head: true })
      .eq("ip", ip).eq("success", false).gte("created_at", since);
    if ((count ?? 0) >= MAX_FAILS) throw new HttpError(429, `Too many attempts. Try again in ${WINDOW_MIN} minutes.`);
    if (!validPin(body.pin)) throw new HttpError(400, "PIN must be 4–8 digits");

    // First-run bootstrap: no users yet -> default admin PIN creates the owner account
    const { count: userCount } = await sb.from("app_users").select("id", { count: "exact", head: true });
    if ((userCount ?? 0) === 0 && body.pin === DEFAULT_ADMIN_PIN) {
      const { data: u, error } = await sb.from("app_users")
        .insert({ name: ADMIN_NAME, email: ADMIN_EMAIL, role: "admin" }).select().single();
      if (error) throw new HttpError(500, error.message);
      await storePin(u.id, body.pin);
    }

    const lookup = await hmacHex(PEPPER, body.pin);
    const { data: sec } = await sb.from("app_user_secrets").select("user_id,pin_hash").eq("pin_lookup", lookup).maybeSingle();
    const { data: user } = sec
      ? await sb.from("app_users").select("*").eq("id", sec.user_id).maybeSingle()
      : { data: null };
    if (!sec || !user || !user.active || !(await verifyPin(body.pin, sec.pin_hash))) {
      await sb.from("login_attempts").insert({ ip, success: false });
      throw new HttpError(401, "Incorrect PIN");
    }
    await ensureAuthUser(user);
    const { data: link, error: linkErr } = await sb.auth.admin.generateLink({ type: "magiclink", email: user.email });
    if (linkErr) throw new HttpError(500, linkErr.message);
    await sb.from("login_attempts").insert({ ip, success: true, user_id: user.id });
    await sb.from("app_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
    await sb.from("audit_log").insert({ actor: user.name, action: "login", entity: "app_users", entity_id: user.id });
    return json({
      ok: true,
      token_hash: link.properties.hashed_token,
      email: user.email,
      user: { id: user.id, name: user.name, role: user.role, email: user.email },
      default_pin_in_use: body.pin === DEFAULT_ADMIN_PIN,
    });
  }

  if (body.action === "upsert_user") {
    const me = await requireStaff(req, ["admin", "manager"]);
    if (!body.name || !body.email) throw new HttpError(400, "name and email are required");
    if (!["admin", "manager", "tech", "sales", "viewer"].includes(body.role)) throw new HttpError(400, "bad role");
    if (body.role === "admin" && me.role !== "admin") throw new HttpError(403, "Only an admin can create admins");
    const row = { name: body.name, email: String(body.email).toLowerCase(), role: body.role, active: body.active !== false };
    const q = body.id ? sb.from("app_users").update(row).eq("id", body.id) : sb.from("app_users").insert(row);
    const { data: u, error } = await q.select().single();
    if (error) throw new HttpError(400, error.message);
    if (body.pin) {
      if (!validPin(body.pin)) throw new HttpError(400, "PIN must be 4–8 digits");
      await storePin(u.id, body.pin);
    }
    await sb.from("audit_log").insert({ actor: me.name, action: body.id ? "update_user" : "create_user", entity: "app_users", entity_id: u.id });
    return json({ ok: true, user: u });
  }

  if (body.action === "set_pin") {
    const me = await requireStaff(req);
    if (body.user_id !== me.id && !["admin", "manager"].includes(me.role)) throw new HttpError(403, "Not allowed");
    if (!validPin(body.pin)) throw new HttpError(400, "PIN must be 4–8 digits");
    if (body.pin === DEFAULT_ADMIN_PIN) throw new HttpError(400, "Choose a PIN other than the default");
    await storePin(body.user_id, body.pin);
    await sb.from("audit_log").insert({ actor: me.name, action: "set_pin", entity: "app_users", entity_id: body.user_id });
    return json({ ok: true });
  }

  throw new HttpError(400, "unknown action");
}));
