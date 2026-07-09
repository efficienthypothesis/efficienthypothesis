import json
import os
import unittest
from unittest.mock import patch

from botocore.exceptions import ClientError

os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("OAUTH_SIGNING_KEY", "test")

from app import app
from routes.mcp import _load_workspace


def s3_error(code):
    return ClientError({"Error": {"Code": code, "Message": "backend failure"}}, "GetObject")


class WorkspaceFailClosedTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.client = app.test_client()

    def set_user(self):
        with self.client.session_transaction() as session:
            session["user"] = {"email": "user@example.com", "id": "user-1"}

    def test_workspace_get_returns_unavailable_on_uncertain_read(self):
        self.set_user()
        with patch("routes.workspace.s3.get_object", side_effect=s3_error("InternalError")):
            response = self.client.get("/api/workspace")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json(), {"error": "workspace_unavailable"})

    def test_workspace_put_does_not_overwrite_after_uncertain_read(self):
        self.set_user()
        with patch("routes.workspace.s3.get_object", side_effect=s3_error("SlowDown")), patch(
            "routes.workspace.s3.put_object"
        ) as put_object:
            response = self.client.put(
                "/api/workspace",
                json={"state": {"schemaVersion": 1}},
            )

        self.assertEqual(response.status_code, 503)
        put_object.assert_not_called()

    def test_workspace_put_allows_confirmed_missing_object(self):
        self.set_user()
        with patch("routes.workspace.s3.get_object", side_effect=s3_error("NoSuchKey")), patch(
            "routes.workspace.s3.put_object"
        ) as put_object:
            response = self.client.put(
                "/api/workspace",
                json={"state": {"schemaVersion": 1}},
            )

        self.assertEqual(response.status_code, 200)
        put_object.assert_called_once()

    def test_mcp_workspace_load_does_not_fabricate_on_uncertain_read(self):
        with patch("routes.mcp.s3.get_object", side_effect=s3_error("AccessDenied")):
            with self.assertRaisesRegex(ValueError, "^workspace_unavailable$"):
                _load_workspace("user@example.com", "user-1")

    def test_mcp_workspace_load_uses_default_only_for_confirmed_missing(self):
        with patch("routes.mcp.s3.get_object", side_effect=s3_error("NoSuchKey")):
            workspace = _load_workspace("user@example.com", "user-1")

        self.assertEqual(workspace["userId"], "user-1")
        self.assertIn("nodes", workspace)


if __name__ == "__main__":
    unittest.main()
