from flask import Blueprint, request, redirect, url_for, session, jsonify, render_template
import datetime
import secrets
import time
import json
from config import (
    s3, PRODUCTIVITY_BUCKET, oauth_tokens_table,
    _require_auth, _is_programmatic, _hash_token, _create_access_token,
)

oauth_bp = Blueprint('oauth', __name__)


def _issuer():
    return request.url_root.rstrip("/")


@oauth_bp.route('/.well-known/oauth-protected-resource', methods=['GET'])
def oauth_protected_resource_metadata():
    issuer = _issuer()
    return jsonify({
        "resource": issuer,
        "authorization_servers": [issuer],
        "scopes_supported": ["full_access"],
        "resource_documentation": issuer,
    })


@oauth_bp.route('/.well-known/oauth-authorization-server', methods=['GET'])
def oauth_authorization_server_metadata():
    issuer = _issuer()
    return jsonify({
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/oauth/authorize",
        "token_endpoint": f"{issuer}/oauth/token",
        "revocation_endpoint": f"{issuer}/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "scopes_supported": ["full_access"],
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
        "code_challenge_methods_supported": [],
    })


def _oauth_clients_s3_key(email):
    return f"{email}/oauth/clients.json"


def _load_oauth_clients(email):
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=_oauth_clients_s3_key(email))
        return json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return []


def _save_oauth_clients(email, clients):
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=_oauth_clients_s3_key(email),
        Body=json.dumps(clients, indent=2),
        ContentType="application/json",
    )


@oauth_bp.route('/api/oauth/clients', methods=['GET'])
def api_oauth_clients_list():
    ctx, err = _require_auth()
    if err:
        return err
    if _is_programmatic(ctx):
        return jsonify({"error": "Requires browser session"}), 403
    clients = _load_oauth_clients(ctx["email"])
    safe = [{k: v for k, v in c.items() if k != "client_secret_hash"} for c in clients]
    return jsonify(safe)


@oauth_bp.route('/api/oauth/clients', methods=['POST'])
def api_oauth_clients_create():
    ctx, err = _require_auth()
    if err:
        return err
    if _is_programmatic(ctx):
        return jsonify({"error": "Requires browser session"}), 403
    data = request.get_json()
    name = (data.get("name") or "").strip()
    redirect_uris = data.get("redirect_uris", [])
    if not name:
        return jsonify({"error": "name is required"}), 400
    if not redirect_uris or not isinstance(redirect_uris, list):
        return jsonify({"error": "redirect_uris is required (array)"}), 400

    client_id = "eh_" + secrets.token_hex(16)
    client_secret = "ehs_" + secrets.token_hex(32)
    client = {
        "client_id": client_id,
        "name": name,
        "client_secret_hash": _hash_token(client_secret),
        "redirect_uris": redirect_uris,
        "scopes": ["full_access"],
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    clients = _load_oauth_clients(ctx["email"])
    clients.append(client)
    _save_oauth_clients(ctx["email"], clients)
    return jsonify({
        "client_id": client_id,
        "client_secret": client_secret,
        "name": name,
        "redirect_uris": redirect_uris,
    }), 201


@oauth_bp.route('/api/oauth/clients/<cid>', methods=['DELETE'])
def api_oauth_clients_delete(cid):
    ctx, err = _require_auth()
    if err:
        return err
    if _is_programmatic(ctx):
        return jsonify({"error": "Requires browser session"}), 403
    email = ctx["email"]
    clients = _load_oauth_clients(email)
    clients = [c for c in clients if c["client_id"] != cid]
    _save_oauth_clients(email, clients)
    # Revoke all tokens for this client
    try:
        resp = oauth_tokens_table.scan(
            FilterExpression="client_id = :cid",
            ExpressionAttributeValues={":cid": cid},
        )
        for item in resp.get("Items", []):
            oauth_tokens_table.delete_item(Key={"token_hash": item["token_hash"]})
    except Exception:
        pass
    return jsonify({"ok": True})


@oauth_bp.route('/oauth/authorize', methods=['GET'])
def oauth_authorize_get():
    if "user" not in session:
        session["oauth_next"] = request.url
        return redirect(url_for('pages.login_page'))
    client_id = request.args.get("client_id", "")
    redirect_uri = request.args.get("redirect_uri", "")
    state = request.args.get("state", "")
    scope = request.args.get("scope", "full_access")
    response_type = request.args.get("response_type", "")

    if response_type != "code":
        return jsonify({"error": "unsupported_response_type"}), 400

    email = session["user"]["email"]
    clients = _load_oauth_clients(email)
    client = next((c for c in clients if c["client_id"] == client_id), None)
    if not client:
        return jsonify({"error": "invalid_client", "description": "Client not registered"}), 400
    if redirect_uri not in client.get("redirect_uris", []):
        return jsonify({"error": "invalid_redirect_uri"}), 400

    return render_template("oauth_authorize.html",
        client_name=client["name"],
        scope=scope,
        client_id=client_id,
        redirect_uri=redirect_uri,
        state=state,
        user=session["user"],
    )


@oauth_bp.route('/oauth/authorize', methods=['POST'])
def oauth_authorize_post():
    if "user" not in session:
        return jsonify({"error": "Not authenticated"}), 401

    action = request.form.get("action")
    client_id = request.form.get("client_id", "")
    redirect_uri = request.form.get("redirect_uri", "")
    state = request.form.get("state", "")
    scope = request.form.get("scope", "full_access")

    email = session["user"]["email"]
    user_id = session["user"]["id"]

    clients = _load_oauth_clients(email)
    client = next((c for c in clients if c["client_id"] == client_id), None)
    if not client or redirect_uri not in client.get("redirect_uris", []):
        return jsonify({"error": "invalid_client"}), 400

    if action == "deny":
        sep = "&" if "?" in redirect_uri else "?"
        return redirect(redirect_uri + sep + "error=access_denied&state=" + state)

    # Generate auth code
    code = secrets.token_urlsafe(32)
    code_hash = _hash_token(code)
    expires = int(time.time()) + 600  # 10 minutes

    oauth_tokens_table.put_item(Item={
        "token_hash": code_hash,
        "type": "auth_code",
        "email": email,
        "user_id": user_id,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "expires_at_epoch": expires,
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    })

    sep = "&" if "?" in redirect_uri else "?"
    return redirect(redirect_uri + sep + "code=" + code + "&state=" + state)


@oauth_bp.route('/oauth/token', methods=['POST'])
def oauth_token():
    grant_type = request.form.get("grant_type")
    if grant_type == "authorization_code":
        return _handle_auth_code_grant()
    elif grant_type == "refresh_token":
        return _handle_refresh_token_grant()
    else:
        return jsonify({"error": "unsupported_grant_type"}), 400


def _handle_auth_code_grant():
    code = request.form.get("code", "")
    client_id = request.form.get("client_id", "")
    client_secret = request.form.get("client_secret", "")
    redirect_uri = request.form.get("redirect_uri", "")

    if not all([code, client_id, client_secret, redirect_uri]):
        return jsonify({"error": "invalid_request"}), 400

    code_hash = _hash_token(code)
    resp = oauth_tokens_table.get_item(Key={"token_hash": code_hash})
    item = resp.get("Item")
    if not item or item.get("type") != "auth_code":
        return jsonify({"error": "invalid_grant"}), 400

    # Delete immediately (single-use)
    oauth_tokens_table.delete_item(Key={"token_hash": code_hash})

    if item.get("expires_at_epoch", 0) < int(time.time()):
        return jsonify({"error": "invalid_grant", "error_description": "Code expired"}), 400
    if item["client_id"] != client_id or item["redirect_uri"] != redirect_uri:
        return jsonify({"error": "invalid_grant"}), 400

    email = item["email"]
    clients = _load_oauth_clients(email)
    client = next((c for c in clients if c["client_id"] == client_id), None)
    if not client:
        return jsonify({"error": "invalid_client"}), 400
    if _hash_token(client_secret) != client.get("client_secret_hash"):
        return jsonify({"error": "invalid_client"}), 401

    user_id = item.get("user_id", "")
    scope = item.get("scope", "full_access")

    access_token = _create_access_token(email, client_id, scope, user_id)
    refresh_token = secrets.token_urlsafe(48)
    refresh_hash = _hash_token(refresh_token)

    oauth_tokens_table.put_item(Item={
        "token_hash": refresh_hash,
        "type": "refresh_token",
        "email": email,
        "user_id": user_id,
        "client_id": client_id,
        "scope": scope,
        "expires_at_epoch": int(time.time()) + 90 * 86400,
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    })

    return jsonify({
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": 3600,
        "refresh_token": refresh_token,
        "scope": scope,
    })


def _handle_refresh_token_grant():
    refresh_token = request.form.get("refresh_token", "")
    client_id = request.form.get("client_id", "")
    client_secret = request.form.get("client_secret", "")

    if not all([refresh_token, client_id, client_secret]):
        return jsonify({"error": "invalid_request"}), 400

    refresh_hash = _hash_token(refresh_token)
    resp = oauth_tokens_table.get_item(Key={"token_hash": refresh_hash})
    item = resp.get("Item")
    if not item or item.get("type") != "refresh_token":
        return jsonify({"error": "invalid_grant"}), 400
    if item.get("expires_at_epoch", 0) < int(time.time()):
        oauth_tokens_table.delete_item(Key={"token_hash": refresh_hash})
        return jsonify({"error": "invalid_grant", "error_description": "Refresh token expired"}), 400
    if item["client_id"] != client_id:
        return jsonify({"error": "invalid_grant"}), 400

    email = item["email"]
    clients = _load_oauth_clients(email)
    client = next((c for c in clients if c["client_id"] == client_id), None)
    if not client or _hash_token(client_secret) != client.get("client_secret_hash"):
        return jsonify({"error": "invalid_client"}), 401

    scope = item.get("scope", "full_access")
    access_token = _create_access_token(
        email, client_id, scope, item.get("user_id", "")
    )

    return jsonify({
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": scope,
    })


@oauth_bp.route('/oauth/revoke', methods=['POST'])
def oauth_revoke():
    token = request.form.get("token", "")
    if not token:
        return jsonify({"error": "invalid_request"}), 400
    token_hash = _hash_token(token)
    try:
        oauth_tokens_table.delete_item(Key={"token_hash": token_hash})
    except Exception:
        pass
    return jsonify({"ok": True})
