import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetStateAction } from "react";
import type {
  BootstrapPayload,
  DraftItemBlock,
  EditorDocument,
  EditorDocumentKey,
  NodeType,
  SavedNodeBlock,
  WorkspaceState
} from "./types";
import { Navbar } from "./components/Navbar";
import { AccountModal } from "./components/AccountModal";
import { EditorPanel } from "./components/EditorPanel";
import { InstructionsModal } from "./components/InstructionsModal";
import { SettingsModal } from "./components/SettingsModal";
import { createDefaultWorkspace } from "./services/defaultWorkspace";
import {
  WorkspaceConflictError,
  WorkspaceLockedError,
  ensureUserTimezone,
  fetchWorkspaceFromServer,
  importWorkspaceKey,
  loadWorkspace,
  saveWorkspace
} from "./services/workspaceService";
import {
  archiveNode,
  createOrUpdateNodeFromMacro,
  nodeToMacro
} from "./services/nodeService";
import { applyRoutineRollover } from "./services/routineRollover";
import { parseMacro } from "./utils/macroParser";
import { makeRawEditDraftBlocks } from "./utils/model";

type AppProps = {
  bootstrap: BootstrapPayload;
};

const saveDelayMs = 700;

type SaveStatus = "idle" | "syncing" | "saving" | "saved" | "conflict" | "error";

export function App({ bootstrap }: AppProps) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() =>
    createDefaultWorkspace(bootstrap.user.id)
  );
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const hasLoaded = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const workspaceRef = useRef(workspace);
  const lastSyncedUpdatedAt = useRef<string | null>(null);
  const localRevision = useRef(0);
  const savedRevision = useRef(0);
  const saveInFlight = useRef(false);
  const saveBlockedByConflict = useRef(false);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  function setLocalWorkspace(next: SetStateAction<WorkspaceState>) {
    localRevision.current += 1;
    setWorkspace(next);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([ensureUserTimezone(), loadWorkspace(bootstrap.user.id)])
      .then(([, loadedWorkspace]) => {
        if (cancelled) return;
        const rollover = applyRoutineRollover(loadedWorkspace);
        lastSyncedUpdatedAt.current = loadedWorkspace.updatedAt || null;
        if (rollover.changed) {
          savedRevision.current = localRevision.current;
          localRevision.current += 1;
          setSaveStatus("saving");
        } else {
          savedRevision.current = localRevision.current;
        }
        saveBlockedByConflict.current = false;
        setLocked(false);
        setWorkspace(rollover.state);
        setLoading(false);
        hasLoaded.current = true;
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof WorkspaceLockedError) {
          setLocked(true);
          setLoading(false);
          hasLoaded.current = false;
          return;
        }
        setLoading(false);
        hasLoaded.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrap.user.id]);

  useEffect(() => {
    if (!hasLoaded.current) return;
    if (localRevision.current === savedRevision.current) return;
    if (saveBlockedByConflict.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = window.setTimeout(() => {
      if (saveInFlight.current) return;
      saveInFlight.current = true;
      const revision = localRevision.current;
      const snapshot = workspaceRef.current;
      let shouldSaveAgain = false;
      saveWorkspace(snapshot, lastSyncedUpdatedAt.current)
        .then(({ updatedAt }) => {
          lastSyncedUpdatedAt.current = updatedAt;
          savedRevision.current = revision;
          if (localRevision.current === revision) {
            setSaveStatus("saved");
          } else {
            shouldSaveAgain = true;
          }
        })
        .catch((error) => {
          if (error instanceof WorkspaceConflictError) {
            saveBlockedByConflict.current = true;
            setSaveStatus("conflict");
            if (error.serverUpdatedAt) lastSyncedUpdatedAt.current = error.serverUpdatedAt;
            return;
          }
          setSaveStatus("error");
        })
        .finally(() => {
          saveInFlight.current = false;
          if (shouldSaveAgain && !saveBlockedByConflict.current) {
            setWorkspace((current) => ({ ...current }));
          }
        });
    }, saveDelayMs);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [workspace]);

  const applyRoutineRolloverIfClean = useCallback(() => {
    if (!hasLoaded.current || loading) return false;
    if (saveInFlight.current || localRevision.current !== savedRevision.current) return false;
    const rollover = applyRoutineRollover(workspaceRef.current);
    if (!rollover.changed) return false;
    saveBlockedByConflict.current = false;
    localRevision.current += 1;
    setWorkspace(rollover.state);
    setSaveStatus("saving");
    return true;
  }, [loading]);

  const refreshFromServerIfClean = useCallback(() => {
    if (!hasLoaded.current || loading || refreshInFlight.current) return;
    if (saveInFlight.current || localRevision.current !== savedRevision.current) return;
    refreshInFlight.current = true;
    setSaveStatus((current) => (current === "saving" ? current : "syncing"));
    fetchWorkspaceFromServer()
      .then((serverWorkspace) => {
        if (!serverWorkspace) return;
        const serverUpdatedAt = serverWorkspace.updatedAt || null;
        if (!isNewerTimestamp(serverUpdatedAt, lastSyncedUpdatedAt.current)) {
          if (!applyRoutineRolloverIfClean()) {
            setSaveStatus((current) => (current === "syncing" ? "saved" : current));
          }
          return;
        }
        const rollover = applyRoutineRollover(serverWorkspace);
        lastSyncedUpdatedAt.current = serverUpdatedAt;
        saveBlockedByConflict.current = false;
        if (rollover.changed) {
          savedRevision.current = localRevision.current;
          localRevision.current += 1;
          setWorkspace(rollover.state);
          setSaveStatus("saving");
          return;
        }
        savedRevision.current = localRevision.current;
        setWorkspace(rollover.state);
        setSaveStatus("saved");
      })
      .catch(() => {
        setSaveStatus("error");
      })
      .finally(() => {
        refreshInFlight.current = false;
      });
  }, [applyRoutineRolloverIfClean, loading]);

  useEffect(() => {
    function handleFocus() {
      refreshFromServerIfClean();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") refreshFromServerIfClean();
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshFromServerIfClean]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      applyRoutineRolloverIfClean();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [applyRoutineRolloverIfClean]);

  const user = bootstrap.user;
  const visibleDocuments = useMemo(
    () =>
      [
        ["tasks", "Tasks"],
        ["websites_subscriptions", "Websites and Subscriptions"],
        ["timetable", "Timetable"]
      ] as const,
    []
  );

  function updateDocument(key: EditorDocumentKey, document: EditorDocument) {
    setLocalWorkspace((current) => ({
      ...current,
      documents: {
        ...current.documents,
        [key]: document
      },
      updatedAt: new Date().toISOString()
    }));
  }

  function finalizeMacro(
    key: EditorDocumentKey,
    document: EditorDocument,
    block: DraftItemBlock,
    raw: string,
    inferredNodeType: NodeType
  ) {
    setLocalWorkspace((current) => {
      const parsed = parseMacro(raw, block.editingNodeType || inferredNodeType);
      if (!parsed.valid) {
        return {
          ...current,
          documents: {
            ...current.documents,
            [key]: {
              ...document,
              blocks: document.blocks.map((candidate) =>
                candidate.id === block.id
                  ? {
                      ...block,
                      raw,
                      parseState: "invalid",
                      error: parsed.reason
                    }
                  : candidate
              ),
              updatedAt: new Date().toISOString()
            }
          },
          updatedAt: new Date().toISOString()
        };
      }

      const { state: nodeState, nodeId } = createOrUpdateNodeFromMacro(
        current,
        parsed,
        block.editingNodeId
      );
      const savedBlock: SavedNodeBlock = {
        type: "saved_node",
        id: block.id,
        nodeType: parsed.nodeType,
        nodeId,
        collapsedNote: true
      };
      const nextDocument: EditorDocument = {
        ...document,
        blocks: document.blocks.map((candidate) => (candidate.id === block.id ? savedBlock : candidate)),
        version: document.version + 1,
        updatedAt: new Date().toISOString()
      };
      const hasTrailingEmpty = nextDocument.blocks[nextDocument.blocks.length - 1]?.type === "empty";
      return {
        ...nodeState,
        documents: {
          ...nodeState.documents,
          [key]: hasTrailingEmpty
            ? nextDocument
            : {
                ...nextDocument,
                blocks: [
                  ...nextDocument.blocks,
                  { type: "empty", id: crypto.randomUUID ? `blk_${crypto.randomUUID()}` : `blk_${Date.now()}` }
                ]
              }
        },
        updatedAt: new Date().toISOString()
      };
    });
  }

  function beginRawEdit(key: EditorDocumentKey, document: EditorDocument, block: SavedNodeBlock) {
    setLocalWorkspace((current) => ({
      ...current,
      documents: {
        ...current.documents,
        [key]: {
          ...document,
          blocks: document.blocks.flatMap((candidate) =>
            candidate.id === block.id
              ? makeRawEditDraftBlocks(
                  nodeToMacro(current, block.nodeType, block.nodeId),
                  block.id,
                  block.nodeType,
                  block.nodeId
                )
              : [candidate]
          ),
          version: document.version + 1,
          updatedAt: new Date().toISOString()
        }
      },
      updatedAt: new Date().toISOString()
    }));
  }

  function archiveSavedBlock(block: SavedNodeBlock) {
    setLocalWorkspace((current) => archiveNode(current, block.nodeType, block.nodeId));
  }

  function unlockWorkspace() {
    try {
      importWorkspaceKey(user.id, recoveryKeyInput);
      setUnlockError("");
      window.location.reload();
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : "Invalid recovery key.");
    }
  }

  if (locked) {
    return (
      <div className="app-shell">
        <Navbar
          user={user}
          onSettings={() => setSettingsOpen(true)}
          onAccount={() => setAccountOpen(true)}
          onInstructions={() => setInstructionsOpen(true)}
        />
        <main className="locked-workspace">
          <section className="unlock-panel">
            <h1>Workspace encrypted</h1>
            <p>
              This browser does not have your Efficient Hypothesis recovery key. Paste your recovery
              key to unlock the encrypted workspace on this device.
            </p>
            <label>
              Recovery key
              <textarea
                value={recoveryKeyInput}
                onChange={(event) => setRecoveryKeyInput(event.target.value)}
                rows={3}
                spellCheck={false}
              />
            </label>
            <button type="button" onClick={unlockWorkspace}>
              Unlock workspace
            </button>
            {unlockError ? <p className="unlock-error">{unlockError}</p> : null}
            <p className="unlock-warning">
              If the recovery key is lost, the workspace cannot be recovered.
            </p>
          </section>
        </main>
        <AccountModal open={accountOpen} user={user} onClose={() => setAccountOpen(false)} />
        <InstructionsModal open={instructionsOpen} onClose={() => setInstructionsOpen(false)} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Navbar
        user={user}
        onSettings={() => setSettingsOpen(true)}
        onAccount={() => setAccountOpen(true)}
        onInstructions={() => setInstructionsOpen(true)}
      />
      <main className="workspace">
        {visibleDocuments.map(([key, title]) => (
          <EditorPanel
            key={key}
            title={title}
            document={workspace.documents[key]}
            state={workspace}
            readOnly={loading}
            onDocumentChange={(document) => updateDocument(key, document)}
            onFinalizeMacro={(document, block, raw, inferred) =>
              finalizeMacro(key, document, block, raw, inferred)
            }
            onBeginRawEdit={(document, block) => beginRawEdit(key, document, block)}
            onArchiveNode={archiveSavedBlock}
          />
        ))}
      </main>
      <div className={`save-status ${saveStatus}`}>{saveStatusText(saveStatus, loading)}</div>
      <SettingsModal
        open={settingsOpen}
        state={workspace}
        onClose={() => setSettingsOpen(false)}
        onStateChange={setLocalWorkspace}
        onDocumentChange={updateDocument}
        onFinalizeMacro={finalizeMacro}
        onBeginRawEdit={beginRawEdit}
        onArchiveNode={archiveSavedBlock}
      />
      <AccountModal open={accountOpen} user={user} onClose={() => setAccountOpen(false)} />
      <InstructionsModal open={instructionsOpen} onClose={() => setInstructionsOpen(false)} />
    </div>
  );
}

function isNewerTimestamp(candidate: string | null, current: string | null): boolean {
  if (!candidate) return false;
  if (!current) return true;
  const candidateMs = Date.parse(candidate);
  const currentMs = Date.parse(current);
  if (!Number.isFinite(candidateMs) || !Number.isFinite(currentMs)) return candidate !== current;
  return candidateMs > currentMs;
}

function saveStatusText(status: SaveStatus, loading: boolean): string {
  if (loading) return "loading";
  if (status === "syncing") return "syncing";
  if (status === "saving") return "saving";
  if (status === "saved") return "saved";
  if (status === "conflict") return "refresh needed";
  if (status === "error") return "offline cache";
  return "";
}
