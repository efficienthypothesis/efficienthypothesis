import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/encryptionService", () => ({
  WorkspaceLockedError: class WorkspaceLockedError extends Error {},
  clearWorkspaceEncryptionArtifacts: vi.fn(),
  decryptWorkspaceEnvelope: vi.fn(
    async (_userId: string, envelope: { state: unknown }) => envelope.state,
  ),
  importWorkspaceKey: vi.fn(),
  readCachedEncryptedWorkspace: vi.fn(() => null),
}));

import { createDefaultWorkspace } from "../services/defaultWorkspace";
import {
  loadWorkspaceWithMetadata,
  saveWorkspace,
} from "../services/workspaceService";

describe("workspace service", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks a brand-new server workspace for first plaintext persistence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ state: null, encryptedState: null }),
      })),
    );

    const result = await loadWorkspaceWithMetadata("user_1");

    expect(result.shouldPersist).toBe(true);
    expect(result.state.userId).toBe("user_1");
    expect(result.state.documents.tasks.blocks[0]).toMatchObject({
      type: "section",
      label: "Tasks",
    });
  });

  it("saves plaintext workspace state", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ updatedAt: "2026-07-09T12:00:00.000Z" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const state = createDefaultWorkspace("user_1");
    await saveWorkspace(state, null);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspace",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"state"'),
      }),
    );
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(requestInit.body as string) as {
      state?: unknown;
      encryptedState?: unknown;
    };
    expect(body.state).toBeTruthy();
    expect(body.encryptedState).toBeUndefined();
  });

  it("migrates legacy encrypted workspace payloads to plaintext", async () => {
    const legacyState = createDefaultWorkspace("user_1");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ updatedAt: "2026-07-09T12:00:00.000Z" }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          state: null,
          encryptedState: {
            storage: "encrypted",
            encryptionVersion: 1,
            algorithm: "AES-GCM",
            keyScheme: "browser-held-v1",
            userId: "user_1",
            updatedAt: "2026-07-09T11:00:00.000Z",
            nonce: "nonce",
            ciphertext: "ciphertext",
            state: legacyState,
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadWorkspaceWithMetadata("user_1");

    expect(result.shouldPersist).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, requestInit] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(requestInit.body as string) as {
      state?: unknown;
      encryptedState?: unknown;
      baseUpdatedAt?: string | null;
    };
    expect(body.state).toBeTruthy();
    expect(body.encryptedState).toBeUndefined();
    expect(body.baseUpdatedAt).toBe("2026-07-09T11:00:00.000Z");
  });

  it("does not auto-persist a default workspace after a server load failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );

    const result = await loadWorkspaceWithMetadata("user_1");

    expect(result.shouldPersist).toBe(false);
    expect(result.state.userId).toBe("user_1");
  });

  it("does not use another user's plaintext cache during a server failure", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) =>
        key === "eh_workspace_cache_v1:user_2"
          ? JSON.stringify(createDefaultWorkspace("user_2"))
          : null,
      ),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );

    const result = await loadWorkspaceWithMetadata("user_1");

    expect(result.state.userId).toBe("user_1");
    expect(result.shouldPersist).toBe(false);
  });

  it("writes plaintext cache under the authenticated user's key", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ updatedAt: "2026-07-09T12:00:00.000Z" }),
      })),
    );

    await saveWorkspace(createDefaultWorkspace("user_1"), null);

    expect(setItem).toHaveBeenCalledWith(
      "eh_workspace_cache_v1:user_1",
      expect.any(String),
    );
  });

  it("keeps a pending per-user cache when a save fails", async () => {
    const state = createDefaultWorkspace("user_1");
    const cache = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => cache.get(key) || null),
      removeItem: vi.fn((key: string) => cache.delete(key)),
      setItem: vi.fn((key: string, value: string) => cache.set(key, value)),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );

    await expect(saveWorkspace(state, null)).rejects.toThrow("Workspace save failed: 503");

    expect(cache.has("eh_workspace_pending_v1:user_1")).toBe(true);
  });
});
