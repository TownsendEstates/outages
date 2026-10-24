# Muse Watch

An iPhone app plus Apple Watch app (with a watch-face complication and Siri) that lets Scott Townsend talk to his **Meta Muse Spark** AI agent from the wrist.

## What's included

| Piece | What it does |
|---|---|
| **iPhone app** | Chat with Muse, conversation history, settings (provider, API key, model, agent instructions, quick prompts), connection test, sync to watch |
| **Watch app** | Tap **Ask Muse**, then dictate, Scribble, or type. One-tap quick prompts, follow-up questions, replies read aloud (toggle), haptics, recent conversations |
| **Complication** | Circular, corner, rectangular, and inline. Opens Muse from the watch face in one tap |
| **Siri / Shortcuts** | "Hey Siri, ask Muse Watch" works on both iPhone and watch, and Siri reads the answer back |
| **Avatar** | Pick any image on the iPhone (Settings → Agent). It appears on the watch home screen, next to every reply, as a pulsing "thinking" indicator, on the complication, and on the iPhone |
| **Smart routing** | The watch calls Muse directly over Wi-Fi or LTE. If that fails, it relays through the iPhone automatically |

## Setup (on a Mac, about 10 minutes)

1. Install Xcode 15 or later, then XcodeGen: `brew install xcodegen`
2. In this folder, run `xcodegen generate` and open `MuseWatch.xcodeproj`.
3. In **Signing & Capabilities**, choose your Apple Developer team for all three targets (MuseWatch, MuseWatchWatch, MuseWatchComplication). You can also set `DEVELOPMENT_TEAM` in `project.yml`. Xcode registers the App Group `group.ca.townsendestates.musewatch` automatically (the watch app and complication use it to share the avatar).
4. Plug in the iPhone and select the **MuseWatch** scheme. Click Run. The watch app installs with it; if it doesn't, open the Watch app on the iPhone and tap Install next to Muse.
5. In the iPhone app, open **Settings**: pick a provider, paste the API key, tap **Test connection**, then tap **Save & sync to Watch**.
6. In **Settings → Agent**, tap **Choose avatar** and pick the image you want for Muse (for example a screenshot of your Meta AI avatar).
7. On the watch face, long-press, tap **Edit**, go to Complications, and add **Ask Muse**.

### Getting an API key

- **Meta Model API**: sign up at Meta's developer portal (developer.meta.com). Base URL `https://api.meta.ai/v1`, model `muse-spark-1.1`. The July 2026 preview was **US-only**. If you get a 403 from Alberta, use OpenRouter.
- **OpenRouter** (works from Canada): create a key at openrouter.ai. Base URL `https://openrouter.ai/api/v1`, model `meta/muse-spark-1.1`.
- **Custom**: any OpenAI-compatible gateway. Set the base URL and model, and choose Chat Completions or Responses mode. **Test connection** detects the right mode by itself.

Pricing at launch: about US$1.25 per million input tokens and US$4.25 per million output tokens. A typical question from the watch costs a fraction of a cent.

## Notes and limitations

- This uses the **Muse Spark developer API**, not your consumer Meta AI app account. Chats from the Meta AI app, its memory, and any connected Meta accounts don't carry over. To give it "your" context, use the agent instructions in Settings.
- Without a paid Apple Developer Program membership (CA$129/yr), a free personal team build expires every 7 days. TestFlight or the paid program removes that limit.
- Missing app icons only cause build warnings. To fix them, drop 1024×1024 PNGs into `iOS/Assets.xcassets/AppIcon.appiconset` and `Watch/Assets.xcassets/AppIcon.appiconset`.
- If your XcodeGen version doesn't embed the watch app, add it in Xcode under the MuseWatch target: **General → Frameworks, Libraries, and Embedded Content → +**.

## Security

Everything below is on by default and doesn't get in the way of normal use.

| Area | Protection |
|---|---|
| **API key** | Stored in the Keychain on each device (this device only, never in iCloud Keychain or backups). It is never shown again after you save it; you only see `••••abcd`. It moves to the watch only by live, end-to-end encrypted WatchConnectivity message, never written to WatchConnectivity's on-disk sync store. Removing it on the iPhone also wipes it from the watch. |
| **Network** | HTTPS only (the app refuses `http://` and URLs with embedded credentials), TLS 1.2 minimum, App Transport Security on. Ephemeral session: no cache, no cookies, no stored credentials. Redirects are refused, so the key can never be forwarded to another host. |
| **iPhone app** | Face ID / passcode to open, re-locking after 60 seconds in the background. Content is hidden in the app switcher. You can turn the lock off in Settings. |
| **Chat history** | On the iPhone it's encrypted whenever the phone is locked (Complete file protection); on the watch it's encrypted until first unlock. History is left out of iCloud/computer backups and never synced to any server by this app. A locked background launch can't wipe history. |
| **Watch relay** | Only your paired watch running this app can reach the iPhone relay (enforced by Apple). The iPhone also caps relayed requests (40 messages / 24k characters) so nothing can run up the API bill. |
| **Siri** | "Ask Muse" only runs on an unlocked iPhone or an unlocked, on-wrist watch. |
| **Avatar** | Picked with the system photo picker (the app gets no photo-library access), cropped and re-encoded, which strips location and camera data. |
| **Clipboard** | Copied replies clear themselves from the clipboard after 5 minutes. |
| **Errors** | Server error messages are shortened and anything that looks like a key is redacted before being shown. |
| **Permissions** | No location, contacts, microphone, or background modes are requested. Watch dictation uses Apple's system input. |

**Deliberately not done, because it would break something:**
- *Requiring Face ID to read the key*: the watch relay and Siri need it while the phone is locked in your pocket.
- *Certificate pinning*: Meta and OpenRouter rotate certificates, and pinning would make the app stop working without warning.
- *Proxy server holding the key*: this is stronger (a stolen phone couldn't reveal the key), but it needs a hosted server (for example a Supabase Edge Function). Worth doing if this ever goes to the team.

**Your part:** use a dedicated API key for this app with a monthly spend limit set in the provider dashboard. Keep a passcode on the watch with wrist detection on. Rotate the key if a device is lost.

## Compliance flags (Alberta / Canada)

- **PIPA / PIPEDA**: prompts go to a US provider (Meta or OpenRouter). Don't dictate personal information about clients, staff, or estate beneficiaries unless your privacy notices cover cross-border processing. Conversation history stays only on the phone and watch.
- **Meta / OpenRouter terms**: check each provider's data-retention and training-use settings. On OpenRouter, turn off prompt logging and choose providers that don't train on your data.
- **Avatar**: no Meta logo or artwork is bundled. Using Meta's official Meta AI icon as your personal avatar is fine on your own device. Don't ship it in a distributed app.
- **Branding**: "Meta" and "Muse" are Meta trademarks. This build is fine for personal use. Publishing it on the App Store would need a new name and wording that doesn't suggest Meta endorses it.
