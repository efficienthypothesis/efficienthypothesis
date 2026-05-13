from flask import Blueprint, request, jsonify
import json
from config import (
    s3, PRODUCTIVITY_BUCKET, DEFAULT_COLOR, tasks_table, _require_auth,
)
from routes.notes import _load_notes, _save_notes
from routes.routines import _routines_s3_key

groups_bp = Blueprint('groups', __name__)


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


@groups_bp.route('/api/groups', methods=['GET'])
def api_groups_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    return jsonify(_load_groups(email))


@groups_bp.route('/api/groups', methods=['POST'])
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


@groups_bp.route('/api/groups', methods=['PUT'])
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


@groups_bp.route('/api/groups', methods=['DELETE'])
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
