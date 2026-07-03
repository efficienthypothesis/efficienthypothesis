import os
from urllib.parse import urlencode, urlparse

from flask import Blueprint, render_template, request, redirect, url_for, session, jsonify, Response
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from config import s3, PRODUCTIVITY_BUCKET, GOOGLE_CLIENT_ID, _require_auth, user_table

pages_bp = Blueprint('pages', __name__)

APP_PAGES = {
    "workspace",
}

PUBLIC_PAGES = {
    "privacy",
    "terms",
}

PRIMARY_HOST = os.getenv("PRIMARY_HOST", "efficienthypothesis.com")
HOME_APP_HOST = os.getenv("HOME_APP_HOST", "home.efficienthypothesis.com")
PROJECTS_APP_HOST = os.getenv("PROJECTS_APP_HOST", "projects.efficienthypothesis.com")


def _request_host():
    host = request.headers.get("X-Forwarded-Host", request.host) or ""
    return host.split(",")[0].strip().split(":")[0].lower()


def _external_url(host, path="/"):
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"https://{host}{normalized_path}"


def _home_app_url(path="/"):
    return _external_url(HOME_APP_HOST, path)


def _projects_app_url(path="/"):
    return _external_url(PROJECTS_APP_HOST, path)


def _is_safe_next_url(value):
    if not isinstance(value, str) or not value.strip():
        return False
    parsed = urlparse(value)
    if not parsed.netloc:
        return value.startswith("/") and not value.startswith("//")
    return parsed.scheme == "https" and parsed.netloc.lower() in {
        PRIMARY_HOST,
        HOME_APP_HOST,
        PROJECTS_APP_HOST,
    }


def _store_login_next():
    next_url = request.args.get("next", "")
    if _is_safe_next_url(next_url):
        session["login_next"] = next_url


@pages_bp.route('/favicon.svg')
def favicon():
    obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key='assets/circle_favicon.svg')
    return Response(obj['Body'].read(), mimetype='image/svg+xml',
                    headers={'Cache-Control': 'public, max-age=86400'})


@pages_bp.route('/logo.svg')
def logo():
    obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key='assets/efficienthypothesis.svg')
    return Response(obj['Body'].read(), mimetype='image/svg+xml',
                    headers={'Cache-Control': 'public, max-age=86400'})


@pages_bp.route('/')
def home():
    if _request_host() == HOME_APP_HOST:
        if "user" not in session:
            return redirect(
                _external_url(PRIMARY_HOST, f"/login?{urlencode({'next': _home_app_url('/')})}")
            )
        return render_template("app.html", user=session["user"], initial_page="home")
    if _request_host() == PROJECTS_APP_HOST:
        if "user" not in session:
            return redirect(
                _external_url(PRIMARY_HOST, f"/login?{urlencode({'next': _projects_app_url('/')})}")
            )
        return render_template("projects_app.html", user=session["user"])
    return render_template('index.html')


@pages_bp.route('/<page>')
def dynamic_page(page):
    if page in APP_PAGES:
        if "user" not in session:
            return redirect(url_for('pages.login_page'))
        return render_template("app.html", user=session["user"], initial_page=page)
    if page in PUBLIC_PAGES:
        return render_template(f"{page}.html")
    return "<h1>404 - Page Not Found</h1>", 404


@pages_bp.route('/home')
def home_app():
    return redirect(_home_app_url("/"), code=302)


@pages_bp.route('/projects')
def projects_app():
    return redirect(_projects_app_url("/"), code=302)


@pages_bp.route('/apps')
def app_menu():
    if "user" not in session:
        return redirect(url_for('pages.login_page'))
    return render_template(
        "app_menu.html",
        user=session["user"],
        home_app_url=_home_app_url("/"),
        projects_app_url=_projects_app_url("/"),
    )


@pages_bp.route('/login')
def login_page():
    _store_login_next()
    if "user" in session:
        next_url = session.pop("login_next", None)
        if next_url:
            return redirect(next_url)
        return redirect(url_for('pages.app_menu'))
    return render_template("login.html", google_client_id=GOOGLE_CLIENT_ID)


@pages_bp.route('/api/user/timezone', methods=['GET', 'PUT'])
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

    data = request.get_json(silent=True) or {}
    tz = data.get("timezone", "")
    if not isinstance(tz, str):
        return jsonify({"error": "timezone must be a string"}), 400
    tz = tz.strip()
    if not tz:
        return jsonify({"error": "timezone is required"}), 400
    if len(tz) > 64:
        return jsonify({"error": "timezone is too long"}), 400
    try:
        ZoneInfo(tz)
    except ZoneInfoNotFoundError:
        return jsonify({"error": "timezone is invalid"}), 400
    user_table.update_item(
        Key={"user_id": user_id},
        UpdateExpression="SET #tz = :tz",
        ExpressionAttributeNames={"#tz": "timezone"},
        ExpressionAttributeValues={":tz": tz},
    )
    return jsonify({"ok": True, "timezone": tz})
