# AGENTS.md

## Repository Rules

GitHub is the source of truth for Efficient Hypothesis.
AWS is a deployment target, not the canonical copy of the code.
AWS is also the source of truth for user data and deployed runtime state.

Read `ARCHITECTURE.md` before architecture-sensitive changes.
Read `RESOURCE_MAP.md` before touching AWS, deployment, persistence, auth, MCP, or source-to-runtime ownership.
Read `review.md` before finalizing meaningful changes.
Use `TASK_LIST.md` for durable follow-ups and active work.
Use `ADRS/` to understand major decisions, including why the current React/Vite plus Flask/Lambda runtime is intentionally retained.

Before editing, run `git status` and identify the current branch.
If the working tree is clean, pull the latest GitHub changes before starting.
If the working tree is dirty, summarize the existing changes and work with them without reverting user or agent work.

Keep work scoped to the requested change.
Do not commit generated bundles, old exports, local dumps, credentials, or secrets.
Never expose AWS credentials, OAuth client secrets, signing keys, recovery keys, or server-side tokens to browser code.
Prefer backend-owned AWS access through IAM roles, short-lived scoped URLs, or API routes.

## Workflow

This project is in early development, so useful changes should not stay local for long.
After a meaningful code change, run quick practical checks, review the diff, commit, push, and deploy when the change affects deployed app behavior.
Do not wait for broad or slow local test passes unless the user asks for deeper validation or the change is clearly risky.
If quick checks are skipped, say so plainly and explain why.

For runtime changes, use `npm run build`, targeted `npm test`, `python3 -m py_compile`, route smoke checks, or another fast check that covers the changed surface.
Use the existing `.venv` for Flask app imports and local route smoke tests.
System Python may not have Flask installed because Homebrew marks it as externally managed.
Use `review.md` for the A1, A2, and A3 gates after meaningful changes.

Do not manually modify `CHANGELOG.md` files.

## Deployment

Use `bash deploy.sh` for the current AWS Lambda deployment path.
The deployed Lambda currently uses the `python-web-deps` layer for Flask and related web dependencies.
Keep direct AWS edits temporary and copy any durable code or configuration change back into GitHub.

## Project Notes

Projects currently means the Acne, Fitness, and Flexibility surfaces on `projects.efficienthypothesis.com`.
Project global context files live in S3 under `<email>/projects/<project_id>/global-context.json`.
`TASK_LIST.md` is the public repository backlog and must contain only work that is safe to publish.
Private operational tasks and agent notices live in the S3 object `admin/tasks.json` and render only through the admin-authorized `/tasks` route.
Do not copy private task-board content into this public repository.
The AI workflow reference is stack-agnostic.
Do not migrate away from the current React/Vite plus Flask/Lambda runtime unless there is a clear product or operational reason.
