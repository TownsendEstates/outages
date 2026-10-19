# Notification Templates

Source of truth: `lib/notify.mjs`. Rendered samples: `notifications/samples/` (regenerate with `npm run render-templates`).

## Rules

- Every call sends Aaron one SMS and one email. Recipients: `AARON_ALERT_PHONE` and `AARON_ALERT_EMAIL` (comma separate to add an assistant).
- The first line of the SMS and the start of the email subject carry the flag, in this order: `URGENT VIP CALL`, `VIP CALL`, `URGENT CALL`, `PRIORITY CALL`, `New AI Line call`.
- Urgent emails open with a red banner showing the urgency reason. VIP emails open with a blue banner.
- SMS is capped at about 450 characters (3 segments). The summary is trimmed first; the email always has everything.
- VIP and urgent callers also trigger an instant mid-call text from `/api/priority-alert`.
- Alerts go to Aaron only. Nothing is sent to callers.

## SMS template

```
{FLAG}
{Caller name or VIP name} {780.555.0111}
Reason: {Buyer | Seller | Existing client | ...}{. urgency reason}
Summary: {2 to 4 sentence summary}
Next: {next step}
Booked: {type}, {Wed, Oct 21, 5:30 p.m.}, {address}      (only if booked)
(after hours)                                             (only if after hours)
{transcript link}
```

## Mid-call priority SMS

```
{VIP | URGENT | URGENT VIP} ON AI LINE NOW: {name} {number}
{one line reason}
Call back ASAP. Full notes to follow.
```

## Email template

Subject: `{[URGENT] }{[VIP] }AI Line: {caller}, {reason}`

Body, in order:
1. Banner (urgent red or VIP blue, if applicable)
2. Caller name and tap-to-call number
3. Summary
4. Next step
5. Detail table: reason, urgency, email, property or area, timeline, preapproval, best time to call, appointment, live transfer, after hours, recording consent, Follow Up Boss status
6. "Open transcript and recording" button
7. Footer: Aaron Robinson, REALTOR®, Century 21 Masters, confidentiality line, no-advice line

## Delivery providers

- SMS: Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`). Use a Canadian long code. If Scott's Ulio account already includes an SMS sender, the `sendSms` function is the only thing to swap.
- Email: Resend (`RESEND_API_KEY`, `ALERT_FROM_EMAIL` on a verified domain). Swap `sendEmail` for Microsoft Graph if you would rather send from an Outlook mailbox.
