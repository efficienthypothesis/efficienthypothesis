import type { DraftItemBlock, EditorBlock, EditorDocument, FreeTextBlock, NodeType } from "../types";
import { isMacroClosed } from "./macroParser";

export type DraftGroup = {
  startIndex: number;
  endIndex: number;
  startBlock: DraftItemBlock;
  inferredNodeType: NodeType;
  raw: string;
};

export function isContinuationDraftLine(document: EditorDocument, blockIndex: number): boolean {
  const group = getDraftGroup(document, blockIndex);
  return Boolean(group && group.startIndex < blockIndex);
}

export function getDraftGroup(document: EditorDocument, blockIndex: number): DraftGroup | null {
  const block = document.blocks[blockIndex];
  if (!isDraftGroupCandidate(block)) return null;

  let startIndex = -1;
  for (let index = blockIndex; index >= 0; index -= 1) {
    const candidate = document.blocks[index];
    if (!isDraftGroupCandidate(candidate)) break;
    if (candidate.type === "draft_item" && candidate.raw.startsWith("<")) {
      startIndex = index;
      break;
    }
  }
  if (startIndex < 0) return null;

  const startBlock = document.blocks[startIndex];
  if (startBlock?.type !== "draft_item" || !startBlock.raw.startsWith("<")) return null;

  const rawLines: string[] = [];
  let endIndex = startIndex;
  for (let index = startIndex; index < document.blocks.length; index += 1) {
    const candidate = document.blocks[index];
    if (!isDraftGroupCandidate(candidate)) break;
    if (index > startIndex && candidate.type === "draft_item" && candidate.raw.startsWith("<")) break;

    rawLines.push(getDraftGroupCandidateText(candidate));
    endIndex = index;
    if (isMacroClosed(rawLines.join("\n"))) break;
  }

  if (blockIndex < startIndex || blockIndex > endIndex) return null;

  return {
    startIndex,
    endIndex,
    startBlock,
    inferredNodeType: startBlock.inferredNodeType,
    raw: rawLines.join("\n")
  };
}

export function compactDraftGroup(
  document: EditorDocument,
  group: DraftGroup,
  aggregateDraft: DraftItemBlock
): EditorDocument {
  return {
    ...document,
    blocks: [
      ...document.blocks.slice(0, group.startIndex),
      aggregateDraft,
      ...document.blocks.slice(group.endIndex + 1)
    ],
    version: document.version + 1,
    updatedAt: new Date().toISOString()
  };
}

function isDraftGroupCandidate(
  block: EditorBlock | undefined
): block is DraftItemBlock | FreeTextBlock {
  if (!block) return false;
  if (block.type === "draft_item") return true;
  return block.type === "free_text" && block.text.length > 0;
}

function getDraftGroupCandidateText(block: DraftItemBlock | FreeTextBlock): string {
  if (block.type === "draft_item") return block.raw;
  return block.text;
}
