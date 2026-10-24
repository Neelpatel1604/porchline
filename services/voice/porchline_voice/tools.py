"""Higgs tool handlers. Each one writes the stored profile, not the transcript."""

from __future__ import annotations

from typing import Any

from porchline_voice.events import EventHub
from porchline_voice.profile import (
    missing_for_publish,
    normalize_category,
    normalize_label,
    normalize_phone,
)
from porchline_voice.publish_client import request_publish
from porchline_voice.store import Store

try:
    from pipecat.services.llm_service import FunctionCallParams
except ImportError:  # pragma: no cover - allows unit tests before pipecat is imported
    FunctionCallParams = Any  # type: ignore[misc,assignment]


def _parse_day(value: str) -> dict[str, Any]:
    text = value.strip().lower()
    if text in {"closed", "close", "shut"}:
        return {"closed": True, "open": None, "close": None}
    if "-" not in text:
        raise ValueError("use closed or HH:MM-HH:MM")
    open_at, close_at = [part.strip() for part in text.split("-", 1)]
    return {"closed": False, "open": open_at, "close": close_at}


class ToolKit:
    def __init__(self, store: Store, hub: EventHub, project_id: str) -> None:
        self.store = store
        self.hub = hub
        self.project_id = project_id

    def handlers(self) -> list[Any]:
        return [
            self.save_business_basics,
            self.save_contact,
            self.save_hours,
            self.add_service,
            self.set_subdomain_label,
            self.read_profile,
            self.publish_profile,
        ]

    def _profile(self) -> dict[str, Any]:
        project = self.store.get(self.project_id)
        if project is None:
            raise KeyError(self.project_id)
        return project["profile"]

    def _write(self, profile: dict[str, Any], status: str | None = None) -> dict[str, Any]:
        project = self.store.save_profile(self.project_id, profile, status)
        self.hub.publish(self.project_id, {"type": "profile", "project": project})
        return project

    async def save_business_basics(
        self,
        params: FunctionCallParams,
        businessName: str = "",
        category: str = "",
        summary: str = "",
    ) -> None:
        """Save whichever of the name, category, or summary the owner just gave.

        Args:
            businessName: Display name of the shop, or empty to leave it unchanged.
            category: What the shop does, in their words. A restaurant becomes food. A barber becomes personal_care. A plumber becomes home_services. Anything else becomes other.
            summary: One or two sentences a new customer should know, or empty to leave it unchanged.
        """
        profile = self._profile()
        saved: list[str] = []
        if businessName.strip():
            profile["businessName"] = businessName.strip()
            saved.append("businessName")
        mapped = normalize_category(category)
        if mapped:
            profile["category"] = mapped
            saved.append("category")
        if summary.strip():
            profile["summary"] = summary.strip()
            saved.append("summary")
        if not saved:
            await params.result_callback({"ok": False, "message": "nothing to save"})
            return
        profile["confirmed"] = False
        self._write(profile)
        await params.result_callback({"ok": True, "saved": saved, "category": profile.get("category")})

    async def save_contact(
        self,
        params: FunctionCallParams,
        phone: str = "",
        email: str = "",
        address: str = "",
        serviceArea: str = "",
    ) -> None:
        """Save the public phone and optional email, address, or service area.

        Args:
            phone: Public phone number. Spoken digits such as "three six five" are valid. Empty leaves the stored phone unchanged.
            email: Public email, or empty to leave it unchanged.
            address: Public street address, or empty to leave it unchanged.
            serviceArea: Neighborhood or city served, or empty to leave it unchanged.
        """
        profile = self._profile()
        saved: list[str] = []
        phone_error = ""
        if str(phone).strip():
            normalized = normalize_phone(phone)
            if not normalized:
                phone_error = "Could not read the phone number. Ask them to repeat the digits."
            else:
                profile["phone"] = normalized
                saved.append("phone")
        if email.strip():
            profile["email"] = email.strip()
            saved.append("email")
        if address.strip():
            profile["address"] = address.strip()
            saved.append("address")
        if serviceArea.strip():
            profile["serviceArea"] = serviceArea.strip()
            saved.append("serviceArea")
        if saved:
            profile["confirmed"] = False
            self._write(profile)
        if phone_error:
            await params.result_callback({"ok": False, "message": phone_error, "saved": saved})
            return
        if not saved:
            await params.result_callback({"ok": False, "message": "nothing to save"})
            return
        await params.result_callback({"ok": True, "saved": saved, "phone": profile.get("phone")})

    async def save_hours(
        self,
        params: FunctionCallParams,
        monday: str = "",
        tuesday: str = "",
        wednesday: str = "",
        thursday: str = "",
        friday: str = "",
        saturday: str = "",
        sunday: str = "",
    ) -> None:
        """Save the days the owner just gave. Each day is 'closed' or 'HH:MM-HH:MM'.

        Args:
            monday: Monday hours, or empty to leave Monday unchanged.
            tuesday: Tuesday hours, or empty to leave Tuesday unchanged.
            wednesday: Wednesday hours, or empty to leave Wednesday unchanged.
            thursday: Thursday hours, or empty to leave Thursday unchanged.
            friday: Friday hours, or empty to leave Friday unchanged.
            saturday: Saturday hours, or empty to leave Saturday unchanged.
            sunday: Sunday hours, or empty to leave Sunday unchanged.
        """
        raw = {
            "monday": monday,
            "tuesday": tuesday,
            "wednesday": wednesday,
            "thursday": thursday,
            "friday": friday,
            "saturday": saturday,
            "sunday": sunday,
        }
        provided = {day: value for day, value in raw.items() if value.strip()}
        if not provided:
            await params.result_callback({"ok": False, "message": "no days to save"})
            return
        try:
            parsed = {day: _parse_day(value) for day, value in provided.items()}
        except ValueError as exc:
            await params.result_callback({"ok": False, "message": str(exc)})
            return
        profile = self._profile()
        hours = dict(profile.get("hours") or {})
        hours.update(parsed)
        profile["hours"] = hours
        profile["confirmed"] = False
        self._write(profile)
        await params.result_callback({"ok": True, "hours": hours})

    async def add_service(
        self,
        params: FunctionCallParams,
        name: str,
        priceLabel: str = "",
        blurb: str = "",
    ) -> None:
        """Add one service or menu item. At most six.

        Args:
            name: Service name.
            priceLabel: Spoken price as text, such as '$28', or empty.
            blurb: Short note, or empty.
        """
        profile = self._profile()
        services = list(profile.get("services") or [])
        if len(services) >= 6:
            await params.result_callback({"ok": False, "message": "six services already saved"})
            return
        services.append(
            {
                "name": name.strip(),
                "priceLabel": priceLabel.strip() or None,
                "blurb": blurb.strip() or None,
            }
        )
        profile["services"] = services
        profile["confirmed"] = False
        self._write(profile)
        await params.result_callback({"ok": True, "count": len(services)})

    async def set_subdomain_label(self, params: FunctionCallParams, label: str) -> None:
        """Save the subdomain label. The parent domain is added by the server.

        Args:
            label: Hostname label such as rose-barber.
        """
        normalized = normalize_label(label)
        if not normalized:
            await params.result_callback({"ok": False, "message": "label is empty"})
            return
        profile = self._profile()
        profile["subdomainLabel"] = normalized
        profile["confirmed"] = False
        self._write(profile)
        await params.result_callback({"ok": True, "subdomainLabel": normalized})

    async def read_profile(self, params: FunctionCallParams) -> None:
        """Return the stored profile so the read-back matches the database."""
        profile = self._profile()
        await params.result_callback({"ok": True, "profile": profile, "missing": missing_for_publish(profile)})

    async def publish_profile(self, params: FunctionCallParams) -> None:
        """Publish only after the owner clearly agrees. Refuses incomplete profiles."""
        profile = self._profile()
        missing = missing_for_publish(profile)
        if missing:
            await params.result_callback({"ok": False, "missing": missing})
            return
        profile["confirmed"] = True
        project = self._write(profile, status="deploying")
        self.hub.publish(self.project_id, {"type": "status", "project": project})
        result = await request_publish(project)
        if result.get("status") == "error":
            failed = self.store.set_status(self.project_id, "error", result.get("message"))
            self.hub.publish(self.project_id, {"type": "error", "project": failed})
            await params.result_callback(
                {
                    "ok": False,
                    "message": "The details are saved. The publish step needs another try.",
                    "detail": result.get("message"),
                }
            )
            return
        saved = self.store.save_deploy(self.project_id, result)
        self.hub.publish(self.project_id, {"type": "status", "project": saved})
        await params.result_callback(
            {
                "ok": True,
                "previewUrl": result.get("previewUrl"),
                "hostname": result.get("hostname"),
                "dnsStatus": result.get("dnsStatus"),
            }
        )
