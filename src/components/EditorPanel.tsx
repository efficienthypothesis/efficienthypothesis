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
import { getNodeTypeForBlock, splitEditableBlockAtSelection } from "../utils/model";
import { SavedNodeRow } from "./SavedNodeRow";

type FocusRequest = {
  blockId: string;
  caret: "start" | "end";
};

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

  function removeEditableBlock(blockId: string) {
    onDocumentChange({
      ...document,
      blocks: document.blocks.filter((block) => block.id !== blockId || block.type === "section"),
      version: document.version + 1,
      updatedAt: new Date().toISOString()
    });
  }

  function updateText(block: EditorBlock, blockIndex: number, text: string) {
    if (readOnly || block.type === "section" || block.type === "saved_node") return;
    const inferredNodeType =
      block.type === "draft_item" ? block.inferredNodeType : getNodeTypeForBlock(document, blockIndex);

    if (!text) {
      replaceBlock(block.id, { type: "empty", id: block.id });
      return;
    }

    if (text.startsWith("<")) {
      const draft: DraftItemBlock = {
        type: "draft_item",
        id: block.id,
        raw: text,
        inferredNodeType,
        parseState: "open",
        editingNodeId: block.type === "draft_item" ? block.editingNodeId : undefined,
        editingNodeType: block.type === "draft_item" ? block.editingNodeType : undefined
      };
      if (isMacroClosed(text)) {
        onFinalizeMacro(document, draft, text, inferredNodeType);
      } else {
        replaceBlock(block.id, draft);
      }
      return;
    }

    replaceBlock(block.id, {
      type: "free_text",
      id: block.id,
      text
    });
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    block: EditorBlock,
    blockIndex: number
  ) {
    if (readOnly || block.type === "section" || block.type === "saved_node") return;
    if (event.key === "Enter") {
      event.preventDefault();
      const input = event.currentTarget;
      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? selectionStart;
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
    if (event.key === "Backspace" && block.type === "empty") {
      event.preventDefault();
      removeEditableBlock(block.id);
    }
  }

  return (
    <section className="editor-panel" aria-label={title}>
      <div className="editor-scroll">
        {document.blocks.map((block, index) => (
          <EditorRow
            key={block.id}
            block={block}
            index={index}
            state={state}
            readOnly={readOnly}
            onText={(text) => updateText(block, index, text)}
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
  block: EditorBlock;
  index: number;
  state: WorkspaceState;
  readOnly?: boolean;
  onText: (text: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onBeginRawEdit: () => void;
  focusPosition: "start" | "end" | null;
  onFocused: () => void;
  onArchive: () => void;
};

function EditorRow({
  block,
  index,
  state,
  readOnly = false,
  onText,
  onKeyDown,
  onBeginRawEdit,
  focusPosition,
  onFocused,
  onArchive
}: EditorRowProps) {
  const lineNumber = index + 1;
  const editableText =
    block.type === "free_text" ? block.text : block.type === "draft_item" ? block.raw : "";
  const draftHint = block.type === "draft_item" ? getDraftHint(block.raw, block.inferredNodeType) : "";
  const visibleDraftHint =
    block.type === "draft_item" && shouldShowDraftHint(block.raw, draftHint) ? draftHint : "";

  return (
    <div className={`editor-row row-${block.type} ${readOnly ? "readonly" : ""}`}>
      <div className="line-gutter">
        <span className="line-number">{lineNumber}</span>
        {block.type === "saved_node" && !readOnly ? (
          <button className="gutter-action" type="button" onClick={onArchive} title="Archive item">
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
              className={`editable-line ${block.type === "draft_item" ? "draft-line" : ""} ${
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
  onText: (text: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  focusPosition: "start" | "end" | null;
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
    if (!focusPosition || !element) return;
    element.focus();
    const caretPosition = focusPosition === "start" ? 0 : element.value.length;
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
        onChange={(event) => onText(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
    </div>
  );
}

function shouldShowDraftHint(raw: string, hint: string): boolean {
  if (!hint) return false;
  if (isMacroClosed(raw)) return false;
  const start = findUnescaped(raw, "<");
  if (start !== 0) return false;
  const relevant = start >= 0 ? raw.slice(start + 1) : raw;
  const firstLine = relevant.split(/\r?\n/)[0] || "";
  const fields = splitUnescaped(firstLine, ";");
  const currentField = fields[fields.length - 1] || "";
  return currentField.trim().length === 0;
}

function getDraftHintPrefix(raw: string): string {
  const firstLine = raw.split(/\r?\n/)[0] || "";
  const lastSeparator = findUnescaped(firstLine, ";");
  if (lastSeparator < 0) return firstLine;

  let separatorIndex = lastSeparator;
  let nextSeparator = findUnescaped(firstLine, ";", separatorIndex + 1);
  while (nextSeparator >= 0) {
    separatorIndex = nextSeparator;
    nextSeparator = findUnescaped(firstLine, ";", separatorIndex + 1);
  }
  return firstLine.slice(0, separatorIndex + 1);
}
