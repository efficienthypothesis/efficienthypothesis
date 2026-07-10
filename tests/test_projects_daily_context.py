import os
import base64
import datetime
import io
import json
import unittest
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError

os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("OAUTH_SIGNING_KEY", "test")

from app import app
from routes.projects import _normalize_daily_context, _project_calendar_days_for_user, _store_daily_context_image


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

    def test_daily_context_image_is_stored_and_added_to_document(self):
        image_data = base64.b64encode(b"\x89PNG\r\n\x1a\npayload").decode("ascii")
        with patch("routes.projects.s3.get_object", side_effect=s3_error("NoSuchKey")), patch("routes.projects.s3.put_object") as put_object:
            entry = _store_daily_context_image("user@example.com", "acne", "user-1", "2026-07-10", image_data, "Screenshot", filename="nested/photo.png")

        self.assertEqual(entry["type"], "image")
        self.assertEqual(entry["contentType"], "image/png")
        self.assertEqual(entry["filename"], "photo.png")
        image_call = put_object.call_args_list[0].kwargs
        self.assertIn("/daily-context/2026-07-10/images/", image_call["Key"])
        self.assertEqual(image_call["ServerSideEncryption"], "AES256")

    def test_daily_context_image_rejects_non_image_payload(self):
        with self.assertRaises(ValueError):
            _store_daily_context_image("user@example.com", "acne", "user-1", "2026-07-10", base64.b64encode(b"not an image").decode("ascii"), "Invalid")

    def test_daily_context_image_route_returns_private_image(self):
        context = {
            "schemaVersion": 1,
            "userId": "user-1",
            "projectId": "acne",
            "date": "2026-07-10",
            "entries": [{
                "id": "image-1",
                "type": "image",
                "summary": "Screenshot",
                "imageUrl": "/api/projects/acne/daily-context/2026-07-10/images/image-1",
                "contentType": "image/png",
                "filename": "photo.png",
                "createdAt": "2026-07-10T00:00:00Z",
                "updatedAt": "2026-07-10T00:00:00Z",
            }],
            "createdAt": "2026-07-10T00:00:00Z",
            "updatedAt": "2026-07-10T00:00:00Z",
        }
        body = Mock()
        body.read.return_value = b"\x89PNG\r\n\x1a\npayload"
        responses = [{"Body": io.BytesIO(json.dumps(context).encode("utf-8"))}, {"Body": body}]
        with patch("routes.projects.s3.get_object", side_effect=responses):
            response = self.client.get("/api/projects/acne/daily-context/2026-07-10/images/image-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/png")
        self.assertEqual(response.data, b"\x89PNG\r\n\x1a\npayload")

    def test_calendar_counts_image_entries(self):
        def read_context(_email, project_id, _user_id, date):
            return _normalize_daily_context({
                "entries": [{
                    "id": "image-1",
                    "type": "image",
                    "summary": "Screenshot",
                    "imageUrl": f"/api/projects/{project_id}/daily-context/{date}/images/image-1",
                    "contentType": "image/png",
                }]
            }, project_id, "user-1", date)

        with patch("routes.projects._read_daily_context", side_effect=read_context), patch("routes.projects._read_recommendations") as read_recommendations:
            read_recommendations.return_value = {
                "href": "/projects/acne/recommendations/2026-07-10",
                "recommendations": [],
            }
            days = _project_calendar_days_for_user("user@example.com", "user-1", datetime.timezone.utc)

        self.assertEqual(days[0]["projects"][0]["entry_count"], 1)
        self.assertEqual(days[0]["projects"][0]["image_count"], 1)
        self.assertEqual(days[0]["projects"][0]["recommendations_count"], 0)
        self.assertEqual(days[0]["projects"][0]["recommendations_href"], "/projects/acne/recommendations/2026-07-10")

    def test_daily_context_rejects_invalid_date(self):
        response = self.client.get("/api/projects/acne/daily-context/20260710")

        self.assertEqual(response.status_code, 400)

    def test_recommendations_receive_backend_owned_links(self):
        with patch("routes.projects.s3.put_object"):
            response = self.client.put(
                "/api/projects/fitness/recommendations/2026-07-10",
                json={"recommendations": [{
                    "id": "rec-1",
                    "kind": "routine",
                    "title": "Evening routine",
                    "summary": "Use a gentle evening routine.",
                    "steps": [
                        {"item": "benzoyl peroxide", "command": "put on full face"},
                        {"item": "wait", "command": "10 min"},
                        {"item": "retin A", "command": "only spots with acne"},
                    ],
                }]},
            )

        self.assertEqual(response.status_code, 200)
        item = response.get_json()["recommendations"]["recommendations"][0]
        self.assertEqual(item["kind"], "routine")
        self.assertEqual(item["title"], "Evening routine")
        self.assertEqual(item["href"], "/projects/fitness/recommendations/2026-07-10/rec-1")

    def test_recommendations_reject_workout_while_disabled(self):
        response = self.client.put(
            "/api/projects/fitness/recommendations/2026-07-10",
            json={"recommendations": [{
                "id": "rec-1",
                "kind": "workout",
                "title": "Workout",
                "summary": "Do a workout.",
                "steps": [{"item": "run", "command": "20 minutes"}],
            }]},
        )

        self.assertEqual(response.status_code, 400)

    def test_routine_recommendations_require_steps(self):
        response = self.client.put(
            "/api/projects/acne/recommendations/2026-07-10",
            json={"recommendations": [{
                "id": "rec-1",
                "kind": "routine",
                "title": "Morning routine",
                "summary": "Use a gentle routine.",
            }]},
        )

        self.assertEqual(response.status_code, 400)

    def test_recommendations_are_written_as_manifest_and_files(self):
        with patch("routes.projects.s3.put_object") as put_object:
            response = self.client.put(
                "/api/projects/acne/recommendations/2026-07-10",
                json={"recommendations": [{
                    "id": "rec-1",
                    "kind": "routine",
                    "title": "Morning routine",
                    "summary": "Use a gentle routine.",
                    "steps": [
                        {"item": "cleanser", "command": "wash face"},
                        {"item": "moisturizer", "command": "apply thin layer", "clarification": "avoid eye area"},
                    ],
                }]},
            )

        self.assertEqual(response.status_code, 200)
        keys = [call.kwargs["Key"] for call in put_object.call_args_list]
        self.assertIn("user@example.com/projects/acne/recommendations/2026-07-10/files/rec-1.json", keys)
        self.assertIn("user@example.com/projects/acne/recommendations/2026-07-10/manifest.json", keys)
        for call in put_object.call_args_list:
            self.assertEqual(call.kwargs["ServerSideEncryption"], "AES256")

    def test_recommendation_detail_reads_manifest_and_file(self):
        manifest = {
            "schemaVersion": 1,
            "userId": "user-1",
            "projectId": "fitness",
            "date": "2026-07-10",
            "href": "/projects/fitness/recommendations/2026-07-10",
            "recommendations": [{
                "id": "rec-1",
                "kind": "routine",
                "title": "Evening routine",
                "summary": "Use a gentle evening routine.",
                "href": "/projects/fitness/recommendations/2026-07-10/rec-1",
                "contentType": "application/json",
            }],
            "createdAt": "2026-07-10T00:00:00Z",
            "updatedAt": "2026-07-10T00:00:00Z",
        }
        file_document = {
            "schemaVersion": 1,
            "id": "rec-1",
            "projectId": "fitness",
            "date": "2026-07-10",
            "kind": "routine",
            "title": "Evening routine",
            "summary": "Use a gentle evening routine.",
            "steps": [
                {"item": "benzoyl peroxide", "command": "put on full face"},
                {"item": "wait", "command": "10 min"},
            ],
            "createdAt": "2026-07-10T00:00:00Z",
            "updatedAt": "2026-07-10T00:00:00Z",
        }
        responses = [
            {"Body": io.BytesIO(json.dumps(manifest).encode("utf-8"))},
            {"Body": io.BytesIO(json.dumps(file_document).encode("utf-8"))},
        ]
        with patch("routes.projects.s3.get_object", side_effect=responses):
            response = self.client.get("/api/projects/fitness/recommendations/2026-07-10/rec-1")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["recommendation"]["href"], "/projects/fitness/recommendations/2026-07-10/rec-1")
        self.assertEqual(payload["file"]["steps"][0]["item"], "benzoyl peroxide")

    def test_recommendation_pages_render_manifest_and_file(self):
        manifest = {
            "schemaVersion": 1,
            "userId": "user-1",
            "projectId": "fitness",
            "date": "2026-07-10",
            "href": "/projects/fitness/recommendations/2026-07-10",
            "recommendations": [{
                "id": "rec-1",
                "kind": "routine",
                "title": "Evening routine",
                "summary": "Use a gentle evening routine.",
                "href": "/projects/fitness/recommendations/2026-07-10/rec-1",
                "contentType": "application/json",
            }],
            "createdAt": "2026-07-10T00:00:00Z",
            "updatedAt": "2026-07-10T00:00:00Z",
        }
        file_document = {
            "schemaVersion": 1,
            "id": "rec-1",
            "projectId": "fitness",
            "date": "2026-07-10",
            "kind": "routine",
            "title": "Evening routine",
            "summary": "Use a gentle evening routine.",
            "steps": [
                {"item": "benzoyl peroxide", "command": "put on full face"},
                {"item": "wait", "command": "10 min"},
            ],
            "createdAt": "2026-07-10T00:00:00Z",
            "updatedAt": "2026-07-10T00:00:00Z",
        }
        responses = [
            {"Body": io.BytesIO(json.dumps(manifest).encode("utf-8"))},
            {"Body": io.BytesIO(json.dumps(manifest).encode("utf-8"))},
            {"Body": io.BytesIO(json.dumps(file_document).encode("utf-8"))},
        ]
        with patch("routes.projects.s3.get_object", side_effect=responses):
            list_response = self.client.get("/projects/fitness/recommendations/2026-07-10")
            detail_response = self.client.get("/projects/fitness/recommendations/2026-07-10/rec-1")

        self.assertEqual(list_response.status_code, 200)
        self.assertIn(b"Evening routine", list_response.data)
        self.assertEqual(detail_response.status_code, 200)
        self.assertIn(b"benzoyl peroxide", detail_response.data)


if __name__ == "__main__":
    unittest.main()
