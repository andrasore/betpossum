"""Keycloak bearer-token auth for FastAPI routes.

Mirrors the verification used by the odds/notifications services: validate the
RS256 signature against the realm's JWKS and expose the `sub` claim so the
per-user /stats/me endpoints can scope to the caller.
"""

import os
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2AuthorizationCodeBearer

KEYCLOAK_INTERNAL_URL = os.environ.get("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "betting")
KEYCLOAK_ISSUER_URL = os.environ.get(
    "KEYCLOAK_ISSUER_URL", f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}"
)
JWKS_URL = (
    f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
)

_jwks_client = jwt.PyJWKClient(JWKS_URL)

_oauth2_scheme = OAuth2AuthorizationCodeBearer(
    authorizationUrl=f"{KEYCLOAK_ISSUER_URL}/protocol/openid-connect/auth",
    tokenUrl=f"{KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token",
)


def _decode_bearer(token: Annotated[str, Depends(_oauth2_scheme)]) -> dict[str, Any]:
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token).key
        payload: dict[str, Any] = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=KEYCLOAK_ISSUER_URL,
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc
    return payload


def current_user_sub(claims: Annotated[dict[str, Any], Depends(_decode_bearer)]) -> str:
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return sub
