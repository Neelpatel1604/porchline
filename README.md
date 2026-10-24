# Porchline

One phone call with a local business owner. A live website on their subdomain.

Porchline is a Boson AI hackathon product. [Higgs Realtime](https://docs.boson.ai/models/higgs-realtime/overview) interviews the owner, tools save a structured business profile, and the app generates a site, deploys it to Netlify, and creates the subdomain CNAME in Cloudflare.

The build spec — stack, repo layout, and development phases — is in [docs/PRD.md](docs/PRD.md).

The voice service is Python (FastAPI, Pipecat, Higgs Realtime). The operator app is Next.js. Twilio carries the call. Netlify hosts the page. The parent domain is `PORCHLINE_PARENT_DOMAIN`, and Cloudflare holds the subdomain CNAME.

## Run locally

Copy `.env.example` to `.env`. The dashboard and the local fixture page start before the tokens are filled in. Deploy, Higgs, and Twilio start working after those values are set.

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .\services\voice
uvicorn porchline_voice.main:app --reload --port 8000 --app-dir services\voice
```

```powershell
cd apps\web
npm install
npm run dev
```

Open `http://localhost:3000`. The fixture page is `http://localhost:3000/preview/fixture`.
