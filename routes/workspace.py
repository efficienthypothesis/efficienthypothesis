from flask import Blueprint, request, jsonify
import datetime
import json

from config import PRODUCTIVITY_BUCKET, s3, _is_programmatic, _require_auth
from routes.workspace_access import (
    chatgpt_grant_status,
    delete_chatgpt_grant,
    save_chatgpt_grant,
)
from routes.workspace_crypto import encrypted_workspace_updated_at, is_encrypted_workspace

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
        raw_state = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        raw_state = None
    if is_encrypted_workspace(raw_state):
        return jsonify({
            "state": None,
            "encryptedState": raw_state,
            "grant": chatgpt_grant_status(email),
        })
    return jsonify({
        "state": raw_state,
        "encryptedState": None,
        "grant": chatgpt_grant_status(email),
    })


@workspace_bp.route("/api/workspace", methods=["PUT"])
def api_workspace_put():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json() or {}
    state = data.get("state")
    encrypted_state = data.get("encryptedState")
    if encrypted_state is not None and not is_encrypted_workspace(encrypted_state):
        return jsonify({"error": "encryptedState must be an encrypted workspace envelope"}), 400
    if encrypted_state is None and not isinstance(state, dict):
        return jsonify({"error": "state or encryptedState object is required"}), 400
    base_updated_at = data.get("baseUpdatedAt")

    key = _workspace_state_key(email)
    existing_state = None
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        existing_state = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        existing_state = None

    existing_updated_at = encrypted_workspace_updated_at(existing_state)
    if existing_state and (not base_updated_at or base_updated_at != existing_updated_at):
        payload = {
            "error": "workspace_conflict",
            "serverUpdatedAt": existing_updated_at,
        }
        if is_encrypted_workspace(existing_state):
            payload["state"] = None
            payload["encryptedState"] = existing_state
        else:
            payload["state"] = existing_state
            payload["encryptedState"] = None
        return jsonify(payload), 409

    now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    if encrypted_state is not None:
        stored_state = dict(encrypted_state)
        if not stored_state.get("updatedAt"):
            return jsonify({"error": "encryptedState.updatedAt is required"}), 400
        stored_state["userId"] = ctx.get("user_id") or ""
        updated_at = stored_state["updatedAt"]
    else:
        state["updatedAt"] = now
        state["userId"] = ctx.get("user_id") or ""
        stored_state = state
        updated_at = now

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=key,
        Body=json.dumps(stored_state, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True, "updatedAt": updated_at})


@workspace_bp.route("/api/workspace/chatgpt-grant", methods=["GET"])
def api_workspace_chatgpt_grant_get():
    ctx, err = _require_auth()
    if err:
        return err
    return jsonify(chatgpt_grant_status(ctx["email"]))


@workspace_bp.route("/api/workspace/chatgpt-grant", methods=["POST"])
def api_workspace_chatgpt_grant_post():
    ctx, err = _require_auth()
    if err:
        return err
    if _is_programmatic(ctx):
        return jsonify({"error": "ChatGPT grant requires a browser session"}), 403
    data = request.get_json() or {}
    workspace_key = data.get("workspaceKey", "")
    grant = save_chatgpt_grant(ctx["email"], workspace_key)
    return jsonify({
        "active": True,
        "expiresAt": grant["expiresAt"],
        "createdAt": grant["createdAt"],
    })


@workspace_bp.route("/api/workspace/chatgpt-grant", methods=["DELETE"])
def api_workspace_chatgpt_grant_delete():
    ctx, err = _require_auth()
    if err:
        return err
    if _is_programmatic(ctx):
        return jsonify({"error": "ChatGPT grant revoke requires a browser session"}), 403
    delete_chatgpt_grant(ctx["email"])
    return jsonify({"active": False, "expiresAt": None, "createdAt": None})
