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
| production | `eh` | `us-east-2` | S3 bucket `eh-app-data` | User data, assets, deploy artifact | App code and `deploy.sh` | Stores workspace JSON, project context JSON, assets, and Lambda zip |
| production | `eh` | `us-east-2` | S3 object `admin/tasks.json` | Private admin task-board content | Authorized task-board updates | Read only after server-side admin session authorization |
| production | `eh` | `us-east-2` | DynamoDB table `Users` | User records | Existing AWS state | Stores user metadata such as timezone |
| production | `eh` | `us-east-2` | DynamoDB tables `Tasks`, `Actions`, `Drafts`, `TimeLogs`, `OAuthTokens` | Legacy cleanup and OAuth support | Existing AWS state | Retained for account deletion and token behavior |
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

## Browser Cache Contract

The workspace client cache in `localStorage` is scoped by authenticated user ID.
Each browser user uses a cache key of the form `eh_workspace_cache_v1:<user_id>`.
The shared legacy key `eh_workspace_cache_v1` is no longer used for reads and is cleared during migration.

## Routing Rules

Documentation-only changes should not deploy unless they change published runtime content.
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
