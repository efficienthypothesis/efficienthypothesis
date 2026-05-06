"""
Migration script: Rename 'tags' field to 'group' across all data stores.

Affected stores:
  1. DynamoDB Tasks table — rename 'tags' attribute to 'group'
  2. DynamoDB Drafts table — rename 'tags' attribute to 'group'
  3. S3 routine templates (<email>/routines/tasks.json) — rename 'tags' key to 'group'
  4. S3 notes (<email>/notes.json) — rename 'tags' key to 'group'

Safety:
  - Reads before writing; only modifies records that have 'tags' set.
  - For DynamoDB: sets 'group' first, then removes 'tags' (no data window where both are missing).
  - For S3: reads full JSON, modifies in memory, writes back atomically.
  - Dry-run mode by default (set DRY_RUN=False or pass --execute to apply).
  - Prints a summary of all changes.

Usage:
  python migrate_tags_to_group.py           # dry run (shows what would change)
  python migrate_tags_to_group.py --execute # actually applies changes
"""

import boto3
import json
import sys

DRY_RUN = "--execute" not in sys.argv

dynamodb = boto3.resource("dynamodb", region_name="us-east-2")
s3 = boto3.client("s3", region_name="us-east-2")

TASKS_TABLE = "Tasks"
DRAFTS_TABLE = "Drafts"
BUCKET = "efficienthypothesis.com"

tasks_table = dynamodb.Table(TASKS_TABLE)
drafts_table = dynamodb.Table(DRAFTS_TABLE)


def migrate_dynamodb_table(table, table_name, key_field):
    """Migrate 'tags' -> 'group' on a DynamoDB table."""
    print(f"\n{'='*60}")
    print(f"Migrating DynamoDB table: {table_name} (key: {key_field})")
    print(f"{'='*60}")

    # Scan for items that have 'tags' attribute
    items_to_migrate = []
    scan_kwargs = {
        "FilterExpression": "attribute_exists(tags)",
    }

    while True:
        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items", []):
            items_to_migrate.append(item)
        if "LastEvaluatedKey" not in resp:
            break
        scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    print(f"  Found {len(items_to_migrate)} items with 'tags' attribute")

    migrated = 0
    skipped = 0
    for item in items_to_migrate:
        key_value = item[key_field]
        tags_value = item.get("tags")

        # Skip if 'group' already exists (already migrated)
        if "group" in item:
            print(f"  SKIP {key_field}={key_value} — already has 'group' field")
            skipped += 1
            continue

        if DRY_RUN:
            print(f"  [DRY RUN] Would migrate {key_field}={key_value}: tags={tags_value!r} -> group={tags_value!r}")
        else:
            # Set 'group' to the value of 'tags', then remove 'tags'
            table.update_item(
                Key={key_field: key_value},
                UpdateExpression="SET #grp = :val REMOVE tags",
                ExpressionAttributeNames={"#grp": "group"},
                ExpressionAttributeValues={":val": tags_value},
            )
            print(f"  Migrated {key_field}={key_value}: tags={tags_value!r} -> group={tags_value!r}")
        migrated += 1

    print(f"  Summary: {migrated} migrated, {skipped} skipped")
    return migrated


def migrate_s3_json_files(prefix_suffix, file_description):
    """Migrate 'tags' -> 'group' in S3 JSON files matching a pattern."""
    print(f"\n{'='*60}")
    print(f"Migrating S3 files: {file_description}")
    print(f"{'='*60}")

    # List all user prefixes (emails)
    paginator = s3.get_paginator("list_objects_v2")
    files_found = []

    # List all objects and filter by suffix
    for page in paginator.paginate(Bucket=BUCKET, Delimiter="/"):
        for prefix in page.get("CommonPrefixes", []):
            user_prefix = prefix["Prefix"]  # e.g. "user@email.com/"
            target_key = user_prefix + prefix_suffix
            # Check if this file exists
            try:
                s3.head_object(Bucket=BUCKET, Key=target_key)
                files_found.append(target_key)
            except s3.exceptions.ClientError:
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

        # Determine structure: could be a list (routines) or dict with key (notes)
        changed = False

        if isinstance(content, list):
            # Routine templates: list of objects
            for item in content:
                if "tags" in item:
                    if "group" not in item:
                        item["group"] = item.pop("tags")
                        changed = True
                    else:
                        # Already has 'group', just remove stale 'tags'
                        del item["tags"]
                        changed = True
        elif isinstance(content, dict):
            # Notes: {"notes": [...]} or groups: {"groups": [...]}
            for list_key in ("notes", "groups"):
                if list_key in content and isinstance(content[list_key], list):
                    for item in content[list_key]:
                        if "tags" in item:
                            if "group" not in item:
                                item["group"] = item.pop("tags")
                                changed = True
                            else:
                                del item["tags"]
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


def main():
    if DRY_RUN:
        print("*** DRY RUN MODE — no changes will be made ***")
        print("    Run with --execute to apply changes")
    else:
        print("*** EXECUTING MIGRATION — changes will be applied ***")

    total = 0

    # 1. DynamoDB Tasks table
    total += migrate_dynamodb_table(tasks_table, TASKS_TABLE, "task_id")

    # 2. DynamoDB Drafts table
    total += migrate_dynamodb_table(drafts_table, DRAFTS_TABLE, "draft_id")

    # 3. S3 routine templates
    total += migrate_s3_json_files("routines/tasks.json", "Routine templates (<email>/routines/tasks.json)")

    # 4. S3 notes
    total += migrate_s3_json_files("notes.json", "Notes (<email>/notes.json)")

    print(f"\n{'='*60}")
    if DRY_RUN:
        print(f"DRY RUN COMPLETE — {total} items would be migrated")
        print("Run with --execute to apply changes")
    else:
        print(f"MIGRATION COMPLETE — {total} items migrated")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
