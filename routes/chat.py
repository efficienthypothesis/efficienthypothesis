from flask import Blueprint, request, jsonify
import json
import os
import datetime
from config import dynamodb, _require_auth

chat_bp = Blueprint('chat', __name__)

# --- LLM provider config ---
# Set via Lambda environment variables:
#   CHAT_PROVIDER: "bedrock" (default) or "openai"
#   CHAT_CHEAP_MODEL: model ID for short inputs
#   CHAT_STRONG_MODEL: model ID for long inputs
#   OPENAI_API_KEY: required if CHAT_PROVIDER=openai
CHAT_PROVIDER = os.getenv("CHAT_PROVIDER", "bedrock")
CHAT_CHEAP_MODEL = os.getenv("CHAT_CHEAP_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
CHAT_STRONG_MODEL = os.getenv("CHAT_STRONG_MODEL", "us.anthropic.claude-sonnet-4-20250514-v1:0")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
INPUT_LENGTH_THRESHOLD = 2000

# --- Usage tracking ---
usage_table = dynamodb.Table("ChatUsage")
DAILY_COST_LIMIT = float(os.getenv("CHAT_DAILY_COST_LIMIT", "0.25"))

# Pricing per 1M tokens (input/output) — update as prices change
MODEL_PRICING = {
    # Bedrock Claude (inference profiles)
    "us.anthropic.claude-haiku-4-5-20251001-v1:0": (1.0, 5.0),
    "us.anthropic.claude-sonnet-4-20250514-v1:0": (3.0, 15.0),
    # Bedrock Claude (direct model IDs)
    "anthropic.claude-haiku-4-5-20251001-v1:0": (1.0, 5.0),
    "anthropic.claude-sonnet-4-20250514-v1:0": (3.0, 15.0),
    # OpenAI (kept for reference)
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.0),
}


def _load_system_prompt():
    """Load the chatbot system prompt from file."""
    prompt_path = os.path.join(os.path.dirname(__file__), '..', 'chatbot_system_prompt.txt')
    try:
        with open(prompt_path, 'r') as f:
            return f.read()
    except FileNotFoundError:
        return "You are a helpful assistant for the EfficientHypothesis productivity app."


def _select_model(user_input):
    """Route to cheap or strong model based on input length."""
    if len(user_input) >= INPUT_LENGTH_THRESHOLD:
        return CHAT_STRONG_MODEL
    return CHAT_CHEAP_MODEL


def _check_rate_limit(email):
    """Check if user has exceeded daily cost limit. Returns (ok, current_cost)."""
    today = datetime.date.today().isoformat()
    try:
        resp = usage_table.get_item(Key={"user_id": email, "date": today})
        item = resp.get("Item", {})
        current_cost = float(item.get("estimated_cost", 0))
        return current_cost < DAILY_COST_LIMIT, current_cost
    except Exception:
        return True, 0.0


def _record_usage(email, model, prompt_tokens, completion_tokens):
    """Record token usage and estimated cost for the user."""
    today = datetime.date.today().isoformat()
    input_price, output_price = MODEL_PRICING.get(model, (1.0, 5.0))
    cost = (prompt_tokens * input_price + completion_tokens * output_price) / 1_000_000

    try:
        usage_table.update_item(
            Key={"user_id": email, "date": today},
            UpdateExpression=(
                "SET prompt_tokens = if_not_exists(prompt_tokens, :zero) + :pt, "
                "completion_tokens = if_not_exists(completion_tokens, :zero) + :ct, "
                "estimated_cost = if_not_exists(estimated_cost, :fzero) + :cost, "
                "request_count = if_not_exists(request_count, :zero) + :one, "
                "model_used = :model"
            ),
            ExpressionAttributeValues={
                ":pt": prompt_tokens,
                ":ct": completion_tokens,
                ":cost": str(round(cost, 6)),
                ":model": model,
                ":zero": 0,
                ":fzero": "0",
                ":one": 1,
            },
        )
    except Exception:
        pass  # Don't fail the request if usage tracking fails


def _call_bedrock(model, system_prompt, messages):
    """Call AWS Bedrock (Claude) and return (response_text, usage_dict)."""
    import boto3
    client = boto3.client("bedrock-runtime", region_name="us-east-2")

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": messages,
    }

    response = client.invoke_model(
        modelId=model,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(body),
    )

    result = json.loads(response["body"].read())
    text = ""
    for block in result.get("content", []):
        if block.get("type") == "text":
            text += block["text"]

    usage = result.get("usage", {})
    return text, {
        "prompt_tokens": usage.get("input_tokens", 0),
        "completion_tokens": usage.get("output_tokens", 0),
    }


def _call_openai(model, system_prompt, messages):
    """Call OpenAI API via urllib and return (response_text, usage_dict)."""
    import urllib.request

    openai_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        openai_messages.append({"role": msg["role"], "content": msg["content"]})

    body = json.dumps({
        "model": model,
        "messages": openai_messages,
        "max_tokens": 4096,
    }).encode()

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}",
        },
    )

    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())

    text = result["choices"][0]["message"]["content"]
    usage = result.get("usage", {})
    return text, {
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
    }


feedback_table = dynamodb.Table("ChatFeedback")


@chat_bp.route('/api/chat/feedback', methods=['POST'])
def api_chat_feedback():
    """Record user feedback (thumbs up/down) for a chat interaction."""
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()

    import uuid
    item = {
        "feedback_id": str(uuid.uuid4()),
        "user_id": email,
        "timestamp": datetime.datetime.utcnow().isoformat() + 'Z',
        "messages": data.get("messages", []),
        "response": data.get("response", ""),
        "positive": data.get("positive", True),
    }
    try:
        feedback_table.put_item(Item=item)
    except Exception:
        pass  # Don't fail if feedback table doesn't exist yet
    return jsonify({"ok": True})


@chat_bp.route('/api/chat/execute', methods=['POST'])
def api_chat_execute():
    """Execute a confirmed plan. Called when user clicks [proceed]."""
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()
    plan = data.get("plan", [])
    if not plan:
        return jsonify({"error": "plan array is required"}), 400

    from routes.chat_executor import execute_plan
    results = execute_plan(email, plan)

    all_ok = all(r.get("ok", False) for r in results)
    return jsonify({
        "ok": all_ok,
        "results": results,
        "executed": len(results),
    }), 200 if all_ok else 207  # 207 Multi-Status if partial failure


@chat_bp.route('/api/chat', methods=['POST'])
def api_chat():
    ctx, err = _require_auth()
    if err:
        return err
    email = ctx["email"]
    data = request.get_json()

    messages = data.get("messages", [])
    if not messages:
        return jsonify({"error": "messages array is required"}), 400

    # Get the latest user message for model routing
    last_user_msg = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            last_user_msg = msg.get("content", "")
            break

    # Check rate limit
    ok, current_cost = _check_rate_limit(email)
    if not ok:
        return jsonify({
            "error": "Daily usage limit reached. Try again tomorrow.",
            "daily_cost": current_cost,
            "limit": DAILY_COST_LIMIT,
        }), 429

    # Select model and call LLM
    model = _select_model(last_user_msg)
    system_prompt = _load_system_prompt()

    # Add dynamic context: user timezone and current date (in user's timezone)
    user_tz = data.get("timezone", "UTC")
    try:
        from zoneinfo import ZoneInfo
        today_str = datetime.datetime.now(ZoneInfo(user_tz)).strftime("%Y-%m-%d")
    except Exception:
        today_str = datetime.date.today().isoformat()
    system_prompt += (
        f"\n\n=== CURRENT CONTEXT ===\n"
        f"Today's date: {today_str}\n"
        f"User's timezone: {user_tz}\n"
        f"User's email: {email}\n"
        f"\nCRITICAL RULES:\n"
        f"1. You MUST always output a human-readable summary using +/~/x prefixes followed by a ```json``` code block containing the plan array.\n"
        f"2. NEVER say you have already done something — you are PROPOSING a plan for the user to confirm.\n"
        f"3. NEVER give generic advice. Your ONLY job is to produce structured plans that create/update/delete items.\n"
        f"4. If the user asks to create a task, respond with the + prefix summary and the JSON plan to create it. Do NOT give tips or preparation advice."
    )

    try:
        if CHAT_PROVIDER == "openai":
            response_text, usage = _call_openai(model, system_prompt, messages)
        else:
            response_text, usage = _call_bedrock(model, system_prompt, messages)
    except Exception as e:
        return jsonify({"error": f"LLM call failed: {str(e)}"}), 502

    # Record usage
    _record_usage(email, model, usage["prompt_tokens"], usage["completion_tokens"])

    return jsonify({
        "response": response_text,
        "model": model,
        "usage": usage,
    })
