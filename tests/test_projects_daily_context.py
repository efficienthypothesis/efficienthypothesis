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
from routes.projects import _default_global_context, _normalize_daily_context, _normalize_global_context, _project_calendar_days_for_user, _read_recommendation_context, _store_daily_context_image, _write_research_item


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

    def test_acne_global_context_includes_locked_assessment_fields(self):
        context = _default_global_context("acne", "user-1")

        self.assertEqual([group["id"] for group in context["assessmentFields"]], [
            "baumann_skin_type",
            "fitzpatrick_phototype",
            "genetic_scarring_tendency",
            "anatomical_pore_size_distribution",
        ])
        baumann = context["assessmentFields"][0]
        self.assertEqual([field["id"] for field in baumann["fields"]], ["o_vs_d", "s_vs_r", "p_vs_n", "w_vs_t"])
        self.assertTrue(all(field["value"] == "unknown" for group in context["assessmentFields"] for field in group["fields"]))

    def test_acne_assessment_fields_preserve_existing_values_and_drop_unknown_fields(self):
        existing = _default_global_context("acne", "user-1")
        existing["assessmentFields"][0]["fields"][0]["value"] = "O"
        existing["assessmentFields"][0]["fields"][0]["reason"] = "Consistent midday shine."
        incoming = {
            "summary": "Updated summary.",
            "assessmentFields": [{
                "id": "baumann_skin_type",
                "label": "Malicious replacement",
                "fields": [
                    {"id": "s_vs_r", "label": "Changed", "value": "S", "reason": "Stinging with actives."},
                    {"id": "delete_me", "value": "x", "reason": "x"},
                ],
            }],
        }

        context = _normalize_global_context(incoming, "acne", "user-1", existing=existing)

        baumann = context["assessmentFields"][0]
        self.assertEqual(baumann["label"], "Baumann Skin Type")
        self.assertEqual([field["id"] for field in baumann["fields"]], ["o_vs_d", "s_vs_r", "p_vs_n", "w_vs_t"])
        self.assertEqual(baumann["fields"][0]["value"], "O")
        self.assertEqual(baumann["fields"][0]["reason"], "Consistent midday shine.")
        self.assertEqual(baumann["fields"][1]["value"], "S")
        self.assertEqual(baumann["fields"][1]["reason"], "Stinging with actives.")

    def test_non_acne_global_context_does_not_receive_acne_fields(self):
        context = _default_global_context("fitness", "user-1")

        self.assertNotIn("assessmentFields", context)

    def test_daily_context_get_missing_object_returns_empty_document(self):
        with patch("routes.projects.s3.get_object", side_effect=s3_error("NoSuchKey")):
            response = self.client.get("/api/projects/acne/daily-context/2026-07-10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["dailyContext"]["entries"], [])

    def test_daily_context_put_writes_user_scoped_document(self):
        with patch("routes.projects.s3.put_object") as put_object, patch("routes.projects.project_daily_context_metadata_table.put_item") as put_metadata:
            response = self.client.put(
                "/api/projects/acne/daily-context/2026-07-10",
                json={"entries": [{"id": "entry-1", "summary": "Did the thing."}]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(put_object.call_args.kwargs["Key"], "user@example.com/projects/acne/daily-context/2026-07-10.json")
        self.assertEqual(put_object.call_args.kwargs["ServerSideEncryption"], "AES256")
        metadata = put_metadata.call_args.kwargs["Item"]
        self.assertEqual(metadata["userProject"], "user-1#acne")
        self.assertEqual(metadata["entryCount"], 1)

    def test_daily_context_image_is_stored_and_added_to_document(self):
        image_data = base64.b64encode(b"\x89PNG\r\n\x1a\npayload").decode("ascii")
        with patch("routes.projects.s3.get_object", side_effect=s3_error("NoSuchKey")), patch("routes.projects.s3.put_object") as put_object, patch("routes.projects.project_daily_context_metadata_table.put_item"):
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

    def test_research_metadata_route_groups_entries_by_project(self):
        def query_research(_email, _user_id, project_id, include_inactive=False):
            if project_id == "acne":
                return [{
                    "researchId": "research-1",
                    "topic": "benzoyl peroxide irritation",
                    "status": "active",
                    "tags": ["benzoyl peroxide"],
                    "relatedTopics": ["irritation"],
                    "sourceTitle": "Acne guideline",
                    "sourceUrl": "https://example.com/acne",
                    "takeawaysPreview": ["Use cautiously."],
                }]
            return []

        with patch("routes.projects._query_research_metadata", side_effect=query_research):
            response = self.client.get("/api/projects/research-metadata")

        self.assertEqual(response.status_code, 200)
        projects = response.get_json()["projects"]
        self.assertEqual([project["id"] for project in projects], ["acne", "fitness", "flexibility"])
        self.assertEqual(projects[0]["researchMetadata"][0]["researchId"], "research-1")
        self.assertEqual(projects[1]["researchMetadata"], [])

    def test_projects_nav_includes_research_modal(self):
        with self.client.session_transaction(base_url="https://projects.efficienthypothesis.com") as session:
            session["user"] = {"id": "user-1", "email": "user@example.com"}
        with patch("routes.pages._project_calendar_days_for_user", return_value=[]):
            response = self.client.get("/", headers={"Host": "projects.efficienthypothesis.com"})

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-modal-target="research-modal"', response.data)
        self.assertIn(b'id="research-modal"', response.data)

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

    def test_research_item_writes_s3_and_metadata(self):
        research = {
            "id": "research-1",
            "topic": "benzoyl peroxide irritation",
            "status": "active",
            "source": {"title": "Acne guideline", "url": "https://example.com/acne", "publisher": "Example"},
            "qualifiedStatements": [{
                "statement": "Benzoyl peroxide can irritate skin.",
                "qualification": "Risk varies by concentration and user sensitivity.",
                "evidenceStrength": "medium",
                "limitations": ["Does not establish user tolerance."],
            }],
            "takeaways": ["Start conservatively when irritation is likely."],
            "recommendationImplications": ["Avoid stacking multiple irritating actives."],
            "tags": ["benzoyl peroxide"],
            "relatedTopics": ["irritation"],
        }
        with patch("routes.projects.s3.get_object", side_effect=s3_error("NoSuchKey")), patch("routes.projects.s3.put_object") as put_object, patch("routes.projects.project_research_metadata_table.put_item") as put_metadata:
            item = _write_research_item("user@example.com", "acne", "user-1", research)

        self.assertEqual(item["id"], "research-1")
        self.assertEqual(put_object.call_args.kwargs["Key"], "user@example.com/projects/acne/research/items/research-1.json")
        metadata = put_metadata.call_args.kwargs["Item"]
        self.assertEqual(metadata["userProject"], "user-1#acne")
        self.assertEqual(metadata["researchId"], "research-1")
        self.assertEqual(metadata["tags"], ["benzoyl peroxide"])

    def test_recommendation_context_includes_research_and_prior_recommendations(self):
        metadata_rows = [{
            "researchId": "research-1",
            "topic": "benzoyl peroxide irritation",
            "status": "active",
            "tags": ["benzoyl peroxide"],
            "s3Key": "user@example.com/projects/acne/research/items/research-1.json",
        }]

        def read_recommendations(_email, project_id, _user_id, date):
            if date == "2026-07-09":
                return {
                    "href": f"/projects/{project_id}/recommendations/{date}",
                    "recommendations": [{"id": "rec-1", "kind": "routine", "title": "Previous routine", "summary": "Older context."}],
                }
            return {"href": f"/projects/{project_id}/recommendations/{date}", "recommendations": []}

        with patch("routes.projects._query_research_metadata", return_value=metadata_rows), patch("routes.projects._read_recommendations", side_effect=read_recommendations):
            context = _read_recommendation_context("user@example.com", "acne", "user-1", "2026-07-10")

        self.assertEqual(context["activeResearch"], metadata_rows)
        self.assertEqual(context["recentRecommendations"][0]["date"], "2026-07-09")


if __name__ == "__main__":
    unittest.main()
