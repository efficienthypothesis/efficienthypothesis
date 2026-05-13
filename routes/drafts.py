from flask import Blueprint, request, jsonify
import datetime
import uuid
from config import drafts_table, _require_auth

drafts_bp = Blueprint('drafts', __name__)


@drafts_bp.route('/api/drafts', methods=['GET'])
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


@drafts_bp.route('/api/drafts', methods=['POST'])
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
        "folder": data.get("folder"),
        # Folder draft fields
        "color": data.get("color"),
        "created_at": now,
    }
    item = {k: v for k, v in item.items() if v is not None}
    drafts_table.put_item(Item=item)
    return jsonify(item), 201


@drafts_bp.route('/api/drafts/<draft_id>', methods=['PUT'])
def api_drafts_update(draft_id):
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()

    allowed = ["name", "is_routine_draft", "draft_type",
               "assign_datetime", "due_datetime",
               "pattern", "due_time", "assign_time", "first_day", "max_instances", "end_date",
               "date", "folder", "color"]
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


@drafts_bp.route('/api/drafts/<draft_id>', methods=['DELETE'])
def api_drafts_delete(draft_id):
    ctx, err = _require_auth()
    if err:
        return err
    drafts_table.delete_item(Key={"draft_id": draft_id})
    return jsonify({"ok": True})
