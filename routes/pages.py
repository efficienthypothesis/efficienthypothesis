from flask import Blueprint, render_template, request, redirect, url_for, session, jsonify, Response
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from config import s3, PRODUCTIVITY_BUCKET, GOOGLE_CLIENT_ID, _require_auth, user_table

pages_bp = Blueprint('pages', __name__)

APP_PAGES = {
    "home",
    "workspace",
}

PUBLIC_PAGES = {
    "privacy",
    "terms",
}


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
    if "user" not in session:
        return redirect(url_for('pages.login_page'))
    return render_template("app.html", user=session["user"], initial_page="home")


@pages_bp.route('/login')
def login_page():
    if "user" in session:
        return redirect(url_for('pages.dynamic_page', page='workspace'))
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
