# Agent Workflow

GitHub is the source of truth for this project. AWS is a deployment target, not the canonical copy of the code.

Before making code changes, an agent should:

1. Run `git status`.
2. Identify the current branch.
3. Pull the latest GitHub changes if the working tree is clean.
4. Summarize any uncommitted local changes before editing.
5. Avoid overwriting or reverting changes made by another agent unless explicitly instructed.

After making code changes, an agent should:

1. Run relevant tests or checks when practical.
2. Review `git diff`.
3. Commit the corresponding code changes to Git with a clear message.
4. Push the commit to GitHub.
5. Provide a short explanation of:
   - files changed
   - behavior changed
   - tests/checks run
   - any deployment or AWS changes made

If an agent changes code directly on AWS, the same change must be copied back into the GitHub repo as soon as possible. Direct AWS edits should be treated as temporary hotfixes until they are committed and pushed.

Agents should avoid working on overlapping files at the same time. If overlap is necessary, one agent should finish, commit, and push before the next agent starts.

Exploratory local edits do not need to be committed if they are discarded before affecting the app, deployment, AWS, or shared repo state.
