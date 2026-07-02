import type { WorkspaceState } from "../types";
import { createDefaultWorkspace } from "./defaultWorkspace";
import {
  type EncryptedWorkspaceEnvelope,
  WorkspaceLockedError,
  cacheEncryptedWorkspace,
  clearEncryptedWorkspaceCache,
  decryptWorkspaceEnvelope,
  encryptWorkspaceState,
  ensureWorkspaceKey,
  exportWorkspaceKey,
  importWorkspaceKey,
  removeWorkspaceKey,
  readCachedEncryptedWorkspace
} from "./encryptionService";
import { normalizeWorkspaceForClient } from "./nodeService";

const LOCAL_CACHE_KEY = "eh_workspace_cache_v1";

export { WorkspaceLockedError, exportWorkspaceKey, importWorkspaceKey };

export class WorkspaceConflictError extends Error {
  serverState: WorkspaceState | null;
  serverUpdatedAt: string | null;

  constructor(serverState: WorkspaceState | null, serverUpdatedAt: string | null) {
    super("Workspace changed on the server before this browser saved.");
    this.name = "WorkspaceConflictError";
    this.serverState = serverState;
    this.serverUpdatedAt = serverUpdatedAt;
  }
}

export type LoadWorkspaceResult = {
  state: WorkspaceState;
  shouldPersist: boolean;
};

export async function loadWorkspaceWithMetadata(userId: string): Promise<LoadWorkspaceResult> {
  try {
    const payload = await fetchWorkspacePayload();
    if (payload.encryptedState) {
      const serverState = await decryptWorkspaceEnvelope(userId, payload.encryptedState);
      const normalizedState = normalizeWorkspaceForClient(serverState);
      cacheEncryptedWorkspace(userId, payload.encryptedState);
      clearPlaintextWorkspaceCache();
      return { state: normalizedState, shouldPersist: false };
    }
    if (payload.state) {
      await ensureWorkspaceKey(userId);
      const normalizedState = normalizeWorkspaceForClient(payload.state);
      const saved = await saveWorkspace(normalizedState, normalizedState.updatedAt || null);
      return {
        state: { ...normalizedState, updatedAt: saved.updatedAt },
        shouldPersist: false
      };
    }
    await ensureWorkspaceKey(userId);
    return { state: createDefaultWorkspace(userId), shouldPersist: true };
  } catch (error) {
    if (error instanceof WorkspaceLockedError) throw error;
    const cached = await readCachedWorkspace(userId);
    if (cached) return { state: normalizeWorkspaceForClient(cached), shouldPersist: false };
    if (import.meta.env.DEV) {
      console.warn("Using local workspace fallback:", error);
    }
  }
  await ensureWorkspaceKey(userId);
  return { state: createDefaultWorkspace(userId), shouldPersist: false };
}

export async function loadWorkspace(userId: string): Promise<WorkspaceState> {
  return (await loadWorkspaceWithMetadata(userId)).state;
}

export async function fetchWorkspaceFromServer(): Promise<WorkspaceState | null> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("Missing user id");
  const payload = await fetchWorkspacePayload();
  if (payload.encryptedState) {
    const state = await decryptWorkspaceEnvelope(userId, payload.encryptedState);
    cacheEncryptedWorkspace(userId, payload.encryptedState);
    clearPlaintextWorkspaceCache();
    return normalizeWorkspaceForClient(state);
  }
  if (payload.state) return normalizeWorkspaceForClient(payload.state);
  return null;
}

async function fetchWorkspacePayload(): Promise<WorkspacePayload> {
  const response = await fetch("/api/workspace");
  if (response.status === 401) throw new Error("Not authenticated");
  if (!response.ok) throw new Error(`Workspace load failed: ${response.status}`);
  return (await response.json()) as WorkspacePayload;
}

export async function saveWorkspace(
  state: WorkspaceState,
  baseUpdatedAt: string | null
): Promise<{ updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  const stateForStorage = { ...state, updatedAt };
  const encryptedState = await encryptWorkspaceState(state.userId, stateForStorage);
  cacheEncryptedWorkspace(state.userId, encryptedState);
  clearPlaintextWorkspaceCache();
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encryptedState, baseUpdatedAt })
  });
  if (response.status === 409) {
    const payload = (await response.json()) as {
      state?: WorkspaceState | null;
      encryptedState?: EncryptedWorkspaceEnvelope | null;
      serverUpdatedAt?: string | null;
    };
    let serverState = payload.state ? normalizeWorkspaceForClient(payload.state) : null;
    if (!serverState && payload.encryptedState) {
      serverState = normalizeWorkspaceForClient(
        await decryptWorkspaceEnvelope(state.userId, payload.encryptedState)
      );
    }
    throw new WorkspaceConflictError(
      serverState,
      payload.serverUpdatedAt || null
    );
  }
  if (!response.ok) {
    throw new Error(`Workspace save failed: ${response.status}`);
  }
  const payload = (await response.json()) as { updatedAt?: string };
  return { updatedAt: payload.updatedAt || updatedAt };
}

async function readCachedWorkspace(userId: string): Promise<WorkspaceState | null> {
  try {
    const encrypted = readCachedEncryptedWorkspace(userId);
    if (encrypted) return decryptWorkspaceEnvelope(userId, encrypted);
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? (JSON.parse(raw) as WorkspaceState) : null;
  } catch {
    return null;
  }
}

export async function ensureUserTimezone(): Promise<void> {
  try {
    const response = await fetch("/api/user/timezone");
    if (!response.ok) return;
    const data = (await response.json()) as { timezone?: string | null };
    if (data.timezone) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    await fetch("/api/user/timezone", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone })
    });
  } catch {
    // Timezone improves date rendering, but the editor should still load without it.
  }
}

export function clearWorkspaceCache(): void {
  try {
    const userId = getCurrentUserId();
    if (userId) {
      clearEncryptedWorkspaceCache(userId);
      removeWorkspaceKey(userId);
    }
    clearPlaintextWorkspaceCache();
  } catch {
    // Local cache is best-effort only.
  }
}

function clearPlaintextWorkspaceCache(): void {
  try {
    localStorage.removeItem(LOCAL_CACHE_KEY);
  } catch {
    // Local cache is best-effort only.
  }
}

export async function deleteAccount(confirmation: string): Promise<void> {
  const response = await fetch("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation })
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: string };
      detail = payload.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Account deletion failed: ${response.status}`);
  }
  clearWorkspaceCache();
}

export type ChatGptGrantStatus = {
  active: boolean;
  expiresAt: string | null;
  createdAt?: string | null;
};

export async function fetchChatGptGrantStatus(): Promise<ChatGptGrantStatus> {
  const response = await fetch("/api/workspace/chatgpt-grant");
  if (!response.ok) throw new Error(`Grant status failed: ${response.status}`);
  return (await response.json()) as ChatGptGrantStatus;
}

export async function grantChatGptAccess(userId: string): Promise<ChatGptGrantStatus> {
  const workspaceKey = exportWorkspaceKey(userId);
  if (!workspaceKey) throw new Error("Recovery key is missing in this browser.");
  const response = await fetch("/api/workspace/chatgpt-grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceKey })
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `Grant failed: ${response.status}`);
  }
  return (await response.json()) as ChatGptGrantStatus;
}

export async function revokeChatGptAccess(): Promise<ChatGptGrantStatus> {
  const response = await fetch("/api/workspace/chatgpt-grant", { method: "DELETE" });
  if (!response.ok) throw new Error(`Grant revoke failed: ${response.status}`);
  return (await response.json()) as ChatGptGrantStatus;
}

function getCurrentUserId(): string | null {
  return window.__EH_BOOTSTRAP__?.user?.id || null;
}

type WorkspacePayload = {
  state?: WorkspaceState | null;
  encryptedState?: EncryptedWorkspaceEnvelope | null;
};
