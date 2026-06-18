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
- Added subscription syntax, rate argument guidance, and a subscription example to the instructions modal.
- Changed macro hints so fields beyond a datatype's structured arguments show `note`, and added tests that extra subscription semicolon fields become note text.
- Updated subscription rate parsing to support `every N weeks/months/etc.` phrasing used in the instructions.

## 2026-06-18 - Codex (GPT-5) hint positioning

- Updated macro field hints so the grey guide text follows the typed draft text instead of overlapping the opening `<` character.
- Reworked macro hints to render inline on the editable line instead of in a sibling overlay, preventing the hint from appearing below the editor row.
- Replaced editable draft rows with controlled single-line inputs plus a same-row visual hint layer, and made Enter always insert a new numbered line.
- Required macro hints to have an actual opening `<` at the start of the line and removed the empty-row spacer that created a second visual line.
