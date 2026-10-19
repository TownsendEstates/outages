# Compliance Checklist: Radical Robinson AI Line

Prepared for Scott Townsend. Status key: **BUILT** = the build handles it. **ACTION** = a person must do something before go-live. **REVIEW** = not sure, Scott to confirm (with the broker, a lawyer, or the regulator as noted).

This is an operational checklist, not legal advice. The items marked REVIEW are where I would not rely on my own reading.

## 1. RECA: Real Estate Act, Real Estate Act Rules, advertising

| # | Requirement | How it is handled | Status |
|---|---|---|---|
| 1.1 | Advertising and client-facing statements must identify the brokerage | Every greeting names "Century 21 Masters". The system prompt says to name the brokerage whenever Aaron is introduced. Alerts, admin page and FUB notes carry "Century 21 Masters". | BUILT |
| 1.2 | Nothing false or misleading | AI is barred from claims about results, rankings, guarantees, incentives, availability or prices. It discloses that it is an AI in the first sentence. | BUILT |
| 1.3 | Personal brand "Radical Robinson / Radical Inc" must not suggest it is a brokerage or a separate company that trades in real estate | The AI says Radical Robinson is Aaron's personal brand and he is a REALTOR® with Century 21 Masters. It never says "Radical Inc" out loud. | BUILT |
| 1.4 | Use of the "Radical Inc" corporate name in any advertising, and whether Aaron's commission flows through a corporation, must fit RECA rules and the brokerage's policy | Not something the AI can settle. | **REVIEW**: Scott to ask the Century 21 Masters broker of record whether "Radical Robinson" and "Radical Inc" are approved trade names for Aaron's advertising. |
| 1.5 | Broker supervision: the brokerage is responsible for its licensees' advertising and client communications | The AI line is a new client-facing channel. | **ACTION**: Get written OK from the Century 21 Masters broker (email is fine) before go-live. Send them the system prompt and this checklist. |
| 1.6 | Consumer Relationships Guide and written service agreements happen before Aaron provides services | The AI does not create any brokerage relationship, does not discuss agency, and does not ask callers to sign anything. Aaron handles the Guide and agreements at first meeting. | BUILT (AI side). Aaron's own process unchanged. |
| 1.7 | Licensee must not give misleading information about properties | AI never says a property is available, sold, or has offers. Showings are booked as "request, not confirmed". | BUILT |
| 1.8 | Complaint route | AI takes complaint details, marks high priority, and if asked tells callers they can contact Century 21 Masters or RECA. | BUILT |
| 1.9 | Rule numbers | I could not reach RECA's site from the build environment to confirm current rule numbers after the recent Rules updates. | **REVIEW**: check the current Real Estate Act Rules advertising section at reca.ca before quoting rule numbers to Aaron. |

## 2. CREA REALTOR® Code and AI guidance

| # | Requirement | How it is handled | Status |
|---|---|---|---|
| 2.1 | Aaron stays accountable for everything said for him | AI gives no advice or opinions on pricing, valuation, offers, contracts, legal, tax or mortgage. It always routes those to Aaron. Every call is logged with a full transcript so Aaron can review what was said. | BUILT |
| 2.2 | Honesty, no misleading representations, disclose the AI | First sentence discloses the AI. If asked "are you a person", it says it is Aaron's AI assistant. | BUILT |
| 2.3 | REALTOR® trademark use | Written as "REALTOR®" with the registered mark, referring to Aaron as a person. Never used as a verb or a generic word. | BUILT |
| 2.4 | Confidentiality of clients | AI is never given client file data. The caller lookup returns only VIP status and first name, nothing from FUB notes or deals. | BUILT |
| 2.5 | CREA's AI guidance document | Could not pull the current version from the build environment. | **REVIEW**: Scott to check crea.ca for the current guidance on AI tools and make sure nothing new applies (for example, any member disclosure wording). |

## 3. AREA standards

| # | Requirement | How it is handled | Status |
|---|---|---|---|
| 3.1 | AREA membership obligations follow the REALTOR® Code and board rules | Covered by sections 2 and 4. | BUILT |
| 3.2 | REALTORS® Association of Edmonton (RAE) rules on advertising and MLS® data | AI does not quote MLS® data, listing details, or market statistics. | BUILT |
| 3.3 | Any AREA or RAE specific rule on automated phone systems | None known. | **REVIEW** (low risk): Aaron can ask RAE member services. |

## 4. Privacy: Alberta PIPA and PIPEDA

PIPA (Alberta) is the main law here because Aaron is an Alberta business collecting personal information in Alberta. PIPEDA can apply to information that crosses provincial or national borders, which is why both are covered.

| # | Requirement | How it is handled | Status |
|---|---|---|---|
| 4.1 | Notice and consent at collection | Greeting says the call may be recorded to help Aaron follow up. Callers can say no; the AI stops recording if Ulio supports it, keeps the call short, and logs `recording_consent = declined`. The webhook drops the recording link for declined calls. | BUILT |
| 4.2 | Ulio "stop recording mid-call" action | Depends on Ulio's feature set. | **ACTION**: Scott to confirm in Ulio. If not supported, change the AI's line to "I'll keep this short and Aaron's team will delete the recording" and delete it from Ulio after the call. |
| 4.3 | Collect only what is needed | Intake limited to name, contact, buyer/seller, area, timeline, preapproval yes/no, best time. AI is told never to ask for income, amounts, credit, SIN, ID or banking, and to stop callers who volunteer them. Ulio PII redaction set for card, SIN and bank numbers. | BUILT |
| 4.4 | Reasonable security | Supabase tables have RLS on with no anon access; only server functions with the service key can read. Admin page is behind a PIN with lockout, signed 8 hour sessions, no-index, no framing. Webhooks need a shared secret. | BUILT |
| 4.5 | Service providers outside Canada (PIPA s. 13.1) | Ulio.ai, Netlify, Twilio, Resend and Follow Up Boss may store or process data in the US. | **ACTION**: (a) Create the Supabase project in the Canada (Central) region. (b) Add an "AI Line" section to Aaron's privacy policy naming that service providers outside Canada are used, why, and who to contact with questions. Draft wording below. |
| 4.6 | Retention: keep only as long as reasonably needed | Nightly job clears recording links after 90 days and transcripts after 2 years. Call summaries remain. Both periods are editable in the admin page. | BUILT. **REVIEW**: confirm with the broker that 90 days / 2 years fits brokerage record keeping. If the brokerage needs longer for trade records, those belong in FUB and the brokerage file, not the AI log. |
| 4.7 | Retention inside Ulio | Ulio keeps its own copy of recordings and transcripts. | **ACTION**: set Ulio's retention to match (90 days for recordings) if the setting exists, or calendar a quarterly purge. |
| 4.8 | Access and deletion on request | Admin page > Privacy request deletes all AI Line rows for a number. Checklist reminds Aaron to also delete in FUB and Ulio. Respond within 30 days (PIPEDA timeline; PIPA allows 45, so 30 meets both). | BUILT (AI log). Manual for FUB and Ulio. |
| 4.9 | Breach notification | PIPA requires notifying the Alberta Privacy Commissioner and affected people where there is a real risk of significant harm. | **ACTION**: Scott keeps the incident runbook. Rotate `ULIO_WEBHOOK_SECRET`, `SESSION_SECRET` and PINs immediately on any suspected exposure. |
| 4.10 | VIP data | Family numbers are personal information of non-customers. Stored only in Supabase, not in FUB unless Aaron opts in, never spoken. | BUILT |
| 4.11 | Scott as service provider | Scott (through his agency entity) builds and administers a system holding Aaron's client data. | **REVIEW**: put a short service agreement in place between Aaron and Scott's contracting entity, covering confidentiality, security, data return and deletion at end of service. Confirm which of Scott's entities contracts. |
| 4.12 | Recording law | Criminal Code s. 184 allows recording where one party consents; the AI is a party and discloses the recording anyway. | BUILT |

**Draft privacy policy wording for Aaron's site (REVIEW before publishing):**

> When you call Aaron Robinson and he is unavailable, your call may be answered by an AI assistant. The assistant collects your name, contact details and the reason for your call so Aaron can follow up, and the call may be recorded and transcribed for the same purpose. You can ask the assistant not to record the call. Some of our service providers, including our phone, messaging and customer management providers, store or process information outside Canada, including in the United States, where it may be subject to the laws of that country. For questions about how we handle your information, or to ask for access to or deletion of it, contact Aaron Robinson at [EMAIL] or Century 21 Masters at [BROKERAGE PRIVACY CONTACT].

## 5. CRTC rules and CASL

| # | Requirement | How it is handled | Status |
|---|---|---|---|
| 5.1 | No automated outbound calls (CRTC Unsolicited Telecommunications Rules, ADAD rules) | The AI line is inbound only. No outbound dialling is configured. | BUILT |
| 5.2 | No commercial electronic messages without consent (CASL) | The system texts and emails Aaron only. It never texts or emails callers. Calendar invites to callers are OFF. | BUILT |
| 5.3 | Follow Up Boss automation on new leads | New leads from the source "Radical Robinson AI Line" may be picked up by FUB lead flow and action plans that send drip emails or texts. A phone inquiry gives implied consent for 6 months under CASL, but every message still needs sender ID and a working unsubscribe, and texts in FUB need their own compliance settings. | **ACTION**: In FUB Admin > Lead Flow, set the "Radical Robinson AI Line" source to either no action plan, or a plan Aaron has reviewed for CASL (identification, unsubscribe, 6 month cutoff unless express consent is captured). |
| 5.4 | Express consent for marketing | The AI does not collect marketing consent. It tells callers Aaron will set up listing alerts personally. | BUILT. Aaron collects express consent himself. |

## 6. Competition Act and Alberta Consumer Protection Act

| # | Requirement | How it is handled | Status |
|---|---|---|---|
| 6.1 | No false or misleading representations (Competition Act) | No performance, price, savings, ranking or "best" claims. No incentives. AI disclosure up front. | BUILT |
| 6.2 | No unfair practices (Alberta Consumer Protection Act) | No pressure, no exaggeration, no taking advantage of a caller's inability to understand. AI is patient and offers to take a message instead. | BUILT |
| 6.3 | Testimonials and reviews | AI never quotes reviews or testimonials. | BUILT |

## 7. Other items flagged

| # | Item | Status |
|---|---|---|
| 7.1 | **Alberta Human Rights Act**: no steering or discrimination. Prompt forbids it and bars "safety" or "good school" opinions. | BUILT |
| 7.2 | **FINTRAC**: AI never collects ID. Aaron handles client ID verification as usual. | BUILT |
| 7.3 | **Century 21 brand standards**: the greeting uses the brokerage name. Check Century 21 Canada brand rules if Aaron wants logos or the CENTURY 21® mark in emails or on the admin page. | **REVIEW** (low risk) |
| 7.4 | **Federal AI law**: no in-force federal AI disclosure law as of this build (the proposed AIDA did not pass). Disclosure is built in anyway. | BUILT. Recheck yearly. |
| 7.5 | **Emergency calls**: the AI tells anyone reporting danger at a property to call 911 first. | BUILT |
| 7.6 | **Accessibility**: callers who cannot use voice can email Aaron. Add the email to Aaron's voicemail-free website contact page. | ACTION (Aaron) |
| 7.7 | **Default PIN**: `ADMIN_PIN` defaults to Scott's standard 107451. Aaron must get his own different PIN, and the default should change for any client-facing install. | ACTION |
| 7.8 | **Public repo risk**: the `outages` repository deploys its whole contents to GitHub Pages when `main` is pushed. This folder contains no secrets, but it does contain Scott's cell number and client-facing drafts. | **REVIEW**: keep this work off `main` in that repo, or move it to a private repo before merging. |
