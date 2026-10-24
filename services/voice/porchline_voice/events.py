"""In-memory server-sent event hub for the operator dashboard."""

from __future__ import annotations

import asyncio
from typing import Any


class EventHub:
    def __init__(self) -> None:
        self._subs: dict[str, list[asyncio.Queue[dict[str, Any]]]] = {}

    def subscribe(self, project_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subs.setdefault(project_id, []).append(queue)
        return queue

    def unsubscribe(self, project_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        listeners = self._subs.get(project_id, [])
        if queue in listeners:
            listeners.remove(queue)

    def publish(self, project_id: str, event: dict[str, Any]) -> None:
        for queue in list(self._subs.get(project_id, [])):
            queue.put_nowait(event)
