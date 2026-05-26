from flask import Blueprint, request, jsonify
import hashlib
import json
from config import (
    s3, PRODUCTIVITY_BUCKET, DEFAULT_COLOR, actions_table, drafts_table,
    tasks_table, _require_auth,
)
folders_bp = Blueprint('folders', __name__)


def _folders_s3_key(email):
    return f"{email}/folders.json"


def _normalize_folder_path(path):
    path = (path or "").strip()
    if not path:
        return ""
    if not path.startswith("/"):
        path = "/" + path
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return path


def _folder_id_for_path(email, path):
    path = _normalize_folder_path(path)
    digest = hashlib.sha256(f"{email}|{path}".encode("utf-8")).hexdigest()[:16]
    return f"fld_{digest}"


def _parent_path_for_path(path):
    path = _normalize_folder_path(path)
    parts = [p for p in path.split("/") if p]
    if len(parts) <= 1:
        return None
    return "/" + "/".join(parts[:-1])


def _folder_name_from_path(path):
    parts = [p for p in _normalize_folder_path(path).split("/") if p]
    return parts[-1] if parts else ""


def _normalize_folder(email, folder, path_to_id=None):
    folder = dict(folder or {})
    path = _normalize_folder_path(folder.get("path"))
    folder["path"] = path
    folder.setdefault("name", _folder_name_from_path(path))
    folder.setdefault("color", DEFAULT_COLOR)
    folder["id"] = folder.get("id") or _folder_id_for_path(email, path)
    parent_path = _parent_path_for_path(path)
    if parent_path:
        folder["parent_id"] = (
            folder.get("parent_id")
            or (path_to_id or {}).get(parent_path)
            or _folder_id_for_path(email, parent_path)
        )
    else:
        folder["parent_id"] = folder.get("parent_id") or None
    return folder


def _normalize_folders_data(email, data):
    folders = list((data or {}).get("folders", []))
    path_to_id = {}
    for folder in folders:
        path = _normalize_folder_path(folder.get("path"))
        if path:
            path_to_id[path] = folder.get("id") or _folder_id_for_path(email, path)
    normalized = [
        _normalize_folder(email, folder, path_to_id)
        for folder in folders
        if _normalize_folder_path(folder.get("path"))
    ]
    data = dict(data or {})
    data["folders"] = normalized
    return data


def _folder_maps(email):
    folders_data = _normalize_folders_data(email, _load_folders(email))
    folders = folders_data.get("folders", [])
    by_id = {f.get("id"): f for f in folders if f.get("id")}
    by_path = {f.get("path"): f for f in folders if f.get("path")}
    return folders_data, by_id, by_path


def _resolve_folder_ref(email, folder=None, folder_id=None):
    if not folder and not folder_id:
        return None, None
    _folders_data, by_id, by_path = _folder_maps(email)
    if folder_id and folder_id in by_id:
        f = by_id[folder_id]
        return f.get("path"), f.get("id")
    folder = _normalize_folder_path(folder)
    if folder and folder in by_path:
        f = by_path[folder]
        return f.get("path"), f.get("id")
    return (folder or None), folder_id


def _apply_folder_ref(email, item, data):
    has_folder = "folder" in data
    has_folder_id = "folder_id" in data
    if not has_folder and not has_folder_id:
        return item
    folder, folder_id = _resolve_folder_ref(
        email,
        data.get("folder") if has_folder else item.get("folder"),
        data.get("folder_id") if has_folder_id else item.get("folder_id"),
    )
    if folder:
        item["folder"] = folder
    elif has_folder and data.get("folder") is None:
        item.pop("folder", None)
    if folder_id:
        item["folder_id"] = folder_id
    elif has_folder_id and data.get("folder_id") is None:
        item.pop("folder_id", None)
    return item


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
    data = _normalize_folders_data(email, _load_folders(email))
    return jsonify(data)


@folders_bp.route('/api/folders', methods=['POST'])
def api_folders_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    path = _normalize_folder_path(data.get("path", ""))
    color = data.get("color", DEFAULT_COLOR).strip()
    # Name is derived from last segment of path if not provided
    name = data.get("name", "").strip()
    if not name and path:
        name = _folder_name_from_path(path)

    if not path or not name:
        return jsonify({"error": "path is required"}), 400
    folders_data = _normalize_folders_data(email, _load_folders(email))
    folders = folders_data.get("folders", [])

    if len(folders) >= 100:
        return jsonify({"error": "Maximum 100 folders allowed"}), 400

    # Check for duplicate path
    for g in folders:
        if g["path"] == path:
            return jsonify({"error": "A folder with this path already exists"}), 400

    new_folder = _normalize_folder(email, {
        "id": data.get("id") or _folder_id_for_path(email, path),
        "path": path,
        "name": name,
        "color": color,
        "parent_id": data.get("parent_id"),
    }, {g["path"]: g["id"] for g in folders})
    folders.append(new_folder)
    folders_data["folders"] = folders
    _save_folders(email, folders_data)
    return jsonify({"ok": True, "folder": new_folder}), 201


@folders_bp.route('/api/folders', methods=['PUT'])
def api_folders_update():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    path = _normalize_folder_path(data.get("path", ""))
    folder_id = data.get("id") or data.get("folder_id")
    if not path and not folder_id:
        return jsonify({"error": "path or id is required"}), 400

    folders_data = _normalize_folders_data(email, _load_folders(email))
    folders = folders_data.get("folders", [])

    found = False
    for g in folders:
        if (path and g["path"] == path) or (folder_id and g.get("id") == folder_id):
            if "name" in data:
                g["name"] = data["name"]
            if "color" in data:
                g["color"] = data["color"]
            if "parent_id" in data:
                g["parent_id"] = data["parent_id"]
            if path and "path" in data:
                g["path"] = path
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

    folders_data = _normalize_folders_data(email, _load_folders(email))
    folders = folders_data.get("folders", [])

    # Remove the folder and all subfolders (paths that start with this path + "/")
    removed_ids = {
        g.get("id")
        for g in folders
        if g["path"] == path or g["path"].startswith(path + "/")
    }
    new_folders = [g for g in folders if g["path"] != path and not g["path"].startswith(path + "/")]
    if len(new_folders) == len(folders):
        return jsonify({"error": "Folder not found"}), 404

    folders_data["folders"] = new_folders
    _save_folders(email, folders_data)

    # Remove folder references from DynamoDB-backed items.
    for table, key_name in (
        (tasks_table, "task_id"),
        (actions_table, "action_id"),
        (drafts_table, "draft_id"),
    ):
        resp = table.scan(
            FilterExpression="#u = :email AND (attribute_exists(#grp) OR attribute_exists(#fid))",
            ExpressionAttributeNames={"#u": "user", "#grp": "folder", "#fid": "folder_id"},
            ExpressionAttributeValues={":email": email},
        )
        for item in resp.get("Items", []):
            grp = item.get("folder", "")
            if grp == path or grp.startswith(path + "/") or item.get("folder_id") in removed_ids:
                table.update_item(
                    Key={key_name: item[key_name]},
                    UpdateExpression="REMOVE #grp, #fid",
                    ExpressionAttributeNames={"#grp": "folder", "#fid": "folder_id"},
                )

    # Remove folder from notes with matching folder
    from routes.notes import _load_notes, _save_notes

    notes_data = _load_notes(email)
    notes_changed = False
    for n in notes_data.get("notes", []):
        if (
            (n.get("folder") and (n["folder"] == path or n["folder"].startswith(path + "/")))
            or n.get("folder_id") in removed_ids
        ):
            n["folder"] = None
            n.pop("folder_id", None)
            notes_changed = True
    if notes_changed:
        _save_notes(email, notes_data)

    # Remove folder from routines with matching folder
    from routes.routines import _routines_s3_key
    from routes.schedules import _schedules_s3_key

    for templates_key in (_routines_s3_key(email), _schedules_s3_key(email)):
        try:
            obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=templates_key)
            templates = json.loads(obj["Body"].read().decode("utf-8"))
        except Exception:
            continue
        changed = False
        for t in templates:
            if (
                (t.get("folder") and (t["folder"] == path or t["folder"].startswith(path + "/")))
                or t.get("folder_id") in removed_ids
            ):
                t["folder"] = None
                t.pop("folder_id", None)
                changed = True
        if changed:
            s3.put_object(
                Bucket=PRODUCTIVITY_BUCKET, Key=templates_key,
                Body=json.dumps(templates, indent=2),
                ContentType="application/json",
            )

    return jsonify({"ok": True})
