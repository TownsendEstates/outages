// Builds the single-file app: public/index.html
// Optional env (Netlify build): SUPABASE_URL, SUPABASE_ANON_KEY -> cloud mode. Without them the app runs in demo mode.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { CATALOG } from "./netlify/lib/catalog.mjs";

const dir = new URL("./src/", import.meta.url);
const parts = readdirSync(dir).filter((f) => /^\d\d-/.test(f)).sort();
const config = {
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  api: process.env.API_BASE || "/.netlify/functions",
};
// Connector catalog is shared with the gateway so the UI and server never drift.
const catalog = CATALOG.map(({ fields, ...c }) => ({ ...c, fields: fields.map(({ k, label, secret }) => ({ k, label, secret: !!secret })) }));
let out = "";
for (const f of parts) {
  out += readFileSync(new URL(f, dir), "utf8");
  if (f.startsWith("01-")) out += `window.SHOPSTACK_CONFIG = ${JSON.stringify(config)};\nconst CONNECTORS = ${JSON.stringify(catalog)};\n`;
  out += "\n";
}
mkdirSync(new URL("./public/", import.meta.url), { recursive: true });
writeFileSync(new URL("./public/index.html", import.meta.url), out);
console.log(`public/index.html built (${(out.length / 1024).toFixed(0)} KB, ${parts.length} parts, ${catalog.length} connectors, ${config.supabaseUrl ? "cloud" : "demo"} mode)`);
