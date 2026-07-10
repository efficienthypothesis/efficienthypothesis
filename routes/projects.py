import datetime
import json
import re
from copy import deepcopy

from flask import Blueprint, jsonify, request
from botocore.exceptions import BotoCoreError, ClientError

from config import PRODUCTIVITY_BUCKET, s3, _require_auth

projects_bp = Blueprint("projects", __name__)

PROJECTS = [
    {"id": "acne", "name": "Acne"},
    {"id": "fitness", "name": "Fitness"},
    {"id": "flexibility", "name": "Flexibility"},
]
PROJECT_BY_ID = {project["id"]: project for project in PROJECTS}
GLOBAL_CONTEXT_VERSION = 1
DAILY_CONTEXT_VERSION = 1
DAILY_CONTEXT_MAX_ENTRIES = 100
DAILY_DATE_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _project_global_context_key(email, project_id):
    return f"{email}/projects/{project_id}/global-context.json"


def _project_daily_context_key(email, project_id, date):
    return f"{email}/projects/{project_id}/daily-context/{date}.json"


def _default_global_context(project_id, user_id):
    project = PROJECT_BY_ID[project_id]
    now = _now_iso()
    return {
        "schemaVersion": GLOBAL_CONTEXT_VERSION,
        "projectId": project_id,
        "projectName": project["name"],
        "userId": user_id,
        "summary": "",
        "facts": [],
        "preferences": [],
        "constraints": [],
        "openQuestions": [],
        "createdAt": now,
        "updatedAt": now,
    }


def _normalize_string_list(value):
    if not isinstance(value, list):
        return []
    normalized = []
    for item in value:
        if isinstance(item, str) and item.strip():
            normalized.append(item.strip())
    return normalized


def _normalize_global_context(value, project_id, user_id):
    default_context = _default_global_context(project_id, user_id)
    if not isinstance(value, dict):
        return default_context

    context = deepcopy(default_context)
    context["createdAt"] = value.get("createdAt") or context["createdAt"]
    context["updatedAt"] = value.get("updatedAt") or context["updatedAt"]
    context["summary"] = value.get("summary") if isinstance(value.get("summary"), str) else ""
    context["facts"] = _normalize_string_list(value.get("facts"))
    context["preferences"] = _normalize_string_list(value.get("preferences"))
    context["constraints"] = _normalize_string_list(value.get("constraints"))
    context["openQuestions"] = _normalize_string_list(value.get("openQuestions"))
    return context


def _read_project_global_context(email, project_id, user_id):
    key = _project_global_context_key(email, project_id)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        with obj["Body"] as body:
            raw_context = json.loads(body.read().decode("utf-8"))
    except s3.exceptions.NoSuchKey:
        context = _default_global_context(project_id, user_id)
        _write_project_global_context(email, project_id, context)
        return context

    context = _normalize_global_context(raw_context, project_id, user_id)
    if context != raw_context:
        _write_project_global_context(email, project_id, context)
    return context


def _write_project_global_context(email, project_id, context):
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=_project_global_context_key(email, project_id),
        Body=json.dumps(context, indent=2),
        ContentType="application/json",
    )


def _default_daily_context(project_id, user_id, date):
    return {
        "schemaVersion": DAILY_CONTEXT_VERSION,
        "userId": user_id,
        "projectId": project_id,
        "date": date,
        "entries": [],
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }


def _validate_daily_date(date):
    if not isinstance(date, str) or not DAILY_DATE_PATTERN.fullmatch(date):
        raise ValueError("date must use YYYY-MM-DD")
    try:
        return datetime.date.fromisoformat(date).isoformat()
    except ValueError as exc:
        raise ValueError("date must use YYYY-MM-DD") from exc


def _normalize_daily_context(value, project_id, user_id, date):
    date = _validate_daily_date(date)
    default = _default_daily_context(project_id, user_id, date)
    if not isinstance(value, dict):
        return default
    entries = value.get("entries")
    if not isinstance(entries, list) or len(entries) > DAILY_CONTEXT_MAX_ENTRIES:
        raise ValueError("entries must be an array with at most 100 items")
    normalized_entries = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"entries[{index}] must be an object")
        entry_id = entry.get("id")
        summary = entry.get("summary")
        if not isinstance(entry_id, str) or not entry_id.strip() or len(entry_id) > 80:
            raise ValueError(f"entries[{index}].id is invalid")
        if not isinstance(summary, str) or not summary.strip() or len(summary) > 2000:
            raise ValueError(f"entries[{index}].summary is invalid")
        normalized_entries.append({
            "id": entry_id.strip(),
            "time": entry.get("time") if isinstance(entry.get("time"), str) else None,
            "summary": summary.strip(),
            "createdAt": entry.get("createdAt") or default["createdAt"],
            "updatedAt": entry.get("updatedAt") or default["updatedAt"],
        })
    result = {**default, "entries": normalized_entries}
    result["createdAt"] = value.get("createdAt") or result["createdAt"]
    result["updatedAt"] = value.get("updatedAt") or result["updatedAt"]
    return result


def _read_daily_context(email, project_id, user_id, date):
    date = _validate_daily_date(date)
    key = _project_daily_context_key(email, project_id, date)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        with obj["Body"] as body:
            raw = json.loads(body.read().decode("utf-8"))
        return _normalize_daily_context(raw, project_id, user_id, date)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"NoSuchKey", "404", "NotFound"}:
            return _default_daily_context(project_id, user_id, date)
        raise
    except (BotoCoreError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("daily context unavailable") from exc


def _write_daily_context(email, project_id, context):
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=_project_daily_context_key(email, project_id, context["date"]),
        Body=json.dumps(context, indent=2),
        ContentType="application/json",
    )


def _project_calendar_days_for_user(email, user_id, timezone):
    today = datetime.datetime.now(timezone).date()
    days = []
    for offset in range(-3, 4):
        day = today + datetime.timedelta(days=offset)
        date = day.isoformat()
        projects = []
        for project in PROJECTS:
            context = _read_daily_context(email, project["id"], user_id, date)
            projects.append({
                "id": project["id"],
                "name": project["name"],
                "entry_count": len(context["entries"]),
                "raw_json": json.dumps(context, indent=2),
            })
        days.append({
            "weekday": day.strftime("%A"),
            "date": f"{day.day}/{day.month}",
            "iso_date": date,
            "is_today": offset == 0,
            "projects": projects,
        })
    return days


@projects_bp.route("/api/projects/global-contexts", methods=["GET"])
def api_project_global_contexts():
    ctx, err = _require_auth()
    if err:
        return err

    email = ctx["email"]
    user_id = ctx.get("user_id") or email
    projects = []
    for project in PROJECTS:
        context = _read_project_global_context(email, project["id"], user_id)
        projects.append({
            "id": project["id"],
            "name": project["name"],
            "globalContext": context,
        })
    return jsonify({"projects": projects})


@projects_bp.route("/api/projects/<project_id>/global-context", methods=["GET", "PUT"])
def api_project_global_context(project_id):
    ctx, err = _require_auth()
    if err:
        return err
    if project_id not in PROJECT_BY_ID:
        return jsonify({"error": "unknown project"}), 404

    email = ctx["email"]
    user_id = ctx.get("user_id") or email
    if request.method == "GET":
        return jsonify({
            "globalContext": _read_project_global_context(email, project_id, user_id)
        })

    data = request.get_json(silent=True) or {}
    context = _normalize_global_context(data.get("globalContext", data), project_id, user_id)
    existing = _read_project_global_context(email, project_id, user_id)
    context["createdAt"] = existing.get("createdAt") or context["createdAt"]
    context["updatedAt"] = _now_iso()
    _write_project_global_context(email, project_id, context)
    return jsonify({"ok": True, "globalContext": context})


@projects_bp.route("/api/projects/<project_id>/daily-context/<date>", methods=["GET", "PUT"])
def api_project_daily_context(project_id, date):
    ctx, err = _require_auth()
    if err:
        return err
    if project_id not in PROJECT_BY_ID:
        return jsonify({"error": "unknown project"}), 404
    try:
        date = _validate_daily_date(date)
        email = ctx["email"]
        user_id = ctx.get("user_id") or email
        if request.method == "GET":
            return jsonify({"dailyContext": _read_daily_context(email, project_id, user_id, date)})
        data = request.get_json(silent=True) or {}
        context = _normalize_daily_context(data.get("dailyContext", data), project_id, user_id, date)
        context["updatedAt"] = _now_iso()
        _write_daily_context(email, project_id, context)
        return jsonify({"ok": True, "dailyContext": context})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except (ClientError, BotoCoreError, RuntimeError):
        return jsonify({"error": "daily_context_unavailable"}), 503
