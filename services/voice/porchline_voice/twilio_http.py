"""Twilio voice webhook and signature check."""

from __future__ import annotations

import os

from fastapi import Request
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Connect, VoiceResponse


def public_request_url(request: Request) -> str:
    # Twilio signs the full URL including the query string (needed for Connect action).
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    path = request.url.path
    query = request.url.query
    suffix = f"{path}?{query}" if query else path
    if forwarded_proto and forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}{suffix}"
    return str(request.url)


def signature_is_valid(request: Request, params: dict[str, str]) -> bool:
    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    signature = request.headers.get("X-Twilio-Signature", "")
    if not token or not signature:
        return False
    validator = RequestValidator(token)
    return validator.validate(public_request_url(request), params, signature)


def stream_url() -> str:
    configured = os.environ.get("PUBLIC_VOICE_WSS_URL", "").rstrip("/")
    if not configured:
        raise RuntimeError("Missing PUBLIC_VOICE_WSS_URL")
    if configured.endswith("/twilio/stream"):
        return configured
    return f"{configured}/twilio/stream"


def public_http_base() -> str:
    """HTTPS origin Twilio can POST to when the media stream ends."""
    explicit = (os.environ.get("VOICE_PUBLIC_HTTP_URL") or "").strip().rstrip("/")
    if explicit:
        return explicit
    configured = (os.environ.get("PUBLIC_VOICE_WSS_URL") or "").strip().rstrip("/")
    if configured.endswith("/twilio/stream"):
        configured = configured[: -len("/twilio/stream")]
    if configured.startswith("wss://"):
        return "https://" + configured[len("wss://") :]
    if configured.startswith("ws://"):
        return "http://" + configured[len("ws://") :]
    if configured.startswith("https://") or configured.startswith("http://"):
        return configured
    raise RuntimeError("Missing PUBLIC_VOICE_WSS_URL or VOICE_PUBLIC_HTTP_URL")


def connect_twiml(project_id: str) -> str:
    # Connect action fires as soon as the stream ends (caller hangup), even if
    # the agent pipeline is still blocked on publish - that clears "Live" fast.
    action = f"{public_http_base()}/twilio/connect-ended?projectId={project_id}"
    response = VoiceResponse()
    connect = Connect(action=action, method="POST")
    stream = connect.stream(url=stream_url())
    stream.parameter(name="projectId", value=project_id)
    response.append(connect)
    return str(response)
