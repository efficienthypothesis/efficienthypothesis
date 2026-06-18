from flask import Flask
from apig_wsgi import make_lambda_handler
import os

app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = os.getenv("FLASK_SECRET_KEY", "eh_replace_this_with_secure_key")
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# Register blueprints
from routes.pages import pages_bp
from routes.auth import auth_bp
from routes.tasks import tasks_bp
from routes.drafts import drafts_bp
from routes.routines import routines_bp
from routes.goals import goals_bp
from routes.folders import folders_bp
from routes.notes import notes_bp
from routes.actions import actions_bp
from routes.schedules import schedules_bp
from routes.homescreen import homescreen_bp
from routes.oauth import oauth_bp
from routes.chat import chat_bp
from routes.timelogs import timelogs_bp
from routes.mobile_auth import mobile_auth_bp
from routes.mcp import mcp_bp
from routes.workspace import workspace_bp

app.register_blueprint(pages_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(tasks_bp)
app.register_blueprint(drafts_bp)
app.register_blueprint(routines_bp)
app.register_blueprint(goals_bp)
app.register_blueprint(folders_bp)
app.register_blueprint(notes_bp)
app.register_blueprint(actions_bp)
app.register_blueprint(schedules_bp)
app.register_blueprint(homescreen_bp)
app.register_blueprint(oauth_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(timelogs_bp)
app.register_blueprint(mobile_auth_bp)
app.register_blueprint(mcp_bp)
app.register_blueprint(workspace_bp)

handler = make_lambda_handler(app, binary_support=True)

if __name__ == "__main__":
    app.run(debug=True)
