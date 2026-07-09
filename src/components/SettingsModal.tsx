import { useEffect, useState } from "react";
import type {
  DraftItemBlock,
  EHUser,
  EditorDocument,
  EditorDocumentKey,
  NodeType,
  SavedNodeBlock,
  WorkspaceState
} from "../types";
import { EditorPanel } from "./EditorPanel";
import { deleteAccount } from "../services/workspaceService";

type SettingsModalProps = {
  open: boolean;
  user: EHUser;
  state: WorkspaceState;
  workspaceLocked?: boolean;
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

type SettingsTab = "tags" | "profile" | "delete";

export function SettingsModal({
  open,
  user,
  state,
  workspaceLocked = false,
  onClose,
  onDocumentChange,
  onFinalizeMacro,
  onBeginRawEdit,
  onArchiveNode
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("tags");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (open && workspaceLocked && tab !== "delete") {
      setTab("delete");
    }
  }, [open, tab, workspaceLocked]);

  if (!open) return null;
  const tabs: SettingsTab[] = workspaceLocked ? ["delete"] : ["tags", "profile", "delete"];
  const activeTab = workspaceLocked ? "delete" : tab;

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
            {tabs.map((item) => (
              <button
                key={item}
                className={activeTab === item ? "active" : ""}
                type="button"
                onClick={() => setTab(item)}
              >
                {settingsTabLabel(item)}
              </button>
            ))}
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className={`settings-body ${activeTab === "delete" ? "settings-body-scroll" : ""}`}>
          {activeTab === "tags" ? (
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

          {activeTab === "profile" ? (
            <EditorPanel
              title="Entity"
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

          {activeTab === "delete" ? (
            <section className="danger-zone" aria-label="Delete account">
              <h3>Delete Account</h3>
              <p>
                This permanently removes your Efficient Hypothesis account data, workspace, OAuth
                tokens, and legacy app data. It cannot be undone.
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
          ) : null}
        </div>
      </div>
    </div>
  );
}

function settingsTabLabel(tab: SettingsTab): string {
  if (tab === "delete") return "Delete Account";
  if (tab === "profile") return "Entity";
  return tab[0].toUpperCase() + tab.slice(1);
}
