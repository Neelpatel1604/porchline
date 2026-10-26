"""Higgs tool handlers. Each one writes the stored profile, not the transcript."""

from __future__ import annotations

from typing import Any

from porchline_voice.events import EventHub
from porchline_voice.profile import (
    missing_for_publish,
    normalize_category,
    normalize_phone,
    prepare_for_publish,
)
from porchline_voice.publish_client import request_publish
from porchline_voice.sms import send_site_sms
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
            self.save_site_style,
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

    def _note_save(self, saved: list[str], profile: dict[str, Any]) -> None:
        """Append a ground-truth line so the dashboard shows what landed in the DB, not only STT."""
        if not saved:
            return
        parts: list[str] = []
        for key in saved:
            value = profile.get(key)
            if key == "services" and isinstance(value, list) and value:
                last = value[-1]
                label = last.get("name", "")
                price = last.get("priceLabel")
                parts.append(f"service={label}" + (f" ({price})" if price else ""))
            elif key == "hours" and isinstance(value, dict):
                parts.append(f"hours updated ({len(value)} days)")
            elif value is not None and value != "":
                parts.append(f"{key}={value}")
            else:
                parts.append(key)
        project = self.store.append_transcript(self.project_id, "save", "Saved: " + "; ".join(parts))
        self.hub.publish(self.project_id, {"type": "transcript", "project": project})

    async def save_business_basics(
        self,
        params: FunctionCallParams,
        businessName: str = "",
        category: str = "",
        summary: str = "",
    ) -> None:
        """Save the exact business name, category, or summary the owner just said. Never invent or clean up unclear speech into a different name.

        Args:
            businessName: Exact display name they said, or empty to leave it unchanged.
            category: What the shop does, in their words. A restaurant becomes food. A barber becomes personal_care. A plumber becomes home_services. Anything else becomes other.
            summary: Exact one or two sentences they gave, or empty to leave it unchanged.
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
        self._note_save(saved, profile)
        await params.result_callback({"ok": True, "saved": saved, "category": profile.get("category")})

    async def save_contact(
        self,
        params: FunctionCallParams,
        phone: str = "",
        email: str = "",
        address: str = "",
        serviceArea: str = "",
    ) -> None:
        """Save the public phone and optional email, address, or service area. Never invent an email or address.

        Args:
            phone: Public phone number. Spoken digits such as "three six five" are valid. Empty leaves the stored phone unchanged.
            email: Exact email they spelled or said, or empty to leave it unchanged. Do not invent domains.
            address: Public street address they gave, or empty to leave it unchanged.
            serviceArea: Neighborhood or city they named, or empty to leave it unchanged.
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
            self._note_save(saved, profile)
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
        """Save the days the owner just gave. Each day is 'closed' or 'HH:MM-HH:MM' in 24-hour time. If they say every day 11am-11pm, set all seven days to 11:00-23:00.

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
        self._note_save(["hours"], profile)
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
        self._note_save(["services"], profile)
        await params.result_callback({"ok": True, "count": len(services)})

    async def save_site_style(
        self,
        params: FunctionCallParams,
        vibe: str = "",
        look: str = "",
        heroLine: str = "",
        audience: str = "",
        highlight: str = "",
    ) -> None:
        """Save optional design notes for the page builder.

        Args:
            vibe: Feel of the shop, such as warm, modern, or classic. Empty leaves it unchanged.
            look: Color or visual direction in their words. Empty leaves it unchanged.
            heroLine: Short headline for the top of the page. Empty leaves it unchanged.
            audience: Who the page should speak to. Empty leaves it unchanged.
            highlight: Optional note such as parking, walk-ins, or languages. Empty leaves it unchanged.
        """
        profile = self._profile()
        saved: list[str] = []
        if vibe.strip():
            profile["vibe"] = vibe.strip()
            saved.append("vibe")
        if look.strip():
            profile["look"] = look.strip()
            saved.append("look")
        if heroLine.strip():
            profile["heroLine"] = heroLine.strip()
            saved.append("heroLine")
        if audience.strip():
            profile["audience"] = audience.strip()
            saved.append("audience")
        if highlight.strip():
            profile["highlight"] = highlight.strip()
            saved.append("highlight")
        if not saved:
            await params.result_callback({"ok": False, "message": "nothing to save"})
            return
        profile["confirmed"] = False
        self._write(profile)
        self._note_save(saved, profile)
        await params.result_callback({"ok": True, "saved": saved})

    async def read_profile(self, params: FunctionCallParams) -> None:
        """Return the stored profile so the read-back matches the database."""
        profile = self._profile()
        await params.result_callback({"ok": True, "profile": profile, "missing": missing_for_publish(profile)})

    async def publish_profile(self, params: FunctionCallParams) -> None:
        """Publish after the owner clearly agrees. Requires a saved business name."""
        current = self._profile()
        missing = missing_for_publish(current)
        if missing:
            await params.result_callback(
                {
                    "ok": False,
                    "missing": missing,
                    "message": "Ask for the business name, save it after they confirm, then publish again.",
                }
            )
            return
        profile = prepare_for_publish(current)
        profile["confirmed"] = True
        project = self._write(profile, status="designing")
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
        sms_to = str(profile.get("phone") or "").strip() or str(saved.get("callerId") or "")
        sms = send_site_sms(
            to_number=sms_to,
            preview_url=str(result.get("previewUrl") or ""),
            business_name=str(profile.get("businessName") or ""),
        )
        await params.result_callback(
            {
                "ok": True,
                "previewUrl": result.get("previewUrl"),
                "hostname": result.get("hostname"),
                "sms": sms,
                "message": (
                    "Site published. Text message sent with the link. "
                    if sms.get("ok")
                    else f"Site published. Text failed: {sms.get('message')}. Speak the preview link. "
                )
                + "Say a short goodbye when done.",
            }
        )
