from flask import Blueprint, request, jsonify, Response
import json
import base64
import hashlib
from config import s3, PRODUCTIVITY_BUCKET, _require_auth

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

homescreen_bp = Blueprint('homescreen', __name__)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


def _homescreen_settings_key(email):
    return f"{email}/homescreen/settings.json"


def _homescreen_image_key(email):
    return f"{email}/homescreen/background"


@homescreen_bp.route('/api/homescreen/settings', methods=['GET'])
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
    # Check if image exists and return as base64 data URI
    img_key = _homescreen_image_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=img_key)
        img_bytes = obj["Body"].read()
        content_type = obj.get("ContentType") or "image/png"

        print(f"HOMESCREEN_DEBUG: key={img_key} len={len(img_bytes)} content_type={content_type} first16={img_bytes[:16].hex()}")

        if not img_bytes.startswith(PNG_MAGIC):
            print(f"HOMESCREEN_DEBUG: WARNING not PNG magic bytes: {img_bytes[:16].hex()}")

        b64 = base64.b64encode(img_bytes).decode("ascii")
        sha = hashlib.sha256(img_bytes).hexdigest()

        settings["has_image"] = True
        settings["image_url"] = f"data:{content_type};base64,{b64}"
        settings["_debug_image_bytes"] = len(img_bytes)
        settings["_debug_b64_len"] = len(b64)
        settings["_debug_sha256"] = sha

        print(f"HOMESCREEN_DEBUG: b64_len={len(b64)} data_uri_len={len(settings['image_url'])} sha256={sha}")
    except Exception as e:
        print(f"HOMESCREEN_DEBUG: failed to load image: {e}")
        settings["has_image"] = False
    response = jsonify(settings)
    response.headers["Cache-Control"] = "no-store"
    return response


@homescreen_bp.route('/api/homescreen/settings', methods=['PUT'])
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


@homescreen_bp.route('/api/homescreen/upload', methods=['POST'])
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


@homescreen_bp.route('/api/homescreen/image', methods=['GET'])
def api_homescreen_image():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    img_key = _homescreen_image_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=img_key)
        return Response(
            obj['Body'].read(),
            mimetype=obj.get('ContentType', 'image/jpeg'),
            headers={'Cache-Control': 'private, max-age=3600'}
        )
    except Exception:
        return jsonify({"error": "No image found"}), 404


@homescreen_bp.route('/api/homescreen/image', methods=['DELETE'])
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
