# Resource Map

This file maps source paths to runtime surfaces, AWS resources, deploy targets, and checks.
Keep it current when resources, deployment targets, ownership boundaries, or safe access commands change.

## Source Of Truth

GitHub is the source of truth for code and docs.
AWS is the source of truth for user data, deployment artifacts, and deployed runtime state.

## Source Path Ownership

| Path | Owner | Checks | Deploy Target | Notes |
| --- | --- | --- | --- | --- |
| `src/` | React workspace app | `npm run build`, `npm test` | Lambda bundle through `bash deploy.sh` | Browser source for the main app |
| `index.html`, `vite.config.ts`, `tsconfig*.json`, `package*.json` | Frontend build config | `npm run build`, `npm test` | Lambda bundle through `bash deploy.sh` | Vite build outputs ignored files under `static/react-app/` |
| `templates/` | Flask-rendered pages | Flask behavior tests and route smoke check | Lambda bundle through `bash deploy.sh` | Public, login, app menu, OAuth, and projects pages |
| `static/css/`, `static/js/` | Server-rendered page assets | Manual UI check when behavior changes | Lambda bundle through `bash deploy.sh` | Includes Projects Profile modal code |
| `app.py`, `config.py`, `routes/` | Flask API and backend app | Flask compilation, behavior tests, and route smoke check | Lambda bundle through `bash deploy.sh` | Privileged AWS access stays here |
| `requirements-lambda.txt` | Lambda Python dependencies | Route compile and import smoke check | Lambda bundle through `bash deploy.sh` | Deployment installs these into the zip |
| `deploy.sh` | Deployment packaging | Inspect diff, dry-run mentally, deploy smoke after use | AWS Lambda and deployment artifact | Uses AWS profile `eh` |
| `infra/`, `scripts/deploy-infrastructure.sh` | CloudFormation infrastructure ownership and validation | `scripts/deploy-infrastructure.sh plan` | AWS resource adoption via explicit import change sets | Templates are import-ready; no resource adoption occurs by default |
| `.github/workflows/` | CI | GitHub Actions | None directly | Checks pushes and pull requests |
| `MCP_NOTES.md` | MCP connector docs | Documentation review | None unless MCP code changes | Keep connector URL and tool notes current |
| `ARCHITECTURE.md`, `RESOURCE_MAP.md`, `TASK_LIST.md`, `review.md`, `ADRS/`, `AI_RESOURCES/` | Public AI workflow docs | Documentation review | None | Never store private operational notes in this public repository |
| `static/react-app/`, `dist/`, `node_modules/`, `.venv/`, `__pycache__/` | Generated or local files | Do not commit | None | Ignored local or generated artifacts |

## Deploy Targets

| Target | Purpose | Typical Inputs | Smoke Check |
| --- | --- | --- | --- |
| `docs-only` | Repo workflow and documentation | Markdown docs, ADRs, task lists | No deploy required |
| `frontend` | React source compiled into deployed static assets | `src/`, Vite and TypeScript config, package files | Load `home.efficienthypothesis.com` after deploy when practical |
| `projects-static` | Projects page templates, CSS, and JavaScript | `templates/projects_app.html`, `templates/navbar.html`, `static/css/projects.css`, `static/js/navbar.js` | Load `projects.efficienthypothesis.com` after deploy when practical |
| `api` | Flask routes and persistence behavior | `app.py`, `config.py`, `routes/`, `requirements-lambda.txt` | Call a representative public or authenticated route after deploy |
| `mcp` | ChatGPT connector behavior | `routes/mcp.py`, `routes/oauth.py`, `MCP_NOTES.md` | Check OAuth metadata and `/mcp-v5` behavior after deploy |
| `full` | Shared, unclear, or cross-cutting changes | Build, auth, deployment, or persistence changes | Run `bash deploy.sh` and a targeted production smoke check |

## AWS Resource Inventory

| Environment | Account/Profile | Region | Resource | Owner | Managed By | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| production | `eh` | `us-east-2` | Lambda `efficienthypothesis-backend` | Backend runtime | `deploy.sh` | Flask app packaged as Lambda |
| production | `eh` | `us-east-2` | IAM role `efficienthypothesis-backend-role` | Backend AWS access | Existing AWS state | Inline policy must include app-owned S3 and DynamoDB resources |
| production | `eh` | `us-east-2` | CloudFormation stacks `eh-runtime-data`, `eh-runtime-buckets`, `eh-api-hosting` | Infrastructure ownership | CloudFormation import and updates | Existing resources adopted without replacement |
| production | `eh` | `us-east-2` | S3 bucket `eh-app-data` | User data, assets, deploy artifact | App code and `deploy.sh` | Stores workspace JSON, project context JSON, daily context JSON, assets, and Lambda zip |
| production | `eh` | `us-east-2` | DynamoDB table `Users` | User records | Existing AWS state | Stores user metadata such as timezone |
| production | `eh` | `us-east-2` | DynamoDB tables `Tasks`, `Actions`, `Drafts`, `TimeLogs`, `OAuthTokens` | Legacy cleanup and OAuth support | Existing AWS state | Retained for account deletion and token behavior |
| production | `eh` | `us-east-2` | DynamoDB tables `ProjectDailyContextMetadata`, `ProjectResearchMetadata`, `ProjectInventoryItems` | Project discovery metadata and inventory | CloudFormation and app code | Indexes S3-backed daily context, research documents, and owned or completed inventory |
| production | `eh` | public DNS | `efficienthypothesis.com` | Public, auth, OAuth, app menu | Existing AWS edge/routing state | Primary public host |
| production | `eh` | public DNS | `home.efficienthypothesis.com` | Main workspace app | Existing AWS edge/routing state | Requires session auth |
| production | `eh` | public DNS | `projects.efficienthypothesis.com` | Projects calendar app | Existing AWS edge/routing state | Requires session auth |

## Safe Access Commands

Verify AWS identity:

```bash
AWS_PROFILE=eh aws sts get-caller-identity
```

Inspect Lambda status:

```bash
AWS_PROFILE=eh aws lambda get-function-configuration \
  --function-name efficienthypothesis-backend \
  --region us-east-2 \
  --query '{State:State,LastUpdateStatus:LastUpdateStatus,Updated:LastModified}'
```

Deploy the current committed source state from the repo root:

```bash
bash deploy.sh
```

Run frontend checks:

```bash
npm run build
npm test
```

Run Flask route compilation, behavior tests, and route-map smoke checks locally:

```bash
AWS_EC2_METADATA_DISABLED=true FLASK_SECRET_KEY=test OAUTH_SIGNING_KEY=test \
  .venv/bin/python -m py_compile app.py routes/*.py
```

```bash
AWS_EC2_METADATA_DISABLED=true FLASK_SECRET_KEY=test OAUTH_SIGNING_KEY=test \
  .venv/bin/python -m unittest discover -s tests
```

```bash
AWS_EC2_METADATA_DISABLED=true FLASK_SECRET_KEY=test OAUTH_SIGNING_KEY=test \
  .venv/bin/python - <<'PY'
from app import app

rules = {rule.rule for rule in app.url_map.iter_rules()}
required = {
    "/api/workspace",
    "/api/projects/global-contexts",
    "/api/projects/<project_id>/global-context",
    "/mcp-v5",
}
missing = sorted(required - rules)
if missing:
    raise SystemExit(f"Missing routes: {missing}")
PY
```

## Workspace Read/Write Contract

The browser `/api/workspace` and MCP workspace loader use the same S3-backed read path.
After authorization, read handling follows these rules:

- `NoSuchKey` and equivalent key-missing responses permit first-write bootstrap to initialize a fresh workspace.
- Any other `ClientError`, UTF-8 decode failure, or JSON parse failure returns `workspace_unavailable` (HTTP 503 from browser API) and blocks overwrite or tool operations.

Run `tests/test_workspace_fail_closed.py` when read-error handling or workspace conflict behavior changes.

## Daily Project Context Contract

Project global context is stored privately at `<email>/projects/<project_id>/global-context.json`.
GPT reads and writes project global context through the authenticated MCP tools `get_project_global_context` and `upsert_project_global_context`.
New Acne global context files include editable starter `assessmentFields` for Baumann skin type, Fitzpatrick phototype, genetic scarring tendency, and anatomical pore size and distribution.
They also include `aiGuidance` telling GPT to try to learn those values from the user because they improve recommendation accuracy.
These starter fields are not locked; GPT can overwrite or delete them when replacing the global context file.

Daily project context is stored privately at `<email>/projects/<project_id>/daily-context/<YYYY-MM-DD>.json`.
Daily project context metadata is indexed in DynamoDB table `ProjectDailyContextMetadata` by `userProject` and `date`.
Each document contains `schemaVersion`, `userId`, `projectId`, `date`, `entries`, `createdAt`, and `updatedAt`.
New Acne daily context files also include editable `aiGuidance` and `starterFocusAreas` for physical friction habits, dietary triggers, sleep and cortisol load, and occupational or digital environments.
Those fields are outside `entries`, so they do not count as real user observations.
GPT can remove them by sending `daily_context` through `upsert_daily_context` rather than shorthand `entries`.
Text entries contain `id`, `type: "text"`, `displayName`, optional `time`, `summary`, `createdAt`, and `updatedAt`.
Image entries contain `id`, `type: "image"`, `displayName`, optional `time`, `summary`, `imageUrl`, `contentType`, optional `filename`, `createdAt`, and `updatedAt`.
Legacy or newly submitted entries without a display name receive a positional placeholder during normalization.
Image binaries are stored privately at `<email>/projects/<project_id>/daily-context/<YYYY-MM-DD>/images/<image_id>.<extension>`.
Image uploads accept PNG, JPEG, and WebP content up to 5 MiB after base64 decoding.
Image retrieval goes through the authenticated `/api/projects/<project_id>/daily-context/<YYYY-MM-DD>/images/<image_id>` route.
The Projects calendar shows each daily context entry as a named rectangular link and retains a raw JSON disclosure for each project.
Entry links open an authenticated detail page in a new tab with the summary content and image when applicable.
The Projects calendar loads its initial seven-day window from the server-rendered page, then uses `/api/projects/calendar-day?date=YYYY-MM-DD&window_start=YYYY-MM-DD` to shift by one day without full page reloads.
The browser reuses the six overlapping rendered days, fetches only the newly exposed edge day, caches fetched days in memory, and prefetches the adjacent edge days after each render.
`/api/projects/calendar?start=YYYY-MM-DD` remains available for full-window fallback and browser history restoration.
The left and right navigation controls are enabled only when the next one-day-shifted seven-day window contains daily context entries, daily context images, or recommendations.
GPT accesses text context through the authenticated MCP tools `get_daily_context` and `upsert_daily_context`.
GPT uploads image context through the authenticated MCP tool `add_daily_context_image`.
GPT can discover available dated context through the authenticated MCP tool `list_daily_context_metadata`.
GPT can bulk import daily text context through `bulk_upsert_project_history` with explicit `merge` or `replace` write mode.
Daily context reads and writes are scoped to the authenticated user and validated by project and date.

## Project Research Contract

Project research item details are stored privately at `<email>/projects/<project_id>/research/items/<research_id>.json`.
Project research metadata is indexed in DynamoDB table `ProjectResearchMetadata` by `userProject` and `researchId`.
Research metadata includes `topic`, `status`, `tags`, `relatedTopics`, source metadata, evidence strengths, takeaway previews, timestamps, and the backing S3 key.
The Projects top-nav Research modal reads grouped research metadata through `/api/projects/research-metadata` and can show raw metadata JSON per entry.
Research item files contain `id`, `userId`, `projectId`, `topic`, `status`, `source`, `qualifiedStatements`, `takeaways`, `recommendationImplications`, `tags`, `relatedTopics`, `createdAt`, and `updatedAt`.
Qualified statements must include both `statement` and `qualification`.
Research item statuses are `active`, `superseded`, and `rejected`.
GPT should call `list_project_research` first, then `get_project_research_item` only for relevant full details.
GPT writes research through `upsert_project_research_item`.
GPT can bulk import research through `bulk_upsert_project_history`.

## Project Inventory Contract

Project inventory items are stored in DynamoDB table `ProjectInventoryItems`.
The table key is `userProject` plus `inventoryItemId`, where `userProject` is `<user_id>#<project_id>`.
Inventory items can represent products, medications, supplements, devices, treatments, surgeries, procedures, or other owned or completed assets.
Supported statuses are `available`, `completed`, `unavailable`, and `archived`.
`available` means owned or on-hand.
`completed` means the treatment, surgery, or procedure has happened.
Neither status means the user is actively using the item.
GPT reads inventory through `list_project_inventory` and writes inventory through `upsert_project_inventory_item`.
Archived items are omitted from default inventory lists and recommendation context unless explicitly requested.

## Recommendation Contract

Project recommendation manifests are stored privately at `<email>/projects/<project_id>/recommendations/<YYYY-MM-DD>/manifest.json`.
Individual recommendation files are stored privately at `<email>/projects/<project_id>/recommendations/<YYYY-MM-DD>/files/<recommendation_id>.json`.
Each manifest stores the project/date page `href` and recommendation metadata including `id`, `kind`, `slot`, `title`, `summary`, timestamps, `contentType`, and a backend-generated user-scoped `href`.
Each recommendation file stores `id`, `projectId`, `date`, `kind`, `slot`, `title`, `summary`, `steps`, `createdAt`, and `updatedAt`.
The only currently enabled recommendation kind is `routine`; `workout` is temporarily disabled.
Routine `steps` are ordered objects with `item`, `command`, and optional `clarification`.
Routine `slot` values are `morning`, `night`, and `anytime`.
Each recommendation should describe one project, one calendar date, and one routine slot.
Multi-day plans must be split across separate dated recommendation sets, and same-day skincare routines should usually use separate morning and night items.
The `summary` field should stay short; the actual routine belongs in ordered `steps`.
GPT writes recommendations through `upsert_project_recommendations` and reads them through `get_project_recommendations`.
`upsert_project_recommendations` defaults to merge mode so a new morning or night item does not hide existing items for the same date.
Use `write_mode: "replace"` only when intentionally replacing the whole date manifest.
GPT should use `get_recommendation_context` before generating recommendations because it returns active research metadata, non-archived project inventory, and up to 31 days of prior recommendations.
GPT can bulk import dated recommendation sets through `bulk_upsert_project_history` with explicit `merge` or `replace` write mode.
The weekly Projects calendar always renders each project/date recommendation state as a link to the authenticated recommendation page.
Legacy single-object recommendation files at `<email>/projects/<project_id>/recommendations/<YYYY-MM-DD>.json` are read as a fallback only.

## Browser Cache Contract

The workspace client cache in `localStorage` is scoped by authenticated user ID.
Each browser user uses a cache key of the form `eh_workspace_cache_v1:<user_id>`.
The shared legacy key `eh_workspace_cache_v1` is no longer used for reads and is cleared during migration.

## Routing Rules

Documentation-only changes should not deploy unless they change published runtime content.

Infrastructure adoption is intentionally separate from application deployment.
Run `scripts/deploy-infrastructure.sh plan` to validate templates without changing AWS.
Do not import existing production resources until a reviewed CloudFormation change set confirms no replacement or destructive action.
Frontend source changes should run frontend checks and deploy the Lambda bundle because built assets are served from the Flask package.
Flask route, template, static asset, dependency, or deployment-script changes should run targeted backend checks and deploy the Lambda bundle.
MCP, OAuth, auth, persistence, or workspace schema changes should receive broader review because they affect external clients and stored data.
Unknown, shared, or cross-cutting changes should fall back to the full check and deploy path.

## Secret Safety

Do not put secrets in this file.
Allowed content includes profile names, regions, resource names, safe CLI commands, domains, and non-secret environment variable names.
Forbidden content includes access keys, session tokens, OAuth client secrets, signing keys, passwords, private keys, database credentials, recovery keys, and plaintext secret values.

## Browser Credential Boundary

The browser should never receive AWS credentials.
Browser code may receive public configuration such as public OAuth client IDs, API paths, and public asset URLs.
Backend services should own AWS access through IAM roles or equivalent service identity.
Use API routes or short-lived scoped URLs when browser workflows need AWS-backed file access.
