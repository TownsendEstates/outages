// Shared helpers for UrFleet edge functions
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dca-key, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: CORS }) : null;
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Staff = { id: string; name: string; email: string; role: string };

/** Validates the caller's Supabase JWT and returns the active staff record. */
export async function requireStaff(req: Request, roles?: string[]): Promise<Staff> {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Not signed in");
  const sb = admin();
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user) throw new HttpError(401, "Session expired — sign in again");
  const { data: staff } = await sb.from("app_users").select("id,name,email,role,active")
    .eq("auth_user_id", data.user.id).maybeSingle();
  if (!staff || !staff.active) throw new HttpError(403, "Not an active UrFleet user");
  if (roles && !roles.includes(staff.role)) throw new HttpError(403, "Insufficient permission");
  return staff as Staff;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const pf = preflight(req);
    if (pf) return pf;
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
      console.error(e);
      return json({ ok: false, error: (e as Error).message ?? String(e) }, 500);
    }
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function logSync(sb: SupabaseClient, provider: string, action: string, ok: boolean,
  message: string, entity?: string, entity_id?: string) {
  await sb.from("sync_log").insert({ provider, action, ok, message: message.slice(0, 1000), entity, entity_id });
}

/** Mon–Fri business days from today until `date` (Alberta stat holidays not excluded). */
export function businessDaysUntil(date: Date, from = new Date()): number {
  const a = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const b = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (b <= a) return 0;
  let n = 0;
  for (const d = new Date(a); d < b; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
