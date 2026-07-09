# Task List

This is the shared working list for agents and humans.
Keep it lightweight.
Use it for active work, follow-ups, and completed architecture or workflow items that future sessions should notice.

## Active

- [ ] Add project global context editing controls.
  Owner: unassigned.
  Status: planned.
  Notes: Storage and display exist for Acne, Fitness, and Flexibility, but the Profile modal does not yet let the user edit fields.

- [ ] Design daily context files for projects.
  Owner: unassigned.
  Status: planned.
  Notes: The intended shape is one dated context file per project day, with entries for time and what the user actually did.

- [ ] Design recommendation block storage and rendering.
  Owner: unassigned.
  Status: planned.
  Notes: Blocks should render on the weekly Projects calendar after the AI has enough global and daily context.

- [ ] Decide whether to add infrastructure-as-code for durable AWS resources.
  Owner: unassigned.
  Status: open question.
  Notes: Current deployment is script-based with existing AWS resources documented in `RESOURCE_MAP.md`.

## Done

- [x] Add S3-backed project global context files for Acne, Fitness, and Flexibility.
- [x] Disable active workspace encryption writes and keep legacy encrypted reads only for migration compatibility.
- [x] Add repo-level agent workflow instructions and CI checks.
- [x] Adopt the current AI workflow reference structure with architecture, resource map, task list, review, ADR, and AI resource docs.
