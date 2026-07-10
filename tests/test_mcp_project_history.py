import os
import unittest
from unittest.mock import patch

os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("OAUTH_SIGNING_KEY", "test")

from routes.mcp import TOOLS, _bulk_upsert_project_history_result, _get_global_context_result, _list_inventory_result, _upsert_daily_context_result, _upsert_global_context_result, _upsert_inventory_item_result
from routes.projects import _default_global_context


class MCPProjectHistoryTests(unittest.TestCase):
    def test_bulk_project_history_tool_is_advertised(self):
        tool = next((item for item in TOOLS if item["name"] == "bulk_upsert_project_history"), None)

        self.assertIsNotNone(tool)
        self.assertEqual(tool["inputSchema"]["required"], ["write_mode"])
        self.assertEqual(tool["inputSchema"]["properties"]["write_mode"]["enum"], ["merge", "replace"])

    def test_project_global_context_tools_are_advertised(self):
        tool_names = {item["name"] for item in TOOLS}

        self.assertIn("get_project_global_context", tool_names)
        self.assertIn("upsert_project_global_context", tool_names)
        self.assertIn("list_project_inventory", tool_names)
        self.assertIn("upsert_project_inventory_item", tool_names)

    def test_inventory_tools_call_project_helpers(self):
        inventory_item = {"id": "inventory-1", "name": "Cleanser", "kind": "product", "status": "available"}

        with patch("routes.mcp._write_inventory_item", return_value=inventory_item) as write_item:
            upsert_response = _upsert_inventory_item_result("user@example.com", "user-1", {
                "project_id": "acne",
                "inventory_item": inventory_item,
            })

        write_item.assert_called_once_with("user@example.com", "acne", "user-1", inventory_item)
        self.assertEqual(upsert_response["structuredContent"]["inventoryItem"]["id"], "inventory-1")

        with patch("routes.mcp._query_project_inventory", return_value=[inventory_item]) as query_inventory:
            list_response = _list_inventory_result("user@example.com", "user-1", {"project_id": "acne"})

        query_inventory.assert_called_once_with("user@example.com", "user-1", "acne", False)
        self.assertEqual(list_response["structuredContent"]["items"], [inventory_item])

    def test_global_context_update_can_overwrite_editable_acne_fields(self):
        existing = _default_global_context("acne", "user-1")
        existing["assessmentFields"][0]["fields"][0]["value"] = "O"
        existing["assessmentFields"][0]["fields"][0]["reason"] = "Oilier T-zone."

        with (
            patch("routes.mcp._read_project_global_context", return_value=existing),
            patch("routes.mcp._write_project_global_context") as write_context,
        ):
            response = _upsert_global_context_result("user@example.com", "user-1", {
                "project_id": "acne",
                "global_context": {
                    "summary": "Acne context.",
                    "assessmentFields": [{
                        "id": "baumann_skin_type",
                        "fields": [{"id": "s_vs_r", "value": "S", "reason": "Irritation history."}],
                    }],
                },
            })

        written = write_context.call_args.args[2]
        self.assertEqual(written["summary"], "Acne context.")
        self.assertEqual(written["assessmentFields"][0]["fields"], [{"id": "s_vs_r", "value": "S", "reason": "Irritation history."}])
        self.assertEqual(response["structuredContent"]["globalContext"]["assessmentFields"][0]["fields"][0]["reason"], "Irritation history.")

    def test_global_context_update_can_delete_editable_acne_fields(self):
        existing = _default_global_context("acne", "user-1")

        with (
            patch("routes.mcp._read_project_global_context", return_value=existing),
            patch("routes.mcp._write_project_global_context") as write_context,
        ):
            _upsert_global_context_result("user@example.com", "user-1", {
                "project_id": "acne",
                "global_context": {"summary": "Keep only the summary."},
            })

        written = write_context.call_args.args[2]
        self.assertEqual(written["summary"], "Keep only the summary.")
        self.assertNotIn("assessmentFields", written)
        self.assertNotIn("aiGuidance", written)

    def test_daily_context_shorthand_write_includes_acne_starter_prompts(self):
        with patch("routes.mcp._write_daily_context") as write_context:
            response = _upsert_daily_context_result("user@example.com", "user-1", {
                "project_id": "acne",
                "date": "2026-07-10",
                "entries": [],
            })

        written = write_context.call_args.args[2]
        self.assertIn("starterFocusAreas", written)
        self.assertEqual(written["entries"], [])
        self.assertIn("starterFocusAreas", response["structuredContent"]["dailyContext"])

    def test_daily_context_full_write_can_delete_acne_starter_prompts(self):
        with patch("routes.mcp._write_daily_context") as write_context:
            _upsert_daily_context_result("user@example.com", "user-1", {
                "project_id": "acne",
                "date": "2026-07-10",
                "daily_context": {"entries": [{"id": "entry-1", "summary": "Custom context."}]},
            })

        written = write_context.call_args.args[2]
        self.assertNotIn("starterFocusAreas", written)
        self.assertNotIn("aiGuidance", written)
        self.assertEqual(written["entries"][0]["summary"], "Custom context.")

    def test_global_context_read_returns_current_context(self):
        existing = _default_global_context("fitness", "user-1")
        with patch("routes.mcp._read_project_global_context", return_value=existing):
            response = _get_global_context_result("user@example.com", "user-1", {"project_id": "fitness"})

        self.assertEqual(response["structuredContent"]["globalContext"]["projectId"], "fitness")

    def test_bulk_project_history_merge_updates_by_id(self):
        existing_context = {
            "schemaVersion": 1,
            "userId": "user-1",
            "projectId": "acne",
            "date": "2026-07-01",
            "entries": [
                {"id": "keep", "type": "text", "summary": "Keep this.", "createdAt": "old", "updatedAt": "old"},
                {"id": "update", "type": "text", "summary": "Old.", "createdAt": "old", "updatedAt": "old"},
            ],
            "createdAt": "old",
            "updatedAt": "old",
        }
        existing_recommendations = {
            "schemaVersion": 1,
            "userId": "user-1",
            "projectId": "acne",
            "date": "2026-07-01",
            "href": "/projects/acne/recommendations/2026-07-01",
            "recommendations": [
                {"id": "rec-keep", "kind": "routine", "title": "Keep", "summary": "Keep rec."},
                {"id": "rec-update", "kind": "routine", "title": "Old", "summary": "Old rec."},
            ],
            "createdAt": "old",
            "updatedAt": "old",
        }
        recommendation_files = {
            "rec-keep": {"id": "rec-keep", "kind": "routine", "title": "Keep", "summary": "Keep rec.", "steps": [{"item": "keep", "command": "keep"}]},
            "rec-update": {"id": "rec-update", "kind": "routine", "title": "Old", "summary": "Old rec.", "steps": [{"item": "old", "command": "old"}]},
        }

        def read_recommendation_file(_email, _project_id, _user_id, _date, recommendation_id):
            return existing_recommendations["recommendations"][0], recommendation_files[recommendation_id]

        with (
            patch("routes.mcp._read_daily_context", return_value=existing_context),
            patch("routes.mcp._write_daily_context") as write_daily_context,
            patch("routes.mcp._store_daily_context_image", return_value={"id": "image-1"}) as store_image,
            patch("routes.mcp._write_research_item", return_value={"id": "research-1", "status": "active"}) as write_research,
            patch("routes.mcp._read_recommendations", return_value=existing_recommendations),
            patch("routes.mcp._read_recommendation_file", side_effect=read_recommendation_file),
            patch("routes.mcp._write_recommendations", side_effect=lambda _email, _project_id, recommendations: recommendations) as write_recommendations,
        ):
            response = _bulk_upsert_project_history_result("user@example.com", "user-1", {
                "write_mode": "merge",
                "daily_contexts": [{
                    "project_id": "acne",
                    "date": "2026-07-01",
                    "entries": [
                        {"id": "update", "summary": "Updated."},
                        {"id": "new", "summary": "New."},
                    ],
                }],
                "image_contexts": [{
                    "project_id": "acne",
                    "date": "2026-07-01",
                    "image_data": "not-used-in-test",
                    "summary": "Photo.",
                }],
                "research_items": [{
                    "project_id": "acne",
                    "research_item": {"id": "research-1"},
                }],
                "recommendation_sets": [{
                    "project_id": "acne",
                    "date": "2026-07-01",
                    "recommendations": [
                        {
                            "id": "rec-update",
                            "kind": "routine",
                            "title": "Updated",
                            "summary": "Updated rec.",
                            "steps": [{"item": "new", "command": "new"}],
                        },
                        {
                            "id": "rec-new",
                            "kind": "routine",
                            "title": "New",
                            "summary": "New rec.",
                            "steps": [{"item": "new", "command": "new"}],
                        },
                    ],
                }],
            })

        written_context = write_daily_context.call_args.args[2]
        self.assertEqual([entry["id"] for entry in written_context["entries"]], ["keep", "update", "new"])
        self.assertEqual(written_context["entries"][1]["summary"], "Updated.")
        written_recommendations = write_recommendations.call_args.args[2]
        self.assertEqual([item["id"] for item in written_recommendations["recommendations"]], ["rec-keep", "rec-update", "rec-new"])
        self.assertEqual(written_recommendations["recommendations"][1]["summary"], "Updated rec.")
        store_image.assert_called_once()
        write_research.assert_called_once()
        result = response["structuredContent"]["result"]
        self.assertEqual(result["counts"]["errors"], 0)
        self.assertEqual(result["counts"]["dailyContexts"], 1)
        self.assertEqual(result["counts"]["images"], 1)
        self.assertEqual(result["counts"]["researchItems"], 1)
        self.assertEqual(result["counts"]["recommendationSets"], 1)


if __name__ == "__main__":
    unittest.main()
