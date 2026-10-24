# Porchline — Product Requirements

**Status:** Hackathon PRD, v1  
**Event:** Boson AI hackathon  
**Angle:** Pricing. Show that a real local-business website can be produced from one live Boson phone call at a voice cost low enough to sell as a flat setup fee.  
**Repo:** `porchline`  
**Docs used:** [Boson overview](https://docs.boson.ai/overview), [Higgs Realtime](https://docs.boson.ai/models/higgs-realtime/overview), [connections and sessions](https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions), [audio and voices](https://docs.boson.ai/models/higgs-realtime/guides/audio-and-voices), [tool use](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling), [Pipecat integration](https://docs.boson.ai/models/higgs-realtime/integrations/pipecat), [pricing](https://docs.boson.ai/pricing)

---

## 1. Summary

Porchline turns a phone conversation into a hosted website for a local business.

A business owner calls a Porchline number, or an operator starts the call for them. **Higgs Realtime** (`higgs-realtime`) runs the conversation: it asks for the facts a simple site needs, confirms them out loud, and writes them through tools. When the owner says the profile is right, Porchline generates a one-page site, deploys it to **Netlify or Vercel**, and shows the exact **CNAME** record to add so a subdomain points at that deploy.

The operator already controls DNS. Hackathon v1 does not buy domains and does not log into a registrar. It produces the host, record type, and target, then checks that the subdomain resolves.

**One-line pitch:** A local shop talks to Boson for ten minutes and gets a website on their subdomain, for pennies of voice API.

---

## 2. Problem

Most local businesses — barbers, restaurants, repair shops, tutors, clinics, food trucks — still do not have a usable site. The blocker is not design taste. It is the intake:

- Owners will not fill a long form.
- They will answer a phone call while they are at the shop.
- Agencies charge hundreds of dollars and take days to collect the same facts: name, what they sell, hours, address, phone, a short story, and a few services.
- After the site exists, attaching a subdomain is a separate technical step that owners abandon.

Porchline collapses intake, generation, hosting, and the DNS instruction into one flow the owner can finish by talking.

---

## 3. Why Boson, and why pricing

Boson exposes three APIs. Porchline uses them like this:

| API | Role in Porchline | Hackathon |
| --- | --- | --- |
| **Higgs Realtime** | The phone agent. Listens and speaks in one session, barge-in, tool calls, optional live transcript via `higgs-stt-3.1`. | Required. This is the product. |
| **Higgs TTS 3** | Optional later: a spoken “your site is live” voicemail, or a preview clip on the generated site. | Out of the demo path. |
| **Higgs Avatar** | Optional later: a talking-head explainer. Not needed to ship a website. | Out of scope. |

Higgs Realtime details that the build depends on:

- Endpoint: `wss://api.boson.ai/v1/realtime?model=higgs-realtime`
- Auth stays on the server: `Authorization: Bearer <BOSON_API_KEY>`. Browser clients, if any, get a short-lived key from `POST /v1/realtime/client_secrets`.
- Phone audio: `audio/pcmu` (G.711 μ-law) at **8000 Hz** is a supported input and output format. That matches common telephony media streams, so the bridge does not resample.
- Turn-taking: `server_vad` or `semantic_vad`, with barge-in. The owner can interrupt.
- Tools: the app declares JSON-schema functions. The model calls them. The server runs them and returns `function_call_output`, then `response.create`.
- Transcription: set `audio.input.transcription.model` to `higgs-stt-3.1` so the dashboard can show what the owner said.
- Pipecat: `pipecat-boson` exposes Higgs as a speech-to-speech service. Do not wrap it in a separate STT plus TTS pair. LiveKit’s first-party Higgs plugin is not ready; do not block on it.
- Trial: new accounts get **$10** free credit after it is claimed. Calls fail with insufficient quota until that credit exists.

### Boson cost of one intake

Rates from [docs.boson.ai/pricing](https://docs.boson.ai/pricing). Audio figures are Boson’s per-minute estimates. Real bills are token-based. Transcription is extra when enabled.

Assume a 10-minute call where the owner speaks about 6 minutes and the agent speaks about 4 minutes:

| Line | Rate | Quantity | Cost |
| --- | --- | --- | --- |
| Audio in | $0.0023 / min | 6 min | $0.014 |
| Audio out | $0.014 / min | 4 min | $0.056 |
| Transcription in | $0.0025 / min | 6 min | $0.015 |
| Tokens (rough) | input $0.75 / 1M, output $4.50 / 1M | short tool-heavy call | ~$0.05–$0.15 |
| **Boson total** | | | **about $0.15–$0.25** |

A 20-minute messy call still lands around **$0.40–$0.60**. Hosting a static one-page site on Netlify or Vercel hobby/free tiers is $0 at hackathon volume. Domain registration is the owner’s existing domain; Porchline only needs a CNAME.

### Product price this justifies

| Offer | Price | Gross after one Boson call | Who it is for |
| --- | --- | --- | --- |
| Hackathon demo | $0 | Trial credit covers many calls ($10 / ~$0.25 ≈ 40 intakes) | Judges and one live shop |
| Setup | **$49 once** | About $48.75 before telephony minutes | A shop that wants a page this week |
| Care | **$12 / month** | Updates by calling back (“change Saturday hours”) | Shops that will edit by phone |

Telephony (the phone number and per-minute carrier) is the cost that can exceed Boson. The PRD treats carrier minutes as a separate line, budgeted at roughly $0.01–$0.02 per minute inbound, still small next to $49.

**Hackathon claim:** the expensive part of a small-business website was the interview. Boson’s price makes that interview cheap enough to give the site away in the demo and still have a real business underneath.

---

## 4. Users

**Owner.** A local operator. They can take a phone call. They may not want to type. They know their hours, services, and neighborhood. They can say yes or no when the agent reads the profile back.

**Operator (hackathon user).** You. You start or receive the call, watch the profile fill in, approve generation, deploy, and paste the CNAME into DNS for the subdomain.

**Visitor.** A customer who opens the subdomain and needs hours, address, phone, and what the business does. They do not use Porchline itself.

Out of v1: a self-serve owner dashboard, multi-staff logins, and online payments.

---

## 5. Product principles

1. **Talking is the form.** Every required field has a spoken question and a tool that stores the answer. There is no parallel form the owner must finish.
2. **Confirm before publish.** The agent reads a short summary. The site deploys only after an explicit yes, stored as a tool result.
3. **One page, done.** A single fast page beats a half-built multi-page site.
4. **DNS stays manual.** The product prints the CNAME. A person edits the record. The product then checks it.
5. **Boson stays on the voice path.** Website copy can be drafted by a text model from the saved profile. The live call is Higgs Realtime only, so the demo is obviously a Boson product.
6. **Keys never reach the phone or the browser.** `BOSON_API_KEY`, Netlify, and Vercel tokens live on the server.

---

## 6. End-to-end flow

```text
Owner calls Porchline number
        │
        ▼
Telephony media stream (μ-law 8 kHz)
        │
        ▼
Pipecat bridge  ──WebSocket──►  Higgs Realtime
        │                         instructions + tools
        │                         higgs-stt-3.1 transcripts
        ▼
Business profile (saved field by field)
        │
        ▼
Owner hears the summary and says yes
        │
        ▼
Site generator fills a one-page template
        │
        ▼
Deploy to Netlify or Vercel
        │
        ▼
Show CNAME:  shop.example.com  →  <deploy host>
        │
        ▼
Operator edits DNS
        │
        ▼
Porchline polls until the subdomain answers, then marks the site live
```

### Call script (required beats)

The agent keeps questions short. It accepts barge-in. It does not ask for anything the page cannot show.

1. Greeting. Name Porchline. Say the call will build their website and take about ten minutes.
2. Business name, and how they say it.
3. Category in plain words (barber, lunch counter, plumber).
4. One or two sentences: what a new customer should know.
5. City and neighborhood, then street address if they want it public. They may say “no address, phone only.”
6. Public phone and, if they want it, email.
7. Hours. Day by day is fine. “Closed Sunday” is a valid answer.
8. Up to six services or menu items, each with an optional price said out loud.
9. One thing they are proud of, or a note for the page (parking, walk-ins, languages).
10. Preferred subdomain label, such as `rose-barber`. The agent repeats the full hostname it will recommend.
11. Read-back. The agent summarizes name, what they do, where, hours, and how to contact them.
12. Ask: “Should I publish this?” Only a clear yes triggers `publish_profile`.
13. After tools return, tell them the temporary host and that the subdomain goes live once the CNAME is saved. Do not claim the custom domain works before DNS verifies.

If the owner is unsure, the agent saves a draft and says they can call back. It does not invent hours, prices, or reviews.

---

## 7. Scope

### In scope for the hackathon

- One inbound phone number bridged to Higgs Realtime.
- A dashboard the operator watches during the call: live transcript, profile fields as tools fill them, call status, Boson session errors.
- Structured profile with the fields in section 8.
- Confirmation gate before publish.
- One-page site from a fixed template: hero, about, services, hours, location or service area, click-to-call.
- Deploy to one host. Support both Netlify and Vercel behind one interface, and pick one as the demo default.
- After deploy: show the preview URL and the CNAME row (host, type, target).
- A “check DNS” action that reports whether the subdomain points at the deploy.
- A second short call, or the tail of the same call, that can update hours or the phone number and redeploy.
- Cost panel on the dashboard: estimated Boson minutes and estimated dollars for the call, using the published rates, labeled as estimates.

### Out of scope

- Buying or transferring domains.
- Automated edits inside a registrar. The operator pastes the CNAME.
- Online ordering, booking payments, or accounts for the shop’s customers.
- Multi-page sites, blogs, or a visual editor.
- Higgs Avatar on the marketing site.
- Cloning the owner’s voice. Use the `default` Realtime voice unless a preset is chosen before the demo.
- A public self-serve signup. The hackathon operator places or receives the call.

---

## 8. Business profile

Stored as JSON. Tools write one concern at a time so a dropped call still keeps partial data.

| Field | Required to publish | Notes |
| --- | --- | --- |
| `businessName` | Yes | Spoken name and display name |
| `category` | Yes | Short label |
| `summary` | Yes | One or two sentences, owner’s words cleaned lightly |
| `phone` | Yes | Public number, not always the number they called from |
| `email` | No | |
| `address` | No | Nullable when they refuse a public address |
| `serviceArea` | No | Used when there is no address |
| `hours` | Yes | Seven days; each day open intervals or closed |
| `services` | Yes | 1–6 items; `name`, optional `priceLabel`, optional `blurb` |
| `highlight` | No | Parking, walk-ins, languages |
| `subdomainLabel` | Yes | Lowercase slug. Operator confirms the parent domain separately |
| `confirmed` | Yes | True only after spoken yes |
| `sourceCallId` | Yes | Ties the profile to the telephony call and Boson session |

The parent domain (for example `example.com`) is operator configuration, not something the model invents. The spoken label becomes `rose-barber.example.com`.

---

## 9. Voice agent requirements

**FR-1.** Opening a call opens one Higgs Realtime session with `model: higgs-realtime`, server-side bearer auth, `audio/pcmu` at 8000 Hz in both directions, `server_vad` or `semantic_vad`, voice `default`, and input transcription `higgs-stt-3.1` with a language hint.

**FR-2.** System instructions tell the agent it is Porchline, it only collects website facts, it must not invent business facts, it must use tools to save answers, and it must not publish without a spoken confirmation.

**FR-3.** Tools available to the model:

| Tool | Purpose |
| --- | --- |
| `save_business_basics` | Name, category, summary |
| `save_contact` | Phone, email, address or service area |
| `save_hours` | Weekly hours |
| `add_service` | One service or menu item |
| `set_subdomain_label` | Slug only. Server checks it is a valid hostname label |
| `read_profile` | Returns the current profile so the read-back matches stored data, not memory |
| `publish_profile` | Sets `confirmed` if required fields exist. Refuses when they do not, and tells the model which fields are missing |

**FR-4.** Tool calls follow Boson’s contract: on `response.done` with a `function_call` item, the server executes, sends `conversation.item.create` with `function_call_output` and the same `call_id`, then `response.create`.

**FR-5.** The owner can interrupt. Playback stops. The next user turn is what gets answered.

**FR-6.** A disconnect keeps the draft. Calling back with the same owner phone loads the draft and the agent offers to continue.

**FR-7.** The agent speaks prices and hours back in words before saving, when the value is easy to mishear (“Did you say eighteen dollars?”).

**FR-8.** Profanity, medical claims, or “make up reviews” are refused. The site never includes testimonials the owner did not supply, and v1 does not include a review section at all.

**FR-9.** Session errors surface in the dashboard. Close code `4429` or an insufficient-quota error shows “Boson credit exhausted” and does not pretend the call succeeded. Close code `3000` shows an auth problem. `1013` shows concurrency and a retry.

---

## 10. Site requirements

**FR-10.** The generator takes only the confirmed profile. It does not read the raw transcript for facts that tools did not save.

**FR-11.** The page includes:

- Business name and category
- Summary
- Services, with price text when present
- Hours
- Address or service area
- Click-to-call using the public phone
- Email link when present
- A one-line footer: built with Porchline

**FR-12.** The page is static, responsive, and readable on a phone. No account, no cookie banner beyond what the host injects, no third-party tracker in v1.

**FR-13.** Copy edits are limited to light cleanup (capitalization, spelling of words the transcript already captured). The generator must not add services, awards, or years in business.

**FR-14.** Visual system is one template with a small set of category accents (food, personal care, home services, other). Hackathon v1 can ship a single accent if time is short. The requirement is a finished page, not a theme picker.

**FR-15.** Regenerating after a profile update replaces the deploy. The subdomain CNAME target stays stable if the host allows it. If a new deploy would change the CNAME target, the dashboard says so before publishing.

---

## 11. Hosting and the CNAME

The operator chooses the host per project: **Netlify** or **Vercel**. Both must be able to:

1. Create a site from the generated files.
2. Return a preview hostname (`*.netlify.app` or `*.vercel.app`).
3. Accept a custom hostname for the subdomain.
4. Tell Porchline the CNAME target the DNS record must use.

**FR-16.** After a successful deploy the dashboard shows:

| Column | Example |
| --- | --- |
| Hostname | `rose-barber.example.com` |
| Type | `CNAME` |
| Value | the host-specific target |
| Preview | `https://porchline-rose-barber.netlify.app` |

**FR-17.** Instructions on that screen are literal: open the DNS host, add this record on the subdomain, do not replace the root apex unless they mean to, wait for the check.

**FR-18.** “Check DNS” resolves the subdomain and reports one of: not found yet, CNAME points somewhere else, CNAME matches, HTTPS ready. It does not claim success on the preview URL alone.

**FR-19.** Secrets for Netlify and Vercel are environment variables. They are never written into the generated site.

**FR-20.** The generated site repo or file bundle is kept with the profile so a later hours change can redeploy without another full interview.

Apex domains (`example.com` without a subdomain) are out of scope. Those often need A/ALIAS records, and the operator said the edit is a CNAME on a subdomain.

---

## 12. Operator dashboard

One screen is enough.

- Start state: “waiting for a call,” the Porchline number, and remaining story: draft, confirmed, deployed, DNS checked.
- During the call: transcript lines, profile card updating as tools succeed, and a timer.
- After confirm: Generate, then Deploy. Generate can be automatic on `publish_profile` for the demo if a manual button is safer for the first run. Default for the demo: automatic generate and deploy on confirm, with a visible cancel while generation is in progress.
- After deploy: preview link, CNAME table, Check DNS button.
- Cost strip: duration, estimated Boson dollars, note that carrier minutes are separate.

The dashboard is for the operator. The owner’s interface is the phone.

---

## 13. Architecture

```text
┌──────────────────┐     μ-law 8 kHz      ┌─────────────────────┐
│ Phone (owner)    │ ◄──────────────────► │ Telephony provider  │
└──────────────────┘                      └──────────┬──────────┘
                                                     │ media stream
                                                     ▼
┌──────────────────┐   profile + status   ┌─────────────────────┐
│ Operator web app │ ◄──────────────────► │ Porchline server    │
└──────────────────┘                      │                     │
                                          │  Pipecat +          │
                                          │  pipecat-boson      │
                                          │  Higgs Realtime     │
                                          │  profile store      │
                                          │  site generator     │
                                          │  Netlify or Vercel  │
                                          └──────────┬──────────┘
                                                     │
                                                     ▼
                                          static site on subdomain
```

Suggested hackathon split:

| Piece | Choice | Why |
| --- | --- | --- |
| Voice | Python, Pipecat, `pipecat-boson`, `BosonRealtimeLLMService` | Official Boson path. Handles audio, tools, and transcripts. |
| Phone | A provider with a WebSocket media stream in G.711 μ-law | Matches `audio/pcmu` at 8000 Hz. |
| API and dashboard | Small TypeScript app | Deploy status, CNAME card, DNS check. |
| Site output | Static HTML or a tiny static export | Fast hosting, nothing to keep running per shop. |
| Store | SQLite or a single JSON file per call for the demo | Enough for one shop live and a few rehearsals. |
| Host | Netlify as the demo default, Vercel behind the same deployer interface | Both accept custom domains via CNAME. |

Environment the server needs:

- `BOSON_API_KEY`
- `BOSON_REALTIME_URL` = `wss://api.boson.ai/v1/realtime/`
- `BOSON_REALTIME_MODEL` = `higgs-realtime`
- Telephony credentials for the media stream
- `NETLIFY_AUTH_TOKEN` or `VERCEL_TOKEN`
- `PORCHLINE_PARENT_DOMAIN` — the domain whose subdomain gets the CNAME
- `PORCHLINE_HOST` — `netlify` or `vercel`

---

## 14. Demo script for judges

Target length: 4 minutes on stage, 10 minutes on the phone if they want the full interview.

1. Open the dashboard. Show the number and a $10-credit framing: “this call should cost under a quarter.”
2. Call from a phone. Let Higgs greet in `default` voice.
3. Answer as a real shop. Example: “Rose Street Barber, haircuts and beard trims, Queen Street, Tuesday to Saturday 10 to 6, closed Sunday and Monday, haircut 28 dollars.”
4. Interrupt once, so barge-in is visible.
5. Let the agent read the profile back. Say yes.
6. Dashboard flips to deployed. Open the `*.netlify.app` or `*.vercel.app` preview on a phone-sized window.
7. Show the CNAME row. If DNS was prepared before the talk, click Check DNS and open `https://<slug>.<parent-domain>`.
8. End on the cost strip.

Rehearse the CNAME before the demo. DNS propagation is the only step that can miss a live window. The preview URL is the fallback that still proves the site exists.

---

## 15. Success criteria

The hackathon build is done when all of these are true:

1. A real phone call is answered by Higgs Realtime, not by a text bot with a separate TTS pass.
2. At least one complete profile is stored only through tool calls.
3. Saying yes publishes; saying “not yet” does not.
4. A preview URL loads the owner’s name, hours, and phone.
5. The dashboard prints a correct CNAME for the chosen host.
6. Either the subdomain loads after the record is saved, or Check DNS correctly reports that it is not ready.
7. The cost strip shows an estimate using Boson’s published audio rates, and a rehearsed call estimates under **$0.50**.

---

## 16. Risks

| Risk | What we do |
| --- | --- |
| Free trial credit not claimed, or exhausted | Check workspace billing before the demo. Surface `4429` and quota errors in the UI. |
| Phone audio format mismatch | Lock the session to `audio/pcmu` at 8000 Hz. Do not send 24 kHz PCM into an 8 kHz stream. |
| Model publishes too early | `publish_profile` checks required fields and a confirmation flag the server sets only from an explicit tool call after the read-back. Instructions alone are not the gate. |
| Misheard prices | Confirm money and hours in a follow-up utterance before the tool writes them. |
| DNS not ready on stage | Treat the host preview URL as the proof. Attach the subdomain in a rehearsal. |
| CNAME target changes between deploys | Prefer a stable site identity on the host. Warn if the target would change. |
| LiveKit temptation | Docs say a first-party LiveKit plugin is not ready. Use Pipecat or a direct WebSocket. |
| Scope creep into a website builder | One template. No editor in v1. |

---

## 17. Later, if the hackathon works

- Call-back edits as the only CMS: “We’re closed next Monday.”
- Higgs TTS 3 for an after-call text-message audio preview.
- Owner-facing link to approve the page visually before the CNAME is advertised.
- More than one subdomain per operator account.
- A public price: $49 setup, $12 a month for phone updates, with Boson plus carrier cost shown internally so margin stays obvious.

---

## 18. Resolved choices

These are decided for the build unless you change them:

| Choice | Decision |
| --- | --- |
| Product name | **Porchline** |
| Boson surface | Higgs Realtime for the call. TTS and Avatar stay out of v1. |
| Voice stack | Pipecat with `pipecat-boson` |
| Audio | G.711 μ-law, 8000 Hz |
| Site | One static page from the confirmed profile |
| Hosts | Netlify and Vercel, Netlify as the demo default |
| Domain | Operator edits a CNAME on a subdomain. No registrar automation. |
| Price story | Under about $0.25 of Boson per normal intake. Sell setup at $49, or run the demo free on trial credit. |
