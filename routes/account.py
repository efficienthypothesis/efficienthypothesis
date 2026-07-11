from boto3.dynamodb.conditions import Attr
from flask import Blueprint, jsonify, request, session

from config import (
    PRODUCTIVITY_BUCKET,
    actions_table,
    drafts_table,
    dynamodb,
    oauth_tokens_table,
    s3,
    tasks_table,
    timelogs_table,
    user_table,
    _is_programmatic,
    _require_auth,
)

account_bp = Blueprint("account", __name__)

chat_usage_table = dynamodb.Table("ChatUsage")
chat_feedback_table = dynamodb.Table("ChatFeedback")


@account_bp.route("/api/account", methods=["DELETE"])
def api_account_delete():
    ctx, err = _require_auth()
    if err:
        return err
    if _is_programmatic(ctx):
        return jsonify({"error": "Account deletion requires a browser session"}), 403

    email = ctx["email"]
    user_id = ctx.get("user_id") or ""
    confirmation = (request.get_json(silent=True) or {}).get("confirmation", "")
    expected_confirmation = f"DELETE {email}"
    if confirmation != expected_confirmation:
        return jsonify({"error": f"Type {expected_confirmation} to confirm account deletion"}), 400

    deleted = {
        "s3_objects": _delete_s3_prefix(f"{email}/"),
        "tasks": _delete_by_filter(tasks_table, "task_id", Attr("user").eq(email)),
        "actions": _delete_by_filter(actions_table, "action_id", Attr("user").eq(email)),
        "drafts": _delete_by_filter(drafts_table, "draft_id", Attr("user").eq(email)),
        "timelogs": _delete_by_filter(timelogs_table, "log_id", Attr("user").eq(email)),
        "oauth_tokens": _delete_oauth_tokens(email, user_id),
        "chat_usage": _delete_by_filter(chat_usage_table, ["user_id", "date"], Attr("user_id").eq(email)),
        "chat_feedback": _delete_by_filter(
            chat_feedback_table,
            "feedback_id",
            Attr("user_id").eq(email),
        ),
        "users": _delete_user_records(email, user_id),
    }
    session.clear()
    return jsonify({"ok": True, "deleted": deleted})


def _delete_s3_prefix(prefix):
    deleted_count = 0
    continuation_token = None
    while True:
        kwargs = {"Bucket": PRODUCTIVITY_BUCKET, "Prefix": prefix}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        resp = s3.list_objects_v2(**kwargs)
        objects = [{"Key": item["Key"]} for item in resp.get("Contents", [])]
        for start in range(0, len(objects), 1000):
            batch = objects[start:start + 1000]
            if batch:
                s3.delete_objects(Bucket=PRODUCTIVITY_BUCKET, Delete={"Objects": batch})
                deleted_count += len(batch)
        if not resp.get("IsTruncated"):
            break
        continuation_token = resp.get("NextContinuationToken")
    return deleted_count


def _delete_by_filter(table, key_fields, filter_expression):
    deleted_count = 0
    last_key = None
    key_names = key_fields if isinstance(key_fields, list) else [key_fields]
    while True:
        kwargs = {"FilterExpression": filter_expression}
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        resp = table.scan(**kwargs)
        for item in resp.get("Items", []):
            key = {name: item[name] for name in key_names if name in item}
            if len(key) == len(key_names):
                table.delete_item(Key=key)
                deleted_count += 1
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
    return deleted_count


def _delete_oauth_tokens(email, user_id):
    token_filter = Attr("email").eq(email)
    if user_id:
        token_filter = token_filter | Attr("user_id").eq(user_id)
    return _delete_by_filter(oauth_tokens_table, "token_hash", token_filter)


def _delete_user_records(email, user_id):
    deleted_count = 0
    seen = set()

    if user_id:
        try:
            user_table.delete_item(Key={"user_id": user_id})
            seen.add(user_id)
            deleted_count += 1
        except Exception:
            pass

    last_key = None
    while True:
        kwargs = {"FilterExpression": Attr("email").eq(email)}
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        resp = user_table.scan(**kwargs)
        for item in resp.get("Items", []):
            candidate_id = item.get("user_id")
            if candidate_id and candidate_id not in seen:
                user_table.delete_item(Key={"user_id": candidate_id})
                seen.add(candidate_id)
                deleted_count += 1
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
    return deleted_count
