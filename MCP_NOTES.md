# MCP Notes

## Current ChatGPT connector setup

Use the versioned endpoint for ChatGPT Developer Mode:

- MCP server URL: `https://efficienthypothesis.com/mcp-v2`
- Authentication: OAuth
- Registration method: User-defined OAuth client
- Authorization URL: `https://efficienthypothesis.com/oauth/authorize`
- Token URL: `https://efficienthypothesis.com/oauth/token`
- Authorization server base: `https://efficienthypothesis.com`
- Resource: `https://efficienthypothesis.com`
- Token endpoint auth method: `client_secret_post`
- Scope: `full_access`
- OIDC: disabled

`/mcp` is still served, but ChatGPT cached the first tool manifest seen at that
URL during development. Use `/mcp-v2` for the active connector to avoid stale
manifest behavior.

## Current tools

Read/query tools:

- `query_items`
- `list_tasks`
- `list_actions`
- `list_notes`
- `list_folders`
- `list_routines`
- `list_schedules`
- `list_goals`

Non-destructive write tools:

- `create_note`
- `create_task`
- `create_action`
- `complete_task`

No delete tools are currently exposed through MCP.

## Folder identity model

Folders now use stable IDs and parent IDs while preserving legacy path strings
for compatibility during migration:

```json
{
  "id": "fld_...",
  "parent_id": "fld_...",
  "name": "Project",
  "path": "/work/project",
  "color": "#000000"
}
```

Items should use `folder_id` as the stable folder reference. The legacy
`folder` path field is still written and returned so existing frontend code and
older clients continue to work while the migration is in progress.

Folder moves should update the folder `path`/`parent_id`; related items remain
attached by `folder_id`. During the compatibility phase, code should preserve
or refresh the legacy `folder` path where practical.

The migration script is:

```sh
python3 migrate_folder_ids.py --profile eh       # dry run
python3 migrate_folder_ids.py --profile eh --apply
```

`--apply` backs up affected data to:

```text
s3://eh-app-data/backups/folder-id-migration/<timestamp>/
```

## Query guidance

Prefer `query_items` for most reads. It supports server-side item type
selection, filters, text search, sorting, projection, and limits. Use explicit
dates/datetimes in filters rather than relative phrases. For example, convert
"yesterday" to a concrete ISO date range before calling the tool.

Prefer `fields` projection to keep responses small. Use `query_items` to find
exact IDs before calling write/update tools.

## AWS API Gateway auth challenge header

Production smoke testing on 2026-05-25 showed that unauthenticated MCP
`tools/call` requests correctly return HTTP 401, but API Gateway remaps the
standard `WWW-Authenticate` response header to
`x-amzn-remapped-www-authenticate`.

The OAuth discovery metadata endpoints are live and return HTTP 200:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

If ChatGPT Developer Mode has trouble starting OAuth, check whether it requires
the literal `WWW-Authenticate` header on the 401 response. If so, the fix may
need to happen at the API Gateway/CloudFront layer rather than inside Flask.
