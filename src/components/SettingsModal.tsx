import { useState } from "react";
import type {
  DraftItemBlock,
  EditorDocument,
  EditorDocumentKey,
  NodeType,
  SavedNodeBlock,
  WorkspaceState
} from "../types";
import { EditorPanel } from "./EditorPanel";

type SettingsModalProps = {
  open: boolean;
  state: WorkspaceState;
  onClose: () => void;
  onDocumentChange: (key: EditorDocumentKey, document: EditorDocument) => void;
  onFinalizeMacro: (
    key: EditorDocumentKey,
    document: EditorDocument,
    block: DraftItemBlock,
    raw: string,
    inferredNodeType: NodeType
  ) => void;
  onBeginRawEdit: (key: EditorDocumentKey, document: EditorDocument, block: SavedNodeBlock) => void;
  onArchiveNode: (block: SavedNodeBlock) => void;
};

type SettingsTab = "tags" | "profile";

export function SettingsModal({
  open,
  state,
  onClose,
  onDocumentChange,
  onFinalizeMacro,
  onBeginRawEdit,
  onArchiveNode
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("tags");
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-modal">
        <div className="settings-top">
          <div className="settings-tabs">
            {(["tags", "profile"] as SettingsTab[]).map((item) => (
              <button
                key={item}
                className={tab === item ? "active" : ""}
                type="button"
                onClick={() => setTab(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="settings-body">
          {tab === "tags" ? (
            <EditorPanel
              title="Tags"
              document={state.documents.tags}
              state={state}
              onDocumentChange={(document) => onDocumentChange("tags", document)}
              onFinalizeMacro={(document, block, raw, inferred) =>
                onFinalizeMacro("tags", document, block, raw, inferred)
              }
              onBeginRawEdit={(document, block) => onBeginRawEdit("tags", document, block)}
              onArchiveNode={onArchiveNode}
            />
          ) : null}

          {tab === "profile" ? (
            <EditorPanel
              title="Profile"
              document={state.documents.profile}
              state={state}
              onDocumentChange={(document) => onDocumentChange("profile", document)}
              onFinalizeMacro={(document, block, raw, inferred) =>
                onFinalizeMacro("profile", document, block, raw, inferred)
              }
              onBeginRawEdit={(document, block) => onBeginRawEdit("profile", document, block)}
              onArchiveNode={onArchiveNode}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
