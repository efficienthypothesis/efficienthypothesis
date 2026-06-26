import boto3
import json
import hmac
import hashlib
import base64
import secrets
import time
import os
from flask import session, request, jsonify


def _required_env(name):
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} environment variable is required")
    return value


# === Google OAuth config ===
GOOGLE_CLIENT_ID = os.getenv(
    "GOOGLE_CLIENT_ID",
    "902463711334-g7pehqqis9eh4uq2d8a5mbijf0incu93.apps.googleusercontent.com",
)

# === DynamoDB setup ===
dynamodb = boto3.resource("dynamodb", region_name="us-east-2")
user_table = dynamodb.Table("Users")
# Legacy tables are retained here only so account deletion can remove old user data.
tasks_table = dynamodb.Table("Tasks")
actions_table = dynamodb.Table("Actions")
drafts_table = dynamodb.Table("Drafts")
timelogs_table = dynamodb.Table("TimeLogs")
oauth_tokens_table = dynamodb.Table("OAuthTokens")

# === S3 setup ===
s3 = boto3.client("s3", region_name="us-east-2")
PRODUCTIVITY_BUCKET = "eh-app-data"

# === OAuth signing key ===
OAUTH_SIGNING_KEY = _required_env("OAUTH_SIGNING_KEY")


# === OAuth token helpers ===

def _create_access_token(email, client_id, scopes, user_id):
    """Create an HMAC-SHA256 signed access token. No DB write needed."""
    payload = {
        "email": email,
        "client_id": client_id,
        "scopes": scopes,
        "user_id": user_id,
        "exp": int(time.time()) + 3600,
        "jti": secrets.token_hex(16),
    }
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    sig = hmac.new(
        OAUTH_SIGNING_KEY.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload_b64}.{sig}"


def _verify_access_token(token):
    """Verify HMAC signature and expiry. Returns payload dict or None."""
    parts = token.split(".")
    if len(parts) != 2:
        return None
    payload_b64, sig = parts
    expected_sig = hmac.new(
        OAUTH_SIGNING_KEY.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return None
    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return None
    if payload.get("exp", 0) < int(time.time()):
        return None
    return payload


def _hash_token(token):
    """SHA-256 hash for storing auth codes and refresh tokens."""
    return hashlib.sha256(token.encode()).hexdigest()


def _get_auth_context():
    """Return auth context dict or None. Supports session cookies and Bearer tokens."""
    if "user" in session:
        return {
            "email": session["user"]["email"],
            "user_id": session["user"]["id"],
            "source": "session",
            "scopes": None,
            "client_id": None,
        }
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        payload = _verify_access_token(auth_header[7:])
        if payload:
            return {
                "email": payload["email"],
                "user_id": payload.get("user_id"),
                "source": "bearer",
                "scopes": payload.get("scopes"),
                "client_id": payload.get("client_id"),
            }
    return None


def _require_auth():
    """Return (ctx, None) on success or (None, error_response) on failure."""
    ctx = _get_auth_context()
    if not ctx:
        return None, (jsonify({"error": "Not authenticated"}), 401)
    return ctx, None


def _is_programmatic(ctx):
    """True when the request comes from an OAuth bearer token (MCP/chatbot)."""
    return ctx["source"] == "bearer"
