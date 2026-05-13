from flask import Blueprint, request, jsonify
import datetime
import uuid
import json
from config import s3, PRODUCTIVITY_BUCKET, _require_auth, _validate_date_range

notes_bp = Blueprint('notes', __name__)


def _notes_s3_key(email):
    return f"{email}/notes.json"


def _load_notes(email):
    key = _notes_s3_key(email)
    try:
        obj = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
        return json.loads(obj["Body"].read().decode("utf-8"))
    except Exception:
        return {"notes": []}


def _save_notes(email, data):
    key = _notes_s3_key(email)
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(data, indent=2),
        ContentType="application/json",
    )


@notes_bp.route('/api/notes', methods=['GET'])
def api_notes_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    return jsonify(_load_notes(email))


@notes_bp.route('/api/notes', methods=['POST'])
def api_notes_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    name = data.get("name", "").strip()
    date = data.get("date", "").strip()
    folder = data.get("folder")

    if not name:
        return jsonify({"error": "name is required"}), 400
    if not date:
        return jsonify({"error": "date is required"}), 400
    date_err = _validate_date_range(date)
    if date_err:
        return jsonify({"error": date_err}), 400

    note = {
        "id": str(uuid.uuid4()),
        "name": name,
        "date": date,
        "folder": folder,
        "created_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
    }

    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])
    notes.append(note)
    notes_data["notes"] = notes
    _save_notes(email, notes_data)
    return jsonify({"ok": True, "note": note}), 201


@notes_bp.route('/api/notes/<note_id>', methods=['PUT'])
def api_notes_update(note_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()

    if "date" in data:
        date_err = _validate_date_range(data["date"])
        if date_err:
            return jsonify({"error": date_err}), 400

    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])

    found = False
    for n in notes:
        if n["id"] == note_id:
            if "name" in data:
                n["name"] = data["name"]
            if "date" in data:
                n["date"] = data["date"]
            if "folder" in data:
                n["folder"] = data["folder"]
            found = True
            break

    if not found:
        return jsonify({"error": "Note not found"}), 404

    notes_data["notes"] = notes
    _save_notes(email, notes_data)
    return jsonify({"ok": True})


@notes_bp.route('/api/notes/<note_id>', methods=['DELETE'])
def api_notes_delete(note_id):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]

    notes_data = _load_notes(email)
    notes = notes_data.get("notes", [])
    new_notes = [n for n in notes if n["id"] != note_id]

    if len(new_notes) == len(notes):
        return jsonify({"error": "Note not found"}), 404

    notes_data["notes"] = new_notes
    _save_notes(email, notes_data)
    return jsonify({"ok": True})
