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
from porchline_voice.profile import empty_profile
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
    allow_methods=["GET", "POST", "OPTIONS"],
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
    # Every inbound call starts fresh — no resume of prior profile or transcript.
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
