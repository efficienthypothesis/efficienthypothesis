import { useEffect, useState } from "react";
import type { EHUser } from "../types";
import {
  type ChatGptGrantStatus,
  deleteAccount,
  exportWorkspaceKey,
  fetchChatGptGrantStatus,
  grantChatGptAccess,
  revokeChatGptAccess
} from "../services/workspaceService";

type AccountModalProps = {
  open: boolean;
  user: EHUser;
  onClose: () => void;
};

type AccountTab = "encryption" | "delete";

export function AccountModal({ open, user, onClose }: AccountModalProps) {
  const [tab, setTab] = useState<AccountTab>("encryption");
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

  if (!open) return null;

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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Account">
      <div className="account-modal">
        <div className="settings-top">
          <div className="settings-tabs">
            {(["encryption", "delete"] as AccountTab[]).map((item) => (
              <button
                key={item}
                className={tab === item ? "active" : ""}
                type="button"
                onClick={() => setTab(item)}
              >
                {item === "delete" ? "Delete Account" : "Encryption"}
              </button>
            ))}
          </div>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="account-body">
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
