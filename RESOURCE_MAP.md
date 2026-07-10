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
| `templates/` | Flask-rendered pages | Flask behavior tests and route smoke check | Lambda bundle through `bash deploy.sh` | Public, login, app menu, OAuth, projects, and admin tasks pages |
| `static/css/`, `static/js/` | Server-rendered page assets | Manual UI check when behavior changes | Lambda bundle through `bash deploy.sh` | Includes Projects Profile modal code |
| `app.py`, `config.py`, `routes/` | Flask API and backend app | Flask compilation, behavior tests, and route smoke check | Lambda bundle through `bash deploy.sh` | Privileged AWS access stays here |
| `requirements-lambda.txt` | Lambda Python dependencies | Route compile and import smoke check | Lambda bundle through `bash deploy.sh` | Deployment installs these into the zip |
| `deploy.sh` | Deployment packaging | Inspect diff, dry-run mentally, deploy smoke after use | AWS Lambda and deployment artifact | Uses AWS profile `eh` |
| `infra/`, `scripts/deploy-infrastructure.sh` | CloudFormation infrastructure ownership and validation | `scripts/deploy-infrastructure.sh plan` | AWS resource adoption via explicit import change sets | Templates are import-ready; no resource adoption occurs by default |
| `.github/workflows/` | CI | GitHub Actions | None directly | Checks pushes and pull requests |
| `MCP_NOTES.md` | MCP connector docs | Documentation review | None unless MCP code changes | Keep connector URL and tool notes current |
| `ARCHITECTURE.md`, `RESOURCE_MAP.md`, `TASK_LIST.md`, `review.md`, `ADRS/`, `AI_RESOURCES/` | Public AI workflow docs | Documentation review | None | Never store private admin task content in this public repository |
| `static/react-app/`, `dist/`, `node_modules/`, `.venv/`, `__pycache__/` | Generated or local files | Do not commit | None | Ignored local or generated artifacts |

## Deploy Targets

| Target | Purpose | Typical Inputs | Smoke Check |
| --- | --- | --- | --- |
| `docs-only` | Repo workflow and documentation | Markdown docs, ADRs, task lists | No deploy required |
| `frontend` | React source compiled into deployed static assets | `src/`, Vite and TypeScript config, package files | Load `home.efficienthypothesis.com` after deploy when practical |
| `projects-static` | Projects page templates, CSS, and JavaScript | `templates/projects_app.html`, `templates/navbar.html`, `static/css/projects.css`, `static/js/navbar.js` | Load `projects.efficienthypothesis.com` after deploy when practical |
| `admin-tasks` | Private task-board route, template, styles, and S3-backed task content | `routes/task_dashboard.py`, `routes/pages.py`, `templates/tasks.html`, `static/css/tasks.css`, `s3://eh-app-data/admin/tasks.json` | Verify anonymous denial and authenticated admin rendering at `efficienthypothesis.com/tasks` |
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
| production | `eh` | `us-east-2` | S3 object `admin/tasks.json` | Private admin task-board content | Authorized task-board updates | Read only after server-side admin session authorization |
| production | `eh` | `us-east-2` | DynamoDB table `Users` | User records | Existing AWS state | Stores user metadata such as timezone |
| production | `eh` | `us-east-2` | DynamoDB tables `Tasks`, `Actions`, `Drafts`, `TimeLogs`, `OAuthTokens` | Legacy cleanup and OAuth support | Existing AWS state | Retained for account deletion and token behavior |
| production | `eh` | `us-east-2` | DynamoDB tables `ProjectDailyContextMetadata`, `ProjectResearchMetadata` | Project discovery metadata | CloudFormation and app code | Indexes S3-backed daily context and research documents |
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
    "/tasks",
}
missing = sorted(required - rules)
if missing:
    raise SystemExit(f"Missing routes: {missing}")
PY
```

## Admin Task Board Data Contract

The private task board reads the current JSON object from `s3://eh-app-data/admin/tasks.json` only after the browser session passes the email allowlist in `routes/task_dashboard.py`.
The schema itself is safe to document, but real task content must stay out of GitHub, browser assets, command output, and logs.

```json
{
  "schemaVersion": 1,
  "updatedOn": "2026-07-09",
  "tasks": [
    {
      "id": "example-task",
      "section": "to_do",
      "title": "Example task",
      "summary": "A non-sensitive example of the task summary.",
      "status": "planned",
      "priority": "medium",
      "owner": "Unassigned",
      "updatedOn": "2026-07-09",
      "source": "example",
      "actionRequired": "Optional next action."
    }
  ]
}
```

Payload rules:

- `schemaVersion` must be `1`, `updatedOn` must be a real calendar date in `YYYY-MM-DD` form, and `tasks` must be an array.
- The UTF-8 JSON payload cannot exceed 256 KiB or 200 tasks.
- Every task requires `id`, `section`, `title`, `summary`, `status`, `priority`, `owner`, `updatedOn`, and `source`; `actionRequired` is optional.
- Task IDs must be unique lowercase slugs with at most 80 characters.
- Sections are `working_on`, `to_do`, `tell_neer`, and `done`.
- Sections render in that fixed order, while tasks retain their payload order within each section.
- Statuses are `in_progress`, `planned`, `blocked`, `needs_decision`, `needs_attention`, `info`, and `done`.
- Priorities are `critical`, `high`, `medium`, `low`, and `info`.
- Tasks in `working_on` must use `in_progress`, tasks in `done` must use `done`, and `done` cannot be used outside the `done` section.
- `title` is limited to 200 characters, `summary` to 1,000, `owner` and `source` to 120 each, and `actionRequired` to 500.
- Required string values and a supplied `actionRequired` value must be non-empty.
- Each task `updatedOn` value must also be a real calendar date in `YYYY-MM-DD` form.

The route is read-only.
Before an authorized operational workflow updates the S3 object, validate the candidate payload with `routes.task_dashboard.parse_task_board`.
Run the focused tests in `tests/test_tasks_page.py` after changing the parser or route behavior.
Successful task pages and storage or schema failure responses set `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`.
Storage and schema failures return HTTP 503 without task content or sensitive storage details.

## Workspace Read/Write Contract

The browser `/api/workspace` and MCP workspace loader use the same S3-backed read path.
After authorization, read handling follows these rules:

- `NoSuchKey` and equivalent key-missing responses permit first-write bootstrap to initialize a fresh workspace.
- Any other `ClientError`, UTF-8 decode failure, or JSON parse failure returns `workspace_unavailable` (HTTP 503 from browser API) and blocks overwrite or tool operations.

Run `tests/test_workspace_fail_closed.py` when read-error handling or workspace conflict behavior changes.

## Daily Project Context Contract

Project global context is stored privately at `<email>/projects/<project_id>/global-context.json`.
GPT reads and writes project global context through the authenticated MCP tools `get_project_global_context` and `upsert_project_global_context`.
The Acne global context includes locked `assessmentFields` for Baumann skin type, Fitzpatrick phototype, genetic scarring tendency, and anatomical pore size and distribution.
The backend restores those Acne field definitions if omitted or malformed.
Only field `value`, `reason`, and `updatedAt` values are mutable.

Daily project context is stored privately at `<email>/projects/<project_id>/daily-context/<YYYY-MM-DD>.json`.
Daily project context metadata is indexed in DynamoDB table `ProjectDailyContextMetadata` by `userProject` and `date`.
Each document contains `schemaVersion`, `userId`, `projectId`, `date`, `entries`, `createdAt`, and `updatedAt`.
Text entries contain `id`, `type: "text"`, optional `time`, `summary`, `createdAt`, and `updatedAt`.
Image entries contain `id`, `type: "image"`, optional `time`, `summary`, `imageUrl`, `contentType`, optional `filename`, `createdAt`, and `updatedAt`.
Image binaries are stored privately at `<email>/projects/<project_id>/daily-context/<YYYY-MM-DD>/images/<image_id>.<extension>`.
Image uploads accept PNG, JPEG, and WebP content up to 5 MiB after base64 decoding.
Image retrieval goes through the authenticated `/api/projects/<project_id>/daily-context/<YYYY-MM-DD>/images/<image_id>` route.
The Projects calendar shows each day's entry count, image count, and a raw JSON disclosure for each project.
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

## Recommendation Contract

Project recommendation manifests are stored privately at `<email>/projects/<project_id>/recommendations/<YYYY-MM-DD>/manifest.json`.
Individual recommendation files are stored privately at `<email>/projects/<project_id>/recommendations/<YYYY-MM-DD>/files/<recommendation_id>.json`.
Each manifest stores the project/date page `href` and recommendation metadata including `id`, `kind`, `title`, `summary`, timestamps, `contentType`, and a backend-generated user-scoped `href`.
Each recommendation file stores `id`, `projectId`, `date`, `kind`, `title`, `summary`, `steps`, `createdAt`, and `updatedAt`.
The only currently enabled recommendation kind is `routine`; `workout` is temporarily disabled.
Routine `steps` are ordered objects with `item`, `command`, and optional `clarification`.
GPT writes recommendations through `upsert_project_recommendations` and reads them through `get_project_recommendations`.
GPT should use `get_recommendation_context` before generating recommendations because it returns active research metadata and up to 31 days of prior recommendations.
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
Private task-board payload changes update AWS runtime state and should never be copied into public repository files or logs.
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
