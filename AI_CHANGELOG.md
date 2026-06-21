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
- Replaced phrase-based subscription rate parsing with a four-value comma format: amount, currency, interval count, interval unit.
- Preserved symbol currencies such as `$` while normalizing three-letter currency codes to uppercase.

## 2026-06-18 - Codex (GPT-5) hint positioning

- Updated macro field hints so the grey guide text follows the typed draft text instead of overlapping the opening `<` character.
- Reworked macro hints to render inline on the editable line instead of in a sibling overlay, preventing the hint from appearing below the editor row.
- Replaced editable draft rows with controlled single-line inputs plus a same-row visual hint layer, and made Enter always insert a new numbered line.
- Required macro hints to have an actual opening `<` at the start of the line and removed the empty-row spacer that created a second visual line.
- Changed Enter handling to split the current editable line at the cursor, moving text to the right of the cursor onto the next numbered line.
- Focuses the new split line at the start of the moved text.
- Treats contiguous draft lines from one opening `<` as one macro for hints/finalization, so split subscription fields still guide to `note` after the tag.
- Updated macro parsing so structured fields can continue across draft line splits before becoming note text.
- Codex (GPT-5): moved draft macro grouping into a tested utility and included persisted non-empty free-text continuation rows in open draft groups, fixing stale split subscriptions where the tag line was not recognized as part of the same macro.
- Codex (GPT-5): changed saved-row raw edit reopening to split stored multi-line macros back into multiple draft rows, preserving the user's prior line breaks while keeping edits attached to the existing node.
- Codex (GPT-5): removed the visible `A:`, `B:`, and `C:` prefixes from formatted saved rows so saved items display only their values in aligned columns.
- Codex (GPT-5): formatted saved subscription rates as compact billing strings, hardcoding `USD` to `$` and omitting interval count `1` from displays such as `$51.27/month`.
- Codex (GPT-5): changed macro entry so typing an unescaped `<` inserts the paired `>` automatically, and changed macro finalization to happen only when Enter is pressed with the caret immediately after the closing `>`.
- Codex (GPT-5): fixed editor keyboard navigation by making Delete/Backspace remove empty editable lines only when another editable line remains, and by making ArrowUp/ArrowDown move focus to adjacent editable rows.
- Codex (GPT-5): fixed auto-created tags so resolving a missing tag for an item also inserts a saved tag row into the Tags editor document without duplicating existing tag rows.
- Codex (GPT-5): added workspace-load reconciliation so tag nodes created before the auto-created tag row fix are inserted into the Tags editor document on server or local-cache load.
- Codex (GPT-5): fixed archive button behavior by hiding archived/deleted saved-node rows from active editor panels while preserving document placement for restore.
- Codex (GPT-5): broadened empty-line deletion so Delete/Backspace removes any visibly blank editable row, including whitespace-only free text and blank draft rows, while preserving at least one editable line.
- Codex (GPT-5): changed the profile menu from hover-open to click-toggle with outside-click and Escape close behavior.
- Codex (GPT-5): rendered semicolon- or newline-separated item notes as individual preview lines under saved rows.
- Codex (GPT-5): removed invented default task times by tracking explicit task datetime input and rendering date-only tasks without a time, including legacy raw-macro tasks.
- Codex (GPT-5): changed task date rendering to omit the year, place explicit times on a second line after a comma, and render unsupported date text literally instead of loosely parsing it.
- Codex (GPT-5): rendered comma-separated saved-row names as separate name-column lines without showing commas while preserving stored names and raw macros.
