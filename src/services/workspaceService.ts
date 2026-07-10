import type { WorkspaceState } from "../types";
import { createDefaultWorkspace } from "./defaultWorkspace";
import {
  type EncryptedWorkspaceEnvelope,
  WorkspaceLockedError,
  clearWorkspaceEncryptionArtifacts,
  decryptWorkspaceEnvelope,
  importWorkspaceKey,
  readCachedEncryptedWorkspace,
} from "./encryptionService";
import { normalizeWorkspaceForClient } from "./nodeService";

const LOCAL_CACHE_PREFIX = "eh_workspace_cache_v1:";
const LEGACY_LOCAL_CACHE_KEY = "eh_workspace_cache_v1";

export { WorkspaceLockedError, importWorkspaceKey };

export class WorkspaceConflictError extends Error {
  serverState: WorkspaceState | null;
  serverUpdatedAt: string | null;

  constructor(
    serverState: WorkspaceState | null,
    serverUpdatedAt: string | null,
  ) {
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

export async function loadWorkspaceWithMetadata(
  userId: string,
): Promise<LoadWorkspaceResult> {
  try {
    const payload = await fetchWorkspacePayload();
    if (payload.state) {
      clearWorkspaceEncryptionArtifacts(userId);
      const normalizedState = normalizeWorkspaceForClient(payload.state);
      cachePlaintextWorkspace(normalizedState);
      return {
        state: normalizedState,
        shouldPersist: false,
      };
    }
    if (payload.encryptedState) {
      const serverUpdatedAt = payload.encryptedState.updatedAt || null;
      const serverState = await decryptWorkspaceEnvelope(
        userId,
        payload.encryptedState,
      );
      const normalizedState = normalizeWorkspaceForClient(serverState);
      const migrationState = {
        ...normalizedState,
        updatedAt: serverUpdatedAt || normalizedState.updatedAt,
      };
      try {
        const saved = await saveWorkspace(migrationState, serverUpdatedAt);
        return {
          state: { ...migrationState, updatedAt: saved.updatedAt },
          shouldPersist: false,
        };
      } catch (saveError) {
        if (import.meta.env.DEV) {
          console.warn(
            "Loaded legacy encrypted workspace but could not persist plaintext migration:",
            saveError,
          );
        }
      }
      return { state: migrationState, shouldPersist: false };
    }
    return { state: createDefaultWorkspace(userId), shouldPersist: true };
  } catch (error) {
    if (error instanceof WorkspaceLockedError) throw error;
    const cached = await readCachedWorkspace(userId);
    if (cached)
      return {
        state: normalizeWorkspaceForClient(cached),
        shouldPersist: false,
      };
    if (import.meta.env.DEV) {
      console.warn("Using local workspace fallback:", error);
    }
  }
  return { state: createDefaultWorkspace(userId), shouldPersist: false };
}

export async function loadWorkspace(userId: string): Promise<WorkspaceState> {
  return (await loadWorkspaceWithMetadata(userId)).state;
}

export async function fetchWorkspaceFromServer(): Promise<WorkspaceState | null> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("Missing user id");
  const payload = await fetchWorkspacePayload();
  if (payload.state) {
    clearWorkspaceEncryptionArtifacts(userId);
    const state = normalizeWorkspaceForClient(payload.state);
    cachePlaintextWorkspace(state);
    return state;
  }
  if (payload.encryptedState) {
    const state = normalizeWorkspaceForClient(
      await decryptWorkspaceEnvelope(userId, payload.encryptedState),
    );
    return state;
  }
  return null;
}

async function fetchWorkspacePayload(): Promise<WorkspacePayload> {
  const response = await fetch("/api/workspace");
  if (response.status === 401) throw new Error("Not authenticated");
  if (!response.ok)
    throw new Error(`Workspace load failed: ${response.status}`);
  return (await response.json()) as WorkspacePayload;
}

export async function saveWorkspace(
  state: WorkspaceState,
  baseUpdatedAt: string | null,
): Promise<{ updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  const stateForStorage = { ...state, updatedAt };
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: stateForStorage, baseUpdatedAt }),
  });
  if (response.status === 409) {
    const payload = (await response.json()) as {
      state?: WorkspaceState | null;
      encryptedState?: EncryptedWorkspaceEnvelope | null;
      serverUpdatedAt?: string | null;
    };
    let serverState = payload.state
      ? normalizeWorkspaceForClient(payload.state)
      : null;
    if (!serverState && payload.encryptedState) {
      serverState = normalizeWorkspaceForClient(
        await decryptWorkspaceEnvelope(state.userId, payload.encryptedState),
      );
    }
    throw new WorkspaceConflictError(
      serverState,
      payload.serverUpdatedAt || null,
    );
  }
  if (!response.ok) {
    throw new Error(`Workspace save failed: ${response.status}`);
  }
  const payload = (await response.json()) as { updatedAt?: string };
  clearWorkspaceEncryptionArtifacts(state.userId);
  cachePlaintextWorkspace({
    ...stateForStorage,
    updatedAt: payload.updatedAt || updatedAt,
  });
  return { updatedAt: payload.updatedAt || updatedAt };
}

async function readCachedWorkspace(
  userId: string,
): Promise<WorkspaceState | null> {
  clearLegacyPlaintextWorkspaceCache();
  try {
    const raw = localStorage.getItem(localCacheKey(userId));
    if (raw) {
      const cached = JSON.parse(raw) as WorkspaceState;
      if (cached.userId === userId) return cached;
      clearPlaintextWorkspaceCache(userId);
    }
  } catch {
    clearPlaintextWorkspaceCache(userId);
  }
  try {
    const encrypted = readCachedEncryptedWorkspace(userId);
    if (encrypted) return decryptWorkspaceEnvelope(userId, encrypted);
  } catch {
    return null;
  }
  return null;
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
      body: JSON.stringify({ timezone }),
    });
  } catch {
    // Timezone improves date rendering, but the editor should still load without it.
  }
}

export function clearWorkspaceCache(): void {
  try {
    const userId = getCurrentUserId();
    if (userId) {
      clearWorkspaceEncryptionArtifacts(userId);
      clearPlaintextWorkspaceCache(userId);
    }
    clearLegacyPlaintextWorkspaceCache();
  } catch {
    // Local cache is best-effort only.
  }
}

function clearPlaintextWorkspaceCache(userId: string): void {
  try {
    localStorage.removeItem(localCacheKey(userId));
  } catch {
    // Local cache is best-effort only.
  }
}

function clearLegacyPlaintextWorkspaceCache(): void {
  try {
    localStorage.removeItem(LEGACY_LOCAL_CACHE_KEY);
  } catch {
    // Local cache is best-effort only.
  }
}

function cachePlaintextWorkspace(state: WorkspaceState): void {
  try {
    localStorage.setItem(localCacheKey(state.userId), JSON.stringify(state));
  } catch {
    // Local cache is best-effort only.
  }
}

function localCacheKey(userId: string): string {
  return `${LOCAL_CACHE_PREFIX}${userId}`;
}

export async function deleteAccount(confirmation: string): Promise<void> {
  const response = await fetch("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation }),
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

function getCurrentUserId(): string | null {
  return window.__EH_BOOTSTRAP__?.user?.id || null;
}

type WorkspacePayload = {
  state?: WorkspaceState | null;
  encryptedState?: EncryptedWorkspaceEnvelope | null;
};
