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

    now = datetime.datetime.utcnow().isoformat() + "Z"
    state["updatedAt"] = now
    state["userId"] = ctx.get("user_id") or ""

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=_workspace_state_key(email),
        Body=json.dumps(state, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True, "updatedAt": now})
