"""SQLite store for one shop project at a time."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = path
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              caller_id TEXT NOT NULL,
              status TEXT NOT NULL,
              profile_json TEXT NOT NULL,
              transcript_json TEXT NOT NULL,
              netlify_site_id TEXT,
              preview_url TEXT,
              hostname TEXT,
              error TEXT,
              call_started_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            """
        )
        self._conn.commit()
        columns = {row[1] for row in self._conn.execute("PRAGMA table_info(projects)")}
        if "call_ended_at" not in columns:
            self._conn.execute("ALTER TABLE projects ADD COLUMN call_ended_at TEXT")
            self._conn.commit()
        # Older DBs may still have unused cname_target / cloudflare_record_id columns.

    def close_stale_open_calls(self, max_idle_seconds: int = 25) -> None:
        """Mark abandoned sockets as ended so the dashboard never shows a fake live call."""
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=max_idle_seconds)).isoformat()
        self._conn.execute(
            """
            UPDATE projects
            SET call_ended_at = COALESCE(call_ended_at, ?), updated_at = ?
            WHERE call_ended_at IS NULL
              AND call_started_at IS NOT NULL
              AND updated_at < ?
            """,
            (_now(), _now(), cutoff),
        )
        self._conn.commit()

    def current(self) -> dict[str, Any] | None:
        self.close_stale_open_calls()
        row = self._conn.execute(
            "SELECT * FROM projects ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
        return self._row(row) if row else None

    def list_projects(self, limit: int = 50) -> list[dict[str, Any]]:
        self.close_stale_open_calls()
        rows = self._conn.execute(
            """
            SELECT * FROM projects
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [self._row(row) for row in rows]

    def get(self, project_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        return self._row(row) if row else None

    def find_open_by_caller(self, caller_id: str) -> dict[str, Any] | None:
        """Active call for this number (call not marked ended yet). Used only for hangup status."""
        row = self._conn.execute(
            """
            SELECT * FROM projects
            WHERE caller_id = ?
              AND call_ended_at IS NULL
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (caller_id,),
        ).fetchone()
        return self._row(row) if row else None

    def find_latest_by_caller(self, caller_id: str) -> dict[str, Any] | None:
        """Most recent project for this phone - used to resume a saved profile on the next call."""
        row = self._conn.execute(
            """
            SELECT * FROM projects
            WHERE caller_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (caller_id,),
        ).fetchone()
        return self._row(row) if row else None

    def create(
        self,
        caller_id: str,
        source_call_id: str,
        profile: dict[str, Any],
        netlify_site_id: str | None = None,
    ) -> dict[str, Any]:
        project_id = str(uuid.uuid4())
        now = _now()
        self._conn.execute(
            """
            INSERT INTO projects (
              id, caller_id, status, profile_json, transcript_json,
              netlify_site_id, call_started_at, created_at, updated_at
            ) VALUES (?, ?, 'draft', ?, '[]', ?, ?, ?, ?)
            """,
            (project_id, caller_id, json.dumps(profile), netlify_site_id, now, now, now),
        )
        self._conn.commit()
        created = self.get(project_id)
        if created is None:
            raise RuntimeError("project insert failed")
        return created

    def save_profile(self, project_id: str, profile: dict[str, Any], status: str | None = None) -> dict[str, Any]:
        fields = ["profile_json = ?", "updated_at = ?"]
        values: list[Any] = [json.dumps(profile), _now()]
        if status:
            fields.append("status = ?")
            values.append(status)
        values.append(project_id)
        self._conn.execute(
            f"UPDATE projects SET {', '.join(fields)} WHERE id = ?",
            values,
        )
        self._conn.commit()
        saved = self.get(project_id)
        if saved is None:
            raise KeyError(project_id)
        return saved

    def append_transcript(self, project_id: str, role: str, text: str) -> dict[str, Any]:
        project = self.get(project_id)
        if project is None:
            raise KeyError(project_id)
        transcript = project["transcript"]
        transcript.append({"role": role, "text": text, "at": _now()})
        self._conn.execute(
            "UPDATE projects SET transcript_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(transcript), _now(), project_id),
        )
        self._conn.commit()
        saved = self.get(project_id)
        if saved is None:
            raise KeyError(project_id)
        return saved

    def mark_call_started(self, project_id: str) -> None:
        now = _now()
        self._conn.execute(
            """
            UPDATE projects
            SET call_started_at = ?, call_ended_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (now, now, project_id),
        )
        self._conn.commit()

    def mark_call_ended(self, project_id: str) -> dict[str, Any] | None:
        project = self.get(project_id)
        if project is None or project.get("callEndedAt"):
            return project
        now = _now()
        self._conn.execute(
            "UPDATE projects SET call_ended_at = ?, updated_at = ? WHERE id = ?",
            (now, now, project_id),
        )
        self._conn.commit()
        return self.get(project_id)

    def set_status(self, project_id: str, status: str, error: str | None = None) -> dict[str, Any]:
        self._conn.execute(
            "UPDATE projects SET status = ?, error = ?, updated_at = ? WHERE id = ?",
            (status, error, _now(), project_id),
        )
        self._conn.commit()
        saved = self.get(project_id)
        if saved is None:
            raise KeyError(project_id)
        return saved

    def save_deploy(self, project_id: str, result: dict[str, Any]) -> dict[str, Any]:
        status = "deployed" if result.get("status") == "deployed" else "error"
        self._conn.execute(
            """
            UPDATE projects SET
              status = ?,
              error = ?,
              netlify_site_id = ?,
              preview_url = ?,
              hostname = ?,
              updated_at = ?
            WHERE id = ?
            """,
            (
                status,
                result.get("message") if status == "error" else None,
                result.get("netlifySiteId"),
                result.get("previewUrl"),
                result.get("hostname"),
                _now(),
                project_id,
            ),
        )
        self._conn.commit()
        saved = self.get(project_id)
        if saved is None:
            raise KeyError(project_id)
        return saved

    def delete_project(self, project_id: str) -> bool:
        cur = self._conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        self._conn.commit()
        return cur.rowcount > 0

    def delete_caller(self, caller_id: str) -> int:
        cur = self._conn.execute("DELETE FROM projects WHERE caller_id = ?", (caller_id,))
        self._conn.commit()
        return int(cur.rowcount)

    def list_projects_for_caller(self, caller_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT * FROM projects
            WHERE caller_id = ?
            ORDER BY updated_at DESC
            """,
            (caller_id,),
        ).fetchall()
        return [self._row(row) for row in rows]

    def list_contacts(self) -> list[dict[str, Any]]:
        """One row per caller with latest profile and call-frequency stats."""
        self.close_stale_open_calls()
        rows = self._conn.execute(
            """
            SELECT * FROM projects
            ORDER BY updated_at DESC
            """
        ).fetchall()
        by_caller: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            project = self._row(row)
            caller = str(project.get("callerId") or "unknown")
            by_caller.setdefault(caller, []).append(project)

        contacts: list[dict[str, Any]] = []
        for caller_id, projects in by_caller.items():
            latest = projects[0]
            # Prefer the newest project that actually has a business name for display/edit.
            profile_source = latest
            for project in projects:
                profile_candidate = project.get("profile") if isinstance(project.get("profile"), dict) else {}
                if str(profile_candidate.get("businessName") or "").strip():
                    profile_source = project
                    break
            stamps: list[datetime] = []
            for project in projects:
                for key in ("callStartedAt", "createdAt", "updatedAt"):
                    raw = project.get(key)
                    if not raw:
                        continue
                    try:
                        stamps.append(datetime.fromisoformat(str(raw).replace("Z", "+00:00")))
                        break
                    except ValueError:
                        continue
            stamps.sort()
            first_at = stamps[0].isoformat() if stamps else latest.get("createdAt")
            last_at = stamps[-1].isoformat() if stamps else latest.get("updatedAt")
            avg_days: float | None = None
            if len(stamps) >= 2:
                span = (stamps[-1] - stamps[0]).total_seconds() / 86400.0
                avg_days = round(span / (len(stamps) - 1), 1)

            call_count = len(projects)
            if call_count >= 4:
                cadence = "Frequent"
            elif call_count >= 2:
                cadence = "Returning"
            else:
                cadence = "New"

            profile = (
                profile_source.get("profile")
                if isinstance(profile_source.get("profile"), dict)
                else {}
            )
            phone = str(profile.get("phone") or "").strip() or caller_id
            contacts.append(
                {
                    "callerId": caller_id,
                    "businessName": str(profile.get("businessName") or "").strip() or None,
                    "phone": phone,
                    "email": profile.get("email"),
                    "category": profile.get("category") or None,
                    "status": latest.get("status"),
                    "previewUrl": latest.get("previewUrl") or profile_source.get("previewUrl"),
                    "hostname": latest.get("hostname") or profile_source.get("hostname"),
                    "latestProjectId": profile_source.get("id"),
                    "callCount": call_count,
                    "cadence": cadence,
                    "avgDaysBetweenCalls": avg_days,
                    "firstCallAt": first_at,
                    "lastCallAt": last_at,
                    "updatedAt": latest.get("updatedAt"),
                    "profile": profile,
                }
            )

        contacts.sort(key=lambda item: str(item.get("lastCallAt") or ""), reverse=True)
        return contacts

    def get_contact(self, caller_id: str) -> dict[str, Any] | None:
        projects = self.list_projects_for_caller(caller_id)
        if not projects:
            return None
        summary = next((item for item in self.list_contacts() if item["callerId"] == caller_id), None)
        if summary is None:
            return None
        return {**summary, "projects": projects}

    def _row(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "callerId": row["caller_id"],
            "status": row["status"],
            "profile": json.loads(row["profile_json"]),
            "transcript": json.loads(row["transcript_json"]),
            "netlifySiteId": row["netlify_site_id"],
            "previewUrl": row["preview_url"],
            "hostname": row["hostname"],
            "error": row["error"],
            "callStartedAt": row["call_started_at"],
            "callEndedAt": row["call_ended_at"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
