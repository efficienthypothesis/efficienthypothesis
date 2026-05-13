from flask import Blueprint, request, jsonify
import datetime
import json
from config import s3, PRODUCTIVITY_BUCKET, _require_auth

goals_bp = Blueprint('goals', __name__)


def _goals_prefix(email):
    return f"{email}/goals/"


def _data_prefix(email):
    return f"{email}/data/"


@goals_bp.route('/api/goals', methods=['GET'])
def api_goals_list():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    prefix = _goals_prefix(email)
    try:
        resp = s3.list_objects_v2(Bucket=PRODUCTIVITY_BUCKET, Prefix=prefix)
        goals = []
        for obj in resp.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".json"):
                continue
            name = key[len(prefix):].replace(".json", "")
            body = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)["Body"].read().decode("utf-8")
            goal = json.loads(body)
            goal["name"] = name
            goals.append(goal)
        return jsonify(goals)
    except Exception:
        return jsonify([])


@goals_bp.route('/api/goals', methods=['POST'])
def api_goals_create():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    name = data.get("name", "").strip().lower().replace(" ", "_")
    if not name:
        return jsonify({"error": "name is required"}), 400

    goal = {
        "display_name": data.get("display_name", name),
        "fields": data.get("fields", []),
        "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
    }
    key = _goals_prefix(email) + name + ".json"
    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(goal, indent=2),
        ContentType="application/json",
    )
    goal["name"] = name
    return jsonify(goal), 201


@goals_bp.route('/api/goals/<goal_name>', methods=['PUT'])
def api_goals_update(goal_name):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    key = _goals_prefix(email) + goal_name + ".json"

    try:
        body = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)["Body"].read().decode("utf-8")
        goal = json.loads(body)
    except Exception:
        return jsonify({"error": "Goal not found"}), 404

    for field in ["display_name", "fields"]:
        if field in data:
            goal[field] = data[field]

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(goal, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True})


@goals_bp.route('/api/goals/<goal_name>', methods=['DELETE'])
def api_goals_delete(goal_name):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    key = _goals_prefix(email) + goal_name + ".json"
    s3.delete_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)
    return jsonify({"ok": True})


@goals_bp.route('/api/goals/<goal_name>/data', methods=['GET'])
def api_goals_data_list(goal_name):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    date = request.args.get("date")
    prefix = _data_prefix(email) + goal_name + "/"

    if date:
        key = prefix + date + ".json"
        try:
            body = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)["Body"].read().decode("utf-8")
            return jsonify(json.loads(body))
        except Exception:
            return jsonify({"entries": []})
    else:
        try:
            resp = s3.list_objects_v2(Bucket=PRODUCTIVITY_BUCKET, Prefix=prefix)
            dates = []
            for obj in resp.get("Contents", []):
                k = obj["Key"]
                if k.endswith(".json"):
                    d = k[len(prefix):].replace(".json", "")
                    dates.append(d)
            return jsonify({"dates": sorted(dates, reverse=True)})
        except Exception:
            return jsonify({"dates": []})


@goals_bp.route('/api/goals/<goal_name>/data', methods=['POST'])
def api_goals_data_log(goal_name):
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    date = data.get("date")
    if not date:
        return jsonify({"error": "date is required"}), 400

    key = _data_prefix(email) + goal_name + "/" + date + ".json"

    try:
        body = s3.get_object(Bucket=PRODUCTIVITY_BUCKET, Key=key)["Body"].read().decode("utf-8")
        day_data = json.loads(body)
    except Exception:
        day_data = {"entries": []}

    entry = data.get("entry", {})
    entry["logged_at"] = datetime.datetime.utcnow().isoformat() + 'Z'
    day_data["entries"].append(entry)

    s3.put_object(
        Bucket=PRODUCTIVITY_BUCKET, Key=key,
        Body=json.dumps(day_data, indent=2),
        ContentType="application/json",
    )
    return jsonify({"ok": True, "count": len(day_data["entries"])}), 201
