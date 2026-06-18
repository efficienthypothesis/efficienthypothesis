import { useEffect, useMemo, useRef, useState } from "react";
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
import { EditorPanel } from "./components/EditorPanel";
import { InstructionsModal } from "./components/InstructionsModal";
import { SettingsModal } from "./components/SettingsModal";
import { createDefaultWorkspace } from "./services/defaultWorkspace";
import { ensureUserTimezone, loadWorkspace, saveWorkspace } from "./services/workspaceService";
import {
  archiveNode,
  createOrUpdateNodeFromMacro,
  nodeToMacro
} from "./services/nodeService";
import { parseMacro } from "./utils/macroParser";

type AppProps = {
  bootstrap: BootstrapPayload;
};

const saveDelayMs = 700;

export function App({ bootstrap }: AppProps) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() =>
    createDefaultWorkspace(bootstrap.user.id)
  );
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const hasLoaded = useRef(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([ensureUserTimezone(), loadWorkspace(bootstrap.user.id)])
      .then(([, loadedWorkspace]) => {
        if (cancelled) return;
        setWorkspace(loadedWorkspace);
        setLoading(false);
        hasLoaded.current = true;
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        hasLoaded.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrap.user.id]);

  useEffect(() => {
    if (!hasLoaded.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = window.setTimeout(() => {
      saveWorkspace(workspace)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("error"));
    }, saveDelayMs);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [workspace]);

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
    setWorkspace((current) => ({
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
    setWorkspace((current) => {
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
    setWorkspace((current) => ({
      ...current,
      documents: {
        ...current.documents,
        [key]: {
          ...document,
          blocks: document.blocks.map((candidate) =>
            candidate.id === block.id
              ? {
                  type: "draft_item",
                  id: block.id,
                  raw: nodeToMacro(current, block.nodeType, block.nodeId),
                  inferredNodeType: block.nodeType,
                  parseState: "open",
                  editingNodeId: block.nodeId,
                  editingNodeType: block.nodeType
                }
              : candidate
          ),
          version: document.version + 1,
          updatedAt: new Date().toISOString()
        }
      },
      updatedAt: new Date().toISOString()
    }));
  }

  function archiveSavedBlock(block: SavedNodeBlock) {
    setWorkspace((current) => archiveNode(current, block.nodeType, block.nodeId));
  }

  return (
    <div className="app-shell">
      <Navbar
        user={user}
        onSettings={() => setSettingsOpen(true)}
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
        onStateChange={setWorkspace}
        onDocumentChange={updateDocument}
        onFinalizeMacro={finalizeMacro}
        onBeginRawEdit={beginRawEdit}
        onArchiveNode={archiveSavedBlock}
      />
      <InstructionsModal open={instructionsOpen} onClose={() => setInstructionsOpen(false)} />
    </div>
  );
}

function saveStatusText(status: "idle" | "saving" | "saved" | "error", loading: boolean): string {
  if (loading) return "loading";
  if (status === "saving") return "saving";
  if (status === "saved") return "saved";
  if (status === "error") return "offline cache";
  return "";
}
