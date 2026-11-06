// UrFleet — DCA ingest
// Receives payloads from urfleet_dca.py (header x-dca-key), upserts devices,
// records meters/supplies, tracks service events, evaluates alert definitions,
// and returns remote config + queued commands for the agent.
import { admin, businessDaysUntil, handle, HttpError, json, sha256Hex } from "../_shared/util.ts";

type Supply = {
  name: string; type: string; color: string | null; level_pct: number | null; level_raw: number | null;
  max_capacity: number | null; some_remaining?: boolean; class?: string;
};
type DevIn = {
  ip: string; serial: string; serial_reported?: boolean; manufacturer?: string; model?: string; host_name?: string;
  location?: string; mac?: string; technology?: string; is_color?: boolean; status?: string; errors?: string[];
  meters: { total: number | null; mono: number | null; color: number | null; quality?: string };
  supplies: Supply[]; alerts: { code: number | null; description: string; severity: string }[];
  collected_at?: string;
};

const MARKER_TYPES = new Set(["toner", "ink"]);
const SERVICE_ERRORS: Record<string, string> = {
  jammed: "Paper jam", door_open: "Door/cover open", service_requested: "Service requested",
  offline: "Device offline", no_toner: "Toner empty", overdue_prevent_maint: "Preventive maintenance overdue",
  marker_supply_missing: "Supply missing", no_paper: "Out of paper",
};

function safeMatch(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + Math.round(days));
  return x;
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  const key = req.headers.get("x-dca-key");
  if (!key || key.length < 20) throw new HttpError(401, "missing DCA key");
  const sb = admin();
  const { data: dca } = await sb.from("dca_installs").select("*").eq("key_hash", await sha256Hex(key)).maybeSingle();
  if (!dca) throw new HttpError(401, "unknown DCA key");
  if (dca.status === "disabled") throw new HttpError(403, "DCA disabled");

  const body = await req.json();
  const devicesIn: DevIn[] = Array.isArray(body.devices) ? body.devices.slice(0, 1000) : [];
  const now = new Date();
  const nowIso = now.toISOString();

  // ---- DCA heartbeat --------------------------------------------------------
  await sb.from("dca_installs").update({
    last_reported: nowIso, version: body.agent?.version ?? null, host_name: body.agent?.host_name ?? dca.host_name,
    os: body.agent?.os ?? null, last_ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || null,
    last_device_count: devicesIn.length, status: "active",
  }).eq("id", dca.id);

  for (const r of body.command_results ?? []) {
    if (r?.id) {
      await sb.from("dca_commands").update({
        status: r.ok ? "done" : "failed", result: r, completed_at: nowIso,
      }).eq("id", r.id).eq("dca_id", dca.id);
    }
  }

  // ---- Load context in bulk --------------------------------------------------
  const serials = devicesIn.map((d) => String(d.serial).slice(0, 120));
  const [{ data: existing }, { data: defs }, { data: catalog }] = await Promise.all([
    sb.from("devices").select("*").eq("account_id", dca.account_id).in("serial", serials.length ? serials : ["-"]),
    sb.from("alert_definitions").select("*").eq("enabled", true),
    sb.from("part_catalog").select("*"),
  ]);
  const bySerial = new Map((existing ?? []).map((d) => [d.serial, d]));

  // Upsert devices
  const upserts = devicesIn.map((d) => {
    const prev = bySerial.get(String(d.serial));
    return {
      account_id: dca.account_id, dca_id: dca.id, serial: String(d.serial).slice(0, 120),
      manufacturer: prev?.manufacturer ?? d.manufacturer ?? null,
      model: prev?.model ?? d.model ?? null,
      ip: d.ip, mac: d.mac ?? prev?.mac ?? null, host_name: d.host_name ?? null,
      location: prev?.location ?? d.location ?? null,
      technology: d.technology && d.technology !== "Unknown" ? d.technology : (prev?.technology ?? "Unknown"),
      is_color: d.is_color ?? prev?.is_color ?? false,
      status_code: d.status ?? null, error_state: d.errors ?? [],
      first_audit: prev?.first_audit ?? nowIso, last_audit: nowIso,
      meter_total: d.meters?.total ?? prev?.meter_total ?? null,
      meter_mono: d.meters?.mono ?? prev?.meter_mono ?? null,
      meter_color: d.meters?.color ?? prev?.meter_color ?? null,
      is_managed: prev?.is_managed ?? false, is_blocked: prev?.is_blocked ?? false,
    };
  }).filter((u) => !(bySerial.get(u.serial)?.is_blocked)); // blocked devices are ignored
  const { data: saved, error: upErr } = upserts.length
    ? await sb.from("devices").upsert(upserts, { onConflict: "account_id,serial" }).select()
    : { data: [], error: null };
  if (upErr) throw new HttpError(500, upErr.message);
  const deviceBySerial = new Map((saved ?? []).map((d) => [d.serial, d]));
  const ids = (saved ?? []).map((d) => d.id);

  const [{ data: curSupplies }, { data: openAlerts }, { data: openEvents }] = await Promise.all([
    sb.from("device_supplies").select("*").in("device_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    sb.from("alerts").select("*").in("device_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).neq("status", "closed"),
    sb.from("service_events").select("*").in("device_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).neq("status", "closed"),
  ]);

  const meterRows: Record<string, unknown>[] = [];
  const supplyReadRows: Record<string, unknown>[] = [];
  const supplyUpserts: Record<string, unknown>[] = [];
  const alertInserts: Record<string, unknown>[] = [];
  const alertUpdates: { id: string; patch: Record<string, unknown> }[] = [];
  const eventInserts: Record<string, unknown>[] = [];
  const eventUpdates: { id: string; patch: Record<string, unknown> }[] = [];
  const notes: Record<string, unknown>[] = [];

  for (const din of devicesIn) {
    const dev = deviceBySerial.get(String(din.serial).slice(0, 120));
    if (!dev) continue;
    const prev = bySerial.get(dev.serial);
    if (!prev) notes.push({ entity_type: "device", entity_id: dev.id, body: `Discovered by DCA "${dca.name}" at ${din.ip}`, auto: true, author: "DCA" });
    const readAt = din.collected_at ?? nowIso;

    // Meters (reject decreases => Audits tab for review)
    if (din.meters?.total != null) {
      const decreased = prev?.meter_total != null && din.meters.total < prev.meter_total;
      meterRows.push({
        device_id: dev.id, read_at: readAt, total: din.meters.total, mono: din.meters.mono, color: din.meters.color,
        source: "dca", accepted: !decreased, raw: { quality: din.meters.quality, flag: decreased ? "meter_decrease" : null },
      });
      if (decreased) {
        notes.push({ entity_type: "device", entity_id: dev.id, auto: true, author: "DCA",
          body: `Meter decreased (${prev.meter_total} → ${din.meters.total}). Read held for review in Audits.` });
      }
    }

    // Supplies
    supplyReadRows.push({ device_id: dev.id, read_at: readAt, supplies: din.supplies });
    const mine = (curSupplies ?? []).filter((s) => s.device_id === dev.id);
    const devAlerts = (openAlerts ?? []).filter((a) => a.device_id === dev.id);
    const evaluated: { supply: Supply; est: Date | null; replaced: boolean }[] = [];
    for (const s of din.supplies ?? []) {
      const old = mine.find((m) => m.name === s.name);
      let refLevel = old?.ref_level ?? s.level_pct;
      let refAt = old?.ref_at ?? readAt;
      let refMeter = old?.ref_meter ?? din.meters?.total ?? null;
      let installedAt = old?.installed_at ?? null;
      let replaced = false;
      if (old?.level_pct != null && s.level_pct != null && s.level_pct - Number(old.level_pct) >= 30) {
        replaced = true; refLevel = s.level_pct; refAt = readAt; refMeter = din.meters?.total ?? null; installedAt = readAt;
        notes.push({ entity_type: "device", entity_id: dev.id, auto: true, author: "DCA",
          body: `${s.name} replaced (${old.level_pct}% → ${s.level_pct}%)` });
      }
      // Part # / yield from catalogue
      const cat = (catalog ?? []).find((c) =>
        (dev.model ?? "").toLowerCase().includes(String(c.model_match).toLowerCase()) &&
        s.name.toLowerCase().includes(String(c.supply_match).toLowerCase()));
      const yieldPages = old?.yield_pages ?? cat?.yield_pages ?? null;
      // Estimated empty date: observed depletion slope, falling back to AMV × yield
      let est: Date | null = null;
      if (s.level_pct != null) {
        const days = (new Date(readAt).getTime() - new Date(refAt).getTime()) / 86_400_000;
        const drop = Number(refLevel ?? s.level_pct) - s.level_pct;
        if (days >= 2 && drop > 0) {
          est = addDays(new Date(readAt), s.level_pct / (drop / days));
        } else if (yieldPages) {
          const amv = s.color && s.color !== "black" ? dev.amv_color : (s.type === "drum" ? dev.amv_total : (dev.amv_mono ?? dev.amv_total));
          if (amv && amv > 0) est = addDays(new Date(readAt), (yieldPages * s.level_pct / 100) / (amv / 30.4));
        }
        if (s.level_pct <= 0) est = new Date(readAt);
      }
      evaluated.push({ supply: s, est, replaced });
      supplyUpserts.push({
        device_id: dev.id, name: s.name, supply_type: s.type, color: s.color, level_pct: s.level_pct,
        level_raw: s.level_raw, max_capacity: s.max_capacity, part_no: old?.part_no ?? cat?.part_no ?? null,
        yield_pages: yieldPages, usage_pages: refMeter != null && din.meters?.total != null ? din.meters.total - refMeter : null,
        est_empty_date: est ? est.toISOString().slice(0, 10) : null, installed_at: installedAt,
        ref_level: refLevel, ref_at: refAt, ref_meter: refMeter,
        first_reported: old?.first_reported ?? readAt, last_reported: readAt,
      });
    }

    // Service events from device alert table + error state
    const conditions = new Map<string, { code: string; description: string; severity: string }>();
    for (const a of din.alerts ?? []) {
      if (!a.description || /toner.*low|low.*toner|ink.*low|near end/i.test(a.description)) continue; // handled by supply alerts
      const code = String(a.code ?? "alert");
      conditions.set(`${code}|${a.description}`, { code, description: a.description, severity: a.severity === "critical" ? "critical" : "warning" });
    }
    for (const e of din.errors ?? []) {
      if (SERVICE_ERRORS[e]) conditions.set(`err:${e}|${SERVICE_ERRORS[e]}`, { code: `err:${e}`, description: SERVICE_ERRORS[e], severity: ["jammed", "service_requested", "no_toner"].includes(e) ? "critical" : "warning" });
    }
    const devEvents = (openEvents ?? []).filter((e) => e.device_id === dev.id);
    for (const [k, c] of conditions) {
      const ex = devEvents.find((e) => `${e.code}|${e.description}` === k);
      if (ex) eventUpdates.push({ id: ex.id, patch: { last_received: nowIso, report_count: ex.report_count + 1 } });
      else eventInserts.push({ device_id: dev.id, code: c.code, description: c.description, severity: c.severity, ticket_no: `ST-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 99)}` });
    }
    for (const e of devEvents) {
      if (!conditions.has(`${e.code}|${e.description}`) && e.status === "open") {
        eventUpdates.push({ id: e.id, patch: { status: "closed", closed_at: nowIso, resolution: "Cleared by device" } });
      }
    }

    // Alert definitions
    const want = new Map<string, Record<string, unknown>>(); // key kind|supply
    for (const def of defs ?? []) {
      if (def.account_id && def.account_id !== dev.account_id) continue;
      if (def.managed_only && !dev.is_managed) continue;
      if (def.kind === "supply_level" || def.kind === "supply_days") {
        for (const { supply: s, est } of evaluated) {
          const isMarker = MARKER_TYPES.has(s.type);
          const matches = def.supply_match ? safeMatch(def.supply_match, s.name) : isMarker;
          if (!matches || s.level_pct == null) continue;
          const bdays = est ? businessDaysUntil(est, now) : null;
          const hit = def.kind === "supply_level" ? s.level_pct <= Number(def.threshold)
            : (bdays != null && bdays <= Number(def.threshold));
          if (!hit) continue;
          const sev = s.level_pct <= 0 ? "critical" : def.severity;
          const k = `${def.kind}|${s.name}`;
          want.set(k, {
            definition_id: def.id, account_id: dev.account_id, device_id: dev.id, kind: def.kind, severity: sev,
            supply_name: s.name, level_pct: s.level_pct, est_empty_date: est?.toISOString().slice(0, 10) ?? null,
            message: def.kind === "supply_level"
              ? `${s.name} at ${s.level_pct}% (threshold ${def.threshold}%)`
              : `${s.name} est. empty ${est?.toISOString().slice(0, 10)} (${bdays} business days)`,
          });
        }
      }
      if (def.kind === "service") {
        for (const [, c] of conditions) {
          want.set(`service|${c.description}`, {
            definition_id: def.id, account_id: dev.account_id, device_id: dev.id, kind: "service",
            severity: c.severity, supply_name: c.description, message: `${c.description} (code ${c.code})`,
          });
        }
      }
    }
    for (const [k, a] of want) {
      const ex = devAlerts.find((x) => `${x.kind}|${x.supply_name ?? ""}` === k);
      if (ex) alertUpdates.push({ id: ex.id, patch: { last_detected: nowIso, level_pct: a.level_pct ?? null, est_empty_date: a.est_empty_date ?? null, severity: a.severity, message: a.message } });
      else alertInserts.push(a);
    }
    for (const ex of devAlerts) {
      if (["supply_level", "supply_days", "service", "no_data"].includes(ex.kind) && !want.has(`${ex.kind}|${ex.supply_name ?? ""}`)) {
        const replaced = evaluated.find((e) => e.supply.name === ex.supply_name)?.replaced;
        alertUpdates.push({ id: ex.id, patch: { status: "closed", closed_at: nowIso,
          closed_reason: ex.kind === "no_data" ? "Device reporting again" : replaced ? "Supply replaced" : "Condition cleared" } });
      }
    }
  }

  // ---- Bulk writes -----------------------------------------------------------
  const writes: PromiseLike<unknown>[] = [];
  if (meterRows.length) writes.push(sb.from("meter_reads").insert(meterRows));
  if (supplyReadRows.length) writes.push(sb.from("supply_reads").insert(supplyReadRows));
  if (supplyUpserts.length) writes.push(sb.from("device_supplies").upsert(supplyUpserts, { onConflict: "device_id,name" }));
  if (alertInserts.length) writes.push(sb.from("alerts").insert(alertInserts));
  if (eventInserts.length) writes.push(sb.from("service_events").insert(eventInserts));
  if (notes.length) writes.push(sb.from("notes").insert(notes));
  for (const u of alertUpdates) writes.push(sb.from("alerts").update(u.patch).eq("id", u.id));
  for (const u of eventUpdates) writes.push(sb.from("service_events").update(u.patch).eq("id", u.id));
  const results = await Promise.all(writes) as { error?: { message: string } }[];
  const errs = results.map((r) => r?.error?.message).filter(Boolean);
  if (ids.length) await sb.rpc("recalc_amv_for", { p_devices: ids });

  // ---- Remote config + commands back to the agent ---------------------------
  const { data: cmds } = await sb.from("dca_commands").select("id,command,args").eq("dca_id", dca.id).eq("status", "queued");
  if (cmds?.length) await sb.from("dca_commands").update({ status: "sent" }).in("id", cmds.map((c) => c.id));

  return json({
    ok: errs.length === 0,
    errors: errs,
    devices: ids.length,
    alerts_opened: alertInserts.length,
    config: { ...(dca.config ?? {}), config_version: dca.config_version },
    commands: cmds ?? [],
  });
}));
