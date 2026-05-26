from flask import Blueprint, request, jsonify
import json
import uuid
from config import (
    s3, PRODUCTIVITY_BUCKET, DEFAULT_COLOR, actions_table, drafts_table,
    tasks_table, _require_auth,
)

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


def _new_folder_id():
    return "fld_" + uuid.uuid4().hex[:16]


def _normalize_folder(email, folder):
    folder = dict(folder or {})
    name = (folder.get("name") or "").strip()
    if not name and folder.get("path"):
        name = str(folder.get("path")).rstrip("/").split("/")[-1]
    return {
        "id": folder.get("id") or _new_folder_id(),
        "parent_id": folder.get("parent_id") or None,
        "name": name,
        "color": folder.get("color") or DEFAULT_COLOR,
    }


def _normalize_folders_data(email, data):
    folders = []
    for folder in (data or {}).get("folders", []):
        normalized = _normalize_folder(email, folder)
        if normalized["name"]:
            folders.append(normalized)
    data = dict(data or {})
    data["folders"] = folders
    return data


def _folder_maps(email):
    folders_data = _normalize_folders_data(email, _load_folders(email))
    folders = folders_data.get("folders", [])
    by_id = {f.get("id"): f for f in folders if f.get("id")}
    return folders_data, by_id


def _resolve_folder_id(email, folder_id=None):
    if not folder_id:
        return None
    _folders_data, by_id = _folder_maps(email)
    return folder_id if folder_id in by_id else None


def _apply_folder_ref(email, item, data):
    if "folder_id" not in data:
        return item
    folder_id = _resolve_folder_id(email, data.get("folder_id"))
    if folder_id:
        item["folder_id"] = folder_id
    elif data.get("folder_id") is None:
        item.pop("folder_id", None)
        item.pop("folder", None)
    return item


def _descendant_folder_ids(folders, folder_id):
    children_by_parent = {}
    for folder in folders:
        children_by_parent.setdefault(folder.get("parent_id"), []).append(folder.get("id"))
    removed = set()
    stack = [folder_id]
    while stack:
        current = stack.pop()
        if not current or current in removed:
            continue
        removed.add(current)
        stack.extend(children_by_parent.get(current, []))
    return removed


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
    name = (data.get("name") or "").strip()
    color = (data.get("color") or DEFAULT_COLOR).strip()
    parent_id = data.get("parent_id") or None

    if not name:
        return jsonify({"error": "name is required"}), 400

    folders_data, by_id = _folder_maps(email)
    folders = folders_data.get("folders", [])
    if len(folders) >= 100:
        return jsonify({"error": "Maximum 100 folders allowed"}), 400
    if parent_id and parent_id not in by_id:
        return jsonify({"error": "Parent folder not found"}), 400
    for folder in folders:
        if folder.get("parent_id") == parent_id and folder.get("name", "").lower() == name.lower():
            return jsonify({"error": "A sibling folder with this name already exists"}), 400

    new_folder = {
        "id": data.get("id") or _new_folder_id(),
        "parent_id": parent_id,
        "name": name,
        "color": color,
    }
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
    folder_id = data.get("id") or data.get("folder_id")
    if not folder_id:
        return jsonify({"error": "id is required"}), 400

    folders_data, by_id = _folder_maps(email)
    if folder_id not in by_id:
        return jsonify({"error": "Folder not found"}), 404
    if "parent_id" in data and data["parent_id"] and data["parent_id"] not in by_id:
        return jsonify({"error": "Parent folder not found"}), 400
    if "parent_id" in data and data["parent_id"] in _descendant_folder_ids(folders_data.get("folders", []), folder_id):
        return jsonify({"error": "Folder cannot be moved into itself or a descendant"}), 400

    folder = by_id[folder_id]
    new_parent_id = data.get("parent_id", folder.get("parent_id")) or None
    new_name = (data.get("name") or folder.get("name") or "").strip()
    for other in folders_data.get("folders", []):
        if (
            other.get("id") != folder_id
            and other.get("parent_id") == new_parent_id
            and other.get("name", "").lower() == new_name.lower()
        ):
            return jsonify({"error": "A sibling folder with this name already exists"}), 400

    if "name" in data:
        folder["name"] = new_name
    if "color" in data:
        folder["color"] = data["color"] or DEFAULT_COLOR
    if "parent_id" in data:
        folder["parent_id"] = new_parent_id

    folders_data["folders"] = list(by_id.values())
    _save_folders(email, folders_data)
    return jsonify({"ok": True, "folder": folder})


@folders_bp.route('/api/folders', methods=['DELETE'])
def api_folders_delete():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    folder_id = data.get("id") or data.get("folder_id")
    if not folder_id:
        return jsonify({"error": "id is required"}), 400

    folders_data = _normalize_folders_data(email, _load_folders(email))
    folders = folders_data.get("folders", [])
    removed_ids = _descendant_folder_ids(folders, folder_id)
    if not removed_ids:
        return jsonify({"error": "Folder not found"}), 404

    folders_data["folders"] = [f for f in folders if f.get("id") not in removed_ids]
    _save_folders(email, folders_data)

    for table, key_name in (
        (tasks_table, "task_id"),
        (actions_table, "action_id"),
        (drafts_table, "draft_id"),
    ):
        resp = table.scan(
            FilterExpression="#u = :email AND attribute_exists(#fid)",
            ExpressionAttributeNames={"#u": "user", "#fid": "folder_id"},
            ExpressionAttributeValues={":email": email},
        )
        for item in resp.get("Items", []):
            if item.get("folder_id") in removed_ids:
                table.update_item(
                    Key={key_name: item[key_name]},
                    UpdateExpression="REMOVE #fid, #folder",
                    ExpressionAttributeNames={"#fid": "folder_id", "#folder": "folder"},
                )

    from routes.notes import _load_notes, _save_notes

    notes_data = _load_notes(email)
    notes_changed = False
    for note in notes_data.get("notes", []):
        if note.get("folder_id") in removed_ids:
            note.pop("folder_id", None)
            note.pop("folder", None)
            notes_changed = True
    if notes_changed:
        _save_notes(email, notes_data)

    from routes.routines import _routines_s3_key
    from routes.schedules import _schedules_s3_key

    for templates_key in (_routines_s3_key(email), _schedules_s3_key(email)):
        try:
            obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=templates_key)
            templates = json.loads(obj["Body"].read().decode("utf-8"))
        except Exception:
            continue
        changed = False
        for template in templates:
            if template.get("folder_id") in removed_ids:
                template.pop("folder_id", None)
                template.pop("folder", None)
                changed = True
        if changed:
            s3.put_object(
                Bucket=PRODUCTIVITY_BUCKET, Key=templates_key,
                Body=json.dumps(templates, indent=2),
                ContentType="application/json",
            )

    return jsonify({"ok": True, "removed_folder_ids": sorted(removed_ids)})
