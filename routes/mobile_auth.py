from flask import Blueprint, request, jsonify
from google.oauth2 import id_token
from google.auth.transport import requests
import datetime
import secrets
import time
from config import (
    GOOGLE_ALLOWED_CLIENT_IDS,
    user_table,
    oauth_tokens_table,
    _create_access_token,
    _hash_token,
)

mobile_auth_bp = Blueprint('mobile_auth', __name__)

MOBILE_CLIENT_ID = "eh_ios"
MOBILE_SCOPE = "full_access"
REFRESH_TOKEN_TTL_SECONDS = 90 * 86400


def _verify_google_id_token(token):
    last_error = None
    for client_id in GOOGLE_ALLOWED_CLIENT_IDS:
        try:
            return id_token.verify_oauth2_token(
                token, requests.Request(), client_id
            )
        except ValueError as exc:
            last_error = exc
    raise ValueError(str(last_error) if last_error else "No Google client IDs configured")


def _store_user(idinfo):
    user_id = idinfo["sub"]
    email = idinfo["email"]
    name = idinfo.get("name", "")
    picture = idinfo.get("picture", "")
    now_iso = datetime.datetime.utcnow().isoformat() + 'Z'
    user_table.update_item(
        Key={"user_id": user_id},
        UpdateExpression="SET email = :e, #n = :n, picture = :p"
                         ", created_at = if_not_exists(created_at, :now)",
        ExpressionAttributeNames={"#n": "name"},
        ExpressionAttributeValues={
            ":e": email, ":n": name, ":p": picture, ":now": now_iso,
        },
    )
    return {
        "id": user_id,
        "email": email,
        "name": name,
        "picture": picture,
    }


def _issue_tokens(user):
    access_token = _create_access_token(
        user["email"], MOBILE_CLIENT_ID, MOBILE_SCOPE, user["id"]
    )
    refresh_token = secrets.token_urlsafe(48)
    oauth_tokens_table.put_item(Item={
        "token_hash": _hash_token(refresh_token),
        "type": "mobile_refresh_token",
        "email": user["email"],
        "user_id": user["id"],
        "client_id": MOBILE_CLIENT_ID,
        "scope": MOBILE_SCOPE,
        "expires_at_epoch": int(time.time()) + REFRESH_TOKEN_TTL_SECONDS,
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    })
    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": 3600,
        "refresh_token": refresh_token,
        "scope": MOBILE_SCOPE,
    }


@mobile_auth_bp.route('/api/mobile/auth/google', methods=['POST'])
def api_mobile_auth_google():
    data = request.get_json() or {}
    token = data.get("id_token", "")
    if not token:
        return jsonify({"error": "id_token is required"}), 400
    try:
        idinfo = _verify_google_id_token(token)
    except ValueError as exc:
        return jsonify({"error": "Invalid Google token", "detail": str(exc)}), 401

    user = _store_user(idinfo)
    tokens = _issue_tokens(user)
    return jsonify({"user": user, **tokens})


@mobile_auth_bp.route('/api/mobile/token/refresh', methods=['POST'])
def api_mobile_token_refresh():
    data = request.get_json() or {}
    refresh_token = data.get("refresh_token", "")
    if not refresh_token:
        return jsonify({"error": "refresh_token is required"}), 400

    token_hash = _hash_token(refresh_token)
    resp = oauth_tokens_table.get_item(Key={"token_hash": token_hash})
    item = resp.get("Item")
    if not item or item.get("type") != "mobile_refresh_token":
        return jsonify({"error": "invalid_grant"}), 400
    if item.get("expires_at_epoch", 0) < int(time.time()):
        oauth_tokens_table.delete_item(Key={"token_hash": token_hash})
        return jsonify({"error": "invalid_grant", "error_description": "Refresh token expired"}), 400

    user = {
        "id": item.get("user_id", ""),
        "email": item["email"],
        "name": "",
        "picture": "",
    }
    access_token = _create_access_token(
        item["email"],
        item.get("client_id", MOBILE_CLIENT_ID),
        item.get("scope", MOBILE_SCOPE),
        item.get("user_id", ""),
    )
    return jsonify({
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": item.get("scope", MOBILE_SCOPE),
        "user": user,
    })


@mobile_auth_bp.route('/api/mobile/token/revoke', methods=['POST'])
def api_mobile_token_revoke():
    data = request.get_json() or {}
    refresh_token = data.get("refresh_token", "")
    if refresh_token:
        oauth_tokens_table.delete_item(Key={"token_hash": _hash_token(refresh_token)})
    return jsonify({"ok": True})
