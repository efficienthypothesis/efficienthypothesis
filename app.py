from flask import Flask
from apig_wsgi import make_lambda_handler
import os

app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = os.getenv("FLASK_SECRET_KEY", "eh_replace_this_with_secure_key")
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

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
