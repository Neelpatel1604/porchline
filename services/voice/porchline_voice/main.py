"""FastAPI entrypoint for the Porchline voice service."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

from porchline_voice.events import EventHub
from porchline_voice.profile import empty_profile, profile_has_facts, seed_profile_from_prior
from porchline_voice.store import Store
from porchline_voice.twilio_http import connect_twiml, signature_is_valid

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env", override=True)
print(f"twilio stream url: {os.environ.get('PUBLIC_VOICE_WSS_URL', '')}", flush=True)

def _cors_origins() -> list[str]:
    origins: list[str] = []
    for part in (os.environ.get("CORS_ORIGINS") or "").split(","):
        value = part.strip().rstrip("/")
        if value and value not in origins:
            origins.append(value)
    web = (os.environ.get("WEB_BASE_URL") or "").strip().rstrip("/")
    if web and web not in origins:
        origins.append(web)
    for local in ("http://localhost:3000", "http://127.0.0.1:3000"):
        if local not in origins:
            origins.append(local)
    return origins


app = FastAPI(title="Porchline voice")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

_db_path = Path(os.environ.get("DATABASE_PATH", "data/porchline.db"))
if not _db_path.is_absolute():
    _db_path = ROOT / _db_path
store = Store(_db_path)
hub = EventHub()


def _secret_ok(request: Request) -> bool:
    expected = os.environ.get("INTERNAL_SHARED_SECRET", "")
    return bool(expected) and request.headers.get("X-Porchline-Secret") == expected


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/projects/current")
def current_project() -> dict:
    return {"project": store.current()}


@app.get("/projects")
def list_projects() -> dict:
    return {"projects": store.list_projects()}


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="unknown project")
    return {"project": project}


@app.get("/directory")
def directory() -> dict:
    return {"contacts": store.list_contacts()}


@app.get("/directory/caller/{caller_id}")
def directory_caller(caller_id: str) -> dict:
    contact = store.get_contact(caller_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="unknown caller")
    return {"contact": contact}


@app.patch("/projects/{project_id}/profile")
async def patch_project_profile(project_id: str, request: Request) -> dict:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="unknown project")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="expected JSON object")
    profile = dict(project.get("profile") or {})
    allowed = {
        "businessName",
        "category",
        "summary",
        "phone",
        "email",
        "address",
        "serviceArea",
        "highlight",
        "vibe",
        "look",
        "heroLine",
        "audience",
        "siteSlug",
        "hours",
        "services",
    }
    changed = False
    for key, value in body.items():
        if key not in allowed:
            continue
        profile[key] = value
        changed = True
    if not changed:
        raise HTTPException(status_code=400, detail="no updatable fields")
    profile["confirmed"] = False
    saved = store.save_profile(project_id, profile)
    hub.publish(project_id, {"type": "profile", "project": saved})
    return {"ok": True, "project": saved}


@app.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    if store.get(project_id) is None:
        raise HTTPException(status_code=404, detail="unknown project")
    store.delete_project(project_id)
    return {"ok": True}


@app.delete("/directory/caller/{caller_id}")
def delete_caller(caller_id: str) -> dict:
    deleted = store.delete_caller(caller_id)
    if deleted <= 0:
        raise HTTPException(status_code=404, detail="unknown caller")
    return {"ok": True, "deleted": deleted}


@app.get("/projects/{project_id}/stream")
async def project_stream(project_id: str) -> StreamingResponse:
    if store.get(project_id) is None:
        raise HTTPException(status_code=404, detail="unknown project")

    async def events():
        queue = hub.subscribe(project_id)
        snapshot = store.get(project_id)
        yield _sse({"type": "snapshot", "project": snapshot})
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield _sse(event)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            hub.unsubscribe(project_id, queue)

    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/internal/deploy-result")
async def deploy_result(request: Request) -> dict:
    if not _secret_ok(request):
        raise HTTPException(status_code=401, detail="bad secret")
    body = await request.json()
    project_id = body.get("projectId")
    if not project_id or store.get(project_id) is None:
        raise HTTPException(status_code=404, detail="unknown project")
    saved = store.save_deploy(project_id, body)
    hub.publish(project_id, {"type": "status", "project": saved})
    return {"ok": True, "project": saved}


@app.post("/internal/publish")
async def internal_publish(request: Request) -> dict:
    """Gemini + Netlify deploy on this host (EC2). Avoids Netlify function 504s."""
    if not _secret_ok(request):
        raise HTTPException(status_code=401, detail="bad secret")
    from porchline_voice.site_publish import publish_profile_local

    body = await request.json()
    project_id = str(body.get("projectId") or "")
    profile = body.get("profile") or {}
    if not project_id:
        raise HTTPException(status_code=400, detail="projectId required")
    result = await asyncio.to_thread(
        publish_profile_local,
        project_id=project_id,
        profile=profile if isinstance(profile, dict) else {},
        netlify_site_id=body.get("netlifySiteId"),
    )
    if store.get(project_id) is not None:
        saved = store.save_deploy(project_id, result)
        hub.publish(project_id, {"type": "status", "project": saved})
    return result


@app.post("/twilio/connect-ended")
async def twilio_connect_ended(request: Request) -> Response:
    """Twilio Connect action — fires when the media stream ends (caller hung up)."""
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}
    if not signature_is_valid(request, params):
        raise HTTPException(status_code=403, detail="invalid twilio signature")
    project_id = request.query_params.get("projectId") or params.get("projectId")
    project = store.get(project_id) if project_id else None
    if project is None:
        caller = params.get("From")
        project = store.find_open_by_caller(caller) if caller else None
    if project is not None:
        ended = store.mark_call_ended(project["id"])
        if ended is not None:
            hub.publish(project["id"], {"type": "status", "project": ended})
    return Response(content="<Response></Response>", media_type="text/xml")


@app.post("/projects/{project_id}/cancel")
def cancel_project(project_id: str) -> dict:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="unknown project")
    if project["status"] not in {"designing", "deploying"}:
        return {"ok": False, "project": project}
    saved = store.set_status(project_id, "error", "Publish cancelled")
    hub.publish(project_id, {"type": "error", "project": saved})
    return {"ok": True, "project": saved}


@app.post("/twilio/voice")
async def twilio_voice(request: Request) -> Response:
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}
    if not signature_is_valid(request, params):
        raise HTTPException(status_code=403, detail="invalid twilio signature")
    caller = params.get("From") or "unknown"
    call_sid = params.get("CallSid") or "call"
    # New call row + empty transcript, but seed profile from this caller's latest DB save.
    prior = store.find_latest_by_caller(caller) if caller not in {"unknown", ""} else None
    if prior is not None and profile_has_facts(prior.get("profile")):
        profile = seed_profile_from_prior(prior, call_sid)
        project = store.create(
            caller,
            call_sid,
            profile,
            netlify_site_id=prior.get("netlifySiteId"),
        )
    else:
        project = store.create(caller, call_sid, empty_profile(call_sid))
    if project is None:
        raise HTTPException(status_code=500, detail="project was not stored")
    hub.publish(project["id"], {"type": "status", "project": project})
    try:
        xml = connect_twiml(project["id"])
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(content=xml, media_type="text/xml")


@app.post("/twilio/status")
async def twilio_status(request: Request) -> Response:
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}
    if not signature_is_valid(request, params):
        raise HTTPException(status_code=403, detail="invalid twilio signature")
    if params.get("CallStatus") in {"completed", "busy", "failed", "no-answer", "canceled"}:
        caller = params.get("From")
        project = store.find_open_by_caller(caller) if caller else None
        if project is not None:
            ended = store.mark_call_ended(project["id"])
            if ended is not None:
                hub.publish(project["id"], {"type": "status", "project": ended})
    return Response(status_code=204)


@app.websocket("/twilio/stream")
async def twilio_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    from porchline_voice.agent import run_twilio_call

    await run_twilio_call(websocket, store, hub)


@app.websocket("/dev/stream")
async def dev_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    caller = websocket.query_params.get("caller") or "dev-mic"
    from porchline_voice.agent import run_dev_call

    await run_dev_call(websocket, store, hub, caller)
