"""Business profile drafts and the publish gate."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

DAYS = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)
CATEGORIES = ("food", "personal_care", "home_services", "other")
LABEL_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
SCHEMA_PATH = Path(__file__).resolve().parents[3] / "packages" / "profile.schema.json"


class DayHours(BaseModel):
    closed: bool
    open: str | None = None
    close: str | None = None


class ServiceItem(BaseModel):
    name: str = Field(min_length=1)
    priceLabel: str | None = None
    blurb: str | None = None


class BusinessProfile(BaseModel):
    businessName: str = ""
    category: str = ""
    summary: str = ""
    phone: str = ""
    email: str | None = None
    address: str | None = None
    serviceArea: str | None = None
    hours: dict[str, DayHours] = Field(default_factory=dict)
    services: list[ServiceItem] = Field(default_factory=list, max_length=6)
    highlight: str | None = None
    vibe: str | None = None
    look: str | None = None
    heroLine: str | None = None
    audience: str | None = None
    siteSlug: str = ""
    confirmed: bool = False
    sourceCallId: str = Field(min_length=1)


def empty_profile(source_call_id: str) -> dict[str, Any]:
    return {
        "businessName": "",
        "category": "",
        "summary": "",
        "phone": "",
        "email": None,
        "address": None,
        "serviceArea": None,
        "hours": {},
        "services": [],
        "highlight": None,
        "vibe": None,
        "look": None,
        "heroLine": None,
        "audience": None,
        "siteSlug": "",
        "confirmed": False,
        "sourceCallId": source_call_id,
    }


def profile_has_facts(profile: dict[str, Any] | None) -> bool:
    if not profile:
        return False
    if str(profile.get("businessName") or "").strip():
        return True
    if str(profile.get("phone") or "").strip():
        return True
    if str(profile.get("summary") or "").strip():
        return True
    if isinstance(profile.get("services"), list) and profile["services"]:
        return True
    if isinstance(profile.get("hours"), dict) and profile["hours"]:
        return True
    return False


def seed_profile_from_prior(prior: dict[str, Any], source_call_id: str) -> dict[str, Any]:
    """Copy durable facts into a new call. Fresh transcript; not confirmed until they say so again."""
    seeded = empty_profile(source_call_id)
    prior_profile = prior.get("profile") if "profile" in prior else prior
    if not isinstance(prior_profile, dict):
        return seeded
    for key in seeded:
        if key in {"confirmed", "sourceCallId"}:
            continue
        if key in prior_profile:
            seeded[key] = prior_profile[key]
    seeded["confirmed"] = False
    seeded["sourceCallId"] = source_call_id
    return seeded


def compact_profile_for_prompt(profile: dict[str, Any]) -> dict[str, Any]:
    """Drop empty fields so the realtime instructions stay short."""
    compact: dict[str, Any] = {}
    for key, value in profile.items():
        if key in {"confirmed", "sourceCallId"}:
            continue
        if value is None or value == "" or value == [] or value == {}:
            continue
        compact[key] = value
    return compact



_DIGIT_WORDS = {
    "zero": "0",
    "oh": "0",
    "o": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "for": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "ate": "8",
    "nine": "9",
}
_FOOD_WORDS = (
    "restaurant",
    "cafe",
    "coffee",
    "bakery",
    "food",
    "meal",
    "kitchen",
    "pizza",
    "diner",
    "catering",
    "bar",
)
_CARE_WORDS = ("barber", "salon", "hair", "spa", "nail", "beauty", "personal care")
_HOME_WORDS = (
    "plumb",
    "electric",
    "clean",
    "hvac",
    "landscap",
    "handyman",
    "repair",
    "home service",
    "home care",
)


def _mentions(text: str, word: str) -> bool:
    if " " in word:
        return word in text
    if word in {"bar", "spa", "nail", "hair", "food"}:
        return re.search(rf"\b{re.escape(word)}\b", text) is not None
    return re.search(rf"\b{re.escape(word)}", text) is not None


def normalize_category(value: str) -> str:
    text = re.sub(r"\s+", " ", value.strip().lower().replace("_", " ").replace("-", " "))
    compact = text.replace(" ", "_")
    if compact in CATEGORIES:
        return compact
    if any(_mentions(text, word) for word in _CARE_WORDS):
        return "personal_care"
    if any(_mentions(text, word) for word in _HOME_WORDS):
        return "home_services"
    if any(_mentions(text, word) for word in _FOOD_WORDS):
        return "food"
    if text:
        return "other"
    return ""


def normalize_phone(value: Any) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float):
        value = int(value) if value.is_integer() else value
    if isinstance(value, int):
        digits = str(abs(value))
    else:
        words = [
            word
            for word in re.sub(r"[,.]", " ", str(value).strip().lower()).replace("-", " ").split()
            if word not in {"plus", "number", "phone"}
        ]
        if words and all(word in _DIGIT_WORDS or word.isdigit() for word in words):
            digits = "".join(_DIGIT_WORDS.get(word, word) for word in words)
        else:
            digits = "".join(character for character in str(value) if character.isdigit())
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    # Reject short fragments - they are usually STT cuts, not real phones.
    return ""


def normalize_label(value: str) -> str:
    label = value.strip().lower().replace(" ", "-")
    label = re.sub(r"[^a-z0-9-]", "", label)
    label = re.sub(r"-{2,}", "-", label).strip("-")
    return label


def missing_for_publish(profile: dict[str, Any]) -> list[str]:
    """Require a real business name before publish so we never invent one."""
    missing: list[str] = []
    if not str(profile.get("businessName") or "").strip():
        missing.append("businessName")
    return missing


def prepare_for_publish(profile: dict[str, Any]) -> dict[str, Any]:
    prepared = dict(profile)
    # Do not invent a brand name or marketing summary. Missing name is blocked upstream.
    if prepared.get("category") not in CATEGORIES:
        prepared["category"] = "other"
    if not str(prepared.get("summary") or "").strip():
        name = str(prepared.get("businessName") or "").strip()
        prepared["summary"] = f"{name}." if name else ""
    # Accept old drafts that still carry subdomainLabel.
    if not str(prepared.get("siteSlug") or "").strip() and prepared.get("subdomainLabel"):
        prepared["siteSlug"] = prepared.get("subdomainLabel")
    prepared.pop("subdomainLabel", None)
    label = str(prepared.get("siteSlug") or "").strip()
    if not LABEL_RE.match(label):
        prepared["siteSlug"] = normalize_label(str(prepared.get("businessName") or "shop")) or "shop"
    if not isinstance(prepared.get("hours"), dict):
        prepared["hours"] = {}
    if not isinstance(prepared.get("services"), list):
        prepared["services"] = []
    return prepared


def validate_confirmed(profile: dict[str, Any]) -> BusinessProfile:
    if profile.get("confirmed") is not True:
        raise ValueError("profile is not confirmed")
    prepared = prepare_for_publish(profile)
    return BusinessProfile.model_validate(prepared)


def load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
