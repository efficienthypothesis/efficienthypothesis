import type {
  DraftItemBlock,
  EditorBlock,
  EditorDocument,
  NodeType,
  SavedNodeBlock,
  WorkspaceState
} from "../types";
import { useEffect, useRef, useState } from "react";
import { findUnescaped, getDraftHint, isMacroClosed, splitUnescaped } from "../utils/macroParser";
import { compactDraftGroup, getDraftGroup, isContinuationDraftLine } from "../utils/draftGroups";
import { isSavedNodeBlockActive } from "../services/nodeService";
import {
  canRemoveEditableBlock,
  findAdjacentEditableBlock,
  findEditableBlockAfterRemoval,
  getNodeTypeForBlock,
  isCaretImmediatelyAfterClosingMacro,
  pairMacroCloseOnOpen,
  replaceBlock as replaceBlockInDocument,
  splitEditableBlockAtSelection
} from "../utils/model";
import { SavedNodeRow } from "./SavedNodeRow";

type FocusRequest = {
  blockId: string;
  caret: CaretPosition;
};

type CaretPosition = "start" | "end" | number;

type EditorPanelProps = {
  title: string;
  document: EditorDocument;
  state: WorkspaceState;
  readOnly?: boolean;
  onDocumentChange: (document: EditorDocument) => void;
  onFinalizeMacro: (
    document: EditorDocument,
    block: DraftItemBlock,
    raw: string,
    inferredNodeType: NodeType
  ) => void;
  onBeginRawEdit: (document: EditorDocument, block: SavedNodeBlock) => void;
  onArchiveNode?: (block: SavedNodeBlock) => void;
};

export function EditorPanel({
  title,
  document,
  state,
  readOnly = false,
  onDocumentChange,
  onFinalizeMacro,
  onBeginRawEdit,
  onArchiveNode
}: EditorPanelProps) {
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  function replaceBlock(blockId: string, replacement: EditorBlock) {
    onDocumentChange({
      ...document,
      blocks: document.blocks.map((block) => (block.id === blockId ? replacement : block)),
      version: document.version + 1,
      updatedAt: new Date().toISOString()
    });
  }

  function removeEditableBlock(blockIndex: number) {
    if (!canRemoveEditableBlock(document, blockIndex)) return;
    const block = document.blocks[blockIndex];
    if (!block) return;
    const focusTarget = findEditableBlockAfterRemoval(document, blockIndex);
    onDocumentChange({
      ...document,
      blocks: document.blocks.filter((candidate) => candidate.id !== block.id),
      version: document.version + 1,
      updatedAt: new Date().toISOString()
    });
    if (focusTarget) setFocusRequest({ blockId: focusTarget.blockId, caret: "start" });
  }

  function updateText(block: EditorBlock, blockIndex: number, text: string, nextCaret?: number) {
    if (readOnly || block.type === "section" || block.type === "saved_node") return;
    const inferredNodeType =
      block.type === "draft_item" ? block.inferredNodeType : getNodeTypeForBlock(document, blockIndex);
    const isDraftContinuation = isContinuationDraftLine(document, blockIndex);

    if (!text && !isDraftContinuation) {
      replaceBlock(block.id, { type: "empty", id: block.id });
      return;
    }

    if (text.startsWith("<") || isDraftContinuation) {
      const draft: DraftItemBlock = {
        type: "draft_item",
        id: block.id,
        raw: text,
        inferredNodeType,
        parseState: "open",
        editingNodeId: block.type === "draft_item" ? block.editingNodeId : undefined,
        editingNodeType: block.type === "draft_item" ? block.editingNodeType : undefined
      };
      const nextDocument = replaceBlockInDocument(document, block.id, draft);
      onDocumentChange(nextDocument);
      if (typeof nextCaret === "number") setFocusRequest({ blockId: block.id, caret: nextCaret });
      return;
    }

    const nextDocument = replaceBlockInDocument(document, block.id, {
      type: "free_text",
      id: block.id,
      text
    });
    onDocumentChange(nextDocument);
    if (typeof nextCaret === "number") setFocusRequest({ blockId: block.id, caret: nextCaret });
  }

  function finalizeMacroFromEnter(
    block: EditorBlock,
    blockIndex: number,
    currentText: string,
    caret: number
  ): boolean {
    if (!isCaretImmediatelyAfterClosingMacro(currentText, caret)) return false;
    if (block.type === "section" || block.type === "saved_node") return false;

    const inferredNodeType =
      block.type === "draft_item" ? block.inferredNodeType : getNodeTypeForBlock(document, blockIndex);
    const draft: DraftItemBlock = {
      type: "draft_item",
      id: block.id,
      raw: currentText,
      inferredNodeType,
      parseState: "open",
      editingNodeId: block.type === "draft_item" ? block.editingNodeId : undefined,
      editingNodeType: block.type === "draft_item" ? block.editingNodeType : undefined
    };
    const nextDocument = replaceBlockInDocument(document, block.id, draft);
    const draftGroup = getDraftGroup(nextDocument, blockIndex);
    if (!draftGroup || draftGroup.endIndex !== blockIndex || !isMacroClosed(draftGroup.raw)) {
      return false;
    }

    const aggregateDraft: DraftItemBlock = {
      ...draftGroup.startBlock,
      raw: draftGroup.raw,
      inferredNodeType: draftGroup.inferredNodeType
    };
    onFinalizeMacro(
      compactDraftGroup(nextDocument, draftGroup, aggregateDraft),
      aggregateDraft,
      draftGroup.raw,
      draftGroup.inferredNodeType
    );
    return true;
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    block: EditorBlock,
    blockIndex: number
  ) {
    if (readOnly || block.type === "section" || block.type === "saved_node") return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const target = findAdjacentEditableBlock(document, blockIndex, event.key === "ArrowUp" ? -1 : 1);
      if (!target) return;
      event.preventDefault();
      const caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
      setFocusRequest({ blockId: target.blockId, caret: Math.min(caret, target.text.length) });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const input = event.currentTarget;
      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? selectionStart;
      if (
        selectionStart === selectionEnd &&
        finalizeMacroFromEnter(block, blockIndex, input.value, selectionStart)
      ) {
        return;
      }
      const split = splitEditableBlockAtSelection(
        document,
        blockIndex,
        selectionStart,
        selectionEnd,
        input.value
      );
      onDocumentChange(split.document);
      if (split.nextBlockId) setFocusRequest({ blockId: split.nextBlockId, caret: "start" });
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && block.type === "empty") {
      event.preventDefault();
      removeEditableBlock(blockIndex);
    }
  }

  return (
    <section className="editor-panel" aria-label={title}>
      <div className="editor-scroll">
        {document.blocks
          .map((block, index) => ({ block, index }))
          .filter(({ block }) => block.type !== "saved_node" || isSavedNodeBlockActive(state, block))
          .map(({ block, index }, visibleIndex) => (
            <EditorRow
              key={block.id}
              document={document}
              block={block}
              index={index}
              lineNumber={visibleIndex + 1}
              state={state}
              readOnly={readOnly}
              onText={(text, caret) => updateText(block, index, text, caret)}
              onKeyDown={(event) => handleKeyDown(event, block, index)}
              onBeginRawEdit={() => {
                if (block.type === "saved_node") onBeginRawEdit(document, block);
              }}
              focusPosition={focusRequest?.blockId === block.id ? focusRequest.caret : null}
              onFocused={() => setFocusRequest(null)}
              onArchive={() => {
                if (block.type === "saved_node") onArchiveNode?.(block);
              }}
            />
          ))}
      </div>
    </section>
  );
}

type EditorRowProps = {
  document: EditorDocument;
  block: EditorBlock;
  index: number;
  lineNumber: number;
  state: WorkspaceState;
  readOnly?: boolean;
  onText: (text: string, caret?: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onBeginRawEdit: () => void;
  focusPosition: CaretPosition | null;
  onFocused: () => void;
  onArchive: () => void;
};

function EditorRow({
  document,
  block,
  index,
  lineNumber,
  state,
  readOnly = false,
  onText,
  onKeyDown,
  onBeginRawEdit,
  focusPosition,
  onFocused,
  onArchive
}: EditorRowProps) {
  const editableText =
    block.type === "free_text" ? block.text : block.type === "draft_item" ? block.raw : "";
  const draftGroup = getDraftGroup(document, index);
  const draftHint = draftGroup ? getDraftHint(draftGroup.raw, draftGroup.inferredNodeType) : "";
  const visibleDraftHint =
    draftGroup && draftGroup.endIndex === index && shouldShowDraftHint(draftGroup.raw, draftHint)
      ? draftHint
      : "";
  const isDraftLine = Boolean(draftGroup);

  return (
    <div className={`editor-row row-${block.type} ${readOnly ? "readonly" : ""}`}>
      <div className="line-gutter">
        <span className="line-number">{lineNumber}</span>
        {block.type === "saved_node" && !readOnly ? (
          <button
            className="gutter-action"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onArchive();
            }}
            title="Archive item"
          >
            archive
          </button>
        ) : null}
      </div>
      <div className="line-content">
        {block.type === "section" ? (
          <div className="section-line">{block.label}</div>
        ) : block.type === "saved_node" ? (
          <SavedNodeRow
            state={state}
            nodeType={block.nodeType}
            nodeId={block.nodeId}
            collapsedNote={block.collapsedNote}
            onEdit={onBeginRawEdit}
          />
        ) : (
          <div className="editable-shell">
            <EditableTextLine
              blockId={block.id}
              text={editableText}
              readOnly={readOnly}
              className={`editable-line ${isDraftLine ? "draft-line" : ""} ${
                block.type === "draft_item" && block.parseState === "invalid" ? "invalid" : ""
              }`}
              hintPrefix={getDraftHintPrefix(editableText)}
              hint={visibleDraftHint}
              focusPosition={focusPosition}
              onFocused={onFocused}
              onText={onText}
              onKeyDown={onKeyDown}
            />
            {block.type === "draft_item" && block.error ? (
              <span className="draft-error">{block.error}</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

type EditableTextLineProps = {
  blockId: string;
  text: string;
  readOnly: boolean;
  className: string;
  hintPrefix: string;
  hint: string;
  onText: (text: string, caret?: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  focusPosition: CaretPosition | null;
  onFocused: () => void;
};

function EditableTextLine({
  blockId,
  text,
  readOnly,
  className,
  hintPrefix,
  hint,
  onText,
  onKeyDown,
  focusPosition,
  onFocused
}: EditableTextLineProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  const lastBlockId = useRef(blockId);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const blockChanged = lastBlockId.current !== blockId;
    lastBlockId.current = blockId;
    if (blockChanged || globalThis.document.activeElement !== element) {
      element.value = text;
    }
  }, [blockId, text]);

  useEffect(() => {
    const element = ref.current;
    if (focusPosition === null || !element) return;
    element.focus();
    const caretPosition =
      typeof focusPosition === "number"
        ? Math.max(0, Math.min(focusPosition, element.value.length))
        : focusPosition === "start"
          ? 0
          : element.value.length;
    element.setSelectionRange(caretPosition, caretPosition);
    onFocused();
  }, [focusPosition, onFocused]);

  return (
    <div className="editable-input-wrap">
      {hint ? (
        <span className="field-hint" aria-hidden="true">
          <span className="field-hint-spacer">{hintPrefix}</span>
          <span className="field-hint-value"> {hint}</span>
        </span>
      ) : null}
      <input
        ref={ref}
        className={className}
        value={text}
        readOnly={readOnly}
        onChange={(event) => {
          const input = event.currentTarget;
          const caret = input.selectionStart ?? input.value.length;
          const paired = pairMacroCloseOnOpen(text, input.value, caret);
          if (paired) {
            input.value = paired.text;
            input.setSelectionRange(paired.caret, paired.caret);
            onText(paired.text, paired.caret);
            return;
          }
          onText(input.value);
        }}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
    </div>
  );
}

function shouldShowDraftHint(raw: string, hint: string): boolean {
  if (!hint) return false;
  const start = findUnescaped(raw, "<");
  if (start !== 0) return false;
  const relevant = start >= 0 ? raw.slice(start + 1) : raw;
  const body = relevant.split(">")[0] || "";
  const fields = splitUnescaped(body, ";");
  const currentField = fields[fields.length - 1] || "";
  return currentField.trim().length === 0;
}

function getDraftHintPrefix(raw: string): string {
  const firstLine = raw.split(/\r?\n/)[0] || "";
  const closeIndex = findUnescaped(firstLine, ">");
  const hintLine = closeIndex >= 0 ? firstLine.slice(0, closeIndex) : firstLine;
  const lastSeparator = findUnescaped(hintLine, ";");
  if (lastSeparator < 0) return hintLine;

  let separatorIndex = lastSeparator;
  let nextSeparator = findUnescaped(hintLine, ";", separatorIndex + 1);
  while (nextSeparator >= 0) {
    separatorIndex = nextSeparator;
    nextSeparator = findUnescaped(hintLine, ";", separatorIndex + 1);
  }
  return hintLine.slice(0, separatorIndex + 1);
}
