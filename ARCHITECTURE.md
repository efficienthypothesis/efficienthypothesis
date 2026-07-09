# Architecture

This file summarizes the major architecture of Efficient Hypothesis.
Keep it practical so future agents can understand system boundaries before editing code.

Detailed companion docs:

- `RESOURCE_MAP.md`
- `MCP_NOTES.md`
- `AGENT_WORKFLOW.md`
- `review.md`

## System Overview

Efficient Hypothesis is a personal productivity app with browser, OAuth, and MCP surfaces.
The main workspace runs at `home.efficienthypothesis.com`.
The projects calendar runs at `projects.efficienthypothesis.com`.
The public marketing, login, OAuth, legal, and app-selection pages run from `efficienthypothesis.com`.
The private admin task board runs at `efficienthypothesis.com/tasks` and is restricted by the verified browser-session email allowlist in `routes/task_dashboard.py`, which currently contains only `neerkuchlous@gmail.com`.
Email matching trims surrounding whitespace and ignores case while still requiring the exact allowlisted address.
Its Apps entry is rendered only for allowlisted sessions, and direct requests from other authenticated users receive HTTP 403.
OAuth bearer credentials do not grant access to this browser-session surface.
Requests for `/tasks` on another app host redirect to the primary host before task data is loaded.

The browser app is built with React, TypeScript, and Vite from `src/`.
The backend is a Flask application in `app.py` and `routes/`.
Production packages the Flask app, server-rendered templates, static files, and Vite build output into an AWS Lambda deployment bundle.
AWS owns durable runtime data.

The AI workflow reference does not prescribe a runtime stack.
This repo keeps the current React/Vite plus Flask/Lambda architecture until there is a product or operational reason to migrate it.

## Major Components

| Component | Purpose | Owner Path | Runtime Surface |
| --- | --- | --- | --- |
| React workspace app | Main authenticated editor UI | `src/`, `index.html`, `vite.config.ts` | Browser assets under `static/react-app/` after build |
| Server-rendered pages | Public pages, login, app menu, projects calendar shell | `templates/`, `static/css/`, `static/js/`, `routes/pages.py` | Flask templates and static files |
| Admin task board | Private work queue and agent notices sourced from S3 | `routes/task_dashboard.py`, `templates/tasks.html`, `static/css/tasks.css` | Admin-only `/tasks` on the primary host |
| Flask API | Authenticated API routes and privileged operations | `app.py`, `routes/`, `config.py` | AWS Lambda through `apig-wsgi` |
| OAuth and MCP | ChatGPT connector authorization and workspace tool calls | `routes/oauth.py`, `routes/mcp.py`, `MCP_NOTES.md` | OAuth routes and `/mcp-v5` |
| Workspace persistence | S3-backed workspace state and conflict handling | `routes/workspace.py`, `src/services/workspaceService.ts` | `s3://eh-app-data/<email>/workspace/state.json` |
| Project context persistence | S3-backed project global context files | `routes/projects.py`, `static/js/navbar.js`, `static/css/projects.css` | `s3://eh-app-data/<email>/projects/<project_id>/global-context.json` |
| Deployment and CI | Build, package, Lambda update, and GitHub checks | `deploy.sh`, `.github/workflows/ci.yml`, `requirements-lambda.txt` | GitHub Actions and AWS Lambda |

## Frontend Boundary

The React source lives in `src/`.
Vite builds it into `static/react-app/`, which is ignored by Git and regenerated during deployment.
The React app receives public bootstrap data through `window.__EH_BOOTSTRAP__`.
It calls Flask routes under `/api/*` and uses browser sessions for authenticated website traffic.

The projects surface currently uses Flask-rendered HTML plus static JavaScript and CSS.
The top-nav Profile modal reads project global contexts from `/api/projects/global-contexts`.
It does not yet include an editing UI for those context files.

Browser code is untrusted.
It must not receive AWS credentials, OAuth client secrets, signing keys, database credentials, private keys, recovery keys, or plaintext server-side secrets.
When browser code needs AWS-backed data, it should go through Flask API routes or narrowly scoped URLs created by the backend.

## Backend Boundary

The Flask application is created in `app.py`.
Routes are split into blueprints under `routes/`.
`config.py` owns AWS clients, OAuth token helpers, and the shared authentication helper.

Local Flask imports and route smoke tests should use `.venv`.
System Python may not have Flask installed because Homebrew marks the global Python environment as externally managed.

Production runs the Flask app as Lambda through `apig-wsgi`.
The deployed environment must provide `FLASK_SECRET_KEY` and `OAUTH_SIGNING_KEY`.
`GOOGLE_CLIENT_ID` is public configuration and may use the default value in `config.py`.

The backend owns:

- Google sign-in and session handling.
- OAuth authorization-code and bearer-token validation for MCP.
- S3 reads and writes for workspace state and project context files, plus private admin task-board reads.
- S3 workspace reads are fail-closed for browser and MCP surfaces: confirmed missing objects still allow first-write bootstrap, while non-missing read failures return temporary-unavailable and do not fabricate or overwrite state.
- Browser-side plaintext workspace cache keys are scoped to the authenticated user ID.
- The legacy shared plaintext cache key is removed and treated as stale storage during migration.
- DynamoDB user records and legacy cleanup tables.
- Server-rendered pages and static asset responses for logo and favicon.
- API validation, conflict handling, and user ownership checks.

## Data Boundary

Durable runtime data lives in AWS.
GitHub is the source of truth for code and docs.
AWS is the source of truth for user data and deployed runtime state.
The admin task board reads its private structured task payload from `s3://eh-app-data/admin/tasks.json` after server-side session authorization.
The payload uses an explicit `schemaVersion` and is validated before rendering; invalid, unavailable, or oversized payloads produce a private, non-indexable HTTP 503 response without logging task content.
`RESOURCE_MAP.md` documents the accepted payload contract.

Current S3 data includes:

- `s3://eh-app-data/admin/tasks.json`
- `s3://eh-app-data/<email>/workspace/state.json`
- `s3://eh-app-data/<email>/projects/acne/global-context.json`
- `s3://eh-app-data/<email>/projects/fitness/global-context.json`
- `s3://eh-app-data/<email>/projects/flexibility/global-context.json`
- `s3://eh-app-data/assets/circle_favicon.svg`
- `s3://eh-app-data/assets/efficienthypothesis.svg`
- `s3://eh-app-data/deploy/efficienthypothesis-build.zip`

Current workspace writes store plaintext JSON.
Browser-side workspace caches store plaintext state under user-scoped keys.
The legacy shared plaintext cache key is removed and scrubbed when the authenticated user changes.
Legacy encrypted workspace envelopes are retained only for migration compatibility.
New encrypted workspace writes are rejected.

DynamoDB currently owns user records in `Users`.
Legacy tables such as `Tasks`, `Actions`, `Drafts`, `TimeLogs`, and `OAuthTokens` remain referenced for OAuth and account deletion cleanup.

## Infrastructure Boundary

The current deployment path is script-based rather than full infrastructure-as-code.
`deploy.sh` runs `npm run build`, installs Lambda Python dependencies from `requirements-lambda.txt`, builds a zip in `/tmp`, uploads it to S3, and updates the `efficienthypothesis-backend` Lambda in `us-east-2`.

Durable infrastructure changes should be documented in `RESOURCE_MAP.md`.
Manual AWS changes should be copied back into GitHub documentation or code as soon as practical.
If infrastructure grows, prefer adding infrastructure-as-code rather than relying on console-only state.

## Deployment Shape

Use `bash deploy.sh` for runtime changes that affect the deployed app.
The script uses AWS profile `eh`, region `us-east-2`, bucket `eh-app-data`, key `deploy/efficienthypothesis-build.zip`, and Lambda function `efficienthypothesis-backend`.

GitHub Actions currently runs two jobs on pushes to `main` and pull requests:

- Frontend build and Vitest tests.
- Flask route compilation, behavior tests, and route-map smoke checks.

Documentation-only changes do not require AWS deployment.
Frontend, Flask, template, static, MCP, persistence, auth, or deploy-script changes should be deployed after quick checks unless the user asks for local-only work.

## Open Questions

Public product work, architecture questions, and decisions are tracked in `TASK_LIST.md`.
Private operational tasks and agent notices are tracked separately in the S3-backed admin task board.
