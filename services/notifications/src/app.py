import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import jwt
import socketio  # pyright: ignore[reportMissingTypeStubs]
from fastapi import FastAPI

from subscriber import run as run_subscriber

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://localhost:5672")
KEYCLOAK_INTERNAL_URL = os.environ.get("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "betting")
KEYCLOAK_ISSUER_URL = os.environ.get(
    "KEYCLOAK_ISSUER_URL", f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}"
)

JWKS_URL = (
    f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
)
jwks_client = jwt.PyJWKClient(JWKS_URL)

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")  # pyright: ignore[reportUnknownMemberType]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    subscriber = asyncio.create_task(
        run_subscriber(RABBITMQ_URL, sio), name="notifications-subscriber"
    )
    try:
        yield
    finally:
        subscriber.cancel()
        try:
            await subscriber
        except asyncio.CancelledError:
            pass


fastapi_app = FastAPI(lifespan=lifespan)


@fastapi_app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)  # pyright: ignore[reportUnknownMemberType]


@sio.event  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
async def connect(
    sid: str, _environ: dict[str, Any], auth: dict[str, Any] | None
) -> bool:
    token = auth.get("token") if isinstance(auth, dict) else None
    if not isinstance(token, str):
        logger.info("Rejecting socket %s: no token", sid)
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
        logger.info("Rejecting socket %s: %s", sid, exc)
        return False
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        return False
    await sio.enter_room(sid, user_id)  # pyright: ignore[reportUnknownMemberType]
    logger.info("Socket %s joined room %s", sid, user_id)
    return True
