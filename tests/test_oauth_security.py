import os
import unittest
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError, EndpointConnectionError

os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("OAUTH_SIGNING_KEY", "test")

from app import app
from config import _create_access_token, _hash_token, _verify_access_token
from routes.oauth import (
    OAuthRegistryBusy,
    OAuthRegistryUnavailable,
    _load_oauth_clients,
    _revoke_client_tokens,
    _update_oauth_clients,
)


def s3_error(code):
    return ClientError({"Error": {"Code": code, "Message": "backend failure"}}, "GetObject")


class OAuthSecurityTests(unittest.TestCase):
    def test_revoked_access_token_is_rejected(self):
        token = _create_access_token("user@example.com", "eh_client", ["full_access"], "user-1")
        table = Mock()
        table.get_item.return_value = {"Item": {"type": "revoked_access_token"}}
        with patch("config.oauth_tokens_table", table):
            self.assertIsNone(_verify_access_token(token))
        table.get_item.assert_called_once_with(Key={"token_hash": _hash_token(token)})

    def test_access_token_is_rejected_when_revocation_lookup_fails(self):
        token = _create_access_token("user@example.com", "eh_client", ["full_access"], "user-1")
        table = Mock()
        table.get_item.side_effect = RuntimeError("Dynamo unavailable")
        with patch("config.oauth_tokens_table", table):
            self.assertIsNone(_verify_access_token(token))

    def test_revoke_persists_access_token_revocation_marker(self):
        token = _create_access_token("user@example.com", "eh_client", ["full_access"], "user-1")
        table = Mock()
        with patch("routes.oauth.oauth_tokens_table", table), patch("config.oauth_tokens_table", table):
            response = app.test_client().post("/oauth/revoke", data={"token": token})

        self.assertEqual(response.status_code, 200)
        item = table.put_item.call_args.kwargs["Item"]
        self.assertEqual(item["token_hash"], _hash_token(token))
        self.assertEqual(item["type"], "revoked_access_token")

    def test_oauth_registry_read_failure_is_not_treated_as_empty(self):
        with patch("routes.oauth.s3.get_object", side_effect=s3_error("InternalError")):
            with self.assertRaises(OAuthRegistryUnavailable):
                _load_oauth_clients("user@example.com")

    def test_oauth_registry_transport_failure_is_unavailable(self):
        with patch(
            "routes.oauth.s3.get_object",
            side_effect=EndpointConnectionError(endpoint_url="https://s3.amazonaws.com"),
        ):
            with self.assertRaises(OAuthRegistryUnavailable):
                _load_oauth_clients("user@example.com")

    def test_missing_oauth_registry_is_an_empty_registry(self):
        with patch("routes.oauth.s3.get_object", side_effect=s3_error("NoSuchKey")):
            self.assertEqual(_load_oauth_clients("user@example.com"), [])

    def test_client_token_cleanup_paginates(self):
        table = Mock()
        table.scan.side_effect = [
            {
                "Items": [{"token_hash": "one"}],
                "LastEvaluatedKey": {"token_hash": "one"},
            },
            {"Items": [{"token_hash": "two"}]},
        ]

        with patch("routes.oauth.oauth_tokens_table", table):
            _revoke_client_tokens("eh_client")

        self.assertEqual(table.scan.call_count, 2)
        table.scan.assert_any_call(
            FilterExpression="client_id = :cid",
            ExpressionAttributeValues={":cid": "eh_client"},
        )
        table.scan.assert_any_call(
            FilterExpression="client_id = :cid",
            ExpressionAttributeValues={":cid": "eh_client"},
            ExclusiveStartKey={"token_hash": "one"},
        )
        self.assertEqual(
            [call.kwargs["Key"] for call in table.delete_item.call_args_list],
            [{"token_hash": "one"}, {"token_hash": "two"}],
        )

    def test_registry_update_uses_expiring_conditional_lock(self):
        table = Mock()
        with patch("routes.oauth.oauth_tokens_table", table), patch(
            "routes.oauth._load_oauth_clients", return_value=[{"client_id": "old"}]
        ), patch("routes.oauth._save_oauth_clients") as save:
            result = _update_oauth_clients(
                "user@example.com", lambda clients: [*clients, {"client_id": "new"}]
            )

        self.assertEqual([client["client_id"] for client in result], ["old", "new"])
        put_kwargs = table.put_item.call_args.kwargs
        self.assertIn("ConditionExpression", put_kwargs)
        self.assertEqual(put_kwargs["Item"]["type"], "oauth_registry_lock")
        save.assert_called_once()
        table.delete_item.assert_called_once()

    def test_registry_update_reports_busy_lock(self):
        table = Mock()
        table.put_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem"
        )
        with patch("routes.oauth.oauth_tokens_table", table):
            with self.assertRaises(OAuthRegistryBusy):
                _update_oauth_clients("user@example.com", lambda clients: clients)


if __name__ == "__main__":
    unittest.main()
