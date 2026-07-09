import datetime
import json
import re


ADMIN_EMAILS = frozenset({"neerkuchlous@gmail.com"})
ADMIN_TASKS_KEY = "admin/tasks.json"
MAX_TASK_PAYLOAD_BYTES = 256 * 1024
MAX_TASKS = 200

SECTION_DEFINITIONS = (
    {
        "heading": "Working On",
        "key": "working_on",
        "description": "Work with an active owner and an in-progress status.",
    },
    {
        "heading": "To Do",
        "key": "to_do",
        "description": "Planned fixes, product work, and decisions that still need action.",
    },
    {
        "heading": "Things To Tell Neer",
        "key": "tell_neer",
        "description": "Risks, decisions, and context that should not get buried in an agent transcript.",
    },
    {
        "heading": "Done",
        "key": "done",
        "description": "Recently completed work that remains useful context.",
    },
)

VALID_STATUSES = frozenset({
    "in_progress",
    "planned",
    "blocked",
    "needs_decision",
    "needs_attention",
    "info",
    "done",
})
VALID_PRIORITIES = frozenset({"critical", "high", "medium", "low", "info"})
REQUIRED_TASK_FIELDS = frozenset({
    "id",
    "section",
    "title",
    "summary",
    "status",
    "priority",
    "owner",
    "updatedOn",
    "source",
})
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
STRING_LIMITS = {
    "id": 80,
    "title": 200,
    "summary": 1_000,
    "owner": 120,
    "source": 120,
    "actionRequired": 500,
}


class TaskListFormatError(ValueError):
    pass


def is_admin_user(user):
    if not isinstance(user, dict):
        return False
    email = user.get("email")
    if not isinstance(email, str):
        return False
    return email.strip().casefold() in ADMIN_EMAILS


def load_task_board(s3_client, bucket, key=ADMIN_TASKS_KEY):
    response = s3_client.get_object(Bucket=bucket, Key=key)
    content_length = response.get("ContentLength")
    if isinstance(content_length, int) and content_length > MAX_TASK_PAYLOAD_BYTES:
        response["Body"].close()
        raise TaskListFormatError("Admin task payload is too large.")

    with response["Body"] as body:
        raw_payload = body.read(MAX_TASK_PAYLOAD_BYTES + 1)
    if len(raw_payload) > MAX_TASK_PAYLOAD_BYTES:
        raise TaskListFormatError("Admin task payload is too large.")

    try:
        payload = json.loads(raw_payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TaskListFormatError("Admin task payload must be valid UTF-8 JSON.") from exc
    return parse_task_board(payload)


def parse_task_board(payload):
    if not isinstance(payload, dict):
        raise TaskListFormatError("Admin task payload must be an object.")
    if payload.get("schemaVersion") != 1:
        raise TaskListFormatError("Admin task payload must use schemaVersion 1.")

    last_updated = _parse_date(payload.get("updatedOn"), "updatedOn")
    raw_tasks = payload.get("tasks")
    if not isinstance(raw_tasks, list):
        raise TaskListFormatError("Admin task payload must contain a tasks array.")
    if len(raw_tasks) > MAX_TASKS:
        raise TaskListFormatError(f"Admin task payload cannot exceed {MAX_TASKS} tasks.")

    section_keys = {definition["key"] for definition in SECTION_DEFINITIONS}
    items_by_section = {key: [] for key in section_keys}
    seen_ids = set()

    for index, raw_task in enumerate(raw_tasks):
        task = _parse_task(raw_task, index, section_keys, seen_ids)
        items_by_section[task["section"]].append(task)

    sections = []
    for definition in SECTION_DEFINITIONS:
        section_items = items_by_section[definition["key"]]
        sections.append({
            **definition,
            "items": section_items,
            "count": len(section_items),
        })

    return {
        "last_updated": last_updated,
        "sections": sections,
        "counts": {
            definition["key"]: len(items_by_section[definition["key"]])
            for definition in SECTION_DEFINITIONS
        },
    }


def _parse_task(raw_task, index, section_keys, seen_ids):
    location = f"tasks[{index}]"
    if not isinstance(raw_task, dict):
        raise TaskListFormatError(f"{location} must be an object.")

    missing_fields = REQUIRED_TASK_FIELDS - raw_task.keys()
    if missing_fields:
        raise TaskListFormatError(
            f"{location} is missing fields: {', '.join(sorted(missing_fields))}."
        )

    for field, limit in STRING_LIMITS.items():
        if field == "actionRequired" and field not in raw_task:
            continue
        _require_bounded_string(raw_task.get(field), location, field, limit)

    task_id = raw_task["id"]
    if not SLUG_PATTERN.fullmatch(task_id):
        raise TaskListFormatError(f"{location}.id must be a lowercase slug.")
    if task_id in seen_ids:
        raise TaskListFormatError(f"Duplicate task ID {task_id!r}.")
    seen_ids.add(task_id)

    section = raw_task["section"]
    if not isinstance(section, str) or section not in section_keys:
        raise TaskListFormatError(f"{location}.section is invalid.")
    status = raw_task["status"]
    if not isinstance(status, str) or status not in VALID_STATUSES:
        raise TaskListFormatError(f"{location}.status is invalid.")
    priority = raw_task["priority"]
    if not isinstance(priority, str) or priority not in VALID_PRIORITIES:
        raise TaskListFormatError(f"{location}.priority is invalid.")

    if section == "working_on" and status != "in_progress":
        raise TaskListFormatError(f"{location} in Working On must use status in_progress.")
    if section == "done" and status != "done":
        raise TaskListFormatError(f"{location} in Done must use status done.")
    if section != "done" and status == "done":
        raise TaskListFormatError(f"{location} outside Done cannot use status done.")

    return {
        "id": task_id,
        "section": section,
        "title": raw_task["title"],
        "notes": raw_task["summary"],
        "status": status,
        "status_label": status.replace("_", " ").title(),
        "priority": priority,
        "priority_label": priority.title(),
        "owner": raw_task["owner"],
        "updated_on": _parse_date(raw_task["updatedOn"], f"{location}.updatedOn"),
        "source": raw_task["source"],
        "action_required": raw_task.get("actionRequired"),
        "completed": section == "done",
    }


def _require_bounded_string(value, location, field, limit):
    if not isinstance(value, str) or not value.strip():
        raise TaskListFormatError(f"{location}.{field} must be a non-empty string.")
    if len(value) > limit:
        raise TaskListFormatError(f"{location}.{field} cannot exceed {limit} characters.")


def _parse_date(value, location):
    if not isinstance(value, str):
        raise TaskListFormatError(f"{location} must use YYYY-MM-DD.")
    try:
        return datetime.date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise TaskListFormatError(f"{location} must use YYYY-MM-DD.") from exc
