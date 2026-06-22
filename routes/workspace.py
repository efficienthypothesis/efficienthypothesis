from flask import Blueprint, request, jsonify
import datetime
import json

from config import s3, PRODUCTIVITY_BUCKET, _require_auth

workspace_bp = Blueprint("workspace", __name__)


def _workspace_state_key(email):
    return f"{email}/workspace/state.json"


@workspace_bp.route("/api/workspace", methods=["GET"])
def api_workspace_get():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _workspace_state_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        state = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        state = None
    return jsonify({"state": state})


@workspace_bp.route("/api/workspace", methods=["PUT"])
def api_workspace_put():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json() or {}
    state = data.get("state")
    if not isinstance(state, dict):
        return jsonify({"error": "state object is required"}), 400
    base_updated_at = data.get("baseUpdatedAt")

    key = _workspace_state_key(email)
    existing_state = None
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        existing_state = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        existing_state = None

    existing_updated_at = existing_state.get("updatedAt") if isinstance(existing_state, dict) else None
    if existing_state and (not base_updated_at or base_updated_at != existing_updated_at):
        return jsonify({
            "error": "workspace_conflict",
            "serverUpdatedAt": existing_updated_at,
            "state": existing_state,
        }), 409

    now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    state["updatedAt"] = now
    state["userId"] = ctx.get("user_id") or ""

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=key,
        Body=json.dumps(state, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True, "updatedAt": now})
