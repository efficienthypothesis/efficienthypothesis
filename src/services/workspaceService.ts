import type { WorkspaceState } from "../types";
import { createDefaultWorkspace } from "./defaultWorkspace";

const LOCAL_CACHE_KEY = "eh_workspace_cache_v1";

export async function loadWorkspace(userId: string): Promise<WorkspaceState> {
  try {
    const response = await fetch("/api/workspace");
    if (response.status === 401) throw new Error("Not authenticated");
    if (!response.ok) throw new Error(`Workspace load failed: ${response.status}`);
    const payload = (await response.json()) as { state: WorkspaceState | null };
    if (payload.state) {
      cacheWorkspace(payload.state);
      return payload.state;
    }
  } catch (error) {
    const cached = readCachedWorkspace();
    if (cached) return cached;
    if (import.meta.env.DEV) {
      console.warn("Using local workspace fallback:", error);
    }
  }
  return createDefaultWorkspace(userId);
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  cacheWorkspace(state);
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state })
  });
  if (!response.ok) {
    throw new Error(`Workspace save failed: ${response.status}`);
  }
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
