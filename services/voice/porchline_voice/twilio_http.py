"""Twilio voice webhook and signature check."""

from __future__ import annotations

import os

from fastapi import Request
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Connect, VoiceResponse


def public_request_url(request: Request) -> str:
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if forwarded_proto and forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}{request.url.path}"
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


def connect_twiml(project_id: str) -> str:
    response = VoiceResponse()
    connect = Connect()
    stream = connect.stream(url=stream_url())
    stream.parameter(name="projectId", value=project_id)
    response.append(connect)
    return str(response)
