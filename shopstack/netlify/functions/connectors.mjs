// ShopStack connector gateway: one API for every vendor, distributor and data provider.
// Credentials are sealed server-side (connector_secrets) and never returned to the browser.
import { handle, authorize, admin, seal, unseal } from "../lib/core.mjs";
import { CATALOG, byId } from "../lib/catalog.mjs";

const TIMEOUT = 12000;
const fetchJson = async (url, opts = {}) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
};

// ---------------------------------------------------------------- live adapters
async function vinDecode(vin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin || "")) throw { status: 400, message: "VIN must be 17 characters (no I, O or Q)" };
  const d = await fetchJson(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`);
  const r = d.Results?.[0] || {};
  return {
    vin: vin.toUpperCase(),
    year: r.ModelYear, make: r.Make, model: r.Model, trim: r.Trim, body: r.BodyClass,
    engine: [r.DisplacementL && `${Number(r.DisplacementL).toFixed(1)}L`, r.EngineCylinders && `${r.EngineCylinders}cyl`, r.FuelTypePrimary].filter(Boolean).join(" "),
    drive: r.DriveType, plant: r.PlantCountry, error: r.ErrorCode !== "0" ? r.ErrorText : null,
  };
}

async function recalls({ make, model, year }, creds) {
  if (!make || !model || !year) throw { status: 400, message: "make, model and year required" };
  const url = `https://data.tc.gc.ca/v1.3/api/eng/vehicle-recall-database/recall/make-name/${encodeURIComponent(make)}/model-name/${encodeURIComponent(model)}/year-range/${year}-${year}?format=json`;
  const headers = creds?.apiKey ? { "user-key": creds.apiKey } : {};
  const d = await fetchJson(url, { headers });
  const rows = d.ResultSet || [];
  return rows.map((row) => Object.fromEntries(row.map((c) => [c.Name, c.Value?.Literal ?? c.Value])));
}

// ------------------------------------------------- partner REST adapter (configurable)
const pick = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

function partnerAdapter(conn, creds) {
  const base = (creds.baseUrl || "").replace(/\/$/, "");
  if (!base) throw { status: 400, message: `${conn.name}: API base URL not configured` };
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (creds.authHeader) headers[creds.authHeader] = creds.apiKey;
  else headers.Authorization = `Bearer ${creds.apiKey}`;
  if (creds.account) headers["X-Account"] = creds.account;
  let map = { sku: "sku", description: "description", brand: "brand", size: "size", cost: "price", qty: "quantity", eta: "eta", warehouse: "warehouse" };
  try { if (creds.map) map = { ...map, ...JSON.parse(creds.map) }; } catch { /* keep defaults */ }
  return {
    async search({ q = "", size = "" }) {
      const path = (creds.searchPath || "/products?q={q}&size={size}").replace("{q}", encodeURIComponent(q)).replace("{size}", encodeURIComponent(size));
      const d = await fetchJson(base + path, { headers });
      const items = Array.isArray(d) ? d : d.items || d.results || d.data || [];
      return items.map((it) => ({
        sku: pick(it, map.sku), description: pick(it, map.description), brand: pick(it, map.brand), size: pick(it, map.size),
        cost: Number(pick(it, map.cost)) || 0, qty: Number(pick(it, map.qty)) || 0, eta: pick(it, map.eta) || "", warehouse: pick(it, map.warehouse) || "",
      }));
    },
    async order({ lines, po }) {
      const r = await fetch(base + (creds.orderPath || "/orders"), {
        method: "POST", headers,
        body: JSON.stringify({ account: creds.account, reference: po, lines: lines.map((l) => ({ sku: l.sku, quantity: l.qty })) }),
      });
      if (!r.ok) throw { status: 502, message: `${conn.name} rejected the order: ${r.status}` };
      return await r.json();
    },
  };
}

// ---------------------------------------------- demo quotes when no credentials yet
function demoQuotes(conn, { q = "", size = "" }) {
  const seed = [...(conn.id + size + q)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const brands = ["Michelin", "Bridgestone", "Goodyear", "Toyo", "Nokian", "Continental", "Hankook", "Yokohama"];
  const models = { Michelin: "X-Ice Snow", Bridgestone: "Blizzak WS90", Goodyear: "WinterCommand Ultra", Toyo: "Observe GSi-6", Nokian: "Hakkapeliitta R5", Continental: "VikingContact 7", Hankook: "Winter i*cept iZ3", Yokohama: "iceGUARD iG53" };
  return Array.from({ length: 3 }, (_, i) => {
    const b = brands[(seed + i * 3) % brands.length];
    const cost = 95 + ((seed * (i + 7)) % 160);
    return {
      sku: `${conn.id.slice(0, 3).toUpperCase()}-${(seed * (i + 1)) % 99999}`,
      description: `${b} ${models[b]} ${size || q}`.trim(), brand: b, size: size || "",
      cost, qty: (seed + i * 11) % 40, eta: i === 0 ? "Same day" : i === 1 ? "Next day" : "2-3 days",
      warehouse: ["Edmonton", "Calgary", "Saskatoon", "Winnipeg"][(seed + i) % 4], demo: true,
    };
  });
}

// ---------------------------------------------------------------------- secrets
async function loadCreds(sb, tenantId, connectorId) {
  if (!sb) return null;
  const { data } = await sb.from("connector_secrets").select("secret").eq("tenant_id", tenantId).eq("connector", connectorId).maybeSingle();
  return data ? unseal(data.secret) : null;
}

// ---------------------------------------------------------------------- handler
export const handler = handle(async (body, event) => {
  const { action, tenantId, connector } = body;
  if (action === "catalog") return { catalog: CATALOG.map(({ fields, ...c }) => ({ ...c, fields: fields.map(({ k, label, secret }) => ({ k, label, secret: !!secret })) })) };

  const auth = await authorize(event, tenantId);
  const sb = auth.demo ? null : admin();
  const conn = connector ? byId[connector] : null;
  if (connector && !conn) throw { status: 400, message: `Unknown connector ${connector}` };

  switch (action) {
    case "save_credentials": {
      if (!["owner", "manager"].includes(auth.role)) throw { status: 403, message: "Owner or manager only" };
      if (!sb) return { ok: true, demo: true };
      await sb.from("connector_secrets").upsert({ tenant_id: tenantId, connector, secret: seal(body.creds || {}), updated_at: new Date().toISOString() });
      return { ok: true };
    }
    case "vin_decode":
      return await vinDecode(body.vin);
    case "recalls":
      return { recalls: await recalls(body, await loadCreds(sb, tenantId, "tc_recalls")) };
    case "search": {
      const ids = (body.connectors || []).filter((id) => byId[id]?.caps.includes("catalog_search"));
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const c = byId[id];
          const creds = await loadCreds(sb, tenantId, id);
          const items = creds ? await partnerAdapter(c, creds).search(body) : demoQuotes(c, body);
          return items.map((it) => ({ ...it, connector: id, vendor: c.name }));
        })
      );
      const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      const errors = results.map((r, i) => (r.status === "rejected" ? { connector: ids[i], error: r.reason?.message || String(r.reason) } : null)).filter(Boolean);
      items.sort((a, b) => a.cost - b.cost);
      return { items, errors };
    }
    case "order": {
      const creds = await loadCreds(sb, tenantId, connector);
      if (!creds) return { ok: true, demo: true, confirmation: `DEMO-${Date.now().toString(36).toUpperCase()}` };
      return { ok: true, result: await partnerAdapter(conn, creds).order(body) };
    }
    case "message": {
      // CASL consent is enforced in the app before calling this; the gateway just delivers.
      const { channel, to, body: text, subject } = body;
      if (!to || !text) throw { status: 400, message: "to and body required" };
      if (channel === "Email") {
        const creds = await loadCreds(sb, tenantId, "sendgrid");
        if (!creds) return { ok: true, demo: true };
        const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: creds.from }, subject: subject || "A message from your shop", content: [{ type: "text/plain", value: text }] }),
        });
        if (!r.ok) throw { status: 502, message: `SendGrid ${r.status}` };
        return { ok: true };
      }
      const creds = await loadCreds(sb, tenantId, "twilio");
      if (!creds) return { ok: true, demo: true };
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${creds.sid}:${creds.apiKey}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: creds.from, Body: text }),
      });
      if (!r.ok) throw { status: 502, message: `Twilio ${r.status}` };
      return { ok: true };
    }
    case "test": {
      if (conn.id === "nhtsa_vpic") return { ok: !!(await vinDecode("1FTFW1E50NFA00001")).make };
      const creds = await loadCreds(sb, tenantId, connector);
      if (!creds) return { ok: false, message: "No credentials saved" };
      if (conn.caps.includes("catalog_search") && creds.baseUrl) await partnerAdapter(conn, creds).search({ q: "test" });
      return { ok: true };
    }
    default:
      throw { status: 400, message: `Unknown action ${action}` };
  }
});
