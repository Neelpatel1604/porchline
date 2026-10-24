# Porchline — Product Requirements

**Status:** Hackathon PRD, v3  
**Event:** Boson AI hackathon  
**Repo:** `porchline`  
**Voice:** Higgs Realtime through Pipecat  
**Apps:** Python voice service + Next.js operator app

This document is the build spec. It names the stack, the repo layout, and the order we develop in.

---

## 1. Summary

Porchline turns a phone conversation into a hosted website for a local business.

A business owner calls a Porchline number. **Higgs Realtime** interviews them, and tools save a structured profile. When the owner confirms, the operator app renders a one-page static site, deploys it to **Netlify**, and creates the subdomain **CNAME** in **Cloudflare**.

The parent domain is `PORCHLINE_PARENT_DOMAIN` in the environment. That zone already lives in Cloudflare. v1 does not buy or transfer domains, and it does not change the zone apex.

**One-line pitch:** A local shop talks for about ten minutes and gets a website on their subdomain.

---

## 2. Problem

Most local businesses — barbers, restaurants, repair shops, tutors, clinics, food trucks — still do not have a usable site. The blocker is intake:

- Owners will not fill a long form.
- They will answer a phone call while they are at the shop.
- The facts a simple page needs are the same every time: name, what they sell, hours, address, phone, a short story, and a few services.
- After the site exists, attaching a subdomain is a separate step that gets dropped.

Porchline collapses intake, generation, hosting, and the DNS instruction into one flow the owner can finish by talking.

---

## 3. Users

**Owner.** Takes the phone call. Knows the hours, services, and neighborhood. Says yes or no when the agent reads the profile back.

**Operator.** Runs the dashboard during the hackathon. Watches the profile fill in. Publish deploys to Netlify and writes the Cloudflare record. The operator steps in only if that write fails.

**Visitor.** Opens the subdomain and needs hours, address, phone, and what the business does. They never see the dashboard.

Out of v1: owner logins, multi-staff accounts, and online payments.

---

## 4. Product principles

1. **Talking is the form.** Every required field has a spoken question and a tool that stores the answer.
2. **Confirm before publish.** The site deploys only after an explicit spoken yes, stored as a tool result.
3. **One page, done.** A single fast page. One template.
4. **One domain, one zone.** The parent domain comes from the environment. Subdomains are CNAME records in the Cloudflare zone for that domain. The apex record stays as it is.
5. **The phone call is Higgs Realtime only.** The site is rendered from the saved profile, not from a second voice model.
6. **Keys stay on the server.** `BOSON_API_KEY`, Twilio, Netlify, and Cloudflare tokens never ship to the browser or the generated site.

---

## 5. End-to-end flow

```text
Owner calls the Twilio number
        │
        ▼
Twilio Media Stream (μ-law 8 kHz)  →  FastAPI + Pipecat
        │
        ▼
Higgs Realtime session (tools + higgs-stt-3.1 transcripts)
        │
        ▼
SQLite profile, updated field by field
        │
        ▼
Dashboard (SSE) shows transcript + profile
        │
        ▼
Owner says yes  →  publish_profile
        │
        ▼
Voice service POSTs the profile to the Next.js publish route
        │
        ▼
Generator writes static HTML  →  Netlify deploy
        │
        ▼
Attach {slug}.{PORCHLINE_PARENT_DOMAIN} on that Netlify site
        │
        ▼
Upsert a DNS-only CNAME in the Cloudflare zone
        │
        ▼
Dashboard shows preview URL, hostname, and DNS check
```

### Call script

The agent keeps questions short and accepts barge-in. It does not ask for anything the page cannot show.

1. Greeting. Name Porchline. Say this call builds their website and takes about ten minutes.
2. Business name, and how they say it.
3. Category in plain words (barber, lunch counter, plumber).
4. One or two sentences a new customer should know.
5. City and neighborhood, then street address if they want it public. “No address, phone only” is valid.
6. Public phone and, if they want it, email.
7. Hours. “Closed Sunday” is a valid answer.
8. Up to six services or menu items, each with an optional spoken price.
9. One optional note (parking, walk-ins, languages).
10. Preferred subdomain label, such as `rose-barber`. Repeat the full hostname.
11. Read-back from `read_profile`, not from memory.
12. “Should I publish this?” Only a clear yes calls `publish_profile`.
13. After publish, tell them the site is going live at `{slug}.{PORCHLINE_PARENT_DOMAIN}`. Speak the preview host if the subdomain is not HTTPS-ready yet.

If they are unsure, keep the draft and say they can call back. Do not invent hours, prices, or reviews.

---

## 6. Scope

### In the hackathon

- One inbound Twilio number bridged to Higgs Realtime.
- Operator dashboard: live transcript, profile fields, call status, session errors.
- Structured profile (section 7).
- Confirmation gate before publish.
- One static page: hero, about, services, hours, location or service area, click-to-call.
- Netlify deploy of the static page, reusing one Netlify site per project.
- Cloudflare DNS write: one CNAME from `{subdomainLabel}.{PORCHLINE_PARENT_DOMAIN}` to that Netlify site. Proxy stays off.
- Preview URL, hostname, and a DNS check on the dashboard.
- A later call from the same number reloads the draft and can change hours or the public phone, then redeploy.

### Out of scope

- Buying or transferring domains. The Cloudflare zone and the parent domain already exist.
- Apex records, redirects, and any record other than the one shop subdomain.
- A second host. Netlify is the only deploy target.
- Ordering, bookings, payments, blogs, a visual editor, or multi-page sites.
- Higgs TTS 3 and Higgs Avatar.
- Voice cloning. The session voice is `default`.
- Public self-serve signup.

---

## 7. Business profile

Stored as JSON. Tools write one concern at a time so a dropped call keeps partial data.

| Field | Required to publish | Notes |
| --- | --- | --- |
| `businessName` | Yes | Spoken name and display name |
| `category` | Yes | Short label. One of `food`, `personal_care`, `home_services`, `other` when the agent can tell; otherwise `other` |
| `summary` | Yes | One or two sentences |
| `phone` | Yes | Public number. It can differ from caller ID |
| `email` | No | |
| `address` | No | Null when they refuse a public address |
| `serviceArea` | No | Used when there is no address |
| `hours` | Yes | Seven days. Each day is open intervals or closed |
| `services` | Yes | 1–6 items: `name`, optional `priceLabel`, optional `blurb` |
| `highlight` | No | Parking, walk-ins, languages |
| `subdomainLabel` | Yes | Lowercase hostname label |
| `confirmed` | Yes | True only after spoken yes |
| `sourceCallId` | Yes | Twilio call SID |

The parent domain comes from `PORCHLINE_PARENT_DOMAIN` (for example `example.com`). The spoken label becomes `rose-barber.example.com`. The model never invents the parent domain. Cloudflare must already be authoritative for that zone.

The contract lives in `packages/profile.schema.json`. Python validates with Pydantic. The Next.js app validates with Zod. Both load that same file. A field that is not in the schema is not on the website.

---

## 8. Voice agent requirements

**FR-1.** A call opens one Higgs session: `model: higgs-realtime`, server-side bearer auth, `semantic_vad`, voice `default`, and input transcription `higgs-stt-3.1` with `language: en`. `pipecat-boson` uses 24 kHz PCM. Twilio still delivers 8 kHz μ-law, and `TwilioFrameSerializer` converts it.

**FR-2.** Instructions say the agent is Porchline, it only collects website facts, it must not invent business facts, it must save through tools, and it must not publish without a spoken confirmation.

**FR-3.** Tools:

| Tool | Purpose |
| --- | --- |
| `save_business_basics` | Name, category, summary |
| `save_contact` | Phone, email, address or service area |
| `save_hours` | Weekly hours |
| `add_service` | One service. Reject the 7th |
| `set_subdomain_label` | Slug. Server checks it is one hostname label |
| `read_profile` | Current stored profile for the read-back |
| `publish_profile` | Sets `confirmed` only when required fields exist. Returns the missing field names otherwise |

**FR-4.** Tool calls follow the Higgs contract. On `response.done` with a `function_call`, the server runs it, sends `function_call_output` with the same `call_id`, then `response.create`. Pipecat’s function-call path is the implementation of that contract.

**FR-5.** Barge-in stops playback. The next user turn is the one that gets answered.

**FR-6.** A disconnect keeps the draft. The next call from the same caller ID loads it and offers to continue.

**FR-7.** Prices and hours are repeated in words before the tool writes them.

**FR-8.** The agent refuses invented reviews, medical claims, and requests to fake credentials. v1 has no review section.

**FR-9.** Session errors show on the dashboard. `4429` or insufficient quota shows “Boson credit exhausted.” `3000` shows an auth problem. `1013` shows concurrency and a retry.

---

## 9. Site requirements

**FR-10.** The generator reads only the confirmed profile. It does not mine the transcript.

**FR-11.** The page shows business name, category, summary, services with price text when present, hours, address or service area, click-to-call, email when present, and a footer line “Built with Porchline.”

**FR-12.** Static HTML and CSS. Responsive. No account, no tracker, no JavaScript required to read the page.

**FR-13.** Copy cleanup is capitalization and obvious transcript spelling. The generator does not add services, awards, or years in business.

**FR-14.** One template. Category changes a single accent color: food, personal care, home services, other. Shipping one accent is acceptable if the rest of the demo is done.

**FR-15.** A profile update redeploys the same Netlify site and updates the same Cloudflare CNAME. The record name does not change unless the subdomain label changes. A label change creates a new name and leaves the old record in place until the operator deletes it.

---

## 10. Hosting and DNS

Netlify hosts the files. Cloudflare hosts the DNS for the parent domain. Both calls happen from `apps/web` during publish.

Publish order:

1. Render the static files.
2. Create a Netlify site on first publish, or reuse the site id stored for this project.
3. Deploy the files. Keep the `*.netlify.app` hostname as the preview.
4. Add `{subdomainLabel}.{PORCHLINE_PARENT_DOMAIN}` as a custom domain on that Netlify site.
5. Upsert a Cloudflare CNAME in `CLOUDFLARE_ZONE_ID`:
   - name: the subdomain label
   - target: the Netlify site hostname (`<site>.netlify.app`)
   - proxy: off (DNS only)
   - TTL: auto
6. If a CNAME with that name already exists, update its target. Do not create a second record. Do not edit any other record in the zone.
7. Check DNS, then report HTTPS once the hostname answers.

The Cloudflare record stays DNS-only so Netlify can issue the certificate. An orange-cloud proxied record is a failed publish, and the dashboard says to turn the proxy off.

**FR-16.** After deploy the dashboard shows:

| Column | Example |
| --- | --- |
| Hostname | `rose-barber.example.com` |
| DNS | Cloudflare CNAME, proxy off |
| Target | `porchline-rose-barber.netlify.app` |
| Preview | `https://porchline-rose-barber.netlify.app` |
| Parent domain | value of `PORCHLINE_PARENT_DOMAIN` |

**FR-17.** The app writes that CNAME. The dashboard shows the record it wrote. It does not ask the operator to paste DNS unless the Cloudflare call failed.

**FR-18.** Check DNS reports one of: not found yet, CNAME points somewhere else, CNAME matches, HTTPS ready. The preview URL loading is not treated as the custom domain being ready.

**FR-19.** `NETLIFY_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `PORCHLINE_PARENT_DOMAIN` are environment variables. They are not written into the generated files.

**FR-20.** The generated file bundle is stored next to the profile (`data/sites/<project-id>/`) so an hours change redeploys without another full interview. The Netlify site id and the Cloudflare record id are stored on the project.

---

## 11. Operator dashboard

One screen.

- Waiting: the Twilio number, and the project state (`draft`, `confirmed`, `deployed`, `dns_ready`).
- During the call: transcript, profile card, timer.
- On confirm: publish runs automatically. The screen shows progress and a cancel control until the deploy returns.
- After deploy: preview link, the Cloudflare record, and Check DNS.
- Errors from Higgs, Twilio, Netlify, and Cloudflare stay on this screen in plain language.

The owner’s interface is the phone.

---

## 12. Stack

Two processes. Python owns the live call. Next.js owns the dashboard, the HTML, and deploys. They share one JSON schema and talk over localhost HTTP.

| Layer | Choice | Role |
| --- | --- | --- |
| Language, voice | Python 3.11 | Pipecat and `pipecat-boson` are Python |
| Voice HTTP | FastAPI + Uvicorn | Twilio webhooks, media-stream WebSocket, SSE, profile API |
| Agent | Pipecat pipeline + `pipecat-boson` `BosonRealtimeLLMService` | Speech-to-speech. No separate STT or TTS stage around Higgs |
| Model | `higgs-realtime` at `wss://api.boson.ai/v1/realtime/` | The only model on the call |
| Transcript | `higgs-stt-3.1` on session input | Dashboard text. The model still understands audio if this is off |
| Phone | Twilio Programmable Voice + Media Streams | Inbound call, μ-law 8 kHz, converted to 24 kHz PCM for Higgs |
| Tunnel, local only | Cloudflare Tunnel (`cloudflared`) | Gives Twilio a public `wss` URL while we develop. This is not the DNS zone. |
| Language, web | TypeScript on Node 20 | Dashboard, generator, deployers |
| Web app | Next.js (App Router) + React | One operator screen and the publish/DNS routes |
| Styling, dashboard | Tailwind CSS | Operator UI only. The customer site is plain CSS |
| Styling, customer site | One HTML file + one CSS file | What gets deployed |
| Profile contract | `packages/profile.schema.json` | Shared by Pydantic and Zod |
| Database | SQLite file `data/porchline.db` | Projects, transcripts, deploy rows. Voice service owns the file |
| Python DB access | `sqlite3` in the standard library | No ORM for v1 |
| Deploy | Netlify REST API | The only host. Create the site, upload the bundle, attach the custom hostname |
| DNS | Cloudflare DNS API | Upsert one DNS-only CNAME on the zone for `PORCHLINE_PARENT_DOMAIN` |
| DNS check | Node `dns.promises.resolveCname`, then an HTTPS HEAD | Runs in the Next.js route |
| Live UI | SSE from FastAPI | Transcript lines and profile patches |
| Package manager, JS | npm | `apps/web` |
| Package manager, Python | `venv` + pip | `services/voice` |
| Config | `.env` at the repo root, loaded by both apps | Never committed. `.env.example` lists every key |

We do not add LiveKit, a second LLM on the call, Redis, Postgres, Docker, or a monorepo build tool. Two folders and two start commands are the whole platform.

### Who owns what

| Concern | Owner |
| --- | --- |
| Twilio signature check, TwiML, media stream | `services/voice` |
| Higgs session, tools, transcripts | `services/voice` |
| SQLite | `services/voice` |
| HTML render | `apps/web` |
| Netlify deploy and custom domain | `apps/web` |
| Cloudflare CNAME upsert and DNS check | `apps/web` |
| Operator screen | `apps/web` |

### HTTP between the two apps

Voice is the source of truth for the call. Web is the source of truth for the deploy.

| Call | From | To | When |
| --- | --- | --- | --- |
| `GET /projects/current` | Web | Voice | Dashboard load |
| `GET /projects/{id}/stream` | Web (EventSource) | Voice | SSE: `transcript`, `profile`, `status`, `error` |
| `POST /internal/publish` | Voice | Web | `publish_profile` succeeded |
| `POST /internal/deploy-result` | Web | Voice | Deploy finished or failed, so the call can speak the preview host |
| `POST /api/dns-check` | Dashboard | Web | Operator clicks Check DNS |

`/internal/*` routes require `INTERNAL_SHARED_SECRET`. The browser never calls them.

`POST /internal/publish` body is the profile JSON plus `projectId`. The web app refuses it when `confirmed` is not true. Response is `{ previewUrl, hostname, cnameTarget, cloudflareRecordId, status }`.

### Twilio call path

1. Twilio number voice webhook: `POST /twilio/voice`.
2. Response is TwiML: `<Connect><Stream url="wss://<public-host>/twilio/stream"/></Connect>`.
3. Pipecat Twilio serializer reads the media stream.
4. Pipeline: transport input → context aggregator → `BosonRealtimeLLMService` → transport output → assistant aggregator.
5. `realtime_service_mode` stays on. No extra STT or TTS processors.

### Higgs session settings

Set once in `session.update` through `BosonRealtimeLLMService`:

- `model`: `higgs-realtime`
- `voice`: `default`
- audio format: 24 kHz PCM, which is what `pipecat-boson` sends. Twilio’s 8 kHz μ-law is converted at the serializer.
- turn detection: `semantic_vad`
- input transcription: `{ "model": "higgs-stt-3.1", "language": "en" }`
- tools: the seven functions in FR-3
- instructions: the call script in section 5

Auth header on the server WebSocket: `Authorization: Bearer <BOSON_API_KEY>`.

### Environment

Voice reads:

- `BOSON_API_KEY`
- `BOSON_REALTIME_URL` = `wss://api.boson.ai/v1/realtime/`
- `BOSON_REALTIME_MODEL` = `higgs-realtime`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `PUBLIC_VOICE_WSS_URL` — the tunnel URL Twilio streams to
- `WEB_BASE_URL` = `http://localhost:3000` in dev
- `INTERNAL_SHARED_SECRET`
- `DATABASE_PATH` = `data/porchline.db`

Web reads:

- `VOICE_BASE_URL` = `http://localhost:8000` in dev
- `INTERNAL_SHARED_SECRET` — same value as voice
- `PORCHLINE_PARENT_DOMAIN` — the zone apex, such as `example.com`. Subdomains are `{label}.{PORCHLINE_PARENT_DOMAIN}`
- `NETLIFY_AUTH_TOKEN`
- `CLOUDFLARE_API_TOKEN` — permission to edit DNS on this zone only
- `CLOUDFLARE_ZONE_ID` — the zone id for `PORCHLINE_PARENT_DOMAIN`

Web startup fails if any of those four are missing. The voice service does not read the Netlify or Cloudflare keys.

---

## 13. Repository layout

```text
porchline/
  apps/web/                         Next.js operator app
    src/app/page.tsx                dashboard
    src/app/api/dns-check/route.ts
    src/app/internal/publish/route.ts
    src/generator/render.ts         profile JSON → HTML + CSS
    src/generator/template.css
    src/deploy/netlify.ts           create site, deploy files, attach hostname
    src/dns/cloudflare.ts           upsert the DNS-only CNAME
    src/profile/schema.ts           Zod from the shared JSON schema
  services/voice/
    pyproject.toml
    porchline_voice/main.py         FastAPI app
    porchline_voice/twilio.py       TwiML + media stream
    porchline_voice/agent.py        Pipecat pipeline + Higgs
    porchline_voice/tools.py        the seven tools
    porchline_voice/store.py        SQLite
    porchline_voice/events.py       SSE hub
  packages/profile.schema.json
  fixtures/rose-barber.json         complete confirmed profile for dev
  data/                             gitignored: sqlite + generated sites
  docs/PRD.md
  .env.example
  .gitignore
  README.md
```

`fixtures/rose-barber.json` is the stand-in for a finished call. Phases 1 and 2 have to work with that file before Twilio or Higgs is wired.

---

## 14. Development plan

Build in vertical slices. Each phase has a demo that does not need the later phases. Do not start Twilio until a fixture profile can already become a hosted page.

Work happens on `main`. One phase, one commit, when that phase’s check passes.

### Phase 0 — Boots

Create the two app folders, `.env.example`, and gitignore entries for `.env`, `data/`, and `apps/web/.next`.

Done when:

- `uvicorn` serves `GET /health` on port 8000.
- `next dev` serves the dashboard shell on port 3000.
- The dashboard shell fetches `GET /projects/current` and renders an empty state when voice says there is no project.

### Phase 1 — Profile and page, no network hosts

Implement the JSON schema, the Zod and Pydantic models, and `render.ts`. Add a dev route `GET /preview/fixture` that renders `fixtures/rose-barber.json` as HTML.

Done when:

- The fixture page shows name, hours, services, and click-to-call in a phone-width browser.
- An incomplete fixture (delete `hours`) fails validation and does not render.
- `publish_profile`’s validation function, called in a unit test, rejects a profile that is missing a required field or has `confirmed: false`.

### Phase 2 — Netlify and Cloudflare, still no phone

`POST /internal/publish` accepts the fixture, writes `data/sites/<id>/`, deploys to Netlify, attaches `{slug}.{PORCHLINE_PARENT_DOMAIN}`, and upserts the Cloudflare CNAME. The dashboard gets a temporary “Deploy fixture” button so we can test this without a call. That button is removed in phase 5.

Done when:

- The fixture is live on a `*.netlify.app` URL.
- Cloudflare shows one DNS-only CNAME for that subdomain, pointed at the Netlify hostname.
- The apex record in the zone is unchanged.
- A second deploy of the same `projectId` reuses the Netlify site and updates that same Cloudflare record.
- Check DNS reports “CNAME matches” for the hostname, then “HTTPS ready” once Netlify’s certificate is up.

### Phase 3 — Higgs without Twilio

Add a local Pipecat WebSocket endpoint `WS /dev/stream` that takes PCM or μ-law from a small browser mic page at `/dev/call`. This page is for us, not for the shop owner. Tools write SQLite. SSE updates the dashboard.

Done when:

- Speaking to the mic creates a draft project.
- Each tool updates the profile card.
- Hanging up leaves the draft in SQLite.
- A second local session with the same dev caller id continues that draft.
- `publish_profile` during this call does not deploy yet. It only sets `confirmed` and logs that phase 5 will publish. This keeps the voice work unblocked by Netlify.

### Phase 4 — Twilio

Point a Twilio number at the tunnel. Replace the dev mic as the demo path. Keep `/dev/call` for days when the tunnel is down.

Done when:

- A cell phone call is answered by Higgs.
- Interrupting the agent stops the audio.
- Caller ID maps to the same project on a second call.
- Invalid Twilio signatures are rejected.

### Phase 5 — Confirm publishes

Remove the fixture button from the dashboard. On `publish_profile`, voice calls `POST /internal/publish`, waits for the result, then speaks the preview host. Failures are spoken as “I saved your site details, and the publish step needs another try,” and the dashboard shows the host error.

Done when:

- A yes on the phone produces a Netlify URL whose page matches the tool-written profile.
- A “not yet” leaves `confirmed` false and creates no deploy.
- Redeploying after an hours change keeps the same Netlify site and the same Cloudflare record name.

### Phase 6 — Dashboard is the operator view

SSE is the only live channel. The empty state, in-call state, deploying state, and deployed state are all visible. `/dev/call` stays in the repo but is not linked from the main screen.

Done when:

- Refreshing the dashboard mid-call reconnects the stream and shows the current profile.
- Higgs close codes from FR-9 appear as the strings in that requirement.
- Check DNS reports the four states in FR-18 against `{slug}.{PORCHLINE_PARENT_DOMAIN}` after the Cloudflare write.

### Phase 7 — Rehearsal

Run the demo script in section 16 twice. The first run uses `/dev/call` if the tunnel is unnecessary. The second run is a real cell call through Twilio. The first run’s Cloudflare record should already resolve so the subdomain loads on stage.

Done when the success criteria in section 17 all pass on that second run.

---

## 15. Local development

From the repo root, two terminals:

```powershell
# Terminal A — voice
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .\services\voice
uvicorn porchline_voice.main:app --reload --port 8000 --app-dir services\voice
```

```powershell
# Terminal B — web
cd apps\web
npm install
npm run dev
```

Phase 4 also needs a tunnel aimed at port 8000, and that HTTPS host written into `PUBLIC_VOICE_WSS_URL` and the Twilio voice webhook.

Day-to-day rules:

- Change the schema first, then Pydantic, then Zod, then the tool, then the template.
- New dashboard behavior reads an API that already exists. Do not invent a parallel store in the browser.
- Customer-site CSS lives in `src/generator/template.css`. Tailwind classes do not appear in generated HTML.
- Secrets are read from the environment at startup. A missing required key fails startup with the key name, not a later stack trace mid-call.

---

## 16. Demo script

About four minutes on stage. The phone interview itself can be shortened by using a project already confirmed in rehearsal, then placing a short second call that only changes Saturday hours. If the judges want the full interview, that call is about ten minutes and should be done before the stage slot, with the stage showing the recording of the dashboard plus the live URL.

1. Open the dashboard. Show the Twilio number and an empty or draft project.
2. Call from a phone. Higgs greets in the `default` voice.
3. Give one shop: Rose Street Barber, haircuts and beard trims, Queen Street, Tuesday to Saturday 10 to 6, closed Sunday and Monday, haircut 28 dollars, label `rose-barber`.
4. Interrupt once.
5. Let the agent read the profile back. Say yes.
6. Open the preview URL at phone width.
7. Show the Cloudflare record. Open `https://rose-barber.{PORCHLINE_PARENT_DOMAIN}` after Check DNS says HTTPS ready.

The subdomain is rehearsed earlier. If HTTPS is still provisioning on stage, the `*.netlify.app` preview is the proof that the page exists.

---

## 17. Success criteria

1. A real phone call is answered by Higgs Realtime through Pipecat, with no separate TTS stage.
2. The profile on the page was written only by tools.
3. “Yes” publishes. “Not yet” does not.
4. The preview URL shows the owner’s name, hours, and phone.
5. Publish writes a DNS-only Cloudflare CNAME for `{label}.{PORCHLINE_PARENT_DOMAIN}` and leaves the apex alone.
6. Check DNS matches that hostname, or it correctly reports that the record is not ready.
7. A second call from the same number updates one field and redeploys the same Netlify site without creating a second Cloudflare record.

---

## 18. Risks

| Risk | What we do |
| --- | --- |
| Boson quota or bad API key | Fail voice startup if `BOSON_API_KEY` is empty. Show FR-9 errors on the dashboard. Claim trial credit before phase 3. |
| Audio format mismatch | Keep the Pipecat pipeline at 24 kHz PCM. The dev mic downsamples to 24 kHz. Twilio μ-law is converted by `TwilioFrameSerializer`. |
| Publish races the read-back | `publish_profile` checks required fields and `confirmed` on the server. Instructions are not the gate. |
| Misheard price or hours | FR-7. The tool writes only the confirmed value. |
| DNS or certificate slow on stage | `*.netlify.app` is the fallback. Write the Cloudflare record in phase 2, not live for the first time. |
| Cloudflare proxy turned on | Create the record with `proxied: false`. Treat a proxied record as a failed publish. |
| Wrong zone or apex edit | `CLOUDFLARE_ZONE_ID` must be the zone for `PORCHLINE_PARENT_DOMAIN`. The client may update only the shop CNAME. |
| CNAME target changes | Reuse one Netlify site id per project, stored in SQLite. |
| Twilio cannot reach localhost | Cloudflare Tunnel in phase 4. That tunnel is separate from the DNS zone and uses a different credential. `/dev/call` covers phases 3 and 6. |
| Scope grows into a site builder | One template. The fixture button dies in phase 5. |

---

## 19. After the hackathon

- Phone updates as the only CMS (“we’re closed next Monday”).
- Drop `/dev/call` or hide it behind an env flag.
- More than one project in the dashboard.
- Owner-facing preview link before the subdomain is advertised.

---

## 20. Resolved choices

| Choice | Decision |
| --- | --- |
| Product name | Porchline |
| Voice | Python 3.11, FastAPI, Pipecat, `pipecat-boson`, `higgs-realtime` |
| Phone | Twilio Media Streams, G.711 μ-law, 8000 Hz |
| Transcript | `higgs-stt-3.1` inside the same session |
| Operator app | Next.js, TypeScript, Tailwind |
| Customer site | Static HTML and CSS from `fixtures` or a confirmed profile |
| Store | SQLite owned by the voice service |
| Shared contract | `packages/profile.schema.json` |
| Host | Netlify only |
| Parent domain | `PORCHLINE_PARENT_DOMAIN` in the environment |
| DNS | Cloudflare zone for that domain. One DNS-only CNAME per shop |
| Build order | Fixture page → Netlify + Cloudflare → local Higgs → Twilio → publish on yes → rehearsal |
