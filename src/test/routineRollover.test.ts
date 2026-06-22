import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../services/defaultWorkspace";
import { createOrUpdateNodeFromMacro } from "../services/nodeService";
import { applyRoutineRollover, formatLocalDateKey } from "../services/routineRollover";
import type { SavedNodeBlock, WorkspaceState } from "../types";
import { parseMacro } from "../utils/macroParser";
import { makeSavedBlock } from "../utils/model";

describe("routine rollover", () => {
  it("archives the previous timetable and materializes today's routine", () => {
    let workspace = createDefaultWorkspace("user_1");
    const yesterdayAction = addAction(workspace, "<Wake up; 10:00am; Morning>");
    workspace = placeActionInDocument(yesterdayAction.state, "timetable", yesterdayAction.nodeId);
    const routineAction = addAction(workspace, "<Review plan; 8:00am; Work>");
    workspace = placeActionInDocument(routineAction.state, "routine_monday", routineAction.nodeId);
    workspace = {
      ...workspace,
      dailyTimetable: {
        activeLocalDate: "2026-06-21",
        activeRoutineDocumentKey: "routine_sunday",
        activeTimetableDocumentId: workspace.documents.timetable.id,
        updatedAt: "2026-06-21T12:00:00.000Z"
      }
    };

    const rollover = applyRoutineRollover(workspace, new Date(2026, 5, 22, 9));

    expect(rollover.changed).toBe(true);
    expect(rollover.state.dailyTimetable).toMatchObject({
      activeLocalDate: "2026-06-22",
      activeRoutineDocumentKey: "routine_monday"
    });
    expect(rollover.state.nodes.actions[yesterdayAction.nodeId].archive).toBe(1);

    const timetableSavedBlocks = rollover.state.documents.timetable.blocks.filter(
      (block): block is SavedNodeBlock => block.type === "saved_node"
    );
    expect(timetableSavedBlocks).toHaveLength(1);
    expect(timetableSavedBlocks[0].nodeId).not.toBe(routineAction.nodeId);
    expect(rollover.state.nodes.actions[timetableSavedBlocks[0].nodeId]).toMatchObject({
      name: "Review plan",
      timeLocal: "8:00am",
      archive: 0
    });
  });

  it("does not reroll an already active local date", () => {
    const date = new Date(2026, 5, 22, 9);
    const workspace = {
      ...createDefaultWorkspace("user_1"),
      dailyTimetable: {
        activeLocalDate: formatLocalDateKey(date),
        activeRoutineDocumentKey: "routine_monday" as const,
        activeTimetableDocumentId: "doc_today",
        updatedAt: "2026-06-22T12:00:00.000Z"
      }
    };

    const rollover = applyRoutineRollover(workspace, date);

    expect(rollover.changed).toBe(false);
    expect(rollover.state).toBe(workspace);
  });
});

function addAction(workspace: WorkspaceState, raw: string): { state: WorkspaceState; nodeId: string } {
  const parsed = parseMacro(raw, "action");
  expect(parsed.valid).toBe(true);
  if (!parsed.valid) throw new Error("Invalid test macro");
  return createOrUpdateNodeFromMacro(workspace, parsed);
}

function placeActionInDocument(
  workspace: WorkspaceState,
  documentKey: "timetable" | "routine_monday",
  nodeId: string
): WorkspaceState {
  const document = workspace.documents[documentKey];
  const block = makeSavedBlock("action", nodeId);
  const trailingEmpty = document.blocks[document.blocks.length - 1];
  return {
    ...workspace,
    documents: {
      ...workspace.documents,
      [documentKey]: {
        ...document,
        blocks:
          trailingEmpty?.type === "empty"
            ? [...document.blocks.slice(0, -1), block, trailingEmpty]
            : [...document.blocks, block]
      }
    }
  };
}
