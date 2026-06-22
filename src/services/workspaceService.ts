import type { WorkspaceState } from "../types";
import { createDefaultWorkspace } from "./defaultWorkspace";
import { ensureTagDocumentBlocks } from "./nodeService";

const LOCAL_CACHE_KEY = "eh_workspace_cache_v1";

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

export async function loadWorkspace(userId: string): Promise<WorkspaceState> {
  try {
    const serverState = await fetchWorkspaceFromServer();
    if (serverState) {
      const normalizedState = ensureTagDocumentBlocks(serverState);
      cacheWorkspace(normalizedState);
      return normalizedState;
    }
  } catch (error) {
    const cached = readCachedWorkspace();
    if (cached) return ensureTagDocumentBlocks(cached);
    if (import.meta.env.DEV) {
      console.warn("Using local workspace fallback:", error);
    }
  }
  return createDefaultWorkspace(userId);
}

export async function fetchWorkspaceFromServer(): Promise<WorkspaceState | null> {
  const response = await fetch("/api/workspace");
  if (response.status === 401) throw new Error("Not authenticated");
  if (!response.ok) throw new Error(`Workspace load failed: ${response.status}`);
  const payload = (await response.json()) as { state: WorkspaceState | null };
  return payload.state ? ensureTagDocumentBlocks(payload.state) : null;
}

export async function saveWorkspace(
  state: WorkspaceState,
  baseUpdatedAt: string | null
): Promise<{ updatedAt: string }> {
  cacheWorkspace(state);
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, baseUpdatedAt })
  });
  if (response.status === 409) {
    const payload = (await response.json()) as {
      state?: WorkspaceState | null;
      serverUpdatedAt?: string | null;
    };
    throw new WorkspaceConflictError(
      payload.state ? ensureTagDocumentBlocks(payload.state) : null,
      payload.serverUpdatedAt || null
    );
  }
  if (!response.ok) {
    throw new Error(`Workspace save failed: ${response.status}`);
  }
  const payload = (await response.json()) as { updatedAt?: string };
  return { updatedAt: payload.updatedAt || state.updatedAt };
}

function cacheWorkspace(state: WorkspaceState): void {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(state));
  } catch {
    // Local cache is best-effort only.
  }
}

function readCachedWorkspace(): WorkspaceState | null {
  try {
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
