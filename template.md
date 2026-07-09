# Efficient Hypothesis AI Workflow Template

This file records how this repo applies the reusable AI workflow reference.
The upstream reference is `https://github.com/Neer-Kuchlous/ai-workflow`.
The latest inspected reference commit was `2715a3c Restructure AI workflow template`.

## Source Of Truth

GitHub is the source of truth for code and docs.
AWS is the source of truth for user data, deployment artifacts, and deployed runtime state.

## Adopted Project Files

Efficient Hypothesis uses these workflow files:

```text
AGENTS.md
AGENT_WORKFLOW.md
ARCHITECTURE.md
RESOURCE_MAP.md
TASK_LIST.md
template.md
review.md

ADRS/
  README.md
  0001-keep-react-vite-and-flask-lambda-runtime.md

AI_RESOURCES/
  README.md
  Skills/
  Scripts/
  Templates/
```

## Runtime Stack

The AI workflow reference is stack-agnostic.
It says the exact stack can change and focuses on documenting boundaries, resources, checks, and deployment targets.

This repo currently uses:

- React, TypeScript, and Vite for the main browser app.
- Flask for the backend API and server-rendered pages.
- AWS Lambda through `apig-wsgi` for production runtime.
- S3 and DynamoDB for durable runtime data.

Do not migrate the runtime stack solely because this workflow template was adopted.
Consider a migration only when a product, operational, security, cost, or maintainability reason outweighs the risk of rewriting deployed auth, MCP, persistence, and UI flows.

## Workflow Expectations

Use `ARCHITECTURE.md` before architecture-sensitive changes.
Use `RESOURCE_MAP.md` before touching AWS, deployment, persistence, auth, MCP, or path ownership.
Use `TASK_LIST.md` to understand active work and durable follow-ups.
Use `review.md` for A1, A2, and A3 review gates after meaningful work.
Use `ADRS/` for major decisions that future sessions should understand.
Use `AI_RESOURCES/` for repo-specific repeatable assets when they become useful.

## Customization Notes

The upstream template includes placeholders for monorepos with `apps/web/`, `apps/api/`, `infra/`, and `data/`.
Efficient Hypothesis does not currently use that folder shape.
Its source paths are documented in `RESOURCE_MAP.md` and should stay accurate to the actual repo instead of copying placeholder paths from the reference.
