from flask import Blueprint, request, jsonify
import json
from config import (
    s3, PRODUCTIVITY_BUCKET, DEFAULT_COLOR, tasks_table, _require_auth,
)
from routes.notes import _load_notes, _save_notes
from routes.routines import _routines_s3_key

folders_bp = Blueprint('folders', __name__)


def _folders_s3_key(email):
    return f"{email}/folders.json"


def _load_folders(email):
    key = _folders_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return {"folders": []}


def _save_folders(email, data):
    key = _folders_s3_key(email)
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(data, indent=2),
        ContentType="application/json",
    )


@folders_bp.route('/api/folders', methods=['GET'])
def api_folders_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    return jsonify(_load_folders(email))


@folders_bp.route('/api/folders', methods=['POST'])
def api_folders_create():
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

    folders_data = _load_folders(email)
    folders = folders_data.get("folders", [])

    if len(folders) >= 100:
        return jsonify({"error": "Maximum 100 folders allowed"}), 400

    # Check for duplicate path
    for g in folders:
        if g["path"] == path:
            return jsonify({"error": "A folder with this path already exists"}), 400

    folders.append({"path": path, "name": name, "color": color})
    folders_data["folders"] = folders
    _save_folders(email, folders_data)
    return jsonify({"ok": True, "folder": {"path": path, "name": name, "color": color}}), 201


@folders_bp.route('/api/folders', methods=['PUT'])
def api_folders_update():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    path = data.get("path", "").strip()
    if not path:
        return jsonify({"error": "path is required"}), 400

    folders_data = _load_folders(email)
    folders = folders_data.get("folders", [])

    found = False
    for g in folders:
        if g["path"] == path:
            if "name" in data:
                g["name"] = data["name"]
            if "color" in data:
                g["color"] = data["color"]
            found = True
            break

    if not found:
        return jsonify({"error": "Folder not found"}), 404

    folders_data["folders"] = folders
    _save_folders(email, folders_data)
    return jsonify({"ok": True})


@folders_bp.route('/api/folders', methods=['DELETE'])
def api_folders_delete():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    path = data.get("path", "").strip()
    if not path:
        return jsonify({"error": "path is required"}), 400

    folders_data = _load_folders(email)
    folders = folders_data.get("folders", [])

    # Remove the folder and all subfolders (paths that start with this path + "/")
    new_folders = [g for g in folders if g["path"] != path and not g["path"].startswith(path + "/")]
    if len(new_folders) == len(folders):
        return jsonify({"error": "Folder not found"}), 404

    folders_data["folders"] = new_folders
    _save_folders(email, folders_data)

    # Remove folder from all tasks that had this folder's path or any subfolder path
    resp = tasks_table.scan(
        FilterExpression="#u = :email AND attribute_exists(#grp)",
        ExpressionAttributeNames={"#u": "user", "#grp": "folder"},
        ExpressionAttributeValues={":email": email},
    )
    for item in resp.get("Items", []):
        grp = item.get("folder", "")
        if grp == path or grp.startswith(path + "/"):
            tasks_table.update_item(
                Key={"task_id": item["task_id"]},
                UpdateExpression="REMOVE #grp",
                ExpressionAttributeNames={"#grp": "folder"},
            )

    # Remove folder from notes with matching folder
    notes_data = _load_notes(email)
    notes_changed = False
    for n in notes_data.get("notes", []):
        if n.get("folder") and (n["folder"] == path or n["folder"].startswith(path + "/")):
            n["folder"] = None
            notes_changed = True
    if notes_changed:
        _save_notes(email, notes_data)

    # Remove folder from routines with matching folder
    routines_key = _routines_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=routines_key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
        changed = False
        for t in templates:
            if t.get("folder") and (t["folder"] == path or t["folder"].startswith(path + "/")):
                t["folder"] = None
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
