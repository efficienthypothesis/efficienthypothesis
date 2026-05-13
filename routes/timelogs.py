from flask import Blueprint, request, jsonify
import datetime
import uuid
from config import timelogs_table, _require_auth

timelogs_bp = Blueprint('timelogs', __name__)


@timelogs_bp.route('/api/timelogs', methods=['GET'])
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


@timelogs_bp.route('/api/timelogs', methods=['POST'])
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


@timelogs_bp.route('/api/timelogs/<log_id>', methods=['PUT'])
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


@timelogs_bp.route('/api/timelogs/<log_id>', methods=['DELETE'])
def api_timelogs_delete(log_id):
    ctx, err = _require_auth()
    if err:
        return err
    timelogs_table.delete_item(Key={"log_id": log_id})
    return jsonify({"ok": True})
