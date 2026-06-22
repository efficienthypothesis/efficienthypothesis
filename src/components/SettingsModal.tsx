import { useState } from "react";
import type {
  DraftItemBlock,
  EHUser,
  EditorDocument,
  EditorDocumentKey,
  NodeType,
  SavedNodeBlock,
  WorkspaceState
} from "../types";
import { getRoutineDocumentKeys, getRoutineLabels } from "../services/defaultWorkspace";
import { getNodeByType, restoreNode } from "../services/nodeService";
import { deleteAccount } from "../services/workspaceService";
import { EditorPanel } from "./EditorPanel";

type SettingsModalProps = {
  open: boolean;
  user: EHUser;
  state: WorkspaceState;
  onClose: () => void;
  onStateChange: (state: WorkspaceState) => void;
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

type SettingsTab = "tags" | "routine" | "archive" | "profile";

export function SettingsModal({
  open,
  user,
  state,
  onClose,
  onStateChange,
  onDocumentChange,
  onFinalizeMacro,
  onBeginRawEdit,
  onArchiveNode
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("tags");
  const [status, setStatus] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  if (!open) return null;

  function publishRoutine() {
    onStateChange({
      ...state,
      routineAsset: {
        ...state.routineAsset,
        updatedAt: new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    });
    setStatus("Routine template timestamp updated. Daily rollover automation is a backend TODO.");
  }

  function handleDeleteAccount() {
    const expected = `DELETE ${user.email}`;
    if (deleteConfirmation !== expected || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteStatus("Deleting account...");
    deleteAccount(deleteConfirmation)
      .then(() => {
        window.location.assign("/");
      })
      .catch((error) => {
        setDeleteStatus(error instanceof Error ? error.message : "Account deletion failed.");
        setDeleteBusy(false);
      });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-modal">
        <div className="settings-top">
          <div className="settings-tabs">
            {(["tags", "routine", "archive", "profile"] as SettingsTab[]).map((item) => (
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

          {tab === "routine" ? (
            <div className="routine-settings">
              <div className="routine-toolbar">
                <button type="button" onClick={publishRoutine}>
                  Freeze/Publish
                </button>
                {status ? <span>{status}</span> : null}
              </div>
              <div className="routine-grid">
                {getRoutineDocumentKeys().map((key, index) => (
                  <EditorPanel
                    key={key}
                    title={getRoutineLabels()[index]}
                    document={state.documents[key]}
                    state={state}
                    onDocumentChange={(document) => onDocumentChange(key, document)}
                    onFinalizeMacro={(document, block, raw, inferred) =>
                      onFinalizeMacro(key, document, block, raw, inferred)
                    }
                    onBeginRawEdit={(document, block) => onBeginRawEdit(key, document, block)}
                    onArchiveNode={onArchiveNode}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {tab === "archive" ? (
            <ArchivePanels state={state} onRestore={(nodeType, nodeId) => onStateChange(restoreNode(state, nodeType, nodeId))} />
          ) : null}

          {tab === "profile" ? (
            <div className="profile-settings">
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
              <section className="danger-zone" aria-label="Delete account">
                <h3>Delete Account</h3>
                <p>
                  This permanently removes your Efficient Hypothesis account data, workspace,
                  OAuth tokens, and legacy app data. It cannot be undone.
                </p>
                <label>
                  Type <code>DELETE {user.email}</code> to confirm.
                  <input
                    type="text"
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <button
                  className="delete-account-button"
                  type="button"
                  disabled={deleteConfirmation !== `DELETE ${user.email}` || deleteBusy}
                  onClick={handleDeleteAccount}
                >
                  {deleteBusy ? "Deleting..." : "Delete account"}
                </button>
                {deleteStatus ? <p className="delete-status">{deleteStatus}</p> : null}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ArchivePanels({
  state,
  onRestore
}: {
  state: WorkspaceState;
  onRestore: (nodeType: NodeType, nodeId: string) => void;
}) {
  const levels = [1, 2] as const;
  const nodeTypes: NodeType[] = [
    "task",
    "website",
    "subscription",
    "action",
    "tag",
    "location",
    "identity",
    "asset"
  ];

  return (
    <div className="archive-grid">
      {levels.map((level) => (
        <div className="archive-panel" key={level}>
          <div className="archive-title">Archive Level {level}</div>
          <div className="archive-editor">
            {nodeTypes.flatMap((nodeType) =>
              Object.values(collectionForType(state, nodeType))
                .filter((node) => node.archive === level && !node.deletedAt)
                .map((node, index) => (
                  <div className="archive-row" key={`${nodeType}:${node.id}`}>
                    <span className="line-number">{index + 1}</span>
                    <span className="archive-name">
                      {nodeType}: {node.name}
                    </span>
                    <button type="button" onClick={() => onRestore(nodeType, node.id)}>
                      Restore
                    </button>
                  </div>
                ))
            )}
            {nodeTypes.every(
              (nodeType) =>
                Object.values(collectionForType(state, nodeType)).filter(
                  (node) => node.archive === level && !node.deletedAt
                ).length === 0
            ) ? (
              <div className="archive-row muted">
                <span className="line-number">1</span>
                <span>No archived nodes.</span>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function collectionForType(state: WorkspaceState, nodeType: NodeType) {
  if (nodeType === "task") return state.nodes.tasks;
  if (nodeType === "website") return state.nodes.websites;
  if (nodeType === "subscription") return state.nodes.subscriptions;
  if (nodeType === "action") return state.nodes.actions;
  if (nodeType === "tag") return state.nodes.tags;
  if (nodeType === "location") return state.nodes.locations;
  if (nodeType === "identity") return state.nodes.identities;
  return state.nodes.assets;
}
