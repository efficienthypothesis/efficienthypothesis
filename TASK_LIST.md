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

- [ ] Publish the GPT app and produce the required public demo recording.
  Owner: Neer.
  Status: planned.
  Notes: The OpenAI app submission requires a public demo recording URL.

- [ ] Decide whether to add infrastructure-as-code for durable AWS resources.
  Owner: unassigned.
  Status: in progress.
  Notes: Import-ready CloudFormation templates now describe the existing resources; adoption still requires a reviewed import change set.

- [ ] Decide whether path-routed CI and deploy selectors are worth adding.
  Owner: unassigned.
  Status: open question.
  Notes: Revisit before broad checks become costly enough to justify added workflow complexity.

## Done

- [x] Add private daily project context files, GPT tools, and weekly calendar entry counts with raw JSON views.
- [x] Add project-and-date recommendation storage, GPT tools, and backend-owned calendar links.

- [x] Add S3-backed project global context files for Acne, Fitness, and Flexibility.
- [x] Disable active workspace encryption writes and keep legacy encrypted reads only for migration compatibility.
- [x] Add repo-level agent workflow instructions and CI checks.
- [x] Adopt the current AI workflow reference structure with architecture, resource map, task list, review, ADR, and AI resource docs.
