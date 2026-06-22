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
    super("This workspace is encrypted. Import the recovery key to unlock it in this browser.");
    this.name = "WorkspaceLockedError";
  }
}

export function workspaceKeyExists(userId: string): boolean {
  return Boolean(getStoredWorkspaceKey(userId));
}

export async function ensureWorkspaceKey(userId: string): Promise<string> {
  const existing = getStoredWorkspaceKey(userId);
  if (existing) return existing;
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = bytesToBase64(raw);
  localStorage.setItem(keyStorageKey(userId), key);
  return key;
}

export function exportWorkspaceKey(userId: string): string | null {
  return getStoredWorkspaceKey(userId);
}

export function importWorkspaceKey(userId: string, key: string): void {
  const normalized = key.trim();
  const bytes = base64ToBytes(normalized);
  if (bytes.length !== 32) {
    throw new Error("Recovery key must decode to 32 bytes.");
  }
  localStorage.setItem(keyStorageKey(userId), normalized);
}

export function removeWorkspaceKey(userId: string): void {
  localStorage.removeItem(keyStorageKey(userId));
}

export async function encryptWorkspaceState(
  userId: string,
  state: WorkspaceState
): Promise<EncryptedWorkspaceEnvelope> {
  const key = await ensureWorkspaceKey(userId);
  const cryptoKey = await importAesKey(key);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(AAD) },
    cryptoKey,
    plaintext
  );
  return {
    storage: "encrypted",
    encryptionVersion: 1,
    algorithm: "AES-GCM",
    keyScheme: "browser-held-v1",
    userId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
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

export function cacheEncryptedWorkspace(userId: string, envelope: EncryptedWorkspaceEnvelope): void {
  try {
    localStorage.setItem(encryptedCacheKey(userId), JSON.stringify(envelope));
  } catch {
    // Local cache is best-effort only.
  }
}

export function readCachedEncryptedWorkspace(userId: string): EncryptedWorkspaceEnvelope | null {
  try {
    const raw = localStorage.getItem(encryptedCacheKey(userId));
    return raw ? (JSON.parse(raw) as EncryptedWorkspaceEnvelope) : null;
  } catch {
    return null;
  }
}

export function clearEncryptedWorkspaceCache(userId: string): void {
  try {
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
    "encrypt",
    "decrypt"
  ]);
}

function keyStorageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function encryptedCacheKey(userId: string): string {
  return `${ENCRYPTED_CACHE_PREFIX}${userId}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
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
