# ShopStack: cloud shop management SaaS for tire & auto businesses

Built for Scott Townsend as a multi-tenant, white-label alternative to COSTAR (costarsoftware.ca). See **[docs/COSTAR-RESEARCH.md](docs/COSTAR-RESEARCH.md)** for the competitive research, gap analysis, pricing and Canadian compliance notes.

> "ShopStack" is a working name with neutral default branding (each tenant sets its own logo and colours). Choose the final name and brand, and run a CIPO trademark search, before marketing spend.

## What's included

| Area | Highlights |
|---|---|
| **Multi-tenant SaaS** | Tenants isolated by Postgres row-level security; plans (Starter / Pro / Enterprise / Distribution) gate modules, users, AI actions and integrations; Stripe subscription billing; platform admin console (MRR, plans, suspend, enter tenant); banner/franchise `parent_id` |
| **Customization** | Per-tenant branding (logo, colours, theme, document footer), custom fields on any record type, editable workflows (WO statuses, deal stages, inspection checklists, bays), labour rates, fleet/wholesale pricing tiers, tax overrides, numbering, module on/off, role × module permission matrix |
| **Shop** | Work orders (3C, drag-and-drop status board, canned jobs, digital inspection with traffic lights, vehicle history, recalls), AMVIC estimate-authorization enforcement, POS with tenders, scheduler with bay capacity, time clock, tire storage (tire hotel) with seasonal swap campaigns, multi-location |
| **Supply chain** | Inventory with tire fields, tire finder (exact size and alternates within 3% diameter), reorder engine, POs with electronic send, receive-to-stock, auto A/P bill, **one search across every distributor** sorted by cost |
| **Integrations (66)** | Canadian and US tire distributors, manufacturers, parts (NAPA, Worldpac, PartsTech, Nexpart, RepairLink…), repair data (MOTOR, ProDemand, ALLDATA, CARFAX), live VIN decode (NHTSA) and Transport Canada recalls, payments (Moneris, Stripe, Helcim, Square, Clover), financing (Flexiti, Affirm), QuickBooks/Xero, payroll exports, Twilio/SendGrid, reviews, Geotab/Samsara, Shopify, HubSpot, plus a configurable REST and EDI adapter for any distributor |
| **Accounting** | True double-entry GL (every invoice, payment, bill, bank line and pay run posts automatically), A/R & A/P aging, bank CSV import and matching, manual journal entries, chart of accounts, P&L, balance sheet, trial balance, GST/HST return worksheet (GST34 lines 101/103/106/109), PST and tire-levy tracking, period lock, customer statements |
| **Payroll (Canada)** | CRA T4127 annualization: CPP + CPP2, EI, federal and Alberta tax (2026 tables); hourly, salary, flat-rate and commission pay; Alberta overtime (8/44 rule); vacation pay; flat-rate minimum-wage top-up warning; pay stubs; PD7A remittance summary; T4 box data export |
| **CRM** | Customer 360 (LTV, vehicles, storage, invoices, activity), deal pipeline (drag-and-drop), activities/follow-ups, CASL-aware campaigns (consent tracking, mandatory opt-out, segments such as stored winters, service due, lapsed), review requests |
| **AI (Claude)** | Estimate builder from the customer concern, plain-language inspection and customer messages, seasonal demand forecast and reorder, pricing/margin review, bank-transaction categorization, business health audit, payroll anomaly check, campaign and review-reply writer, natural-language "ask your shop" assistant. Metered per plan. **Every AI tool has a rules-based offline fallback**, so the demo works without an API key |

## Project layout

```
shopstack/
├── public/index.html          ← built single-file app (deploy this)
├── src/                       ← app source, concatenated by build.mjs
│   ├── 02-engine.js           ← pure tax / pricing / GL / payroll logic (unit-tested)
│   └── …                      ← core, entities, seed, shop, supply, back office, insights, admin
├── netlify/functions/
│   ├── ai.mjs                 ← Claude gateway (task prompts, quota metering, refusal fallback)
│   ├── connectors.mjs         ← vendor/distributor gateway (search, order, VIN, recalls, SMS/email)
│   ├── billing.mjs            ← Stripe Checkout + webhook
│   └── members.mjs            ← invite users to a tenant with a role (plan seat limits)
├── netlify/lib/               ← shared auth/crypto + connector catalog (also injected into the UI)
├── supabase/schema.sql        ← multi-tenant schema, RLS, audit log, balanced-journal trigger
├── tests/engine.test.mjs      ← tax, AMVIC, postings, statements, payroll and overtime tests
└── docs/COSTAR-RESEARCH.md
```

## Run the demo (no backend)

Open `public/index.html` in a browser. Data stays in that browser (localStorage).

| PIN | Who |
|---|---|
| **107451** | Scott Townsend: platform admin, all 3 demo tenants |
| 1111 / 2222 / 3333 | Advisor / technician / accountant (Northgate Tire & Auto) |

Three demo tenants show multi-tenancy: Northgate Tire & Auto (Enterprise, 2 locations), Prairie Fleet Service (Pro), Riverbend Auto Care (Starter, trial, SK).

## Deploy to production (Supabase + Netlify)

1. **Supabase**: create a project in **ca-central-1** (Canadian data residency). Run `supabase/schema.sql` in the SQL editor. Add your user to `platform_admins` (`insert into platform_admins values ('<your auth user id>')`). Under Auth, enable email sign-in and set the site URL.
2. **Stripe**: create Products and Prices for Starter, Pro and Enterprise, then `update plans set stripe_price='price_…' where id='pro'` (and the others). Add a webhook to `https://<site>/.netlify/functions/billing` for `checkout.session.completed` and `customer.subscription.*`. Turn on Stripe Tax for GST/HST on subscriptions.
3. **Netlify**: point a site at this folder (base directory `shopstack`). Environment variables:

   | Variable | Purpose |
   |---|---|
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Injected at build to switch the app to cloud mode |
   | `SUPABASE_SERVICE_ROLE_KEY` | Functions only (never exposed to the browser) |
   | `ANTHROPIC_API_KEY` | AI features (`AI_MODEL` optional; default `claude-opus-5-5`) |
   | `CONNECTOR_KEY` | 32+ random characters; encrypts distributor credentials |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL` | Billing |
   | `ALLOWED_ORIGIN` | Your app domain (CORS) |
   | `ALLOW_DEMO=true` | Only for a public demo site with no Supabase |

4. Build command `npm run build`, publish directory `public` (already in `netlify.toml`).
5. `npm test` runs the engine tests.

The AI gateway uses `claude-opus-5-5` with the server-side refusal fallback (`fallbacks: "default"`). If Claude declines a request on safety grounds, the API retries it on Anthropic's recommended fallback model. Remove those two lines in `ai.mjs` to opt out.

## Before going live: checklist and known limits

- **Payroll tables:** 2026 federal and Alberta values are built in. **Verify them against CRA T4127 (January 2026) and PDOC** before the first live run. Other provinces need their brackets added (Payroll → Rates & tables); payroll refuses to run without them. Quebec (QPP, QPIP, Revenu Québec) needs separate work. ROE filing and direct deposit (EFT/ACH file) are not built; use the Wagepoint, Rise or ADP export connectors or add a bank EFT export.
- **SIN encryption:** SINs are restricted by RLS to owner, manager and accountant roles, masked in the UI and stripped from the audit log, but they are not encrypted at the column level yet. Add Supabase Vault / pgsodium column encryption before storing real SINs.
- **Distributor APIs:** connectors marked "Dealer agreement required" return sample quotes (clearly labelled *demo*) until each distributor issues API or EDI credentials. Their adapter is a configurable REST mapper (base URL, paths, field map), so most JSON dealer APIs connect without code. Distributors with proprietary SOAP or EDI-only interfaces need a small custom adapter each. QuickBooks/Xero/Google OAuth flows need their app registrations.
- **AMVIC tolerance:** the default (lesser of 10% or $100 over the authorized estimate) is configurable. Confirm the current rule with AMVIC.
- **Scale:** cloud mode loads a tenant's records into the browser at sign-in (up to 10,000 per collection). That is fine for single shops; add server-side pagination and search for large multi-store tenants.
- **French (Quebec):** UI strings are English only so far; French is required before onboarding Quebec tenants.
- **Sign-in:** PIN logins are demo-mode only. Production uses Supabase Auth (email + password, invites sent by `members.mjs`); turn on MFA for owners and accountants. A PIN quick-switch for shared counter terminals in cloud mode is a planned enhancement.
