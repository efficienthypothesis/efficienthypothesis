# Review

This file defines the review process agents should use after each meaningful slice of progress.
A slice of progress is a small coherent unit of work, such as one bug fix, one feature increment, one refactor step, one docs update, or one deployable change.
Agents should not wait until a large feature is complete before reviewing.

The review process has three gates:

1. A1: Integration Gate.
2. A2: Correctness Gate.
3. A3: Release Readiness Gate.

Each gate must either pass or produce concrete follow-up work.
If a gate fails, investigate the failure, fix the issue when practical, and rerun the relevant gate.
Do not ignore or hand-wave failed checks unless the user explicitly accepts that risk.

## A1: Integration Gate

A1 verifies that the current branch is up to date with the latest main branch and that integration conflicts are resolved.
The goal is to review and test the change against the current codebase, not stale code.

Required steps:

1. Check the current branch and working tree.
2. Fetch the latest remote state.
3. Sync with `main` when working on a branch.
4. Resolve any conflicts.
5. Rerun relevant checks after conflict resolution.

Typical commands:

```bash
git status --short
git branch --show-current
git fetch origin
```

For local agent branches, prefer:

```bash
git rebase origin/main
```

For protected or merge-based workflows, use the repo's normal sync method instead.

## A2: Correctness Gate

A2 verifies that the change is logically correct in a fresh and adversarial review context.
The reviewer should inspect the diff, look for edge cases, and try to find ways the change could fail.

The adversarial review should look for:

- Incorrect logic.
- Missing edge cases.
- Broken user flows.
- Security or privacy issues.
- Browser credential leaks.
- Bad abstractions.
- Incorrect assumptions about AWS, OAuth, MCP, or persisted data.
- Missing tests.
- Regressions in adjacent behavior.
- Poor error handling.
- UI quality issues when applicable.

Run the smallest practical check set that covers the changed surface.

Frontend checks:

```bash
npm run build
npm test
```

Flask compile check:

```bash
AWS_EC2_METADATA_DISABLED=true FLASK_SECRET_KEY=test OAUTH_SIGNING_KEY=test \
  .venv/bin/python -m py_compile app.py routes/*.py
```

Flask behavior tests:

```bash
AWS_EC2_METADATA_DISABLED=true FLASK_SECRET_KEY=test OAUTH_SIGNING_KEY=test \
  .venv/bin/python -m unittest discover -s tests
```

Flask route-map smoke check:

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

Documentation-only checks:

```bash
git diff --check
```

For UI changes, inspect the affected page in a browser when practical.
For auth, MCP, persistence, or deployment changes, prefer a targeted smoke check that exercises the actual user or service path.

Record what was run and whether each command passed.
If a command fails, inspect the failure, fix the cause when practical, and rerun the command.
If the failure is unrelated to the current change, report it clearly and explain why it appears unrelated.

## A3: Release Readiness Gate

A3 verifies that the change is ready for GitHub, CI, and deployment.
It should be broader than style and should consider whether the change fits the system.

The full review should check:

- Architecture fit.
- API compatibility.
- Data model and migration safety.
- Deployment risk.
- Rollback risk.
- Observability.
- Error handling.
- Security and privacy impact.
- Documentation updates.
- User-facing behavior.
- UI quality when applicable.
- Test coverage.

Use GitHub Actions for CI checks after pushing.
Use `gh-axi` when inspecting GitHub runs.

Example command:

```bash
npx -y gh-axi run list --limit 10
```

Deploy when runtime, infrastructure, AWS data, or AWS configuration changed.
Use `bash deploy.sh` for the current Lambda deployment path.
After deployment, verify that the affected public or authenticated surface is alive.

Documentation-only changes usually do not require AWS deployment.

## Failure Handling

Failure handling is part of the review process.
A failed gate is a signal to debug, fix, and verify again.

When any gate fails:

1. Identify the failing command, review finding, conflict, or CI/CD check.
2. Inspect the relevant code, logs, test output, or diff.
3. Determine whether the failure is caused by the current change.
4. Fix the issue when practical.
5. Rerun the smallest relevant check that proves the issue is fixed.
6. Rerun broader checks if the fix touches shared behavior or high-risk code.
7. Record what failed, what changed, and what passed afterward.

If the issue cannot be fixed in the current turn, explain the blocker clearly.
Include the failing command or check, the observed error, the likely cause, and the next action needed.

## Review Evidence

Every completed review should leave a short evidence trail.
The evidence can live in a final agent message, pull request comment, or task update.

Recommended format:

```md
## Review Evidence

A1 Integration Gate:
- Synced with main: yes
- Conflicts: none

A2 Correctness Gate:
- Adversarial review: completed
- Frontend checks: passed or not applicable
- Flask checks: passed or not applicable
- Documentation checks: passed or not applicable

A3 Release Readiness Gate:
- CI/CD checks: passed, pending, or not run
- Deployment: completed or not required
- Smoke check: passed or not required

Notes:
- No known remaining review risks.
```
