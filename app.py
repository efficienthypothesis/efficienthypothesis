from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from google.oauth2 import id_token
from google.auth.transport import requests
from apig_wsgi import make_lambda_handler
import os
import boto3
import datetime
import uuid
import json
import calendar
import hmac
import hashlib
import base64
import secrets
import time
import pathlib

# === Initialize Flask app ===
app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = os.getenv("FLASK_SECRET_KEY", "eh_replace_this_with_secure_key")

# === Google OAuth config ===
GOOGLE_CLIENT_ID = "902463711334-g7pehqqis9eh4uq2d8a5mbijf0incu93.apps.googleusercontent.com"

# === DynamoDB setup ===
dynamodb = boto3.resource("dynamodb", region_name="us-east-2")
user_table = dynamodb.Table("Users")
tasks_table = dynamodb.Table("Tasks")
actions_table = dynamodb.Table("Actions")
drafts_table = dynamodb.Table("Drafts")
oauth_tokens_table = dynamodb.Table("OAuthTokens")
timelogs_table = dynamodb.Table("TimeLogs")

# === S3 setup ===
s3 = boto3.client("s3", region_name="us-east-2")
PRODUCTIVITY_BUCKET = "eh-app-data"
DEFAULT_COLOR = "#000000"

# === OAuth signing key ===
OAUTH_SIGNING_KEY = os.getenv("OAUTH_SIGNING_KEY", "CHANGE_ME_oauth_signing_key")

# === Chat / Bedrock setup ===
bedrock_runtime = boto3.client("bedrock-runtime", region_name="us-east-2")
CHAT_STRONG_MODEL = os.getenv("CHAT_STRONG_MODEL", "us.anthropic.claude-sonnet-4-20250514-v1:0")
_PROMPT_PATH = pathlib.Path(__file__).with_name("chatbot_system_prompt.txt")
CHATBOT_SYSTEM_PROMPT = _PROMPT_PATH.read_text() if _PROMPT_PATH.exists() else ""


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


def _validate_date_range(date_str):
    """Check that a date/datetime string falls within current year or next year.
    Returns None if valid, or an error string if invalid."""
    if not date_str:
        return None
    try:
        year = int(date_str[:4])
    except (ValueError, IndexError):
        return None  # can't parse, let other validation handle it
    now_year = datetime.datetime.now(datetime.timezone.utc).year
    if year < now_year or year > now_year + 1:
        return f"Date must be within {now_year} or {now_year + 1}"
    return None


# === ROUTES ===

@app.route('/favicon.svg')
def favicon():
    from flask import Response
    obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key='assets/circle_favicon.svg')
    return Response(obj['Body'].read(), mimetype='image/svg+xml',
                    headers={'Cache-Control': 'public, max-age=86400'})


@app.route('/logo.svg')
def logo():
    from flask import Response
    obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key='assets/efficienthypothesis.svg')
    return Response(obj['Body'].read(), mimetype='image/svg+xml',
                    headers={'Cache-Control': 'public, max-age=86400'})


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/<page>')
def dynamic_page(page):
    try:
        return render_template(f"{page}.html")
    except Exception:
        return "<h1>404 - Page Not Found</h1>", 404


@app.route('/projects')
def projects_page():
    if "user" not in session:
        return redirect(url_for('login_page'))
    return render_template("app.html", user=session["user"], initial_page="projects")


@app.route('/tasks')
def tasks_page():
    if "user" not in session:
        return redirect(url_for('login_page'))
    return render_template("app.html", user=session["user"], initial_page="tasks")


@app.route('/monthly')
def monthly():
    if "user" not in session:
        return redirect(url_for('login_page'))
    return render_template("app.html", user=session["user"], initial_page="monthly")


@app.route('/weekly')
def weekly():
    if "user" not in session:
        return redirect(url_for('login_page'))
    return render_template("app.html", user=session["user"], initial_page="weekly")


@app.route('/dashboard')
def dashboard():
    if "user" not in session:
        return redirect(url_for('login_page'))
    return render_template("app.html", user=session["user"], initial_page="dashboard")


@app.route('/settings')
def settings():
    if "user" not in session:
        return redirect(url_for('login_page'))
    return render_template("app.html", user=session["user"], initial_page="settings")


# === LOGIN FLOW ===

@app.route('/ai')
def ai_app():
    if "user" not in session:
        return redirect(url_for('login_page'))
    return render_template("app.html", user=session["user"], initial_page="ai")

@app.route('/home')
def home_app():
    if "user" not in session:
        return redirect(url_for('login_page'))
    return render_template("app.html", user=session["user"], initial_page="home")


@app.route('/login')
def login_page():
    if "user" in session:
        return redirect(url_for('home_app'))
    return render_template("login.html", google_client_id=GOOGLE_CLIENT_ID)


@app.route('/auth/callback', methods=['POST'])
def auth_callback():
    data = request.get_json()
    token = data.get("credential")
    try:
        idinfo = id_token.verify_oauth2_token(token, requests.Request(), GOOGLE_CLIENT_ID)
        user_id = idinfo["sub"]
        email = idinfo["email"]
        name = idinfo.get("name", "")
        picture = idinfo.get("picture", "")

        session["user"] = {"id": user_id, "email": email, "name": name, "picture": picture}

        # Update user record. Set created_at only if it doesn't exist yet.
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

        oauth_next = session.pop("oauth_next", None)
        resp_data = {"message": "Login successful", "user": session["user"]}
        if oauth_next:
            resp_data["redirect"] = oauth_next
        return jsonify(resp_data), 200
    except ValueError as e:
        print("Login error:", e)
        return jsonify({"error": "Invalid token"}), 400


@app.route('/logout')
def logout():
    session.pop("user", None)
    return redirect(url_for('home'))


# === Productivity API ===

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


@app.route('/api/user/timezone', methods=['GET', 'PUT'])
def api_user_timezone():
    ctx, err = _require_auth()
    if err:
        return err
    user_id = ctx["user_id"]

    if request.method == 'GET':
        resp = user_table.get_item(Key={"user_id": user_id})
        item = resp.get("Item", {})
        return jsonify({
            "timezone": item.get("timezone", None),
            "created_at": item.get("created_at", None),
        })

    data = request.get_json()
    tz = data.get("timezone", "").strip()
    if not tz:
        return jsonify({"error": "timezone is required"}), 400
    user_table.update_item(
        Key={"user_id": user_id},
        UpdateExpression="SET #tz = :tz",
        ExpressionAttributeNames={"#tz": "timezone"},
        ExpressionAttributeValues={":tz": tz},
    )
    return jsonify({"ok": True, "timezone": tz})


@app.route('/api/tasks', methods=['GET'])
def api_tasks_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]

    resp = tasks_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    items = resp.get("Items", [])
    return jsonify(items)


@app.route('/api/tasks', methods=['POST'])
def api_tasks_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()

    if not data.get("due_datetime"):
        return jsonify({"error": "due_datetime is required"}), 400
    if not data.get("assign_datetime"):
        return jsonify({"error": "assign_datetime is required"}), 400
    if not data.get("name", "").strip():
        return jsonify({"error": "name is required"}), 400

    # Validate date range
    for field in ("assign_datetime", "due_datetime"):
        err = _validate_date_range(data.get(field))
        if err:
            return jsonify({"error": err}), 400

    # Check for duplicate: same name + assign_datetime + due_datetime
    resp = tasks_table.scan(
        FilterExpression="#u = :email AND #n = :name AND assign_datetime = :assign AND due_datetime = :due",
        ExpressionAttributeNames={"#u": "user", "#n": "name"},
        ExpressionAttributeValues={
            ":email": email,
            ":name": data["name"].strip(),
            ":assign": data["assign_datetime"],
            ":due": data["due_datetime"],
        },
    )
    if resp.get("Items"):
        return jsonify({"error": "A task with this name, assign date, and due date already exists"}), 409

    task_id = data.get("task_id") or str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    item = {
        "task_id": task_id,
        "user": email,
        "path": data.get("path", "/"),
        "name": data.get("name", ""),
        "assign_datetime": data.get("assign_datetime"),
        "due_datetime": data.get("due_datetime"),
        "end_datetime": None,
        "due_status": "pending",
        "routine_id": data.get("routine_id"),
        "group": data.get("group"),
        "created_at": now,
    }
    item = {k: v for k, v in item.items() if v is not None}
    tasks_table.put_item(Item=item)
    return jsonify(item), 201


@app.route('/api/tasks/<task_id>', methods=['PUT'])
def api_tasks_update(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()

    # Validate date range for datetime fields
    for field in ("assign_datetime", "due_datetime"):
        if field in data:
            err = _validate_date_range(data[field])
            if err:
                return jsonify({"error": err}), 400

    allowed = ["name", "path", "assign_datetime", "due_datetime",
               "end_datetime", "due_status", "group"]
    set_parts = []
    remove_parts = []
    attr_names = {}
    attr_values = {}
    for key in allowed:
        if key in data:
            placeholder = f"#f_{key}"
            attr_names[placeholder] = key
            if data[key] is None:
                remove_parts.append(placeholder)
            else:
                value_ph = f":v_{key}"
                set_parts.append(f"{placeholder} = {value_ph}")
                attr_values[value_ph] = data[key]

    if not set_parts and not remove_parts:
        return jsonify({"error": "No fields to update"}), 400

    expr = ""
    if set_parts:
        expr += "SET " + ", ".join(set_parts)
    if remove_parts:
        expr += (" " if expr else "") + "REMOVE " + ", ".join(remove_parts)

    update_args = {
        "Key": {"task_id": task_id},
        "UpdateExpression": expr,
        "ExpressionAttributeNames": attr_names,
    }
    if attr_values:
        update_args["ExpressionAttributeValues"] = attr_values
    tasks_table.update_item(**update_args)
    return jsonify({"ok": True, "task_id": task_id})


@app.route('/api/tasks/<task_id>/start', methods=['POST'])
def api_tasks_start(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    # Stop any other running timelog for this user
    open_resp = timelogs_table.scan(
        FilterExpression="#u = :email AND attribute_not_exists(#e)",
        ExpressionAttributeNames={"#u": "user", "#e": "end"},
        ExpressionAttributeValues={":email": email},
    )
    for log in open_resp.get("Items", []):
        if log["parent_id"] != task_id:
            timelogs_table.update_item(
                Key={"log_id": log["log_id"]},
                UpdateExpression="SET #e = :now",
                ExpressionAttributeNames={"#e": "end"},
                ExpressionAttributeValues={":now": now},
            )

    # Create a new timelog entry
    log_id = str(uuid.uuid4())
    timelogs_table.put_item(Item={
        "log_id": log_id,
        "user": email,
        "parent_id": task_id,
        "parent_type": "task",
        "start": now,
        "created_at": now,
    })
    return jsonify({"ok": True, "task_id": task_id, "log_id": log_id})


@app.route('/api/tasks/<task_id>/pause', methods=['POST'])
def api_tasks_pause(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    # Close any open timelog for this task
    open_resp = timelogs_table.scan(
        FilterExpression="#u = :email AND parent_id = :pid AND attribute_not_exists(#e)",
        ExpressionAttributeNames={"#u": "user", "#e": "end"},
        ExpressionAttributeValues={":email": email, ":pid": task_id},
    )
    for log in open_resp.get("Items", []):
        timelogs_table.update_item(
            Key={"log_id": log["log_id"]},
            UpdateExpression="SET #e = :now",
            ExpressionAttributeNames={"#e": "end"},
            ExpressionAttributeValues={":now": now},
        )
    return jsonify({"ok": True, "task_id": task_id})


@app.route('/api/tasks/<task_id>/complete', methods=['POST'])
def api_tasks_complete(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    # Close any open timelog for this task
    open_resp = timelogs_table.scan(
        FilterExpression="#u = :email AND parent_id = :pid AND attribute_not_exists(#e)",
        ExpressionAttributeNames={"#u": "user", "#e": "end"},
        ExpressionAttributeValues={":email": email, ":pid": task_id},
    )
    for log in open_resp.get("Items", []):
        timelogs_table.update_item(
            Key={"log_id": log["log_id"]},
            UpdateExpression="SET #e = :now",
            ExpressionAttributeNames={"#e": "end"},
            ExpressionAttributeValues={":now": now},
        )

    tasks_table.update_item(
        Key={"task_id": task_id},
        UpdateExpression="SET end_datetime = :end, due_status = :ds",
        ExpressionAttributeValues={
            ":end": now,
            ":ds": "met",
        },
    )
    return jsonify({"ok": True, "task_id": task_id})


@app.route('/api/tasks/<task_id>', methods=['DELETE'])
def api_tasks_delete(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    tasks_table.delete_item(Key={"task_id": task_id})
    # Clean up associated timelogs
    tl_resp = timelogs_table.scan(
        FilterExpression="#u = :email AND parent_id = :pid",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email, ":pid": task_id},
    )
    for log in tl_resp.get("Items", []):
        timelogs_table.delete_item(Key={"log_id": log["log_id"]})
    return jsonify({"ok": True})


@app.route('/api/tasks/<task_id>/move', methods=['POST'])
def api_tasks_move(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()
    new_path = data.get("path")
    if not new_path:
        return jsonify({"error": "path is required"}), 400
    tasks_table.update_item(
        Key={"task_id": task_id},
        UpdateExpression="SET #p = :p",
        ExpressionAttributeNames={"#p": "path"},
        ExpressionAttributeValues={":p": new_path},
    )
    return jsonify({"ok": True, "task_id": task_id, "path": new_path})


@app.route('/api/tasks/calendar', methods=['GET'])
def api_tasks_calendar():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    month = request.args.get("month")
    if not month:
        return jsonify({"error": "month param required (YYYY-MM)"}), 400

    user_id = ctx["user_id"]
    user_resp = user_table.get_item(Key={"user_id": user_id})
    user_tz_str = (user_resp.get("Item") or {}).get("timezone", "UTC")

    from zoneinfo import ZoneInfo
    try:
        user_tz = ZoneInfo(user_tz_str)
    except Exception:
        user_tz = ZoneInfo("UTC")

    resp = tasks_table.scan(
        FilterExpression="#u = :email AND attribute_exists(end_datetime)",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    items = resp.get("Items", [])
    by_day = {}
    for item in items:
        end = item.get("end_datetime", "")
        if not end:
            continue
        try:
            utc_dt = datetime.datetime.fromisoformat(end.replace("Z", "+00:00"))
            local_dt = utc_dt.astimezone(user_tz)
            day = local_dt.strftime("%Y-%m-%d")
        except Exception:
            day = end[:10]
        if day.startswith(month):
            by_day.setdefault(day, []).append({
                "task_id": item["task_id"],
                "name": item.get("name", ""),
                "end_datetime": end,
                "group": item.get("group"),
            })
    return jsonify(by_day)


# === TimeLogs (DynamoDB-backed, separate time tracking) ===

@app.route('/api/timelogs', methods=['GET'])
def api_timelogs_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    parent_id = request.args.get("parent_id")
    parent_type = request.args.get("parent_type")
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")

    filter_expr = "#u = :email"
    attr_names = {"#u": "user"}
    attr_values = {":email": email}

    if parent_id:
        filter_expr += " AND parent_id = :pid"
        attr_values[":pid"] = parent_id
    if parent_type:
        filter_expr += " AND parent_type = :pt"
        attr_values[":pt"] = parent_type
    if date_from:
        filter_expr += " AND #s >= :dfrom"
        attr_names["#s"] = "start"
        attr_values[":dfrom"] = date_from
    if date_to:
        filter_expr += " AND #s <= :dto"
        if "#s" not in attr_names:
            attr_names["#s"] = "start"
        attr_values[":dto"] = date_to

    resp = timelogs_table.scan(
        FilterExpression=filter_expr,
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
    )
    return jsonify(resp.get("Items", []))


@app.route('/api/timelogs', methods=['POST'])
def api_timelogs_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()

    parent_id = data.get("parent_id")
    parent_type = data.get("parent_type", "task")
    if not parent_id:
        return jsonify({"error": "parent_id is required"}), 400
    if parent_type not in ("task", "action"):
        return jsonify({"error": "parent_type must be 'task' or 'action'"}), 400

    log_id = data.get("log_id") or str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    item = {
        "log_id": log_id,
        "user": email,
        "parent_id": parent_id,
        "parent_type": parent_type,
        "start": data.get("start", now),
        "end": data.get("end"),
        "created_at": now,
    }
    item = {k: v for k, v in item.items() if v is not None}
    timelogs_table.put_item(Item=item)
    return jsonify(item), 201


@app.route('/api/timelogs/<log_id>', methods=['PUT'])
def api_timelogs_update(log_id):
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()

    allowed = ["start", "end", "parent_id", "parent_type"]
    set_parts = []
    remove_parts = []
    attr_names = {}
    attr_values = {}
    for key in allowed:
        if key in data:
            placeholder = f"#f_{key}"
            attr_names[placeholder] = key
            if data[key] is None:
                remove_parts.append(placeholder)
            else:
                value_ph = f":v_{key}"
                set_parts.append(f"{placeholder} = {value_ph}")
                attr_values[value_ph] = data[key]

    if not set_parts and not remove_parts:
        return jsonify({"error": "No fields to update"}), 400

    expr = ""
    if set_parts:
        expr += "SET " + ", ".join(set_parts)
    if remove_parts:
        expr += (" " if expr else "") + "REMOVE " + ", ".join(remove_parts)

    update_args = {
        "Key": {"log_id": log_id},
        "UpdateExpression": expr,
        "ExpressionAttributeNames": attr_names,
    }
    if attr_values:
        update_args["ExpressionAttributeValues"] = attr_values
    timelogs_table.update_item(**update_args)
    return jsonify({"ok": True, "log_id": log_id})


@app.route('/api/timelogs/<log_id>', methods=['DELETE'])
def api_timelogs_delete(log_id):
    ctx, err = _require_auth()
    if err:
        return err
    timelogs_table.delete_item(Key={"log_id": log_id})
    return jsonify({"ok": True})


# === Drafts (DynamoDB-backed, temporary work-in-progress) ===

@app.route('/api/drafts', methods=['GET'])
def api_drafts_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    resp = drafts_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    return jsonify(resp.get("Items", []))


@app.route('/api/drafts', methods=['POST'])
def api_drafts_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()

    draft_id = data.get("draft_id") or str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    item = {
        "draft_id": draft_id,
        "user": email,
        "is_routine_draft": data.get("is_routine_draft", False),
        "draft_type": data.get("draft_type", "routine" if data.get("is_routine_draft") else "task"),
        "name": data.get("name", ""),
        # Task draft fields
        "assign_datetime": data.get("assign_datetime"),
        "due_datetime": data.get("due_datetime"),
        # Routine draft fields
        "pattern": data.get("pattern"),
        "due_time": data.get("due_time"),
        "assign_time": data.get("assign_time"),
        "first_day": data.get("first_day"),
        "max_instances": data.get("max_instances"),
        # Note draft fields
        "date": data.get("date"),
        "group": data.get("group"),
        # Group draft fields
        "color": data.get("color"),
        "created_at": now,
    }
    item = {k: v for k, v in item.items() if v is not None}
    drafts_table.put_item(Item=item)
    return jsonify(item), 201


@app.route('/api/drafts/<draft_id>', methods=['PUT'])
def api_drafts_update(draft_id):
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()

    allowed = ["name", "is_routine_draft", "draft_type",
               "assign_datetime", "due_datetime",
               "pattern", "due_time", "assign_time", "first_day", "max_instances", "end_date",
               "date", "group", "color"]
    set_parts = []
    remove_parts = []
    attr_names = {}
    attr_values = {}
    for key in allowed:
        if key in data:
            placeholder = f"#f_{key}"
            attr_names[placeholder] = key
            if data[key] is None:
                remove_parts.append(placeholder)
            else:
                value_ph = f":v_{key}"
                set_parts.append(f"{placeholder} = {value_ph}")
                attr_values[value_ph] = data[key]

    if not set_parts and not remove_parts:
        return jsonify({"error": "No fields to update"}), 400

    expr = ""
    if set_parts:
        expr += "SET " + ", ".join(set_parts)
    if remove_parts:
        expr += (" " if expr else "") + "REMOVE " + ", ".join(remove_parts)

    update_args = {
        "Key": {"draft_id": draft_id},
        "UpdateExpression": expr,
        "ExpressionAttributeNames": attr_names,
    }
    if attr_values:
        update_args["ExpressionAttributeValues"] = attr_values
    drafts_table.update_item(**update_args)
    return jsonify({"ok": True, "draft_id": draft_id})


@app.route('/api/drafts/<draft_id>', methods=['DELETE'])
def api_drafts_delete(draft_id):
    ctx, err = _require_auth()
    if err:
        return err
    drafts_table.delete_item(Key={"draft_id": draft_id})
    return jsonify({"ok": True})


# === Routines (S3-backed templates, formerly "recurring tasks") ===

def _routines_s3_key(email):
    return f"{email}/routines/tasks.json"


@app.route('/api/routines', methods=['GET'])
def api_routines_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _routines_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []
    return jsonify(templates)


@app.route('/api/routines', methods=['POST'])
def api_routines_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _routines_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []

    template = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "assign_time": data.get("assign_time"),
        "due_time": data.get("due_time"),
        "first_day": data.get("first_day"),
        "pattern": data.get("pattern", "interval:1"),
        "instances": 0,
        "group": data.get("group"),
        "active": True,
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    # Store either max_instances or end_date, never both
    if data.get("end_date"):
        template["end_date"] = data["end_date"]
    else:
        template["max_instances"] = data.get("max_instances", 85)
    template = {k: v for k, v in template.items() if v is not None}
    templates.append(template)

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify(template), 201


@app.route('/api/routines/<template_id>', methods=['PUT'])
def api_routines_update(template_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _routines_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return jsonify({"error": "No routines found"}), 404

    for t in templates:
        if t.get("id") == template_id:
            for field in ["name", "assign_time", "due_time", "first_day", "pattern",
                          "max_instances", "end_date", "active", "group"]:
                if field in data:
                    t[field] = data[field]
            # If switching modes, remove the other field
            if "end_date" in data:
                t.pop("max_instances", None)
            elif "max_instances" in data:
                t.pop("end_date", None)
            break
    else:
        return jsonify({"error": "Template not found"}), 404

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@app.route('/api/routines/<template_id>', methods=['DELETE'])
def api_routines_delete(template_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _routines_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return jsonify({"error": "No routines found"}), 404

    templates = [t for t in templates if t.get("id") != template_id]
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


def _pattern_matches_date(pattern, first_day, check_date):
    """Check if check_date matches the recurrence pattern starting from first_day.
    Pattern format: 'interval:N' or 'set:0,1,3' (0=Mon...6=Sun)."""
    if pattern.startswith("interval:"):
        n = int(pattern.split(":")[1])
        if n < 1:
            n = 1
        return (check_date - first_day).days % n == 0
    if pattern.startswith("set:"):
        days = [int(d) for d in pattern.split(":")[1].split(",")]
        return check_date.weekday() in days
    return False


@app.route('/api/routines/materialize', methods=['POST'])
def api_routines_materialize():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    user_id = ctx["user_id"]

    user_resp = user_table.get_item(Key={"user_id": user_id})
    user_tz_str = (user_resp.get("Item") or {}).get("timezone", "UTC")

    from zoneinfo import ZoneInfo
    try:
        user_tz = ZoneInfo(user_tz_str)
    except Exception:
        user_tz = ZoneInfo("UTC")

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    now_local = now_utc.astimezone(user_tz)
    today_local = now_local.date()

    key = _routines_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []

    if not templates:
        return jsonify({"materialized": 0, "cleaned": 0})

    resp = tasks_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    existing = resp.get("Items", [])

    # Clean stale incomplete routine instances past their due time (or from previous days)
    cleaned = 0
    for task in existing:
        if not task.get("routine_id"):
            continue
        if task.get("end_datetime"):
            continue
        due = task.get("due_datetime", "")
        assign = task.get("assign_datetime", "")
        should_delete = False
        if due:
            try:
                due_utc = datetime.datetime.fromisoformat(due.replace("Z", "+00:00"))
                if now_utc > due_utc:
                    should_delete = True
            except Exception:
                pass
        if not should_delete and assign:
            try:
                assign_utc = datetime.datetime.fromisoformat(assign.replace("Z", "+00:00"))
                assign_local = assign_utc.astimezone(user_tz).date()
                if assign_local < today_local:
                    should_delete = True
            except Exception:
                pass
        if should_delete:
            tasks_table.delete_item(Key={"task_id": task["task_id"]})
            cleaned += 1

    # Build set of routine IDs already materialized for today
    existing_routine_ids = set()
    for task in existing:
        rid = task.get("routine_id")
        if not rid:
            continue
        assign = task.get("assign_datetime", "")
        try:
            assign_utc = datetime.datetime.fromisoformat(assign.replace("Z", "+00:00"))
            assign_local = assign_utc.astimezone(user_tz).date()
        except Exception:
            continue
        if assign_local == today_local:
            existing_routine_ids.add(rid)

    materialized = 0
    templates_changed = False
    for tpl in templates:
        if not tpl.get("active", True):
            continue

        # Check limit: either max_instances or end_date
        instances = tpl.get("instances", 0)
        if "end_date" in tpl:
            try:
                end_date = datetime.date.fromisoformat(tpl["end_date"])
                if today_local > end_date:
                    continue
            except Exception:
                continue
        else:
            max_instances = tpl.get("max_instances", 85)
            if instances >= max_instances:
                continue

        tpl_id = tpl.get("id")
        if tpl_id in existing_routine_ids:
            continue

        # Check first_day
        first_day_str = tpl.get("first_day")
        if first_day_str:
            try:
                first_day = datetime.date.fromisoformat(first_day_str)
                if today_local < first_day:
                    continue
            except Exception:
                continue
        else:
            # Legacy templates without first_day: use start_date or skip check
            sd = tpl.get("start_date")
            if sd:
                try:
                    first_day = datetime.date.fromisoformat(sd)
                    if today_local < first_day:
                        continue
                except Exception:
                    first_day = today_local
            else:
                first_day = today_local

        # Check pattern match
        pattern = tpl.get("pattern", "daily")
        if not _pattern_matches_date(pattern, first_day, today_local):
            continue

        # Build assign_datetime from assign_time
        assign_time_str = tpl.get("assign_time", "06:00")
        try:
            ah, am = map(int, assign_time_str.split(":"))
            local_assign = datetime.datetime(
                today_local.year, today_local.month, today_local.day, ah, am,
                tzinfo=user_tz
            )
            utc_assign = local_assign.astimezone(datetime.timezone.utc).isoformat()
        except Exception:
            utc_assign = datetime.datetime.now(datetime.timezone.utc).isoformat()

        # Build due_datetime from due_time
        due_dt = None
        if tpl.get("due_time"):
            try:
                h2, m2 = map(int, tpl["due_time"].split(":"))
                local_due = datetime.datetime(
                    today_local.year, today_local.month, today_local.day, h2, m2,
                    tzinfo=user_tz
                )
                due_dt = local_due.astimezone(datetime.timezone.utc).isoformat()
            except Exception:
                pass
        if not due_dt:
            # Default due: end of day
            local_due = datetime.datetime(
                today_local.year, today_local.month, today_local.day, 23, 59,
                tzinfo=user_tz
            )
            due_dt = local_due.astimezone(datetime.timezone.utc).isoformat()

        item = {
            "task_id": str(uuid.uuid4()),
            "user": email,
            "path": "/",
            "name": tpl.get("name", ""),
            "assign_datetime": utc_assign,
            "due_datetime": due_dt,
            "due_status": "pending",
            "routine_id": tpl_id,
            "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
        }
        item = {k: v for k, v in item.items() if v is not None}
        tasks_table.put_item(Item=item)
        materialized += 1

        # Increment instances on template
        tpl["instances"] = instances + 1
        if "end_date" not in tpl:
            max_inst = tpl.get("max_instances", 85)
            if tpl["instances"] >= max_inst:
                tpl["active"] = False
        templates_changed = True

    # Save updated templates back to S3 if any changed
    if templates_changed:
        s3.put_object(
            Bucket=PRODUCTIVITY_BUCKET, Key=key,
            Body=json.dumps(templates, indent=2),
            ContentType="application/json",
        )

    return jsonify({"materialized": materialized, "cleaned": cleaned})


@app.route('/api/routines/compute-max', methods=['POST'])
def api_routines_compute_max():
    """Compute max instances possible from first_day to forward boundary."""
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()
    first_day_str = data.get("first_day")
    pattern = data.get("pattern", "daily")
    if not first_day_str:
        return jsonify({"error": "first_day is required"}), 400

    try:
        first_day = datetime.date.fromisoformat(first_day_str)
    except Exception:
        return jsonify({"error": "Invalid first_day format"}), 400

    # Forward boundary: last day of (current_month + 2)
    today = datetime.date.today()
    boundary_month = today.month + 2
    boundary_year = today.year
    while boundary_month > 12:
        boundary_month -= 12
        boundary_year += 1
    last_day_of_boundary = calendar.monthrange(boundary_year, boundary_month)[1]
    boundary = datetime.date(boundary_year, boundary_month, last_day_of_boundary)

    count = 0
    d = first_day
    while d <= boundary:
        if _pattern_matches_date(pattern, first_day, d):
            count += 1
        d += datetime.timedelta(days=1)

    return jsonify({"max_instances": count, "boundary": boundary.isoformat()})


# === Goals & Data Collection (S3-backed) ===

def _goals_prefix(email):
    return f"{email}/goals/"

def _data_prefix(email):
    return f"{email}/data/"


@app.route('/api/goals', methods=['GET'])
def api_goals_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    prefix = _goals_prefix(email)
    try:
        resp = s3.list_objects_v2(Bucket=PRODUCTIVITY_BUCKET, Prefix=prefix)
        goals = []
        for obj in resp.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".json"):
                continue
            name = key[len(prefix):].replace(".json", "")
            body = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)["Body"].read().decode("utf-8")
            goal = json.loads(body)
            goal["name"] = name
            goals.append(goal)
        return jsonify(goals)
    except Exception:
        return jsonify([])


@app.route('/api/goals', methods=['POST'])
def api_goals_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    name = data.get("name", "").strip().lower().replace(" ", "_")
    if not name:
        return jsonify({"error": "name is required"}), 400

    goal = {
        "display_name": data.get("display_name", name),
        "fields": data.get("fields", []),
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    key = _goals_prefix(email) + name + ".json"
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(goal, indent=2),
        ContentType="application/json",
    )
    goal["name"] = name
    return jsonify(goal), 201


@app.route('/api/goals/<goal_name>', methods=['PUT'])
def api_goals_update(goal_name):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _goals_prefix(email) + goal_name + ".json"

    try:
        body = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)["Body"].read().decode("utf-8")
        goal = json.loads(body)
    except Exception:
        return jsonify({"error": "Goal not found"}), 404

    for field in ["display_name", "fields"]:
        if field in data:
            goal[field] = data[field]

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(goal, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@app.route('/api/goals/<goal_name>', methods=['DELETE'])
def api_goals_delete(goal_name):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _goals_prefix(email) + goal_name + ".json"
    s3.delete_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
    return jsonify({"ok": True})


@app.route('/api/goals/<goal_name>/data', methods=['GET'])
def api_goals_data_list(goal_name):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    date = request.args.get("date")
    prefix = _data_prefix(email) + goal_name + "/"

    if date:
        key = prefix + date + ".json"
        try:
            body = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)["Body"].read().decode("utf-8")
            return jsonify(json.loads(body))
        except Exception:
            return jsonify({"entries": []})
    else:
        try:
            resp = s3.list_objects_v2(Bucket=PRODUCTIVITY_BUCKET, Prefix=prefix)
            dates = []
            for obj in resp.get("Contents", []):
                k = obj["Key"]
                if k.endswith(".json"):
                    d = k[len(prefix):].replace(".json", "")
                    dates.append(d)
            return jsonify({"dates": sorted(dates, reverse=True)})
        except Exception:
            return jsonify({"dates": []})


@app.route('/api/goals/<goal_name>/data', methods=['POST'])
def api_goals_data_log(goal_name):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    date = data.get("date")
    if not date:
        return jsonify({"error": "date is required"}), 400

    key = _data_prefix(email) + goal_name + "/" + date + ".json"

    try:
        body = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)["Body"].read().decode("utf-8")
        day_data = json.loads(body)
    except Exception:
        day_data = {"entries": []}

    entry = data.get("entry", {})
    entry["logged_at"] = datetime.datetime.utcnow().isoformat() + 'Z'
    day_data["entries"].append(entry)

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(day_data, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True, "count": len(day_data["entries"])}), 201


# === Groups (S3-backed) ===

def _groups_s3_key(email):
    return f"{email}/groups.json"


def _load_groups(email):
    key = _groups_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return {"groups": []}


def _save_groups(email, data):
    key = _groups_s3_key(email)
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(data, indent=2),
        ContentType="application/json",
    )


@app.route('/api/groups', methods=['GET'])
def api_groups_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    return jsonify(_load_groups(email))


@app.route('/api/groups', methods=['POST'])
def api_groups_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    path = data.get("path", "").strip()
    color = data.get("color", DEFAULT_COLOR).strip()
    # Name is derived from last segment of path if not provided
    name = data.get("name", "").strip()
    if not name and path:
        segments = [s for s in path.split("/") if s]
        name = segments[-1] if segments else ""

    if not path or not name:
        return jsonify({"error": "path is required"}), 400
    if not path.startswith("/"):
        return jsonify({"error": "path must start with /"}), 400

    groups_data = _load_groups(email)
    groups = groups_data.get("groups", [])

    if len(groups) >= 100:
        return jsonify({"error": "Maximum 100 groups allowed"}), 400

    # Check for duplicate path
    for g in groups:
        if g["path"] == path:
            return jsonify({"error": "A group with this path already exists"}), 400

    groups.append({"path": path, "name": name, "color": color})
    groups_data["groups"] = groups
    _save_groups(email, groups_data)
    return jsonify({"ok": True, "group": {"path": path, "name": name, "color": color}}), 201


@app.route('/api/groups', methods=['PUT'])
def api_groups_update():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    path = data.get("path", "").strip()
    if not path:
        return jsonify({"error": "path is required"}), 400

    groups_data = _load_groups(email)
    groups = groups_data.get("groups", [])

    found = False
    for g in groups:
        if g["path"] == path:
            if "name" in data:
                g["name"] = data["name"]
            if "color" in data:
                g["color"] = data["color"]
            found = True
            break

    if not found:
        return jsonify({"error": "Group not found"}), 404

    groups_data["groups"] = groups
    _save_groups(email, groups_data)
    return jsonify({"ok": True})


@app.route('/api/groups', methods=['DELETE'])
def api_groups_delete():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    path = data.get("path", "").strip()
    if not path:
        return jsonify({"error": "path is required"}), 400

    groups_data = _load_groups(email)
    groups = groups_data.get("groups", [])

    # Remove the group and all subgroups (paths that start with this path + "/")
    new_groups = [g for g in groups if g["path"] != path and not g["path"].startswith(path + "/")]
    if len(new_groups) == len(groups):
        return jsonify({"error": "Group not found"}), 404

    groups_data["groups"] = new_groups
    _save_groups(email, groups_data)

    # Ungroup all tasks that had this group's path or any subgroup path
    resp = tasks_table.scan(
        FilterExpression="#u = :email AND attribute_exists(#grp)",
        ExpressionAttributeNames={"#u": "user", "#grp": "group"},
        ExpressionAttributeValues={":email": email},
    )
    for item in resp.get("Items", []):
        grp = item.get("group", "")
        if grp == path or grp.startswith(path + "/"):
            tasks_table.update_item(
                Key={"task_id": item["task_id"]},
                UpdateExpression="REMOVE #grp",
                ExpressionAttributeNames={"#grp": "group"},
            )

    # Ungroup notes with matching group
    notes_data = _load_notes(email)
    notes_changed = False
    for n in notes_data.get("notes", []):
        if n.get("group") and (n["group"] == path or n["group"].startswith(path + "/")):
            n["group"] = None
            notes_changed = True
    if notes_changed:
        _save_notes(email, notes_data)

    # Ungroup routines with matching group
    routines_key = _routines_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=routines_key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
        changed = False
        for t in templates:
            if t.get("group") and (t["group"] == path or t["group"].startswith(path + "/")):
                t["group"] = None
                changed = True
        if changed:
            s3.put_object(
                Bucket=PRODUCTIVITY_BUCKET, Key=routines_key,
                Body=json.dumps(templates, indent=2),
                ContentType="application/json",
            )
    except Exception:
        pass

    return jsonify({"ok": True})


# === Notes (S3-backed) ===

def _notes_s3_key(email):
    return f"{email}/notes.json"


def _load_notes(email):
    key = _notes_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return {"notes": []}


def _save_notes(email, data):
    key = _notes_s3_key(email)
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(data, indent=2),
        ContentType="application/json",
    )


@app.route('/api/notes', methods=['GET'])
def api_notes_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    return jsonify(_load_notes(email))


@app.route('/api/notes', methods=['POST'])
def api_notes_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    name = data.get("name", "").strip()
    date = data.get("date", "").strip()
    group = data.get("group")

    if not name:
        return jsonify({"error": "name is required"}), 400
    if not date:
        return jsonify({"error": "date is required"}), 400
    date_err = _validate_date_range(date)
    if date_err:
        return jsonify({"error": date_err}), 400

    note = {
        "id": str(uuid.uuid4()),
        "name": name,
        "date": date,
        "group": group,
        "created_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
    }

    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])
    notes.append(note)
    notes_data["notes"] = notes
    _save_notes(email, notes_data)
    return jsonify({"ok": True, "note": note}), 201


@app.route('/api/notes/<note_id>', methods=['PUT'])
def api_notes_update(note_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()

    if "date" in data:
        date_err = _validate_date_range(data["date"])
        if date_err:
            return jsonify({"error": date_err}), 400

    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])

    found = False
    for n in notes:
        if n["id"] == note_id:
            if "name" in data:
                n["name"] = data["name"]
            if "date" in data:
                n["date"] = data["date"]
            if "group" in data:
                n["group"] = data["group"]
            found = True
            break

    if not found:
        return jsonify({"error": "Note not found"}), 404

    notes_data["notes"] = notes
    _save_notes(email, notes_data)
    return jsonify({"ok": True})


@app.route('/api/notes/<note_id>', methods=['DELETE'])
def api_notes_delete(note_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]

    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])
    new_notes = [n for n in notes if n["id"] != note_id]

    if len(new_notes) == len(notes):
        return jsonify({"error": "Note not found"}), 404

    notes_data["notes"] = new_notes
    _save_notes(email, notes_data)
    return jsonify({"ok": True})


# === Actions (DynamoDB-backed time blocks) ===

@app.route('/api/actions', methods=['GET'])
def api_actions_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    resp = actions_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    return jsonify(resp.get("Items", []))


@app.route('/api/actions', methods=['POST'])
def api_actions_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()

    if not data.get("name", "").strip():
        return jsonify({"error": "name is required"}), 400
    if not data.get("start_datetime"):
        return jsonify({"error": "start_datetime is required"}), 400
    if not data.get("end_datetime"):
        return jsonify({"error": "end_datetime is required"}), 400

    for field in ("start_datetime", "end_datetime"):
        err = _validate_date_range(data.get(field))
        if err:
            return jsonify({"error": err}), 400

    action_id = data.get("action_id") or str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    item = {
        "action_id": action_id,
        "user": email,
        "name": data.get("name", ""),
        "start_datetime": data.get("start_datetime"),
        "end_datetime": data.get("end_datetime"),
        "schedule_id": data.get("schedule_id"),
        "group": data.get("group"),
        "is_planned": data.get("is_planned", False),
        "created_at": now,
    }
    item = {k: v for k, v in item.items() if v is not None}
    actions_table.put_item(Item=item)
    return jsonify(item), 201


@app.route('/api/actions/<action_id>', methods=['PUT'])
def api_actions_update(action_id):
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()

    for field in ("start_datetime", "end_datetime"):
        if field in data:
            err = _validate_date_range(data[field])
            if err:
                return jsonify({"error": err}), 400

    allowed = ["name", "start_datetime", "end_datetime", "group", "is_planned"]
    set_parts = []
    remove_parts = []
    attr_names = {}
    attr_values = {}
    for key in allowed:
        if key in data:
            placeholder = f"#f_{key}"
            attr_names[placeholder] = key
            if data[key] is None:
                remove_parts.append(placeholder)
            else:
                value_ph = f":v_{key}"
                set_parts.append(f"{placeholder} = {value_ph}")
                attr_values[value_ph] = data[key]

    if not set_parts and not remove_parts:
        return jsonify({"error": "No fields to update"}), 400

    expr = ""
    if set_parts:
        expr += "SET " + ", ".join(set_parts)
    if remove_parts:
        expr += (" " if expr else "") + "REMOVE " + ", ".join(remove_parts)

    update_args = {
        "Key": {"action_id": action_id},
        "UpdateExpression": expr,
        "ExpressionAttributeNames": attr_names,
    }
    if attr_values:
        update_args["ExpressionAttributeValues"] = attr_values
    actions_table.update_item(**update_args)
    return jsonify({"ok": True, "action_id": action_id})


@app.route('/api/actions/<action_id>', methods=['DELETE'])
def api_actions_delete(action_id):
    ctx, err = _require_auth()
    if err:
        return err
    actions_table.delete_item(Key={"action_id": action_id})
    return jsonify({"ok": True})


@app.route('/api/actions/<action_id>/manifest', methods=['POST'])
def api_actions_manifest(action_id):
    """Click-to-manifest: convert a planned action into a real action.
    Only allowed starting 5 minutes before start_datetime."""
    ctx, err = _require_auth()
    if err:
        return err

    resp = actions_table.get_item(Key={"action_id": action_id})
    action = resp.get("Item")
    if not action:
        return jsonify({"error": "Action not found"}), 404
    if not action.get("is_planned"):
        return jsonify({"error": "Action is already manifested"}), 400

    start = action.get("start_datetime", "")
    if start:
        try:
            start_utc = datetime.datetime.fromisoformat(start.replace("Z", "+00:00"))
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            five_min_before = start_utc - datetime.timedelta(minutes=5)
            if now_utc < five_min_before:
                return jsonify({"error": "Too early to manifest. Available 5 minutes before start time."}), 400
        except Exception:
            pass

    actions_table.update_item(
        Key={"action_id": action_id},
        UpdateExpression="SET is_planned = :f",
        ExpressionAttributeValues={":f": False},
    )
    return jsonify({"ok": True, "action_id": action_id})


# === Schedules (S3-backed templates for recurring actions) ===

def _schedules_s3_key(email):
    return f"{email}/schedules/actions.json"


@app.route('/api/schedules', methods=['GET'])
def api_schedules_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _schedules_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []
    return jsonify(templates)


@app.route('/api/schedules', methods=['POST'])
def api_schedules_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _schedules_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []

    template = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "start_time": data.get("start_time"),
        "end_time": data.get("end_time"),
        "first_day": data.get("first_day"),
        "pattern": data.get("pattern", "interval:1"),
        "instances": 0,
        "group": data.get("group"),
        "active": True,
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    # Store either max_instances or end_date (mode-based, same as routines)
    if data.get("end_date"):
        template["end_date"] = data["end_date"]
    else:
        template["max_instances"] = data.get("max_instances", 85)
    template = {k: v for k, v in template.items() if v is not None}
    templates.append(template)

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify(template), 201


@app.route('/api/schedules/<template_id>', methods=['PUT'])
def api_schedules_update(template_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _schedules_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return jsonify({"error": "No schedules found"}), 404

    for t in templates:
        if t.get("id") == template_id:
            for field in ["name", "start_time", "end_time", "first_day", "pattern",
                          "max_instances", "end_date", "active", "group"]:
                if field in data:
                    t[field] = data[field]
            if "end_date" in data:
                t.pop("max_instances", None)
            elif "max_instances" in data:
                t.pop("end_date", None)
            break
    else:
        return jsonify({"error": "Schedule not found"}), 404

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@app.route('/api/schedules/<template_id>', methods=['DELETE'])
def api_schedules_delete(template_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _schedules_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return jsonify({"error": "No schedules found"}), 404

    templates = [t for t in templates if t.get("id") != template_id]
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@app.route('/api/schedules/materialize', methods=['POST'])
def api_schedules_materialize():
    """Generate planned actions from schedule templates for today.
    Also cleans expired planned actions (2 days past end_datetime)."""
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    user_id = ctx["user_id"]

    user_resp = user_table.get_item(Key={"user_id": user_id})
    user_tz_str = (user_resp.get("Item") or {}).get("timezone", "UTC")

    from zoneinfo import ZoneInfo
    try:
        user_tz = ZoneInfo(user_tz_str)
    except Exception:
        user_tz = ZoneInfo("UTC")

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    now_local = now_utc.astimezone(user_tz)
    today_local = now_local.date()

    key = _schedules_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []

    # Fetch existing actions
    resp = actions_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    existing = resp.get("Items", [])

    # Clean expired planned actions: is_planned=True and end_datetime + 2 days < now
    cleaned = 0
    for action in existing:
        if not action.get("is_planned"):
            continue
        end = action.get("end_datetime", "")
        if end:
            try:
                end_utc = datetime.datetime.fromisoformat(end.replace("Z", "+00:00"))
                expiry = end_utc + datetime.timedelta(days=2)
                if now_utc > expiry:
                    actions_table.delete_item(Key={"action_id": action["action_id"]})
                    cleaned += 1
            except Exception:
                pass

    if not templates:
        return jsonify({"materialized": 0, "cleaned": cleaned})

    # Build set of schedule IDs already materialized for today
    existing_schedule_ids = set()
    for action in existing:
        sid = action.get("schedule_id")
        if not sid:
            continue
        start = action.get("start_datetime", "")
        try:
            start_utc = datetime.datetime.fromisoformat(start.replace("Z", "+00:00"))
            start_local = start_utc.astimezone(user_tz).date()
        except Exception:
            continue
        if start_local == today_local:
            existing_schedule_ids.add(sid)

    materialized = 0
    templates_changed = False
    for tpl in templates:
        if not tpl.get("active", True):
            continue

        instances = tpl.get("instances", 0)
        if "end_date" in tpl:
            try:
                end_date = datetime.date.fromisoformat(tpl["end_date"])
                if today_local > end_date:
                    continue
            except Exception:
                continue
        else:
            max_instances = tpl.get("max_instances", 85)
            if instances >= max_instances:
                continue

        tpl_id = tpl.get("id")
        if tpl_id in existing_schedule_ids:
            continue

        first_day_str = tpl.get("first_day")
        if first_day_str:
            try:
                first_day = datetime.date.fromisoformat(first_day_str)
                if today_local < first_day:
                    continue
            except Exception:
                continue
        else:
            first_day = today_local

        pattern = tpl.get("pattern", "interval:1")
        if not _pattern_matches_date(pattern, first_day, today_local):
            continue

        # Build start_datetime from start_time
        start_time_str = tpl.get("start_time", "08:00")
        try:
            sh, sm = map(int, start_time_str.split(":"))
            local_start = datetime.datetime(
                today_local.year, today_local.month, today_local.day, sh, sm,
                tzinfo=user_tz
            )
            utc_start = local_start.astimezone(datetime.timezone.utc).isoformat()
        except Exception:
            utc_start = now_utc.isoformat()

        # Build end_datetime from end_time (handle overnight: end < start)
        end_time_str = tpl.get("end_time", "09:00")
        try:
            eh, em = map(int, end_time_str.split(":"))
            end_day = today_local
            if (eh * 60 + em) <= (sh * 60 + sm):
                end_day = today_local + datetime.timedelta(days=1)
            local_end = datetime.datetime(
                end_day.year, end_day.month, end_day.day, eh, em,
                tzinfo=user_tz
            )
            utc_end = local_end.astimezone(datetime.timezone.utc).isoformat()
        except Exception:
            utc_end = (now_utc + datetime.timedelta(hours=1)).isoformat()

        item = {
            "action_id": str(uuid.uuid4()),
            "user": email,
            "name": tpl.get("name", ""),
            "start_datetime": utc_start,
            "end_datetime": utc_end,
            "schedule_id": tpl_id,
            "group": tpl.get("group"),
            "is_planned": True,
            "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
        }
        item = {k: v for k, v in item.items() if v is not None}
        actions_table.put_item(Item=item)
        materialized += 1

        tpl["instances"] = instances + 1
        if "end_date" not in tpl:
            max_inst = tpl.get("max_instances", 85)
            if tpl["instances"] >= max_inst:
                tpl["active"] = False
        templates_changed = True

    if templates_changed:
        s3.put_object(
            Bucket=PRODUCTIVITY_BUCKET, Key=key,
            Body=json.dumps(templates, indent=2),
            ContentType="application/json",
        )

    return jsonify({"materialized": materialized, "cleaned": cleaned})


# === Homescreen (background photo) ===

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

def _homescreen_settings_key(email):
    return f"{email}/homescreen/settings.json"


def _homescreen_image_key(email):
    return f"{email}/homescreen/background"


@app.route('/api/homescreen/settings', methods=['GET'])
def api_homescreen_settings_get():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _homescreen_settings_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        settings = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        settings = {"has_image": False}
    # Check if image actually exists and generate presigned URL
    img_key = _homescreen_image_key(email)
    try:
        s3.head_object(Bucket=PRODUCTIVITY_BUCKET, Key=img_key)
        settings["has_image"] = True
        settings["image_url"] = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': PRODUCTIVITY_BUCKET, 'Key': img_key},
            ExpiresIn=3600,
        )
    except Exception:
        settings["has_image"] = False
    return jsonify(settings)


@app.route('/api/homescreen/settings', methods=['PUT'])
def api_homescreen_settings_put():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    settings = {
        "scale": data.get("scale", 1),
        "translateX": data.get("translateX", 0),
        "translateY": data.get("translateY", 0),
        "has_image": True,
    }
    key = _homescreen_settings_key(email)
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(settings, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@app.route('/api/homescreen/upload', methods=['POST'])
def api_homescreen_upload():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]

    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({"error": "No file selected"}), 400

    # Validate content type
    content_type = f.content_type or ''
    if not content_type.startswith('image/'):
        return jsonify({"error": "File must be an image"}), 400

    # Read and check size
    data = f.read()
    if len(data) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "File too large (max 10 MB)"}), 400

    img_key = _homescreen_image_key(email)
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=img_key,
        Body=data,
        ContentType=content_type,
    )
    return jsonify({"ok": True}), 201


@app.route('/api/homescreen/image', methods=['GET'])
def api_homescreen_image():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    img_key = _homescreen_image_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=img_key)
        from flask import Response
        return Response(
            obj['Body'].read(),
            mimetype=obj.get('ContentType', 'image/jpeg'),
            headers={'Cache-Control': 'private, max-age=3600'}
        )
    except Exception:
        return jsonify({"error": "No image found"}), 404


@app.route('/api/homescreen/image', methods=['DELETE'])
def api_homescreen_image_delete():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    img_key = _homescreen_image_key(email)
    settings_key = _homescreen_settings_key(email)
    try:
        s3.delete_object(Bucket=PRODUCTIVITY_BUCKET, Key=img_key)
    except Exception:
        pass
    try:
        s3.delete_object(Bucket=PRODUCTIVITY_BUCKET, Key=settings_key)
    except Exception:
        pass
    return jsonify({"ok": True})


# === OAuth Client Management ===

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


@app.route('/api/oauth/clients', methods=['GET'])
def api_oauth_clients_list():
    ctx, err = _require_auth()
    if err:
        return err
    if _is_programmatic(ctx):
        return jsonify({"error": "Requires browser session"}), 403
    clients = _load_oauth_clients(ctx["email"])
    safe = [{k: v for k, v in c.items() if k != "client_secret_hash"} for c in clients]
    return jsonify(safe)


@app.route('/api/oauth/clients', methods=['POST'])
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


@app.route('/api/oauth/clients/<cid>', methods=['DELETE'])
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


# === OAuth Authorization Flow ===

@app.route('/oauth/authorize', methods=['GET'])
def oauth_authorize_get():
    if "user" not in session:
        session["oauth_next"] = request.url
        return redirect(url_for('login_page'))
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


@app.route('/oauth/authorize', methods=['POST'])
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


# === OAuth Token Endpoint ===

@app.route('/oauth/token', methods=['POST'])
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


# === OAuth Revocation ===

@app.route('/oauth/revoke', methods=['POST'])
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


# === Chat API ===

def _build_chat_context(email, timezone):
    """Build the context block injected into the system prompt."""
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo

    # Current time in user's timezone
    try:
        tz = ZoneInfo(timezone)
        now_local = _dt.now(tz)
    except Exception:
        now_local = _dt.utcnow()

    today_str = now_local.strftime("%Y-%m-%d")
    day_of_week = now_local.strftime("%A")
    current_time = now_local.strftime("%I:%M%p").lstrip("0").lower()

    # Fetch existing groups
    groups_data = _load_groups(email)
    groups = groups_data.get("groups", [])

    # Fetch existing items summary
    items_summary = []

    # Tasks
    resp = tasks_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    for t in resp.get("Items", []):
        items_summary.append(
            f"task `{t.get('name','')}` ID `{t.get('task_id','')}`, "
            f"due {t.get('due_datetime','?')}"
        )

    # Actions
    resp = actions_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    for a in resp.get("Items", []):
        items_summary.append(
            f"action `{a.get('name','')}` ID `{a.get('action_id','')}`, "
            f"{a.get('start_datetime','?')} to {a.get('end_datetime','?')}"
        )

    # Routines
    key = _routines_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        routines = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        routines = []
    for r in routines:
        items_summary.append(
            f"routine `{r.get('name','')}` ID `{r.get('template_id','')}`, "
            f"pattern {r.get('pattern','?')}"
        )

    # Schedules
    key = _schedules_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        schedules = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        schedules = []
    for sc in schedules:
        items_summary.append(
            f"schedule `{sc.get('name','')}` ID `{sc.get('template_id','')}`, "
            f"pattern {sc.get('pattern','?')} {sc.get('start_time','?')}-{sc.get('end_time','?')}"
        )

    # Build context string
    ctx = f"\n\n=== CURRENT CONTEXT ===\n"
    ctx += f"Today's date: {today_str} ({day_of_week})\n"
    ctx += f"Current time: {current_time} local\n"
    ctx += f"Timezone: {timezone}\n"
    ctx += f"Existing groups: {json.dumps(groups)}\n"
    if items_summary:
        ctx += f"Existing items: {'; '.join(items_summary)}\n"
    else:
        ctx += "Existing items: none\n"

    return ctx


@app.route('/api/chat', methods=['POST'])
def api_chat():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    user_id = ctx["user_id"]

    data = request.get_json()
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    user_message = data.get("message", "").strip()
    conversation_history = data.get("history", [])
    if not user_message:
        return jsonify({"error": "message is required"}), 400

    # Get user timezone
    resp = user_table.get_item(Key={"user_id": user_id})
    timezone = resp.get("Item", {}).get("timezone", "America/Los_Angeles")

    # Build system prompt with context
    chat_context = _build_chat_context(email, timezone)
    full_system = CHATBOT_SYSTEM_PROMPT + chat_context

    # Build messages array
    messages = []
    for msg in conversation_history:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})

    # Call Bedrock via Converse API
    print(f"[CHAT] user={email}, msg_len={len(user_message)}, history_len={len(messages)-1}, system_len={len(full_system)}")
    try:
        converse_messages = [
            {"role": m["role"], "content": [{"text": m["content"]}]}
            for m in messages
        ]
        bedrock_resp = bedrock_runtime.converse(
            modelId=CHAT_STRONG_MODEL,
            system=[{"text": full_system}],
            messages=converse_messages,
            inferenceConfig={"maxTokens": 4096},
        )
        assistant_text = bedrock_resp["output"]["message"]["content"][0]["text"]
        return jsonify({"response": assistant_text})
    except Exception as e:
        print(f"[CHAT ERROR] {type(e).__name__}: {e}")
        return jsonify({"error": f"Chat failed: {str(e)}"}), 500


# === Lambda handler ===
handler = make_lambda_handler(app)

if __name__ == "__main__":
    app.run(debug=True)
