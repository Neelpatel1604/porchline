# Porchline

A local shop calls a phone number. Higgs Realtime interviews them, tools save a structured profile, and after a spoken yes the same voice service designs a one-page site and puts it on Netlify. The owner gets the link by text. The operator watches from a desk. The caller never hears the internal stage names.

## How a call works

1. The owner calls the Twilio number.
2. Twilio streams 8 kHz audio to Caddy, which proxies to the voice service on the EC2 host (`127.0.0.1:8000`).
3. Pipecat opens a Higgs Realtime session (Boson). The model interviews in the caller's language and calls tools as facts come in.
4. Each tool writes the profile in SQLite (`data/porchline.db`). The operator desk shows those saves in green and other steps in blue.
5. The agent reads the profile back. Publish starts only after a spoken yes.
6. The voice service asks Gemini for the page. If Gemini fails, it uses the template.
7. It deploys a zip to Netlify, texts the `*.netlify.app` link, and tells the owner the site is up.

Publish runs inside the voice process. It does not go through the Next.js app. A Netlify function would time out while Gemini is still designing.

The desk stages are **Designing the page**, **Publishing to Netlify**, and **Live**. Those words are for the operator. The agent tells the caller it is building the site, then that the site is up.

## Repo

| Path | What it is |
| --- | --- |
| `services/voice` | FastAPI + Pipecat. The phone call, tools, SQLite, Gemini, and Netlify deploy. |
| `apps/web` | Next.js operator desk. Transcript, profile, and publish stages. |
| `packages/profile.schema.json` | The profile contract. |
| `fixtures/rose-barber.json` | Sample shop, used by the local preview. |
| `infra/porchline-voice.service` | systemd unit so the voice app stays up after SSH closes. |
| `docs/PRD.md` | Original product spec. The live publish path is the voice service, not the Next.js route described there. |

## Run it locally

From the repo root, two terminals:

```powershell
npm run dev:voice
npm run dev:web
```

- Voice: `http://localhost:8000` (`/health` returns `{"ok":true}`)
- Desk: `http://localhost:3000`
- Fixture page, no call required: `http://localhost:3000/preview/fixture`

Copy `.env.example` to `.env` in the repo root. Both apps read that file. Do not commit `.env`.

Get `BOSON_API_KEY` from the Boson workspace: [boson.ai/workspace/api-key](https://www.boson.ai/workspace/api-key). Put that value in `.env`.

A real call also needs a public WebSocket URL in `PUBLIC_VOICE_WSS_URL` (a tunnel, or the EC2 host). Twilio cannot reach `localhost`.

## Run it on EC2

The voice app is `porchline-voice`. Caddy on the instance proxies `https://<host>` to `127.0.0.1:8000`. Closing SSH does not stop it.

```bash
sudo systemctl status porchline-voice
sudo systemctl restart porchline-voice
sudo journalctl -u porchline-voice -f
```

The unit file in the repo is `infra/porchline-voice.service`. On the server it lives at `/etc/systemd/system/porchline-voice.service`.

On EC2, keep `PUBLISH_BASE_URL=http://127.0.0.1:8000`. Pointing publish at the Netlify Next app makes the deploy die while Gemini is still working. Set `VOICE_BASE_URL` to the public HTTPS voice URL so a Netlify-hosted desk can poll and subscribe.

## Config

Every key is listed in `.env.example`.

| Group | Used for |
| --- | --- |
| `BOSON_API_KEY`, `BOSON_REALTIME_URL`, `BOSON_REALTIME_MODEL` | Higgs Realtime. The key is created at [boson.ai/workspace/api-key](https://www.boson.ai/workspace/api-key). |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `PUBLIC_VOICE_WSS_URL` | The call and the text with the link |
| `GEMINI_API_KEY`, `SITE_BUILDER_MODEL` | Page design. Empty key falls back to the template. |
| `NETLIFY_AUTH_TOKEN` | Deploy. Required on the voice host. |
| `DATABASE_PATH` | SQLite file. Default `data/porchline.db`. |
| `WEB_BASE_URL`, `VOICE_BASE_URL`, `CORS_ORIGINS` | Where the desk lives, and which origins the voice API allows. |
| `INTERNAL_SHARED_SECRET` | Shared secret for internal routes. |

Keys stay on the server. They are not written into the generated site.

## Architecture

[Porchline architecture](https://www.figma.com/board/tjHBeG20m7cjYYe29FumB2/Porchline-architecture?node-id=0-1) is the current diagram: Twilio and Caddy in front, the voice service owning the interview and the deploy, Higgs, Gemini, Netlify, and SQLite beside it, and the Next.js desk watching.
