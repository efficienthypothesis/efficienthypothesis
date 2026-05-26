from flask import Blueprint, request, jsonify
import datetime
import uuid
import json
import calendar
from config import (
    s3, PRODUCTIVITY_BUCKET, tasks_table, user_table,
    _require_auth, _pattern_matches_date,
)
from routes.folders import _apply_folder_ref

routines_bp = Blueprint('routines', __name__)


def _routines_s3_key(email):
    return f"{email}/routines/tasks.json"


@routines_bp.route('/api/routines', methods=['GET'])
def api_routines_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _routines_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []
    return jsonify(templates)


@routines_bp.route('/api/routines', methods=['POST'])
def api_routines_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _routines_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []

    template = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "assign_time": data.get("assign_time"),
        "due_time": data.get("due_time"),
        "first_day": data.get("first_day"),
        "pattern": data.get("pattern", "interval:1"),
        "instances": 0,
        "folder": data.get("folder"),
        "folder_id": data.get("folder_id"),
        "active": True,
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    template = _apply_folder_ref(email, template, data)
    # Store either max_instances or end_date, never both
    if data.get("end_date"):
        template["end_date"] = data["end_date"]
    else:
        template["max_instances"] = data.get("max_instances", 85)
    template = {k: v for k, v in template.items() if v is not None}
    templates.append(template)

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify(template), 201


@routines_bp.route('/api/routines/<template_id>', methods=['PUT'])
def api_routines_update(template_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _routines_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return jsonify({"error": "No routines found"}), 404

    for t in templates:
        if t.get("id") == template_id:
            if "folder" in data or "folder_id" in data:
                data = {**data, **_apply_folder_ref(email, {}, data)}
            for field in ["name", "assign_time", "due_time", "first_day", "pattern",
                          "max_instances", "end_date", "active", "folder", "folder_id"]:
                if field in data:
                    t[field] = data[field]
            # If switching modes, remove the other field
            if "end_date" in data:
                t.pop("max_instances", None)
            elif "max_instances" in data:
                t.pop("end_date", None)
            break
    else:
        return jsonify({"error": "Template not found"}), 404

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@routines_bp.route('/api/routines/<template_id>', methods=['DELETE'])
def api_routines_delete(template_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _routines_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return jsonify({"error": "No routines found"}), 404

    templates = [t for t in templates if t.get("id") != template_id]
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@routines_bp.route('/api/routines/materialize', methods=['POST'])
def api_routines_materialize():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    user_id = ctx["user_id"]

    WINDOW_DAYS = 90

    user_resp = user_table.get_item(Key={"user_id": user_id})
    user_tz_str = (user_resp.get("Item") or {}).get("timezone", "UTC")

    from zoneinfo import ZoneInfo
    try:
        user_tz = ZoneInfo(user_tz_str)
    except Exception:
        user_tz = ZoneInfo("UTC")

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    now_local = now_utc.astimezone(user_tz)
    today_local = now_local.date()
    window_end = today_local + datetime.timedelta(days=WINDOW_DAYS)

    key = _routines_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []

    if not templates:
        return jsonify({"materialized": 0, "cleaned": 0})

    resp = tasks_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    existing = resp.get("Items", [])

    # Clean stale incomplete routine instances past their due time (or from previous days)
    cleaned = 0
    for task in existing:
        if not task.get("routine_id"):
            continue
        if task.get("end_datetime"):
            continue
        due = task.get("due_datetime", "")
        assign = task.get("assign_datetime", "")
        should_delete = False
        if due:
            try:
                due_utc = datetime.datetime.fromisoformat(due.replace("Z", "+00:00"))
                if now_utc > due_utc:
                    should_delete = True
            except Exception:
                pass
        if not should_delete and assign:
            try:
                assign_utc = datetime.datetime.fromisoformat(assign.replace("Z", "+00:00"))
                assign_local = assign_utc.astimezone(user_tz).date()
                if assign_local < today_local:
                    should_delete = True
            except Exception:
                pass
        if should_delete:
            tasks_table.delete_item(Key={"task_id": task["task_id"]})
            cleaned += 1

    # Build set of (routine_id, date) pairs already materialized
    existing_routine_dates = set()
    for task in existing:
        rid = task.get("routine_id")
        if not rid:
            continue
        assign = task.get("assign_datetime", "")
        try:
            assign_utc = datetime.datetime.fromisoformat(assign.replace("Z", "+00:00"))
            assign_local = assign_utc.astimezone(user_tz).date()
        except Exception:
            continue
        existing_routine_dates.add((rid, assign_local))

    materialized = 0
    templates_changed = False
    for tpl in templates:
        if not tpl.get("active", True):
            continue

        tpl_id = tpl.get("id")
        instances = tpl.get("instances", 0)

        # Determine the template's end boundary
        tpl_end = window_end
        if "end_date" in tpl:
            try:
                end_date = datetime.date.fromisoformat(tpl["end_date"])
                if today_local > end_date:
                    continue
                tpl_end = min(window_end, end_date)
            except Exception:
                continue

        # Determine first_day
        first_day_str = tpl.get("first_day")
        if first_day_str:
            try:
                first_day = datetime.date.fromisoformat(first_day_str)
            except Exception:
                continue
        else:
            sd = tpl.get("start_date")
            if sd:
                try:
                    first_day = datetime.date.fromisoformat(sd)
                except Exception:
                    first_day = today_local
            else:
                first_day = today_local

        pattern = tpl.get("pattern", "daily")
        assign_time_str = tpl.get("assign_time", "06:00")
        try:
            ah, am = map(int, assign_time_str.split(":"))
        except Exception:
            ah, am = 6, 0

        # Iterate through each day in the rolling window
        d = max(today_local, first_day)
        while d <= tpl_end:
            # Check max_instances limit
            if "end_date" not in tpl:
                max_instances = tpl.get("max_instances", 85)
                if instances >= max_instances:
                    break

            if (tpl_id, d) in existing_routine_dates:
                d += datetime.timedelta(days=1)
                continue

            if not _pattern_matches_date(pattern, first_day, d):
                d += datetime.timedelta(days=1)
                continue

            # Build assign_datetime
            try:
                local_assign = datetime.datetime(
                    d.year, d.month, d.day, ah, am, tzinfo=user_tz
                )
                utc_assign = local_assign.astimezone(datetime.timezone.utc).isoformat()
            except Exception:
                utc_assign = datetime.datetime.now(datetime.timezone.utc).isoformat()

            # Build due_datetime
            due_dt = None
            if tpl.get("due_time"):
                try:
                    h2, m2 = map(int, tpl["due_time"].split(":"))
                    local_due = datetime.datetime(
                        d.year, d.month, d.day, h2, m2, tzinfo=user_tz
                    )
                    due_dt = local_due.astimezone(datetime.timezone.utc).isoformat()
                except Exception:
                    pass
            if not due_dt:
                local_due = datetime.datetime(
                    d.year, d.month, d.day, 23, 59, tzinfo=user_tz
                )
                due_dt = local_due.astimezone(datetime.timezone.utc).isoformat()

            item = {
                "task_id": str(uuid.uuid4()),
                "user": email,
                "path": "/",
                "name": tpl.get("name", ""),
                "assign_datetime": utc_assign,
                "due_datetime": due_dt,
                "due_status": "pending",
                "routine_id": tpl_id,
                "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
            }
            item = {k: v for k, v in item.items() if v is not None}
            tasks_table.put_item(Item=item)
            materialized += 1
            instances += 1
            templates_changed = True

            d += datetime.timedelta(days=1)

        # Update instance count on template
        if instances != tpl.get("instances", 0):
            tpl["instances"] = instances
            if "end_date" not in tpl:
                max_inst = tpl.get("max_instances", 85)
                if instances >= max_inst:
                    tpl["active"] = False

    # Save updated templates back to S3 if any changed
    if templates_changed:
        s3.put_object(
            Bucket=PRODUCTIVITY_BUCKET, Key=key,
            Body=json.dumps(templates, indent=2),
            ContentType="application/json",
        )

    return jsonify({"materialized": materialized, "cleaned": cleaned})


@routines_bp.route('/api/routines/compute-max', methods=['POST'])
def api_routines_compute_max():
    """Compute max instances possible from first_day to forward boundary."""
    ctx, err = _require_auth()
    if err:
        return err
    data = request.get_json()
    first_day_str = data.get("first_day")
    pattern = data.get("pattern", "daily")
    if not first_day_str:
        return jsonify({"error": "first_day is required"}), 400

    try:
        first_day = datetime.date.fromisoformat(first_day_str)
    except Exception:
        return jsonify({"error": "Invalid first_day format"}), 400

    # Forward boundary: last day of (current_month + 2)
    today = datetime.date.today()
    boundary_month = today.month + 2
    boundary_year = today.year
    while boundary_month > 12:
        boundary_month -= 12
        boundary_year += 1
    last_day_of_boundary = calendar.monthrange(boundary_year, boundary_month)[1]
    boundary = datetime.date(boundary_year, boundary_month, last_day_of_boundary)

    count = 0
    d = first_day
    while d <= boundary:
        if _pattern_matches_date(pattern, first_day, d):
            count += 1
        d += datetime.timedelta(days=1)

    return jsonify({"max_instances": count, "boundary": boundary.isoformat()})
