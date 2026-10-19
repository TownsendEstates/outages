# Call Routing Setup: Aaron's Cell to the AI Line

Bottom line: Aaron keeps his cell number. Every call rings his phone first. Only calls he misses, declines, or can't receive (no signal, phone off) go to the AI. Nobody else ever sees the Ulio number.

## How a call flows

```
Caller dials Aaron's cell
        |
        v
Aaron's phone rings (about 25 seconds)
        |
   +----+------------------------------+
   |                                   |
 Answers                     No answer / declined (busy) / phone off or no signal
   |                                   |
 Normal call                 Carrier forwards to the Ulio number
                                       |
                             /api/caller-lookup checks the number
                                       |
                 +---------------------+----------------------+
                 |                     |                      |
                VIP             Known FUB contact          New caller
   Greet by name, priority     Greet, confirm name,     Full intake, booking
   message, instant text       capture today's reason
                 |                     |                      |
                 +----------+----------+----------------------+
                            |
             Urgent? -> instant text + live transfer attempt (15 s)
                            |
             Call ends -> log, Follow Up Boss, SMS + email to Aaron
```

## Step 1. Provision the Ulio number

In Ulio, buy a local Edmonton number (780 or 587) and assign it to the "Radical Robinson AI Line" agent. A local number matters: forwarding to a non-local number can trigger long distance charges on some plans.

## Step 2. Set conditional forwarding on Aaron's cell

These GSM codes work on Rogers, Fido, Bell, Virgin, Telus, Koodo, Freedom and most Canadian carriers. Dial each one like a phone number and press Call. Replace `1780XXXXXXX` with the Ulio number (1 plus 10 digits).

| What | Dial | Notes |
|---|---|---|
| Set all three conditions at once | `**004*1780XXXXXXX#` | Fastest. Then set the ring time below. |
| No answer, ring 25 seconds first | `**61*1780XXXXXXX**25#` | Allowed values 5, 10, 15, 20, 25, 30. Use 25 or 30. |
| Busy (or Aaron taps Decline) | `**67*1780XXXXXXX#` | |
| Unreachable (off, airplane mode, no signal) | `**62*1780XXXXXXX#` | |
| Check status | `*#61#`, `*#67#`, `*#62#` | Phone shows the forwarding number. |
| Turn ALL conditional forwarding off | `##004#` | Emergency off switch. Calls go back to carrier voicemail. |

If a code returns an error, the plan likely needs the call forwarding feature turned on. Aaron calls his carrier (611 from his cell) and asks for "conditional call forwarding to a local number".

### Ring timer and the live transfer loop guard

The AI's live transfer rings Aaron's cell for 15 seconds. His carrier waits 25 seconds before forwarding. Because 15 is less than 25, an unanswered transfer returns to the AI before the carrier can forward it back. **Do not set the carrier timer below 20 seconds.** Test 5 in the test plan checks this.

## Step 3. Phone settings on Aaron's cell

- **Carrier voicemail stops getting calls.** With forwarding on, the AI replaces voicemail. Ask Aaron to record nothing new and to clear old voicemails.
- **iPhone:** Settings > Focus > (each Focus he uses) > People > Allow calls from > Favourites. Add every VIP to Favourites. Also turn on "Allow Repeated Calls".
- **Android:** Settings > Notifications > Do Not Disturb > People > Calls > Starred contacts. Star every VIP.
- **Silence Unknown Callers (iPhone)** can stay on if Aaron likes. Silenced calls go to the AI instead of voicemail.
- Save the Ulio number in Aaron's contacts as "AI Line" so he recognises transfer calls.

## What "VIP bypass" means in practice

With conditional forwarding, every caller, VIP or not, rings Aaron's phone first. The carrier cannot tell VIPs apart, so the VIP list works in two layers:

1. **On Aaron's phone:** VIPs are Favourites (iPhone) or Starred (Android), so they ring through Focus, Do Not Disturb and Driving modes while everyone else goes quietly to the AI. This is the "rings straight through" part.
2. **On the AI line:** if a VIP still lands on the AI because Aaron didn't answer, the AI greets them by name, takes a priority message, sends Aaron an instant text during the call, and keeps them out of Follow Up Boss unless he chooses otherwise. VIPs marked "critical" also get a live transfer attempt.

The phone Favourites list and the AI VIP list are separate. When Aaron adds a VIP in the admin page, he should also add them to Favourites. The admin page reminds him.

**Option if Aaron later wants true AI side screening (flag for Scott):** forward ALL calls unconditionally (`**21*1780XXXXXXX#`) and have the Ulio agent transfer VIPs straight to a second line. That needs a second number for Aaron, since transferring back to the forwarded cell would loop. Not recommended for launch.

## Turning it off

- Pause the AI entirely: dial `##004#`. Calls go back to normal voicemail.
- Resume: dial `**004*1780XXXXXXX#` and then the `**61` code again with the 25 second timer.
