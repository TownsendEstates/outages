# Muse Watch

An iPhone app plus Apple Watch app (with a watch-face complication and Siri) that lets Scott Townsend talk to his **Meta Muse Spark** AI agent from the wrist.

## What's included

| Piece | What it does |
|---|---|
| **iPhone app** | Chat with Muse, conversation history, settings (provider, API key, model, agent instructions, quick prompts), connection test, sync to watch |
| **Watch app** | Tap **Ask Muse**, then dictate, Scribble, or type. One-tap quick prompts, follow-up questions, replies read aloud (toggle), haptics, recent conversations |
| **Complication** | Circular, corner, rectangular, and inline. Opens Muse from the watch face in one tap |
| **Siri / Shortcuts** | "Hey Siri, ask Muse Watch" works on both iPhone and watch, and Siri reads the answer back |
| **Smart routing** | The watch calls Muse directly over Wi-Fi or LTE. If that fails, it relays through the iPhone automatically |

## Setup (on a Mac, about 10 minutes)

1. Install Xcode 15 or later, then XcodeGen: `brew install xcodegen`
2. In this folder, run `xcodegen generate` and open `MuseWatch.xcodeproj`.
3. In **Signing & Capabilities**, choose your Apple Developer team for all three targets (MuseWatch, MuseWatchWatch, MuseWatchComplication). You can also set `DEVELOPMENT_TEAM` in `project.yml`.
4. Plug in the iPhone and select the **MuseWatch** scheme. Click Run. The watch app installs with it; if it doesn't, open the Watch app on the iPhone and tap Install next to Muse.
5. In the iPhone app, open **Settings**: pick a provider, paste the API key, tap **Test connection**, then tap **Save & sync to Watch**.
6. On the watch face, long-press, tap **Edit**, go to Complications, and add **Ask Muse**.

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

## Compliance flags (Alberta / Canada)

- **PIPA / PIPEDA**: prompts go to a US provider (Meta or OpenRouter). Don't dictate personal information about clients, staff, or estate beneficiaries unless your privacy notices cover cross-border processing. Conversation history stays only on the phone and watch.
- **Meta / OpenRouter terms**: check each provider's data-retention and training-use settings. On OpenRouter, turn off prompt logging and choose providers that don't train on your data.
- **Branding**: "Meta" and "Muse" are Meta trademarks. This build is fine for personal use. Publishing it on the App Store would need a new name and wording that doesn't suggest Meta endorses it.
- **Keys**: the API key is stored in the iOS/watchOS Keychain on each device and synced over Apple's encrypted WatchConnectivity channel. It is never written into the code.
