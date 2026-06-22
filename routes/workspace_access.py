import datetime
import json

from config import PRODUCTIVITY_BUCKET, s3
from routes.workspace_crypto import validate_workspace_key

GRANT_DAYS = 30


def chatgpt_grant_key(email):
    return f"{email}/workspace/chatgpt-grant.json"


def load_chatgpt_grant(email):
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=chatgpt_grant_key(email))
        grant = json.loads(obj["Body"].read().decode("utf-8"))
        return grant if isinstance(grant, dict) else None
    except Exception:
        return None


def save_chatgpt_grant(email, workspace_key_b64):
    validate_workspace_key(workspace_key_b64)
    now = _now()
    expires = now + datetime.timedelta(days=GRANT_DAYS)
    grant = {
        "version": 1,
        "workspaceKeyB64": workspace_key_b64,
        "createdAt": _to_iso(now),
        "updatedAt": _to_iso(now),
        "expiresAt": _to_iso(expires),
    }
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=chatgpt_grant_key(email),
        Body=json.dumps(grant, indent=2),
        ContentType="application/json",
    )
    return grant


def delete_chatgpt_grant(email):
    try:
        s3.delete_object(Bucket=PRODUCTIVITY_BUCKET, Key=chatgpt_grant_key(email))
    except Exception:
        pass


def active_chatgpt_grant(email):
    grant = load_chatgpt_grant(email)
    if not grant or not grant.get("workspaceKeyB64"):
        return None
    expires_at = _parse_iso(grant.get("expiresAt"))
    if not expires_at or expires_at <= _now():
        return None
    return grant


def require_active_chatgpt_grant(email):
    grant = active_chatgpt_grant(email)
    if not grant:
        raise ValueError(
            "ChatGPT workspace access is not granted or has expired. "
            "Open Efficient Hypothesis and grant ChatGPT access from Settings > Profile."
        )
    return grant


def chatgpt_grant_status(email):
    grant = load_chatgpt_grant(email)
    active = False
    expires_at = None
    created_at = None
    if grant:
        expires_at = grant.get("expiresAt")
        created_at = grant.get("createdAt")
        parsed = _parse_iso(expires_at)
        active = bool(parsed and parsed > _now())
    return {"active": active, "expiresAt": expires_at if active else None, "createdAt": created_at}


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _to_iso(value):
    return value.isoformat().replace("+00:00", "Z")


def _parse_iso(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed
