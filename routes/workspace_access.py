import datetime
import json

from config import PRODUCTIVITY_BUCKET, s3


def chatgpt_grant_key(email):
    return f"{email}/workspace/chatgpt-grant.json"


def load_chatgpt_grant(email):
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=chatgpt_grant_key(email))
        with obj["Body"] as body:
            grant = json.loads(body.read().decode("utf-8"))
        return grant if isinstance(grant, dict) else None
    except Exception:
        return None


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


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


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
