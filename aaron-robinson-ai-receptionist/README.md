# Radical Robinson AI Line

AI voice receptionist for Aaron Robinson, REALTOR®, Century 21 Masters (Edmonton). Runs on Ulio.ai, with a Netlify plus Supabase back end for the VIP list, call logging, Follow Up Boss sync and alerts to Aaron.

Owner: Scott Townsend.

## What's in this folder

| Path | What it is |
|---|---|
| `agent/system-prompt.md` | Full system prompt, greeting, guardrails, urgent and after-hours logic. Paste into Ulio. |
| `agent/ulio-agent-config.json` | Ulio build sheet: voice, greetings, tools (lookup, priority alert, transfer, booking), post-call fields, webhook URLs. |
| `routing/call-forwarding-setup.md` | Conditional forwarding codes for Aaron's cell, ring timer, loop guard, phone Focus/DND settings. |
| `routing/vip-whitelist-guide.md` | How the VIP list works and how Aaron edits it. |
| `admin/index.html` | Single-file, PIN-protected admin page: VIP list, call log with transcripts, hours, retention, privacy deletes. |
| `netlify/functions/` | `ulio-post-call` (log, FUB, SMS, email), `caller-lookup` (VIP and known contact check), `priority-alert` (instant mid-call text), `vip-admin` (admin API). |
| `lib/` | Shared code: Follow Up Boss client, notifications, Supabase client, payload normalizer, auth. No npm dependencies. |
| `supabase/migrations/001_receptionist_schema.sql` | Tables, RLS lock-down, retention job, privacy delete function, Scott seeded as first VIP. |
| `notifications/` | Template spec and rendered SMS and email samples. |
| `docs/compliance-checklist.md` | RECA, CREA, AREA, PIPA/PIPEDA, CASL/CRTC, Competition Act, Consumer Protection Act, with REVIEW flags. |
| `docs/test-plan.md` | Automated results plus the live test script (VIP, new lead, existing client, urgent, after hours). |
| `docs/aaron-one-pager.html` | One page for Aaron: how it works, editing VIPs, compliance notes. Print to PDF from a browser. |
| `tests/` | `npm test` (16 offline tests), `npm run fub-live-test` (real FUB, one new and one existing contact). |

## Deploy (about 45 minutes)

1. **Supabase.** New project in the **Canada (Central)** region. SQL editor: run `supabase/migrations/001_receptionist_schema.sql`. Enable `pg_cron` and run the commented `cron.schedule` line at the bottom.
2. **Netlify.** New site from this repo, Base directory `aaron-robinson-ai-receptionist`. Add every variable from `.env.example`. Generate `ULIO_WEBHOOK_SECRET` and `SESSION_SECRET` with `openssl rand -hex 32`. Give Aaron his own `AARON_PIN`.
3. **Follow Up Boss.** Aaron (or his FUB admin) creates an API key under Admin > API. Register the system at FUB's system registration page for `FUB_X_SYSTEM_KEY`. Get Aaron's user id (shown in the user URL in FUB admin) for `FUB_ASSIGNED_USER_ID`. Set lead flow for source "Radical Robinson AI Line" (see compliance item 5.3). Run `npm run fub-live-test`.
4. **Twilio and Resend.** Canadian long code for SMS. Verify a sending domain in Resend.
5. **Ulio.ai.** Create the agent from `agent/ulio-agent-config.json` and `agent/system-prompt.md`. Connect Aaron's calendar. Point the inbound webhook, the three custom tools and the post-call webhook at the Netlify URLs with `?key=<ULIO_WEBHOOK_SECRET>`. Turn off Ulio's native SMS and email alerts and any native FUB connector.
6. **Aaron's phone.** Dial the forwarding codes in `routing/call-forwarding-setup.md`. Add VIPs to Favourites.
7. **Test.** Run `docs/test-plan.md` Stage B with Aaron. Get broker sign-off before going live.

## Run tests

```
cd aaron-robinson-ai-receptionist
npm test
```

## Status at handoff

Built and tested offline: everything in this folder, 16 of 16 automated tests passing.

Not done from the build environment, needs Scott: the live Ulio agent (no Ulio API access here; paste config in the dashboard), the live FUB test (needs Aaron's API key; script ready), the live phone tests, and reviewing Aaron's Century 21 Masters page and social feed. Those sites were blocked from the build environment, so service areas and specialties in the prompt are marked `[CONFIRM]`. Aaron's mom's number and the business partners' details were not provided; Aaron adds them in the admin page.
