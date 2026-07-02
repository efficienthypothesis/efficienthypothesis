import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../services/defaultWorkspace";
import {
  TASK_AI_CONTEXT_MAX_LENGTH,
  archiveNode,
  createOrUpdateNodeFromMacro,
  ensureTagDocumentBlocks,
  ensureTaskAIContexts,
  getTaskDatetimeRaw,
  isSavedNodeBlockActive,
  normalizeTaskAIContext,
  removeRetiredRoutineData,
  restoreNode,
  shouldRenderTaskDatetimeRaw,
  taskHasExplicitTime
} from "../services/nodeService";
import { parseMacro } from "../utils/macroParser";
import { formatSubscriptionRateDisplay } from "../utils/subscriptions";

describe("node service", () => {
  it("parses subscription rates from four comma-separated values", () => {
    const parsed = parseMacro("<Gym; 8, USD, 2, weeks; Health>", "subscription");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);
    const subscription = state.nodes.subscriptions[nodeId];

    expect(subscription.rate).toEqual({
      amount: 8,
      currency: "USD",
      intervalCount: 2,
      intervalUnit: "weeks"
    });
  });

  it("keeps symbol currencies and normalizes singular interval units", () => {
    const parsed = parseMacro("<News; 8, $, 1, month; Reading>", "subscription");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);
    const subscription = state.nodes.subscriptions[nodeId];

    expect(subscription.rate).toEqual({
      amount: 8,
      currency: "$",
      intervalCount: 1,
      intervalUnit: "months"
    });
  });

  it("formats subscription rates for compact saved rows", () => {
    expect(
      formatSubscriptionRateDisplay({
        amount: 51.27,
        currency: "USD",
        intervalCount: 1,
        intervalUnit: "months"
      })
    ).toBe("$51.27/month");

    expect(
      formatSubscriptionRateDisplay({
        amount: 8,
        currency: "USD",
        intervalCount: 4,
        intervalUnit: "weeks"
      })
    ).toBe("$8/4 weeks");
  });

  it("tracks whether task dates include an explicit time", () => {
    const dateOnly = parseMacro("<Apple Cash Fix; 7/1/2026; Finance>", "task");
    const timed = parseMacro("<Driving Exam; 6/30/2026 11:20 AM; Personal>", "task");
    expect(dateOnly.valid).toBe(true);
    expect(timed.valid).toBe(true);
    if (!dateOnly.valid || !timed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const dateOnlyState = createOrUpdateNodeFromMacro(workspace, dateOnly);
    const timedState = createOrUpdateNodeFromMacro(dateOnlyState.state, timed);

    expect(dateOnlyState.state.nodes.tasks[dateOnlyState.nodeId].datetimeHasTime).toBe(false);
    expect(timedState.state.nodes.tasks[timedState.nodeId].datetimeHasTime).toBe(true);
  });

  it("initializes task AI_context to null for website-created tasks", () => {
    const parsed = parseMacro("<Apple Cash Fix; 7/1/2026; Finance>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);

    expect(state.nodes.tasks[nodeId].AI_context).toBeNull();
  });

  it("preserves hidden task AI_context when the visible task macro is edited", () => {
    const parsed = parseMacro("<Apple Cash Fix; 7/1/2026; Finance>", "task");
    const edited = parseMacro("<Apple Cash Fix Followup; 7/2/2026; Finance>", "task");
    expect(parsed.valid).toBe(true);
    expect(edited.valid).toBe(true);
    if (!parsed.valid || !edited.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const created = createOrUpdateNodeFromMacro(workspace, parsed);
    const stateWithContext = {
      ...created.state,
      nodes: {
        ...created.state.nodes,
        tasks: {
          ...created.state.nodes.tasks,
          [created.nodeId]: {
            ...created.state.nodes.tasks[created.nodeId],
            AI_context: "GPT should remember the user already contacted Apple support."
          }
        }
      }
    };

    const updated = createOrUpdateNodeFromMacro(stateWithContext, edited, created.nodeId);

    expect(updated.state.nodes.tasks[created.nodeId]).toMatchObject({
      name: "Apple Cash Fix Followup",
      AI_context: "GPT should remember the user already contacted Apple support."
    });
  });

  it("normalizes legacy and oversized task AI_context values", () => {
    const parsed = parseMacro("<Apple Cash Fix; 7/1/2026; Finance>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);
    const legacyState = JSON.parse(JSON.stringify(state)) as typeof state;
    delete (legacyState.nodes.tasks[nodeId] as { AI_context?: string | null }).AI_context;

    expect(ensureTaskAIContexts(legacyState).nodes.tasks[nodeId].AI_context).toBeNull();
    expect(normalizeTaskAIContext(` ${"x".repeat(TASK_AI_CONTEXT_MAX_LENGTH + 10)} `)).toBe(
      "x".repeat(TASK_AI_CONTEXT_MAX_LENGTH)
    );
  });

  it("removes retired routine documents and stored actions from legacy workspaces", () => {
    const workspace = createDefaultWorkspace("user_1");
    const legacyWorkspace = {
      ...workspace,
      documents: {
        ...workspace.documents,
        tasks: {
          ...workspace.documents.tasks,
          blocks: [
            ...workspace.documents.tasks.blocks,
            { type: "saved_node", id: "blk_action", nodeType: "action", nodeId: "action_1" }
          ]
        },
        timetable: {
          ...workspace.documents.tasks,
          key: "timetable",
          blocks: [
            { type: "section", id: "sec_timetable", label: "Timetable", frozen: true },
            { type: "saved_node", id: "blk_action_2", nodeType: "action", nodeId: "action_1" }
          ]
        },
        routine_monday: {
          ...workspace.documents.tasks,
          key: "routine_monday",
          blocks: []
        }
      },
      nodes: {
        ...workspace.nodes,
        actions: {
          action_1: {
            id: "action_1",
            userId: "user_1",
            name: "Legacy action",
            note: null,
            timeLocal: "9:00am",
            tagId: null,
            archive: 0,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
            deletedAt: null
          }
        }
      },
      routineAsset: { id: "routine_1" },
      dailyTimetable: { activeLocalDate: "2026-07-01" }
    } as unknown as typeof workspace;

    const normalized = removeRetiredRoutineData(legacyWorkspace);

    expect("actions" in normalized.nodes).toBe(false);
    expect("timetable" in normalized.documents).toBe(false);
    expect("routine_monday" in normalized.documents).toBe(false);
    expect("routineAsset" in normalized).toBe(false);
    expect("dailyTimetable" in normalized).toBe(false);
    expect(
      normalized.documents.tasks.blocks.some(
        (block) =>
          block.type === "saved_node" &&
          (block as { nodeType?: string }).nodeType === "action"
      )
    ).toBe(false);
  });

  it("stores unsupported task date text for literal display", () => {
    const parsed = parseMacro("<Meet contractor; May 5 2:00 pm; Home>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);
    const task = state.nodes.tasks[nodeId];

    expect(task.datetimeUtc).toBeNull();
    expect(task.datetimeRaw).toBe("May 5 2:00 pm");
    expect(shouldRenderTaskDatetimeRaw(task)).toBe(true);
    expect(getTaskDatetimeRaw(task)).toBe("May 5 2:00 pm");
  });

  it("infers date-only legacy tasks from raw macros", () => {
    const parsed = parseMacro("<Apple Cash Fix; 7/1/2026; Finance>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);
    const legacyTask = {
      ...state.nodes.tasks[nodeId],
      datetimeHasTime: undefined,
      rawMacro: "<Apple Cash Fix; 7/1/2026; Finance>"
    };

    expect(taskHasExplicitTime(legacyTask)).toBe(false);
  });

  it("renders legacy loosely parsed natural-language dates from raw macro text", () => {
    const parsed = parseMacro("<Meet contractor; May 5 2:00 pm; Home>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);
    const legacyTask = {
      ...state.nodes.tasks[nodeId],
      datetimeUtc: new Date(2026, 4, 5, 14, 0, 0, 0).toISOString(),
      datetimeRaw: undefined,
      datetimeHasTime: undefined,
      rawMacro: "<Meet contractor; May 5 2:00 pm; Home>"
    };

    expect(shouldRenderTaskDatetimeRaw(legacyTask)).toBe(true);
    expect(getTaskDatetimeRaw(legacyTask)).toBe("May 5 2:00 pm");
  });

  it("adds auto-created tags to the tags editor document", () => {
    const parsed = parseMacro("<Pay rent; tomorrow 9:00am; Home>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state } = createOrUpdateNodeFromMacro(workspace, parsed);
    const tag = Object.values(state.nodes.tags).find((candidate) => candidate.normalizedName === "home");

    expect(tag).toBeTruthy();
    expect(state.documents.tags.blocks).toContainEqual(
      expect.objectContaining({
        type: "saved_node",
        nodeType: "tag",
        nodeId: tag?.id
      })
    );
    expect(state.documents.tags.blocks[state.documents.tags.blocks.length - 1]).toMatchObject({
      type: "empty"
    });
  });

  it("does not duplicate existing tag rows when the same tag is referenced again", () => {
    const parsedTask = parseMacro("<Pay rent; tomorrow 9:00am; Home>", "task");
    const parsedFollowup = parseMacro("<Call bank; tomorrow 2:00pm; home>", "task");
    expect(parsedTask.valid).toBe(true);
    expect(parsedFollowup.valid).toBe(true);
    if (!parsedTask.valid || !parsedFollowup.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const first = createOrUpdateNodeFromMacro(workspace, parsedTask).state;
    const second = createOrUpdateNodeFromMacro(first, parsedFollowup).state;
    const savedTagBlocks = second.documents.tags.blocks.filter(
      (block) => block.type === "saved_node" && block.nodeType === "tag"
    );

    expect(Object.values(second.nodes.tags)).toHaveLength(1);
    expect(savedTagBlocks).toHaveLength(1);
  });

  it("repairs persisted tag nodes missing from the tags editor document", () => {
    const parsed = parseMacro("<Pay rent; tomorrow 9:00am; Home>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const created = createOrUpdateNodeFromMacro(workspace, parsed).state;
    const staleState = {
      ...created,
      documents: {
        ...created.documents,
        tags: workspace.documents.tags
      }
    };

    const repaired = ensureTagDocumentBlocks(staleState);
    const repairedAgain = ensureTagDocumentBlocks(repaired);
    const savedTagBlocks = repairedAgain.documents.tags.blocks.filter(
      (block) => block.type === "saved_node" && block.nodeType === "tag"
    );

    expect(savedTagBlocks).toHaveLength(1);
  });

  it("marks archived saved blocks inactive until restored", () => {
    const parsed = parseMacro("<Pay rent; tomorrow 9:00am; Home>", "task");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const { state, nodeId } = createOrUpdateNodeFromMacro(workspace, parsed);
    const block = {
      type: "saved_node" as const,
      id: "saved_1",
      nodeType: "task" as const,
      nodeId
    };

    expect(isSavedNodeBlockActive(state, block)).toBe(true);

    const archived = archiveNode(state, "task", nodeId);
    expect(archived.nodes.tasks[nodeId].archive).toBe(1);
    expect(isSavedNodeBlockActive(archived, block)).toBe(false);

    const restored = restoreNode(archived, "task", nodeId);
    expect(restored.nodes.tasks[nodeId].archive).toBe(0);
    expect(isSavedNodeBlockActive(restored, block)).toBe(true);
  });
});
