from decimal import Decimal
import json

from flask import Blueprint, Response, jsonify, request

from config import (
    PRODUCTIVITY_BUCKET,
    actions_table,
    s3,
    tasks_table,
    _get_auth_context,
)
from routes.folders import _load_folders
from routes.goals import _goals_prefix
from routes.notes import _load_notes
from routes.routines import _routines_s3_key
from routes.schedules import _schedules_s3_key

mcp_bp = Blueprint("mcp", __name__)

MCP_PROTOCOL_VERSION = "2024-11-05"


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


TOOLS = [
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
]


def _limit(arguments):
    value = arguments.get("limit", 100)
    try:
        value = int(value)
    except (TypeError, ValueError):
        value = 100
    return max(1, min(value, 500))


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
def mcp_info():
    return jsonify({
        "name": "Efficient Hypothesis",
        "description": "MCP endpoint for Efficient Hypothesis read-only tools.",
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "tools": [tool["name"] for tool in TOOLS],
    })


@mcp_bp.route("/mcp", methods=["POST"])
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

    return _rpc_error(request_id, -32601, f"Method not found: {method}")
