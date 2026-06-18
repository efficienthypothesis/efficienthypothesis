# AI Changelog

## 2026-06-18 - Codex (GPT-5)

- Archived the pre-React Efficient Hypothesis code at `archives/efficienthypothesis-legacy-2026-06-18.zip`.
- Rebuilt the authenticated app shell as a Vite + React + TypeScript workspace.
- Added a new S3-backed workspace persistence boundary while preserving existing auth/OAuth/API surfaces.

## 2026-06-18 - Codex (GPT-5) follow-up

- Restored the navbar brand to the existing `/logo.svg` Efficient Hypothesis wordmark.
- Changed editable rows to avoid React rewriting focused `contentEditable` text on each keystroke, fixing reversed/backwards typing.

## 2026-06-18 - Codex (GPT-5) instructions menu

- Added an Instructions item to the profile photo menu.
- Added a simple in-app instructions modal explaining the three editors, macro syntax, examples, editing, tags, and delimiter escaping.
