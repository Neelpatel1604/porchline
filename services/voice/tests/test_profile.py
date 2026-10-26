"""Publish gate tests. Run from the repo root with the voice venv."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services" / "voice"))

from porchline_voice.profile import (  # noqa: E402
    compact_profile_for_prompt,
    empty_profile,
    missing_for_publish,
    normalize_category,
    normalize_label,
    normalize_phone,
    prepare_for_publish,
    profile_has_facts,
    seed_profile_from_prior,
    validate_confirmed,
)


FIXTURE = json.loads((ROOT / "fixtures" / "rose-barber.json").read_text(encoding="utf-8"))


class ProfileTests(unittest.TestCase):
    def test_fixture_is_publishable(self) -> None:
        self.assertEqual(missing_for_publish(FIXTURE), [])
        model = validate_confirmed(FIXTURE)
        self.assertEqual(model.businessName, "Rose Street Barber")
        self.assertTrue(model.confirmed)

    def test_empty_draft_requires_business_name(self) -> None:
        draft = empty_profile("call-1")
        self.assertEqual(missing_for_publish(draft), ["businessName"])

    def test_sparse_named_profile_can_publish(self) -> None:
        draft = empty_profile("call-1")
        draft["businessName"] = "Neel Builds"
        draft["confirmed"] = True
        self.assertEqual(missing_for_publish(draft), [])
        model = validate_confirmed(draft)
        self.assertEqual(model.businessName, "Neel Builds")
        self.assertEqual(model.siteSlug, "neel-builds")
        self.assertEqual(model.summary, "Neel Builds.")

    def test_unconfirmed_profile_is_refused(self) -> None:
        draft = dict(FIXTURE)
        draft["confirmed"] = False
        self.assertEqual(missing_for_publish(draft), [])
        with self.assertRaises(ValueError):
            validate_confirmed(draft)

    def test_prepare_fills_missing_site_slug(self) -> None:
        prepared = prepare_for_publish({"businessName": "Neel Builds", "confirmed": True, "sourceCallId": "x"})
        self.assertEqual(prepared["siteSlug"], "neel-builds")
        self.assertNotIn("subdomainLabel", prepared)

    def test_prepare_does_not_invent_local_business(self) -> None:
        prepared = prepare_for_publish({"businessName": "", "confirmed": True, "sourceCallId": "x"})
        self.assertEqual(prepared["businessName"], "")
        self.assertNotEqual(prepared.get("summary"), "A local business page built with Porchline.")

    def test_seed_and_compact_profile(self) -> None:
        prior = {"profile": FIXTURE, "netlifySiteId": "site-1"}
        seeded = seed_profile_from_prior(prior, "call-2")
        self.assertEqual(seeded["businessName"], "Rose Street Barber")
        self.assertFalse(seeded["confirmed"])
        self.assertEqual(seeded["sourceCallId"], "call-2")
        self.assertTrue(profile_has_facts(seeded))
        compact = compact_profile_for_prompt(seeded)
        self.assertIn("businessName", compact)
        self.assertNotIn("confirmed", compact)

    def test_label_normalization(self) -> None:
        self.assertEqual(normalize_label("Rose Barber!"), "rose-barber")

    def test_everyday_business_words_map_to_a_category(self) -> None:
        self.assertEqual(normalize_category("it's a restaurant"), "food")
        self.assertEqual(normalize_category("barber shop"), "personal_care")
        self.assertEqual(normalize_category("home care"), "home_services")
        self.assertEqual(normalize_category("bookstore"), "other")

    def test_spoken_phone_becomes_a_stored_number(self) -> None:
        self.assertEqual(normalize_phone("Three six five nine nine eight one four eight four"), "+13659981484")
        self.assertEqual(normalize_phone(3659981484), "+13659981484")
        self.assertEqual(normalize_phone("+1 365-998-1484"), "+13659981484")
        self.assertEqual(normalize_phone("365"), "")


if __name__ == "__main__":
    unittest.main()
