import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/encryptionService", () => ({
  WorkspaceLockedError: class WorkspaceLockedError extends Error {},
  cacheEncryptedWorkspace: vi.fn(),
  clearEncryptedWorkspaceCache: vi.fn(),
  decryptWorkspaceEnvelope: vi.fn(async (_userId: string, envelope: { state: unknown }) => envelope.state),
  encryptWorkspaceState: vi.fn(async (_userId: string, state: { updatedAt: string }) => ({
    storage: "encrypted",
    encryptionVersion: 1,
    algorithm: "AES-GCM",
    keyScheme: "browser-held-v1",
    userId: _userId,
    createdAt: state.updatedAt,
    updatedAt: state.updatedAt,
    nonce: "nonce",
    ciphertext: "ciphertext"
  })),
  ensureWorkspaceKey: vi.fn(async () => "workspace-key"),
  exportWorkspaceKey: vi.fn(() => "workspace-key"),
  importWorkspaceKey: vi.fn(),
  removeWorkspaceKey: vi.fn(),
  readCachedEncryptedWorkspace: vi.fn(() => null)
}));

import { loadWorkspaceWithMetadata } from "../services/workspaceService";

describe("workspace service", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn()
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks a brand-new server workspace for first encrypted persistence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ state: null, encryptedState: null })
      }))
    );

    const result = await loadWorkspaceWithMetadata("user_1");

    expect(result.shouldPersist).toBe(true);
    expect(result.state.userId).toBe("user_1");
    expect(result.state.documents.tasks.blocks[0]).toMatchObject({
      type: "section",
      label: "Tasks"
    });
  });

  it("does not auto-persist a default workspace after a server load failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({})
      }))
    );

    const result = await loadWorkspaceWithMetadata("user_1");

    expect(result.shouldPersist).toBe(false);
    expect(result.state.userId).toBe("user_1");
  });
});
