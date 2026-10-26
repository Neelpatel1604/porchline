"""Twilio voice webhook and signature check."""

from __future__ import annotations

import os
from base64 import b64encode
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

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


def hangup_call(call_sid: str) -> dict[str, Any]:
    """End an in-progress Twilio call."""
    sid = (os.environ.get("TWILIO_ACCOUNT_SID") or "").strip()
    token = (os.environ.get("TWILIO_AUTH_TOKEN") or "").strip()
    call_sid = (call_sid or "").strip()
    if not sid or not token:
        return {"ok": False, "message": "Twilio credentials missing"}
    if not call_sid or call_sid.startswith("dev-"):
        return {"ok": False, "message": "No Twilio call to hang up"}
    auth = "Basic " + b64encode(f"{sid}:{token}".encode()).decode()
    body = urlencode({"Status": "completed"}).encode()
    req = UrlRequest(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls/{call_sid}.json",
        data=body,
        method="POST",
        headers={
            "Authorization": auth,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urlopen(req, timeout=20) as resp:
            resp.read()
        return {"ok": True, "callSid": call_sid}
    except Exception as exc:  # noqa: BLE001
        detail = str(exc)
        if hasattr(exc, "read"):
            try:
                detail = exc.read().decode("utf-8", errors="replace")[:300]
            except Exception:  # noqa: BLE001
                pass
        return {"ok": False, "message": detail[:300]}
