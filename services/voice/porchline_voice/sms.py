"""Send the published site link by Twilio SMS."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from base64 import b64encode
import json


def _basic_auth(sid: str, token: str) -> str:
    return "Basic " + b64encode(f"{sid}:{token}".encode()).decode()


def twilio_from_number() -> str:
    configured = (os.environ.get("TWILIO_PHONE_NUMBER") or os.environ.get("TWILIO_FROM_NUMBER") or "").strip()
    if configured:
        return configured
    sid = (os.environ.get("TWILIO_ACCOUNT_SID") or "").strip()
    token = (os.environ.get("TWILIO_AUTH_TOKEN") or "").strip()
    if not sid or not token:
        return ""
    req = Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/IncomingPhoneNumbers.json",
        headers={"Authorization": _basic_auth(sid, token)},
    )
    with urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    numbers = data.get("incoming_phone_numbers") or []
    if not numbers:
        return ""
    return str(numbers[0].get("phone_number") or "").strip()


def send_site_sms(*, to_number: str, preview_url: str, business_name: str = "") -> dict[str, Any]:
    sid = (os.environ.get("TWILIO_ACCOUNT_SID") or "").strip()
    token = (os.environ.get("TWILIO_AUTH_TOKEN") or "").strip()
    if not sid or not token:
        return {"ok": False, "message": "Twilio credentials missing"}
    to_number = (to_number or "").strip()
    if not to_number or to_number in {"unknown", "dev-mic"}:
        return {"ok": False, "message": "No caller number to text"}
    preview_url = (preview_url or "").strip()
    if not preview_url:
        return {"ok": False, "message": "No preview URL"}
    from_number = twilio_from_number()
    if not from_number:
        return {"ok": False, "message": "No Twilio from-number configured"}

    name = (business_name or "your business").strip() or "your business"
    body = (
        f"Porchline: {name} is live. Open your site: {preview_url}"
    )
    payload = urlencode(
        {
            "To": to_number,
            "From": from_number,
            "Body": body,
        }
    ).encode()
    req = Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
        data=payload,
        method="POST",
        headers={
            "Authorization": _basic_auth(sid, token),
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        return {
            "ok": True,
            "sid": data.get("sid"),
            "to": data.get("to"),
            "status": data.get("status"),
        }
    except Exception as exc:  # noqa: BLE001 - surface Twilio errors to the agent
        detail = str(exc)
        if hasattr(exc, "read"):
            try:
                detail = exc.read().decode("utf-8", errors="replace")[:300]
            except Exception:  # noqa: BLE001
                pass
        return {"ok": False, "message": detail[:300]}
