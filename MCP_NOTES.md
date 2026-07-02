# MCP Notes

## Current ChatGPT Connector Setup

Use the new workspace-native endpoint for the Efficient Hypothesis GPT App:

- MCP server URL: `https://efficienthypothesis.com/mcp-v4`
- Authentication: OAuth
- Registration method: User-defined OAuth client
- Authorization URL: `https://efficienthypothesis.com/oauth/authorize`
- Token URL: `https://efficienthypothesis.com/oauth/token`
- Authorization server base: `https://efficienthypothesis.com`
- Resource: `https://efficienthypothesis.com`
- Token endpoint auth method: `client_secret_post`
- Scope: `full_access`
- OIDC: disabled

OAuth is intentionally unchanged. The `/mcp`, `/mcp-v2`, `/mcp-v3`, and `/mcp-v4`
routes now all serve the new workspace-native tool manifest, but ChatGPT can
cache tool manifests by URL during development. Prefer `/mcp-v4` for the active
connector so the GPT App does not see a stale `/mcp-v2` manifest.

Workspace data is encrypted at rest with a browser-held recovery key. OAuth
authenticates ChatGPT, but MCP tools also require the user to grant ChatGPT
workspace-key access from Efficient Hypothesis Account > Encryption. The grant
lasts 30 days and can be revoked by the user. Without an active grant, MCP tool
calls return a grant-required error.

## Current Tools

Read tools:

- `query_nodes`
- `get_node`

Write tools:

- `create_node`
- `update_node`
- `archive_node`
- `restore_node`

The old DynamoDB/S3 item tools are intentionally retired from MCP:

- `query_items`
- `list_tasks`
- `list_actions`
- `list_notes`
- `list_folders`
- `list_routines`
- `list_schedules`
- `list_goals`
- `create_task`
- `create_action`
- `create_note`
- `complete_task`

## Workspace Model

MCP reads and writes the same S3-backed workspace state used by the React app:

```text
s3://eh-app-data/<email>/workspace/state.json
```

For current workspaces this object is an encrypted envelope. During an active
ChatGPT grant, the MCP server decrypts the envelope, applies the requested node
operation, and writes a new encrypted envelope back to the same key.

Structured data lives in normalized node collections:

- `task`
- `website`
- `subscription`
- `action`
- `tag`
- `location`
- `identity`
- `asset`

Editor layout lives in workspace documents. GPT-created nodes are inserted as
`saved_node` blocks into the correct section automatically:

- `task` -> `tasks` / `Tasks`
- `website` -> `websites_subscriptions` / `Websites`
- `subscription` -> `websites_subscriptions` / `Subscriptions`
- `action` -> `timetable` / `Timetable`
- `tag` -> `tags` / `Tags`
- `location` -> `profile` / `Locations`
- `identity` -> `profile` / `Identities`
- `asset` -> `profile` / `Assets`

Routine weekday templates are managed with `action` nodes in these documents:

- `routine_sunday`
- `routine_monday`
- `routine_tuesday`
- `routine_wednesday`
- `routine_thursday`
- `routine_friday`
- `routine_saturday`

To create a routine template action, call `create_node` with
`node_type: "action"` and the target `document_key`, such as
`routine_monday`.

The browser applies daily timetable rollover after decrypting the workspace. On
the first load/focus for a new local date, active action nodes from the prior
main `timetable` document are archived to level 1, and the current weekday
routine document is cloned into fresh action nodes in the main `timetable`.
The workspace `dailyTimetable` metadata records the active local date so this
does not rerun repeatedly on the same day.

## Mutation Rules

- GPT can create, read, update, archive, and restore structured nodes.
- GPT cannot create, edit, or delete free-text editor rows.
- GPT can read and update task `AI_context`; this field is hidden from the
  website UI and is intended for AI-only task context.
- Task `AI_context` is limited to 6,000 characters.
- `update_node`, `archive_node`, and `restore_node` require exact node IDs.
- Tags are normalized with `trim().toLowerCase()`.
- If a node is created or updated with a missing `tag_name`, MCP auto-creates
  the tag with default color `#D1D5DB` and inserts it into the Tags editor.
- Archiving moves one level deeper: `0 -> 1 -> 2`.
- Restoring moves one level shallower: `2 -> 1 -> 0`.
- MCP does not soft-delete level 2 nodes and cannot restore soft-deleted nodes.
- Existing archived tags can still be referenced by active nodes. The item keeps
  its `tagId`; the response includes `tagArchive` so clients can see that the
  referenced tag is archived.

## Field Guidance

Common fields:

- `name`
- `note`
- `tag_name` for taggable node types

Type-specific fields:

- `task`: `fields.datetime`, `fields.AI_context`
- `subscription`: `fields.rate` with `amount`, `currency`, `intervalCount`,
  and `intervalUnit`
- `website`: `fields.identity_names`
- `action`: `fields.time_local`
- `tag`: `fields.color`
- `location`: `fields.address`
- `identity`: `fields.reference_name`
- `asset`: `fields.reference_location_name`

Example subscription rate:

```json
{
  "amount": 51.27,
  "currency": "USD",
  "intervalCount": 1,
  "intervalUnit": "month"
}
```

The server stores interval units in plural canonical form, such as `months`.

## AWS API Gateway Auth Challenge Header

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
