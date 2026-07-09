# Agent Workflow

GitHub is the source of truth for this project. AWS is a deployment target, not the canonical copy of the code.

## Fast-Iteration Rule

This project is in early development.
Agents should optimize for fast shared iteration over local-only polish.

After making a meaningful change:

1. Commit and push it to GitHub promptly.
2. If the change affects deployed app behavior, infrastructure, AWS data, or AWS configuration, deploy or apply the corresponding AWS change promptly.
3. Do not leave useful changes only on one laptop.
4. Do not wait on human testing before sharing changes.
5. Run quick practical smoke checks before pushing and deploying when the change affects code, configuration, infrastructure, AWS data, or runtime behavior.
6. Do not delay GitHub or AWS sharing for broad or slow local test passes unless the user explicitly asks for deeper testing or the change is clearly risky.
7. If quick checks are skipped, say so plainly and explain why.

For documentation-only or instruction-only changes, a GitHub push is usually enough.
For code or configuration that changes runtime behavior, assume AWS should be updated too unless there is no deployed AWS surface for that change yet.

Before making code changes, an agent should:

1. Run `git status`.
2. Identify the current branch.
3. Pull the latest GitHub changes if the working tree is clean.
4. Summarize any uncommitted local changes before editing.
5. Avoid overwriting or reverting changes made by another agent unless explicitly instructed.

After making code changes, an agent should:

1. Review `git diff`.
2. Update `AI_CHANGELOG.md` for meaningful LLM-authored changes.
3. Run quick practical checks before pushing and deploying when the change affects code, configuration, infrastructure, AWS data, or runtime behavior.
4. Commit the corresponding code changes to Git with a clear message.
5. Push the commit to GitHub.
6. Deploy or apply the matching AWS change when the change affects deployed app behavior, infrastructure, AWS data, or AWS configuration.
7. Provide a short explanation of:
   - files changed
   - behavior changed
   - quick tests/checks run, or why checks were intentionally skipped
   - any deployment or AWS changes made

If an agent changes code directly on AWS, the same change must be copied back into the GitHub repo as soon as possible. Direct AWS edits should be treated as temporary hotfixes until they are committed and pushed.

Agents should avoid working on overlapping files at the same time. If overlap is necessary, one agent should finish, commit, and push before the next agent starts.

Exploratory local edits do not need to be committed if they are discarded before affecting the app, deployment, AWS, or shared repo state.

Use the repository `.venv` for Flask app imports and local route smoke tests.
System Python may not have Flask installed because Homebrew marks it as externally managed.
