import type {
  EditorBlock,
  EditorDocument,
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
