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
import {
  type ChatGptGrantStatus,
  deleteAccount,
  exportWorkspaceKey,
  fetchChatGptGrantStatus,
  grantChatGptAccess,
  revokeChatGptAccess
} from "../services/workspaceService";

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

type SettingsTab = "tags" | "profile" | "encryption" | "delete";

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
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState("");
  const [grantStatus, setGrantStatus] = useState<ChatGptGrantStatus | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchChatGptGrantStatus()
      .then(setGrantStatus)
      .catch(() => setGrantStatus(null));
  }, [open]);

  useEffect(() => {
    if (open && workspaceLocked && (tab === "tags" || tab === "profile")) {
      setTab("encryption");
    }
  }, [open, tab, workspaceLocked]);

  if (!open) return null;
  const tabs: SettingsTab[] = workspaceLocked
    ? ["encryption", "delete"]
    : ["tags", "profile", "encryption", "delete"];

  function showRecoveryKey() {
    const key = exportWorkspaceKey(user.id);
    if (!key) {
      setRecoveryStatus("This browser does not have the recovery key.");
      return;
    }
    setRecoveryKey(key);
    setRecoveryStatus("Store this key somewhere private. If it is lost, encrypted data cannot be recovered.");
  }

  function copyRecoveryKey() {
    if (!recoveryKey) return;
    navigator.clipboard
      ?.writeText(recoveryKey)
      .then(() => setRecoveryStatus("Recovery key copied. Store it somewhere private."))
      .catch(() => setRecoveryStatus("Copy failed. Select and copy the key manually."));
  }

  function grantChatGpt() {
    setGrantBusy(true);
    grantChatGptAccess(user.id)
      .then((nextStatus) => {
        setGrantStatus(nextStatus);
      })
      .catch((error) => {
        setRecoveryStatus(error instanceof Error ? error.message : "ChatGPT grant failed.");
      })
      .finally(() => setGrantBusy(false));
  }

  function revokeChatGpt() {
    setGrantBusy(true);
    revokeChatGptAccess()
      .then((nextStatus) => {
        setGrantStatus(nextStatus);
      })
      .catch((error) => {
        setRecoveryStatus(error instanceof Error ? error.message : "ChatGPT revoke failed.");
      })
      .finally(() => setGrantBusy(false));
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
            {tabs.map((item) => (
              <button
                key={item}
                className={tab === item ? "active" : ""}
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

        <div className={`settings-body ${tab === "encryption" || tab === "delete" ? "settings-body-scroll" : ""}`}>
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

          {tab === "encryption" ? (
            <section className="encryption-zone" aria-label="Workspace encryption">
              <h3>Encryption</h3>
              <p>
                Workspace data is encrypted before it is saved to the server. This browser holds
                the recovery key. If the key is lost, the encrypted workspace cannot be recovered.
              </p>
              <div className="settings-button-row">
                <button type="button" onClick={showRecoveryKey}>
                  Show recovery key
                </button>
                <button type="button" onClick={copyRecoveryKey} disabled={!recoveryKey}>
                  Copy key
                </button>
              </div>
              {recoveryKey ? (
                <textarea className="recovery-key-output" readOnly value={recoveryKey} rows={3} />
              ) : null}
              <div className="chatgpt-grant-row">
                <div>
                  <strong>ChatGPT access</strong>
                  <p>
                    {grantStatus?.active && grantStatus.expiresAt
                      ? `Granted until ${formatDateTime(grantStatus.expiresAt)}.`
                      : "Not granted. GPT tools cannot read or edit encrypted workspace data."}
                  </p>
                </div>
                <div className="settings-button-row">
                  <button type="button" onClick={grantChatGpt} disabled={grantBusy}>
                    Grant 1 month
                  </button>
                  <button type="button" onClick={revokeChatGpt} disabled={grantBusy || !grantStatus?.active}>
                    Revoke
                  </button>
                </div>
              </div>
              {recoveryStatus ? <p className="encryption-status">{recoveryStatus}</p> : null}
            </section>
          ) : null}

          {tab === "delete" ? (
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
  return tab[0].toUpperCase() + tab.slice(1);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
