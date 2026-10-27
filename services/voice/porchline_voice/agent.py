"""Higgs Realtime call pipeline.

Pipecat's Boson service speaks 24 kHz PCM. Twilio still sends 8 kHz μ-law;
TwilioFrameSerializer converts it. The dev mic sends 24 kHz PCM directly.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from fastapi import WebSocket
from pipecat.frames.frames import (
    EndFrame,
    InputAudioRawFrame,
    LLMMessagesAppendFrame,
    LLMRunFrame,
    OutputAudioRawFrame,
    TranscriptionFrame,
    TTSTextFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
from pipecat.workers.runner import WorkerRunner
from pipecat_boson.realtime import BosonRealtimeLLMService

from porchline_voice.events import EventHub
from porchline_voice.instructions import INSTRUCTIONS, RESUME_INSTRUCTIONS
from porchline_voice.profile import (
    compact_profile_for_prompt,
    empty_profile,
    profile_has_facts,
    seed_profile_from_prior,
)
from porchline_voice.store import Store
from porchline_voice.tools import ToolKit

SAMPLE_RATE = 24000


class Pcm24kSerializer(FrameSerializer):
    async def serialize(self, frame) -> bytes | None:
        if isinstance(frame, OutputAudioRawFrame):
            return frame.audio
        return None

    async def deserialize(self, data: str | bytes):
        if isinstance(data, bytes) and data:
            return InputAudioRawFrame(audio=data, sample_rate=SAMPLE_RATE, num_channels=1)
        return None


class TranscriptTap(FrameProcessor):
    """Capture live spoken text for the operator dashboard."""

    def __init__(self, role: str, on_text, frame_types: tuple[type, ...]) -> None:
        super().__init__()
        self._role = role
        self._on_text = on_text
        self._frame_types = frame_types
        self._last = ""

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, self._frame_types):
            text = (getattr(frame, "text", None) or "").strip()
            if text and text != self._last:
                self._last = text
                self._on_text(self._role, text)
        await self.push_frame(frame, direction)


def _boson_message(event_type: Any, event: Any) -> str | None:
    text = f"{event_type} {event}".lower()
    if "4429" in text or "insufficient" in text or "quota" in text:
        return "Boson credit exhausted"
    if "3000" in text or "invalid api key" in text or "auth" in text:
        return "Boson auth problem"
    if "1013" in text or "concurrency" in text:
        return "Boson concurrency limit. Retry."
    if event_type:
        return f"Boson session ended: {event_type}"
    return None


def _transcription_config() -> dict[str, Any]:
    """STT for the dashboard. No language hint = auto-detect (matches Higgs realtime)."""
    config: dict[str, Any] = {"model": "higgs-stt-3.1"}
    hint = (os.environ.get("BOSON_STT_LANGUAGE") or "").strip().lower()
    if hint and hint not in {"auto", "detect", "*"}:
        config["language"] = hint
    return config


def _instructions(caller: str | None, profile: dict[str, Any] | None = None) -> str:
    parts = [INSTRUCTIONS]
    if caller and caller not in {"unknown", "dev-mic"}:
        parts.append(
            f"\n\nThe caller is dialing from {caller}. "
            "Ask for the public site phone in normal conversation. "
            "Do not offer or ask to use this caller ID. "
            "Only save_contact with this number if they clearly say to use the number they are calling from."
        )
    if profile_has_facts(profile):
        known = compact_profile_for_prompt(profile or {})
        parts.append("\n\n" + RESUME_INSTRUCTIONS)
        parts.append("\n\nKNOWN PROFILE (from our database - ground truth):\n" + json.dumps(known, ensure_ascii=True))
    else:
        parts.append(
            "\n\nThis is a first interview for this number. Do not assume earlier call history. "
            "Start empty and only store confirmed facts."
        )
    return "".join(parts)


async def _run_pipeline(
    websocket: WebSocket,
    serializer: FrameSerializer,
    project_id: str,
    store: Store,
    hub: EventHub,
    caller: str | None = None,
    profile: dict[str, Any] | None = None,
) -> None:
    api_key = os.environ.get("BOSON_API_KEY", "").strip()
    if not api_key:
        await websocket.send_text("Missing BOSON_API_KEY")
        await websocket.close()
        return

    hangup_lock = asyncio.Lock()
    hangup_scheduled = False

    async def schedule_hangup() -> None:
        nonlocal hangup_scheduled
        async with hangup_lock:
            if hangup_scheduled:
                return
            hangup_scheduled = True
        # Give TTS time to finish the goodbye before Twilio cuts the line.
        await asyncio.sleep(3.5)
        await worker.queue_frames([EndFrame(reason="agent_end_call")])

    async def notify_publish_done(result: dict[str, Any]) -> None:
        """Interrupt small talk and let the agent announce the live site (or failure)."""
        if result.get("ok"):
            preview = result.get("previewUrl") or ""
            sms = result.get("sms") if isinstance(result.get("sms"), dict) else {}
            sms_bit = (
                "A text with the link was sent."
                if sms.get("ok")
                else "The text failed - speak the preview link clearly."
            )
            content = (
                "[Porchline system] The website publish just finished successfully. "
                f"Preview URL: {preview}. {sms_bit} "
                "In the caller's language, casually say their site is up, mention the text if it sent, "
                "then a short goodbye and call end_call."
            )
        else:
            content = (
                "[Porchline system] Publish failed. "
                f"Detail: {result.get('message') or 'unknown error'}. "
                "In the caller's language, tell them their details are saved and publish needs another try later. "
                "Offer goodbye and end_call if they are done."
            )
        try:
            await worker.queue_frames(
                [
                    LLMMessagesAppendFrame(
                        messages=[{"role": "user", "content": content}],
                        run_llm=True,
                    )
                ]
            )
        except Exception:  # noqa: BLE001 - call may already be over; SMS still sent
            pass

    toolkit = ToolKit(
        store,
        hub,
        project_id,
        on_end_call=schedule_hangup,
        on_publish_done=notify_publish_done,
        caller_id=caller,
    )
    tools = toolkit.handlers()
    llm = BosonRealtimeLLMService(
        url=os.environ.get("BOSON_REALTIME_URL", "wss://api.boson.ai/v1/realtime/"),
        api_key=api_key,
        model=os.environ.get("BOSON_REALTIME_MODEL", "higgs-realtime"),
        voice="default",
        instructions=_instructions(caller, profile),
        tools=tools,
        turn_detection={
            "type": "server_vad",
            "create_response": True,
            "interrupt_response": True,
            "prefix_padding_ms": 400,
            # Longer silence helps finish names, emails, and digit runs on phone audio.
            "silence_duration_ms": 1800,
            "threshold": 0.55,
        },
        # Omit language so higgs-stt-3.1 auto-detects; optional ISO-639-1 hint via env.
        input_audio_transcription=_transcription_config(),
        input_audio_noise_reduction="near_field",
    )

    def remember(role: str, text: str) -> None:
        project = store.append_transcript(project_id, role, text)
        hub.publish(project_id, {"type": "transcript", "project": project})

    @llm.event_handler("on_session_terminated")
    async def on_session_terminated(_service, event_type, event):
        message = _boson_message(event_type, event)
        if not message:
            return
        saved = store.set_status(project_id, "error", message)
        hub.publish(project_id, {"type": "error", "project": saved})

    context = LLMContext(tools=tools)
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        realtime_service_mode=True,
    )
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=SAMPLE_RATE,
            audio_out_sample_rate=SAMPLE_RATE,
            add_wav_header=False,
            serializer=serializer,
        ),
    )
    pipeline = Pipeline(
        [
            transport.input(),
            user_aggregator,
            TranscriptTap("owner", remember, (TranscriptionFrame,)),
            llm,
            TranscriptTap("agent", remember, (TTSTextFrame,)),
            transport.output(),
            assistant_aggregator,
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=SAMPLE_RATE,
            audio_out_sample_rate=SAMPLE_RATE,
            enable_metrics=True,
        ),
        # Default idle timeout is 300s and cancels the call. Higgs turn events
        # do not reset that timer, so a quiet publish wait dies at 5 minutes
        # and the site is left stuck on "designing".
        idle_timeout_secs=None,
        cancel_on_idle_timeout=False,
    )

    def mark_ended() -> None:
        ended = store.mark_call_ended(project_id)
        if ended is not None:
            hub.publish(project_id, {"type": "status", "project": ended})

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        # Do not wait for a blocked publish tool - clear Live as soon as the socket drops.
        mark_ended()
        try:
            await worker.cancel(reason="caller hung up")
        except Exception:  # noqa: BLE001 - worker may already be finished
            pass

    runner = WorkerRunner()
    await runner.add_workers(worker)
    await runner.run()


async def run_dev_call(websocket: WebSocket, store: Store, hub: EventHub, caller: str) -> None:
    prior = store.find_latest_by_caller(caller)
    if prior is not None and profile_has_facts(prior.get("profile")):
        profile = seed_profile_from_prior(prior, f"dev-{caller}")
        project = store.create(caller, f"dev-{caller}", profile, netlify_site_id=prior.get("netlifySiteId"))
    else:
        profile = empty_profile(f"dev-{caller}")
        project = store.create(caller, f"dev-{caller}", profile)
    hub.publish(project["id"], {"type": "status", "project": project})
    await websocket.send_text(json.dumps({"type": "ready", "projectId": project["id"]}))
    try:
        await _run_pipeline(
            websocket,
            Pcm24kSerializer(),
            project["id"],
            store,
            hub,
            caller,
            profile=project.get("profile"),
        )
    finally:
        ended = store.mark_call_ended(project["id"])
        if ended is not None:
            hub.publish(project["id"], {"type": "status", "project": ended})


async def run_twilio_call(websocket: WebSocket, store: Store, hub: EventHub) -> None:
    start: dict[str, Any] | None = None
    while start is None:
        raw = await websocket.receive_text()
        message = json.loads(raw)
        if message.get("event") == "start":
            start = message["start"]
    if start is None:
        return
    params = start.get("customParameters") or {}
    project_id = params.get("projectId")
    call_sid = start.get("callSid") or "twilio-call"
    project = store.get(project_id) if project_id else None
    if project is None:
        project = store.create(call_sid, call_sid, empty_profile(call_sid))
    stream_sid = start["streamSid"]
    serializer = TwilioFrameSerializer(
        stream_sid=stream_sid,
        call_sid=call_sid,
        account_sid=os.environ.get("TWILIO_ACCOUNT_SID"),
        auth_token=os.environ.get("TWILIO_AUTH_TOKEN"),
        params=TwilioFrameSerializer.InputParams(sample_rate=SAMPLE_RATE),
    )
    try:
        await _run_pipeline(
            websocket,
            serializer,
            project["id"],
            store,
            hub,
            project.get("callerId"),
            profile=project.get("profile"),
        )
    finally:
        ended = store.mark_call_ended(project["id"])
        if ended is not None:
            hub.publish(project["id"], {"type": "status", "project": ended})
