# Task List

This is the shared public working list for agents and humans.
Keep it lightweight.
Use it for repository work that is safe to publish.

## Active

- [ ] Publish the GPT app and produce the required public demo recording.
  Owner: Neer.
  Status: planned.
  Notes: The OpenAI app submission requires a public demo recording URL.

- [ ] Decide whether to add infrastructure-as-code for durable AWS resources.
  Owner: unassigned.
  Status: done.
  Notes: Existing S3, DynamoDB, and Lambda resources were adopted into CloudFormation stacks without replacement.

- [ ] Decide whether path-routed CI and deploy selectors are worth adding.
  Owner: unassigned.
  Status: open question.
  Notes: Revisit before broad checks become costly enough to justify added workflow complexity.

## Done

- [x] Disable active workspace encryption writes and keep legacy encrypted reads only for migration compatibility.
- [x] Add repo-level agent workflow instructions and CI checks.
- [x] Adopt the current AI workflow reference structure with architecture, resource map, task list, review, ADR, and AI resource docs.
