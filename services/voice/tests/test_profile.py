"""Publish gate tests. Run from the repo root with the voice venv."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services" / "voice"))

from porchline_voice.profile import (  # noqa: E402
    empty_profile,
    missing_for_publish,
    normalize_category,
    normalize_label,
    normalize_phone,
    prepare_for_publish,
    validate_confirmed,
)


FIXTURE = json.loads((ROOT / "fixtures" / "rose-barber.json").read_text(encoding="utf-8"))


class ProfileTests(unittest.TestCase):
    def test_fixture_is_publishable(self) -> None:
        self.assertEqual(missing_for_publish(FIXTURE), [])
        model = validate_confirmed(FIXTURE)
        self.assertEqual(model.businessName, "Rose Street Barber")
        self.assertTrue(model.confirmed)

    def test_sparse_profile_can_publish(self) -> None:
        draft = empty_profile("call-1")
        draft["confirmed"] = True
        self.assertEqual(missing_for_publish(draft), [])
        model = validate_confirmed(draft)
        self.assertEqual(model.businessName, "Local business")
        self.assertEqual(model.siteSlug, "local-business")

    def test_unconfirmed_profile_is_refused(self) -> None:
        draft = dict(FIXTURE)
        draft["confirmed"] = False
        self.assertEqual(missing_for_publish(draft), [])
        with self.assertRaises(ValueError):
            validate_confirmed(draft)

    def test_empty_draft_has_no_required_gaps(self) -> None:
        self.assertEqual(missing_for_publish(empty_profile("call-1")), [])

    def test_prepare_fills_missing_site_slug(self) -> None:
        prepared = prepare_for_publish({"businessName": "Neel Builds", "confirmed": True, "sourceCallId": "x"})
        self.assertEqual(prepared["siteSlug"], "neel-builds")
        self.assertNotIn("subdomainLabel", prepared)

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


if __name__ == "__main__":
    unittest.main()
