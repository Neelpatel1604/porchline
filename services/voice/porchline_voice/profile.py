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
    businessName: str = Field(min_length=1)
    category: str
    summary: str = Field(min_length=1)
    phone: str = Field(min_length=3)
    email: str | None = None
    address: str | None = None
    serviceArea: str | None = None
    hours: dict[str, DayHours]
    services: list[ServiceItem] = Field(min_length=1, max_length=6)
    highlight: str | None = None
    subdomainLabel: str
    confirmed: bool
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
        "subdomainLabel": "",
        "confirmed": False,
        "sourceCallId": source_call_id,
    }


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
    if len(digits) >= 3:
        return "+" + digits
    return ""


def normalize_label(value: str) -> str:
    label = value.strip().lower().replace(" ", "-")
    label = re.sub(r"[^a-z0-9-]", "", label)
    label = re.sub(r"-{2,}", "-", label).strip("-")
    return label


def missing_for_publish(profile: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    if not str(profile.get("businessName") or "").strip():
        missing.append("businessName")
    if profile.get("category") not in CATEGORIES:
        missing.append("category")
    if not str(profile.get("summary") or "").strip():
        missing.append("summary")
    if len(str(profile.get("phone") or "").strip()) < 3:
        missing.append("phone")
    hours = profile.get("hours")
    if not isinstance(hours, dict) or any(day not in hours for day in DAYS):
        missing.append("hours")
    services = profile.get("services")
    if not isinstance(services, list) or not services or len(services) > 6:
        missing.append("services")
    elif any(not str(item.get("name") or "").strip() for item in services if isinstance(item, dict)):
        missing.append("services")
    label = str(profile.get("subdomainLabel") or "")
    if not LABEL_RE.match(label):
        missing.append("subdomainLabel")
    return missing


def validate_confirmed(profile: dict[str, Any]) -> BusinessProfile:
    missing = missing_for_publish(profile)
    if missing:
        raise ValueError("missing " + ", ".join(missing))
    if profile.get("confirmed") is not True:
        raise ValueError("profile is not confirmed")
    model = BusinessProfile.model_validate(profile)
    if not LABEL_RE.match(model.subdomainLabel):
        raise ValueError("invalid subdomainLabel")
    return model


def load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
