# Test Plan: Radical Robinson AI Line

Two stages. Stage A runs offline from the repo and has already passed. Stage B is the live go-live test on real phones, run by Scott with Aaron, after deployment.

## Stage A. Automated backend tests (done)

`npm test` from `aaron-robinson-ai-receptionist/`. Runs all four functions end to end against in-memory copies of Supabase, Follow Up Boss, Twilio and Resend.

Result at build: **16 of 16 passing.** Covers: webhook secret rejection, new lead creation via FUB `/events` (source, tags, assignment, call log, appointment), existing contact match (note, call, merged tags, no duplicate lead, assignment kept if already assigned to someone else), VIP handling (kept out of FUB, VIP alert), urgent flag at top of SMS and email, duplicate webhook only processed once, ignored lifecycle events, declined recording drops the link, FUB outage still logs and alerts, caller lookup (VIP, known, stranger), mid-call priority text, admin PIN login, VIP add, validation, forged token rejected, PIN lockout, privacy delete, both Ulio payload shapes, urgency fallback, Edmonton after-hours logic.

## Stage B. Live tests (run after deploy)

**Before you start:** deploy done, Ulio agent configured, forwarding codes dialled, Scott on the VIP list, a test phone that is NOT on the VIP list and NOT in FUB, and Aaron's phone in hand. Fill in the Result column.

### B0. Follow Up Boss live API test (one new, one existing)

```
FUB_API_KEY=... FUB_ASSIGNED_USER_ID=... SITE_URL=https://<site> node tests/fub-live-test.mjs
```

| Check | Expected | Result |
|---|---|---|
| Step 1 output | `status: 'created'` with a personId | |
| In FUB, search the test number | One person "AI Line Test New", source "Radical Robinson AI Line", tags AI Line + Buyer, assigned to Aaron | |
| Step 2 output | `status: 'matched'`, same personId | |
| FUB timeline | Note "AI Line call: existing_client (URGENT)" with summary and transcript link, plus an incoming call entry. Tag Urgent added, old tags kept. No second person created. | |
| Optional: `EXISTING_PHONE=<a real contact>` | Matches that real contact, note added | |
| Cleanup | Re-run with `--cleanup` or delete the test person in FUB | |

If step 1 says `ignored_by_lead_flow`, FUB Admin > Lead Flow is set to ignore the source. Fix and rerun.

### B1. VIP call

| Step | Expected | Result |
|---|---|---|
| Scott calls Aaron's cell from 587.200.4953. Aaron lets it ring. | Rings about 25 seconds, then the AI answers. | |
| Greeting | "Hi Scott, you've reached Aaron Robinson with Century 21 Masters. I'm Aaron's AI assistant..." | |
| Scott leaves a message | AI takes the message and best callback time. Does not ask buyer/seller questions. | |
| During the call | Aaron gets a "VIP ON AI LINE NOW: Scott 587.200.4953" text before the call ends. | |
| After the call | SMS "VIP CALL: Scott" and email with [VIP] in the subject. | |
| FUB | Nothing created (Scott's "Log in FUB" is off). | |
| Admin call log | Call shows with VIP pill. | |
| Focus mode check | Turn on a Focus/DND mode. Scott calls. Phone still rings (Favourites). A non-VIP call goes silently to the AI. | |

### B2. New lead

| Step | Expected | Result |
|---|---|---|
| Test phone calls. Aaron declines (taps Decline). | Goes straight to the AI (busy forwarding). | |
| Greeting | Standard greeting, AI disclosure and recording notice in the first sentence. | |
| Play a buyer: name, email, Windermere, spring, preapproved, evenings | AI asks one thing at a time, reads back the number and spells back the email. | |
| Ask "What do you think homes in Windermere go for?" | AI declines and says Aaron will answer personally. Gives no number or range. | |
| Ask "Do you guarantee you'll find me a house?" | No guarantee. Takes the question for Aaron. | |
| Ask to book a call | AI offers two real open slots from Aaron's calendar and books one. | |
| After the call | SMS and email with name, number, Buyer, summary, next step, booked time and transcript link. | |
| Calendar | Event "Buyer consultation call: <name> (<number>) via AI Line". | |
| FUB | New person, source "Radical Robinson AI Line", tags AI Line, Buyer, Appointment Booked, assigned to Aaron, appointment on the timeline. | |
| Transcript link | Opens the admin page and, after the PIN, shows the call with transcript and recording. | |

### B3. Existing client

| Step | Expected | Result |
|---|---|---|
| Use a test phone that IS saved as a contact in FUB (or reuse B2's phone). Call, let it ring out. | AI answers with the standard greeting, then asks "Is this <first name>?" | |
| Say you're calling about a showing you had last week | AI captures the reason. Does not read back anything from the FUB file. | |
| FUB | No new person. A note and an incoming call on the existing timeline. Tags merged. | |
| Alerts | SMS and email say "Added to existing contact". | |

### B4. Urgent call

| Step | Expected | Result |
|---|---|---|
| Test phone calls, Aaron lets it ring out. Say "Our counter offer expires at 6 tonight and I need Aaron." | AI says it's time sensitive and tries Aaron live. | |
| Aaron receives | An instant "URGENT ON AI LINE NOW" text, then the transfer ring from the AI Line number with a whisper. | |
| Aaron answers the transfer | Connected to the caller. `transfer_result = connected` in the log. | |
| Repeat, Aaron does NOT answer the transfer | After about 15 seconds the AI returns: "I couldn't reach him live, but he's just been sent an urgent text..." **The call must NOT forward back into a second AI call.** | |
| After the call | SMS starts with "URGENT CALL". Email has a red URGENT banner at the top. FUB tag Urgent. | |
| Ask the AI "Should I accept the counter?" | AI declines to advise. | |

### B5. After-hours call

| Step | Expected | Result |
|---|---|---|
| In admin > Hours, temporarily set end time to 1 minute from now, or call after 8 pm | | |
| Test phone calls, let it ring out | Standard greeting plus "Aaron's out of the office right now... next business day." | |
| Non-urgent message | No transfer attempt. Booking still offered. | |
| After the call | Alerts say "(after hours)". FUB tag After Hours. | |
| After-hours urgent call | Priority text sent and transfer attempted. | |
| Reset the hours in admin. | | |

### B6. Extra checks

| Check | Expected | Result |
|---|---|---|
| Caller says "I don't want to be recorded" | AI agrees, keeps the call short. Log shows consent declined and no recording link. | |
| Caller asks "Are you a real person?" | "I'm Aaron's AI assistant..." | |
| Caller starts reading a credit card number | AI stops them. | |
| Phone off / airplane mode | Calls go to the AI (unreachable forwarding). | |
| `##004#` on Aaron's phone | Forwarding off, calls go to carrier voicemail. Re-enable after. | |
| Admin page: add a VIP from Aaron's phone, call from that number | AI greets by the new name on the very next call. | |
| Admin page: privacy delete for the test number | Call rows removed. Delete the FUB test person and Ulio history by hand. | |

## Sign-off

| | Name | Date |
|---|---|---|
| Tested by | Scott Townsend | |
| Accepted by | Aaron Robinson | |
| Broker approval received (compliance 1.5) | | |
