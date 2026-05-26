#!/usr/bin/env python3
"""Add stable folder IDs and item folder_id references.

Dry-run by default. Use --apply to write changes. Before applying, affected
S3 objects and DynamoDB rows are backed up under:

  s3://eh-app-data/backups/folder-id-migration/<timestamp>/
"""

import argparse
import datetime
import hashlib
import json
from decimal import Decimal

import boto3

REGION = "us-east-2"
BUCKET = "eh-app-data"


def _json_default(value):
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _normalize_path(path):
    path = (path or "").strip()
    if not path:
        return ""
    if not path.startswith("/"):
        path = "/" + path
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return path


def _folder_id(email, path):
    digest = hashlib.sha256(f"{email}|{_normalize_path(path)}".encode("utf-8")).hexdigest()[:16]
    return f"fld_{digest}"


def _parent_path(path):
    parts = [p for p in _normalize_path(path).split("/") if p]
    if len(parts) <= 1:
        return None
    return "/" + "/".join(parts[:-1])


def _folder_name(path):
    parts = [p for p in _normalize_path(path).split("/") if p]
    return parts[-1] if parts else ""


def _scan_table(table, email):
    items = []
    kwargs = {
        "FilterExpression": "#u = :email",
        "ExpressionAttributeNames": {"#u": "user"},
        "ExpressionAttributeValues": {":email": email},
    }
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items


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
        Body=json.dumps(value, indent=2, default=_json_default),
        ContentType="application/json",
    )


def _list_user_emails(s3):
    paginator = s3.get_paginator("list_objects_v2")
    emails = set()
    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/folders.json") and not key.startswith("backups/"):
                emails.add(key[:-len("/folders.json")])
    return sorted(emails)


def _normalize_folders(email, folders):
    path_to_id = {}
    for folder in folders:
        path = _normalize_path(folder.get("path"))
        if path:
            path_to_id[path] = folder.get("id") or _folder_id(email, path)

    normalized = []
    for folder in folders:
        path = _normalize_path(folder.get("path"))
        if not path:
            continue
        parent = _parent_path(path)
        updated = dict(folder)
        updated["path"] = path
        updated["id"] = updated.get("id") or path_to_id[path]
        updated["parent_id"] = (
            updated.get("parent_id")
            or (path_to_id.get(parent) if parent else None)
        )
        updated["name"] = updated.get("name") or _folder_name(path)
        updated["color"] = updated.get("color") or "#000000"
        normalized.append(updated)
    return normalized


def _attach_folder_ids(items, path_to_id):
    changed = False
    for item in items:
        folder = _normalize_path(item.get("folder"))
        if folder and path_to_id.get(folder) and item.get("folder_id") != path_to_id[folder]:
            item["folder"] = folder
            item["folder_id"] = path_to_id[folder]
            changed = True
    return changed


def _backup_json(s3, backup_prefix, label, value):
    _put_s3_json(s3, f"{backup_prefix}/{label}.json", value)


def migrate_user(email, s3, tables, backup_root, apply):
    folders_key = f"{email}/folders.json"
    folders_data = _get_s3_json(s3, folders_key, {"folders": []})
    old_folders = folders_data.get("folders", [])
    new_folders = _normalize_folders(email, old_folders)
    path_to_id = {folder["path"]: folder["id"] for folder in new_folders}

    report = {
        "email": email,
        "folders": len(new_folders),
        "changed": [],
        "counts": {},
    }

    backup_prefix = f"{backup_root}/{email.replace('@', '_at_')}"

    if old_folders != new_folders:
        report["changed"].append("folders")
        report["counts"]["folders"] = len(new_folders)
        folders_data["folders"] = new_folders

    s3_collections = {
        "notes": (f"{email}/notes.json", {"notes": []}, "notes"),
        "routines": (f"{email}/routines/tasks.json", [], None),
        "schedules": (f"{email}/schedules/actions.json", [], None),
    }

    s3_updates = {}
    for label, (key, default, list_field) in s3_collections.items():
        data = _get_s3_json(s3, key, default)
        items = data.get(list_field, []) if list_field else data
        if isinstance(items, list) and _attach_folder_ids(items, path_to_id):
            report["changed"].append(label)
            report["counts"][label] = sum(1 for item in items if item.get("folder_id"))
            s3_updates[label] = (key, data)

    dynamo_updates = {}
    for label, table in tables.items():
        items = _scan_table(table, email)
        changed_items = []
        for item in items:
            original = dict(item)
            if _attach_folder_ids([item], path_to_id):
                changed_items.append(item)
            if original != item:
                pass
        if changed_items:
            report["changed"].append(label)
            report["counts"][label] = len(changed_items)
            dynamo_updates[label] = changed_items

    if apply and report["changed"]:
        _backup_json(s3, backup_prefix, "folders", old_folders)
        for label, (key, data) in s3_updates.items():
            _backup_json(s3, backup_prefix, label, _get_s3_json(s3, key, None))
        for label, items in dynamo_updates.items():
            _backup_json(s3, backup_prefix, label, _scan_table(tables[label], email))

        if "folders" in report["changed"]:
            _put_s3_json(s3, folders_key, folders_data)
        for _label, (key, data) in s3_updates.items():
            _put_s3_json(s3, key, data)
        for label, items in dynamo_updates.items():
            table = tables[label]
            key_name = {
                "tasks": "task_id",
                "actions": "action_id",
                "drafts": "draft_id",
            }[label]
            for item in items:
                table.update_item(
                    Key={key_name: item[key_name]},
                    UpdateExpression="SET folder_id = :fid, folder = :folder",
                    ExpressionAttributeValues={
                        ":fid": item["folder_id"],
                        ":folder": item["folder"],
                    },
                )

    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="eh")
    parser.add_argument("--email", action="append", help="Limit migration to one email. May be repeated.")
    parser.add_argument("--apply", action="store_true", help="Write changes. Without this, performs a dry run.")
    args = parser.parse_args()

    session = boto3.Session(profile_name=args.profile, region_name=REGION)
    s3 = session.client("s3")
    dynamodb = session.resource("dynamodb")
    tables = {
        "tasks": dynamodb.Table("Tasks"),
        "actions": dynamodb.Table("Actions"),
        "drafts": dynamodb.Table("Drafts"),
    }

    emails = sorted(set(args.email or _list_user_emails(s3)))
    timestamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_root = f"backups/folder-id-migration/{timestamp}"

    reports = [migrate_user(email, s3, tables, backup_root, args.apply) for email in emails]
    print(json.dumps({
        "apply": args.apply,
        "backup_root": backup_root if args.apply else None,
        "users": reports,
    }, indent=2, default=_json_default))


if __name__ == "__main__":
    main()
