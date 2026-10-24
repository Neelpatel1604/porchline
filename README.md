# Porchline

One phone call with a local business owner. A live website on their subdomain.

Porchline is a Boson AI hackathon product. [Higgs Realtime](https://docs.boson.ai/models/higgs-realtime/overview) interviews the owner, tools save a structured business profile, and the app generates a site, deploys it to Netlify or Vercel, and prints the CNAME the operator pastes for the subdomain.

The full product spec is in [docs/PRD.md](docs/PRD.md).

## Why this uses Boson

Higgs Realtime is a full-duplex speech-to-speech session. It listens, speaks, handles interruptions, and calls tools in one WebSocket. Phone audio can stay in G.711 μ-law at 8 kHz, which matches a telephony media stream. Published rates are about **$0.014 per minute of spoken audio out** and **$0.0023 per minute of audio in**, so a typical intake call costs well under a dollar of Boson usage. Source: [Boson pricing](https://docs.boson.ai/pricing).
