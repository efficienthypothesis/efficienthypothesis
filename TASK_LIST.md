# Task List

This is the shared public working list for agents and humans.
Keep it lightweight.
Use it for repository work that is safe to publish.
Private operational tasks and agent notices live in the S3-backed admin task board.

## Active

- [ ] Deploy and verify the private admin task board.
  Owner: Codex.
  Status: in progress.
  Notes: The page is implemented at `/tasks` with server-side session authorization and private S3-backed content.

- [ ] Design daily context files for projects.
  Owner: unassigned.
  Status: planned.
  Notes: The intended shape is one dated context file per project day, with entries for time and what the user actually did.

- [ ] Design recommendation block storage and rendering.
  Owner: unassigned.
  Status: planned.
  Notes: Blocks should render on the weekly Projects calendar after the AI has enough global and daily context.

- [ ] Publish the GPT app and produce the required public demo recording.
  Owner: Neer.
  Status: planned.
  Notes: The OpenAI app submission requires a public demo recording URL.

- [ ] Confirm the remaining Projects and Goals scope before app submission.
  Owner: Neer.
  Status: needs decision.
  Notes: Clarify the remaining Acne and Fitness functionality after the existing Projects scaffold and context work.

- [ ] Decide whether to add infrastructure-as-code for durable AWS resources.
  Owner: unassigned.
  Status: open question.
  Notes: Current deployment is script-based with existing AWS resources documented in `RESOURCE_MAP.md`.

- [ ] Decide whether path-routed CI and deploy selectors are worth adding.
  Owner: unassigned.
  Status: open question.
  Notes: Revisit before broad checks become costly enough to justify added workflow complexity.

## Done

- [x] Add S3-backed project global context files for Acne, Fitness, and Flexibility.
- [x] Disable active workspace encryption writes and keep legacy encrypted reads only for migration compatibility.
- [x] Add repo-level agent workflow instructions and CI checks.
- [x] Adopt the current AI workflow reference structure with architecture, resource map, task list, review, ADR, and AI resource docs.
