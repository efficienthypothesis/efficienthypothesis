import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../services/defaultWorkspace";
import type { EditorDocument } from "../types";
import { getDraftGroup, isContinuationDraftLine } from "../utils/draftGroups";
import {
  canRemoveEditableBlock,
  canRemoveVisiblyBlankEditableBlock,
  findAdjacentEditableBlock,
  findEditableBlockAfterRemoval,
  isCaretImmediatelyAfterClosingMacro,
  makeRawEditDraftBlocks,
  pairMacroCloseOnOpen,
  splitEditableBlockAtSelection
} from "../utils/model";

function documentWithLine(text: string): EditorDocument {
  const workspace = createDefaultWorkspace("user_1");
  const document = workspace.documents.tasks;
  const line = document.blocks[1];
  return {
    ...document,
    blocks: [document.blocks[0], { type: "free_text", id: line.id, text }]
  };
}

describe("editor model", () => {
  it("splits a line at the cursor when Enter is pressed", () => {
    const document = documentWithLine("hello world");
    const result = splitEditableBlockAtSelection(document, 1, 5, 5, "hello world").document;

    expect(result.blocks[1]).toMatchObject({ type: "free_text", text: "hello" });
    expect(result.blocks[2]).toMatchObject({ type: "free_text", text: " world" });
  });

  it("moves all text to the next line when Enter is pressed at the start", () => {
    const document = documentWithLine("hello");
    const result = splitEditableBlockAtSelection(document, 1, 0, 0, "hello").document;

    expect(result.blocks[1]).toMatchObject({ type: "empty" });
    expect(result.blocks[2]).toMatchObject({ type: "free_text", text: "hello" });
  });

  it("removes selected text while splitting the remaining text", () => {
    const document = documentWithLine("abcdef");
    const result = splitEditableBlockAtSelection(document, 1, 1, 4, "abcdef").document;

    expect(result.blocks[1]).toMatchObject({ type: "free_text", text: "a" });
    expect(result.blocks[2]).toMatchObject({ type: "free_text", text: "ef" });
  });

  it("keeps text moved from an open draft macro as draft continuation", () => {
    const workspace = createDefaultWorkspace("user_1");
    const document = {
      ...workspace.documents.websites_subscriptions,
      blocks: [
        workspace.documents.websites_subscriptions.blocks[0],
        {
          type: "draft_item" as const,
          id: "draft_1",
          raw: "<Name; 8, USD, 1, month; Electronics;",
          inferredNodeType: "subscription" as const,
          parseState: "open" as const
        }
      ]
    };
    const result = splitEditableBlockAtSelection(document, 1, 25, 25).document;

    expect(result.blocks[1]).toMatchObject({ type: "draft_item" });
    expect(result.blocks[2]).toMatchObject({ type: "draft_item" });
  });

  it("creates an empty line when splitting at the start of an opening draft line", () => {
    const workspace = createDefaultWorkspace("user_1");
    const document = {
      ...workspace.documents.websites_subscriptions,
      blocks: [
        workspace.documents.websites_subscriptions.blocks[0],
        {
          type: "draft_item" as const,
          id: "draft_1",
          raw: "<Name; 8, USD, 1, month; Electronics;",
          inferredNodeType: "subscription" as const,
          parseState: "open" as const
        }
      ]
    };
    const result = splitEditableBlockAtSelection(document, 1, 0, 0).document;

    expect(result.blocks[1]).toMatchObject({ type: "empty" });
    expect(result.blocks[2]).toMatchObject({ type: "draft_item" });
  });

  it("groups persisted free text continuation lines with their open draft macro", () => {
    const workspace = createDefaultWorkspace("user_1");
    const baseDocument = workspace.documents.websites_subscriptions;
    const document = {
      ...baseDocument,
      blocks: [
        baseDocument.blocks[0],
        baseDocument.blocks[1],
        baseDocument.blocks[2],
        {
          type: "draft_item" as const,
          id: "draft_1",
          raw: "<Verizon Phone Plan Simplicity; 51.27, USD, 1, month;",
          inferredNodeType: "subscription" as const,
          parseState: "open" as const
        },
        { type: "free_text" as const, id: "free_1", text: "Electronics;" },
        { type: "empty" as const, id: "empty_1" }
      ]
    };

    const group = getDraftGroup(document, 4);

    expect(group).toMatchObject({
      startIndex: 3,
      endIndex: 4,
      raw: "<Verizon Phone Plan Simplicity; 51.27, USD, 1, month;\nElectronics;"
    });
    expect(getDraftGroup(document, 3)?.endIndex).toBe(4);
    expect(getDraftGroup(document, 5)).toBeNull();
    expect(isContinuationDraftLine(document, 4)).toBe(true);
  });

  it("reopens raw edit macros using their stored line breaks", () => {
    const blocks = makeRawEditDraftBlocks(
      "<Verizon Phone Plan Simplicity; 51.27, USD, 1, month;\nElectronics;>",
      "saved_1",
      "subscription",
      "sub_1"
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      id: "saved_1",
      raw: "<Verizon Phone Plan Simplicity; 51.27, USD, 1, month;",
      inferredNodeType: "subscription",
      editingNodeId: "sub_1",
      editingNodeType: "subscription"
    });
    expect(blocks[1]).toMatchObject({
      raw: "Electronics;>",
      inferredNodeType: "subscription",
      editingNodeId: "sub_1",
      editingNodeType: "subscription"
    });
  });

  it("pairs unescaped macro open delimiters", () => {
    expect(pairMacroCloseOnOpen("", "<", 1)).toEqual({ text: "<>", caret: 1 });
    expect(pairMacroCloseOnOpen("abc", "abc<", 4)).toEqual({ text: "abc<>", caret: 4 });
    expect(pairMacroCloseOnOpen("\\", "\\<", 2)).toBeNull();
  });

  it("detects a caret immediately after an unescaped macro close delimiter", () => {
    expect(isCaretImmediatelyAfterClosingMacro("<Task>", 6)).toBe(true);
    expect(isCaretImmediatelyAfterClosingMacro("<Task>", 5)).toBe(false);
    expect(isCaretImmediatelyAfterClosingMacro("<Task\\>", 7)).toBe(false);
  });

  it("only removes editable lines when another editable line remains", () => {
    const workspace = createDefaultWorkspace("user_1");
    const tasks = workspace.documents.tasks;
    const oneEditableLine: EditorDocument = {
      ...tasks,
      blocks: [tasks.blocks[0], { type: "empty" as const, id: "empty_1" }]
    };
    const twoEditableLines: EditorDocument = {
      ...tasks,
      blocks: [
        tasks.blocks[0],
        { type: "empty" as const, id: "empty_1" },
        { type: "empty" as const, id: "empty_2" }
      ]
    };

    expect(canRemoveEditableBlock(oneEditableLine, 1)).toBe(false);
    expect(canRemoveEditableBlock(twoEditableLines, 1)).toBe(true);
  });

  it("removes visibly blank editable lines across empty, whitespace, and draft blocks", () => {
    const workspace = createDefaultWorkspace("user_1");
    const tasks = workspace.documents.tasks;
    const document: EditorDocument = {
      ...tasks,
      blocks: [
        tasks.blocks[0],
        { type: "free_text" as const, id: "line_1", text: "   " },
        {
          type: "draft_item" as const,
          id: "line_2",
          raw: "",
          inferredNodeType: "task" as const,
          parseState: "open" as const
        },
        { type: "free_text" as const, id: "line_3", text: "not empty" }
      ]
    };

    expect(canRemoveVisiblyBlankEditableBlock(document, 1)).toBe(true);
    expect(canRemoveVisiblyBlankEditableBlock(document, 2)).toBe(true);
    expect(canRemoveVisiblyBlankEditableBlock(document, 3)).toBe(false);
    expect(canRemoveVisiblyBlankEditableBlock(document, 3, " ")).toBe(true);
  });

  it("finds adjacent editable lines for arrow key focus", () => {
    const workspace = createDefaultWorkspace("user_1");
    const document: EditorDocument = {
      ...workspace.documents.websites_subscriptions,
      blocks: [
        { type: "section" as const, id: "sec_1", label: "Websites", frozen: true },
        { type: "free_text" as const, id: "line_1", text: "abc" },
        { type: "section" as const, id: "sec_2", label: "Subscriptions", frozen: true },
        { type: "empty" as const, id: "line_2" },
        { type: "free_text" as const, id: "line_3", text: "xyz" }
      ]
    };

    expect(findAdjacentEditableBlock(document, 3, -1)).toEqual({ blockId: "line_1", text: "abc" });
    expect(findAdjacentEditableBlock(document, 3, 1)).toEqual({ blockId: "line_3", text: "xyz" });
    expect(findEditableBlockAfterRemoval(document, 3)).toEqual({ blockId: "line_3", text: "xyz" });
  });
});
