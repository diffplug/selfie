# app.py
import base64
import hashlib
import secrets
import threading
import time
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Flask,
    jsonify,
    make_response,
    redirect,
    render_template_string,
    request,
)

app = Flask(__name__)

# In-memory database (replace with a real database in production)
database = {}

# Email storage for development
email_storage = []
email_lock = threading.Lock()
email_condition = threading.Condition(email_lock)


class DevTime:
    def __init__(self):
        self.now = datetime(2000, 1, 1)

    def set_year(self, year):
        self.now = datetime(year, 1, 1)

    def advance_24hrs(self):
        self.now += timedelta(days=1)

    def now(self):
        return self.now


dev_time = DevTime()


def repeatable_random(length):
    # This is a simplified version, not as secure as Java's SecureRandom
    return "".join(
        secrets.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        for _ in range(length)
    )


def send_email(to_email, subject, html_content):
    email = {"to": to_email, "subject": subject, "html_content": html_content}
    with email_lock:
        email_storage.append(email)
        email_condition.notify_all()


def sign_email(email):
    terrible_security = "password"
    return base64.urlsafe_b64encode(
        hashlib.sha256(f"{email}{terrible_security}".encode()).digest()
    ).decode()


def auth_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = auth_user()
        if user is None:
            return redirect("/")
        return f(user, *args, **kwargs)

    return decorated_function


def auth_user():
    login_cookie = request.cookies.get("login")
    if not login_cookie:
        return None
    email, signature = login_cookie.split("|")
    if signature != sign_email(email):
        return None
    return {"email": email}


@app.route("/")
def index():
    user = auth_user()
    if user:
        return render_template_string(
            """
            <html><body>
                <h1>Welcome back {{ username }}</h1>
            </body></html>
        """,
            username=user["email"],
        )
    else:
        return render_template_string("""
            <html><body>
                <h1>Please login</h1>
                <form action="/login" method="post">
                    <input type="text" name="email" placeholder="email">
                    <input type="submit" value="login">
                </form>
            </body></html>
        """)


@app.route("/login", methods=["POST"])
def login():
    email = request.form["email"]
    random_code = repeatable_random(7)
    database[random_code] = email

    login_link = f"http://{request.host}/login-confirm/{random_code}"
    send_email(
        email,
        "Login to example.com",
        f'Click <a href="{login_link}">here</a> to login.',
    )

    return render_template_string("""
        <html><body>
            <h1>Email sent!</h1>
            <p>Check your email for your login link.</p>
        </body></html>
    """)


@app.route("/login-confirm/<code>")
def login_confirm(code):
    email = database.pop(code, None)
    if email is None:
        return render_template_string("""
            <html><body>
                <h1>Login link expired.</h1>
                <p>Sorry, <a href="/">try again</a>.</p>
            </body></html>
        """)

    response = make_response(redirect("/"))
    response.set_cookie("login", f"{email}|{sign_email(email)}")
    return response


@app.route("/email")
def email_list():
    messages = email_storage
    html = "<h2>Messages</h2><ul>"
    if not messages:
        html += "<li>(none)</li>"
    else:
        for i, message in enumerate(messages, 1):
            html += f'<li><a href="/email/message/{i}">{i}: {message["to"]} {message["subject"]}</a></li>'
    html += "</ul>"
    return html


@app.route("/email/message/<int:idx>")
def email_message(idx):
    idx -= 1
    if 0 <= idx < len(email_storage):
        return email_storage[idx]["html_content"]
    else:
        return "No such message"


def wait_for_incoming_email(timeout=1):
    start_time = time.time()
    with email_lock:
        while len(email_storage) == 0:
            remaining_time = timeout - (time.time() - start_time)
            if remaining_time <= 0:
                raise TimeoutError("Email wasn't sent within the specified timeout")
            email_condition.wait(timeout=remaining_time)
        return email_storage[-1]


@app.route("/dev/time", methods=["POST"])
def set_dev_time():
    action = request.json.get("action")
    if action == "set_year":
        year = request.json.get("year")
        dev_time.set_year(year)
    elif action == "advance_24hrs":
        dev_time.advance_24hrs()
    return jsonify({"current_time": dev_time.now().isoformat()})


if __name__ == "__main__":
    print("Opening selfie demo app at http://localhost:5000")
    app.run(debug=True)
