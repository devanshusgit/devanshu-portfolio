"""FastAPI dependencies: service container, DB session, authentication, roles."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.context import AppContext
from app.core.security import constant_time_equals, decode_access_token
from app.db.models import User

bearer = HTTPBearer(auto_error=False)


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx


Ctx = Annotated[AppContext, Depends(get_ctx)]


def get_db(ctx: Ctx) -> Iterator[Session]:
    yield from ctx.db.session()


DB = Annotated[Session, Depends(get_db)]


def user_from_token(token: str, ctx: AppContext, db: Session) -> User | None:
    try:
        payload = decode_access_token(token, ctx.settings.secret_key, ctx.settings.jwt_algorithm)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        return None
    return user


def get_current_user(
    ctx: Ctx,
    db: DB,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    user = user_from_token(credentials.credentials, ctx, db)
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator role required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def device_or_user(
    ctx: Ctx,
    db: DB,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    x_device_key: Annotated[str | None, Header()] = None,
) -> tuple[str, User | None]:
    """Sensor ingestion accepts either a device key (hardware) or a user JWT."""
    if x_device_key is not None:
        if constant_time_equals(x_device_key, ctx.settings.sensor_device_key):
            return "device", None
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid device key")
    if credentials is not None:
        user = user_from_token(credentials.credentials, ctx, db)
        if user is not None:
            return "user", user
    raise HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Provide an X-Device-Key header or a Bearer token", headers={"WWW-Authenticate": "Bearer"}
    )
