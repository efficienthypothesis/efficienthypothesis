from flask import Flask
from apig_wsgi import make_lambda_handler
import os


def _required_env(name):
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} environment variable is required")
    return value


app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = _required_env("FLASK_SECRET_KEY")
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = (
    os.getenv("SESSION_COOKIE_SECURE", "1").lower() not in {"0", "false", "no"}
)

# Register blueprints
from routes.pages import pages_bp
from routes.auth import auth_bp
from routes.oauth import oauth_bp
from routes.mcp import mcp_bp
from routes.workspace import workspace_bp
from routes.account import account_bp

app.register_blueprint(pages_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(oauth_bp)
app.register_blueprint(mcp_bp)
app.register_blueprint(workspace_bp)
app.register_blueprint(account_bp)

handler = make_lambda_handler(app, binary_support=True)

if __name__ == "__main__":
    app.run(debug=True)
