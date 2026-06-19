import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../services/defaultWorkspace";
import {
  archiveNode,
  createOrUpdateNodeFromMacro,
  ensureTagDocumentBlocks,
  isSavedNodeBlockActive,
  restoreNode
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
    const parsedAction = parseMacro("<Call bank; 2:00pm; home>", "action");
    expect(parsedTask.valid).toBe(true);
    expect(parsedAction.valid).toBe(true);
    if (!parsedTask.valid || !parsedAction.valid) return;

    const workspace = createDefaultWorkspace("user_1");
    const first = createOrUpdateNodeFromMacro(workspace, parsedTask).state;
    const second = createOrUpdateNodeFromMacro(first, parsedAction).state;
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
