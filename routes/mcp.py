from decimal import Decimal
import datetime
import json
import uuid

from flask import Blueprint, Response, jsonify, request

from config import (
    PRODUCTIVITY_BUCKET,
    actions_table,
    s3,
    tasks_table,
    timelogs_table,
    _get_auth_context,
    _validate_date_range,
)
from routes.folders import _load_folders
from routes.goals import _goals_prefix
from routes.notes import _load_notes, _save_notes
from routes.routines import _routines_s3_key
from routes.schedules import _schedules_s3_key

mcp_bp = Blueprint("mcp", __name__)

MCP_PROTOCOL_VERSION = "2024-11-05"
ITEM_TYPES = ["tasks", "actions", "notes", "folders", "routines", "schedules", "goals"]
FILTER_OPS = ["eq", "neq", "contains", "starts_with", "in", "exists", "gte", "lte", "between"]
DEFAULT_QUERY_FIELDS = [
    "item_type", "id", "name", "folder", "date", "created_at", "status", "search_score"
]


def _json_default(value):
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _json_response(payload, status=200, headers=None):
    return Response(
        json.dumps(payload, default=_json_default),
        status=status,
        mimetype="application/json",
        headers=headers,
    )


def _rpc_result(request_id, result):
    return _json_response({
        "jsonrpc": "2.0",
        "id": request_id,
        "result": result,
    })


def _rpc_error(request_id, code, message, status=200):
    return _json_response({
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }, status=status)


def _auth_challenge():
    resource = request.url_root.rstrip("/")
    return _json_response(
        {"error": "unauthorized", "error_description": "Bearer token required"},
        status=401,
        headers={
            "WWW-Authenticate": (
                'Bearer resource_metadata="'
                f'{resource}/.well-known/oauth-protected-resource"'
            )
        },
    )


def _read_only_tool(name, title, description, input_schema, output_schema):
    return {
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": input_schema,
        "outputSchema": output_schema,
        "annotations": {
            "readOnlyHint": True,
            "openWorldHint": False,
            "destructiveHint": False,
        },
    }


def _write_tool(name, title, description, input_schema, output_schema):
    return {
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": input_schema,
        "outputSchema": output_schema,
        "annotations": {
            "readOnlyHint": False,
            "openWorldHint": False,
            "destructiveHint": False,
        },
    }


def _list_input_schema():
    return {
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 500,
                "description": "Maximum number of items to return. Defaults to 100.",
            },
            "folder": {
                "type": "string",
                "description": "Optional folder path to filter by, such as /work.",
            },
        },
        "additionalProperties": False,
    }


def _items_output_schema(field_name):
    return {
        "type": "object",
        "properties": {
            field_name: {"type": "array", "items": {"type": "object"}},
            "count": {"type": "integer"},
        },
        "required": [field_name, "count"],
        "additionalProperties": False,
    }


def _mutation_output_schema(item_field):
    return {
        "type": "object",
        "properties": {
            "ok": {"type": "boolean"},
            item_field: {"type": "object"},
        },
        "required": ["ok", item_field],
        "additionalProperties": False,
    }


TOOLS = [
    _read_only_tool(
        "query_items",
        "Query items",
        "Use this to find only the Efficient Hypothesis records relevant to a prompt, with server-side filtering, text search, sorting, projection, and limits.",
        {
            "type": "object",
            "properties": {
                "item_types": {
                    "type": "array",
                    "items": {"type": "string", "enum": ITEM_TYPES},
                    "description": "Datasets to query. Defaults to all item types.",
                },
                "filters": {
                    "type": "array",
                    "description": "Server-side filters. Values should be explicit strings/numbers/booleans, not relative phrases like yesterday.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {
                                "type": "string",
                                "description": "Field to filter, such as created_at, date, due_datetime, start_datetime, folder, name, status, item_type, or id.",
                            },
                            "op": {
                                "type": "string",
                                "enum": FILTER_OPS,
                                "description": "Filter operator.",
                            },
                            "value": {
                                "description": "Comparison value. Use an array of two values for between.",
                            },
                        },
                        "required": ["field", "op"],
                        "additionalProperties": False,
                    },
                },
                "search": {
                    "type": "string",
                    "description": "Optional case-insensitive text search across names, folders, dates, statuses, goal schemas, and other compact item text.",
                },
                "sort": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string"},
                            "direction": {"type": "string", "enum": ["asc", "desc"]},
                        },
                        "required": ["field"],
                        "additionalProperties": False,
                    },
                    "description": "Sort instructions. Defaults to search_score desc when search is present, otherwise date desc.",
                },
                "fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Fields to return. Defaults to compact fields: item_type, id, name, folder, date, created_at, status, search_score.",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 500,
                    "description": "Maximum number of matching items to return. Defaults to 50.",
                },
            },
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": {"type": "object"}},
                "count": {"type": "integer"},
                "total_matches": {"type": "integer"},
                "truncated": {"type": "boolean"},
            },
            "required": ["items", "count", "total_matches", "truncated"],
            "additionalProperties": False,
        },
    ),
    _read_only_tool(
        "list_tasks",
        "List tasks",
        "Use this when the user wants to view their Efficient Hypothesis tasks.",
        {
            "type": "object",
            "properties": {
                **_list_input_schema()["properties"],
                "status": {
                    "type": "string",
                    "enum": ["all", "incomplete", "complete"],
                    "description": "Optional completion filter. Defaults to all.",
                },
            },
            "additionalProperties": False,
        },
        _items_output_schema("tasks"),
    ),
    _read_only_tool(
        "list_actions",
        "List actions",
        "Use this when the user wants to view their scheduled or planned Efficient Hypothesis actions.",
        _list_input_schema(),
        _items_output_schema("actions"),
    ),
    _read_only_tool(
        "list_notes",
        "List notes",
        "Use this when the user wants to view their Efficient Hypothesis notes.",
        _list_input_schema(),
        _items_output_schema("notes"),
    ),
    _read_only_tool(
        "list_folders",
        "List folders",
        "Use this when the user wants to view their Efficient Hypothesis folders or project hierarchy.",
        {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 500,
                    "description": "Maximum number of folders to return. Defaults to 100.",
                },
            },
            "additionalProperties": False,
        },
        _items_output_schema("folders"),
    ),
    _read_only_tool(
        "list_routines",
        "List routines",
        "Use this when the user wants to view their recurring task templates in Efficient Hypothesis.",
        _list_input_schema(),
        _items_output_schema("routines"),
    ),
    _read_only_tool(
        "list_schedules",
        "List schedules",
        "Use this when the user wants to view their recurring action schedule templates in Efficient Hypothesis.",
        _list_input_schema(),
        _items_output_schema("schedules"),
    ),
    _read_only_tool(
        "list_goals",
        "List goals",
        "Use this when the user wants to view their Efficient Hypothesis goals and goal schemas.",
        {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 500,
                    "description": "Maximum number of goals to return. Defaults to 100.",
                },
            },
            "additionalProperties": False,
        },
        _items_output_schema("goals"),
    ),
    _write_tool(
        "create_note",
        "Create note",
        "Create a new Efficient Hypothesis note. Date must be explicit, such as 2026-05-25.",
        {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Note title."},
                "date": {"type": "string", "description": "Explicit note date in YYYY-MM-DD or ISO format."},
                "folder": {"type": "string", "description": "Optional folder path, such as /work."},
            },
            "required": ["name", "date"],
            "additionalProperties": False,
        },
        _mutation_output_schema("note"),
    ),
    _write_tool(
        "create_task",
        "Create task",
        "Create a new Efficient Hypothesis task. Datetimes must be explicit ISO strings.",
        {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Task name."},
                "assign_datetime": {"type": "string", "description": "Explicit ISO datetime when the task is assigned."},
                "due_datetime": {"type": "string", "description": "Explicit ISO datetime when the task is due."},
                "folder": {"type": "string", "description": "Optional folder path, such as /work."},
                "path": {"type": "string", "description": "Optional legacy path. Defaults to /."},
            },
            "required": ["name", "assign_datetime", "due_datetime"],
            "additionalProperties": False,
        },
        _mutation_output_schema("task"),
    ),
    _write_tool(
        "create_action",
        "Create action",
        "Create a new Efficient Hypothesis action. Datetimes must be explicit ISO strings.",
        {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Action name."},
                "start_datetime": {"type": "string", "description": "Explicit ISO datetime when the action starts."},
                "end_datetime": {"type": "string", "description": "Explicit ISO datetime when the action ends."},
                "folder": {"type": "string", "description": "Optional folder path, such as /work."},
                "is_planned": {"type": "boolean", "description": "Whether this is a planned action. Defaults to false."},
            },
            "required": ["name", "start_datetime", "end_datetime"],
            "additionalProperties": False,
        },
        _mutation_output_schema("action"),
    ),
    _write_tool(
        "complete_task",
        "Complete task",
        "Mark an existing Efficient Hypothesis task complete by task_id. Use query_items first if the task ID is not known.",
        {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "The task_id of the task to complete."},
            },
            "required": ["task_id"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
                "task_id": {"type": "string"},
                "completed_at": {"type": "string"},
            },
            "required": ["ok", "task_id", "completed_at"],
            "additionalProperties": False,
        },
    ),
]


def _limit(arguments):
    value = arguments.get("limit", 100)
    try:
        value = int(value)
    except (TypeError, ValueError):
        value = 100
    return max(1, min(value, 500))


def _query_limit(arguments):
    value = dict(arguments or {})
    value.setdefault("limit", 50)
    return _limit(value)


def _filter_folder(items, folder):
    if not folder:
        return items
    return [item for item in items if item.get("folder") == folder]


def _scan_user_items(table, email):
    resp = table.scan(
        FilterExpression="#u = :email",
        ExpressionAttributeNames={"#u": "user"},
        ExpressionAttributeValues={":email": email},
    )
    return resp.get("Items", [])


def _load_s3_json(key, default):
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return default


def _list_goals(email):
    prefix = _goals_prefix(email)
    try:
        resp = s3.list_objects_v2(Bucket=PRODUCTIVITY_BUCKET, Prefix=prefix)
    except Exception:
        return []

    goals = []
    for obj in resp.get("Contents", []):
        key = obj["Key"]
        if not key.endswith(".json"):
            continue
        name = key[len(prefix):].replace(".json", "")
        try:
            body = s3.get_object(
                Bucket=PRODUCTIVITY_BUCKET, Key=key
            )["Body"].read().decode("utf-8")
            goal = json.loads(body)
        except Exception:
            goal = {}
        goal["name"] = name
        goals.append(goal)
    return goals


def _canonical_item_type(item_type):
    aliases = {
        "task": "tasks",
        "action": "actions",
        "note": "notes",
        "folder": "folders",
        "routine": "routines",
        "schedule": "schedules",
        "goal": "goals",
    }
    return aliases.get(item_type, item_type)


def _item_id(item_type, item):
    id_fields = {
        "tasks": "task_id",
        "actions": "action_id",
        "notes": "id",
        "folders": "path",
        "routines": "id",
        "schedules": "id",
        "goals": "name",
    }
    return item.get(id_fields[item_type])


def _item_name(item_type, item):
    if item_type == "folders":
        return item.get("name") or item.get("path")
    if item_type == "goals":
        return item.get("display_name") or item.get("name")
    return item.get("name")


def _item_date(item_type, item):
    if item_type == "tasks":
        return item.get("due_datetime") or item.get("assign_datetime") or item.get("created_at")
    if item_type == "actions":
        return item.get("start_datetime") or item.get("end_datetime") or item.get("created_at")
    if item_type == "notes":
        return item.get("date") or item.get("created_at")
    if item_type in ("routines", "schedules"):
        return item.get("first_day") or item.get("created_at")
    if item_type == "goals":
        return item.get("created_at")
    return None


def _item_status(item_type, item):
    if item_type == "tasks":
        if item.get("due_status") in ("met", "done") or item.get("end_datetime"):
            return "complete"
        return "incomplete"
    if item_type in ("routines", "schedules"):
        return "active" if item.get("active", True) else "inactive"
    if item_type == "actions":
        return "planned" if item.get("is_planned") else "manifested"
    return None


def _augment_item(item_type, item):
    augmented = dict(item)
    augmented["item_type"] = item_type
    augmented["id"] = _item_id(item_type, item)
    augmented["name"] = _item_name(item_type, item)
    augmented["date"] = _item_date(item_type, item)
    augmented["status"] = _item_status(item_type, item)
    return augmented


def _load_items_by_type(email, item_type):
    if item_type == "tasks":
        return [_augment_item(item_type, item) for item in _scan_user_items(tasks_table, email)]
    if item_type == "actions":
        return [_augment_item(item_type, item) for item in _scan_user_items(actions_table, email)]
    if item_type == "notes":
        return [_augment_item(item_type, item) for item in _load_notes(email).get("notes", [])]
    if item_type == "folders":
        return [_augment_item(item_type, item) for item in _load_folders(email).get("folders", [])]
    if item_type == "routines":
        return [
            _augment_item(item_type, item)
            for item in _load_s3_json(_routines_s3_key(email), [])
        ]
    if item_type == "schedules":
        return [
            _augment_item(item_type, item)
            for item in _load_s3_json(_schedules_s3_key(email), [])
        ]
    if item_type == "goals":
        return [_augment_item(item_type, item) for item in _list_goals(email)]
    raise ValueError(f"Unsupported item type: {item_type}")


def _field_value(item, field):
    aliases = {
        "type": "item_type",
        "itemType": "item_type",
        "title": "name",
    }
    field = aliases.get(field, field)
    return item.get(field)


def _coerce_text(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, default=_json_default, sort_keys=True)
    return str(value)


def _compare_values(left, right):
    left_text = _coerce_text(left)
    right_text = _coerce_text(right)
    if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
        return (left > right) - (left < right)
    return (left_text > right_text) - (left_text < right_text)


def _filter_matches(item, flt):
    field = flt.get("field")
    op = flt.get("op")
    value = flt.get("value")
    if not field or op not in FILTER_OPS:
        raise ValueError(f"Invalid filter: {flt}")

    actual = _field_value(item, field)
    if op == "exists":
        return bool(actual) == bool(value if value is not None else True)
    if op == "eq":
        return actual == value
    if op == "neq":
        return actual != value
    if op == "contains":
        return _coerce_text(value).lower() in _coerce_text(actual).lower()
    if op == "starts_with":
        return _coerce_text(actual).lower().startswith(_coerce_text(value).lower())
    if op == "in":
        if not isinstance(value, list):
            raise ValueError("Filter op 'in' requires an array value")
        return actual in value
    if op == "gte":
        if actual is None:
            return False
        return _compare_values(actual, value) >= 0
    if op == "lte":
        if actual is None:
            return False
        return _compare_values(actual, value) <= 0
    if op == "between":
        if not isinstance(value, list) or len(value) != 2:
            raise ValueError("Filter op 'between' requires a two-item array value")
        if actual is None:
            return False
        return _compare_values(actual, value[0]) >= 0 and _compare_values(actual, value[1]) <= 0
    return False


def _search_text(item):
    searchable = []
    for key in [
        "item_type", "id", "name", "folder", "date", "created_at", "status",
        "assign_datetime", "due_datetime", "start_datetime", "end_datetime",
        "first_day", "pattern", "display_name",
    ]:
        searchable.append(_coerce_text(item.get(key)))
    if item.get("fields"):
        searchable.append(_coerce_text(item.get("fields")))
    return " ".join(part for part in searchable if part)


def _search_score(item, search):
    if not search:
        return 0
    text = _search_text(item).lower()
    terms = [term for term in search.lower().split() if term]
    if not terms:
        return 0
    score = 0
    name = _coerce_text(item.get("name")).lower()
    folder = _coerce_text(item.get("folder")).lower()
    for term in terms:
        if term in text:
            score += 1
        if term in name:
            score += 3
        if term in folder:
            score += 2
    return score


def _sort_key(value):
    if value is None:
        return ""
    return _coerce_text(value)


def _apply_sort(items, sort_spec, has_search):
    sort_spec = sort_spec or []
    if not sort_spec:
        sort_spec = [{"field": "search_score", "direction": "desc"}] if has_search else [
            {"field": "date", "direction": "desc"}
        ]
    for spec in reversed(sort_spec):
        field = spec.get("field")
        if not field:
            continue
        reverse = spec.get("direction", "asc") == "desc"
        if field == "search_score":
            items.sort(key=lambda item: item.get("search_score") or 0, reverse=reverse)
        else:
            items.sort(key=lambda item: _sort_key(_field_value(item, field)), reverse=reverse)
    return items


def _project_item(item, fields):
    projected = {}
    for field in fields:
        if field in item:
            projected[field] = item[field]
    return projected


def _query_items(email, arguments):
    requested_types = arguments.get("item_types") or ITEM_TYPES
    item_types = []
    for item_type in requested_types:
        canonical = _canonical_item_type(item_type)
        if canonical not in ITEM_TYPES:
            raise ValueError(f"Unsupported item type: {item_type}")
        if canonical not in item_types:
            item_types.append(canonical)

    filters = arguments.get("filters") or []
    search = (arguments.get("search") or "").strip()
    fields = arguments.get("fields") or DEFAULT_QUERY_FIELDS
    if not isinstance(fields, list) or not all(isinstance(field, str) for field in fields):
        raise ValueError("fields must be an array of strings")
    limit = _query_limit(arguments)

    items = []
    for item_type in item_types:
        items.extend(_load_items_by_type(email, item_type))

    matched = []
    for item in items:
        if filters and not all(_filter_matches(item, flt) for flt in filters):
            continue
        score = _search_score(item, search)
        if search and score <= 0:
            continue
        item["search_score"] = score
        matched.append(item)

    _apply_sort(matched, arguments.get("sort"), bool(search))
    total_matches = len(matched)
    projected = [_project_item(item, fields) for item in matched[:limit]]

    return {
        "structuredContent": {
            "items": projected,
            "count": len(projected),
            "total_matches": total_matches,
            "truncated": total_matches > len(projected),
        },
        "content": [
            {
                "type": "text",
                "text": (
                    f"Returned {len(projected)} of {total_matches} matching items."
                ),
            }
        ],
    }


def _require_nonempty(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    return value.strip()


def _validate_date_field(value, field):
    value = _require_nonempty(value, field)
    err = _validate_date_range(value)
    if err:
        raise ValueError(err)
    return value


def _mutation_result(field_name, item):
    return {
        "structuredContent": {
            "ok": True,
            field_name: item,
        },
        "content": [
            {
                "type": "text",
                "text": f"Created {field_name}: {item.get('name') or item.get('id')}.",
            }
        ],
    }


def _create_note(email, arguments):
    name = _require_nonempty(arguments.get("name"), "name")
    date = _validate_date_field(arguments.get("date"), "date")
    folder = arguments.get("folder")

    note = {
        "id": str(uuid.uuid4()),
        "name": name,
        "date": date,
        "folder": folder,
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    note = {key: value for key, value in note.items() if value is not None}

    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])
    notes.append(note)
    notes_data["notes"] = notes
    _save_notes(email, notes_data)
    return _mutation_result("note", note)


def _create_task(email, arguments):
    name = _require_nonempty(arguments.get("name"), "name")
    assign_datetime = _validate_date_field(arguments.get("assign_datetime"), "assign_datetime")
    due_datetime = _validate_date_field(arguments.get("due_datetime"), "due_datetime")

    duplicate_resp = tasks_table.scan(
        FilterExpression="#u = :email AND #n = :name AND assign_datetime = :assign AND due_datetime = :due",
        ExpressionAttributeNames={"#u": "user", "#n": "name"},
        ExpressionAttributeValues={
            ":email": email,
            ":name": name,
            ":assign": assign_datetime,
            ":due": due_datetime,
        },
    )
    if duplicate_resp.get("Items"):
        raise ValueError("A task with this name, assign date, and due date already exists")

    task = {
        "task_id": str(uuid.uuid4()),
        "user": email,
        "path": arguments.get("path") or "/",
        "name": name,
        "assign_datetime": assign_datetime,
        "due_datetime": due_datetime,
        "due_status": "pending",
        "folder": arguments.get("folder"),
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    task = {key: value for key, value in task.items() if value is not None}
    tasks_table.put_item(Item=task)
    return _mutation_result("task", _augment_item("tasks", task))


def _create_action(email, arguments):
    name = _require_nonempty(arguments.get("name"), "name")
    start_datetime = _validate_date_field(arguments.get("start_datetime"), "start_datetime")
    end_datetime = _validate_date_field(arguments.get("end_datetime"), "end_datetime")

    action = {
        "action_id": str(uuid.uuid4()),
        "user": email,
        "name": name,
        "start_datetime": start_datetime,
        "end_datetime": end_datetime,
        "folder": arguments.get("folder"),
        "is_planned": bool(arguments.get("is_planned", False)),
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    action = {key: value for key, value in action.items() if value is not None}
    actions_table.put_item(Item=action)
    return _mutation_result("action", _augment_item("actions", action))


def _complete_task(email, arguments):
    task_id = _require_nonempty(arguments.get("task_id"), "task_id")
    resp = tasks_table.get_item(Key={"task_id": task_id})
    task = resp.get("Item")
    if not task or task.get("user") != email:
        raise ValueError("Task not found")

    completed_at = datetime.datetime.utcnow().isoformat() + "Z"

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
            ExpressionAttributeValues={":now": completed_at},
        )

    tasks_table.update_item(
        Key={"task_id": task_id},
        UpdateExpression="SET end_datetime = :end, due_status = :ds",
        ExpressionAttributeValues={
            ":end": completed_at,
            ":ds": "met",
        },
    )
    return {
        "structuredContent": {
            "ok": True,
            "task_id": task_id,
            "completed_at": completed_at,
        },
        "content": [
            {
                "type": "text",
                "text": f"Completed task: {task.get('name') or task_id}.",
            }
        ],
    }


def _tool_result(field_name, items, limit):
    items = items[:limit]
    return {
        "structuredContent": {
            field_name: items,
            "count": len(items),
        },
        "content": [
            {
                "type": "text",
                "text": f"Returned {len(items)} {field_name}.",
            }
        ],
    }


def _call_tool(name, arguments, ctx):
    arguments = arguments or {}
    email = ctx["email"]
    limit = _limit(arguments)

    if name == "query_items":
        return _query_items(email, arguments)

    if name == "create_note":
        return _create_note(email, arguments)

    if name == "create_task":
        return _create_task(email, arguments)

    if name == "create_action":
        return _create_action(email, arguments)

    if name == "complete_task":
        return _complete_task(email, arguments)

    if name == "list_tasks":
        items = _filter_folder(_scan_user_items(tasks_table, email), arguments.get("folder"))
        status = arguments.get("status", "all")
        if status == "complete":
            items = [
                item for item in items
                if item.get("due_status") in ("met", "done") or item.get("end_datetime")
            ]
        elif status == "incomplete":
            items = [
                item for item in items
                if item.get("due_status") not in ("met", "done") and not item.get("end_datetime")
            ]
        return _tool_result("tasks", items, limit)

    if name == "list_actions":
        items = _filter_folder(_scan_user_items(actions_table, email), arguments.get("folder"))
        return _tool_result("actions", items, limit)

    if name == "list_notes":
        items = _filter_folder(_load_notes(email).get("notes", []), arguments.get("folder"))
        return _tool_result("notes", items, limit)

    if name == "list_folders":
        return _tool_result("folders", _load_folders(email).get("folders", []), limit)

    if name == "list_routines":
        items = _filter_folder(
            _load_s3_json(_routines_s3_key(email), []),
            arguments.get("folder"),
        )
        return _tool_result("routines", items, limit)

    if name == "list_schedules":
        items = _filter_folder(
            _load_s3_json(_schedules_s3_key(email), []),
            arguments.get("folder"),
        )
        return _tool_result("schedules", items, limit)

    if name == "list_goals":
        return _tool_result("goals", _list_goals(email), limit)

    raise KeyError(name)


@mcp_bp.route("/mcp", methods=["GET"])
@mcp_bp.route("/mcp-v2", methods=["GET"])
def mcp_info():
    return jsonify({
        "name": "Efficient Hypothesis",
        "description": "MCP endpoint for Efficient Hypothesis read and non-destructive write tools.",
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "tools": [tool["name"] for tool in TOOLS],
    })


@mcp_bp.route("/mcp", methods=["POST"])
@mcp_bp.route("/mcp-v2", methods=["POST"])
def mcp_rpc():
    payload = request.get_json(silent=True) or {}
    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params") or {}

    if method == "initialize":
        return _rpc_result(request_id, {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {
                "name": "efficient-hypothesis",
                "version": "0.1.0",
            },
        })

    if method == "notifications/initialized":
        return ("", 204)

    if method == "ping":
        return _rpc_result(request_id, {})

    if method == "tools/list":
        return _rpc_result(request_id, {"tools": TOOLS})

    if method == "tools/call":
        ctx = _get_auth_context()
        if not ctx:
            return _auth_challenge()
        name = params.get("name")
        arguments = params.get("arguments") or {}
        try:
            return _rpc_result(request_id, _call_tool(name, arguments, ctx))
        except KeyError:
            return _rpc_error(request_id, -32602, f"Unknown tool: {name}")
        except ValueError as exc:
            return _rpc_error(request_id, -32602, str(exc))

    return _rpc_error(request_id, -32601, f"Method not found: {method}")
