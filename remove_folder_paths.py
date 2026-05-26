"""Remove legacy folder path fields.

Dry run:
  python3 remove_folder_paths.py --profile eh

Apply with backups:
  python3 remove_folder_paths.py --profile eh --apply

Backups are written to:
  s3://eh-app-data/backups/remove-folder-paths/<timestamp>/
"""

import argparse
import datetime
import json

import boto3
from boto3.dynamodb.conditions import Attr


BUCKET = "eh-app-data"
REGION = "us-east-2"


def _get_s3_json(s3, key, default):
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return default


def _put_s3_json(s3, key, value):
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=json.dumps(value, indent=2),
        ContentType="application/json",
    )


def _scan_emails(s3):
    emails = set()
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.startswith("backups/") or not key.endswith("/folders.json"):
                continue
            emails.add(key.split("/", 1)[0])
    return sorted(emails)


def _scan_user_items(table, email):
    items = []
    kwargs = {
        "FilterExpression": Attr("user").eq(email),
    }
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            return items
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def _strip_keys_from_list(items, keys):
    changed = 0
    for item in items:
        had_key = False
        for key in keys:
            if key in item:
                item.pop(key, None)
                had_key = True
        if had_key:
            changed += 1
    return changed


def _backup_json(s3, backup_prefix, label, value):
    _put_s3_json(s3, f"{backup_prefix}/{label}.json", value)


def migrate_user(email, s3, tables, backup_root, apply):
    backup_prefix = f"{backup_root}/{email.replace('@', '_at_')}"
    report = {"email": email, "changed": [], "counts": {}}

    folders_key = f"{email}/folders.json"
    folders_data = _get_s3_json(s3, folders_key, {"folders": []})
    old_folders = json.loads(json.dumps(folders_data.get("folders", [])))
    folder_count = _strip_keys_from_list(folders_data.get("folders", []), ["path"])
    if folder_count:
        report["changed"].append("folders")
        report["counts"]["folders"] = folder_count

    s3_collections = {
        "notes": (f"{email}/notes.json", {"notes": []}, "notes"),
        "routines": (f"{email}/routines/tasks.json", [], None),
        "schedules": (f"{email}/schedules/actions.json", [], None),
    }
    s3_updates = {}
    for label, (key, default, list_field) in s3_collections.items():
        data = _get_s3_json(s3, key, default)
        items = data.get(list_field, []) if list_field else data
        if isinstance(items, list):
            count = _strip_keys_from_list(items, ["folder"])
            if count:
                report["changed"].append(label)
                report["counts"][label] = count
                s3_updates[label] = (key, data)

    dynamo_updates = {}
    for label, table in tables.items():
        items = _scan_user_items(table, email)
        changed_items = [item for item in items if "folder" in item]
        if changed_items:
            report["changed"].append(label)
            report["counts"][label] = len(changed_items)
            dynamo_updates[label] = changed_items

    if apply and report["changed"]:
        if folder_count:
            _backup_json(s3, backup_prefix, "folders", old_folders)
            _put_s3_json(s3, folders_key, folders_data)
        for label, (key, data) in s3_updates.items():
            _backup_json(s3, backup_prefix, label, _get_s3_json(s3, key, None))
            _put_s3_json(s3, key, data)
        for label, items in dynamo_updates.items():
            table = tables[label]
            key_name = {
                "tasks": "task_id",
                "actions": "action_id",
                "drafts": "draft_id",
            }[label]
            _backup_json(s3, backup_prefix, label, _scan_user_items(table, email))
            for item in items:
                table.update_item(
                    Key={key_name: item[key_name]},
                    UpdateExpression="REMOVE #folder",
                    ExpressionAttributeNames={"#folder": "folder"},
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
    tables = {
        "tasks": dynamodb.Table("Tasks"),
        "actions": dynamodb.Table("Actions"),
        "drafts": dynamodb.Table("Drafts"),
    }

    timestamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_root = f"backups/remove-folder-paths/{timestamp}"
    emails = args.email or _scan_emails(s3)
    reports = [migrate_user(email, s3, tables, backup_root, args.apply) for email in emails]
    print(json.dumps({
        "apply": args.apply,
        "backup_root": backup_root if args.apply else None,
        "users": reports,
    }, indent=2))


if __name__ == "__main__":
    main()
