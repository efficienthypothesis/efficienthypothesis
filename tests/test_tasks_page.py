import io
import json
import os
import unittest
from unittest.mock import patch

from botocore.exceptions import (
    ClientError,
    EndpointConnectionError,
    ReadTimeoutError,
)
from botocore.response import StreamingBody
from urllib3.exceptions import (
    ReadTimeoutError as URLLib3ReadTimeoutError,
    SSLError as URLLib3SSLError,
)


os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("OAUTH_SIGNING_KEY", "test")

from app import app
from routes.task_dashboard import TaskListFormatError, load_task_board, parse_task_board


PRIMARY_HOST_HEADERS = {"X-Forwarded-Host": "efficienthypothesis.com"}
PRIVATE_TASK_TEXT = b"Private admin task"
SENSITIVE_STORAGE_DETAIL = "private-task-storage-detail"
TASK_PAYLOAD = {
    "schemaVersion": 1,
    "updatedOn": "2026-07-09",
    "tasks": [
        {
            "id": "active-task",
            "section": "working_on",
            "title": "Private admin task",
            "summary": "An active task visible only to the admin.",
            "status": "in_progress",
            "priority": "high",
            "owner": "Codex",
            "updatedOn": "2026-07-09",
            "source": "test",
            "actionRequired": "Finish the active task.",
        },
        {
            "id": "planned-task",
            "section": "to_do",
            "title": "Planned task",
            "summary": "A planned follow-up.",
            "status": "planned",
            "priority": "medium",
            "owner": "Unassigned",
            "updatedOn": "2026-07-09",
            "source": "test",
        },
        {
            "id": "admin-note",
            "section": "tell_neer",
            "title": "Admin note",
            "summary": "Information Neer should see.",
            "status": "info",
            "priority": "info",
            "owner": "Codex",
            "updatedOn": "2026-07-09",
            "source": "test",
        },
        {
            "id": "completed-task",
            "section": "done",
            "title": "Completed task",
            "summary": "A completed task.",
            "status": "done",
            "priority": "info",
            "owner": "Codex",
            "updatedOn": "2026-07-09",
            "source": "test",
        },
    ],
}
TASK_BOARD = parse_task_board(TASK_PAYLOAD)


class TasksPageTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.client = app.test_client()
        self.task_loader_patch = patch(
            "routes.pages.load_task_board",
            return_value=TASK_BOARD,
        )
        self.task_loader = self.task_loader_patch.start()
        self.addCleanup(self.task_loader_patch.stop)

    def set_user(self, user):
        with self.client.session_transaction() as flask_session:
            flask_session.clear()
            flask_session["user"] = user

    def get_tasks(self, **kwargs):
        headers = dict(PRIMARY_HOST_HEADERS)
        headers.update(kwargs.pop("headers", {}))
        return self.client.get("/tasks", headers=headers, **kwargs)

    def assert_private_unavailable(self, response, logs, error_type):
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["Cache-Control"], "private, no-store")
        self.assertEqual(response.headers["X-Robots-Tag"], "noindex, nofollow")
        self.assertIn(b"temporarily unavailable", response.data.lower())
        self.assertNotIn(PRIVATE_TASK_TEXT, response.data)
        self.assertNotIn(SENSITIVE_STORAGE_DETAIL.encode(), response.data)
        joined_logs = "\n".join(logs.output)
        self.assertIn(error_type, joined_logs)
        self.assertNotIn(SENSITIVE_STORAGE_DETAIL, joined_logs)
        self.assertTrue(all(record.exc_info is None for record in logs.records))

    def test_anonymous_user_is_redirected_without_task_content(self):
        response = self.get_tasks()

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/login?next=/tasks")
        self.assertNotIn(PRIVATE_TASK_TEXT, response.data)
        self.task_loader.assert_not_called()

    def test_exact_admin_can_view_private_task_board(self):
        self.set_user({"id": "admin", "email": "neerkuchlous@gmail.com"})

        response = self.get_tasks()

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Tasks and agent notes", response.data)
        self.assertIn(b"Things To Tell Neer", response.data)
        self.assertIn(PRIVATE_TASK_TEXT, response.data)
        self.assertEqual(response.headers["Cache-Control"], "private, no-store")
        self.assertEqual(response.headers["X-Robots-Tag"], "noindex, nofollow")
        self.task_loader.assert_called_once()

    def test_missing_task_storage_returns_private_unavailable_response(self):
        self.set_user({"id": "admin", "email": "neerkuchlous@gmail.com"})
        self.task_loader.side_effect = ClientError(
            {
                "Error": {
                    "Code": "NoSuchKey",
                    "Message": SENSITIVE_STORAGE_DETAIL,
                },
            },
            "GetObject",
        )

        with self.assertLogs("routes.pages", level="WARNING") as logs:
            response = self.get_tasks()

        self.assert_private_unavailable(response, logs, "ClientError")
        self.task_loader.assert_called_once()

    def test_invalid_task_storage_returns_private_unavailable_response(self):
        self.set_user({"id": "admin", "email": "neerkuchlous@gmail.com"})
        self.task_loader.side_effect = TaskListFormatError(
            f"Duplicate task ID {SENSITIVE_STORAGE_DETAIL!r}."
        )

        with self.assertLogs("routes.pages", level="WARNING") as logs:
            response = self.get_tasks()

        self.assert_private_unavailable(response, logs, "TaskListFormatError")
        self.task_loader.assert_called_once()

    def test_transient_task_storage_returns_private_unavailable_response(self):
        self.set_user({"id": "admin", "email": "neerkuchlous@gmail.com"})
        self.task_loader.side_effect = EndpointConnectionError(
            endpoint_url=f"https://{SENSITIVE_STORAGE_DETAIL}.example"
        )

        with self.assertLogs("routes.pages", level="WARNING") as logs:
            response = self.get_tasks()

        self.assert_private_unavailable(response, logs, "EndpointConnectionError")
        self.task_loader.assert_called_once()

    def test_tls_task_storage_returns_private_unavailable_response(self):
        self.set_user({"id": "admin", "email": "neerkuchlous@gmail.com"})
        self.task_loader.side_effect = URLLib3SSLError(SENSITIVE_STORAGE_DETAIL)

        with self.assertLogs("routes.pages", level="WARNING") as logs:
            response = self.get_tasks()

        self.assert_private_unavailable(response, logs, "SSLError")
        self.task_loader.assert_called_once()

    def test_admin_email_comparison_is_case_normalized(self):
        self.set_user({"id": "admin", "email": "  NeerKuchlous@GMAIL.COM  "})

        response = self.get_tasks()

        self.assertEqual(response.status_code, 200)

    def test_non_admin_and_malformed_sessions_are_forbidden(self):
        denied_users = (
            {"id": "other", "email": "other@example.com"},
            {"id": "lookalike", "email": "neerkuchlous+admin@gmail.com"},
            {"id": "suffix", "email": "neerkuchlous@gmail.com.example.org"},
            {"id": "missing-email"},
            "not-a-user-object",
        )

        for user in denied_users:
            with self.subTest(user=user):
                self.set_user(user)
                response = self.get_tasks()
                self.assertEqual(response.status_code, 403)
                self.assertNotIn(PRIVATE_TASK_TEXT, response.data)
        self.task_loader.assert_not_called()

    def test_bearer_header_without_browser_session_does_not_grant_access(self):
        response = self.get_tasks(headers={
            "Authorization": "Bearer syntactically-valid-but-irrelevant",
        })

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/login?next=/tasks")
        self.assertNotIn(PRIVATE_TASK_TEXT, response.data)
        self.task_loader.assert_not_called()

    def test_tasks_route_redirects_other_hosts_to_primary_domain(self):
        self.set_user({"id": "admin", "email": "neerkuchlous@gmail.com"})

        response = self.client.get(
            "/tasks",
            headers={"X-Forwarded-Host": "home.efficienthypothesis.com"},
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "https://efficienthypothesis.com/tasks")
        self.task_loader.assert_not_called()

    def test_apps_menu_shows_admin_tasks_only_to_admin(self):
        self.set_user({"id": "admin", "email": "neerkuchlous@gmail.com"})
        admin_response = self.client.get("/apps", headers=PRIMARY_HOST_HEADERS)

        self.assertEqual(admin_response.status_code, 200)
        self.assertIn(b"Admin Tasks", admin_response.data)
        self.assertIn(b'href="/tasks"', admin_response.data)

        self.set_user({"id": "other", "email": "other@example.com"})
        other_response = self.client.get("/apps", headers=PRIMARY_HOST_HEADERS)

        self.assertEqual(other_response.status_code, 200)
        self.assertNotIn(b"Admin Tasks", other_response.data)
        self.assertNotIn(b'href="/tasks"', other_response.data)


class TaskBoardDataTests(unittest.TestCase):
    def test_parser_groups_every_required_section(self):
        board = parse_task_board(TASK_PAYLOAD)

        self.assertEqual(
            [section["key"] for section in board["sections"]],
            ["working_on", "to_do", "tell_neer", "done"],
        )
        self.assertEqual(board["counts"], {
            "working_on": 1,
            "to_do": 1,
            "tell_neer": 1,
            "done": 1,
        })

    def test_s3_loader_reads_and_closes_private_json_object(self):
        body = ClosingBody(json.dumps(TASK_PAYLOAD).encode("utf-8"))
        s3_client = RecordingS3Client(body)

        board = load_task_board(s3_client, "private-bucket")

        self.assertEqual(board["counts"]["working_on"], 1)
        self.assertEqual(
            s3_client.calls,
            [{"Bucket": "private-bucket", "Key": "admin/tasks.json"}],
        )
        self.assertTrue(body.was_closed)

    def test_s3_loader_preserves_streaming_error_translation(self):
        raw_stream = TimingOutRawStream()
        body = StreamingBody(raw_stream, content_length=1)
        s3_client = RecordingS3Client(body, content_length=1)

        with self.assertRaises(ReadTimeoutError):
            load_task_board(s3_client, "private-bucket")

        self.assertTrue(raw_stream.was_closed)

    def test_s3_loader_normalizes_json_decoder_failures(self):
        decoder_errors = (
            ValueError(SENSITIVE_STORAGE_DETAIL),
            RecursionError(SENSITIVE_STORAGE_DETAIL),
            UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte"),
        )

        for decoder_error in decoder_errors:
            with self.subTest(error_type=type(decoder_error).__name__):
                body = ClosingBody(b"{}")
                s3_client = RecordingS3Client(body)
                with patch(
                    "routes.task_dashboard.json.loads",
                    side_effect=decoder_error,
                ):
                    with self.assertRaisesRegex(
                        TaskListFormatError,
                        "must be valid UTF-8 JSON",
                    ):
                        load_task_board(s3_client, "private-bucket")
                self.assertTrue(body.was_closed)

    def test_parser_rejects_missing_required_metadata(self):
        payload = json.loads(json.dumps(TASK_PAYLOAD))
        del payload["tasks"][0]["owner"]

        with self.assertRaisesRegex(TaskListFormatError, "missing fields: owner"):
            parse_task_board(payload)

    def test_parser_rejects_duplicate_task_ids(self):
        payload = json.loads(json.dumps(TASK_PAYLOAD))
        payload["tasks"][1]["id"] = payload["tasks"][0]["id"]

        with self.assertRaisesRegex(TaskListFormatError, "Duplicate task ID"):
            parse_task_board(payload)

    def test_parser_rejects_done_status_outside_done_section(self):
        payload = json.loads(json.dumps(TASK_PAYLOAD))
        payload["tasks"][1]["status"] = "done"

        with self.assertRaisesRegex(TaskListFormatError, "outside Done"):
            parse_task_board(payload)

    def test_parser_rejects_non_extended_iso_dates(self):
        for invalid_date in ("20260709", "2026-W28-4"):
            for location in ("board", "task"):
                with self.subTest(date=invalid_date, location=location):
                    payload = json.loads(json.dumps(TASK_PAYLOAD))
                    if location == "board":
                        payload["updatedOn"] = invalid_date
                    else:
                        payload["tasks"][0]["updatedOn"] = invalid_date

                    with self.assertRaisesRegex(
                        TaskListFormatError,
                        "must use YYYY-MM-DD",
                    ):
                        parse_task_board(payload)


class ClosingBody(io.BytesIO):
    def __init__(self, initial_bytes):
        super().__init__(initial_bytes)
        self.was_closed = False

    def close(self):
        self.was_closed = True
        super().close()


class RecordingS3Client:
    def __init__(self, body, content_length=None):
        self.body = body
        self.content_length = content_length
        self.calls = []

    def get_object(self, **kwargs):
        self.calls.append(kwargs)
        content_length = self.content_length
        if content_length is None:
            content_length = len(self.body.getvalue())
        return {
            "Body": self.body,
            "ContentLength": content_length,
        }


class TimingOutRawStream:
    def __init__(self):
        self.was_closed = False

    def read(self, amount=None):
        raise URLLib3ReadTimeoutError(None, None, SENSITIVE_STORAGE_DETAIL)

    def close(self):
        self.was_closed = True


if __name__ == "__main__":
    unittest.main()
