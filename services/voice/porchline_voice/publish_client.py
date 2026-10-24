"""Ask the Next.js app to deploy a confirmed profile."""

from __future__ import annotations

import os
from typing import Any

import httpx


async def request_publish(project: dict[str, Any]) -> dict[str, Any]:
    base = os.environ.get("WEB_BASE_URL", "http://localhost:3000").rstrip("/")
    secret = os.environ.get("INTERNAL_SHARED_SECRET", "")
    if not secret:
        return {"status": "error", "message": "Missing INTERNAL_SHARED_SECRET"}
    payload = {
        "projectId": project["id"],
        "profile": project["profile"],
        "netlifySiteId": project.get("netlifySiteId"),
    }
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                f"{base}/internal/publish",
                json=payload,
                headers={"X-Porchline-Secret": secret},
            )
    except httpx.HTTPError as exc:
        return {"status": "error", "message": f"Publish request failed: {exc}"}
    try:
        body = response.json()
    except ValueError:
        return {"status": "error", "message": f"Publish returned HTTP {response.status_code}"}
    if response.status_code >= 400 and body.get("status") != "error":
        body = {"status": "error", "message": body.get("message") or f"HTTP {response.status_code}"}
    return body
