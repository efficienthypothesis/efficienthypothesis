"""
Migration script: Rename 'group' field to 'folder' across all data stores,
and rename groups.json to folders.json with 'groups' key renamed to 'folders'.

Affected stores:
  1. DynamoDB Tasks table — rename 'group' attribute to 'folder'
  2. DynamoDB Drafts table — rename 'group' attribute to 'folder', draft_type 'group' to 'folder'
  3. DynamoDB Actions table — rename 'group' attribute to 'folder'
  4. S3 routine templates (<email>/routines/tasks.json) — rename 'group' key to 'folder'
  5. S3 schedule templates (<email>/schedules/actions.json) — rename 'group' key to 'folder'
  6. S3 notes (<email>/notes.json) — rename 'group' key to 'folder'
  7. S3 groups file (<email>/groups.json) — copy to <email>/folders.json, rename 'groups' key to 'folders'

Safety:
  - Reads before writing; only modifies records that have 'group' set.
  - For DynamoDB: sets 'folder' first, then removes 'group' (no data window where both are missing).
  - For S3: reads full JSON, modifies in memory, writes back atomically.
  - Dry-run mode by default (pass --execute to apply).
  - Prints a summary of all changes.

Usage:
  python migrate_group_to_folder.py           # dry run (shows what would change)
  python migrate_group_to_folder.py --execute # actually applies changes
"""

import boto3
import json
import sys

DRY_RUN = "--execute" not in sys.argv

session = boto3.Session(profile_name="eh", region_name="us-east-2")
dynamodb = session.resource("dynamodb")
s3 = session.client("s3")

TASKS_TABLE = "Tasks"
DRAFTS_TABLE = "Drafts"
ACTIONS_TABLE = "Actions"
BUCKET = "eh-app-data"

tasks_table = dynamodb.Table(TASKS_TABLE)
drafts_table = dynamodb.Table(DRAFTS_TABLE)
actions_table = dynamodb.Table(ACTIONS_TABLE)


def migrate_dynamodb_table(table, table_name, key_field):
    """Migrate 'group' -> 'folder' on a DynamoDB table."""
    print(f"\n{'='*60}")
    print(f"Migrating DynamoDB table: {table_name} (key: {key_field})")
    print(f"{'='*60}")

    items_to_migrate = []
    scan_kwargs = {
        "FilterExpression": "attribute_exists(#grp)",
        "ExpressionAttributeNames": {"#grp": "group"},
    }

    while True:
        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items", []):
            items_to_migrate.append(item)
        if "LastEvaluatedKey" not in resp:
            break
        scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    print(f"  Found {len(items_to_migrate)} items with 'group' attribute")

    migrated = 0
    skipped = 0
    for item in items_to_migrate:
        key_value = item[key_field]
        group_value = item.get("group")

        if "folder" in item:
            print(f"  SKIP {key_field}={key_value} — already has 'folder' field")
            skipped += 1
            continue

        if DRY_RUN:
            print(f"  [DRY RUN] Would migrate {key_field}={key_value}: group={group_value!r} -> folder={group_value!r}")
        else:
            table.update_item(
                Key={key_field: key_value},
                UpdateExpression="SET #fld = :val REMOVE #grp",
                ExpressionAttributeNames={"#fld": "folder", "#grp": "group"},
                ExpressionAttributeValues={":val": group_value},
            )
            print(f"  Migrated {key_field}={key_value}: group={group_value!r} -> folder={group_value!r}")
        migrated += 1

    print(f"  Summary: {migrated} migrated, {skipped} skipped")
    return migrated


def migrate_drafts_type(table, table_name, key_field):
    """Migrate draft_type='group' -> 'folder' on the Drafts table."""
    print(f"\n{'='*60}")
    print(f"Migrating draft_type in DynamoDB table: {table_name}")
    print(f"{'='*60}")

    items_to_migrate = []
    scan_kwargs = {
        "FilterExpression": "draft_type = :gtype",
        "ExpressionAttributeValues": {":gtype": "group"},
    }

    while True:
        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items", []):
            items_to_migrate.append(item)
        if "LastEvaluatedKey" not in resp:
            break
        scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    print(f"  Found {len(items_to_migrate)} drafts with draft_type='group'")

    migrated = 0
    for item in items_to_migrate:
        key_value = item[key_field]
        if DRY_RUN:
            print(f"  [DRY RUN] Would update {key_field}={key_value}: draft_type='group' -> 'folder'")
        else:
            table.update_item(
                Key={key_field: key_value},
                UpdateExpression="SET draft_type = :ftype",
                ExpressionAttributeValues={":ftype": "folder"},
            )
            print(f"  Updated {key_field}={key_value}: draft_type='group' -> 'folder'")
        migrated += 1

    print(f"  Summary: {migrated} updated")
    return migrated


def migrate_s3_json_files(prefix_suffix, file_description):
    """Migrate 'group' -> 'folder' in S3 JSON files matching a pattern."""
    print(f"\n{'='*60}")
    print(f"Migrating S3 files: {file_description}")
    print(f"{'='*60}")

    paginator = s3.get_paginator("list_objects_v2")
    files_found = []

    for page in paginator.paginate(Bucket=BUCKET, Delimiter="/"):
        for prefix in page.get("CommonPrefixes", []):
            user_prefix = prefix["Prefix"]
            target_key = user_prefix + prefix_suffix
            try:
                s3.head_object(Bucket=BUCKET, Key=target_key)
                files_found.append(target_key)
            except Exception:
                pass

    print(f"  Found {len(files_found)} files to check")

    migrated_files = 0
    for key in files_found:
        try:
            obj = s3.get_object(Bucket=BUCKET, Key=key)
            content = json.loads(obj["Body"].read().decode("utf-8"))
        except Exception as e:
            print(f"  ERROR reading {key}: {e}")
            continue

        changed = False

        if isinstance(content, list):
            for item in content:
                if "group" in item:
                    if "folder" not in item:
                        item["folder"] = item.pop("group")
                        changed = True
                    else:
                        del item["group"]
                        changed = True
        elif isinstance(content, dict):
            for list_key in ("notes", "folders", "groups"):
                if list_key in content and isinstance(content[list_key], list):
                    for item in content[list_key]:
                        if "group" in item:
                            if "folder" not in item:
                                item["folder"] = item.pop("group")
                                changed = True
                            else:
                                del item["group"]
                                changed = True

        if changed:
            if DRY_RUN:
                print(f"  [DRY RUN] Would update {key}")
            else:
                s3.put_object(
                    Bucket=BUCKET, Key=key,
                    Body=json.dumps(content, indent=2),
                    ContentType="application/json",
                )
                print(f"  Updated {key}")
            migrated_files += 1

    print(f"  Summary: {migrated_files} files {'would be ' if DRY_RUN else ''}updated")
    return migrated_files


def migrate_groups_json_to_folders_json():
    """Rename groups.json -> folders.json and 'groups' key -> 'folders'."""
    print(f"\n{'='*60}")
    print(f"Migrating S3: groups.json -> folders.json")
    print(f"{'='*60}")

    paginator = s3.get_paginator("list_objects_v2")
    files_found = []

    for page in paginator.paginate(Bucket=BUCKET, Delimiter="/"):
        for prefix in page.get("CommonPrefixes", []):
            user_prefix = prefix["Prefix"]
            target_key = user_prefix + "groups.json"
            try:
                s3.head_object(Bucket=BUCKET, Key=target_key)
                files_found.append((user_prefix, target_key))
            except Exception:
                pass

    print(f"  Found {len(files_found)} groups.json files")

    migrated = 0
    for user_prefix, old_key in files_found:
        new_key = user_prefix + "folders.json"

        try:
            obj = s3.get_object(Bucket=BUCKET, Key=old_key)
            content = json.loads(obj["Body"].read().decode("utf-8"))
        except Exception as e:
            print(f"  ERROR reading {old_key}: {e}")
            continue

        # Rename "groups" key to "folders"
        if "groups" in content:
            content["folders"] = content.pop("groups")

        # Also rename "group" to "folder" in each folder object (if any had it)
        for item in content.get("folders", []):
            if "group" in item and "folder" not in item:
                item["folder"] = item.pop("group")

        if DRY_RUN:
            print(f"  [DRY RUN] Would create {new_key} from {old_key}")
        else:
            # Write new file
            s3.put_object(
                Bucket=BUCKET, Key=new_key,
                Body=json.dumps(content, indent=2),
                ContentType="application/json",
            )
            print(f"  Created {new_key}")
            # Keep old file as backup (don't delete)
            print(f"  Kept {old_key} as backup")
        migrated += 1

    print(f"  Summary: {migrated} files {'would be ' if DRY_RUN else ''}migrated")
    return migrated


def main():
    if DRY_RUN:
        print("*** DRY RUN MODE — no changes will be made ***")
        print("    Run with --execute to apply changes")
    else:
        print("*** EXECUTING MIGRATION — changes will be applied ***")

    total = 0

    # 1. DynamoDB Tasks table
    total += migrate_dynamodb_table(tasks_table, TASKS_TABLE, "task_id")

    # 2. DynamoDB Drafts table (group field)
    total += migrate_dynamodb_table(drafts_table, DRAFTS_TABLE, "draft_id")

    # 3. DynamoDB Drafts table (draft_type)
    total += migrate_drafts_type(drafts_table, DRAFTS_TABLE, "draft_id")

    # 4. DynamoDB Actions table
    total += migrate_dynamodb_table(actions_table, ACTIONS_TABLE, "action_id")

    # 5. S3 routine templates
    total += migrate_s3_json_files("routines/tasks.json", "Routine templates (<email>/routines/tasks.json)")

    # 6. S3 schedule templates
    total += migrate_s3_json_files("schedules/actions.json", "Schedule templates (<email>/schedules/actions.json)")

    # 7. S3 notes
    total += migrate_s3_json_files("notes.json", "Notes (<email>/notes.json)")

    # 8. S3 groups.json -> folders.json
    total += migrate_groups_json_to_folders_json()

    print(f"\n{'='*60}")
    if DRY_RUN:
        print(f"DRY RUN COMPLETE — {total} items would be migrated")
        print("Run with --execute to apply changes")
    else:
        print(f"MIGRATION COMPLETE — {total} items migrated")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
