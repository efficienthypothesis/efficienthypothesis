import base64
import datetime
import binascii
import io
import json
import re
import uuid
from copy import deepcopy

from boto3.dynamodb.conditions import Key
from flask import Blueprint, jsonify, redirect, render_template, request, send_file, session, url_for
from botocore.exceptions import BotoCoreError, ClientError

from config import PRODUCTIVITY_BUCKET, project_daily_context_metadata_table, project_research_metadata_table, s3, _require_auth

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
DAILY_CONTEXT_MAX_IMAGE_BYTES = 5 * 1024 * 1024
RECOMMENDATION_VERSION = 1
RECOMMENDATION_MAX_ITEMS = 50
RECOMMENDATION_MAX_STEPS = 100
RECOMMENDATION_KINDS = {"routine"}
RESEARCH_VERSION = 1
RESEARCH_MAX_ITEMS = 200
RESEARCH_MAX_STATEMENTS = 50
RESEARCH_MAX_TAKEAWAYS = 50
RESEARCH_MAX_IMPLICATIONS = 50
DAILY_DATE_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
ACNE_ASSESSMENT_FIELDS = [
    {
        "id": "baumann_skin_type",
        "label": "Baumann Skin Type",
        "description": "Four-axis skin-type assessment used to reason about acne routines and tolerance.",
        "fields": [
            {"id": "o_vs_d", "label": "O vs D", "prompt": "Oiliness vs dryness", "options": ["unknown", "O", "D"]},
            {"id": "s_vs_r", "label": "S vs R", "prompt": "Sensitive vs resistant", "options": ["unknown", "S", "R"]},
            {"id": "p_vs_n", "label": "P vs N", "prompt": "Pigmented vs non-pigmented", "options": ["unknown", "P", "N"]},
            {"id": "w_vs_t", "label": "W vs T", "prompt": "Wrinkle-prone vs tight", "options": ["unknown", "W", "T"]},
        ],
    },
    {
        "id": "fitzpatrick_phototype",
        "label": "Fitzpatrick Skin Phototype",
        "description": "Melanin synthesis capacity and sun-response category.",
        "fields": [
            {"id": "phototype", "label": "Phototype", "prompt": "Type I, II, III, IV, V, or VI", "options": ["unknown", "I", "II", "III", "IV", "V", "VI"]},
        ],
    },
    {
        "id": "genetic_scarring_tendency",
        "label": "Genetic Scarring Tendency",
        "description": "Scarring patterns that should influence acne intervention aggressiveness.",
        "fields": [
            {"id": "atrophic_pitted_scarring", "label": "Atrophic / Pitted Scarring", "prompt": "Likelihood or history of atrophic or pitted acne scarring", "options": ["unknown", "low", "moderate", "high"]},
            {"id": "hypertrophic_keloidal_scarring", "label": "Hypertrophic / Keloidal Scarring", "prompt": "Likelihood or history of hypertrophic or keloidal scarring", "options": ["unknown", "low", "moderate", "high"]},
        ],
    },
    {
        "id": "anatomical_pore_size_distribution",
        "label": "Anatomical Pore Size & Distribution",
        "description": "Pore morphology and distribution pattern relevant to acne phenotype.",
        "fields": [
            {"id": "size", "label": "Size", "prompt": "Large or small", "options": ["unknown", "large", "small"]},
            {"id": "distribution", "label": "Distribution", "prompt": "Where enlarged or acne-relevant pores are concentrated", "options": ["unknown", "T zone", "expanded mid face", "U zone / lower face", "butterfly / malar pattern", "peripheral / hairline", "global"]},
        ],
    },
]


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _project_global_context_key(email, project_id):
    return f"{email}/projects/{project_id}/global-context.json"


def _project_daily_context_key(email, project_id, date):
    return f"{email}/projects/{project_id}/daily-context/{date}.json"


def _project_recommendations_key(email, project_id, date):
    return f"{email}/projects/{project_id}/recommendations/{date}.json"


def _project_recommendations_manifest_key(email, project_id, date):
    return f"{email}/projects/{project_id}/recommendations/{date}/manifest.json"


def _project_recommendation_file_key(email, project_id, date, recommendation_id):
    return f"{email}/projects/{project_id}/recommendations/{date}/files/{recommendation_id}.json"


def _project_daily_image_key(email, project_id, date, image_id, extension):
    return f"{email}/projects/{project_id}/daily-context/{date}/images/{image_id}.{extension}"


def _project_research_item_key(email, project_id, research_id):
    return f"{email}/projects/{project_id}/research/items/{research_id}.json"


def _user_project_key(user_id, project_id):
    return f"{user_id}#{project_id}"


def _default_global_context(project_id, user_id):
    project = PROJECT_BY_ID[project_id]
    now = _now_iso()
    context = {
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
    if project_id == "acne":
        context["assessmentFields"] = _default_acne_assessment_fields()
    return context


def _default_acne_assessment_fields():
    groups = deepcopy(ACNE_ASSESSMENT_FIELDS)
    for group in groups:
        for field in group["fields"]:
            field["value"] = "unknown"
            field["reason"] = ""
            field["updatedAt"] = None
    return groups


def _assessment_source_lookup(value):
    lookup = {}
    if not isinstance(value, list):
        return lookup
    for group in value:
        if not isinstance(group, dict) or not isinstance(group.get("id"), str):
            continue
        fields = {}
        for field in group.get("fields", []):
            if isinstance(field, dict) and isinstance(field.get("id"), str):
                fields[field["id"]] = field
        lookup[group["id"]] = fields
    return lookup


def _apply_assessment_field_values(groups, source):
    lookup = _assessment_source_lookup(source)
    for group in groups:
        source_fields = lookup.get(group["id"], {})
        for field in group["fields"]:
            source_field = source_fields.get(field["id"], {})
            value = source_field.get("value")
            reason = source_field.get("reason")
            updated_at = source_field.get("updatedAt")
            if isinstance(value, str) and value.strip() and len(value) <= 200:
                field["value"] = value.strip()
            if isinstance(reason, str) and len(reason) <= 2000:
                field["reason"] = reason.strip()
            if isinstance(updated_at, str) and updated_at.strip() and len(updated_at) <= 80:
                field["updatedAt"] = updated_at.strip()


def _normalize_acne_assessment_fields(incoming, existing=None):
    groups = _default_acne_assessment_fields()
    _apply_assessment_field_values(groups, existing)
    _apply_assessment_field_values(groups, incoming)
    return groups


def _normalize_string_list(value):
    if not isinstance(value, list):
        return []
    normalized = []
    for item in value:
        if isinstance(item, str) and item.strip():
            normalized.append(item.strip())
    return normalized


def _normalize_global_context(value, project_id, user_id, existing=None):
    default_context = _default_global_context(project_id, user_id)
    if not isinstance(value, dict):
        value = {}

    context = deepcopy(default_context)
    context["createdAt"] = value.get("createdAt") or context["createdAt"]
    context["updatedAt"] = value.get("updatedAt") or context["updatedAt"]
    context["summary"] = value.get("summary") if isinstance(value.get("summary"), str) else ""
    context["facts"] = _normalize_string_list(value.get("facts"))
    context["preferences"] = _normalize_string_list(value.get("preferences"))
    context["constraints"] = _normalize_string_list(value.get("constraints"))
    context["openQuestions"] = _normalize_string_list(value.get("openQuestions"))
    if project_id == "acne":
        context["assessmentFields"] = _normalize_acne_assessment_fields(value.get("assessmentFields"), (existing or {}).get("assessmentFields"))
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
        ServerSideEncryption="AES256",
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
        entry_type = entry.get("type", "text")
        if entry_type not in {"text", "image"}:
            raise ValueError(f"entries[{index}].type is invalid")
        normalized_entry = {
            "id": entry_id.strip(),
            "type": entry_type,
            "time": entry.get("time") if isinstance(entry.get("time"), str) else None,
            "summary": summary.strip(),
            "createdAt": entry.get("createdAt") or default["createdAt"],
            "updatedAt": entry.get("updatedAt") or default["updatedAt"],
        }
        if entry_type == "image":
            if not isinstance(entry.get("imageUrl"), str) or not entry["imageUrl"].startswith("/api/"):
                raise ValueError(f"entries[{index}].imageUrl is invalid")
            if entry.get("contentType") not in {"image/png", "image/jpeg", "image/webp"}:
                raise ValueError(f"entries[{index}].contentType is invalid")
            normalized_entry["imageUrl"] = entry["imageUrl"]
            normalized_entry["contentType"] = entry["contentType"]
            if isinstance(entry.get("filename"), str) and entry["filename"].strip():
                normalized_entry["filename"] = entry["filename"].strip().split("/")[-1].split("\\")[-1]
        normalized_entries.append(normalized_entry)
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


def _daily_context_metadata(email, project_id, context):
    entries = context.get("entries", [])
    image_count = sum(1 for entry in entries if entry.get("type") == "image")
    entry_types = sorted({entry.get("type", "text") for entry in entries})
    summaries = [entry["summary"] for entry in entries if isinstance(entry.get("summary"), str) and entry["summary"].strip()]
    return {
        "userProject": _user_project_key(context.get("userId") or email, project_id),
        "date": context["date"],
        "email": email,
        "userId": context.get("userId") or email,
        "projectId": project_id,
        "s3Key": _project_daily_context_key(email, project_id, context["date"]),
        "entryCount": len(entries),
        "imageCount": image_count,
        "entryTypes": entry_types,
        "summaryPreview": summaries[:5],
        "updatedAt": context.get("updatedAt") or _now_iso(),
        "createdAt": context.get("createdAt") or _now_iso(),
    }


def _write_daily_context_metadata(email, project_id, context):
    project_daily_context_metadata_table.put_item(Item=_daily_context_metadata(email, project_id, context))


def _write_daily_context(email, project_id, context):
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=_project_daily_context_key(email, project_id, context["date"]),
        Body=json.dumps(context, indent=2),
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )
    _write_daily_context_metadata(email, project_id, context)


def _query_daily_context_metadata(email, user_id, project_id, date_from=None, date_to=None):
    user_project = _user_project_key(user_id or email, project_id)
    kwargs = {"KeyConditionExpression": Key("userProject").eq(user_project)}
    if date_from and date_to:
        kwargs["KeyConditionExpression"] = Key("userProject").eq(user_project) & Key("date").between(_validate_daily_date(date_from), _validate_daily_date(date_to))
    elif date_from:
        kwargs["KeyConditionExpression"] = Key("userProject").eq(user_project) & Key("date").gte(_validate_daily_date(date_from))
    elif date_to:
        kwargs["KeyConditionExpression"] = Key("userProject").eq(user_project) & Key("date").lte(_validate_daily_date(date_to))
    items = []
    last_key = None
    while True:
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        resp = project_daily_context_metadata_table.query(**kwargs)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key or len(items) >= 370:
            break
    return items[:370]


def _decode_image_data(image_data):
    if not isinstance(image_data, str):
        raise ValueError("image_data must be a base64 string")
    encoded = image_data
    if encoded.startswith("data:"):
        header, separator, encoded = encoded.partition(",")
        if not separator or ";base64" not in header:
            raise ValueError("image_data must be base64 encoded")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("image_data is not valid base64") from exc
    if not raw or len(raw) > DAILY_CONTEXT_MAX_IMAGE_BYTES:
        raise ValueError("image_data exceeds the 5 MiB limit")
    signatures = ((b"\x89PNG\r\n\x1a\n", "png", "image/png"), (b"\xff\xd8\xff", "jpg", "image/jpeg"), (b"RIFF", "webp", "image/webp"))
    for signature, extension, content_type in signatures:
        if raw.startswith(signature) and (extension != "webp" or raw[8:12] == b"WEBP"):
            return raw, extension, content_type
    raise ValueError("image_data must be PNG, JPEG, or WebP")


def _store_daily_context_image(email, project_id, user_id, date, image_data, summary, time=None, filename=None):
    date = _validate_daily_date(date)
    raw, extension, content_type = _decode_image_data(image_data)
    image_id = f"image-{uuid.uuid4().hex}"
    key = _project_daily_image_key(email, project_id, date, image_id, extension)
    context = _read_daily_context(email, project_id, user_id, date)
    if len(context["entries"]) >= DAILY_CONTEXT_MAX_ENTRIES:
        raise ValueError("entries must be an array with at most 100 items")
    now = _now_iso()
    entry = {
        "id": image_id,
        "type": "image",
        "time": time if isinstance(time, str) else None,
        "summary": summary.strip() if isinstance(summary, str) and summary.strip() else "Image context",
        "imageUrl": f"/api/projects/{project_id}/daily-context/{date}/images/{image_id}",
        "contentType": content_type,
        "filename": (filename.strip().split("/")[-1].split("\\")[-1] if isinstance(filename, str) and filename.strip() else f"{image_id}.{extension}"),
        "createdAt": now,
        "updatedAt": now,
    }
    context["entries"].append(entry)
    context["updatedAt"] = now
    s3.put_object(Bucket=PRODUCTIVITY_BUCKET, Key=key, Body=raw, ContentType=content_type, ServerSideEncryption="AES256")
    try:
        _write_daily_context(email, project_id, context)
    except Exception:
        try:
            s3.delete_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        finally:
            raise
    return entry


def _default_recommendations(project_id, user_id, date):
    now = _now_iso()
    return {
        "schemaVersion": RECOMMENDATION_VERSION,
        "userId": user_id,
        "projectId": project_id,
        "date": date,
        "href": f"/projects/{project_id}/recommendations/{date}",
        "recommendations": [],
        "createdAt": now,
        "updatedAt": now,
    }


def _default_recommendation_kind(project_id):
    return "routine"


def _normalize_recommendation_kind(value, project_id, strict=False):
    if isinstance(value, str):
        kind = value.strip()
        if kind in RECOMMENDATION_KINDS:
            return kind
        if not strict and kind == "Routine":
            return "routine"
    if strict:
        raise ValueError("recommendation kind must be routine")
    return _default_recommendation_kind(project_id)


def _normalize_routine_steps(value, fallback_text=None, strict=False):
    if not isinstance(value, list):
        if strict:
            raise ValueError("routine steps must be an array")
        if isinstance(fallback_text, str) and fallback_text.strip():
            return [{"item": "recommendation", "command": fallback_text.strip()}]
        return []
    if not value or len(value) > RECOMMENDATION_MAX_STEPS:
        raise ValueError("routine steps must include 1 to 100 items")
    steps = []
    for index, step in enumerate(value):
        if isinstance(step, (list, tuple)) and len(step) == 2:
            item, command = step
            clarification = None
        elif isinstance(step, dict):
            item = step.get("item")
            command = step.get("command")
            clarification = step.get("clarification")
        else:
            raise ValueError(f"steps[{index}] must be an object")
        if not isinstance(item, str) or not item.strip() or len(item) > 160:
            raise ValueError(f"steps[{index}].item is invalid")
        if not isinstance(command, str) or not command.strip() or len(command) > 500:
            raise ValueError(f"steps[{index}].command is invalid")
        normalized_step = {
            "item": item.strip(),
            "command": command.strip(),
        }
        if isinstance(clarification, str) and clarification.strip():
            if len(clarification) > 500:
                raise ValueError(f"steps[{index}].clarification is invalid")
            normalized_step["clarification"] = clarification.strip()
        steps.append(normalized_step)
    return steps


def _normalize_recommendation_file(value, project_id, date, recommendation_id, default, strict=False):
    if not isinstance(value, dict):
        value = {}
    kind = _normalize_recommendation_kind(value.get("kind", default.get("kind")), project_id, strict=strict)
    title = value.get("title", default.get("title"))
    summary = value.get("summary", default.get("summary"))
    if not isinstance(title, str) or not title.strip() or len(title) > 200:
        title = summary if isinstance(summary, str) else recommendation_id
    if not isinstance(summary, str) or not summary.strip() or len(summary) > 2000:
        raise ValueError("recommendation summary is invalid")
    steps = _normalize_routine_steps(value.get("steps", value.get("routine")), value.get("body", value.get("content", default.get("body", summary))), strict=strict)
    now = _now_iso()
    return {
        "schemaVersion": RECOMMENDATION_VERSION,
        "id": recommendation_id,
        "projectId": project_id,
        "date": date,
        "kind": kind,
        "title": title.strip(),
        "summary": summary.strip(),
        "steps": steps,
        "createdAt": value.get("createdAt") or default.get("createdAt") or now,
        "updatedAt": value.get("updatedAt") or default.get("updatedAt") or now,
    }


def _normalize_recommendations(value, project_id, user_id, date, strict=False):
    date = _validate_daily_date(date)
    default = _default_recommendations(project_id, user_id, date)
    if not isinstance(value, dict):
        return default
    raw_items = value.get("recommendations")
    if not isinstance(raw_items, list) or len(raw_items) > RECOMMENDATION_MAX_ITEMS:
        raise ValueError("recommendations must be an array with at most 50 items")
    items = []
    seen = set()
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            raise ValueError(f"recommendations[{index}] must be an object")
        item_id = item.get("id")
        summary = item.get("summary")
        if not isinstance(item_id, str) or not item_id.strip() or len(item_id.strip()) > 80 or item_id.strip() in seen:
            raise ValueError(f"recommendations[{index}].id is invalid or duplicated")
        if not isinstance(summary, str) or not summary.strip() or len(summary) > 2000:
            raise ValueError(f"recommendations[{index}].summary is invalid")
        item_id = item_id.strip()
        seen.add(item_id)
        kind = _normalize_recommendation_kind(item.get("kind"), project_id, strict=strict)
        title = item.get("title") if isinstance(item.get("title"), str) and item["title"].strip() else summary
        normalized_item = {
            "id": item_id,
            "kind": kind,
            "title": title.strip()[:200],
            "summary": summary.strip(),
            "href": f"/projects/{project_id}/recommendations/{date}/{item_id}",
            "contentType": "application/json",
            "createdAt": item.get("createdAt") or default["createdAt"],
            "updatedAt": item.get("updatedAt") or default["updatedAt"],
        }
        if strict or "steps" in item or "routine" in item or "body" in item or "content" in item:
            file_document = _normalize_recommendation_file(item, project_id, date, item_id, normalized_item, strict=strict)
            normalized_item["steps"] = file_document["steps"]
        items.append(normalized_item)
    return {**default, "href": f"/projects/{project_id}/recommendations/{date}", "recommendations": items, "createdAt": value.get("createdAt") or default["createdAt"], "updatedAt": value.get("updatedAt") or default["updatedAt"]}


def _read_recommendations(email, project_id, user_id, date):
    date = _validate_daily_date(date)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=_project_recommendations_manifest_key(email, project_id, date))
        with obj["Body"] as body:
            raw = json.loads(body.read().decode("utf-8"))
        return _normalize_recommendations(raw, project_id, user_id, date)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"NoSuchKey", "404", "NotFound"}:
            return _read_legacy_recommendations(email, project_id, user_id, date)
        raise
    except (BotoCoreError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("recommendations unavailable") from exc


def _read_legacy_recommendations(email, project_id, user_id, date):
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=_project_recommendations_key(email, project_id, date))
        with obj["Body"] as body:
            raw = json.loads(body.read().decode("utf-8"))
        return _normalize_recommendations(raw, project_id, user_id, date)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"NoSuchKey", "404", "NotFound"}:
            return _default_recommendations(project_id, user_id, date)
        raise
    except (BotoCoreError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("recommendations unavailable") from exc


def _read_recommendation_file(email, project_id, user_id, date, recommendation_id):
    date = _validate_daily_date(date)
    recommendations = _read_recommendations(email, project_id, user_id, date)
    item = next((item for item in recommendations["recommendations"] if item["id"] == recommendation_id), None)
    if not item:
        return None, None
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=_project_recommendation_file_key(email, project_id, date, recommendation_id))
        with obj["Body"] as body:
            raw = json.loads(body.read().decode("utf-8"))
        file_document = _normalize_recommendation_file(raw, project_id, date, recommendation_id, item)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code not in {"NoSuchKey", "404", "NotFound"}:
            raise
        file_document = _normalize_recommendation_file(item, project_id, date, recommendation_id, item)
    except (BotoCoreError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("recommendations unavailable") from exc
    return item, file_document


def _write_recommendations(email, project_id, recommendations):
    files = []
    manifest_items = []
    for item in recommendations["recommendations"]:
        file_document = _normalize_recommendation_file(item, project_id, recommendations["date"], item["id"], item, strict=True)
        files.append(file_document)
        manifest_items.append({
            "id": file_document["id"],
            "kind": file_document["kind"],
            "title": file_document["title"],
            "summary": file_document["summary"],
            "href": f"/projects/{project_id}/recommendations/{recommendations['date']}/{file_document['id']}",
            "contentType": "application/json",
            "createdAt": file_document["createdAt"],
            "updatedAt": file_document["updatedAt"],
        })
    manifest = {**recommendations, "href": f"/projects/{project_id}/recommendations/{recommendations['date']}", "recommendations": manifest_items}
    for file_document in files:
        s3.put_object(
            Bucket=PRODUCTIVITY_BUCKET,
            Key=_project_recommendation_file_key(email, project_id, recommendations["date"], file_document["id"]),
            Body=json.dumps(file_document, indent=2),
            ContentType="application/json",
            ServerSideEncryption="AES256",
        )
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=_project_recommendations_manifest_key(email, project_id, recommendations["date"]),
        Body=json.dumps(manifest, indent=2),
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )
    return manifest


def _normalize_research_source(value):
    if not isinstance(value, dict):
        raise ValueError("source must be an object")
    title = value.get("title")
    url = value.get("url")
    if not isinstance(title, str) or not title.strip() or len(title) > 500:
        raise ValueError("source.title is invalid")
    if not isinstance(url, str) or not url.strip() or len(url) > 2000:
        raise ValueError("source.url is invalid")
    source = {
        "title": title.strip(),
        "url": url.strip(),
    }
    for key in ("publisher", "publishedDate", "accessedDate", "sourceType"):
        if isinstance(value.get(key), str) and value[key].strip():
            source[key] = value[key].strip()[:200]
    return source


def _normalize_qualified_statements(value):
    if not isinstance(value, list) or not value or len(value) > RESEARCH_MAX_STATEMENTS:
        raise ValueError("qualifiedStatements must include 1 to 50 items")
    statements = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f"qualifiedStatements[{index}] must be an object")
        statement = item.get("statement")
        qualification = item.get("qualification")
        if not isinstance(statement, str) or not statement.strip() or len(statement) > 2000:
            raise ValueError(f"qualifiedStatements[{index}].statement is invalid")
        if not isinstance(qualification, str) or not qualification.strip() or len(qualification) > 2000:
            raise ValueError(f"qualifiedStatements[{index}].qualification is invalid")
        normalized = {
            "statement": statement.strip(),
            "qualification": qualification.strip(),
            "evidenceStrength": item.get("evidenceStrength") if item.get("evidenceStrength") in {"low", "medium", "high"} else "medium",
            "appliesTo": _normalize_string_list(item.get("appliesTo"))[:20],
            "limitations": _normalize_string_list(item.get("limitations"))[:20],
        }
        statements.append(normalized)
    return statements


def _normalize_limited_string_list(value, field, limit):
    items = _normalize_string_list(value)
    if len(items) > limit:
        raise ValueError(f"{field} must include at most {limit} items")
    return [item[:500] for item in items]


def _normalize_research_item(value, project_id, user_id, existing=None):
    if not isinstance(value, dict):
        raise ValueError("research item must be an object")
    now = _now_iso()
    research_id = value.get("id") or value.get("researchId") or f"research-{uuid.uuid4().hex}"
    if not isinstance(research_id, str) or not research_id.strip() or len(research_id) > 100:
        raise ValueError("research id is invalid")
    topic = value.get("topic")
    if not isinstance(topic, str) or not topic.strip() or len(topic) > 300:
        raise ValueError("topic is invalid")
    status = value.get("status", "active")
    if status not in {"active", "superseded", "rejected"}:
        raise ValueError("status is invalid")
    item = {
        "schemaVersion": RESEARCH_VERSION,
        "id": research_id.strip(),
        "userId": user_id,
        "projectId": project_id,
        "topic": topic.strip(),
        "status": status,
        "source": _normalize_research_source(value.get("source")),
        "qualifiedStatements": _normalize_qualified_statements(value.get("qualifiedStatements")),
        "takeaways": _normalize_limited_string_list(value.get("takeaways"), "takeaways", RESEARCH_MAX_TAKEAWAYS),
        "recommendationImplications": _normalize_limited_string_list(value.get("recommendationImplications"), "recommendationImplications", RESEARCH_MAX_IMPLICATIONS),
        "tags": _normalize_limited_string_list(value.get("tags"), "tags", 30),
        "relatedTopics": _normalize_limited_string_list(value.get("relatedTopics"), "relatedTopics", 30),
        "createdAt": value.get("createdAt") or (existing or {}).get("createdAt") or now,
        "updatedAt": value.get("updatedAt") or (existing or {}).get("updatedAt") or now,
    }
    return item


def _research_metadata(email, project_id, item):
    source = item["source"]
    statements = item.get("qualifiedStatements", [])
    strengths = [statement.get("evidenceStrength") for statement in statements if statement.get("evidenceStrength")]
    return {
        "userProject": _user_project_key(item.get("userId") or email, project_id),
        "researchId": item["id"],
        "email": email,
        "userId": item.get("userId") or email,
        "projectId": project_id,
        "topic": item["topic"],
        "status": item["status"],
        "tags": item.get("tags", []),
        "relatedTopics": item.get("relatedTopics", []),
        "sourceTitle": source["title"],
        "sourceUrl": source["url"],
        "sourcePublisher": source.get("publisher", ""),
        "sourceType": source.get("sourceType", ""),
        "publishedDate": source.get("publishedDate", ""),
        "accessedDate": source.get("accessedDate", ""),
        "evidenceStrengths": strengths,
        "takeawaysPreview": item.get("takeaways", [])[:5],
        "s3Key": _project_research_item_key(email, project_id, item["id"]),
        "updatedAt": item["updatedAt"],
        "createdAt": item["createdAt"],
    }


def _write_research_item(email, project_id, user_id, value):
    existing = None
    research_id = (value.get("id") or value.get("researchId")) if isinstance(value, dict) else None
    if isinstance(research_id, str) and research_id.strip():
        existing = _read_research_item(email, project_id, user_id, research_id.strip(), missing_ok=True)
    item = _normalize_research_item(value, project_id, user_id, existing)
    item["updatedAt"] = _now_iso()
    key = _project_research_item_key(email, project_id, item["id"])
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET,
        Key=key,
        Body=json.dumps(item, indent=2),
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )
    try:
        project_research_metadata_table.put_item(Item=_research_metadata(email, project_id, item))
    except Exception:
        try:
            s3.delete_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        finally:
            raise
    return item


def _query_research_metadata(email, user_id, project_id, include_inactive=False):
    user_project = _user_project_key(user_id or email, project_id)
    items = []
    last_key = None
    while True:
        kwargs = {"KeyConditionExpression": Key("userProject").eq(user_project)}
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        resp = project_research_metadata_table.query(**kwargs)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key or len(items) >= RESEARCH_MAX_ITEMS:
            break
    if not include_inactive:
        items = [item for item in items if item.get("status") == "active"]
    return sorted(items, key=lambda item: item.get("updatedAt", ""), reverse=True)[:RESEARCH_MAX_ITEMS]


def _read_research_item(email, project_id, user_id, research_id, missing_ok=False):
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=_project_research_item_key(email, project_id, research_id))
        with obj["Body"] as body:
            raw = json.loads(body.read().decode("utf-8"))
        return _normalize_research_item(raw, project_id, user_id, raw)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if missing_ok and code in {"NoSuchKey", "404", "NotFound"}:
            return None
        raise
    except (BotoCoreError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("research unavailable") from exc


def _recent_recommendation_dates(date, days=31):
    end = datetime.date.fromisoformat(_validate_daily_date(date))
    return [(end - datetime.timedelta(days=offset)).isoformat() for offset in range(days)]


def _read_recommendation_context(email, project_id, user_id, date):
    target_date = _validate_daily_date(date)
    active_research = _query_research_metadata(email, user_id, project_id)
    recent = []
    for candidate_date in _recent_recommendation_dates(target_date):
        recommendations = _read_recommendations(email, project_id, user_id, candidate_date)
        if recommendations["recommendations"]:
            recent.append({
                "date": candidate_date,
                "href": recommendations["href"],
                "recommendations": recommendations["recommendations"],
            })
    return {
        "projectId": project_id,
        "date": target_date,
        "activeResearch": active_research,
        "recentRecommendations": recent,
    }


def _project_calendar_days_for_user(email, user_id, timezone):
    today = datetime.datetime.now(timezone).date()
    days = []
    for offset in range(-3, 4):
        day = today + datetime.timedelta(days=offset)
        date = day.isoformat()
        projects = []
        for project in PROJECTS:
            context = _read_daily_context(email, project["id"], user_id, date)
            recommendations = _read_recommendations(email, project["id"], user_id, date)
            projects.append({
                "id": project["id"],
                "name": project["name"],
                "entry_count": len(context["entries"]),
                "image_count": sum(1 for entry in context["entries"] if entry.get("type") == "image"),
                "raw_json": json.dumps(context, indent=2),
                "recommendations_href": recommendations["href"],
                "recommendations_count": len(recommendations["recommendations"]),
                "recommendations": recommendations["recommendations"],
                "recommendations_raw_json": json.dumps(recommendations, indent=2),
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


@projects_bp.route("/api/projects/research-metadata", methods=["GET"])
def api_project_research_metadata():
    ctx, err = _require_auth()
    if err:
        return err

    email = ctx["email"]
    user_id = ctx.get("user_id") or email
    include_inactive = request.args.get("include_inactive") == "true"
    try:
        projects = []
        for project in PROJECTS:
            projects.append({
                "id": project["id"],
                "name": project["name"],
                "researchMetadata": _query_research_metadata(email, user_id, project["id"], include_inactive=include_inactive),
            })
        return jsonify({"projects": projects})
    except (ClientError, BotoCoreError, RuntimeError):
        return jsonify({"error": "research_metadata_unavailable"}), 503


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
    existing = _read_project_global_context(email, project_id, user_id)
    context = _normalize_global_context(data.get("globalContext", data), project_id, user_id, existing=existing)
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


@projects_bp.route("/api/projects/<project_id>/daily-context/<date>/images/<image_id>", methods=["GET"])
def api_project_daily_context_image(project_id, date, image_id):
    ctx, err = _require_auth()
    if err:
        return err
    if project_id not in PROJECT_BY_ID:
        return jsonify({"error": "unknown project"}), 404
    try:
        date = _validate_daily_date(date)
        context = _read_daily_context(ctx["email"], project_id, ctx.get("user_id") or ctx["email"], date)
        entry = next((item for item in context["entries"] if item.get("id") == image_id and item.get("type") == "image"), None)
        if not entry:
            return jsonify({"error": "image not found"}), 404
        extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(entry.get("contentType"))
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=_project_daily_image_key(ctx["email"], project_id, date, image_id, extension))
        return send_file(io.BytesIO(obj["Body"].read()), mimetype=entry["contentType"], download_name=entry.get("filename"), max_age=0)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except (ClientError, BotoCoreError, RuntimeError):
        return jsonify({"error": "daily_context_unavailable"}), 503


@projects_bp.route("/api/projects/<project_id>/recommendations/<date>", methods=["GET", "PUT"])
def api_project_recommendations(project_id, date):
    ctx, err = _require_auth()
    if err:
        return err
    if project_id not in PROJECT_BY_ID:
        return jsonify({"error": "unknown project"}), 404
    try:
        email = ctx["email"]
        user_id = ctx.get("user_id") or email
        if request.method == "GET":
            return jsonify({"recommendations": _read_recommendations(email, project_id, user_id, date)})
        data = request.get_json(silent=True) or {}
        recommendations = _normalize_recommendations({"recommendations": data.get("recommendations", [])}, project_id, user_id, date, strict=True)
        recommendations["updatedAt"] = _now_iso()
        recommendations = _write_recommendations(email, project_id, recommendations)
        return jsonify({"ok": True, "recommendations": recommendations})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except (ClientError, BotoCoreError, RuntimeError):
        return jsonify({"error": "recommendations_unavailable"}), 503


@projects_bp.route("/api/projects/<project_id>/recommendations/<date>/<recommendation_id>", methods=["GET"])
def api_project_recommendation(project_id, date, recommendation_id):
    ctx, err = _require_auth()
    if err:
        return err
    if project_id not in PROJECT_BY_ID:
        return jsonify({"error": "unknown project"}), 404
    try:
        email = ctx["email"]
        user_id = ctx.get("user_id") or email
        item, file_document = _read_recommendation_file(email, project_id, user_id, date, recommendation_id)
        if not item:
            return jsonify({"error": "recommendation not found"}), 404
        return jsonify({"recommendation": item, "file": file_document})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except (ClientError, BotoCoreError, RuntimeError):
        return jsonify({"error": "recommendations_unavailable"}), 503


def _require_page_user():
    user = session.get("user")
    if not user:
        return None, redirect(url_for("pages.login_page", next=request.url))
    return user, None


@projects_bp.route("/projects/<project_id>/recommendations/<date>", methods=["GET"])
def project_recommendations_page(project_id, date):
    user, err = _require_page_user()
    if err:
        return err
    if project_id not in PROJECT_BY_ID:
        return "<h1>404 - Project Not Found</h1>", 404
    try:
        date = _validate_daily_date(date)
        recommendations = _read_recommendations(user["email"], project_id, user.get("id") or user["email"], date)
        return render_template(
            "project_recommendations.html",
            user=user,
            project=PROJECT_BY_ID[project_id],
            date=date,
            recommendations=recommendations,
            raw_json=json.dumps(recommendations, indent=2),
        )
    except ValueError:
        return "<h1>400 - Invalid Date</h1>", 400
    except (ClientError, BotoCoreError, RuntimeError):
        return "<h1>Recommendations are temporarily unavailable.</h1>", 503


@projects_bp.route("/projects/<project_id>/recommendations/<date>/<recommendation_id>", methods=["GET"])
def project_recommendation_page(project_id, date, recommendation_id):
    user, err = _require_page_user()
    if err:
        return err
    if project_id not in PROJECT_BY_ID:
        return "<h1>404 - Project Not Found</h1>", 404
    try:
        date = _validate_daily_date(date)
        item, file_document = _read_recommendation_file(user["email"], project_id, user.get("id") or user["email"], date, recommendation_id)
        if not item:
            return "<h1>404 - Recommendation Not Found</h1>", 404
        return render_template(
            "project_recommendation.html",
            user=user,
            project=PROJECT_BY_ID[project_id],
            date=date,
            recommendation=item,
            file=file_document,
            raw_json=json.dumps(file_document, indent=2),
        )
    except ValueError:
        return "<h1>400 - Invalid Date</h1>", 400
    except (ClientError, BotoCoreError, RuntimeError):
        return "<h1>Recommendation is temporarily unavailable.</h1>", 503
