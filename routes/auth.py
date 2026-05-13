from flask import Blueprint, request, redirect, url_for, session, jsonify
from google.oauth2 import id_token
from google.auth.transport import requests
import datetime
from config import GOOGLE_CLIENT_ID, user_table

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/auth/callback', methods=['POST'])
def auth_callback():
    data = request.get_json()
    token = data.get("credential")
    try:
        idinfo = id_token.verify_oauth2_token(token, requests.Request(), GOOGLE_CLIENT_ID)
        user_id = idinfo["sub"]
        email = idinfo["email"]
        name = idinfo.get("name", "")
        picture = idinfo.get("picture", "")

        session["user"] = {"id": user_id, "email": email, "name": name, "picture": picture}

        # Update user record. Set created_at only if it doesn't exist yet.
        now_iso = datetime.datetime.utcnow().isoformat() + 'Z'
        user_table.update_item(
            Key={"user_id": user_id},
            UpdateExpression="SET email = :e, #n = :n, picture = :p"
                             ", created_at = if_not_exists(created_at, :now)",
            ExpressionAttributeNames={"#n": "name"},
            ExpressionAttributeValues={
                ":e": email, ":n": name, ":p": picture, ":now": now_iso,
            },
        )

        oauth_next = session.pop("oauth_next", None)
        resp_data = {"message": "Login successful", "user": session["user"]}
        if oauth_next:
            resp_data["redirect"] = oauth_next
        return jsonify(resp_data), 200
    except ValueError as e:
        print("Login error:", e)
        return jsonify({"error": "Invalid token"}), 400


@auth_bp.route('/logout')
def logout():
    session.pop("user", None)
    return redirect(url_for('pages.home'))
