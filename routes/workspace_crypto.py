import base64
import datetime
import json
import os
from copy import deepcopy

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


def encrypt_workspace_state(state, workspace_key_b64, user_id=None, updated_at=None):
    key = _decode_workspace_key(workspace_key_b64)
    updated = updated_at or _now_iso()
    state_for_storage = deepcopy(state)
    state_for_storage["updatedAt"] = updated
    if user_id:
        state_for_storage["userId"] = user_id
    plaintext = json.dumps(state_for_storage, separators=(",", ":")).encode("utf-8")
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, AAD)
    return {
        "storage": "encrypted",
        "encryptionVersion": 1,
        "algorithm": "AES-GCM",
        "keyScheme": "browser-held-v1",
        "userId": state_for_storage.get("userId") or user_id or "",
        "createdAt": state_for_storage.get("createdAt"),
        "updatedAt": updated,
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }


def validate_workspace_key(workspace_key_b64):
    _decode_workspace_key(workspace_key_b64)


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


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
