import datetime
import json
import re
import uuid
from copy import deepcopy
from zoneinfo import ZoneInfo
from botocore.exceptions import BotoCoreError, ClientError

from flask import Blueprint, Response, jsonify, request

from config import PRODUCTIVITY_BUCKET, s3, user_table, _get_auth_context
from routes.workspace_access import active_chatgpt_grant, delete_chatgpt_grant
from routes.workspace_crypto import (
    decrypt_workspace_envelope,
    is_encrypted_workspace,
)
from routes.projects import (
    PROJECT_BY_ID,
    _normalize_daily_context,
    _read_daily_context,
    _write_daily_context,
    _store_daily_context_image,
    _normalize_recommendations,
    _read_recommendations,
    _write_recommendations,
    _query_daily_context_metadata,
    _query_research_metadata,
    _read_recommendation_context,
    _read_research_item,
    _write_research_item,
)


mcp_bp = Blueprint("mcp", __name__)

MCP_PROTOCOL_VERSION = "2024-11-05"
NODE_TYPES = ["task", "website", "subscription", "tag", "location", "identity", "asset"]
TAGGABLE_NODE_TYPES = ["task", "website", "subscription", "identity", "asset"]
COLLECTIONS = {
    "task": "tasks",
    "website": "websites",
    "subscription": "subscriptions",
    "tag": "tags",
    "location": "locations",
    "identity": "identities",
    "asset": "assets",
}
RETIRED_DOCUMENT_KEYS = {
    "timetable",
    "routine_sunday",
    "routine_monday",
    "routine_tuesday",
    "routine_wednesday",
    "routine_thursday",
    "routine_friday",
    "routine_saturday",
}
DOCUMENT_KEYS = [
    "tasks",
    "websites_subscriptions",
    "tags",
    "profile",
]
DEFAULT_TAG_COLOR = "#D1D5DB"
TASK_AI_CONTEXT_MAX_LENGTH = 6000
ARCHIVE_LEVELS = [0, 1, 2]
MISSING = object()


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _make_id(prefix):
    return f"{prefix}_{uuid.uuid4()}"


def _json_response(payload, status=200, headers=None):
    return Response(
        json.dumps(payload),
        status=status,
        mimetype="application/json",
        headers=headers,
    )


def _rpc_result(request_id, result):
    return _json_response({"jsonrpc": "2.0", "id": request_id, "result": result})


def _rpc_error(request_id, code, message, status=200):
    return _json_response(
        {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}},
        status=status,
    )


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


def _write_tool(name, title, description, input_schema, output_schema, destructive=False):
    return {
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": input_schema,
        "outputSchema": output_schema,
        "annotations": {
            "readOnlyHint": False,
            "openWorldHint": False,
            "destructiveHint": destructive,
        },
    }


def _node_type_schema(description="Node type."):
    return {"type": "string", "enum": NODE_TYPES, "description": description}


def _document_key_schema(description="Optional target editor document."):
    return {"type": "string", "enum": DOCUMENT_KEYS, "description": description}


def _node_output_schema():
    return {
        "type": "object",
        "properties": {
            "ok": {"type": "boolean"},
            "node": {"type": "object"},
            "created": {"type": "boolean"},
        },
        "required": ["ok", "node", "created"],
        "additionalProperties": False,
    }


def _node_fields_schema(description):
    nullable_string = {"type": ["string", "null"]}
    return {
        "type": "object",
        "description": description,
        "properties": {
            "name": {"type": "string", "description": "Updated node name. Used by update_node."},
            "note": {**nullable_string, "description": "Human-visible note."},
            "tag_name": {**nullable_string, "description": "Tag name. Use null to clear."},
            "tagName": {**nullable_string, "description": "Tag name alias. Use null to clear."},
            "datetime": {**nullable_string, "description": "Task date/time text."},
            "datetime_raw": {**nullable_string, "description": "Task date/time text alias."},
            "datetimeRaw": {**nullable_string, "description": "Task date/time text alias."},
            "AI_context": {
                **nullable_string,
                "description": (
                    "AI-only task context hidden from the website UI. "
                    f"Limited to {TASK_AI_CONTEXT_MAX_LENGTH} characters."
                ),
                "maxLength": TASK_AI_CONTEXT_MAX_LENGTH,
            },
            "ai_context": {
                **nullable_string,
                "description": "Alias for task AI_context.",
                "maxLength": TASK_AI_CONTEXT_MAX_LENGTH,
            },
            "aiContext": {
                **nullable_string,
                "description": "Alias for task AI_context.",
                "maxLength": TASK_AI_CONTEXT_MAX_LENGTH,
            },
            "rate": {
                "anyOf": [
                    {
                        "type": "object",
                        "properties": {
                            "amount": {"type": "number"},
                            "currency": {"type": "string"},
                            "intervalCount": {"type": "integer", "minimum": 1},
                            "intervalUnit": {
                                "type": "string",
                                "enum": [
                                    "day",
                                    "days",
                                    "week",
                                    "weeks",
                                    "month",
                                    "months",
                                    "year",
                                    "years",
                                ],
                            },
                        },
                        "required": ["amount", "currency", "intervalCount", "intervalUnit"],
                        "additionalProperties": False,
                    },
                    {"type": "null"},
                ],
                "description": "Subscription rate.",
            },
            "identity_names": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Website identity names.",
            },
            "identities": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Website identity names alias.",
            },
            "color": {**nullable_string, "description": "Tag color as #RRGGBB."},
            "address": {**nullable_string, "description": "Location address."},
            "reference_name": {**nullable_string, "description": "Identity reference website or asset name."},
            "reference_location_name": {**nullable_string, "description": "Asset reference location name."},
            "reference": {**nullable_string, "description": "Reference name alias."},
        },
        "additionalProperties": False,
    }


TOOLS = [
    _read_only_tool(
        "get_daily_context",
        "Get project daily context",
        "Read one user's dated project context file. Use this for recommendations across one or more days.",
        {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "enum": list(PROJECT_BY_ID)},
                "date": {"type": "string", "description": "Date in YYYY-MM-DD form."},
            },
            "required": ["project_id", "date"],
            "additionalProperties": False,
        },
        {"type": "object", "properties": {"dailyContext": {"type": "object"}}, "required": ["dailyContext"], "additionalProperties": False},
    ),
    _write_tool(
        "upsert_daily_context",
        "Update project daily context",
        "Add or replace a dated project's text context entries. Use add_daily_context_image for image entries.",
        {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "enum": list(PROJECT_BY_ID)},
                "date": {"type": "string", "description": "Date in YYYY-MM-DD form."},
                "entries": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "time": {"type": ["string", "null"]},
                            "summary": {"type": "string"},
                        },
                        "required": ["id", "summary"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["project_id", "date", "entries"],
            "additionalProperties": False,
        },
        {"type": "object", "properties": {"dailyContext": {"type": "object"}}, "required": ["dailyContext"], "additionalProperties": False},
    ),
    _write_tool(
        "add_daily_context_image",
        "Add daily context image",
        "Store a user-scoped PNG, JPEG, or WebP image as daily project context. Send bounded base64 data and a concise summary.",
        {"type": "object", "properties": {"project_id": {"type": "string", "enum": list(PROJECT_BY_ID)}, "date": {"type": "string"}, "image_data": {"type": "string", "description": "Base64 image data or a base64 data URL, maximum 5 MiB decoded."}, "summary": {"type": "string"}, "time": {"type": "string"}, "filename": {"type": "string"}}, "required": ["project_id", "date", "image_data", "summary"], "additionalProperties": False},
        {"type": "object", "properties": {"entry": {"type": "object"}}, "required": ["entry"], "additionalProperties": False},
    ),
    _read_only_tool(
        "get_project_recommendations",
        "Get project recommendations",
        "Read AI recommendation summaries for one project and calendar date.",
        {"type": "object", "properties": {"project_id": {"type": "string", "enum": list(PROJECT_BY_ID)}, "date": {"type": "string"}}, "required": ["project_id", "date"], "additionalProperties": False},
        {"type": "object", "properties": {"recommendations": {"type": "object"}}, "required": ["recommendations"], "additionalProperties": False},
    ),
    _read_only_tool(
        "get_recommendation_context",
        "Get recommendation context",
        "Read active research metadata and up to 31 days of prior recommendations for one project/date before generating new recommendations.",
        {"type": "object", "properties": {"project_id": {"type": "string", "enum": list(PROJECT_BY_ID)}, "date": {"type": "string"}}, "required": ["project_id", "date"], "additionalProperties": False},
        {"type": "object", "properties": {"context": {"type": "object"}}, "required": ["context"], "additionalProperties": False},
    ),
    _write_tool(
        "upsert_project_recommendations",
        "Store project recommendations",
        "Store dated routine recommendation files. Workout is temporarily disabled. Each routine must be a sequence of item/command steps.",
        {"type": "object", "properties": {"project_id": {"type": "string", "enum": list(PROJECT_BY_ID)}, "date": {"type": "string"}, "recommendations": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "kind": {"type": "string", "enum": ["routine"]}, "title": {"type": "string"}, "summary": {"type": "string"}, "steps": {"type": "array", "items": {"type": "object", "properties": {"item": {"type": "string"}, "command": {"type": "string"}, "clarification": {"type": "string"}}, "required": ["item", "command"], "additionalProperties": False}}}, "required": ["id", "kind", "title", "summary", "steps"], "additionalProperties": False}}}, "required": ["project_id", "date", "recommendations"], "additionalProperties": False},
        {"type": "object", "properties": {"recommendations": {"type": "object"}}, "required": ["recommendations"], "additionalProperties": False},
    ),
    _read_only_tool(
        "list_daily_context_metadata",
        "List daily context metadata",
        "List DynamoDB metadata for project daily context files so GPT can decide which dated S3-backed context to read.",
        {"type": "object", "properties": {"project_id": {"type": "string", "enum": list(PROJECT_BY_ID)}, "date_from": {"type": "string"}, "date_to": {"type": "string"}}, "required": ["project_id"], "additionalProperties": False},
        {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "object"}}}, "required": ["items"], "additionalProperties": False},
    ),
    _read_only_tool(
        "list_project_research",
        "List project research metadata",
        "List active project research metadata from DynamoDB. Use this first to decide which full S3-backed research items are relevant.",
        {"type": "object", "properties": {"project_id": {"type": "string", "enum": list(PROJECT_BY_ID)}, "include_inactive": {"type": "boolean"}}, "required": ["project_id"], "additionalProperties": False},
        {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "object"}}}, "required": ["items"], "additionalProperties": False},
    ),
    _read_only_tool(
        "get_project_research_item",
        "Get project research item",
        "Read one full S3-backed project research item by research ID after selecting it from metadata.",
        {"type": "object", "properties": {"project_id": {"type": "string", "enum": list(PROJECT_BY_ID)}, "research_id": {"type": "string"}}, "required": ["project_id", "research_id"], "additionalProperties": False},
        {"type": "object", "properties": {"researchItem": {"type": "object"}}, "required": ["researchItem"], "additionalProperties": False},
    ),
    _write_tool(
        "upsert_project_research_item",
        "Store project research item",
        "Store one research item in S3 and its discovery metadata in DynamoDB.",
        {"type": "object", "properties": {"project_id": {"type": "string", "enum": list(PROJECT_BY_ID)}, "research_item": {"type": "object"}}, "required": ["project_id", "research_item"], "additionalProperties": False},
        {"type": "object", "properties": {"researchItem": {"type": "object"}}, "required": ["researchItem"], "additionalProperties": False},
    ),
    _read_only_tool(
        "query_nodes",
        "Query workspace nodes",
        (
            "Find Efficient Hypothesis workspace nodes in the new editor model. "
            "Use this before exact-ID update/archive/restore calls."
        ),
        {
            "type": "object",
            "properties": {
                "node_types": {
                    "type": "array",
                    "items": {"type": "string", "enum": NODE_TYPES},
                    "description": "Node types to include. Defaults to all node types.",
                },
                "archive_levels": {
                    "type": "array",
                    "items": {"type": "integer", "enum": ARCHIVE_LEVELS},
                    "description": "Archive levels to include. Defaults to active only: [0].",
                },
                "include_deleted": {
                    "type": "boolean",
                    "description": "Whether to include soft-deleted nodes. Defaults to false.",
                },
                "search": {
                    "type": "string",
                    "description": "Optional case-insensitive text search over node names, notes, task AI_context, tags, references, and placements.",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 500,
                    "description": "Maximum nodes to return. Defaults to 100.",
                },
            },
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "nodes": {"type": "array", "items": {"type": "object"}},
                "count": {"type": "integer"},
                "total_matches": {"type": "integer"},
                "truncated": {"type": "boolean"},
            },
            "required": ["nodes", "count", "total_matches", "truncated"],
            "additionalProperties": False,
        },
    ),
    _read_only_tool(
        "get_node",
        "Get workspace node",
        "Read one Efficient Hypothesis workspace node by exact node type and ID.",
        {
            "type": "object",
            "properties": {
                "node_type": _node_type_schema(),
                "node_id": {"type": "string", "description": "Exact node ID."},
            },
            "required": ["node_type", "node_id"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {"node": {"type": "object"}},
            "required": ["node"],
            "additionalProperties": False,
        },
    ),
    _write_tool(
        "create_node",
        "Create workspace node",
        (
            "Create a structured node and insert it into the matching editor section. "
            "This cannot create or edit free-text lines."
        ),
        {
            "type": "object",
            "properties": {
                "node_type": _node_type_schema(),
                "name": {"type": "string", "description": "Node name."},
                "note": {"type": "string", "description": "Optional note."},
                "tag_name": {
                    "type": "string",
                    "description": "Optional tag name. Missing tags are auto-created with the default color.",
                },
                "document_key": _document_key_schema(
                    "Optional target editor document."
                ),
                "fields": _node_fields_schema(
                    (
                        "Type-specific fields. task: datetime, AI_context. subscription: rate. website: identity_names. "
                        "tag: color. location: address. identity: reference_name. asset: reference_location_name."
                    )
                ),
            },
            "required": ["node_type", "name"],
            "additionalProperties": False,
        },
        _node_output_schema(),
    ),
    _write_tool(
        "update_node",
        "Update workspace node",
        (
            "Update a structured node by exact ID. This cannot edit free-text lines or move document blocks. "
            "Use tag_name null to clear an item's tag."
        ),
        {
            "type": "object",
            "properties": {
                "node_type": _node_type_schema(),
                "node_id": {"type": "string", "description": "Exact node ID."},
                "fields": _node_fields_schema(
                    (
                        "Fields to update. Common: name, note, tag_name. Type-specific fields match create_node. "
                        "Task AI_context can be set to a string or null."
                    )
                ),
            },
            "required": ["node_type", "node_id", "fields"],
            "additionalProperties": False,
        },
        _node_output_schema(),
    ),
    _write_tool(
        "archive_node",
        "Archive workspace node",
        (
            "Move a node one archive level deeper: 0 to 1, or 1 to 2. "
            "This tool will not soft-delete nodes from level 2."
        ),
        {
            "type": "object",
            "properties": {
                "node_type": _node_type_schema(),
                "node_id": {"type": "string", "description": "Exact node ID."},
            },
            "required": ["node_type", "node_id"],
            "additionalProperties": False,
        },
        _node_output_schema(),
    ),
    _write_tool(
        "restore_node",
        "Restore workspace node",
        (
            "Move a node one archive level shallower: 2 to 1, or 1 to 0. "
            "This tool cannot restore soft-deleted nodes."
        ),
        {
            "type": "object",
            "properties": {
                "node_type": _node_type_schema(),
                "node_id": {"type": "string", "description": "Exact node ID."},
            },
            "required": ["node_type", "node_id"],
            "additionalProperties": False,
        },
        _node_output_schema(),
    ),
]


def _workspace_state_key(email):
    return f"{email}/workspace/state.json"


def _load_workspace(email, user_id):
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=_workspace_state_key(email))
        with obj["Body"] as body:
            state = json.loads(body.read().decode("utf-8"))
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"NoSuchKey", "404", "NotFound"}:
            return _create_default_workspace(user_id or email)
        raise ValueError("workspace_unavailable") from exc
    except BotoCoreError as exc:
        raise ValueError("workspace_unavailable") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("workspace_unavailable") from exc
    if isinstance(state, dict):
        if is_encrypted_workspace(state):
            grant = active_chatgpt_grant(email)
            if not grant:
                raise ValueError(
                    "This workspace still uses legacy encryption. "
                    "Open Efficient Hypothesis in a browser once to migrate it before using MCP tools."
                )
            decrypted = decrypt_workspace_envelope(state, grant["workspaceKeyB64"])
            normalized = _normalize_workspace(decrypted, user_id or email)
            _save_workspace(email, normalized, user_id)
            return normalized
        return _normalize_workspace(state, user_id or email)
    return _create_default_workspace(user_id or email)


def _save_workspace(email, state, user_id):
    now = _now_iso()
    state["updatedAt"] = now
    state["userId"] = user_id or state.get("userId") or email
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=_workspace_state_key(email),
        Body=json.dumps(state, indent=2),
        ContentType="application/json",
    )
    delete_chatgpt_grant(email)


def _normalize_workspace(state, user_id):
    state = deepcopy(state)
    now = _now_iso()
    state.setdefault("schemaVersion", 1)
    state.setdefault("userId", user_id)
    state.setdefault("createdAt", now)
    state.setdefault("updatedAt", now)
    nodes = state.setdefault("nodes", {})
    for collection in COLLECTIONS.values():
        nodes.setdefault(collection, {})
    nodes.pop("actions", None)
    documents = state.setdefault("documents", {})
    defaults = _default_documents(user_id)
    for key, document in defaults.items():
        documents.setdefault(key, document)
    _remove_retired_routine_data(state)
    _ensure_task_ai_contexts(state)
    return state


def _create_default_workspace(user_id):
    now = _now_iso()
    return {
        "schemaVersion": 1,
        "userId": user_id,
        "documents": _default_documents(user_id),
        "nodes": {collection: {} for collection in COLLECTIONS.values()},
        "createdAt": now,
        "updatedAt": now,
    }


def _remove_retired_routine_data(state):
    state.pop("routineAsset", None)
    state.pop("dailyTimetable", None)
    nodes = state.setdefault("nodes", {})
    nodes.pop("actions", None)

    documents = state.setdefault("documents", {})
    for key in list(documents.keys()):
        if key in RETIRED_DOCUMENT_KEYS:
            del documents[key]
            continue

        document = documents.get(key)
        if not isinstance(document, dict):
            continue
        blocks = document.get("blocks")
        if not isinstance(blocks, list):
            continue
        filtered_blocks = [
            block
            for block in blocks
            if not (
                isinstance(block, dict)
                and block.get("type") == "saved_node"
                and block.get("nodeType") == "action"
            )
        ]
        if len(filtered_blocks) != len(blocks):
            document["blocks"] = filtered_blocks
            _touch_document(document)


def _default_documents(user_id):
    return {
        "tasks": _make_document(user_id, "tasks", [_section("Tasks"), _empty()]),
        "websites_subscriptions": _make_document(
            user_id,
            "websites_subscriptions",
            [_section("Websites"), _empty(), _section("Subscriptions"), _empty()],
        ),
        "tags": _make_document(user_id, "tags", [_section("Tags"), _empty()]),
        "profile": _make_document(
            user_id,
            "profile",
            [_section("Locations"), _empty(), _section("Identities"), _empty(), _section("Assets"), _empty()],
        ),
    }


def _make_document(user_id, key, blocks):
    now = _now_iso()
    return {
        "id": _make_id("doc"),
        "userId": user_id,
        "key": key,
        "version": 1,
        "blocks": blocks,
        "createdAt": now,
        "updatedAt": now,
    }


def _section(label):
    return {"type": "section", "id": _make_id("sec"), "label": label, "frozen": True}


def _empty():
    return {"type": "empty", "id": _make_id("blk")}


def _saved_node_block(node_type, node_id):
    return {
        "type": "saved_node",
        "id": _make_id("blk"),
        "nodeType": node_type,
        "nodeId": node_id,
        "collapsedNote": True,
    }


def _collection_for(node_type):
    if node_type not in COLLECTIONS:
        raise ValueError(f"Unsupported node_type: {node_type}")
    return COLLECTIONS[node_type]


def _get_node(state, node_type, node_id):
    return state.get("nodes", {}).get(_collection_for(node_type), {}).get(node_id)


def _set_node(state, node_type, node):
    state["nodes"][_collection_for(node_type)][node["id"]] = node
    state["updatedAt"] = _now_iso()


def _require_nonempty(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    return value.strip()


def _clean_optional_string(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Expected a string or null")
    value = value.strip()
    return value or None


def _clean_task_ai_context(value, strict=True):
    if value is None:
        return None
    if not isinstance(value, str):
        if strict:
            raise ValueError("fields.AI_context must be a string or null")
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) > TASK_AI_CONTEXT_MAX_LENGTH:
        if strict:
            raise ValueError(
                f"fields.AI_context must be {TASK_AI_CONTEXT_MAX_LENGTH} characters or fewer"
            )
        return value[:TASK_AI_CONTEXT_MAX_LENGTH]
    return value


def _ensure_task_ai_contexts(state):
    tasks = state.get("nodes", {}).get("tasks", {})
    for task in tasks.values():
        task["AI_context"] = _clean_task_ai_context(task.get("AI_context"), strict=False)


def _task_ai_context_from_fields(fields, existing=None):
    for key in ["AI_context", "ai_context", "aiContext"]:
        if key in fields:
            return _clean_task_ai_context(fields.get(key), strict=True)
    return _clean_task_ai_context(existing.get("AI_context") if existing else None, strict=False)


def _normalize_tag_name(name):
    return name.strip().lower()


def _find_tag_by_normalized_name(state, normalized_name):
    for tag in state["nodes"]["tags"].values():
        if tag.get("normalizedName") == normalized_name:
            return tag
    return None


def _ensure_tag(state, user_id, tag_name):
    tag_name = _clean_optional_string(tag_name)
    if not tag_name:
        return None
    normalized = _normalize_tag_name(tag_name)
    existing = _find_tag_by_normalized_name(state, normalized)
    if existing:
        _ensure_saved_block(state, "tag", existing["id"], "tags", "Tags")
        return existing["id"]

    now = _now_iso()
    tag_id = _make_id("tag")
    tag = {
        "id": tag_id,
        "userId": user_id,
        "name": tag_name,
        "note": None,
        "color": DEFAULT_TAG_COLOR,
        "normalizedName": normalized,
        "archive": 0,
        "createdAt": now,
        "updatedAt": now,
        "deletedAt": None,
    }
    _set_node(state, "tag", tag)
    _ensure_saved_block(state, "tag", tag_id, "tags", "Tags")
    return tag_id


def _tag_name(state, tag_id):
    if not tag_id:
        return ""
    return state["nodes"]["tags"].get(tag_id, {}).get("name", "")


def _default_document_target(node_type, document_key=None):
    if document_key:
        if document_key not in DOCUMENT_KEYS:
            raise ValueError(f"Unsupported document_key: {document_key}")
        allowed = {
            "task": ("tasks", "Tasks"),
            "website": ("websites_subscriptions", "Websites"),
            "subscription": ("websites_subscriptions", "Subscriptions"),
            "tag": ("tags", "Tags"),
            "location": ("profile", "Locations"),
            "identity": ("profile", "Identities"),
            "asset": ("profile", "Assets"),
        }
        default_key, label = allowed.get(node_type, (None, None))
        if document_key == default_key:
            return document_key, label
        raise ValueError(f"{node_type} nodes cannot be inserted into {document_key}")

    defaults = {
        "task": ("tasks", "Tasks"),
        "website": ("websites_subscriptions", "Websites"),
        "subscription": ("websites_subscriptions", "Subscriptions"),
        "tag": ("tags", "Tags"),
        "location": ("profile", "Locations"),
        "identity": ("profile", "Identities"),
        "asset": ("profile", "Assets"),
    }
    return defaults[node_type]


def _ensure_saved_block(state, node_type, node_id, document_key=None, section_label=None):
    document_key, section_label = (
        (document_key, section_label) if document_key and section_label else _default_document_target(node_type, document_key)
    )
    document = state["documents"][document_key]
    if any(
        block.get("type") == "saved_node"
        and block.get("nodeType") == node_type
        and block.get("nodeId") == node_id
        for block in document.get("blocks", [])
    ):
        return

    blocks = document.setdefault("blocks", [])
    insert_at = len(blocks)
    section_index = next(
        (
            index
            for index, block in enumerate(blocks)
            if block.get("type") == "section" and block.get("label") == section_label
        ),
        -1,
    )
    if section_index >= 0:
        insert_at = len(blocks)
        for index in range(section_index + 1, len(blocks)):
            if blocks[index].get("type") == "section":
                insert_at = index
                break
        while insert_at > section_index + 1 and blocks[insert_at - 1].get("type") == "empty":
            insert_at -= 1

    blocks.insert(insert_at, _saved_node_block(node_type, node_id))
    if not blocks or blocks[-1].get("type") != "empty":
        blocks.append(_empty())
    _touch_document(document)


def _touch_document(document):
    document["version"] = int(document.get("version", 1)) + 1
    document["updatedAt"] = _now_iso()


def _placements_for_node(state, node_type, node_id):
    placements = []
    for key, document in state.get("documents", {}).items():
        for index, block in enumerate(document.get("blocks", [])):
            if (
                block.get("type") == "saved_node"
                and block.get("nodeType") == node_type
                and block.get("nodeId") == node_id
            ):
                placements.append({"document_key": key, "block_id": block.get("id"), "line": index + 1})
    return placements


def _get_user_timezone(user_id):
    try:
        item = user_table.get_item(Key={"user_id": user_id}).get("Item") or {}
        return ZoneInfo(item.get("timezone") or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _parse_time(raw):
    if not raw:
        return None
    match = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", raw.strip().lower())
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    suffix = match.group(3)
    if suffix == "pm" and hour < 12:
        hour += 12
    if suffix == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def _has_explicit_time(raw):
    if not raw or not str(raw).strip():
        return False
    value = str(raw).strip()
    relative = re.match(r"^(today|tomorrow)\s+(.+)$", value.lower())
    if relative:
        return _parse_time(relative.group(2)) is not None
    us_match = re.match(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?:\s*,?\s+(.+))?$", value)
    if us_match:
        return _parse_time(us_match.group(4)) is not None
    return bool(re.search(r"\b\d{1,2}:\d{2}\b", value) or re.search(r"\b\d{1,2}(?::\d{2})?\s*(am|pm)\b", value, re.I))


def _parse_task_datetime(raw, user_tz):
    if not raw or not str(raw).strip():
        return None
    value = str(raw).strip()
    lower = value.lower()
    now_local = datetime.datetime.now(datetime.timezone.utc).astimezone(user_tz)

    if lower in ("today", "tomorrow"):
        date = now_local.date()
        if lower == "tomorrow":
            date += datetime.timedelta(days=1)
        return datetime.datetime.combine(date, datetime.time(0, 0), user_tz).astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

    relative = re.match(r"^(today|tomorrow)\s+(.+)$", lower)
    if relative:
        parsed_time = _parse_time(relative.group(2))
        if not parsed_time:
            return None
        date = now_local.date()
        if relative.group(1) == "tomorrow":
            date += datetime.timedelta(days=1)
        hour, minute = parsed_time
        return datetime.datetime.combine(date, datetime.time(hour, minute), user_tz).astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

    match = re.match(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?:\s*,?\s+(.+))?$", value)
    if not match:
        return None
    month = int(match.group(1))
    day = int(match.group(2))
    year_raw = match.group(3)
    year = now_local.year if not year_raw else (2000 + int(year_raw) if len(year_raw) == 2 else int(year_raw))
    parsed_time = _parse_time(match.group(4))
    if match.group(4) and not parsed_time:
        return None
    hour, minute = parsed_time or (0, 0)
    try:
        local = datetime.datetime(year, month, day, hour, minute, tzinfo=user_tz)
    except ValueError:
        return None
    return local.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_color(value):
    if isinstance(value, str) and re.match(r"^#[0-9A-Fa-f]{6}$", value.strip()):
        return value.strip()
    return DEFAULT_TAG_COLOR


def _rate_from_fields(fields):
    rate = fields.get("rate")
    if rate is None:
        return None
    if not isinstance(rate, dict):
        raise ValueError("fields.rate must be an object or null")
    amount_raw = rate.get("amount")
    if "intervalCount" in rate:
        count_raw = rate.get("intervalCount")
    elif "interval_count" in rate:
        count_raw = rate.get("interval_count")
    else:
        count_raw = 1
    unit = _normalize_interval_unit(rate.get("intervalUnit") or rate.get("interval_unit"))
    if not unit:
        raise ValueError("rate intervalUnit must be day(s), week(s), month(s), or year(s)")
    try:
        amount = float(amount_raw)
        interval_count = int(count_raw)
    except (TypeError, ValueError):
        raise ValueError("rate amount must be numeric and intervalCount must be an integer")
    if amount < 0 or interval_count <= 0:
        raise ValueError("rate amount must be non-negative and intervalCount must be positive")
    return {
        "amount": amount,
        "currency": _normalize_currency(rate.get("currency") or "USD"),
        "intervalCount": interval_count,
        "intervalUnit": unit,
    }


def _normalize_currency(value):
    currency = str(value or "USD").strip()
    return currency.upper() if re.match(r"^[a-z]{3}$", currency, re.I) else currency


def _normalize_interval_unit(value):
    normalized = str(value or "").strip().lower()
    if normalized in ("day", "days"):
        return "days"
    if normalized in ("week", "weeks"):
        return "weeks"
    if normalized in ("month", "months"):
        return "months"
    if normalized in ("year", "years"):
        return "years"
    return None


def _find_node_by_name(state, node_type, name):
    if not name:
        return None
    normalized = name.strip().lower()
    for node in state["nodes"][_collection_for(node_type)].values():
        if node.get("name", "").strip().lower() == normalized:
            return node
    return None


def _base_node(state, user_id, node_type, node_id, name, existing=None):
    now = _now_iso()
    return {
        "id": node_id,
        "userId": user_id,
        "name": name,
        "archive": existing.get("archive", 0) if existing else 0,
        "createdAt": existing.get("createdAt", now) if existing else now,
        "updatedAt": now,
        "deletedAt": existing.get("deletedAt") if existing else None,
    }


def _node_to_raw_macro(state, node_type, node):
    tag = _tag_name(state, node.get("tagId")) if "tagId" in node else ""
    note = f"\n{_escape_macro(node.get('note'))}" if node.get("note") else ""
    if node_type == "task":
        return f"<{_escape_macro(node.get('name'))}; {_escape_macro(node.get('datetimeRaw') or node.get('datetimeUtc') or '')}; {_escape_macro(tag)}{note}>"
    if node_type == "subscription":
        return f"<{_escape_macro(node.get('name'))}; {_escape_macro(_format_rate(node.get('rate')))}; {_escape_macro(tag)}{note}>"
    if node_type == "website":
        identities = [
            *(state["nodes"]["identities"].get(item_id, {}).get("name", item_id) for item_id in node.get("identityIds", [])),
            *node.get("unresolvedIdentities", []),
        ]
        return f"<{_escape_macro(node.get('name'))}; {_escape_macro(', '.join(identities))}; {_escape_macro(tag)}{note}>"
    if node_type == "tag":
        return f"<{_escape_macro(node.get('name'))}; {_escape_macro(node.get('color'))}{note}>"
    if node_type == "location":
        return f"<{_escape_macro(node.get('name'))}; {_escape_macro(node.get('address') or '')}>"
    if node_type == "identity":
        reference = node.get("unresolvedReference") or ""
        if node.get("referenceWebsiteId"):
            reference = state["nodes"]["websites"].get(node["referenceWebsiteId"], {}).get("name", reference)
        if node.get("referenceAssetId"):
            reference = state["nodes"]["assets"].get(node["referenceAssetId"], {}).get("name", reference)
        return f"<{_escape_macro(node.get('name'))}; {_escape_macro(reference)}; {_escape_macro(tag)}>"
    reference = node.get("unresolvedReference") or ""
    if node.get("referenceLocationId"):
        reference = state["nodes"]["locations"].get(node["referenceLocationId"], {}).get("name", reference)
    return f"<{_escape_macro(node.get('name'))}; {_escape_macro(reference)}; {_escape_macro(tag)}>"


def _escape_macro(value):
    return re.sub(r"([<>;,\\])", r"\\\1", str(value or ""))


def _format_rate(rate):
    if not rate:
        return ""
    return f"{rate.get('amount')}, {rate.get('currency')}, {rate.get('intervalCount')}, {rate.get('intervalUnit')}"


def _create_node(email, user_id, arguments):
    state = _load_workspace(email, user_id)
    node_type = _require_nonempty(arguments.get("node_type"), "node_type")
    _collection_for(node_type)
    name = _require_nonempty(arguments.get("name"), "name")
    raw_fields = arguments.get("fields") or {}
    if not isinstance(raw_fields, dict):
        raise ValueError("fields must be an object")
    fields = dict(raw_fields)
    if "tag_name" in arguments and "tag_name" not in fields and "tagName" not in fields:
        fields["tag_name"] = arguments.get("tag_name")
    note = arguments["note"] if "note" in arguments else (fields["note"] if "note" in fields else MISSING)

    if node_type == "tag":
        normalized = _normalize_tag_name(name)
        existing = _find_tag_by_normalized_name(state, normalized)
        node_id = existing["id"] if existing else _make_id("tag")
        node = {
            **_base_node(state, user_id, node_type, node_id, name, existing),
            "note": _clean_optional_string(note) if note is not MISSING else (existing.get("note") if existing else None),
            "color": _normalize_color(fields.get("color")),
            "normalizedName": normalized,
        }
        created = existing is None
    else:
        node_id = _make_id(node_type)
        node = _build_node_from_fields(state, user_id, node_type, node_id, name, note, fields)
        created = True

    node["rawMacro"] = _node_to_raw_macro(state, node_type, node)
    _set_node(state, node_type, node)
    document_key, section_label = _default_document_target(node_type, arguments.get("document_key"))
    _ensure_saved_block(state, node_type, node["id"], document_key, section_label)
    _save_workspace(email, state, user_id)
    return _mutation_result("created" if created else "updated", _augment_node(state, node_type, node), created)


def _build_node_from_fields(state, user_id, node_type, node_id, name, note, fields, existing=None):
    base = _base_node(state, user_id, node_type, node_id, name, existing)
    tag_id = existing.get("tagId") if existing else None
    if node_type in TAGGABLE_NODE_TYPES:
        if "tag_name" in fields or "tagName" in fields:
            tag_name = fields.get("tag_name") if "tag_name" in fields else fields.get("tagName")
            tag_id = _ensure_tag(state, user_id, tag_name)

    explicit_note = (
        _clean_optional_string(note)
        if note is not MISSING
        else (existing.get("note") if existing and "note" in existing else None)
    )

    if node_type == "task":
        datetime_raw = fields.get("datetime")
        if datetime_raw is None:
            datetime_raw = fields.get("datetime_raw")
        if datetime_raw is None:
            datetime_raw = fields.get("datetimeRaw", existing.get("datetimeRaw") if existing else None)
        datetime_raw = _clean_optional_string(datetime_raw)
        ai_context = _task_ai_context_from_fields(fields, existing)
        return {
            **base,
            "note": explicit_note,
            "AI_context": ai_context,
            "datetimeUtc": _parse_task_datetime(datetime_raw, _get_user_timezone(user_id)),
            "datetimeRaw": datetime_raw,
            "datetimeHasTime": _has_explicit_time(datetime_raw),
            "tagId": tag_id,
        }
    if node_type == "subscription":
        rate = _rate_from_fields(fields) if "rate" in fields else (existing.get("rate") if existing else None)
        return {**base, "note": explicit_note, "rate": rate, "tagId": tag_id}
    if node_type == "website":
        identity_names = fields.get("identity_names", fields.get("identities", [] if not existing else None))
        if identity_names is None:
            identity_ids = existing.get("identityIds", [])
            unresolved = existing.get("unresolvedIdentities", [])
        else:
            if not isinstance(identity_names, list):
                raise ValueError("fields.identity_names must be an array of strings")
            identity_ids, unresolved = _resolve_identity_names(state, identity_names)
        return {**base, "note": explicit_note, "identityIds": identity_ids, "unresolvedIdentities": unresolved, "tagId": tag_id}
    if node_type == "location":
        address = fields.get("address", existing.get("address") if existing else None)
        return {**base, "address": _clean_optional_string(address)}
    if node_type == "identity":
        reference = fields.get("reference_name", fields.get("reference", existing.get("unresolvedReference") if existing else None))
        website = _find_node_by_name(state, "website", reference)
        asset = _find_node_by_name(state, "asset", reference)
        return {
            **base,
            "referenceWebsiteId": website.get("id") if website else None,
            "referenceAssetId": asset.get("id") if asset and not website else None,
            "unresolvedReference": None if website or asset else _clean_optional_string(reference),
            "tagId": tag_id,
        }
    if node_type == "asset":
        reference = fields.get("reference_location_name", fields.get("reference", existing.get("unresolvedReference") if existing else None))
        location = _find_node_by_name(state, "location", reference)
        return {
            **base,
            "referenceLocationId": location.get("id") if location else None,
            "unresolvedReference": None if location else _clean_optional_string(reference),
            "tagId": tag_id,
        }
    raise ValueError(f"Unsupported node_type: {node_type}")


def _resolve_identity_names(state, names):
    identity_ids = []
    unresolved = []
    for name in names:
        if not isinstance(name, str) or not name.strip():
            continue
        identity = _find_node_by_name(state, "identity", name)
        if identity:
            identity_ids.append(identity["id"])
        else:
            unresolved.append(name.strip())
    return identity_ids, unresolved


def _update_node(email, user_id, arguments):
    state = _load_workspace(email, user_id)
    node_type = _require_nonempty(arguments.get("node_type"), "node_type")
    node_id = _require_nonempty(arguments.get("node_id"), "node_id")
    existing = _get_node(state, node_type, node_id)
    if not existing:
        raise ValueError("Node not found")
    if existing.get("deletedAt"):
        raise ValueError("Soft-deleted nodes cannot be updated")
    fields = arguments.get("fields")
    if not isinstance(fields, dict) or not fields:
        raise ValueError("fields must be a non-empty object")

    next_name = _require_nonempty(fields.get("name"), "fields.name") if "name" in fields else existing.get("name")
    note = fields["note"] if "note" in fields else MISSING

    if node_type == "tag":
        normalized = _normalize_tag_name(next_name)
        duplicate = _find_tag_by_normalized_name(state, normalized)
        if duplicate and duplicate["id"] != node_id:
            raise ValueError("Another tag already uses that normalized name")
        node = {
            **_base_node(state, user_id, node_type, node_id, next_name, existing),
            "note": _clean_optional_string(note) if note is not MISSING else existing.get("note"),
            "color": _normalize_color(fields.get("color", existing.get("color"))),
            "normalizedName": normalized,
        }
    else:
        node = _build_node_from_fields(state, user_id, node_type, node_id, next_name, note, fields, existing)

    node["rawMacro"] = _node_to_raw_macro(state, node_type, node)
    _set_node(state, node_type, node)
    _save_workspace(email, state, user_id)
    return _mutation_result("updated", _augment_node(state, node_type, node), False)


def _archive_node(email, user_id, arguments):
    return _move_archive(email, user_id, arguments, 1, "archived")


def _restore_node(email, user_id, arguments):
    return _move_archive(email, user_id, arguments, -1, "restored")


def _move_archive(email, user_id, arguments, direction, action):
    state = _load_workspace(email, user_id)
    node_type = _require_nonempty(arguments.get("node_type"), "node_type")
    node_id = _require_nonempty(arguments.get("node_id"), "node_id")
    node = _get_node(state, node_type, node_id)
    if not node:
        raise ValueError("Node not found")
    if node.get("deletedAt"):
        raise ValueError("Soft-deleted nodes cannot be archived or restored by MCP")
    archive = int(node.get("archive", 0))
    if direction > 0 and archive >= 2:
        raise ValueError("Node is already at archive level 2; MCP will not soft-delete it")
    if direction < 0 and archive <= 0:
        raise ValueError("Node is already active")
    node["archive"] = archive + direction
    node["updatedAt"] = _now_iso()
    _set_node(state, node_type, node)
    _save_workspace(email, state, user_id)
    return _mutation_result(action, _augment_node(state, node_type, node), False)


def _augment_node(state, node_type, node):
    augmented = deepcopy(node)
    augmented["node_type"] = node_type
    augmented["id"] = node.get("id")
    augmented["placements"] = _placements_for_node(state, node_type, node.get("id"))
    if node.get("tagId"):
        tag = state["nodes"]["tags"].get(node["tagId"], {})
        augmented["tagName"] = tag.get("name")
        augmented["tagColor"] = tag.get("color")
        augmented["tagArchive"] = tag.get("archive")
    return augmented


def _all_augmented_nodes(state):
    nodes = []
    for node_type, collection in COLLECTIONS.items():
        nodes.extend(_augment_node(state, node_type, node) for node in state["nodes"][collection].values())
    return nodes


def _query_nodes(email, user_id, arguments):
    state = _load_workspace(email, user_id)
    node_types = arguments.get("node_types") or NODE_TYPES
    archive_levels = arguments.get("archive_levels")
    if archive_levels is None:
        archive_levels = [0]
    include_deleted = bool(arguments.get("include_deleted", False))
    search = (arguments.get("search") or "").strip().lower()
    limit = _limit(arguments)

    requested = set(node_types)
    matched = []
    for node in _all_augmented_nodes(state):
        if node["node_type"] not in requested:
            continue
        if int(node.get("archive", 0)) not in archive_levels:
            continue
        if node.get("deletedAt") and not include_deleted:
            continue
        if search and search not in json.dumps(node, sort_keys=True).lower():
            continue
        matched.append(node)

    matched.sort(key=lambda item: (item.get("archive", 0), item.get("node_type", ""), item.get("name", "").lower()))
    total = len(matched)
    projected = matched[:limit]
    return {
        "structuredContent": {
            "nodes": projected,
            "count": len(projected),
            "total_matches": total,
            "truncated": total > len(projected),
        },
        "content": [{"type": "text", "text": f"Returned {len(projected)} of {total} workspace nodes."}],
    }


def _get_node_result(email, user_id, arguments):
    state = _load_workspace(email, user_id)
    node_type = _require_nonempty(arguments.get("node_type"), "node_type")
    node_id = _require_nonempty(arguments.get("node_id"), "node_id")
    node = _get_node(state, node_type, node_id)
    if not node:
        raise ValueError("Node not found")
    augmented = _augment_node(state, node_type, node)
    return {
        "structuredContent": {"node": augmented},
        "content": [{"type": "text", "text": f"Loaded {node_type}: {node.get('name') or node_id}."}],
    }


def _get_daily_context_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    date = _require_nonempty(arguments.get("date"), "date")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    context = _read_daily_context(email, project_id, user_id, date)
    return {
        "structuredContent": {"dailyContext": context},
        "content": [{"type": "text", "text": f"Loaded {project_id} context for {date}."}],
    }


def _upsert_daily_context_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    date = _require_nonempty(arguments.get("date"), "date")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    context = _normalize_daily_context(
        {"entries": arguments.get("entries")}, project_id, user_id, date
    )
    _write_daily_context(email, project_id, context)
    return {
        "structuredContent": {"dailyContext": context},
        "content": [{"type": "text", "text": f"Updated {project_id} context for {date}."}],
    }


def _add_daily_context_image_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    entry = _store_daily_context_image(email, project_id, user_id, arguments.get("date"), arguments.get("image_data"), arguments.get("summary"), arguments.get("time"), arguments.get("filename"))
    return {"structuredContent": {"entry": entry}, "content": [{"type": "text", "text": f"Added image context to {project_id} on {arguments.get('date')}."}]}


def _get_recommendations_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    date = _require_nonempty(arguments.get("date"), "date")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    recommendations = _read_recommendations(email, project_id, user_id, date)
    return {"structuredContent": {"recommendations": recommendations}, "content": [{"type": "text", "text": f"Loaded recommendations for {project_id} on {date}."}]}


def _get_recommendation_context_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    date = _require_nonempty(arguments.get("date"), "date")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    context = _read_recommendation_context(email, project_id, user_id, date)
    return {"structuredContent": {"context": context}, "content": [{"type": "text", "text": f"Loaded recommendation context for {project_id} on {date}."}]}


def _upsert_recommendations_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    date = _require_nonempty(arguments.get("date"), "date")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    recommendations = _normalize_recommendations({"recommendations": arguments.get("recommendations")}, project_id, user_id, date, strict=True)
    recommendations = _write_recommendations(email, project_id, recommendations)
    return {"structuredContent": {"recommendations": recommendations}, "content": [{"type": "text", "text": f"Updated recommendations for {project_id} on {date}."}]}


def _list_daily_context_metadata_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    items = _query_daily_context_metadata(email, user_id, project_id, arguments.get("date_from"), arguments.get("date_to"))
    return {"structuredContent": {"items": items}, "content": [{"type": "text", "text": f"Loaded {len(items)} daily context metadata rows for {project_id}."}]}


def _list_research_metadata_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    items = _query_research_metadata(email, user_id, project_id, bool(arguments.get("include_inactive")))
    return {"structuredContent": {"items": items}, "content": [{"type": "text", "text": f"Loaded {len(items)} research metadata rows for {project_id}."}]}


def _get_research_item_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    research_id = _require_nonempty(arguments.get("research_id"), "research_id")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    item = _read_research_item(email, project_id, user_id, research_id)
    return {"structuredContent": {"researchItem": item}, "content": [{"type": "text", "text": f"Loaded research item {research_id}."}]}


def _upsert_research_item_result(email, user_id, arguments):
    project_id = _require_nonempty(arguments.get("project_id"), "project_id")
    if project_id not in PROJECT_BY_ID:
        raise ValueError("unknown project")
    item = _write_research_item(email, project_id, user_id, arguments.get("research_item"))
    return {"structuredContent": {"researchItem": item}, "content": [{"type": "text", "text": f"Stored research item {item['id']}."}]}


def _mutation_result(action, node, created):
    return {
        "structuredContent": {"ok": True, "node": node, "created": bool(created)},
        "content": [{"type": "text", "text": f"{action.capitalize()} {node.get('node_type')}: {node.get('name') or node.get('id')}."}],
    }


def _limit(arguments):
    try:
        value = int((arguments or {}).get("limit", 100))
    except (TypeError, ValueError):
        value = 100
    return max(1, min(value, 500))


def _call_tool(name, arguments, ctx):
    arguments = arguments or {}
    email = ctx["email"]
    user_id = ctx.get("user_id") or email

    if name == "get_daily_context":
        return _get_daily_context_result(email, user_id, arguments)
    if name == "upsert_daily_context":
        return _upsert_daily_context_result(email, user_id, arguments)
    if name == "add_daily_context_image":
        return _add_daily_context_image_result(email, user_id, arguments)
    if name == "get_project_recommendations":
        return _get_recommendations_result(email, user_id, arguments)
    if name == "get_recommendation_context":
        return _get_recommendation_context_result(email, user_id, arguments)
    if name == "upsert_project_recommendations":
        return _upsert_recommendations_result(email, user_id, arguments)
    if name == "list_daily_context_metadata":
        return _list_daily_context_metadata_result(email, user_id, arguments)
    if name == "list_project_research":
        return _list_research_metadata_result(email, user_id, arguments)
    if name == "get_project_research_item":
        return _get_research_item_result(email, user_id, arguments)
    if name == "upsert_project_research_item":
        return _upsert_research_item_result(email, user_id, arguments)
    if name == "query_nodes":
        return _query_nodes(email, user_id, arguments)
    if name == "get_node":
        return _get_node_result(email, user_id, arguments)
    if name == "create_node":
        return _create_node(email, user_id, arguments)
    if name == "update_node":
        return _update_node(email, user_id, arguments)
    if name == "archive_node":
        return _archive_node(email, user_id, arguments)
    if name == "restore_node":
        return _restore_node(email, user_id, arguments)
    raise KeyError(name)


@mcp_bp.route("/mcp", methods=["GET"])
@mcp_bp.route("/mcp-v2", methods=["GET"])
@mcp_bp.route("/mcp-v3", methods=["GET"])
@mcp_bp.route("/mcp-v4", methods=["GET"])
@mcp_bp.route("/mcp-v5", methods=["GET"])
def mcp_info():
    return jsonify(
        {
            "name": "Efficient Hypothesis",
            "description": "Workspace-native MCP endpoint for Efficient Hypothesis structured nodes.",
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "tools": [tool["name"] for tool in TOOLS],
        }
    )


@mcp_bp.route("/mcp", methods=["POST"])
@mcp_bp.route("/mcp-v2", methods=["POST"])
@mcp_bp.route("/mcp-v3", methods=["POST"])
@mcp_bp.route("/mcp-v4", methods=["POST"])
@mcp_bp.route("/mcp-v5", methods=["POST"])
def mcp_rpc():
    payload = request.get_json(silent=True) or {}
    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params") or {}

    if method == "initialize":
        return _rpc_result(
            request_id,
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "efficient-hypothesis", "version": "0.4.0"},
            },
        )

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
        except (TypeError, ValueError) as exc:
            return _rpc_error(request_id, -32602, str(exc))

    return _rpc_error(request_id, -32601, f"Method not found: {method}")
