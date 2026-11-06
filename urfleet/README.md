# UrFleet Fleet Manager

**A Printanista replacement for UrFleet / Inks N Stuff IT** (2668981 Alberta Incorporated) — owner: Scott Townsend.

Monitors client printer fleets through UrFleet's own Data Collection Agent (DCA), raises supply and service
alerts, bills meters by contract, and pushes invoices to **Xero** or **QuickBooks Online** and fleet status
to **HubSpot**.

| Piece | Where | What it is |
|---|---|---|
| Web app | `app/index.html` | Single-file internal tool. Runs instantly in **Demo** mode; switches to **Live** (Supabase) from Settings. |
| DCA | `dca/urfleet_dca.py` | Zero-dependency Python SNMP agent → single Windows `.exe` (built by GitHub Actions) or Linux/Pi service. |
| Database | `supabase/migrations/` | Postgres schema, Row Level Security, alert sweeps, AMV and monthly-volume views. |
| Server functions | `supabase/functions/` | `dca-ingest`, `pin-login`, `accounting` (Xero + QBO), `hubspot-sync`, `fleet-jobs` (hourly). |
| Hosting | `netlify.toml` | Netlify, with security headers. |

---

## Try it now (2 minutes, no setup)

Open `app/index.html` in a browser → PIN **107451** → you are in demo mode with 13 fictional Edmonton
accounts, 57 devices and 13 months of meter history. Things to click:

1. **Dashboard → ▶ Simulate DCA check-ins** — meters advance, toner depletes, alerts open/close.
2. **Meter Billing → + New billing run → Build preview → Approve → ⬇ Xero CSV / ⬇ QBO CSV**.
3. **Accounts → any account → Installs (DCA) → + Add DCA** — generates a DCA key and the exact install command.
4. **Reports → Per-Asset P&L** and **Supply Forecast / Order List**.

Demo data lives only in that browser (localStorage). Administration → Data & audit → *Reset demo data* restores it.

---

## Printanista feature parity

| Printanista | UrFleet | Notes |
|---|---|---|
| Dashboard: status icons, DCAs with no data in 3 days + Notify, manufacturers, technologies | ✅ | Plus 12-month volume chart, est. monthly revenue, 10-business-day supply list |
| Account: info, parent/sub-accounts, Installs, Audits (accept/reject), Contacts, Notes, RDL flag | ✅ | Account context switcher in the top bar |
| Devices: templates, column chooser, filters, flag/star/block icons, bulk Managed/Non-managed/Edit/Delete/Unblock/Reset supply usage, import/export | ✅ | Templates include *Urgent Supplies – Managed*, *Service View – Managed*, *Not reporting*, *Managed – no contract* |
| Device detail: Meters current/historical + export, Supplies current with part #/yield/coverage/usage/est. empty, Service tickets, Notes | ✅ | Plus meter chart, manual meter entry, per-device P&L |
| Alerts: open/closed, detected in last N days, export, print | ✅ | Plus acknowledge, one-click supply order, HubSpot ticket |
| Alert definitions | ✅ | Supply %, **days-to-empty in business days**, service condition, device silent, DCA offline; email + HubSpot ticket |
| Reports: Meter, Single Day, Audit Comparison, Account Device Summary Billing, Accounts, Fleet Composition, DCA Versions, Reporting Status, Device Age, Utilization, Alert History, Green, Top N, Supply Levels, Duplicate Devices | ✅ | Plus Supply Forecast pick list, Supply Orders, **Per-Asset P&L**, Accounting/CRM mapping |
| Users & permission levels | ✅ | admin / manager / tech / sales / viewer, PIN sign-in |
| Supply orders, OEM part # compatibility | ✅ | Part catalogue with landed cost (TD Synnex / Ingram) → feeds P&L |
| ERP processing (e-automate, ESN) | ➡️ replaced | Direct **Xero** and **QuickBooks Online** invoicing + CSV import files; HubSpot CRM |
| **RDL** (secure tunnel to printer web page) | ⚠️ partial | Opens the device page when you are on the client LAN/VPN. A true remote tunnel needs a relay service — see Roadmap |
| Scheduled report emails | ⚠️ partial | Schedules are saved; alert emails send via `fleet-jobs` + Resend. Emailed report attachments — Roadmap |
| Account branding / customer portal | ➡️ Roadmap | Planned customer portal (tickets into HubSpot) builds on this schema |

---

## Architecture

```
 Client site (LAN)                              UrFleet cloud (Supabase, Canada region recommended)
 ┌──────────────────────────┐   HTTPS 443 only  ┌────────────────────────────────────────────────┐
 │ urfleet-dca (.exe/Pi)    │ ───────────────▶ │ dca-ingest ─▶ devices, meter_reads, supplies,  │
 │  SNMP v1/v2c → printers  │ ◀─ config+cmds ── │               service_events, alerts           │
 │  offline spool on disk   │                   │ fleet-jobs (hourly) ─▶ DCA offline, silent      │
 └──────────────────────────┘                   │   devices, HubSpot tickets, alert emails        │
                                                │ Postgres + RLS (staff only)                     │
 Staff browser (Netlify)                        │ accounting ─▶ Xero / QuickBooks (OAuth2)        │
 app/index.html ── PIN ─▶ pin-login ──session──▶│ hubspot-sync ─▶ HubSpot (private app token)     │
                                                └────────────────────────────────────────────────┘
```

* **No inbound firewall rules at client sites.** The DCA calls out; config changes and commands
  (rescan, collect now, ping) ride back on the response.
* **Billing engine** (in the app): for each active contract, start meter = last accepted read on/before the
  period start, end meter = last accepted read on/before period end. Allowances are pooled per contract; overage
  billed at CPP; base fee; minimum charge. Missing reads are estimated from AMV and **flagged** (estimated,
  meter decreased, started mid-period, stale end read, no colour split) so nothing goes out unreviewed.
  Approved runs export as Xero/QBO import CSVs or post **draft** invoices via API.
* **Est. Empty Date**: observed depletion slope since the cartridge was installed (replacement auto-detected when
  level jumps ≥ 30 points), falling back to part-catalogue yield × AMV.

---

## Go live (one-time setup, ~1 hour)

### 1. Supabase project
1. Create a project — choose the **Canada (Central)** region (see Compliance).
2. Apply the schema: SQL Editor → paste `supabase/migrations/20261106000000_urfleet_schema.sql` → Run
   (or `supabase db push`). It is safe to re-run.
3. Deploy the functions (Supabase CLI, from this `urfleet/` folder):
   ```bash
   supabase link --project-ref <project-ref>
   ```
   ```bash
   supabase functions deploy pin-login dca-ingest accounting hubspot-sync fleet-jobs
   ```
   `supabase/config.toml` turns off the gateway JWT check for these functions; each one authenticates
   callers itself (PIN, DCA key, staff session, or cron secret).
4. Set function secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set NAME=value`):

| Secret | Required | Purpose |
|---|---|---|
| `PIN_PEPPER` | **yes** | 32+ random characters. Mixed into every PIN hash. Never change after users exist. |
| `APP_URL` | yes | Your Netlify URL, e.g. `https://fleet.urfleet.ca` (OAuth returns here) |
| `APP_ORIGIN` | recommended | Same as `APP_URL` — restricts browser CORS to your app |
| `ADMIN_EMAIL` / `ADMIN_NAME` | optional | Owner account created on first login (default name: Scott Townsend) |
| `DEFAULT_ADMIN_PIN` | optional | First-login PIN (default `107451`) |
| `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` | for Xero | From developer.xero.com app |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` / `QBO_ENV` | for QBO | From developer.intuit.com; `QBO_ENV=sandbox` while testing |
| `HUBSPOT_TOKEN` | for HubSpot | Private app token |
| `CRON_SECRET` | for jobs | Random string; protects `fleet-jobs` |
| `RESEND_API_KEY` / `ALERT_FROM` | optional | Alert emails (`ALERT_FROM` must be a verified sender domain) |

5. Schedule the hourly jobs (SQL Editor; enable the `pg_cron` and `pg_net` extensions first):
   ```sql
   select vault.create_secret('<same value as CRON_SECRET>', 'urfleet_cron_secret');
   select cron.schedule('urfleet-fleet-jobs', '7 * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/fleet-jobs',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
         (select decrypted_secret from vault.decrypted_secrets where name = 'urfleet_cron_secret')),
       body := '{}'::jsonb);
   $$);
   ```

### 2. Web app on Netlify
New site from this repo → **Base directory `urfleet`** (publish `app` comes from `netlify.toml`). Assign
the UrFleet domain. Open the site → *Connection settings* → **Live**, paste the project URL and the **anon**
key (never the service-role key) → sign in with `107451` → **immediately change the PIN** (click your name).

> **Do the first login yourself right after deploying.** Until an owner account exists, whoever enters the
> default PIN first becomes admin. Setting a private `DEFAULT_ADMIN_PIN` secret closes that window.

### 3. Xero
developer.xero.com → New app (Web app) → redirect URI
`https://<project-ref>.supabase.co/functions/v1/accounting/callback/xero` → put the client ID/secret in secrets →
in the app: Administration → Integrations → **Connect to Xero** → **Load tax rates, accounts & items** → pick the
GST tax rate and revenue account codes → Save. Scopes requested: `accounting.invoices accounting.contacts
accounting.settings.read offline_access` (Xero's granular scopes; apps created after 2 March 2026 cannot use the
old `accounting.transactions`). Override with `XERO_SCOPES` if Xero changes them again.

### 4. QuickBooks Online
developer.intuit.com → app → redirect URI `https://<project-ref>.supabase.co/functions/v1/accounting/callback/qbo`
→ secrets → Connect → **Load tax codes & items** → map the GST tax code and the Mono / Colour / Base fee
products. Canadian QBO rejects invoice lines without a tax code, so export is blocked until it's mapped.
Intuit requires a short app assessment before issuing production keys — use `QBO_ENV=sandbox` until then.

### 5. HubSpot
Settings → Integrations → Private apps → create "UrFleet" with scopes: `crm.objects.companies.read/write`,
`crm.schemas.companies.write`, `tickets`, `crm.objects.contacts.read` → copy token to `HUBSPOT_TOKEN` →
HubSpot CRM page → **Test connection** → **Import customers** (links existing companies) → **Push all accounts**.
Creates a "UrFleet Managed Print" property group on companies (devices, managed devices, AMV, open alerts,
last reported, tier, est. MRR).

### 6. DCAs at client sites
Account → Installs (DCA) → **+ Add DCA** → copy the key (shown once) and the generated command.

* **Windows**: Actions tab → *UrFleet DCA — test & build* → download artifact `urfleet-dca-windows`
  (`urfleet-dca.exe` + `install-windows.ps1`) → run the generated command in an elevated PowerShell. Installs a
  SYSTEM scheduled task that starts at boot and restarts on failure; config is ACL-locked.
  Code-sign the .exe before wide rollout to avoid SmartScreen/AV warnings.
* **Linux / Raspberry Pi**: `sudo ./install/install-linux.sh --endpoint … --key … --range 192.168.1.0/24`
* **Check**: `urfleet-dca.exe once -v` or `python3 urfleet_dca.py probe --ip <printer-ip>`

DCA commands: `run`, `once`, `scan --range`, `probe --ip`, `walk --ip --oid` (diagnostics), `dry-run`, `init`.
Tests (SNMP simulator, no hardware needed): `cd dca && python -m unittest discover -s tests -v`.

### 7. Cut over from Printanista
1. Run the UrFleet DCA **alongside** Printanista for one full billing cycle at a few sites.
2. Export devices and meter history from Printanista → Administration → Data & audit → **Import devices** /
   **Import meter history** (Printanista column names are recognised).
3. Compare one month's UrFleet billing run against Printanista's meter report; investigate any device with a
   ±2% difference (usually a vendor counter — see below).
4. Move the remaining sites, then cancel Printanista.

---

## Important things to verify

* **Mono/colour split by vendor.** Totals come from the standard Printer-MIB life counter, which every networked
  printer supports. Mono/colour splits use vendor-specific counters (`COUNTER_PROFILES` in the DCA) that are only
  trusted when they reconcile with the total; otherwise the device is billed on total and flagged *no colour
  split*. **Validate Xerox first** (137 of your devices): run `urfleet_dca.py probe --ip <xerox>` and compare with
  the device's web page billing counters. Profiles can be corrected per site from DCA → Configure without
  reinstalling.
* **SNMPv3** is not supported in this version (v1/v2c only). Most fleet devices ship with v2c; use a
  non-default read-only community where clients allow it.
* **Part numbers in demo data are illustrative.** Load your real catalogue (CSV import) from TD Synnex /
  Ingram pricing.
* **Xero CSV date format** follows your Xero organisation's region — set it under Integrations → Billing export
  settings before the first import.

## Compliance (Alberta / Canada)

* **PIPA (Alberta) / PIPEDA**: the DCA collects device telemetry only — no document content, file names or
  end-user identities. The database holds client business contacts (names, emails, phones), which is personal
  information: host in **Supabase Canada (Central)**, keep access to staff via RLS (built in), and include the
  monitoring in your MPS agreement (purpose: supply fulfilment, service and billing). Honour access/correction
  requests; Administration → Data & audit has a full JSON export.
* **GST**: Alberta is 5% GST, no PST. Invoices post GST-exclusive; your GST number must appear on invoices
  (CRA requirement over $30) — set it on your Xero/QBO invoice template.
* **Late-payment interest**: if contracts charge interest on overdue invoices, keep the rate well under the
  Criminal Code s.347 cap (35% APR since 1 January 2025) and state it as an annual rate in the agreement.
* **Alberta Consumer Protection Act** applies only to consumer (non-business) customers; MPS agreements here are
  B2B, but keep auto-renewal and cancellation terms explicit in the contract.
* **Email**: alert emails to clients are transactional; CASL consent is not needed for them, but any marketing sent
  from HubSpot still requires it.

## Roadmap (not in this build)

1. **RDL relay** — WebSocket tunnel through the DCA so techs can open a printer's web page from anywhere.
2. **SNMPv3** (authPriv) in the DCA.
3. **Customer portal** — clients see their fleet, request supplies/service; requests become HubSpot tickets.
4. **Report emailing** — scheduled CSV/PDF reports from `fleet-jobs`.
5. **Auto supply ordering** to TD Synnex / Ingram APIs and GetToner.ca stock.
6. DCA auto-update channel and code-signed MSI installer.
