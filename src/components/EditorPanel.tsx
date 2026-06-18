import type {
  DraftItemBlock,
  EditorBlock,
  EditorDocument,
  NodeType,
  SavedNodeBlock,
  WorkspaceState
} from "../types";
import { useEffect, useRef } from "react";
import { getDraftHint, isMacroClosed } from "../utils/macroParser";
import { getNodeTypeForBlock, makeEmptyBlock } from "../utils/model";
import { SavedNodeRow } from "./SavedNodeRow";

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
  function replaceBlock(blockId: string, replacement: EditorBlock) {
    onDocumentChange({
      ...document,
      blocks: document.blocks.map((block) => (block.id === blockId ? replacement : block)),
      version: document.version + 1,
      updatedAt: new Date().toISOString()
    });
  }

  function insertAfter(blockId: string, block: EditorBlock) {
    const index = document.blocks.findIndex((candidate) => candidate.id === blockId);
    if (index < 0) return;
    onDocumentChange({
      ...document,
      blocks: [
        ...document.blocks.slice(0, index + 1),
        block,
        ...document.blocks.slice(index + 1)
      ],
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

    if (text.startsWith("<") || block.type === "draft_item") {
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>, block: EditorBlock) {
    if (readOnly || block.type === "section" || block.type === "saved_node") return;
    if (event.key === "Enter") {
      if (block.type === "draft_item") {
        event.preventDefault();
        globalThis.document.execCommand("insertText", false, "\n");
        return;
      }
      event.preventDefault();
      insertAfter(block.id, makeEmptyBlock());
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
            onKeyDown={(event) => handleKeyDown(event, block)}
            onBeginRawEdit={() => {
              if (block.type === "saved_node") onBeginRawEdit(document, block);
            }}
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
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onBeginRawEdit: () => void;
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
  onArchive
}: EditorRowProps) {
  const lineNumber = index + 1;
  const editableText =
    block.type === "free_text" ? block.text : block.type === "draft_item" ? block.raw : "";
  const draftHint = block.type === "draft_item" ? getDraftHint(block.raw, block.inferredNodeType) : "";

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
              onText={onText}
              onKeyDown={onKeyDown}
            />
            {block.type === "empty" && !readOnly ? <span className="empty-caret-space" /> : null}
            {draftHint && !editableText.includes(draftHint) ? (
              <span className="field-hint" aria-hidden="true">
                <span className="field-hint-spacer">{editableText}</span>
                <span className="field-hint-value">{draftHint}</span>
              </span>
            ) : null}
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
  onText: (text: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

function EditableTextLine({
  blockId,
  text,
  readOnly,
  className,
  onText,
  onKeyDown
}: EditableTextLineProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastBlockId = useRef(blockId);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const blockChanged = lastBlockId.current !== blockId;
    lastBlockId.current = blockId;
    if (blockChanged || globalThis.document.activeElement !== element) {
      if (element.innerText !== text) {
        element.innerText = text;
      }
    }
  }, [blockId, text]);

  return (
    <div
      ref={ref}
      className={className}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      onInput={(event) => onText(event.currentTarget.innerText.replace(/\u00a0/g, " "))}
      onKeyDown={onKeyDown}
      spellCheck={false}
    />
  );
}
