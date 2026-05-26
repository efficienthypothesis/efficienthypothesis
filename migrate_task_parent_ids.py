"""Replace task hierarchy paths with parent_id references.

Dry run:
  python3 migrate_task_parent_ids.py --profile eh

Apply with backups:
  python3 migrate_task_parent_ids.py --profile eh --apply

Backups are written to:
  s3://eh-app-data/backups/task-parent-id-migration/<timestamp>/
"""

import argparse
import datetime
import json

import boto3
from boto3.dynamodb.conditions import Attr


BUCKET = "eh-app-data"
REGION = "us-east-2"


def _normalize_path(path):
    path = (path or "/").strip() or "/"
    if not path.startswith("/"):
        path = "/" + path
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return path


def _task_full_path(task):
    parent_path = _normalize_path(task.get("path"))
    name = (task.get("name") or "").strip()
    if parent_path == "/":
        return "/" + name if name else "/"
    return parent_path + "/" + name if name else parent_path


def _scan_user_tasks(table, email):
    items = []
    kwargs = {"FilterExpression": Attr("user").eq(email)}
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            return items
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def _scan_emails(table):
    emails = set()
    kwargs = {}
    while True:
        resp = table.scan(**kwargs)
        for item in resp.get("Items", []):
            if item.get("user"):
                emails.add(item["user"])
        if "LastEvaluatedKey" not in resp:
            return sorted(emails)
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def _put_s3_json(s3, key, value):
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=json.dumps(value, indent=2, default=str),
        ContentType="application/json",
    )


def migrate_user(email, s3, table, backup_root, apply):
    tasks = _scan_user_tasks(table, email)
    by_full_path = {}
    for task in tasks:
        by_full_path.setdefault(_task_full_path(task), []).append(task)

    updates = []
    ambiguous = []
    unresolved = []
    for task in tasks:
        if "path" not in task:
            continue
        path = _normalize_path(task.get("path"))
        parent_id = None
        if path != "/":
            parents = by_full_path.get(path, [])
            if len(parents) == 1:
                parent_id = parents[0]["task_id"]
            elif len(parents) > 1:
                parents = sorted(parents, key=lambda item: item.get("created_at", ""))
                parent_id = parents[0]["task_id"]
                ambiguous.append({
                    "task_id": task["task_id"],
                    "path": path,
                    "chosen_parent_id": parent_id,
                    "candidate_parent_ids": [p["task_id"] for p in parents],
                })
            else:
                unresolved.append({"task_id": task["task_id"], "path": path})
        updates.append({"task": task, "parent_id": parent_id})

    report = {
        "email": email,
        "changed": bool(updates),
        "counts": {
            "tasks_with_path": len(updates),
            "linked_to_parent": sum(1 for update in updates if update["parent_id"]),
            "root_or_unresolved": sum(1 for update in updates if not update["parent_id"]),
            "ambiguous": len(ambiguous),
            "unresolved": len(unresolved),
        },
        "ambiguous": ambiguous,
        "unresolved": unresolved,
    }

    if apply and updates:
        backup_key = f"{backup_root}/{email.replace('@', '_at_')}/tasks.json"
        _put_s3_json(s3, backup_key, tasks)
        for update in updates:
            task = update["task"]
            parent_id = update["parent_id"]
            if parent_id:
                table.update_item(
                    Key={"task_id": task["task_id"]},
                    UpdateExpression="SET parent_id = :pid REMOVE #path",
                    ExpressionAttributeNames={"#path": "path"},
                    ExpressionAttributeValues={":pid": parent_id},
                )
            else:
                table.update_item(
                    Key={"task_id": task["task_id"]},
                    UpdateExpression="REMOVE #path, parent_id",
                    ExpressionAttributeNames={"#path": "path"},
                )

    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="eh")
    parser.add_argument("--email", action="append")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    session = boto3.Session(profile_name=args.profile, region_name=REGION)
    s3 = session.client("s3")
    dynamodb = session.resource("dynamodb")
    table = dynamodb.Table("Tasks")
    emails = args.email or _scan_emails(table)
    timestamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_root = f"backups/task-parent-id-migration/{timestamp}"
    reports = [migrate_user(email, s3, table, backup_root, args.apply) for email in emails]
    print(json.dumps({
        "apply": args.apply,
        "backup_root": backup_root if args.apply else None,
        "users": reports,
    }, indent=2, default=str))


if __name__ == "__main__":
    main()
