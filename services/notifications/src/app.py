import eventlet
eventlet.monkey_patch()

import logging
import os
import jwt
from flask import Flask, jsonify, request
from flask_socketio import SocketIO, join_room
from subscriber import run as run_subscriber

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
JWT_SECRET = os.environ.get("JWT_SECRET", "")

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@socketio.on("connect")
def on_connect(auth):
    token = (auth or {}).get("token") if isinstance(auth, dict) else None
    if not token:
        logger.info("Rejecting socket %s: no token", request.sid)  # type: ignore[attr-defined]
        return False
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        logger.info("Rejecting socket %s: %s", request.sid, exc)  # type: ignore[attr-defined]
        return False
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        return False
    join_room(user_id)
    logger.info("Socket %s joined room %s", request.sid, user_id)  # type: ignore[attr-defined]


socketio.start_background_task(run_subscriber, REDIS_URL, socketio)
