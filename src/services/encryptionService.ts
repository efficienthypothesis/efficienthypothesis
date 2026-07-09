import type { WorkspaceState } from "../types";

const KEY_PREFIX = "eh_workspace_key_v1:";
const ENCRYPTED_CACHE_PREFIX = "eh_workspace_encrypted_cache_v1:";
const AAD = "efficient-hypothesis-workspace-v1";

export type EncryptedWorkspaceEnvelope = {
  storage: "encrypted";
  encryptionVersion: 1;
  algorithm: "AES-GCM";
  keyScheme: "browser-held-v1";
  userId: string;
  createdAt?: string;
  updatedAt: string;
  nonce: string;
  ciphertext: string;
};

export class WorkspaceLockedError extends Error {
  constructor() {
    super("This legacy encrypted workspace needs a recovery key before it can be migrated.");
    this.name = "WorkspaceLockedError";
  }
}

export function importWorkspaceKey(userId: string, key: string): void {
  const normalized = key.trim();
  const bytes = base64ToBytes(normalized);
  if (bytes.length !== 32) {
    throw new Error("Recovery key must decode to 32 bytes.");
  }
  localStorage.setItem(keyStorageKey(userId), normalized);
}

export async function decryptWorkspaceEnvelope(
  userId: string,
  envelope: EncryptedWorkspaceEnvelope
): Promise<WorkspaceState> {
  const key = getStoredWorkspaceKey(userId);
  if (!key) throw new WorkspaceLockedError();
  const cryptoKey = await importAesKey(key);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(envelope.nonce)),
      additionalData: new TextEncoder().encode(AAD)
    },
    cryptoKey,
    toArrayBuffer(base64ToBytes(envelope.ciphertext))
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as WorkspaceState;
}

export function readCachedEncryptedWorkspace(userId: string): EncryptedWorkspaceEnvelope | null {
  try {
    const raw = localStorage.getItem(encryptedCacheKey(userId));
    return raw ? (JSON.parse(raw) as EncryptedWorkspaceEnvelope) : null;
  } catch {
    return null;
  }
}

export function clearWorkspaceEncryptionArtifacts(userId: string): void {
  try {
    localStorage.removeItem(keyStorageKey(userId));
    localStorage.removeItem(encryptedCacheKey(userId));
  } catch {
    // Local cache is best-effort only.
  }
}

function getStoredWorkspaceKey(userId: string): string | null {
  try {
    return localStorage.getItem(keyStorageKey(userId));
  } catch {
    return null;
  }
}

async function importAesKey(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(base64ToBytes(key)), "AES-GCM", false, [
    "decrypt"
  ]);
}

function keyStorageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function encryptedCacheKey(userId: string): string {
  return `${ENCRYPTED_CACHE_PREFIX}${userId}`;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
