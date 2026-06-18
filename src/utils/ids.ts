export function makeId(prefix: string): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) {
    return `${prefix}_${cryptoObj.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
