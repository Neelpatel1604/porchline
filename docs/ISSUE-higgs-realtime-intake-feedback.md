# Higgs Realtime: invents facts and skips tool saves on phone intake

**Repo:** https://github.com/Neelpatel1604/porchline  
**Model:** `higgs-realtime` (`wss://api.boson.ai/v1/realtime/`)  
**Transcript helper:** `higgs-stt-3.1`  
**Client:** Pipecat + `pipecat-boson` over Twilio Media Streams

---

## What happens

### Summary
We use Higgs Realtime as a phone interviewer for Porchline. The agent sounds fluent, but it often invents business details from unclear speech, says "Got it" without writing tools, and repeats the same questions. The live dashboard then shows an empty or wrong profile while the call sounded finished.

### Expected
- Ask short questions and only store what the caller clearly said (or ask to repeat/spell).
- Call the matching tool before acknowledging a fact.
- Read back from `read_profile`, not from chat memory.
- Do not invent names, emails, prices, headlines, or parking notes.
- Do not loop the same question when audio is unclear.

### Actual
- Unclear speech gets turned into a polished invented brand (e.g. "shopping house" -> "Sibley's Coffee House").
- Agent confirms facts verbally while SQLite stays empty -> publish falls back to "Local business".
- Same question/phrase repeats when VAD or audio is messy.
- Final read-back uses conversation memory (including earlier inventions) instead of tool state.

---

## Details

Porchline configures one Higgs session per call with intake instructions and tools:

`save_business_basics`, `save_contact`, `save_hours`, `add_service`, `save_site_style`, `read_profile`, `publish_profile`

Turn detection: `server_vad` (`silence_duration_ms: 1400`, `threshold: 0.65`, interrupt enabled).

After a spoken "yes", publish runs outside Higgs (Gemini + Netlify). This issue is only about the **phone intake**.

We also tried stronger anti-invent instructions, longer VAD silence, and disabling call-resume. That helped a little; the core failures remained.

---

## How to reproduce

1. Run Porchline voice with `BOSON_REALTIME_MODEL=higgs-realtime` and the tools above (see repo).
2. Place a real Twilio call into the Pipecat `BosonRealtimeLLMService` session.
3. Give business details unclearly, partially, or with noisy phone audio.
4. Watch the agent invent a clean name/email and/or repeat questions.
5. Compare the spoken "Got it" lines to the tool-backed profile in SQLite / operator dashboard - fields are often still empty.

---

## Evidence

- Live operator transcript from demo calls: agent narrates saved facts that never appear in the profile card.
- Example pattern: owner speech unclear -> agent "Got it, Sibley's Coffee House" -> later guessed email/prices/headline -> profile still `Local business` / missing phone and hours after publish fallback.
- Repo with the exact wiring: https://github.com/Neelpatel1604/porchline (`services/voice/porchline_voice/agent.py`, `instructions.py`, `tools.py`).

Happy to share a redacted transcript or tool logs if useful.
