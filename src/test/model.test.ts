import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../services/defaultWorkspace";
import type { EditorDocument } from "../types";
import { splitEditableBlockAtSelection } from "../utils/model";

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
});
