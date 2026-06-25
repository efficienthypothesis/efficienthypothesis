# AI Changelog

## 2026-06-24 - Codex (GPT-5) archive tab scrolling fix

- Codex (GPT-5): fixed the Settings Archive tab layout so archived item lists use a bounded scroll area and long archived task lists can be scrolled inside the modal.

## 2026-06-24 - Codex (GPT-5) grey-blue palette refresh

- Codex (GPT-5): updated only the app and public-page color palette from warm beige/brown tones to a cleaner grey-blue/slate aesthetic while preserving the existing layout, logo, and functionality.

## 2026-06-24 - Codex (GPT-5) legacy route removal

- Codex (GPT-5): removed pre-React Efficient Hypothesis route registrations and legacy route modules for old DynamoDB/S3 tasks, actions, routines, schedules, goals, folders, notes, drafts, timelogs, homescreen, mobile auth, and in-app chatbot APIs.
- Codex (GPT-5): deleted obsolete migration scripts, chatbot prompt, and old architecture reference file that described the pre-workspace implementation.
- Codex (GPT-5): updated public landing copy, OAuth consent copy, and Routine settings status text to describe the current encrypted workspace and MCP v3 model.
- Codex (GPT-5): updated deployment packaging so the Lambda bundle no longer expects the deleted legacy chatbot prompt file.

## 2026-06-22 - Codex (GPT-5) routine timetable rollover

- Codex (GPT-5): added browser-side daily timetable rollover that archives the previous active timetable action nodes and materializes the current weekday routine into fresh timetable action nodes.
- Codex (GPT-5): added daily timetable metadata to new/default workspaces and MCP-normalized workspaces so rollover only happens once per local date.
- Codex (GPT-5): added unit tests for routine rollover archiving and materialization behavior.

## 2026-06-22 - Codex (GPT-5) account modal split

- Codex (GPT-5): moved encryption controls and delete-account controls out of Settings into a separate Account modal opened from the profile menu.
- Codex (GPT-5): updated Instructions, Privacy, Terms, and MCP notes to point recovery-key, ChatGPT-grant, and account-deletion users to the new Account modal.

## 2026-06-22 - Codex (GPT-5) encrypted workspace storage

- Codex (GPT-5): added browser-held AES-GCM workspace encryption, encrypted local cache, recovery-key import/export, and a locked-workspace recovery screen.
- Codex (GPT-5): changed workspace saves to store encrypted envelopes in S3 and migrate existing plaintext workspace state on first browser load.
- Codex (GPT-5): added 30-day browser-session-only ChatGPT workspace-key grants with grant/revoke controls in Settings > Profile.
- Codex (GPT-5): changed MCP workspace tools to require both OAuth and an active ChatGPT key grant, decrypting/encrypting server-side only during that grant.
- Codex (GPT-5): updated deployment packaging to include the Lambda-compatible `cryptography` dependency.
- Codex (GPT-5): updated Privacy, Terms, and Instructions copy to explain recovery keys, encrypted storage, and temporary ChatGPT grants.

## 2026-06-22 - Codex (GPT-5) account deletion and support contact

- Codex (GPT-5): added a browser-session-only account deletion endpoint that deletes the user's S3 data prefix, workspace data, OAuth tokens, user record, chat usage/feedback, and legacy task/action/draft/timelog rows.
- Codex (GPT-5): added a Settings > Profile delete-account danger zone requiring `DELETE <email>` confirmation before irreversible deletion.
- Codex (GPT-5): updated legal page contact links and in-app instructions to use `neerkuchlous+efficienthypothesis@gmail.com` for support.
- Codex (GPT-5): updated Privacy and Terms copy to reflect self-service account deletion from Settings > Profile.

## 2026-06-22 - Codex (GPT-5) public legal pages

- Codex (GPT-5): added public `/privacy` and `/terms` pages for OpenAI app submission, covering OAuth, workspace data, ChatGPT app tool calls, AWS storage, user content, acceptable use, and support contact language.
- Codex (GPT-5): linked Privacy and Terms from the public footer.
- Codex (GPT-5): added `APP_SUBMISSION_TODO.md` to track the pending demo recording URL.

## 2026-06-21 - Codex (GPT-5) task date colors

- Codex (GPT-5): colored valid task date text by local-day urgency: recent past dates green, today orange, future dates red, and dates seven or more days old in the normal text color.
- Codex (GPT-5): limited the color treatment to the date line of saved task rows, leaving task names, tags, note previews, unsupported date text, and time lines unchanged.
- Codex (GPT-5): swapped the past/future task date colors so recent past dates render red and future dates render green.
- Codex (GPT-5): moved the seven-day normal-color cutoff from past dates to future dates, so task dates seven or more days ahead no longer render green.

## 2026-06-21 - Codex (GPT-5) focus sync

- Codex (GPT-5): added focus/visibility workspace refresh so a clean browser tab pulls newer GPT/MCP changes from the server without a manual page reload.
- Codex (GPT-5): added `baseUpdatedAt` conflict protection to workspace saves so stale browser state cannot overwrite newer S3 changes made by GPT or another client.
- Codex (GPT-5): surfaced a `refresh needed` save status when an unsaved local browser edit conflicts with a newer server workspace.

## 2026-06-21 - Codex (GPT-5) workspace MCP

- Codex (GPT-5): replaced the legacy MCP item tools with workspace-native node tools for `query_nodes`, `get_node`, `create_node`, `update_node`, `archive_node`, and `restore_node`.
- Codex (GPT-5): added `/mcp-v3` as the new GPT App endpoint while preserving the existing OAuth authorization and token flow.
- Codex (GPT-5): wired MCP mutations to the current S3 workspace document model so created nodes appear in the correct editor sections, including routine weekday action templates.
- Codex (GPT-5): added MCP tag auto-creation, exact-ID update/archive/restore behavior, archive-level stepping, and documentation for the new GPT connector setup.

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
