from flask import Blueprint, request, jsonify
import datetime
import json
from botocore.exceptions import ClientError

from config import PRODUCTIVITY_BUCKET, s3, _require_auth
from routes.workspace_access import delete_chatgpt_grant
from routes.workspace_crypto import encrypted_workspace_updated_at, is_encrypted_workspace

workspace_bp = Blueprint("workspace", __name__)


def _workspace_state_key(email):
    return f"{email}/workspace/state.json"


def _read_workspace_state(key):
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        with obj["Body"] as body:
            return json.loads(body.read().decode("utf-8")), False
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"NoSuchKey", "404", "NotFound"}:
            return None, True
        raise


@workspace_bp.route("/api/workspace", methods=["GET"])
def api_workspace_get():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _workspace_state_key(email)
    try:
        raw_state, _missing = _read_workspace_state(key)
    except (ClientError, UnicodeDecodeError, json.JSONDecodeError):
        return jsonify({"error": "workspace_unavailable"}), 503
    if is_encrypted_workspace(raw_state):
        return jsonify({
            "state": None,
            "encryptedState": raw_state,
        })
    delete_chatgpt_grant(email)
    return jsonify({
        "state": raw_state,
        "encryptedState": None,
    })


@workspace_bp.route("/api/workspace", methods=["PUT"])
def api_workspace_put():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json(silent=True) or {}
    state = data.get("state")
    encrypted_state = data.get("encryptedState")
    if encrypted_state is not None:
        return jsonify({"error": "encrypted workspace writes are no longer supported"}), 400
    if not isinstance(state, dict):
        return jsonify({"error": "state object is required"}), 400
    base_updated_at = data.get("baseUpdatedAt")

    key = _workspace_state_key(email)
    try:
        existing_state, _missing = _read_workspace_state(key)
    except (ClientError, UnicodeDecodeError, json.JSONDecodeError):
        return jsonify({"error": "workspace_unavailable"}), 503

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
    delete_chatgpt_grant(email)
    return jsonify({"ok": True, "updatedAt": updated_at})


@workspace_bp.route("/api/workspace/chatgpt-grant", methods=["GET"])
def api_workspace_chatgpt_grant_get():
    ctx, err = _require_auth()
    if err:
        return err
    delete_chatgpt_grant(ctx["email"])
    return jsonify({"active": False, "expiresAt": None, "createdAt": None})


@workspace_bp.route("/api/workspace/chatgpt-grant", methods=["POST"])
def api_workspace_chatgpt_grant_post():
    ctx, err = _require_auth()
    if err:
        return err
    delete_chatgpt_grant(ctx["email"])
    return jsonify({"active": False, "expiresAt": None, "createdAt": None})


@workspace_bp.route("/api/workspace/chatgpt-grant", methods=["DELETE"])
def api_workspace_chatgpt_grant_delete():
    ctx, err = _require_auth()
    if err:
        return err
    delete_chatgpt_grant(ctx["email"])
    return jsonify({"active": False, "expiresAt": None, "createdAt": None})
