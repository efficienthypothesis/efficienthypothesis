import base64
import json

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AAD = b"efficient-hypothesis-workspace-v1"


def is_encrypted_workspace(value):
    return (
        isinstance(value, dict)
        and value.get("storage") == "encrypted"
        and value.get("encryptionVersion") == 1
        and value.get("algorithm") == "AES-GCM"
    )


def encrypted_workspace_updated_at(value):
    if is_encrypted_workspace(value):
        return value.get("updatedAt")
    if isinstance(value, dict):
        return value.get("updatedAt")
    return None


def decrypt_workspace_envelope(envelope, workspace_key_b64):
    if not is_encrypted_workspace(envelope):
        raise ValueError("Workspace is not encrypted")
    key = _decode_workspace_key(workspace_key_b64)
    nonce = _b64decode(envelope.get("nonce", ""))
    ciphertext = _b64decode(envelope.get("ciphertext", ""))
    plaintext = AESGCM(key).decrypt(nonce, ciphertext, AAD)
    state = json.loads(plaintext.decode("utf-8"))
    if not isinstance(state, dict):
        raise ValueError("Encrypted workspace did not decode to an object")
    return state


def _decode_workspace_key(workspace_key_b64):
    try:
        key = _b64decode(str(workspace_key_b64 or "").strip())
    except Exception as exc:
        raise ValueError("Invalid workspace recovery key") from exc
    if len(key) != 32:
        raise ValueError("Workspace recovery key must decode to 32 bytes")
    return key


def _b64decode(value):
    return base64.b64decode(value, validate=True)
