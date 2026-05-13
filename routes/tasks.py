from flask import Blueprint, request, jsonify
import datetime
import uuid
from config import tasks_table, timelogs_table, user_table, _require_auth, _validate_date_range

tasks_bp = Blueprint('tasks', __name__)


@tasks_bp.route('/api/tasks', methods=['GET'])
def api_tasks_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]

    resp = tasks_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    items = resp.get("Items", [])
    return jsonify(items)


@tasks_bp.route('/api/tasks', methods=['POST'])
def api_tasks_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()

    if not data.get("due_datetime"):
        return jsonify({"error": "due_datetime is required"}), 400
    if not data.get("assign_datetime"):
        return jsonify({"error": "assign_datetime is required"}), 400
    if not data.get("name", "").strip():
        return jsonify({"error": "name is required"}), 400

    # Validate date range
    for field in ("assign_datetime", "due_datetime"):
        err = _validate_date_range(data.get(field))
        if err:
            return jsonify({"error": err}), 400

    # Check for duplicate: same name + assign_datetime + due_datetime
    resp = tasks_table.scan(
        FilterExpression="#u = :email AND #n = :name AND assign_datetime = :assign AND due_datetime = :due",
        ExpressionAttributeNames={"#u": "user", "#n": "name"},
        ExpressionAttributeValues={
            ":email": email,
            ":name": data["name"].strip(),
            ":assign": data["assign_datetime"],
            ":due": data["due_datetime"],
        },
    )
    if resp.get("Items"):
        return jsonify({"error": "A task with this name, assign date, and due date already exists"}), 409

    task_id = data.get("task_id") or str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    item = {
        "task_id": task_id,
        "user": email,
        "path": data.get("path", "/"),
        "name": data.get("name", ""),
        "assign_datetime": data.get("assign_datetime"),
        "due_datetime": data.get("due_datetime"),
        "end_datetime": None,
        "due_status": "pending",
        "routine_id": data.get("routine_id"),
        "group": data.get("group"),
        "created_at": now,
    }
    # AI draft support: mark as draft with TTL for auto-cleanup
    if data.get("ai_draft"):
        item["ai_draft"] = True
        item["ai_draft_type"] = data.get("ai_draft_type", "create")  # create/update/delete
        import time
        item["ttl"] = int(time.time()) + 86400  # expire in 24 hours
    item = {k: v for k, v in item.items() if v is not None}
    tasks_table.put_item(Item=item)
    return jsonify(item), 201


@tasks_bp.route('/api/tasks/<task_id>', methods=['PUT'])
def api_tasks_update(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()

    # Validate date range for datetime fields
    for field in ("assign_datetime", "due_datetime"):
        if field in data:
            err = _validate_date_range(data[field])
            if err:
                return jsonify({"error": err}), 400

    allowed = ["name", "path", "assign_datetime", "due_datetime",
               "end_datetime", "due_status", "group",
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
        "Key": {"task_id": task_id},
        "UpdateExpression": expr,
        "ExpressionAttributeNames": attr_names,
    }
    if attr_values:
        update_args["ExpressionAttributeValues"] = attr_values
    tasks_table.update_item(**update_args)
    return jsonify({"ok": True, "task_id": task_id})


@tasks_bp.route('/api/tasks/<task_id>/start', methods=['POST'])
def api_tasks_start(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    # Stop any other running timelog for this user
    open_resp = timelogs_table.scan(
        FilterExpression="#u = :email AND attribute_not_exists(#e)",
        ExpressionAttributeNames={"#u": "user", "#e": "end"},
        ExpressionAttributeValues={":email": email},
    )
    for log in open_resp.get("Items", []):
        if log["parent_id"] != task_id:
            timelogs_table.update_item(
                Key={"log_id": log["log_id"]},
                UpdateExpression="SET #e = :now",
                ExpressionAttributeNames={"#e": "end"},
                ExpressionAttributeValues={":now": now},
            )

    # Create a new timelog entry
    log_id = str(uuid.uuid4())
    timelogs_table.put_item(Item={
        "log_id": log_id,
        "user": email,
        "parent_id": task_id,
        "parent_type": "task",
        "start": now,
        "created_at": now,
    })
    return jsonify({"ok": True, "task_id": task_id, "log_id": log_id})


@tasks_bp.route('/api/tasks/<task_id>/pause', methods=['POST'])
def api_tasks_pause(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    # Close any open timelog for this task
    open_resp = timelogs_table.scan(
        FilterExpression="#u = :email AND parent_id = :pid AND attribute_not_exists(#e)",
        ExpressionAttributeNames={"#u": "user", "#e": "end"},
        ExpressionAttributeValues={":email": email, ":pid": task_id},
    )
    for log in open_resp.get("Items", []):
        timelogs_table.update_item(
            Key={"log_id": log["log_id"]},
            UpdateExpression="SET #e = :now",
            ExpressionAttributeNames={"#e": "end"},
            ExpressionAttributeValues={":now": now},
        )
    return jsonify({"ok": True, "task_id": task_id})


@tasks_bp.route('/api/tasks/<task_id>/complete', methods=['POST'])
def api_tasks_complete(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    now = datetime.datetime.utcnow().isoformat() + 'Z'

    # Close any open timelog for this task
    open_resp = timelogs_table.scan(
        FilterExpression="#u = :email AND parent_id = :pid AND attribute_not_exists(#e)",
        ExpressionAttributeNames={"#u": "user", "#e": "end"},
        ExpressionAttributeValues={":email": email, ":pid": task_id},
    )
    for log in open_resp.get("Items", []):
        timelogs_table.update_item(
            Key={"log_id": log["log_id"]},
            UpdateExpression="SET #e = :now",
            ExpressionAttributeNames={"#e": "end"},
            ExpressionAttributeValues={":now": now},
        )

    tasks_table.update_item(
        Key={"task_id": task_id},
        UpdateExpression="SET end_datetime = :end, due_status = :ds",
        ExpressionAttributeValues={
            ":end": now,
            ":ds": "met",
        },
    )
    return jsonify({"ok": True, "task_id": task_id})


@tasks_bp.route('/api/tasks/<task_id>', methods=['DELETE'])
def api_tasks_delete(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    tasks_table.delete_item(Key={"task_id": task_id})
    # Clean up associated timelogs
    tl_resp = timelogs_table.scan(
        FilterExpression="#u = :email AND parent_id = :pid",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email, ":pid": task_id},
    )
    for log in tl_resp.get("Items", []):
        timelogs_table.delete_item(Key={"log_id": log["log_id"]})
    return jsonify({"ok": True})


@tasks_bp.route('/api/tasks/<task_id>/move', methods=['POST'])
def api_tasks_move(task_id):
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()
    new_path = data.get("path")
    if not new_path:
        return jsonify({"error": "path is required"}), 400
    tasks_table.update_item(
        Key={"task_id": task_id},
        UpdateExpression="SET #p = :p",
        ExpressionAttributeNames={"#p": "path"},
        ExpressionAttributeValues={":p": new_path},
    )
    return jsonify({"ok": True, "task_id": task_id, "path": new_path})


@tasks_bp.route('/api/tasks/calendar', methods=['GET'])
def api_tasks_calendar():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    month = request.args.get("month")
    if not month:
        return jsonify({"error": "month param required (YYYY-MM)"}), 400

    user_id = ctx["user_id"]
    user_resp = user_table.get_item(Key={"user_id": user_id})
    user_tz_str = (user_resp.get("Item") or {}).get("timezone", "UTC")

    from zoneinfo import ZoneInfo
    try:
        user_tz = ZoneInfo(user_tz_str)
    except Exception:
        user_tz = ZoneInfo("UTC")

    resp = tasks_table.scan(
        FilterExpression="#u = :email AND attribute_exists(end_datetime)",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    items = resp.get("Items", [])
    by_day = {}
    for item in items:
        end = item.get("end_datetime", "")
        if not end:
            continue
        try:
            utc_dt = datetime.datetime.fromisoformat(end.replace("Z", "+00:00"))
            local_dt = utc_dt.astimezone(user_tz)
            day = local_dt.strftime("%Y-%m-%d")
        except Exception:
            day = end[:10]
        if day.startswith(month):
            by_day.setdefault(day, []).append({
                "task_id": item["task_id"],
                "name": item.get("name", ""),
                "end_datetime": end,
                "group": item.get("group"),
            })
    return jsonify(by_day)
