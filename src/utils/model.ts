import type {
  DraftItemBlock,
  EditorBlock,
  EditorDocument,
  EmptyLineBlock,
  FreeTextBlock,
  NodeType,
  SavedNodeBlock,
  WorkspaceState
} from "../types";
import { inferNodeTypeFromSection } from "./macroParser";
import { makeId } from "./ids";

export function makeEmptyBlock(): EditorBlock {
  return { type: "empty", id: makeId("blk") };
}

export function getNodeTypeForBlock(document: EditorDocument, blockIndex: number): NodeType {
  for (let index = blockIndex; index >= 0; index -= 1) {
    const block = document.blocks[index];
    if (block?.type === "section") return inferNodeTypeFromSection(block.label);
  }
  return "task";
}

export function getEditableBlockText(block: EditorBlock): string {
  if (block.type === "free_text") return block.text;
  if (block.type === "draft_item") return block.raw;
  return "";
}

export function makeEditableBlockFromText(
  text: string,
  id: string,
  inferredNodeType: NodeType,
  sourceBlock?: EditorBlock,
  forceDraft = false
): EmptyLineBlock | FreeTextBlock | DraftItemBlock {
  if (!text && !forceDraft) return { type: "empty", id };
  if (forceDraft || text.startsWith("<")) {
    return {
      type: "draft_item",
      id,
      raw: text,
      inferredNodeType,
      parseState: "open",
      editingNodeId: sourceBlock?.type === "draft_item" ? sourceBlock.editingNodeId : undefined,
      editingNodeType: sourceBlock?.type === "draft_item" ? sourceBlock.editingNodeType : undefined
    };
  }
  return { type: "free_text", id, text };
}

export function splitEditableBlockAtSelection(
  document: EditorDocument,
  blockIndex: number,
  selectionStart: number,
  selectionEnd: number,
  currentText?: string
): { document: EditorDocument; nextBlockId: string | null } {
  const block = document.blocks[blockIndex];
  if (!block || block.type === "section" || block.type === "saved_node") {
    return { document, nextBlockId: null };
  }

  const text = currentText ?? getEditableBlockText(block);
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  const inferredNodeType =
    block.type === "draft_item" ? block.inferredNodeType : getNodeTypeForBlock(document, blockIndex);
  const nextBlockId = makeId("blk");
  const sourceStartsDraft = block.type === "draft_item" && block.raw.startsWith("<");
  const currentBlock = makeEditableBlockFromText(
    text.slice(0, start),
    block.id,
    inferredNodeType,
    block,
    block.type === "draft_item" && !sourceStartsDraft && !text.slice(0, start).startsWith("<")
  );
  const nextBlock = makeEditableBlockFromText(
    text.slice(end),
    nextBlockId,
    inferredNodeType,
    block,
    block.type === "draft_item" && !text.slice(end).startsWith("<")
  );

  return {
    document: {
      ...document,
      blocks: [
        ...document.blocks.slice(0, blockIndex),
        currentBlock,
        nextBlock,
        ...document.blocks.slice(blockIndex + 1)
      ],
      version: document.version + 1,
      updatedAt: new Date().toISOString()
    },
    nextBlockId
  };
}

export function makeRawEditDraftBlocks(
  raw: string,
  firstBlockId: string,
  nodeType: NodeType,
  editingNodeId: string
): DraftItemBlock[] {
  return raw.split(/\r?\n/).map((line, index) => ({
    type: "draft_item",
    id: index === 0 ? firstBlockId : makeId("blk"),
    raw: line,
    inferredNodeType: nodeType,
    parseState: "open",
    editingNodeId,
    editingNodeType: nodeType
  }));
}

export function pairMacroCloseOnOpen(
  previousText: string,
  nextText: string,
  caret: number
): { text: string; caret: number } | null {
  const openIndex = caret - 1;
  if (nextText.length !== previousText.length + 1) return null;
  if (openIndex < 0 || nextText[openIndex] !== "<") return null;
  if (isEscapedAt(nextText, openIndex)) return null;

  return {
    text: `${nextText.slice(0, caret)}>${nextText.slice(caret)}`,
    caret
  };
}

export function isCaretImmediatelyAfterClosingMacro(text: string, caret: number): boolean {
  const closeIndex = caret - 1;
  if (closeIndex < 0 || text[closeIndex] !== ">") return false;
  return !isEscapedAt(text, closeIndex);
}

function isEscapedAt(text: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

export function ensureTrailingEmptyLine(blocks: EditorBlock[]): EditorBlock[] {
  const last = blocks[blocks.length - 1];
  if (!last || last.type !== "empty") return [...blocks, makeEmptyBlock()];
  return blocks;
}

export function replaceBlock(
  document: EditorDocument,
  blockId: string,
  replacement: EditorBlock
): EditorDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => (block.id === blockId ? replacement : block)),
    version: document.version + 1,
    updatedAt: new Date().toISOString()
  };
}

export function insertBlockAfter(
  document: EditorDocument,
  blockId: string,
  blockToInsert: EditorBlock
): EditorDocument {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return document;
  return {
    ...document,
    blocks: [
      ...document.blocks.slice(0, index + 1),
      blockToInsert,
      ...document.blocks.slice(index + 1)
    ],
    version: document.version + 1,
    updatedAt: new Date().toISOString()
  };
}

export function removeBlock(document: EditorDocument, blockId: string): EditorDocument {
  return {
    ...document,
    blocks: document.blocks.filter((block) => block.id !== blockId || block.type === "section"),
    version: document.version + 1,
    updatedAt: new Date().toISOString()
  };
}

export function makeSavedBlock(nodeType: NodeType, nodeId: string): SavedNodeBlock {
  return {
    type: "saved_node",
    id: makeId("blk"),
    nodeType,
    nodeId,
    collapsedNote: true
  };
}

export function allSavedNodeBlocks(state: WorkspaceState): SavedNodeBlock[] {
  return Object.values(state.documents).flatMap((document) =>
    document.blocks.filter((block): block is SavedNodeBlock => block.type === "saved_node")
  );
}
