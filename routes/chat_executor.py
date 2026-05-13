"""Deterministic execution layer for chatbot plans.
Takes a confirmed JSON plan array and executes each operation
by calling internal functions directly (no HTTP round-trips)."""

import datetime
import uuid
import json
from config import (
    tasks_table, actions_table, s3, PRODUCTIVITY_BUCKET,
    _validate_date_range,
)
from routes.routines import _routines_s3_key
from routes.schedules import _schedules_s3_key
from routes.notes import _load_notes, _save_notes
from routes.groups import _load_groups, _save_groups


def execute_plan(email, plan, user_tz_str="UTC"):
    """Execute a confirmed plan. Returns list of results per operation."""
    results = []
    for op in plan:
        action = op.get("action", "")
        data = op.get("data", {})
        try:
            if action == "create_task":
                result = _create_task(email, data)
            elif action == "update_task":
                result = _update_task(email, data)
            elif action == "delete_task":
                result = _delete_task(email, data)
            elif action == "create_action":
                result = _create_action(email, data)
            elif action == "update_action":
                result = _update_action(email, data)
            elif action == "delete_action":
                result = _delete_action(email, data)
            elif action == "create_routine":
                result = _create_routine(email, data)
            elif action == "update_routine":
                result = _update_routine(email, data)
            elif action == "delete_routine":
                result = _delete_routine(email, data)
            elif action == "create_schedule":
                result = _create_schedule(email, data)
            elif action == "update_schedule":
                result = _update_schedule(email, data)
            elif action == "delete_schedule":
                result = _delete_schedule(email, data)
            elif action == "create_note":
                result = _create_note(email, data)
            elif action == "update_note":
                result = _update_note(email, data)
            elif action == "delete_note":
                result = _delete_note(email, data)
            elif action == "create_group":
                result = _create_group(email, data)
            elif action == "update_group":
                result = _update_group(email, data)
            elif action == "delete_group":
                result = _delete_group(email, data)
            elif action == "create_goal":
                result = _create_goal(email, data)
            elif action == "log_goal":
                result = _log_goal(email, data)
            else:
                result = {"ok": False, "error": f"Unknown action: {action}"}
            results.append({"action": action, **result})
        except Exception as e:
            results.append({"action": action, "ok": False, "error": str(e)})
    return results


# --- Tasks ---

def _create_task(email, data):
    task_id = str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + 'Z'
    item = {
        "task_id": task_id,
        "user": email,
        "path": data.get("path", "/"),
        "name": data.get("name", ""),
        "assign_datetime": data.get("assign_datetime"),
        "due_datetime": data.get("due_datetime"),
        "time_log": [],
        "due_status": "pending",
        "routine_id": data.get("routine_id"),
        "group": data.get("group"),
        "created_at": now,
    }
    item = {k: v for k, v in item.items() if v is not None}
    tasks_table.put_item(Item=item)
    return {"ok": True, "task_id": task_id}


def _update_task(email, data):
    task_id = data.get("task_id") or _find_task_id(email, data)
    if not task_id:
        return {"ok": False, "error": "Could not find task to update"}
    allowed = ["name", "path", "assign_datetime", "due_datetime", "group"]
    expr_parts, attr_names, attr_values = _build_update_expr(data, allowed)
    if not expr_parts:
        return {"ok": False, "error": "No fields to update"}
    tasks_table.update_item(
        Key={"task_id": task_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
    )
    return {"ok": True, "task_id": task_id}


def _delete_task(email, data):
    task_id = data.get("task_id") or _find_task_id(email, data)
    if not task_id:
        return {"ok": False, "error": "Could not find task to delete"}
    tasks_table.delete_item(Key={"task_id": task_id})
    return {"ok": True, "task_id": task_id}


def _find_task_id(email, data):
    """Find a task by name match."""
    name = data.get("name", "").strip()
    if not name:
        return None
    resp = tasks_table.scan(
        FilterExpression="#u = :email AND #n = :name",
        ExpressionAttributeNames={"#u": "user", "#n": "name"},
        ExpressionAttributeValues={":email": email, ":name": name},
    )
    items = resp.get("Items", [])
    return items[0]["task_id"] if items else None


# --- Actions ---

def _create_action(email, data):
    action_id = str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + 'Z'
    item = {
        "action_id": action_id,
        "user": email,
        "name": data.get("name", ""),
        "start_datetime": data.get("start_datetime"),
        "end_datetime": data.get("end_datetime"),
        "schedule_id": data.get("schedule_id"),
        "group": data.get("group"),
        "is_planned": data.get("is_planned", False),
        "created_at": now,
    }
    item = {k: v for k, v in item.items() if v is not None}
    actions_table.put_item(Item=item)
    return {"ok": True, "action_id": action_id}


def _update_action(email, data):
    action_id = data.get("action_id") or _find_action_id(email, data)
    if not action_id:
        return {"ok": False, "error": "Could not find action to update"}
    allowed = ["name", "start_datetime", "end_datetime", "group", "is_planned"]
    expr_parts, attr_names, attr_values = _build_update_expr(data, allowed)
    if not expr_parts:
        return {"ok": False, "error": "No fields to update"}
    actions_table.update_item(
        Key={"action_id": action_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
    )
    return {"ok": True, "action_id": action_id}


def _delete_action(email, data):
    action_id = data.get("action_id") or _find_action_id(email, data)
    if not action_id:
        return {"ok": False, "error": "Could not find action to delete"}
    actions_table.delete_item(Key={"action_id": action_id})
    return {"ok": True, "action_id": action_id}


def _find_action_id(email, data):
    name = data.get("name", "").strip()
    if not name:
        return None
    resp = actions_table.scan(
        FilterExpression="#u = :email AND #n = :name",
        ExpressionAttributeNames={"#u": "user", "#n": "name"},
        ExpressionAttributeValues={":email": email, ":name": name},
    )
    items = resp.get("Items", [])
    return items[0]["action_id"] if items else None


# --- Routines (S3 templates) ---

def _create_routine(email, data):
    key = _routines_s3_key(email)
    templates = _load_s3_json(key)
    template = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "assign_time": data.get("assign_time"),
        "due_time": data.get("due_time"),
        "first_day": data.get("first_day"),
        "pattern": data.get("pattern", "interval:1"),
        "instances": 0,
        "group": data.get("group"),
        "active": True,
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    if data.get("end_date"):
        template["end_date"] = data["end_date"]
    else:
        template["max_instances"] = data.get("max_instances", 85)
    template = {k: v for k, v in template.items() if v is not None}
    templates.append(template)
    _save_s3_json(key, templates)
    return {"ok": True, "routine_id": template["id"]}


def _update_routine(email, data):
    key = _routines_s3_key(email)
    templates = _load_s3_json(key)
    rid = data.get("id") or _find_template_id(templates, data.get("name"))
    if not rid:
        return {"ok": False, "error": "Routine not found"}
    for t in templates:
        if t.get("id") == rid:
            for field in ["name", "assign_time", "due_time", "first_day", "pattern",
                          "max_instances", "end_date", "active", "group"]:
                if field in data:
                    t[field] = data[field]
            if "end_date" in data:
                t.pop("max_instances", None)
            elif "max_instances" in data:
                t.pop("end_date", None)
            break
    _save_s3_json(key, templates)
    return {"ok": True, "routine_id": rid}


def _delete_routine(email, data):
    key = _routines_s3_key(email)
    templates = _load_s3_json(key)
    rid = data.get("id") or _find_template_id(templates, data.get("name"))
    if not rid:
        return {"ok": False, "error": "Routine not found"}
    templates = [t for t in templates if t.get("id") != rid]
    _save_s3_json(key, templates)
    return {"ok": True, "routine_id": rid}


# --- Schedules (S3 templates) ---

def _create_schedule(email, data):
    key = _schedules_s3_key(email)
    templates = _load_s3_json(key)
    template = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "start_time": data.get("start_time"),
        "end_time": data.get("end_time"),
        "first_day": data.get("first_day"),
        "pattern": data.get("pattern", "interval:1"),
        "instances": 0,
        "group": data.get("group"),
        "active": True,
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    if data.get("end_date"):
        template["end_date"] = data["end_date"]
    else:
        template["max_instances"] = data.get("max_instances", 85)
    template = {k: v for k, v in template.items() if v is not None}
    templates.append(template)
    _save_s3_json(key, templates)
    return {"ok": True, "schedule_id": template["id"]}


def _update_schedule(email, data):
    key = _schedules_s3_key(email)
    templates = _load_s3_json(key)
    sid = data.get("id") or _find_template_id(templates, data.get("name"))
    if not sid:
        return {"ok": False, "error": "Schedule not found"}
    for t in templates:
        if t.get("id") == sid:
            for field in ["name", "start_time", "end_time", "first_day", "pattern",
                          "max_instances", "end_date", "active", "group"]:
                if field in data:
                    t[field] = data[field]
            if "end_date" in data:
                t.pop("max_instances", None)
            elif "max_instances" in data:
                t.pop("end_date", None)
            break
    _save_s3_json(key, templates)
    return {"ok": True, "schedule_id": sid}


def _delete_schedule(email, data):
    key = _schedules_s3_key(email)
    templates = _load_s3_json(key)
    sid = data.get("id") or _find_template_id(templates, data.get("name"))
    if not sid:
        return {"ok": False, "error": "Schedule not found"}
    templates = [t for t in templates if t.get("id") != sid]
    _save_s3_json(key, templates)
    return {"ok": True, "schedule_id": sid}


# --- Notes (S3) ---

def _create_note(email, data):
    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])
    note = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "date": data.get("date", ""),
        "group": data.get("group"),
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    notes.append(note)
    notes_data["notes"] = notes
    _save_notes(email, notes_data)
    return {"ok": True, "note_id": note["id"]}


def _update_note(email, data):
    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])
    nid = data.get("id") or _find_note_id(notes, data.get("name"))
    if not nid:
        return {"ok": False, "error": "Note not found"}
    for n in notes:
        if n["id"] == nid:
            for field in ["name", "date", "group"]:
                if field in data:
                    n[field] = data[field]
            break
    notes_data["notes"] = notes
    _save_notes(email, notes_data)
    return {"ok": True, "note_id": nid}


def _delete_note(email, data):
    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])
    nid = data.get("id") or _find_note_id(notes, data.get("name"))
    if not nid:
        return {"ok": False, "error": "Note not found"}
    notes_data["notes"] = [n for n in notes if n["id"] != nid]
    _save_notes(email, notes_data)
    return {"ok": True, "note_id": nid}


# --- Groups (S3) ---

def _create_group(email, data):
    groups_data = _load_groups(email)
    groups = groups_data.get("groups", [])
    path = data.get("path", "")
    # Check if already exists
    for g in groups:
        if g["path"] == path:
            return {"ok": True, "note": "Group already exists", "path": path}
    groups.append({
        "path": path,
        "name": data.get("name", path.split("/")[-1]),
        "color": data.get("color", "#000000"),
    })
    groups_data["groups"] = groups
    _save_groups(email, groups_data)
    return {"ok": True, "path": path}


def _update_group(email, data):
    groups_data = _load_groups(email)
    groups = groups_data.get("groups", [])
    path = data.get("path", "")
    for g in groups:
        if g["path"] == path:
            if "name" in data:
                g["name"] = data["name"]
            if "color" in data:
                g["color"] = data["color"]
            break
    else:
        return {"ok": False, "error": "Group not found"}
    groups_data["groups"] = groups
    _save_groups(email, groups_data)
    return {"ok": True, "path": path}


def _delete_group(email, data):
    groups_data = _load_groups(email)
    groups = groups_data.get("groups", [])
    path = data.get("path", "")
    new_groups = [g for g in groups if g["path"] != path]
    if len(new_groups) == len(groups):
        return {"ok": False, "error": "Group not found"}
    groups_data["groups"] = new_groups
    _save_groups(email, groups_data)
    return {"ok": True, "path": path}


# --- Goals (S3) ---

def _create_goal(email, data):
    name = data.get("name", "").strip().lower().replace(" ", "_")
    if not name:
        return {"ok": False, "error": "Goal name required"}
    goal = {
        "display_name": data.get("display_name", name),
        "fields": data.get("fields", []),
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    key = f"{email}/goals/{name}.json"
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(goal, indent=2),
        ContentType="application/json",
    )
    return {"ok": True, "goal_name": name}


def _log_goal(email, data):
    name = data.get("name", "")
    date = data.get("date", "")
    entry = data.get("entry", {})
    if not name or not date:
        return {"ok": False, "error": "Goal name and date required"}
    key = f"{email}/data/{name}/{date}.json"
    try:
        body = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)["Body"].read().decode("utf-8")
        day_data = json.loads(body)
    except Exception:
        day_data = {"entries": []}
    entry["logged_at"] = datetime.datetime.utcnow().isoformat() + 'Z'
    day_data["entries"].append(entry)
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(day_data, indent=2),
        ContentType="application/json",
    )
    return {"ok": True, "goal_name": name, "date": date}


# --- Helpers ---

def _build_update_expr(data, allowed):
    """Build DynamoDB SET update expression parts."""
    parts = []
    attr_names = {}
    attr_values = {}
    for key in allowed:
        if key in data:
            placeholder = f"#f_{key}"
            value_ph = f":v_{key}"
            parts.append(f"{placeholder} = {value_ph}")
            attr_names[placeholder] = key
            attr_values[value_ph] = data[key]
    return parts, attr_names, attr_values


def _find_template_id(templates, name):
    """Find a template ID by name match."""
    if not name:
        return None
    name_lower = name.strip().lower()
    for t in templates:
        if t.get("name", "").strip().lower() == name_lower:
            return t.get("id")
    return None


def _find_note_id(notes, name):
    """Find a note ID by name match."""
    if not name:
        return None
    name_lower = name.strip().lower()
    for n in notes:
        if n.get("name", "").strip().lower() == name_lower:
            return n.get("id")
    return None


def _load_s3_json(key):
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return []


def _save_s3_json(key, data):
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(data, indent=2),
        ContentType="application/json",
    )
