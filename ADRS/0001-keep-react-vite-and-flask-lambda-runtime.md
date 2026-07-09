# 0001: Keep React/Vite And Flask/Lambda Runtime

## Status

Accepted on 2026-07-09.

## Decision

Keep the current React/Vite frontend and Flask/Lambda backend while adopting the AI workflow repo structure.
Do not repackage Efficient Hypothesis into another language, backend, or frontend architecture solely because the AI workflow template was adopted.

## Context

The user asked whether the AI workflow folder recommends Flask or another architecture.
The inspected upstream reference at `https://github.com/Neer-Kuchlous/ai-workflow` is stack-agnostic.
It says the exact stack can change and focuses on durable repo instructions, architecture docs, resource maps, task lists, review gates, and safe AWS boundaries.

The local `firstmate/data/adopt-ai-workflow-f4/brief.md` also says not to refactor React/API runtime architecture just because the task says refactor.
It says runtime changes should happen only when necessary to make the workflow refactor coherent.

Efficient Hypothesis already has a deployed runtime path:

- React, TypeScript, and Vite for the main browser app.
- Flask routes and templates for backend APIs and server-rendered pages.
- AWS Lambda via `apig-wsgi` for production.
- S3 and DynamoDB for durable data.

## Alternatives Considered

Rewrite the backend to TypeScript and Express.
This would align with the Green Business Solution architecture but would rewrite working auth, OAuth, MCP, S3 persistence, and Lambda packaging without a clear product need.

Migrate the backend to FastAPI.
This would keep Python but still require retesting auth, templates, MCP, packaging, and deployment behavior.
The AI workflow reference does not recommend FastAPI.

Move to a full Next.js application.
This could unify frontend and backend routes but would replace the current Flask templates, OAuth flow, MCP route implementation, and Lambda deployment path.
The AI workflow reference does not recommend Next.js.

## Consequences

Workflow docs can be improved without changing runtime behavior.
Future migrations remain possible, but they should be justified by concrete product or operational needs.
The current stack must be documented clearly so agents do not import placeholder architecture from unrelated repos.

## Follow-Up Work

- Keep `ARCHITECTURE.md` and `RESOURCE_MAP.md` current when runtime boundaries change.
- Add infrastructure-as-code if durable AWS resources become too complex for script-based deployment notes.
- Revisit backend architecture only if product requirements, scaling, security, or maintainability make a migration worthwhile.
