from flask import Blueprint, request, jsonify
import datetime
import uuid
import json
from config import (
    s3, PRODUCTIVITY_BUCKET, actions_table, user_table,
    _require_auth, _pattern_matches_date,
)

schedules_bp = Blueprint('schedules', __name__)


def _schedules_s3_key(email):
    return f"{email}/schedules/actions.json"


@schedules_bp.route('/api/schedules', methods=['GET'])
def api_schedules_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _schedules_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []
    return jsonify(templates)


@schedules_bp.route('/api/schedules', methods=['POST'])
def api_schedules_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _schedules_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []

    template = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "start_time": data.get("start_time"),
        "end_time": data.get("end_time"),
        "first_day": data.get("first_day"),
        "pattern": data.get("pattern", "interval:1"),
        "instances": 0,
        "folder": data.get("folder"),
        "active": True,
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    # Store either max_instances or end_date (mode-based, same as routines)
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


@schedules_bp.route('/api/schedules/<template_id>', methods=['PUT'])
def api_schedules_update(template_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _schedules_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return jsonify({"error": "No schedules found"}), 404

    for t in templates:
        if t.get("id") == template_id:
            for field in ["name", "start_time", "end_time", "first_day", "pattern",
                          "max_instances", "end_date", "active", "folder"]:
                if field in data:
                    t[field] = data[field]
            if "end_date" in data:
                t.pop("max_instances", None)
            elif "max_instances" in data:
                t.pop("end_date", None)
            break
    else:
        return jsonify({"error": "Schedule not found"}), 404

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@schedules_bp.route('/api/schedules/<template_id>', methods=['DELETE'])
def api_schedules_delete(template_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _schedules_s3_key(email)

    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return jsonify({"error": "No schedules found"}), 404

    templates = [t for t in templates if t.get("id") != template_id]
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(templates, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@schedules_bp.route('/api/schedules/materialize', methods=['POST'])
def api_schedules_materialize():
    """Generate planned actions from schedule templates for the next 90 days.
    Also cleans expired planned actions (2 days past end_datetime)."""
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

    key = _schedules_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        templates = json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        templates = []

    # Fetch existing actions
    resp = actions_table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    existing = resp.get("Items", [])

    # Clean expired planned actions: is_planned=True and end_datetime + 2 days < now
    cleaned = 0
    for action in existing:
        if not action.get("is_planned"):
            continue
        end = action.get("end_datetime", "")
        if end:
            try:
                end_utc = datetime.datetime.fromisoformat(end.replace("Z", "+00:00"))
                expiry = end_utc + datetime.timedelta(days=2)
                if now_utc > expiry:
                    actions_table.delete_item(Key={"action_id": action["action_id"]})
                    cleaned += 1
            except Exception:
                pass

    if not templates:
        return jsonify({"materialized": 0, "cleaned": cleaned})

    # Build set of (schedule_id, date) pairs already materialized
    existing_schedule_dates = set()
    for action in existing:
        sid = action.get("schedule_id")
        if not sid:
            continue
        start = action.get("start_datetime", "")
        try:
            start_utc = datetime.datetime.fromisoformat(start.replace("Z", "+00:00"))
            start_local = start_utc.astimezone(user_tz).date()
        except Exception:
            continue
        existing_schedule_dates.add((sid, start_local))

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

        first_day_str = tpl.get("first_day")
        if first_day_str:
            try:
                first_day = datetime.date.fromisoformat(first_day_str)
            except Exception:
                continue
        else:
            first_day = today_local

        pattern = tpl.get("pattern", "interval:1")
        start_time_str = tpl.get("start_time", "08:00")
        end_time_str = tpl.get("end_time", "09:00")
        try:
            sh, sm = map(int, start_time_str.split(":"))
        except Exception:
            sh, sm = 8, 0
        try:
            eh, em = map(int, end_time_str.split(":"))
        except Exception:
            eh, em = 9, 0

        # Iterate through each day in the rolling window
        d = max(today_local, first_day)
        while d <= tpl_end:
            # Check max_instances limit
            if "end_date" not in tpl:
                max_instances = tpl.get("max_instances", 85)
                if instances >= max_instances:
                    break

            if (tpl_id, d) in existing_schedule_dates:
                d += datetime.timedelta(days=1)
                continue

            if not _pattern_matches_date(pattern, first_day, d):
                d += datetime.timedelta(days=1)
                continue

            # Build start_datetime
            try:
                local_start = datetime.datetime(
                    d.year, d.month, d.day, sh, sm, tzinfo=user_tz
                )
                utc_start = local_start.astimezone(datetime.timezone.utc).isoformat()
            except Exception:
                utc_start = now_utc.isoformat()

            # Build end_datetime (handle overnight: end <= start)
            try:
                end_day = d
                if (eh * 60 + em) <= (sh * 60 + sm):
                    end_day = d + datetime.timedelta(days=1)
                local_end = datetime.datetime(
                    end_day.year, end_day.month, end_day.day, eh, em,
                    tzinfo=user_tz
                )
                utc_end = local_end.astimezone(datetime.timezone.utc).isoformat()
            except Exception:
                utc_end = (now_utc + datetime.timedelta(hours=1)).isoformat()

            item = {
                "action_id": str(uuid.uuid4()),
                "user": email,
                "name": tpl.get("name", ""),
                "start_datetime": utc_start,
                "end_datetime": utc_end,
                "schedule_id": tpl_id,
                "folder": tpl.get("folder"),
                "is_planned": True,
                "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
            }
            item = {k: v for k, v in item.items() if v is not None}
            actions_table.put_item(Item=item)
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

    if templates_changed:
        s3.put_object(
            Bucket=PRODUCTIVITY_BUCKET, Key=key,
            Body=json.dumps(templates, indent=2),
            ContentType="application/json",
        )

    return jsonify({"materialized": materialized, "cleaned": cleaned})
