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
KEYCLOAK_INTERNAL_URL = os.environ.get("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "betting")
KEYCLOAK_ISSUER_URL = os.environ.get(
    "KEYCLOAK_ISSUER_URL", f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}"
)

JWKS_URL = f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
jwks_client = jwt.PyJWKClient(JWKS_URL)

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
        signing_key = jwks_client.get_signing_key_from_jwt(token).key
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=KEYCLOAK_ISSUER_URL,
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        logger.info("Rejecting socket %s: %s", request.sid, exc)  # type: ignore[attr-defined]
        return False
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        return False
    join_room(user_id)
    logger.info("Socket %s joined room %s", request.sid, user_id)  # type: ignore[attr-defined]


socketio.start_background_task(run_subscriber, REDIS_URL, socketio)
