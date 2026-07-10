import os
import unittest
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError

os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("OAUTH_SIGNING_KEY", "test")

from app import app
from routes.projects import _normalize_daily_context


def s3_error(code):
    return ClientError({"Error": {"Code": code}}, "GetObject")


class DailyContextTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.client = app.test_client()
        with self.client.session_transaction() as session:
            session["user"] = {"id": "user-1", "email": "user@example.com"}

    def test_daily_context_normalizes_minimal_entries(self):
        context = _normalize_daily_context(
            {"entries": [{"id": "entry-1", "time": "08:30", "summary": "Did the thing."}]},
            "acne",
            "user-1",
            "2026-07-10",
        )

        self.assertEqual(context["projectId"], "acne")
        self.assertEqual(context["date"], "2026-07-10")
        self.assertEqual(context["entries"][0]["summary"], "Did the thing.")
        self.assertEqual(context["entries"][0]["time"], "08:30")

    def test_daily_context_get_missing_object_returns_empty_document(self):
        with patch("routes.projects.s3.get_object", side_effect=s3_error("NoSuchKey")):
            response = self.client.get("/api/projects/acne/daily-context/2026-07-10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["dailyContext"]["entries"], [])

    def test_daily_context_put_writes_user_scoped_document(self):
        with patch("routes.projects.s3.put_object") as put_object:
            response = self.client.put(
                "/api/projects/acne/daily-context/2026-07-10",
                json={"entries": [{"id": "entry-1", "summary": "Did the thing."}]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(put_object.call_args.kwargs["Key"], "user@example.com/projects/acne/daily-context/2026-07-10.json")

    def test_daily_context_rejects_invalid_date(self):
        response = self.client.get("/api/projects/acne/daily-context/20260710")

        self.assertEqual(response.status_code, 400)

    def test_recommendations_receive_backend_owned_links(self):
        with patch("routes.projects.s3.put_object"):
            response = self.client.put(
                "/api/projects/fitness/recommendations/2026-07-10",
                json={"recommendations": [{"id": "rec-1", "summary": "Prioritize recovery."}]},
            )

        self.assertEqual(response.status_code, 200)
        item = response.get_json()["recommendations"]["recommendations"][0]
        self.assertEqual(item["href"], "/api/projects/fitness/recommendations/2026-07-10/rec-1")


if __name__ == "__main__":
    unittest.main()
