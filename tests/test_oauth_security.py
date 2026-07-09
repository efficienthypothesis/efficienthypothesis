import os
import unittest
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError

os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
os.environ.setdefault("OAUTH_SIGNING_KEY", "test")

from app import app
from config import _create_access_token, _hash_token, _verify_access_token
from routes.oauth import OAuthRegistryUnavailable, _load_oauth_clients


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

    def test_missing_oauth_registry_is_an_empty_registry(self):
        with patch("routes.oauth.s3.get_object", side_effect=s3_error("NoSuchKey")):
            self.assertEqual(_load_oauth_clients("user@example.com"), [])


if __name__ == "__main__":
    unittest.main()
