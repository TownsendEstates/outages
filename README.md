# StatusPing

A status page service for small businesses, sold as a subscription.

A business publishes a status page, lists its services, and reports incidents from its phone. Its customers follow
the page in the same app (no account needed) and get a push notification the moment something breaks or is fixed.

"StatusPing" is a working name. It is set in `mobile/app.json` and `mobile/src/lib/config.ts`.

## What is in this repository

| Path | What it is |
| --- | --- |
| `mobile/` | The app. One Expo (React Native) codebase that builds for iOS, Android and web. |
| `supabase/migrations/` | Database schema, access rules and plan limits. |
| `supabase/functions/notify-incident/` | Sends push notifications when an update is posted. |
| `supabase/functions/revenuecat-webhook/` | Changes an organization's plan when the app stores report a purchase, renewal or expiry. |
| `aws_outage_tracker.html` | The original single-page outage notice. Unrelated to the app; still deployed by `.github/workflows/static.yml`. |

## Try it now

With no configuration the app runs in demo mode on sample data, so every screen can be explored without a server.

```bash
cd mobile
npm install
npx expo start --web     # or scan the QR code with Expo Go on a phone
```

Use the page code `northwind`. On the business side, any email and an 8-character password signs in.

## How it makes money

| Plan | Price (placeholder) | Services | Subscribers alerted | Brand colour | Badge removed |
| --- | --- | --- | --- | --- | --- |
| Free | $0 | 3 | 25 | – | – |
| Pro | $19 / month | 20 | 1,000 | Yes | Yes |
| Business | $49 / month | Unlimited | Unlimited | Yes | Yes |

Following a page is always free. Limits are enforced in the database (`plan_limits()` in the migration), not just in
the app; `mobile/src/lib/plans.ts` mirrors them for display, so change both together. The prices shown in the app
come from the App Store and Google Play once products exist; the figures above are only the fallback text.

Subscriptions are bought in-app through RevenueCat. The app never sets a plan itself: the store notifies RevenueCat,
RevenueCat calls the webhook, and the webhook updates `organizations.plan`.

## Going live

Nothing below has been done yet. Each step needs an account that only the owner can create.

1. **Supabase** – create a project, then from the repository root:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   supabase secrets set REVENUECAT_WEBHOOK_SECRET=<a long random string>
   supabase functions deploy notify-incident
   supabase functions deploy revenuecat-webhook
   ```
   In Authentication → Email Templates → Reset Password, include `{{ .Token }}` in the body. The app's password
   reset asks for that 6-digit code rather than a link.
2. **Expo** – `cd mobile && npx eas-cli@latest init`. This writes the project id that push notifications need.
   Upload the Apple push key and the Firebase (FCM v1) service account when `eas credentials` asks.
3. **Store accounts** – Apple Developer Program and Google Play Console. Create two auto-renewing monthly
   subscriptions in each store.
4. **RevenueCat** – add both apps, create entitlements `pro` and `business`, and one current offering whose two
   packages have the identifiers `pro` and `business`. Add the webhook:
   `https://<ref>.supabase.co/functions/v1/revenuecat-webhook` with the header
   `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`.
5. **Configuration** – copy `mobile/.env.example` to `mobile/.env` and fill it in. For store builds, set the same
   values as EAS environment variables.
6. **Web** – deploy `mobile/` to Netlify (`netlify.toml` is included) with the same `EXPO_PUBLIC_*` variables, and
   set `EXPO_PUBLIC_WEB_URL` to its address.
7. **Build and submit** – `npx eas-cli@latest build --platform all`, then `npx eas-cli@latest submit`.

Before submitting, also replace the placeholder identifiers `app.statusping.mobile` in `mobile/app.json` with ones
on a domain you own, and publish a privacy policy and terms of use (both stores require them; the URLs go in
`.env`).

## How access is controlled

- Owners sign in with email and password. Row-level security limits them to their own organization.
- The public key has no direct table access at all. Public reads and follows go through a handful of database
  functions, so pages cannot be listed and follower data is never exposed.
- A follower is an anonymous device: a random id plus a push token. No name, email or phone number is collected.
- `organizations.plan` cannot be written by any signed-in user. Only the billing webhook changes it.
- Owners can delete their account in the app (Settings), which removes the page, its history and its follower list.

## Checks

```bash
cd mobile
npx tsc --noEmit
npx eslint .
npx expo export --platform web
```
