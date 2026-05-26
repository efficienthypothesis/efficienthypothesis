from flask import Blueprint, request, jsonify
import datetime
import uuid
from config import actions_table, _require_auth, _validate_date_range
from routes.folders import _apply_folder_ref

actions_bp = Blueprint('actions', __name__)


@actions_bp.route('/api/actions', methods=['GET'])
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


@actions_bp.route('/api/actions', methods=['POST'])
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
        "folder_id": data.get("folder_id"),
        "is_planned": data.get("is_planned", False),
        "created_at": now,
    }
    item = _apply_folder_ref(email, item, data)
    # AI draft support: mark as draft with TTL for auto-cleanup
    if data.get("ai_draft"):
        item["ai_draft"] = True
        item["ai_draft_type"] = data.get("ai_draft_type", "create")  # create/update/delete
        import time
        item["ttl"] = int(time.time()) + 86400  # expire in 24 hours
    item = {k: v for k, v in item.items() if v is not None}
    actions_table.put_item(Item=item)
    return jsonify(item), 201


@actions_bp.route('/api/actions/<action_id>', methods=['PUT'])
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

    if "folder_id" in data:
        folder_item = _apply_folder_ref(email=ctx["email"], item={}, data=data)
        if "folder_id" in folder_item:
            data["folder_id"] = folder_item["folder_id"]
        elif data.get("folder_id") is None:
            data["folder_id"] = None

    allowed = ["name", "start_datetime", "end_datetime", "folder_id", "is_planned",
               "ai_draft", "ai_draft_type", "ttl"]
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


@actions_bp.route('/api/actions/<action_id>', methods=['DELETE'])
def api_actions_delete(action_id):
    ctx, err = _require_auth()
    if err:
        return err
    actions_table.delete_item(Key={"action_id": action_id})
    return jsonify({"ok": True})


@actions_bp.route('/api/actions/<action_id>/manifest', methods=['POST'])
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
