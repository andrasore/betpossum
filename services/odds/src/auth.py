"""Keycloak bearer-token auth for FastAPI routes.

Mirrors the JWT verification used by the notifications service: validate the
RS256 signature against the realm's JWKS, then check that `realm_access.roles`
includes the required role.
"""

import os
from typing import Annotated, Any, cast

import jwt
from fastapi import Depends, HTTPException, Request, status

KEYCLOAK_INTERNAL_URL = os.environ.get("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "betting")
KEYCLOAK_ISSUER_URL = os.environ.get(
    "KEYCLOAK_ISSUER_URL", f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}"
)
JWKS_URL = (
    f"{KEYCLOAK_INTERNAL_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
)

_jwks_client = jwt.PyJWKClient(JWKS_URL)


def _decode_bearer(request: Request) -> dict[str, Any]:
    header = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if not header or not header.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    token = header.split(" ", 1)[1].strip()
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


def require_admin(claims: Annotated[dict[str, Any], Depends(_decode_bearer)]) -> None:
    realm_access = claims.get("realm_access")
    raw_roles = (
        cast(dict[str, Any], realm_access).get("roles")
        if isinstance(realm_access, dict)
        else None
    )
    roles: list[str] = (
        [r for r in cast(list[Any], raw_roles) if isinstance(r, str)]
        if isinstance(raw_roles, list)
        else []
    )
    if "admin" not in roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
