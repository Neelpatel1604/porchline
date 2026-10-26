"""Higgs Realtime call pipeline.

Pipecat's Boson service speaks 24 kHz PCM. Twilio still sends 8 kHz μ-law;
TwilioFrameSerializer converts it. The dev mic sends 24 kHz PCM directly.
"""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import WebSocket
from pipecat.frames.frames import (
    InputAudioRawFrame,
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
from porchline_voice.instructions import INSTRUCTIONS
from porchline_voice.profile import empty_profile
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


def _instructions(caller: str | None) -> str:
    if not caller or caller in {"unknown", "dev-mic"}:
        return INSTRUCTIONS
    return (
        INSTRUCTIONS
        + f"\n\nThe caller is dialing from {caller}. "
        + "If they say to use this number, or they speak these digits, save it with save_contact immediately. "
        + "Do not assume any earlier call history. This interview starts empty."
    )


async def _run_pipeline(
    websocket: WebSocket,
    serializer: FrameSerializer,
    project_id: str,
    store: Store,
    hub: EventHub,
    caller: str | None = None,
    call_sid: str | None = None,
) -> None:
    api_key = os.environ.get("BOSON_API_KEY", "").strip()
    if not api_key:
        await websocket.send_text("Missing BOSON_API_KEY")
        await websocket.close()
        return

    async def close_local() -> None:
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001 - already closing
            pass

    toolkit = ToolKit(
        store,
        hub,
        project_id,
        call_sid=call_sid,
        on_local_hangup=close_local,
    )
    tools = toolkit.handlers()
    llm = BosonRealtimeLLMService(
        url=os.environ.get("BOSON_REALTIME_URL", "wss://api.boson.ai/v1/realtime/"),
        api_key=api_key,
        model=os.environ.get("BOSON_REALTIME_MODEL", "higgs-realtime"),
        voice="default",
        instructions=_instructions(caller),
        tools=tools,
        turn_detection={
            "type": "server_vad",
            "create_response": True,
            "interrupt_response": True,
            "prefix_padding_ms": 300,
            # Longer silence before the model speaks again — cuts rapid repeat loops.
            "silence_duration_ms": 1400,
            "threshold": 0.65,
        },
        input_audio_transcription={"model": "higgs-stt-3.1", "language": "en"},
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
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        await worker.queue_frames([LLMRunFrame()])

    runner = WorkerRunner()
    await runner.add_workers(worker)
    await runner.run()


async def run_dev_call(websocket: WebSocket, store: Store, hub: EventHub, caller: str) -> None:
    project = store.create(caller, f"dev-{caller}", empty_profile(f"dev-{caller}"))
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
            call_sid=None,
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
            call_sid=call_sid,
        )
    finally:
        ended = store.mark_call_ended(project["id"])
        if ended is not None:
            hub.publish(project["id"], {"type": "status", "project": ended})
